import { cachedLoad } from "@/lib/data-cache";
import { buildHints } from "@/lib/category-hints";
import { queryPfCash } from "@/lib/pf-cash";
import { INC_SELECT, MOVE_SELECT } from "./entry-kit";

/**
 * ข้อมูลหน้า Income & Expenses (5 พ.ย. 2026)
 *   เดิมถาม Supabase พร้อมกันราว 37 คำถามทุกครั้งที่เปิดหน้า / เปลี่ยนเดือน → เครื่อง Supabase แผนฟรีรับไม่ทัน
 *   ทุกคำถามช้าลงพร้อมกัน (1–2.4 วินาที · หน้าอื่นถาม 10–20 คำถาม ตอบใน 0.01–0.1 วินาที)
 * - แยกเป็นชุดไม่ขึ้นกับเดือน (loadIeRef) · ชุดของเดือน (loadIeMonth) · ส่วนแบ่งของสมาชิกที่เลือก (loadIePersonShares)
 * - ทุกชุดจำไว้แบบเดียวกับ Dashboard (cachedLoad ใน data-cache.ts): ผู้ใช้แต่ละคนจำแยกกัน (RLS เดิมทำงานตอนถาม)
 *   ล้างทันทีเมื่อมีการบันทึกใด ๆ / งานเบื้องหลังเสร็จ · เพดาน 1 ชั่วโมง · ขึ้นวันใหม่ / deploy ใหม่ ถามใหม่
 *   → เปลี่ยนเดือนถามเฉพาะชุดของเดือน · เดือนที่เคยเปิดแล้ว เปิดซ้ำไม่ต้องถาม Supabase จนกว่าจะมีการบันทึก
 * - มีคำถามที่ผิดพลาด → ไม่จำผลรอบนั้น (ใช้ผลที่ได้ตามเดิม แล้วถามใหม่ครั้งหน้า)
 * - จำเฉพาะที่หน้าใช้: จำนวนที่ใช้แต่ละหมวด / คำเดาหมวด คำนวณก่อนจำ (ไม่จำแถวดิบ)
 */

/** แทนคำถามที่ไม่ต้องถาม (ไม่มีรายการให้ค้น) */
const none = () => ({ data: [] as never[], error: null });

/** ข้อมูลที่ไม่ขึ้นกับเดือน: บัญชี / บัตร / หนี้ / สมาชิก / อัตราแลกเปลี่ยน / หมวด / รายการประจำ / สัญญาเช่า / กรมธรรม์ / คำเดาหมวด */
export function loadIeRef() {
  return cachedLoad(["ie-ref"], async (supabase) => {
    // ค่าเช่าจากสัญญาเช่าที่ยังมีผล (ดูอย่างเดียวในแท็บตั้งค่า · แก้ที่หน้าทรัพย์สิน) → ชื่อ / ประเภททรัพย์สิน เริ่มทันทีที่ได้รายการสัญญา
    const leaseQ = supabase.from("v_lease_status")
      .select("id,property_asset_id,unit_label,tenant_name,rent_amount,rent_currency,payment_frequency,payment_due_day,start_date,end_date,lease_status")
      .in("lease_status", ["ACTIVE", "EXPIRING_SOON", "UPCOMING"]).order("end_date").then((r) => r);
    const res = await Promise.all([
      supabase.from("families").select("go_live_date").maybeSingle(),
      supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
      supabase.from("credit_cards").select("id,person_id,issuer,card_name,card_last4,currency,outstanding_balance,balance_date,status,due_day,autopay_asset_id,autopay_cash_holding_id,autopay_mode")
        .is("deleted_at", null).neq("status", "CLOSED"),
      supabase.from("liabilities").select("id,name,currency,outstanding_amount").is("deleted_at", null).eq("status", "ACTIVE"),
      supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
      supabase.from("v_fx_status").select("currency,rate_to_thb"),
      supabase.from("recurring_income_templates").select("id,name,income_type,expected_amount,currency,frequency,due_day,active,person_id,receive_to_asset_id,start_date,end_date,persons(name)")
        .is("deleted_at", null).order("name"),
      supabase.from("insurance_claims").select("id,claim_date,claimed_amount,received_amount,currency,status,insurance_policies(insurer,policy_no,persons!insurance_policies_person_id_fkey(name))")
        .is("deleted_at", null).in("status", ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_PAID"]).order("claim_date", { ascending: false }),
      supabase.from("property_utilities")
        .select("id,utility_type,provider,expected_amount,currency,frequency,due_day,due_month,property_details!inner(asset_id,property_type,assets!inner(name,status,deleted_at))")
        .is("deleted_at", null).eq("active", true).not("frequency", "is", null),
      supabase.from("v_card_balances").select("card_id,current_balance"),
      // หมวดค่าใช้จ่าย / ประเภทย่อยรายได้อื่น (ตั้งค่าเองในแท็บ "ตั้งค่า") + จำนวนรายการที่ใช้แต่ละหมวด
      supabase.from("ie_categories").select("id,kind,name,sort_order,active").is("deleted_at", null).order("sort_order").order("name"),
      supabase.from("expense_items").select("expense_category").is("deleted_at", null).not("expense_category", "is", null),
      supabase.from("income_transactions").select("income_subtype").is("deleted_at", null).not("income_subtype", "is", null),
      supabase.from("recurring_expense_templates")
        .select("id,name,expense_category,person_id,expected_amount,currency,frequency,due_day,pay_via,pay_from_asset_id,pay_from_credit_card_id,start_date,end_date,active,notes,persons(name)")
        .is("deleted_at", null).order("name"),
      leaseQ,
      // ความคุ้มครองของกรมธรรม์ที่มีผล → "เคลมใหม่" ในฟอร์มบันทึกเงินคืน (สร้างเคลมให้เอง · ตกลง 2 พ.ย. 2026)
      supabase.from("insurance_coverages").select("id,coverage_type,currency,insurance_policies!inner(insurer,policy_no,status,deleted_at,persons!insurance_policies_person_id_fkey(name))")
        .is("deleted_at", null).eq("insurance_policies.status", "ACTIVE").is("insurance_policies.deleted_at", null),
      // บัญชีเงินฝากในพอร์ต (ค่าใช้จ่าย / จ่ายบัตร / ตัดบัตรอัตโนมัติจากพอร์ต)
      queryPfCash(supabase),
      // เดาหมวด / บัญชีจากรายการค่าใช้จ่ายที่เคยบันทึกเอง (ไม่รวมรายการจากหน้าอื่น / ก้อนรอแยก)
      supabase.from("expense_items")
        .select("description,expense_category,paid_from_asset_id,paid_from_credit_card_id")
        .is("deleted_at", null).eq("pending_split", false).is("source_cash_movement_id", null).is("liability_id", null)
        .is("insurance_schedule_line_id", null).is("property_utility_id", null)
        .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1500),
      // บ้าน / ที่ดินที่ถืออยู่ (ค่าใช้จ่ายหมวดบ้าน / สาธารณูปโภค เลือกทรัพย์สินได้ · ตกลง 30 ต.ค. 2026)
      supabase.from("property_details").select("asset_id,assets!inner(name,status,deleted_at)").is("deleted_at", null),
      leaseQ.then(async ({ data }) => {
        const ids = [...new Set(((data ?? []) as { property_asset_id: string }[]).map((l) => l.property_asset_id))];
        return ids.length ? await supabase.from("property_details").select("asset_id,property_type,assets!inner(name)").in("asset_id", ids) : none();
      }),
    ]);
    const [{ data: family }, { data: banksRaw }, { data: cardsRaw }, { data: liabRaw }, { data: persons }, { data: fx },
      { data: templates }, { data: claimsRaw }, { data: utilRows }, { data: cardBalRaw }, { data: catRows }, { data: catUseExp }, { data: catUseInc },
      { data: rexpTplRaw }, { data: leaseRaw }, { data: covRaw }, { data: pfCash }, { data: hintRows }, { data: propRows }, { data: leaseProps }] = res;
    const useCount = new Map<string, number>();
    (catUseExp ?? []).forEach((r) => { const k = `E:${r.expense_category}`; useCount.set(k, (useCount.get(k) ?? 0) + 1); });
    (catUseInc ?? []).forEach((r) => { const k = `I:${r.income_subtype}`; useCount.set(k, (useCount.get(k) ?? 0) + 1); });
    const catsOf = (kind: string) => (catRows ?? []).filter((c) => c.kind === kind)
      .map((c) => ({ id: c.id as string, name: c.name as string, active: !!c.active, used: useCount.get(`${kind === "EXPENSE" ? "E" : "I"}:${c.name}`) ?? 0 }));
    const expCatAll = catsOf("EXPENSE"), incSubAll = catsOf("INCOME_OTHER");
    return {
      complete: res.every((r) => !r.error),
      value: {
        goLive: (family?.go_live_date ?? "") as string, banksRaw, cardsRaw, liabRaw, persons, fx, templates, claimsRaw, utilRows, cardBalRaw,
        rexpTplRaw, leaseRaw, covRaw, pfCash, propRows, leaseProps, expCatAll, incSubAll,
        expHints: buildHints(hintRows ?? [], expCatAll.filter((c) => c.active).map((c) => c.name)),
      },
    };
  });
}

/** ข้อมูลของเดือน start–end: รายได้ / ค่าใช้จ่าย / เงินเข้า–ออก / งวดที่ครบกำหนด (+ ที่เลยกำหนดจากเดือนก่อน) / ยอดยกมา */
export function loadIeMonth(start: string, end: string) {
  return cachedLoad(["ie-month", start, end], async (supabase) => {
    const movesQ = supabase.from("cash_movements").select(MOVE_SELECT)
      .is("deleted_at", null).gte("movement_date", start).lte("movement_date", end)
      .order("movement_date", { ascending: false }).order("created_at", { ascending: false }).then((r) => r);
    const res = await Promise.all([
      supabase.from("income_transactions").select(INC_SELECT)
        .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
      supabase.from("v_expected_income").select("*").eq("income_period", start).order("due_date"),
      supabase.from("monthly_expenses").select("id,total_amount,tracking_status").eq("year_month", start).is("deleted_at", null).maybeSingle(),
      supabase.from("expense_items").select("id,date,description,amount,currency,base_amount,expense_category,property_cost_type,paid_from_asset_id,paid_from_credit_card_id,paid_from_cash_holding_id,liability_id,insurance_schedule_line_id,property_utility_id,source_fee_side,related_asset_id,pending_split,person_id,source_cash_movement_id,is_reimbursable,expected_reimbursement_amount,recurring_expense_id,notes,persons(name),ins_line:insurance_schedule_lines(policy_id),internal_loan_income_id,il:income_transactions!expense_items_internal_loan_income_id_fkey(asset_id)")
        .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
      // สถานะเงินคืน: เฉพาะรายการของเดือนนี้ (หน้าใช้แค่รายการในเดือน · เดิมดึงทุกเดือน)
      supabase.from("v_expense_reimbursement_status").select("expense_item_id,reimbursed_amount,reimbursement_status")
        .eq("is_reimbursable", true).gte("date", start).lte("date", end),
      supabase.from("expense_reimbursements").select("id,received_date,amount,currency,expense_item_id").is("deleted_at", null).gte("received_date", start).lte("received_date", end),
      movesQ,
      // ค่าใช้จ่ายประจำ (อสังหาฯ): งวดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
      supabase.from("v_property_cost_tracking")
        .select("utility_id,property_asset_id,property_name,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,currency,status,dismissal_id,dismissal_reason")
        .or(`cost_period.eq.${start},and(status.eq.OVERDUE,cost_period.lt.${start})`).order("due_date"),
      // งวดเงินให้กู้: ครบกำหนดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
      supabase.from("v_loan_schedule_status")
        .select("id,loan_asset_id,loan_name,borrower_name,currency,installment_no,due_date,principal_due,interest_due,total_due,principal_remaining,interest_remaining,total_remaining,status")
        .or(`and(due_date.gte.${start},due_date.lte.${end}),and(status.in.(OVERDUE,PARTIAL,DUE),due_date.lt.${start})`)
        .neq("status", "WRITTEN_OFF").order("due_date"),
      // งวดเบี้ยประกัน / ผลประโยชน์: ครบกำหนดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
      supabase.from("v_insurance_schedule_status")
        .select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,remaining,status,insurer,policy_no,person_id,payer_person_id,cash_value_asset_id")
        .or(`and(due_date.gte.${start},due_date.lte.${end}),and(status.in.(OVERDUE,PARTIAL),due_date.lt.${start})`)
        .not("status", "in", "(CLOSED,HISTORY,SKIPPED)").order("due_date"),
      // ค่าใช้จ่ายประจำทั่วไป: งวดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
      supabase.from("v_recurring_expense_tracking")
        .select("template_id,name,expense_category,person_id,pay_via,pay_from_asset_id,pay_from_credit_card_id,cost_period,due_date,expected_amount,paid_amount,currency,status,dismissal_id,dismissal_reason")
        .or(`cost_period.eq.${start},and(status.eq.OVERDUE,cost_period.lt.${start})`).order("due_date"),
      // จ่ายบัตรจากพอร์ตเดือนนี้ (บัตรตัดบัญชีอัตโนมัติ: จ่ายแล้วหรือยัง)
      supabase.from("investment_transactions").select("to_credit_card_id").eq("transaction_type", "PAYMENT").not("to_credit_card_id", "is", null)
        .is("deleted_at", null).gte("transaction_date", start).lte("transaction_date", end),
      // ยอดยกมา (สิ้นเดือนก่อน) ของแต่ละบัญชี
      supabase.rpc("bank_balances_at", { p_date: new Date(Date.parse(`${start}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) }),
      // ยอดอัปเดตคงเหลือในเดือนนี้ (หน้าเลือกเฉพาะบัญชีธนาคาร · ถามรวมเพื่อไม่ต้องรอรายชื่อบัญชี)
      supabase.from("asset_valuations").select("id,asset_id,valuation_date,value").is("deleted_at", null).gte("valuation_date", start).lte("valuation_date", end),
      // ชื่อทรัพย์สินในรายการเงินเข้า–ออก (เงินให้กู้ / พอร์ต / ทรัพย์สิน / มูลค่าเวนคืน) · เริ่มทันทีที่ได้รายการ
      movesQ.then(async ({ data }) => {
        const ids = [...new Set(((data ?? []) as { from_asset_id: string | null; to_asset_id: string | null }[])
          .flatMap((m) => [m.from_asset_id, m.to_asset_id]).filter((x): x is string => !!x))];
        return ids.length ? await supabase.from("assets").select("id,name,asset_type").in("id", ids) : none();
      }),
    ]);
    const [{ data: incomes }, { data: expected }, { data: month }, { data: items }, { data: reimbStatus }, { data: reimbs }, { data: moves },
      { data: costRows }, { data: loanRows }, { data: insRows }, { data: rexpRows }, { data: pfCardPays }, { data: openRaw }, { data: valuations },
      { data: moveAssets }] = res;
    return {
      complete: res.every((r) => !r.error),
      value: { incomes, expected, month, items, reimbStatus, reimbs, moves, costRows, loanRows, insRows, rexpRows, pfCardPays, openRaw, valuations, moveAssets },
    };
  });
}

/** มุมมองรายบุคคล: ส่วนแบ่งรายได้ / ค่าใช้จ่ายของสมาชิกที่เลือกในเดือนนี้ (กติกาเดียวกับ Dashboard) */
export function loadIePersonShares(personId: string, start: string, end: string) {
  return cachedLoad(["ie-person", personId, start, end], async (supabase) => {
    const res = await Promise.all([
      supabase.from("v_income_by_person").select("income_id,share_percent,amount_share,tax_share,base_amount_share")
        .eq("person_id", personId).gte("date", start).lte("date", end),
      supabase.from("v_expense_by_person").select("expense_item_id,share_percent,amount_share,base_amount_share")
        .eq("person_id", personId).gte("date", start).lte("date", end),
    ]);
    return { complete: res.every((r) => !r.error), value: { incShares: res[0].data, expShares: res[1].data } };
  });
}
