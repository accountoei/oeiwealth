"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** ตัวกรอง "จ่ายด้วย" ในแท็บค่าใช้จ่ายที่บันทึกแล้ว (เก็บใน URL ?pay=) */
export default function PayFilter({ value, cards }: { value: string; cards: { id: string; label: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const change = (v: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "expense");
    q.set("et", "recorded");
    if (v) q.set("pay", v); else q.delete("pay");
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  return (
    <label className="text-xs text-slate-600">จ่ายด้วย
      <select value={value} onChange={(e) => change(e.target.value)} className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm">
        <option value="">ทั้งหมด</option>
        <option value="bank">บัญชีธนาคาร</option>
        <option value="card">บัตรเครดิต (ทุกใบ)</option>
        {cards.map((c) => <option key={c.id} value={`card:${c.id}`}>&nbsp;&nbsp;บัตร {c.label}</option>)}
        <option value="cash">เงินสด / อื่น ๆ</option>
      </select>
    </label>
  );
}
