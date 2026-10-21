# Family Wealth Vault — Physical Schema V1.2 (Supabase / PostgreSQL)

> **Status:** 21 ต.ค. 2026 · ตรงกับฐานข้อมูลจริงหลัง migration `20261021000600_gold_assoc_baseline90.sql` (PR #138)
> **ต่อจาก** `Family_Wealth_Vault_Physical_Schema_V1.1.md` (4 ต.ค. 2026 · เก็บไว้เป็นประวัติ) — หลักการออกแบบ / Guard / Source → Derived / RLS ในข้อ 3–9 ของ V1.1 **ยังใช้อยู่ทั้งหมด** เอกสารนี้บันทึกสิ่งที่เพิ่มและกฎที่เปลี่ยนหลังจากนั้น
> ทดสอบ: `tests/run.sh --scenario` **ผ่าน 550 checks** · ฟังก์ชันบนฐานข้อมูลจริงตรวจด้วย `md5(prosrc)` เทียบฐานข้อมูลทดสอบทุกครั้งที่รัน migration
> ⚠️ repo เป็น Public — เอกสารนี้ไม่มีข้อมูลจริงของครอบครัว

---

## 1. ภาพรวม (เทียบ V1.1)

| รายการ | V1.1 (4 ต.ค.) | V1.2 (21 ต.ค.) |
|---|---:|---:|
| Migration | 17 ไฟล์ | 94 ไฟล์ (`supabase/migrations/`) |
| ตาราง (public) | 51 | 62 |
| View (ทุกตัว `security_invoker = true`) | 23 | 29 |
| Function ที่แอปเรียก (RPC · `authenticated`) | 21 | 104 |
| Function ของ Job / Edge Function (`server_*` · `service_role` เท่านั้น) | — | 13 |
| Function ภายใน (schema `private`) | 85 | 166 |
| Trigger (public) | 211 | 289 |
| RLS Policy (public) | 138 | 165 |
| Edge Function | — | 3 (`invite-user` · `drive` · `fx-refresh`) |
| GitHub Actions | — | 4 (`fx-rates` · `prices` · `db-backup` · `supabase-keepalive`) |
| Test checks | 98 | 550 |

วิธีติดตั้ง / Bootstrap (ข้อ 2 ของ V1.1) ยังเหมือนเดิม · ช่วงนี้ **เจ้าของรัน migration เองใน SQL Editor** แล้ว AI ตรวจผล (ดู `AGENTS.md` ข้อ 2)

---

## 2. ตารางที่เพิ่ม (11 ตาราง)

ทุกตารางมี RLS + Trigger META / soft delete / audit ตามมาตรฐาน `20261004001600_rls_grants.sql`

| ตาราง | ใช้ทำอะไร | Migration |
|---|---|---|
| `loan_schedule_lines` | ตารางผ่อนชำระเงินให้กู้ (งวด · เงินต้น · ดอกเบี้ย · สถานะรับ) | `20261009000200` |
| `insurance_schedule_lines` | ตารางเบี้ยประกัน / ผลประโยชน์ | `20261010000400` |
| `insurance_coverages` | ความคุ้มครอง + วงเงินรายปี | `20261010000400` |
| `insurance_followups` | งานติดตามหลังผู้เอาประกันเสียชีวิต | `20261010000400` |
| `insurance_benefit_receipts` | รับเงินก้อนจากประกัน (ยกเลิกทั้งก้อนได้) | `20261015000100` |
| `credit_card_statements` | ประวัติ Statement บัตรเครดิต | `20261014000500` |
| `ie_categories` | หมวดรายได้ / ค่าใช้จ่ายที่ตั้งเอง (ซ่อนแทนลบ) | `20261015000200` |
| `recurring_expense_templates` | ค่าใช้จ่ายประจำ (ทั่วไป + ของทรัพย์สิน) | `20261015000300` |
| `expected_expense_dismissals` | "เดือนนี้ไม่ได้จ่าย" ของค่าใช้จ่ายประจำ | `20261015000300` |
| `business_share_sales` | ซื้อ / ขายหุ้นธุรกิจรายคน | `20261017000200` |
| `property_tax_lines` | ภาษีที่ดินและสิ่งปลูกสร้างรายปี (หลายรายการต่อทรัพย์สิน) | `20261017000800` |

## 3. คอลัมน์สำคัญที่เพิ่มในตารางเดิม

| ตาราง | คอลัมน์ | ความหมาย |
|---|---|---|
| `families` | `fx_source` · `fx_bbl_rate` · `fx_source_since` | แหล่งอัตรา (BOT / BBL) · ชนิดอัตรา BBL (MID / BUYING_TT / SELLING) · วันที่เริ่มใช้แหล่งปัจจุบัน |
| `investment_holdings` | `is_default_cash` · `auto_price` · `price_ref` · `price_pending` | บัญชีเงินฝากหลักของสกุล (CASH) · เปิดดึงราคา · รหัสที่ใช้ดึง · ราคารอยืนยัน (Job เขียนเท่านั้น) |
| `investment_transactions` | `cash_holding_id` · `counter_cash_holding_id` · `source_expense_item_id` · `to_credit_card_id` | บัญชีเงินฝากในพอร์ตที่จ่าย / รับ · PAYMENT จ่ายค่าใช้จ่าย / จ่ายบัตรจากพอร์ต (derived) |
| `expense_items` | `paid_from_cash_holding_id` | ค่าใช้จ่ายที่จ่ายจากบัญชีเงินฝากในพอร์ต |
| `credit_cards` | `autopay_cash_holding_id` | ตัดบัตรอัตโนมัติจากบัญชีในพอร์ต (สกุลเดียวกับบัตรเท่านั้น) |
| `alternative_asset_details` | `unit` · `purity_pct` · `auto_price` · `gold_form` · `deduct_per_baht` · `price_pending` | หน่วยนับ · ความบริสุทธิ์ · ราคาอัตโนมัติ · ทองแท่ง / รูปพรรณ · หักต่อบาททองคำ (รูปพรรณ) · มูลค่ารอยืนยัน |
| `asset_categories` | `default_unit` | หน่วยตั้งต้นของหมวด (ทองคำ = บาททองคำ) |
| `asset_valuations` | `source` เพิ่ม `MARKET` | มูลค่าจากราคาตลาด (Job / ยืนยันราคาฐาน) |
| `property_details` | ข้อมูลโฉนด · `map_url` · `latitude` · `longitude` | ตำแหน่ง Google Maps / พิกัด (ต้องใส่คู่ · ช่วงค่าถูกต้อง) |
| `private_business_details` | `par_value` | มูลค่าหุ้นที่ตราไว้ (ทุนจดทะเบียน = หุ้น × par) |
| `system_job_runs` | `job_type` เพิ่ม `PRICE_FETCH` | ประวัติ Job ราคาอัตโนมัติ |

## 4. View ที่เพิ่ม / เปลี่ยน

- เพิ่ม: `v_loan_schedule_status` · `v_insurance_schedule_status` · `v_insurance_status` · `v_property_cost_tracking` · `v_recurring_expense_tracking` · `v_property_tax_lines`
- ปรับ: `v_holdings_active` · `v_portfolio_values` · `v_investment_transactions_net` (บัญชีเงินฝากในพอร์ต · PAYMENT) · `v_income_by_person` / `v_expense_by_person` (แบ่งตามผู้รับผิดชอบหนี้ / ก้อนรอแยก) · `v_card_balances` / `v_liabilities_all` (ยอดบัตรคำนวณ) · `v_loans_status`

---

## 5. กฎที่เปลี่ยนหรือเพิ่ม (Database เป็นผู้บังคับ)

### 5.1 อัตราแลกเปลี่ยน (FX)
- **อัตราของวันเดียวกัน:** `private.fx_rate_row(ccy, D)` = อัตราล่าสุดที่ `rate_date <= D` (V1.1: `< D`) · ไม่มีของวันนั้น = อัตราล่าสุดก่อนหน้า · ใช้ทุกจุดที่แปลงเป็นบาท (ยอดบาทของรายการ · Net Worth · พอร์ต · บัตร · ปิดเดือน) — `20261021000400`
- **แหล่งอัตรา:** ADMIN เลือกด้วย `set_fx_source` · มีผลตั้งแต่อัตราของวันที่เปลี่ยน · แหล่งหนึ่งไม่ทับอีกแหล่ง · ธนาคารกรุงเทพต่างจากอัตราก่อนหน้าเกิน 5% = ไม่บันทึก — `20261017001200`
- **งวดที่ปิดแล้ว:** Trigger `t20_period_lock` บน `fx_rates` ห้ามเพิ่ม / แก้ / ลบอัตราที่ `rate_date ≤ locked_through` (ทั้ง ADMIN Override และ Job) · `server_upsert_fx_rates` ข้ามเป็น `PERIOD_LOCKED` ไม่ล้มทั้งชุด — `20261021000500`
- ADMIN Override ยังทำได้ (งวดที่เปิด) · Job ไม่ทับค่าที่ Override

### 5.2 ราคาอัตโนมัติ (หุ้น / กองทุน / ทองคำ)
- `server_upsert_prices`: ราคาครั้งก่อน = ราคา / มูลค่าที่บันทึกแล้ว (ตลาด · Statement · ผู้ใช้ · ยอดตั้งต้น) **ภายใน 90 วัน** · ไม่เทียบราคาทุน / มูลค่าปัจจุบัน
- ไม่มีราคาครั้งก่อน (`NEEDS_BASELINE`) หรือต่างเกิน 20% (`DEVIATION_OVER_20PCT`) → **ไม่บันทึก** เก็บใน `price_pending` → ADMIN / EDITOR `confirm_pending_price` (บันทึกเป็น MARKET) หรือ `dismiss_pending_price` · ผู้ใช้แก้ `price_pending` ตรงไม่ได้ (Trigger `t55_price_pending`)
- ไม่ทับราคาจาก Statement / ผู้ใช้ในวันเดียวกัน (`HAS_STATEMENT`) — `20261021000500`, `20261021000600`
- **ทองคำ:** `private.gold_value(asset, ราคาต่อบาททองคำ 96.5%)` = จำนวน (บาททองคำ · กรัม ÷ 15.244) × ราคา × ความบริสุทธิ์ ÷ 96.5 − จำนวน × ค่าหัก (รูปพรรณ) · ไม่ต่ำกว่า 0 · ใช้ทั้ง Job และ `add_gold_valuation` (ผู้ใส่ราคาต่อบาทเอง)

### 5.3 เงินในพอร์ต (บัญชีเงินฝากในพอร์ต = CASH holding)
- ยอด (`private.holding_value_at`) = Statement ล่าสุด หรือยอดตั้งต้น + รายการลงทุนหลังจากนั้น + เงินโอนธนาคาร ↔ พอร์ตที่ทราบยอดแล้ว (`private.pf_transfers`) — `20261021000200`
- เงินระหว่างทาง (`private.portfolio_in_transit`) = เฉพาะเงินโอนที่ยังไม่ทราบยอดฝั่งรับ
- จ่ายค่าใช้จ่าย / จ่ายบัตรจากพอร์ต = รายการลงทุนชนิด `PAYMENT` (derived · แก้ที่ต้นทาง) · บัตรต่างประเทศผูกได้เฉพาะบัญชีสกุลเดียวกัน — `20261021000100`

### 5.4 เงินสด / ปิดเดือน / ก้อนรอแยก
- ส่วนต่างที่อธิบายไม่ได้ระหว่างยอดคำนวณกับ Statement = ก้อน "รอแยกรายละเอียด" (`split_lump` / `split_pending_item`) · แยกได้แม้ปิดงวด · เงินโอนแยกเกินยอดก้อนได้ ส่วนเกินเป็นก้อนฝั่งตรงข้าม
- **ปิดเดือนไม่ได้ถ้าบัญชีธนาคารติดลบ ณ สิ้นเดือน** (`NEGATIVE_BALANCE`) — บัญชี OD ให้บันทึกเป็นหนี้สินแบบวงเงิน — `20261020000100`
- รายได้ / ค่าใช้จ่ายประจำ: ระบบไม่สร้างรายการเอง · แสดงเป็น "ที่ต้องได้รับ / ที่ต้องจ่าย" ให้กดบันทึกด้วยยอดจริง หรือ "เดือนนี้ไม่ได้รับ / ไม่ได้จ่าย"
- บันทึกหลายรายการพร้อมกัน (`batch_update_bank_statements` · `batch_record_rent` · `batch_add_property_expenses`) เป็น transaction เดียว — ผิดแถวเดียว = ไม่บันทึกทั้งชุด

### 5.5 อื่น ๆ
- **วัน Go-live:** `change_go_live_date` (ADMIN · ก่อน Confirm · วันที่ 1 ของเดือน) ย้ายยอดตั้งต้นทั้งหมดไปวันก่อน Go-live ใหม่ (ตัวเลขเท่าเดิม) — `20261017001100`
- **Private Business:** ขาย / ซื้อหุ้นรายคน · กำไรขาดทุน = เงินขายสุทธิ − มูลค่าตามราคาประเมินล่าสุด → รายได้ / ค่าใช้จ่ายของผู้ขาย
- **ภาษีที่ดิน:** รายปีต่อทรัพย์สิน · `copy_property_tax_year` คัดลอกจากปีก่อน · `sync_land_tax_estimate` ตั้งยอดประมาณค่าใช้จ่ายประจำ
- **บัตรเครดิต:** ยอดคำนวณ = Statement + รูด − จ่าย · ตัดบัตรอัตโนมัติจากบัญชีเดียว (ธนาคาร หรือบัญชีในพอร์ต)

---

## 6. RPC ที่แอปเรียก (104 ตัว · `authenticated` · ตรวจสิทธิ์ด้วย RLS / `private.require_role`)

| กลุ่ม | Function |
|---|---|
| สร้างรายการ | `create_bank_account` · `create_portfolio` · `create_property` · `create_alternative_asset` · `create_private_business` · `create_liability` · `create_loan` · `create_lease` · `create_insurance_policy` · `add_holding` · `add_expense` · `add_document` · `add_health_checkup` · `add_insurance_cash_value` · `add_gold_valuation` |
| เงินสด / โอน | `transfer_money` · `update_transfer` · `change_entry_account` · `update_entry` · `bank_balances_at` · `bank_month_summary` · `bank_statement_status` · `update_bank_balance` · `update_bank_statement` · `batch_update_bank_statements` · `settle_bank_difference` · `settle_bank_latest` · `prepare_bank_reconciliation` · `confirm_bank_reconciliation` · `lump_status` · `split_lump` · `split_pending_item` · `pay_from_statement_drop` · `undo_payment_group` · `set_expense_month_status` · `record_reimbursement` |
| ลงทุน | `record_investment_tx` · `record_investment_fx` · `record_holding_maturity` · `move_holding` · `transfer_portfolio_cash` · `transfer_portfolio_money` · `update_portfolio` · `update_portfolio_transfer` · `set_default_cash_account` · `investment_returns` · `investment_returns_local` · `confirm_pending_price` · `dismiss_pending_price` |
| หนี้ / บัตร / เงินให้กู้ | `pay_liability` · `pay_credit_card` · `update_card_statement` · `update_liability_statement` · `set_liability_responsibility` · `delete_credit_card` · `delete_liability` · `receive_loan_payment` · `set_loan_schedule` · `restructure_loan_schedule` |
| อสังหาฯ / ธุรกิจ / ทรัพย์สิน | `batch_record_rent` · `batch_add_property_expenses` · `copy_property_tax_year` · `sync_land_tax_estimate` · `settle_security_deposit` · `undo_security_deposit` · `delete_lease` · `sell_asset` · `sell_business_shares` · `buy_business_shares` · `undo_business_share_sale` · `set_asset_ownership` · `delete_asset` · `asset_completeness` |
| ประกัน / สมาชิก | `set_insurance_schedule` · `receive_insurance_benefit` · `undo_insurance_benefit` · `set_beneficiaries` · `delete_insurance_policy` · `set_family_head` · `move_person` · `move_health_metric` |
| หมวด / ลำดับ | `rename_ie_category` · `move_ie_category` · `swap_sort_order` |
| Dashboard / ปิดเดือน | `dashboard_month` · `person_dashboard` · `net_worth_history` · `month_net_worth_preview` · `month_family_items` · `month_person_items` · `month_closing_checks` · `finalize_month` · `reopen_month` |
| ระบบ / ผู้ใช้ / ความปลอดภัย | `confirm_go_live` · `change_go_live_date` · `set_fx_source` · `admin_set_user_role` · `admin_set_user_status` · `record_login` · `set_bank_account_no` · `reveal_bank_account` · `link_document` · `drive_status` · `keepalive` |

**Job / Edge Function เท่านั้น** (`REVOKE … FROM PUBLIC, anon, authenticated` · `GRANT … TO service_role`): `server_bootstrap_family` · `server_register_invited_user` · `server_upsert_fx_rates` · `server_fx_settings` · `server_price_targets` · `server_upsert_prices` · `server_drive_begin` · `server_drive_finish` · `server_drive_check_state` · `server_drive_config` · `server_drive_set_folder` · `server_attach_month_pdf` · `server_log_event`

---

## 7. งานนอกฐานข้อมูล

| ส่วน | รายละเอียด | Secret |
|---|---|---|
| Edge Function `invite-user` | เชิญ / ส่งลิงก์ใหม่ / รีเซ็ตรหัสผ่าน / รีเซ็ต MFA (ADMIN + MFA) | อัตโนมัติจาก Supabase |
| Edge Function `drive` | Google Drive (`drive.file`) อัปโหลด / ดู / ตรวจไฟล์ซ้ำ · รับ Backup เข้ารหัส | `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · Vault `fwv_drive_refresh_token` |
| Edge Function `fx-refresh` | ปุ่ม "อัปเดตอัตราตอนนี้" (ADMIN · ห่าง 5 นาที) → สั่งรัน `fx-rates.yml` | `GITHUB_DISPATCH_TOKEN` (fine-grained · repo นี้ · Actions read/write) |
| `fx-rates.yml` + `scripts/fx-fetch.mjs` | 09:30 / 14:30 / 19:30 · ธปท. หรือ ธนาคารกรุงเทพ (อัตราโอน · หน่วย JPY ÷100, IDR/VND/LAK ÷1,000 · 19 สกุล) | `SUPABASE_SECRET_KEY` · `BOT_API_TOKEN` · `BBL_API_KEY` |
| `prices.yml` + `scripts/price-fetch.mjs` | จ.–ศ. 18:45 · หุ้น Yahoo · กองทุน ก.ล.ต. · ทองคำราคารับซื้อสมาคมค้าทองคำ (เทียบราคาโลก ต่างเกิน 3% ไม่บันทึก) | `SUPABASE_SECRET_KEY` · `SEC_API_KEY` |
| `db-backup.yml` | Backup รายสัปดาห์ เข้ารหัส → Google Drive | `BACKUP_PASSPHRASE` ฯลฯ (ดู `BACKUP_RESTORE.md`) |
| `supabase-keepalive.yml` | กัน Project แผน Free ถูกหยุด | publishable key |

---

## 8. จุดที่ยังเปิดอยู่ (เกี่ยวกับฐานข้อมูล)
- Supabase advisors: ฟังก์ชัน SECURITY DEFINER ที่ผู้ใช้เรียกได้ 28 ตัว (ตั้งใจ · ตรวจสิทธิ์ภายในฟังก์ชัน) · Leaked password protection ปิดอยู่ (เปิดตอนอัปเกรด Pro)
- ตาราง `private.drive_settings` / `public.bank_account_secrets` เปิด RLS โดยไม่มี Policy (ตั้งใจ · เข้าถึงผ่าน Function เท่านั้น)
- ก่อน Go-live: ล้างข้อมูลทดสอบ → `server_bootstrap_family` ใหม่ → นำเข้าข้อมูลจริง (สคริปต์นอก repo) → Confirm Go-live
