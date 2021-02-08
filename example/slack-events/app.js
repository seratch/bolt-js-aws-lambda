const { App } = require('@slack/bolt');
const { AwsLambdaReceiver } = require('bolt-aws-lambda');

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver,
});

app.command("/hello-bolt-js", async ({ ack }) => {
  await ack("I'm working!");
});

module.exports.main = receiver.toHandler();
