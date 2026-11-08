import type { ReactNode } from "react";
import { money } from "@/lib/format";

/** 1 แถว = 1 สมาชิก (หรือ "ประกันทรัพย์สิน" ที่ไม่มีผู้เอาประกัน) · ยอดเป็นบาท */
export type MemberShareRow = { key: string; name: string; color: string; premium: number; life: number; cv: number; current?: boolean };

const COLS = [["premium", "เบี้ยต่อปี"], ["life", "ทุนประกันชีวิต"], ["cv", "มูลค่าเวนคืน"]] as const;

/**
 * กล่อง "ตามสมาชิกครอบครัว" ของหน้ารวม Insurance (ตกลง 8 พ.ย. 2026 · แบบแรก)
 *   เบี้ยต่อปี · ทุนประกันชีวิต (ชีวิต + บำนาญ) ตามผู้เอาประกัน · มูลค่าเวนคืนตามเจ้าของ (× สัดส่วน)
 *   ใต้ตัวเลข = % ของคอลัมน์นั้น · แถวล่าง = รวม · ทั้งครอบครัวเสมอ (แบบหน้า Alternative) · คนที่เลือกในตัวกรองเน้นสี
 */
export default function MemberShareBox({ rows, footer }: { rows: MemberShareRow[]; footer?: ReactNode }) {
  const total = { premium: 0, life: 0, cv: 0 };
  rows.forEach((r) => { total.premium += r.premium; total.life += r.life; total.cv += r.cv; });
  const pct = (v: number, t: number) => (t > 0 ? `${((v * 100) / t).toFixed(1)}%` : "-");
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">ตามสมาชิกครอบครัว <span className="text-xs font-normal text-slate-500">(THB Equivalent)</span></h2>
      <p className="text-xs text-slate-500">เบี้ย / ทุนประกัน ตามผู้เอาประกัน · มูลค่าเวนคืน ตามเจ้าของ · ตัวเล็ก = สัดส่วนในคอลัมน์</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูล</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="whitespace-nowrap px-3 py-2">สมาชิกครอบครัว</th>{COLS.map(([k, l]) => <th key={k} className="whitespace-nowrap px-2 text-right">{l}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className={r.current ? "bg-blue-50/60 font-medium" : undefined}>
                  <td className="whitespace-nowrap px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.name}</td>
                  {COLS.map(([k]) => (
                    <td key={k} className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {r[k] > 0 ? <>{money(r[k], undefined, 0)}<div className="text-xs font-normal text-slate-400">{pct(r[k], total[k])}</div></> : <span className="text-slate-400">-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 font-medium">
              <tr><td className="px-3 py-2">รวม</td>{COLS.map(([k]) => <td key={k} className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(total[k], undefined, 0)}</td>)}</tr>
            </tfoot>
          </table>
        </div>
      )}
      {footer}
    </section>
  );
}
