"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { toast } from "@/components/Modal";
import { addRiders, type ActionState } from "./actions";
import { INS_TAX, INS_TYPE, INS_TYPE_EDITABLE, SMALL_BTN, SMALL_DEL_BTN, numOrZero } from "@/lib/format";
import { CoverageGrid, covLabel, covTypesOf } from "./CoverageGrid";
import { blankRider, riderPayload, type RiderRow } from "@/lib/insurance-coverage";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";
const RIDER_TYPES = INS_TYPE.filter(([v]) => INS_TYPE_EDITABLE.includes(v));

/** หัวข้อความคุ้มครองที่แสดงของสัญญาเพิ่มเติม */
export const riderCovTypes = (all: boolean) => (r: RiderRow) => covTypesOf(r.type, r.cov, all);

/**
 * สัญญาเพิ่มเติม (ตกลง 7 พ.ย. 2026): ประเภท · ทุน · เบี้ยต่อปี · วันสิ้นสุด · หมายเหตุ + ตารางความคุ้มครองของส่วนนั้น
 *   ที่เหลือ (บริษัท · เลขกรมธรรม์ · ผู้เอาประกัน · ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก · วันเริ่ม · สกุลเงิน) ใช้ของสัญญาหลัก
 */
export function RiderFields({ riders, setRiders, currency, all }: {
  riders: RiderRow[]; setRiders: (r: RiderRow[]) => void; currency: string; all: boolean;
}) {
  const patch = (key: string, p: Partial<RiderRow>) => setRiders(riders.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      {riders.map((r, i) => (
        <div key={r.key} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-slate-800">สัญญาเพิ่มเติม {i + 1}</h3>
            <button type="button" onClick={() => setRiders(riders.filter((x) => x.key !== r.key))} className={SMALL_DEL_BTN}>ลบ</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className={label}>ประเภท *
              <select value={r.type} onChange={(e) => patch(r.key, { type: e.target.value })} className={input}>
                {RIDER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">ภาษี: {INS_TAX[r.type]}</span>
            </label>
            <label className={label}>ทุนประกัน<input value={r.sum} onChange={(e) => patch(r.key, { sum: e.target.value })} inputMode="decimal" className={input} /></label>
            <label className={label}>เบี้ยประกัน (ต่อปี)<input value={r.premium} onChange={(e) => patch(r.key, { premium: e.target.value })} inputMode="decimal" className={input} /></label>
            <label className={label}>วันสิ้นสุด / ครบสัญญา<input type="date" value={r.end} onChange={(e) => patch(r.key, { end: e.target.value })} className={input} /></label>
            <label className={label}>หมายเหตุ<input value={r.notes} onChange={(e) => patch(r.key, { notes: e.target.value })} placeholder="เช่น ชื่อแบบสัญญา" className={`${input} placeholder:text-slate-400`} /></label>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-medium text-slate-500">ความคุ้มครองของส่วนนี้ (ถ้ามี)</h4>
            <CoverageGrid insType={r.type} rows={r.cov} setRows={(cov) => patch(r.key, { cov })} sum={numOrZero(r.sum)} currency={currency} all={all} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setRiders([...riders, blankRider()])} className={SMALL_BTN}>+ เพิ่มสัญญาเพิ่มเติม</button>
    </div>
  );
}

/**
 * ปุ่ม "+ เพิ่มสัญญาเพิ่มเติม" หน้าเล่ม: เพิ่มส่วนใหม่ในเล่มเดิม (บันทึกครั้งเดียว · ผิดส่วนเดียว = ไม่บันทึกเลย)
 *   เล่มเดียวกัน = บริษัท + เลขกรมธรรม์ → สัญญาหลักต้องมีเลขกรมธรรม์
 */
export function AddRiderButton({ mainId, policyNo, currency, className }: { mainId: string; policyNo: string | null; currency: string; className: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [riders, setRiders] = useState<RiderRow[]>(() => [blankRider()]);
  const [all, setAll] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addRiders, {});
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) { handled.current = state; toast(state.ok); setOpen(false); }
  }, [state, setOpen]);
  const trigger = <button type="button" onClick={() => { if (!open) { setRiders([blankRider()]); setAll(false); } setOpen(!open); }}
    className={activeCls(className)}>+ เพิ่มสัญญาเพิ่มเติม</button>;
  if (!open) return trigger;
  const out = riderPayload(riders, riderCovTypes(all), covLabel, policyNo);
  return present(trigger, (
    <form action={action} className="space-y-4 text-left">
      <div>
        <h3 className="font-medium text-slate-900">เพิ่มสัญญาเพิ่มเติม</h3>
        <p className="text-xs text-slate-500">ใช้บริษัท · เลขกรมธรรม์ · ผู้เอาประกัน · ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก · วันเริ่มคุ้มครอง ของสัญญาหลัก
          · ตั้งงวดเบี้ยของส่วนใหม่ได้ที่แท็บ &ldquo;เบี้ยและผลประโยชน์&rdquo; หลังบันทึก{(policyNo ?? "").trim() && <>{" "}
          <button type="button" onClick={() => setAll(!all)} className="text-blue-700 hover:underline">{all ? "แสดงเฉพาะหัวข้อตามประเภท" : "แสดงทุกหัวข้อ"}</button></>}</p>
      </div>
      {!(policyNo ?? "").trim() ? (
        <p className="text-sm text-amber-700">ใส่เลขกรมธรรม์ของสัญญาหลักก่อน (กด &ldquo;รายละเอียด&rdquo; → แก้ไข) · สัญญาเพิ่มเติมผูกกับเล่มด้วยบริษัท + เลขกรมธรรม์</p>
      ) : (
        <>
          <input type="hidden" name="main_id" value={mainId} />
          <input type="hidden" name="riders" value={JSON.stringify(out.rows)} />
          <RiderFields riders={riders} setRiders={setRiders} currency={currency} all={all} />
          {out.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">{out.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button disabled={pending || riders.length === 0 || out.errors.length > 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกสัญญาเพิ่มเติม${riders.length > 1 ? ` ${riders.length} ส่วน` : ""}`}</button>
        </>
      )}
    </form>
  ));
}
