#!/bin/bash

current_dir=`dirname $0`
cd ${current_dir}
sam build
sam deploy --guided --parameter-overrides "SlackSigningSecret=${SLACK_SIGNING_SECRET} SlackBotToken=${SLACK_BOT_TOKEN} SlackClientId=${SLACK_CLIENT_ID} SlackClientSecret=${SLACK_CLIENT_SECRET} SlackScopes=${SLACK_SCOPES} SlackInstallationS3BucketName=${SLACK_INSTALLATION_S3_BUCKET_NAME}"
