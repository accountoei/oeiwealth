import type { ReactNode } from "react";
import { money } from "@/lib/format";

/** 1 แถว = 1 สมาชิก (หรือ "ยังไม่ระบุเจ้าของ" ของมูลค่าเวนคืน) · ยอดเป็นบาท */
export type MemberShareRow = { key: string; name: string; color: string; life: number; cv: number; current?: boolean };

const COLS = [["life", "ทุนประกันชีวิต"], ["cv", "มูลค่าเวนคืน"]] as const;

/**
 * กล่อง "ตามสมาชิกครอบครัว" ของหน้ารวม Insurance (ตกลง 8 พ.ย. 2026)
 *   ทุนประกันชีวิต (ชีวิต + บำนาญ) ตามผู้เอาประกัน · มูลค่าเวนคืนตามเจ้าของ (× สัดส่วน)
 *   ไม่มีเบี้ยต่อปี (เบี้ยเปลี่ยนทุกปีตามกรมธรรม์) · สัดส่วนของคอลัมน์อยู่ข้างตัวเลข · แถวล่าง = รวม
 *   ทั้งครอบครัวเสมอ (แบบหน้า Alternative) · คนที่เลือกในตัวกรองเน้นสี
 */
export default function MemberShareBox({ rows, footer }: { rows: MemberShareRow[]; footer?: ReactNode }) {
  const total = { life: 0, cv: 0 };
  rows.forEach((r) => { total.life += r.life; total.cv += r.cv; });
  const pct = (v: number, t: number) => (t > 0 ? `${((v * 100) / t).toFixed(1)}%` : "");
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">มูลค่าเวนคืนตามสมาชิกครอบครัว <span className="text-xs font-normal text-slate-500">(THB Equivalent)</span></h2>
      <p className="text-xs text-slate-500">ทุนประกัน ตามผู้เอาประกัน · มูลค่าเวนคืน ตามเจ้าของ</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูล</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="whitespace-nowrap py-2 pl-3 pr-2">สมาชิกครอบครัว</th>
                {COLS.map(([k, l]) => [
                  <th key={k} className="whitespace-nowrap pl-2 pr-1 text-right">{l}</th>,
                  <th key={`${k}%`} className="pl-1 pr-2 text-right">%</th>,
                ])}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className={r.current ? "bg-blue-50/60 font-medium" : undefined}>
                  <td className="whitespace-nowrap py-2 pl-3 pr-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.name}</td>
                  {COLS.map(([k]) => r[k] > 0 ? [
                    <td key={k} className="whitespace-nowrap pl-2 pr-1 text-right tabular-nums">{money(r[k], undefined, 0)}</td>,
                    <td key={`${k}%`} className="whitespace-nowrap pl-1 pr-2 text-right text-xs tabular-nums text-slate-500">{pct(r[k], total[k])}</td>,
                  ] : [
                    <td key={k} className="pl-2 pr-1 text-right text-slate-400">-</td>,
                    <td key={`${k}%`} />,
                  ])}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 font-medium">
              <tr>
                <td className="py-2 pl-3 pr-2">รวม</td>
                {COLS.map(([k]) => [
                  <td key={k} className="whitespace-nowrap pl-2 pr-1 text-right tabular-nums">{money(total[k], undefined, 0)}</td>,
                  <td key={`${k}%`} />,
                ])}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {footer}
    </section>
  );
}
