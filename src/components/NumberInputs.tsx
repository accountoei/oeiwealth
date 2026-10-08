"use client";

import { useEffect } from "react";

/**
 * ช่องตัวเลขทุกช่อง (inputMode="decimal") แสดงแบบการเงินอัตโนมัติ
 *  - พิมพ์: ใส่คอมมาคั่นหลักพันทันที (1234567 → 1,234,567)
 *  - ออกจากช่อง: ทศนิยมอย่างน้อย 2 ตำแหน่ง (1,234 → 1,234.00 · 35.1234 คงไว้)
 *  - ช่องจำนวนหน่วย / % / อัตรา / ระดับ / วันที่ของเดือน: ใส่คอมมาแต่ไม่เติม .00
 * ฝั่ง Server ตัดคอมมาออกก่อนบันทึกทุกครั้ง (numOrNull / clean)
 */
const NO_PAD = /(quantity|qty|shares|percent|pct|rate|level|fx|day|owner_|sq_?wa|land_|ngan|rai|wa$)/i;
const SKIP = "data-plain";

function sel(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.inputMode === "decimal" && !el.hasAttribute(SKIP) && el.type !== "hidden";
}

function group(intPart: string) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** จัดรูปขณะพิมพ์: คงตัวเลข / จุด / ลบไว้ ใส่คอมมาเฉพาะส่วนจำนวนเต็ม */
function live(raw: string) {
  const neg = raw.trim().startsWith("-");
  const clean = raw.replace(/[^0-9.]/g, "");
  const dot = clean.indexOf(".");
  const int = (dot >= 0 ? clean.slice(0, dot) : clean).replace(/^0+(?=\d)/, "");
  const dec = dot >= 0 ? "." + clean.slice(dot + 1).replace(/\./g, "") : "";
  if (!int && !dec) return neg ? "-" : "";
  return (neg ? "-" : "") + group(int || (dec ? "0" : "")) + dec;
}

/** จัดรูปเต็ม (ออกจากช่อง / ค่าเริ่มต้น) */
function full(raw: string, pad: boolean) {
  const s = raw.replace(/,/g, "").trim();
  if (s === "" || s === "-" || Number.isNaN(Number(s))) return raw;
  const neg = s.startsWith("-");
  const [i, d = ""] = s.replace("-", "").split(".");
  let dec = d.replace(/0+$/, "");
  if (pad && dec.length < 2) dec = dec.padEnd(2, "0");
  return (neg ? "-" : "") + group(i.replace(/^0+(?=\d)/, "") || "0") + (dec ? "." + dec : "");
}

// เปลี่ยนค่าแบบที่ React รับรู้ (กันค่าใน state กับหน้าจอไม่ตรงกัน)
let busy = false;
function put(el: HTMLInputElement, v: string, caretDigits?: number) {
  if (el.value === v) return;
  busy = true;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  busy = false;
  if (caretDigits !== undefined && document.activeElement === el) {
    let pos = 0, seen = 0;
    while (pos < v.length && seen < caretDigits) { if (/[0-9.\-]/.test(v[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* บางเบราว์เซอร์ไม่รองรับ */ }
  }
}
const pad = (el: HTMLInputElement) => !NO_PAD.test(el.name) && el.dataset.money !== "off";

export default function NumberInputs() {
  useEffect(() => {
    const onInput = (e: Event) => {
      if (busy || !e.target || !sel(e.target as Element)) return;
      const el = e.target as HTMLInputElement;
      const caret = el.selectionStart ?? el.value.length;
      const digitsBefore = el.value.slice(0, caret).replace(/[^0-9.\-]/g, "").length;
      put(el, live(el.value), digitsBefore);
    };
    const onBlur = (e: Event) => {
      if (!e.target || !sel(e.target as Element)) return;
      const el = e.target as HTMLInputElement;
      put(el, full(el.value, pad(el)));
    };
    const fmtAll = (root: ParentNode) => {
      root.querySelectorAll?.("input").forEach((el) => {
        if (sel(el) && el.value && document.activeElement !== el) put(el, full(el.value, pad(el)));
      });
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("blur", onBlur, true);
    fmtAll(document);
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n instanceof HTMLElement) { if (sel(n)) fmtAll(n.parentElement ?? document); else fmtAll(n); }
    })));
    mo.observe(document.body, { childList: true, subtree: true });
    // ก่อนส่งฟอร์ม: จัดรูปช่องที่ยังพิมพ์ค้างอยู่ (ค่า Server ตัดคอมมาเองอยู่แล้ว)
    const onSubmit = (e: Event) => { if (e.target instanceof HTMLFormElement) fmtAll(e.target); };
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("submit", onSubmit, true);
      mo.disconnect();
    };
  }, []);
  return null;
}
