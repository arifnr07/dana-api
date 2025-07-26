import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { danaConfig } from './dana.config';
import {
  AuthResponseDto,
  QrisPaymentDto,
  AccessTokenDto,
  BalanceResponseDto,
  TransactionListResponseDto,
  GetTransactionsDto,
  RequestPaymentDto,
  PaymentResponseDto,
  RefundPaymentDto,
  RefundResponseDto,
} from './dana.dto';
import { DanaSignatureService } from './dana.signature';

@Injectable()
export class DanaService {
  private readonly logger = new Logger(DanaService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private signatureService = new DanaSignatureService();
  constructor(private readonly httpService: HttpService) {}

  /**
   * Format private key for crypto operations
   */

  private generateHeaders(signature?: string): Record<string, string> {
    const headers = {
      'Content-Type': 'application/json',
      'X-CLIENT-KEY': danaConfig.clientId,
      'X-TIMESTAMP': this.signatureService.getTimestamp(),
      'X-EXTERNAL-ID': crypto.randomUUID(),
      'CHANNEL-ID': '95221',
    };

    if (signature) {
      headers['X-SIGNATURE'] = signature;
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return headers;
  }
  private generateHeaderCustomers(signature?: string): Record<string, string> {
    const headers = {
      'Content-Type': 'application/json',
      'X-PARTNER-ID': danaConfig.clientId,
      'X-EXTERNAL-ID': crypto.randomUUID(),
      'X-TIMESTAMP': this.signatureService.getTimestamp(),
      'CHANNEL-ID': '95221',
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

      const headers = this.generateHeaders(signature);

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

  async getQrisPayment(
    amount: string,
    partnerReferenceNo?: string,
  ): Promise<QrisPaymentDto> {
    try {
      await this.authenticate();

      // Generate unique reference number if not provided
      const referenceNo = partnerReferenceNo || crypto.randomUUID();

      const requestBody = {
        merchantId: "00007100010926",
        partnerReferenceNo: referenceNo,
        amount: {
          value: '12345.00',
          currency: 'IDR',
        }, // Make amount dynamic
        feeAmount: {
          value: '123.00',
          currency: 'IDR',
        }, // Calculate fee dynamically
        additionalInfo: {
          terminalSource: 'MER',
          envInfo: {
            sessionId: this.generateSessionId(), // Generate unique session ID
            tokenId: this.generateTokenId(), // Generate unique token ID
            websiteLanguage: 'en_US',
            clientIp: this.getClientIp(), // Get actual client IP
            // clientIp: '10.15.8.189', // Get actual client IP
            osType: 'Windows',
            appVersion: '1.0',
            sdkVersion: '1.0',
            sourcePlatform: 'IPG',
            terminalType: 'SYSTEM',
            orderTerminalType: 'SYSTEM',
            orderOsType: 'Windows',
            merchantAppVersion: '1.0',
            // extendInfo: JSON.stringify({
            //   deviceId: this.generateDeviceId(), // Generate unique device ID
            //   bizScenario: 'MERCHANT_AGENT',
            // }),
          },
        },
      };

      console.log('QRIS Request Body:', JSON.stringify(requestBody, null, 2));
      const apiPath = '/v1.0/qr/qr-mpm-generate.htm';
      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      // const headers = this.generateHeaderCustomers(signature);
      const headers = {
        'Content-Type': 'application/json',
        'X-TIMESTAMP': this.signatureService.getTimestamp(),
        'X-SIGNATURE': signature,
        'X-PARTNER-ID': danaConfig.clientId,
        'X-EXTERNAL-ID': referenceNo,
        'CHANNEL-ID': '95221',
        // Authorization: `Bearer ${this.accessToken}`,
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
      console.error(
        'Failed to get Qris:',
        JSON.stringify(error.response?.data || error.message),
      );
      throw new HttpException(
        'Failed to get Qris',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Helper methods to add to your service class
  private generatePartnerReferenceNo(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${random}`.substring(0, 22); // DANA requires max 22 chars
  }

  private calculateFeeAmount(amount: string): string {
    // Implement your fee calculation logic
    // This is just an example - adjust based on your business rules
    const amountNum = parseFloat(amount);
    const feePercent = 0.007; // 0.7% fee example
    return Math.ceil(amountNum * feePercent).toString();
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private generateTokenId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c == 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }

  private getClientIp(): string {
    // In a real application, get this from the request
    // For now, return a placeholder
    return '127.0.0.1';
  }

  private generateDeviceId(): string {
    return 'android-' + Math.random().toString(16).substring(2, 18);
  }

  // Updated method signature for better usability
  async createQrisPayment(
    amount: number,
    currency: string = 'IDR',
    description?: string,
    expiryMinutes: number = 30,
  ): Promise<QrisPaymentDto> {
    // Validate amount
    if (amount <= 0) {
      throw new HttpException(
        'Amount must be greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Convert amount to string format expected by DANA
    const amountStr = Math.round(amount * 100).toString(); // Convert to cents/smallest unit

    return this.getQrisPayment(amountStr);
  }

  async getAccessToken(): Promise<AccessTokenDto> {
    try {
      await this.authenticate();
      const requestBody = {
        grantType: 'AUTHORIZATION_CODE',
        // "authCode": "ABC3821738137123",
        refreshToken: '',
        additionalInfo: {},
      };
      console.log(requestBody);

      const apiPath = '/v1.0/access-token/b2b2c.htm';
      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaders(signature);

      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
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

  async getBalance(): Promise<BalanceResponseDto> {
    try {
      await this.authenticate();

      const requestBody = {
        balanceTypes: ['BALANCE'],
        additionalInfo: {},
      };
      console.log(requestBody);
      const apiPath = '/v1.0/balance-inquiry.htm';
      const signatureData = this.signatureService.prepareSignatureData(
        'POST',
        apiPath,
        JSON.stringify(requestBody),
      );

      const signature = this.signatureService.generateSignature(
        signatureData,
        danaConfig.privateKey,
      );

      const headers = this.generateHeaderCustomers(signature);
      headers['X-DEVICE-ID'] = 'android-20013adf6cdd8123f';
      console.log(headers);
      const response = await firstValueFrom(
        this.httpService.post(`${danaConfig.baseUrl}${apiPath}`, requestBody, {
          headers,
        }),
      );

      return response.data;
    } catch (error) {
      console.error(
        `Failed to get balance: `,
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to get balance',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
      const signature = this.signatureService.generateSignature(
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
      const signature = this.signatureService.generateSignature(
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
      const signature = this.signatureService.generateSignature(
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

  async getPaymentStatus(merchantTradeNo: string): Promise<PaymentResponseDto> {
    try {
      await this.authenticate();

      const timestamp = Date.now().toString();
      const endpoint = `/api/v1/payment/status/${merchantTradeNo}`;
      const signatureData = `GET:${endpoint}:${timestamp}:${danaConfig.clientId}`;
      const signature = this.signatureService.generateSignature(
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

  verifyWebhookSignature(payload: string, signature: string): boolean {
    return this.signatureService.verifySignature(
      payload,
      signature,
      danaConfig.publicKey,
    );
  }
}
