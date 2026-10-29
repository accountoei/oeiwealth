"use client";

import { useActionState, useState } from "react";
import { saveMarketValuation, type ActionState } from "./actions";
import { MARKET_CONFIDENCE_LABEL, MARKET_METHOD_LABEL, MARKET_PRICE_TYPE_LABEL, MARKET_UNIT_LABEL, money, numOrZero } from "@/lib/format";
import { DeleteSlot } from "@/components/RowActions";
import Flash from "@/components/Flash";

export type MarketValuation = {
  id: string; valuation_date: string; unit_basis: string; unit_price: number | null; area: number | null; market_value: number;
  value_low: number | null; value_high: number | null; currency: string; method: string; price_type: string | null; source: string | null;
  confidence: string | null; broker_fee_pct: number | null; broker_fee_amount: number | null; tax_transfer_estimate: number | null;
  other_selling_cost: number | null; notes: string | null; selling_cost: number; net_before_debt: number;
};

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const s = (v: number | null | undefined) => (v == null ? "" : String(v));

/**
 * ประเมินราคาตลาด (อ้างอิง · ไม่นับเข้า Net Worth) — เพิ่มใหม่ หรือแก้ (ใน RowActions ของประวัติ: ปุ่มลบอยู่ข้างปุ่มบันทึก)
 *   ราคาต่อ ตร.ว. / ตร.ม. × เนื้อที่ → ยอดรวม (ระบบคำนวณ) · หรือใส่ยอดรวมตรง ๆ
 */
export default function MarketValuationForm({ assetId, currency, today, defaultUnit, areaSqWa, last, edit }: {
  assetId: string; currency: string; today: string; defaultUnit: string;
  /** เนื้อที่รวมจากโฉนด (ตร.ว.) → ค่าตั้งต้นของช่องเนื้อที่ */ areaSqWa: number | null;
  /** ครั้งก่อน → ใช้ค่าใช้จ่ายขาย / วิธี / ที่มา เป็นค่าตั้งต้น */ last?: MarketValuation | null;
  edit?: MarketValuation;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMarketValuation, {});
  const base = edit ?? last ?? null;
  const [unit, setUnit] = useState(edit?.unit_basis ?? last?.unit_basis ?? defaultUnit);
  const [price, setPrice] = useState(s(edit?.unit_price));
  const [area, setArea] = useState(s(edit?.area ?? (unit === "SQ_WA" ? areaSqWa : null)));
  const [feeUnit, setFeeUnit] = useState(base?.broker_fee_amount != null ? "THB" : "PCT");
  const total = unit === "TOTAL" ? null : numOrZero(price) * numOrZero(area);
  const changeUnit = (u: string) => {
    setUnit(u);
    if (u === "SQ_WA" && !area && areaSqWa) setArea(String(areaSqWa));
  };
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4">
      <input type="hidden" name="asset_id" value={assetId} />
      {edit && <input type="hidden" name="id" value={edit.id} />}
      <p className="text-xs text-slate-500 md:col-span-4">ราคาตลาดเป็นข้อมูลอ้างอิงเท่านั้น ไม่นับเข้า Net Worth ไม่กระทบงวดที่ปิดแล้ว (อัปเดตมูลค่าใน Net Worth ที่ปุ่ม &ldquo;อัปเดตมูลค่า&rdquo;)</p>
      <label className="text-sm">วันที่ประเมิน
        <input name="valuation_date" type="date" required defaultValue={edit?.valuation_date ?? today} max={today} className={input} /></label>
      <label className="text-sm">ใส่ราคาเป็น
        <select name="unit_basis" value={unit} onChange={(e) => changeUnit(e.target.value)} className={input}>
          {Object.entries(MARKET_UNIT_LABEL).map(([v, l]) => <option key={v} value={v}>{v === "TOTAL" ? l : `ราคาต่อ ${l}`}</option>)}
        </select></label>
      {unit === "TOTAL" ? (
        <label className="text-sm md:col-span-2">ราคาตลาด (ราคากลาง · {currency})
          <input name="market_value" required inputMode="decimal" defaultValue={s(edit?.unit_basis === "TOTAL" ? edit.market_value : null)} className={input} /></label>
      ) : (<>
        <label className="text-sm">ราคาต่อ {MARKET_UNIT_LABEL[unit]}
          <input name="unit_price" required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={input} /></label>
        <label className="text-sm">เนื้อที่ ({MARKET_UNIT_LABEL[unit]})
          <input name="area" required inputMode="decimal" data-money="off" value={area} onChange={(e) => setArea(e.target.value)} className={input} />
          {unit === "SQ_WA" && areaSqWa != null && <span className="text-xs text-slate-500">เนื้อที่รวมจากโฉนด {areaSqWa.toLocaleString("en-US")} ตร.ว.</span>}</label>
        <p className="text-sm md:col-span-4">ราคากลาง = <b className="tabular-nums">{money(total, currency)}</b></p>
      </>)}
      <label className="text-sm">ช่วงราคาต่ำสุด (ไม่บังคับ)<input name="value_low" inputMode="decimal" defaultValue={s(edit?.value_low)} className={input} /></label>
      <label className="text-sm">ช่วงราคาสูงสุด (ไม่บังคับ)<input name="value_high" inputMode="decimal" defaultValue={s(edit?.value_high)} className={input} /></label>
      <label className="text-sm">ความเชื่อมั่น
        <select name="confidence" defaultValue={edit?.confidence ?? ""} className={input}>
          <option value="">— ไม่ระบุ —</option>
          {Object.entries(MARKET_CONFIDENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="text-sm">วิธีประเมิน
        <select name="method" defaultValue={base?.method ?? "OWNER_ESTIMATE"} className={input}>
          {Object.entries(MARKET_METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="text-sm">ประเภทราคาที่อ้างอิง
        <select name="price_type" defaultValue={edit?.price_type ?? ""} className={input}>
          <option value="">— ไม่ระบุ —</option>
          {Object.entries(MARKET_PRICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="text-sm md:col-span-3">แหล่งที่มา
        <input name="source" defaultValue={edit?.source ?? ""} placeholder="เช่น นายหน้า ก. · ประกาศขายแปลงข้างเคียง · ขายได้จริงปี 2568" className={input} /></label>
      <div className="md:col-span-4 border-t border-slate-100 pt-2 text-xs font-medium text-slate-600">ค่าใช้จ่ายขายโดยประมาณ (ใช้คิด &ldquo;ถ้าขายได้สุทธิ&rdquo;)</div>
      <div className="text-sm">ค่านายหน้า
        <div className="mt-1 flex gap-1">
          <input name="broker_fee" inputMode="decimal" data-money={feeUnit === "PCT" ? "off" : undefined}
            defaultValue={s(base?.broker_fee_amount ?? base?.broker_fee_pct)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select name="broker_fee_unit" value={feeUnit} onChange={(e) => setFeeUnit(e.target.value)} className="rounded-md border border-slate-300 px-2 text-sm">
            <option value="PCT">%</option><option value="THB">บาท</option>
          </select>
        </div></div>
      <label className="text-sm">ภาษี + ค่าโอน (ประมาณ)<input name="tax_transfer_estimate" inputMode="decimal" defaultValue={s(base?.tax_transfer_estimate)} className={input} /></label>
      <label className="text-sm">ค่าใช้จ่ายขายอื่น<input name="other_selling_cost" inputMode="decimal" defaultValue={s(base?.other_selling_cost)} className={input} /></label>
      <p className="self-end text-xs text-slate-500">ภาษี / ค่าโอนขึ้นกับราคาประเมินราชการ และจำนวนปีที่ถือ ควรถามสำนักงานที่ดินหรือนักบัญชี</p>
      <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" defaultValue={edit?.notes ?? ""} className={input} /></label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกราคาตลาด"}</button>
        {edit && <DeleteSlot />}
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Flash on={state} as="p" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
