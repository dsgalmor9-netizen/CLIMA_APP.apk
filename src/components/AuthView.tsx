import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { TurnstileWidget } from './TurnstileWidget';
import { CLIMA_EASE, SpotlightCard } from './SpotlightCard';
import { ClimaPayLogo } from './ClimaPayLogo';
import { apiUrl } from '../lib/apiClient';

interface AuthViewProps {
  turnstileSiteKey: string | null;
}

function mapFirebaseAuthError(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.';
    case 'auth/email-already-in-use':
      return 'Este correo ya está registrado. Inicia sesión o continúa con Google.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Ingresa una dirección de correo electrónico válida.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos antes de reintentar.';
    case 'auth/popup-closed-by-user':
      return 'Cerraste la ventana de Google antes de completar el acceso.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para continuar.';
    case 'auth/operation-not-allowed':
      return 'El acceso con correo aún no está habilitado. Continúa con Google.';
    default:
      return 'No se pudo completar la autenticación. Inténtalo nuevamente.';
  }
}

export function AuthView({ turnstileSiteKey }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

  const [submitting, setSubmitting] = useState<'email' | 'google' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  const verifyTurnstileOnBackend = async (): Promise<boolean> => {
    if (!turnstileToken) {
      setErrorMessage('Completa la verificación "Verifica que no eres un robot" para continuar.');
      return false;
    }

    const res = await fetch(apiUrl('/api/auth/verify-turnstile'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: turnstileToken }),
    });

    const data = (await res.json()) as { success?: boolean; errorMessage?: string };
    if (!res.ok || !data.success) {
      setErrorMessage(
        data.errorMessage || 'La verificación de seguridad falló. Inténtalo nuevamente.'
      );
      setTurnstileResetSignal((n) => n + 1);
      return false;
    }

    return true;
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMessage('Ingresa un correo electrónico válido.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (mode === 'register') {
      if (displayName.trim().length < 2) {
        setErrorMessage('Ingresa tu nombre completo (mínimo 2 caracteres).');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Las contraseñas no coinciden.');
        return;
      }
    }

    setSubmitting('email');
    try {
      const passedTurnstile = await verifyTurnstileOnBackend();
      if (!passedTurnstile) return;

      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, trimmedEmail, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        if (displayName.trim()) {
          await updateProfile(credential.user, {
            displayName: displayName.trim().slice(0, 120),
          });
        }
        try {
          await sendEmailVerification(credential.user);
          setInfoMessage('Cuenta creada correctamente. Revisa tu correo para verificarla.');
        } catch {
          // Non-blocking
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setErrorMessage(mapFirebaseAuthError(code));
      setTurnstileResetSignal((n) => n + 1);
    } finally {
      setSubmitting(null);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setSubmitting('google');

    try {
      const passedTurnstile = await verifyTurnstileOnBackend();
      if (!passedTurnstile) return;

      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setErrorMessage(mapFirebaseAuthError(code));
      setTurnstileResetSignal((n) => n + 1);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="relative min-h-screen bg-clima-mesh text-[#0F172A] flex items-center justify-center px-4 py-10 overflow-hidden">
      <main className="relative z-10 w-full max-w-[420px]">
        <SpotlightCard className="p-7 sm:p-9" staggerIndex={0} ariaLabel="Acceso a ClimaPay">
          {/* Official ClimaPay Logo Mark */}
          <div className="flex flex-col items-center text-center mb-7">
            <ClimaPayLogo variant="card" size="lg" className="mb-3.5" />
            <h1 className="sr-only">ClimaPay</h1>
            <p className="text-sm font-medium text-slate-500">
              Control inteligente de aire acondicionado
            </p>
          </div>

          {/* Smooth Sliding Segmented Tabs */}
          <div
            role="tablist"
            aria-label="Modo de acceso"
            className="alabaster-inset relative grid grid-cols-2 p-1 rounded-2xl mb-6"
          >
            <motion.div
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl bg-white"
              style={{
                boxShadow:
                  '0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04)',
              }}
              animate={{ x: mode === 'login' ? '0%' : '100%' }}
              transition={{ duration: 0.28, ease: CLIMA_EASE }}
            />
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`relative z-10 min-h-[40px] py-2 px-3 text-[13px] font-semibold rounded-xl transition-opacity duration-200 ease-clima active:scale-[0.98] whitespace-nowrap cursor-pointer ${
                mode === 'login' ? 'text-[#0F172A]' : 'text-slate-500 hover:text-[#0F172A]'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`relative z-10 min-h-[40px] py-2 px-3 text-[13px] font-semibold rounded-xl transition-opacity duration-200 ease-clima active:scale-[0.98] whitespace-nowrap cursor-pointer ${
                mode === 'register' ? 'text-[#0F172A]' : 'text-slate-500 hover:text-[#0F172A]'
              }`}
            >
              Registrarse
            </button>
          </div>

          {/* Continue with Google */}
          <button
            type="button"
            disabled={submitting !== null}
            onClick={handleGoogleLogin}
            className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl text-sm font-semibold bg-white hover:bg-slate-50/90 text-[#0F172A] transition-transform duration-150 ease-clima active:scale-[0.98] flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            style={{
              border: '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: '0 2px 8px -2px rgba(15, 23, 42, 0.06)',
            }}
          >
            {submitting === 'google' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#0EA5E9]" aria-hidden="true" />
                <span>Conectando con Google...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.29V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.01-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"
                  />
                </svg>
                <span>Continuar con Google</span>
              </>
            )}
          </button>

          {/* Subtle Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div
                className="w-full"
                style={{ borderTop: '1px solid rgba(15, 23, 42, 0.07)' }}
              />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white/90 px-3 text-slate-400">o con tu correo</span>
            </div>
          </div>

          {errorMessage && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: CLIMA_EASE }}
              className="mb-4 rounded-2xl bg-rose-50/90 px-3.5 py-3 flex items-start gap-2.5 text-xs text-rose-700"
              style={{ border: '1px solid rgba(225, 29, 72, 0.14)' }}
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </motion.div>
          )}

          {infoMessage && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: CLIMA_EASE }}
              className="mb-4 rounded-2xl bg-sky-50/90 px-3.5 py-3 flex items-start gap-2.5 text-xs text-sky-900"
              style={{ border: '1px solid rgba(14, 165, 233, 0.18)' }}
            >
              <ShieldCheck className="w-4 h-4 text-[#0EA5E9] shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </motion.div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-semibold text-slate-600 mb-1.5"
                >
                  Nombre completo
                </label>
                <div className="relative">
                  <User
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Tu nombre"
                    className="w-full pl-10 pr-3.5 py-2.5 min-h-[46px] rounded-2xl text-sm bg-white/95 text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/35"
                    style={{ border: '1px solid rgba(15, 23, 42, 0.09)' }}
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-slate-600 mb-1.5"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@correo.com"
                  className="w-full pl-10 pr-3.5 py-2.5 min-h-[46px] rounded-2xl text-sm bg-white/95 text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/35"
                  style={{ border: '1px solid rgba(15, 23, 42, 0.09)' }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-semibold text-slate-600 mb-1.5"
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full pl-10 pr-12 py-2.5 min-h-[46px] rounded-2xl text-sm bg-white/95 text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/35"
                  style={{ border: '1px solid rgba(15, 23, 42, 0.09)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-[#0F172A] active:scale-95 transition-transform duration-150 ease-clima cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-semibold text-slate-600 mb-1.5"
                >
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="w-full pl-10 pr-3.5 py-2.5 min-h-[46px] rounded-2xl text-sm bg-white/95 text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/35"
                    style={{ border: '1px solid rgba(15, 23, 42, 0.09)' }}
                  />
                </div>
              </div>
            )}

            <TurnstileWidget
              siteKey={turnstileSiteKey}
              resetSignal={turnstileResetSignal}
              onTokenChange={handleTokenChange}
            />

            <button
              type="submit"
              disabled={submitting !== null}
              className="btn-cyan-luminous w-full min-h-[50px] px-5 py-3 rounded-2xl text-sm font-semibold text-white transition-transform duration-150 ease-clima active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] focus-visible:ring-offset-2"
            >
              {submitting === 'email' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>{mode === 'login' ? 'Entrando...' : 'Creando cuenta...'}</span>
                </>
              ) : (
                <span>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</span>
              )}
            </button>
          </form>
        </SpotlightCard>
      </main>
    </div>
  );
}
