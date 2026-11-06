# #355 · 2026-11-06 · insurance-year-first

## What changed
- Insurance → "บันทึกรับผลประโยชน์" and "จ่ายชำระเบี้ยประกัน": the top bar no longer shows the title "ผลประโยชน์ ปี …" / "เบี้ยประกัน ปี …". The year dropdown is now the first box, then the insurer filter, then "ใส่ยอดทุกแถว".
- The explanation that sat in the title's ⓘ moved into the ⓘ next to "ณ วันที่".

## SQL
None.

## Tests
`tsc`, `eslint` (0 errors) and `next build` pass. No database change, so the scenario test count is unchanged.

## Decisions
- Owner, 6 Nov 2026: on insurance batch tabs the year filter comes first and the bar has no title (BatchBar `title` is optional).

## Open items
None.
