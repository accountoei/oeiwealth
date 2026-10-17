import { money } from "@/lib/format";

export const SHARE_COLORS = ["#f59e0b", "#2563eb", "#7c3aed", "#10b981", "#f43f5e", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

/** ตารางสัดส่วน (กล่องสรุปด้านบนของหน้ารายการ): ชื่อ · แถบ · มูลค่า · % */
export default function ShareTable({ label, rows, total }: { label: string; rows: { key: string; name: string; value: number; color: string }[]; total: number }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500">
        <tr><th className="px-3 py-2">{label}</th><th className="px-3"></th><th className="px-3 text-right">มูลค่า (THB)</th><th className="px-3 text-right">สัดส่วน</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const pct = total > 0 ? (r.value * 100) / total : 0;
          return (
            <tr key={r.key}>
              <td className="whitespace-nowrap px-3 py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.name}</td>
              <td className="w-2/5 min-w-16 px-3"><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0)}%`, background: r.color }} /></div></td>
              <td className="whitespace-nowrap px-3 text-right tabular-nums">{money(r.value, undefined, 0)}</td>
              <td className="px-3 text-right tabular-nums">{pct.toFixed(1)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** กล่องสรุป 1 ใบ: หัวข้อ + ยอดรวม + ตารางสัดส่วน */
export function ShareBox({ title, sub, label, rows, total }: {
  title: string; sub?: string; label: string; rows: { key: string; name: string; value: number; color: string }[]; total: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{sub ?? `รวม ${money(total, "THB")}`}</p>
      <ShareTable label={label} total={total} rows={rows} />
    </div>
  );
}
