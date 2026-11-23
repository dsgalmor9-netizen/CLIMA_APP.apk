import type { ClimateControlState } from './tuya';
import type { PaymentRecordItem } from './wompi';

export type ActivityActionType = 'PRENDER' | 'APAGAR' | 'ESTADO' | 'PAGO' | 'CLIMA';

export interface ActivityLogEntry {
  id: string;
  deviceId?: string;
  timestamp: string;
  action: ActivityActionType;
  ok: boolean;
  summary: string;
  tuyaCode?: number | string;
  tuyaTid?: string | null;
}

export interface UserDeviceSessionRecord {
  uid: string;
  deviceId: string;
  email: string;
  remainingSeconds: number;
  isPoweredOn: boolean;
  lastStartedAt: number | null;
  sessionTotalSeconds: number;
  totalPurchasedSeconds: number;
  updatedAt: string;
}

export interface StoredPaymentOrder extends PaymentRecordItem {
  uid: string;
  deviceId: string;
  credited: boolean;
}

export interface StoredCommandEntry extends ActivityLogEntry {
  uid: string;
  deviceId: string;
}

export interface CompressorCooldownSnapshot {
  deviceId: string;
  active: boolean;
  lastOffAt: number | null;
  cooldownRemainingSeconds: number;
  cooldownRemainingMs: number;
}

export interface UserTimeSnapshot {
  deviceId: string;
  remainingSeconds: number;
  bankedRemainingSeconds: number;
  sessionTotalSeconds: number;
  isPoweredOn: boolean;
  lastStartedAt: number | null;
  activeUntilMs: number;
  serverNowMs: number;
}

export interface AccountStateResponse {
  success: boolean;
  uid: string;
  deviceId: string;
  email: string;
  remainingSeconds: number;
  bankedRemainingSeconds: number;
  sessionTotalSeconds: number;
  isPoweredOn: boolean;
  lastStartedAt: number | null;
  lastOffAt: number | null;
  cooldownRemainingSeconds: number;
  activeUntilMs: number;
  autoOffAtMs: number;
  autoOffRemainingSeconds: number;
  climate: ClimateControlState;
  serverNowMs: number;
  payments: PaymentRecordItem[];
  commands: ActivityLogEntry[];
}

export interface PublicRuntimeConfig {
  turnstileSiteKey: string | null;
  turnstileMode: 'cloudflare' | 'fallback';
  wompiConfigured: boolean;
  wompiPublicKey: string | null;
  deviceId: string;
  tuyaBaseUrl: string;
  maxHours: number;
  baseHourlyRateCop: number;
  tempMinC?: number;
  tempMaxC?: number;
  compressorCooldownSeconds?: number;
}
