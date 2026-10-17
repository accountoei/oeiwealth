"use client";

import { useState, type ReactNode } from "react";
import Modal from "./Modal";

/** กล่องรายละเอียด: ดูอย่างเดียว → กด "แก้ไขข้อมูล" เปิดหน้าต่าง pop up สำหรับแก้ (หน้าบัญชีธนาคาร · เงินให้กู้ · ธุรกิจ) */
export default function EditToggle({ title, view, edit, canEdit, actions }: {
  title: string; view: ReactNode; edit: ReactNode; canEdit: boolean;
  /** ปุ่มอื่นข้างหัวกล่อง (ถ้ามี) */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {canEdit && (
            <button type="button" onClick={() => setOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">แก้ไขข้อมูล</button>
          )}
        </div>
      </div>
      {view}
      {open && <Modal title={`แก้ไข${title}`} size="lg" onClose={() => setOpen(false)}>{edit}</Modal>}
    </div>
  );
}
