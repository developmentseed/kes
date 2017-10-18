'use strict';

const test = require('ava');
const { Config, utils } = require('../index');
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
  t.is(config.lambdas.length, 2);
  t.is(config.lambdas[0].fullName, 'my-kes-project-func1');
  t.is(Object.keys(config.lambdas[0].envs).length, 0);
  t.is(config.lambdas[1].envs.CUSTOM_ENV, 'myValue');
});

test('create a config instance with non default deployment', (t) => {
  const config = new Config({
    kesFolder: 'examples/lambdas',
    deployment: 'production',
    region: 'us-east-3'
  });

  t.is(config.stack, 'my-kes-project-prod');
  t.is(config.region, 'us-east-3');
});
