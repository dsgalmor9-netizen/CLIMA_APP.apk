export interface TuyaDataPoint {
  code: string;
  value: boolean | number | string;
}

export type ClimateMode = 'cool' | 'dry' | 'fan' | 'auto';
export type FanSpeedLevel = 'auto' | 'low' | 'mid' | 'high';

export interface ClimateControlState {
  tempSet: number;
  mode: ClimateMode;
  fanSpeed: FanSpeedLevel;
}

export interface DeviceTelemetry {
  voltageV: number | null;
  rawVoltage: number | null;
  currentMa: number | null;
  powerW: number | null;
  rawPower: number | null;
}

export interface TuyaConfig {
  accessId: string;
  accessSecret: string;
  deviceId: string;
  baseUrl: string;
  isConfigured: boolean;
}

export interface DeviceStatusResponse {
  success: boolean;
  deviceId: string;
  deviceName: string | null;
  dataCenter: string;
  online: boolean | null;
  switchOn: boolean | null;
  climate?: ClimateControlState;
  telemetry: DeviceTelemetry;
  statusList: TuyaDataPoint[];
  tuyaTimestamp: number | null;
  tuyaTid: string | null;
  serverTimestamp: string;
  lastOffAt?: number | null;
  cooldownRemainingSeconds?: number;
  serverNowMs?: number;
  autoOffAtMs?: number;
  autoOffRemainingSeconds?: number;
  autoOffTriggeredNow?: boolean;
  errorCode?: number | string;
  errorMessage?: string;
}

export interface DevicePowerResponse {
  success: boolean;
  deviceId: string;
  requestedState: boolean;
  commandAccepted: boolean;
  tuyaResult: boolean | null;
  tuyaTimestamp: number | null;
  tuyaTid: string | null;
  serverTimestamp: string;
  remainingSeconds?: number;
  bankedRemainingSeconds?: number;
  sessionTotalSeconds?: number;
  isPoweredOn?: boolean;
  lastStartedAt?: number | null;
  lastOffAt?: number | null;
  cooldownRemainingSeconds?: number;
  activeUntilMs?: number;
  autoOffAtMs?: number;
  serverNowMs?: number;
  climate?: ClimateControlState;
  errorCode?: number | string;
  errorMessage?: string;
}

export interface TuyaControlResponse {
  success: boolean;
  deviceId?: string;
  command: 'power' | 'temp_set' | 'mode' | 'fan_speed_enum';
  commandAccepted: boolean;
  hardwareSynced: boolean;
  switchOn?: boolean | null;
  climate: ClimateControlState;
  remainingSeconds: number;
  bankedRemainingSeconds?: number;
  sessionTotalSeconds?: number;
  isPoweredOn: boolean;
  lastStartedAt: number | null;
  lastOffAt?: number | null;
  cooldownRemainingSeconds?: number;
  activeUntilMs: number;
  autoOffAtMs?: number;
  serverNowMs?: number;
  tuyaTid?: string | null;
  errorCode?: number | string;
  errorMessage?: string;
}
