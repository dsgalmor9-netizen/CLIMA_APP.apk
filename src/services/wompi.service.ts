import crypto from 'node:crypto';
import { getCorsEnv, getWompiEnv, validateWompiReturnUrl } from '../config/env.ts';
import { resolvePlanOrHoursPricing } from '../config/plans.ts';
import { getStorageRepository } from '../repositories/storage.repository.ts';
import type {
  WompiCheckoutSessionResponse,
  WompiConfig,
  WompiPurchaseResponse,
  WompiTransactionLookup,
  WompiWebhookPayload,
} from '../types/wompi.ts';
import {
  confirmWompiOrderApproved,
  createPendingWompiOrder,
  getCompressorCooldownSnapshot,
  getUserAccountState,
} from './session.service.ts';

export type { WompiConfig, WompiTransactionLookup, WompiWebhookPayload };

export function getWompiConfig(): WompiConfig {
  return getWompiEnv();
}

/**
 * Generates official Wompi Checkout integrity signature:
 * SHA256(reference + amountInCents + currency + integritySecret)
 */
export function buildWompiIntegritySignature(params: {
  reference: string;
  amountInCents: number;
  currency: 'COP';
  integritySecret: string;
}): string {
  const raw = `${params.reference}${params.amountInCents}${params.currency}${params.integritySecret}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function resolveDotPath(obj: unknown, dotPath: string): string {
  if (!obj || typeof obj !== 'object') return '';
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }
  return current === null || current === undefined ? '' : String(current);
}

/**
 * Verifies official Wompi webhook event signature using timing-safe comparison.
 * Concatenates `signature.properties` values from `payload.data` + `timestamp` + `WOMPI_EVENTS_SECRET`.
 */
export function verifyWompiWebhookSignature(
  payload: WompiWebhookPayload,
  headerChecksum?: string
): { valid: boolean; reason?: string } {
  const config = getWompiConfig();
  if (!config.eventsSecret) {
    return { valid: false, reason: 'WOMPI_EVENTS_SECRET no configurado en el servidor.' };
  }

  const providedChecksum = (headerChecksum || payload.signature?.checksum || '').trim().toLowerCase();
  const properties = payload.signature?.properties;
  const timestamp = payload.timestamp;

  if (!providedChecksum || !Array.isArray(properties) || properties.length === 0 || !timestamp) {
    return { valid: false, reason: 'Encabezados o firma de evento Wompi incompletos.' };
  }

  const concatenatedProps = properties.map((prop) => resolveDotPath(payload.data, prop)).join('');
  const expected = crypto
    .createHash('sha256')
    .update(`${concatenatedProps}${timestamp}${config.eventsSecret}`, 'utf8')
    .digest('hex')
    .toLowerCase();

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(providedChecksum, 'utf8');

  if (expectedBuf.length !== providedBuf.length) {
    return { valid: false, reason: 'Firma criptográfica de webhook Wompi inválida.' };
  }

  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: 'Firma criptográfica de webhook Wompi inválida.' };
  }

  return { valid: true };
}

export async function fetchWompiTransaction(
  transactionId: string
): Promise<WompiTransactionLookup> {
  const config = getWompiConfig();
  const sanitizedId = transactionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedId) {
    return { ok: false, errorMessage: 'ID de transacción Wompi inválido.' };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.privateKey) {
    headers.Authorization = `Bearer ${config.privateKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.apiBaseUrl}/transactions/${encodeURIComponent(sanitizedId)}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, errorMessage: `Wompi respondió HTTP ${res.status}.` };
    }
    const json = (await res.json()) as {
      data?: {
        status?: string;
        reference?: string;
        amount_in_cents?: number;
      };
    };
    if (!json.data) {
      return { ok: false, errorMessage: 'Transacción no encontrada en Wompi.' };
    }
    return {
      ok: true,
      status: json.data.status,
      reference: json.data.reference,
      amountInCents: json.data.amount_in_cents,
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : 'Error consultando transacción en Wompi.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createWompiCheckoutSession(params: {
  uid: string;
  email: string;
  deviceId: string;
  planId?: unknown;
  hours?: unknown;
  returnUrl?: unknown;
}): { statusCode: number; body: WompiCheckoutSessionResponse } {
  const wompi = getWompiConfig();
  if (!wompi.isConfigured) {
    return {
      statusCode: 503,
      body: {
        success: false,
        wompiConfigured: false,
        deviceId: params.deviceId,
        errorCode: 'WOMPI_NOT_CONFIGURED',
        errorMessage:
          'La pasarela de pagos Wompi no está configurada en el servidor. Configura WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET.',
      },
    };
  }

  let pricing;
  try {
    pricing = resolvePlanOrHoursPricing({ planId: params.planId, hours: params.hours });
  } catch (err) {
    return {
      statusCode: 400,
      body: {
        success: false,
        wompiConfigured: true,
        deviceId: params.deviceId,
        errorCode: 'INVALID_PLAN',
        errorMessage:
          err instanceof Error ? err.message : 'Plan o cantidad de horas inválida.',
      },
    };
  }

  const { reference, deviceId } = createPendingWompiOrder({
    uid: params.uid,
    email: params.email,
    deviceId: params.deviceId,
    pricing,
  });

  const integritySignature = buildWompiIntegritySignature({
    reference,
    amountInCents: pricing.amountInCents,
    currency: 'COP',
    integritySecret: wompi.integritySecret,
  });

  const validatedClientReturn = validateWompiReturnUrl(params.returnUrl);
  const { appUrl } = getCorsEnv();
  const redirectUrl =
    validatedClientReturn || (appUrl && /^https?:\/\//i.test(appUrl) ? appUrl : null);

  const queryParams = new URLSearchParams({
    'public-key': wompi.publicKey,
    currency: 'COP',
    'amount-in-cents': String(pricing.amountInCents),
    reference,
    'signature:integrity': integritySignature,
  });
  if (redirectUrl) {
    queryParams.set('redirect-url', redirectUrl);
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      wompiConfigured: true,
      deviceId,
      reference,
      amountInCents: pricing.amountInCents,
      currency: 'COP',
      publicKey: wompi.publicKey,
      integritySignature,
      redirectUrl,
      checkoutUrl: `https://checkout.wompi.co/p/?${queryParams.toString()}`,
    },
  };
}

export async function processWompiWebhookEvent(params: {
  payload: WompiWebhookPayload;
  headerChecksum?: string;
}): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const sigCheck = verifyWompiWebhookSignature(params.payload, params.headerChecksum);
  if (!sigCheck.valid) {
    return {
      statusCode: 401,
      body: {
        success: false,
        errorCode: 'INVALID_WEBHOOK_SIGNATURE',
        errorMessage: sigCheck.reason || 'Firma de evento Wompi inválida.',
      },
    };
  }

  const tx = params.payload.data?.transaction;
  if (
    params.payload.event !== 'transaction.updated' ||
    !tx ||
    tx.status !== 'APPROVED' ||
    !tx.reference
  ) {
    return { statusCode: 200, body: { received: true, processed: false } };
  }

  const txId = String(tx.id || tx.reference);
  let verifiedReference = String(tx.reference);
  let verifiedAmountInCents =
    typeof tx.amount_in_cents === 'number' ? tx.amount_in_cents : undefined;

  const wompiConfig = getWompiConfig();
  if (wompiConfig.privateKey && tx.id) {
    const remoteTx = await fetchWompiTransaction(String(tx.id));
    if (!remoteTx.ok || remoteTx.status !== 'APPROVED') {
      return { statusCode: 200, body: { received: true, processed: false, verified: false } };
    }
    if (remoteTx.reference) {
      verifiedReference = remoteTx.reference;
    }
    if (typeof remoteTx.amountInCents === 'number') {
      verifiedAmountInCents = remoteTx.amountInCents;
    }
  }

  const confirmation = confirmWompiOrderApproved({
    reference: verifiedReference,
    transactionId: txId,
    amountInCents: verifiedAmountInCents,
  });

  if (confirmation.found && confirmation.order && confirmation.deviceId) {
    const repo = getStorageRepository();
    await repo.recordRemoteTransactionIdempotent({
      wompiTransactionId: txId,
      deviceId: confirmation.deviceId,
      userUid: confirmation.uid ?? null,
      reference: confirmation.order.reference,
      amountCop: confirmation.order.totalCop,
      secondsCredited: confirmation.order.addedSeconds,
      status: 'APPROVED',
    });

    if (!confirmation.alreadyCredited && typeof confirmation.remainingSeconds === 'number') {
      await repo.syncDeviceToRemote({
        deviceId: confirmation.deviceId,
        isPoweredOn: Boolean(confirmation.isPoweredOn),
        remainingSeconds: confirmation.remainingSeconds,
        lastStartedAtMs: confirmation.lastStartedAt ?? null,
        lastOffAtMs: getCompressorCooldownSnapshot(confirmation.deviceId).lastOffAt,
        ownerUid: confirmation.uid ?? null,
      });
    }
  }

  return {
    statusCode: 200,
    body: { received: true, processed: Boolean(confirmation.found) },
  };
}

export async function verifyAndConfirmWompiTransaction(params: {
  uid: string;
  email: string;
  transactionId: string;
  fallbackDeviceId: string;
}): Promise<{ statusCode: number; body: WompiPurchaseResponse }> {
  const transactionId = params.transactionId.trim();
  if (!transactionId) {
    return {
      statusCode: 400,
      body: {
        success: false,
        errorCode: 'MISSING_TRANSACTION_ID',
        errorMessage: 'Falta el identificador de la transacción Wompi.',
      },
    };
  }

  const txResult = await fetchWompiTransaction(transactionId);
  if (!txResult.ok || !txResult.reference) {
    return {
      statusCode: 400,
      body: {
        success: false,
        errorCode: 'WOMPI_VERIFY_FAILED',
        errorMessage: txResult.errorMessage || 'No se pudo verificar la transacción Wompi.',
      },
    };
  }

  if (txResult.status !== 'APPROVED') {
    return {
      statusCode: 200,
      body: {
        success: false,
        status: (txResult.status as WompiPurchaseResponse['status']) || 'PENDING',
        errorMessage: `La transacción se encuentra en estado ${txResult.status || 'PENDIENTE'}.`,
      },
    };
  }

  const confirmation = confirmWompiOrderApproved({
    reference: txResult.reference,
    transactionId,
    amountInCents: txResult.amountInCents,
    expectedUid: params.uid,
  });

  if (confirmation.forbidden) {
    return {
      statusCode: 403,
      body: {
        success: false,
        errorCode: 'FORBIDDEN_ORDER',
        errorMessage: 'Esta transacción no pertenece a tu cuenta.',
      },
    };
  }

  if (!confirmation.found) {
    return {
      statusCode: 404,
      body: {
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        errorMessage: 'Orden no encontrada para esa referencia.',
      },
    };
  }

  const targetDeviceId = confirmation.deviceId || params.fallbackDeviceId;
  const repo = getStorageRepository();

  if (confirmation.order) {
    await repo.recordRemoteTransactionIdempotent({
      wompiTransactionId: transactionId,
      deviceId: targetDeviceId,
      userUid: params.uid,
      reference: confirmation.order.reference,
      amountCop: confirmation.order.totalCop,
      secondsCredited: confirmation.order.addedSeconds,
      status: 'APPROVED',
    });
  }

  const accountState = getUserAccountState(params.uid, params.email, targetDeviceId);
  await repo.syncDeviceToRemote({
    deviceId: targetDeviceId,
    isPoweredOn: accountState.isPoweredOn,
    remainingSeconds: accountState.remainingSeconds,
    lastStartedAtMs: accountState.lastStartedAt,
    lastOffAtMs: accountState.lastOffAt,
    ownerUid: params.uid,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      deviceId: targetDeviceId,
      autoTurnedOn: false,
      status: 'APPROVED',
      reference: txResult.reference,
      transactionId,
      remainingSeconds: accountState.remainingSeconds,
      bankedRemainingSeconds: accountState.bankedRemainingSeconds,
      sessionTotalSeconds: accountState.sessionTotalSeconds,
      isPoweredOn: accountState.isPoweredOn,
      lastStartedAt: accountState.lastStartedAt,
      activeUntilMs: accountState.activeUntilMs,
      autoOffAtMs: 0,
      autoOffRemainingSeconds: 0,
      serverNowMs: accountState.serverNowMs,
      order: confirmation.order || null,
    },
  };
}
