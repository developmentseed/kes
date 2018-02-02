#!/usr/bin/env node

'use strict';

require('./readme');
const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const yaml = require('js-yaml');
const prompt = require('prompt');
const program = require('commander');
const kes = require('../index');
const pckg = require('../package.json');

const baseDir = process.cwd();
const kesFolder = path.join(baseDir, '.kes');
const distFolder = path.join(baseDir, 'dist');

program.version(pckg.version);

function extractCommanderOptions(program) {
  const options = {};
  Object.keys(program).forEach(property => {
    if (typeof program[property] === 'string') {
      options[property] = program[property];
    }
  });
  return options;
}

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

    fs.mkdirSync(kesFolder);

    // only create dist folder if it doesn't exist
    try {
      fs.statSync(distFolder);
    }
    catch (e) {
      fs.mkdirSync(distFolder);
    }

    console.log(`.kes folder created at ${kesFolder}`);

    // copy simple config file and template
    const config = yaml.safeLoad(fs.readFileSync(
      path.join(__dirname, '..', 'examples/lambdas/config.yml'), 'utf8'));
    config.default.stackName = result.stack;

    if (!config.default.buckets) {
      config.default.buckets = {};
    }

    config.default.buckets.internal = result.bucket;
    fs.writeFileSync(path.join(kesFolder, 'config.yml'), yaml.safeDump(config));

    fs.createReadStream(
      path.join(__dirname, '..', 'examples/lambdas/cloudformation.template.yml')
    ).pipe(fs.createWriteStream(path.join(kesFolder, 'cloudformation.template.yml')));
    console.log('config files were copied');
  });
};

//const configureProgram = function () {
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
  .option('--role <role>', 'AWS role arn to be assumed for the deployment', null)
  .option('-c, --config <config>', 'Path to config file')
  .option('--env-file <envFile>', 'Path to env file')
  .option('--cf-file <cfFile>', 'Path to CloudFormation template')
  .option('-t, --template <template>', 'A kes application template used as the base for the configuration')
  .option('--kes-class <kesClass>', 'Kes Class override', null)
  .option('-k, --kes-folder <kesFolder>', 'Path to config folder')
  .option('-r, --region <region>', 'AWS region', null)
  .option('--stack <stack>', 'stack name, defaults to the config value')
  .option('-d, --deployment <deployment>', 'Deployment name, default to default');

program
  .command('cf [create|update|upsert|deploy|validate|compile]')
  .description(`CloudFormation Operations:
  create    Creates the CF stack (deprecated, start using deploy)
  update    Updates the CF stack (deprecated, start using deploy)
  upsert    Creates the CF stack and Update if already exists (deprected, start using deploy)
  deploy    Creates the CF stack and Update if already exists
  validate  Validates the CF stack
  compile   Compiles the CF stack`)
  .action((cmd, o) => {
    const options = extractCommanderOptions(program);
    kes.buildCf(options ,cmd);
  });

program
  .command('lambda <lambdaName>')
  .description('uploads a given lambda function to Lambda service')
  .action((cmd, options) => {
    kes.buildLambda(program, cmd);
  });

program
  .parse(process.argv);
