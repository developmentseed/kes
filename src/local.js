'use strict';

const isLocal = process.argv[2] === 'local';

/**
 * A simple helper for running a function if `local` is passed as argument
 * @example
 * // test.js
 * const { localRun } = require('kes');
 * localRun(() => {
 *   console.log('my function');
 * });
 * // result
 * // $ node test.js local
 * // my function
 *
 * @param {Function} func A javascript function
 * @return {Object} returns the result of the function call
 */
module.exports.localRun = (func) => {
  if (isLocal) {
    // Run the function
    return func();
  }
};
