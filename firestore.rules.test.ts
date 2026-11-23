/**
 * Security Rules Verification Spec ("Dirty Dozen" TDD Suite)
 * Validates all 12 adversarial payloads against firestore.rules expectations.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-user PII profile read',
    path: '/users/user_b',
    operation: 'get',
    auth: { uid: 'user_a', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Blanket users collection list',
    path: '/users',
    operation: 'list',
    auth: { uid: 'user_a', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified email write attempt',
    path: '/users/user_a',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: false },
    payload: { uid: 'user_a', email: 'a@example.com', displayName: 'A', demoBalanceCop: 150000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity spoofing uid mismatch',
    path: '/users/user_a',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: { uid: 'user_b', email: 'a@example.com', displayName: 'A', demoBalanceCop: 150000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow field injection (isAdmin)',
    path: '/users/user_a',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      uid: 'user_a',
      email: 'a@example.com',
      displayName: 'A',
      demoBalanceCop: 150000,
      remainingSeconds: 0,
      activeUntilMs: 0,
      isAdmin: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path ID poisoning with invalid chars',
    path: '/users/user_a/payments/bad$id!space',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: { id: 'bad$id!space', userId: 'user_a' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Oversized summary string poisoning',
    path: '/users/user_a/commands/cmd_1',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      id: 'cmd_1',
      userId: 'user_a',
      action: 'PRENDER',
      ok: true,
      summary: 'x'.repeat(1000),
      tuyaCode: '',
      tuyaTid: '',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Forged client timestamp on create',
    path: '/users/user_a/commands/cmd_2',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      id: 'cmd_2',
      userId: 'user_a',
      action: 'ESTADO',
      ok: true,
      summary: 'ok',
      tuyaCode: '',
      tuyaTid: '',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable createdAt mutation on profile update',
    path: '/users/user_a',
    operation: 'update',
    auth: { uid: 'user_a', email_verified: true },
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Demo payment record update attempt',
    path: '/users/user_a/payments/DEMO_123',
    operation: 'update',
    auth: { uid: 'user_a', email_verified: true },
    payload: { status: 'VOIDED', hours: 24 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Out-of-bounds payment hours (>24h) or non-demo flag',
    path: '/users/user_a/payments/DEMO_999',
    operation: 'create',
    auth: { uid: 'user_a', email_verified: true },
    payload: {
      id: 'DEMO_999',
      userId: 'user_a',
      reference: 'DEMO_999',
      transactionId: 'DEMO_999',
      hours: 100,
      addedSeconds: 360000,
      subtotalCop: 600000,
      discountPercent: 20,
      discountCop: 120000,
      totalCop: 480000,
      amountInCents: 48000000,
      currency: 'COP',
      status: 'APPROVED',
      isDemo: false,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Update attempt on append-only command log',
    path: '/users/user_a/commands/cmd_1',
    operation: 'update',
    auth: { uid: 'user_a', email_verified: true },
    payload: { summary: 'tampered' },
    expected: 'PERMISSION_DENIED',
  },
];
