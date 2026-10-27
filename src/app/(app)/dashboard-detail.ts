"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INCOME_TYPE_LABEL, monthRange, todayBangkok } from "@/lib/format";

// รายละเอียดของกล่องบน Dashboard (โหลดตอนกดเปิด pop up เท่านั้น → หน้า Dashboard ไม่ช้าลง)
//   flows  = รายได้ตามประเภท · ค่าใช้จ่ายตามหมวด · รายได้ลงทุนตามพอร์ต · 10 รายการค่าใช้จ่ายสูงสุด
//   groups = มูลค่าตามหมวดสินทรัพย์ / หนี้สิน ต้นงวด → สิ้นงวด
//   gain   = กำไร / ขาดทุนเงินลงทุนตามพอร์ต
//   รายคน (personId) = ส่วนแบ่งของคนนั้น (กติกาเดียวกับ v_income_by_person / v_expense_by_person และ Dashboard รายคน)

export type Row = { key: string; label: string; value: number; count?: number };
export type MonthFlows = {
  income: Row[]; incomeTotal: number;
  investment: Row[]; investmentTotal: number;
  expense: Row[]; expenseTotal: number; reimbursements: number;
  topExpenses: { date: string; label: string; category: string; value: number }[];
};
export type GroupChange = { key: string; label: string; start: number; end: number };
/** กำไร / ขาดทุนเงินลงทุนของเดือน (public.month_investment_gain) · flows = เงินเข้า (+) / ออก (−) พอร์ตที่ไม่ใช่ผลการลงทุน */
export type InvestmentGain = {
  prev_date: string; as_of: string; gain: number; fx: number;
  by_portfolio: { asset_id: string; name: string; start: number; end: number; flows: number; gain: number; fx: number }[];
};

const GROUPS: [string, string][] = [["FINANCIAL", "เงินฝาก / เงินสด"], ["LOANS", "เงินให้กู้"], ["INVESTMENT", "การลงทุน"], ["BUSINESS", "ธุรกิจ"],
  ["PROPERTY", "อสังหาริมทรัพย์"], ["ALTERNATIVE", "สินทรัพย์อื่น"], ["INSURANCE", "ประกัน (มูลค่าเวนคืน)"]];
type Item = { item_type: string; item_group: string; base_value: number | null };

const ymd = (s: string) => /^\d{4}-\d{2}-01$/.test(s);
const afterTax = (base: number, tax: number, amount: number) => (amount ? base * (1 - tax / amount) : base);
const sortRows = (m: Map<string, Row>) => [...m.values()].filter((r) => Math.abs(r.value) >= 0.005).sort((a, b) => b.value - a.value);
const add = (m: Map<string, Row>, key: string, label: string, v: number) => {
  const r = m.get(key) ?? { key, label, value: 0, count: 0 };
  r.value += v; r.count = (r.count ?? 0) + 1; m.set(key, r);
};

export async function loadMonthFlows(start: string, personId: string): Promise<MonthFlows | { error: string }> {
  await requireAppUser();
  if (!ymd(start)) return { error: "เดือนไม่ถูกต้อง" };
  const supabase = await createClient();
  const { end } = monthRange(start.slice(0, 7));
  const today = todayBangkok();
  const asOf = end < today ? end : today;                               // เหมือน month_net_worth_preview: ถึงวันนี้

  // รายได้
  type Inc = { id: string; income_type: string; income_subtype: string | null; amount: number; tax: number | null; base_amount: number | null;
    source_transaction_id: string | null; asset_id: string | null };
  const incSel = "id,income_type,income_subtype,amount,tax,base_amount,source_transaction_id,asset_id";
  let incomes: (Inc & { k: number })[] = [];
  // ค่าใช้จ่าย
  type Exp = { id: string; date: string; description: string | null; expense_category: string | null; base_amount: number | null };
  let expenses: (Exp & { k: number })[] = [];
  if (personId) {
    const [{ data: is }, { data: es }] = await Promise.all([
      supabase.from("v_income_by_person").select("income_id,share_percent").eq("person_id", personId).gte("date", start).lte("date", asOf),
      supabase.from("v_expense_by_person").select("expense_item_id,share_percent").eq("person_id", personId).gte("date", start).lte("date", asOf),
    ]);
    const ik = new Map((is ?? []).map((r) => [r.income_id as string, Number(r.share_percent) / 100]));
    const ek = new Map((es ?? []).map((r) => [r.expense_item_id as string, Number(r.share_percent) / 100]));
    const [{ data: ir }, { data: er }] = await Promise.all([
      ik.size ? supabase.from("income_transactions").select(incSel).in("id", [...ik.keys()]) : Promise.resolve({ data: [] as Inc[] }),
      ek.size ? supabase.from("expense_items").select("id,date,description,expense_category,base_amount").in("id", [...ek.keys()]) : Promise.resolve({ data: [] as Exp[] }),
    ]);
    incomes = ((ir ?? []) as Inc[]).map((i) => ({ ...i, k: ik.get(i.id) ?? 0 }));
    expenses = ((er ?? []) as Exp[]).map((e) => ({ ...e, k: ek.get(e.id) ?? 0 }));
  } else {
    const [{ data: ir }, { data: er }] = await Promise.all([
      supabase.from("income_transactions").select(incSel).is("deleted_at", null).gte("date", start).lte("date", asOf),
      supabase.from("expense_items").select("id,date,description,expense_category,base_amount,monthly_expenses!inner(deleted_at)")
        .is("deleted_at", null).is("monthly_expenses.deleted_at", null).gte("date", start).lte("date", asOf),
    ]);
    incomes = ((ir ?? []) as Inc[]).map((i) => ({ ...i, k: 1 }));
    expenses = ((er ?? []) as unknown as Exp[]).map((e) => ({ ...e, k: 1 }));
  }

  const inc = new Map<string, Row>(), inv = new Map<string, Row>(), exp = new Map<string, Row>();
  const pfIds = [...new Set(incomes.filter((i) => i.source_transaction_id && i.asset_id).map((i) => i.asset_id as string))];
  const { data: pfs } = pfIds.length ? await supabase.from("assets").select("id,name").in("id", pfIds) : { data: [] };
  const pfName = new Map((pfs ?? []).map((a) => [a.id as string, a.name as string]));
  for (const i of incomes) {
    const v = afterTax(Number(i.base_amount ?? 0), Number(i.tax ?? 0), Number(i.amount)) * i.k;
    if (i.source_transaction_id) add(inv, i.asset_id ?? "-", pfName.get(i.asset_id ?? "") ?? "พอร์ตลงทุน", v);
    else {
      const key = i.income_type === "OTHER" && i.income_subtype ? `OTHER:${i.income_subtype}` : i.income_type;
      add(inc, key, i.income_type === "OTHER" && i.income_subtype ? i.income_subtype : INCOME_TYPE_LABEL[i.income_type] ?? i.income_type, v);
    }
  }
  for (const e of expenses) add(exp, e.expense_category ?? "-", e.expense_category ?? "ไม่ระบุหมวด", Number(e.base_amount ?? 0) * e.k);
  const top = expenses.map((e) => ({ date: e.date, label: e.description ?? "-", category: e.expense_category ?? "", value: Number(e.base_amount ?? 0) * e.k }))
    .sort((a, b) => b.value - a.value).slice(0, 10);

  // เงินคืน (ยอดเดียวกับกล่องบน Dashboard) — จาก month_net_worth_preview / person_dashboard
  const reimb = personId
    ? Number(((await supabase.rpc("person_dashboard", { p_month: start, p_person: personId })).data as { reimbursements?: number } | null)?.reimbursements ?? 0)
    : Number(((await supabase.rpc("month_net_worth_preview", { p_month: start })).data as { reimbursements?: number } | null)?.reimbursements ?? 0);

  const sum = (m: Map<string, Row>) => [...m.values()].reduce((t, r) => t + r.value, 0);
  return {
    income: sortRows(inc), incomeTotal: sum(inc),
    investment: sortRows(inv), investmentTotal: sum(inv),
    expense: sortRows(exp), expenseTotal: sum(exp), reimbursements: reimb,
    topExpenses: top,
  };
}

export async function loadGroupChanges(start: string, personId: string): Promise<GroupChange[] | { error: string }> {
  await requireAppUser();
  if (!ymd(start)) return { error: "เดือนไม่ถูกต้อง" };
  const supabase = await createClient();
  const prev = monthRange(start.slice(0, 7)).prev;
  const items = async (m: string) => (personId
    ? (await supabase.rpc("month_person_items", { p_month: m, p_person: personId })).data
    : (await supabase.rpc("month_family_items", { p_month: m })).data) as Item[] | null;
  // ต้นงวด = สิ้นเดือนก่อน (ปิดเดือนแล้วใช้ Snapshot · เดือน Go-live = ยอดตั้งต้น) — ฐานเดียวกับ "ความมั่งคั่งเปลี่ยนเพราะอะไร"
  const [a, b] = await Promise.all([items(`${prev}-01`), items(start)]);
  const group = (xs: Item[] | null) => {
    const m = new Map<string, number>();
    for (const i of xs ?? []) {
      const k = i.item_type === "LIABILITY" ? "LIABILITY" : GROUPS.some(([g]) => g === i.item_group) ? i.item_group : "ALTERNATIVE";
      m.set(k, (m.get(k) ?? 0) + Number(i.base_value ?? 0));
    }
    return m;
  };
  const s = group(a), e = group(b);
  return [...GROUPS, ["LIABILITY", "หนี้สิน"] as [string, string]]
    .map(([key, label]) => ({ key, label, start: s.get(key) ?? 0, end: e.get(key) ?? 0 }))
    .filter((r) => r.start !== 0 || r.end !== 0);
}

export async function loadInvestmentGain(start: string, personId: string): Promise<InvestmentGain | null | { error: string }> {
  await requireAppUser();
  if (!ymd(start)) return { error: "เดือนไม่ถูกต้อง" };
  const { data, error } = await (await createClient()).rpc("month_investment_gain", { p_month: start, p_person: personId || null });
  if (error) return { error: error.message };
  return (data ?? null) as InvestmentGain | null;
}
