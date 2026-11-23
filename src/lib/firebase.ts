import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { ActivityLogEntry, PaymentRecordItem } from '../types/device';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

interface EnsureProfileResult {
  ready: boolean;
  justCreated: boolean;
  hasLegacyDemoBalance: boolean;
}

const ensuredProfilePromises = new Map<string, Promise<EnsureProfileResult>>();

async function ensureUserProfileExists(uid: string): Promise<EnsureProfileResult> {
  if (!auth.currentUser || !auth.currentUser.emailVerified || auth.currentUser.uid !== uid) {
    return { ready: false, justCreated: false, hasLegacyDemoBalance: false };
  }

  const existingPromise = ensuredProfilePromises.get(uid);
  if (existingPromise) {
    const res = await existingPromise;
    return { ...res, justCreated: false };
  }

  const promise = (async (): Promise<EnsureProfileResult> => {
    const userPath = `users/${uid}`;
    const ref = doc(db, 'users', uid);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      ensuredProfilePromises.delete(uid);
      handleFirestoreError(error, OperationType.GET, userPath);
    }

    if (!snap.exists()) {
      try {
        const safeEmail = (auth.currentUser?.email || 'user@example.com').slice(0, 254);
        const safeName = (auth.currentUser?.displayName || '').slice(0, 120);
        await setDoc(ref, {
          uid,
          email: safeEmail,
          displayName: safeName,
          remainingSeconds: 0,
          activeUntilMs: 0,
          autoOffAtMs: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return { ready: true, justCreated: true, hasLegacyDemoBalance: false };
      } catch (error) {
        ensuredProfilePromises.delete(uid);
        handleFirestoreError(error, OperationType.CREATE, userPath);
      }
    }

    const existingData = snap.data() as Record<string, unknown> | undefined;
    return {
      ready: true,
      justCreated: false,
      hasLegacyDemoBalance: Boolean(existingData && 'demoBalanceCop' in existingData),
    };
  })();

  ensuredProfilePromises.set(uid, promise);
  return promise;
}

export async function syncUserProfileToFirestore(params: {
  uid: string;
  email: string;
  displayName: string;
  remainingSeconds: number;
  activeUntilMs: number;
  autoOffAtMs?: number;
}): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified || auth.currentUser.uid !== params.uid) {
    return;
  }

  const userPath = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);

  const ensured = await ensureUserProfileExists(params.uid);
  if (!ensured.ready) return;

  const safeName = (params.displayName || auth.currentUser.displayName || '').slice(0, 120);
  const safeRemaining = Math.max(0, Math.min(31536000, Math.floor(params.remainingSeconds)));
  const safeActiveUntil = Math.max(0, Math.floor(params.activeUntilMs));
  const safeAutoOffAt = Math.max(0, Math.floor(params.autoOffAtMs || 0));

  // Avoid redundant update right after fresh creation when balance is already 0
  if (
    ensured.justCreated &&
    safeRemaining === 0 &&
    safeActiveUntil === 0 &&
    safeAutoOffAt === 0 &&
    !ensured.hasLegacyDemoBalance
  ) {
    return;
  }

  try {
    const updatePayload: Record<string, unknown> = {
      displayName: safeName,
      remainingSeconds: safeRemaining,
      activeUntilMs: safeActiveUntil,
      autoOffAtMs: safeAutoOffAt,
      updatedAt: serverTimestamp(),
    };
    if (ensured.hasLegacyDemoBalance) {
      updatePayload.demoBalanceCop = deleteField();
    }

    await updateDoc(ref, updatePayload);
    if (ensured.hasLegacyDemoBalance) {
      ensuredProfilePromises.set(
        params.uid,
        Promise.resolve({ ready: true, justCreated: false, hasLegacyDemoBalance: false })
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function syncPaymentToFirestore(
  uid: string,
  payment: PaymentRecordItem
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified || auth.currentUser.uid !== uid) {
    return;
  }

  const ensured = await ensureUserProfileExists(uid);
  if (!ensured.ready) return;

  const paymentId = sanitizeId(payment.reference);
  const path = `users/${uid}/payments/${paymentId}`;
  const ref = doc(db, 'users', uid, 'payments', paymentId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: paymentId,
        userId: uid,
        reference: paymentId,
        transactionId: (payment.transactionId || paymentId).slice(0, 128),
        hours: payment.hours,
        addedSeconds: payment.addedSeconds,
        subtotalCop: payment.subtotalCop,
        discountPercent: payment.discountPercent,
        discountCop: payment.discountCop,
        totalCop: payment.totalCop,
        amountInCents: payment.amountInCents,
        currency: 'COP',
        status: payment.status,
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function recordCommandToFirestore(
  uid: string,
  entry: ActivityLogEntry
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified || auth.currentUser.uid !== uid) {
    return;
  }

  const ensured = await ensureUserProfileExists(uid);
  if (!ensured.ready) return;

  const commandId = sanitizeId(entry.id);
  const path = `users/${uid}/commands/${commandId}`;
  const ref = doc(db, 'users', uid, 'commands', commandId);

  const firestoreAction =
    entry.action === 'PRENDER' ||
    entry.action === 'APAGAR' ||
    entry.action === 'ESTADO' ||
    entry.action === 'PAGO'
      ? entry.action
      : 'ESTADO';

  try {
    await setDoc(ref, {
      id: commandId,
      userId: uid,
      action: firestoreAction,
      ok: Boolean(entry.ok),
      summary: (entry.summary || 'Acción registrada').slice(0, 300),
      tuyaCode: entry.tuyaCode !== undefined ? String(entry.tuyaCode).slice(0, 64) : '',
      tuyaTid: entry.tuyaTid ? String(entry.tuyaTid).slice(0, 128) : '',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
