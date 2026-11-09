import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  BENEFIT_TYPE_LABEL, CLAIM_CLS, CLAIM_DONE, CLAIM_OPEN, CLAIM_STATUS, COVERAGE_LABEL, COVERAGE_PERIOD, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_SCHED_STATUS, INS_STATUS, INS_TYPE,
  covAmount, covCountUnit, covExtra, covName, coverageHasPeriod, deathCoverage, insCountedPaid, money, signedMoney, signedPct, thDate, todayBangkok,
} from "@/lib/format";
import { cashNet, contractFlows, cvBreakEven, projectedFlows, surrenderFlows, xirr, type CashEvent, type FlowCash } from "@/lib/insurance-flow";
import FlowTable, { type FlowPart, type FlowRow, type FlowSub } from "./FlowTable";
import { addMonthsKeepDay } from "@/lib/loan-schedule";
import { PolicyInfoForm, SumCoverageRow, SyncCashValueButton } from "./ins-forms";
import { PayLinesForm, ReceiptEdit, ReceiveForm, type OpenLine } from "./FlowRecord";
import { CoverageEditor } from "../CoverageGrid";
import { AddRiderButton } from "../RiderFields";
import { PART_LABEL, bookletGroups, bookletKey, bookletRole, type BookletPolicy } from "@/lib/insurance-booklet";
import { periodAllowed } from "@/lib/insurance-coverage";
import InsScheduleEditor from "./InsScheduleEditor";
import EditToggle from "@/components/EditToggle";
import BeneficiaryEditor from "../Beneficiaries";
import ClaimForm from "./ClaimForm";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect, { WithStatus } from "@/components/StatusSelect";
import CvValueForm from "./CvValueForm";
import ModalButton from "@/components/ModalButton";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { premiumPaymentFields } from "@/lib/source-edit";
import { DetailItem as Item } from "@/components/Boxes";
import CvTableEditor from "./CvTableEditor";
import BookletScheduleEditor, { type BookletPart } from "./BookletScheduleEditor";
import type { BookCurrent } from "@/lib/insurance-grid";
import ClaimReceiveForm from "./ClaimReceiveForm";
import ScrollToId from "./ScrollToId";
import { payDefaultValue } from "../PayDefaultSelect";
import { InfoTip } from "@/components/HeaderBar";

const TYPE = Object.fromEntries(INS_TYPE);
const CSTATUS = Object.fromEntries(CLAIM_STATUS);
type Line = { id: string; kind: string; installment_no: number; due_date: string; amount: number; currency: string; benefit_type: string | null;
  notes: string | null; paid_amount: number; remaining: number; status: string; skipped: boolean };
/** งวดของส่วนใดส่วนหนึ่งในเล่ม (กรมธรรม์หลัก / สัญญาเพิ่มเติม) */
type SLine = Line & { policy_id: string };
type BookPol = BookletPolicy & { insured_amount: number | null; insured_amount_currency: string | null; premium: number | null; premium_currency: string | null; status: string;
  person_id: string | null; payer_person_id: string | null; start_date: string | null; end_date: string | null; notes: string | null;
  paid_from_asset_id: string | null; paid_from_credit_card_id: string | null; plan_name: string | null; coverage_scope: string | null; coverage_checked_on: string | null };
const BOOK_COLS = "id,insurance_type,insurer,policy_no,insured_amount,insured_amount_currency,premium,premium_currency,status,person_id,payer_person_id,start_date,end_date,notes,paid_from_asset_id,paid_from_credit_card_id,plan_name,coverage_scope,coverage_checked_on";
/** ความคุ้มครอง (ตกลง 8 พ.ย. 2026: รอบของสูงสุด · ชื่อ "อื่น ๆ" · ณ วันที่รายแถวเลิกแสดง แต่ยังส่งค่าเดิมกลับตอนบันทึกทั้งตาราง) */
const COV_COLS = "id,coverage_type,limit_amount,currency,notes,max_count,count_period,label,as_of_date";
const LINE_COLS = "id,kind,installment_no,due_date,amount,currency,benefit_type,notes,paid_amount,remaining,status,skipped";
const PAY_COLS = "id,date,amount,currency,paid_from_asset_id,paid_from_credit_card_id,insurance_schedule_line_id,notes,created_at,payment_group_id";
const RECV_COLS = "id,line_id,receipt_date,amount,currency,bank_asset_id,cash_value_part,income_part,outcome,notes,created_at";
/** ลำดับหัวข้อความคุ้มครองมาตรฐาน */
const COV_ORDER = Object.keys(COVERAGE_LABEL);
/** ยอดในเซลล์ที่กดเพื่อแก้รายการของเซลล์นั้น */
const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";


export default async function PolicyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data: p } = await supabase.from("v_insurance_status").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const cvId: string | null = p.cash_value_asset_id;
  // กรมธรรม์เล่มเดียวกัน (บริษัท + เลขกรมธรรม์ · ตกลง 6 พ.ย. 2026): หน้ารายการหลักโหลดงวด / การจ่าย / ความคุ้มครอง / เคลมของสัญญาเพิ่มเติมด้วย
  //   เล่มละ 1 หน้า (ตกลง 7 พ.ย. 2026): เปิดหน้าสัญญาเพิ่มเติม → ไปหน้ารายการหลัก · แก้ทุกส่วนได้ที่หน้านี้
  const bookQ = (async () => {
    if (!bookletKey(p)) return null;
    const { data: all } = await supabase.from("v_insurance_status").select(BOOK_COLS).not("policy_no", "is", null).order("created_at");
    const role = bookletRole(p as BookPol, bookletGroups((all ?? []) as BookPol[]));
    if (!role) return null;
    const ids = role.parts.filter((x) => x.id !== id).map((x) => x.id);
    if (!role.isMain) return { role, lines: [] as SLine[], covs: [], receipts: [], pays: [], claims: [] };
    const [{ data: ls }, { data: cv }, { data: rc }, { data: cl }] = await Promise.all([
      supabase.from("v_insurance_schedule_status").select(`policy_id,${LINE_COLS}`).in("policy_id", ids).order("due_date").order("installment_no"),
      supabase.from("insurance_coverages").select(`policy_id,${COV_COLS}`).in("policy_id", ids).is("deleted_at", null).order("created_at"),
      supabase.from("insurance_benefit_receipts").select(`policy_id,${RECV_COLS}`).in("policy_id", ids).is("undone_at", null).is("deleted_at", null)
        .order("receipt_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("insurance_claims").select("*").in("policy_id", ids).is("deleted_at", null).order("claim_date", { ascending: false }),
    ]);
    const premIds = ((ls ?? []) as SLine[]).filter((x) => x.kind === "PREMIUM").map((x) => x.id);
    const { data: pays } = premIds.length
      ? await supabase.from("expense_items").select(PAY_COLS).in("insurance_schedule_line_id", premIds).is("deleted_at", null).order("date", { ascending: false })
      : { data: [] };
    return { role, lines: (ls ?? []) as SLine[], covs: cv ?? [], receipts: rc ?? [], pays: pays ?? [], claims: cl ?? [] };
  })();
  const [{ data: bens }, { data: mainClaims }, { data: persons }, { data: family }, { data: cvAsset }, { data: cvVals }, { data: owners }, { data: insured }, bookRes] = await Promise.all([
    supabase.from("insurance_beneficiaries").select("id,person_id,beneficiary_name,percentage,persons(name)").eq("policy_id", id).is("deleted_at", null),
    supabase.from("insurance_claims").select("*").eq("policy_id", id).is("deleted_at", null).order("claim_date", { ascending: false }),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    cvId ? supabase.from("assets").select("id,current_value,current_value_date,currency").eq("id", cvId).maybeSingle() : Promise.resolve({ data: null }),
    cvId ? supabase.from("asset_valuations").select("id,valuation_date,value,bonus_part,source,notes").eq("asset_id", cvId).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    cvId ? supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", cvId) : Promise.resolve({ data: null }),
    p.asset_id ? supabase.from("assets").select("name,asset_group").eq("id", p.asset_id).maybeSingle() : Promise.resolve({ data: null }),
    bookQ,
  ]);
  if (bookRes && !bookRes.role.isMain) redirect(`/insurance/${bookRes.role.main.id}${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ""}`);
  const partIds = [id, ...(bookRes?.role.parts ?? []).filter((x) => x.id !== id).map((x) => x.id)];
  const claims = [...(mainClaims ?? []).map((c) => ({ ...c, policy_id: id as string })), ...(bookRes?.claims ?? [])]
    .sort((a, b) => String(b.claim_date ?? "").localeCompare(String(a.claim_date ?? "")));
  const claimIds = (claims ?? []).map((c) => c.id);
  // (เริ่มพร้อมชุดถัดไป ไม่รอรอบแยก) เงินที่ได้รับของเคลม: เงินคืนค่าใช้จ่าย + รายได้ที่ผูกเคลม · ค่าใช้จ่ายที่รอเงินคืน (ตัวเลือกของปุ่ม "บันทึกรับเงิน" · ตกลง 8 พ.ย. 2026)
  const hasOpenClaim = claims.some((c) => !CLAIM_DONE.includes(c.status));
  const claimQ = claimIds.length ? Promise.all([
    supabase.from("expense_reimbursements").select("id,insurance_claim_id,received_date,amount,currency,received_to_asset_id,received_to_credit_card_id,expense_items(description,date)")
      .in("insurance_claim_id", claimIds).is("deleted_at", null).order("received_date"),
    supabase.from("income_transactions").select("id,insurance_claim_id,date,amount,currency,received_to_asset_id")
      .in("insurance_claim_id", claimIds).is("deleted_at", null).order("date"),
    hasOpenClaim && me.role !== "VIEWER"
      ? supabase.from("v_expense_reimbursement_status").select("expense_item_id,date,description,amount,currency,expected_reimbursement_amount,reimbursed_amount")
        .eq("is_reimbursable", true).neq("reimbursement_status", "FULL").order("date", { ascending: false }).limit(100)
      : Promise.resolve({ data: null }),
  ]) : Promise.resolve([{ data: [] }, { data: [] }, { data: null }] as const);
  const [{ data: linesRaw }, { data: covs }, { data: fups }, { data: banks }, { data: cardsRaw }, { data: allPersons }, { data: cvTable }] = await Promise.all([
    supabase.from("v_insurance_schedule_status").select(LINE_COLS)
      .eq("policy_id", id).order("due_date").order("installment_no"),
    supabase.from("insurance_coverages").select(COV_COLS).eq("policy_id", id).is("deleted_at", null).order("created_at"),
    supabase.from("insurance_followups").select("id,policy_id,person_id,role,action,status,notes").in("policy_id", partIds).is("deleted_at", null).order("created_at"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("persons").select("id,name,birth_date").is("deleted_at", null).order("sort_order"),
    supabase.from("insurance_cash_value_table").select("policy_year,value_date,value").eq("policy_id", id).is("deleted_at", null).order("policy_year"),
  ]);
  const lines = (linesRaw as Line[] | null) ?? [];
  const premiums = lines.filter((x) => x.kind === "PREMIUM");
  const benefits = lines.filter((x) => x.kind === "BENEFIT");
  const cards = (cardsRaw ?? []).map((c) => ({ id: c.id, currency: c.currency, label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const allName = new Map((allPersons ?? []).map((x) => [x.id, x.name]));
  // คอลัมน์อายุในตารางเบี้ย (ตกลง 8 พ.ย. 2026) · ไม่มีวันเกิด = ไม่แสดงคอลัมน์
  const birthIso: string | null = (p.person_id && (allPersons ?? []).find((x) => x.id === p.person_id)?.birth_date) || null;
  const [{ data: linked }, { data: claimInc }, { data: pendExp }] = await claimQ;
  const incByClaim = new Map<string, NonNullable<typeof claimInc>>();
  (claimInc ?? []).forEach((r) => { if (r.insurance_claim_id) incByClaim.set(r.insurance_claim_id, [...(incByClaim.get(r.insurance_claim_id) ?? []), r]); });
  const pendingExp = (pendExp ?? []).map((e) => ({ id: e.expense_item_id as string, date: e.date as string, description: e.description as string, currency: e.currency as string,
    remaining: Math.round((Number(e.expected_reimbursement_amount ?? e.amount) - Number(e.reimbursed_amount ?? 0)) * 100) / 100 })).filter((e) => e.remaining > 0.005);
  const byClaim = new Map<string, NonNullable<typeof linked>>();
  (linked ?? []).forEach((r) => { if (r.insurance_claim_id) byClaim.set(r.insurance_claim_id, [...(byClaim.get(r.insurance_claim_id) ?? []), r]); });
  // รอรับ = ยอดเคลม − ได้รับ ของเคลมที่ยื่นแล้วยังไม่จบ (แยกสกุลเงิน · ยังไม่นับเป็นรายได้ / ความมั่งคั่งสุทธิ)
  const claimOpen = claims.filter((c) => CLAIM_OPEN.includes(c.status));
  const waitBy = new Map<string, number>();
  claimOpen.forEach((c) => { const w = Number(c.claimed_amount ?? 0) - Number(c.received_amount ?? 0); if (w > 0.005) waitBy.set(c.currency, (waitBy.get(c.currency) ?? 0) + w); });
  const claimWait = [...waitBy];
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const paths = [`/insurance/${id}`, "/insurance"];
  const ccy = p.insured_amount_currency ?? p.premium_currency ?? cvAsset?.currency ?? "THB";
  const payerId: string | null = p.payer_person_id ?? p.person_id ?? null;
  const policyActive = p.status === "ACTIVE";
  // ประวัติจ่ายเบี้ย (แก้ / ลบ ที่หน้านี้)
  const { data: premPays } = premiums.length
    ? await supabase.from("expense_items").select(PAY_COLS)
        .in("insurance_schedule_line_id", premiums.map((x) => x.id)).is("deleted_at", null).order("date", { ascending: false })
    : { data: [] };
  const { data: receipts } = await supabase.from("insurance_benefit_receipts")
    .select(RECV_COLS)
    .eq("policy_id", id).is("undone_at", null).is("deleted_at", null).order("receipt_date", { ascending: false }).order("created_at", { ascending: false });
  const OUTCOME: Record<string, string> = { MATURED: "ครบสัญญา", SURRENDERED: "เวนคืน", CLAIMED: "สินไหม" };
  const bankName = new Map((banks ?? []).map((b) => [b.asset_id as string, b.name as string]));
  const cardName = new Map(cards.map((c) => [c.id as string, c.label]));
  // นับรวมงวดประวัติก่อน Go-live (เต็มงวด) · ไม่นับงวดที่ติ๊กไม่ได้จ่าย
  const premPaid = premiums.reduce((s2, x) => s2 + insCountedPaid(x), 0);
  const premHist = premiums.filter((x) => x.status === "HISTORY").reduce((s2, x) => s2 + Number(x.amount), 0);
  const premOpen = premiums.filter((x) => ["PENDING", "OVERDUE", "PARTIAL"].includes(x.status));
  const premNext = premOpen.find((x) => x.status !== "OVERDUE");
  const premOverdue = premOpen.filter((x) => x.status === "OVERDUE");
  // ผลประโยชน์ที่รับรวม = งวด (รวมประวัติก่อน Go-live) + รับเงินก้อนที่ไม่ผูกงวด
  const benReceived = benefits.reduce((s2, x) => s2 + insCountedPaid(x), 0)
    + (receipts ?? []).filter((r) => !r.line_id && r.currency === ccy).reduce((s2, r) => s2 + Number(r.amount), 0);
  const lastDue = (xs: Line[]) => xs.at(-1)?.due_date;
  // งวดสุดท้าย: ปี (พ.ศ.) + จำนวนงวดที่ยังเหลือ
  const lastYear = (xs: Line[]) => { const d = lastDue(xs); return d ? Number(d.slice(0, 4)) + 543 : null; };
  const leftCount = (xs: Line[]) => xs.filter((x) => ["PENDING", "OVERDUE", "PARTIAL"].includes(x.status)).length;
  // ตารางมูลค่าเวนคืนตามสัญญา · ค่าที่แนะนำ = ปีล่าสุดที่ถึงวันแล้ว
  const cvRows = (cvTable ?? []).map((r) => ({ policy_year: Number(r.policy_year), value: Number(r.value), value_date: r.value_date as string }));
  const cvDue = cvRows.filter((r) => r.value_date <= today).at(-1) ?? null;
  const cvPending = !!cvDue && policyActive && (!cvAsset || !cvAsset.current_value_date || cvDue.value_date > cvAsset.current_value_date);
  const startIso: string | null = p.start_date ?? null;
  // สรุปกรมธรรม์: ได้คืน = (ผลประโยชน์ที่รับ + มูลค่าเวนคืนปัจจุบัน) ÷ เบี้ยที่จ่ายรวม
  const cvNow = cvAsset && cvAsset.current_value != null && cvAsset.currency === ccy ? Number(cvAsset.current_value) : null;
  const backPct = premPaid > 0 ? ((benReceived + (cvNow ?? 0)) / premPaid) * 100 : 0;
  // กรมธรรม์ที่ควรมีมูลค่าเวนคืน (ชีวิต / บำนาญ หรือมีข้อมูลแล้ว) · กล่องแรกแสดงเฉพาะข้อมูลปัจจุบัน (ตกลง 8 พ.ย. 2026)
  const showCv = !!cvAsset || cvRows.length > 0 || !!p.has_cash_value || p.insurance_type === "LIFE" || p.insurance_type === "ANNUITY";
  const CV_SOURCE: Record<string, string> = { STATEMENT: "ตามหนังสือแจ้ง", USER: "บันทึกเอง", ACCOUNT_SETUP: "ยอดตั้งต้น" };
  const policyLabel = `เบี้ยประกัน ${p.insurer}${p.policy_no ? ` ${p.policy_no}` : ""}`;
  const activeOwners = (owners ?? []).filter((o: { end_date: string | null }) => !o.end_date) as { person_id: string; person_name: string; ownership_percent: number }[];
  const benName = (b: { person_id: string | null; beneficiary_name: string | null; persons: unknown }) =>
    b.person_id ? ((Array.isArray(b.persons) ? b.persons[0] : b.persons) as { name: string } | null)?.name ?? "-" : b.beneficiary_name;
  const benTotal = (bens ?? []).reduce((s, b) => s + Number(b.percentage), 0);

  // มูลค่าเวนคืนอยู่ในตาราง "มูลค่าเวนคืน เบี้ยประกัน และผลประโยชน์" (ตกลง 8 พ.ย. 2026 · ไม่มีแท็บ / ปุ่มปรับมูลค่าเวนคืน / ปุ่มเพิ่มมูลค่าเวนคืน)
  //   ตัวเลขตามสัญญาบอกสถานะ: จาง = ยังไม่ถึง · ขีดเส้นใต้ = ถึงแล้วยังไม่ได้ลง (กด = ลงยอดของปีนั้น) · สีฟ้า = ลงแล้ว (กด = แก้ยอดที่ลง เช่น รวมเงินปันผลตามหนังสือแจ้ง)
  //   ยอดที่ลงตรงกับตารางของปีนั้น = ไม่มีแถวแยก · ยอดที่ไม่ตรง (หนังสือแจ้ง / ยอดตั้งต้น / แก้เอง) = แถวย่อยสีฟ้า (กดแถว = แก้ / ลบ)
  const goLive: string = family?.go_live_date ?? "";
  const CV_LINK = "tabular-nums text-slate-900 underline decoration-dotted underline-offset-4 hover:text-blue-700";
  const CV_POSTED = "tabular-nums font-medium text-sky-700 hover:underline";
  const cvNote = (y: number) => `ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ${y}`;
  type CvVal = { id: string; valuation_date: string; value: number; bonus_part: number | null; source: string; notes: string | null };
  const vals = (cvVals ?? []) as CvVal[];   // ใหม่ → เก่า
  // โบนัส (ไม่การันตี · ตกลง 9 พ.ย. 2026): ยอดรวม = การันตี + โบนัส · ตรงกับตารางเมื่อส่วนการันตีเท่าตาราง
  const bonusOf = (v: CvVal) => Number(v.bonus_part ?? 0);
  const guarOf = (v: CvVal) => Number(v.value) - bonusOf(v);
  const lastBonus = vals[0] ? bonusOf(vals[0]) : 0;
  const cvByDate = [...cvRows].sort((a, b) => a.value_date.localeCompare(b.value_date));
  /** ปีกรมธรรม์ที่มีผล ณ วันนั้น = ปีล่าสุดในตารางที่ถึงวันแล้ว */
  const cvYearAt = (d: string) => cvByDate.filter((r) => r.value_date <= d).at(-1) ?? null;
  const yearVals = new Map<number, CvVal[]>();   // ปี → ยอดที่ลงในช่วงปีนั้น
  const coveredBy = new Map<number, CvVal>();     // ปี → ยอดที่ลงตรงกับตาราง (ล่าสุด)
  vals.forEach((v) => {
    const y = cvYearAt(v.valuation_date);
    if (!y) return;
    yearVals.set(y.policy_year, [...(yearVals.get(y.policy_year) ?? []), v]);
    if (!coveredBy.has(y.policy_year) && Math.abs(guarOf(v) - y.value) < 0.005) coveredBy.set(y.policy_year, v);
  });
  const coveredIds = new Set([...coveredBy.values()].map((v) => v.id));
  const postedYears = [...yearVals.keys()];
  const cvActions = (v: CvVal, button?: string) => (
    <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && vals.length > 1} button={button} buttonClass={button ? CV_POSTED : undefined}
      editor={cvAsset ? <CvValueForm id={v.id} assetId={cvAsset.id} currency={cvAsset.currency} today={today} guaranteed={guarOf(v)} bonus={v.bonus_part}
        date={v.valuation_date} notes={v.notes} /> : undefined} />
  );
  /** ยอดที่มีโบนัส → บรรทัดเล็กใต้ยอดการันตี */
  const withBonus = (v: CvVal | undefined, node: ReactNode) => v && bonusOf(v) > 0
    ? <>{node}<span className="block text-xs text-slate-500">รวมโบนัส {money(v.value)}</span></> : node;
  const cvCellOf = (r: { policy_year: number; value: number; value_date: string }) => {
    const txt = money(r.value);
    if (r.value_date > today) return <span className="text-slate-400">{txt}</span>;
    const hit = coveredBy.get(r.policy_year);
    if (hit) return withBonus(hit, canWrite ? cvActions(hit, txt) : <span className="font-medium text-sky-700">{txt}</span>);
    if (yearVals.has(r.policy_year) || !cvAsset || !canWrite || !policyActive || r.value_date < goLive) return txt;
    return (
      <ModalButton label={txt} title={`มูลค่าเวนคืน · สิ้นปีกรมธรรม์ที่ ${r.policy_year}`} className={CV_LINK}>
        <CvValueForm assetId={cvAsset.id} currency={cvAsset.currency} today={today} minDate={goLive}
          guaranteed={r.value} bonus={lastBonus} date={r.value_date} notes={cvNote(r.policy_year)} />
      </ModalButton>
    );
  };
  const cvSubs: FlowSub[] = cvAsset ? vals.filter((v) => !coveredIds.has(v.id)).map((v) => ({
    key: `cv${v.id}`, kind: "CV" as const, date: v.valuation_date, amount: Number(v.value),
    text: v.source === "OPENING" ? "ยอดตั้งต้น" : v.notes ?? (CV_SOURCE[v.source] ?? v.source),
    detail: bonusOf(v) > 0 ? `การันตี ${money(guarOf(v))} + โบนัส (ไม่การันตี) ${money(bonusOf(v))}` : null,
    actions: canWrite ? cvActions(v) : null,
  })) : [];
  const isProp = p.insurance_type === "PROPERTY";
  // จ่ายเบี้ยจาก (ค่าตั้งต้นของกรมธรรม์ · ตกลง 3 พ.ย. 2026) · สกุลเดียวกับที่ฐานข้อมูลตรวจ (เบี้ย → ทุนประกัน → THB)
  const payCcy: string = p.premium_currency ?? p.insured_amount_currency ?? "THB";
  const payDefault = payDefaultValue(p);
  const payDefaultText = p.paid_from_asset_id ? bankName.get(p.paid_from_asset_id) ?? "บัญชี (ปิดแล้ว)"
    : p.paid_from_credit_card_id ? `บัตร ${cardName.get(p.paid_from_credit_card_id) ?? "(ปิดแล้ว)"}` : null;
  const insuredHref = `/${insured?.asset_group === "ALTERNATIVE" ? "alternative" : "property"}/${p.asset_id}`;
  // แก้ / ลบเบี้ยที่จ่ายแล้ว → หน้าทรัพย์สินที่เอาประกันอัปเดตด้วย (เบี้ยนับเป็นค่าใช้จ่ายของทรัพย์สิน)
  const payPaths = [...paths, "/income-expenses", ...(insured ? [insuredHref, "/property"] : [])];
  // หน้ากรมธรรม์หน้าเดียว ไม่มีแท็บ (ตกลง 8 พ.ย. 2026): มูลค่าเวนคืน + เอกสาร | รายละเอียด · เคลม | ความคุ้มครอง · ตารางเต็มความกว้างด้านล่าง
  //   ลิงก์เดิม ?tab=flow / premium / benefit / cv = เลื่อนลงไปที่ตาราง
  const toFlow = ["flow", "premium", "benefit", "cv"].includes(sp.tab ?? "");
  // ตาราง "เบี้ยและผลประโยชน์" (ตกลง 4 พ.ย. 2026 · แทนแท็บรับผลประโยชน์ + ชำระเบี้ย): ตารางเดียว · เงินจริงแทรกใต้งวด · สุทธิสะสม + จุดคุ้มทุน · IRR 3 ตัว
  //   เล่มที่มีสัญญาเพิ่มเติม (หน้ารายการหลัก · ตกลง 6 พ.ย. 2026): เบี้ยแยกคอลัมน์ ชีวิต · สุขภาพ · รวมจ่าย · งวดวันเดียวกันรวมแถวเดียว
  //   สุทธิสะสม / คุ้มทุน นับเฉพาะสัญญาหลัก + สัญญาเพิ่มเติมแบบชีวิต / บำนาญ (ตกลง 8 พ.ย. 2026 · เบี้ยสุขภาพ / อุบัติเหตุ = เบี้ยคุ้มครอง ไม่มีเงินคืน)
  //   IRR ของรายการหลักเหมือนเดิม + ทั้งเล่ม
  const bookParts = (bookRes?.role.parts ?? []) as BookPol[];
  const book = bookRes?.role.isMain ? bookRes : null;
  const mainId = bookRes?.role.main.id ?? id;
  const others = book ? bookParts.filter((x) => x.id !== id) : [];
  const polOf = new Map(bookParts.map((x) => [x.id, x]));
  const typeLabel = (pid: string) => PART_LABEL[(pid === id ? p.insurance_type : polOf.get(pid)?.insurance_type) ?? ""] ?? "สัญญาเพิ่มเติม";
  /** ชื่อส่วนในเล่ม · สัญญาเพิ่มเติมประเภทเดียวกับรายการหลัก = "สัญญาเพิ่มเติม" */
  const partName = (pid: string) => (pid !== mainId && typeLabel(pid) === typeLabel(mainId) ? "สัญญาเพิ่มเติม" : typeLabel(pid));
  /** ข้อมูลต่อส่วน (ตกลง 8 พ.ย. 2026): ชื่อแบบ · คุ้มครองเฉพาะ · ตรวจกับกรมธรรม์เมื่อ */
  const partOf = (pid: string): { plan_name: string | null; coverage_scope: string | null; coverage_checked_on: string | null } =>
    (pid === id ? p : polOf.get(pid)) ?? { plan_name: null, coverage_scope: null, coverage_checked_on: null };
  /** หัวกล่องของส่วน: "สัญญาเพิ่มเติม · สุขภาพ · <ชื่อแบบ>" */
  const partHead = (pid: string) => [pid === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม", typeLabel(pid), partOf(pid).plan_name].filter(Boolean).join(" · ");
  /** บรรทัดเล็กใต้หัวกล่องความคุ้มครอง: คุ้มครองเฉพาะ · ตรวจกับกรมธรรม์เมื่อ */
  const partMeta = (pid: string) => {
    const x = partOf(pid);
    return <>{x.coverage_scope && <span className="mr-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-normal text-violet-700">คุ้มครองเฉพาะ{x.coverage_scope}</span>}
      <span className="text-xs font-normal text-slate-500">{x.coverage_checked_on ? `ตรวจกับกรมธรรม์เมื่อ ${thDate(x.coverage_checked_on)}` : "ยังไม่ได้ตรวจกับกรมธรรม์"}</span></>;
  };
  const manyRiders = others.length > 1;
  const partKey = (pid: string) => (pid === id ? "main" : manyRiders ? "riders" : pid);
  const flowParts: FlowPart[] | undefined = book ? [{ key: "main", label: partName(id) },
    manyRiders ? { key: "riders", label: "สัญญาเพิ่มเติม" } : { key: others[0].id, label: partName(others[0].id) }] : undefined;
  const partOrder = (pid: string) => bookParts.findIndex((x) => x.id === pid);
  const linePaths = (pid: string) => (pid === id ? paths : [`/insurance/${pid}`, ...paths]);
  const payPathsOf = (pid: string) => (pid === id ? payPaths : [`/insurance/${pid}`, ...payPaths]);
  /** ข้อความงวดที่บันทึกเป็นค่าใช้จ่าย · เล่มที่มีสัญญาเพิ่มเติม = ระบุส่วน (ชีวิต / สุขภาพ) */
  const payLabel = (pid: string, no: number) => `${policyLabel}${bookRes ? ` · ${partName(pid)}` : ""} งวดที่ ${no}`;
  const allLines: SLine[] = [...lines.map((x) => ({ ...x, policy_id: id })), ...(book?.lines ?? [])];
  const allReceipts = [...(receipts ?? []).map((r) => ({ ...r, policy_id: id })), ...(book?.receipts ?? [])];
  const allPays = [...(premPays ?? []), ...(book?.pays ?? [])];
  const lumps = allReceipts.filter((r) => !r.line_id);
  /** ส่วนที่นับในสุทธิสะสม / คุ้มทุน: สัญญาหลัก + สัญญาเพิ่มเติมแบบชีวิต / บำนาญ */
  const inNet = (pid: string) => pid === id || ["LIFE", "ANNUITY"].includes(polOf.get(pid)?.insurance_type ?? "");
  const netSkip = book ? [...new Set(bookParts.filter((x) => !inNet(x.id)).map((x) => partName(x.id)))] : [];
  // เงินจริง = แถวของตัวเอง ตามวันที่จ่าย / รับจริง (ตกลง 8 พ.ย. 2026 · แบบเงินกู้)
  //   จ่ายเบี้ย = ชุดการจ่าย (จ่ายพร้อมกันจากบัญชี / บัตรเดียวกัน = 1 แถว · เงินสด / ไม่มีชุด = แถวละรายการ) · รับ = แถวละรายการ
  type Pay = (typeof allPays)[number];
  type Receipt = (typeof allReceipts)[number];
  const lineOf = new Map(allLines.map((x) => [x.id, x]));
  const payLine = (e: Pay) => lineOf.get(e.insurance_schedule_line_id as string);
  const payPid = (e: Pay) => payLine(e)?.policy_id ?? id;
  const payGroups = new Map<string, Pay[]>();
  allPays.forEach((e) => { const k = `${e.payment_group_id ?? e.id}|${e.date}`; payGroups.set(k, [...(payGroups.get(k) ?? []), e]); });
  const payEvs = [...payGroups.values()].map((items) => ({ key: `pay${items[0].id}`, date: items[0].date as string,
    at: items.map((e) => String(e.created_at ?? "")).sort().at(-1) ?? "",
    items: [...items].sort((a, b) => partOrder(payPid(a)) - partOrder(payPid(b)) || (payLine(a)?.installment_no ?? 0) - (payLine(b)?.installment_no ?? 0)) }));
  const recvEvs = allReceipts.map((r) => ({ key: `rc${r.id}`, date: r.receipt_date as string, at: String(r.created_at ?? ""), r }));
  /** เงินจริงเรียงเก่า → ใหม่ (วันเดียวกัน = ตามเวลาที่บันทึก) · keep = ส่วนที่นับยอด (ส่วนอื่น = 0 แต่ยังมีแถว) */
  const cashEvents = (keep: (pid: string) => boolean): CashEvent[] => [
    ...payEvs.map((ev) => ({ key: ev.key, kind: "PREMIUM" as const, date: ev.date, at: ev.at,
      amount: ev.items.filter((e) => keep(payPid(e))).reduce((t, e) => t + Number(e.amount), 0) })),
    ...recvEvs.map((ev) => ({ key: ev.key, kind: "BENEFIT" as const, date: ev.date, at: ev.at, amount: keep(ev.r.policy_id) ? Number(ev.r.amount) : 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  // สุทธิสะสม = เงินจริง ณ วันที่จ่าย / รับ + งวดก่อน Go-live (เต็มงวด) + งวดที่ยังค้าง (คาดการณ์ ณ วันครบกำหนด)
  const flow = cashNet(allLines.filter((x) => inNet(x.policy_id)), cashEvents(inNet), policyActive);
  const netOf = new Map(flow.rows.map((r) => [r.key, r]));
  // ลำดับแถวในตาราง = ทุกส่วนของเล่ม (รวมส่วนที่ไม่นับในสุทธิสะสม) · วันเดียวกัน: งวดก่อนเงินจริง · เบี้ยก่อนผลประโยชน์
  const flowPos = new Map(cashNet(allLines, cashEvents(() => true), policyActive).rows.map((r, i) => [r.key, i]));
  const allBenefits = allLines.filter((x) => x.kind === "BENEFIT");
  const allPremiums = allLines.filter((x) => x.kind === "PREMIUM");
  // งวดที่ยังค้างของทุกส่วนในเล่ม → ปุ่ม "บันทึกรับ" / "บันทึกจ่าย" เหนือตาราง (เรียงวันครบกำหนด → ส่วน)
  //   ผลประโยชน์ของสัญญาหลักที่มีมูลค่าเวนคืน > 0 = ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวด
  const openOf = (xs: SLine[], ben: boolean): OpenLine[] => xs.filter((x) => INS_OPEN.includes(x.status) && Number(x.remaining) > 0.005)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || partOrder(a.policy_id) - partOrder(b.policy_id) || a.installment_no - b.installment_no)
    .map((x) => ({ policyId: x.policy_id, lineId: x.id, part: book ? partName(x.policy_id) : null,
      label: ben ? BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"] ?? "ผลประโยชน์" : payLabel(x.policy_id, x.installment_no),
      no: ben ? null : x.installment_no, due: x.due_date, remaining: Number(x.remaining), currency: x.currency,
      cv: ben && x.policy_id === id && Number(cvAsset?.current_value ?? 0) > 0.005 }));
  const openPrem = openOf(allPremiums, false);
  const openBen = openOf(allBenefits, true);
  // แก้ตารางเบี้ยทั้งเล่ม: สัญญาหลักก่อน แล้วสัญญาเพิ่มเติมที่ยังมีผล · ชื่อคอลัมน์ซ้ำ (สัญญาเพิ่มเติมประเภทเดียวกันหลายฉบับ) ต่อชื่อแบบ / เลข
  const bookEdIds = book ? [id, ...others.filter((o) => o.status === "ACTIVE").map((o) => o.id)] : [];
  const bookEd: BookletPart[] = bookEdIds.map((pid) => {
    const o = pid === id ? p : polOf.get(pid);
    const xs = allPremiums.filter((x) => x.policy_id === pid);
    const name = partName(pid);
    const same = bookEdIds.filter((q) => partName(q) === name);
    const plan = partOf(pid).plan_name;
    return { id: pid, label: same.length < 2 ? name : plan ? `${name} · ${plan}` : `${name} ${same.indexOf(pid) + 1}`, currency: o?.premium_currency ?? ccy,
      defaultAmount: Number(o?.premium ?? 0), defaultFirstDue: lastDue(xs) ? addMonthsKeepDay(lastDue(xs) as string, 12) : (o?.start_date ?? p.start_date ?? today) };
  });
  const bookEdCurrent: BookCurrent[] = allPremiums.filter((x) => bookEdIds.includes(x.policy_id)).map((x) => ({ policy_id: x.policy_id, due_date: x.due_date,
    amount: Number(x.amount), notes: x.notes, skipped: x.skipped, locked: Number(x.paid_amount) > 0 ? `จ่ายแล้ว ${money(x.paid_amount)}` : null }));
  // ไม่มีตารางผลประโยชน์แต่มีตารางมูลค่าเวนคืน (เช่น Manulife) ก็แสดงกล่องสรุป + สุทธิสะสม + จุดคุ้มทุนถ้าเวนคืน (ตกลง 9 พ.ย. 2026)
  const hasBen = allBenefits.length > 0 || lumps.length > 0;
  const showNet = !isProp && (hasBen || cvRows.length > 0);
  // เวนคืนคุ้มทุน (ตกลง 8 พ.ย. 2026): ปีแรกที่มูลค่าเวนคืนตามสัญญา ≥ เบี้ยสุทธิที่จ่ายไปก่อนวันนั้น (ส่วนที่นับในสุทธิสะสมเท่านั้น)
  const cvBE = isProp ? null : cvBreakEven(flow.rows, cvRows);
  const schedPrem = allPremiums.reduce((s2, x) => s2 + Number(x.amount), 0);
  const schedBen = allBenefits.reduce((s2, x) => s2 + Number(x.amount), 0);
  // จ่าย / รับแล้วของตาราง (ทั้งเล่ม เมื่อมีสัญญาเพิ่มเติม)
  const flowPremPaid = allPremiums.reduce((s2, x) => s2 + insCountedPaid(x), 0);
  const flowBenReceived = allBenefits.reduce((s2, x) => s2 + insCountedPaid(x), 0)
    + lumps.filter((r) => r.currency === ccy).reduce((s2, r) => s2 + Number(r.amount), 0);
  // สุทธิถึงวันนี้ = เฉพาะส่วนที่นับในสุทธิสะสม (ไม่นับเบี้ยสุขภาพ / อุบัติเหตุของสัญญาเพิ่มเติม)
  const flowNetToday = allLines.filter((x) => inNet(x.policy_id)).reduce((s2, x) => s2 + (x.kind === "BENEFIT" ? 1 : -1) * insCountedPaid(x), 0)
    + lumps.filter((r) => r.currency === ccy && inNet(r.policy_id as string)).reduce((s2, r) => s2 + Number(r.amount), 0);
  const flowCcy = lines[0]?.currency ?? ccy;
  type CashSrc = { line_id: string | null; receipt_date: string; amount: number; currency: string };
  const cashOf = (pays: typeof allPays, recs: CashSrc[]): FlowCash[] => [
    ...pays.map((e) => ({ kind: "PREMIUM" as const, line_id: e.insurance_schedule_line_id as string | null, date: e.date as string, amount: Number(e.amount), currency: e.currency as string })),
    ...recs.map((r) => ({ kind: "BENEFIT" as const, line_id: r.line_id as string | null, date: r.receipt_date as string, amount: Number(r.amount), currency: r.currency as string })),
  ];
  const flowCash = cashOf(premPays ?? [], receipts ?? []);
  const bookCash = cashOf(allPays, allReceipts);
  const mixedOf = (ls: { currency: string }[], cs: FlowCash[]) => ls.some((x) => x.currency !== flowCcy) || cs.some((c) => c.currency !== flowCcy);
  const mixedCcy = mixedOf(lines, flowCash);
  const bookMixed = mixedOf(allLines, bookCash);
  const cvFlow = cvAsset && cvAsset.current_value != null && cvAsset.currency === flowCcy ? Number(cvAsset.current_value) : null;
  const showIrr = !isProp && premiums.length > 0 && (showNet || cvFlow != null);
  const irrWhy = mixedCcy ? "หลายสกุลเงิน คำนวณไม่ได้" : null;
  /** IRR ทั้งเล่ม (ชีวิต + สัญญาเพิ่มเติม) · undefined = ไม่ใช่เล่มที่มีสัญญาเพิ่มเติม */
  const bookIrr = (f: () => number | null) => (book ? (bookMixed ? null : f()) : undefined);
  const irrBoxes: { label: string; value: number | null; book?: number | null; sub: string; why: string }[] = [
    { label: "ตามสัญญา", value: mixedCcy ? null : xirr(contractFlows(lines)), book: bookIrr(() => xirr(contractFlows(allLines))), sub: "ทุกงวดในตาราง ตามวันครบกำหนด",
      why: irrWhy ?? (benefits.length === 0 ? "ยังไม่มีตารางผลประโยชน์" : "คำนวณไม่ได้") },
    { label: policyActive ? "คาดการณ์" : "จริง", value: mixedCcy ? null : xirr(projectedFlows(lines, flowCash, today, policyActive)),
      book: bookIrr(() => xirr(projectedFlows(allLines, bookCash, today, policyActive))),
      sub: policyActive ? "จ่าย / รับจริง + งวดที่เหลือตามตาราง" : "จากเงินที่จ่าย / รับจริง (กรมธรรม์จบแล้ว)",
      why: irrWhy ?? "ยังไม่มีเงินรับ ทั้งที่รับแล้วและในตาราง" },
    ...(policyActive && cvFlow != null ? [{ label: "ถ้าเวนคืนวันนี้", value: mixedCcy ? null : xirr(surrenderFlows(lines, flowCash, today, cvFlow)),
      book: bookIrr(() => xirr(surrenderFlows(allLines, bookCash, today, cvFlow))),
      sub: `เงินจริงถึงวันนี้ + มูลค่าเวนคืน ${money(cvFlow, undefined, 0)} (${thDate(cvAsset?.current_value_date)})`, why: irrWhy ?? "ยังไม่ได้จ่ายเบี้ย" }] : []),
  ];
  const recvDetail = (r: Receipt) => [Number(r.cash_value_part) > 0 ? `จากมูลค่าเวนคืน ${money(r.cash_value_part)}` : null,
    Number(r.income_part) > 0 ? `รายได้ ${money(r.income_part)}` : null, r.notes].filter(Boolean).join(" · ") || null;
  const recvText = (r: Receipt, first: string) => [r.outcome ? OUTCOME[r.outcome] ?? r.outcome : first, r.bank_asset_id ? `เข้า ${bankName.get(r.bank_asset_id) ?? "บัญชี"}` : null].filter(Boolean).join(" · ");
  const firstOpen = [...allLines].sort((a, b) => (flowPos.get(a.id) ?? 0) - (flowPos.get(b.id) ?? 0)).find((x) => INS_OPEN.includes(x.status))?.id;
  const lineFields = (x: Line, ben: boolean) => [
    { name: "due_date", label: "ครบกำหนด", type: "date" as const, value: x.due_date },
    { name: "amount", label: "ยอด", type: "number" as const, value: x.amount },
    ...(Number(x.paid_amount) === 0 ? [{ name: "skipped", label: ben ? "ได้รับจริงไหม" : "จ่ายจริงไหม", type: "select" as const, value: x.skipped ? "true" : "false",
      options: [["false", ben ? "ได้รับ / รอรับ" : "จ่าย / รอจ่าย"], ["true", ben ? "ไม่ได้รับ" : "ไม่ได้จ่าย"]] as [string, string][] }] : []),
    { name: "notes", label: "หมายเหตุ", value: x.notes, width: "w-40" }];
  // ข้อความแถวจ่ายจริง (ป้าย "จ่าย" อยู่หน้าข้อความ): จาก บัญชี / บัตร · เงินสด
  const payFrom = (e: (typeof allPays)[number]) =>
    e.paid_from_asset_id ? `จาก ${bankName.get(e.paid_from_asset_id) ?? "บัญชี"}` : e.paid_from_credit_card_id ? `จากบัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด";
  // แถวที่รวมเบี้ยกับผลประโยชน์ของวันเดียวกัน: ป้ายบอกฝั่ง (รอจ่าย / รอรับ …) · สถานะอื่นบอกฝั่งอยู่แล้ว (จ่ายแล้ว / รับแล้ว · ไม่ได้จ่าย / ไม่ได้รับ)
  const SIDE: Record<string, [string, string]> = { PENDING: ["รอจ่าย", "รอรับ"], OVERDUE: ["ค้างจ่าย", "ค้างรับ"], PARTIAL: ["จ่ายบางส่วน", "รับบางส่วน"] };
  const sideText = (status: string, ben: boolean, text: string) => SIDE[status]?.[ben ? 1 : 0] ?? text;
  // ยอดของงวด กดเพื่อแก้ / ลบงวดนั้น (แถวที่มีหลายงวด เช่น เล่มที่มีสัญญาเพิ่มเติม / เบี้ยกับผลประโยชน์วันเดียวกัน)
  const amtNode = (x: SLine) => canWrite && x.status !== "PAID"
    ? <RowActions table="insurance_schedule_lines" id={x.id} paths={linePaths(x.policy_id)} canDelete={canDelete} fields={lineFields(x, x.kind === "BENEFIT")} button={money(x.amount)} buttonClass={AMT} />
    : <span className="tabular-nums">{money(x.amount)}</span>;
  // งวดเดียว (ทุกงวดของกรมธรรม์ปกติ · งวดผลประโยชน์ของเล่ม) · ส่วนของสัญญาเพิ่มเติม = ชื่อส่วนนำหน้า
  //   merged = อยู่แถวเดียวกับงวดอื่นของวันนั้น → แก้งวดที่ยอด (ไม่ใช่กดแถว) · ป้ายสถานะบอกฝั่ง
  const lineRow = (x: SLine, merged = false): FlowRow => {
    const ben = x.kind === "BENEFIT";
    const pid = x.policy_id;
    const st = INS_SCHED_STATUS[x.status];
    const n = netOf.get(x.id);
    const paidAmt = Number(x.paid_amount);
    return {
      key: x.id, kind: ben ? "BENEFIT" : "PREMIUM", date: x.due_date, notes: x.notes, amount: Number(x.amount), no: ben ? null : x.installment_no,
      // ช่องหมายเหตุ (ตกลง 8 พ.ย. 2026): ไม่ซ้ำกับคอลัมน์ปีที่ → เบี้ย = ว่าง (ส่วนของเล่มนำหน้าเมื่อไม่ใช่สัญญาหลัก) · ผลประโยชน์ = ชนิด
      label: [pid === id ? null : partName(pid), ben ? BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"] : null].filter(Boolean).join(" · "),
      statusText: ben && x.status === "PAID" ? "รับแล้ว" : ben && x.status === "SKIPPED" ? "ไม่ได้รับ" : merged ? sideText(x.status, ben, st?.text ?? x.status) : st?.text ?? x.status,
      statusCls: st?.cls, amt: merged ? amtNode(x) : undefined,
      progress: x.status === "PARTIAL" || (x.status === "CLOSED" && paidAmt > 0)
        ? `${ben ? "รับ" : "จ่าย"}แล้ว ${money(paidAmt)}${x.status === "PARTIAL" ? ` · ค้าง ${money(x.remaining)}` : ""}` : null,
      muted: ["PAID", "CLOSED", "SKIPPED", "HISTORY"].includes(x.status), next: x.id === firstOpen,
      net: showNet ? n?.net ?? null : null, projected: n?.projected, breakEven: showNet && flow.breakEven?.key === x.id,
      // กดแถวงวด = แก้ / ลบงวด (บันทึกจ่าย / รับ = ปุ่มเหนือตาราง · ตกลง 8 พ.ย. 2026)
      actions: canWrite && x.status !== "PAID" && !merged
        ? <RowActions table="insurance_schedule_lines" id={x.id} paths={linePaths(pid)} canDelete={canDelete} fields={lineFields(x, ben)} /> : null,
    };
  };
  // เล่มที่มีสัญญาเพิ่มเติม: งวดเบี้ยที่ครบวันเดียวกันรวมแถวเดียว · กดยอดของส่วนไหน = แก้งวดของส่วนนั้น · ค้าง ≥ 2 ส่วน = จ่ายทั้งเล่มในครั้งเดียว
  const OPEN_ST = ["PENDING", "OVERDUE", "PARTIAL"];
  /** สุทธิสะสม ณ วันนั้น = รายการล่าสุดที่ถึงวันนั้น (ไม่มี = undefined) */
  const netAt = (d: string) => { let r: (typeof flow.rows)[number] | undefined; for (const x of flow.rows) { if (x.date <= d) r = x; else break; } return r; };
  const mergedRow = (due: string, xs: SLine[], merged = false): FlowRow => {
    xs.sort((a, b) => partOrder(a.policy_id) - partOrder(b.policy_id) || a.installment_no - b.installment_no);
    // สุทธิสะสมของแถว = งวดสุดท้ายในวันนั้นที่นับในสุทธิสะสม
    const last = xs.filter((x) => netOf.has(x.id)).reduce<SLine | null>((a, b) => (!a || (flowPos.get(b.id) ?? 0) > (flowPos.get(a.id) ?? 0) ? b : a), null);
    // วันที่มีแต่สัญญาเพิ่มเติมแบบสุขภาพ = สุทธิสะสมเท่าเดิม (ยกมาจากรายการล่าสุด · เทียบกับมูลค่าเวนคืนได้ทุกแถว)
    const n = last ? netOf.get(last.id) : netAt(due);
    const sts = [...new Set(xs.map((x) => x.status))];
    const anyOpen = xs.some((x) => OPEN_ST.includes(x.status));
    const status = sts.length === 1 ? sts[0] : sts.includes("OVERDUE") ? "OVERDUE"
      : anyOpen && xs.some((x) => Number(x.paid_amount) > 0) ? "PARTIAL" : anyOpen ? "PENDING" : sts.includes("PAID") ? "PAID" : sts[0];
    const st = INS_SCHED_STATUS[status];
    const paidAmt = xs.reduce((t, x) => t + Number(x.paid_amount), 0);
    const left = xs.filter((x) => OPEN_ST.includes(x.status)).reduce((t, x) => t + Number(x.remaining), 0);
    const split: Record<string, ReactNode> = {};
    (flowParts ?? []).forEach((fp) => {
      const mine = xs.filter((x) => partKey(x.policy_id) === fp.key);
      if (!mine.length) return;
      split[fp.key] = fp.key === "riders"
        ? <>{money(mine.reduce((t, x) => t + Number(x.amount), 0))}
            {mine.map((x) => <div key={x.id} className="text-[11px] text-slate-500">{typeLabel(x.policy_id)} {amtNode(x)}</div>)}</>
        : <>{mine.map((x) => <div key={x.id}>{amtNode(x)}</div>)}</>;
    });
    return {
      key: `d${due}`, kind: "PREMIUM", date: due, amount: xs.reduce((t, x) => t + Number(x.amount), 0), split,
      // งวดที่ = ของสัญญาหลัก (วันที่มีแต่สัญญาเพิ่มเติม = ของส่วนแรก)
      no: (xs.find((x) => x.policy_id === id) ?? xs[0]).installment_no,
      label: "",
      notes: xs.filter((x) => x.notes).map((x) => (xs.length > 1 ? `${partName(x.policy_id)}: ${x.notes}` : x.notes)).join(" · ") || null,
      statusText: merged ? sideText(status, false, st?.text ?? status) : st?.text ?? status, statusCls: st?.cls,
      progress: status === "PARTIAL" || (status === "CLOSED" && paidAmt > 0) ? `จ่ายแล้ว ${money(paidAmt)}${status === "PARTIAL" ? ` · ค้าง ${money(left)}` : ""}` : null,
      muted: xs.every((x) => ["PAID", "CLOSED", "SKIPPED", "HISTORY"].includes(x.status)), next: xs.some((x) => x.id === firstOpen),
      net: showNet ? n?.net ?? null : null, projected: n?.projected, breakEven: showNet && xs.some((x) => flow.breakEven?.key === x.id),
    };
  };
  const byDue = new Map<string, SLine[]>();
  allPremiums.forEach((x) => byDue.set(x.due_date, [...(byDue.get(x.due_date) ?? []), x]));
  // แถวเงินจริง (ตกลง 8 พ.ย. 2026 · แบบเงินกู้): แก้ / ลบได้เฉพาะรายการล่าสุดของแต่ละฝั่ง (จ่าย / รับ) · รายการเก่าผิด = ลบย้อนจากรายการล่าสุด
  const latestOf = (xs: { key: string; date: string; at: string }[]) => [...xs].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))[0]?.key;
  const latestPay = latestOf(payEvs);
  const latestRecv = latestOf(recvEvs);
  const payEdit = (e: Pay, button?: string) => <RowActions table="expense_items" id={e.id} paths={payPathsOf(payPid(e))} canDelete={canDelete}
    fields={premiumPaymentFields(e)} button={button} buttonClass={button ? AMT : undefined} />;
  const payRow = (ev: (typeof payEvs)[number]): FlowRow => {
    const edit = canWrite && ev.key === latestPay;
    const one = ev.items.length === 1;
    const ls = ev.items.map(payLine).filter((x): x is SLine => !!x);
    const mainLs = ls.filter((x) => x.policy_id === id);
    const ns = [...new Set((mainLs.length ? mainLs : ls).map((x) => x.installment_no))].sort((a, b) => a - b);
    const split: Record<string, ReactNode> = {};
    (flowParts ?? []).forEach((fp) => {
      const mine = ev.items.filter((e) => partKey(payPid(e)) === fp.key);
      if (mine.length) split[fp.key] = money(mine.reduce((t, e) => t + Number(e.amount), 0));
    });
    // หลายงวด / หลายส่วนในชุดเดียว = ยอดของแต่ละรายการ (รายการล่าสุด: กดยอดเพื่อแก้ / ลบรายการนั้น) · รายการเดียว = กดแถว
    const itemText = (e: Pay) => [book ? partName(payPid(e)) : null, payLine(e) ? `งวดที่ ${payLine(e)?.installment_no}` : null].filter(Boolean).join(" ");
    const notes = [...new Set(ev.items.map((e) => e.notes as string | null).filter(Boolean))];
    const detail = one
      ? [book && payPid(ev.items[0]) !== id ? partName(payPid(ev.items[0])) : null, ...notes].filter(Boolean).join(" · ") || null
      : <>{ev.items.map((e, i) => <span key={e.id}>{i > 0 && " · "}<span className="whitespace-nowrap">{itemText(e)} {edit ? payEdit(e, money(e.amount)) : money(e.amount)}</span></span>)}
          {notes.length > 0 && <div>{notes.join(" · ")}</div>}</>;
    return {
      key: ev.key, kind: "PREMIUM", date: ev.date, label: "", amount: ev.items.reduce((t, e) => t + Number(e.amount), 0),
      no: ns.length > 1 && ns.every((x, i) => i === 0 || x === ns[i - 1] + 1) ? `${ns[0]}–${ns.at(-1)}` : ns.join(", ") || null,
      split: flowParts ? split : undefined,
      money: { kind: "PAY", text: payFrom(ev.items[0]), detail },
      net: showNet ? netOf.get(ev.key)?.net ?? null : null, breakEven: showNet && flow.breakEven?.key === ev.key,
      actions: edit && one ? payEdit(ev.items[0]) : null,
    };
  };
  const recvRow = (r: Receipt): FlowRow => {
    const ln = r.line_id ? lineOf.get(r.line_id) : undefined;
    const key = `rc${r.id}`;
    return {
      key, kind: "BENEFIT", date: r.receipt_date, label: "", amount: Number(r.amount),
      money: { kind: "RECV", text: `${r.policy_id === id ? "" : `${partName(r.policy_id)} · `}${recvText(r, ln ? BENEFIT_TYPE_LABEL[ln.benefit_type ?? "OTHER"] : "รับเงินก้อน")}`,
        // รับก่อน / หลังวันครบกำหนด → บอกงวดที่รับ (เช่น รับเงินครบสัญญาบางส่วนก่อนครบ)
        detail: [ln && ln.due_date !== r.receipt_date ? `งวดครบ ${thDate(ln.due_date)}` : null, recvDetail(r)].filter(Boolean).join(" · ") || null },
      net: showNet ? netOf.get(key)?.net ?? null : null, breakEven: showNet && flow.breakEven?.key === key,
      actions: canDelete && key === latestRecv ? <ReceiptEdit r={{ id: r.id, date: r.receipt_date, amount: Number(r.amount), bank_asset_id: r.bank_asset_id,
        notes: r.notes, outcome: r.outcome, cash_value_part: Number(r.cash_value_part ?? 0) }} currency={r.currency} banks={banks ?? []}
        hasCashValue={r.policy_id === id && !!cvAsset} paths={linePaths(r.policy_id)} /> : null,
    };
  };
  const pos = (k: string) => flowPos.get(k) ?? 0;
  // ผลประโยชน์ที่ครบวันเดียวกับงวดเบี้ย → แถวเดียวกัน (ตกลง 8 พ.ย. 2026 · วันละ 1 รายการ · วันอื่นในปีเดียวกันยังแยกแถว)
  const benOn = new Map<string, SLine>();
  [...allBenefits].sort((a, b) => pos(a.id) - pos(b.id)).forEach((x) => { if (byDue.has(x.due_date) && !benOn.has(x.due_date)) benOn.set(x.due_date, x); });
  const benUsed = new Set<string>();
  /** แถวเบี้ย + ผลประโยชน์ของวันนั้น: สุทธิสะสม = หลังรับ (รับเรียงหลังจ่ายในวันเดียวกัน) · เงินจริงทั้งสองฝั่งเป็นแถวย่อยเรียงตามวันที่ */
  const premRow = (due: string, build: (merged: boolean) => FlowRow): FlowRow => {
    const b = benOn.get(due);
    if (!b || benUsed.has(b.id)) return build(false);
    benUsed.add(b.id);
    const row = build(true);
    const br = lineRow(b, true);
    return { ...row,
      also: { amount: br.amt, statusText: br.statusText, statusCls: br.statusCls, progress: br.progress },
      label: [row.label, br.label].filter(Boolean).join(" · "), notes: [row.notes, br.notes].filter(Boolean).join(" · ") || null,
      net: br.net ?? row.net, projected: br.net != null ? br.projected : row.projected, breakEven: row.breakEven || br.breakEven,
      muted: row.muted && br.muted, next: row.next || br.next,
      actions: row.actions || br.actions ? <>{row.actions}{br.actions}</> : null,
    };
  };
  const flowRows: FlowRow[] = ([
    ...(book
      ? [...byDue].map(([due, xs]): [number, FlowRow] => [Math.min(...xs.map((x) => pos(x.id))), premRow(due, (m) => mergedRow(due, xs, m))])
      : allPremiums.map((x): [number, FlowRow] => [pos(x.id), premRow(x.due_date, (m) => lineRow(x, m))])),
    ...allBenefits.filter((x) => !benUsed.has(x.id)).map((x): [number, FlowRow] => [pos(x.id), lineRow(x)]),
    ...payEvs.map((ev): [number, FlowRow] => [pos(ev.key), payRow(ev)]),
    ...recvEvs.map((ev): [number, FlowRow] => [pos(ev.key), recvRow(ev.r)]),
  ] as [number, FlowRow][]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  // มูลค่าเวนคืนในตาราง (ตกลง 8 พ.ย. 2026): ตามสัญญา → ช่องของแถวเบี้ย / ผลประโยชน์ที่วันตรงกัน (ไม่มี = แถวมูลค่าเวนคืนอย่างเดียว)
  //   ยอดที่ลงจริง → แถวย่อยใต้แถวล่าสุดที่ถึงวันนั้น
  const showCvCol = !isProp && (cvRows.length > 0 || !!cvAsset);
  if (showCvCol) {
    // ปีที่ยังไม่มีมูลค่าเวนคืน (ก่อนปีแรกในตาราง) = 0.00 ตัวจาง · แสดงอย่างเดียว ไม่ต้องใส่แถว 0 ในตาราง (ตกลง 8 พ.ย. 2026)
    const firstCvYear = Math.min(...cvRows.map((r) => r.policy_year));
    const zeroYears = startIso && cvRows.length > 0
      ? Array.from({ length: Math.max(firstCvYear - 1, 0) }, (_, k) => ({ policy_year: k + 1, value: 0, value_date: addMonthsKeepDay(startIso, (k + 1) * 12), zero: true }))
      : [];
    [...zeroYears, ...cvRows.map((r) => ({ ...r, zero: false }))].forEach((r) => {
      const cell = r.zero ? <span className="tabular-nums text-slate-400">{money(0)}</span> : cvCellOf(r);
      const be = !r.zero && cvBE?.policy_year === r.policy_year ? { projected: r.value_date > today } : null;
      const hit = flowRows.find((x) => !x.money && x.kind !== "CV" && x.date === r.value_date && x.cv == null);
      if (hit) { hit.cv = cell; hit.breakEvenCv = be; return; }
      const at = flowRows.findIndex((x) => x.date > r.value_date);
      flowRows.splice(at < 0 ? flowRows.length : at, 0, { key: `cvy${r.policy_year}`, kind: "CV", date: r.value_date,
        label: startIso ? "" : `สิ้นปีกรมธรรม์ที่ ${r.policy_year}`, amount: 0, cv: cell, muted: r.value_date > today,
        net: showNet ? netAt(r.value_date)?.net ?? null : null, projected: netAt(r.value_date)?.projected, breakEvenCv: be });
    });
    if (flowRows.length === 0 && cvSubs.length > 0)
      flowRows.push({ key: "cvlog", kind: "CV", date: cvSubs[0].date, label: "ยอดที่ลงไว้ (ยังไม่มีตารางตามสัญญา)", amount: 0 });
    cvSubs.forEach((c) => {
      let at = 0;
      flowRows.forEach((x, k) => { if (x.date <= c.date) at = k; });
      const host = flowRows[at];
      host.cash = [...(host.cash ?? []), c].sort((a, b) => a.date.localeCompare(b.date));
    });
  }


  // ความคุ้มครอง: ชีวิต / อุบัติเหตุที่ยังไม่ได้ใส่ชนิด "เสียชีวิต" → แถว "ตามทุนประกัน" (ไม่คัดลอกยอดไปเก็บ · ตกลง 6 พ.ย. 2026)
  //   กดแถวนั้น = บันทึกเป็นรายการจริงของเล่ม · รายการจริงที่ยอดไม่เท่าทุนประกัน → แสดงทุนประกันตัวเล็กไว้เทียบ
  type Cov = { id: string; coverage_type: string; limit_amount: number; currency: string; notes: string | null; max_count: number | null;
    count_period: string | null; label: string | null; as_of_date: string | null };
  const covTable = (pid: string, type: string, sum: number, sumCcy: string, list: Cov[]) => {
    const k = deathCoverage(type);
    const virtual = !!k && sum > 0 && !list.some((c) => c.coverage_type === k);
    if (!virtual && list.length === 0) return null;
    return (
      // คอลัมน์กว้างเท่ากันทุกส่วนของเล่ม (สัญญาหลัก / สัญญาเพิ่มเติม) → ตัวเลขตรงกันเป็นแนวเดียว · กล่องกว้าง 2 ใน 3 (คู่กับกล่องเคลม)
      <table className="w-full text-sm md:table-fixed">
        <colgroup><col className="md:w-44" /><col className="md:w-56" /><col /><col className="md:w-20" /></colgroup>
        <tbody className="divide-y divide-slate-100">
          {virtual && k && (
            <SumCoverageRow policyId={pid} type={k} amount={sum} currency={sumCcy} canWrite={canWrite}>
              <td className="py-1.5">{COVERAGE_LABEL[k][0]}</td>
              <td className="text-right tabular-nums">{money(sum, sumCcy)}</td>
              <td className="pl-4 text-xs text-slate-500">ตามทุนประกัน{canWrite && " · ถ้าเล่มนี้จ่ายไม่เท่าทุนประกัน กดที่แถวเพื่อบันทึกยอดจริง"}</td>
            </SumCoverageRow>
          )}
          {[...list].sort((a, b) => COV_ORDER.indexOf(a.coverage_type) - COV_ORDER.indexOf(b.coverage_type)).map((c) => (
            <tr key={c.id}>
              <td className="py-1.5">{covName(c.coverage_type, c.label)}</td>
              <td className="text-right tabular-nums">{covAmount(c.coverage_type, c.limit_amount, c.currency)}{COVERAGE_LABEL[c.coverage_type]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[c.coverage_type][1]}</span>}
                {covExtra(c) && <span className="block text-xs text-slate-500">{covExtra(c)}</span>}
                {c.coverage_type === k && sum > 0 && Math.abs(Number(c.limit_amount) - sum) > 0.005 && <span className="block text-xs text-slate-500">ทุนประกัน {money(sum, sumCcy)}</span>}</td>
              <td className="pl-4 text-xs text-slate-500">{c.notes}</td>
              <td className="pl-2 text-right">{canWrite && <RowActions table="insurance_coverages" id={c.id} paths={linePaths(pid)} canDelete={canDelete} fields={[
                ...(c.coverage_type === "WAIVER" ? [] : [{ name: "limit_amount", label: c.coverage_type === "COPAY" ? "ร่วมจ่าย (%)" : "วงเงิน", type: "number" as const, value: c.limit_amount }]),
                ...(c.coverage_type === "OTHER" ? [{ name: "label", label: "ชื่อความคุ้มครอง", value: c.label, width: "w-48" }] : []),
                ...(covCountUnit(c.coverage_type, c.label) || c.max_count ? [{ name: "max_count", label: `สูงสุด (${covCountUnit(c.coverage_type, c.label) ?? "ครั้ง"})`, type: "number" as const, value: c.max_count }] : []),
                ...(coverageHasPeriod(c.coverage_type) ? [{ name: "count_period", label: "รอบ", type: "select" as const, value: c.count_period,
                  options: [["", "ไม่ระบุ"] as [string, string], ...COVERAGE_PERIOD.filter(([v]) => periodAllowed(c.coverage_type, v, c.count_period))] }] : []),
                { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-48" }]} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  // ในเล่มนี้: ทุกส่วนของเล่ม (ทุน · เบี้ย / ปี) · แก้ทุกส่วนที่หน้านี้ (แก้ไขข้อมูล → ส่วนของสัญญาเพิ่มเติม)
  const bookPremTotal = bookParts.filter((x) => x.status === "ACTIVE" && (x.premium_currency ?? "THB") === (p.premium_currency ?? "THB"))
    .reduce((t, x) => t + Number(x.premium ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/insurance" className="text-sm text-slate-500 hover:underline">← Insurance</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{p.insurer}{p.policy_no && ` · ${p.policy_no}`}</h1>
            <p className="text-sm text-slate-500">{TYPE[p.insurance_type] ?? p.insurance_type}
              {p.person_id && ` · ผู้เอาประกัน ${allName.get(p.person_id) ?? ""}`}
              {insured && <> · คุ้มครอง <Link href={insuredHref} className="hover:underline">{insured.name}</Link></>}
              {others.length > 0 && <> · มีสัญญาเพิ่มเติม {others.map((o) => typeLabel(o.id)).join(", ")}</>}</p>
          </div>
          {canWrite && policyActive && !isProp && (
            <ActionBar>
              <AddRiderButton mainId={id} policyNo={p.policy_no} currency={ccy} today={today} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50" />
            </ActionBar>
          )}
        </div>
      </div>

      {/* หน้าเดียว ไม่มีแท็บ (ตกลง 8 พ.ย. 2026): แถวบน มูลค่าเวนคืน + เอกสาร | รายละเอียด · แถวกลาง เคลม | ความคุ้มครอง · ตารางเต็มความกว้างด้านล่าง */}
      <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่าเวนคืน + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าเวนคืน</div>
            {cvAsset ? (
              <>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{money(cvAsset.current_value, cvAsset.currency, 0)}</div>
                <div className="text-xs text-slate-500">ณ {thDate(cvAsset.current_value_date)}</div>
                {vals[0] && bonusOf(vals[0]) > 0 && (
                  <div className="mt-1 text-xs text-slate-600">การันตี {money(guarOf(vals[0]), undefined, 0)} · โบนัส (ไม่การันตี) {money(bonusOf(vals[0]), undefined, 0)}</div>
                )}
                <div className="mt-2 text-xs text-slate-600">เจ้าของ: {activeOwners.map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ") || "-"}</div>
                {p.person_id && !(activeOwners.length === 1 && activeOwners[0].person_id === p.person_id && Number(activeOwners[0].ownership_percent) === 100) && (
                  <div className="mt-1 text-xs text-amber-700">เจ้าของมูลค่าเวนคืนไม่ใช่ผู้เอาประกัน 100% — ตรวจว่าถูกต้อง</div>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-500">{p.has_cash_value ? "ยังไม่มีมูลค่า" : "ไม่มี (ไม่นับเป็นสินทรัพย์)"}</p>
                {showCv && !isProp && <p className="mt-1 text-xs text-slate-500">ใส่ตารางมูลค่าเวนคืนที่ตารางด้านล่าง · ระบบสร้างและลงยอดให้เอง</p>}
              </>
            )}
            {cvRows.length > 0 && (
              <div className="mt-1 text-xs text-slate-600">ตามสัญญา{cvDue ? ` ปีที่ ${cvDue.policy_year} (${thDate(cvDue.value_date)}) ${money(cvDue.value, ccy, 0)}` : ` ${cvRows.length} ปี · ยังไม่ถึงปีแรก`}
                {cvPending && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">ยังไม่ได้ลง</span>}</div>
            )}
            {premPaid > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
                <dt className="text-slate-500">เบี้ยที่จ่ายรวม</dt>
                <dd className="text-right tabular-nums">{money(premPaid, ccy, 0)}{premHist > 0 && <span className="block text-slate-400">ก่อน Go-live {money(premHist, undefined, 0)}</span>}</dd>
                <dt className="text-slate-500">ผลประโยชน์ที่รับรวม</dt><dd className="text-right tabular-nums">{money(benReceived, ccy, 0)}</dd>
                {cvNow != null && <><dt className="text-slate-500">มูลค่าเวนคืน</dt><dd className="text-right tabular-nums">{money(cvNow, ccy, 0)}</dd></>}
                <dt className="font-medium text-slate-700">ได้คืนเทียบเบี้ย</dt>
                <dd className={`text-right font-medium tabular-nums ${backPct >= 100 ? "text-emerald-700" : "text-slate-700"}`}>{backPct.toFixed(0)}%</dd>
              </dl>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
              เบี้ย {money(p.premium, p.premium_currency ?? undefined, 0)} / ปี{bookRes && <> · ทั้งเล่ม {money(bookPremTotal, undefined, 0)} / ปี</>}{premNext && <> · งวดถัดไป {thDate(premNext.due_date)}</>}
              {premOverdue.length > 0 && <span className="text-red-600"> · เลยกำหนด {premOverdue.length} งวด</span>}
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="INSURANCE" entityType="INSURANCE_POLICY" entityId={id} module="INSURANCE" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ประเภท">{TYPE[p.insurance_type] ?? p.insurance_type}{p.plan_name && <span className="block text-xs text-slate-500">{p.plan_name}</span>}</Item>
                <Item label="บริษัท / เลขกรมธรรม์">{p.insurer}{p.policy_no && <span className="block text-xs text-slate-500">{p.policy_no}</span>}</Item>
                <Item label="สถานะ">{Object.fromEntries(INS_STATUS)[p.status] ?? p.status}
                  {p.derived_status === "EXPIRING_SOON" && <span className="block text-xs text-amber-700">ใกล้ครบ</span>}
                  {p.derived_status === "EXPIRED" && p.status === "ACTIVE" && <span className="block text-xs text-red-600">เลยวันสิ้นสุด</span>}</Item>
                {p.insurance_type !== "PROPERTY" && <Item label="ผู้เอาประกัน">{p.person_id ? allName.get(p.person_id) ?? "-" : "-"}</Item>}
                <Item label="ผู้จ่ายเบี้ย">{payerId ? allName.get(payerId) ?? "-" : "-"}</Item>
                <Item label="จ่ายเบี้ยจาก">{payDefaultText ?? <span className="text-slate-400">เลือกตอนจ่าย</span>}</Item>
                {insured && <Item label="ทรัพย์สินที่คุ้มครอง"><Link href={insuredHref} className="text-blue-700 hover:underline">{insured.name}</Link></Item>}
                <Item label="ระยะเวลา">{thDate(p.start_date)} – {thDate(p.end_date)}</Item>
                <Item label="ทุนประกัน" num>{money(p.insured_amount, p.insured_amount_currency ?? undefined, 0)}</Item>
                <Item label="เบี้ยต่อปี" num>{money(p.premium, p.premium_currency ?? undefined, 0)}</Item>
                {bookRes && (
                  <Item label="ในเล่มนี้ (บริษัท + เลขกรมธรรม์เดียวกัน)" wide>
                    {bookParts.map((x) => (
                      <div key={x.id}>
                        <b className="font-medium">{partName(x.id)}</b>
                        <span className="text-slate-500"> · {x.id === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม"}{x.plan_name && ` · ${x.plan_name}`} · ทุน {money(x.insured_amount, x.insured_amount_currency ?? undefined, 0)}
                          {" "}· เบี้ย {money(x.premium, x.premium_currency ?? undefined, 0)} / ปี{x.status !== "ACTIVE" && " · ไม่มีผลแล้ว"}</span>
                      </div>
                    ))}
                    <div className="mt-1 font-medium">รวมเบี้ยทั้งเล่ม <span className="tabular-nums">{money(bookPremTotal, p.premium_currency ?? undefined, 0)}</span> / ปี</div>
                  </Item>
                )}
                <Item label="ผู้รับผลประโยชน์">
                  {(bens ?? []).length === 0 ? "-" : (bens ?? []).map((b) => <div key={b.id}>{benName(b)} · {Number(b.percentage)}%</div>)}
                  {benTotal > 0 && benTotal < 100 && <div className="text-xs text-amber-700">รวม {benTotal}% (ยังไม่ครบ 100%)</div>}
                </Item>
                {p.notes && <Item label="หมายเหตุ" wide>{p.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <WithStatus status={{ table: "insurance_policies", id, value: p.status, paths, label: "สถานะกรมธรรม์",
                  options: INS_STATUS,
                  remove: canDelete ? { kind: "policy", id, redirectTo: "/insurance", paths: ["/insurance"], label: "ลบกรมธรรม์นี้", hint: "มูลค่าเวนคืน ผู้รับผลประโยชน์ และเคลมจะถูกลบด้วย" } : undefined }}>
                  <PolicyInfoForm policyId={id} persons={persons ?? []} showInsured={p.insurance_type !== "PROPERTY"} banks={banks ?? []} cards={cards} currency={payCcy} v={{
                    person_id: p.person_id, payer_person_id: p.payer_person_id, insurer: p.insurer, policy_no: p.policy_no, start_date: p.start_date,
                    end_date: p.end_date, insured_amount: p.insured_amount, premium: p.premium, notes: p.notes, pay_default: payDefault, insurance_type: p.insurance_type,
                    plan_name: p.plan_name }} booklet={others.length > 0} />
                </WithStatus>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้รับผลประโยชน์</h3>
                  <BeneficiaryEditor policyId={id} persons={persons ?? []} startOpen
                    current={(bens ?? []).map((b) => ({ person_id: b.person_id, name: b.beneficiary_name, percent: Number(b.percentage) }))} />
                </div>
                {others.map((o) => (
                  <div key={o.id} className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">{partHead(o.id)}</h3>
                    <WithStatus status={{ table: "insurance_policies", id: o.id, value: o.status, paths: linePaths(o.id), label: "สถานะสัญญาเพิ่มเติม",
                      options: INS_STATUS,
                      remove: canDelete ? { kind: "policy", id: o.id, redirectTo: `/insurance/${id}`, paths: linePaths(o.id), label: "ลบสัญญาเพิ่มเติมนี้",
                        hint: "งวดเบี้ย ความคุ้มครอง และเคลมของส่วนนี้จะถูกลบด้วย" } : undefined }}>
                      <PolicyInfoForm policyId={o.id} persons={persons ?? []} showInsured banks={banks ?? []} cards={cards} currency={o.premium_currency ?? o.insured_amount_currency ?? "THB"} v={{
                        person_id: o.person_id, payer_person_id: o.payer_person_id, insurer: o.insurer ?? "", policy_no: o.policy_no, start_date: o.start_date,
                        end_date: o.end_date, insured_amount: o.insured_amount, premium: o.premium, notes: o.notes, pay_default: payDefaultValue(o), insurance_type: o.insurance_type,
                        plan_name: o.plan_name }} part />
                    </WithStatus>
                  </div>
                ))}
                {cvAsset && (
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">เจ้าของมูลค่าเวนคืน</h3>
                    <OwnershipEditor kind="asset" id={cvAsset.id} persons={persons ?? []} paths={paths} today={today} startOpen
                      current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                  </div>
                )}
              </div>
            } />
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {/* เคลม (ตกลง 8 พ.ย. 2026): กล่องแคบ · 1 เคลม = 2 บรรทัด · รอรับ = ยอดเคลม − ได้รับ ของเคลมที่ยังไม่จบ · เงินคืนเข้าบัญชีไหน */}
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-slate-900">เคลม <InfoTip label="คำอธิบาย">ยื่นเคลม = ติดตามอย่างเดียว ยังไม่นับเป็นรายได้หรือความมั่งคั่งสุทธิ จนกว่าจะได้เงินจริง ·
              ได้เงินแล้วกด &ldquo;บันทึกรับเงิน&rdquo; ที่เคลมนั้น: (1) เงินคืนค่าใช้จ่ายที่จ่ายเองไปก่อน (ต้องตั้งค่าใช้จ่ายนั้นเป็น &ldquo;ได้เงินคืน&rdquo; ไว้) = ลดค่าใช้จ่าย ไม่ใช่รายได้ ·
              (2) เงินชดเชย / สินไหม = รายได้ &ldquo;ผลประโยชน์ประกัน&rdquo; · ทั้ง 2 แบบเข้าบัญชีที่เลือก ยอด &ldquo;ได้รับ&rdquo; และสถานะเคลมอัปเดตให้เอง ·
              แก้ / ลบเงินที่รับแล้วที่ Income &amp; Expenses</InfoTip></h2>
            {canWrite && policyActive && <ClaimForm policyId={id} currency={ccy} today={today}
              parts={book ? bookParts.filter((x) => x.status === "ACTIVE").map((x) => ({ id: x.id, label: `${x.id === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม"} · ${typeLabel(x.id)}` })) : undefined}
              coverages={[...(covs ?? []).map((c) => ({ ...c, policy_id: id })), ...(book?.covs ?? [])].map((c) => ({ id: c.id, policy_id: c.policy_id, coverage_type: c.coverage_type,
                limit_amount: Number(c.limit_amount), label: c.label, part: book ? typeLabel(c.policy_id) : undefined }))} />}
          </div>
          {claimWait.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">รอรับ <b className="tabular-nums">{claimWait.map(([c, v]) => money(v, c)).join(" · ")}</b> · {claimOpen.length} เคลม</p>
          )}
          {claims.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเคลม</p> : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {claims.map((c) => {
                  const got = Number(c.received_amount ?? 0);
                  const wait = CLAIM_OPEN.includes(c.status) ? Math.max(Number(c.claimed_amount ?? 0) - got, 0) : 0;
                  const rest = Number(c.claimed_amount ?? 0) - got;   // ยอดที่ยังรับได้ (เคลมร่างก็บันทึกรับได้)
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span>{thDate(c.claim_date)}{book && <span className="text-slate-500"> · {typeLabel(c.policy_id)}</span>}</span>
                          <span className="tabular-nums">{money(c.claimed_amount, c.currency)}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-slate-500">
                          <span><span className={`rounded px-1.5 py-0.5 ${CLAIM_CLS[c.status] ?? "bg-slate-100 text-slate-600"}`}>{CSTATUS[c.status] ?? c.status}</span>
                            {c.incident_date && <> · เกิดเหตุ {thDate(c.incident_date)}</>}</span>
                          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                            <span className="tabular-nums">{got > 0 && <>ได้รับ {money(got)}</>}{got > 0 && wait > 0 && " · "}{wait > 0 && <span className="text-amber-700">รอรับ {money(wait)}</span>}</span>
                            {canWrite && rest > 0.005 && !CLAIM_DONE.includes(c.status) && <ClaimReceiveForm claimId={c.id} claimDate={c.claim_date} currency={c.currency}
                              claimed={Number(c.claimed_amount ?? 0)} wait={Math.round(rest * 100) / 100} banks={banks ?? []} persons={persons ?? []} today={today} minDate={goLive || null}
                              expenses={pendingExp.filter((e) => e.currency === c.currency)} />}
                          </span>
                        </div>
                        {(byClaim.get(c.id) ?? []).map((r) => {
                          const e = (Array.isArray(r.expense_items) ? r.expense_items[0] : r.expense_items) as { description: string; date: string } | null;
                          const to = r.received_to_asset_id ? `เข้า ${bankName.get(r.received_to_asset_id) ?? "บัญชี (ปิดแล้ว)"}`
                            : r.received_to_credit_card_id ? `เข้าบัตร ${cardName.get(r.received_to_credit_card_id) ?? ""}` : null;
                          return <div key={r.id} className="mt-0.5 text-xs text-emerald-700">รับคืน {thDate(r.received_date)} {money(r.amount, r.currency)}{to && ` · ${to}`}
                            {e && <span className="text-slate-500"> · {e.description} ({thDate(e.date)})</span>}</div>;
                        })}
                        {(incByClaim.get(c.id) ?? []).map((r) => <div key={r.id} className="mt-0.5 text-xs text-emerald-700">รับเงินเคลม {thDate(r.date)} {money(r.amount, r.currency)}
                          {r.received_to_asset_id && ` · เข้า ${bankName.get(r.received_to_asset_id) ?? "บัญชี (ปิดแล้ว)"}`}<span className="text-slate-500"> · รายได้</span></div>)}
                        {c.notes && <div className="mt-0.5 text-xs text-slate-500">{c.notes}</div>}
                        {canWrite && <RowActions table="insurance_claims" id={c.id} paths={paths} canDelete={canDelete} fields={[
                          { name: "claim_date", label: "ยื่นเคลม", type: "date", value: c.claim_date },
                          { name: "claimed_amount", label: "ยอดเคลม", type: "number", value: c.claimed_amount },
                          { name: "received_amount", label: "ได้รับ", type: "number", value: c.received_amount },
                          { name: "status", label: "สถานะ", type: "select", value: c.status, options: CLAIM_STATUS },
                          { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium text-slate-900">ความคุ้มครอง</h2>
            {canWrite && <CoverageEditor today={today} parts={(book ? bookParts : [p as BookPol]).map((x) => ({ id: x.id, label: book ? partHead(x.id) : null,
              insType: x.insurance_type, sum: Number(x.insured_amount ?? 0), currency: x.insured_amount_currency ?? x.premium_currency ?? ccy,
              existing: x.id === id ? (covs ?? []) : (book?.covs ?? []).filter((c) => c.policy_id === x.id),
              scope: partOf(x.id).coverage_scope, checked: partOf(x.id).coverage_checked_on }))} />}
          </div>
          {book ? <h3 className="text-sm font-medium text-slate-800">{partHead(id)} <span className="ml-1">{partMeta(id)}</span></h3>
            : !isProp && <p className="-mt-1">{partMeta(id)}</p>}
          {covTable(id, p.insurance_type, Number(p.insured_amount ?? 0), p.insured_amount_currency ?? ccy, covs ?? [])
            ?? <p className="text-sm text-slate-500">ยังไม่ได้ใส่รายการความคุ้มครอง (ใช้สรุปสิทธิ์รายคนในหน้า Insurance)</p>}
          {others.map((o) => (
            <div key={o.id} className="space-y-2 border-t border-slate-100 pt-3">
              <h3 className="text-sm font-medium text-slate-800">{partHead(o.id)}
                <span className="ml-2 text-xs font-normal text-slate-500">ทุน {money(o.insured_amount, o.insured_amount_currency ?? undefined, 0)} · เบี้ย {money(o.premium, o.premium_currency ?? undefined, 0)} / ปี</span>
                <span className="ml-2">{partMeta(o.id)}</span>
              </h3>
              {covTable(o.id, o.insurance_type, Number(o.insured_amount ?? 0), o.insured_amount_currency ?? ccy, (book?.covs ?? []).filter((c) => c.policy_id === o.id))
                ?? <p className="text-sm text-slate-500">ยังไม่ได้ใส่รายการความคุ้มครอง</p>}
            </div>
          ))}
        </section>
      </section>
      </div>

      {(fups ?? []).length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">กรมธรรม์ที่ต้องติดตาม (สมาชิก Archived) <InfoTip label="คำอธิบาย">แนบเอกสาร (ใบมรณบัตร / หนังสือเรียกร้องสินไหม) ได้ที่ &ldquo;เอกสาร&rdquo; ท้ายหน้านี้</InfoTip></h2>
          <ul className="space-y-2 text-sm">
            {(fups ?? []).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                <div><b>{allName.get(f.person_id) ?? "-"}</b> ({FOLLOWUP_ROLE[f.role] ?? f.role}) · {f.action}
                  {f.notes && <div className="text-xs text-slate-500">{f.notes}</div>}</div>
                {canWrite ? <div className="flex items-center gap-2">
                  <StatusSelect table="insurance_followups" id={f.id} value={f.status} paths={paths} options={FOLLOWUP_STATUS} />
                  <RowActions table="insurance_followups" id={f.id} paths={paths} canDelete={false} fields={[{ name: "notes", label: "บันทึก", value: f.notes, width: "w-56" }]} />
                </div> : <span className="text-xs">{Object.fromEntries(FOLLOWUP_STATUS)[f.status]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="flow" className="scroll-mt-20 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        {toFlow && <ScrollToId id="flow" />}
        {/* ปุ่มหลายปุ่ม (ตาราง + มูลค่าเวนคืน · 8 พ.ย. 2026): หัวข้อซ้าย ปุ่มขวาขึ้นบรรทัดใหม่ได้ · คำอธิบายใต้หัวข้อเต็มความกว้าง */}
        <ActionBar>
          <div className="w-full space-y-0.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="shrink-0 py-1 font-medium text-slate-900">{isProp ? "ตารางเบี้ย" : showCv ? "มูลค่าเวนคืน เบี้ยประกัน และผลประโยชน์" : "เบี้ยประกันและผลประโยชน์"}{" "}<InfoTip label="คำอธิบาย">
            {premiums.length > 0 ? (
              <span className="block">เบี้ย {premiums.length} งวด · จ่ายถึงปี {lastYear(premiums)} ({thDate(lastDue(premiums))}) · เหลือ {leftCount(premiums)} งวด
                {premNext && <> · งวดถัดไป {thDate(premNext.due_date)} {money(premNext.remaining)}</>}
                {payerId && <> · ผู้จ่าย {allName.get(payerId)}</>}</span>
            ) : <span className="block">ยังไม่ได้ตั้งตารางเบี้ย — ตั้งแล้วจะขึ้นใน Income &amp; Expenses → ค่าใช้จ่ายที่ต้องจ่าย</span>}
            {others.map((o) => {
              const xs = allPremiums.filter((x) => x.policy_id === o.id);
              return (
                <span key={o.id} className="block">
                  สัญญาเพิ่มเติม · {typeLabel(o.id)}
                  {xs.length > 0 ? <> · เบี้ย {xs.length} งวด · จ่ายถึงปี {lastYear(xs)} ({thDate(lastDue(xs))}) · เหลือ {leftCount(xs)} งวด</> : " · ยังไม่ได้ตั้งตารางเบี้ย"}
                </span>
              );
            })}
            {!isProp && (benefits.length > 0
              ? <span className="block">ผลประโยชน์ {benefits.length} งวด · รับถึงปี {lastYear(benefits)} ({thDate(lastDue(benefits))}) · เหลือ {leftCount(benefits)} งวด</span>
              : <span className="block">ผลประโยชน์รายงวด (เงินคืน / บำนาญ / ครบสัญญา) ตั้งเป็นตาราง · ก้อนเดียวที่ไม่อยู่ในตาราง (เวนคืน / สินไหม) กด &ldquo;บันทึกรับ&rdquo; → รับเงินก้อน</span>)}
            {!isProp && (cvRows.length > 0
              ? <span className="block">มูลค่าเวนคืนตามสัญญา {cvRows.length} ปี{cvDue ? ` · ล่าสุดปีที่ ${cvDue.policy_year} (${thDate(cvDue.value_date)}) ${money(cvDue.value, ccy)}` : " · ยังไม่ถึงปีแรก"}</span>
              : showCv && <span className="block">มูลค่าเวนคืน: ใส่ตารางตามสัญญาจากเล่มกรมธรรม์ (มูลค่าสิ้นปีกรมธรรม์) แล้วระบบสร้างและลงยอดให้เองทุกปี
                  · เล่มที่ไม่มีตารางในสัญญา ใส่ยอดตามหนังสือแจ้งเป็นแถวในตารางเดียวกัน</span>)}
            {cvAsset && !isProp && <span className="block">มีมูลค่าเวนคืน: เงินที่รับถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินนับเป็นรายได้</span>}
            {showIrr && <span className="block">IRR = ผลตอบแทนต่อปีคิดตามวันที่จริงของแต่ละรายการ (XIRR) · ยังไม่รวมภาษีที่ลดหย่อนได้จากเบี้ย</span>}
            </InfoTip></h2>
            {canWrite && policyActive && <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
            {canDelete && <>
            {/* เล่มที่มีสัญญาเพิ่มเติม (ตกลง 8 พ.ย. 2026): ปุ่มเดียว "แก้ตารางเบี้ย" ทั้งเล่ม · คอลัมน์ละส่วน + รวม · บันทึกพร้อมกัน */}
            {bookEd.length > 1
              ? <BookletScheduleEditor parts={bookEd} current={bookEdCurrent} goLive={family?.go_live_date ?? null} />
              : <InsScheduleEditor policyId={id} kind="PREMIUM" currency={ccy} current={premiums} goLive={family?.go_live_date ?? null}
                defaultAmount={Number(p.premium ?? 0)} defaultFirstDue={lastDue(premiums) ? addMonthsKeepDay(lastDue(premiums) as string, 12) : (p.start_date ?? today)} />}
            {!isProp && <InsScheduleEditor policyId={id} kind="BENEFIT" currency={ccy} current={benefits} goLive={family?.go_live_date ?? null}
              defaultFirstDue={p.start_date ? addMonthsKeepDay(p.start_date, 24) : today} />}
            </>}
            {/* มูลค่าเวนคืน (ตกลง 8 พ.ย. 2026): ปุ่มเดียว = แก้ตารางแบบเดียวกับตารางเบี้ย · ปรับยอดปีไหน กดตัวเลขสีฟ้าของปีนั้นในตาราง */}
            {!isProp && showCv && canDelete && <CvTableEditor policyId={id} startDate={startIso} current={cvRows} postedYears={postedYears} today={today}
              goLive={goLive || null} currency={cvAsset?.currency ?? ccy} />}
            {!isProp && cvPending && <SyncCashValueButton policyId={id} />}
            {/* บันทึกรับ + บันทึกจ่าย คู่กัน (ตกลง 8 พ.ย. 2026 · แบบเงินกู้ แทนปุ่มรายแถว): เลือกวันที่ → เติมงวดที่ครบถึงวันนั้น ทุกส่วนของเล่ม */}
            {!isProp && <ReceiveForm lines={openBen} policyId={id} currency={ccy} banks={banks ?? []} persons={persons ?? []} hasCashValue={!!cvAsset}
              cashValue={cvAsset?.current_value} today={today} canClose={canDelete} minDate={goLive || null}
              closed={["MATURED", "SURRENDERED", "CLAIMED", "CANCELLED"].includes(p.status) ? Object.fromEntries(INS_STATUS)[p.status] : null} />}
            <PayLinesForm lines={openPrem} group={bookletKey(p) ?? ""} banks={banks ?? []} cards={cards} persons={persons ?? []} defaultPerson={payerId}
              defaultPay={payDefault} today={today} minDate={goLive || null} />
            </div>}
          </div>
            {/* สรุปตาราง + คำอธิบาย อยู่ใน ⓘ ข้างหัวข้อ (ตกลง 9 พ.ย. 2026 · เดิม 4 บรรทัดใต้หัวข้อ) · เหลือบรรทัดเตือนเมื่อมีเรื่องต้องทำ */}
            {(premOverdue.length > 0 || cvPending) && <p className="text-sm">
              {premOverdue.length > 0 && <span className="text-red-600">เบี้ยเลยกำหนด {premOverdue.length} งวด</span>}
              {premOverdue.length > 0 && cvPending && " · "}
              {cvPending && <span className="text-amber-700">มูลค่าเวนคืนปีที่ {cvDue?.policy_year} ยังไม่ได้ลง (เบี้ยก่อนหน้ายังค้าง หรือกด &ldquo;ลงมูลค่าตามตาราง&rdquo;)</span>}</p>}
          </div>
        </ActionBar>
        {showNet && (
          <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-slate-500">จ่ายเบี้ยแล้ว{book && " (ทั้งเล่ม)"}</dt><dd className="tabular-nums">{money(flowPremPaid, ccy)}</dd>
              {book && <dd className="text-xs text-slate-500">{bookParts.map((x) => `${partName(x.id)} ${money(allPremiums.filter((l) => l.policy_id === x.id).reduce((t, l) => t + insCountedPaid(l), 0), undefined, 0)}`).join(" · ")}</dd>}</div>
            <div><dt className="text-xs text-slate-500">รับผลประโยชน์แล้ว</dt><dd className="tabular-nums">{money(flowBenReceived, ccy)}</dd></div>
            <div><dt className="text-xs text-slate-500">สุทธิถึงวันนี้</dt>
              <dd className={`tabular-nums ${flowNetToday >= -0.005 ? "text-emerald-700" : "text-red-700"}`}>{signedMoney(flowNetToday, ccy)}</dd>
              {netSkip.length > 0 && <dd className="text-xs text-slate-500">ไม่นับเบี้ย{netSkip.join(" / ")}</dd>}</div>
            {/* มีตารางมูลค่าเวนคืน = 2 บรรทัด: ถ้าเวนคืน (ปีแรกที่มูลค่าเวนคืนพอเบี้ยที่จ่าย) · ถ้าไม่เวนคืน (ผลประโยชน์รวม ≥ เบี้ยรวม) */}
            <div><dt className="text-xs text-slate-500">จุดคุ้มทุน</dt>
              {cvBE && <dd className="text-sky-700"><span className="text-xs text-slate-500">ถ้าเวนคืน </span>ปีที่ {cvBE.policy_year} · {thDate(cvBE.value_date)}
                {cvBE.value_date > today && <span className="whitespace-nowrap text-xs text-slate-500"> (คาดการณ์)</span>}</dd>}
              {hasBen && <dd>{cvRows.length > 0 && <span className="text-xs text-slate-500">ถ้าไม่เวนคืน </span>}
                {flow.breakEven ? <span className="text-emerald-700">{thDate(flow.breakEven.date)}{flow.breakEven.projected && <span className="whitespace-nowrap text-xs text-slate-500"> (คาดการณ์)</span>}</span>
                : <span className="text-slate-500">ไม่ถึงตามตาราง{flow.final < -0.005 && <span className="text-xs"> · ขาด {money(-flow.final)}</span>}</span>}</dd>}
              {!hasBen && !cvBE && <dd className="text-slate-500">มูลค่าเวนคืนไม่ถึงเบี้ยที่จ่ายตามตาราง</dd>}</div>
            <div className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">ตามตารางทั้งหมด{book && " (ทั้งเล่ม)"}: เบี้ย {money(schedPrem, ccy)} · ผลประโยชน์ {money(schedBen, ccy)}
              {netSkip.length > 0 && ` · สุทธิสะสมและจุดคุ้มทุนไม่นับเบี้ย${netSkip.join(" / ")} (เบี้ยคุ้มครอง ไม่มีเงินคืน)`}
              {hasBen && !flow.breakEven && allBenefits.every((x) => x.benefit_type !== "MATURITY") && " · ถ้ามีเงินครบสัญญา ใส่ในตารางผลประโยชน์ (ชนิด ครบสัญญา) เพื่อให้เห็นจุดคุ้มทุน"}</div>
          </dl>
        )}
        {showIrr && (
          <div className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-3">
              {irrBoxes.map((b) => (
                <div key={b.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500">IRR {b.label}</div>
                  <div className={`text-lg font-semibold tabular-nums ${b.value == null ? "text-slate-400" : b.value < 0 ? "text-red-600" : "text-slate-900"}`}>
                    {b.book !== undefined && <span className="mr-1 text-xs font-normal text-slate-500">{partName(id)}</span>}
                    {b.value == null ? "–" : `${signedPct(b.value * 100)} / ปี`}</div>
                  {b.book !== undefined && (
                    <div className={`tabular-nums ${b.book == null ? "text-slate-400" : b.book < 0 ? "text-red-600" : "text-slate-900"}`}>
                      <span className="mr-1 text-xs text-slate-500">ทั้งเล่ม</span>{b.book == null ? "–" : `${signedPct(b.book * 100)} / ปี`}</div>
                  )}
                  <div className="text-xs text-slate-500">{b.value == null ? b.why : b.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {flowRows.length > 0 && <FlowTable rows={flowRows} showNet={showNet} parts={flowParts} showCv={showCvCol} startDate={startIso} birthDate={birthIso} />}
      </section>
    </div>
  );
}
