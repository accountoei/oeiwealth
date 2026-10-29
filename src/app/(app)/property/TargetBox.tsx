import type { ReactNode } from "react";
import RowActions from "@/components/RowActions";
import ModalButton from "@/components/ModalButton";
import CostItemForm, { type CostLot } from "./CostItemForm";
import { diffText, money, thDate } from "@/lib/format";

export type TargetPrice = {
  asset_id: string; currency: string; rate_pct: number | null; rate_source: string | null; lot_count: number; building_count: number;
  cost_total: number | null; interest_total: number | null; depreciation_total: number | null; carrying_value: number | null;
  market_value: number | null; market_date: string | null; min_price: number | null; net_income_thb: number;
};

const SOURCE_LABEL: Record<string, string> = { ACQUISITION: "ราคาที่ได้มา", PAYMENT: "จ่ายเพิ่ม (ในระบบ)", MANUAL: "ต้นทุนเพิ่ม" };

/**
 * ราคาขายขั้นต่ำที่คุ้ม (อ้างอิง · ไม่นับใน Net Worth · ตกลง 28 ต.ค. 2026) — อยู่ใต้มูลค่าล่าสุด ก่อนราคาตลาด (ตกลง 29 ต.ค. 2026)
 *   ต้นทุนแต่ละก้อน + ดอกเบี้ยทบต้นตามระยะเวลาถือ − ค่าเสื่อมสิ่งปลูกสร้าง + ค่าใช้จ่ายขาย (จากราคาตลาดครั้งล่าสุด) · เทียบมูลค่าล่าสุด
 *   รายได้ − ค่าใช้จ่ายที่บันทึกแล้ว แสดงประกอบ (ไม่หัก) · ตารางต้นทุนรายก้อน อยู่ในปุ่ม "ดูวิธีคิด" (CostLotsSection)
 */
export default function TargetBox({ currency, target, unit, nwValue, lots }: {
  currency: string; target: TargetPrice | null; /** มูลค่าล่าสุด (Net Worth) */ nwValue: number;
  /** ตารางต้นทุนรายก้อน + ดอกเบี้ย + ค่าเสื่อม (เปิดดูในหน้าต่าง) */ lots?: ReactNode;
  /** เนื้อที่สำหรับราคาต่อหน่วย (ตามราคาตลาดครั้งล่าสุด หรือเนื้อที่โฉนด) */ unit: { area: number; label: string } | null;
}) {
  const t = target;
  const min = t?.min_price != null ? Number(t.min_price) : null;
  const carrying = t?.carrying_value != null ? Number(t.carrying_value) : null;
  const line = (label: string, value: string, cls = "") => (
    <div className="flex justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className={`tabular-nums ${cls}`}>{value}</dd></div>
  );
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="text-xs text-slate-500">ราคาขายขั้นต่ำที่คุ้ม <span className="text-slate-400">(ต้นทุน + ดอกเบี้ย · ไม่นับใน Net Worth)</span></div>
      {min == null ? (
        <p className="mt-1 text-sm text-slate-500">ยังไม่มีต้นทุน · ใส่ต้นทุนที่ได้มาในตารางส่วนประกอบ (ปุ่ม &ldquo;แก้ไข&rdquo; ของรายละเอียด)</p>
      ) : (<>
        <div className="mt-1 text-xl font-semibold tabular-nums">{money(min, currency, 0)}</div>
        {unit && unit.area > 0 && <div className="text-xs text-slate-500">≈ {money(min / unit.area, undefined, 0)} / {unit.label}</div>}
        {t?.rate_pct == null && <p className="mt-1 text-xs text-amber-700">ยังไม่ได้ตั้งอัตราดอกเบี้ยเทียบ (Settings › FX &amp; Prices) · ตอนนี้คิดดอกเบี้ย 0%</p>}
        <dl className="mt-2 space-y-0.5 text-xs">
          {line(`ต้นทุน ${t!.lot_count} ก้อน`, money(t!.cost_total))}
          {line(`ดอกเบี้ย ${Number(t!.rate_pct ?? 0)}% ต่อปี${t!.rate_source === "ASSET" ? " (แปลงนี้)" : t!.rate_source === "FAMILY" ? " (ครอบครัว)" : ""}`, `+${money(t!.interest_total)}`)}
          {Number(t!.depreciation_total) > 0 && line("หักค่าเสื่อมสิ่งปลูกสร้าง", `−${money(t!.depreciation_total)}`)}
          {carrying != null && min - carrying > 0.005 && line("ค่าใช้จ่ายขาย (จากราคาตลาดครั้งล่าสุด)", `+${money(min - carrying)}`)}
          {/* เทียบกับมูลค่าล่าสุด: ราคาขายขั้นต่ำสูง / ต่ำกว่ามูลค่าล่าสุดกี่ % (ตกลง 29 ต.ค. 2026) */}
          {nwValue > 0 && line(min > nwValue ? "ราคาขายขั้นต่ำสูงกว่ามูลค่าล่าสุด" : "ราคาขายขั้นต่ำต่ำกว่ามูลค่าล่าสุด", diffText(min - nwValue, nwValue),
            min > nwValue ? "text-red-600 font-medium" : "text-emerald-700 font-medium")}
          {line("รายได้ − ค่าใช้จ่ายที่บันทึกแล้ว (ไม่หัก)", `${Number(t!.net_income_thb) < 0 ? "−" : ""}${money(Math.abs(Number(t!.net_income_thb)), "THB")}`, "text-slate-600")}
        </dl>
      </>)}
      {lots && <div className="mt-2"><ModalButton label="ดูวิธีคิด (ต้นทุนรายก้อน)" title="ราคาขายขั้นต่ำที่คุ้ม: ต้นทุน + ดอกเบี้ย − ค่าเสื่อม" size="lg">{lots}</ModalButton></div>}
    </div>
  );
}

/** ต้นทุนรายก้อน + ดอกเบี้ย + ค่าเสื่อม — หน้าต่าง "ดูวิธีคิด" ของราคาขายขั้นต่ำที่คุ้ม
 *  ต้นทุนที่ได้มา = ต้นทุนรายแถวในตารางส่วนประกอบ · จ่ายเพิ่มในระบบนับให้อัตโนมัติ · ไม่มีปุ่มเพิ่มต้นทุนเอง (ตกลง 29 ต.ค. 2026 · รายการเดิมยังแก้ / ลบได้) */
export function CostLotsSection({ assetId, currency, today, lots, canWrite, canDelete, paths }: {
  assetId: string; currency: string; today: string; lots: CostLot[]; canWrite: boolean; canDelete: boolean; paths: string[];
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">วันที่จ่าย</th><th>รายการ</th><th className="text-right">ยอด</th><th className="text-right">ถือ (ปี)</th>
              <th className="text-right">ดอกเบี้ย</th><th className="text-right">ค่าเสื่อม</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lots.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">ยังไม่มีต้นทุน</td></tr>}
            {lots.map((l, i) => (
              <tr key={`${l.source}-${l.item_id ?? l.movement_id ?? i}`} className="align-top">
                <td className="whitespace-nowrap py-1.5">{thDate(l.lot_date)}</td>
                <td>{l.description || SOURCE_LABEL[l.source]}
                  <div className="text-xs text-slate-400">{SOURCE_LABEL[l.source]}{l.is_building && ` · สิ่งปลูกสร้าง ${l.depreciation_years} ปี`}{l.notes && ` · ${l.notes}`}</div></td>
                <td className="text-right tabular-nums">{money(l.amount)}</td>
                <td className="text-right tabular-nums">{Number(l.years_held).toFixed(1)}</td>
                <td className="text-right tabular-nums">{money(l.interest)}</td>
                <td className="text-right tabular-nums">{Number(l.depreciation) > 0 ? `−${money(l.depreciation)}` : "-"}</td>
                <td className="pl-2 text-right">
                  {!canWrite ? null : l.source === "MANUAL" && l.item_id ? (
                    <RowActions table="property_cost_items" id={l.item_id} paths={paths} canDelete={canDelete} deleteEffect="ไม่นับต้นทุนก้อนนี้"
                      editor={<CostItemForm assetId={assetId} currency={currency} today={today} edit={l} />} />
                  ) : <span className="text-xs text-slate-400">{l.source === "PAYMENT" ? <>แก้ที่ประวัติ (&ldquo;ปรับมูลค่า / ประวัติ&rdquo;)</> : <>แก้ที่ตารางส่วนประกอบ (&ldquo;แก้ไข&rdquo;)</>}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">ดอกเบี้ย = ยอด × ((1 + อัตรา)^(ปีที่ถือ) − 1) · สิ่งปลูกสร้างหักค่าเสื่อมเท่ากันทุกปีจนครบอายุ ·
        ต้นทุนที่ได้มา แก้ที่ตารางส่วนประกอบ (ปุ่ม &ldquo;แก้ไข&rdquo;) · จ่ายเพิ่มในระบบนับให้อัตโนมัติ</p>
    </div>
  );
}
