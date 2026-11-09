"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteSlot } from "@/components/RowActions";
import { saveCashValue, type ActionState } from "../actions";
import Flash from "@/components/Flash";
import { money, numOrZero } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * มูลค่าเวนคืน 1 ยอด = ส่วนการันตี + โบนัส (ไม่การันตี · ตกลง 9 พ.ย. 2026)
 *   ใช้ทั้งเพิ่มยอดใหม่ (ลงยอดของปีกรมธรรม์ / ตามหนังสือแจ้ง) และแก้ยอดเดิม (id · ปุ่มลบอยู่ข้างปุ่มบันทึก)
 *   ทุกวันครบรอบปีกรมธรรม์ ระบบลงส่วนการันตีตามตารางให้เอง + ยกโบนัสล่าสุดมาบวก จนกว่าจะใส่ยอดใหม่จากหนังสือแจ้ง
 */
export default function CvValueForm({ id, assetId, currency, today, minDate, guaranteed, bonus, date, notes, withMethod = !id }: {
  id?: string; assetId: string; currency: string; today: string; minDate?: string;
  guaranteed?: number; bonus?: number | null; date?: string; notes?: string | null; withMethod?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCashValue, {});
  const router = useRouter();
  useEffect(() => { if (state.ok && id) router.refresh(); }, [state, id, router]);
  const [g, setG] = useState(guaranteed != null ? guaranteed.toFixed(2) : "");
  const [b, setB] = useState(bonus ? Number(bonus).toFixed(2) : "");
  const total = numOrZero(g) + numOrZero(b);
  return (
    <form action={action} className="space-y-3 text-left">
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">มูลค่าเวนคืนการันตี ({currency})
          <input name="guaranteed" required inputMode="decimal" value={g} onChange={(e) => setG(e.target.value)} className={`${input} text-right`} />
        </label>
        <label className="text-sm">โบนัส (ไม่การันตี)
          <input name="bonus" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="ไม่มี = เว้นว่าง" className={`${input} text-right`} />
        </label>
        <label className="text-sm">ณ วันที่
          <input name="valuation_date" type="date" required defaultValue={date ?? today} min={minDate || undefined} max={today} className={input} />
        </label>
        {withMethod ? (
          <label className="text-sm">ที่มา
            <select name="valuation_method" defaultValue="STATEMENT" className={input}>
              <option value="STATEMENT">ตามหนังสือแจ้งจากบริษัทประกัน</option>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
            </select>
          </label>
        ) : <div />}
        <label className="text-sm sm:col-span-2">หมายเหตุ
          <input name="notes" defaultValue={notes ?? ""} className={input} />
        </label>
      </div>
      <p className="text-sm text-slate-700">มูลค่าเวนคืนรวม (นับในความมั่งคั่งสุทธิ) <span className="font-medium tabular-nums">{money(total, currency)}</span></p>
      <p className="text-xs text-slate-500">ทุกวันครบรอบปีกรมธรรม์ ระบบลงยอดการันตีตามตารางให้เอง และยกโบนัสล่าสุดมาบวกไว้ จนกว่าจะใส่ยอดใหม่จากหนังสือแจ้ง</p>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {id && <DeleteSlot />}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
