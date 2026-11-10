import type * as Leaflet from "leaflet";

/**
 * ชั้นแผนที่ที่ใช้ร่วมกัน: แผนที่ดาวเทียมในหน้ารวม (PropertyMap) + หน้าพิมพ์ทรัพย์สิน (/print/property)
 * มี NEXT_PUBLIC_ARCGIS_API_KEY → ภาพ Esri World Imagery + ชั้นชื่อ Esri · ไม่มี key หรือ key ใช้ไม่ได้ → ภาพ Sentinel-2 ของ EOX + ชื่อของ CARTO
 */
// สีเดียวกับหมุดในไฟล์ KML (src/lib/kml.ts)
export const USAGE_COLOR: Record<string, string> = {
  BUSINESS_USE: "#483d8b",
  OWNER_OCCUPIED: "#dc143c",
  PERSONAL_USE: "#dc143c",
  RENTAL: "#0078d7",
  VACANT: "#8c8c8c",
};
const OTHER_COLOR = "#ffa500";
export const colorOf = (usage: string) => USAGE_COLOR[usage] ?? OTHER_COLOR;

const A = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const EOX_ATTR = `Sentinel-2 cloudless – ${A("https://s2maps.eu", "https://s2maps.eu")} by ${A("https://eox.at", "EOX IT Services GmbH")}`
  + " (Contains modified Copernicus Sentinel data 2024)";
const OSM_ATTR = `© ${A("https://www.openstreetmap.org/copyright", "OpenStreetMap")} contributors`;
const ESRI_ATTR = `Powered by ${A("https://www.esri.com", "Esri")} | Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`;

// ArcGIS Location Platform key (ใช้ฝั่งเบราว์เซอร์ได้ตามแบบของ Esri: ตั้งสิทธิ์เฉพาะ Basemaps + จำกัด referrer เป็นโดเมนของแอป)
export const ESRI_KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim() || "";
const esri = (path: string) =>
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/${path}/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_KEY)}`;

export type TileDef = { url: string; attribution?: string; maxNativeZoom: number; subdomains?: string; tileSize?: number; zoomOffset?: number };
// ภาพพื้นหลัง (ดาวเทียม) + ชั้นชื่อที่ซ้อนทับ
// ภาพดาวเทียมฟรีของ EOX (~10 ม.) ไม่ต้องใช้ key ไม่มีวันหมดอายุ = ภาพสำรองเมื่อไม่มี key หรือ key ใช้ไม่ได้ (หมดอายุ / ถูกยกเลิก)
export const EOX_SAT: TileDef = {
  url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg", attribution: EOX_ATTR, maxNativeZoom: 15,
};
const ESRI_SAT: TileDef | null = ESRI_KEY ? { url: esri("World_Imagery"), attribution: ESRI_ATTR, maxNativeZoom: 18 } : null;
export const SAT: TileDef = ESRI_SAT ?? EOX_SAT;
export const CARTO_LABELS: TileDef = {
  url: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", subdomains: "abcd", maxNativeZoom: 18,
  attribution: `${OSM_ATTR} © ${A("https://carto.com/attributions", "CARTO")}`,
};
// ชั้นชื่อสถานที่ + ถนนสำหรับภาพดาวเทียม: มี key → Esri Static Basemap Tiles (arcgis/imagery/labels · ไทล์ 512 px → zoomOffset -1)
// ชั้น Reference/* บน ibasemaps-api ไม่แสดงผลกับ key ของ Location Platform (ทดสอบบน prod 10 พ.ย. 2569) จึงไม่ใช้
// ถ้าไทล์ชื่อของ Esri โหลดไม่ได้ จะสลับไปใช้ชื่อของ CARTO เองเพื่อให้ยังเห็นชื่อสถานที่
export const ESRI_LABELS: TileDef | null = ESRI_KEY
  ? {
    url: "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/imagery/labels/static/tile/{z}/{y}/{x}"
      + `?token=${encodeURIComponent(ESRI_KEY)}`,
    maxNativeZoom: 19, tileSize: 512, zoomOffset: -1,
  }
  : null;
export const LABELS: TileDef = ESRI_LABELS ?? CARTO_LABELS;
export const STREET: TileDef = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR, maxNativeZoom: 19 };


/** ภาพดาวเทียม Esri โหลดไม่ขึ้นติดกันกี่ช่อง จึงถือว่า key ใช้ไม่ได้ แล้วสลับไปภาพ EOX (กันเน็ตสะดุดชั่วคราวแล้วสลับผิด) */
const SAT_FAIL_LIMIT = 4;

/** ใส่ชั้นแผนที่ลงกลุ่ม (ล้างของเดิมก่อน) · สำรองอัตโนมัติ: ชื่อของ Esri โหลดไม่ได้ → ชื่อของ CARTO ·
 *  ภาพดาวเทียม Esri โหลดไม่ขึ้นติดกัน SAT_FAIL_LIMIT ช่อง (เช่น key หมดอายุ) → ภาพ EOX · กดรีเฟรชหน้าจะลอง Esri ใหม่ */
export function addTiles(L: typeof Leaflet, group: Leaflet.LayerGroup, defs: TileDef[]) {
  group.clearLayers();
  const make = (d: TileDef, z: number) => L.tileLayer(d.url, {
    attribution: d.attribution, maxNativeZoom: d.maxNativeZoom, maxZoom: 19, zIndex: z,
    ...(d.subdomains ? { subdomains: d.subdomains } : {}),
    ...(d.tileSize ? { tileSize: d.tileSize, zoomOffset: d.zoomOffset ?? 0 } : {}),
  }).addTo(group);
  defs.forEach((d, i) => {
    const layer = make(d, i + 1);
    if (d === ESRI_LABELS) layer.once("tileerror", () => {
      console.warn("Esri label tiles failed; using CARTO labels instead");
      group.removeLayer(layer);
      make(CARTO_LABELS, i + 1);
    });
    if (d === ESRI_SAT) {
      let fails = 0;
      layer.on("tileload", () => { fails = 0; });
      layer.on("tileerror", () => {
        if (++fails < SAT_FAIL_LIMIT || !group.hasLayer(layer)) return;
        console.warn("Esri imagery tiles failed; using EOX Sentinel-2 imagery instead (ArcGIS key expired or invalid?)");
        group.removeLayer(layer);
        make(EOX_SAT, i + 1);
      });
    }
  });
}

/** รูปแผนที่คงที่ของ Esri (ภาพดาวเทียม + ชื่อสถานที่ + หมุดตรงกลาง) สำหรับหน้าพิมพ์ · ไม่มี key = null (ใช้แผนที่ Leaflet แทน)
 *  ต้องมีสิทธิ์ premium:user:staticMaps ใน key · ขนาดสูงสุด 1024 × 1024 px · ข้อความที่มาฝังในรูปเอง (attribution=auto) */
export function staticMapUrl(lat: number, lng: number, color: string, zoom = 17, width = 1024, height = 600): string | null {
  if (!ESRI_KEY) return null;
  const q = new URLSearchParams({ x: String(lng), y: String(lat), zoom: String(zoom), width: String(width), height: String(height),
    format: "jpeg", symbolStyle: "pin", symbolColor: color.replace("#", ""), token: ESRI_KEY });
  return `https://static-maps-api.arcgis.com/arcgis/rest/services/static-maps-service/v1/static-maps/arcgis/imagery/with-point?${q}`;
}
