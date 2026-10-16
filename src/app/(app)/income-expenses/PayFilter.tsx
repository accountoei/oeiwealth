"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";
type Opt = { id: string; label: string };

/**
 * ตัวกรอง "จ่ายด้วย" ในแท็บค่าใช้จ่าย → บันทึกแล้ว (เก็บใน URL ?pay=)
 *   ขั้นที่ 1: ทั้งหมด / บัญชีธนาคาร / บัตรเครดิต / เงินสด
 *   ขั้นที่ 2: บัญชีไหน / บัตรใบไหน (เฉพาะที่มีรายการในเดือนนี้ · เริ่มที่ "ทุกบัญชี" / "ทุกใบ")
 */
export default function PayFilter({ value, banks, cards }: { value: string; banks: Opt[]; cards: Opt[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const kind = value.startsWith("card") ? "card" : value.startsWith("bank") ? "bank" : value;
  const pick = value.includes(":") ? value.split(":")[1] : "";
  const go = (v: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "expense");
    q.set("et", "recorded");
    if (v) q.set("pay", v); else q.delete("pay");
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  const second = kind === "bank" ? { label: "บัญชี", all: "ทุกบัญชี", list: banks } : kind === "card" ? { label: "บัตร", all: "ทุกใบ", list: cards } : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <label>จ่ายด้วย
        <select value={kind} onChange={(e) => go(e.target.value)} className={small}>
          <option value="">ทั้งหมด</option>
          {(banks.length > 0 || kind === "bank") && <option value="bank">บัญชีธนาคาร</option>}
          {(cards.length > 0 || kind === "card") && <option value="card">บัตรเครดิต</option>}
          <option value="cash">เงินสด / อื่น ๆ</option>
        </select>
      </label>
      {second && second.list.length > 0 && (
        <label>{second.label}
          <select value={pick} onChange={(e) => go(e.target.value ? `${kind}:${e.target.value}` : kind)} className={small}>
            <option value="">{second.all}</option>
            {second.list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
