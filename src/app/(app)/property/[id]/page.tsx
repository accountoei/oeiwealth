import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  COST_STATUS, ENCUMBRANCE_LABEL, MARKET_UNIT_LABEL, REBILL_SUBTYPE, UTILITIES_BILLING_LABEL, FREQ_LABEL, LAND_TAX_RATE_BY_USAGE, landTaxYears, LEASE_STATUS, PERIODS_PER_YEAR, PROPERTY_TYPE_LABEL, TH_MONTHS, USAGE_LABEL, UTIL_EXPENSE_CATEGORY,
  INS_OPEN, INS_STATUS, PROPERTY_COST_TYPE_LABEL, UTIL_LABEL, COMMON_ROOM_LABEL, INVENTORY_DISPOSAL_LABEL, INVENTORY_METER_TYPES, INVENTORY_PICK_TYPES, INVENTORY_TYPE_LABEL, addDays, diffText, durationText, handoverCheckText, landText, money, monthsBetween, scheduleText, SMALL_BTN, thDate, thMonth, todayBangkok, vacancyWarning,
} from "@/lib/format";
import {
  EditPropertyForm, EditTerminationForm, RecordCostForm, ReceiveChargeForm, RecordRentForm, SettleDepositForm, SuggestVacant,
  UtilityForm,
} from "./forms";
import CloseLeaseForm from "./CloseLeaseForm";
import { LeaseEditName, LeaseHub, LeaseHubButton, type LeaseEditEntry } from "./LeaseHub";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import { loadExpEditCtx, ONE_OFF_COLS, OneOffExpenseEdit, type OneOffExp } from "../expense-edit";
import EditToggle from "@/components/EditToggle";
import { CopyTaxYear, TaxLineForm, TaxYearSelect, type TaxLine } from "./LandTax";
import { WithStatus } from "@/components/StatusSelect";
import { PropertyPayForm, SellAssetForm, UndoComponentEvent, type CompOpt, type SaleComp } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import MarketBox from "../MarketBox";
import TargetBox, { CostLotsSection, type TargetPrice } from "../TargetBox";
import PropertyPaymentForm from "../PropertyPaymentForm";
import ValuePartsForm, { type DeedOpt } from "../ValuePartsForm";
import { COMPONENT_FIELDS, COMP_TYPE_LABEL, END_REASON_LABEL, compName, lifeText, type Component } from "../components";
import type { ValuePart } from "../valueParts";
import type { CostLot } from "../CostItemForm";
import type { MarketValuation } from "../MarketValuationForm";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { UndoDismissButton } from "@/app/(app)/income-expenses/forms";
import { premiumPaymentFields, propertyCostFields, rentIncomeFields } from "@/lib/source-edit";
import { cardLabel, endpointValue } from "@/lib/money-endpoint";
import { DetailItem as Item } from "@/components/Boxes";
import { LEASE_DETAIL_FIELDS } from "@/lib/lease";
import CycleNote from "../CycleNote";
import { CopyRoomButton, DisposeButton, HandoverButton, InventoryAddButton, UndoDisposalButton, type HandoverItem } from "../Inventory";
import type { LeaseDetail, LeaseDetailOptions } from "../LeaseContractFields";
import type { LeasePrefill } from "../LeaseFields";
import { InfoTip } from "@/components/HeaderBar";
import { activeBanks, openCards } from "@/lib/pay-sources";

const INS_STATUS_LABEL = Object.fromEntries(INS_STATUS);
const SOURCE_LABEL: Record<string, string> = { OPENING: "มูลค่าตั้งต้น", APPRAISAL: "ผู้ประเมิน", USER: "ผู้ใช้", STATEMENT: "Statement" };
const METHOD_LABEL: Record<string, string> = {
  USER_ESTIMATE: "ประมาณเอง", APPRAISAL: "ประเมิน", BOOK_VALUE: "ราคาทุน", LATEST_TRANSACTION: "ราคาซื้อขายล่าสุด", STATEMENT: "Statement",
};
const DEPOSIT_LABEL: Record<string, { text: string; cls: string }> = {
  HELD: { text: "ถือไว้ (เป็นหนี้)", cls: "text-slate-700" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  REFUND_PENDING: { text: "รอคืนเงินประกัน", cls: "text-amber-700" },
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
  deposit_refunded_amount: number | null; deposit_carried_amount: number | null; deposit_carried_from_lease_id: string | null; status: string; notes: string | null;
  lease_status: string; deposit_status: string; deposit_due_date: string; deposit_refund_by: string };
type Util = { id: string; utility_type: string; unit_label: string | null; provider: string | null; account_no: string | null; meter_no: string | null;
  notes: string | null; deleted_at: string | null; expected_amount: number | null; currency: string; frequency: string | null;
  due_day: number | null; due_month: number | null; active: boolean; paid_from_asset_id: string | null; paid_from_credit_card_id: string | null };
type Cost = { utility_id: string; utility_type: string; provider: string | null; cost_period: string; due_date: string;
  expected_amount: number; paid_amount: number; gap: number; currency: string; status: string; last_paid_date: string | null;
  dismissal_id: string | null; dismissal_reason: string | null };
type Rent = { lease_id: string; name: string; income_period: string; due_date: string; expected_amount: number;
  received_amount: number; currency: string; status: string; cycle_start: string | null; cycle_end: string | null;
  grace_days: number | null; late_fee_per_day: number | null; days_past_due: number | null; in_grace: boolean; late_fee: number | null };

export default async function PropertyDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ty?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  // ข้อมูลหน้า: ทุกคำสั่งเริ่มพร้อมกันรอบเดียว (AGENTS.md · Page data · เดิม 2 รอบ) · คำสั่งที่ต้องรู้รายละเอียดทรัพย์สิน / สัญญาเช่าก่อน ต่อจากคำสั่งนั้น
  //   .then((r) => r) = ส่งคำสั่งครั้งเดียว แล้วใช้ผลซ้ำได้ (คำสั่ง supabase-js ส่งใหม่ทุกครั้งที่ .then)
  const pdQ = supabase.from("property_details").select(`*, property_utilities(id,utility_type,unit_label,provider,account_no,meter_no,notes,deleted_at,expected_amount,currency,frequency,due_day,due_month,active,paid_from_asset_id,paid_from_credit_card_id), property_deeds(${COMPONENT_FIELDS})`)
    .eq("asset_id", id).is("deleted_at", null).maybeSingle().then((r) => r);
  const leaseQ = supabase.from("v_lease_status").select("*").eq("property_asset_id", id).order("start_date", { ascending: false }).then((r) => r);
  const [{ data: a }, { data: pd }, { data: owners }, { data: vals }, { data: leaseRows }, { data: rentRows },
    { data: banks }, { data: family }, { data: persons }, { data: costRows }, { data: cardRows }, { data: marketRows }, { data: debtRows }, { data: lotRows }, { data: targetRow }, { data: partRows }, { data: eventRows }, { data: cpiLast },
    { data: insBox }, { data: insPayRows },
    // ประวัติรับค่าเช่า / จ่ายค่าใช้จ่ายประจำ (แก้ / ลบ ที่หน้านี้) และรายการอื่นของหน้า
    { data: rentPaid }, { data: costPaid }, { data: taxRaw }, { data: hasHistory }, { data: rentToRows }, { data: chargeRows }, { data: payRows }, { data: oneOffRows },
    { data: bizRows }, { data: ownerPeople }, { data: invRows }, { data: handRows }, { data: closeRows }, { data: depMoveRows }, expCtx] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    pdQ,
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,valuation_method,source,notes,source_movement_id")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    leaseQ,
    supabase.from("v_lease_rent_tracking").select("*").eq("property_asset_id", id)
      .order("income_period", { ascending: false }).limit(36),
    activeBanks(supabase),
    supabase.from("families").select("go_live_date,opportunity_method,opportunity_rate_pct").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_property_cost_tracking").select("utility_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,gap,currency,status,last_paid_date,dismissal_id,dismissal_reason")
      .eq("property_asset_id", id).order("cost_period", { ascending: false }).order("utility_type").limit(48),
    openCards(supabase),
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
    // ขายบางแถว / รื้อถอน (ยกเลิกได้เฉพาะครั้งล่าสุด)
    supabase.from("property_component_events").select("id,event_type,event_date,price,fee,book_value,gain,whole,valuation_id,created_at")
      .eq("asset_id", id).is("deleted_at", null).order("event_date", { ascending: false }).order("created_at", { ascending: false }),
    // เงินเฟ้อปีล่าสุดที่มีข้อมูลทั้งปี (ข้อความเทียบในกล่องราคาขายขั้นต่ำ)
    supabase.from("cpi_annual").select("year,inflation_pct").is("deleted_at", null).order("year", { ascending: false }).limit(1).maybeSingle(),
    // กล่อง "ประกันของทรัพย์สินนี้" (ตกลง 3 พ.ย. 2026): กรมธรรม์ที่เอาประกันทรัพย์สินนี้ + เบี้ยงวดที่ยังไม่จ่าย (ต่อจากคำสั่งแรกในรอบเดียวกัน)
    supabase.from("v_insurance_status").select("id,insurer,policy_no,insured_amount,insured_amount_currency,premium,premium_currency,end_date,status,derived_status")
      .eq("asset_id", id).order("status").order("end_date", { ascending: false })
      .then(async ({ data: pols }) => {
        const ids = (pols ?? []).map((x) => x.id as string);
        const { data: due } = ids.length
          ? await supabase.from("v_insurance_schedule_status").select("policy_id,due_date,remaining,currency,status").eq("kind", "PREMIUM")
              .in("policy_id", ids).in("status", INS_OPEN).order("due_date")
          : { data: [] };
        return { data: { pols: pols ?? [], due: due ?? [] } };
      }),
    // เบี้ยประกันที่จ่ายแล้ว (ผูกทรัพย์สินนี้) → นับเป็นค่าใช้จ่ายของทรัพย์สิน · แก้ / ลบที่หน้ากรมธรรม์
    supabase.from("expense_items").select("id,date,description,amount,currency,paid_from_asset_id,paid_from_credit_card_id,notes,insurance_schedule_lines(policy_id)")
      .eq("related_asset_id", id).not("insurance_schedule_line_id", "is", null).is("deleted_at", null).order("date", { ascending: false }).limit(60),
    // ประวัติรับค่าเช่า / จ่ายค่าใช้จ่ายประจำ (แก้ / ลบ ที่หน้านี้)
    supabase.from("income_transactions").select("id,date,income_period,income_type,income_subtype,amount,tax,currency,received_to_asset_id,notes,lease_id")
      .eq("asset_id", id).not("lease_id", "is", null).is("deleted_at", null).order("date", { ascending: false }).limit(60),
    pdQ.then(async ({ data: pd }) => {
      const utilIds = ((pd?.property_utilities ?? []) as Util[]).map((u) => u.id);
      return utilIds.length ? await supabase.from("expense_items").select("id,date,cost_period,description,amount,currency,paid_from_asset_id,paid_from_credit_card_id,property_utility_id,notes")
        .in("property_utility_id", utilIds).is("deleted_at", null).order("date", { ascending: false }).limit(60) : { data: [] as never[] };
    }),
    supabase.from("v_property_tax_lines").select("*").eq("asset_id", id).order("tax_year", { ascending: false }).order("sort_order").order("created_at"),
    // มีรายการแล้ว (ซื้อ / ขาย / มูลค่ามากกว่า 1 ครั้ง) → ลบไม่ได้ ต้องเปลี่ยนสถานะแทน
    supabase.rpc("asset_has_history", { p_asset_id: id }),
    // บัญชีรับค่าเช่าที่ตั้งไว้ของแต่ละสัญญา (ค่าตั้งต้นตอนบันทึกรับ)
    pdQ.then(async ({ data: pd }) => (pd ? await supabase.from("property_leases").select(`id,rent_to_asset_id,utilities_billing,prorate_basis,rent_timing,grace_days,late_fee_per_day,${LEASE_DETAIL_FIELDS}`).eq("property_id", pd.id).is("deleted_at", null) : { data: null })),
    // ค่าน้ำไฟที่เรียกเก็บผู้เช่า (ยังไม่ได้รับ)
    supabase.from("v_lease_utility_charges").select("id,lease_id,cost_period,description,amount,currency,notes,paid_date,paid_amount,kind")
      .eq("property_asset_id", id).eq("status", "PENDING").order("cost_period", { ascending: false }),
    // จ่ายเพิ่ม (ซื้อ / ต่อเติม) → ราคาที่ได้มา · ผูกส่วนประกอบ → แสดงใต้ต้นทุนของแถวนั้น
    supabase.from("cash_movements").select("amount,currency,movement_date,metadata").eq("to_asset_id", id).eq("movement_type", "ASSET_PURCHASE")
      .is("deleted_at", null),
    // ค่าใช้จ่ายครั้งเดียวของทรัพย์สินนี้ (ซ่อม / ทำห้องน้ำ · ไม่เพิ่มมูลค่า · ตกลง 29 ต.ค. 2026)
    supabase.from("expense_items").select(ONE_OFF_COLS)
      .eq("related_asset_id", id).is("property_utility_id", null).is("source_fee_side", null).is("insurance_schedule_line_id", null)
      .is("liability_id", null).is("deleted_at", null).order("date", { ascending: false }).limit(60),
    // รายละเอียดพิมพ์สัญญาเช่า: กิจการ (สถานที่ทำสัญญา) · เจ้าของ (ชื่อเต็ม + ที่อยู่)
    supabase.from("private_business_details").select("asset_id,company_name").is("deleted_at", null).order("company_name"),
    supabase.from("persons").select("id,name,title_prefix,full_name_th,address").is("deleted_at", null),
    // ของในทรัพย์สิน + รายการส่งมอบของทุกสัญญา (ไม่นับใน Net Worth)
    pdQ.then(async ({ data: pd }) => (pd ? await supabase.from("property_inventory_items").select("id,unit_label,item_type,name,qty,brand,serial_no,value,damage_value,notes,sort_order,expense_item_id,disposal_type,disposed_date,disposal_amount,expense_items(date)")
      .eq("property_id", pd.id).is("deleted_at", null).order("sort_order").order("created_at") : { data: null })),
    pdQ.then(async ({ data: pd }) => (pd ? await supabase.from("lease_handover_items").select("id,lease_id,inventory_item_id,utility_id,item_type,name,qty,brand,serial_no,value,damage_value,in_condition,in_reading,out_status,out_qty,out_missing_qty,out_condition,out_reading,deduction,notes,property_leases!inner(property_id)")
      .eq("property_leases.property_id", pd.id).is("deleted_at", null).order("sort_order").order("created_at") : { data: null })),
    // บันทึกผู้เช่าออก (ใบสรุป · ยกเลิกได้)
    pdQ.then(async ({ data: pd }) => (pd ? await supabase.from("lease_closeouts").select("lease_id,move_out_date,settled_date,deposit_refund,advance_refund,net_transfer,unpaid_rent,utilities,damage,forfeit,income_ids,expense_id,shortfall,tenant_paid,owed_pending,property_leases!inner(property_id)")
      .eq("property_leases.property_id", pd.id).is("deleted_at", null) : { data: null })),
    // เงินประกัน: รายการรับ / คืนส่วนต่างตอนต่อสัญญา (ค่าตั้งต้นของช่องบัญชีใน "แก้ไขสัญญา")
    leaseQ.then(async ({ data: ls }) => (ls?.length ? await supabase.from("cash_movements").select("related_lease_id,movement_type,from_asset_id,to_asset_id")
      .in("related_lease_id", ls.map((l) => l.id as string)).in("movement_type", ["SECURITY_DEPOSIT_IN", "SECURITY_DEPOSIT_OUT"])
      .eq("is_derived", false).is("deleted_at", null).order("created_at") : { data: [] as never[] })),
    // หน้าต่างแก้ค่าใช้จ่ายครั้งเดียว = ฟอร์มเดียวกับ Income & Expenses (ตกลง 10 พ.ย. 2026)
    me.role !== "VIEWER" ? loadExpEditCtx(supabase) : Promise.resolve(null),
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
  const rentOf = new Map(leases.map((l) => [l.id, Number(l.rent_amount)]));
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
  // ส่วนประกอบ: ที่ดิน (โฉนด) · อาคาร · สิ่งปลูกสร้างอื่น (ตกลง 29 ต.ค. 2026) · เนื้อที่ของทรัพย์สิน = ผลรวมแถวที่ดิน
  //   ขาย / รื้อถอนแล้ว → แสดงท้ายตารางเป็นประวัติ ไม่นับในเนื้อที่ ต้นทุน มูลค่า และไม่ให้เลือกในฟอร์ม
  const allComps = ((pd.property_deeds ?? []) as (Component & { sort_order: number; created_at: string; deleted_at: string | null })[])
    .filter((d) => !d.deleted_at).sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at));
  const comps = allComps.filter((c) => !c.ended_date);
  const endedComps = allComps.filter((c) => c.ended_date).sort((x, y) => (y.ended_date ?? "").localeCompare(x.ended_date ?? ""));
  type CompEvent = { id: string; event_type: "SELL" | "DEMOLISH"; event_date: string; price: number; fee: number; book_value: number | null; gain: number | null; whole: boolean };
  const events = new Map(((eventRows ?? []) as CompEvent[]).map((e) => [e.id, e]));
  const lastEventId = (eventRows ?? [])[0]?.id as string | undefined;
  const lands = comps.filter((c) => c.component_type === "LAND");
  const compLabel = new Map(allComps.map((c, i) => [c.id, compName(c, i)]));
  const compOpts: CompOpt[] = comps.map((c) => ({ id: c.id, label: compLabel.get(c.id) ?? "", type: c.component_type }));
  // (ราคาที่ได้มารายแถว ใส่หลังโหลดรายการจ่ายเพิ่ม · ดู deedOptsCost)
  const deedOpts: DeedOpt[] = comps.map((c) => ({ id: c.id, label: compLabel.get(c.id) ?? "", type: c.component_type,
    area: c.land_area_sq_wa != null ? Number(c.land_area_sq_wa) : null }));
  const partsKey = `${comps.map((d) => d.id).join(",")}|${vals?.[0]?.id ?? ""}`;   // เพิ่มส่วนประกอบ / มูลค่าใหม่ → ตั้งแถวฟอร์มใหม่
  const partText = (vid: string) => allParts.filter((p) => p.valuation_id === vid)
    .map((p) => `${(p.deed_id && compLabel.get(p.deed_id)) || p.label || (p.part_type === "BUILDING" ? "อาคาร" : p.part_type === "DEED" ? "โฉนด" : "อื่น ๆ")} ${money(p.value, undefined, 0)}`).join(" · ");
  const costs = (costRows as Cost[] | null) ?? [];
  const lots = (lotRows ?? []) as CostLot[];
  // มูลค่าแยกส่วน: ของมูลค่าล่าสุด (ค่าตั้งต้นฟอร์ม + คอลัมน์ในตารางโฉนด) และสรุปต่อครั้งในประวัติ
  type PartRow = { valuation_id: string; part_type: ValuePart["type"]; deed_id: string | null; label: string | null; value: number; source_movement_id: string | null };
  const allParts = (partRows ?? []) as PartRow[];
  const toPart = (p: PartRow): ValuePart => ({ type: p.part_type, deed_id: p.deed_id, label: p.label, value: Number(p.value), source_movement_id: p.source_movement_id });
  const latestParts = vals?.[0] ? allParts.filter((p) => p.valuation_id === vals[0].id).map(toPart) : [];
  // มูลค่าล่าสุดรายแถว (จ่ายเพิ่มที่ผูกกับแถวเดียวกัน = รวมกัน)
  const latestByComp = latestParts.reduce<Record<string, number>>((m, p) => (p.deed_id ? { ...m, [p.deed_id]: (m[p.deed_id] ?? 0) + p.value } : m), {});
  const hasLatest = Object.keys(latestByComp).length > 0;
  const saleComps: SaleComp[] = comps.map((c) => ({ id: c.id, label: compLabel.get(c.id) ?? "", type: c.component_type,
    value: hasLatest ? latestByComp[c.id] ?? 0 : null }));
  const demolishable = saleComps.filter((c) => c.type !== "LAND");
  const cards = (cardRows ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
    label: cardLabel(c) }));
  // ประกันของทรัพย์สินนี้ · เบี้ยต่อปีของกรมธรรม์ที่มีผลรวมในประมาณการต่อปี
  const insPols = insBox?.pols ?? [];
  const newInsHref = `/insurance/new?type=PROPERTY&asset=${id}`;
  const insDue = insBox?.due ?? [];
  const yearly = utilities.filter((u) => u.frequency && u.active)
    .reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0)), new Map<string, number>());
  insPols.filter((x) => x.status === "ACTIVE" && Number(x.premium ?? 0) > 0)
    .forEach((x) => yearly.set(x.premium_currency ?? "THB", (yearly.get(x.premium_currency ?? "THB") ?? 0) + Number(x.premium)));
  const utilName = (t: string, provider: string | null) => [UTIL_LABEL[t] ?? t, provider].filter(Boolean).join(" · ");
  const isRental = pd.usage_type === "RENTAL" || liveLeases.length > 0;
  // ที่ว่าง: ระยะเวลาที่ว่าง + ประวัติช่วงที่เคยว่าง
  const vacantMonths = pd.usage_type === "VACANT" && pd.vacant_since ? monthsBetween(pd.vacant_since, today) : 0;
  const vacancyHistory = ((pd.vacancy_history ?? []) as { from: string; to: string; plan: string | null }[]).slice().reverse();
  type DepMove = { related_lease_id: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null };
  const depIn = new Map<string, string | null>(), depOut = new Map<string, string | null>();
  ((depMoveRows ?? []) as DepMove[]).forEach((m) => {
    if (m.movement_type === "SECURITY_DEPOSIT_IN" && !depIn.has(m.related_lease_id)) depIn.set(m.related_lease_id, m.to_asset_id);
    if (m.movement_type === "SECURITY_DEPOSIT_OUT" && !depOut.has(m.related_lease_id)) depOut.set(m.related_lease_id, m.from_asset_id);
  });
  type PayRow = { amount: number; currency: string; movement_date: string; metadata: { component_id?: string; add_value?: boolean | string } | null };
  // จ่ายเพิ่มเป็นต้นทุนเสมอ (ไม่มีติ๊กแล้ว · ตกลง 29 ต.ค. 2026) · รายการเก่าที่ไม่ได้ติ๊ก = ไม่นับเป็นต้นทุน
  const addPays = ((payRows ?? []) as PayRow[]).filter((p) => p.currency === a.currency && String(p.metadata?.add_value) === "true");
  const paidByComp = addPays.filter((p) => p.metadata?.component_id)
    .reduce<Record<string, number>>((m, p) => ({ ...m, [p.metadata!.component_id!]: (m[p.metadata!.component_id!] ?? 0) + Number(p.amount) }), {});
  // แถวที่มีรายการจ่ายผูกอยู่ (ทุกสกุล) → ลบ / แก้ต้นทุนในฟอร์มแก้ไขไม่ได้ (ตกลง 29 ต.ค. 2026)
  const paidComp = new Set(((payRows ?? []) as PayRow[]).map((p) => p.metadata?.component_id).filter(Boolean));
  const deedOptsCost: DeedOpt[] = deedOpts.map((d) => {
    const c = comps.find((x) => x.id === d.id);
    const v = (c?.acq_cost != null ? Number(c.acq_cost) : 0) + (paidByComp[d.id] ?? 0);
    return { ...d, cost: c?.acq_cost != null || paidByComp[d.id] != null ? v : null };
  });
  // ราคาที่ได้มา (ณ วันที่ได้มา + จ่ายเพิ่ม) · ค่าใช้จ่ายสะสม (ครั้งเดียว + ประจำ) ในกล่องมูลค่า
  const acqAll = a.acquisition_cost != null || addPays.length > 0 ? Number(a.acquisition_cost ?? 0) + addPays.reduce((t, p) => t + Number(p.amount), 0) : null;
  const oneOff = (oneOffRows ?? []) as unknown as (OneOffExp & { amount: number })[];
  // เบี้ยประกันทรัพย์สินนี้ที่จ่ายแล้ว (ตกลง 3 พ.ย. 2026) → รวมใน "ค่าใช้จ่าย … บาท" ของกล่องมูลค่า + ตารางค่าใช้จ่าย
  const insPays = ((insPayRows ?? []) as { id: string; date: string; description: string | null; amount: number; currency: string; notes: string | null;
    paid_from_asset_id: string | null; paid_from_credit_card_id: string | null; insurance_schedule_lines: { policy_id: string } | { policy_id: string }[] | null }[])
    .map((e) => ({ ...e, policyId: (Array.isArray(e.insurance_schedule_lines) ? e.insurance_schedule_lines[0] : e.insurance_schedule_lines)?.policy_id ?? null }));
  const spent = [...oneOff, ...insPays, ...((costPaid ?? []) as { date: string; amount: number; currency: string }[])].filter((e) => e.currency === a.currency);
  const spentSum = spent.reduce((t, e) => t + Number(e.amount), 0);
  const spentLast = spent.reduce((d, e) => (e.date > d ? e.date : d), "");
  // ประวัติมูลค่า: แก้ไม่ได้ · ลบได้เฉพาะครั้งล่าสุดที่บันทึกเอง (ไม่ใช่จากจ่ายเพิ่ม / ขาย / รื้อถอน) และไม่ใช่มูลค่าเดียว
  const eventVals = new Set(((eventRows ?? []) as { valuation_id: string | null }[]).map((e) => e.valuation_id).filter(Boolean));
  const v0 = vals?.[0];
  const deletableVal = v0 && (vals?.length ?? 0) > 1 && !v0.source_movement_id && v0.notes !== "ราคาขาย" && !eventVals.has(v0.id) ? v0.id as string : null;
  type LeaseExtra = LeaseDetail & { id: string; rent_to_asset_id: string | null; utilities_billing: string | null; deposit_months: number | null; prorate_basis: string;
    rent_timing: string; grace_days: number; late_fee_per_day: number | null };
  const leaseExtra = new Map(((rentToRows ?? []) as LeaseExtra[]).map((r) => [r.id, r]));
  const rentTo = new Map([...leaseExtra.values()].filter((r) => r.rent_to_asset_id).map((r) => [r.id, r.rent_to_asset_id as string]));
  const charges = (chargeRows ?? []) as { id: string; lease_id: string; cost_period: string; description: string; amount: number; currency: string;
    notes: string | null; paid_date: string | null; paid_amount: number | null; kind: string }[];
  // สัญญาที่ "เราจ่ายแล้วเรียกเก็บ" ค่าน้ำไฟ → ติ๊กเรียกเก็บผู้เช่าให้ตอนบันทึกจ่าย
  const rebillLeases = liveLeases.filter((l) => leaseExtra.get(l.id)?.utilities_billing === "REBILL")
    .map((l) => ({ id: l.id, unit: l.unit_label?.trim().toLowerCase() ?? "", label: [l.unit_label, l.tenant_name].filter(Boolean).join(" · ") }));
  // มิเตอร์ผูกห้อง → สัญญาของห้องนั้นขึ้นก่อน (ค่าเริ่มต้นของ "เรียกเก็บผู้เช่า")
  const rebillFor = (utilityId: string) => {
    const room = utilById.get(utilityId)?.unit_label?.trim().toLowerCase();
    return room ? [...rebillLeases].sort((x, y) => Number(y.unit === room) - Number(x.unit === room)) : rebillLeases;
  };
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

  const costSum = comps.reduce((t, c) => t + Number(c.acq_cost ?? 0) + (paidByComp[c.id] ?? 0), 0);
  const endedList = endedComps.length > 0 && (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-slate-500">ขาย / รื้อถอนแล้ว (ไม่นับในเนื้อที่ ต้นทุน และมูลค่า)</div>
      <ul className="divide-y divide-slate-100 text-sm text-slate-500">
        {endedComps.map((c) => { const e = c.end_event_id ? events.get(c.end_event_id) : undefined; return (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
            <span className="text-slate-700 line-through decoration-slate-300">{compLabel.get(c.id)}</span>
            <span className="rounded bg-slate-100 px-1.5 text-xs">{c.end_reason ? END_REASON_LABEL[c.end_reason] : ""} {thDate(c.ended_date)}</span>
            {e && <span className="text-xs tabular-nums">
              {e.event_type === "SELL" || Number(e.price) > 0 ? `ราคา ${money(e.price, undefined, 0)} · ` : ""}มูลค่าเดิม {money(e.book_value, undefined, 0)}
              {e.gain != null && Number(e.gain) !== 0 && <span className={Number(e.gain) > 0 ? "text-emerald-700" : "text-red-700"}>
                {" · "}{Number(e.gain) > 0 ? "กำไร" : "ขาดทุน"} {money(Math.abs(Number(e.gain)), undefined, 0)}</span>}</span>}
            {canDelete && (a.status === "ACTIVE" || (a.status === "SOLD" && e?.whole)) && e && e.id === lastEventId && <UndoComponentEvent eventId={e.id} paths={paths} />}
          </li>); })}
      </ul>
    </div>
  );
  const compTable = (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h3 className="mb-2 text-sm font-medium text-slate-800">ส่วนประกอบ {comps.length > 0 && <span className="font-normal text-slate-500">({comps.length})</span>} {!hasLatest && <InfoTip label="คำอธิบาย">มูลค่าล่าสุดยังเป็นยอดรวมอย่างเดียว · แยกรายแถวได้ที่ปุ่มแก้ไข หรือ &ldquo;ปรับมูลค่า / ประวัติ&rdquo;</InfoTip>}</h3>
      {comps.length === 0 && endedList}
      {comps.length === 0 ? (endedComps.length > 0 ? null : <p className="text-sm text-slate-500">ยังไม่มีข้อมูลที่ดิน / อาคาร · กด &ldquo;แก้ไข&rdquo; แล้วเพิ่มแถวละโฉนด / หลัง</p>) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">ส่วนประกอบ</th><th>รายละเอียด</th><th className="text-right">เนื้อที่ / พื้นที่</th><th className="pl-3">ได้มา</th>
                <th className="text-right">ต้นทุน</th><th className="text-right">มูลค่าล่าสุด</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {comps.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="py-1.5">{compLabel.get(c.id)}<span className="block text-xs text-slate-400">{COMP_TYPE_LABEL[c.component_type]}</span></td>
                  <td className="text-xs text-slate-600">{(c.component_type === "LAND"
                    ? [c.land_no && `เลขที่ดิน ${c.land_no}`, c.deed_book && `เล่ม ${c.deed_book}`, c.deed_page && `หน้า ${c.deed_page}`, c.map_sheet && `ระวาง ${c.map_sheet}`,
                       c.survey_page && `หน้าสำรวจ ${c.survey_page}`]
                    : [lifeText(c)]).filter(Boolean).join(" · ") || "-"}
                    {c.notes && <div className="text-slate-400">{c.notes}</div>}</td>
                  <td className="text-right text-xs tabular-nums">{c.component_type === "LAND" ? (c.land_area_sq_wa != null ? landText(c.land_area_sq_wa) : "-")
                    : c.building_area_sqm != null ? `${Number(c.building_area_sqm).toLocaleString("en-US")} ตร.ม.` : "-"}</td>
                  <td className="pl-3 text-xs">{c.acquired_date ? thDate(c.acquired_date) : "-"}</td>
                  <td className="text-right tabular-nums">{c.acq_cost != null ? money(c.acq_cost, undefined, 0) : paidByComp[c.id] ? "" : "-"}
                    {paidByComp[c.id] != null && <div className="text-xs text-slate-500">{c.acq_cost != null && "+ "}จ่าย {money(paidByComp[c.id], undefined, 0)}</div>}</td>
                  <td className="pl-3 text-right tabular-nums">{latestByComp[c.id] != null ? money(latestByComp[c.id], undefined, 0) : "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 font-medium">
              <tr><td className="py-1.5" colSpan={2}>รวม</td>
                <td className="text-right text-xs tabular-nums">{lands.length > 0 ? landText(pd.land_area_sq_wa) : ""}</td><td></td>
                <td className="text-right tabular-nums">{costSum > 0 ? money(costSum, undefined, 0) : "-"}</td>
                <td className="pl-3 text-right tabular-nums">{money(a.current_value, undefined, 0)}</td></tr>
            </tfoot>
          </table>
          {endedList}
        </div>
      )}
    </div>
  );

  // กล่องค่าเช่า: รายการรับต่องวด แสดงใต้แถวงวด · ที่ไม่ตรงงวดในตาราง → "รายการรับอื่น" (รวม 2 กล่อง · ตกลง 2 พ.ย. 2026)
  type RentPaidRow = NonNullable<typeof rentPaid>[number];
  const rentKey = (lease: string, period: string) => `${lease}|${period}`;
  const rentRowKeys = new Set(rents.map((r) => rentKey(r.lease_id, r.income_period)));
  const paidByPeriod = new Map<string, RentPaidRow[]>();
  const otherPaid: RentPaidRow[] = [];
  for (const x of [...(rentPaid ?? [])].reverse()) {
    const k = rentKey(x.lease_id as string, x.income_period as string);
    if (x.income_type === "RENT" && rentRowKeys.has(k)) paidByPeriod.set(k, [...(paidByPeriod.get(k) ?? []), x]);
  }
  for (const x of rentPaid ?? []) if (!(x.income_type === "RENT" && rentRowKeys.has(rentKey(x.lease_id as string, x.income_period as string)))) otherPaid.push(x);
  const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";

  // รายละเอียดพิมพ์สัญญา: เจ้าของเรียงตามสัดส่วน (คนแรก = ค่าเริ่มต้น "ทำที่") · ต่อสัญญาดึงข้อมูลสัญญาเดิม
  const detailOpt: LeaseDetailOptions = {
    owners: [...activeOwners].sort((x, y) => Number(y.ownership_percent) - Number(x.ownership_percent)).map((o) => {
      const pp = (ownerPeople ?? []).find((x) => x.id === o.person_id);
      return { id: o.person_id as string, name: pp?.full_name_th ? `${pp.title_prefix ?? ""}${pp.full_name_th}` : (o.person_name as string),
        address: (pp?.address as string | null) ?? null };
    }),
    businesses: bizRows ?? [],
  };
  const canSensitive = me.role === "ADMIN" || me.role === "EDITOR";
  const renewals: LeasePrefill[] = leases.map((l) => {
    const x = leaseExtra.get(l.id);
    return { ...(x ?? {}), id: l.id, label: `${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} · ${thDate(l.start_date)} – ${thDate(l.terminated_date ?? l.end_date)}`,
      unit_label: l.unit_label, tenant_name: l.tenant_name, start_date: l.start_date, end_date: l.end_date, terminated_date: l.terminated_date,
      rent_amount: Number(l.rent_amount), rent_currency: l.rent_currency, payment_frequency: l.payment_frequency, payment_due_day: l.payment_due_day,
      rent_to_asset_id: x?.rent_to_asset_id ?? null, utilities_billing: x?.utilities_billing ?? null, deposit_months: x?.deposit_months ?? null,
      prorate_basis: x?.prorate_basis ?? null };
  });

  // ของในทรัพย์สิน: หลายห้อง (ชื่อห้องจากสัญญา + ที่ตั้งไว้ในของ) → มีช่องห้อง · ห้องว่าง = ส่วนกลาง / ทั้งหลัง
  type Inv = { id: string; unit_label: string | null; item_type: string; name: string; qty: number; brand: string | null; serial_no: string | null;
    value: number | null; damage_value: number | null; notes: string | null; expense_item_id: string | null; disposal_type: string | null; disposed_date: string | null;
    disposal_amount: number | null; expense_items: { date: string } | { date: string }[] | null };
  const invAll = (invRows ?? []) as Inv[];
  const inv = invAll.filter((x) => !x.disposal_type);
  const invGone = invAll.filter((x) => x.disposal_type);
  const boughtOn = (x: Inv) => (Array.isArray(x.expense_items) ? x.expense_items[0]?.date : x.expense_items?.date) ?? null;
  const rooms = [...new Set([...leases.map((l) => l.unit_label?.trim()), ...inv.map((x) => x.unit_label?.trim()), ...utilities.map((u) => u.unit_label?.trim())]
    .filter((x): x is string => !!x))]
    .sort((x, y) => x.localeCompare(y, "th", { numeric: true }));
  const multiRoom = rooms.length > 1;
  const roomsWithItems = [...new Set(inv.map((x) => x.unit_label?.trim() ?? ""))];
  type Hand = { id: string; lease_id: string; inventory_item_id: string | null; utility_id: string | null; item_type: string; name: string; qty: number; brand: string | null; serial_no: string | null; value: number | null;
    damage_value: number | null; out_qty: number | null; out_missing_qty: number | null;
    in_condition: string | null; in_reading: number | null; out_status: string | null; out_condition: string | null; out_reading: number | null;
    deduction: number | null; notes: string | null };
  const s2 = (v: unknown) => (v == null ? "" : String(v));
  const handByLease = ((handRows ?? []) as unknown as Hand[]).reduce((m, h) => m.set(h.lease_id, [...(m.get(h.lease_id) ?? []), h]), new Map<string, Hand[]>());
  const handItems = (leaseId: string): HandoverItem[] => (handByLease.get(leaseId) ?? []).map((h) => ({
    id: h.id, pulled: !!(h.inventory_item_id || h.utility_id), item_type: h.item_type, name: h.name, qty: s2(Number(h.qty)), brand: s2(h.brand), serial_no: s2(h.serial_no),
    value: h.value == null ? "" : money(h.value), damage_value: h.damage_value == null ? "" : money(h.damage_value),
    out_qty: h.out_qty == null ? "" : s2(Number(h.out_qty)), out_missing_qty: h.out_missing_qty == null ? "" : s2(Number(h.out_missing_qty)), in_condition: s2(h.in_condition), in_reading: h.in_reading == null ? "" : s2(Number(h.in_reading)),
    out_status: s2(h.out_status), out_condition: s2(h.out_condition), out_reading: h.out_reading == null ? "" : s2(Number(h.out_reading)),
    deduction: h.deduction == null ? "" : money(h.deduction), notes: s2(h.notes) }));
  // ค่าเสียหายจากรายการส่งมอบ → เติมให้ตอน "คืน / หักเงินประกัน" (เงินประกันคนละสกุล · ผู้เช่าออกปกติใช้ตารางตรวจของในหน้าต่างผู้เช่าออก)
  const handDeduct = (leaseId: string) => {
    const rows = (handByLease.get(leaseId) ?? []).filter((h) => Number(h.deduction ?? 0) > 0);
    return { amount: rows.reduce((t, h) => t + Number(h.deduction), 0),
      reason: rows.map((h) => `${h.name}${h.out_status && h.out_status !== "OK" ? ` (${handoverCheckText(h)})` : ""} ${money(h.deduction)}`).join(" · ") };
  };

  // ผู้เช่าออก (ตกลง 6 พ.ย. 2026) · ต่อสัญญาได้เมื่อยังไม่มีสัญญาถัดไปของห้องเดียวกัน (หรือทั้งหลัง)
  type Closeout = { lease_id: string; move_out_date: string; settled_date: string; deposit_refund: number; advance_refund: number; net_transfer: number;
    unpaid_rent: number; utilities: number; damage: number; forfeit: number; income_ids: string[]; expense_id: string | null;
    shortfall: number; tenant_paid: number; owed_pending: number };
  const closeOf = new Map(((closeRows ?? []) as unknown as Closeout[]).map((c) => [c.lease_id, c]));
  // รายได้ที่สร้างตอนผู้เช่าออก → แก้ / ลบทีละรายการไม่ได้ (ยกเลิกทั้งชุดที่การ์ดสัญญา)
  const closeIncome = new Set([...closeOf.values()].flatMap((c) => c.income_ids ?? []));
  const closeExpense = new Set([...closeOf.values()].flatMap((c) => (c.expense_id ? [c.expense_id] : [])));
  const CLOSE_NOTE = <span className="text-xs text-slate-400">ยกเลิกที่ &ldquo;ยกเลิกผู้เช่าออก&rdquo; ในสัญญา</span>;
  const roomKey = (u: string | null) => (u ?? "").trim().toLowerCase();
  const hasSuccessor = (l: Lease) => leases.some((o) => o.id !== l.id && o.start_date > l.start_date
    && (!roomKey(o.unit_label) || !roomKey(l.unit_label) || roomKey(o.unit_label) === roomKey(l.unit_label)));
  const closeoutText = (l: Lease, co: Closeout) => {
    const ded = Number(co.unpaid_rent) + Number(co.utilities) + Number(co.damage) + Number(co.forfeit);
    // หักเกินเงินประกัน (ตกลง 6 พ.ย. 2026): ผู้เช่าจ่ายเพิ่ม (รับแล้ว) / ค่าเสียหายค้างรับ
    if (Number(co.shortfall) > 0) {
      return `ผู้เช่าออก ${thDate(co.move_out_date)} · หักเกินเงินประกัน ${money(co.shortfall)}`
        + (Number(co.advance_refund) > 0 ? ` (หักกับค่าเช่าล่วงหน้า ${money(Math.min(Number(co.advance_refund), Number(co.shortfall)))})` : "")
        + (Number(co.net_transfer) > 0 ? ` · โอนคืน ${money(co.net_transfer, l.rent_currency)}` : "")
        + (Number(co.tenant_paid) > 0 ? ` · ผู้เช่าจ่ายเพิ่ม ${money(co.tenant_paid, l.rent_currency)}` : "")
        + (Number(co.owed_pending) > 0 ? ` · ค่าเสียหายค้างรับ ${money(co.owed_pending, l.rent_currency)}` : "")
        + ` · เมื่อ ${thDate(co.settled_date)}`;
    }
    return `ผู้เช่าออก ${thDate(co.move_out_date)} · โอนคืน ${money(co.net_transfer, l.rent_currency)}`
      + (Number(co.advance_refund) > 0 ? ` (เงินประกัน ${money(co.deposit_refund)} + ค่าเช่าล่วงหน้า ${money(co.advance_refund)})` : "")
      + (ded > 0 ? ` · หักจากเงินประกัน ${money(ded)}` : "") + ` · เมื่อ ${thDate(co.settled_date)}`;
  };

  // full = การ์ดสัญญาปัจจุบัน · false = บรรทัดสัญญาเดิมที่จบแล้ว: พิมพ์ + ดูรายการส่งมอบอย่างเดียว · ยกเลิกผู้เช่าออก / คืนเงินประกัน เฉพาะ ADMIN (ตกลง 6 พ.ย. 2026)
  //   สร้าง / ต่อ / แก้ไขสัญญา = ปุ่มเดียวบนหัวกล่อง (LeaseHub) · กดที่การ์ด = แก้ไขสัญญานั้น
  const leaseActions = (l: Lease, full = false) => {
    const dep = Number(l.security_deposit ?? 0);
    const leaseEnded = l.deposit_due_date <= today;
    const hand = handItems(l.id);
    const hd = handDeduct(l.id);
    const co = closeOf.get(l.id);
    // เงินประกันคนละสกุลกับค่าเช่า → ใช้ "คืน / หักเงินประกัน" แบบเดิม
    const depSameCcy = dep <= 0 || (l.deposit_currency ?? l.rent_currency) === l.rent_currency;
    // รายการส่งมอบ 2 ช่วง (ตกลง 6 พ.ย. 2026): ระหว่างสัญญา = กรอกตอนรับมอบ · ผลตรวจตอนส่งคืนกรอกในหน้าต่างผู้เช่าออก
    //   ผู้เช่าออกแล้ว / คืนเงินประกันแล้ว / สัญญาเดิม / VIEWER = ดูอย่างเดียว · เงินประกันคนละสกุล = แก้ได้ทั้ง 2 ฝั่ง (ใช้ "คืน / หักเงินประกัน" แบบเดิม)
    const handMode = !full || !canWrite || co || l.deposit_settlement_type ? "view" : depSameCcy ? "in" : "both";
    return (
      <>
        <Link href={`/print/lease/${l.id}`} target="_blank" className="text-sm text-blue-700 hover:underline">พิมพ์สัญญาเช่า</Link>
        {co && <Link href={`/print/lease/${l.id}?s=closeout`} target="_blank" className="text-sm text-blue-700 hover:underline">พิมพ์ใบสรุปผู้เช่าออก</Link>}
        {(handMode !== "view" || hand.length > 0) && (
          <HandoverButton assetId={id} leaseId={l.id} label={`${handMode === "view" ? "ดู" : ""}รายการส่งมอบ${hand.length ? ` (${hand.length})` : ""}`} items={hand}
            mode={handMode} currency={l.rent_currency}
            docs={<EntityDocuments category="PROPERTY" entityType="PROPERTY_LEASE" entityId={l.id} module="PROPERTY"
              role={full ? me.role : "VIEWER"} paths={paths} title="รูปถ่าย / เอกสารการส่งมอบ" bare />} />
        )}
        {/* ปุ่มผู้เช่าออกปุ่มเดียว (ตกลง 6 พ.ย. 2026): อยู่ตลอด · บันทึกวันออกล่วงหน้าแล้ว = เปิดมาแก้ / ยกเลิกวันออก · ถึงวันแล้ว = ฟอร์มเต็ม */}
        {canSettle && full && !co && !l.deposit_settlement_type && depSameCcy && l.start_date <= today && (
          <CloseLeaseForm assetId={id} leaseId={l.id} tenant={[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}
            startDate={l.start_date} endDate={l.end_date} terminated={l.terminated_date} today={today} currency={l.rent_currency}
            banks={bankList} defaultBank={rentTo.get(l.id) ?? null} items={hand} isAdmin={me.role === "ADMIN"} />
        )}
        {/* เงินประกันคนละสกุล (ไม่มีฟอร์มผู้เช่าออก): แก้ / ยกเลิกวันเลิกสัญญา = ADMIN หรือ EDITOR ก่อนถึงวันนั้น */}
        {full && !depSameCcy && l.terminated_date && !co && l.deposit_settlement_type !== "REFUNDED"
          && (me.role === "ADMIN" || (canSettle && l.terminated_date > today)) && (
          <EditTerminationForm assetId={id} leaseId={l.id} terminated={l.terminated_date} startDate={l.start_date} endDate={l.end_date} />
        )}
        {canSettle && dep > 0 && !l.deposit_settled_date && leaseEnded && !depSameCcy && (
          <SettleDepositForm assetId={id} leaseId={l.id} deposit={dep} currency={l.deposit_currency ?? l.rent_currency}
            deduction={Math.min(hd.amount, dep)} reason={hd.reason}
            banks={bankList} minDate={l.deposit_due_date} today={today} />
        )}
        {canSettle && co && (full || me.role === "ADMIN") && (
          <UndoButton kind="CLOSEOUT" id={l.id} paths={paths} label="ยกเลิกผู้เช่าออก"
            confirmText={`ยกเลิกการบันทึกผู้เช่าออกของ ${l.tenant_name}?\nเงินโอนคืน ค่าเช่า / ค่าน้ำไฟที่หักจากเงินประกัน ค่าเสียหาย และค่าใช้จ่ายคืนค่าเช่าล่วงหน้า จะถูกลบทั้งหมด · เงินประกันกลับเป็นหนี้สิน · วันเลิกสัญญากลับเหมือนก่อนบันทึก`} />
        )}
        {canSettle && !co && l.deposit_settlement_type === "REFUNDED" && (full || me.role === "ADMIN") && (
          <UndoButton kind="DEPOSIT" id={l.id} paths={paths} label="ยกเลิกการคืนเงินประกัน"
            confirmText={`ยกเลิกการคืนเงินประกันของ ${l.tenant_name}?\nเงินคืนผู้เช่า และรายได้ส่วนที่หักไว้ จะถูกลบ · สัญญากลับมาถือเงินประกัน (หนี้สิน) เหมือนเดิม`} />
        )}
      </>
    );
  };
  const leaseCard = (l: Lease) => {
    const st = LEASE_STATUS[l.lease_status];
    const dep = Number(l.security_deposit ?? 0);
    const ds = DEPOSIT_LABEL[l.deposit_status];
    const leaseEnded = l.deposit_due_date <= today;
    return (
      <div key={l.id} className="rounded-lg border border-slate-200 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? l.lease_status}</span>
          <LeaseEditName leaseId={l.id}>
            <span className="font-medium">{[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}</span>
            {l.contract_no && <span className="text-xs text-slate-500"> · สัญญาเลขที่ {l.contract_no}</span>}
          </LeaseEditName>
        </div>
        <div className="mt-1 text-slate-600">
          {thDate(l.start_date)} – {thDate(l.end_date)}
          {l.terminated_date && <span className="text-red-600"> · เลิก {thDate(l.terminated_date)}</span>}
          {" · "}ค่าเช่า {money(l.rent_amount, l.rent_currency)} {FREQ_LABEL[l.payment_frequency] ?? ""}
          {l.payment_due_day && ` · จ่ายทุกวันที่ ${l.payment_due_day}`}
          {leaseExtra.get(l.id)?.prorate_basis === "DAYS30" && " · วันเศษหาร 30"}
          {leaseExtra.get(l.id)?.rent_timing === "ARREARS" && " · ค่าเช่าล่วงหน้ารวมกับมัดจำ (จ่ายเมื่อครบรอบ)"}
          {Number(leaseExtra.get(l.id)?.late_fee_per_day ?? 0) > 0
            && ` · ค่าปรับ ${money(Number(leaseExtra.get(l.id)!.late_fee_per_day))}/วัน หลังผ่อนผัน ${leaseExtra.get(l.id)!.grace_days} วัน`}
          {rentTo.get(l.id) && <span className="text-xs text-slate-500"> · รับเข้า {bankName.get(rentTo.get(l.id)!) ?? "บัญชีที่ปิดแล้ว"}</span>}
          {leaseExtra.get(l.id)?.utilities_billing && <span className="text-xs text-slate-500"> · ค่าน้ำไฟ: {UTILITIES_BILLING_LABEL[leaseExtra.get(l.id)!.utilities_billing!]}</span>}
        </div>
        {dep > 0 && (
          <div className="mt-1">
            เงินประกัน {money(dep, l.deposit_currency ?? undefined)}
            {l.deposit_carried_amount && <span className="text-slate-500"> (ยกมา {money(l.deposit_carried_amount)})</span>}
            {" · "}<span className={ds?.cls}>{ds?.text ?? l.deposit_status}
              {(l.deposit_status === "REFUND_PENDING" || l.deposit_status === "DEPOSIT_REFUND_OVERDUE") && ` (ภายใน ${thDate(l.deposit_refund_by)})`}</span>
            {l.deposit_received_date && l.deposit_received_date < goLive && l.deposit_status !== "SETTLED" &&
              <span className="text-xs text-slate-500"> · รับก่อน Go-live = อยู่ในยอดตั้งต้น</span>}
            {l.deposit_settlement_type === "REFUNDED" &&
              <span className="text-xs text-slate-500"> · คืน {money(l.deposit_refunded_amount)} เมื่อ {thDate(l.deposit_settled_date)}</span>}
            {l.deposit_settlement_type === "CARRIED_TO_NEW_LEASE" &&
              <span className="text-xs text-slate-500"> · ยกไปสัญญาใหม่ {thDate(l.deposit_settled_date)}
                {Number(l.deposit_refunded_amount ?? 0) > 0 && ` · คืนส่วนต่าง ${money(l.deposit_refunded_amount)}`}</span>}
          </div>
        )}
        {closeOf.get(l.id) && <div className="mt-1 text-slate-600">{closeoutText(l, closeOf.get(l.id)!)}</div>}
        {l.notes && <div className="mt-1 whitespace-pre-line text-xs text-slate-500">{l.notes}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-4">{leaseActions(l, true)}</div>
        {dep > 0 && !l.deposit_settled_date && !leaseEnded && (
          <p className="mt-1 text-xs text-slate-400">คืนเงินประกันได้ตั้งแต่ {thDate(l.deposit_due_date)}</p>
        )}
      </div>
    );
  };
  // สัญญาที่จบครบแล้ว (ไม่มีผล · เงินประกันเคลียร์แล้ว · ไม่มีค่าเช่า / ค่าน้ำไฟค้าง) → พับเป็นบรรทัดสั้นใน "สัญญาเดิม" (ตกลง 2 พ.ย. 2026)
  const leaseOpenItems = new Set([...rents.filter((x) => x.status === "OVERDUE" || x.status === "PENDING").map((x) => x.lease_id),
    ...charges.map((c) => c.lease_id)]);
  const leaseDone = (l: Lease) => !liveLeases.includes(l) && (Number(l.security_deposit ?? 0) <= 0 || !!l.deposit_settled_date) && !leaseOpenItems.has(l.id);
  const openLeases = leases.filter((l) => !leaseDone(l));
  const doneLeases = leases.filter(leaseDone);
  const leaseLine = (l: Lease) => {
    const st = LEASE_STATUS[l.lease_status];
    const dep = Number(l.security_deposit ?? 0);
    return (
      // แถวเดียว: ทุกชิ้นอยู่กึ่งกลางแนวเดียวกัน (เดิมจัดตามเส้นฐาน + ตัวหนังสือหลายขนาด → ดูเอียง)
      <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? l.lease_status}</span>
        <LeaseEditName leaseId={l.id}>
          <span className="font-medium">{[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}</span>
          {l.contract_no && <span className="text-slate-500"> · เลขที่ {l.contract_no}</span>}
        </LeaseEditName>
        <span className="text-slate-600">{thDate(l.start_date)} – {l.terminated_date ? <span className="text-red-600">เลิก {thDate(l.terminated_date)}</span> : thDate(l.end_date)}
          {" · "}ค่าเช่า {money(l.rent_amount, l.rent_currency)}
          {dep > 0 && <span className="text-slate-500"> · เงินประกัน {money(dep)}
            {l.deposit_settlement_type === "REFUNDED" ? ` คืน ${money(l.deposit_refunded_amount)} เมื่อ ${thDate(l.deposit_settled_date)}`
              : l.deposit_settlement_type === "CARRIED_TO_NEW_LEASE" ? ` ยกไปสัญญาใหม่ ${thDate(l.deposit_settled_date)}`
                + (Number(l.deposit_refunded_amount ?? 0) > 0 ? ` · คืนส่วนต่าง ${money(l.deposit_refunded_amount)}` : "") : ""}</span>}
          {closeOf.get(l.id) && <span className="block text-xs text-slate-500">{closeoutText(l, closeOf.get(l.id)!)}</span>}</span>
        <span className="ml-auto flex flex-wrap items-center gap-4">{leaseActions(l)}</span>
      </div>
    );
  };

  // หน้าต่างสัญญาเช่า (ปุ่มเดียว): ต่อได้ = ยังไม่บันทึกผู้เช่าออก · ไม่มีสัญญาถัดไปของห้องเดียวกัน · เริ่มแล้ว · ยังไม่คืนเงินประกัน
  //   แก้ไข = สัญญาปัจจุบันทั้งหมด + สัญญาเดิมที่จบแล้ว (ADMIN เท่านั้น)
  const canRenew = (l: Lease) => !closeOf.get(l.id) && !hasSuccessor(l) && l.lease_status !== "UPCOMING" && l.deposit_settlement_type !== "REFUNDED";
  const hubRenewals = canWrite ? renewals.filter((r) => leases.some((l) => l.id === r.id && canRenew(l))) : [];
  const editEntry = (l: Lease, old: boolean): LeaseEditEntry => {
    const x = leaseExtra.get(l.id);
    const fromL = l.deposit_carried_from_lease_id ? leases.find((o) => o.id === l.deposit_carried_from_lease_id) : undefined;
    const fromDep = Number(fromL?.security_deposit ?? 0);
    return {
      id: l.id, old, label: renewals.find((r) => r.id === l.id)?.label ?? l.tenant_name,
      m: { tenant_name: l.tenant_name, unit_label: l.unit_label, contract_no: l.contract_no, start_date: l.start_date, end_date: l.end_date,
        rent_amount: Number(l.rent_amount), payment_due_day: l.payment_due_day, prorate_basis: x?.prorate_basis ?? "ACTUAL",
        utilities_billing: x?.utilities_billing ?? null, notes: l.notes,
        rent_timing: x?.rent_timing ?? "ADVANCE", grace_days: x?.grace_days ?? 15,
        late_fee_per_day: x?.late_fee_per_day == null ? null : Number(x.late_fee_per_day), start_locked: closeOf.has(l.id) },
      v: x ?? {}, rentCurrency: l.rent_currency, rentTo: rentTo.get(l.id) ?? null, depositMonths: x?.deposit_months ?? null,
      // เงินประกัน (ตกลง 6 พ.ย. 2026): แก้ได้จนกว่าจะคืน / ยกไปสัญญาใหม่ / บันทึกผู้เช่าออก · ยกมา + น้อยกว่าเดิม = บัญชีของรายการคืนส่วนต่าง
      dep: {
        amount: Number(l.security_deposit ?? 0), currency: l.deposit_currency ?? l.rent_currency, received: l.deposit_received_date, goLive,
        locked: closeOf.has(l.id) ? "บันทึกผู้เช่าออกแล้ว (แก้ได้หลังกด “ยกเลิกผู้เช่าออก”)"
          : l.deposit_settlement_type === "REFUNDED" ? "คืนเงินประกันแล้ว"
          : l.deposit_settlement_type ? "ยกไปสัญญาใหม่แล้ว" : null,
        carried: fromL ? { deposit: fromDep } : null,
        bank: (fromL && Number(l.security_deposit ?? 0) < fromDep ? depOut.get(fromL.id) : depIn.get(l.id)) ?? null,
      },
      deleteControl: canDelete && <DeleteEntity kind="lease" id={l.id} paths={paths} label="ลบสัญญา" needReason={false}
        hint="รายการรับเงินประกัน / คืนส่วนต่างเงินประกัน (ตอนต่อสัญญา) ของสัญญานี้จะถูกลบด้วย"
        buttonCls="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50" />,
    };
  };
  const hubEdits = canWrite ? [...openLeases.map((l) => editEntry(l, false)), ...(me.role === "ADMIN" ? doneLeases.map((l) => editEntry(l, true)) : [])] : [];

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
              <PropertyPayForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} components={compOpts}
                cards={cards} persons={persons ?? []} />
              <SellAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} hasLease={liveLeases.length > 0}
                cards={cards} components={saleComps} demolishable={canDelete && demolishable.length > 0 && comps.length > 1 ? demolishable : undefined} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* 2 แถว (ตกลง 6 พ.ย. 2026): มูลค่า | รายละเอียด · เอกสาร | ประกันของทรัพย์สินนี้ — กล่องในแถวเดียวกันสูงเท่ากัน ขอบบน / รอยต่อ / ขอบล่างตรงกัน */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">มูลค่าล่าสุด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
          <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>
            ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}
          </div>
          {/* ราคาที่ได้มา · ค่าใช้จ่าย · มูลค่าล่าสุดเทียบราคาที่ได้มา (บวก = เขียว · ลบ = แดง · ตกลง 29 ต.ค. 2026) */}
          {acqAll != null && (
            <div className="mt-1 text-xs text-slate-500">ราคาที่ได้มา {money(acqAll)}{a.acquisition_date && ` (${thDate(a.acquisition_date)})`}</div>
          )}
          <div className="mt-0.5 text-xs text-slate-500"><a href="#expenses" className="hover:underline">ค่าใช้จ่าย {money(spentSum)} บาท</a>
            {spentLast && ` (ล่าสุด ${thDate(spentLast)})`}</div>
          {acqAll != null && acqAll > 0 && a.current_value != null && (() => {
            const d = Number(a.current_value) - acqAll;
            return <div className={`mt-0.5 text-xs font-medium ${d >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              มูลค่าล่าสุด{d >= 0 ? "สูงกว่า" : "ต่ำกว่า"}ราคาที่ได้มา {diffText(d, acqAll)}</div>;
          })()}
          {/* ปุ่มเดียว "ปรับมูลค่า / ประวัติ": อัปเดตมูลค่า + ประวัติตารางเดียว (เงินจ่าย / รับ · มูลค่าเปลี่ยน · ตกลง 29 ต.ค. 2026) */}
          <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
            paths={paths} canWrite={canWrite} canDelete={canDelete} singleLabel="ปรับมูลค่า / ประวัติ" flow={Object.fromEntries(compLabel)}
            deletableValuation={deletableVal}
            paymentEditor={(m) => (
              <PropertyPaymentForm assetId={id} currency={a.currency} paths={paths} m={m} addedValue={m.add_value} components={compOpts} />)}
            valuations={(vals ?? []).map((v) => ({ ...v, value: Number(v.value), detail: partText(v.id) || null }))} sourceLabel={SOURCE_LABEL} methodLabel={METHOD_LABEL}
            valuationHint="แนะนำประเมินใหม่อย่างน้อยทุก 90 วัน (หรือเมื่อมีการประเมินจากธนาคาร)"
            valuationForm={canWrite && a.status === "ACTIVE" ? <ValuePartsForm key={partsKey} assetId={id} currency={a.currency} today={today} minDate={goLive} deeds={deedOptsCost} latest={latestParts}
              acqTotal={acqAll} currentValue={a.current_value != null ? Number(a.current_value) : null} /> : undefined} />
          {/* ราคาขายขั้นต่ำที่คุ้ม (เทียบมูลค่าล่าสุด) ก่อนราคาตลาด (เทียบราคาขายขั้นต่ำ) · ตกลง 29 ต.ค. 2026 */}
          <TargetBox currency={a.currency} target={(targetRow as TargetPrice | null) ?? null} nwValue={Number(a.current_value ?? 0)}
            lastCpi={cpiLast ? { year: Number(cpiLast.year), pct: cpiLast.inflation_pct != null ? Number(cpiLast.inflation_pct) : null } : null}
            unit={targetUnit(((marketRows ?? []) as MarketValuation[])[0], pd.land_area_sq_wa)}
            lots={<CostLotsSection assetId={id} currency={a.currency} today={today} lots={lots} canWrite={canWrite && a.status === "ACTIVE"} canDelete={canDelete} paths={paths} />} />
          <MarketBox assetId={id} currency={a.currency} today={today} propertyType={pd.property_type}
            areaSqWa={pd.land_area_sq_wa != null ? Number(pd.land_area_sq_wa) : null} nwValue={Number(a.current_value ?? 0)}
            minPrice={(targetRow as TargetPrice | null)?.min_price != null ? Number((targetRow as TargetPrice).min_price) : null}
            history={(marketRows ?? []) as MarketValuation[]} debt={debt} canWrite={canWrite && a.status === "ACTIVE"} canDelete={canDelete} paths={paths} />
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
                <Item label={lands.length > 1 ? `เนื้อที่ (รวม ${lands.length} โฉนด)` : "เนื้อที่"}>{landText(pd.land_area_sq_wa)}</Item>
                <Item label="กลุ่มทำเล">{pd.location_group || "-"}</Item>
                <Item label="ตำบล / อำเภอ / จังหวัด">{[pd.subdistrict, pd.district, pd.province].filter(Boolean).join(" · ") || "-"}</Item>
                <Item label="วันที่ได้มา">{a.acquisition_date ? thDate(a.acquisition_date) : "-"}</Item>
                <Item label="ราคาที่ได้มา" num>{money(a.acquisition_cost, undefined, 0)}</Item>
                <Item label="สถานะ">{ASSET_STATUS_LABEL[a.status] ?? a.status}</Item>
                <Item label="เจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {pd.house_no && <Item label="บ้านเลขที่">{pd.house_no}</Item>}
                {pd.unit_no && <Item label="ห้องชุด">{[`เลขที่ ${pd.unit_no}`, pd.floor_no && `ชั้น ${pd.floor_no}`, pd.building_name].filter(Boolean).join(" · ")}</Item>}
                {pd.address && <Item label="ที่อยู่" wide>{pd.address}</Item>}
                {(pd.map_url || pd.latitude != null) && (
                  <Item label="ตำแหน่ง" wide>
                    <div className="flex flex-wrap items-center gap-3">
                      <a href={pd.map_url || `https://www.google.com/maps?q=${Number(pd.latitude)},${Number(pd.longitude)}`} target="_blank" rel="noopener noreferrer"
                        className="rounded-md border border-blue-600 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50">เปิดใน Google Maps ↗</a>
                      {pd.latitude != null && <span className="text-xs tabular-nums text-slate-500">{Number(pd.latitude)}, {Number(pd.longitude)}</span>}
                      <Link href={`/print/property?${new URLSearchParams({ ids: id, back: `/property/${id}` })}`} target="_blank"
                        title="พิมพ์ / บันทึก PDF แปลงนี้: รูปแผนที่ดาวเทียม + รายละเอียด"
                        className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">พิมพ์ / PDF</Link>
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
              {compTable}
            </>}
            edit={
              <div className="space-y-5">
                <p className="text-xs text-slate-500">แก้ข้อมูล ส่วนประกอบ ต้นทุน และมูลค่าได้ในฟอร์มเดียว · มูลค่าเปลี่ยน = บันทึกเป็นมูลค่าครั้งใหม่ (เก็บประวัติ)</p>
                <WithStatus status={{ table: "assets", id, value: a.status, paths, label: "สถานะทรัพย์สิน",
                  options: [["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["GIFTED", "ยกให้แล้ว"], ["LOST", "สูญหาย / เสียหาย"]],
                  remove: canDelete && !hasHistory ? { kind: "asset", id, redirectTo: "/property", paths: ["/property"], label: "ลบทรัพย์สินนี้", hint: "สัญญาเช่า มูลค่า และสาธารณูปโภคจะถูกลบด้วย · ลบไม่ได้ถ้ามีค่าเช่า / เงินประกันที่บันทึกแล้ว" } : undefined }}>
                  <EditPropertyForm p={{ ...pd, name: a.name, notes: a.notes, acquisition_date: a.acquisition_date,
                    acquisition_cost: a.acquisition_cost, asset_id: id }} components={comps} latest={latestByComp} currency={a.currency}
                    currentValue={a.current_value != null ? Number(a.current_value) : null} today={today} minDate={goLive}
                    locked={comps.filter((c) => c.source_movement_id || paidComp.has(c.id)).map((c) => c.id)}
                    family={{ method: family?.opportunity_method ?? "FIXED", rate: family?.opportunity_rate_pct != null ? Number(family.opportunity_rate_pct) : null }} />
                </WithStatus>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                </div>
                {canDelete && hasHistory && <p className="text-xs text-slate-500">มีประวัติแล้ว (ซื้อ / ขาย หรือมูลค่ามากกว่า 1 ครั้ง) → ลบไม่ได้ · ถ้าไม่ได้ถือแล้ว ให้เปลี่ยนสถานะเป็น ขายแล้ว / ยกให้แล้ว / สูญหาย</p>}
              </div>
            } />
        </div>
        <div className="flex flex-col">
          <EntityDocuments category="PROPERTY" entityType="ASSET" entityId={id} module="PROPERTY" role={me.role} paths={paths} fill />
        </div>
        {/* ประกันของทรัพย์สินนี้ (ตกลง 3 พ.ย. 2026): กรมธรรม์ละแถว กดชื่อไปหน้ากรมธรรม์ · ยังไม่มี = ปุ่มเพิ่ม (เลือกประเภท / ทรัพย์สินไว้ให้) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium text-slate-900">ประกันของทรัพย์สินนี้{insPols.length > 0 && ` (${insPols.length})`}</h2>
            {canWrite && a.status === "ACTIVE" && insPols.length > 0 && <Link href={newInsHref} className={SMALL_BTN}>+ เพิ่มประกัน</Link>}
          </div>
          {insPols.length === 0 ? (
            <>
              <p className="mt-1 text-sm text-slate-500">ยังไม่มีประกัน</p>
              {canWrite && a.status === "ACTIVE" && <Link href={newInsHref} className={`mt-3 inline-block ${SMALL_BTN}`}>+ เพิ่มประกันทรัพย์สินนี้</Link>}
            </>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1.5">กรมธรรม์</th><th className="px-3 text-right">ทุนประกัน</th><th className="px-3 text-right">เบี้ยต่อปี</th>
                    <th className="px-3">สิ้นสุด</th><th className="pl-3">สถานะ / เบี้ย</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {insPols.map((x) => {
                    const mine = insDue.filter((d) => d.policy_id === x.id);
                    const late = mine.filter((d) => d.status === "OVERDUE").length;
                    const next = mine.find((d) => d.status !== "OVERDUE");
                    return (
                      <tr key={x.id} className={`align-top ${x.status !== "ACTIVE" ? "opacity-60" : ""}`}>
                        <td className="py-2"><Link href={`/insurance/${x.id}`} className="font-medium text-slate-900 hover:underline">{x.insurer}</Link>
                          {x.policy_no && <div className="text-xs text-slate-500">{x.policy_no}</div>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.insured_amount != null ? money(x.insured_amount, x.insured_amount_currency ?? undefined, 0) : "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.premium != null ? money(x.premium, x.premium_currency ?? undefined, 0) : "-"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{x.end_date ? thDate(x.end_date) : "-"}</td>
                        <td className="py-2 pl-3 text-xs">
                          {(x.status !== "ACTIVE" ? [<span key="s" className="text-slate-500">{INS_STATUS_LABEL[x.status] ?? x.status}</span>] : [
                            x.derived_status === "EXPIRED" && <span key="e" className="text-red-600">เลยวันสิ้นสุด</span>,
                            x.derived_status === "EXPIRING_SOON" && <span key="e" className="text-amber-700">ใกล้ครบ</span>,
                            late > 0 && <span key="l" className="text-red-600">เบี้ยเลยกำหนด {late} งวด</span>,
                            next ? <span key="n" className="text-slate-500">เบี้ยงวดถัดไป {thDate(next.due_date)} {money(next.remaining, next.currency !== "THB" ? next.currency : undefined)}</span>
                              : late === 0 && <span key="n" className="text-slate-500">ไม่มีเบี้ยค้าง</span>,
                          ]).filter(Boolean).map((n, i) => <div key={i}>{n}</div>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---------------- ของในทรัพย์สิน (มิเตอร์ กุญแจ บัตร เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า · ไม่นับใน Net Worth · ตกลง 2 พ.ย. 2026) ---------------- */}
      {(isRental || inv.length > 0) && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium text-slate-900">ของในทรัพย์สิน <InfoTip label="คำอธิบาย">เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า กุญแจ บัตร รีโมท · ไม่นับในความมั่งคั่งสุทธิ (ซื้อ = ค่าใช้จ่าย · ขาย = รายได้) · ใช้ทำรายการส่งมอบของแต่ละสัญญา (มิเตอร์ดึงจากสาธารณูปโภค){multiRoom ? " · ของส่วนกลางส่งมอบให้ทุกห้อง" : ""}</InfoTip></h2>
            </div>
            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                {multiRoom && inv.length > 0 && <CopyRoomButton assetId={id} rooms={rooms} roomsWithItems={roomsWithItems} />}
                <InventoryAddButton assetId={id} rooms={multiRoom ? rooms : []} roomsWithItems={roomsWithItems} pays={payOpts.slice(1)} today={today} minDate={goLive || undefined} currency={a.currency} />
              </div>
            )}
          </div>
          {inv.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ · เพิ่มเฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า กุญแจ คีย์การ์ด ฯลฯ แล้วดึงเข้ารายการส่งมอบตอนทำสัญญา</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>{multiRoom && <th className="py-1">ห้อง</th>}<th>ประเภท</th><th>รายการ</th><th className="text-right">จำนวน</th><th className="pl-4">ยี่ห้อ / รุ่น</th>
                    <th>Serial</th><th className="text-right">มูลค่าต่อชิ้น</th><th className="text-right">มูลค่าชำรุดต่อชิ้น</th>
                    <th className="text-right">มูลค่าทดแทน</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(multiRoom ? [...inv].sort((x, y) => (x.unit_label ?? "").localeCompare(y.unit_label ?? "", "th", { numeric: true })) : inv).map((x) => (
                    <tr key={x.id} className="align-top">
                      {multiRoom && <td className="py-1.5 text-slate-600">{x.unit_label || <span className="text-slate-400">{COMMON_ROOM_LABEL}</span>}</td>}
                      <td className="py-1.5 text-xs text-slate-600">{INVENTORY_TYPE_LABEL[x.item_type] ?? x.item_type}</td>
                      <td>{x.name}{(x.notes || boughtOn(x)) && <div className="text-xs text-slate-400">{[boughtOn(x) && `ซื้อ ${thDate(boughtOn(x))} (ลงค่าใช้จ่ายแล้ว)`, x.notes].filter(Boolean).join(" · ")}</div>}</td>
                      <td className="text-right tabular-nums">{Number(x.qty).toLocaleString("th-TH")}</td>
                      <td className="pl-4 text-slate-600">{x.brand ?? "-"}</td>
                      <td className="text-slate-600">{x.serial_no ?? "-"}</td>
                      <td className="text-right tabular-nums">{x.value != null ? money(x.value) : "-"}</td>
                      <td className="text-right tabular-nums">{x.damage_value != null ? money(x.damage_value) : "-"}</td>
                      {/* มูลค่าทดแทน = จำนวน × มูลค่าต่อชิ้น */}
                      <td className="text-right tabular-nums">{x.value != null ? money(Number(x.qty) * Number(x.value)) : "-"}</td>
                      <td className="whitespace-nowrap pl-2 text-right">
                        {canWrite && <DisposeButton assetId={id} itemId={x.id} name={x.name} today={today} minDate={goLive || undefined}
                          banks={bankList.filter((b) => b.currency === a.currency).map((b) => [b.asset_id, b.name] as [string, string])} />}{" "}
                        {canWrite && <RowActions table="property_inventory_items" id={x.id} paths={paths} canDelete={canDelete} deleteEffect="" fields={[
                          ...(multiRoom ? [{ name: "unit_label", label: "ห้อง (ว่าง = ส่วนกลาง)", value: x.unit_label, width: "w-28" }] : []),
                          { name: "item_type", label: "ประเภท", type: "select" as const, value: x.item_type,
                            options: INVENTORY_METER_TYPES.includes(x.item_type) ? [...INVENTORY_PICK_TYPES, [x.item_type, INVENTORY_TYPE_LABEL[x.item_type]] as [string, string]] : INVENTORY_PICK_TYPES },
                          { name: "name", label: "รายการ", value: x.name },
                          { name: "qty", label: "จำนวน", type: "number" as const, value: x.qty, width: "w-20" },
                          { name: "brand", label: "ยี่ห้อ / รุ่น", value: x.brand },
                          { name: "serial_no", label: "Serial", value: x.serial_no },
                          { name: "value", label: "มูลค่าต่อชิ้น", type: "number" as const, value: x.value },
                          { name: "damage_value", label: "มูลค่าชำรุดต่อชิ้น", type: "number" as const, value: x.damage_value },
                          { name: "notes", label: "หมายเหตุ", value: x.notes, width: "w-40" }]} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {invGone.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-slate-500">ขาย / ทิ้งแล้ว ({invGone.length})</summary>
              <ul className="mt-2 divide-y divide-slate-100">
                {invGone.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-slate-600">
                    <span>{multiRoom && x.unit_label && <span className="text-slate-400">{x.unit_label} · </span>}{x.name}
                      <span className="text-xs text-slate-400"> · {INVENTORY_DISPOSAL_LABEL[x.disposal_type ?? ""]} {thDate(x.disposed_date)}
                        {x.disposal_amount != null && ` · ได้ ${money(x.disposal_amount, a.currency)} (ลงรายได้แล้ว)`}</span></span>
                    {canDelete && <UndoDisposalButton assetId={id} itemId={x.id} />}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ---------------- สัญญาเช่า (แสดงเฉพาะที่ให้เช่า · ไม่ได้ให้เช่าแล้วแต่เคยมีสัญญา → พับเป็นประวัติ · ตกลง 27 ต.ค. 2026) ---------------- */}
      {(isRental || leases.length > 0) && <LeaseWrap open={isRental} count={leases.length}>
      <LeaseHub enabled={canWrite} assetId={id} banks={bankList} goLive={goLive} currency={a.currency} carryOptions={carryOptions}
        detail={{ opt: detailOpt, canSensitive }} renewals={hubRenewals} edits={hubEdits}>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">สัญญาเช่า</h2>
          <LeaseHubButton label={leases.length === 0 ? "+ เริ่มให้เช่า (เพิ่มสัญญา)" : "+ สัญญาใหม่ / ต่อสัญญา / แก้ไข"} />
        </div>
        {canWrite && pd.usage_type === "RENTAL" && liveLeases.length === 0 && <SuggestVacant assetId={id} />}

        {openLeases.map(leaseCard)}
        {doneLeases.length > 0 && (isRental ? (
          <details className="rounded-lg border border-slate-200 text-sm">
            <summary className="cursor-pointer px-4 py-3 text-slate-700">สัญญาเดิม ({doneLeases.length})
              <span className="ml-2 text-xs text-slate-500">จบแล้ว ไม่มีรายการค้าง · กดเพื่อดู</span></summary>
            <div className="divide-y divide-slate-100 border-t border-slate-200">{doneLeases.map(leaseLine)}</div>
          </details>
        ) : <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">{doneLeases.map(leaseLine)}</div>)}

      </section>

      {(rents.length > 0 || otherPaid.length > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">ค่าเช่า <InfoTip label="คำอธิบาย">ควรได้ vs ได้รับจริง นับตั้งแต่เดือน Go-live · การบันทึกรับจะสร้างรายได้ค่าเช่าและเงินเข้าบัญชีให้ · กดยอดที่รับแล้วเพื่อแก้ไข / ลบ (ลบแล้วงวดนั้นกลับเป็น &ldquo;รอรับ&rdquo; · ผิดบัญชีให้ลบแล้วบันทึกรับใหม่ · งวดที่ปิดแล้วต้อง Reopen ก่อน)</InfoTip></h2>
          {rents.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">งวด</th><th>สัญญา</th><th className="text-right">ควรได้</th><th className="text-right">ได้รับ</th>
                <th className="pl-4">สถานะ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rents.map((r) => {
                const got = paidByPeriod.get(rentKey(r.lease_id, r.income_period)) ?? [];
                const over = Number(r.received_amount) - Number(r.expected_amount);
                return (
                <tr key={`${r.lease_id}-${r.income_period}`} className="align-top">
                  <td className="py-1.5">{thMonth(r.income_period)}<CycleNote start={r.cycle_start} end={r.cycle_end} expected={r.expected_amount} rent={rentOf.get(r.lease_id)} /></td>
                  <td className="text-xs text-slate-600">{r.name.split(" · ").slice(1).join(" · ")}<div className="text-slate-400">ครบ {thDate(r.due_date)}</div></td>
                  <td className="text-right tabular-nums">{money(r.expected_amount)}</td>
                  <td className="text-right tabular-nums">
                    {got.length === 0 ? (Number(r.received_amount) > 0 ? money(r.received_amount) : "-") : got.map((x) => (
                      <div key={x.id} className="mb-1 last:mb-0">
                        {canWrite && !closeIncome.has(x.id) ? <RowActions table="income_transactions" id={x.id} paths={paths} canDelete={canDelete}
                          fields={rentIncomeFields(x)} button={`${money(x.amount)} ✎`} buttonClass={AMT} /> : money(x.amount)}
                        <div className="text-xs text-slate-500">รับ {thDate(x.date)}{Number(x.tax ?? 0) > 0 && ` · ภาษี ${money(x.tax)}`}</div>
                        <div className="text-xs text-slate-400">{x.received_to_asset_id ? bankName.get(x.received_to_asset_id) ?? "บัญชี" : "ไม่ผ่านบัญชี"}</div>
                        {x.notes && <div className="text-xs text-slate-400">{x.notes}</div>}
                        {canWrite && closeIncome.has(x.id) && <div>{CLOSE_NOTE}</div>}
                      </div>
                    ))}
                    {r.status === "RECEIVED" && over > 0.005 && <div className="text-xs text-amber-700">รับเกิน {money(over)}
                      {closeOf.has(r.lease_id) ? " · คืนแล้วตอนผู้เช่าออก" : ""}</div>}
                  </td>
                  <td className={`pl-4 ${r.in_grace ? "text-amber-700" : RENT_STATUS[r.status]?.cls ?? ""}`}>
                    {r.in_grace ? "ครบกำหนด" : RENT_STATUS[r.status]?.text ?? r.status}
                    {r.status === "OVERDUE" && r.days_past_due != null && (
                      <div className="text-xs">{r.in_grace ? `เลย ${r.days_past_due} วัน · ผ่อนผัน ${r.grace_days} วัน` : `เลยกำหนด ${r.days_past_due} วัน`}
                        {Number(r.late_fee ?? 0) > 0 && ` · ค่าปรับ ${money(r.late_fee)}`}</div>
                    )}</td>
                  <td className="text-right">
                    {canWrite && (r.status === "OVERDUE" || r.status === "PENDING") && (
                      <RecordRentForm assetId={id} leaseId={r.lease_id} period={r.income_period}
                        expected={Number(r.expected_amount) - Number(r.received_amount)} currency={r.currency}
                        banks={bankList} today={today} defaultBank={rentTo.get(r.lease_id) ?? lastRentBank.get(r.lease_id)}
                        late={Number(r.late_fee_per_day ?? 0) > 0 ? { due: r.due_date, grace: Number(r.grace_days ?? 0), perDay: Number(r.late_fee_per_day) } : undefined} />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {otherPaid.length > 0 && (
          <div className={rents.length > 0 ? "mt-5" : ""}>
          <h3 className="mb-1 text-sm font-medium text-slate-700">รายการรับอื่น</h3>
          <p className="mb-2 text-xs text-slate-500">ค่าน้ำไฟเรียกเก็บ · หักจากเงินประกัน · ค่าเช่างวดเก่ากว่าตารางด้านบน · กดที่แถวเพื่อแก้ไข / ลบ</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่รับ</th><th>งวด</th><th>สัญญา</th><th className="text-right">ยอด</th><th className="pl-4">เข้าบัญชี</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {otherPaid.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1.5">{thDate(r.date)}</td>
                  <td>{r.income_type === "RENT" ? thMonth(r.income_period) : r.income_subtype === REBILL_SUBTYPE
                    ? <>{thMonth(r.income_period)}<div className="text-xs text-slate-500">ค่าน้ำไฟเรียกเก็บ</div></>
                    : <span className="text-xs text-slate-500">หักจากเงินประกัน</span>}</td>
                  <td className="text-xs text-slate-600">{leaseName.get(r.lease_id as string) ?? "-"}{r.notes && <div className="text-slate-400">{r.notes}</div>}</td>
                  <td className="text-right tabular-nums">{money(r.amount, r.currency)}{Number(r.tax ?? 0) > 0 && <div className="text-xs text-slate-500">ภาษี {money(r.tax)}</div>}</td>
                  <td className="pl-4 text-xs text-slate-600">{r.received_to_asset_id ? bankName.get(r.received_to_asset_id) ?? "บัญชี" : "ไม่ผ่านบัญชี"}</td>
                  <td className="pl-2 text-right">
                    {closeIncome.has(r.id) ? CLOSE_NOTE : r.income_type !== "RENT" && r.income_subtype !== REBILL_SUBTYPE && <span className="text-xs text-slate-400">ยกเลิกที่ &ldquo;ยกเลิกการคืนเงินประกัน&rdquo; ในสัญญา</span>}
                    {canWrite && !closeIncome.has(r.id) && (r.income_type === "RENT" || r.income_subtype === REBILL_SUBTYPE) && <RowActions table="income_transactions" id={r.id} paths={paths} canDelete={canDelete}
                      fields={rentIncomeFields(r)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
        </section>
      )}

      {charges.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">{charges.some((c) => c.kind === "DAMAGE") ? "เรียกเก็บผู้เช่า (รอรับ)" : "ค่าน้ำไฟเรียกเก็บผู้เช่า (รอรับ)"} <InfoTip label="คำอธิบาย">ค่าน้ำไฟ: เราจ่ายไปแล้ว รอผู้เช่าจ่ายคืน · ไม่เรียกเก็บแล้ว = กดที่แถวแล้วลบ
            · ค่าเสียหายส่วนที่เกินเงินประกัน: มาจากการบันทึกผู้เช่าออก (แก้ / ลบที่ &ldquo;ยกเลิกผู้เช่าออก&rdquo;) · รับแล้วนับเป็นรายได้ของ Property</InfoTip></h2>
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
                      {canWrite && c.kind !== "DAMAGE" && <RowActions table="lease_utility_charges" id={c.id} paths={paths} canDelete={canDelete} deleteEffect=""
                        fields={[{ name: "amount", label: "ยอดเรียกเก็บ", type: "number", value: c.amount }, { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      </LeaseHub>
      </LeaseWrap>}

      {/* ---------------- ค่าใช้จ่ายของทรัพย์สินนี้: ครั้งเดียว (ซ่อม / ปรับปรุง) + ประจำ / สาธารณูปโภค ---------------- */}
      <section id="expenses" className="scroll-mt-20 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ค่าใช้จ่ายของทรัพย์สินนี้ <InfoTip label="คำอธิบาย">ซ่อม / ปรับปรุงที่ไม่เพิ่มมูลค่า ค่าใช้จ่ายประจำ และเบี้ยประกัน · เข้าหน้า Income &amp; Expenses ไม่เพิ่มราคาที่ได้มา</InfoTip></h2>
            {[...yearly.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
              <p key={ccy} className="text-xs text-slate-500">ประมาณการต่อปี <span className="font-medium tabular-nums text-slate-700">{money(v, ccy, 0)}</span></p>
            ))}
          </div>
          {canWrite && <div className="flex flex-wrap items-start gap-2">
            {a.status === "ACTIVE" && <RecordCostForm assetId={id} label="" expected={0} currency={a.currency} category="บ้าน / สาธารณูปโภค"
              banks={bankList} cards={cards} persons={persons ?? []} today={today} minDate={goLive} />}
            <UtilityForm assetId={id} propertyId={pd.id} currency={a.currency} pays={payOpts.slice(1)} label="+ ค่าใช้จ่ายประจำ" asButton
              rooms={multiRoom ? rooms : []} usedRooms={utilities.map((u) => [u.utility_type, u.unit_label?.trim() ?? ""] as [string, string])} />
          </div>}
        </div>
        {oneOff.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">ค่าใช้จ่ายครั้งเดียว</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">วันที่จ่าย</th><th>ประเภท</th><th>รายการ</th><th className="text-right">ยอด</th><th className="pl-4">จ่ายด้วย</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {oneOff.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-1.5">{thDate(e.date)}</td>
                    <td className="text-xs text-slate-600">{PROPERTY_COST_TYPE_LABEL[e.property_cost_type ?? ""] ?? "-"}</td>
                    <td>{e.description || "-"}{e.notes && <div className="text-xs text-slate-400">{e.notes}</div>}</td>
                    <td className="text-right tabular-nums">{money(e.amount, e.currency)}</td>
                    <td className="pl-4 text-xs text-slate-600">
                      {e.paid_from_asset_id ? bankName.get(e.paid_from_asset_id) ?? "บัญชี" : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด"}
                    </td>
                    <td className="pl-2 text-right">
                      {closeExpense.has(e.id) ? CLOSE_NOTE : canWrite && expCtx && <OneOffExpenseEdit e={e} ctx={expCtx} paths={paths} canDelete={canDelete} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {insPays.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">เบี้ยประกัน</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">วันที่จ่าย</th><th>รายการ</th><th className="text-right">ยอด</th><th className="pl-4">จ่ายด้วย</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {insPays.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-1.5">{thDate(e.date)}</td>
                    <td>{e.description || "เบี้ยประกัน"}{e.notes && <div className="text-xs text-slate-400">{e.notes}</div>}</td>
                    <td className="text-right tabular-nums">{money(e.amount, e.currency)}</td>
                    <td className="pl-4 text-xs text-slate-600">
                      {e.paid_from_asset_id ? bankName.get(e.paid_from_asset_id) ?? "บัญชี" : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด"}
                    </td>
                    <td className="pl-2 text-right text-xs">
                      {e.policyId && <Link href={`/insurance/${e.policyId}?tab=flow`} className="text-blue-700 hover:underline" title="ไปหน้ากรมธรรม์">กรมธรรม์ →</Link>}
                      {/* กดที่แถว → แก้ / ลบการจ่ายเบี้ย (ช่องเดียวกับหน้ากรมธรรม์ / Income & Expenses · ตกลง 10 พ.ย. 2026) */}
                      {canWrite && <RowActions table="expense_items" id={e.id} paths={[...paths, "/insurance", ...(e.policyId ? [`/insurance/${e.policyId}`] : [])]}
                        canDelete={canDelete} fields={premiumPaymentFields(e)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="text-sm font-medium text-slate-700">ค่าใช้จ่ายประจำ / สาธารณูปโภค</h3>
        {utilities.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล · เพิ่มค่าส่วนกลาง ภาษีที่ดิน ไฟ น้ำ พร้อมยอดประมาณเพื่อติดตามการจ่าย</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">รายการ</th>{multiRoom && <th>ห้อง</th>}<th className="text-right">ยอดประมาณ</th><th className="pl-4">กำหนดจ่าย</th><th className="pl-4">ข้อมูลอ้างอิง</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {utilities.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-1.5">{utilName(u.utility_type, u.provider)}</td>
                  {multiRoom && <td className="text-slate-600">{u.unit_label || <span className="text-slate-400">{COMMON_ROOM_LABEL}</span>}</td>}
                  <td className="text-right tabular-nums">{u.expected_amount != null ? money(u.expected_amount, u.currency) : <span className="text-slate-400">ไม่ติดตาม</span>}</td>
                  <td className="pl-4 text-slate-600">{scheduleText(u.frequency, u.due_day, u.due_month) || "-"}</td>
                  <td className="pl-4 text-xs text-slate-500">
                    {[u.account_no && `เลขที่ผู้ใช้ ${u.account_no}`, u.meter_no && `มิเตอร์ ${u.meter_no}`, u.notes].filter(Boolean).join(" · ")}
                  </td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="property_utilities" id={u.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "provider", label: "ผู้ให้บริการ / ผู้เก็บ", value: u.provider },
                      ...(multiRoom ? [{ name: "unit_label", label: "ห้อง (ว่าง = ส่วนกลาง)", value: u.unit_label, width: "w-28" }] : []),
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
                          rebillLeases={["ELECTRICITY", "WATER"].includes(c.utility_type) ? rebillFor(c.utility_id) : []} />
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
            <h3 className="mb-2 text-sm font-medium text-slate-700">ประวัติจ่าย <InfoTip label="คำอธิบาย">กดที่แถวเพื่อแก้ไข / ลบ · ลบแล้วงวดนั้นกลับเป็น &ldquo;รอจ่าย&rdquo; · งวดที่ปิดแล้วต้อง Reopen ก่อน</InfoTip></h3>
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

      {/* ---------------- ภาษีที่ดินและสิ่งปลูกสร้าง ---------------- */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ภาษีที่ดินและสิ่งปลูกสร้าง <InfoTip label="คำอธิบาย">ที่ดิน + สิ่งปลูกสร้าง (หักค่าเสื่อม) − ยกเว้น = ฐานภาษี × อัตรา − ส่วนลด · ปีปัจจุบันตั้งเป็นยอดประมาณ &ldquo;ภาษีที่ดิน&rdquo; ในค่าใช้จ่ายประจำให้</InfoTip></h2>
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
