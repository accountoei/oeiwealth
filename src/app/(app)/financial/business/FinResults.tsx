import { money, signedPct } from "@/lib/format";
import { AUDIT_LABEL, calcYears, type FinCalc, type FinYear } from "@/lib/biz-financials";
import ModalButton from "@/components/ModalButton";
import { InfoTip } from "@/components/HeaderBar";
import { FinYearEdit, FinYearForm, ResultsCharts, ResultsView, type FinOwner, type ValueHelp } from "./results";

// ผลประกอบการ (ตกลง 9 พ.ย. 2026): กราฟ + ตารางรายปี + สินทรัพย์ถาวร — ใช้ในหน้ากิจการ / บริษัทที่ปิดแล้ว / ภาพรวมกลุ่ม
//   ตัวเลขทั้งบริษัท 100% · ปีล่าสุดอยู่บนในตาราง · กราฟเรียงปีน้อย → มาก (ปีที่ไม่มีข้อมูล = ช่องว่าง)

const red = (v: number | null) => (v != null && v < -0.005 ? "text-red-700" : "");
const m0 = (v: number | null | undefined) => <M v={v} />;
const pctTxt = (v: number | null, signed = false) => (v == null ? "-" : signed ? signedPct(v, 1) : `${v.toFixed(1)}%`);

/** ช่วงปีต่อเนื่อง จากปีแรกถึงปีล่าสุดที่มีข้อมูล */
export function yearSpan(rows: { fiscal_year: number }[]): number[] {
  if (!rows.length) return [];
  const ys = rows.map((r) => r.fiscal_year);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** ยอดเงินในตาราง: ล้านบาท (ค่าเริ่มต้น) / บาท ตามปุ่มหน่วยของ ResultsView (data-u ของกล่อง group/v) */
export function M({ v }: { v: number | null | undefined }) {
  if (v == null) return <>-</>;
  return <><span className="group-data-[u=b]/v:hidden">{(v / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    <span className="hidden group-data-[u=b]/v:inline">{money(v)}</span></>;
}
/** หน่วยที่หัวตาราง */
export function Unit() {
  return <><span className="group-data-[u=b]/v:hidden">ล้านบาท</span><span className="hidden group-data-[u=b]/v:inline">บาท</span></>;
}
/** แถวลำดับที่ i (0 = ปีล่าสุด) ซ่อนตามช่วงที่เลือก (data-r ของ ResultsView) */
export function rangeCls(i: number) {
  return [i >= 3 ? "group-data-[r=3]/v:hidden" : "", i >= 5 ? "group-data-[r=5]/v:hidden" : "", i >= 10 ? "group-data-[r=10]/v:hidden" : ""].join(" ");
}

/** ป้ายสถานะงบ: บริษัทเดียว = ชื่อสถานะ · ทั้งกลุ่ม = "ตรวจแล้ว 4/6" (ชี้ดูบริษัทที่ยังไม่ตรวจ · 9 พ.ย. 2026) */
export function AuditTag({ r, names, className = "ml-1" }: { r: FinCalc; names?: Record<string, string>; className?: string }) {
  const many = r.auditN != null && r.auditN > 1;
  const who = (r.pendingIds ?? []).map((k) => names?.[k] ?? "").filter(Boolean).join(", ");
  return <span className={`${className} rounded bg-amber-50 px-1 text-[11px] font-normal whitespace-nowrap text-amber-700`} title={who ? `ยังไม่ตรวจสอบ: ${who}` : undefined}>
    {many ? `ตรวจแล้ว ${r.auditOk}/${r.auditN}` : AUDIT_LABEL[r.audit_status] ?? r.audit_status}</span>;
}

/** ตารางรายปี (ใช้ร่วม: บริษัทเดียว / ทั้งกลุ่ม) · 1 ปี = 1 บรรทัด · หัวตารางเป็นกลุ่ม · edit = ใส่ปุ่มแก้ในแถว (กดแถว)
 *  ต้องอยู่ใน ResultsView (ช่วงปี + หน่วย) */
export function FinTable({ rows, edit, names }: { rows: FinCalc[]; edit?: (r: FinCalc) => React.ReactNode;
  /** ภาพรวมกลุ่ม: ชื่อบริษัทตามรหัส (บอกว่าบริษัทไหนงบยังไม่ตรวจ) */ names?: Record<string, string> }) {
  const th = (l: React.ReactNode, cls = "text-right") => <th className={`whitespace-nowrap px-2 py-1.5 font-medium ${cls}`}>{l}</th>;
  const grp = (l: string, n: number) => <th colSpan={n} className="border-l border-slate-200 px-2 pt-2 pb-0.5 text-center font-semibold text-slate-600">{l}</th>;
  const td = "whitespace-nowrap px-2 py-2 text-right tabular-nums";
  const sep = "border-l border-slate-100";
  const list = [...rows].reverse();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th rowSpan={2} className="px-2 py-1.5 text-left align-bottom font-medium">ปี</th>
            {grp("รายได้", 5)}{grp("กำไร", 4)}{grp("พนักงาน", 2)}
          </tr>
          <tr>
            {th("ในประเทศ", `text-right border-l border-slate-200`)}{th("ต่างประเทศ")}{th("% ตปท.")}{th("รวม")}{th("% โต")}
            {th("กำไร (ขาดทุน)", "text-right border-l border-slate-200")}{th("% กำไร")}{th("ภาษีเงินได้")}{th("กำไรสะสม")}
            {th("คน", "text-right border-l border-slate-200")}{th("รายได้ / คน")}
          </tr>
          <tr><th colSpan={12} className="px-2 pb-1 text-right text-[11px] font-normal text-slate-400">หน่วย: <Unit /> · คน = รวมผู้บริหาร</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((r, i) => (
            <tr key={r.id} className={rangeCls(i)}>
              <td className="whitespace-nowrap px-2 py-2">
                <span className="font-medium">{r.fiscal_year + 543}</span>
                {r.audit_status !== "AUDITED" && <AuditTag r={r} names={names} />}
                {r.notes && <span className="ml-1 inline-block max-w-28 truncate align-bottom text-xs text-slate-500" title={r.notes}>{r.notes}</span>}
                {edit?.(r)}
              </td>
              <td className={`${td} ${sep}`}><M v={r.revenue_domestic} /></td>
              <td className={td}><M v={r.revenue_foreign} /></td>
              <td className={`${td} text-slate-500`}>{r.foreignPct ? pctTxt(r.foreignPct) : "-"}</td>
              <td className={`${td} font-medium`}><M v={r.revenue} /></td>
              <td className={`${td} ${red(r.growthPct)}`}>{pctTxt(r.growthPct, true)}</td>
              <td className={`${td} ${sep} font-medium ${red(r.net_profit)}`}><M v={r.net_profit} /></td>
              <td className={`${td} ${red(r.marginPct)}`}>{pctTxt(r.marginPct)}</td>
              <td className={td}><M v={r.corporate_tax} /></td>
              <td className={`${td} ${red(r.retained)}`}><M v={r.retained} /></td>
              <td className={`${td} ${sep}`} title={r.executives ? `ผู้บริหาร ${r.executives} คน · พนักงาน ${r.staff ?? "-"} คน` : undefined}>{r.employees ?? "-"}</td>
              <td className={td}><M v={r.revPerHead} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** สินทรัพย์ถาวร ณ 31 ธ.ค. ของปีหนึ่ง (แบบแผ่น ASSET) — หลายบริษัท = หลายแถว + แถวรวม */
export function FixedAssetTable({ rows, named }: { rows: { key: string; name: React.ReactNode; r: FinCalc }[]; /** แสดงคอลัมน์บริษัท + แถวรวม */ named?: boolean }) {
  const th = (l: string, cls = "text-right") => <th className={`whitespace-nowrap px-2 py-2 font-medium ${cls}`}>{l}</th>;
  const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
  const sum = (f: (r: FinCalc) => number | null) => rows.reduce((t, x) => t + (f(x.r) ?? 0), 0);
  const many = named ?? rows.length > 1;
  const cells = (r: { land: number | null; bc: number | null; bd: number | null; bn: number | null; ec: number | null; ed: number | null; en: number | null; tc: number | null; tdp: number | null; tn: number | null }) => <>
    <td className={td}>{m0(r.land)}</td>
    <td className={td}>{m0(r.bc)}</td><td className={td}>{m0(r.bd)}</td><td className={`${td} font-medium`}>{m0(r.bn)}</td>
    <td className={td}>{m0(r.ec)}</td><td className={td}>{m0(r.ed)}</td><td className={`${td} font-medium`}>{m0(r.en)}</td>
    <td className={td}>{m0(r.tc)}</td><td className={td}>{m0(r.tdp)}</td><td className={`${td} font-semibold`}>{m0(r.tn)}</td>
  </>;
  const of = (r: FinCalc) => ({ land: r.land_value, bc: r.building_cost, bd: r.building_depreciation, bn: r.buildingNet, ec: r.equipment_cost,
    ed: r.equipment_depreciation, en: r.equipmentNet, tc: r.fixedCost, tdp: r.fixedDep, tn: r.fixedNet });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {many && <th className="px-2 py-2" />}{th("ที่ดิน")}
            <th colSpan={3} className="border-l border-slate-200 px-2 py-1 text-center font-medium">อาคาร / สิ่งปลูกสร้าง</th>
            <th colSpan={3} className="border-l border-slate-200 px-2 py-1 text-center font-medium">เครื่องจักร / อุปกรณ์ / ยานพาหนะ</th>
            <th colSpan={3} className="border-l border-slate-200 px-2 py-1 text-center font-medium">รวมสินทรัพย์ถาวร</th>
          </tr>
          <tr>
            {many && th("บริษัท", "text-left")}{th("มูลค่า")}
            {th("มูลค่า")}{th("ค่าเสื่อมสะสม")}{th("คงเหลือ")}{th("มูลค่า")}{th("ค่าเสื่อมสะสม")}{th("คงเหลือ")}{th("มูลค่า")}{th("ค่าเสื่อมสะสม")}{th("คงเหลือ")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((x) => <tr key={x.key}>{many && <td className="whitespace-nowrap px-2 py-1.5">{x.name}</td>}{cells(of(x.r))}</tr>)}
        </tbody>
        {many && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
            <tr><td className="px-2 py-2">รวม</td>{cells({ land: sum((r) => r.land_value), bc: sum((r) => r.building_cost), bd: sum((r) => r.building_depreciation),
              bn: sum((r) => r.buildingNet), ec: sum((r) => r.equipment_cost), ed: sum((r) => r.equipment_depreciation), en: sum((r) => r.equipmentNet),
              tc: sum((r) => r.fixedCost), tdp: sum((r) => r.fixedDep), tn: sum((r) => r.fixedNet) })}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** แปลงแถวเป็นข้อมูลกราฟ ตามช่วงปี */
export function chartData(years: number[], rows: FinCalc[]) {
  const by = new Map(rows.map((r) => [r.fiscal_year, r]));
  return {
    domestic: years.map((y) => by.get(y)?.revenue_domestic ?? null),
    foreign: years.map((y) => by.get(y)?.revenue_foreign ?? null),
    profit: years.map((y) => by.get(y)?.net_profit ?? null),
    revenue: years.map((y) => (by.has(y) ? by.get(y)!.revenue : null)),
  };
}

/** กล่อง "ผลประกอบการ" ของบริษัทเดียว (กิจการ หรือ บริษัทที่ปิดแล้ว) */
export default function FinResults({ owner, rows: raw, canWrite, canDelete, value, events }: {
  owner: FinOwner; rows: FinYear[]; canWrite: boolean; canDelete: boolean; value?: ValueHelp; events?: Record<number, string[]>;
}) {
  const rows = calcYears(raw);
  const years = yearSpan(rows);
  const cd = chartData(years, rows);
  const last = rows.at(-1);
  const fixed = [...rows].reverse().find((r) => r.hasFixed);
  const fixedYears = rows.filter((r) => r.hasFixed);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">ผลประกอบการ <InfoTip label="คำอธิบาย">ตัวเลขของทั้งบริษัท (100%) ตามงบการเงิน · ข้อมูลดูอย่างเดียว ไม่ลงรายได้ / ไม่นับในความมั่งคั่งสุทธิ · กำไรสะสม = กำไรรวมทุกปีที่บันทึก − ปันผลที่บริษัทจ่ายรวม · กดแถวเพื่อแก้ไข</InfoTip></h2>
        {canWrite && <ModalButton label="+ เพิ่มปี" title="เพิ่มผลประกอบการ" size="lg" primary>
          <FinYearForm owner={owner} nextYear={last ? last.fiscal_year + 1 : new Date().getFullYear() - 1} />
        </ModalButton>}
      </div>
      {rows.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล{canWrite && " · กด “+ เพิ่มปี”"}</p> : (
        <ResultsView years={rows.length} charts>
          <ResultsCharts years={years} domestic={cd.domestic} foreign={cd.foreign} profit={cd.profit} events={events} />
          <FinTable rows={rows} edit={canWrite ? (r) => <FinYearEdit owner={owner} row={raw.find((x) => x.id === r.id)!} canDelete={canDelete} value={value} /> : undefined} />
          {fixed && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-800">สินทรัพย์ถาวร ณ 31 ธ.ค. {fixed.fiscal_year + 543}
                <span className="font-normal text-slate-500"> · หน่วย: <Unit />{fixedYears.length > 1 && " · ปีอื่นดูได้ในแถวของปีนั้น"}</span></h3>
              <FixedAssetTable rows={[{ key: fixed.id, name: null, r: fixed }]} />
            </div>
          )}
        </ResultsView>
      )}
    </section>
  );
}

