"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * ช่องเลือก (dropdown) ทุกช่อง เปิดรายการ "ลงด้านล่าง" เสมอ (ตกลง 28 ต.ค. 2026)
 *   รายการของเบราว์เซอร์เองวาง "ตัวที่เลือกอยู่" ทับช่อง → บางครั้งงอกขึ้นด้านบน และโค้ดสั่งทิศไม่ได้
 *   ตัวนี้ทำงานกับ <select> เดิมทุกช่องโดยไม่ต้องแก้แต่ละหน้า (เหมือน NumberInputs):
 *     กดช่องด้วยเมาส์ / Space / Enter / Alt+↓ → เปิดรายการของเราใต้ช่อง (ขึ้นด้านบนเฉพาะเมื่อด้านล่างเหลือที่ไม่พอจริง ๆ)
 *     เลือกแล้วตั้งค่าที่ <select> เดิม + ส่ง change → ฟอร์ม / onChange / required ทำงานเหมือนเดิม
 *   ตัวที่เลือกอยู่มี ✓ · ↑ ↓ Enter Esc · รายการยาว (> 8) มีช่องพิมพ์ค้นหา · รายการสั้นพิมพ์ตัวแรกเพื่อกระโดด
 *   มือถือ / แท็บเล็ต (นิ้ว) ใช้ตัวเลือกของเครื่องเหมือนเดิม · ใส่ data-native ที่ <select> = ไม่ใช้ตัวนี้
 */
type Opt = { value: string; label: string; disabled: boolean; group: string | null; index: number };
type State = { el: HTMLSelectElement; opts: Opt[]; active: number; q: string; rect: DOMRect; fit: number };

const MANY = 8;
const MAX_H = 320;

function eligible(t: EventTarget | null): t is HTMLSelectElement {
  return t instanceof HTMLSelectElement && !t.multiple && t.size <= 1 && !t.disabled && !t.hasAttribute("data-native");
}

function readOpts(el: HTMLSelectElement): Opt[] {
  return [...el.options].map((o, index) => ({
    value: o.value, label: o.text, disabled: o.disabled, index,
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null,
  }));
}

/** ตั้งค่าที่ <select> เดิมแล้วส่ง change (React onChange / ฟอร์มเห็นเหมือนผู้ใช้เลือกเอง) */
function choose(el: HTMLSelectElement, value: string) {
  if (el.value !== value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  el.focus();
}

/** ความกว้างรายการ = พอแสดงชื่อยาวสุดเต็ม ๆ (ไม่แคบกว่าช่อง · ไม่เกินจอ) — ตกลง 28 ต.ค. 2026 (ชื่อบัญชีถูกตัด "…") */
let canvas: HTMLCanvasElement | null = null;
function fitWidth(el: HTMLSelectElement, opts: Opt[]) {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `500 14px ${getComputedStyle(el).fontFamily}`;
  const text = Math.max(0, ...opts.map((o) => ctx.measureText(o.label).width + (o.group ? 8 : 0)));
  // ✓ 16 + ช่องห่าง 8 + ขอบซ้าย / ขวา 24 + แถบเลื่อน / กรอบ ~20
  return Math.ceil(text + 68);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export default function SelectEnhancer() {
  const [st, setSt] = useState<State | null>(null);
  const stRef = useRef<State | null>(null);
  useLayoutEffect(() => { stRef.current = st; });
  const pointer = useRef<string>("mouse");
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const close = useCallback((focus = true) => {
    const cur = stRef.current;
    setSt(null);
    if (focus) cur?.el.focus();
  }, []);

  const open = useCallback((el: HTMLSelectElement) => {
    const opts = readOpts(el);
    const sel = Math.max(0, el.selectedIndex);
    setSt({ el, opts, active: sel, q: "", rect: el.getBoundingClientRect(), fit: fitWidth(el, opts) });
  }, []);

  // เปิด: เมาส์กดที่ช่อง (นิ้ว = ตัวเลือกของเครื่อง) · คีย์บอร์ด Space / Enter / Alt+↓ / F4
  useEffect(() => {
    const onPointer = (e: PointerEvent) => { pointer.current = e.pointerType; };
    const onDown = (e: MouseEvent) => {
      const cur = stRef.current;
      if (cur && list.current?.contains(e.target as Node)) return;
      if (eligible(e.target) && pointer.current === "mouse" && e.button === 0) {
        e.preventDefault();
        if (cur?.el === e.target) close(); else { (e.target as HTMLSelectElement).focus(); open(e.target as HTMLSelectElement); }
        return;
      }
      if (cur) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (stRef.current || !eligible(e.target)) return;
      if (e.key === " " || e.key === "Enter" || e.key === "F4" || (e.altKey && e.key === "ArrowDown")) { e.preventDefault(); open(e.target); }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // เปิดอยู่: เลื่อนหน้า = ตามช่อง (ช่องพ้นจอ = ปิด) · ย่อ / ขยายหน้าต่าง = ปิด
  useEffect(() => {
    if (!st) return;
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      const r = st.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || !st.el.isConnected) close(false);
      else setSt((s) => (s ? { ...s, rect: r } : s));
    };
    const onResize = () => close(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onResize); };
  }, [st, close]);

  const many = (st?.opts.length ?? 0) > MANY;
  const shown = st ? (st.q ? st.opts.filter((o) => norm(o.label).includes(norm(st.q))) : st.opts) : [];
  const enabled = shown.filter((o) => !o.disabled);

  const move = (d: number) => setSt((s) => {
    if (!s || !enabled.length) return s;
    const i = enabled.findIndex((o) => o.index === s.active);
    const n = i < 0 ? (d > 0 ? 0 : enabled.length - 1) : Math.min(enabled.length - 1, Math.max(0, i + d));
    return { ...s, active: enabled[n].index };
  });
  const pick = (o: Opt | undefined) => {
    if (!st || !o || o.disabled) return;
    const el = st.el;
    setSt(null);
    choose(el, o.value);
  };

  // คีย์บอร์ดตอนรายการเปิด (Esc ไม่ไปปิดหน้าต่าง pop up ที่ช่องนี้อยู่)
  useEffect(() => {
    if (!st) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (k === "Tab") { close(false); return; }
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); e.stopPropagation(); move(k === "ArrowDown" ? 1 : -1); return; }
      if (k === "Home" || k === "End") { e.preventDefault(); move(k === "Home" ? -9999 : 9999); return; }
      if (k === "Enter") { e.preventDefault(); e.stopPropagation(); pick(st.opts.find((o) => o.index === st.active)); return; }
      if (k === " " && !many) { e.preventDefault(); pick(st.opts.find((o) => o.index === st.active)); return; }
      // รายการสั้น: พิมพ์ตัวแรกเพื่อกระโดด (รายการยาวใช้ช่องค้นหา)
      if (!many && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + k.toLowerCase(), at: now };
        const hit = st.opts.find((o) => !o.disabled && norm(o.label).startsWith(typed.current.text));
        if (hit) setSt((s) => (s ? { ...s, active: hit.index } : s));
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  // ตัวที่ไฮไลต์อยู่ในกรอบเสมอ · รายการยาว: โฟกัสช่องค้นหา
  useLayoutEffect(() => {
    if (!st) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${st.active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [st]);
  const isOpen = !!st;
  useEffect(() => { if (isOpen && many) search.current?.focus({ preventScroll: true }); }, [isOpen, many]);

  if (!st) return null;
  const r = st.rect;
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const want = Math.min(MAX_H, st.opts.length * 34 + (many ? 44 : 8));
  const up = below < want && above > below;
  const maxH = Math.max(120, Math.min(MAX_H, up ? above : below));
  const width = Math.min(Math.max(r.width, 176, st.fit), 560, window.innerWidth - 16);
  // กว้างกว่าช่องแล้วล้นขวา → ชิดขอบขวาของช่อง (ขยายไปทางซ้าย)
  const left = Math.max(8, r.left + width > window.innerWidth - 8 ? Math.min(r.right, window.innerWidth - 8) - width : r.left);
  const pos = up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 };

  return createPortal(
    <div ref={list} role="listbox" aria-label="ตัวเลือก" style={{ position: "fixed", left, width, maxHeight: maxH, ...pos }}
      className="z-[70] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-lg"
      onMouseDown={(e) => { if (e.target !== search.current) e.preventDefault(); }}>
      {many && (
        <div className="border-b border-slate-100 p-1.5">
          <input ref={search} value={st.q} data-plain placeholder="พิมพ์เพื่อค้นหา…" aria-label="ค้นหาตัวเลือก"
            onChange={(e) => { const q = e.target.value; setSt((s) => {
              if (!s) return s;
              const first = s.opts.find((o) => !o.disabled && (!q || norm(o.label).includes(norm(q))));
              return { ...s, q, active: first ? first.index : s.active };
            }); }}
            style={{ outline: "none" }} className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-blue-400" />
        </div>
      )}
      <div className="overflow-y-auto py-1">
        {shown.length === 0 && <div className="px-3 py-2 text-slate-500">ไม่พบ &ldquo;{st.q}&rdquo;</div>}
        {shown.map((o, i) => {
          const selected = o.index === st.el.selectedIndex;
          const active = o.index === st.active;
          return (
            <div key={o.index}>
              {o.group && o.group !== shown[i - 1]?.group && (
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{o.group}</div>
              )}
              <div role="option" aria-selected={selected} aria-disabled={o.disabled} data-i={o.index}
                onMouseEnter={() => !o.disabled && setSt((s) => (s ? { ...s, active: o.index } : s))}
                onClick={() => pick(o)}
                className={`flex cursor-pointer items-center gap-2 py-1.5 pr-3 ${o.group ? "pl-5" : "pl-3"} ${o.disabled ? "cursor-default text-slate-300"
                  : active ? "bg-blue-50 text-blue-900" : o.value === "" ? "text-slate-500" : "text-slate-800"} ${selected ? "font-medium" : ""}`}>
                <span className="w-4 shrink-0 text-blue-600">{selected ? "✓" : ""}</span>
                <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
