"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import { useOnMainTab } from "./tabs";

const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";
type Opt = { id: string; label: string };
/** ข้อมูลต่อแถวสำหรับกรอง / รวมยอด (แถวในตารางใส่ data-pay={pay} ไว้) */
export type PayRow = { pay: string; currency: string; amount: number; thb: number };

/**
 * ตัวกรอง "จ่ายด้วย" (ค่าใช้จ่าย → บันทึกแล้ว) — เก็บในหน้าจอ ไม่เก็บในลิงก์
 *   ขั้นที่ 1: ทั้งหมด / บัญชีธนาคาร / บัตรเครดิต / เงินสด · ขั้นที่ 2: บัญชีไหน / บัตรใบไหน (เฉพาะที่มีในเดือน)
 *   ไปหน้าอื่นแล้วกลับมา · สลับแท็บหลัก → กลับเป็น "ทั้งหมด" · เปลี่ยนเดือน → ตัวกรองยังอยู่
 */
const Ctx = createContext<{ value: string; set: (v: string) => void; rows: PayRow[]; total: number }>({ value: "", set: () => {}, rows: [], total: 0 });
const match = (pay: string, f: string) => !f || (f === "bank" || f === "card" ? pay.startsWith(`${f}:`) : pay === f);

export function PayScope({ rows, children }: { rows: PayRow[]; children: ReactNode }) {
  const [value, set] = useState("");
  useOnMainTab(() => set(""));
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shown = rows.filter((r) => match(r.pay, value));
  // ซ่อนแถวที่ไม่ตรงตัวกรองด้วย CSS (แถวยังอยู่ · กล่องแก้ไข / แยกรายการทำงานเหมือนเดิม)
  const hide = !value ? "" : value === "bank" || value === "card"
    ? `[data-pay-scope="${scope}"] tr[data-pay]:not([data-pay^="${value}:"]){display:none}`
    : `[data-pay-scope="${scope}"] tr[data-pay]:not([data-pay="${value}"]){display:none}`;
  return (
    <Ctx.Provider value={{ value, set, rows: shown, total: rows.length }}>
      {hide && <style>{hide}</style>}
      <div data-pay-scope={scope}>{children}</div>
    </Ctx.Provider>
  );
}

export default function PayFilter({ banks, cards }: { banks: Opt[]; cards: Opt[] }) {
  const { value, set } = useContext(Ctx);
  const kind = value.startsWith("card") ? "card" : value.startsWith("bank") ? "bank" : value;
  const pick = value.includes(":") ? value.split(":")[1] : "";
  const second = kind === "bank" ? { label: "บัญชี", all: "ทุกบัญชี", list: banks } : kind === "card" ? { label: "บัตร", all: "ทุกใบ", list: cards } : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <label>จ่ายด้วย
        <select value={kind} onChange={(e) => set(e.target.value)} className={small}>
          <option value="">ทั้งหมด</option>
          {(banks.length > 0 || kind === "bank") && <option value="bank">บัญชีธนาคาร</option>}
          {(cards.length > 0 || kind === "card") && <option value="card">บัตรเครดิต</option>}
          <option value="cash">เงินสด / อื่น ๆ</option>
        </select>
      </label>
      {second && second.list.length > 0 && (
        <label>{second.label}
          <select value={pick} onChange={(e) => set(e.target.value ? `${kind}:${e.target.value}` : kind)} className={small}>
            <option value="">{second.all}</option>
            {second.list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** แถวรวมท้ายตาราง (ตามตัวกรอง) */
export function PayTotal({ before, after }: { before: number; after: number }) {
  const { value, rows, total } = useContext(Ctx);
  const byCcy = [...rows.reduce((m, r) => m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount), new Map<string, number>())];
  const thb = rows.reduce((s, r) => s + r.thb, 0);
  if (value && rows.length === 0) {
    return <tr><td colSpan={before + 1 + after} className="py-4 text-center text-sm text-slate-500">ไม่มีรายการตามตัวกรอง</td></tr>;
  }
  return (
    <tr className="border-t-2 border-slate-200 align-top font-medium">
      <td colSpan={before} className="py-2 text-slate-700">
        รวม{value ? "ตามตัวกรอง" : "ทั้งเดือน"} {rows.length} รายการ
        {value && <span className="ml-1 text-xs font-normal text-slate-500">(จากทั้งหมด {total})</span>}
      </td>
      <td className="py-2 text-right tabular-nums">
        {byCcy.map(([c, v]) => <div key={c}>{money(v, c)}</div>)}
        {(byCcy.length > 1 || byCcy.some(([c]) => c !== "THB")) && <div className="text-xs font-normal text-slate-500">≈ {money(thb, "THB")}</div>}
      </td>
      {after > 0 && <td colSpan={after}></td>}
    </tr>
  );
}
