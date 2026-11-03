import Link from "next/link";
import { isZero, money, signedMoney } from "@/lib/format";

/** การ์ดสรุปเงินเข้า–ออกของเดือนหนึ่งกลุ่ม (รายรับ / รายจ่าย / รายการอื่นๆ) · ยอดมีเครื่องหมาย: เข้า +, ออก − */
export default function FlowCard({ title, total, count, lines, href, empty }: {
  title: string; total: number; count: number; lines: [string, number][]; href: string; empty?: string;
}) {
  const color = isZero(total) ? "text-slate-700" : total > 0 ? "text-emerald-700" : "text-red-700";
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 num-box">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{isZero(total) ? money(0, "THB") : signedMoney(total, "THB")}</div>
      <div className="mt-1 text-xs text-slate-500">{count} รายการ</div>
      {count === 0 && empty ? <p className="mt-2 text-xs text-slate-400">{empty}</p> : lines.length > 0 && (
        <dl className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs">
          {lines.map(([label, v]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`tabular-nums ${isZero(v) ? "text-slate-400" : "text-slate-700"}`}>{signedMoney(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Link href={href} className="mt-auto inline-block pt-2 text-xs text-blue-700 hover:underline">ดูรายการเงินเข้า–ออก →</Link>
    </div>
  );
}
