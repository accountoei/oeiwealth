"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { money, signedMoney, thDate } from "@/lib/format";
import { ageAt, policyYearAt } from "@/lib/insurance-flow";
import { InfoTip } from "@/components/HeaderBar";

/** แถวย่อย: มูลค่าเวนคืนที่ลงจริงแต่ไม่ตรงกับตาราง (แสดงในคอลัมน์มูลค่าเวนคืน · กดแถวเพื่อแก้ / ลบ) */
export type FlowSub = { key: string; kind: "CV"; date: string; text: string; detail?: string | null; amount: number; actions?: ReactNode };
/** เล่มที่มีสัญญาเพิ่มเติม (ตกลง 6 พ.ย. 2026): คอลัมน์เบี้ยต่อส่วน (ชีวิต · สุขภาพ / สัญญาเพิ่มเติม) แล้วตามด้วย "รวมจ่าย" */
export type FlowPart = { key: string; label: string };

/** แถวในตาราง: งวดเบี้ย / งวดผลประโยชน์ / เงินที่จ่าย / รับจริง (money) / สิ้นปีกรมธรรม์ที่มีแต่มูลค่าเวนคืน (CV) */
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
  /** งวดที่ของเบี้ย (สัญญาหลัก · ไม่มี = ของส่วนแรกในวันนั้น) · แถวจ่ายจริง = งวดที่จ่าย (เช่น "3–4") · แถวผลประโยชน์ / มูลค่าเวนคืน = ว่าง */
  no?: number | string | null;
  /** เงินที่จ่าย / รับจริง (ตกลง 8 พ.ย. 2026 · แบบเงินกู้): วางตามวันที่จ่าย / รับจริง · ยอดอยู่ในคอลัมน์จ่ายเบี้ย / รับผลประโยชน์
   *  text = จ่ายจาก / เข้าบัญชี · detail = งวดที่จ่าย / รับ + หมายเหตุ · แก้ / ลบได้เฉพาะรายการล่าสุดของแต่ละฝั่ง (กดแถว) */
  money?: { kind: "PAY" | "RECV"; text: ReactNode; detail?: ReactNode };
  actions?: ReactNode;
  cash?: FlowSub[];
  /** เล่มที่มีสัญญาเพิ่มเติม: ยอดเบี้ยของแต่ละส่วน (กดเพื่อแก้งวดของส่วนนั้น) · amount = รวมจ่าย */
  split?: Record<string, ReactNode>;
  /** มูลค่าเวนคืนตามสัญญา ณ สิ้นปีกรมธรรม์ที่ตรงกับวันของแถว (ตกลง 8 พ.ย. 2026) */
  cv?: ReactNode;
  /** ยอดที่แสดงแทน money(amount) เช่น กดเพื่อแก้งวด (แถวที่รวมเบี้ยกับผลประโยชน์ = กดยอด ไม่ใช่กดแถว) */
  amt?: ReactNode;
  /** ผลประโยชน์ที่ครบวันเดียวกับงวดเบี้ย = แถวเดียวกัน (ตกลง 8 พ.ย. 2026): ยอดในช่องรับผลประโยชน์ + ป้ายสถานะที่ 2 */
  also?: { amount: ReactNode; statusText?: string; statusCls?: string; progress?: string | null };
};

/**
 * ตารางเบี้ยและผลประโยชน์ของกรมธรรม์ (ตกลง 4 พ.ย. 2026 · แทนแท็บรับผลประโยชน์ + ชำระเบี้ย)
 *   ตัวกรอง ทั้งหมด / เบี้ย / ผลประโยชน์ · สุทธิสะสมแสดงเฉพาะ "ทั้งหมด" · เปิดหน้าแล้วตาราง (เลื่อนในกล่อง) ไปงวดแรกที่ค้าง
 *   คอลัมน์แรก = ปีที่ (ปีกรมธรรม์ที่ครบรอบแล้ว · วันเริ่มสัญญา = 0) แทนป้ายเบี้ย / ผลประโยชน์ / เวนคืน · ข้อความของแถวอยู่ในช่องหมายเหตุท้ายตาราง (ตกลง 8 พ.ย. 2026)
 *   ตามด้วย อายุ (ผู้เอาประกัน · มีวันเกิดเท่านั้น) · งวดที่ · วันที่ครบกำหนด · แถวย่อย: ป้ายคร่อม 3 ช่องแรก ข้อความใช้ช่องว่างตั้งแต่สุทธิสะสมถึงท้ายตาราง
 *   เบี้ยกับผลประโยชน์ที่ครบวันเดียวกัน = แถวเดียว (ป้ายสถานะ 2 อัน · ตกลง 8 พ.ย. 2026)
 *   เงินที่จ่าย / รับจริง = แถวของตัวเอง วางตามวันที่จ่าย / รับจริง (แบบเงินกู้ · ตกลง 8 พ.ย. 2026) · รับก่อนครบกำหนด = อยู่ปีที่รับ
 */
export default function FlowTable({ rows, showNet, parts, showCv, startDate, birthDate }: {
  rows: FlowRow[]; showNet: boolean; parts?: FlowPart[];
  /** วันเริ่มสัญญา → ปีที่ของแต่ละแถว */ startDate?: string | null;
  /** วันเกิดผู้เอาประกัน → คอลัมน์อายุ (ไม่มี = ไม่แสดงคอลัมน์) */ birthDate?: string | null;
  /** คอลัมน์มูลค่าเวนคืน (ตามสัญญา + ยอดที่ลงจริงเป็นแถวย่อย · แทนแท็บมูลค่าเวนคืน · ตกลง 8 พ.ย. 2026) */ showCv?: boolean;
}) {
  const nPrem = rows.filter((r) => r.kind === "PREMIUM").length;
  const isBen = (r: FlowRow) => r.kind === "BENEFIT" || !!r.also;
  const nBen = rows.filter(isBen).length;
  const hasCv = (r: FlowRow) => r.cv != null || (r.cash ?? []).length > 0;
  const nCv = showCv ? rows.filter(hasCv).length : 0;
  const [f, setF] = useState<"all" | "PREMIUM" | "BENEFIT" | "CV">("all");
  const shown = f === "all" ? rows : f === "CV" ? rows.filter(hasCv) : f === "BENEFIT" ? rows.filter(isBen) : rows.filter((r) => r.kind === f);
  const net = showNet && f === "all";
  // แถวย่อย (มูลค่าเวนคืนที่ลงแล้ว): กรองเบี้ย / ผลประโยชน์ = ไม่แสดง
  const subsOf = (r: FlowRow) => (f === "all" || f === "CV" ? r.cash ?? [] : []);
  const showAge = !!birthDate;
  const lead = showAge ? 3 : 2;
  // ความกว้างคอลัมน์ (px · ตกลง 8 พ.ย. 2026): ทุกช่องกว้างคงที่ = กว้างขั้นต่ำ · จอกว้างกว่านี้ ส่วนที่เหลือแบ่งให้ทุกช่องตามสัดส่วน
  //   (เดิมช่องหมายเหตุรับไปทั้งหมด ด้านขวาเลยโล่ง) · ปุ่มของแถวอยู่ในช่องหมายเหตุ (ชิดขวา) · ช่องสุดท้ายแคบ = เครื่องหมาย › ของแถวที่กดแก้ได้
  //   เล่ม 2 ส่วน + อายุ + สุทธิสะสม + มูลค่าเวนคืน รวม 1,024 px พอดี iPad แนวนอน
  const widths = [44, ...(showAge ? [36] : []), 44, 96, ...(parts ? [...parts.map(() => 84), 84] : [92]), 92, ...(net ? [100] : []), ...(showCv ? [92] : []), 120, 132, 16];
  const cols = widths.length;
  const minW = widths.reduce((a, b) => a + b, 0);
  // ช่องสถานะ: มีคอลัมน์มูลค่าเวนคืน = ชิดซ้ายขึ้น (ตารางแคบลง)
  const sPad = showCv ? "pl-2" : "pl-4";
  // คอลัมน์เบี้ย: ปกติ = "จ่ายเบี้ย" ช่องเดียว · เล่มที่มีสัญญาเพิ่มเติม = ทีละส่วน + "รวมจ่าย"
  const premCells = (r: FlowRow) => parts
    ? <>{parts.map((p) => <td key={p.key} className="py-2 text-right tabular-nums">{r.kind === "PREMIUM" ? r.split?.[p.key] ?? "" : ""}</td>)}
        <td className="py-2 text-right font-medium tabular-nums">{r.kind === "PREMIUM" ? money(r.amount) : ""}</td></>
    : <td className="py-2 text-right tabular-nums">{r.kind === "PREMIUM" ? r.amt ?? money(r.amount) : ""}</td>;
  const blankPrem = parts ? <>{parts.map((p) => <td key={p.key} />)}<td /></> : <td />;
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
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${kind === "PAY" ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}>{text}</span>
  );
  const cvTag = (text: string) => <span className="whitespace-nowrap rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">{text}</span>;
  // ปีที่ · อายุ · งวดที่
  const leadCells = (r: FlowRow) => <>
    <td className="py-2 pl-1 tabular-nums">{policyYearAt(startDate, r.date) ?? ""}</td>
    {showAge && <td className="py-2 tabular-nums">{ageAt(birthDate, r.date) ?? ""}</td>}
    <td className="py-2 tabular-nums">{r.no ?? ""}</td>
  </>;
  const beTag = (text: string, cls: string) => <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white ${cls}`}>{text}</span>;
  const stTag = (text: string, cls?: string) => <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${cls ?? ""}`}>{text}</span>;
  // ข้อความในช่องหมายเหตุ + ปุ่มของแถว (ชิดขวา · ข้อความยาว = ปุ่มลงบรรทัดถัดไป · ปุ่มไม่ล้นจนตารางเลื่อนข้าง)
  const withActs = (body: ReactNode, acts?: ReactNode) => acts
    ? <div className="flex flex-wrap items-start gap-x-2 gap-y-1"><div>{body}</div><div className="ml-auto flex flex-col items-end gap-1">{acts}</div></div> : body;
  const noteCell = (main: ReactNode, sub?: string | null, acts?: ReactNode) => (
    <td className="py-2 pl-2">{withActs(<>{main}{sub && <div className={`text-xs ${main ? "text-slate-400" : "text-slate-500"}`}>{sub}</div>}</>, acts)}</td>
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
        <table style={{ minWidth: `${minW / 16}rem` }} className="w-full table-fixed text-sm [&_.text-right]:whitespace-nowrap [&_.text-right]:pl-2">
          <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w / 16}rem` }} />)}</colgroup>
          <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="whitespace-nowrap py-1.5 pl-1">ปีที่ <InfoTip label="คำอธิบาย">ปีที่ = ปีกรมธรรม์ที่ครบรอบแล้ว (วันเริ่มสัญญา = ปีที่ 0 จ่ายเบี้ยงวดที่ 1 · ครบรอบปีที่ N = สิ้นปีกรมธรรม์ที่ N ตามตารางในเล่ม และจ่ายเบี้ยงวดที่ N + 1) ·
        {showAge && " อายุ = อายุเต็มปีของผู้เอาประกัน ณ วันที่ของแถว (ตามวันเกิดในหน้า Family · ในเล่มอาจนับต่างไป 1 ปี) ·"} งวดที่ = งวดเบี้ยของสัญญาหลัก ·
        เบี้ยกับผลประโยชน์ที่ครบวันเดียวกัน = แถวเดียว (กดยอดเพื่อแก้งวดนั้น) · แถวสีเทา (จ่าย) / สีเขียว (รับ) = เงินที่จ่าย / รับจริง อยู่ตามวันที่จ่าย / รับจริง (รับก่อนครบกำหนด = อยู่ปีที่รับ · บรรทัดเล็กบอกงวดที่จ่าย / รับ)
        {net && " · สุทธิสะสม = เงินจริง ณ วันที่จ่าย / รับ + งวดที่ยังค้างตามตาราง (ตัวจาง = คาดการณ์)"}
        {showCv && " · เวนคืนคุ้มทุน = ปีแรกที่มูลค่าเวนคืนตามสัญญา ≥ เบี้ยสุทธิที่จ่ายไปก่อนวันนั้น (ไม่นับเบี้ยงวดที่ครบวันเดียวกัน เพราะถ้าเวนคืนก็ไม่ต้องจ่ายงวดนั้น) · คุ้มทุน = ผลประโยชน์ที่รับรวม ≥ เบี้ยรวม โดยไม่เวนคืน"}
        {showCv && " · มูลค่าเวนคืน = ตามสัญญา ณ สิ้นปีกรมธรรม์: ตัวจาง = ยังไม่ถึง · ขีดเส้นใต้ = ถึงแล้วยังไม่ได้ลง (กดเพื่อลงยอดของปีนั้น) · สีฟ้า = ลงแล้ว (กดเพื่อแก้ยอด เช่น รวมเงินปันผลตามหนังสือแจ้ง) · ยอดที่ลงไม่ตรงกับตาราง = แถวย่อยสีฟ้า (กดแถวเพื่อแก้ / ลบ)"} ·
        บันทึกจ่าย / รับ กดปุ่มเหนือตาราง · แก้ / ลบเงินจริงได้เฉพาะรายการล่าสุดของแต่ละฝั่ง (กดที่แถว) — รายการเก่าผิด ให้ลบย้อนจากรายการล่าสุดลงมา (ลบแล้วงวดกลับเป็น &ldquo;รอ&rdquo;) ·
        แก้งวด (วันครบกำหนด / ยอด) กดแถวงวด · งวดที่ปิดแล้วต้อง Reopen ก่อน</InfoTip></th>
              {showAge && <th title="อายุเต็มปีของผู้เอาประกัน ณ วันที่ของแถว (ตามวันเกิดในหน้า Family)">อายุ</th>}
              <th className="whitespace-nowrap" title="งวดเบี้ยของสัญญาหลัก">งวดที่</th><th className="whitespace-nowrap">วันที่ครบกำหนด</th>
              {parts ? <>{parts.map((p) => <th key={p.key} className="text-right" title={`เบี้ย${p.label}`}>{p.label}</th>)}<th className="text-right" title="เบี้ยรวมทั้งเล่มของงวดนั้น">รวมจ่าย</th></>
                : <th className="text-right">จ่ายเบี้ย</th>}
              <th className="text-right">รับผลประโยชน์</th>
              {net && <th className="text-right" title="ผลประโยชน์ − เบี้ย นับรวมตั้งแต่งวดแรกถึงแถวนั้น · ตัวจาง = คาดการณ์ตามตาราง">สุทธิสะสม</th>}
              {showCv && <th className="text-right" title="ตามสัญญา ณ สิ้นปีกรมธรรม์ · ตัวจาง = ยังไม่ถึง · ขีดเส้นใต้ = ถึงแล้วยังไม่ได้ลง · สีฟ้า = ลงแล้ว · แถวย่อยสีฟ้า = ยอดที่ลงไม่ตรงกับตาราง">มูลค่าเวนคืน</th>}
              <th className={sPad}>สถานะ</th><th className="pl-2">หมายเหตุ</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">ไม่มีรายการ</td></tr>}
            {shown.map((r) => (
              <Fragment key={r.key}>
                <tr data-next={r.next ? "" : undefined}
                  className={`align-top ${r.money ? (r.money.kind === "PAY" ? "bg-slate-50/70" : "bg-emerald-50/40") : r.muted ? "text-slate-500" : ""}`}>
                  {leadCells(r)}
                  <td className="whitespace-nowrap py-2">{thDate(r.date)}</td>
                  {premCells(r)}
                  <td className={`py-2 text-right tabular-nums ${r.money?.kind === "RECV" ? "text-emerald-700" : ""}`}>{r.kind === "BENEFIT" ? r.amt ?? money(r.amount) : r.also?.amount ?? ""}</td>
                  {net && netCell(r)}
                  {cvCell(r)}
                  {/* ป้ายคุ้มทุนอยู่ข้างสถานะ (ไม่มีคำว่าคาดการณ์ · สุทธิสะสมตัวจาง + กล่องจุดคุ้มทุนบอกแล้ว · ตกลง 8 พ.ย. 2026)
                      แถวเงินจริง = ป้าย จ่าย / รับ + ข้อความ (บัญชี · งวดที่จ่าย / รับ) ใช้ช่องสถานะ + หมายเหตุรวมกัน */}
                  {r.money ? (
                    <td colSpan={2} className={`py-2 ${sPad}`}>
                      {withActs(<>
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                          {tag(r.money.kind, r.money.kind === "PAY" ? "จ่าย" : "รับ")}
                          {r.breakEven && beTag("คุ้มทุน", "bg-emerald-600")}
                          <span>{r.money.text}</span>
                        </div>
                        {r.money.detail && <div className="mt-0.5 text-xs text-slate-500">{r.money.detail}</div>}
                      </>, r.actions)}
                    </td>
                  ) : <>
                  <td className={`py-2 ${sPad}`}>
                    <div className="flex flex-wrap gap-1">
                      {r.statusText && stTag(r.statusText, r.statusCls)}
                      {r.also?.statusText && r.also.statusText !== r.statusText && stTag(r.also.statusText, r.also.statusCls)}
                      {r.breakEvenCv && beTag("เวนคืนคุ้มทุน", "bg-sky-600")}
                      {r.breakEven && beTag("คุ้มทุน", "bg-emerald-600")}
                    </div>
                    {r.progress && <div className="text-xs text-slate-500">{r.progress}</div>}
                    {r.also?.progress && <div className="text-xs text-slate-500">{r.also.progress}</div>}
                  </td>
                  {noteCell(r.label, r.notes, r.actions)}
                  </>}<td />
                </tr>
                {subsOf(r).map((c) => (
                  <tr key={c.key} className="align-top bg-sky-50/50 text-xs">
                    <td colSpan={lead} className="py-1.5 pl-3">{cvTag("ลงแล้ว")}</td>
                    <td className="whitespace-nowrap py-1.5 text-sm text-slate-700">{thDate(c.date)}</td>
                    {blankPrem}<td />{net && <td />}
                    <td className="py-1.5 text-right text-sm tabular-nums text-sky-800">{money(c.amount)}</td>
                    <td colSpan={2} className="py-1.5 pl-2 text-slate-600">
                      {withActs(<>{c.text}{c.detail && <div className="text-slate-400">{c.detail}</div>}</>, c.actions)}</td><td />
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
