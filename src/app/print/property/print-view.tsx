"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { money, thDate } from "@/lib/format";
import { colorOf, staticMapUrl } from "@/app/(app)/property/map-tiles";
import type { PrintPin } from "./print-map";

// Leaflet ใช้ได้เฉพาะในเบราว์เซอร์
const PrintMap = dynamic(() => import("./print-map"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-md bg-slate-200" /> });

export type PrintPlot = {
  id: string; name: string; typeLabel: string; usage: string; usageLabel: string; status: string; group: string | null; area: string | null;
  place: string | null; address: string | null; unit: string | null; houseNo: string | null; geo: { lat: number; lng: number } | null;
  owners: string[]; acquired: string | null; notes: string | null;
  cost: number | null; value: number | null; valueDate: string | null; currency: string;
  comps: { name: string; kind: string; detail: string; area: string | null }[];
};

/** แถบบน (ไม่ออกในกระดาษ): กลับ · แสดงมูลค่า · พิมพ์ — แล้วตามด้วยหน้า A4: แผนที่รวม (เมื่อมีหลายแปลง) + หน้าละ 1 แปลง */
export default function PropertyPrintView({ plots, title, back, today, missing }: {
  plots: PrintPlot[]; title: string; back: string; today: string; missing: number;
}) {
  const [showValue, setShowValue] = useState(false);
  const head = `ทรัพย์สิน${title ? ` · ${title}` : ""}`;
  const pins = useMemo((): PrintPin[] => plots.filter((p) => p.geo)
    .map((p) => ({ lat: p.geo!.lat, lng: p.geo!.lng, label: `${plots.indexOf(p) + 1}. ${p.name}`, color: colorOf(p.usage) })), [plots]);
  const many = plots.length > 1;
  const noGeo = plots.filter((p) => !p.geo).length;
  const pageHead = (
    <div className="mb-3 flex items-baseline justify-between border-b border-slate-300 pb-1 text-xs text-slate-500">
      <span>{head}</span><span>พิมพ์ {thDate(today)}</span>
    </div>
  );
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href={back} className="text-slate-500 hover:underline">← กลับ</Link>
          <span className="font-medium text-slate-900">{head} · {plots.length} แปลง</span>
          <label className="inline-flex items-center gap-1.5" title="ราคาที่ได้มา และมูลค่าล่าสุด">
            <input type="checkbox" checked={showValue} onChange={(e) => setShowValue(e.target.checked)} />แสดงมูลค่า
          </label>
          <button type="button" onClick={() => window.print()} disabled={plots.length === 0}
            className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">พิมพ์ / บันทึกเป็น PDF</button>
        </div>
        <p className="mx-auto mt-1 max-w-[210mm] text-xs text-slate-500">
          รอให้ภาพแผนที่ขึ้นครบก่อนกดพิมพ์ · เลื่อนหรือซูมแผนที่รวมเพื่อจัดกรอบได้ · หน้าต่างพิมพ์เลือก &ldquo;บันทึกเป็น PDF&rdquo; ได้
          {noGeo > 0 && <span className="text-amber-700"> · ไม่มีพิกัด {noGeo} แปลง (ไม่มีรูปแผนที่)</span>}
          {missing > 0 && <span className="text-amber-700"> · หาไม่พบ {missing} รายการ</span>}
        </p>
      </div>
      <div className="mx-auto max-w-[210mm] space-y-6 py-6 print:space-y-0 print:py-0">
        {plots.length === 0 && <p className="text-center text-sm text-slate-500">ไม่มีทรัพย์สินที่จะพิมพ์</p>}
        {many && (
          <section className="bg-white px-[16mm] py-[14mm] shadow-sm print:p-0 print:shadow-none">
            {pageHead}
            <h1 className="mb-3 text-lg font-semibold text-slate-900">{head} · {plots.length} แปลง</h1>
            {pins.length > 0 && <PrintMap pins={pins} className="h-[110mm] w-full" />}
            <table className="mt-4 w-full text-[12px]">
              <thead className="border-b border-slate-300 text-left text-[11px] text-slate-500">
                <tr><th className="py-1 pr-2">#</th><th className="pr-2">ทรัพย์สิน</th><th className="pr-2">ประเภท / การใช้งาน</th><th className="pr-2">เนื้อที่</th>
                  <th className="pr-2">กลุ่มทำเล</th>{showValue && <th className="text-right">มูลค่าล่าสุด</th>}</tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {plots.map((p, i) => (
                  <tr key={p.id} className="align-top">
                    <td className="py-1 pr-2 tabular-nums">{i + 1}</td>
                    <td className="pr-2 font-medium text-slate-900">{p.name}{!p.geo && <span className="block text-[10px] font-normal text-slate-400">ไม่มีพิกัด</span>}</td>
                    <td className="pr-2">{p.typeLabel} · {p.usageLabel}</td>
                    <td className="pr-2">{p.area ?? "-"}</td>
                    <td className="pr-2">{p.group ?? "-"}</td>
                    {showValue && <td className="text-right tabular-nums">{money(p.value, p.currency !== "THB" ? p.currency : undefined, 0)}</td>}
                  </tr>
                ))}
              </tbody>
              {showValue && (
                <tfoot className="border-t border-slate-300 font-medium">
                  {[...new Set(plots.map((p) => p.currency))].map((cur) => (
                    <tr key={cur}><td colSpan={5} className="py-1 text-right">รวม{cur !== "THB" ? ` (${cur})` : ""}</td>
                      <td className="text-right tabular-nums">{money(plots.filter((p) => p.currency === cur).reduce((t, p) => t + (p.value ?? 0), 0), cur !== "THB" ? cur : undefined, 0)}</td></tr>
                  ))}
                </tfoot>
              )}
            </table>
          </section>
        )}
        {plots.map((p, i) => (
          <section key={p.id} className={`bg-white px-[16mm] py-[14mm] shadow-sm print:p-0 print:shadow-none ${many || i > 0 ? "print:break-before-page" : ""}`}>
            {pageHead}
            <h2 className="text-lg font-semibold text-slate-900">{many && <span className="mr-1 tabular-nums text-slate-400">{i + 1}.</span>}{p.name}</h2>
            <p className="mb-3 text-sm text-slate-600">{[p.typeLabel, p.usageLabel, p.group && `กลุ่มทำเล ${p.group}`].filter(Boolean).join(" · ")}</p>
            {p.geo ? <PlotMap p={p} /> : (
              <div className="flex h-[40mm] items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-400">ยังไม่มีพิกัด (ใส่ที่ &ldquo;แก้ไขข้อมูล&rdquo; ในหน้าทรัพย์สิน)</div>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <Field label="ประเภท / การใช้งาน">{p.typeLabel} · {p.usageLabel}</Field>
              <Field label="เนื้อที่">{p.area ?? "-"}</Field>
              <Field label="กลุ่มทำเล">{p.group ?? "-"}</Field>
              <Field label="ตำบล / อำเภอ / จังหวัด">{p.place ?? "-"}</Field>
              {p.houseNo && <Field label="บ้านเลขที่">{p.houseNo}</Field>}
              {p.unit && <Field label="ห้องชุด">{p.unit}</Field>}
              {p.address && <Field label="ที่อยู่" wide>{p.address}</Field>}
              {p.geo && <Field label="พิกัด"><span className="tabular-nums">{+p.geo.lat.toFixed(6)}, {+p.geo.lng.toFixed(6)}</span></Field>}
              <Field label="สถานะ">{p.status}</Field>
              <Field label="เจ้าของ">{p.owners.length ? p.owners.map((o) => <div key={o}>{o}</div>) : "-"}</Field>
              <Field label="วันที่ได้มา">{p.acquired ? thDate(p.acquired) : "-"}</Field>
              {showValue && <>
                <Field label="ราคาที่ได้มา"><span className="tabular-nums">{money(p.cost, p.currency !== "THB" ? p.currency : undefined, 0)}</span></Field>
                <Field label="มูลค่าล่าสุด"><span className="tabular-nums">{money(p.value, p.currency !== "THB" ? p.currency : undefined, 0)}</span>
                  {p.valueDate && <span className="text-slate-500"> · ณ {thDate(p.valueDate)}</span>}</Field>
              </>}
              {p.notes && <Field label="หมายเหตุ" wide>{p.notes}</Field>}
            </dl>
            {p.comps.length > 0 && (
              <table className="mt-4 w-full text-[12px]">
                <thead className="border-b border-slate-300 text-left text-[11px] text-slate-500">
                  <tr><th className="py-1 pr-2">ส่วนประกอบ</th><th className="pr-2">รายละเอียด</th><th className="text-right">เนื้อที่ / พื้นที่</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {p.comps.map((c, k) => (
                    <tr key={k} className="align-top">
                      <td className="py-1 pr-2">{c.name}<span className="block text-[10px] text-slate-400">{c.kind}</span></td>
                      <td className="pr-2 text-slate-600">{c.detail || "-"}</td>
                      <td className="text-right">{c.area ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

/** รูปแผนที่ของแปลง: มี key → รูปคงที่ของ Esri (ภาพดาวเทียม + ชื่อ + หมุด) · ไม่มี key หรือรูปโหลดไม่ได้ → แผนที่ Leaflet แทน */
function PlotMap({ p }: { p: PrintPlot }) {
  const url = staticMapUrl(p.geo!.lat, p.geo!.lng, colorOf(p.usage));
  const [failed, setFailed] = useState(false);
  const pins = useMemo(() => [{ lat: p.geo!.lat, lng: p.geo!.lng, label: p.name, color: colorOf(p.usage) }], [p]);
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element -- รูปจากบริการแผนที่ภายนอก (ไม่ผ่าน next/image)
    return <img src={url} alt={`แผนที่ ${p.name}`} onError={() => setFailed(true)} className="h-[100mm] w-full rounded-md object-cover" />;
  }
  return <PrintMap pins={pins} className="h-[100mm] w-full" />;
}
