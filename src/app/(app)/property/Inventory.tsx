"use client";

import { useActionState, useState, type ReactNode } from "react";
import { addInventoryItems, copyInventoryRoom, copyInventoryToLease, disposeInventoryItem, saveHandover, undoInventoryDisposal, type ActionState } from "./actions";
import { SMALL_BTN, SMALL_DEL_BTN, COMMON_ROOM_LABEL, HANDOVER_OUT_LABEL, INVENTORY_DISPOSAL_LABEL, INVENTORY_METER_TYPES, INVENTORY_PICK_TYPES, INVENTORY_TYPE_LABEL, money } from "@/lib/format";
import ModalButton from "@/components/ModalButton";
import Flash from "@/components/Flash";

const cell = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const ghost = "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}
/** ประเภท: เลือกได้เฉพาะของ (มิเตอร์มาจากสาธารณูปโภค) · แถวมิเตอร์ในรายการส่งมอบแสดงชื่อมิเตอร์ (เปลี่ยนไม่ได้) */
const TypeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => INVENTORY_METER_TYPES.includes(value)
  ? <div className="px-1 py-1.5 text-sm text-slate-600">{INVENTORY_TYPE_LABEL[value]}</div>
  : (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cell}>
      {INVENTORY_PICK_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
/** ห้อง: เลือกจากรายการ หรือพิมพ์ชื่อใหม่ (ว่าง = ส่วนกลาง / ทั้งหลัง) */
const RoomInput = ({ value, onChange, listId }: { value: string; onChange: (v: string) => void; listId: string }) => (
  <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={COMMON_ROOM_LABEL} className={cell} />
);

type AddRow = { unit_label: string; item_type: string; name: string; qty: string; brand: string; serial_no: string; value: string; damage_value: string };

/**
 * เพิ่มของในทรัพย์สินหลายแถว (pop up) · หลายห้อง (rooms) → มีช่องห้อง
 *   แถวแรก = ห้องถัดไปที่ยังไม่มีของ · แถวต่อไป = ห้องเดียวกับแถวก่อนหน้า (เลือกซ้ำ / เปลี่ยนได้)
 */
type BuyProps = { pays: [string, string][]; today: string; minDate?: string; currency: string };

export function InventoryAddButton({ assetId, rooms, roomsWithItems, ...buy }: { assetId: string; rooms: string[]; roomsWithItems: string[] } & BuyProps) {
  return (
    <ModalButton label="+ เพิ่มรายการ" title="เพิ่มของในทรัพย์สิน" size="lg" primary>
      <InventoryAddBody assetId={assetId} rooms={rooms} roomsWithItems={roomsWithItems} {...buy} />
    </ModalButton>
  );
}

const amt = (v: string) => Number(v.replace(/,/g, "")) || 0;

function InventoryAddBody({ assetId, rooms, roomsWithItems, pays, today, minDate, currency }: { assetId: string; rooms: string[]; roomsWithItems: string[] } & BuyProps) {
  const multi = rooms.length > 1;
  const firstRoom = multi ? (rooms.find((r) => !roomsWithItems.includes(r)) ?? rooms[0]) : "";
  // แถวแรก = เฟอร์นิเจอร์ · แถวต่อไป = ห้อง / ประเภทเดียวกับแถวบน (ตกลง 2 พ.ย. 2026)
  const blank = (room: string, type = "FURNITURE"): AddRow => ({ unit_label: room, item_type: type, name: "", qty: "1", brand: "", serial_no: "", value: "", damage_value: "" });
  const [rows, setRows] = useState<AddRow[]>([blank(firstRoom)]);
  const [buy, setBuy] = useState(false);
  const [buyAmount, setBuyAmount] = useState<string | null>(null);   // null = ตามมูลค่า × จำนวน
  const [state, action, pending] = useActionState<ActionState, FormData>(addInventoryItems, {});
  const set = (i: number, k: keyof AddRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const sum = rows.reduce((s, r) => s + (r.name.trim() ? amt(r.value) * (amt(r.qty) || 1) : 0), 0);
  const last = rows[rows.length - 1];
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <datalist id="inv-rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>{multi && <th className="w-36 pb-1">ห้อง</th>}<th className="w-36">ประเภท</th><th>รายการ *</th><th className="w-20">จำนวน</th>
              <th className="w-36">ยี่ห้อ / รุ่น</th><th className="w-32">Serial</th><th className="w-28">{buy ? "ราคา / มูลค่าต่อชิ้น" : "มูลค่าต่อชิ้น"}</th><th className="w-28">มูลค่าชำรุดต่อชิ้น</th><th className="w-8" /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                {multi && <td className="py-1 pr-1"><RoomInput value={r.unit_label} onChange={(v) => set(i, "unit_label", v)} listId="inv-rooms" /></td>}
                <td className="py-1 pr-1"><TypeSelect value={r.item_type} onChange={(v) => set(i, "item_type", v)} /></td>
                <td className="py-1 pr-1"><input value={r.name} onChange={(e) => set(i, "name", e.target.value)}
                  placeholder="เช่น ตู้เย็น · เตียง 5 ฟุต" className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" data-money="off" className={`${cell} text-right`} /></td>
                <td className="py-1 pr-1"><input value={r.brand} onChange={(e) => set(i, "brand", e.target.value)} className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.serial_no} onChange={(e) => set(i, "serial_no", e.target.value)} data-plain className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.value} onChange={(e) => set(i, "value", e.target.value)} inputMode="decimal" className={`${cell} text-right`} /></td>
                <td className="py-1 pr-1"><input value={r.damage_value} onChange={(e) => set(i, "damage_value", e.target.value)} inputMode="decimal" className={`${cell} text-right`} /></td>
                <td className="py-1 text-center">{rows.length > 1 && (
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className={SMALL_DEL_BTN}>ลบ</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRows([...rows, blank(last?.unit_label ?? firstRoom, last?.item_type)])} className={ghost}>+ เพิ่มแถว</button>
      </div>
      {/* ซื้อมาใหม่ → บันทึกค่าใช้จ่าย 1 รายการ (หมวดบ้าน · ผูกทรัพย์สินนี้) พร้อมกัน */}
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="buy" checked={buy} onChange={(e) => setBuy(e.target.checked)} />
          ซื้อมาใหม่ — บันทึกเป็นค่าใช้จ่ายด้วย</label>
        {buy && (
          <div className="grid gap-2 sm:grid-cols-[9rem_1fr_14rem_9rem]">
            <label className="text-xs">วันที่จ่าย<input name="buy_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 ${cell}`} /></label>
            <label className="text-xs">รายการ<input name="buy_description" placeholder={`ซื้อ${rows.filter((r) => r.name.trim()).map((r) => r.name.trim()).join(", ")}`} className={`mt-1 ${cell}`} /></label>
            <label className="text-xs">จ่ายจาก
              <select name="buy_pay" required defaultValue="" className={`mt-1 ${cell}`}>
                <option value="" disabled>— เลือก —</option>
                {pays.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label className="text-xs">ยอดที่จ่าย<input name="buy_amount" inputMode="decimal" required value={buyAmount ?? (sum > 0 ? money(sum) : "")}
              onChange={(e) => setBuyAmount(e.target.value)} className={`mt-1 ${cell} text-right`} /></label>
          </div>
        )}
        <p className="text-xs text-slate-500">{buy ? "ลงหน้า Income & Expenses หมวดบ้าน / สาธารณูปโภค (ประเภท อื่น ๆ) ผูกทรัพย์สินนี้ · ยอดตั้งต้น = ราคา × จำนวน (แก้ได้)" : "ของที่มีอยู่แล้วไม่ต้องติ๊ก"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Msg s={state} />
      </div>
      <p className="text-xs text-slate-500">ไม่นับในความมั่งคั่งสุทธิ · มิเตอร์ไฟ / น้ำ เพิ่มที่ &ldquo;ค่าใช้จ่ายประจำ / สาธารณูปโภค&rdquo; (ดึงเข้ารายการส่งมอบให้เอง) · ค่าเสียหายตอนผู้เช่าออก: สูญหาย = จำนวน × มูลค่าต่อชิ้น · ชำรุด = จำนวน × มูลค่าชำรุดต่อชิ้น{multi ? ` · ห้องว่าง = ${COMMON_ROOM_LABEL} (ส่งมอบให้ทุกสัญญา)` : ""}</p>
    </form>
  );
}

/** คัดลอกของทั้งห้องไปอีกห้อง (ห้องตกแต่งเหมือนกัน) */
export function CopyRoomButton({ assetId, rooms, roomsWithItems }: { assetId: string; rooms: string[]; roomsWithItems: string[] }) {
  return (
    <ModalButton size="sm" label="คัดลอกห้อง" title="คัดลอกรายการจากห้องหนึ่งไปอีกห้อง">
      <CopyRoomBody assetId={assetId} rooms={rooms} roomsWithItems={roomsWithItems} />
    </ModalButton>
  );
}

function CopyRoomBody({ assetId, rooms, roomsWithItems }: { assetId: string; rooms: string[]; roomsWithItems: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(copyInventoryRoom, {});
  const to0 = rooms.find((r) => !roomsWithItems.includes(r)) ?? "";
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <datalist id="inv-rooms-copy">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">จากห้อง
          <select name="from" defaultValue={roomsWithItems[0] ?? ""} className={`mt-1 ${cell}`}>
            {roomsWithItems.map((r) => <option key={r} value={r}>{r || COMMON_ROOM_LABEL}</option>)}
          </select></label>
        <label className="text-sm">ไปห้อง
          <input name="to" list="inv-rooms-copy" defaultValue={to0} placeholder="ชื่อห้อง" className={`mt-1 ${cell}`} /></label>
      </div>
      <p className="text-xs text-slate-500">คัดลอกประเภท ชื่อ จำนวน ยี่ห้อ มูลค่า · Serial ไม่คัดลอก (กรอกเองที่แต่ละแถว) · ไม่คัดลอกของที่ขาย / ทิ้งแล้ว</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังคัดลอก…" : "คัดลอก"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export type HandoverItem = {
  /** pulled = ดึงมาจากของในทรัพย์สิน / มิเตอร์ (ลบแล้วยังไม่บันทึก → กดดึงอีกครั้งได้คืน) */
  id?: string; pulled?: boolean; item_type: string; name: string; qty: string; brand: string; serial_no: string;
  /** มูลค่าต่อชิ้น · มูลค่าชำรุดต่อชิ้น */ value: string; damage_value: string;
  in_condition: string; in_reading: string; out_status: string;
  /** จำนวนที่ชำรุด / สูญหาย (ว่าง = ทั้งหมด) */ out_qty: string;
  out_condition: string; out_reading: string; deduction: string; notes: string;
};

const num = (v: string) => Number((v ?? "").replace(/,/g, "")) || 0;
const meterUsed = (r: HandoverItem) => INVENTORY_METER_TYPES.includes(r.item_type) && r.in_reading && r.out_reading
  ? num(r.out_reading) - num(r.in_reading) : null;
const valueHint = (r: HandoverItem) => (num(r.qty) > 1 && num(r.value) > 0 ? `รวม ${money(num(r.value) * num(r.qty))}` : "");
const BLANK: HandoverItem = { item_type: "OTHER", name: "", qty: "1", brand: "", serial_no: "", value: "", damage_value: "", in_condition: "", in_reading: "",
  out_status: "", out_qty: "", out_condition: "", out_reading: "", deduction: "", notes: "" };

/** มูลค่าต่อชิ้นตามผลตรวจ: ชำรุด = มูลค่าชำรุดต่อชิ้น · สูญหาย = มูลค่าต่อชิ้น */
const rateOf = (r: HandoverItem) => (r.out_status === "DAMAGED" ? r.damage_value : r.out_status === "MISSING" ? r.value : "");
const multi = (r: HandoverItem) => num(r.qty) > 1;
/** จำนวนที่ชำรุด / สูญหาย (ว่าง = ทั้งหมด) */
const countOf = (r: HandoverItem) => num(r.out_qty) || num(r.qty) || 1;
/** ค่าเสียหายเสนอ = จำนวนที่ชำรุด / สูญหาย × มูลค่าต่อชิ้นตามผลตรวจ */
const autoDamage = (r: HandoverItem) => (num(rateOf(r)) > 0 ? money(num(rateOf(r)) * countOf(r)) : "");
/** เปลี่ยนช่องในแถวรายการส่งมอบ · ผลตรวจ / จำนวนเปลี่ยน → ค่าเสียหายคำนวณใหม่ ถ้ายังไม่ได้แก้เอง */
function applyCheck(r: HandoverItem, k: keyof HandoverItem, v: string): HandoverItem {
  const x = { ...r, [k]: v };
  if (k === "out_status") x.out_qty = (v === "DAMAGED" || v === "MISSING") && multi(r) ? (r.out_qty || r.qty) : "";
  if (["out_status", "out_qty", "qty", "value", "damage_value"].includes(k) && (!r.deduction || r.deduction === autoDamage(r))) x.deduction = autoDamage(x);
  return x;
}
/** "สูญหาย 1 จาก 3" (ของหลายชิ้น) */
const checkLabel = (r: HandoverItem) => {
  const l = HANDOVER_OUT_LABEL[r.out_status];
  if (!l) return "—";
  return r.out_status !== "OK" && multi(r) ? `${l} ${countOf(r).toLocaleString("th-TH")} จาก ${num(r.qty).toLocaleString("th-TH")}` : l;
};

/** ยอดค่าเสียหายรวม + รายละเอียด (ส่งเข้า close_lease) จากตารางตรวจของ */
export function checkDamage(rows: HandoverItem[]) {
  const hit = rows.filter((r) => num(r.deduction) > 0);
  return {
    amount: Math.round(hit.reduce((t, r) => t + num(r.deduction), 0) * 100) / 100,
    reason: hit.map((r) => `${r.name.trim() || "ไม่ระบุรายการ"}${r.out_status && r.out_status !== "OK" ? ` (${checkLabel(r)})` : ""} ${money(num(r.deduction))}`).join(" · "),
    unnamed: hit.some((r) => !r.name.trim()),
  };
}

/**
 * รายการส่งมอบของสัญญา (pop up) · แยก 2 ช่วง (ตกลง 6 พ.ย. 2026)
 *   mode "in"   = ระหว่างสัญญา: กรอกเฉพาะตอนรับมอบ (ของ · จำนวน · มูลค่าต่อชิ้น · สภาพ · เลขมิเตอร์ใต้ช่องสภาพ)
 *                 ผลตรวจตอนส่งคืน → บันทึกในหน้าต่าง "ผู้เช่าออก / คืนเงินประกัน" (MoveOutCheck)
 *   mode "view" = หลังผู้เช่าออก / สัญญาเดิม / VIEWER: ดูอย่างเดียว เห็นทั้งตอนรับมอบและตอนส่งคืน
 *   mode "both" = เงินประกันคนละสกุลกับค่าเช่า (ใช้ "คืน / หักเงินประกัน" แบบเดิม): แก้ได้ทั้ง 2 ฝั่งในตารางนี้
 * docs = กล่องเอกสาร / รูปถ่ายของสัญญา (server component จากหน้า)
 */
export function HandoverButton({ assetId, leaseId, label, items, mode, currency, docs }: {
  assetId: string; leaseId: string; label: string; items: HandoverItem[]; mode: "in" | "view" | "both"; currency: string; docs?: ReactNode;
}) {
  return (
    <ModalButton label={label} title="รายการส่งมอบ" size="lg" className={SMALL_BTN}>
      <HandoverBody assetId={assetId} leaseId={leaseId} items={items} mode={mode} currency={currency} />
      {docs && <div className="mt-5 border-t border-slate-200 pt-4">{docs}</div>}
    </ModalButton>
  );
}

function HandoverBody({ assetId, leaseId, items, mode, currency }: {
  assetId: string; leaseId: string; items: HandoverItem[]; mode: "in" | "view" | "both"; currency: string;
}) {
  const [rows, setRows] = useState<HandoverItem[]>(items);
  const [removed, setRemoved] = useState<HandoverItem[]>([]);   // แถวเดิมที่กดลบ (ยังไม่บันทึก)
  const [state, action, pending] = useActionState<ActionState, FormData>(saveHandover, {});
  const [cs, copyAction, copying] = useActionState<ActionState, FormData>(copyInventoryToLease, {});
  // รายการเปลี่ยน (ดึงของ / บันทึกแถวใหม่) → ตารางเริ่มจากข้อมูลล่าสุด โดยไม่สร้างฟอร์มใหม่
  //   (เดิมใช้ key → ฟอร์มถูกสร้างใหม่ ข้อความ "บันทึกแล้ว" หาย หน้าต่างไม่ปิด ต้องกดบันทึกซ้ำ · แก้ 6 พ.ย. 2026)
  const idKey = items.map((x) => x.id).join(",");
  const [seenKey, setSeenKey] = useState(idKey);
  if (seenKey !== idKey) { setSeenKey(idKey); setRows(items); setRemoved([]); }
  // กดดึงอีกครั้ง: แถวที่ดึงมาแล้วกดลบ (ยังไม่บันทึก) กลับมาที่เดิม · แก้ไขในแถวอื่น / แถวใหม่ยังอยู่
  const restorePulled = () => {
    const back = new Set(removed.filter((x) => x.pulled).map((x) => x.id));
    if (!back.size) return;
    const kept = new Map(rows.filter((r) => r.id).map((r) => [r.id, r]));
    setRows([...items.filter((x) => back.has(x.id) || kept.has(x.id)).map((x) => kept.get(x.id) ?? x), ...rows.filter((r) => !r.id)]);
    setRemoved(removed.filter((x) => !x.pulled));
  };
  const set = (i: number, k: keyof HandoverItem, v: string) => setRows(rows.map((r, j) => (j === i ? applyCheck(r, k, v) : r)));
  const canWrite = mode !== "view";
  const showOut = mode !== "in";
  const editOut = mode === "both";
  const total = rows.reduce((s, r) => s + num(r.deduction), 0);
  const ro = !canWrite;
  // ดูอย่างเดียว = ตัวหนังสือธรรมดา (ไม่มีกรอบช่องกรอก)
  const roCell = "w-full border-0 bg-transparent px-1 py-1.5 text-sm text-slate-700 focus:outline-none";
  const ic = ro ? roCell : cell, oc = editOut ? cell : roCell;
  const sideL = "border-l border-slate-200 pl-2";
  const note = "mt-0.5 text-xs text-slate-500";
  return (
    <div className="space-y-3">
      {canWrite && (
        // ดึงของ = เติมรายการ ไม่ใช่การบันทึก → หน้าต่างไม่ปิด (data-no-close)
        <form action={copyAction} onSubmit={restorePulled} data-no-close className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="lease_id" value={leaseId} />
          <button disabled={copying} className={ghost}>{copying ? "กำลังดึง…" : "ดึงของ + มิเตอร์ (ห้องนี้ + ส่วนกลาง)"}</button>
          <span className="text-xs text-slate-500">กดซ้ำได้ เพิ่มเฉพาะของที่ยังไม่มี</span>
          <Msg s={cs} />
        </form>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="lease_id" value={leaseId} />
        <input type="hidden" name="rows" value={JSON.stringify(rows)} />
        <input type="hidden" name="removed" value={JSON.stringify(removed.map((x) => x.id))} />
        {rows.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ{canWrite && <> · กด &ldquo;ดึงของ + มิเตอร์&rdquo; หรือ &ldquo;+ เพิ่มแถว&rdquo;</>}</p> : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${showOut ? "min-w-[68rem]" : "min-w-[52rem]"}`}>
              <thead className="text-left text-xs text-slate-500">
                {/* มีฝั่งส่งคืน (ดูอย่างเดียว / เงินประกันคนละสกุล) = คอลัมน์แคบลง ให้ช่องรายการยังกว้างพอ */}
                <tr><th className={`${showOut ? "w-28" : "w-32"} pb-1`}>ประเภท</th><th>รายการ</th><th className="w-16">จำนวน</th>
                  <th className={showOut ? "w-28" : "w-40 whitespace-nowrap"}>มูลค่าต่อชิ้น / เลขมิเตอร์</th>
                  <th className={showOut ? "w-28" : "w-32 whitespace-nowrap"}>มูลค่าชำรุดต่อชิ้น</th>
                  <th className={`${showOut ? "w-32" : "w-56"} ${sideL}`}>ตอนรับมอบ: สภาพ</th>
                  {showOut && <><th className={`w-32 ${sideL}`}>ตอนส่งคืน: ผลตรวจ</th><th className="w-32">สภาพตอนคืน</th><th className="w-24">ค่าเสียหาย</th></>}
                  {canWrite && <th className="w-6" />}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meter = INVENTORY_METER_TYPES.includes(r.item_type);
                  const used = meterUsed(r);
                  return (
                    <tr key={r.id ?? `n${i}`} className="align-top">
                      <td className="py-1 pr-1">{ro ? <div className="px-1 py-1.5 text-slate-600">{INVENTORY_TYPE_LABEL[r.item_type] ?? r.item_type}</div>
                        : <TypeSelect value={r.item_type} onChange={(v) => set(i, "item_type", v)} />}</td>
                      <td className="py-1 pr-1">
                        {/* มิเตอร์: เลขที่มิเตอร์อยู่ท้ายชื่อ บรรทัดเดียว */}
                        <div className="flex items-center gap-2"><input value={r.name} readOnly={ro} onChange={(e) => set(i, "name", e.target.value)} className={ic} />
                          {meter && r.serial_no && <span className="shrink-0 text-xs text-slate-500">เลขที่ {r.serial_no}</span>}</div>
                        {!meter && (r.brand || r.serial_no) && <div className={note}>{[r.brand, r.serial_no].filter(Boolean).join(" · ")}</div>}</td>
                      <td className="py-1 pr-1"><input value={r.qty} readOnly={ro} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" data-money="off" className={`${ic} text-right`} /></td>
                      <td className="py-1 pr-1">{meter
                        ? <input value={r.in_reading} readOnly={ro} onChange={(e) => set(i, "in_reading", e.target.value)} inputMode="decimal" data-money="off"
                            placeholder={ro ? "" : "เลขมิเตอร์"} aria-label="เลขมิเตอร์ตอนรับมอบ" className={`${ic} text-right`} />
                        : <>
                          <input value={r.value} readOnly={ro} onChange={(e) => set(i, "value", e.target.value)} inputMode="decimal" placeholder={ro ? "" : "0.00"} className={`${ic} text-right`} />
                          {valueHint(r) && <div className={`${note} text-right`}>{valueHint(r)}</div>}</>}</td>
                      <td className="py-1 pr-1">{!meter && <input value={r.damage_value} readOnly={ro} onChange={(e) => set(i, "damage_value", e.target.value)} inputMode="decimal"
                        placeholder={ro ? "" : "0.00"} aria-label="มูลค่าชำรุดต่อชิ้น" className={`${ic} text-right`} />}</td>
                      <td className={`py-1 pr-1 ${sideL}`}>
                        <input value={r.in_condition} readOnly={ro} onChange={(e) => set(i, "in_condition", e.target.value)} placeholder="ปกติ" className={ic} />
                      </td>
                      {showOut && <>
                        <td className={`py-1 pr-1 ${sideL}`}>
                          {meter ? (
                            <input value={r.out_reading} readOnly={!editOut} onChange={(e) => set(i, "out_reading", e.target.value)} inputMode="decimal" data-money="off"
                              placeholder={editOut ? "เลขตอนออก" : ""} aria-label="เลขมิเตอร์ตอนออก" className={`${oc} text-right`} />
                          ) : editOut ? (<>
                            <select value={r.out_status} onChange={(e) => set(i, "out_status", e.target.value)} className={cell}>
                              <option value="">—</option>
                              {Object.entries(HANDOVER_OUT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <OutQty r={r} onChange={(v) => set(i, "out_qty", v)} /></>
                          ) : <div className={`px-1 py-1.5 ${r.out_status && r.out_status !== "OK" ? "text-red-700" : "text-slate-600"}`}>{checkLabel(r)}</div>}
                        </td>
                        <td className="py-1 pr-1">{meter
                          ? <div className="px-1 py-1.5 text-slate-600">{used != null ? `ใช้ไป ${used.toLocaleString("th-TH")} หน่วย` : ""}</div>
                          : <input value={r.out_condition} readOnly={!editOut} onChange={(e) => set(i, "out_condition", e.target.value)} className={oc} />}</td>
                        <td className="py-1 pr-1"><input value={r.deduction} readOnly={!editOut} onChange={(e) => set(i, "deduction", e.target.value)} inputMode="decimal" className={`${oc} text-right`} /></td>
                      </>}
                      {canWrite && <td className="py-1 text-center">
                        <button type="button" onClick={() => { if (r.id) setRemoved([...removed, r]); setRows(rows.filter((_, j) => j !== i)); }}
                          className={SMALL_DEL_BTN}>ลบ</button></td>}
                    </tr>
                  );
                })}
              </tbody>
              {showOut && total > 0 && (
                <tfoot><tr className="border-t border-slate-200 font-medium"><td colSpan={8} className="py-2 text-right">รวมค่าเสียหาย</td>
                  <td className="py-2 pr-1 text-right tabular-nums">{money(total, currency)}</td>{canWrite && <td />}</tr></tfoot>
              )}
            </table>
          </div>
        )}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setRows([...rows, BLANK])} className={ghost}>+ เพิ่มแถว</button>
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกรายการส่งมอบ"}</button>
            <Msg s={state} />
          </div>
        )}
        <p className="text-xs text-slate-500">
          {mode === "in" ? <>ผลตรวจตอนส่งคืน (ครบ / ชำรุด / สูญหาย · เลขมิเตอร์ตอนออก · ค่าเสียหาย) บันทึกในหน้าต่าง &ldquo;ผู้เช่าออก / คืนเงินประกัน&rdquo;</>
            : mode === "both" ? <>เลขมิเตอร์ตอนคืน − ตอนรับมอบ = หน่วยที่ใช้ · ค่าเสียหายรวมจะเติมให้ตอนกด &ldquo;คืน / หักเงินประกัน&rdquo;</>
            : <>ดูอย่างเดียว · ผลตรวจตอนส่งคืนมาจากการบันทึกผู้เช่าออก</>}
        </p>
      </form>
    </div>
  );
}

/** จำนวนที่ชำรุด / สูญหาย: "[1] จาก 3 ชิ้น" ใต้ผลตรวจ (เฉพาะของหลายชิ้นที่ไม่ครบ) */
function OutQty({ r, onChange }: { r: HandoverItem; onChange: (v: string) => void }) {
  if (!multi(r) || !r.out_status || r.out_status === "OK") return null;
  return (
    <div className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
      <input value={r.out_qty} onChange={(e) => onChange(e.target.value)} inputMode="decimal" data-money="off" placeholder={r.qty}
        aria-label={`จำนวนที่${HANDOVER_OUT_LABEL[r.out_status]}`} className="w-14 rounded-md border border-slate-300 px-2 py-1 text-right text-sm" />
      จาก {num(r.qty).toLocaleString("th-TH")} ชิ้น
    </div>
  );
}

/**
 * ตารางตรวจของตอนส่งคืน (ในหน้าต่าง "ผู้เช่าออก / คืนเงินประกัน" · ตกลง 6 พ.ย. 2026)
 *   ผลตรวจตั้งต้น "ครบ / ปกติ" ทุกแถว · สูญหาย → ค่าเสียหาย = มูลค่า × จำนวน (แก้ได้) · มิเตอร์: เลขตอนออก → ใช้ไป N หน่วย
 *   ความเสียหายที่ไม่มีในรายการ (เช่น ทาสีผนัง) = "+ เพิ่มแถว" · ยอดรวม + รายละเอียด → บรรทัด "หัก ค่าเสียหาย"
 */
export function MoveOutCheck({ rows, setRows, currency }: { rows: HandoverItem[]; setRows: (r: HandoverItem[]) => void; currency: string }) {
  const set = (i: number, k: keyof HandoverItem, v: string) => setRows(rows.map((r, j) => (j === i ? applyCheck(r, k, v) : r)));
  const total = rows.reduce((t, r) => t + num(r.deduction), 0);
  const note = "mt-0.5 text-xs text-slate-500";
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-800">ตรวจของตอนส่งคืน</div>
      {rows.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการส่งมอบ · มีค่าเสียหาย กด &ldquo;+ เพิ่มแถว&rdquo;</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="pb-1">รายการ</th><th className="w-44">ตอนรับมอบ</th><th className="w-28 text-right">มูลค่าต่อชิ้น</th>
                <th className="w-36 border-l border-slate-200 pl-2">ผลตรวจ</th><th className="w-44">สภาพตอนคืน</th><th className="w-28">ค่าเสียหาย</th><th className="w-6" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const meter = INVENTORY_METER_TYPES.includes(r.item_type);
                const used = meterUsed(r);
                const isNew = !r.id;
                return (
                  <tr key={r.id ?? `n${i}`} className="align-top">
                    <td className="py-1 pr-2">
                      {isNew ? <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="เช่น ทาสีผนัง" className={cell} />
                        : <div className="py-1.5">{r.name}{num(r.qty) > 1 && <span className="text-slate-500"> × {r.qty}</span>}
                          {meter && r.serial_no && <span className="text-xs text-slate-500"> · เลขที่ {r.serial_no}</span>}</div>}
                      {!isNew && !meter && <div className={note}>{[INVENTORY_TYPE_LABEL[r.item_type] === r.name.trim() ? "" : INVENTORY_TYPE_LABEL[r.item_type], r.brand, r.serial_no].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">{meter ? (r.in_reading ? `เลขมิเตอร์ ${num(r.in_reading).toLocaleString("th-TH")}` : "") : r.in_condition || (isNew ? "" : "ปกติ")}</td>
                    {/* ชำรุด = มูลค่าชำรุดต่อชิ้น · สูญหาย = มูลค่าต่อชิ้น · ครบ = มูลค่าต่อชิ้น (สีจาง ไว้ดูเทียบ) */}
                    <td className="py-1.5 pr-2 text-right tabular-nums">{meter || isNew ? "" : (() => {
                      const ok = !r.out_status || r.out_status === "OK";
                      const v = ok ? r.value : rateOf(r);
                      return num(v) > 0 ? <span className={ok ? "text-slate-400" : "text-slate-700"}>{money(num(v))}</span>
                        : !ok ? <span className="text-xs text-slate-400">ไม่ได้ตั้งไว้</span> : "";
                    })()}</td>
                    <td className="border-l border-slate-200 py-1 pl-2 pr-1">
                      {/* มิเตอร์: ช่องเลขตอนออกแทนผลตรวจ (บรรทัดเดียว) */}
                      {meter ? <input value={r.out_reading} onChange={(e) => set(i, "out_reading", e.target.value)} inputMode="decimal" data-money="off"
                          placeholder="เลขตอนออก" aria-label="เลขมิเตอร์ตอนออก" className={`${cell} text-right`} />
                        : <><select value={r.out_status || "OK"} onChange={(e) => set(i, "out_status", e.target.value)} className={cell}>
                          {Object.entries(HANDOVER_OUT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <OutQty r={r} onChange={(v) => set(i, "out_qty", v)} /></>}
                    </td>
                    <td className="py-1 pr-1">{meter
                      ? <div className="py-1.5 text-slate-600">{used != null ? `ใช้ไป ${used.toLocaleString("th-TH")} หน่วย` : ""}</div>
                      : <input value={r.out_condition} onChange={(e) => set(i, "out_condition", e.target.value)} placeholder="ถ้ามี" className={cell} />}</td>
                    <td className="py-1 pr-1"><input value={r.deduction} onChange={(e) => set(i, "deduction", e.target.value)} inputMode="decimal" placeholder="0.00" className={`${cell} text-right`} /></td>
                    <td className="py-1 text-center">{isNew && (
                      <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className={SMALL_DEL_BTN}>ลบ</button>)}</td>
                  </tr>
                );
              })}
            </tbody>
            {total > 0 && (
              <tfoot><tr className="border-t border-slate-200 font-medium"><td colSpan={5} className="py-2 text-right">รวมค่าเสียหาย</td>
                <td className="py-2 pr-1 text-right tabular-nums">{money(total, currency)}</td><td /></tr></tfoot>
            )}
          </table>
        </div>
      )}
      <button type="button" onClick={() => setRows([...rows, { ...BLANK, out_status: "DAMAGED" }])} className={SMALL_BTN}>+ เพิ่มแถว</button>
    </div>
  );
}

/** ขาย / ทิ้ง ของในทรัพย์สิน (pop up) · ขายได้เงิน → รายได้อื่นของทรัพย์สิน */
export function DisposeButton({ assetId, itemId, name, banks, today, minDate }: {
  assetId: string; itemId: string; name: string; banks: [string, string][]; today: string; minDate?: string;
}) {
  return (
    <ModalButton label="ขาย / ทิ้ง" title={`ขาย / ทิ้ง: ${name}`} className={SMALL_BTN}>
      <DisposeBody assetId={assetId} itemId={itemId} banks={banks} today={today} minDate={minDate} />
    </ModalButton>
  );
}

function DisposeBody({ assetId, itemId, banks, today, minDate }: { assetId: string; itemId: string; banks: [string, string][]; today: string; minDate?: string }) {
  const [type, setType] = useState("SOLD");
  const [state, action, pending] = useActionState<ActionState, FormData>(disposeInventoryItem, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="item_id" value={itemId} />
      <div className="flex gap-4 text-sm">
        {Object.entries(INVENTORY_DISPOSAL_LABEL).map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5"><input type="radio" name="disposal_type" value={v} checked={type === v} onChange={() => setType(v)} />{l}</label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">วันที่<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 ${cell}`} /></label>
        {type === "SOLD" && <>
          <label className="text-sm">ขายได้ (เว้นว่าง = ไม่ได้เงิน)<input name="amount" inputMode="decimal" className={`mt-1 ${cell} text-right`} /></label>
          <label className="text-sm sm:col-span-2">รับเข้าบัญชี
            <select name="to_asset_id" defaultValue={banks[0]?.[0] ?? ""} className={`mt-1 ${cell}`}>
              {banks.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
        </>}
        <label className="text-sm sm:col-span-2">หมายเหตุ<input name="notes" className={`mt-1 ${cell}`} /></label>
      </div>
      <p className="text-xs text-slate-500">{type === "SOLD" ? "ได้เงิน → ลงเป็นรายได้อื่นของทรัพย์สินนี้ (หน้า Income & Expenses) · " : ""}ของจะย้ายไป &ldquo;ขาย / ทิ้งแล้ว&rdquo; และไม่ถูกดึงเข้ารายการส่งมอบอีก · ยกเลิกได้</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/** ยกเลิกการขาย / ทิ้ง (ลบรายได้ที่สร้าง · คืนของเข้ารายการ) */
export function UndoDisposalButton({ assetId, itemId }: { assetId: string; itemId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(undoInventoryDisposal, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="item_id" value={itemId} />
      <button disabled={pending} className={SMALL_DEL_BTN}>{pending ? "…" : "ยกเลิก"}</button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
