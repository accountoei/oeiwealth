# #360 · 2026-11-06 · hide-zero-totals

## What changed
- Investments "บันทึกรับผลตอบแทน": a currency's "รวม" row at the foot of the table is hidden when its expected, received and typed amounts are all 0 (e.g. pf cash accounts in AUD / EUR / NZD with nothing due).
- Loans "บันทึกรับชำระคืนเงินกู้": the "รวม (THB)" row is hidden when the due and typed totals are both 0.

## SQL
None.

## Tests
`tsc`, `eslint` (0 errors) and `next build` pass. No database change, so the scenario test count is unchanged.

## Decisions
- Owner, 6 Nov 2026: total rows that are all 0 are not shown.

## Open items
None.
