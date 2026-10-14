"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { confirmRecon, finalizeMonth, prepareRecon, reopenMonth, settleRecon, type ActionState } from "./actions";
import { money } from "@/lib/format";

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const sbtn = "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50";
const btn = "rounded-md bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function PrepareButton({ assetId, month, label }: { assetId: string; month: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(prepareRecon, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="month" value={month} />
      <button disabled={pending} className="text-xs text-slate-800 underline disabled:opacity-50">{pending ? "กำลังคำนวณ…" : label}</button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function ConfirmReconForm({ id, calculated, currency, canConfirm }:
  { id: string; calculated: number; currency: string; canConfirm: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(confirmRecon, {});
  const [ls, lumpAction, lumping] = useActionState<ActionState, FormData>(settleRecon, {});
  const [actual, setActual] = useState("");
  const [rounding, setRounding] = useState(0);
  const a = Number(actual.replace(/,/g, ""));
  const has = actual.trim() !== "" && !Number.isNaN(a);
  const diff = has ? Math.round((a - (calculated + rounding)) * 10000) / 10000 : null;
  const rawDiff = has ? Math.round((a - calculated) * 10000) / 10000 : null;
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rounding" value={String(rounding)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">ยอดจริง ณ สิ้นเดือน ({currency})
          <input name="actual_closing" required inputMode="decimal" value={actual}
            onChange={(e) => { setActual(e.target.value); setRounding(0); }} className={`mt-1 block w-40 ${small}`} />
        </label>
        {diff !== null && (
          <div className="text-sm">
            ผลต่าง <b className={diff === 0 ? "text-emerald-700" : "text-red-700"}>{money(diff, currency)}</b>
            {rounding !== 0 && <span className="text-xs text-slate-500"> (ปัดเศษ {money(rounding)})</span>}
          </div>
        )}
        {rawDiff !== null && rawDiff !== 0 && Math.abs(rawDiff) <= 1 && rounding === 0 && (
          <button type="button" onClick={() => setRounding(rawDiff)} className="text-xs text-slate-700 underline">
            ปรับเป็นผลต่างจากการปัดเศษ
          </button>
        )}
      </div>
      {diff !== null && diff !== 0 && (
        <div className="space-y-1 text-xs">
          <p className="text-amber-800">
            {diff < 0 ? "เงินหายไป" : "เงินเกินมา"} {money(Math.abs(diff), currency)} — เลือกได้ 3 ทาง: เพิ่มรายการที่ขาดที่หน้า Income &amp; Expenses
            แล้วกลับมากระทบยอดใหม่ · ลงเป็นก้อนรอแยกรายละเอียด · หรือยืนยันพร้อมผลต่าง
          </p>
          {canConfirm && (
            <button formAction={lumpAction} formNoValidate disabled={lumping || pending}
              className="rounded-md border border-blue-600 bg-white px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              {lumping ? "กำลังบันทึก…" : diff < 0 ? `ลงเป็นค่าใช้จ่ายก้อนเดียว ${money(-diff, currency)} (รอแยกรายละเอียด) และยืนยันยอด`
                : `ลงเป็นรายได้ก้อนเดียว ${money(diff, currency)} (รอแยกรายละเอียด) และยืนยันยอด`}
            </button>
          )}
          <label className="block">หรือยืนยันพร้อมผลต่าง — เหตุผล (จำเป็น)
            <input name="reason" required className={`mt-1 block w-full ${small}`} />
          </label>
        </div>
      )}
      {canConfirm ? (
        <button disabled={pending || !has} className={sbtn}>{pending ? "กำลังยืนยัน…" : "ยืนยันยอด"}</button>
      ) : <p className="text-xs text-slate-500">ยืนยันได้หลังสิ้นเดือน · เฉพาะผู้ดูแลระบบ / ผู้แก้ไข</p>}
      <Msg s={state} /><Msg s={ls} />
    </form>
  );
}

export function FinalizeForm({ month, warnings }: { month: string; warnings: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(finalizeMonth, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>ตรวจตัวเลขแล้ว{warnings > 0 ? ` และยอมรับคำเตือน ${warnings} รายการ (จะถูกบันทึกไว้กับงวดนี้)` : ""} · หลังปิดเดือนจะแก้รายการในเดือนนี้ไม่ได้จนกว่าจะ Reopen</span>
      </label>
      <button disabled={pending} className={btn}>{pending ? "กำลังปิดเดือน…" : "ยืนยันปิดเดือน (Finalize)"}</button>
      <Msg s={state} />
    </form>
  );
}

export function ReopenForm({ month }: { month: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(reopenMonth, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls("text-sm text-red-700 underline")}>Reopen เดือนนี้</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <input type="hidden" name="month" value={month} />
      <p className="text-xs text-red-800">เปิดเดือนกลับเป็น DRAFT เพื่อแก้ไข แล้วต้องปิดเดือนใหม่ (เลขเวอร์ชันเพิ่ม) · บันทึกใน Audit Log</p>
      <input name="reason" required placeholder="เหตุผล เช่น ลืมบันทึกค่าใช้จ่าย" className={`w-full ${small}`} />
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">ยืนยัน Reopen</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      <Msg s={state} />
    </form>
  ));
}

/** ยืนยันพร้อมผลต่างไปแล้ว → เปลี่ยนเป็นก้อนรอแยกรายละเอียด */
export function SettleLaterButton({ id, diff, currency }: { id: string; diff: number; currency: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(settleRecon, {});
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs text-blue-700 underline disabled:opacity-50">
        {pending ? "กำลังบันทึก…" : `ลงผลต่าง ${money(Math.abs(diff), currency)} เป็น${diff < 0 ? "ค่าใช้จ่าย" : "รายได้"}ก้อน (รอแยกรายละเอียด)`}
      </button>
      <Msg s={state} />
    </form>
  );
}
