import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { MOVE_LABEL, addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import { BusinessInfoForm, BuySharesForm, DividendForm, ShareSaleForm, UndoShareSale } from "./forms";
import EditToggle from "@/components/EditToggle";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { businessDividendFields } from "@/lib/source-edit";
import { DetailItem as Item } from "@/components/Boxes";

export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: d }, { data: owners }, { data: vals }, { data: incomes }, { data: moves }, { data: banks }, { data: family }, { data: persons }, { data: sales }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_type", "PRIVATE_BUSINESS").is("deleted_at", null).maybeSingle(),
    supabase.from("private_business_details").select("*").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("asset_ownerships").select("person_id,ownership_percent,shares,cost_per_share,start_date,end_date,persons(name)").eq("asset_id", id).is("deleted_at", null),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("income_transactions").select("id,date,amount,tax,currency,notes,income_type,income_subtype").eq("asset_id", id).is("deleted_at", null).order("date", { ascending: false }),
    supabase.from("cash_movements").select("id,movement_date,movement_type,amount,currency,description,is_derived,metadata").or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`)
      .is("deleted_at", null).order("movement_date", { ascending: false }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("business_share_sales").select("id,kind,sale_date,shares,price,fee,currency,bank_asset_id,value_before,value_after,book_value,gain,cost_basis,new_issue,notes,created_at,persons(name)")
      .eq("asset_id", id).is("deleted_at", null).order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  if (!a || !d) notFound();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const paths = [`/financial/business/${id}`, "/financial/business", "/income-expenses", "/financial/cash"];
  type Own = { person_id: string; ownership_percent: number; shares: number | null; cost_per_share: number | null; start_date: string; end_date: string | null;
    persons: { name: string } | { name: string }[] | null };
  const activeOwners = ((owners ?? []) as Own[]).filter((o) => !o.end_date)
    .map((o) => ({ ...o, person_name: (Array.isArray(o.persons) ? o.persons[0]?.name : o.persons?.name) ?? "" }));
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  // เจ้าของเก็บเป็นจำนวนหุ้น (ตาม บอจ.5) หรือ % (แบบเดิม)
  const byShares = activeOwners.length > 0 ? activeOwners.every((o) => o.shares != null) : d.total_shares != null;
  const totalShares = d.total_shares != null ? Number(d.total_shares) : null;
  const pctOfCompany = (sh: number) => (totalShares ? (sh * 100) / totalShares : null);
  const fmtPct = (v: number | null) => (v == null ? "-" : `${v.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`);
  const companyPct = byShares && d.shares_owned != null && totalShares ? pctOfCompany(Number(d.shares_owned))
    : d.company_ownership_percent != null ? Number(d.company_ownership_percent) : null;
  // มูลค่าธุรกิจปกติอัปเดตปีละครั้ง (ตามงบการเงิน) → เตือนเมื่อเกิน 1 ปี
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -365);
  const STATUS: [string, string][] = [["ACTIVE", "ดำเนินการ"], ["DORMANT", "หยุดชั่วคราว"], ["CLOSED", "ปิดกิจการ"], ["SOLD", "ขายหุ้นแล้ว"]];
  const ASSET_STATUS: [string, string][] = [["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["CLOSED", "ปิดแล้ว"]];
  const label = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] ?? v;
  // ขายหุ้นรายคน: ต้องระบุเจ้าของเป็นจำนวนหุ้น
  const holders = activeOwners.filter((o) => o.shares != null && Number(o.shares) > 0)
    .map((o) => ({ person_id: o.person_id, name: o.person_name, shares: Number(o.shares), cost: o.cost_per_share == null ? null : Number(o.cost_per_share) }));
  const familyShares = holders.reduce((s2, o) => s2 + o.shares, 0);
  const avgCost = d.investment_cost != null && familyShares > 0 ? Number(d.investment_cost) / familyShares : null;
  const perShareNow = a.current_value != null && familyShares > 0 ? Number(a.current_value) / familyShares : null;
  // หุ้นที่ครอบครัวถือ ณ วันที่ (ใช้คิดราคาหุ้นตามการประเมินในประวัติมูลค่า)
  const sharesAt = (dt: string) => ((owners ?? []) as Own[]).filter((o) => o.shares != null && o.start_date <= dt && (!o.end_date || o.end_date >= dt))
    .reduce((s2, o) => s2 + Number(o.shares), 0);
  const bankName = new Map((banks ?? []).map((b) => [b.asset_id as string, b.name as string]));
  type Sale = { id: string; kind: string; sale_date: string; shares: number; price: number; fee: number; currency: string; bank_asset_id: string | null;
    value_before: number | null; value_after: number | null; book_value: number | null; gain: number | null; cost_basis: number | null; new_issue: boolean;
    notes: string | null; persons: { name: string } | { name: string }[] | null };
  const saleList = (sales ?? []) as Sale[];
  const pn = (x: Sale["persons"]) => (Array.isArray(x) ? x[0]?.name : x?.name) ?? "";
  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/business" className="text-sm text-slate-500 hover:underline">← Private Business</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{a.name}</h1>
            <p className="text-sm text-slate-500">{d.company_name}{d.registration_no && ` · ${d.registration_no}`}{d.business_type && ` · ${d.business_type}`}</p>
          </div>
          {canWrite && a.status === "ACTIVE" && (
            <ActionBar>
              {canDelete && byShares && <BuySharesForm assetId={id} currency={a.currency} banks={banks ?? []} persons={persons ?? []} holders={holders}
                avgCost={avgCost} today={today} minDate={goLive} />}
              {canDelete && (byShares && holders.length > 0
                ? <ShareSaleForm assetId={id} currency={a.currency} banks={banks ?? []} holders={holders} familyShares={familyShares}
                    value={a.current_value == null ? null : Number(a.current_value)} avgCost={avgCost} today={today} minDate={goLive} />
                : <span className="self-center text-xs text-slate-500" title="แก้ที่ แก้ไขข้อมูล → สมาชิกที่เป็นเจ้าของ">ขายหุ้นได้เมื่อระบุเจ้าของเป็นจำนวนหุ้น</span>)}
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าส่วนของครอบครัว</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
            <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>ณ {thDate(a.current_value_date)}{stale && " · เกิน 1 ปี"}</div>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="BUSINESS" entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ชื่อบริษัท">{d.company_name}</Item>
                <Item label="เลขทะเบียน">{d.registration_no || "-"}</Item>
                <Item label="ประเภทกิจการ">{d.business_type || "-"}</Item>
                <Item label="การถือหุ้น">ถือ {fmtPct(companyPct)} ของบริษัท</Item>
                <Item label="หุ้นที่ถือ / หุ้นทั้งหมด">{qty(d.shares_owned)} / {qty(d.total_shares)}</Item>
                <Item label="ทุนจดทะเบียน" num>{d.par_value != null && d.total_shares != null ? money(Number(d.par_value) * Number(d.total_shares), a.currency) : "-"}
                  <span className="block text-xs text-slate-500">{d.par_value != null ? `หุ้นละ ${money(d.par_value, undefined, 4)} (par)` : "ยังไม่ได้ใส่มูลค่าหุ้นที่ตราไว้"}</span></Item>
                <Item label="เงินลงทุน" num>{money(d.investment_cost, undefined, 0)}{avgCost != null && <span className="block text-xs text-slate-500">เฉลี่ยหุ้นละ {money(avgCost, undefined, 4)}</span>}</Item>
                <Item label="ราคาหุ้นตามการประเมิน" num>{perShareNow != null ? money(perShareNow, a.currency, 4) : "-"}<span className="block text-xs text-slate-500">มูลค่า ÷ หุ้นที่ครอบครัวถือ</span></Item>
                <Item label="สถานะกิจการ">{label(STATUS, d.status)}</Item>
                <Item label="นับเป็นทรัพย์สิน">{label(ASSET_STATUS, a.status)}</Item>
                <Item label="สมาชิกที่เป็นเจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => (
                    <div key={o.person_id}>{o.person_name} · {o.shares != null
                      ? <>{qty(o.shares)} หุ้น <span className="text-slate-500">({fmtPct(pctOfCompany(Number(o.shares)))} ของบริษัท)</span>
                          <span className="block text-xs text-slate-500">ทุนหุ้นละ {money(o.cost_per_share ?? avgCost, a.currency, 4)}{o.cost_per_share == null && avgCost != null ? " (เฉลี่ย)" : ""}</span></>
                      : `${Number(o.ownership_percent)}%`}</div>))}
                  {!byShares && ownerTotal < 100 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
                </Item>
                {d.notes && <Item label="หมายเหตุ" wide>{d.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <BusinessInfoForm assetId={id} byShares={byShares} v={{ name: a.name, company_name: d.company_name, registration_no: d.registration_no,
                  business_type: d.business_type, total_shares: d.total_shares, par_value: d.par_value, shares_owned: d.shares_owned,
                  company_ownership_percent: d.company_ownership_percent, investment_cost: d.investment_cost, notes: d.notes }} />
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    unit={byShares ? "shares" : "percent"} totalShares={totalShares}
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent), shares: o.shares, cost: o.cost_per_share }))} />
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-slate-100 pt-4">
                  <StatusSelect table="private_business_details" id={d.id} value={d.status} paths={paths} label="สถานะกิจการ" options={STATUS}
                    remove={canDelete ? { kind: "asset", id, redirectTo: "/financial/business", paths: ["/financial/business"], label: "ลบรายการนี้",
                      hint: "ลบได้เมื่อไม่มีปันผล / เงินลงทุนที่บันทึกแล้ว" } : undefined} />
                  <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="นับเป็นทรัพย์สิน" options={ASSET_STATUS} />
                </div>
              </div>
            } />
        </div>
      </section>

      <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} paths={paths} canWrite={canWrite} canDelete={canDelete} showMoves={false}
        cost={d.investment_cost != null ? Number(d.investment_cost) : a.acquisition_cost != null ? Number(a.acquisition_cost) : null} />

      {saleList.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">ประวัติซื้อ / ขายหุ้น</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">วันที่</th><th>รายการ</th><th className="text-right">จำนวนหุ้น</th><th className="pl-4 text-right">ราคา</th>
                  <th className="pl-4 text-right">กำไร / ขาดทุน</th><th className="pl-4">บัญชี</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saleList.map((x, i) => (
                  <tr key={x.id} className="align-top">
                    <td className="whitespace-nowrap py-1.5">{thDate(x.sale_date)}</td>
                    <td><span className={x.kind === "BUY" ? "text-indigo-700" : "text-orange-700"}>{x.kind === "BUY" ? (x.new_issue ? "ลงทุนเพิ่ม (หุ้นใหม่)" : "ซื้อหุ้นเพิ่ม") : "ขาย"}</span> · {pn(x.persons)}
                      {x.notes && <div className="text-xs text-slate-400">{x.notes}</div>}</td>
                    <td className="text-right tabular-nums">{qty(x.shares)}</td>
                    <td className="whitespace-nowrap pl-4 text-right tabular-nums">{money(x.price, x.currency)}
                      {Number(x.shares) > 0 && <div className="text-xs text-slate-500">หุ้นละ {money(Number(x.price) / Number(x.shares), undefined, 4)}</div>}
                      {Number(x.fee) > 0 && <div className="text-xs text-slate-500">ค่าใช้จ่าย {money(x.fee)}</div>}</td>
                    <td className="whitespace-nowrap pl-4 text-right tabular-nums">{x.kind === "SELL" && x.gain != null ? (
                      <><span className={Number(x.gain) >= 0 ? "text-emerald-700" : "text-red-700"}>{Number(x.gain) >= 0 ? "+" : "−"}{money(Math.abs(Number(x.gain)))}</span>
                        {x.cost_basis != null && <div className="text-xs text-slate-500">เทียบทุน {(() => { const g = Number(x.price) - Number(x.fee) - Number(x.cost_basis); return `${g >= 0 ? "+" : "−"}${money(Math.abs(g))}`; })()}</div>}</>
                    ) : "-"}</td>
                    <td className="pl-4 text-xs text-slate-500">{x.bank_asset_id ? bankName.get(x.bank_asset_id) ?? "บัญชี" : "ไม่ผ่านบัญชี"}</td>
                    <td className="pl-2 text-right">{canDelete && i === 0 && (
                      <UndoShareSale assetId={id} saleId={x.id}
                        confirmText={x.kind === "BUY"
                          ? `ยกเลิกการลงทุนเพิ่มของ ${pn(x.persons)} วันที่ ${thDate(x.sale_date)}?\nหุ้น ${qty(x.shares)} หุ้นจะถูกหักคืน · มูลค่า / เงินลงทุนกลับเป็นก่อนหน้า · เงินจ่ายของครั้งนี้ถูกลบ`
                          : `ยกเลิกการขายหุ้นของ ${pn(x.persons)} วันที่ ${thDate(x.sale_date)}?\n${qty(x.shares)} หุ้นจะกลับคืน · มูลค่ากลับเป็นก่อนขาย · เงินเข้าบัญชีและกำไร / ขาดทุนของครั้งนี้ถูกลบ`} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">กำไร / ขาดทุน = เงินขายสุทธิ − มูลค่าตามราคาประเมินล่าสุด (ลงเป็นรายได้ / ค่าใช้จ่ายของผู้ขาย) · เทียบทุน = ดูเป็นข้อมูล · ยกเลิกได้เฉพาะครั้งล่าสุด</p>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="font-medium text-slate-900">มูลค่า</h2>
            <p className="text-xs text-slate-500">ปกติอัปเดตปีละครั้ง ตามงบการเงิน</p>
            {stale && a.status === "ACTIVE" && <p className="mt-1 text-xs font-medium text-amber-700">มูลค่าล่าสุดเกิน 1 ปีแล้ว ({thDate(a.current_value_date)})</p>}
          </div>
          {canWrite && a.status === "ACTIVE" && (
            <AssetValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} paths={paths}
              methods={[["BOOK_VALUE", "มูลค่าตามบัญชี"], ["USER_ESTIMATE", "ประมาณเอง"], ["APPRAISAL", "ผู้ประเมิน"], ["LATEST_TRANSACTION", "ราคาซื้อขายล่าสุด"]]} />
          )}
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="whitespace-nowrap py-1.5">{thDate(v.valuation_date)}</td><td className="text-right tabular-nums">{money(v.value, undefined, 0)}
                  {byShares && sharesAt(v.valuation_date) > 0 && <div className="text-xs text-slate-500">หุ้นละ {money(Number(v.value) / sharesAt(v.valuation_date), undefined, 4)}</div>}</td>
                <td className="pl-3 text-xs text-slate-500">{v.source === "OPENING" ? "ยอดตั้งต้น" : v.notes}</td>
                <td className="pl-2 text-right">{canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                  fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value }]} />}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium text-slate-900">ปันผล / เงินลงทุนเพิ่ม / ขาย</h2>
            {canWrite && a.status === "ACTIVE" && <DividendForm assetId={id} banks={banks ?? []} today={today} minDate={goLive} />}
          </div>
          {(incomes ?? []).length === 0 && (moves ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {(incomes ?? []).map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap py-1.5">{thDate(i.date)}</td><td>{i.income_type === "BUSINESS_DIVIDEND" ? "ปันผล" : i.income_subtype ?? "รายได้อื่น"}</td><td className="text-right tabular-nums text-emerald-700">{money(i.amount, i.currency)}</td>
                  <td className="pl-2 text-right">{canWrite && i.income_type === "BUSINESS_DIVIDEND" && <RowActions table="income_transactions" id={i.id} paths={paths} canDelete={canDelete}
                    fields={businessDividendFields(i)} />}</td>
                </tr>
              ))}
              {(moves ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap py-1.5">{thDate(m.movement_date)}</td><td>{m.movement_type === "ASSET_PURCHASE" ? "ลงทุนเพิ่ม" : m.movement_type === "ASSET_SALE" ? "เงินขายหุ้น (ทุนคืน)" : MOVE_LABEL[m.movement_type] ?? m.movement_type}</td>
                  <td className="text-right tabular-nums">{money(m.amount, m.currency)}</td>
                  <td className="pl-2 text-right">{canWrite && !m.is_derived && !(m.metadata as { share_sale?: boolean; share_buy?: boolean } | null)?.share_sale && !(m.metadata as { share_buy?: boolean } | null)?.share_buy && <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete}
                    fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date }, { name: "amount", label: "จำนวน", type: "number", value: m.amount }]} />}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </section>
    </div>
  );
}
