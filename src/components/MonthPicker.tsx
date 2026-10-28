"use client";

import { usePathname, useRouter } from "next/navigation";
import { useNavPending } from "./HeaderBar";

/** เลือกเดือน: ‹ dropdown › · เปลี่ยนเฉพาะ ?m= และคงพารามิเตอร์อื่น (สมาชิก / แท็บ) · months เรียงใหม่สุดก่อน */
export default function MonthPicker({ months, value }: { months: { value: string; label: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { start } = useNavPending();
  const go = (m: string) => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    q.set("m", m);
    start(() => router.push(`${pathname}?${q}`, { scroll: false }));
  };
  const i = months.findIndex((m) => m.value === value);
  const older = i >= 0 ? months[i + 1]?.value : undefined;
  const newer = i > 0 ? months[i - 1]?.value : undefined;
  const arrow = "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={arrow} disabled={!older} onClick={() => older && go(older)} aria-label="เดือนก่อน" title="เดือนก่อน">‹</button>
      <label className="sr-only" htmlFor="month-picker">เดือน</label>
      <select id="month-picker" value={value} onChange={(e) => go(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <button type="button" className={arrow} disabled={!newer} onClick={() => newer && go(newer)} aria-label="เดือนถัดไป" title="เดือนถัดไป">›</button>
    </div>
  );
}
