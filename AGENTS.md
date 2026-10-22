# AGENTS.md — rules for any AI / developer working in this repo

> ภาษาไทยสรุป: ไฟล์นี้คือกติกาสำหรับ AI หรือนักพัฒนาทุกคนที่แก้โค้ดใน repo นี้ อ่านให้ครบก่อนเริ่มงาน
> ระบบเก็บข้อมูลการเงินจริงของครอบครัว — ความถูกต้องและความปลอดภัยสำคัญกว่าความเร็ว

**Family Wealth Vault** — a single-family net-worth app.
Stack: Next.js 15 (App Router, server actions, Tailwind) on Vercel · Supabase (Postgres + RLS + Edge Functions + Vault) · Google Drive (documents).
The owner/operator is **not a programmer**: every change must be explained in plain Thai, with exact click-by-click steps for anything they must do by hand.

---

## 0. Before you start

1. `git pull` — another AI or person may have pushed since you last looked. Never work on a stale copy.
   Then read **`docs/PRE_LAUNCH_CHECKLIST.md`** — current status, agreed decisions and what is still open.
2. Only one agent should change code at a time. If you are not the primary agent, work on a **branch and open a Pull Request**; do not push to `main`.
   **The owner merges PRs.** Exception: a PR that changes **only documentation** (`docs/`, `*.md`; no code, migrations, Edge Functions or workflows) may be merged by the AI itself — tell the owner afterwards.
3. Read the relevant migration(s) and page(s) before changing them. The database is the source of truth for business rules.

## 1. Hard security rules (never break these)

- **Never** put the Supabase service_role / secret key (`sb_secret_…`), the Google client secret, or any other secret in: code, `NEXT_PUBLIC_*` variables, Vercel, commits, or chat.
  - The FX job (`fx-rates.yml`) and price job (`prices.yml`) read `SUPABASE_SECRET_KEY` (+ `BOT_API_TOKEN` / `BBL_API_KEY` / `SEC_API_KEY`) from **GitHub Secrets** only.
  - Edge Functions use the keys Supabase injects automatically (`SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY`) and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from Supabase Edge Function Secrets, plus `GITHUB_DISPATCH_TOKEN` (fine-grained, this repo only, Actions read/write — used by `fx-refresh`) and `SEC_API_KEY` (same key as the GitHub Secret — used by `sec-nav`).
  - The publishable/anon key is public by design; security comes from RLS.
- **Never ask for, print, rotate, or touch the Vault key `fwv_bank_account_key`.** It encrypts bank account numbers; changing it after real data exists destroys that data. The Google refresh token (`fwv_drive_refresh_token`) also lives in Vault — only the `drive` Edge Function reads it.
- **Never disable RLS, add permissive policies, grant tables to `anon`, or bypass role checks.** Roles: `ADMIN`, `EDITOR`, `CONTRIBUTOR` (insert; edit own rows < 24 h), `VIEWER` (read-only). Delete = soft delete (`deleted_at`), ADMIN/EDITOR only; restore = ADMIN only.
- New RPCs: prefer `SECURITY INVOKER` with `SET search_path = ''` so RLS and triggers apply. Use `SECURITY DEFINER` only when unavoidable, always with `SET search_path = ''` and an explicit `private.require_role(...)` check.
- `server_*` functions are for Edge Functions / jobs only: `REVOKE … FROM PUBLIC, anon, authenticated` and `GRANT … TO service_role`.
- Never use real account numbers, names, or amounts in tests or examples.
- Edge Functions run with **Verify JWT off** (Google OAuth callback has no JWT), so each function must authenticate the caller itself (see `supabase/functions/*/index.ts`). Keep that check on every path.

## 2. Database changes (Supabase)

- Migrations live in `supabase/migrations/` and run in filename order.
- **Who runs them (agreed 16 Oct 2026, revised same day):** the **owner** runs them by hand in the Supabase SQL Editor; the AI checks the result. Do **not** call `apply_migration` from a chat session — in this setup it is cancelled every time (tried 5× on 16 Oct, even with the connector set to "always allow"), and nothing is applied. Order — never the other way round:
  1. Write the migration on a branch; the local scenario tests (below), `tsc`, `eslint` and `next build` pass.
  2. Open the PR, so the exact file is in the repo. Give the owner the `raw.githubusercontent.com/accountoei/oeiwealth/<branch>/supabase/migrations/<file>` link with click steps (open link → Ctrl+A, Ctrl+C → Supabase → SQL Editor → New query → paste → Run → expect "Success").
  3. Tell the owner clearly: **run the SQL first, then press Merge** (code that calls a new function breaks if it deploys before the database has it).
  4. When the owner says it has run, verify with read-only `SELECT`s through the Supabase connector (`execute_sql` works): the new tables / columns / functions / triggers exist, the function bodies match the file (compare `md5(replace(prosrc, E'\r', ''))` with the same function in the local test DB — copy-paste adds `\r`), RLS is on for every new table, grants are right, and `get_advisors` (security) shows nothing new. Report the result in Thai.
  5. Then the owner merges the PR (Vercel deploys the code after the database is ready).
- **Ask the owner first** if a migration drops or renames a table / column / function that holds data, or updates / deletes existing rows. Never run SQL that is not in a committed migration file, except read-only `SELECT`s for checking.
- If a migration fails half-way, stop and report; do not "fix forward" with ad-hoc SQL — write a new migration file.
- **Never edit a migration that has already been run.** Always add a new file with the next timestamp, e.g. `20261005001500_short_name.sql`. Use `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, `DROP FUNCTION IF EXISTS` so re-running is safe.
- When changing a function signature, `DROP FUNCTION IF EXISTS old_signature` first and re-grant.
- New tables must get RLS (see `20261004001600_rls_grants.sql` for the standard policy set) and the generic META / soft-delete triggers.
- Business rules are enforced in the database (triggers for period lock, go-live lock, derived-record locks, cache guards). Do not re-implement them only in the UI, and do not weaken them to make a UI work.
- Money engine: cash movements are the central layer; income / expense / investment transactions / reimbursements create **derived** movements that clients cannot edit. Net worth comes from `private.net_worth_items(...)`; FINAL months read from snapshots.

### Test before you push (local only)

```bash
service postgresql start
DB=fwv_test bash tests/run.sh --scenario    # must end with: ALL SCENARIO TESTS PASSED (626 checks)
node scripts/fx-fetch.test.mjs && node scripts/price-fetch.test.mjs
```

`tests/run.sh` **drops and recreates a database**. Run it **only against a local Postgres**, never against Supabase.
If you add a migration, also add or extend checks in `tests/10_scenario.sql` where it matters, and update `tests/00_supabase_stub.sql` if you need a Supabase feature that the stub lacks.

## 3. Web app (Next.js)

```bash
npx tsc --noEmit && npx eslint src
NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build
```

All three must pass before pushing. Pushing to `main` deploys to production on Vercel automatically.

- UI text is **Thai**. Dates use `thDate`, money uses `money` from `src/lib/format.ts` (always thousands separators + 2 decimals; unit prices may pass `digits = 4`).
- Number inputs: use `inputMode="decimal"` — `src/components/NumberInputs.tsx` formats them globally (commas while typing, `.00` on blur; names matching quantity/percent/rate/level/day get no `.00`; `data-money="off"` opts out of `.00`, `data-plain` opts out entirely). Server actions must strip commas before `Number()` (use `numOrNull`).
- Theme lives in `src/app/globals.css` (`@theme` overrides): primary buttons `bg-blue-600 hover:bg-blue-700`, cards `rounded-xl border border-slate-200 bg-white`.
- `"use client"` files must not export constants used by server components — put shared constants/labels in `src/lib/format.ts`.
- Generic edit/delete goes through `src/lib/records.ts` (`EDITABLE` / `DELETABLE` whitelists). Add a table there only if RLS + triggers already protect it.
- Every page calls `requireAppUser()` and hides write controls for `VIEWER`; the database still enforces permissions.
- Large files (documents) go **browser → `drive` Edge Function** directly (Vercel has a 4.5 MB body limit). Do not route uploads through server actions.
- Keep `supabase/functions` excluded from `tsconfig`; type-check Edge Functions with `deno check`.

## 4. Edge Functions

- `invite-user` — invite / resend / reset password link / reset MFA (ADMIN + MFA only).
- `drive` — Google Drive connect (OAuth, scope `drive.file` only), upload, view/download with audit log, duplicate (SHA-256) check.
  Also `backup` / `backup_log` actions: accept **only** a Supabase secret key (checked by calling a service-role-only RPC); used by `.github/workflows/db-backup.yml` to store the encrypted weekly backup in Drive folder "10 สำรองข้อมูล (เข้ารหัส)". Never accept an unencrypted file there. See `docs/BACKUP_RESTORE.md`.
- `fx-refresh` — ADMIN button "อัปเดตอัตราตอนนี้": checks the caller is an ACTIVE ADMIN, throttles to once per 5 min (audit_logs `fx_refresh_request`), then dispatches `fx-rates.yml` on `main` via the GitHub API with `GITHUB_DISPATCH_TOKEN`. Stores the token expiry (from GitHub's response header) so Settings can warn 30 days ahead.
- `sec-nav` — read-only NAV lookup from the SEC Open API v2 for the opening / convert-to-units forms (caller must be an ACTIVE ADMIN / EDITOR / CONTRIBUTOR). Returns fund name + unit class + NAV of a date (or the previous business day); asks to pick a class when the fund has several. Saves nothing.
- Deployed by the owner via Supabase dashboard (Edge Functions → function → Code → paste → Deploy). After changing a function, tell the owner exactly which function to redeploy and to keep **Verify JWT off**.

## 5. Handing work back to the owner

**Every Pull Request must also update `docs/PRE_LAUNCH_CHECKLIST.md`** (tick what is done, add new open items / decisions, add a row to the PR history). This repo is **public**: never put real family data (names, addresses, deed or account numbers, amounts) in the repo, including that file and test files.

Always finish with, in Thai:
1. What changed (short, non-technical).
2. Exactly what they must do: which migration file(s) to run (link + steps) **before** pressing Merge, whether to press Merge, which Edge Function to redeploy, any setting to change.
3. A short test checklist using fake data.

Do not press or ask the owner to press **Confirm Go-live** with test data, and do not reset or delete production data without an explicit request.

## 6. Pending / planned (check with the owner before starting)

The full, current list lives in **`docs/PRE_LAUNCH_CHECKLIST.md`**. Agreed plan: finish menu / feature changes and testing on the current (near-real) data → wipe the database → re-bootstrap → an AI re-imports the real data from the owner's source files → Confirm Go-live.


- Monthly PDF report at month closing (stored in Drive via `server_attach_month_pdf`). (Weekly backup is done — `docs/BACKUP_RESTORE.md`.)
- Before real use: decide account ownership (Supabase, GitHub, Google Drive, Vault key) with the family owner, upgrade Supabase to Pro, pick a new go-live date, reset and re-bootstrap, disable test users, ADMINs set MFA on separate phones.
