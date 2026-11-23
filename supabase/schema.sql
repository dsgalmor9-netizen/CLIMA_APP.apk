-- ClimaPay — Supabase (PostgreSQL Free Tier) Schema
-- Run this script once in the Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Devices table: authoritative on-demand timer & compressor cooldown state
CREATE TABLE IF NOT EXISTS public.devices (
  device_id TEXT PRIMARY KEY,
  is_powered_on BOOLEAN NOT NULL DEFAULT FALSE,
  remaining_seconds INTEGER NOT NULL DEFAULT 0 CHECK (remaining_seconds >= 0),
  last_started_at TIMESTAMPTZ NULL,
  last_off_at TIMESTAMPTZ NULL,
  owner_uid TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast partial index used by /api/cron/check-expired (only scans actively powered-on devices)
CREATE INDEX IF NOT EXISTS idx_devices_active_powered
  ON public.devices (device_id, last_started_at)
  WHERE is_powered_on = TRUE;

-- 2. Transactions table: strict idempotency via UNIQUE(wompi_transaction_id)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wompi_transaction_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
  user_uid TEXT NULL,
  reference TEXT UNIQUE NULL,
  amount_cop INTEGER NOT NULL CHECK (amount_cop >= 0),
  seconds_credited INTEGER NOT NULL CHECK (seconds_credited > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_device_created
  ON public.transactions (device_id, created_at DESC);

-- Enable Row Level Security (only backend service_role mutates devices & transactions)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Atomic server-side helper: credits seconds strictly ONCE per wompi_transaction_id
-- without auto-starting the AC (is_powered_on remains unchanged / false when paused).
CREATE OR REPLACE FUNCTION public.credit_device_transaction(
  p_wompi_transaction_id TEXT,
  p_device_id TEXT,
  p_user_uid TEXT,
  p_reference TEXT,
  p_amount_cop INTEGER,
  p_seconds_credited INTEGER,
  p_status TEXT DEFAULT 'APPROVED'
)
RETURNS TABLE (
  already_credited BOOLEAN,
  remaining_seconds INTEGER,
  is_powered_on BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted_id UUID;
  v_remaining INTEGER;
  v_powered BOOLEAN;
BEGIN
  -- Ensure target device row exists
  INSERT INTO public.devices (device_id)
  VALUES (p_device_id)
  ON CONFLICT (device_id) DO NOTHING;

  -- Idempotent insert guarded by UNIQUE(wompi_transaction_id)
  INSERT INTO public.transactions (
    wompi_transaction_id,
    device_id,
    user_uid,
    reference,
    amount_cop,
    seconds_credited,
    status
  )
  VALUES (
    p_wompi_transaction_id,
    p_device_id,
    p_user_uid,
    p_reference,
    p_amount_cop,
    p_seconds_credited,
    p_status
  )
  ON CONFLICT (wompi_transaction_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT d.remaining_seconds, d.is_powered_on
      INTO v_remaining, v_powered
    FROM public.devices d
    WHERE d.device_id = p_device_id;

    RETURN QUERY SELECT TRUE, COALESCE(v_remaining, 0), COALESCE(v_powered, FALSE);
    RETURN;
  END IF;

  -- Credit seconds only; never auto-start the AC relay
  UPDATE public.devices d
  SET
    remaining_seconds = d.remaining_seconds + p_seconds_credited,
    owner_uid = COALESCE(p_user_uid, d.owner_uid),
    updated_at = NOW()
  WHERE d.device_id = p_device_id
  RETURNING d.remaining_seconds, d.is_powered_on
    INTO v_remaining, v_powered;

  RETURN QUERY SELECT FALSE, COALESCE(v_remaining, 0), COALESCE(v_powered, FALSE);
END;
$$;
