"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, sqwaFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { payFromForm, recordAssetPurchase } from "@/lib/asset-pay";
import { bankId, cardId, endpointFromForm, paidFromColumns, parseEndpoint } from "@/lib/money-endpoint";
import { BAD_ROWS_ERROR, isPositive, notSaved, readRows } from "@/lib/batch-entry";
import { partsSum, type ValuePart } from "./valueParts";
import type { CompInput } from "./components";

/** created = สร้างรายการแล้วแต่บันทึกเงินออกไม่สำเร็จ → ลิงก์ไปหน้ารายการ (ไม่ให้กดบันทึกซ้ำ) */
export type ActionState = FormState & { created?: string };

/** อ่านช่องสัญญาเช่า (prefix lease_) → jsonb สำหรับ create_lease */
function leaseFromForm(form: FormData) {
  const g = (k: string) => str(form.get(`lease_${k}`));
  return {
    unit_label: g("unit_label"), tenant_name: g("tenant_name"), contract_no: g("contract_no"),
    start_date: g("start_date"), end_date: g("end_date"),
    rent_amount: g("rent_amount")?.replace(/,/g, "") ?? null, rent_currency: g("rent_currency"),
    payment_frequency: g("payment_frequency"), payment_due_day: g("payment_due_day"),
    security_deposit: g("security_deposit")?.replace(/,/g, "") ?? null,
    deposit_received_date: g("deposit_received_date"), deposit_to_asset_id: g("deposit_to_asset_id"),
    carried_from_lease_id: form.get("lease_carry") === "on" ? g("carried_from_lease_id") : null,
    notes: g("notes"),
  };
}

/** บัญชีรับค่าเช่า (ค่าตั้งต้น) + วิธีคิดค่าน้ำไฟ — create_lease ไม่รับ 2 ช่องนี้ จึงตั้งหลังสร้างสัญญา */
async function setRentAccount(supabase: Awaited<ReturnType<typeof createClient>>, leaseIds: string[], form: FormData) {
  const to = str(form.get("lease_rent_to_asset_id"));
  const billing = str(form.get("lease_utilities_billing"));
  if ((!to && !billing) || !leaseIds.length) return null;
  const { error } = await supabase.from("property_leases")
    .update({ ...(to ? { rent_to_asset_id: to } : {}), ...(billing ? { utilities_billing: billing } : {}) }).in("id", leaseIds);
  return error ? `ตั้งบัญชีรับค่าเช่า / ค่าน้ำไฟไม่ได้ (${friendlyError(error.message)}) — ตั้งใหม่ที่ปุ่มแก้ไขของสัญญา` : null;
}

/** ตารางส่วนประกอบจากฟอร์ม (ComponentTable · JSON) → แถวสำหรับ save_property_components + id ที่ลบ */
function componentsFromForm(form: FormData): { rows: CompInput[]; removed: string[] } | { error: string } {
  let rows: unknown, removed: unknown;
  try {
    rows = JSON.parse(String(form.get("components") ?? "[]"));
    removed = JSON.parse(String(form.get("removed") ?? "[]"));
  } catch { return { error: "ข้อมูลส่วนประกอบไม่ถูกต้อง" }; }
  if (!Array.isArray(rows) || !Array.isArray(removed)) return { error: "ข้อมูลส่วนประกอบไม่ถูกต้อง" };
  const list = rows as CompInput[];
  const bad = (v: string | undefined) => v != null && v !== "" && !(Number(v) >= 0);
  for (const [i, r] of list.entries()) {
    if (bad(r.land_area_sq_wa) || bad(r.building_area_sqm)) return { error: `แถวที่ ${i + 1}: เนื้อที่ / พื้นที่ต้องเป็นตัวเลข` };
    if (bad(r.acq_cost) || bad(r.value)) return { error: `แถวที่ ${i + 1}: ต้นทุน / มูลค่าต้องเป็นตัวเลขไม่ติดลบ` };
    const y = r.useful_life_years ? Number(r.useful_life_years) : null;
    if (y !== null && !(Number.isInteger(y) && y >= 1 && y <= 100)) return { error: `แถวที่ ${i + 1}: อายุใช้งานต้องเป็นจำนวนปี 1–100` };
  }
  const sum = list.reduce((t, r) => t + (Number(r.acq_cost) || 0), 0);
  const acq = num(form.get("acquisition_cost"));
  if (sum > 0 && (acq === null || acq < sum - 0.005)) return { error: "ราคาที่ได้มารวมต้องไม่น้อยกว่าผลรวมต้นทุนรายแถว" };
  return { rows: list, removed: (removed as unknown[]).map(String) };
}

function revalidateProperty(assetId?: string) {
  revalidatePath("/property");
  revalidatePath("/income-expenses");
  if (assetId) revalidatePath(`/property/${assetId}`);
  revalidatePath("/liabilities");
}

export async function createProperty(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  // ต้นทุนที่ได้มาต้องใส่ (รายแถว หรือยอดรวม · ตกลง 29 ต.ค. 2026)
  const acq = num(form.get("acquisition_cost"));
  if (acq === null || Number.isNaN(acq) || acq < 0) return { error: "กรุณาใส่ต้นทุนที่ได้มา (รายแถว หรือยอดรวมที่แถวรวม)" };
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const usage = str(form.get("usage_type")) ?? "OWNER_OCCUPIED";
  const lease = usage === "RENTAL" ? leaseFromForm(form) : null;
  const pay = payFromForm(form);
  if (pay && "error" in pay) return { error: pay.error };
  const comps = componentsFromForm(form);
  if ("error" in comps) return { error: comps.error };
  if (!str(form.get("acquisition_date"))) return { error: "กรุณาใส่วันที่ได้มาในตารางส่วนประกอบ" };
  const credit = creditFromForm(form);
  if (credit && "error" in credit) return { error: credit.error };
  const withValue = comps.rows.some((r) => r.value);
  const { data, error } = await supabase.rpc("create_property", {
    p_name: str(form.get("name")),
    p_property_type: str(form.get("property_type")) ?? "HOUSE",
    p_usage_type: usage,
    p_currency: str(form.get("currency")) ?? "THB",
    p_value: value,
    p_value_date: str(form.get("value_date")),
    p_is_opening: form.get("is_opening") === "on",
    p_valuation_method: str(form.get("valuation_method")) ?? "USER_ESTIMATE",
    p_acquisition_date: str(form.get("acquisition_date")),
    p_acquisition_cost: num(form.get("acquisition_cost")),
    p_location_group: str(form.get("location_group")),
    p_address: str(form.get("address")),
    // เนื้อที่ / โฉนด = จากตารางส่วนประกอบ (บันทึกต่อด้านล่าง · ระบบรวมเนื้อที่ให้)
    p_land_area_sq_wa: null,
    p_title_type: null,
    p_title_deed_no: null,
    p_land_no: null,
    p_owners: ownersFromForm(form),
    p_lease: lease?.tenant_name ? lease : null,
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty();
  // ส่วนประกอบ (ที่ดิน / อาคาร / อื่น ๆ) + มูลค่ารายแถวของมูลค่าแรก
  if (comps.rows.length) {
    const { data: ids, error: e3 } = await supabase.rpc("save_property_components", {
      p_asset_id: String(data), p_rows: comps.rows.map(({ value: _v, ...r }) => r), p_removed: [], p_valuation: null,   // eslint-disable-line @typescript-eslint/no-unused-vars
    });
    if (e3) return { error: `บันทึกทรัพย์สินแล้ว แต่บันทึกส่วนประกอบไม่สำเร็จ (${friendlyError(e3.message)}) — แก้ต่อที่หน้าทรัพย์สิน`, created: `/property/${data}` };
    if (withValue) {
      const { data: val } = await supabase.from("asset_valuations").select("id").eq("asset_id", String(data)).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const parts = comps.rows.map((r, i) => ({ type: r.type === "LAND" ? "DEED" : r.type, deed_id: (ids as string[])[i], value: num(r.value ?? null) ?? 0 }));
      const { error: e4 } = val ? await supabase.rpc("set_valuation_parts", { p_valuation_id: val.id, p_parts: parts }) : { error: { message: "ไม่พบมูลค่า" } };
      if (e4) return { error: `บันทึกทรัพย์สินแล้ว แต่บันทึกมูลค่ารายแถวไม่สำเร็จ (${friendlyError(e4.message)}) — ใส่ต่อที่หน้าทรัพย์สิน`, created: `/property/${data}` };
    }
  }
  if (lease?.tenant_name) {
    const { data: ls } = await supabase.from("property_leases").select("id,property_details!inner(asset_id)")
      .eq("property_details.asset_id", String(data)).is("deleted_at", null);
    const e1 = await setRentAccount(supabase, (ls ?? []).map((l) => l.id), form);
    if (e1) return { error: `บันทึกทรัพย์สินแล้ว แต่${e1}`, created: `/property/${data}` };
  }
  if (pay) {
    const e2 = await recordAssetPurchase(supabase, String(data), pay);
    revalidatePath("/financial/cash", "layout");
    if (e2) return { error: `บันทึกทรัพย์สินแล้ว แต่บันทึกเงินออกจากบัญชีไม่สำเร็จ (${e2}) — เปิดหน้าทรัพย์สินแล้วใช้ปุ่ม "+ จ่ายซื้อ / จ่ายเพิ่ม"`, created: `/property/${data}` };
  }
  // ยังจ่ายไม่ครบ / ผ่อนกับผู้ขาย → หนี้ "ค้างจ่ายค่าซื้อ" (ไม่มีเงินเข้า) · จ่ายงวดที่หน้าหนี้สิน (ตกลง 29 ต.ค. 2026)
  if (credit) {
    const { error: e5 } = await supabase.rpc("create_liability", {
      p_liability_type: "OTHER", p_name: `ค้างจ่ายค่าซื้อ ${str(form.get("name")) ?? ""}`.trim(), p_currency: str(form.get("currency")) ?? "THB",
      p_balance: credit.balance, p_balance_date: credit.date, p_is_opening: false, p_lender: str(form.get("seller")),
      p_original_amount: credit.balance, p_start_date: credit.date, p_linked_asset_id: String(data),
      p_owners: ownersFromForm(form).filter((o) => o.percent != null).map((o) => ({ person_id: o.person_id, percent: o.percent })),
      p_notes: "ส่วนที่ยังไม่จ่ายของราคาซื้อ (สร้างจากฟอร์มเพิ่มทรัพย์สิน)",
    });
    revalidatePath("/liabilities");
    if (e5) return { error: `บันทึกทรัพย์สินแล้ว แต่สร้างหนี้ "ค้างจ่ายค่าซื้อ" ไม่สำเร็จ (${friendlyError(e5.message)}) — เพิ่มเองที่หน้าหนี้สิน`, created: `/property/${data}` };
  }
  redirect(`/property/${data}`);
}

/** ฟอร์มเพิ่มทรัพย์สิน · pay_mode = CREDIT: ยอดค้างจ่าย = ราคาที่ได้มา − เงินดาวน์ (ต้องมากกว่า 0) */
function creditFromForm(form: FormData): { balance: number; date: string } | { error: string } | null {
  if (form.get("is_opening") === "on" || str(form.get("pay_mode")) !== "CREDIT") return null;
  const cost = num(form.get("acquisition_cost"));
  if (cost === null || Number.isNaN(cost) || cost <= 0) return { error: "ยังจ่ายไม่ครบ: กรุณาใส่ต้นทุนที่ได้มา (ใช้คำนวณยอดค้างจ่าย)" };
  const down = num(form.get("down_payment")) ?? 0;
  const balance = Math.round((cost - down) * 100) / 100;
  if (Number.isNaN(balance) || balance <= 0) return { error: "เงินดาวน์ต้องน้อยกว่าต้นทุนที่ได้มา (ถ้าจ่ายครบให้เลือก \"จ่ายครบแล้ว\")" };
  return { balance, date: String(form.get("acquisition_date")) };
}

/** รายละเอียดมูลค่าแยกส่วนจากฟอร์ม (JSON) · ตรวจรูปแบบ / ยอดไม่ติดลบ */
function partsFromForm(form: FormData): ValuePart[] | { error: string } {
  const raw = String(form.get("parts") ?? "").trim();
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return { error: "รายละเอียดมูลค่าไม่ถูกต้อง" }; }
  if (!Array.isArray(list)) return { error: "รายละเอียดมูลค่าไม่ถูกต้อง" };
  const out: ValuePart[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const type = x.type === "DEED" || x.type === "BUILDING" ? x.type : "OTHER";
    const value = Number(x.value);
    if (!Number.isFinite(value) || value < 0) return { error: "มูลค่ารายส่วนต้องเป็นตัวเลขไม่ติดลบ" };
    if (type === "DEED" && !x.deed_id) return { error: "รายละเอียดมูลค่าไม่ถูกต้อง" };
    out.push({ type, value, deed_id: type === "DEED" ? String(x.deed_id) : null, label: x.label ? String(x.label) : null,
      source_movement_id: x.source_movement_id ? String(x.source_movement_id) : null });
  }
  return out;
}

/** มูลค่า Property ใหม่ + รายละเอียดแยกตามโฉนด / อาคาร (ไม่มีรายละเอียด = ยอดรวมอย่างเดียว) */
export async function savePropertyValuation(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const parts = partsFromForm(form);
  if ("error" in parts) return { error: parts.error };
  const value = parts.length ? partsSum(parts) : num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const { error } = await supabase.rpc("add_property_valuation", {
    p_asset_id: id, p_date: str(form.get("valuation_date")), p_value: value, p_method: str(form.get("valuation_method")) ?? "USER_ESTIMATE",
    p_notes: str(form.get("notes")), p_parts: parts,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "บันทึกมูลค่าแล้ว" };
}

export async function addValuation(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const method = str(form.get("valuation_method")) ?? "USER_ESTIMATE";
  const { error } = await supabase.from("asset_valuations").insert({
    asset_id: id, valuation_date: str(form.get("valuation_date")), value, valuation_method: method,
    source: method === "APPRAISAL" ? "APPRAISAL" : "USER", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "บันทึกมูลค่าแล้ว" };
}

/** พิกัด "ละติจูด, ลองจิจูด" (ช่องเดียว) → 2 ค่า · ว่าง = ลบ · ไม่มีพิกัดแต่ลิงก์มี @lat,lng → ใช้จากลิงก์ */
function parseCoords(raw: string | null, url: string | null): { lat: number | null; lng: number | null } | { error: string } {
  const src = raw ?? url?.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)?.slice(1, 3).join(",") ?? null;
  if (!src) return { lat: null, lng: null };
  const m = src.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!m) return { error: "พิกัดไม่ถูกต้อง — ใส่แบบ 13.7563, 100.5018 (ละติจูด, ลองจิจูด)" };
  const lat = Number(m[1]), lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "พิกัดเกินช่วง (ละติจูด ±90 · ลองจิจูด ±180) — ตรวจว่าไม่ได้สลับกัน" };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export async function updatePropertyInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const rate = num(form.get("opportunity_rate_pct"));
  if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 100)) return { error: "อัตราดอกเบี้ยเทียบต้องอยู่ระหว่าง 0–100%" };
  const mapUrl = str(form.get("map_url"));
  if (mapUrl && !/^https:\/\//i.test(mapUrl)) return { error: "ลิงก์ Google Maps ต้องขึ้นต้นด้วย https://" };
  const xy = parseCoords(str(form.get("coords")), mapUrl);
  if ("error" in xy) return { error: xy.error };
  // ตารางส่วนประกอบ (+ มูลค่าใหม่ถ้ามูลค่าเปลี่ยน) บันทึกก่อน · ผิดแถวเดียว = ไม่บันทึกอะไรเลย
  if (form.has("components")) {
    const comps = componentsFromForm(form);
    if ("error" in comps) return { error: comps.error };
    const valuation = form.get("value_changed") ? {
      date: str(form.get("valuation_date")), method: str(form.get("valuation_method")) ?? "USER_ESTIMATE",
      notes: str(form.get("valuation_notes")), total: num(form.get("value")),
    } : null;
    if (valuation && (valuation.total === null || Number.isNaN(valuation.total))) return { error: "กรุณาใส่มูลค่า" };
    const { error: e0 } = await supabase.rpc("save_property_components", {
      p_asset_id: id, p_rows: comps.rows, p_removed: comps.removed, p_valuation: valuation,
    });
    if (e0) return { error: friendlyError(e0.message) };
  }
  const { data: a, error: e1 } = await supabase.from("assets").update({
    name: str(form.get("name")), notes: str(form.get("notes")),
    acquisition_date: str(form.get("acquisition_date")), acquisition_cost: num(form.get("acquisition_cost")),
  }).eq("id", id).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const { error: e2 } = await supabase.from("property_details").update({
    property_type: str(form.get("property_type")), usage_type: str(form.get("usage_type")),
    location_group: str(form.get("location_group")), address: str(form.get("address")),
    // เนื้อที่: แก้ที่ทรัพย์สินได้เฉพาะตอนยังไม่มีโฉนด (มีโฉนดแล้ว = ผลรวมจากโฉนด · ข้อมูลโฉนดแก้ที่ส่วน "โฉนด / เอกสารสิทธิ์")
    ...(form.has("land_rai") ? { land_area_sq_wa: sqwaFromForm(form) } : {}),
    subdistrict: str(form.get("subdistrict")), district: str(form.get("district")),
    province: str(form.get("province")),
    ...(form.has("opportunity_rate_pct") ? { opportunity_rate_pct: rate } : {}),
    encumbrance_type: str(form.get("encumbrance_type")),
    encumbrance_details: ["", "NONE"].includes(str(form.get("encumbrance_type")) ?? "") ? null : str(form.get("encumbrance_details")),
    // ที่ว่าง: ส่งเฉพาะตอนเป็น "ว่าง" (ระบบเติมวันเริ่มว่าง / เก็บประวัติให้เมื่อเปลี่ยนการใช้งาน)
    ...(str(form.get("usage_type")) === "VACANT" ? { vacant_since: str(form.get("vacant_since")), vacant_plan: str(form.get("vacant_plan")),
      vacant_plan_date: str(form.get("vacant_plan_date")) } : {}),
    ...(form.has("coords") ? { map_url: mapUrl, latitude: xy.lat, longitude: xy.lng } : {}),
  }).eq("asset_id", id);
  if (e2) return { error: friendlyError(e2.message) };
  revalidateProperty(id);
  return { ok: "บันทึกข้อมูลแล้ว" };
}

/** ราคาตลาด (อ้างอิง · ไม่นับเข้า Net Worth): เพิ่ม / แก้ 1 ครั้ง · ราคาต่อหน่วย × เนื้อที่ → ระบบคำนวณยอดรวม */
export async function saveMarketValuation(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const id = str(form.get("id"));
  const unit = str(form.get("unit_basis")) ?? "TOTAL";
  const unitPrice = num(form.get("unit_price")), area = num(form.get("area")), total = num(form.get("market_value"));
  const nums = { unitPrice, area, total, low: num(form.get("value_low")), high: num(form.get("value_high")),
    fee: num(form.get("broker_fee")), tax: num(form.get("tax_transfer_estimate")), other: num(form.get("other_selling_cost")) };
  if (Object.values(nums).some((v) => v !== null && (Number.isNaN(v) || v < 0))) return { error: "ตัวเลขต้องไม่ติดลบ" };
  const value = unit === "TOTAL" ? total : unitPrice !== null && area !== null ? Math.round(unitPrice * area * 100) / 100 : null;
  if (unit !== "TOTAL" && (!unitPrice || !area)) return { error: `กรุณาใส่ราคาต่อ ${unit === "SQ_WA" ? "ตร.ว." : "ตร.ม."} และเนื้อที่` };
  if (!value) return { error: "กรุณาใส่ราคาตลาด" };
  if (nums.low !== null && nums.low > value) return { error: "ราคาต่ำสุดต้องไม่เกินราคากลาง" };
  if (nums.high !== null && nums.high < value) return { error: "ราคาสูงสุดต้องไม่ต่ำกว่าราคากลาง" };
  const feeUnit = str(form.get("broker_fee_unit")) ?? "PCT";
  if (feeUnit === "PCT" && nums.fee !== null && nums.fee > 100) return { error: "ค่านายหน้าต้องไม่เกิน 100%" };
  const row = {
    valuation_date: str(form.get("valuation_date")), unit_basis: unit,
    unit_price: unit === "TOTAL" ? null : unitPrice, area: unit === "TOTAL" ? null : area, market_value: value,
    value_low: nums.low, value_high: nums.high, method: str(form.get("method")) ?? "OWNER_ESTIMATE",
    price_type: str(form.get("price_type")), source: str(form.get("source")), confidence: str(form.get("confidence")),
    broker_fee_pct: feeUnit === "PCT" ? nums.fee : null, broker_fee_amount: feeUnit === "THB" ? nums.fee : null,
    tax_transfer_estimate: nums.tax, other_selling_cost: nums.other, notes: str(form.get("notes")),
  };
  const q = id
    ? supabase.from("property_market_valuations").update(row).eq("id", id).select("id")
    : supabase.from("property_market_valuations").insert({ ...row, asset_id: assetId }).select("id");
  const { data, error } = await q;
  if (error) {
    if (error.message.includes("pmv_asset_date_uq")) return { error: "วันนี้ประเมินทรัพย์สินนี้ไปแล้ว — แก้รายการเดิมในประวัติราคาตลาด หรือเลือกวันอื่น" };
    return { error: friendlyError(error.message) };
  }
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidateProperty(assetId);
  return { ok: "บันทึกราคาตลาดแล้ว (ไม่นับเข้า Net Worth)" };
}

/** ต้นทุนเพิ่ม (ราคาขายขั้นต่ำที่คุ้ม · ไม่นับใน Net Worth) — เพิ่ม / แก้ · ผูก "จ่ายเพิ่ม" ในระบบ = ยอด / วันที่ตามเงินออก (แก้ได้แค่อาคาร / ปี / รายละเอียด) */
export async function saveCostItem(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const id = str(form.get("id"));
  const movementId = str(form.get("movement_id"));
  const years = num(form.get("depreciation_years")) ?? 20;
  if (Number.isNaN(years) || years < 1 || years > 100 || !Number.isInteger(years)) return { error: "อายุการใช้งานต้องเป็นจำนวนปีเต็ม 1–100" };
  const row: Record<string, unknown> = {
    description: str(form.get("description")), is_building: form.get("is_building") === "on", depreciation_years: years, notes: str(form.get("notes")),
  };
  if (!movementId) {
    const amount = num(form.get("amount"));
    if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดเงิน" };
    const date = str(form.get("cost_date"));
    if (!date) return { error: "กรุณาใส่วันที่จ่าย" };
    Object.assign(row, { amount, cost_date: date });
  }
  const { data, error } = id
    ? await supabase.from("property_cost_items").update(row).eq("id", id).select("id")
    : await supabase.from("property_cost_items").insert({ ...row, asset_id: assetId, movement_id: movementId,
        ...(movementId ? { amount: 1, cost_date: "2000-01-01" } : {}) }).select("id");
  if (error) return { error: error.message.includes("pci_movement_uq") ? "รายการจ่ายนี้ตั้งไว้แล้ว — แก้ที่รายการเดิม" : friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidateProperty(assetId);
  return { ok: "บันทึกต้นทุนแล้ว (ไม่นับใน Net Worth)" };
}

/** แท็บ อัปเดตมูลค่า: มูลค่าใน Net Worth ของหลายทรัพย์สินพร้อมกัน (วันที่ / วิธีเดียวกันทั้งชุด) · บันทึกครั้งเดียว ผิดแถวเดียว = ไม่บันทึกเลย
 *  แถวที่กรอกรายส่วนประกอบ → ตามนั้น · กรอกยอดรวม + ครั้งก่อนมีรายแถว → ฐานข้อมูลแบ่งตามสัดส่วนครั้งก่อน (batch_property_values) */
export async function batchPropertyValues(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  if (!date) return { error: "กรุณาใส่วันที่ของมูลค่า" };
  const method = str(form.get("valuation_method")) ?? "USER_ESTIMATE";
  let input: { asset_id: string; value?: string; parts?: { deed_id: string; value: number }[] }[];
  try { input = JSON.parse(String(form.get("rows") ?? "[]")); } catch { return { error: "ข้อมูลไม่ถูกต้อง" }; }
  if (!Array.isArray(input)) return { error: "ข้อมูลไม่ถูกต้อง" };
  const rows = input.map((r) => (Array.isArray(r.parts) && r.parts.length
    ? { asset_id: String(r.asset_id), parts: r.parts.map((p) => ({ deed_id: String(p.deed_id), value: Number(p.value) })) }
    : { asset_id: String(r.asset_id), value: num(r.value ?? null) }));
  if (!rows.length) return { error: "ยังไม่ได้กรอกมูลค่าใหม่เลย" };
  if (rows.some((r) => ("parts" in r
    ? r.parts!.some((p) => !Number.isFinite(p.value) || p.value < 0)
    : r.value === null || Number.isNaN(r.value) || r.value < 0))) return { error: "มูลค่าต้องเป็นตัวเลขไม่ติดลบทุกแถวที่กรอก" };
  const { error } = await supabase.rpc("batch_property_values", { p_date: date, p_method: method, p_notes: str(form.get("notes")), p_rows: rows });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  rows.forEach((r) => revalidateProperty(r.asset_id));
  revalidateProperty();
  return { ok: `บันทึกมูลค่าแล้ว ${rows.length} รายการ` };
}

export async function setUsage(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { data, error } = await supabase.from("property_details")
    .update({ usage_type: String(form.get("usage_type")) }).eq("asset_id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidateProperty(id);
  return { ok: "เปลี่ยนการใช้งานแล้ว" };
}

export async function createLease(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { data: leaseId, error } = await supabase.rpc("create_lease", { p_property_asset_id: id, p_lease: leaseFromForm(form) });
  if (error) return { error: friendlyError(error.message) };
  const warn = await setRentAccount(supabase, leaseId ? [String(leaseId)] : [], form);
  revalidateProperty(id);
  return warn ? { error: `สร้างสัญญาแล้ว แต่${warn}` } : { ok: "สร้างสัญญาเช่าแล้ว" };
}

export async function terminateLease(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const date = str(form.get("terminated_date"));
  if (!date) return { error: "กรุณาใส่วันที่เลิกสัญญา" };
  const { data, error } = await supabase.from("property_leases")
    .update({ status: "TERMINATED", terminated_date: date }).eq("id", String(form.get("lease_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขสัญญานี้" };
  revalidateProperty(id);
  return { ok: "บันทึกการเลิกสัญญาแล้ว" };
}

export async function settleDeposit(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const refunded = num(form.get("refunded_amount"));
  if (refunded === null || Number.isNaN(refunded) || refunded < 0) return { error: "กรุณาใส่ยอดที่คืนเป็นตัวเลข (คืน 0 ได้)" };
  const { data, error } = await supabase.rpc("settle_security_deposit", {
    p_lease_id: String(form.get("lease_id")),
    p_settled_date: str(form.get("settled_date")),
    p_refunded_amount: refunded,
    p_refund_from_asset_id: str(form.get("refund_from_asset_id")),
    p_deduction_reason: str(form.get("deduction_reason")),
    p_record_deduction_as_income: form.get("record_as_income") === "on",
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  const warn = (data as { warning?: string } | null)?.warning;
  return { ok: warn ? `บันทึกแล้ว · ${warn}` : "บันทึกการคืนเงินประกันแล้ว" };
}

export async function recordRent(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ได้รับ" };
  const toAsset = str(form.get("received_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const { error } = await supabase.from("income_transactions").insert({
    lease_id: String(form.get("lease_id")), income_type: "RENT", date: str(form.get("date")),
    income_period: str(form.get("income_period")), amount, currency,
    received_to_asset_id: toAsset, notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  if (toAsset) revalidatePath(`/financial/cash/${toAsset}`);
  return { ok: "บันทึกรับค่าเช่าแล้ว" };
}

export async function addUtility(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("expected_amount"));
  const frequency = str(form.get("frequency"));
  if (amount != null && (Number.isNaN(amount) || amount < 0)) return { error: "ยอดประมาณไม่ถูกต้อง" };
  if ((amount == null) !== (frequency == null)) return { error: "ถ้าจะติดตามค่าใช้จ่าย ให้ใส่ทั้งยอดประมาณและความถี่ (หรือเว้นว่างทั้งคู่)" };
  const dueDay = num(form.get("due_day"));
  const dueMonth = frequency && frequency !== "MONTHLY" ? num(form.get("due_month")) : null;
  const { error } = await supabase.from("property_utilities").insert({
    property_id: String(form.get("property_id")), utility_type: str(form.get("utility_type")) ?? "ELECTRICITY",
    provider: str(form.get("provider")), account_no: str(form.get("account_no")), meter_no: str(form.get("meter_no")),
    notes: str(form.get("notes")), expected_amount: amount, frequency, currency: str(form.get("currency")) ?? "THB",
    due_day: dueDay, due_month: dueMonth,
    ...(form.has("pay_default") ? (() => { const e = parseEndpoint(str(form.get("pay_default"))); return { paid_from_asset_id: bankId(e), paid_from_credit_card_id: cardId(e) }; })() : {}),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "เพิ่มแล้ว" };
}

/** บันทึกจ่ายค่าใช้จ่ายประจำ (ส่วนกลาง / ภาษีที่ดิน / ไฟ / น้ำ) ของงวดหนึ่ง → สร้างรายการค่าใช้จ่ายผูกกับรายการนั้น */
export async function recordPropertyCost(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = str(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const pay = endpointFromForm(form);
  const rebillLease = form.get("rebill") === "on" ? str(form.get("rebill_lease_id")) : null;
  const rebillAmount = rebillLease ? num(form.get("rebill_amount")) : null;
  if (rebillLease && rebillAmount != null && (Number.isNaN(rebillAmount) || rebillAmount <= 0)) return { error: "ยอดเรียกเก็บผู้เช่าต้องมากกว่า 0" };
  const { data: expenseId, error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    ...paidFromColumns(pay),
    person_id: pay.kind === "cash" ? str(form.get("person_id")) : null,
    property_utility_id: str(form.get("utility_id")), cost_period: str(form.get("cost_period")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(assetId ?? undefined);
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  if (rebillLease && expenseId) {
    const { error: e2 } = await supabase.rpc("add_utility_charge", { p_expense_item_id: String(expenseId), p_lease_id: rebillLease, p_amount: rebillAmount });
    if (e2) return { error: `บันทึกจ่ายแล้ว แต่ตั้งยอดเรียกเก็บผู้เช่าไม่ได้ (${friendlyError(e2.message)})` };
    return { ok: "บันทึกจ่ายแล้ว · ตั้งยอดเรียกเก็บผู้เช่าแล้ว" };
  }
  return { ok: "บันทึกจ่ายแล้ว" };
}

export type BatchState = { error?: string; ok?: string };

/** รับค่าน้ำไฟที่เรียกเก็บผู้เช่า 1 รายการ → รายได้อื่นของ Property (ใช้ batch_record_rent แถวเดียว) */
export async function receiveUtilityCharge(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ได้รับ" };
  const toAsset = str(form.get("received_to_asset_id"));
  const { error } = await supabase.rpc("batch_record_rent", { p_rows: [{ charge_id: String(form.get("charge_id")), amount,
    date: str(form.get("date")), received_to_asset_id: toAsset, notes: str(form.get("notes")) }] });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  if (toAsset) revalidatePath(`/financial/cash/${toAsset}`);
  return { ok: "บันทึกรับค่าน้ำไฟแล้ว" };
}

/** รับค่าเช่าหลายสัญญาพร้อมกัน (แท็บ บันทึกรับค่าเช่า/สัญญาเช่า) · ผิดแถวเดียว = ไม่บันทึกเลย */
export async function batchRent(_: BatchState, form: FormData): Promise<BatchState> {
  const supabase = await createClient();
  const rows = readRows<{ lease_id: string; amount: string; date: string; received_to_asset_id: string; income_period: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  const clean = rows.map((r) => ({ ...r, amount: num(r.amount), received_to_asset_id: r.received_to_asset_id || null }));
  if (!clean.length) return { error: "กรุณากรอกยอดที่ได้รับอย่างน้อย 1 รายการ" };
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่ได้รับต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  const { data, error } = await supabase.rpc("batch_record_rent", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidateProperty();
  revalidatePath("/financial/cash", "layout");
  return { ok: `บันทึกรับแล้ว ${data} รายการ` };
}

/** ค่าใช้จ่ายของทรัพย์สินหลายรายการพร้อมกัน (แท็บ ค่าใช้จ่าย) · ผิดแถวเดียว = ไม่บันทึกเลย */
export async function batchPropertyExpenses(_: BatchState, form: FormData): Promise<BatchState> {
  const supabase = await createClient();
  const rows = readRows<{ amount: string; pay: string; description?: string } & Record<string, string>>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 รายการ" };
  const clean = rows.map(({ pay, amount, ...r }) => ({
    ...r, description: String(r.description ?? ""), amount: num(amount),
    paid_from_asset_id: bankId(parseEndpoint(pay)),
    paid_from_credit_card_id: cardId(parseEndpoint(pay)),
  }));
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่จ่ายต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  if (clean.some((r) => !r.description.trim())) return { error: "กรุณาใส่รายการ (รายละเอียด) ทุกแถว" };
  const { data, error } = await supabase.rpc("batch_add_property_expenses", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidateProperty();
  revalidatePath("/financial/cash", "layout");
  return { ok: `บันทึกค่าใช้จ่ายแล้ว ${data} รายการ` };
}

// ---------------------------------------------------------------- ภาษีที่ดินและสิ่งปลูกสร้าง
async function syncLandTax(supabase: Awaited<ReturnType<typeof createClient>>, assetId: string, year: number) {
  const { error } = await supabase.rpc("sync_land_tax_estimate", { p_asset_id: assetId, p_tax_year: year });
  return error ? friendlyError(error.message) : null;
}

/** เพิ่ม / แก้รายการภาษีที่ดิน 1 รายการ · ปีปัจจุบัน → ตั้งยอดประมาณ "ภาษีที่ดิน" ให้ตามภาษีรวม */
export async function saveTaxLine(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const id = str(form.get("id"));
  const year = Number(form.get("tax_year"));
  const rate = num(form.get("rate_pct"));
  if (!Number.isInteger(year)) return { error: "ปีภาษีไม่ถูกต้อง" };
  if (rate == null || Number.isNaN(rate)) return { error: "กรุณาใส่อัตราภาษี (%)" };
  const row = {
    asset_id: assetId, tax_year: year, sort_order: num(form.get("sort_order")) ?? 0, description: str(form.get("description")),
    land_sq_wa: sqwaFromForm(form), land_price_per_sq_wa: num(form.get("land_price_per_sq_wa")),
    building_type: str(form.get("building_type")), building_sqm: num(form.get("building_sqm")),
    building_price_per_sqm: num(form.get("building_price_per_sqm")), building_age: num(form.get("building_age")),
    depreciation_pct: num(form.get("depreciation_pct")) ?? 0, exemption: num(form.get("exemption")) ?? 0,
    exemption_reason: str(form.get("exemption_reason")), rate_pct: rate, discount_pct: num(form.get("discount_pct")) ?? 0,
    notes: str(form.get("notes")),
  };
  const { data, error } = id
    ? await supabase.from("property_tax_lines").update(row).eq("id", id).select("id")
    : await supabase.from("property_tax_lines").insert(row).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const warn = await syncLandTax(supabase, assetId, year);
  revalidateProperty(assetId);
  return { ok: warn ? `บันทึกแล้ว · ตั้งยอดประมาณไม่สำเร็จ: ${warn}` : "บันทึกรายการภาษีแล้ว" };
}

export async function deleteTaxLine(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const year = Number(form.get("tax_year"));
  const { data, error } = await supabase.from("property_tax_lines").update({ deleted_at: new Date().toISOString() })
    .eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์ลบรายการนี้" };
  await syncLandTax(supabase, assetId, year);
  revalidateProperty(assetId);
  return { ok: "ลบรายการแล้ว" };
}

export async function copyTaxYear(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const from = Number(form.get("from_year")), to = Number(form.get("to_year"));
  const { data, error } = await supabase.rpc("copy_property_tax_year", { p_asset_id: assetId, p_from_year: from, p_to_year: to });
  if (error) return { error: friendlyError(error.message) };
  await syncLandTax(supabase, assetId, to);
  revalidateProperty(assetId);
  return { ok: `คัดลอกจากปี ${from + 543} แล้ว ${data} รายการ` };
}

/** คัดลอกภาษีที่ดินจากปีก่อน ทุกทรัพย์สิน: เฉพาะที่ปีก่อนมีข้อมูล และปีนี้ยังไม่มี (ไม่ทับรายการที่กรอกแล้ว) */
export async function copyTaxYearAll(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const from = Number(form.get("from_year")), to = Number(form.get("to_year"));
  const ids = String(form.get("asset_ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return { error: "ปีไม่ถูกต้อง" };
  if (!ids.length) return { error: "ไม่มีทรัพย์สินให้คัดลอก" };
  const { data: rows, error } = await supabase.from("property_tax_lines").select("asset_id,tax_year")
    .in("asset_id", ids).in("tax_year", [from, to]).is("deleted_at", null);
  if (error) return { error: friendlyError(error.message) };
  const has = (y: number) => new Set((rows ?? []).filter((r) => r.tax_year === y).map((r) => r.asset_id as string));
  const src = has(from), dst = has(to);
  let done = 0, lines = 0;
  const failed: string[] = [];
  for (const id of ids) {
    if (!src.has(id) || dst.has(id)) continue;
    const { data: n, error: e } = await supabase.rpc("copy_property_tax_year", { p_asset_id: id, p_from_year: from, p_to_year: to });
    if (e) { failed.push(friendlyError(e.message)); continue; }
    await syncLandTax(supabase, id, to);
    done += 1; lines += Number(n ?? 0);
  }
  revalidateProperty();
  const skipHas = ids.filter((id) => dst.has(id)).length, skipNone = ids.filter((id) => !src.has(id) && !dst.has(id)).length;
  const msg = `คัดลอกจากปี ${from + 543} แล้ว ${done} ทรัพย์สิน (${lines} รายการ)`
    + (skipHas ? ` · ข้าม ${skipHas} (มีข้อมูลปี ${to + 543} แล้ว)` : "") + (skipNone ? ` · ข้าม ${skipNone} (ปี ${from + 543} ไม่มีข้อมูล)` : "");
  return failed.length ? { error: `${msg} · ไม่สำเร็จ ${failed.length}: ${failed[0]}` } : { ok: msg };
}
