import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import { FinalizeForm, ReopenForm } from "./forms";
import { ActionBar } from "@/components/ActionBar";
import { StatBox } from "@/components/Boxes";

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
  CASH: "Cash & Bank Accounts (อัปเดตยอดคงเหลือ)", INVESTMENTS: "Investments", PROPERTY_OTHER: "Property / สินทรัพย์อื่น",
  LIABILITIES: "Liabilities / บัตรเครดิต", INCOME_EXPENSES: "Income & Expenses", OWNERSHIP: "สัดส่วนเจ้าของ", FX_SYSTEM: "FX & ระบบ",
};
const PILL: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700", REVIEW: "bg-amber-50 text-amber-800", BLOCKED: "bg-red-50 text-red-700",
};

function fixLink(i: Issue, ym: string): string | null {
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
  if (i.code === "NOT_LIVE") return "/settings/system?tab=opening";
  if (i.code === "NEGATIVE_BALANCE" && i.entity_id) return `/financial/cash/${i.entity_id}?m=${ym}`;
  if (i.code === "BALANCE_NOT_UPDATED" || i.code?.startsWith("RECON")) return "#cash-update";
  if (i.code === "IN_TRANSIT" && i.entity_id) return `/investments/${i.entity_id}`;
  if (i.entity_type === "ASSET" && i.entity_id) return `/a/${i.entity_id}`;
  if (i.entity_type === "LIABILITY" && i.entity_id) return `/liabilities/${i.entity_id}`;
  return null;
}

export default async function MonthClosingPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const [{ data: family }, { data: finals }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("net_worth_snapshots").select("snapshot_month,status,version,net_worth,total_assets,total_liabilities,finalized_at").is("deleted_at", null)
      .eq("status", "FINAL").order("snapshot_month", { ascending: false }),
  ]);
  const goMonth = (family?.go_live_date ?? today).slice(0, 7);
  const lastFinal = finals?.[0]?.snapshot_month?.slice(0, 7);
  const defaultYm = lastFinal ? monthRange(lastFinal).next : goMonth;
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : defaultYm;
  const { start, end, prev, next } = monthRange(ym);

  const [{ data: checksRaw, error: checkErr }, { data: previewRaw, error: prevErr }, { data: banks }, { data: recons }, { data: balAt }] = await Promise.all([
    supabase.rpc("month_closing_checks", { p_month: start }),
    supabase.rpc("month_net_worth_preview", { p_month: start }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("bank_reconciliations").select("bank_asset_id,status").eq("year_month", start).is("deleted_at", null).neq("status", "OPEN"),
    supabase.rpc("bank_balances_at", { p_date: end < today ? end : today }),
  ]);
  const lastAt = new Map(((balAt as { asset_id: string; last_date: string | null }[] | null) ?? []).map((r) => [r.asset_id, r.last_date]));
  // "ค่าใช้จ่ายบันทึกครบ / ไม่ครบ" ไม่ใช้แล้ว (เงินคงเหลือสุทธิคิดจากรายการที่บันทึกเสมอ) → ไม่แสดงเป็นข้อให้ตรวจ
  const notTracking = (i: Issue) => !i.code.startsWith("EXPENSE_");
  const checks = ((checksRaw as Check[] | null) ?? []).map((c) => {
    const issues = c.issues.filter(notTracking);
    return { ...c, issues, issue_count: issues.length, status: c.status === "REVIEW" && !issues.some((i) => i.severity === "REVIEW") ? "READY" : c.status };
  });
  const p = previewRaw as Preview | null;
  const snap = p?.snapshot ?? null;
  const isFinal = snap?.status === "FINAL";
  const ended = end < today;
  const blocked = checks.filter((c) => c.status === "BLOCKED");
  const warnings = checks.reduce((s, c) => s + c.issues.filter((i) => i.severity === "REVIEW").length, 0);
  const canClose = me.role === "ADMIN" || me.role === "EDITOR";
  const canWrite = me.role !== "VIEWER";
  const reconBy = new Map((recons ?? []).map((r) => [r.bank_asset_id, r]));
  const isLatestFinal = isFinal && lastFinal === ym;
  // บัญชีที่มียอดแล้ว ณ สิ้นเดือน: ยอดล่าสุด (≤ สิ้นเดือน) วันไหน · อัปเดตยอดสิ้นเดือนแล้วหรือยัง
  const bankRows = (banks ?? []).map((b) => ({ ...b, last: lastAt.get(b.asset_id) ?? null })).filter((b) => b.last || reconBy.has(b.asset_id));

  // บัตรเครดิต ณ สิ้นเดือน = ยอด Statement ล่าสุด (≤ สิ้นเดือน) + รูดหลังวันนั้น − จ่ายบัตร − เงินคืน / รายได้เข้าบัตร
  const asOf = end < today ? end : today;
  const { data: cardsRaw } = await supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency,status")
    .is("deleted_at", null).eq("status", "ACTIVE").order("issuer");
  const cardIds = (cardsRaw ?? []).map((c) => c.id as string);
  const [{ data: stmts }, { data: cExp }, { data: cPay }, { data: cRe }, { data: cInc }] = cardIds.length ? await Promise.all([
    supabase.from("credit_card_statements").select("credit_card_id,statement_date,balance").in("credit_card_id", cardIds)
      .is("deleted_at", null).lte("statement_date", asOf).order("statement_date", { ascending: false }),
    supabase.from("expense_items").select("paid_from_credit_card_id,date,amount").in("paid_from_credit_card_id", cardIds)
      .is("deleted_at", null).lte("date", asOf),
    supabase.from("cash_movements").select("to_credit_card_id,movement_date,amount").eq("movement_type", "CARD_PAYMENT")
      .in("to_credit_card_id", cardIds).is("deleted_at", null).lte("movement_date", asOf),
    supabase.from("expense_reimbursements").select("received_to_credit_card_id,received_date,amount").in("received_to_credit_card_id", cardIds)
      .is("deleted_at", null).lte("received_date", asOf),
    supabase.from("income_transactions").select("received_to_credit_card_id,date,amount,tax").in("received_to_credit_card_id", cardIds)
      .is("deleted_at", null).lte("date", asOf),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const cardRows = (cardsRaw ?? []).map((c) => {
    const st = (stmts ?? []).find((x) => x.credit_card_id === c.id);
    if (!st) return null;
    const after = (d: string) => d > st.statement_date;
    const spend = (cExp ?? []).filter((x) => x.paid_from_credit_card_id === c.id && after(x.date)).reduce((t, x) => t + Number(x.amount), 0);
    const paid = (cPay ?? []).filter((x) => x.to_credit_card_id === c.id && after(x.movement_date)).reduce((t, x) => t + Number(x.amount), 0);
    const back = (cRe ?? []).filter((x) => x.received_to_credit_card_id === c.id && after(x.received_date)).reduce((t, x) => t + Number(x.amount), 0)
      + (cInc ?? []).filter((x) => x.received_to_credit_card_id === c.id && after(x.date)).reduce((t, x) => t + Number(x.amount) - Number(x.tax ?? 0), 0);
    return { id: c.id as string, name: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" "),
      currency: c.currency as string, stDate: st.statement_date as string, stBal: Number(st.balance), spend, paid, back,
      total: Math.max(Number(st.balance) + spend - paid - back, 0), exact: st.statement_date >= asOf };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  const cardTotal = cardRows.reduce((t, c) => t + (c.currency === "THB" ? c.total : 0), 0);
  const cardOther = cardRows.some((c) => c.currency !== "THB");
  const ready = checks.filter((c) => c.status === "READY").length;
  const banksDone = bankRows.filter((b) => b.last === end || reconBy.has(b.asset_id)).length;
  const sumPerson = (k: "assets" | "liabilities" | "net_worth") => (p?.by_person ?? []).reduce((t, x) => t + Number(x[k] ?? 0), 0);
  const history = (finals ?? []).slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Month Closing</h1>
          <p className="text-sm text-slate-500">ตรวจความพร้อม → อัปเดตยอดคงเหลือ → ปิดเดือน (ระดับครอบครัว)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/month-closing?m=${prev}`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" aria-label="เดือนก่อน">←</Link>
            <span className="min-w-28 text-center font-medium">{thMonth(start)}</span>
            <Link href={`/month-closing?m=${next}`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" aria-label="เดือนถัดไป">→</Link>
          </div>
          {canWrite && !isFinal && (
            <Link href={`/financial/cash?tab=update&d=${ended ? end : today}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">อัปเดตยอดคงเหลือ</Link>
          )}
          {!isFinal && canClose && blocked.length === 0 && (
            <ActionBar>
              <FinalizeForm month={start} warnings={warnings} label={`ปิดเดือน ${thMonth(start)}`}
                summary={<>จะบันทึก Net Worth <b>{money(p?.net_worth, "THB", 0)}</b> ณ {thDate(p?.as_of)}
                  {warnings > 0 && <span className="text-amber-700"> · มีคำเตือน {warnings} รายการ (ปิดได้)</span>}
                  {!ended && <span className="block text-xs text-amber-700">เดือนนี้ยังไม่สิ้นเดือน — ยอดเป็นยอด ณ วันนี้</span>}</>} />
            </ActionBar>
          )}
          {isFinal && me.role === "ADMIN" && isLatestFinal && <ActionBar><ReopenForm month={start} /></ActionBar>}
        </div>
      </div>

      {(checkErr || prevErr) && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {checkErr?.message ?? prevErr?.message}</p>}

      {/* ---------------------------------------------------------- สรุป */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Net Worth {p?.confirmed ? `ณ ${thDate(p?.as_of)}` : "ณ วันนี้ (ประมาณการ)"}
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

      {/* ---------------------------------------------------------- Checklist */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-3 font-medium text-slate-900">Checklist</h2>
        <ul className="divide-y divide-slate-100">
          {checks.map((c) => (
            <li key={c.category} className="px-5 py-3">
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="text-sm font-medium">{CAT[c.category] ?? c.category}</span>
                  <span className="flex items-center gap-2 text-xs">
                    {c.issue_count > 0 && <span className="text-slate-500">{c.issue_count} รายการ</span>}
                    <span className={`rounded px-2 py-0.5 ${PILL[c.status]}`}>{c.status}</span>
                  </span>
                </summary>
                {c.issues.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.issues.map((i, k) => {
                      const href = fixLink(i, ym);
                      return (
                        <li key={k} className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className={i.severity === "BLOCKED" ? "text-red-700" : "text-slate-700"}>• {i.message}</span>
                          {href && <Link href={href} className="text-xs text-slate-800 underline">ไปแก้</Link>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------- อัปเดตยอดคงเหลือ (บัญชีธนาคาร) */}
      <section id="cash-update" className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">อัปเดตยอดคงเหลือบัญชีธนาคาร {thMonth(start)}</h2>
            <p className="text-xs text-slate-500">
              กรอกยอดจริงสิ้นเดือนจากแอปธนาคาร หลายบัญชีพร้อมกันที่หน้า Cash &amp; Bank Accounts · ส่วนต่างลงก้อน &ldquo;รอแยกรายละเอียด&rdquo; อัตโนมัติ ·
              ไม่ได้อัปเดต = ปิดงวดได้ โดยใช้ยอดตามระบบ (ยอดล่าสุด + เงินเข้า − เงินออก)
            </p>
          </div>
          <span className="text-sm text-slate-500">อัปเดตแล้ว <span className="font-medium text-slate-900">{banksDone} / {bankRows.length}</span></span>
        </div>
        {bankRows.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {bankRows.map((b) => (
              <li key={b.asset_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <Link href={`/financial/cash/${b.asset_id}`} className="hover:underline">{b.name} <span className="text-xs text-slate-500">{b.currency}</span></Link>
                {b.last === end || reconBy.has(b.asset_id)
                  ? <span className="text-xs text-emerald-700">อัปเดตยอดสิ้นเดือนแล้ว ✓</span>
                  : <span className="text-xs text-amber-700">ยังไม่ได้อัปเดตยอดสิ้นเดือน · ใช้ยอดตามระบบ (ล่าสุด {thDate(b.last)})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------- บัตรเครดิต ณ สิ้นเดือน */}
      {cardRows.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">บัตรเครดิต ณ {end < today ? `สิ้นเดือน ${thDate(end)}` : `วันนี้ ${thDate(today)}`}</h2>
          <p className="mb-3 text-xs text-slate-500">
            ยอด Statement ล่าสุด + รูดหลังวันตัดรอบ − จ่ายบัตร − เงินคืน = ยอดที่ใช้คิด Net Worth ·
            ถ้าต้องการยอดจริงสิ้นเดือน ใส่ยอดจากแอปธนาคารที่หน้าบัตร (ส่วนต่างรวมเข้าก้อนรอแยกของเดือนนี้)
          </p>
          <div className="overflow-x-auto">
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
                    <td className="px-2 py-2 text-right tabular-nums text-red-700">{c.spend ? `+${money(c.spend, c.currency)}` : "–"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{c.paid + c.back ? `−${money(c.paid + c.back, c.currency)}` : "–"}</td>
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
        </section>
      )}

      {/* ---------------------------------------------------------- Bridge + รายบุคคล */}
      {p && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 font-medium text-slate-900">ความมั่งคั่งเปลี่ยนเพราะอะไร</h2>
            {p.prev_net_worth == null ? (
              <p className="text-sm text-slate-500">ยังไม่มียอดงวดก่อนให้เทียบ (ต้องปิดเดือนก่อนหน้าก่อน)</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  <Row label={`${p.prev_label} (${thDate(p.prev_date)})`} v={p.prev_net_worth} bold />
                  <Row label="+ รายได้ (หลังภาษี · ไม่รวมรายได้ลงทุน)" v={p.income} />
                  <Row label="− ค่าใช้จ่ายสุทธิ (หักเงินคืน)" v={-(p.expenses - p.reimbursements)} />
                  <Row label="+ รายได้จากการลงทุน" v={p.investment_income} />
                  <Row label="± มูลค่าเปลี่ยน (ราคา · FX · ประเมินใหม่ · ยอดหนี้ · รายการที่ไม่ได้บันทึก)" v={p.other_change ?? 0} />
                  <Row label={`= ยอด ${p.confirmed ? "สิ้นเดือน" : "ณ วันนี้"}`} v={p.net_worth} bold />
                </tbody>
              </table>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 font-medium text-slate-900">รายบุคคล</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">สมาชิก</th><th className="text-right">สินทรัพย์</th><th className="text-right">หนี้สิน</th><th className="text-right">สุทธิ</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {p.by_person.map((x) => (
                  <tr key={x.person_id ?? "un"} className={x.person_id ? "" : "text-amber-700"}>
                    <td className="py-1.5">{x.name}</td>
                    <td className="text-right tabular-nums">{money(x.assets, undefined, 0)}</td>
                    <td className="text-right tabular-nums">{money(x.liabilities, undefined, 0)}</td>
                    <td className="text-right tabular-nums font-medium">{money(x.net_worth, undefined, 0)}</td>
                  </tr>
                ))}
              </tbody>
              {p.by_person.length > 1 && (
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                  <tr><td className="py-1.5">รวม</td><td className="text-right tabular-nums">{money(sumPerson("assets"), undefined, 0)}</td>
                    <td className="text-right tabular-nums">{money(sumPerson("liabilities"), undefined, 0)}</td>
                    <td className="text-right tabular-nums">{money(sumPerson("net_worth"), undefined, 0)}</td></tr>
                </tfoot>
              )}
            </table>
            {p.fx.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                FX ที่ใช้: {p.fx.map((f) => `${f.currency} ${f.rate ? Number(f.rate).toFixed(4) : "ไม่มี"}${f.rate_date ? ` (${thDate(f.rate_date)})` : ""}`).join(" · ")}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- สถานะการปิดเดือน + ประวัติ */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="px-5 pt-4">
          <h2 className="font-medium text-slate-900">การปิดเดือน</h2>
          <div className="mt-1 text-sm">
            {isFinal ? (
              <>
                <p>{thMonth(start)} ปิดแล้ว · FINAL เวอร์ชัน {snap?.version} · ปิดเมื่อ {snap?.finalized_at ? new Date(snap.finalized_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}</p>
                {snap?.closing_warnings && snap.closing_warnings.length > 0 && (
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer">คำเตือนที่ปิดผ่าน {snap.closing_warnings.length} หมวด</summary>
                    <ul className="mt-1 space-y-0.5">
                      {snap.closing_warnings.flatMap((w) => w.issues.filter(notTracking).map((i, k) => <li key={`${w.category}-${k}`}>• {i.message}</li>))}
                    </ul>
                  </details>
                )}
                {me.role === "ADMIN" && !isLatestFinal && <p className="text-xs text-slate-500">Reopen ได้เฉพาะเดือนที่ปิดล่าสุด</p>}
              </>
            ) : !canClose ? (
              <p className="text-slate-500">ผู้ดูแลระบบ / ผู้แก้ไข เป็นผู้ปิดเดือน</p>
            ) : blocked.length > 0 ? (
              <p className="text-red-700">ยังปิดไม่ได้: {blocked.map((c) => CAT[c.category] ?? c.category).join(" · ")} เป็น BLOCKED</p>
            ) : (
              <p className="text-slate-600">พร้อมปิดเดือน — กดปุ่ม &ldquo;ปิดเดือน {thMonth(start)}&rdquo; มุมขวาบน</p>
            )}
            <p className="mt-1 text-xs text-slate-500">รายงาน PDF ประจำเดือนจะเพิ่มเมื่อเชื่อม Google Drive</p>
          </div>
        </div>
        {history.length > 0 && (
          <table className="mt-3 w-full min-w-[36rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-5 py-2">เดือนที่ปิดแล้ว</th><th className="px-3 text-right">สินทรัพย์</th><th className="px-3 text-right">หนี้สิน</th>
                <th className="px-3 text-right">Net Worth</th><th className="px-3 text-right">เปลี่ยนจากเดือนก่อน</th><th className="px-3">เวอร์ชัน</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h, i) => {
                const before = (finals ?? [])[i + 1];
                const d = before ? Number(h.net_worth) - Number(before.net_worth) : null;
                return (
                  <tr key={h.snapshot_month} className={h.snapshot_month.slice(0, 7) === ym ? "bg-blue-50/60" : ""}>
                    <td className="px-5 py-2"><Link href={`/month-closing?m=${h.snapshot_month.slice(0, 7)}`} className="hover:underline">{thMonth(h.snapshot_month)}</Link></td>
                    <td className="px-3 text-right tabular-nums">{money(h.total_assets, undefined, 0)}</td>
                    <td className="px-3 text-right tabular-nums">{money(h.total_liabilities, undefined, 0)}</td>
                    <td className="px-3 text-right font-medium tabular-nums">{money(h.net_worth, undefined, 0)}</td>
                    <td className={`px-3 text-right tabular-nums ${d == null ? "text-slate-400" : d >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {d == null ? "-" : `${d >= 0 ? "+" : ""}${money(d, undefined, 0)}`}</td>
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

function Row({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <tr className={bold ? "font-medium" : ""}>
      <td className="py-1.5 pr-3">{label}</td>
      <td className={`text-right tabular-nums ${!bold && v < 0 ? "text-red-700" : !bold && v > 0 ? "text-emerald-700" : ""}`}>{money(v, undefined, 0)}</td>
    </tr>
  );
}
