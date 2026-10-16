"use client";

import { useState } from "react";
import { BANKS, bankLabel } from "@/lib/format";

const OTHER = "__other__";

/** เลือกธนาคารจากรายชื่อมาตรฐาน (ชื่อเดียวกันทุกบัญชี) · "อื่น ๆ" = พิมพ์เอง · ส่งค่าในชื่อ name */
export default function BankSelect({ name = "bank_name", defaultValue, className }: { name?: string; defaultValue?: string | null; className?: string }) {
  const known = defaultValue ? bankLabel(defaultValue) : "";
  const inList = BANKS.some((b) => b.label === known);
  const [pick, setPick] = useState(defaultValue ? (inList ? known : OTHER) : "");
  const [text, setText] = useState(defaultValue && !inList ? defaultValue : "");
  return (
    <>
      <select required value={pick} onChange={(e) => setPick(e.target.value)} className={className}>
        <option value="" disabled>— เลือกธนาคาร —</option>
        {BANKS.map((b) => <option key={b.code} value={b.label}>{b.label}</option>)}
        <option value={OTHER}>อื่น ๆ (พิมพ์เอง)</option>
      </select>
      {pick === OTHER && (
        <input required value={text} onChange={(e) => setText(e.target.value)} placeholder="ชื่อธนาคาร" className={`mt-1 ${className ?? ""}`} />
      )}
      <input type="hidden" name={name} value={pick === OTHER ? text : pick} />
    </>
  );
}
