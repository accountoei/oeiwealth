const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** ในราคาที่ได้มา เป็นค่าอาคารเท่าไร (บ้าน / คอนโดที่ซื้อพร้อมอาคาร) + อายุอาคาร
 *  ใช้คิด "ราคาขายขั้นต่ำที่คุ้ม" เท่านั้น (หักค่าเสื่อมเฉพาะส่วนอาคาร · ไม่นับใน Net Worth · ตกลง 28 ต.ค. 2026) */
export default function AcqBuildingFields({ cost, years, className = "text-sm" }: { cost?: number | null; years?: number | null; className?: string }) {
  return (
    <div className={className}>ในราคาที่ได้มา เป็นค่าอาคาร
      <div className="mt-1 flex items-center gap-2">
        <input name="acq_building_cost" inputMode="decimal" defaultValue={cost != null ? String(cost) : ""} placeholder="บาท (ว่าง = ไม่มีอาคาร)"
          className={input.replace("mt-1 ", "")} />
        <span className="whitespace-nowrap text-xs text-slate-500">อายุ</span>
        <input name="acq_building_years" inputMode="numeric" data-plain defaultValue={String(years ?? 20)}
          className="w-16 rounded-md border border-slate-300 px-2 py-2 text-right text-sm" />
        <span className="text-xs text-slate-500">ปี</span>
      </div>
      <span className="mt-1 block text-xs text-slate-500">ใช้คิดราคาขายขั้นต่ำที่คุ้ม (หักค่าเสื่อมเฉพาะส่วนอาคาร) · ไม่นับใน Net Worth</span>
    </div>
  );
}
