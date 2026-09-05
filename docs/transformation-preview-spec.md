# Arena Fitness — Transformation module

A staff-only tool inside the **Arena Fitness app** admin section with two jobs:

1. **Sales consult** — a trainer or salesperson photographs a prospect, configures their
   program variables, and shows AI-generated projections of what they will look like over
   time **if they stick to the plan — versus if they fall off**. It is the visual "proof"
   step that complements the Arena Fitness **Game Plan Builder** sales flow.
2. **On-track coaching** — once the person is a member, their real check-ins (weight,
   body-fat, progress photos) are compared against the projection curve so coaches can see
   whether they are on track to their goal.

- **Lovable project:** `arenafitness` (`bce91d22-6c67-4f36-9376-a3bffbd062d3`)
  - Editor: https://lovable.dev/projects/bce91d22-6c67-4f36-9376-a3bffbd062d3
  - Live: https://arenafitness.lovable.app
- **Where:** V2 admin — new **Transform** tab on `/v2/admin`, a **TRANSFORMATION** section on
  `/v2/admin/members/:id`, an on-track card on the coach view, and routes under
  `/v2/admin/transform/*`. Code lives in `src/v2/transform/`.
- **Backend:** the app's existing Supabase (Postgres, Auth, private Storage, Edge
  Functions). Google Sheets / webhook data flows are untouched.
- **AI:** vision model for photo verification; image-editing model for transformation
  renders (via the project's configured AI provider — Gemini image editing if no gateway is
  set up).

> History: a standalone prototype (`407e4944-…`) was started in a free Lovable workspace and
> ran out of credits; the module was then rebuilt inside `arenafitness` instead.

---

## 1. Sales-flow fit

The Game Plan Builder walks a prospect through beliefs → plan → pricing. Transformation
Preview slots in as the emotional close: after the plan variables are agreed, the coach
steps through weeks 8 → 20 and shows the prospect *themselves* sticking to the plan. There
is deliberately **no "fell off" path**: the tool only ever shows what we want the client to
do. The reveal screen ends in a red **LOCK IN THE PLAN** CTA that records commitment.

Program lengths mirror the real programs (6- and 8-week blocks, auto-renew assumption for
longer horizons).

## 2. Branding (from the Game Plan Builder code block)

| Token | Value | Use |
|---|---|---|
| `--red` | `#CD0506` | Primary, CTAs, active chips/tabs |
| `--red-dk` | `#9c0405` | Hover |
| `--yel` | `#FAFF00` | Kickers, totals, reveal outline buttons |
| `--black` | `#0c0c0d` | Page background |
| `--ink` | `#141416` | Header / dock |
| `--panel` / `--panel-2` | `#1a1a1d` / `#212125` | Cards / insets |
| `--line` | `rgba(255,255,255,.10)` | 1–1.5px hairlines |
| `--muted` | `#a7a7ad` | Secondary text |
| `--ok` | `#3fbf6a` | Success / done states |

Type: **Barlow Condensed** 600–800 UPPERCASE for display/headings/numbers/buttons;
**Noto Sans** 400–700 for body. Cards 14–18px radius, pills 30px, sticky bottom dock with
3px red top border, yellow uppercase kicker labels (letter-spacing ≥ .18em). Dark theme only.

## 3. Core flow

1. **Client intake** — name, age, sex, height, weight, body-fat band (visual picker), goal
   (cut / recomp / build), program length (6 or 8 weeks), **photo-consent checkbox
   (required, timestamped)**.
2. **Photo capture** — front (required), side, back; pose-guidance overlay (full body in
   frame, arms slightly out, even lighting, progress-photo clothing).
3. **Photo verification — blocking.** See §6.
4. **Plan variables** — see §4. Live chart of projected weight + body-fat over weeks.
5. **Generate projections** — renders at weeks **8, 12, 16, 20** on the plan (one button,
   one path). Superseded history: the first cut rendered 6/12/18/24/36/48/60 on ON PLAN and
   FELL OFF; both the long horizon and the fell-off path were dropped (see the changelog).
6. **The Reveal** — real photo left, projection right, W8/W12/W16/W20 chips. Stat tiles
   (weight, BF%, lean mass, waist estimate) update with the selected week. Sticky dock:
   "THIS IS YOU AT WEEK {n}" + **LOCK IN THE PLAN**.
7. **Client list / history** — status chips (photo verified, renders ready, committed);
   any reveal can be reopened.

## 4. Plan variables

Numeric:

| Variable | Range | Notes |
|---|---|---|
| Workouts / week | 0–7 stepper | |
| Session effort | Coasting / Working / All-out chips | |
| Daily steps | 2,000–15,000 slider | |
| Protein | 0.4–1.2 g/lb slider | grams/day computed & shown |
| Calorie adherence | 50–100% slider | of prescribed deficit/surplus |
| Sleep | 5–9 h slider | |
| Alcohol | 0–15 drinks/week | |
| Cardio | 0–5 sessions/week | |
| Consistency | 50–100% slider | sessions actually attended |

Toggles (legacy slider engine only — not shown in the simplified UI):

- Tracks food in an app
- Weekly coach check-ins
- Meal preps
- Weekend drop-off (adherence −25% Fri–Sun)
- "Stops training after week N" (week picker)

## 5. Projection engine

Deterministic, pure TypeScript, unit-tested — **AI is never used for the numbers**, only
for images and photo verification. Conservative heuristics:

- Sustainable fat loss 0.5–1% bodyweight/week, scaled by calorie adherence, consistency,
  steps, and alcohol penalty.
- Lean gain ~1–2 lb/month for novices, scaled by protein, effort, sleep; tapering with
  training age.
- Only the ON PLAN path is projected. The legacy "stops training after week N" toggle still
  decays progress back toward baseline (fat regain faster than muscle loss) for that case.
- Output per timepoint: weight, body-fat %, lean mass, waist estimate → drives both the
  stat tiles and the image-edit prompt for that week.

## 6. Photo-verification agent (blocking)

Edge function `verify-photo` sends each upload to a vision model and returns:

```json
{ "passed": false, "score": 62,
  "checks": [{ "name": "full_body", "passed": false, "reason": "feet cropped" }],
  "retake_guidance": "Step back so head and feet are both in frame." }
```

Checks: real photograph (not AI-generated / heavily filtered / a re-photographed screen);
exactly one person; full body head-to-feet; standing pose facing camera; adequate lighting
and sharpness; plausibly an adult matching intake. **Failed photos cannot proceed to
projections**; the app shows the failed checks with specific retake guidance. The full
report is stored on the photo record.

## 7. Render pipeline

- Only the **verified front photo** is ever sent to the image model.
- Prompt template preserves identity: same person, face, hair, clothing, background,
  framing, lighting — only body composition changes, parameterised by the engine's numbers
  for that week/path.
- Queue via edge function: `queued → processing → done | failed` with retry; progress
  indicator in the UI.
- 4 timepoints × 1 path = 4 renders per client (weeks 8, 12, 16, 20 on plan).

## 8. On-track status (coaching half)

- **Subjects can be prospects or members.** `transformation_subjects` carries a nullable
  `member_id`; a consult can run before the person has an account, and "Link to member"
  attaches it later. From then on the on-track logic reads that member's real data.
- **Check-ins** (`/v2/admin/transform/:subjectId/checkin`): dated weight + body-fat entries
  written to the existing `body_metrics` table (source `transformation`) when linked to a
  member, otherwise to `transformation_checkins`; optional progress photo that also passes
  through `verify-photo`. Trend maths comes from the existing `v_body_metrics_trend` view.
- **Status engine** (`src/v2/transform/onTrack.ts`, unit-tested):
  weeks elapsed since commitment → expected weight / body-fat at that week from the ON PLAN
  series → actual from the latest 7-day averages. Score = achieved change ÷ expected change.

  | Status | Score |
  |---|---|
  | AHEAD | ≥ 1.15 |
  | ON TRACK | 0.8 – 1.15 |
  | BEHIND | 0.4 – 0.8 |
  | OFF PLAN | < 0.4 |
  | NO CHECK-IN | last data point older than 14 days |

  Also: `% to goal` (goal = ON PLAN value at program end week) and a one-line coach nudge.
- **On-track card** (member admin page, coach view, Transform list chips): status chip, big
  % to goal, projected-vs-actual mini chart (real trend over the ON PLAN curve),
  and a **projected vs actual** photo pair — the week-N render beside the nearest real
  check-in photo.

## 9. Data model

```
transformation_subjects     (org_id, member_id?, first_name, last_name, email, phone, age, sex,
                             height_cm, weight_lb, bf_band, goal, program_length_weeks,
                             consent_at, created_by)
transformation_photos       (subject_id, angle, storage_path, status, verification jsonb, taken_on)
transformation_plans        (subject_id, variables jsonb, created_by)
transformation_renders      (plan_id, week, path, storage_path, status, error, model)
transformation_commitments  (subject_id, plan_id, committed_at, committed_by, notes)
transformation_checkins     (subject_id, measured_on, weight, body_fat_pct, photo_id?)
```

RLS: staff/admin of the org (existing `has_role` / `user_location_roles` helpers) read and
write; athletes have no access in this phase. Photos and renders live in the **private**
`transformation-media` bucket, served by short-lived signed URLs only.

## 10. Guardrails

- Fixed disclaimer on every projection view: *"Illustrative projection based on your
  inputs — not a guarantee of results."*
- Staff auth only (email/password, auto-confirm); no public signup links in the consult
  flow — the app runs on a gym tablet.
- Client consent is captured before any photo is taken and stored with a timestamp.

## 11. Running cost: free tier by design

- **AI:** direct Google Gemini API using a `GEMINI_API_KEY` created in Google AI Studio under
  the gym's Google account (info@ / train@archersarena.com). Only free-tier-eligible Flash
  models: a Flash vision model for `verify-photo`, the Flash **Image** model for
  `generate-render`. Model ids are configurable via `GEMINI_VISION_MODEL` /
  `GEMINI_IMAGE_MODEL`. The Lovable AI gateway is a fallback only when no Gemini key is set.
- **Quota-aware queue:** one render at a time per subject; 429 / RESOURCE_EXHAUSTED sets the
  render back to `queued` with `retry_after` and exponential backoff (never `failed`), with a
  "Free-tier quota reached — resumes automatically" chip.
- **Render set:** weeks 8, 12, 16, 20 on plan (4 renders) via one "Generate photos" button.
  Weeks without a render show the free SVG illustration.
- **Storage:** photos compressed client-side (max 1280 px, JPEG ~0.82) before upload so the
  existing Supabase free-tier storage suffices.
- **Only unavoidable cost:** Lovable build credits while iterating on the app itself.

### Secrets (Lovable project → Settings → Secrets)

| Secret | Required | Default / notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | From Google AI Studio under info@ / train@archersarena.com |
| `GEMINI_VISION_MODEL` | no | `gemini-flash-latest` (photo verification) |
| `GEMINI_IMAGE_MODEL` | no | `gemini-flash-image-latest` (renders; currently Gemini 3.1 Flash Image) |

Edge functions: `verify-photo`, `generate-render`, `transform-status`, shared client in
`supabase/functions/_shared/gemini.ts`. Build state: commit `8caaae3` in the arenafitness
Lovable project; typecheck, `vite build`, and vitest (17/17) passing.

### Render provider order (commit `bba397f`)

1. **Higgsfield** (Ultra plan credits) when `HIGGSFIELD_API_KEY_ID` + `HIGGSFIELD_API_KEY_SECRET`
   are set. Optional `HIGGSFIELD_IMAGE_MODEL` (default `nano-banana-pro`, auto-falls back to
   `nano-banana`; `flux-pro/kontext/max/text-to-image` also works). Source photo is passed as a
   10-minute signed URL; long jobs finish via the `render-poll` edge function.
2. **Gemini** (`GEMINI_API_KEY`) — free tier for verification; image renders only if Google's
   image model has a free API tier for the key (paid-only reported since mid-2026).
3. Lovable AI gateway — last resort, paid.

`verify-photo` always uses Gemini (`GEMINI_API_KEY` is required in every setup). Cost check:
Nano Banana Pro edit ≈ 2 Higgsfield credits per render → 6-render core set ≈ 12 credits.

### Free + Higgsfield hybrid (commit `aac9abc`)

- `src/v2/transform/BodyMorph.tsx`: free, offline SVG body illustration driven by the engine
  (body-fat → torso/waist/hip/limb width and softness; lean mass → shoulders/chest/arms/quads;
  waist estimate; weight; sex; height), 250 ms transitions, dashed week-0 ghost outline and a
  delta caption. Shown for every slider week; a Higgsfield photo edit replaces it only for weeks
  with a ready render ("AI photo edit" vs "Illustration" badge). Compare toggle shows both paths.
- Defaults at the time: `KEY_RENDER_WEEKS = [12]` (week 12 on-plan + fell-off = 2 renders ≈
  4 credits); other weeks on demand. `CREDITS_PER_RENDER = 2`, `creditsFor()` helper,
  unit-tested. Superseded by the simplified plan below.
- Photo upload UX fix (commit `f92e535`): consent checkbox row inside PHOTOS, buttons never
  silently disabled, Take photo / Choose from gallery inputs, compressing → uploading →
  checking progress line.

### Higgsfield live (commit `ef7a4e5`)

- Secrets installed: `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET` (auth verified: status
  probe returns 404, not 401/403). Also installed: `GEMINI_API_KEY` (verification, free tier).
- Endpoint verified against Higgsfield's live OpenAPI spec: `POST https://api.higgsfield.ai/nano-banana`
  with `{prompt, num_images: 1, aspect_ratio: "auto", output_format: "jpeg",
  input_images: [{type: "image_url", image_url: <10-min signed URL>}]}`; there is no
  `nano-banana-pro` path, and no balance endpoint (the UI cannot show remaining credits).

### Photo capture hardening (commits `5d55fdc`, `7e8330f`, `f638f80`)

- **In-app camera** (`CameraCapture.tsx`): full-screen getUserMedia view with a red silhouette
  guide per angle, "Top of head here" / "Feet here" lines, tips bar, Front/Side/Back pills,
  flip camera, 3-second self-timer, Use photo / Retake; native `capture` input as fallback.
- **Angle-aware verification**: front → square to camera, side → true profile, back → facing
  away; a stray sliver of hair at the edge no longer fails "full body". `detected_angle`
  auto-relabels a photo taken with the wrong pill selected (`relabelled_from` stored).
- **Quota resilience**: verify-photo retries 6/12/20 s, falls back to
  `gemini-flash-lite-latest`, leaves photos `pending` with a Re-check button; client spaces
  checks 15 s apart.
- **Auto clean-up** (`photoClean.ts`, `@imgly/background-removal`, ~25 MB model cached per
  device): person cut-out, auto-crop to 1200×1600 with 8 % headroom, neutral studio
  backdrop, auto-levels; before/after sheet (Use cleaned / Use original / Retake); original
  kept in `original_path`, `cleaned` flag; edge-touch warning when head/feet were cropped.
- Exercises list: grid items get `min-width: 0` so rows fit phone screens; sort control on
  its own line.

### Verification is advisory (commit `876f0f8`)

- Hard blocks only: no single person, head/feet genuinely cut off, severe blur. Everything else
  (lighting, background, filters, obstruction, angle) is an amber warning on a verified photo.
- **Use anyway** override on blocked photos via the staff-only `override-photo` edge function
  (`verification.override = true`); RLS unchanged.
- Clean-up can never block an upload: 20 s model / 25 s segmentation timeouts, Skip clean-up
  button, fail-fast on a blocked asset host, model preloaded on page mount, `device: "cpu"`.
  Asset host: `https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/`.

### Simplified plan and no fell-off path (2026-09-05)

- **One plan, four weeks.** Sliders and toggles are gone from the UI. `PLAN_PRESET` is
  1 lb/week for cut and recomp (recomp adds 0.15 lb lean/week) and 0.5 lb lean/week for build,
  over `PRESET_WEEKS = 20`, with hard floors of 10 % body fat (men) / 18 % (women) and 85 % of
  start weight. `RENDER_WEEKS = KEY_RENDER_WEEKS = [8, 12, 16, 20]`; one "Generate photos
  (weeks 8–20)" button.
- **Fell-off removed everywhere.** Owner's call: "there's no need to show them what we don't
  want them to do." `Projection` is `{ onPlan }` only, `PathKey = "on_plan"`, the On plan /
  Fell off / Compare pills and the "Also generate fell-off" button are gone, and
  `usePlanRenders` reads only `path = 'on_plan'`. The two queued `fell_off` rows were deleted.
  Ready-to-paste files live in `patches/arenafitness/remove-fell-off/` in this repo (apply via
  Lovable Dev Mode — no credits).
- **Redirect glitch fixed** (commit `3351f58` in the Lovable project): `useViewer` and
  `useIsOrgAdmin` reported `isLoading = false` while the user id was still unknown, so the
  subject page bounced to the feed. Both now treat "no user yet" as loading.
- **Render cost, measured on Higgsfield Ultra credits** (front photo, week-12 prompt):
  GPT Image 2 low 0.5 · Nano Banana / Nano Banana 2 lite / Seedream 1 · Nano Banana 2 /
  Flux Kontext 1.5 · Nano Banana Pro 2. Recommendation: Nano Banana → 4 credits per client.
- **Open blocker.** The app calls the Higgsfield *Cloud API*, whose developer wallet is
  separate from the Ultra subscription and currently empty (`not_enough_credits`). Options:
  top up at cloud.higgsfield.ai and set `HIGGSFIELD_IMAGE_MODEL=nano-banana`; enable billing on
  the Gemini key; or have Claude generate renders on Ultra credits and write them to Supabase.

