/**
 * Resolves API endpoints for both Web (relative /api/*) and Capacitor Android APK
 * (pointing to the deployed Vercel Free backend via NEXT_PUBLIC_API_URL).
 */

function sanitizeApiBaseUrl(raw: string | undefined): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const isHttps = parsed.protocol === 'https:';
    const isLocalDev =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (!isHttps && !isLocalDev) {
      return '';
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

const CONFIGURED_API_BASE_URL = sanitizeApiBaseUrl(
  (import.meta.env.NEXT_PUBLIC_API_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined)
);

export function getApiBaseUrl(): string {
  return CONFIGURED_API_BASE_URL;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!CONFIGURED_API_BASE_URL) {
    return normalizedPath;
  }
  return `${CONFIGURED_API_BASE_URL}${normalizedPath}`;
}
