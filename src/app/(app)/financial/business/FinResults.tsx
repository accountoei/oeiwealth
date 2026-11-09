import { money, signedPct } from "@/lib/format";
import { AUDIT_LABEL, calcYears, type FinCalc, type FinYear } from "@/lib/biz-financials";
import ModalButton from "@/components/ModalButton";
import { InfoTip } from "@/components/HeaderBar";
import { FinYearEdit, FinYearForm, ResultsCharts, ShowAllRows, type FinOwner, type ValueHelp } from "./results";

// ผลประกอบการ (ตกลง 9 พ.ย. 2026): กราฟ + ตารางรายปี + สินทรัพย์ถาวร — ใช้ในหน้ากิจการ / บริษัทที่ปิดแล้ว / ภาพรวมกลุ่ม
//   ตัวเลขทั้งบริษัท 100% · ปีล่าสุดอยู่บนในตาราง · กราฟเรียงปีน้อย → มาก (ปีที่ไม่มีข้อมูล = ช่องว่าง)

const red = (v: number | null) => (v != null && v < -0.005 ? "text-red-700" : "");
const m0 = (v: number | null | undefined) => (v == null ? "-" : money(v));
const pctTxt = (v: number | null, signed = false) => (v == null ? "-" : signed ? signedPct(v, 1) : `${v.toFixed(1)}%`);

/** ช่วงปีต่อเนื่อง จากปีแรกถึงปีล่าสุดที่มีข้อมูล */
export function yearSpan(rows: { fiscal_year: number }[]): number[] {
  if (!rows.length) return [];
  const ys = rows.map((r) => r.fiscal_year);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** ตารางรายปี (ใช้ร่วม: บริษัทเดียว / ทั้งกลุ่ม) · edit = ใส่ปุ่มแก้ในแถว (กดแถว) */
export function FinTable({ rows, edit }: { rows: FinCalc[]; edit?: (r: FinCalc) => React.ReactNode }) {
  const th = (l: React.ReactNode, cls = "text-right") => <th className={`whitespace-nowrap px-2 py-2 font-medium ${cls}`}>{l}</th>;
  const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
  const list = [...rows].reverse();
  const SHOWN = 10;
  return (
    <ShowAllRows total={list.length} shown={SHOWN}>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {th("ปี", "text-left")}{th("รายได้ในประเทศ")}{th("รายได้ต่างประเทศ")}{th("รายได้รวม")}{th("% โต")}
            {th("กำไร (ขาดทุน)")}{th("% กำไร")}{th("ภาษีเงินได้")}{th("จ่ายปันผล")}{th("กำไรสะสม")}{th("พนักงาน")}{th("รายได้ / คน / ปี")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((r, i) => (
            <tr key={r.id} className={`align-top ${i >= SHOWN ? "group-data-[all=false]:hidden" : ""}`}>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="font-medium">{r.fiscal_year + 543}</span>
                {r.audit_status !== "AUDITED" && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] text-amber-700">{AUDIT_LABEL[r.audit_status] ?? r.audit_status}</span>}
                {r.notes && <div className="max-w-40 truncate text-xs text-slate-500" title={r.notes}>{r.notes}</div>}
                {edit?.(r)}
              </td>
              <td className={td}>{m0(r.revenue_domestic)}</td>
              <td className={td}>{m0(r.revenue_foreign)}{r.foreignPct != null && r.foreignPct > 0 && <div className="text-xs text-slate-500">{pctTxt(r.foreignPct)}</div>}</td>
              <td className={`${td} font-medium`}>{money(r.revenue)}</td>
              <td className={`${td} ${red(r.growthPct)}`}>{pctTxt(r.growthPct, true)}</td>
              <td className={`${td} font-medium ${red(r.net_profit)}`}>{m0(r.net_profit)}</td>
              <td className={`${td} ${red(r.marginPct)}`}>{pctTxt(r.marginPct)}</td>
              <td className={td}>{m0(r.corporate_tax)}</td>
              <td className={td}>{r.dividends_paid ? money(r.dividends_paid) : "-"}</td>
              <td className={`${td} ${red(r.retained)}`}>{money(r.retained)}</td>
              <td className={td}>{r.employees ?? "-"}{r.executives ? <div className="text-xs text-slate-500">ผู้บริหาร {r.executives}</div> : null}</td>
              <td className={td}>{r.revPerHead != null ? money(r.revPerHead) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </ShowAllRows>
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
            <th colSpan={3} className="border-l border-slate-200 px-2 py-1 text-center font-medium">ยานพาหนะ / เครื่องจักร / อุปกรณ์</th>
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
        <div className="space-y-6">
          <ResultsCharts years={years} domestic={cd.domestic} foreign={cd.foreign} profit={cd.profit} events={events} />
          <FinTable rows={rows} edit={canWrite ? (r) => <FinYearEdit owner={owner} row={raw.find((x) => x.id === r.id)!} canDelete={canDelete} value={value} /> : undefined} />
          {fixed && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-800">สินทรัพย์ถาวร ณ 31 ธ.ค. {fixed.fiscal_year + 543}
                {fixedYears.length > 1 && <span className="font-normal text-slate-500"> · ปีอื่นดูได้ในแถวของปีนั้น</span>}</h3>
              <FixedAssetTable rows={[{ key: fixed.id, name: null, r: fixed }]} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

