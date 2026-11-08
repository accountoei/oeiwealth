"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { money, signedMoney, thDate } from "@/lib/format";
import { ageAt, policyYearAt } from "@/lib/insurance-flow";
import { InfoTip } from "@/components/HeaderBar";

/** เงินจริงของงวด (จ่ายเบี้ย / รับผลประโยชน์) แสดงแทรกใต้งวดนั้น */
/** CV = มูลค่าเวนคืนที่ลงจริง (แสดงในคอลัมน์มูลค่าเวนคืน) */
export type FlowSub = { key: string; kind: "PAY" | "RECV" | "CV"; date: string; text: string; detail?: string | null; amount: number; actions?: ReactNode;
  /** เล่มที่มีสัญญาเพิ่มเติม: คอลัมน์ของส่วนที่จ่าย (key ของ FlowPart) */ part?: string };
/** เล่มที่มีสัญญาเพิ่มเติม (ตกลง 6 พ.ย. 2026): คอลัมน์เบี้ยต่อส่วน (ชีวิต · สุขภาพ / สัญญาเพิ่มเติม) แล้วตามด้วย "รวมจ่าย" */
export type FlowPart = { key: string; label: string };

/** แถวในตาราง: งวดเบี้ย / งวดผลประโยชน์ / รับเงินก้อนไม่ผูกงวด (lump) / สิ้นปีกรมธรรม์ที่มีแต่มูลค่าเวนคืน (CV) */
export type FlowRow = {
  /** label = ข้อความในช่องหมายเหตุ (ชนิดผลประโยชน์ ฯลฯ · ว่างได้) · notes = หมายเหตุของงวด (บรรทัดเล็กใต้ label) */
  key: string; kind: "PREMIUM" | "BENEFIT" | "CV"; date: string; label: string; notes?: string | null;
  amount: number; statusText?: string; statusCls?: string; progress?: string | null;
  /** จ่าย / รับครบแล้ว หรือไม่ต้องจ่าย → ตัวจาง */
  muted?: boolean;
  /** งวดแรกที่ยังค้าง → เลื่อนตารางมาที่แถวนี้ตอนเปิด */
  next?: boolean;
  /** สุทธิสะสม (ผลประโยชน์ − เบี้ย) ถึงแถวนี้ · projected = คาดการณ์ตามตาราง */
  net?: number | null; projected?: boolean; breakEven?: boolean;
  /** เวนคืนคุ้มทุน: ปีแรกที่มูลค่าเวนคืนตามสัญญา ≥ เบี้ยสุทธิที่จ่ายไปก่อนวันนั้น (ตกลง 8 พ.ย. 2026) · projected = ยังไม่ถึงวันนั้น */
  breakEvenCv?: { projected: boolean } | null;
  /** งวดที่ของเบี้ย (สัญญาหลัก · ไม่มี = ของส่วนแรกในวันนั้น) · แถวผลประโยชน์ / มูลค่าเวนคืน = ว่าง */
  no?: number | null;
  /** รับเงินก้อนไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) = เงินจริงทั้งแถว */
  lump?: { text: string; detail?: string | null };
  actions?: ReactNode;
  cash?: FlowSub[];
  /** เล่มที่มีสัญญาเพิ่มเติม: ยอดเบี้ยของแต่ละส่วน (กดเพื่อแก้งวดของส่วนนั้น) · amount = รวมจ่าย */
  split?: Record<string, ReactNode>;
  /** มูลค่าเวนคืนตามสัญญา ณ สิ้นปีกรมธรรม์ที่ตรงกับวันของแถว (ตกลง 8 พ.ย. 2026) */
  cv?: ReactNode;
};

/**
 * ตารางเบี้ยและผลประโยชน์ของกรมธรรม์ (ตกลง 4 พ.ย. 2026 · แทนแท็บรับผลประโยชน์ + ชำระเบี้ย)
 *   ตัวกรอง ทั้งหมด / เบี้ย / ผลประโยชน์ · สุทธิสะสมแสดงเฉพาะ "ทั้งหมด" · เปิดหน้าแล้วตาราง (เลื่อนในกล่อง) ไปงวดแรกที่ค้าง
 *   คอลัมน์แรก = ปีที่ (ปีกรมธรรม์ที่ครบรอบแล้ว · วันเริ่มสัญญา = 0) แทนป้ายเบี้ย / ผลประโยชน์ / เวนคืน · ข้อความของแถวอยู่ในช่องหมายเหตุท้ายตาราง (ตกลง 8 พ.ย. 2026)
 *   ตามด้วย อายุ (ผู้เอาประกัน · มีวันเกิดเท่านั้น) · งวดที่ · วันที่ครบกำหนด · แถวย่อย: ป้ายคร่อม 3 ช่องแรก ข้อความใช้ช่องว่างตั้งแต่สุทธิสะสมถึงหมายเหตุ
 */
export default function FlowTable({ rows, showNet, currency, parts, showCv, startDate, birthDate }: {
  rows: FlowRow[]; showNet: boolean; currency: string; parts?: FlowPart[];
  /** วันเริ่มสัญญา → ปีที่ของแต่ละแถว */ startDate?: string | null;
  /** วันเกิดผู้เอาประกัน → คอลัมน์อายุ (ไม่มี = ไม่แสดงคอลัมน์) */ birthDate?: string | null;
  /** คอลัมน์มูลค่าเวนคืน (ตามสัญญา + ยอดที่ลงจริงเป็นแถวย่อย · แทนแท็บมูลค่าเวนคืน · ตกลง 8 พ.ย. 2026) */ showCv?: boolean;
}) {
  const nPrem = rows.filter((r) => r.kind === "PREMIUM").length;
  const nBen = rows.filter((r) => r.kind === "BENEFIT").length;
  const hasCv = (r: FlowRow) => r.cv != null || (r.cash ?? []).some((c) => c.kind === "CV");
  const nCv = showCv ? rows.filter(hasCv).length : 0;
  const [f, setF] = useState<"all" | "PREMIUM" | "BENEFIT" | "CV">("all");
  const shown = f === "all" ? rows : f === "CV" ? rows.filter(hasCv) : rows.filter((r) => r.kind === f);
  const net = showNet && f === "all";
  // แถวย่อย: กรองมูลค่าเวนคืน = เฉพาะยอดที่ลงแล้ว · กรองเบี้ย / ผลประโยชน์ = ไม่แสดงยอดมูลค่าเวนคืน
  const subsOf = (r: FlowRow) => (r.cash ?? []).filter((c) => f === "all" || (f === "CV") === (c.kind === "CV"));
  const nParts = parts?.length ?? 0;
  const showAge = !!birthDate;
  const lead = showAge ? 3 : 2;
  const cols = (net ? 9 : 8) + (showAge ? 1 : 0) + nParts + (showCv ? 1 : 0);
  // กว้างขั้นต่ำ (px ตาม colgroup + หมายเหตุ 3rem): เล่ม 2 ส่วน + มูลค่าเวนคืน = 64rem พอดี iPad แนวนอน
  const minW = (showAge ? 36 : 0) + 48 + 44 + 104 + (parts ? 88 * (nParts + 1) : 96) + 96 + (net ? 104 : 0) + (showCv ? 96 : 0) + 96 + 88 + 48;
  // ช่องสถานะ: มีคอลัมน์มูลค่าเวนคืน = ชิดซ้ายขึ้น (ตารางแคบลง)
  const sPad = showCv ? "pl-2" : "pl-4";
  // คอลัมน์เบี้ย: ปกติ = "จ่ายเบี้ย" ช่องเดียว · เล่มที่มีสัญญาเพิ่มเติม = ทีละส่วน + "รวมจ่าย"
  const premCells = (r: FlowRow) => parts
    ? <>{parts.map((p) => <td key={p.key} className="py-2 text-right tabular-nums">{r.kind === "PREMIUM" ? r.split?.[p.key] ?? "" : ""}</td>)}
        <td className="py-2 text-right font-medium tabular-nums">{r.kind === "PREMIUM" ? money(r.amount) : ""}</td></>
    : <td className="py-2 text-right tabular-nums">{r.kind === "PREMIUM" ? money(r.amount) : ""}</td>;
  const blankPrem = parts ? <>{parts.map((p) => <td key={p.key} />)}<td /></> : <td />;
  const subPrem = (c: FlowSub) => {
    const v = c.kind === "PAY" ? money(c.amount) : "";
    if (!parts) return <td className="py-1.5 text-right text-sm tabular-nums text-slate-700">{v}</td>;
    const col = parts.some((p) => p.key === c.part) ? c.part : parts[0].key;
    return <>{parts.map((p) => <td key={p.key} className="py-1.5 text-right text-sm tabular-nums text-slate-700">{p.key === col ? v : ""}</td>)}<td /></>;
  };
  const box = useRef<HTMLDivElement>(null);
  // ตารางยังไม่มีขนาดตอนโหลด (ขนาด 0) → รอจนแสดงจริงแล้วค่อยเลื่อนในกล่องครั้งเดียว (ไม่เลื่อนทั้งหน้า)
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let done = false;
    const ro = new ResizeObserver(() => {
      if (done || el.clientHeight === 0) return;
      done = true;
      const row = el.querySelector<HTMLElement>("[data-next]");
      if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - 96;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const tag = (kind: string, text: string) => (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${kind === "PREMIUM" || kind === "PAY" ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>{text}</span>
  );
  const cvTag = (text: string) => <span className="whitespace-nowrap rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">{text}</span>;
  // ปีที่ · อายุ · งวดที่
  const leadCells = (r: FlowRow) => <>
    <td className="py-2 pl-1 tabular-nums">{policyYearAt(startDate, r.date) ?? ""}</td>
    {showAge && <td className="py-2 tabular-nums">{ageAt(birthDate, r.date) ?? ""}</td>}
    <td className="py-2 tabular-nums">{r.no ?? ""}</td>
  </>;
  const beTag = (text: string, cls: string) => <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white ${cls}`}>{text}</span>;
  const noteCell = (main: ReactNode, sub?: string | null) => (
    <td className="py-2 pl-2">{main}{sub && <div className={`text-xs ${main ? "text-slate-400" : "text-slate-500"}`}>{sub}</div>}</td>
  );
  const cvCell = (r: FlowRow) => showCv && <td className="py-2 text-right tabular-nums">{r.cv}</td>;
  const netCell = (r: FlowRow) => (
    <td className={`py-2 text-right tabular-nums ${r.net == null ? "" : r.projected ? "text-slate-400" : r.net >= -0.005 ? "text-emerald-700" : "text-red-700"}`}>
      {r.net == null ? "" : signedMoney(r.net)}
    </td>
  );
  return (
    <div className="space-y-3">
      {[nPrem, nBen, nCv].filter((x) => x > 0).length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setF("all")} className={chip(f === "all")}>ทั้งหมด ({rows.length})</button>
          {nPrem > 0 && <button type="button" onClick={() => setF("PREMIUM")} className={chip(f === "PREMIUM")}>เบี้ย ({nPrem})</button>}
          {nBen > 0 && <button type="button" onClick={() => setF("BENEFIT")} className={chip(f === "BENEFIT")}>ผลประโยชน์ ({nBen})</button>}
          {nCv > 0 && <button type="button" onClick={() => setF("CV")} className={chip(f === "CV")}>มูลค่าเวนคืน ({nCv})</button>}
        </div>
      )}
      <div ref={box} className="max-h-[40rem] overflow-auto">
        {/* ช่องหมายเหตุรับพื้นที่ที่เหลือ (ขึ้นบรรทัดใหม่ได้) · ช่องอื่นกว้างคงที่ ให้เล่ม 2 ส่วน + มูลค่าเวนคืนพอดี iPad แนวนอน (64rem) */}
        <table style={{ minWidth: `${minW / 16}rem` }} className="w-full table-fixed text-sm [&_.text-right]:whitespace-nowrap [&_.text-right]:pl-2">
          <colgroup>
            <col className="w-12" />{showAge && <col className="w-9" />}<col className="w-11" /><col className="w-26" />
            {parts ? <>{parts.map((p) => <col key={p.key} className="w-22" />)}<col className="w-22" /></> : <col className="w-24" />}
            <col className="w-24" />{net && <col className="w-26" />}{showCv && <col className="w-24" />}
            <col className="w-24" /><col /><col className="w-22" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="whitespace-nowrap py-1.5 pl-1">ปีที่ <InfoTip label="คำอธิบาย">ปีที่ = ปีกรมธรรม์ที่ครบรอบแล้ว (วันเริ่มสัญญา = ปีที่ 0 จ่ายเบี้ยงวดที่ 1 · ครบรอบปีที่ N = สิ้นปีกรมธรรม์ที่ N ตามตารางในเล่ม และจ่ายเบี้ยงวดที่ N + 1) ·
        {showAge && " อายุ = อายุเต็มปีของผู้เอาประกัน ณ วันที่ของแถว (ตามวันเกิดในหน้า Family · ในเล่มอาจนับต่างไป 1 ปี) ·"} งวดที่ = งวดเบี้ยของสัญญาหลัก ·
        แถวสีเทาอ่อน = เบี้ยที่จ่ายจริง · แถวสีเขียว = เงินที่รับจริง{net && " · สุทธิสะสมตัวจาง = คาดการณ์ตามตาราง (งวดที่ยังไม่ถึง)"}
        {showCv && " · เวนคืนคุ้มทุน = ปีแรกที่มูลค่าเวนคืนตามสัญญา ≥ เบี้ยสุทธิที่จ่ายไปก่อนวันนั้น (ไม่นับเบี้ยงวดที่ครบวันเดียวกัน เพราะถ้าเวนคืนก็ไม่ต้องจ่ายงวดนั้น) · คุ้มทุน = ผลประโยชน์ที่รับรวม ≥ เบี้ยรวม โดยไม่เวนคืน"}
        {showCv && " · มูลค่าเวนคืน = ตามสัญญา ณ สิ้นปีกรมธรรม์: ตัวจาง = ยังไม่ถึง · ขีดเส้นใต้ = ถึงแล้วยังไม่ได้ลง (กดเพื่อลงยอดของปีนั้น) · สีฟ้า = ลงแล้ว (กดเพื่อแก้ยอด เช่น รวมเงินปันผลตามหนังสือแจ้ง) · ยอดที่ลงไม่ตรงกับตาราง = แถวย่อยสีฟ้า (กดแถวเพื่อแก้ / ลบ)"} ·
        แก้ / ลบการจ่ายที่แถวนั้น (ลบแล้วงวดกลับเป็น &ldquo;รอ&rdquo;) · ยกเลิกการรับได้จากรายการล่าสุดก่อน · งวดที่ปิดแล้วต้อง Reopen ก่อน</InfoTip></th>
              {showAge && <th title="อายุเต็มปีของผู้เอาประกัน ณ วันที่ของแถว (ตามวันเกิดในหน้า Family)">อายุ</th>}
              <th className="whitespace-nowrap" title="งวดเบี้ยของสัญญาหลัก">งวดที่</th><th className="whitespace-nowrap">วันที่ครบกำหนด</th>
              {parts ? <>{parts.map((p) => <th key={p.key} className="text-right" title={`เบี้ย${p.label}`}>{p.label}</th>)}<th className="text-right" title="เบี้ยรวมทั้งเล่มของงวดนั้น">รวมจ่าย</th></>
                : <th className="text-right">จ่ายเบี้ย</th>}
              <th className="text-right">รับผลประโยชน์</th>
              {net && <th className="text-right" title="ผลประโยชน์ − เบี้ย นับรวมตั้งแต่งวดแรกถึงแถวนั้น · ตัวจาง = คาดการณ์ตามตาราง">สุทธิสะสม</th>}
              {showCv && <th className="text-right" title="ตามสัญญา ณ สิ้นปีกรมธรรม์ · ตัวจาง = ยังไม่ถึง · ขีดเส้นใต้ = ถึงแล้วยังไม่ได้ลง · สีฟ้า = ลงแล้ว · แถวย่อยสีฟ้า = ยอดที่ลงไม่ตรงกับตาราง">มูลค่าเวนคืน</th>}
              <th className={sPad}>สถานะ</th><th className="pl-2">หมายเหตุ</th><th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">ไม่มีรายการ</td></tr>}
            {shown.map((r) => r.lump ? (
              <tr key={r.key} className="align-top bg-emerald-50/40">
                {leadCells(r)}
                <td className="whitespace-nowrap py-2">{thDate(r.date)}</td>
                {blankPrem}
                <td className="py-2 text-right tabular-nums text-emerald-700">{money(r.amount, currency)}</td>
                {net && netCell(r)}
                {cvCell(r)}
                <td className={`py-2 ${sPad}`}>{r.breakEven && beTag("คุ้มทุน", "bg-emerald-600")}</td>
                {noteCell(r.lump.text, r.lump.detail)}
                <td className="py-2 pl-2 text-right">{r.actions}</td>
              </tr>
            ) : (
              <Fragment key={r.key}>
                <tr data-next={r.next ? "" : undefined} className={`align-top ${r.muted ? "text-slate-500" : ""}`}>
                  {leadCells(r)}
                  <td className="whitespace-nowrap py-2">{thDate(r.date)}</td>
                  {premCells(r)}
                  <td className="py-2 text-right tabular-nums">{r.kind === "BENEFIT" ? money(r.amount) : ""}</td>
                  {net && netCell(r)}
                  {cvCell(r)}
                  <td className={`py-2 ${sPad}`}>
                    <div className="flex flex-wrap gap-1">
                      {r.statusText && <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${r.statusCls ?? ""}`}>{r.statusText}</span>}
                      {r.breakEvenCv && beTag("เวนคืนคุ้มทุน", "bg-sky-600")}
                      {r.breakEven && beTag("คุ้มทุน", "bg-emerald-600")}
                      {((r.breakEven && r.projected) || r.breakEvenCv?.projected) && <span className="text-[11px] text-slate-500">คาดการณ์</span>}
                    </div>
                    {r.progress && <div className="text-xs text-slate-500">{r.progress}</div>}
                  </td>
                  {noteCell(r.label, r.notes)}
                  <td className="py-2 pl-2 text-right">{r.actions}</td>
                </tr>
                {subsOf(r).map((c) => (
                  <tr key={c.key} className={`align-top text-xs ${c.kind === "RECV" ? "bg-emerald-50/40" : c.kind === "CV" ? "bg-sky-50/50" : "bg-slate-50/70"}`}>
                    <td colSpan={lead} className="py-1.5 pl-3">{c.kind === "CV" ? cvTag("ลงแล้ว") : tag(c.kind, c.kind === "PAY" ? "จ่าย" : "รับ")}</td>
                    <td className="whitespace-nowrap py-1.5 text-sm text-slate-700">{thDate(c.date)}</td>
                    {c.kind === "CV" ? blankPrem : subPrem(c)}
                    <td className="py-1.5 text-right text-sm tabular-nums text-emerald-700">{c.kind === "RECV" ? money(c.amount) : ""}</td>
                    {/* ข้อความแถวย่อย (จ่ายจาก… / รับเข้า…) ใช้ช่องว่างตั้งแต่สุทธิสะสมถึงหมายเหตุ · มูลค่าเวนคืนที่ลง = ยอดอยู่ในคอลัมน์ของมัน */}
                    {c.kind === "CV" && <>{net && <td />}<td className="py-1.5 text-right text-sm tabular-nums text-sky-800">{money(c.amount)}</td></>}
                    <td colSpan={2 + (c.kind === "CV" ? 0 : (net ? 1 : 0) + (showCv ? 1 : 0))} className="py-1.5 pl-2 text-slate-600">
                      {c.text}{c.detail && <div className="text-slate-400">{c.detail}</div>}</td>
                    <td className="py-1.5 pl-2 text-right">{c.actions}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
