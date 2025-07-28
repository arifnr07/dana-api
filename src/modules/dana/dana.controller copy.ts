import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  RawBody,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DanaSignatureService } from './dana.signature';
import { DanaService } from './dana.service';
import {
  AuthResponseDto,
  QrisPaymentDto,
  BalanceResponseDto,
  TransactionListResponseDto,
  GetTransactionsDto,
  RequestPaymentDto,
  PaymentResponseDto,
  RefundPaymentDto,
  RefundResponseDto,
} from './dana.dto';

@Controller('dana')
export class DanaController {
  private readonly logger = new Logger(DanaController.name);
  constructor(private readonly danaService: DanaService) { }
  private signatureService = new DanaSignatureService();
  @Post('sign')
  async signSignature(
    @Body() data: { signature: string; privateKey: string },
  ): Promise<string> {
    console.log(data);
    const signature = data.signature;
    const privateKey = data.privateKey;
    return await this.signatureService.generateSignature(signature, privateKey);
  }

  /**
   * Authenticate and get access token
   */
  @Post('auth')
  async authenticate(): Promise<AuthResponseDto> {
    return await this.danaService.authenticate();
  }
  @Post('qris-payment')
  async generateQris(): Promise<QrisPaymentDto> {
    return await this.danaService.createQrisPayment(1000);
  }
  /**
   * Get merchant balance
   */
  @Get('balance')
  async getBalance(): Promise<BalanceResponseDto> {
    return await this.danaService.getBalance();
  }

  /**
   * Get transaction history
   */
  @Get('transactions')
  async getTransactions(
    @Query() params: GetTransactionsDto,
  ): Promise<TransactionListResponseDto> {
    return await this.danaService.getTransactions(params);
  }

  /**
   * Request payment
   */
  @Post('payment/request')
  async requestPayment(
    @Body() paymentRequest: RequestPaymentDto,
  ): Promise<PaymentResponseDto> {
    return await this.danaService.requestPayment(paymentRequest);
  }

  /**
   * Refund payment
   */
  @Post('payment/refund')
  async refundPayment(
    @Body() refundRequest: RefundPaymentDto,
  ): Promise<RefundResponseDto> {
    return await this.danaService.refundPayment(refundRequest);
  }

  /**
   * Get payment status
   */
  @Get('payment/status/:merchantTradeNo')
  async getPaymentStatus(
    @Param('merchantTradeNo') merchantTradeNo: string,
  ): Promise<PaymentResponseDto> {
    return await this.danaService.getPaymentStatus(merchantTradeNo);
  }

  /**
   * Handle webhook notifications from Dana
   */
  @Post('webhook')
  async handleWebhook(
    @Body() payload: any,
    @Headers('X-SIGNATURE') signature: string,
    @RawBody() rawBody: Buffer,
  ): Promise<{ status: string }> {
    try {
      const payloadString = rawBody.toString();

      // Verify webhook signature
      const isValid = this.danaService.verifyWebhookSignature(
        payloadString,
        signature,
      );

      if (!isValid) {
        this.logger.error('Invalid webhook signature');
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }

      this.logger.log('Webhook received:', payload);

      // Process webhook payload here
      // You can add your business logic to handle different webhook events
      switch (payload.eventType) {
        case 'PAYMENT_SUCCESS':
          this.logger.log(`Payment successful: ${payload.merchantTradeNo}`);
          break;
        case 'PAYMENT_FAILED':
          this.logger.log(`Payment failed: ${payload.merchantTradeNo}`);
          break;
        case 'REFUND_SUCCESS':
          this.logger.log(`Refund successful: ${payload.merchantRefundNo}`);
          break;
        default:
          this.logger.log(`Unknown event type: ${payload.eventType}`);
      }

      return { status: 'success' };
    } catch (error) {
      this.logger.error('Webhook processing failed:', error);
      throw new HttpException(
        'Webhook processing failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
