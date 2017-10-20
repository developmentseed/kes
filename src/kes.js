'use strict';

const get = require('lodash.get');
const Handlebars = require('handlebars');
const forge = require('node-forge');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const Lambda = require('./lambda');
const utils = require('./utils');

/**
 * The main Kes class. This class is used in the command module to create
 * the CLI interface for kes. This class can be extended in order to override
 * and modify the behaviour of kes cli.
 *
 * @example
 * const { Kes, Config } = require('kes');
 *
 * const options = { stack: 'myStack' };
 * const config = new Config(options);
 * const kes = new Kes(config);
 *
 * // create a new stack
 * kes.createStack()
 *  .then(() => updateStack())
 *  .then(() => describeCF())
 *  .then(() => updateSingleLambda('myLambda'))
 *  .catch(e => console.log(e));
 *
 * @param {Object} config an instance of the Config class (config.js)
 */
class Kes {
  constructor(config) {
    this.config = config;

    this.stack = this.config.stack;
    this.bucket = get(config, 'bucket');
    this.templateUrl = `https://s3.amazonaws.com/${this.bucket}/${this.stack}/cloudformation.yml`;

    utils.configureAws(this.config.region, this.config.profile, this.config.role);
    this.s3 = new AWS.S3();
  }

  /**
   * Updates code of a deployed lambda function
   *
   * @param {String} name the name of the lambda function defined in config.yml
   * @return {Promise} returns the promise of an AWS response object
   */
  updateSingleLambda(name) {
    const lambda = new Lambda(this.config);
    return lambda.updateSingleLambda(name);
  }

  /**
   * Compiles a CloudFormation template in Yaml format.
   *
   * Reads the configuration yaml from `.kes/config.yml`.
   *
   * Writes the template to `.kes/cloudformation.yml`.
   *
   * Uses `.kes/cloudformation.template.yml` as the base template
   * for generating the final CF template.
   *
   * @return {Promise} returns the promise of an AWS response object
   */
  compileCF() {
    const t = fs.readFileSync(this.config.cfFile, 'utf8');

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

    const destPath = path.join(this.config.kesFolder, 'cloudformation.yml');

    const lambda = new Lambda(this.config);

    return lambda.process().then((config) => {
      this.config = config;
      console.log(`Template saved to ${destPath}`);
      return fs.writeFileSync(destPath, template(this.config));
    });
  }

  /**
   * This is just a wrapper around AWS s3.upload method.
   * It uploads a given string to a S3 object.
   *
   * @param {String} bucket the s3 bucket name
   * @param {String} key the path and name of the object
   * @param {String} body the content of the object
   * @returns {Promise} returns the promise of an AWS response object
   */
  uploadToS3(bucket, key, body) {
    console.log(`Uploaded: s3://${bucket}/${key}`);
    return this.s3.upload({ Bucket: bucket, Key: key, Body: body }).promise();
  }

  /**
   * Uploads the Cloud Formation template to a given S3 location
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  uploadCF() {
    // build the template first
    return this.compileCF().then(() => {
      // make sure cloudformation template exists
      try {
        fs.accessSync(path.join(this.config.cfFile));
      }
      catch (e) {
        throw new Error('cloudformation.yml is missing.');
      }

      // upload CF template to S3
      if (this.bucket) {
        return this.uploadToS3(
          this.bucket,
          `${this.stack}/cloudformation.yml`,
          fs.readFileSync(path.join(this.config.kesFolder, 'cloudformation.yml'))
        );
      }
      else {
        console.log('Skipping CF template upload because internal bucket value is not provided.');
        return true;
      }
    });
  }

  /**
   * Calls CloudFormation's update-stack or create-stack methods
   *
   * @param {String} op possible values are 'create' and 'update'
   * @returns {Promise} returns the promise of an AWS response object
   */
  cloudFormation(op) {
    const cf = new AWS.CloudFormation();
    let opFn = op === 'create' || op === 'upsert' ? cf.createStack : cf.updateStack;
    const wait = op === 'create' || op === 'upsert' ? 'stackCreateComplete' : 'stackUpdateComplete';

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
      StackName: this.stack,
      Parameters: cfParams,
      Capabilities: capabilities
    };

    if (this.config.tags) {
      params.Tags = Object.keys(this.config.tags).map((key) => ({
        Key: key,
        Value: this.config.tags[key]
      }));
    }
    else {
      params.Tags = [];
    }

    if (this.bucket) {
      params.TemplateURL = this.templateUrl;
    }
    else {
      params.TemplateBody = fs.readFileSync(path.join(this.config.kesFolder, 'cloudformation.yml')).toString();
    }

    opFn = opFn.bind(cf);
    return opFn(params).promise().then(() => {
      console.log('Waiting for the CF operation to complete');
      return cf.waitFor(wait, { StackName: this.stack }).promise()
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
        if (e.name && e.name === 'AlreadyExistsException' && op === 'upsert') {
          return this.cloudFormation('update');
        }

        console.log('There was an error creating/updating the CF stack');
        throw e;
      }
    });
  }

  /**
   * Validates the CF template
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  validateTemplate() {
    console.log('Validating the template');
    const url = `https://s3.amazonaws.com/${this.bucket}/${this.stack}/cloudformation.yml`;

    const params = {};

    if (this.bucket) {
      params.TemplateURL = url;
    }
    else {
      params.TemplateBody = fs.readFileSync(path.join(this.config.kesFolder, 'cloudformation.yml')).toString();
    }

    // Build and upload the CF template
    const cf = new AWS.CloudFormation();
    return cf.validateTemplate(params)
      .promise().then(() => console.log('Template is valid'));
  }

  /**
   * Describes the cloudformation stack deployed
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  describeCF() {
    const cf = new AWS.CloudFormation();

    return cf.describeStacks({
      StackName: `${this.stack}`
    }).promise();
  }

  /**
   * Generic create/update  method for CloudFormation
   *
   * @param {String} op possible values are 'create' and 'update'
   * @returns {Promise} returns the promise of an AWS response object
   */
  opsStack(ops) {
    return this.uploadCF().then(() => this.cloudFormation(ops));
  }

  /**
   * Creates a CloudFormation stack for the class instance
   * If exists, will update the existing one
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  upsertStack() {
    return this.opsStack('upsert');
  }

  /**
   * Creates a CloudFormation stack for the class instance
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  createStack() {
    return this.opsStack('create');
  }

  /**
   * Updates an existing CloudFormation stack for the class instance
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  updateStack() {
    return this.opsStack('update');
  }
}

module.exports = Kes;
