import { motion } from 'motion/react';
import { Droplets, Fan, Snowflake, Sparkles, Wind } from 'lucide-react';
import { CLIMATE_TEMP_MAX_C, CLIMATE_TEMP_MIN_C } from '../../config/climate';
import { CLIMA_EASE } from '../SpotlightCard';
import type { ClimateControlState, ClimateMode, FanSpeedLevel } from '../../types';

const MODE_LCD_LABELS: Record<ClimateMode, string> = {
  cool: 'COOL',
  dry: 'DRY',
  fan: 'FAN',
  auto: 'AUTO',
};

const FAN_LABELS: Record<FanSpeedLevel, string> = {
  auto: 'AUTO',
  low: 'BAJO',
  mid: 'MED',
  high: 'ALTO',
};

const FAN_BAR_LEVEL: Record<FanSpeedLevel, number> = {
  auto: 3,
  low: 1,
  mid: 2,
  high: 3,
};

export interface LcdDisplayProps {
  isCooling: boolean;
  climate: ClimateControlState;
  fanSpinClass: string;
  minTempC?: number;
  maxTempC?: number;
}

export function LcdDisplay({
  isCooling,
  climate,
  fanSpinClass,
  minTempC = CLIMATE_TEMP_MIN_C,
  maxTempC = CLIMATE_TEMP_MAX_C,
}: LcdDisplayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={
        isCooling
          ? `Pantalla digital del aire acondicionado: ${climate.tempSet} grados Celsius, modo ${MODE_LCD_LABELS[climate.mode]}, ventilador ${FAN_LABELS[climate.fanSpeed]}`
          : 'Pantalla digital del aire acondicionado: Apagado'
      }
      className={`w-full rounded-[22px] px-4 py-3.5 mb-6 transition-colors duration-200 ease-clima ${
        isCooling ? 'remote-lcd-screen' : 'remote-lcd-screen-off'
      }`}
    >
      {/* LCD Top Status Strip: Mode Indicator + Fan Speed Level Bars */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-900/[0.06]">
        <div
          className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold tracking-[0.14em] ${
            isCooling ? 'text-[#0284C7]' : 'text-slate-400'
          }`}
        >
          {climate.mode === 'cool' && (
            <Snowflake className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
          )}
          {climate.mode === 'dry' && (
            <Droplets className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
          )}
          {climate.mode === 'fan' && (
            <Wind className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
          )}
          {climate.mode === 'auto' && (
            <Sparkles className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
          )}
          <span>{MODE_LCD_LABELS[climate.mode]}</span>
        </div>

        <div
          className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold tracking-[0.12em] ${
            isCooling ? 'text-slate-600' : 'text-slate-400'
          }`}
        >
          <Fan
            className={`w-3 h-3 stroke-[2.2] ${isCooling ? 'text-[#0EA5E9]' : 'text-slate-400'} ${fanSpinClass}`}
            aria-hidden="true"
          />
          <span>{FAN_LABELS[climate.fanSpeed]}</span>
          {/* Minimalist 3-Bar Fan Signal Indicator */}
          <span aria-hidden="true" className="inline-flex items-end gap-[2px] h-2.5 ml-0.5">
            {[1, 2, 3].map((bar) => {
              const activeBar = isCooling && FAN_BAR_LEVEL[climate.fanSpeed] >= bar;
              return (
                <span
                  key={bar}
                  className={`w-[3px] rounded-full transition-colors duration-150 ${
                    activeBar ? 'bg-[#0EA5E9]' : 'bg-slate-300/75'
                  }`}
                  style={{ height: `${bar * 3 + 1}px` }}
                />
              );
            })}
          </span>
        </div>
      </div>

      {/* LCD Main Temperature Readout */}
      <div className="pt-2.5 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1">
          {isCooling ? (
            <motion.span
              key={climate.tempSet}
              initial={{ opacity: 0.55, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: CLIMA_EASE }}
              className="font-mono text-[42px] font-bold tracking-[-0.04em] text-[#0F172A] tabular-nums leading-none"
            >
              {climate.tempSet}
              <span className="text-[22px] font-semibold text-[#0EA5E9] align-top ml-0.5">
                °C
              </span>
            </motion.span>
          ) : (
            <span className="font-mono text-[40px] font-bold tracking-[0.04em] text-slate-400/75 tabular-nums leading-none">
              --
              <span className="text-[20px] font-semibold text-slate-400/65 align-top ml-0.5">
                °C
              </span>
            </span>
          )}
        </div>

        <div className="text-right flex flex-col items-end justify-end">
          {isCooling ? (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold tracking-[0.14em] text-[#0284C7]">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9]" />
                ON
              </span>
              <span className="mt-0.5 font-mono text-[10px] font-medium text-slate-500 tabular-nums">
                {minTempC}°–{maxTempC}°C
              </span>
            </>
          ) : (
            <>
              <span className="text-[11px] font-mono font-bold tracking-[0.16em] text-slate-400">
                OFF
              </span>
              <span className="mt-0.5 font-mono text-[10px] font-medium text-slate-400/90 tabular-nums">
                SET {climate.tempSet}°C
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
