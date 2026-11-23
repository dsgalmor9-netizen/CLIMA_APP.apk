import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Loader2,
  PauseCircle,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { CLIMA_PLANS, DEFAULT_PLAN_ID, formatCop } from '../../config/plans';
import { apiUrl } from '../../lib/apiClient';
import {
  getWompiReturnUrl,
  isCapacitorNativeApp,
  openWompiCheckoutUrl,
} from '../../lib/capacitorBridge';
import { openWompiCheckoutWidget } from '../../lib/wompiWidget';
import { CLIMA_EASE } from '../SpotlightCard';
import { ClimaPayLogo } from '../ClimaPayLogo';
import { PlanCard } from './PlanCard';
import type {
  ClimaPlanId,
  WompiCheckoutSessionResponse,
  WompiPurchaseResponse,
} from '../../types';

export interface PlanPaywallProps {
  deviceId?: string;
  getAuthToken: () => Promise<string>;
  onPaymentCompleted: (result: WompiPurchaseResponse) => void;
  onClose?: () => void;
  isModal?: boolean;
  hideTopBar?: boolean;
  hasBottomNav?: boolean;
}

const PAYWALL_BENEFITS = [
  {
    icon: Clock,
    title: 'Tiempo bajo demanda',
    description: 'El contador solo corre cuando enciendes el aire.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Control total',
    description: 'Ajusta temperatura, modo y ventilación desde tu celular.',
  },
  {
    icon: PauseCircle,
    title: 'Sin cortes sorpresa',
    description: 'Pausa y reanuda tu saldo cuando quieras.',
  },
] as const;

export function PlanPaywall({
  deviceId,
  getAuthToken,
  onPaymentCompleted,
  onClose,
  isModal = false,
  hideTopBar = false,
  hasBottomNav = false,
}: PlanPaywallProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<ClimaPlanId>(DEFAULT_PLAN_ID);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'error' | 'info';
    text: string;
  } | null>(null);

  const selectedPlan = useMemo(
    () =>
      CLIMA_PLANS.find((plan) => plan.id === selectedPlanId) ??
      CLIMA_PLANS.find((plan) => plan.id === DEFAULT_PLAN_ID) ??
      CLIMA_PLANS[2],
    [selectedPlanId]
  );

  const handleConfirmPurchase = async () => {
    setIsPurchasing(true);
    setStatusMessage(null);

    try {
      const token = await getAuthToken();
      const returnUrl = getWompiReturnUrl();

      const wompiRes = await fetch(apiUrl('/api/payments/wompi/checkout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId: deviceId || undefined,
          planId: selectedPlan.id,
          hours: selectedPlan.hours,
          returnUrl: returnUrl || undefined,
        }),
      });

      const wompiData = (await wompiRes.json()) as WompiCheckoutSessionResponse;
      if (
        !wompiRes.ok ||
        !wompiData.success ||
        !wompiData.publicKey ||
        !wompiData.reference ||
        !wompiData.amountInCents ||
        !wompiData.integritySignature
      ) {
        throw new Error(
          wompiData.errorMessage ||
            'No se pudo iniciar la pasarela de pagos Wompi. Intenta nuevamente.'
        );
      }

      if (!isCapacitorNativeApp()) {
        try {
          const widgetResult = await openWompiCheckoutWidget({
            publicKey: wompiData.publicKey,
            reference: wompiData.reference,
            amountInCents: wompiData.amountInCents,
            currency: 'COP',
            integritySignature: wompiData.integritySignature,
            redirectUrl: wompiData.redirectUrl,
          });

          const txId = widgetResult?.transaction?.id;
          if (!txId) {
            setStatusMessage({
              type: 'info',
              text: 'Pago en Wompi cancelado o pendiente de confirmación.',
            });
            return;
          }

          const verifyRes = await fetch(apiUrl('/api/payments/wompi/verify'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              transactionId: txId,
              deviceId: deviceId || undefined,
            }),
          });
          const verifyData = (await verifyRes.json()) as WompiPurchaseResponse;
          if (verifyRes.ok && verifyData.success) {
            onPaymentCompleted(verifyData);
            return;
          }

          setStatusMessage({
            type: 'error',
            text:
              verifyData.errorMessage ||
              'La transacción aún no fue aprobada por Wompi. Verifica tu medio de pago.',
          });
          return;
        } catch {
          if (wompiData.checkoutUrl) {
            await openWompiCheckoutUrl(wompiData.checkoutUrl);
            return;
          }
          throw new Error('No se pudo abrir el widget oficial de Wompi.');
        }
      }

      if (wompiData.checkoutUrl) {
        await openWompiCheckoutUrl(wompiData.checkoutUrl);
        return;
      }

      throw new Error('No se recibió una URL de pago válida de Wompi.');
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error de red al procesar el pago con Wompi.',
      });
    } finally {
      setIsPurchasing(false);
    }
  };

  const planSelectorBlock = (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <h2 className="text-[15px] font-bold tracking-tight text-[#0F172A]">Elige tu plan</h2>
        <span className="text-[11px] font-medium text-slate-400">Pagos reales en COP · Wompi</span>
      </div>

      <div role="radiogroup" aria-label="Planes de tiempo ClimaPay" className="space-y-3">
        {CLIMA_PLANS.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            index={index}
            isSelected={plan.id === selectedPlan.id}
            onSelect={(picked) => {
              setSelectedPlanId(picked.id);
              setStatusMessage(null);
            }}
          />
        ))}
      </div>

      {statusMessage && (
        <motion.div
          role={statusMessage.type === 'error' ? 'alert' : 'status'}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: CLIMA_EASE }}
          className={`rounded-2xl px-4 py-3 text-xs flex items-start gap-2.5 ${
            statusMessage.type === 'error'
              ? 'bg-rose-50/95 text-rose-800'
              : 'bg-sky-50/95 text-sky-900'
          }`}
          style={{
            border:
              statusMessage.type === 'error'
                ? '1px solid rgba(225, 29, 72, 0.16)'
                : '1px solid rgba(14, 165, 233, 0.18)',
          }}
        >
          {statusMessage.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          ) : (
            <Check className="w-4 h-4 shrink-0 mt-0.5 text-[#0EA5E9]" />
          )}
          <span>{statusMessage.text}</span>
        </motion.div>
      )}
    </div>
  );

  const ctaButton = (
    <button
      type="button"
      disabled={isPurchasing}
      onClick={handleConfirmPurchase}
      className="btn-cyan-luminous w-full min-h-[56px] px-4 sm:px-6 py-3.5 rounded-full text-[13.5px] sm:text-[15px] font-bold tracking-tight text-white transition-transform duration-150 ease-clima active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0EA5E9]/35"
    >
      {isPurchasing ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
          <span>Conectando con Wompi...</span>
        </>
      ) : (
        <>
          <span className="truncate tabular-nums">
            Pagar y Cargar Tiempo ({selectedPlan.name} · {formatCop(selectedPlan.totalCop)})
          </span>
          <ArrowRight className="w-4 h-4 shrink-0 stroke-[2.4]" aria-hidden="true" />
        </>
      )}
    </button>
  );

  if (isModal) {
    return (
      <div className="space-y-5">
        {planSelectorBlock}
        <div className="pt-2">{ctaButton}</div>
      </div>
    );
  }

  return (
    <section
      id="compra-tiempo"
      aria-label="Planes ClimaPay"
      className="relative w-full max-w-[460px] lg:max-w-4xl mx-auto pb-28 lg:pb-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 inset-x-0 h-[340px] -z-0"
        style={{
          background:
            'radial-gradient(600px circle at 50% -12%, rgba(14, 165, 233, 0.16), rgba(14, 165, 233, 0.04) 48%, transparent 74%)',
        }}
      />

      {!hideTopBar && (
        <div className="relative z-10 flex items-center justify-between gap-4 pt-1 pb-5">
          <ClimaPayLogo variant="horizontal" size="md" />

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar selector de planes"
              title="Volver a mi cuenta"
              className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-white/80 hover:bg-white text-slate-500 hover:text-[#0F172A] flex items-center justify-center transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
              style={{
                border: '1px solid rgba(15, 23, 42, 0.07)',
                boxShadow: '0 4px 12px -4px rgba(15, 23, 42, 0.08)',
              }}
            >
              <X className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-5 space-y-5">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: CLIMA_EASE }}
          >
            <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#0F172A] leading-[1.14] text-balance">
              Clima a tu medida.{' '}
              <span className="text-[#0EA5E9]">Paga solo lo que usas.</span>
            </h1>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.05, ease: CLIMA_EASE }}
            className="rounded-3xl bg-white/80 backdrop-blur-md p-5 space-y-4"
            style={{
              border: '1px solid rgba(15, 23, 42, 0.06)',
              boxShadow:
                '0 12px 30px -8px rgba(15, 23, 42, 0.07), 0 4px 10px -3px rgba(15, 23, 42, 0.03)',
            }}
          >
            {PAYWALL_BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div key={benefit.title} className="flex items-start gap-3.5">
                  <div
                    className="w-9 h-9 rounded-2xl bg-sky-50/95 text-[#0EA5E9] flex items-center justify-center shrink-0 mt-0.5"
                    style={{ border: '1px solid rgba(14, 165, 233, 0.14)' }}
                  >
                    <Icon className="w-[18px] h-[18px] stroke-[2.1]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[#0F172A] leading-snug">
                      {benefit.title}
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                      {benefit.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </div>

        <div className="lg:col-span-7 space-y-5">
          {planSelectorBlock}

          <div className="hidden lg:block pt-2 space-y-2.5">
            {ctaButton}
            <p className="text-center text-[11px] text-slate-400">
              Pago seguro en COP verificado por Wompi · El tiempo inicia solo al encender el aire
            </p>
          </div>
        </div>
      </div>

      <div
        className={`lg:hidden fixed inset-x-0 z-30 px-4 pt-4 pb-3.5 bg-gradient-to-t from-white via-white/95 to-transparent ${
          hasBottomNav || hideTopBar ? 'bottom-16' : 'bottom-0 pb-5'
        }`}
      >
        <div className="max-w-[460px] mx-auto">{ctaButton}</div>
      </div>
    </section>
  );
}
