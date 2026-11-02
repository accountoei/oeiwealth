"use client";

import { useState } from "react";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export type PartyValues = {
  borrower_address: string | null; borrower_id_last4: string | null;
  guarantor_name: string | null; guarantor_phone: string | null; guarantor_address: string | null; guarantor_id_last4: string | null;
  witness1_name: string | null; witness2_name: string | null;
  contract_place_type: string | null; contract_place_business_id: string | null; contract_place_text: string | null;
  repay_bank_asset_id: string | null;
};
export type PartyOptions = {
  businesses: { asset_id: string; company_name: string }[];
  banks: { asset_id: string; name: string; account_no_masked: string | null }[];
};

/** ช่องเลขบัตร: มีเลขแล้ว → โชว์ 4 ตัวท้าย · ว่าง = ไม่เปลี่ยน · ติ๊กล้างได้ */
function IdField({ name, last4 }: { name: string; last4: string | null }) {
  const [clear, setClear] = useState(false);
  return (
    <div className="text-sm">
      <label>เลขบัตรประชาชน / หนังสือเดินทาง
        <input name={name} disabled={clear} autoComplete="off" data-plain maxLength={25}
          placeholder={last4 ? `บันทึกแล้ว ••••${last4} · ว่าง = ไม่เปลี่ยน` : "13 หลัก"} className={input} />
      </label>
      <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        เก็บแบบเข้ารหัส · หน้าจอแสดงแค่ 4 ตัวท้าย
        {last4 && <label className="inline-flex items-center gap-1"><input type="checkbox" name={`${name}_clear`} checked={clear} onChange={(e) => setClear(e.target.checked)} /> ล้าง</label>}
      </span>
    </div>
  );
}

/**
 * รายละเอียดสำหรับพิมพ์สัญญา (ไม่บังคับ · ตกลง 2 พ.ย. 2026): ที่อยู่ / เลขบัตรผู้กู้ · ผู้ค้ำประกัน · พยาน · สถานที่ทำสัญญา · บัญชีรับชำระ
 * ใช้ทั้งฟอร์มเพิ่มเงินให้กู้และฟอร์มแก้รายละเอียด · ช่องเลขบัตรเฉพาะ ADMIN / EDITOR (canSensitive)
 */
export default function ContractParties({ v, opt, canSensitive }: { v?: Partial<PartyValues>; opt: PartyOptions; canSensitive: boolean }) {
  const [place, setPlace] = useState(v?.contract_place_type ?? "LENDER");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm md:col-span-2">ที่อยู่ผู้กู้<textarea name="borrower_address" rows={2} maxLength={500} defaultValue={v?.borrower_address ?? ""} className={input} /></label>
      {canSensitive && <IdField name="borrower_id" last4={v?.borrower_id_last4 ?? null} />}
      <label className="text-sm">บัญชีรับชำระ (ข้อ 4 ในสัญญา)
        <select name="repay_bank_asset_id" defaultValue={v?.repay_bank_asset_id ?? ""} className={input}>
          <option value="">— เว้นให้เขียนเอง —</option>
          {opt.banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}{b.account_no_masked ? ` · ${b.account_no_masked}` : ""}</option>)}
        </select>
      </label>
      <label className="text-sm">สถานที่ทำสัญญา
        <select name="contract_place_type" value={place} onChange={(e) => setPlace(e.target.value)} className={input}>
          <option value="LENDER">ที่อยู่ผู้ให้กู้ (จากหน้า Family)</option>
          {opt.businesses.length > 0 && <option value="BUSINESS">ที่อยู่กิจการ (Private Business)</option>}
          <option value="TEXT">พิมพ์เอง</option>
          <option value="">— เว้นให้เขียนเอง —</option>
        </select>
      </label>
      {place === "BUSINESS" && (
        <label className="text-sm">กิจการ
          <select name="contract_place_business_id" defaultValue={v?.contract_place_business_id ?? opt.businesses[0]?.asset_id ?? ""} className={input}>
            {opt.businesses.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.company_name}</option>)}
          </select>
        </label>
      )}
      {place === "TEXT" && (
        <label className="text-sm">ทำที่<input name="contract_place_text" maxLength={500} defaultValue={v?.contract_place_text ?? ""} placeholder="เช่น บ้านเลขที่ … ถนน … เขต …" className={input} /></label>
      )}
      <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 md:col-span-2 md:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-slate-700">ผู้ค้ำประกัน (ไม่บังคับ)</legend>
        <label className="text-sm">ชื่อ-นามสกุล<input name="guarantor_name" maxLength={200} defaultValue={v?.guarantor_name ?? ""} className={input} /></label>
        <label className="text-sm">เบอร์โทร<input name="guarantor_phone" type="tel" maxLength={50} defaultValue={v?.guarantor_phone ?? ""} className={input} /></label>
        <label className="text-sm md:col-span-2">ที่อยู่<textarea name="guarantor_address" rows={2} maxLength={500} defaultValue={v?.guarantor_address ?? ""} className={input} /></label>
        {canSensitive && <IdField name="guarantor_id" last4={v?.guarantor_id_last4 ?? null} />}
        <p className="self-end text-xs text-slate-500">กรอกชื่อ → สัญญาจะเพิ่มข้อค้ำประกันและช่องลงชื่อผู้ค้ำให้</p>
      </fieldset>
      <label className="text-sm">พยานคนที่ 1<input name="witness1_name" maxLength={200} defaultValue={v?.witness1_name ?? ""} placeholder="ว่าง = เว้นให้เขียนเอง" className={input} /></label>
      <label className="text-sm">พยานคนที่ 2<input name="witness2_name" maxLength={200} defaultValue={v?.witness2_name ?? ""} placeholder="ว่าง = เว้นให้เขียนเอง" className={input} /></label>
    </div>
  );
}
