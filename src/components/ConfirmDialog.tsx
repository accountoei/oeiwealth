"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import Modal from "./Modal";

type Ask = { text: string; danger?: boolean; okLabel?: string; resolve: (ok: boolean) => void };

/**
 * หน้าต่างยืนยันกลางจอ (แทนหน้าต่างของ browser ที่ขึ้นขอบบนจอและบางเครื่องไม่แสดง)
 *   const { ask, dialog } = useConfirm();
 *   if (!(await ask("ลบรายการนี้?", { danger: true }))) return;   …   return <>{…}{dialog}</>;
 */
export function useConfirm() {
  const [cur, setCur] = useState<Ask | null>(null);
  const ask = (text: string, opts: { danger?: boolean; okLabel?: string } = {}) =>
    new Promise<boolean>((resolve) => setCur({ text, ...opts, resolve }));
  const done = (ok: boolean) => { cur?.resolve(ok); setCur(null); };
  const dialog: ReactNode = cur ? (
    <Modal onClose={() => done(false)}>
      <div className="space-y-4">
        <p className="whitespace-pre-line text-sm text-slate-800">{cur.text}</p>
        <div className="flex items-center gap-3">
          <button type="button" autoFocus onClick={() => done(true)}
            className={`rounded-md px-4 py-2 text-sm text-white ${cur.danger ? "bg-red-700 hover:bg-red-800" : "bg-blue-600 hover:bg-blue-700"}`}>
            {cur.okLabel ?? "ยืนยัน"}
          </button>
          <button type="button" onClick={() => done(false)} className="text-sm text-slate-500 hover:text-slate-800">ยกเลิก</button>
        </div>
      </div>
    </Modal>
  ) : null;
  return { ask, dialog };
}

/**
 * ยืนยันก่อนส่งฟอร์ม: ใส่ onSubmit ให้ <form> และวาง dialog ไว้นอก <form>
 *   const c = useConfirmSubmit();
 *   <form action={action} onSubmit={c.guard("ยืนยัน…?", { danger: true }, enabled)}>…</form>{c.dialog}
 */
export function useConfirmSubmit() {
  const { ask, dialog } = useConfirm();
  const pass = useRef(false);
  const guard = (text: string, opts: { danger?: boolean; okLabel?: string } = {}, enabled = true) => (e: FormEvent<HTMLFormElement>) => {
    if (!enabled) return;
    if (pass.current) { pass.current = false; return; }      // ยืนยันแล้ว → ส่งจริง
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    void ask(text, opts).then((ok) => {
      if (!ok) return;
      pass.current = true;
      form.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined);
    });
  };
  return { guard, dialog };
}
