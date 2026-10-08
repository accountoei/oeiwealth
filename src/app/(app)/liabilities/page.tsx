import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, money, thDate } from "@/lib/format";

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

export default async function LiabilitiesPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_liabilities_all").select("*").order("liability_source").order("name");
  const rows = (data as Row[] | null) ?? [];
  const totals = new Map<string, number>();
  rows.forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.amount ?? 0)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Liabilities</h1>
          <p className="text-sm text-slate-500">หนี้สินทั้งหมด: เงินกู้ · บัตรเครดิต · เงินประกันการเช่า (ยอดคงค้างที่ยืนยันล่าสุด)</p>
        </div>
        {me.role !== "VIEWER" && (
          <div className="flex gap-2">
            <Link href="/family/cards" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">บัตรเครดิต</Link>
            <Link href="/liabilities/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินกู้</Link>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">หนี้รวม {ccy}</div>
              <div className="text-lg font-semibold tabular-nums text-red-700">{money(v, ccy)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4 text-right">ยอดคงค้าง</th><th className="px-4">ยอด ณ</th>
              <th className="px-4">ค่างวด / ครบกำหนด</th><th className="px-4">หมายเหตุ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีหนี้สิน</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.liability_source}-${r.source_id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={linkOf(r)} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">
                    {SOURCE_LABEL[r.liability_source]}{r.liability_source === "LOAN" && ` · ${LIABILITY_TYPE_LABEL[r.subtype] ?? r.subtype}`}
                  </div>
                </td>
                <td className="px-4 text-right tabular-nums">{money(r.amount, r.currency)}</td>
                <td className="px-4">{thDate(r.balance_date)}</td>
                <td className="px-4 text-slate-600">
                  {r.monthly_payment ? `${money(r.monthly_payment)}/เดือน` : ""}
                  {r.payment_due_day ? ` · ทุกวันที่ ${r.payment_due_day}` : ""}
                  {r.due_date ? ` · ครบ ${thDate(r.due_date)}` : ""}
                </td>
                <td className={`px-4 text-xs ${DERIVED[r.derived_status ?? ""]?.cls ?? ""}`}>{DERIVED[r.derived_status ?? ""]?.text ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        ระบบไม่คำนวณยอดจากค่างวดเอง (ไม่รู้สัดส่วนเงินต้น/ดอกเบี้ย) — อัปเดตยอดคงค้างจาก Statement ทุกเดือน
      </p>
    </div>
  );
}
