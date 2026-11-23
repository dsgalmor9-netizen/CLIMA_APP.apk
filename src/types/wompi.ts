export type PaymentStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export interface PaymentRecordItem {
  id: string;
  deviceId?: string;
  reference: string;
  transactionId: string;
  hours: number;
  addedSeconds: number;
  subtotalCop: number;
  discountPercent: number;
  discountCop: number;
  totalCop: number;
  amountInCents: number;
  currency: 'COP';
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WompiConfig {
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
  apiBaseUrl: string;
  isConfigured: boolean;
}

export interface WompiWebhookPayload {
  event?: string;
  data?: {
    transaction?: {
      id?: string;
      reference?: string;
      status?: string;
      amount_in_cents?: number;
      currency?: string;
    };
  };
  signature?: {
    properties?: string[];
    checksum?: string;
  };
  timestamp?: number;
}

export interface WompiTransactionLookup {
  ok: boolean;
  status?: string;
  reference?: string;
  amountInCents?: number;
  errorMessage?: string;
}

export interface WompiCheckoutSessionResponse {
  success: boolean;
  wompiConfigured: boolean;
  deviceId?: string;
  reference?: string;
  amountInCents?: number;
  currency?: 'COP';
  publicKey?: string;
  integritySignature?: string;
  redirectUrl?: string | null;
  checkoutUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WompiPurchaseResponse {
  success: boolean;
  deviceId?: string;
  autoTurnedOn?: boolean;
  status?: PaymentStatus;
  reference?: string;
  transactionId?: string;
  remainingSeconds?: number;
  bankedRemainingSeconds?: number;
  sessionTotalSeconds?: number;
  isPoweredOn?: boolean;
  lastStartedAt?: number | null;
  activeUntilMs?: number;
  autoOffAtMs?: number;
  autoOffRemainingSeconds?: number;
  serverNowMs?: number;
  order?: PaymentRecordItem | null;
  errorCode?: string;
  errorMessage?: string;
}
