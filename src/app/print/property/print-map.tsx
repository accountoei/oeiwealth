"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { LABELS, SAT, addTiles } from "@/app/(app)/property/map-tiles";

export type PrintPin = { lat: number; lng: number; label: string; color: string };

/** แผนที่ดาวเทียม + ชื่อสถานที่สำหรับหน้าพิมพ์ (Leaflet) · เลื่อน / ซูมจัดกรอบได้ก่อนพิมพ์ · ปุ่มซูมไม่ออกในกระดาษ */
export default function PrintMap({ pins, zoom = 17, className }: { pins: PrintPin[]; zoom?: number; className: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: Leaflet.Map | null = null;
    let off = false;
    import("leaflet").then((mod) => {
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (off || !box.current || pins.length === 0) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      map.attributionControl.setPrefix(false);
      addTiles(L, L.layerGroup().addTo(map), [SAT, LABELS]);
      for (const p of pins) {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: "pm-pin-wrap", html: `<span class="pm-pin" style="--pm:${p.color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
          keyboard: false,
        }).bindTooltip(p.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
          { permanent: true, direction: "right", offset: [10, 0], className: "pm-label" }).addTo(map);
      }
      if (pins.length === 1) map.setView([pins[0].lat, pins[0].lng], zoom);
      else map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [48, 48], maxZoom: 16 });
      L.control.scale({ imperial: false }).addTo(map);
    });
    return () => { off = true; map?.remove(); };
  }, [pins, zoom]);
  return <div ref={box} className={`print-map relative isolate z-0 overflow-hidden rounded-md bg-slate-200 ${className}`} />;
}
