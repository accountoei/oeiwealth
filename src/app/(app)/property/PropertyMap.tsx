"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * แผนที่ภาพดาวเทียมของทรัพย์สินตามตัวกรอง (เช่น กลุ่มทำเลเดียวกัน) · หมุดสีตามการใช้งาน + ป้ายชื่อ
 * ภาพ: Sentinel-2 cloudless 2024 ของ EOX (ฟรีสำหรับใช้ที่ไม่ใช่เชิงพาณิชย์ ต้องแสดงที่มา) · ความละเอียด ~10 ม. เหมาะกับดูภาพรวมทำเล
 * โหลดเฉพาะตอนกดเปิดแผนที่ (PropertyTable ใช้ next/dynamic) · ไม่แสดงมูลค่า / ราคา (เหมือนไฟล์ KML · ภาพหน้าจออาจถูกส่งต่อ)
 */
export type MapPlace = {
  id: string; assetId: string; name: string; lat: number; lng: number;
  usage: string; usageLabel: string; typeLabel: string; loc: string | null; area: string | null;
};

// สีเดียวกับหมุดในไฟล์ KML (src/lib/kml.ts)
const USAGE_COLOR: Record<string, string> = {
  BUSINESS_USE: "#483d8b",
  OWNER_OCCUPIED: "#dc143c",
  PERSONAL_USE: "#dc143c",
  RENTAL: "#0078d7",
  VACANT: "#8c8c8c",
};
const OTHER_COLOR = "#ffa500";
const colorOf = (usage: string) => USAGE_COLOR[usage] ?? OTHER_COLOR;

const TILE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const ATTR = 'Sentinel-2 cloudless – <a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">https://s2maps.eu</a>'
  + ' by <a href="https://eox.at" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2024)';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function PropertyMap({ places, title }: { places: MapPlace[]; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const pins = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState(true);

  // สร้างแผนที่ครั้งเดียว
  useEffect(() => {
    let off = false;
    import("leaflet").then((mod) => {
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (off || !box.current || map.current) return;
      const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      m.attributionControl.setPrefix(false);
      L.tileLayer(TILE, { attribution: ATTR, maxNativeZoom: 15, maxZoom: 18 }).addTo(m);
      L.control.scale({ imperial: false }).addTo(m);
      lib.current = L;
      map.current = m;
      pins.current = L.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      off = true;
      map.current?.remove();
      map.current = null;
      pins.current = null;
    };
  }, []);

  // วาดหมุดใหม่เมื่อตัวกรองเปลี่ยน
  useEffect(() => {
    const L = lib.current, m = map.current, layer = pins.current;
    if (!ready || !L || !m || !layer) return;
    layer.clearLayers();
    for (const p of places) {
      const icon = L.divIcon({ className: "pm-pin-wrap", html: `<span class="pm-pin" style="--pm:${colorOf(p.usage)}"></span>`,
        iconSize: [18, 18], iconAnchor: [9, 9] });
      const sub = [p.typeLabel, p.usageLabel, p.area].filter(Boolean).map((s) => esc(String(s))).join(" · ");
      const gmaps = `https://www.google.com/maps?q=${p.lat},${p.lng}`;
      L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: true })
        .bindTooltip(esc(p.name), { permanent: labels, direction: "right", offset: [10, 0], className: "pm-label" })
        .bindPopup(`<div class="pm-pop"><b>${esc(p.name)}</b>${p.loc ? `<div>${esc(p.loc)}</div>` : ""}<div>${sub}</div>`
          + `<div class="pm-links"><a href="/property/${encodeURIComponent(p.assetId)}">เปิดหน้าทรัพย์สิน</a>`
          + `<a href="${gmaps}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a></div></div>`)
        .addTo(layer);
    }
    if (places.length === 1) m.setView([places[0].lat, places[0].lng], 15);
    else if (places.length > 1) m.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number])), { padding: [48, 48], maxZoom: 16 });
  }, [ready, places, labels]);

  const legend = [...new Map(places.map((p) => [colorOf(p.usage), p.usageLabel]))];
  return (
    <div className="px-4 pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{title} · {places.length} แปลง</span>
        {legend.map(([c, l]) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: c }} />{l}
          </span>
        ))}
        <label className="ml-auto inline-flex items-center gap-1">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> แสดงชื่อ
        </label>
      </div>
      <div ref={box} className="h-[420px] w-full overflow-hidden rounded-lg bg-slate-900 md:h-[520px]" aria-label="แผนที่ภาพดาวเทียมของทรัพย์สิน" />
      <p className="mt-1 text-xs text-slate-500">กดหมุดเพื่อดูรายละเอียด · ซูมด้วยปุ่ม + / − · ภาพดาวเทียมความละเอียดประมาณ 10 เมตร ดูแปลงใกล้ ๆ ให้เปิด Google Maps จากหมุด</p>
    </div>
  );
}
