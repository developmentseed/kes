'use strict';

const get = require('lodash.get');
const Handlebars = require('handlebars');
const forge = require('node-forge');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const Lambda = require('./lambda');
const Config = require('./config');
const utils = require('./utils');

class Kes {
  static parseConfig(configFile, stageFile, envs, stack, stage) {
    const stageConfig = utils.parseStage(stageFile, stage);
    return utils.parseConfig(configFile, stageConfig, envs, stack, stage);
  }

  constructor(options) {
    this.options = options;
    this.region = get(options, 'region', 'us-east-1');
    this.profile = get(options, 'profile', null);
    this.kesFolder = get(options, 'kesFolder', path.join(process.cwd(), '.kes'));
    this.configFile = get(options, 'configFile', path.join(this.kesFolder, 'config.yml'));
    this.stageFile = get(options, 'stageFile', path.join(this.kesFolder, 'stage.yml'));
    this.envFile = get(options, 'envFile', path.join(this.kesFolder, '.env'));
    this.cfFile = get(options, 'cfFile', path.join(this.kesFolder, 'cloudformation.template.yml'));

    //local env file
    const configInstance = new Config(options.stack, options.stage, this.configFile, this.stageFile, this.envFile);
    this.config = configInstance.parse();
    this.stage = this.config.stage || 'dev';
    this.stack = this.config.stackName;
    this.name = `${this.stack}-${this.stage}`;

    this.bucket = get(this.config, 'buckets.internal');
    this.templateUrl = `https://s3.amazonaws.com/${this.bucket}/${this.name}/cloudformation.yml`;

    utils.configureAws(this.region, this.profile);
  }

  updateSingleLambda(name) {
    const lambda = new Lambda(this.config, this.kesFolder, this.bucket, this.name);
    return lambda.updateSingleLambda(name);
  }

  /**
   * Compiles a CloudFormation template in Yaml format
   * Reads the configuration yaml from .kes/config.yml
   * Writes the template to .kes/cloudformation.yml
   * Uses .kes/cloudformation.template.yml as the base template
   * for generating the final CF template
   * @return {null}
   */
  compileCF() {
    const t = fs.readFileSync(this.cfFile, 'utf8');

    Handlebars.registerHelper('ToMd5', function(value) {
      if (value) {
        const md = forge.md.md5.create();
        md.update(value);
        return md.digest().toHex();
      }
      return value;
    });

    Handlebars.registerHelper('ToJson', function(value) {
      return JSON.stringify(value);
    });

    const template = Handlebars.compile(t);

    const destPath = path.join(this.kesFolder, 'cloudformation.yml');

    const lambda = new Lambda(this.config, this.kesFolder, this.bucket, this.name);

    return lambda.process().then((config) => {
      this.config = config;
      return fs.writeFileSync(destPath, template(this.config));
    });
  }

  uploadToS3(bucket, key, body) {
    const s3 = new AWS.S3();
    return s3.upload({ Bucket: bucket, Key: key, Body: body }).promise();
  }

  /**
   * Uploads the Cloud Formation template to a given S3 location
   * @param  {string} s3Path  A valid S3 URI for uploading the zip files
   * @param  {string} profile The profile name used in aws CLI
   */
  uploadCF() {
    // build the template first
    return this.compileCF().then(() => {
      // make sure cloudformation template exists
      try {
        fs.accessSync(path.join(this.cfFile));
      }
      catch (e) {
        throw new Error('cloudformation.yml is missing.');
      }

      // upload CF template to S3
      if (this.bucket) {
        return this.uploadToS3(
          this.bucket,
          `${this.name}/cloudformation.yml`,
          fs.readFileSync(path.join(this.kesFolder, 'cloudformation.yml'))
        );
      }
      else {
        console.log('Skipping CF template upload because internal bucket value is not provided.');
        return true;
      }
    });
  }

  cloudFormation(op) {
    const cf = new AWS.CloudFormation();
    let opFn = op === 'create' ? cf.createStack : cf.updateStack;
    const wait = op === 'create' ? 'stackCreateComplete' : 'stackUpdateComplete';

    const cfParams = [];
    // add custom params from the config file if any
    if (this.config.params) {
      this.config.params.forEach((p) => {
        cfParams.push({
          ParameterKey: p.name,
          ParameterValue: p.value,
          UsePreviousValue: p.usePrevious || false
          //NoEcho: p.noEcho || true
        });
      });
    }

    let capabilities = [];
    if (this.config.capabilities) {
      capabilities = this.config.capabilities.map(c => c);
    }

    const params = {
      StackName: this.name,
      Parameters: cfParams,
      Capabilities: capabilities
    };

    if (this.bucket) {
      params.TemplateURL = this.templateUrl;
    }
    else {
      params.TemplateBody = fs.readFileSync(path.join(this.kesFolder, 'cloudformation.yml')).toString();
    }

    opFn = opFn.bind(cf);
    return opFn(params).promise().then(() => {
      console.log('Waiting for the CF operation to complete');
      return cf.waitFor(wait, { StackName: this.name }).promise()
        .then(r => console.log(`CF operation is in state of ${r.Stacks[0].StackStatus}`))
        .catch(e => {
          if (e) {
            if (e.message.includes('Resource is not in the state')) {
              console.log('CF create/update failed. Check the logs');
            }
            throw e;
          }
        });
    })
    .catch((e) => {
      if (e.message === 'No updates are to be performed.') {
        console.log(e.message);
        return e.message;
      }
      else {
        console.log('There was an error creating/updating the CF stack');
        throw e;
      }
    });
  }

  /**
   * Validates the CF template
   * @param  {Object} options The options object should include the profile name (optional)
   */
  validateTemplate() {
    console.log('Validating the template');
    const url = `https://s3.amazonaws.com/${this.bucket}/${this.name}/cloudformation.yml`;

    // Build and upload the CF template
    const cf = new AWS.CloudFormation();
    return cf.validateTemplate({ TemplateURL: url })
      .promise().then(() => console.log('Template is valid'));
  }

  describeCF() {
    const cf = new AWS.CloudFormation();

    return cf.describeStacks({
      StackName: `${this.name}`
    }).promise();
  }

  /**
   * Generic create/update a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   * @param {String} ops Operation name, e.g. create/update
   */
  opsStack(ops) {
    return this.uploadCF().then(() => this.cloudFormation(ops));
  }

  /**
   * Creates a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   */
  createStack() {
    return this.opsStack('create');
  }

  /**
   * Updates a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   */
  updateStack() {
    return this.opsStack('update');
  }
}

module.exports = Kes;
