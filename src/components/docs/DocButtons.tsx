"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callDrive } from "./drive";
import { extFromMime } from "@/lib/format";

/** ดาวน์โหลดไฟล์ (ผ่าน Edge Function · บันทึก Audit) — ใช้ในกล่องที่เปิดจากการกดแถวเอกสาร */
export function DownloadDoc({ id, title, mime }: { id: string; title: string; mime?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setErr(""); setBusy(true);
    try {
      const r = await callDrive({ action: "download", id, mode: "download" });
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = title + extFromMime(mime); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button type="button" onClick={go} disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50">{busy ? "กำลังดาวน์โหลด…" : "ดาวน์โหลด"}</button>
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
