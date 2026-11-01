"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type TrendPoint = { label: string; date: string; v: number; solid: boolean };

const fmtBaht = (v: number) => `${Math.round(v).toLocaleString("en-US")} บาท`;

/**
 * กราฟเส้น Net Worth (SVG) — จุดทึบ = ยอดยืนยันแล้ว, จุดกลวง = ประมาณการ
 * วาดตามความกว้างจริงของกล่อง (ไม่ย่อทั้งภาพ) → ตัวหนังสือแกนขนาดเท่าเดิมทุกจอ (เดิมบนมือถือเหลือ ~4–5px)
 * ชี้ (เมาส์) / แตะ (มือถือ) / ปุ่มลูกศร (คีย์บอร์ด) → กล่องค่าของจุดที่ใกล้ที่สุด
 */
export default function TrendChart({ points, selected }: { points: TrendPoint[]; selected: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) return <p className="text-sm text-slate-500">ข้อมูลยังไม่พอแสดงกราฟ</p>;

  // ก่อนรู้ความกว้าง (ตอนโหลดหน้า) ใช้ 640 แล้วย่อ / ขยายตามกล่องไปก่อน
  const W = w || 640;
  const narrow = W < 480;
  // จอแคบ: แกนตัวเลขซ้ายอย่างเดียว · จอกว้าง: ซ้าย + ขวา (ชุดเดียวกัน → อ่านค่าจุดล่าสุดด้านขวาได้ง่าย)
  const H = narrow ? 200 : 220, L = narrow ? 52 : 70, R = narrow ? 16 : 70, T = 12, B = 28;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  // ทศนิยมแกนปรับตามช่วงยอด: ยอดขยับน้อย → แสดงละเอียดขึ้น (กันป้ายซ้ำกัน เช่น 209.4M สามบรรทัด)
  const step = (hi - lo) / 2;
  const fmt = (v: number) => {
    const [div, unit] = Math.abs(v) >= 1e6 ? [1e6, "M"] : Math.abs(v) >= 1e3 ? [1e3, "K"] : [1, ""];
    const d = Math.min(4, Math.max(unit === "M" ? 1 : 0, Math.ceil(-Math.log10(step / div))));
    return `${(v / div).toFixed(d)}${unit}`;
  };
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const showLabel = (i: number) => i === 0 || i === points.length - 1 || points.length <= (narrow ? 4 : 8);

  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    const i = Math.round(((px - L) * (points.length - 1)) / (W - L - R));
    return Math.min(points.length - 1, Math.max(0, i));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = points.length - 1;
    const cur = active ?? (selected >= 0 ? selected : last);
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next == null) { if (e.key === "Escape") setActive(null); return; }
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };
  const a = active != null ? points[active] : null;

  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
        role="img" tabIndex={0}
        aria-label={`กราฟ Net Worth: ${points.map((p) => `${p.label} ${fmtBaht(p.v)}`).join(", ")}`}
        onPointerMove={(e) => setActive(nearest(e))}
        onPointerDown={(e) => setActive(nearest(e))}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
        onKeyDown={onKey} onBlur={() => setActive(null)}>
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f5eff" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#1f5eff" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e6ecf7" strokeWidth={1} strokeDasharray="3 4" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="#4b5567">{fmt(t)}</text>
            {!narrow && <text x={W - R + 8} y={y(t) + 4} textAnchor="start" fontSize={12} fill="#4b5567">{fmt(t)}</text>}
          </g>
        ))}
        <path d={`${path} L${x(points.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`} fill="url(#nwFill)" stroke="none" />
        <path d={path} fill="none" stroke="#1f5eff" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {active != null && <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} stroke="#86afff" strokeWidth={1} />}
        {points.map((p, i) => (
          <g key={i}>
            {i === selected && <circle cx={x(i)} cy={y(p.v)} r={10} fill="none" stroke="#86afff" strokeWidth={2.5} />}
            <circle cx={x(i)} cy={y(p.v)} r={i === active ? 6.5 : 5} fill={p.solid ? "#1f5eff" : "#ffffff"} stroke="#1f5eff" strokeWidth={2} />
            {showLabel(i) && (
              <text x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={12} fill="#4b5567">{p.label}</text>
            )}
          </g>
        ))}
      </svg>
      {a && active != null && w > 0 && (
        // กล่องค่าของจุด: อยู่เหนือจุด · ชิดขอบซ้าย / ขวาเมื่อเป็นจุดริม (ไม่ล้นกล่อง)
        <div role="status" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: x(active), top: Math.max(0, y(a.v) - 12),
            transform: `translate(${active === 0 ? "-12px" : active === points.length - 1 ? "calc(-100% + 12px)" : "-50%"}, -100%)` }}>
          <div className="text-slate-300">{a.label} · {a.date.slice(8, 10)}/{a.date.slice(5, 7)}/{Number(a.date.slice(0, 4)) + 543}{a.solid ? "" : " · ประมาณการ"}</div>
          <div className="font-semibold tabular-nums">{fmtBaht(a.v)}</div>
        </div>
      )}
    </div>
  );
}
