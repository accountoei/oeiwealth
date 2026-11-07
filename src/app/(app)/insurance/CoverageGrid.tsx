"use client";

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { toast } from "@/components/Modal";
import { saveCoverages, type ActionState } from "./actions";
import { COVERAGE_COUNT_UNIT, COVERAGE_FOR_TYPE, COVERAGE_GROUPS, COVERAGE_LABEL, SMALL_BTN, deathCoverage } from "@/lib/format";
import {
  blankCovRow, blankKey, covPayload, covRemoved, patchCovRow, rowsFromExisting, visibleCovTypes, type CovExisting, type CovRow,
} from "@/lib/insurance-coverage";

const cell = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const ORDER = COVERAGE_GROUPS.flatMap(([, ks]) => ks);
const GROUP_OF = new Map(COVERAGE_GROUPS.flatMap(([g, ks]) => ks.map((k) => [k, g] as const)));
export const covLabel = (t: string) => COVERAGE_LABEL[t]?.[0] ?? t;
const PLACEHOLDER: Record<string, string> = {
  OTHER: "ชื่อความคุ้มครอง", WAIVER: "เมื่อทุพพลภาพ / โรคร้ายแรง / ผู้ชำระเบี้ยเสียชีวิต · ยกเว้นส่วนไหน",
  ACCIDENT_DISMEMBER: "ตามตารางสัดส่วน (อ.บ.1 / อ.บ.2)", DEDUCTIBLE: "ต่อปี / ต่อครั้ง",
};

/** หัวข้อที่แสดงของส่วนนั้น (ตามประเภทกรมธรรม์ · all = ทุกหัวข้อ) */
export const covTypesOf = (insType: string, rows: CovRow[], all: boolean) => visibleCovTypes(ORDER, COVERAGE_FOR_TYPE[insType], rows, all);

/**
 * ตารางความคุ้มครองมาตรฐานของกรมธรรม์ 1 ส่วน (ตกลง 7 พ.ย. 2026)
 *   หัวข้อตามประเภท · ช่องว่าง = ไม่คุ้มครอง · แถวเสียชีวิตว่าง = ใช้ทุนประกัน (แสดงจาง ไม่คัดลอกยอด)
 */
export function CoverageGrid({ insType, rows, setRows, sum, currency, all }: {
  insType: string; rows: CovRow[]; setRows: (r: CovRow[]) => void; sum: number; currency: string; all: boolean;
}) {
  const types = covTypesOf(insType, rows, all);
  const death = deathCoverage(insType);
  const patch = (type: string, key: string, p: Partial<CovRow>) => setRows(patchCovRow(rows, type, key, p));
  const groupOf = (t: string) => GROUP_OF.get(t) ?? "อื่น ๆ";
  // หัวกลุ่มเฉพาะกลุ่มที่มีหลายหัวข้อ (กลุ่มเดียวหัวข้อเดียว เช่น ชีวิต / ยกเว้นเบี้ย = ชื่อซ้ำ ไม่ต้องมีหัว)
  const groupSize = (g: string) => types.filter((x) => groupOf(x) === g).length;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="w-60 py-1">หัวข้อ</th><th className="w-44 px-1">วงเงิน ({currency})</th><th className="w-32 px-1">สูงสุด</th>
              <th className="w-40 px-1">ณ วันที่</th><th className="px-1">หมายเหตุ</th></tr>
          </thead>
          <tbody>
            {types.map((t, ti) => {
              const list = rows.filter((r) => r.type === t);
              const show = list.length ? list : [blankCovRow(t, blankKey(t))];
              const head = (ti === 0 || groupOf(types[ti - 1]) !== groupOf(t)) && groupSize(groupOf(t)) > 1 ? groupOf(t) : null;
              const unit = COVERAGE_LABEL[t]?.[1];
              const cntUnit = COVERAGE_COUNT_UNIT[t];
              return (
                <Fragment key={t}>
                  {head && <tr><td colSpan={5} className="pb-1 pt-3 text-xs font-medium text-slate-500">{head}</td></tr>}
                  {show.map((r, i) => (
                    <tr key={r.key} className="align-top">
                      <td className="py-1 pr-2">{i === 0 ? <>{covLabel(t)}{unit && <span className="text-xs text-slate-500"> {unit}</span>}</> : ""}</td>
                      <td className="px-1 py-1">
                        {t === "WAIVER" ? (
                          <label className="flex items-center gap-2 py-1"><input type="checkbox" checked={r.waiver} onChange={(e) => patch(t, r.key, { waiver: e.target.checked })} /> มีสิทธิ์</label>
                        ) : t === "COPAY" ? (
                          <span className="flex items-center gap-1"><input value={r.amount} onChange={(e) => patch(t, r.key, { amount: e.target.value })} name="copay_percent"
                            inputMode="decimal" data-money="off" className={`${cell} text-right`} />%</span>
                        ) : (
                          <input value={r.amount} onChange={(e) => patch(t, r.key, { amount: e.target.value })} inputMode="decimal"
                            placeholder={t === death && sum > 0 && !r.id ? `ตามทุน ${sum.toLocaleString("en-US")}` : ""} className={`${cell} text-right placeholder:text-slate-400`} />
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {cntUnit && <span className="flex items-center gap-1"><input value={r.count} onChange={(e) => patch(t, r.key, { count: e.target.value })} inputMode="numeric"
                          className={`${cell} w-16 text-right`} /><span className="whitespace-nowrap text-xs text-slate-500">{cntUnit}</span></span>}
                      </td>
                      <td className="px-1 py-1"><input type="date" value={r.asOf} onChange={(e) => patch(t, r.key, { asOf: e.target.value })} className={cell} /></td>
                      <td className="px-1 py-1"><input value={r.notes} onChange={(e) => patch(t, r.key, { notes: e.target.value })} placeholder={PLACEHOLDER[t] ?? ""}
                        className={`${cell} placeholder:text-slate-400`} /></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {types.includes("OTHER") && <button type="button" onClick={() => setRows([...rows, blankCovRow("OTHER")])} className={SMALL_BTN}>+ เพิ่มบรรทัด (อื่น ๆ)</button>}
    </div>
  );
}

/** ส่วนของเล่มที่แก้ในหน้าต่างเดียว */
export type CovPart = { id: string; label: string | null; insType: string; sum: number; currency: string; existing: CovExisting[] };

/**
 * ปุ่ม "แก้ความคุ้มครอง" หน้ากรมธรรม์: ทุกส่วนของเล่มในหน้าต่างเดียว · บันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย)
 *   แถวเดิมที่ล้างช่อง = ลบ (ถามยืนยันก่อน)
 */
export function CoverageEditor({ parts }: { parts: CovPart[] }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const init = () => Object.fromEntries(parts.map((p) => [p.id, rowsFromExisting(p.existing)]));
  const [rows, setRows] = useState<Record<string, CovRow[]>>(init);
  const [all, setAll] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCoverages, {});
  const cf = useConfirmSubmit();
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) { handled.current = state; toast(state.ok); setOpen(false); }
  }, [state, setOpen]);
  const any = parts.some((p) => p.existing.length > 0);
  const trigger = <button type="button" onClick={() => { if (!open) { setRows(init()); setAll(false); } setOpen(!open); }}
    className={activeCls(any ? obtn : btn)}>{any ? "แก้ความคุ้มครอง" : "+ ใส่ความคุ้มครอง"}</button>;
  if (!open) return trigger;

  const per = parts.map((p) => ({ p, ...covPayload(rows[p.id] ?? [], covTypesOf(p.insType, rows[p.id] ?? [], all), covLabel) }));
  const errors = per.flatMap((x) => x.errors.map((e) => (parts.length > 1 && x.p.label ? `${x.p.label} · ${e}` : e)));
  const removed = per.reduce((t, x) => t + covRemoved(x.p.existing.map((c) => c.id), x.rows), 0);
  const policies = per.map((x) => ({ policy_id: x.p.id, rows: x.rows }));
  return present(trigger, (
    <form action={action} onSubmit={cf.guard(`ลบความคุ้มครองเดิม ${removed} รายการที่ล้างช่องไว้ แล้วบันทึกตารางนี้?`, { danger: true }, removed > 0)}
      className="space-y-4 text-left">{cf.dialog}
      <div>
        <h3 className="font-medium text-slate-900">แก้ความคุ้มครอง{parts.length > 1 && " · ทั้งเล่ม"}</h3>
        <p className="text-xs text-slate-500">หัวข้อตามประเภทกรมธรรม์ · ช่องที่ว่าง = ไม่คุ้มครอง (ดูได้ที่แท็บความคุ้มครองของหน้า Insurance ว่าใครยังไม่มีสิทธิ์ไหน)
          · แถวเสียชีวิตที่เว้นว่าง = ใช้ทุนประกันของกรมธรรม์ · กดบันทึกครั้งเดียวทุกส่วน{" "}
          <button type="button" onClick={() => setAll(!all)} className="text-blue-700 hover:underline">{all ? "แสดงเฉพาะหัวข้อตามประเภท" : "แสดงทุกหัวข้อ"}</button></p>
      </div>
      <input type="hidden" name="policies" value={JSON.stringify(policies)} />
      {parts.map((p) => (
        <section key={p.id} className="space-y-1 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
          {p.label && <h4 className="text-sm font-medium text-slate-800">{p.label}</h4>}
          <CoverageGrid insType={p.insType} rows={rows[p.id] ?? []} setRows={(r) => setRows({ ...rows, [p.id]: r })} sum={p.sum} currency={p.currency} all={all} />
        </section>
      ))}
      {errors.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || errors.length > 0} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกความคุ้มครอง"}</button>
        {removed > 0 && <span className="text-xs text-amber-700">จะลบรายการเดิม {removed} รายการ (ล้างช่องไว้)</span>}
      </div>
    </form>
  ));
}
