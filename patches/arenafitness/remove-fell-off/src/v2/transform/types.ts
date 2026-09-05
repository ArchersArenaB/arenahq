import type { PlanVariables } from "./engine";

export interface TransformSubject {
  id: string;
  org_id: string;
  member_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  sex: string | null;
  height_cm: number | null;
  weight_lb: number | null;
  bf_band: string | null;
  goal: string;
  program_length_weeks: number;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransformPhoto {
  id: string;
  subject_id: string;
  angle: "front" | "side" | "back" | string;
  storage_path: string;
  original_path: string | null;
  cleaned: boolean;
  status: "pending" | "verified" | "rejected" | "failed" | string;
  verification: {
    pass?: boolean;
    guidance?: string;
    checks?: Record<string, { pass: boolean; note?: string }>;
    warnings?: string[];
    override?: boolean;
    error?: string;
    detected_angle?: string;
    relabelled_from?: string;
  } | null;

  taken_on: string;
  byte_size: number | null;
  created_at: string;
}

export interface TransformPlan {
  id: string;
  subject_id: string;
  variables: PlanVariables;
  created_at: string;
  updated_at: string;
}

export interface TransformRender {
  id: string;
  plan_id: string;
  week: number;
  /** Only "on_plan" is generated now; older rows may still carry other values. */
  path: "on_plan" | string;
  storage_path: string | null;
  status: "queued" | "running" | "ready" | "failed" | string;
  error: string | null;
  retry_after: string | null;
  attempts?: number | null;
  provider?: string | null;
  provider_request_id?: string | null;
  created_at: string;
}

export interface TransformCommitment {
  id: string;
  subject_id: string;
  plan_id: string | null;
  committed_at: string;
  notes: string | null;
}

export interface TransformCheckin {
  id: string;
  subject_id: string;
  measured_on: string;
  weight_lb: number | null;
  body_fat_pct: number | null;
  notes: string | null;
}

export const DISCLAIMER = "Illustrative projection based on your inputs — not a guarantee of results.";
