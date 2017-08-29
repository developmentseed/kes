'use strict';

const AWS = require('aws-sdk');
const fs = require('fs-extra');
const path = require('path');
const { exec, getZipName } = require('./utils');

class Lambda {
  constructor(config, kesFolder, bucket, key) {
    this.config = config;
    this.kesFolder = kesFolder;
    this.distFolder = path.join(this.kesFolder, 'dist');
    this.buildFolder = path.join(this.kesFolder, 'build');
    this.bucket = config.buckets.internal;
    this.key = path.join(key, 'lambdas');
    this.grouped = {};
  }

  updateGroup(local, key, source) {
    const tmp = {
      local,
      remote: key,
      bucket: this.bucket
    };

    this.grouped[source] = tmp;
    return tmp;
  }

  updateLambda(lambda) {
    const tmp = this.grouped[lambda.source];
    Object.assign(lambda, tmp);
    return lambda;
  }

  zipLambda(lambda) {
    // if lambda share source with another lambda,
    // check if there is already a hash, if so, set the hash and return
    if (this.grouped[lambda.source]) {
      return lambda;
    }

    const folderName = getZipName(lambda.handler);
    const lambdaPath = path.join(this.distFolder, folderName);
    exec(`mkdir -p ${lambdaPath}; cp -r ${lambda.source} ${lambdaPath}/`);
    exec(`cd ${this.distFolder} && zip -r ${path.join(this.buildFolder, folderName)} ${folderName}`);

    const zipFile = `${folderName}.zip`;
    let hash = exec(`find ${path.join(this.distFolder, folderName)} -type f | \
                      xargs shasum | shasum | awk '{print $1}' ${''}`, false);
    hash = hash.toString().replace(/\n/, '');

    const key = path.join(this.key, hash.toString(), zipFile);
    const localPath = path.join(this.buildFolder, zipFile);

    return Object.assign(lambda, this.updateGroup(localPath, key, lambda.source));
  }

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

  zipAndUploadLambda(lambda) {
    if (lambda.source) {
      if (this.grouped[lambda.source]) {
        return new Promise(resolve => resolve(this.updateLambda(lambda)));
      }
      lambda = this.zipLambda(lambda);
      return this.uploadLambda(lambda);
    }
    else if (lambda.s3Source) {
      lambda.remotePath = lambda.s3Source.key;
      lambda.bucket = lambda.s3Source.bucket;
      return new Promise(resolve => resolve(lambda));
    }
    return new Promise(resolve => resolve(lambda));
  }

  groupByHandler(lambdas) {
    // group lambdas by source name
    // this ensures that if there are multiple
    // lambdas with the same source code only
    // one of them is copied and zipped
    const zipping = {};
    lambdas.forEach(l => {
      if (l.source) {
        zipping[l.source] = {};
      }
    });

    return zipping;
  }

  /**
   * Zips lambda functions and uploads them to a given S3 location
   * @param  {string} s3Path  A valid S3 URI for uploading the zip files
   * @param  {string} profile The profile name used in aws CLI
   */
  process() {
    if (this.config.lambdas) {
      // remove the build folder if exists
      fs.removeSync(this.buildFolder);

      // create the lambda folder
      fs.mkdirpSync(this.buildFolder);

      // zip and upload lambdas
      const jobs = Object.values(this.config.lambdas).map(l => this.zipAndUploadLambda(l));

      return new Promise((resolve, reject) => {
        Promise.all(jobs).then(lambdas => {
          this.config.lambdas = lambdas;
          return resolve(this.config);
        }).catch(e => reject(e));
      });
    }
  }

  /**
   * Uploads the zip code of a given lambda function to AWS Lambda
   * @param  {Object} options options passed by the commander module
   * @param  {String} name    name of the lambda function
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
    const stage = this.config.stage;

    console.log(`Updating ${lambda.name}`);
    lambda = this.zipLambda(lambda);
    return l.updateFunctionCode({
      FunctionName: `${stack}-${stage}-${lambda.name}`,
      ZipFile: fs.readFileSync(lambda.local)
    }).promise()
    .then((r) => console.log(`Lambda function ${lambda.name} has been updated`));
  }
}

module.exports = Lambda;
