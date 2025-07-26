// dto/auth.dto.ts
export class AuthResponseDto {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}
export class AccessTokenDto {
  responseCode: string;
  responseMessage: string;
  accessToken: string;
  tokenType: string;
  accessTokenExpiryTime?: string;
  refreshToken?: string;
  refreshTokenExpiryTime?: string;
  additionalInfo?: string;
}
export class QrisPaymentDto {
  responseCode: string;
  responseMessage: string;
  referenceNo?: string;
  partnerReferenceNo?: string;
  qrContent?: string;
  qrUrl?: string;
  qrImage?: string;
  redirectUrl?: string;
  merchantName?: string;
  storeId?: string;
  terminalId?: string;
  additionalInfo?: string;
}

// dto/balance.dto.ts
export class BalanceResponseDto {
  accountNumber: string;
  balance: number;
  currency: string;
  status: string;
}

// dto/transaction.dto.ts
export class TransactionDto {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  description?: string;
  merchantTradeNo?: string;
}

export class TransactionListResponseDto {
  transactions: TransactionDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export class GetTransactionsDto {
  page?: number = 1;
  pageSize?: number = 10;
  startDate?: string;
  endDate?: string;
  status?: string;
}

// dto/payment.dto.ts
export class RequestPaymentDto {
  merchantTradeNo: string;
  orderTitle: string;
  orderDescription?: string;
  amount: number;
  currency: string = 'IDR';
  notifyUrl?: string;
  returnUrl?: string;
  timeoutExpress?: number = 30; // minutes
  paymentMethod?: string = 'DANA_BALANCE';
  goodsType?: string = 'VIRTUAL_GOODS';
}

export class PaymentResponseDto {
  resultCode: string;
  resultMessage: string;
  merchantTradeNo: string;
  danaTradeNo?: string;
  orderAmount: number;
  orderTitle: string;
  redirectUrl?: string;
  qrCode?: string;
  tradeStatus: string;
  payUrl?: string;
}

export class RefundPaymentDto {
  danaTradeNo: string;
  refundAmount: number;
  refundReason?: string;
  merchantRefundNo: string;
}

export class RefundResponseDto {
  resultCode: string;
  resultMessage: string;
  danaTradeNo: string;
  merchantRefundNo: string;
  refundAmount: number;
  refundStatus: string;
}
