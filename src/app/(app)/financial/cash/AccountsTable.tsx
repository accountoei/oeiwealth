"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useOnMainTab } from "../../income-expenses/tabs";
import { money, thDate } from "@/lib/format";

export type AccountRow = {
  id: string; name: string; bank: string; type: string; masked: string | null; owners: string; currency: string;
  status: string; balance: number | null; thb: number; pct: number | null; full: number | null;
  lastDate: string | null; calculated: boolean; move?: ReactNode;
};

const STATUS: Record<string, string> = { ACTIVE: "ใช้งานอยู่", INACTIVE: "ไม่ได้ใช้งาน", CLOSED: "ปิดบัญชีแล้ว", SOLD: "ปิดแล้ว" };
const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";

/** บัญชีทั้งหมด + ตัวกรอง สกุลเงิน / ธนาคาร / สถานะ (ตั้งต้น = ใช้งานอยู่) · แถวรวมตามตัวกรอง */
export default function AccountsTable({ rows, empty, toggle }: { rows: AccountRow[]; empty: string; toggle?: ReactNode }) {
  const [ccy, setCcy] = useState("");
  const [bank, setBank] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  // สลับแท็บแล้วกลับมา → ตัวกรองกลับค่าเริ่มต้น (ทั้งหมด · ใช้งานอยู่)
  useOnMainTab(() => { setCcy(""); setBank(""); setStatus("ACTIVE"); });
  const ccys = useMemo(() => [...new Set(rows.map((r) => r.currency))].sort(), [rows]);
  const banks = useMemo(() => [...new Set(rows.map((r) => r.bank))].sort((a, b) => a.localeCompare(b, "th")), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);
  const shown = rows.filter((r) => (!ccy || r.currency === ccy) && (!bank || r.bank === bank) && (!status || r.status === status));
  const byCcy = [...shown.reduce((m, r) => m.set(r.currency, (m.get(r.currency) ?? 0) + Number(r.balance ?? 0)), new Map<string, number>())];
  const thb = shown.reduce((t, r) => t + r.thb, 0);
  const filtered = !!(ccy || bank || status !== "ACTIVE");
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-xs text-slate-600">
        <label>สกุลเงิน
          <select value={ccy} onChange={(e) => setCcy(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{ccys.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>ธนาคาร
          <select value={bank} onChange={(e) => setBank(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{banks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>สถานะ
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>
            {[...new Set(["ACTIVE", ...statuses])].map((s) => <option key={s} value={s}>{STATUS[s] ?? s}</option>)}
          </select>
        </label>
        {shown.length > 0 && (
          <span className="ml-auto text-right text-sm text-slate-700">
            รวม{filtered ? "ตามตัวกรอง" : ""} {shown.length} บัญชี ·{" "}
            <b className="tabular-nums">{byCcy.map(([c, v]) => money(v, c)).join(" · ")}</b>
            {(byCcy.length > 1 || byCcy.some(([c]) => c !== "THB")) && <span className="ml-1 text-xs text-slate-500">(≈ {money(thb, "THB")})</span>}
          </span>
        )}
        {toggle && <span className={shown.length > 0 ? "" : "ml-auto"}>{toggle}</span>}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2">บัญชี</th><th className="px-4">เจ้าของ</th>
            <th className="px-4 text-right">ยอดคงเหลือ</th><th className="px-4">ยอดตาม Statement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">{rows.length ? "ไม่มีบัญชีตามตัวกรอง" : empty}</td></tr>}
          {shown.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                {a.move && <span className="mr-2 align-middle">{a.move}</span>}
                <Link href={`/financial/cash/${a.id}`} className="font-medium text-slate-900 hover:underline">{a.name}</Link>
                <div className="text-xs text-slate-500">
                  {a.bank} · {a.type}{a.masked && ` · ${a.masked}`}{a.status !== "ACTIVE" && ` · ${STATUS[a.status] ?? a.status}`}
                </div>
              </td>
              <td className="px-4 text-slate-600">{a.owners || <span className="text-amber-700">ยังไม่ระบุเจ้าของ</span>}</td>
              <td className="px-4 text-right tabular-nums">
                {money(a.balance, a.currency)}
                {a.pct != null && <div className="text-xs text-slate-400">{a.pct}% ของ {money(a.full, a.currency)}</div>}
                {a.currency !== "THB" && <div className="text-xs text-slate-400">≈ {money(a.thb, "THB")}</div>}
              </td>
              <td className="px-4 text-xs">
                {a.lastDate == null ? <span className="text-slate-400">-</span>
                  : a.calculated ? <span className="text-amber-700">ล่าสุด {thDate(a.lastDate)} + รายการหลังจากนั้น</span>
                  : <span className="text-emerald-700">ล่าสุด {thDate(a.lastDate)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
