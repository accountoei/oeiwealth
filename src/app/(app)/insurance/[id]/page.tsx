import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  BENEFIT_TYPE_LABEL, CLAIM_STATUS, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_SCHED_STATUS, INS_STATUS, INS_TYPE, insCountedPaid, money,
  signedMoney, signedPct, thDate, todayBangkok,
} from "@/lib/format";
import { contractFlows, projectedFlows, runningNet, surrenderFlows, xirr, type FlowCash } from "@/lib/insurance-flow";
import FlowTable, { type FlowRow } from "./FlowTable";
import { addMonthsKeepDay } from "@/lib/loan-schedule";
import { AddCashValueForm, BenefitForm, CashValueTableEditor, CoverageForm, PayPremiumForm, PolicyInfoForm, SyncCashValueButton } from "./ins-forms";
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

const BOX = "space-y-3 rounded-xl border border-slate-200 bg-white p-5";

export default async function PolicyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data: p } = await supabase.from("v_insurance_status").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const cvId: string | null = p.cash_value_asset_id;
  const [{ data: bens }, { data: claims }, { data: persons }, { data: family }, { data: cvAsset }, { data: cvVals }, { data: owners }, { data: insured }] = await Promise.all([
    supabase.from("insurance_beneficiaries").select("id,person_id,beneficiary_name,percentage,persons(name)").eq("policy_id", id).is("deleted_at", null),
    supabase.from("insurance_claims").select("*").eq("policy_id", id).is("deleted_at", null).order("claim_date", { ascending: false }),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    cvId ? supabase.from("assets").select("id,current_value,current_value_date,currency").eq("id", cvId).maybeSingle() : Promise.resolve({ data: null }),
    cvId ? supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", cvId).is("deleted_at", null).order("valuation_date", { ascending: false }) : Promise.resolve({ data: null }),
    cvId ? supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", cvId) : Promise.resolve({ data: null }),
    p.asset_id ? supabase.from("assets").select("name,asset_group").eq("id", p.asset_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const [{ data: linesRaw }, { data: covs }, { data: fups }, { data: banks }, { data: cardsRaw }, { data: allPersons }, { data: cvTable }] = await Promise.all([
    supabase.from("v_insurance_schedule_status").select("id,kind,installment_no,due_date,amount,currency,benefit_type,notes,paid_amount,remaining,status,skipped")
      .eq("policy_id", id).order("due_date").order("installment_no"),
    supabase.from("insurance_coverages").select("id,coverage_type,limit_amount,currency,notes").eq("policy_id", id).is("deleted_at", null).order("created_at"),
    supabase.from("insurance_followups").select("id,person_id,role,action,status,notes").eq("policy_id", id).is("deleted_at", null).order("created_at"),
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
    ? await supabase.from("expense_items").select("id,date,amount,currency,paid_from_asset_id,paid_from_credit_card_id,insurance_schedule_line_id,notes")
        .in("insurance_schedule_line_id", premiums.map((x) => x.id)).is("deleted_at", null).order("date", { ascending: false })
    : { data: [] };
  const { data: receipts } = await supabase.from("insurance_benefit_receipts")
    .select("id,line_id,receipt_date,amount,currency,bank_asset_id,cash_value_part,income_part,outcome,notes,created_at")
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
  const showCv = !!cvAsset || cvRows.length > 0 || !!p.has_cash_value || p.insurance_type === "LIFE";
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
  const lumps = (receipts ?? []).filter((r) => !r.line_id);
  const flow = runningNet(lines, lumps.map((r) => ({ key: r.id as string, date: r.receipt_date as string, amount: Number(r.amount) })), policyActive);
  const netOf = new Map(flow.rows.map((r) => [r.key, r]));
  const flowPos = new Map(flow.rows.map((r, i) => [r.key, i]));
  const showNet = !isProp && (benefits.length > 0 || lumps.length > 0);
  const schedPrem = premiums.reduce((s2, x) => s2 + Number(x.amount), 0);
  const schedBen = benefits.reduce((s2, x) => s2 + Number(x.amount), 0);
  const flowCcy = lines[0]?.currency ?? ccy;
  const flowCash: FlowCash[] = [
    ...(premPays ?? []).map((e) => ({ kind: "PREMIUM" as const, line_id: e.insurance_schedule_line_id as string | null, date: e.date as string, amount: Number(e.amount), currency: e.currency as string })),
    ...(receipts ?? []).map((r) => ({ kind: "BENEFIT" as const, line_id: r.line_id as string | null, date: r.receipt_date as string, amount: Number(r.amount), currency: r.currency as string })),
  ];
  const mixedCcy = lines.some((x) => x.currency !== flowCcy) || flowCash.some((c) => c.currency !== flowCcy);
  const cvFlow = cvAsset && cvAsset.current_value != null && cvAsset.currency === flowCcy ? Number(cvAsset.current_value) : null;
  const showIrr = !isProp && premiums.length > 0 && (showNet || cvFlow != null);
  const irrWhy = mixedCcy ? "หลายสกุลเงิน คำนวณไม่ได้" : null;
  const irrBoxes: { label: string; value: number | null; sub: string; why: string }[] = [
    { label: "ตามสัญญา", value: mixedCcy ? null : xirr(contractFlows(lines)), sub: "ทุกงวดในตาราง ตามวันครบกำหนด",
      why: irrWhy ?? (benefits.length === 0 ? "ยังไม่มีตารางผลประโยชน์" : "คำนวณไม่ได้") },
    { label: policyActive ? "คาดการณ์" : "จริง", value: mixedCcy ? null : xirr(projectedFlows(lines, flowCash, today, policyActive)),
      sub: policyActive ? "จ่าย / รับจริง + งวดที่เหลือตามตาราง" : "จากเงินที่จ่าย / รับจริง (กรมธรรม์จบแล้ว)",
      why: irrWhy ?? "ยังไม่มีเงินรับ ทั้งที่รับแล้วและในตาราง" },
    ...(policyActive && cvFlow != null ? [{ label: "ถ้าเวนคืนวันนี้", value: mixedCcy ? null : xirr(surrenderFlows(lines, flowCash, today, cvFlow)),
      sub: `เงินจริงถึงวันนี้ + มูลค่าเวนคืน ${money(cvFlow, undefined, 0)} (${thDate(cvAsset?.current_value_date)})`, why: irrWhy ?? "ยังไม่ได้จ่ายเบี้ย" }] : []),
  ];
  // เงินจริงแทรกใต้งวด (เก่า → ใหม่) · ยกเลิกการรับ: รายการล่าสุด หรือรายการที่ไม่ได้ปิดกรมธรรม์
  const payBy = new Map<string, NonNullable<typeof premPays>>();
  [...(premPays ?? [])].reverse().forEach((e) => { const k = e.insurance_schedule_line_id as string; payBy.set(k, [...(payBy.get(k) ?? []), e]); });
  const recvBy = new Map<string, NonNullable<typeof receipts>>();
  [...(receipts ?? [])].reverse().forEach((r) => { if (r.line_id) recvBy.set(r.line_id, [...(recvBy.get(r.line_id) ?? []), r]); });
  const recvIdx = new Map((receipts ?? []).map((r, i) => [r.id as string, i]));
  type Receipt = NonNullable<typeof receipts>[number];
  const undo = (r: Receipt) => canDelete && (recvIdx.get(r.id) === 0 || !r.outcome) ? <UndoButton kind="BENEFIT" id={r.id} paths={paths}
    confirmText={`ยกเลิกการรับ ${money(r.amount, r.currency)} วันที่ ${thDate(r.receipt_date)} ทั้งก้อน?${r.outcome ? "\nกรมธรรม์และมูลค่าเวนคืนจะกลับเป็นสถานะก่อนรับ" : ""}`} /> : null;
  const recvDetail = (r: Receipt) => [Number(r.cash_value_part) > 0 ? `จากมูลค่าเวนคืน ${money(r.cash_value_part)}` : null,
    Number(r.income_part) > 0 ? `รายได้ ${money(r.income_part)}` : null, r.notes].filter(Boolean).join(" · ") || null;
  const recvText = (r: Receipt, first: string) => [r.outcome ? OUTCOME[r.outcome] ?? r.outcome : first, r.bank_asset_id ? `เข้า ${bankName.get(r.bank_asset_id) ?? "บัญชี"}` : null].filter(Boolean).join(" · ");
  const firstOpen = lines.find((x) => INS_OPEN.includes(x.status))?.id;
  const lineFields = (x: Line, ben: boolean) => [
    { name: "due_date", label: "ครบกำหนด", type: "date" as const, value: x.due_date },
    { name: "amount", label: "ยอด", type: "number" as const, value: x.amount },
    ...(Number(x.paid_amount) === 0 ? [{ name: "skipped", label: ben ? "ได้รับจริงไหม" : "จ่ายจริงไหม", type: "select" as const, value: x.skipped ? "true" : "false",
      options: [["false", ben ? "ได้รับ / รอรับ" : "จ่าย / รอจ่าย"], ["true", ben ? "ไม่ได้รับ" : "ไม่ได้จ่าย"]] as [string, string][] }] : []),
    { name: "notes", label: "หมายเหตุ", value: x.notes, width: "w-40" }];
  const flowRows: FlowRow[] = [
    ...lines.map((x): FlowRow => {
      const ben = x.kind === "BENEFIT";
      const st = INS_SCHED_STATUS[x.status];
      const n = netOf.get(x.id);
      const paidAmt = Number(x.paid_amount);
      return {
        key: x.id, kind: ben ? "BENEFIT" : "PREMIUM", date: x.due_date, notes: x.notes, amount: Number(x.amount),
        label: ben ? `${BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"]} งวดที่ ${x.installment_no}` : `เบี้ยงวดที่ ${x.installment_no}`,
        statusText: ben && x.status === "PAID" ? "รับแล้ว" : ben && x.status === "SKIPPED" ? "ไม่ได้รับ" : st?.text ?? x.status, statusCls: st?.cls,
        progress: x.status === "PARTIAL" || (x.status === "CLOSED" && paidAmt > 0)
          ? `${ben ? "รับ" : "จ่าย"}แล้ว ${money(paidAmt)}${x.status === "PARTIAL" ? ` · ค้าง ${money(x.remaining)}` : ""}` : null,
        muted: ["PAID", "CLOSED", "SKIPPED", "HISTORY"].includes(x.status), next: x.id === firstOpen,
        net: showNet ? n?.net ?? null : null, projected: n?.projected, breakEven: showNet && flow.breakEven?.key === x.id,
        actions: <>
          {canWrite && INS_OPEN.includes(x.status) && (ben
            ? <BenefitForm policyId={id} lineId={x.id} amount={Number(x.remaining)} currency={x.currency} banks={banks ?? []} persons={persons ?? []}
                hasCashValue={!!cvAsset} cashValue={cvAsset?.current_value} today={today} small canClose={canDelete} />
            : <PayPremiumForm policyId={id} lineId={x.id} amount={Number(x.remaining)} label={`${policyLabel} งวดที่ ${x.installment_no}`} currency={x.currency}
                banks={banks ?? []} cards={cards} persons={persons ?? []} defaultPerson={payerId} defaultPay={payDefault} today={today} cashValue={cvCtx} />)}
          {canWrite && x.status !== "PAID" && <div className="mt-1"><RowActions table="insurance_schedule_lines" id={x.id} paths={paths} canDelete={canDelete} fields={lineFields(x, ben)} /></div>}
        </>,
        cash: ben
          ? (recvBy.get(x.id) ?? []).map((r) => ({ key: r.id, kind: "RECV" as const, date: r.receipt_date, text: recvText(r, "รับ"), detail: recvDetail(r), amount: Number(r.amount), actions: undo(r) }))
          : (payBy.get(x.id) ?? []).map((e) => ({ key: e.id, kind: "PAY" as const, date: e.date, amount: Number(e.amount), detail: e.notes,
              text: `จ่ายจาก ${e.paid_from_asset_id ? bankName.get(e.paid_from_asset_id) ?? "บัญชี" : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}` : "เงินสด"}`,
              actions: canWrite ? <RowActions table="expense_items" id={e.id} paths={payPaths} canDelete={canDelete} fields={premiumPaymentFields(e)} /> : null })),
      };
    }),
    ...lumps.map((r): FlowRow => ({ key: r.id, kind: "BENEFIT", date: r.receipt_date, label: "", amount: Number(r.amount),
      lump: { text: recvText(r, "รับเงินก้อน"), detail: recvDetail(r) },
      net: showNet ? netOf.get(r.id)?.net ?? null : null, breakEven: flow.breakEven?.key === r.id, actions: undo(r) })),
  ].sort((a, b) => (flowPos.get(a.key) ?? 0) - (flowPos.get(b.key) ?? 0));


  return (
    <div className="space-y-6">
      <div>
        <Link href="/insurance" className="text-sm text-slate-500 hover:underline">← Insurance</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{p.insurer}{p.policy_no && ` · ${p.policy_no}`}</h1>
            <p className="text-sm text-slate-500">{TYPE[p.insurance_type] ?? p.insurance_type}
              {p.person_id && ` · ผู้เอาประกัน ${allName.get(p.person_id) ?? ""}`}
              {insured && <> · คุ้มครอง <Link href={insuredHref} className="hover:underline">{insured.name}</Link></>}</p>
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
              เบี้ย {money(p.premium, p.premium_currency ?? undefined, 0)} / ปี{premNext && <> · งวดถัดไป {thDate(premNext.due_date)}</>}
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
                    end_date: p.end_date, insured_amount: p.insured_amount, premium: p.premium, notes: p.notes, pay_default: payDefault }} />
                </WithStatus>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">ผู้รับผลประโยชน์</h3>
                  <BeneficiaryEditor policyId={id} persons={persons ?? []} startOpen
                    current={(bens ?? []).map((b) => ({ person_id: b.person_id, name: b.beneficiary_name, percent: Number(b.percentage) }))} />
                </div>
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
                {canWrite && <CoverageForm policyId={id} currency={ccy} />}
              </div>
              {(covs ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่ได้ใส่รายการความคุ้มครอง (ใช้สรุปสิทธิ์รายคนในหน้า Insurance)</p> : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {(covs ?? []).map((c) => (
                      <tr key={c.id}>
                        <td className="py-1.5">{COVERAGE_LABEL[c.coverage_type]?.[0] ?? c.coverage_type}</td>
                        <td className="text-right tabular-nums">{money(c.limit_amount, c.currency)}{COVERAGE_LABEL[c.coverage_type]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[c.coverage_type][1]}</span>}</td>
                        <td className="pl-4 text-xs text-slate-500">{c.notes}</td>
                        <td className="pl-2 text-right">{canWrite && <RowActions table="insurance_coverages" id={c.id} paths={paths} canDelete={canDelete} fields={[
                          { name: "limit_amount", label: "วงเงิน", type: "number", value: c.limit_amount }, { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-48" }]} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium text-slate-900">เคลม <InfoTip label="คำอธิบาย">เมื่อได้เงินคืน: ไปที่ Income &amp; Expenses → ค่าใช้จ่ายที่ตั้ง &ldquo;ได้เงินคืน&rdquo; → บันทึกเงินคืน แล้วเลือก &ldquo;จากเคลมประกัน&rdquo; · ยอด &ldquo;ได้รับ&rdquo; และสถานะเคลม (จ่ายบางส่วน / จ่ายครบ) จะอัปเดตให้อัตโนมัติ</InfoTip></h2>
                {canWrite && policyActive && <ClaimForm policyId={id} currency={ccy} today={today}
                  coverages={(covs ?? []).map((c) => ({ id: c.id, coverage_type: c.coverage_type, limit_amount: Number(c.limit_amount) }))} />}
              </div>
              {(claims ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเคลม</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">ยื่นเคลม</th><th>เกิดเหตุ</th><th className="text-right">ยอดเคลม</th><th className="text-right">ได้รับ</th><th className="pl-4">สถานะ</th><th></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(claims ?? []).map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="py-1.5">{thDate(c.claim_date)}</td><td>{thDate(c.incident_date)}</td>
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
                  <InsScheduleEditor policyId={id} kind="PREMIUM" currency={ccy} current={premiums} goLive={family?.go_live_date ?? null}
                    defaultAmount={Number(p.premium ?? 0)} defaultFirstDue={lastDue(premiums) ? addMonthsKeepDay(lastDue(premiums) as string, 12) : (p.start_date ?? today)} />
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
                  {!isProp && (benefits.length > 0
                    ? <p className="text-sm text-slate-600">ผลประโยชน์ {benefits.length} งวด · รับถึงปี {lastYear(benefits)} ({thDate(lastDue(benefits))}) · เหลือ {leftCount(benefits)} งวด</p>
                    : <p className="text-sm text-slate-500">ผลประโยชน์รายงวด (เงินคืน / บำนาญ / ครบสัญญา) ตั้งเป็นตาราง · ก้อนเดียวที่ไม่อยู่ในตาราง (เวนคืน / สินไหม) กดปุ่ม &ldquo;รับเงินก้อน&rdquo; ด้านบน</p>)}
                  {cvAsset && !isProp && <p className="text-xs text-slate-500">มีมูลค่าเวนคืน: เงินที่รับถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินนับเป็นรายได้</p>}
                </div>
              </ActionBar>
              {showNet && (
                <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">จ่ายเบี้ยแล้ว</dt><dd className="tabular-nums">{money(premPaid, ccy)}</dd></div>
                  <div><dt className="text-xs text-slate-500">รับผลประโยชน์แล้ว</dt><dd className="tabular-nums">{money(benReceived, ccy)}</dd></div>
                  <div><dt className="text-xs text-slate-500">สุทธิถึงวันนี้</dt>
                    <dd className={`tabular-nums ${benReceived - premPaid >= -0.005 ? "text-emerald-700" : "text-red-700"}`}>{signedMoney(benReceived - premPaid, ccy)}</dd></div>
                  <div><dt className="text-xs text-slate-500">จุดคุ้มทุน</dt>
                    <dd>{flow.breakEven ? <span className="text-emerald-700">{thDate(flow.breakEven.date)}{flow.breakEven.projected && <span className="text-xs text-slate-500"> (คาดการณ์)</span>}</span>
                      : <span className="text-slate-500">ไม่ถึงตามตาราง{flow.final < -0.005 && <span className="text-xs"> · ขาด {money(-flow.final)}</span>}</span>}</dd></div>
                  <div className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">ตามตารางทั้งหมด: เบี้ย {money(schedPrem, ccy)} · ผลประโยชน์ {money(schedBen, ccy)}
                    {!flow.breakEven && benefits.every((x) => x.benefit_type !== "MATURITY") && " · ถ้ามีเงินครบสัญญา ใส่ในตารางผลประโยชน์ (ชนิด ครบสัญญา) เพื่อให้เห็นจุดคุ้มทุน"}</div>
                </dl>
              )}
              {showIrr && (
                <div className="space-y-1">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {irrBoxes.map((b) => (
                      <div key={b.label} className="rounded-lg border border-slate-200 px-3 py-2">
                        <div className="text-xs text-slate-500">IRR {b.label}</div>
                        <div className={`text-lg font-semibold tabular-nums ${b.value == null ? "text-slate-400" : b.value < 0 ? "text-red-600" : "text-slate-900"}`}>
                          {b.value == null ? "–" : `${signedPct(b.value * 100)} / ปี`}</div>
                        <div className="text-xs text-slate-500">{b.value == null ? b.why : b.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {flowRows.length > 0 && <FlowTable rows={flowRows} showNet={showNet} currency={ccy} />}
            </section>
          </TabPanel>
        </div>
      </TabsProvider>
    </div>
  );
}
