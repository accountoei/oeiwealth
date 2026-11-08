"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPolicy, type ActionState } from "../actions";
import { BeneficiaryRows } from "../Beneficiaries";
import { SMALL_BTN, INS_TAX, INS_TYPE, numOrZero, thDate } from "@/lib/format";
import { CheckedOnField, CoverageGrid, SCOPE_HINT, canShowAll, covLabel, hasScope } from "../CoverageGrid";
import { covPayload, riderPayload, type CovRow, type RiderRow } from "@/lib/insurance-coverage";
import { RiderFields } from "../RiderFields";
import { CurrencySelect } from "@/components/CurrencyContext";
import PayDefaultSelect from "../PayDefaultSelect";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPolicyForm(props: {
  persons: { id: string; name: string }[]; assets: { id: string; name: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean; initialType?: string; initialAsset?: string;
  banks: { asset_id: string; name: string; currency: string; frequent?: boolean | null }[]; cards: { id: string; label: string; currency: string }[];
}) {
  const { persons, assets, goLive, openingDate, today, isSetup, isAdmin, initialType = "LIFE", initialAsset = "", banks, cards } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createPolicy, {});
  const [type, setType] = useState(initialType);
  const [hasCv, setHasCv] = useState(false);
  const [opening, setOpening] = useState(isSetup);
  // หลัง Go-live: ซ่อนตัวเลือก "มีอยู่ก่อน Go-live" (ไม่ติ๊ก) · ADMIN กดลิงก์เล็กเพื่อเพิ่มรายการที่ตกหล่น
  const [late, setLate] = useState(false);
  const [rows, setRows] = useState([{ person_id: "", name: "", percent: "" }]);
  // ตารางความคุ้มครองมาตรฐาน (ตกลง 7 พ.ย. 2026) · หัวข้อตามประเภท · บันทึกพร้อมกรมธรรม์ในคำสั่งเดียว
  const [covRows, setCovRows] = useState<CovRow[]>([]);
  const [covAll, setCovAll] = useState(false);
  const [sum, setSum] = useState(0);
  const [ccy, setCcy] = useState("THB");
  const [checked, setChecked] = useState("");
  const cov = covPayload(covRows, covLabel);
  // สัญญาเพิ่มเติม (ถ้ามี · ตกลง 7 พ.ย. 2026): บันทึกพร้อมสัญญาหลักทั้งเล่ม · ใช้ข้อมูลร่วมของสัญญาหลัก
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [policyNo, setPolicyNo] = useState("");
  const rid = riderPayload(type === "PROPERTY" ? [] : riders, covLabel, policyNo);
  const errors = [...cov.errors, ...rid.errors];
  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลกรมธรรม์</h2>
        <label className={label}>ประเภท *
          <select name="insurance_type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {INS_TYPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-500">ภาษี: {INS_TAX[type]}</span>
        </label>
        <label className={label}>บริษัทประกัน *<input name="insurer" required className={input} /></label>
        <label className={label}>เลขกรมธรรม์{riders.length > 0 && type !== "PROPERTY" && " *"}<input name="policy_no" value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} className={input} /></label>
        <label className={label}>ชื่อแบบประกัน<input name="plan_name" maxLength={200} placeholder="ตามหน้ากรมธรรม์" className={`${input} placeholder:text-slate-400`} /></label>
        {type === "PROPERTY" ? (
          <label className={label}>ทรัพย์สินที่เอาประกัน
            <select name="insured_asset_id" defaultValue={initialAsset} className={input}>
              <option value="">— ไม่ระบุ —</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ) : (
          <label className={label}>ผู้เอาประกัน
            <select name="person_id" defaultValue={persons[0]?.id ?? ""} className={input}>
              <option value="">— ไม่ระบุ —</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {type !== "PROPERTY" && (
          <label className={label}>ผู้จ่ายเบี้ย
            <select name="payer_person_id" defaultValue="" className={input}>
              <option value="">— คนเดียวกับผู้เอาประกัน —</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className={label}>วันเริ่มคุ้มครอง<input name="start_date" type="date" className={input} /></label>
        <label className={label}>วันสิ้นสุด / ครบสัญญา<input name="end_date" type="date" className={input} /></label>
        <label className={label}>ทุนประกัน<input name="insured_amount" inputMode="decimal" onChange={(e) => setSum(numOrZero(e.target.value))} className={input} /></label>
        <label className={label}>เบี้ยประกัน (ต่อปี)<input name="premium" inputMode="decimal" className={input} /></label>
        <label className={label}>สกุลเงิน
          <CurrencySelect name="currency" defaultValue="THB" onChange={setCcy} className={input} />
        </label>
        <label className={label}>จ่ายเบี้ยจาก (ค่าตั้งต้น)
          <PayDefaultSelect banks={banks} cards={cards} className={input} />
          <span className="mt-1 block text-xs text-slate-500">เลือกไว้ให้ตอนจ่ายเบี้ย · เปลี่ยนได้ทุกครั้ง</span>
        </label>
        <label className={label}>หมายเหตุ {hasCv && opening && !isSetup && "(เหตุผล · จำเป็น)"}<input name="notes" required={hasCv && opening && !isSetup} className={input} /></label>
      </section>

      {type !== "PROPERTY" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">ผู้รับผลประโยชน์</h2>
          <BeneficiaryRows persons={persons} rows={rows} setRows={setRows} />
        </section>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="has_cash_value" checked={hasCv} onChange={(e) => setHasCv(e.target.checked)} className="mt-1" />
          <span><b>มีมูลค่าเวนคืน</b> (เช่น ประกันชีวิตสะสมทรัพย์) — นับมูลค่าเวนคืนเป็นสินทรัพย์ของครอบครัว</span>
        </label>
        {hasCv && (
          <>
            {!isSetup && isAdmin && !late && (
              <button type="button" onClick={() => setLate(true)} className={`${SMALL_BTN} self-start justify-self-start`}>เพิ่มรายการที่ตกหล่นก่อน Go-live (ADMIN)</button>
            )}
            {(isSetup || late) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
                <span>มีอยู่ก่อน Go-live ({thDate(goLive)}) — มูลค่าเวนคืน ณ สิ้นวัน {thDate(openingDate)} เป็นยอดตั้งต้น</span>
              </label>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <label className={label}>มูลค่าเวนคืน *<input name="cash_value" required inputMode="decimal" className={input} /></label>
              <label className={label}>ณ วันที่ *
                {opening ? <><input type="hidden" name="cash_value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
                  : <input name="cash_value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
              </label>
            </div>
            <p className="text-xs text-slate-500">ใส่ยอดรวม มูลค่าเวนคืน + เงินปันผลสะสม · เจ้าของมูลค่าเวนคืน = ผู้เอาประกัน 100% (กรณีพิเศษแก้ได้ในหน้ากรมธรรม์)</p>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-slate-900">ความคุ้มครอง <span className="text-xs font-normal text-slate-500">ถ้ามี · ไม่ใส่ = ไม่คุ้มครอง · กรอกหรือแก้ภายหลังได้ที่หน้ากรมธรรม์</span></h2>
          {canShowAll(type) && <button type="button" onClick={() => setCovAll(!covAll)} className="text-sm text-blue-700 hover:underline">{covAll ? "แสดงเฉพาะที่มี" : "แสดงทุกหัวข้อ"}</button>}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <CheckedOnField value={checked} onChange={setChecked} today={today} note={riders.length > 0 && type !== "PROPERTY" ? "ใช้กับทุกส่วนของเล่ม" : undefined} />
          {hasScope(type) && (
            <label className="flex items-center gap-2 whitespace-nowrap pb-1 text-sm text-slate-700">คุ้มครองเฉพาะ
              <input name="coverage_scope" maxLength={100} placeholder={SCOPE_HINT} className="w-64 rounded border border-slate-300 px-2 py-1 text-sm placeholder:text-slate-400" /></label>
          )}
        </div>
        <CoverageGrid insType={type} rows={covRows} setRows={setCovRows} sum={sum} currency={ccy} all={covAll} />
        <input type="hidden" name="coverages" value={JSON.stringify(cov.rows)} />
        {cov.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">{cov.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </section>

      {type !== "PROPERTY" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สัญญาเพิ่มเติม (ถ้ามี) <span className="text-xs font-normal text-slate-500">เช่น สุขภาพ / อุบัติเหตุ ในเล่มเดียวกัน · ใช้บริษัท เลขกรมธรรม์ ผู้เอาประกัน ผู้จ่ายเบี้ย จ่ายเบี้ยจาก และวันเริ่มคุ้มครอง ของสัญญาหลัก · เพิ่มภายหลังได้ที่หน้ากรมธรรม์</span></h2>
          <RiderFields riders={riders} setRiders={setRiders} currency={ccy} all={covAll} />
          <input type="hidden" name="riders" value={JSON.stringify(rid.rows)} />
          {rid.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">{rid.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </section>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending || errors.length > 0} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Link href="/insurance" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
