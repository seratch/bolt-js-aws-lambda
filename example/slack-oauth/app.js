const { App, ExpressReceiver } = require('@slack/bolt');
const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const s3InstallationStore = {
  storeInstallation: async (installation) => {
    const enterpriseId = installation.enterprise ? installation.enterprise.id : 'none';
    const teamId = installation.team ? installation.team.id : 'none';
    await s3.putObject({
      Bucket: process.env.SLACK_INSTALLATION_S3_BUCKET_NAME,
      Key: `${enterpriseId}-${teamId}`,
      Body: JSON.stringify(installation),
    }, (err, data) => {
      if (err) console.log(err, err.stack);
      else console.log(data);
    }).promise();
  },
  fetchInstallation: async (query) => {
    const enterpriseId = query.enterpriseId ? query.enterpriseId : 'none';
    const teamId = query.teamId ? query.teamId : 'none';
    const key = query.isEnterpriseInstall ? `${enterpriseId}-none` : `${enterpriseId}-${teamId}`;
    const res = await s3.getObject({
      Bucket: process.env.SLACK_INSTALLATION_S3_BUCKET_NAME,
      Key: key,
    }, (err, data) => {
      if (err) console.log(err, err.stack);
      else console.log(data);
    }).promise();
    return JSON.parse(res.Body.toString('utf-8'));
  },
};

// Slack Event Handler
const { AwsLambdaReceiver } = require('bolt-aws-lambda');

const eventReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
const app = new App({
  receiver: eventReceiver,
  authorize: async (source) => {
    try {
      const queryResult = await s3InstallationStore.fetchInstallation(source);
      if (queryResult === undefined) {
        throw new Error('Failed fetching data from the Installation Store');
      }

      const authorizeResult = {};
      authorizeResult.userToken = queryResult.user.token;
      if (queryResult.team !== undefined) {
        authorizeResult.teamId = queryResult.team.id;
      } else if (source.teamId !== undefined) {
        authorizeResult.teamId = source.teamId;
      }
      if (queryResult.enterprise !== undefined) {
        authorizeResult.enterpriseId = queryResult.enterprise.id;
      } else if (source.enterpriseId !== undefined) {
        authorizeResult.enterpriseId = source.enterpriseId;
      }
      if (queryResult.bot !== undefined) {
        authorizeResult.botToken = queryResult.bot.token;
        authorizeResult.botId = queryResult.bot.id;
        authorizeResult.botUserId = queryResult.bot.userId;
      }
      return authorizeResult;
    } catch (error) {
      throw new Error(error.message);
    }
  },
});

app.command("/hello-bolt-js", async ({ ack }) => {
  await ack("I'm working!");
});

module.exports.eventHandler = eventReceiver.toHandler();

// OAuth Flow
const expressReceiver = new ExpressReceiver({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  scopes: process.env.SLACK_SCOPES ? process.env.SLACK_SCOPES.split(',') : '',
  stateSecret: 'my-secret',
  installationStore: s3InstallationStore
});
const awsServerlessExpress = require('aws-serverless-express');
const server = awsServerlessExpress.createServer(expressReceiver.app);
module.exports.oauthHandler = (event, context) => {
  awsServerlessExpress.proxy(server, event, context);
}
