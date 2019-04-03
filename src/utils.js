'use strict';

const fs = require('fs-extra');
const get = require('lodash.get');
const path = require('path');
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

/**
 * Attempt to load a Kes override class.
 *
 * Throw the error if it is something other than that the Kes override
 * class does not exist.
 *
 * @param {string} kesFolder - The folder to look in for a Kes override class
 * @param {string} kesClass - The path/filename to look for as a Kes override class
 * @returns {Class} - A Kes override class
 */
function loadKesOverride(kesFolder, kesClass = 'kes.js') {
  let kesOverridePath = path.resolve(kesFolder, kesClass);
  let KesOverride;

  try {
    KesOverride = require(kesOverridePath);
  }
  catch (e) {
    // If the Kes override file exists, then the error occured when
    // trying to parse the file, so re-throw and prevent Kes from
    // going further.
    const fileExists = fs.existsSync(kesOverridePath);
    if (fileExists) {
      throw e;
    }

    console.log(`No Kes override found at ${kesOverridePath}, continuing`);
  }

  return KesOverride;
}

/**
 * Based on the information passed from the CLI by the commander
 * module this function determines whether to use the default Kes class
 * or use the override class provided by the user
 *
 * @param {object} options The options passed by the commander library
 * @param {Class} Kes the default kes class
 * @returns {Class} Kes class
 */
function determineKesClass(options, Kes) {
  let KesOverride;

  // If there is a kes class specified, use that
  const kesClass = get(options, 'kesClass');
  if (kesClass) {
    KesOverride = loadKesOverride(process.cwd(), kesClass);
  }
  else {
    let kesFolder;

    // Check if there is kes.js in the kes folder
    if (options.kesFolder) {
      kesFolder = options.kesFolder;
    }
    else {
      kesFolder = path.join(process.cwd(), '.kes');
    }
    KesOverride = loadKesOverride(kesFolder);

    // If the first Kes override didn't load, check if there is
    // a kes.js in the template folder.
    if (!KesOverride) {
      const template = get(options, 'template', '/path/to/nowhere');
      kesFolder = path.join(process.cwd(), template);
      KesOverride = loadKesOverride(kesFolder);
    }
  }

  return KesOverride || Kes;
}

/**
 * In case of error logs the error and exit with error 1
 * @param {Error} e error object
 */
function failure(e) {
  if (e.message) {
    console.log(e.message);
  }
  else {
    console.log(e);
  }
  process.exit(1);
}

/**
 * Exists the process when called
 */
function success() {
  process.exit(0);
}

/**
 * Discover and returns the system bucket used for deployment
 *
 * @param {Object} config - cumulus config object
 * @returns {string} name of the bucket
 */
function getSystemBucket(config) {
  let bucket = get(config, 'buckets.internal');
  if (bucket && typeof bucket === 'string') {
    return bucket;
  }

  bucket = get(config, 'system_bucket');
  if (bucket && typeof bucket === 'string') {
    return bucket;
  }
  return undefined;
}

module.exports = {
  exec,
  mergeYamls,
  fileToString,
  getZipName,
  configureAws,
  loadLocalEnvs,
  determineKesClass,
  getSystemBucket,
  failure,
  success,
  zip
};
