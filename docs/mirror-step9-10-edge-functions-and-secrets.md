# Mirror steps 9 & 10 — edge functions and secrets

Both steps need credentials that only the owner of the target project
holds (a personal access token, and the original values of every
provider secret). Nothing here touches the source project.

## Step 9 — deploy the edge functions

143 function directories live in `supabase/functions/` (plus `_shared`,
which is bundled automatically). `supabase/config.toml` already carries
the per-function `verify_jwt` flags, so deploying from this repository
reproduces the source configuration.

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
TARGET_PROJECT_REF=<target-ref> \
  scripts/mirror/deploy-edge-functions.sh
```

The script deploys one function at a time via `npx supabase@latest` with
`--use-api`, so bundling happens server-side and **no local Docker
daemon is required**. Each deploy logs to
`/tmp/mirror-functions/<name>.log`, and failures are listed at the end so
you can re-run just those:

```bash
SUPABASE_ACCESS_TOKEN=... TARGET_PROJECT_REF=... \
  scripts/mirror/deploy-edge-functions.sh fn-one fn-two
```

Set `SUPABASE_CLI_LOCAL=1` to use an already-installed `supabase` binary
instead of `npx` (it must be recent enough to support `--use-api`).

Functions will not work until step 10 is done — most read secrets at
startup.

## Step 10 — re-enter the secrets

Values cannot be exported from the source. Re-issue them from the
issuing provider or regenerate internal tokens. The names referenced by
the function code:

### Provider / third-party (re-issue from the provider)
- `RESEND_API_KEY`
- `OMNI_COMMS_RESEND_WEBHOOK_SECRET`
- `COMMUNICATION_HUB_RESEND_WEBHOOK_SECRET`
- `OMNI_COMMS_TWILIO_AUTH_TOKEN`
- `CLOUDFLARE_TURNSTILE_SECRET_KEY`
- `DMS_API_BASE_URL`, `DMS_API_KEY`
- `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`

### Internal shared secrets (generate fresh random values)
- `BN_AWARD_SUSPENSION_RUNNER_SECRET`
- `BN_COMMUNICATION_ADAPTER_SECRET`
- `BN_LIFE_CERTIFICATE_RUNNER_SECRET`
- `COMMUNICATION_HUB_DISPATCH_SECRET`
- `COMMUNICATION_HUB_SCHEDULER_SECRET`
- `COMM_HUB_DISPATCH_SECRET`
- `MANUAL_ADMIN_JWT` (only if manual admin tooling is used)

### Mode / configuration flags (copy the intended values)
- `COMMUNICATION_HUB_EMAIL_LIVE`, `COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST`
- `COMM_HUB_PROVIDER_MODE`, `COMM_HUB_REAL_EMAIL_TEST`
- `OMNI_COMMS_ENVIRONMENT_HINT`, `OMNI_COMMS_EDGE_REVISION`, `OMNI_COMMS_DEPLOYED_REVISION`
- `OTP_FROM_EMAIL`, `OTP_FROM_NAME`, `LEGAL_REPORTS_SENDER`
- `SSO_ALLOWED_ORIGINS`, `SSO_COOKIE_DOMAIN`
- `COMPLIANCE_UAT_ALLOW_PROD`, `COMPLIANCE_UAT_TEMP_PASSWORD`

### Cross-project references (point at the target, not the source)
- `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_ANON_KEY`
- `EXTERNAL_SUPABASE_ANON_KEY`, `SUPABASE_PROD`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform in every project — do not set them by hand.

> Safety note: while the mirror is a copy of production data, keep the
> live-sending flags off (`COMMUNICATION_HUB_EMAIL_LIVE=false`,
> `COMM_HUB_PROVIDER_MODE=sandbox`) so the mirror cannot email, SMS or
> call real citizens.

## Step 11 — parity checks after 9 and 10

1. Sign in on an app instance pointed at the target (passwords carried
   over in step 8).
2. Call one authenticated function (e.g. `resolve-auth-email`) and one
   scheduled one, and confirm 200s.
3. Open a signed storage URL from the target.
4. Re-create only the `pg_cron` jobs you actually want running in the
   mirror — off is the safer default for a backup copy.
