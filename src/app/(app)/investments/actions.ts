"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { BAD_ROWS_ERROR, TAX_ERROR, amountOrNull, isPositive, isValidTax, notSaved, plainNumber, readRows } from "@/lib/batch-entry";

export type ActionState = FormState;

const clean = (v: FormDataEntryValue | null) => str(v)?.replace(/,/g, "") ?? null;

function revalidate(assetId?: string) {
  revalidatePath("/investments");
  if (assetId) revalidatePath(`/investments/${assetId}`, "layout");
  revalidatePath("/");
}

export async function createPortfolio(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const opening = form.get("is_opening") === "on";
  const { data, error } = await supabase.rpc("create_portfolio", {
    p_name: str(form.get("name")),
    p_institution: str(form.get("institution")),
    p_currency: str(form.get("currency")) ?? "THB",
    p_portfolio_type: str(form.get("portfolio_type")) ?? "BROKERAGE",
    p_start_date: str(form.get("start_date")),
    p_is_opening: opening,
    p_opening_cash: opening ? (num(form.get("opening_cash")) ?? 0) : null,
    p_owners: ownersFromForm(form),
    p_notes: str(form.get("notes")),
    p_opening_fx: num(form.get("opening_fx")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate();
  redirect(`/investments/${data}`);
}

/** หุ้นกู้ / อื่น ๆ ตัวใหม่: ข้อมูลตารางรับดอกเบี้ย (เงินต้น · อัตรา · จ่ายทุก) จากฟอร์มเพิ่ม · prefix = "" (ยอดตั้งต้น) | "new_" (+ รายการ) */
function couponInfo(form: FormData, prefix: string) {
  const face = num(form.get(`${prefix}face_value`)), rate = num(form.get(`${prefix}interest_rate`)), freq = str(form.get(`${prefix}coupon_frequency`));
  if (face == null && rate == null && !freq) return { info: null };
  if ([face, rate].some((v) => v != null && (Number.isNaN(v) || v < 0))) return { error: "เงินต้น / อัตราผลตอบแทนต้องเป็นตัวเลขไม่ติดลบ" };
  return { info: { face_value: face, interest_rate: rate, coupon_frequency: freq } };
}
async function saveCouponInfo(supabase: Awaited<ReturnType<typeof createClient>>, holdingId: string | null, info: ReturnType<typeof couponInfo>["info"]) {
  if (!info || !holdingId) return null;
  const { error } = await supabase.from("investment_holdings").update(info).eq("id", holdingId);
  return error ? `บันทึกรายการแล้ว แต่ตั้งข้อมูลดอกเบี้ยไม่สำเร็จ (${friendlyError(error.message)}) — ใส่ได้ที่หน้าหลักทรัพย์ → แก้ไขข้อมูล` : null;
}

export async function addHolding(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const coupon = couponInfo(form, "");
  if (coupon.error) return { error: coupon.error };
  const { data: newId, error } = await supabase.rpc("add_holding", {
    p_portfolio_asset_id: id,
    p_holding_type: str(form.get("holding_type")) ?? "EQUITY",
    p_name: str(form.get("name")),
    p_symbol: str(form.get("symbol")),
    p_currency: str(form.get("currency")),
    p_maturity_date: str(form.get("maturity_date")),
    p_opening: {
      quantity: clean(form.get("quantity")), price: clean(form.get("price")),
      cost_base_thb: clean(form.get("cost_base_thb")), fx_rate: clean(form.get("fx_rate")),
      market_price: clean(form.get("market_price")), market_value: clean(form.get("market_value")),
      notes: str(form.get("notes")), valuation_mode: str(form.get("valuation_mode")) ?? "UNITS",
    },
    p_notes: null,
  });
  if (error) return { error: friendlyError(error.message) };
  const couponErr = await saveCouponInfo(supabase, newId as string | null, coupon.info);
  revalidate(id);
  return couponErr ? { error: couponErr } : { ok: "เพิ่มยอดตั้งต้นแล้ว" };
}

/** NAV จาก ก.ล.ต. (Edge Function sec-nav · Key อยู่ใน Supabase Secrets) — อ่านอย่างเดียว ไม่บันทึก */
export type SecNav = { ref: string; proj_id: string; class: string | null; name_th: string | null; name_en: string | null; nav: number; nav_date: string };
export type SecNavResult = { nav?: SecNav; error?: string; classes?: string[]; name_th?: string | null };

export async function fetchSecNav(query: string, date: string): Promise<SecNavResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("sec-nav", { body: { query, date } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let body: { error?: string; classes?: string[]; name_th?: string | null } | null = null;
    if (ctx && typeof ctx.json === "function") {
      try { body = await ctx.json(); } catch { /* ไม่ใช่ JSON */ }
    }
    if (body?.error) return { error: body.error, classes: body.classes, name_th: body.name_th };
    return { error: /Failed to send a request|not found|404/i.test(error.message) ? "ยังไม่ได้ติดตั้ง Edge Function sec-nav ใน Supabase" : error.message };
  }
  return { nav: data as SecNav };
}

/** แปลงยอดตั้งต้นเป็นจำนวนหน่วยจริง (มูลค่าทุกวันเท่าเดิม · ต้นทุนรวมเท่าเดิม) */
export async function restateUnits(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const units = num(form.get("units"));
  if (units === null || Number.isNaN(units) || units <= 0) return { error: "ใส่จำนวนหน่วยที่มากกว่า 0" };
  const { error } = await supabase.rpc("restate_opening_units", {
    p_holding_id: String(form.get("holding_id")), p_units: units, p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "แปลงเป็นจำนวนหน่วยแล้ว" };
}

export async function recordTx(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const type = String(form.get("type"));
  const holding = str(form.get("holding_id"));
  const isNew = holding === "__new__";
  const coupon = isNew ? couponInfo(form, "new_") : { info: null };
  if (coupon.error) return { error: coupon.error };
  const { data: txId, error } = await supabase.rpc("record_investment_tx", {
    p_portfolio_asset_id: id,
    p_tx: {
      type, date: str(form.get("date")), settlement_date: str(form.get("settlement_date")),
      holding_id: isNew ? null : holding,
      new_holding: isNew ? {
        holding_type: str(form.get("new_holding_type")), name: str(form.get("new_name")),
        symbol: str(form.get("new_symbol")), currency: str(form.get("new_currency")),
        maturity_date: str(form.get("new_maturity_date")),
      } : null,
      quantity: clean(form.get("quantity")), price: clean(form.get("price")), amount: clean(form.get("amount")),
      fee: clean(form.get("fee")), tax: clean(form.get("tax")),
      settle_bank_asset_id: form.get("settle_mode") === "bank" ? str(form.get("bank_asset_id")) : null,
      direction: str(form.get("direction")), notes: str(form.get("notes")),
      cash_holding_id: str(form.get("cash_holding_id")),
    },
  });
  if (error) return { error: friendlyError(error.message) };
  let couponErr: string | null = null;
  if (coupon.info && txId) {
    const { data: t } = await supabase.from("investment_transactions").select("holding_id").eq("id", txId as string).maybeSingle();
    couponErr = await saveCouponInfo(supabase, t?.holding_id ?? null, coupon.info);
  }
  revalidate(id);
  revalidatePath("/financial/cash");
  return couponErr ? { error: couponErr } : { ok: "บันทึกรายการแล้ว" };
}

export async function recordMaturity(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount < 0) return { error: "กรุณาใส่ยอดเงินต้นที่ได้รับคืน" };
  const { error } = await supabase.rpc("record_holding_maturity", {
    p_holding_id: String(form.get("holding_id")), p_date: str(form.get("date")), p_amount: amount,
    p_settle_to_asset_id: form.get("settle_mode") === "bank" ? str(form.get("bank_asset_id")) : null,
    p_settlement_date: str(form.get("settlement_date")), p_fee: num(form.get("fee")), p_tax: num(form.get("tax")),
    p_notes: str(form.get("notes")),
    p_cash_holding_id: form.get("settle_mode") === "bank" ? null : str(form.get("cash_holding_id")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "บันทึกครบกำหนดแล้ว" };
}

export async function transferMoney(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const bank = str(form.get("bank_asset_id"));
  if (!bank) return { error: "กรุณาเลือกบัญชีธนาคาร" };
  // ยอดที่เข้า: ติ๊ก "รอ Statement" = ว่าง · สกุลเดียวกันเว้นว่าง = เท่ากับเงินที่ออก
  const wait = form.get("wait") === "on";
  const same = str(form.get("src_ccy")) === str(form.get("dst_ccy"));
  const counter = wait ? null : clean(form.get("counter_amount")) ?? (same ? clean(form.get("amount")) : null);
  if (!wait && !counter) return { error: "ใส่ยอดที่เข้าจริง หรือติ๊ก \"ยังไม่ทราบยอดที่เข้า\"" };
  const { error } = await supabase.rpc("transfer_portfolio_money", {
    p_portfolio_asset_id: id,
    p: {
      direction: form.get("direction") === "OUT" ? "OUT" : "IN", bank_asset_id: bank,
      cash_holding_id: str(form.get("cash_holding_id")), date: str(form.get("date")),
      amount: clean(form.get("amount")), fee: clean(form.get("fee")),
      counter_amount: counter, counter_fee: clean(form.get("counter_fee")),
      description: str(form.get("description")),
    },
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  revalidatePath(`/financial/cash/${bank}`);
  revalidatePath("/income-expenses");
  return { ok: counter ? "บันทึกการโอนแล้ว" : "บันทึกแล้ว — รอยอดปลายทาง (กด \"ใส่ยอดที่เข้า\" เมื่อได้ Statement)" };
}

/** แก้รายการโอน ธนาคาร ↔ พอร์ต / ใส่ยอดปลายทางทีหลัง */
export async function updateTransfer(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { error } = await supabase.rpc("update_portfolio_transfer", {
    p_movement_id: String(form.get("movement_id")),
    p: {
      date: str(form.get("date")) ?? "", amount: clean(form.get("amount")) ?? "", fee: clean(form.get("fee")) ?? "",
      counter_amount: clean(form.get("counter_amount")) ?? "", counter_fee: clean(form.get("counter_fee")) ?? "",
      cash_holding_id: str(form.get("cash_holding_id")) ?? "", description: str(form.get("description")) ?? "",
    },
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  const bank = str(form.get("bank_asset_id"));
  if (bank) revalidatePath(`/financial/cash/${bank}`);
  revalidatePath("/income-expenses");
  return { ok: "บันทึกแล้ว" };
}

/** บันทึกราคา / มูลค่าจาก Statement หลายตัวพร้อมกัน (ช่อง price_<holding> / mv_<holding> / qty_<holding>) */
export async function saveValuations(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const date = str(form.get("valuation_date"));
  if (!date) return { error: "กรุณาใส่วันที่ของราคา" };
  const rows: Record<string, unknown>[] = [];
  for (const [k] of form.entries()) {
    if (!k.startsWith("qty_")) continue;
    const h = k.slice(4);
    const q = num(form.get(`qty_${h}`)) ?? 0;
    const price = num(form.get(`price_${h}`));
    const mv = num(form.get(`mv_${h}`));
    if (price === null && mv === null) continue;
    if ((price !== null && Number.isNaN(price)) || (mv !== null && Number.isNaN(mv))) return { error: "ราคา / มูลค่าต้องเป็นตัวเลข" };
    if (form.get(`cash_${h}`)) {               // เงินฝากในพอร์ต: ยอดตาม Statement = จำนวน = มูลค่า
      if (mv === null) continue;
      rows.push({ holding_id: h, valuation_date: date, price: 1, quantity: mv, market_value: mv, source: "STATEMENT" });
      continue;
    }
    rows.push({ holding_id: h, valuation_date: date, price, quantity: q,
      market_value: mv ?? Math.round((price ?? 0) * q * 10000) / 10000, source: "STATEMENT" });
  }
  if (!rows.length) return { error: "ยังไม่ได้กรอกราคาหรือมูลค่าเลย" };
  const { error } = await supabase.from("investment_valuations").insert(rows);
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: `บันทึกราคา ${rows.length} รายการแล้ว` };
}

/** แลกเงินภายในพอร์ต (เงินฝากสกุลหนึ่ง → อีกสกุล) */
/** ย้ายเงินระหว่างบัญชีเงินฝากในพอร์ต: สกุลเดียวกัน = โอน · คนละสกุล = แลกเงิน ("new:XXX" = สกุลใหม่ สร้างบัญชีให้) */
export async function moveCash(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const from = str(form.get("from_holding_id"));
  const to = str(form.get("to_target"));
  if (!from || !to) return { error: "กรุณาเลือกบัญชีต้นทางและปลายทาง" };
  const fromCcy = str(form.get("from_currency"));
  const toCcy = str(form.get("to_currency"));
  const isNew = to.startsWith("new:");
  if (!isNew && fromCcy === toCcy) {
    const { error } = await supabase.rpc("transfer_portfolio_cash", {
      p_portfolio_asset_id: id,
      p_tx: { from_holding_id: from, to_holding_id: to, amount: clean(form.get("amount")), date: str(form.get("date")),
              fee: clean(form.get("fee")), notes: str(form.get("notes")) },
    });
    if (error) return { error: friendlyError(error.message) };
    revalidate(id);
    return { ok: "บันทึกการโอนแล้ว" };
  }
  const { error } = await supabase.rpc("record_investment_fx", {
    p_portfolio_asset_id: id,
    p_tx: {
      date: str(form.get("date")), amount: clean(form.get("amount")), currency: fromCcy,
      counter_amount: clean(form.get("counter_amount")), counter_currency: isNew ? to.slice(4) : toCcy,
      fee: clean(form.get("fee")), notes: str(form.get("notes")),
      cash_holding_id: from, counter_cash_holding_id: isNew ? null : to,
    },
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "บันทึกการแลกเงินแล้ว" };
}

/** เพิ่มบัญชีเงินฝากในพอร์ต (ช่วงตั้งค่าใส่ยอดตั้งต้นได้) */
export async function addCashAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const name = str(form.get("name"));
  if (!name) return { error: "กรุณาใส่ชื่อบัญชี" };
  const rate = num(form.get("interest_rate"));
  if (rate !== null && (Number.isNaN(rate) || rate < 0)) return { error: "อัตราดอกเบี้ยต้องเป็นตัวเลข" };
  const opening = clean(form.get("opening"));
  const { data: hid, error } = await supabase.rpc("add_holding", {
    p_portfolio_asset_id: id, p_holding_type: "CASH", p_name: name, p_symbol: null,
    p_currency: str(form.get("currency")), p_maturity_date: null,
    p_opening: opening ? { quantity: opening, price: "1", notes: "ยอดตั้งต้น" } : null, p_notes: null,
  });
  if (error) return { error: friendlyError(error.message) };
  const purpose = str(form.get("purpose"));
  if (hid && (purpose || rate !== null)) {
    const { error: e2 } = await supabase.from("investment_holdings").update({ purpose, interest_rate: rate }).eq("id", hid);
    if (e2) return { error: friendlyError(e2.message) };
  }
  revalidate(id);
  return { ok: `เพิ่มบัญชี ${name} แล้ว` };
}

/** ตั้งบัญชีหลักของสกุล (ADMIN / EDITOR) */
export async function setDefaultCash(form: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("set_default_cash_account", { p_holding_id: String(form.get("holding_id")) });
  revalidate(String(form.get("asset_id")));
}

const pct = (v: FormDataEntryValue | null) => num(v);

/** รายละเอียด FCN / Structured Product (สร้างหรือแก้) */
export async function saveFcn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const holdingId = String(form.get("holding_id"));
  const principal = num(form.get("principal"));
  if (!str(form.get("issuer"))) return { error: "กรุณาใส่ผู้ออก (Issuer)" };
  if (principal === null || Number.isNaN(principal) || principal < 0) return { error: "กรุณาใส่เงินต้น" };
  const knock = form.get("knock_in_occurred") === "on";
  const row = {
    holding_id: holdingId, issuer: str(form.get("issuer")), principal,
    trade_date: str(form.get("trade_date")), issue_date: str(form.get("issue_date")),
    coupon_rate: pct(form.get("coupon_rate")), coupon_frequency: str(form.get("coupon_frequency")),
    strike_level: pct(form.get("strike_level")), barrier_level: pct(form.get("barrier_level")),
    autocall_level: pct(form.get("autocall_level")), observation_frequency: str(form.get("observation_frequency")),
    knock_in_occurred: knock, knock_in_date: knock ? str(form.get("knock_in_date")) : null,
  };
  for (const k of ["coupon_rate", "strike_level", "barrier_level", "autocall_level"] as const) {
    if (row[k] !== null && Number.isNaN(row[k])) return { error: "อัตรา / ระดับต้องเป็นตัวเลข (%)" };
  }
  const fcnId = str(form.get("fcn_id"));
  const { error } = fcnId
    ? await supabase.from("fcn_details").update(row).eq("id", fcnId)
    : await supabase.from("fcn_details").insert(row);
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "บันทึกรายละเอียดแล้ว" };
}

export async function addUnderlying(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const symbol = str(form.get("symbol"));
  if (!symbol) return { error: "กรุณาใส่สัญลักษณ์หุ้นอ้างอิง" };
  const { error } = await supabase.from("fcn_underlyings").insert({
    fcn_id: String(form.get("fcn_id")), symbol: symbol.toUpperCase(), name: str(form.get("name")),
    initial_price: num(form.get("initial_price")), strike_price: num(form.get("strike_price")), barrier_price: num(form.get("barrier_price")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(String(form.get("asset_id")));
  return { ok: "เพิ่มหุ้นอ้างอิงแล้ว" };
}

/** แก้ไขรายละเอียดพอร์ต (ชื่อ / สถาบัน / ประเภท / สกุล / หมายเหตุ) */
export async function updatePortfolio(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { data: cur } = await supabase.from("assets").select("currency").eq("id", id).maybeSingle();
  const ccy = str(form.get("currency"));
  if (cur && ccy && ccy !== cur.currency && form.get("confirm_currency") !== "on") return { error: "กรุณาติ๊กยืนยันการเปลี่ยนสกุลพอร์ต" };
  const { error } = await supabase.rpc("update_portfolio", {
    p_asset_id: id,
    p: { name: str(form.get("name")), institution: str(form.get("institution")), portfolio_type: str(form.get("portfolio_type")),
         currency: ccy, notes: str(form.get("notes")) },
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "บันทึกรายละเอียดพอร์ตแล้ว" };
}

/** จัดลำดับเงินฝาก / หลักทรัพย์ (↑ = -1, ↓ = +1) — มีผลทันที */
export async function moveHolding(form: FormData): Promise<void> {
  const supabase = await createClient();
  const dir = Number(form.get("dir"));
  await supabase.rpc("move_holding", { p_holding_id: String(form.get("holding_id")), p_direction: dir === -1 ? -1 : 1 });
  revalidate(String(form.get("asset_id")));
}

/** แท็บ "รอรับเดือนนี้": ดอกเบี้ย / Coupon หลายรายการ + ดอกเบี้ยเงินฝากในพอร์ต — คำสั่งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย) */
export type BatchIncomeRow = {
  portfolio_asset_id: string; type: "COUPON" | "INTEREST" | "MATURITY"; holding_id: string; date: string; amount: string; tax: string;
  cash_holding_id: string | null; bank_asset_id: string | null; notes: string;
};
export async function batchInvestmentIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const rows = readRows<BatchIncomeRow>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!rows.length) return { error: "กรุณากรอกยอดที่ได้รับอย่างน้อย 1 รายการ" };
  if (!rows.every((r) => isPositive(amountOrNull(r.amount)))) return { error: "ยอดที่ได้รับต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  if (!rows.every((r) => isValidTax(amountOrNull(r.tax)))) return { error: TAX_ERROR };
  if (rows.some((r) => !r.date)) return { error: "กรุณาใส่วันที่รับทุกแถวที่กรอก" };
  const p_rows = rows.map((r) => ({
    portfolio_asset_id: r.portfolio_asset_id,
    tx: { type: r.type, date: r.date, holding_id: r.holding_id, amount: plainNumber(r.amount), tax: plainNumber(r.tax) || null,
      settle_bank_asset_id: r.bank_asset_id || null, cash_holding_id: r.bank_asset_id ? null : r.cash_holding_id || null, notes: r.notes || null },
  }));
  const { data, error } = await supabase.rpc("batch_record_investment_income", { p_rows });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidate();
  new Set(rows.map((r) => r.portfolio_asset_id)).forEach((id) => revalidatePath(`/investments/${id}`, "layout"));
  revalidatePath("/financial/cash");
  revalidatePath("/income-expenses");
  return { ok: `บันทึกรับแล้ว ${data} รายการ` };
}
