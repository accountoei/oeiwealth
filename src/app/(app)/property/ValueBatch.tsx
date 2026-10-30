"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, diffText, marketStale, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import ModalButton from "@/components/ModalButton";
import MarketValuationForm, { type MarketValuation } from "./MarketValuationForm";
import { batchPropertyValues, type ActionState } from "./actions";
import { splitByArea } from "./valueParts";
import Flash from "@/components/Flash";

export type ValueRow = {
  id: string; name: string; typeLabel: string; currency: string; value: number | null; date: string | null;
  defaultUnit: string; areaSqWa: number | null; market: MarketValuation | null;
  /** อัตราเป็นบาท × สัดส่วนของสมาชิกที่เลือก → ยอดรวมท้ายตาราง */ factor: number;
  /** ราคาขายขั้นต่ำที่คุ้ม (ต้นทุน + ดอกเบี้ย − ค่าเสื่อม + ค่าใช้จ่ายขาย) · null = ยังไม่มีต้นทุน */ minPrice: number | null;
  /** ส่วนประกอบ + มูลค่าครั้งล่าสุดรายแถว (null = ครั้งล่าสุดเป็นยอดรวมอย่างเดียว) */
  parts: { id: string; label: string; type: "LAND" | "BUILDING" | "OTHER"; area: number | null; value: number | null }[];
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, ""));
const filled = (s: string | undefined) => (s ?? "").trim() !== "";

/**
 * แท็บ อัปเดตมูลค่า (ตกลง 28 ต.ค. 2026) — มูลค่าใน Net Worth ของทุกทรัพย์สินในตารางเดียว + ราคาตลาด (อ้างอิง · ไม่นับใน Net Worth)
 *   กรอกมูลค่าใหม่เฉพาะแถวที่เปลี่ยน (ช่องว่าง = ไม่บันทึก) · วันที่ / วิธีเดียวทั้งชุด · ปุ่ม "ราคาตลาด" ของแต่ละแถวบันทึกแยก
 *   ทรัพย์สินที่มีส่วนประกอบ (29 ต.ค. 2026): กด "รายแถว" กางที่ดิน / อาคารในตาราง · กรอกเฉพาะแถวที่เปลี่ยน (ว่าง = เท่าเดิม)
 *   กรอกยอดรวม (30 ต.ค. 2026 · กติกาเดียวกับหน้าทรัพย์สิน) → สิ่งปลูกสร้างเท่าเดิม / ตามที่พิมพ์ · ที่ดินได้ส่วนที่เหลือ แบ่งตามเนื้อที่ · เห็นรายแถวทันที
 */
type Plan = { total: number | null; parts: { deed_id: string; value: number }[] | null; est: Record<string, number>; error?: string };
const round2 = (x: number) => Math.round(x * 100) / 100;
export default function ValueBatch({ rows, today, minDate, canWrite, shareNote }: {
  rows: ValueRow[]; today: string; minDate: string; canWrite: boolean; shareNote: string | null;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("USER_ESTIMATE");
  const [notes, setNotes] = useState("");
  const [nv, setNv] = useState<Record<string, string>>({});
  const [pv, setPv] = useState<Record<string, Record<string, string>>>({});   // asset → ส่วนประกอบ → มูลค่าใหม่
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await batchPropertyValues(prev, form);
    if (r.ok) { setNv({}); setPv({}); setNotes(""); router.refresh(); }
    return r;
  }, {});

  // มูลค่าใหม่ของแต่ละทรัพย์สิน: ยอดรวม · รายแถว (ส่งเมื่อรู้ครบทุกแถว) · ตัวเลขประมาณรายแถวไว้แสดงสีเทา
  const planOf = (r: ValueRow): Plan => {
    const sub = pv[r.id] ?? {};
    const typed = (id: string) => filled(sub[id]);
    const totalTyped = filled(nv[r.id]);
    const anySub = r.parts.some((x) => typed(x.id));
    if (!totalTyped && !anySub) return { total: null, parts: null, est: {} };
    const eff: Record<string, number | null> = {};
    for (const x of r.parts) eff[x.id] = typed(x.id) ? n(sub[x.id]) : x.value;
    if (totalTyped && r.parts.length > 1) {
      const total = n(nv[r.id]);
      // ที่ดินที่ไม่ได้พิมพ์เอง รับส่วนที่เหลือตามเนื้อที่ · ไม่มีที่ดิน → แถวเดียวที่ไม่ได้พิมพ์
      const untyped = r.parts.filter((x) => !typed(x.id));
      const lands = untyped.filter((x) => x.type === "LAND").length ? untyped.filter((x) => x.type === "LAND") : untyped.length === 1 ? untyped : [];
      if (lands.length) {
        const others = r.parts.filter((x) => !lands.includes(x));
        if (others.some((x) => eff[x.id] == null)) return { total, parts: null, est: {} };          // ครั้งก่อนไม่มีรายแถว → ส่งยอดรวม
        const share = splitByArea(round2(total - others.reduce((t, x) => t + Number(eff[x.id]), 0)), lands.map((x) => x.area ?? 0));
        lands.forEach((x, i) => { eff[x.id] = share[i]; });
        const est = Object.fromEntries(lands.map((x) => [x.id, Number(eff[x.id])]));
        if (share.some((v) => v < 0)) return { total, parts: null, est, error: "ยอดรวมน้อยกว่ามูลค่าสิ่งปลูกสร้าง" };
        return { total, parts: r.parts.map((x) => ({ deed_id: x.id, value: Number(eff[x.id]) })), est };
      }
      if (!anySub) return { total, parts: null, est: {} };
      const sum = round2(r.parts.reduce((t, x) => t + Number(eff[x.id] ?? 0), 0));
      if (r.parts.some((x) => eff[x.id] == null) || Math.abs(sum - total) > 0.005)
        return { total, parts: null, est: {}, error: "ยอดรวมไม่เท่าผลรวมรายแถว" };
      return { total, parts: r.parts.map((x) => ({ deed_id: x.id, value: Number(eff[x.id]) })), est: {} };
    }
    if (totalTyped) return { total: n(nv[r.id]), parts: null, est: {} };
    if (r.parts.some((x) => eff[x.id] == null)) return { total: NaN, parts: null, est: {}, error: "ครั้งก่อนไม่มีมูลค่ารายแถว ต้องกรอกให้ครบทุกแถว" };
    const parts = r.parts.map((x) => ({ deed_id: x.id, value: Number(eff[x.id]) }));
    return { total: round2(parts.reduce((t, x) => t + x.value, 0)), parts, est: {} };
  };
  const plans = new Map(rows.map((r) => [r.id, planOf(r)]));
  const planOfRow = (r: ValueRow) => plans.get(r.id)!;
  const chosen = rows.filter((r) => planOfRow(r).total !== null);
  const incomplete = rows.filter((r) => planOfRow(r).error);
  const payload = chosen.map((r) => {
    const pl = planOfRow(r);
    return pl.parts ? { asset_id: r.id, parts: pl.parts } : { asset_id: r.id, value: nv[r.id] };
  });
  const setSub = (r: ValueRow, pid: string, v: string) => setPv({ ...pv, [r.id]: { ...(pv[r.id] ?? {}), [pid]: v } });
  const onSubmit = cf.guard(`บันทึกมูลค่าใหม่ ${chosen.length} รายการ ณ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  // ยอดรวม (บาท · ตามสัดส่วนของสมาชิกที่เลือก) · ราคาตลาดรวมเฉพาะรายการที่ประเมินแล้ว
  const nwTotal = rows.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);
  const valued = rows.filter((r) => r.market);
  const mkTotal = valued.reduce((t, r) => t + Number(r.market!.market_value) * r.factor, 0);
  const nwOfValued = valued.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);

  return (
    <>
    {cf.dialog}
    {/* ฟอร์มบันทึกอยู่ล่างตาราง (ตารางมีฟอร์มราคาตลาดใน pop up ของแต่ละแถว → ห้ามซ้อนฟอร์ม) */}
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">วิธี
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={small}>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
              <option value="APPRAISAL">ราคาประเมิน (ราชการ / ธนาคาร)</option>
            </select></label>
          <label className="flex min-w-[12rem] flex-1 items-center gap-2">หมายเหตุ
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น ราคาประเมินราชการรอบใหม่" className={`w-full ${small}`} /></label>
          <label className="ml-auto flex items-center gap-2">มูลค่า ณ วันที่
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          มูลค่าใหม่ = มูลค่าที่นับใน Net Worth (กรอกเฉพาะรายการที่เปลี่ยน · ช่องว่าง = ไม่บันทึก) · ใส่ยอดรวม → สิ่งปลูกสร้างเท่าเดิม ที่ดินได้ส่วนที่เหลือตามเนื้อที่ (พิมพ์ทับรายแถวได้)
          · ราคาตลาดเป็นข้อมูลอ้างอิงเท่านั้น ไม่นับใน Net Worth กดที่ตัวเลข (หรือ &ldquo;ประเมิน&rdquo;) เพื่อบันทึก{shareNote && ` · ${shareNote}`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[12rem] px-3 py-2">ทรัพย์สิน</th>
              <th className="w-40 px-3 text-right">มูลค่าใน Net Worth</th>
              <th className="w-40 px-3 text-right">มูลค่าใหม่</th>
              <th className="w-40 px-3 text-right">ราคาขั้นต่ำที่คุ้ม</th>
              <th className="w-40 px-3 text-right">ราคาตลาด (อ้างอิง)</th>
              <th className="w-40 px-3 text-right">ส่วนต่างจาก Net Worth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีทรัพย์สินที่ถืออยู่</td></tr>}
            {rows.map((r) => {
              const m = r.market;
              const v = Number(r.value ?? 0);
              const nwStale = !r.date || r.date < addDays(today, -365);
              const pl = planOfRow(r);
              const subOnly = !filled(nv[r.id]) && pl.total !== null;            // พิมพ์เฉพาะรายแถว → ยอดรวมคำนวณให้
              const shown = open[r.id] ?? (filled(nv[r.id]) && Object.keys(pl.est).length > 0);   // ใส่ยอดรวม → กางให้เห็นรายแถว
              const market = m && (canWrite ? (
                <ModalButton label={money(m.market_value, r.currency, 0)} title={`ประเมินราคาตลาด · ${r.name}`} size="lg" className="tabular-nums text-blue-700 hover:underline">
                  <MarketValuationForm assetId={r.id} currency={r.currency} today={today} defaultUnit={r.defaultUnit} areaSqWa={r.areaSqWa} last={m} />
                </ModalButton>
              ) : money(m.market_value, r.currency, 0));
              return (
                <Fragment key={r.id}>
                <tr className={`align-top ${pl.total !== null ? "bg-blue-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/property/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.typeLabel} · {r.currency}</div>
                    {r.parts.length > 1 && (
                      <button type="button" onClick={() => setOpen({ ...open, [r.id]: !shown })} className="mt-1 text-xs text-blue-700 hover:underline">
                        {shown ? "▾ ซ่อนรายแถว" : `▸ รายแถว (${r.parts.length})`}</button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.value == null ? "-" : money(r.value, r.currency, 0)}
                    <div className={`text-xs ${nwStale ? "text-amber-700" : "text-slate-400"}`}>{r.date ? thDate(r.date) : "ยังไม่มีมูลค่า"}{nwStale && r.date && " · เกิน 12 เดือน"}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {subOnly ? (
                      <div className="w-36 py-1 text-right font-medium tabular-nums">{Number.isNaN(pl.total) ? "-" : money(pl.total, undefined, 2)}</div>
                    ) : (
                      <input inputMode="decimal" value={nv[r.id] ?? ""} disabled={!canWrite} placeholder={r.currency} aria-label={`มูลค่าใหม่ ${r.name}`}
                        onChange={(e) => setNv({ ...nv, [r.id]: e.target.value })} className={`w-36 text-right ${small}`} />
                    )}
                    {pl.total !== null && !Number.isNaN(pl.total) && r.value != null && (
                      <div className={`text-xs tabular-nums ${pl.total >= v ? "text-emerald-700" : "text-red-700"}`}>{diffText(pl.total - v, v)}</div>
                    )}
                    {pl.error && <div className="text-xs text-amber-700">{pl.error}</div>}
                    {!pl.error && !subOnly && pl.total !== null && !pl.parts && r.parts.some((p) => p.value != null) && (
                      <div className="text-xs text-slate-400">แบ่งรายแถวตามสัดส่วนเดิม</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.minPrice == null ? <span className="text-xs text-slate-400">ยังไม่มีต้นทุน</span> : (<>
                    {money(r.minPrice, r.currency, 0)}
                    {r.value != null && <div className={`text-xs ${r.minPrice >= v ? "text-emerald-700" : "text-red-700"}`}>{diffText(r.minPrice - v, v)}</div>}
                  </>)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {!m ? (canWrite ? (
                      <ModalButton label="ประเมิน" title={`ประเมินราคาตลาด · ${r.name}`} size="lg" className="text-xs text-blue-700 hover:underline">
                        <MarketValuationForm assetId={r.id} currency={r.currency} today={today} defaultUnit={r.defaultUnit} areaSqWa={r.areaSqWa} last={m} />
                      </ModalButton>
                    ) : <span className="text-xs text-slate-400">ยังไม่ประเมิน</span>) : (<>
                      {market}
                      {r.minPrice != null && <div className={`text-xs ${Number(m.market_value) >= r.minPrice ? "text-emerald-700" : "text-red-700"}`}>
                        {Number(m.market_value) >= r.minPrice ? "คุ้ม " : "ยังไม่คุ้ม "}{diffText(Number(m.market_value) - r.minPrice, r.minPrice)}</div>}
                      {marketStale(m.valuation_date, today) && <div className="text-xs text-amber-700">เกิน 12 เดือน</div>}
                    </>)}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${!m ? "text-slate-400" : Number(m.market_value) >= v ? "text-emerald-700" : "text-red-700"}`}>
                    {m && r.value != null ? diffText(Number(m.market_value) - v, v) : "-"}
                    {m && Number(m.selling_cost) > 0 && <div className="text-xs text-slate-400">หักค่าใช้จ่ายขาย {money(m.selling_cost, undefined, 0)}</div>}
                  </td>
                </tr>
                {shown && r.parts.map((p) => (
                  <tr key={p.id} className="bg-slate-50/60 text-xs">
                    <td className="py-1.5 pl-8 pr-3">{p.label}</td>
                    <td className="px-3 text-right tabular-nums text-slate-600">{p.value != null ? money(p.value, undefined, 0) : "-"}</td>
                    <td className="px-3 py-1 text-right">
                      <input inputMode="decimal" value={pv[r.id]?.[p.id] ?? ""} disabled={!canWrite}
                        placeholder={pl.est[p.id] != null ? money(pl.est[p.id], undefined, 2) : p.value != null ? "เท่าเดิม" : "ต้องกรอก"}
                        aria-label={`มูลค่าใหม่ ${r.name} ${p.label}`}
                        onChange={(e) => setSub(r, p.id, e.target.value)} className={`w-36 text-right ${small}`} />
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                ))}
                </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr className="align-top">
                <td className="px-3 py-2">รวม (THB)</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(nwTotal, "THB", 0)}</td>
                <td></td>
                <td></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{valued.length ? money(mkTotal, "THB", 0) : "-"}
                  {valued.length < rows.length && <div className="text-xs font-normal text-amber-700">ยังไม่ประเมิน {rows.length - valued.length} รายการ</div>}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${mkTotal >= nwOfValued ? "text-emerald-700" : "text-red-700"}`}>
                  {valued.length ? diffText(mkTotal - nwOfValued, nwOfValued) : "-"}
                  {valued.length > 0 && valued.length < rows.length && <div className="text-xs font-normal text-slate-400">เทียบเฉพาะ {valued.length} รายการที่ประเมินแล้ว</div>}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canWrite && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="valuation_method" value={method} />
          <input type="hidden" name="notes" value={notes} />
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <button disabled={pending || chosen.length === 0 || incomplete.length > 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกมูลค่า ${chosen.length} รายการ ณ ${thDate(date)}`}
          </button>
          {chosen.length > 0 && !pending && (
            <button type="button" onClick={() => { setNv({}); setPv({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>
          )}
          {incomplete.length > 0 && <span className="text-sm text-amber-700">{incomplete.map((r) => `${r.name}: ${planOfRow(r).error}`).join(" · ")}</span>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </form>
      )}
    </div>
    </>
  );
}

