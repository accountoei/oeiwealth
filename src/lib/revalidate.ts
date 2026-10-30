import { revalidatePath as nextRevalidatePath, revalidateTag, updateTag } from "next/cache";
import { DATA_TAG } from "@/lib/data-cache";

/**
 * revalidatePath ของ Next.js + ล้างผลที่จำไว้ใน "@/lib/data-cache" (Dashboard / ตัวเลข To-Do)
 * ทุก Server Action ที่บันทึกข้อมูลใช้ตัวนี้แทน next/cache → บันทึกแล้วตัวเลขทุกหน้าอัปเดตทันที
 */
export function revalidatePath(...args: Parameters<typeof nextRevalidatePath>): void {
  nextRevalidatePath(...args);
  try {
    updateTag(DATA_TAG);                       // Server Action: คำขอถัดไปคำนวณใหม่ทันที
  } catch {
    revalidateTag(DATA_TAG, { expire: 0 });    // นอก Server Action (Route Handler)
  }
}
