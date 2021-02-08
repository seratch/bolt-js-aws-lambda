import { Logger, ConsoleLogger, LogLevel } from '@slack/logger';
import querystring from 'querystring';
import crypto from 'crypto';
import tsscmp from 'tsscmp';
import { App, Receiver, ReceiverEvent, ReceiverMultipleAckError } from '@slack/bolt';

export interface AwsEvent {
  body: string | null;
  headers: any;
  multiValueHeaders: any;
  httpMethod: string;
  isBase64Encoded: boolean;
  path: string;
  pathParameters: any | null;
  queryStringParameters: any | null;
  multiValueQueryStringParameters: any | null;
  stageVariables: any | null;
  requestContext: any;
  resource: string;
}

export type AwsCallback = (error?: Error | string | null, result?: any) => void;

export interface AwsResponse {
  statusCode: number;
  headers?: {
    [header: string]: boolean | number | string;
  };
  multiValueHeaders?: {
    [header: string]: Array<boolean | number | string>;
  };
  body: string;
  isBase64Encoded?: boolean;
}

export type AwsHander = (
  event: AwsEvent,
  context: any,
  callback: AwsCallback,
) => void | Promise<AwsResponse>;

export interface AwsLambdaReceiverOptions {
  signingSecret: string;
  logger?: Logger;
  logLevel?: LogLevel;
}

export interface AwsLambdaReceiverInstallerOptions {
  installPath?: string;
  redirectUriPath?: string;
}

export default class AwsLambdaReceiver implements Receiver {

  private signingSecret: string;

  private app?: App;

  private logger: Logger;

  constructor({
    signingSecret = '',
    logger = undefined,
    logLevel = LogLevel.INFO,
  }: AwsLambdaReceiverOptions) {
    // Initialize instance variables, substituting defaults for each value
    this.signingSecret = signingSecret;
    this.logger = logger ?? (() => {
      const defaultLogger = new ConsoleLogger();
      defaultLogger.setLevel(logLevel);
      return defaultLogger;
    })();
  }

  public init(app: App) {
    this.app = app;
  }

  public start(): Promise<AwsHander> {
    return new Promise((resolve, reject) => {
      try {
        const handler = this.toHandler();
        resolve(handler);
      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, _reject) => {
      resolve();
    });
  }

  public toHandler(): AwsHander {
    return async (
      awsEvent: AwsEvent,
      _awsContext: any,
      _awsCallback: AwsCallback): Promise<AwsResponse> => {

      this.logger.debug(awsEvent);

      const rawBody: string = awsEvent.body ? awsEvent.body : '';
      const body: any = this.parseRequestBody(rawBody, awsEvent.headers['Content-Type'], this.logger);

      // ssl_check (for Slash Commands)
      if (body && body.ssl_check) {
        return Promise.resolve({ statusCode: 200, body: '' });
      }

      // request signature verification
      const signature = awsEvent.headers['X-Slack-Signature'] as string;
      const ts = Number(awsEvent.headers['X-Slack-Request-Timestamp']);
      if (!this.isValidRequestSignature(this.signingSecret, rawBody, signature, ts)) {
        return Promise.resolve({ statusCode: 401, body: '' });
      }

      // url_verification (Events API)
      if (body && body.type && body.type === 'url_verification') {
        return Promise.resolve({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 'challenge': body.challenge })
        });
      }

      // Setup ack timeout warning
      let isAcknowledged = false;
      setTimeout(() => {
        if (!isAcknowledged) {
          this.logger.error(
            'An incoming event was not acknowledged within 3 seconds. ' +
            'Ensure that the ack() argument is called in a listener.',
          );
        }
      }, 3001);

      // Structure the ReceiverEvent
      let storedResponse;
      const event: ReceiverEvent = {
        body,
        ack: async (response) => {
          if (isAcknowledged) {
            throw new ReceiverMultipleAckError();
          }
          isAcknowledged = true;
          if (!response) {
            storedResponse = '';
          } else {
            storedResponse = response;
          }
        },
      };

      // Send the event to the app for processing
      try {
        await this.app?.processEvent(event);
        if (storedResponse !== undefined) {
          if (typeof storedResponse === 'string') {
            return { statusCode: 200, body: storedResponse };
          } else {
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(storedResponse)
            };
          }
        }
      } catch (err) {
        this.logger.error('An unhandled error occurred while Bolt processed an event');
        this.logger.debug(`Error details: ${err}, storedResponse: ${storedResponse}`);
        return { statusCode: 500, body: '' };
      }
      return { statusCode: 404, body: '' };
    };
  }

  private parseRequestBody(
    stringBody: string,
    contentType: string | undefined,
    logger: Logger,
  ): any {
    if (contentType === 'application/x-www-form-urlencoded') {
      const parsedBody = querystring.parse(stringBody);
      if (typeof parsedBody.payload === 'string') {
        return JSON.parse(parsedBody.payload);
      } else {
        return parsedBody;
      }
    } else if (contentType === 'application/json') {
      return JSON.parse(stringBody);
    } else {
      logger.warn(`Unexpected content-type detected: ${contentType}`);
      try {
        // Parse this body anyway
        return JSON.parse(stringBody);
      } catch (e) {
        logger.error(`Failed to parse body as JSON data for content-type: ${contentType}`);
        throw e;
      }
    }
  }

  private isValidRequestSignature(
    signingSecret: string,
    body: string,
    signature: string,
    requestTimestamp: number
  ): boolean {

    if (!signature || !requestTimestamp) {
      return false;
    }

    // Divide current date to match Slack ts format
    // Subtract 5 minutes from current time
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (60 * 5);
    if (requestTimestamp < fiveMinutesAgo) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', signingSecret);
    const [version, hash] = signature.split('=');
    hmac.update(`${version}:${requestTimestamp}:${body}`);
    if (!tsscmp(hash, hmac.digest('hex'))) {
      return false;
    }

    return true;
  }
}