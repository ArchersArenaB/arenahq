import { describe, expect, it } from "vitest";
import {
  DEFAULT_VARIABLES,
  MAX_WEEKS,
  RENDER_WEEKS,
  KEY_RENDER_WEEKS,
  PLAN_PRESET,
  PRESET_WEEKS,
  creditsFor,
  presetBodyFatFloor,
  projectSimple,
  toSimplePlan,
  bandToBodyFat,
  computeDrivers,
  project,
  waistEstimate,
  type Baseline,
  type PlanVariables,
} from "./engine";
import { evaluateTrack, weeksBetween } from "./onTrack";

const base: Baseline = {
  weightLb: 210,
  bodyFatPct: 30,
  heightCm: 180,
  sex: "male",
  age: 38,
  goal: "cut",
};

const strict: PlanVariables = {
  ...DEFAULT_VARIABLES,
  workoutsPerWeek: 5,
  effort: "allout",
  steps: 12000,
  proteinGPerLb: 1,
  calorieAdherence: 95,
  sleepHours: 8,
  drinksPerWeek: 0,
  cardioSessions: 3,
  consistency: 95,
  tracksFood: true,
  weeklyCheckins: true,
  mealPreps: true,
};

const lazy: PlanVariables = {
  ...DEFAULT_VARIABLES,
  workoutsPerWeek: 1,
  effort: "coasting",
  steps: 3000,
  proteinGPerLb: 0.4,
  calorieAdherence: 55,
  sleepHours: 5,
  drinksPerWeek: 12,
  cardioSessions: 0,
  consistency: 55,
  weekendDropoff: true,
};

describe("projection engine", () => {
  it("is deterministic", () => {
    expect(project(base, strict)).toEqual(project(base, strict));
  });

  it("returns week 0 through 60 on the plan", () => {
    const p = project(base, strict);
    expect(p.onPlan).toHaveLength(MAX_WEEKS + 1);
    expect(p.onPlan[0].weight).toBe(210);
    expect(p.onPlan[0].bodyFatPct).toBeCloseTo(30, 1);
  });

  it("only projects the on-plan path", () => {
    expect(Object.keys(project(base, strict))).toEqual(["onPlan"]);
    expect(Object.keys(projectSimple(base, "cut"))).toEqual(["onPlan"]);
  });

  it("renders weeks 8-20 and prices them", () => {
    expect([...RENDER_WEEKS]).toEqual([8, 12, 16, 20]);
    expect([...KEY_RENDER_WEEKS]).toEqual([8, 12, 16, 20]);
    expect(creditsFor(KEY_RENDER_WEEKS)).toBe(8);
  });

  it("covers every render week", () => {
    const p = project(base, strict);
    for (const w of RENDER_WEEKS) expect(p.onPlan[w]).toBeDefined();
  });

  it("loses fat faster with better adherence", () => {
    const good = project(base, strict).onPlan[12];
    const bad = project(base, lazy).onPlan[12];
    expect(good.bodyFatPct).toBeLessThan(bad.bodyFatPct);
    expect(good.weight).toBeLessThan(bad.weight);
  });

  it("keeps weekly loss inside a sane band", () => {
    const p = project(base, strict).onPlan;
    for (let i = 1; i < p.length; i++) {
      const pctLoss = (p[i - 1].weight - p[i].weight) / p[i - 1].weight;
      expect(pctLoss).toBeLessThanOrEqual(0.015);
    }
  });

  it("never drops below essential body fat", () => {
    const p = project({ ...base, bodyFatPct: 14 }, strict).onPlan;
    for (const pt of p) expect(pt.bodyFatPct).toBeGreaterThanOrEqual(8);
    const f = project({ ...base, sex: "female", bodyFatPct: 22 }, strict).onPlan;
    for (const pt of f) expect(pt.bodyFatPct).toBeGreaterThanOrEqual(16);
  });

  it("stopsAfterWeek freezes then reverses progress", () => {
    const stop = project(base, { ...strict, stopsAfterWeek: 12 }).onPlan;
    expect(stop[24].bodyFatPct).toBeGreaterThan(stop[12].bodyFatPct);
  });

  it("alcohol and weekend drop-off reduce results", () => {
    const clean = project(base, strict).onPlan[12].weight;
    const boozy = project(base, { ...strict, drinksPerWeek: 15, weekendDropoff: true }).onPlan[12].weight;
    expect(boozy).toBeGreaterThan(clean);
  });

  it("build goal adds lean mass", () => {
    const p = project({ ...base, goal: "build" }, strict).onPlan;
    expect(p[24].leanMass).toBeGreaterThan(p[0].leanMass);
  });

  it("drivers stay inside their caps", () => {
    const d = computeDrivers(strict, base);
    expect(d.fatLossRate).toBeLessThanOrEqual(0.012);
    expect(d.leanGainPerWeek).toBeLessThanOrEqual(0.7);
    const z = computeDrivers({ ...lazy, calorieAdherence: 0, consistency: 0 }, base);
    expect(z.fatLossRate).toBeGreaterThanOrEqual(0);
  });

  it("waist shrinks as body fat falls", () => {
    expect(waistEstimate(200, 20, 180, "male")).toBeLessThan(waistEstimate(200, 32, 180, "male"));
  });

  it("maps body-fat bands", () => {
    expect(bandToBodyFat("average", "male")).toBe(23);
    expect(bandToBodyFat("average", "female")).toBe(29);
    expect(bandToBodyFat(null, "male")).toBe(24);
  });
});

describe("on-track engine", () => {
  const p = project(base, strict);

  it("counts whole weeks", () => {
    expect(weeksBetween("2026-01-01", "2026-01-15")).toBe(2);
    expect(weeksBetween("2026-01-01", "2026-01-05")).toBe(0);
  });

  it("reports no data without check-ins", () => {
    expect(evaluateTrack(p, "2026-01-01", [], "2026-02-12").status).toBe("no_data");
  });

  it("flags ahead / on track / off track", () => {
    const expected6 = p.onPlan[6].weight;
    const ahead = evaluateTrack(p, "2026-01-01", [{ date: "2026-02-12", weightLb: expected6 - 4, bodyFatPct: null }], "2026-02-12");
    expect(ahead.status).toBe("ahead");

    const on = evaluateTrack(p, "2026-01-01", [{ date: "2026-02-12", weightLb: expected6, bodyFatPct: null }], "2026-02-12");
    expect(on.status).toBe("on_track");

    const off = evaluateTrack(p, "2026-01-01", [{ date: "2026-02-12", weightLb: 212, bodyFatPct: null }], "2026-02-12");
    expect(off.status).toBe("off_track");
    expect(off.nudge).toBeTruthy();
  });

  it("uses the latest check-in", () => {
    const r = evaluateTrack(
      p,
      "2026-01-01",
      [
        { date: "2026-01-08", weightLb: 208, bodyFatPct: null },
        { date: "2026-02-12", weightLb: 199, bodyFatPct: null },
      ],
      "2026-02-12",
    );
    expect(r.actualWeight).toBe(199);
  });
});

describe("preset plan", () => {
  it("loses 1 lb per week on the cut path", () => {
    const p = projectSimple(base, "cut").onPlan;
    expect(p).toHaveLength(PRESET_WEEKS + 1);
    expect(p[0].weight).toBe(210);
    expect(p[8].weight).toBeCloseTo(210 - 8 * PLAN_PRESET.lossLbPerWeek, 1);
    expect(p[20].weight).toBeCloseTo(190, 1);
  });

  it("builds lean mass on the build path", () => {
    const p = projectSimple({ ...base, goal: "build" }, "build").onPlan;
    expect(p[20].leanMass).toBeCloseTo(p[0].leanMass + 20 * PLAN_PRESET.leanGainLbPerWeek, 1);
    expect(p[20].weight).toBeGreaterThan(p[0].weight);
  });

  it("respects the body-fat and weight floors", () => {
    expect(presetBodyFatFloor("male")).toBe(10);
    expect(presetBodyFatFloor("female")).toBe(18);
    const lean = projectSimple({ ...base, bodyFatPct: 12, weightLb: 150 }, "cut").onPlan;
    for (const pt of lean) {
      expect(pt.bodyFatPct).toBeGreaterThanOrEqual(10);
      expect(pt.weight).toBeGreaterThanOrEqual(150 * 0.85 - 0.05);
    }
    const women = projectSimple({ ...base, sex: "female", bodyFatPct: 22, weightLb: 150 }, "cut").onPlan;
    for (const pt of women) expect(pt.bodyFatPct).toBeGreaterThanOrEqual(18);
  });

  it("reads legacy plan rows", () => {
    expect(toSimplePlan({ workoutsPerWeek: 5 }, "recomp")).toEqual({ preset: "1lb_week", goal: "recomp" });
    expect(toSimplePlan({ preset: "1lb_week", goal: "build" }, "cut").goal).toBe("build");
    expect(toSimplePlan(null, "cut")).toEqual({ preset: "1lb_week", goal: "cut" });
  });

  it("is deterministic", () => {
    expect(projectSimple(base, "cut")).toEqual(projectSimple(base, "cut"));
  });
});
