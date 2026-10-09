import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LEASE_STATUS, PROPERTY_TYPE_LABEL, USAGE_LABEL, addDays, landText, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";

type Prop = { id: string; asset_id: string; property_type: string; usage_type: string; location_group: string | null;
  land_area_sq_wa: number | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string } };
type Lease = { id: string; property_asset_id: string; tenant_name: string; unit_label: string | null; rent_amount: number;
  rent_currency: string; end_date: string; lease_status: string; deposit_status: string };


export default async function PropertyPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView((await searchParams).p);
  const [{ data, error }, { data: leases }] = await Promise.all([
    supabase.from("property_details")
      .select("id,asset_id,property_type,usage_type,location_group,land_area_sq_wa,assets!inner(name,currency,current_value,current_value_date,status,deleted_at)")
      .is("deleted_at", null).is("assets.deleted_at", null).order("created_at"),
    supabase.from("v_lease_status").select("id,property_asset_id,tenant_name,unit_label,rent_amount,rent_currency,end_date,lease_status,deposit_status")
      .in("lease_status", ["ACTIVE", "EXPIRING_SOON", "UPCOMING"]),
  ]);
  const props = ((data as unknown as Prop[] | null) ?? []).filter((p) => pv.showAsset(p.asset_id));
  const byProp = new Map<string, Lease[]>();
  ((leases as Lease[] | null) ?? []).forEach((l) => byProp.set(l.property_asset_id, [...(byProp.get(l.property_asset_id) ?? []), l]));
  const old = addDays(todayBangkok(), -90);
  const totals = new Map<string, number>();
  props.filter((p) => p.assets.status === "ACTIVE")
    .forEach((p) => totals.set(p.assets.currency, (totals.get(p.assets.currency) ?? 0) + Number(p.assets.current_value ?? 0) * pv.assetShare(p.asset_id)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Property</h1>
          <p className="text-sm text-slate-500">อสังหาริมทรัพย์ทุกการใช้งาน · สัญญาเช่า · ค่าเช่า · เงินประกัน</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && (
            <Link href="/property/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มทรัพย์สิน</Link>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([ccy, v]) => (
            <div key={ccy} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <div className="text-xs text-slate-500">มูลค่ารวม {ccy}</div>
              <div className="text-lg font-semibold tabular-nums">{money(v, ccy, 0)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">ทรัพย์สิน</th><th className="px-4">การใช้งาน</th><th className="px-4 text-right">มูลค่าล่าสุด</th>
              <th className="px-4">สัญญาเช่า</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีทรัพย์สินของ ${pv.personName}` : "ยังไม่มีทรัพย์สิน"}</td></tr>}
            {props.map((p) => {
              const ls = byProp.get(p.asset_id) ?? [];
              const stale = !p.assets.current_value_date || p.assets.current_value_date < old;
              return (
                <tr key={p.id} className={`align-top hover:bg-slate-50 ${p.assets.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <Link href={`/property/${p.asset_id}`} className="font-medium text-slate-900 hover:underline">{p.assets.name}</Link>
                    <div className="text-xs text-slate-500">
                      {PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type}
                      {p.location_group && ` · ${p.location_group}`}
                      {p.land_area_sq_wa != null && ` · ${landText(p.land_area_sq_wa)}`}
                    </div>
                  </td>
                  <td className="px-4 py-3">{USAGE_LABEL[p.usage_type] ?? p.usage_type}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="tabular-nums">{money(p.assets.current_value == null ? null : Number(p.assets.current_value) * pv.assetShare(p.asset_id), p.assets.currency, 0)}</div>
                    {pv.assetPct(p.asset_id) != null && <div className="text-xs text-slate-400">{pv.assetPct(p.asset_id)}% ของ {money(p.assets.current_value, p.assets.currency, 0)}</div>}
                    <div className={`text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>
                      ณ {thDate(p.assets.current_value_date)}{stale && " · เกิน 90 วัน"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {p.usage_type !== "RENTAL" && ls.length === 0 ? <span className="text-slate-400">ไม่ได้ปล่อยเช่า</span> : null}
                    {p.usage_type === "RENTAL" && ls.length === 0 ? <span className="text-amber-700">ไม่มีสัญญาที่มีผล</span> : null}
                    {ls.map((l) => (
                      <div key={l.id} className="mb-1">
                        <span className={`mr-1 rounded px-1.5 py-0.5 ${LEASE_STATUS[l.lease_status]?.cls ?? ""}`}>
                          {LEASE_STATUS[l.lease_status]?.text ?? l.lease_status}
                        </span>
                        {[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} · {money(l.rent_amount, l.rent_currency, 0)} · ถึง {thDate(l.end_date)}
                      </div>
                    ))}
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
