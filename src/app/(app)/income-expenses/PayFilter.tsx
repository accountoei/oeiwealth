"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";

/**
 * ตัวกรอง "จ่ายด้วย" ในแท็บค่าใช้จ่าย → บันทึกแล้ว (เก็บใน URL ?pay=)
 *   ขั้นที่ 1: ทั้งหมด / บัญชีธนาคาร / บัตรเครดิต / เงินสด
 *   ขั้นที่ 2 (เลือกบัตร): ทุกใบ / ใบไหน
 */
export default function PayFilter({ value, cards }: { value: string; cards: { id: string; label: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const kind = value.startsWith("card") ? "card" : value;
  const card = value.startsWith("card:") ? value.slice(5) : "";
  const go = (v: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "expense");
    q.set("et", "recorded");
    if (v) q.set("pay", v); else q.delete("pay");
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <label>จ่ายด้วย
        <select value={kind} onChange={(e) => go(e.target.value)} className={small}>
          <option value="">ทั้งหมด</option>
          <option value="bank">บัญชีธนาคาร</option>
          {cards.length > 0 && <option value="card">บัตรเครดิต</option>}
          <option value="cash">เงินสด / อื่น ๆ</option>
        </select>
      </label>
      {kind === "card" && cards.length > 0 && (
        <label>บัตร
          <select value={card} onChange={(e) => go(e.target.value ? `card:${e.target.value}` : "card")} className={small}>
            <option value="">ทุกใบ</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
