import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiUrl } from '../lib/apiClient';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          language?: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey: string | null;
  resetSignal: number;
  onTokenChange: (token: string | null) => void;
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

function ensureTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('No se pudo cargar Cloudflare Turnstile.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('No se pudo cargar el script de Cloudflare Turnstile.'));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  siteKey,
  resetSignal,
  onTokenChange,
}: TurnstileWidgetProps) {
  const checkboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [cfError, setCfError] = useState<string | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<'idle' | 'verifying' | 'verified'>('idle');
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  useEffect(() => {
    if (resetSignal === 0) return;
    onTokenChange(null);
    if (siteKey && widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // Ignore reset failure if unmounted
      }
    } else {
      setFallbackStatus('idle');
      setFallbackError(null);
    }
  }, [resetSignal, siteKey, onTokenChange]);

  useEffect(() => {
    if (!siteKey) return;
    let active = true;
    setCfError(null);

    ensureTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // Ignore
          }
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          language: 'es',
          callback: (token: string) => {
            if (active) onTokenChange(token);
          },
          'expired-callback': () => {
            if (active) onTokenChange(null);
          },
          'error-callback': () => {
            if (active) {
              onTokenChange(null);
              setCfError('No se pudo completar la verificación Turnstile. Reintenta.');
            }
          },
        });
      })
      .catch((err) => {
        if (active) {
          setCfError(err instanceof Error ? err.message : 'Error al cargar Turnstile.');
        }
      });

    return () => {
      active = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onTokenChange]);

  const handleFallbackToggle = useCallback(async () => {
    if (fallbackStatus === 'verifying') return;
    if (fallbackStatus === 'verified') {
      setFallbackStatus('idle');
      onTokenChange(null);
      return;
    }

    setFallbackStatus('verifying');
    setFallbackError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/turnstile-challenge'), { cache: 'no-store' });
      const data = (await res.json()) as { success?: boolean; challengeToken?: string };
      if (!res.ok || !data.challengeToken) {
        throw new Error('No se pudo generar el reto de verificación.');
      }

      await new Promise((r) => setTimeout(r, 240));
      setFallbackStatus('verified');
      onTokenChange(data.challengeToken);
    } catch (err) {
      setFallbackStatus('idle');
      onTokenChange(null);
      setFallbackError(
        err instanceof Error ? err.message : 'Error de red al verificar seguridad.'
      );
    }
  }, [fallbackStatus, onTokenChange]);

  if (siteKey) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Verifica que no eres un robot</span>
          <span className="font-mono text-[11px] text-slate-400">Turnstile</span>
        </div>
        <div
          ref={containerRef}
          className="alabaster-inset min-h-[65px] flex items-center justify-center rounded-2xl p-2"
        />
        {cfError && <p className="text-xs text-rose-600">{cfError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="alabaster-inset rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
        <label
          htmlFor={checkboxId}
          className="flex items-center gap-3 cursor-pointer select-none min-w-0"
        >
          <button
            id={checkboxId}
            type="button"
            role="checkbox"
            aria-checked={fallbackStatus === 'verified'}
            onClick={handleFallbackToggle}
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ease-clima-spring active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] ${
              fallbackStatus === 'verified'
                ? 'bg-[#0EA5E9] text-white shadow-sm shadow-sky-500/30'
                : 'bg-white border border-slate-900/12 hover:border-[#0EA5E9]/60'
            }`}
          >
            {fallbackStatus === 'verifying' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0EA5E9]" />
            ) : fallbackStatus === 'verified' ? (
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            ) : null}
          </button>

          <div className="min-w-0">
            <span className="block text-[13px] font-medium text-[#0F172A]">
              {fallbackStatus === 'verifying'
                ? 'Verificando seguridad...'
                : fallbackStatus === 'verified'
                  ? 'Verificación completada'
                  : 'Verifica que no eres un robot'}
            </span>
            <span className="block text-[11px] text-slate-500">
              Protección Turnstile verificada
            </span>
          </div>
        </label>

        <div className="flex items-center shrink-0 text-slate-400">
          {fallbackStatus === 'verified' ? (
            <button
              type="button"
              onClick={handleFallbackToggle}
              title="Reiniciar verificación"
              aria-label="Reiniciar verificación"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#0F172A] hover:bg-white/70 transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <ShieldCheck className="w-5 h-5 text-slate-400" aria-hidden="true" />
          )}
        </div>
      </div>

      {fallbackError && <p className="text-xs text-rose-600">{fallbackError}</p>}
    </div>
  );
}
