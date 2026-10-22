"use client";

import { useEffect, useRef, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { checkBankOutflow } from "@/lib/bank-check";
import { money, thDate, numOrZero as num } from "@/lib/format";

const todayTh = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

/**
 * เตือนก่อนบันทึก ถ้าเงินออกรายการนี้ทำให้ยอดบัญชีธนาคารติดลบ (ไม่บล็อก — กดยืนยันแล้วบันทึกต่อได้)
 *   วางไว้ "ข้างใน" <form> ของฟอร์มเงินออก แล้วบอกชื่อช่อง: บัญชี / จำนวน (หลายช่องได้ เช่น จำนวน + ค่าธรรมเนียม) / วันที่
 *   ตรวจยอด ณ วันที่ทำรายการ และวันถัดไปที่บัญชีนั้นมีรายการ (กรณีลงย้อนหลัง)
 *   when = ตรวจเฉพาะเมื่อช่องนั้นมีค่าตามที่กำหนด (เช่น ประเภทรายการ = โอน / จ่ายบัตร)
 */
export default function BalanceGuard({ bank = "bank_asset_id", amount = "amount", date = "date", when }: {
  bank?: string; amount?: string | string[];
  /** ช่องวันที่ (หลายช่อง = ใช้ช่องแรกที่กรอก เช่น วันเงินออกจริง → วันที่รายการ) */
  date?: string | string[]; when?: [string, string[]];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const pass = useRef(false);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();
  const askRef = useRef(ask);
  askRef.current = ask;
  const cfg = useRef({ bank, amount, date, when });
  cfg.current = { bank, amount, date, when };

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (pass.current) { pass.current = false; return; }    // ตรวจ / ยืนยันแล้ว → บันทึกจริง
      const c = cfg.current;
      const fd = new FormData(form);
      if (c.when && !c.when[1].includes(String(fd.get(c.when[0]) ?? ""))) return;
      const bankId = String(fd.get(c.bank) ?? "");
      const amt = (Array.isArray(c.amount) ? c.amount : [c.amount]).reduce((t, n) => t + num(fd.get(n)), 0);
      if (!bankId || !(amt > 0)) return;
      const d = (Array.isArray(c.date) ? c.date : [c.date]).map((n) => String(fd.get(n) ?? "")).find(Boolean) || todayTh();
      e.preventDefault();
      e.stopPropagation();                                     // ยังไม่ส่งให้ React บันทึก
      const submitter = e.submitter instanceof HTMLButtonElement ? e.submitter : undefined;
      const go = () => { pass.current = true; form.requestSubmit(submitter); };
      setBusy(true);
      checkBankOutflow(bankId, d, amt).catch(() => null).then(async (r) => {
        setBusy(false);
        if (!r || (r.at >= -0.005 && !r.low)) return go();
        const lines = [`ยอดเงินในบัญชี ${r.name} จะติดลบ`];
        if (r.at < -0.005) lines.push(`ณ ${thDate(d)} (วันที่ทำรายการ): ${money(r.at, r.currency)}`);
        if (r.low) lines.push(`ณ ${thDate(r.low.date)} (มีรายการถัดไป): ${money(r.low.value, r.currency)}`);
        lines.push("", "ตรวจบัญชี / วันที่ / จำนวนเงิน อีกครั้ง · ถ้าถูกต้องแล้ว (เช่น มีเงินเข้าที่ยังไม่ได้บันทึก) กด \"บันทึกต่อ\"");
        if (await askRef.current(lines.join("\n"), { okLabel: "บันทึกต่อ" })) go();
      });
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      {busy && <span className="text-xs text-slate-500">กำลังตรวจยอดเงินในบัญชี…</span>}
      {dialog}
    </>
  );
}
