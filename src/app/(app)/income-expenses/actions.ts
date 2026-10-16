"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function done(msg: string, extra: string[] = []): ActionState {
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  extra.forEach((p) => revalidatePath(p));
  return { ok: msg };
}
const bad = (v: number | null) => v === null || Number.isNaN(v) || v <= 0;

// ------------------------------------------------------------------ ก้อนรอแยก: ข้อความหลังบันทึก
type Sb = Awaited<ReturnType<typeof createClient>>;
type LumpAcc = { kind: "BANK" | "CARD"; id: string | null | undefined };
type LumpSnap = { key: string; kind: "BANK" | "CARD"; id: string; amount: number; date: string } | null;
const f2 = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ยอดก้อนรอแยกของบัญชี / บัตร ในเดือนของรายการ (ก่อน / หลังบันทึก) */
async function lumpSnap(supabase: Sb, accs: LumpAcc[], date: string | null): Promise<LumpSnap[]> {
  if (!date) return [];
  const uniq = accs.filter((a): a is { kind: "BANK" | "CARD"; id: string } => !!a.id)
    .filter((a, i, arr) => arr.findIndex((b) => b.kind === a.kind && b.id === a.id) === i);
  return Promise.all(uniq.map(async (a) => {
    const { data } = await supabase.rpc("lump_status", { p_kind: a.kind, p_id: a.id, p_date: date });
    const r = data as { amount: number; date: string } | null;
    return r ? { key: `${a.kind}:${a.id}`, kind: a.kind, id: a.id, amount: Number(r.amount), date: r.date } : null;
  }));
}

/** เทียบก่อน / หลัง → "หักจากก้อนแล้ว เหลือ …" · เตือนก้อนกลับด้าน · เตือนวันที่หลังวันที่ของก้อน */
function lumpNote(before: LumpSnap[], after: LumpSnap[], accs: LumpAcc[], date: string | null): string {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const a of accs) {
    if (!a.id) continue;
    const key = `${a.kind}:${a.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const b = before.find((x) => x?.key === key) ?? null;
    const n = after.find((x) => x?.key === key) ?? null;
    const who = a.kind === "CARD" ? "บัตรนี้" : "บัญชีนี้";
    if (!b && !n) continue;
    if (b && !n) { notes.push(`ก้อนรอแยกของ${who}หมดแล้ว (หักจากก้อนครบ)`); continue; }
    if (!b && n) continue;                                  // ก้อนเกิดจากที่อื่น ไม่เกี่ยวกับรายการนี้
    const was = b!.amount, now = n!.amount;
    if (Math.abs(was - now) < 0.005) {
      if (date && date > b!.date) notes.push(`⚠ รายการนี้ลงวันที่หลังวันที่ของก้อนรอแยก (${b!.date}) จึงไม่หักจากก้อน — ถ้าเป็นส่วนหนึ่งของก้อน ให้แก้วันที่ให้อยู่ในช่วงก้อน`);
      continue;
    }
    if (Math.sign(was) !== Math.sign(now) && Math.abs(now) >= 0.005) {
      notes.push(`⚠ ก้อนรอแยกของ${who}กลับด้าน: จาก${was > 0 ? "ค่าใช้จ่าย" : "รายได้"}รอแยก ${f2(Math.abs(was))} เป็น${now > 0 ? "ค่าใช้จ่าย" : "รายได้"}รอแยก ${f2(Math.abs(now))} — ตรวจว่าไม่ได้บันทึกซ้ำกับที่แยกไปแล้ว`);
      continue;
    }
    notes.push(`หักจากก้อนรอแยกของ${who}แล้ว เหลือ${now > 0 ? "ค่าใช้จ่าย" : "รายได้"}รอแยก ${f2(Math.abs(now))}`);
  }
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

// ------------------------------------------------------------------ รายได้
export async function addIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดรายได้ (ก่อนหักภาษี)" };
  const tax = num(form.get("tax"));
  if (tax !== null && (Number.isNaN(tax) || tax < 0 || tax > (amount as number))) return { error: "ภาษีต้องอยู่ระหว่าง 0 ถึงยอดรายได้" };
  const toAsset = str(form.get("received_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const leaseId = str(form.get("lease_id"));
  const templateId = str(form.get("recurring_template_id"));
  const itype = leaseId ? "RENT" : (str(form.get("income_type")) ?? "OTHER");
  const incAccs: LumpAcc[] = [{ kind: "BANK", id: toAsset }];
  const incBefore = await lumpSnap(supabase, incAccs, str(form.get("date")));
  const { error } = await supabase.from("income_transactions").insert({
    income_type: itype, income_subtype: itype === "OTHER" ? str(form.get("income_subtype")) : null,
    amount, tax, currency, date: str(form.get("date")), received_to_asset_id: toAsset,
    person_id: leaseId ? null : str(form.get("person_id")),
    lease_id: leaseId, recurring_template_id: templateId,
    income_period: leaseId || templateId ? str(form.get("income_period")) : null,
    notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  const incNote = lumpNote(incBefore, await lumpSnap(supabase, incAccs, str(form.get("date"))), incAccs, str(form.get("date")));
  return done(`บันทึกรายได้แล้ว${incNote}`, ["/property"]);
}

export async function dismissExpected(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const reason = str(form.get("reason"));
  if (!reason) return { error: "กรุณาระบุเหตุผล" };
  const { error } = await supabase.from("expected_income_dismissals").insert({
    source_type: String(form.get("source_type")), source_id: String(form.get("source_id")),
    income_period: String(form.get("income_period")), reason,
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกว่าเดือนนี้ไม่ได้รับแล้ว");
}

export async function addTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("expected_amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดที่ได้รับตามปกติ" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  if (!fam) return { error: "ไม่พบข้อมูลครอบครัว" };
  const toAsset = str(form.get("receive_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const { error } = await supabase.from("recurring_income_templates").insert({
    family_id: fam.id, name: str(form.get("name")), income_type: str(form.get("income_type")) ?? "SALARY",
    person_id: str(form.get("person_id")), expected_amount: amount, currency,
    frequency: str(form.get("frequency")) ?? "MONTHLY", due_day: num(form.get("due_day")),
    receive_to_asset_id: toAsset, start_date: str(form.get("start_date")), end_date: str(form.get("end_date")),
    notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("เพิ่มรายได้ประจำแล้ว");
}

export async function toggleTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_income_templates")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return done("บันทึกแล้ว");
}

// ------------------------------------------------------------------ ค่าใช้จ่าย
export async function addExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const via = String(form.get("pay_via") ?? "bank");
  const reimb = form.get("is_reimbursable") === "on";
  const expAccs: LumpAcc[] = [{ kind: "BANK", id: via === "bank" ? str(form.get("bank_asset_id")) : null },
    { kind: "CARD", id: via === "card" ? str(form.get("card_id")) : null }];
  const expBefore = await lumpSnap(supabase, expAccs, str(form.get("date")));
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    paid_from_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    paid_from_credit_card_id: via === "card" ? str(form.get("card_id")) : null,
    person_id: str(form.get("person_id")),
    is_reimbursable: reimb, expected_reimbursement_amount: reimb ? num(form.get("expected_reimbursement_amount")) : null,
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  const expNote = lumpNote(expBefore, await lumpSnap(supabase, expAccs, str(form.get("date"))), expAccs, str(form.get("date")));
  return done(`บันทึกค่าใช้จ่ายแล้ว${expNote}`, ["/liabilities"]);
}

export async function setMonthStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expense_month_status", {
    p_month: String(form.get("month")), p_status: String(form.get("status")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกสถานะแล้ว");
}

export async function addReimbursement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดเงินคืน" };
  const via = String(form.get("to_via") ?? "bank");
  const { error } = await supabase.rpc("record_reimbursement", {
    p_expense_item_id: String(form.get("expense_item_id")), p_received_date: str(form.get("received_date")),
    p_amount: amount, p_received_to_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    p_received_to_credit_card_id: via === "card" ? str(form.get("card_id")) : null, p_notes: str(form.get("notes")),
    p_insurance_claim_id: str(form.get("insurance_claim_id")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance", "layout");
  return done("บันทึกเงินคืนแล้ว");
}

// ------------------------------------------------------------------ โอน / จ่ายบัตร / จ่ายหนี้ / เงินเข้าออกอื่น
export async function addMovement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const type = String(form.get("movement_type"));
  // จ่ายหนี้: แยกเงินต้น (ลดยอดหนี้) / ดอกเบี้ย (ค่าใช้จ่าย)
  if (type === "LIABILITY_PAYMENT") {
    const newBal = num(form.get("new_balance"));
    const { error } = await supabase.rpc("pay_liability", { p: {
      liability_id: str(form.get("liability_id")), bank_asset_id: str(form.get("from_asset_id")), date: str(form.get("date")),
      principal: num(form.get("principal")) ?? 0, interest: num(form.get("interest")) ?? 0, notes: str(form.get("description")),
      statement_balance: form.get("update_balance") === "on" ? newBal : null,
    } });
    if (error) return { error: friendlyError(error.message) };
    return done("บันทึกการจ่ายหนี้แล้ว", ["/liabilities"]);
  }
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const date = str(form.get("date"));
  const fromBank = str(form.get("from_asset_id"));
  const toBank = str(form.get("to_asset_id"));
  const isIn = type === "OTHER_IN";
  const mainBank = isIn ? toBank : fromBank;
  if (!mainBank) return { error: isIn ? "กรุณาเลือกบัญชีที่รับเงิน" : "กรุณาเลือกบัญชีที่จ่าย" };
  const { data: acc } = await supabase.from("assets").select("currency").eq("id", mainBank).maybeSingle();
  const currency = acc?.currency ?? "THB";
  const fee = ["TRANSFER", "FX_EXCHANGE"].includes(type) ? num(form.get("fee")) : null;
  const row: Record<string, unknown> = {
    movement_date: date, movement_type: type, amount, currency,
    from_asset_id: isIn ? null : fromBank,
    to_asset_id: ["TRANSFER", "FX_EXCHANGE", "OTHER_IN"].includes(type) ? toBank : null,
    to_credit_card_id: type === "CARD_PAYMENT" ? str(form.get("card_id")) : null,
    fee: fee && fee > 0 ? fee : null, fee_currency: fee && fee > 0 ? currency : null,
    description: str(form.get("description")),
    metadata: { fee_as_expense: form.get("fee_as_expense") === "on", via: "income_expenses" },
  };
  if (type === "FX_EXCHANGE") {
    const counter = num(form.get("counter_amount"));
    if (bad(counter)) return { error: "กรุณาใส่ยอดที่ได้รับในบัญชีปลายทาง" };
    const { data: to } = await supabase.from("assets").select("currency").eq("id", toBank ?? "").maybeSingle();
    row.counter_amount = counter; row.counter_currency = to?.currency;
  }
  const mvAccs: LumpAcc[] = [{ kind: "BANK", id: row.from_asset_id as string | null }, { kind: "BANK", id: row.to_asset_id as string | null },
    { kind: "CARD", id: row.to_credit_card_id as string | null }];
  const mvBefore = await lumpSnap(supabase, mvAccs, date);
  const { error } = await supabase.from("cash_movements").insert(row);
  if (error) return { error: friendlyError(error.message) };
  const mvNote = lumpNote(mvBefore, await lumpSnap(supabase, mvAccs, date), mvAccs, date);

  // จ่ายแล้วอัปเดตยอดทันที (ไม่บังคับ)
  const newBal = num(form.get("new_balance"));
  if (type === "CARD_PAYMENT" && form.get("update_balance") === "on" && newBal !== null && !Number.isNaN(newBal)) {
    const { error: e2 } = await supabase.from("credit_cards").update({ outstanding_balance: newBal, balance_date: date })
      .eq("id", String(form.get("card_id")));
    if (e2) return { error: `บันทึกการจ่ายแล้ว แต่อัปเดตยอดบัตรไม่สำเร็จ: ${friendlyError(e2.message)}` };
  }
  return done(`บันทึกรายการแล้ว${mvNote}`, ["/liabilities"]);
}

/** แยกรายการ "รอแยกรายละเอียด" เป็นหลายบรรทัด (ยอดรวมไม่เกินก้อน · ส่วนที่เหลือยังรอแยก) — ทำได้แม้ปิดงวดแล้ว */
export async function splitPending(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const kind = String(form.get("kind")) === "INCOME" ? "INCOME" : "EXPENSE";
  const id = String(form.get("id"));
  let lines: { description: string; amount: string; expense_category?: string; income_type?: string; person_id?: string; transfer_with?: string }[] = [];
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "ข้อมูลไม่ถูกต้อง" }; }
  const clean = lines.filter((l) => l.description?.trim() || l.amount?.trim())
    .map((l) => ({ ...l, amount: num(l.amount) }));
  if (!clean.length) return { error: "กรุณาใส่อย่างน้อย 1 บรรทัด" };
  const transfers = clean.filter((l) => l.transfer_with);
  const items = clean.filter((l) => !l.transfer_with);
  if (clean.some((l) => l.amount === null || Number.isNaN(l.amount) || l.amount <= 0)) return { error: "ทุกบรรทัดต้องมีจำนวนเงินมากกว่า 0" };
  if (items.some((l) => !l.description?.trim())) return { error: "รายการที่ไม่ใช่เงินโอน ต้องมีรายละเอียด" };

  // ก้อนนี้ (บัญชี / วันที่ / ยอด) — เงินโอนแยกได้เฉพาะก้อนของบัญชีธนาคาร
  const { data: lump } = kind === "EXPENSE"
    ? await supabase.from("expense_items").select("date,amount,currency,paid_from_asset_id").eq("id", id).eq("pending_split", true).maybeSingle()
    : await supabase.from("income_transactions").select("date,amount,currency,received_to_asset_id").eq("id", id).eq("pending_split", true).maybeSingle();
  if (!lump) return { error: "ไม่พบรายการรอแยก" };
  const l = lump as { date: string; amount: number; currency: string; paid_from_asset_id?: string | null; received_to_asset_id?: string | null };
  const bank = l.paid_from_asset_id ?? l.received_to_asset_id ?? null;
  if (transfers.length && !bank) return { error: "แยกเป็นเงินโอนได้เฉพาะก้อนของบัญชีธนาคาร" };
  const total = clean.reduce((t, x) => t + Number(x.amount), 0);
  if (total > Number(l.amount) + 0.005) return { error: "ยอดที่แยกมากกว่ายอดรอแยก" };

  let left = Number(l.amount);
  if (items.length) {
    const { data, error } = await supabase.rpc("split_pending_item", { p_kind: kind, p_id: id, p_lines: items });
    if (error) return { error: friendlyError(error.message) };
    left = Number(data ?? 0);
  }
  // เงินโอน: ค่าใช้จ่ายก้อน = เงินออกจากบัญชีนี้ · รายได้ก้อน = เงินเข้าบัญชีนี้ → ก้อนลดเองอัตโนมัติ
  for (const t of transfers) {
    const { error } = await supabase.from("cash_movements").insert({
      movement_date: l.date, movement_type: "TRANSFER", amount: t.amount, currency: l.currency,
      from_asset_id: kind === "EXPENSE" ? bank : t.transfer_with, to_asset_id: kind === "EXPENSE" ? t.transfer_with : bank,
      description: t.description?.trim() || "เงินโอน (แยกจากก้อนรอแยก)",
      metadata: { via: "split_pending", lump_id: id },
    });
    if (error) {
      return { error: `${items.length ? "แยกรายการแล้ว แต่" : ""}บันทึกเงินโอนไม่สำเร็จ: ${friendlyError(error.message)}` };
    }
    left -= Number(t.amount);
  }
  if (transfers.length) {
    const { data: after } = await supabase.rpc("lump_status", { p_kind: "BANK", p_id: bank, p_date: l.date });
    left = Math.abs(Number((after as { amount?: number } | null)?.amount ?? 0));
  }
  return done(left > 0.005 ? `แยกแล้ว · ยังรอแยกอีก ${f2(left)}` : "แยกครบแล้ว", ["/liabilities"]);
}

/** แก้รายได้ / ค่าใช้จ่ายที่บันทึกเอง ด้วยปุ่ม "บันทึก" ปุ่มเดียว (ช่องทั่วไป + บัญชี + ประเภท ในคำสั่งเดียว) */
const ENTRY_FIELDS: Record<"INCOME" | "EXPENSE", Record<string, "num" | "str" | "date">> = {
  INCOME: { date: "date", amount: "num", tax: "num", notes: "str", person_id: "str", income_subtype: "str" },
  EXPENSE: { date: "date", description: "str", amount: "num", expense_category: "str", notes: "str", person_id: "str",
    expected_reimbursement_amount: "num" },
};
export async function saveEntry(_: ActionState, form: FormData): Promise<ActionState> {
  const kind = String(form.get("kind")) === "INCOME" ? "INCOME" : "EXPENSE";
  const fields: Record<string, string | number | null> = {};
  for (const [name, type] of Object.entries(ENTRY_FIELDS[kind])) {
    if (!form.has(`f_${name}`)) continue;
    if (type === "num") {
      const v = num(form.get(`f_${name}`));
      if (v !== null && Number.isNaN(v)) return { error: "ตัวเลขไม่ถูกต้อง" };
      if (name === "amount" && (v === null || v <= 0)) return { error: "กรุณาใส่ยอดมากกว่า 0" };
      fields[name] = v;
    } else {
      fields[name] = str(form.get(`f_${name}`));
    }
  }
  if (kind === "EXPENSE" && fields.expense_category === null) return { error: "กรุณาเลือกหมวด" };
  if (kind === "INCOME" && fields.tax != null && fields.amount != null && Number(fields.tax) > Number(fields.amount)) {
    return { error: "ภาษีต้องไม่เกินยอดรายได้" };
  }
  // บัญชี: ส่งเฉพาะเมื่อฟอร์มมีช่องบัญชี · bank → a:<id> · card → c:<id> · cash → ไม่ผ่านบัญชี
  let account: string | null = null;
  if (form.has("pay_via")) {
    const via = String(form.get("pay_via"));
    if (via === "bank") {
      const b = str(form.get("bank_asset_id"));
      if (!b) return { error: "กรุณาเลือกบัญชี" };
      account = `a:${b}`;
    } else if (via === "card") {
      const c = str(form.get("card_id"));
      if (!c) return { error: "กรุณาเลือกบัตร" };
      account = `c:${c}`;
    } else account = "";
  }
  const supabase = await createClient();
  const id = String(form.get("id"));
  const { data: cur } = kind === "INCOME"
    ? await supabase.from("income_transactions").select("date,received_to_asset_id").eq("id", id).maybeSingle()
    : await supabase.from("expense_items").select("date,paid_from_asset_id,paid_from_credit_card_id").eq("id", id).maybeSingle();
  const old = (cur ?? {}) as { date?: string; received_to_asset_id?: string | null; paid_from_asset_id?: string | null; paid_from_credit_card_id?: string | null };
  const newDate = (fields.date as string | null) ?? old.date ?? null;
  const accs: LumpAcc[] = [
    { kind: "BANK", id: old.received_to_asset_id ?? old.paid_from_asset_id }, { kind: "CARD", id: old.paid_from_credit_card_id },
    { kind: "BANK", id: account?.startsWith("a:") ? account.slice(2) : null }, { kind: "CARD", id: account?.startsWith("c:") ? account.slice(2) : null }];
  const before = await lumpSnap(supabase, accs, newDate);
  const { data, error } = await supabase.rpc("update_entry", {
    p_kind: kind, p_id: id, p_fields: fields, p_account: account,
    p_income_type: kind === "INCOME" ? str(form.get("income_type")) : null,
  });
  if (error) return { error: friendlyError(error.message) };
  const warn = (data as { recon_warning?: boolean } | null)?.recon_warning;
  const note = lumpNote(before, await lumpSnap(supabase, accs, newDate), accs, null);
  return done((warn ? "บันทึกแล้ว · บัญชีนี้กระทบยอดเดือนนี้ไปแล้ว ให้ตรวจที่หน้ากระทบยอด (Month Closing) อีกครั้ง" : "บันทึกแล้ว") + note,
    ["/liabilities", "/month-closing", "/"]);
}

// ------------------------------------------------------------------ ค่าใช้จ่ายประจำทั่วไป
export async function addExpenseTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("expected_amount"));
  if (amount === null || Number.isNaN(amount) || amount < 0) return { error: "กรุณาใส่ยอดที่จ่ายตามปกติ" };
  const category = str(form.get("expense_category"));
  if (!category) return { error: "กรุณาเลือกหมวด" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  if (!fam) return { error: "ไม่พบข้อมูลครอบครัว" };
  const via = String(form.get("pay_via") ?? "BANK");
  const bank = via === "BANK" ? str(form.get("pay_from_asset_id")) : null;
  const card = via === "CARD" ? str(form.get("pay_from_credit_card_id")) : null;
  if (via === "CARD" && !card) return { error: "กรุณาเลือกบัตร" };
  let currency = str(form.get("currency")) ?? "THB";
  if (bank) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", bank).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  if (card) {
    const { data: c } = await supabase.from("credit_cards").select("currency").eq("id", card).maybeSingle();
    if (c?.currency) currency = c.currency;
  }
  const { error } = await supabase.from("recurring_expense_templates").insert({
    family_id: fam.id, name: str(form.get("name")), expense_category: category, person_id: str(form.get("person_id")),
    expected_amount: amount, currency, frequency: str(form.get("frequency")) ?? "MONTHLY", due_day: num(form.get("due_day")),
    pay_via: via, pay_from_asset_id: bank, pay_from_credit_card_id: card,
    start_date: str(form.get("start_date")), end_date: str(form.get("end_date")), notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("เพิ่มค่าใช้จ่ายประจำแล้ว");
}

export async function toggleExpenseTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_expense_templates")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return done("บันทึกแล้ว");
}

/** บันทึกจ่ายค่าใช้จ่ายประจำทั่วไป 1 งวด (ยอดจริง) */
export async function payRecurringExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const via = String(form.get("pay_via") ?? "bank");
  const accs: LumpAcc[] = [{ kind: "BANK", id: via === "bank" ? str(form.get("bank_asset_id")) : null },
    { kind: "CARD", id: via === "card" ? str(form.get("card_id")) : null }];
  const before = await lumpSnap(supabase, accs, str(form.get("date")));
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    paid_from_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    paid_from_credit_card_id: via === "card" ? str(form.get("card_id")) : null,
    person_id: str(form.get("person_id")),
    recurring_expense_id: str(form.get("template_id")), cost_period: str(form.get("cost_period")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  const note = lumpNote(before, await lumpSnap(supabase, accs, str(form.get("date"))), accs, str(form.get("date")));
  return done(`บันทึกจ่ายแล้ว${note}`, ["/liabilities"]);
}

/** "เดือนนี้ไม่ได้จ่าย" — ค่าใช้จ่ายประจำทั่วไป (RECURRING) / ของทรัพย์สิน (PROPERTY) */
export async function dismissExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const reason = str(form.get("reason"));
  if (!reason) return { error: "กรุณาระบุเหตุผล" };
  const { error } = await supabase.from("expected_expense_dismissals").insert({
    source_type: String(form.get("source_type")), source_id: String(form.get("source_id")),
    cost_period: String(form.get("cost_period")), reason,
  });
  if (error) return { error: error.code === "23505" ? "งวดนี้บันทึกไว้แล้ว" : friendlyError(error.message) };
  revalidatePath("/property", "layout");
  return done("บันทึกว่าเดือนนี้ไม่ได้จ่ายแล้ว");
}

export async function undoDismissExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("expected_expense_dismissals")
    .update({ deleted_at: new Date().toISOString() }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/property", "layout");
  return done("ยกเลิกแล้ว · กลับเป็นรอจ่าย");
}

// ------------------------------------------------------------------ ตั้งค่า: หมวดค่าใช้จ่าย / ประเภทย่อยรายได้อื่น
const SYS_CATS = ["BANK_FEE", "รอแยกรายละเอียด"];
function catDone(msg: string): ActionState {
  revalidatePath("/income-expenses");
  revalidatePath("/property", "layout");
  revalidatePath("/");
  return { ok: msg };
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const name = str(form.get("name"));
  if (!["EXPENSE", "INCOME_OTHER"].includes(kind)) return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  if (SYS_CATS.includes(name)) return { error: "ชื่อนี้ระบบใช้อยู่" };
  const { data: last } = await supabase.from("ie_categories").select("sort_order").eq("kind", kind).is("deleted_at", null)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("ie_categories").insert({ kind, name, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return { error: error.message.includes("ie_categories_name_uq") || error.code === "23505" ? "มีชื่อนี้อยู่แล้ว" : friendlyError(error.message) };
  return catDone("เพิ่มแล้ว");
}

export async function renameCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rename_ie_category", { p_id: String(form.get("id")), p_name: String(form.get("name") ?? "") });
  if (error) return { error: error.code === "23505" ? "มีชื่อนี้อยู่แล้ว" : friendlyError(error.message) };
  const n = Number(data ?? 0);
  return catDone(n > 0 ? `เปลี่ยนชื่อแล้ว · ปรับรายการเดิม ${n} รายการ` : "เปลี่ยนชื่อแล้ว");
}

export async function toggleCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ie_categories")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return catDone("บันทึกแล้ว");
}

export async function moveCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_ie_category", { p_id: String(form.get("id")), p_dir: Number(form.get("dir")) });
  if (error) return { error: friendlyError(error.message) };
  return catDone("เลื่อนลำดับแล้ว");
}
