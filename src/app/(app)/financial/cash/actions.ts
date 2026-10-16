"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";

export type ActionState = { error?: string; ok?: string; value?: string };

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s === "" ? null : Number(s);
};
const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function createBankAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const owners: { person_id: string; percent: number }[] = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("owner_") && num(v)) owners.push({ person_id: k.slice(6), percent: num(v)! });
  }
  const balance = num(form.get("balance"));
  if (balance === null || Number.isNaN(balance)) return { error: "กรุณาใส่ยอดคงเหลือเป็นตัวเลข" };

  const { data, error } = await supabase.rpc("create_bank_account", {
    p_name: str(form.get("name")),
    p_bank_name: str(form.get("bank_name")),
    p_currency: str(form.get("currency")) ?? "THB",
    p_balance: balance,
    p_balance_date: str(form.get("balance_date")),
    p_is_opening: form.get("is_opening") === "on",
    p_account_type: str(form.get("account_type")) ?? "SAVING",
    p_account_name: str(form.get("account_name")),
    p_branch: str(form.get("branch")),
    p_interest_rate: num(form.get("interest_rate")),
    p_maturity_date: str(form.get("maturity_date")),
    p_owners: owners,
    p_account_no: str(form.get("account_no")),
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/financial/cash");
  redirect(`/financial/cash/${data}`);
}

export async function updateAccountInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const { data: a, error: e1 } = await supabase.from("assets")
    .update({ name: str(form.get("name")) }).eq("id", assetId).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัญชีนี้" };
  const { error: e2 } = await supabase.from("bank_accounts").update({
    bank_name: str(form.get("bank_name")),
    account_name: str(form.get("account_name")),
    account_type: str(form.get("account_type")),
    branch: str(form.get("branch")),
    interest_rate: num(form.get("interest_rate")),
    maturity_date: str(form.get("maturity_date")),
    notes: str(form.get("notes")),
  }).eq("asset_id", assetId);
  if (e2) return { error: friendlyError(e2.message) };
  revalidatePath(`/financial/cash/${assetId}`);
  return { ok: "บันทึกข้อมูลบัญชีแล้ว" };
}

export async function updateBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value)) return { error: "กรุณาใส่ยอดคงเหลือเป็นตัวเลข" };
  // บันทึกยอด + (ถ้าเลือก) ส่วนต่างลงเป็นก้อน "รอแยกรายละเอียด" ของเดือนนั้น (เดือนละ 1 ก้อน)
  const { data, error } = await supabase.rpc("update_bank_statement", {
    p_asset_id: assetId, p_date: str(form.get("valuation_date")), p_value: value, p_notes: str(form.get("notes")),
    p_settle: form.get("settle") === "on",
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/financial/cash/${assetId}`);
  revalidatePath("/financial/cash");
  revalidatePath("/income-expenses");
  revalidatePath("/month-closing");
  const r = data as { difference: number | null; lump: number | null; history_only?: boolean; merged?: boolean } | null;
  const f = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const base = "บันทึกยอดคงเหลือแล้ว";
  if (r?.history_only) return { ok: `${base} · เดือนนี้มีก้อนรอแยกที่ผูกกับยอดวันหลังกว่าอยู่แล้ว ก้อนจึงไม่เปลี่ยน` };
  const lump = r?.lump == null ? null : Number(r.lump);
  const merged = r?.merged ? " (ปรับก้อนเดิมของเดือนนี้)" : "";
  if (lump != null && lump < -0.005) return { ok: `${base} · ค่าใช้จ่ายก้อนรอแยกรายละเอียด ${f(-lump)}${merged} — แยกได้ที่ Income & Expenses` };
  if (lump != null && lump > 0.005) return { ok: `${base} · รายได้ก้อนรอแยกรายละเอียด ${f(lump)}${merged} — แยกได้ที่ Income & Expenses` };
  if (lump != null) return { ok: `${base} · ยอดตรงกับรายการที่บันทึกแล้ว ไม่มีก้อนรอแยก` };
  const d = Number(r?.difference ?? 0);
  if (r?.difference == null || Math.abs(d) < 0.005) return { ok: base };
  return { ok: d < 0
    ? `${base} · เงินในบัญชีน้อยกว่ารายการที่บันทึก ${f(-d)} (ติ๊ก "ลงส่วนต่างเป็นก้อนรอแยก" ถ้าต้องการลงเป็นค่าใช้จ่ายก้อน)`
    : `${base} · เงินในบัญชีมากกว่ารายการที่บันทึก ${f(d)} (ติ๊ก "ลงส่วนต่างเป็นก้อนรอแยก" ถ้าต้องการลงเป็นรายได้ก้อน)` };
}

export async function setAccountNo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_bank_account_no", {
    p_bank_account_id: String(form.get("bank_account_id")), p_account_no: String(form.get("account_no") ?? ""),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/financial/cash/${form.get("asset_id")}`);
  return { ok: `บันทึกเลขบัญชีแล้ว (ลงท้าย ${data})` };
}

export async function revealAccountNo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_bank_account", { p_bank_account_id: String(form.get("bank_account_id")) });
  if (error) return { error: friendlyError(error.message) };
  return { value: String(data) };
}
