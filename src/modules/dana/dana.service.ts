import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { danaConfig } from './dana.config';
import { AuthResponseDto, QrisPaymentDto } from './dana.dto';
import { DanaSignatureService } from './dana.signature';
import { UAParser } from 'ua-parser-js';
@Injectable()
export class DanaService {
  private readonly logger = new Logger(DanaService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private signatureService = new DanaSignatureService();
  private readonly httpService = new HttpService();

  /**
   * Authenticate with Dana API and get access token
   */
  async authenticate(): Promise<AuthResponseDto> {
    try {
      if (this.isTokenValid()) {
        console.log('VALID TOKEN');
        return {
          access_token: this.accessToken,
          token_type: 'Bearer',
          expires_in: Math.floor(
            (this.tokenExpiry.getTime() - Date.now()) / 1000,
          ),
        };
      }
      const apiPath = '/v1.0/access-token/b2b.htm';
      const timestamp = this.signatureService.getTimestamp();
      const signatureData = `${danaConfig.clientId}|${timestamp}`;

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );
      const requestBody = {
        grantType: 'client_credentials',
        additionalInfo: {},
      };

      const headers = {
        'Content-Type': 'application/json',
        'X-CLIENT-KEY': danaConfig.clientId,
        'X-SIGNATURE': signature,
        'X-TIMESTAMP': this.signatureService.getTimestamp(),
        'X-EXTERNAL-ID': crypto.randomUUID(),
        'CHANNEL-ID': '95221',
      };
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
          headers,
        }),
      );

      const authData = await response?.data;

      if (authData?.accessToken && authData?.expiresIn) {
        this.accessToken = authData.accessToken;
        this.tokenExpiry = new Date(Date.now() + authData.expiresIn * 1000);
      } else {
        console.error('Invalid auth response structure');
      }

      this.logger.log('Successfully authenticated with Dana API', authData);
      return authData;
    } catch (error) {
      console.error('AUTH ERR:', error);
      this.logger.error(
        `Authentication failed:`,
        error.response?.data || error.message || error,
      );
      throw new HttpException(
        `Authentication failed ${error.response?.data?.responseMessage || 'Authentication failed'} ${error.response?.data?.responseCode || '500'}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Check if access token is valid and not expired
   */
  async applyToken(): Promise<AuthResponseDto> {
    try {
      const apiPath = '/oauth/auth/applyToken.htm';
      const timestamp = this.signatureService.getTimestamp();

      const requestBody = {
        grantType: 'AUTHORIZATION_CODE',
        additionalInfo: {},
      };
      const headers = {
        version: 'application/json',
        function: 'dana.oauth.auth.applyToken',
        clientId: danaConfig.clientId,
        clientSecret: danaConfig.clientSecret,
        reqTime: timestamp,
        reqMsgId: crypto.randomUUID(),
      };
      const requestData = {
        request: {
          head: headers,
        },
        body: requestBody,
        signature: '',
      };

      const signature = this.signatureService.generateSignature(
        JSON.stringify(requestData.body),
        danaConfig.privateKey,
      );

      requestData.signature = signature;
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestData, {
          headers,
        }),
      );

      const authData = await response?.data;
      console.log('AUTH DATA:', response);
      if (authData?.accessToken && authData?.expiresIn) {
        this.accessToken = authData.accessToken;
        this.tokenExpiry = new Date(Date.now() + authData.expiresIn * 1000);
      } else {
        console.error('Invalid auth response structure');
      }

      this.logger.log('Successfully authenticated with Dana API', authData);
      return authData;
    } catch (error) {
      console.error('AUTH ERR:', error);
      this.logger.error(
        `Authentication failed:`,
        error.response?.data || error.message || error,
      );
      throw new HttpException(
        `Authentication failed ${error.response?.data?.responseMessage || 'Authentication failed'} ${error.response?.data?.responseCode || '500'}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  /**
   * QRIS MPM Generate
   */
  async getQrisPayment(reqHeaders: any, payload: any): Promise<QrisPaymentDto> {
    try {
      await this.authenticate();
      console.log(reqHeaders);
      console.log(payload);
      // Generate unique reference number if not provided
      const referenceNo = crypto.randomUUID();
      const userAgent = reqHeaders['user-agent'] || 'Unknown';
      const parser = new UAParser(userAgent);
      const uaResult = parser.getResult();
      const rawAmount = payload.amount;
      const amount = parseFloat(rawAmount).toFixed(2);
      const timestamp = this.signatureService.getTimestamp();
      const requestBody = {
        merchantId: danaConfig.merchantId,
        // subMerchantId: '',
        // storeId: '',
        partnerReferenceNo: referenceNo,
        amount: {
          value: amount,
          currency: 'IDR',
        }, // Make amount dynamic
        // feeAmount: { // merchantAppVersion: '1.0',
        //   value: '123.00',
        //   currency: currency,
        // },
        // validityPeriod: '2025-07-27T23:38:11+07:00',
        additionalInfo: {
          // terminalSource: 'MER',
          envInfo: {
            sourcePlatform: 'IPG',
            terminalType: 'SYSTEM',
            orderTerminalType: 'SYSTEM',
            clientIp: reqHeaders['x-client-ip'] || '127.0.0.1',
            osType: uaResult.os.name || 'UnknownOS',
            appVersion: uaResult.browser.version || '1.0',
            sdkVersion: '1.0',
            websiteLanguage: reqHeaders['x-language'] || 'en_US',
            orderOsType: uaResult.os.name || 'UnknownOS',
            merchantAppVersion: uaResult.browser.version || '1.0',
            // sessionId: sessionId, // Generate unique session ID
            // tokenId: tokenId, // Generate unique token ID
            /*extendInfo: JSON.stringify({
              deviceId: this.generateDeviceId(), // Generate unique device ID
              bizScenario: 'SAMPLE_MERCHANT_AGENT',
              description: description || 'Payment for order',
            }),*/
          },
        },
      };

      console.log('QRIS Request Body:', JSON.stringify(requestBody, null, 2));
      // const apiPath = '/v1.0/qr/qr-mpm-generate.htm';
      const apiPath = '/v1.0/qr/qr-mpm-generate.htm';

      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
        timestamp,
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      // const headers = this.generateHeaderCustomers(signature);
      const headers = {
        'Content-Type': 'application/json',
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': signature,
        'X-PARTNER-ID': danaConfig.clientId,
        'X-EXTERNAL-ID': referenceNo,
        'CHANNEL-ID': '11111',
        'Authorization-Customer': `Bearer ${this.accessToken}`,
      };

      console.log('QRIS Header:', headers);
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
          headers,
          timeout: 30000, // Add timeout
        }),
      );

      console.log('QRIS Response:', response.data);

      // Validate response
      if (!response.data || response.data.responseCode !== '2000000') {
        console.error(`DANA API Error:`, response.data.responseCode);
        throw new Error(
          `DANA API Error: ${response.data?.responseMessage || 'Unknown error'}`,
        );
      }

      return response.data;
    } catch (error) {
      const errMessage = JSON.stringify(error.response?.data || error.message);

      // console.error('Failed to get Qris:', errMessage);
      throw new HttpException(
        errMessage,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  /**
   * Payment Gateway Create Order
   */
  async createOrder(reqHeaders: any, payload: any): Promise<QrisPaymentDto> {
    try {
      await this.authenticate();
      console.log(reqHeaders);
      console.log(payload);
      // Generate unique reference number if not provided
      const referenceNo = crypto.randomUUID();
      const userAgent = reqHeaders['user-agent'] || 'Unknown';
      const parser = new UAParser(userAgent);
      const uaResult = parser.getResult();
      const rawAmount = payload.amount;
      const amount = parseFloat(rawAmount).toFixed(2);
      const timestamp = this.signatureService.getTimestamp();
      const requestBody = {
        partnerReferenceNo: referenceNo,
        merchantId: danaConfig.merchantId,
        amount: {
          value: amount,
          currency: 'IDR',
        }, // Make amount dynamic
        urlParams: [
          {
            url: 'https://google.com/',
            type: 'NOTIFICATION',
            isDeeplink: 'Y',
          },
        ],
        // validityPeriod: '2025-07-27T23:38:11+07:00',
        payOptionDetails: {
          payMethod: 'NETWORK_PAY',
          payOption: 'NETWORK_PAY_PG_OVO',
          amount: {
            value: amount,
            currency: 'IDR',
          },
        },
        additionalInfo: {
          order: {
            orderTitle: 'Payment Gateway Order',
            scenario: 'API',
            merchantTransType: 'SPECIAL_MOVIE',
            buyer: {
              externalUserType: '',
              nickname: '',
              externalUserId: '8392183912832913821',
              userId: '',
            },
          },
          mcc: '9999',
          envInfo: {
            sourcePlatform: 'IPG',
            terminalType: 'SYSTEM',
            orderTerminalType: 'WEB',
            clientIp: reqHeaders['x-client-ip'] || '127.0.0.1',
            osType: uaResult.os.name || 'UnknownOS',
            appVersion: uaResult.browser.version || '1.0',
            sdkVersion: '1.0',
            websiteLanguage: reqHeaders['x-language'] || 'en_US',
            orderOsType: uaResult.os.name || 'UnknownOS',
            merchantAppVersion: uaResult.browser.version || '1.0',
            // sessionId: sessionId, // Generate unique session ID
            // tokenId: tokenId, // Generate unique token ID
            /*extendInfo: JSON.stringify({
              deviceId: this.generateDeviceId(), // Generate unique device ID
              bizScenario: 'SAMPLE_MERCHANT_AGENT',
              description: description || 'Payment for order',
            }),*/
          },
        },
      };

      console.log('Order Request Body:', JSON.stringify(requestBody, null, 2));
      // const apiPath = '/v1.0/qr/qr-mpm-generate.htm';
      const apiPath = '/payment-gateway/v1.0/debit/payment-host-to-host.htm';

      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
        timestamp,
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      // const headers = this.generateHeaderCustomers(signature);
      const headers = {
        'Content-Type': 'application/json',
        // 'Authorization-Customer': `Bearer ${this.accessToken}`,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': signature,
        'X-PARTNER-ID': danaConfig.clientId,
        // 'X-DEVICE-ID': '123456',
        'X-EXTERNAL-ID': referenceNo,
        'CHANNEL-ID': '11111',
      };

      console.log('Order Header:', headers);
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
          headers,
          timeout: 30000, // Add timeout
        }),
      );

      console.log('Order Response:', response.data);

      // Validate response
      if (!response.data || response.data.responseCode !== '2005700') {
        console.error(`DANA API Error:`, response.data.responseCode);
        throw new Error(
          `DANA API Error: ${response.data?.responseMessage || 'Unknown error'}`,
        );
      }

      return response.data;
    } catch (error) {
      const errMessage = JSON.stringify(error.response?.data || error.message);

      // console.error('Failed to get Qris:', errMessage);
      throw new HttpException(
        errMessage,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  /**
   * Consult Pay
   */
  async consultPay(reqHeaders: any, payload: any): Promise<QrisPaymentDto> {
    try {
      await this.authenticate();
      console.log(reqHeaders);
      console.log(payload);
      // Generate unique reference number if not provided
      const referenceNo = crypto.randomUUID();
      const userAgent = reqHeaders['user-agent'] || 'Unknown';
      const parser = new UAParser(userAgent);
      const uaResult = parser.getResult();
      const rawAmount = payload.amount;
      const amount = parseFloat(rawAmount).toFixed(2);
      const timestamp = this.signatureService.getTimestamp();

      const requestBody = {
        merchantId: danaConfig.merchantId,
        amount: {
          value: amount,
          currency: 'IDR',
        },
        additionalInfo: {
          buyer: {
            externalUserType: '',
            nickname: '',
            externalUserId: '8392183912832913821',
            userId: '',
          },
          envInfo: {
            sourcePlatform: 'IPG',
            terminalType: 'SYSTEM',
            orderTerminalType: 'SYSTEM',
            clientIp: reqHeaders['x-client-ip'] || '127.0.0.1',
            osType: uaResult.os.name || 'UnknownOS',
            appVersion: uaResult.browser.version || '1.0',
            sdkVersion: '1.0',
            websiteLanguage: reqHeaders['x-language'] || 'en_US',
            orderOsType: uaResult.os.name || 'UnknownOS',
            merchantAppVersion: uaResult.browser.version || '1.0',
            // sessionId: sessionId, // Generate unique session ID
            // tokenId: tokenId, // Generate unique token ID
            /*extendInfo: JSON.stringify({
              deviceId: this.generateDeviceId(), // Generate unique device ID
              bizScenario: 'SAMPLE_MERCHANT_AGENT',
              description: description || 'Payment for order',
            }),*/
          },
        },
      };

      console.log('Order Request Body:', JSON.stringify(requestBody, null, 2));
      // const apiPath = '/v1.0/qr/qr-mpm-generate.htm';
      const apiPath = '/v1.0/payment-gateway/consult-pay.htm';

      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
        timestamp,
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      // const headers = this.generateHeaderCustomers(signature);
      const headers = {
        'Content-Type': 'application/json',
        // 'Authorization-Customer': `Bearer ${this.accessToken}`,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': signature,
        'X-PARTNER-ID': danaConfig.clientId,
        // 'X-DEVICE-ID': '123456',
        'X-EXTERNAL-ID': referenceNo,
        'CHANNEL-ID': '11111',
      };

      console.log('Order Header:', headers);
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
          headers,
          timeout: 30000, // Add timeout
        }),
      );

      console.log('Order Response:', response.data);

      // Validate response
      if (!response.data || response.data.responseCode !== '2005700') {
        console.error(`DANA API Error:`, response.data.responseCode);
        throw new Error(
          `DANA API Error: ${response.data?.responseMessage || 'Unknown error'}`,
        );
      }

      return response.data;
    } catch (error) {
      const errMessage = JSON.stringify(error.response?.data || error.message);

      // console.error('Failed to get Qris:', errMessage);
      throw new HttpException(
        errMessage,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private calculateFeeAmount(amount: string): string {
    // Implement your fee calculation logic
    // This is just an example - adjust based on your business rules
    const amountNum = parseFloat(amount);
    const feePercent = 0.007; // 0.7% fee example
    return Math.ceil(amountNum * feePercent).toString();
  }

  /**
   * Check if access token is valid and not expired
   */
  private isTokenValid(): boolean {
    return (
      this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry
    );
  }
  /**
   * Verify webhook signature
   * @param payload - The raw payload string from the webhook
   * @param signature - The signature header value from the webhook
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    return this.signatureService.verifySignature(
      payload,
      signature,
      danaConfig.publicKey,
    );
  }
}
