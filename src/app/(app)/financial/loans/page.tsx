import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, thDate } from "@/lib/format";

const STATUS: Record<string, string> = { ACTIVE: "ปกติ", AT_RISK: "มีความเสี่ยง", CLOSED: "ปิดแล้ว", WRITTEN_OFF: "ตัดหนี้สูญ" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  OVERDUE: { text: "เลยกำหนดคืน", cls: "text-red-600" }, DUE_SOON: { text: "ใกล้ครบกำหนด", cls: "text-amber-700" },
};

export default async function LoansPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_loans_status")
    .select("asset_id,name,currency,borrower_name,principal,outstanding_principal,interest_rate,due_date,status,derived_status")
    .order("status").order("name");
  const rows = data ?? [];
  const totals = new Map<string, number>();
  rows.filter((r) => r.status !== "CLOSED" && r.status !== "WRITTEN_OFF")
    .forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.outstanding_principal ?? 0)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Loans Receivable</h1>
          <p className="text-sm text-slate-500">เงินที่ให้คนอื่นยืม · มูลค่า = เงินต้นคงเหลือ (ลดลงเมื่อบันทึกรับชำระ)</p>
        </div>
        {me.role !== "VIEWER" && <Link href="/financial/loans/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินให้กู้</Link>}
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([c, v]) => (
            <div key={c} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">เงินต้นคงเหลือรวม {c}</div>
              <div className="text-lg font-semibold tabular-nums">{money(v, c)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4 text-right">เงินต้นคงเหลือ</th><th className="px-4">ครบกำหนด</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">ยังไม่มีเงินให้กู้</td></tr>}
            {rows.map((r) => (
              <tr key={r.asset_id} className={r.status === "CLOSED" || r.status === "WRITTEN_OFF" ? "opacity-50" : ""}>
                <td className="px-4 py-3">
                  <Link href={`/financial/loans/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">ผู้กู้ {r.borrower_name} · เงินต้น {money(r.principal, r.currency)}{r.interest_rate != null && ` · ดอกเบี้ย ${Number(r.interest_rate)}%`}</div>
                </td>
                <td className="px-4 text-right tabular-nums">{money(r.outstanding_principal, r.currency)}</td>
                <td className="px-4">{thDate(r.due_date)}</td>
                <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                  {r.derived_status && <div className={DERIVED[r.derived_status]?.cls}>{DERIVED[r.derived_status]?.text}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
