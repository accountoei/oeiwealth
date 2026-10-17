"use client";

import { useState, type ReactNode } from "react";

/** กล่องรายละเอียด: ดูอย่างเดียว → กด "แก้ไขข้อมูล" เพื่อเปิดส่วนแก้ไข (หน้าบัญชีธนาคาร · เงินให้กู้) */
export default function EditToggle({ title, view, edit, canEdit }: { title: string; view: ReactNode; edit: ReactNode; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">{title}</h2>
        {canEdit && (
          <button type="button" onClick={() => setOpen(!open)}
            className={open ? "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" : "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"}>
            {open ? "ปิดการแก้ไข" : "แก้ไขข้อมูล"}
          </button>
        )}
      </div>
      {open ? edit : view}
    </div>
  );
}
