import { money } from "@/lib/format";

export type BarRow = { key: string; label: string; value: number; color: string; sub?: string };

/** แท่งสัดส่วน (เงินฝากตามธนาคาร / ตามสมาชิก) · ยอดเป็นบาท · เรียงมาก → น้อย */
export default function ShareBars({ title, rows, note, footer }: { title: string; rows: BarRow[]; note?: string; footer?: React.ReactNode }) {
  const sorted = [...rows].filter((r) => Math.abs(r.value) > 0.005).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((t, r) => t + r.value, 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">{title} <span className="text-xs font-normal text-slate-500">(THB Equivalent)</span></h2>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {sorted.length === 0 ? <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูล</p> : (
        <div className="mt-3 divide-y divide-slate-100 text-sm">
          <div className="hidden grid-cols-[11rem_1fr_8rem_4rem] gap-3 pb-2 text-xs text-slate-500 sm:grid">
            <span>{title.includes("สมาชิก") ? "สมาชิก" : "ธนาคาร"}</span><span></span><span className="text-right">ยอด (THB)</span><span className="text-right">สัดส่วน</span>
          </div>
          {sorted.map((r) => {
            const pct = total > 0 ? (r.value / total) * 100 : 0;
            return (
              <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[11rem_1fr_8rem_4rem]">
                <span className="flex items-center gap-2 truncate">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="truncate">{r.label}</span>
                  {r.sub && <span className="text-xs text-slate-400">{r.sub}</span>}
                </span>
                <div className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-full bg-slate-100 sm:col-span-1 sm:row-start-auto">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0)}%`, background: r.color }} />
                </div>
                <span className="text-right tabular-nums text-slate-700">{money(r.value, undefined, 0)}</span>
                <span className="hidden text-right tabular-nums text-slate-600 sm:block">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
      {footer}
    </section>
  );
}
