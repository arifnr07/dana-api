import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { AccessTokenDto, danaConfig } from './dana.module';
import {
  AuthResponseDto,
  BalanceResponseDto,
  TransactionListResponseDto,
  GetTransactionsDto,
  RequestPaymentDto,
  PaymentResponseDto,
  RefundPaymentDto,
  RefundResponseDto,
} from './dana.module';

@Injectable()
export class DanaService {
  private readonly logger = new Logger(DanaService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private readonly httpService: HttpService) { }

  /**
   * Generate RSA signature for request authentication
   */
  private generateSignature(data: string, privateKey: string): string {
    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(data);
      sign.end();

      const formattedPrivateKey = this.base64KeyToPEM(privateKey, 'PRIVATE');
      const signature = sign.sign(formattedPrivateKey, 'base64');

      return signature;
    } catch (error) {
      this.logger.error('Error generating signature:', error);
      throw new HttpException(
        'Failed to generate signature',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Format private key for crypto operations
   */
  private base64KeyToPEM(base64Key, keyType) {
    return [`-----BEGIN ${keyType} KEY-----`, ...this.splitStringIntoChunks(base64Key, 64), `-----END ${keyType} KEY-----`].join("\n");
  }
  private splitStringIntoChunks(input, chunkSize) {
    const chunkCount = Math.ceil(input.length / chunkSize)
    return Array.from({ length: chunkCount }).map((v, chunkIndex) => input.substr(chunkIndex * chunkSize, chunkSize));
  }

  private formatPrivateKey(privateKey: string): string {
    if (privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return privateKey;
    }

    return `-----BEGIN PRIVATE KEY-----:${privateKey.match(/.{1,64}/g)?.join(':')}:-----END PRIVATE KEY-----`;
  }

  /**
   * Verify signature from Dana response
   */
  private verifySignature(
    data: string,
    signature: string,
    publicKey: string,
  ): boolean {
    try {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(data);
      verify.end();

      const formattedPublicKey = this.formatPublicKey(publicKey);
      return verify.verify(formattedPublicKey, signature, 'base64');
    } catch (error) {
      this.logger.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Format public key for crypto operations
   */
  private formatPublicKey(publicKey: string): string {
    if (publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      return publicKey;
    }

    return `-----BEGIN PUBLIC KEY-----:${publicKey.match(/.{1,64}/g)?.join(':')}:-----END PUBLIC KEY-----`;
  }

  /**
   * Generate common headers for API requests
   */
  private hash(string) {
    return crypto.createHash('sha256').update(string).digest('hex');
  }
  private getLocalISO() {
    const date = new Date();
    const pad = (n) => n.toString().padStart(2, '0');

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    const offset = -date.getTimezoneOffset(); // in minutes
    const sign = offset >= 0 ? '+' : '-';
    const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
    const offsetMinutes = pad(Math.abs(offset) % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
  }


  private generateHeaders(signature?: string): Record<string, string> {

    const headers = {
      'Content-Type': 'application/json',
      'X-CLIENT-KEY': danaConfig.clientId,
      'X-TIMESTAMP': this.getLocalISO(),
      'CHANNEL-ID': '95221',
      'Dana-Request-Id': crypto.randomUUID(),

    };

    if (signature) {
      headers['X-SIGNATURE'] = signature;
    }

    if (this.accessToken) {
      headers['Authorization-Customer'] = `Bearer ${this.accessToken}`;
    }

    return headers;
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
   * Authenticate with Dana API and get access token
   */
  async authenticate(): Promise<AuthResponseDto> {
    try {
      if (this.isTokenValid()) {
        return {
          access_token: this.accessToken,
          token_type: 'Bearer',
          expires_in: Math.floor(
            (this.tokenExpiry.getTime() - Date.now()) / 1000,
          ),
        };
      }
      const requestBody = {
        "grantType": "client_credentials",
        "additionalInfo": {}
      };

      const signatureData = `${danaConfig.clientId}|${this.getLocalISO()}`;

      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

  
      const response = await firstValueFrom(
        this.httpService.post(
          `${danaConfig.baseUrl}/v1.0/access-token/b2b.htm`,
          requestBody,
          {
            headers,
          },
        ),
      );

      const authData = response.data;
      this.accessToken = authData.access_token;
      this.tokenExpiry = new Date(Date.now() + authData.expires_in * 1000);

      this.logger.log('Successfully authenticated with Dana API');
      return authData;
    } catch (error) {
      this.logger.error(
        'Authentication failed:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Authentication failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async getAccessToken(): Promise<AccessTokenDto> {
    try {
      await this.authenticate();
      const requestBody = {

        "grantType": "AUTHORIZATION_CODE",
        // "authCode": "ABC3821738137123",
        "refreshToken": "",
        "additionalInfo": {}
      };
      console.log(requestBody)
      // const timestamp = this.getLocalISO();
      const signatureData = `${danaConfig.clientId}|${this.getLocalISO()}`;

      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}/v1.0/access-token/b2b2c.htm`,
          requestBody, {
          headers,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to get token:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to get token',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get merchant balance
   */
  async getBalance(): Promise<BalanceResponseDto> {
    try {
      await this.authenticate();
      const requestBody = {
        "balanceTypes": ["BALANCE"],
        "additionalInfo": {}
      };
      console.log(requestBody)
      const timestamp = this.getLocalISO();
      const signatureData = `POST:/v1.0/balance-inquiry.htm:${this.hash(JSON.stringify(requestBody))}:${timestamp}:`;
      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);
      headers['X-PARTNER-ID'] = danaConfig.clientId;
      headers['X-EXTERNAL-ID'] = danaConfig.merchantId;
      headers['X-DEVICE-ID'] = 'android-20013adf6cdd8123f';
      console.log(headers);
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}/v1.0/balance-inquiry.htm`,
          requestBody, {
          headers,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to get balance:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to get balance',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get transaction history
   */
  async getTransactions(
    params: GetTransactionsDto,
  ): Promise<TransactionListResponseDto> {
    try {
      await this.authenticate();

      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.pageSize)
        queryParams.append('pageSize', params.pageSize.toString());
      if (params.startDate) queryParams.append('startDate', params.startDate);
      if (params.endDate) queryParams.append('endDate', params.endDate);
      if (params.status) queryParams.append('status', params.status);

      const timestamp = Date.now().toString();
      const endpoint = `/api/v1/merchant/transactions?${queryParams.toString()}`;
      const signatureData = `GET:${endpoint}:${timestamp}:${danaConfig.clientId}`;
      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.get(`${danaConfig.baseUrl}${endpoint}`, {
          headers,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to get transactions:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to get transactions',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Request payment from customer
   */
  async requestPayment(
    paymentRequest: RequestPaymentDto,
  ): Promise<PaymentResponseDto> {
    try {
      await this.authenticate();

      const requestBody = {
        merchantId: danaConfig.merchantId,
        merchantTradeNo: paymentRequest.merchantTradeNo,
        orderTitle: paymentRequest.orderTitle,
        orderDescription: paymentRequest.orderDescription,
        orderAmount: {
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
        },
        paymentMethod: paymentRequest.paymentMethod,
        goodsType: paymentRequest.goodsType,
        timeoutExpress: paymentRequest.timeoutExpress,
        notifyUrl: paymentRequest.notifyUrl,
        returnUrl: paymentRequest.returnUrl,
      };

      const timestamp = Date.now().toString();
      const signatureData = `POST:/api/v1/payment/request:${timestamp}:${JSON.stringify(requestBody)}`;
      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.post(
          `${danaConfig.baseUrl}/api/v1/payment/request`,
          requestBody,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to request payment:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to request payment',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(
    refundRequest: RefundPaymentDto,
  ): Promise<RefundResponseDto> {
    try {
      await this.authenticate();

      const requestBody = {
        merchantId: danaConfig.merchantId,
        danaTradeNo: refundRequest.danaTradeNo,
        merchantRefundNo: refundRequest.merchantRefundNo,
        refundAmount: refundRequest.refundAmount,
        refundReason: refundRequest.refundReason,
      };

      const timestamp = Date.now().toString();
      const signatureData = `POST:/api/v1/payment/refund:${timestamp}:${JSON.stringify(requestBody)}`;
      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.post(
          `${danaConfig.baseUrl}/api/v1/payment/refund`,
          requestBody,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to refund payment:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to refund payment',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(merchantTradeNo: string): Promise<PaymentResponseDto> {
    try {
      await this.authenticate();

      const timestamp = Date.now().toString();
      const endpoint = `/api/v1/payment/status/${merchantTradeNo}`;
      const signatureData = `GET:${endpoint}:${timestamp}:${danaConfig.clientId}`;
      const signature = this.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.get(`${danaConfig.baseUrl}${endpoint}`, {
          headers,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to get payment status:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to get payment status',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    return this.verifySignature(payload, signature, danaConfig.publicKey);
  }
}
