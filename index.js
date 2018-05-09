'use strict';

const deprecate = require('deprecate');
const pLimit = require('p-limit');
const Kes = require('./src/kes');
const Config = require('./src/config');
const utils = require('./src/utils');

/**
 * Builds templates nested in the main template
 * using the specified config and cf file paths
 *
 * @param {object} config Kes config object
 * @param {object} KesClass the Kes Class
 * @param {object} options The options passed by the commander library
 * @return {Promise} returns a promise of an updated Kes config object
 */
function buildNestedCfs(config, KesClass, options) {
  const limit = pLimit(1);
  if (config.nested_templates) {
    const nested = config.nested_templates;
    console.log('Nested templates are found!');
    const ps = Object.keys(nested).map((name) => limit(() => {
      console.log(`Compiling nested template for ${name}`);

      const newOptions = Object.assign({}, options);
      newOptions.cfFile = nested[name].cfFile;
      newOptions.configFile = nested[name].configFile;

      // no templates are used in nested stacks
      delete newOptions.template;

      // use the parent stackname
      newOptions.stack = config.stack;
      newOptions.parent = config;
      const nestedConfig = new Config(newOptions);

      // get the bucket name from the parent
      if (!nestedConfig.bucket) {
        nestedConfig.bucket = utils.getSystemBucket(config);
      }

      // add nested deployment name
      nestedConfig.nested_cf_name = name;

      const kes = new KesClass(nestedConfig);
      return kes.uploadCF().then((uri) => {
        config.nested_templates[name].url = uri;
      });
    }));
    return Promise.all(ps)
      .then(() => config)
      .catch(utils.failure);
  }
  return Promise.resolve(config);
}

/**
 * Builds, uploads and deploy a Cloudformation based on options passed
 * from the commander library
 *
 * @param {object} options Options passed by the commander library
 * @param {string} cmd the argument selected in the CLI, e.g. deploy, update, etc.
 * @return {undefined}
 */
function buildCf(options, cmd) {
  const KesClass = utils.determineKesClass(options, Kes);
  let parentConfig;
  try {
    parentConfig = new Config(options);
  }
  catch (e) {
    return Promise.reject(e);
  }

  return buildNestedCfs(parentConfig, KesClass, options).then((config) => {
    const kes = new KesClass(config);
    switch (cmd) {
      case 'create':
        deprecate('"kes cf create" command is deprecated. Use "kes cf deploy" instead');
        return kes.createStack();
      case 'update':
        deprecate('"kes cf update" command is deprecated. Use "kes cf deploy" instead');
        return kes.updateStack();
      case 'upsert':
        deprecate('"kes cf upsert" command is deprecated. Use "kes cf deploy" instead');
        return kes.upsertStack();
      case 'deploy':
        return kes.deployStack();
      case 'validate':
        return kes.validateTemplate();
      case 'compile':
        return kes.compileCF();
      case 'delete':
        return kes.deleteStack();
      default:
        console.log('Wrong choice. Accepted arguments: [create|update|upsert|deploy|validate|compile]');
    }
  });
}

/**
 * Builds and uploads a lambda function based on the options passed by the commander
 * @param {object} options Options passed by the commander library
 * @param {string} cmd the argument selected in the CLI, e.g. lambda name
 * @return {undefined}
 */
function buildLambda(options, cmd) {
  if (cmd) {
    const KesClass = utils.determineKesClass(options, Kes);
    const config = new Config(options);
    const kes = new KesClass(config);
    kes.updateSingleLambda(cmd).then(r => utils.success(r)).catch(e => utils.failure(e));
  }
  else {
    utils.failure(new Error('Lambda name is missing'));
  }
}

module.exports = {
  Kes,
  Config,
  utils,
  buildCf,
  buildLambda,
  Lambda: require('./src/lambda'),
  local: require('./src/local')
};
