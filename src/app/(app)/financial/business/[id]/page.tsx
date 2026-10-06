import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { MOVE_LABEL, addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import { CapitalForm, DividendForm } from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";

export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: d }, { data: owners }, { data: vals }, { data: incomes }, { data: moves }, { data: banks }, { data: family }, { data: persons }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_type", "PRIVATE_BUSINESS").is("deleted_at", null).maybeSingle(),
    supabase.from("private_business_details").select("*").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("income_transactions").select("id,date,amount,tax,currency,notes").eq("asset_id", id).is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,currency,description,is_derived").or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`)
      .is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (!a || !d) notFound();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const paths = [`/financial/business/${id}`, "/financial/business", "/income-expenses", "/financial/cash"];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/business" className="text-sm text-slate-500 hover:underline">← Private Business</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{a.name}</h1>
        <p className="text-sm text-slate-500">{d.company_name}{d.registration_no && ` · ${d.registration_no}`}{d.business_type && ` · ${d.business_type}`}</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">มูลค่าส่วนของครอบครัว</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
          <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน"}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">การถือหุ้น</div>
          <ul className="mt-1 space-y-0.5">
            <li>ถือ {d.company_ownership_percent != null ? `${Number(d.company_ownership_percent)}%` : "-"} ของบริษัท</li>
            <li>หุ้น {qty(d.shares_owned)} / {qty(d.total_shares)}</li>
            <li>เงินลงทุน {money(d.investment_cost, undefined, 0)}</li>
          </ul>
          {canWrite && <div className="mt-2"><RowActions table="private_business_details" id={d.id} paths={paths} canDelete={false} fields={[
            { name: "company_name", label: "ชื่อบริษัท", value: d.company_name, width: "w-44" }, { name: "registration_no", label: "เลขทะเบียน", value: d.registration_no },
            { name: "business_type", label: "ประเภท", value: d.business_type }, { name: "total_shares", label: "หุ้นทั้งหมด", type: "number", value: d.total_shares },
            { name: "shares_owned", label: "หุ้นที่ถือ", type: "number", value: d.shares_owned },
            { name: "company_ownership_percent", label: "% ที่ถือ", type: "number", value: d.company_ownership_percent, width: "w-20" },
            { name: "investment_cost", label: "เงินลงทุน", type: "number", value: d.investment_cost }]} /></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">สมาชิกที่เป็นเจ้าของ</div>
          <ul className="mt-1 space-y-0.5 text-sm">{activeOwners.map((o) => <li key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}</ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {canWrite && a.status === "ACTIVE" && (
        <div className="flex flex-wrap gap-2">
          <DividendForm assetId={id} banks={banks ?? []} today={today} minDate={goLive} />
          <CapitalForm assetId={id} banks={banks ?? []} today={today} minDate={goLive} />
        </div>
      )}

      {canWrite && a.status === "ACTIVE" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">อัปเดตมูลค่า</h2>
          <AssetValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} paths={paths}
            methods={[["BOOK_VALUE", "มูลค่าตามบัญชี"], ["USER_ESTIMATE", "ประมาณเอง"], ["APPRAISAL", "ผู้ประเมิน"], ["LATEST_TRANSACTION", "ราคาซื้อขายล่าสุด"]]} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">ประวัติมูลค่า</h2>
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td><td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                <td className="pl-3 text-xs text-slate-500">{v.source === "OPENING" ? "ยอดตั้งต้น" : v.notes}</td>
                <td className="pl-2 text-right">{canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                  fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value }]} />}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">ปันผล / เงินลงทุนเพิ่ม</h2>
          {(incomes ?? []).length === 0 && (moves ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {(incomes ?? []).map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5">{thDate(i.date)}</td><td>ปันผล</td><td className="text-right tabular-nums text-emerald-700">{money(i.amount, i.currency)}</td>
                  <td className="pl-2 text-right">{canWrite && <RowActions table="income_transactions" id={i.id} paths={paths} canDelete={canDelete}
                    fields={[{ name: "date", label: "วันที่", type: "date", value: i.date }, { name: "amount", label: "ยอด", type: "number", value: i.amount }, { name: "tax", label: "ภาษี", type: "number", value: i.tax }]} />}</td>
                </tr>
              ))}
              {(moves ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">{thDate(m.movement_date)}</td><td>{m.movement_type === "ASSET_PURCHASE" ? "ลงทุนเพิ่ม" : MOVE_LABEL[m.movement_type] ?? m.movement_type}</td>
                  <td className="text-right tabular-nums">{money(m.amount, m.currency)}</td>
                  <td className="pl-2 text-right">{canWrite && !m.is_derived && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete}
                    fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "จำนวน", type: "number", value: m.amount }]} />}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <StatusSelect table="private_business_details" id={d.id} value={d.status} paths={paths} label="สถานะกิจการ"
            options={[["ACTIVE", "ดำเนินการ"], ["DORMANT", "หยุดชั่วคราว"], ["CLOSED", "ปิดกิจการ"], ["SOLD", "ขายหุ้นแล้ว"]]} />
          <div><StatusSelect table="assets" id={id} value={a.status} paths={paths} label="นับเป็นทรัพย์สิน"
            options={[["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["CLOSED", "ปิดแล้ว"]]} /></div>
          {canDelete && <div><DeleteEntity kind="asset" id={id} redirectTo="/financial/business" paths={["/financial/business"]} label="ลบรายการนี้"
            hint="ลบได้เมื่อไม่มีปันผล / เงินลงทุนที่บันทึกแล้ว" /></div>}
        </section>
      )}
    </div>
  );
}
