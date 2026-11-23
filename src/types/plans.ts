export type ClimaPlanId = 'express' | 'brisa' | 'noche_fresca' | 'dia_completo';

export interface ClimaPlanBadge {
  text: string;
  tone: 'amber' | 'cyan';
}

export interface ClimaPlanDefinition {
  id: ClimaPlanId;
  name: string;
  hoursLabel: string;
  subtitle: string;
  hours: number;
  addedSeconds: number;
  originalCop: number;
  totalCop: number;
  discountCop: number;
  discountPercent: number;
  amountInCents: number;
  badge: ClimaPlanBadge | null;
}

export interface DiscountTierInfo {
  minHours: number;
  maxHours: number;
  discountPercent: number;
  label: string;
}

export interface PricingQuote {
  planId?: ClimaPlanId;
  planName?: string;
  hours: number;
  hourlyRateCop: number;
  subtotalCop: number;
  discountPercent: number;
  discountCop: number;
  totalCop: number;
  amountInCents: number;
  addedSeconds: number;
  effectiveHourlyCop: number;
}
