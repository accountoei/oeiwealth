import Link from "next/link";
import type { ReactNode } from "react";
import RowActions, { type FieldSpec } from "@/components/RowActions";
import UndoButton from "@/components/UndoButton";
import { money, thDate } from "@/lib/format";

/**
 * รายการที่บันทึกแล้วในแท็บบันทึกรับ / จ่าย (ตกลง 28 ต.ค. 2026) — กดยอดที่รับ / จ่ายแล้วเพื่อเปิดหน้าต่างแก้ไขเดิม (บันทึก · ลบ)
 *   ทยอยรับ / จ่ายหลายครั้ง = บรรทัดละครั้ง แก้ / ลบแยกกัน · ช่องกรอกในตารางใช้ "บันทึกเพิ่ม" อย่างเดียว
 *   ฟอร์มใช้ชุดเดียวกับหน้าต้นทาง (src/lib/source-edit.ts / ฟอร์มรายการลงทุน) · กติกา (งวดปิด / สิทธิ์) อยู่ในฐานข้อมูลเหมือนเดิม
 */
export type Recorded = { id: string; node: ReactNode };

const LINK = "text-left text-xs text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
const TEXT = "text-xs text-emerald-700";

/** ข้อความบรรทัด (สั้น ให้อยู่บรรทัดเดียวในช่องตัวเลข): "รับแล้ว 5 ต.ค. · 500.00" · สกุลเงินแสดงเฉพาะที่ไม่ใช่ THB */
export const recLabel = (verb: string, date: string, amount: number, ccy?: string) =>
  `${verb} ${thDate(date).replace(/ \d{4}$/, "")} · ${money(amount, ccy && ccy !== "THB" ? ccy : undefined)}`;

/** บรรทัดที่กดแก้ไขได้ (ไม่มีสิทธิ์แก้ = ข้อความเฉย ๆ) */
export function recEdit(o: {
  canWrite: boolean; label: string; table: string; id: string; paths: string[]; fields: FieldSpec[];
  canDelete: boolean; deleteEffect?: string; deleteNote?: string; extra?: ReactNode;
}): ReactNode {
  if (!o.canWrite) return <span className={TEXT}>{o.label}</span>;
  return <RowActions table={o.table} id={o.id} paths={o.paths} fields={o.fields} canDelete={o.canDelete} deleteEffect={o.deleteEffect}
    deleteNote={o.deleteNote} extra={o.extra} button={`${o.label} ✎`} buttonClass={LINK} />;
}

/** บรรทัดที่แก้ที่หน้านี้ไม่ได้ → ลิงก์ไปหน้าต้นทาง */
export function recLink(label: string, href: string): ReactNode {
  return <Link href={href} className={LINK} title="แก้ / ลบที่หน้าต้นทาง">{label} →</Link>;
}

/** ปุ่มลบการรับ / จ่ายครั้งเดียวกันทั้งก้อน (เงินต้น + ดอกเบี้ย) — วางในหน้าต่างแก้ไขของแต่ละส่วน */
export function wholeUndo(group: string, paths: string[], text: string): ReactNode {
  return <UndoButton kind="PAYMENT" id={group} paths={paths} label="ลบรายการนี้ทั้งก้อน" confirmText={text} />;
}

/** แสดงรายการที่บันทึกแล้ว (บรรทัดละครั้ง) */
export function RecordedLines({ items }: { items?: Recorded[] }) {
  if (!items?.length) return null;
  return <>{items.map((x) => <div key={x.id} className="whitespace-nowrap leading-5">{x.node}</div>)}</>;
}
