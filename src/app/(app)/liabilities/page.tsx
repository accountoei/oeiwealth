import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, money, thDate } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";

type Row = { liability_source: string; source_id: string; name: string; subtype: string; currency: string;
  amount: number | null; balance_date: string | null; due_date: string | null; monthly_payment: number | null;
  payment_due_day: number | null; status: string; derived_status: string | null };

const SOURCE_LABEL: Record<string, string> = { LOAN: "เงินกู้", CREDIT_CARD: "บัตรเครดิต", SECURITY_DEPOSIT: "เงินประกันการเช่า" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  PAID_AFTER_BALANCE_DATE: { text: "จ่ายบัตรแล้ว ยังไม่อัปเดตยอด", cls: "text-amber-700" },
  DEPOSIT_REFUND_OVERDUE: { text: "เลยกำหนดคืนเงินประกัน", cls: "text-red-600" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  HELD: { text: "ถือไว้", cls: "text-slate-500" },
};

function linkOf(r: Row) {
  if (r.liability_source === "LOAN") return `/liabilities/${r.source_id}`;
  if (r.liability_source === "CREDIT_CARD") return "/family/cards";
  return "/property";
}

export default async function LiabilitiesPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/liabilities", "/family/cards"];
  const [pv, { data, error }, loanOrder, cardOrder] = await Promise.all([
    loadPersonView(sp.p, { liabilities: true }),
    supabase.from("v_liabilities_all").select("*").order("liability_source").order("name"),
    loadSortMap("liabilities"), loadSortMap("credit_cards"),
  ]);
  // เรียง: เงินกู้ → บัตรเครดิต → เงินประกัน · ภายในกลุ่มตามลำดับที่ตั้งไว้ (เงินกู้ / บัตร)
  const GROUP: Record<string, number> = { LOAN: 0, CREDIT_CARD: 1, SECURITY_DEPOSIT: 2 };
  const TABLE: Record<string, string> = { LOAN: "liabilities", CREDIT_CARD: "credit_cards" };
  const orderOf = (r: Row) => (r.liability_source === "LOAN" ? loanOrder : r.liability_source === "CREDIT_CARD" ? cardOrder : null)?.get(r.source_id) ?? Number.MAX_SAFE_INTEGER;
  // มุมมองรายบุคคล: เฉพาะหนี้ที่คนนั้นมีส่วน · ยอด × สัดส่วน (เงินกู้ตามผู้รับผิดชอบ · บัตรตามเจ้าของบัตร · เงินประกันตามเจ้าของทรัพย์)
  const rows = ((data as Row[] | null) ?? []).filter((r) => pv.showLiability(r.source_id))
    .map((r, i) => ({ r, i })).sort((a, b) => (GROUP[a.r.liability_source] ?? 9) - (GROUP[b.r.liability_source] ?? 9)
      || orderOf(a.r) - orderOf(b.r) || a.i - b.i).map((x) => x.r)
    .map((r) => ({ ...r, full_amount: r.amount, pct: pv.liabilityPct(r.source_id),
      amount: r.amount == null ? null : Number(r.amount) * pv.liabilityShare(r.source_id) }));
  const totals = new Map<string, number>();
  rows.forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.amount ?? 0)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Liabilities</h1>
          <p className="text-sm text-slate-500">หนี้สินทั้งหมด: เงินกู้ · บัตรเครดิต · เงินประกันการเช่า (ยอดคงค้างที่ยืนยันล่าสุด)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
        <PersonFilter persons={pv.persons} value={pv.personId} />
        {me.role !== "VIEWER" && (
          <div className="flex gap-2">
            <Link href="/family/cards" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">บัตรเครดิต</Link>
            <Link href="/liabilities/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินกู้</Link>
          </div>
        )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">{pv.personId ? `หนี้ส่วนของ ${pv.personName}` : "หนี้รวม"} {ccy}</div>
              <div className="text-lg font-semibold tabular-nums text-red-700">{money(v, ccy)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">หนี้สินทั้งหมด</h2>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/liabilities", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4 text-right">ยอดคงค้าง</th><th className="px-4">ยอด ณ</th>
              <th className="px-4">ค่างวด / ครบกำหนด</th><th className="px-4">หมายเหตุ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีหนี้สินของ ${pv.personName}` : "ยังไม่มีหนี้สิน"}</td></tr>}
            {rows.map((r, i) => {
              // จัดลำดับภายในกลุ่มเดียวกัน (เงินกู้ / บัตร) · เงินประกันเรียงตามชื่อ
              const same = (x?: typeof r) => x && x.liability_source === r.liability_source ? x.source_id : null;
              return (
              <tr key={`${r.liability_source}-${r.source_id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  {ordering && TABLE[r.liability_source] && <span className="mr-2 align-middle">
                    <MoveButtons table={TABLE[r.liability_source]} id={r.source_id} paths={paths} prev={same(rows[i - 1])} next={same(rows[i + 1])} /></span>}
                  <Link href={linkOf(r)} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">
                    {SOURCE_LABEL[r.liability_source]}{r.liability_source === "LOAN" && ` · ${LIABILITY_TYPE_LABEL[r.subtype] ?? r.subtype}`}
                  </div>
                </td>
                <td className="px-4 text-right tabular-nums">{money(r.amount, r.currency)}
                  {r.pct != null && <div className="text-xs text-slate-500">{r.pct}% ของ {money(r.full_amount, r.currency)}</div>}</td>
                <td className="px-4">{thDate(r.balance_date)}</td>
                <td className="px-4 text-slate-600">
                  {r.monthly_payment ? `${money(r.monthly_payment)}/เดือน` : ""}
                  {r.payment_due_day ? ` · ทุกวันที่ ${r.payment_due_day}` : ""}
                  {r.due_date ? ` · ครบ ${thDate(r.due_date)}` : ""}
                </td>
                <td className={`px-4 text-xs ${DERIVED[r.derived_status ?? ""]?.cls ?? ""}`}>{DERIVED[r.derived_status ?? ""]?.text ?? ""}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        เงินกู้: เงินต้นที่บันทึกจ่าย (แยกเงินต้น / ดอกเบี้ย) ลดยอดให้ทันที · อัปเดตยอดตาม Statement เป็นระยะเพื่อความถูกต้อง
      </p>
    </div>
  );
}
