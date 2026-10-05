import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import { ConfirmReconForm, FinalizeForm, PrepareButton, ReopenForm } from "./forms";

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
  CASH: "Cash & Deposits (กระทบยอดธนาคาร)", INVESTMENTS: "Investments", PROPERTY_OTHER: "Property / สินทรัพย์อื่น",
  LIABILITIES: "Liabilities / บัตรเครดิต", INCOME_EXPENSES: "Income & Expenses", OWNERSHIP: "สัดส่วนเจ้าของ", FX_SYSTEM: "FX & ระบบ",
};
const PILL: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700", REVIEW: "bg-amber-50 text-amber-800", BLOCKED: "bg-red-50 text-red-700",
};
const RECON: Record<string, { text: string; cls: string }> = {
  OPEN: { text: "ยังไม่ยืนยัน", cls: "text-amber-700" }, RECONCILED: { text: "ตรงกัน ✓", cls: "text-emerald-700" },
  CONFIRMED_WITH_DIFFERENCE: { text: "ยืนยันพร้อมผลต่าง", cls: "text-amber-700" },
};

function fixLink(i: Issue, ym: string): string | null {
  switch (i.entity_type) {
    case "HOLDING": case "INVESTMENT_TX": return "/investments";
    case "PROPERTY_LEASE": return "/property";
    case "LIABILITY": return i.entity_id ? `/liabilities/${i.entity_id}` : "/liabilities";
    case "CREDIT_CARD": return "/family/cards";
    case "RECURRING": case "LEASE": return `/income-expenses?tab=income&m=${ym}`;
    case "MONTHLY_EXPENSE": return `/income-expenses?tab=expense&m=${ym}`;
    case "FX_RATE": return "/settings/system";
    case "CASH_MOVEMENT": case "EXPENSE": case "INCOME": return `/income-expenses?tab=overview&m=${ym}`;
  }
  if (i.code === "NOT_LIVE") return "/settings/opening";
  if (i.code?.startsWith("RECON")) return "#recon";
  if (i.code === "IN_TRANSIT" && i.entity_id) return `/investments/${i.entity_id}`;
  if (i.code === "VALUE_OLD" && i.entity_id) return `/property/${i.entity_id}`;
  return null;
}

export default async function MonthClosingPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const [{ data: family }, { data: finals }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("net_worth_snapshots").select("snapshot_month,status,version").is("deleted_at", null)
      .eq("status", "FINAL").order("snapshot_month", { ascending: false }),
  ]);
  const goMonth = (family?.go_live_date ?? today).slice(0, 7);
  const lastFinal = finals?.[0]?.snapshot_month?.slice(0, 7);
  const defaultYm = lastFinal ? monthRange(lastFinal).next : goMonth;
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : defaultYm;
  const { start, end, prev, next } = monthRange(ym);

  const [{ data: checksRaw, error: checkErr }, { data: previewRaw, error: prevErr }, { data: banks }, { data: recons }] = await Promise.all([
    supabase.rpc("month_closing_checks", { p_month: start }),
    supabase.rpc("month_net_worth_preview", { p_month: start }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,confirmed_date").eq("status", "ACTIVE").order("name"),
    supabase.from("bank_reconciliations").select("*").eq("year_month", start).is("deleted_at", null),
  ]);
  const checks = (checksRaw as Check[] | null) ?? [];
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
  const bankRows = (banks ?? []).filter((b) => b.confirmed_date && b.confirmed_date <= end || reconBy.has(b.asset_id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Month Closing</h1>
          <p className="text-sm text-slate-500">ตรวจความพร้อม → กระทบยอดธนาคาร → ปิดเดือน (ระดับครอบครัว)</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/month-closing?m=${prev}`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">←</Link>
          <span className="min-w-28 text-center font-medium">{thMonth(start)}</span>
          <Link href={`/month-closing?m=${next}`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">→</Link>
        </div>
      </div>

      {(checkErr || prevErr) && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {checkErr?.message ?? prevErr?.message}</p>}

      {/* ---------------------------------------------------------- สรุป */}
      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            Net Worth {p?.confirmed ? `ณ สิ้นเดือน ${thDate(p?.as_of)}` : `ณ วันนี้ (เดือนยังไม่จบ · ยอดประมาณการ)`}
            {isFinal
              ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">FINAL v{snap?.version}</span>
              : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{ended ? "DRAFT" : "ยังไม่สิ้นเดือน"}</span>}
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{money(isFinal ? snap?.net_worth : p?.net_worth, "THB", 0)}</div>
          <div className="mt-1 text-xs text-slate-500">
            สินทรัพย์ {money(p?.total_assets, undefined, 0)} · หนี้สิน {money(p?.total_liabilities, undefined, 0)}
            {p && p.carried_forward_items > 0 && ` · ใช้ยอดเดิม (Carry Forward) ${p.carried_forward_items} รายการ`}
          </div>
          {isFinal && snap && Number(snap.net_worth) !== Number(p?.net_worth) && (
            <div className="mt-1 text-xs text-amber-700">ยอดปัจจุบันจากข้อมูลล่าสุด {money(p?.net_worth, undefined, 0)} ต่างจาก Snapshot ที่ปิดไว้</div>
          )}
        </div>
        <Mini label="การเงิน + ลงทุน" value={money(Number(p?.financial ?? 0) + Number(p?.investment ?? 0), undefined, 0)} />
        <Mini label="อสังหาฯ + สินทรัพย์อื่น" value={money(Number(p?.property ?? 0) + Number(p?.alternative ?? 0), undefined, 0)} />
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

      {/* ---------------------------------------------------------- กระทบยอดธนาคาร */}
      <section id="recon" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">กระทบยอดธนาคาร {thMonth(start)}</h2>
        <p className="mb-3 text-xs text-slate-500">
          ยอดต้นเดือน + เงินเข้า − เงินออก (ที่บันทึกไว้) = ยอดที่ควรเป็น · กรอกยอดจริงสิ้นเดือนจากแอปธนาคาร · ผลต่างไม่ถูกแปลงเป็นค่าใช้จ่ายเอง
        </p>
        {bankRows.length === 0 ? <p className="text-sm text-slate-500">ไม่มีบัญชีที่ต้องกระทบยอด</p> : (
          <div className="space-y-3">
            {bankRows.map((b) => {
              const r = reconBy.get(b.asset_id);
              return (
                <div key={b.asset_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/financial/cash/${b.asset_id}`} className="font-medium hover:underline">{b.name} <span className="text-xs text-slate-500">{b.currency}</span></Link>
                    {r ? <span className={`text-xs ${RECON[r.status]?.cls}`}>{RECON[r.status]?.text}</span>
                       : canWrite && !isFinal && <PrepareButton assetId={b.asset_id} month={start} label="เริ่มกระทบยอด" />}
                  </div>
                  {r && (
                    <>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-slate-600 md:grid-cols-5">
                        <span>ต้นเดือน {money(r.opening_balance)}</span>
                        <span className="text-emerald-700">เข้า +{money(r.known_inflows)}</span>
                        <span className="text-red-700">ออก −{money(r.known_outflows)}</span>
                        <span>ควรเป็น <b>{money(r.calculated_closing)}</b></span>
                        {r.actual_closing != null && <span>จริง <b>{money(r.actual_closing)}</b>{Number(r.difference) !== 0 && ` · ต่าง ${money(r.difference)}`}</span>}
                      </div>
                      {r.difference_reason && <div className="mt-1 text-xs text-amber-700">เหตุผล: {r.difference_reason}</div>}
                      {r.status === "OPEN" && !isFinal && (
                        <>
                          {canWrite && <div className="mt-1"><PrepareButton assetId={b.asset_id} month={start} label="คำนวณใหม่ (หลังเพิ่มรายการ)" /></div>}
                          <ConfirmReconForm id={r.id} calculated={Number(r.calculated_closing)} currency={b.currency} canConfirm={canClose && ended} />
                          <Link href={`/income-expenses?tab=expense&m=${ym}`} className="mt-1 inline-block text-xs text-slate-700 underline">+ เพิ่มรายการที่ขาด</Link>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
            </table>
            {p.fx.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                FX ที่ใช้: {p.fx.map((f) => `${f.currency} ${f.rate ? Number(f.rate).toFixed(4) : "ไม่มี"}${f.rate_date ? ` (${thDate(f.rate_date)})` : ""}`).join(" · ")}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- ปิดเดือน / Reopen */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-medium text-slate-900">{isFinal ? "ปิดเดือนแล้ว" : "ปิดเดือน"}</h2>
        {isFinal ? (
          <div className="space-y-3 text-sm">
            <p>FINAL เวอร์ชัน {snap?.version} · ปิดเมื่อ {snap?.finalized_at ? new Date(snap.finalized_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}</p>
            {snap?.closing_warnings && snap.closing_warnings.length > 0 && (
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">คำเตือนที่ปิดผ่าน {snap.closing_warnings.length} หมวด</summary>
                <ul className="mt-1 space-y-0.5">
                  {snap.closing_warnings.flatMap((w) => w.issues.map((i, k) => <li key={`${w.category}-${k}`}>• {i.message}</li>))}
                </ul>
              </details>
            )}
            <p className="text-xs text-slate-500">รายงาน PDF ประจำเดือนจะเพิ่มเมื่อเชื่อม Google Drive</p>
            {me.role === "ADMIN" && (isLatestFinal ? <ReopenForm month={start} /> : <p className="text-xs text-slate-500">Reopen ได้เฉพาะเดือนที่ปิดล่าสุด</p>)}
          </div>
        ) : !canClose ? (
          <p className="text-sm text-slate-500">ผู้ดูแลระบบ / ผู้แก้ไข เป็นผู้ปิดเดือน</p>
        ) : blocked.length > 0 ? (
          <p className="text-sm text-red-700">ยังปิดไม่ได้: {blocked.map((c) => CAT[c.category] ?? c.category).join(" · ")} เป็น BLOCKED</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              จะบันทึก Net Worth <b>{money(p?.net_worth, "THB", 0)}</b> ณ {thDate(p?.as_of)}
              {warnings > 0 && <span className="text-amber-700"> · มีคำเตือน {warnings} รายการ (ปิดได้)</span>}
            </p>
            <FinalizeForm month={start} warnings={warnings} />
          </div>
        )}
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
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
