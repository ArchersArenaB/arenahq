# arenafitness patch: remove the "fell off" path

Drop-in replacements for five files in the `arenafitness` Lovable project
(`bce91d22-6c67-4f36-9376-a3bffbd062d3`). Each file here replaces the file at the
same path under the project root. Apply them without spending Lovable credits:

1. Open the project in Lovable → toggle **Dev Mode** (code view, no credits).
2. For each file below, open the same path and paste the whole contents over it.
3. Save. The preview rebuilds; run `vitest` from Dev Mode if you want the tests.

| File | What changed |
|---|---|
| `src/v2/transform/engine.ts` | `Projection` is `{ onPlan }` only; `PathKey = "on_plan"`; fell-off branches removed from `series()` and `presetSeries()`; `creditsFor(weeks)` no longer takes a path count. |
| `src/v2/transform/engine.test.ts` | Fell-off tests removed; new test asserts only `onPlan` is projected. |
| `src/v2/transform/types.ts` | `TransformRender.path` documented as `"on_plan"`. |
| `src/v2/transform/useTransform.ts` | `usePlanRenders` reads only `path = 'on_plan'`; `useGenerateRenders` takes `weeks` only and `describe(week)`. |
| `src/v2/transform/V2TransformSubject.tsx` | On plan / Fell off / Compare pills gone, the "Also generate fell-off" button gone, single "Generate photos (weeks 8–20)" button, projection card subtitle "What sticking to the plan looks like, week by week." |

Database: the two queued `fell_off` rows in `transformation_renders` were deleted on
2026-09-05 (no files existed for them). No schema change is needed — the `path` column
simply only ever receives `on_plan` now.
