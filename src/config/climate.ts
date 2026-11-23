import type { ClimateControlState, ClimateMode, FanSpeedLevel } from '../types/tuya.ts';

/** Allowed temperature range for ClimaPay digital remote & Tuya climate DPs. */
export const CLIMATE_TEMP_MIN_C = 16;
export const CLIMATE_TEMP_MAX_C = 30;
export const CLIMATE_DEFAULT_TEMP_C = 24;

/** Mandatory compressor protection cooldown (2 minutes / 120s) applied strictly on ON -> OFF. */
export const COMPRESSOR_COOLDOWN_SECONDS = 120;
export const COMPRESSOR_COOLDOWN_MS = COMPRESSOR_COOLDOWN_SECONDS * 1000;

/** Low-balance UI alert threshold (5 minutes). */
export const LOW_BALANCE_WARNING_SECONDS = 300;

/** Background polling interval for device telemetry & session synchronization. */
export const AUTO_REFRESH_INTERVAL_MS = 15_000;

export const CLIMATE_MODES: readonly ClimateMode[] = ['cool', 'dry', 'fan', 'auto'] as const;
export const FAN_SPEEDS: readonly FanSpeedLevel[] = ['auto', 'low', 'mid', 'high'] as const;

export const DEFAULT_CLIMATE_STATE: Readonly<ClimateControlState> = Object.freeze({
  tempSet: CLIMATE_DEFAULT_TEMP_C,
  mode: 'cool',
  fanSpeed: 'auto',
});

/**
 * Strict Tuya device ID validation regex.
 * Prevents path traversal or header injection when passed dynamically via query/body.
 */
export const DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]{4,64}$/;

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_REGEX.test(value.trim());
}

export function sanitizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return DEVICE_ID_REGEX.test(trimmed) ? trimmed : null;
}

export function isValidClimateTemp(value: unknown): value is number {
  const num = Number(value);
  return Number.isInteger(num) && num >= CLIMATE_TEMP_MIN_C && num <= CLIMATE_TEMP_MAX_C;
}

export function isValidClimateMode(value: unknown): value is ClimateMode {
  return value === 'cool' || value === 'dry' || value === 'fan' || value === 'auto';
}

export function isValidFanSpeed(value: unknown): value is FanSpeedLevel {
  return value === 'auto' || value === 'low' || value === 'mid' || value === 'high';
}

export function clampClimateTemp(value: number): number {
  return Math.max(CLIMATE_TEMP_MIN_C, Math.min(CLIMATE_TEMP_MAX_C, Math.round(value)));
}
