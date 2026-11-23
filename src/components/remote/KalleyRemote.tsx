import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Fan,
  Loader2,
  Minus,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Snowflake,
} from 'lucide-react';
import {
  CLIMATE_MODES,
  CLIMATE_TEMP_MAX_C,
  CLIMATE_TEMP_MIN_C,
  COMPRESSOR_COOLDOWN_SECONDS,
  FAN_SPEEDS,
  LOW_BALANCE_WARNING_SECONDS,
} from '../../config/climate';
import { formatDurationHms } from '../../config/plans';
import { CLIMA_EASE, CLIMA_SPRING_EASE } from '../SpotlightCard';
import { ClimaPayLogo } from '../ClimaPayLogo';
import { LcdDisplay } from './LcdDisplay';
import type { ClimateControlState, ClimateMode, FanSpeedLevel } from '../../types';

const MODE_LABELS: Record<ClimateMode, string> = {
  cool: 'FRÍO',
  dry: 'SECO',
  fan: 'VENT',
  auto: 'AUTO',
};

const FAN_LABELS: Record<FanSpeedLevel, string> = {
  auto: 'AUTO',
  low: 'BAJO',
  mid: 'MED',
  high: 'ALTO',
};

export interface KalleyRemoteProps {
  isPoweredOn: boolean;
  online: boolean | null;
  remainingSeconds: number;
  sessionTotalSeconds: number;
  cooldownRemainingSeconds: number;
  climate: ClimateControlState;
  isLoadingInitial: boolean;
  pendingCommand: 'on' | 'off' | null;
  onTogglePower: () => void;
  onChangeTemp: (nextTemp: number) => void;
  onCycleMode: (nextMode: ClimateMode) => void;
  onCycleFan: (nextFan: FanSpeedLevel) => void;
  onOpenAddTime: () => void;
}

export function KalleyRemote({
  isPoweredOn,
  online,
  remainingSeconds,
  sessionTotalSeconds,
  cooldownRemainingSeconds,
  climate,
  isLoadingInitial,
  pendingCommand,
  onTogglePower,
  onChangeTemp,
  onCycleMode,
  onCycleFan,
  onOpenAddTime,
}: KalleyRemoteProps) {
  const remoteCardRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartTempRef = useRef<number>(climate.tempSet);

  const hasTime = remainingSeconds > 0;
  const isCooling = isPoweredOn && hasTime;
  const isBusy = pendingCommand !== null;
  const isTurnOnCooldownActive = !isCooling && cooldownRemainingSeconds > 0;
  const isPowerDisabled = isBusy || !hasTime || isTurnOnCooldownActive;

  const cooldownFormatted = `${String(Math.floor(cooldownRemainingSeconds / 60)).padStart(2, '0')}:${String(
    cooldownRemainingSeconds % 60
  ).padStart(2, '0')}`;

  const safeTotalSeconds = Math.max(remainingSeconds, sessionTotalSeconds || 3600, 1);
  const remainingRatio = Math.min(1, Math.max(0, remainingSeconds / safeTotalSeconds));

  const handleCardPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = remoteCardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    el.style.setProperty('--spot-opacity', '1');
  }, []);

  const handleCardPointerLeave = useCallback(() => {
    const el = remoteCardRef.current;
    if (!el) return;
    el.style.setProperty('--spot-opacity', '0');
  }, []);

  const adjustTemp = useCallback(
    (delta: number) => {
      const next = Math.min(
        CLIMATE_TEMP_MAX_C,
        Math.max(CLIMATE_TEMP_MIN_C, climate.tempSet + delta)
      );
      if (next !== climate.tempSet) {
        onChangeTemp(next);
      }
    },
    [climate.tempSet, onChangeTemp]
  );

  const handleCycleModeClick = useCallback(() => {
    const idx = CLIMATE_MODES.indexOf(climate.mode);
    const nextMode = CLIMATE_MODES[(idx + 1) % CLIMATE_MODES.length];
    onCycleMode(nextMode);
  }, [climate.mode, onCycleMode]);

  const handleCycleFanClick = useCallback(() => {
    const idx = FAN_SPEEDS.indexOf(climate.fanSpeed);
    const nextFan = FAN_SPEEDS[(idx + 1) % FAN_SPEEDS.length];
    onCycleFan(nextFan);
  }, [climate.fanSpeed, onCycleFan]);

  const handleDialPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartYRef.current = e.clientY;
    dragStartTempRef.current = climate.tempSet;
  };

  const handleDialPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const deltaY = dragStartYRef.current - e.clientY;
    const stepDelta = Math.round(deltaY / 18);
    const next = Math.min(
      CLIMATE_TEMP_MAX_C,
      Math.max(CLIMATE_TEMP_MIN_C, dragStartTempRef.current + stepDelta)
    );
    if (next !== climate.tempSet) {
      onChangeTemp(next);
    }
  };

  const handleDialPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartYRef.current = null;
  };

  const fanSpinClass = !isCooling
    ? ''
    : climate.fanSpeed === 'high'
      ? 'fan-spin-fast'
      : climate.fanSpeed === 'mid'
        ? 'fan-spin-med'
        : 'fan-spin-slow';

  const statusText = isLoadingInitial
    ? 'SINCRONIZANDO'
    : !hasTime
      ? 'SIN TIEMPO'
      : isCooling
        ? climate.mode === 'fan'
          ? 'VENTILANDO'
          : climate.mode === 'dry'
            ? 'DESHUMIDIFICANDO'
            : 'ENFRIANDO'
        : online === false
          ? 'OFFLINE'
          : 'PAUSADO';

  const isPaused = !isLoadingInitial && hasTime && !isCooling && online !== false;
  const isLowBalance = remainingSeconds <= LOW_BALANCE_WARNING_SECONDS;

  return (
    <div className="w-full max-w-[380px] mx-auto flex flex-col items-center">
      {/* 1. TOP COMPACT SESSION COUNTDOWN BLOCK */}
      <motion.section
        aria-label="Tiempo restante de sesión"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: CLIMA_EASE }}
        className="w-full max-w-[330px] text-center mb-6 sm:mb-7 flex flex-col items-center"
      >
        <ClimaPayLogo variant="horizontal" size="sm" className="mb-3.5" />

        <p
          className={`text-[42px] sm:text-[46px] font-bold tracking-tight tabular-nums leading-none ${
            isLowBalance
              ? 'text-amber-600'
              : isCooling
                ? 'text-[#0F172A]'
                : 'text-slate-600'
          }`}
        >
          {formatDurationHms(remainingSeconds)}
        </p>

        {/* Thin Horizontal Cyan / Paused Progress Bar */}
        <div className="mt-3.5 h-[5px] w-full rounded-full bg-slate-200/85 overflow-hidden">
          <div
            className={`h-full w-full rounded-full transition-transform duration-500 ease-clima ${
              isLowBalance
                ? 'bg-[#F59E0B]'
                : isCooling
                  ? 'bg-[#0EA5E9]'
                  : 'bg-[#0EA5E9]/55'
            }`}
            style={{
              transformOrigin: '0% 50%',
              transform: `scaleX(${remainingRatio})`,
            }}
          />
        </div>

        {/* Compact Status Line Below Progress Bar */}
        <div className="mt-2.5 flex items-center justify-center gap-2">
          <div className="inline-flex items-center gap-1.5">
            {isLoadingInitial ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0EA5E9]" aria-hidden="true" />
            ) : isCooling ? (
              <Snowflake className="w-3.5 h-3.5 text-[#0EA5E9]" aria-hidden="true" />
            ) : isPaused ? (
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full bg-[#F59E0B] shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
              />
            ) : (
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-slate-400" />
            )}
            <span
              className={`text-[11px] font-bold tracking-[0.14em] ${
                isCooling
                  ? 'text-[#0EA5E9]'
                  : isPaused
                    ? 'text-amber-700'
                    : 'text-slate-500'
              }`}
            >
              {statusText}
            </span>
          </div>

          <span aria-hidden="true" className="text-slate-300 text-xs">
            ·
          </span>

          <button
            type="button"
            onClick={onOpenAddTime}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-500 hover:text-[#0EA5E9] transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            <span>Añadir</span>
          </button>
        </div>

        <p className="mt-2 text-[11px] text-slate-500/90 leading-snug">
          {hasTime
            ? 'El tiempo solo corre cuando enciendes el aire.'
            : 'Carga un plan en Grid para habilitar el encendido.'}
        </p>

        {/* Discreet Low-Balance Warning when < 5 minutes remaining while actively cooling */}
        {isCooling && remainingSeconds > 0 && isLowBalance && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: CLIMA_EASE }}
            className="mt-3 w-full rounded-2xl bg-amber-50/95 px-3.5 py-2.5 flex items-center justify-between gap-2.5 text-left"
            style={{ border: '1px solid rgba(245, 158, 11, 0.28)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0" aria-hidden="true" />
              <span className="text-[11.5px] font-medium text-amber-900 leading-snug">
                Saldo bajo: menos de 5 min restantes.
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenAddTime}
              className="px-2.5 py-1 min-h-[30px] rounded-full text-[11px] font-bold bg-[#F59E0B] hover:bg-amber-500 text-white whitespace-nowrap shrink-0 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
            >
              Recargar
            </button>
          </motion.div>
        )}

        {!hasTime && !isLoadingInitial && (
          <button
            type="button"
            onClick={onOpenAddTime}
            className="btn-cyan-luminous mt-3.5 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 min-h-[42px] rounded-full text-xs font-bold text-white transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
            <span>Elegir plan de tiempo</span>
          </button>
        )}
      </motion.section>

      {/* 2. CENTRAL FLOATING PHYSICAL-STYLE DIGITAL REMOTE BODY (KALLEY) */}
      <motion.section
        ref={remoteCardRef}
        aria-label="Control remoto digital Kalley"
        onPointerMove={handleCardPointerMove}
        onPointerLeave={handleCardPointerLeave}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.44, delay: 0.05, ease: CLIMA_EASE }}
        className="remote-chassis relative w-full max-w-[332px] rounded-[44px] px-7 pt-6 pb-7 overflow-hidden select-none"
      >
        <div aria-hidden="true" className="spotlight-overlay" />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 inset-x-0 h-44 transition-opacity duration-300 ease-clima"
          style={{
            opacity: isCooling ? 0.85 : 0.25,
            background:
              'radial-gradient(ellipse 68% 60% at 50% 0%, rgba(14, 165, 233, 0.12), transparent 72%)',
          }}
        />

        <div className="relative z-10 flex flex-col items-center">
          {/* INTEGRATED DIGITAL LCD DISPLAY */}
          <LcdDisplay
            isCooling={isCooling}
            climate={climate}
            fanSpinClass={fanSpinClass}
            minTempC={CLIMATE_TEMP_MIN_C}
            maxTempC={CLIMATE_TEMP_MAX_C}
          />

          {/* TOP CONTROL: Circular Warm Gold/Amber ON/OFF Button + 120s Post-Shutoff Cooldown */}
          <div className="flex flex-col items-center">
            <div className="relative flex items-center justify-center">
              {isTurnOnCooldownActive && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 92 92"
                  className="pointer-events-none absolute -inset-[7px] w-[92px] h-[92px] -rotate-90"
                >
                  <circle
                    cx="46"
                    cy="46"
                    r="43"
                    fill="none"
                    stroke="rgba(245, 158, 11, 0.16)"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="46"
                    cy="46"
                    r="43"
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 43}
                    strokeDashoffset={
                      2 *
                      Math.PI *
                      43 *
                      (1 -
                        Math.min(
                          1,
                          Math.max(0, cooldownRemainingSeconds / COMPRESSOR_COOLDOWN_SECONDS)
                        ))
                    }
                    className="transition-[stroke-dashoffset] duration-700 ease-linear"
                  />
                </svg>
              )}

              <button
                type="button"
                disabled={isPowerDisabled}
                aria-disabled={isPowerDisabled}
                onClick={onTogglePower}
                aria-pressed={isCooling}
                aria-label={
                  isTurnOnCooldownActive
                    ? `Protección de compresor activa. Espera ${cooldownFormatted} para encender`
                    : isCooling
                      ? 'Apagar aire acondicionado'
                      : 'Encender aire acondicionado'
                }
                className={`relative w-[78px] h-[78px] rounded-full text-white flex items-center justify-center transition-transform duration-150 ease-clima focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/40 ${
                  isCooling ? 'btn-gold-power' : 'btn-gold-power-off'
                } ${
                  isTurnOnCooldownActive || !hasTime
                    ? 'opacity-45 cursor-not-allowed grayscale-[20%]'
                    : isBusy
                      ? 'opacity-60 cursor-not-allowed'
                      : 'active:scale-95 cursor-pointer'
                }`}
              >
                {isBusy ? (
                  <Loader2 className="w-8 h-8 animate-spin stroke-[2.4]" aria-hidden="true" />
                ) : (
                  <Power className="w-8 h-8 stroke-[2.4]" aria-hidden="true" />
                )}
              </button>
            </div>

            <span className="mt-2.5 text-[11px] font-bold tracking-[0.16em] text-[#475569]">
              ON/OFF
            </span>

            {isTurnOnCooldownActive && (
              <motion.div
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: CLIMA_EASE }}
                className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-amber-800 bg-amber-50/95 tabular-nums"
                style={{ border: '1px solid rgba(245, 158, 11, 0.24)' }}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" aria-hidden="true" />
                <span>Espera</span>
                <span className="font-mono font-bold text-amber-900">{cooldownFormatted}</span>
                <span>para encender</span>
              </motion.div>
            )}
          </div>

          {/* MIDDLE CONTROL: Circular Temperature Dial with Thin Cyan Ring */}
          <div className="mt-7 relative flex items-center justify-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-3 rounded-full transition-opacity duration-300 ease-clima"
              style={{
                opacity: isCooling ? 1 : 0.2,
                background:
                  'radial-gradient(circle, rgba(14, 165, 233, 0.14) 0%, rgba(14, 165, 233, 0.04) 55%, transparent 74%)',
              }}
            />

            <div
              role="slider"
              tabIndex={0}
              aria-label="Temperatura objetivo del aire acondicionado"
              aria-valuemin={CLIMATE_TEMP_MIN_C}
              aria-valuemax={CLIMATE_TEMP_MAX_C}
              aria-valuenow={climate.tempSet}
              onPointerDown={handleDialPointerDown}
              onPointerMove={handleDialPointerMove}
              onPointerUp={handleDialPointerUp}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  adjustTemp(1);
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  adjustTemp(-1);
                }
              }}
              className="temp-dial-surface relative w-[198px] h-[198px] rounded-full flex flex-col items-center justify-between py-4 touch-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0EA5E9]/30"
              style={{
                border: isCooling
                  ? '2px solid #0EA5E9'
                  : '2px solid rgba(14, 165, 233, 0.48)',
              }}
            >
              <button
                type="button"
                onClick={() => adjustTemp(1)}
                disabled={climate.tempSet >= CLIMATE_TEMP_MAX_C}
                aria-label="Subir temperatura 1 grado"
                title="Subir temperatura (+1°C)"
                className="group relative min-w-[56px] min-h-[44px] rounded-full flex items-center justify-center text-[#0EA5E9] hover:bg-sky-50/90 transition-transform duration-150 ease-clima active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <Plus className="w-6 h-6 stroke-[2.5]" aria-hidden="true" />
              </button>

              <div className="flex flex-col items-center justify-center pointer-events-none">
                <motion.span
                  key={climate.tempSet}
                  initial={{ scale: 0.92, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.22, ease: CLIMA_SPRING_EASE }}
                  className="text-[20px] font-bold tracking-[0.22em] text-[#0F172A] pl-[0.22em] leading-none"
                >
                  TEMP
                </motion.span>
              </div>

              <button
                type="button"
                onClick={() => adjustTemp(-1)}
                disabled={climate.tempSet <= CLIMATE_TEMP_MIN_C}
                aria-label="Bajar temperatura 1 grado"
                title="Bajar temperatura (-1°C)"
                className="min-w-[56px] min-h-[44px] rounded-full flex items-center justify-center text-slate-600 hover:text-[#0EA5E9] hover:bg-sky-50/90 transition-transform duration-150 ease-clima active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <Minus className="w-6 h-6 stroke-[2.5]" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* LOWER ROW: Two Side-by-Side Floating Action Buttons (MODE & FAN) */}
          <div className="mt-8 w-full grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={handleCycleModeClick}
              aria-label={`Cambiar modo (actual: ${MODE_LABELS[climate.mode]})`}
              className="remote-action-tile min-h-[82px] px-3 py-3.5 rounded-[22px] flex flex-col items-center justify-center gap-1.5 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
            >
              <RefreshCw
                className="w-[22px] h-[22px] text-[#0EA5E9] stroke-[2]"
                aria-hidden="true"
              />
              <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]">
                MODE
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-slate-400">
                {MODE_LABELS[climate.mode]}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCycleFanClick}
              aria-label={`Cambiar velocidad del ventilador (actual: ${FAN_LABELS[climate.fanSpeed]})`}
              className="remote-action-tile min-h-[82px] px-3 py-3.5 rounded-[22px] flex flex-col items-center justify-center gap-1.5 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
            >
              <Fan
                className={`w-[22px] h-[22px] text-[#0EA5E9] stroke-[2] ${fanSpinClass}`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]">
                FAN
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-slate-400">
                {FAN_LABELS[climate.fanSpeed]}
              </span>
            </button>
          </div>

          {/* BOTTOM BRAND MARK: Centered Kalley Wordmark with Signature Arch above "ll" */}
          <div className="mt-8 pt-1 flex items-center justify-center" aria-label="Kalley">
            <svg viewBox="0 0 132 40" className="h-7 w-auto" role="img" aria-label="Kalley">
              <path
                d="M 55 11 Q 69 2 84 11"
                fill="none"
                stroke="#64748B"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <text
                x="66"
                y="31"
                textAnchor="middle"
                fill="#475569"
                style={{
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                  fontSize: '23px',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                }}
              >
                Kalley
              </text>
            </svg>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
