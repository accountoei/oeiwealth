"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
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
  { label: "Tax", href: "/family/tax", words: "ภาษี ภาษีเงินได้ ภงด ภ.ง.ด.90 ภ.ง.ด.91 ลดหย่อน ยื่นภาษี 50 ทวิ" },
  { label: "Donations", href: "/family/donations", words: "บริจาค การกุศล ใบอนุโมทนา" },
  { label: "Documents", href: "/family/documents", words: "เอกสาร" },
  { label: "Month Closing", href: "/settings/month-closing", words: "ปิดเดือน" },
  { label: "FX & Prices", href: "/settings/system", words: "อัตราแลกเปลี่ยน ราคา" },
  { label: "User & Security", href: "/settings/family-users", words: "ผู้ใช้ ความปลอดภัย รหัส mfa" },
  { label: "Opening Setup", href: "/settings/opening", words: "ยอดตั้งต้น go-live" },
];

/** ช่องค้นหาด้านบน (แบบ Google · ตกลง 28 ต.ค. 2026): พิมพ์ในช่องได้ทันที (หรือ Ctrl/⌘ + K) → ผลแยกกลุ่มเลื่อนลงใต้ช่อง ไม่มีหน้าต่างกลางจอ
 *   ↑↓ Enter เลือก · Esc / คลิกที่อื่น = ปิดรายการ
 *   มือถือ (2 พ.ย. 2026): เป็นปุ่มแว่นขยายข้างกระดิ่ง · แตะแล้วช่องค้นหาเต็มแถวบน (แถบบนไม่สูงขึ้น) · ยกเลิก / Esc = ปิด */
export default function SearchBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  // เลือกบรรทัดเองแล้ว (ลูกศร / เมาส์) → Enter เปิดบรรทัดนั้น · ยังไม่ได้เลือก → Enter เปิดหน้า "ผลการค้นหา"
  const [picked, setPicked] = useState(false);
  const [loading, startTransition] = useTransition();
  // มือถือ: ช่องค้นหาเปิดเต็มแถบบนอยู่
  const [mobile, setMobile] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    // คลิกนอกช่อง / รายการ → ปิดรายการ (คำที่พิมพ์ยังอยู่ · กลับมาคลิกช่องแล้วรายการขึ้นอีก)
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setMobile(false); } };
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

  const clear = () => { setQ(""); setHits([]); setSel(0); setPicked(false); };
  const goAll = () => { const v = q.trim(); if (v.length < 2) return; setOpen(false); setMobile(false); clear(); input.current?.blur(); router.push(`/search?q=${encodeURIComponent(v)}`); };
  const go = (h: SearchHit | undefined) => { if (!h) return; setOpen(false); setMobile(false); clear(); input.current?.blur(); router.push(h.href); };
  const closeMobile = () => { setOpen(false); setMobile(false); clear(); };
  // แสดงช่องก่อน (flushSync) แล้วโฟกัสทันทีในการแตะเดียวกัน → แป้นพิมพ์มือถือขึ้นเลย (iPhone ต้องโฟกัสระหว่างแตะ)
  const openMobile = () => { flushSync(() => { setMobile(true); setOpen(true); }); input.current?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { if (open && t) setOpen(false); else { clear(); setMobile(false); input.current?.blur(); } }
    else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setPicked(true); setSel((s) => (picked ? Math.min(s + 1, all.length - 1) : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPicked(true); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (picked && all[sel]) go(all[sel]); else if (t.length >= 2) goAll(); else go(all[0]); }
  };
  const show = open && t !== "";

  return (
    <>
    <button type="button" onClick={openMobile} aria-label="ค้นหาข้อมูลในระบบ"
      className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:hidden">
      <Search className="h-5 w-5" aria-hidden strokeWidth={1.9} />
    </button>
    {/* มือถือ: ช่องค้นหาทับแถวบนของแถบบน (ปุ่ม ☰ ยังเห็นทางซ้าย) */}
    <div ref={box} className={`${mobile ? "absolute left-[6.5rem] right-0 top-0 z-20 flex h-[3.75rem] items-center gap-1 bg-white pr-3" : "hidden"
      } md:static md:flex md:h-auto md:w-full md:bg-transparent md:p-0`}>
      <div className="relative min-w-0 flex-1">
      <div className={`flex items-center gap-2 border bg-slate-50 px-3 py-1.5 text-sm focus-within:border-blue-400 focus-within:bg-white ${show
        ? "rounded-t-lg border-slate-300 bg-white" : "rounded-lg border-slate-200 hover:border-slate-300 hover:bg-white"}`}>
        <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setPicked(false); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
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
              <button type="button" role="option" aria-selected={picked && i === sel} onMouseEnter={() => { setSel(i); setPicked(true); }} onClick={() => go(h)}
                className={`flex w-full items-baseline justify-between gap-3 px-4 py-1.5 text-left text-sm ${picked && i === sel ? "bg-blue-50 text-blue-800" : "text-slate-800"}`}>
                <span className="truncate">{h.label}</span>
                {h.sub && <span className="shrink-0 text-xs text-slate-500">{h.sub}</span>}
              </button>
            </div>
          ))}
          {t.length >= 2 && (
            <button type="button" onClick={goAll}
              className="mt-1 flex w-full items-center justify-between border-t border-slate-100 px-4 py-2 text-left text-sm text-blue-700 hover:bg-blue-50">
              <span>ดูผลการค้นหาทั้งหมด &ldquo;{q.trim()}&rdquo;</span><span className="text-xs text-slate-400">Enter</span>
            </button>
          )}
        </div>
      )}
      </div>
      {mobile && <button type="button" onClick={closeMobile} className="shrink-0 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 md:hidden">ยกเลิก</button>}
    </div>
    </>
  );
}
