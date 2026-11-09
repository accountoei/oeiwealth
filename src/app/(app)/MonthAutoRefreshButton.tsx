"use client";

import { useActionState } from "react";
import Flash from "@/components/Flash";
import { SMALL_BTN, type FormState } from "@/lib/format";
import { refreshMonthAutoNow } from "./dashboard-detail";

/** ปุ่มเล็กมุมขวาล่างกล่องกราฟ Net Worth (ADMIN / EDITOR · เจ้าของขอ 9 พ.ย. 2026)
 *  ทำงานเดียวกับงานเช้า 07:30 ทันที → บันทึกรายการย้อนหลังแล้วไม่ต้องรอถึงพรุ่งนี้ จุดสิ้นเดือนในกราฟจึงเปลี่ยน */
export default function MonthAutoRefreshButton() {
  const [state, action, pending] = useActionState<FormState>(refreshMonthAutoNow, {});
  return (
    <form action={action} className="ml-auto flex items-center gap-2">
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      <Flash on={state} className="text-xs text-emerald-700" />
      <button disabled={pending} className={SMALL_BTN}
        title="จุดสิ้นเดือนที่ยังไม่ปิดคำนวณใหม่ทุกเช้า 07:30 · กดเพื่อคำนวณทันทีหลังบันทึกรายการย้อนหลัง (เดือนที่ปิดแล้วไม่เปลี่ยน)">
        {pending ? "กำลังคำนวณ…" : "คำนวณยอดสิ้นเดือนใหม่"}
      </button>
    </form>
  );
}
