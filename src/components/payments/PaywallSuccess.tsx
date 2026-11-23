import { motion } from 'motion/react';
import { ArrowRight, Check, Snowflake } from 'lucide-react';
import { formatDurationHms } from '../../config/plans';
import { CLIMA_EASE, CLIMA_SPRING_EASE } from '../SpotlightCard';
import { ClimaPayLogo } from '../ClimaPayLogo';

export interface PaywallSuccessProps {
  planName?: string;
  hoursPurchased: number;
  totalCop: number;
  newRemainingSeconds: number;
  onContinueNow: () => void;
}

export function PaywallSuccess({
  planName,
  hoursPurchased,
  newRemainingSeconds,
  onContinueNow,
}: PaywallSuccessProps) {
  const hoursLabel = hoursPurchased === 1 ? '1 hora lista' : `${hoursPurchased} horas listas`;

  return (
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-label="Tiempo cargado exitosamente"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: CLIMA_EASE }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between px-6 py-10 sm:py-14 overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, #0EA5E9 0%, #0284C7 100%)',
      }}
    >
      {/* Expanding Compositor-Only Radial Ripple Transition from Bottom CTA Origin */}
      <motion.div
        aria-hidden="true"
        initial={{ scale: 0.16, opacity: 0.45 }}
        animate={{ scale: 2.8, opacity: 1 }}
        transition={{ duration: 0.58, ease: CLIMA_EASE }}
        className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(56, 189, 248, 0.34) 0%, rgba(14, 165, 233, 0.12) 52%, transparent 72%)',
        }}
      />

      {/* Top Brand Mark */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.32, ease: CLIMA_EASE }}
        className="relative z-10"
      >
        <ClimaPayLogo variant="horizontal" size="sm" inverted />
      </motion.div>

      {/* Center Confirmation Content */}
      <div className="relative z-10 w-full max-w-md mx-auto text-center flex flex-col items-center my-auto py-8">
        <div className="relative w-24 h-24 mb-8 flex items-center justify-center">
          <motion.div
            initial={{ scale: 0.45, opacity: 0 }}
            animate={{ scale: 1.35, opacity: 0.22 }}
            transition={{ delay: 0.1, duration: 0.65, ease: CLIMA_EASE }}
            className="absolute inset-0 rounded-full bg-white"
          />
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.14, duration: 0.48, ease: CLIMA_SPRING_EASE }}
            className="relative w-20 h-20 rounded-full bg-white/18 backdrop-blur-md text-white flex items-center justify-center"
            style={{
              border: '1.5px solid rgba(255, 255, 255, 0.42)',
              boxShadow: '0 18px 36px -10px rgba(2, 132, 199, 0.45)',
            }}
          >
            <Snowflake className="w-9 h-9 stroke-[2]" aria-hidden="true" />
          </motion.div>

          <motion.span
            initial={{ scale: 0, rotate: -35, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.42, ease: CLIMA_SPRING_EASE }}
            className="absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full bg-white text-[#0284C7] flex items-center justify-center shadow-lg"
          >
            <Check className="w-4 h-4 stroke-[3]" aria-hidden="true" />
          </motion.span>
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.36, ease: CLIMA_EASE }}
          className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white text-balance"
        >
          ¡Tiempo Cargado!
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.36, ease: CLIMA_EASE }}
          className="mt-3.5 text-[15px] sm:text-base text-sky-50/95 leading-relaxed max-w-sm text-balance"
        >
          {hoursLabel} en tu saldo. El tiempo solo correrá cuando enciendas el aire.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34, duration: 0.34, ease: CLIMA_EASE }}
          className="mt-7 pt-5 w-full max-w-xs flex items-center justify-center gap-2.5 text-xs text-sky-100/90 tabular-nums"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.2)' }}
        >
          {planName && (
            <>
              <span className="font-semibold text-white">{planName}</span>
              <span aria-hidden="true" className="text-sky-200/70">
                ·
              </span>
            </>
          )}
          <span className="font-mono font-bold text-white">
            {formatDurationHms(newRemainingSeconds)}
          </span>
          <span aria-hidden="true" className="text-sky-200/70">
            ·
          </span>
          <span className="font-semibold text-sky-100">PAUSADO</span>
        </motion.div>
      </div>

      {/* Bottom Dark Pill CTA */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.4, ease: CLIMA_EASE }}
        className="relative z-10 w-full max-w-sm mx-auto"
      >
        <button
          type="button"
          onClick={onContinueNow}
          className="w-full min-h-[56px] px-6 py-4 rounded-full bg-[#0F172A] hover:bg-slate-800 text-white text-[15px] font-bold tracking-tight transition-transform duration-150 ease-clima active:scale-[0.98] flex items-center justify-center gap-2.5 cursor-pointer shadow-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
        >
          <span>Ir al Control Remoto</span>
          <ArrowRight className="w-4 h-4 stroke-[2.4]" aria-hidden="true" />
        </button>
      </motion.div>
    </motion.section>
  );
}
