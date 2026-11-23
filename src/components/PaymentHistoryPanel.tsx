import { CheckCircle2, Receipt, XCircle } from 'lucide-react';
import { formatCop } from '../shared/pricing';
import type { PaymentRecordItem } from '../types/device';

interface PaymentHistoryPanelProps {
  payments: PaymentRecordItem[];
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CO', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

export function PaymentHistoryPanel({ payments }: PaymentHistoryPanelProps) {
  return (
    <section
      aria-label="Historial de recargas"
      className="alabaster-card rounded-3xl overflow-hidden"
    >
      <div
        className="px-5 py-4 flex items-center justify-between gap-4"
        style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.06)' }}
      >
        <div>
          <h2 className="text-sm font-bold tracking-tight text-[#0F172A]">
            Historial de recargas
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Bloques acreditados en COP</p>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap shrink-0">
          {payments.length} {payments.length === 1 ? 'registro' : 'registros'}
        </span>
      </div>

      {payments.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <Receipt className="w-6 h-6 text-slate-400 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-[#0F172A]">Sin recargas registradas</p>
          <p className="text-xs text-slate-500 mt-1">
            Tus compras de horas aparecerán aquí con su referencia y ahorro aplicado.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-900/5">
          {payments.slice(0, 6).map((payment) => {
            const isApproved = payment.status === 'APPROVED';

            return (
              <li
                key={payment.reference}
                className="px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-white/60 transition-opacity duration-150 ease-clima"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {isApproved ? (
                    <CheckCircle2
                      className="w-4 h-4 text-[#0EA5E9] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="w-4 h-4 text-rose-500 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  )}

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-semibold text-[#0F172A] tabular-nums">
                        +{payment.hours} {payment.hours === 1 ? 'hora' : 'horas'}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span
                        className={
                          isApproved ? 'text-[#0EA5E9] font-medium' : 'text-rose-600 font-medium'
                        }
                      >
                        {isApproved ? 'Aprobado' : payment.status}
                      </span>
                      {payment.discountPercent > 0 && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-amber-600 font-mono font-semibold">
                            -{payment.discountPercent}%
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                      {payment.reference}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-mono text-xs font-bold text-[#0F172A] tabular-nums">
                    {formatCop(payment.totalCop)}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                    {formatDateTime(payment.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
