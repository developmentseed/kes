'use strict';

function Kes() {}

Kes.prototype.common = require('./src/common');
Kes.prototype.cf = require('./src/cf');
Kes.prototype.lambda = require('./src/lambda');
Kes.prototype.dynamo = require('./src/dynamo');
Kes.prototype.envs = require('./src/envs');
Kes.prototype.bootstrap = require('./src/bootstrap');

module.exports = Kes;
