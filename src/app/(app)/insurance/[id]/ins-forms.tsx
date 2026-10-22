"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addCashValue, addCoverage, payPremium, receiveBenefit, saveCashValueTable, saveInsSchedule, syncCashValue, updatePolicyInfo, type ActionState, type PayState } from "../actions";
import AssetValuationForm from "@/components/AssetValuationForm";
import { parseCashValueText, type CvLine } from "@/lib/insurance-schedule";
import { amountScheduleToText, generateAmountSchedule, parseAmountRows, parseAmountText, type AmountLine } from "@/lib/insurance-schedule";
import { BENEFIT_TYPE_LABEL, COVERAGE_LABEL, ROW_BTN, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import BalanceGuard from "@/components/BalanceGuard";

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
  const { open, setOpen, present, activeCls } = useActionSlot();
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
  const cf = useConfirmSubmit();
  const parsed = useMemo(() => parseAmountText(text), [text]);
  const lines = mode === "FORMULA" ? generated ?? [] : parsed.lines;
  const errors = mode === "FORMULA" ? [] : parsed.errors;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const label = kind === "PREMIUM" ? "ตารางเบี้ย" : "ตารางรับผลประโยชน์";

  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(hasLines ? obtn : btn)}>{hasLines ? `แก้${label} (งวดที่ยังไม่ชำระ)` : `+ ตั้ง${label}`}</button>;
  if (!open) return trigger;

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

  return present(trigger, (
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
        onSubmit={cf.guard("แทนงวดที่ยังไม่ชำระด้วยตารางนี้?", {}, hasLines)}>{cf.dialog}
        <input type="hidden" name="policy_id" value={policyId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="lines" value={JSON.stringify(payload)} />
        <button disabled={pending || !lines.length || errors.length > 0} className={btn}>{pending ? "กำลังบันทึก…" : `บันทึก (${lines.length} งวด)`}</button>
        <Msg s={state} />
      </form>
    </div>
  ));
}

/** บันทึกจ่ายเบี้ยของงวด → ค่าใช้จ่ายหมวด "ประกัน" (บัญชี / บัตร / เงินสด) */
/** มูลค่าเวนคืนของกรมธรรม์ (ใช้ถามต่อหลังบันทึกจ่ายเบี้ย) · suggest = ตามตารางในสัญญา ปีล่าสุดที่ถึงวันแล้ว */
export type CashValueCtx = { assetId: string; currency: string; current: number | null; minDate: string; paths: string[];
  suggest: { value: number; year: number; date: string } | null };

export function PayPremiumForm({ policyId, lineId, label, amount, currency, banks, cards, persons, defaultPerson, today, cashValue }: {
  policyId: string; lineId: string; label: string; amount: number; currency: string;
  banks: Bank[]; cards: Card[]; persons: Person[]; defaultPerson?: string | null; today: string; cashValue?: CashValueCtx | null;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [via, setVia] = useState(banks.length ? "bank" : cards.length ? "card" : "cash");
  const [state, action, pending] = useActionState<PayState, FormData>(payPremium, {});
  if (state.ok) {
    const done = <span className="text-xs text-emerald-700">{state.ok}</span>;
    // ลงตามตารางในสัญญาให้แล้ว หรือไม่มีมูลค่าเวนคืน → จบ · ไม่งั้นถามอัปเดตมูลค่าเวนคืนต่อ (กดข้ามได้)
    if (state.cv && state.cv.added > 0) return <span className="text-xs text-emerald-700">{state.ok} · มูลค่าเวนคืนตามสัญญา {money(state.cv.value)} (ปีที่ {state.cv.policy_year})</span>;
    if (!cashValue || !open) return done;
    const sug = cashValue.suggest;
    return present(done, (
      <div className="space-y-3 text-left">
        <div>
          <h3 className="font-medium text-slate-900">{state.ok} · อัปเดตมูลค่าเวนคืนด้วยไหม?</h3>
          <p className="text-xs text-slate-500">ตอนนี้ {money(cashValue.current, cashValue.currency)}
            {sug ? <> · ตามตารางในสัญญา สิ้นปีกรมธรรม์ที่ {sug.year} ({thDate(sug.date)}) = {money(sug.value, cashValue.currency)}</>
              : " · ยังไม่มีตารางมูลค่าเวนคืนตามสัญญา (ใส่ได้ที่ส่วน \"มูลค่าเวนคืน\" ด้านล่าง)"}</p>
        </div>
        <AssetValuationForm assetId={cashValue.assetId} currency={cashValue.currency} today={today} minDate={cashValue.minDate} paths={cashValue.paths}
          defaultValue={sug?.value ?? cashValue.current ?? undefined} defaultNotes={sug ? `ตามตารางในสัญญา ปีที่ ${sug.year}` : undefined}
          methods={[["STATEMENT", "ตามหนังสือแจ้ง / ตารางในสัญญา"], ["USER_ESTIMATE", "ประมาณเอง"]]} />
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ข้าม / ปิด</button>
      </div>
    ));
  }
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(ROW_BTN)}>บันทึกจ่าย</button>;
  if (!open) return trigger;
  const sameBanks = banks.filter((b) => b.currency === currency);
  const sameCards = cards.filter((c) => c.currency === currency);
  return present(trigger, (
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
      <BalanceGuard />
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [outcome, setOutcome] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveBenefit, {});
  if (state.ok && isSmall) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(isSmall ? ROW_BTN : obtn)}>{button}</button>;
  if (!open) return trigger;
  const sameBanks = banks.filter((b) => b.currency === currency);
  return present(trigger, (
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
  ));
}

export function CoverageForm({ policyId, currency }: { policyId: string; currency: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(addCoverage, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(obtn)}>+ เพิ่มความคุ้มครอง</button>;
  if (!open) return trigger;
  return present(trigger, (
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
  ));
}

export function AddCashValueForm({ policyId, currency, today, goLive }: {
  policyId: string; currency: string; today: string; goLive: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [date, setDate] = useState(today);
  const [state, action, pending] = useActionState<ActionState, FormData>(addCashValue, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(`mt-2 ${sbtn}`)}>+ เพิ่มมูลค่าเวนคืน</button>;
  if (!open) return trigger;
  const opening = goLive !== "" && date !== "" && date < goLive;
  return present(trigger, (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      <label className="block text-xs">มูลค่าเวนคืน + เงินปันผลสะสม ({currency})
        <input name="value" required inputMode="decimal" className={`mt-1 block w-full ${small}`} />
      </label>
      <label className="block text-xs">ณ วันที่ (ตามหนังสือแจ้ง)
        <input type="date" name="valuation_date" required value={date} max={today} onChange={(e) => setDate(e.target.value)}
          className={`mt-1 block w-full ${small}`} />
      </label>
      {opening && <p className="text-xs text-amber-700">ก่อนวันเริ่มใช้ระบบ → บันทึกเป็นยอดตั้งต้น</p>}
      <p className="text-xs text-slate-500">เจ้าของมูลค่าเวนคืน = ผู้เอาประกัน 100% (กรณีพิเศษแก้ได้ภายหลัง)</p>
      <label className="block text-xs">หมายเหตุ
        <input name="notes" placeholder="เช่น เวนคืน 80,000 + ปันผลสะสม 20,000" className={`mt-1 block w-full ${small}`} />
      </label>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      </div>
      <Msg s={state} />
    </form>
  ));
}

/** แก้ข้อมูลกรมธรรม์ (ในหน้าต่าง "แก้ไขข้อมูล") */
export function PolicyInfoForm({ policyId, persons, showInsured, v }: {
  policyId: string; persons: Person[]; showInsured: boolean;
  v: { person_id: string | null; payer_person_id: string | null; insurer: string; policy_no: string | null; start_date: string | null;
    end_date: string | null; insured_amount: number | null; premium: number | null; notes: string | null };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePolicyInfo, {});
  const d = (x: string | number | null) => (x == null ? "" : String(x));
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="policy_id" value={policyId} />
      <label className="text-sm">บริษัทประกัน<input name="insurer" required defaultValue={v.insurer} className={input} /></label>
      <label className="text-sm">เลขกรมธรรม์<input name="policy_no" defaultValue={d(v.policy_no)} className={input} data-plain /></label>
      {showInsured && (
        <label className="text-sm">ผู้เอาประกัน
          <select name="person_id" defaultValue={d(v.person_id)} className={input}>
            {persons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      <label className="text-sm">ผู้จ่ายเบี้ย
        <select name="payer_person_id" defaultValue={d(v.payer_person_id)} className={input}>
          <option value="">คนเดียวกับผู้เอาประกัน</option>
          {persons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="text-sm">เริ่มคุ้มครอง<input name="start_date" type="date" defaultValue={d(v.start_date)} className={input} /></label>
      <label className="text-sm">สิ้นสุด<input name="end_date" type="date" defaultValue={d(v.end_date)} className={input} /></label>
      <label className="text-sm">ทุนประกัน<input name="insured_amount" inputMode="decimal" defaultValue={d(v.insured_amount)} className={input} /></label>
      <label className="text-sm">เบี้ยต่อปี<input name="premium" inputMode="decimal" defaultValue={d(v.premium)} className={input} /></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={d(v.notes)} className={input} /></label>
      <div className="flex items-center gap-3 md:col-span-2">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/**
 * ตารางมูลค่าเวนคืนตามสัญญา (ในเล่มกรมธรรม์ · มูลค่า ณ สิ้นปีกรมธรรม์ที่ N)
 * วางจาก Excel ได้: "ปีที่ · มูลค่า" หรือ "วันที่ · มูลค่า" · ไม่ใส่วันที่ = วันเริ่มสัญญา + N ปี
 * บันทึกแล้วระบบลงมูลค่าเวนคืนให้เองเมื่อถึงวัน และจ่ายเบี้ยก่อนวันนั้นครบ
 */
export function CashValueTableEditor({ policyId, startDate, current }: { policyId: string; startDate: string | null; current: CvLine[] }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [text, setText] = useState(() => current.map((l) => [l.policy_year, l.value.toFixed(2), l.value_date ?? ""].join("\t").trimEnd()).join("\n"));
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCashValueTable, {});
  const parsed = useMemo(() => parseCashValueText(text, startDate), [text, startDate]);
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(current.length ? obtn : btn)}>
    {current.length ? "แก้ตารางมูลค่าเวนคืนตามสัญญา" : "+ ตารางมูลค่าเวนคืนตามสัญญา"}</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="lines" value={JSON.stringify(parsed.lines.map((l) => ({ policy_year: l.policy_year, value: l.value, value_date: l.explicitDate ? l.value_date : undefined })))} />
      <div>
        <h3 className="font-medium text-slate-900">ตารางมูลค่าเวนคืนตามสัญญา</h3>
        <p className="text-xs text-slate-500">1 บรรทัด = 1 ปี: <b>ปีกรมธรรม์</b> แล้ว <b>มูลค่าเวนคืน</b> (วางจาก Excel ได้) · ใส่วันที่ต่อท้ายได้ถ้าไม่ใช่วันครบรอบสัญญา
          {startDate ? <> · วันครบรอบนับจากวันเริ่มสัญญา {thDate(startDate)}</> : <span className="text-amber-700"> · กรมธรรม์ยังไม่มีวันเริ่มสัญญา ต้องใส่วันที่ทุกบรรทัด</span>}</p>
        <p className="text-xs text-slate-500">บันทึกแล้ว ระบบลงมูลค่าเวนคืนให้เองเมื่อถึงวันครบปี และจ่ายเบี้ยก่อนหน้านั้นครบแล้ว (ไม่ทับยอดที่ลงไว้ใหม่กว่า)</p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"1\t12,000\n2\t28,500\n3\t45,000"} className={`${input} font-mono`} />
      {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
      {parsed.lines.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-2 py-1">ปีที่</th><th>สิ้นปีกรมธรรม์</th><th className="px-2 text-right">มูลค่าเวนคืน</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {parsed.lines.map((l) => <tr key={l.policy_year}><td className="px-2 py-1">{l.policy_year}</td><td>{l.value_date ? thDate(l.value_date) : "-"}</td>
                <td className="px-2 text-right tabular-nums">{money(l.value)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending || parsed.errors.length > 0 || (parsed.lines.length === 0 && current.length === 0)} className={btn}>
          {pending ? "กำลังบันทึก…" : parsed.lines.length === 0 ? "ล้างตาราง" : `บันทึก ${parsed.lines.length} ปี`}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/** ลงมูลค่าเวนคืนตามตาราง (ปีที่ถึงวันแล้วแต่ยังไม่ได้ลง) */
export function SyncCashValueButton({ policyId }: { policyId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncCashValue, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="policy_id" value={policyId} />
      <button disabled={pending} className={sbtn}>{pending ? "กำลังลง…" : "ลงมูลค่าตามตาราง"}</button>
      <Msg s={state} />
    </form>
  );
}
