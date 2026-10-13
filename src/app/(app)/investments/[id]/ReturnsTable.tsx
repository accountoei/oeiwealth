"use client";

import Link from "next/link";
import { useState } from "react";
import { HOLDING_TYPE_LABEL, money } from "@/lib/format";

/** ผลตอบแทนเป็นบาท (investment_returns) */
export type Ret = {
  holding_id: string; name: string; holding_type: string; currency: string; status: string;
  cost_thb: number; value_thb: number; unrealized_thb: number; unrealized_fx_thb: number;
  realized_thb: number; realized_fx_thb: number; income_thb: number; fees_thb: number; total_thb: number;
};
/** ผลตอบแทนในสกุลหลักทรัพย์ (investment_returns_local) */
export type RetLocal = {
  holding_id: string; currency: string; cost: number; value: number; unrealized: number;
  realized: number; income: number; fees: number; total: number;
};
/** อัตราบาทต่อ 1 หน่วย (ล่าสุด) ของแต่ละสกุล — ใช้แปลงสกุลหลักทรัพย์ → สกุลพอร์ต */
export type Rates = Record<string, number>;

type Row = { holding_id: string; name: string; holding_type: string; currency: string; status: string;
  cost: number; value: number; unreal: number; unrealFx: number; real: number; realFx: number; income: number; fees: number; total: number };

const cls = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");

/**
 * ผลตอบแทนต่อหลักทรัพย์ · ปุ่มสลับ "ดูเป็น {สกุลพอร์ต} / ดูเป็นบาท" (เริ่มที่สกุลพอร์ต)
 * มุมสกุลพอร์ต: ตัวเลขในสกุลหลักทรัพย์ → แปลงเป็นสกุลพอร์ตด้วยอัตราล่าสุด (ไม่รวมผลค่าเงินบาท)
 */
export default function ReturnsTable({ rows, local = [], portfolioCurrency = "THB", rates = {}, hrefBase, title }: {
  rows: Ret[]; local?: RetLocal[]; portfolioCurrency?: string; rates?: Rates; hrefBase?: string; title?: string;
}) {
  const canLocal = portfolioCurrency !== "THB" && local.length > 0;
  const [view, setView] = useState<"PF" | "THB">(canLocal ? "PF" : "THB");
  if (!rows.length) return null;
  const isPf = canLocal && view === "PF";
  const unit = isPf ? portfolioCurrency : "บาท";

  const byId = new Map(local.map((l) => [l.holding_id, l]));
  const pfRate = rates[portfolioCurrency] ?? null;
  const conv = (v: number, ccy: string) => {
    if (ccy === portfolioCurrency) return v;
    const r = ccy === "THB" ? 1 : rates[ccy];
    return r && pfRate ? (v * r) / pfRate : 0;
  };
  const data: Row[] = rows.map((r) => {
    if (!isPf) return { holding_id: r.holding_id, name: r.name, holding_type: r.holding_type, currency: r.currency, status: r.status,
      cost: Number(r.cost_thb), value: Number(r.value_thb), unreal: Number(r.unrealized_thb), unrealFx: Number(r.unrealized_fx_thb),
      real: Number(r.realized_thb), realFx: Number(r.realized_fx_thb), income: Number(r.income_thb), fees: Number(r.fees_thb), total: Number(r.total_thb) };
    const l = byId.get(r.holding_id);
    const c = (k: keyof RetLocal) => conv(Number(l?.[k] ?? 0), r.currency);
    return { holding_id: r.holding_id, name: r.name, holding_type: r.holding_type, currency: r.currency, status: r.status,
      cost: c("cost"), value: c("value"), unreal: c("unrealized"), unrealFx: 0, real: c("realized"), realFx: 0,
      income: c("income"), fees: c("fees"), total: c("total") };
  });
  const sum = (k: keyof Row) => data.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const showFx = !isPf && data.some((r) => r.currency !== "THB");
  const otherCcy = isPf && data.some((r) => r.currency !== portfolioCurrency);
  const m = (v: number) => money(v, undefined, isPf ? 2 : 0);
  const sign = (v: number) => `${v > 0 ? "+" : ""}${m(v)}`;

  return (
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium text-slate-900">{title ?? "ผลตอบแทน"} ({unit})</h2>
        {canLocal && (
          <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-xs" role="group" aria-label="สกุลที่ใช้แสดงผลตอบแทน">
            {(["PF", "THB"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={`rounded px-3 py-1 ${view === v ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                {v === "PF" ? `ดูเป็น ${portfolioCurrency}` : "ดูเป็นบาท"}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="px-4 pt-1 text-xs text-slate-500">
        ต้นทุนเฉลี่ย · นับตั้งแต่ยอดตั้งต้น / Go-live ·{" "}
        {isPf ? `ไม่รวมผลจากค่าเงินบาท${otherCcy ? ` · สกุลอื่นแปลงเป็น ${portfolioCurrency} ด้วยอัตราล่าสุด` : ""}`
          : "ตีเป็นบาทด้วยอัตราวันที่ทำรายการ และอัตราล่าสุดสำหรับมูลค่าปัจจุบัน"}
      </p>
      <table className="mt-2 w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-4 py-2">หลักทรัพย์</th><th className="px-3 text-right">ต้นทุน (ที่ยังถือ)</th><th className="px-3 text-right">มูลค่าปัจจุบัน</th>
            <th className="px-3 text-right">ยังไม่รับรู้</th><th className="px-3 text-right">รับรู้แล้ว (ขาย / ครบกำหนด)</th>
            <th className="px-3 text-right">ปันผล / ดอกเบี้ย</th><th className="px-3 text-right">ค่าธรรมเนียมอื่น</th><th className="px-3 text-right">รวม</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((r) => (
            <tr key={r.holding_id} className={r.status !== "ACTIVE" ? "text-slate-500" : ""}>
              <td className="px-4 py-2">
                {hrefBase ? <Link href={`${hrefBase}${r.holding_id}`} className="hover:underline">{r.name}</Link> : r.name}
                <div className="text-xs text-slate-500">{HOLDING_TYPE_LABEL[r.holding_type] ?? r.holding_type} · {r.currency}{r.status !== "ACTIVE" && " · ปิดแล้ว"}</div>
              </td>
              <td className="px-3 text-right tabular-nums">{r.cost ? m(r.cost) : "-"}</td>
              <td className="px-3 text-right tabular-nums">{r.value ? m(r.value) : "-"}</td>
              <Cell v={r.unreal} fx={r.unrealFx} showFx={showFx && r.currency !== "THB"} sign={sign} />
              <Cell v={r.real} fx={r.realFx} showFx={showFx && r.currency !== "THB"} sign={sign} />
              <td className={`px-3 text-right tabular-nums ${cls(r.income)}`}>{r.income ? sign(r.income) : "-"}</td>
              <td className="px-3 text-right tabular-nums text-slate-600">{r.fees ? `-${m(r.fees)}` : "-"}</td>
              <td className={`px-3 text-right font-medium tabular-nums ${cls(r.total)}`}>{sign(r.total)}</td>
            </tr>
          ))}
        </tbody>
        {data.length > 1 && (
          <tfoot className="border-t border-slate-200 font-medium">
            <tr>
              <td className="px-4 py-2">รวม</td>
              <td className="px-3 text-right tabular-nums">{m(sum("cost"))}</td>
              <td className="px-3 text-right tabular-nums">{m(sum("value"))}</td>
              <Cell v={sum("unreal")} fx={sum("unrealFx")} showFx={showFx} sign={sign} />
              <Cell v={sum("real")} fx={sum("realFx")} showFx={showFx} sign={sign} />
              <td className={`px-3 text-right tabular-nums ${cls(sum("income"))}`}>{sign(sum("income"))}</td>
              <td className="px-3 text-right tabular-nums">{sum("fees") ? `-${m(sum("fees"))}` : "-"}</td>
              <td className={`px-3 text-right tabular-nums ${cls(sum("total"))}`}>{sign(sum("total"))}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="px-4 py-3 text-xs text-slate-500">
        {showFx && "“จาก FX” = ส่วนของกำไร/ขาดทุนที่เกิดจากค่าเงินเปลี่ยน (สินทรัพย์สกุลต่างประเทศ) · "}
        เงินสดในพอร์ตไม่แสดงในตารางนี้ · ค่าธรรมเนียมซื้อขายรวมอยู่ในต้นทุน / เงินขายแล้ว
      </p>
    </section>
  );
}

function Cell({ v, fx, showFx, sign }: { v: number; fx: number; showFx: boolean; sign: (v: number) => string }) {
  return (
    <td className={`px-3 text-right tabular-nums ${cls(v)}`}>
      {v ? sign(v) : "-"}
      {showFx && fx !== 0 && <div className="text-xs text-slate-500">จาก FX {sign(fx)}</div>}
    </td>
  );
}
