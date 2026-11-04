"use client";

import { useActionState, useId, useState } from "react";
import { updatePaymentPair, type RecState } from "@/lib/records";
import { money, numOrZero, thDate } from "@/lib/format";
import Modal from "@/components/Modal";
import Flash from "@/components/Flash";
import UndoButton from "@/components/UndoButton";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm";

/**
 * แก้การรับ / จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) ด้วยปุ่มเดียว หน้าต่างเดียว (ตกลง 4 พ.ย. 2026)
 *   วันที่ช่องเดียวใช้กับทั้งเงินต้นและดอกเบี้ย · กดบันทึกครั้งเดียว (updatePaymentPair)
 *   ลบ = ลบทั้งก้อน (UndoButton PAYMENT) · อยู่ข้างปุ่มบันทึก เหมือนหน้าต่างแก้ไขอื่น
 *   บันทึก / ลบสำเร็จ → หน้าต่างปิดเอง + รีเฟรชหน้า (Modal)
 */
export default function PairEdit({ button, buttonClass, principal, interest, group, paths, canDelete, confirmText, direction, currency }: {
  /** ข้อความบนปุ่ม (เช่น "แก้ไข" หรือ "รับชำระ 5 ต.ค. · 20,000.00 ✎") */
  button: string;
  /** หน้าตาของปุ่ม · ไม่ใส่ = ปุ่มขอบเทา */
  buttonClass?: string;
  /** เงินต้น (cash_movements ที่ไม่ใช่รายการที่ระบบสร้าง) */
  principal: { id: string; date: string; amount: number };
  /** ดอกเบี้ย: รับ = income_transactions (มีภาษีหัก ณ ที่จ่าย) · จ่าย = expense_items */
  interest: { table: "income_transactions" | "expense_items"; id: string; date: string; amount: number; tax?: number | null };
  /** movement_group_id ของการรับ / จ่ายครั้งนี้ (ลบทั้งก้อน) */
  group: string;
  paths: string[];
  canDelete: boolean;
  confirmText: string;
  /** IN = รับเงินเข้าบัญชี · OUT = จ่ายออกจากบัญชี */
  direction: "IN" | "OUT";
  /** สกุลเงิน (แสดงเฉพาะที่ไม่ใช่ THB) */
  currency?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={buttonClass ?? "rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"}>{button}</button>
      {open && (
        <Modal title={direction === "IN" ? "แก้ไขการรับชำระ" : "แก้ไขการจ่ายชำระ"} onClose={() => setOpen(false)}>
          <PairForm principal={principal} interest={interest} group={group} paths={paths} canDelete={canDelete}
            confirmText={confirmText} direction={direction} currency={currency} />
        </Modal>
      )}
    </>
  );
}

function PairForm({ principal, interest, group, paths, canDelete, confirmText, direction, currency }: {
  principal: { id: string; date: string; amount: number };
  interest: { table: "income_transactions" | "expense_items"; id: string; date: string; amount: number; tax?: number | null };
  group: string; paths: string[]; canDelete: boolean; confirmText: string; direction: "IN" | "OUT"; currency?: string;
}) {
  const [state, action, saving] = useActionState<RecState, FormData>(updatePaymentPair, {});
  const formId = `pair-${useId()}`;
  const withTax = interest.table === "income_transactions";
  const [vals, setVals] = useState({ p: principal.amount, i: interest.amount, t: Number(interest.tax ?? 0) });
  const net = vals.p + vals.i - (withTax ? vals.t : 0);
  const ccy = currency && currency !== "THB" ? currency : undefined;
  return (
    <div className="space-y-3 text-left">
      <form id={formId} action={action} className="space-y-3"
        onInput={(e) => {
          const f = new FormData(e.currentTarget);
          setVals({ p: numOrZero(f.get("principal")), i: numOrZero(f.get("interest")), t: numOrZero(f.get("tax")) });
        }}>
        <input type="hidden" name="pid" value={principal.id} />
        <input type="hidden" name="iid" value={interest.id} />
        <input type="hidden" name="itable" value={interest.table} />
        <input type="hidden" name="paths" value={paths.join(",")} />
        <input type="hidden" name="o_pdate" value={principal.date} />
        <input type="hidden" name="o_principal" value={String(principal.amount)} />
        <input type="hidden" name="o_idate" value={interest.date} />
        <input type="hidden" name="o_interest" value={String(interest.amount)} />
        <input type="hidden" name="o_tax" value={String(interest.tax ?? 0)} />
        <div className={`grid gap-3 sm:grid-cols-2 ${withTax ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          <label className="text-sm text-slate-700">วันที่
            <input name="date" type="date" required defaultValue={principal.date} className={input} />
          </label>
          <label className="text-sm text-slate-700">เงินต้น
            <input name="principal" inputMode="decimal" required defaultValue={String(principal.amount)} className={`${input} text-right`} />
          </label>
          <label className="text-sm text-slate-700">ดอกเบี้ย
            <input name="interest" inputMode="decimal" required defaultValue={String(interest.amount)} className={`${input} text-right`} />
          </label>
          {withTax && (
            <label className="text-sm text-slate-700">ภาษีหัก ณ ที่จ่าย
              <input name="tax" inputMode="decimal" defaultValue={interest.tax ? String(interest.tax) : ""} className={`${input} text-right`} />
            </label>
          )}
        </div>
        <p className="text-sm text-slate-600">
          {direction === "IN" ? "เงินเข้าบัญชี" : "จ่ายออกจากบัญชีรวม"}{" "}
          <b className="tabular-nums text-slate-900">{money(net, ccy)}</b>
          <span className="text-xs text-slate-500"> (เงินต้น + ดอกเบี้ย{withTax ? " − ภาษี" : ""})</span>
        </p>
        {principal.date !== interest.date && (
          <p data-warn className="text-xs text-amber-700">
            วันที่เดิมของเงินต้น ({thDate(principal.date)}) กับดอกเบี้ย ({thDate(interest.date)}) ไม่ตรงกัน · กดบันทึกแล้วจะใช้วันที่ด้านบนทั้งคู่
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-start gap-3">
        <button form={formId} disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        {canDelete && <UndoButton kind="PAYMENT" id={group} paths={paths} label="ลบรายการนี้" size="md" confirmText={confirmText} />}
        {state.error && <span className="self-center text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="self-center text-sm text-emerald-700" />
      </div>
    </div>
  );
}
