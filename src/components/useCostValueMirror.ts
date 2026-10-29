"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";

// ฟอร์มเพิ่ม Property / Alternative (ตกลง 27 ต.ค. 2026): "ราคาที่ได้มา" กับ "มูลค่า" กรอกช่องใดช่องหนึ่งได้
//   อีกช่องใช้ยอดเดียวกันให้ (จนกว่าจะแก้ช่องนั้นเอง) · มูลค่าที่ใช้ราคาที่ได้มา → วิธีประเมิน "ราคาทุน"
//   "มูลค่า ณ วันที่" ตาม "วันที่ได้มา" (จนกว่าจะแก้เอง)
export function useCostValueMirror() {
  const cost = useRef<HTMLInputElement>(null);
  const value = useRef<HTMLInputElement>(null);
  const method = useRef<HTMLSelectElement>(null);
  const valDate = useRef<HTMLInputElement>(null);
  const own = useRef({ cost: false, value: false, method: false, valDate: false });
  const [copied, setCopied] = useState<"cost" | "value" | null>(null);   // ช่องที่ใช้ยอดจากอีกช่อง

  const onCost = (v: string) => {
    own.current.cost = v.trim() !== "";
    if (copied === "cost" && own.current.cost) setCopied(null);
    if (!own.current.value && value.current) {
      value.current.value = v;
      setCopied(v.trim() ? "value" : null);
      if (!own.current.method && method.current) method.current.value = v.trim() ? "BOOK_VALUE" : "USER_ESTIMATE";
    }
  };
  const onValue = (v: string) => {
    own.current.value = v.trim() !== "";
    if (copied === "value" && own.current.value) setCopied(null);
    if (!own.current.cost && cost.current) {
      cost.current.value = v;
      setCopied(v.trim() ? "cost" : null);
    }
  };
  const onAcqDate = (v: string) => { if (!own.current.valDate && valDate.current && v) valDate.current.value = v; };

  // ตารางส่วนประกอบ Property: มูลค่าใช้ยอดเดียวกับต้นทุน → วิธีประเมิน "ราคาทุน" (จนกว่าจะเลือกเอง)
  const setValueFromCost = useCallback((on: boolean) => {
    if (!own.current.method && method.current) method.current.value = on ? "BOOK_VALUE" : "USER_ESTIMATE";
  }, []);

  return {
    copied, setValueFromCost,
    costProps: { ref: cost, onChange: (e: ChangeEvent<HTMLInputElement>) => onCost(e.target.value) },
    valueProps: { ref: value, onChange: (e: ChangeEvent<HTMLInputElement>) => onValue(e.target.value) },
    methodProps: { ref: method, onChange: () => { own.current.method = true; } },
    acqDateProps: { onChange: (e: ChangeEvent<HTMLInputElement>) => onAcqDate(e.target.value) },
    valDateProps: { ref: valDate, onChange: () => { own.current.valDate = true; } },
  };
}
