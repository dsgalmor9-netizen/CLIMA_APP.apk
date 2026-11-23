import { Activity, Gauge, Zap } from 'lucide-react';
import type { DeviceTelemetry } from '../types/device';

interface TelemetryPanelProps {
  telemetry: DeviceTelemetry;
  isLoadingInitial: boolean;
  switchOn: boolean | null;
}

export function TelemetryPanel({
  telemetry,
  isLoadingInitial,
  switchOn,
}: TelemetryPanelProps) {
  const hasAnyReading =
    telemetry.voltageV !== null ||
    telemetry.currentMa !== null ||
    telemetry.powerW !== null;

  const currentAmps =
    telemetry.currentMa !== null ? (telemetry.currentMa / 1000).toFixed(2) : null;

  return (
    <section
      aria-label="Telemetría eléctrica"
      className="alabaster-card rounded-3xl overflow-hidden"
    >
      <div
        className="px-5 py-4 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.06)' }}
      >
        <div>
          <h2 className="text-sm font-bold tracking-tight text-[#0F172A]">
            Telemetría eléctrica
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Lectura en vivo</p>
        </div>
        <span className="font-mono text-xs text-slate-500 whitespace-nowrap shrink-0">
          {hasAnyReading ? 'Medidor activo' : 'Sin lecturas'}
        </span>
      </div>

      {isLoadingInitial ? (
        <div className="divide-y divide-slate-900/5">
          {[0, 1, 2].map((item) => (
            <div key={item} className="px-5 py-4 flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3.5 w-24 rounded bg-slate-200/80 animate-pulse" />
                <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
              </div>
              <div className="h-7 w-24 rounded bg-slate-200/80 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-900/5">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Gauge className="w-4 h-4 text-[#0EA5E9] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F172A]">Voltaje</p>
                <p className="text-xs text-slate-500 font-mono">cur_voltage</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {telemetry.voltageV !== null ? telemetry.voltageV.toFixed(1) : '—'}
                <span className="text-xs font-medium text-slate-500 ml-1">V</span>
              </p>
            </div>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Activity className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F172A]">Corriente</p>
                <p className="text-xs text-slate-500 font-mono">cur_current</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {telemetry.currentMa !== null ? telemetry.currentMa.toLocaleString('es-CO') : '—'}
                <span className="text-xs font-medium text-slate-500 ml-1">mA</span>
              </p>
              {currentAmps !== null && telemetry.currentMa !== null && telemetry.currentMa > 0 && (
                <p className="font-mono text-xs text-slate-500 tabular-nums mt-0.5">
                  {currentAmps} A
                </p>
              )}
            </div>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Zap className="w-4 h-4 text-[#F59E0B] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0F172A]">Potencia</p>
                <p className="text-xs text-slate-500 font-mono">cur_power</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                {telemetry.powerW !== null ? telemetry.powerW.toFixed(1) : '—'}
                <span className="text-xs font-medium text-slate-500 ml-1">W</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {!isLoadingInitial && !hasAnyReading && (
        <div
          className="px-5 py-3 bg-slate-50/70 text-xs text-slate-500"
          style={{ borderTop: '1px solid rgba(15, 23, 42, 0.05)' }}
        >
          El equipo aún no reporta lecturas de voltaje, corriente ni potencia.
        </div>
      )}

      {!isLoadingInitial && hasAnyReading && switchOn === false && (
        <div
          className="px-5 py-3 bg-slate-50/70 text-xs text-slate-500"
          style={{ borderTop: '1px solid rgba(15, 23, 42, 0.05)' }}
        >
          Con el equipo apagado, la corriente y potencia de carga suelen reportar 0.
        </div>
      )}
    </section>
  );
}
