import crypto from 'node:crypto';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FALLBACK_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const FALLBACK_SIGNING_SECRET =
  process.env.TURNSTILE_SECRET_KEY ||
  'sy1_turnstile_fallback_secret_v1';

export interface TurnstilePublicConfig {
  siteKey: string | null;
  mode: 'cloudflare' | 'fallback';
}

export function getTurnstileConfig(): TurnstilePublicConfig {
  const siteKey = (
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    process.env.VITE_TURNSTILE_SITE_KEY ||
    ''
  ).trim();

  if (siteKey) {
    return { siteKey, mode: 'cloudflare' };
  }
  return { siteKey: null, mode: 'fallback' };
}

export function createFallbackTurnstileChallenge(): {
  challengeToken: string;
  expiresAt: number;
} {
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const payload = `fallback.${nonce}.${issuedAt}`;
  const sig = crypto
    .createHmac('sha256', FALLBACK_SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  return {
    challengeToken: `${payload}.${sig}`,
    expiresAt: issuedAt + FALLBACK_CHALLENGE_TTL_MS,
  };
}

function verifyFallbackToken(token: string): { ok: boolean; reason?: string } {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'fallback') {
    return { ok: false, reason: 'Token de verificación anti-bot inválido.' };
  }

  const [prefix, nonce, issuedAtRaw, providedSig] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!nonce || !Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'Formato de verificación anti-bot corrupto.' };
  }

  if (Date.now() - issuedAt > FALLBACK_CHALLENGE_TTL_MS) {
    return { ok: false, reason: 'La verificación anti-bot expiró. Vuelve a marcar la casilla.' };
  }

  const payload = `${prefix}.${nonce}.${issuedAtRaw}`;
  const expectedSig = crypto
    .createHmac('sha256', FALLBACK_SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Firma de verificación anti-bot inválida.' };
  }

  return { ok: true };
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<{ ok: boolean; mode: 'cloudflare' | 'fallback'; errorMessage?: string }> {
  const trimmed = (token || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      mode: getTurnstileConfig().mode,
      errorMessage: 'Completa la verificación "No soy un robot" antes de continuar.',
    };
  }

  const { mode } = getTurnstileConfig();
  const secretKey = (process.env.TURNSTILE_SECRET_KEY || '').trim();

  if (mode === 'cloudflare' && secretKey) {
    try {
      const formBody = new URLSearchParams();
      formBody.set('secret', secretKey);
      formBody.set('response', trimmed);
      if (remoteIp) {
        formBody.set('remoteip', remoteIp);
      }

      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      const data = (await response.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };

      if (!data.success) {
        const codes = data['error-codes']?.join(', ') || 'verification-failed';
        return {
          ok: false,
          mode: 'cloudflare',
          errorMessage: `Cloudflare Turnstile rechazó la verificación (${codes}). Inténtalo de nuevo.`,
        };
      }

      return { ok: true, mode: 'cloudflare' };
    } catch {
      return {
        ok: false,
        mode: 'cloudflare',
        errorMessage: 'No se pudo validar Cloudflare Turnstile en el servidor.',
      };
    }
  }

  // Fallback / test mode verification when Cloudflare keys are not yet configured
  const fallbackResult = verifyFallbackToken(trimmed);
  if (!fallbackResult.ok) {
    return {
      ok: false,
      mode: 'fallback',
      errorMessage: fallbackResult.reason || 'Verificación anti-bot fallida.',
    };
  }

  return { ok: true, mode: 'fallback' };
}
