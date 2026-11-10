import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, CLAIM_DONE, CLAIM_OPEN, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_STATUS, INS_TYPE, addDays, deathCoverage, insCountedPaid, money, monthOptions, monthRange, monthsBetween, thDate, todayBangkok } from "@/lib/format";
import { policyYearAt } from "@/lib/insurance-flow";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { CcyBreakdown, StatBox } from "@/components/Boxes";
import { ShareBox, SHARE_COLORS, type ShareRow } from "@/components/ShareTable";
import MemberShareBox, { type MemberShareRow } from "./MemberShareBox";
import UrlSelect from "@/components/UrlSelect";
import { payDefaultValue } from "./PayDefaultSelect";
import InsuranceBatch, { type BoxPolicy, type PayOpt, type YLine } from "./InsuranceBatch";
import CoverageTab, { type ClaimKit, type CovClaim, type CovItem, type CovPolicy } from "./CoverageTab";
import { REC_LINK, recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { ReceiptEdit } from "./[id]/FlowRecord";
import type { Bank } from "../income-expenses/forms";
import { premiumPaymentFields } from "@/lib/source-edit";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { endpointValue } from "@/lib/money-endpoint";
import UndoButton from "@/components/UndoButton";
import { PART_LABEL, bookletCount, bookletGroups, bookletOrder, bookletRole, partLabel } from "@/lib/insurance-booklet";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);
// ความคุ้มครองต่อจากภาพรวม (ตกลง 3 พ.ย. 2026 · เดิมอยู่ท้ายสุด) · เลิกแท็บอัปเดตมูลค่าเวนคืน (8 พ.ย. 2026 · ลงตามตารางเองทุกวัน · ปรับรายเล่มที่หน้ากรมธรรม์)
const TABS = [["overview", "ภาพรวม"], ["coverage", "ความคุ้มครอง"], ["benefit", "บันทึกรับผลประโยชน์"], ["premium", "จ่ายชำระเบี้ยประกัน"]] as const;

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; s?: string; yb?: string; yp?: string; tab?: string; m?: string; i?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/insurance"];
  const sortMap = await loadSortMap("insurance_policies");
  const supabase = await createClient();
  const today = todayBangkok();
  // เดือนที่เลือก (แถบบน · ตกลง 28 ต.ค. 2026): เดือนนี้ = แท็บรับ / จ่ายแบบเดิม (ค้าง + ภายใน 60 วัน · ครบแล้วภายใน 60 วัน)
  //   เดือนอื่น = งวดค้าง + งวดที่ครบถึงสิ้นเดือนนั้น · งวดครบแล้วที่บันทึกในเดือนนั้น · วันที่ตั้งต้น = สิ้นเดือน (ไม่เกินวันนี้)
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const isCur = ym === today.slice(0, 7);
  const { end: mEnd } = monthRange(ym);
  const defaultDate = mEnd < today ? mEnd : today;
  const year = today.slice(0, 4);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  // แท็บรับ / จ่าย = กล่องเดียวต่อปีแบบเงินให้กู้ (ตกลง 3 พ.ย. 2026) · ปีจาก dropdown ของแต่ละแท็บ (?yb= รับ · ?yp= จ่าย · ตกลง 6 พ.ย. 2026)
  //   ไม่ระบุ = ปีของเดือนที่เลือก · เปลี่ยนเดือนแล้วปีกลับไปตามเดือน (MonthPicker reset) · เปลี่ยนคน / บริษัทคงปีไว้ · ออกจากเมนูแล้วกลับมา = ปีปัจจุบัน
  //   ปีนี้ = งวดที่ครบในปี + งวดค้างจากปีก่อน + งวดที่ครบภายใน 60 วัน (ข้ามปี) · ช่องกรอกเฉพาะงวดที่ค้าง / ครบถึง soon
  const yNow = Number(year);
  const yParam = (v: string | undefined) => /^\d{4}$/.test(v ?? "") ? Number(v) : isCur ? yNow : Number(ym.slice(0, 4));
  const yBen = yParam(sp.yb), yPrem = yParam(sp.yp);
  const yrOf = (kind: string) => (kind === "PREMIUM" ? yPrem : yBen);
  const soon = isCur ? addDays(today, 60) : mEnd;
  const inBox = (l: YLine) => {
    const yr = yrOf(l.kind);
    return (l.due_date >= `${yr}-01-01` && l.due_date <= `${yr}-12-31`)
      || (yr === yNow && INS_OPEN.includes(l.status) && (l.due_date < `${yr}-01-01` || l.due_date <= soon));
  };
  // ทุกงวดของทุกกรมธรรม์: Supabase ส่งครั้งละไม่เกิน 1,000 แถว (ตอนนี้ ~800 แถว · ข้อมูลจริงเกินได้) → อ่านทีละ 1,000 แถวจนครบ
  const linesQ = (async () => {
    const out: YLine[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("v_insurance_schedule_status").select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,paid_amount,remaining,status")
        .order("due_date").order("installment_no").order("id").range(from, from + 999);
      if (error) return { data: out, error };
      out.push(...((data as YLine[] | null) ?? []));
      if (!data || data.length < 1000) return { data: out, error: null };
    }
  })();
  // ที่จ่าย / รับแล้วของงวดในกล่อง (ทีละครั้ง · กดแก้ / ยกเลิก) → ต่อจากผลของ linesQ ในรอบเดียวกัน
  const recQ = linesQ.then(async ({ data: ls }) => {
    const ids = ((ls ?? []) as YLine[]).filter((l) => inBox(l) && Number(l.paid_amount ?? 0) > 0).map((l) => l.id);
    if (ids.length === 0) return { pays: [] as { id: string; insurance_schedule_line_id: string; date: string; amount: number; currency: string }[],
      bens: [] as { id: string; line_id: string; receipt_date: string; amount: number; currency: string; outcome: string | null }[] };
    const [p, b] = await Promise.all([
      supabase.from("expense_items").select("id,insurance_schedule_line_id,date,amount,currency").in("insurance_schedule_line_id", ids).is("deleted_at", null).order("date"),
      supabase.from("insurance_benefit_receipts").select("id,line_id,receipt_date,amount,currency,outcome").in("line_id", ids).is("undone_at", null).is("deleted_at", null).order("receipt_date"),
    ]);
    return { pays: p.data ?? [], bens: b.data ?? [] };
  });
  // เคลมปีนี้ + เคลมปีก่อนที่ยังรอรับ (กล่องเคลมของแท็บความคุ้มครอง · ตกลง 8 พ.ย. 2026)
  const claimQ = supabase.from("insurance_claims").select("id,policy_id,coverage_id,incident_date,claim_date,claimed_amount,received_amount,currency,status,notes").is("deleted_at", null)
    .or(`and(claim_date.gte.${year}-01-01,claim_date.lte.${year}-12-31),and(status.in.(${CLAIM_OPEN.join(",")}),claim_date.lt.${year}-01-01),and(status.in.(${CLAIM_OPEN.join(",")}),claim_date.is.null)`)
    .order("claim_date", { ascending: false }).then((r) => r);
  // รับเงินก้อนที่ไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) ในปีที่เลือกของแท็บรับ → แสดงใต้ชื่อกรมธรรม์
  //   รายการรับล่าสุดของกรมธรรม์ → กดยอดเพื่อแก้ / ลบ (หน้าต่างเดียวกับหน้ากรมธรรม์ / Income & Expenses · ตกลง 10 พ.ย. 2026)
  const lumpQ = supabase.from("insurance_benefit_receipts")
    .select("id,policy_id,receipt_date,amount,currency,outcome,bank_asset_id,notes,cash_value_part,pol:insurance_policies(cash_value_asset_id)").is("line_id", null)
    .gte("receipt_date", `${yBen}-01-01`).lte("receipt_date", `${yBen}-12-31`).is("undone_at", null).is("deleted_at", null).order("receipt_date")
    .then((r) => r);
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: fups }, { data: allLines },
    { data: banks }, { data: cards }, { data: family }, { data: yearLumps }, { data: allLumps }, rec, { data: pendExp }, { data: fx }, latestRc] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status,start_date,paid_from_asset_id,paid_from_credit_card_id,plan_name,coverage_scope")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name").order("sort_order"),
    supabase.from("assets").select("id,current_value,currency,current_value_date,asset_ownerships(person_id,ownership_percent,start_date,end_date,deleted_at)")
      .eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
    supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency,notes,max_count,count_period,label").is("deleted_at", null),
    claimQ,
    supabase.from("insurance_followups").select("id,person_id,policy_id,role,action,status").is("deleted_at", null)
      .in("status", ["OPEN", "IN_PROGRESS"]).order("created_at"),
    linesQ,
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    // รับเงินก้อนที่ไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) ในปีที่เลือกของแท็บรับ → แสดงใต้ชื่อกรมธรรม์
    lumpQ,
    // รับเงินก้อนที่ไม่ผูกงวด → กล่อง "ผลประโยชน์ที่รับ ปี …" (กรองปีในหน้า)
    supabase.from("insurance_benefit_receipts").select("policy_id,amount,currency,receipt_date").is("line_id", null).is("undone_at", null).is("deleted_at", null),
    recQ,
    // ค่าใช้จ่ายที่รอเงินคืน (ตัวเลือกของปุ่ม "บันทึกรับเงิน") · โหลดเมื่อมีเคลมที่ยังไม่จบ
    (async () => {
      const { data: cs } = await claimQ;
      if (me.role === "VIEWER" || !(cs ?? []).some((c) => !CLAIM_DONE.includes(c.status))) return { data: null };
      return await supabase.from("v_expense_reimbursement_status").select("expense_item_id,date,description,amount,currency,expected_reimbursement_amount,reimbursed_amount")
        .eq("is_reimbursable", true).neq("reimbursement_status", "FULL").order("date", { ascending: false }).limit(100);
    })(),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    // รายการรับล่าสุดของแต่ละกรมธรรม์ (ทั้งรับตามงวดและรับก้อน · วันที่ → เวลาที่บันทึก เหมือนหน้ากรมธรรม์)
    me.role === "ADMIN" || me.role === "EDITOR" ? lumpQ.then(async ({ data }) => {
      const pols = [...new Set((data ?? []).map((b) => b.policy_id as string))];
      if (!pols.length) return new Set<string>();
      const { data: all } = await supabase.from("insurance_benefit_receipts").select("id,policy_id,receipt_date,created_at")
        .in("policy_id", pols).is("undone_at", null).is("deleted_at", null);
      const best = new Map<string, { id: string; d: string; at: string }>();
      (all ?? []).forEach((r) => {
        const cur = best.get(r.policy_id as string), d = r.receipt_date as string, at = r.created_at as string;
        if (!cur || d > cur.d || (d === cur.d && at > cur.at)) best.set(r.policy_id as string, { id: r.id as string, d, at });
      });
      return new Set([...best.values()].map((x) => x.id));
    }) : Promise.resolve(new Set<string>()),
  ]);
  // สกุลเงินอื่น → บาทด้วยอัตราล่าสุด (THB Equivalent · แบบหน้า Bank Accounts · ตกลง 9 พ.ย. 2026) · ยอดแยกตามสกุลแสดงใต้กล่อง
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const toThb = (v: number | string | null | undefined, c: string | null | undefined) => Number(v ?? 0) * (rate.get(c ?? "THB") ?? 0);
  type ByCcy = Map<string, number>;
  const addCcy = (m: ByCcy, c: string | null | undefined, v: number) => { if (Math.abs(v) > 0.005) m.set(c ?? "THB", (m.get(c ?? "THB") ?? 0) + v); return m; };
  const thbOf = (m: ByCcy) => [...m].reduce((t, [c, v]) => t + toThb(v, c), 0);
  const ccyItems = (m: ByCcy) => [...m].map(([ccy, amount]) => ({ ccy, amount, thb: toThb(amount, ccy) }));
  const pname = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const cv = new Map((cvs ?? []).map((a) => [a.id, a]));
  // ตัวกรองบริษัทประกัน (?i= · ใช้กับทุกแท็บ · ตกลง 6 พ.ย. 2026)
  const insurers = [...new Set((data ?? []).map((r) => r.insurer as string).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  const iFilter = insurers.includes(sp.i ?? "") ? (sp.i as string) : "";
  const pol = (data ?? []).filter((r) => !iFilter || r.insurer === iFilter);
  // มุมมองรายบุคคล: กรมธรรม์ที่คนนั้นเป็นผู้เอาประกัน หรือเป็นเจ้าของมูลค่าเวนคืน · มูลค่าเวนคืน × สัดส่วนเจ้าของ
  const mineRows = bySort(pol.filter((r) => pv.isPerson(r.person_id) || (pv.personId !== "" && r.payer_person_id === pv.personId)
    || (!!r.cash_value_asset_id && pv.personId !== "" && pv.showAsset(r.cash_value_asset_id))), (r) => r.id, sortMap);
  // ตัวกรองด้านบนตารางภาพรวม แบบหน้าทรัพย์สิน (ตกลง 3 พ.ย. 2026): ประเภท (?t=) · สถานะ (?s= · ตั้งต้น = มีผล · all = ทั้งหมด)
  const types = INS_TYPE.map(([k]) => k).filter((k) => mineRows.some((r) => r.insurance_type === k));
  const tFilter = types.includes(sp.t ?? "") ? sp.t : undefined;
  const rows = tFilter ? mineRows.filter((r) => r.insurance_type === tFilter) : mineRows;
  const statuses = INS_STATUS.map(([k]) => k).filter((k) => k === "ACTIVE" || mineRows.some((r) => r.status === k));
  const sFilter = sp.s === "all" ? "all" : statuses.includes(sp.s ?? "") ? (sp.s as string) : "ACTIVE";
  const listRows = sFilter === "all" ? rows : rows.filter((r) => r.status === sFilter);
  const sParam = sFilter === "ACTIVE" ? undefined : sFilter;
  const fHref = (t: string | undefined, s: string | undefined) => {
    const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (iFilter) q.set("i", iFilter); if (t) q.set("t", t); if (s && s !== "ACTIVE") q.set("s", s);
    const x = q.toString(); return `/insurance${x ? `?${x}` : ""}`;
  };
  const lineList = (allLines ?? []) as YLine[];
  // เบี้ยเลยกำหนดต่อกรมธรรม์ (ใต้สถานะ · ตกลง 7 พ.ย. 2026 · เลิกคอลัมน์เบี้ย / ผลประโยชน์งวดถัดไป เพราะมีแท็บแล้ว)
  const overduePremium = new Map<string, number>();
  lineList.forEach((l) => { if (l.kind === "PREMIUM" && l.status === "OVERDUE") overduePremium.set(l.policy_id, (overduePremium.get(l.policy_id) ?? 0) + 1); });
  const policyName = new Map((data ?? []).map((r) => [r.id, `${r.insurer}${r.policy_no ? ` · ${r.policy_no}` : ""}`]));
  const fupRows = (fups ?? []).filter((f) => pv.isPerson(f.person_id) || rows.some((r) => r.id === f.policy_id));
  const cvOfPol = new Set(pol.map((r) => r.cash_value_asset_id).filter(Boolean));
  const cvByCcy: ByCcy = new Map();
  (cvs ?? []).filter((a) => pv.showAsset(a.id) && (!iFilter || cvOfPol.has(a.id)))
    .forEach((a) => addCcy(cvByCcy, a.currency, Number(a.current_value ?? 0) * pv.assetShare(a.id)));
  const cvTotal = thbOf(cvByCcy);
  // กล่องสรุปด้านบน (ตกลง 7 พ.ย. 2026 · กรมธรรม์ที่มีผล · THB)
  const act = mineRows.filter((r) => r.status === "ACTIVE");
  const activeIds = new Set(act.map((r) => r.id));
  const sumByCcy = (f: (r: (typeof act)[number]) => number | null, ccyOf: (r: (typeof act)[number]) => string | null) =>
    act.reduce((m, r) => addCcy(m, ccyOf(r), Number(f(r) ?? 0)), new Map() as ByCcy);
  //   ทุนประกันชีวิต = ชีวิต + บำนาญ (สุขภาพใช้วงเงิน · ส่วนใหญ่เป็นเบี้ยทิ้ง → ไม่รวม) · อุบัติเหตุ = เสียชีวิตจากอุบัติเหตุเพิ่มอีก
  const lifeByCcy = sumByCcy((r) => (r.insurance_type === "LIFE" || r.insurance_type === "ANNUITY" ? r.insured_amount : 0), (r) => r.insured_amount_currency);
  const lifeTotal = thbOf(lifeByCcy);
  const accidentTotal = thbOf(sumByCcy((r) => (r.insurance_type === "ACCIDENT" ? r.insured_amount : 0), (r) => r.insured_amount_currency));
  const overdueTotal = mineRows.reduce((t, r) => t + (overduePremium.get(r.id) ?? 0), 0);
  //   ปีนี้ยังต้องจ่าย = เบี้ยงวดที่ยังจ่ายไม่ครบ ครบกำหนดไม่เกินสิ้นปีนี้ (รวมงวดเลยกำหนด)
  const premLeftYear = lineList.filter((l) => l.kind === "PREMIUM" && activeIds.has(l.policy_id)
    && INS_OPEN.includes(l.status) && l.due_date <= `${year}-12-31`).reduce((t, l) => t + toThb(l.remaining, l.currency), 0);
  // กล่อง 3–4 (ตกลง 9 พ.ย. 2026): ผลประโยชน์ / เบี้ย ของปีนี้ (ตามวันครบกำหนดของงวด · THB) · เบี้ยแต่ละปีไม่เท่ากัน
  const mineIds = new Set(mineRows.map((r) => r.id));
  const lineInYear = (l: YLine) => l.due_date >= `${year}-01-01` && l.due_date <= `${year}-12-31`;
  const benLines = lineList.filter((l) => l.kind === "BENEFIT" && mineIds.has(l.policy_id) && lineInYear(l));
  const lumps = (allLumps ?? []).filter((b) => mineIds.has(b.policy_id) && String(b.receipt_date ?? "").startsWith(year));
  const lumpYear = lumps.reduce((t, b) => t + toThb(b.amount, b.currency), 0);
  const benGotYear = benLines.reduce((t, l) => t + toThb(insCountedPaid(l), l.currency), 0) + lumpYear;
  const benByCcy = lumps.reduce((m, b) => addCcy(m, b.currency, Number(b.amount)), benLines.reduce((m, l) => addCcy(m, l.currency, Number(l.amount ?? 0)), new Map() as ByCcy));
  const benPlanYear = thbOf(benByCcy);
  const premLines = lineList.filter((l) => l.kind === "PREMIUM" && activeIds.has(l.policy_id) && lineInYear(l));
  const premByCcy = premLines.reduce((m, l) => addCcy(m, l.currency, Number(l.amount ?? 0)), new Map() as ByCcy);
  const premYear = thbOf(premByCcy);
  const premPaidYear = premLines.reduce((t, l) => t + toThb(insCountedPaid(l), l.currency), 0);
  //   กล่องผลประโยชน์ (ตกลง 9 พ.ย. 2026): ตัวใหญ่ = ทั้งปีตามตาราง · รับแล้ว · รอรับ · ค้างรับ (ทุกปี) · % = รับแล้วเทียบเบี้ยที่จ่ายปีนี้
  //   (% ตั้งแต่เริ่มกรมธรรม์ดูที่หน้ากรมธรรม์แต่ละฉบับ)
  const benLeftYear = Math.max(benPlanYear - benGotYear, 0);
  const benOverdue = lineList.filter((l) => l.kind === "BENEFIT" && mineIds.has(l.policy_id) && l.status === "OVERDUE").length;
  const benPct = premPaidYear > 0 ? (benGotYear / premPaidYear) * 100 : null;
  const yearBE = Number(year) + 543;
  // กล่องสัดส่วน (ตกลง 8 พ.ย. 2026) · THB เหมือนกล่องสรุปด้านบน · ไม่ใช้เบี้ย (เบี้ยเปลี่ยนทุกปีตามกรมธรรม์ · เจ้าของ 8 พ.ย. 2026)
  //   ซ้าย = มูลค่าเวนคืนตามบริษัทประกัน (ตามตัวกรองคน × สัดส่วนเจ้าของ + บริษัท → รวมเท่ากล่อง "มูลค่าเวนคืน" ด้านบน)
  //   ขวา = ตามสมาชิกครอบครัว: ทุนประกันชีวิต · มูลค่าเวนคืน (ทั้งครอบครัวแบบหน้า Alternative · ตามตัวกรองบริษัท)
  const isLife = (t: string) => t === "LIFE" || t === "ANNUITY";
  const polsOfCv = new Map<string, typeof pol>();
  pol.forEach((r) => { if (r.cash_value_asset_id) polsOfCv.set(r.cash_value_asset_id, [...(polsOfCv.get(r.cash_value_asset_id) ?? []), r]); });
  const cvShown = (cvs ?? []).filter((a) => pv.showAsset(a.id) && (!iFilter || cvOfPol.has(a.id)) && Number(a.current_value ?? 0) > 0);
  const byInsurer = new Map<string, { name: string; value: number; pols: typeof pol; fx: ByCcy }>();
  cvShown.forEach((a) => {
    const ps = polsOfCv.get(a.id) ?? [];
    const name = String(ps[0]?.insurer ?? "").trim();
    const k = name.toLowerCase();
    const x = byInsurer.get(k) ?? { name: name || "ไม่ระบุบริษัท", value: 0, pols: [] as typeof pol, fx: new Map() as ByCcy };
    const own = Number(a.current_value) * pv.assetShare(a.id);
    x.value += toThb(own, a.currency); x.pols.push(...ps); byInsurer.set(k, x);
    if (a.currency !== "THB") addCcy(x.fx, a.currency, own);
  });
  const insurerRows: ShareRow[] = [...byInsurer.entries()].filter(([, x]) => x.value > 0).sort((a, b) => b[1].value - a[1].value)
    .map(([k, x], i) => ({ key: k || "-", name: x.name, value: x.value, color: SHARE_COLORS[i % SHARE_COLORS.length],
      sub: [x.pols.length ? `(${bookletCount(x.pols)} ฉบับ)` : "", ...[...x.fx].map(([c, v]) => `${c} ${money(v, undefined, 0)}`)].filter(Boolean).join(" · ") || undefined }));
  const famAct = pol.filter((r) => r.status === "ACTIVE");
  const mem = new Map<string, { life: number; cv: number }>();
  const memOf = (k: string) => { const x = mem.get(k) ?? { life: 0, cv: 0 }; mem.set(k, x); return x; };
  famAct.forEach((r) => {
    if (!r.person_id || !isLife(r.insurance_type)) return;
    memOf(r.person_id).life += toThb(r.insured_amount, r.insured_amount_currency);
  });
  type Own = { person_id: string; ownership_percent: number; start_date: string; end_date: string | null; deleted_at: string | null };
  (cvs ?? []).filter((a) => (!iFilter || cvOfPol.has(a.id)) && Number(a.current_value ?? 0) > 0).forEach((a) => {
    const os = ((a.asset_ownerships ?? []) as Own[]).filter((o) => !o.deleted_at && o.start_date <= today && (!o.end_date || o.end_date >= today));
    const v = toThb(a.current_value, a.currency);
    if (!os.length) { memOf("?").cv += v; return; }
    os.forEach((o) => { memOf(o.person_id).cv += (v * Number(o.ownership_percent)) / 100; });
  });
  const memberRows: MemberShareRow[] = [...mem.entries()].filter(([, x]) => x.life > 0 || x.cv > 0)
    .sort((a, b) => b[1].cv - a[1].cv || b[1].life - a[1].life)
    .map(([k, x], i) => ({ key: k, ...x, color: SHARE_COLORS[i % SHARE_COLORS.length], current: !!pv.personId && k === pv.personId,
      name: k === "?" ? "ยังไม่ระบุเจ้าของ" : pname.get(k) ?? "สมาชิก" }));

  //   กรมธรรม์สกุลเงินอื่นที่ไม่ได้นับ (มูลค่าเวนคืน / ทุนประกันไม่ใช่บาท) → บรรทัดเล็กใต้กล่อง
  const cvOf = (r: (typeof rows)[number]) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
    return c && c.current_value != null ? toThb(c.current_value, c.currency) * pv.assetShare(c.id) : 0; };
  const bankPays: PayOpt[] = (banks ?? []).map((b) => ({ value: endpointValue({ kind: "bank", id: b.asset_id }), label: `บัญชี ${b.name}`, currency: b.currency }));
  const cardPays: PayOpt[] = (cards ?? []).map((c) => ({ value: endpointValue({ kind: "card", id: c.id }),
    label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency }));
  const canWrite = me.role !== "VIEWER";
  const goLive = family?.go_live_date ?? "";
  const mine = new Set(mineRows.map((r) => r.id));
  const OUTCOME: Record<string, string> = { MATURED: "ครบสัญญา", SURRENDERED: "เวนคืน", CLAIMED: "สินไหม" };
  // ยอดที่จ่าย / รับแล้วของงวด → กดเพื่อแก้ / ลบ (ตกลง 28 ต.ค. 2026) · เบี้ย = ฟอร์มเดียวกับหน้ากรมธรรม์ · ผลประโยชน์ = ยกเลิกทั้งก้อนแล้วบันทึกใหม่
  const editsOf = (l: YLine): Recorded[] => {
    const paths = ["/insurance", `/insurance/${l.policy_id}`, "/income-expenses"];
    return [
      ...rec.pays.filter((e) => e.insurance_schedule_line_id === l.id).map((e) => ({ id: e.id as string, node: recEdit({
        canWrite, canDelete: canOrder, table: "expense_items", id: e.id as string, label: recLabel("จ่ายแล้ว", e.date as string, Number(e.amount), e.currency as string),
        paths, fields: premiumPaymentFields(e as { date: string; amount: number }) }) })),
      ...rec.bens.filter((b) => b.line_id === l.id).map((b) => {
        const label = recLabel(b.outcome ? OUTCOME[b.outcome] ?? "รับแล้ว" : "รับแล้ว", b.receipt_date as string, Number(b.amount), b.currency as string);
        return { id: b.id as string, node: canOrder && !b.outcome
          ? <span className="inline-flex items-center gap-2"><span className="text-xs text-emerald-700">{label}</span>
              <UndoButton kind="BENEFIT" id={b.id as string} paths={paths} label="ยกเลิก"
                confirmText={`ยกเลิกการรับ ${money(Number(b.amount), b.currency as string)} วันที่ ${thDate(b.receipt_date as string)} (งวดที่ ${l.installment_no}) ทั้งก้อน?\nเงินที่ถอนจากมูลค่าเวนคืน / รายได้ของครั้งนี้ถูกย้อนทั้งหมด แล้วบันทึกยอดที่ถูกใหม่ในตารางได้`} /></span>
          : recLink(label, `/insurance/${l.policy_id}`) };
      }),
    ];
  };
  // กล่องรายปี: กรมธรรม์ (ตามตัวกรองคน · ลำดับเดียวกับภาพรวม) ที่มีงวดในกล่อง หรือรับเงินก้อนในปีนั้น
  const boxOf = (kind: "PREMIUM" | "BENEFIT"): BoxPolicy[] => {
    const prem = kind === "PREMIUM";
    const yStart = `${yrOf(kind)}-01-01`, yEnd = `${yrOf(kind)}-12-31`;
    const ls = lineList.filter((l) => l.kind === kind && mine.has(l.policy_id) && inBox(l));
    const lumps = prem ? [] : (yearLumps ?? []).filter((b) => mine.has(b.policy_id));
    const ids = new Set([...ls.map((l) => l.policy_id), ...lumps.map((b) => b.policy_id)]);
    // จ่ายเบี้ย: กรมธรรม์เล่มเดียวกัน (ชีวิต + สัญญาเพิ่มเติม) อยู่ติดกัน + แถวรวมทั้งเล่ม (ตกลง 6 พ.ย. 2026)
    const inBoxPols = mineRows.filter((r) => ids.has(r.id));
    const groups = prem ? bookletGroups(inBoxPols) : new Map<string, typeof inBoxPols>();
    return (prem ? bookletOrder(inBoxPols) : inBoxPols).map((r) => {
      const who = prem ? (r.payer_person_id ?? r.person_id) : r.person_id;
      const role = bookletRole(r, groups);
      return { id: r.id, name: policyName.get(r.id) ?? "-", person: who ? pname.get(who) ?? null : null, active: r.status === "ACTIVE",
        booklet: role ? { key: role.key, part: partLabel(r, role.main), rider: !role.isMain, last: role.parts.at(-1)?.id === r.id, size: role.parts.length } : undefined,
        pay: prem ? payDefaultValue(r) : "",
        lines: ls.filter((l) => l.policy_id === r.id).map((l) => ({ id: l.id, no: l.installment_no, due: l.due_date, amount: Number(l.amount),
          paid: insCountedPaid(l), remaining: l.status === "CLOSED" ? 0 : Number(l.remaining), currency: l.currency, status: l.status,
          benefitType: l.benefit_type, edits: editsOf(l),
          tag: l.due_date < yStart ? `ค้างจากปี ${Number(l.due_date.slice(0, 4)) + 543}` : l.due_date > yEnd ? `งวดปี ${Number(l.due_date.slice(0, 4)) + 543}` : null })),
        lumps: lumps.filter((b) => b.policy_id === r.id).map((b) => {
          const label = recLabel(OUTCOME[b.outcome ?? ""] ?? "รับเงินก้อน", b.receipt_date as string, Number(b.amount), b.currency as string);
          const cv = one(b.pol as { cash_value_asset_id: string | null } | { cash_value_asset_id: string | null }[] | null)?.cash_value_asset_id;
          return { id: b.id as string, node: canOrder && latestRc.has(b.id as string)
            ? <ReceiptEdit button={`${label} ✎`} buttonClass={REC_LINK} currency={b.currency as string} banks={(banks ?? []) as Bank[]} hasCashValue={!!cv}
                paths={["/insurance", `/insurance/${r.id}`, "/income-expenses"]}
                r={{ id: b.id as string, date: b.receipt_date as string, amount: Number(b.amount), bank_asset_id: b.bank_asset_id as string | null,
                  notes: b.notes as string | null, outcome: b.outcome as string | null, cash_value_part: Number(b.cash_value_part ?? 0) }} />
            : recLink(label, `/insurance/${r.id}`) };
        }),
      };
    });
  };
  // dropdown ปี: ปีแรก–ปีสุดท้ายที่มีงวด (รวมปีนี้) · ✓ = มีงวด · "ค้าง" = มีงวดเลยกำหนด
  const yearsOf = (kind: string) => {
    const ys = lineList.filter((l) => l.kind === kind && mine.has(l.policy_id)).map((l) => Number(l.due_date.slice(0, 4)));
    const yr = yrOf(kind);
    const lo = Math.min(yNow, yr, ...ys), hi = Math.max(yNow, yr, ...ys);
    const has = new Set(ys);
    const late = new Set(lineList.filter((l) => l.kind === kind && mine.has(l.policy_id) && l.status === "OVERDUE").map((l) => Number(l.due_date.slice(0, 4))));
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((y) => ({ value: y, mark: late.has(y) ? "· ค้าง" : has.has(y) ? "✓" : undefined }));
  };
  // ลิงก์เปลี่ยนปีของแท็บหนึ่ง: คงปีของอีกแท็บ + ตัวกรองอื่นไว้
  const yKeep = (q: URLSearchParams, skip?: string) => { (["yb", "yp"] as const).forEach((k) => { if (k !== skip && sp[k]) q.set(k, sp[k] as string); }); };
  const yHrefOf = (t: "benefit" | "premium") => { const own = t === "benefit" ? "yb" : "yp";
    const q = new URLSearchParams({ tab: t }); if (sp.p) q.set("p", sp.p); if (sp.m) q.set("m", sp.m); if (iFilter) q.set("i", iFilter); yKeep(q, own);
    return `/insurance?${q.toString()}&${own}=__Y__`; };
  // งวดค้าง (เลยกำหนด ณ วันนี้ · THB · ทุกปี) → บรรทัดสีแดงใต้ตาราง (เลิกการ์ด 3 กล่องด้านบน · ตกลง 6 พ.ย. 2026)
  const lateOf = (kind: "PREMIUM" | "BENEFIT") => {
    const late = lineList.filter((l) => l.kind === kind && activeIds.has(l.policy_id) && l.currency === "THB"
      && (l.status === "OVERDUE" || (l.status === "PARTIAL" && l.due_date < today)) && Number(l.remaining) > 0);
    return { count: late.length, amount: late.reduce((t, l) => t + Number(l.remaining), 0) };
  };
  // แท็บความคุ้มครอง (ตกลง 3 พ.ย. 2026): กรมธรรม์ที่มีผลตามผู้เอาประกัน · วงเงินต่อปีหักยอดเคลมปีนี้ (ไม่นับปฏิเสธ / ยกเลิก)
  const usedByCov = new Map<string, number>();
  const inYear = (c: { claim_date: string | null }) => !!c.claim_date && c.claim_date.startsWith(year);
  (claims ?? []).filter((c) => c.coverage_id && inYear(c) && !["REJECTED", "CANCELLED"].includes(c.status)).forEach((c) =>
    usedByCov.set(c.coverage_id as string, (usedByCov.get(c.coverage_id as string) ?? 0) + Number(c.received_amount ?? c.claimed_amount ?? 0)));
  const activeAll = pol.filter((r) => r.status === "ACTIVE" && r.person_id);
  const activePerson = new Map(activeAll.map((r) => [r.id, r.person_id as string]));
  // คุ้มครองเฉพาะ (ต่อส่วนของเล่ม · ตกลง 8 พ.ย. 2026) → แถวแยกในแท็บความคุ้มครอง ไม่บวกกับวงเงินทั่วไป
  const scopeOf = new Map(activeAll.map((r) => [r.id, (r.coverage_scope as string | null) ?? null]));
  const covRows = (covs ?? []).filter((c) => activePerson.has(c.policy_id));
  const covItems: CovItem[] = covRows.map((c) => ({ policyId: c.policy_id, personId: activePerson.get(c.policy_id) as string, type: c.coverage_type,
    limit: Number(c.limit_amount), used: usedByCov.get(c.id) ?? 0, currency: c.currency, notes: c.notes, maxCount: c.max_count,
    period: c.count_period, label: c.label, scope: scopeOf.get(c.policy_id) ?? null }));
  // กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองประเภทนั้น → ใช้ทุนประกันของกรมธรรม์
  activeAll.forEach((r) => {
    const k = deathCoverage(r.insurance_type);
    if (!k || Number(r.insured_amount ?? 0) <= 0 || covRows.some((c) => c.policy_id === r.id && c.coverage_type === k)) return;
    covItems.push({ policyId: r.id, personId: r.person_id as string, type: k, limit: Number(r.insured_amount), used: 0,
      currency: r.insured_amount_currency ?? "THB", notes: null, fromPolicy: true, scope: scopeOf.get(r.id) ?? null });
  });
  const covPolicies: CovPolicy[] = activeAll.map((r) => ({ id: r.id, name: policyName.get(r.id) ?? "-", type: r.insurance_type, personId: r.person_id,
    endDate: r.end_date, expiring: r.derived_status === "EXPIRING_SOON", expired: r.derived_status === "EXPIRED",
    premium: Number(r.premium ?? 0), premiumCcy: r.premium_currency ?? "THB", hasCov: covRows.some((c) => c.policy_id === r.id),
    plan: r.plan_name ?? null, scope: r.coverage_scope ?? null }));
  const covByIdType = new Map((covs ?? []).map((c) => [c.id, c.coverage_type as string]));
  const covByIdLabel = new Map((covs ?? []).map((c) => [c.id, c.label as string | null]));
  const policyPerson = new Map((data ?? []).map((r) => [r.id, r.person_id as string | null]));
  const polIds = new Set(pol.map((r) => r.id));
  const covClaims: CovClaim[] = (claims ?? []).filter((c) => polIds.has(c.policy_id)).map((c) => ({ id: c.id, policyId: c.policy_id, personId: policyPerson.get(c.policy_id) ?? null,
    coverageType: c.coverage_id ? covByIdType.get(c.coverage_id) ?? null : null, coverageLabel: c.coverage_id ? covByIdLabel.get(c.coverage_id) ?? null : null, date: c.claim_date ?? c.incident_date, claimed: Number(c.claimed_amount ?? 0),
    received: Number(c.received_amount ?? 0), currency: c.currency, status: c.status, notes: c.notes,
    claimDate: c.claim_date, claimedRaw: c.claimed_amount, receivedRaw: c.received_amount, inYear: inYear(c) }));
  // ปุ่ม + บันทึกเคลม (เลือกกรมธรรม์ที่มีผลของสมาชิกในมุมมอง) + บันทึกรับเงิน
  const claimPols = activeAll.filter((r) => pv.isPerson(r.person_id as string))
    .sort((a, b) => (pname.get(a.person_id as string) ?? "").localeCompare(pname.get(b.person_id as string) ?? "", "th") || String(a.insurer).localeCompare(String(b.insurer), "th"));
  const claimKit: ClaimKit = {
    policies: claimPols.map((r) => ({ id: r.id, currency: r.insured_amount_currency ?? r.premium_currency ?? "THB",
      label: `${pname.get(r.person_id as string) ?? "-"} · ${policyName.get(r.id) ?? "-"} · ${PART_LABEL[r.insurance_type] ?? TYPE[r.insurance_type] ?? r.insurance_type}${r.plan_name ? ` · ${r.plan_name}` : ""}` })),
    coverages: (covs ?? []).filter((c) => claimPols.some((r) => r.id === c.policy_id))
      .map((c) => ({ id: c.id, policy_id: c.policy_id, coverage_type: c.coverage_type, limit_amount: Number(c.limit_amount), label: c.label })),
    banks: banks ?? [], persons: (persons ?? []).map((x) => ({ id: x.id, name: x.name })), today, minDate: goLive || null,
    canDelete: me.role === "ADMIN" || me.role === "EDITOR",
    expenses: (pendExp ?? []).map((e) => ({ id: e.expense_item_id as string, date: e.date as string, description: e.description as string, currency: e.currency as string,
      remaining: Math.round((Number(e.expected_reimbursement_amount ?? e.amount) - Number(e.reimbursed_amount ?? 0)) * 100) / 100 })).filter((e) => e.remaining > 0.005),
  };
  const covPersonsInView = pv.persons.filter((x) => pv.isPerson(x.id));
  // ตัวกรองบริษัทประกันของแต่ละแท็บ (เปลี่ยนแล้วอยู่แท็บเดิม · คงตัวกรองอื่นไว้)
  const insFilter = (t: string) => insurers.length < 2 && !iFilter ? null : (
    <UrlSelect label="บริษัทประกัน" value={iFilter} options={["", ...insurers].map((v) => {
      const q = new URLSearchParams(); if (t !== "overview") q.set("tab", t); if (sp.p) q.set("p", sp.p); if (sp.m) q.set("m", sp.m);
      if (v) q.set("i", v); if (t === "overview") { if (tFilter) q.set("t", tFilter); if (sParam) q.set("s", sParam); }
      if (t === "benefit" || t === "premium") yKeep(q);
      return { value: v, label: v || "ทั้งหมด", href: `/insurance${q.size ? `?${q.toString()}` : ""}` };
    })} />
  );
  // ภาพรวม: สัญญาเพิ่มเติม (บริษัท + เลขกรมธรรม์เดียวกัน) อยู่ใต้รายการหลัก · โหมดจัดลำดับ = ลำดับเดิม
  //   เบี้ยรวมทั้งเล่มต่อท้าย "↳ สัญญาเพิ่มเติม" ของส่วนสุดท้าย (แทนบรรทัดรวมทั้งเล่ม · ตกลง 7 พ.ย. 2026)
  const listGroups = bookletGroups(listRows);
  const shownRows = ordering ? listRows : bookletOrder(listRows);
  const ccyTag = (c: string | null) => (c && c !== "THB" ? c : undefined);
  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <PageInfo>กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</PageInfo>
      <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /><MonthPicker months={monthOptions(goLive, today, 12, ym)} value={ym} reset={["yb", "yp"]} /></HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/insurance/new" className={ADD_BTN}>+ เพิ่มกรมธรรม์</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="benefit" className="space-y-4">
        <InsuranceBatch key={`b${ym}${yBen}${lineList.length}`} kind="BENEFIT" year={yBen} years={yearsOf("BENEFIT")} hrefOf={yHrefOf("benefit")} policies={boxOf("BENEFIT")} filter={insFilter("benefit")} late={lateOf("BENEFIT")}
          pays={bankPays} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
      </TabPanel>
      <TabPanel id="premium" className="space-y-4">
        <InsuranceBatch key={`p${ym}${yPrem}${lineList.length}`} kind="PREMIUM" year={yPrem} years={yearsOf("PREMIUM")} hrefOf={yHrefOf("premium")} policies={boxOf("PREMIUM")} filter={insFilter("premium")} late={lateOf("PREMIUM")}
          pays={[...bankPays, ...cardPays]} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
      </TabPanel>

      <TabPanel id="coverage">
        <CoverageTab persons={covPersonsInView} personId={pv.personId} personName={pv.personName} policies={covPolicies} items={covItems} claims={covClaims}
          year={year} printHref={`/print/insurance${pv.personId ? `?p=${pv.personId}` : ""}`} canWrite={canWrite} filter={insFilter("coverage")} kit={claimKit}
          rates={Object.fromEntries(rate)} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* กล่องสรุป 4 อัน (ตกลง 9 พ.ย. 2026): มูลค่าเวนคืน · ทุนประกันชีวิต · ผลประโยชน์ปีนี้ · เบี้ยปีนี้ */}
        <StatBox label={<>{pv.personId ? `มูลค่าเวนคืนส่วนของ ${pv.personName}` : "มูลค่าเวนคืนรวม"} (THB Equivalent) · ถึงวันนี้</>} value={money(cvTotal, "THB", 0)}
          sub={`กรมธรรม์ที่มีผล ${bookletCount(act)} ฉบับ`}><CcyBreakdown items={ccyItems(cvByCcy)} /></StatBox>
        <StatBox label="ทุนประกันชีวิตรวม (THB Equivalent)" value={money(lifeTotal, "THB", 0)}
          sub={accidentTotal > 0 ? `เสียชีวิตจากอุบัติเหตุ เพิ่มอีก ${money(accidentTotal, undefined, 0)}` : "ชีวิต + บำนาญ · สุขภาพดูวงเงินที่แท็บความคุ้มครอง"}>
          <CcyBreakdown items={ccyItems(lifeByCcy)} /></StatBox>
        <StatBox label={`ผลประโยชน์ที่รับ ปี ${yearBE} (THB Equivalent)`} value={money(benPlanYear, "THB", 0)}
          sub={<>
            <div>รับแล้ว {money(benGotYear, undefined, 0)} · รอรับ {money(benLeftYear, undefined, 0)}</div>
            {benPct != null && <div>รับแล้วเทียบเบี้ยที่จ่ายปีนี้ <span className="font-semibold">{benPct.toFixed(0)}%</span></div>}
            {benOverdue > 0 && <div className="text-red-600">ค้างรับ {benOverdue} งวด</div>}
          </>}><CcyBreakdown items={ccyItems(benByCcy)} /></StatBox>
        <StatBox label={`เบี้ยประกัน ปี ${yearBE} (THB Equivalent)`} value={money(premYear, "THB", 0)}
          sub={<>
            <div>จ่ายแล้ว {money(premPaidYear, undefined, 0)} · ยังต้องจ่าย {money(premLeftYear, undefined, 0)}</div>
            {overdueTotal > 0 && <div className="text-red-600">เลยกำหนด {overdueTotal} งวด</div>}
          </>}><CcyBreakdown items={ccyItems(premByCcy)} /></StatBox>
      </section>
      {(insurerRows.length > 0 || memberRows.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <ShareBox title={<>มูลค่าเวนคืนตามบริษัทประกัน{pv.personId ? ` ส่วนของ ${pv.personName}` : ""}</>} label="บริษัทประกัน" valueLabel="มูลค่าเวนคืน (THB)"
            rows={insurerRows} boldPct empty="ยังไม่มีมูลค่าเวนคืน" />
          <MemberShareBox rows={memberRows} />
        </section>
      )}
      {fupRows.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">กรมธรรม์ที่ต้องติดตาม (สมาชิก Archived) · ค้าง {fupRows.length} รายการ</h2>
          <ul className="space-y-1 text-sm">
            {fupRows.map((f) => (
              <li key={f.id}>
                <Link href={`/insurance/${f.policy_id}`} className="font-medium hover:underline">{policyName.get(f.policy_id) ?? "กรมธรรม์"}</Link>
                {" · "}{pname.get(f.person_id)} ({FOLLOWUP_ROLE[f.role]}) · {f.action}
                <span className="ml-1 text-xs text-amber-800">[{Object.fromEntries(FOLLOWUP_STATUS)[f.status]}]</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* ตัวกรอง + ยอดรวมตามตัวกรองอยู่แถวบน แบบหน้าทรัพย์สิน (ตกลง 3 พ.ย. 2026 · เดิมยอดรวมอยู่ท้ายตาราง) */}
        <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-xs text-slate-600">
          {insFilter("overview")}
          <UrlSelect label="ประเภท" value={tFilter ?? ""} options={[{ value: "", label: "ทั้งหมด", href: fHref(undefined, sParam) },
            ...types.map((t) => ({ value: t, label: TYPE[t] ?? t, href: fHref(t, sParam) }))]} />
          <UrlSelect label="สถานะ" value={sFilter} options={[{ value: "all", label: "ทั้งหมด", href: fHref(tFilter, "all") },
            ...statuses.map((k) => ({ value: k, label: STATUS[k] ?? k, href: fHref(tFilter, k) }))]} />
          {listRows.length > 0 && (() => {
            // ทุนประกันชีวิต = นิยามเดียวกับกล่องด้านบน (ชีวิต + บำนาญ · มีผล · THB Equivalent) ตามตัวกรอง (ตกลง 9 พ.ย. 2026 · แทนเบี้ย)
            const life = listRows.filter((r) => r.status === "ACTIVE" && (r.insurance_type === "LIFE" || r.insurance_type === "ANNUITY"))
              .reduce((t, r) => t + toThb(r.insured_amount, r.insured_amount_currency), 0);
            const cvSum = listRows.reduce((t, r) => t + cvOf(r), 0);
            return (
              <span className="ml-auto text-right text-sm text-slate-700">
                รวม{tFilter || iFilter || sFilter !== "ACTIVE" ? "ตามตัวกรอง" : ""} {bookletCount(listRows)} ฉบับ
                {cvSum > 0 && <> · มูลค่าเวนคืน <b className="tabular-nums">{money(cvSum, undefined, 0)}</b></>}
                {life > 0 && <> · ทุนประกันชีวิต <b className="tabular-nums">{money(life, undefined, 0)}</b></>}
              </span>
            );
          })()}
          {canOrder && listRows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/insurance", { p: sp.p, i: iFilter || undefined, t: tFilter, s: sParam })} />}
        </div>
        {/* คอลัมน์ (ตกลง 7 พ.ย. 2026 · ปรับ 9 พ.ย. 2026): ประเภท · มูลค่าเวนคืน · ทุน (ตามลำดับกล่องด้านบน) · วันเริ่ม / วันสิ้นสุด แยกช่อง · อายุสัญญา (แทนเบี้ย · หลังวันสิ้นสุด) */}
        <table className="mt-2 w-full min-w-[64rem] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="py-2 pl-4 pr-3">กรมธรรม์</th><th className="px-2.5">ประเภท</th><th className="px-2.5">ผู้เอาประกัน</th>
              <th className="px-2.5 text-right">มูลค่าเวนคืน</th><th className="px-2.5 text-right">ทุนประกัน</th>
              <th className="px-2.5">วันเริ่มสัญญา</th><th className="px-2.5">วันสิ้นสุดสัญญา</th><th className="px-2.5">อายุสัญญา</th><th className="pl-3 pr-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {listRows.length === 0 && <tr><td colSpan={9} className="px-2.5 py-6 text-center text-slate-500">
              {rows.length > 0 ? "ไม่มีกรมธรรม์ตามตัวกรอง" : pv.personId ? `ไม่มีกรมธรรม์ของ ${pv.personName}` : "ยังไม่มีกรมธรรม์"}</td></tr>}
            {shownRows.map((r, i) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              const role = ordering ? null : bookletRole(r, listGroups);
              const rider = !!role && !role.isMain;
              // อายุสัญญา (ตกลง 9 พ.ย. 2026) = ปีกรมธรรม์ ไม่มีเศษเดือน · วันเริ่ม = ปีที่ 0 (แบบคอลัมน์ "ปีที่" หน้ากรมธรรม์)
              //   อายุ = ปีที่ของวันสิ้นสุด (ไม่ตรงวันครบรอบ = ปัดปีที่ใกล้ที่สุด) · เหลือ = อายุ − ปีที่ของวันนี้ (มีผล + ยังไม่ถึงวันสิ้นสุด)
              //   เหลือ 0 = "ปีสุดท้าย" · ถึง / เลยวันสิ้นสุดแล้ว = "สิ้นสุดสัญญา"
              const term = r.start_date && r.end_date && r.end_date > r.start_date ? Math.round(monthsBetween(r.start_date, r.end_date) / 12) : null;
              const cur = r.start_date ? policyYearAt(r.start_date, today) ?? 0 : 0;
              //   วันครบรอบถัดไปถึง / เลยวันสิ้นสุด = ปีสุดท้าย (กันวันสิ้นสุดก่อนวันครบรอบไม่กี่วันแล้วปัดขึ้น)
              const nextAnniv = r.start_date ? `${Number(r.start_date.slice(0, 4)) + cur + 1}${r.start_date.slice(4)}` : "";
              const left = term != null && r.status === "ACTIVE" && r.end_date > today ? (r.end_date <= nextAnniv ? 0 : Math.max(0, term - cur)) : null;
              const late = overduePremium.get(r.id) ?? 0;
              return (
                <tr key={r.id} className={`${r.status !== "ACTIVE" ? "opacity-50" : ""} ${role ? "bg-slate-50/40" : ""}`}>
                  <td className={`py-3 pr-3 ${rider ? "pl-8" : "pl-4"}`}>
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="insurance_policies" id={r.id} paths={paths} {...neighbors(listRows, i, (x) => x.id)} /></span>}
                    {rider
                      ? <Link href={`/insurance/${role.main.id}`} className="whitespace-nowrap font-medium text-slate-900 hover:underline">↳ สัญญาเพิ่มเติม</Link>
                      : <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>}
                  </td>
                  <td className="whitespace-nowrap px-2.5">{PART_LABEL[r.insurance_type] ?? TYPE[r.insurance_type] ?? r.insurance_type}</td>
                  <td className="whitespace-nowrap px-2.5">{r.person_id ? pname.get(r.person_id) : "-"}
                    {r.payer_person_id && r.payer_person_id !== r.person_id && <div className="text-xs text-slate-500">ผู้จ่าย {pname.get(r.payer_person_id)}</div>}</td>
                  <td className="px-2.5 text-right tabular-nums">{r.has_cash_value ? (c ? <>
                    {money(c.current_value == null ? null : Number(c.current_value) * pv.assetShare(c.id), ccyTag(c.currency), 0)}
                    {pv.assetPct(c.id) != null && <div className="text-xs text-slate-500">{pv.assetPct(c.id)}% ของ {money(c.current_value, ccyTag(c.currency), 0)}</div>}
                  </> : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="px-2.5 text-right tabular-nums">{money(r.insured_amount, ccyTag(r.insured_amount_currency), 0)}</td>
                  <td className="whitespace-nowrap px-2.5">{thDate(r.start_date)}</td>
                  <td className="whitespace-nowrap px-2.5">{thDate(r.end_date)}</td>
                  <td className="whitespace-nowrap px-2.5">{term == null ? "-" : term > 0 ? `${term} ปี` : "ไม่ถึง 1 ปี"}
                    {r.end_date && r.end_date <= today ? <div className="text-xs text-slate-500">สิ้นสุดสัญญา</div>
                      : left != null && <div className="text-xs text-slate-500">{left > 0 ? `เหลือ ${left} ปี` : "ปีสุดท้าย"}</div>}</td>
                  <td className="whitespace-nowrap pl-3 pr-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}
                    {late > 0 && <div className="text-red-600">เบี้ยเลยกำหนด {late} งวด</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

