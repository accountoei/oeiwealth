"use client";

import { useActionState, useState } from "react";
import {
  addHolding, recordFx, recordMaturity, recordTx, saveValuations, transferMoney, type ActionState,
} from "../actions";
import { CURRENCIES, HOLDING_TYPE_LABEL, money, qty, thDate } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const lbl = "block text-sm text-slate-700";

export type Holding = { id: string; name: string; symbol: string | null; holding_type: string; currency: string;
  quantity: number; current_price: number | null; status: string };
export type Bank = { asset_id: string; name: string; currency: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}
const n = (s: string) => Number(s.replace(/,/g, "")) || 0;

/* ------------------------------------------------------------------ ยอดตั้งต้น */
export function OpeningHoldingForm({ assetId, currency, openingDate, isSetup }:
  { assetId: string; currency: string; openingDate: string; isSetup: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addHolding, {});
  const [ccy, setCcy] = useState(currency);
  const [type, setType] = useState("EQUITY");
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>+ ยอดตั้งต้น (ถือก่อน Go-live)</button>;
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <div>
        <h3 className="font-medium text-slate-900">หลักทรัพย์ที่ถืออยู่ก่อน Go-live</h3>
        <p className="text-xs text-slate-500">ยอด ณ สิ้นวัน {thDate(openingDate)} · ต้นทุนเฉลี่ยใช้คำนวณกำไร/ขาดทุน · ราคาตลาด ณ วันนั้นใช้เป็นมูลค่าตั้งต้น</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>ประเภท
          <select name="holding_type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {Object.entries(HOLDING_TYPE_LABEL).filter(([v]) => v !== "CASH").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={lbl}>ชื่อ *<input name="name" required placeholder="เช่น ปตท. / K-FIXED" className={input} /></label>
        <label className={lbl}>สัญลักษณ์<input name="symbol" placeholder="เช่น PTT" className={input} /></label>
        <label className={lbl}>สกุลเงิน
          <select name="currency" value={ccy} onChange={(e) => setCcy(e.target.value)} className={input}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl}>จำนวนหน่วย *<input name="quantity" required inputMode="decimal" className={input} /></label>
        <label className={lbl}>ต้นทุนเฉลี่ยต่อหน่วย ({ccy}) *<input name="price" required inputMode="decimal" className={input} /></label>
        <label className={lbl}>ราคาตลาด ณ {thDate(openingDate)}<input name="market_price" inputMode="decimal" placeholder="ไม่ใส่ = ใช้ราคาทุน" className={input} /></label>
        {(type === "BOND" || type === "FCN" || type === "STRUCTURED_PRODUCT") && (
          <label className={lbl}>วันครบกำหนด<input name="maturity_date" type="date" className={input} /></label>
        )}
        {ccy !== "THB" && (
          <>
            <label className={lbl}>ต้นทุนรวมเป็นบาท<input name="cost_base_thb" inputMode="decimal" className={input} /></label>
            <label className={lbl}>หรือ FX ตอนซื้อ (บาท/{ccy})<input name="fx_rate" inputMode="decimal" placeholder="ไม่ใส่ทั้งคู่ = อัตรา ธปท. ณ วันตั้งต้น" className={input} /></label>
          </>
        )}
        <label className={`${lbl} md:col-span-3`}>หมายเหตุ {!isSetup && "(เหตุผล · จำเป็น เพราะระบบ LIVE แล้ว)"}
          <input name="notes" required={!isSetup} className={input} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอดตั้งต้น"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ + รายการ */
const TX_TYPES: [string, string][] = [
  ["BUY", "ซื้อ"], ["SELL", "ขาย"], ["DIVIDEND", "ปันผล"], ["INTEREST", "ดอกเบี้ย"], ["COUPON", "Coupon"],
  ["REDEMPTION", "ไถ่ถอน / ขายคืนกองทุน"], ["FEE", "ค่าธรรมเนียม"], ["TAX", "ภาษี"], ["ADJUSTMENT", "ปรับปรุงจำนวน / เงินสด"],
];

export function TxForm({ assetId, portfolioCurrency, holdings, banks, today, minDate }: {
  assetId: string; portfolioCurrency: string; holdings: Holding[]; banks: Bank[]; today: string; minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(recordTx, {});
  const [type, setType] = useState("BUY");
  const [holdingId, setHoldingId] = useState("");
  const [newCcy, setNewCcy] = useState(portfolioCurrency);
  const [q, setQ] = useState(""); const [p, setP] = useState(""); const [amt, setAmt] = useState("");
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
  const gross = qp ? n(q) * n(p) : n(amt);
  const net = type === "BUY" ? gross + n(fee) : ["FEE", "TAX"].includes(type) ? gross : gross - n(fee) - n(tax);
  const bankList = banks.filter((b) => b.currency === ccy);
  const holdingOptions = type === "BUY" ? securities : optionalHolding ? active : securities;
  const isCashAdj = type === "ADJUSTMENT" && (!h || h.holding_type === "CASH");

  if (!open) return <button onClick={() => setOpen(true)} className={btn}>+ รายการ</button>;

  const summary: string[] = [];
  if (type === "BUY") summary.push(mode === "bank" ? `เงินออกจากบัญชีธนาคาร ${money(net, ccy)} (โอนเข้าพอร์ต)` : `หักเงินสดในพอร์ต ${money(net, ccy)}`);
  if (["SELL", "REDEMPTION"].includes(type)) summary.push(mode === "bank" ? `เงินเข้าบัญชีธนาคาร ${money(net, ccy)}` : `เพิ่มเงินสดในพอร์ต ${money(net, ccy)}`);
  if (["DIVIDEND", "INTEREST", "COUPON"].includes(type)) {
    summary.push(`บันทึกรายได้ ${money(gross, ccy)}${n(tax) ? ` (ภาษี ${money(n(tax))})` : ""}`);
    summary.push(mode === "bank" ? `เงินเข้าบัญชีธนาคาร ${money(net, ccy)}` : `เพิ่มเงินสดในพอร์ต ${money(net, ccy)}`);
  }
  if (["FEE", "TAX"].includes(type)) summary.push(`หักเงินสดในพอร์ต ${money(gross, ccy)} (ลดผลตอบแทน ไม่ใช่ค่าใช้จ่ายครอบครัว)`);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">บันทึกรายการลงทุน</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>ประเภท
          <select name="type" value={type} onChange={(e) => { setType(e.target.value); setHoldingId(""); setMode("cash"); }} className={input}>
            {TX_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={`${lbl} md:col-span-2`}>หลักทรัพย์ {needsHolding && "*"}
          <select name="holding_id" value={holdingId} onChange={(e) => setHoldingId(e.target.value)} required={needsHolding} className={input}>
            <option value="">{optionalHolding ? `— เงินสดในพอร์ต / ทั้งพอร์ต (${portfolioCurrency}) —` : "— เลือก —"}</option>
            {holdingOptions.map((x) => (
              <option key={x.id} value={x.id}>{x.name}{x.symbol ? ` (${x.symbol})` : ""} · ถือ {qty(x.quantity)} · {x.currency}</option>
            ))}
            {type === "BUY" && <option value="__new__">+ หลักทรัพย์ตัวใหม่</option>}
          </select>
        </label>
        {isNew && (
          <>
            <label className={lbl}>ประเภทหลักทรัพย์
              <select name="new_holding_type" defaultValue="EQUITY" className={input}>
                {Object.entries(HOLDING_TYPE_LABEL).filter(([v]) => v !== "CASH").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>ชื่อ *<input name="new_name" required className={input} /></label>
            <label className={lbl}>สัญลักษณ์<input name="new_symbol" className={input} /></label>
            <label className={lbl}>สกุลเงิน
              <select name="new_currency" value={newCcy} onChange={(e) => setNewCcy(e.target.value)} className={input}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className={lbl}>วันครบกำหนด (ถ้ามี)<input name="new_maturity_date" type="date" className={input} /></label>
          </>
        )}
        <label className={lbl}>วันที่รายการ *
          <input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} />
        </label>
        {qp && (
          <>
            <label className={lbl}>จำนวนหน่วย *<input name="quantity" required inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} className={input} /></label>
            <label className={lbl}>ราคาต่อหน่วย ({ccy}) *<input name="price" required inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} className={input} /></label>
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
        {hasFee && type !== "ADJUSTMENT" && (
          <label className={lbl}>ค่าธรรมเนียม<input name="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={input} /></label>
        )}
        {hasTax && (
          <label className={lbl}>ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className={input} /></label>
        )}
        {canBank && (
          <div className={`${lbl} md:col-span-3`}>
            {type === "BUY" ? "จ่ายเงินจาก" : "รับเงินเข้า"}
            <div className="mt-1 flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" name="settle_mode" value="cash" checked={mode === "cash"} onChange={() => setMode("cash")} /> เงินสดในพอร์ต</label>
              <label className="flex items-center gap-2"><input type="radio" name="settle_mode" value="bank" checked={mode === "bank"} onChange={() => setMode("bank")} /> บัญชีธนาคารโดยตรง</label>
            </div>
          </div>
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
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ โอนเงิน */
export function TransferForm({ assetId, currency, banks, today, minDate }:
  { assetId: string; currency: string; banks: Bank[]; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(transferMoney, {});
  const [dir, setDir] = useState("IN");
  const list = banks.filter((b) => b.currency === currency);
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>โอนเงิน ธนาคาร ↔ พอร์ต</button>;
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">โอนเงิน (Transfer Money)</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>ทิศทาง
          <select name="direction" value={dir} onChange={(e) => setDir(e.target.value)} className={input}>
            <option value="IN">ธนาคาร → พอร์ต</option><option value="OUT">พอร์ต → ธนาคาร</option>
          </select>
        </label>
        <label className={lbl}>บัญชีธนาคาร ({currency}) *
          <select name="bank_asset_id" required className={input}>
            <option value="">— เลือก —</option>
            {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
          {list.length === 0 && <span className="mt-1 block text-xs text-amber-700">ไม่มีบัญชีสกุล {currency} (ต้องสกุลเดียวกับพอร์ต)</span>}
        </label>
        <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className={lbl}>ค่าธรรมเนียม (หักฝั่งผู้ส่ง)<input name="fee" inputMode="decimal" className={input} /></label>
        <label className={lbl}>รายละเอียด<input name="description" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">
        {dir === "IN"
          ? "ธนาคารลด (จำนวน + ค่าธรรมเนียม) · พอร์ตรับเงินระหว่างทางจนกว่าจะมี Statement เงินสด · ค่าธรรมเนียม = ค่าใช้จ่ายค่าธรรมเนียมธนาคาร"
          : "พอร์ตลด (จำนวน + ค่าธรรมเนียม) · ธนาคารรับจำนวนเต็ม · ค่าธรรมเนียม = FEE ของพอร์ต (ลดผลตอบแทน)"}
      </p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกการโอน"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ แลกเงินในพอร์ต */
export function FxForm({ assetId, cashCurrencies, today, minDate }:
  { assetId: string; cashCurrencies: string[]; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(recordFx, {});
  const [from, setFrom] = useState(cashCurrencies[0] ?? "THB");
  const [to, setTo] = useState(cashCurrencies.find((c) => c !== (cashCurrencies[0] ?? "THB")) ?? (from === "THB" ? "USD" : "THB"));
  const [amt, setAmt] = useState("");
  const [got, setGot] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>แลกเงินในพอร์ต</button>;
  const rate = n(amt) > 0 && n(got) > 0 ? (from === "THB" ? n(amt) / n(got) : to === "THB" ? n(got) / n(amt) : n(got) / n(amt)) : null;
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">แลกเงินภายในพอร์ต (FX Exchange)</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>จากเงินสดสกุล *
          <select name="currency" value={from} onChange={(e) => setFrom(e.target.value)} className={input}>
            {cashCurrencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl}>เป็นสกุล *
          <select name="counter_currency" value={to} onChange={(e) => setTo(e.target.value)} className={input}>
            {CURRENCIES.filter((c) => c !== from).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl}>ยอดที่แลกออก ({from}) *<input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={input} /></label>
        <label className={lbl}>ยอดที่ได้รับ ({to}) *<input name="counter_amount" required inputMode="decimal" value={got} onChange={(e) => setGot(e.target.value)} className={input} /></label>
        <label className={lbl}>ค่าธรรมเนียม ({from})<input name="fee" inputMode="decimal" className={input} /></label>
        <label className={`${lbl} md:col-span-3`}>หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">
        {rate != null && <>อัตราที่ได้จริง {from === "THB" || to === "THB" ? `1 ${from === "THB" ? to : from} = ${rate.toFixed(4)} THB` : `1 ${from} = ${rate.toFixed(6)} ${to}`} · </>}
        เงินสด {from} ในพอร์ตลด (ยอด + ค่าธรรมเนียม) · เงินสด {to} เพิ่ม (สร้างให้อัตโนมัติถ้ายังไม่มี) · ไม่ใช่รายได้หรือค่าใช้จ่าย
      </p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกการแลกเงิน"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ อัปเดตราคา (Statement) */
export function ValuationsForm({ assetId, holdings, today, minDate }:
  { assetId: string; holdings: Holding[]; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveValuations, {});
  const list = holdings.filter((h) => h.status === "ACTIVE");
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>อัปเดตราคา / Statement</button>;
  return (
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
              <td className="text-right tabular-nums">{h.holding_type === "CASH" ? "-" : qty(h.quantity)}</td>
              <td className="pl-3">
                {h.holding_type === "CASH" ? <span className="text-xs text-slate-400">—</span> :
                  <input name={`price_${h.id}`} inputMode="decimal" placeholder={h.current_price ? String(Number(h.current_price)) : ""} className={`w-28 ${small}`} />}
              </td>
              <td className="pl-3">
                <input name={`mv_${h.id}`} inputMode="decimal" placeholder={h.holding_type === "CASH" ? "ยอดเงินสดตาม Statement" : ""} className={`w-40 ${small}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกราคา"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ ครบกำหนด */
export function MaturityForm({ assetId, holding, banks, today, minDate }:
  { assetId: string; holding: Holding; banks: Bank[]; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("cash");
  const [state, action, pending] = useActionState<ActionState, FormData>(recordMaturity, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-slate-700 underline">ครบกำหนด</button>;
  const list = banks.filter((b) => b.currency === holding.currency);
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="holding_id" value={holding.id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">วันครบกำหนด<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} /></label>
        <label className="text-xs">เงินต้นที่ได้คืน ({holding.currency})<input name="amount" required inputMode="decimal" className={`mt-1 block w-32 ${small}`} /></label>
        <label className="text-xs">ค่าธรรมเนียม<input name="fee" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
        <label className="text-xs">ภาษี<input name="tax" inputMode="decimal" className={`mt-1 block w-24 ${small}`} /></label>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="radio" name="settle_mode" value="cash" checked={mode === "cash"} onChange={() => setMode("cash")} /> เก็บในพอร์ต</label>
        <label className="flex items-center gap-1"><input type="radio" name="settle_mode" value="bank" checked={mode === "bank"} onChange={() => setMode("bank")} /> เข้าบัญชีธนาคาร</label>
        {mode === "bank" && (
          <>
            <select name="bank_asset_id" required className={small}>
              <option value="">— บัญชี —</option>
              {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
            <label>วันเงินเข้าจริง<input name="settlement_date" type="date" className={`ml-1 ${small}`} /></label>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">เงินต้นไม่ใช่รายได้ · Coupon งวดสุดท้ายให้บันทึกแยกเป็นรายการ Coupon</p>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      <Msg s={state} />
    </form>
  );
}
