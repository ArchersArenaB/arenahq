import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, Check, Image as ImageIcon, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import V2Layout from "../V2Layout";
import { V2, headingFont } from "../theme";
import { ErrorState, Sheet, Skeleton, btn, cardStyle, field } from "../ui";
import { useViewer } from "../useViewer";
import {
  BF_BANDS,
  KEY_RENDER_WEEKS,
  PLAN_PRESET,
  RENDER_WEEKS,
  bandToBodyFat,
  clamp,
  creditsFor,
  projectSimple,
  renderDescription,
  toSimplePlan,
  type Baseline,
  type Goal,
  type SimplePlan,
  type Sex,
} from "./engine";
import BodyMorph from "./BodyMorph";
import CameraCapture from "./CameraCapture";
import { cleanPhoto, preloadPhotoTools, type CleanResult } from "./photoClean";

import { DISCLAIMER, type TransformPhoto, type TransformRender } from "./types";
import {
  useAddCheckin,
  useCommit,
  useCommitment,
  useDeletePhoto,
  useRecheckPhoto,
  useOverridePhoto,

  useGenerateRenders,
  usePlanRenders,
  useRetryRender,
  useSavePlan,
  useSaveSubject,
  useSignedUrl,
  useSubjectCheckins,
  useSubjectPhotos,
  useSubjectPlan,
  useTransformStatus,
  useTransformSubject,
  useUploadPhoto,
} from "./useTransform";


const CHECK_LABEL: Record<string, string> = {
  full_body_visible: "Full body in frame",
  single_person: "One person only",
  front_facing: "Facing the camera",
  side_profile: "Side profile",
  back_facing: "Facing away",
  adequate_lighting: "Good lighting",
  unobstructed_body: "Nothing blocking the body",
  in_focus: "Sharp focus",
  no_heavy_filter: "No filters",
};


function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "block", color: V2.muted, fontSize: 12, marginBottom: 6 }}>{children}</span>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>{children}</div>;
}

function TogglePill({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        minHeight: 44,
        padding: "0 14px",
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        background: on ? V2.red : V2.chip,
        color: on ? "#fff" : V2.text2,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function PhotoTile({
  photo,
  onDelete,
  onRecheck,
  rechecking,
  onOverride,
  overriding,
}: {
  photo: TransformPhoto;
  onDelete: () => void;
  onRecheck: () => void;
  rechecking: boolean;
  onOverride: () => void;
  overriding: boolean;
}) {
  const url = useSignedUrl(photo.storage_path);

  const checks = photo.verification?.checks ?? {};
  const HARD = ["single_person", "full_body_visible", "in_focus"];
  const failed = Object.entries(checks).filter(([k, v]) => v && v.pass === false && HARD.includes(k));
  const warned = Object.entries(checks).filter(([k, v]) => v && v.pass === false && !HARD.includes(k));

  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 84, height: 112, borderRadius: 10, background: V2.chip, overflow: "hidden", flex: "0 0 auto" }}>
          {url ? (
            <img src={url} alt={`${photo.angle} photo`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>{photo.angle}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 999,
                padding: "3px 9px",
                background: V2.chip,
                color: photo.status === "verified" ? V2.green : photo.status === "pending" ? V2.muted : V2.red,
              }}
            >
              {photo.status === "verified" ? "Verified" : photo.status === "pending" ? "Checking" : "Rejected"}
            </span>
          </div>
          {failed.length > 0 ? (
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", color: V2.text2, fontSize: 12 }}>
              {failed.map(([k, v]) => (
                <li key={k}>
                  {CHECK_LABEL[k] ?? k}
                  {v?.note ? ` — ${v.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {warned.length > 0 ? (
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", color: V2.amber, fontSize: 12 }}>
              {warned.map(([k, v]) => (
                <li key={k}>
                  {CHECK_LABEL[k] ?? k}
                  {v?.note ? ` — ${v.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {photo.verification?.guidance ? (
            <p style={{ color: V2.amber, fontSize: 12, margin: "8px 0 0" }}>{photo.verification.guidance}</p>
          ) : null}
          {photo.verification?.error ? (
            <p style={{ color: V2.red, fontSize: 12, margin: "8px 0 0" }}>{photo.verification.error}</p>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {photo.status === "pending" && photo.verification?.error ? (
              <button
                type="button"
                onClick={onRecheck}
                disabled={rechecking}
                style={{ ...btn(V2.red), marginTop: 10, minHeight: 44, fontSize: 13 }}
              >
                {rechecking ? "Checking photo…" : "Re-check"}
              </button>
            ) : null}
            {photo.status !== "verified" ? (
              <button
                type="button"
                onClick={onOverride}
                disabled={overriding}
                style={{ ...btn(V2.chip), marginTop: 10, minHeight: 44, fontSize: 13 }}
              >
                {overriding ? "Saving…" : "Use anyway"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDelete}
              style={{ ...btn(V2.chip), marginTop: 10, minHeight: 44, fontSize: 13 }}
              aria-label="Delete photo"
            >
              <Trash2 size={16} />
              Remove
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

function ImageBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: V2.text2,
        background: "rgba(0,0,0,.45)",
        borderRadius: 999,
        padding: "3px 8px",
      }}
    >
      {children}
    </span>
  );
}

/** The client's real verified photo. */
function PhotoPanel({ photo }: { photo: TransformPhoto | undefined }) {
  const url = useSignedUrl(photo?.storage_path);
  return (
    <div style={{ position: "relative", background: V2.chip, borderRadius: 12, overflow: "hidden", aspectRatio: "3/4" }}>
      {url ? (
        <img src={url} alt="Current photo" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 12 }}>
          <span style={{ color: V2.muted, fontSize: 12, textAlign: "center" }}>
            {photo ? "Loading photo…" : "No verified front photo yet."}
          </span>
        </div>
      )}
      <ImageBadge>Today</ImageBadge>
    </div>
  );
}

/** Higgsfield photo edit when one is ready for this exact week, otherwise the free illustration. */
function ProjectionPanel({
  render,
  baseline,
  start,
  point,
  onRetry,
}: {
  render: TransformRender | undefined;
  baseline: Baseline;
  start: import("./engine").WeekPoint;
  point: import("./engine").WeekPoint;
  onRetry?: () => void;
}) {
  const ready = render?.status === "ready" ? render : undefined;
  const url = useSignedUrl(ready?.storage_path);

  if (ready && url) {
    return (
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: V2.chip, aspectRatio: "3/4" }}>
        <img
          src={url}
          alt={`Week ${ready.week}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <ImageBadge>AI photo edit</ImageBadge>
      </div>
    );
  }

  return (
    <div>
      <BodyMorph baseline={baseline} start={start} point={point} label="Illustration" />
      {render && render.status === "queued" && render.retry_after ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ color: V2.amber, fontSize: 11, fontWeight: 600 }}>Quota reached — resumes automatically</span>
          {onRetry ? (
            <button type="button" style={{ ...btn(V2.chip), minHeight: 36, fontSize: 12 }} onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {render && (render.status === "queued" || render.status === "running") && !render.retry_after ? (
        <p style={{ color: V2.text2, fontSize: 11, margin: "6px 0 0" }}>Photo edit generating…</p>
      ) : null}
      {render?.status === "failed" ? (
        <p style={{ color: V2.red, fontSize: 11, margin: "6px 0 0" }}>{render.error ?? "Render failed"}</p>
      ) : null}
    </div>
  );
}


export default function V2TransformSubject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isStaff, staffLoading } = useViewer();

  const subject = useTransformSubject(id);
  const photos = useSubjectPhotos(id);
  const planQ = useSubjectPlan(id);
  const renders = usePlanRenders(planQ.data?.id);
  const commitment = useCommitment(id);
  const checkins = useSubjectCheckins(id);

  const saveSubject = useSaveSubject();
  const savePlan = useSavePlan();
  const upload = useUploadPhoto();
  const del = useDeletePhoto();
  const recheck = useRecheckPhoto();
  const override = useOverridePhoto();

  const generate = useGenerateRenders();
  const retryRender = useRetryRender();
  const commit = useCommit();
  const addCheckin = useAddCheckin();

  const aiStatus = useTransformStatus();

  const [plan, setPlan] = useState<SimplePlan>({ preset: "1lb_week", goal: "cut" });
  const [week, setWeek] = useState<number>(12);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [angle, setAngle] = useState<string>("front");
  const [step, setStep] = useState<"cleaning" | "compressing" | "uploading" | "checking" | null>(null);
  const [cleanNote, setCleanNote] = useState<string | null>(null);
  const [review, setReview] = useState<{
    original: File;
    originalUrl: string;
    clean: CleanResult | null;
    cleanUrl: string | null;
  } | null>(null);
  const [consentFlash, setConsentFlash] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const cleanAbort = useRef<AbortController | null>(null);

  // Warm the (large, cached) clean-up model up in the background.
  useEffect(() => {
    const t = setTimeout(() => preloadPhotoTools(), 1200);
    return () => clearTimeout(t);
  }, []);



  useEffect(() => {
    setPlan(toSimplePlan(planQ.data?.variables, ((subject.data?.goal as Goal) || "cut") as Goal));
  }, [planQ.data?.id, subject.data?.goal]);

  const s = subject.data;

  const baseline: Baseline | null = useMemo(() => {
    if (!s || !s.weight_lb) return null;
    const sex = ((s.sex as Sex) || "male") as Sex;
    return {
      weightLb: Number(s.weight_lb),
      bodyFatPct: bandToBodyFat(s.bf_band, sex),
      heightCm: s.height_cm ? Number(s.height_cm) : null,
      sex,
      age: s.age,
      goal: ((s.goal as Goal) || "recomp") as Goal,
    };
  }, [s]);

  const projection = useMemo(
    () => (baseline ? projectSimple(baseline, plan.goal) : null),
    [baseline, plan.goal],
  );

  if (staffLoading) {
    return (
      <V2Layout>
        <Skeleton height={220} />
      </V2Layout>
    );
  }
  if (!isStaff) {
    navigate("/v2/feed", { replace: true });
    return null;
  }
  if (subject.isLoading) {
    return (
      <V2Layout>
        <Skeleton height={120} />
      </V2Layout>
    );
  }
  if (subject.isError || !s) {
    return (
      <V2Layout>
        <ErrorState message="Could not load this transformation." onRetry={() => subject.refetch()} />
      </V2Layout>
    );
  }

  const verifiedFront = (photos.data ?? []).find((p) => p.angle === "front" && p.status === "verified");
  const allRenders = renders.data ?? [];
  const readyWeeks = Array.from(new Set(allRenders.filter((r) => r.status === "ready").map((r) => r.week))).sort(
    (a, b) => a - b,
  );
  const activeRender = allRenders.find((r) => r.week === week);
  const series = projection ? projection.onPlan : null;
  const point = series ? series[week] : null;
  const startPoint = projection ? projection.onPlan[0] : null;
  const credits = aiStatus.data?.higgsfield_credits ?? null;


  async function patch(p: Record<string, unknown>) {
    try {
      await saveSubject.mutateAsync({ id: s!.id, ...p });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function persistPlan(next: SimplePlan) {
    setPlan(next);
    try {
      await savePlan.mutateAsync({ subjectId: s!.id, planId: planQ.data?.id ?? null, variables: next });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  function requireConsent() {
    if (!s!.consent_at) {
      toast({
        title: "Record photo consent first",
        description: "Tick the consent box above.",
        variant: "destructive",
      });
      setConsentFlash(true);
      setTimeout(() => setConsentFlash(false), 1600);
      return false;
    }
    return true;
  }

  function openPicker(ref: React.RefObject<HTMLInputElement | null>) {
    if (!requireConsent()) return;
    ref.current?.click();
  }


  /** Step 1: clean the photo in the browser, then show the before/after sheet. */
  async function onFile(file: File | undefined) {
    if (!file) return;
    setStep("cleaning");
    setCleanNote("Preparing photo tools (first time on this device)…");
    const ac = new AbortController();
    cleanAbort.current = ac;
    let clean: CleanResult | null = null;
    try {
      clean = await cleanPhoto(
        file,
        (st) =>
          setCleanNote(
            st === "model" ? "Preparing photo tools (first time on this device)…" : "Cleaning photo…",
          ),
        {
          signal: ac.signal,
          onProgress: (text) => setCleanNote(text),
          onFallback: (reason) => console.warn("[transform] clean-up skipped:", reason),
        },
      );
    } catch {
      clean = null;
    }
    cleanAbort.current = null;
    setCleanNote(null);
    setStep(null);
    if (!clean) {
      toast({ title: "Auto clean-up skipped — using original photo" });
      void doUpload(file, null);
      return;
    }
    setReview({
      original: file,
      originalUrl: URL.createObjectURL(file),
      clean,
      cleanUrl: URL.createObjectURL(clean.file),
    });
  }

  function closeReview() {
    setReview((r) => {
      if (r) {
        URL.revokeObjectURL(r.originalUrl);
        if (r.cleanUrl) URL.revokeObjectURL(r.cleanUrl);
      }
      return null;
    });
  }

  /** Step 2: upload the chosen file (plus the original when cleaned). */
  async function doUpload(file: File, original: File | null) {
    try {
      const row = await upload.mutateAsync({
        subjectId: s!.id,
        angle,
        file,
        originalFile: original,
        cleaned: !!original,
        onStep: setStep,
      });
      const relabelled = row.verification?.relabelled_from;
      toast({
        title: relabelled
          ? `Saved as a ${row.angle} photo (it was labelled ${relabelled})`
          : row.status === "verified" ? "Photo verified" : row.status === "pending" ? "Photo saved" : "Photo rejected",
        description:
          row.status === "verified"
            ? "Ready for projections."
            : row.status === "pending"
              ? row.verification?.error ?? "Photo check delayed — tap Re-check."
              : row.verification?.guidance ?? "Retake the photo.",
        variant: row.status === "rejected" ? "destructive" : undefined,
      });

    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setStep(null);
    }
  }


  async function runRenders(weeks: number[]) {
    if (!verifiedFront || !baseline || !projection) return;
    let planId = planQ.data?.id ?? null;
    if (!planId) {
      const saved = await savePlan.mutateAsync({ subjectId: s!.id, variables: plan });
      planId = saved.id;
    }
    try {
      const res = await generate.mutateAsync({
        planId,
        photoId: verifiedFront.id,
        weeks,
        describe: (w) => renderDescription(baseline, projection.onPlan[w]),
      });
      if (res.quotaHit) {
        toast({
          title: "Free-tier quota reached",
          description: "Remaining images stay queued and resume automatically.",
        });
      } else if (res.failures.length) {
        toast({ title: "Some renders failed", description: res.failures[0], variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Render failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <V2Layout>
      <button
        type="button"
        onClick={() => navigate("/v2/admin")}
        style={{ ...btn("transparent", V2.text2), padding: 0, marginBottom: 6 }}
      >
        <ArrowLeft size={18} /> Admin
      </button>

      <h1 style={{ fontFamily: headingFont, fontSize: 26, fontWeight: 700, margin: "0 0 14px" }}>
        {[s.first_name, s.last_name].filter(Boolean).join(" ").toUpperCase() || "TRANSFORMATION"}
      </h1>

      {/* ------------------------------ Intake ------------------------------ */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 12px" }}>INTAKE</p>
        <Row>
          <div>
            <Label>First name</Label>
            <input
              defaultValue={s.first_name}
              onBlur={(e) => patch({ first_name: e.target.value })}
              style={{ ...field, minWidth: 0 }}
            />
          </div>
          <div>
            <Label>Last name</Label>
            <input
              defaultValue={s.last_name}
              onBlur={(e) => patch({ last_name: e.target.value })}
              style={{ ...field, minWidth: 0 }}
            />
          </div>
        </Row>
        <div style={{ height: 12 }} />
        <Row>
          <div>
            <Label>Age</Label>
            <input
              type="number"
              inputMode="numeric"
              defaultValue={s.age ?? ""}
              onBlur={(e) => patch({ age: e.target.value ? Number(e.target.value) : null })}
              style={{ ...field, minWidth: 0 }}
            />
          </div>
          <div>
            <Label>Sex</Label>
            <select
              defaultValue={s.sex ?? "male"}
              onChange={(e) => patch({ sex: e.target.value })}
              style={{ ...field, minWidth: 0 }}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
        </Row>
        <div style={{ height: 12 }} />
        <Row>
          <div>
            <Label>Height (cm)</Label>
            <input
              type="number"
              inputMode="decimal"
              defaultValue={s.height_cm ?? ""}
              onBlur={(e) => patch({ height_cm: e.target.value ? Number(e.target.value) : null })}
              style={{ ...field, minWidth: 0 }}
            />
          </div>
          <div>
            <Label>Weight (lb)</Label>
            <input
              type="number"
              inputMode="decimal"
              defaultValue={s.weight_lb ?? ""}
              onBlur={(e) => patch({ weight_lb: e.target.value ? Number(e.target.value) : null })}
              style={{ ...field, minWidth: 0 }}
            />
          </div>
        </Row>

        <div style={{ height: 12 }} />
        <Label>Body-fat band</Label>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {BF_BANDS.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => patch({ bf_band: b.key })}
              style={{
                flex: "0 0 auto",
                minHeight: 44,
                padding: "0 12px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                background: s.bf_band === b.key ? V2.red : V2.chip,
                color: s.bf_band === b.key ? "#fff" : V2.text2,
              }}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ height: 12 }} />
        <Row>
          <div>
            <Label>Goal</Label>
            <select defaultValue={s.goal} onChange={(e) => patch({ goal: e.target.value })} style={{ ...field, minWidth: 0 }}>
              <option value="cut">Lose fat</option>
              <option value="recomp">Recomp</option>
              <option value="build">Build muscle</option>
            </select>
          </div>
          <div>
            <Label>Program length</Label>
            <select
              defaultValue={String(s.program_length_weeks)}
              onChange={(e) => patch({ program_length_weeks: Number(e.target.value) })}
              style={{ ...field, minWidth: 0 }}
            >
              <option value="6">6 weeks</option>
              <option value="8">8 weeks</option>
            </select>
          </div>
        </Row>

      </div>

      {/* ------------------------------ Photos ------------------------------ */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 4px" }}>PHOTOS</p>
        <p style={{ color: V2.muted, fontSize: 12, margin: "0 0 12px" }}>
          A verified front photo is required before any projection image can be made.
        </p>

        <button
          type="button"
          onClick={() => patch({ consent_at: s.consent_at ? null : new Date().toISOString() })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            textAlign: "left",
            minHeight: 44,
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            background: consentFlash ? "rgba(205,5,6,.25)" : V2.chip,
            color: V2.text,
            marginBottom: 12,
            transition: "background .2s ease",
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              width: 24,
              height: 24,
              borderRadius: 6,
              background: s.consent_at ? V2.red : V2.dim,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {s.consent_at ? <Check size={16} color="#fff" /> : null}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.35 }}>
            Client consents to their photos being used to create AI projections
          </span>
        </button>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {["front", "side", "back"].map((a) => (
            <TogglePill key={a} on={angle === a} label={a[0].toUpperCase() + a.slice(1)} onChange={() => setAngle(a)} />
          ))}
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {showCamera ? (
          <CameraCapture
            angle={angle}
            onAngleChange={setAngle}
            onFile={(f) => void onFile(f)}
            onClose={() => setShowCamera(false)}
            onFallback={() => cameraRef.current?.click()}
          />
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          <button
            type="button"
            style={{ ...btn(V2.red), width: "100%" }}
            disabled={upload.isPending}
            onClick={() => {
              if (!requireConsent()) return;
              setShowCamera(true);
            }}
          >
            <Camera size={18} />
            {`Take ${angle} photo`}
          </button>

          <button
            type="button"
            style={{ ...btn(V2.chip), width: "100%" }}
            disabled={upload.isPending}
            onClick={() => openPicker(galleryRef)}
          >
            <ImageIcon size={18} />
            {`Choose ${angle} photo from gallery`}
          </button>
        </div>

        {step === "cleaning" ? (
          <button
            type="button"
            onClick={() => cleanAbort.current?.abort()}
            style={{ ...btn(V2.chip), marginTop: 10, minHeight: 44, fontSize: 13 }}
          >
            Skip clean-up
          </button>
        ) : null}

        {step ? (
          <p style={{ color: V2.text2, fontSize: 12, margin: "10px 0 0" }}>
            <span style={{ color: step === "cleaning" ? V2.text : V2.muted }}>
              {step === "cleaning" && cleanNote ? cleanNote : "Cleaning photo…"}
            </span>{" "}
            <span style={{ color: V2.muted }}>→</span>{" "}
            <span style={{ color: step === "compressing" ? V2.text : V2.muted }}>Compressing…</span>{" "}
            <span style={{ color: V2.muted }}>→</span>{" "}
            <span style={{ color: step === "uploading" ? V2.text : V2.muted }}>Uploading…</span>{" "}
            <span style={{ color: V2.muted }}>→</span>{" "}
            <span style={{ color: step === "checking" ? V2.text : V2.muted }}>Checking photo…</span>
          </p>
        ) : null}


        {review ? (
          <Sheet title="CHECK THE PHOTO" onClose={closeReview}>
            <div style={{ display: "grid", gap: 10 }}>
              {review.clean?.edgeTouch ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: "#F5A623",
                    background: "rgba(245,166,35,.12)",
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  Head or feet look cut off — the clean-up can’t add what isn’t in the photo. Retake if possible.
                </p>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: V2.muted }}>Original</span>
                  <img
                    src={review.originalUrl}
                    alt="Original"
                    style={{ width: "100%", borderRadius: 12, background: V2.chip }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: V2.muted }}>Cleaned</span>
                  {review.cleanUrl ? (
                    <img
                      src={review.cleanUrl}
                      alt="Cleaned"
                      style={{ width: "100%", borderRadius: 12, background: V2.chip }}
                    />
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                style={{ ...btn(V2.red), width: "100%" }}
                onClick={() => {
                  const r = review;
                  closeReview();
                  if (r?.clean) void doUpload(r.clean.file, r.original);
                }}
              >
                Use cleaned photo
              </button>
              <button
                type="button"
                style={{ ...btn(V2.chip), width: "100%" }}
                onClick={() => {
                  const r = review;
                  closeReview();
                  if (r) void doUpload(r.original, null);
                }}
              >
                Use original
              </button>
              <button
                type="button"
                style={{ ...btn("transparent", V2.text2), width: "100%" }}
                onClick={() => {
                  closeReview();
                  setShowCamera(true);
                }}
              >
                Retake / choose another
              </button>
            </div>
          </Sheet>
        ) : null}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {photos.isLoading ? (
            <Skeleton height={120} />
          ) : (
            (photos.data ?? []).map((p) => (
              <PhotoTile
                key={p.id}
                photo={p}
                onDelete={() => del.mutate(p)}
                rechecking={recheck.isPending && recheck.variables?.id === p.id}
                overriding={override.isPending && override.variables?.id === p.id}
                onOverride={() =>
                  override.mutate(p, {
                    onSuccess: () =>
                      toast({ title: "Using this photo — AI edits may be lower quality." }),
                    onError: (e: any) =>
                      toast({ variant: "destructive", title: "Could not use this photo", description: e?.message }),
                  })
                }
                onRecheck={() =>
                  recheck.mutate(p, {
                    onSuccess: (row) =>
                      toast({
                        title: row.verification?.relabelled_from
                          ? `Saved as a ${row.angle} photo (it was labelled ${row.verification.relabelled_from})`
                          : row.status === "verified" ? "Photo verified" : "Photo checked",
                        description: row.verification?.guidance || undefined,
                      }),
                    onError: (e: any) =>
                      toast({ variant: "destructive", title: "Photo check", description: e?.message ?? String(e) }),
                  })
                }
              />
            ))
          )}
        </div>
        <p style={{ color: V2.muted, fontSize: 12, margin: "10px 0 0" }}>
          Photo checks run on a free quota — if one is delayed, wait a moment and tap Re-check.
        </p>

      </div>

      {/* ------------------------------- Plan ------------------------------- */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 6px" }}>THE PLAN</p>
        <p style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
          {plan.goal === "build" ? PLAN_PRESET.buildLabel : PLAN_PRESET.label}
        </p>
        <p style={{ color: V2.text2, fontSize: 13, margin: "0 0 12px" }}>
          Training 3–4 times a week, protein at every meal, steps most days — the standard Arena plan over 20 weeks.
        </p>
        <Label>Goal</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["cut", "recomp", "build"] as const).map((g) => (
            <TogglePill
              key={g}
              on={plan.goal === g}
              label={g === "cut" ? "Lose fat" : g === "recomp" ? "Lose fat + tone" : "Build muscle"}
              onChange={() => persistPlan({ ...plan, goal: g })}
            />
          ))}
        </div>
      </div>


      {/* ---------------------------- Projection ---------------------------- */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 4px" }}>PROJECTION</p>
        <p style={{ color: V2.muted, fontSize: 12, margin: "0 0 10px" }}>
          What sticking to the plan looks like, week by week.
        </p>
        {!baseline || !projection || !series || !point || !startPoint ? (
          <p style={{ color: V2.amber, fontSize: 13, margin: "8px 0 0" }}>Add a starting weight to see projections.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, margin: "4px 0 12px" }}>
              {RENDER_WEEKS.map((w) => {
                const has = readyWeeks.includes(w);
                const on = week === w;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeek(w)}
                    style={{
                      height: 48,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 15,
                      fontWeight: 700,
                      background: on ? V2.red : V2.chip,
                      color: on ? "#fff" : has ? V2.text : V2.text2,
                    }}
                  >
                    W{w}
                    {has ? " ●" : ""}
                  </button>
                );
              })}
            </div>

            {/* real photo left · projection right */}
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <Label>Today</Label>
                <PhotoPanel photo={verifiedFront} />
              </div>
              <div>
                <Label>Week {week}</Label>
                <ProjectionPanel
                  render={activeRender}
                  baseline={baseline}
                  start={startPoint}
                  point={point}
                  onRetry={
                    activeRender && verifiedFront
                      ? () =>
                          retryRender.mutate({
                            render: activeRender,
                            photoId: verifiedFront.id,
                            description: renderDescription(baseline, series[activeRender.week]),
                          })
                      : undefined
                  }
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
              <div style={{ background: V2.chip, borderRadius: 12, padding: 12 }}>
                <Label>Weight</Label>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{point.weight} lb</span>
              </div>
              <div style={{ background: V2.chip, borderRadius: 12, padding: 12 }}>
                <Label>Body fat</Label>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{point.bodyFatPct}%</span>
              </div>
              <div style={{ background: V2.chip, borderRadius: 12, padding: 12 }}>
                <Label>Lean mass</Label>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{point.leanMass} lb</span>
              </div>
              <div style={{ background: V2.chip, borderRadius: 12, padding: 12 }}>
                <Label>Waist</Label>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{point.waistIn}"</span>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                style={{ ...btn(V2.red), width: "100%" }}
                disabled={!verifiedFront || generate.isPending}
                onClick={() => runRenders(KEY_RENDER_WEEKS as unknown as number[])}
              >
                {generate.isPending
                  ? "Generating…"
                  : `Generate photos (weeks 8–20) · ~${creditsFor(KEY_RENDER_WEEKS)} credits`}
              </button>
              {credits !== null ? (
                <p style={{ color: V2.text2, fontSize: 12, margin: 0 }}>Balance: {credits}</p>
              ) : null}
            </div>
            {!verifiedFront ? (
              <p style={{ color: V2.amber, fontSize: 12, margin: "8px 0 0" }}>
                A verified front photo is required before AI photo edits can be made — the illustration works without one.
              </p>
            ) : null}

            <p style={{ color: V2.muted, fontSize: 11, margin: "12px 0 24px" }}>{DISCLAIMER}</p>
          </>
        )}
      </div>


      {/* ----------------------------- Check-ins ---------------------------- */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 10px" }}>CHECK-INS</p>
        <CheckinForm
          onAdd={(weightLb, bodyFat) =>
            addCheckin.mutate(
              { subject_id: s.id, weight_lb: weightLb, body_fat_pct: bodyFat },
              {
                onError: (e) =>
                  toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
              },
            )
          }
        />
        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {(checkins.data ?? []).map((c) => (
            <div
              key={c.id}
              style={{ display: "flex", justifyContent: "space-between", background: V2.chip, borderRadius: 10, padding: "10px 12px" }}
            >
              <span style={{ color: V2.text2, fontSize: 13 }}>{c.measured_on}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {c.weight_lb ?? "—"} lb{c.body_fat_pct ? ` · ${c.body_fat_pct}%` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------------------- Commitment ---------------------------- */}
      <div style={{ ...cardStyle, marginBottom: 110 }}>
        <p style={{ fontFamily: headingFont, fontSize: 18, margin: "0 0 8px" }}>COMMITMENT</p>
        {commitment.data ? (
          <p style={{ color: V2.green, fontSize: 14, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={16} /> Committed on {commitment.data.committed_at.slice(0, 10)}
          </p>
        ) : (
          <button
            type="button"
            style={{ ...btn(V2.red), width: "100%" }}
            disabled={commit.isPending}
            onClick={() =>
              commit.mutate(
                { subjectId: s.id, planId: planQ.data?.id ?? null },
                {
                  onError: (e) =>
                    toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
                },
              )
            }
          >
            Lock in this plan
          </button>
        )}
      </div>

      {/* --------------------------- Sticky dock ---------------------------- */}
      {baseline ? (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(76px + env(safe-area-inset-bottom))",
            zIndex: 40,
            background: V2.card,
            borderTop: `3px solid ${V2.red}`,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontFamily: headingFont, fontSize: 16, flex: 1, minWidth: 0 }}>
            THIS IS YOU AT WEEK {week}
          </span>
          {commitment.data ? (
            <span style={{ color: V2.green, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Check size={16} /> Locked in
            </span>
          ) : (
            <button
              type="button"
              style={{ ...btn(V2.red), flex: "0 0 auto" }}
              disabled={commit.isPending}
              onClick={() =>
                commit.mutate(
                  { subjectId: s.id, planId: planQ.data?.id ?? null },
                  {
                    onError: (e) =>
                      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
                  },
                )
              }
            >
              LOCK IN THE PLAN
            </button>
          )}
        </div>
      ) : null}
    </V2Layout>

  );
}

function CheckinForm({ onAdd }: { onAdd: (weightLb: number | null, bodyFat: number | null) => void }) {
  const [weight, setWeight] = useState("");
  const [bf, setBf] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Row>
        <input
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="Weight (lb)"
          inputMode="decimal"
          style={{ ...field, minWidth: 0 }}
        />
        <input
          value={bf}
          onChange={(e) => setBf(e.target.value)}
          placeholder="Body fat %"
          inputMode="decimal"
          style={{ ...field, minWidth: 0 }}
        />
      </Row>
      <button
        type="button"
        style={{ ...btn(V2.chip), width: "100%" }}
        disabled={!weight && !bf}
        onClick={() => {
          onAdd(weight ? clamp(Number(weight), 50, 700) : null, bf ? clamp(Number(bf), 3, 70) : null);
          setWeight("");
          setBf("");
        }}
      >
        Add check-in
      </button>
    </div>
  );
}
