"use client";

import { useActionState, useState } from "react";
import { addUnderlying, recordTx, saveFcn, type ActionState } from "../../../actions";
import { COUPON_FREQ_LABEL } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
type Bank = { asset_id: string; name: string; currency: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-sm text-red-600">{s.error}</span>;
  if (s.ok) return <span className="text-sm text-emerald-700">{s.ok}</span>;
  return null;
}

export type Fcn = {
  id: string; issuer: string; principal: number; trade_date: string | null; issue_date: string | null;
  coupon_rate: number | null; coupon_frequency: string | null; strike_level: number | null; barrier_level: number | null;
  autocall_level: number | null; observation_frequency: string | null; knock_in_occurred: boolean | null; knock_in_date: string | null;
};


export function FcnForm({ assetId, holdingId, fcn, defaultPrincipal }: { assetId: string; holdingId: string; fcn: Fcn | null; defaultPrincipal?: number | null }) {
  const [open, setOpen] = useState(!fcn);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFcn, {});
  const [knock, setKnock] = useState(!!fcn?.knock_in_occurred);
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-slate-600 underline">แก้รายละเอียด</button>;
  const v = (x: number | null | undefined) => (x == null ? "" : String(Number(x)));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="holding_id" value={holdingId} />
      {fcn && <input type="hidden" name="fcn_id" value={fcn.id} />}
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">ผู้ออก (Issuer) *<input name="issuer" required defaultValue={fcn?.issuer ?? ""} className={input} /></label>
        <label className="text-sm">เงินต้น *<input name="principal" required inputMode="decimal" defaultValue={v(fcn?.principal ?? defaultPrincipal)} className={input} /></label>
        <label className="text-sm">วันที่ซื้อ (Trade)<input name="trade_date" type="date" defaultValue={fcn?.trade_date ?? ""} className={input} /></label>
        <label className="text-sm">วันออก (Issue)<input name="issue_date" type="date" defaultValue={fcn?.issue_date ?? ""} className={input} /></label>
        <label className="text-sm">Coupon (% ต่อปี)<input name="coupon_rate" inputMode="decimal" defaultValue={v(fcn?.coupon_rate)} className={input} /></label>
        <label className="text-sm">จ่าย Coupon
          <select name="coupon_frequency" defaultValue={fcn?.coupon_frequency ?? "MONTHLY"} className={input}>
            <option value="">—</option>{Object.entries(COUPON_FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm">Strike (% ของราคาเริ่มต้น)<input name="strike_level" inputMode="decimal" defaultValue={v(fcn?.strike_level)} className={input} /></label>
        <label className="text-sm">Knock-in / Barrier (%)<input name="barrier_level" inputMode="decimal" defaultValue={v(fcn?.barrier_level)} className={input} /></label>
        <label className="text-sm">Autocall (%)<input name="autocall_level" inputMode="decimal" defaultValue={v(fcn?.autocall_level)} className={input} /></label>
        <label className="text-sm">รอบสังเกตราคา<input name="observation_frequency" placeholder="เช่น ทุกเดือน / ทุกวัน" defaultValue={fcn?.observation_frequency ?? ""} className={input} /></label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="knock_in_occurred" checked={knock} onChange={(e) => setKnock(e.target.checked)} /> เกิด Knock-in แล้ว</label>
        {knock && <label className="text-sm">วันที่ Knock-in<input name="knock_in_date" type="date" defaultValue={fcn?.knock_in_date ?? ""} className={input} /></label>}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกรายละเอียด"}</button>
        {fcn && <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>}
        <Msg s={state} />
      </div>
    </form>
  );
}

export function UnderlyingForm({ assetId, fcnId }: { assetId: string; fcnId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addUnderlying, {});
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-slate-600 underline">+ เพิ่มหุ้นอ้างอิง</button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="fcn_id" value={fcnId} />
      <label className="text-xs">สัญลักษณ์ *<input name="symbol" required className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ชื่อ<input name="name" className={`mt-1 block w-36 ${small}`} /></label>
      <label className="text-xs">ราคาเริ่มต้น<input name="initial_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ราคา Strike<input name="strike_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ราคา Barrier<input name="barrier_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">เพิ่ม</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      <Msg s={state} />
    </form>
  );
}

/** รับ Coupon / ดอกเบี้ย / ปันผล ของหลักทรัพย์นี้ */
export function IncomeForm({ assetId, holdingId, currency, isFcn, banks, today, minDate }: {
  assetId: string; holdingId: string; currency: string; isFcn: boolean; banks: Bank[]; today: string; minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("cash");
  const [state, action, pending] = useActionState<ActionState, FormData>(recordTx, {});
  const list = banks.filter((b) => b.currency === currency);
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>{isFcn ? "+ รับ Coupon" : "+ รับปันผล / ดอกเบี้ย"}</button>;
  return (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="holding_id" value={holdingId} />
      <h3 className="font-medium text-slate-900">{isFcn ? "รับ Coupon" : "รับปันผล / ดอกเบี้ย"}</h3>
      <div className="grid gap-3 md:grid-cols-4">
        {isFcn ? <input type="hidden" name="type" value="COUPON" /> : (
          <label className="text-sm">ประเภท
            <select name="type" defaultValue="DIVIDEND" className={input}><option value="DIVIDEND">ปันผล</option><option value="COUPON">Coupon / ดอกเบี้ยพันธบัตร</option></select>
          </label>
        )}
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ยอดก่อนหักภาษี ({currency}) *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm">ค่าธรรมเนียม<input name="fee" inputMode="decimal" className={input} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" name="settle_mode" value="cash" checked={mode === "cash"} onChange={() => setMode("cash")} /> เข้าเงินสดในพอร์ต</label>
        <label className="flex items-center gap-1"><input type="radio" name="settle_mode" value="bank" checked={mode === "bank"} onChange={() => setMode("bank")} /> เข้าบัญชีธนาคาร</label>
        {mode === "bank" && (
          <>
            <select name="bank_asset_id" required className={small}>
              <option value="">— บัญชี ({currency}) —</option>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
            <label className="text-xs">วันเงินเข้าจริง<input name="settlement_date" type="date" className={`ml-1 ${small}`} /></label>
          </>
        )}
      </div>
      <label className="block text-sm">หมายเหตุ<input name="notes" placeholder={isFcn ? "เช่น งวดที่ 3" : ""} className={input} /></label>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}
