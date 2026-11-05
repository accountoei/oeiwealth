"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteSlot } from "@/components/RowActions";
import { updateTransfer, type ActionState } from "../investments/actions";
import Flash from "@/components/Flash";
import { numOrZero } from "@/lib/format";

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/**
 * แก้การโอน ธนาคาร ↔ พอร์ต จากหน้า Income & Expenses / หน้าบัญชีธนาคาร (ตกลง 5 พ.ย. 2026)
 *   ช่องครบเหมือนหน้าพอร์ต: วันที่ · บัญชีเงินฝากในพอร์ต · เงินที่ออก · ค่าธรรมเนียมต้นทาง · ยอดที่เข้าจริง · ค่าธรรมเนียมปลายทาง · รายละเอียด
 *   ค่าธรรมเนียมเป็นส่วนหนึ่งของการโอน (ระบบลงเป็นค่าใช้จ่ายให้เอง) → แก้ค่าธรรมเนียมที่นี่
 */
export default function PfTransferEditor({ id, portfolioId, bankId, bankLabel, portfolioLabel, accounts, values, note }: {
  id: string; portfolioId: string; bankId: string; bankLabel: string; portfolioLabel: string;
  /** บัญชีเงินฝากในพอร์ตนี้ */
  accounts: { id: string; label: string; currency: string }[];
  values: { type: string; date: string; amount: number; currency: string; fee: number | null; counterAmount: number | null;
    counterCurrency: string | null; counterFee: number | null; cashHoldingId: string | null; description: string | null };
  /** ข้อความบนสุด (เช่น เปิดจากแถวค่าธรรมเนียม) */
  note?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTransfer, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  const isIn = values.type === "INVESTMENT_OUT";                 // ธนาคาร → พอร์ต
  const accts = isIn ? accounts : accounts.filter((a) => a.currency === values.currency);
  const [acct, setAcct] = useState(values.cashHoldingId ?? accts.find((a) => a.currency === (isIn ? values.counterCurrency ?? values.currency : values.currency))?.id ?? accts[0]?.id ?? "");
  const [amt, setAmt] = useState(String(Number(values.amount)));
  const [got, setGot] = useState(values.counterAmount != null ? String(Number(values.counterAmount))
    : values.counterCurrency == null ? String(Number(values.amount)) : "");
  const src = values.currency;
  const dst = (isIn ? accts.find((a) => a.id === acct)?.currency : values.counterCurrency ?? values.currency) ?? "";
  const rate = rateText(src, numOrZero(amt), dst, numOrZero(got));
  const f = (label: string, el: React.ReactNode, cls = "") => <label className={`text-xs text-slate-600 ${cls}`}>{label}{el}</label>;
  const cls = `mt-0.5 block w-full ${small}`;
  return (
    <form action={action} className="space-y-3 text-left">
      <input type="hidden" name="asset_id" value={portfolioId} />
      <input type="hidden" name="movement_id" value={id} />
      <input type="hidden" name="bank_asset_id" value={bankId} />
      {note && <p className="text-xs text-slate-600">{note}</p>}
      <p className="text-xs text-slate-500">{isIn ? `${bankLabel} → ${portfolioLabel}` : `${portfolioLabel} → ${bankLabel}`} · เว้นยอดที่เข้าว่าง = ยังรอยอด</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {f("วันที่โอน", <input name="date" type="date" required defaultValue={values.date} className={cls} />)}
        {f("บัญชีเงินฝากในพอร์ต", (
          <select name="cash_holding_id" value={acct} onChange={(e) => setAcct(e.target.value)} className={cls}>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
          </select>
        ))}
        {f(`เงินที่ออก (${src})`, <input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={`${cls} text-right`} />)}
        {f(`ค่าธรรมเนียมต้นทาง (${src})`, <input name="fee" inputMode="decimal" defaultValue={values.fee != null ? String(Number(values.fee)) : ""} className={`${cls} text-right`} />)}
        {f(`ยอดที่เข้าจริง (${dst})`, <input name="counter_amount" inputMode="decimal" value={got} onChange={(e) => setGot(e.target.value)} className={`${cls} text-right`} />)}
        {f(`ค่าธรรมเนียมปลายทาง (${dst})`, <input name="counter_fee" inputMode="decimal" defaultValue={values.counterFee != null ? String(Number(values.counterFee)) : ""} className={`${cls} text-right`} />)}
        {f("รายละเอียด", <input name="description" defaultValue={values.description ?? ""} className={cls} />, "sm:col-span-2")}
      </div>
      {rate && <p className="text-xs text-slate-700">{rate}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <DeleteSlot />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}

function rateText(src: string, srcAmt: number, dst: string, dstAmt: number) {
  if (!(srcAmt > 0 && dstAmt > 0) || !dst || src === dst) return null;
  if (src === "THB") return `อัตราที่ได้จริง 1 ${dst} = ${(srcAmt / dstAmt).toFixed(4)} บาท`;
  if (dst === "THB") return `อัตราที่ได้จริง 1 ${src} = ${(dstAmt / srcAmt).toFixed(4)} บาท`;
  return `อัตราที่ได้จริง 1 ${src} = ${(dstAmt / srcAmt).toFixed(6)} ${dst}`;
}
