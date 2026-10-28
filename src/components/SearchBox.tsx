"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { searchAll, type SearchHit } from "@/lib/search";
import { NAV } from "./nav";

// หน้า / แท็บในระบบ (ค้นได้ทันทีไม่ต้องรอเซิร์ฟเวอร์) · words = คำค้นเพิ่มเติม
const PAGES: { label: string; href: string; words?: string }[] = [
  ...NAV.filter((g) => g.href && g.href !== "/todo").map((g) => ({ label: g.label, href: g.href! })),
  { label: "Income & Expenses · รายได้", href: "/income-expenses?tab=income", words: "รายรับ" },
  { label: "Income & Expenses · ค่าใช้จ่าย", href: "/income-expenses?tab=expense", words: "รายจ่าย" },
  { label: "Income & Expenses · ตั้งค่า (รายการประจำ / หมวด)", href: "/income-expenses?tab=settings", words: "ค่าใช้จ่ายประจำ รายได้ประจำ หมวด" },
  { label: "Cash · อัปเดตยอดคงเหลือ", href: "/financial/cash?tab=update", words: "statement ยอดธนาคาร" },
  { label: "Cash · รับดอกเบี้ย", href: "/financial/cash?tab=interest" },
  { label: "Investments · อัปเดตยอดคงเหลือ", href: "/investments?tab=update", words: "statement ราคา" },
  { label: "To-Do List · สิ่งที่ต้องทำ", href: "/todo", words: "งานค้าง แจ้งเตือน" },
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

/** ช่องค้นหาด้านบน (แบบ Google · ตกลง 28 ต.ค. 2026): พิมพ์ในช่องได้ทันที (หรือ Ctrl/⌘ + K) → ผลแยกกลุ่มเลื่อนลงใต้ช่อง ไม่มีหน้าต่างกลางจอ
 *   ↑↓ Enter เลือก · Esc / คลิกที่อื่น = ปิดรายการ */
export default function SearchBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    // คลิกนอกช่อง / รายการ → ปิดรายการ (คำที่พิมพ์ยังอยู่ · กลับมาคลิกช่องแล้วรายการขึ้นอีก)
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, []);

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

  const clear = () => { setQ(""); setHits([]); setSel(0); };
  const go = (h: SearchHit | undefined) => { if (!h) return; setOpen(false); clear(); input.current?.blur(); router.push(h.href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { if (open && t) setOpen(false); else { clear(); input.current?.blur(); } }
    else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setSel((s) => Math.min(s + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(all[sel]); }
  };
  const show = open && t !== "";

  return (
    <div ref={box} className="relative w-full max-w-md">
      <div className={`flex items-center gap-2 border bg-slate-50 px-3 py-1.5 text-sm focus-within:border-blue-400 focus-within:bg-white ${show
        ? "rounded-t-lg border-slate-300 bg-white" : "rounded-lg border-slate-200 hover:border-slate-300 hover:bg-white"}`}>
        <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          data-plain role="combobox" aria-expanded={show} aria-controls="search-results" aria-label="ค้นหาข้อมูลในระบบ"
          placeholder="ค้นหาข้อมูลในระบบ…" style={{ outline: "none", background: "transparent" }} className="w-full min-w-0 bg-transparent text-slate-800 outline-none placeholder:text-slate-500" />
        {loading && t.length >= 2 && <span className="whitespace-nowrap text-xs text-slate-400">กำลังค้น…</span>}
        {q ? <button type="button" onClick={() => { clear(); input.current?.focus(); }} aria-label="ล้างคำค้น"
          className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
          : null}
      </div>
      {show && (
        <div id="search-results" role="listbox" className="absolute inset-x-0 top-full z-50 max-h-[60vh] overflow-y-auto rounded-b-lg border border-t-0 border-slate-300 bg-white py-1 shadow-lg">
          {t.length < 2 && pages.length === 0 && <p className="px-4 py-2 text-sm text-slate-500">พิมพ์อย่างน้อย 2 ตัวอักษร</p>}
          {t.length >= 2 && all.length === 0 && !loading && <p className="px-4 py-2 text-sm text-slate-500">ไม่พบ &ldquo;{q.trim()}&rdquo;</p>}
          {all.map((h, i) => (
            <div key={`${h.href}-${i}`}>
              {(i === 0 || all[i - 1].group !== h.group) && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h.group}</div>}
              <button type="button" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(h)}
                className={`flex w-full items-baseline justify-between gap-3 px-4 py-1.5 text-left text-sm ${i === sel ? "bg-blue-50 text-blue-800" : "text-slate-800"}`}>
                <span className="truncate">{h.label}</span>
                {h.sub && <span className="shrink-0 text-xs text-slate-500">{h.sub}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
