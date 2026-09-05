/**
 * Deterministic projection engine for the Transformation module.
 * Pure TypeScript — no AI, no randomness, no I/O. Unit-tested in engine.test.ts.
 *
 * Heuristics are intentionally conservative and evidence-flavoured:
 *  - sustainable fat loss sits between 0.5% and 1.0% of bodyweight per week and
 *    scales with calorie adherence, training consistency and daily steps;
 *  - alcohol carries a penalty;
 *  - novice lean gain runs ~1-2 lb / month, scaled by protein, effort and sleep,
 *    tapering as training age grows.
 *
 * Only the ON PLAN path is projected — the tool shows clients what sticking to
 * the plan looks like, never what dropping off looks like.
 */

export type Goal = "cut" | "recomp" | "build";
export type Effort = "coasting" | "working" | "allout";
export type Sex = "male" | "female" | "other";
export type PathKey = "on_plan";

export const RENDER_WEEKS = [8, 12, 16, 20] as const;
/** Every timepoint is a key timepoint now — one generate button covers them all. */
export const KEY_RENDER_WEEKS = [8, 12, 16, 20] as const;
/** Credits consumed per generated image. */
export const CREDITS_PER_RENDER = 2;
/** Credit estimate: weeks x credits per image. */
export function creditsFor(weeks: readonly number[]): number {
  return weeks.length * CREDITS_PER_RENDER;
}
export const MAX_WEEKS = 60;
/** Horizon of the simplified preset plan. */
export const PRESET_WEEKS = 20;

/** The one fixed, reasonable plan every subject gets. */
export const PLAN_PRESET = {
  key: "1lb_week" as const,
  /** cut / recomp: pounds of bodyweight lost per week */
  lossLbPerWeek: 1,
  /** build: pounds of lean mass gained per week */
  leanGainLbPerWeek: 0.5,
  label: "Lose 1 lb per week",
  buildLabel: "Gain 0.5 lb of lean muscle per week",
} as const;

export interface SimplePlan {
  preset: "1lb_week";
  goal: Goal;
}

export const DEFAULT_SIMPLE_PLAN: SimplePlan = { preset: "1lb_week", goal: "cut" };

/** Reads a plan row's `variables` (new preset shape or a legacy slider blob). */
export function toSimplePlan(variables: unknown, fallbackGoal: Goal): SimplePlan {
  const v = (variables ?? {}) as Record<string, unknown>;
  const goal = (["cut", "recomp", "build"] as const).includes(v.goal as Goal) ? (v.goal as Goal) : fallbackGoal;
  return { preset: "1lb_week", goal };
}


export interface PlanVariables {
  workoutsPerWeek: number; // 0-7
  effort: Effort;
  steps: number; // 2000-15000
  proteinGPerLb: number; // 0.4-1.2
  calorieAdherence: number; // 50-100 (%)
  sleepHours: number; // 5-9
  drinksPerWeek: number; // 0-15
  cardioSessions: number; // 0-5
  consistency: number; // 50-100 (% of sessions attended)
  tracksFood: boolean;
  weeklyCheckins: boolean;
  mealPreps: boolean;
  weekendDropoff: boolean; // adherence -25% Fri-Sun
  stopsAfterWeek: number | null;
}

export interface Baseline {
  weightLb: number;
  bodyFatPct: number;
  heightCm: number | null;
  sex: Sex;
  age: number | null;
  goal: Goal;
}

export interface WeekPoint {
  week: number;
  weight: number;
  bodyFatPct: number;
  leanMass: number;
  waistIn: number;
}

export interface Projection {
  onPlan: WeekPoint[];
}

export const DEFAULT_VARIABLES: PlanVariables = {
  workoutsPerWeek: 3,
  effort: "working",
  steps: 7000,
  proteinGPerLb: 0.8,
  calorieAdherence: 80,
  sleepHours: 7,
  drinksPerWeek: 3,
  cardioSessions: 1,
  consistency: 80,
  tracksFood: false,
  weeklyCheckins: false,
  mealPreps: false,
  weekendDropoff: false,
  stopsAfterWeek: null,
};

/** Mid-point body fat for the visual band picker. */
export const BF_BANDS: { key: string; label: string; pct: number }[] = [
  { key: "lean", label: "Lean · 10-14%", pct: 12 },
  { key: "fit", label: "Fit · 15-19%", pct: 17 },
  { key: "average", label: "Average · 20-26%", pct: 23 },
  { key: "soft", label: "Soft · 27-33%", pct: 30 },
  { key: "heavy", label: "Heavy · 34-40%", pct: 37 },
  { key: "very_heavy", label: "Very heavy · 41%+", pct: 44 },
];

export function bandToBodyFat(band: string | null | undefined, sex: Sex): number {
  const found = BF_BANDS.find((b) => b.key === band);
  if (found) return sex === "female" ? found.pct + 6 : found.pct;
  return sex === "female" ? 30 : 24;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Essential-fat floor so projections never march to zero. */
function bodyFatFloor(sex: Sex): number {
  return sex === "female" ? 16 : 8;
}

interface Drivers {
  fatLossRate: number; // fraction of bodyweight lost per week at week 0
  leanGainPerWeek: number; // lb / week at week 0
}

export function computeDrivers(v: PlanVariables, base: Baseline): Drivers {
  const adherence = clamp(v.calorieAdherence, 0, 100) / 100;
  const consistency = clamp(v.consistency, 0, 100) / 100;
  const stepFactor = clamp((v.steps - 2000) / 10000, 0, 1); // 2k -> 0, 12k+ -> 1
  const trainFactor = clamp(v.workoutsPerWeek / 4, 0, 1.15);
  const cardioFactor = clamp(v.cardioSessions / 4, 0, 1);
  const alcoholPenalty = 1 - clamp(v.drinksPerWeek / 15, 0, 1) * 0.25;
  const weekendPenalty = v.weekendDropoff ? 0.82 : 1;
  const habitBonus =
    1 + (v.tracksFood ? 0.06 : 0) + (v.weeklyCheckins ? 0.05 : 0) + (v.mealPreps ? 0.05 : 0);

  const goalCeiling = base.goal === "cut" ? 0.01 : base.goal === "recomp" ? 0.007 : 0.004;

  const fatLossRate =
    goalCeiling *
    (0.45 * adherence + 0.25 * consistency + 0.15 * stepFactor + 0.15 * cardioFactor) *
    (0.85 + 0.3 * trainFactor) *
    alcoholPenalty *
    weekendPenalty *
    habitBonus;

  const effortFactor = v.effort === "allout" ? 1.15 : v.effort === "working" ? 1 : 0.7;
  const proteinFactor = clamp(v.proteinGPerLb / 0.8, 0.5, 1.2);
  const sleepFactor = clamp((v.sleepHours - 5) / 3, 0.4, 1.05);
  const goalLeanCeiling = base.goal === "build" ? 0.55 : base.goal === "recomp" ? 0.4 : 0.28; // lb / week

  const leanGainPerWeek =
    goalLeanCeiling *
    trainFactor *
    consistency *
    effortFactor *
    proteinFactor *
    sleepFactor *
    alcoholPenalty;

  return {
    fatLossRate: clamp(fatLossRate, 0, 0.012),
    leanGainPerWeek: clamp(leanGainPerWeek, 0, 0.7),
  };
}

/** Rough waist estimate (inches) from body fat and height. */
export function waistEstimate(weightLb: number, bodyFatPct: number, heightCm: number | null, sex: Sex): number {
  const heightIn = (heightCm ?? (sex === "female" ? 165 : 178)) / 2.54;
  const base = sex === "female" ? 0.42 : 0.45;
  const waist = heightIn * (base + (bodyFatPct - (sex === "female" ? 24 : 16)) * 0.0085);
  return round1(clamp(waist, heightIn * 0.34, heightIn * 0.72));
}

function point(week: number, weight: number, fatMass: number, leanMass: number, base: Baseline): WeekPoint {
  const bodyFatPct = clamp((fatMass / Math.max(weight, 1)) * 100, bodyFatFloor(base.sex), 60);
  return {
    week,
    weight: round1(weight),
    bodyFatPct: round1(bodyFatPct),
    leanMass: round1(leanMass),
    waistIn: waistEstimate(weight, bodyFatPct, base.heightCm, base.sex),
  };
}

function series(base: Baseline, v: PlanVariables): WeekPoint[] {
  const drivers = computeDrivers(v, base);
  const startFat = (base.weightLb * clamp(base.bodyFatPct, 3, 60)) / 100;
  const startLean = base.weightLb - startFat;

  let fatMass = startFat;
  let leanMass = startLean;

  const out: WeekPoint[] = [point(0, base.weightLb, fatMass, leanMass, base)];
  const stopWeek = v.stopsAfterWeek && v.stopsAfterWeek > 0 ? v.stopsAfterWeek : null;

  for (let week = 1; week <= MAX_WEEKS; week++) {
    const weight = fatMass + leanMass;

    // How much of the plan is actually being followed this week.
    const engagement = stopWeek && week > stopWeek ? 0 : 1;

    if (engagement > 0.02) {
      const fatDelta = weight * drivers.fatLossRate * engagement;
      const taper = Math.exp(-week / 26); // novice gains taper over ~6 months
      const leanDelta = drivers.leanGainPerWeek * taper * engagement;
      fatMass = Math.max(fatMass - fatDelta, (bodyFatFloor(base.sex) / 100) * weight);
      leanMass += leanDelta;
    } else {
      // Stopped training: fat returns faster than muscle is lost.
      const fatRegain = (startFat - fatMass) * 0.06 + weight * 0.0012;
      const leanLoss = Math.max(0, leanMass - startLean) * 0.03 + weight * 0.0002;
      fatMass = Math.min(startFat * 1.12, fatMass + Math.max(0, fatRegain));
      leanMass = Math.max(startLean * 0.94, leanMass - leanLoss);
    }

    out.push(point(week, fatMass + leanMass, fatMass, leanMass, base));
  }

  return out;
}

export function project(base: Baseline, v: PlanVariables): Projection {
  return { onPlan: series(base, v) };
}

export function pointAtWeek(points: WeekPoint[], week: number): WeekPoint {
  const idx = clamp(Math.round(week), 0, points.length - 1);
  return points[idx];
}

/** Human sentence used to build the image prompt for a given week. */
export function renderDescription(base: Baseline, p: WeekPoint): string {
  const lbDelta = round1(base.weightLb - p.weight);
  const lighter = lbDelta > 0 ? `roughly ${lbDelta} lb lighter` : `roughly ${Math.abs(lbDelta)} lb heavier`;
  const leaner = p.bodyFatPct < base.bodyFatPct ? "flatter waist and more visible muscle definition" : "softer midsection";
  return `${lighter}, body fat around ${Math.round(p.bodyFatPct)}%, ${leaner}, more defined shoulders and arms`;
}

/* ------------------------------------------------------------------ */
/* Simplified preset projection (no sliders)                           */
/* ------------------------------------------------------------------ */

/** Hard floors for the preset plan: never below these, ever. */
export function presetBodyFatFloor(sex: Sex): number {
  return sex === "female" ? 18 : 10;
}

function presetSeries(base: Baseline, goal: Goal): WeekPoint[] {
  const bfFloor = presetBodyFatFloor(base.sex);
  const weightFloor = base.weightLb * 0.85;
  const startFat = (base.weightLb * clamp(base.bodyFatPct, 3, 60)) / 100;
  const startLean = base.weightLb - startFat;

  let fatMass = startFat;
  let leanMass = startLean;

  const mk = (week: number): WeekPoint => {
    const weight = Math.max(weightFloor, fatMass + leanMass);
    const bodyFatPct = clamp((fatMass / Math.max(weight, 1)) * 100, bfFloor, 60);
    return {
      week,
      weight: Math.round(weight * 10) / 10,
      bodyFatPct: Math.round(bodyFatPct * 10) / 10,
      leanMass: Math.round(leanMass * 10) / 10,
      waistIn: waistEstimate(weight, bodyFatPct, base.heightCm, base.sex),
    };
  };

  const out: WeekPoint[] = [mk(0)];

  for (let week = 1; week <= PRESET_WEEKS; week++) {
    if (goal === "build") {
      leanMass += PLAN_PRESET.leanGainLbPerWeek;
    } else {
      const weight = fatMass + leanMass;
      const leanGain = goal === "recomp" ? 0.15 : 0;
      const fatLoss = PLAN_PRESET.lossLbPerWeek + leanGain;
      const minFat = (bfFloor / 100) * weight;
      const room = Math.max(0, fatMass - minFat);
      fatMass -= Math.min(fatLoss, room);
      leanMass += leanGain;
      if (fatMass + leanMass < weightFloor) fatMass = Math.max(minFat, weightFloor - leanMass);
    }

    out.push(mk(week));
  }

  return out;
}

/** Weeks 0-20 on the plan for the fixed preset. */
export function projectSimple(base: Baseline, goal: Goal = base.goal): Projection {
  return { onPlan: presetSeries(base, goal) };
}
