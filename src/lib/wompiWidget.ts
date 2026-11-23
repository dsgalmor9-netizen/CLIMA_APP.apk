/**
 * Official Wompi Checkout Widget loader (https://checkout.wompi.co/widget.js).
 * Opens the Wompi payment modal in-page and resolves with the transaction object
 * so the backend can verify it idempotently via POST /api/payments/wompi/verify.
 */

const WOMPI_WIDGET_SCRIPT_ID = 'wompi-checkout-widget-script';
const WOMPI_WIDGET_SCRIPT_SRC = 'https://checkout.wompi.co/widget.js';

export interface WompiWidgetTransaction {
  id?: string;
  reference?: string;
  status?: string;
  amountInCents?: number;
  currency?: string;
}

export interface WompiWidgetOpenResult {
  transaction?: WompiWidgetTransaction;
}

interface WompiWidgetCheckoutConfig {
  currency: 'COP';
  amountInCents: number;
  reference: string;
  publicKey: string;
  signature?: {
    integrity: string;
  };
  redirectUrl?: string;
}

interface WompiWidgetCheckoutInstance {
  open: (callback: (result: WompiWidgetOpenResult) => void) => void;
}

declare global {
  interface Window {
    WidgetCheckout?: new (config: WompiWidgetCheckoutConfig) => WompiWidgetCheckoutInstance;
  }
}

export function ensureWompiWidgetScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Wompi Widget solo está disponible en el navegador.'));
  }
  if (typeof window.WidgetCheckout === 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(WOMPI_WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('No se pudo cargar el Widget de Wompi.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = WOMPI_WIDGET_SCRIPT_ID;
    script.src = WOMPI_WIDGET_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar el Widget de Wompi.'));
    document.head.appendChild(script);
  });
}

export async function openWompiCheckoutWidget(params: {
  publicKey: string;
  reference: string;
  amountInCents: number;
  currency: 'COP';
  integritySignature: string;
  redirectUrl?: string | null;
}): Promise<WompiWidgetOpenResult> {
  await ensureWompiWidgetScript();

  if (typeof window.WidgetCheckout !== 'function') {
    throw new Error('WidgetCheckout de Wompi no está disponible.');
  }

  return new Promise<WompiWidgetOpenResult>((resolve) => {
    const checkout = new window.WidgetCheckout!({
      currency: params.currency,
      amountInCents: params.amountInCents,
      reference: params.reference,
      publicKey: params.publicKey,
      signature: {
        integrity: params.integritySignature,
      },
      redirectUrl: params.redirectUrl || undefined,
    });

    checkout.open((result: WompiWidgetOpenResult) => {
      resolve(result || {});
    });
  });
}
