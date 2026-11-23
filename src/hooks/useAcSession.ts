import { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AUTO_REFRESH_INTERVAL_MS,
  DEFAULT_CLIMATE_STATE,
  sanitizeDeviceId,
} from '../config/climate';
import { formatDurationHms, getPlanByHours } from '../config/plans';
import { apiUrl } from '../lib/apiClient';
import {
  extractWompiTransactionIdFromUrl,
  subscribeToCapacitorPaymentDeepLink,
} from '../lib/capacitorBridge';
import {
  auth,
  recordCommandToFirestore,
  syncPaymentToFirestore,
  syncUserProfileToFirestore,
} from '../lib/firebase';
import type {
  AccountStateResponse,
  ActivityActionType,
  ActivityLogEntry,
  ClimateControlState,
  ClimateMode,
  DeviceStatusResponse,
  DeviceTelemetry,
  FanSpeedLevel,
  PaymentRecordItem,
  TuyaControlResponse,
  WompiPurchaseResponse,
} from '../types';
import { useCompressorCooldown } from './useCompressorCooldown';

const EMPTY_TELEMETRY: DeviceTelemetry = {
  voltageV: null,
  rawVoltage: null,
  currentMa: null,
  powerW: null,
  rawPower: null,
};

export interface SuccessTransitionData {
  planName?: string;
  hoursPurchased: number;
  totalCop: number;
  newRemainingSeconds: number;
}

export interface SessionErrorBanner {
  title: string;
  detail: string;
  code?: number | string;
}

export interface UseAcSessionOptions {
  user: FirebaseUser | null;
  defaultDeviceId?: string;
  onInitialBalanceResolved?: (hasBalance: boolean) => void;
  onSessionExpired?: () => void;
  onPaymentRedirectToRemote?: () => void;
  onZeroBalancePowerAttempt?: () => void;
}

function readInitialDeviceIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return sanitizeDeviceId(params.get('deviceId') || params.get('device'));
  } catch {
    return null;
  }
}

export function useAcSession({
  user,
  defaultDeviceId = '',
  onInitialBalanceResolved,
  onSessionExpired,
  onPaymentRedirectToRemote,
  onZeroBalancePowerAttempt,
}: UseAcSessionOptions) {
  const [explicitDeviceId, setExplicitDeviceId] = useState<string | null>(() =>
    readInitialDeviceIdFromUrl()
  );
  const [resolvedDeviceId, setResolvedDeviceId] = useState<string>(defaultDeviceId);
  const activeDeviceId = explicitDeviceId || resolvedDeviceId || defaultDeviceId;

  const [accountLoaded, setAccountLoaded] = useState(false);
  const [isPoweredOn, setIsPoweredOn] = useState(false);
  const [lastStartedAt, setLastStartedAt] = useState<number | null>(null);
  const [bankedRemainingSeconds, setBankedRemainingSeconds] = useState(0);
  const [activeUntilMs, setActiveUntilMs] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [sessionTotalSeconds, setSessionTotalSeconds] = useState(0);
  const [climate, setClimate] = useState<ClimateControlState>({ ...DEFAULT_CLIMATE_STATE });
  const [payments, setPayments] = useState<PaymentRecordItem[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  const [successTransition, setSuccessTransition] = useState<SuccessTransitionData | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const [online, setOnline] = useState<boolean | null>(null);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);
  const [telemetry, setTelemetry] = useState<DeviceTelemetry>(EMPTY_TELEMETRY);

  const [isLoadingDevice, setIsLoadingDevice] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<'on' | 'off' | null>(null);
  const [errorBanner, setErrorBanner] = useState<SessionErrorBanner | null>(null);

  const postCommandTimerRef = useRef<number | null>(null);
  const serverClockOffsetMsRef = useRef<number>(0);
  const wasActiveSessionRef = useRef<boolean>(false);
  const hasInitializedBalanceRef = useRef<boolean>(false);
  const verifiedWompiTxRef = useRef<string | null>(null);

  const {
    lastOffAt,
    cooldownRemainingSeconds,
    cooldownFormatted,
    isTurnOnBlocked,
    syncCooldown,
    resetCooldown,
  } = useCompressorCooldown(Boolean(user), serverClockOffsetMsRef);

  // Sync default deviceId when runtime config loads
  useEffect(() => {
    if (defaultDeviceId && !resolvedDeviceId) {
      setResolvedDeviceId(defaultDeviceId);
    }
  }, [defaultDeviceId, resolvedDeviceId]);

  // Reset state cleanly when user signs out
  useEffect(() => {
    if (user) return;
    setAccountLoaded(false);
    setIsPoweredOn(false);
    setLastStartedAt(null);
    resetCooldown();
    setBankedRemainingSeconds(0);
    setActiveUntilMs(0);
    setRemainingSeconds(0);
    setSessionTotalSeconds(0);
    setClimate({ ...DEFAULT_CLIMATE_STATE });
    setPayments([]);
    setActivityLog([]);
    setSuccessTransition(null);
    setSessionExpiredNotice(false);
    setErrorBanner(null);
    wasActiveSessionRef.current = false;
    hasInitializedBalanceRef.current = false;
  }, [user, resetCooldown]);

  const getAuthToken = useCallback(async (): Promise<string> => {
    if (!auth.currentUser) {
      throw new Error('Sesión no iniciada.');
    }
    return auth.currentUser.getIdToken();
  }, []);

  const withDeviceQuery = useCallback(
    (path: string): string => {
      if (!activeDeviceId) return apiUrl(path);
      const separator = path.includes('?') ? '&' : '?';
      return apiUrl(`${path}${separator}deviceId=${encodeURIComponent(activeDeviceId)}`);
    },
    [activeDeviceId]
  );

  const appendLocalActivity = useCallback(
    (
      action: ActivityActionType,
      ok: boolean,
      summary: string,
      tuyaCode?: number | string,
      tuyaTid?: string | null
    ) => {
      const entry: ActivityLogEntry = {
        id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        deviceId: activeDeviceId || undefined,
        timestamp: new Date().toISOString(),
        action,
        ok,
        summary,
        tuyaCode,
        tuyaTid,
      };
      setActivityLog((prev) => [entry, ...prev].slice(0, 15));

      if (auth.currentUser && auth.currentUser.emailVerified) {
        void recordCommandToFirestore(auth.currentUser.uid, entry).catch((err) => {
          console.warn('Firestore command mirror skipped:', err);
        });
      }
    },
    [activeDeviceId]
  );

  const fetchAccountState = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const token = await getAuthToken();
      const res = await fetch(withDeviceQuery('/api/account/state'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;

      const data = (await res.json()) as AccountStateResponse;
      if (!data.success) return;

      if (data.deviceId) {
        setResolvedDeviceId(data.deviceId);
      }

      serverClockOffsetMsRef.current = data.serverNowMs - Date.now();
      setIsPoweredOn(Boolean(data.isPoweredOn));
      setLastStartedAt(typeof data.lastStartedAt === 'number' ? data.lastStartedAt : null);
      syncCooldown(
        typeof data.lastOffAt === 'number' ? data.lastOffAt : null,
        typeof data.cooldownRemainingSeconds === 'number' ? data.cooldownRemainingSeconds : 0
      );
      setBankedRemainingSeconds(
        typeof data.bankedRemainingSeconds === 'number'
          ? data.bankedRemainingSeconds
          : data.remainingSeconds
      );
      setActiveUntilMs(data.activeUntilMs || 0);
      setRemainingSeconds(data.remainingSeconds);
      setSessionTotalSeconds(data.sessionTotalSeconds || data.remainingSeconds);
      if (data.climate) {
        setClimate(data.climate);
      }
      setPayments(data.payments || []);
      if (Array.isArray(data.commands) && data.commands.length > 0) {
        setActivityLog(data.commands);
      }

      if (data.remainingSeconds > 0) {
        wasActiveSessionRef.current = true;
      }

      if (!hasInitializedBalanceRef.current) {
        hasInitializedBalanceRef.current = true;
        onInitialBalanceResolved?.(data.remainingSeconds > 0);
      }

      if (auth.currentUser.emailVerified) {
        void syncUserProfileToFirestore({
          uid: auth.currentUser.uid,
          email: auth.currentUser.email || data.email,
          displayName: auth.currentUser.displayName || '',
          remainingSeconds: data.remainingSeconds,
          activeUntilMs: data.activeUntilMs || 0,
          autoOffAtMs: 0,
        }).catch((err) => {
          console.warn('Firestore profile mirror skipped:', err);
        });
      }
    } catch {
      // Non-fatal
    } finally {
      setAccountLoaded(true);
    }
  }, [getAuthToken, withDeviceQuery, syncCooldown, onInitialBalanceResolved]);

  const fetchDeviceStatus = useCallback(
    async (options: { logEntry?: boolean; silent?: boolean } = {}) => {
      const { logEntry = false, silent = false } = options;
      if (!silent) setIsRefreshing(true);

      try {
        const res = await fetch(withDeviceQuery('/api/tuya/status'), { cache: 'no-store' });
        const data = (await res.json()) as DeviceStatusResponse;

        if (data.deviceId) {
          setResolvedDeviceId(data.deviceId);
        }

        setOnline(data.online);
        if (data.climate) {
          setClimate(data.climate);
        }

        if (!res.ok || !data.success) {
          const errMessage =
            data.errorMessage || `No se pudo leer el estado (HTTP ${res.status}).`;
          setErrorBanner({
            title: data.online === false ? 'Equipo sin conexión' : 'No se pudo consultar el equipo',
            detail: errMessage,
            code: data.errorCode,
          });
          if (logEntry || !silent) {
            appendLocalActivity('ESTADO', false, errMessage, data.errorCode, data.tuyaTid);
          }
          return;
        }

        setSwitchOn(data.switchOn);
        setTelemetry(data.telemetry);
        if (typeof data.serverNowMs === 'number') {
          serverClockOffsetMsRef.current = data.serverNowMs - Date.now();
        }
        syncCooldown(
          data.lastOffAt !== undefined ? data.lastOffAt : undefined,
          typeof data.cooldownRemainingSeconds === 'number'
            ? data.cooldownRemainingSeconds
            : undefined
        );

        if (data.online === false) {
          setErrorBanner({
            title: 'Equipo desconectado',
            detail:
              'El interruptor no reporta conexión Wi-Fi activa. Se muestra la última lectura.',
          });
        } else {
          setErrorBanner(null);
        }

        if (logEntry) {
          const stateLabel =
            data.switchOn === true
              ? 'ENCENDIDO'
              : data.switchOn === false
                ? 'APAGADO'
                : 'Desconocido';
          const vPart =
            data.telemetry.voltageV !== null ? ` · ${data.telemetry.voltageV.toFixed(1)} V` : '';
          const wPart =
            data.telemetry.powerW !== null ? ` · ${data.telemetry.powerW.toFixed(1)} W` : '';
          appendLocalActivity(
            'ESTADO',
            true,
            `Estado: ${stateLabel}${vPart}${wPart}`,
            undefined,
            data.tuyaTid
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo conectar con el servidor.';
        setErrorBanner({
          title: 'Error de comunicación',
          detail: msg,
        });
        if (logEntry || !silent) {
          appendLocalActivity('ESTADO', false, msg);
        }
      } finally {
        setIsLoadingDevice(false);
        setIsRefreshing(false);
      }
    },
    [withDeviceQuery, appendLocalActivity, syncCooldown]
  );

  // Initial sync once authenticated
  useEffect(() => {
    if (!user) return;
    setIsLoadingDevice(true);
    void fetchAccountState();
    void fetchDeviceStatus({ logEntry: true });
  }, [user, fetchAccountState, fetchDeviceStatus]);

  // On-demand active-usage countdown (decrements strictly while isPoweredOn === true)
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (!isPoweredOn || !lastStartedAt) {
        setRemainingSeconds(bankedRemainingSeconds);
        return;
      }

      const adjustedNow = Date.now() + serverClockOffsetMsRef.current;
      const elapsedSeconds = Math.max(0, Math.floor((adjustedNow - lastStartedAt) / 1000));
      const nextRemaining = Math.max(0, bankedRemainingSeconds - elapsedSeconds);
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0 && wasActiveSessionRef.current) {
        wasActiveSessionRef.current = false;
        setIsPoweredOn(false);
        setLastStartedAt(null);
        setBankedRemainingSeconds(0);
        setActiveUntilMs(0);
        setSessionTotalSeconds(0);
        setSuccessTransition(null);
        setSessionExpiredNotice(true);
        setSwitchOn(false);
        onSessionExpired?.();
        window.setTimeout(() => {
          void fetchAccountState();
          void fetchDeviceStatus({ logEntry: false, silent: true });
        }, 250);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [
    user,
    isPoweredOn,
    lastStartedAt,
    bankedRemainingSeconds,
    fetchDeviceStatus,
    fetchAccountState,
    onSessionExpired,
  ]);

  // Periodic background synchronization
  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => {
      if (pendingCommand === null) {
        void fetchDeviceStatus({ logEntry: false, silent: true });
        void fetchAccountState();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [user, pendingCommand, fetchDeviceStatus, fetchAccountState]);

  useEffect(() => {
    return () => {
      if (postCommandTimerRef.current !== null) {
        window.clearTimeout(postCommandTimerRef.current);
      }
    };
  }, []);

  const sendTuyaControl = useCallback(
    async (
      command: 'power' | 'temp_set' | 'mode' | 'fan_speed_enum',
      value: boolean | number | string
    ) => {
      if (remainingSeconds <= 0) {
        setSessionExpiredNotice(true);
        return;
      }

      const isPower = command === 'power';
      const nextPower = Boolean(value);

      if (isPower && nextPower && isTurnOnBlocked) {
        return;
      }

      if (isPower) {
        setPendingCommand(nextPower ? 'on' : 'off');
      }
      setErrorBanner(null);

      try {
        const token = await getAuthToken();
        const res = await fetch(apiUrl('/api/tuya/control'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deviceId: activeDeviceId || undefined,
            command,
            value,
          }),
        });

        const data = (await res.json()) as TuyaControlResponse;

        if (typeof data.serverNowMs === 'number') {
          serverClockOffsetMsRef.current = data.serverNowMs - Date.now();
        }
        if (typeof data.isPoweredOn === 'boolean') {
          setIsPoweredOn(data.isPoweredOn);
        }
        if (data.lastStartedAt !== undefined) {
          setLastStartedAt(data.lastStartedAt);
        }
        syncCooldown(
          data.lastOffAt !== undefined ? data.lastOffAt : undefined,
          typeof data.cooldownRemainingSeconds === 'number'
            ? data.cooldownRemainingSeconds
            : undefined
        );
        if (typeof data.bankedRemainingSeconds === 'number') {
          setBankedRemainingSeconds(data.bankedRemainingSeconds);
        } else if (typeof data.remainingSeconds === 'number') {
          setBankedRemainingSeconds(data.remainingSeconds);
        }
        if (typeof data.remainingSeconds === 'number') {
          setRemainingSeconds(data.remainingSeconds);
        }
        if (typeof data.sessionTotalSeconds === 'number') {
          setSessionTotalSeconds(data.sessionTotalSeconds);
        }
        if (typeof data.activeUntilMs === 'number') {
          setActiveUntilMs(data.activeUntilMs);
        }
        if (data.climate) {
          setClimate(data.climate);
        }

        if (!res.ok || !data.success || !data.commandAccepted) {
          const detail =
            data.errorMessage || `El equipo rechazó el comando (HTTP ${res.status}).`;

          if (data.errorCode === 'TIME_EXPIRED') {
            wasActiveSessionRef.current = false;
            setIsPoweredOn(false);
            setLastStartedAt(null);
            setBankedRemainingSeconds(0);
            setRemainingSeconds(0);
            setActiveUntilMs(0);
            setSessionTotalSeconds(0);
            setSessionExpiredNotice(true);
            setSwitchOn(false);
          } else if (data.errorCode !== 'COMPRESSOR_COOLDOWN' && isPower) {
            setErrorBanner({
              title: `No se pudo ${nextPower ? 'encender' : 'apagar'} el aire acondicionado`,
              detail,
              code: data.errorCode,
            });
          }

          if (data.errorCode === 2001) {
            setOnline(false);
          }

          appendLocalActivity(
            isPower ? (nextPower ? 'PRENDER' : 'APAGAR') : 'CLIMA',
            false,
            detail,
            data.errorCode,
            data.tuyaTid
          );
          return;
        }

        if (isPower) {
          setSwitchOn(nextPower);
          setOnline(true);
          appendLocalActivity(
            nextPower ? 'PRENDER' : 'APAGAR',
            true,
            nextPower
              ? 'switch → true · Uso activo iniciado'
              : `switch → false · Temporizador pausado en ${formatDurationHms(data.remainingSeconds)}`,
            undefined,
            data.tuyaTid
          );

          if (auth.currentUser && auth.currentUser.emailVerified) {
            void syncUserProfileToFirestore({
              uid: auth.currentUser.uid,
              email: auth.currentUser.email || '',
              displayName: auth.currentUser.displayName || '',
              remainingSeconds: data.remainingSeconds,
              activeUntilMs: data.activeUntilMs || 0,
              autoOffAtMs: 0,
            }).catch((err) => {
              console.warn('Firestore profile timer mirror skipped:', err);
            });
          }

          if (postCommandTimerRef.current !== null) {
            window.clearTimeout(postCommandTimerRef.current);
          }
          postCommandTimerRef.current = window.setTimeout(() => {
            void fetchDeviceStatus({ logEntry: false, silent: true });
          }, 900);
        }
      } catch (err) {
        const detail =
          err instanceof Error
            ? err.message
            : 'Fallo de red al enviar el comando al servidor.';
        if (isPower) {
          setErrorBanner({
            title: `Error al enviar comando ${nextPower ? 'PRENDER' : 'APAGAR'}`,
            detail,
          });
        }
        appendLocalActivity(isPower ? (nextPower ? 'PRENDER' : 'APAGAR') : 'CLIMA', false, detail);
      } finally {
        if (isPower) {
          setPendingCommand(null);
        }
      }
    },
    [
      remainingSeconds,
      isTurnOnBlocked,
      getAuthToken,
      activeDeviceId,
      syncCooldown,
      appendLocalActivity,
      fetchDeviceStatus,
    ]
  );

  const handleTogglePower = useCallback(() => {
    if (remainingSeconds <= 0) {
      onZeroBalancePowerAttempt?.();
      return;
    }
    const nextOn = !isPoweredOn;
    if (pendingCommand !== null || (nextOn && isTurnOnBlocked)) return;
    void sendTuyaControl('power', nextOn);
  }, [
    remainingSeconds,
    onZeroBalancePowerAttempt,
    isPoweredOn,
    pendingCommand,
    isTurnOnBlocked,
    sendTuyaControl,
  ]);

  const handleChangeTemp = useCallback(
    (nextTemp: number) => {
      setClimate((prev) => ({ ...prev, tempSet: nextTemp }));
      void sendTuyaControl('temp_set', nextTemp);
    },
    [sendTuyaControl]
  );

  const handleCycleMode = useCallback(
    (nextMode: ClimateMode) => {
      setClimate((prev) => ({ ...prev, mode: nextMode }));
      void sendTuyaControl('mode', nextMode);
    },
    [sendTuyaControl]
  );

  const handleCycleFan = useCallback(
    (nextFan: FanSpeedLevel) => {
      setClimate((prev) => ({ ...prev, fanSpeed: nextFan }));
      void sendTuyaControl('fan_speed_enum', nextFan);
    },
    [sendTuyaControl]
  );

  const handlePaymentCompleted = useCallback(
    (result: WompiPurchaseResponse) => {
      if (typeof result.serverNowMs === 'number') {
        serverClockOffsetMsRef.current = result.serverNowMs - Date.now();
      }
      const nextIsPoweredOn = Boolean(result.isPoweredOn);
      const nextLastStartedAt =
        typeof result.lastStartedAt === 'number' ? result.lastStartedAt : null;
      const nextRemaining = result.remainingSeconds || 0;
      const nextBanked =
        typeof result.bankedRemainingSeconds === 'number'
          ? result.bankedRemainingSeconds
          : nextRemaining;

      setIsPoweredOn(nextIsPoweredOn);
      setLastStartedAt(nextLastStartedAt);
      setBankedRemainingSeconds(nextBanked);
      setActiveUntilMs(result.activeUntilMs || 0);
      setRemainingSeconds(nextRemaining);
      setSessionTotalSeconds(result.sessionTotalSeconds || nextRemaining);
      if (nextRemaining > 0) {
        wasActiveSessionRef.current = true;
      }

      if (result.order) {
        const confirmedOrder = result.order;
        setPayments((prev) => [
          confirmedOrder,
          ...prev.filter((p) => p.reference !== confirmedOrder.reference),
        ]);

        if (auth.currentUser && auth.currentUser.emailVerified) {
          void syncPaymentToFirestore(auth.currentUser.uid, confirmedOrder).catch((err) => {
            console.warn('Firestore payment mirror skipped:', err);
          });
          void syncUserProfileToFirestore({
            uid: auth.currentUser.uid,
            email: auth.currentUser.email || '',
            displayName: auth.currentUser.displayName || '',
            remainingSeconds: nextRemaining,
            activeUntilMs: result.activeUntilMs || 0,
            autoOffAtMs: 0,
          }).catch((err) => {
            console.warn('Firestore profile balance mirror skipped:', err);
          });
        }
      }

      setErrorBanner(null);
      setSessionExpiredNotice(false);
      onPaymentRedirectToRemote?.();

      const purchasedHours = result.order?.hours || 12;
      const matchedPlan = getPlanByHours(purchasedHours);

      setSuccessTransition({
        planName: matchedPlan?.name,
        hoursPurchased: purchasedHours,
        totalCop: result.order?.totalCop || 0,
        newRemainingSeconds: nextRemaining,
      });

      appendLocalActivity(
        'PAGO',
        true,
        nextIsPoweredOn
          ? `Tiempo sumado a sesión activa · Ref ${result.reference || ''}`
          : `Tiempo acreditado en pausa (presiona ON/OFF para iniciar) · Ref ${result.reference || ''}`,
        'APPROVED',
        result.transactionId || result.reference
      );

      void fetchAccountState();
    },
    [appendLocalActivity, fetchAccountState, onPaymentRedirectToRemote]
  );

  const verifyWompiTransactionById = useCallback(
    async (wompiTxId: string, clearBrowserQuery = false) => {
      if (!wompiTxId || verifiedWompiTxRef.current === wompiTxId) return;
      verifiedWompiTxRef.current = wompiTxId;

      try {
        const token = await getAuthToken();
        const res = await fetch(apiUrl('/api/payments/wompi/verify'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transactionId: wompiTxId,
            deviceId: activeDeviceId || undefined,
          }),
        });
        const data = (await res.json()) as WompiPurchaseResponse;
        if (res.ok && data.success) {
          handlePaymentCompleted(data);
        }
      } catch {
        // Ignore transient verification errors
      } finally {
        if (clearBrowserQuery && typeof window !== 'undefined') {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    },
    [getAuthToken, activeDeviceId, handlePaymentCompleted]
  );

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const webTxId = extractWompiTransactionIdFromUrl(window.location.href);
    if (webTxId) {
      void verifyWompiTransactionById(webTxId, true);
    }

    const unsubscribeDeepLink = subscribeToCapacitorPaymentDeepLink((deepLinkTxId) => {
      void verifyWompiTransactionById(deepLinkTxId, false);
    });

    return () => {
      unsubscribeDeepLink();
    };
  }, [user, verifyWompiTransactionById]);

  const selectDeviceId = useCallback((nextId: string) => {
    const clean = sanitizeDeviceId(nextId);
    if (clean) {
      setExplicitDeviceId(clean);
    }
  }, []);

  const refreshAll = useCallback(() => {
    void fetchAccountState();
    void fetchDeviceStatus({ logEntry: true });
  }, [fetchAccountState, fetchDeviceStatus]);

  return {
    deviceId: activeDeviceId,
    selectDeviceId,
    accountLoaded,
    isPoweredOn,
    lastStartedAt,
    lastOffAt,
    cooldownRemainingSeconds,
    cooldownFormatted,
    isTurnOnBlocked,
    bankedRemainingSeconds,
    activeUntilMs,
    remainingSeconds,
    sessionTotalSeconds,
    climate,
    payments,
    activityLog,
    clearActivityLog: () => setActivityLog([]),
    successTransition,
    dismissSuccessTransition: () => setSuccessTransition(null),
    sessionExpiredNotice,
    online,
    switchOn,
    telemetry,
    isLoadingDevice,
    isRefreshing,
    pendingCommand,
    errorBanner,
    dismissErrorBanner: () => setErrorBanner(null),
    getAuthToken,
    fetchAccountState,
    fetchDeviceStatus,
    refreshAll,
    handleTogglePower,
    handleChangeTemp,
    handleCycleMode,
    handleCycleFan,
    handlePaymentCompleted,
  };
}
