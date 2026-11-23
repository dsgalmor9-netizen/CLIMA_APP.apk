import { motion } from 'motion/react';
import { formatCop, formatCopShort, formatSecondsCount } from '../../config/plans';
import { CLIMA_EASE, CLIMA_SPRING_EASE } from '../SpotlightCard';
import type { ClimaPlanDefinition } from '../../types';

export interface PlanCardProps {
  plan: ClimaPlanDefinition;
  isSelected: boolean;
  index: number;
  onSelect: (plan: ClimaPlanDefinition) => void;
}

export function PlanCard({ plan, isSelected, index, onSelect }: PlanCardProps) {
  const hasDiscount = plan.originalCop > plan.totalCop;

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={() => onSelect(plan)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: CLIMA_EASE }}
      whileTap={{ scale: 0.985 }}
      className="relative w-full text-left rounded-2xl px-4 py-4 sm:px-5 sm:py-4 min-h-[84px] flex items-center justify-between gap-3.5 transition-colors duration-150 ease-clima cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] focus-visible:ring-offset-2"
      style={{
        backgroundColor: isSelected ? 'rgba(14, 165, 233, 0.055)' : '#FFFFFF',
        border: isSelected ? '2px solid #0EA5E9' : '1px solid rgba(15, 23, 42, 0.07)',
        boxShadow: isSelected
          ? '0 10px 26px -8px rgba(14, 165, 233, 0.22), 0 4px 10px -4px rgba(15, 23, 42, 0.04)'
          : '0 8px 24px -6px rgba(15, 23, 42, 0.06), 0 2px 6px -2px rgba(15, 23, 42, 0.03)',
      }}
    >
      {/* Left + Middle: Radio Indicator + Plan Info */}
      <div className="flex items-start gap-3.5 min-w-0">
        <span
          aria-hidden="true"
          className="mt-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ease-clima"
          style={{
            backgroundColor: isSelected ? '#0EA5E9' : 'transparent',
            border: isSelected ? '2px solid #0EA5E9' : '2px solid #CBD5E1',
          }}
        >
          {isSelected && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.2, ease: CLIMA_SPRING_EASE }}
              className="w-2 h-2 rounded-full bg-white"
            />
          )}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-[14.5px] sm:text-[15px] font-bold tracking-tight text-[#0F172A] leading-snug">
              {plan.name} — {plan.hoursLabel}
            </span>

            {plan.badge && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight whitespace-nowrap shrink-0 ${
                  plan.badge.tone === 'amber'
                    ? 'bg-amber-500/15 text-amber-700'
                    : 'bg-sky-500/15 text-[#0284C7]'
                }`}
              >
                {plan.badge.text}
              </span>
            )}
          </div>

          <p className="mt-1 text-xs sm:text-[13px] text-slate-500 leading-snug">
            {plan.subtitle}
          </p>

          {hasDiscount && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight text-emerald-700 bg-emerald-500/12 whitespace-nowrap"
                style={{ border: '1px solid rgba(16, 185, 129, 0.2)' }}
              >
                Ahorras {plan.discountPercent}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Discounted Price, Original Strikethrough & Exact Seconds */}
      <div className="text-right tabular-nums shrink-0 pl-1">
        <span className="block text-[15.5px] sm:text-[17px] font-extrabold tracking-tight text-[#0F172A] whitespace-nowrap leading-tight">
          {formatCop(plan.totalCop)}
        </span>

        {hasDiscount && (
          <span className="mt-0.5 block text-[11px] line-through text-slate-400 font-medium leading-tight">
            Antes {formatCopShort(plan.originalCop)}
          </span>
        )}

        <span className="mt-1 block font-mono text-[11px] font-medium text-slate-500 leading-none">
          {formatSecondsCount(plan.addedSeconds)}
        </span>
      </div>
    </motion.button>
  );
}
