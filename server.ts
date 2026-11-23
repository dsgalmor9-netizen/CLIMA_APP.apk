import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIMATE_TEMP_MAX_C,
  CLIMATE_TEMP_MIN_C,
  COMPRESSOR_COOLDOWN_SECONDS,
  isValidClimateMode,
  isValidClimateTemp,
  isValidFanSpeed,
} from './src/config/climate.ts';
import {
  getServerEnv,
  isAllowedCorsOrigin,
  resolveDeviceId,
} from './src/config/env.ts';
import {
  BASE_HOURLY_RATE_COP,
  MAX_HOURS,
  formatDurationHms,
} from './src/config/plans.ts';
import { getStorageRepository } from './src/repositories/storage.repository.ts';
import {
  runCheckExpiredDevicesCron,
  verifyCronSecretHeader,
} from './src/server/cronCheckExpired.ts';
import { verifyFirebaseIdToken } from './src/server/firebaseAuthVerify.ts';
import {
  createFallbackTurnstileChallenge,
  getTurnstileConfig,
  verifyTurnstileToken,
} from './src/server/turnstile.ts';
import {
  executeExpiredSessionsShutoff,
  getAuthoritativeCompressorCooldown,
  getClimateState,
  getCompressorCooldownSnapshot,
  getUserAccountState,
  getUserRemainingSeconds,
  hasAnyActivePoweredOnSession,
  pauseUserActiveTimer,
  recordPowerOffTimestamp,
  recordUserCommand,
  startUserActiveTimer,
  syncSessionStateToRemote,
  updateClimateState,
} from './src/services/session.service.ts';
import {
  getDeviceStatus,
  getTuyaConfig,
  sendDeviceClimateCommand,
  setDevicePower,
} from './src/services/tuya.service.ts';
import {
  createWompiCheckoutSession,
  getWompiConfig,
  processWompiWebhookEvent,
  verifyAndConfirmWompiTransaction,
} from './src/services/wompi.service.ts';
import type { WompiWebhookPayload } from './src/types/wompi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function authenticateRequest(
  req: Request,
  res: Response
): Promise<{ uid: string; email: string; emailVerified: boolean; name: string } | null> {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      errorMessage: 'Debes iniciar sesión para realizar esta operación.',
    });
    return null;
  }

  try {
    return await verifyFirebaseIdToken(match[1].trim());
  } catch (err) {
    res.status(401).json({
      success: false,
      errorCode: 'INVALID_TOKEN',
      errorMessage:
        err instanceof Error ? err.message : 'Token de sesión inválido o expirado.',
    });
    return null;
  }
}

function extractValidatedDeviceId(req: Request, res: Response): string | null {
  const body = req.body as { deviceId?: unknown } | undefined;
  const requested = req.query.deviceId ?? body?.deviceId;
  const resolved = resolveDeviceId(requested);
  if (!resolved.isValid) {
    res.status(400).json({
      success: false,
      errorCode: 'INVALID_DEVICE_ID',
      errorMessage: 'El identificador de dispositivo (deviceId) tiene un formato inválido.',
    });
    return null;
  }
  return resolved.deviceId;
}

async function startServer() {
  const env = getServerEnv();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Allowlisted CORS middleware for Capacitor Android APK -> Cloud API requests
  app.use('/api', (req: Request, res: Response, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (origin && isAllowedCorsOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-cron-secret'
      );
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // Recover any expired active sessions immediately on boot/restart
  void executeExpiredSessionsShutoff();

  app.get('/api/health', (req: Request, res: Response) => {
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    const tuya = getTuyaConfig(deviceId);
    const repo = getStorageRepository();
    const cooldown = getCompressorCooldownSnapshot(tuya.deviceId);
    res.json({
      ok: true,
      timerMode: 'on_demand_active_usage',
      persistence: repo.getProviderName(),
      supabaseConfigured: repo.isRemotePersistenceEnabled(),
      deviceId: tuya.deviceId,
      dataCenter: tuya.baseUrl,
      baseHourlyRateCop: BASE_HOURLY_RATE_COP,
      hasActivePoweredSession: hasAnyActivePoweredOnSession(tuya.deviceId),
      compressorCooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
      timestamp: new Date().toISOString(),
    });
  });

  // Free-tier Cron Endpoint (/api/cron/check-expired) protected by CRON_SECRET header
  const handleCronCheckExpired = async (req: Request, res: Response) => {
    const authCheck = verifyCronSecretHeader({
      authorization:
        typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      cronSecretHeader:
        typeof req.headers['x-cron-secret'] === 'string' ? req.headers['x-cron-secret'] : null,
    });

    if (!authCheck.ok) {
      res.status(authCheck.statusCode).json({
        ok: false,
        errorCode: authCheck.errorCode,
        errorMessage: authCheck.errorMessage,
      });
      return;
    }

    try {
      const result = await runCheckExpiredDevicesCron();
      res.status(result.statusCode).json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        errorCode: 'CRON_EXECUTION_ERROR',
        errorMessage:
          err instanceof Error ? err.message : 'Error al verificar dispositivos expirados.',
      });
    }
  };
  app.get('/api/cron/check-expired', handleCronCheckExpired);
  app.post('/api/cron/check-expired', handleCronCheckExpired);

  app.get('/api/config/public', (req: Request, res: Response) => {
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    const turnstile = getTurnstileConfig();
    const tuya = getTuyaConfig(deviceId);
    const wompi = getWompiConfig();

    res.json({
      turnstileSiteKey: turnstile.siteKey,
      turnstileMode: turnstile.mode,
      wompiConfigured: wompi.isConfigured,
      wompiPublicKey: wompi.isConfigured ? wompi.publicKey : null,
      deviceId: tuya.deviceId,
      tuyaBaseUrl: tuya.baseUrl,
      maxHours: MAX_HOURS,
      baseHourlyRateCop: BASE_HOURLY_RATE_COP,
      tempMinC: CLIMATE_TEMP_MIN_C,
      tempMaxC: CLIMATE_TEMP_MAX_C,
      compressorCooldownSeconds: COMPRESSOR_COOLDOWN_SECONDS,
    });
  });

  app.get('/api/auth/turnstile-challenge', (_req: Request, res: Response) => {
    const challenge = createFallbackTurnstileChallenge();
    res.json({
      success: true,
      mode: getTurnstileConfig().mode,
      ...challenge,
    });
  });

  app.post('/api/auth/verify-turnstile', async (req: Request, res: Response) => {
    const body = req.body as { token?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token : '';
    const forwardedFor = (req.headers['x-forwarded-for'] as string | undefined) || '';
    const remoteIp = forwardedFor.split(',')[0].trim() || req.socket.remoteAddress || undefined;

    const result = await verifyTurnstileToken(token, remoteIp);
    if (!result.ok) {
      res.status(400).json({
        success: false,
        mode: result.mode,
        errorMessage: result.errorMessage,
      });
      return;
    }

    res.json({
      success: true,
      mode: result.mode,
      verifiedAt: new Date().toISOString(),
    });
  });

  // Authenticated user's authoritative multi-device state
  app.get('/api/account/state', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    await executeExpiredSessionsShutoff(deviceId);
    const now = Date.now();
    const cooldown = await getAuthoritativeCompressorCooldown(deviceId, now);
    const state = getUserAccountState(user.uid, user.email, deviceId);
    res.json({
      success: true,
      ...state,
      lastOffAt: cooldown.active ? cooldown.lastOffAt : null,
      cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
      serverNowMs: now,
    });
  });

  // Wompi Checkout Session Creation (authoritative server-side pricing + SHA-256 signature)
  const handleWompiCheckout = async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    const body = req.body as { planId?: unknown; hours?: unknown; returnUrl?: unknown } | undefined;
    const result = createWompiCheckoutSession({
      uid: user.uid,
      email: user.email,
      deviceId,
      planId: body?.planId,
      hours: body?.hours,
      returnUrl: body?.returnUrl,
    });
    res.status(result.statusCode).json(result.body);
  };
  app.post('/api/payments/wompi/checkout', handleWompiCheckout);
  app.post('/api/wompi/checkout', handleWompiCheckout);

  // Wompi Webhook Endpoint — strictly verifies SHA-256 signature + idempotent credit
  const handleWompiWebhook = async (req: Request, res: Response) => {
    const payload = (req.body || {}) as WompiWebhookPayload;
    const headerChecksum =
      typeof req.headers['x-event-checksum'] === 'string'
        ? req.headers['x-event-checksum']
        : undefined;

    const result = await processWompiWebhookEvent({ payload, headerChecksum });
    res.status(result.statusCode).json(result.body);
  };
  app.post('/api/payments/wompi/webhook', handleWompiWebhook);
  app.post('/api/wompi/webhook', handleWompiWebhook);

  // Authenticated Wompi Transaction Verification (credits time strictly in paused state)
  const handleWompiVerify = async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    const body = req.body as { transactionId?: unknown } | undefined;
    const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : '';

    const result = await verifyAndConfirmWompiTransaction({
      uid: user.uid,
      email: user.email,
      transactionId,
      fallbackDeviceId: deviceId,
    });
    res.status(result.statusCode).json(result.body);
  };
  app.post('/api/payments/wompi/verify', handleWompiVerify);
  app.post('/api/wompi/verify', handleWompiVerify);

  // Tuya Cloud Device Status (supports dynamic ?deviceId=...)
  const handleTuyaStatus = async (req: Request, res: Response) => {
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    try {
      await executeExpiredSessionsShutoff(deviceId);
      const status = await getDeviceStatus(deviceId);
      const climate = getClimateState(deviceId);
      const now = Date.now();
      const cooldown = await getAuthoritativeCompressorCooldown(deviceId, now);

      res.status(status.success ? 200 : 502).json({
        ...status,
        climate,
        lastOffAt: cooldown.active ? cooldown.lastOffAt : null,
        cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
        serverNowMs: now,
        autoOffAtMs: 0,
        autoOffRemainingSeconds: 0,
        autoOffTriggeredNow: false,
      });
    } catch (error) {
      const config = getTuyaConfig(deviceId);
      const now = Date.now();
      const cooldown = getCompressorCooldownSnapshot(deviceId, now);
      const message =
        error instanceof Error
          ? error.message
          : 'Error inesperado al consultar el estado del dispositivo.';
      res.status(502).json({
        success: false,
        deviceId: config.deviceId,
        deviceName: null,
        dataCenter: config.baseUrl,
        online: null,
        switchOn: null,
        climate: getClimateState(deviceId),
        telemetry: {
          voltageV: null,
          rawVoltage: null,
          currentMa: null,
          powerW: null,
          rawPower: null,
        },
        statusList: [],
        tuyaTimestamp: null,
        tuyaTid: null,
        serverTimestamp: new Date().toISOString(),
        lastOffAt: cooldown.active ? cooldown.lastOffAt : null,
        cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
        serverNowMs: now,
        autoOffAtMs: 0,
        autoOffRemainingSeconds: 0,
        errorMessage: message,
      });
    }
  };
  app.get('/api/device/status', handleTuyaStatus);
  app.get('/api/tuya/status', handleTuyaStatus);

  // Unified Tuya Cloud Control Endpoint (/api/tuya/control)
  app.post('/api/tuya/control', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    await executeExpiredSessionsShutoff(deviceId);

    const body = req.body as { command?: unknown; value?: unknown } | undefined;
    const command = body?.command;
    if (
      command !== 'power' &&
      command !== 'temp_set' &&
      command !== 'mode' &&
      command !== 'fan_speed_enum'
    ) {
      res.status(400).json({
        success: false,
        deviceId,
        errorCode: 'INVALID_COMMAND',
        errorMessage: 'Comando inválido. Usa power, temp_set, mode o fan_speed_enum.',
      });
      return;
    }

    const balance = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
    if (balance.remainingSeconds <= 0) {
      res.status(402).json({
        success: false,
        deviceId,
        command,
        commandAccepted: false,
        hardwareSynced: false,
        climate: getClimateState(deviceId),
        remainingSeconds: 0,
        bankedRemainingSeconds: 0,
        sessionTotalSeconds: 0,
        isPoweredOn: false,
        lastStartedAt: null,
        activeUntilMs: 0,
        autoOffAtMs: 0,
        serverNowMs: Date.now(),
        errorCode: 'TIME_EXPIRED',
        errorMessage:
          'Tu tiempo disponible llegó a 00:00:00. Recarga horas para controlar el equipo.',
      });
      return;
    }

    if (command === 'power') {
      if (typeof body?.value !== 'boolean') {
        res.status(400).json({
          success: false,
          deviceId,
          errorCode: 'INVALID_VALUE',
          errorMessage: 'El comando power requiere un valor booleano.',
        });
        return;
      }

      const turnOn = body.value;
      const wasPoweredOn = balance.isPoweredOn;
      const now = Date.now();

      // Compressor protection blocks ONLY re-ignition (OFF -> ON) within 120s after ON -> OFF.
      if (turnOn) {
        const cooldown = await getAuthoritativeCompressorCooldown(deviceId, now);
        if (cooldown.active) {
          const mins = String(Math.floor(cooldown.cooldownRemainingSeconds / 60)).padStart(2, '0');
          const secs = String(cooldown.cooldownRemainingSeconds % 60).padStart(2, '0');
          res.status(429).json({
            success: false,
            deviceId,
            command: 'power',
            commandAccepted: false,
            hardwareSynced: false,
            switchOn: balance.isPoweredOn,
            climate: getClimateState(deviceId),
            remainingSeconds: balance.remainingSeconds,
            bankedRemainingSeconds: balance.bankedRemainingSeconds,
            sessionTotalSeconds: balance.sessionTotalSeconds,
            isPoweredOn: balance.isPoweredOn,
            lastStartedAt: balance.lastStartedAt,
            lastOffAt: cooldown.lastOffAt,
            cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
            activeUntilMs: balance.activeUntilMs,
            autoOffAtMs: 0,
            serverNowMs: now,
            errorCode: 'COMPRESSOR_COOLDOWN',
            errorMessage: `Protección de compresor activa. Espera ${mins}:${secs} para volver a encender.`,
          });
          return;
        }
      }

      const result = await setDevicePower(turnOn, deviceId);
      const hardwareOk = result.success && result.commandAccepted;
      const toggleNow = Date.now();

      const nextBalance = hardwareOk
        ? turnOn
          ? startUserActiveTimer(user.uid, user.email, toggleNow, deviceId)
          : pauseUserActiveTimer(user.uid, user.email, toggleNow, deviceId)
        : getUserRemainingSeconds(user.uid, user.email, toggleNow, deviceId);

      // Start 120s compressor cooldown ONLY on ON -> OFF shutoff
      const nextCooldown =
        hardwareOk && !turnOn && wasPoweredOn
          ? recordPowerOffTimestamp(deviceId, toggleNow)
          : getCompressorCooldownSnapshot(deviceId, toggleNow);

      if (hardwareOk) {
        void syncSessionStateToRemote({
          deviceId,
          isPoweredOn: nextBalance.isPoweredOn,
          remainingSeconds: nextBalance.remainingSeconds,
          lastStartedAtMs: nextBalance.lastStartedAt,
          lastOffAtMs: nextCooldown.lastOffAt,
          ownerUid: user.uid,
        });
      }

      recordUserCommand({
        uid: user.uid,
        deviceId,
        action: turnOn ? 'PRENDER' : 'APAGAR',
        ok: hardwareOk,
        summary: hardwareOk
          ? turnOn
            ? `switch → true · Uso activo iniciado (${formatDurationHms(nextBalance.remainingSeconds)} disponibles)`
            : `switch → false · Temporizador pausado en ${formatDurationHms(nextBalance.remainingSeconds)}`
          : result.errorMessage || 'Tuya Cloud rechazó el comando.',
        tuyaCode:
          result.errorCode ?? (hardwareOk ? (turnOn ? 'TIMER_STARTED' : 'TIMER_PAUSED') : 'ERROR'),
        tuyaTid: result.tuyaTid,
      });

      res.status(result.success ? 200 : 502).json({
        success: result.success,
        deviceId,
        command: 'power',
        commandAccepted: result.commandAccepted,
        hardwareSynced: hardwareOk,
        switchOn: hardwareOk ? turnOn : null,
        climate: getClimateState(deviceId),
        remainingSeconds: nextBalance.remainingSeconds,
        bankedRemainingSeconds: nextBalance.bankedRemainingSeconds,
        sessionTotalSeconds: nextBalance.sessionTotalSeconds,
        isPoweredOn: nextBalance.isPoweredOn,
        lastStartedAt: nextBalance.lastStartedAt,
        lastOffAt: !turnOn && nextCooldown.active ? nextCooldown.lastOffAt : null,
        cooldownRemainingSeconds: !turnOn ? nextCooldown.cooldownRemainingSeconds : 0,
        activeUntilMs: nextBalance.activeUntilMs,
        autoOffAtMs: 0,
        serverNowMs: nextBalance.serverNowMs,
        tuyaTid: result.tuyaTid,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      return;
    }

    if (command === 'temp_set') {
      const tempNum = Number(body?.value);
      if (!isValidClimateTemp(tempNum)) {
        res.status(400).json({
          success: false,
          deviceId,
          errorCode: 'INVALID_TEMP',
          errorMessage: `La temperatura debe estar entre ${CLIMATE_TEMP_MIN_C}°C y ${CLIMATE_TEMP_MAX_C}°C.`,
        });
        return;
      }

      const updatedClimate = updateClimateState({ tempSet: tempNum }, deviceId);
      const tuyaRes = await sendDeviceClimateCommand('temp_set', tempNum, deviceId).catch(() => ({
        deviceId,
        hardwareSynced: false,
        tuyaTid: null,
      }));

      recordUserCommand({
        uid: user.uid,
        deviceId,
        action: 'CLIMA',
        ok: true,
        summary: `Temperatura ajustada a ${tempNum}°C${tuyaRes.hardwareSynced ? ' · Tuya sincronizado' : ''}`,
        tuyaCode: tuyaRes.hardwareSynced ? 'TEMP_SYNCED' : 'TEMP_LOCAL',
        tuyaTid: tuyaRes.tuyaTid,
      });

      const freshBalance = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
      res.json({
        success: true,
        deviceId,
        command: 'temp_set',
        commandAccepted: true,
        hardwareSynced: tuyaRes.hardwareSynced,
        climate: updatedClimate,
        remainingSeconds: freshBalance.remainingSeconds,
        bankedRemainingSeconds: freshBalance.bankedRemainingSeconds,
        sessionTotalSeconds: freshBalance.sessionTotalSeconds,
        isPoweredOn: freshBalance.isPoweredOn,
        lastStartedAt: freshBalance.lastStartedAt,
        activeUntilMs: freshBalance.activeUntilMs,
        serverNowMs: freshBalance.serverNowMs,
        tuyaTid: tuyaRes.tuyaTid,
      });
      return;
    }

    if (command === 'mode') {
      const modeVal = body?.value;
      if (!isValidClimateMode(modeVal)) {
        res.status(400).json({
          success: false,
          deviceId,
          errorCode: 'INVALID_MODE',
          errorMessage: 'Modo inválido. Usa cool, dry, fan o auto.',
        });
        return;
      }

      const updatedClimate = updateClimateState({ mode: modeVal }, deviceId);
      const tuyaRes = await sendDeviceClimateCommand('mode', modeVal, deviceId).catch(() => ({
        deviceId,
        hardwareSynced: false,
        tuyaTid: null,
      }));

      recordUserCommand({
        uid: user.uid,
        deviceId,
        action: 'CLIMA',
        ok: true,
        summary: `Modo cambiado a ${modeVal.toUpperCase()}${tuyaRes.hardwareSynced ? ' · Tuya sincronizado' : ''}`,
        tuyaCode: tuyaRes.hardwareSynced ? 'MODE_SYNCED' : 'MODE_LOCAL',
        tuyaTid: tuyaRes.tuyaTid,
      });

      const freshBalance = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
      res.json({
        success: true,
        deviceId,
        command: 'mode',
        commandAccepted: true,
        hardwareSynced: tuyaRes.hardwareSynced,
        climate: updatedClimate,
        remainingSeconds: freshBalance.remainingSeconds,
        bankedRemainingSeconds: freshBalance.bankedRemainingSeconds,
        sessionTotalSeconds: freshBalance.sessionTotalSeconds,
        isPoweredOn: freshBalance.isPoweredOn,
        lastStartedAt: freshBalance.lastStartedAt,
        activeUntilMs: freshBalance.activeUntilMs,
        serverNowMs: freshBalance.serverNowMs,
        tuyaTid: tuyaRes.tuyaTid,
      });
      return;
    }

    // fan_speed_enum
    const fanVal = body?.value;
    if (!isValidFanSpeed(fanVal)) {
      res.status(400).json({
        success: false,
        deviceId,
        errorCode: 'INVALID_FAN',
        errorMessage: 'Velocidad de ventilador inválida. Usa auto, low, mid o high.',
      });
      return;
    }

    const updatedClimate = updateClimateState({ fanSpeed: fanVal }, deviceId);
    const tuyaRes = await sendDeviceClimateCommand('fan_speed_enum', fanVal, deviceId).catch(
      () => ({
        deviceId,
        hardwareSynced: false,
        tuyaTid: null,
      })
    );

    recordUserCommand({
      uid: user.uid,
      deviceId,
      action: 'CLIMA',
      ok: true,
      summary: `Ventilador ajustado a ${fanVal.toUpperCase()}${tuyaRes.hardwareSynced ? ' · Tuya sincronizado' : ''}`,
      tuyaCode: tuyaRes.hardwareSynced ? 'FAN_SYNCED' : 'FAN_LOCAL',
      tuyaTid: tuyaRes.tuyaTid,
    });

    const freshBalance = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
    res.json({
      success: true,
      deviceId,
      command: 'fan_speed_enum',
      commandAccepted: true,
      hardwareSynced: tuyaRes.hardwareSynced,
      climate: updatedClimate,
      remainingSeconds: freshBalance.remainingSeconds,
      bankedRemainingSeconds: freshBalance.bankedRemainingSeconds,
      sessionTotalSeconds: freshBalance.sessionTotalSeconds,
      isPoweredOn: freshBalance.isPoweredOn,
      lastStartedAt: freshBalance.lastStartedAt,
      activeUntilMs: freshBalance.activeUntilMs,
      serverNowMs: freshBalance.serverNowMs,
      tuyaTid: tuyaRes.tuyaTid,
    });
  });

  // Tuya Cloud Device Power Command — Gated strictly by remainingSeconds > 0 & per-device cooldown
  app.post('/api/device/power', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;
    const deviceId = extractValidatedDeviceId(req, res);
    if (deviceId === null) return;

    await executeExpiredSessionsShutoff(deviceId);

    const body = req.body as { on?: unknown } | undefined;
    const config = getTuyaConfig(deviceId);

    if (!body || typeof body.on !== 'boolean') {
      res.status(400).json({
        success: false,
        deviceId: config.deviceId,
        requestedState: false,
        commandAccepted: false,
        tuyaResult: null,
        tuyaTimestamp: null,
        tuyaTid: null,
        serverTimestamp: new Date().toISOString(),
        errorCode: 'INVALID_BODY',
        errorMessage: 'El cuerpo JSON debe incluir { "on": true } o { "on": false }.',
      });
      return;
    }

    const balance = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
    if (balance.remainingSeconds <= 0) {
      recordUserCommand({
        uid: user.uid,
        deviceId,
        action: body.on ? 'PRENDER' : 'APAGAR',
        ok: false,
        summary: 'Bloqueado: sin tiempo disponible (00:00:00). Compra horas para continuar.',
        tuyaCode: 'TIME_EXPIRED',
      });

      res.status(402).json({
        success: false,
        deviceId: config.deviceId,
        requestedState: body.on,
        commandAccepted: false,
        tuyaResult: null,
        tuyaTimestamp: null,
        tuyaTid: null,
        serverTimestamp: new Date().toISOString(),
        remainingSeconds: 0,
        bankedRemainingSeconds: 0,
        sessionTotalSeconds: 0,
        isPoweredOn: false,
        lastStartedAt: null,
        activeUntilMs: 0,
        autoOffAtMs: 0,
        serverNowMs: Date.now(),
        errorCode: 'TIME_EXPIRED',
        errorMessage:
          'Tu tiempo disponible llegó a 00:00:00. Compra horas para controlar el interruptor.',
      });
      return;
    }

    const now = Date.now();
    const wasPoweredOn = balance.isPoweredOn;

    if (body.on) {
      const cooldown = await getAuthoritativeCompressorCooldown(deviceId, now);
      if (cooldown.active) {
        const mins = String(Math.floor(cooldown.cooldownRemainingSeconds / 60)).padStart(2, '0');
        const secs = String(cooldown.cooldownRemainingSeconds % 60).padStart(2, '0');
        res.status(429).json({
          success: false,
          deviceId: config.deviceId,
          requestedState: body.on,
          commandAccepted: false,
          tuyaResult: null,
          tuyaTimestamp: null,
          tuyaTid: null,
          serverTimestamp: new Date(now).toISOString(),
          remainingSeconds: balance.remainingSeconds,
          bankedRemainingSeconds: balance.bankedRemainingSeconds,
          sessionTotalSeconds: balance.sessionTotalSeconds,
          isPoweredOn: balance.isPoweredOn,
          lastStartedAt: balance.lastStartedAt,
          lastOffAt: cooldown.lastOffAt,
          cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
          activeUntilMs: balance.activeUntilMs,
          autoOffAtMs: 0,
          serverNowMs: now,
          errorCode: 'COMPRESSOR_COOLDOWN',
          errorMessage: `Protección de compresor activa. Espera ${mins}:${secs} para volver a encender.`,
        });
        return;
      }
    }

    try {
      const result = await setDevicePower(body.on, deviceId);
      const action = body.on ? 'PRENDER' : 'APAGAR';
      const hardwareOk = result.success && result.commandAccepted;
      const toggleNow = Date.now();

      const nextBalance = hardwareOk
        ? body.on
          ? startUserActiveTimer(user.uid, user.email, toggleNow, deviceId)
          : pauseUserActiveTimer(user.uid, user.email, toggleNow, deviceId)
        : getUserRemainingSeconds(user.uid, user.email, toggleNow, deviceId);

      const nextCooldown =
        hardwareOk && !body.on && wasPoweredOn
          ? recordPowerOffTimestamp(deviceId, toggleNow)
          : getCompressorCooldownSnapshot(deviceId, toggleNow);

      if (hardwareOk) {
        void syncSessionStateToRemote({
          deviceId: config.deviceId,
          isPoweredOn: nextBalance.isPoweredOn,
          remainingSeconds: nextBalance.remainingSeconds,
          lastStartedAtMs: nextBalance.lastStartedAt,
          lastOffAtMs: nextCooldown.lastOffAt,
          ownerUid: user.uid,
        });
      }

      recordUserCommand({
        uid: user.uid,
        deviceId,
        action,
        ok: hardwareOk,
        summary: hardwareOk
          ? body.on
            ? `switch → true · Uso activo iniciado (${formatDurationHms(nextBalance.remainingSeconds)} disponibles)`
            : `switch → false · Temporizador pausado en ${formatDurationHms(nextBalance.remainingSeconds)}`
          : result.errorMessage || 'Tuya Cloud rechazó el comando.',
        tuyaCode:
          result.errorCode ?? (hardwareOk ? (body.on ? 'TIMER_STARTED' : 'TIMER_PAUSED') : 'ERROR'),
        tuyaTid: result.tuyaTid,
      });

      res.status(result.success ? 200 : 502).json({
        ...result,
        remainingSeconds: nextBalance.remainingSeconds,
        bankedRemainingSeconds: nextBalance.bankedRemainingSeconds,
        sessionTotalSeconds: nextBalance.sessionTotalSeconds,
        isPoweredOn: nextBalance.isPoweredOn,
        lastStartedAt: nextBalance.lastStartedAt,
        lastOffAt: !body.on && nextCooldown.active ? nextCooldown.lastOffAt : null,
        cooldownRemainingSeconds: !body.on ? nextCooldown.cooldownRemainingSeconds : 0,
        activeUntilMs: nextBalance.activeUntilMs,
        autoOffAtMs: 0,
        serverNowMs: nextBalance.serverNowMs,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error inesperado al enviar el comando a Tuya Cloud.';
      recordUserCommand({
        uid: user.uid,
        deviceId,
        action: body.on ? 'PRENDER' : 'APAGAR',
        ok: false,
        summary: message,
        tuyaCode: 'NETWORK_ERROR',
      });
      const current = getUserRemainingSeconds(user.uid, user.email, Date.now(), deviceId);
      res.status(502).json({
        success: false,
        deviceId: config.deviceId,
        requestedState: body.on,
        commandAccepted: false,
        tuyaResult: null,
        tuyaTimestamp: null,
        tuyaTid: null,
        serverTimestamp: new Date().toISOString(),
        remainingSeconds: current.remainingSeconds,
        bankedRemainingSeconds: current.bankedRemainingSeconds,
        sessionTotalSeconds: current.sessionTotalSeconds,
        isPoweredOn: current.isPoweredOn,
        lastStartedAt: current.lastStartedAt,
        activeUntilMs: current.activeUntilMs,
        serverNowMs: current.serverNowMs,
        errorMessage: message,
      });
    }
  });

  // 1-second authoritative multi-device sweep for automatic cutoff at 00:00:00
  setInterval(() => {
    void executeExpiredSessionsShutoff();
  }, 1_000);

  const distDir = path.resolve(__dirname, 'dist');
  const shouldServeStatic = env.isProduction && fs.existsSync(path.join(distDir, 'index.html'));

  if (shouldServeStatic) {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[server] Running on http://0.0.0.0:${env.port}`);
  });
}

startServer().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
