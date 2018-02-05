'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

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
    this.cf_basename = path.basename(config.cfFile, '.template.yml');
    this.kesFolder = config.kesFolder;
    this.distFolder = path.join(this.kesFolder, 'dist');
    this.buildFolder = path.join(this.kesFolder, 'build', this.cf_basename);
    this.bucket = get(config, 'bucket');
    this.key = path.join(this.config.stack, 'lambdas');
    this.grouped = {};
  }

  /**
   * Adds hash value, bucket name, and remote and local paths
   * for lambdas that have source value.
   *
   * If a s3Source is usaed, only add remote and bucket values
   * @param  {object} lambda the lambda object
   * @return {object} the lambda object
   */
  buildS3Path(lambda) {
    if (lambda.source) {
      // get hash
      lambda.hash = this.getHash(lambda.source).toString();
      lambda.bucket = this.bucket;

      // local zip
      const zipFile = `${lambda.hash}.zip`;
      lambda.local = path.join(this.buildFolder, zipFile);

      // remote address
      lambda.remote = path.join(this.key, zipFile);
    }
    else if (lambda.s3Source) {
      lambda.remote = lambda.s3Source.key;
      lambda.bucket = lambda.s3Source.bucket;
    }
    return lambda;
  }

  /**
   * calculate the hash value for a given path
   * @param  {string} folderName directory path
   * @param  {string} method  hash type, default to shasum
   * @return {buffer} hash value
   */
  getHash(folderName, method) {
    if (!method) {
      method = 'shasum';
    }

    const alternativeMethod = 'sha1sum';
    let hash = utils.exec(`find ${folderName} -type f | \
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
   * zip a given lambda function source code
   *
   * @param {Object} lambda the lambda object
   * @returns {Promise} returns the promise of the lambda object
   */
  zipLambda(lambda) {
    console.log(`Zipping ${lambda.local}`);

    // skip if the file with the same hash is zipped
    if (fs.existsSync(lambda.local)) {
      return Promise.resolve(lambda);
    }

    return utils.zip(lambda.local, [lambda.source]).then(() => {
      console.log(`Zipped ${lambda.local}`);
      return lambda;
    });
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
   * @param {Object} lambda the lambda object.
   * @returns {Promise} returns the promise of updated lambda object
   */
  zipAndUploadLambda(lambda) {
    return this.zipLambda(lambda).then(l => this.uploadLambda(l));
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
      // create the lambda folder
      fs.mkdirpSync(this.buildFolder);

      let lambdas = this.config.lambdas;

      // if the lambdas is not an array but a object, convert it to a list
      if (!Array.isArray(this.config.lambdas)) {
        lambdas = Object.keys(this.config.lambdas).map(name => {
          const lambda = this.config.lambdas[name];
          lambda.name = name;
          return lambda;
        });
      }

      // install npm packages
      lambdas.filter(l => l.npmSource).forEach(l => utils.exec(`npm install ${l.npmSource.name}@${l.npmSource.version}`));

      // build lambda path for lambdas that are zipped and uploaded
      lambdas = lambdas.map(l => this.buildS3Path(l));

      // zip and upload only unique hashes
      let uniqueHashes = {};
      lambdas.filter(l => l.source).forEach(l => {
        uniqueHashes[l.hash] = l;
      });
      const jobs = Object.keys(uniqueHashes).map(l => this.zipAndUploadLambda(uniqueHashes[l]));

      return Promise.all(jobs).then(() => {
        // we handle lambdas as both arrays and key/objects
        // below condition is intended to for cases where
        // the lambda is returned as a lsit
        if (Array.isArray(this.config.lambdas)) {
          this.config.lambdas = lambdas;
          return this.config;
        }
        const tmp = {};
        lambdas.forEach(l => (tmp[l.name] = l));
        this.config.lambdas = tmp;
        return this.config;
      });
    }
    else return Promise.resolve(this.config);
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
    Object.keys(this.config.lambdas).forEach(n => {
      if (n === name) {
        lambda = this.config.lambdas[n];
      }
    });

    if (!lambda) {
      throw new Error('Lambda function is not defined in config.yml');
    }
    const stack = this.config.stackName;
    lambda = this.buildS3Path(lambda);

    console.log(`Updating ${name}`);
    return this.zipLambda(lambda).then(lambda => l.updateFunctionCode({
      FunctionName: `${stack}-${name}`,
      ZipFile: fs.readFileSync(lambda.local)
    }).promise())
    .then((r) => console.log(`Lambda function ${name} has been updated`));
  }
}

module.exports = Lambda;
