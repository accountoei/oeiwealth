"use client";

import { useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Flash from "./Flash";
import { InfoTip } from "./HeaderBar";
import { useConfirmSubmit } from "./ConfirmDialog";

/**
 * แถบบันทึกของตารางบันทึกหลายรายการ (แท็บอัปเดตยอด / มูลค่า และแท็บบันทึกรับ / จ่าย ทุกเมนู · ตกลง 5 พ.ย. 2026)
 *   อยู่ด้านบนตาราง ชิดขวา (ใน <BatchBar>) เรียงเหมือนกันทุกหน้า: [ข้อความผิดพลาด / หมายเหตุ] · [หัก ณ ที่จ่าย x% / วิธีประเมิน] · ล้างช่องที่กรอก · [บันทึก N รายการ] · ณ วันที่ [วันที่] ⓘ
 *   "ล้างช่องที่กรอก" อยู่ที่เดิมเสมอ (ยังไม่ได้กรอก = สีจาง กดไม่ได้) → ปุ่มไม่ขยับ
 *   หน้าต่างยืนยันของแต่ละหน้ายังบอกชื่อเต็ม (บันทึกรับดอกเบี้ย 2 บัญชี ณ วันที่ …) · ไม่มีสิทธิ์บันทึก = แสดงเฉพาะช่องวันที่
 *   กล่อง / แถวที่ครอบแถบนี้ใส่ STICKY_BAR → ค้างใต้แถบบนตอนเลื่อนตารางยาว ๆ ลง (จอ iPad ขึ้นไป · มือถือไม่ค้าง กันบังจอ)
 */
export const STICKY_BAR = "z-[5] md:sticky md:top-[var(--app-header-h,4rem)]";

const SMALL = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/**
 * การบันทึกของตารางบันทึกหลายรายการ — ทุกแท็บใช้ตัวนี้ (แทนการเขียน useActionState + หน้าต่างยืนยัน + โหลดใหม่เองทุกหน้า)
 *   save = server action ของหน้า · บันทึกสำเร็จ → onSaved() (ล้างช่องที่กรอก ฯลฯ) แล้วโหลดตัวเลขใหม่จากฐานข้อมูล
 *   confirm(ข้อความ) → ใส่เป็น onSubmit ของ <BatchSave> (ปุ่มยืนยัน "ยืนยันบันทึก") · วาง dialog ไว้ในหน้า (นอก <form>)
 *   ล้างช่องใน action เอง ไม่ใช่ใน useEffect → ไม่ render ซ้ำสองรอบหลังบันทึก
 */
export function useBatchSave<S extends { ok?: string | null }>(save: (prev: S, form: FormData) => Promise<S>, onSaved: () => void) {
  const router = useRouter();
  const [state, action, pending] = useActionState<S, FormData>(async (prev, form) => {
    const r = await save(prev as S, form);
    if (r.ok) { onSaved(); router.refresh(); }
    return r as Awaited<S>;
  }, {} as Awaited<S>);
  const { guard, dialog } = useConfirmSubmit();
  const confirm = (text: string, enabled = true) => guard(text, { okLabel: "ยืนยันบันทึก" }, enabled);
  return { state, action, pending, confirm, dialog };
}

/** ข้อความเล็กในแถบบันทึก (note ของ <BatchSave>): ยอดที่กรอกไว้ในแถวที่ตัวกรองซ่อนอยู่ ยังบันทึกด้วย · 0 = ไม่แสดง */
export function HiddenFilled({ count, label }: { count: number; /** เช่น "บัญชีที่กรอกไว้ในธนาคารอื่น" */ label: string }) {
  return count > 0 ? <span className="text-xs text-amber-700">รวม {count} {label}</span> : null;
}

/**
 * แถบบนของแท็บบันทึกหลายรายการ — เรียงเหมือนกันทุกหน้า (ตกลง 6 พ.ย. 2026):
 *   ซ้าย: [ชื่อ ⓘ] [ตัวกรอง] [ใส่ยอดทุกแถว] · ขวา (BatchSave): [หัก ณ ที่จ่าย x%] [ล้างช่องที่กรอก] [บันทึก N รายการ] ณ วันที่
 *   ตารางด้านล่างไม่มีหัวซ้ำ · ผู้ดู (VIEWER) ยังเห็นชื่อ / ตัวกรอง / วันที่
 */
export function BatchBar({ title, filters, fill, children }: {
  /** ชื่อตาราง (ใส่ InfoTip ต่อท้ายได้) */
  title?: ReactNode;
  /** ตัวกรอง (FilterSelect / ปี) */
  filters?: ReactNode;
  /** <FillAll /> */
  fill?: ReactNode;
  /** <BatchSave /> (ไม่มีสิทธิ์บันทึก = ไม่ใส่) */
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm ${STICKY_BAR}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {title && <h2 className="flex flex-wrap items-center gap-1 text-base font-medium text-slate-900">{title}</h2>}
          {filters}
          {fill}
        </div>
        {children}
      </div>
    </div>
  );
}

/** ตัวกรองในแถบบน: ป้าย + ช่องเลือก ("ทั้งหมด" = ค่าว่าง) · มีตัวเลือกเดียวไม่ต้องแสดง */
export function FilterSelect({ label, value, onChange, options, allLabel = "ทั้งหมด" }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]; allLabel?: string;
}) {
  if (options.length < 2 && !value) return null;
  return (
    <label className="flex items-center gap-2 text-sm">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`max-w-[16rem] ${SMALL}`}>
        <option value="">{allLabel}</option>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

/** "ใส่ยอดทุกแถว" — ชื่อเดียวกันทุกหน้า · ต่อจากตัวกรองทางซ้าย · ไม่มีแถวให้เติม = สีจาง (ไม่หาย ปุ่มไม่ขยับ) */
export function FillAll({ onClick, disabled, label = "ใส่ยอดทุกแถว" }: { onClick: () => void; disabled?: boolean;
  /** ตัวช่วยเติมแบบอื่นในตำแหน่งเดียวกัน (เช่น "กรอกตามงบการเงิน" แท็บอัปเดตมูลค่า Private Business) */ label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="text-sm text-blue-700 hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline">{label}</button>
  );
}

/** บรรทัดสีแดงใต้ตาราง: งวดที่ค้าง (เลยกำหนด ณ วันนี้) — แทนการ์ดสรุปด้านบนของแท็บบันทึก (ตกลง 6 พ.ย. 2026) · ไม่มีค้าง = ไม่แสดง */
export function LateNote({ label, count, unit = "งวด", amounts }: { label: string; count: number; unit?: string; amounts: ReactNode }) {
  if (!count) return null;
  return <p className="px-1 text-sm text-red-700">{label} (เลยกำหนด ณ วันนี้) {count} {unit} · <span className="tabular-nums">{amounts}</span></p>;
}

/** "หัก ณ ที่จ่าย x%" — คิดภาษีให้ทุกแถวที่กรอก · วางเป็น children ของ BatchSave (ก่อน "ล้างช่องที่กรอก") · ตัวจางแบบเดียวกัน */
export function TaxAll({ pct, onClick, disabled }: { pct: number; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="text-sm text-slate-500 underline hover:text-slate-800 disabled:cursor-default disabled:text-slate-300 disabled:no-underline">หัก ณ ที่จ่าย {pct}%</button>
  );
}

export function BatchSave({ canWrite = true, action, onSubmit, fields, count, pending, disabled, onClear, canClear, date, onDate, minDate, maxDate, info, state, note, children }: {
  canWrite?: boolean;
  action: (fd: FormData) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** ช่องซ่อนที่ส่งไปกับฟอร์ม (name → value) */
  fields: Record<string, string>;
  /** จำนวนรายการที่จะบันทึก */
  count: number;
  pending: boolean;
  /** ปิดปุ่มบันทึกเพิ่ม (เช่น ยังกรอกไม่ครบ) */
  disabled?: boolean;
  onClear: () => void;
  /** มีช่องที่กรอกไว้ให้ล้าง (ไม่ใส่ = count > 0) */
  canClear?: boolean;
  date: string;
  onDate: (d: string) => void;
  minDate?: string;
  maxDate?: string;
  /** คำอธิบาย → ⓘ หลังช่องวันที่ */
  info?: ReactNode;
  state: { ok?: string | null; error?: string | null };
  /** ข้อความเล็กก่อน "ล้างช่องที่กรอก" (เช่น รวม 2 รายการที่กรอกไว้ในพอร์ตอื่น) */
  note?: ReactNode;
  /** ปุ่ม / ตัวเลือกที่ใช้กับทั้งชุด วางก่อน "ล้างช่องที่กรอก" (เช่น <TaxAll pct={15} /> · วิธีประเมิน) */
  children?: ReactNode;
}) {
  const dateField = (
    <label className="flex shrink-0 items-center gap-2">ณ วันที่
      <input type="date" value={date} min={minDate || undefined} max={maxDate || undefined} onChange={(e) => e.target.value && onDate(e.target.value)} className={SMALL} />
      {info && <InfoTip label="คำอธิบาย">{info}</InfoTip>}
    </label>
  );
  if (!canWrite) return <div className="ml-auto flex flex-wrap items-center justify-end gap-3">{children}{dateField}</div>;
  const clearable = canClear ?? count > 0;
  return (
    <form action={action} onSubmit={onSubmit} className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      <Flash on={state} as="span" className="text-sm text-emerald-700" />
      {!pending && note}
      {children}
      <button type="button" onClick={onClear} disabled={pending || !clearable}
        className="text-sm text-slate-500 underline hover:text-slate-800 disabled:cursor-default disabled:text-slate-300 disabled:no-underline">ล้างช่องที่กรอก</button>
      <button disabled={pending || count === 0 || disabled} className="rounded-md bg-blue-600 px-4 py-2 text-sm tabular-nums text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? "กำลังบันทึก…" : `บันทึก ${count} รายการ`}
      </button>
      {dateField}
    </form>
  );
}

/** วัดความสูงแถบบน (มี 1–2 บรรทัดตามความกว้างจอ) → --app-header-h ให้แถบที่ค้าง (STICKY_BAR) อยู่ใต้แถบบนพอดี · ใส่ไว้ใน <header> */
export function HeaderHeightVar() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const h = ref.current?.closest("header");
    if (!h) return;
    const set = () => document.documentElement.style.setProperty("--app-header-h", `${h.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(h);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}
