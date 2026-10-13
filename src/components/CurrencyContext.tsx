"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CURRENCIES } from "@/lib/format";

// รายการสกุลเงินในช่องเลือก: กลุ่มบน = สกุลที่ครอบครัวใช้อยู่ · กลุ่ม "สกุลอื่น" = สกุลที่มีอัตราแลกเปลี่ยนในระบบ
type Lists = { used: string[]; others: string[] };
const Ctx = createContext<Lists | null>(null);

export function CurrencyProvider({ used, others, children }: Lists & { children: ReactNode }) {
  return <Ctx.Provider value={{ used, others }}>{children}</Ctx.Provider>;
}

/** สกุลเงินทั้งหมดที่เลือกได้ (ไม่มี Provider = รายการสำรองเดิม) */
export function useCurrencies(): Lists & { all: string[] } {
  const v = useContext(Ctx) ?? { used: ["THB", "USD"], others: CURRENCIES.filter((c) => c !== "THB" && c !== "USD") };
  return { ...v, all: [...v.used, ...v.others] };
}

/**
 * ตัวเลือกสกุลเงินสำหรับใส่ใน <select> — สกุลที่ใช้อยู่ก่อน แล้วตามด้วยกลุ่ม "สกุลอื่น"
 *   exclude = ไม่แสดงสกุลเหล่านี้ · include = ต้องมีสกุลนี้แน่ ๆ (เช่น ค่าเดิมของรายการ)
 *   valuePrefix / label = ใช้ทำตัวเลือกพิเศษ เช่น "new:NZD" → "บัญชีใหม่สกุล NZD"
 */
export function CurrencyOptions({ exclude = [], include, valuePrefix = "", label }: {
  exclude?: string[]; include?: string | null; valuePrefix?: string; label?: (c: string) => string;
}) {
  const { used, others } = useCurrencies();
  const skip = new Set(exclude);
  const top = used.filter((c) => !skip.has(c));
  if (include && !skip.has(include) && !used.includes(include) && !others.includes(include)) top.push(include);
  const rest = others.filter((c) => !skip.has(c));
  const opt = (c: string) => <option key={c} value={`${valuePrefix}${c}`}>{label ? label(c) : c}</option>;
  return (
    <>
      {top.map(opt)}
      {rest.length > 0 && <optgroup label="สกุลอื่น">{rest.map(opt)}</optgroup>}
    </>
  );
}
