"use client";

import { useRouter } from "next/navigation";

/**
 * เลือกปี (พ.ศ.) แบบ dropdown — เลือกแล้วเปลี่ยนหน้าทันที ไม่เลื่อนขึ้นบน (แบบกล่องภาษีที่ดินและสิ่งปลูกสร้าง · ตกลง 3 พ.ย. 2026)
 *   hrefOf = ลิงก์ที่มี "__Y__" แทนปี ค.ศ. · mark = ข้อความต่อท้ายปี เช่น "✓" / "· ค้าง"
 */
export default function YearSelect({ options, value, hrefOf, label = "ปี" }: {
  options: { value: number; mark?: string }[]; value: number; hrefOf: string; label?: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">{label}
      <select value={value} onChange={(e) => router.push(hrefOf.replace("__Y__", e.target.value), { scroll: false })}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.value + 543}{o.mark ? ` ${o.mark}` : ""}</option>)}
      </select>
    </label>
  );
}
