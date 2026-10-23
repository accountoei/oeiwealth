import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, qtyUnit, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";
import { PayAssetForm, SellAssetForm } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import EntityDocuments from "@/components/docs/EntityDocuments";
import EditToggle from "@/components/EditToggle";
import { ActionBar } from "@/components/ActionBar";
import { AltInfoForm, GoldValuationForm } from "./forms";
import { DetailItem as Item } from "@/components/Boxes";
import PendingPrice, { type Pending } from "@/components/PendingPrice";

const SOURCE: Record<string, string> = { OPENING: "มูลค่าตั้งต้น", APPRAISAL: "ผู้ประเมิน", USER: "ผู้ใช้", STATEMENT: "Statement", MARKET: "ราคาตลาด (อัตโนมัติ)" };
const ASSET_STATUS: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย / เสียหาย" };
type Cat = { category_name: string; category_code: string; default_unit: string | null };

export default async function AlternativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: d }, { data: owners }, { data: vals }, { data: family }, { data: persons }, { data: banks }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_group", "ALTERNATIVE").is("deleted_at", null).maybeSingle(),
    supabase.from("alternative_asset_details").select("*, asset_categories(category_name,category_code,default_unit)").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
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
  const cat = (Array.isArray(d.asset_categories) ? d.asset_categories[0] : d.asset_categories) as Cat | null;
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  const qty = d.quantity == null ? null : Number(d.quantity);
  const unit = d.unit ?? cat?.default_unit ?? null;
  // จำนวนเป็นบาททองคำ (สูตรเดียวกับ private.gold_value — ใช้แสดงตัวอย่างเท่านั้น)
  const goldBaht = qty == null ? null : unit === "กรัม" ? qty / 15.244 : unit === "บาททองคำ" ? qty : null;
  const perUnit = (v: number | null | undefined) => (v == null || !qty ? null : Number(v) / qty);
  const vsCost = a.current_value != null && a.acquisition_cost ? ((Number(a.current_value) - Number(a.acquisition_cost)) * 100) / Number(a.acquisition_cost) : null;
  const pctText = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/alternative" className="text-sm text-slate-500 hover:underline">← Alternative Assets</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{a.name}</h1>
            <p className="text-sm text-slate-500">{[cat?.category_name, d.brand, d.model].filter(Boolean).join(" · ")} · {a.currency}</p>
          </div>
          {canWrite && a.status === "ACTIVE" && (
            <ActionBar>
              <PayAssetForm assetId={id} currency={a.currency} banks={banks ?? []} today={today} minDate={goLive} paths={paths} />
              <SellAssetForm assetId={id} currency={a.currency} banks={banks ?? []} today={today} minDate={goLive} paths={paths} />
            </ActionBar>
          )}
        </div>
      </div>

      {d.price_pending && (
        <PendingPrice kind="gold" id={id} pending={d.price_pending as Pending} currency={a.currency} canResolve={canDelete} paths={paths} />
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าปัจจุบัน</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
            <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}</div>
            {perUnit(a.current_value) != null && <div className="mt-1 text-xs text-slate-500">{unit ?? "หน่วย"}ละ {money(perUnit(a.current_value))}</div>}
            {vsCost != null && <div className={`mt-1 text-xs ${vsCost >= 0 ? "text-emerald-700" : "text-red-700"}`}>เทียบทุน {pctText(vsCost)}</div>}
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="ALTERNATIVE" entityType="ASSET" entityId={id} module="ALTERNATIVE" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="หมวด">{cat?.category_name ?? "-"}</Item>
                <Item label="จำนวน">{qtyUnit(qty, unit)}</Item>
                {d.purity_pct != null && <Item label="ความบริสุทธิ์">{Number(d.purity_pct)}%</Item>}
                {cat?.category_code === "GOLD" && <Item label="ชนิดทอง">{d.gold_form === "ORNAMENT" ? `ทองรูปพรรณ${d.deduct_per_baht ? ` · หัก ${money(d.deduct_per_baht)}/บาททองคำ` : ""}` : "ทองคำแท่ง"}</Item>}
                {cat?.category_code === "GOLD" && <Item label="ประเมินมูลค่าอัตโนมัติ">{d.auto_price ? "เปิด (ราคารับซื้อสมาคมค้าทองคำ ทุกวันทำการ)" : "ปิด"}</Item>}
                <Item label="ยี่ห้อ / รุ่น">{[d.brand, d.model].filter(Boolean).join(" · ") || "-"}</Item>
                <Item label="Serial / เลขใบรับรอง">{d.serial_no || "-"}</Item>
                <Item label="ที่เก็บ">{d.storage_location || "-"}</Item>
                <Item label="สภาพ">{d.condition || "-"}</Item>
                <Item label="ราคาทุน" num>{money(a.acquisition_cost, undefined, 0)}
                  {perUnit(a.acquisition_cost) != null && <span className="block text-xs text-slate-500">{unit ?? "หน่วย"}ละ {money(perUnit(a.acquisition_cost))}</span>}</Item>
                <Item label="วันที่ได้มา">{a.acquisition_date ? thDate(a.acquisition_date) : "-"}</Item>
                <Item label="สถานะ">{ASSET_STATUS[a.status] ?? a.status}</Item>
                <Item label="เจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {d.details && <Item label="รายละเอียด" wide>{d.details}</Item>}
                {a.notes && <Item label="หมายเหตุ" wide>{a.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <AltInfoForm assetId={id} code={cat?.category_code ?? ""} catName={cat?.category_name ?? null} defaultUnit={cat?.default_unit ?? null} v={{
                  name: a.name, acquisition_date: a.acquisition_date, acquisition_cost: a.acquisition_cost, notes: a.notes,
                  brand: d.brand, model: d.model, serial_no: d.serial_no, quantity: d.quantity, unit: d.unit, purity_pct: d.purity_pct,
                  storage_location: d.storage_location, condition: d.condition, details: d.details, auto_price: d.auto_price,
                  gold_form: d.gold_form, deduct_per_baht: d.deduct_per_baht }} />
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะ"
                    options={Object.entries(ASSET_STATUS) as [string, string][]}
                    remove={canDelete ? { kind: "asset", id, redirectTo: "/alternative", paths: ["/alternative"], label: "ลบรายการนี้" } : undefined} />
                </div>
              </div>
            } />
        </div>
      </section>

      <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
        paths={paths} canWrite={canWrite} canDelete={canDelete} />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-medium text-slate-900">มูลค่า</h2>
          <p className="text-xs text-slate-500">แนะนำประเมินใหม่อย่างน้อยทุก 90 วัน (ทอง / คริปโต ตามราคาตลาด)</p>
        </div>
        {canWrite && a.status === "ACTIVE" && (cat?.category_code === "GOLD" && a.currency === "THB"
          ? <GoldValuationForm assetId={id} today={today} minDate={goLive} paths={paths} qtyBaht={goldBaht}
              purity={d.purity_pct != null ? Number(d.purity_pct) : null} ornament={d.gold_form === "ORNAMENT"} deduct={d.deduct_per_baht != null ? Number(d.deduct_per_baht) : null} />
          : <AssetValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} paths={paths} />)}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th className="text-right">มูลค่า</th>
            {qty ? <th className="text-right">ต่อ{unit ?? "หน่วย"}</th> : null}<th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                {qty ? <td className="text-right tabular-nums text-slate-500">{money(perUnit(v.value))}</td> : null}
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
    </div>
  );
}
