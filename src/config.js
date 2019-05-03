'use strict';

const fs = require('fs');
const path = require('path');
const get = require('lodash.get');
const has = require('lodash.has');
const values = require('lodash.values');
const startsWith = require('lodash.startswith');
const replace = require('lodash.replace');
const upperFirst = require('lodash.upperfirst');
const capitalize = require('lodash.capitalize');
const merge = require('lodash.merge');
const yaml = require('js-yaml');
const yamlfiles = require('yaml-files');
const Mustache = require('mustache');
const utils = require('./utils');

/**
 * This class handles reading and parsing configuration files.
 * It primarily reads `config.yml` and `.env` files
 *
 * @example
 * const config = new Config('mystack', 'dev', '.kes/config.yml', '.kes/.env');
 *
 * @param {String} stack Stack name
 * @param {String} deployment Deployment name
 * @param {String} configFile path to the config.yml file
 * @param {String} envFile path to the .env file (optional)
 *
 *
 * @param {Object} options a js object that includes required options.
 * @param {String} [options.stack] the stack name
 * @param {String} [options.deployment=null] the deployment name
 * @param {String} [options.region='us-east-1'] the aws region
 * @param {String} [options.profile=null] the profile name
 * @param {String} [options.kesFolder='.kes'] the path to the kes folder
 * @param {String} [options.configFile='config.yml'] the path to the config.yml
 * @param {String} [options.envFile='.env'] the path to the .env file
 * @param {String} [options.cfFile='cloudformation.template.yml'] the path to the CF template

 * @class Config
 */
class Config {
  //constructor(stack, deployment, configFile, envFile) {
  constructor(options) {
    this.region = get(options, 'region');
    this.profile = get(options, 'profile', null);
    this.deployment = get(options, 'deployment', 'default');
    this.role = get(options, 'role', process.env.AWS_DEPLOYMENT_ROLE);
    this.stack = get(options, 'stack', null);
    this.parent = get(options, 'parent', null);
    this.showOutputs = get(options, 'showOutputs', false);
    this.yes = get(options, 'yes', false);

    // use template if provided
    if (has(options, 'template')) {
      const templatePath = get(options, 'template');
      fs.lstatSync(templatePath);
      this.template = {
        baseName: path.basename(templatePath),
        kesFolder: templatePath,
        configFile: path.join(templatePath, 'config.yml'),
        cfFile: path.join(templatePath, 'cloudformation.template.yml')
      };
    }
    else {
      this.template = null;
    }

    this.kesFolder = get(options, 'kesFolder', path.join(process.cwd(), '.kes'));
    this.configFile = get(options, 'configFile', path.join(this.kesFolder, 'config.yml'));
    this.envFile = get(options, 'envFile', path.join(this.kesFolder, '.env'));
    this.cfFile = get(options, 'cfFile', path.join(this.kesFolder, 'cloudformation.template.yml'));

    this.envs = utils.loadLocalEnvs(this.envFile);
    this.parse();
  }

  /**
   * Generates configuration arrays for ApiGateway portion of
   * the CloudFormation
   *
   * @private
   * @static
   * @param  {Object} config The configuration object
   * @return {Object} Returns the updated configuration object
   */
  static configureApiGateway(config) {
    if (config.apis) {
      // APIGateway name used in AWS APIGateway Definition
      const apiMethods = [];
      const apiMethodsOptions = {};
      const apiDependencies = {};

      config.apis.forEach((api) => {
        apiDependencies[api.name] = [];
      });

      // The array containing all the info
      // needed to define each APIGateway resource
      const apiResources = {};

      // We loop through all the lambdas in config.yml
      // To construct the API resources and methods
      let lambdas = config.lambdas;
      if (!Array.isArray(config.lambdas)) {
        lambdas = Object.keys(config.lambdas).map(name => {
          const lambda = config.lambdas[name];
          lambda.name = name;
          return lambda;
        });
      }

      for (const lambda of lambdas) {
        // We only care about lambdas that have apigateway config
        if (lambda.hasOwnProperty('apiGateway')) {
          //loop the apiGateway definition
          for (const api of lambda.apiGateway) {
            // Because each segment of the URL path gets its own
            // resource and paths with the same segment shares that resource
            // we start by dividing the path segments into an array.
            // For example. /foo, /foo/bar and /foo/column create 3 resources:
            // 1. FooResource 2.FooBarResource 3.FooColumnResource
            // where FooBar and FooColumn are dependents of Foo
            const segments = api.path.split('/');

            // this array is used to keep track of names
            // within a given array of segments
            const segmentNames = [];

            segments.forEach((segment, index) => {
              let name = segment;
              let parents = [];

              // when a segment includes a variable, e.g. {short_name}
              // we remove the non-alphanumeric characters and add Var to the name
              if (startsWith(segment, '{')) {
                name = `${replace(segment, /\W/g, '')}Var`;
              }

              name = upperFirst(name);
              segmentNames.push(name);

              let firstParent = false;

              // the first segment is always have rootresourceid as parent
              if (index === 0) {
                parents = [
                  'Fn::GetAtt:',
                  `- ${api.api}RestApi`,
                  '- RootResourceId'
                ];
                firstParent = true;
              }
              else {
                // This logic finds the parents of other segments
                parents = [
                  `Ref: ApiGateWayResource${segmentNames.slice(0, index).join('')}`
                ];

                name = segmentNames.map(x => x).join('');
              }

              // We use an object here to catch duplicate resources
              // This ensures if to paths shares a segment, they also
              // share a parent
              apiResources[name] = {
                name: `ApiGateWayResource${name}`,
                pathPart: segment,
                parents: parents,
                firstParent,
                api: api.api
              };
            });

            const method = capitalize(api.method);
            const name = segmentNames.map(x => x).join('');

            const methodName = `ApiGatewayMethod${name}${capitalize(method)}`;

            // Build the ApiMethod array
            const methodObject = {
              name: methodName,
              method: method.toUpperCase(),
              cors: api.cors || false,
              resource: `ApiGateWayResource${name}`,
              lambda: lambda.name,
              api: api.api
            };
            // add any extra parameters of the api object
            apiMethods.push(Object.assign({}, api, methodObject));

            // populate api dependency list
            try {
              apiDependencies[api.api].push({
                name: methodName
              });
            }
            catch (e) {
              console.error(`${api.api} is not defined`);
              throw e;
            }

            // Build the ApiMethod Options array. Only needed for resources
            // with cors set to true
            if (api.cors) {
              apiMethodsOptions[name] = {
                name: `ApiGatewayMethod${name}Options`,
                resource: `ApiGateWayResource${name}`,
                api: api.api
              };
            }
          }
        }
      }

      return Object.assign(Config, {
        apiMethods,
        apiResources: values(apiResources),
        apiMethodsOptions: values(apiMethodsOptions),
        apiDependencies: Object.keys(apiDependencies).map(k => ({
          name: k,
          methods: apiDependencies[k]
        }))
      });
    }

    return config;
  }

  /**
   * Sets default values for the lambda function.
   * if the lambda function includes source path, it does copy, zip and upload
   * the functions to Amazon S3
   *
   * @private
   * @static
   * @param  {Object} config The configuration object
   * @return {Object} Returns the updated configuration object
   */
  static configureLambda(config) {
    if (config.lambdas) {
      // Add default memory and timeout to all lambdas
      let lambdas = config.lambdas;
      if (!Array.isArray(config.lambdas)) {
        lambdas = Object.keys(config.lambdas).map(name => {
          const lambda = config.lambdas[name];
          lambda.name = name;
          return lambda;
        });
      }

      for (const lambda of lambdas) {
        if (!has(lambda, 'memory')) {
          lambda.memory = 1024;
        }

        if (!has(lambda, 'timeout')) {
          lambda.timeout = 300;
        }

        // add lambda name to services if any
        if (lambda.hasOwnProperty('services')) {
          for (const service of lambda.services) {
            service.lambdaName = lambda.name;
          }
        }

        if (!has(lambda, 'envs')) {
          lambda.envs = {};
        }

        // lambda fullName
        lambda.fullName = `${config.stackName}-${lambda.name}`;
      }
    }

    return config;
  }

  mustacheRender(obj, values) {
    const tmp = JSON.stringify(obj);
    const rendered = Mustache.render(tmp, values);
    return JSON.parse(rendered);
  }

  readConfigFile() {
    if (this.template) {
      return utils.mergeYamls(this.template.configFile, this.configFile);
    }

    return fs.readFileSync(this.configFile, 'utf8');
  }

  /**
   * Parses the config.yml
   * It uses the default environment values under config.yml and overrides them with values of
   * the select environment.
   *
   * @private
   * @return {Object} returns configuration object
   */
  parseConfig() {
    const configText = this.readConfigFile();
    Mustache.escape = (text) => text;

    // load, dump, then load to make sure all yaml included files pass through mustach render
    const parsedConfig = yaml.safeLoad(configText.toString(), { schema: yamlfiles.YAML_FILES_SCHEMA });

    let config = parsedConfig.default;

    // add parent to the config
    if (this.parent) {
      config.parent = this.parent;
    }

    if (this.deployment && parsedConfig[this.deployment]) {
      config = merge(config, parsedConfig[this.deployment]);
    }
    else {
      throw new Error(`Deployment ${this.deployment} was not found in the kes configuration file.`);
    }

    // doing this twice to ensure variables in child yml files are also parsed and replaced
    config = this.mustacheRender(config, merge({}, config, this.envs));
    config = this.mustacheRender(config, merge({}, config, this.envs));

    if (this.stack) {
      config.stackName = this.stack;
    }
    else {
      this.stack = config.stackName;
    }

    config = this.constructor.configureLambda(config);
    return merge(config, this.constructor.configureApiGateway(config));
  }

  /**
   * Main method of the class. It parses a configuration and returns it
   * as a JS object.
   *
   * @example
   * const configInstance = new Config(null, null, 'path/to/config.yml', 'path/to/.env');
   * config = configInstance.parse();
   *
   * @return {Object} the configuration object
   */
  parse() {
    const config = this.parseConfig();
    this.bucket = utils.getSystemBucket(config);

    // merge with the instance
    merge(this, config);
  }

  /**
   * Return a javascript object (not a class instance) of the
   * config class
   *
   * @return {object} a javascript object version of the class
   */
  flatten() {
    const newObj = {};
    Object.keys(this).forEach((k) => {
      newObj[k] = this[k];
    });
    return newObj;
  }
}

module.exports = Config;
