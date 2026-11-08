"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { receiveClaim, type ActionState } from "../actions";
import { ROW_BTN, money, numOrZero, thDate } from "@/lib/format";
import BankOptions from "@/components/BankOptions";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

type Bank = { asset_id: string; name: string; currency: string; frequent?: boolean | null };
type Person = { id: string; name: string };
/** ค่าใช้จ่ายที่ตั้ง "ได้เงินคืน" และยังรอเงินคืน (สกุลเดียวกับเคลม) */
export type PendingExpense = { id: string; date: string; description: string; remaining: number };
type Kind = "REIMB" | "INCOME" | "CLOSE";

/**
 * บันทึกรับเงินเคลม (ตกลง 8 พ.ย. 2026) · 3 แบบ
 *   REIMB  = เงินคืนของค่าใช้จ่ายที่จ่ายเองไปก่อน (ตั้ง "ได้เงินคืน" ไว้) → ลดค่าใช้จ่ายนั้น ไม่ใช่รายได้
 *   INCOME = เงินชดเชย / สินไหมที่ไม่ได้คืนค่าใช้จ่าย (เช่น ค่าชดเชยรายวัน) → รายได้ "ผลประโยชน์ประกัน" ผูกเคลม
 *   CLOSE  = ไม่ได้เงิน: ยังไม่เคยได้ = ถูกปฏิเสธ · ได้ไปบางส่วนแล้ว = ไม่ได้ส่วนที่เหลือ (ได้ไม่เต็ม)
 *   ได้น้อยกว่าที่รอรับ → เลือก "ยังรอรับส่วนที่เหลือ" หรือ "ได้ไม่เต็ม · ปิดเคลม"
 *   ได้มากกว่าที่รอรับ → ยืนยันก่อน แล้วยอดเคลมแก้เป็นยอดที่ได้รับรวมให้เอง (ในคำสั่งเดียวกับเงินที่รับ)
 */
export default function ClaimReceiveForm({ claimId, claimDate, currency, claimed, wait, banks, persons, expenses, today, minDate }: {
  claimId: string; claimDate: string | null; currency: string; claimed: number; wait: number;
  banks: Bank[]; persons: Person[]; expenses: PendingExpense[]; today: string; minDate: string | null;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [kind, setKind] = useState<Kind>(expenses.length ? "REIMB" : "INCOME");
  const [exp, setExp] = useState(expenses[0]?.id ?? "");
  const cap = (id: string) => Math.min(expenses.find((e) => e.id === id)?.remaining ?? wait, wait);
  const [amount, setAmount] = useState((expenses.length ? cap(expenses[0].id) : wait).toFixed(2));
  const [close, setClose] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveClaim, {});
  const cf = useConfirmSubmit();
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(ROW_BTN)}>บันทึกรับเงิน</button>;
  if (!open) return trigger;
  const sameBanks = banks.filter((b) => b.currency === currency);
  const got = Math.max(claimed - wait, 0);
  const amt = numOrZero(amount);
  const short = kind !== "CLOSE" && amt > 0 && amt < wait - 0.005;
  const over = kind !== "CLOSE" && amt > wait + 0.005;
  const pick = (k: Kind) => { setKind(k); if (k !== "CLOSE") setAmount((k === "REIMB" && exp ? cap(exp) : wait).toFixed(2)); };
  const ask = `ได้รับมากกว่ายอดเคลม\nยอดเคลมจะแก้จาก ${money(claimed, currency)} เป็น ${money(got + amt, currency)}\nบันทึกต่อไหม?`;
  return present(trigger, (
    <>
      <form action={action} onSubmit={cf.guard(ask, { okLabel: "แก้ยอดเคลมและบันทึก" }, over)}
        className="w-full space-y-3 text-left">
        <input type="hidden" name="claim_id" value={claimId} />
        <input type="hidden" name="kind" value={kind} />
        {short && close && <input type="hidden" name="close" value="1" />}
        {over && <input type="hidden" name="raise_claim" value="1" />}
        <div>
          <h3 className="font-medium text-slate-900">บันทึกรับเงินเคลม</h3>
          <p className="text-xs text-slate-500">{claimDate && `ยื่น ${thDate(claimDate)} · `}ยอดเคลม {money(claimed, currency)}{got > 0 && ` · ได้รับแล้ว ${money(got, currency)}`} · รอรับ {money(wait, currency)}</p>
        </div>
        <fieldset className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" checked={kind === "REIMB"} onChange={() => pick("REIMB")} disabled={!expenses.length} className="mt-1" />
            <span>เงินคืนค่าใช้จ่ายที่จ่ายเองไปก่อน
              <span className="block text-xs text-slate-500">{expenses.length ? "ลดค่าใช้จ่ายนั้น ไม่นับเป็นรายได้"
                : "ยังไม่มีค่าใช้จ่ายที่ตั้ง “ได้เงินคืน” ในสกุลนี้ — ตั้งที่ Income & Expenses (แก้ค่าใช้จ่าย → ติ๊กได้เงินคืน) ก่อน"}</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={kind === "INCOME"} onChange={() => pick("INCOME")} className="mt-1" />
            <span>เงินชดเชย / สินไหม (ไม่ได้คืนค่าใช้จ่าย)
              <span className="block text-xs text-slate-500">นับเป็นรายได้ &ldquo;ผลประโยชน์ประกัน&rdquo; เช่น ค่าชดเชยรายวัน · เงินก้อนเมื่อตรวจพบโรค</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={kind === "CLOSE"} onChange={() => pick("CLOSE")} className="mt-1" />
            <span>{got > 0 ? "ไม่ได้ส่วนที่เหลือ · ปิดเคลม" : "ถูกปฏิเสธ (ไม่ได้เงิน)"}
              <span className="block text-xs text-slate-500">{got > 0 ? `ได้รับแล้ว ${money(got, currency)} · สถานะเป็น “ได้ไม่เต็ม” ไม่รอรับอีก`
                : "สถานะเป็น “ปฏิเสธ” · ไม่ต้องใส่ยอด / บัญชี"}</span></span>
          </label>
        </fieldset>
        {kind === "CLOSE" ? (
          <label className="block text-sm">หมายเหตุ (เหตุผล)<input name="notes" maxLength={200} placeholder="เช่น ไม่อยู่ในความคุ้มครอง" className={input} /></label>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {kind === "REIMB" ? (
              <label className="text-sm md:col-span-2">ค่าใช้จ่ายที่จ่ายไปก่อน *
                <select name="expense_item_id" required value={exp} onChange={(e) => { setExp(e.target.value); setAmount(cap(e.target.value).toFixed(2)); }} className={input}>
                  {expenses.map((e) => <option key={e.id} value={e.id}>{thDate(e.date)} · {e.description} · รอคืน {money(e.remaining, currency)}</option>)}
                </select>
              </label>
            ) : (
              <label className="text-sm md:col-span-2">รายได้ของ
                <select name="person_id" defaultValue="" className={input}>
                  <option value="">ผู้เอาประกัน (ตามกรมธรรม์)</option>
                  {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            <label className="text-sm">ยอดที่ได้รับ ({currency}) *<input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} /></label>
            <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} max={today} min={minDate ?? undefined} className={input} /></label>
            {short && (
              <fieldset className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm md:col-span-2">
                <legend className="px-1 text-xs text-amber-800">ได้น้อยกว่าที่รอรับ · ส่วนที่เหลือ {money(wait - amt, currency)}</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <label className="flex items-center gap-2"><input type="radio" checked={!close} onChange={() => setClose(false)} />ยังรอรับส่วนที่เหลือ</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={close} onChange={() => setClose(true)} />ได้ไม่เต็ม · ปิดเคลม</label>
                </div>
              </fieldset>
            )}
            {over && (
              <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 md:col-span-2">
                ได้มากกว่าที่รอรับ {money(amt - wait, currency)} · ยอดเคลมจะแก้เป็น {money(got + amt, currency)} (ยืนยันอีกครั้งตอนบันทึก)
              </p>
            )}
            <label className="text-sm">เข้าบัญชี *<select name="bank_asset_id" required className={input}>
              {sameBanks.length ? <BankOptions banks={sameBanks} /> : <option value="">ไม่มีบัญชีสกุล {currency}</option>}</select></label>
            <label className="text-sm">หมายเหตุ<input name="notes" maxLength={200} className={input} /></label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || (kind === "REIMB" && !exp)} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </div>
      </form>
      {cf.dialog}
    </>
  ));
}
