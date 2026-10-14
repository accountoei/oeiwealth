import { money, thDate } from "@/lib/format";

export type CatItem = { name: string; date: string; value: number };
export type CatRow = { label: string; value: number; items: CatItem[]; pending?: boolean };

const SHADES: Record<"income" | "expense", string[]> = {
  income: ["#047857", "#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
  expense: ["#b91c1c", "#dc2626", "#ef4444", "#f87171", "#fca5a5", "#fecaca"],
};
const PENDING = "#f59e0b";
const shade = (kind: "income" | "expense", i: number) => SHADES[kind][Math.min(i, SHADES[kind].length - 1)];

/** สรุปตามประเภท / หมวด: แถบสัดส่วน + ยอด (บาท) · กดหมวดเพื่อดูรายการ · "รอแยกรายละเอียด" สีเหลืองอยู่ท้ายสุด */
export default function CategoryBars({ title, note, kind, rows, empty }: {
  title: string; note?: string; kind: "income" | "expense"; rows: CatRow[]; empty?: string;
}) {
  const sorted = [...rows].filter((r) => Math.abs(r.value) > 0.005 || r.items.length)
    .sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || b.value - a.value);
  const total = sorted.reduce((t, r) => t + r.value, 0);
  let shadeIx = 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium text-slate-900">{title}</h2>
        {sorted.length > 0 && <span className={`tabular-nums font-semibold ${kind === "income" ? "text-emerald-700" : "text-red-700"}`}>{money(total, undefined, 0)}</span>}
      </div>
      <p className="mb-3 text-xs text-slate-500">{note ?? "กดที่หมวดเพื่อดูรายการ"}</p>
      {sorted.length === 0 ? <p className="text-sm text-slate-500">{empty ?? "ยังไม่มีรายการ"}</p> : (
        <div className="divide-y divide-slate-100 text-sm">
          {sorted.map((r) => {
            const color = r.pending ? PENDING : shade(kind, shadeIx++);
            const pct = total > 0 ? (r.value / total) * 100 : 0;
            return (
              <details key={r.label} className="group py-2.5">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[12rem_1fr_3.5rem_7.5rem_1rem]">
                    <span className={`flex items-center gap-2 whitespace-nowrap ${r.pending ? "text-amber-800" : ""}`}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />{r.label}
                      <span className="text-xs text-slate-400">({r.items.length})</span>
                    </span>
                    <div className={`col-span-2 row-start-2 h-2.5 overflow-hidden rounded-full sm:col-span-1 sm:row-start-auto ${kind === "income" ? "bg-emerald-50" : "bg-red-50"}`}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0)}%`, background: color }} />
                    </div>
                    <span className="hidden text-right tabular-nums font-medium text-slate-700 sm:block">{pct.toFixed(1)}%</span>
                    <span className="text-right tabular-nums text-slate-700">
                      <span className="mr-2 font-medium sm:hidden">{pct.toFixed(1)}%</span>{money(r.value, undefined, 0)}
                    </span>
                    <span className="hidden text-slate-400 transition-transform group-open:rotate-90 sm:block">▸</span>
                  </div>
                </summary>
                <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 sm:ml-[1.125rem] sm:mr-7">
                  {[...r.items].sort((a, b) => b.value - a.value).map((it, k) => (
                    <li key={k} className="flex justify-between gap-3">
                      <span>{it.name}<span className="text-xs text-slate-400"> · {thDate(it.date)}</span></span>
                      <span className="shrink-0 tabular-nums">{money(it.value, undefined, 0)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
