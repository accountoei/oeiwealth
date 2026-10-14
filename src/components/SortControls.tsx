import Link from "next/link";
import { moveSort } from "@/lib/sort-actions";

// ปุ่ม "จัดลำดับ" ต่อท้ายหัวข้อ → โหมดจัดลำดับมีปุ่ม ↑ ↓ ต่อแถว (มีผลทันที) → "เสร็จ"

/** ลิงก์ "จัดลำดับ" / ปุ่ม "เสร็จ" (ใช้ query ?order=…) */
export function SortToggle({ active, href, doneHref }: { active: boolean; href: string; doneHref: string }) {
  return active
    ? <Link href={doneHref} scroll={false} className="rounded-md bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700">เสร็จ</Link>
    : <Link href={href} scroll={false} className="text-xs text-slate-600 underline hover:text-slate-900">จัดลำดับ</Link>;
}

const b = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

/** ↑ ↓ — สลับกับรายการก่อนหน้า / ถัดไปที่มองเห็นในหน้า */
export function MoveButtons({ table, id, prev, next, paths }: { table: string; id: string; prev?: string | null; next?: string | null; paths: string[] }) {
  const f = (other: string | null | undefined, label: string, aria: string) => (
    <form action={moveSort}>
      <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
      <input type="hidden" name="other" value={other ?? ""} /><input type="hidden" name="paths" value={paths.join(",")} />
      <button className={b} disabled={!other} aria-label={aria}>{label}</button>
    </form>
  );
  return <div className="inline-flex shrink-0 gap-1" data-no-row-click>{f(prev, "↑", "เลื่อนขึ้น")}{f(next, "↓", "เลื่อนลง")}</div>;
}

/** เรียงตามลำดับที่ตั้งไว้ (ไม่มีลำดับ = ท้ายสุด ตามลำดับเดิม) */
export function bySort<T>(items: T[], id: (x: T) => string, order: Map<string, number | null>): T[] {
  return items.map((x, i) => ({ x, i, o: order.get(id(x)) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b2) => a.o - b2.o || a.i - b2.i).map((v) => v.x);
}

/** ก่อนหน้า / ถัดไป ของรายการที่ i */
export const neighbors = <T,>(list: T[], i: number, id: (x: T) => string) =>
  ({ prev: i > 0 ? id(list[i - 1]) : null, next: i < list.length - 1 ? id(list[i + 1]) : null });
