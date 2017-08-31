/**
 * # Kes: Making deployment with CloudFormation Fun
 *
 * Kes helps with managing and deploying AWS resources using CloudFormation.
 *
 * It makes much easier to deploy lambda functions and create API gateway resources.
 *
 * ## Installation
 *
 * ```bash
 *   $ npm install -g kes
 *   $ kes -h
 *
 *    Usage: kes TYPE COMMAND [options]
 *    Commands:

 *      cf [create|update|validate|compile]  CloudFormation Operations:
 *        create    Creates the CF stack
 *        update    Updates the CF stack
 *        validate  Validates the CF stack
 *        compile   Compiles the CF stack
 *      lambda <lambdaName>                  uploads a given lambda function to Lambda service
 *
 *    Start a Kes project
 *
 *    Options:
 *
 *      -h, --help                    output usage information
 *      -p, --profile <profile>       AWS profile name to use for authentication
 *      -c, --config <config>         Path to config file
 *      --stage-file <stageFile>      Path to config file
 *      --env-file <envFile>          Path to env file
 *      --cf-file <cfFile>            Path to CloudFormation template
 *      --kes-flass <kesClass>        Kes Class override
 *      -k, --kes-folder <kesFolder>  Path to config folder
 *      -r, --region <region>         AWS region
 *      --stack <stack>               stack name, defaults to the config value
 *      --stage <stage>               stage name, defaults to the config value
 * ```
 *
 * ## Setting Up the First Project
 *
 * Go to your project directory and run the following command.
 *
 *  ```bash
 *  $ npm init
 *  ```
 *
 * This will create a `.kes` folder on your project folder. It will include the following files:
 *
 * | file | description
 * | ---- | -------------
 * |`.env`| This optional file can hold your project secrets and should not be committed
 * |`cloudformation.template.yml`| A base CF template written with Mustache/Handlebar templating language
 * |`config.yml`| The main required configuration file for a kes deployment
 * |`kes.js`| An optional Kes class override that can change how Kes class is used
 * |`stage.yml`| An optional stage configuration file that allow you to assign different values for each stage
 *
 * The `cloudformation.template.yml` and `config.yml` are required files.
 * The variables in `config.yml` are parsed and used to generate the `cloudformation.yml`
 * file which is sent to AWS CloudFormation to create and udpate the stack.
 *
 * ### CF Stack Name
 * The Cloudformation stack name is made from the `stackName` and `stage` variables in `config.yml` with a
 * dash in the middle.
 *
 * For example `my-stack` and `dev` creates `my-stack-dev` stack on cloudformation.
 *
 * ### Parameters
 *
 * To pass parameters to the CloudFormation template, use the `parameters` key in config.yml. Example:
 *
 * ```yaml
 * # config.yml
 * stackName: myStack
 * parameters:
 *   - name: MyParameter
 *     value: someValue
 * ```
 *
 * ```yaml
 * # cloudformation.template.yml
 * AWSTemplateFormatVersion: '2010-09-09'
 * Description: 'stack: {{stackName}} | stage: {{stage}} | deployed by Kes'
 * Parameters:
 *   MyParameter:
 *     Type: String
 *     Description: 'My parameter'
 * ```
 *
 * ### CF Capabailities
 *
 * To pass capabilities such as `CAPABILITY_IAM` use `capabilities` key:
 *
 * ```yaml
 * # config.yml
 * stackName: myStack
 * parameters:
 *   - name: MyParameter
 *     value: someValue
 * capabilities:
 *   - CAPABILITY_IAM
 * ```
 *
 * ### Lambda Functions
 * To add lambda functions, use `lambdas` key and add them as array object.
 * The lambda function code can be either a folder or file on your computer
 * or a zip file on aws.
 *
 * **Required Fields:**
 *   - name
 *   - handler
 *   - source/s3Source
 *
 * **Env Variables:**
 * You can add env variables to each lambda function as shown in the example below.
 * The `stackName` and `stage` are added automatically to all lambda functions
 *
 * **Example:**
 *
 * ```yaml
 * # config.yml
 * stackName: myStack
 * parameters:
 *   - name: MyParameter
 *     value: someValue
 * capabilities:
 *   - CAPABILITY_IAM
 *
 * lambdas:
 *   - name: myLambda1
 *     handler: myLambda.handler
 *     timeout: 200
 *     source: 'node_modules/someNpmPackage'
 *   - name: myLambda2
 *     handler: package.handler
 *     timeout:100
 *     s3Source:
 *       bucket: mybucket
 *       key: mylambda.zip
 *     envs:
 *       DEBUG: true
 * ```
 *
 * **Note:**
 *
 * Adding lambda functions in the config.yml has no effect unless you add
 * the relevant CF syntax to `cloudformation.template.yml`
 *
 * ### Handlebar Helpers
 * We use [Handlebar](http://handlebarsjs.com/) for templating a CF template.
 *
 * **Each**
 *
 * ```yaml
 * # config.yml
 * myArray:
 *   - name: name1
 *   - name: name2
 * ```
 *
 * ```yaml
 * # cloudformation.template.yml
 * Resources:
 *
 * {{# each myArray}}
 *   {{name}}:
 *     Type: SomeAWSResource
 * {{/each}}
 * ```
 *
 * **If/else**
 *
 * ```yaml
 * # config.yml
 * myArray:
 *   - name: name1
 *     runtime: python2.7
 *   - name: name2
 * ```
 *
 * ```yaml
 * # cloudformation.template.yml
 * Resources:
 *
 * {{# each myArray}}
 *   {{name}}:
 *     Type: SomeAWSResource
 *     Properties:
 *       Runtime: {{# if runtime}}{{runtime}}{{else}}nodejs6.10{{/if}}
 * {{/each}}
 * ```
 *
 * **Each for Objects**
 *
 * ```yaml
 * # config.yml
 * myArray:
 *   - DEBUG: true
 * ```
 *
 * ```yaml
 * # cloudformation.template.yml
 * Resources:
 *
 * {{# each myArray}}
 *   Lambda:
 *     Type: SomeAWSResource
 *     Properties:
 *       Environments:
 *         - {{@key}}: {{this}}
 * {{/each}}
 * ```
 *
 * ## Deployment
 *
 * ### create
 * To create a CF stack for the first time
 * ```bash
 *  kes cf create
 * ```
 *
 * ### update
 * To update an existing CF stack
 * ```bash
 *  kes cf update
 * ```
 *
 * ### Updating One Lambda Function
 * To update one lambda function outside of CF
 *
 * ```bash
 *  kes lambda myLambda
 * ```
 *
 */