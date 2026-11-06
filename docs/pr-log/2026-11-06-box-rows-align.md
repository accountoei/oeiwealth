# #363 · 2026-11-06 · box-rows-align

## What changed
- Property detail page: the top section is now two grid rows — "มูลค่าล่าสุด" | "รายละเอียด", then "เอกสาร" | "ประกันของทรัพย์สินนี้". Boxes in the same row are the same height, so top edges, the middle seam and bottom edges all line up (before: two separate flex columns, only the outer bottoms matched). Phone order: value → details → documents → insurance.
- Private Business detail page: when the "เงินกู้กับสมาชิก" box shows, the left column (value + documents) spans two rows, so both right-hand boxes sit to its right (before: the details box dropped under the value column with an empty gap on the right).
- AGENTS.md: rule "Box edges line up".
- Other detail pages checked (bank, liabilities, cards, portfolio, pf cash, loans, insurance, alternative, member): stacks on one side only, edges already line up.

## SQL
None.

## Tests
`tsc`, `eslint` (0 errors) and `next build` pass. No database change, so the scenario test count is unchanged.

## Decisions
- Owner, 6 Nov 2026: box edges must line up on every page; stacked boxes on both sides = grid rows.

## Open items
None.
