import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INS_STATUS, INS_TYPE, money, thDate } from "@/lib/format";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);

export default async function InsurancePage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data, error }, { data: persons }, { data: cvs }] = await Promise.all([
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name"),
    supabase.from("assets").select("id,current_value,currency,current_value_date").eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
  ]);
  const pname = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const cv = new Map((cvs ?? []).map((a) => [a.id, a]));
  const rows = data ?? [];
  const cvTotal = (cvs ?? []).reduce((s, a) => s + (a.currency === "THB" ? Number(a.current_value ?? 0) : 0), 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Insurance</h1>
          <p className="text-sm text-slate-500">กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</p>
        </div>
        {me.role !== "VIEWER" && <Link href="/insurance/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มกรมธรรม์</Link>}
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {cvTotal > 0 && (
        <div className="inline-block rounded-xl border border-slate-200 bg-white px-5 py-3">
          <div className="text-xs text-slate-500">มูลค่าเวนคืนรวม (THB)</div>
          <div className="text-lg font-semibold tabular-nums">{money(cvTotal, "THB", 0)}</div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">กรมธรรม์</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4 text-right">ทุน / เบี้ย</th><th className="px-4 text-right">มูลค่าเวนคืน</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีกรมธรรม์</td></tr>}
            {rows.map((r) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>
                    <div className="text-xs text-slate-500">{TYPE[r.insurance_type] ?? r.insurance_type}{r.end_date && ` · ถึง ${thDate(r.end_date)}`}</div>
                  </td>
                  <td className="px-4">{r.person_id ? pname.get(r.person_id) : "-"}</td>
                  <td className="px-4 text-right tabular-nums text-xs">
                    {r.insured_amount != null && <div>ทุน {money(r.insured_amount, r.insured_amount_currency ?? undefined, 0)}</div>}
                    {r.premium != null && <div className="text-slate-500">เบี้ย {money(r.premium, undefined, 0)}/ปี</div>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.has_cash_value ? (c ? money(c.current_value, c.currency, 0) : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
