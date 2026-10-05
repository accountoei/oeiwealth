"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

const clean = (v: FormDataEntryValue | null) => str(v)?.replace(/,/g, "") ?? null;

function revalidate(assetId?: string) {
  revalidatePath("/investments");
  if (assetId) revalidatePath(`/investments/${assetId}`);
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

export async function addHolding(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { error } = await supabase.rpc("add_holding", {
    p_portfolio_asset_id: id,
    p_holding_type: str(form.get("holding_type")) ?? "EQUITY",
    p_name: str(form.get("name")),
    p_symbol: str(form.get("symbol")),
    p_currency: str(form.get("currency")),
    p_maturity_date: str(form.get("maturity_date")),
    p_opening: {
      quantity: clean(form.get("quantity")), price: clean(form.get("price")),
      cost_base_thb: clean(form.get("cost_base_thb")), fx_rate: clean(form.get("fx_rate")),
      market_price: clean(form.get("market_price")), notes: str(form.get("notes")),
    },
    p_notes: null,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "เพิ่มยอดตั้งต้นแล้ว" };
}

export async function recordTx(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const type = String(form.get("type"));
  const holding = str(form.get("holding_id"));
  const isNew = holding === "__new__";
  const { error } = await supabase.rpc("record_investment_tx", {
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
    },
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  revalidatePath("/financial/cash");
  return { ok: "บันทึกรายการแล้ว" };
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
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  return { ok: "บันทึกครบกำหนดแล้ว" };
}

export async function transferMoney(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const bank = str(form.get("bank_asset_id"));
  const amount = num(form.get("amount"));
  if (!bank) return { error: "กรุณาเลือกบัญชีธนาคาร" };
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const toPortfolio = form.get("direction") === "IN";
  const { error } = await supabase.rpc("transfer_money", {
    p_from_asset_id: toPortfolio ? bank : id, p_to_asset_id: toPortfolio ? id : bank,
    p_amount: amount, p_date: str(form.get("date")), p_fee: num(form.get("fee")) ?? 0,
    p_description: str(form.get("description")), p_fee_as_expense: true,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidate(id);
  revalidatePath(`/financial/cash/${bank}`);
  return { ok: "บันทึกการโอนแล้ว" };
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
    if (form.get(`cash_${h}`)) {               // เงินสดในพอร์ต: ยอดตาม Statement = จำนวน = มูลค่า
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
