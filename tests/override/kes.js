'use strict';

const { Kes } = require('../../index');

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
