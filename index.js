'use strict';

const deprecate = require('deprecate');
const Kes = require('./src/kes');
const Config = require('./src/config');
const utils = require('./src/utils');

const success = (r) => process.exit(0);

/**
 * Builds templates nested in the main template
 * using the specified config and cf file paths
 *
 * @param {object} config Kes config object
 * @param {object} KesClass the Kes Class
 * @param {object} options The options passed by the commander library
 * @return {Promise.<array} returns a promise of an array of CF urls uploaded to S3
 */
function buildNestedCfs(config, KesClass, options) {
  if (config.nested_templates) {
    console.log('Nested templates are found!');
    const ps = config.nested_templates.map((nested) => {
      console.log(`Compiling ${nested.cfFile}`);

      const newOptions = Object.assign({}, options);
      newOptions.cfFile = nested.cfFile;
      newOptions.configFile = nested.configFile;

      // no templates are used in nested stacks
      delete newOptions.template;

      // use the parent stackname
      newOptions.stack = config.stack;
      const nestedConfig = new Config(newOptions);
      nestedConfig.parent = config;

      if (!nestedConfig.bucket) {
        nestedConfig.bucket = config.buckets.internal;
      }
      const kes = new KesClass(nestedConfig);
      return kes.uploadCF();
    });
    return Promise.all(ps);
  }
  return Promise.resolve([]);
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
  const KesClass = utils.determineKesClass(options);
  const config = new Config(options);

  buildNestedCfs(config, KesClass, options).then((nestedPaths) => {
    console.log('\nCompiling the main template');

    if (nestedPaths && nestedPaths.length > 0) {
      config.nested_template_paths = nestedPaths;
    }
    const kes = new KesClass(config);
    switch (cmd) {
      case 'create':
        deprecate('"kes cf create" command is deprecated. Use "kes cf deploy" instead');
        kes.createStack().then(r => success(r)).catch(e => utils.failure(e));
        break;
      case 'update':
        deprecate('"kes cf update" command is deprecated. Use "kes cf deploy" instead');
        kes.updateStack().then(r => success(r)).catch(e => utils.failure(e));
        break;
      case 'upsert':
        deprecate('"kes cf upsert" command is deprecated. Use "kes cf deploy" instead');
        kes.upsertStack().then(r => success(r)).catch(e => utils.failure(e));
        break;
      case 'deploy':
        kes.deployStack().then(r => success(r)).catch(e => utils.failure(e));
        break;
      case 'validate':
        kes.validateTemplate().then(r => success(r)).catch(e => utils.failure(e));
        break;
      case 'compile':
        kes.compileCF().then(r => success(r)).catch(e => utils.failure(e));
        break;
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
    const KesClass = utils.determineKesClass(options);
    const config = new Config(options);
    const kes = new KesClass(config);
    kes.updateSingleLambda(cmd).then(r => success(r)).catch(e => utils.failure(e));
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
