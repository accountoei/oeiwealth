import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  BENEFIT_TYPE_LABEL, CLAIM_STATUS, COVERAGE_COUNT_UNIT, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_SCHED_STATUS, INS_STATUS, INS_TYPE,
  covAmount, covExtra, deathCoverage, insCountedPaid, money, signedMoney, signedPct, thDate, todayBangkok,
} from "@/lib/format";
import { contractFlows, projectedFlows, runningNet, surrenderFlows, xirr, type FlowCash } from "@/lib/insurance-flow";
import FlowTable, { type FlowPart, type FlowRow, type FlowSub } from "./FlowTable";
import { addMonthsKeepDay } from "@/lib/loan-schedule";
import { AddCashValueForm, BenefitForm, BookletPayForm, CashValueTableEditor, PayPremiumForm, PolicyInfoForm, SumCoverageRow, SyncCashValueButton } from "./ins-forms";
import { CoverageEditor } from "../CoverageGrid";
import { PART_LABEL, bookletGroups, bookletKey, bookletRole, type BookletPolicy } from "@/lib/insurance-booklet";
import InsScheduleEditor from "./InsScheduleEditor";
import EditToggle from "@/components/EditToggle";
import BeneficiaryEditor from "../Beneficiaries";
import ClaimForm from "./ClaimForm";
import RowActions from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect, { WithStatus } from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";
import ModalButton from "@/components/ModalButton";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { ActionBar } from "@/components/ActionBar";
import { premiumPaymentFields } from "@/lib/source-edit";
import { DetailItem as Item } from "@/components/Boxes";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
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
  paid_from_asset_id: string | null; paid_from_credit_card_id: string | null };
const BOOK_COLS = "id,insurance_type,insurer,policy_no,insured_amount,insured_amount_currency,premium,premium_currency,status,person_id,payer_person_id,start_date,end_date,notes,paid_from_asset_id,paid_from_credit_card_id";
const LINE_COLS = "id,kind,installment_no,due_date,amount,currency,benefit_type,notes,paid_amount,remaining,status,skipped";
const PAY_COLS = "id,date,amount,currency,paid_from_asset_id,paid_from_credit_card_id,insurance_schedule_line_id,notes";
const RECV_COLS = "id,line_id,receipt_date,amount,currency,bank_asset_id,cash_value_part,income_part,outcome,notes,created_at";
/** ลำดับหัวข้อความคุ้มครองมาตรฐาน */
const COV_ORDER = Object.keys(COVERAGE_LABEL);
/** ยอดในเซลล์ที่กดเพื่อแก้รายการของเซลล์นั้น */
const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";

const BOX = "space-y-3 rounded-xl border border-slate-200 bg-white p-5";

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
      supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency,notes,max_count,as_of_date").in("policy_id", ids).is("deleted_at", null).order("created_at"),
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
    cvId ? supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", cvId).is("deleted_at", null).order("valuation_date", { ascending: false }) : Promise.resolve({ data: null }),
    cvId ? supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", cvId) : Promise.resolve({ data: null }),
    p.asset_id ? supabase.from("assets").select("name,asset_group").eq("id", p.asset_id).maybeSingle() : Promise.resolve({ data: null }),
    bookQ,
  ]);
  if (bookRes && !bookRes.role.isMain) redirect(`/insurance/${bookRes.role.main.id}${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ""}`);
  const partIds = [id, ...(bookRes?.role.parts ?? []).filter((x) => x.id !== id).map((x) => x.id)];
  const claims = [...(mainClaims ?? []).map((c) => ({ ...c, policy_id: id as string })), ...(bookRes?.claims ?? [])]
    .sort((a, b) => String(b.claim_date ?? "").localeCompare(String(a.claim_date ?? "")));
  const [{ data: linesRaw }, { data: covs }, { data: fups }, { data: banks }, { data: cardsRaw }, { data: allPersons }, { data: cvTable }] = await Promise.all([
    supabase.from("v_insurance_schedule_status").select(LINE_COLS)
      .eq("policy_id", id).order("due_date").order("installment_no"),
    supabase.from("insurance_coverages").select("id,coverage_type,limit_amount,currency,notes,max_count,as_of_date").eq("policy_id", id).is("deleted_at", null).order("created_at"),
    supabase.from("insurance_followups").select("id,policy_id,person_id,role,action,status,notes").in("policy_id", partIds).is("deleted_at", null).order("created_at"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("persons").select("id,name").is("deleted_at", null).order("sort_order"),
    supabase.from("insurance_cash_value_table").select("policy_year,value_date,value").eq("policy_id", id).is("deleted_at", null).order("policy_year"),
  ]);
  const lines = (linesRaw as Line[] | null) ?? [];
  const premiums = lines.filter((x) => x.kind === "PREMIUM");
  const benefits = lines.filter((x) => x.kind === "BENEFIT");
  const cards = (cardsRaw ?? []).map((c) => ({ id: c.id, currency: c.currency, label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const allName = new Map((allPersons ?? []).map((x) => [x.id, x.name]));
  const claimIds = (claims ?? []).map((c) => c.id);
  const { data: linked } = claimIds.length
    ? await supabase.from("expense_reimbursements").select("id,insurance_claim_id,received_date,amount,currency,expense_items(description,date)")
        .in("insurance_claim_id", claimIds).is("deleted_at", null).order("received_date")
    : { data: [] };
  const byClaim = new Map<string, NonNullable<typeof linked>>();
  (linked ?? []).forEach((r) => { if (r.insurance_claim_id) byClaim.set(r.insurance_claim_id, [...(byClaim.get(r.insurance_claim_id) ?? []), r]); });
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
  const cvCtx = cvAsset ? { assetId: cvAsset.id, currency: cvAsset.currency, current: cvAsset.current_value == null ? null : Number(cvAsset.current_value),
    minDate: family?.go_live_date ?? "", paths, suggest: cvDue ? { value: cvDue.value, year: cvDue.policy_year, date: cvDue.value_date } : null } : null;
  const startIso: string | null = p.start_date ?? null;
  // สรุปกรมธรรม์: ได้คืน = (ผลประโยชน์ที่รับ + มูลค่าเวนคืนปัจจุบัน) ÷ เบี้ยที่จ่ายรวม
  const cvNow = cvAsset && cvAsset.current_value != null && cvAsset.currency === ccy ? Number(cvAsset.current_value) : null;
  const backPct = premPaid > 0 ? ((benReceived + (cvNow ?? 0)) / premPaid) * 100 : 0;
  // ปุ่มในกล่องมูลค่าเวนคืนด้านบน (แทนกล่องด้านล่าง · ตกลง 2 พ.ย. 2026 · คล้ายหน้า Property)
  const showCv = !!cvAsset || cvRows.length > 0 || !!p.has_cash_value || p.insurance_type === "LIFE" || p.insurance_type === "ANNUITY";
  const cvTableCurrent = cvRows.map((r) => ({ ...r, value_date: startIso && addMonthsKeepDay(startIso, r.policy_year * 12) === r.value_date ? null : r.value_date }));
  const CV_SOURCE: Record<string, string> = { STATEMENT: "ตามหนังสือแจ้ง", USER: "บันทึกเอง", ACCOUNT_SETUP: "ยอดตั้งต้น" };
  const policyLabel = `เบี้ยประกัน ${p.insurer}${p.policy_no ? ` ${p.policy_no}` : ""}`;
  const activeOwners = (owners ?? []).filter((o: { end_date: string | null }) => !o.end_date) as { person_id: string; person_name: string; ownership_percent: number }[];
  const benName = (b: { person_id: string | null; beneficiary_name: string | null; persons: unknown }) =>
    b.person_id ? ((Array.isArray(b.persons) ? b.persons[0] : b.persons) as { name: string } | null)?.name ?? "-" : b.beneficiary_name;
  const benTotal = (bens ?? []).reduce((s, b) => s + Number(b.percentage), 0);

  // มูลค่าเวนคืน: ใช้ทั้งปุ่มในกล่องด้านบน (pop up) และแท็บ "มูลค่าเวนคืน" (ตกลง 3 พ.ย. 2026)
  const cvUpdate = cvAsset && canWrite ? (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-800">อัปเดตมูลค่า (นับในความมั่งคั่งสุทธิ)</h3>
      <p className="mb-2 text-xs text-slate-500">ตามหนังสือแจ้งจากบริษัทประกัน (ปีละครั้ง) · ถ้าใส่ตารางตามสัญญาไว้ ระบบลงให้เองเมื่อถึงวันครบปีและจ่ายเบี้ยครบ</p>
      <AssetValuationForm assetId={cvAsset.id} currency={cvAsset.currency} today={today} minDate={family?.go_live_date ?? ""} paths={paths}
        methods={[["STATEMENT", "ตามหนังสือแจ้งจากบริษัทประกัน"], ["USER_ESTIMATE", "ประมาณเอง"]]} />
    </div>
  ) : null;
  const cvHistory = cvAsset ? (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ที่มา</th><th className="text-right">มูลค่า</th><th></th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {(cvVals ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-500">ยังไม่มีประวัติ</td></tr>}
        {(cvVals ?? []).map((v) => (
          <tr key={v.id}>
            <td className="py-1.5">{thDate(v.valuation_date)}</td>
            <td className="text-slate-500">{v.source === "OPENING" ? "ยอดตั้งต้น" : v.notes ?? (CV_SOURCE[v.source] ?? v.source)}</td>
            <td className="text-right tabular-nums">{money(v.value, cvAsset.currency, 0)}</td>
            <td className="pl-2 text-right">
              {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (cvVals ?? []).length > 1}
                fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value },
                  { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : null;
  const cvContract = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {cvPending && canWrite && <SyncCashValueButton policyId={id} />}
        {canDelete && <CashValueTableEditor policyId={id} startDate={startIso} current={cvTableCurrent} />}
       <InfoTip label="คำอธิบาย">มูลค่า ณ สิ้นปีกรมธรรม์ (จากเล่มกรมธรรม์) · ระบบลงมูลค่าเวนคืนให้เองเมื่อถึงวันครบปีและจ่ายเบี้ยก่อนหน้านั้นครบ (ไม่ทับยอดที่ลงไว้ใหม่กว่า)</InfoTip></div>
      {cvPending && <p className="text-xs text-amber-700">ปีที่ {cvDue?.policy_year} ถึงวันแล้วแต่ยังไม่ได้ลงมูลค่า</p>}
      <div className="max-h-[26rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-left text-xs text-slate-500"><tr><th className="py-1">ปีที่</th><th>สิ้นปีกรมธรรม์</th><th className="text-right">มูลค่าเวนคืน</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {cvRows.map((r) => (
              <tr key={r.policy_year} className={r.value_date <= today ? "" : "text-slate-400"}>
                <td className="py-1">{r.policy_year}{cvDue?.policy_year === r.policy_year && <span className="ml-1 text-xs text-blue-700">ล่าสุด</span>}</td>
                <td>{thDate(r.value_date)}</td><td className="text-right tabular-nums">{money(r.value, ccy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  const isProp = p.insurance_type === "PROPERTY";
  // จ่ายเบี้ยจาก (ค่าตั้งต้นของกรมธรรม์ · ตกลง 3 พ.ย. 2026) · สกุลเดียวกับที่ฐานข้อมูลตรวจ (เบี้ย → ทุนประกัน → THB)
  const payCcy: string = p.premium_currency ?? p.insured_amount_currency ?? "THB";
  const payDefault = payDefaultValue(p);
  const payDefaultText = p.paid_from_asset_id ? bankName.get(p.paid_from_asset_id) ?? "บัญชี (ปิดแล้ว)"
    : p.paid_from_credit_card_id ? `บัตร ${cardName.get(p.paid_from_credit_card_id) ?? "(ปิดแล้ว)"}` : null;
  const insuredHref = `/${insured?.asset_group === "ALTERNATIVE" ? "alternative" : "property"}/${p.asset_id}`;
  // แก้ / ลบเบี้ยที่จ่ายแล้ว → หน้าทรัพย์สินที่เอาประกันอัปเดตด้วย (เบี้ยนับเป็นค่าใช้จ่ายของทรัพย์สิน)
  const payPaths = [...paths, "/income-expenses", ...(insured ? [insuredHref, "/property"] : [])];
  // หน้ากรมธรรม์เป็นแท็บ (ตกลง 3 พ.ย. 2026): ความคุ้มครอง (+ เคลม) · มูลค่าเวนคืน · เบี้ยและผลประโยชน์ · เปิดที่ความคุ้มครองเสมอ
  //   รับผลประโยชน์ + ชำระเบี้ย รวมเป็นแท็บเดียว (ตกลง 4 พ.ย. 2026 · ลิงก์เดิม ?tab=premium / benefit เปิดแท็บนี้)
  //   ประกันทรัพย์สิน: ชื่อแท็บ "ชำระเบี้ย" (ไม่มีผลประโยชน์) · แท็บมูลค่าเวนคืนเฉพาะที่มีมูลค่าเวนคืน
  const TABS: [string, string][] = [["coverage", "ความคุ้มครอง"], ...(!isProp || showCv ? [["cv", "มูลค่าเวนคืน"] as [string, string]] : []),
    ["flow", isProp ? "ชำระเบี้ย" : "เบี้ยและผลประโยชน์"]];
  const askTab = sp.tab === "premium" || sp.tab === "benefit" ? "flow" : sp.tab;
  const tab = TABS.some(([k]) => k === askTab) ? (askTab as string) : "coverage";
  // แท็บ "เบี้ยและผลประโยชน์" (ตกลง 4 พ.ย. 2026 · แทนแท็บรับผลประโยชน์ + ชำระเบี้ย): ตารางเดียว · เงินจริงแทรกใต้งวด · สุทธิสะสม + จุดคุ้มทุน · IRR 3 ตัว
  //   เล่มที่มีสัญญาเพิ่มเติม (หน้ารายการหลัก · ตกลง 6 พ.ย. 2026): เบี้ยแยกคอลัมน์ ชีวิต · สุขภาพ · รวมจ่าย · งวดวันเดียวกันรวมแถวเดียว
  //   สุทธิสะสม / คุ้มทุน คิดทั้งเล่ม · IRR ของรายการหลักเหมือนเดิม + ทั้งเล่ม
  const bookParts = (bookRes?.role.parts ?? []) as BookPol[];
  const book = bookRes?.role.isMain ? bookRes : null;
  const mainId = bookRes?.role.main.id ?? id;
  const others = book ? bookParts.filter((x) => x.id !== id) : [];
  const polOf = new Map(bookParts.map((x) => [x.id, x]));
  const typeLabel = (pid: string) => PART_LABEL[(pid === id ? p.insurance_type : polOf.get(pid)?.insurance_type) ?? ""] ?? "สัญญาเพิ่มเติม";
  /** ชื่อส่วนในเล่ม · สัญญาเพิ่มเติมประเภทเดียวกับรายการหลัก = "สัญญาเพิ่มเติม" */
  const partName = (pid: string) => (pid !== mainId && typeLabel(pid) === typeLabel(mainId) ? "สัญญาเพิ่มเติม" : typeLabel(pid));
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
  const flow = runningNet(allLines, lumps.map((r) => ({ key: r.id as string, date: r.receipt_date as string, amount: Number(r.amount) })), policyActive);
  const netOf = new Map(flow.rows.map((r) => [r.key, r]));
  const flowPos = new Map(flow.rows.map((r, i) => [r.key, i]));
  const allBenefits = allLines.filter((x) => x.kind === "BENEFIT");
  const allPremiums = allLines.filter((x) => x.kind === "PREMIUM");
  const showNet = !isProp && (allBenefits.length > 0 || lumps.length > 0);
  const schedPrem = allPremiums.reduce((s2, x) => s2 + Number(x.amount), 0);
  const schedBen = allBenefits.reduce((s2, x) => s2 + Number(x.amount), 0);
  // จ่าย / รับแล้วของตาราง (ทั้งเล่ม เมื่อมีสัญญาเพิ่มเติม)
  const flowPremPaid = allPremiums.reduce((s2, x) => s2 + insCountedPaid(x), 0);
  const flowBenReceived = allBenefits.reduce((s2, x) => s2 + insCountedPaid(x), 0)
    + lumps.filter((r) => r.currency === ccy).reduce((s2, r) => s2 + Number(r.amount), 0);
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
  // เงินจริงแทรกใต้งวด (เก่า → ใหม่) · ยกเลิกการรับ: รายการล่าสุดของกรมธรรม์นั้น หรือรายการที่ไม่ได้ปิดกรมธรรม์
  const payBy = new Map<string, typeof allPays>();
  [...allPays].reverse().forEach((e) => { const k = e.insurance_schedule_line_id as string; payBy.set(k, [...(payBy.get(k) ?? []), e]); });
  const recvBy = new Map<string, typeof allReceipts>();
  [...allReceipts].reverse().forEach((r) => { if (r.line_id) recvBy.set(r.line_id, [...(recvBy.get(r.line_id) ?? []), r]); });
  const latestRecv = new Map<string, string>();
  allReceipts.forEach((r) => { if (!latestRecv.has(r.policy_id)) latestRecv.set(r.policy_id, r.id as string); });   // ใหม่ → เก่า ต่อกรมธรรม์
  type Receipt = (typeof allReceipts)[number];
  const undo = (r: Receipt) => canDelete && (latestRecv.get(r.policy_id) === r.id || !r.outcome) ? <UndoButton kind="BENEFIT" id={r.id} paths={linePaths(r.policy_id)}
    confirmText={`ยกเลิกการรับ ${money(r.amount, r.currency)} วันที่ ${thDate(r.receipt_date)} ทั้งก้อน?${r.outcome ? "\nกรมธรรม์และมูลค่าเวนคืนจะกลับเป็นสถานะก่อนรับ" : ""}`} /> : null;
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
  const payFrom = (e: (typeof allPays)[number]) =>
    `จ่ายจาก ${e.paid_from_asset_id ? bankName.get(e.paid_from_asset_id) ?? "บัญชี" : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด"}`;
  const payRows = (x: SLine, prefix = ""): FlowSub[] => (payBy.get(x.id) ?? []).map((e) => ({ key: e.id, kind: "PAY" as const, date: e.date, amount: Number(e.amount),
    detail: e.notes, part: partKey(x.policy_id), text: `${prefix}${payFrom(e)}`,
    actions: canWrite ? <RowActions table="expense_items" id={e.id} paths={payPathsOf(x.policy_id)} canDelete={canDelete} fields={premiumPaymentFields(e)} /> : null }));
  const payForm = (x: SLine) => (
    <PayPremiumForm policyId={x.policy_id} lineId={x.id} amount={Number(x.remaining)} label={payLabel(x.policy_id, x.installment_no)} currency={x.currency}
      banks={banks ?? []} cards={cards} persons={persons ?? []} defaultPerson={payerId} defaultPay={payDefault} today={today} cashValue={x.policy_id === id ? cvCtx : null} />
  );
  // งวดเดียว (ทุกงวดของกรมธรรม์ปกติ · งวดผลประโยชน์ของเล่ม) · ส่วนของสัญญาเพิ่มเติม = ชื่อส่วนนำหน้า
  const lineRow = (x: SLine): FlowRow => {
    const ben = x.kind === "BENEFIT";
    const pid = x.policy_id;
    const st = INS_SCHED_STATUS[x.status];
    const n = netOf.get(x.id);
    const paidAmt = Number(x.paid_amount);
    return {
      key: x.id, kind: ben ? "BENEFIT" : "PREMIUM", date: x.due_date, notes: x.notes, amount: Number(x.amount),
      label: `${pid === id ? "" : `${partName(pid)} · `}${ben ? `${BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"]} งวดที่ ${x.installment_no}` : `เบี้ยงวดที่ ${x.installment_no}`}`,
      statusText: ben && x.status === "PAID" ? "รับแล้ว" : ben && x.status === "SKIPPED" ? "ไม่ได้รับ" : st?.text ?? x.status, statusCls: st?.cls,
      progress: x.status === "PARTIAL" || (x.status === "CLOSED" && paidAmt > 0)
        ? `${ben ? "รับ" : "จ่าย"}แล้ว ${money(paidAmt)}${x.status === "PARTIAL" ? ` · ค้าง ${money(x.remaining)}` : ""}` : null,
      muted: ["PAID", "CLOSED", "SKIPPED", "HISTORY"].includes(x.status), next: x.id === firstOpen,
      net: showNet ? n?.net ?? null : null, projected: n?.projected, breakEven: showNet && flow.breakEven?.key === x.id,
      actions: <>
        {canWrite && INS_OPEN.includes(x.status) && (ben
          ? <BenefitForm policyId={pid} lineId={x.id} amount={Number(x.remaining)} currency={x.currency} banks={banks ?? []} persons={persons ?? []}
              hasCashValue={pid === id && !!cvAsset} cashValue={pid === id ? cvAsset?.current_value : null} today={today} small canClose={canDelete} />
          : payForm(x))}
        {canWrite && x.status !== "PAID" && <div className="mt-1"><RowActions table="insurance_schedule_lines" id={x.id} paths={linePaths(pid)} canDelete={canDelete} fields={lineFields(x, ben)} /></div>}
      </>,
      cash: ben
        ? (recvBy.get(x.id) ?? []).map((r) => ({ key: r.id, kind: "RECV" as const, date: r.receipt_date, text: recvText(r, "รับ"), detail: recvDetail(r), amount: Number(r.amount), actions: undo(r) }))
        : payRows(x),
    };
  };
  // เล่มที่มีสัญญาเพิ่มเติม: งวดเบี้ยที่ครบวันเดียวกันรวมแถวเดียว · กดยอดของส่วนไหน = แก้งวดของส่วนนั้น · ค้าง ≥ 2 ส่วน = จ่ายทั้งเล่มในครั้งเดียว
  const OPEN_ST = ["PENDING", "OVERDUE", "PARTIAL"];
  const amtNode = (x: SLine) => canWrite && x.status !== "PAID"
    ? <RowActions table="insurance_schedule_lines" id={x.id} paths={linePaths(x.policy_id)} canDelete={canDelete} fields={lineFields(x, false)} button={money(x.amount)} buttonClass={AMT} />
    : <span className="tabular-nums">{money(x.amount)}</span>;
  const mergedRow = (due: string, xs: SLine[]): FlowRow => {
    xs.sort((a, b) => partOrder(a.policy_id) - partOrder(b.policy_id) || a.installment_no - b.installment_no);
    const last = xs.reduce((a, b) => ((flowPos.get(b.id) ?? 0) > (flowPos.get(a.id) ?? 0) ? b : a));
    const n = netOf.get(last.id);
    const sts = [...new Set(xs.map((x) => x.status))];
    const anyOpen = xs.some((x) => OPEN_ST.includes(x.status));
    const status = sts.length === 1 ? sts[0] : sts.includes("OVERDUE") ? "OVERDUE"
      : anyOpen && xs.some((x) => Number(x.paid_amount) > 0) ? "PARTIAL" : anyOpen ? "PENDING" : sts.includes("PAID") ? "PAID" : sts[0];
    const st = INS_SCHED_STATUS[status];
    const paidAmt = xs.reduce((t, x) => t + Number(x.paid_amount), 0);
    const left = xs.filter((x) => OPEN_ST.includes(x.status)).reduce((t, x) => t + Number(x.remaining), 0);
    const mainLine = xs.find((x) => x.policy_id === id);
    const open = xs.filter((x) => OPEN_ST.includes(x.status) && Number(x.remaining) > 0.005);
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
      label: mainLine ? `เบี้ยงวดที่ ${mainLine.installment_no}` : `${partName(xs[0].policy_id)} งวดที่ ${xs[0].installment_no}`,
      notes: xs.filter((x) => x.notes).map((x) => (xs.length > 1 ? `${partName(x.policy_id)}: ${x.notes}` : x.notes)).join(" · ") || null,
      statusText: st?.text ?? status, statusCls: st?.cls,
      progress: status === "PARTIAL" || (status === "CLOSED" && paidAmt > 0) ? `จ่ายแล้ว ${money(paidAmt)}${status === "PARTIAL" ? ` · ค้าง ${money(left)}` : ""}` : null,
      muted: xs.every((x) => ["PAID", "CLOSED", "SKIPPED", "HISTORY"].includes(x.status)), next: xs.some((x) => x.id === firstOpen),
      net: showNet ? n?.net ?? null : null, projected: n?.projected, breakEven: showNet && xs.some((x) => flow.breakEven?.key === x.id),
      actions: canWrite && open.length > 0 ? (open.length > 1
        ? <BookletPayForm group={book?.role.key ?? ""} banks={banks ?? []} cards={cards} persons={persons ?? []} defaultPerson={payerId} defaultPay={payDefault} today={today}
            parts={open.map((x) => ({ policyId: x.policy_id, lineId: x.id, part: partName(x.policy_id), label: payLabel(x.policy_id, x.installment_no),
              amount: Number(x.remaining), currency: x.currency }))} />
        : payForm(open[0])) : null,
      cash: xs.flatMap((x) => payRows(x, manyRiders && x.policy_id !== id ? `${typeLabel(x.policy_id)} · ` : "")).sort((a, b) => a.date.localeCompare(b.date)),
    };
  };
  const byDue = new Map<string, SLine[]>();
  allPremiums.forEach((x) => byDue.set(x.due_date, [...(byDue.get(x.due_date) ?? []), x]));
  const lumpRow = (r: Receipt): FlowRow => ({ key: r.id, kind: "BENEFIT", date: r.receipt_date, label: "", amount: Number(r.amount),
    lump: { text: `${r.policy_id === id ? "" : `${partName(r.policy_id)} · `}${recvText(r, "รับเงินก้อน")}`, detail: recvDetail(r) },
    net: showNet ? netOf.get(r.id)?.net ?? null : null, breakEven: flow.breakEven?.key === r.id, actions: undo(r) });
  const pos = (k: string) => flowPos.get(k) ?? 0;
  const flowRows: FlowRow[] = ([
    ...(book
      ? [...byDue].map(([due, xs]): [number, FlowRow] => [Math.min(...xs.map((x) => pos(x.id))), mergedRow(due, xs)])
      : allPremiums.map((x): [number, FlowRow] => [pos(x.id), lineRow(x)])),
    ...allBenefits.map((x): [number, FlowRow] => [pos(x.id), lineRow(x)]),
    ...lumps.map((r): [number, FlowRow] => [pos(r.id), lumpRow(r)]),
  ] as [number, FlowRow][]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);


  // ความคุ้มครอง: ชีวิต / อุบัติเหตุที่ยังไม่ได้ใส่ชนิด "เสียชีวิต" → แถว "ตามทุนประกัน" (ไม่คัดลอกยอดไปเก็บ · ตกลง 6 พ.ย. 2026)
  //   กดแถวนั้น = บันทึกเป็นรายการจริงของเล่ม · รายการจริงที่ยอดไม่เท่าทุนประกัน → แสดงทุนประกันตัวเล็กไว้เทียบ
  type Cov = { id: string; coverage_type: string; limit_amount: number; currency: string; notes: string | null; max_count: number | null; as_of_date: string | null };
  const covTable = (pid: string, type: string, sum: number, sumCcy: string, list: Cov[]) => {
    const k = deathCoverage(type);
    const virtual = !!k && sum > 0 && !list.some((c) => c.coverage_type === k);
    if (!virtual && list.length === 0) return null;
    return (
      // คอลัมน์กว้างเท่ากันทุกส่วนของเล่ม (สัญญาหลัก / สัญญาเพิ่มเติม) → ตัวเลขตรงกันเป็นแนวเดียว
      <table className="w-full text-sm md:table-fixed">
        <colgroup><col className="md:w-48" /><col className="md:w-64" /><col /><col className="md:w-28" /></colgroup>
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
              <td className="py-1.5">{COVERAGE_LABEL[c.coverage_type]?.[0] ?? c.coverage_type}</td>
              <td className="text-right tabular-nums">{covAmount(c.coverage_type, c.limit_amount, c.currency)}{COVERAGE_LABEL[c.coverage_type]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[c.coverage_type][1]}</span>}
                {covExtra(c) && <span className="block text-xs text-slate-500">{covExtra(c)}</span>}
                {c.coverage_type === k && sum > 0 && Math.abs(Number(c.limit_amount) - sum) > 0.005 && <span className="block text-xs text-slate-500">ทุนประกัน {money(sum, sumCcy)}</span>}</td>
              <td className="pl-4 text-xs text-slate-500">{c.notes}</td>
              <td className="pl-2 text-right">{canWrite && <RowActions table="insurance_coverages" id={c.id} paths={linePaths(pid)} canDelete={canDelete} fields={[
                ...(c.coverage_type === "WAIVER" ? [] : [{ name: "limit_amount", label: c.coverage_type === "COPAY" ? "ร่วมจ่าย (%)" : "วงเงิน", type: "number" as const, value: c.limit_amount }]),
                ...(COVERAGE_COUNT_UNIT[c.coverage_type] ? [{ name: "max_count", label: `สูงสุด (${COVERAGE_COUNT_UNIT[c.coverage_type]})`, type: "number" as const, value: c.max_count }] : []),
                { name: "as_of_date", label: "ณ วันที่", type: "date" as const, value: c.as_of_date },
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
              <BenefitForm policyId={id} currency={ccy} banks={banks ?? []} persons={persons ?? []} hasCashValue={!!cvAsset}
                cashValue={cvAsset?.current_value} today={today} button="รับเงินก้อน (ครบสัญญา / เวนคืน / สินไหม)" canClose={canDelete} />
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่าเวนคืน + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าเวนคืน</div>
            {cvAsset ? (
              <>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{money(cvAsset.current_value, cvAsset.currency, 0)}</div>
                <div className="text-xs text-slate-500">ณ {thDate(cvAsset.current_value_date)}</div>
                <div className="mt-2 text-xs text-slate-600">เจ้าของ: {activeOwners.map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ") || "-"}</div>
                {p.person_id && !(activeOwners.length === 1 && activeOwners[0].person_id === p.person_id && Number(activeOwners[0].ownership_percent) === 100) && (
                  <div className="mt-1 text-xs text-amber-700">เจ้าของมูลค่าเวนคืนไม่ใช่ผู้เอาประกัน 100% — ตรวจว่าถูกต้อง</div>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-500">{p.has_cash_value ? "ยังไม่มีมูลค่า" : "ไม่มี (ไม่นับเป็นสินทรัพย์)"}</p>
                {canDelete && <div className="mt-2"><AddCashValueForm policyId={id} currency={ccy} today={today} goLive={family?.go_live_date ?? ""} /></div>}
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
            {showCv && (
              <div className="mt-3 flex flex-wrap gap-2">
                {cvAsset && (
                  <ModalButton label="ปรับมูลค่า / ประวัติ" title="มูลค่าเวนคืน · ปรับมูลค่า / ประวัติ" size="lg" primary>
                    <div className="space-y-5">
                      {cvUpdate}
                      <div className="border-t border-slate-100 pt-3">
                        <h3 className="mb-1 text-sm font-medium text-slate-800">ประวัติมูลค่า</h3>
                        {cvHistory}
                      </div>
                    </div>
                  </ModalButton>
                )}
                {cvRows.length > 0 ? (
                  <ModalButton label={<>ตารางตามสัญญา ({cvRows.length} ปี){cvPending && <span className="ml-1 text-amber-700">●</span>}</>} title="ตารางมูลค่าเวนคืนตามสัญญา" size="lg">
                    <div className="space-y-3">
                      {cvContract}
                    </div>
                  </ModalButton>
                ) : canDelete && <CashValueTableEditor policyId={id} startDate={startIso} current={[]} />}
              </div>
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
                <Item label="ประเภท">{TYPE[p.insurance_type] ?? p.insurance_type}</Item>
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
                        <span className="text-slate-500"> · {x.id === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม"} · ทุน {money(x.insured_amount, x.insured_amount_currency ?? undefined, 0)}
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
                    end_date: p.end_date, insured_amount: p.insured_amount, premium: p.premium, notes: p.notes, pay_default: payDefault, insurance_type: p.insurance_type }} booklet={others.length > 0} />
                </WithStatus>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้รับผลประโยชน์</h3>
                  <BeneficiaryEditor policyId={id} persons={persons ?? []} startOpen
                    current={(bens ?? []).map((b) => ({ person_id: b.person_id, name: b.beneficiary_name, percent: Number(b.percentage) }))} />
                </div>
                {others.map((o) => (
                  <div key={o.id} className="border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium text-slate-800">สัญญาเพิ่มเติม · {typeLabel(o.id)}</h3>
                    <WithStatus status={{ table: "insurance_policies", id: o.id, value: o.status, paths: linePaths(o.id), label: "สถานะสัญญาเพิ่มเติม",
                      options: INS_STATUS,
                      remove: canDelete ? { kind: "policy", id: o.id, redirectTo: `/insurance/${id}`, paths: linePaths(o.id), label: "ลบสัญญาเพิ่มเติมนี้",
                        hint: "งวดเบี้ย ความคุ้มครอง และเคลมของส่วนนี้จะถูกลบด้วย" } : undefined }}>
                      <PolicyInfoForm policyId={o.id} persons={persons ?? []} showInsured banks={banks ?? []} cards={cards} currency={o.premium_currency ?? o.insured_amount_currency ?? "THB"} v={{
                        person_id: o.person_id, payer_person_id: o.payer_person_id, insurer: o.insurer ?? "", policy_no: o.policy_no, start_date: o.start_date,
                        end_date: o.end_date, insured_amount: o.insured_amount, premium: o.premium, notes: o.notes, pay_default: payDefaultValue(o), insurance_type: o.insurance_type }} part />
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

      <TabsProvider initial={tab} defaultKey="coverage">
        <div className="space-y-4">
          <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>
          <TabPanel id="coverage" className="space-y-4">
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium text-slate-900">ความคุ้มครอง</h2>
                {canWrite && <CoverageEditor parts={(book ? bookParts : [p]).map((x) => ({ id: x.id, label: book ? `${x.id === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม"} · ${typeLabel(x.id)}` : null,
                  insType: x.insurance_type, sum: Number(x.insured_amount ?? 0), currency: x.insured_amount_currency ?? x.premium_currency ?? ccy,
                  existing: x.id === id ? (covs ?? []) : (book?.covs ?? []).filter((c) => c.policy_id === x.id) }))} />}
              </div>
              {book && <h3 className="text-sm font-medium text-slate-800">สัญญาหลัก · {partName(id)}</h3>}
              {covTable(id, p.insurance_type, Number(p.insured_amount ?? 0), p.insured_amount_currency ?? ccy, covs ?? [])
                ?? <p className="text-sm text-slate-500">ยังไม่ได้ใส่รายการความคุ้มครอง (ใช้สรุปสิทธิ์รายคนในหน้า Insurance)</p>}
              {others.map((o) => (
                <div key={o.id} className="space-y-2 border-t border-slate-100 pt-3">
                  <h3 className="text-sm font-medium text-slate-800">สัญญาเพิ่มเติม · {typeLabel(o.id)}
                    <span className="ml-2 text-xs font-normal text-slate-500">ทุน {money(o.insured_amount, o.insured_amount_currency ?? undefined, 0)} · เบี้ย {money(o.premium, o.premium_currency ?? undefined, 0)} / ปี</span>
                  </h3>
                  {covTable(o.id, o.insurance_type, Number(o.insured_amount ?? 0), o.insured_amount_currency ?? ccy, (book?.covs ?? []).filter((c) => c.policy_id === o.id))
                    ?? <p className="text-sm text-slate-500">ยังไม่ได้ใส่รายการความคุ้มครอง</p>}
                </div>
              ))}
            </section>
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium text-slate-900">เคลม <InfoTip label="คำอธิบาย">เมื่อได้เงินคืน: ไปที่ Income &amp; Expenses → ค่าใช้จ่ายที่ตั้ง &ldquo;ได้เงินคืน&rdquo; → บันทึกเงินคืน แล้วเลือก &ldquo;จากเคลมประกัน&rdquo; · ยอด &ldquo;ได้รับ&rdquo; และสถานะเคลม (จ่ายบางส่วน / จ่ายครบ) จะอัปเดตให้อัตโนมัติ</InfoTip></h2>
                {canWrite && policyActive && <ClaimForm policyId={id} currency={ccy} today={today}
                  parts={book ? bookParts.filter((x) => x.status === "ACTIVE").map((x) => ({ id: x.id, label: `${x.id === mainId ? "สัญญาหลัก" : "สัญญาเพิ่มเติม"} · ${typeLabel(x.id)}` })) : undefined}
                  coverages={[...(covs ?? []).map((c) => ({ ...c, policy_id: id })), ...(book?.covs ?? [])].map((c) => ({ id: c.id, policy_id: c.policy_id, coverage_type: c.coverage_type,
                    limit_amount: Number(c.limit_amount), part: book ? typeLabel(c.policy_id) : undefined }))} />}
              </div>
              {(claims ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเคลม</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">ยื่นเคลม</th><th>เกิดเหตุ</th>{book && <th>ส่วน</th>}<th className="text-right">ยอดเคลม</th><th className="text-right">ได้รับ</th><th className="pl-4">สถานะ</th><th></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(claims ?? []).map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="py-1.5">{thDate(c.claim_date)}</td><td>{thDate(c.incident_date)}</td>{book && <td>{typeLabel(c.policy_id)}</td>}
                        <td className="text-right tabular-nums">{money(c.claimed_amount, c.currency)}</td>
                        <td className="text-right tabular-nums">{c.received_amount != null ? money(c.received_amount) : "-"}</td>
                        <td className="pl-4">{CSTATUS[c.status] ?? c.status}{c.notes && <div className="text-xs text-slate-500">{c.notes}</div>}
                          {(byClaim.get(c.id) ?? []).map((r) => {
                            const e = (Array.isArray(r.expense_items) ? r.expense_items[0] : r.expense_items) as { description: string; date: string } | null;
                            return <div key={r.id} className="text-xs text-emerald-700">รับคืน {thDate(r.received_date)} {money(r.amount, r.currency)}{e && ` · ${e.description} (${thDate(e.date)})`}</div>;
                          })}
                        </td>
                        <td className="pl-2 text-right">
                          {canWrite && <RowActions table="insurance_claims" id={c.id} paths={paths} canDelete={canDelete} fields={[
                            { name: "claim_date", label: "ยื่นเคลม", type: "date", value: c.claim_date },
                            { name: "claimed_amount", label: "ยอดเคลม", type: "number", value: c.claimed_amount },
                            { name: "received_amount", label: "ได้รับ", type: "number", value: c.received_amount },
                            { name: "status", label: "สถานะ", type: "select", value: c.status, options: CLAIM_STATUS },
                            { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-40" }]} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </TabPanel>
          {TABS.some(([k]) => k === "cv") && (
            <TabPanel id="cv">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className={BOX}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-medium text-slate-900">ประวัติมูลค่าเวนคืน</h2>
                    {cvUpdate && <ModalButton label="อัปเดตมูลค่า" title="มูลค่าเวนคืน · อัปเดตมูลค่า" primary>{cvUpdate}</ModalButton>}
                  </div>
                  {cvAsset ? cvHistory : (
                    <>
                      <p className="text-sm text-slate-500">{p.has_cash_value ? "ยังไม่มีมูลค่า" : "กรมธรรม์นี้ไม่มีมูลค่าเวนคืน (ไม่นับเป็นสินทรัพย์)"}</p>
                      {canDelete && <AddCashValueForm policyId={id} currency={ccy} today={today} goLive={family?.go_live_date ?? ""} />}
                    </>
                  )}
                </section>
                <section className={BOX}>
                  <h2 className="font-medium text-slate-900">ตารางมูลค่าเวนคืนตามสัญญา{cvRows.length > 0 && <span className="ml-1 text-sm font-normal text-slate-500">({cvRows.length} ปี)</span>}</h2>
                  {cvRows.length > 0 ? cvContract : (
                    <>
                      <p className="text-sm text-slate-500">ยังไม่ได้ใส่ตาราง · ใส่มูลค่าสิ้นปีกรมธรรม์จากเล่มกรมธรรม์ แล้วระบบลงมูลค่าเวนคืนให้เองเมื่อถึงวันครบปี</p>
                      {canDelete && <CashValueTableEditor policyId={id} startDate={startIso} current={[]} />}
                    </>
                  )}
                </section>
              </div>
            </TabPanel>
          )}
          <TabPanel id="flow">
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <ActionBar right={canDelete && policyActive ? <div className="flex flex-wrap justify-end gap-2">
                  <InsScheduleEditor policyId={id} kind="PREMIUM" currency={ccy} current={premiums} goLive={family?.go_live_date ?? null} part={book ? partName(id) : undefined}
                    defaultAmount={Number(p.premium ?? 0)} defaultFirstDue={lastDue(premiums) ? addMonthsKeepDay(lastDue(premiums) as string, 12) : (p.start_date ?? today)} />
                  {others.filter((o) => o.status === "ACTIVE").map((o) => {
                    const xs = allPremiums.filter((x) => x.policy_id === o.id);
                    return <InsScheduleEditor key={o.id} policyId={o.id} kind="PREMIUM" currency={o.premium_currency ?? ccy} current={xs} goLive={family?.go_live_date ?? null}
                      part={partName(o.id)} defaultAmount={Number(o.premium ?? 0)}
                      defaultFirstDue={lastDue(xs) ? addMonthsKeepDay(lastDue(xs) as string, 12) : (o.start_date ?? p.start_date ?? today)} />;
                  })}
                  {!isProp && <InsScheduleEditor policyId={id} kind="BENEFIT" currency={ccy} current={benefits} goLive={family?.go_live_date ?? null}
                    defaultFirstDue={p.start_date ? addMonthsKeepDay(p.start_date, 24) : today} />}
                </div> : undefined}>
                <div className="space-y-0.5">
                  <h2 className="font-medium text-slate-900">{isProp ? "ตารางเบี้ย" : "เบี้ยและผลประโยชน์"}{showIrr && <> <InfoTip label="คำอธิบาย">IRR = ผลตอบแทนต่อปีคิดตามวันที่จริงของแต่ละรายการ (XIRR) · ยังไม่รวมภาษีที่ลดหย่อนได้จากเบี้ย</InfoTip></>}</h2>
                  {premiums.length > 0 ? (
                    <p className="text-sm text-slate-600">เบี้ย {premiums.length} งวด · จ่ายถึงปี {lastYear(premiums)} ({thDate(lastDue(premiums))}) · เหลือ {leftCount(premiums)} งวด
                      {premNext && <> · งวดถัดไป {thDate(premNext.due_date)} {money(premNext.remaining)}</>}
                      {premOverdue.length > 0 && <span className="text-red-600"> · เลยกำหนด {premOverdue.length} งวด</span>}
                      {payerId && <> · ผู้จ่าย {allName.get(payerId)}</>}</p>
                  ) : <p className="text-sm text-slate-500">ยังไม่ได้ตั้งตารางเบี้ย — ตั้งแล้วจะขึ้นใน Income &amp; Expenses → ค่าใช้จ่ายที่ต้องจ่าย</p>}
                  {others.map((o) => {
                    const xs = allPremiums.filter((x) => x.policy_id === o.id);
                    return (
                      <p key={o.id} className="text-sm text-slate-600">
                        สัญญาเพิ่มเติม · {typeLabel(o.id)}
                        {xs.length > 0 ? <> · เบี้ย {xs.length} งวด · จ่ายถึงปี {lastYear(xs)} ({thDate(lastDue(xs))}) · เหลือ {leftCount(xs)} งวด</> : " · ยังไม่ได้ตั้งตารางเบี้ย"}
                      </p>
                    );
                  })}
                  {!isProp && (benefits.length > 0
                    ? <p className="text-sm text-slate-600">ผลประโยชน์ {benefits.length} งวด · รับถึงปี {lastYear(benefits)} ({thDate(lastDue(benefits))}) · เหลือ {leftCount(benefits)} งวด</p>
                    : <p className="text-sm text-slate-500">ผลประโยชน์รายงวด (เงินคืน / บำนาญ / ครบสัญญา) ตั้งเป็นตาราง · ก้อนเดียวที่ไม่อยู่ในตาราง (เวนคืน / สินไหม) กดปุ่ม &ldquo;รับเงินก้อน&rdquo; ด้านบน</p>)}
                  {cvAsset && !isProp && <p className="text-xs text-slate-500">มีมูลค่าเวนคืน: เงินที่รับถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินนับเป็นรายได้</p>}
                </div>
              </ActionBar>
              {showNet && (
                <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">จ่ายเบี้ยแล้ว{book && " (ทั้งเล่ม)"}</dt><dd className="tabular-nums">{money(flowPremPaid, ccy)}</dd>
                    {book && <dd className="text-xs text-slate-500">{bookParts.map((x) => `${partName(x.id)} ${money(allPremiums.filter((l) => l.policy_id === x.id).reduce((t, l) => t + insCountedPaid(l), 0), undefined, 0)}`).join(" · ")}</dd>}</div>
                  <div><dt className="text-xs text-slate-500">รับผลประโยชน์แล้ว</dt><dd className="tabular-nums">{money(flowBenReceived, ccy)}</dd></div>
                  <div><dt className="text-xs text-slate-500">สุทธิถึงวันนี้</dt>
                    <dd className={`tabular-nums ${flowBenReceived - flowPremPaid >= -0.005 ? "text-emerald-700" : "text-red-700"}`}>{signedMoney(flowBenReceived - flowPremPaid, ccy)}</dd></div>
                  <div><dt className="text-xs text-slate-500">จุดคุ้มทุน</dt>
                    <dd>{flow.breakEven ? <span className="text-emerald-700">{thDate(flow.breakEven.date)}{flow.breakEven.projected && <span className="text-xs text-slate-500"> (คาดการณ์)</span>}</span>
                      : <span className="text-slate-500">ไม่ถึงตามตาราง{flow.final < -0.005 && <span className="text-xs"> · ขาด {money(-flow.final)}</span>}</span>}</dd></div>
                  <div className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">ตามตารางทั้งหมด{book && " (ทั้งเล่ม)"}: เบี้ย {money(schedPrem, ccy)} · ผลประโยชน์ {money(schedBen, ccy)}
                    {book && " · สุทธิสะสมและจุดคุ้มทุนคิดจากเบี้ยรวมทั้งเล่ม"}
                    {!flow.breakEven && allBenefits.every((x) => x.benefit_type !== "MATURITY") && " · ถ้ามีเงินครบสัญญา ใส่ในตารางผลประโยชน์ (ชนิด ครบสัญญา) เพื่อให้เห็นจุดคุ้มทุน"}</div>
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
              {flowRows.length > 0 && <FlowTable rows={flowRows} showNet={showNet} currency={ccy} parts={flowParts} />}
            </section>
          </TabPanel>
        </div>
      </TabsProvider>
    </div>
  );
}
