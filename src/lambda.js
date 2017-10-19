'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const fs = require('fs-extra');
const path = require('path');
const { exec, getZipName } = require('./utils');

/**
 * Copy, zip and upload lambda functions to S3
 *
 * @param {Object} config the configuration object
 * @param {String} kesFolder the path to the `.kes` folder
 * @param {String} bucket the S3 bucket name
 * @param {String} key the main folder to store the data in the bucket (stack)
 */
class Lambda {
  constructor(config) {
    this.config = config;
    this.kesFolder = config.kesFolder;
    this.distFolder = path.join(this.kesFolder, 'dist');
    this.buildFolder = path.join(this.kesFolder, 'build');
    this.bucket = get(config, 'bucket');
    this.key = path.join(this.config.stack, 'lambdas');
    this.grouped = {};
  }

  /**
   * Creates a hash of keys and bucket names for the lambdas
   * in the deployment based on their source path
   *
   * @private
   * @param {String} local the path to the lambda zip file on the host machine
   * @param {String} key the key to the lambda zip on S3
   * @param {String} source the path to the original code
   *
   * @return {Object}
   */
  updateGroup(local, key, source) {
    const tmp = {
      local,
      remote: key,
      bucket: this.bucket
    };

    this.grouped[source] = tmp;
    return tmp;
  }

  /**
   * Updates the lambda object with the bucket, s3 zip file path and
   * local zip file location
   *
   * @param {Object} lambda the lambda object
   * @returns {Object} returns the updated lambda object
   */
  updateLambda(lambda) {
    const tmp = this.grouped[lambda.source];
    Object.assign(lambda, tmp);
    return lambda;
  }

  getHash(folderName, method = 'shasum') {
    const alternativeMethod = 'sha1sum';
    let hash = exec(`find ${path.join(this.distFolder, folderName)} -type f | \
                   xargs ${method} | ${method} | awk '{print $1}' ${''}`, false);

    hash = hash.toString().replace(/\n/, '');

    if (hash.length === 0) {
      if (method === alternativeMethod) {
        throw new Error('You must either have shasum or sha1sum');
      }
      console.log(`switching to ${alternativeMethod}`);
      return this.getHash(folderName, alternativeMethod);
    }

    return hash;
  }

  /**
   * Copy source code of a given lambda function, zips it, calculate
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code
   *
   * @param {Object} lambda the lambda object
   * @returns {Object} returns the updated lambda object
   */
  zipLambda(lambda) {
    // if lambda share source with another lambda,
    // check if there is already a hash, if so, set the hash and return
    if (this.grouped[lambda.source]) {
      return lambda;
    }

    const folderName = getZipName(lambda.handler);
    const lambdaPath = path.join(this.distFolder, folderName);
    exec(`mkdir -p ${lambdaPath}; cp -r ${lambda.source} ${lambdaPath}/`);
    exec(`cd ${this.distFolder} && zip -r ../build/${folderName} ${folderName}`);

    const zipFile = `${folderName}.zip`;
    const hash = this.getHash(folderName);

    const key = path.join(this.key, hash.toString(), zipFile);
    const localPath = path.join(this.buildFolder, zipFile);

    return Object.assign(lambda, this.updateGroup(localPath, key, lambda.source));
  }

  /**
   * Uploads the zipped lambda code to a given s3 bucket
   * if the zip file already exists on S3 it skips the upload
   *
   * @param {Object} lambda the lambda object. It must have the following properties
   * @param {String} lambda.bucket the s3 buckt name
   * @param {String} lambda.remote the lambda code's key (path and filename) on s3
   * @param {String} lambda.local the zip files location on local machine
   * @returns {Promise} returns the promise of updated lambda object
   */
  uploadLambda(lambda) {
    const s3 = new AWS.S3();

    const params = {
      Bucket: this.bucket,
      Key: lambda.remote,
      Body: fs.readFileSync(lambda.local)
    };

    return new Promise((resolve, reject) => {
      // check if it is already uploaded
      s3.headObject({
        Bucket: this.bucket,
        Key: lambda.remote
      }).promise().then(() => {
        console.log(`Already Uploaded: s3://${this.bucket}/${lambda.remote}`);
        return resolve(lambda);
      }).catch(() => {
        s3.upload(params, (e, r) => {
          if (e) return reject(e);
          console.log(`Uploaded: s3://${this.bucket}/${lambda.remote}`);
          return resolve(lambda);
        });
      });
    });
  }

  /**
   * Zips and Uploads a lambda function. If the source of the function
   * is already zipped and uploaded, it skips the step only updates the
   * lambda config object.
   *
   * If the lambda config includes a link to zip file on S3, it skips
   * the whole step.
   *
   * @param {Object} lambda the lambda object.
   * @returns {Promise} returns the promise of updated lambda object
   */
  zipAndUploadLambda(lambda) {
    if (lambda.source) {
      if (this.grouped[lambda.source]) {
        return new Promise(resolve => resolve(this.updateLambda(lambda)));
      }
      lambda = this.zipLambda(lambda);
      return this.uploadLambda(lambda);
    }
    else if (lambda.s3Source) {
      lambda.remote = lambda.s3Source.key;
      lambda.bucket = lambda.s3Source.bucket;
      return new Promise(resolve => resolve(lambda));
    }
    return new Promise(resolve => resolve(lambda));
  }

  /**
   * Zips and Uploads lambda functions in the congifuration object.
   * If the source of the function
   * is already zipped and uploaded, it skips the step only updates the
   * lambda config object.
   *
   * If the lambda config includes a link to zip file on S3, it skips
   * the whole step.
   *
   * @returns {Promise} returns the promise of updated configuration object
   */
  process() {
    if (this.config.lambdas) {
      // remove the build folder if exists
      fs.removeSync(this.buildFolder);

      // create the lambda folder
      fs.mkdirpSync(this.buildFolder);

      // zip and upload lambdas
      const jobs = this.config.lambdas.map(l => this.zipAndUploadLambda(l));

      return new Promise((resolve, reject) => {
        Promise.all(jobs).then(lambdas => {
          this.config.lambdas = lambdas;
          return resolve(this.config);
        }).catch(e => reject(e));
      });
    }

    return new Promise(resolve => resolve(this.config));
  }

  /**
   * Uploads the zip code of a single lambda function to AWS Lambda
   *
   * @param  {String} name    name of the lambda function
   * @returns {Promise} returns AWS response for lambda code update operation
   */
  updateSingleLambda(name) {
    const l = new AWS.Lambda();

    // create the lambda folder if it doesn't already exist
    fs.mkdirpSync(this.buildFolder);

    let lambda;
    this.config.lambdas.forEach(l => {
      if (l.name === name) {
        lambda = l;
      }
    });

    if (!lambda) {
      throw new Error('Lambda function is not defined in config.yml');
    }
    const stack = this.config.stackName;

    console.log(`Updating ${lambda.name}`);
    lambda = this.zipLambda(lambda);
    return l.updateFunctionCode({
      FunctionName: `${stack}-${lambda.name}`,
      ZipFile: fs.readFileSync(lambda.local)
    }).promise()
    .then((r) => console.log(`Lambda function ${lambda.name} has been updated`));
  }
}

module.exports = Lambda;
