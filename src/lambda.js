'use strict';

const _ = require('lodash');
const path = require('path');
const AWS = require('aws-sdk');
const fs = require('fs-extra');
const parseConfig = require('./common').parseConfig;
const exec = require('./common').exec;

function getLambdaZipFile(handler) {
  return _.split(handler, '.')[0];
}

/**
 * Groups the lambdas by their folder name in a js object
 * This is needed because the code for a lambda function could
 * be shared across multiple lambdas. For example, collections.zip
 * is used for getCollection, listCollections and PostCollection
 * lambdas. This function creats list of all lambdas for each
 * lambda zip file. The information is exracted from the config.yml
 * @return {Object} A grouped lambdas list
 */
function lambdaObject(c, step) {
  c = c || parseConfig(null, null, step);
  const obj = {};

  for (const lambda of c.lambdas) {
    // extract the lambda folder name from the handler
    const funcName = getLambdaZipFile(lambda.handler);

    // create the list
    if (_.has(obj, funcName)) {
      obj[funcName].push({
        handler: lambda.handler,
        source: lambda.source,
        function: funcName,
        name: `${c.stackName}-${c.stage}-${lambda.name}`
      });
    }
    else {
      obj[funcName] = [{
        handler: lambda.handler,
        source: lambda.source,
        function: funcName,
        name: `${c.stackName}-${c.stage}-${lambda.name}`
      }];
    }
  }

  return obj;
}

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

    // zip files dist folders
    const uploads = config.lambdas.map((lambda) => {
      if (lambda.s3Source) {
        return { Location: `s3://${lambda.s3Source.bucket}/${lambda.s3Source.key}` };
      }

      const folderName = getFolderName(lambda.handler);

      return s3.upload({
        Bucket: parsed[1],
        Key: `${parsed[2]}/lambda/${folderName}.zip`,
        Body: fs.readFileSync(`./build/lambda/${folderName}.zip`)
      }).promise();
    });

    Promise.all(uploads).then((r) => {
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
  const lambdas = lambdaObject(null, options.stage);

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

  if (!lambdas[name]) {
    return cb(new Error('Lambda function is not defined in config.yml'));
  }

  // zip lambdas
  zipLambdas(lambdas[name]);

  const uploads = lambdas[name].map((lambda) => {
    // Upload the zip file to AWS Lambda
    const folderName = getFolderName(lambda.handler);

    console.log(`Updating ${lambda.name}`);
    return l.updateFunctionCode({
      FunctionName: lambda.name,
      ZipFile: fs.readFileSync(`./build/lambda/${folderName}.zip`)
    }).promise();
  });

  Promise.all(uploads).then((r) => {
    console.log(`${uploads.length} Lambda function(s) are updated`);
    cb(null);
  }).catch(e => cb(e));
}

module.exports.uploadLambdas = uploadLambdas;
module.exports.updateLambda = updateLambda;
module.exports.getLambdaZipFile = getLambdaZipFile;
