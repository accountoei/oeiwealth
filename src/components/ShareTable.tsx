import type { ReactNode } from "react";
import { money } from "@/lib/format";

export const SHARE_COLORS = ["#f59e0b", "#2563eb", "#7c3aed", "#10b981", "#f43f5e", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

export type ShareRow = { key: string; name: string; value: number; color: string; /** ข้อความเล็กต่อท้ายชื่อ เช่น (3 รายการ) */ sub?: string };

/**
 * ตารางสัดส่วน (กล่องสรุปด้านบนของหน้ารายการ) — ชุดเดียวทุกหน้า (ตกลง 7 พ.ย. 2026):
 *   Bank Accounts · Investments · Business · Alternative · Property
 *   ชื่อ · แถบ · มูลค่า (THB) · สัดส่วน · หัวตารางพื้นเทาอ่อน
 */
export default function ShareTable({ label, rows, total, valueLabel = "มูลค่า (THB)", boldPct }: {
  label: string; rows: ShareRow[]; total: number; /** หัวคอลัมน์ยอด เช่น เบี้ยต่อปี (THB) */ valueLabel?: string;
  /** สัดส่วนตัวหนา (หน้า Insurance · ตกลง 9 พ.ย. 2026) */ boldPct?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500">
        <tr><th className="px-3 py-2">{label}</th><th className="px-3"></th><th className="whitespace-nowrap px-3 text-right">{valueLabel}</th><th className="px-3 text-right">สัดส่วน</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const pct = total > 0 ? (r.value * 100) / total : 0;
          return (
            <tr key={r.key}>
              <td className="whitespace-nowrap px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.name}
                {r.sub && <span className="ml-1 text-xs text-slate-400">{r.sub}</span>}</td>
              <td className="w-2/5 min-w-16 px-3"><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0)}%`, background: r.color }} /></div></td>
              <td className="whitespace-nowrap px-3 text-right tabular-nums">{money(r.value, undefined, 0)}</td>
              <td className={`px-3 text-right tabular-nums ${boldPct ? "font-semibold" : ""}`}>{pct.toFixed(1)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** กล่องสรุป 1 ใบ: หัวข้อ (THB Equivalent) + บรรทัดใต้หัวข้อ (ถ้ามี) + ตารางสัดส่วน · total ไม่ใส่ = รวมจากแถว */
export function ShareBox({ title, aside, sub, label, valueLabel, rows, total, children, footer, className, boldPct, empty = "ยังไม่มีข้อมูล" }: {
  title: ReactNode; /** ข้อความเล็กชิดขวาบรรทัดเดียวกับหัวข้อ (เช่น ประเมินล่าสุด …) */ aside?: ReactNode;
  sub?: ReactNode; label: string; valueLabel?: string; rows: ShareRow[]; total?: number;
  /** ใส่ระหว่างหัวข้อกับตาราง (เช่น แถบสัดส่วนรวม) */ children?: ReactNode;
  footer?: ReactNode; /** เช่น flex-1 = ยืดให้ขอบล่างเท่ากล่องข้าง ๆ */ className?: string; empty?: string; boldPct?: boolean;
}) {
  const sum = total ?? rows.reduce((t, r) => t + r.value, 0);
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-5 ${className ?? ""}`}>
      {aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-medium text-slate-900">{title} <span className="text-xs font-normal text-slate-500">(THB Equivalent)</span></h2>
          <span className="text-xs text-slate-500">{aside}</span>
        </div>
      ) : <h2 className="font-medium text-slate-900">{title} <span className="text-xs font-normal text-slate-500">(THB Equivalent)</span></h2>}
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
      {children}
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-500">{empty}</p>
        : <div className="mt-3 overflow-x-auto"><ShareTable label={label} valueLabel={valueLabel} total={sum} rows={rows} boldPct={boldPct} /></div>}
      {footer}
    </section>
  );
}
