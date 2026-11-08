"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { bankId, cardId, endpointFromForm, paidFromColumns, parseEndpoint } from "@/lib/money-endpoint";
import { BAD_ROWS_ERROR, amountOrNull, isPositive, notSaved, plainNumber, readRows } from "@/lib/batch-entry";
import { bookletGroups, bookletRole, type BookletPolicy } from "@/lib/insurance-booklet";

export type ActionState = FormState;
/** ผลลงมูลค่าเวนคืนตามตารางในสัญญา (sync_insurance_cash_value) */
export type CvSync = { added: number; created: boolean; value?: number; date?: string; policy_year?: number };
export type PayState = ActionState & { cv?: CvSync };

/** "จ่ายเบี้ยจาก (ค่าตั้งต้น)" (pay_default = a:<บัญชี> / c:<บัตร> / ว่าง) → คอลัมน์ของกรมธรรม์ · ฐานข้อมูลตรวจสกุล / ประเภทบัญชี */
function payDefault(form: FormData) {
  const e = parseEndpoint(str(form.get("pay_default")));
  return { paid_from_asset_id: bankId(e), paid_from_credit_card_id: cardId(e) };
}

function bens(form: FormData) {
  try { return JSON.parse(String(form.get("beneficiaries") ?? "[]")); } catch { return []; }
}

/** สัญญาเพิ่มเติมจากฟอร์ม (JSON · ตัวเลขตัดคอมมาซ้ำอีกชั้น) · อ่านไม่ได้ = null */
function ridersFromForm(form: FormData): Record<string, unknown>[] | null {
  let xs: unknown = [];
  try { xs = JSON.parse(String(form.get("riders") ?? "[]")); } catch { return null; }
  if (!Array.isArray(xs)) return null;
  return xs.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (v == null ? null : String(v));
    return {
      insurance_type: s(o.insurance_type), insured_amount: num(s(o.insured_amount)), premium: num(s(o.premium)),
      end_date: str(s(o.end_date)), notes: str(s(o.notes)), coverages: Array.isArray(o.coverages) ? o.coverages : [],
      plan_name: str(s(o.plan_name)), coverage_scope: str(s(o.coverage_scope)),
    };
  });
}

export async function createPolicy(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  // ตารางความคุ้มครอง (ถ้ากรอก) บันทึกในคำสั่งเดียวกับกรมธรรม์ (ตกลง 7 พ.ย. 2026)
  let covs: unknown = [];
  try { covs = JSON.parse(String(form.get("coverages") ?? "[]")); } catch { return { error: "อ่านตารางความคุ้มครองไม่ได้" }; }
  if (!Array.isArray(covs)) return { error: "อ่านตารางความคุ้มครองไม่ได้" };
  // สัญญาเพิ่มเติม (ถ้ามี) + ผู้จ่ายเบี้ย / จ่ายเบี้ยจาก บันทึกพร้อมกันทั้งเล่ม (ผิดส่วนเดียว = ไม่บันทึกเลย)
  const riders = ridersFromForm(form);
  if (!riders) return { error: "อ่านข้อมูลสัญญาเพิ่มเติมไม่ได้" };
  const pay = payDefault(form);
  const { data, error } = await supabase.rpc("create_insurance_booklet", { p: {
    insurance_type: str(form.get("insurance_type")), person_id: str(form.get("person_id")), insured_asset_id: str(form.get("insured_asset_id")),
    insurer: str(form.get("insurer")), policy_no: str(form.get("policy_no")), start_date: str(form.get("start_date")),
    end_date: str(form.get("end_date")), insured_amount: num(form.get("insured_amount")), premium: num(form.get("premium")),
    // ไม่มีปุ่มติ๊ก "มีมูลค่าเวนคืน" แล้ว (ตกลง 8 พ.ย. 2026): ใส่ตารางมูลค่าเวนคืนในหน้ากรมธรรม์ → ระบบสร้างให้เอง
    currency: str(form.get("currency")), has_cash_value: false,
    owners: ownersFromForm(form), beneficiaries: bens(form), notes: str(form.get("notes")), coverages: covs,
    payer_person_id: str(form.get("payer_person_id")), paid_from_asset_id: pay.paid_from_asset_id, paid_from_credit_card_id: pay.paid_from_credit_card_id,
    plan_name: str(form.get("plan_name")), coverage_scope: str(form.get("coverage_scope")), coverage_checked_on: str(form.get("coverage_checked_on")),
    riders,
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance");
  redirect(`/insurance/${data}`);
}

/** ปุ่ม "+ เพิ่มสัญญาเพิ่มเติม" หน้าเล่ม: ส่วนใหม่ใช้ข้อมูลร่วมของสัญญาหลัก (ตกลง 7 พ.ย. 2026) */
export async function addRiders(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const riders = ridersFromForm(form);
  if (!riders) return { error: "อ่านข้อมูลสัญญาเพิ่มเติมไม่ได้" };
  if (riders.length === 0) return { error: "ยังไม่ได้ใส่สัญญาเพิ่มเติม" };
  // ตรวจกับกรมธรรม์เมื่อ (ช่องเดียวในหน้าต่าง) = ของทุกส่วนที่เพิ่ม
  const checked = str(form.get("coverage_checked_on"));
  const { error } = await supabase.rpc("create_insurance_booklet", { p: { main_id: str(form.get("main_id")),
    riders: riders.map((r) => ({ ...r, coverage_checked_on: checked })) } });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  revalidatePath("/family", "layout");   // สรุปสิทธิ์รักษาของสมาชิก
  return { ok: `เพิ่มสัญญาเพิ่มเติมแล้ว ${riders.length} ส่วน` };
}

export async function saveBeneficiaries(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { error } = await supabase.rpc("set_beneficiaries", { p_policy_id: id, p_list: bens(form) });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance", "layout");   // ทุกหน้ากรมธรรม์ (สัญญาเพิ่มเติมแสดงที่หน้ารายการหลักของเล่ม)
  return { ok: "บันทึกผู้รับผลประโยชน์แล้ว" };
}

export async function addClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(form.get("policy_id"));
  if (!id) return { error: "กรุณาเลือกกรมธรรม์" };
  const { error } = await supabase.from("insurance_claims").insert({
    policy_id: id, incident_date: str(form.get("incident_date")), claim_date: str(form.get("claim_date")),
    claimed_amount: num(form.get("claimed_amount")), currency: str(form.get("currency")) ?? "THB",
    status: str(form.get("status")) ?? "SUBMITTED", notes: str(form.get("notes")), coverage_id: str(form.get("coverage_id")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance", "layout");   // ทุกหน้ากรมธรรม์ (สัญญาเพิ่มเติมแสดงที่หน้ารายการหลักของเล่ม)
  revalidatePath("/family/health");         // เคลมล่าสุดของสมาชิก
  return { ok: "บันทึกเคลมแล้ว" };
}

/** ประกันทรัพย์สิน: เบี้ยที่จ่ายผูกกับทรัพย์สินที่เอาประกัน (related_asset_id) → นับเป็นค่าใช้จ่ายของทรัพย์สินนั้น (ตกลง 3 พ.ย. 2026) */
async function insuredAssets(supabase: Awaited<ReturnType<typeof createClient>>, policyIds: string[]) {
  if (policyIds.length === 0) return new Map<string, string>();
  const { data } = await supabase.from("insurance_policies").select("id,asset_id").in("id", policyIds)
    .eq("insurance_type", "PROPERTY").not("asset_id", "is", null).is("deleted_at", null);
  return new Map((data ?? []).map((r) => [r.id as string, r.asset_id as string]));
}

function refreshAssets(assetIds: Iterable<string>) {
  const ids = [...new Set(assetIds)];
  ids.forEach((a) => { revalidatePath(`/property/${a}`); revalidatePath(`/alternative/${a}`); });
  if (ids.length) { revalidatePath("/property"); revalidatePath("/alternative"); }
}

function refresh() {
  revalidatePath("/insurance", "layout");   // ทุกหน้ากรมธรรม์ (สัญญาเพิ่มเติมแสดงที่หน้ารายการหลักของเล่ม)
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/");
}

/** ตั้ง / แทนงวดที่ยังไม่มีการชำระ (ตารางเบี้ย หรือ ตารางผลประโยชน์) */
export async function saveInsSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางไม่ได้" }; }
  // ตารางว่าง = ลบงวดที่ยังไม่ชำระทั้งหมด (ตกลง 4 พ.ย. 2026 · งวดที่ชำระแล้วฐานข้อมูลเก็บไว้)
  if (!Array.isArray(lines)) return { error: "อ่านตารางไม่ได้" };
  const { data, error } = await supabase.rpc("set_insurance_schedule", { p_policy_id: id, p_kind: String(form.get("kind")), p_lines: lines });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  return { ok: lines.length ? `บันทึกตาราง ${data} งวดแล้ว` : "ลบงวดที่ยังไม่ชำระแล้ว" };
}

/**
 * ตารางเบี้ยทั้งเล่ม (สัญญาหลัก + สัญญาเพิ่มเติม · ตกลง 8 พ.ย. 2026): ทุกส่วนบันทึกพร้อมกัน · ผิดส่วนเดียว = ไม่บันทึกเลย
 *   parts = [{ policy_id, label, lines }] · lines ว่าง = ลบงวดที่ยังไม่ชำระของส่วนนั้น
 */
export async function saveBookletSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  let parts: unknown;
  try { parts = JSON.parse(String(form.get("parts") ?? "[]")); } catch { return { error: "อ่านตารางไม่ได้" }; }
  if (!Array.isArray(parts) || parts.length === 0) return { error: "อ่านตารางไม่ได้" };
  const { data, error } = await supabase.rpc("set_insurance_booklet_schedule", { p_parts: parts });
  if (error) return { error: notSaved("ทุกส่วน", friendlyError(error.message)) };
  refresh();
  return { ok: `บันทึกตารางเบี้ยทั้งเล่ม ${data} งวดแล้ว` };
}

/** จ่ายเบี้ยตามงวด → ค่าใช้จ่ายหมวด "ประกัน" ผูกงวด */
export async function payPremium(_: PayState, form: FormData): Promise<PayState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const amount = num(form.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const pay = endpointFromForm(form);
  const asset = (await insuredAssets(supabase, [id])).get(id) ?? null;
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount, currency: str(form.get("currency")),
    expense_category: "ประกัน", related_asset_id: asset,
    ...paidFromColumns(pay),
    person_id: pay.kind === "cash" ? str(form.get("person_id")) : null,
    insurance_schedule_line_id: str(form.get("line_id")), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  // ลงมูลค่าเวนคืนตามตารางในสัญญาต่อ (ถ้ามี) · ไม่สำเร็จก็ไม่กระทบการจ่ายเบี้ย
  const { data: cv } = await supabase.rpc("sync_insurance_cash_value", { p_policy_id: id });
  refresh();
  if (asset) refreshAssets([asset]);
  return { ok: "บันทึกจ่ายเบี้ยแล้ว", cv: (cv as CvSync | null) ?? undefined };
}

const cvMsg = (r: CvSync | null | undefined) => r && r.added > 0
  ? ` · ${r.created ? "สร้าง" : "อัปเดต"}มูลค่าเวนคืนตามสัญญา ${Number(r.value).toLocaleString("en-US", { minimumFractionDigits: 2 })} (สิ้นปีกรมธรรม์ที่ ${r.policy_year})`
  : "";

/** ตั้ง / แทนตารางมูลค่าเวนคืนตามสัญญา แล้วลงมูลค่าเวนคืนตามตารางต่อทันที */
export async function saveCashValueTable(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางไม่ได้" }; }
  if (!Array.isArray(lines)) return { error: "อ่านตารางไม่ได้" };
  const { data, error } = await supabase.rpc("set_insurance_cash_value_table", { p_policy_id: id, p_lines: lines });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  const r = data as { count: number; updated?: number; sync: CvSync } | null;
  // ยอดที่ระบบลงตามตารางเดิม (ยังไม่ปิดงวด) ขยับตามตารางใหม่ (ตกลง 8 พ.ย. 2026)
  const upd = r?.updated ? ` · ปรับยอดที่ลงไว้ตามตารางใหม่ ${r.updated} ปี` : "";
  return { ok: lines.length === 0 ? "ล้างตารางแล้ว" : `บันทึกตาราง ${r?.count ?? lines.length} ปีแล้ว${upd}${cvMsg(r?.sync)}` };
}

/** ปุ่ม "ลงมูลค่าตามตาราง" (ปีที่ถึงวันแล้ว แต่ยังไม่ได้ลง เช่น จ่ายเบี้ยครบแล้ว) */
export async function syncCashValue(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { data, error } = await supabase.rpc("sync_insurance_cash_value", { p_policy_id: id });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  const r = data as CvSync | null;
  return r && r.added > 0 ? { ok: `ลงแล้ว ${r.added} ปี${cvMsg(r)}` } : { ok: "ไม่มีปีที่ต้องลงเพิ่ม (ยังไม่ถึงวัน · เบี้ยก่อนหน้ายังค้าง · หรือมียอดที่ใหม่กว่าแล้ว)" };
}

/** รับผลประโยชน์ / ครบสัญญา / เวนคืน / สินไหม — ถอนจากมูลค่าเวนคืนก่อน ส่วนเกินเป็นรายได้ */
export async function receiveBenefit(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { data, error } = await supabase.rpc("receive_insurance_benefit", { p: {
    policy_id: id, line_id: str(form.get("line_id")), date: str(form.get("date")), amount: num(form.get("amount")),
    bank_asset_id: str(form.get("bank_asset_id")), use_cash_value: !form.has("use_cash_value") || form.getAll("use_cash_value").includes("on"),
    outcome: str(form.get("outcome")), person_id: str(form.get("person_id")), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  const r = data as { cash_value_part: number; income_part: number } | null;
  const fmt = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { ok: r ? `บันทึกแล้ว · จากมูลค่าเวนคืน ${fmt(r.cash_value_part)} · รายได้ ${fmt(r.income_part)}` : "บันทึกแล้ว" };
}

/**
 * บันทึกรับเงินเคลม (ตกลง 8 พ.ย. 2026 · ปุ่มต่อเคลมในกล่องเคลม)
 *   REIMB = เงินคืนค่าใช้จ่ายที่จ่ายไปก่อน (ลดค่าใช้จ่ายนั้น ไม่ใช่รายได้ · record_reimbursement ผูกเคลม)
 *   INCOME = เงินสินไหม / ค่าชดเชย เข้าบัญชี (รายได้ผลประโยชน์ประกัน ผูกเคลม · receive_insurance_claim)
 *   ยอดได้รับ / สถานะเคลม ฐานข้อมูลคำนวณให้เอง
 */
export async function receiveClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const claimId = str(form.get("claim_id"));
  if (!claimId) return { error: "ไม่พบเคลม" };
  const kind = form.get("kind");
  // ไม่ได้เงิน (ส่วนที่เหลือ): ยังไม่เคยได้ = ปฏิเสธ · ได้ไปบางส่วนแล้ว = ได้ไม่เต็ม (ฐานข้อมูลเลือกให้)
  if (kind === "CLOSE") {
    const { data, error } = await supabase.rpc("close_insurance_claim", { p_claim_id: claimId, p_notes: str(form.get("notes")) });
    if (error) return { error: friendlyError(error.message) };
    refresh();
    revalidatePath("/family/health");
    return { ok: data === "SETTLED" ? "ปิดเคลมแล้ว · ได้ไม่เต็ม" : "บันทึกแล้ว · เคลมถูกปฏิเสธ" };
  }
  const amount = num(form.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ได้รับ" };
  const bank = str(form.get("bank_asset_id"));
  if (!bank) return { error: "กรุณาเลือกบัญชีที่รับเงิน" };
  const reimb = kind === "REIMB";
  if (reimb && !str(form.get("expense_item_id"))) return { error: "กรุณาเลือกค่าใช้จ่ายที่จ่ายไปก่อน" };
  // ทั้ง 2 แบบผ่านคำสั่งเดียว: ปิดเคลมเมื่อได้ไม่เต็ม / แก้ยอดเคลมเมื่อได้มากกว่า อยู่ในธุรกรรมเดียวกับเงินที่รับ
  const { error } = await supabase.rpc("receive_insurance_claim", { p: {
    claim_id: claimId, kind: reimb ? "REIMB" : "INCOME", expense_item_id: reimb ? str(form.get("expense_item_id")) : null,
    date: str(form.get("date")), amount, bank_asset_id: bank, person_id: reimb ? null : str(form.get("person_id")), notes: str(form.get("notes")),
    close: form.get("close") === "1", raise_claim: form.get("raise_claim") === "1",
  } });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  revalidatePath("/family/health");
  const tail = form.get("close") === "1" ? " · ปิดเคลม (ได้ไม่เต็ม)" : form.get("raise_claim") === "1" ? " · แก้ยอดเคลมตามที่ได้รับแล้ว" : " · ยอดได้รับของเคลมอัปเดตแล้ว";
  return { ok: (reimb ? "บันทึกเงินคืนแล้ว" : "บันทึกรับเงินเคลมแล้ว (รายได้)") + tail };
}

export async function addCoverage(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const limit = num(form.get("limit_amount"));
  if (limit == null || Number.isNaN(limit) || limit < 0) return { error: "กรุณาใส่วงเงิน" };
  const { error } = await supabase.from("insurance_coverages").insert({
    policy_id: id, coverage_type: str(form.get("coverage_type")), limit_amount: limit,
    currency: str(form.get("currency")) ?? "THB", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh();
  return { ok: "เพิ่มความคุ้มครองแล้ว" };
}

/** ตารางความคุ้มครองมาตรฐาน: ทุกส่วนของเล่มในครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย · ตกลง 7 พ.ย. 2026) */
export async function saveCoverages(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  let policies: unknown;
  try { policies = JSON.parse(String(form.get("policies") ?? "[]")); } catch { return { error: "อ่านตารางความคุ้มครองไม่ได้" }; }
  if (!Array.isArray(policies) || !policies.length) return { error: "อ่านตารางความคุ้มครองไม่ได้" };
  const { data, error } = await supabase.rpc("set_insurance_coverages", { p: { policies } });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  refresh();
  revalidatePath("/family", "layout");   // สรุปสิทธิ์รักษาของสมาชิก
  return { ok: `บันทึกความคุ้มครองแล้ว (${data} รายการ)` };
}

/**
 * ข้อมูลที่ต้องเหมือนกันทั้งเล่ม (แบบผสม · ตกลง 7 พ.ย. 2026): แก้ที่สัญญาหลัก → สัญญาเพิ่มเติมในเล่มเปลี่ยนตาม
 *   แก้ทีละส่วน = ทุน · เบี้ย · วันสิ้นสุด · หมายเหตุ · สถานะ · ตารางเบี้ย
 */
const SHARED_COLS = ["insurer", "policy_no", "person_id", "payer_person_id", "start_date", "paid_from_asset_id", "paid_from_credit_card_id"] as const;
type SharedPol = BookletPolicy & Record<(typeof SHARED_COLS)[number], string | null>;

/** แก้ข้อมูลกรมธรรม์ (หน้าต่าง "แก้ไขข้อมูล") · part=1 = สัญญาเพิ่มเติม (แก้ได้เฉพาะช่องของส่วนนั้น) */
export async function updatePolicyInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const own: Record<string, unknown> = { end_date: str(form.get("end_date")), insured_amount: num(form.get("insured_amount")), premium: num(form.get("premium")), notes: str(form.get("notes")) };
  // ชื่อแบบประกัน: ของแต่ละส่วน (ไม่เปลี่ยนตามสัญญาหลัก)
  if (form.has("plan_name")) own.plan_name = str(form.get("plan_name"));
  // ประเภท (ชีวิต / บำนาญ / สุขภาพ / อุบัติเหตุ) แก้ได้ทีละส่วน · ประกันทรัพย์สินไม่มีช่องนี้ (ฐานข้อมูลกันไว้อีกชั้น)
  if (form.has("insurance_type")) own.insurance_type = str(form.get("insurance_type"));
  if (form.get("part") === "1") {
    const { data, error } = await supabase.from("insurance_policies").update(own).eq("id", id).select("id");
    if (error) return { error: friendlyError(error.message) };
    if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
    revalidatePath("/insurance", "layout");
    return { ok: "บันทึกข้อมูลแล้ว" };
  }
  const patch: Record<string, unknown> = {
    ...own, insurer: str(form.get("insurer")), policy_no: str(form.get("policy_no")), start_date: str(form.get("start_date")),
    payer_person_id: str(form.get("payer_person_id")),
  };
  if (form.has("person_id")) patch.person_id = str(form.get("person_id"));
  if (form.has("pay_default")) Object.assign(patch, payDefault(form));
  if (!patch.insurer) return { error: "กรุณาใส่บริษัทประกัน" };
  // เล่มเดิม (ก่อนแก้บริษัท / เลขกรมธรรม์): สัญญาหลักของเล่ม → หาสัญญาเพิ่มเติมที่ต้องเปลี่ยนตาม
  const { data: all } = await supabase.from("v_insurance_status").select(`id,insurance_type,${SHARED_COLS.join(",")}`).not("policy_no", "is", null).order("created_at");
  const pols = (all ?? []) as unknown as SharedPol[];
  const me = pols.find((x) => x.id === id);
  const role = me ? bookletRole(me, bookletGroups(pols)) : null;
  const { data, error } = await supabase.from("insurance_policies").update(patch).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/insurance", "layout");   // ทุกหน้ากรมธรรม์ (สัญญาเพิ่มเติมแสดงที่หน้ารายการหลักของเล่ม)
  if (me && role?.isMain) {
    // เปลี่ยนตามเฉพาะช่องที่แก้จริง (ช่องที่ไม่ได้แก้ = สัญญาเพิ่มเติมคงค่าเดิมของตัวเอง)
    const changed = Object.fromEntries(SHARED_COLS.filter((k) => k in patch && (patch[k] ?? null) !== (me[k] ?? null)).map((k) => [k, patch[k]]));
    const riders = role.parts.filter((x) => x.id !== id).map((x) => x.id);
    if (riders.length && Object.keys(changed).length) {
      const { error: e2 } = await supabase.from("insurance_policies").update(changed).in("id", riders);
      if (e2) return { error: `บันทึกสัญญาหลักแล้ว แต่สัญญาเพิ่มเติมยังไม่เปลี่ยนตาม: ${friendlyError(e2.message)}` };
      return { ok: `บันทึกข้อมูลแล้ว (สัญญาเพิ่มเติม ${riders.length} ส่วนเปลี่ยนตาม)` };
    }
  }
  return { ok: "บันทึกข้อมูลแล้ว" };
}

// ---------------------------------------------------------------- แท็บบันทึกทั้งชุด (ตกลง 27 ต.ค. 2026) · ผิดแถวเดียว = ไม่บันทึกเลย
/** group = กุญแจเล่มกรมธรรม์ (บริษัท + เลขกรมธรรม์) · แถวของเล่มเดียวกันที่จ่ายจากบัญชี / บัตรเดียวกัน → ฐานข้อมูลผูกเป็นชุดเดียว */
type BatchLine = { policy_id: string; line_id: string; label: string; amount: string; pay: string; currency: string; group?: string | null };

function refreshBatch(rows: { policy_id: string }[]) {
  revalidatePath("/insurance");
  new Set(rows.map((r) => r.policy_id)).forEach((id) => revalidatePath(`/insurance/${id}`));
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/liabilities", "layout");
  revalidatePath("/");
}

/** แท็บ "จ่ายชำระเบี้ยประกัน": หลายงวด หลายกรมธรรม์ → ค่าใช้จ่ายหมวด "ประกัน" ผูกงวด + ลงมูลค่าเวนคืนตามตาราง */
export async function batchPremiums(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<BatchLine>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่จ่าย" };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 งวด" };
  const assets = await insuredAssets(supabase, [...new Set(rows.map((r) => r.policy_id))]);
  const clean = rows.map((r) => ({
    policy_id: r.policy_id, label: r.label, date, description: r.label, amount: amountOrNull(r.amount), currency: r.currency,
    paid_from_asset_id: bankId(parseEndpoint(r.pay)), paid_from_credit_card_id: cardId(parseEndpoint(r.pay)), insurance_schedule_line_id: r.line_id,
    related_asset_id: assets.get(r.policy_id) ?? null, group: str(r.group ?? null),
  }));
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่จ่ายต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  const { data, error } = await supabase.rpc("batch_pay_insurance_premiums", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  refreshBatch(rows);
  refreshAssets(assets.values());
  return { ok: `บันทึกจ่ายเบี้ยแล้ว ${data} งวด` };
}

/**
 * หน้ากรมธรรม์หลัก: จ่ายเบี้ยทั้งเล่มของงวดเดียวกัน (ชีวิต + สัญญาเพิ่มเติม) ในครั้งเดียว (ตกลง 6 พ.ย. 2026)
 *   บัญชี / บัตร = คำสั่งเดียว (ผิดส่วนเดียว = ไม่บันทึกเลย) + ผูกเป็นชุด → หน้าบัญชี / บัตรแสดงยอดรวมแถวเดียว
 *   เงินสด = บันทึกทีละส่วน (ไม่มีเงินออกจากบัญชีให้ผูก)
 */
export async function payBooklet(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<{ policy_id: string; line_id: string; label: string; amount: string; currency: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่จ่าย" };
  const parts = rows.map((r) => ({ ...r, num: amountOrNull(r.amount) })).filter((r) => plainNumber(r.amount) !== "");
  if (!parts.length) return { error: "กรุณาใส่ยอดอย่างน้อย 1 ส่วน" };
  if (!parts.every((r) => isPositive(r.num))) return { error: "ยอดที่จ่ายต้องเป็นตัวเลขมากกว่า 0" };
  const pay = endpointFromForm(form);
  if (pay.kind !== "cash" && !pay.id) return { error: "กรุณาเลือกบัญชี / บัตรที่จ่าย" };
  const notes = str(form.get("notes"));
  const assets = await insuredAssets(supabase, [...new Set(parts.map((r) => r.policy_id))]);
  const total = parts.reduce((t, r) => t + Number(r.num), 0);
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pay.kind === "cash") {
    const done: string[] = [];
    for (const r of parts) {
      const { error } = await supabase.rpc("add_expense", { p: {
        date, description: r.label, amount: r.num, currency: r.currency, expense_category: "ประกัน", related_asset_id: assets.get(r.policy_id) ?? null,
        person_id: str(form.get("person_id")), insurance_schedule_line_id: r.line_id, notes,
      } });
      if (error) {
        refreshBatch(parts); refreshAssets(assets.values());
        return { error: `${done.length ? `บันทึกแล้ว ${done.join(" · ")} · ` : ""}${r.label} ยังไม่ได้บันทึก: ${friendlyError(error.message)}` };
      }
      done.push(r.label);
      await supabase.rpc("sync_insurance_cash_value", { p_policy_id: r.policy_id });
    }
  } else {
    const { error } = await supabase.rpc("batch_pay_insurance_premiums", { p_rows: parts.map((r) => ({
      policy_id: r.policy_id, label: r.label, date, description: r.label, amount: r.num, currency: r.currency,
      ...(pay.kind === "bank" ? { paid_from_asset_id: pay.id } : { paid_from_credit_card_id: pay.id }),
      insurance_schedule_line_id: r.line_id, related_asset_id: assets.get(r.policy_id) ?? null, notes, group: str(form.get("group")),
    })) });
    if (error) return { error: notSaved("ทั้งเล่ม", friendlyError(error.message)) };
  }
  refreshBatch(parts);
  refreshAssets(assets.values());
  return { ok: `บันทึกจ่ายเบี้ยแล้ว ${parts.length} ส่วน · รวม ${fmt(total)}` };
}

/** แท็บ "บันทึกรับผลประโยชน์": หลายงวด หลายกรมธรรม์ → ถอนจากมูลค่าเวนคืนก่อน ส่วนเกินเป็นรายได้ */
export async function batchBenefits(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<BatchLine>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่ได้รับ" };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 งวด" };
  const clean = rows.map((r) => ({
    policy_id: r.policy_id, line_id: r.line_id, label: r.label, date, amount: amountOrNull(r.amount), bank_asset_id: bankId(parseEndpoint(r.pay)),
  }));
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่ได้รับต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  const { data, error } = await supabase.rpc("batch_receive_insurance_benefits", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  refreshBatch(rows);
  return { ok: `บันทึกรับผลประโยชน์แล้ว ${data} งวด` };
}
