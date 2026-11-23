import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import type { ActivityLogEntry } from '../types/device';

interface ActivityLogPanelProps {
  entries: ActivityLogEntry[];
  onClear: () => void;
}

function formatLogTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString('es-CO', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

export function ActivityLogPanel({ entries, onClear }: ActivityLogPanelProps) {
  return (
    <section
      aria-label="Registro de actividad"
      className="alabaster-card rounded-3xl overflow-hidden"
    >
      <div
        className="px-5 py-4 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.06)' }}
      >
        <div>
          <h2 className="text-sm font-bold tracking-tight text-[#0F172A]">
            Registro de comandos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Últimas {entries.length} acciones registradas
          </p>
        </div>

        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#0F172A] transition-transform duration-150 ease-clima active:scale-95 whitespace-nowrap shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Limpiar</span>
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-[#0F172A]">Sin comandos registrados</p>
          <p className="text-xs text-slate-500 mt-1">
            Las respuestas de encendido, apagado y recarga aparecerán aquí.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-900/5">
          {entries.slice(0, 8).map((entry) => (
            <li
              key={entry.id}
              className="px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-white/60 transition-opacity duration-150 ease-clima"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {entry.ok ? (
                  <CheckCircle2
                    className="w-4 h-4 text-[#0EA5E9] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertCircle
                    className="w-4 h-4 text-rose-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                )}

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-semibold text-[#0F172A]">{entry.action}</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span
                      className={
                        entry.ok ? 'text-[#0EA5E9] font-medium' : 'text-rose-600 font-medium'
                      }
                    >
                      {entry.ok ? 'OK' : 'Error'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 break-words">{entry.summary}</p>
                </div>
              </div>

              <time
                dateTime={entry.timestamp}
                className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap shrink-0"
              >
                {formatLogTime(entry.timestamp)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
