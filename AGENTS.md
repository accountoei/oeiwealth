# AGENTS.md — rules for any AI / developer working in this repo

> ภาษาไทยสรุป: ไฟล์นี้คือกติกาสำหรับ AI หรือนักพัฒนาทุกคนที่แก้โค้ดใน repo นี้ อ่านให้ครบก่อนเริ่มงาน
> ระบบเก็บข้อมูลการเงินจริงของครอบครัว — ความถูกต้องและความปลอดภัยสำคัญกว่าความเร็ว

**Family Wealth Vault** — a single-family net-worth app.
Stack: Next.js 16 (App Router, server actions, Tailwind) on Vercel · Supabase (Postgres + RLS + Edge Functions + Vault) · Google Drive (documents).
The owner/operator is **not a programmer**: every change must be explained in plain Thai, with exact click-by-click steps for anything they must do by hand.

---

## 0. Before you start

1. `git pull` — another AI or person may have pushed since you last looked. Never work on a stale copy.
   Then read **`docs/PRE_LAUNCH_CHECKLIST.md`** — current status, agreed decisions and what is still open. For what recent PRs changed and why, read their descriptions on GitHub (`gh api 'repos/accountoei/oeiwealth/pulls?state=closed&per_page=20'`). `docs/pr-log/` is an archive of PRs #283 to 10 Nov 2026 only (no new files since 10 Nov 2026).
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
- In policies, wrap per-user functions in a sub-select so they run once per query, not once per row: `(SELECT private.has_role('ADMIN'))`, `(SELECT private.app_user_id())`, `(SELECT auth.uid())`. Only functions that take a column of the row (e.g. `private.tax_can_read(r.person_id)`) stay unwrapped. `tests/10_scenario.sql` section 15 fails otherwise.
- Business rules are enforced in the database (triggers for period lock, go-live lock, derived-record locks, cache guards). Do not re-implement them only in the UI, and do not weaken them to make a UI work.
- Money engine: cash movements are the central layer; income / expense / investment transactions / reimbursements create **derived** movements that clients cannot edit. Net worth comes from `private.net_worth_items(...)`; FINAL months read from snapshots.

### Test before you push (local only)

```bash
service postgresql start
DB=fwv_test bash tests/run.sh --scenario    # must end with: ALL SCENARIO TESTS PASSED (N checks) — N must not be lower than on main before your change
for t in scripts/*.test.mjs; do node "$t" || { echo "FAILED: $t"; break; }; done    # every unit test file (a new scripts/*.test.mjs runs without editing this line)
```

`tests/run.sh` **drops and recreates a database**. Run it **only against a local Postgres**, never against Supabase.
If you add a migration, also add or extend checks in `tests/10_scenario.sql` where it matters, and update `tests/00_supabase_stub.sql` if you need a Supabase feature that the stub lacks.

## 3. Web app (Next.js)

```bash
npx tsc --noEmit && npx eslint src
NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build
```

All three must pass before pushing. Pushing to `main` deploys to production on Vercel automatically.

- Wording (owner, 4 Nov 2026): **สินทรัพย์** = totals / categories / balance-sheet sense (สินทรัพย์รวม · สัดส่วนสินทรัพย์ · สินทรัพย์อื่น · หนี้สินต่อสินทรัพย์); **ทรัพย์สิน** = one owned item (ซื้อ / ขายทรัพย์สิน · หน้าทรัพย์สิน · เจ้าของทรัพย์สิน). Net Worth = **ความมั่งคั่งสุทธิ** in all UI text; only the Dashboard chart box title reads "ความมั่งคั่งสุทธิ (Net Worth)". Bank menu = "Bank Accounts"; Dashboard category = "เงินฝากธนาคาร".
- UI text is **Thai**. Dates use `thDate`, money uses `money` from `src/lib/format.ts` (always thousands separators + 2 decimals; unit prices may pass `digits = 4`). Exception: the Dashboard (`src/app/(app)/page.tsx`, `DashDetail.tsx`) rounds to whole baht with `baht()` (owner, 1 Nov 2026) — `money(v, _, 0)` still shows 2 decimals.
- Number inputs: use `inputMode="decimal"` — `src/components/NumberInputs.tsx` formats them globally (commas while typing, `.00` on blur; names matching quantity/percent/rate/level/day get no `.00`; `data-money="off"` opts out of `.00`, `data-plain` opts out entirely; a field that takes money **or** a `%` (e.g. salvage value) uses `data-num="pct"` instead of `inputMode` — commas while typing, `10%` kept as is, full keyboard so `%` can be typed on iPad). Server actions must strip commas before `Number()` (use `numOrNull`); client-side running totals use `numOrZero`. Server actions return `FormState` (extend it per page) from `src/lib/format.ts`.
- Success messages: render with `<Flash on={state} />` (`src/components/Flash.tsx`, hides after 4 s; errors stay; outside a `Modal` it shows as a bottom-right toast instead — `toast()` / `useInModal()` in `src/components/Modal.tsx`) — not `{state.ok && <p>…</p>}`.
- Theme lives in `src/app/globals.css` (`@theme` overrides): primary buttons `bg-blue-600 hover:bg-blue-700`, cards `rounded-xl border border-slate-200 bg-white`.
- **Buttons vs row click vs links** (owner, 5 Nov 2026) — same job, same look on every page:
  - **Button** = do something / record something new (opens a popup, or a full page for a long "+ เพิ่ม…" form; delete / confirm-type buttons only ask to confirm). Primary: blue (`ADD_BTN`, `ROW_BTN`). Secondary: `SMALL_BTN`; red for delete / undo: `SMALL_DEL_BTN` (both in `src/lib/format.ts`).
  - **Click the table row** = edit / delete an existing record (`RowActions` / `PairEdit` / `useRowPanel` without `button`). Use a per-record small button only when one row holds several separately editable records.
  - **Dotted underline = clickable** (owner, 9 Nov 2026): in a clickable row the first amount gets a dotted underline automatically (`RowPanel` marks it `data-amt-auto`; style in `globals.css`), so clicking the number or the row does the same thing. Put `data-amt` on the number yourself if the auto pick is wrong. When one row holds several records (booklet parts, rent line + receipt, health / coverage grids, insurance CV cells) each amount is its own dotted button instead.
  - **Same record = same edit popup on every page** (owner, 10 Nov 2026): wherever a record can be clicked (its own page, an overview box, a batch tab, Income & Expenses, a bank / portfolio-cash page), it opens the same fields with Delete beside Save. Reuse the shared pieces instead of writing a new field list: `src/lib/source-edit.ts` (e.g. `portfolioTxFields` for every portfolio transaction), `EntryEditor` (ordinary income / expense, incl. property one-off costs via `property/expense-edit.tsx`), `PairEdit` (principal + interest paid / received together — loans and liabilities), `PfTransferEditor` / `TransferEditor` (transfers), `ReceiptEdit` (insurance receipts). Link to the source page only when no popup can edit it there (e.g. a lump still waiting to be split).
  - **Link** (text, `<Link>` / `<a>`) = go to another page only. Never use a link-looking button to open a popup or run an action.
  - Inside forms too: **add / remove a line = button** (`SMALL_BTN` "+ เพิ่มบรรทัด", `SMALL_DEL_BTN` "ลบ" — not ✕ / ×, not red text); a "no / cancel / close" answer next to a confirm button is an outline button, not plain text.
  - Allowed small exceptions (text is fine): helpers that only **fill or clear values** before Save ("กรอกตาม…", "ตามงวด", "เต็มจำนวน", "คิดภาษี x%", "ใช้ยอดจากตาราง", "ล้างช่องที่กรอก", "ล้างตัวกรอง"), "← กลับไป…" inside a form, show-more / collapse toggles ("ดูทั้งหมด", "▸ รายแถว"), and an amount with ✎ / dotted underline in a table cell that opens that cell's record.
  - In popups: Save first, then Delete or Status beside it; no Cancel / Close (the popup has ✕ / Esc — mark such buttons `data-close`).
  - **Popup width = 3 sizes only** (owner, 6 Nov 2026), chosen by what is inside, via `size` on `Modal` / `ModalButton` / `useActionSlot` / `row.render` (`ModalSize` in `src/components/Modal.tsx`):
    - `sm` (448 px): confirm / delete / rename, or a form of 1–3 fields laid out in one column or at most 2 columns.
    - `md` (768 px, default): a normal add / edit form for one record; a small read-only table.
    - `lg` (1,152 px): wide tables, multi-row entry grids, history / schedules, paste-and-preview; long multi-section forms ("แก้ไขรายละเอียด" of a detail page, new lease).
    - `RowActions` picks its own size: 1–3 generic fields (or delete only) = `sm` in one column; more fields, a custom `editor` or a `section` = `md`.
    - Tailwind `sm:` / `md:` / `lg:` follow the **screen** width, not the popup width — a form with a 3- or 4-column grid must not use `sm`.
  - **Batch tables** (many rows, one Save — update balance / value / price tabs and record receive / pay tabs, owner 5 Nov 2026): the save bar sits **above** the table, right-aligned, via `BatchSave` (`src/components/BatchSave.tsx`): `[messages] · fill helpers · ล้างช่องที่กรอก · [บันทึก N รายการ] · ณ วันที่ [date] ⓘ`. Button text is only "บันทึก N รายการ" (the confirm dialog keeps the full wording, "… ณ วันที่ …"); the date label is always "ณ วันที่"; "ล้างช่องที่กรอก" always shows (faded when nothing is filled). The box / row holding the bar gets `STICKY_BAR` so it stays under the header while scrolling (iPad and wider). No save button under the table.
- **Batch-entry tabs** (บันทึกรับ / จ่าย / อัปเดตหลายรายการ · owner, 6 Nov 2026) — one sticky top bar, same order on every page: `<BatchBar title filters fill>` + `<BatchSave>` from `src/components/BatchSave.tsx` → **[title ⓘ] [filters (`FilterSelect`, year)] [`FillAll` "ใส่ยอดทุกแถว"] … [`TaxAll` "หัก ณ ที่จ่าย x%" / method select] [ล้างช่องที่กรอก] [บันทึก N รายการ] ณ วันที่ ⓘ**. The table box below has no second header. Helpers stay in place when there is nothing to do (faded / disabled, not hidden). One kind of record per tab (e.g. "อัปเดตมูลค่า" and "บันทึกรับ…" are separate tabs). No summary cards above a batch table (owner, 6 Nov 2026): totals go in a "รวม" row at the foot of the table (one row per currency), and overdue items in one red line under the table via `LateNote` ("ค้างรับ / ค้างจ่าย (เลยกำหนด ณ วันนี้) N งวด · amount", hidden when none).
- **Box edges line up** (owner, 6 Nov 2026): boxes side by side share top and bottom edges. When boxes are stacked on **both** sides (e.g. value | details, then documents | insurance), make each pair a grid row (`grid md:grid-cols-3`, boxes as direct children, wide ones `md:col-span-2`) — never two separate flex columns, whose middle seams don't meet. When only one side has a stack, that side is one flex column (last box `flex-1`); a single box beside two stacked rows gets `md:row-span-2`.
- `"use client"` files must not export constants used by server components — put shared constants/labels in `src/lib/format.ts`.
- Generic edit/delete goes through `src/lib/records.ts` (`EDITABLE` / `DELETABLE` whitelists). Add a table there only if RLS + triggers already protect it.
- Shared lists that many PRs add to (e.g. `DELETABLE`, label maps): one entry per line, inserted in alphabetical order — never appended at the end or onto a long single line, so parallel PRs do not conflict.
- Every page calls `requireAppUser()` and hides write controls for `VIEWER`; the database still enforces permissions.
- Page data (after `requireAppUser()`): start every independent query in one `Promise.all`; a query that needs another's result chains on that one promise (`.then(...)` or an `(async () => { … })()` inside the same `Promise.all`), never a separate `await` round after it. Each extra round costs a full trip to Supabase, much slower when it has just woken up. A supabase-js query re-sends on every `.then`, so wrap one you reuse in `.then((r) => r)` first. Async tab components get their data from the page (see `loadDue` / `loadUpdate` in `investments/`), otherwise they only start after the page has finished.
- Cached results (`cachedRpc` / `cachedData` / `cachedLoad` in `src/lib/data-cache.ts`: Dashboard, portfolio returns, the To-Do count, the Income & Expenses page data in `income-expenses/page-data.ts` — month-independent lists in `loadIeRef`, one month in `loadIeMonth`; add new queries there) are kept until data changes, max 1 hour. So every Server Action that saves must import `revalidatePath` from `@/lib/revalidate` (not `next/cache`), and every background job that changes data must write its `system_job_runs` row in the same transaction (the cache key includes `public.data_version()`). Otherwise users see old numbers for up to an hour.
- Large files (documents) go **browser → `drive` Edge Function** directly (Vercel has a 4.5 MB body limit). Do not route uploads through server actions.
- Session refresh + redirect-to-login lives in `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; the exported function is `proxy`).
- Keep `supabase/functions` excluded from `tsconfig`; type-check Edge Functions with `deno check`.

## 4. Edge Functions

- `invite-user` — invite / resend / reset password link / reset MFA (ADMIN + MFA only).
- `drive` — Google Drive connect (OAuth, scope `drive.file` only), upload, view/download with audit log, duplicate (SHA-256) check.
  Also `backup` / `backup_log` actions: accept **only** a Supabase secret key (checked by calling a service-role-only RPC); used by `.github/workflows/db-backup.yml` to store the encrypted weekly backup in Drive folder "10 สำรองข้อมูล (เข้ารหัส)". Never accept an unencrypted file there. See `docs/BACKUP_RESTORE.md`.
- `fx-refresh` — ADMIN button "อัปเดตอัตราตอนนี้": checks the caller is an ACTIVE ADMIN, throttles to once per 5 min (audit_logs `fx_refresh_request`), then dispatches `fx-rates.yml` on `main` via the GitHub API with `GITHUB_DISPATCH_TOKEN`. Stores the token expiry (from GitHub's response header) so Settings can warn 30 days ahead.
- `sec-nav` — read-only NAV lookup from the SEC Open API v2 for the opening / convert-to-units forms (caller must be an ACTIVE ADMIN / EDITOR / CONTRIBUTOR). Returns fund name + unit class + NAV of a date (or the previous business day); asks to pick a class when the fund has several. Saves nothing.
- Deployed by the owner via Supabase dashboard (Edge Functions → function → Code → paste → Deploy). After changing a function, tell the owner exactly which function to redeploy and to keep **Verify JWT off**.

## 5. Handing work back to the owner

**The PR description on GitHub is the record of each PR** — write in it: what changed, SQL file (or "no SQL"), test check count, decisions agreed, open items. **Do not add files to `docs/pr-log/`** (stopped 10 Nov 2026: it duplicated the PR description and added a step to every PR; existing files stay as an archive).
- When a PR changes a rule or how the system works, still update the doc that owns it (this file, `docs/PRE_LAUNCH_CHECKLIST.md` to-do / status, or the topic doc in `docs/`) in the same PR.
- **Do not** add rows to the "ประวัติการปรับปรุง (Pull Requests)" or "การตัดสินใจที่ตกลงแล้ว" tables in `docs/PRE_LAUNCH_CHECKLIST.md` (frozen since 2 Nov 2026), do not edit its header date line, and do not change the check count in this file — shared append-only spots made every parallel PR conflict.
- Edit `docs/PRE_LAUNCH_CHECKLIST.md` only when a to-do item or the system status actually changes (tick an item, add a new open item). This repo is **public**: never put real family data (names, addresses, deed or account numbers, amounts) in the repo, including that file and test files.

Always finish with, in Thai:
1. What changed (short, non-technical).
2. Exactly what they must do: which migration file(s) to run (link + steps) **before** pressing Merge, whether to press Merge, which Edge Function to redeploy, any setting to change.
3. A short test checklist using fake data.

Do not press or ask the owner to press **Confirm Go-live** with test data, and do not reset or delete production data without an explicit request.

## 6. Pending / planned (check with the owner before starting)

The full, current list lives in **`docs/PRE_LAUNCH_CHECKLIST.md`**. Agreed plan: finish menu / feature changes and testing on the current (near-real) data → wipe the database → re-bootstrap → an AI re-imports the real data from the owner's source files → Confirm Go-live.


- Monthly PDF report at month closing (stored in Drive via `server_attach_month_pdf`). (Weekly backup is done — `docs/BACKUP_RESTORE.md`.)
- Before real use: decide account ownership (Supabase, GitHub, Google Drive, Vault key) with the family owner, upgrade Supabase to Pro, pick a new go-live date, reset and re-bootstrap, disable test users, ADMINs set MFA on separate phones.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
