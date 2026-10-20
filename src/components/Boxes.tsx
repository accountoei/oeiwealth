import type { ReactNode } from "react";

// กล่องมาตรฐานของทุกหน้า (ใช้ได้ทั้งหน้า server และ client · ไม่มี state)
//   StatBox    = กล่องสรุปตัวเลข: หัวข้อชิดซ้าย · ตัวเลข + บรรทัดใต้ตัวเลขชิดขวา (class num-box ใน globals.css)
//   DetailItem = ช่องในกล่องรายละเอียด (<dl>): หัวข้อบน ค่าล่าง · num = ชิดขวา (ช่องจำนวนเงิน)

/** กล่องสรุปตัวเลข */
export function StatBox({ label, value, unit, sub, subClass, valueClass, flag, size = "xl", children }: {
  label: ReactNode;
  value: ReactNode;
  /** หน่วยตัวเล็กต่อท้ายตัวเลข เช่น "รายการ" */
  unit?: ReactNode;
  /** บรรทัดใต้ตัวเลข */
  sub?: ReactNode;
  /** สีบรรทัดใต้ตัวเลข (ค่าเริ่มต้น เทา) */
  subClass?: string;
  /** สีตัวเลข เช่น text-emerald-700 */
  valueClass?: string;
  /** บรรทัดเตือน (สีส้ม) */
  flag?: ReactNode;
  /** xl = กล่องสรุปด้านบน · 2xl = กล่องมูลค่าในหน้ารายละเอียด */
  size?: "xl" | "2xl";
  /** เนื้อหาเพิ่มท้ายกล่อง (เช่น รายการย่อย <dl>) */
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 ${size === "2xl" ? "text-2xl" : "text-xl"} font-semibold tabular-nums ${valueClass ?? ""}`}>
        {value}{unit != null && <> <span className="text-sm font-normal text-slate-500">{unit}</span></>}
      </div>
      {sub != null && sub !== "" && sub !== false && <div className={`mt-1 text-xs ${subClass ?? "text-slate-500"}`}>{sub}</div>}
      {flag != null && flag !== "" && flag !== false && <div className="mt-1 text-xs font-medium text-amber-700">{flag}</div>}
      {children}
    </div>
  );
}

/** ช่องในกล่องรายละเอียด */
export function DetailItem({ label, children, wide, num, dash }: {
  label: ReactNode;
  children?: ReactNode;
  /** กินเต็มแถว (หมายเหตุ / รายละเอียดยาว) */
  wide?: boolean;
  /** ช่องจำนวนเงิน → ชิดขวา */
  num?: boolean;
  /** ไม่มีค่า → แสดง "-" สีจาง */
  dash?: boolean;
}) {
  const empty = children == null || children === "" || children === false;
  return (
    <div className={[wide ? "sm:col-span-2 lg:col-span-3" : "", num ? "num-item tabular-nums" : ""].filter(Boolean).join(" ") || undefined}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-slate-800">{empty && dash ? <span className="text-slate-400">-</span> : children}</dd>
    </div>
  );
}
