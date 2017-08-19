'use strict';

const _ = require('lodash');
const path = require('path');
const AWS = require('aws-sdk');
const fs = require('fs-extra');
const parseConfig = require('./common').parseConfig;
const exec = require('./common').exec;

function getFolderName(handler) {
  return handler.split('.')[0];
}

function zipLambda(lambdaConfig) {
  // get folder name from handler
  const folderName = getFolderName(lambdaConfig.handler);
  const lambdaPath = path.join(process.cwd(), 'dist', folderName);

  if (lambdaConfig.source) {
    exec(`mkdir -p ${lambdaPath}; cp ${lambdaConfig.source} ${lambdaPath}/`);
  }

  // make sure the built file exist
  if (!fs.existsSync(lambdaPath)) {
    console.log(`${lambdaPath} folder is missing`);
    process.exit(1);
  }

  exec(`cd dist && zip -r ../build/lambda/${folderName} ${folderName}`);
}

function zipLambdas(lambdas) {
  // group lambdas by handler name
  const zipping = {};
  lambdas.forEach(l => {
    if (!l.s3Source) {
      zipping[l.handler.split('.')[0]] = l;
    }
  });

  // zip lambdas
  Object.values(zipping).forEach(l => zipLambda(l));
}

/**
 * Zips lambda functions and uploads them to a given S3 location
 * @param  {string} s3Path  A valid S3 URI for uploading the zip files
 * @param  {string} profile The profile name used in aws CLI
 */
function uploadLambdas(s3Path, profile, config, region, cb) {
  if (config.lambdas) {
    if (profile) {
      const credentials = new AWS.SharedIniFileCredentials({ profile });
      AWS.config.credentials = credentials;
    }
    AWS.config.update({ region });
    const s3 = new AWS.S3();

    // remove the build folder if exists
    fs.removeSync(path.join(process.cwd(), 'build'));

    // create the lambda folder
    fs.mkdirpSync(path.join(process.cwd(), 'build/lambda'));
    const parsed = s3Path.match(/s3:\/\/([^/]*)\/(.*)/);

    zipLambdas(config.lambdas);

    // upload files dist folders
    const uploads = {};
    config.lambdas.forEach((lambda) => {
      if (lambda.s3Source) {
        return { Location: `s3://${lambda.s3Source.bucket}/${lambda.s3Source.key}` };
      }

      const folderName = getFolderName(lambda.handler);
      uploads[`${parsed[2]}/lambda/${folderName}.zip`] = {
        Bucket: parsed[1],
        Key: `${parsed[2]}/lambda/${folderName}.zip`,
        Body: fs.readFileSync(`./build/lambda/${folderName}.zip`)
      };
    });

    const jobs = Object.values(uploads).map(u => s3.upload(u).promise());

    Promise.all(jobs).then((r) => {
      r.forEach(l => console.log(`Uploaded: ${l.Location}`));
      cb(null);
    }).catch(e => cb(e));
  }
}

/**
 * Uploads the zip code of a given lambda function to AWS Lambda
 * @param  {Object} options options passed by the commander module
 * @param  {String} name    name of the lambda function
 */
function updateLambda(options, name, webpack, cb) {
  const profile = options.profile;
  const region = options.region;
  const config = parseConfig(null, null, options.stage);
  //const lambdas = lambdaObject(null, options.stage);

  if (profile) {
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    AWS.config.credentials = credentials;
  }
  AWS.config.update({ region });
  const l = new AWS.Lambda();

  // Run webpack
  if (_.has(webpack, 'webpack') && webpack.webpack) {
    exec('webpack');
  }

  // create the lambda folder if it doesn't already exist
  fs.mkdirpSync(path.join(process.cwd(), 'build/lambda'));

  let lambda;
  config.lambdas.forEach(l => {
    if (l.name === name) {
      lambda = l;
    }
  });

  if (!lambda) {
    return cb(new Error('Lambda function is not defined in config.yml'));
  }

  // zip lambdas
  zipLambda(lambda);

  //const uploads = config.lambdas[name].map((lambda) => {
    // Upload the zip file to AWS Lambda
  const folderName = getFolderName(lambda.handler);

  console.log(`Updating ${lambda.name}`);
  l.updateFunctionCode({
    FunctionName: lambda.fullName,
    ZipFile: fs.readFileSync(`./build/lambda/${folderName}.zip`)
  }).promise().then((r) => {
    console.log(`Lambda function ${lambda.name} has been updated`);
    cb(null);
  }).catch(e => cb(e));
}

module.exports.uploadLambdas = uploadLambdas;
module.exports.updateLambda = updateLambda;
