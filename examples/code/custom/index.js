// source code is from here: http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/walkthrough-custom-resources-lambda-lookup-amiids.html
'use strict';

function handler(event, context, cb) {
  console.log('REQUEST RECEIVED:\n' + JSON.stringify(event));

  // For Delete requests, immediately send a SUCCESS response.
  if (event.RequestType === 'Delete') {
    sendResponse(event, context, 'SUCCESS');
    return;
  }

  const responseStatus = 'SUCCESS';
  const responseData = {};

  sendResponse(event, context, responseStatus, responseData);
}

// Send response to the pre-signed S3 URL
function sendResponse(event, context, responseStatus, responseData) {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  });

  console.log('RESPONSE BODY:\n', responseBody);

  const https = require('https');
  const url = require('url');

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };

  console.log('SENDING RESPONSE...\n');

  const request = https.request(options, function(response) {
    console.log('STATUS: ' + response.statusCode);
    console.log('HEADERS: ' + JSON.stringify(response.headers));
    // Tell AWS Lambda that the function execution is done
    context.done();
  });

  request.on('error', function(error) {
    console.log('sendResponse Error:' + error);
    // Tell AWS Lambda that the function execution is done
    context.done();
  });

  // write data to request body
  request.write(responseBody);
  request.end();
}

module.exports.handler = handler;
