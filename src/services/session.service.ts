import crypto from 'node:crypto';
import { COMPRESSOR_COOLDOWN_MS } from '../config/climate.ts';
import { getDefaultDeviceId } from '../config/env.ts';
import { formatCop } from '../config/plans.ts';
import { getStorageRepository } from '../repositories/storage.repository.ts';
import type { PricingQuote } from '../types/plans.ts';
import type {
  ActivityActionType,
  ActivityLogEntry,
  CompressorCooldownSnapshot,
  StoredCommandEntry,
  StoredPaymentOrder,
  UserDeviceSessionRecord,
  UserTimeSnapshot,
} from '../types/session.ts';
import type { ClimateControlState } from '../types/tuya.ts';
import type { PaymentRecordItem } from '../types/wompi.ts';
import { setDevicePower } from './tuya.service.ts';

export { COMPRESSOR_COOLDOWN_MS };
export type {
  CompressorCooldownSnapshot,
  UserDeviceSessionRecord,
  UserDeviceSessionRecord as UserAccountRecord,
  UserTimeSnapshot,
};

const shutoffInFlightByDevice = new Map<string, Promise<boolean>>();

function resolveTargetDeviceId(deviceId?: string): string {
  const trimmed = typeof deviceId === 'string' ? deviceId.trim() : '';
  return trimmed || getDefaultDeviceId() || 'default';
}

function computeEffectiveRemainingSeconds(
  session: UserDeviceSessionRecord,
  now = Date.now()
): number {
  const banked = Math.max(0, Math.floor(Number(session.remainingSeconds) || 0));
  if (!session.isPoweredOn || !session.lastStartedAt || session.lastStartedAt <= 0) {
    return banked;
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - session.lastStartedAt) / 1000));
  return Math.max(0, banked - elapsedSeconds);
}

function ensureUserSession(
  uid: string,
  email = '',
  deviceId?: string
): UserDeviceSessionRecord {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const repo = getStorageRepository();
  const existing = repo.getSession(uid, targetDeviceId);

  if (existing) {
    let changed = false;
    if (email && !existing.email) {
      existing.email = email;
      changed = true;
    }
    if (typeof existing.remainingSeconds !== 'number' || !Number.isFinite(existing.remainingSeconds)) {
      existing.remainingSeconds = 0;
      changed = true;
    }
    if (typeof existing.isPoweredOn !== 'boolean') {
      existing.isPoweredOn = false;
      changed = true;
    }
    if (existing.lastStartedAt !== null && typeof existing.lastStartedAt !== 'number') {
      existing.lastStartedAt = null;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      return repo.upsertSession(existing);
    }
    return existing;
  }

  // Every user starts strictly with 00:00:00 (remainingSeconds = 0)
  const created: UserDeviceSessionRecord = {
    uid,
    deviceId: targetDeviceId,
    email,
    remainingSeconds: 0,
    isPoweredOn: false,
    lastStartedAt: null,
    sessionTotalSeconds: 0,
    totalPurchasedSeconds: 0,
    updatedAt: new Date().toISOString(),
  };
  return repo.upsertSession(created);
}

function buildCooldownSnapshot(
  deviceId: string,
  lastOffAt: number | null,
  now = Date.now()
): CompressorCooldownSnapshot {
  if (!lastOffAt || lastOffAt <= 0) {
    return {
      deviceId,
      active: false,
      lastOffAt: null,
      cooldownRemainingSeconds: 0,
      cooldownRemainingMs: 0,
    };
  }
  const elapsedMs = now - lastOffAt;
  if (elapsedMs >= COMPRESSOR_COOLDOWN_MS) {
    return {
      deviceId,
      active: false,
      lastOffAt,
      cooldownRemainingSeconds: 0,
      cooldownRemainingMs: 0,
    };
  }
  const cooldownRemainingMs = Math.max(0, COMPRESSOR_COOLDOWN_MS - Math.max(0, elapsedMs));
  return {
    deviceId,
    active: cooldownRemainingMs > 0,
    lastOffAt,
    cooldownRemainingSeconds: Math.ceil(cooldownRemainingMs / 1000),
    cooldownRemainingMs,
  };
}

export function getCompressorCooldownSnapshot(
  deviceIdOrNow?: string | number,
  nowOverride?: number
): CompressorCooldownSnapshot {
  const deviceId =
    typeof deviceIdOrNow === 'string'
      ? resolveTargetDeviceId(deviceIdOrNow)
      : resolveTargetDeviceId(undefined);
  const now =
    typeof deviceIdOrNow === 'number' ? deviceIdOrNow : (nowOverride ?? Date.now());
  const lastOffAt = getStorageRepository().getDeviceLastOffAt(deviceId);
  return buildCooldownSnapshot(deviceId, lastOffAt, now);
}

/**
 * Authoritative 120s compressor protection snapshot per device.
 * Merges local storage with remote persistence (e.g. Supabase `devices.last_off_at`).
 */
export async function getAuthoritativeCompressorCooldown(
  deviceId?: string,
  now = Date.now()
): Promise<CompressorCooldownSnapshot> {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const repo = getStorageRepository();
  let latestOffAt = repo.getDeviceLastOffAt(targetDeviceId);

  const remoteOffAt = await repo.fetchRemoteLastOffAt(targetDeviceId);
  if (remoteOffAt && (!latestOffAt || remoteOffAt > latestOffAt)) {
    latestOffAt = remoteOffAt;
    repo.setDeviceLastOffAt(targetDeviceId, remoteOffAt);
  }

  return buildCooldownSnapshot(targetDeviceId, latestOffAt, now);
}

/**
 * Records `lastOffAt` strictly when an ON -> OFF relay shutoff completes for a device.
 * Turning ON (OFF -> ON) NEVER calls this function.
 */
export function recordPowerOffTimestamp(
  deviceIdOrNow?: string | number,
  nowOverride?: number
): CompressorCooldownSnapshot {
  const deviceId =
    typeof deviceIdOrNow === 'string'
      ? resolveTargetDeviceId(deviceIdOrNow)
      : resolveTargetDeviceId(undefined);
  const now =
    typeof deviceIdOrNow === 'number' ? deviceIdOrNow : (nowOverride ?? Date.now());
  getStorageRepository().setDeviceLastOffAt(deviceId, now);
  return buildCooldownSnapshot(deviceId, now, now);
}

export function getUserRemainingSeconds(
  uid: string,
  email = '',
  now = Date.now(),
  deviceId?: string
): UserTimeSnapshot {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const session = ensureUserSession(uid, email, targetDeviceId);
  const remainingSeconds = computeEffectiveRemainingSeconds(session, now);
  const isActivelyRunning =
    remainingSeconds > 0 && session.isPoweredOn && session.lastStartedAt !== null;
  const bankedRemainingSeconds =
    remainingSeconds > 0 ? Math.max(0, Math.floor(session.remainingSeconds)) : 0;
  const lastStartedAt = isActivelyRunning ? session.lastStartedAt : null;
  const activeUntilMs =
    isActivelyRunning && lastStartedAt !== null
      ? lastStartedAt + bankedRemainingSeconds * 1000
      : 0;
  const sessionTotalSeconds =
    remainingSeconds > 0
      ? Math.max(remainingSeconds, Math.floor(Number(session.sessionTotalSeconds) || remainingSeconds))
      : 0;

  return {
    deviceId: targetDeviceId,
    remainingSeconds,
    bankedRemainingSeconds,
    sessionTotalSeconds,
    isPoweredOn: isActivelyRunning,
    lastStartedAt,
    activeUntilMs,
    serverNowMs: now,
  };
}

/**
 * Starts the active-usage timer strictly when the user manually turns ON the AC.
 */
export function startUserActiveTimer(
  uid: string,
  email = '',
  now = Date.now(),
  deviceId?: string
): UserTimeSnapshot {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const repo = getStorageRepository();
  const session = ensureUserSession(uid, email, targetDeviceId);
  const effective = computeEffectiveRemainingSeconds(session, now);

  if (effective <= 0) {
    session.remainingSeconds = 0;
    session.isPoweredOn = false;
    session.lastStartedAt = null;
    session.sessionTotalSeconds = 0;
    session.updatedAt = new Date(now).toISOString();
    repo.upsertSession(session);
    return getUserRemainingSeconds(uid, email, now, targetDeviceId);
  }

  session.remainingSeconds = effective;
  session.isPoweredOn = true;
  session.lastStartedAt = now;
  if (session.sessionTotalSeconds < effective) {
    session.sessionTotalSeconds = effective;
  }
  session.updatedAt = new Date(now).toISOString();
  repo.upsertSession(session);
  return getUserRemainingSeconds(uid, email, now, targetDeviceId);
}

/**
 * Immediately pauses the active-usage timer when the user manually turns OFF the AC,
 * deducting ONLY elapsed seconds since `lastStartedAt` without losing unused time.
 */
export function pauseUserActiveTimer(
  uid: string,
  email = '',
  now = Date.now(),
  deviceId?: string
): UserTimeSnapshot {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const repo = getStorageRepository();
  const session = ensureUserSession(uid, email, targetDeviceId);
  const effective = computeEffectiveRemainingSeconds(session, now);

  session.remainingSeconds = effective;
  session.isPoweredOn = false;
  session.lastStartedAt = null;
  if (effective <= 0) {
    session.sessionTotalSeconds = 0;
  }
  session.updatedAt = new Date(now).toISOString();
  repo.upsertSession(session);
  return getUserRemainingSeconds(uid, email, now, targetDeviceId);
}

export function getClimateState(deviceId?: string): ClimateControlState {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  return getStorageRepository().getDeviceClimateState(targetDeviceId);
}

export function updateClimateState(
  partial: Partial<ClimateControlState>,
  deviceId?: string
): ClimateControlState {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  return getStorageRepository().setDeviceClimateState(targetDeviceId, partial);
}

export function getUserAccountState(uid: string, email = '', deviceId?: string) {
  const targetDeviceId = resolveTargetDeviceId(deviceId);
  const repo = getStorageRepository();
  const now = Date.now();
  const snapshot = getUserRemainingSeconds(uid, email, now, targetDeviceId);
  const cooldown = getCompressorCooldownSnapshot(targetDeviceId, now);
  const session = repo.getSession(uid, targetDeviceId);

  const payments: PaymentRecordItem[] = repo
    .listUserOrders(uid, targetDeviceId, 20)
    .map(({ uid: _uid, credited: _credited, ...rest }) => rest);

  const commands: ActivityLogEntry[] = repo
    .listUserCommands(uid, targetDeviceId, 20)
    .map(({ uid: _uid, ...rest }) => rest);

  return {
    uid,
    deviceId: targetDeviceId,
    email: session?.email || email,
    remainingSeconds: snapshot.remainingSeconds,
    bankedRemainingSeconds: snapshot.bankedRemainingSeconds,
    sessionTotalSeconds: snapshot.sessionTotalSeconds,
    isPoweredOn: snapshot.isPoweredOn,
    lastStartedAt: snapshot.lastStartedAt,
    lastOffAt: cooldown.active ? cooldown.lastOffAt : null,
    cooldownRemainingSeconds: cooldown.cooldownRemainingSeconds,
    activeUntilMs: snapshot.activeUntilMs,
    autoOffAtMs: 0,
    autoOffRemainingSeconds: 0,
    climate: repo.getDeviceClimateState(targetDeviceId),
    serverNowMs: snapshot.serverNowMs,
    payments,
    commands,
  };
}

function creditPurchasedSeconds(
  session: UserDeviceSessionRecord,
  addedSeconds: number,
  now: number
): void {
  const effectiveBefore = computeEffectiveRemainingSeconds(session, now);
  const wasAlreadyRunning =
    effectiveBefore > 0 && session.isPoweredOn && session.lastStartedAt !== null;

  session.remainingSeconds = effectiveBefore + addedSeconds;
  if (wasAlreadyRunning) {
    session.isPoweredOn = true;
    session.lastStartedAt = now;
    session.sessionTotalSeconds =
      Math.max(Number(session.sessionTotalSeconds) || 0, effectiveBefore) + addedSeconds;
  } else {
    session.isPoweredOn = false;
    session.lastStartedAt = null;
    session.sessionTotalSeconds =
      effectiveBefore > 0
        ? Math.max(Number(session.sessionTotalSeconds) || 0, effectiveBefore) + addedSeconds
        : addedSeconds;
  }

  session.totalPurchasedSeconds += addedSeconds;
  session.updatedAt = new Date(now).toISOString();
}

export function createPendingWompiOrder(params: {
  uid: string;
  email: string;
  pricing: PricingQuote;
  deviceId?: string;
}): { reference: string; deviceId: string; order: PaymentRecordItem } {
  const targetDeviceId = resolveTargetDeviceId(params.deviceId);
  const repo = getStorageRepository();
  ensureUserSession(params.uid, params.email, targetDeviceId);

  const cleanUid = params.uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'USER';
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const reference = `CLIMA_${cleanUid}_${Date.now()}_${rand}`;
  const nowIso = new Date().toISOString();

  const order: StoredPaymentOrder = {
    id: reference,
    uid: params.uid,
    deviceId: targetDeviceId,
    reference,
    transactionId: reference,
    hours: params.pricing.hours,
    addedSeconds: params.pricing.addedSeconds,
    subtotalCop: params.pricing.subtotalCop,
    discountPercent: params.pricing.discountPercent,
    discountCop: params.pricing.discountCop,
    totalCop: params.pricing.totalCop,
    amountInCents: params.pricing.amountInCents,
    currency: 'COP',
    status: 'PENDING',
    credited: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  repo.createOrder(order);

  const { uid: _uid, credited: _credited, ...publicOrder } = order;
  return { reference, deviceId: targetDeviceId, order: publicOrder };
}

export function confirmWompiOrderApproved(params: {
  reference: string;
  transactionId: string;
  amountInCents?: number;
  expectedUid?: string;
}): {
  found: boolean;
  forbidden?: boolean;
  alreadyCredited: boolean;
  uid?: string;
  deviceId?: string;
  order?: PaymentRecordItem;
  remainingSeconds?: number;
  bankedRemainingSeconds?: number;
  sessionTotalSeconds?: number;
  isPoweredOn?: boolean;
  lastStartedAt?: number | null;
  activeUntilMs?: number;
} {
  const repo = getStorageRepository();
  const normalizedTxId = String(params.transactionId || '').trim();

  // Strict idempotency check by Wompi transaction.id BEFORE crediting any seconds
  if (normalizedTxId) {
    const existingRef = repo.findOrderReferenceByTransactionId(normalizedTxId);
    if (existingRef) {
      const existingOrder =
        repo.getOrderByReference(existingRef) || repo.getOrderByReference(params.reference);
      if (existingOrder) {
        if (params.expectedUid && existingOrder.uid !== params.expectedUid) {
          return { found: true, forbidden: true, alreadyCredited: true };
        }
        const balance = getUserRemainingSeconds(
          existingOrder.uid,
          '',
          Date.now(),
          existingOrder.deviceId
        );
        const { uid: _uid, credited: _credited, ...publicOrder } = existingOrder;
        return {
          found: true,
          alreadyCredited: true,
          uid: existingOrder.uid,
          deviceId: existingOrder.deviceId,
          order: publicOrder,
          remainingSeconds: balance.remainingSeconds,
          bankedRemainingSeconds: balance.bankedRemainingSeconds,
          sessionTotalSeconds: balance.sessionTotalSeconds,
          isPoweredOn: balance.isPoweredOn,
          lastStartedAt: balance.lastStartedAt,
          activeUntilMs: balance.activeUntilMs,
        };
      }
    }
  }

  const order = repo.getOrderByReference(params.reference);
  if (!order) {
    return { found: false, alreadyCredited: false };
  }

  if (params.expectedUid && order.uid !== params.expectedUid) {
    return { found: true, forbidden: true, alreadyCredited: false };
  }

  if (order.credited) {
    if (normalizedTxId && !repo.findOrderReferenceByTransactionId(normalizedTxId)) {
      repo.markTransactionCredited(normalizedTxId, order.reference);
    }
    const balance = getUserRemainingSeconds(order.uid, '', Date.now(), order.deviceId);
    const { uid: _uid, credited: _credited, ...publicOrder } = order;
    return {
      found: true,
      alreadyCredited: true,
      uid: order.uid,
      deviceId: order.deviceId,
      order: publicOrder,
      remainingSeconds: balance.remainingSeconds,
      bankedRemainingSeconds: balance.bankedRemainingSeconds,
      sessionTotalSeconds: balance.sessionTotalSeconds,
      isPoweredOn: balance.isPoweredOn,
      lastStartedAt: balance.lastStartedAt,
      activeUntilMs: balance.activeUntilMs,
    };
  }

  if (typeof params.amountInCents === 'number' && params.amountInCents !== order.amountInCents) {
    order.status = 'ERROR';
    order.updatedAt = new Date().toISOString();
    repo.saveOrder(order);
    return { found: true, alreadyCredited: false, deviceId: order.deviceId };
  }

  const targetDeviceId = resolveTargetDeviceId(order.deviceId);
  const session = ensureUserSession(order.uid, '', targetDeviceId);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  creditPurchasedSeconds(session, order.addedSeconds, now);
  repo.upsertSession(session);

  order.status = 'APPROVED';
  order.transactionId = normalizedTxId || order.reference;
  order.credited = true;
  order.updatedAt = nowIso;
  repo.saveOrder(order);
  repo.markTransactionCredited(order.transactionId, order.reference);

  recordUserCommand({
    uid: order.uid,
    deviceId: targetDeviceId,
    action: 'PAGO',
    ok: true,
    summary: `Pago Wompi aprobado (+${order.hours}h · ${formatCop(order.totalCop)}) · Tiempo en pausa listo para encender · Ref ${order.reference}`,
    tuyaCode: 'WOMPI_APPROVED',
    tuyaTid: order.transactionId,
  });

  const balance = getUserRemainingSeconds(order.uid, '', now, targetDeviceId);
  const { uid: _uid, credited: _credited, ...publicOrder } = order;

  return {
    found: true,
    alreadyCredited: false,
    uid: order.uid,
    deviceId: targetDeviceId,
    order: publicOrder,
    remainingSeconds: balance.remainingSeconds,
    bankedRemainingSeconds: balance.bankedRemainingSeconds,
    sessionTotalSeconds: balance.sessionTotalSeconds,
    isPoweredOn: balance.isPoweredOn,
    lastStartedAt: balance.lastStartedAt,
    activeUntilMs: balance.activeUntilMs,
  };
}

export function recordUserCommand(params: {
  uid: string;
  deviceId?: string;
  action: ActivityActionType;
  ok: boolean;
  summary: string;
  tuyaCode?: number | string;
  tuyaTid?: string | null;
}): ActivityLogEntry {
  const targetDeviceId = resolveTargetDeviceId(params.deviceId);
  const entry: StoredCommandEntry = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    uid: params.uid,
    deviceId: targetDeviceId,
    timestamp: new Date().toISOString(),
    action: params.action,
    ok: params.ok,
    summary: params.summary.slice(0, 300),
    tuyaCode: params.tuyaCode,
    tuyaTid: params.tuyaTid ?? null,
  };

  getStorageRepository().appendCommand(entry);

  const { uid: _uid, ...publicEntry } = entry;
  return publicEntry;
}

export function hasAnyActivePoweredOnSession(
  deviceIdOrNow?: string | number,
  nowOverride?: number
): boolean {
  const deviceId = typeof deviceIdOrNow === 'string' ? deviceIdOrNow : undefined;
  const now =
    typeof deviceIdOrNow === 'number' ? deviceIdOrNow : (nowOverride ?? Date.now());
  return getStorageRepository()
    .listSessions(deviceId)
    .some(
      (s) =>
        s.isPoweredOn &&
        s.lastStartedAt !== null &&
        computeEffectiveRemainingSeconds(s, now) > 0
    );
}

/**
 * Finds and settles any active powered-on session whose balance has reached 0.
 * Paused sessions never expire. Supports filtering by specific `deviceId` or sweeping all devices.
 */
export function consumeExpiredSessionsForShutoff(
  now = Date.now(),
  deviceId?: string
): UserDeviceSessionRecord[] {
  const repo = getStorageRepository();
  const expired = repo
    .listSessions(deviceId)
    .filter(
      (s) =>
        s.isPoweredOn &&
        s.lastStartedAt !== null &&
        computeEffectiveRemainingSeconds(s, now) <= 0
    );

  if (expired.length > 0) {
    const nowIso = new Date(now).toISOString();
    for (const session of expired) {
      session.remainingSeconds = 0;
      session.isPoweredOn = false;
      session.lastStartedAt = null;
      session.sessionTotalSeconds = 0;
      session.updatedAt = nowIso;
      repo.upsertSession(session);
    }
  }
  return expired;
}

/**
 * Multi-device automatic cutoff sweep: cuts power via Tuya Cloud to each device whose
 * active sessions have reached 00:00:00, recording `lastOffAt` per device.
 */
export async function executeExpiredSessionsShutoff(deviceId?: string): Promise<boolean> {
  const repo = getStorageRepository();
  const newlyExpired = consumeExpiredSessionsForShutoff(Date.now(), deviceId);
  if (newlyExpired.length === 0) {
    return false;
  }

  // Group expired sessions by deviceId for independent multi-device shutoffs
  const byDevice = new Map<string, UserDeviceSessionRecord[]>();
  for (const session of newlyExpired) {
    const list = byDevice.get(session.deviceId) ?? [];
    list.push(session);
    byDevice.set(session.deviceId, list);
  }

  let anyShutoff = false;

  for (const [targetDeviceId, expiredForDevice] of byDevice.entries()) {
    if (hasAnyActivePoweredOnSession(targetDeviceId)) {
      for (const expiredUser of expiredForDevice) {
        recordUserCommand({
          uid: expiredUser.uid,
          deviceId: targetDeviceId,
          action: 'APAGAR',
          ok: true,
          summary: 'Tiempo de uso activo agotado (00:00:00). Sesión finalizada.',
          tuyaCode: 'TIME_EXPIRED',
        });
      }
      anyShutoff = true;
      continue;
    }

    const existingPromise = shutoffInFlightByDevice.get(targetDeviceId);
    if (existingPromise) {
      const done = await existingPromise;
      anyShutoff = anyShutoff || done;
      continue;
    }

    const job = (async (): Promise<boolean> => {
      try {
        const result = await setDevicePower(false, targetDeviceId);
        const ok = result.success && result.commandAccepted;
        const shutoffNow = Date.now();
        if (ok) {
          recordPowerOffTimestamp(targetDeviceId, shutoffNow);
          void repo.syncDeviceToRemote({
            deviceId: targetDeviceId,
            isPoweredOn: false,
            remainingSeconds: 0,
            lastStartedAtMs: null,
            lastOffAtMs: shutoffNow,
          });
        }
        for (const expiredUser of expiredForDevice) {
          recordUserCommand({
            uid: expiredUser.uid,
            deviceId: targetDeviceId,
            action: 'APAGAR',
            ok,
            summary: ok
              ? 'Corte automático de energía al llegar a 00:00:00 de uso activo.'
              : `Corte automático al llegar a 00:00:00 falló: ${result.errorMessage || 'sin respuesta de Tuya'}`,
            tuyaCode: result.errorCode ?? (ok ? 'AUTO_OFF_ZERO' : 'ERROR'),
            tuyaTid: result.tuyaTid,
          });
        }
        return true;
      } catch (err) {
        console.error(`[auto-shutoff:${targetDeviceId}] Error sending off command:`, err);
        return false;
      } finally {
        shutoffInFlightByDevice.delete(targetDeviceId);
      }
    })();

    shutoffInFlightByDevice.set(targetDeviceId, job);
    const done = await job;
    anyShutoff = anyShutoff || done;
  }

  return anyShutoff;
}

export async function syncSessionStateToRemote(params: {
  deviceId: string;
  isPoweredOn: boolean;
  remainingSeconds: number;
  lastStartedAtMs: number | null;
  lastOffAtMs?: number | null;
  ownerUid?: string | null;
}): Promise<boolean> {
  return getStorageRepository().syncDeviceToRemote(params);
}
