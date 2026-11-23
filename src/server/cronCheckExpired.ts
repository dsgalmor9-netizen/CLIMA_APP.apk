import crypto from 'node:crypto';
import { getCronEnv } from '../config/env.ts';
import {
  consumeExpiredSessionsForShutoff,
  hasAnyActivePoweredOnSession,
  recordPowerOffTimestamp,
  recordUserCommand,
} from '../services/session.service.ts';
import { setDevicePower } from '../services/tuya.service.ts';
import type { UserDeviceSessionRecord } from '../types/session.ts';
import {
  findActivePoweredSupabaseDevices,
  isSupabaseConfigured,
  updateSupabaseDeviceAfterCron,
} from './supabaseClient.ts';

export interface CronCheckDeviceOutcome {
  deviceId: string;
  previousRemainingSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  turnedOff: boolean;
  tuyaCommandOk?: boolean;
  errorMessage?: string;
}

export interface CronCheckExpiredResult {
  ok: boolean;
  statusCode: number;
  source: 'supabase' | 'local_ledger';
  checkedAt: string;
  checkedCount: number;
  shutoffCount: number;
  outcomes: CronCheckDeviceOutcome[];
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Constant-time CRON_SECRET verification supporting either:
 * - `Authorization: Bearer <CRON_SECRET>`
 * - `x-cron-secret: <CRON_SECRET>`
 */
export function verifyCronSecretHeader(headers: {
  authorization?: string | null;
  cronSecretHeader?: string | null;
}): { ok: boolean; statusCode: number; errorCode?: string; errorMessage?: string } {
  const { secret: configuredSecret, isConfigured } = getCronEnv();
  if (!isConfigured) {
    return {
      ok: false,
      statusCode: 503,
      errorCode: 'CRON_SECRET_NOT_CONFIGURED',
      errorMessage: 'CRON_SECRET no está configurado en las variables de entorno del servidor.',
    };
  }

  let provided = (headers.cronSecretHeader || '').trim();
  if (!provided && headers.authorization) {
    const match = headers.authorization.trim().match(/^Bearer\s+(.+)$/i);
    if (match) {
      provided = match[1].trim();
    }
  }

  if (!provided) {
    return {
      ok: false,
      statusCode: 401,
      errorCode: 'UNAUTHORIZED_CRON',
      errorMessage: 'Falta el encabezado de autenticación CRON_SECRET.',
    };
  }

  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return {
      ok: false,
      statusCode: 401,
      errorCode: 'INVALID_CRON_SECRET',
      errorMessage: 'Credencial CRON_SECRET inválida.',
    };
  }

  return { ok: true, statusCode: 200 };
}

/**
 * Multi-device free-tier cron execution engine (`/api/cron/check-expired`):
 * - Checks all active devices (`is_powered_on = true`) in Supabase PostgreSQL (or local repository fallback)
 * - Computes elapsed seconds since `last_started_at`
 * - Updates `remaining_seconds`
 * - Sends `OFF` to Tuya for each specific `device_id` and records per-device `lastOffAt`
 */
export async function runCheckExpiredDevicesCron(nowMs = Date.now()): Promise<CronCheckExpiredResult> {
  const nowIso = new Date(nowMs).toISOString();
  const outcomes: CronCheckDeviceOutcome[] = [];
  let shutoffCount = 0;

  if (isSupabaseConfigured()) {
    const activeDevices = await findActivePoweredSupabaseDevices();

    for (const device of activeDevices) {
      const startedMs = device.last_started_at ? Date.parse(device.last_started_at) : Number.NaN;
      const elapsedSeconds = Number.isFinite(startedMs)
        ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
        : 0;
      const previousRemaining = Math.max(0, Math.floor(Number(device.remaining_seconds) || 0));
      const nextRemaining = Math.max(0, previousRemaining - elapsedSeconds);

      if (nextRemaining <= 0) {
        const tuyaRes = await setDevicePower(false, device.device_id);
        const tuyaOk = tuyaRes.success && tuyaRes.commandAccepted;

        await updateSupabaseDeviceAfterCron({
          deviceId: device.device_id,
          remainingSeconds: 0,
          isPoweredOn: false,
          lastStartedAtIso: null,
          lastOffAtIso: tuyaOk ? nowIso : undefined,
        });

        if (tuyaOk) {
          recordPowerOffTimestamp(device.device_id, nowMs);
        }
        shutoffCount += 1;
        outcomes.push({
          deviceId: device.device_id,
          previousRemainingSeconds: previousRemaining,
          elapsedSeconds,
          remainingSeconds: 0,
          turnedOff: true,
          tuyaCommandOk: tuyaOk,
          errorMessage: tuyaOk ? undefined : tuyaRes.errorMessage,
        });
      } else if (elapsedSeconds > 0) {
        await updateSupabaseDeviceAfterCron({
          deviceId: device.device_id,
          remainingSeconds: nextRemaining,
          isPoweredOn: true,
          lastStartedAtIso: nowIso,
        });

        outcomes.push({
          deviceId: device.device_id,
          previousRemainingSeconds: previousRemaining,
          elapsedSeconds,
          remainingSeconds: nextRemaining,
          turnedOff: false,
        });
      } else {
        outcomes.push({
          deviceId: device.device_id,
          previousRemainingSeconds: previousRemaining,
          elapsedSeconds: 0,
          remainingSeconds: previousRemaining,
          turnedOff: false,
        });
      }
    }

    return {
      ok: true,
      statusCode: 200,
      source: 'supabase',
      checkedAt: nowIso,
      checkedCount: activeDevices.length,
      shutoffCount,
      outcomes,
    };
  }

  // Multi-device fallback when running without SUPABASE_URL configured yet
  const expiredSessions = consumeExpiredSessionsForShutoff(nowMs);
  const byDevice = new Map<string, UserDeviceSessionRecord[]>();
  for (const session of expiredSessions) {
    const list = byDevice.get(session.deviceId) ?? [];
    list.push(session);
    byDevice.set(session.deviceId, list);
  }

  for (const [targetDeviceId, expiredForDevice] of byDevice.entries()) {
    if (hasAnyActivePoweredOnSession(targetDeviceId, nowMs)) {
      continue;
    }

    const tuyaRes = await setDevicePower(false, targetDeviceId);
    const tuyaOk = tuyaRes.success && tuyaRes.commandAccepted;
    if (tuyaOk) {
      recordPowerOffTimestamp(targetDeviceId, nowMs);
    }

    for (const user of expiredForDevice) {
      recordUserCommand({
        uid: user.uid,
        deviceId: targetDeviceId,
        action: 'APAGAR',
        ok: tuyaOk,
        summary: tuyaOk
          ? 'Cron: corte automático de energía al llegar a 00:00:00.'
          : `Cron: error al apagar equipo (${tuyaRes.errorMessage || 'sin respuesta Tuya'}).`,
        tuyaCode: tuyaRes.errorCode ?? (tuyaOk ? 'CRON_AUTO_OFF' : 'ERROR'),
        tuyaTid: tuyaRes.tuyaTid,
      });
    }

    shutoffCount += 1;
    outcomes.push({
      deviceId: targetDeviceId,
      previousRemainingSeconds: 0,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      turnedOff: true,
      tuyaCommandOk: tuyaOk,
      errorMessage: tuyaOk ? undefined : tuyaRes.errorMessage,
    });
  }

  return {
    ok: true,
    statusCode: 200,
    source: 'local_ledger',
    checkedAt: nowIso,
    checkedCount: expiredSessions.length,
    shutoffCount,
    outcomes,
  };
}
