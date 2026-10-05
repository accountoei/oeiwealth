# Family Wealth Vault — Physical Schema V1.1 (Supabase / PostgreSQL)

> **Status:** Draft 1 (04 Oct 2026) · สร้างจาก **Core Schema V1.1 (FROZEN)** · ทดสอบบน PostgreSQL 16 + Supabase stub · **ผ่าน 98 test checks**
> เอกสารคู่กัน: Core Schema V1.1 (กติกา) · Wireframe Summary V1.1 (หน้าจอ)
> เอกสารนี้อธิบายว่า Database **ทำตามกติกาอย่างไร** ส่วนตัวกติกายังอยู่ใน Core Schema V1.1

---

## 1. สิ่งที่ได้

| รายการ | จำนวน | อยู่ที่ |
|---|---:|---|
| ตาราง | 51 (50 ตารางตาม V1.1 + `system_job_runs`) | `supabase/migrations/0200–0600` |
| View | 23 (ทุกตัว `security_invoker = true`) | `1300`, `1400` |
| Function ที่แอป/Server เรียก (RPC) | 21 | `1400`, `1500` |
| Function ภายใน (schema `private`) | 85 | `0900`, `1100`–`1400` |
| Trigger | 211 | `1000`, `1200` |
| RLS Policy | 138 | `1600` |
| Test checks | 98 (ผ่านทั้งหมด) | `tests/10_scenario.sql` |

```text
fwv-db/
├── supabase/migrations/          ← รันตามลำดับชื่อไฟล์ (Supabase CLI ใช้ลำดับนี้)
│   ├── …0100_foundation.sql              Extensions, schema private, Domains, Timezone
│   ├── …0200_core_tables.sql             families, persons, app_users, audit_logs, assets, ownerships, valuations, fx_rates
│   ├── …0300_financial_investment_tables.sql  bank, portfolio, holdings, transactions, valuations, FCN, loans, business
│   ├── …0400_liability_property_alt_tables.sql liabilities, property, leases, alternative
│   ├── …0450_protection_family_tables.sql      insurance, health, cards, membership, points
│   ├── …0500_income_expense_cash_tables.sql    income, expenses, reimbursements, cash_movements, reconciliation, recurring
│   ├── …0600_documents_snapshots_system_tables.sql documents, snapshots, completeness, job runs
│   ├── …0900_helpers_guards.sql          Role helpers, FX lookup, Period Lock, Generic Guards, Audit
│   ├── …1000_wiring_generic.sql          ติด Guard ทุกตาราง + FK → app_users
│   ├── …1100_domain_calc_functions.sql   คำนวณ Holding / In-transit / Loan / Bank + Cache refresher
│   ├── …1200_domain_triggers.sql         Validation + Sync Source → Derived (Source Matrix)
│   ├── …1300_networth_engine_views.sql   Net Worth Engine + View ทั้งหมด
│   ├── …1400_readiness_closing.sql       Go-live Readiness + Month Closing Checks
│   ├── …1500_controlled_functions.sql    RPC: Go-live, เลขบัญชี, Transfer, Recon, Finalize/Reopen, Users, FX Job
│   ├── …1600_rls_grants.sql              RLS + สิทธิ์
│   └── …1700_seed_reference.sql          หมวด Alternative มาตรฐาน + กติกา Completeness เริ่มต้น
├── tests/
│   ├── 00_supabase_stub.sql      จำลอง auth / vault / roles (ใช้ทดสอบในเครื่องเท่านั้น ห้ามรันบน Supabase)
│   ├── 10_scenario.sql           Scenario ครบ Flow: Setup → Go-live → ก.ค. → ปิดเดือน → Lock → Reopen
│   └── run.sh                    สร้าง DB ใหม่ + รัน migrations (+ tests เมื่อใส่ --scenario)
└── docs/Family_Wealth_Vault_Physical_Schema_V1.1.md   (ไฟล์นี้)
```

---

## 2. วิธีติดตั้งบน Supabase (ตามลำดับ)

> ทำบน Project **Test** ก่อน แล้วค่อยทำ Production · อย่าใช้ Production จนกว่าจะผ่านการทดสอบบน Test

1. **สร้าง Project** (Region: Singapore) · Production ใช้แผน Pro (มี Backup, ไม่ Auto-pause)
2. **Authentication → Providers:** ปิด *Allow new users to sign up* (เข้าระบบได้ผ่าน Invite เท่านั้น)
3. **Vault → New secret:** ชื่อ `fwv_bank_account_key` ค่า = ข้อความสุ่มยาว ≥ 32 ตัวอักษร
   - เก็บสำเนา Key นี้แยกไว้ Offline · **ถ้าหาย เลขบัญชีเต็มที่เข้ารหัสไว้จะอ่านไม่ได้อีกเลย**
4. **API settings → Exposed schemas:** ให้มีแค่ `public` (และ `graphql_public` ถ้าใช้) · **ห้ามใส่ `private`**
5. **รัน Migrations:** `supabase db push` (CLI) หรือวางทีละไฟล์ใน SQL Editor ตามลำดับชื่อไฟล์
6. **Bootstrap** (ครั้งเดียว โดย Server/Edge Function ที่ใช้ service role):
   `select server_bootstrap_family('<ชื่อครอบครัว>', '2026-10-01', '<auth user id ของ ADMIN คนแรก>', '<email>', '<ชื่อสมาชิก>');`
7. Invite **ADMIN คนที่ 2** ทันที (Admin Recovery Plan) และเปิด **MFA** ให้ ADMIN ทั้งสองคน
8. ตั้ง **FX Job** (Edge Function + Cron) เรียก `server_upsert_fx_rates(...)` ทุกวัน · Backfill ย้อนหลังอย่างน้อย 7 วันก่อนวันตั้งต้น

> **ห้ามรัน** `tests/00_supabase_stub.sql` บน Supabase — ไฟล์นี้แค่จำลองสิ่งที่ Supabase มีให้อยู่แล้ว

---

## 3. หลักการออกแบบ

### 3.1 ชนิดข้อมูล

| Domain | ชนิด | ใช้กับ |
|---|---|---|
| `d_money` | `numeric(20,4)` | จำนวนเงินทุกสกุล รวม `*_base_*` (THB) |
| `d_qty` | `numeric(30,10)` | จำนวนหน่วย (หุ้น / กองทุน / Crypto / Points) |
| `d_price` | `numeric(30,10)` | ราคาต่อหน่วย / ต้นทุนเฉลี่ย |
| `d_fx` | `numeric(20,10) > 0` | อัตราแลกเปลี่ยน (1 หน่วยต่างประเทศ = X THB) |
| `d_pct` | `numeric(7,4)` 0–100 | สัดส่วนเจ้าของ / ผู้รับผลประโยชน์ / ผู้รับผิดชอบหนี้ |
| `d_rate` | `numeric(12,6)` | ดอกเบี้ย / Coupon / Level ของ FCN |
| `d_currency` | `text` `^[A-Z]{3}$` | รหัสสกุลเงิน |
| `d_month` | `date` วันที่ 1 เท่านั้น | `year_month`, `snapshot_month`, `income_period` (เก็บเป็นวันที่ 1 ของเดือน) |

- ไม่มี `FLOAT` ที่ไหนเลย (Section 2.4)
- ID ทุกตัวเป็น `uuid` (`gen_random_uuid()`)
- รหัสสถานะ/ประเภทใช้ `text + CHECK` แทน ENUM → เพิ่มค่าใหม่ได้ด้วยการแก้ CHECK อย่างเดียว
- Timezone ของ Database = **Asia/Bangkok** (`current_date`, สิ้นเดือน และการตรวจ "วันในอนาคต" เป็นวันที่ไทยทั้งหมด)

### 3.2 META (Section 2.5)

ทุกตารางมี `created_at/by`, `updated_at/by`, `deleted_at/by` (FK → `app_users`) ยกเว้น:
- `app_users` ใช้ `status = DISABLED` แทน `deleted_*`
- `audit_logs`, `system_job_runs`, Snapshot Items/Lines เขียนครั้งเดียว ไม่แก้

Trigger `t10_meta` เติมค่าเหล่านี้เอง Client ตั้งค่าเองไม่ได้

### 3.3 Client vs Trusted

| | ใคร | ตัวอย่าง |
|---|---|---|
| **Client** | `current_user` = `authenticated` / `anon` (ทุกอย่างที่มาจาก Supabase API) | หน้าเว็บของแอป |
| **Trusted** | SECURITY DEFINER function ของระบบ (owner `postgres`) และ `service_role` (Edge Function) | Trigger ที่ Sync Derived Record, `finalize_month()` |

Guard ตรวจว่า "ใครเขียน" จาก **`current_user`** · Core Schema เรียกกลไกนี้ว่า *Session Flag* · ผลเหมือนกัน และ Client ปลอมไม่ได้

### 3.4 ลำดับ Trigger ในแต่ละตาราง

```text
BEFORE:  t05_block_hard_delete → t10_meta → t20_cache → t30_derived → t40_final_guard
         → t50_* (คำนวณ/ตรวจกติกาของตารางนั้น) → t90_period_lock (ตรวจค่าสุดท้าย)
AFTER:   a50_sync (สร้าง/Sync Derived + Cache) → a60_fill → z90_audit
```

---

## 4. Guard (Section 6, 37, 42)

| Guard | ทำอะไร | ใช้กับ |
|---|---|---|
| **META** | แก้ `created_*` ไม่ได้ · Soft Delete = ADMIN/EDITOR · Restore = ADMIN · Record ที่ถูกลบต้อง Restore ก่อนแก้ | ทุกตาราง |
| **Hard Delete block** | Client ใช้ `DELETE` ไม่ได้ (ไม่มีสิทธิ์ DELETE / TRUNCATE เลย) | ทุกตาราง |
| **Cache Field** | Client แก้ Field ที่ระบบคำนวณไม่ได้ (Insert → ถูกรีเซ็ต, แก้ → Error) | 15 ตาราง เช่น `assets.current_value`, `investment_holdings.quantity/average_cost`, `*.base_amount`, `bank_reconciliations.*`, Field Settle เงินประกันของ Lease |
| **Derived Lock** | Client สร้าง/แก้ Derived Record ไม่ได้ → ต้องแก้ที่ Source | `cash_movements.is_derived`, `income_transactions.source_transaction_id`, `expense_items.source_cash_movement_id`, `investment_transactions.cash_movement_id` |
| **Period Lock** | Effective Date ≤ วันสิ้นเดือน FINAL ล่าสุด → เขียนไม่ได้ **ทุกทาง** รวม Trusted Trigger | 10 ตารางตาม Section 37 + ยอดบัตร + ยอดตั้งต้นเงินให้กู้ |
| **Go-live Lock** | หลัง LIVE ห้ามรายการก่อน Go-live · แก้ยอดตั้งต้นได้เฉพาะ **ADMIN พร้อมเหตุผลใน `notes`** → Audit `EDIT_OPENING_POSITION` | ตารางเดียวกัน |
| **FINAL Snapshot** | Header / Items / Lines ที่ FINAL แก้ไม่ได้แม้ Trusted (ยกเว้นผ่าน `reopen_month()`) | `net_worth_snapshots*` |
| **Audit Immutable** | UPDATE / DELETE `audit_logs` ไม่ได้ แม้แต่ `postgres` | `audit_logs` |

**Period Lock ของรายการ 2 วันที่:** Trade ปลาย ก.ค. ที่ Settle ส.ค. จะแก้ไม่ได้เมื่อ ก.ค. FINAL เพราะวันหนึ่งอยู่ในงวดที่ปิดแล้ว (Section 37) — ทดสอบแล้ว

---

## 5. Source → Derived (Source Matrix 25B, 44A)

| Source (ผู้ใช้กรอก) | Derived (ระบบสร้างให้) | ยอด |
|---|---|---|
| `income_transactions` + `received_to_asset_id` | `cash_movements` INCOME | `amount − tax` |
| `expense_items` + `paid_from_asset_id` | `cash_movements` EXPENSE | `amount` |
| `expense_reimbursements` + `received_to_asset_id` | `cash_movements` REIMBURSEMENT_IN | `amount` |
| `cash_movements` INVESTMENT_OUT (ธนาคาร → พอร์ต) | `investment_transactions` DEPOSIT | `amount` |
| `cash_movements` INVESTMENT_IN (พอร์ต → ธนาคาร) | WITHDRAWAL + FEE (ถ้ามีค่าธรรมเนียม) | `amount`, `fee` |
| `cash_movements` ที่มีค่าธรรมเนียมออกจากบัญชีธนาคาร | `expense_items` BANK_FEE (เว้นแต่ `metadata.fee_as_expense = false`) | `fee` |
| `investment_transactions` BUY + `settle_from` | `cash_movements` INVESTMENT_OUT ลงวันที่ Settlement | `amount + fee` |
| SELL / REDEMPTION / MATURITY + `settle_to` | `cash_movements` INVESTMENT_IN | `amount − fee − tax` |
| DIVIDEND / INTEREST / COUPON | `income_transactions` (1:1) + `cash_movements` **INCOME** (ถ้ามี `settle_to`) | `amount − fee − tax` |
| `cash_movements` LOAN_* | `loan_details.outstanding_principal` | ยอดตั้งต้น + ให้กู้เพิ่ม − รับคืนเงินต้น |
| Lease ใหม่ที่มี `deposit_carried_from_lease_id` | Lease เดิม: `deposit_settled_date = new.start_date`, CARRIED | – |

- **Idempotent:** 1 Source = 1 Derived (Unique Index) · Soft Delete / Restore ที่ Source → Derived ตามไปด้วย **(แถวเดิม ไม่สร้างซ้ำ)**
- **ไม่มีทางย้อนกลับ:** Derived ไม่สร้าง Source (ไม่เกิด Trigger Loop)
- **Section 44A ข้อ 1–2, 5:** `cash_movements` ประเภท INCOME / EXPENSE / REIMBURSEMENT_IN ต้องเป็น Derived เท่านั้น (CHECK) · DEPOSIT / WITHDRAWAL ในพอร์ตต้องมาจาก Transfer Money เท่านั้น

---

## 6. การคำนวณหลัก

| เรื่อง | วิธีคำนวณ |
|---|---|
| **Holding (ไม่ใช่เงินสด)** | Average Cost ตามลำดับวันที่ของรายการ · มูลค่า = ราคา Statement ล่าสุด × จำนวนหน่วยปัจจุบัน · ยังไม่มี Statement = ราคาทุน ("ราคาทุน · รอ Statement") |
| **CASH Holding ในพอร์ต** | ยอด Statement ล่าสุด + Net Cash ของรายการในพอร์ตหลัง Statement (BUY/SELL/DIV/FEE… ที่ไม่ผ่านบัญชีธนาคาร) · ไม่นับเงินโอนเข้า/ออก เพราะนับเป็น **In-transit** แล้ว จึงไม่ซ้ำ |
| **In-transit** | Transfer Money หลัง Statement ล่าสุดของ CASH Holding (ถ้ายังไม่มี Statement → นับจากวันตั้งต้นของ CASH) |
| **Unsettled** | Trade ที่ชำระผ่านบัญชีธนาคาร และ วัน Trade ≤ D < วัน Settlement → รอรับ (+) / รอจ่าย (−) |
| **Portfolio THB** | SUM `base_value` ของแต่ละ Holding (FX ของ Statement นั้น) · **Display Value** = แปลงทีละ Holding เป็นสกุลพอร์ตแล้วรวม |
| **Bank Calculated** | Confirmed ล่าสุด + Movement หลังวันนั้น (ฝั่งออก = `amount + fee`) |
| **FX** | Previous Available Rate: `rate_date < D` · ไม่มี Rate → `base_amount` ว่าง → ปิดเดือน **BLOCKED** → ADMIN Override แล้วระบบเติมให้เอง |
| **Net Worth Engine** `private.net_worth_items(family, D, confirmed)` | Function เดียวใช้ทั้ง Dashboard (ยอดบัญชีแบบ Calculated) และ Month Closing (ยอด Confirmed จากการกระทบยอด) · 1 แถว = 1 รายการ × 1 เจ้าของ + แถว Unallocated เมื่อสัดส่วนไม่ครบ 100% |

---

## 7. View (ทุกตัว `security_invoker = true`)

| View | ใช้ทำอะไร |
|---|---|
| `v_assets_active`, `v_asset_ownerships_active`, `v_asset_valuations_active`, `v_holdings_active` | Normal View: ซ่อนแถวที่ถูกลบ (Child ซ่อนเมื่อ Parent ถูกลบ) |
| `v_bank_accounts_safe` | เลขบัญชีแบบ Mask `••••1234` (ไม่แตะ Secret) |
| `v_bank_balance_current` | Confirmed / Calculated + ป้าย |
| `v_investment_transactions_net`, `v_unsettled_trades`, `v_portfolio_values` | Net Cash · รอ Settle · มูลค่าพอร์ต THB / Display / In-transit |
| `v_liabilities_all` | เงินกู้ + บัตรเครดิต + เงินประกันการเช่า |
| `v_lease_status`, `v_lease_rent_tracking` | สถานะสัญญา + สถานะเงินประกัน (Derived) · ค่าเช่าตามสัญญาเทียบกับที่ได้รับจริง |
| `v_expected_income` | รายได้ที่ควรได้จาก Recurring + Lease (RECEIVED / DISMISSED / PENDING / OVERDUE) |
| `v_income_by_person`, `v_expense_by_person`, `v_net_worth_by_person` | มุมมองรายบุคคล (Unallocated → `person_id = NULL`) |
| `v_net_worth_items_current` | Net Worth ปัจจุบันรายบรรทัด (Dashboard) |
| `v_expense_reimbursement_status` | NONE / PENDING / PARTIAL / FULL |
| `v_loans_status`, `v_insurance_status`, `v_documents_status`, `v_fx_status` | Derived Status (DUE_SOON / EXPIRING_SOON / FX_STALE …) |
| `v_go_live_readiness` | หน้า Opening Setup: READY / WARN / MISSING / NOT_REQUIRED |

View ที่เรียก Function ภายในจะกรอง Role เพิ่มด้วย → ผู้ใช้ DISABLED ที่ยังถือ JWT อยู่จะไม่เห็นอะไรเลย

---

## 8. RPC (Function ที่แอปเรียก)

| Function | ใครเรียกได้ | ทำอะไร |
|---|---|---|
| `record_login()` | ทุกคน | INVITED → ACTIVE, Audit LOGIN, ปฏิเสธ DISABLED |
| `set_bank_account_no(id, no)` | A / E / C (C: เฉพาะแถวของตัวเองภายใน 24 ชม.) | เข้ารหัสด้วย pgcrypto + Key จาก Vault, ตั้ง `last4`, Audit |
| `reveal_bank_account(id)` | A / E | ถอดรหัส + Audit `VIEW_SENSITIVE` |
| `confirm_go_live()` | A | ตรวจ Readiness → LIVE + Audit |
| `transfer_money(from, to, amount, date, fee, …)` | A / E / C | โอน ธนาคาร ↔ พอร์ต (Section 11) |
| `record_holding_maturity(…)` | A / E / C | FCN / Holding ครบกำหนด → MATURED + เงินเข้าบัญชี |
| `receive_loan_payment(…)` | A / E / C | เงินต้น (Movement) + ดอกเบี้ย (Income) ผูก `movement_group_id` เดียวกัน |
| `settle_security_deposit(…)` | A / E | คืน/หักเงินประกัน · ส่วนที่หัก → รายได้ OTHER (ไม่มี Movement) |
| `update_bank_balance(…)` | A / E / C | อัปเดตยอดกลางเดือน · เก็บ `unexplained_difference` ไม่สร้าง Expense |
| `prepare_bank_reconciliation(asset, month)` | A / E / C | คำนวณยอดต้นเดือน + เงินเข้า/ออก |
| `confirm_bank_reconciliation(…)` | A / E | RECONCILED / CONFIRMED_WITH_DIFFERENCE (ต้องมีเหตุผล) + Valuation |
| `month_closing_checks(month)` | ทุกคน | 7 หมวด: READY / REVIEW / BLOCKED พร้อมรายการ |
| `finalize_month(month)` | A / E | สร้าง Items + Lines ใหม่, Reconcile, FINAL, Audit |
| `reopen_month(month, reason)` | A | เฉพาะเดือนล่าสุด + Audit พร้อมเหตุผล |
| `admin_set_user_role`, `admin_set_user_status` | A | ต้องเหลือ ADMIN อย่างน้อย 1 คนเสมอ |
| `server_bootstrap_family`, `server_register_invited_user`, `server_log_event`, `server_upsert_fx_rates`, `server_attach_month_pdf` | **service_role เท่านั้น** | ให้ Edge Function / Job ใช้ |

A = ADMIN, E = EDITOR, C = CONTRIBUTOR

---

## 9. RLS (Permission Matrix, Section 5)

| กลุ่มตาราง | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| ข้อมูลทั่วไป (41 ตาราง) | ทุก Role ที่ ACTIVE | A / E / C | A / E ทุกแถว · C เฉพาะแถวตัวเองใน 24 ชม. ที่ยังไม่ถูกลบ | ✗ |
| `families` | ทุกคน | ✗ (Bootstrap) | A | ✗ |
| `app_users` | A ทุกแถว · คนอื่นเห็นแค่แถวตัวเอง | ✗ (Invite) | A (Role/Status ผ่าน Function) | ✗ |
| `audit_logs`, `system_job_runs` | A | ✗ | ✗ | ✗ |
| `net_worth_snapshots*` | ทุกคน | ✗ (ผ่าน Function เท่านั้น) | ✗ | ✗ |
| `fx_rates`, `data_completeness_rules` | ทุกคน | A (FX: Override เท่านั้น) | A | ✗ |
| `bank_account_secrets` | ✗ | ✗ | ✗ | ✗ |

- RLS ตรวจ **Role อย่างเดียว** ไม่กรอง `deleted_at` (Section 40)
- ผู้ใช้ DISABLED / INVITED = ไม่มี Role → ไม่เห็นอะไรเลย
- ตาราง/Function ที่สร้างภายหลัง **ไม่ได้สิทธิ์อัตโนมัติ** ต้อง GRANT + RLS เองทุกครั้ง

---

## 10. จุดที่ต้องตัดสินใจเพิ่ม (ขอให้ตรวจ)

บางเรื่อง Core Schema ไม่ได้บอกวิธีทำในระดับ Physical หรือมีกติกา 2 ข้อขัดกัน จึงต้องตัดสินใจเพิ่ม · **ไม่มีข้อไหนเปลี่ยนตาราง Logical**

| # | เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|---|
| 1 | Session Flag (Section 24) | ใช้ `current_user` แทน | ผลเหมือนกัน และ Client ปลอมไม่ได้ |
| 2 | `lease_id` ใน Income | อนุญาตทั้ง **RENT และ OTHER** | Section 24 ให้ใช้กับ RENT เท่านั้น แต่ Section 22 กำหนดให้ส่วนที่หักจากเงินประกันบันทึกเป็น OTHER ผูก `lease_id` · *เป็นจุดขัดใน V1.1 ควรบันทึกใน V1.2* |
| 3 | มูลค่า CASH Holding | Statement + Net Cash หลัง Statement | ถ้าไม่ทำ BUY ด้วยเงินในพอร์ตจะนับซ้ำ (ต้นทุน Holding ใหม่ + เงินสดยังเป็นยอด Statement) จนกว่าจะมี Statement ใหม่ |
| 4 | FX ของ Snapshot | Rate ก่อนวันปิดงวด ใช้กับทุกรายการ · **ยกเว้นบัตรเครดิต** ใช้ Rate ของ `balance_date` (Section 34) | `fx_rate_dates` เก็บ 1 วันต่อสกุล ตรงกับหน้าจอปิดเดือน |
| 5 | ปิดเดือนช้า | ยอดบัตร ณ สิ้นเดือน = เวอร์ชันที่ `balance_date` ล่าสุด ≤ สิ้นเดือน (สร้างประวัติจาก Audit) · สถานะสินทรัพย์/หนี้ = สถานะ ณ สิ้นวันนั้น (จาก Audit) + `ASSET_SALE` ตามวันที่ | อัปเดตยอดบัตรในเดือนถัดไปแล้ว Reopen เดือนก่อน Snapshot ยังใช้ยอดสิ้นเดือนที่ถูกต้อง |
| 6 | แก้ยอดตั้งต้นหลัง LIVE | ADMIN แก้ในหน้าปกติ ใส่เหตุผลใน `notes` → Audit `EDIT_OPENING_POSITION` · ถ้ามีเดือนที่ FINAL ต้อง Reopen ไล่กลับไปถึงเดือนแรกก่อน | ไม่ต้องทำฟอร์มแยก |
| 7 | ค่าธรรมเนียมเป็น Expense | ค่าเริ่มต้น = บันทึก · ตั้ง `metadata.fee_as_expense = false` เพื่อไม่บันทึก | V1.1 ข้อ 14 |
| 8 | สถานะ Holding | อัตโนมัติ: MATURITY → MATURED · ขายจนเหลือ 0 หน่วย → SOLD (AUTOCALLED ผู้ใช้ตั้งเอง) | ลดความผิดพลาด |
| 9 | ปิดเดือนก่อนสิ้นเดือน | ไม่ได้ (BLOCKED `MONTH_NOT_ENDED`) | ไม่อย่างนั้นยอดจะไม่ใช่ยอดสิ้นเดือน |
| 10 | `end_date` ของ Ownership | นับรวมวันนั้นด้วย (inclusive) | – |
| 11 | Audit Action เพิ่ม | `CONFIRM_GO_LIVE`, `EDIT_OPENING_POSITION` (มีชื่อในเนื้อหา Core Schema แล้ว), `SET_SENSITIVE`, `HARD_DELETE` | Section 39 ไม่ได้ระบุครบทุกตัว |
| 12 | ตาราง `system_job_runs` | บันทึกผล FX Job / Backup / PDF | Section 16, 45 กำหนดให้ต้องบันทึก แต่ไม่ได้ตั้งชื่อตาราง |
| 13 | เงินให้กู้ WRITTEN_OFF | มูลค่า Asset = 0 แต่ `outstanding_principal` ยังเก็บยอดจริง | รักษาประวัติ |
| 14 | วิธีเข้ารหัส (Section 48 ข้อ 8) | `pgcrypto.pgp_sym_encrypt` + Key ใน **Supabase Vault** | ปิดข้อ ☐ 8 ได้ |

---

## 11. ผลการทดสอบ (`tests/run.sh --scenario`)

Scenario ใช้ Go-live 01 Jul 2026 เพื่อให้ปิดเดือน ก.ค. ได้จริง · ทุกขั้นตอนรันด้วย Role จริง (ADMIN / EDITOR / CONTRIBUTOR / VIEWER / DISABLED / anon / service_role)

| หมวด | ตัวอย่างที่ผ่าน |
|---|---|
| Setup / Go-live | Ownership เกิน 100% ไม่ได้ · Readiness ไม่มี MISSING · EDITOR Confirm ไม่ได้ · หลัง LIVE แก้ Go-live Date ไม่ได้ · รายการก่อน Go-live ถูกปฏิเสธ |
| Derived Sync | Income → Movement 95,000 (หักภาษีแล้ว) · Transfer → DEPOSIT + BANK_FEE · BUY Settle T+2 → INVESTMENT_OUT 805 ลงวันที่ Settlement · DIVIDEND → INCOME 18 (ไม่ใช่ INVESTMENT_IN) · Soft Delete / Restore ตามไปด้วยโดยไม่สร้างซ้ำ |
| สิทธิ์ | CONTRIBUTOR แก้ของตัวเองใน 24 ชม. ได้ แต่แก้ของคนอื่นไม่ได้ · CONTRIBUTOR Soft Delete ไม่ได้ · VIEWER เพิ่มไม่ได้ · DISABLED เห็น 0 แถว · anon ถูกปฏิเสธ · ไม่มีใครอ่าน `bank_account_secrets` ได้ |
| Reconciliation | Calculated = ยอดต้น + เข้า − ออก · มีผลต่างต้องมีเหตุผล · ปัดเศษ 0.50 ผ่าน |
| Month Closing | ไม่มี BLOCKED · จ่ายบัตรหลังวันที่ของยอด → REVIEW · Header = SUM(Items) · Person Lines + Unallocated = ยอดครอบครัว · Unsettled Payable −805 · เงินประกันแบ่ง 60/40 |
| Period Lock | เพิ่ม/แก้รายการในเดือน FINAL ไม่ได้ · Trade ก.ค. ที่ Settle ส.ค. แก้ไม่ได้ · ยอดตั้งต้นเงินให้กู้ถูกล็อก |
| Reopen | EDITOR Reopen ไม่ได้ · ต้องมีเหตุผล · Finalize ใหม่ได้ Version 2 · บัตรยังใช้ยอดสิ้นเดือน |
| ความปลอดภัย | Audit แก้/ลบไม่ได้แม้แต่ postgres · ไม่มีเลขบัญชีเต็มใน Audit · ทุกตารางเปิด RLS · ทุก View เป็น security_invoker · ทุก SECURITY DEFINER ตั้ง `search_path = ''` |

ผลตรวจอิสระ (Agent อีกตัวที่ไม่ได้สร้างงานนี้) พบ HIGH 1 · MEDIUM 7 · LOW 5 → **แก้ครบทุกข้อ** และมี Test ของแต่ละข้อแล้ว

---

## 12. สิ่งที่ยังต้องทำ (นอก Database)

| งาน | หมายเหตุ |
|---|---|
| Edge Functions | Invite User (Auth Admin API → `server_register_invited_user`), Google Drive Upload/View (`server_log_event`), Monthly PDF (`server_attach_month_pdf`), FX Job (BOT API → `server_upsert_fx_rates`), Backup Job |
| Data Completeness % | ตารางกติกาพร้อมแล้ว · ตัว % คำนวณในแอปหรือ View ภายหลัง (Section 41 ไม่ให้เก็บ %) |
| Return Analysis | คำนวณจาก Transactions + Valuations (Section 17) ในแอป/View เฟสถัดไป |
| Section 48 ☐ | ข้อ 2 สูตร Return, ข้อ 3 BOT Field, ข้อ 7 Drive OAuth, ข้อ 10 Backup/Restore, ข้อ 11 PDF Layout |
| ทดสอบบน Supabase จริง | รัน Migrations บน Project Test แล้วเรียก `select * from month_closing_checks(...)` จากแอปด้วย JWT จริง |

### ข้อจำกัดที่รู้อยู่

- Expected Income แสดงงวดตั้งแต่เดือน Go-live ถึงเดือนปัจจุบันเท่านั้น (ไม่ฉายล่วงหน้า)
- `v_net_worth_items_current` คำนวณสดทุกครั้งที่เรียก · ครอบครัวเดียวไม่มีปัญหา ถ้าข้อมูลโตมากค่อยเพิ่ม Cache
- `asset_ownerships` ไม่ถูก Period Lock (Section 37 ไม่ได้กำหนด) · Snapshot ที่ FINAL Freeze ไว้แล้วอยู่ดี
