"use client";

import { useActionState, useState } from "react";
import { saveValuations, setDefaultCash, splitPfLump, type ActionState } from "../../../actions";
import { updateRecord, type RecState } from "@/lib/records";
import { SMALL_BTN, SMALL_DEL_BTN, addDays, money, numOrZero, thDate } from "@/lib/format";
import Flash from "@/components/Flash";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}

/** บันทึกยอดเงินฝากในพอร์ตตาม Statement (บัญชีเดียว) — ใช้คำสั่งเดียวกับ "อัปเดตราคา / Statement" ของพอร์ต */
export function CashStatementForm({ assetId, holdingId, currency, today, minDate }:
  { assetId: string; holdingId: string; currency: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveValuations, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name={`qty_${holdingId}`} value="0" />
      <input type="hidden" name={`cash_${holdingId}`} value="1" />
      <label className="text-sm">ยอดคงเหลือ ({currency})
        <input name={`mv_${holdingId}`} required inputMode="decimal" className={`mt-1 block w-44 ${input}`} />
      </label>
      <label className="text-sm">ยอด ณ วันที่
        <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} />
      </label>
      <p className="w-full text-xs text-slate-500">ยอดตาม Statement เป็นจุดตั้งต้นใหม่ของยอดคงเหลือ · รายการก่อน / วันเดียวกับวันที่นี้ถือว่าอยู่ในยอดนี้แล้ว</p>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอด"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

/** แก้ข้อมูลบัญชีเงินฝากในพอร์ต: ชื่อ · วัตถุประสงค์ · ดอกเบี้ย */
export function CashInfoForm({ id, name, purpose, interestRate, paths }: {
  id: string; name: string; purpose: string | null; interestRate: number | null; paths: string[];
}) {
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="table" value="investment_holdings" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">ชื่อบัญชี<input name="f_name" required defaultValue={name} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-xs text-slate-600">วัตถุประสงค์<input name="f_purpose" defaultValue={purpose ?? ""} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-xs text-slate-600">ดอกเบี้ย % ต่อปี<input name="f_interest_rate" inputMode="decimal" defaultValue={interestRate ?? ""} className={`mt-1 block w-full ${input}`} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state}>บันทึกแล้ว</Flash>
      </div>
    </form>
  );
}

/** ตั้งเป็นบัญชีหลักของสกุล */
export function SetDefaultButton({ assetId, holdingId }: { assetId: string; holdingId: string }) {
  return (
    <form action={setDefaultCash}>
      <input type="hidden" name="holding_id" value={holdingId} /><input type="hidden" name="asset_id" value={assetId} />
      <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">ตั้งเป็นบัญชีหลักของสกุลนี้</button>
    </form>
  );
}

/** แยกก้อน "รอแยกรายละเอียด" ของบัญชีนี้: ดอกเบี้ย / คูปอง / ปันผล · ค่าธรรมเนียม · โอนเข้า / ออก กับบัญชีธนาคาร
 *  บันทึกเป็นรายการในพอร์ต → ก้อนเล็กลง / หายเอง (ตกลง 12 พ.ย. 2026) */
type Line = { type: string; date: string; amount: string; tax: string; holding_id: string; bank_asset_id: string; bank_amount: string; notes: string };
const LINE_TYPES: [string, string][] = [["INTEREST", "ดอกเบี้ย"], ["COUPON", "คูปอง"], ["DIVIDEND", "ปันผล"], ["FEE", "ค่าธรรมเนียม"],
  ["TRANSFER_IN", "โอนเข้าจากบัญชีธนาคาร"], ["TRANSFER_OUT", "โอนออกไปบัญชีธนาคาร"]];
const INCOME_TYPES = ["INTEREST", "COUPON", "DIVIDEND"];
export function PfLumpSplitForm({ assetId, lump, securities, banks }: {
  assetId: string; lump: { kind: "INCOME" | "EXPENSE"; id: string; amount: number; currency: string; date: string; from: string | null };
  securities: { id: string; name: string }[]; banks: { asset_id: string; name: string; currency: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(splitPfLump, {});
  const blank = (): Line => ({ type: lump.kind === "INCOME" ? "INTEREST" : "FEE", date: lump.date, amount: "", tax: "", holding_id: "", bank_asset_id: "", bank_amount: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  // ยอดสุทธิที่แยก (+ = เงินเข้าพอร์ต) เทียบกับก้อน
  const net = lines.reduce((t, l) => t + (INCOME_TYPES.includes(l.type) ? numOrZero(l.amount) - numOrZero(l.tax)
    : l.type === "TRANSFER_IN" ? numOrZero(l.amount) : -numOrZero(l.amount)), 0);
  const left = lump.amount - (lump.kind === "INCOME" ? net : -net);
  const minDate = lump.from ? addDays(lump.from, 1) : undefined;
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="kind" value={lump.kind} />
      <input type="hidden" name="id" value={lump.id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <p className="text-slate-600">
        {lump.kind === "INCOME" ? "รายได้" : "ค่าใช้จ่าย"}รอแยก <b className="tabular-nums">{money(lump.amount, lump.currency)}</b> · ยอดเปลี่ยนตาม Statement
        {lump.from ? ` ${thDate(lump.from)} → ${thDate(lump.date)}` : ` ${thDate(lump.date)}`} ที่ยังไม่มีรายการ ·
        บันทึกเป็นรายการในพอร์ต ก้อนจะเล็กลงเอง
      </p>
      {lines.map((l, i) => {
        const bank = banks.find((b) => b.asset_id === l.bank_asset_id);
        const transfer = l.type.startsWith("TRANSFER");
        return (
          <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-4">
            <label className="text-xs text-slate-600">ประเภท
              <select value={l.type} onChange={(e) => set(i, "type", e.target.value)} className={`mt-1 block w-full ${input}`}>
                {LINE_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">วันที่
              <input type="date" required value={l.date} min={minDate} max={lump.date} onChange={(e) => set(i, "date", e.target.value)} className={`mt-1 block w-full ${input}`} />
            </label>
            <label className="text-xs text-slate-600">{transfer ? `ยอดฝั่งพอร์ต (${lump.currency})` : `ยอด (${lump.currency})`}
              <input required inputMode="decimal" value={l.amount} onChange={(e) => set(i, "amount", e.target.value)} className={`mt-1 block w-full ${input}`} />
            </label>
            {INCOME_TYPES.includes(l.type) && (
              <label className="text-xs text-slate-600">ภาษีหัก ณ ที่จ่าย
                <input inputMode="decimal" value={l.tax} onChange={(e) => set(i, "tax", e.target.value)} className={`mt-1 block w-full ${input}`} />
              </label>
            )}
            {(l.type === "COUPON" || l.type === "DIVIDEND") && (
              <label className="text-xs text-slate-600 md:col-span-2">หลักทรัพย์
                <select required value={l.holding_id} onChange={(e) => set(i, "holding_id", e.target.value)} className={`mt-1 block w-full ${input}`}>
                  <option value="">— เลือก —</option>
                  {securities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            {transfer && (
              <label className="text-xs text-slate-600 md:col-span-2">บัญชีธนาคาร
                <select required value={l.bank_asset_id} onChange={(e) => set(i, "bank_asset_id", e.target.value)} className={`mt-1 block w-full ${input}`}>
                  <option value="">— เลือก —</option>
                  {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
              </label>
            )}
            {transfer && bank && bank.currency !== lump.currency && (
              <label className="text-xs text-slate-600">ยอดฝั่งบัญชีธนาคาร ({bank.currency})
                <input required inputMode="decimal" value={l.bank_amount} onChange={(e) => set(i, "bank_amount", e.target.value)} className={`mt-1 block w-full ${input}`} />
              </label>
            )}
            <label className="text-xs text-slate-600 md:col-span-2">หมายเหตุ
              <input value={l.notes} onChange={(e) => set(i, "notes", e.target.value)} className={`mt-1 block w-full ${input}`} />
            </label>
            {lines.length > 1 && (
              <div className="flex items-end"><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className={SMALL_DEL_BTN}>ลบ</button></div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className={SMALL_BTN}>+ เพิ่มบรรทัด</button>
        <span className={`tabular-nums ${left < -0.005 ? "text-red-700" : "text-slate-600"}`}>เหลือรอแยก {money(left, lump.currency)}</span>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}
