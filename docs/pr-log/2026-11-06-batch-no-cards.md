# 2026-11-06 · batch-no-cards

## What changed
- Removed the 3 summary cards above the batch table on: Insurance "บันทึกรับผลประโยชน์" and "จ่ายชำระเบี้ยประกัน", Loans "บันทึกรับชำระคืนเงินกู้", Investments "บันทึกรับผลตอบแทน". The other batch tabs never had them, so all batch tabs now look the same.
- Overdue total moved to one red line under the table (`LateNote` in `src/components/BatchSave.tsx`): "ค้างรับ / ค้างจ่าย (เลยกำหนด ณ วันนี้) N งวด · amount" — hidden when nothing is overdue. Insurance = THB lines of all years; Loans = all contracts (THB); Investments = all portfolios, one amount per currency.
- New "รวม" row at the foot of the Loans table (THB: due + amount typed) and the Investments table (one row per currency: expected + received, typed gross / tax / net). Insurance already had "รวมปี".
- Insurance page no longer queries this month's payments / benefit receipts (only the cards used them).
- AGENTS.md batch-tab rule: no summary cards above batch tables; totals in a foot row, overdue in `LateNote`.

## SQL
None.

## Tests
`tsc`, `eslint` (0 errors) and `next build` pass. No database change, so the scenario test count is unchanged.

## Decisions
- Owner, 6 Nov 2026: batch-entry tabs have no summary cards; totals at the table foot, overdue as a red line under the table.

## Open items
None.
