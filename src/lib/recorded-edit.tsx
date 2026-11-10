import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import RowActions, { type FieldSpec } from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import PairEdit from "@/components/PairEdit";
import { money, thDate } from "@/lib/format";

/**
 * รายการที่บันทึกแล้วในแท็บบันทึกรับ / จ่าย (ตกลง 28 ต.ค. 2026) — กดยอดที่รับ / จ่ายแล้วเพื่อเปิดหน้าต่างแก้ไขเดิม (บันทึก · ลบ)
 *   ทยอยรับ / จ่ายหลายครั้ง = บรรทัดละครั้ง แก้ / ลบแยกกัน · ช่องกรอกในตารางใช้ "บันทึกเพิ่ม" อย่างเดียว
 *   ฟอร์มใช้ชุดเดียวกับหน้าต้นทาง (src/lib/source-edit.ts / ฟอร์มรายการลงทุน) · กติกา (งวดปิด / สิทธิ์) อยู่ในฐานข้อมูลเหมือนเดิม
 */
export type Recorded = { id: string; node: ReactNode };

/** หน้าตาลิงก์ของยอดที่บันทึกแล้วในแท็บบันทึกรับ / จ่าย (กดเพื่อแก้) */
export const REC_LINK = "text-left text-xs text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
const TEXT = "text-xs text-emerald-700";

/** ข้อความบรรทัด (สั้น ให้อยู่บรรทัดเดียวในช่องตัวเลข): "รับแล้ว 5 ต.ค. · 500.00" · สกุลเงินแสดงเฉพาะที่ไม่ใช่ THB */
export const recLabel = (verb: string, date: string, amount: number, ccy?: string) =>
  `${verb} ${thDate(date).replace(/ \d{4}$/, "")} · ${money(amount, ccy && ccy !== "THB" ? ccy : undefined)}`;

/** บรรทัดที่กดแก้ไขได้ (ไม่มีสิทธิ์แก้ = ข้อความเฉย ๆ) */
export function recEdit(o: {
  canWrite: boolean; label: string; table: string; id: string; paths: string[]; fields?: FieldSpec[];
  canDelete: boolean; deleteEffect?: string; deleteNote?: string;
  /** ฟอร์มแก้ไขของหน้านั้นเอง (เช่น EntryEditor ชุดเดียวกับ Income & Expenses) — ใช้แทน fields */
  editor?: ReactNode;
  /** ปุ่มลบแบบอื่น (เช่น ลบทั้งก้อน) — วางข้างปุ่มบันทึกแทนปุ่มลบปกติ (ใช้กับ canDelete: false) */
  deleteControl?: ReactNode;
}): ReactNode {
  if (!o.canWrite) return <span className={TEXT}>{o.label}</span>;
  return <RowActions table={o.table} id={o.id} paths={o.paths} fields={o.fields} editor={o.editor} canDelete={o.canDelete} deleteEffect={o.deleteEffect}
    deleteNote={o.deleteNote} deleteControl={o.deleteControl} button={`${o.label} ✎`} buttonClass={REC_LINK} />;
}

/**
 * การรับ / จ่ายครั้งเดียวกัน (เงินต้น + ดอกเบี้ย) → บรรทัดเดียว "รับชำระ 5 ต.ค. · 20,000.00 ✎" (ยอดรวมเงินต้น + ดอกเบี้ย)
 *   กดแล้วแก้ทั้งคู่ในหน้าต่างเดียว · ลบทั้งก้อนอยู่ข้างปุ่มบันทึก (ตกลง 4 พ.ย. 2026)
 */
export function recPair(o: { canWrite: boolean; label: string } & Omit<ComponentProps<typeof PairEdit>, "button" | "buttonClass">): ReactNode {
  const { canWrite, label, ...rest } = o;
  if (!canWrite) return <span className={TEXT}>{label}</span>;
  return <PairEdit {...rest} button={`${label} ✎`} buttonClass={REC_LINK} />;
}

/** บรรทัดที่แก้ที่หน้านี้ไม่ได้ → ลิงก์ไปหน้าต้นทาง */
export function recLink(label: string, href: string): ReactNode {
  return <Link href={href} className={REC_LINK} title="แก้ / ลบที่หน้าต้นทาง">{label} →</Link>;
}

/** ปุ่มลบการรับ / จ่ายครั้งเดียวกันทั้งก้อน (เงินต้น + ดอกเบี้ย) — วางข้างปุ่มบันทึกในหน้าต่างแก้ไขของแต่ละส่วน (deleteControl) */
export function wholeUndo(group: string, paths: string[], text: string): ReactNode {
  return <UndoButton kind="PAYMENT" id={group} paths={paths} label="ลบรายการนี้ทั้งก้อน" size="md" confirmText={text} />;
}

/** แสดงรายการที่บันทึกแล้ว (บรรทัดละครั้ง) */
export function RecordedLines({ items }: { items?: Recorded[] }) {
  if (!items?.length) return null;
  return <>{items.map((x) => <div key={x.id} className="whitespace-nowrap leading-5">{x.node}</div>)}</>;
}
