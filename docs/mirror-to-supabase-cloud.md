# Mirroring the platform into your own Supabase Cloud project

This produces a point-in-time copy of the current backend in a Supabase
project you own. Nothing in this procedure writes to, restarts, or holds
connections against the Lovable Cloud database — the schema is rebuilt from
artefacts committed in this repository, and data comes from an export file
you download yourself.

## What gets copied

| Layer | Source | Mechanism |
|---|---|---|
| Public schema (tables, views, functions, enums, triggers) | `supabase/baseline/schema.sql` + post-cutoff migrations | `scripts/mirror/bootstrap-external-supabase.sh` |
| Table data | Lovable Cloud → Advanced settings → **Export data** | `scripts/mirror/load-export-csvs.sh` |
| Auth users | Same export bundle (`auth.users`) | Same loader |
| Storage objects | Export bundle / bucket download | Manual re-upload |
| Edge functions | `supabase/functions/` | `supabase functions deploy` |
| Secrets | Not exportable | Re-enter in the new project |

## Steps

### 1. Create the destination project

Create an empty project in Supabase Cloud. Pick a region and a compute size
at least as large as the current one — the schema has ~1,540 public tables.
Copy its direct connection string (port 5432, not the pooler; the baseline
uses session-level DDL).

### 2. Build the schema

```bash
TARGET_DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
  DRY_RUN=1 scripts/mirror/bootstrap-external-supabase.sh   # review the plan

TARGET_DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
  scripts/mirror/bootstrap-external-supabase.sh
```

The script refuses to run if the URL points at the source project. It
verifies the baseline SHA-256 against `baseline_manifest.json`, applies the
baseline, then applies every migration after the cutoff in filename order,
recording each in `supabase_migrations.schema_migrations` so re-runs are
resumable. Logs land in `/tmp/mirror-bootstrap/`.

It finishes by printing table / view / function / enum counts. Expect
roughly 1,540 tables, 85 views, 1,253 functions, 93 enums plus anything
added by post-cutoff migrations.

### 3. Export the data

In Lovable Cloud → Advanced settings → **Export data**. That page is the
only supported full-data export; it is read-only and safe to run. Unzip the
bundle to a directory of CSVs.

### 4. Load the data

```bash
TARGET_DATABASE_URL='postgresql://...' \
  scripts/mirror/load-export-csvs.sh /path/to/export-dir
```

The loader disables trigger/FK enforcement for the duration of each copy
(`session_replication_role = replica`), so table order does not matter, then
resets every identity sequence to the maximum loaded value. Tables missing
in the target are skipped and reported; failures are listed at the end so
you can re-run only those. Pass `TRUNCATE=1` to re-load over existing rows.

### 5. Edge functions and secrets

```bash
supabase link --project-ref <new-ref>
supabase functions deploy --project-ref <new-ref>
```

Then re-enter every secret in the new project's function settings. Secret
*values* cannot be read out of Lovable Cloud — you need the originals from
the issuing providers (Resend, Twilio, and so on). The service role key and
database password of the source project are not retrievable at all.

### 6. Point an app at the mirror

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the new
project's values in whatever deployment you want to run against the mirror.
Do not change `.env` in this repository — it is managed by Lovable Cloud and
would repoint the live app.

## Important caveats

- **Snapshot, not a sync.** Re-running steps 3–4 refreshes the copy; there is
  no continuous replication.
- **RLS.** This project deliberately runs without RLS
  (`docs/ARCHITECTURE-NO-RLS-RULE.md`). The mirror inherits that, so its
  anon key is as privileged as the source's. Keep the project private.
- **Cron jobs.** `pg_cron` schedules are not carried by the baseline. Re-create
  only the jobs you actually want running in the mirror; leaving them off is
  the safer default for a backup copy.
- **Auth passwords.** Password hashes come across in the `auth.users` export,
  but OAuth provider configuration must be re-entered by hand.
