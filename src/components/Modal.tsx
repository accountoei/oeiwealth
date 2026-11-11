"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const TOAST_EVENT = "fwv-toast";
const stack: object[] = [];                                 // หน้าต่างซ้อนกัน: ปลดล็อกการเลื่อนหน้าเมื่อปิดครบทุกหน้าต่าง
const noSubscribe = () => () => {};
const InModal = createContext(false);
export type ModalSize = "sm" | "md" | "lg";
const MODAL_WIDTH: Record<ModalSize, string> = { sm: "max-w-md", md: "max-w-3xl", lg: "max-w-6xl" };
/** อยู่ในหน้าต่าง pop up หรือไม่ (Flash ใช้: ในหน้าต่าง = ข้อความในฟอร์ม · นอกหน้าต่าง = แจ้งมุมจอ) */
export const useInModal = () => useContext(InModal);
/** แจ้งข้อความมุมขวาล่าง (ขึ้นแล้วหายเอง) — แสดงโดย Toaster ใน layout หลัก */
export const toast = (msg: string) => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: msg }));

/**
 * หน้าต่าง pop up ของฟอร์มที่เปิดจากปุ่ม (ใช้ผ่าน useActionSlot ใน ActionBar.tsx)
 *   เป็น <dialog> ของ browser (11 พ.ย. 2026): หน้าข้างหลังกดไม่ได้ · Tab วนอยู่ในหน้าต่าง · ปิดแล้วโฟกัสกลับปุ่มที่เปิด
 *   ปิด: ปุ่ม ✕ · กด Esc — คลิกนอกหน้าต่างไม่ปิด (กันข้อมูลที่กรอกหาย)
 *   โฟกัสช่องแรกเมื่อเปิด: ใส่ data-autofocus (autoFocus ของ React ใช้ในหน้าต่างไม่ได้)
 *   ปุ่ม ปิด / ยกเลิก ของฟอร์ม (ใส่ data-close) ซ่อนเมื่ออยู่ในหน้าต่างนี้ (มี ✕ แล้ว · ตกลง 27 ต.ค. 2026) · ฟอร์มที่กางในหน้ายังเห็นปุ่มนี้
 *   บันทึกสำเร็จ (ฟอร์มขึ้นข้อความสีเขียวใหม่หลังกดบันทึก) → ปิดเอง + แจ้งข้อความมุมจอ + รีเฟรชหน้า
 *   ไม่ต้องการให้ปิดเอง (เช่น ถามต่อหลังบันทึก) → ใส่ data-keep-open ในเนื้อหา
 *   ฟอร์มที่ไม่ใช่การบันทึก (เช่น แสดงเลขบัญชีเต็ม) → ใส่ data-no-close ที่ <form> · กดแล้วหน้าต่างไม่ปิด
 *   ข้อความสีเขียวที่แสดงค้างไว้ (เช่น "รวม 100%") → ใส่ data-info · ไม่นับเป็นข้อความบันทึกสำเร็จ
 *   บันทึกไม่สำเร็จ = มีข้อความสีแดงขึ้นใหม่หลังกดบันทึก · สีแดงที่มีอยู่ก่อนกด (ดอกจันช่องบังคับ ตัวเลขติดลบ "เลยกำหนด") ไม่นับ (5 พ.ย. 2026)
 *
 * ขนาด 3 แบบ เลือกตามสิ่งที่อยู่ในหน้าต่าง (ตกลง 6 พ.ย. 2026 · กติกาใน AGENTS.md)
 *   sm (448 px) = ถามยืนยัน / ลบ / ฟอร์ม 1–3 ช่องที่เรียงลงหรือไม่เกิน 2 คอลัมน์
 *   md (768 px · ค่าเริ่มต้น) = ฟอร์มบันทึก / แก้ไข 1 รายการ · ตารางเล็กอ่านอย่างเดียว
 *   lg (1,152 px) = ตารางกว้าง / กรอกหลายแถว / ประวัติ · ฟอร์มยาวหลายส่วน (แก้ไขรายละเอียดของหน้า · สัญญาเช่าใหม่)
 *   ระวัง: sm: / md: / lg: ของ Tailwind ดูความกว้างจอ ไม่ใช่ความกว้างหน้าต่าง → ฟอร์ม 3–4 คอลัมน์ห้ามใช้ sm
 */
export default function Modal({ children, onClose, size = "md", title }: { children: ReactNode; onClose: () => void; size?: ModalSize; title?: string }) {
  // ฝั่งเซิร์ฟเวอร์ = ยังไม่วาด (หน้าต่างเปิดจากการกดเท่านั้น) · ไม่ใช้ setState ใน effect
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dlg = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  const titleId = useId();

  // เปิดเป็น <dialog> ของ browser (showModal · Modern Web Guidance "dialog" · 11 พ.ย. 2026)
  //   browser ทำให้เอง: หน้าข้างหลังกด / Tab ไปไม่ได้ · โฟกัสเข้าหน้าต่าง · Esc ปิดเฉพาะบนสุด · ปิดแล้วโฟกัสกลับปุ่มที่เปิด (ไม่เลื่อนหน้า)
  //   ยังล็อกการเลื่อนหน้าหลังด้วย overflow: hidden เพราะ Safari / iPad ยังไม่รองรับวิธี CSS ที่คู่มือแนะนำ
  useLayoutEffect(() => {
    const d = dlg.current;
    if (!mounted || !d) return;
    const me = {};
    stack.push(me);
    d.showModal();
    // autoFocus ของ React ใช้ในหน้าต่างไม่ได้ (ทำงานก่อนหน้าต่างเปิด) → ใส่ data-autofocus แทน
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // browser ปิดหน้าต่างเอง (Esc) → แจ้งเจ้าของให้เลิกวาด · d.open = เปิดใหม่แล้ว (dev strict mode) → ไม่นับ
    const onClosed = () => { if (!d.open) close.current(); };
    d.addEventListener("close", onClosed);
    return () => {
      d.removeEventListener("close", onClosed);
      if (d.open) d.close();                                  // ปิดก่อนถูกถอดออกจากหน้า → โฟกัสกลับปุ่มที่เปิด
      stack.splice(stack.indexOf(me), 1);
      document.body.style.overflow = stack.length ? "hidden" : prev;
    };
  }, [mounted]);
  // ชื่อหน้าต่างสำหรับโปรแกรมอ่านหน้าจอ: title หรือหัวข้อแรกในเนื้อหา
  useLayoutEffect(() => {
    const d = dlg.current;
    if (!mounted || !d || title) return;
    const h = body.current?.querySelector<HTMLElement>("h1, h2, h3, legend");
    if (h) { h.id ||= `${titleId}-h`; d.setAttribute("aria-labelledby", h.id); }
  }, [mounted, title, titleId]);
  // บันทึกสำเร็จ → ปิดเอง
  //   หลังกดบันทึก: รอจนปุ่มที่ถูกปิดระหว่างบันทึกกลับมากดได้ (หรือมีข้อความสีเขียวใหม่) → ไม่มีข้อความสีแดง + มีข้อความสีเขียว = สำเร็จ
  useEffect(() => {
    const el = body.current;
    if (!mounted || !el) return;
    const greens = () => [...el.querySelectorAll(".text-emerald-700:not([data-info])")].map((n) => (n.textContent ?? "").trim()).filter(Boolean);
    const disabledCount = () => el.querySelectorAll("button[disabled]").length;
    // ตัวหนังสือสีแดง (ปุ่มสีแดง เช่น ลบโลโก้ ไม่นับ) → นับจำนวนตามข้อความ
    const reds = () => {
      const m = new Map<string, number>();
      for (const n of el.querySelectorAll(".text-red-600:not(button):not([data-warn]), .text-red-700:not(button):not([data-warn])")) {
        const t = (n.textContent ?? "").trim();
        m.set(t, (m.get(t) ?? 0) + 1);
      }
      return m;
    };
    // ผิดพลาด = มีสีแดงขึ้นใหม่หลังกดบันทึก (สีแดงที่มีอยู่ก่อน เช่น ดอกจัน * ตัวเลขติดลบ "เลยกำหนด" ไม่นับ)
    const hasError = (before: Map<string, number>) => [...reds()].some(([t, n]) => n > (before.get(t) ?? 0));
    let armed: { greens: Set<string>; reds: Map<string, number>; base: number; busy: boolean } | null = null;
    const onSubmit = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("[data-no-close]")) return;   // ไม่ใช่การบันทึก
      armed = { greens: new Set(greens()), reds: reds(), base: disabledCount(), busy: false };
    };
    el.addEventListener("submit", onSubmit, true);
    const obs = new MutationObserver(() => {
      if (!armed || el.querySelector("[data-keep-open]")) return;
      const d = disabledCount();
      if (d > armed.base) { armed.busy = true; return; }      // กำลังบันทึก
      const g = greens();
      const fresh = g.find((t) => !armed!.greens.has(t));
      if (!fresh && !(armed.busy && g.length)) return;
      if (hasError(armed.reds)) { armed = null; return; }      // บันทึกไม่สำเร็จ → หน้าต่างยังเปิด
      armed = null;
      toast(fresh ?? g[0]);
      close.current();
      // ไม่ต้อง router.refresh(): Server Action ที่บันทึกเรียก revalidatePath แล้ว → คำตอบมีหน้านี้ที่อัปเดตแล้วมาด้วย
      //   (รีเฟรชซ้ำ = ดึงข้อมูลทั้งหน้าอีกรอบ · ตกลง 6 พ.ย. 2026) · เอกสาร (อัปโหลดตรงไป Drive) รีเฟรชเองใน components/docs
    });
    obs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
    return () => { el.removeEventListener("submit", onSubmit, true); obs.disconnect(); };
  }, [mounted]);

  if (!mounted) return null;
  // <dialog> เต็มจอ + พื้นหลังมืด (::backdrop) · กล่องขาวอยู่ข้างใน · ตัวหน้าต่างเลื่อนขึ้นลงได้เมื่อเนื้อหายาว
  //   ส่วนที่ลอยทับ (รายการตัวเลือก / ข้อความใต้ช่องวันที่) ต้องวางไว้ใน <dialog> นี้ ไม่ใช่ document.body (ไม่งั้นอยู่หลังหน้าต่าง)
  return createPortal(
    <dialog ref={dlg} aria-labelledby={title ? titleId : undefined}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-transparent p-4 text-left text-inherit backdrop:bg-slate-900/40 open:flex open:items-start open:justify-center md:p-10">
      <div className={`relative w-full ${MODAL_WIDTH[size]} rounded-xl bg-white p-5 pt-10 shadow-xl`}>
        <button type="button" onClick={() => close.current()} aria-label="ปิด"
          className="tap [--tap:-11px_-6px] absolute right-3 top-3 rounded-md px-2 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800">✕</button>
        {title && <h2 id={titleId} className="-mt-6 mb-4 pr-8 font-medium text-slate-900">{title}</h2>}
        {/* กรอบ / พื้นหลังของฟอร์มเดิมไม่ต้องซ้อนในหน้าต่าง · ซ่อนปุ่ม ปิด / ยกเลิก ของฟอร์ม */}
        <div ref={body} className="[&_[data-close]]:hidden [&>*:first-child]:mt-0 [&>*:first-child]:rounded-none [&>*:first-child]:border-0 [&>*:first-child]:bg-transparent [&>*:first-child]:p-0">
          <InModal.Provider value>{children}</InModal.Provider>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/** ข้อความแจ้งมุมจอ หลังบันทึกสำเร็จ (หน้าต่างปิดเอง หรือ Flash นอกหน้าต่าง · วางไว้ที่ layout หลัก) */
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
  // แสดงเหนือหน้าต่าง pop up ที่ยังเปิดอยู่ (หน้าต่างอยู่ชั้นบนสุดของ browser) → ใช้ popover ถ้า browser รองรับ (iPad iOS 18.3 ขึ้นไป)
  //   ไม่รองรับ = แสดงแบบเดิม (ลอยมุมจอ z-[60])
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (msg && el && "showPopover" in el && !el.matches(":popover-open")) el.showPopover();
  }, [msg]);
  if (!msg) return null;
  return (
    <div ref={box} popover="manual" style={{ inset: "auto 1rem 1rem auto" }}
      className="fixed z-[60] m-0 max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg" role="status">
      {msg}
    </div>
  );
}
