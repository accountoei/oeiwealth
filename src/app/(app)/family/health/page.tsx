import { createClient } from "@/lib/supabase/server";
import { PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { requireAppUser } from "@/lib/auth";
import Link from "next/link";
import { CLAIM_STATUS, COVERAGE_ANNUAL, COVERAGE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import CheckupForm from "./CheckupForm";
import PersonPicker from "./PersonPicker";
import { METRIC_LABEL } from "./metrics";
import { SortToggle } from "@/components/SortControls";
import { moveHealthMetric } from "@/lib/sort-actions";
import { orderHrefs } from "@/lib/sort";
import { ActionBar } from "@/components/ActionBar";
import { StatBox } from "@/components/Boxes";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

type Res = { id: string; checkup_id: string; metric: string; sort_order: number | null; value_numeric: number | null; value_text: string | null; unit: string | null;
  reference_min: number | null; reference_max: number | null; reference_text: string | null; abnormal_flag: string | null; notes: string | null };
const FLAG: Record<string, { text: string; cls: string }> = { H: { text: "สูง", cls: "text-red-700" }, L: { text: "ต่ำ", cls: "text-sky-700" }, ABNORMAL: { text: "ผิดปกติ", cls: "text-red-700" } };
const CSTATUS = Object.fromEntries(CLAIM_STATUS);
/** ความคุ้มครองด้านสุขภาพ (แสดงในหน้านี้) */
const HEALTH_COV = ["IPD_ANNUAL", "IPD_PER_ADMIT", "ROOM_PER_DAY", "OPD_PER_VISIT", "OPD_ANNUAL", "HOSPITAL_CASH_PER_DAY", "CRITICAL_ILLNESS"];
const fmt = (r: Res) => (r.value_numeric != null ? Number(r.value_numeric).toLocaleString("th-TH", { maximumFractionDigits: 2 }) : r.value_text ?? "-");

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data: persons } = await supabase.from("persons").select("id,name").is("deleted_at", null).neq("status", "DECEASED").order("sort_order").order("created_at");
  const list = persons ?? [];
  const pid = list.some((p) => p.id === sp.p) ? (sp.p as string) : me.person_id && list.some((p) => p.id === me.person_id) ? me.person_id : list[0]?.id;
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canDelete && sp.order === "1";
  if (!pid) return <p className="text-sm text-slate-500">ยังไม่มีสมาชิกครอบครัว</p>;

  const year = todayBangkok().slice(0, 4);
  // ผลตรวจ + สิทธิ์ประกันสุขภาพของคนนี้ (อ่านอย่างเดียว · ตกลง 2 พ.ย. 2026) — ดึงพร้อมกัน ส่วนที่ต้องใช้ผลก่อนหน้าต่อกันในรอบเดียว
  const [{ checkups, resultsRaw }, { pols, covs, claims }] = await Promise.all([
    (async () => {
      const { data: checkups } = await supabase.from("health_checkups").select("*").eq("person_id", pid).is("deleted_at", null).order("checkup_date", { ascending: false });
      const ids = (checkups ?? []).map((c) => c.id);
      const { data: resultsRaw } = ids.length ? await supabase.from("health_results").select("*").in("checkup_id", ids).is("deleted_at", null) : { data: [] as Res[] };
      return { checkups, resultsRaw };
    })(),
    (async () => {
      const { data: pols } = await supabase.from("insurance_policies").select("id,insurer,policy_no,end_date").eq("person_id", pid).eq("status", "ACTIVE").is("deleted_at", null);
      const pids = (pols ?? []).map((x) => x.id);
      if (!pids.length) return { pols: pols ?? [], covs: [], claims: [] };
      const [{ data: covs }, { data: claims }] = await Promise.all([
        supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency").in("policy_id", pids).in("coverage_type", HEALTH_COV).is("deleted_at", null),
        supabase.from("insurance_claims").select("id,policy_id,coverage_id,incident_date,claim_date,claimed_amount,received_amount,currency,status,notes")
          .in("policy_id", pids).is("deleted_at", null).order("claim_date", { ascending: false }).limit(20),
      ]);
      return { pols: pols ?? [], covs: covs ?? [], claims: claims ?? [] };
    })(),
  ]);
  const polName = new Map(pols.map((x) => [x.id, `${x.insurer}${x.policy_no ? ` · ${x.policy_no}` : ""}`]));
  const live = (c: { status: string }) => !["REJECTED", "CANCELLED"].includes(c.status);
  const usedOf = (covId: string) => claims.filter((c) => c.coverage_id === covId && live(c) && (c.claim_date ?? c.incident_date ?? "").startsWith(year))
    .reduce((t, c) => t + Number(c.received_amount ?? c.claimed_amount ?? 0), 0);
  const recentClaims = claims.slice(0, 5);
  // ลำดับรายการผลตรวจ (ตั้งได้ต่อสมาชิก) — ใช้ทั้งตารางผลย้อนหลังและผลแต่ละครั้ง
  const results = ((resultsRaw as Res[] | null) ?? []).sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9));
  const recent = (checkups ?? []).slice(0, 6);
  const metrics = [...new Set(results.map((r) => r.metric))];
  const cellOf = (m: string, c: string) => results.find((r) => r.metric === m && r.checkup_id === c);
  const paths = ["/family/health"];
  const last = (checkups ?? [])[0];
  const lastAbn = last ? results.filter((r) => r.checkup_id === last.id && r.abnormal_flag) : [];
  const yearAgo = `${Number(todayBangkok().slice(0, 4)) - 1}${todayBangkok().slice(4)}`;
  const costYear = (checkups ?? []).filter((c) => c.checkup_date > yearAgo).reduce((t, c) => t + Number(c.cost ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageInfo>ผลตรวจสุขภาพประจำปีของสมาชิก · ข้อมูลอ่อนไหว ผู้ใช้ทุกคนในระบบเห็นได้ตามสิทธิ์</PageInfo>
      {/* ตัวเลือกคนอยู่แถวแท็บ ขวาสุดต่อจากปุ่ม (ตกลง 30 ต.ค. 2026) */}
      <TabActions>
        {canWrite && <ActionBar><CheckupForm personId={pid} today={todayBangkok()} /></ActionBar>}
        <PersonPicker persons={list} value={pid} />
      </TabActions>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">ตรวจล่าสุด</div>
          <div className="mt-1 text-xl font-semibold">{last ? thDate(last.checkup_date) : "-"}</div>
          <div className={`mt-1 text-xs ${last && last.checkup_date < yearAgo ? "text-amber-700" : "text-slate-500"}`}>
            {!last ? "ยังไม่มีผลตรวจ" : last.checkup_date < yearAgo ? "เกิน 1 ปีแล้ว ควรตรวจประจำปี" : last.hospital || "ภายใน 1 ปี"}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">ผิดปกติในครั้งล่าสุด</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${lastAbn.length ? "text-red-700" : ""}`}>{lastAbn.length} <span className="text-sm font-normal text-slate-500">รายการ</span></div>
          <div className="mt-1 truncate text-xs text-slate-500">{lastAbn.length ? lastAbn.slice(0, 3).map((r) => METRIC_LABEL[r.metric] ?? r.metric).join(" · ") : "ปกติทั้งหมด"}</div>
        </div>
        <StatBox label="จำนวนครั้งที่บันทึก" value={(checkups ?? []).length} unit="ครั้ง" sub={<>{metrics.length} รายการตรวจ</>} />
        <StatBox label="ค่าตรวจ 12 เดือนล่าสุด" value={money(costYear, "THB", 0)} sub="ตามที่บันทึกในแต่ละครั้ง" />
      </section>

      {(covs.length > 0 || recentClaims.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">สิทธิ์ประกันสุขภาพ</h2>
            <p className="mb-2 text-xs text-slate-500">จากกรมธรรม์ที่มีผล · วงเงินต่อปีหักยอดเคลมปีนี้ · แก้ไขที่หน้ากรมธรรม์</p>
            {covs.length === 0 ? <p className="text-sm text-slate-500">ยังไม่ได้ใส่ความคุ้มครองด้านสุขภาพในกรมธรรม์</p> : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {covs.map((c) => {
                    const annual = COVERAGE_ANNUAL.includes(c.coverage_type);
                    const used = annual ? usedOf(c.id) : 0;
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="py-1.5">{COVERAGE_LABEL[c.coverage_type]?.[0] ?? c.coverage_type}{COVERAGE_LABEL[c.coverage_type]?.[1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[c.coverage_type][1]}</span>}
                          <div className="text-xs"><Link href={`/insurance/${c.policy_id}`} className="text-slate-500 hover:underline">{polName.get(c.policy_id)}</Link></div></td>
                        <td className="text-right tabular-nums">{money(c.limit_amount, c.currency, 0)}
                          {annual && used > 0 && <div className="text-xs text-slate-500">ใช้ปีนี้ {money(used, undefined, 0)} · เหลือ {money(Math.max(Number(c.limit_amount) - used, 0), undefined, 0)}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">เคลมล่าสุด</h2>
            <p className="mb-2 text-xs text-slate-500">ยื่น / ติดตามเคลมที่หน้ากรมธรรม์ → ปุ่ม &ldquo;ยื่นเคลม&rdquo;</p>
            {recentClaims.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเคลม</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">ยื่นเคลม</th><th>กรมธรรม์</th><th className="text-right">ยอดเคลม</th><th className="text-right">ได้รับ</th><th className="pl-3">สถานะ</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {recentClaims.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="whitespace-nowrap py-1.5">{thDate(c.claim_date ?? c.incident_date)}</td>
                      <td><Link href={`/insurance/${c.policy_id}`} className="hover:underline">{polName.get(c.policy_id)}</Link>{c.notes && <div className="text-xs text-slate-500">{c.notes}</div>}</td>
                      <td className="text-right tabular-nums">{money(c.claimed_amount, c.currency, 0)}</td>
                      <td className="text-right tabular-nums">{c.received_amount != null ? money(c.received_amount, undefined, 0) : "-"}</td>
                      <td className="pl-3 text-xs">{CSTATUS[c.status] ?? c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {metrics.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-medium text-slate-900">ผลย้อนหลัง</h2>
            {canDelete && metrics.length > 1 && <SortToggle active={ordering} {...orderHrefs("/family/health", { p: pid })} />}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">รายการ</th>{recent.map((c) => <th key={c.id} className="px-2 text-right">{thDate(c.checkup_date)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((m, i) => (
                <tr key={m}>
                  <td className="py-1.5">
                    {ordering && (
                      <span className="mr-2 inline-flex gap-1 align-middle">
                        {[[metrics[i - 1], "↑", "เลื่อนขึ้น"], [metrics[i + 1], "↓", "เลื่อนลง"]].map(([other, label, aria]) => (
                          <form key={label} action={moveHealthMetric}>
                            <input type="hidden" name="person_id" value={pid} /><input type="hidden" name="metric" value={m} />
                            <input type="hidden" name="other" value={other ?? ""} /><input type="hidden" name="paths" value="/family/health" />
                            <button className={arrow} disabled={!other} aria-label={aria}>{label}</button>
                          </form>
                        ))}
                      </span>
                    )}
                    {METRIC_LABEL[m] ?? m}</td>
                  {recent.map((c) => {
                    const r = cellOf(m, c.id);
                    return <td key={c.id} className={`px-2 text-right tabular-nums ${r?.abnormal_flag ? FLAG[r.abnormal_flag]?.cls : ""}`}>{r ? fmt(r) : ""}{r?.abnormal_flag && " ●"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">● = ผิดปกติตามใบผล (สีแดง = สูง / ผิดปกติ · สีฟ้า = ต่ำ)</p>
        </section>
      )}

      <section className="space-y-4">
        {(checkups ?? []).length === 0 && <p className="text-sm text-slate-500">ยังไม่มีผลตรวจ</p>}
        {(checkups ?? []).map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{thDate(c.checkup_date)}{c.hospital && ` · ${c.hospital}`}</div>
                <div className="text-xs text-slate-500">{[c.package_name, c.cost != null ? `ค่าใช้จ่าย ${money(c.cost, c.currency ?? "THB", 0)}` : null].filter(Boolean).join(" · ")}</div>
                {c.notes && <div className="mt-1 text-sm text-slate-600">{c.notes}</div>}
              </div>
              {canWrite && <RowActions table="health_checkups" id={c.id} paths={paths} canDelete={canDelete} fields={[
                { name: "checkup_date", label: "วันที่", type: "date", value: c.checkup_date }, { name: "hospital", label: "โรงพยาบาล", value: c.hospital },
                { name: "package_name", label: "แพ็กเกจ", value: c.package_name }, { name: "cost", label: "ค่าใช้จ่าย", type: "number", value: c.cost },
                { name: "notes", label: "หมายเหตุ", value: c.notes, width: "w-48" }]} />}
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {results.filter((r) => r.checkup_id === c.id).map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5">{METRIC_LABEL[r.metric] ?? r.metric}</td>
                    <td className={`text-right tabular-nums ${r.abnormal_flag ? FLAG[r.abnormal_flag]?.cls : ""}`}>{fmt(r)} <span className="text-xs text-slate-500">{r.unit}</span></td>
                    <td className="pl-4 text-xs text-slate-500">
                      {r.reference_text ?? (r.reference_min != null || r.reference_max != null ? `ปกติ ${r.reference_min ?? ""}–${r.reference_max ?? ""}` : "")}
                      {r.abnormal_flag && <span className={`ml-2 ${FLAG[r.abnormal_flag]?.cls}`}>{FLAG[r.abnormal_flag]?.text}</span>}
                    </td>
                    <td className="pl-2 text-right">{canWrite && <RowActions table="health_results" id={r.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "value_numeric", label: "ผล", type: "number", value: r.value_numeric }, { name: "unit", label: "หน่วย", value: r.unit, width: "w-20" },
                      { name: "reference_min", label: "ต่ำสุด", type: "number", value: r.reference_min, width: "w-20" },
                      { name: "reference_max", label: "สูงสุด", type: "number", value: r.reference_max, width: "w-20" },
                      { name: "abnormal_flag", label: "ผิดปกติ", type: "select", value: r.abnormal_flag ?? "", options: [["", "ปกติ"], ["H", "สูง"], ["L", "ต่ำ"], ["ABNORMAL", "ผิดปกติ"]] }]} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}
