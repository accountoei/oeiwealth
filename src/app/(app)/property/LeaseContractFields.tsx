"use client";

import { useState } from "react";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** รายละเอียดสำหรับพิมพ์สัญญาเช่า (ตกลง 2 พ.ย. 2026) — ไม่บังคับกรอก · ว่าง = หน้าพิมพ์เว้นเส้นให้เขียนเอง */
export type LeaseDetail = {
  tenant_type: string | null; tenant_address: string | null; tenant_phone: string | null; tenant_signatory: string | null;
  tenant_id_last4: string | null;
  contract_place_type: string | null; contract_place_person_id: string | null; contract_place_business_id: string | null;
  contract_place_text: string | null;
  notice_days: number | null; late_return_fee_per_day: number | null; witness1_name: string | null; witness2_name: string | null;
};
export type LeaseDetailOptions = {
  /** เจ้าของทรัพย์สิน (เรียงตามสัดส่วน) · คนแรก = ค่าเริ่มต้นของ "ทำที่" */
  owners: { id: string; name: string; address: string | null }[];
  businesses: { asset_id: string; company_name: string }[];
};
export const NOTICE_DAYS_DEFAULT = 30;

/** ช่องเลขผู้เช่า: มีเลขแล้ว → โชว์ 4 ตัวท้าย · ว่าง = ไม่เปลี่ยน · ติ๊กล้างได้ */
function IdField({ juristic, last4, copyFrom }: { juristic: boolean; last4: string | null; copyFrom?: string | null }) {
  const [clear, setClear] = useState(false);
  return (
    <div className="text-sm">
      <label>{juristic ? "เลขทะเบียนนิติบุคคล / เลขผู้เสียภาษี" : "เลขบัตรประชาชน / หนังสือเดินทาง"}
        <input name="lease_tenant_id" disabled={clear} autoComplete="off" data-plain maxLength={25}
          placeholder={last4 ? `บันทึกแล้ว ••••${last4} · ว่าง = ไม่เปลี่ยน` : copyFrom ? `ว่าง = ใช้เลขเดิม ••••${copyFrom}` : "13 หลัก"} className={input} />
      </label>
      <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        เก็บแบบเข้ารหัส · หน้าจอแสดงแค่ 4 ตัวท้าย
        {last4 && <label className="inline-flex items-center gap-1"><input type="checkbox" name="lease_tenant_id_clear" checked={clear} onChange={(e) => setClear(e.target.checked)} /> ล้าง</label>}
      </span>
    </div>
  );
}

/**
 * ผู้เช่า (บุคคล / นิติบุคคล) · สถานที่ทำสัญญา · แจ้งเลิกล่วงหน้า · ค่าเสียหายส่งคืนล่าช้า · พยาน
 * ชื่อ input ขึ้นต้นด้วย lease_ · ใช้ทั้งฟอร์มสัญญาใหม่และ "แก้ไขสัญญา" · เลขผู้เช่าเฉพาะ ADMIN / EDITOR (canSensitive)
 */
export default function LeaseContractFields({ v, opt, canSensitive, idCopyFrom }: {
  v?: Partial<LeaseDetail>; opt: LeaseDetailOptions; canSensitive: boolean;
  /** ต่อสัญญา: 4 ตัวท้ายของเลขผู้เช่าในสัญญาเดิม (ว่าง = ใช้เลขเดิม) */ idCopyFrom?: string | null;
}) {
  const [type, setType] = useState(v?.tenant_type ?? "PERSON");
  const [place, setPlace] = useState(v?.contract_place_type ?? (opt.owners.length ? "LESSOR" : ""));
  const juristic = type === "JURISTIC";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="lease_detail" value="1" />
      <label className="text-sm">ผู้เช่าเป็น
        <select name="lease_tenant_type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
          <option value="PERSON">บุคคลธรรมดา</option>
          <option value="JURISTIC">นิติบุคคล (บริษัท / ห้างฯ)</option>
        </select>
      </label>
      {juristic
        ? <label className="text-sm">ผู้มีอำนาจลงนาม<input name="lease_tenant_signatory" maxLength={200} defaultValue={v?.tenant_signatory ?? ""} placeholder="เช่น นาย … กรรมการผู้มีอำนาจ" className={input} /></label>
        : <input type="hidden" name="lease_tenant_signatory" value="" />}
      {canSensitive && <IdField juristic={juristic} last4={v?.tenant_id_last4 ?? null} copyFrom={idCopyFrom} />}
      <label className="text-sm">เบอร์โทรผู้เช่า<input name="lease_tenant_phone" type="tel" maxLength={50} defaultValue={v?.tenant_phone ?? ""} className={input} /></label>
      <label className="text-sm md:col-span-2">{juristic ? "ที่ตั้งสำนักงานผู้เช่า" : "ที่อยู่ผู้เช่า"}
        <textarea name="lease_tenant_address" rows={2} maxLength={500} defaultValue={v?.tenant_address ?? ""} className={input} /></label>
      <label className="text-sm">สถานที่ทำสัญญา (ทำที่)
        <select name="lease_contract_place_type" value={place} onChange={(e) => setPlace(e.target.value)} className={input}>
          {opt.owners.length > 0 && <option value="LESSOR">ที่อยู่ผู้ให้เช่า (จากหน้า Family)</option>}
          {opt.businesses.length > 0 && <option value="BUSINESS">ที่อยู่กิจการ (Private Business)</option>}
          <option value="TEXT">พิมพ์เอง</option>
          <option value="">— เว้นให้เขียนเอง —</option>
        </select>
      </label>
      {place === "LESSOR" && (
        <label className="text-sm">ผู้ให้เช่า
          <select name="lease_contract_place_person_id" defaultValue={v?.contract_place_person_id ?? opt.owners[0]?.id ?? ""} className={input}>
            {opt.owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.address ? "" : " (ยังไม่มีที่อยู่)"}</option>)}
          </select>
        </label>
      )}
      {place === "BUSINESS" && (
        <label className="text-sm">กิจการ
          <select name="lease_contract_place_business_id" defaultValue={v?.contract_place_business_id ?? opt.businesses[0]?.asset_id ?? ""} className={input}>
            {opt.businesses.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.company_name}</option>)}
          </select>
        </label>
      )}
      {place === "TEXT" && (
        <label className="text-sm">ทำที่<input name="lease_contract_place_text" maxLength={500} defaultValue={v?.contract_place_text ?? ""} placeholder="เช่น บ้านเลขที่ … ถนน … เขต …" className={input} /></label>
      )}
      <label className="text-sm">แจ้งเลิกสัญญาล่วงหน้า (วัน)
        <input name="lease_notice_days" type="number" min={0} max={365} defaultValue={v?.notice_days ?? NOTICE_DAYS_DEFAULT} className={input} /></label>
      <label className="text-sm">ค่าเสียหายส่งมอบคืนล่าช้า (ต่อวัน)
        <input name="lease_late_return_fee_per_day" inputMode="decimal" defaultValue={v?.late_return_fee_per_day ?? ""} placeholder="ว่าง = เว้นให้เขียนเอง" className={input} /></label>
      <label className="text-sm">พยานคนที่ 1<input name="lease_witness1_name" maxLength={200} defaultValue={v?.witness1_name ?? ""} placeholder="ว่าง = เว้นให้เขียนเอง" className={input} /></label>
      <label className="text-sm">พยานคนที่ 2<input name="lease_witness2_name" maxLength={200} defaultValue={v?.witness2_name ?? ""} placeholder="ว่าง = เว้นให้เขียนเอง" className={input} /></label>
    </div>
  );
}
