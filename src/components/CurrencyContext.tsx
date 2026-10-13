"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { CURRENCIES } from "@/lib/format";

// รายการสกุลเงินในช่องเลือก: กลุ่มบน = สกุลที่ใช้อยู่ · "สกุลอื่น…" = สกุลที่มีอัตราแลกเปลี่ยนในระบบ (กดแล้วค่อยแสดง)
type Lists = { used: string[]; others: string[] };
const Ctx = createContext<Lists | null>(null);
const ScopeCtx = createContext<string[] | null>(null);

const head = (x: string) => (x === "THB" ? 0 : x === "USD" ? 1 : 2);
const sortCcy = (xs: string[]) => [...new Set(xs)].sort((x, y) => head(x) - head(y) || x.localeCompare(y));

/** รายการของทั้งครอบครัว (ใส่ไว้ที่ layout) */
export function CurrencyProvider({ used, others, children }: Lists & { children: ReactNode }) {
  return <Ctx.Provider value={{ used, others }}>{children}</Ctx.Provider>;
}

/** กลุ่มบนเฉพาะหน้านี้ (เช่น หน้าพอร์ต = สกุลที่พอร์ตใช้อยู่) · สกุลอื่นของครอบครัวย้ายไปอยู่ใน "สกุลอื่น…" */
export function CurrencyScope({ used, children }: { used: string[]; children: ReactNode }) {
  return <ScopeCtx.Provider value={sortCcy(used)}>{children}</ScopeCtx.Provider>;
}

/** สกุลเงินที่เลือกได้ (ไม่มี Provider = รายการสำรองเดิม) */
export function useCurrencies(): Lists & { all: string[] } {
  const base = useContext(Ctx) ?? { used: ["THB", "USD"], others: CURRENCIES.filter((c) => c !== "THB" && c !== "USD") };
  const scope = useContext(ScopeCtx);
  const allCcy = [...base.used, ...base.others];
  if (!scope) return { ...base, all: allCcy };
  const others = allCcy.filter((c) => !scope.includes(c)).sort();
  return { used: scope, others, all: [...scope, ...others] };
}

const MORE = "__more_currencies";

/**
 * ช่องเลือกสกุลเงิน: แสดงสกุลที่ใช้อยู่ + ตัวเลือกสุดท้าย "สกุลอื่น…" → เลือกแล้วแสดงรายการเต็ม
 *   (รายการปกติสั้น จึงกดง่ายแม้ช่องอยู่ล่างจอแล้วรายการเปิดขึ้นด้านบน)
 *   exclude = ไม่แสดงสกุลเหล่านี้ · include = ต้องมีสกุลนี้ในกลุ่มบน (เช่น ค่าเดิม)
 *   valuePrefix / label / before = ใช้ทำตัวเลือกพิเศษ เช่น บัญชีเดิม + "new:NZD" → "บัญชีใหม่สกุล NZD"
 */
export function CurrencySelect({ name, value, defaultValue, onChange, className, exclude = [], include,
  valuePrefix = "", label, before, moreLabel = "สกุลอื่น…", required, disabled }: {
  name: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string;
  exclude?: string[]; include?: string | null; valuePrefix?: string; label?: (c: string) => string;
  before?: ReactNode; moreLabel?: string; required?: boolean; disabled?: boolean;
}) {
  const { used, others } = useCurrencies();
  const skip = new Set(exclude);
  const top = used.filter((c) => !skip.has(c));
  if (include && !skip.has(include) && !top.includes(include)) top.push(include);
  const rest = others.filter((c) => !skip.has(c) && !top.includes(c));
  const [inner, setInner] = useState(defaultValue ?? (top[0] ?? rest[0] ? `${valuePrefix}${top[0] ?? rest[0]}` : ""));
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);
  const cur = value ?? inner;
  const curCcy = valuePrefix ? (cur.startsWith(valuePrefix) ? cur.slice(valuePrefix.length) : null) : cur;
  const showAll = expanded || (curCcy != null && rest.includes(curCcy));
  const opt = (c: string) => <option key={c} value={`${valuePrefix}${c}`}>{label ? label(c) : c}</option>;
  return (
    <select ref={ref} name={name} value={cur} required={required} disabled={disabled} className={className}
      onChange={(e) => {
        const v = e.target.value;
        if (v === MORE) {
          setExpanded(true);
          // เปิดรายการเต็มให้ทันที (เบราว์เซอร์ที่รองรับ)
          setTimeout(() => { try { ref.current?.showPicker?.(); } catch { /* ไม่รองรับ = ผู้ใช้กดเปิดเอง */ } }, 0);
          return;
        }
        if (value === undefined) setInner(v);
        onChange?.(v);
      }}>
      {before}
      {top.map(opt)}
      {rest.length > 0 && (showAll
        ? <optgroup label="สกุลอื่น">{rest.map(opt)}</optgroup>
        : <option value={MORE}>{moreLabel}</option>)}
    </select>
  );
}
