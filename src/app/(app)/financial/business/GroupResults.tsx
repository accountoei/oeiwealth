import Link from "next/link";
import { money, thDate } from "@/lib/format";
import { calcYears, groupYears, type FinYear } from "@/lib/biz-financials";
import ModalButton from "@/components/ModalButton";
import { InfoTip } from "@/components/HeaderBar";
import { FinTable, FixedAssetTable, chartData, yearSpan } from "./FinResults";
import { FixedYearSelect, PastBusinessForm, ResultsCharts, ResultsView } from "./results";

export type GroupCo = { key: string; name: string; href: string; color: string; established: string | null; closed: string | null;
  /** ปิดแล้ว = บริษัทในประวัติ */ past: boolean; inactive: boolean; rows: FinYear[] };

/**
 * แท็บ "ผลประกอบการ" (ตกลง 9 พ.ย. 2026): ภาพรวมทั้งกลุ่มแบบ GRAND TOTAL ของไฟล์สรุปเดิม
 *   รวมทุกบริษัท 100% (ไม่คูณ % ที่ครอบครัวถือ) · รวมบริษัทที่ปิดแล้วในปีที่ยังเปิดอยู่
 *   รายการบริษัท (ไปหน้าบริษัท) · สินทรัพย์ถาวร ณ 31 ธ.ค. ของปีที่เลือก
 */
export default function GroupResults({ companies, fy, canWrite }: { companies: GroupCo[]; fy?: number; canWrite: boolean }) {
  const all = companies.flatMap((c) => c.rows);
  const group = groupYears(all);
  const years = yearSpan(all);
  const cd = chartData(years, group);
  const withData = companies.filter((c) => c.rows.length > 0);
  const series = withData.map((c) => {
    const d = chartData(years, calcYears(c.rows));
    return { key: c.key, label: c.name, color: c.color, revenue: d.revenue, profit: d.profit };
  });
  const events: Record<number, string[]> = {};
  const addEv = (y: number, t: string) => { events[y] = [...(events[y] ?? []), t]; };
  companies.forEach((c) => {
    if (c.established) addEv(Number(c.established.slice(0, 4)), `${c.name} เปิด`);
    if (c.closed) addEv(Number(c.closed.slice(0, 4)), `${c.name} ปิด`);
  });
  const fixedYears = [...new Set(all.filter((r) => [r.land_value, r.building_cost, r.equipment_cost].some((v) => v != null)).map((r) => r.fiscal_year))].sort((a, b) => b - a);
  const fyear = fy != null && fixedYears.includes(fy) ? fy : fixedYears[0];
  const fixedRows = fyear == null ? [] : companies.flatMap((c) => {
    const r = calcYears(c.rows).find((x) => x.fiscal_year === fyear && x.hasFixed);
    return r ? [{ key: c.key, name: <Link href={c.href} className="hover:underline">{c.name}</Link>, r }] : [];
  });
  const th = (l: string, cls = "text-right") => <th className={`whitespace-nowrap px-3 py-2 font-medium ${cls}`}>{l}</th>;
  const td = "whitespace-nowrap px-3 py-2 text-right tabular-nums";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ผลประกอบการทั้งกลุ่ม <InfoTip label="คำอธิบาย">รวมตัวเลขทั้งบริษัท (100%) ของทุกบริษัทในแต่ละปี รวมบริษัทที่ปิดแล้วในปีที่ยังเปิดอยู่ · ไม่คูณ % ที่ครอบครัวถือ · ไม่เปลี่ยนตามสมาชิกที่เลือก · ▲ = ปีที่บริษัทเปิด / ปิด</InfoTip></h2>
        {group.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล · ใส่ผลประกอบการได้ที่หน้าของแต่ละกิจการ (กล่อง &ldquo;ผลประกอบการ&rdquo;)</p> : (
          <ResultsView years={group.length}>
            <ResultsCharts years={years} domestic={cd.domestic} foreign={cd.foreign} profit={cd.profit} companies={series} events={events} />
            <FinTable rows={group} />
          </ResultsView>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">บริษัท</h2>
          {canWrite && <ModalButton label="+ เพิ่มบริษัทที่ปิดแล้ว" title="เพิ่มบริษัทที่ปิดแล้ว" primary><PastBusinessForm /></ModalButton>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>{th("บริษัท", "text-left")}{th("จัดตั้ง", "text-left")}{th("ปีที่มีข้อมูล", "text-left")}{th("รายได้ปีล่าสุด")}{th("กำไร (ขาดทุน) ปีล่าสุด")}{th("กำไรสะสม")}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => {
                const rs = calcYears(c.rows);
                const last = rs.at(-1);
                return (
                  <tr key={c.key} className={c.inactive ? "text-slate-500" : ""}>
                    <td className="px-3 py-2">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: c.color }} />
                      <Link href={c.href} className="font-medium text-slate-900 hover:underline">{c.name}</Link>
                      {c.past && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">ปิดแล้ว{c.closed ? ` ${Number(c.closed.slice(0, 4)) + 543}` : ""}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{thDate(c.established)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{rs.length ? `${rs[0].fiscal_year + 543} – ${last!.fiscal_year + 543} (${rs.length} ปี)` : "-"}</td>
                    <td className={td}>{last ? money(last.revenue) : "-"}</td>
                    <td className={`${td} ${last?.net_profit != null && last.net_profit < 0 ? "text-red-700" : ""}`}>{last?.net_profit != null ? money(last.net_profit) : "-"}</td>
                    <td className={`${td} ${last && last.retained < 0 ? "text-red-700" : ""}`}>{last ? money(last.retained) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {fyear != null && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium text-slate-900">สินทรัพย์ถาวรของกลุ่ม</h2>
            <FixedYearSelect years={fixedYears} value={fyear} />
          </div>
          <ResultsView years={0}><FixedAssetTable rows={fixedRows} named /></ResultsView>
        </section>
      )}
    </div>
  );
}
