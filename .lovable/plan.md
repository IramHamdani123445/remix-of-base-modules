# Fix: Inspector Dashboard (/compliance/workbench/inspector) fails to load

## What I verified so far

- The route exists and lazily loads `src/pages/compliance/dashboards/InspectorDashboard.tsx`; the current build compiles cleanly ("build OK"), so this is not a compile error.
- The page reads data through two paths: direct table queries on `ce_follow_up_actions` (`inspectorWorkboardService`) and the `ce_inspector_workboard_analytics` function.
- Every table that function touches (`ce_follow_up_actions`, `ce_violations`, `ce_weekly_plans`, `ce_weekly_plan_items`, `ce_inspections`, `ce_risk_profiles`, `ce_violation_history`) exists, has read access for signed-in users, and has all the columns the function references — so a missing table/column is ruled out.
- Backend request logs show **no** calls to the inspector analytics function or the follow-up actions table around the time window I can see, and no server-side 500 responses. That means the page most likely fails *before* it fetches data (render-time crash or route/permission gate), rather than because a query returned an error.

The exact cause is therefore **not yet confirmed**. I could not reproduce it myself: the preview redirects to the login screen and I cannot sign in as `admin@secureserve.gov` on my own.

## Step 1 — Reproduce (first task)

Sign in as `admin@secureserve.gov` in the Lovable preview once; that hands me an authenticated session. I then open `/compliance/workbench/inspector` in a headless browser and capture:

- the exact on-screen message and where it comes from (error boundary vs. host response),
- console stack trace and the failing module/component,
- every network call the page makes and its status.

This pins the cause to one of: a render-time crash, the compliance route/permission gate, a failing data call, or a stale deployed asset.

## Step 2 — Fix the confirmed cause

Apply the minimal correction for whatever Step 1 shows. Likely shapes, in order of what the evidence points at:

- **Render crash** — guard the offending value in `InspectorDashboard.tsx` or the panels under `src/components/compliance/workboard/`.
- **Route gate** — correct the module mapping for `/workbench/inspector` (`CE_INSPECTOR_DASHBOARD`) or its role grants so an administrator resolves the module.
- **Data call** — fix the query or the `ce_inspector_workboard_analytics` function and re-verify with a live call.

No redesign of the page, no new backend objects unless the confirmed defect requires one.

## Step 3 — Make the failure non-fatal

Wrap the dashboard in the existing error-boundary pattern used elsewhere in the compliance workbench, and let each panel render its own "unavailable" state instead of taking the whole page down. A single failing metric should never blank the screen again.

## Step 4 — Verify

Reload the page as an administrator and as a field-inspector role, confirm it renders with a clean console, and confirm the build log is clean. I will report the actual root cause and the fix applied.
