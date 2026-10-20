"use client";

import { useState, type ReactNode } from "react";
import Modal from "./Modal";

/** ปุ่ม "แก้ไขข้อมูล" มุมขวาบนของหน้ารายละเอียด → หน้าต่าง pop up รวมฟอร์มแก้ไขทั้งหมด (ข้อมูล · เจ้าของ · สถานะ) */
export default function EditButton({ title = "แก้ไขข้อมูล", label = "แก้ไขข้อมูล", children, small }: { title?: string; label?: string; children: ReactNode; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-md bg-blue-600 text-sm text-white hover:bg-blue-700 ${small ? "px-3 py-1.5" : "px-4 py-2"}`}>{label}</button>
      {open && <Modal title={title} size="lg" onClose={() => setOpen(false)}>{children}</Modal>}
    </>
  );
}
