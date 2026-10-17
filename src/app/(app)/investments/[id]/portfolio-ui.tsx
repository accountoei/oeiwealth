"use client";

import { useActionState, useState } from "react";
import { updateRecord, type RecState } from "@/lib/records";
import { updatePortfolio, type ActionState } from "../actions";
import { PORTFOLIO_TYPE_LABEL } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const lbl = "block text-sm text-slate-700";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

/* ------------------------------------------------------------------ แก้ไขรายละเอียดพอร์ต (ใช้ใน pop up "แก้ไขข้อมูล") */
export function PortfolioInfoForm({ assetId, name, institution, portfolioType, currency, notes }: {
  assetId: string; name: string; institution: string; portfolioType: string; currency: string; notes: string | null;
}) {
  const [ccy, setCcy] = useState(currency);
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePortfolio, {});
  const ccyChanged = ccy !== currency;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className={lbl}>ชื่อพอร์ต *<input name="name" required defaultValue={name} className={input} /></label>
        <label className={lbl}>สถาบัน<input name="institution" defaultValue={institution} className={input} /></label>
        <label className={lbl}>ประเภท
          <select name="portfolio_type" defaultValue={portfolioType} className={input}>
            {Object.entries(PORTFOLIO_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={lbl}>สกุลพอร์ต
          <CurrencySelect name="currency" value={ccy} onChange={(v) => { setCcy(v); setConfirm(false); }} className={input} include={currency} />
        </label>
        <label className={`${lbl} md:col-span-2`}>หมายเหตุ<input name="notes" defaultValue={notes ?? ""} className={input} /></label>
      </div>
      {ccyChanged && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">เปลี่ยนสกุลพอร์ต {currency} → {ccy}</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            <li>การโอนเงิน ธนาคาร ↔ พอร์ต ต้องใช้บัญชีธนาคารสกุล {ccy} หลังเปลี่ยน</li>
            <li>มูลค่าพอร์ตจะแสดงเป็น {ccy} · ยอดเงินฝาก / หลักทรัพย์แต่ละตัวยังเป็นสกุลเดิม</li>
            <li>Net Worth (บาท) ไม่เปลี่ยน</li>
          </ul>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm_currency" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            ยืนยันเปลี่ยนสกุลพอร์ตเป็น {ccy}
          </label>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending || (ccyChanged && !confirm)} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกรายละเอียดพอร์ต"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ กดชื่อบัญชีเงินฝาก → แก้ไข */
export function CashNameEdit({ id, name, purpose, interestRate, paths, canEdit, children }: {
  id: string; name: string; purpose: string | null; interestRate: number | null; paths: string[]; canEdit: boolean; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  if (!canEdit) return <span className="font-medium text-slate-900">{name}{children}</span>;
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="text-left font-medium text-slate-900 hover:underline" title="กดเพื่อแก้ไข">
      {name}{children}
    </button>
  );
  return (
    <form action={action} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <input type="hidden" name="table" value="investment_holdings" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs text-slate-600">ชื่อบัญชี<input name="f_name" required defaultValue={name} className={input} /></label>
        <label className="text-xs text-slate-600">วัตถุประสงค์<input name="f_purpose" defaultValue={purpose ?? ""} className={input} /></label>
        <label className="text-xs text-slate-600">ดอกเบี้ย % ต่อปี<input name="f_interest_rate" inputMode="decimal" defaultValue={interestRate ?? ""} className={input} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald-700">บันทึกแล้ว</span>}
      </div>
    </form>
  );
}
