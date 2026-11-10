"use client";

import { useActionState, useId, useState, type ChangeEvent } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { useRowPanel } from "@/components/RowPanel";
import { editBenefitReceipt, payBooklet, receiveBenefit, receiveLines, type ActionState } from "../actions";
import { SMALL_BTN, money, numOrZero, thDate } from "@/lib/format";
import BalanceGuard from "@/components/BalanceGuard";
import BankOptions from "@/components/BankOptions";
import Flash from "@/components/Flash";
import Modal from "@/components/Modal";
import UndoButton from "@/components/UndoButton";

// ปุ่ม "บันทึกรับ" + "บันทึกจ่าย" เหนือตารางเบี้ยและผลประโยชน์ (ตกลง 8 พ.ย. 2026 · แบบเงินกู้ แทนปุ่มรายแถว)
//   เลือกวันที่ → เติมงวดที่ครบถึงวันนั้น (อย่างน้อยงวดค้างล่าสุด หรืองวดถัดไป) ทุกส่วนของเล่ม · แก้ยอดเองได้ · ช่องว่าง = ไม่บันทึกงวดนั้น
//   กดแถวรับล่าสุด → แก้ / ลบ (ReceiptEdit)

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;

type Bank = { asset_id: string; name: string; currency: string };
type Card = { id: string; label: string; currency: string };
type Person = { id: string; name: string };

/** งวดที่ยังค้าง (เบี้ย / ผลประโยชน์) ของทุกส่วนในเล่ม · เรียงวันครบกำหนด → ส่วน */
export type OpenLine = {
  policyId: string; lineId: string;
  /** ชื่อส่วนของเล่ม (ชีวิต / สุขภาพ …) · กรมธรรม์ปกติ = null */ part: string | null;
  /** ข้อความของงวด: เบี้ย = รายการค่าใช้จ่าย ("เบี้ยประกัน … งวดที่ 3") · ผลประโยชน์ = ชนิด (เงินคืน / ครบสัญญา) */ label: string;
  no: number | null; due: string; remaining: number; currency: string;
  /** กรมธรรม์ของงวดนี้มีมูลค่าเวนคืน > 0 → ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวด */ cv?: boolean;
};

const amt = (v: number) => (v > 0.005 ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
/** วันที่เติมอย่างน้อย (แบบเงินกู้): งวดล่าสุดที่ครบถึงวันนี้ · ไม่มี = งวดถัดไป */
const fillFrom = (lines: OpenLine[], today: string) => (lines.filter((x) => x.due <= today).at(-1) ?? lines[0])?.due ?? today;
/** งวดที่ครบถึงวันนั้น (ก่อนวันเติมอย่างน้อย = ถึงวันนั้น) */
const upTo = (d: string, from: string) => (d && d >= from ? d : from);
/** "งวดที่ 3–4" · ไม่ติดกัน = "งวดที่ 3, 5" */
const noText = (nos: number[]) => {
  const xs = [...new Set(nos)].sort((a, b) => a - b);
  if (!xs.length) return "";
  return `งวดที่ ${xs.length > 1 && xs.every((x, i) => i === 0 || x === xs[i - 1] + 1) ? `${xs[0]}–${xs.at(-1)}` : xs.join(", ")}`;
};

function Msg({ s }: { s: ActionState }) {
  return <>{s.error && <span className="text-sm text-red-600">{s.error}</span>}<Flash on={s} as="span" className="text-sm text-emerald-700" /></>;
}

/** ตารางกรอกยอดต่องวด (ใช้ทั้งจ่ายเบี้ย / รับผลประโยชน์) · แสดงงวดที่ครบถึงวันที่ + งวดที่กรอกแล้ว + งวดถัดไปที่กดเพิ่ม */
function LineTable({ lines, vals, onAmt, lim, more, setMore, head, foot }: {
  lines: OpenLine[]; vals: Record<string, string>; onAmt: (id: string, e: ChangeEvent<HTMLInputElement>) => void; lim: string;
  more: number; setMore: (n: number) => void; head: string; foot: string;
}) {
  const due = lines.filter((x) => x.due <= lim);
  const later = lines.filter((x) => x.due > lim);
  const shownLater = later.filter((x, i) => i < more || (vals[x.lineId] ?? "").trim() !== "");
  const shown = [...due, ...shownLater];
  const nextLater = later.find((x) => !shownLater.includes(x));
  // คอลัมน์ "ส่วน" เฉพาะเมื่อมีงวดของหลายส่วนในเล่ม
  const parts = new Set(lines.map((x) => x.part)).size > 1;
  const total = lines.reduce((t, x) => t + numOrZero(vals[x.lineId]), 0);
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr className="border-b border-slate-100">
            {parts && <th className="py-1.5">ส่วน</th>}<th className="py-1.5">งวด</th><th>ครบกำหนด</th><th className="text-right">ค้าง</th><th className="pl-3 text-right">{head}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.length === 0 && <tr><td colSpan={parts ? 5 : 4} className="py-3 text-center text-slate-500">ไม่มีงวดที่ครบถึงวันที่นี้ — กด &ldquo;+ งวดถัดไป&rdquo;</td></tr>}
          {shown.map((x) => (
            <tr key={x.lineId}>
              {parts && <td className="py-1.5">{x.part}</td>}
              <td className="py-1.5">{x.no != null ? `งวดที่ ${x.no}` : x.label}</td>
              <td className={`whitespace-nowrap py-1.5 ${x.due > lim ? "text-slate-500" : ""}`}>{thDate(x.due)}</td>
              <td className="py-1.5 text-right tabular-nums">{money(x.remaining)}</td>
              <td className="py-1.5 pl-3 text-right">
                <input inputMode="decimal" value={vals[x.lineId] ?? ""} aria-label={`${head} ${x.no != null ? `งวดที่ ${x.no}` : x.label} ${thDate(x.due)}`}
                  onChange={(e) => onAmt(x.lineId, e)} className={`w-36 text-right ${small}`} />
              </td>
            </tr>
          ))}
          <tr className="font-medium">
            <td colSpan={parts ? 4 : 3} className="py-1.5">{foot}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{money(total, lines[0]?.currency)}</td>
          </tr>
        </tbody>
      </table>
      {nextLater && (
        // งวดถัดไปของทุกส่วนที่ครบวันเดียวกัน (เล่มที่มีสัญญาเพิ่มเติม) เพิ่มพร้อมกัน
        <button type="button" onClick={() => setMore(later.findLastIndex((x) => x.due === nextLater.due) + 1)} className={SMALL_BTN}>+ งวดถัดไป ({thDate(nextLater.due)})</button>
      )}
    </div>
  );
}

/**
 * เลือกวันที่ → เติมยอดค้างของงวดที่ครบถึงวันนั้น (แบบเงินกู้)
 *   ยังไม่ได้แก้ยอดเอง → เปลี่ยนวันที่แล้วเติมใหม่ · แก้แล้ว = ยอดเดิม (กด "ตามงวด" เพื่อเติมใหม่)
 *   pick = กรองงวดที่เติมให้ (เช่น ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวด)
 */
function useLineFill(lines: OpenLine[], today: string, pick: (xs: OpenLine[]) => OpenLine[] = (xs) => xs) {
  const from = fillFrom(lines, today);
  const fill = (d: string, p = pick) => {
    const ids = new Set(p(lines.filter((x) => x.due <= upTo(d, from))).map((x) => x.lineId));
    return Object.fromEntries(lines.map((x) => [x.lineId, ids.has(x.lineId) ? amt(x.remaining) : ""]));
  };
  const [date, setDate] = useState(today);
  const [vals, setVals] = useState<Record<string, string>>(() => fill(today));
  // ผู้ใช้พิมพ์ยอดเองแล้วหรือยัง (ไม่นับ event ที่ NumberInputs ส่งเองตอนจัดรูปแบบตัวเลข: isTrusted = false)
  const [typed, setTyped] = useState(false);
  const [more, setMore] = useState(0);
  const onDate = (d: string) => { setDate(d); if (!typed && d) setVals(fill(d)); };
  const onAmt = (id: string, e: ChangeEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isTrusted) setTyped(true);
    const v = e.target.value;
    setVals((s) => ({ ...s, [id]: v }));
  };
  const refill = (p = pick) => { setTyped(false); setVals(fill(date, p)); };
  const lim = upTo(date, from);
  const filled = lines.filter((x) => (vals[x.lineId] ?? "").trim() !== "");
  const total = filled.reduce((t, x) => t + numOrZero(vals[x.lineId]), 0);
  const range = (xs: OpenLine[]) => {
    const parts = [...new Set(xs.map((x) => x.part).filter(Boolean))];
    return [noText(xs.filter((x) => x.no != null).map((x) => x.no as number)), parts.length > 1 ? `(${parts.join(" + ")})` : ""].filter(Boolean).join(" ");
  };
  return { date, onDate, vals, onAmt, refill, lim, more, setMore, filled, total, range, due: lines.filter((x) => x.due <= lim) };
}

/** ปุ่ม "บันทึกจ่าย" เหนือตาราง: จ่ายเบี้ยหลายงวด / ทุกส่วนของเล่มในครั้งเดียว (บัญชี / บัตรเดียวกัน = หน้าบัญชีแสดงยอดรวมแถวเดียว) */
export function PayLinesForm({ lines, group, banks, cards, persons, defaultPerson, defaultPay = "", today, minDate }: {
  lines: OpenLine[]; group: string; banks: Bank[]; cards: Card[]; persons: Person[]; defaultPerson?: string | null;
  /** จ่ายเบี้ยจาก (ค่าตั้งต้นของกรมธรรม์): "a:<บัญชี>" / "c:<บัตร>" */ defaultPay?: string; today: string; minDate?: string | null;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "md" });
  const currency = lines[0]?.currency ?? "THB";
  const defBank = defaultPay.startsWith("a:") && banks.some((b) => b.asset_id === defaultPay.slice(2) && b.currency === currency) ? defaultPay.slice(2) : undefined;
  const defCard = defaultPay.startsWith("c:") && cards.some((c) => c.id === defaultPay.slice(2) && c.currency === currency) ? defaultPay.slice(2) : undefined;
  const [via, setVia] = useState(defCard ? "card" : defBank || banks.length ? "bank" : cards.length ? "card" : "cash");
  const f = useLineFill(lines, today);
  const [state, action, pending] = useActionState<ActionState, FormData>(payBooklet, {});
  if (!lines.length) return <button type="button" disabled title="ไม่มีงวดเบี้ยที่ต้องจ่าย" className={btn}>บันทึกจ่าย</button>;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(btn)}>บันทึกจ่าย</button>;
  if (!open) return trigger;
  const rows = f.filled.map((x) => ({ policy_id: x.policyId, line_id: x.lineId, label: x.label, amount: f.vals[x.lineId], currency: x.currency }));
  return present(trigger, (
    <form action={action} className="space-y-4 text-left">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <input type="hidden" name="group" value={group} />
      <input type="hidden" name="amount" value={f.total.toFixed(2)} />
      <div>
        <h3 className="font-medium text-slate-900">บันทึกจ่ายเบี้ย</h3>
        <p className="text-xs text-slate-500">เลือกวันที่จ่าย → เติมยอดค้างของงวดที่ครบถึงวันนั้นให้ (แก้ยอดเองได้ · ช่องว่าง = ไม่จ่ายงวดนั้น) · ระบบบันทึกแยกทีละงวด
          {new Set(lines.map((x) => x.part)).size > 1 && " / ทีละส่วน (ภาษี / IRR คิดแยกถูก)"} · จ่ายจากบัญชี / บัตรเดียวกัน หน้าบัญชีและบัตรแสดงยอดรวมแถวเดียว</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่จ่าย *<input name="date" type="date" required value={f.date} onChange={(e) => f.onDate(e.target.value)} min={minDate || undefined} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจาก
          <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={input}>
            <option value="bank">บัญชีธนาคาร</option><option value="card">บัตรเครดิต</option><option value="cash">เงินสด</option>
          </select>
        </label>
        {via === "bank" && <label className="text-sm">บัญชี *<select name="bank_asset_id" required defaultValue={defBank} className={input}>
          <BankOptions banks={banks.filter((b) => b.currency === currency)} /></select></label>}
        {via === "card" && <label className="text-sm">บัตร *<select name="card_id" required defaultValue={defCard} className={input}>
          {cards.filter((c) => c.currency === currency).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {via === "cash" && <label className="text-sm">ผู้จ่าย *<select name="person_id" required defaultValue={defaultPerson ?? undefined} className={input}>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      </div>
      <p className="text-xs text-slate-500">{f.lim > f.date ? "งวดถัดไป" : "ครบถึงวันที่จ่าย"}: {f.due.length ? `${f.range(f.due)} · ${money(f.due.reduce((t, x) => t + x.remaining, 0))}` : "ไม่มีงวด"}
        {" "}· <button type="button" onClick={() => f.refill()} className="text-blue-700 hover:underline">ตามงวด</button></p>
      <LineTable lines={lines} vals={f.vals} onAmt={f.onAmt} lim={f.lim} more={f.more} setMore={f.setMore} head="ยอดที่จ่าย" foot="รวมจ่าย" />
      <label className="block text-sm">หมายเหตุ<input name="notes" className={input} /></label>
      {via === "cash" && <p className="text-xs text-slate-500">เงินสด: บันทึกทีละงวด (ไม่มีเงินออกจากบัญชีให้รวมแถว)</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || f.total <= 0} className={btn}>{pending ? "กำลังบันทึก…" : `บันทึกจ่าย ${money(f.total, currency)}`}</button>
        <BalanceGuard />
        <Msg s={state} />
      </div>
    </form>
  ));
}

/** ช่องร่วมของการรับ: เข้าบัญชี · เป็นการ (ปิดกรมธรรม์) · ผู้รับเงิน · หมายเหตุ · ถอนจากมูลค่าเวนคืน */
function RecvFields({ currency, banks, persons, hasCashValue, cashValue, canClose, outcome, setOutcome, useCv, setUseCv, lines }: {
  currency: string; banks: Bank[]; persons: Person[]; hasCashValue: boolean; cashValue?: number | null; canClose: boolean;
  outcome: string; setOutcome: (v: string) => void; useCv: boolean; setUseCv: (v: boolean) => void; lines?: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">เข้าบัญชี *<select name="bank_asset_id" required className={input}><BankOptions banks={banks.filter((b) => b.currency === currency)} /></select></label>
        {canClose && (
          <label className="text-sm">เป็นการ
            <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={input}>
              <option value="">รับผลประโยชน์ (กรมธรรม์ยังมีผล)</option>
              <option value="MATURED">ครบสัญญา (ปิดกรมธรรม์)</option>
              <option value="SURRENDERED">เวนคืน (ปิดกรมธรรม์)</option>
              <option value="CLAIMED">สินไหมมรณกรรม / เคลมจบ (ปิดกรมธรรม์)</option>
            </select>
          </label>
        )}
        <label className="text-sm">ผู้รับเงิน
          <select name="person_id" defaultValue="" className={input}>
            <option value="">{hasCashValue ? "ตามเจ้าของมูลค่าเวนคืน" : "ผู้จ่ายเบี้ย"}</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" className={input} /></label>
        {hasCashValue && (
          <label className="flex items-start gap-2 text-sm md:col-span-3">
            <input type="hidden" name="use_cash_value" value="off" />
            <input type="checkbox" name="use_cash_value" value="on" checked={useCv} onChange={(e) => setUseCv(e.target.checked)} className="mt-1" />
            <span>ถอนจากมูลค่าเวนคืนก่อน{cashValue != null && ` (ตอนนี้ ${money(cashValue, currency)})`} — ส่วนที่เกินนับเป็นรายได้
              <span className="block text-xs text-slate-500">ไม่ติ๊ก = นับเป็นรายได้ทั้งหมด (เช่น บำนาญ / สินไหมที่ไม่เกี่ยวกับมูลค่าเวนคืน)
                {lines && " · ติ๊ก = ถอนได้ครั้งละ 1 งวด (มูลค่าเวนคืนลดทีละงวด)"}</span></span>
          </label>
        )}
      </div>
      {outcome && <p className="text-xs text-amber-700">ปิดกรมธรรม์{lines && " หลังรับงวดสุดท้ายในรายการ"}: สถานะเปลี่ยนเป็น &ldquo;{outcome === "MATURED" ? "ครบสัญญา" : outcome === "SURRENDERED" ? "เวนคืนแล้ว" : "เคลมจบแล้ว"}&rdquo;
        {hasCashValue && " · มูลค่าเวนคืนที่เหลือเป็น 0"} · งวดเบี้ยที่ยังไม่จ่ายไม่ต้องจ่ายแล้ว</p>}
    </>
  );
}

/** รับผลประโยชน์ตามงวด: หลายงวดในครั้งเดียว · ถอนจากมูลค่าเวนคืน = งวดเดียวต่อกรมธรรม์ (มูลค่าเวนคืนลดทีละงวด) */
function LinesReceive({ lines, currency, banks, persons, hasCashValue, cashValue, today, canClose, minDate }: {
  lines: OpenLine[]; currency: string; banks: Bank[]; persons: Person[]; hasCashValue: boolean; cashValue?: number | null; today: string; canClose: boolean; minDate?: string | null;
}) {
  const [useCv, setUseCvState] = useState(true);
  const [outcome, setOutcome] = useState("");
  const cvOn = (on: boolean) => on && lines.some((x) => x.cv);
  // ถอนจากมูลค่าเวนคืน: เติมงวดเก่าสุดของกรมธรรม์ที่มีมูลค่าเวนคืนงวดเดียว (กรมธรรม์อื่น / ไม่ถอน = ทุกงวดที่ครบ)
  const pickFor = (on: boolean) => (xs: OpenLine[]) => !cvOn(on) ? xs : xs.filter((x, i) => !x.cv || xs.findIndex((y) => y.cv && y.policyId === x.policyId) === i);
  const f = useLineFill(lines, today, pickFor(useCv));
  const setUseCv = (v: boolean) => { setUseCvState(v); f.refill(pickFor(v)); };
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveLines, {});
  const clash = cvOn(useCv) && new Set(f.filled.filter((x) => x.cv).map((x) => x.policyId)).size < f.filled.filter((x) => x.cv).length;
  const rows = f.filled.map((x) => ({ policy_id: x.policyId, line_id: x.lineId, label: `${x.part ? `${x.part} · ` : ""}${x.label} ${thDate(x.due)}`, amount: f.vals[x.lineId] }));
  return (
    <form action={action} className="space-y-4 text-left">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <p className="text-xs text-slate-500">เลือกวันที่ได้รับ → เติมยอดค้างของงวดที่ครบถึงวันนั้นให้ (แก้ยอดเองได้ · ช่องว่าง = ไม่รับงวดนั้น) · รับก่อนครบกำหนดได้ (แถวเงินรับอยู่ตามวันที่รับจริง)</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required value={f.date} onChange={(e) => f.onDate(e.target.value)} min={minDate || undefined} max={today} className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">{f.lim > f.date ? "งวดถัดไป" : "ครบถึงวันที่ได้รับ"}: {f.due.length ? `${f.due.length} งวด · ${money(f.due.reduce((t, x) => t + x.remaining, 0))}` : "ไม่มีงวด"}
        {" "}· <button type="button" onClick={() => f.refill()} className="text-blue-700 hover:underline">ตามงวด</button></p>
      <LineTable lines={lines} vals={f.vals} onAmt={f.onAmt} lim={f.lim} more={f.more} setMore={f.setMore} head="ยอดที่ได้รับ" foot="รวมรับ" />
      {clash && <p className="text-sm text-amber-700">ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวดต่อกรมธรรม์ — ใส่ยอดงวดเดียวแล้วบันทึก จากนั้นกด &ldquo;บันทึกรับ&rdquo; อีกครั้งสำหรับงวดถัดไป (หรือไม่ติ๊กถอนจากมูลค่าเวนคืน)</p>}
      <RecvFields currency={currency} banks={banks} persons={persons} hasCashValue={hasCashValue} cashValue={cashValue} canClose={canClose}
        outcome={outcome} setOutcome={setOutcome} useCv={useCv} setUseCv={setUseCv} lines />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || f.total <= 0 || clash} className={btn}>{pending ? "กำลังบันทึก…" : `บันทึกรับ ${money(f.total, currency)}`}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/** รับเงินก้อนที่ไม่ผูกงวด: ครบสัญญา / เวนคืน / สินไหม */
function LumpReceive({ policyId, currency, banks, persons, hasCashValue, cashValue, today, canClose, minDate }: {
  policyId: string; currency: string; banks: Bank[]; persons: Person[]; hasCashValue: boolean; cashValue?: number | null; today: string; canClose: boolean; minDate?: string | null;
}) {
  const [useCv, setUseCv] = useState(true);
  const [outcome, setOutcome] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveBenefit, {});
  return (
    <form action={action} className="space-y-4 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      <p className="text-xs text-slate-500">เงินที่ไม่อยู่ในตารางผลประโยชน์ เช่น เวนคืน / สินไหมมรณกรรม / เงินครบสัญญาที่ไม่ได้ตั้งงวดไว้</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">ยอดที่ได้รับ ({currency}) *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} min={minDate || undefined} max={today} className={input} /></label>
      </div>
      <RecvFields currency={currency} banks={banks} persons={persons} hasCashValue={hasCashValue} cashValue={cashValue} canClose={canClose}
        outcome={outcome} setOutcome={setOutcome} useCv={useCv} setUseCv={setUseCv} />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/**
 * ปุ่ม "บันทึกรับ" เหนือตาราง: 2 แบบในหน้าต่างเดียว — รับผลประโยชน์ตามงวด / รับเงินก้อน (ครบสัญญา / เวนคืน / สินไหม)
 *   closed = กรมธรรม์ปิดแล้ว (ครบสัญญา / เวนคืน / เคลมจบ / ยกเลิก · ตกลง 9 พ.ย. 2026) → ปุ่มจาง · ขาดอายุยังรับได้ (เช่น เวนคืนภายหลัง)
 */
export function ReceiveForm({ lines, policyId, currency, banks, persons, hasCashValue, cashValue, today, canClose, minDate, closed }: {
  lines: OpenLine[]; policyId: string; currency: string; banks: Bank[]; persons: Person[];
  hasCashValue: boolean; cashValue?: number | null; today: string; canClose: boolean; minDate?: string | null; closed?: string | null;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "md" });
  const [mode, setMode] = useState<"lines" | "lump">(lines.length ? "lines" : "lump");
  if (closed) return <button type="button" disabled title={`กรมธรรม์ปิดแล้ว (${closed}) · ถ้าบันทึกผิด กดแถว "รับ" ล่าสุดแล้ว "ลบรายการนี้" กรมธรรม์จะกลับเป็นสถานะเดิม`} className={btn}>บันทึกรับ</button>;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(btn)}>บันทึกรับ</button>;
  if (!open) return trigger;
  const common = { currency, banks, persons, hasCashValue, cashValue, today, canClose, minDate };
  return present(trigger, (
    <div className="space-y-4 text-left">
      <h3 className="font-medium text-slate-900">บันทึกรับ</h3>
      <div className="flex flex-wrap gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "lines"} disabled={!lines.length} title={lines.length ? undefined : "ไม่มีงวดผลประโยชน์ที่รอรับ"}
          onClick={() => setMode("lines")} className={`${chip(mode === "lines")} disabled:opacity-50`}>รับผลประโยชน์ตามงวด{lines.length ? ` (${lines.length})` : ""}</button>
        <button type="button" role="tab" aria-selected={mode === "lump"} onClick={() => setMode("lump")} className={chip(mode === "lump")}>รับเงินก้อน (ครบสัญญา / เวนคืน / สินไหม)</button>
      </div>
      {mode === "lines" && lines.length ? <LinesReceive lines={lines} {...common} /> : <LumpReceive policyId={policyId} {...common} />}
    </div>
  ));
}

/**
 * กดแถวรับล่าสุด → แก้ วันที่ / ยอด / บัญชี / หมายเหตุ (ยกเลิกของเดิม + บันทึกใหม่ในคำสั่งเดียว) หรือ ลบ (ยกเลิกทั้งก้อน)
 *   แก้ / ลบได้เฉพาะรายการรับล่าสุด (ตกลง 8 พ.ย. 2026 · แบบเงินกู้) · งวด / ผลของการรับ / ผู้รับเงิน คงเดิม
 */
export function ReceiptEdit({ r, currency, banks, hasCashValue, paths, button, buttonClass }: {
  r: { id: string; date: string; amount: number; bank_asset_id: string | null; notes: string | null; outcome: string | null; cash_value_part: number };
  currency: string; banks: Bank[]; hasCashValue: boolean; paths: string[];
  /** ปุ่มเดียวเปิดหน้าต่าง (เช่น ยอดที่รับแล้วในแท็บบันทึกรับ) · ไม่ใส่ = กดที่แถว */
  button?: string; buttonClass?: string;
}) {
  const row = useRowPanel(!button);
  const [open, setOpen] = useState(false);
  const formId = `rc-${useId()}`;
  const [state, action, pending] = useActionState<ActionState, FormData>(editBenefitReceipt, {});
  const OUT: Record<string, string> = { MATURED: "ครบสัญญา", SURRENDERED: "เวนคืน", CLAIMED: "สินไหม" };
  const panel = (
    <div className="space-y-3 text-left">
      <form id={formId} action={action} className="grid gap-3 md:grid-cols-3">
        <input type="hidden" name="receipt_id" value={r.id} />
        <label className="text-sm">วันที่ได้รับ<input name="date" type="date" required defaultValue={r.date} className={input} /></label>
        <label className="text-sm">ยอดที่ได้รับ ({currency})<input name="amount" required inputMode="decimal" defaultValue={amt(r.amount)} className={input} /></label>
        <label className="text-sm">เข้าบัญชี<select name="bank_asset_id" required defaultValue={r.bank_asset_id ?? undefined} className={input}>
          <BankOptions banks={banks.filter((b) => b.currency === currency || b.asset_id === r.bank_asset_id)} /></select></label>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" defaultValue={r.notes ?? ""} className={input} /></label>
        {hasCashValue && (
          <label className="flex items-start gap-2 text-sm md:col-span-3">
            <input type="hidden" name="use_cash_value" value="off" />
            <input type="checkbox" name="use_cash_value" value="on" defaultChecked={r.cash_value_part > 0} className="mt-1" />
            <span>ถอนจากมูลค่าเวนคืนก่อน — ส่วนที่เกินนับเป็นรายได้</span>
          </label>
        )}
      </form>
      <p className="text-xs text-slate-500">บันทึก = ยกเลิกรายการเดิมแล้วบันทึกใหม่ในคำสั่งเดียว (งวด{r.outcome && ` · ${OUT[r.outcome] ?? r.outcome} (ปิดกรมธรรม์)`} · ผู้รับเงิน คงเดิม · มูลค่าเวนคืน / รายได้คิดใหม่ตามยอดใหม่)
        · แก้ / ลบได้เฉพาะรายการรับล่าสุด</p>
      <div className="flex flex-wrap items-center gap-3">
        <button form={formId} disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <UndoButton kind="BENEFIT" id={r.id} paths={paths} label="ลบรายการนี้" size="md"
          confirmText={`ลบการรับ ${money(r.amount, currency)} วันที่ ${thDate(r.date)}?${r.outcome ? "\nกรมธรรม์และมูลค่าเวนคืนจะกลับเป็นสถานะก่อนรับ" : "\nงวดกลับเป็น \"รอรับ\" · มูลค่าเวนคืน / รายได้ที่ลงจากการรับนี้ถูกยกเลิก"}`} />
        <Msg s={state} />
      </div>
    </div>
  );
  const title = `รายการรับ · ${thDate(r.date)}`;
  if (button) return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass ?? SMALL_BTN}>{button}</button>
      {open && <Modal title={title} size="md" onClose={() => setOpen(false)}>{panel}</Modal>}
    </>
  );
  return row.render(panel, title, "md");
}
