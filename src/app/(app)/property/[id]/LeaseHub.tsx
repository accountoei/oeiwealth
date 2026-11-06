"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { LeaseEditBody, NewLeaseBody, type LeaseMain } from "./forms";
import type { Bank, CarryOption, LeasePrefill } from "../LeaseFields";
import type { LeaseDetail, LeaseDetailOptions } from "../LeaseContractFields";

/** สัญญาที่แก้ได้ในหน้าต่างสัญญาเช่า · old = สัญญาเดิมที่จบแล้ว (แก้ได้เฉพาะ ADMIN) */
export type LeaseEditEntry = {
  id: string; label: string; old: boolean;
  m: LeaseMain; v: Partial<LeaseDetail>; rentCurrency: string; rentTo: string | null; depositMonths: number | null;
  deleteControl?: ReactNode;
};

// ค่า "ทำอะไร": "" = สัญญาใหม่ (กรอกเอง) · renew:<id> = ต่อสัญญา · edit:<id> = แก้ไขสัญญา · null = ปิดหน้าต่าง
type Open = (choice: string) => void;
const HubCtx = createContext<Open | null>(null);
// คลิกโดนสิ่งที่กดได้อยู่แล้วในการ์ด (ลิงก์ / ปุ่ม / ช่องกรอก) → ไม่เปิดหน้าต่างแก้ไข (เหมือนกดแถวตาราง · RowPanel)
const INTERACTIVE = "a,button,input,select,textarea,label,form,summary,details,[data-no-row-click]";
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * ปุ่มเดียวของกล่องสัญญาเช่า (ตกลง 6 พ.ย. 2026): สัญญาใหม่ / ต่อสัญญา / แก้ไขสัญญา ในหน้าต่างเดียว
 *   บนสุด = ช่อง "ทำอะไร" → ฟอร์มด้านล่างเปลี่ยนตาม · กดที่การ์ดสัญญา = เปิดหน้าต่างนี้ที่ "แก้ไขสัญญา" ของสัญญานั้น
 *   ไม่มีสิทธิ์เขียน (enabled = false) → ไม่มีปุ่ม การ์ดกดไม่ได้
 */
export function LeaseHub({ enabled, children, assetId, banks, goLive, currency, carryOptions, detail, renewals, edits }: {
  enabled: boolean; children: ReactNode;
  assetId: string; banks: Bank[]; goLive: string; currency: string; carryOptions: CarryOption[];
  detail: { opt: LeaseDetailOptions; canSensitive: boolean };
  /** สัญญาที่ต่อได้ (ยังไม่มีสัญญาถัดไปของห้องเดียวกัน · ยังไม่บันทึกผู้เช่าออก) */ renewals: LeasePrefill[];
  edits: LeaseEditEntry[];
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [mode, id] = choice?.includes(":") ? choice.split(":") : ["new", ""];
  const renewal = mode === "renew" ? renewals.find((r) => r.id === id) : undefined;
  const edit = mode === "edit" ? edits.find((e) => e.id === id) : undefined;
  const cur = edits.filter((e) => !e.old), old = edits.filter((e) => e.old);
  const title = edit ? "แก้ไขสัญญาเช่า" : renewal ? "ต่อสัญญา" : "สัญญาเช่าใหม่";
  return (
    <HubCtx.Provider value={enabled ? setChoice : null}>
      {children}
      {choice !== null && (
        <Modal size="lg" title={title} onClose={() => setChoice(null)}>
          <div className="space-y-4">
            {(renewals.length > 0 || edits.length > 0) && (
              <label className="block text-sm">ทำอะไร
                <select value={edit || renewal ? choice : ""} onChange={(e) => setChoice(e.target.value)} className={`mt-1 block w-full max-w-2xl ${input}`}>
                  <option value="">สัญญาใหม่ (กรอกเอง)</option>
                  {renewals.length > 0 && (
                    <optgroup label="ต่อสัญญา (ดึงข้อมูลสัญญาเดิมมาให้ แก้ได้)">
                      {renewals.map((r) => <option key={r.id} value={`renew:${r.id}`}>ต่อสัญญา · {r.label}</option>)}
                    </optgroup>
                  )}
                  {cur.length > 0 && (
                    <optgroup label="แก้ไขสัญญา">
                      {cur.map((e) => <option key={e.id} value={`edit:${e.id}`}>แก้ไข · {e.label}</option>)}
                    </optgroup>
                  )}
                  {old.length > 0 && (
                    <optgroup label="แก้ไขสัญญาเดิมที่จบแล้ว (ADMIN)">
                      {old.map((e) => <option key={e.id} value={`edit:${e.id}`}>แก้ไข · {e.label}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            <div key={choice} className={renewals.length > 0 || edits.length > 0 ? "border-t border-slate-200 pt-4" : undefined}>
              {edit ? (
                <LeaseEditBody assetId={assetId} leaseId={edit.id} m={edit.m} v={edit.v} opt={detail.opt} canSensitive={detail.canSensitive}
                  banks={banks} rentCurrency={edit.rentCurrency} rentTo={edit.rentTo} depositMonths={edit.depositMonths} deleteControl={edit.deleteControl} />
              ) : (
                <NewLeaseBody assetId={assetId} banks={banks} goLive={goLive} currency={currency} carryOptions={carryOptions}
                  renewal={renewal} detail={detail} />
              )}
            </div>
          </div>
        </Modal>
      )}
    </HubCtx.Provider>
  );
}

/** ปุ่ม "+ สัญญาใหม่ / ต่อสัญญา / แก้ไข" บนหัวกล่องสัญญาเช่า */
export function LeaseHubButton({ label }: { label: string }) {
  const open = useContext(HubCtx);
  if (!open) return null;
  return <button type="button" onClick={() => open("")}
    className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">{label}</button>;
}

/** การ์ดสัญญา: กดที่การ์ด (ไม่โดนปุ่ม / ลิงก์) = แก้ไขสัญญานี้ · ไม่มีสิทธิ์เขียน = การ์ดธรรมดา */
export function LeaseCardClick({ leaseId, className, children }: { leaseId: string; className: string; children: ReactNode }) {
  const open = useContext(HubCtx);
  if (!open) return <div className={className}>{children}</div>;
  return (
    <div title="กดเพื่อแก้ไขสัญญา" className={`${className} cursor-pointer hover:bg-slate-50`}
      onClick={(e) => {
        // pop up อื่นที่เปิดจากปุ่มในการ์ด (รายการส่งมอบ / ผู้เช่าออก) อยู่นอกการ์ดใน DOM แต่ event ของ React ยังส่งต่อมาถึงการ์ด → ไม่นับ
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        if (window.getSelection()?.toString()) return;          // กำลังลากเลือกข้อความ
        open(`edit:${leaseId}`);
      }}>
      {children}
    </div>
  );
}
