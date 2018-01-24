'use strict';

const fs = require('fs-extra');
const archiver = require('archiver');
const yaml = require('js-yaml');
const yamlfiles = require('yaml-files');
const merge = require('lodash.merge');
const dotenv = require('dotenv');
const AWS = require('aws-sdk');
const execSync = require('child_process').execSync;

/**
 * Zips a list of files or directories
 * @param  {string} zipFile filename and path where the zip file is stored
 * @param  {array} srcList array of files and directories paths
 * @param  {type} dstPath for directories whether to put the directories at
 *                        root of the zip file or relative to your path on the local machine
 * @return {Promise}
 */
function zip(zipFile, srcList, dstPath) {
  if (!dstPath) {
    dstPath = false;
  }
  const output = fs.createWriteStream(zipFile);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  return new Promise((resolve, reject) => {
    output.on('close', function() {
      return resolve();
    });

    archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        console.log(err);
      }
      else {
        return reject(err);
      }
    });

    archive.on('error', function(err) {
      return reject(err);
    });

    archive.pipe(output);

    srcList.forEach((src) => {
      const stat = fs.lstatSync(src);

      if (stat.isFile()) {
        archive.file(src);
      }
      else if (stat.isDirectory() || stat.isSymbolicLink()) {
        archive.directory(src, dstPath);
      }
      else {
        return reject(new Error('Invalid path'));
      }
    });

    archive.finalize();
  });
}

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
function configureAws(region, profile, role) {
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
    if (!e.message.includes('ENOENT')) {
      throw e;
    }
  }

  // load all env variables to an object
  return Object.assign(process.env, _dotenv);
}

function getZipName(handler) {
  return handler.split('.')[0];
}

/**
 * Checks if the input is a file, if it is a file,
 * it reads it and return the content, otherwise just pass
 * the input as an output
 *
 * @param {String} file A file path or a string
 * @returns {String} String content of a given file
 */

function fileToString(file) {
  try {
    const stat = fs.lstatSync(file);

    if (stat.isFile()) {
      const content = fs.readFileSync(file, 'utf8');
      return content.toString();
    }
  }
  catch (e) {
    if (!e.message.includes('ENOENT') && !e.message.includes('name too long, lstat')) {
      throw e;
    }
  }
  return file;
}

/**
 * Merges two yaml files. The merge is done using lodash.merge
 * and it happens recursively. Meaning that values of file2 will
 * replace values of file 1 if they have the same key.
 *
 * @param {String} file1 Yaml path to file 1 or file 1 string
 * @param {String} file2 Yaml path to file 2 or file 2 string
 * @returns {String} Merged Yaml file in string format
 */

function mergeYamls(file1, file2) {
  const obj1 = yaml.safeLoad(fileToString(file1), { schema: yamlfiles.YAML_FILES_SCHEMA });
  const obj2 = yaml.safeLoad(fileToString(file2), { schema: yamlfiles.YAML_FILES_SCHEMA });

  return yaml.safeDump(merge({}, obj1, obj2));
}

module.exports = {
  exec,
  mergeYamls,
  fileToString,
  getZipName,
  configureAws,
  loadLocalEnvs,
  zip
};
