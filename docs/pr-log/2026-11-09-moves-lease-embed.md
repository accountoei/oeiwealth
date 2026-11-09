# #419 · Bank Accounts / I&E: money-in/out rows missing (fix #415) + search by account last 4 (no SQL)

## What changed
- **Fix:** `MOVE_SELECT` (`income-expenses/entry-kit.tsx`) embedded `property_leases(property_asset_id)`, a column that does not exist.
  - Since #415 PostgREST answered 400, so every bank account detail page and the I&E money-in/out list showed no rows.
  - The month-end figures on those pages were also wrong, because they are built from the rows. No data was lost.
  - The embed now goes through the lease's property: `property_details!property_leases_property_id_fkey(asset_id)`.
  - The lease-deposit row link (`/property/<asset id>`) reads the new path.
- **Search:** the header search now also matches `bank_accounts.account_no_last4` (quick box and full page).
  - Before, an account was found only when its name happened to contain the digits.
  - The full number stays encrypted and is not searchable.

## SQL
None.

## Tests
`tsc`, `eslint` (0 errors) and `next build` pass.

## Checked in prod (read-only)
- Edge logs: `/rest/v1/cash_movements` 400s only since the #415 deploy, and no other 400 paths.
- The other new selects in #415 use only columns that exist.
- 16 of 22 bank accounts have movements in Oct 2026 (45 rows) and 2 in Nov (3 rows). All will show again.
