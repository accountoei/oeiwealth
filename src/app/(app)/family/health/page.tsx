import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import CheckupForm from "./CheckupForm";
import PersonPicker from "./PersonPicker";
import { METRIC_LABEL } from "./metrics";

type Res = { id: string; checkup_id: string; metric: string; value_numeric: number | null; value_text: string | null; unit: string | null;
  reference_min: number | null; reference_max: number | null; reference_text: string | null; abnormal_flag: string | null; notes: string | null };
const FLAG: Record<string, { text: string; cls: string }> = { H: { text: "สูง", cls: "text-red-700" }, L: { text: "ต่ำ", cls: "text-sky-700" }, ABNORMAL: { text: "ผิดปกติ", cls: "text-red-700" } };
const fmt = (r: Res) => (r.value_numeric != null ? Number(r.value_numeric).toLocaleString("th-TH", { maximumFractionDigits: 2 }) : r.value_text ?? "-");

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const { data: persons } = await supabase.from("persons").select("id,name").is("deleted_at", null).neq("status", "DECEASED").order("created_at");
  const list = persons ?? [];
  const pid = list.some((p) => p.id === sp.p) ? (sp.p as string) : me.person_id && list.some((p) => p.id === me.person_id) ? me.person_id : list[0]?.id;
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  if (!pid) return <p className="text-sm text-slate-500">ยังไม่มีสมาชิกครอบครัว</p>;

  const { data: checkups } = await supabase.from("health_checkups").select("*").eq("person_id", pid).is("deleted_at", null).order("checkup_date", { ascending: false });
  const ids = (checkups ?? []).map((c) => c.id);
  const { data: resultsRaw } = ids.length
    ? await supabase.from("health_results").select("*").in("checkup_id", ids).is("deleted_at", null)
    : { data: [] as Res[] };
  const results = (resultsRaw as Res[] | null) ?? [];
  const recent = (checkups ?? []).slice(0, 6);
  const metrics = [...new Set(results.map((r) => r.metric))];
  const cellOf = (m: string, c: string) => results.find((r) => r.metric === m && r.checkup_id === c);
  const paths = ["/family/health"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Health</h1>
          <p className="text-sm text-slate-500">ผลตรวจสุขภาพประจำปีของสมาชิก · ข้อมูลอ่อนไหว ผู้ใช้ทุกคนในระบบเห็นได้ตามสิทธิ์</p>
        </div>
        <PersonPicker persons={list} value={pid} />
      </div>

      {canWrite && <CheckupForm personId={pid} today={todayBangkok()} />}

      {metrics.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">ผลย้อนหลัง</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">รายการ</th>{recent.map((c) => <th key={c.id} className="px-2 text-right">{thDate(c.checkup_date)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((m) => (
                <tr key={m}>
                  <td className="py-1.5">{METRIC_LABEL[m] ?? m}</td>
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
