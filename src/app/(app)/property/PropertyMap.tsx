"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * แผนที่ภาพดาวเทียมของทรัพย์สินตามตัวกรอง (เช่น กลุ่มทำเลเดียวกัน) · หมุดสีตามการใช้งาน + ป้ายชื่อ
 * แบบแผนที่ 3 แบบ (ปุ่มสลับบนหัวแผนที่):
 *  - ดาวเทียม + ชื่อ (ค่าเริ่มต้น) · ดาวเทียม · แผนที่ถนน (OpenStreetMap)
 *  - มี NEXT_PUBLIC_ARCGIS_API_KEY (ArcGIS Location Platform, จำกัดสิทธิ์เฉพาะ basemap + จำกัดโดเมน) → ภาพ Esri World Imagery
 *    (~0.5–1 ม.) + ชั้นชื่อสถานที่ / ถนนของ Esri · ไม่มี key → ภาพ Sentinel-2 ของ EOX (~10 ม.) + ชั้นชื่อของ CARTO (ข้อมูล OSM)
 *  - ทุกแหล่งต้องแสดงที่มามุมล่างขวา (ใส่ใน attribution ของแต่ละชั้นแล้ว)
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

const A = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const EOX_ATTR = `Sentinel-2 cloudless – ${A("https://s2maps.eu", "https://s2maps.eu")} by ${A("https://eox.at", "EOX IT Services GmbH")}`
  + " (Contains modified Copernicus Sentinel data 2024)";
const OSM_ATTR = `© ${A("https://www.openstreetmap.org/copyright", "OpenStreetMap")} contributors`;
const ESRI_ATTR = `Powered by ${A("https://www.esri.com", "Esri")} | Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`;

// ArcGIS Location Platform key (ใช้ฝั่งเบราว์เซอร์ได้ตามแบบของ Esri: ตั้งสิทธิ์เฉพาะ Basemaps + จำกัด referrer เป็นโดเมนของแอป)
const ESRI_KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim() || "";
const esri = (path: string) =>
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/${path}/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_KEY)}`;

type TileDef = { url: string; attribution?: string; maxNativeZoom: number; subdomains?: string; tileSize?: number; zoomOffset?: number };
// ภาพพื้นหลัง (ดาวเทียม) + ชั้นชื่อที่ซ้อนทับ
const SAT: TileDef = ESRI_KEY
  ? { url: esri("World_Imagery"), attribution: ESRI_ATTR, maxNativeZoom: 18 }
  : { url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg", attribution: EOX_ATTR, maxNativeZoom: 15 };
const CARTO_LABELS: TileDef = {
  url: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", subdomains: "abcd", maxNativeZoom: 18,
  attribution: `${OSM_ATTR} © ${A("https://carto.com/attributions", "CARTO")}`,
};
// ชั้นชื่อสถานที่ + ถนนสำหรับภาพดาวเทียม: มี key → Esri Static Basemap Tiles (arcgis/imagery/labels · ไทล์ 512 px → zoomOffset -1)
// ชั้น Reference/* บน ibasemaps-api ไม่แสดงผลกับ key ของ Location Platform (ทดสอบบน prod 10 พ.ย. 2569) จึงไม่ใช้
// ถ้าไทล์ชื่อของ Esri โหลดไม่ได้ จะสลับไปใช้ชื่อของ CARTO เองเพื่อให้ยังเห็นชื่อสถานที่
const ESRI_LABELS: TileDef | null = ESRI_KEY
  ? {
    url: "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/imagery/labels/static/tile/{z}/{y}/{x}"
      + `?token=${encodeURIComponent(ESRI_KEY)}`,
    maxNativeZoom: 19, tileSize: 512, zoomOffset: -1,
  }
  : null;
const LABELS: TileDef = ESRI_LABELS ?? CARTO_LABELS;
const STREET: TileDef = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR, maxNativeZoom: 19 };

type MapStyle = "hybrid" | "sat" | "street";
const STYLES: { key: MapStyle; label: string }[] = [
  { key: "hybrid", label: "ดาวเทียม + ชื่อ" },
  { key: "sat", label: "ดาวเทียม" },
  { key: "street", label: "แผนที่ถนน" },
];
const HINT: Record<MapStyle, string> = {
  hybrid: ESRI_KEY ? "ภาพดาวเทียมความละเอียดประมาณ 0.5–1 เมตร พร้อมชื่อสถานที่และถนน"
    : "ภาพดาวเทียมความละเอียดประมาณ 10 เมตร พร้อมชื่อสถานที่ · ดูแปลงใกล้ ๆ ให้เปิด Google Maps จากหมุด",
  sat: ESRI_KEY ? "ภาพดาวเทียมความละเอียดประมาณ 0.5–1 เมตร"
    : "ภาพดาวเทียมความละเอียดประมาณ 10 เมตร · ดูแปลงใกล้ ๆ ให้เปิด Google Maps จากหมุด",
  street: "แผนที่ถนน OpenStreetMap มีชื่อสถานที่ภาษาไทย",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function PropertyMap({ places, title }: { places: MapPlace[]; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const pins = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const base = useRef<Leaflet.LayerGroup | null>(null);
  const [labels, setLabels] = useState(true);
  const [style, setStyle] = useState<MapStyle>("hybrid");

  // สร้างแผนที่ครั้งเดียว
  useEffect(() => {
    let off = false;
    import("leaflet").then((mod) => {
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (off || !box.current || map.current) return;
      const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      m.attributionControl.setPrefix(false);
      L.control.scale({ imperial: false }).addTo(m);
      lib.current = L;
      map.current = m;
      base.current = L.layerGroup().addTo(m);
      pins.current = L.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      off = true;
      map.current?.remove();
      map.current = null;
      pins.current = null;
      base.current = null;
    };
  }, []);

  // เปลี่ยนแบบแผนที่ (ภาพพื้นหลัง + ชั้นชื่อ)
  useEffect(() => {
    const L = lib.current, group = base.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    const make = (d: TileDef, z: number) => L.tileLayer(d.url, {
      attribution: d.attribution, maxNativeZoom: d.maxNativeZoom, maxZoom: 19, zIndex: z,
      ...(d.subdomains ? { subdomains: d.subdomains } : {}),
      ...(d.tileSize ? { tileSize: d.tileSize, zoomOffset: d.zoomOffset ?? 0 } : {}),
    }).addTo(group);
    const defs = style === "street" ? [STREET] : style === "sat" ? [SAT] : [SAT, LABELS];
    defs.forEach((d, i) => {
      const layer = make(d, i + 1);
      if (d === ESRI_LABELS) layer.once("tileerror", () => {
        console.warn("Esri label tiles failed; using CARTO labels instead");
        group.removeLayer(layer);
        make(CARTO_LABELS, i + 1);
      });
    });
  }, [ready, style]);

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
        <span className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="แบบแผนที่">
          {STYLES.map((o) => (
            <button key={o.key} type="button" aria-pressed={style === o.key} onClick={() => setStyle(o.key)}
              className={`px-2.5 py-1 ${style === o.key ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"} border-l border-slate-300 first:border-l-0`}>
              {o.label}
            </button>
          ))}
        </span>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> แสดงชื่อแปลง
        </label>
      </div>
      <div ref={box} className="h-[420px] w-full overflow-hidden rounded-lg bg-slate-900 md:h-[520px]" aria-label="แผนที่ทรัพย์สิน" />
      <p className="mt-1 text-xs text-slate-500">กดหมุดเพื่อดูรายละเอียด · ซูมด้วยปุ่ม + / − · {HINT[style]}</p>
    </div>
  );
}
