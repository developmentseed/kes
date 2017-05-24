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

const configureProgram = function (Kes) {
  program
    .usage('init')
    .description('Start a Kes project')
    .action(() => {
      init();
    });

  // the CLI activation
  program
    .usage('TYPE COMMAND [options]')
    .option('-p, --profile <profile>', 'AWS profile name to use for authentication', 'default')
    .option('-c, --config <config>', 'Path to config file', path.join(kesFolder, 'config.yml'))
    .option('-r, --region', 'AWS region', 'us-east-1')
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
      const kes = new Kes();
      switch (cmd) {
        case 'create':
          kes.cf.createStack(program);
          break;
        case 'update':
          kes.cf.updateStack(program);
          break;
        case 'validate':
          kes.cf.validateTemplate(program);
          break;
        case 'compile':
          kes.cf.compileCF(program);
          break;
        case 'dlq':
          kes.cf.dlqToLambda(program);
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
      const kes = new Kes();
      if (cmd) {
        kes.lambda.updateLambda(program, cmd, options);
      }
      else {
        console.log('Lambda name is missing');
      }
    });
};

// check if there is an override file in .kes folder
if (fs.existsSync(path.join(kesFolder, 'kes.js'))) {
  const override = require(path.join(kesFolder, 'kes.js'));

  if (override.Kes) {
    configureProgram(override.Kes);
  }
  else {
    const Kes = require('../index');
    configureProgram(Kes);
  }
}
else {
  const Kes = require('../index');
  configureProgram(Kes);
}

program
  .parse(process.argv);
