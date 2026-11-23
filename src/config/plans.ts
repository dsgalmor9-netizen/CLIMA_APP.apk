import type {
  ClimaPlanDefinition,
  ClimaPlanId,
  DiscountTierInfo,
  PricingQuote,
} from '../types/plans.ts';

export type { ClimaPlanDefinition, ClimaPlanId, DiscountTierInfo, PricingQuote };

export const BASE_HOURLY_RATE_COP = 5000;
export const LEGACY_HOURLY_RATE_COP = 5000;
export const MIN_HOURS = 1;
export const MAX_HOURS = 24;

export const CLIMA_PLANS: readonly ClimaPlanDefinition[] = [
  {
    id: 'express',
    name: 'Plan Express',
    hoursLabel: '1 Hora',
    subtitle: 'Tarifa base por hora',
    hours: 1,
    addedSeconds: 3_600,
    originalCop: 5_000,
    totalCop: 5_000,
    discountCop: 0,
    discountPercent: 0,
    amountInCents: 500_000,
    badge: null,
  },
  {
    id: 'brisa',
    name: 'Plan Brisa',
    hoursLabel: '6 Horas',
    subtitle: 'Ideal para descansar o pasar la tarde',
    hours: 6,
    addedSeconds: 21_600,
    originalCop: 30_000,
    totalCop: 27_000,
    discountCop: 3_000,
    discountPercent: 10,
    amountInCents: 2_700_000,
    badge: null,
  },
  {
    id: 'noche_fresca',
    name: 'Plan Noche Fresca',
    hoursLabel: '12 Horas',
    subtitle: 'Toda la noche fresca sin interrupciones',
    hours: 12,
    addedSeconds: 43_200,
    originalCop: 60_000,
    totalCop: 48_000,
    discountCop: 12_000,
    discountPercent: 20,
    amountInCents: 4_800_000,
    badge: {
      text: 'Más Vendido',
      tone: 'amber',
    },
  },
  {
    id: 'dia_completo',
    name: 'Plan Día Completo',
    hoursLabel: '24 Horas',
    subtitle: 'Confort continuo todo el día y la noche',
    hours: 24,
    addedSeconds: 86_400,
    originalCop: 120_000,
    totalCop: 84_000,
    discountCop: 36_000,
    discountPercent: 30,
    amountInCents: 8_400_000,
    badge: {
      text: 'Mejor Valor',
      tone: 'cyan',
    },
  },
] as const;

export const DEFAULT_PLAN_ID: ClimaPlanId = 'noche_fresca';

export const DISCOUNT_TIERS: DiscountTierInfo[] = [
  { minHours: 1, maxHours: 5, discountPercent: 0, label: '1 a 5 horas · Tarifa base' },
  { minHours: 6, maxHours: 11, discountPercent: 10, label: '6 a 11 horas · Ahorras 10%' },
  { minHours: 12, maxHours: 23, discountPercent: 20, label: '12 a 23 horas · Ahorras 20%' },
  { minHours: 24, maxHours: 24, discountPercent: 30, label: '24 horas · Ahorras 30%' },
];

export const QUICK_HOUR_PRESETS = [1, 6, 12, 24] as const;

export function getPlanById(planId: unknown): ClimaPlanDefinition | null {
  if (typeof planId !== 'string') return null;
  return CLIMA_PLANS.find((plan) => plan.id === planId) || null;
}

export function getPlanByHours(hours: number): ClimaPlanDefinition | null {
  return CLIMA_PLANS.find((plan) => plan.hours === hours) || null;
}

export function planToPricingQuote(plan: ClimaPlanDefinition): PricingQuote {
  return {
    planId: plan.id,
    planName: plan.name,
    hours: plan.hours,
    hourlyRateCop: BASE_HOURLY_RATE_COP,
    subtotalCop: plan.originalCop,
    discountPercent: plan.discountPercent,
    discountCop: plan.discountCop,
    totalCop: plan.totalCop,
    amountInCents: plan.amountInCents,
    addedSeconds: plan.addedSeconds,
    effectiveHourlyCop: Math.round(plan.totalCop / plan.hours),
  };
}

export function getDiscountPercent(hours: number): number {
  if (hours >= 24) return 30;
  if (hours >= 12) return 20;
  if (hours >= 6) return 10;
  return 0;
}

export function resolvePlanOrHoursPricing(input: {
  planId?: unknown;
  hours?: unknown;
}): PricingQuote {
  if (input.planId !== undefined && input.planId !== null && input.planId !== '') {
    const plan = getPlanById(input.planId);
    if (!plan) {
      throw new Error(
        'Plan seleccionado inválido. Elige Express (1h), Brisa (6h), Noche Fresca (12h) o Día Completo (24h).'
      );
    }
    return planToPricingQuote(plan);
  }

  const rawHours = Number(input.hours);
  const matchingPlan = getPlanByHours(Math.round(rawHours));
  if (matchingPlan) {
    return planToPricingQuote(matchingPlan);
  }

  return calculatePricing(rawHours);
}

export function calculatePricing(rawHours: number): PricingQuote {
  const hours = Math.round(rawHours);
  if (!Number.isInteger(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
    throw new Error(`La cantidad de horas debe estar entre ${MIN_HOURS} y ${MAX_HOURS}.`);
  }

  const matchingPlan = getPlanByHours(hours);
  if (matchingPlan) {
    return planToPricingQuote(matchingPlan);
  }

  const subtotalCop = hours * BASE_HOURLY_RATE_COP;
  const discountPercent = getDiscountPercent(hours);
  const discountCop = Math.round(subtotalCop * (discountPercent / 100));
  const totalCop = subtotalCop - discountCop;
  const amountInCents = totalCop * 100;
  const addedSeconds = hours * 3600;
  const effectiveHourlyCop = Math.round(totalCop / hours);

  return {
    hours,
    hourlyRateCop: BASE_HOURLY_RATE_COP,
    subtotalCop,
    discountPercent,
    discountCop,
    totalCop,
    amountInCents,
    addedSeconds,
    effectiveHourlyCop,
  };
}

export function formatCop(amount: number): string {
  const formatted = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `$${formatted} COP`;
}

export function formatCopShort(amount: number): string {
  const formatted = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `$${formatted}`;
}

export function formatSecondsCount(seconds: number): string {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(seconds))
  )} s`;
}

export function formatDurationHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}
