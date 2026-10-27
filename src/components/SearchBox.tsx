"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { searchAll, type SearchHit } from "@/lib/search";
import { NAV } from "./nav";

// หน้า / แท็บในระบบ (ค้นได้ทันทีไม่ต้องรอเซิร์ฟเวอร์) · words = คำค้นเพิ่มเติม
const PAGES: { label: string; href: string; words?: string }[] = [
  ...NAV.filter((g) => g.href).map((g) => ({ label: g.label, href: g.href! })),
  { label: "Income & Expenses · รายได้", href: "/income-expenses?tab=income", words: "รายรับ" },
  { label: "Income & Expenses · ค่าใช้จ่าย", href: "/income-expenses?tab=expense", words: "รายจ่าย" },
  { label: "Income & Expenses · ตั้งค่า (รายการประจำ / หมวด)", href: "/income-expenses?tab=settings", words: "ค่าใช้จ่ายประจำ รายได้ประจำ หมวด" },
  { label: "Cash · อัปเดตยอดคงเหลือ", href: "/financial/cash?tab=update", words: "statement ยอดธนาคาร" },
  { label: "Cash · รับดอกเบี้ย", href: "/financial/cash?tab=interest" },
  { label: "Investments · อัปเดตยอดคงเหลือ", href: "/investments?tab=update", words: "statement ราคา" },
  { label: "ความครบถ้วนของข้อมูล", href: "/todo?tab=data" },
  { label: "Members", href: "/family/members", words: "สมาชิก" },
  { label: "Membership & Points", href: "/family/memberships", words: "สมาชิก แต้ม" },
  { label: "Health", href: "/family/health", words: "สุขภาพ" },
  { label: "Documents", href: "/family/documents", words: "เอกสาร" },
  { label: "Month Closing", href: "/settings/month-closing", words: "ปิดเดือน" },
  { label: "FX & Prices", href: "/settings/system", words: "อัตราแลกเปลี่ยน ราคา" },
  { label: "User & Security", href: "/settings/family-users", words: "ผู้ใช้ ความปลอดภัย รหัส mfa" },
  { label: "Opening Setup", href: "/settings/opening", words: "ยอดตั้งต้น go-live" },
];

/** ช่องค้นหาด้านบน (กด หรือ Ctrl/⌘ + K) → กล่องค้นหา · ผลแยกกลุ่ม · ↑↓ Enter เลือก · Esc ปิด */
export default function SearchBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  // ค้นในฐานข้อมูลหลังหยุดพิมพ์ 250 ms (ผลที่มาช้ากว่าคำค้นล่าสุดทิ้งไป)
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return;
    const id = ++seq.current;
    const timer = setTimeout(() => startTransition(async () => {
      const r = await searchAll(t);
      if (id === seq.current) { setHits(r); setSel(0); }
    }), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const t = q.trim().toLowerCase();
  const pages: SearchHit[] = t ? PAGES.filter((p) => `${p.label} ${p.words ?? ""}`.toLowerCase().includes(t)).slice(0, 6)
    .map((p) => ({ group: "หน้า / เมนู", label: p.label, href: p.href })) : [];
  const all = [...pages, ...(t.length >= 2 ? hits : [])];

  const close = () => { setOpen(false); setQ(""); setHits([]); setSel(0); };
  const go = (h: SearchHit | undefined) => { if (!h) return; close(); router.push(h.href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(all[sel]); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300 hover:bg-white">
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">ค้นหาข้อมูลในระบบ…</span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-400 sm:inline">Ctrl K</kbd>
      </button>
      {/* portal: แถบบนมี backdrop-blur ทำให้ fixed ข้างในไม่เต็มจอ */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[12vh]" onMouseDown={close}>
          <div role="dialog" aria-label="ค้นหา" className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKeyDown} data-plain
                placeholder="พิมพ์ชื่อบัญชี ทรัพย์สิน หลักทรัพย์ บัตร เอกสาร สมาชิก หรือชื่อเมนู…"
                className="w-full py-3 text-sm outline-none" />
              {loading && <span className="whitespace-nowrap text-xs text-slate-400">กำลังค้น…</span>}
              <button type="button" onClick={close} className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100">Esc</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {!t && <p className="px-4 py-3 text-sm text-slate-500">พิมพ์อย่างน้อย 2 ตัวอักษร · ↑↓ เลือก · Enter เปิด</p>}
              {t && all.length === 0 && !loading && <p className="px-4 py-3 text-sm text-slate-500">ไม่พบ &ldquo;{q.trim()}&rdquo;</p>}
              {all.map((h, i) => (
                <div key={`${h.href}-${i}`}>
                  {(i === 0 || all[i - 1].group !== h.group) && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h.group}</div>}
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
                    className={`flex w-full items-baseline justify-between gap-3 px-4 py-1.5 text-left text-sm ${i === sel ? "bg-blue-50 text-blue-800" : "text-slate-800"}`}>
                    <span className="truncate">{h.label}</span>
                    {h.sub && <span className="shrink-0 text-xs text-slate-500">{h.sub}</span>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
