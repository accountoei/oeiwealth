import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  COST_STATUS, ENCUMBRANCE_LABEL, MARKET_UNIT_LABEL, REBILL_SUBTYPE, UTILITIES_BILLING_LABEL, FREQ_LABEL, LAND_TAX_RATE_BY_USAGE, landTaxYears, LEASE_STATUS, PERIODS_PER_YEAR, PROPERTY_TYPE_LABEL, TH_MONTHS, USAGE_LABEL, UTIL_EXPENSE_CATEGORY,
  UTIL_LABEL, addDays, durationText, landText, money, monthsBetween, scheduleText, thDate, thMonth, todayBangkok, vacancyWarning,
} from "@/lib/format";
import {
  DeedForm, EditPropertyForm, NewLeaseForm, type Deed, RecordCostForm, ReceiveChargeForm, RecordRentForm, SettleDepositForm, SuggestVacant, TerminateLeaseForm,
  UtilityForm,
} from "./forms";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import EditToggle from "@/components/EditToggle";
import { CopyTaxYear, TaxLineForm, TaxYearSelect, type TaxLine } from "./LandTax";
import { WithStatus } from "@/components/StatusSelect";
import ModalButton from "@/components/ModalButton";
import { PayAssetForm, SellAssetForm } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import MarketBox from "../MarketBox";
import TargetBox, { CostLotsSection, type TargetPrice } from "../TargetBox";
import PropertyPaymentForm from "../PropertyPaymentForm";
import ValuePartsForm, { type DeedOpt } from "../ValuePartsForm";
import type { ValuePart } from "../valueParts";
import type { CostLot } from "../CostItemForm";
import type { MarketValuation } from "../MarketValuationForm";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { UndoDismissButton } from "@/app/(app)/income-expenses/forms";
import { propertyCostFields, rentIncomeFields } from "@/lib/source-edit";
import { endpointValue } from "@/lib/money-endpoint";
import { DetailItem as Item } from "@/components/Boxes";

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
  due_day: number | null; due_month: number | null; active: boolean; paid_from_asset_id: string | null; paid_from_credit_card_id: string | null };
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
    { data: banks }, { data: family }, { data: persons }, { data: costRows }, { data: cardRows }, { data: marketRows }, { data: debtRows }, { data: lotRows }, { data: targetRow }, { data: partRows }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("property_details").select("*, property_utilities(id,utility_type,provider,account_no,meter_no,notes,deleted_at,expected_amount,currency,frequency,due_day,due_month,active,paid_from_asset_id,paid_from_credit_card_id), property_deeds(id,sort_order,title_type,title_deed_no,land_no,deed_book,deed_page,map_sheet,survey_page,land_area_sq_wa,notes,created_at,deleted_at)")
      .eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,valuation_method,source,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("v_lease_status").select("*").eq("property_asset_id", id).order("start_date", { ascending: false }),
    supabase.from("v_lease_rent_tracking").select("*").eq("property_asset_id", id)
      .order("income_period", { ascending: false }).limit(36),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_property_cost_tracking").select("utility_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,gap,currency,status,last_paid_date,dismissal_id,dismissal_reason")
      .eq("property_asset_id", id).order("cost_period", { ascending: false }).order("utility_type").limit(48),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    // ราคาตลาด (อ้างอิง · ไม่นับใน Net Worth) · หนี้ที่ผูกกับทรัพย์สินนี้ → สุทธิหลังปิดหนี้
    supabase.from("v_property_market_valuations").select("*").eq("asset_id", id)
      .order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("liabilities").select("outstanding_amount,currency").eq("linked_asset_id", id).eq("status", "ACTIVE").is("deleted_at", null),
    // ราคาขายขั้นต่ำที่คุ้ม (ต้นทุน + ดอกเบี้ย − ค่าเสื่อม · ไม่นับใน Net Worth)
    supabase.from("v_property_cost_lots").select("*").eq("asset_id", id).order("lot_date"),
    supabase.from("v_property_target_price").select("*").eq("asset_id", id).maybeSingle(),
    // มูลค่าแยกตามโฉนด / อาคาร (รายละเอียดของมูลค่าแต่ละครั้ง · Net Worth ใช้ยอดรวม)
    supabase.from("asset_valuation_parts").select("valuation_id,part_type,deed_id,label,value,sort_order,source_movement_id")
      .eq("asset_id", id).is("deleted_at", null).order("sort_order"),
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
  const debtSame = (debtRows ?? []).filter((l) => l.currency === a.currency);
  const debt = debtSame.length ? debtSame.reduce((t, l) => t + Number(l.outstanding_amount ?? 0), 0) : null;
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  const utilities = ((pd.property_utilities ?? []) as Util[]).filter((u) => !u.deleted_at);
  // โฉนด / เอกสารสิทธิ์ (หลายใบได้ · ตกลง 27 ต.ค. 2026) · เนื้อที่ของทรัพย์สิน = ผลรวม
  const deeds = ((pd.property_deeds ?? []) as (Deed & { sort_order: number; created_at: string; deleted_at: string | null })[])
    .filter((d) => !d.deleted_at).sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at));
  const deedLabel = (d: Deed, i: number) => [d.title_type, d.title_deed_no && `เลขที่ ${d.title_deed_no}`].filter(Boolean).join(" ") || `โฉนดใบที่ ${i + 1}`;
  const deedOpts: DeedOpt[] = deeds.map((d, i) => ({ id: d.id, label: deedLabel(d, i), area: d.land_area_sq_wa != null ? Number(d.land_area_sq_wa) : null }));
  const partsKey = `${deeds.map((d) => d.id).join(",")}|${vals?.[0]?.id ?? ""}`;   // เพิ่มโฉนด / มูลค่าใหม่ → ตั้งแถวฟอร์มใหม่
  const deedName = new Map(deedOpts.map((d) => [d.id, d.label]));
  const partText = (vid: string) => allParts.filter((p) => p.valuation_id === vid)
    .map((p) => `${p.part_type === "DEED" ? deedName.get(p.deed_id ?? "") ?? "โฉนด" : p.label || (p.part_type === "BUILDING" ? "อาคาร" : "อื่น ๆ")} ${money(p.value, undefined, 0)}`).join(" · ");
  const costs = (costRows as Cost[] | null) ?? [];
  const lots = (lotRows ?? []) as CostLot[];
  // มูลค่าแยกส่วน: ของมูลค่าล่าสุด (ค่าตั้งต้นฟอร์ม + คอลัมน์ในตารางโฉนด) และสรุปต่อครั้งในประวัติ
  type PartRow = { valuation_id: string; part_type: ValuePart["type"]; deed_id: string | null; label: string | null; value: number; source_movement_id: string | null };
  const allParts = (partRows ?? []) as PartRow[];
  const toPart = (p: PartRow): ValuePart => ({ type: p.part_type, deed_id: p.deed_id, label: p.label, value: Number(p.value), source_movement_id: p.source_movement_id });
  const latestParts = vals?.[0] ? allParts.filter((p) => p.valuation_id === vals[0].id).map(toPart) : [];
  const cards = (cardRows ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const yearly = utilities.filter((u) => u.frequency && u.active)
    .reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0)), new Map<string, number>());
  const utilName = (t: string, provider: string | null) => [UTIL_LABEL[t] ?? t, provider].filter(Boolean).join(" · ");
  const isRental = pd.usage_type === "RENTAL" || liveLeases.length > 0;
  // ที่ว่าง: ระยะเวลาที่ว่าง + ประวัติช่วงที่เคยว่าง
  const vacantMonths = pd.usage_type === "VACANT" && pd.vacant_since ? monthsBetween(pd.vacant_since, today) : 0;
  const vacancyHistory = ((pd.vacancy_history ?? []) as { from: string; to: string; plan: string | null }[]).slice().reverse();
  // ประวัติรับค่าเช่า / จ่ายค่าใช้จ่ายประจำ (แก้ / ลบ ที่หน้านี้)
  const utilIds = ((pd.property_utilities ?? []) as Util[]).map((u) => u.id);
  const [{ data: rentPaid }, { data: costPaid }, { data: taxRaw }, { data: hasHistory }, { data: rentToRows }, { data: chargeRows }] = await Promise.all([
    supabase.from("income_transactions").select("id,date,income_period,income_type,income_subtype,amount,tax,currency,received_to_asset_id,notes,lease_id")
      .eq("asset_id", id).not("lease_id", "is", null).is("deleted_at", null).order("date", { ascending: false }).limit(60),
    utilIds.length ? supabase.from("expense_items").select("id,date,cost_period,description,amount,currency,paid_from_asset_id,paid_from_credit_card_id,property_utility_id,notes")
      .in("property_utility_id", utilIds).is("deleted_at", null).order("date", { ascending: false }).limit(60) : Promise.resolve({ data: [] as never[] }),
    supabase.from("v_property_tax_lines").select("*").eq("asset_id", id).order("tax_year", { ascending: false }).order("sort_order").order("created_at"),
    // มีรายการแล้ว (ซื้อ / ขาย / มูลค่ามากกว่า 1 ครั้ง) → ลบไม่ได้ ต้องเปลี่ยนสถานะแทน
    supabase.rpc("asset_has_history", { p_asset_id: id }),
    // บัญชีรับค่าเช่าที่ตั้งไว้ของแต่ละสัญญา (ค่าตั้งต้นตอนบันทึกรับ)
    supabase.from("property_leases").select("id,rent_to_asset_id,utilities_billing").eq("property_id", pd.id).is("deleted_at", null),
    // ค่าน้ำไฟที่เรียกเก็บผู้เช่า (ยังไม่ได้รับ)
    supabase.from("v_lease_utility_charges").select("id,lease_id,cost_period,description,amount,currency,notes,paid_date,paid_amount")
      .eq("property_asset_id", id).eq("status", "PENDING").order("cost_period", { ascending: false }),
  ]);
  type LeaseExtra = { id: string; rent_to_asset_id: string | null; utilities_billing: string | null };
  const leaseExtra = new Map(((rentToRows ?? []) as LeaseExtra[]).map((r) => [r.id, r]));
  const rentTo = new Map([...leaseExtra.values()].filter((r) => r.rent_to_asset_id).map((r) => [r.id, r.rent_to_asset_id as string]));
  const charges = (chargeRows ?? []) as { id: string; lease_id: string; cost_period: string; description: string; amount: number; currency: string;
    notes: string | null; paid_date: string | null; paid_amount: number | null }[];
  // สัญญาที่ "เราจ่ายแล้วเรียกเก็บ" ค่าน้ำไฟ → ติ๊กเรียกเก็บผู้เช่าให้ตอนบันทึกจ่าย
  const rebillLeases = liveLeases.filter((l) => leaseExtra.get(l.id)?.utilities_billing === "REBILL")
    .map((l) => ({ id: l.id, label: [l.unit_label, l.tenant_name].filter(Boolean).join(" · ") }));
  // ไม่ได้ตั้งบัญชีรับค่าเช่า → ใช้บัญชีที่รับครั้งล่าสุดของสัญญานั้น
  const lastRentBank = new Map<string, string>();
  [...(rentPaid ?? [])].reverse().forEach((x) => { if (x.lease_id && x.received_to_asset_id) lastRentBank.set(x.lease_id as string, x.received_to_asset_id as string); });
  const payOpts: [string, string][] = [["", "— ไม่ระบุ —"],
    ...bankList.map((b) => [endpointValue({ kind: "bank", id: b.asset_id }), `บัญชี ${b.name} (${b.currency})`] as [string, string]),
    ...cards.map((c) => [endpointValue({ kind: "card", id: c.id }), `บัตร ${c.label} (${c.currency})`] as [string, string])];
  // ภาษีที่ดิน: เลือกปี (?ty=) · ค่าเริ่มต้น = ปีปัจจุบัน · ปีที่มีข้อมูล + ปีปัจจุบัน + ปีหน้า
  type TaxRow = TaxLine & { tax_year: number; land_value: number; building_value: number; depreciation: number; total_value: number;
    taxable_value: number; tax_full: number; tax_amount: number };
  const taxAll = (taxRaw ?? []) as TaxRow[];
  const curYear = Number(today.slice(0, 4));
  const taxDataYears = [...new Set(taxAll.map((t) => Number(t.tax_year)))];
  const taxYears = landTaxYears(today, taxDataYears);
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

  const deedTable = (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-800">โฉนด / เอกสารสิทธิ์ {deeds.length > 0 && <span className="font-normal text-slate-500">({deeds.length})</span>}</h3>
        {canWrite && <ModalButton label="+ เพิ่มโฉนด" title="เพิ่มโฉนด / เอกสารสิทธิ์"><DeedForm assetId={id} propertyId={pd.id} /></ModalButton>}
      </div>
      {deeds.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูลโฉนด · ซื้อหลายโฉนดพร้อมกันเป็นแปลงเดียว เพิ่มทีละใบได้ (เนื้อที่รวมให้อัตโนมัติ)</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">เอกสารสิทธิ์</th><th>เลขที่ดิน</th><th>เล่ม / หน้า</th><th>ระวาง / หน้าสำรวจ</th><th className="text-right">เนื้อที่</th>{latestParts.length > 0 && <th className="text-right">มูลค่าล่าสุด</th>}<th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deeds.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="py-1.5">{[d.title_type, d.title_deed_no && `เลขที่ ${d.title_deed_no}`].filter(Boolean).join(" ") || "-"}
                    {d.notes && <div className="text-xs text-slate-400">{d.notes}</div>}</td>
                  <td>{d.land_no || "-"}</td>
                  <td>{[d.deed_book && `เล่ม ${d.deed_book}`, d.deed_page && `หน้า ${d.deed_page}`].filter(Boolean).join(" · ") || "-"}</td>
                  <td>{[d.map_sheet, d.survey_page && `หน้าสำรวจ ${d.survey_page}`].filter(Boolean).join(" · ") || "-"}</td>
                  <td className="text-right text-xs tabular-nums">{d.land_area_sq_wa != null ? landText(d.land_area_sq_wa) : "-"}</td>
                  {latestParts.length > 0 && <td className="pl-3 text-right tabular-nums">{(() => { const p = latestParts.find((x) => x.type === "DEED" && x.deed_id === d.id); return p ? money(p.value, undefined, 0) : "-"; })()}</td>}
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="property_deeds" id={d.id} paths={paths} canDelete={canDelete} deleteEffect="เนื้อที่รวมของทรัพย์สินจะลดลงตามโฉนดใบนี้"
                      editor={<DeedForm assetId={id} propertyId={pd.id} deed={d} />} />}
                  </td>
                </tr>
              ))}
            </tbody>
            {latestParts.some((x) => x.type !== "DEED") && (
              <tbody className="divide-y divide-slate-100 border-t border-slate-200">
                {latestParts.filter((x) => x.type !== "DEED").map((x, i) => (
                  <tr key={i}><td colSpan={5} className="py-1.5">{x.label || (x.type === "BUILDING" ? "อาคาร" : "อื่น ๆ")}
                    <span className="text-xs text-slate-400"> · {x.type === "BUILDING" ? "อาคาร / สิ่งปลูกสร้าง" : "อื่น ๆ"}</span></td>
                    <td className="pl-3 text-right tabular-nums">{money(x.value, undefined, 0)}</td><td></td></tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );

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
              <PayAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} property />
              <SellAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} hasLease={liveLeases.length > 0} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าล่าสุด</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
            <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>
              ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}
            </div>
            {a.acquisition_cost != null && (
              <div className="mt-1 text-xs text-slate-500">ราคาที่ได้มา {money(a.acquisition_cost, undefined, 0)}{a.acquisition_date && ` (${thDate(a.acquisition_date)})`}</div>
            )}
            {/* ปุ่มเดียว "มูลค่าและต้นทุน": อัปเดตมูลค่า + ประวัติซื้อ / ขาย / มูลค่า + ต้นทุนรายก้อน (ตกลง 28 ต.ค. 2026) */}
            <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
              paths={paths} canWrite={canWrite} canDelete={canDelete} singleLabel="มูลค่าและต้นทุน"
              paymentEditor={(m) => { const lot = lots.find((l) => l.source === "PAYMENT" && l.movement_id === m.id); return (
                <PropertyPaymentForm assetId={id} currency={a.currency} paths={paths} m={m} addedValue={m.add_value}
                  building={!!lot?.is_building} years={lot?.depreciation_years ?? 20} />); }}
              extra={<CostLotsSection assetId={id} currency={a.currency} today={today} lots={lots} canWrite={canWrite && a.status === "ACTIVE"} canDelete={canDelete} paths={paths} />}
              valuations={(vals ?? []).map((v) => ({ ...v, value: Number(v.value), detail: partText(v.id) || null }))} sourceLabel={SOURCE_LABEL} methodLabel={METHOD_LABEL}
              valuationHint="แนะนำประเมินใหม่อย่างน้อยทุก 90 วัน (หรือเมื่อมีการประเมินจากธนาคาร)"
              valuationForm={canWrite && a.status === "ACTIVE" ? <ValuePartsForm key={partsKey} assetId={id} currency={a.currency} today={today} minDate={goLive} deeds={deedOpts} latest={latestParts} /> : undefined} />
            <MarketBox assetId={id} currency={a.currency} today={today} propertyType={pd.property_type}
              areaSqWa={pd.land_area_sq_wa != null ? Number(pd.land_area_sq_wa) : null} nwValue={Number(a.current_value ?? 0)}
              history={(marketRows ?? []) as MarketValuation[]} debt={debt} canWrite={canWrite && a.status === "ACTIVE"} canDelete={canDelete} paths={paths} />
            <TargetBox currency={a.currency} target={(targetRow as TargetPrice | null) ?? null}
              unit={targetUnit(((marketRows ?? []) as MarketValuation[])[0], pd.land_area_sq_wa)} />
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="PROPERTY" entityType="ASSET" entityId={id} module="PROPERTY" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={<>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ประเภท / การใช้งาน">{PROPERTY_TYPE_LABEL[pd.property_type] ?? pd.property_type} · {USAGE_LABEL[pd.usage_type] ?? pd.usage_type}
                  {pd.usage_type === "VACANT" && (pd.vacant_since
                    ? <span className="block text-xs text-slate-500">ว่างมาแล้ว {durationText(vacantMonths)} (ตั้งแต่ {thDate(pd.vacant_since)})</span>
                    : <span className="block text-xs text-amber-700">ยังไม่ได้ใส่วันที่เริ่มว่าง (แก้ไขข้อมูล)</span>)}
                  {vacancyWarning(vacantMonths) && <span className="block text-xs font-medium text-amber-700">{vacancyWarning(vacantMonths)}</span>}</Item>
                {pd.usage_type === "VACANT" && (pd.vacant_plan || pd.vacant_plan_date) && (
                  <Item label="แผน / โครงการ">{pd.vacant_plan ?? "-"}{pd.vacant_plan_date && <span className="block text-xs text-slate-500">กำหนดเริ่ม {thDate(pd.vacant_plan_date)}</span>}</Item>
                )}
                {pd.encumbrance_type && pd.encumbrance_type !== "NONE" && (
                  <Item label="ภาระผูกพัน">{ENCUMBRANCE_LABEL[pd.encumbrance_type] ?? pd.encumbrance_type}
                    {pd.encumbrance_details && <span className="block text-xs text-slate-500">{pd.encumbrance_details}</span>}</Item>
                )}
                {vacancyHistory.length > 0 && (
                  <Item label="ประวัติช่วงที่ว่าง">{vacancyHistory.map((v, i) => (
                    <span key={i} className="block text-xs text-slate-600">{thDate(v.from)} – {thDate(v.to)} ({durationText(monthsBetween(v.from, v.to))}){v.plan && ` · ${v.plan}`}</span>))}</Item>
                )}
                <Item label={deeds.length > 1 ? `เนื้อที่ (รวม ${deeds.length} โฉนด)` : "เนื้อที่"}>{landText(pd.land_area_sq_wa)}</Item>
                <Item label="กลุ่มทำเล">{pd.location_group || "-"}</Item>
                <Item label="ตำบล / อำเภอ / จังหวัด">{[pd.subdistrict, pd.district, pd.province].filter(Boolean).join(" · ") || "-"}</Item>
                <Item label="วันที่ได้มา">{a.acquisition_date ? thDate(a.acquisition_date) : "-"}</Item>
                <Item label="ราคาที่ได้มา" num>{money(a.acquisition_cost, undefined, 0)}</Item>
                <Item label="สถานะ">{ASSET_STATUS_LABEL[a.status] ?? a.status}</Item>
                <Item label="เจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {pd.address && <Item label="ที่อยู่" wide>{pd.address}</Item>}
                {(pd.map_url || pd.latitude != null) && (
                  <Item label="ตำแหน่ง" wide>
                    <div className="flex flex-wrap items-center gap-3">
                      <a href={pd.map_url || `https://www.google.com/maps?q=${Number(pd.latitude)},${Number(pd.longitude)}`} target="_blank" rel="noopener noreferrer"
                        className="rounded-md border border-blue-600 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50">เปิดใน Google Maps ↗</a>
                      {pd.latitude != null && <span className="text-xs tabular-nums text-slate-500">{Number(pd.latitude)}, {Number(pd.longitude)}</span>}
                    </div>
                    {pd.latitude != null && (
                      <iframe title="แผนที่" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                        src={`https://maps.google.com/maps?q=${Number(pd.latitude)},${Number(pd.longitude)}&z=16&output=embed`}
                        className="mt-2 h-56 w-full rounded-lg border border-slate-200" />
                    )}
                  </Item>
                )}
                {a.notes && <Item label="หมายเหตุ" wide>{a.notes}</Item>}
              </dl>
              {deedTable}
            </>}
            edit={
              <div className="space-y-5">
                <p className="text-xs text-slate-500">แก้เฉพาะข้อมูล ไม่กระทบมูลค่า (อัปเดตมูลค่าที่กล่อง &ldquo;มูลค่า&rdquo;)</p>
                <WithStatus status={{ table: "assets", id, value: a.status, paths, label: "สถานะทรัพย์สิน",
                  options: [["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["GIFTED", "ยกให้แล้ว"], ["LOST", "สูญหาย / เสียหาย"]],
                  remove: canDelete && !hasHistory ? { kind: "asset", id, redirectTo: "/property", paths: ["/property"], label: "ลบทรัพย์สินนี้", hint: "สัญญาเช่า มูลค่า และสาธารณูปโภคจะถูกลบด้วย · ลบไม่ได้ถ้ามีค่าเช่า / เงินประกันที่บันทึกแล้ว" } : undefined }}>
                  <EditPropertyForm p={{ ...pd, name: a.name, notes: a.notes, acquisition_date: a.acquisition_date,
                    acquisition_cost: a.acquisition_cost, asset_id: id }} hasDeeds={deeds.length > 0} />
                </WithStatus>
                {/* โฉนด + มูลค่าแยกตามโฉนด / อาคาร ในหน้าแก้ไขเดียวกัน (ตกลง 28 ต.ค. 2026) */}
                {deedTable}
                {canWrite && a.status === "ACTIVE" && (
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-1 text-sm font-medium text-slate-800">อัปเดตมูลค่าแยกตามโฉนด / อาคาร <span className="font-normal text-slate-500">(นับใน Net Worth · เก็บเป็นประวัติ ไม่ทับของเดิม)</span></h3>
                    <p className="mb-2 text-xs text-slate-500">เพิ่มโฉนดที่ปุ่ม &ldquo;+ เพิ่มโฉนด&rdquo; ด้านบนก่อน แล้วใส่มูลค่าของแต่ละใบ</p>
                    <ValuePartsForm key={partsKey} assetId={id} currency={a.currency} today={today} minDate={goLive} deeds={deedOpts} latest={latestParts} />
                  </div>
                )}
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                </div>
                {canDelete && hasHistory && <p className="text-xs text-slate-500">มีประวัติแล้ว (ซื้อ / ขาย หรือมูลค่ามากกว่า 1 ครั้ง) → ลบไม่ได้ · ถ้าไม่ได้ถือแล้ว ให้เปลี่ยนสถานะเป็น ขายแล้ว / ยกให้แล้ว / สูญหาย</p>}
              </div>
            } />
        </div>
      </section>

      {/* ---------------- สัญญาเช่า (แสดงเฉพาะที่ให้เช่า · ไม่ได้ให้เช่าแล้วแต่เคยมีสัญญา → พับเป็นประวัติ · ตกลง 27 ต.ค. 2026) ---------------- */}
      {(isRental || leases.length > 0) && <LeaseWrap open={isRental} count={leases.length}>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">สัญญาเช่า</h2>
          {canWrite && (
            <NewLeaseForm assetId={id} banks={bankList} goLive={goLive} currency={a.currency} carryOptions={carryOptions}
              label={leases.length === 0 ? "+ เริ่มให้เช่า (เพิ่มสัญญา)" : "+ สัญญาใหม่ / ต่อสัญญา"} />
          )}
        </div>
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
                {rentTo.get(l.id) && <span className="text-xs text-slate-500"> · รับเข้า {bankName.get(rentTo.get(l.id)!) ?? "บัญชีที่ปิดแล้ว"}</span>}
                {leaseExtra.get(l.id)?.utilities_billing && <span className="text-xs text-slate-500"> · ค่าน้ำไฟ: {UTILITIES_BILLING_LABEL[leaseExtra.get(l.id)!.utilities_billing!]}</span>}
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
                  <RowActions table="property_leases" id={l.id} paths={paths} canDelete={false}
                    deleteControl={canDelete && <DeleteEntity kind="lease" id={l.id} paths={paths} label="ลบสัญญา" needReason={false}
                      hint="รายการรับเงินประกันของสัญญานี้จะถูกลบด้วย"
                      buttonCls="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50" />} fields={[
                    { name: "tenant_name", label: "ผู้เช่า", value: l.tenant_name },
                    { name: "unit_label", label: "ห้อง", value: l.unit_label, width: "w-24" },
                    { name: "contract_no", label: "เลขสัญญา", value: l.contract_no, width: "w-24" },
                    { name: "end_date", label: "สิ้นสุด", type: "date", value: l.end_date },
                    { name: "rent_amount", label: "ค่าเช่า", type: "number", value: l.rent_amount },
                    { name: "payment_due_day", label: "จ่ายวันที่", type: "number", value: l.payment_due_day, width: "w-16" },
                    { name: "rent_to_asset_id", label: "บัญชีรับค่าเช่า", type: "select", value: rentTo.get(l.id) ?? "",
                      options: [["", "— ไม่ระบุ (ใช้บัญชีที่รับครั้งล่าสุด) —"], ...bankList.filter((b) => b.currency === l.rent_currency).map((b) => [b.asset_id, b.name] as [string, string])] },
                    { name: "utilities_billing", label: "ค่าน้ำ / ค่าไฟ", type: "select", value: leaseExtra.get(l.id)?.utilities_billing ?? "",
                      options: [["", "— ไม่ระบุ —"], ...Object.entries(UTILITIES_BILLING_LABEL) as [string, string][]] },
                    { name: "notes", label: "หมายเหตุ", value: l.notes, width: "w-40" }]} />
                )}
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
                        banks={bankList} today={today} defaultBank={rentTo.get(r.lease_id) ?? lastRentBank.get(r.lease_id)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {charges.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">ค่าน้ำไฟเรียกเก็บผู้เช่า (รอรับ)</h2>
          <p className="mb-3 text-xs text-slate-500">เราจ่ายไปแล้ว รอผู้เช่าจ่ายคืน · รับคืนแล้วนับเป็นรายได้ของ Property · ไม่เรียกเก็บแล้ว = กดที่แถวแล้วลบ</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">งวด</th><th>รายการ</th><th>สัญญา</th><th className="text-right">จ่ายไป</th><th className="text-right">เรียกเก็บ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {charges.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="py-1.5">{thMonth(c.cost_period)}</td>
                  <td>{c.description}{c.notes && <div className="text-xs text-slate-400">{c.notes}</div>}</td>
                  <td className="text-xs text-slate-600">{leaseName.get(c.lease_id) ?? "-"}</td>
                  <td className="text-right tabular-nums text-slate-500">{c.paid_amount != null ? money(c.paid_amount, c.currency) : "-"}
                    {c.paid_date && <div className="text-xs">{thDate(c.paid_date)}</div>}</td>
                  <td className="text-right tabular-nums">{money(c.amount, c.currency)}</td>
                  <td className="pl-2 text-right">
                    <div className="flex flex-wrap items-start justify-end gap-3">
                      {canWrite && <ReceiveChargeForm assetId={id} chargeId={c.id} amount={Number(c.amount)} currency={c.currency} banks={bankList}
                        today={today} defaultBank={rentTo.get(c.lease_id) ?? lastRentBank.get(c.lease_id)} />}
                      {canWrite && <RowActions table="lease_utility_charges" id={c.id} paths={paths} canDelete={canDelete} deleteEffect=""
                        fields={[{ name: "amount", label: "ยอดเรียกเก็บ", type: "number", value: c.amount }, { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />}
                    </div>
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
                  <td>{r.income_type === "RENT" ? thMonth(r.income_period) : r.income_subtype === REBILL_SUBTYPE
                    ? <>{thMonth(r.income_period)}<div className="text-xs text-slate-500">ค่าน้ำไฟเรียกเก็บ</div></>
                    : <span className="text-xs text-slate-500">หักจากเงินประกัน</span>}</td>
                  <td className="text-xs text-slate-600">{leaseName.get(r.lease_id as string) ?? "-"}{r.notes && <div className="text-slate-400">{r.notes}</div>}</td>
                  <td className="text-right tabular-nums">{money(r.amount, r.currency)}{Number(r.tax ?? 0) > 0 && <div className="text-xs text-slate-500">ภาษี {money(r.tax)}</div>}</td>
                  <td className="pl-4 text-xs text-slate-600">{r.received_to_asset_id ? bankName.get(r.received_to_asset_id) ?? "บัญชี" : "ไม่ผ่านบัญชี"}</td>
                  <td className="pl-2 text-right">
                    {r.income_type !== "RENT" && r.income_subtype !== REBILL_SUBTYPE && <span className="text-xs text-slate-400">ยกเลิกที่ &ldquo;ยกเลิกการคืนเงินประกัน&rdquo; ในสัญญา</span>}
                    {canWrite && (r.income_type === "RENT" || r.income_subtype === REBILL_SUBTYPE) && <RowActions table="income_transactions" id={r.id} paths={paths} canDelete={canDelete}
                      fields={rentIncomeFields(r)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      </LeaseWrap>}

      {/* ---------------- ภาษีที่ดินและสิ่งปลูกสร้าง ---------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ภาษีที่ดินและสิ่งปลูกสร้าง</h2>
            <p className="text-xs text-slate-500">ที่ดิน + สิ่งปลูกสร้าง (หักค่าเสื่อม) − ยกเว้น = ฐานภาษี × อัตรา − ส่วนลด · ปีปัจจุบันตั้งเป็นยอดประมาณ &ldquo;ภาษีที่ดิน&rdquo; ในค่าใช้จ่ายประจำให้</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaxYearSelect years={taxYears} value={ty} withData={taxDataYears} hrefOf={`/property/${id}?ty=__Y__`} />
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
                      {canWrite && <TaxLineForm assetId={id} year={ty} line={t} label="แก้ไข" canDelete={canDelete} />}
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
          {canWrite && <UtilityForm assetId={id} propertyId={pd.id} currency={a.currency} pays={payOpts.slice(1)} />}
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
                      { name: "paid_from_asset_id", label: "จ่ายจากบัญชี (ค่าตั้งต้น)", type: "select", value: u.paid_from_asset_id ?? "",
                        options: [["", "—"], ...bankList.filter((b) => b.currency === u.currency).map((b) => [b.asset_id, b.name] as [string, string])] },
                      { name: "paid_from_credit_card_id", label: "หรือบัตร (ค่าตั้งต้น)", type: "select", value: u.paid_from_credit_card_id ?? "",
                        options: [["", "—"], ...cards.filter((c) => c.currency === u.currency).map((c) => [c.id, c.label] as [string, string])] },
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
                          banks={bankList} cards={cards} persons={persons ?? []} today={today}
                          defaultBank={utilById.get(c.utility_id)?.paid_from_asset_id} defaultCard={utilById.get(c.utility_id)?.paid_from_credit_card_id}
                          rebillLeases={["ELECTRICITY", "WATER"].includes(c.utility_type) ? rebillLeases : []} />
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

/** ให้เช่าอยู่ → แสดงตามปกติ · ไม่ได้ให้เช่าแล้วแต่เคยมีสัญญา → พับไว้เป็น "ประวัติสัญญาเช่า" */
function LeaseWrap({ open, count, children }: { open: boolean; count: number; children: ReactNode }) {
  if (open) return <>{children}</>;
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-5">
      <summary className="cursor-pointer font-medium text-slate-900">ประวัติสัญญาเช่า ({count})
        <span className="ml-2 text-xs font-normal text-slate-500">ไม่ได้ให้เช่าแล้ว · จะให้เช่าใหม่ ให้เปลี่ยนการใช้งานเป็น &ldquo;ให้เช่า&rdquo; ที่ แก้ไขข้อมูล</span></summary>
      <div className="mt-4 space-y-6">{children}</div>
    </details>
  );
}

/** ราคาขายขั้นต่ำต่อหน่วย: ตามหน่วยของราคาตลาดครั้งล่าสุด (ต่อ ตร.ว. / ตร.ม.) หรือเนื้อที่โฉนด (ตร.ว.) */
function targetUnit(m: MarketValuation | undefined, sqwa: number | null): { area: number; label: string } | null {
  if (m && m.unit_basis !== "TOTAL" && m.area) return { area: Number(m.area), label: MARKET_UNIT_LABEL[m.unit_basis] };
  return sqwa ? { area: Number(sqwa), label: "ตร.ว." } : null;
}
