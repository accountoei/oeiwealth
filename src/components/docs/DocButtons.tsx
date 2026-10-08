"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callDrive } from "./drive";
import { extFromMime } from "@/lib/format";

/** เปิดดู / ดาวน์โหลด (ผ่าน Edge Function ที่ตรวจสิทธิ์ · บันทึก Audit) */
export function OpenDoc({ id, title, mime }: { id: string; title: string; mime?: string | null }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  async function go(mode: "view" | "download") {
    setErr(""); setBusy(mode);
    const w = mode === "view" ? window.open("", "_blank") : null;      // เปิดแท็บก่อน กัน Popup Blocker
    try {
      const r = await callDrive({ action: "download", id, mode });
      const url = URL.createObjectURL(await r.blob());
      if (w) { w.location.href = url; } else {
        const a = document.createElement("a"); a.href = url; a.download = title + extFromMime(mime); document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      w?.close();
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={() => go("view")} disabled={!!busy} className="text-sky-700 underline disabled:opacity-50">{busy === "view" ? "กำลังเปิด…" : "เปิด"}</button>
      <button type="button" onClick={() => go("download")} disabled={!!busy} className="text-slate-600 underline disabled:opacity-50">{busy === "download" ? "…" : "ดาวน์โหลด"}</button>
      {err && <span className="text-red-600">{err}</span>}
    </span>
  );
}

/** ADMIN: เชื่อม Google Drive (ไปหน้าอนุญาตของ Google แล้วกลับมาหน้านี้) */
export function ConnectDrive({ label = "เชื่อม Google Drive" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  async function go() {
    setBusy(true); setErr("");
    try {
      const back = `${window.location.origin}/documents`;
      const r = await callDrive({ action: "connect", return_url: back });
      const { url } = await r.json();
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setBusy(false); router.refresh();
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" onClick={go} disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
        {busy ? "กำลังไปหน้า Google…" : label}
      </button>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </span>
  );
}
