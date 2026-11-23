import crypto from 'node:crypto';
import { getTuyaEnv } from '../config/env.ts';
import type {
  DevicePowerResponse,
  DeviceStatusResponse,
  DeviceTelemetry,
  TuyaConfig,
  TuyaDataPoint,
} from '../types/tuya.ts';

interface TuyaApiEnvelope<T> {
  success: boolean;
  result?: T;
  t?: number;
  tid?: string;
  code?: number;
  msg?: string;
}

interface TuyaTokenResult {
  access_token: string;
  expire_time: number;
  refresh_token: string;
  uid: string;
}

interface TuyaDeviceInfoResult {
  id?: string;
  name?: string;
  online?: boolean;
  status?: TuyaDataPoint[];
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const REQUEST_TIMEOUT_MS = 12_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

let cachedToken: CachedToken | null = null;
let pendingTokenRequest: Promise<string> | null = null;

export function getTuyaConfig(deviceId?: string): TuyaConfig {
  return getTuyaEnv(deviceId);
}

function sha256Hex(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function canonicalizePath(pathWithQuery: string): string {
  const [pathname, query] = pathWithQuery.split('?');
  if (!query) {
    return pathname;
  }
  const params = new URLSearchParams(query);
  const sortedKeys = Array.from(new Set(params.keys())).sort();
  const sortedQuery = sortedKeys
    .flatMap((key) => params.getAll(key).map((val) => `${key}=${val}`))
    .join('&');
  return sortedQuery ? `${pathname}?${sortedQuery}` : pathname;
}

export function buildTuyaSignature(params: {
  accessId: string;
  accessSecret: string;
  accessToken: string;
  timestamp: string;
  method: string;
  pathWithQuery: string;
  bodyString: string;
}): string {
  const contentHash = sha256Hex(params.bodyString);
  const canonicalPath = canonicalizePath(params.pathWithQuery);
  const stringToSign = [
    params.method.toUpperCase(),
    contentHash,
    '',
    canonicalPath,
  ].join('\n');

  const signPayload = `${params.accessId}${params.accessToken}${params.timestamp}${stringToSign}`;

  return crypto
    .createHmac('sha256', params.accessSecret)
    .update(signPayload, 'utf8')
    .digest('hex')
    .toUpperCase();
}

async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit
): Promise<TuyaApiEnvelope<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed: TuyaApiEnvelope<T>;
    try {
      parsed = JSON.parse(rawText) as TuyaApiEnvelope<T>;
    } catch {
      throw new Error(
        `Respuesta inválida de Tuya Cloud (HTTP ${response.status}): ${rawText.slice(0, 160)}`
      );
    }

    if (!response.ok && parsed.success !== false) {
      return {
        success: false,
        code: response.status,
        msg: `Error HTTP ${response.status} desde Tuya Cloud`,
      };
    }

    return parsed;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con Tuya Cloud (12s).');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestNewAccessToken(config: TuyaConfig): Promise<string> {
  const pathWithQuery = '/v1.0/token?grant_type=1';
  const method = 'GET';
  const timestamp = Date.now().toString();
  const bodyString = '';

  const sign = buildTuyaSignature({
    accessId: config.accessId,
    accessSecret: config.accessSecret,
    accessToken: '',
    timestamp,
    method,
    pathWithQuery,
    bodyString,
  });

  const envelope = await fetchJsonWithTimeout<TuyaTokenResult>(
    `${config.baseUrl}${pathWithQuery}`,
    {
      method,
      headers: {
        client_id: config.accessId,
        sign,
        t: timestamp,
        sign_method: 'HMAC-SHA256',
      },
    }
  );

  if (!envelope.success || !envelope.result?.access_token) {
    const code = envelope.code !== undefined ? ` [${envelope.code}]` : '';
    throw new Error(
      `Error al autenticar con Tuya Cloud${code}: ${envelope.msg || 'No se pudo obtener access_token'}`
    );
  }

  const expireSeconds = Number(envelope.result.expire_time) || 7200;
  cachedToken = {
    accessToken: envelope.result.access_token,
    expiresAtMs: Date.now() + Math.max(expireSeconds * 1000 - TOKEN_SAFETY_MARGIN_MS, 30_000),
  };

  return cachedToken.accessToken;
}

async function getAccessToken(config: TuyaConfig, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.accessToken;
  }

  if (forceRefresh) {
    cachedToken = null;
  }

  if (!pendingTokenRequest) {
    pendingTokenRequest = requestNewAccessToken(config).finally(() => {
      pendingTokenRequest = null;
    });
  }

  return pendingTokenRequest;
}

async function signedTuyaRequest<T>(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  config: TuyaConfig,
  bodyObj?: Record<string, unknown>,
  retriedToken = false
): Promise<TuyaApiEnvelope<T>> {
  if (!config.isConfigured) {
    return {
      success: false,
      code: 503,
      msg: 'Configura TUYA_ACCESS_ID, TUYA_ACCESS_SECRET y TUYA_DEVICE_ID en las variables de entorno del servidor.',
    };
  }

  const accessToken = await getAccessToken(config, retriedToken);
  const timestamp = Date.now().toString();
  const bodyString = bodyObj ? JSON.stringify(bodyObj) : '';

  const sign = buildTuyaSignature({
    accessId: config.accessId,
    accessSecret: config.accessSecret,
    accessToken,
    timestamp,
    method,
    pathWithQuery,
    bodyString,
  });

  const headers: Record<string, string> = {
    client_id: config.accessId,
    access_token: accessToken,
    sign,
    t: timestamp,
    sign_method: 'HMAC-SHA256',
  };

  if (bodyObj) {
    headers['Content-Type'] = 'application/json';
  }

  const envelope = await fetchJsonWithTimeout<T>(`${config.baseUrl}${pathWithQuery}`, {
    method,
    headers,
    body: bodyObj ? bodyString : undefined,
  });

  // Tuya error 1010 = token invalid/expired; refresh once and retry transparently
  if (!envelope.success && envelope.code === 1010 && !retriedToken) {
    return signedTuyaRequest<T>(method, pathWithQuery, config, bodyObj, true);
  }

  return envelope;
}

function formatTuyaErrorMessage(code?: number, msg?: string): string {
  switch (code) {
    case 2001:
      return 'El dispositivo está desconectado (offline) en Tuya Cloud.';
    case 1004:
      return 'Firma HMAC-SHA256 rechazada por Tuya Cloud (verifica credenciales).';
    case 1010:
      return 'Token de acceso de Tuya expirado o inválido.';
    case 1106:
      return 'Permiso denegado en el proyecto de Tuya Cloud para este dispositivo.';
    case 2002:
      return 'El dispositivo no existe o no está vinculado a este proyecto Tuya.';
    case 2008:
      return 'El comando o Data Point enviado no es compatible con este dispositivo.';
    case 28841002:
      return 'La suscripción Cloud IoT Core en Tuya ha expirado.';
    default:
      return msg ? `Tuya Cloud: ${msg}` : 'Error al comunicarse con Tuya Cloud.';
  }
}

function extractNumericDp(list: TuyaDataPoint[], code: string): number | null {
  const found = list.find((item) => item.code === code);
  if (!found || typeof found.value !== 'number' || Number.isNaN(found.value)) {
    return null;
  }
  return found.value;
}

function extractSwitchDp(list: TuyaDataPoint[]): boolean | null {
  const primary = list.find((item) => item.code === 'switch');
  if (primary && typeof primary.value === 'boolean') {
    return primary.value;
  }
  const fallback = list.find((item) => item.code === 'switch_1');
  if (fallback && typeof fallback.value === 'boolean') {
    return fallback.value;
  }
  return null;
}

function buildTelemetry(list: TuyaDataPoint[]): DeviceTelemetry {
  const rawVoltage = extractNumericDp(list, 'cur_voltage');
  const currentMa = extractNumericDp(list, 'cur_current');
  const rawPower = extractNumericDp(list, 'cur_power');

  return {
    rawVoltage,
    voltageV: rawVoltage !== null ? Number((rawVoltage / 10).toFixed(1)) : null,
    currentMa,
    rawPower,
    powerW: rawPower !== null ? Number((rawPower / 10).toFixed(1)) : null,
  };
}

export async function getDeviceStatus(deviceId?: string): Promise<DeviceStatusResponse> {
  const config = getTuyaConfig(deviceId);
  const encodedId = encodeURIComponent(config.deviceId);
  const statusPath = `/v1.0/devices/${encodedId}/status`;
  const infoPath = `/v1.0/devices/${encodedId}`;

  const [statusEnvelope, infoEnvelope] = await Promise.all([
    signedTuyaRequest<TuyaDataPoint[]>('GET', statusPath, config),
    signedTuyaRequest<TuyaDeviceInfoResult>('GET', infoPath, config).catch(() => null),
  ]);

  const serverTimestamp = new Date().toISOString();
  const deviceOnline =
    infoEnvelope?.success && typeof infoEnvelope.result?.online === 'boolean'
      ? infoEnvelope.result.online
      : null;
  const deviceName =
    infoEnvelope?.success && typeof infoEnvelope.result?.name === 'string'
      ? infoEnvelope.result.name
      : null;

  if (!statusEnvelope.success) {
    return {
      success: false,
      deviceId: config.deviceId,
      deviceName,
      dataCenter: config.baseUrl,
      online: statusEnvelope.code === 2001 ? false : deviceOnline,
      switchOn: null,
      telemetry: {
        voltageV: null,
        rawVoltage: null,
        currentMa: null,
        powerW: null,
        rawPower: null,
      },
      statusList: [],
      tuyaTimestamp: statusEnvelope.t ?? null,
      tuyaTid: statusEnvelope.tid ?? null,
      serverTimestamp,
      errorCode: statusEnvelope.code,
      errorMessage: formatTuyaErrorMessage(statusEnvelope.code, statusEnvelope.msg),
    };
  }

  const statusList = Array.isArray(statusEnvelope.result) ? statusEnvelope.result : [];
  const switchOn = extractSwitchDp(statusList);
  const telemetry = buildTelemetry(statusList);

  return {
    success: true,
    deviceId: config.deviceId,
    deviceName,
    dataCenter: config.baseUrl,
    online: deviceOnline,
    switchOn,
    telemetry,
    statusList,
    tuyaTimestamp: statusEnvelope.t ?? null,
    tuyaTid: statusEnvelope.tid ?? null,
    serverTimestamp,
  };
}

export async function setDevicePower(
  on: boolean,
  deviceId?: string
): Promise<DevicePowerResponse> {
  const config = getTuyaConfig(deviceId);
  const commandsPath = `/v1.0/devices/${encodeURIComponent(config.deviceId)}/commands`;
  const payload = {
    commands: [
      {
        code: 'switch',
        value: on,
      },
    ],
  };

  let envelope = await signedTuyaRequest<boolean>('POST', commandsPath, config, payload);
  // Fallback to switch_1 if device schema uses switch_1 DP
  if (!envelope.success && envelope.code === 2008) {
    envelope = await signedTuyaRequest<boolean>('POST', commandsPath, config, {
      commands: [{ code: 'switch_1', value: on }],
    });
  }

  const serverTimestamp = new Date().toISOString();

  if (!envelope.success) {
    return {
      success: false,
      deviceId: config.deviceId,
      requestedState: on,
      commandAccepted: false,
      tuyaResult: null,
      tuyaTimestamp: envelope.t ?? null,
      tuyaTid: envelope.tid ?? null,
      serverTimestamp,
      errorCode: envelope.code,
      errorMessage: formatTuyaErrorMessage(envelope.code, envelope.msg),
    };
  }

  return {
    success: true,
    deviceId: config.deviceId,
    requestedState: on,
    commandAccepted: Boolean(envelope.result),
    tuyaResult: typeof envelope.result === 'boolean' ? envelope.result : null,
    tuyaTimestamp: envelope.t ?? null,
    tuyaTid: envelope.tid ?? null,
    serverTimestamp,
  };
}

export async function sendDeviceClimateCommand(
  code: 'temp_set' | 'mode' | 'fan_speed_enum',
  value: number | string,
  deviceId?: string
): Promise<{
  deviceId: string;
  hardwareSynced: boolean;
  tuyaTid: string | null;
  errorCode?: number;
  errorMessage?: string;
}> {
  const config = getTuyaConfig(deviceId);
  const commandsPath = `/v1.0/devices/${encodeURIComponent(config.deviceId)}/commands`;
  const envelope = await signedTuyaRequest<boolean>('POST', commandsPath, config, {
    commands: [{ code, value }],
  });

  if (!envelope.success) {
    return {
      deviceId: config.deviceId,
      hardwareSynced: false,
      tuyaTid: envelope.tid ?? null,
      errorCode: envelope.code,
      errorMessage: formatTuyaErrorMessage(envelope.code, envelope.msg),
    };
  }

  return {
    deviceId: config.deviceId,
    hardwareSynced: Boolean(envelope.result),
    tuyaTid: envelope.tid ?? null,
  };
}
