"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { deleteEntity, updateRecord, type RecState } from "@/lib/records";
import { updatePortfolio, type ActionState } from "../actions";
import { PORTFOLIO_TYPE_LABEL } from "@/lib/format";
import OwnershipEditor from "@/components/OwnershipEditor";
import { CurrencySelect } from "@/components/CurrencyContext";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const lbl = "block text-sm text-slate-700";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

/* ------------------------------------------------------------------ แก้ไขพอร์ต (รายละเอียด + สัดส่วนเจ้าของ) */
export function PortfolioEditPanel({ assetId, name, institution, portfolioType, currency, notes, persons, owners, paths, today, canEditDetails }: {
  assetId: string; name: string; institution: string; portfolioType: string; currency: string; notes: string | null;
  persons: { id: string; name: string }[]; owners: { person_id: string; percent: number }[]; paths: string[]; today: string;
  canEditDetails: boolean;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [ccy, setCcy] = useState(currency);
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePortfolio, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("text-xs text-slate-700 underline")}>แก้ไขพอร์ต</button>;
  if (!open) return trigger;
  const ccyChanged = ccy !== currency;
  return present(trigger, (
    <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      {canEditDetails && (
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
      )}
      <div className="border-t border-slate-100 pt-3">
        <h3 className="text-sm font-medium text-slate-900">สัดส่วนเจ้าของ</h3>
        <OwnershipEditor kind="asset" id={assetId} persons={persons} paths={paths} today={today} current={owners} startOpen />
      </div>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
    </div>
  ));
}

/* ------------------------------------------------------------------ สถานะพอร์ต (+ ลบ เฉพาะ ADMIN) */
export function PortfolioStatusMenu({ assetId, name, status, paths, isAdmin }: {
  assetId: string; name: string; status: string; paths: string[]; isAdmin: boolean;
}) {
  const [st, stAction, stPending] = useActionState<RecState, FormData>(updateRecord, {});
  const [del, delAction, delPending] = useActionState<RecState, FormData>(deleteEntity, {});
  const [askDelete, setAskDelete] = useState(false);
  const [sel, setSel] = useState(status);
  const [typed, setTyped] = useState("");
  return (
    <div className="inline-flex flex-col">
      <form action={stAction} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
        <input type="hidden" name="table" value="assets" />
        <input type="hidden" name="id" value={assetId} />
        <input type="hidden" name="paths" value={paths.join(",")} />
        <span className="text-slate-500">สถานะพอร์ต</span>
        <select name="f_status" value={sel} disabled={stPending}
          onChange={(e) => {
            const v = e.target.value;
            setSel(v);
            if (v === "__delete") { setAskDelete(true); return; }
            setAskDelete(false);
            const f = e.currentTarget.form;
            setTimeout(() => f?.requestSubmit(), 0);
          }} className="bg-transparent text-sm">
          <option value="ACTIVE">ใช้งาน</option>
          <option value="CLOSED">ปิดพอร์ตแล้ว</option>
          {isAdmin && <option value="__delete">ลบพอร์ตนี้…</option>}
        </select>
        {st.error && <span className="text-xs text-red-600">{st.error}</span>}
        {st.ok && <span className="text-xs text-emerald-700">✓</span>}
      </form>
      {askDelete && isAdmin && (
        <form action={delAction} className="mt-2 max-w-md space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
          <input type="hidden" name="kind" value="asset" />
          <input type="hidden" name="id" value={assetId} />
          <input type="hidden" name="paths" value={[...paths, "/investments"].join(",")} />
          <input type="hidden" name="redirect" value="/investments" />
          <p className="font-medium text-red-800">ลบพอร์ต &ldquo;{name}&rdquo;</p>
          <ul className="list-disc pl-5 text-xs text-red-800">
            <li>ลบได้เฉพาะพอร์ตที่มีแค่ยอดตั้งต้น (ไม่มีซื้อ ขาย ปันผล หรือการโอน)</li>
            <li>พอร์ตที่เลิกใช้จริง ให้เลือก &ldquo;ปิดพอร์ตแล้ว&rdquo; แทน เพื่อเก็บประวัติ</li>
            <li>เป็นการลบแบบซ่อน · ผู้ดูแลระบบกู้คืนได้</li>
          </ul>
          <input name="reason" required placeholder="เหตุผลที่ลบ (บันทึกใน Audit Log)" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <label className="block text-xs text-red-800">พิมพ์ชื่อพอร์ตเพื่อยืนยัน
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <div className="flex items-center gap-2">
            <button disabled={delPending || typed.trim() !== name.trim()} className="rounded-md bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">
              {delPending ? "กำลังลบ…" : "ยืนยันลบพอร์ต"}
            </button>
            <button type="button" onClick={() => { setAskDelete(false); setTyped(""); setSel(status); }} className="text-xs text-slate-500">ยกเลิก</button>
          </div>
          {del.error && <p className="text-xs text-red-700">{del.error}</p>}
        </form>
      )}
    </div>
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
