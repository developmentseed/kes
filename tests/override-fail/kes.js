'use strict';

const { Kes } = require('../../index');
// Intentionally requiring a non-existent path so that Kes will throw
// an error when trying to require this file as a Kes override.
const test = require('./non-existent-path');

class BetterKes extends Kes {
  opsStack(ops) {
    return super.opsStack(ops)
      .then(() => this.describeCF())
      .then((r) => {
        const outputs = r.Stacks[0].Outputs;
        outputs.forEach(o => console.log(`${o.OutputKey}: ${o.OutputValue}`));
      });
  }
}

module.exports = BetterKes;
