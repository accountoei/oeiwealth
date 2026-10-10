import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { COVERAGE_ANNUAL, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_STATUS, INS_TYPE, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const me = await requireAppUser();
  const supabase = await createClient();
  const year = todayBangkok().slice(0, 4);
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: dues }, { data: fups }] = await Promise.all([
    searchParams.then((sp) => loadPersonView(sp.p)),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name"),
    supabase.from("assets").select("id,current_value,currency,current_value_date").eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
    supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency").is("deleted_at", null),
    supabase.from("insurance_claims").select("coverage_id,claimed_amount,received_amount,status,claim_date").is("deleted_at", null)
      .not("coverage_id", "is", null).gte("claim_date", `${year}-01-01`).lte("claim_date", `${year}-12-31`),
    supabase.from("v_insurance_schedule_status").select("policy_id,due_date,remaining,status").eq("kind", "PREMIUM")
      .in("status", ["PENDING", "OVERDUE", "PARTIAL"]).order("due_date"),
    supabase.from("insurance_followups").select("id,person_id,policy_id,role,action,status").is("deleted_at", null)
      .in("status", ["OPEN", "IN_PROGRESS"]).order("created_at"),
  ]);
  const pname = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const cv = new Map((cvs ?? []).map((a) => [a.id, a]));
  // มุมมองรายบุคคล: กรมธรรม์ที่คนนั้นเป็นผู้เอาประกัน หรือเป็นเจ้าของมูลค่าเวนคืน · มูลค่าเวนคืน × สัดส่วนเจ้าของ
  const rows = (data ?? []).filter((r) => pv.isPerson(r.person_id) || (pv.personId !== "" && r.payer_person_id === pv.personId)
    || (!!r.cash_value_asset_id && pv.personId !== "" && pv.showAsset(r.cash_value_asset_id)));
  // เบี้ยงวดถัดไป / เลยกำหนด ต่อกรมธรรม์
  const nextPremium = new Map<string, { due_date: string; remaining: number }>();
  const overduePremium = new Map<string, number>();
  (dues ?? []).forEach((d) => {
    if (d.status === "OVERDUE") overduePremium.set(d.policy_id, (overduePremium.get(d.policy_id) ?? 0) + 1);
    else if (!nextPremium.has(d.policy_id)) nextPremium.set(d.policy_id, { due_date: d.due_date, remaining: Number(d.remaining) });
  });
  // สรุปสิทธิ์รายคน: กรมธรรม์ที่ยังมีผล · รวมวงเงินตามผู้เอาประกัน · วงเงินรายปีหักยอดเคลมปีนี้
  const activePolicy = new Map((data ?? []).filter((r) => r.status === "ACTIVE" && r.person_id).map((r) => [r.id, r.person_id as string]));
  const usedByCov = new Map<string, number>();
  (claims ?? []).filter((c) => !["REJECTED", "CANCELLED"].includes(c.status)).forEach((c) =>
    usedByCov.set(c.coverage_id as string, (usedByCov.get(c.coverage_id as string) ?? 0) + Number(c.received_amount ?? c.claimed_amount ?? 0)));
  type Sum = { limit: number; used: number; currency: string; policies: number };
  const byPerson = new Map<string, Map<string, Sum>>();
  (covs ?? []).forEach((c) => {
    const pid = activePolicy.get(c.policy_id);
    if (!pid || !pv.isPerson(pid)) return;
    const m = byPerson.get(pid) ?? new Map<string, Sum>();
    const cur = m.get(c.coverage_type) ?? { limit: 0, used: 0, currency: c.currency, policies: 0 };
    m.set(c.coverage_type, { ...cur, limit: cur.limit + Number(c.limit_amount), used: cur.used + (usedByCov.get(c.id) ?? 0), policies: cur.policies + 1 });
    byPerson.set(pid, m);
  });
  const policyName = new Map((data ?? []).map((r) => [r.id, `${r.insurer}${r.policy_no ? ` · ${r.policy_no}` : ""}`]));
  const fupRows = (fups ?? []).filter((f) => pv.isPerson(f.person_id) || rows.some((r) => r.id === f.policy_id));
  const cvTotal = (cvs ?? []).filter((a) => pv.showAsset(a.id))
    .reduce((s, a) => s + (a.currency === "THB" ? Number(a.current_value ?? 0) * pv.assetShare(a.id) : 0), 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Insurance</h1>
          <p className="text-sm text-slate-500">กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/insurance/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มกรมธรรม์</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {fupRows.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">ติดตามหลังเสียชีวิต · ค้าง {fupRows.length} รายการ</h2>
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
      {byPerson.size > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {[...byPerson.entries()].map(([pid, m]) => (
            <div key={pid} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 font-medium text-slate-900">สิทธิ์คุ้มครอง · {pname.get(pid)}</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {Object.keys(COVERAGE_LABEL).filter((k) => m.has(k)).map((k) => {
                    const x = m.get(k) as Sum;
                    const annual = COVERAGE_ANNUAL.includes(k);
                    return (
                      <tr key={k}>
                        <td className="py-1.5">{COVERAGE_LABEL[k][0]}{COVERAGE_LABEL[k][1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[k][1]}</span>}
                          {x.policies > 1 && <span className="text-xs text-slate-400"> · {x.policies} กรมธรรม์</span>}</td>
                        <td className="text-right tabular-nums">{money(x.limit, x.currency)}
                          {annual && x.used > 0 && <div className="text-xs text-slate-500">ใช้ปีนี้ {money(x.used)} · เหลือ {money(Math.max(x.limit - x.used, 0))}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
      {cvTotal > 0 && (
        <div className="inline-block rounded-xl border border-slate-200 bg-white px-5 py-3">
          <div className="text-xs text-slate-500">{pv.personId ? `มูลค่าเวนคืนส่วนของ ${pv.personName}` : "มูลค่าเวนคืนรวม"} (THB)</div>
          <div className="text-lg font-semibold tabular-nums">{money(cvTotal, "THB", 0)}</div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">กรมธรรม์</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4 text-right">ทุน / เบี้ย</th><th className="px-4 text-right">มูลค่าเวนคืน</th><th className="px-4">เบี้ยงวดถัดไป</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีกรมธรรม์ของ ${pv.personName}` : "ยังไม่มีกรมธรรม์"}</td></tr>}
            {rows.map((r) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>
                    <div className="text-xs text-slate-500">{TYPE[r.insurance_type] ?? r.insurance_type}{r.end_date && ` · ถึง ${thDate(r.end_date)}`}</div>
                  </td>
                  <td className="px-4">{r.person_id ? pname.get(r.person_id) : "-"}
                    {r.payer_person_id && r.payer_person_id !== r.person_id && <div className="text-xs text-slate-500">ผู้จ่าย {pname.get(r.payer_person_id)}</div>}</td>
                  <td className="px-4 text-right tabular-nums text-xs">
                    {r.insured_amount != null && <div>ทุน {money(r.insured_amount, r.insured_amount_currency ?? undefined, 0)}</div>}
                    {r.premium != null && <div className="text-slate-500">เบี้ย {money(r.premium, undefined, 0)}/ปี</div>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.has_cash_value ? (c ? <>
                    {money(c.current_value == null ? null : Number(c.current_value) * pv.assetShare(c.id), c.currency, 0)}
                    {pv.assetPct(c.id) != null && <div className="text-xs text-slate-500">{pv.assetPct(c.id)}% ของ {money(c.current_value, c.currency, 0)}</div>}
                  </> : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="px-4 text-xs">
                    {nextPremium.get(r.id) ? <>{thDate(nextPremium.get(r.id)?.due_date)}<div className="tabular-nums text-slate-500">{money(nextPremium.get(r.id)?.remaining)}</div></> : <span className="text-slate-400">-</span>}
                    {overduePremium.get(r.id) && <div className="text-red-600">เลยกำหนด {overduePremium.get(r.id)} งวด</div>}
                  </td>
                  <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
