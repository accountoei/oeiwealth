"use client";

import { useState } from "react";
import BankOptions from "@/components/BankOptions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

type Opt = { id: string; name: string };
/** บัญชีที่เลือกเป็น "บัญชีของผู้กู้" ได้ · owners = สมาชิกที่เป็นเจ้าของบัญชี */
export type BorrowerBank = { asset_id: string; name: string; currency: string; owners: string[] };

/**
 * เลือกคู่สัญญาเงินกู้: บุคคลภายนอก (พิมพ์ชื่อ) / สมาชิกในครอบครัว / กิจการ (Private Business) · ตกลง 2 พ.ย. 2026
 * เลือกสมาชิก / กิจการ → เติมชื่อให้ (แก้ต่อได้) · ส่ง personField / businessField ไปกับฟอร์ม (ว่าง = ภายนอก)
 */
export default function PartyPicker({ label, nameField, personField, businessField, persons, businesses, v, required, placeholder, kindLabel,
  bankField, banks }: {
  label: string; nameField: string; personField?: string; businessField: string;
  persons?: Opt[]; businesses: Opt[];
  v?: { name?: string | null; personId?: string | null; businessId?: string | null; bankId?: string | null };
  required?: boolean; placeholder?: string; kindLabel: string;
  /** ผู้กู้เป็นสมาชิก: เลือกบัญชีของผู้กู้ → ระบบบันทึกเงินเข้า–ออกฝั่งผู้กู้ให้ (ตกลง 2 พ.ย. 2026) */
  bankField?: string; banks?: BorrowerBank[];
}) {
  const [kind, setKind] = useState(v?.personId ? "PERSON" : v?.businessId ? "BUSINESS" : "EXTERNAL");
  const [pid, setPid] = useState(v?.personId ?? "");
  const [bid, setBid] = useState(v?.businessId ?? "");
  const [name, setName] = useState(v?.name ?? "");
  const [bank, setBank] = useState(v?.bankId ?? "");
  const myBanks = (banks ?? []).filter((b) => b.owners.includes(pid) || b.asset_id === bank);
  const pick = (list: Opt[], id: string) => { const n = list.find((x) => x.id === id)?.name; if (n) setName(n); };
  return (
    <>
      <label className="block text-sm text-slate-700">{kindLabel}
        <select value={kind} onChange={(e) => {
          const k = e.target.value; setKind(k);
          if (k === "PERSON" && persons?.length) { const id = pid || persons[0].id; setPid(id); pick(persons, id); }
          if (k === "BUSINESS" && businesses.length) { const id = bid || businesses[0].id; setBid(id); pick(businesses, id); }
        }} className={input}>
          <option value="EXTERNAL">บุคคล / สถาบันภายนอก</option>
          {persons && persons.length > 0 && <option value="PERSON">สมาชิกในครอบครัว</option>}
          {businesses.length > 0 && <option value="BUSINESS">กิจการของครอบครัว (Private Business)</option>}
        </select>
      </label>
      {kind === "PERSON" && persons && personField && (
        <label className="block text-sm text-slate-700">สมาชิก
          <select name={personField} value={pid} onChange={(e) => { setPid(e.target.value); pick(persons, e.target.value); setBank(""); }} className={input}>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {kind === "PERSON" && bankField && banks && (
        <label className="block text-sm text-slate-700">บัญชีของผู้กู้
          <select name={bankField} value={bank} onChange={(e) => setBank(e.target.value)} className={input}>
            <option value="">— ไม่บันทึกฝั่งผู้กู้ —</option>
            <BankOptions banks={myBanks} ccy />
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            {bank ? "ระบบบันทึกให้เอง: จ่ายเงินกู้ = เงินเข้าบัญชีนี้ · รับชำระ = เงินต้นออกจากบัญชีนี้ + ค่าใช้จ่ายดอกเบี้ยจ่ายของผู้กู้"
              : myBanks.length ? "เลือกบัญชี → ระบบบันทึกเงินเข้า–ออกฝั่งผู้กู้ให้อัตโนมัติ" : "สมาชิกคนนี้ยังไม่มีบัญชีธนาคารในระบบ"}
          </span>
        </label>
      )}
      {kind === "BUSINESS" && (
        <label className="block text-sm text-slate-700">กิจการ
          <select name={businessField} value={bid} onChange={(e) => { setBid(e.target.value); pick(businesses, e.target.value); }} className={input}>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {/* ภายนอก: ไม่ส่ง id (ล้างค่าเดิม) */}
      {kind !== "PERSON" && personField && <input type="hidden" name={personField} value="" />}
      {kind !== "BUSINESS" && <input type="hidden" name={businessField} value="" />}
      {kind !== "PERSON" && bankField && <input type="hidden" name={bankField} value="" />}
      <label className="block text-sm text-slate-700">{label}{required && " *"}
        <input name={nameField} required={required} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className={input} />
        {kind !== "EXTERNAL" && <span className="mt-1 block text-xs text-slate-500">ชื่อในสัญญา (เติมให้จากที่เลือก · แก้ได้)</span>}
      </label>
    </>
  );
}
