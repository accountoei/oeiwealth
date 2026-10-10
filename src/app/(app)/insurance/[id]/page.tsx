import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  BENEFIT_TYPE_LABEL, CLAIM_STATUS, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_SCHED_STATUS, INS_STATUS, INS_TYPE, money, thDate, todayBangkok,
} from "@/lib/format";
import { addMonthsKeepDay } from "@/lib/loan-schedule";
import { BenefitForm, CoverageForm, InsScheduleEditor, PayPremiumForm } from "./ins-forms";
import BeneficiaryEditor from "../Beneficiaries";
import ClaimForm from "./ClaimForm";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";
import EntityDocuments from "@/components/docs/EntityDocuments";

const TYPE = Object.fromEntries(INS_TYPE);
const CSTATUS = Object.fromEntries(CLAIM_STATUS);
type Line = { id: string; kind: string; installment_no: number; due_date: string; amount: number; currency: string; benefit_type: string | null;
  notes: string | null; paid_amount: number; remaining: number; status: string };

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data: p } = await supabase.from("v_insurance_status").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const cvId: string | null = p.cash_value_asset_id;
  const [{ data: bens }, { data: claims }, { data: persons }, { data: family }, { data: cvAsset }, { data: cvVals }, { data: owners }, { data: insured }] = await Promise.all([
    supabase.from("insurance_beneficiaries").select("id,person_id,beneficiary_name,percentage,persons(name)").eq("policy_id", id).is("deleted_at", null),
    supabase.from("insurance_claims").select("*").eq("policy_id", id).is("deleted_at", null).order("claim_date", { ascending: false }),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    cvId ? supabase.from("assets").select("id,current_value,current_value_date,currency").eq("id", cvId).maybeSingle() : Promise.resolve({ data: null }),
    cvId ? supabase.from("asset_valuations").select("id,valuation_date,value,source,notes").eq("asset_id", cvId).is("deleted_at", null).order("valuation_date", { ascending: false }) : Promise.resolve({ data: null }),
    cvId ? supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", cvId) : Promise.resolve({ data: null }),
    p.asset_id ? supabase.from("assets").select("name").eq("id", p.asset_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const [{ data: linesRaw }, { data: covs }, { data: fups }, { data: banks }, { data: cardsRaw }, { data: allPersons }] = await Promise.all([
    supabase.from("v_insurance_schedule_status").select("id,kind,installment_no,due_date,amount,currency,benefit_type,notes,paid_amount,remaining,status")
      .eq("policy_id", id).order("due_date").order("installment_no"),
    supabase.from("insurance_coverages").select("id,coverage_type,limit_amount,currency,notes").eq("policy_id", id).is("deleted_at", null).order("created_at"),
    supabase.from("insurance_followups").select("id,person_id,role,action,status,notes").eq("policy_id", id).is("deleted_at", null).order("created_at"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("persons").select("id,name").is("deleted_at", null),
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
  const premPaid = premiums.reduce((s2, x) => s2 + Number(x.paid_amount), 0);
  const premOpen = premiums.filter((x) => ["PENDING", "OVERDUE", "PARTIAL"].includes(x.status));
  const premNext = premOpen.find((x) => x.status !== "OVERDUE");
  const premOverdue = premOpen.filter((x) => x.status === "OVERDUE");
  const benReceived = benefits.reduce((s2, x) => s2 + Number(x.paid_amount), 0);
  const lastDue = (xs: Line[]) => xs.at(-1)?.due_date;
  const policyLabel = `เบี้ยประกัน ${p.insurer}${p.policy_no ? ` ${p.policy_no}` : ""}`;
  const activeOwners = (owners ?? []).filter((o: { end_date: string | null }) => !o.end_date) as { person_id: string; person_name: string; ownership_percent: number }[];
  const benName = (b: { person_id: string | null; beneficiary_name: string | null; persons: unknown }) =>
    b.person_id ? ((Array.isArray(b.persons) ? b.persons[0] : b.persons) as { name: string } | null)?.name ?? "-" : b.beneficiary_name;
  const benTotal = (bens ?? []).reduce((s, b) => s + Number(b.percentage), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/insurance" className="text-sm text-slate-500 hover:underline">← Insurance</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{p.insurer}{p.policy_no && ` · ${p.policy_no}`}</h1>
        <p className="text-sm text-slate-500">{TYPE[p.insurance_type] ?? p.insurance_type}
          {p.person_id && ` · ผู้เอาประกัน ${allName.get(p.person_id) ?? ""}`}
          {p.payer_person_id && p.payer_person_id !== p.person_id && ` · ผู้จ่ายเบี้ย ${allName.get(p.payer_person_id) ?? ""}`}
          {insured && ` · คุ้มครอง ${insured.name}`}</p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">ความคุ้มครอง</div>
          <ul className="mt-1 space-y-0.5">
            <li>ทุนประกัน {money(p.insured_amount, p.insured_amount_currency ?? undefined, 0)}</li>
            <li>เบี้ย {money(p.premium, p.premium_currency ?? undefined, 0)} ต่อปี</li>
            <li>{thDate(p.start_date)} – {thDate(p.end_date)}{p.derived_status === "EXPIRING_SOON" && <span className="text-amber-700"> · ใกล้ครบ</span>}</li>
          </ul>
          {canWrite && <div className="mt-2"><RowActions table="insurance_policies" id={id} paths={paths} canDelete={false} fields={[
            { name: "insurer", label: "บริษัท", value: p.insurer }, { name: "policy_no", label: "เลขกรมธรรม์", value: p.policy_no },
            { name: "start_date", label: "เริ่ม", type: "date", value: p.start_date }, { name: "end_date", label: "สิ้นสุด", type: "date", value: p.end_date },
            { name: "insured_amount", label: "ทุน", type: "number", value: p.insured_amount }, { name: "premium", label: "เบี้ย", type: "number", value: p.premium },
            { name: "payer_person_id", label: "ผู้จ่ายเบี้ย", type: "select", value: p.payer_person_id ?? "",
              options: [["", "คนเดียวกับผู้เอาประกัน"], ...(persons ?? []).map((x) => [x.id, x.name] as [string, string])] },
            { name: "notes", label: "หมายเหตุ", value: p.notes, width: "w-48" }]} /></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">ผู้รับผลประโยชน์</div>
          {(bens ?? []).length === 0 ? <p className="mt-1 text-slate-500">ยังไม่ระบุ</p> : (
            <ul className="mt-1 space-y-0.5">{(bens ?? []).map((b) => <li key={b.id}>{benName(b)} · {Number(b.percentage)}%</li>)}</ul>
          )}
          {benTotal > 0 && benTotal < 100 && <div className="mt-1 text-xs text-amber-700">รวม {benTotal}% (ยังไม่ครบ 100%)</div>}
          {canWrite && <BeneficiaryEditor policyId={id} persons={persons ?? []}
            current={(bens ?? []).map((b) => ({ person_id: b.person_id, name: b.beneficiary_name, percent: Number(b.percentage) }))} />}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">มูลค่าเวนคืน</div>
          {cvAsset ? (
            <>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{money(cvAsset.current_value, cvAsset.currency, 0)}</div>
              <div className="text-xs text-slate-500">ณ {thDate(cvAsset.current_value_date)}</div>
              <div className="mt-2 text-xs text-slate-600">เจ้าของ: {activeOwners.map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ") || "-"}</div>
              {canWrite && <OwnershipEditor kind="asset" id={cvAsset.id} persons={persons ?? []} paths={paths} today={today}
                current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
            </>
          ) : <p className="mt-1 text-sm text-slate-500">{p.has_cash_value ? "ยังไม่มีมูลค่า" : "ไม่มี (ไม่นับเป็นสินทรัพย์)"}</p>}
        </div>
      </section>

      {cvAsset && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">มูลค่าเวนคืน</h2>
          {canWrite && <AssetValuationForm assetId={cvAsset.id} currency={cvAsset.currency} today={today} minDate={family?.go_live_date ?? ""} paths={paths}
            methods={[["STATEMENT", "ตามหนังสือแจ้งจากบริษัทประกัน"], ["USER_ESTIMATE", "ประมาณเอง"]]} />}
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {(cvVals ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="py-1.5">{thDate(v.valuation_date)}</td>
                  <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                  <td className="pl-4 text-slate-500">{v.source === "OPENING" ? "ยอดตั้งต้น" : v.notes}</td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (cvVals ?? []).length > 1}
                      fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "value", label: "มูลค่า", type: "number", value: v.value }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(fups ?? []).length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">ติดตามหลังเสียชีวิต</h2>
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
          <p className="text-xs text-slate-500">แนบเอกสาร (ใบมรณบัตร / หนังสือเรียกร้องสินไหม) ได้ที่ &ldquo;เอกสาร&rdquo; ท้ายหน้านี้</p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ความคุ้มครอง</h2>
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
        {canWrite && <CoverageForm policyId={id} currency={ccy} />}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">ตารางเบี้ย</h2>
            {premiums.length > 0 ? (
              <p className="text-sm text-slate-600">{premiums.length} งวด · จ่ายแล้ว {money(premPaid, ccy)}
                {premNext && <> · งวดถัดไป {thDate(premNext.due_date)} {money(premNext.remaining)}</>}
                {premOverdue.length > 0 && <span className="text-red-600"> · เลยกำหนด {premOverdue.length} งวด</span>}
                {payerId && <> · ผู้จ่าย {allName.get(payerId)}</>}</p>
            ) : <p className="text-sm text-slate-500">ยังไม่ได้ตั้งตารางเบี้ย — ตั้งแล้วจะขึ้นใน Income &amp; Expenses → ค่าใช้จ่ายที่ต้องจ่าย</p>}
          </div>
          {canDelete && policyActive && <InsScheduleEditor policyId={id} kind="PREMIUM" currency={ccy} hasLines={premiums.length > 0}
            defaultAmount={Number(p.premium ?? 0)} defaultFirstDue={lastDue(premiums) ? addMonthsKeepDay(lastDue(premiums) as string, 12) : (p.start_date ?? today)} />}
        </div>
        {premiums.length > 0 && <ScheduleTable lines={premiums} canWrite={canWrite} canDelete={canDelete} paths={paths} action={(x) =>
          canWrite && ["PENDING", "OVERDUE", "PARTIAL"].includes(x.status) ? <PayPremiumForm policyId={id} lineId={x.id} amount={Number(x.remaining)}
            label={`${policyLabel} งวดที่ ${x.installment_no}`} currency={x.currency} banks={banks ?? []} cards={cards} persons={persons ?? []}
            defaultPerson={payerId} today={today} /> : null} />}
      </section>

      {p.insurance_type !== "PROPERTY" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium text-slate-900">ผลประโยชน์ที่จะได้รับ</h2>
              <p className="text-sm text-slate-600">
                {benefits.length > 0 ? <>{benefits.length} งวด · รับแล้ว {money(benReceived, ccy)}</> : "รายงวด (เงินคืน / บำนาญ) ตั้งเป็นตาราง · ก้อนเดียว (ครบสัญญา / เวนคืน / สินไหม) กดปุ่มรับเงินก้อนได้เลย"}
              </p>
              {cvAsset && <p className="text-xs text-slate-500">มีมูลค่าเวนคืน: เงินที่รับถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินนับเป็นรายได้</p>}
            </div>
            {canDelete && policyActive && <InsScheduleEditor policyId={id} kind="BENEFIT" currency={ccy} hasLines={benefits.length > 0}
              defaultFirstDue={p.start_date ? addMonthsKeepDay(p.start_date, 24) : today} />}
          </div>
          {benefits.length > 0 && <ScheduleTable lines={benefits} canWrite={canWrite} canDelete={canDelete} paths={paths} benefit action={(x) =>
            canWrite && ["PENDING", "OVERDUE", "PARTIAL"].includes(x.status) ? <BenefitForm policyId={id} lineId={x.id} amount={Number(x.remaining)}
              currency={x.currency} banks={banks ?? []} persons={persons ?? []} hasCashValue={!!cvAsset} cashValue={cvAsset?.current_value}
              today={today} small canClose={canDelete} /> : null} />}
          {canWrite && policyActive && <BenefitForm policyId={id} currency={ccy} banks={banks ?? []} persons={persons ?? []} hasCashValue={!!cvAsset}
            cashValue={cvAsset?.current_value} today={today} button="รับเงินก้อน (ครบสัญญา / เวนคืน / สินไหม / อื่น ๆ)" canClose={canDelete} />}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">เคลม</h2>
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
        <p className="text-xs text-slate-500">เมื่อได้เงินคืน: ไปที่ Income &amp; Expenses → ค่าใช้จ่ายที่ตั้ง &ldquo;ได้เงินคืน&rdquo; → บันทึกเงินคืน แล้วเลือก &ldquo;จากเคลมประกัน&rdquo; · ยอด &ldquo;ได้รับ&rdquo; และสถานะเคลม (จ่ายบางส่วน / จ่ายครบ) จะอัปเดตให้อัตโนมัติ</p>
        {canWrite && <ClaimForm policyId={id} currency={ccy} today={today}
          coverages={(covs ?? []).map((c) => ({ id: c.id, coverage_type: c.coverage_type, limit_amount: Number(c.limit_amount) }))} />}
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <StatusSelect table="insurance_policies" id={id} value={p.status} paths={paths} label="สถานะกรมธรรม์" options={INS_STATUS} />
          {canDelete && <div><DeleteEntity kind="policy" id={id} redirectTo="/insurance" paths={["/insurance"]} label="ลบกรมธรรม์นี้"
            hint="มูลค่าเวนคืน ผู้รับผลประโยชน์ และเคลมจะถูกลบด้วย" /></div>}
        </section>
      )}
      <EntityDocuments entityType="INSURANCE_POLICY" entityId={id} module="INSURANCE" role={me.role} paths={paths} />
    </div>
  );
}

/** ตารางงวด (เบี้ย / ผลประโยชน์) · งวดที่ชำระครบแล้วแก้ / ลบไม่ได้ */
function ScheduleTable({ lines, canWrite, canDelete, paths, action, benefit = false }: {
  lines: Line[]; canWrite: boolean; canDelete: boolean; paths: string[]; action: (x: Line) => React.ReactNode; benefit?: boolean;
}) {
  return (
    <div className="max-h-[26rem] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
          <tr><th className="py-1">งวด</th><th>ครบกำหนด</th>{benefit && <th>ชนิด</th>}<th className="text-right">ยอด</th><th className="text-right">ชำระ / รับแล้ว</th><th className="pl-4">สถานะ</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((x) => {
            const st = INS_SCHED_STATUS[x.status];
            return (
              <tr key={x.id} className={`align-top ${x.status === "PAID" || x.status === "CLOSED" ? "text-slate-400" : ""}`}>
                <td className="py-1.5">{x.installment_no}</td>
                <td>{thDate(x.due_date)}{x.notes && <div className="text-xs text-slate-400">{x.notes}</div>}</td>
                {benefit && <td className="text-xs">{BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"]}</td>}
                <td className="text-right tabular-nums">{money(x.amount, x.currency)}</td>
                <td className="text-right tabular-nums">{Number(x.paid_amount) > 0 ? money(x.paid_amount) : "-"}</td>
                <td className="pl-4"><span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? x.status}</span></td>
                <td className="pl-2 text-right">
                  {action(x)}
                  {canWrite && x.status !== "PAID" && <div className="mt-1"><RowActions table="insurance_schedule_lines" id={x.id} paths={paths} canDelete={canDelete} fields={[
                    { name: "due_date", label: "ครบกำหนด", type: "date", value: x.due_date },
                    { name: "amount", label: "ยอด", type: "number", value: x.amount },
                    { name: "notes", label: "หมายเหตุ", value: x.notes, width: "w-40" }]} /></div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
