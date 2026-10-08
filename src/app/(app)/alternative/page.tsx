import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, thDate, todayBangkok } from "@/lib/format";

type Row = { id: string; asset_id: string; quantity: number | null; brand: string | null; storage_location: string | null;
  asset_categories: { category_name: string } | { category_name: string }[] | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string } };

export default async function AlternativePage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("alternative_asset_details")
    .select("id,asset_id,quantity,brand,storage_location,asset_categories(category_name),assets!inner(name,currency,current_value,current_value_date,status,deleted_at)")
    .is("deleted_at", null).is("assets.deleted_at", null).order("created_at");
  const rows = (data as unknown as Row[] | null) ?? [];
  const cat = (r: Row) => (Array.isArray(r.asset_categories) ? r.asset_categories[0] : r.asset_categories)?.category_name ?? "-";
  const old = addDays(todayBangkok(), -90);
  const totals = new Map<string, number>();
  rows.filter((r) => r.assets.status === "ACTIVE").forEach((r) => totals.set(r.assets.currency, (totals.get(r.assets.currency) ?? 0) + Number(r.assets.current_value ?? 0)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Alternative Assets</h1>
          <p className="text-sm text-slate-500">ทอง เครื่องประดับ นาฬิกา ของสะสม คริปโต และอื่น ๆ</p>
        </div>
        {me.role !== "VIEWER" && <Link href="/alternative/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มสินทรัพย์</Link>}
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([c, v]) => (
            <div key={c} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">มูลค่ารวม {c}</div>
              <div className="text-lg font-semibold tabular-nums">{money(v, c, 0)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">รายการ</th><th className="px-4">หมวด</th><th className="px-4 text-right">มูลค่าล่าสุด</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">ยังไม่มีรายการ</td></tr>}
            {rows.map((r) => {
              const stale = !r.assets.current_value_date || r.assets.current_value_date < old;
              return (
                <tr key={r.id} className={r.assets.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/alternative/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.assets.name}</Link>
                    <div className="text-xs text-slate-500">{[r.brand, r.quantity != null ? `จำนวน ${Number(r.quantity)}` : null, r.storage_location].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-4">{cat(r)}</td>
                  <td className="px-4 text-right">
                    <div className="tabular-nums">{money(r.assets.current_value, r.assets.currency, 0)}</div>
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
