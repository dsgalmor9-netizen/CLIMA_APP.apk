/**
 * Lightweight runtime bridge for Capacitor Android APK deep-linking and Wompi Checkout return handling.
 * Works seamlessly on both Web browsers and Capacitor Android WebViews without requiring native build plugins at bundle time.
 */

interface CapacitorPluginHandle {
  remove: () => Promise<void> | void;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    App?: {
      addListener?: (
        eventName: 'appUrlOpen',
        listener: (event: { url?: string }) => void
      ) => Promise<CapacitorPluginHandle> | CapacitorPluginHandle;
    };
    Browser?: {
      open?: (options: { url: string; presentationStyle?: 'fullscreen' | 'popover' }) => Promise<void>;
      close?: () => Promise<void>;
    };
  };
}

const DEFAULT_DEEP_LINK_RETURN_URL = 'climapay://payment-return';
const SAFE_TX_ID_PATTERN = /^[a-zA-Z0-9_-]{4,128}$/;

function getCapacitorGlobal(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap && typeof cap === 'object' ? cap : null;
}

export function isCapacitorNativeApp(): boolean {
  const cap = getCapacitorGlobal();
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform());
  }
  const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
  return platform === 'android' || platform === 'ios';
}

/**
 * Returns the Wompi redirect-url:
 * - On Capacitor Android APK: `climapay://payment-return` (or validated NEXT_PUBLIC_CAPACITOR_DEEP_LINK)
 * - On Web: current `window.location.origin`
 */
export function getWompiReturnUrl(): string {
  if (isCapacitorNativeApp()) {
    const configured = (
      (import.meta.env.NEXT_PUBLIC_CAPACITOR_DEEP_LINK as string | undefined) ||
      DEFAULT_DEEP_LINK_RETURN_URL
    ).trim();
    if (/^climapay:\/\/[a-zA-Z0-9/_-]+$/i.test(configured)) {
      return configured;
    }
    return DEFAULT_DEEP_LINK_RETURN_URL;
  }

  if (typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)) {
    return window.location.origin;
  }
  return '';
}

/**
 * Extracts and validates a Wompi transaction id (`?id=...` or `?transaction_id=...`)
 * from a Deep Link (`climapay://payment-return?id=...`) or standard Web return URL.
 */
export function extractWompiTransactionIdFromUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'climapay:'
    ) {
      return null;
    }
    const candidate =
      parsed.searchParams.get('id') ||
      parsed.searchParams.get('transaction_id') ||
      '';
    const trimmed = candidate.trim();
    return SAFE_TX_ID_PATTERN.test(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Opens Wompi Checkout securely:
 * - Validates the checkout URL strictly targets `https://checkout.wompi.co/`
 * - Uses Capacitor Browser plugin in Android APK so returning via Deep Link closes the browser tab cleanly
 * - Falls back to standard navigation on Web
 */
export async function openWompiCheckoutUrl(checkoutUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(checkoutUrl);
  } catch {
    throw new Error('URL de pago Wompi inválida.');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.wompi.co') {
    throw new Error('Dominio de pasarela de pago no permitido.');
  }

  const cap = getCapacitorGlobal();
  if (isCapacitorNativeApp() && cap?.Plugins?.Browser?.open) {
    await cap.Plugins.Browser.open({ url: parsed.toString() });
    return;
  }

  window.location.assign(parsed.toString());
}

/**
 * Subscribes to Capacitor Android Deep Link events (`climapay://payment-return?id=...`)
 * and closes the in-app Browser when the user returns from Wompi.
 */
export function subscribeToCapacitorPaymentDeepLink(
  onTransactionId: (transactionId: string) => void
): () => void {
  const cap = getCapacitorGlobal();
  const appPlugin = cap?.Plugins?.App;
  if (!appPlugin?.addListener) {
    return () => {};
  }

  let handle: CapacitorPluginHandle | null = null;
  let disposed = false;

  const maybePromise = appPlugin.addListener('appUrlOpen', (event) => {
    if (disposed || !event?.url) return;
    const txId = extractWompiTransactionIdFromUrl(event.url);
    if (txId) {
      if (cap?.Plugins?.Browser?.close) {
        void Promise.resolve(cap.Plugins.Browser.close()).catch(() => {});
      }
      onTransactionId(txId);
    }
  });

  void Promise.resolve(maybePromise)
    .then((resolved) => {
      if (disposed) {
        void resolved?.remove?.();
      } else {
        handle = resolved;
      }
    })
    .catch(() => {});

  return () => {
    disposed = true;
    if (handle?.remove) {
      void handle.remove();
    }
  };
}
