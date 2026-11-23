# Security Specification — Control Remoto TQ-Q-SY1-JWT (Modo Demostración)

## 1. Data Invariants

1. **Identity & PII Isolation**: A user document `/users/{userId}` contains PII (`email`, `displayName`) and is readable/writable strictly by `request.auth.uid == userId`. No blanket `isSignedIn()` reads or collection-level user listing exist.
2. **Master Gate on Subcollections**: Every document in `/users/{userId}/payments/{paymentId}` and `/users/{userId}/commands/{commandId}` requires the parent `/users/{userId}` document to exist (`exists(...)`), `userId == request.auth.uid`, and `incoming().userId == request.auth.uid`.
3. **Verified Identity**: All write operations require `request.auth != null && request.auth.token.email_verified == true`.
4. **Demo Pricing & Bounds Integrity**: Payment records must satisfy `isDemo == true`, `hours >= 1 && hours <= 24`, `addedSeconds == hours * 3600`, `subtotalCop == hours * 6000`, valid tier discounts (`0%`, `5%`, `12%`, `20%`), `currency == 'COP'`, `status == 'APPROVED'`, and `amountInCents == totalCop * 100`.
5. **Immutable Demo Payment Records**: Once created in `/users/{userId}/payments/{paymentId}`, payment records cannot be updated or deleted.
6. **Append-Only Command Logs**: Documents in `/users/{userId}/commands/{commandId}` cannot be updated once created; only owner creation and deletion (clear history) are allowed.
7. **Temporal Integrity & Immutability**: `createdAt` and `updatedAt` must strictly equal `request.time`; `uid`, `userId`, `id`, `reference`, and `createdAt` are immutable after creation.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)

1. **Cross-User Profile Read (PII Leak)**: Authenticated user `uid_A` attempts `get(/users/uid_B)`.
2. **Blanket User List Scraping**: Authenticated user `uid_A` attempts `list(/users)`.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create `/users/uid_A`.
4. **Identity Spoofing on Create**: User `uid_A` attempts to create `/users/uid_A` with `{ uid: "uid_B", ... }`.
5. **Shadow / Ghost Field Injection**: User `uid_A` attempts to create `/users/uid_A` with extra field `{ isAdmin: true }`.
6. **ID Poisoning**: User `uid_A` attempts to create `/users/uid_A/payments/bad$id!space` or a 200-char ID.
7. **Oversized String Resource Poisoning**: User `uid_A` attempts to create a command log with `summary` of 1,000 characters.
8. **Client Timestamp Forgery**: User `uid_A` sends a hardcoded `createdAt` timestamp instead of `serverTimestamp()`.
9. **Immutable Field Mutation**: User `uid_A` attempts to update `/users/uid_A` changing `createdAt` or `uid`.
10. **Immutable Payment Record Mutation**: User `uid_A` attempts to update an existing Demo payment record in `/users/uid_A/payments/{paymentId}`.
11. **Out-of-Bounds / Forged Payment Pricing**: User `uid_A` attempts to create a payment with `hours: 100` (exceeding max 24h) or mismatched `subtotalCop != hours * 6000` or `isDemo: false`.
12. **Command Log Mutation**: User `uid_A` attempts to update an existing command log entry in `/users/uid_A/commands/{commandId}`.
