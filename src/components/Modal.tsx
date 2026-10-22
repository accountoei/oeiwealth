"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

const TOAST_EVENT = "fwv-toast";
const stack: object[] = [];                                 // หน้าต่างซ้อนกัน: Esc ปิดเฉพาะบนสุด

/**
 * หน้าต่าง pop up ของฟอร์มที่เปิดจากปุ่ม (ใช้ผ่าน useActionSlot ใน ActionBar.tsx)
 *   ปิด: ปุ่ม ✕ · ปุ่ม ปิด / ยกเลิก ของฟอร์ม · กด Esc — คลิกนอกหน้าต่างไม่ปิด (กันข้อมูลที่กรอกหาย)
 *   บันทึกสำเร็จ (ฟอร์มขึ้นข้อความสีเขียวใหม่หลังกดบันทึก) → ปิดเอง + แจ้งข้อความมุมจอ + รีเฟรชหน้า
 *   ไม่ต้องการให้ปิดเอง (เช่น ถามต่อหลังบันทึก) → ใส่ data-keep-open ในเนื้อหา
 */
export default function Modal({ children, onClose, size = "md", title }: { children: ReactNode; onClose: () => void; size?: "md" | "lg"; title?: string }) {
  const [mounted, setMounted] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => { setMounted(true); }, []);
  // Esc = ปิด · ล็อกการเลื่อนหน้าหลังระหว่างเปิด
  useEffect(() => {
    const me = {};
    stack.push(me);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stack[stack.length - 1] === me) close.current(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      document.body.style.overflow = stack.length ? "hidden" : prev;
    };
  }, []);
  // บันทึกสำเร็จ → ปิดเอง
  //   หลังกดบันทึก: รอจนปุ่มที่ถูกปิดระหว่างบันทึกกลับมากดได้ (หรือมีข้อความสีเขียวใหม่) → ไม่มีข้อความสีแดง + มีข้อความสีเขียว = สำเร็จ
  useEffect(() => {
    const el = body.current;
    if (!mounted || !el) return;
    const greens = () => [...el.querySelectorAll(".text-emerald-700")].map((n) => (n.textContent ?? "").trim()).filter(Boolean);
    const disabledCount = () => el.querySelectorAll("button[disabled]").length;
    // ปุ่มสีแดง (เช่น ลบโลโก้) ไม่ใช่ข้อความผิดพลาด
    const hasError = () => !!el.querySelector(".text-red-600:not(button), .text-red-700:not(button)");
    let armed: { greens: Set<string>; base: number; busy: boolean } | null = null;
    const onSubmit = () => { armed = { greens: new Set(greens()), base: disabledCount(), busy: false }; };
    el.addEventListener("submit", onSubmit, true);
    const obs = new MutationObserver(() => {
      if (!armed || el.querySelector("[data-keep-open]")) return;
      const d = disabledCount();
      if (d > armed.base) { armed.busy = true; return; }      // กำลังบันทึก
      const g = greens();
      const fresh = g.find((t) => !armed!.greens.has(t));
      if (!fresh && !(armed.busy && g.length)) return;
      if (hasError()) { armed = null; return; }                // บันทึกไม่สำเร็จ → หน้าต่างยังเปิด
      armed = null;
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: fresh ?? g[0] }));
      close.current();
      routerRef.current.refresh();                             // ดึงข้อมูลหน้านี้ใหม่ทันที (ไม่ต้องกดรีเฟรชเอง) + ล้างหน้าที่จำไว้
    });
    obs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
    return () => { el.removeEventListener("submit", onSubmit, true); obs.disconnect(); };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 md:p-10" role="dialog" aria-modal="true">
      <div className={`relative w-full ${size === "lg" ? "max-w-6xl" : "max-w-3xl"} rounded-xl bg-white p-5 pt-10 text-left shadow-xl`}>
        <button type="button" onClick={() => close.current()} aria-label="ปิด"
          className="absolute right-3 top-3 rounded-md px-2 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800">✕</button>
        {title && <h2 className="-mt-6 mb-4 pr-8 font-medium text-slate-900">{title}</h2>}
        {/* กรอบ / พื้นหลังของฟอร์มเดิมไม่ต้องซ้อนในหน้าต่าง */}
        <div ref={body} className="[&>*:first-child]:mt-0 [&>*:first-child]:rounded-none [&>*:first-child]:border-0 [&>*:first-child]:bg-transparent [&>*:first-child]:p-0">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** ข้อความแจ้งมุมจอ หลังหน้าต่างปิดเพราะบันทึกสำเร็จ (วางไว้ที่ layout หลัก) */
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setMsg(String((e as CustomEvent).detail ?? ""));
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3500);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => { window.removeEventListener(TOAST_EVENT, on); clearTimeout(t); };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg" role="status">
      {msg}
    </div>
  );
}
