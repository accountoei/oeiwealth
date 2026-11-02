"use client";

import { useActionState, useState, type ReactNode } from "react";
import { addInventoryItems, copyInventoryRoom, copyInventoryToLease, saveHandover, type ActionState } from "./actions";
import { COMMON_ROOM_LABEL, HANDOVER_OUT_LABEL, INVENTORY_METER_TYPES, INVENTORY_TYPE_LABEL, money } from "@/lib/format";
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
const TypeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={cell}>
    {Object.entries(INVENTORY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
/** ห้อง: เลือกจากรายการ หรือพิมพ์ชื่อใหม่ (ว่าง = ส่วนกลาง / ทั้งหลัง) */
const RoomInput = ({ value, onChange, listId }: { value: string; onChange: (v: string) => void; listId: string }) => (
  <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={COMMON_ROOM_LABEL} className={cell} />
);

type AddRow = { unit_label: string; item_type: string; name: string; qty: string; brand: string; serial_no: string; value: string };

/**
 * เพิ่มของในทรัพย์สินหลายแถว (pop up) · หลายห้อง (rooms) → มีช่องห้อง
 *   แถวแรก = ห้องถัดไปที่ยังไม่มีของ · แถวต่อไป = ห้องเดียวกับแถวก่อนหน้า (เลือกซ้ำ / เปลี่ยนได้)
 */
export function InventoryAddButton({ assetId, rooms, roomsWithItems }: { assetId: string; rooms: string[]; roomsWithItems: string[] }) {
  return (
    <ModalButton label="+ เพิ่มรายการ" title="เพิ่มของในทรัพย์สิน" size="lg" primary>
      <InventoryAddBody assetId={assetId} rooms={rooms} roomsWithItems={roomsWithItems} />
    </ModalButton>
  );
}

function InventoryAddBody({ assetId, rooms, roomsWithItems }: { assetId: string; rooms: string[]; roomsWithItems: string[] }) {
  const multi = rooms.length > 1;
  const firstRoom = multi ? (rooms.find((r) => !roomsWithItems.includes(r)) ?? rooms[0]) : "";
  const blank = (room: string): AddRow => ({ unit_label: room, item_type: "FURNITURE", name: "", qty: "1", brand: "", serial_no: "", value: "" });
  const [rows, setRows] = useState<AddRow[]>([blank(firstRoom)]);
  const [state, action, pending] = useActionState<ActionState, FormData>(addInventoryItems, {});
  const set = (i: number, k: keyof AddRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const meter = (r: AddRow) => INVENTORY_METER_TYPES.includes(r.item_type);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <datalist id="inv-rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>{multi && <th className="w-36 pb-1">ห้อง</th>}<th className="w-36">ประเภท</th><th>รายการ *</th><th className="w-20">จำนวน</th>
              <th className="w-36">ยี่ห้อ / รุ่น</th><th className="w-32">เลขมิเตอร์ / Serial</th><th className="w-28">มูลค่าทดแทน</th><th className="w-8" /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                {multi && <td className="py-1 pr-1"><RoomInput value={r.unit_label} onChange={(v) => set(i, "unit_label", v)} listId="inv-rooms" /></td>}
                <td className="py-1 pr-1"><TypeSelect value={r.item_type} onChange={(v) => set(i, "item_type", v)} /></td>
                <td className="py-1 pr-1"><input value={r.name} onChange={(e) => set(i, "name", e.target.value)}
                  placeholder={meter(r) ? "เช่น มิเตอร์ไฟห้อง 1203" : "เช่น ตู้เย็น · เตียง 5 ฟุต"} className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" data-money="off" className={`${cell} text-right`} /></td>
                <td className="py-1 pr-1"><input value={r.brand} onChange={(e) => set(i, "brand", e.target.value)} className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.serial_no} onChange={(e) => set(i, "serial_no", e.target.value)} data-plain className={cell} /></td>
                <td className="py-1 pr-1"><input value={r.value} onChange={(e) => set(i, "value", e.target.value)} inputMode="decimal" className={`${cell} text-right`} /></td>
                <td className="py-1 text-center">{rows.length > 1 && (
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="ลบแถว">×</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRows([...rows, blank(rows[rows.length - 1]?.unit_label ?? firstRoom)])} className={ghost}>+ เพิ่มแถว</button>
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Msg s={state} />
      </div>
      <p className="text-xs text-slate-500">ไม่นับใน Net Worth · มูลค่าทดแทนใช้เสนอค่าเสียหายตอนหักเงินประกัน{multi ? ` · ห้องว่าง = ${COMMON_ROOM_LABEL} (ส่งมอบให้ทุกสัญญา)` : ""}</p>
    </form>
  );
}

/** คัดลอกของทั้งห้องไปอีกห้อง (ห้องตกแต่งเหมือนกัน) */
export function CopyRoomButton({ assetId, rooms, roomsWithItems }: { assetId: string; rooms: string[]; roomsWithItems: string[] }) {
  return (
    <ModalButton label="คัดลอกห้อง" title="คัดลอกรายการจากห้องหนึ่งไปอีกห้อง">
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
      <p className="text-xs text-slate-500">คัดลอกประเภท ชื่อ จำนวน ยี่ห้อ มูลค่า · เลขมิเตอร์ / Serial ไม่คัดลอก (กรอกเองที่แต่ละแถว)</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังคัดลอก…" : "คัดลอก"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export type HandoverItem = {
  id?: string; item_type: string; name: string; qty: string; brand: string; serial_no: string; value: string;
  in_condition: string; in_reading: string; out_status: string; out_condition: string; out_reading: string; deduction: string; notes: string;
};

/**
 * รายการส่งมอบของสัญญา (pop up): ดึงจากของในทรัพย์สิน · สภาพ / เลขมิเตอร์ วันรับมอบ · วันส่งคืน (ครบ / ชำรุด / สูญหาย) + ค่าเสียหาย
 * docs = กล่องเอกสาร / รูปถ่ายของสัญญา (server component จากหน้า)
 */
export function HandoverButton({ assetId, leaseId, label, items, canWrite, currency, docs }: {
  assetId: string; leaseId: string; label: string; items: HandoverItem[]; canWrite: boolean; currency: string; docs?: ReactNode;
}) {
  return (
    <ModalButton label={label} title="รายการส่งมอบ (รับมอบ / ส่งคืน)" size="lg" className="text-sm text-slate-700 underline">
      {/* รายการเปลี่ยน (ดึงของ / บันทึก) → เริ่มตารางใหม่จากข้อมูลล่าสุด */}
      <HandoverBody key={items.map((x) => x.id).join(",")} assetId={assetId} leaseId={leaseId} items={items} canWrite={canWrite} currency={currency} />
      {docs && <div className="mt-5 border-t border-slate-200 pt-4">{docs}</div>}
    </ModalButton>
  );
}

function HandoverBody({ assetId, leaseId, items, canWrite, currency }: {
  assetId: string; leaseId: string; items: HandoverItem[]; canWrite: boolean; currency: string;
}) {
  const [rows, setRows] = useState<HandoverItem[]>(items);
  const [removed, setRemoved] = useState<string[]>([]);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveHandover, {});
  const [cs, copyAction, copying] = useActionState<ActionState, FormData>(copyInventoryToLease, {});
  const set = (i: number, k: keyof HandoverItem, v: string) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const x = { ...r, [k]: v };
    // สูญหาย → เสนอค่าเสียหาย = มูลค่าทดแทน × จำนวน (แก้ได้)
    if (k === "out_status" && v === "MISSING" && !r.deduction && r.value) x.deduction = money(Number(r.value.replace(/,/g, "")) * (Number(r.qty) || 1));
    return x;
  }));
  const total = rows.reduce((s, r) => s + (Number(r.deduction.replace(/,/g, "")) || 0), 0);
  const blank: HandoverItem = { item_type: "OTHER", name: "", qty: "1", brand: "", serial_no: "", value: "", in_condition: "", in_reading: "",
    out_status: "", out_condition: "", out_reading: "", deduction: "", notes: "" };
  const ro = !canWrite;
  return (
    <div className="space-y-3">
      {canWrite && (
        <form action={copyAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="lease_id" value={leaseId} />
          <button disabled={copying} className={ghost}>{copying ? "กำลังดึง…" : "ดึงของจากทรัพย์สิน (ห้องนี้ + ส่วนกลาง)"}</button>
          <span className="text-xs text-slate-500">กดซ้ำได้ เพิ่มเฉพาะของที่ยังไม่มี</span>
          <Msg s={cs} />
        </form>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="lease_id" value={leaseId} />
        <input type="hidden" name="rows" value={JSON.stringify(rows)} />
        <input type="hidden" name="removed" value={JSON.stringify(removed)} />
        {rows.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ · กด &ldquo;ดึงของจากทรัพย์สิน&rdquo; หรือ &ldquo;+ เพิ่มแถว&rdquo;</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="w-32 pb-1">ประเภท</th><th>รายการ</th><th className="w-16">จำนวน</th>
                  <th className="w-40 border-l border-slate-200 pl-2">วันรับมอบ: สภาพ</th><th className="w-24">เลขมิเตอร์</th>
                  <th className="w-28 border-l border-slate-200 pl-2">วันส่งคืน</th><th className="w-36">สภาพ</th><th className="w-24">เลขมิเตอร์</th>
                  <th className="w-28">ค่าเสียหาย</th><th className="w-6" /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meter = INVENTORY_METER_TYPES.includes(r.item_type);
                  const used = meter && r.in_reading && r.out_reading ? Number(r.out_reading.replace(/,/g, "")) - Number(r.in_reading.replace(/,/g, "")) : null;
                  return (
                    <tr key={r.id ?? `n${i}`} className="align-top">
                      <td className="py-1 pr-1"><TypeSelect value={r.item_type} onChange={(v) => set(i, "item_type", v)} /></td>
                      <td className="py-1 pr-1"><input value={r.name} readOnly={ro} onChange={(e) => set(i, "name", e.target.value)} className={cell} />
                        {(r.brand || r.serial_no) && <div className="mt-0.5 text-xs text-slate-500">{[r.brand, r.serial_no].filter(Boolean).join(" · ")}</div>}</td>
                      <td className="py-1 pr-1"><input value={r.qty} readOnly={ro} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" data-money="off" className={`${cell} text-right`} /></td>
                      <td className="border-l border-slate-200 py-1 pl-2 pr-1"><input value={r.in_condition} readOnly={ro} onChange={(e) => set(i, "in_condition", e.target.value)} placeholder="ปกติ" className={cell} /></td>
                      <td className="py-1 pr-1">{meter && <input value={r.in_reading} readOnly={ro} onChange={(e) => set(i, "in_reading", e.target.value)} inputMode="decimal" data-money="off" className={`${cell} text-right`} />}</td>
                      <td className="border-l border-slate-200 py-1 pl-2 pr-1">
                        <select value={r.out_status} disabled={ro} onChange={(e) => set(i, "out_status", e.target.value)} className={cell}>
                          <option value="">—</option>
                          {Object.entries(HANDOVER_OUT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></td>
                      <td className="py-1 pr-1"><input value={r.out_condition} readOnly={ro} onChange={(e) => set(i, "out_condition", e.target.value)} className={cell} /></td>
                      <td className="py-1 pr-1">{meter && <>
                        <input value={r.out_reading} readOnly={ro} onChange={(e) => set(i, "out_reading", e.target.value)} inputMode="decimal" data-money="off" className={`${cell} text-right`} />
                        {used != null && <div className="mt-0.5 text-right text-xs text-slate-500">ใช้ไป {used.toLocaleString("th-TH")} หน่วย</div>}</>}</td>
                      <td className="py-1 pr-1"><input value={r.deduction} readOnly={ro} onChange={(e) => set(i, "deduction", e.target.value)} inputMode="decimal" className={`${cell} text-right`} /></td>
                      <td className="py-1 text-center">{canWrite && (
                        <button type="button" onClick={() => { if (r.id) setRemoved([...removed, r.id]); setRows(rows.filter((_, j) => j !== i)); }}
                          className="text-slate-400 hover:text-red-600" aria-label="ลบแถว">×</button>)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {total > 0 && (
                <tfoot><tr className="border-t border-slate-200 font-medium"><td colSpan={8} className="py-2 text-right">รวมค่าเสียหาย (เสนอหักจากเงินประกัน)</td>
                  <td className="py-2 pr-1 text-right tabular-nums">{money(total, currency)}</td><td /></tr></tfoot>
              )}
            </table>
          </div>
        )}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setRows([...rows, blank])} className={ghost}>+ เพิ่มแถว</button>
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกรายการส่งมอบ"}</button>
            <Msg s={state} />
          </div>
        )}
        <p className="text-xs text-slate-500">เลขมิเตอร์วันส่งคืน − วันรับมอบ = หน่วยที่ใช้ (ใช้คิดค่าน้ำไฟงวดสุดท้าย) · ค่าเสียหายรวมจะเติมให้ตอนกด &ldquo;คืน / หักเงินประกัน&rdquo;</p>
      </form>
    </div>
  );
}
