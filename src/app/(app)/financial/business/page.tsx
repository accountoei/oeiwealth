import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";

type Row = { id: string; asset_id: string; company_name: string; business_type: string | null; company_ownership_percent: number | null;
  status: string; assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null } };

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView((await searchParams).p);
  const { data, error } = await supabase.from("private_business_details")
    .select("id,asset_id,company_name,business_type,company_ownership_percent,status,assets!inner(name,currency,current_value,current_value_date,deleted_at)")
    .is("deleted_at", null).is("assets.deleted_at", null).order("created_at");
  const rows = ((data as unknown as Row[] | null) ?? []).filter((r) => pv.showAsset(r.asset_id));
  const old = addDays(todayBangkok(), -90);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Private Business</h1>
          <p className="text-sm text-slate-500">ธุรกิจของครอบครัว / หุ้นนอกตลาด · ปันผลเป็นรายได้ · เงินลงทุนเพิ่มไม่ใช่ค่าใช้จ่าย</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/financial/business/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มกิจการ</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">กิจการ</th><th className="px-4 text-right">% ที่ถือ</th><th className="px-4 text-right">{pv.personId ? `มูลค่าส่วนของ ${pv.personName}` : "มูลค่าส่วนของครอบครัว"}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีกิจการของ ${pv.personName}` : "ยังไม่มีรายการ"}</td></tr>}
            {rows.map((r) => {
              const stale = !r.assets.current_value_date || r.assets.current_value_date < old;
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/financial/business/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.assets.name}</Link>
                    <div className="text-xs text-slate-500">{r.company_name}{r.business_type && ` · ${r.business_type}`}</div>
                  </td>
                  <td className="px-4 text-right">{r.company_ownership_percent != null ? `${Number(r.company_ownership_percent)}%` : "-"}</td>
                  <td className="px-4 text-right">
                    <div className="tabular-nums">{money(r.assets.current_value == null ? null : Number(r.assets.current_value) * pv.assetShare(r.asset_id), r.assets.currency, 0)}</div>
                    {pv.assetPct(r.asset_id) != null && <div className="text-xs text-slate-400">{pv.assetPct(r.asset_id)}% ของ {money(r.assets.current_value, r.assets.currency, 0)}</div>}
                    <div className={`text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>ณ {thDate(r.assets.current_value_date)}{stale && " · เกิน 90 วัน"}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
