"use client";

import { TabActionsSlot } from "@/components/TabActions";
import { resetKeptHeight } from "@/components/KeepHeight";
import TabLabel from "@/components/TabLabel";
import { tabClass } from "@/lib/format";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// สลับแท็บในเบราว์เซอร์ทันที ไม่ต้องโหลดหน้าใหม่ (ข้อมูลทุกแท็บโหลดมาพร้อมกันตั้งแต่เปิดหน้าอยู่แล้ว)
// URL ยังเปลี่ยนตาม (?tab=) → กด Refresh / ส่งลิงก์ต่อ แล้วเปิดแท็บเดิมได้
const Ctx = createContext<{ active: string; setActive: (k: string) => void }>({ active: "overview", setActive: () => {} });
// สลับแท็บหลักด้วยปุ่มแท็บ → แท็บย่อยกลับไปหน้าแรก (ที่ต้องได้รับ / ที่ต้องจ่าย) เสมอ
const MAIN_TAB_EVENT = "fwv:main-tab";
// ลิงก์จากแท็บอื่นสั่งเปิดแท็บย่อย (เช่น ชื่อรายได้ประจำ → ตั้งค่า → รายได้ประจำ)
const SUB_TAB_EVENT = "fwv:sub-tab";

/** เรียก cb เมื่อผู้ใช้กดเปลี่ยนแท็บหลัก (ใช้รีเซ็ตตัวกรอง / ช่องติ๊กกลับค่าเริ่มต้น) */
export function useOnMainTab(cb: () => void) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; });
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(MAIN_TAB_EVENT, h);
    return () => window.removeEventListener(MAIN_TAB_EVENT, h);
  }, []);
}

export function TabsProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [active, setState] = useState(initial);
  // ลิงก์ในหน้าเดียวกันที่เปลี่ยน ?tab= (เช่น "ดูรายการทั้งหมด →") → สลับแท็บตามทันที ไม่ต้อง Refresh
  useEffect(() => { setState(initial); }, [initial]);
  const setActive = (k: string) => {
    if (k !== active) resetKeptHeight();   // แท็บใหม่ = หน้ายาวพอดีกับแท็บนั้น (ไม่ค้างความสูงของแท็บที่ยาวกว่า)
    setState(k);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", k);
      window.history.replaceState(null, "", u);   // null = ให้ Next.js รับรู้ URL ใหม่ด้วย (ไม่หลุดหลังบันทึก)
    } catch { /* ไม่เป็นไร แค่ URL ไม่เปลี่ยน */ }
  };
  return <Ctx.Provider value={{ active, setActive }}>{children}</Ctx.Provider>;
}

export function TabNav({ tabs }: { tabs: [string, string][] }) {
  const { active, setActive: set } = useContext(Ctx);
  const setActive = (k: string) => {
    set(k);
    try {
      const u = new URL(window.location.href);
      ["it", "et", "pay"].forEach((p) => u.searchParams.delete(p));
      window.history.replaceState(null, "", u);
    } catch { /* ไม่เป็นไร */ }
    window.dispatchEvent(new CustomEvent(MAIN_TAB_EVENT, { detail: k }));
  };
  return (
    // แถวเดียวกับ TabNav กลาง (src/components/ClientTabs.tsx): ชื่อแท็บไม่ตัดคำ · แท็บยาวเกินจอ = ปัดแถวแท็บซ้าย–ขวา
    // ปุ่ม "+ …" วางแถวเดียวกับแท็บไม่พอ (iPad แนวตั้ง / มือถือ) → ขึ้นไปแถวบนชิดขวา (flex-wrap-reverse) ไม่ล้นจอ
    <nav className="flex flex-wrap-reverse items-end gap-x-1 gap-y-2 border-b border-slate-200 text-sm" aria-label="มุมมอง">
      <div className="-mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setActive(k)} aria-pressed={active === k}
            className={`shrink-0 whitespace-nowrap ${tabClass(active === k).replace("-mb-px ", "")}`}><TabLabel>{l}</TabLabel></button>
        ))}
      </div>
      {/* ปุ่ม "+ เพิ่ม…" ของหน้า (TabActions) ชิดขวาสุดของแถวแท็บ */}
      <TabActionsSlot />
    </nav>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { active } = useContext(Ctx);
  return <div hidden={active !== id} className="space-y-6">{children}</div>;
}

/** ลิงก์ไปแท็บอื่นในหน้านี้ · สลับแท็บทันที (ไม่ต้องรอโหลด / Refresh) */
export function TabLink({ tab, href, className, anchor, sub, children }: {
  tab: string; href: string; className?: string;
  /** เปิดแท็บย่อยด้วย: [ชื่อพารามิเตอร์ของแท็บย่อย, แท็บย่อย] */
  sub?: [string, string];
  /** เลื่อนไปกล่องนี้ (id) หลังสลับแท็บ · ไม่ระบุ = เลื่อนขึ้นบนสุด */
  anchor?: string; children: ReactNode;
}) {
  const { setActive } = useContext(Ctx);
  return (
    <Link href={href} scroll={false} className={className}
      onClick={() => {
        setActive(tab);
        if (sub) window.dispatchEvent(new CustomEvent(SUB_TAB_EVENT, { detail: { param: sub[0], tab: sub[1] } }));
        if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}>{children}</Link>
  );
}

/** เปิดหน้าแล้วเลื่อนไปกล่อง id (ใช้กับลิงก์เดิม ?tab=moves → กล่อง "เงินเข้า–ออกบัญชีเดือนนี้" ในภาพรวม) */
export function ScrollToHash({ id }: { id: string }) {
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}

// แท็บย่อยในแท็บ (เช่น ที่ต้องได้รับ / บันทึกแล้ว / รายได้ประจำ) · จำไว้ใน URL (?it= / ?et=)
const SubCtx = createContext<{ active: string; pick: (k: string) => void }>({ active: "", pick: () => {} });

export function SubTabs({ param, initial, home, tabs, actions = {}, children }: {
  param: string; initial: string; tabs: [string, string][]; children: ReactNode;
  /** ปุ่มของแต่ละแท็บย่อย → ขวาสุดของแถวแท็บย่อย (ใส่ปุ่มเดียวกันทุกแท็บย่อยได้) */
  actions?: Record<string, ReactNode>;
  /** แท็บย่อยที่เปิดเมื่อกดเปลี่ยนแท็บหลัก (ค่าเริ่มต้น = แท็บแรก) */
  home?: string;
}) {
  const [active, setState] = useState(initial);
  useEffect(() => { setState(initial); }, [initial]);
  const first = home ?? tabs[0]?.[0] ?? "";
  useEffect(() => {
    const onMain = () => setState(first);
    window.addEventListener(MAIN_TAB_EVENT, onMain);
    return () => window.removeEventListener(MAIN_TAB_EVENT, onMain);
  }, [first]);
  useEffect(() => {
    const onSub = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; tab: string }>).detail;
      if (d?.param === param) pick(d.tab);
    };
    window.addEventListener(SUB_TAB_EVENT, onSub);
    return () => window.removeEventListener(SUB_TAB_EVENT, onSub);
  });
  const pick = (k: string) => {
    setState(k);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set(param, k);
      window.history.replaceState(null, "", u);   // null = ให้ Next.js รับรู้ URL ใหม่ด้วย (ไม่หลุดหลังบันทึก)
    } catch { /* ไม่เป็นไร */ }
  };
  return (
    <SubCtx.Provider value={{ active, pick }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {tabs.map(([k, l]) => (
              <button key={k} type="button" onClick={() => pick(k)}
                className={`rounded-md px-3 py-1.5 text-sm ${active === k ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><TabLabel>{l}</TabLabel></button>
            ))}
          </div>
          {actions[active] && <div className="ml-auto flex items-center gap-2">{actions[active]}</div>}
        </div>
        {children}
      </div>
    </SubCtx.Provider>
  );
}

export function SubPanel({ id, children }: { id: string; children: ReactNode }) {
  const { active } = useContext(SubCtx);
  return <div hidden={active !== id} className="space-y-4">{children}</div>;
}

/** ปุ่มข้อความไปแท็บย่อยอื่น (เช่น ชื่อรายได้ประจำ → แท็บ "รายได้ประจำ") */
export function SubTabLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { pick } = useContext(SubCtx);
  return <button type="button" onClick={() => { pick(to); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`text-left ${className ?? ""}`}>{children}</button>;
}
