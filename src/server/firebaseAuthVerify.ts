import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

let cachedProjectId: string | null = null;
let cachedCerts: Record<string, string> | null = null;
let certsExpiresAtMs = 0;

function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;

  if (process.env.FIREBASE_PROJECT_ID) {
    cachedProjectId = process.env.FIREBASE_PROJECT_ID.trim();
    return cachedProjectId;
  }

  const configPath = path.resolve(__dirname, '../../firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { projectId?: string };
  if (!parsed.projectId) {
    throw new Error('No se encontró projectId en firebase-applet-config.json');
  }
  cachedProjectId = parsed.projectId;
  return cachedProjectId;
}

function base64UrlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && cachedCerts && Date.now() < certsExpiresAtMs) {
    return cachedCerts;
  }

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error(`Error al obtener certificados públicos de Firebase (HTTP ${response.status}).`);
  }

  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  cachedCerts = (await response.json()) as Record<string, string>;
  certsExpiresAtMs = Date.now() + Math.max(maxAgeSec * 1000 - 30_000, 60_000);
  return cachedCerts;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Token de sesión inválido.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: JwtHeader;
  let payload: JwtPayload;

  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf8')) as JwtHeader;
    payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8')) as JwtPayload;
  } catch {
    throw new Error('No se pudo decodificar el token de autenticación.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algoritmo o identificador de clave no válido en el token.');
  }

  const projectId = getFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error('El token no corresponde a este proyecto Firebase.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Emisor del token Firebase inválido.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Usuario (sub) inválido en el token.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('La sesión ha expirado. Inicia sesión nuevamente.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Marca de tiempo iat inválida en el token.');
  }

  let certs = await getGooglePublicCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await getGooglePublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new Error('No se encontró la clave pública para verificar el token.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureBuf = base64UrlToBuffer(signatureB64);
  const validSignature = verifier.verify(cert, signatureBuf);
  if (!validSignature) {
    throw new Error('Firma criptográfica del token Firebase inválida.');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name : '',
  };
}
