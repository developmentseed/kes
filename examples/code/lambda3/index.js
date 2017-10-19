'use strict'

function handler(event, context, cb) {
  console.log('sample lambda fuction that does nothing');
  return cb();
}

module.exports.handler = handler;
