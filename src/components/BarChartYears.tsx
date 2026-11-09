"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { baht } from "@/lib/format";

const TREND = "#334155";
/** ตัวอย่างเส้นประในคำอธิบายสี / กล่องค่า (ใช้วางมุมขวาของหัวกราฟได้ · trendLegend={false}) */
export function TrendSwatch({ light }: { light?: boolean }) {
  return <svg width="18" height="6" aria-hidden className="shrink-0"><line x1="0" x2="18" y1="3" y2="3" stroke={light ? "#cbd5e1" : TREND} strokeWidth="2" strokeDasharray="5 3" /></svg>;
}

export type BarSeries = { key: string; label: string; color: string; values: (number | null)[];
  /** สีของยอดติดลบ (กราฟกำไร / ขาดทุน ชุดเดียว) */ negColor?: string };

/**
 * กราฟแท่งรายปี (SVG · ตกลง 9 พ.ย. 2026 สำหรับผลประกอบการ Private Business)
 *   หลายชุด = แท่งซ้อน (ยอดบวกซ้อนขึ้น · ยอดติดลบซ้อนลงใต้เส้น 0)
 *   วาดตามความกว้างจริงของกล่อง → ตัวหนังสือแกนขนาดเท่าเดิมทุกจอ · ปีเยอะบนจอแคบ = ป้ายปีเว้นระยะ
 *   ชี้ (เมาส์) / แตะ (มือถือ) / ปุ่มลูกศร (คีย์บอร์ด) → กล่องค่าของปีนั้น (ทุกชุด + รวม + เหตุการณ์)
 *   9 พ.ย. 2026: แกนตัวเลขซ้าย + ขวา (ยกเว้นมือถือ) · เส้นแนวโน้มประ (trend) เช่น เฉลี่ย 3 ปี
 */
export default function BarChartYears({ years, series, height = 220, total = true, events = {}, title, trend, trendLabel = "เฉลี่ย 3 ปี", trendLegend = true }: {
  years: number[]; series: BarSeries[]; height?: number; total?: boolean;
  /** ป้ายเหตุการณ์ของปี (ค.ศ.) เช่น "OEI เปิด" → ▲ ใต้แท่ง + ในกล่องค่า */ events?: Record<number, string[]>;
  title: string;
  /** เส้นแนวโน้ม (ค่าต่อปี ตรงกับ years · null = เว้นช่วง) เช่น ค่าเฉลี่ย 3 ปีของยอดรวม → เส้นประบนแท่ง (9 พ.ย. 2026) */
  trend?: (number | null)[]; trendLabel?: string;
  /** false = ไม่ใส่ป้ายเส้นใต้กราฟ (วางเองที่หัวกราฟ หรือไม่มีป้าย · ชี้ที่ปียังเห็นค่าในกล่องค่า) */ trendLegend?: boolean;
}) {
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
  if (years.length === 0) return <p className="text-sm text-slate-500">ยังไม่มีข้อมูล</p>;

  const W = w || 720;
  const narrow = W < 520;
  const H = height;
  // แกนตัวเลขทั้งซ้ายและขวา (9 พ.ย. 2026) · มือถือ (< 520px) แกนซ้ายอย่างเดียว ให้แท่งกว้างพอดู
  const L = narrow ? 44 : 56, R = narrow ? 16 : 52, T = 10;
  const hasEvents = Object.keys(events).length > 0;
  const B = hasEvents ? 34 : 24;
  const n = years.length;
  const up = years.map((_, i) => series.reduce((t, s) => t + Math.max(0, s.values[i] ?? 0), 0));
  const down = years.map((_, i) => series.reduce((t, s) => t + Math.min(0, s.values[i] ?? 0), 0));
  const tv = (trend ?? []).filter((v): v is number => v != null);
  const showTrend = trendLegend && tv.length > 0;
  const rawHi = Math.max(0, ...up, ...tv), rawLo = Math.min(0, ...down, ...tv);
  // ขีดแกน "สวย" (1 · 2 · 2.5 · 5 × 10^n) ประมาณ 4 ช่อง
  const span = rawHi - rawLo || 1;
  const mag = 10 ** Math.floor(Math.log10(span / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 5) ?? 10 * mag;
  const hi = Math.ceil(rawHi / step) * step || step, lo = Math.floor(rawLo / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const band = (W - L - R) / n;
  const bw = Math.max(2, Math.min(28, band * 0.7));
  const cx = (i: number) => L + band * i + band / 2;
  const fmt = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${+(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e3) return `${+(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };
  const every = Math.max(1, Math.ceil(n / Math.floor((W - L - R) / (narrow ? 34 : 38))));
  const showYear = (i: number) => i === n - 1 || (n - 1 - i) % every === 0;

  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    return Math.min(n - 1, Math.max(0, Math.floor((px - L) / band)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = active ?? n - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next == null) { if (e.key === "Escape") setActive(null); return; }
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };
  // เส้นแนวโน้ม: ต่อจุดปีที่มีค่า · ปีที่เป็น null = ตัดเส้น
  let trendPath = "";
  trend?.forEach((v, i) => { if (v == null) return; trendPath += `${i > 0 && trend[i - 1] != null ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)} `; });
  const colorOf = (s: BarSeries, v: number) => (v < 0 && s.negColor ? s.negColor : s.color);
  const sumAt = (i: number) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0);

  return (
    <div>
      <div ref={box} className="relative" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full touch-pan-y select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          role="img" tabIndex={0} aria-label={`${title}: ${years.map((yr, i) => `${yr + 543} ${baht(sumAt(i))}`).join(", ")}`}
          onPointerMove={(e) => setActive(nearest(e))} onPointerDown={(e) => setActive(nearest(e))}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
          onKeyDown={onKey} onBlur={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#94a3b8" : "#e6ecf7"} strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#4b5567">{fmt(t)}</text>
              {!narrow && <text x={W - R + 6} y={y(t) + 4} textAnchor="start" fontSize={11} fill="#4b5567">{fmt(t)}</text>}
            </g>
          ))}
          {active != null && <rect x={L + band * active} y={T} width={band} height={H - T - B} fill="#eef4ff" />}
          {years.map((yr, i) => {
            let pos = 0, neg = 0;
            return (
              <g key={yr}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (!v) return null;
                  const from = v > 0 ? pos : neg;
                  const to = from + v;
                  if (v > 0) pos = to; else neg = to;
                  const top = y(Math.max(from, to)), h = Math.max(1, Math.abs(y(from) - y(to)));
                  return <rect key={s.key} x={cx(i) - bw / 2} y={top} width={bw} height={h} fill={colorOf(s, v)} />;
                })}
                {showYear(i) && <text x={cx(i)} y={H - (hasEvents ? 18 : 6)} textAnchor="middle" fontSize={11} fill="#4b5567">{yr + 543}</text>}
                {events[yr] && <text x={cx(i)} y={H - 3} textAnchor="middle" fontSize={10} fill="#b45309">▲</text>}
              </g>
            );
          })}
          {trendPath && <path d={trendPath} fill="none" stroke={TREND} strokeWidth={1.75} strokeDasharray="5 4" strokeLinejoin="round" />}
          {trend?.map((v, i) => v != null && <circle key={i} cx={cx(i)} cy={y(v)} r={i === active ? 3.5 : 2.5} fill={TREND} />)}
        </svg>
        {active != null && w > 0 && (
          <div role="status" className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: cx(active), transform: `translateX(${cx(active) < W * 0.3 ? "-10%" : cx(active) > W * 0.7 ? "-90%" : "-50%"})` }}>
            <div className="font-medium text-slate-300">ปี {years[active] + 543}</div>
            {series.filter((s) => s.values[active] != null).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorOf(s, s.values[active] ?? 0) }} />{s.label}</span>
                <span className="tabular-nums">{baht(s.values[active] ?? 0)}</span>
              </div>
            ))}
            {total && series.length > 1 && <div className="mt-0.5 flex justify-between gap-4 border-t border-slate-700 pt-0.5 font-semibold"><span>รวม</span><span className="tabular-nums">{baht(sumAt(active))}</span></div>}
            {trend?.[active] != null && <div className="flex items-center justify-between gap-4 text-slate-300">
              <span className="flex items-center gap-1.5"><TrendSwatch light />{trendLabel}</span><span className="tabular-nums">{baht(trend[active]!)}</span></div>}
            {events[years[active]]?.map((t) => <div key={t} className="text-amber-300">▲ {t}</div>)}
          </div>
        )}
      </div>
      {(series.length > 1 || showTrend) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {series.length > 1 && series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
          {showTrend && <span className="flex items-center gap-1.5"><TrendSwatch />{trendLabel}{series.length > 1 ? " (ยอดรวม)" : ""}</span>}
        </div>
      )}
    </div>
  );
}
