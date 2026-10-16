"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { batchUpdate, type BatchState } from "./actions";

export type BatchRow = {
  id: string; name: string; bank: string; currency: string;
  lastDate: string | null; lastValue: number | null; calculated: number | null; pendingLump: boolean;
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, ""));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * อัปเดตยอดคงเหลือหลายบัญชีพร้อมกัน: เลือกวันที่ → กรอกยอดจริงจากแอปธนาคาร → เห็นส่วนต่างทันที → บันทึกครั้งเดียว
 *   พิมพ์ยอดแล้วติ๊กให้เอง · ส่วนต่างลงก้อน "รอแยกรายละเอียด" อัตโนมัติ · บัญชีไหนผิด = ไม่บันทึกเลยสักบัญชี
 */
export default function BatchUpdate({ date, today, minDate, rows, canWrite, ym }: {
  date: string; today: string; minDate: string; rows: BatchRow[]; canWrite: boolean; ym: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [state, action, pending] = useActionState<BatchState, FormData>(batchUpdate, {});
  // บันทึกแล้ว → ล้างช่องที่กรอก + โหลดยอดใหม่ (ผลรายบัญชียังแสดงอยู่)
  useEffect(() => { if (state.ok) { setVals({}); setChecked({}); router.refresh(); } }, [state, router]);
  const result = new Map((state.results ?? []).map((r) => [r.asset_id, r]));

  const pickDate = (d: string) => {
    const q = new URLSearchParams(window.location.search);
    q.set("tab", "update"); q.set("d", d);
    router.push(`${pathname}?${q}`, { scroll: false });
  };
  const allOn = rows.length > 0 && rows.every((r) => checked[r.id]);
  const chosen = rows.filter((r) => checked[r.id] && (vals[r.id] ?? "").trim() !== "");
  const missing = rows.filter((r) => checked[r.id] && (vals[r.id] ?? "").trim() === "").length;
  const onSubmit = (e: React.FormEvent) => {
    if (!confirm(`บันทึกยอดคงเหลือ ${chosen.length} บัญชี ณ ${thDate(date)} ?\nส่วนต่างจะลงเป็นก้อน "รอแยกรายละเอียด" ให้อัตโนมัติ`)) e.preventDefault();
  };

  return (
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="rows" value={JSON.stringify(chosen.map((r) => ({ asset_id: r.id, value: vals[r.id] })))} />
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <label className="flex items-center gap-2">ยอด ณ วันที่
          <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && pickDate(e.target.value)} className={small} />
        </label>
        {canWrite && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allOn} onChange={(e) => setChecked(Object.fromEntries(rows.map((r) => [r.id, e.target.checked])))} />
            เลือกทั้งหมด
          </label>
        )}
        <span className="text-xs text-slate-500">กรอกยอดจริงจากแอปธนาคาร / Statement · พิมพ์ยอดแล้วติ๊กให้เอง · ส่วนต่างลงก้อน &ldquo;รอแยกรายละเอียด&rdquo; อัตโนมัติ</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2"></th><th className="px-3">บัญชี</th>
              <th className="px-3 text-right">ยอดตาม Statement ล่าสุด</th>
              <th className="px-3 text-right">ยอดตามระบบ ณ {thDate(date)}</th>
              <th className="px-3 text-right">ยอดจริง</th><th className="px-3 text-right">ส่วนต่าง</th><th className="px-3">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">ไม่มีบัญชีที่ใช้งานอยู่</td></tr>}
            {rows.map((r) => {
              const v = vals[r.id] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const diff = has && r.calculated != null ? Math.round((n(v) - r.calculated) * 100) / 100 : null;
              const res = result.get(r.id);
              const old = r.lastDate ? daysBetween(r.lastDate, date) : null;
              return (
                <tr key={r.id} className={checked[r.id] ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    {canWrite && <input type="checkbox" checked={!!checked[r.id]} onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/financial/cash/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.bank} · {r.currency}</div>
                  </td>
                  <td className="px-3 text-right tabular-nums">
                    {r.lastValue == null ? "-" : money(r.lastValue, r.currency)}
                    {r.lastDate && <div className="text-xs text-slate-400">{thDate(r.lastDate)}</div>}
                  </td>
                  <td className="px-3 text-right tabular-nums">{r.calculated == null ? "-" : money(r.calculated, r.currency)}</td>
                  <td className="px-3 text-right">
                    <input inputMode="decimal" value={v} disabled={!canWrite} placeholder={r.currency} aria-label={`ยอดจริง ${r.name}`}
                      onChange={(e) => { const s = e.target.value; setVals({ ...vals, [r.id]: s }); if (s.trim()) setChecked((c) => ({ ...c, [r.id]: true })); }}
                      className={`w-36 text-right ${small}`} />
                  </td>
                  <td className={`px-3 text-right tabular-nums ${diff == null ? "text-slate-400" : Math.abs(diff) < 0.005 ? "text-emerald-700" : "text-amber-700"}`}>
                    {diff == null ? "-" : Math.abs(diff) < 0.005 ? "ตรง ✓" : `${diff > 0 ? "+" : ""}${money(diff, r.currency)}`}
                  </td>
                  <td className="px-3 text-xs">
                    {res ? (
                      res.history_only ? <span className="text-slate-600">บันทึกแล้ว (เป็นประวัติ · ก้อนผูกกับยอดวันหลังกว่า)</span>
                      : res.lump == null || Math.abs(res.lump) < 0.005 ? <span className="text-emerald-700">บันทึกแล้ว · ตรง ✓</span>
                      : <Link href={`/income-expenses?tab=${res.lump > 0 ? "income&it" : "expense&et"}=recorded&m=${date.slice(0, 7)}`} className="text-amber-700 underline">
                          บันทึกแล้ว · {res.lump > 0 ? "รายได้" : "ค่าใช้จ่าย"}ก้อนรอแยก {money(Math.abs(res.lump), r.currency)}</Link>
                    ) : r.lastDate === date ? <span className="text-emerald-700">อัปเดตแล้ว ณ {thDate(date)}</span>
                      : r.lastDate == null ? <span className="text-slate-500">ยังไม่มียอด</span>
                      : old != null && old > 30 ? <span className="text-amber-700">ยอดล่าสุดเก่ากว่า 30 วัน</span>
                      : <span className="text-slate-500">ล่าสุด {thDate(r.lastDate)}</span>}
                    {!res && r.pendingLump && <div><Link href={`/income-expenses?tab=expense&et=recorded&m=${ym}`} className="text-amber-700 underline">มีก้อนรอแยก</Link></div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0 || missing > 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `ยืนยันประมวลผล · บันทึกยอด ${chosen.length} บัญชี ณ ${thDate(date)}`}
          </button>
          {missing > 0 && <span className="text-xs text-amber-700">มี {missing} บัญชีที่ติ๊กแต่ยังไม่ได้กรอกยอด</span>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
    </form>
  );
}
