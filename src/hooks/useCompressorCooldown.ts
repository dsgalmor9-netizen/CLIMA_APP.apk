import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import { COMPRESSOR_COOLDOWN_MS } from '../config/climate';

export interface UseCompressorCooldownResult {
  lastOffAt: number | null;
  cooldownRemainingSeconds: number;
  cooldownFormatted: string;
  isTurnOnBlocked: boolean;
  syncCooldown: (nextLastOffAt?: number | null, nextRemainingSeconds?: number) => void;
  resetCooldown: () => void;
}

/**
 * Independent 120-second compressor protection cooldown hook (strictly post ON -> OFF).
 * Never mutates prepaid remainingSeconds.
 */
export function useCompressorCooldown(
  enabled: boolean,
  serverClockOffsetMsRef: MutableRefObject<number>
): UseCompressorCooldownResult {
  const [lastOffAt, setLastOffAt] = useState<number | null>(null);
  const [cooldownRemainingSeconds, setCooldownRemainingSeconds] = useState<number>(0);

  const syncCooldown = useCallback(
    (nextLastOffAt?: number | null, nextRemainingSeconds?: number) => {
      if (nextLastOffAt !== undefined) {
        setLastOffAt(typeof nextLastOffAt === 'number' && nextLastOffAt > 0 ? nextLastOffAt : null);
      }
      if (typeof nextRemainingSeconds === 'number') {
        setCooldownRemainingSeconds(Math.max(0, Math.floor(nextRemainingSeconds)));
      }
    },
    []
  );

  const resetCooldown = useCallback(() => {
    setLastOffAt(null);
    setCooldownRemainingSeconds(0);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (!lastOffAt) {
        setCooldownRemainingSeconds(0);
        return;
      }
      const adjustedNow = Date.now() + serverClockOffsetMsRef.current;
      const remainingMs = Math.max(0, lastOffAt + COMPRESSOR_COOLDOWN_MS - adjustedNow);
      const nextSeconds = Math.ceil(remainingMs / 1000);
      setCooldownRemainingSeconds(nextSeconds);
      if (nextSeconds === 0) {
        setLastOffAt(null);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, lastOffAt, serverClockOffsetMsRef]);

  const cooldownFormatted = `${String(Math.floor(cooldownRemainingSeconds / 60)).padStart(
    2,
    '0'
  )}:${String(cooldownRemainingSeconds % 60).padStart(2, '0')}`;

  return {
    lastOffAt,
    cooldownRemainingSeconds,
    cooldownFormatted,
    isTurnOnBlocked: cooldownRemainingSeconds > 0,
    syncCooldown,
    resetCooldown,
  };
}
