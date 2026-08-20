# Arena Fitness — Transformation Preview

A trainer-operated sales tool for gym consultations. A coach photographs a prospective
client, configures their program variables, and the app shows AI-generated projections of
what the client will look like over time **if they stick to the plan — versus if they fall
off**. It is the visual "proof" step that complements the Arena Fitness **Game Plan
Builder** sales flow and shares its branding.

- **Lovable project:** `407e4944-8577-479d-9ef9-7fffe14273bd`
  - Editor: https://lovable.dev/projects/407e4944-8577-479d-9ef9-7fffe14273bd
  - Preview: https://id-preview--407e4944-8577-479d-9ef9-7fffe14273bd.lovable.app
- **Backend:** Lovable Cloud (Supabase — Postgres, Auth, private Storage, Edge Functions)
- **AI:** Lovable AI gateway — vision model for photo verification, image editing model for
  transformation renders

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

## 8. Data model

```
clients        (coach_id, name, age, sex, height_cm, weight_lb, bf_band, goal,
                program_length_weeks, consent_at)
client_photos  (client_id, angle, storage_path, verification jsonb, status)
plans          (client_id, variables jsonb)
projections    (plan_id, week, path, stats jsonb)
renders        (plan_id, week, path, storage_path, status, error)
commitments    (client_id, plan_id, committed_at, notes)
```

RLS scopes every table to the owning coach account. Photos and renders live in **private**
storage buckets, served by signed URLs only.

## 9. Guardrails

- Fixed disclaimer on every projection view: *"Illustrative projection based on your
  inputs — not a guarantee of results."*
- Staff auth only (email/password, auto-confirm); no public signup links in the consult
  flow — the app runs on a gym tablet.
- Client consent is captured before any photo is taken and stored with a timestamp.
