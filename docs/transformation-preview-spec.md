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
scrubs the time slider and shows the prospect *themselves* at week 12 on the plan, then
flips to the "fell off" path. The reveal screen ends in a red **LOCK IN THE PLAN** CTA that
records commitment.

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
5. **Generate projections** — renders at weeks **6, 12, 18, 24, 36, 48, 60** on two paths
   (**ON PLAN**, **FELL OFF**). Weeks 6 & 12 render first so the consult starts fast; the
   rest queue in the background.
6. **The Reveal** — before/after viewer with a 0–60-week time slider that snaps to rendered
   timepoints and **crossfade-blends between adjacent renders** for in-between weeks. Path
   tabs swap ON PLAN / FELL OFF; compare mode shows both at the same week. Stat tiles
   (weight, BF%, lean mass, waist estimate) update with the slider. Sticky dock: "THIS IS
   YOU AT WEEK {n}" + **LOCK IN THE PLAN**.
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

Toggles (drop-off modelling):

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
- Drop-off paths decay progress back toward baseline (fat regain faster than muscle loss).
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
- 7 timepoints × 2 paths = 14 renders per client, generated progressively.

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
  % to goal, projected-vs-actual mini chart (real trend over the ON PLAN / FELL OFF curves),
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
- **Lean default render set:** weeks 6, 12, 24 × both paths (6 renders) via "Generate core
  set"; weeks 18/36/48/60 on demand via "Generate more". The slider crossfades between the
  renders that exist and greys out gaps.
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
