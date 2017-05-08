'use strict';
const envs = require('./envs');

const isLocal = process.argv[2] === 'local';
const isRemote = process.argv[2] === 'remote';

module.exports.localRun = (func, stage) => {
  stage = stage || 'dev';
  if (isLocal || isRemote) {
    process.env.IS_LOCAL = isLocal;

    // set local env variables
    envs.setEnvs(stage);

    // Read .env file if it exists
    envs.loadCredentials();

    // Run the function
    func();
  }
};
