import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseDeviceRow {
  device_id: string;
  is_powered_on: boolean;
  remaining_seconds: number;
  last_started_at: string | null;
  last_off_at: string | null;
  owner_uid?: string | null;
  updated_at?: string;
}

export interface SupabaseTransactionInsert {
  wompi_transaction_id: string;
  device_id: string;
  user_uid?: string | null;
  reference?: string | null;
  amount_cop: number;
  seconds_credited: number;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
}

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseConfig(): {
  url: string;
  serviceRoleKey: string;
  isConfigured: boolean;
} {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const isConfigured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && serviceRoleKey.length > 20;

  return { url, serviceRoleKey, isConfigured };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().isConfigured;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const config = getSupabaseConfig();
  if (!config.isConfigured) {
    cachedClient = null;
    return null;
  }

  cachedClient = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export async function getSupabaseDevice(deviceId: string): Promise<SupabaseDeviceRow | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('devices')
    .select('device_id, is_powered_on, remaining_seconds, last_started_at, last_off_at, owner_uid, updated_at')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (error) {
    console.warn('[supabase] Failed to read device:', error.message);
    return null;
  }
  return (data as SupabaseDeviceRow | null) ?? null;
}

export async function upsertSupabaseDeviceState(params: {
  deviceId: string;
  isPoweredOn: boolean;
  remainingSeconds: number;
  lastStartedAtMs: number | null;
  lastOffAtMs?: number | null;
  ownerUid?: string | null;
}): Promise<boolean> {
  const client = getSupabaseAdminClient();
  if (!client) return false;

  const payload: SupabaseDeviceRow = {
    device_id: params.deviceId,
    is_powered_on: params.isPoweredOn,
    remaining_seconds: Math.max(0, Math.floor(params.remainingSeconds)),
    last_started_at:
      params.isPoweredOn && params.lastStartedAtMs
        ? new Date(params.lastStartedAtMs).toISOString()
        : null,
    last_off_at:
      typeof params.lastOffAtMs === 'number' && params.lastOffAtMs > 0
        ? new Date(params.lastOffAtMs).toISOString()
        : null,
    updated_at: new Date().toISOString(),
  };

  if (params.ownerUid !== undefined) {
    payload.owner_uid = params.ownerUid;
  }

  const { error } = await client
    .from('devices')
    .upsert(payload, { onConflict: 'device_id' });

  if (error) {
    console.warn('[supabase] Failed to upsert device state:', error.message);
    return false;
  }
  return true;
}

export async function recordSupabaseTransactionIdempotent(
  tx: SupabaseTransactionInsert
): Promise<{ persisted: boolean; alreadyCredited: boolean; errorMessage?: string }> {
  const client = getSupabaseAdminClient();
  if (!client) {
    return { persisted: false, alreadyCredited: false };
  }

  // Ensure device exists before inserting transaction FK
  await client
    .from('devices')
    .upsert({ device_id: tx.device_id }, { onConflict: 'device_id', ignoreDuplicates: true });

  const { error } = await client.from('transactions').insert({
    wompi_transaction_id: tx.wompi_transaction_id,
    device_id: tx.device_id,
    user_uid: tx.user_uid ?? null,
    reference: tx.reference ?? null,
    amount_cop: Math.max(0, Math.round(tx.amount_cop)),
    seconds_credited: Math.max(1, Math.floor(tx.seconds_credited)),
    status: tx.status,
  });

  if (error) {
    // PostgreSQL unique_violation (23505): transaction already credited
    if (error.code === '23505') {
      return { persisted: true, alreadyCredited: true };
    }
    console.warn('[supabase] Failed to insert transaction:', error.message);
    return { persisted: false, alreadyCredited: false, errorMessage: error.message };
  }

  return { persisted: true, alreadyCredited: false };
}

export async function findActivePoweredSupabaseDevices(): Promise<SupabaseDeviceRow[]> {
  const client = getSupabaseAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from('devices')
    .select('device_id, is_powered_on, remaining_seconds, last_started_at, last_off_at, owner_uid, updated_at')
    .eq('is_powered_on', true);

  if (error) {
    console.error('[supabase] Failed to query active devices for cron:', error.message);
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  return (data as SupabaseDeviceRow[] | null) ?? [];
}

export async function updateSupabaseDeviceAfterCron(params: {
  deviceId: string;
  remainingSeconds: number;
  isPoweredOn: boolean;
  lastStartedAtIso: string | null;
  lastOffAtIso?: string | null;
}): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return;

  const updateFields: Record<string, unknown> = {
    remaining_seconds: Math.max(0, Math.floor(params.remainingSeconds)),
    is_powered_on: params.isPoweredOn,
    last_started_at: params.lastStartedAtIso,
    updated_at: new Date().toISOString(),
  };

  if (params.lastOffAtIso !== undefined) {
    updateFields.last_off_at = params.lastOffAtIso;
  }

  const { error } = await client
    .from('devices')
    .update(updateFields)
    .eq('device_id', params.deviceId);

  if (error) {
    console.error('[supabase] Failed to update device after cron:', error.message);
    throw new Error(`Supabase update failed: ${error.message}`);
  }
}
