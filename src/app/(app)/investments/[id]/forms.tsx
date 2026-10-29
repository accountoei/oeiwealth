"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { useRowPanel } from "@/components/RowPanel";
import {
  addCashAccount, addHolding, moveCash, recordMaturity, recordTx, saveValuations, transferMoney, updateTransfer, type ActionState,
} from "../actions";
import { HOLDING_TYPE_LABEL, ROW_BTN, money, qty, thDate } from "@/lib/format";
import { SettleModeRadios } from "@/components/SettleMode";
import { CurrencySelect, useCurrencies } from "@/components/CurrencyContext";
import BalanceGuard from "@/components/BalanceGuard";
import SecNavPicker from "@/components/SecNavPicker";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { PfCardPayBody, PfExpenseBody, type PfPayCtx } from "./pf-pay-forms";
import { COUPON_FREQ_OPTIONS } from "@/lib/coupon-schedule";
import { defaultIncomeAccount, groupIncomeOptions, incomeAccountOptions } from "@/lib/income-account";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const lbl = "block text-sm text-slate-700";

export type Holding = { id: string; name: string; symbol: string | null; holding_type: string; currency: string;
  quantity: number; current_price: number | null; status: string;
  /** LUMP_SUM = มูลค่าก้อนเดียว (ไม่มีราคาต่อหน่วย) */
  valuation_mode?: string };
export type Bank = { asset_id: string; name: string; currency: string };
/** บัญชีเงินฝากในพอร์ต (CASH holding) */
export type CashAcct = { id: string; name: string; currency: string; is_default_cash: boolean };

/** เลือกบัญชีเงินฝากในพอร์ต — แสดงเฉพาะเมื่อสกุลนั้นมีมากกว่า 1 บัญชี (บัญชีเดียว = ใช้บัญชีนั้นอัตโนมัติ) */
export function CashAccountSelect({ accounts, currency, name = "cash_holding_id", label, compact, defaultId }: {
  accounts: CashAcct[]; currency: string; name?: string; label: string; compact?: boolean;
  /** ค่าตั้งต้น (เช่น บัญชีรับเงินที่ผูกไว้กับหลักทรัพย์) · ไม่อยู่ในรายการ = บัญชีหลัก ★ */
  defaultId?: string | null;
}) {
  const list = accounts.filter((a) => a.currency === currency);
  if (list.length < 2) return null;
  const def = list.find((a) => a.id === defaultId) ?? list.find((a) => a.is_default_cash) ?? list[0];
  const sel = (
    <select key={`${name}-${currency}`} name={name} defaultValue={def.id} className={compact ? small : input}>
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_default_cash ? " ★" : ""}</option>)}
    </select>
  );
  return compact
    ? <label className="text-xs">{label} {sel}</label>
    : <label className={lbl}>{label}{sel}</label>;
}

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}
const n = (s: string) => Number(s.replace(/,/g, "")) || 0;

/** หุ้นกู้ / อื่น ๆ ตัวใหม่: ข้อมูลตารางรับดอกเบี้ย ใส่ได้ตั้งแต่ตอนเพิ่ม (ไม่ใส่ = ตั้งทีหลังที่หน้าหลักทรัพย์ → แก้ไขข้อมูล) */
const COUPON_TYPES = ["BOND", "OTHER"];
/** face / onFace: ควบคุมช่องเงินต้นจากภายนอก (ฟอร์ม + รายการ: จำนวน · ราคา · เงินต้น คำนวณกันเอง) · faceHint: คำอธิบายเต็มความกว้างกล่อง */
function CouponFields({ prefix, currency, face, onFace, faceHint, faceAuto }: {
  prefix: string; currency: string; face?: string; onFace?: (v: string) => void; faceHint?: string; faceAuto?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 md:col-span-3">
      <div className="text-sm font-medium text-slate-800">ดอกเบี้ย / ตารางรับ (ถ้ามี)</div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>เงินต้น / มูลค่าหน้าตั๋ว ({currency})<input name={`${prefix}face_value`} inputMode="decimal" className={input}
          {...(faceAuto ? { "data-plain": "" } : {})}
          {...(onFace ? { value: face ?? "", onChange: (e: { target: { value: string } }) => onFace(e.target.value) } : {})} /></label>
        <label className={lbl}>อัตราผลตอบแทน (% ต่อปี)<input name={`${prefix}interest_rate`} inputMode="decimal" data-money="off" className={input} /></label>
        <label className={lbl}>จ่ายดอกเบี้ย
          <select name={`${prefix}coupon_frequency`} defaultValue="" className={input}>
            <option value="">— ไม่ระบุ —</option>{COUPON_FREQ_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
      </div>
      {faceHint && <p className="text-xs text-slate-500">{faceHint}</p>}
      <p className="text-xs text-slate-500">ใส่ครบ + วันครบกำหนด → ตารางรับดอกเบี้ย / เงินต้นขึ้นทันที และขึ้นในแท็บ &ldquo;บันทึกรับผลตอบแทน&rdquo; · ไม่ใส่ตอนนี้ แก้ทีหลังได้ที่หน้าหลักทรัพย์</p>
    </div>
  );
}

/* ------------------------------------------------------------------ ยอดตั้งต้น */
/** ยอดตั้งต้น (หลักทรัพย์ที่ถืออยู่ก่อน Go-live) — อยู่ในปุ่ม "+ รายการ" */
function OpeningBody({ assetId, currency, openingDate, isSetup, onClose }:
  { assetId: string; currency: string; openingDate: string; isSetup: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addHolding, {});
  const [ccy, setCcy] = useState(currency);
  const [type, setType] = useState("EQUITY");
  const [symbol, setSymbol] = useState("");
  const [mode, setMode] = useState<"UNITS" | "LUMP_SUM">("UNITS");
  const [how, setHow] = useState<"units" | "value">("units");
  // แบบ "รู้แค่มูลค่า": มูลค่า ÷ ราคาต่อหน่วย = จำนวนหน่วย (แก้ได้)
  const [value, setValue] = useState(""); const [unitPrice, setUnitPrice] = useState(""); const [units, setUnits] = useState("");
  const [costTotal, setCostTotal] = useState(""); const [qtyKnown, setQtyKnown] = useState("");
  const calcUnits = (v: string, p: string) => { const u = n(v) / n(p); setUnits(n(v) > 0 && n(p) > 0 ? String(Math.round(u * 10000) / 10000) : ""); };
  const qtyNow = mode === "LUMP_SUM" ? 0 : how === "units" ? n(qtyKnown) : n(units);
  const unitsFromValue = n(units) > 0 ? n(units) : 0;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="valuation_mode" value={mode} />
      <div>
        <h3 className="font-medium text-slate-900">หลักทรัพย์ที่ถืออยู่ก่อน Go-live</h3>
        <p className="text-xs text-slate-500">ยอด ณ สิ้นวัน {thDate(openingDate)} · ต้นทุนใช้คำนวณกำไร/ขาดทุน · ราคาตลาด ณ วันนั้นใช้เป็นมูลค่าตั้งต้น</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>ประเภท
          <select name="holding_type" value={type} onChange={(e) => { setType(e.target.value); setMode(e.target.value === "OTHER" ? "LUMP_SUM" : "UNITS"); }} className={input}>
            {Object.entries(HOLDING_TYPE_LABEL).filter(([v]) => v !== "CASH").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={lbl}>ชื่อ *<input name="name" required placeholder="เช่น ปตท. / K-FIXED" className={input} /></label>
        <label className={lbl}>สัญลักษณ์ / รหัส<input name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={type === "FUND" ? "เช่น K-FIXED-A" : "เช่น PTT"} className={input} data-plain /></label>
        <label className={lbl}>สกุลเงิน
          <CurrencySelect name="currency" value={ccy} onChange={setCcy} className={input} />
        </label>
        <label className={`${lbl} md:col-span-2`}>วิธีนับมูลค่า
          <select value={mode} onChange={(e) => setMode(e.target.value as "UNITS" | "LUMP_SUM")} className={input}>
            <option value="UNITS">นับเป็นหน่วย (จำนวนหน่วย × ราคาต่อหน่วย)</option>
            <option value="LUMP_SUM">มูลค่าก้อนเดียว (ไม่นับหน่วย · ดึงราคาอัตโนมัติไม่ได้)</option>
          </select>
        </label>
      </div>

      {mode === "UNITS" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={how === "units"} onChange={() => setHow("units")} /> รู้จำนวนหน่วย</label>
            <label className="flex items-center gap-2"><input type="radio" checked={how === "value"} onChange={() => setHow("value")} /> รู้แค่มูลค่า (ระบบคำนวณจำนวนหน่วยให้)</label>
          </div>
          {how === "units" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <label className={lbl}>จำนวนหน่วย *<input name="quantity" required inputMode="decimal" value={qtyKnown} onChange={(e) => setQtyKnown(e.target.value)} className={input} /></label>
              <label className={lbl}>ต้นทุนเฉลี่ยต่อหน่วย ({ccy}) *<input name="price" required inputMode="decimal" data-money="off" className={input} /></label>
              <label className={lbl}>ราคาตลาด ณ {thDate(openingDate)}<input name="market_price" inputMode="decimal" data-money="off" placeholder="ไม่ใส่ = ใช้ราคาทุน" className={input} /></label>
            </div>
          ) : (
            <div className="space-y-3">
              {type === "FUND" && (
                <SecNavPicker date={openingDate} initialQuery={symbol}
                  onNav={(r) => { setUnitPrice(String(r.nav)); calcUnits(value, String(r.nav)); if (!symbol) setSymbol(r.class ?? ""); }} />
              )}
              <div className="grid gap-4 md:grid-cols-3">
                <label className={lbl}>มูลค่า ณ {thDate(openingDate)} ({ccy}) *
                  <input required inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); calcUnits(e.target.value, unitPrice); }} className={input} /></label>
                <label className={lbl}>ราคาต่อหน่วย ณ วันนั้น *{type === "FUND" && <span className="text-xs text-slate-500"> (NAV)</span>}
                  <input name="market_price" required inputMode="decimal" data-money="off" value={unitPrice}
                    onChange={(e) => { setUnitPrice(e.target.value); calcUnits(value, e.target.value); }} className={input} /></label>
                <label className={lbl}>จำนวนหน่วย (คำนวณให้ · แก้ได้) *
                  <input name="quantity" required inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} className={input} /></label>
                <label className={lbl}>ต้นทุนรวม ({ccy})
                  <input inputMode="decimal" value={costTotal} onChange={(e) => setCostTotal(e.target.value)} placeholder="ไม่ใส่ = ใช้มูลค่าเป็นต้นทุน" className={input} /></label>
              </div>
              <input type="hidden" name="price" value={unitsFromValue > 0 ? String((n(costTotal) > 0 ? n(costTotal) : n(value)) / unitsFromValue) : ""} />
              {unitsFromValue > 0 && n(unitPrice) > 0 && (
                <p className="text-xs text-slate-500">ตรวจสอบ: {qty(unitsFromValue)} หน่วย × {n(unitPrice)} = {money(unitsFromValue * n(unitPrice), ccy)}
                  {Math.abs(unitsFromValue * n(unitPrice) - n(value)) >= 0.005 && <> · ต่างจากมูลค่าที่ใส่ {money(unitsFromValue * n(unitPrice) - n(value), ccy)} (ปัดเศษหน่วย)</>}</p>
              )}
            </div>
          )}
          {qtyNow === 1 && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" required className="mt-1" />
              <span>ยืนยันว่าถือ <b>1 หน่วยจริง</b> (ไม่ใช่ใส่ 1 แทนมูลค่ารวม) — ถ้ารู้แค่มูลค่า ให้เลือก &quot;รู้แค่มูลค่า&quot; หรือ &quot;มูลค่าก้อนเดียว&quot;</span>
            </label>
          )}
        </div>
      )}

      {mode === "LUMP_SUM" && (
        <div className="grid gap-4 md:grid-cols-3">
          <input type="hidden" name="quantity" value="1" />
          <label className={lbl}>ต้นทุนรวม ({ccy}) *<input name="price" required inputMode="decimal" value={costTotal} onChange={(e) => setCostTotal(e.target.value)} className={input} /></label>
          <label className={lbl}>มูลค่า ณ {thDate(openingDate)} ({ccy})<input name="market_value" inputMode="decimal" placeholder="ไม่ใส่ = เท่าต้นทุน" className={input} /></label>
          <p className="text-xs text-slate-500 md:col-span-3">ไม่เก็บจำนวนหน่วย · อัปเดตมูลค่าด้วย &quot;อัปเดตราคา / Statement&quot; · รู้จำนวนหน่วยทีหลังแปลงได้ที่หน้ารายการนี้</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {(type === "BOND" || type === "FCN" || type === "STRUCTURED_PRODUCT" || type === "OTHER") && (
          <label className={lbl}>วันครบกำหนด{type === "OTHER" && " (ถ้ามี)"}<input name="maturity_date" type="date" className={input} /></label>
        )}
        {COUPON_TYPES.includes(type) && <CouponFields prefix="" currency={ccy} />}
        {ccy !== "THB" && (
          <>
            <label className={lbl}>ต้นทุนรวมเป็นบาท<input name="cost_base_thb" inputMode="decimal" className={input} /></label>
            <label className={lbl}>หรือ FX ตอนซื้อ (บาท/{ccy})<input name="fx_rate" inputMode="decimal" placeholder="ไม่ใส่ทั้งคู่ = อัตรา อัตราของระบบ ณ วันตั้งต้น" className={input} /></label>
          </>
        )}
        <label className={`${lbl} md:col-span-3`}>หมายเหตุ {!isSetup && "(เหตุผล · จำเป็น เพราะระบบ LIVE แล้ว)"}
          <input name="notes" required={!isSetup} className={input} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอดตั้งต้น"}</button>
        <button type="button" data-close onClick={onClose} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ + รายการ */
const TX_TYPES: [string, string][] = [
  ["BUY", "ซื้อ"], ["SELL", "ขาย"], ["DIVIDEND", "ปันผล"], ["INTEREST", "ดอกเบี้ย"], ["COUPON", "Coupon"],
  ["REDEMPTION", "ไถ่ถอน / ขายคืนกองทุน"], ["FEE", "ค่าธรรมเนียม"], ["TAX", "ภาษี"], ["ADJUSTMENT", "ปรับปรุงจำนวน / เงินฝาก"],
];

export function TxForm({ assetId, portfolioName = "", portfolioCurrency, holdings, banks, cashAccounts, today, minDate, pay, opening }: {
  assetId: string; portfolioName?: string; portfolioCurrency: string; holdings: Holding[]; banks: Bank[]; cashAccounts: CashAcct[]; today: string; minDate: string;
  /** จ่ายออกจากพอร์ต (ค่าใช้จ่าย / จ่ายบัตร) */
  pay?: PfPayCtx;
  /** ยอดตั้งต้น (ADMIN / ช่วงตั้งค่าระบบ) */
  opening?: { openingDate: string; isSetup: boolean };
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(recordTx, {});
  const [type, setType] = useState("BUY");
  const [holdingId, setHoldingId] = useState("");
  const [newCcy, setNewCcy] = useState(portfolioCurrency);
  const [newType, setNewType] = useState("EQUITY");
  // จำนวน · ราคา · เงินต้น: เก็บค่าที่ผู้ใช้พิมพ์เอง (typed) — หุ้นกู้ตัวใหม่ พิมพ์ 2 ช่อง → ช่องที่เหลือคำนวณให้
  const [raw, setRaw] = useState({ q: "", p: "", f: "" });
  const [amt, setAmt] = useState("");
  const [fee, setFee] = useState(""); const [tax, setTax] = useState("");
  const [mode, setMode] = useState("cash");
  const [dir, setDir] = useState("IN");

  const active = holdings.filter((h) => h.status === "ACTIVE");
  const securities = active.filter((h) => h.holding_type !== "CASH");
  const isNew = holdingId === "__new__";
  const h = holdings.find((x) => x.id === holdingId);
  const ccy = isNew ? newCcy : (h?.currency ?? portfolioCurrency);
  const qp = type === "BUY" || type === "SELL";
  const needsHolding = ["BUY", "SELL", "REDEMPTION", "DIVIDEND", "COUPON"].includes(type);
  const optionalHolding = ["INTEREST", "FEE", "TAX", "ADJUSTMENT"].includes(type);
  const canBank = ["BUY", "SELL", "REDEMPTION", "DIVIDEND", "INTEREST", "COUPON"].includes(type);
  const hasTax = ["SELL", "REDEMPTION", "DIVIDEND", "INTEREST", "COUPON"].includes(type);
  const hasFee = !["FEE", "TAX", "ADJUSTMENT"].includes(type);
  // หุ้นกู้ / อื่น ๆ ตัวใหม่: จำนวน × ราคา → ขึ้นในช่องเงินต้นให้ (แก้เองได้) · ใส่แค่เงินต้น → บันทึกเป็น 1 หน่วย × เงินต้น
  const couponNew = isNew && COUPON_TYPES.includes(newType);
  //   พิมพ์ครบ 3 ช่องเอง = ไม่คำนวณ (เช่น ซื้อต่ำกว่าราคาหน้าตั๋ว) · พิมพ์แค่เงินต้น = บันทึกเป็น 1 หน่วย × เงินต้น
  const tri = couponNew && type === "BUY";
  const has = (k: "q" | "p" | "f") => raw[k].trim() !== "" && n(raw[k]) > 0;
  const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d === 2 ? 2 : 0, maximumFractionDigits: d });
  const q = raw.q.trim() || !tri ? raw.q : has("p") && has("f") ? fmt(n(raw.f) / n(raw.p), 6) : "";
  const p = raw.p.trim() || !tri ? raw.p : has("q") && has("f") ? fmt(n(raw.f) / n(raw.q), 6) : "";
  const face = raw.f.trim() || !tri ? raw.f : has("q") && has("p") ? fmt(n(raw.q) * n(raw.p), 2) : "";
  // ช่องที่คำนวณให้ (ไม่ได้พิมพ์เอง) → data-plain: ตัวจัดรูปตัวเลขกลางไม่แตะ (ไม่งั้นนับเป็นพิมพ์เอง)
  const auto = (k: "q" | "p" | "f") => tri && !raw[k].trim() ? { "data-plain": "" } : {};
  const setQ = (v: string) => setRaw((r) => ({ ...r, q: v }));
  const setP = (v: string) => setRaw((r) => ({ ...r, p: v }));
  const faceOnly = tri && !q.trim() && !p.trim() && n(face) > 0;
  const gross = faceOnly ? n(face) : qp ? n(q) * n(p) : n(amt);
  const net = type === "BUY" ? gross + n(fee) : ["FEE", "TAX"].includes(type) ? gross : gross - n(fee) - n(tax);
  const bankList = banks.filter((b) => b.currency === ccy);
  const incomeOpts = isNew ? incomeAccountOptions(cashAccounts, banks, ccy) : [];
  const holdingOptions = type === "BUY" ? securities : optionalHolding ? active : securities;
  const isCashAdj = type === "ADJUSTMENT" && (!h || h.holding_type === "CASH");
  // เลือกบัญชีเงินฝาก: รายการของหลักทรัพย์ที่เงินเข้า/ออกเงินฝากในพอร์ต (ถ้าเลือกบัญชีเงินฝากเป็น "หลักทรัพย์" อยู่แล้ว ไม่ต้องเลือกซ้ำ)
  const pickCash = (!canBank || mode === "cash") && h?.holding_type !== "CASH"
    && !(type === "ADJUSTMENT" && h && h.holding_type !== "CASH");

  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(btn)}>+ รายการ</button>;
  if (!open) return trigger;

  const typeSelect = (
    <label className={lbl}>ประเภท
      <select name="type" value={type} onChange={(e) => { setType(e.target.value); setHoldingId(""); setMode("cash"); }} className={input}>
        <optgroup label="รายการลงทุน">{TX_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
        {pay && <optgroup label="จ่ายออกจากพอร์ต">
          <option value="PF_EXPENSE">ค่าใช้จ่าย (จ่ายจากพอร์ต)</option>
          <option value="PF_CARD">จ่ายบัตรเครดิต</option>
        </optgroup>}
        {opening && <optgroup label="ตั้งค่า"><option value="OPENING">ยอดตั้งต้น (ถืออยู่ก่อน Go-live)</option></optgroup>}
      </select>
    </label>
  );
  const special = type === "PF_EXPENSE" || type === "PF_CARD" || type === "OPENING";
  if (special) {
    return present(trigger, (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-medium text-slate-900">{type === "OPENING" ? "หลักทรัพย์ที่ถืออยู่ก่อน Go-live" : "จ่ายออกจากบัญชีเงินฝากในพอร์ต"}</h3>
        <div className="grid gap-4 md:grid-cols-3">{typeSelect}</div>
        {type === "PF_EXPENSE" && pay && <PfExpenseBody ctx={pay} today={today} minDate={minDate} onClose={() => setOpen(false)} />}
        {type === "PF_CARD" && pay && <PfCardPayBody ctx={pay} today={today} minDate={minDate} onClose={() => setOpen(false)} />}
        {type === "OPENING" && opening && <OpeningBody assetId={assetId} currency={portfolioCurrency} openingDate={opening.openingDate}
          isSetup={opening.isSetup} onClose={() => setOpen(false)} />}
      </div>
    ));
  }

  const summary: string[] = [];
  if (type === "BUY") summary.push(mode === "bank" ? `โอนจากบัญชีธนาคาร ${money(net, ccy)} เข้าพอร์ตเพื่อซื้อ` : `หักเงินฝากในพอร์ต ${money(net, ccy)}`);
  if (["SELL", "REDEMPTION"].includes(type)) summary.push(mode === "bank" ? `โอนออกไปบัญชีธนาคาร ${money(net, ccy)}` : `เพิ่มเงินฝากในพอร์ต ${money(net, ccy)}`);
  if (["DIVIDEND", "INTEREST", "COUPON"].includes(type)) {
    summary.push(`บันทึกรายได้ ${money(gross, ccy)}${n(tax) ? ` (ภาษี ${money(n(tax))})` : ""}`);
    summary.push(mode === "bank" ? `โอนออกไปบัญชีธนาคาร ${money(net, ccy)}` : `เพิ่มเงินฝากในพอร์ต ${money(net, ccy)}`);
  }
  if (["FEE", "TAX"].includes(type)) summary.push(`หักเงินฝากในพอร์ต ${money(gross, ccy)} (ลดผลตอบแทน ไม่ใช่ค่าใช้จ่ายครอบครัว)`);

  return present(trigger, (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">บันทึกรายการลงทุน</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {typeSelect}
        <label className={`${lbl} md:col-span-2`}>หลักทรัพย์ {needsHolding && "*"}
          <select name="holding_id" value={holdingId} onChange={(e) => setHoldingId(e.target.value)} required={needsHolding} className={input}>
            <option value="">{optionalHolding ? `— เงินฝากในพอร์ต / ทั้งพอร์ต (${portfolioCurrency}) —` : "— เลือก —"}</option>
            {holdingOptions.map((x) => (
              <option key={x.id} value={x.id}>{x.name}{x.symbol ? ` (${x.symbol})` : ""} · ถือ {qty(x.quantity)} · {x.currency}</option>
            ))}
            {type === "BUY" && <option value="__new__">+ หลักทรัพย์ตัวใหม่</option>}
          </select>
        </label>
        {isNew && (
          <>
            <label className={lbl}>ประเภทหลักทรัพย์
              <select name="new_holding_type" value={newType} onChange={(e) => setNewType(e.target.value)} className={input}>
                {Object.entries(HOLDING_TYPE_LABEL).filter(([v]) => v !== "CASH").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>ชื่อ *<input name="new_name" required className={input} /></label>
            <label className={lbl}>สัญลักษณ์<input name="new_symbol" className={input} /></label>
            <label className={lbl}>สกุลเงิน
              <CurrencySelect name="new_currency" value={newCcy} onChange={setNewCcy} className={input} />
            </label>
            <label className={lbl}>วันครบกำหนด (ถ้ามี)<input name="new_maturity_date" type="date" className={input} /></label>
          </>
        )}
        <label className={lbl}>วันที่รายการ *
          <input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} />
        </label>
        {qp && (
          <>
            <label className={lbl}>จำนวนหน่วย{faceOnly ? "" : " *"}<input name="quantity" required={!faceOnly} inputMode="decimal" value={q} {...auto("q")}
              placeholder={faceOnly ? "1 (จากเงินต้น)" : undefined} onChange={(e) => setQ(e.target.value)} className={input} /></label>
            <label className={lbl}>ราคาต่อหน่วย ({ccy}){faceOnly ? "" : " *"}<input name="price" required={!faceOnly} inputMode="decimal" value={p} {...auto("p")}
              placeholder={faceOnly ? "= เงินต้น" : undefined} onChange={(e) => setP(e.target.value)} className={input} /></label>
          </>
        )}
        {type === "REDEMPTION" && (
          <label className={lbl}>จำนวนหน่วยที่ไถ่ถอน<input name="quantity" inputMode="decimal" placeholder="ไม่ใส่ = ทั้งหมด" className={input} /></label>
        )}
        {type === "ADJUSTMENT" && (
          <>
            <label className={lbl}>ทิศทาง
              <select name="direction" value={dir} onChange={(e) => setDir(e.target.value)} className={input}>
                <option value="IN">เพิ่ม</option><option value="OUT">ลด</option>
              </select>
            </label>
            {!isCashAdj && <label className={lbl}>จำนวนหน่วยที่ปรับ *<input name="quantity" required inputMode="decimal" className={input} /></label>}
          </>
        )}
        {!qp && (type !== "ADJUSTMENT" || isCashAdj) && (
          <label className={lbl}>{["DIVIDEND", "INTEREST", "COUPON"].includes(type) ? "ยอดก่อนหักภาษี" : "จำนวนเงิน"} ({ccy}) *
            <input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={input} />
          </label>
        )}
        {hasFee && type !== "ADJUSTMENT" && (isNew && type === "BUY" ? (
          // หลักทรัพย์ตัวใหม่: บัญชีรับดอกเบี้ย / ปันผล / เงินคืน อยู่แถวเดียวกับค่าธรรมเนียม (ค่าตั้งต้น = บัญชีหลักในพอร์ต ★)
          <div className="grid gap-4 md:col-span-3 md:grid-cols-3">
            <label className={lbl}>ค่าธรรมเนียม<input name="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={input} /></label>
            {incomeOpts.length > 0 && (
              <label className={`${lbl} md:col-span-2`}>รับดอกเบี้ย / ปันผล / เงินคืน เข้าบัญชี
                <select key={`inc-${ccy}`} name="income_account" defaultValue={defaultIncomeAccount(incomeOpts)} className={input}>
                  {groupIncomeOptions(incomeOpts).map(([g, os]) => <optgroup key={g} label={g}>{os.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
                </select>
                <span className="mt-1 block text-xs text-slate-500">ใช้เป็นค่าตั้งต้นตอนรับเงิน (เปลี่ยนตอนรับได้) · แก้ทีหลังได้ที่หน้าหลักทรัพย์ → แก้ไขข้อมูล</span>
              </label>
            )}
          </div>
        ) : (
          <label className={lbl}>ค่าธรรมเนียม<input name="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={input} /></label>
        ))}
        {hasTax && (
          <label className={lbl}>ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className={input} /></label>
        )}
        {couponNew && <CouponFields prefix="new_" currency={newCcy} face={face} faceAuto={tri && !raw.f.trim()}
          onFace={(v) => setRaw((r) => ({ ...r, f: v }))}
          faceHint={tri ? "จำนวนหน่วย · ราคา · เงินต้น ใส่ 2 ช่อง → ช่องที่เหลือขึ้นให้เอง (ใส่เองครบ 3 ช่อง = ไม่คำนวณ เช่น ซื้อต่ำกว่าหน้าตั๋ว) · รู้แค่เงินต้น: ใส่ช่องเงินต้นช่องเดียว → บันทึกเป็น 1 หน่วย (แก้ทีหลังได้ที่แถว “ซื้อ”)" : undefined} />}
        {canBank && (
          <div className={`${lbl} md:col-span-3`}>
            {type === "BUY" ? "จ่ายเงินจาก" : "รับเงินเข้า"}
            <SettleModeRadios mode={mode} setMode={setMode} portfolioName={portfolioName} out={type === "BUY"} className="mt-1 flex flex-wrap gap-4" />
          </div>
        )}
        {pickCash && (
          <CashAccountSelect accounts={cashAccounts} currency={ccy}
            label={type === "BUY" || ["FEE", "TAX"].includes(type) ? "จ่ายจากบัญชีเงินฝาก" : "เข้าบัญชีเงินฝาก"} />
        )}
        {canBank && mode === "bank" && (
          <>
            <label className={lbl}>บัญชีธนาคาร ({ccy}) *
              <select name="bank_asset_id" required className={input}>
                <option value="">— เลือก —</option>
                {bankList.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
              </select>
              {bankList.length === 0 && <span className="mt-1 block text-xs text-amber-700">ไม่มีบัญชีสกุล {ccy}</span>}
            </label>
            <label className={lbl}>วันที่เงินเข้า/ออกจริง (T+1/T+2)<input name="settlement_date" type="date" className={input} /></label>
          </>
        )}
        <label className={`${lbl} md:col-span-3`}>หมายเหตุ {type === "ADJUSTMENT" && "(เหตุผล · จำเป็น)"}
          <input name="notes" required={type === "ADJUSTMENT"} placeholder={type === "ADJUSTMENT" ? "เช่น แตกพาร์ 1:10" : ""} className={input} />
        </label>
      </div>
      {summary.length > 0 && gross > 0 && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="text-xs font-medium text-slate-500">ระบบจะบันทึกให้</div>
          <ul className="mt-1 list-disc pl-5 text-slate-700">{summary.map((s) => <li key={s}>{s}</li>)}</ul>
          {mode === "bank" && <p className="mt-1 text-xs text-slate-500">ถ้าวันที่เงินเข้า/ออกจริงข้ามเดือน ระบบนับเป็นรอรับ/รอจ่ายชำระตอนปิดเดือน</p>}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <BalanceGuard amount={["amount", "fee"]} date={["settlement_date", "date"]} when={["type", ["BUY", "FEE", "TAX"]]} />
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/* ------------------------------------------------------------------ โอนเงิน ธนาคาร ↔ พอร์ต (สกุลเดียวกัน / ข้ามสกุล) */
/** อัตราที่ได้จริง (บาทต่อหน่วย) เมื่อคู่สกุลมี THB */
function rateText(src: string, srcAmt: number, dst: string, dstAmt: number) {
  if (!(srcAmt > 0 && dstAmt > 0) || src === dst) return null;
  if (src === "THB") return `อัตราที่ได้จริง 1 ${dst} = ${(srcAmt / dstAmt).toFixed(4)} บาท`;
  if (dst === "THB") return `อัตราที่ได้จริง 1 ${src} = ${(dstAmt / srcAmt).toFixed(4)} บาท`;
  return `อัตราที่ได้จริง 1 ${src} = ${(dstAmt / srcAmt).toFixed(6)} ${dst}`;
}

/** ปุ่ม "โอนเงิน": ทิศทาง ธนาคาร → พอร์ต · พอร์ต → ธนาคาร · ภายในพอร์ต (ย้ายเงิน / แลกเงินระหว่างบัญชีเงินฝากในพอร์ต) */
export function TransferForm({ assetId, currency, banks, cashAccounts, today, minDate }:
  { assetId: string; currency: string; banks: Bank[]; cashAccounts: CashAcct[]; today: string; minDate: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [dir, setDir] = useState("IN");
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(obtn)}>โอนเงิน</button>;
  if (!open) return trigger;
  const move = dir === "MOVE" && cashAccounts.length > 0;
  const dirSelect = (
    <label className={lbl}>ทิศทาง
      <select name="direction" value={move ? "MOVE" : dir} onChange={(e) => setDir(e.target.value)} className={input}>
        <option value="IN">ธนาคาร → พอร์ต</option><option value="OUT">พอร์ต → ธนาคาร</option>
        {cashAccounts.length > 0 && <option value="MOVE">ภายในพอร์ต (ระหว่างบัญชี / แลกเงิน)</option>}
      </select>
    </label>
  );
  const close = () => setOpen(false);
  return present(trigger, move
    ? <MoveCashBody assetId={assetId} cashAccounts={cashAccounts} today={today} minDate={minDate} dirSelect={dirSelect} onClose={close} />
    : <BankTransferBody assetId={assetId} currency={currency} banks={banks} cashAccounts={cashAccounts} today={today} minDate={minDate}
        dir={dir === "OUT" ? "OUT" : "IN"} dirSelect={dirSelect} onClose={close} />);
}

function BankTransferBody({ assetId, currency, banks, cashAccounts, today, minDate, dir, dirSelect, onClose }:
  { assetId: string; currency: string; banks: Bank[]; cashAccounts: CashAcct[]; today: string; minDate: string;
    dir: "IN" | "OUT"; dirSelect: ReactNode; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(transferMoney, {});
  const [bank, setBank] = useState("");
  const defAcct = (ccy?: string) =>
    (cashAccounts.find((a) => a.currency === ccy && a.is_default_cash) ?? cashAccounts.find((a) => a.currency === ccy)
      ?? cashAccounts.find((a) => a.currency === currency && a.is_default_cash) ?? cashAccounts[0])?.id ?? "";
  const [acct, setAcct] = useState(defAcct(currency));
  const [amt, setAmt] = useState("");
  const [got, setGot] = useState("");
  const [wait, setWait] = useState(false);
  const b = banks.find((x) => x.asset_id === bank);
  const c = cashAccounts.find((x) => x.id === acct);
  const src = (dir === "IN" ? b?.currency : c?.currency) ?? "";
  const dst = (dir === "IN" ? c?.currency : b?.currency) ?? "";
  const same = src !== "" && src === dst;
  const rate = rateText(src, n(amt), dst, n(got));
  const pickBank = (v: string) => {
    setBank(v);
    const ccy = banks.find((x) => x.asset_id === v)?.currency;
    if (ccy && !cashAccounts.some((a) => a.id === acct && a.currency === ccy)) setAcct(defAcct(ccy));
  };
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="src_ccy" value={src} />
      <input type="hidden" name="dst_ccy" value={dst} />
      <div>
        <h3 className="font-medium text-slate-900">โอนเงิน</h3>
        <p className="text-xs text-slate-500">ข้ามสกุลได้ (เช่น บัญชีบาท → เงินฝาก USD ในพอร์ต) · ยอดที่เข้ายังไม่ทราบ ใส่ทีหลังได้</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {dirSelect}
        <label className={lbl}>บัญชีธนาคาร *
          <select name="bank_asset_id" required value={bank} onChange={(e) => pickBank(e.target.value)} className={input}>
            <option value="">— เลือก —</option>
            {banks.map((x) => <option key={x.asset_id} value={x.asset_id}>{x.name} ({x.currency})</option>)}
          </select>
        </label>
        <label className={lbl}>บัญชีเงินฝากในพอร์ต *
          <select name="cash_holding_id" required value={acct} onChange={(e) => setAcct(e.target.value)} className={input}>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}){a.is_default_cash ? " ★" : ""}</option>)}
          </select>
          {cashAccounts.length === 0 && <span className="mt-1 block text-xs text-amber-700">ยังไม่มีบัญชีเงินฝากในพอร์ต — กด &ldquo;+ บัญชีเงินฝาก&rdquo; ก่อน</span>}
        </label>
        <label className={lbl}>วันที่โอน *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>รายละเอียด<input name="description" className={input} /></label>
        <span className="hidden md:block" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg bg-slate-50 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">ต้นทาง: {dir === "IN" ? b?.name ?? "บัญชีธนาคาร" : c?.name ?? "พอร์ต"}</legend>
          <label className={lbl}>เงินที่ออก{src && ` (${src})`} *<input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={input} /></label>
          <label className={lbl}>ค่าธรรมเนียมฝั่งต้นทาง{src && ` (${src})`}<input name="fee" inputMode="decimal" className={input} /></label>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg bg-slate-50 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">ปลายทาง: {dir === "IN" ? c?.name ?? "พอร์ต" : b?.name ?? "บัญชีธนาคาร"}</legend>
          <label className={lbl}>ยอดที่เข้าจริง{dst && ` (${dst})`} {!wait && !same && "*"}
            <input name="counter_amount" inputMode="decimal" value={wait ? "" : got} disabled={wait} required={!wait && !same}
              placeholder={same ? "เว้นว่าง = เท่ากับเงินที่ออก" : ""} onChange={(e) => setGot(e.target.value)} className={`${input} disabled:bg-slate-100`} />
          </label>
          <label className={lbl}>ค่าธรรมเนียมฝั่งปลายทาง{dst && ` (${dst})`}<input name="counter_fee" inputMode="decimal" className={input} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wait" checked={wait} onChange={(e) => setWait(e.target.checked)} />
            ยังไม่ทราบยอดที่เข้า (รอ Statement)</label>
        </fieldset>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
        {rate && <li className="text-slate-700">{rate}</li>}
        <li>ยอดที่เข้าจริง = ยอดหลังหักค่าธรรมเนียมฝั่งปลายทาง (ตาม Statement) · ค่าธรรมเนียมทั้ง 2 ฝั่งลงเป็นค่าใช้จ่าย &ldquo;ค่าธรรมเนียมธนาคาร&rdquo;</li>
        <li>ส่วนต่างอัตราแลกเปลี่ยน = มูลค่าเปลี่ยน (ไม่ใช่ค่าใช้จ่าย)</li>
        <li>รอยอด: ยอดที่ส่งยังนับรวมใน Net Worth (ไม่หาย) · ใส่ยอดแล้วเงินเข้ายอดบัญชีเงินฝากทันที · ใส่ยอดได้ที่กล่อง &ldquo;รอยอดปลายทาง&rdquo;</li>
      </ul>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกการโอน"}</button>
        <BalanceGuard amount={["amount", "fee"]} when={["direction", ["IN"]]} />
        <button type="button" data-close onClick={onClose} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/** รายการโอน ธนาคาร ↔ พอร์ต (จาก cash_movements) */
export type PfTransfer = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; currency: string; fee: number | null; counter_amount: number | null; counter_currency: string | null;
  counter_fee: number | null; cash_holding_id: string | null; description: string | null };

/** แก้รายการโอน / ใส่ยอดที่เข้าทีหลัง */
export function TransferEditForm({ assetId, t, bankLabel, cashAccounts, minDate, today, rowMode = false }:
  { assetId: string; t: PfTransfer; bankLabel: string; cashAccounts: CashAcct[]; minDate: string; today: string; rowMode?: boolean }) {
  const slot = useActionSlot();
  const row = useRowPanel(rowMode);                              // ในตาราง: กดที่แถวเพื่อเปิด
  const useRow = rowMode && !row.showButtons;
  const open = useRow ? true : slot.open;
  const setOpen = useRow ? row.setOpen : slot.setOpen;
  const { present, activeCls } = slot;
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTransfer, {});
  const isIn = t.movement_type === "INVESTMENT_OUT";            // ธนาคาร → พอร์ต
  const waiting = t.counter_currency != null && t.counter_amount == null;
  const [acct, setAcct] = useState(t.cash_holding_id ?? cashAccounts.find((a) => a.currency === (isIn ? t.counter_currency ?? t.currency : t.currency))?.id ?? "");
  const [amt, setAmt] = useState(String(Number(t.amount)));
  const [got, setGot] = useState(t.counter_amount != null ? String(Number(t.counter_amount)) : t.counter_currency == null ? String(Number(t.amount)) : "");
  const trigger = (
    <button type="button" onClick={() => setOpen(!open)}
      className={activeCls(waiting ? "rounded-md bg-amber-600 px-2.5 py-1 text-xs text-white hover:bg-amber-700" : "text-xs text-slate-700 underline")}>
      {waiting ? "ใส่ยอดที่เข้า" : "แก้การโอน"}
    </button>
  );
  if (!open) return trigger;
  const c = cashAccounts.find((x) => x.id === acct);
  const src = t.currency;
  const show = (form: ReactNode) => (useRow ? row.render(form) : present(trigger, form));
  const dst = (isIn ? c?.currency : t.counter_currency ?? t.currency) ?? "";
  const accts = isIn ? cashAccounts : cashAccounts.filter((a) => a.currency === t.currency);
  const rate = rateText(src, n(amt), dst, n(got));
  return show((
    <form action={action} className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-sm">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="movement_id" value={t.id} />
      <input type="hidden" name="bank_asset_id" value={(isIn ? t.from_asset_id : t.to_asset_id) ?? ""} />
      <p className="text-xs text-slate-600">{isIn ? `${bankLabel} → พอร์ต` : `พอร์ต → ${bankLabel}`} · เว้นยอดที่เข้าว่าง = ยังรอยอด</p>
      <div className="grid gap-2 md:grid-cols-4">
        <label className="text-xs">วันที่โอน<input name="date" type="date" required defaultValue={t.movement_date} min={minDate} max={today} className={`mt-1 block w-full ${small}`} /></label>
        <label className="text-xs">บัญชีเงินฝากในพอร์ต
          <select name="cash_holding_id" value={acct} onChange={(e) => setAcct(e.target.value)} className={`mt-1 block w-full ${small}`}>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        <label className="text-xs">เงินที่ออก ({src})<input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={`mt-1 block w-full ${small}`} /></label>
        <label className="text-xs">ค่าธรรมเนียมต้นทาง ({src})<input name="fee" inputMode="decimal" defaultValue={t.fee != null ? String(Number(t.fee)) : ""} className={`mt-1 block w-full ${small}`} /></label>
        <label className="text-xs">ยอดที่เข้าจริง ({dst})<input name="counter_amount" inputMode="decimal" value={got} onChange={(e) => setGot(e.target.value)} className={`mt-1 block w-full ${small}`} /></label>
        <label className="text-xs">ค่าธรรมเนียมปลายทาง ({dst})<input name="counter_fee" inputMode="decimal" defaultValue={t.counter_fee != null ? String(Number(t.counter_fee)) : ""} className={`mt-1 block w-full ${small}`} /></label>
        <label className="text-xs md:col-span-2">รายละเอียด<input name="description" defaultValue={t.description ?? ""} className={`mt-1 block w-full ${small}`} /></label>
      </div>
      {rate && <p className="text-xs text-slate-700">{rate}</p>}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/* ------------------------------------------------------------------ อัปเดตราคา (Statement) */
export function ValuationsForm({ assetId, holdings, today, minDate }:
  { assetId: string; holdings: Holding[]; today: string; minDate: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [state, action, pending] = useActionState<ActionState, FormData>(saveValuations, {});
  const list = holdings.filter((h) => h.status === "ACTIVE");
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(obtn)}>อัปเดตราคา / Statement</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">อัปเดตราคาตาม Statement</h3>
          <p className="text-xs text-slate-500">กรอกเฉพาะตัวที่มีราคาใหม่ · ใส่ราคาต่อหน่วย หรือมูลค่ารวม (สำหรับ FCN / ตัวที่ไม่มีราคา)</p>
        </div>
        <label className="text-sm">ราคา ณ วันที่
          <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} />
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="py-1">หลักทรัพย์</th><th className="text-right">จำนวนที่ถือ</th><th className="pl-3">ราคาต่อหน่วย</th><th className="pl-3">หรือ มูลค่ารวม</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((h) => (
            <tr key={h.id}>
              <td className="py-1.5">{h.name} <span className="text-xs text-slate-500">{h.currency}</span>
                <input type="hidden" name={`qty_${h.id}`} value={String(h.quantity)} />
                {h.holding_type === "CASH" && <input type="hidden" name={`cash_${h.id}`} value="1" />}
              </td>
              <td className="text-right tabular-nums">{h.holding_type === "CASH" ? "-" : h.valuation_mode === "LUMP_SUM" ? <span className="text-xs text-slate-400">ก้อนเดียว</span> : qty(h.quantity)}</td>
              <td className="pl-3">
                {h.holding_type === "CASH" || h.valuation_mode === "LUMP_SUM" ? <span className="text-xs text-slate-400">—</span> :
                  <input name={`price_${h.id}`} inputMode="decimal" placeholder={h.current_price ? String(Number(h.current_price)) : ""} className={`w-28 ${small}`} />}
              </td>
              <td className="pl-3">
                <input name={`mv_${h.id}`} inputMode="decimal" placeholder={h.holding_type === "CASH" ? "ยอดเงินฝากตาม Statement" : ""} className={`w-40 ${small}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกราคา"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/* ------------------------------------------------------------------ บันทึกรับเงินต้น (ครบกำหนด / Autocall)
   วันที่เดียว = วันที่เงินเข้าจริง (ไม่มีเงินระหว่างทาง) · ก่อนกดบันทึก มูลค่ายังอยู่ที่หลักทรัพย์ตัวนี้ */
export function MaturityForm({ assetId, portfolioName = "", holding, banks, cashAccounts = [], today, minDate, label, defaultAmount, defaultDate }:
  { assetId: string; portfolioName?: string; holding: Holding; banks: Bank[]; cashAccounts?: CashAcct[]; today: string; minDate: string;
    /** ใช้จากแท็บ "บันทึกรับผลตอบแทน": ชื่อปุ่ม (ปุ่มแถวตาราง) · ยอดเงินต้นที่คาดว่าจะได้รับ */ label?: string; defaultAmount?: number | null;
    /** วันที่ตั้งต้น (แท็บรอรับ: วันรับตามตาราง · แก้ได้) */ defaultDate?: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const cf = useConfirmSubmit();
  const [mode, setMode] = useState("cash");
  const [state, action, pending] = useActionState<ActionState, FormData>(recordMaturity, {});
  if (state.ok) return <Flash on={state} as="span" className="text-xs text-emerald-700" />;
  const trigger = <button onClick={() => setOpen(!open)} className={label ? ROW_BTN : activeCls("rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50")}>{label ?? "บันทึกรับเงินต้น"}</button>;
  if (!open) return trigger;
  const list = banks.filter((b) => b.currency === holding.currency);
  return present(trigger, (
    <form action={action} onSubmit={cf.guard(`บันทึกรับเงินต้นของ ${holding.name}? หลักทรัพย์นี้จะปิดเป็น "ครบกำหนด"`)}
      className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-left">{cf.dialog}
      <h2 className="font-medium text-slate-900">บันทึกรับเงินต้น · {holding.name}</h2>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="holding_id" value={holding.id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">วันที่รับเงิน<input name="date" type="date" required defaultValue={defaultDate ?? today} min={minDate} max={today} className={`mt-1 block ${small}`} /></label>
        <label className="text-xs">เงินต้นที่ได้คืน ({holding.currency})<input name="amount" required inputMode="decimal"
          defaultValue={defaultAmount != null ? String(defaultAmount) : undefined} className={`mt-1 block w-32 ${small}`} /></label>
        <label className="text-xs">ค่าธรรมเนียม<input name="fee" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
        <label className="text-xs">ภาษี<input name="tax" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <SettleModeRadios mode={mode} setMode={setMode} portfolioName={portfolioName} className="flex flex-wrap items-center gap-3" />
        {mode === "cash" && <CashAccountSelect accounts={cashAccounts} currency={holding.currency} label="บัญชี" compact />}
        {mode === "bank" && (
          <>
            <select name="bank_asset_id" required className={small}>
              <option value="">— บัญชี —</option>
              {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">ใส่วันที่เงินเข้าบัญชีจริง · บันทึกแล้วหลักทรัพย์นี้ปิดเป็น &ldquo;ครบกำหนด&rdquo; (ลบรายการได้ที่ตารางรายการของพอร์ต ถ้างวดยังไม่ปิด) · เงินต้นไม่ใช่รายได้ · ดอกเบี้ย / Coupon งวดสุดท้ายบันทึกแยกด้วยปุ่มรับปันผล / ดอกเบี้ย / Coupon</p>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">บันทึกรับเงินต้น</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      <Msg s={state} />
    </form>
  ));
}

/* ------------------------------------------------------------------ โอนเงินภายในพอร์ต (โอนสกุลเดียวกัน / แลกเงินข้ามสกุล) · อยู่ในปุ่ม "โอนเงิน" */
function MoveCashBody({ assetId, cashAccounts, today, minDate, dirSelect, onClose }:
  { assetId: string; cashAccounts: CashAcct[]; today: string; minDate: string; dirSelect: ReactNode; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(moveCash, {});
  const [from, setFrom] = useState(cashAccounts[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [got, setGot] = useState("");
  const { all: allCcy } = useCurrencies();
  const f = cashAccounts.find((a) => a.id === from);
  const targets = cashAccounts.filter((a) => a.id !== from);
  const have = new Set(cashAccounts.map((a) => a.currency));
  const toVal = to && (targets.some((a) => a.id === to) || to.startsWith("new:")) ? to : targets[0]?.id ?? `new:${allCcy.find((c) => !have.has(c)) ?? "USD"}`;
  const t = cashAccounts.find((a) => a.id === toVal);
  const src = f?.currency ?? "";
  const dst = t?.currency ?? (toVal.startsWith("new:") ? toVal.slice(4) : "");
  const same = src === dst;
  const rate = rateText(src, n(amt), dst, n(got));
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="from_currency" value={src} />
      <input type="hidden" name="to_currency" value={dst} />
      <div>
        <h3 className="font-medium text-slate-900">โอนเงิน</h3>
        <p className="text-xs text-slate-500">ภายในพอร์ต: สกุลเดียวกัน = โอนระหว่างบัญชี · คนละสกุล = แลกเงิน · ไม่ใช่รายได้หรือค่าใช้จ่าย</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {dirSelect}
        <label className={lbl}>จากบัญชี *
          <select name="from_holding_id" value={from} onChange={(e) => setFrom(e.target.value)} className={input}>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        <label className={lbl}>เข้าบัญชี *
          <CurrencySelect name="to_target" value={toVal} onChange={setTo} className={input}
            before={targets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            exclude={[...have]} valuePrefix="new:" label={(c) => `บัญชีใหม่สกุล ${c} (สร้างให้อัตโนมัติ)`} moreLabel="บัญชีใหม่สกุลอื่น…" />
        </label>
        <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>{same ? "จำนวนเงิน" : "ยอดที่ออก"} ({src}) *<input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={input} /></label>
        {!same && <label className={lbl}>ยอดที่ได้รับ ({dst}) *<input name="counter_amount" required inputMode="decimal" value={got} onChange={(e) => setGot(e.target.value)} className={input} /></label>}
        <label className={lbl}>ค่าธรรมเนียม ({src})<input name="fee" inputMode="decimal" className={input} /></label>
        <label className={`${lbl} ${same ? "md:col-span-3" : "md:col-span-2"}`}>หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">
        {rate && <>{rate} · </>}บัญชีต้นทางลด (ยอด + ค่าธรรมเนียม) · บัญชีปลายทางเพิ่ม · ยอดรวมพอร์ตเปลี่ยนเฉพาะค่าธรรมเนียม{!same && " และค่าเงิน"}
      </p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={onClose} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ เพิ่มบัญชีเงินฝากในพอร์ต */
export function AddCashAccountForm({ assetId, currency, isSetup, openingDate }:
  { assetId: string; currency: string; isSetup: boolean; openingDate: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(addCashAccount, {});
  const [ccy, setCcy] = useState(currency);
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(obtn)}>+ บัญชีเงินฝาก</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <div>
        <h3 className="font-medium text-slate-900">เพิ่มบัญชีเงินฝากในพอร์ต</h3>
        <p className="text-xs text-slate-500">สกุลเดียวกันมีได้หลายบัญชี (เช่น แยกตามอัตราดอกเบี้ย / วัตถุประสงค์) · บัญชีแรกของสกุลเป็นบัญชีหลักอัตโนมัติ</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>ชื่อบัญชี *<input name="name" required placeholder="เช่น เงินฝาก USD · Brokerage Cash" className={input} /></label>
        <label className={lbl}>สกุลเงิน
          <CurrencySelect name="currency" value={ccy} onChange={setCcy} className={input} />
        </label>
        <label className={lbl}>อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" data-money="off" className={input} /></label>
        <label className={`${lbl} md:col-span-2`}>วัตถุประสงค์<input name="purpose" placeholder="เช่น พักเงินรอลงทุน / รับคูปอง" className={input} /></label>
        {isSetup && (
          <label className={lbl}>ยอดตั้งต้น ณ {thDate(openingDate)} ({ccy})<input name="opening" inputMode="decimal" className={input} /></label>
        )}
      </div>
      {!isSetup && <p className="text-xs text-slate-500">ยอดเงินในบัญชีใหม่: ใส่ตาม Statement (อัปเดตราคา / Statement) หรือโอนเข้าจากบัญชีอื่นในพอร์ต</p>}
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "เพิ่มบัญชี"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}
