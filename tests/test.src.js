'use strict';

const test = require('ava');
const yaml = require('js-yaml');
const has = require('lodash.has');
const Config = require('../index').Config;
const utils = require('../index').utils;
const AWS = require('aws-sdk');

test('should load local env variables', (t) => {
  const envs = utils.loadLocalEnvs('examples/lambdas/.env');
  t.is(process.env.TIMEOUT, '100');
  t.is(envs.TIMEOUT, '100');
});

test('should not error when env file doesnt exist', (t) => {
  const envs = utils.loadLocalEnvs('blahblah/.env');
  t.true(envs.PATH !== undefined);
});

test('Get the filename from the handler', (t) => {
  let r = utils.getZipName('my-lambda.zip');
  t.is(r, 'my-lambda');

  r = utils.getZipName('my-lambda.jpg.zip');
  t.is(r, 'my-lambda');
});

test('Test reading a file as string', (t) => {
  let r = utils.fileToString('README.md');
  t.true(r.includes('# Kes'));

  r = utils.fileToString('some random text');
  t.is(r, 'some random text');
});

test('Test merging yaml files', (t) => {
  let merged = utils.mergeYamls('tests/data/file1.yaml', 'tests/data/file2.yaml');
  let obj = yaml.safeLoad(merged);

  t.is(obj.secondKey, 'value5');
  t.is(obj.forthKey.length, 3);
  t.is(obj.forthKey[0], 'value4');
  t.is(obj.thirdKey.firstKey, 'value10');

  merged = utils.mergeYamls('tests/data/file2.yaml', 'tests/data/file1.yaml');
  obj = yaml.safeLoad(merged);

  t.is(obj.secondKey, 'value2');
  t.is(obj.forthKey.length, 3);
  t.is(obj.forthKey[0], 'value1');
});

test('configuring aws', (t) => {
  utils.configureAws('us-west-2');
  t.is(AWS.config.region, 'us-west-2');

  utils.configureAws(null, 'myProfile');
  t.is(AWS.config.credentials.profile, 'myProfile');

  utils.configureAws(null, null, 'myRole');
  t.is(AWS.config.credentials.params.RoleArn, 'myRole');
});

test('create a config instance', (t) => {
  const config = new Config({
    kesFolder: 'examples/lambdas'
  });

  t.is(config.stack, 'my-kes-project');
  t.is(Object.keys(config.lambdas).length, 3);
  t.is(config.lambdas.func1.fullName, 'my-kes-project-func1');

  // make sure envs are added even if lambdas don't include them
  t.is(Object.keys(config.lambdas.func1.envs).length, 0);
  t.is(config.lambdas.func2.envs.CUSTOM_ENV, 'myValue');
});

test('create a config instance with non default deployment', (t) => {
  const config = new Config({
    kesFolder: 'examples/lambdas',
    deployment: 'kesTestDeployment',
    region: 'us-east-3'
  });

  t.is(config.stack, 'kes-test-project-prod');
  t.is(config.region, 'us-east-3');
});

test('test api gateway configuration', (t) => {
  const config = new Config({
    kesFolder: 'examples/full'
  });

  t.is(config.lambdas.length, 5);
  t.true(has(config, 'apiMethods'));
  t.true(has(config, 'apiResources'));
  t.true(has(config, 'apiMethodsOptions'));
  t.true(has(config, 'apiDependencies'));
});

test('passing variables as configuration values', (t) => {
  const config1 = new Config({
    kesFolder: 'examples/full'
  });

  t.is(config1.sqs[0].retry, '10');

  const config2 = new Config({
    kesFolder: 'examples/full',
    deployment: 'staging'
  });

  t.is(config2.sqs[0].retry, '20');
});

test('config with template', (t) => {
  const config = new Config({
    kesFolder: 'examples/app_using_template',
    template: 'examples/template',
    deployment: 'kesTestDeployment'
  });

  t.is(config.stackName, 'kes-test-using-template');
  t.is(config.bucket, 'devseed-kes-deployment');
  t.is(config.bucket, config.system_bucket);
});

test('apiMethods will accept custom parameters', (t) => {
  const config = new Config({
    kesFolder: 'examples/lambdas_api'
  });

  t.true(config.apiMethods[0].extra_prop);
});
