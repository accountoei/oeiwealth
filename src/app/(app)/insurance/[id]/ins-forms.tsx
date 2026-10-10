"use client";

import { useActionState, useMemo, useState } from "react";
import { addCoverage, payPremium, receiveBenefit, saveInsSchedule, type ActionState } from "../actions";
import { amountScheduleToText, generateAmountSchedule, parseAmountRows, parseAmountText, type AmountLine } from "@/lib/insurance-schedule";
import { BENEFIT_TYPE_LABEL, COVERAGE_LABEL, money, thDate } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const sbtn = "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50";
const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;

type Bank = { asset_id: string; name: string; currency: string };
type Card = { id: string; label: string; currency: string };
type Person = { id: string; name: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-sm text-red-600">{s.error}</span>;
  if (s.ok) return <span className="text-sm text-emerald-700">{s.ok}</span>;
  return null;
}

/**
 * ตั้ง / แทนตารางเบี้ย (PREMIUM) หรือ ตารางรับผลประโยชน์ (BENEFIT)
 * ทางที่ 1 สูตร: ยอดเท่ากันทุกงวด (จำนวนงวด หรือ จนถึงวันที่) · ทางที่ 2 อัปโหลด / วาง Excel (ยอดต่างกันได้ เช่น เบี้ยสุขภาพตามอายุ)
 * งวดที่มีการชำระแล้วเก็บไว้ · แทนเฉพาะงวดที่ยังไม่ชำระ
 */
export function InsScheduleEditor({ policyId, kind, currency, hasLines, defaultAmount, defaultFirstDue }: {
  policyId: string; kind: "PREMIUM" | "BENEFIT"; currency: string; hasLines: boolean; defaultAmount?: number; defaultFirstDue: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"FORMULA" | "TEXT">("FORMULA");
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : "");
  const [every, setEvery] = useState(kind === "PREMIUM" ? "12" : "24");
  const [by, setBy] = useState<"COUNT" | "UNTIL">("COUNT");
  const [count, setCount] = useState(kind === "PREMIUM" ? "10" : "1");
  const [until, setUntil] = useState("");
  const [first, setFirst] = useState(defaultFirstDue);
  const [btype, setBtype] = useState(kind === "BENEFIT" ? "CASH_BACK" : "");
  const [generated, setGenerated] = useState<AmountLine[] | null>(null);
  const [calcErr, setCalcErr] = useState("");
  const [text, setText] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveInsSchedule, {});
  const parsed = useMemo(() => parseAmountText(text), [text]);
  const lines = mode === "FORMULA" ? generated ?? [] : parsed.lines;
  const errors = mode === "FORMULA" ? [] : parsed.errors;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const label = kind === "PREMIUM" ? "ตารางเบี้ย" : "ตารางรับผลประโยชน์";

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={hasLines ? obtn : btn}>{hasLines ? `แก้${label} (งวดที่ยังไม่ชำระ)` : `+ ตั้ง${label}`}</button>;

  const calc = () => {
    const r = generateAmountSchedule({ amount: num(amount), everyMonths: Number(every), firstDue: first,
      periods: by === "COUNT" ? num(count) : undefined, until: by === "UNTIL" ? until : undefined });
    setCalcErr(r.error ?? ""); setGenerated(r.error ? null : r.lines);
    if (!r.error) setText(amountScheduleToText(r.lines));
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileMsg("กำลังอ่านไฟล์…");
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const sheets = (await readXlsxFile(f)) as { sheet: string; data: unknown[][] }[];
      const sh = sheets.find((x) => parseAmountRows(x.data).lines.length > 0);
      if (!sh) { setFileMsg("ไม่พบงวดในไฟล์ — ต้องมีคอลัมน์วันที่ และยอด (เช่น หัวตาราง \"วันครบกำหนด\" / \"เบี้ยประกัน\")"); return; }
      const r = parseAmountRows(sh.data);
      setText(amountScheduleToText(r.lines));
      setFileMsg(`อ่านแผ่นงาน "${sh.sheet}" ได้ ${r.lines.length} งวด${r.skipped ? ` · ข้ามยอด 0 จำนวน ${r.skipped} แถว` : ""}`);
    } catch { setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะ .xlsx"); }
  };
  // ส่งชนิดผลประโยชน์ไปกับทุกงวด (ทางที่ 2 ใช้ค่าที่เลือก)
  const payload = lines.map((l) => ({ ...l, benefit_type: kind === "BENEFIT" ? btype : undefined }));

  return (
    <div className="w-full space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">{hasLines ? `แก้${label}` : `ตั้ง${label}`}</h3>
          <p className="text-xs text-slate-500">งวดที่มีการชำระ / รับแล้วเก็บไว้ · แทนเฉพาะงวดที่ยังไม่ชำระ · งวดใหม่ต้องอยู่หลังงวดที่ชำระแล้ว</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm md:col-span-2">วิธีใส่
          <select value={mode} onChange={(e) => setMode(e.target.value as "FORMULA" | "TEXT")} className={input}>
            <option value="FORMULA">ทางที่ 1 · ยอดเท่ากันทุกงวด</option>
            <option value="TEXT">ทางที่ 2 · อัปโหลด / วางจาก Excel / แก้ทีละงวด (ยอดต่างกันได้)</option>
          </select>
        </label>
        {kind === "BENEFIT" && (
          <label className="text-sm">ชนิดผลประโยชน์
            <select value={btype} onChange={(e) => setBtype(e.target.value)} className={input}>
              {Object.entries(BENEFIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
      </div>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">ยอดต่องวด ({currency})<input value={amount} onChange={(e) => { setAmount(e.target.value); setGenerated(null); }} inputMode="decimal" className={input} /></label>
            <label className="text-sm">ทุก
              <select value={every} onChange={(e) => { setEvery(e.target.value); setGenerated(null); }} className={input}>
                <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option>
                <option value="12">ทุกปี</option><option value="24">ทุก 2 ปี</option><option value="36">ทุก 3 ปี</option><option value="60">ทุก 5 ปี</option>
              </select>
            </label>
            <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={first} onChange={(e) => { setFirst(e.target.value); setGenerated(null); }} className={input} /></label>
            <label className="text-sm">กำหนดจาก
              <select value={by} onChange={(e) => { setBy(e.target.value as "COUNT" | "UNTIL"); setGenerated(null); }} className={input}>
                <option value="COUNT">จำนวนงวด</option><option value="UNTIL">จนถึงวันที่</option>
              </select>
            </label>
            {by === "COUNT"
              ? <label className="text-sm">จำนวนงวด<input value={count} onChange={(e) => { setCount(e.target.value); setGenerated(null); }} name="quantity" inputMode="decimal" className={input} /></label>
              : <label className="text-sm">งวดสุดท้ายไม่เกินวันที่<input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setGenerated(null); }} className={input} /></label>}
          </div>
          <div className="flex items-center gap-3"><button type="button" onClick={calc} className={obtn}>คำนวณ</button>
            {calcErr && <span className="text-sm text-red-600">{calcErr}</span>}</div>
        </section>
      )}

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-sm">อัปโหลดไฟล์ Excel (.xlsx)
            <input type="file" accept=".xlsx" onChange={(e) => onFile(e.target.files?.[0])}
              className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
          </label>
          {fileMsg && <p className="text-xs text-slate-600">{fileMsg}</p>}
          <p className="text-xs text-slate-500">หรือวาง: 1 บรรทัด = 1 งวด · <b>วันครบกำหนด · ยอด · หมายเหตุ</b> (มีหัวตาราง &ldquo;เบี้ย&rdquo; / &ldquo;จำนวนเงิน&rdquo; ก็ได้) · ไฟล์อ่านในเครื่อง ไม่ถูกเก็บ</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={"2026-11-15\t25000.00\n2027-11-15\t26500.00"} className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
        </section>
      )}

      {lines.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">ตัวอย่าง {lines.length} งวด · รวม {money(total, currency)}</div>
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => <tr key={i}><td className="py-1">{i + 1}</td><td>{thDate(l.due_date)}</td>
                <td className="text-right tabular-nums">{money(l.amount)}</td><td className="pl-3 text-xs text-slate-500">{l.notes}</td></tr>)}
            </tbody></table>
          </div>
        </section>
      )}
      <form action={action} className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => { if (hasLines && !confirm("แทนงวดที่ยังไม่ชำระด้วยตารางนี้?")) e.preventDefault(); }}>
        <input type="hidden" name="policy_id" value={policyId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="lines" value={JSON.stringify(payload)} />
        <button disabled={pending || !lines.length || errors.length > 0} className={btn}>{pending ? "กำลังบันทึก…" : `บันทึก (${lines.length} งวด)`}</button>
        <Msg s={state} />
      </form>
    </div>
  );
}

/** บันทึกจ่ายเบี้ยของงวด → ค่าใช้จ่ายหมวด "ประกัน" (บัญชี / บัตร / เงินสด) */
export function PayPremiumForm({ policyId, lineId, label, amount, currency, banks, cards, persons, defaultPerson, today }: {
  policyId: string; lineId: string; label: string; amount: number; currency: string;
  banks: Bank[]; cards: Card[]; persons: Person[]; defaultPerson?: string | null; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [via, setVia] = useState(banks.length ? "bank" : cards.length ? "card" : "cash");
  const [state, action, pending] = useActionState<ActionState, FormData>(payPremium, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={sbtn}>บันทึกจ่าย</button>;
  const sameBanks = banks.filter((b) => b.currency === currency);
  const sameCards = cards.filter((c) => c.currency === currency);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="description" value={label} />
      <label className="text-xs">ยอดที่จ่าย<input name="amount" required inputMode="decimal" defaultValue={amount > 0 ? amount.toFixed(2) : ""} className={`mt-1 block w-28 ${small}`} /></label>
      <label className="text-xs">วันที่จ่าย<input name="date" type="date" required defaultValue={today} max={today} className={`mt-1 block ${small}`} /></label>
      <label className="text-xs">จ่ายจาก
        <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={`mt-1 block ${small}`}>
          <option value="bank">บัญชีธนาคาร</option><option value="card">บัตรเครดิต</option><option value="cash">เงินสด</option>
        </select>
      </label>
      {via === "bank" && <label className="text-xs">บัญชี<select name="bank_asset_id" required className={`mt-1 block ${small}`}>
        {sameBanks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select></label>}
      {via === "card" && <label className="text-xs">บัตร<select name="card_id" required className={`mt-1 block ${small}`}>
        {sameCards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      {via === "cash" && <label className="text-xs">ผู้จ่าย<select name="person_id" required defaultValue={defaultPerson ?? undefined} className={`mt-1 block ${small}`}>
        {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-32 ${small}`} /></label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">บันทึก</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

/**
 * รับผลประโยชน์ / ครบสัญญา / เวนคืน / สินไหม
 * มีมูลค่าเวนคืน: ถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกิน = รายได้ "ผลประโยชน์ประกัน"
 */
export function BenefitForm({ policyId, lineId, amount, currency, banks, persons, hasCashValue, cashValue, today, button = "บันทึกรับ",
  small: isSmall = false, canClose = true }: {
  policyId: string; lineId?: string; amount?: number; currency: string; banks: Bank[]; persons: Person[];
  hasCashValue: boolean; cashValue?: number | null; today: string; button?: string; small?: boolean; canClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveBenefit, {});
  if (state.ok && isSmall) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={isSmall ? sbtn : obtn}>{button}</button>;
  const sameBanks = banks.filter((b) => b.currency === currency);
  return (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      {lineId && <input type="hidden" name="line_id" value={lineId} />}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">ยอดที่ได้รับ ({currency}) *<input name="amount" required inputMode="decimal" defaultValue={amount ? amount.toFixed(2) : ""} className={input} /></label>
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">เข้าบัญชี *<select name="bank_asset_id" required className={input}>
          {sameBanks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select></label>
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
        <label className="text-sm">หมายเหตุ<input name="notes" className={input} /></label>
        {hasCashValue && (
          <label className="flex items-start gap-2 text-sm md:col-span-3">
            <input type="hidden" name="use_cash_value" value="off" />
            <input type="checkbox" name="use_cash_value" value="on" defaultChecked className="mt-1" />
            <span>ถอนจากมูลค่าเวนคืนก่อน{cashValue != null && ` (ตอนนี้ ${money(cashValue, currency)})`} — ส่วนที่เกินนับเป็นรายได้
              <span className="block text-xs text-slate-500">ไม่ติ๊ก = นับเป็นรายได้ทั้งหมด (เช่น บำนาญ / สินไหมที่ไม่เกี่ยวกับมูลค่าเวนคืน)</span></span>
          </label>
        )}
      </div>
      {outcome && <p className="text-xs text-amber-700">ปิดกรมธรรม์: สถานะเปลี่ยนเป็น &ldquo;{outcome === "MATURED" ? "ครบสัญญา" : outcome === "SURRENDERED" ? "เวนคืนแล้ว" : "เคลมจบแล้ว"}&rdquo;{hasCashValue && " · มูลค่าเวนคืนที่เหลือเป็น 0"} · งวดเบี้ยที่ยังไม่จ่ายไม่ต้องจ่ายแล้ว</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function CoverageForm({ policyId, currency }: { policyId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addCoverage, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={obtn}>+ เพิ่มความคุ้มครอง</button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="currency" value={currency} />
      <label className="text-xs">ความคุ้มครอง
        <select name="coverage_type" defaultValue="LIFE" className={`mt-1 block ${small}`}>
          {Object.entries(COVERAGE_LABEL).map(([k, [l, u]]) => <option key={k} value={k}>{l}{u && ` (${u})`}</option>)}
        </select>
      </label>
      <label className="text-xs">วงเงิน ({currency})<input name="limit_amount" required inputMode="decimal" className={`mt-1 block w-32 ${small}`} /></label>
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-48 ${small}`} /></label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">เพิ่ม</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}
