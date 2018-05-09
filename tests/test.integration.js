'use strict';

const test = require('ava');
const spawn = require('child_process').spawn;

function runCfCommand(cmd, kesFolder, deployment, template) {
  const argument = [
    'cf',
    cmd,
    '--kes-folder',
    kesFolder,
    '--region',
    'us-east-1',
    '--yes'
  ];

  if (deployment) {
    argument.push('--deployment');
    argument.push(deployment);
  }

  if (template) {
    argument.push('--template');
    argument.push(template);
  }

  if (process.env.AWS_PROFILE) {
    argument.push('--profile');
    argument.push(process.env.AWS_PROFILE);
  }

  return spawn('./bin/cli.js', argument);
}

test.serial.cb('create and delete full example with a template', (t) => {
  const deploy = runCfCommand(
    'deploy',
    'examples/app_using_template',
    'kesTestDeployment',
    'examples/lambdas'
  );

  deploy.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  deploy.on('close', (code) => {
    t.is(code, 0);

    // run the delete after deployment success
    const del = runCfCommand(
      'delete',
      'examples/app_using_template',
      'kesTestDeployment',
      'examples/lambdas'
    );

    del.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    del.on('close', (code) => {
      t.is(code, 0);
      t.end();
    });
  });
});

test.serial.cb('create and delete the lambdas example', (t) => {
  const deploy = runCfCommand(
    'deploy',
    'examples/lambdas',
    'kesTestDeployment'
  );

  deploy.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  deploy.on('close', (code) => {
    t.is(code, 0);

    // run the delete after deployment success
    const del = runCfCommand(
      'delete',
      'examples/lambdas',
      'kesTestDeployment'
    );

    del.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    del.on('close', (code) => {
      t.is(code, 0);
      t.end();
    });
  });
});
