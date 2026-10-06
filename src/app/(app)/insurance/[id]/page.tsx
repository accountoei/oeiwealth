import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { CLAIM_STATUS, INS_STATUS, INS_TYPE, money, thDate, todayBangkok } from "@/lib/format";
import BeneficiaryEditor from "../Beneficiaries";
import ClaimForm from "./ClaimForm";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import AssetValuationForm from "@/components/AssetValuationForm";

const TYPE = Object.fromEntries(INS_TYPE);
const CSTATUS = Object.fromEntries(CLAIM_STATUS);

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
  const pname = new Map((persons ?? []).map((x) => [x.id, x.name]));
  const ccy = p.insured_amount_currency ?? p.premium_currency ?? cvAsset?.currency ?? "THB";
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
          {p.person_id && ` · ผู้เอาประกัน ${pname.get(p.person_id) ?? ""}`}{insured && ` · คุ้มครอง ${insured.name}`}</p>
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
        {canWrite && <ClaimForm policyId={id} currency={ccy} today={today} />}
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <StatusSelect table="insurance_policies" id={id} value={p.status} paths={paths} label="สถานะกรมธรรม์" options={INS_STATUS} />
          {canDelete && <div><DeleteEntity kind="policy" id={id} redirectTo="/insurance" paths={["/insurance"]} label="ลบกรมธรรม์นี้"
            hint="มูลค่าเวนคืน ผู้รับผลประโยชน์ และเคลมจะถูกลบด้วย" /></div>}
        </section>
      )}
    </div>
  );
}
