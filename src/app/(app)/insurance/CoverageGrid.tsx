"use client";

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { toast } from "@/components/Modal";
import { saveCoverages, type ActionState } from "./actions";
import {
  COVERAGE_COUNT_UNIT, COVERAGE_FOR_TYPE, COVERAGE_GROUPS, COVERAGE_LABEL, COVERAGE_PERIOD, SMALL_BTN, SMALL_DEL_BTN, coverageHasPeriod, deathCoverage, thDate,
} from "@/lib/format";
import {
  addableCovTypes, blankCovRow, blankKey, covPayload, covRemoved, partText, patchCovRow, periodAllowed, rowsFromExisting, sortCovRows, visibleCovTypes,
  type CovExisting, type CovRow,
} from "@/lib/insurance-coverage";

const box = "rounded border border-slate-300 px-2 py-1 text-sm";
const cell = `w-full ${box}`;
const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const ORDER = COVERAGE_GROUPS.flatMap(([, ks]) => ks);
const GROUP_OF = new Map(COVERAGE_GROUPS.flatMap(([g, ks]) => ks.map((k) => [k, g] as const)));
export const covLabel = (t: string) => COVERAGE_LABEL[t]?.[0] ?? t;
const unitOf = (t: string) => COVERAGE_LABEL[t]?.[1] ?? "";
const PLACEHOLDER: Record<string, string> = {
  WAIVER: "เมื่อทุพพลภาพ / โรคร้ายแรง / ผู้ชำระเบี้ยเสียชีวิต · ยกเว้นส่วนไหน", ACCIDENT_DISMEMBER: "ตามตารางสัดส่วน (อ.บ.1 / อ.บ.2)",
};
/** ช่อง "คุ้มครองเฉพาะ" ของส่วนนั้น (ว่าง = ทั่วไป) · เฉพาะประกันสุขภาพ / อุบัติเหตุ */
export const SCOPE_HINT = "ว่าง = ทั่วไป · เช่น มะเร็ง";
export const hasScope = (insType: string) => insType === "HEALTH" || insType === "ACCIDENT";

/**
 * ตารางความคุ้มครองของกรมธรรม์ 1 ส่วน (ตกลง 7 พ.ย. 2026 · ปรับ 8 พ.ย. 2026)
 *   ปกติ = แถวที่มี + ปุ่มเพิ่มหัวข้อมาตรฐานของประเภทนั้นที่ยังไม่ได้ใส่ · all ("แสดงทุกหัวข้อ") = แถวว่างครบทุกหัวข้อ
 *   สูงสุด = จำนวน + รอบ (ต่อครั้ง / ต่อปี / ตลอดสัญญา · เฉพาะรอบที่ใช้กับหัวข้อนั้นได้ · ใส่จำนวนแล้วเลือกรอบที่พบบ่อยให้ก่อน) · "อื่น ๆ" มีช่องชื่อ · แถวเสียชีวิตที่ไม่ได้ใส่ = ใช้ทุนประกัน
 */
export function CoverageGrid({ insType, rows, setRows, sum, currency, all }: {
  insType: string; rows: CovRow[]; setRows: (r: CovRow[]) => void; sum: number; currency: string; all: boolean;
}) {
  const death = deathCoverage(insType);
  const patch = (type: string, key: string, p: Partial<CovRow>) => setRows(patchCovRow(rows, type, key, p));
  // แสดงทุกหัวข้อ: หัวข้อละแถว (แถวว่างเพิ่มเป็นแถวจริงตอนพิมพ์) · ปกติ: เฉพาะแถวที่มี
  const shown = all
    ? visibleCovTypes(ORDER, undefined, rows, true).flatMap((t) => {
      const list = rows.filter((r) => r.type === t);
      return list.length ? list : [blankCovRow(t, blankKey(t))];
    })
    : sortCovRows(ORDER, rows);
  const real = new Set(rows.map((r) => r.key));
  const groupOf = (t: string) => GROUP_OF.get(t) ?? "อื่น ๆ";
  // หัวกลุ่มเฉพาะกลุ่มที่มีหลายหัวข้อ (กลุ่มเดียวหัวข้อเดียว เช่น ชีวิต / ยกเว้นเบี้ย = ชื่อซ้ำ ไม่ต้องมีหัว)
  const shownTypes = [...new Set(shown.map((r) => r.type))];
  const groupSize = (g: string) => shownTypes.filter((x) => groupOf(x) === g).length;
  const add = all ? ["OTHER"] : addableCovTypes(ORDER, COVERAGE_FOR_TYPE[insType], rows);
  return (
    <div className="space-y-2">
      {shown.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ · กดหัวข้อด้านล่างเพื่อเพิ่ม (ไม่ใส่ = ไม่คุ้มครอง)</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="w-64 py-1">หัวข้อ</th><th className="w-44 px-1">วงเงิน ({currency})</th><th className="w-72 px-1">สูงสุด / รอบ</th>
                <th className="px-1">หมายเหตุ</th><th className="w-12"></th></tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const t = r.type;
                const prev = shown[i - 1];
                const head = (!prev || groupOf(prev.type) !== groupOf(t)) && groupSize(groupOf(t)) > 1 ? groupOf(t) : null;
                const first = !prev || prev.type !== t;
                const cntUnit = COVERAGE_COUNT_UNIT[t];
                return (
                  <Fragment key={r.key}>
                    {head && <tr><td colSpan={5} className="pb-1 pt-3 text-xs font-medium text-slate-500">{head}</td></tr>}
                    <tr className="align-top">
                      <td className="py-1 pr-2">
                        {t === "OTHER" ? (
                          <input value={r.label} onChange={(e) => patch(t, r.key, { label: e.target.value })} placeholder="ชื่อ เช่น ค่ารถพยาบาล" maxLength={200}
                            aria-label="ชื่อความคุ้มครอง (อื่น ๆ)" className={`${cell} placeholder:text-slate-400`} />
                        ) : first ? <span className="block py-1">{covLabel(t)}{unitOf(t) && <span className="text-xs text-slate-500"> {unitOf(t)}</span>}</span> : ""}
                      </td>
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
                        {coverageHasPeriod(t) && (
                          <span className="flex items-center gap-1">
                            {cntUnit && <><span className="whitespace-nowrap text-xs text-slate-500">สูงสุด</span>
                              <input value={r.count} onChange={(e) => patch(t, r.key, { count: e.target.value })} inputMode="numeric" aria-label="จำนวนสูงสุด"
                                className={`${box} w-16 shrink-0 text-right`} /><span className="whitespace-nowrap text-xs text-slate-500">{cntUnit}</span></>}
                            <select value={r.period} onChange={(e) => patch(t, r.key, { period: e.target.value })} aria-label="รอบ"
                              data-ph="" data-empty={r.period ? undefined : ""} className={`${box} w-36 shrink-0`}>
                              <option value="">เลือกรอบ</option>
                              {COVERAGE_PERIOD.filter(([v]) => periodAllowed(t, v, r.period)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-1"><input value={r.notes} onChange={(e) => patch(t, r.key, { notes: e.target.value })} placeholder={PLACEHOLDER[t] ?? ""}
                        className={`${cell} placeholder:text-slate-400`} /></td>
                      <td className="py-1 pl-1 text-right">
                        {real.has(r.key) && <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} className={SMALL_DEL_BTN}>ลบ</button>}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {add.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!all && <span className="text-xs text-slate-500">เพิ่มหัวข้อ:</span>}
          {add.map((t) => (
            <button key={t} type="button" onClick={() => setRows([...rows, blankCovRow(t)])} className={SMALL_BTN}>
              {all ? "+ เพิ่มบรรทัด (อื่น ๆ)" : `+ ${covLabel(t)}${unitOf(t) ? ` ${unitOf(t)}` : ""}`}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** ช่อง "ตรวจกับกรมธรรม์เมื่อ" (ใช้กับทุกส่วนที่บันทึกในครั้งนี้ · ว่าง = ยังไม่ได้ตรวจ) */
export function CheckedOnField({ value, onChange, today, note }: { value: string; onChange: (v: string) => void; today: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <label className="block text-sm text-slate-700">ตรวจกับกรมธรรม์เมื่อ
        <input type="date" name="coverage_checked_on" value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-44`} />
      </label>
      <button type="button" onClick={() => onChange(today)} className="pb-2 text-xs text-blue-700 hover:underline">วันนี้</button>
      <span className="pb-2 text-xs text-slate-500">ว่าง = ยังไม่ได้ตรวจ{note && ` · ${note}`}</span>
    </div>
  );
}

/** ส่วนของเล่มที่แก้ในหน้าต่างเดียว */
export type CovPart = {
  id: string; label: string | null; insType: string; sum: number; currency: string; existing: CovExisting[];
  scope: string | null; checked: string | null;
};

/**
 * ปุ่ม "แก้ความคุ้มครอง" หน้ากรมธรรม์: ทุกส่วนของเล่มในหน้าต่างเดียว · บันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย)
 *   ตรวจกับกรมธรรม์เมื่อ (บนสุด · ใช้กับทุกส่วนเมื่อแก้) · คุ้มครองเฉพาะ ต่อส่วน · แถวเดิมที่ล้างวงเงิน / กดลบ = ลบ (ถามยืนยันก่อน)
 */
export function CoverageEditor({ parts, today }: { parts: CovPart[]; today: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const init = () => Object.fromEntries(parts.map((p) => [p.id, rowsFromExisting(p.existing)]));
  const initScope = () => Object.fromEntries(parts.map((p) => [p.id, p.scope ?? ""]));
  const dates = [...new Set(parts.map((p) => p.checked ?? ""))];
  const initChecked = () => dates.filter(Boolean).sort().at(-1) ?? "";
  const [rows, setRows] = useState<Record<string, CovRow[]>>(init);
  const [scope, setScope] = useState<Record<string, string>>(initScope);
  const [checked, setChecked] = useState(initChecked);
  const [checkedDirty, setCheckedDirty] = useState(false);
  const [all, setAll] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCoverages, {});
  const cf = useConfirmSubmit();
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) { handled.current = state; toast(state.ok); setOpen(false); }
  }, [state, setOpen]);
  const any = parts.some((p) => p.existing.length > 0);
  const reset = () => { setRows(init()); setScope(initScope()); setChecked(initChecked()); setCheckedDirty(false); setAll(false); };
  const trigger = <button type="button" onClick={() => { if (!open) reset(); setOpen(!open); }}
    className={activeCls(any ? obtn : btn)}>{any ? "แก้ความคุ้มครอง" : "+ ใส่ความคุ้มครอง"}</button>;
  if (!open) return trigger;

  const per = parts.map((p) => ({ p, ...covPayload(rows[p.id] ?? [], covLabel) }));
  const errors = per.flatMap((x) => x.errors.map((e) => (parts.length > 1 && x.p.label ? `${x.p.label} · ${e}` : e)));
  const removed = per.reduce((t, x) => t + covRemoved(x.p.existing.map((c) => c.id), x.rows), 0);
  // ส่งเฉพาะข้อมูลต่อส่วนที่ตั้งได้ที่นี่ · วันตรวจส่งเมื่อแก้ (ไม่แก้ = แต่ละส่วนคงวันเดิม)
  const policies = per.map((x) => ({
    policy_id: x.p.id, ...(hasScope(x.p.insType) ? { coverage_scope: partText(scope[x.p.id] ?? "", 100) } : {}),
    ...(checkedDirty ? { coverage_checked_on: checked || null } : {}), rows: x.rows,
  }));
  return present(trigger, (
    <form action={action} onSubmit={cf.guard(`ลบความคุ้มครองเดิม ${removed} รายการ แล้วบันทึกตารางนี้?`, { danger: true }, removed > 0)}
      className="space-y-4 text-left">{cf.dialog}
      <div>
        <h3 className="font-medium text-slate-900">แก้ความคุ้มครอง{parts.length > 1 && " · ทั้งเล่ม"}</h3>
        <p className="text-xs text-slate-500">ใส่เฉพาะที่กรมธรรม์คุ้มครอง (ไม่ใส่ = ไม่คุ้มครอง) · แถวเสียชีวิตที่ไม่ได้ใส่ = ใช้ทุนประกันของกรมธรรม์
          · คุ้มครองเฉพาะ (เช่น มะเร็ง) = สรุปแยกไว้ ไม่บวกกับวงเงินทั่วไป · กดบันทึกครั้งเดียวทุกส่วน{" "}
          <button type="button" onClick={() => setAll(!all)} className="text-blue-700 hover:underline">{all ? "แสดงเฉพาะที่มี" : "แสดงทุกหัวข้อ"}</button></p>
      </div>
      <CheckedOnField value={checked} onChange={(v) => { setChecked(v); setCheckedDirty(true); }} today={today}
        note={parts.length > 1 ? (dates.length > 1 && !checkedDirty ? "แต่ละส่วนตรวจไม่พร้อมกัน · แก้วันที่ = ใช้กับทุกส่วน" : "ใช้กับทุกส่วนของเล่ม") : undefined} />
      <input type="hidden" name="policies" value={JSON.stringify(policies)} />
      {parts.map((p) => (
        <section key={p.id} className="space-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            {p.label ? <h4 className="text-sm font-medium text-slate-800">{p.label}</h4> : <span />}
            {hasScope(p.insType) && (
              <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">คุ้มครองเฉพาะ
                <input value={scope[p.id] ?? ""} onChange={(e) => setScope({ ...scope, [p.id]: e.target.value })} maxLength={100} placeholder={SCOPE_HINT}
                  className={`${cell} w-64 placeholder:text-slate-400`} />
              </label>
            )}
          </div>
          {parts.length > 1 && p.checked && dates.length > 1 && !checkedDirty && <p className="text-xs text-slate-500">ตรวจกับกรมธรรม์เมื่อ {thDate(p.checked)}</p>}
          <CoverageGrid insType={p.insType} rows={rows[p.id] ?? []} setRows={(r) => setRows({ ...rows, [p.id]: r })} sum={p.sum} currency={p.currency} all={all} />
        </section>
      ))}
      {errors.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || errors.length > 0} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกความคุ้มครอง"}</button>
        {removed > 0 && <span className="text-xs text-amber-700">จะลบรายการเดิม {removed} รายการ</span>}
      </div>
    </form>
  ));
}
