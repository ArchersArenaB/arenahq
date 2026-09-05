import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ORG_ID } from "../constants";
import { compressImage } from "./imageCompress";
import { KEY_RENDER_WEEKS, DEFAULT_VARIABLES, type PlanVariables, type SimplePlan } from "./engine";
import type {
  TransformCheckin,
  TransformCommitment,
  TransformPhoto,
  TransformPlan,
  TransformRender,
  TransformSubject,
} from "./types";

const BUCKET = "transformation-media";
const sb = supabase as any;
/** The only projection path the app generates. */
const PATH = "on_plan" as const;

/* --------------------------- verify queue ---------------------------- */
/** The photo check runs on a free per-minute quota: space calls 15s apart. */
const VERIFY_GAP_MS = 15000;
let verifyChain: Promise<unknown> = Promise.resolve();
let lastVerifyAt = 0;

export function queuedVerify(
  photoId: string,
): Promise<{ error?: string; retryable?: boolean; angle?: string; relabelledFrom?: string | null }> {
  const run = verifyChain.then(async () => {
    const wait = lastVerifyAt + VERIFY_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastVerifyAt = Date.now();
    const { data: res, error: fnErr } = await supabase.functions.invoke("verify-photo", {
      body: { photoId },
    });
    lastVerifyAt = Date.now();
    if (fnErr) {
      // supabase-js surfaces non-2xx as an error; a 429 body carries retryable.
      const body: any = (fnErr as any)?.context?.body;
      let parsed: any = null;
      try {
        parsed = typeof body === "string" ? JSON.parse(body) : body;
      } catch {
        parsed = null;
      }
      if (parsed?.retryable) return { error: parsed.error as string, retryable: true };
      return { error: fnErr.message, retryable: false };
    }
    const r = res as any;
    if (r?.error) return { error: r.error as string, retryable: !!r.retryable };
    return { angle: r?.angle as string | undefined, relabelledFrom: (r?.relabelled_from ?? null) as string | null };
  });
  verifyChain = run.catch(() => {});
  return run;
}


/* ------------------------------ subjects ------------------------------ */

export function useTransformSubjects() {
  return useQuery({
    queryKey: ["v2", "transform", "subjects"],
    queryFn: async (): Promise<TransformSubject[]> => {
      const { data, error } = await sb
        .from("transformation_subjects")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data ?? []) as TransformSubject[];
    },
  });
}

export function useTransformSubject(id: string | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "subject", id],
    enabled: !!id,
    queryFn: async (): Promise<TransformSubject | null> => {
      const { data, error } = await sb.from("transformation_subjects").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as TransformSubject | null;
    },
  });
}

export function useSaveSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TransformSubject> & { id?: string }): Promise<TransformSubject> => {
      const { data: auth } = await supabase.auth.getUser();
      if (patch.id) {
        const { id, ...rest } = patch;
        const { data, error } = await sb
          .from("transformation_subjects")
          .update(rest)
          .eq("id", id)
          .select("*")
          .single();
        if (error) throw error;
        return data as TransformSubject;
      }
      const { data, error } = await sb
        .from("transformation_subjects")
        .insert({ ...patch, org_id: ORG_ID, created_by: auth.user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data as TransformSubject;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["v2", "transform", "subjects"] });
      qc.invalidateQueries({ queryKey: ["v2", "transform", "subject", row.id] });
    },
  });
}

/* ------------------------------- photos ------------------------------- */

export function useSubjectPhotos(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "photos", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<TransformPhoto[]> => {
      const { data, error } = await sb
        .from("transformation_photos")
        .select("*")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TransformPhoto[];
    },
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subjectId,
      angle,
      file,
      originalFile,
      cleaned,
      onStep,
    }: {
      subjectId: string;
      angle: string;
      /** the file that becomes storage_path (cleaned when available) */
      file: File;
      /** the untouched capture, kept alongside when the photo was cleaned */
      originalFile?: File | null;
      cleaned?: boolean;
      onStep?: (step: "compressing" | "uploading" | "checking") => void;
    }): Promise<TransformPhoto> => {
      onStep?.("compressing");
      // compressImage returns the original file when the browser cannot decode
      // it (e.g. no createImageBitmap on some Android/iOS webviews).
      const small = await compressImage(file);
      const contentType = small.type || file.type || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("heic") ? "heic" : "jpg";
      const path = `subjects/${subjectId}/${angle}-${Date.now()}.${ext}`;
      onStep?.("uploading");
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, small, { contentType, upsert: false });
      if (upErr) throw upErr;

      let originalPath: string | null = null;
      if (originalFile) {
        const orig = await compressImage(originalFile);
        const oType = orig.type || originalFile.type || "image/jpeg";
        const oPath = `subjects/${subjectId}/${angle}-${Date.now()}-original.jpg`;
        const { error: oErr } = await supabase.storage
          .from(BUCKET)
          .upload(oPath, orig, { contentType: oType, upsert: false });
        if (!oErr) originalPath = oPath;
      }

      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await sb
        .from("transformation_photos")
        .insert({
          subject_id: subjectId,
          angle,
          storage_path: path,
          original_path: originalPath,
          cleaned: !!cleaned,
          byte_size: small.size,
          created_by: auth.user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;

      onStep?.("checking");

      const verify = await queuedVerify((data as TransformPhoto).id);
      // A free-tier 429 leaves the row as `pending` — keep the upload successful
      // and let the coach tap Re-check. Only real failures throw.
      if (verify.error && !verify.retryable) throw new Error(verify.error);

      const { data: fresh } = await sb.from("transformation_photos").select("*").eq("id", (data as any).id).single();
      return fresh as TransformPhoto;
    },

    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["v2", "transform", "photos", row.subject_id] });
    },
  });
}

/** Re-run the photo check on a photo left `pending` by the free-tier limit. */
export function useRecheckPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: TransformPhoto): Promise<TransformPhoto> => {
      const verify = await queuedVerify(photo.id);
      if (verify.error) throw new Error(verify.error);
      const { data: fresh } = await sb.from("transformation_photos").select("*").eq("id", photo.id).single();
      return fresh as TransformPhoto;
    },
    onSettled: (_d, _e, photo) =>
      qc.invalidateQueries({ queryKey: ["v2", "transform", "photos", photo.subject_id] }),
  });
}

/** Staff override: keep a hard-failed photo and use it anyway. */
export function useOverridePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: TransformPhoto): Promise<TransformPhoto> => {
      const { data, error } = await supabase.functions.invoke("override-photo", {
        body: { photoId: photo.id },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const { data: fresh } = await sb.from("transformation_photos").select("*").eq("id", photo.id).single();
      return fresh as TransformPhoto;
    },
    onSettled: (_d, _e, photo) =>
      qc.invalidateQueries({ queryKey: ["v2", "transform", "photos", photo.subject_id] }),
  });
}


export function useDeletePhoto() {

  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: TransformPhoto) => {
      await supabase.storage
        .from(BUCKET)
        .remove([photo.storage_path, ...(photo.original_path ? [photo.original_path] : [])]);
      const { error } = await sb.from("transformation_photos").delete().eq("id", photo.id);
      if (error) throw error;
      return photo;
    },
    onSuccess: (photo) => qc.invalidateQueries({ queryKey: ["v2", "transform", "photos", photo.subject_id] }),
  });
}

/** Short-lived signed URL for a private object. */
export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

/* -------------------------------- plans ------------------------------- */

export function useSubjectPlan(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "plan", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<TransformPlan | null> => {
      const { data, error } = await sb
        .from("transformation_plans")
        .select("*")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      return { ...row, variables: { ...DEFAULT_VARIABLES, ...(row.variables ?? {}) } } as TransformPlan;
    },
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subjectId,
      planId,
      variables,
    }: {
      subjectId: string;
      planId?: string | null;
      variables: PlanVariables | SimplePlan;
    }): Promise<TransformPlan> => {
      const { data: auth } = await supabase.auth.getUser();
      if (planId) {
        const { data, error } = await sb
          .from("transformation_plans")
          .update({ variables })
          .eq("id", planId)
          .select("*")
          .single();
        if (error) throw error;
        return data as TransformPlan;
      }
      const { data, error } = await sb
        .from("transformation_plans")
        .insert({ subject_id: subjectId, variables, created_by: auth.user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data as TransformPlan;
    },
    onSuccess: (row) => qc.invalidateQueries({ queryKey: ["v2", "transform", "plan", row.subject_id] }),
  });
}

/* ------------------------------- renders ------------------------------ */

export function usePlanRenders(planId: string | null | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "renders", planId],
    enabled: !!planId,
    refetchInterval: (q) => {
      const rows = (q.state.data ?? []) as TransformRender[];
      return rows.some((r) => r.status === "queued" || r.status === "running") ? 4000 : false;
    },
    queryFn: async (): Promise<TransformRender[]> => {
      const { data, error } = await sb
        .from("transformation_renders")
        .select("*")
        .eq("plan_id", planId)
        .eq("path", PATH)
        .order("week", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as TransformRender[];
      // Higgsfield generations can outlive the generate-render time budget; nudge
      // them to completion from the client, which already polls this query.
      for (const r of rows) {
        if (r.status === "running" && r.provider === "higgsfield" && r.provider_request_id) {
          supabase.functions.invoke("render-poll", { body: { renderId: r.id } }).catch(() => {});
        }
      }
      return rows;
    },
  });
}

export function useGenerateRenders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      photoId,
      describe,
      weeks = KEY_RENDER_WEEKS as unknown as number[],
    }: {
      planId: string;
      photoId: string;
      describe: (week: number) => string;
      weeks?: number[];
    }) => {
      const rows = weeks.map((week) => ({ plan_id: planId, week, path: PATH, status: "queued" }));
      const { data: upserted, error } = await sb
        .from("transformation_renders")
        .upsert(rows, { onConflict: "plan_id,week,path" })
        .select("*");
      if (error) throw error;

      const targets = (upserted ?? []) as TransformRender[];
      const failures: string[] = [];
      let quotaHit = false;
      // Strictly one render at a time per subject: the free tier is per-minute limited.
      for (const r of targets) {
        if (quotaHit) break;
        const outcome = await invokeRender(r, photoId, describe(r.week));
        if (outcome.retryable) quotaHit = true;
        if (outcome.error) failures.push(`Week ${r.week}: ${outcome.error}`);
        qc.invalidateQueries({ queryKey: ["v2", "transform", "renders", planId] });
        // Gentle spacing between calls to stay inside the free per-minute quota.
        if (!quotaHit) await sleep(1500);
      }
      if (failures.length === targets.length && failures.length > 0) throw new Error(failures[0]);
      return { failures, quotaHit };
    },
    onSettled: (_d, _e, vars) =>
      qc.invalidateQueries({ queryKey: ["v2", "transform", "renders", vars?.planId] }),
  });
}

/** Retry a single render (used by the quota chip's Retry button). */
export function useRetryRender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      render,
      photoId,
      description,
    }: {
      render: TransformRender;
      photoId: string;
      description: string;
    }) => invokeRender(render, photoId, description),
    onSettled: (_d, _e, vars) =>
      qc.invalidateQueries({ queryKey: ["v2", "transform", "renders", vars?.render.plan_id] }),
  });
}

async function invokeRender(render: TransformRender, photoId: string, description: string) {
  // Exponential backoff across attempts within a single run.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error: fnErr } = await supabase.functions.invoke("generate-render", {
      body: { renderId: render.id, photoId, description },
    });
    const payload = data as any;
    const msg = payload?.error ?? fnErr?.message ?? null;
    const retryable = payload?.retryable === true || /429|quota|RESOURCE_EXHAUSTED/i.test(msg ?? "");
    if (!msg) return { error: null as string | null, retryable: false };
    if (!retryable) return { error: msg as string, retryable: false };
    if (attempt < 2) await sleep(2000 * 2 ** attempt);
    else return { error: "Free-tier quota reached — resumes automatically", retryable: true };
  }
  return { error: null as string | null, retryable: false };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface TransformStatus {
  ok: boolean;
  provider: string;
  verify_ok: boolean;
  render_provider: string;
  higgsfield_credits: number | null;
  error: string | null;
}

/** Is the AI provider configured? Drives the status line on the Transform tab. */
export function useTransformStatus() {
  return useQuery({
    queryKey: ["v2", "transform", "status"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TransformStatus> => {
      const { data, error } = await supabase.functions.invoke("transform-status", { body: {} });
      if (error) {
        return { ok: false, provider: "none", verify_ok: false, render_provider: "none", higgsfield_credits: null, error: error.message };
      }
      const d = data as any;
      return {
        ok: !!d?.ok,
        provider: d?.provider ?? "none",
        verify_ok: d?.verify_ok ?? !!d?.ok,
        render_provider: d?.render_provider ?? "none",
        higgsfield_credits: typeof d?.higgsfield_credits === "number" ? d.higgsfield_credits : null,
        error: d?.error ?? null,
      };
    },
  });
}


/* ---------------------------- commitments ----------------------------- */

export function useCommitment(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "commitment", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<TransformCommitment | null> => {
      const { data, error } = await sb
        .from("transformation_commitments")
        .select("*")
        .eq("subject_id", subjectId)
        .order("committed_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as TransformCommitment | null;
    },
  });
}

export function useCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ subjectId, planId, notes }: { subjectId: string; planId: string | null; notes?: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await sb
        .from("transformation_commitments")
        .insert({ subject_id: subjectId, plan_id: planId, notes: notes ?? null, committed_by: auth.user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data as TransformCommitment;
    },
    onSuccess: (row) => qc.invalidateQueries({ queryKey: ["v2", "transform", "commitment", row.subject_id] }),
  });
}

/* ------------------------------ check-ins ----------------------------- */

export function useSubjectCheckins(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "checkins", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<TransformCheckin[]> => {
      const { data, error } = await sb
        .from("transformation_checkins")
        .select("*")
        .eq("subject_id", subjectId)
        .order("measured_on", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TransformCheckin[];
    },
  });
}

export function useAddCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<TransformCheckin> & { subject_id: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await sb
        .from("transformation_checkins")
        .insert({ ...row, created_by: auth.user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data as TransformCheckin;
    },
    onSuccess: (row) => qc.invalidateQueries({ queryKey: ["v2", "transform", "checkins", row.subject_id] }),
  });
}

/** Transformation record linked to a member, used by the coach on-track card. */
export function useSubjectForMember(memberId: string | null | undefined) {
  return useQuery({
    queryKey: ["v2", "transform", "by-member", memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<TransformSubject | null> => {
      const { data, error } = await sb
        .from("transformation_subjects")
        .select("*")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as TransformSubject | null;
    },
  });
}
