import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLIMATE_STATE,
  isValidClimateMode,
  isValidClimateTemp,
  isValidFanSpeed,
} from '../config/climate.ts';
import { getDefaultDeviceId } from '../config/env.ts';
import {
  getSupabaseDevice,
  isSupabaseConfigured,
  recordSupabaseTransactionIdempotent,
  upsertSupabaseDeviceState,
} from '../server/supabaseClient.ts';
import type {
  StoredCommandEntry,
  StoredPaymentOrder,
  UserDeviceSessionRecord,
} from '../types/session.ts';
import type { ClimateControlState } from '../types/tuya.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LEDGER_DIR = path.resolve(__dirname, '../../.data');
const DEFAULT_LEDGER_FILE = path.join(DEFAULT_LEDGER_DIR, 'cloud-ledger.json');

export interface RemoteDeviceSyncPayload {
  deviceId: string;
  isPoweredOn: boolean;
  remainingSeconds: number;
  lastStartedAtMs: number | null;
  lastOffAtMs?: number | null;
  ownerUid?: string | null;
}

export interface RemoteTransactionPayload {
  wompiTransactionId: string;
  deviceId: string;
  userUid?: string | null;
  reference?: string | null;
  amountCop: number;
  secondsCredited: number;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
}

/**
 * Decoupled persistence contract for ClimaPay multi-device state.
 * Swapping between Local JSON, Supabase PostgreSQL, Firebase, or Redis requires
 * implementing only this interface — zero changes to API routes or UI hooks.
 */
export interface StorageRepository {
  getProviderName(): 'supabase_postgres' | 'local_cloud_ledger';
  isRemotePersistenceEnabled(): boolean;

  // Multi-device user sessions (keyed by uid + deviceId)
  getSession(uid: string, deviceId: string): UserDeviceSessionRecord | null;
  upsertSession(record: UserDeviceSessionRecord): UserDeviceSessionRecord;
  listSessions(deviceId?: string): UserDeviceSessionRecord[];

  // Per-device compressor cooldown (`lastOffAt` strictly recorded on ON -> OFF)
  getDeviceLastOffAt(deviceId: string): number | null;
  setDeviceLastOffAt(deviceId: string, timestampMs: number | null): void;

  // Per-device digital remote climate state (16°C–30°C, mode, fan)
  getDeviceClimateState(deviceId: string): ClimateControlState;
  setDeviceClimateState(
    deviceId: string,
    partial: Partial<ClimateControlState>
  ): ClimateControlState;

  // Wompi payment orders & strict transaction.id idempotency registry
  createOrder(order: StoredPaymentOrder): StoredPaymentOrder;
  saveOrder(order: StoredPaymentOrder): StoredPaymentOrder;
  getOrderByReference(reference: string): StoredPaymentOrder | null;
  findOrderReferenceByTransactionId(transactionId: string): string | null;
  markTransactionCredited(transactionId: string, reference: string): void;
  listUserOrders(uid: string, deviceId?: string, limit?: number): StoredPaymentOrder[];

  // Command / audit logs
  appendCommand(entry: StoredCommandEntry): StoredCommandEntry;
  listUserCommands(uid: string, deviceId?: string, limit?: number): StoredCommandEntry[];

  // Optional remote synchronization (Supabase PostgreSQL, etc.)
  fetchRemoteLastOffAt(deviceId: string): Promise<number | null>;
  syncDeviceToRemote(payload: RemoteDeviceSyncPayload): Promise<boolean>;
  recordRemoteTransactionIdempotent(
    payload: RemoteTransactionPayload
  ): Promise<{ persisted: boolean; alreadyCredited: boolean; errorMessage?: string }>;
}

interface FileLedgerSnapshot {
  version: 2;
  /** Composite keys `${uid}::${deviceId}` for multi-device isolation */
  sessions: Record<string, UserDeviceSessionRecord>;
  orders: Record<string, StoredPaymentOrder>;
  /** Strict idempotency registry mapping approved Wompi transaction.id -> order.reference */
  creditedTransactionIds: Record<string, string>;
  commands: StoredCommandEntry[];
  /** Per-device climate state */
  climateByDevice: Record<string, ClimateControlState>;
  /** Per-device epoch ms of last successful ON -> OFF shutoff */
  lastOffAtByDevice: Record<string, number | null>;
}

function makeSessionKey(uid: string, deviceId: string): string {
  return `${uid}::${deviceId}`;
}

function normalizeClimate(raw: Partial<ClimateControlState> | undefined): ClimateControlState {
  return {
    tempSet: isValidClimateTemp(raw?.tempSet) ? Number(raw?.tempSet) : DEFAULT_CLIMATE_STATE.tempSet,
    mode: isValidClimateMode(raw?.mode) ? raw.mode : DEFAULT_CLIMATE_STATE.mode,
    fanSpeed: isValidFanSpeed(raw?.fanSpeed) ? raw.fanSpeed : DEFAULT_CLIMATE_STATE.fanSpeed,
  };
}

function defaultDeviceKey(): string {
  return getDefaultDeviceId() || 'default';
}

export class FileStorageRepository implements StorageRepository {
  private readonly filePath: string;
  private state: FileLedgerSnapshot;

  constructor(filePath = DEFAULT_LEDGER_FILE) {
    this.filePath = filePath;
    this.state = {
      version: 2,
      sessions: {},
      orders: {},
      creditedTransactionIds: {},
      commands: [],
      climateByDevice: {},
      lastOffAtByDevice: {},
    };
    this.loadFromDisk();
  }

  getProviderName(): 'supabase_postgres' | 'local_cloud_ledger' {
    return 'local_cloud_ledger';
  }

  isRemotePersistenceEnabled(): boolean {
    return false;
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<FileLedgerSnapshot> & {
        // Legacy v1 single-device fields for seamless migration
        users?: Record<
          string,
          Partial<UserDeviceSessionRecord> & { activeUntilMs?: number }
        >;
        climate?: Partial<ClimateControlState>;
        lastOffAt?: number | null;
      };

      const fallbackDevId = defaultDeviceKey();
      const now = Date.now();
      const normalizedSessions: Record<string, UserDeviceSessionRecord> = {};

      // 1) Migrate v1 single-device `users` map if present
      if (parsed.users && typeof parsed.users === 'object') {
        for (const [uid, record] of Object.entries(parsed.users)) {
          if (!record || typeof record !== 'object') continue;
          const session = this.normalizeSessionRecord(uid, fallbackDevId, record, now);
          normalizedSessions[makeSessionKey(session.uid, session.deviceId)] = session;
        }
      }

      // 2) Load v2 multi-device `sessions` map
      if (parsed.sessions && typeof parsed.sessions === 'object') {
        for (const [key, record] of Object.entries(parsed.sessions)) {
          if (!record || typeof record !== 'object') continue;
          const [keyUid, keyDev] = key.includes('::') ? key.split('::') : [key, fallbackDevId];
          const uid = String(record.uid || keyUid);
          const devId = String(record.deviceId || keyDev || fallbackDevId);
          const session = this.normalizeSessionRecord(uid, devId, record, now);
          normalizedSessions[makeSessionKey(session.uid, session.deviceId)] = session;
        }
      }

      // 3) Load orders (ignoring any legacy simulated/DEMO orders)
      const normalizedOrders: Record<string, StoredPaymentOrder> = {};
      if (parsed.orders && typeof parsed.orders === 'object') {
        for (const [ref, order] of Object.entries(parsed.orders)) {
          if (!order || typeof order !== 'object') continue;
          const legacyOrder = order as Partial<StoredPaymentOrder> & { isDemo?: boolean };
          if (legacyOrder.isDemo === true || ref.startsWith('DEMO_')) continue;
          normalizedOrders[ref] = {
            id: String(legacyOrder.id || ref),
            uid: String(legacyOrder.uid || ''),
            deviceId: String(legacyOrder.deviceId || fallbackDevId),
            reference: String(legacyOrder.reference || ref),
            transactionId: String(legacyOrder.transactionId || ref),
            hours: Number(legacyOrder.hours) || 1,
            addedSeconds: Number(legacyOrder.addedSeconds) || 3600,
            subtotalCop: Number(legacyOrder.subtotalCop) || 0,
            discountPercent: Number(legacyOrder.discountPercent) || 0,
            discountCop: Number(legacyOrder.discountCop) || 0,
            totalCop: Number(legacyOrder.totalCop) || 0,
            amountInCents: Number(legacyOrder.amountInCents) || 0,
            currency: 'COP',
            status:
              legacyOrder.status === 'PENDING' ||
              legacyOrder.status === 'APPROVED' ||
              legacyOrder.status === 'DECLINED' ||
              legacyOrder.status === 'VOIDED' ||
              legacyOrder.status === 'ERROR'
                ? legacyOrder.status
                : 'APPROVED',
            credited: Boolean(legacyOrder.credited),
            createdAt:
              typeof legacyOrder.createdAt === 'string'
                ? legacyOrder.createdAt
                : new Date().toISOString(),
            updatedAt:
              typeof legacyOrder.updatedAt === 'string'
                ? legacyOrder.updatedAt
                : new Date().toISOString(),
          };
        }
      }

      // 4) Idempotency registry
      const normalizedCreditedTx: Record<string, string> = {};
      if (parsed.creditedTransactionIds && typeof parsed.creditedTransactionIds === 'object') {
        for (const [txId, ref] of Object.entries(parsed.creditedTransactionIds)) {
          if (txId && typeof ref === 'string' && ref && !ref.startsWith('DEMO_')) {
            normalizedCreditedTx[txId] = ref;
          }
        }
      }
      for (const order of Object.values(normalizedOrders)) {
        if (order.credited && order.transactionId && !normalizedCreditedTx[order.transactionId]) {
          normalizedCreditedTx[order.transactionId] = order.reference;
        }
      }

      // 5) Per-device climate & lastOffAt (with v1 fallback migration)
      const climateByDevice: Record<string, ClimateControlState> = {};
      if (parsed.climate) {
        climateByDevice[fallbackDevId] = normalizeClimate(parsed.climate);
      }
      if (parsed.climateByDevice && typeof parsed.climateByDevice === 'object') {
        for (const [devId, climate] of Object.entries(parsed.climateByDevice)) {
          climateByDevice[devId] = normalizeClimate(climate);
        }
      }

      const lastOffAtByDevice: Record<string, number | null> = {};
      if (
        typeof parsed.lastOffAt === 'number' &&
        Number.isFinite(parsed.lastOffAt) &&
        parsed.lastOffAt > 0
      ) {
        lastOffAtByDevice[fallbackDevId] = Math.floor(parsed.lastOffAt);
      }
      if (parsed.lastOffAtByDevice && typeof parsed.lastOffAtByDevice === 'object') {
        for (const [devId, ts] of Object.entries(parsed.lastOffAtByDevice)) {
          lastOffAtByDevice[devId] =
            typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : null;
        }
      }

      // 6) Commands
      const normalizedCommands: StoredCommandEntry[] = Array.isArray(parsed.commands)
        ? parsed.commands.map((cmd) => ({
            ...cmd,
            deviceId: cmd.deviceId || fallbackDevId,
          }))
        : [];

      this.state = {
        version: 2,
        sessions: normalizedSessions,
        orders: normalizedOrders,
        creditedTransactionIds: normalizedCreditedTx,
        commands: normalizedCommands,
        climateByDevice,
        lastOffAtByDevice,
      };
    } catch (err) {
      console.warn('[storage.repository] Starting with fresh ledger:', err);
    }
  }

  private normalizeSessionRecord(
    uid: string,
    deviceId: string,
    record: Partial<UserDeviceSessionRecord> & { activeUntilMs?: number },
    now: number
  ): UserDeviceSessionRecord {
    let remainingSeconds = 0;
    let isPoweredOn = false;
    let lastStartedAt: number | null = null;

    if (typeof record.remainingSeconds === 'number' && Number.isFinite(record.remainingSeconds)) {
      remainingSeconds = Math.max(0, Math.floor(record.remainingSeconds));
      const rawLastStarted =
        typeof record.lastStartedAt === 'number' &&
        Number.isFinite(record.lastStartedAt) &&
        record.lastStartedAt > 0
          ? Math.floor(record.lastStartedAt)
          : null;
      if (Boolean(record.isPoweredOn) && rawLastStarted !== null && remainingSeconds > 0) {
        isPoweredOn = true;
        lastStartedAt = rawLastStarted;
      }
    } else if (typeof record.activeUntilMs === 'number' && record.activeUntilMs > now) {
      remainingSeconds = Math.max(0, Math.floor((record.activeUntilMs - now) / 1000));
    }

    return {
      uid: String(record.uid || uid),
      deviceId: String(record.deviceId || deviceId),
      email: String(record.email || ''),
      remainingSeconds,
      isPoweredOn,
      lastStartedAt,
      sessionTotalSeconds:
        remainingSeconds > 0
          ? Math.max(remainingSeconds, Math.floor(Number(record.sessionTotalSeconds) || 0))
          : 0,
      totalPurchasedSeconds: Math.max(0, Math.floor(Number(record.totalPurchasedSeconds) || 0)),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    };
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempFile = `${this.filePath}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempFile, this.filePath);
    } catch (err) {
      console.error('[storage.repository] Failed to persist ledger:', err);
    }
  }

  getSession(uid: string, deviceId: string): UserDeviceSessionRecord | null {
    const key = makeSessionKey(uid, deviceId);
    const record = this.state.sessions[key];
    return record ? { ...record } : null;
  }

  upsertSession(record: UserDeviceSessionRecord): UserDeviceSessionRecord {
    const key = makeSessionKey(record.uid, record.deviceId);
    const saved: UserDeviceSessionRecord = { ...record };
    this.state.sessions[key] = saved;
    this.persistToDisk();
    return { ...saved };
  }

  listSessions(deviceId?: string): UserDeviceSessionRecord[] {
    const all = Object.values(this.state.sessions);
    const filtered = deviceId ? all.filter((s) => s.deviceId === deviceId) : all;
    return filtered.map((s) => ({ ...s }));
  }

  getDeviceLastOffAt(deviceId: string): number | null {
    const val = this.state.lastOffAtByDevice[deviceId];
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
  }

  setDeviceLastOffAt(deviceId: string, timestampMs: number | null): void {
    this.state.lastOffAtByDevice[deviceId] =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0
        ? Math.floor(timestampMs)
        : null;
    this.persistToDisk();
  }

  getDeviceClimateState(deviceId: string): ClimateControlState {
    const current = this.state.climateByDevice[deviceId];
    return current ? { ...current } : { ...DEFAULT_CLIMATE_STATE };
  }

  setDeviceClimateState(
    deviceId: string,
    partial: Partial<ClimateControlState>
  ): ClimateControlState {
    const current = this.getDeviceClimateState(deviceId);
    if (isValidClimateTemp(partial.tempSet)) {
      current.tempSet = Number(partial.tempSet);
    }
    if (isValidClimateMode(partial.mode)) {
      current.mode = partial.mode;
    }
    if (isValidFanSpeed(partial.fanSpeed)) {
      current.fanSpeed = partial.fanSpeed;
    }
    this.state.climateByDevice[deviceId] = current;
    this.persistToDisk();
    return { ...current };
  }

  createOrder(order: StoredPaymentOrder): StoredPaymentOrder {
    this.state.orders[order.reference] = { ...order };
    this.persistToDisk();
    return { ...order };
  }

  saveOrder(order: StoredPaymentOrder): StoredPaymentOrder {
    this.state.orders[order.reference] = { ...order };
    this.persistToDisk();
    return { ...order };
  }

  getOrderByReference(reference: string): StoredPaymentOrder | null {
    const found = this.state.orders[reference];
    return found ? { ...found } : null;
  }

  findOrderReferenceByTransactionId(transactionId: string): string | null {
    return this.state.creditedTransactionIds[transactionId] || null;
  }

  markTransactionCredited(transactionId: string, reference: string): void {
    if (!transactionId) return;
    this.state.creditedTransactionIds[transactionId] = reference;
    this.persistToDisk();
  }

  listUserOrders(uid: string, deviceId?: string, limit = 20): StoredPaymentOrder[] {
    return Object.values(this.state.orders)
      .filter((order) => order.uid === uid && (!deviceId || order.deviceId === deviceId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map((order) => ({ ...order }));
  }

  appendCommand(entry: StoredCommandEntry): StoredCommandEntry {
    this.state.commands.unshift({ ...entry });
    if (this.state.commands.length > 300) {
      this.state.commands = this.state.commands.slice(0, 300);
    }
    this.persistToDisk();
    return { ...entry };
  }

  listUserCommands(uid: string, deviceId?: string, limit = 20): StoredCommandEntry[] {
    return this.state.commands
      .filter((entry) => entry.uid === uid && (!deviceId || entry.deviceId === deviceId))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  async fetchRemoteLastOffAt(_deviceId: string): Promise<number | null> {
    return null;
  }

  async syncDeviceToRemote(_payload: RemoteDeviceSyncPayload): Promise<boolean> {
    return false;
  }

  async recordRemoteTransactionIdempotent(
    _payload: RemoteTransactionPayload
  ): Promise<{ persisted: boolean; alreadyCredited: boolean; errorMessage?: string }> {
    return { persisted: false, alreadyCredited: false };
  }
}

/**
 * Composes atomic local persistence with Supabase PostgreSQL cloud mirroring.
 * Automatically activates when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
 */
export class HybridSupabaseStorageRepository extends FileStorageRepository {
  override getProviderName(): 'supabase_postgres' | 'local_cloud_ledger' {
    return isSupabaseConfigured() ? 'supabase_postgres' : 'local_cloud_ledger';
  }

  override isRemotePersistenceEnabled(): boolean {
    return isSupabaseConfigured();
  }

  override async fetchRemoteLastOffAt(deviceId: string): Promise<number | null> {
    if (!isSupabaseConfigured() || !deviceId) return null;
    const supaDevice = await getSupabaseDevice(deviceId);
    const supaMs = supaDevice?.last_off_at ? Date.parse(supaDevice.last_off_at) : Number.NaN;
    return Number.isFinite(supaMs) && supaMs > 0 ? Math.floor(supaMs) : null;
  }

  override async syncDeviceToRemote(payload: RemoteDeviceSyncPayload): Promise<boolean> {
    if (!isSupabaseConfigured() || !payload.deviceId) return false;
    return upsertSupabaseDeviceState({
      deviceId: payload.deviceId,
      isPoweredOn: payload.isPoweredOn,
      remainingSeconds: payload.remainingSeconds,
      lastStartedAtMs: payload.lastStartedAtMs,
      lastOffAtMs: payload.lastOffAtMs,
      ownerUid: payload.ownerUid,
    });
  }

  override async recordRemoteTransactionIdempotent(
    payload: RemoteTransactionPayload
  ): Promise<{ persisted: boolean; alreadyCredited: boolean; errorMessage?: string }> {
    if (!isSupabaseConfigured() || !payload.deviceId) {
      return { persisted: false, alreadyCredited: false };
    }
    return recordSupabaseTransactionIdempotent({
      wompi_transaction_id: payload.wompiTransactionId,
      device_id: payload.deviceId,
      user_uid: payload.userUid ?? null,
      reference: payload.reference ?? null,
      amount_cop: payload.amountCop,
      seconds_credited: payload.secondsCredited,
      status: payload.status,
    });
  }
}

let activeRepository: StorageRepository | null = null;

export function getStorageRepository(): StorageRepository {
  if (!activeRepository) {
    activeRepository = new HybridSupabaseStorageRepository();
  }
  return activeRepository;
}

export function setStorageRepository(repository: StorageRepository): void {
  activeRepository = repository;
}
