'use strict';

const Handlebars = require('handlebars');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const parseConfig = require('./common').parseConfig;
const exec = require('./common').exec;
const uploadLambdas = require('./lambda').uploadLambdas;

class CF {
  constructor(options) {
    this.options = options;
    this.region = options.region;
    this.profile = options.profile;
    this.config = parseConfig(options.config, options.stack, options.stage);
    this.stage = options.stage || this.config.stage;
    this.configureAws();
  }

  configureAws() {
    if (this.profile) {
      const credentials = new AWS.SharedIniFileCredentials({ profile: this.profile });
      AWS.config.credentials = credentials;
    }
    AWS.config.update({ region: this.region });
  }

  /**
   * Compiles a CloudFormation template in Yaml format
   * Reads the configuration yaml from .kes/config.yml
   * Writes the template to .kes/cloudformation.yml
   * Uses .kes/cloudformation.tempalte.yml as the base template
   * for generating the final CF template
   * @return {null}
   */
  compileCF() {
    const t = fs.readFileSync(path.join(process.cwd(), '.kes/cloudformation.template.yml'), 'utf8');
    const template = Handlebars.compile(t);

    const destPath = path.join(process.cwd(), '.kes/cloudformation.yml');
    console.log(`CF template saved to ${destPath}`);
    fs.writeFileSync(destPath, template(this.config));
  }

  /**
   * Uploads the Cloud Formation template to a given S3 location
   * @param  {string} s3Path  A valid S3 URI for uploading the zip files
   * @param  {string} profile The profile name used in aws CLI
   */
  uploadCF(s3Path, cb) {
    // build the template first
    this.compileCF();

    // make sure cloudformation template exists
    try {
      fs.accessSync(path.join(process.cwd(), '.kes/cloudformation.yml'));
    }
    catch (e) {
      throw new Error('cloudformation.yml is missing.');
    }

    const parsed = s3Path.match(/s3:\/\/([^/]*)\/(.*)/);

    // upload CF template to S3
    const s3 = new AWS.S3();
    s3.upload({
      Bucket: parsed[1],
      Key: `${parsed[2]}/cloudformation.yml`,
      Body: fs.readFileSync('.kes/cloudformation.yml')
    }, (e, r) => {
      console.log(`Uploaded CF template to s3://${r.Bucket}/${r.key}`);
      cb(e, r);
    });
  }

  cloudFormation(op, templateUrl, artifactHash, cb = () => {}) {
    const stackName = this.config.stackName;
    const name = this.stage ? `${stackName}-${this.stage}` : stackName;
    // Run the cloudformation cli command
    const cf = new AWS.CloudFormation();
    cf.updateStack({
      StackName: name,
      TemplateURL: templateUrl,
      Parameters: [{
        ParameterKey: 'ConfigS3Bucket',
        ParameterValue: this.config.buckets.internal,
        UsePreviousValue: false
      }, {
        ParameterKey: 'ArtifactPath',
        ParameterValue: artifactHash,
        UsePreviousValue: false
      }],
      Capabilities: ['CAPABILITY_IAM']
    }, (e, r) => {
      if (e) {
        if (e.message === 'No updates are to be performed.') {
          console.log(e.message);
          return cb(null, e.message);
        }
        else {
          console.log('There was an error updating the CF stack');
          return cb(e);
        }
      }
      else {
        console.log('Waiting for the CF operation to complete');
        cf.waitFor('stackUpdateComplete', { StackName: name }, (e, r) => {
          console.log('CF update is completed');
          cb(e, r);
        });
      }
    });
  }

  /**
   * Generates a unique hash for the deployment from the files
   * in the dist forlder
   * @param  {Object} c Configuration file
   * @return {Object}   Returns the hash and the S3 bucket path for storing the data
   */
  getHash() {
    // get the artifact hash
    // this is used to separate deployments from different machines
    let artifactHash = exec(`find dist -type f | \
                             xargs shasum | shasum | awk '{print $1}' ${''}`);
    artifactHash = artifactHash.toString().replace(/\n/, '');

    // Make the S3 Path
    const c = this.config;
    const s3Path = `s3://${c.buckets.internal}/${c.stackName}-${c.stage}/${artifactHash}`;
    const url = `https://s3.amazonaws.com/${c.buckets.internal}/${c.stackName}-${c.stage}/${artifactHash}`;

    return {
      hash: artifactHash,
      path: s3Path,
      url: url
    };
  }

  /**
   * Validates the CF template
   * @param  {Object} options The options object should include the profile name (optional)
   */
  validateTemplate(cb = () => {}) {
    // Get the checksum hash
    const h = this.getHash();

    console.log('Validating the template');
    const url = `${h.url}/cloudformation.yml`;

    // Build and upload the CF template
    const cf = new AWS.CloudFormation();
    cf.validateTemplate({ TemplateURL: url }, (e, r) => {
      if (e) {
        console.log(e);
      }
      else {
        console.log(r);
      }
      cb(e, r);
    });
  }

  describeCF(cb) {
    const cf = new AWS.CloudFormation();

    cf.describeStacks({
      StackName: `${this.config.stackName}-${this.stage}`
    }, (e, r) => {
      cb(e, r);
    });
  }

  /**
   * Generic create/update a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   * @param {String} ops Operation name, e.g. create/update
   */
  opsStack(ops, cb) {
    // Get the checksum hash
    const h = this.getHash();

    // upload lambdas and the cf template
    uploadLambdas(h.path, this.profile, this.config, this.region, (e, r) => {
      if (e) return cb(e);
      // Build and upload the CF template
      this.uploadCF(h.path, (e, r) => {
        this.cloudFormation(
          ops,
          `${h.url}/cloudformation.yml`,
          h.hash,
          cb
        );
      });
    });
  }

  /**
   * Creates a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   */
  createStack(cb = () => {}) {
    this.opsStack('create', cb);
  }

  /**
   * Updates a CloudFormation stack
   * @param  {Object} options The options object should include the profile name (optional)
   */
  updateStack(cb = () => {}) {
    try {
      this.opsStack('update', cb);
    }
    catch (e) {
      console.log('CloudFormation Update failed');
      throw e;
    }
  }
}

module.exports = CF;
