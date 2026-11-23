import type { TuyaConfig } from '../types/tuya.ts';
import type { WompiConfig } from '../types/wompi.ts';
import { sanitizeDeviceId } from './climate.ts';

const DEFAULT_TUYA_BASE_URL = 'https://openapi.tuyaus.com';

const CAPACITOR_ALLOWED_ORIGINS = new Set<string>([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

export interface SupabaseEnvConfig {
  url: string;
  serviceRoleKey: string;
  isConfigured: boolean;
}

export interface CronEnvConfig {
  secret: string;
  isConfigured: boolean;
}

export interface ServerRuntimeEnv {
  port: number;
  isProduction: boolean;
  appUrl: string;
  corsAllowedOrigins: string[];
  tuya: TuyaConfig;
  wompi: WompiConfig;
  supabase: SupabaseEnvConfig;
  cron: CronEnvConfig;
}

function readEnv(key: string): string {
  return (process.env[key] || '').trim();
}

export function getDefaultDeviceId(): string {
  const raw = readEnv('TUYA_DEVICE_ID');
  return sanitizeDeviceId(raw) || raw;
}

/**
 * Resolves a dynamic per-request deviceId (multi-device scalability) while falling back
 * safely to the server's configured default `TUYA_DEVICE_ID`.
 * Rejects malformed IDs to prevent path traversal into Tuya OpenAPI URLs.
 */
export function resolveDeviceId(requestedDeviceId?: unknown): {
  deviceId: string;
  isValid: boolean;
  wasExplicit: boolean;
} {
  if (
    requestedDeviceId !== undefined &&
    requestedDeviceId !== null &&
    String(requestedDeviceId).trim() !== ''
  ) {
    const sanitized = sanitizeDeviceId(requestedDeviceId);
    if (!sanitized) {
      return {
        deviceId: getDefaultDeviceId(),
        isValid: false,
        wasExplicit: true,
      };
    }
    return {
      deviceId: sanitized,
      isValid: true,
      wasExplicit: true,
    };
  }

  return {
    deviceId: getDefaultDeviceId(),
    isValid: true,
    wasExplicit: false,
  };
}

export function getTuyaEnv(overrideDeviceId?: string): TuyaConfig {
  const baseUrlRaw = readEnv('TUYA_BASE_URL') || DEFAULT_TUYA_BASE_URL;
  const accessId = readEnv('TUYA_ACCESS_ID');
  const accessSecret = readEnv('TUYA_ACCESS_SECRET');
  const resolved = resolveDeviceId(overrideDeviceId);
  const deviceId = resolved.isValid ? resolved.deviceId : getDefaultDeviceId();

  return {
    accessId,
    accessSecret,
    deviceId,
    baseUrl: baseUrlRaw.replace(/\/+$/, ''),
    isConfigured: Boolean(accessId && accessSecret && deviceId),
  };
}

export function getWompiEnv(): WompiConfig {
  const publicKey = readEnv('WOMPI_PUBLIC_KEY') || readEnv('NEXT_PUBLIC_WOMPI_PUBLIC_KEY');
  const privateKey = readEnv('WOMPI_PRIVATE_KEY');
  const integritySecret = readEnv('WOMPI_INTEGRITY_SECRET');
  const eventsSecret = readEnv('WOMPI_EVENTS_SECRET');
  const isProdKey = publicKey.startsWith('pub_prod_') || readEnv('WOMPI_ENV') === 'production';
  const apiBaseUrl = isProdKey ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1';

  return {
    publicKey,
    privateKey,
    integritySecret,
    eventsSecret,
    apiBaseUrl,
    isConfigured: Boolean(publicKey && integritySecret),
  };
}

export function getSupabaseEnv(): SupabaseEnvConfig {
  const url = readEnv('SUPABASE_URL') || readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  const isConfigured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && serviceRoleKey.length > 20;

  return { url, serviceRoleKey, isConfigured };
}

export function getCronEnv(): CronEnvConfig {
  const secret = readEnv('CRON_SECRET');
  return {
    secret,
    isConfigured: secret.length > 0,
  };
}

export function getCorsEnv(): { appUrl: string; extraOrigins: string[] } {
  const appUrl = readEnv('APP_URL').replace(/\/+$/, '');
  const extraOrigins = readEnv('CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return { appUrl, extraOrigins };
}

export function isAllowedCorsOrigin(origin: string): boolean {
  if (CAPACITOR_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }
  const { appUrl, extraOrigins } = getCorsEnv();
  if (appUrl) {
    try {
      if (new URL(appUrl).origin === origin) return true;
    } catch {
      // ignore invalid APP_URL
    }
  }
  return extraOrigins.includes(origin);
}

export function validateWompiReturnUrl(rawReturnUrl: unknown): string | null {
  if (typeof rawReturnUrl !== 'string') return null;
  const trimmed = rawReturnUrl.trim();
  if (!trimmed) return null;

  // Allow ClimaPay Capacitor Android Deep Link
  if (/^climapay:\/\/[a-zA-Z0-9/_-]+$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (isAllowedCorsOrigin(parsed.origin)) {
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    }
  } catch {
    return null;
  }
  return null;
}

export function getServerEnv(): ServerRuntimeEnv {
  const { appUrl, extraOrigins } = getCorsEnv();
  return {
    port: Number(process.env.PORT) || 3000,
    isProduction: process.env.NODE_ENV === 'production',
    appUrl,
    corsAllowedOrigins: extraOrigins,
    tuya: getTuyaEnv(),
    wompi: getWompiEnv(),
    supabase: getSupabaseEnv(),
    cron: getCronEnv(),
  };
}
