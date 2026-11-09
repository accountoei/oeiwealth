# Insurance · กล่องผลประโยชน์ที่รับปีนี้ (no SQL)

## What changed
- Insurance overview, box 3 "ผลประโยชน์ที่รับ ปี BE (THB)" now matches the premium box:
  - The big number is the whole year by schedule.
  - The line below reads "รับแล้ว · รอรับ".
  - A red line "ค้างรับ N งวด" shows when a benefit line is overdue.
- The % line is now "รับแล้วเทียบเบี้ยที่จ่ายปีนี้" (benefits received this year ÷ premium paid this year).
- The old lifetime ratio is removed from this box; it is still on each policy page.
  - It mixed in current cash value and only counted policies with paid premiums, so "ได้คืน" showed a cash value, not money received.

## SQL
None.

## Tests
`tsc`, `eslint` and `next build` pass.

## Decisions
Owner, 9 Nov 2026: the box takes the same shape as the premium box, and the % is for this year only.
