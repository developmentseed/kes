'use strict';

const fs = require('fs-extra');
const dotenv = require('dotenv');
const AWS = require('aws-sdk');
const execSync = require('child_process').execSync;

/**
 * Executes shell commands synchronously and logs the
 * stdout to console.
 * @param {String} cmd  Bash command
 * @param {Boolean} [verbose=true] whether to post stdout to console
 * @return {Buffer} The command's stdout in for of Buffer
 */
function exec(cmd, verbose) {
  verbose = verbose === false ? verbose : true;

  const stdout = execSync(cmd);
  if (verbose) {
    console.log(stdout.toString());
  }
  return stdout;
}

/**
 * Updates region of an AWS configuration and point to the correct
 * of profile on ~/.aws/credentials file if necessary
 *
 * @param {String} [region='us-east-1'] AWS region
 * @param {String} [profile=null] aws credentials profile name
 */
function configureAws(region = null, profile = null, role = null) {
  if (region) {
    AWS.config.update({ region });
  }

  if (profile) {
    AWS.config.credentials = new AWS.SharedIniFileCredentials({
      profile
    });
  }

  if (role) {
    AWS.config.credentials = new AWS.TemporaryCredentials({
      RoleArn: role
    });
  }
}

function loadLocalEnvs(envFile) {
  let _dotenv;
  try {
    _dotenv = dotenv.parse(fs.readFileSync(envFile));
  }
  catch (e) {
    if (e.message.includes('ENOENT')) {
      console.log('.env file is missing');
    }
    else {
      throw e;
    }
  }

  // load all env variables to an object
  return Object.assign(process.env, _dotenv);
}

function getZipName(handler) {
  return handler.split('.')[0];
}

module.exports = {
  exec,
  getZipName,
  configureAws,
  loadLocalEnvs
};
