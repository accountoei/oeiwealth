"use client";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** ตัวเลือก "คิดดอกตามจำนวนวันจริง (วัน ÷ 365)" + วันเริ่มนับดอกของงวดแรก (ใช้ทั้งตั้งตาราง / คำนวณงวดที่เหลือใหม่) */
export function DayCountFields({ actual, setActual, from, setFrom, hint }: {
  actual: boolean; setActual: (v: boolean) => void; from: string; setFrom: (v: string) => void; hint?: string;
}) {
  return (
    <div className="grid gap-3 md:col-span-3 md:grid-cols-3">
      <label className="flex items-start gap-2 text-sm md:col-span-2">
        <input type="checkbox" checked={actual} onChange={(e) => setActual(e.target.checked)} className="mt-1" />
        <span>คิดดอกตามจำนวนวันจริง (ยอดคงเหลือ × อัตรา × จำนวนวัน ÷ 365)
          <span className="block text-xs text-slate-500">ไม่ติ๊ก = ดอกเท่ากันทุกเดือน (อัตรา ÷ 12) · ติ๊ก = เดือน 31 วันได้ดอกมากกว่าเดือน 28 วัน</span></span>
      </label>
      {actual && (
        <label className="text-sm">เริ่มนับดอกงวดแรกวันที่
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
        </label>
      )}
    </div>
  );
}
