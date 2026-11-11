"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { SMALL_BTN, addDays, diffText, marketStale, money, PROPERTY_TYPE_LABEL, thDate, USAGE_LABEL } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import ModalButton from "@/components/ModalButton";
import MarketValuationForm, { type MarketValuation } from "./MarketValuationForm";
import { batchPropertyValues, type ActionState } from "./actions";
import { planValueParts } from "./valueParts";
import { BatchSave, STICKY_BAR } from "@/components/BatchSave";

export type ValueRow = {
  id: string; name: string; typeLabel: string; /** ตัวกรองด้านบน */ type: string; usage: string; currency: string; value: number | null; date: string | null;
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
 *   กรอกมูลค่าใหม่เฉพาะแถวที่เปลี่ยน (ช่องว่าง = ไม่บันทึก) · วันที่เดียวทั้งชุด · ราคาตลาดของแต่ละแถวบันทึกแยก
 *   ด้านบน (2 พ.ย. 2026): ตัวกรองประเภท / การใช้งาน แทนช่องวิธี / หมายเหตุ → บันทึกเป็น "ประมาณเอง" (ราคาประเมิน / หมายเหตุ บันทึกที่หน้าทรัพย์สิน)
 *   ทรัพย์สินที่มีส่วนประกอบ (29 ต.ค. 2026): กด "รายแถว" กางที่ดิน / อาคารในตาราง · กรอกเฉพาะแถวที่เปลี่ยน (ว่าง = เท่าเดิม)
 *   กรอกยอดรวม (30 ต.ค. 2026 · กติกาเดียวกับหน้าทรัพย์สิน) → สิ่งปลูกสร้างเท่าเดิม / ตามที่พิมพ์ · ที่ดินได้ส่วนที่เหลือ แบ่งตามเนื้อที่ · เห็นรายแถวทันที
 */
type Plan = { total: number | null; parts: { deed_id: string; value: number }[] | null; est: Record<string, number>; error?: string };
export default function ValueBatch({ rows, today, minDate, canWrite, shareNote }: {
  rows: ValueRow[]; today: string; minDate: string; canWrite: boolean; shareNote: string | null;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [ty, setTy] = useState("");
  const [us, setUs] = useState("");
  const [nv, setNv] = useState<Record<string, string>>({});
  const [pv, setPv] = useState<Record<string, Record<string, string>>>({});   // asset → ส่วนประกอบ → มูลค่าใหม่
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await batchPropertyValues(prev, form);
    if (r.ok) { setNv({}); setPv({}); router.refresh(); }
    return r;
  }, {});

  // มูลค่าใหม่ของแต่ละทรัพย์สิน: ยอดรวม · รายแถว (ส่งเมื่อรู้ครบทุกแถว) · ตัวเลขประมาณรายแถวไว้แสดงสีเทา
  //   กติกาเดียวกับหน้าทรัพย์สิน: planValueParts (./valueParts.ts · เทสต์ scripts/value-parts.test.mjs)
  const planOf = (r: ValueRow): Plan => {
    const sub = pv[r.id] ?? {};
    const pl = planValueParts(r.parts.map((x) => ({ key: x.id, land: x.type === "LAND", area: x.area, last: x.value, typed: filled(sub[x.id]) ? n(sub[x.id]) : null })),
      filled(nv[r.id]) ? n(nv[r.id]) : null);
    return { total: pl.total, parts: pl.values ? r.parts.map((x) => ({ deed_id: x.id, value: pl.values![x.id] })) : null, est: pl.est, error: pl.error };
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
  const onSubmit = cf.guard(`บันทึกมูลค่าใหม่ ${chosen.length} รายการ ณ วันที่ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  // ยอดรวม (บาท · ตามสัดส่วนของสมาชิกที่เลือก) · ราคาตลาดรวมเฉพาะรายการที่ประเมินแล้ว
  //   ตามตัวกรองด้านบน · ตัวเลขที่กรอกไว้ในแถวที่ถูกกรองออกยังอยู่และบันทึกด้วย (หน้าต่างยืนยันแสดงชื่อทุกรายการ)
  const shown = rows.filter((r) => (!ty || r.type === ty) && (!us || r.usage === us));
  const hiddenChosen = chosen.filter((r) => !shown.includes(r)).length;
  const typeOpts = [...new Set(rows.map((r) => r.type))];
  const usageOpts = [...new Set(rows.map((r) => r.usage))];
  const nwTotal = shown.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);
  const valued = shown.filter((r) => r.market);
  const mkTotal = valued.reduce((t, r) => t + Number(r.market!.market_value) * r.factor, 0);
  const nwOfValued = valued.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);

  return (
    <>
    {cf.dialog}
    {/* ฟอร์มบันทึกครอบเฉพาะแถบบันทึกด้านบน ไม่ครอบตาราง (ตารางมีฟอร์มราคาตลาดใน pop up ของแต่ละแถว → ห้ามซ้อนฟอร์ม) */}
    <div className="space-y-3">
      <div className={`space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm ${STICKY_BAR}`}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">ประเภท
            <select value={ty} onChange={(e) => setTy(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>
              {typeOpts.map((k) => <option key={k} value={k}>{PROPERTY_TYPE_LABEL[k] ?? k}</option>)}
            </select></label>
          <label className="flex items-center gap-2">การใช้งาน
            <select value={us} onChange={(e) => setUs(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>
              {usageOpts.map((k) => <option key={k} value={k}>{USAGE_LABEL[k] ?? k}</option>)}
            </select></label>
          <BatchSave canWrite={canWrite} action={action} onSubmit={onSubmit} fields={{ date, valuation_method: "USER_ESTIMATE", rows: JSON.stringify(payload) }}
            count={chosen.length} pending={pending} disabled={incomplete.length > 0} onClear={() => { setNv({}); setPv({}); }} state={state}
            date={date} onDate={setDate} minDate={minDate} maxDate={today}
            note={<>{hiddenChosen > 0 && <span className="text-xs text-amber-700">รวม {hiddenChosen} รายการที่กรอกไว้แต่ถูกตัวกรองซ่อน</span>}
              {incomplete.length > 0 && <span className="text-sm text-amber-700">{incomplete.map((r) => `${r.name}: ${planOfRow(r).error}`).join(" · ")}</span>}</>}
            info={<>มูลค่าใหม่ = มูลค่าที่นับในความมั่งคั่งสุทธิ (กรอกเฉพาะรายการที่เปลี่ยน · ช่องว่าง = ไม่บันทึก) · ใส่ยอดรวม → สิ่งปลูกสร้างเท่าเดิม ที่ดินได้ส่วนที่เหลือตามเนื้อที่ (พิมพ์ทับรายแถวได้)
          · ราคาตลาดเป็นข้อมูลอ้างอิงเท่านั้น ไม่นับในความมั่งคั่งสุทธิ · กดที่ตัวเลข (หรือ &ldquo;ประเมิน&rdquo;) เพื่อบันทึก{shareNote && ` · ${shareNote}`}</>} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[12rem] px-3 py-2">ทรัพย์สิน</th>
              <th className="w-40 px-3 text-right">มูลค่าในความมั่งคั่งสุทธิ</th>
              <th className="w-40 px-3 text-right">มูลค่าใหม่</th>
              <th className="w-40 px-3 text-right">ราคาขั้นต่ำที่คุ้ม</th>
              <th className="w-40 px-3 text-right">ราคาตลาด (อ้างอิง)</th>
              <th className="w-40 px-3 text-right">ส่วนต่างจากความมั่งคั่งสุทธิ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{rows.length ? "ไม่มีทรัพย์สินตามตัวกรอง" : "ไม่มีทรัพย์สินที่ถืออยู่"}</td></tr>}
            {shown.map((r) => {
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
                      <ModalButton label="ประเมิน" title={`ประเมินราคาตลาด · ${r.name}`} size="lg" className={SMALL_BTN}>
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
          {shown.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr className="align-top">
                <td className="px-3 py-2">รวม (THB)</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(nwTotal, "THB", 0)}</td>
                <td></td>
                <td></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{valued.length ? money(mkTotal, "THB", 0) : "-"}
                  {valued.length < shown.length && <div className="text-xs font-normal text-amber-700">ยังไม่ประเมิน {shown.length - valued.length} รายการ</div>}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${mkTotal >= nwOfValued ? "text-emerald-700" : "text-red-700"}`}>
                  {valued.length ? diffText(mkTotal - nwOfValued, nwOfValued) : "-"}
                  {valued.length > 0 && valued.length < shown.length && <div className="text-xs font-normal text-slate-400">เทียบเฉพาะ {valued.length} รายการที่ประเมินแล้ว</div>}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

    </div>
    </>
  );
}

