"use client";

import { useRouter } from "next/navigation";

/** ตัวกรองแบบ dropdown ที่เปลี่ยน URL (หน้าโหลดข้อมูลตามตัวกรองฝั่ง server) · หน้าไม่เด้งขึ้นบน · หน้าตาเหมือนตัวกรองหน้าทรัพย์สิน */
export default function UrlSelect({ label, value, options }: {
  label: string; value: string; options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label>{label}
      <select value={value} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href, { scroll: false }); }}
        className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
