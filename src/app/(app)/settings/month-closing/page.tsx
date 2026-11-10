import Link from "next/link";
import { PageInfo } from "@/components/HeaderBar";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, monthRange, thDate, thMonth, todayBangkok, signedMoney, plusMoney, minusMoney } from "@/lib/format";
import { FinalizeForm, ReopenForm } from "./forms";
import { ActionBar } from "@/components/ActionBar";
import { StatBox } from "@/components/Boxes";
import { cachedRpc } from "@/lib/data-cache";

type Issue = { severity: string; code: string; message: string; entity_type: string | null; entity_id: string | null };
type Check = { category: string; status: string; issue_count: number; issues: Issue[] };
type Preview = {
  month: string; as_of: string; confirmed: boolean; financial: number; investment: number; property: number; alternative: number;
  total_assets: number; total_liabilities: number; net_worth: number; unallocated: number; missing_fx_items: number;
  carried_forward_items: number; prev_net_worth: number | null; prev_label: string | null; prev_date: string | null;
  income: number; investment_income: number; expenses: number; reimbursements: number; other_change: number | null;
  snapshot: { status: string; version: number; finalized_at: string | null; net_worth: number; closing_warnings: Check[] | null } | null;
  by_person: { person_id: string | null; name: string; assets: number; liabilities: number; net_worth: number }[];
  fx: { currency: string; rate: number | null; rate_date: string | null }[];
};

const CAT: Record<string, string> = {
  CASH: "Bank Accounts (อัปเดตยอดคงเหลือ)", INVESTMENTS: "Investments", PROPERTY_OTHER: "Property / สินทรัพย์อื่น",
  LIABILITIES: "Liabilities / บัตรเครดิต", INCOME_EXPENSES: "Income & Expenses", OWNERSHIP: "สัดส่วนเจ้าของ", FX_SYSTEM: "FX & ระบบ",
};
const PILL: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700", REVIEW: "bg-amber-50 text-amber-800", BLOCKED: "bg-red-50 text-red-700",
};

function fixLink(i: Issue, ym: string, end: string): string | null {
  switch (i.entity_type) {
    case "HOLDING": case "INVESTMENT_TX": return "/investments";
    case "PROPERTY_LEASE": return "/property";
    case "LIABILITY": return i.entity_id ? `/liabilities/${i.entity_id}` : "/liabilities";
    case "CREDIT_CARD": return i.entity_id ? `/liabilities/cards/${i.entity_id}` : "/liabilities#cards";
    case "RECURRING": case "LEASE": return `/income-expenses?tab=income&m=${ym}`;
    case "MONTHLY_EXPENSE": return `/income-expenses?tab=expense&m=${ym}`;
    case "FX_RATE": return "/settings/system";
    case "CASH_MOVEMENT": case "EXPENSE": case "INCOME": return `/income-expenses?tab=overview&m=${ym}`;
    case "PENDING_EXPENSE": return `/income-expenses?tab=expense&et=split&m=${ym}`;
    case "PENDING_INCOME": return `/income-expenses?tab=income&it=split&m=${ym}`;
  }
  if (i.code === "NOT_LIVE") return "/settings/opening";
  if (i.code === "NEGATIVE_BALANCE" && i.entity_id) return `/financial/cash/${i.entity_id}?m=${ym}`;
  if (i.code === "BALANCE_NOT_UPDATED" || i.code?.startsWith("RECON")) return `/financial/cash?tab=update&d=${end}`;
  if (i.code === "IN_TRANSIT" && i.entity_id) return `/investments/${i.entity_id}`;
  if (i.entity_type === "ASSET" && i.entity_id) return `/a/${i.entity_id}`;
  if (i.entity_type === "LIABILITY" && i.entity_id) return `/liabilities/${i.entity_id}`;
  return null;
}

// มูลค่าเก่า (VALUE_OLD) แยกตามหน้าที่ต้องไปอัปเดต
function valueDest(a: { asset_group: string; asset_type: string }): { href: string; label: string } | null {
  if (a.asset_type === "PRIVATE_BUSINESS") return { href: "/financial/business", label: "Private Business" };
  if (a.asset_type === "INSURANCE_CASH_VALUE") return { href: "/insurance", label: "Insurance" };
  if (a.asset_group === "PROPERTY") return { href: "/property", label: "Property" };
  if (a.asset_group === "ALTERNATIVE") return { href: "/alternative", label: "Alternative Assets" };
  return null;
}

type Line = { text: string; href: string | null; blocked: boolean };

/**
 * Checklist ต่อหมวด: รายการที่ BLOCKED แสดงทีละรายการ (อยู่บนสุด) ·
 * คำเตือนที่ต้องไปแก้ที่หน้าต้นทางอยู่แล้ว รวมเป็นบรรทัดสรุป + ลิงก์ · คำเตือนอื่นแสดงทีละรายการ
 */
function checkLines(issues: Issue[], ym: string, end: string, dest: Map<string, { href: string; label: string }>): Line[] {
  const groups = new Map<string, { n: number; text: (n: number) => string; href: string }>();
  const blocked: Line[] = [], single: Line[] = [];
  const group = (key: string, href: string, text: (n: number) => string) => {
    const g = groups.get(key);
    if (g) g.n++; else groups.set(key, { n: 1, text, href });
  };
  for (const i of issues) {
    if (i.severity === "BLOCKED") { blocked.push({ text: i.message, href: fixLink(i, ym, end), blocked: true }); continue; }
    const d = i.code === "VALUE_OLD" && i.entity_id ? dest.get(i.entity_id) : undefined;
    if (i.code === "BALANCE_NOT_UPDATED")
      group(i.code, `/financial/cash?tab=update&d=${end}`, (n) => `ยังไม่ได้อัปเดตยอดสิ้นเดือน ${n} บัญชี · ใช้ยอดตามระบบ (ยอดล่าสุด + เงินเข้า − เงินออก)`);
    else if (i.code === "PRICE_OLD") group(i.code, "/investments", (n) => `ราคาล่าสุดเก่ากว่า 30 วัน ${n} รายการ`);
    else if (i.code === "COST_ONLY") group(i.code, "/investments", (n) => `ใช้ราคาทุน · รอ Statement ${n} รายการ`);
    else if (i.code === "CASH_NOT_UPDATED")
      group(i.code, `/investments?tab=update&d=${end}`, (n) => `บัญชีเงินฝากในพอร์ตยังไม่ได้อัปเดตยอดสิ้นเดือน ${n} บัญชี · ใช้ยอดตามระบบ`);
    else if (d) group(`VALUE_OLD:${d.href}`, d.href, (n) => `${d.label}: มูลค่าล่าสุดเก่ากว่า 90 วัน / ยังไม่มีมูลค่า ${n} รายการ`);
    else if (i.code === "EXPECTED_OVERDUE")
      group(i.code, `/income-expenses?tab=income&m=${ym}`, (n) => `รายได้ถึงกำหนดแต่ยังไม่ได้รับ ${n} รายการ`);
    else if (i.code === "PENDING_SPLIT" && i.entity_type === "PENDING_EXPENSE")
      group("PENDING_EXPENSE", `/income-expenses?tab=expense&et=split&m=${ym}`, (n) => `ค่าใช้จ่ายรอแยกรายละเอียด ${n} ก้อน`);
    else if (i.code === "PENDING_SPLIT" && i.entity_type === "PENDING_INCOME")
      group("PENDING_INCOME", `/income-expenses?tab=income&it=split&m=${ym}`, (n) => `รายได้รอแยกรายละเอียด ${n} ก้อน`);
    else single.push({ text: i.message, href: fixLink(i, ym, end), blocked: false });
  }
  return [...blocked, ...[...groups.values()].map((g) => ({ text: g.text(g.n), href: g.href, blocked: false })), ...single];
}

type Card = { id: string; issuer: string | null; card_name: string | null; card_last4: string | null; currency: string };
type Flow = Record<string, string | number | null>;

/**
 * แท็บ Month Closing (ปรับ 4 พ.ย. 2026):
 *   สถานะเดือนที่ต้องปิด (บนสุด) → การ์ดสรุป → Checklist (บัตรเครดิตอยู่ในแถว Liabilities) → เดือนที่ปิดแล้ว (+ ยกเลิกการปิดเดือนล่าสุด)
 *   ไม่มีปุ่มเลือกเดือน: เปิดมาที่เดือนที่ต้องปิดถัดไปเสมอ · เดือนที่ปิดแล้วกดดูจากตาราง (?m=YYYY-MM)
 *   ข้อมูล: ดึงพร้อมกันรอบเดียว (+ รอบที่ต้องรู้เดือนก่อน) · ผลคำนวณหนัก (ตรวจความพร้อม / Net Worth / ยอดธนาคาร) จำไว้จนมีการบันทึก (cachedRpc)
 */
export default async function MonthClosingPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const asked = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : null;

  const familyP = supabase.from("families").select("go_live_date,system_status").maybeSingle().then((r) => r);
  const finalsP = supabase.from("net_worth_snapshots").select("snapshot_month,status,version,net_worth,total_assets,total_liabilities,finalized_at").is("deleted_at", null)
    .eq("status", "FINAL").order("snapshot_month", { ascending: false }).then((r) => r);
  // เดือนที่ต้องปิดถัดไป = เดือนถัดจากเดือนที่ปิดล่าสุด (ยังไม่เคยปิด = เดือน Go-live)
  const defaultP = Promise.all([familyP, finalsP]).then(([{ data: family }, { data: finals }]) => {
    const lastFinal = finals?.[0]?.snapshot_month?.slice(0, 7);
    return lastFinal ? monthRange(lastFinal).next : (family?.go_live_date ?? today).slice(0, 7);
  });
  // เปิดดูเดือนที่ระบุ (?m=) ไม่ต้องรอรู้เดือนที่ต้องปิดก่อน
  const monthP = (asked ? Promise.resolve(asked) : defaultP).then((ym) => ({ ym, ...monthRange(ym) }));
  const checksP = monthP.then(({ start }) => cachedRpc<Check[]>("month_closing_checks", { p_month: start }));
  const asOfP = monthP.then(({ end }) => (end < today ? end : today));
  const cardsP = supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency,status")
    .is("deleted_at", null).eq("status", "ACTIVE").order("issuer").then((r) => (r.data ?? []) as Card[]);
  // บัตรเครดิต ณ สิ้นเดือน = ยอด Statement ล่าสุด (≤ สิ้นเดือน) + รูดหลังวันนั้น − จ่ายบัตร − เงินคืน / รายได้เข้าบัตร
  const cardFlowsP = Promise.all([cardsP, asOfP]).then(([cards, asOf]) => {
    const ids = cards.map((c) => c.id);
    if (!ids.length) return [[], [], [], [], [], []] as Flow[][];
    return Promise.all([
      supabase.from("credit_card_statements").select("credit_card_id,statement_date,balance").in("credit_card_id", ids)
        .is("deleted_at", null).lte("statement_date", asOf).order("statement_date", { ascending: false }),
      supabase.from("expense_items").select("paid_from_credit_card_id,date,amount").in("paid_from_credit_card_id", ids)
        .is("deleted_at", null).lte("date", asOf),
      supabase.from("cash_movements").select("to_credit_card_id,movement_date,amount").eq("movement_type", "CARD_PAYMENT")
        .in("to_credit_card_id", ids).is("deleted_at", null).lte("movement_date", asOf),
      supabase.from("expense_reimbursements").select("received_to_credit_card_id,received_date,amount").in("received_to_credit_card_id", ids)
        .is("deleted_at", null).lte("received_date", asOf),
      supabase.from("income_transactions").select("received_to_credit_card_id,date,amount,tax").in("received_to_credit_card_id", ids)
        .is("deleted_at", null).lte("date", asOf),
      // ซื้อทรัพย์สินด้วยบัตร (นับเป็นยอดรูด)
      supabase.from("cash_movements").select("from_credit_card_id,movement_date,amount").eq("movement_type", "ASSET_PURCHASE")
        .in("from_credit_card_id", ids).is("deleted_at", null).lte("movement_date", asOf),
    ]).then((rs) => rs.map((r) => (r.data ?? []) as Flow[]));
  });

  const [{ data: finals }, defaultYm, { ym, start, end }, checksRaw, previewRaw, { data: banks }, { data: recons }, balAt, valueAssets, cards,
    [stmts, cExp, cPay, cRe, cInc, cBuy]] = await Promise.all([
    finalsP, defaultP, monthP, checksP,
    monthP.then(({ start }) => cachedRpc<Preview>("month_net_worth_preview", { p_month: start })),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order").then((r) => r),
    monthP.then(({ start }) => supabase.from("bank_reconciliations").select("bank_asset_id,status").eq("year_month", start).is("deleted_at", null).neq("status", "OPEN")),
    asOfP.then((d) => cachedRpc<{ asset_id: string; last_date: string | null }[]>("bank_balances_at", { p_date: d })),
    // มูลค่าเก่า (VALUE_OLD) → ต้องรู้ประเภททรัพย์สินเพื่อชี้ไปหน้าที่ถูก
    checksP.then((cs) => {
      const ids = (cs ?? []).flatMap((c) => c.issues).filter((i) => i.code === "VALUE_OLD" && i.entity_id).map((i) => i.entity_id as string);
      return ids.length ? supabase.from("assets").select("id,asset_group,asset_type").in("id", ids).then((r) => r.data ?? []) : [];
    }),
    cardsP, cardFlowsP,
  ]);
  const loadFailed = checksRaw == null || previewRaw == null;
  const lastAt = new Map((balAt ?? []).map((r) => [r.asset_id, r.last_date]));
  // "ค่าใช้จ่ายบันทึกครบ / ไม่ครบ" ไม่ใช้แล้ว (เงินคงเหลือสุทธิคิดจากรายการที่บันทึกเสมอ) → ไม่แสดงเป็นข้อให้ตรวจ
  const notTracking = (i: Issue) => !i.code.startsWith("EXPENSE_");
  const checks = (checksRaw ?? []).map((c) => {
    const issues = c.issues.filter(notTracking);
    return { ...c, issues, issue_count: issues.length, status: c.status === "REVIEW" && !issues.some((i) => i.severity === "REVIEW") ? "READY" : c.status };
  });
  const dest = new Map((valueAssets as { id: string; asset_group: string; asset_type: string }[]).flatMap((a) => { const d = valueDest(a); return d ? [[a.id, d] as const] : []; }));
  const p = previewRaw;
  const snap = p?.snapshot ?? null;
  const isFinal = snap?.status === "FINAL";
  const ended = end < today;
  const blocked = checks.filter((c) => c.status === "BLOCKED");
  const warnings = checks.reduce((s, c) => s + c.issues.filter((i) => i.severity === "REVIEW").length, 0);
  const canClose = me.role === "ADMIN" || me.role === "EDITOR";
  // เหตุที่ยังปิดเดือนไม่ได้ (แสดงใน pop up ของปุ่มปิดเดือน) · ฐานข้อมูลตรวจซ้ำตอนปิดเสมอ
  const closeBlockers = [
    ...(loadFailed ? ["โหลดข้อมูลตรวจความพร้อมไม่สำเร็จ — ลองรีเฟรชหน้า"] : []),
    ...(!ended ? [`ยังไม่สิ้นเดือน — ปิดเดือน ${thMonth(start)} ได้ตั้งแต่ ${thDate(addDays(end, 1))}`] : []),
    ...blocked.flatMap((c) => c.issues.filter((i) => i.code !== "MONTH_NOT_ENDED" && i.severity === "BLOCKED")
      .map((i) => `${CAT[c.category] ?? c.category}: ${i.message}`)),
    ...blocked.filter((c) => !c.issues.some((i) => i.severity === "BLOCKED")).map((c) => `${CAT[c.category] ?? c.category} เป็น BLOCKED`),
  ];
  const reconBy = new Map((recons ?? []).map((r) => [r.bank_asset_id, r]));
  // บัญชีที่มียอดแล้ว ณ สิ้นเดือน: ยอดล่าสุด (≤ สิ้นเดือน) วันไหน · อัปเดตยอดสิ้นเดือนแล้วหรือยัง
  const bankRows = (banks ?? []).map((b) => ({ ...b, last: lastAt.get(b.asset_id) ?? null })).filter((b) => b.last || reconBy.has(b.asset_id));

  const asOf = end < today ? end : today;
  const sum = (rows: Flow[], key: string, id: string, date: string, after: string, minus?: string) =>
    rows.filter((x) => x[key] === id && String(x[date]) > after).reduce((t, x) => t + Number(x.amount) - Number((minus && x[minus]) ?? 0), 0);
  const cardRows = cards.map((c) => {
    const st = stmts.find((x) => x.credit_card_id === c.id);
    if (!st) return null;
    const sd = String(st.statement_date);
    const spend = sum(cExp, "paid_from_credit_card_id", c.id, "date", sd) + sum(cBuy, "from_credit_card_id", c.id, "movement_date", sd);
    const paid = sum(cPay, "to_credit_card_id", c.id, "movement_date", sd);
    const back = sum(cRe, "received_to_credit_card_id", c.id, "received_date", sd) + sum(cInc, "received_to_credit_card_id", c.id, "date", sd, "tax");
    return { id: c.id, name: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" "),
      currency: c.currency, stDate: sd, stBal: Number(st.balance), spend, paid, back,
      total: Math.max(Number(st.balance) + spend - paid - back, 0), exact: sd >= asOf };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  const cardTotal = cardRows.reduce((t, c) => t + (c.currency === "THB" ? c.total : 0), 0);
  const cardOther = cardRows.some((c) => c.currency !== "THB");
  const ready = checks.filter((c) => c.status === "READY").length;
  const banksDone = bankRows.filter((b) => b.last === end || reconBy.has(b.asset_id)).length;
  const history = (finals ?? []).slice(0, 12);
  const latest = finals?.[0];
  const elsewhere = ym !== defaultYm;          // เปิดดูเดือนอื่น (จากตารางเดือนที่ปิดแล้ว)
  const status = isFinal ? "final" : loadFailed ? "error" : !ended ? "open" : blocked.length ? "blocked" : "ready";
  const TONE = { final: "border-emerald-200 bg-emerald-50 text-emerald-900", error: "border-red-200 bg-red-50 text-red-800",
    open: "border-slate-200 bg-white text-slate-700", blocked: "border-red-200 bg-red-50 text-red-800", ready: "border-emerald-200 bg-emerald-50 text-emerald-900" };
  // ปิดครบทุกเดือนที่สิ้นเดือนแล้ว (เดือนที่ต้องปิดถัดไปยังไม่สิ้นเดือน) → สีเขียว (ตกลง 5 พ.ย. 2026)
  const allClosed = status === "open" && !elsewhere && !!latest;
  const tone = allClosed ? TONE.ready : TONE[status];
  const cardTable = cardRows.length > 0 && (
    <div className="mt-3 rounded-lg border border-slate-200">
      <p className="px-3 pt-2 text-xs text-slate-500">
        บัตรเครดิต ณ {ended ? `สิ้นเดือน ${thDate(end)}` : `วันนี้ ${thDate(today)}`} · ยอด Statement ล่าสุด + รูดหลังวันตัดรอบ − จ่ายบัตร − เงินคืน = ยอดที่ใช้คิดความมั่งคั่งสุทธิ ·
        ถ้าต้องการยอดจริงสิ้นเดือน ใส่ยอดจากแอปธนาคารที่หน้าบัตร (ส่วนต่างรวมเข้าก้อนรอแยกของเดือนนี้)
      </p>
      <div className="overflow-x-auto px-3 pb-1">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">บัตร</th><th className="px-2 text-right">ยอดตามยอดล่าสุด</th>
              <th className="px-2 text-right">+ รูดหลังจากนั้น</th><th className="px-2 text-right">− จ่าย / เงินคืน</th><th className="px-2 text-right">= ยอดสิ้นเดือน</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cardRows.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="py-2 pr-2"><Link href={`/liabilities/cards/${c.id}`} className="hover:underline">{c.name}</Link></td>
                <td className="px-2 py-2 text-right tabular-nums">{money(c.stBal, c.currency)}<div className="text-xs text-slate-500">{thDate(c.stDate)}</div></td>
                <td className="px-2 py-2 text-right tabular-nums text-red-700">{c.spend ? plusMoney(c.spend, c.currency) : "–"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{c.paid + c.back ? minusMoney(c.paid + c.back, c.currency) : "–"}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">{money(c.total, c.currency)}</td>
                <td className="py-2 pl-2 text-xs">{c.exact
                  ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">ตามยอดที่บันทึก</span>
                  : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">ประมาณ · ยังไม่มี Statement</span>}</td>
              </tr>
            ))}
          </tbody>
          {cardRows.length > 1 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td className="py-2 pr-2">รวม{cardOther ? " (เฉพาะบัตรสกุลบาท)" : ""}</td><td colSpan={3}></td>
                <td className="px-2 py-2 text-right tabular-nums">{money(cardTotal, "THB")}</td><td></td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
  const hasLiab = checks.some((c) => c.category === "LIABILITIES");

  return (
    <div className="space-y-4">
      <PageInfo>ตรวจความพร้อม → อัปเดตยอดคงเหลือ → ปิดเดือน (ระดับครอบครัว)</PageInfo>

      {/* ---------------------------------------------------------- สถานะเดือนนี้ (บนสุด) */}
      <section id="month-status" className={`scroll-mt-20 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border px-5 py-3 text-sm ${tone}`}>
        <div className="min-w-[min(100%,18rem)] flex-1">
          <p>
            <b className="font-semibold">{thMonth(start)}</b>
            {" · "}
            {status === "final" ? <>ปิดแล้ว · FINAL เวอร์ชัน {snap?.version} · ปิดเมื่อ {snap?.finalized_at ? new Date(snap.finalized_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}</>
              : status === "error" ? "โหลดข้อมูลตรวจความพร้อมไม่สำเร็จ — ลองรีเฟรชหน้า"
              : allClosed ? <>ปิดครบถึง {thMonth(latest!.snapshot_month)} แล้ว · {thMonth(start)} ปิดได้ตั้งแต่ {thDate(addDays(end, 1))}</>
              : status === "open" ? <>ยังไม่สิ้นเดือน · ปิดเดือนได้ตั้งแต่ {thDate(addDays(end, 1))} · ตัวเลขด้านล่างเป็นยอด ณ วันนี้</>
              : status === "blocked" ? <>ยังปิดไม่ได้: {blocked.map((c) => CAT[c.category] ?? c.category).join(" · ")} เป็น BLOCKED (ดู Checklist)</>
              : !canClose ? "พร้อมปิดเดือน · ผู้ดูแลระบบ / ผู้แก้ไข เป็นผู้ปิดเดือน"
              : <>พร้อมปิดเดือน{warnings > 0 ? ` · มีคำเตือน ${warnings} รายการ (ปิดได้)` : ""}</>}
          </p>
          {isFinal && snap?.closing_warnings && snap.closing_warnings.length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer">คำเตือนที่ปิดผ่าน {snap.closing_warnings.length} หมวด</summary>
              <ul className="mt-1 space-y-0.5">
                {snap.closing_warnings.flatMap((w) => w.issues.filter(notTracking).map((i, k) => <li key={`${w.category}-${k}`}>• {i.message}</li>))}
              </ul>
            </details>
          )}
        </div>
        {elsewhere && (
          <Link href="/settings/month-closing" scroll={false} className="text-sm font-medium underline">
            ← กลับไปเดือนที่ต้องปิด ({thMonth(`${defaultYm}-01`)})</Link>
        )}
        {/* ปุ่มปิดเดือน ขวาสุดของบรรทัดสถานะ (ขึ้นเสมอ · ถ้ายังปิดไม่ได้ กดแล้วบอกเหตุผล ไม่มีปุ่มยืนยัน · ตกลง 5 พ.ย. 2026)
            ปุ่มอัปเดตยอด → ใช้ลิงก์ "ไปแก้" ในแถว Bank Accounts ของ Checklist · ยกเลิกการปิดเดือน → กล่องเดือนที่ปิดแล้ว */}
        {!isFinal && canClose && (
          <ActionBar className="shrink-0">
            <FinalizeForm month={start} warnings={warnings} label={`ปิดเดือน ${thMonth(start)}`} blockers={closeBlockers}
              summary={<>จะบันทึกความมั่งคั่งสุทธิ <b>{money(p?.net_worth, "THB", 0)}</b> ณ {thDate(p?.as_of)}
                {warnings > 0 && <span className="text-amber-700"> · มีคำเตือน {warnings} รายการ (ปิดได้)</span>}</>} />
          </ActionBar>
        )}
      </section>

      {/* ---------------------------------------------------------- สรุป */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            ความมั่งคั่งสุทธิ {p?.confirmed ? `ณ ${thDate(p?.as_of)}` : "ณ วันนี้ (ประมาณการ)"}
            {isFinal
              ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">FINAL v{snap?.version}</span>
              : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{ended ? "DRAFT" : "ยังไม่สิ้นเดือน"}</span>}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(isFinal ? snap?.net_worth : p?.net_worth, "THB", 0)}</div>
          <div className="mt-1 text-xs text-slate-500">สินทรัพย์ {money(p?.total_assets, undefined, 0)} · หนี้สิน {money(p?.total_liabilities, undefined, 0)}</div>
          {isFinal && snap && Number(snap.net_worth) !== Number(p?.net_worth) && (
            <div className="mt-1 text-xs text-amber-700">ยอดจากข้อมูลล่าสุด {money(p?.net_worth, undefined, 0)} ต่างจาก Snapshot ที่ปิดไว้</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">ความพร้อม (Checklist)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{ready} <span className="text-sm font-normal text-slate-500">/ {checks.length} หมวด</span></div>
          <div className={`mt-1 text-xs ${blocked.length ? "text-red-700" : warnings ? "text-amber-700" : "text-emerald-700"}`}>
            {blocked.length ? `BLOCKED ${blocked.length} หมวด` : warnings ? `คำเตือน ${warnings} รายการ (ปิดได้)` : "พร้อมปิดเดือน"}</div>
        </div>
        <StatBox label="บัญชีธนาคารอัปเดตยอดสิ้นเดือน" value={banksDone} unit={<>/ {bankRows.length} บัญชี</>} sub="ไม่อัปเดต = ใช้ยอดตามระบบ" />
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ตามหมวดสินทรัพย์</div>
          <dl className="mt-1 space-y-0.5 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">การเงิน + ลงทุน</dt><dd className="tabular-nums">{money(Number(p?.financial ?? 0) + Number(p?.investment ?? 0), undefined, 0)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">อสังหาฯ + สินทรัพย์อื่น</dt><dd className="tabular-nums">{money(Number(p?.property ?? 0) + Number(p?.alternative ?? 0), undefined, 0)}</dd></div>
            {p && p.carried_forward_items > 0 && <div className="text-slate-500">ใช้ยอดเดิม (Carry Forward) {p.carried_forward_items} รายการ</div>}
          </dl>
        </div>
      </section>

      {/* ---------------------------------------------------------- Checklist (บัตรเครดิต ณ สิ้นเดือน อยู่ในแถว Liabilities) */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-3 font-medium text-slate-900">Checklist</h2>
        <ul className="divide-y divide-slate-100">
          {checks.map((c) => {
            const withCards = c.category === "LIABILITIES" && cardRows.length > 0;
            return (
              <li key={c.category} className="px-5 py-3">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{CAT[c.category] ?? c.category}</span>
                      {withCards && <span className="text-xs text-slate-500"> · บัตร {cardRows.length} ใบ{cardOther ? "" : ` · ยอดสิ้นเดือน ${money(cardTotal, "THB")}`}
                        {cardRows.some((x) => !x.exact) && ` · ประมาณ ${cardRows.filter((x) => !x.exact).length} ใบ`}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      {c.issue_count > 0 && <span className="text-slate-500">{c.issue_count} รายการ</span>}
                      <span className={`rounded px-2 py-0.5 ${PILL[c.status]}`}>{c.status}</span>
                    </span>
                  </summary>
                  {c.issues.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {checkLines(c.issues, ym, end, dest).map((l, k) => (
                        <li key={k} className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className={l.blocked ? "text-red-700" : "text-slate-700"}>• {l.text}</span>
                          {l.href && <Link href={l.href} className="text-xs text-slate-800 underline">ไปแก้</Link>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {withCards && cardTable}
                </details>
              </li>
            );
          })}
        </ul>
        {!hasLiab && cardTable && <div className="px-5 pb-4">{cardTable}</div>}
      </section>

      {/* ---------------------------------------------------------- เดือนที่ปิดแล้ว (+ ยกเลิกการปิดเดือนล่าสุด · ADMIN) */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="font-medium text-slate-900">เดือนที่ปิดแล้ว</h2>
            <p className="text-xs text-slate-500">กดชื่อเดือนเพื่อดูรายละเอียดตอนปิด · รายงาน PDF ประจำเดือนจะเพิ่มเมื่อเชื่อม Google Drive</p>
          </div>
          {me.role === "ADMIN" && latest && (
            <ReopenForm month={latest.snapshot_month} label={`ยกเลิกการปิดเดือน ${thMonth(latest.snapshot_month)}`} />
          )}
        </div>
        {history.length > 0 && (
          <table className="mt-3 w-full min-w-[36rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-5 py-2">เดือน</th><th className="px-3 text-right">สินทรัพย์</th><th className="px-3 text-right">หนี้สิน</th>
                <th className="px-3 text-right">ความมั่งคั่งสุทธิ</th><th className="px-3 text-right">เปลี่ยนจากเดือนก่อน</th><th className="px-3">เวอร์ชัน</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h, i) => {
                const before = (finals ?? [])[i + 1];
                const d = before ? Number(h.net_worth) - Number(before.net_worth) : null;
                return (
                  <tr key={h.snapshot_month} className={h.snapshot_month.slice(0, 7) === ym ? "bg-blue-50/60" : ""}>
                    <td className="whitespace-nowrap px-5 py-2">{/* กดแล้วเลื่อนขึ้นไปกล่องสถานะของเดือนนั้น (#month-status) · เดิมอยู่ที่เดิม → ดูเหมือนกดแล้วไม่มีอะไรเกิดขึ้น */}
                      <Link href={`/settings/month-closing?m=${h.snapshot_month.slice(0, 7)}#month-status`} className="text-blue-700 hover:underline">{thMonth(h.snapshot_month)}</Link></td>
                    <td className="px-3 text-right tabular-nums">{money(h.total_assets, undefined, 0)}</td>
                    <td className="px-3 text-right tabular-nums">{money(h.total_liabilities, undefined, 0)}</td>
                    <td className="px-3 text-right font-medium tabular-nums">{money(h.net_worth, undefined, 0)}</td>
                    <td className={`px-3 text-right tabular-nums ${d == null ? "text-slate-400" : d >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {d == null ? "-" : signedMoney(d, undefined, 0)}</td>
                    <td className="px-3 text-xs text-slate-500">v{h.version}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {history.length === 0 && <p className="px-5 pb-4 pt-2 text-sm text-slate-500">ยังไม่มีเดือนที่ปิดแล้ว</p>}
        {history.length > 0 && <div className="h-2" />}
      </section>
    </div>
  );
}
