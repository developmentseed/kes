## Kes: Make deployment with CloudFormation fun

This is a library for managing and deploying AWS resources using CloudFormation. It is specifically designed to work with API Gateway and Lambda functions and includes `Hapi` server for simulating API Gateway on a local machine.

### Installation

    $ npm install

### Usage

Kes expects a particular folder structure to operate properly:

- The cloudformation template and config files should be stored at `.kes` folder.
- All lambdas functions must be stored in their own folders under `build/lambda`
- We recommend using webpack, gulp or similar tools to bundle each lambda's code

#### Add config.yml

Use an example provided in the `examples` folder.

#### Add cloudformation.template.yml

Use an example provided in the `examples` folder. Kes generates a cloudformation.yml file that is stored in the same `.kes` folder. There is no need to commit this file and can safely be added to `.gitignore`


#### Commands

- Create a new cloudformation stack `kes cf create --stage dev`
- Update an existing cloudformation stack `kes cf update --stage dev`
- Update a particular lambda `kes lambda myLambdaName`

