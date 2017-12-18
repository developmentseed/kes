'use strict';

const get = require('lodash.get');
const moment = require('moment');
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
 * kes.deployStack()
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
    this.cf = new AWS.CloudFormation();
    this.AWS = AWS;
    this.Lambda = Lambda;
    this.startTime = moment();
  }

  /**
   * Updates code of a deployed lambda function
   *
   * @param {String} name the name of the lambda function defined in config.yml
   * @return {Promise} returns the promise of an AWS response object
   */
  updateSingleLambda(name) {
    const lambda = new this.Lambda(this.config);
    return lambda.updateSingleLambda(name);
  }

  parseCF(cfFile) {
    const t = fs.readFileSync(cfFile, 'utf8');

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
    return template(this.config);
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
    const lambda = new this.Lambda(this.config);

    return lambda.process().then((config) => {
      this.config = config;
      let cf;

      // if there is a template parse CF there first
      if (this.config.template) {
        let mainCF = this.parseCF(this.config.template.cfFile);

        // check if there is a CF over
        try {
          fs.lstatSync(this.config.cfFile);
          let overrideCF = this.parseCF(this.config.cfFile);

          // merge the the two
          cf = utils.mergeYamls(mainCF, overrideCF);
        }
        catch (e) {
          cf = mainCF;
        }
      }
      else {
        cf = this.parseCF(this.config.cfFile);
      }

      const destPath = path.join(this.config.kesFolder, 'cloudformation.yml');
      console.log(`Template saved to ${destPath}`);
      return fs.writeFileSync(destPath, cf);
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
    return this.s3.upload({ Bucket: bucket, Key: key, Body: body })
                  .promise()
                  .then(() => console.log(`Uploaded: s3://${bucket}/${key}`));
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
        fs.accessSync(path.join(this.config.kesFolder, 'cloudformation.yml'));
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
   * @returns {Promise} returns the promise of an AWS response object
   */
  cloudFormation() {
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

    const capabilities = get(this.config, 'capabilities', []);

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

    let wait = 'stackUpdateComplete';

    // check if the stack exists
    return this.cf.describeStacks({ StackName: this.stack }).promise()
      .then(r => this.cf.updateStack(params).promise())
      .catch(e => {
        if (e.message.includes('does not exist')) {
          wait = 'stackCreateComplete';
          return this.cf.createStack(params).promise();
        }
        throw e;
      })
      .then(() => {
        console.log('Waiting for the CF operation to complete');
        return this.cf.waitFor(wait, { StackName: this.stack }).promise();
      })
      .then(r => console.log(`CF operation is in state of ${r.Stacks[0].StackStatus}`))
      .catch((e) => {
        const errorsWithDetail = [
          'CREATE_FAILED',
          'UPDATE_ROLLBACK_COMPLETE',
          'ROLLBACK_COMPLETE',
          'UPDATE_ROLLBACK_FAILED'
        ];
        const errorRequiresDetail = errorsWithDetail.filter(i => e.message.includes(i));

        if (e.message === 'No updates are to be performed.') {
          console.log(e.message);
          return e.message;
        }
        else if (errorRequiresDetail.length > 0) {
          console.log('There was an error deploying the CF stack');
          console.log(e.message);

          // get the error info here
          return this.cf.describeStackEvents({ StackName: this.stack }).promise();
        }
        else {
          console.log('There was an error deploying the CF stack');
          throw e;
        }
      })
      .then((r) => {
        if (r && r.StackEvents) {

          console.log('Here is the list of failures in chronological order:');
          r.StackEvents.forEach((s) => {
            if (s.ResourceStatus &&
                  s.ResourceStatus.includes('FAILED') &&
                  moment(s.Timestamp) > this.startTime) {
              console.log(`${s.Timestamp} | ` +
                          `${s.ResourceStatus} | ` +
                          `${s.ResourceType} | ` +
                          `${s.LogicalResourceId} | ` +
                          `${s.ResourceStatusReason}`);
            }
          });
          throw new Error('CloudFormation Deployment failed');
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
      // upload the template to the bucket first
      params.TemplateURL = url;

      return this.uploadCF()
        .then(() => this.cf.validateTemplate(params).promise())
        .then(() => console.log('Template is valid'));
    }
    else {
      params.TemplateBody = fs.readFileSync(path.join(this.config.kesFolder, 'cloudformation.yml')).toString();
    }

    // Build and upload the CF template
    return this.cf.validateTemplate(params)
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
      StackName: this.stack
    }).promise();
  }

  /**
   * Generic create/update  method for CloudFormation
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  opsStack() {
    return this.uploadCF().then(() => this.cloudFormation());
  }

  /**
   * [Deprecated] Creates a CloudFormation stack for the class instance
   * If exists, will update the existing one
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  upsertStack() {
    return this.opsStack();
  }

  /**
   * Creates a CloudFormation stack for the class instance
   * If exists, will update the existing one
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  deployStack() {
    return this.opsStack();
  }
  /**
   * [Deprecated] Creates a CloudFormation stack for the class instance
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  createStack() {
    return this.opsStack();
  }

  /**
   * [Deprecated] Updates an existing CloudFormation stack for the class instance
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  updateStack() {
    return this.opsStack();
  }
}

module.exports = Kes;
