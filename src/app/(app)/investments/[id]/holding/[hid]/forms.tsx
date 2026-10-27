"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addUnderlying, recordMaturity, recordTx, restateUnits, saveFcn, type ActionState } from "../../../actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { updateRecord, type RecState } from "@/lib/records";
import { COUPON_FREQ_LABEL, ROW_BTN, money, thDate } from "@/lib/format";
import { COUPON_FREQ_OPTIONS } from "@/lib/coupon-schedule";
import SecNavPicker from "@/components/SecNavPicker";
import { SettleModeRadios } from "@/components/SettleMode";
import { CashAccountSelect, type CashAcct } from "../../forms";
import { defaultIncomeAccount, incomeAccountOptions } from "@/lib/income-account";

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
  const { open, setOpen, present, activeCls } = useActionSlot(!fcn);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFcn, {});
  const [knock, setKnock] = useState(!!fcn?.knock_in_occurred);
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls("text-sm text-slate-600 underline")}>แก้รายละเอียด</button>;
  if (!open) return trigger;
  const v = (x: number | null | undefined) => (x == null ? "" : String(Number(x)));
  return present(trigger, (
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
        {fcn && <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>}
        <Msg s={state} />
      </div>
    </form>
  ));
}

export function UnderlyingForm({ assetId, fcnId }: { assetId: string; fcnId: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(addUnderlying, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls("text-sm text-slate-600 underline")}>+ เพิ่มหุ้นอ้างอิง</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="fcn_id" value={fcnId} />
      <label className="text-xs">สัญลักษณ์ *<input name="symbol" required className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ชื่อ<input name="name" className={`mt-1 block w-36 ${small}`} /></label>
      <label className="text-xs">ราคาเริ่มต้น<input name="initial_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ราคา Strike<input name="strike_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <label className="text-xs">ราคา Barrier<input name="barrier_price" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">เพิ่ม</button>
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      <Msg s={state} />
    </form>
  ));
}

/** รับ Coupon / ดอกเบี้ย / ปันผล ของหลักทรัพย์นี้ · ประเภท "คืนเงินต้น" = บันทึกครบกำหนด / Autocall (หลักทรัพย์ปิด) */
export function IncomeForm({ assetId, portfolioName = "", holdingId, holdingName = "", currency, isFcn, canMature = false, banks, cashAccounts, today, minDate, label, title, defaultAmount, defaultDate, defaultNotes, incomeAccount }: {
  assetId: string; portfolioName?: string; holdingId: string; holdingName?: string; currency: string; isFcn: boolean;
  /** หุ้นกู้ / FCN / Structured / อื่น ๆ ที่ยังถืออยู่ → มีประเภท "คืนเงินต้น" */ canMature?: boolean;
  banks: Bank[]; cashAccounts: CashAcct[]; today: string; minDate: string;
  /** ใช้จากแท็บ "รอรับเดือนนี้": ชื่อปุ่ม / หัวฟอร์ม · ยอดที่คาดว่าจะได้รับ · หมายเหตุงวด (ประเภท = Coupon / ดอกเบี้ย) */
  label?: string; title?: string; defaultAmount?: number | null; defaultNotes?: string;
  /** วันที่ตั้งต้น (แท็บรอรับ: วันรับตามตาราง · แก้ได้) */ defaultDate?: string;
  /** บัญชีรับเงินที่ผูกไว้กับหลักทรัพย์ ("h:<id>" / "a:<id>") → ค่าตั้งต้นของการรับครั้งนี้ (เปลี่ยนได้ ไม่แก้ค่าที่ผูก) */
  incomeAccount?: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [mode, setMode] = useState(incomeAccount?.startsWith("a:") ? "bank" : "cash");
  const [txState, txAction, txPending] = useActionState<ActionState, FormData>(recordTx, {});
  const [matState, matAction, matPending] = useActionState<ActionState, FormData>(recordMaturity, {});
  const [type, setType] = useState(isFcn ? "COUPON" : "DIVIDEND");
  const cf = useConfirmSubmit();
  const mat = type === "MATURITY";
  const [state, action, pending] = mat ? [matState, matAction, matPending] : [txState, txAction, txPending];
  const list = banks.filter((b) => b.currency === currency);
  const trigger = <button onClick={() => setOpen(!open)} className={label ? ROW_BTN : activeCls(obtn)}>{label ?? (isFcn ? "+ รับ Coupon" : "+ รับปันผล / ดอกเบี้ย")}</button>;
  if (!open) return trigger;
  const types: [string, string][] = [...(isFcn ? [] : [["DIVIDEND", "ปันผล"]] as [string, string][]),
    ["COUPON", isFcn ? "Coupon" : "Coupon / ดอกเบี้ยพันธบัตร"], ...(canMature ? [["MATURITY", "คืนเงินต้น (ครบกำหนด / Autocall)"]] as [string, string][] : [])];
  return present(trigger, (
    <form action={action} onSubmit={mat ? cf.guard(`บันทึกรับเงินต้นของ ${holdingName || "หลักทรัพย์นี้"}? หลักทรัพย์นี้จะปิดเป็น "ครบกำหนด"`) : undefined}
      className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">{cf.dialog}
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="holding_id" value={holdingId} />
      <h3 className="font-medium text-slate-900">{title ?? (isFcn ? "รับ Coupon" : "รับปันผล / ดอกเบี้ย")}</h3>
      <div className="grid gap-3 md:grid-cols-4">
        {label || types.length < 2 ? <input type="hidden" name="type" value="COUPON" /> : (
          <label className="text-sm">ประเภท
            <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
              {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">{mat ? "วันที่รับเงิน *" : "วันที่ *"}<input name="date" type="date" required defaultValue={defaultDate ?? today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">{mat ? "เงินต้นที่ได้คืน" : "ยอดก่อนหักภาษี"} ({currency}) *<input name="amount" required inputMode="decimal"
          defaultValue={defaultAmount != null ? String(defaultAmount) : undefined} className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm">ค่าธรรมเนียม<input name="fee" inputMode="decimal" className={input} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SettleModeRadios mode={mode} setMode={setMode} portfolioName={portfolioName} className="flex flex-wrap items-center gap-3" />
        {mode === "cash" && <CashAccountSelect accounts={cashAccounts} currency={currency} label="บัญชี" compact
          defaultId={incomeAccount?.startsWith("h:") ? incomeAccount.slice(2) : null} />}
        {mode === "bank" && (
          <>
            <select name="bank_asset_id" required defaultValue={incomeAccount?.startsWith("a:") ? incomeAccount.slice(2) : ""} className={small}>
              <option value="">— บัญชี ({currency}) —</option>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
            {!mat && <label className="text-xs">วันเงินเข้าจริง<input name="settlement_date" type="date" className={`ml-1 ${small}`} /></label>}
          </>
        )}
      </div>
      {mat && <p className="text-xs text-slate-500">ใส่วันที่เงินเข้าบัญชีจริง · บันทึกแล้วหลักทรัพย์นี้ปิดเป็น &ldquo;ครบกำหนด&rdquo; (ลบรายการได้ที่ตารางรายการของพอร์ต ถ้างวดยังไม่ปิด) · เงินต้นไม่ใช่รายได้ · ดอกเบี้ย / Coupon งวดสุดท้ายบันทึกแยกอีกรายการ</p>}
      <label className="block text-sm">หมายเหตุ<input name="notes" defaultValue={defaultNotes} placeholder={isFcn ? "เช่น งวดที่ 3" : ""} className={input} /></label>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : mat ? "บันทึกรับเงินต้น" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/** แก้ไขข้อมูลหลักทรัพย์ (ใช้ใน pop up "แก้ไขข้อมูล") */
export function HoldingInfoForm({ id, paths, v, autoKind, autoBlocked, coupon, income }: {
  id: string; paths: string[]; v: { name: string; symbol: string | null; maturity_date: string | null; notes: string | null; auto_price?: boolean; price_ref?: string | null };
  /** หุ้นกู้ / อื่น ๆ: ข้อมูลตารางรับดอกเบี้ย (เงินต้น · อัตรา · ความถี่) — FCN / Structured ใช้ "แก้รายละเอียด" ของ FCN */
  coupon?: { face_value: number | null; interest_rate: number | null; coupon_frequency: string | null; currency: string } | null;
  /** EQUITY / FUND = ดึงราคาอัตโนมัติได้ */
  autoKind?: "EQUITY" | "FUND" | null;
  /** เหตุผลที่ยังเปิดราคาอัตโนมัติไม่ได้ (มูลค่าก้อนเดียว / กองทุน 1 หน่วย) — ฐานข้อมูลกันซ้ำ */
  autoBlocked?: string | null;
  /** บัญชีรับดอกเบี้ย / ปันผล / เงินคืน (ค่าตั้งต้นของฟอร์มรับเงิน · แท็บรอรับเดือนนี้) */
  income?: { currency: string; cashAccounts: CashAcct[]; banks: Bank[]; cashId: string | null; bankId: string | null };
}) {
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  const [auto, setAuto] = useState(!!v.auto_price);
  const incomeOpts = income ? incomeAccountOptions(income.cashAccounts, income.banks, income.currency) : [];
  const [inc, setInc] = useState(income ? defaultIncomeAccount(incomeOpts, income.cashId, income.bankId) : "");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="table" value="investment_holdings" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm text-slate-700 md:col-span-2">ชื่อ *<input name="f_name" required defaultValue={v.name} className={input} /></label>
        <label className="block text-sm text-slate-700">สัญลักษณ์ / รหัส<input name="f_symbol" defaultValue={v.symbol ?? ""} className={input} /></label>
        <label className="block text-sm text-slate-700">วันครบกำหนด<input type="date" name="f_maturity_date" defaultValue={v.maturity_date ?? ""} className={input} /></label>
        <label className="block text-sm text-slate-700 md:col-span-2">หมายเหตุ<input name="f_notes" defaultValue={v.notes ?? ""} className={input} /></label>
        {incomeOpts.length > 0 && (
          <label className="block text-sm text-slate-700 md:col-span-3">รับดอกเบี้ย / ปันผล / เงินคืน เข้าบัญชี
            <input type="hidden" name="f_income_cash_holding_id" value={inc.startsWith("h:") ? inc.slice(2) : ""} />
            <input type="hidden" name="f_income_bank_asset_id" value={inc.startsWith("a:") ? inc.slice(2) : ""} />
            <select value={inc} onChange={(e) => setInc(e.target.value)} className={input}>
              {incomeOpts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">ค่าตั้งต้นของปุ่มรับปันผล / ดอกเบี้ย และแท็บ &ldquo;รอรับเดือนนี้&rdquo; (เปลี่ยนตอนรับได้ เฉพาะครั้งนั้น)</span>
          </label>
        )}
      </div>
      {coupon && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="text-sm font-medium text-slate-800">ดอกเบี้ย / ตารางรับ</div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm text-slate-700">เงินต้น / มูลค่าหน้าตั๋ว ({coupon.currency})
              <input name="f_face_value" inputMode="decimal" defaultValue={coupon.face_value != null ? String(Number(coupon.face_value)) : ""} className={input} /></label>
            <label className="block text-sm text-slate-700">อัตราผลตอบแทน (% ต่อปี)
              <input name="f_interest_rate" inputMode="decimal" data-money="off" defaultValue={coupon.interest_rate != null ? String(Number(coupon.interest_rate)) : ""} className={input} /></label>
            <label className="block text-sm text-slate-700">จ่ายดอกเบี้ย
              <select name="f_coupon_frequency" defaultValue={coupon.coupon_frequency ?? ""} className={input}>
                <option value="">— ไม่ระบุ —</option>{COUPON_FREQ_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          </div>
          <p className="text-xs text-slate-500">ใส่ครบ (และมีวันครบกำหนด) → ขึ้นในแท็บ &ldquo;รอรับเดือนนี้&rdquo; หน้า Investments · วันรับนับย้อนจากวันครบกำหนด · ยอดต่องวด = เงินต้น × อัตรา × เดือน ÷ 12</p>
        </div>
      )}
      {autoKind && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <input type="hidden" name="f_auto_price" value={auto ? "on" : "off"} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={auto} disabled={!!autoBlocked && !auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1" />
            <span>ดึงราคาอัตโนมัติทุกวันทำการ (18:45)
              <span className="block text-xs text-slate-500">{autoKind === "FUND"
                ? "ราคา NAV จาก ก.ล.ต. · ใส่ชื่อย่อกองทุนในช่อง \"สัญลักษณ์ / รหัส\" (เช่น K-FIXED) · กองทุนที่มีหลายชนิดหน่วยให้ใส่ชื่อชนิดหน่วยที่ถือ (เช่น K-FIXED-A) ระบบหารหัสกองทุนให้เอง"
                : "ราคาจาก Yahoo Finance (ฟรี ไม่เป็นทางการ) · หุ้นไทยใส่สัญลักษณ์ เช่น PTT · หุ้นต่างประเทศ เช่น AAPL"}
                {" "}· ราคาที่ต่างจากราคาก่อนหน้าเกิน 20% ไม่บันทึก · ไม่ทับราคาจาก Statement</span>
              {autoBlocked && !auto && <span className="block text-xs text-amber-700">{autoBlocked}</span>}</span>
          </label>
          {auto && (
            <label className="block text-xs text-slate-600">รหัสสำหรับดึงราคา (ไม่บังคับ — เว้นว่าง = ใช้สัญลักษณ์ด้านบน)
              <input name="f_price_ref" defaultValue={v.price_ref ?? ""} placeholder={autoKind === "FUND" ? "ระบบเติมให้เมื่อหาเจอ" : "เช่น PTT.BK · 7203.T"} className={input} data-plain />
            </label>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

/**
 * แปลงยอดตั้งต้นเป็นจำนวนหน่วยจริง — รายการที่เป็นมูลค่าก้อนเดียว หรือใส่ 1 หน่วยแทนมูลค่ารวม (มีแค่ยอดตั้งต้น)
 * กองทุน: ดึง NAV ณ วันตั้งต้นจาก ก.ล.ต. → จำนวนหน่วย = มูลค่าตั้งต้น ÷ NAV (แก้ได้) · มูลค่าทุกวัน / ต้นทุนรวมเท่าเดิม
 */
export function ConvertUnitsForm({ assetId, holdingId, isFund, lump, symbol, openingDate, openingValue, currency, paths }: {
  assetId: string; holdingId: string; isFund: boolean; lump: boolean; symbol: string;
  openingDate: string; openingValue: number; currency: string; paths: string[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(restateUnits, {});
  const [lumpState, lumpAction, lumpPending] = useActionState<RecState, FormData>(updateRecord, {});
  const [units, setUnits] = useState("");
  const [nav, setNav] = useState<number | null>(null);
  if (state.ok || lumpState.ok) return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{state.ok ?? lumpState.ok}</div>;
  const u = Number(units.replace(/,/g, "")) || 0;
  // กองทุน 1 หน่วย = มักใส่มูลค่ารวมแทนจำนวน → แสดงเด่น · อย่างอื่น (มูลค่าก้อนเดียว / 1 หน่วยจริง) = ลิงก์เล็กกดเปิด
  const prominent = isFund && !lump;
  return (
    <details open={prominent} className={prominent ? "" : "text-sm"}>
    <summary className={prominent ? "hidden" : "cursor-pointer text-xs text-blue-700 hover:underline"}>{lump ? "รู้จำนวนหน่วยแล้ว? แปลงมูลค่าก้อนเดียวเป็นจำนวนหน่วย" : "ยอดตั้งต้นเป็น 1 หน่วย — แปลงเป็นจำนวนหน่วย / มูลค่าก้อนเดียว"}</summary>
    <div className="mt-2 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <div>
        <div className="font-medium text-amber-900">{lump ? "มูลค่าก้อนเดียว — แปลงเป็นจำนวนหน่วยได้" : "ยอดตั้งต้นเป็น 1 หน่วย — ใส่มูลค่ารวมแทนจำนวนหน่วยหรือไม่?"}</div>
        <p className="text-xs text-amber-800">มูลค่าตั้งต้น ณ {thDate(openingDate)} = {money(openingValue, currency)} · แปลงแล้วมูลค่าทุกวันและต้นทุนรวมเท่าเดิม แค่แยกเป็นจำนวนหน่วย × ราคาต่อหน่วย (จึงดึงราคาอัตโนมัติได้)</p>
      </div>
      {isFund && (
        <SecNavPicker date={openingDate} initialQuery={symbol}
          onNav={(r) => { setNav(r.nav); setUnits(String(Math.round((openingValue / r.nav) * 10000) / 10000)); }} />
      )}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="holding_id" value={holdingId} />
        <label className="block text-sm text-slate-700">จำนวนหน่วย ณ {thDate(openingDate)} *
          <input name="units" required inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} className={`${small} mt-1 block w-44`} /></label>
        <label className="block text-sm text-slate-700">เหตุผล
          <input name="notes" placeholder="เช่น จำนวนหน่วยจาก Statement" className={`${small} mt-1 block w-64`} /></label>
        <button disabled={pending || u <= 0} className={btn}>{pending ? "กำลังแปลง…" : "แปลงเป็นจำนวนหน่วย"}</button>
        <Msg s={state} />
      </form>
      {u > 0 && (
        <p className="text-xs text-slate-600">ราคาต่อหน่วย ณ วันตั้งต้น = {money(openingValue / u, currency, 4)}
          {nav != null && Math.abs(openingValue / u - nav) / nav > 0.001 && <span className="text-amber-700"> · ต่างจาก NAV {nav} (ตรวจจำนวนหน่วย)</span>}</p>
      )}
      {!lump && (
        <form action={lumpAction} className="flex flex-wrap items-center gap-3 border-t border-amber-200 pt-3">
          <input type="hidden" name="table" value="investment_holdings" />
          <input type="hidden" name="id" value={holdingId} />
          <input type="hidden" name="paths" value={paths.join(",")} />
          <input type="hidden" name="f_valuation_mode" value="LUMP_SUM" />
          <span className="text-xs text-slate-600">ไม่นับเป็นหน่วย (เช่น รู้แค่มูลค่าจาก Statement)?</span>
          <button disabled={lumpPending} className={obtn}>ตั้งเป็นมูลค่าก้อนเดียว</button>
          {lumpState.error && <span className="text-sm text-red-600">{lumpState.error}</span>}
        </form>
      )}
      {!lump && <p className="text-xs text-slate-500">ถ้าถือ 1 หน่วยจริง ไม่ต้องทำอะไร</p>}
    </div>
    </details>
  );
}
