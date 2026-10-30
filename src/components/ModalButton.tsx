"use client";

import { useState, type ReactNode } from "react";
import Modal from "./Modal";

// ปุ่มเปิดหน้าต่าง pop up (ใช้ในกล่องมูลค่าล่าสุด: อัปเดตมูลค่า / ประวัติ · ตกลง 27 ต.ค. 2026)
export default function ModalButton({ label, title, size = "md", primary = false, className, children }: {
  label: ReactNode; title?: string; size?: "md" | "lg"; primary?: boolean; /** แทนรูปปุ่มเดิม (เช่น เป็นลิงก์) */ className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cls = className ?? (primary
    ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
    : "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}>{label}</button>
      {open && <Modal size={size} title={title} onClose={() => setOpen(false)}>{children}</Modal>}
    </>
  );
}
