"use client";

import Link from "next/link";
import { useState } from "react";
import { money, thDate } from "@/lib/format";

/** แสดง 5 แถวแรก ที่เหลือกด "ดูทั้งหมด" (ตกลง 5 พ.ย. 2026) */
const SHOW = 5;
const toggleCls = "text-xs text-blue-700 hover:underline";

function MoreToggle({ open, total, unit, onToggle }: { open: boolean; total: number; unit: string; onToggle: () => void }) {
  if (total <= SHOW) return null;
  return (
    <div className="border-t border-slate-100 px-4 py-2">
      <button type="button" onClick={onToggle} className={toggleCls}>{open ? "ย่อ ▴" : `ดูทั้งหมด (${total.toLocaleString("th-TH")} ${unit}) ▾`}</button>
    </div>
  );
}

export type YearRow = { yr: number; person: number; business: number; group: number; total: number; n: number };

/** สรุปรายปี: หัวคอลัมน์แรก = ชื่อตาราง · 5 ปีล่าสุด · แถวรวมทุกปีรวมทุกปีเสมอ */
export function YearSummary({ rows, hasGroup, d, allTotal, allCount }: { rows: YearRow[]; hasGroup: boolean; d: string; allTotal: number; allCount: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, SHOW);
  const cols = hasGroup ? 6 : 5;
  const tot = (k: "person" | "business" | "group") => rows.reduce((s, x) => s + x[k], 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-4 py-2"><span className="font-semibold text-slate-700">สรุปรายปี</span> (กดปีเพื่อดูรายการ · หรือเลือกผู้บริจาคด้านบน)</th>
            <th className="px-4 text-right">บุคคล</th><th className="px-4 text-right">ในนามกิจการ</th>{hasGroup && <th className="px-4 text-right">กลุ่ม (ข้อมูลเดิม)</th>}
            <th className="px-4 text-right">รวม</th><th className="px-4 text-right">รายการ</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && <tr><td colSpan={cols} className="px-4 py-4 text-center text-slate-500">ยังไม่มีรายการ</td></tr>}
          {shown.map((s) => {
            const q = new URLSearchParams({ y: String(s.yr), ...(d ? { d } : {}) });
            return (
              <tr key={s.yr}>
                <td className="px-4 py-2"><Link href={`/family/donations?${q}`} className="text-blue-700 hover:underline">{s.yr + 543}</Link></td>
                <td className="px-4 text-right tabular-nums">{s.person ? money(s.person) : "-"}</td>
                <td className="px-4 text-right tabular-nums">{s.business ? money(s.business) : "-"}</td>
                {hasGroup && <td className="px-4 text-right tabular-nums">{s.group ? money(s.group) : "-"}</td>}
                <td className="px-4 text-right font-medium tabular-nums">{money(s.total)}</td>
                <td className="px-4 text-right text-slate-500">{s.n}</td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
            <tr><td className="px-4 py-2">รวมทุกปี</td>
              <td className="px-4 text-right tabular-nums">{money(tot("person"))}</td>
              <td className="px-4 text-right tabular-nums">{money(tot("business"))}</td>
              {hasGroup && <td className="px-4 text-right tabular-nums">{money(tot("group"))}</td>}
              <td className="px-4 text-right tabular-nums">{money(allTotal)}</td>
              <td className="px-4 text-right text-slate-500">{allCount}</td></tr>
          </tfoot>
        )}
      </table>
      <MoreToggle open={open} total={rows.length} unit="ปี" onToggle={() => setOpen(!open)} />
    </div>
  );
}

export type ProjectRow = { name: string; total: number; n: number; first: string; last: string };
type Key = "last" | "total";

/** ปุ่มเรียงเล็กที่หัวคอลัมน์ (หน้าตาเดียวกับ DateSortHead) · คอลัมน์ที่ไม่ได้ใช้เรียงแสดง ↕ จาง ๆ */
function SortHead({ label, active, asc, onClick, right }: { label: string; active: boolean; asc: boolean; onClick: () => void; right?: boolean }) {
  const title = !active ? `เรียงตาม${label}` : asc ? "เรียงน้อย → มาก · กดเพื่อสลับ" : "เรียงมาก → น้อย · กดเพื่อสลับ";
  return (
    <span className={`inline-flex items-center whitespace-nowrap ${right ? "justify-end" : ""}`}>
      {label}
      <button type="button" onClick={onClick} title={title} aria-label={title}>
        <span aria-hidden className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white text-[10px] leading-none hover:border-slate-400 hover:text-slate-900 ${active ? "text-slate-600" : "text-slate-300"}`}>
          {!active ? "↕" : asc ? "↑" : "↓"}
        </span>
      </button>
    </span>
  );
}

/** โครงการ: หัวคอลัมน์แรก = ชื่อตาราง · เริ่มต้นเรียงโครงการล่าสุดก่อน · เรียงตามช่วงเวลา / ยอดรวมได้ · 5 รายการแรก */
export function ProjectTable({ projects }: { projects: ProjectRow[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<Key>("last");
  const [asc, setAsc] = useState(false);
  const sorted = [...projects].sort((a, b) => {
    const v = key === "total" ? a.total - b.total : a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
    return (asc ? v : -v) || a.name.localeCompare(b.name, "th");
  });
  const shown = open ? sorted : sorted.slice(0, SHOW);
  const sortBy = (k: Key) => { if (k === key) setAsc(!asc); else { setKey(k); setAsc(false); } };
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-4 py-2"><span className="font-semibold text-slate-700">โครงการ</span></th>
            <th className="px-4"><SortHead label="ช่วงเวลา" active={key === "last"} asc={asc} onClick={() => sortBy("last")} /></th>
            <th className="px-4 text-right">รายการ</th>
            <th className="px-4 text-right"><SortHead label="ยอดรวม" active={key === "total"} asc={asc} onClick={() => sortBy("total")} right /></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((p) => (
            <tr key={p.name}><td className="px-4 py-2 font-medium">{p.name}</td>
              <td className="px-4 text-slate-600">{p.first === p.last ? thDate(p.first) : `${thDate(p.first)} – ${thDate(p.last)}`}</td>
              <td className="px-4 text-right text-slate-500">{p.n}</td><td className="px-4 text-right tabular-nums">{money(p.total)}</td></tr>
          ))}
        </tbody>
      </table>
      <MoreToggle open={open} total={projects.length} unit="โครงการ" onToggle={() => setOpen(!open)} />
    </div>
  );
}
