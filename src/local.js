'use strict';

const isLocal = process.argv[2] === 'local';

module.exports.localRun = (func) => {
  if (isLocal) {
    // Run the function
    return func();
  }
};
