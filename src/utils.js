'use strict';

const fs = require('fs-extra');
const dotenv = require('dotenv');
const AWS = require('aws-sdk');
const execSync = require('child_process').execSync;

/**
 * Executes shell commands synchronously and logs the
 * stdout to console.
 * @param  {String} cmd  Bash command
 * @return {String}     The command's stdout
 */
function exec(cmd, verbose) {
  verbose = verbose === false ? verbose : true;

  const stdout = execSync(cmd);
  if (verbose) {
    console.log(stdout.toString());
  }
  return stdout;
}

function configureAws(region = 'us-east-1', profile = null) {
  if (profile) {
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    AWS.config.credentials = credentials;
  }
  AWS.config.update({ region });
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
  return handler.replace(/(-|\.)/g, '_');
}

module.exports = {
  exec,
  getZipName,
  configureAws,
  loadLocalEnvs
};
