import RowActions from "@/components/RowActions";
import CostItemForm, { type CostLot } from "./CostItemForm";
import { diffText, money, thDate } from "@/lib/format";

export type TargetPrice = {
  asset_id: string; currency: string; rate_pct: number | null; rate_source: string | null; lot_count: number; building_count: number;
  cost_total: number | null; interest_total: number | null; depreciation_total: number | null; carrying_value: number | null;
  market_value: number | null; market_date: string | null; min_price: number | null; net_income_thb: number;
};

const SOURCE_LABEL: Record<string, string> = { ACQUISITION: "ราคาที่ได้มา", PAYMENT: "จ่ายเพิ่ม (ในระบบ)", MANUAL: "ต้นทุนเพิ่ม" };

/**
 * ราคาขายขั้นต่ำที่คุ้ม (อ้างอิง · ไม่นับใน Net Worth · ตกลง 28 ต.ค. 2026) — อยู่ใต้ราคาตลาดในกล่องมูลค่าล่าสุด
 *   ต้นทุนแต่ละก้อน + ดอกเบี้ยทบต้นตามระยะเวลาถือ − ค่าเสื่อมอาคาร + ค่าใช้จ่ายขาย (จากราคาตลาดครั้งล่าสุด) · เทียบราคาตลาด
 *   รายได้ − ค่าใช้จ่ายที่บันทึกแล้ว แสดงประกอบ (ไม่หัก) · ตารางต้นทุนรายก้อน + เพิ่มต้นทุน อยู่ในปุ่ม "มูลค่าและต้นทุน" (CostLotsSection · ตกลง 28 ต.ค. 2026)
 */
export default function TargetBox({ currency, target, unit }: {
  currency: string; target: TargetPrice | null;
  /** เนื้อที่สำหรับราคาต่อหน่วย (ตามราคาตลาดครั้งล่าสุด หรือเนื้อที่โฉนด) */ unit: { area: number; label: string } | null;
}) {
  const t = target;
  const min = t?.min_price != null ? Number(t.min_price) : null;
  const carrying = t?.carrying_value != null ? Number(t.carrying_value) : null;
  const mk = t?.market_value != null ? Number(t.market_value) : null;
  const line = (label: string, value: string, cls = "") => (
    <div className="flex justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className={`tabular-nums ${cls}`}>{value}</dd></div>
  );
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="text-xs text-slate-500">ราคาขายขั้นต่ำที่คุ้ม <span className="text-slate-400">(ต้นทุน + ดอกเบี้ย · ไม่นับใน Net Worth)</span></div>
      {min == null ? (
        <p className="mt-1 text-sm text-slate-500">ยังไม่มีต้นทุน · ใส่ราคาที่ได้มาที่ &ldquo;แก้ไขข้อมูล&rdquo; หรือเพิ่มต้นทุนที่ปุ่ม &ldquo;มูลค่าและต้นทุน&rdquo;</p>
      ) : (<>
        <div className="mt-1 text-xl font-semibold tabular-nums">{money(min, currency, 0)}</div>
        {unit && unit.area > 0 && <div className="text-xs text-slate-500">≈ {money(min / unit.area, undefined, 0)} / {unit.label}</div>}
        {t?.rate_pct == null && <p className="mt-1 text-xs text-amber-700">ยังไม่ได้ตั้งอัตราดอกเบี้ยเทียบ (Settings › FX &amp; Prices) · ตอนนี้คิดดอกเบี้ย 0%</p>}
        <dl className="mt-2 space-y-0.5 text-xs">
          {line(`ต้นทุน ${t!.lot_count} ก้อน`, money(t!.cost_total))}
          {line(`ดอกเบี้ย ${Number(t!.rate_pct ?? 0)}% ต่อปี${t!.rate_source === "ASSET" ? " (แปลงนี้)" : t!.rate_source === "FAMILY" ? " (ครอบครัว)" : ""}`, `+${money(t!.interest_total)}`)}
          {Number(t!.depreciation_total) > 0 && line("หักค่าเสื่อมอาคาร", `−${money(t!.depreciation_total)}`)}
          {carrying != null && min - carrying > 0.005 && line("ค่าใช้จ่ายขาย (จากราคาตลาดครั้งล่าสุด)", `+${money(min - carrying)}`)}
          {mk != null && line(mk >= min ? "ราคาตลาดสูงกว่า → ขายตอนนี้คุ้ม" : "ราคาตลาดต่ำกว่า → ยังไม่คุ้ม", diffText(mk - min, min),
            mk >= min ? "text-emerald-700 font-medium" : "text-red-600 font-medium")}
          {line("รายได้ − ค่าใช้จ่ายที่บันทึกแล้ว (ไม่หัก)", `${Number(t!.net_income_thb) < 0 ? "−" : ""}${money(Math.abs(Number(t!.net_income_thb)), "THB")}`, "text-slate-600")}
        </dl>
      </>)}
    </div>
  );
}

/** ต้นทุนรายก้อน + ดอกเบี้ย + เพิ่มต้นทุน — ส่วนท้ายของหน้าต่าง "มูลค่าและต้นทุน"
 *  จ่ายเพิ่ม (ในระบบ) แก้ / ติ๊กอาคารที่แถวรายการจ่ายในประวัติด้านบน · ราคาที่ได้มา (ที่ดิน / อาคาร) แก้ที่ "แก้ไขข้อมูล" */
export function CostLotsSection({ assetId, currency, today, lots, canWrite, canDelete, paths }: {
  assetId: string; currency: string; today: string; lots: CostLot[]; canWrite: boolean; canDelete: boolean; paths: string[];
}) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-medium text-slate-800">ต้นทุนและดอกเบี้ย <span className="font-normal text-slate-500">(ราคาขายขั้นต่ำที่คุ้ม · ไม่นับใน Net Worth)</span></h3>
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
                  <div className="text-xs text-slate-400">{SOURCE_LABEL[l.source]}{l.is_building && ` · อาคาร ${l.depreciation_years} ปี`}{l.notes && ` · ${l.notes}`}</div></td>
                <td className="text-right tabular-nums">{money(l.amount)}</td>
                <td className="text-right tabular-nums">{Number(l.years_held).toFixed(1)}</td>
                <td className="text-right tabular-nums">{money(l.interest)}</td>
                <td className="text-right tabular-nums">{Number(l.depreciation) > 0 ? `−${money(l.depreciation)}` : "-"}</td>
                <td className="pl-2 text-right">
                  {!canWrite ? null : l.source === "MANUAL" && l.item_id ? (
                    <RowActions table="property_cost_items" id={l.item_id} paths={paths} canDelete={canDelete} deleteEffect="ไม่นับต้นทุนก้อนนี้"
                      editor={<CostItemForm assetId={assetId} currency={currency} today={today} edit={l} />} />
                  ) : <span className="text-xs text-slate-400">{l.source === "PAYMENT" ? "แก้ที่รายการจ่ายด้านบน" : <>แก้ที่ &ldquo;แก้ไขข้อมูล&rdquo;</>}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">ดอกเบี้ย = ยอด × ((1 + อัตรา)^(ปีที่ถือ) − 1) · อาคารหักค่าเสื่อมเท่ากันทุกปีจนครบอายุ ·
        ราคาที่ได้มา (แยกค่าอาคารได้) แก้ที่ &ldquo;แก้ไขข้อมูล&rdquo; · จ่ายเพิ่มในระบบนับให้อัตโนมัติ (ติ๊กอาคารตอนจ่าย หรือกดที่รายการจ่ายด้านบน)</p>
      {canWrite && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-sm font-medium text-slate-800">+ เพิ่มต้นทุน (เช่น ค่าก่อสร้างก่อน go-live)</h3>
          <CostItemForm assetId={assetId} currency={currency} today={today} />
        </div>
      )}
    </div>
  );
}
