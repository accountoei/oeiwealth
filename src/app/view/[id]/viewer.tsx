"use client";

import { useEffect, useState } from "react";
import { callDrive } from "@/components/docs/drive";
import { extFromMime } from "@/lib/format";

/**
 * แสดงเอกสารในแท็บนี้เอง: สร้าง blob URL ในหน้านี้แล้วแสดงด้วย <iframe> / <img>
 * (เดิมสร้าง blob ในหน้าเดิมแล้วส่งไปแท็บใหม่ — บางเบราว์เซอร์แสดงเป็นหน้าว่าง)
 */
export default function DocViewer({ id, title, mime }: { id: string; title: string; mime: string | null }) {
  const [url, setUrl] = useState("");
  const [type, setType] = useState(mime ?? "");
  const [err, setErr] = useState("");
  useEffect(() => {
    let u = "";
    document.title = title;
    (async () => {
      try {
        const r = await callDrive({ action: "download", id, mode: "view" });
        const blob = await r.blob();
        const t = mime || blob.type || "application/octet-stream";
        u = URL.createObjectURL(new Blob([blob], { type: t }));
        setType(t); setUrl(u);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, mime, title]);

  const viewable = type === "application/pdf" || type.startsWith("text/");
  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <span className="truncate font-medium text-slate-900">{title}</span>
        {url && <a href={url} download={title + extFromMime(type)} className="shrink-0 text-slate-700 underline">ดาวน์โหลด</a>}
      </header>
      <main className="min-h-0 flex-1">
        {err ? <p className="p-6 text-sm text-red-600">{err}</p>
          : !url ? <p className="p-6 text-sm text-slate-500">กำลังโหลดเอกสาร…</p>
          : type.startsWith("image/")
            // eslint-disable-next-line @next/next/no-img-element
            ? <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={url} alt={title} className="max-h-full max-w-full" /></div>
          : viewable ? <iframe src={url} title={title} className="h-full w-full border-0 bg-white" />
          : <p className="p-6 text-sm text-slate-600">ไฟล์ประเภทนี้เปิดดูในเบราว์เซอร์ไม่ได้ — กด &ldquo;ดาวน์โหลด&rdquo; ด้านบน</p>}
      </main>
    </div>
  );
}
