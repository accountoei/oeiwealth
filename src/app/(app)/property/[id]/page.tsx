import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  COST_STATUS, FREQ_LABEL, LAND_TAX_RATE_BY_USAGE, LEASE_STATUS, PERIODS_PER_YEAR, PROPERTY_TYPE_LABEL, TH_MONTHS, USAGE_LABEL, UTIL_EXPENSE_CATEGORY,
  UTIL_LABEL, addDays, landText, money, scheduleText, thDate, thMonth, todayBangkok,
} from "@/lib/format";
import {
  EditPropertyForm, NewLeaseForm, RecordCostForm, RecordRentForm, SettleDepositForm, SuggestVacant, TerminateLeaseForm,
  UtilityForm, ValuationForm,
} from "./forms";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import EditToggle from "@/components/EditToggle";
import { CopyTaxYear, DeleteTaxLine, TaxLineForm, type TaxLine } from "./LandTax";
import StatusSelect from "@/components/StatusSelect";
import { PayAssetForm, SellAssetForm } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { UndoDismissButton } from "@/app/(app)/income-expenses/forms";
import { propertyCostFields, rentIncomeFields } from "@/lib/source-edit";

const SOURCE_LABEL: Record<string, string> = { OPENING: "มูลค่าตั้งต้น", APPRAISAL: "ผู้ประเมิน", USER: "ผู้ใช้", STATEMENT: "Statement" };
const METHOD_LABEL: Record<string, string> = {
  USER_ESTIMATE: "ประมาณเอง", APPRAISAL: "ประเมิน", BOOK_VALUE: "ราคาทุน", LATEST_TRANSACTION: "ราคาซื้อขายล่าสุด", STATEMENT: "Statement",
};
const DEPOSIT_LABEL: Record<string, { text: string; cls: string }> = {
  HELD: { text: "ถือไว้ (เป็นหนี้)", cls: "text-slate-700" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  DEPOSIT_REFUND_OVERDUE: { text: "เลยกำหนดคืนแล้ว", cls: "text-red-600" },
  SETTLED: { text: "ปิดแล้ว", cls: "text-slate-500" },
};
const RENT_STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "text-emerald-700" }, PENDING: { text: "รอรับ", cls: "text-slate-600" },
  OVERDUE: { text: "ค้างรับ", cls: "text-red-600" }, DISMISSED: { text: "ยกเว้น", cls: "text-slate-400" },
};

type Lease = { id: string; unit_label: string | null; tenant_name: string; contract_no: string | null; start_date: string;
  end_date: string; terminated_date: string | null; rent_amount: number; rent_currency: string; payment_frequency: string;
  payment_due_day: number | null; security_deposit: number | null; deposit_currency: string | null;
  deposit_received_date: string | null; deposit_settled_date: string | null; deposit_settlement_type: string | null;
  deposit_refunded_amount: number | null; deposit_carried_amount: number | null; status: string; notes: string | null;
  lease_status: string; deposit_status: string; deposit_due_date: string };
type Util = { id: string; utility_type: string; provider: string | null; account_no: string | null; meter_no: string | null;
  notes: string | null; deleted_at: string | null; expected_amount: number | null; currency: string; frequency: string | null;
  due_day: number | null; due_month: number | null; active: boolean };
type Cost = { utility_id: string; utility_type: string; provider: string | null; cost_period: string; due_date: string;
  expected_amount: number; paid_amount: number; gap: number; currency: string; status: string; last_paid_date: string | null;
  dismissal_id: string | null; dismissal_reason: string | null };
type Rent = { lease_id: string; name: string; income_period: string; due_date: string; expected_amount: number;
  received_amount: number; currency: string; status: string };

export default async function PropertyDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ty?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: pd }, { data: owners }, { data: vals }, { data: leaseRows }, { data: rentRows },
    { data: banks }, { data: family }, { data: persons }, { data: costRows }, { data: cardRows }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("property_details").select("*, property_utilities(id,utility_type,provider,account_no,meter_no,notes,deleted_at,expected_amount,currency,frequency,due_day,due_month,active)")
      .eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,valuation_method,source,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("v_lease_status").select("*").eq("property_asset_id", id).order("start_date", { ascending: false }),
    supabase.from("v_lease_rent_tracking").select("*").eq("property_asset_id", id)
      .order("income_period", { ascending: false }).limit(36),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_property_cost_tracking").select("utility_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,gap,currency,status,last_paid_date,dismissal_id,dismissal_reason")
      .eq("property_asset_id", id).order("cost_period", { ascending: false }).order("utility_type").limit(48),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
  ]);
  if (!a || !pd) notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/property/${id}`, "/property", "/liabilities", "/income-expenses"];
  const canSettle = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const leases = (leaseRows as Lease[] | null) ?? [];
  const rents = (rentRows as Rent[] | null) ?? [];
  const bankList = banks ?? [];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const liveLeases = leases.filter((l) => ["ACTIVE", "EXPIRING_SOON", "UPCOMING"].includes(l.lease_status));
  const carryOptions = leases
    .filter((l) => Number(l.security_deposit ?? 0) > 0 && !l.deposit_settled_date)
    .map((l) => ({ id: l.id, label: [l.unit_label, l.tenant_name, `ถึง ${thDate(l.end_date)}`].filter(Boolean).join(" · "),
      deposit: Number(l.security_deposit), currency: l.deposit_currency ?? l.rent_currency }));
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  const utilities = ((pd.property_utilities ?? []) as Util[]).filter((u) => !u.deleted_at);
  const costs = (costRows as Cost[] | null) ?? [];
  const cards = (cardRows ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const yearly = utilities.filter((u) => u.frequency && u.active)
    .reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0)), new Map<string, number>());
  const utilName = (t: string, provider: string | null) => [UTIL_LABEL[t] ?? t, provider].filter(Boolean).join(" · ");
  const isRental = pd.usage_type === "RENTAL" || liveLeases.length > 0;
  // ประวัติรับค่าเช่า / จ่ายค่าใช้จ่ายประจำ (แก้ / ลบ ที่หน้านี้)
  const utilIds = ((pd.property_utilities ?? []) as Util[]).map((u) => u.id);
  const [{ data: rentPaid }, { data: costPaid }, { data: taxRaw }] = await Promise.all([
    supabase.from("income_transactions").select("id,date,income_period,income_type,amount,tax,currency,received_to_asset_id,notes,lease_id")
      .eq("asset_id", id).not("lease_id", "is", null).is("deleted_at", null).order("date", { ascending: false }).limit(60),
    utilIds.length ? supabase.from("expense_items").select("id,date,cost_period,description,amount,currency,paid_from_asset_id,paid_from_credit_card_id,property_utility_id,notes")
      .in("property_utility_id", utilIds).is("deleted_at", null).order("date", { ascending: false }).limit(60) : Promise.resolve({ data: [] as never[] }),
    supabase.from("v_property_tax_lines").select("*").eq("asset_id", id).order("tax_year", { ascending: false }).order("sort_order").order("created_at"),
  ]);
  // ภาษีที่ดิน: เลือกปี (?ty=) · ค่าเริ่มต้น = ปีปัจจุบัน · ปีที่มีข้อมูล + ปีปัจจุบัน + ปีหน้า
  type TaxRow = TaxLine & { tax_year: number; land_value: number; building_value: number; depreciation: number; total_value: number;
    taxable_value: number; tax_full: number; tax_amount: number };
  const taxAll = (taxRaw ?? []) as TaxRow[];
  const curYear = Number(today.slice(0, 4));
  const taxYears = [...new Set([curYear + 1, curYear, ...taxAll.map((t) => Number(t.tax_year))])].sort((x, y) => y - x);
  const ty = taxYears.includes(Number(sp.ty)) ? Number(sp.ty) : curYear;
  const taxLines = taxAll.filter((t) => Number(t.tax_year) === ty);
  const prevTaxYear = taxYears.filter((y) => y < ty && taxAll.some((t) => Number(t.tax_year) === y))[0];
  const taxSum = (k: keyof TaxRow) => taxLines.reduce((t2, x) => t2 + Number(x[k] ?? 0), 0);
  const suggestRate = taxLines.at(-1)?.rate_pct ?? taxAll.find((t) => prevTaxYear != null && Number(t.tax_year) === prevTaxYear)?.rate_pct
    ?? LAND_TAX_RATE_BY_USAGE[pd.usage_type] ?? 0.3;
  const bankName = new Map(bankList.map((b) => [b.asset_id as string, b.name as string]));
  const cardName = new Map(cards.map((c) => [c.id, c.label]));
  const utilById = new Map(utilities.map((u) => [u.id, u]));
  const leaseName = new Map(leases.map((l) => [l.id, [l.unit_label, l.tenant_name].filter(Boolean).join(" · ")]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/property" className="text-sm text-slate-500 hover:underline">← Property</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{a.name}</h1>
            <p className="text-sm text-slate-500">
              {PROPERTY_TYPE_LABEL[pd.property_type] ?? pd.property_type} · {USAGE_LABEL[pd.usage_type] ?? pd.usage_type}
              {pd.location_group && ` · ${pd.location_group}`} · {a.currency}
            </p>
          </div>
          {canWrite && a.status === "ACTIVE" && (
            <ActionBar>
              <PayAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} />
              <SellAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} hasLease={liveLeases.length > 0} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs text-slate-500">มูลค่าล่าสุด</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
            <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>
              ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}
            </div>
            {a.acquisition_cost != null && (
              <div className="mt-1 text-xs text-slate-500">ราคาที่ได้มา {money(a.acquisition_cost, undefined, 0)}{a.acquisition_date && ` (${thDate(a.acquisition_date)})`}</div>
            )}
          </div>
          <div className="flex-1">
            <EntityDocuments entityType="ASSET" entityId={id} module="PROPERTY" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ประเภท / การใช้งาน">{PROPERTY_TYPE_LABEL[pd.property_type] ?? pd.property_type} · {USAGE_LABEL[pd.usage_type] ?? pd.usage_type}</Item>
                <Item label="เนื้อที่">{landText(pd.land_area_sq_wa)}</Item>
                <Item label="กลุ่มทำเล">{pd.location_group || "-"}</Item>
                <Item label="เอกสารสิทธิ์">{[pd.title_type, pd.title_deed_no && `เลขที่ ${pd.title_deed_no}`].filter(Boolean).join(" · ") || "-"}
                  {(pd.deed_book || pd.deed_page) && <span className="block text-xs text-slate-500">{[pd.deed_book && `เล่ม ${pd.deed_book}`, pd.deed_page && `หน้า ${pd.deed_page}`].filter(Boolean).join(" · ")}</span>}</Item>
                <Item label="เลขที่ดิน / ระวาง / หน้าสำรวจ">{[pd.land_no, pd.map_sheet && `ระวาง ${pd.map_sheet}`, pd.survey_page && `หน้าสำรวจ ${pd.survey_page}`].filter(Boolean).join(" · ") || "-"}</Item>
                <Item label="ตำบล / อำเภอ / จังหวัด">{[pd.subdistrict, pd.district, pd.province].filter(Boolean).join(" · ") || "-"}</Item>
                <Item label="วันที่ได้มา / ราคาที่ได้มา">{a.acquisition_date ? thDate(a.acquisition_date) : "-"} · {money(a.acquisition_cost, undefined, 0)}</Item>
                <Item label="สถานะ">{ASSET_STATUS_LABEL[a.status] ?? a.status}</Item>
                <Item label="เจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {pd.address && <Item label="ที่อยู่" wide>{pd.address}</Item>}
                {a.notes && <Item label="หมายเหตุ" wide>{a.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <p className="text-xs text-slate-500">แก้เฉพาะข้อมูล ไม่กระทบมูลค่า (อัปเดตมูลค่าที่กล่อง &ldquo;มูลค่า&rdquo;)</p>
                <EditPropertyForm p={{ ...pd, name: a.name, notes: a.notes, acquisition_date: a.acquisition_date,
                  acquisition_cost: a.acquisition_cost, asset_id: id }} />
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะทรัพย์สิน"
                    options={[["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["GIFTED", "ยกให้แล้ว"], ["LOST", "สูญหาย / เสียหาย"]]}
                    remove={canDelete ? { kind: "asset", id, redirectTo: "/property", paths: ["/property"], label: "ลบทรัพย์สินนี้",
                      hint: "สัญญาเช่า มูลค่า และสาธารณูปโภคจะถูกลบด้วย · ลบไม่ได้ถ้ามีค่าเช่า / เงินประกันที่บันทึกแล้ว" } : undefined} />
                </div>
              </div>
            } />
        </div>
      </section>

      <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
        paths={paths} canWrite={canWrite} canDelete={canDelete} />

      {/* ---------------- มูลค่า: อัปเดต + ประวัติ ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">มูลค่า</h2>
        {canWrite && a.status === "ACTIVE" && (
          <>
            <p className="mb-3 text-xs text-slate-500">อัปเดตมูลค่า · แนะนำประเมินใหม่อย่างน้อยทุก 90 วัน (หรือเมื่อมีการประเมินจากธนาคาร)</p>
            <ValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} />
          </>
        )}
        <h3 className="mb-2 mt-5 text-sm font-medium text-slate-700">ประวัติมูลค่า</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">วันที่</th><th className="text-right">มูลค่า</th><th className="pl-4">วิธี</th><th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                <td className="pl-4">{METHOD_LABEL[v.valuation_method] ?? v.valuation_method}</td>
                <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                <td className="pl-4 text-slate-500">{v.notes}</td>
                <td className="pl-2 text-right">
                  {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                    fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                      { name: "value", label: "มูลค่า", type: "number", value: v.value },
                      { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------------- สัญญาเช่า ---------------- */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">สัญญาเช่า</h2>
          {canWrite && (
            <NewLeaseForm assetId={id} banks={bankList} goLive={goLive} currency={a.currency} carryOptions={carryOptions}
              label={leases.length === 0 ? "+ เริ่มให้เช่า (เพิ่มสัญญา)" : "+ สัญญาใหม่ / ต่อสัญญา"} />
          )}
        </div>
        {!isRental && leases.length === 0 && (
          <p className="text-sm text-slate-500">
            ทรัพย์สินนี้{USAGE_LABEL[pd.usage_type] ?? ""} — ไม่ต้องมีสัญญาเช่า (ไม่นับว่าข้อมูลขาด)
          </p>
        )}
        {canWrite && pd.usage_type === "RENTAL" && liveLeases.length === 0 && <SuggestVacant assetId={id} />}

        {leases.map((l) => {
          const st = LEASE_STATUS[l.lease_status];
          const dep = Number(l.security_deposit ?? 0);
          const ds = DEPOSIT_LABEL[l.deposit_status];
          const leaseEnded = l.deposit_due_date <= today;
          return (
            <div key={l.id} className="rounded-lg border border-slate-200 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? l.lease_status}</span>
                <span className="font-medium">{[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}</span>
                {l.contract_no && <span className="text-xs text-slate-500">สัญญาเลขที่ {l.contract_no}</span>}
              </div>
              <div className="mt-1 text-slate-600">
                {thDate(l.start_date)} – {thDate(l.end_date)}
                {l.terminated_date && <span className="text-red-600"> · เลิก {thDate(l.terminated_date)}</span>}
                {" · "}ค่าเช่า {money(l.rent_amount, l.rent_currency)} {FREQ_LABEL[l.payment_frequency] ?? ""}
                {l.payment_due_day && ` · จ่ายทุกวันที่ ${l.payment_due_day}`}
              </div>
              {dep > 0 && (
                <div className="mt-1">
                  เงินประกัน {money(dep, l.deposit_currency ?? undefined)}
                  {l.deposit_carried_amount && <span className="text-slate-500"> (ยกมา {money(l.deposit_carried_amount)})</span>}
                  {" · "}<span className={ds?.cls}>{ds?.text ?? l.deposit_status}</span>
                  {l.deposit_received_date && l.deposit_received_date < goLive && l.deposit_status !== "SETTLED" &&
                    <span className="text-xs text-slate-500"> · รับก่อน Go-live = อยู่ในยอดตั้งต้น</span>}
                  {l.deposit_settlement_type === "REFUNDED" &&
                    <span className="text-xs text-slate-500"> · คืน {money(l.deposit_refunded_amount)} เมื่อ {thDate(l.deposit_settled_date)}</span>}
                  {l.deposit_settlement_type === "CARRIED_TO_NEW_LEASE" &&
                    <span className="text-xs text-slate-500"> · ยกไปสัญญาใหม่ {thDate(l.deposit_settled_date)}</span>}
                </div>
              )}
              {l.notes && <div className="mt-1 whitespace-pre-line text-xs text-slate-500">{l.notes}</div>}
              <div className="mt-2 flex flex-wrap gap-4">
                {canWrite && l.status === "ACTIVE" && l.end_date > today && (
                  <TerminateLeaseForm assetId={id} leaseId={l.id} today={today} startDate={l.start_date} />
                )}
                {canWrite && (
                  <RowActions table="property_leases" id={l.id} paths={paths} canDelete={false} fields={[
                    { name: "tenant_name", label: "ผู้เช่า", value: l.tenant_name },
                    { name: "unit_label", label: "ห้อง", value: l.unit_label, width: "w-24" },
                    { name: "contract_no", label: "เลขสัญญา", value: l.contract_no, width: "w-24" },
                    { name: "end_date", label: "สิ้นสุด", type: "date", value: l.end_date },
                    { name: "rent_amount", label: "ค่าเช่า", type: "number", value: l.rent_amount },
                    { name: "payment_due_day", label: "จ่ายวันที่", type: "number", value: l.payment_due_day, width: "w-16" },
                    { name: "notes", label: "หมายเหตุ", value: l.notes, width: "w-40" }]} />
                )}
                {canDelete && <DeleteEntity kind="lease" id={l.id} paths={paths} label="ลบสัญญา" needReason={false}
                  hint="รายการรับเงินประกันของสัญญานี้จะถูกลบด้วย" />}
                {canSettle && dep > 0 && !l.deposit_settled_date && leaseEnded && (
                  <SettleDepositForm assetId={id} leaseId={l.id} deposit={dep} currency={l.deposit_currency ?? l.rent_currency}
                    banks={bankList} minDate={l.deposit_due_date} today={today} />
                )}
                {canSettle && l.deposit_settlement_type === "REFUNDED" && (
                  <UndoButton kind="DEPOSIT" id={l.id} paths={paths} label="ยกเลิกการคืนเงินประกัน"
                    confirmText={`ยกเลิกการคืนเงินประกันของ ${l.tenant_name}?\nเงินคืนผู้เช่า และรายได้ส่วนที่หักไว้ จะถูกลบ · สัญญากลับมาถือเงินประกัน (หนี้สิน) เหมือนเดิม`} />
                )}
              </div>
              {dep > 0 && !l.deposit_settled_date && !leaseEnded && (
                <p className="mt-1 text-xs text-slate-400">คืนเงินประกันได้ตั้งแต่ {thDate(l.deposit_due_date)}</p>
              )}
            </div>
          );
        })}

      </section>

      {rents.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">ค่าเช่าที่ควรได้ vs ได้รับจริง</h2>
          <p className="mb-3 text-xs text-slate-500">นับตั้งแต่เดือน Go-live · การบันทึกรับจะสร้างรายได้ค่าเช่าและเงินเข้าบัญชีให้</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">งวด</th><th>สัญญา</th><th className="text-right">ควรได้</th><th className="text-right">ได้รับ</th>
                <th className="pl-4">สถานะ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rents.map((r) => (
                <tr key={`${r.lease_id}-${r.income_period}`} className="align-top">
                  <td className="py-1.5">{thMonth(r.income_period)}</td>
                  <td className="text-xs text-slate-600">{r.name.split(" · ").slice(1).join(" · ")}<div className="text-slate-400">ครบ {thDate(r.due_date)}</div></td>
                  <td className="text-right tabular-nums">{money(r.expected_amount)}</td>
                  <td className="text-right tabular-nums">{Number(r.received_amount) > 0 ? money(r.received_amount) : "-"}</td>
                  <td className={`pl-4 ${RENT_STATUS[r.status]?.cls ?? ""}`}>{RENT_STATUS[r.status]?.text ?? r.status}</td>
                  <td className="text-right">
                    {canWrite && (r.status === "OVERDUE" || r.status === "PENDING") && (
                      <RecordRentForm assetId={id} leaseId={r.lease_id} period={r.income_period}
                        expected={Number(r.expected_amount) - Number(r.received_amount)} currency={r.currency}
                        banks={bankList} today={today} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(rentPaid ?? []).length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">ประวัติรับค่าเช่า</h2>
          <p className="mb-3 text-xs text-slate-500">กดที่แถวเพื่อแก้ไข / ลบ · ลบแล้วงวดนั้นกลับเป็น &ldquo;รอรับ&rdquo; · บันทึกผิดบัญชี ให้ลบแล้วบันทึกรับใหม่ · งวดที่ปิดแล้วต้อง Reopen ก่อน</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่รับ</th><th>งวด</th><th>สัญญา</th><th className="text-right">ยอด</th><th className="pl-4">เข้าบัญชี</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(rentPaid ?? []).map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1.5">{thDate(r.date)}</td>
                  <td>{r.income_type === "RENT" ? thMonth(r.income_period) : <span className="text-xs text-slate-500">หักจากเงินประกัน</span>}</td>
                  <td className="text-xs text-slate-600">{leaseName.get(r.lease_id as string) ?? "-"}{r.notes && <div className="text-slate-400">{r.notes}</div>}</td>
                  <td className="text-right tabular-nums">{money(r.amount, r.currency)}{Number(r.tax ?? 0) > 0 && <div className="text-xs text-slate-500">ภาษี {money(r.tax)}</div>}</td>
                  <td className="pl-4 text-xs text-slate-600">{r.received_to_asset_id ? bankName.get(r.received_to_asset_id) ?? "บัญชี" : "ไม่ผ่านบัญชี"}</td>
                  <td className="pl-2 text-right">
                    {r.income_type !== "RENT" && <span className="text-xs text-slate-400">ยกเลิกที่ &ldquo;ยกเลิกการคืนเงินประกัน&rdquo; ในสัญญา</span>}
                    {canWrite && r.income_type === "RENT" && <RowActions table="income_transactions" id={r.id} paths={paths} canDelete={canDelete}
                      fields={rentIncomeFields(r)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------- ภาษีที่ดินและสิ่งปลูกสร้าง ---------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ภาษีที่ดินและสิ่งปลูกสร้าง</h2>
            <p className="text-xs text-slate-500">ที่ดิน + สิ่งปลูกสร้าง (หักค่าเสื่อม) − ยกเว้น = ฐานภาษี × อัตรา − ส่วนลด · ปีปัจจุบันตั้งเป็นยอดประมาณ &ldquo;ภาษีที่ดิน&rdquo; ในค่าใช้จ่ายประจำให้</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
              {taxYears.map((y) => (
                <Link key={y} href={`/property/${id}?ty=${y}`} scroll={false}
                  className={`px-3 py-1.5 ${y === ty ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>{y + 543}</Link>
              ))}
            </div>
            {canWrite && taxLines.length === 0 && prevTaxYear != null && <CopyTaxYear assetId={id} from={prevTaxYear} to={ty} />}
            {canWrite && <TaxLineForm assetId={id} year={ty} label="+ เพิ่มรายการ" primary
              defaults={{ rate_pct: Number(suggestRate), land_sq_wa: taxLines.some((t) => t.land_sq_wa != null) ? null : pd.land_area_sq_wa,
                sort_order: taxLines.length + 1 }} />}
          </div>
        </div>
        {taxLines.length === 0 ? (
          <p className="text-sm text-slate-500">ยังไม่มีข้อมูลภาษีปี {ty + 543}{prevTaxYear != null ? ` · กด "คัดลอกจากปี ${prevTaxYear + 543}" เพื่อใช้ข้อมูลและอัตราเดิม แล้วแก้เฉพาะที่เปลี่ยน` : ` · อัตราที่ระบบเสนอตามการใช้งาน "${USAGE_LABEL[pd.usage_type] ?? pd.usage_type}" = ${LAND_TAX_RATE_BY_USAGE[pd.usage_type] ?? 0.3}%`}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-2 py-2">รายการ</th><th className="px-2 text-right">ที่ดิน</th><th className="px-2 text-right">สิ่งปลูกสร้าง (หลังหักค่าเสื่อม)</th>
                  <th className="px-2 text-right">รวมราคาประเมิน</th><th className="px-2 text-right">ยกเว้น</th><th className="px-2 text-right">ฐานภาษี</th>
                  <th className="px-2 text-right">อัตรา</th><th className="px-2 text-right">ภาษี</th><th className="px-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxLines.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="px-2 py-2">{t.description || "-"}{t.building_type && <div className="text-xs text-slate-500">{t.building_type}</div>}
                      {t.notes && <div className="text-xs text-slate-400">{t.notes}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(t.land_value) > 0 ? money(t.land_value) : "-"}
                      {t.land_sq_wa != null && <div className="text-xs text-slate-500">{landText(t.land_sq_wa)} × {money(t.land_price_per_sq_wa)}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(t.building_value) > 0 ? money(t.building_value) : "-"}
                      {t.building_sqm != null && <div className="text-xs text-slate-500">{Number(t.building_sqm).toLocaleString("th-TH")} ตร.ม. × {money(t.building_price_per_sqm)}
                        {Number(t.depreciation_pct) > 0 && ` − ${Number(t.depreciation_pct)}%`}{t.building_age != null && ` · อายุ ${t.building_age} ปี`}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(t.total_value)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(t.exemption) !== 0 ? money(-Number(t.exemption)) : "-"}
                      {t.exemption_reason && <div className="text-xs text-slate-500">{t.exemption_reason}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(t.taxable_value)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{Number(t.rate_pct)}%
                      {Number(t.discount_pct) > 0 && <div className="text-xs text-slate-500">ลด {Number(t.discount_pct)}%</div>}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{money(t.tax_amount)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {canWrite && <TaxLineForm assetId={id} year={ty} line={t} label="แก้ไข" />}
                      {canDelete && <span className="ml-3"><DeleteTaxLine assetId={id} year={ty} id={t.id} label={t.description || "รายการ"} /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                <tr><td className="px-2 py-2">รวมปี {ty + 543}</td><td className="px-2 text-right tabular-nums">{money(taxSum("land_value"))}</td>
                  <td className="px-2 text-right tabular-nums">{money(taxSum("building_value"))}</td><td className="px-2 text-right tabular-nums">{money(taxSum("total_value"))}</td>
                  <td className="px-2 text-right tabular-nums">{money(-taxSum("exemption"))}</td><td className="px-2 text-right tabular-nums">{money(taxSum("taxable_value"))}</td>
                  <td></td><td className="px-2 text-right tabular-nums">{money(taxSum("tax_amount"))}</td><td></td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- ค่าใช้จ่ายประจำ / สาธารณูปโภค ---------------- */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ค่าใช้จ่ายประจำ / สาธารณูปโภค</h2>
            {[...yearly.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
              <p key={ccy} className="text-xs text-slate-500">ประมาณการต่อปี <span className="font-medium tabular-nums text-slate-700">{money(v, ccy, 0)}</span></p>
            ))}
          </div>
          {canWrite && <UtilityForm assetId={id} propertyId={pd.id} currency={a.currency} />}
        </div>
        {utilities.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล · เพิ่มค่าส่วนกลาง ภาษีที่ดิน ไฟ น้ำ พร้อมยอดประมาณเพื่อติดตามการจ่าย</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">รายการ</th><th className="text-right">ยอดประมาณ</th><th className="pl-4">กำหนดจ่าย</th><th className="pl-4">ข้อมูลอ้างอิง</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {utilities.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-1.5">{utilName(u.utility_type, u.provider)}</td>
                  <td className="text-right tabular-nums">{u.expected_amount != null ? money(u.expected_amount, u.currency) : <span className="text-slate-400">ไม่ติดตาม</span>}</td>
                  <td className="pl-4 text-slate-600">{scheduleText(u.frequency, u.due_day, u.due_month) || "-"}</td>
                  <td className="pl-4 text-xs text-slate-500">
                    {[u.account_no && `เลขที่ผู้ใช้ ${u.account_no}`, u.meter_no && `มิเตอร์ ${u.meter_no}`, u.notes].filter(Boolean).join(" · ")}
                  </td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="property_utilities" id={u.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "provider", label: "ผู้ให้บริการ / ผู้เก็บ", value: u.provider },
                      { name: "expected_amount", label: "ยอดประมาณ", type: "number", value: u.expected_amount, width: "w-28" },
                      { name: "frequency", label: "จ่าย", type: "select", value: u.frequency ?? "", options: [["", "ไม่ติดตาม"],
                        ["MONTHLY", FREQ_LABEL.MONTHLY], ["QUARTERLY", FREQ_LABEL.QUARTERLY], ["YEARLY", FREQ_LABEL.YEARLY]] },
                      { name: "due_month", label: "เดือน (รายปี/3 เดือน)", type: "select", value: u.due_month ?? "",
                        options: [["", "-"], ...TH_MONTHS.map((m, i) => [String(i + 1), m] as [string, string])] },
                      { name: "due_day", label: "ทุกวันที่", type: "number", value: u.due_day, width: "w-16" },
                      { name: "account_no", label: "เลขที่ผู้ใช้", value: u.account_no }, { name: "meter_no", label: "มิเตอร์", value: u.meter_no },
                      { name: "notes", label: "หมายเหตุ", value: u.notes }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {costs.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">ประมาณ vs จ่ายจริง</h3>
            <p className="mb-2 text-xs text-slate-500">นับตั้งแต่เดือน Go-live · บันทึกจ่ายแล้วจะเข้าหน้า Income &amp; Expenses และหักจากบัญชีที่เลือกให้</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">งวด</th><th>รายการ</th><th className="text-right">ประมาณ</th><th className="text-right">จ่ายจริง</th>
                  <th className="text-right">ส่วนต่าง</th><th className="pl-4">สถานะ</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {costs.map((c) => (
                  <tr key={`${c.utility_id}-${c.cost_period}`} className="align-top">
                    <td className="py-1.5">{thMonth(c.cost_period)}<div className="text-xs text-slate-400">ครบ {thDate(c.due_date)}</div></td>
                    <td>{utilName(c.utility_type, c.provider)}</td>
                    <td className="text-right tabular-nums">{money(c.expected_amount)}</td>
                    <td className="text-right tabular-nums">{Number(c.paid_amount) > 0 ? money(c.paid_amount) : "-"}</td>
                    <td className={`text-right tabular-nums ${c.status === "PAID" && Number(c.gap) < 0 ? "text-red-700" : c.status === "PAID" && Number(c.gap) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {c.status === "PAID" ? money(-Number(c.gap)) : "-"}
                    </td>
                    <td className={`pl-4 ${COST_STATUS[c.status]?.cls ?? ""}`}>{COST_STATUS[c.status]?.text ?? c.status}
                      {c.status === "DISMISSED" && <div className="text-xs text-slate-400">{c.dismissal_reason}</div>}</td>
                    <td className="text-right">
                      {canDelete && c.status === "DISMISSED" && c.dismissal_id && <UndoDismissButton id={c.dismissal_id} />}
                      {canWrite && c.status !== "PAID" && c.status !== "DISMISSED" && (
                        <RecordCostForm assetId={id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
                          label={`${utilName(c.utility_type, c.provider)} · ${a.name} (${thMonth(c.cost_period)})`}
                          category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
                          banks={bankList} cards={cards} persons={persons ?? []} today={today} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(costPaid ?? []).length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">ประวัติจ่าย</h3>
            <p className="mb-2 text-xs text-slate-500">กดที่แถวเพื่อแก้ไข / ลบ · ลบแล้วงวดนั้นกลับเป็น &ldquo;รอจ่าย&rdquo; · งวดที่ปิดแล้วต้อง Reopen ก่อน</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">วันที่จ่าย</th><th>งวด</th><th>รายการ</th><th className="text-right">ยอด</th><th className="pl-4">จ่ายด้วย</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(costPaid ?? []).map((e) => {
                  const u = utilById.get(e.property_utility_id as string);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="py-1.5">{thDate(e.date)}</td>
                      <td>{e.cost_period ? thMonth(e.cost_period) : "-"}</td>
                      <td className="text-xs text-slate-600">{u ? utilName(u.utility_type, u.provider) : e.description}{e.notes && <div className="text-slate-400">{e.notes}</div>}</td>
                      <td className="text-right tabular-nums">{money(e.amount, e.currency)}</td>
                      <td className="pl-4 text-xs text-slate-600">
                        {e.paid_from_asset_id ? bankName.get(e.paid_from_asset_id) ?? "บัญชี" : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด"}
                      </td>
                      <td className="pl-2 text-right">
                        {canWrite && <RowActions table="expense_items" id={e.id} paths={paths} canDelete={canDelete}
                          fields={propertyCostFields(e)} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}

const ASSET_STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย / เสียหาย", CLOSED: "ปิดแล้ว" };

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
