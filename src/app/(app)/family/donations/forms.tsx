"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionSlot } from "@/components/ActionBar";
import { DeleteSlot } from "@/components/RowActions";
import ModalButton from "@/components/ModalButton";
import { useNavPending } from "@/components/HeaderBar";
import { DONATION_FORM_LABEL, DONATION_TAX_KIND_LABEL, DONATION_TAX_STATUS_LABEL, DONEE_TYPE_LABEL } from "@/lib/format";
import { saveDonation, type ActionState } from "./actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
export type Opt = { id: string; name: string };
export type DonationValues = {
  id?: string; donation_date: string; year_only?: boolean; donor: string; donor_name?: string | null; claimant_person_id?: string | null;
  donee_name?: string | null; donee_type?: string | null; purpose?: string | null; donation_form?: string; amount?: number | null;
  receipt_no?: string | null; project_name?: string | null; tax_status?: string; tax_kind?: string | null; e_donation?: boolean;
  expense_item_id?: string | null; notes?: string | null;
};

/** ช่องกรอกชุดเดียวกัน: เพิ่มใหม่ · แก้ไข · กรอกรายละเอียดจากรายจ่ายหมวดบริจาค */
function Fields({ v, persons, businesses, lockAmount }: { v: DonationValues; persons: Opt[]; businesses: Opt[]; lockAmount?: boolean }) {
  const [donor, setDonor] = useState(v.donor);
  const [tax, setTax] = useState(v.tax_status ?? "PENDING");
  const [yearOnly, setYearOnly] = useState(!!v.year_only);
  const isPerson = donor.startsWith("p:");
  return (
    <>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {v.expense_item_id && <input type="hidden" name="expense_item_id" value={v.expense_item_id} />}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">{yearOnly ? "ปี (ยอดรวมทั้งปี)" : "วันที่บริจาค"} *
          <input name="donation_date" type="date" required defaultValue={v.donation_date} className={input} />
          <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" name="year_only" checked={yearOnly} onChange={(e) => setYearOnly(e.target.checked)} /> มีแค่ยอดรวมทั้งปี</span>
        </label>
        <label className="text-sm">ผู้บริจาค *
          <select name="donor" value={donor} onChange={(e) => setDonor(e.target.value)} className={input}>
            <optgroup label="สมาชิก">{persons.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
            {businesses.length > 0 && <optgroup label="ในนามกิจการ">{businesses.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}</optgroup>}
            <option value="g">ไม่ระบุ / กลุ่ม</option>
          </select>
        </label>
        {isPerson ? (
          <label className="text-sm">ผู้ใช้สิทธิลดหย่อน
            <select key={donor} name="claimant_person_id" defaultValue={v.donor === donor ? (v.claimant_person_id ?? "") : donor.slice(2)} className={input}>
              <option value="">— ไม่ระบุ —</option>
              {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : donor === "g" ? (
          <label className="text-sm">ชื่อกลุ่ม / ผู้บริจาคตามเอกสาร<input name="donor_name" defaultValue={v.donor_name ?? ""} className={input} /></label>
        ) : <div className="self-end pb-2 text-xs text-slate-500">บริจาคในนามกิจการ — ไม่นับในภาษีบุคคล</div>}
        <label className="text-sm">ผู้รับบริจาค *<input name="donee_name" required defaultValue={v.donee_name ?? ""} placeholder="เช่น วัด… / มูลนิธิ… / โรงเรียน…" className={input} /></label>
        <label className="text-sm">ประเภทผู้รับ
          <select name="donee_type" defaultValue={v.donee_type ?? ""} className={input}>
            <option value="">— ไม่ระบุ —</option>
            {Object.entries(DONEE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm">วัตถุประสงค์ / รายการ<input name="purpose" defaultValue={v.purpose ?? ""} placeholder="เช่น ทุนการศึกษา / สร้างอาคาร" className={input} /></label>
        <label className="text-sm">รูปแบบ
          <select name="donation_form" defaultValue={v.donation_form ?? "CASH"} className={input}>
            {Object.entries(DONATION_FORM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm">จำนวนเงิน / มูลค่า (บาท) *
          <input name="amount" inputMode="decimal" required defaultValue={v.amount == null ? "" : String(v.amount)} readOnly={lockAmount}
            className={`${input} text-right ${lockAmount ? "bg-slate-50 text-slate-600" : ""}`} />
        </label>
        <label className="text-sm">เลขที่ใบอนุโมทนา / ใบรับ<input name="receipt_no" defaultValue={v.receipt_no ?? ""} autoComplete="off" className={input} /></label>
        <label className="text-sm">โครงการ<input name="project_name" defaultValue={v.project_name ?? ""} placeholder="รวมหลายรายการเป็นโครงการเดียว (ถ้ามี)" className={input} /></label>
        {isPerson && (
          <>
            <label className="text-sm">สิทธิลดหย่อนภาษี
              <select name="tax_status" value={tax} onChange={(e) => setTax(e.target.value)} className={input}>
                {Object.entries(DONATION_TAX_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {tax !== "NONE" && (
              <label className="text-sm">ประเภทการหัก
                <select name="tax_kind" defaultValue={v.tax_kind ?? ""} className={input}>
                  <option value="">— ยังไม่ระบุ —</option>
                  {Object.entries(DONATION_TAX_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            )}
            {tax !== "NONE" && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="e_donation" defaultChecked={!!v.e_donation} /> อยู่ในระบบ e-Donation</label>}
          </>
        )}
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" defaultValue={v.notes ?? ""} className={input} /></label>
      </div>
    </>
  );
}

function Buttons({ pending, state, del }: { pending: boolean; state: ActionState; del?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
      {del && <DeleteSlot />}
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
    </div>
  );
}

const note = <p className="text-xs text-slate-500">บันทึกประวัติอย่างเดียว ไม่ตัดเงินจากบัญชี · ถ้าจ่ายเงินแล้วหลัง Go-live ให้บันทึกรายจ่ายหมวด &ldquo;บริจาค&rdquo; ที่ Income &amp; Expenses แล้วกด &ldquo;กรอกรายละเอียด&rdquo; ที่หน้านี้ (ไม่นับเงินออกซ้ำ)</p>;

/** ปุ่ม "+ บันทึกการบริจาค" (แถวแท็บ) */
export function DonationAdd({ persons, businesses, today }: { persons: Opt[]; businesses: Opt[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveDonation, {});
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700")}>+ บันทึกการบริจาค</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h3 className="font-medium text-slate-900">บันทึกการบริจาค</h3>
      <Fields v={{ donation_date: today, donor: persons[0] ? `p:${persons[0].id}` : "g" }} persons={persons} businesses={businesses} />
      {note}
      <Buttons pending={pending} state={state} />
    </form>
  ));
}

/** ฟอร์มแก้ไขในหน้าต่างของแถว (RowActions editor) */
export function DonationEditor({ v, persons, businesses }: { v: DonationValues; persons: Opt[]; businesses: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveDonation, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  return (
    <form action={action} className="space-y-3">
      <Fields v={v} persons={persons} businesses={businesses} />
      <Buttons pending={pending} state={state} del />
    </form>
  );
}

/** รายจ่ายหมวดบริจาคที่ยังไม่มีรายละเอียด → กรอกรายละเอียด (ยอดตามรายจ่าย) */
export function FromExpense({ v, persons, businesses }: { v: DonationValues; persons: Opt[]; businesses: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveDonation, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  return (
    <ModalButton label="กรอกรายละเอียด" title="กรอกรายละเอียดการบริจาค" size="lg">
      <form action={action} className="space-y-3">
        <Fields v={v} persons={persons} businesses={businesses} lockAmount />
        <p className="text-xs text-slate-500">ผูกกับรายจ่ายรายการนี้ · ยอดเงินแก้ที่ Income &amp; Expenses</p>
        <Buttons pending={pending} state={state} />
      </form>
    </ModalButton>
  );
}

/** ตัวกรอง ปี / ผู้บริจาค (?y= ปี ค.ศ. · ?d= p:id / b:id / g / persons / business) */
export function DonationFilters({ years, persons, businesses, y, d }: { years: number[]; persons: Opt[]; businesses: Opt[]; y: string; d: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { start } = useNavPending();
  const go = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    start(() => router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  const cls = (on: boolean) => `rounded-md border px-3 py-1.5 text-sm ${on ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white"}`;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <select aria-label="ปี" value={y} onChange={(e) => go("y", e.target.value)} className={cls(!!y)}>
        <option value="">ทุกปี (สรุปรายปี)</option>
        {years.map((x) => <option key={x} value={x}>ปี {x + 543}</option>)}
      </select>
      <select aria-label="ผู้บริจาค" value={d} onChange={(e) => go("d", e.target.value)} className={cls(!!d)}>
        <option value="">ผู้บริจาคทั้งหมด</option>
        <option value="persons">เฉพาะบุคคล</option>
        {persons.map((p) => <option key={p.id} value={`p:${p.id}`}>· {p.name}</option>)}
        {businesses.length > 0 && <option value="business">เฉพาะในนามกิจการ</option>}
        {businesses.map((b) => <option key={b.id} value={`b:${b.id}`}>· {b.name}</option>)}
        <option value="g">ไม่ระบุ / กลุ่ม</option>
      </select>
    </div>
  );
}
