import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Cpu,
  LifeBuoy,
  Loader2,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  CLIMATE_TEMP_MAX_C,
  CLIMATE_TEMP_MIN_C,
  COMPRESSOR_COOLDOWN_SECONDS,
} from './config/climate';
import { BASE_HOURLY_RATE_COP, MAX_HOURS, formatDurationHms } from './config/plans';
import { useAcSession } from './hooks/useAcSession';
import { apiUrl } from './lib/apiClient';
import { auth } from './lib/firebase';
import { AuthView } from './components/AuthView';
import { DeviceHeader } from './components/DeviceHeader';
import { KalleyRemote } from './components/remote/KalleyRemote';
import { PlanPaywall } from './components/payments/PlanPaywall';
import { PaywallSuccess } from './components/payments/PaywallSuccess';
import { BottomNav } from './components/layout/BottomNav';
import type { BottomNavTab } from './components/layout/BottomNav';
import { AddTimeModal } from './components/AddTimeModal';
import { TelemetryPanel } from './components/TelemetryPanel';
import { PaymentHistoryPanel } from './components/PaymentHistoryPanel';
import { ActivityLogPanel } from './components/ActivityLogPanel';
import { CLIMA_EASE, SpotlightCard } from './components/SpotlightCard';
import { ClimaPayLogo } from './components/ClimaPayLogo';
import type { PublicRuntimeConfig } from './types';

const DEFAULT_RUNTIME_CONFIG: PublicRuntimeConfig = {
  turnstileSiteKey:
    (import.meta.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY as string | undefined)?.trim() || null,
  turnstileMode: (import.meta.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY as string | undefined)?.trim()
    ? 'cloudflare'
    : 'fallback',
  wompiConfigured: false,
  wompiPublicKey: null,
  deviceId: '',
  tuyaBaseUrl: 'https://openapi.tuyaus.com',
  maxHours: MAX_HOURS,
  baseHourlyRateCop: BASE_HOURLY_RATE_COP,
  tempMinC: CLIMATE_TEMP_MIN_C,
  tempMaxC: CLIMATE_TEMP_MAX_C,
  compressorCooldownSeconds: COMPRESSOR_COOLDOWN_SECONDS,
};

export default function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<PublicRuntimeConfig>(DEFAULT_RUNTIME_CONFIG);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<BottomNavTab>('remote');
  const [isAddTimeModalOpen, setIsAddTimeModalOpen] = useState(false);

  // Load server public runtime config
  useEffect(() => {
    fetch(apiUrl('/api/config/public'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg: PublicRuntimeConfig | null) => {
        if (cfg) setRuntimeConfig(cfg);
      })
      .catch(() => {
        // Keep safe defaults
      });
  }, []);

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setActiveTab('remote');
        setIsAddTimeModalOpen(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleInitialBalanceResolved = useCallback((hasBalance: boolean) => {
    if (!hasBalance) {
      setActiveTab('grid');
    }
  }, []);

  const handleSessionExpired = useCallback(() => {
    setIsAddTimeModalOpen(false);
    setActiveTab('grid');
  }, []);

  const handlePaymentRedirectToRemote = useCallback(() => {
    setIsAddTimeModalOpen(false);
    setActiveTab('remote');
  }, []);

  const handleZeroBalancePowerAttempt = useCallback(() => {
    setActiveTab('grid');
  }, []);

  const session = useAcSession({
    user,
    defaultDeviceId: runtimeConfig.deviceId,
    onInitialBalanceResolved: handleInitialBalanceResolved,
    onSessionExpired: handleSessionExpired,
    onPaymentRedirectToRemote: handlePaymentRedirectToRemote,
    onZeroBalancePowerAttempt: handleZeroBalancePowerAttempt,
  });

  if (!authReady) {
    return (
      <div className="min-h-screen bg-clima-mesh text-[#0F172A] flex flex-col items-center justify-center px-6 gap-5">
        <ClimaPayLogo variant="card" size="md" />
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-[#0EA5E9]" aria-hidden="true" />
          <span>Cargando ClimaPay...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView turnstileSiteKey={runtimeConfig.turnstileSiteKey} />;
  }

  const hasActiveTime = session.remainingSeconds > 0;
  const activeViewKey = !session.accountLoaded ? 'loading' : activeTab;

  const activeExpirationLabel =
    session.isPoweredOn && session.activeUntilMs > Date.now()
      ? new Date(session.activeUntilMs).toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      : null;

  return (
    <div className="relative min-h-screen bg-clima-mesh text-[#0F172A] flex flex-col overflow-x-hidden">
      {/* Subtle Active Cooling Glow Accent Over Aquamarine Mesh */}
      {hasActiveTime && session.isPoweredOn && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 transition-opacity duration-500 ease-clima"
          style={{
            background:
              'radial-gradient(640px circle at 50% 6%, rgba(14, 165, 233, 0.09), transparent 58%)',
          }}
        />
      )}

      {activeViewKey !== 'grid' && (
        <DeviceHeader
          online={session.online}
          hasError={session.errorBanner !== null}
          isLoading={session.isLoadingDevice}
          isRefreshing={session.isRefreshing}
          userEmail={user.email || ''}
          userDisplayName={user.displayName || ''}
          onRefresh={session.refreshAll}
          onSignOut={() => void signOut(auth)}
        />
      )}

      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-28 flex flex-col justify-start">
        {/* Compact Error Banner */}
        <AnimatePresence>
          {session.errorBanner && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: CLIMA_EASE }}
              className="alabaster-card w-full max-w-lg mx-auto mb-5 rounded-2xl bg-rose-50/90 px-4 py-3 flex items-center justify-between gap-3"
              style={{ border: '1px solid rgba(225, 29, 72, 0.16)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle
                  className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-rose-900">{session.errorBanner.title}</p>
                  <p className="text-rose-800/85 mt-0.5 break-words">{session.errorBanner.detail}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={session.refreshAll}
                  disabled={session.isRefreshing}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-transform duration-150 ease-clima active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${session.isRefreshing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Reintentar</span>
                </button>
                <button
                  type="button"
                  onClick={session.dismissErrorBanner}
                  aria-label="Cerrar alerta"
                  className="p-1.5 rounded-xl text-rose-700 hover:bg-rose-500/10 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Smooth Framer Motion Transitions Between the 4 Fixed Tabs */}
        <AnimatePresence mode="wait">
          {activeViewKey === 'loading' ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: CLIMA_EASE }}
              className="flex-1 flex flex-col items-center justify-center py-20 gap-4"
            >
              <ClimaPayLogo variant="card" size="sm" />
              <div className="flex items-center gap-2.5 text-sm font-medium text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-[#0EA5E9]" aria-hidden="true" />
                <span>Consultando tiempo disponible...</span>
              </div>
            </motion.div>
          ) : activeViewKey === 'remote' ? (
            <motion.div
              key="remote"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: CLIMA_EASE }}
            >
              <KalleyRemote
                isPoweredOn={session.isPoweredOn}
                online={session.online}
                remainingSeconds={session.remainingSeconds}
                sessionTotalSeconds={session.sessionTotalSeconds}
                cooldownRemainingSeconds={session.cooldownRemainingSeconds}
                climate={session.climate}
                isLoadingInitial={session.isLoadingDevice}
                pendingCommand={session.pendingCommand}
                onTogglePower={session.handleTogglePower}
                onChangeTemp={session.handleChangeTemp}
                onCycleMode={session.handleCycleMode}
                onCycleFan={session.handleCycleFan}
                onOpenAddTime={() => {
                  if (hasActiveTime) {
                    setIsAddTimeModalOpen(true);
                  } else {
                    setActiveTab('grid');
                  }
                }}
              />
            </motion.div>
          ) : activeViewKey === 'calendar' ? (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: CLIMA_EASE }}
              className="w-full max-w-xl mx-auto space-y-4"
            >
              <SpotlightCard staggerIndex={0} className="p-6" ariaLabel="Sesión programada">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-2xl bg-sky-50 text-[#0EA5E9] flex items-center justify-center shrink-0"
                      style={{ border: '1px solid rgba(14, 165, 233, 0.16)' }}
                    >
                      <Calendar className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h1 className="text-base font-bold tracking-tight text-[#0F172A]">
                        Sesiones y Consumo
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {hasActiveTime && session.isPoweredOn && activeExpirationLabel
                          ? `En uso activo · Finaliza aprox. a las ${activeExpirationLabel}`
                          : hasActiveTime
                            ? 'Temporizador pausado · Solo descuenta con el aire encendido'
                            : 'Sin tiempo disponible'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('grid')}
                    className="btn-cyan-luminous inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-full text-xs font-semibold text-white transition-transform duration-150 ease-clima active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{hasActiveTime ? 'Añadir tiempo' : 'Comprar horas'}</span>
                  </button>
                </div>

                <div
                  className="mt-5 pt-4 flex items-center justify-between text-xs tabular-nums"
                  style={{ borderTop: '1px solid rgba(15, 23, 42, 0.06)' }}
                >
                  <span className="text-slate-500">Tiempo restante</span>
                  <span className="font-mono text-base font-bold text-[#0F172A]">
                    {formatDurationHms(session.remainingSeconds)}
                  </span>
                </div>
              </SpotlightCard>

              <PaymentHistoryPanel payments={session.payments} />

              <ActivityLogPanel
                entries={session.activityLog}
                onClear={session.clearActivityLog}
              />
            </motion.div>
          ) : activeViewKey === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: CLIMA_EASE }}
              className="space-y-5"
            >
              {session.sessionExpiredNotice && (
                <motion.div
                  role="status"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: CLIMA_EASE }}
                  className="alabaster-card max-w-4xl mx-auto rounded-2xl bg-amber-50/90 px-5 py-4 flex items-start gap-3 text-sm text-amber-950"
                  style={{ border: '1px solid rgba(245, 158, 11, 0.26)' }}
                >
                  <Clock className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Tu tiempo ha finalizado.</p>
                    <p className="text-xs sm:text-sm text-amber-900/80 mt-0.5">
                      Recarga un plan para volver a activar el control remoto.
                    </p>
                  </div>
                </motion.div>
              )}

              <PlanPaywall
                hasBottomNav
                deviceId={session.deviceId}
                getAuthToken={session.getAuthToken}
                onPaymentCompleted={session.handlePaymentCompleted}
                onClose={() => setActiveTab('remote')}
              />
            </motion.div>
          ) : (
            <motion.div
              key="user"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: CLIMA_EASE }}
              className="w-full max-w-xl mx-auto space-y-4"
            >
              {/* 1. Perfil y Tiempo Disponible */}
              <SpotlightCard staggerIndex={0} className="p-6" ariaLabel="Perfil y tiempo disponible">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-2xl bg-sky-50 text-[#0EA5E9] font-bold text-lg flex items-center justify-center shrink-0"
                    style={{ border: '1px solid rgba(14, 165, 233, 0.16)' }}
                  >
                    {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-base font-bold tracking-tight text-[#0F172A] truncate">
                      {user.displayName || 'Usuario ClimaPay'}
                    </h1>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>

                <div
                  className="mt-5 pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  style={{ borderTop: '1px solid rgba(15, 23, 42, 0.06)' }}
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-[#0EA5E9] shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-xs text-slate-500">
                        Tiempo disponible ·{' '}
                        <span
                          className={
                            hasActiveTime
                              ? session.isPoweredOn
                                ? 'font-semibold text-[#0EA5E9]'
                                : 'font-semibold text-amber-600'
                              : 'font-semibold text-slate-500'
                          }
                        >
                          {hasActiveTime
                            ? session.isPoweredOn
                              ? 'ENFRIANDO'
                              : 'PAUSADO'
                            : 'SIN TIEMPO'}
                        </span>
                      </p>
                      <p className="font-mono text-xl font-extrabold tracking-tight text-[#0F172A] tabular-nums">
                        {formatDurationHms(session.remainingSeconds)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('grid')}
                    className="btn-cyan-luminous inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-full text-xs font-semibold text-white transition-transform duration-150 ease-clima active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{hasActiveTime ? 'Añadir horas' : 'Comprar plan'}</span>
                  </button>
                </div>

                <div
                  className="mt-5 pt-4 flex items-center justify-between text-xs text-slate-500"
                  style={{ borderTop: '1px solid rgba(15, 23, 42, 0.06)' }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#0EA5E9]" aria-hidden="true" />
                    <span>Pagos verificados con Wompi</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void signOut(auth)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-rose-600 hover:bg-rose-50 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Cerrar sesión</span>
                  </button>
                </div>
              </SpotlightCard>

              {/* 2. Estado de Conexión del Relé TQ-Q-SY1-JWT */}
              <SpotlightCard
                staggerIndex={1}
                className="p-6"
                ariaLabel="Estado de conexión del relé TQ-Q-SY1-JWT"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-2xl bg-sky-50 text-[#0EA5E9] flex items-center justify-center shrink-0"
                      style={{ border: '1px solid rgba(14, 165, 233, 0.16)' }}
                    >
                      <Cpu className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold tracking-tight text-[#0F172A]">
                        Relé Wi-Fi TQ-Q-SY1-JWT
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Interruptor inteligente en la nube Tuya
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={session.isRefreshing}
                    onClick={() => void session.fetchDeviceStatus({ logEntry: true })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-semibold text-slate-600 hover:text-[#0EA5E9] bg-slate-50 hover:bg-sky-50/70 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${session.isRefreshing ? 'animate-spin text-[#0EA5E9]' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Verificar</span>
                  </button>
                </div>

                <div
                  className="mt-4 pt-4 grid grid-cols-2 gap-3 text-xs"
                  style={{ borderTop: '1px solid rgba(15, 23, 42, 0.06)' }}
                >
                  <div className="rounded-2xl bg-slate-50/80 px-3.5 py-3">
                    <p className="text-slate-500">Conectividad</p>
                    <p
                      className={`mt-1 inline-flex items-center gap-1.5 font-bold ${
                        session.online === false
                          ? 'text-amber-600'
                          : session.isLoadingDevice
                            ? 'text-slate-500'
                            : 'text-[#0EA5E9]'
                      }`}
                    >
                      {session.online === false ? (
                        <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {session.isLoadingDevice
                          ? 'Sincronizando'
                          : session.online === false
                            ? 'Sin conexión'
                            : 'En línea'}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50/80 px-3.5 py-3">
                    <p className="text-slate-500">Estado del relé</p>
                    <p
                      className={`mt-1 font-bold ${
                        session.switchOn ? 'text-[#0EA5E9]' : 'text-slate-700'
                      }`}
                    >
                      {session.switchOn === true
                        ? 'ENCENDIDO'
                        : session.switchOn === false
                          ? 'APAGADO'
                          : 'Sin lectura'}
                    </p>
                  </div>
                </div>
              </SpotlightCard>

              <TelemetryPanel
                telemetry={session.telemetry}
                isLoadingInitial={session.isLoadingDevice}
                switchOn={session.switchOn}
              />

              {/* 3. Soporte y Seguridad */}
              <SpotlightCard staggerIndex={2} className="p-6" ariaLabel="Soporte ClimaPay">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-2xl bg-sky-50 text-[#0EA5E9] flex items-center justify-center shrink-0"
                    style={{ border: '1px solid rgba(14, 165, 233, 0.16)' }}
                  >
                    <LifeBuoy className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold tracking-tight text-[#0F172A]">
                      Soporte ClimaPay
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                      Tu tiempo solo se descuenta cuando el aire está encendido. Al apagarlo en{' '}
                      <strong className="font-semibold text-slate-700">ON/OFF</strong>, se activa
                      una protección de compresor de 2 minutos antes de poder volver a encenderlo.
                    </p>
                    <a
                      href="mailto:soporte@climapay.app?subject=Soporte%20ClimaPay"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0EA5E9] hover:text-[#0284C7]"
                    >
                      <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>soporte@climapay.app</span>
                    </a>
                  </div>
                </div>
              </SpotlightCard>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Fixed Clean White 4-Tab Bottom Navigation Bar */}
      <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Full-Screen Expanding Cyan Paywall Confirmation Overlay */}
      <AnimatePresence>
        {session.successTransition && (
          <PaywallSuccess
            planName={session.successTransition.planName}
            hoursPurchased={session.successTransition.hoursPurchased}
            totalCop={session.successTransition.totalCop}
            newRemainingSeconds={session.successTransition.newRemainingSeconds}
            onContinueNow={session.dismissSuccessTransition}
          />
        )}
      </AnimatePresence>

      {/* Quick In-App Drawer for "+ Añadir tiempo" */}
      <AddTimeModal
        open={isAddTimeModalOpen && hasActiveTime}
        deviceId={session.deviceId}
        getAuthToken={session.getAuthToken}
        onClose={() => setIsAddTimeModalOpen(false)}
        onPaymentCompleted={session.handlePaymentCompleted}
      />
    </div>
  );
}
