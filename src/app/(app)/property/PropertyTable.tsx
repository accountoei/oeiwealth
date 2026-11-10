"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";
import { useOnMainTab } from "../income-expenses/tabs";
import { SMALL_BTN, money, thDate, todayBangkok } from "@/lib/format";
import { buildKml } from "@/lib/kml";
import type { MapPlace } from "./PropertyMap";

// โหลดไลบรารีแผนที่เฉพาะตอนกดเปิด (ไม่ถ่วงหน้าทรัพย์สิน)
const PropertyMap = dynamic(() => import("./PropertyMap"), {
  ssr: false,
  loading: () => <div className="mx-4 mt-3 h-[420px] animate-pulse rounded-lg bg-slate-200 md:h-[520px]" />,
});

export type PropRow = {
  id: string; assetId: string; name: string; sub: string; loc: string | null; type: string; typeLabel: string; usage: string; usageLabel: string;
  status: string; cost: number | null; costDate: string | null; value: number | null; valueDate: string | null; stale: boolean;
  rent: number; ytd: number; leases: { id: string; badge: string; cls: string; text: string }[]; noLease: boolean; move?: ReactNode;
  /** พิกัด / เนื้อที่ / ที่อยู่ (ส่งออกแผนที่ KML) */ geo?: { lat: number; lng: number } | null; area?: string | null; address?: string | null;
  /** ว่างมาแล้วกี่เดือน (เฉพาะที่ว่างและใส่วันเริ่มว่าง) · เตือนเรื่องภาษีที่ดิน */ vacant?: { text: string; warn: boolean } | null;
};

const STATUS: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย", CLOSED: "ปิดแล้ว" };
const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";

/** ทรัพย์สินทั้งหมด + ตัวกรอง ประเภท / การใช้งาน / กลุ่มทำเล / สถานะ (ตั้งต้น = ถืออยู่) · ยอดรวมตามตัวกรองด้านบน */
export default function PropertyTable({ rows, empty, toggle, note }: { rows: PropRow[]; empty: string; toggle?: ReactNode; /** บรรทัดเล็กใต้ยอดรวม */ note?: ReactNode }) {
  const [type, setType] = useState("");
  const [usage, setUsage] = useState("");
  const [loc, setLoc] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [showMap, setShowMap] = useState(false);
  useOnMainTab(() => { setType(""); setUsage(""); setLoc(""); setStatus("ACTIVE"); });
  const types = useMemo(() => [...new Map(rows.map((r) => [r.type, r.typeLabel]))], [rows]);
  const usages = useMemo(() => [...new Map(rows.map((r) => [r.usage, r.usageLabel]))], [rows]);
  const locs = useMemo(() => [...new Set(rows.map((r) => r.loc ?? ""))].sort((a, b) => (a ? a.localeCompare(b, "th") : 1)), [rows]);
  const statuses = useMemo(() => [...new Set(["ACTIVE", ...rows.map((r) => r.status)])], [rows]);
  const shown = useMemo(() => rows.filter((r) => (!type || r.type === type) && (!usage || r.usage === usage)
    && (!loc || (loc === "__none" ? !r.loc : r.loc === loc)) && (!status || r.status === status)), [rows, type, usage, loc, status]);
  const places = useMemo((): MapPlace[] => shown.filter((r) => r.geo).map((r) => ({
    id: r.id, assetId: r.assetId, name: r.name, lat: r.geo!.lat, lng: r.geo!.lng,
    usage: r.usage, usageLabel: r.usageLabel, typeLabel: r.typeLabel, loc: r.loc, area: r.area ?? null,
  })), [shown]);
  const mapTitle = loc ? (loc === "__none" ? "ไม่ระบุกลุ่มทำเล" : loc) : "ทรัพย์สินตามตัวกรอง";
  const sum = (f: (r: PropRow) => number | null) => shown.reduce((t, r) => t + (f(r) ?? 0), 0);
  const filtered = !!(type || usage || loc || status !== "ACTIVE");
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-xs text-slate-600">
        <label>ประเภท
          <select value={type} onChange={(e) => setType(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>การใช้งาน
          <select value={usage} onChange={(e) => setUsage(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{usages.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {locs.length > 1 && (
          <label>กลุ่มทำเล
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>
              {locs.map((g) => <option key={g || "__none"} value={g || "__none"}>{g || "(ไม่ระบุ)"}</option>)}
            </select>
          </label>
        )}
        <label>สถานะ
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{statuses.map((s) => <option key={s} value={s}>{STATUS[s] ?? s}</option>)}
          </select>
        </label>
        {shown.length > 0 && (
          <span className="ml-auto text-right text-sm text-slate-700">
            รวม{filtered ? "ตามตัวกรอง" : ""} {shown.length} รายการ · มูลค่าล่าสุด <b className="tabular-nums">{money(sum((r) => r.value), "THB")}</b>
            {note && <span className="block text-xs text-slate-500">{note}</span>}
          </span>
        )}
        {toggle && <span className={shown.length > 0 ? "" : "ml-auto"}>{toggle}</span>}
      </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-xs text-slate-500">
          <button type="button" onClick={() => setShowMap((v) => !v)} disabled={places.length === 0} aria-expanded={showMap}
            className={SMALL_BTN}>{showMap ? "ซ่อนแผนที่" : "แผนที่ดาวเทียม"}</button>
          <button type="button" onClick={() => downloadKml(shown, loc)} disabled={!shown.some((r) => r.geo)}
            className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">ส่งออกแผนที่ (KML)</button>
          <span>
            {shown.filter((r) => r.geo).length} แปลงตามตัวกรองที่มีพิกัด
            {shown.some((r) => !r.geo) && <> · ไม่มีพิกัด {shown.filter((r) => !r.geo).length} แปลง (ใส่ที่ &ldquo;แก้ไขข้อมูล&rdquo;)</>}
            {" "}· นำเข้า Google My Maps: สร้างแผนที่ › นำเข้า › เลือกไฟล์ · พิมพ์ / PDF ที่เมนู ⋮ › พิมพ์แผนที่
          </span>
          <Link target="_blank" title="พิมพ์ / บันทึก PDF ทุกแปลงตามตัวกรอง: แผนที่รวม + หน้าละ 1 แปลง"
            href={`/print/property?${new URLSearchParams({ ids: shown.map((r) => r.assetId).join(","), title: loc ? mapTitle : "", back: "/property" })}`}
            className={`${SMALL_BTN} ml-auto`}>พิมพ์ / PDF</Link>
        </div>
      )}
      {showMap && places.length > 0 && <PropertyMap places={places} title={mapTitle} />}
      <table className="mt-3 w-full min-w-[56rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3">ประเภท</th><th className="px-3">การใช้งาน</th>
            <th className="px-3 text-right">มูลค่าที่ซื้อ (THB)</th><th className="px-3 text-right">มูลค่าล่าสุด (THB)</th>
            <th className="px-3 text-right">รายได้ค่าเช่า (THB)</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{rows.length ? "ไม่มีทรัพย์สินตามตัวกรอง" : empty}</td></tr>}
          {shown.map((p) => (
            <tr key={p.id} className={`align-top hover:bg-slate-50 ${p.status !== "ACTIVE" ? "opacity-50" : ""}`}>
              <td className="px-3 py-3">
                {p.move && <span className="mr-2 align-middle">{p.move}</span>}
                <Link href={`/property/${p.assetId}`} className="font-medium text-slate-900 hover:underline">{p.name}</Link>
                {p.sub && <div className="text-xs text-slate-500">{p.sub}</div>}
              </td>
              <td className="px-3 py-3">{p.typeLabel}</td>
              <td className="px-3 py-3">{p.usageLabel}
                {p.vacant && <div className={`text-xs ${p.vacant.warn ? "font-medium text-amber-700" : "text-slate-500"}`}>{p.vacant.text}</div>}</td>
              <td className="px-3 py-3 text-right tabular-nums">{money(p.cost)}
                {p.costDate && <div className="text-xs text-slate-400">ซื้อ {thDate(p.costDate)}</div>}</td>
              <td className="px-3 py-3 text-right font-medium tabular-nums">{money(p.value)}
                <div className={`text-xs font-normal ${p.stale ? "text-amber-700" : "text-slate-400"}`}>ณ {thDate(p.valueDate)}{p.stale && " · เกิน 90 วัน"}</div></td>
              <td className="px-3 py-3 text-right tabular-nums">
                {p.rent > 0 || p.ytd > 0 ? <>
                  <div>{money(p.rent)}<span className="text-xs text-slate-400"> /เดือน</span></div>
                  <div className="text-xs text-slate-500">รับจริงปีนี้ {money(p.ytd)}</div>
                </> : <span className="text-slate-400">-</span>}
                {p.leases.map((l) => (
                  <div key={l.id} className="mt-1 text-xs text-slate-500">
                    <span className={`mr-1 rounded px-1.5 py-0.5 ${l.cls}`}>{l.badge}</span>{l.text}
                  </div>
                ))}
                {p.noLease && <div className="mt-1 text-xs text-amber-700">ไม่มีสัญญาที่มีผล</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ไฟล์แผนที่ของแปลงตามตัวกรอง (เฉพาะที่มีพิกัด) — สร้างในเบราว์เซอร์แล้วดาวน์โหลด */
function downloadKml(rows: PropRow[], loc: string) {
  const places = rows.filter((r) => r.geo).map((r) => ({
    name: r.name, lat: r.geo!.lat, lng: r.geo!.lng, group: r.loc, type: r.typeLabel, usage: r.usageLabel, usageCode: r.usage,
    area: r.area ?? null, address: r.address ?? null,
  }));
  const label = loc && loc !== "__none" ? ` · ${loc}` : "";
  const blob = new Blob([buildKml(`ทรัพย์สิน${label}`, places)], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `property-map${label ? "-" + loc.replace(/[\\/:*?"<>|\s]+/g, "_") : ""}-${todayBangkok()}.kml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
