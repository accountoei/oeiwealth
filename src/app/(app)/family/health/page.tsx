import { createClient } from "@/lib/supabase/server";
import { HeaderFilters, PageInfo, InfoTip } from "@/components/HeaderBar";
import { requireAppUser } from "@/lib/auth";
import Link from "next/link";
import { CLAIM_STATUS, COVERAGE_ANNUAL, COVERAGE_LABEL, money, SMALL_BTN, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import CheckupForm from "./CheckupForm";
import PersonFilter from "@/components/PersonFilter";
import { redirect } from "next/navigation";
import { METRIC_LABEL } from "./metrics";
import { SortToggle } from "@/components/SortControls";
import { moveHealthMetric } from "@/lib/sort-actions";
import { orderHrefs } from "@/lib/sort";
import { ActionBar } from "@/components/ActionBar";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

type Res = { id: string; checkup_id: string; metric: string; sort_order: number | null; value_numeric: number | null; value_text: string | null; unit: string | null;
  reference_min: number | null; reference_max: number | null; reference_text: string | null; abnormal_flag: string | null; notes: string | null };
const FLAG: Record<string, { text: string; cls: string }> = { H: { text: "สูง", cls: "text-red-700" }, L: { text: "ต่ำ", cls: "text-sky-700" }, ABNORMAL: { text: "ผิดปกติ", cls: "text-red-700" } };
const CSTATUS = Object.fromEntries(CLAIM_STATUS);
/** ความคุ้มครองด้านสุขภาพ (แสดงในหน้านี้) */
const HEALTH_COV = ["IPD_ANNUAL", "IPD_PER_ADMIT", "ROOM_PER_DAY", "OPD_PER_VISIT", "OPD_ANNUAL", "HOSPITAL_CASH_PER_DAY", "CRITICAL_ILLNESS"];
const fmt = (r: Res) => (r.value_numeric != null ? Number(r.value_numeric).toLocaleString("th-TH", { maximumFractionDigits: 2 }) : r.value_text ?? "-");

const PATHS = ["/family/health"];
const INFO = <PageInfo>ผลตรวจสุขภาพประจำปีของสมาชิก · ข้อมูลอ่อนไหว ผู้ใช้ทุกคนในระบบเห็นได้ตามสิทธิ์</PageInfo>;
type Sb = Awaited<ReturnType<typeof createClient>>;

/** ข้อมูลมุมมองทั้งครอบครัว: ผลตรวจทุกคน (ไม่ดึงผลรายการ ยกเว้นรายการผิดปกติ) + สิทธิ์ประกันสุขภาพ — 2 รอบ ทำพร้อมรายชื่อ */
async function loadFamily(supabase: Sb) {
  const [checkups, abn, cov] = await Promise.all([
    supabase.from("health_checkups").select("id,person_id,checkup_date,hospital,cost").is("deleted_at", null)
      .order("checkup_date", { ascending: false }).then((r) => r.data ?? []),
    supabase.from("health_results").select("checkup_id,metric").not("abnormal_flag", "is", null).is("deleted_at", null).then((r) => r.data ?? []),
    (async () => {
      // สรุปทั้งครอบครัว = สิทธิ์ทั่วไป (สัญญาที่คุ้มครองเฉพาะโรค เช่น มะเร็ง ไม่บวกรวม · ตกลง 8 พ.ย. 2026)
      const { data: pols } = await supabase.from("insurance_policies").select("id,person_id").eq("status", "ACTIVE").is("deleted_at", null).not("person_id", "is", null)
        .is("coverage_scope", null);
      const owner = new Map((pols ?? []).map((x) => [x.id as string, x.person_id as string]));
      if (!owner.size) return [];
      const { data: covs } = await supabase.from("insurance_coverages").select("policy_id,coverage_type,limit_amount,currency")
        .in("policy_id", [...owner.keys()]).in("coverage_type", HEALTH_COV).is("deleted_at", null);
      return (covs ?? []).map((c) => ({ ...c, person_id: owner.get(c.policy_id) ?? "" }));
    })(),
  ]);
  return { checkups, abn, cov };
}

/** ทั้งครอบครัว: กล่องเดียว ตารางแถวละคน + แถวรวมท้ายตาราง (ตกลง 5 พ.ย. 2026) */
function FamilyView({ list, fam, yearAgo }: { list: { id: string; name: string }[]; fam: Awaited<ReturnType<typeof loadFamily>>; yearAgo: string }) {
  const rows = list.map((p) => {
    const cs = fam.checkups.filter((c) => c.person_id === p.id);
    const last = cs[0];
    const abn = last ? fam.abn.filter((r) => r.checkup_id === last.id) : [];
    const cost = cs.filter((c) => c.checkup_date > yearAgo).reduce((t, c) => t + Number(c.cost ?? 0), 0);
    // สิทธิ์หลัก 2 อย่างแรกตามลำดับ HEALTH_COV · หลายกรมธรรม์รวมวงเงินกัน (สกุลเดียวกับรายการแรก)
    const cov = HEALTH_COV.flatMap((t) => {
      const xs = fam.cov.filter((c) => c.person_id === p.id && c.coverage_type === t);
      if (!xs.length) return [];
      const cur = xs[0].currency ?? "THB";
      const sum = xs.filter((c) => (c.currency ?? "THB") === cur).reduce((a, c) => a + Number(c.limit_amount ?? 0), 0);
      return [`${COVERAGE_LABEL[t]?.[0] ?? t}${COVERAGE_LABEL[t]?.[1] ? ` ${COVERAGE_LABEL[t][1]}` : ""} ${money(sum, cur, 0)}`];
    }).slice(0, 2);
    return { ...p, last, abn, cost, cov, due: !last || last.checkup_date < yearAgo };
  });
  const due = rows.filter((r) => r.due);
  const abnTotal = rows.reduce((t, r) => t + r.abn.length, 0);
  const costTotal = rows.reduce((t, r) => t + r.cost, 0);
  return (
    <div className="space-y-6">
      {INFO}
      <HeaderFilters><PersonFilter persons={list} value="" shareNote={false} /></HeaderFilters>
      {/* กล่องเดียว: ตารางรายคน + แถวรวมทั้งครอบครัว (แทนกล่องภาพรวมที่ซ้ำกัน · ตกลง 5 พ.ย. 2026) */}
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สุขภาพทั้งครอบครัว</h2>
          <p className="mb-2 text-xs text-slate-500">กดที่ชื่อเพื่อดูผลย้อนหลังและบันทึกผลตรวจของคนนั้น</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1 pr-3">สมาชิก</th><th className="pr-3">ตรวจล่าสุด</th><th className="pr-3">ผิดปกติครั้งล่าสุด</th><th className="pr-3 text-right">ค่าตรวจ 12 เดือน</th><th>สิทธิ์ประกันสุขภาพ</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-3"><Link href={`/family/health?p=${r.id}`} scroll={false} className="font-medium text-blue-700 hover:underline">{r.name}</Link></td>
                    <td className="whitespace-nowrap pr-3">{r.last ? thDate(r.last.checkup_date) : <span className="text-amber-700">ยังไม่เคยตรวจ</span>}
                      {r.last && <div className={`text-xs ${r.due ? "text-amber-700" : "text-slate-500"}`}>{r.due ? "เกิน 1 ปีแล้ว" : r.last.hospital || "ภายใน 1 ปี"}</div>}</td>
                    <td className="pr-3">{!r.last ? "-" : r.abn.length === 0 ? <span className="text-slate-500">ปกติทั้งหมด</span> : (
                      <><span className="font-medium tabular-nums text-red-700">{r.abn.length} รายการ</span>
                        <div className="text-xs text-slate-500">{r.abn.slice(0, 3).map((x) => METRIC_LABEL[x.metric] ?? x.metric).join(" · ")}{r.abn.length > 3 ? " …" : ""}</div></>)}</td>
                    <td className="pr-3 text-right tabular-nums">{r.cost ? money(r.cost, "THB", 0) : "-"}</td>
                    <td className="text-xs">{r.cov.length ? r.cov.map((c) => <div key={c}>{c}</div>) : <span className="text-slate-500">-</span>}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot className="border-t border-slate-200 text-sm font-medium">
                  <tr className="align-top">
                    <td className="whitespace-nowrap py-2 pr-3">รวมทั้งครอบครัว</td>
                    <td className="whitespace-nowrap pr-3 pt-2">ตรวจแล้ว {rows.length - due.length} / {rows.length} คน
                      <div className={`text-xs font-normal ${due.length ? "text-amber-700" : "text-slate-500"}`}>{due.length ? `เกิน 1 ปี / ยังไม่เคยตรวจ ${due.length} คน` : "ทุกคนตรวจภายใน 1 ปี"}</div></td>
                    <td className="pr-3 pt-2">{abnTotal ? <span className="tabular-nums text-red-700">{abnTotal} รายการ</span> : <span className="font-normal text-slate-500">ไม่มีรายการผิดปกติ</span>}
                      {abnTotal > 0 && <div className="text-xs font-normal text-slate-500">จาก {rows.filter((r) => r.abn.length).length} คน</div>}</td>
                    <td className="pr-3 pt-2 text-right tabular-nums">{money(costTotal, "THB", 0)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
      </section>
    </div>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const year = today.slice(0, 4);
  const yearAgo = `${Number(year) - 1}${today.slice(4)}`;
  // ไม่เลือกคน = ทั้งครอบครัว (ตกลง 5 พ.ย. 2026) · เลือกคน = เริ่มดึงข้อมูลของคนนั้นพร้อมรายชื่อ (ไม่ต้องรอรายชื่อก่อน)
  const pid = sp.p ?? "";
  const personsP = supabase.from("persons").select("id,name").is("deleted_at", null).neq("status", "DECEASED").order("sort_order").order("created_at").then((r) => r.data ?? []);

  if (!pid) {
    const [list, fam] = await Promise.all([personsP, loadFamily(supabase)]);
    return <FamilyView list={list} fam={fam} yearAgo={yearAgo} />;
  }

  const ordering = canDelete && sp.order === "1";
  // ผลตรวจ + สิทธิ์ประกันสุขภาพของคนนี้ (อ่านอย่างเดียว · ตกลง 2 พ.ย. 2026) — ดึงพร้อมกัน ส่วนที่ต้องใช้ผลก่อนหน้าต่อกันในรอบเดียว
  const [list, { checkups, resultsRaw }, { pols, covs, claims }] = await Promise.all([
    personsP,
    (async () => {
      const { data: checkups } = await supabase.from("health_checkups").select("*").eq("person_id", pid).is("deleted_at", null).order("checkup_date", { ascending: false });
      const ids = (checkups ?? []).map((c) => c.id);
      const { data: resultsRaw } = ids.length ? await supabase.from("health_results").select("*").in("checkup_id", ids).is("deleted_at", null) : { data: [] as Res[] };
      return { checkups, resultsRaw };
    })(),
    (async () => {
      const { data: pols } = await supabase.from("insurance_policies").select("id,insurer,policy_no,end_date,plan_name,coverage_scope").eq("person_id", pid).eq("status", "ACTIVE").is("deleted_at", null);
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
  if (!list.some((p) => p.id === pid)) redirect("/family/health");   // ลิงก์เก่า / คนที่ถูกลบ → ทั้งครอบครัว
  const polName = new Map(pols.map((x) => [x.id, [x.insurer, x.policy_no, x.plan_name].filter(Boolean).join(" · ")]));
  const scopeOf = new Map(pols.map((x) => [x.id, x.coverage_scope as string | null]));
  const live = (c: { status: string }) => !["REJECTED", "CANCELLED"].includes(c.status);
  const usedOf = (covId: string) => claims.filter((c) => c.coverage_id === covId && live(c) && (c.claim_date ?? c.incident_date ?? "").startsWith(year))
    .reduce((t, c) => t + Number(c.received_amount ?? c.claimed_amount ?? 0), 0);
  const recentClaims = claims.slice(0, 5);
  // ลำดับรายการผลตรวจ (ตั้งได้ต่อสมาชิก) — ใช้ทั้งตารางผลย้อนหลังและผลแต่ละครั้ง
  const results = ((resultsRaw as Res[] | null) ?? []).sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9));
  const recent = checkups ?? [];   // ทุกครั้ง (เลื่อนซ้าย–ขวาได้) · แทนกล่องผลรายครั้งเดิม (ตกลง 5 พ.ย. 2026)
  const metrics = [...new Set(results.map((r) => r.metric))];
  const cellOf = (m: string, c: string) => results.find((r) => r.metric === m && r.checkup_id === c);
  const last = (checkups ?? [])[0];
  const lastAbn = last ? results.filter((r) => r.checkup_id === last.id && r.abnormal_flag) : [];
  const costYear = (checkups ?? []).filter((c) => c.checkup_date > yearAgo).reduce((t, c) => t + Number(c.cost ?? 0), 0);

  // ค่าปกติ / หน่วย ของแต่ละรายการ = จากผลครั้งล่าสุดที่มีรายการนั้น
  const refOf = (m: string) => {
    for (const c of recent) {
      const r = cellOf(m, c.id);
      if (r) return [r.reference_text ?? (r.reference_min != null || r.reference_max != null ? `${r.reference_min ?? ""}–${r.reference_max ?? ""}` : ""), r.unit].filter(Boolean).join(" ");
    }
    return "";
  };
  const noted = recent.filter((c) => c.package_name || c.cost != null || c.notes);

  return (
    <div className="space-y-6">
      {INFO}
      <HeaderFilters><PersonFilter persons={list} value={pid} shareNote={false} /></HeaderFilters>

      {/* กล่องเดียว: สรุปเป็นบรรทัดใต้ชื่อกล่อง + ตารางผลย้อนหลังเต็มความกว้าง (ตกลง 5 พ.ย. 2026) */}
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-baseline gap-3">
              {/* ⓘ อยู่ที่ชื่อกล่อง ไม่อยู่ในหัวคอลัมน์ "รายการ": ช่องแรกของทุกแถวตรึงไว้ (พื้นขาว) จะทับกล่องคำอธิบาย */}
              <h2 className="font-medium text-slate-900">ผลตรวจสุขภาพ{recent.length > 0 && <> <InfoTip label="คำอธิบาย">● = ผิดปกติตามใบผล (สีแดง = สูง / ผิดปกติ · สีฟ้า = ต่ำ){canWrite && " · กดที่ตัวเลขเพื่อแก้ผลรายการนั้น · ปุ่มแก้ไขใต้วันที่ = แก้ / ลบผลตรวจครั้งนั้น"}</InfoTip></>}</h2>
              {canDelete && metrics.length > 1 && <SortToggle active={ordering} {...orderHrefs("/family/health", { p: pid })} />}
            </div>
            {canWrite && <ActionBar className="shrink-0"><CheckupForm personId={pid} today={today} /></ActionBar>}
          </div>
          {last && (
            <dl className="mb-4 mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">ตรวจล่าสุด</dt>
                <dd className="font-medium">{thDate(last.checkup_date)}
                  <span className={`ml-2 text-xs font-normal ${last.checkup_date < yearAgo ? "text-amber-700" : "text-slate-500"}`}>
                    {last.checkup_date < yearAgo ? "เกิน 1 ปีแล้ว ควรตรวจประจำปี" : last.hospital || "ภายใน 1 ปี"}</span></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">ผิดปกติในครั้งล่าสุด</dt>
                <dd className={`font-medium tabular-nums ${lastAbn.length ? "text-red-700" : ""}`}>{lastAbn.length ? `${lastAbn.length} รายการ` : "ปกติทั้งหมด"}
                  {lastAbn.length > 0 && <span className="ml-2 text-xs font-normal text-slate-500">{lastAbn.map((r) => METRIC_LABEL[r.metric] ?? r.metric).join(" · ")}</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">ค่าตรวจ 12 เดือนล่าสุด</dt>
                <dd className="font-medium tabular-nums">{money(costYear, "THB", 0)}</dd>
              </div>
            </dl>
          )}
          {recent.length === 0 ? <p className="mt-3 text-sm text-slate-500">ยังไม่มีผลตรวจ</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="align-bottom">
                      <th className="sticky left-0 z-10 bg-white py-1 pr-2">รายการ</th>
                      <th className="whitespace-nowrap px-2">ค่าปกติ</th>
                      {recent.map((c) => (
                        <th key={c.id} className="whitespace-nowrap px-2 text-right font-normal">
                          <div className="font-medium text-slate-700">{thDate(c.checkup_date)}</div>
                          {c.hospital && <div className="max-w-[9rem] truncate" title={c.hospital}>{c.hospital}</div>}
                          {canWrite && <div className="mt-1"><RowActions table="health_checkups" id={c.id} paths={PATHS} canDelete={canDelete} button="แก้ไข" buttonClass={SMALL_BTN}
                            deleteEffect="ผลรายการตรวจของครั้งนี้จะไม่แสดงอีก (ไม่มีเงินเข้า–ออกบัญชีเกี่ยวข้อง)" fields={[
                            { name: "checkup_date", label: "วันที่", type: "date", value: c.checkup_date }, { name: "hospital", label: "โรงพยาบาล", value: c.hospital },
                            { name: "package_name", label: "แพ็กเกจ", value: c.package_name }, { name: "cost", label: "ค่าใช้จ่าย", type: "number", value: c.cost },
                            { name: "notes", label: "หมายเหตุ / คำแนะนำแพทย์", value: c.notes, wide: true }]} /></div>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.length === 0 && <tr><td colSpan={recent.length + 2} className="py-3 text-center text-slate-500">ยังไม่มีผลรายการตรวจ</td></tr>}
                    {metrics.map((m, i) => (
                      <tr key={m}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1.5 pr-2">
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
                        <td className="whitespace-nowrap px-2 text-xs text-slate-500">{refOf(m)}</td>
                        {recent.map((c) => {
                          const r = cellOf(m, c.id);
                          const cls = `tabular-nums ${r?.abnormal_flag ? FLAG[r.abnormal_flag]?.cls : ""}`;
                          const text = r ? `${fmt(r)}${r.abnormal_flag ? " ●" : ""}` : "";
                          return (
                            <td key={c.id} className="whitespace-nowrap px-2 text-right">
                              {r && canWrite ? <RowActions table="health_results" id={r.id} paths={PATHS} canDelete={canDelete} button={text}
                                buttonClass={`${cls} underline decoration-dotted underline-offset-2 hover:text-blue-700`} fields={[
                                { name: "value_numeric", label: "ผล", type: "number", value: r.value_numeric }, { name: "unit", label: "หน่วย", value: r.unit, width: "w-20" },
                                { name: "reference_min", label: "ต่ำสุด", type: "number", value: r.reference_min, width: "w-20" },
                                { name: "reference_max", label: "สูงสุด", type: "number", value: r.reference_max, width: "w-20" },
                                { name: "abnormal_flag", label: "ผิดปกติ", type: "select", value: r.abnormal_flag ?? "", options: [["", "ปกติ"], ["H", "สูง"], ["L", "ต่ำ"], ["ABNORMAL", "ผิดปกติ"]] }]} />
                                : <span className={cls}>{text}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {noted.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  {noted.map((c) => (
                    <li key={c.id}><span className="font-medium text-slate-700">{thDate(c.checkup_date)}</span>
                      {" · "}{[c.package_name, c.cost != null ? `ค่าใช้จ่าย ${money(c.cost, c.currency ?? "THB", 0)}` : null, c.notes].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              )}
            </>
          )}
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
                          {scopeOf.get(c.policy_id) && <span className="ml-1 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">เฉพาะ{scopeOf.get(c.policy_id)}</span>}
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

    </div>
  );
}
