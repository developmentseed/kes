#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const yaml = require('js-yaml');
const prompt = require('prompt');
const program = require('commander');

const baseDir = process.cwd();
const kesFolder = path.join(baseDir, '.kes');

const cb = (e, r) => {
  if (e) {
    if (e.message) {
      console.log(e.message);
    }
    else {
      console.log(e);
    }
    process.exit(1);
  }
  process.exit(0);
};

const init = function () {
  if (fs.existsSync(kesFolder)) {
    console.log('.kes folder already exists!');
    process.exit(1);
  }

  const promptSchema = {
    properties: {
      stack: {
        message: colors.white('Name the CloudFormation stack:'),
        default: 'kes-cf-template'
      },
      stage: {
        message: colors.white('Name the deployment stage:'),
        default: 'dev'
      },
      bucket: {
        message: colors.white('Bucket name used for deployment (required):'),
        required: true
      }
    }
  };

  prompt.get(promptSchema, function (err, result) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    console.log(kesFolder);
    fs.mkdirSync(kesFolder);
    fs.mkdirSync(path.join(baseDir, 'dist'));
    console.log(`.kes folder created at ${kesFolder}`);

    // copy simple config file and template
    const config = yaml.safeLoad(fs.readFileSync(
      path.join(__dirname, '..', 'examples/lambdas/config.yml'), 'utf8'));
    config.stackName = result.stack;
    config.stage = result.stage;
    config.buckets.internal = result.bucket;
    fs.writeFileSync(path.join(kesFolder, 'config.yml'), yaml.safeDump(config));

    fs.createReadStream(
      path.join(__dirname, '..', 'examples/lambdas/cloudformation.template.yml')
    ).pipe(fs.createWriteStream(path.join(kesFolder, 'cloudformation.template.yml')));
    console.log('config files were copied');
  });
};

const configureProgram = function (kes) {
  program
    .usage('init')
    .description('Start a Kes project')
    .action(() => {
      init();
    });

  // the CLI activation
  program
    .usage('TYPE COMMAND [options]')
    .option('-p, --profile <profile>', 'AWS profile name to use for authentication', null)
    .option('-c, --config <config>', 'Path to config file', path.join(kesFolder, 'config.yml'))
    .option('--configFolder <configFolder>', 'Path to config folder', path.join(kesFolder))
    .option('-r, --region <region>', 'AWS region', 'us-east-1')
    .option('--stack <stack>', 'stack name, defaults to the config value')
    .option('--stage <stage>', 'stage name, defaults to the config value');

  program
    .command('cf [create|update|validate|compile|dlq]')
    .description(`CloudFormation Operations:
    create    Creates the CF stack
    update    Updates the CF stack
    validate  Validates the CF stack
    compile   Compiles the CF stack
    dlq       add dead letter queue to lambdas`)
    .action((cmd) => {
      const k = new kes.CF(program);
      switch (cmd) {
        case 'create':
          k.createStack(cb);
          break;
        case 'update':
          k.updateStack(cb);
          break;
        case 'validate':
          k.validateTemplate(cb);
          break;
        case 'compile':
          k.compileCF(cb);
          break;
        default:
          console.log('Wrong choice. Accepted arguments: [create|update|validate|compile|dlq]');
      }
    });

  program
    .command('lambda <lambdaName>')
    .description('uploads a given lambda function to Lambda service')
    .option('-w, --webpack', 'Whether to run the webpack before updating the lambdas')
    .action((cmd, options) => {
      if (cmd) {
        kes.lambda.updateLambda(program, cmd, options, cb);
      }
      else {
        console.log('Lambda name is missing');
      }
    });
};

// check if there is an override file in .kes folder
if (fs.existsSync(path.join(kesFolder, 'kes.js'))) {
  const override = require(path.join(kesFolder, 'kes.js'));
  let kes = require('../index');

  kes = override(kes);
  configureProgram(kes);
}
else {
  configureProgram(require('../index'));
}

program
  .parse(process.argv);
