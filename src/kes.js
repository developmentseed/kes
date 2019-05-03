'use strict';

const get = require('lodash.get');
const moment = require('moment');
const Handlebars = require('handlebars');
const forge = require('node-forge');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const pRetry = require('p-retry');
const inquirer = require('inquirer');
const Lambda = require('./lambda');
const utils = require('./utils');

/**
 * The main Kes class. This class is used in the command module to create
 * the CLI interface for kes. This class can be extended in order to override
 * and modify the behavior of kes cli.
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

    // template name
    if (config.parent) {
      this.cf_template_name = `${config.nested_cf_name}.yml`;
    }
    else {
      this.cf_template_name = `${path.basename(config.cfFile, '.template.yml')}.yml`;
    }

    this.templateUrl = `https://s3.amazonaws.com/${this.bucket}/${this.stack}/${this.cf_template_name}`;

    utils.configureAws(this.config.region, this.config.profile, this.config.role);
    this.s3 = new AWS.S3();
    this.cf = new AWS.CloudFormation();
    this.AWS = AWS;
    this.Lambda = Lambda;
    this.startTime = moment();
  }

  /**
   * Describe CF stacks by calling the describeStacks CF SDK function.
   * If the describeStacks call gets throttled by AWS, retry the describeStacks operation
   *
   * @param stackName - stack name
   * @returns {Promise<Object>} - promise that resolves to an Object with information about
   * the CF stack
   */
  describeStack(stackName) {
    const describe = () => this.cf.describeStacks({
      StackName: stackName
    })
    .promise()
    .catch((error) => {
      if (error.code !== 'ThrottlingException') {
        throw new pRetry.AbortError(error.message, error);
      }
      throw error;
    });

    return pRetry(describe, {
      onFailedAttempt: error => {
        console.log(`Attempt ${error.attemptNumber} failed. There are ${error.attemptsLeft} attempts left.`);
      },
      retries: 5
    });
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

    Handlebars.registerHelper('ifEquals', function ifEquals(arg1, arg2, options) {
      return (arg1 === arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('ifNotEquals', function ifNotEquals(arg1, arg2, options) {
      return (arg1 !== arg2) ? options.fn(this) : options.inverse(this);
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
          if (!e.message.includes('ENOENT')) {
            console.log(`compiling the override template at ${this.config.cfFile} failed:`);
            throw e;
          }
          cf = mainCF;
        }
      }
      else {
        cf = this.parseCF(this.config.cfFile);
      }

      const destPath = path.join(this.config.kesFolder, this.cf_template_name);
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
                  .then(() => {
                    const httpUrl = `http://${bucket}.s3.amazonaws.com/${key}`;
                    console.log(`Uploaded: s3://${bucket}/${key}`);
                    return httpUrl;
                  });
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
        fs.accessSync(path.join(this.config.kesFolder, this.cf_template_name));
      }
      catch (e) {
        throw new Error(`${this.cf_template_name} is missing.`);
      }

      // upload CF template to S3
      if (this.bucket) {
        return this.uploadToS3(
          this.bucket,
          `${this.stack}/${this.cf_template_name}`,
          fs.readFileSync(path.join(this.config.kesFolder, this.cf_template_name))
        );
      }
      else {
        console.log('Skipping CF template upload because internal bucket value is not provided.');
        return true;
      }
    });
  }

  /**
   * Wait for the current stack and log the current outcome
   *
   * @returns {Promise} undefined
   */
  waitFor(wait) {
    console.log('Waiting for the CF operation to complete');
    return this.cf.waitFor(wait, { StackName: this.stack }).promise()
      .then(r => {
        if (r && r.Stacks && r.Stacks[0] && r.Stacks[0].StackStatus) {
          console.log(`CF operation is in state of ${r.Stacks[0].StackStatus}`);
        }
        else {
          console.log(`CF operation is completed`);
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
    const pushToCfParams = (p) => {
      cfParams.push({
        ParameterKey: p.name,
        ParameterValue: p.value,
        UsePreviousValue: p.usePrevious || false
      });
    };
    // add custom params from the config file if any
    if (this.config.params[this.config.template.baseName]) {
      this.config.params[this.config.template.baseName].forEach(pushToCfParams);
    }
    else if (this.config.params && this.config.params instanceof Array) {
      this.config.params.forEach(pushToCfParams);
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
      params.TemplateBody = fs.readFileSync(path.join(this.config.kesFolder, this.cf_template_name)).toString();
    }

    let wait = 'stackUpdateComplete';

    // check if the stack exists
    return this.describeStack(this.stack)
      .then(r => this.cf.updateStack(params).promise())
      .catch(e => {
        if (e.message.includes('does not exist')) {
          wait = 'stackCreateComplete';
          return this.cf.createStack(params).promise();
        }
        throw e;
      })
      .then(() => this.waitFor(wait))
      .catch((e) => {
        const errorsWithDetail = [
          'CREATE_FAILED',
          'Resource is not in the state stackUpdateComplete',
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
    const url = this.templateUrl;

    const params = {};

    if (this.bucket) {
      // upload the template to the bucket first
      params.TemplateURL = url;

      return this.uploadCF()
        .then(() => this.cf.validateTemplate(params).promise())
        .then(() => console.log('Template is valid'));
    }
    else {
      params.TemplateBody = fs.readFileSync(path.join(this.config.kesFolder, this.cf_template_name)).toString();
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
    return this.describeStack(this.stack);
  }

  /**
   * Deletes the current stack
   *
   * @returns {Promise} undefined
   */
  deleteCF() {
    return this.cf.deleteStack({
      StackName: this.stack
    }).promise()
    .then(() => this.waitFor('stackDeleteComplete'))
    .then(() => console.log(`${this.stack} is successfully deleted`));
  }

  /**
   * Generic create/update  method for CloudFormation
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  opsStack() {
    return this.uploadCF()
      .then(() => this.cloudFormation())
      .then(() => {
        if (this.config.showOutputs) {
          return this.describeCF();
        }
        return Promise.resolve();
      })
      .then((r) => {
        if (r && r.Stacks[0] && r.Stacks[0].Outputs) {
          console.log('\nList of the CloudFormation outputs:\n');
          r.Stacks[0].Outputs.map((o) => console.log(`${o.OutputKey}: ${o.OutputValue}`));
        }
      });
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

  /**
   * Deletes the main stack
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  deleteStack() {
    if (this.config.yes) {
      return this.deleteCF();
    }
    return inquirer.prompt(
      [{
        type: 'confirm',
        name: 'delete',
        message: `Are you sure you want to delete ${this.stack}? This operation is not reversible`
      }]
    ).then(answers => {
      if (answers.delete) {
        return this.deleteCF();
      }
      console.log('Operation canceled');
      return Promise.resolve();
    });
  }
}

module.exports = Kes;
