import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, INCOME_TYPE_LABEL, LAND_TAX_RATE_BY_USAGE, LEASE_STATUS, PROPERTY_TYPE_LABEL, REBILL_SUBTYPE, marketDefaultUnit, landTaxYears, USAGE_LABEL, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, addDays, durationText, landText, money, monthOptions, monthRange, monthsBetween, thDate, thMonth, todayBangkok, vacancyWarning, signedMoney, signedPct, plusMoney, minusMoney, PERIODS_PER_YEAR, TH_MONTHS } from "@/lib/format";
import { periodsIn, yearSpan } from "@/lib/property-year";
import { cycleNote } from "@/lib/lease";
import { loadPersonView } from "@/lib/person-view";
import { endpointValue } from "@/lib/money-endpoint";
import PersonFilter from "@/components/PersonFilter";
import { HeaderFilters, InfoTip, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import MonthPicker from "@/components/MonthPicker";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import PropertyTable, { type PropRow } from "./PropertyTable";
import RentBatch, { type OtherIncome, type RentRow } from "./RentBatch";
import { recEdit, recLabel } from "@/lib/recorded-edit";
import { assetIncomeFields, propertyCostFields, rentIncomeFields } from "@/lib/source-edit";
import RowActions from "@/components/RowActions";
import ExpenseBatch, { type CostRow, type OtherCost, type PayOpt } from "./ExpenseBatch";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { TabNav, TabPanel, TabsProvider } from "../income-expenses/tabs";
import { MonthChange, StatBox } from "@/components/Boxes";
import { changePct, prevMonthValue } from "@/lib/month-change";
import ValueBatch, { type ValueRow } from "./ValueBatch";
import { compName, type Component } from "./components";
import type { MarketValuation } from "./MarketValuationForm";
import LandTaxTable, { type TaxLineRow, type TaxPropRow } from "./LandTaxTable";
import { ShareBox } from "@/components/ShareTable";

type Prop = { id: string; asset_id: string; property_type: string; usage_type: string; vacant_since: string | null; location_group: string | null;
  land_area_sq_wa: number | null; latitude: number | null; longitude: number | null; address: string | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string;
    acquisition_cost: number | null; acquisition_date: string | null } };
type Lease = { id: string; property_asset_id: string; tenant_name: string; unit_label: string | null; rent_amount: number;
  rent_currency: string; payment_frequency: string; start_date: string; end_date: string; lease_status: string };
type Inc = { id: string; asset_id: string; lease_id: string | null; received_to_asset_id: string | null; income_type: string; date: string; amount: number; currency: string; base_amount: number | null; notes: string | null;
  tax: number | null; income_subtype: string | null; pending_split: boolean | null; income_period: string | null };
type Exp = { id: string; related_asset_id: string | null; property_utility_id: string | null; date: string; description: string;
  amount: number; currency: string; base_amount: number | null; notes: string | null; pending_split: boolean | null;
  source_cash_movement_id: string | null; liability_id: string | null; insurance_schedule_line_id: string | null; cost_period: string | null };
type Util = { id: string; property_id: string; unit_label: string | null; paid_from_asset_id: string | null; paid_from_credit_card_id: string | null;
  expected_amount: number | null; currency: string; frequency: string | null; due_month: number | null; active: boolean; deleted_at: string | null };

// ทรัพย์สินทั้งหมดอยู่ท้ายแท็บภาพรวม (ลิงก์เดิม ?tab=all → ภาพรวม)
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["update", "อัปเดตมูลค่า"], ["income", "บันทึกรับค่าเช่า/สัญญาเช่า"], ["expense", "ค่าใช้จ่าย"]];
const TYPE_COLORS: Record<string, string> = { LAND: "#3b82f6", HOUSE: "#8b5cf6", CONDO: "#10b981", OTHER: "#f59e0b" };
// การใช้งาน → กลุ่มที่แสดงในภาพรวม
const USAGE_GROUP: Record<string, string> = { RENTAL: "RENTAL", OWNER_OCCUPIED: "LIVE", PERSONAL_USE: "LIVE", VACANT: "VACANT", BUSINESS_USE: "BUSINESS", OTHER: "OTHER" };
const GROUPS: { key: string; label: string; color: string }[] = [
  { key: "RENTAL", label: "ปล่อยเช่า", color: "#3b82f6" },
  { key: "LIVE", label: "อยู่อาศัย / ใช้ส่วนตัว", color: "#10b981" },
  { key: "VACANT", label: "ว่าง / ยังไม่ใช้ประโยชน์", color: "#f59e0b" },
  { key: "BUSINESS", label: "ใช้ในกิจการ", color: "#8b5cf6" },
  { key: "OTHER", label: "อื่น ๆ", color: "#64748b" },
];
const PER_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
const FREQ_TEXT: Record<string, string> = { MONTHLY: "/เดือน", QUARTERLY: "/ไตรมาส", YEARLY: "/ปี", OTHER: "" };

type Sp = Promise<{ tab?: string; m?: string; p?: string; order?: string; ty?: string }>;

export default async function PropertyPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const yearStart = `${ym.slice(0, 4)}-01-01`;
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/property"];

  const canWrite = me.role !== "VIEWER";
  /**
   * รายการรายงวด (ค่าเช่า / ค่าใช้จ่ายประจำ): งวดเดือนนี้ + งวดก่อนที่ยังค้าง (OVERDUE · ยกมา)
   *   + งวดก่อนที่รับ / จ่ายในเดือนนี้ (paidQ = รายการรับ / จ่ายที่ผูกงวด → ดึงงวดนั้นมาด้วย ไม่หายจากตารางทันทีหลังบันทึก)
   */
  // dueInMonth: งวดเดือนก่อนที่ครบกำหนดในเดือนนี้ (ค่าเช่าจ่ายหลังสิ้นรอบ) ขึ้นด้วยแม้ยังไม่เลยกำหนด
  const withCarried = async (view: string, cols: string, idCol: string, periodCol: string, paidQ: PromiseLike<{ data: unknown }>, dueInMonth = false) => {
    const [{ data: cur }, { data: paidNow }] = await Promise.all([
      supabase.from(view).select(cols).or(`${periodCol}.eq.${start},and(status.eq.OVERDUE,${periodCol}.lt.${start})`
        + (dueInMonth ? `,and(due_date.gte.${start},due_date.lte.${end},${periodCol}.lt.${start})` : "")),
      paidQ,
    ]);
    const pairs = (paidNow ?? []) as unknown as Record<string, string>[];
    const back = pairs.length
      ? (await supabase.from(view).select(cols).in(idCol, [...new Set(pairs.map((x) => x[idCol]))]).in(periodCol, [...new Set(pairs.map((x) => x[periodCol]))])).data
      : null;
    const want = new Set(pairs.map((x) => `${x[idCol]}:${x[periodCol]}`));
    const rows = [...((cur ?? []) as unknown as Record<string, string>[]),
      ...((back ?? []) as unknown as Record<string, string>[]).filter((x) => want.has(`${x[idCol]}:${x[periodCol]}`))];
    return { data: [...new Map(rows.map((x) => [`${x[idCol]}:${x[periodCol]}`, x])).values()] as unknown[] };
  };
  // ดึงข้อมูลเป็น 2 รอบ (30 ต.ค. 2026) — เดิมรอทีละชุดต่อกันราว 9 ทอด → ช้ามากเมื่อ Supabase เพิ่งตื่น
  //   รอบแรก = ทุกชุดที่ไม่ต้องรอใคร · รอบสอง = ชุดที่ต้องใช้รายชื่อทรัพย์สิน (ชุดที่ต้องรอกันอีกทอดอยู่ในวงเล็บของตัวเอง)
  const pvQ = loadPersonView(sp.p);
  const [pv, [{ data, error }, { data: leases }, { data: fx }, { data: family }, sortMap, { data: rentTrack }, { data: costTrack },
    { data: bankRows }, { data: cardRows }], [{ data: rentToRows }, { data: chargeRaw }], valuePrev, { data: debtRaw }] = await Promise.all([
    pvQ,
    Promise.all([
      supabase.from("property_details")
        .select("id,asset_id,property_type,usage_type,vacant_since,location_group,land_area_sq_wa,latitude,longitude,address,assets!inner(name,currency,current_value,current_value_date,status,acquisition_cost,acquisition_date,deleted_at)")
        .is("deleted_at", null).is("assets.deleted_at", null).order("created_at"),
      supabase.from("v_lease_status").select("id,property_asset_id,tenant_name,unit_label,rent_amount,rent_currency,payment_frequency,start_date,end_date,lease_status")
        .in("lease_status", ["ACTIVE", "EXPIRING_SOON", "UPCOMING"]),
      supabase.from("v_fx_status").select("currency,rate_to_thb"),
      supabase.from("families").select("go_live_date").maybeSingle(),
      loadSortMap("assets"),
      // งวดเดือนนี้ + งวดก่อนที่ยังค้าง (ยกมา) + งวดก่อนที่รับ / จ่ายในเดือนนี้ (ยังเห็นหลังบันทึก) · ตกลง 5 พ.ย. 2026
      withCarried("v_lease_rent_tracking", "lease_id,property_asset_id,name,income_period,due_date,expected_amount,received_amount,currency,status,cycle_start,cycle_end,"
        + "grace_days,late_fee_per_day,rent_timing,days_past_due,in_grace,late_fee",
        "lease_id", "income_period", supabase.from("income_transactions").select("lease_id,income_period").eq("income_type", "RENT").not("lease_id", "is", null)
          .lt("income_period", start).gte("date", start).lte("date", end).is("deleted_at", null), true),
      withCarried("v_property_cost_tracking", "utility_id,property_asset_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,currency,status",
        "utility_id", "cost_period", supabase.from("expense_items").select("utility_id:property_utility_id,cost_period").not("property_utility_id", "is", null)
          .lt("cost_period", start).gte("date", start).lte("date", end).is("deleted_at", null)),
      supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
      supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    ]),
    // บัญชีรับค่าเช่าที่ตั้งไว้ในสัญญา → ค่าตั้งต้นของแท็บรับค่าเช่า · ค่าน้ำไฟเรียกเก็บผู้เช่าที่ยังไม่ได้รับคืน
    Promise.all([
      supabase.from("property_leases").select("id,rent_to_asset_id,utilities_billing").is("deleted_at", null),
      supabase.from("v_lease_utility_charges").select("id,lease_id,property_asset_id,name,cost_period,description,amount,currency,kind").eq("status", "PENDING").order("cost_period"),
    ]),
    // กล่องแรก (ตกลง 9 พ.ย. 2026): % จากสิ้นเดือนก่อน · หนี้ที่ผูกกับอสังหาฯ (liabilities.linked_asset_id)
    pvQ.then((v) => prevMonthValue(today, v.personId, "PROPERTY")),
    supabase.from("liabilities").select("linked_asset_id,outstanding_amount,currency").not("linked_asset_id", "is", null).eq("status", "ACTIVE").is("deleted_at", null),
  ]);
  const allProps = (data as unknown as Prop[] | null) ?? [];
  const ids = allProps.map((p) => p.asset_id);
  const none = Promise.resolve({ data: [] as never[] });
  const props = bySort(allProps.filter((p) => pv.showAsset(p.asset_id)), (p) => p.asset_id, sortMap);
  const shown = new Set(props.map((p) => p.asset_id));
  type RT = { lease_id: string; property_asset_id: string; name: string; income_period: string; due_date: string | null; expected_amount: number; received_amount: number | null; currency: string; status: string;
    cycle_start: string | null; cycle_end: string | null; grace_days: number | null; late_fee_per_day: number | null; rent_timing: string | null;
    days_past_due: number | null; in_grace: boolean | null; late_fee: number | null };
  // จ่ายหลังสิ้นรอบ: งวดเดือนนี้ที่ครบกำหนดเดือนหน้า → ไปขึ้นเดือนหน้า (เดือนนี้แสดงงวดที่ครบกำหนดในเดือนนี้)
  const arrearsLater = new Map(((rentTrack ?? []) as RT[]).filter((r) => r.rent_timing === "ARREARS" && r.status === "PENDING"
    && r.income_period === start && !!r.due_date && r.due_date > end).map((r) => [r.lease_id, r.due_date as string]));
  const leaseIds = [...new Set(((rentTrack ?? []) as RT[]).filter((r) => shown.has(r.property_asset_id)).map((r) => r.lease_id))];
  const rentPeriods = [...new Set(((rentTrack ?? []) as RT[]).filter((r) => shown.has(r.property_asset_id)).map((r) => r.income_period))];
  const utilIds = [...new Set(((costTrack ?? []) as { utility_id: string }[]).map((c) => c.utility_id))];
  const costPeriods = [...new Set(((costTrack ?? []) as { cost_period: string }[]).map((c) => c.cost_period))];
  const expCols = "id,related_asset_id,property_utility_id,cost_period,date,description,amount,currency,base_amount,notes,pending_split,source_cash_movement_id,liability_id,insurance_schedule_line_id";
  const [{ utils, utilProp, expU }, { taxDataYears, taxYears, taxYear, taxRaw }, { latestVal, partRaw },
    [{ data: incRaw }, { data: expA }, { data: marketRaw }, { data: targetRaw }, { data: compRaw }, { data: rentGot }, { data: costPaid }]] = await Promise.all([
    // ค่าใช้จ่ายประจำของแต่ละทรัพย์สิน → ค่าใช้จ่ายของปี (ถึงสิ้นเดือนที่เลือก) ที่ผูกกับรายการเหล่านั้น
    //   ยอด / ความถี่ → ประมาณค่าใช้จ่ายประจำทั้งปี + เติมเดือนก่อน Go-live (กล่องภาพรวม)
    (async () => {
      const { data: utils } = allProps.length
        ? await supabase.from("property_utilities")
          .select("id,property_id,unit_label,paid_from_asset_id,paid_from_credit_card_id,expected_amount,currency,frequency,due_month,active,deleted_at")
          .in("property_id", allProps.map((p) => p.id))
        : { data: [] as Util[] };
      const utilProp = new Map(((utils ?? []) as { id: string; property_id: string }[])
        .map((u) => [u.id, allProps.find((p) => p.id === u.property_id)?.asset_id ?? ""]));
      const { data: expU } = utilProp.size
        ? await supabase.from("expense_items").select(expCols).in("property_utility_id", [...utilProp.keys()]).gte("date", yearStart).lte("date", end).is("deleted_at", null)
        : await none;
      return { utils, utilProp, expU };
    })(),
    // ภาษีที่ดิน: ปีที่เลือก (?ty=) · ค่าเริ่มต้น = ปีของเดือนที่เลือก → รายการภาษีของปีนั้น + ปีก่อน
    (async () => {
      const { data: taxYearRows } = ids.length ? await supabase.from("property_tax_lines").select("tax_year").in("asset_id", ids).is("deleted_at", null) : { data: [] };
      const taxDataYears = [...new Set((taxYearRows ?? []).map((r) => Number(r.tax_year)))];
      const taxYears = landTaxYears(today, taxDataYears);
      const taxYear = taxYears.includes(Number(sp.ty)) ? Number(sp.ty)
        : taxYears.includes(Number(ym.slice(0, 4))) ? Number(ym.slice(0, 4)) : Number(today.slice(0, 4));
      const { data: taxRaw } = ids.length
        ? await supabase.from("v_property_tax_lines").select("*").in("asset_id", ids).in("tax_year", [taxYear, taxYear - 1]).order("sort_order").order("created_at")
        : await none;
      return { taxDataYears, taxYears, taxYear, taxRaw };
    })(),
    // มูลค่าครั้งล่าสุดของแต่ละทรัพย์สิน → มูลค่าแยกตามส่วนประกอบของครั้งนั้น (แท็บอัปเดตมูลค่ากางรายแถว)
    (async () => {
      const { data: valRaw } = ids.length
        ? await supabase.from("asset_valuations").select("id,asset_id").in("asset_id", ids).is("deleted_at", null)
          .order("valuation_date", { ascending: false }).order("created_at", { ascending: false })
        : await none;
      const latestVal = new Map<string, string>();
      ((valRaw ?? []) as { id: string; asset_id: string }[]).forEach((v) => { if (!latestVal.has(v.asset_id)) latestVal.set(v.asset_id, v.id); });
      const { data: partRaw } = latestVal.size
        ? await supabase.from("asset_valuation_parts").select("valuation_id,deed_id,value").in("valuation_id", [...latestVal.values()]).is("deleted_at", null)
        : { data: [] as never[] };
      return { latestVal, partRaw };
    })(),
    Promise.all([
      ids.length ? supabase.from("income_transactions").select("id,asset_id,lease_id,received_to_asset_id,income_type,date,amount,currency,base_amount,notes,tax,income_subtype,pending_split,income_period")
        .in("asset_id", ids).gte("date", yearStart).lte("date", end).is("deleted_at", null).order("date", { ascending: false }) : none,
      // ค่าใช้จ่ายของปี (ถึงสิ้นเดือนที่เลือก) → เดือนที่เลือก + รายได้สุทธิทั้งปี
      ids.length ? supabase.from("expense_items").select(expCols).in("related_asset_id", ids).gte("date", yearStart).lte("date", end).is("deleted_at", null) : none,
      // ราคาตลาดครั้งล่าสุด (อ้างอิง · ไม่นับใน Net Worth) → แท็บอัปเดตมูลค่า
      ids.length ? supabase.from("v_property_market_latest").select("*").in("asset_id", ids) : none,
      ids.length ? supabase.from("v_property_target_price").select("asset_id,min_price").in("asset_id", ids) : none,
      // ส่วนประกอบ → แท็บอัปเดตมูลค่ากางรายแถว
      ids.length ? supabase.from("property_deeds").select("id,property_id,sort_order,created_at,component_type,label,title_type,title_deed_no,land_no,land_area_sq_wa")
        .in("property_id", allProps.map((p) => p.id)).is("deleted_at", null).is("ended_date", null).order("sort_order").order("created_at") : none,
      // รับแล้ว / จ่ายแล้วของงวดในตาราง (กดยอดเพื่อแก้ / ลบ · ด้านล่าง)
      leaseIds.length ? supabase.from("income_transactions").select("id,lease_id,income_period,date,amount,tax,notes,currency").in("lease_id", leaseIds)
        .eq("income_type", "RENT").in("income_period", rentPeriods).is("deleted_at", null).order("date") : none,
      utilIds.length ? supabase.from("expense_items").select("id,property_utility_id,cost_period,date,amount,notes,currency,related_asset_id").in("property_utility_id", utilIds)
        .in("cost_period", costPeriods).is("deleted_at", null).order("date") : none,
    ]),
  ]);
  // "จ่ายจาก" ที่ตั้งไว้ในแต่ละรายการค่าใช้จ่ายประจำ → ค่าตั้งต้นของแท็บบันทึกค่าใช้จ่าย
  const utilPay = new Map(((utils ?? []) as { id: string; paid_from_asset_id: string | null; paid_from_credit_card_id: string | null }[])
    .map((u) => [u.id, u.paid_from_credit_card_id ? endpointValue({ kind: "card", id: u.paid_from_credit_card_id })
      : u.paid_from_asset_id ? endpointValue({ kind: "bank", id: u.paid_from_asset_id }) : ""]));
  type LX = { id: string; rent_to_asset_id: string | null; utilities_billing: string | null };
  const rentTo = new Map(((rentToRows ?? []) as LX[]).filter((r) => r.rent_to_asset_id).map((r) => [r.id, r.rent_to_asset_id as string]));
  const rebillLeases = new Set(((rentToRows ?? []) as LX[]).filter((r) => r.utilities_billing === "REBILL").map((r) => r.id));

  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null | undefined, c: string) => Number(v ?? 0) * (rate.get(c) ?? 0);
  const share = (id: string) => pv.assetShare(id);
  const valueOf = (p: Prop) => (p.assets.current_value == null ? null : thb(p.assets.current_value, p.assets.currency) * share(p.asset_id));
  const active = props.filter((p) => p.assets.status === "ACTIVE");
  const totalValue = active.reduce((t, p) => t + (valueOf(p) ?? 0), 0);
  const activeIds = new Set(active.map((p) => p.asset_id));
  const debtTotal = ((debtRaw ?? []) as { linked_asset_id: string; outstanding_amount: number | null; currency: string }[])
    .filter((l) => activeIds.has(l.linked_asset_id)).reduce((t, l) => t + thb(l.outstanding_amount, l.currency) * share(l.linked_asset_id), 0);
  const latestDate = active.map((p) => p.assets.current_value_date ?? "").sort().at(-1) || null;
  const pct = (v: number, t: number) => (t > 0 ? (v * 100) / t : 0);

  const byProp = new Map<string, Lease[]>();
  ((leases as Lease[] | null) ?? []).forEach((l) => byProp.set(l.property_asset_id, [...(byProp.get(l.property_asset_id) ?? []), l]));
  const propName = new Map(allProps.map((p) => [p.asset_id, p.assets.name]));

  // ---------------------------------------------------------------- รายได้ / ค่าใช้จ่าย (ส่วนของสมาชิกที่เลือก = ตามสัดส่วนความเป็นเจ้าของทรัพย์สิน)
  const baseOf = (x: { base_amount: number | null; amount: number; currency: string }) => (x.base_amount != null ? Number(x.base_amount) : thb(x.amount, x.currency));
  const incAll = ((incRaw as Inc[] | null) ?? []).filter((x) => shown.has(x.asset_id));
  const incMonth = incAll.filter((x) => x.date >= start);
  const incOf = (x: Inc) => baseOf(x) * share(x.asset_id);
  const ytdRent = new Map<string, number>();
  incAll.forEach((x) => ytdRent.set(x.asset_id, (ytdRent.get(x.asset_id) ?? 0) + incOf(x)));
  const expYear = [...new Map([...((expA as Exp[] | null) ?? []), ...((expU as Exp[] | null) ?? [])].map((x) => [x.id, x])).values()]
    .map((x) => ({ ...x, prop: x.related_asset_id && shown.has(x.related_asset_id) ? x.related_asset_id : utilProp.get(x.property_utility_id ?? "") ?? "" }))
    .filter((x) => shown.has(x.prop)).sort((a, b) => b.date.localeCompare(a.date));
  const expRows = expYear.filter((x) => x.date >= start);
  const expOf = (x: (typeof expRows)[number]) => baseOf(x) * share(x.prop);
  // กล่อง "ที่บันทึกแล้ว" ของเดือน: กดยอดเพื่อแก้ / ลบ (ฟอร์มเดียวกับหน้าทรัพย์สิน · ตกลง 28 ต.ค. 2026)
  //   รายการที่มาจากหน้าอื่น (หนี้สิน · กรมธรรม์ · รายการโอน · หักจากเงินประกัน) → ลิงก์ไปแก้ที่หน้าต้นทาง · รอแยกก้อน → แยกที่ Income & Expenses
  const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";
  const boxPaths = (asset: string) => ["/property", `/property/${asset}`, "/income-expenses"];
  const amtLink = (text: string, href: string) => <Link href={href} className={AMT} title="แก้ / ลบที่หน้าต้นทาง">{text} →</Link>;
  const incAmt = (x: Inc) => {
    const text = money(incOf(x));
    if (!canWrite) return text;
    if (x.pending_split) return amtLink(text, `/income-expenses?m=${ym}`);
    const rentLike = x.income_type === "RENT" || x.income_subtype === REBILL_SUBTYPE;
    if (x.lease_id && !rentLike) return amtLink(text, `/property/${x.asset_id}`);
    const row = { date: x.date, amount: x.amount, tax: x.tax, notes: x.notes };
    return <RowActions table="income_transactions" id={x.id} paths={boxPaths(x.asset_id)} canDelete={canOrder}
      fields={rentLike ? rentIncomeFields(row) : assetIncomeFields(row)} button={`${text} ✎`} buttonClass={AMT} />;
  };
  const expAmt = (x: (typeof expRows)[number]) => {
    const text = money(expOf(x));
    if (!canWrite) return text;
    if (x.liability_id) return amtLink(text, `/liabilities/${x.liability_id}`);
    if (x.insurance_schedule_line_id) return amtLink(text, "/insurance?tab=premium");
    if (x.source_cash_movement_id || x.pending_split) return amtLink(text, `/income-expenses?m=${ym}`);
    return <RowActions table="expense_items" id={x.id} paths={boxPaths(x.prop)} canDelete={canOrder}
      fields={propertyCostFields(x)} button={`${text} ✎`} buttonClass={AMT} />;
  };
  const incTotal = incMonth.reduce((t, x) => t + incOf(x), 0);
  const expTotal = expRows.reduce((t, x) => t + expOf(x), 0);

  // ค่าเช่าตามสัญญา (เทียบต่อเดือน)
  const monthlyRent = (id: string) => (byProp.get(id) ?? []).filter((l) => l.lease_status !== "UPCOMING")
    .reduce((t, l) => t + (PER_MONTHS[l.payment_frequency] ? thb(l.rent_amount, l.rent_currency) / PER_MONTHS[l.payment_frequency] : 0), 0) * share(id);

  // ---------------------------------------------------------------- กล่องภาพรวม
  const typeRows = Object.keys(PROPERTY_TYPE_LABEL).map((k) => {
    const ps = active.filter((p) => p.property_type === k);
    return { key: k, label: PROPERTY_TYPE_LABEL[k], n: ps.length, value: ps.reduce((t, p) => t + (valueOf(p) ?? 0), 0), color: TYPE_COLORS[k] ?? "#64748b" };
  }).filter((r) => r.n > 0).sort((a, b) => b.value - a.value);
  const usageRows = GROUPS.map((g) => {
    const ps = active.filter((p) => (USAGE_GROUP[p.usage_type] ?? "OTHER") === g.key);
    return { ...g, n: ps.length, value: ps.reduce((t, p) => t + (valueOf(p) ?? 0), 0) };
  }).filter((r) => r.n > 0 && (r.value > 0 || ["RENTAL", "LIVE", "VACANT"].includes(r.key)));
  const months = monthOptions(family?.go_live_date, today, 0, ym);
  const mLabel = ym === today.slice(0, 7) ? "เดือนนี้" : thMonth(start);
  const old = addDays(today, -90);

  // ---------------------------------------------------------------- แท็บทรัพย์สินทั้งหมด
  const propRows: PropRow[] = props.map((p, i) => {
    const ls = byProp.get(p.asset_id) ?? [];
    return {
      id: p.id, assetId: p.asset_id, name: p.assets.name,
      sub: [p.location_group, p.land_area_sq_wa != null ? landText(p.land_area_sq_wa) : null].filter(Boolean).join(" · "), loc: p.location_group,
      type: p.property_type, typeLabel: PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type,
      usage: p.usage_type, usageLabel: USAGE_LABEL[p.usage_type] ?? p.usage_type, status: p.assets.status,
      // ส่งออกแผนที่ (KML)
      geo: p.latitude != null && p.longitude != null ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null,
      area: p.land_area_sq_wa != null ? landText(p.land_area_sq_wa) : null, address: p.address,
      cost: p.assets.acquisition_cost == null ? null : thb(p.assets.acquisition_cost, p.assets.currency) * share(p.asset_id),
      costDate: p.assets.acquisition_date, value: valueOf(p), valueDate: p.assets.current_value_date,
      stale: !p.assets.current_value_date || p.assets.current_value_date < old,
      rent: monthlyRent(p.asset_id), ytd: ytdRent.get(p.asset_id) ?? 0,
      leases: ls.map((l) => ({ id: l.id, badge: LEASE_STATUS[l.lease_status]?.text ?? l.lease_status, cls: LEASE_STATUS[l.lease_status]?.cls ?? "",
        text: `${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} · ถึง ${thDate(l.end_date)}` })),
      noLease: p.usage_type === "RENTAL" && ls.length === 0,
      vacant: p.usage_type === "VACANT" && p.vacant_since
        ? (() => { const mo = monthsBetween(p.vacant_since, today); return { text: `ว่าง ${durationText(mo)}`, warn: !!vacancyWarning(mo) }; })() : null,
      move: ordering ? <MoveButtons table="assets" id={p.asset_id} paths={paths} {...neighbors(props, i, (x) => x.asset_id)} /> : undefined,
    };
  });

  // ---------------------------------------------------------------- บันทึกหลายรายการ (วันที่ตั้งต้น = วันนี้ / วันสุดท้ายของเดือนที่เลือก)
  const defaultDate = end < today ? end : today;
  const banks = ((bankRows ?? []) as { asset_id: string; name: string; currency: string }[]).map((b) => ({ id: b.asset_id, name: b.name, currency: b.currency }));
  const lastBank = new Map<string, string>();
  [...incAll].sort((a, b) => a.date.localeCompare(b.date)).forEach((x) => { if (x.lease_id && x.received_to_asset_id) lastBank.set(x.lease_id, x.received_to_asset_id); });
  // แท็บรับค่าเช่า = ตารางเดียว (ตกลง 5 พ.ย. 2026): งวดค่าเช่า (เดือนนี้ + ค้างรับยกมา) · สัญญาที่ไม่มีงวดเดือนนี้ · ค่าน้ำไฟเรียกเก็บ
  //   · รายได้อื่นที่รับในเดือนนี้ · ยอดรับเข้ารวม (เดิมแยก 3 ตาราง: รับค่าเช่า / รายได้ที่บันทึกแล้ว / สัญญาเช่าที่มีผล)
  const leaseById = new Map(((leases as Lease[] | null) ?? []).map((l) => [l.id, l]));
  const who = (l: Lease) => [l.unit_label, l.tenant_name].filter(Boolean).join(" · ");
  const bankFor = (leaseId: string, ccy: string) => [rentTo.get(leaseId), lastBank.get(leaseId)].find((b) => b && banks.some((x) => x.id === b && x.currency === ccy))
    ?? banks.find((b) => b.currency === ccy)?.id ?? "";
  const monthNo = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const monthOf = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
  // สัญญาที่ไม่มีงวดในเดือนนี้ (รายไตรมาส / รายปี / ยังไม่เริ่ม) → บอกงวดถัดไป
  const nextNote = (l: Lease) => {
    if (l.lease_status === "UPCOMING") return `เริ่มสัญญา ${thDate(l.start_date)}`;
    const step = PER_MONTHS[l.payment_frequency];
    if (!step) return "ไม่มีตารางงวด";
    const s0 = monthNo(l.start_date);
    const next = s0 + Math.max(0, Math.ceil((monthNo(start) + 1 - s0) / step)) * step;
    return next > monthNo(l.end_date) ? "ไม่มีงวดเหลือในสัญญา" : `ไม่มีงวดเดือนนี้ · งวดถัดไป ${thMonth(monthOf(next))}`;
  };
  const rentRows: RentRow[] = ((rentTrack ?? []) as RT[]).filter((r) => shown.has(r.property_asset_id)
    && !(r.rent_timing === "ARREARS" && r.status === "PENDING" && r.income_period === start && !!r.due_date && r.due_date > end)).map((r) => {
    const l = leaseById.get(r.lease_id);
    const property = propName.get(r.property_asset_id) ?? "";
    return {
      key: `${r.lease_id}:${r.income_period}`, leaseId: r.lease_id, assetId: r.property_asset_id, property,
      tenant: l ? who(l) : r.name.startsWith(`${property} · `) ? r.name.slice(property.length + 3) : r.name,
      period: r.income_period, due: r.due_date, expected: Number(r.expected_amount), received: Number(r.received_amount ?? 0),
      currency: r.currency, status: r.status, bank: bankFor(r.lease_id, r.currency),
      cycle: cycleNote(r.cycle_start, r.cycle_end, Number(r.expected_amount), l ? Number(l.rent_amount) : undefined) ?? undefined,
      late: r.status === "OVERDUE" ? { days: Number(r.days_past_due ?? 0), inGrace: !!r.in_grace, grace: Number(r.grace_days ?? 0), fee: Number(r.late_fee ?? 0) } : undefined,
      feePerDay: Number(r.late_fee_per_day ?? 0) > 0 ? Number(r.late_fee_per_day) : undefined, grace: Number(r.grace_days ?? 0),
    };
  });
  const withRow = new Set(rentRows.map((r) => r.leaseId));
  rentRows.push(...props.flatMap((p) => (byProp.get(p.asset_id) ?? []).filter((l) => !withRow.has(l.id)).map((l): RentRow => ({
    key: `l:${l.id}`, leaseId: l.id, assetId: p.asset_id, property: p.assets.name, tenant: who(l), period: start, due: null,
    expected: Number(l.rent_amount), received: 0, currency: l.rent_currency, status: "NONE", bank: "",
    note: arrearsLater.has(l.id) ? `จ่ายหลังสิ้นรอบ · งวดเดือนนี้ครบกำหนด ${thDate(arrearsLater.get(l.id)!)}` : nextNote(l),
  }))));
  // เรียงตามทรัพย์สิน → ผู้เช่า → งวด · รายละเอียดสัญญาแสดงที่แถวแรกของสัญญา
  rentRows.sort((a, b) => a.property.localeCompare(b.property, "th") || a.tenant.localeCompare(b.tenant, "th") || a.period.localeCompare(b.period));
  const leaseShown = new Set<string>();
  rentRows.forEach((r) => {
    const l = leaseById.get(r.leaseId);
    if (!l || leaseShown.has(l.id)) return;
    leaseShown.add(l.id);
    const st = l.lease_status === "ACTIVE" ? undefined : LEASE_STATUS[l.lease_status];
    r.lease = { id: l.id, term: `${thDate(l.start_date)} – ${thDate(l.end_date)}`, freq: FREQ_TEXT[l.payment_frequency] ?? "", badge: st };
  });
  // รับแล้วของงวด → กดยอดเพื่อแก้ / ลบ (ฟอร์มเดียวกับประวัติในหน้าทรัพย์สิน · ตกลง 28 ต.ค. 2026)
  type GotRow = { id: string; lease_id: string; income_period: string; date: string; amount: number; tax: number | null; notes: string | null; currency: string };
  type PaidRow = { id: string; property_utility_id: string; cost_period: string; date: string; amount: number; notes: string | null; currency: string; related_asset_id: string | null };
  rentRows.forEach((r) => {
    r.edits = ((rentGot ?? []) as GotRow[]).filter((i) => i.lease_id === r.leaseId && i.income_period === r.period).map((i) => ({ id: i.id, node: recEdit({
      canWrite, canDelete: canOrder, table: "income_transactions", id: i.id, label: recLabel("รับแล้ว", i.date, Number(i.amount), i.currency),
      paths: [...paths, `/property/${r.assetId}`, "/income-expenses"], fields: rentIncomeFields(i) }) }));
  });
  // ค่าน้ำไฟเรียกเก็บผู้เช่าที่ยังไม่ได้รับคืน (ทุกงวด) → ต่อท้ายตารางรับค่าเช่า
  type CH = { id: string; lease_id: string; property_asset_id: string; name: string; cost_period: string; description: string; amount: number; currency: string; kind: string };
  rentRows.push(...((chargeRaw ?? []) as CH[]).filter((c) => shown.has(c.property_asset_id)).map((c) => ({
    key: `c:${c.id}`, leaseId: c.lease_id, chargeId: c.id, assetId: c.property_asset_id, property: propName.get(c.property_asset_id) ?? "",
    // ค่าเสียหายส่วนที่เกินเงินประกัน (ผู้เช่าออก · ค้างรับ) → บอกผู้เช่า + รายการ
    tenant: c.kind === "DAMAGE" ? [c.name.split(" · ").slice(1).join(" · "), c.description].filter(Boolean).join(" · ") : `${REBILL_SUBTYPE} · ${c.description}`,
    period: c.cost_period, due: null, expected: Number(c.amount), received: 0,
    currency: c.currency, status: "PENDING", bank: bankFor(c.lease_id, c.currency),
  })));
  // รายได้ที่รับในเดือนนี้ที่ไม่ได้อยู่ในแถวงวดค่าเช่า (รายได้อื่น · ค่าน้ำไฟที่รับคืนแล้ว · ค่าเช่างวดอื่น) → แถวท้ายตาราง
  const rentKeys = new Set(rentRows.map((r) => r.key));
  const otherInc: OtherIncome[] = incMonth.filter((x) => !(x.income_type === "RENT" && x.lease_id && rentKeys.has(`${x.lease_id}:${x.income_period}`)))
    .map((x) => ({
      key: x.id, assetId: x.asset_id, property: propName.get(x.asset_id) ?? "", date: x.date, amount: incAmt(x),
      label: [x.income_type === "RENT" && x.income_period ? `ค่าเช่างวด ${thMonth(x.income_period)}` : INCOME_TYPE_LABEL[x.income_type] ?? x.income_type,
        x.income_subtype, x.notes].filter(Boolean).join(" · "),
    }));
  // ยอดรับเข้าเดือนนี้ (ตามวันที่รับ · ส่วนของสมาชิกที่เลือก) แยกตามทรัพย์สิน → ท้ายตาราง (กรองทรัพย์สินแล้วรวมใหม่)
  const incByAsset: Record<string, number> = {};
  incMonth.forEach((x) => { incByAsset[x.asset_id] = (incByAsset[x.asset_id] ?? 0) + incOf(x); });
  // สัญญาที่ตั้ง "เรียกเก็บผู้เช่า" ของแต่ละทรัพย์สิน → ติ๊กเรียกเก็บในแท็บค่าใช้จ่าย (ไฟ / น้ำ)
  //   มิเตอร์ผูกห้อง → สัญญาของห้องนั้นก่อน
  const utilRoom = new Map(((utils ?? []) as { id: string; unit_label: string | null }[]).map((u) => [u.id, u.unit_label?.trim().toLowerCase() ?? ""]));
  const rebillOf = (assetId: string, utilityId: string) => {
    const ls = (byProp.get(assetId) ?? []).filter((l) => l.lease_status !== "UPCOMING" && rebillLeases.has(l.id));
    const room = utilRoom.get(utilityId);
    return (room && ls.find((l) => l.unit_label?.trim().toLowerCase() === room)) || ls[0];
  };
  type CT = { utility_id: string; property_asset_id: string; utility_type: string; provider: string | null; cost_period: string; due_date: string | null; expected_amount: number | null; paid_amount: number | null; currency: string; status: string };
  const costRows: CostRow[] = ((costTrack ?? []) as CT[]).filter((c) => shown.has(c.property_asset_id)).map((c) => ({
    key: `${c.utility_id}:${c.cost_period}`, utilityId: c.utility_id, assetId: c.property_asset_id, property: propName.get(c.property_asset_id) ?? "",
    label: [UTIL_LABEL[c.utility_type] ?? c.utility_type, c.provider].filter(Boolean).join(" · "), period: c.cost_period, due: c.due_date,
    type: c.utility_type, typeLabel: UTIL_LABEL[c.utility_type] ?? c.utility_type,
    expected: Number(c.expected_amount ?? 0), paid: Number(c.paid_amount ?? 0), currency: c.currency, status: c.status,
    category: UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค", pay: utilPay.get(c.utility_id) || undefined,
    ...(() => {
      const l = ["ELECTRICITY", "WATER"].includes(c.utility_type) ? rebillOf(c.property_asset_id, c.utility_id) : undefined;
      return l ? { rebillLease: l.id, rebillLabel: [l.unit_label, l.tenant_name].filter(Boolean).join(" · ") } : {};
    })(),
    edits: ((costPaid ?? []) as PaidRow[]).filter((e) => e.property_utility_id === c.utility_id && e.cost_period === c.cost_period).map((e) => ({ id: e.id, node: recEdit({
      canWrite, canDelete: canOrder, table: "expense_items", id: e.id, label: recLabel("จ่ายแล้ว", e.date, Number(e.amount), e.currency),
      paths: [...paths, `/property/${c.property_asset_id}`, "/income-expenses"], fields: propertyCostFields(e) }) })),
  })).sort((a, b) => a.property.localeCompare(b.property, "th") || a.label.localeCompare(b.label, "th") || a.period.localeCompare(b.period));
  // ค่าใช้จ่ายที่จ่ายในเดือนนี้ที่ไม่อยู่ในแถวค่าใช้จ่ายประจำ → แถวท้ายตารางเดียวกัน (เดิมตาราง "ค่าใช้จ่ายทรัพย์สินที่บันทึกแล้ว" · ตกลง 5 พ.ย. 2026)
  const costKeys = new Set(costRows.map((r) => r.key));
  const otherCost: OtherCost[] = expRows.filter((x) => !(x.property_utility_id && costKeys.has(`${x.property_utility_id}:${x.cost_period}`)))
    .map((x) => ({ key: x.id, assetId: x.prop, property: propName.get(x.prop) ?? "", date: x.date, label: x.description, amount: expAmt(x) }));
  // ---------------------------------------------------------------- ภาษีที่ดิน (ปีที่เลือก) รายทรัพย์สิน
  type TL = TaxLineRow & { asset_id: string; tax_year: number };
  const taxLinesAll = ((taxRaw ?? []) as TL[]);
  const taxPropRows: TaxPropRow[] = props.map((p) => {
    const lines = taxLinesAll.filter((t) => t.asset_id === p.asset_id && Number(t.tax_year) === taxYear);
    const prevLines = taxLinesAll.filter((t) => t.asset_id === p.asset_id && Number(t.tax_year) === taxYear - 1);
    return {
      assetId: p.asset_id, name: p.assets.name, type: p.property_type, typeLabel: PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type,
      usage: p.usage_type, usageLabel: USAGE_LABEL[p.usage_type] ?? p.usage_type, loc: p.location_group, status: p.assets.status,
      lines, hasPrev: prevLines.length > 0, landSqWa: p.land_area_sq_wa,
      rate: Number(prevLines.at(-1)?.rate_pct ?? LAND_TAX_RATE_BY_USAGE[p.usage_type] ?? 0.3),
    };
  });
  // ---------------------------------------------------------------- อัปเดตมูลค่า: มูลค่าใน Net Worth + ราคาตลาด ของทรัพย์สินที่ถืออยู่
  const minOf = new Map(((targetRaw ?? []) as { asset_id: string; min_price: number | null }[]).map((t) => [t.asset_id, t.min_price == null ? null : Number(t.min_price)]));
  const marketOf = new Map(((marketRaw ?? []) as (MarketValuation & { asset_id: string })[]).map((m) => [m.asset_id, m]));
  const partSum = new Map<string, number>();   // valuation:deed → ยอด (จ่ายเพิ่มของแถวเดียวกัน = รวมกัน)
  ((partRaw ?? []) as { valuation_id: string; deed_id: string | null; value: number }[])
    .forEach((x) => { if (x.deed_id) partSum.set(`${x.valuation_id}:${x.deed_id}`, (partSum.get(`${x.valuation_id}:${x.deed_id}`) ?? 0) + Number(x.value)); });
  const compsOf = (p: Prop) => ((compRaw ?? []) as unknown as (Component & { property_id: string })[]).filter((c) => c.property_id === p.id).map((c, i) => {
    const v = partSum.get(`${latestVal.get(p.asset_id)}:${c.id}`);
    return { id: c.id, label: compName(c, i), type: c.component_type, area: c.land_area_sq_wa != null ? Number(c.land_area_sq_wa) : null, value: v ?? null };
  });
  const valueRows: ValueRow[] = active.map((p) => ({
    id: p.asset_id, name: p.assets.name, typeLabel: PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type, currency: p.assets.currency,
    type: p.property_type, usage: p.usage_type,
    value: p.assets.current_value == null ? null : Number(p.assets.current_value), date: p.assets.current_value_date,
    defaultUnit: marketDefaultUnit(p.property_type), areaSqWa: p.land_area_sq_wa != null ? Number(p.land_area_sq_wa) : null,
    market: marketOf.get(p.asset_id) ?? null, factor: thb(1, p.assets.currency) * share(p.asset_id), minPrice: minOf.get(p.asset_id) ?? null,
    parts: compsOf(p),
  }));
  // ประมาณรายได้ค่าเช่าทั้งปี = ค่าเช่าตามสัญญาที่มีผล (ต่อเดือน) × 12
  const leaseCount = props.reduce((t, p) => t + (byProp.get(p.asset_id) ?? []).filter((l) => l.lease_status !== "UPCOMING" && PER_MONTHS[l.payment_frequency]).length, 0);
  const annualRent = props.reduce((t, p) => t + monthlyRent(p.asset_id), 0) * 12;
  // ประมาณค่าใช้จ่ายประจำทั้งปี = ยอดที่ตั้งไว้ในค่าใช้จ่ายประจำ × จำนวนงวดต่อปี (ไม่รวมค่าใช้จ่ายครั้งเดียว · ตกลง 7 พ.ย. 2026)
  const recurring = ((utils ?? []) as Util[]).map((u) => ({ ...u, asset: utilProp.get(u.id) ?? "" }))
    .filter((u) => u.active && !u.deleted_at && u.expected_amount != null && !!PERIODS_PER_YEAR[u.frequency ?? ""] && activeIds.has(u.asset));
  const utilCost = (u: (typeof recurring)[number], periods: number) => thb(u.expected_amount, u.currency) * periods * share(u.asset);
  const annualCost = recurring.reduce((t, u) => t + utilCost(u, PERIODS_PER_YEAR[u.frequency ?? ""]), 0);
  // รายได้สุทธิทั้งปี = ยอดจริง ม.ค. → เดือนที่เลือก · ปีที่ Go-live เติมเดือนก่อน Go-live (src/lib/property-year.ts · ตกลง 7 พ.ย. 2026)
  //   รายได้ = ค่าเฉลี่ยรายได้จริงต่อเดือนของเดือนที่จบแล้วหลัง Go-live · ค่าใช้จ่าย = ค่าใช้จ่ายประจำตามงวดของเดือนเหล่านั้น
  //   % ต่อปี = เฉพาะกลุ่มปล่อยเช่า: รายได้ − ค่าใช้จ่ายของกลุ่มนี้ ปรับเป็น 12 เดือน ÷ มูลค่าปัจจุบันของกลุ่มนี้
  const span = yearSpan(ym, family?.go_live_date, today);
  const netYearOf = (inGroup: (asset: string) => boolean) => {
    const inc = incAll.filter((x) => inGroup(x.asset_id));
    const actual = inc.filter((x) => x.date >= span.actualFrom).reduce((t, x) => t + incOf(x), 0)
      - expYear.filter((x) => inGroup(x.prop) && x.date >= span.actualFrom).reduce((t, x) => t + expOf(x), 0);
    if (!span.fillMonths) return actual;
    const avgInc = inc.filter((x) => x.date >= span.avgFrom && x.date <= span.avgTo).reduce((t, x) => t + incOf(x), 0) / span.avgMonths;
    const fillCost = recurring.filter((u) => inGroup(u.asset))
      .reduce((t, u) => t + utilCost(u, periodsIn(PERIODS_PER_YEAR[u.frequency ?? ""], u.due_month, span.anchorMonth, 1, span.fillMonths)), 0);
    return actual + avgInc * span.fillMonths - fillCost;
  };
  const netYear = netYearOf(() => true);
  const rentalIds = new Set(active.filter((p) => USAGE_GROUP[p.usage_type] === "RENTAL").map((p) => p.asset_id));
  const rentalN = rentalIds.size;
  const leasedN = [...rentalIds].filter((id) => (byProp.get(id) ?? []).some((l) => l.lease_status !== "UPCOMING")).length;
  const rentalValue = active.filter((p) => rentalIds.has(p.asset_id)).reduce((t, p) => t + (valueOf(p) ?? 0), 0);
  const rentalPct = rentalValue > 0 ? ((netYearOf((a) => rentalIds.has(a)) * 12) / span.months / rentalValue) * 100 : null;
  const monthSpan = (to: number) => `ม.ค.${to > 1 ? `–${TH_MONTHS[to - 1]}` : ""}`;
  const tone = (v: number) => (v < 0 ? "text-red-700" : "text-emerald-700");
  const EST = "mt-2 border-t border-slate-100 pt-2";
  const pays: PayOpt[] = [
    ...banks.map((b) => ({ value: endpointValue({ kind: "bank", id: b.id }), label: `บัญชี ${b.name}`, currency: b.currency })),
    ...((cardRows ?? []) as { id: string; issuer: string | null; card_name: string | null; card_last4: string | null; currency: string }[])
      .map((c) => ({ value: endpointValue({ kind: "card", id: c.id }), label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency })),
  ];

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <PageInfo>อสังหาริมทรัพย์ทุกการใช้งาน · สัญญาเช่า · ค่าเช่า · ค่าใช้จ่าย</PageInfo>
      <HeaderFilters>
        <PersonFilter persons={pv.persons} value={pv.personId} />
        <MonthPicker months={months} value={ym} />
      </HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/property/new" className={ADD_BTN}>+ เพิ่มอสังหาริมทรัพย์</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <TabNav tabs={TABS} />

      <TabPanel id="overview">
        {/* 4 กล่อง (ตกลง 7 พ.ย. 2026): มูลค่าทรัพย์สินรวม · รายได้ + ประมาณค่าเช่าทั้งปี · ค่าใช้จ่าย + ประมาณค่าใช้จ่ายประจำทั้งปี
              · รายได้สุทธิ + ทั้งปี (ยอดจริง) + % ต่อปีของกลุ่มปล่อยเช่า */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBox label={<>{pv.personId ? `มูลค่าอสังหาริมทรัพย์ส่วนของ ${pv.personName}` : "มูลค่าอสังหาริมทรัพย์รวม"} (THB Equivalent) · ถึงวันนี้</>} value={money(totalValue, "THB")}
            sub={<>
              <MonthChange pct={changePct(totalValue, valuePrev)} prev={valuePrev} />
              <div>{active.length} รายการ{rentalN ? ` · ปล่อยเช่า ${rentalN} (มีสัญญา ${leasedN})` : ""}</div>
              {debtTotal > 0.005 && <div>หนี้ที่ผูกไว้ <span className="text-red-700">{money(debtTotal, "THB", 0)}</span> · สุทธิหลังหักหนี้ {money(totalValue - debtTotal, "THB", 0)}</div>}
            </>} />
          <StatBox label={`รายได้จากอสังหาฯ ${mLabel}`} value={plusMoney(incTotal, "THB")} valueClass="text-emerald-700"
            sub={<>
              <div>{incMonth.length} รายการ</div>
              <div className={EST}>ประมาณค่าเช่าทั้งปี <span className="font-medium text-emerald-700">{plusMoney(annualRent, "THB")}</span></div>
              <div className="text-slate-400">{leaseCount ? `สัญญาที่มีผล ${leaseCount} สัญญา × 12 เดือน` : "ยังไม่มีสัญญาเช่าที่มีผล"}</div>
            </>} />
          <StatBox label={`ค่าใช้จ่ายอสังหาฯ ${mLabel}`} value={minusMoney(expTotal, "THB")} valueClass="text-red-700"
            sub={<>
              <div>{expRows.length} รายการ</div>
              <div className={EST}>ประมาณค่าใช้จ่ายประจำทั้งปี <span className="font-medium text-red-700">{minusMoney(annualCost, "THB")}</span></div>
              <div className="text-slate-400">{recurring.length ? `ค่าใช้จ่ายประจำ ${recurring.length} รายการ · ไม่รวมค่าใช้จ่ายครั้งเดียว` : "ยังไม่ได้ตั้งค่าใช้จ่ายประจำ"}</div>
            </>} />
          <StatBox label={`รายได้สุทธิ${mLabel}`} value={signedMoney(incTotal - expTotal, "THB")} valueClass={tone(incTotal - expTotal)}
            sub={<>
              <div>รายได้ − ค่าใช้จ่าย</div>
              <div className={EST}>ทั้งปี {span.year + 543} ({monthSpan(span.months)}) <span className={`font-medium ${tone(netYear)}`}>{signedMoney(netYear, "THB")}</span></div>
              {span.fillMonths > 0 && <div className="text-slate-400">{monthSpan(span.fillMonths)} ประมาณ · ตั้งแต่ {TH_MONTHS[span.fillMonths]} ยอดจริง</div>}
              {rentalPct != null && (
                <div className="inline-flex items-center gap-1">ปล่อยเช่า <span className={`font-semibold ${tone(rentalPct)}`}>{signedPct(rentalPct)}</span> ต่อปีของมูลค่า
                  <InfoTip label="วิธีคิดรายได้สุทธิทั้งปี">
                    ทั้งปี = รายได้ − ค่าใช้จ่ายที่บันทึกจริง ตั้งแต่ ม.ค. ถึงเดือนที่เลือก
                    {span.fillMonths > 0 && <> · ปีที่เริ่มใช้ระบบ เดือนก่อน Go-live ประมาณให้: รายได้ = ค่าเฉลี่ยรายได้จริงต่อเดือนของเดือนที่จบแล้วหลัง Go-live · ค่าใช้จ่าย = ค่าใช้จ่ายประจำตามงวดของเดือนเหล่านั้น (ไม่รวมค่าใช้จ่ายครั้งเดียว)</>}
                    {" "}· % ต่อปี = รายได้ − ค่าใช้จ่ายของอสังหาฯ กลุ่มปล่อยเช่า ปรับเป็น 12 เดือน ÷ มูลค่าปัจจุบันของกลุ่มปล่อยเช่า ({money(rentalValue, "THB")})
                  </InfoTip>
                </div>
              )}
            </>} />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          {/* ตารางสัดส่วนชุดเดียวกับทุกหน้า (ShareBox · ตกลง 7 พ.ย. 2026) · ยอดรวม / จำนวนรายการอยู่กล่องบนแล้ว */}
          <ShareBox title="มูลค่าอสังหาฯ ตามประเภท" label="ประเภท" total={totalValue} rows={shareRows(typeRows)}
            aside={latestDate ? `ประเมินล่าสุด ${thDate(latestDate)}` : undefined} />
          <ShareBox title="มูลค่าอสังหาฯ ตามการใช้งาน" label="การใช้งาน" total={totalValue} rows={shareRows(usageRows)}>
            {totalValue > 0 && (
              <div className="mt-3 flex h-6 overflow-hidden rounded-md text-[11px] font-medium text-white">
                {usageRows.filter((r) => r.value > 0).map((r) => {
                  const w = pct(r.value, totalValue);
                  return <div key={r.key} className="flex items-center justify-center" style={{ width: `${w}%`, background: r.color }}>{w >= 8 ? `${w.toFixed(0)}%` : ""}</div>;
                })}
              </div>
            )}
          </ShareBox>
        </section>
        <PropertyTable rows={propRows} note={<>มูลค่า = มูลค่าประเมินล่าสุด{pv.personId && ` · แสดงเฉพาะส่วนของ ${pv.personName} ตามสัดส่วนความเป็นเจ้าของ`} · สกุลอื่นแปลงเป็นบาทด้วยอัตราล่าสุด</>}
          empty={pv.personId ? `ไม่มีทรัพย์สินของ ${pv.personName}` : "ยังไม่มีทรัพย์สิน"}
          toggle={canOrder && props.length > 1 ? <SortToggle active={ordering} {...orderHrefs("/property", { p: sp.p, m: sp.m })} /> : null} />
      </TabPanel>

      <TabPanel id="income">
        <RentBatch key={`r${ym}`} rows={rentRows} others={otherInc} incByAsset={incByAsset} banks={banks} defaultDate={defaultDate} today={today}
          minDate={family?.go_live_date ?? ""} canWrite={canWrite}
          totalLabel={`รับเข้า${mLabel}รวม (ตามวันที่รับ)${pv.personId ? ` · ส่วนของ ${pv.personName}` : ""}`} />
      </TabPanel>

      <TabPanel id="expense">
        <div className="space-y-4">
          <ExpenseBatch key={`e${ym}`} rows={costRows} others={otherCost} total={expTotal}
            totalLabel={`จ่าย${mLabel}รวม (ตามวันที่จ่าย)${pv.personId ? ` · ส่วนของ ${pv.personName}` : ""}`}
            props={props.filter((p) => p.assets.status === "ACTIVE").map((p) => ({ id: p.asset_id, name: p.assets.name }))}
            pays={pays} defaultDate={defaultDate} today={today} ym={ym} canWrite={canWrite} />
          <LandTaxTable rows={taxPropRows} year={taxYear} years={taxYears} dataYears={taxDataYears}
            hrefOf={`/property?tab=expense&m=${ym}${sp.p ? `&p=${sp.p}` : ""}&ty=__Y__`} canWrite={canWrite} canDelete={canOrder}
            info="คำนวณจากข้อมูลภาษีของทรัพย์สินแต่ละรายการ · ใช้ตรวจกับใบแจ้งภาษีของเขต / อบต. · สถานะการจ่ายดูที่ค่าใช้จ่ายประจำด้านบน"
            note={pv.personId ? `แสดงเต็มจำนวนของทรัพย์สินที่ ${pv.personName} ถือ` : undefined} />
        </div>
      </TabPanel>
      <TabPanel id="update">
        <ValueBatch rows={valueRows} today={today} minDate={family?.go_live_date ?? ""} canWrite={canWrite}
          shareNote={pv.personId ? `ยอดรวมท้ายตาราง = ส่วนของ ${pv.personName} ตามสัดส่วนความเป็นเจ้าของ (มูลค่าในแถว = ทั้งทรัพย์สิน)` : null} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

/** แถวสัดส่วน (ประเภท / การใช้งาน) → ตารางสัดส่วนชุดเดียวกับทุกหน้า · ชื่อ (จำนวนรายการ) */
const shareRows = (rows: { key: string; label: string; n: number; value: number; color: string }[]) =>
  rows.map((r) => ({ key: r.key, name: r.label, sub: `(${r.n} รายการ)`, value: r.value, color: r.color }));
