"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import Modal from "./Modal";
import { FONT_COOKIE, FONTS, fontKey, fontStack, type FontKey } from "@/lib/fonts";

/** แบบอักษรที่เลือกไว้ที่เครื่องนี้ (อ่านจาก cookie · ใช้หลังผู้ใช้กดเท่านั้น จึงไม่มีปัญหา Server/Browser ไม่ตรงกัน) */
export function currentFont(): FontKey {
  const m = document.cookie.match(new RegExp(`(?:^|; )${FONT_COOKIE}=([^;]*)`));
  return fontKey(m ? decodeURIComponent(m[1]) : null);
}

/** จำไว้ที่เครื่องนี้ 1 ปี + เปลี่ยนทั้งหน้าทันที (ค่าบน <html> ชนะค่าที่ Server ใส่ไว้) */
function applyFont(key: FontKey) {
  document.cookie = `${FONT_COOKIE}=${key}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.style.setProperty("--font-sans", fontStack(key));
}

/**
 * pop up "การแสดงผล" (เมนูผู้ใช้มุมขวาบน · ตกลง 4 พ.ย. 2026): กดแบบไหน เปลี่ยนทั้งหน้าทันที + จำไว้ที่เครื่องนี้ 1 ปี
 * ครั้งต่อไป Server อ่าน cookie แล้วสร้างหน้าด้วยแบบนั้นเลย ((app)/layout.tsx) · เครื่องอื่น / คนอื่นไม่เปลี่ยน
 */
export default function FontPicker({ onClose }: { onClose: () => void }) {
  const [font, setFont] = useState<FontKey>(currentFont);
  const pick = (key: FontKey) => {
    setFont(key);
    applyFont(key);
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium text-slate-900">การแสดงผล</h2>
      <p className="mt-1 text-sm text-slate-600">แบบอักษร · กดเลือกแล้วเปลี่ยนทันที และจำไว้ที่เครื่องนี้ (เครื่องอื่นไม่เปลี่ยน)</p>
      <div role="radiogroup" aria-label="แบบอักษร" className="mt-3 space-y-2">
        {FONTS.map((f) => {
          const on = f.key === font;
          return (
            <button key={f.key} type="button" role="radio" aria-checked={on} onClick={() => pick(f.key)}
              style={{ fontFamily: fontStack(f.key) }}
              className={`block w-full rounded-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                on ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{f.label}</span>
                <span className="text-xs text-slate-500">{f.note}</span>
                {on && <Check className="ml-auto h-4 w-4 shrink-0 text-blue-600" aria-hidden />}
              </span>
              <span className="mt-1 block text-sm text-slate-700">
                สินทรัพย์สุทธิ · เปลี่ยนเพราะอะไร · <span className="tabular-nums">12,345,678.90</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
