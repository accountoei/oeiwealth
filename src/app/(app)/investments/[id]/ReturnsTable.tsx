import Link from "next/link";
import { HOLDING_TYPE_LABEL, money } from "@/lib/format";

export type Ret = {
  holding_id: string; name: string; holding_type: string; currency: string; status: string;
  cost_thb: number; value_thb: number; unrealized_thb: number; unrealized_fx_thb: number;
  realized_thb: number; realized_fx_thb: number; income_thb: number; fees_thb: number; total_thb: number;
};

const cls = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");
const sign = (v: number) => `${v > 0 ? "+" : ""}${money(v, undefined, 0)}`;

/** ผลตอบแทนต่อหลักทรัพย์ (บาท) — แยกส่วนที่มาจากค่าเงิน */
export default function ReturnsTable({ rows, hrefBase, title = "ผลตอบแทน (บาท)" }: { rows: Ret[]; hrefBase?: string; title?: string }) {
  if (!rows.length) return null;
  const sum = (k: keyof Ret) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const hasFx = rows.some((r) => r.currency !== "THB");
  const cost = sum("cost_thb");
  const total = sum("total_thb");
  return (
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium text-slate-900">{title}</h2>
        <span className="text-xs text-slate-500">ต้นทุนเฉลี่ย · นับตั้งแต่ยอดตั้งต้น / Go-live · ตีเป็นบาทด้วยอัตราวันที่ทำรายการ และอัตราล่าสุดสำหรับมูลค่าปัจจุบัน</span>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-4 py-2">หลักทรัพย์</th><th className="px-3 text-right">ต้นทุน (ที่ยังถือ)</th><th className="px-3 text-right">มูลค่าปัจจุบัน</th>
            <th className="px-3 text-right">ยังไม่รับรู้</th><th className="px-3 text-right">รับรู้แล้ว (ขาย / ครบกำหนด)</th>
            <th className="px-3 text-right">ปันผล / ดอกเบี้ย</th><th className="px-3 text-right">ค่าธรรมเนียมอื่น</th><th className="px-3 text-right">รวม</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.holding_id} className={r.status !== "ACTIVE" ? "text-slate-500" : ""}>
              <td className="px-4 py-2">
                {hrefBase ? <Link href={`${hrefBase}${r.holding_id}`} className="hover:underline">{r.name}</Link> : r.name}
                <div className="text-xs text-slate-500">{HOLDING_TYPE_LABEL[r.holding_type] ?? r.holding_type} · {r.currency}{r.status !== "ACTIVE" && " · ปิดแล้ว"}</div>
              </td>
              <td className="px-3 text-right tabular-nums">{Number(r.cost_thb) ? money(r.cost_thb, undefined, 0) : "-"}</td>
              <td className="px-3 text-right tabular-nums">{Number(r.value_thb) ? money(r.value_thb, undefined, 0) : "-"}</td>
              <Cell v={Number(r.unrealized_thb)} fx={Number(r.unrealized_fx_thb)} showFx={r.currency !== "THB"} />
              <Cell v={Number(r.realized_thb)} fx={Number(r.realized_fx_thb)} showFx={r.currency !== "THB"} />
              <td className={`px-3 text-right tabular-nums ${cls(Number(r.income_thb))}`}>{Number(r.income_thb) ? sign(Number(r.income_thb)) : "-"}</td>
              <td className="px-3 text-right tabular-nums text-slate-600">{Number(r.fees_thb) ? `-${money(r.fees_thb, undefined, 0)}` : "-"}</td>
              <td className={`px-3 text-right font-medium tabular-nums ${cls(Number(r.total_thb))}`}>{sign(Number(r.total_thb))}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot className="border-t border-slate-200 font-medium">
            <tr>
              <td className="px-4 py-2">รวม</td>
              <td className="px-3 text-right tabular-nums">{money(cost, undefined, 0)}</td>
              <td className="px-3 text-right tabular-nums">{money(sum("value_thb"), undefined, 0)}</td>
              <Cell v={sum("unrealized_thb")} fx={sum("unrealized_fx_thb")} showFx={hasFx} />
              <Cell v={sum("realized_thb")} fx={sum("realized_fx_thb")} showFx={hasFx} />
              <td className={`px-3 text-right tabular-nums ${cls(sum("income_thb"))}`}>{sign(sum("income_thb"))}</td>
              <td className="px-3 text-right tabular-nums">{sum("fees_thb") ? `-${money(sum("fees_thb"), undefined, 0)}` : "-"}</td>
              <td className={`px-3 text-right tabular-nums ${cls(total)}`}>{sign(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="px-4 py-3 text-xs text-slate-500">
        {hasFx && "“จาก FX” = ส่วนของกำไร/ขาดทุนที่เกิดจากค่าเงินเปลี่ยน (สินทรัพย์สกุลต่างประเทศ) · "}
        เงินสดในพอร์ตไม่แสดงในตารางนี้ · ค่าธรรมเนียมซื้อขายรวมอยู่ในต้นทุน / เงินขายแล้ว
      </p>
    </section>
  );
}

function Cell({ v, fx, showFx }: { v: number; fx: number; showFx: boolean }) {
  return (
    <td className={`px-3 text-right tabular-nums ${cls(v)}`}>
      {v ? sign(v) : "-"}
      {showFx && fx !== 0 && <div className="text-xs text-slate-500">จาก FX {sign(fx)}</div>}
    </td>
  );
}
