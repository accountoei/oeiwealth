import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";
import { PayAssetForm, SellAssetForm } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";

const SOURCE: Record<string, string> = { OPENING: "มูลค่าตั้งต้น", APPRAISAL: "ผู้ประเมิน", USER: "ผู้ใช้", STATEMENT: "Statement" };

export default async function AlternativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: d }, { data: owners }, { data: vals }, { data: family }, { data: persons }, { data: banks }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_group", "ALTERNATIVE").is("deleted_at", null).maybeSingle(),
    supabase.from("alternative_asset_details").select("*, asset_categories(category_name)").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
  ]);
  if (!a || !d) notFound();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const paths = [`/alternative/${id}`, "/alternative", "/income-expenses"];
  const goLive = family?.go_live_date ?? "";
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const cat = (Array.isArray(d.asset_categories) ? d.asset_categories[0] : d.asset_categories)?.category_name;
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/alternative" className="text-sm text-slate-500 hover:underline">← Alternative Assets</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{a.name}</h1>
        <p className="text-sm text-slate-500">{cat} · {a.currency}</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">มูลค่าล่าสุด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
          <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}</div>
          {a.acquisition_cost != null && <div className="mt-1 text-xs text-slate-500">ราคาที่ได้มา {money(a.acquisition_cost, undefined, 0)}{a.acquisition_date && ` (${thDate(a.acquisition_date)})`}</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">รายละเอียด</div>
          <ul className="mt-1 space-y-0.5">
            {d.brand && <li>ยี่ห้อ {d.brand}{d.model && ` · รุ่น ${d.model}`}</li>}
            {d.serial_no && <li>Serial {d.serial_no}</li>}
            {d.quantity != null && <li>จำนวน {Number(d.quantity)}</li>}
            {d.storage_location && <li>เก็บที่ {d.storage_location}</li>}
            {d.condition && <li>สภาพ {d.condition}</li>}
            {d.details && <li className="text-slate-600">{d.details}</li>}
          </ul>
          {canWrite && <div className="mt-2"><RowActions table="alternative_asset_details" id={d.id} paths={paths} canDelete={false} fields={[
            { name: "brand", label: "ยี่ห้อ", value: d.brand }, { name: "model", label: "รุ่น", value: d.model },
            { name: "serial_no", label: "Serial", value: d.serial_no }, { name: "quantity", label: "จำนวน", type: "number", value: d.quantity, width: "w-20" },
            { name: "storage_location", label: "ที่เก็บ", value: d.storage_location }, { name: "condition", label: "สภาพ", value: d.condition },
            { name: "details", label: "รายละเอียด", value: d.details, width: "w-48" }]} /></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เจ้าของ</div>
          <ul className="mt-1 space-y-0.5 text-sm">{activeOwners.map((o) => <li key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}</ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {canWrite && a.status === "ACTIVE" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">อัปเดตมูลค่า</h2>
          <AssetValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} paths={paths} />
        </section>
      )}

      {canWrite && a.status === "ACTIVE" && (
        <div className="flex flex-wrap gap-2">
          <PayAssetForm assetId={id} currency={a.currency} banks={banks ?? []} today={today} minDate={goLive} paths={paths} />
          <SellAssetForm assetId={id} currency={a.currency} banks={banks ?? []} today={today} minDate={goLive} paths={paths} />
        </div>
      )}
      <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
        paths={paths} canWrite={canWrite} canDelete={canDelete} />

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติมูลค่า</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th className="text-right">มูลค่า</th><th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                <td className="pl-4">{SOURCE[v.source] ?? v.source}</td>
                <td className="pl-4 text-slate-500">{v.notes}</td>
                <td className="pl-2 text-right">
                  {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                    fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value },
                      { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <RowActions table="assets" id={id} paths={paths} canDelete={false} fields={[
            { name: "name", label: "ชื่อ", value: a.name, width: "w-48" }, { name: "acquisition_date", label: "วันที่ได้มา", type: "date", value: a.acquisition_date },
            { name: "acquisition_cost", label: "ราคาที่ได้มา", type: "number", value: a.acquisition_cost }, { name: "notes", label: "หมายเหตุ", value: a.notes, width: "w-48" }]} />
          <div><StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะ"
            options={[["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["GIFTED", "ยกให้แล้ว"], ["LOST", "สูญหาย / เสียหาย"]]} /></div>
          {canDelete && <div><DeleteEntity kind="asset" id={id} redirectTo="/alternative" paths={["/alternative"]} label="ลบรายการนี้" /></div>}
        </section>
      )}
    </div>
  );
}
