import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import PrintShell, { type PrintSection } from "../../loan/[id]/print-shell";
import { CloseoutSummary, HandoverAnnex, LeaseContract, RentAnnex, termMonths, TITLE, type CloseoutData, type LeaseData } from "./contract";
import { LEASE_DETAIL_FIELDS } from "@/lib/lease";

// absolute = ไม่ต่อท้ายชื่อระบบ (ชื่อนี้เป็นชื่อไฟล์ตอนบันทึกเป็น PDF)
export const metadata = { title: { absolute: "พิมพ์สัญญาเช่า" } };

/**
 * หน้าพิมพ์สัญญาเช่า (นอกเมนูหลัก · ขนาด A4 · ตกลง 2 พ.ย. 2026) — แบบเดียวกับหน้าพิมพ์สัญญาเงินให้กู้
 *   1) สัญญาเช่า แยกแบบตามประเภททรัพย์สิน 2) ตารางค่าเช่าแนบท้าย 3) บัญชีทรัพย์สิน / สภาพ ณ วันส่งมอบ
 *   ผู้ให้เช่า = เจ้าของตามสัดส่วนความเป็นเจ้าของ (ชื่อเต็ม + ที่อยู่จากหน้า Family)
 *   ผู้เช่า / ทำที่ / แจ้งล่วงหน้า / ค่าเสียหาย / พยาน = จาก "รายละเอียดสัญญา" (ว่าง = เว้นเส้นให้เขียนเอง)
 *   เลขบัญชีรับค่าเช่า + เลขบัตร / ทะเบียนผู้เช่า เต็มเฉพาะ ADMIN / EDITOR (ฐานข้อมูลตรวจซ้ำ · บันทึก Audit)
 */
export default async function PrintLeasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const [{ id }, { s: only }] = await Promise.all([params, searchParams]);
  const me = await requireAppUser();
  const supabase = await createClient();
  const canReveal = me.role === "ADMIN" || me.role === "EDITOR";
  const { data: l } = await supabase.from("property_leases")
    .select(`id,property_id,unit_label,tenant_name,contract_no,start_date,end_date,rent_amount,rent_currency,payment_frequency,payment_due_day,prorate_basis,rent_timing,grace_days,late_fee_per_day,security_deposit,utilities_billing,rent_to_asset_id,${LEASE_DETAIL_FIELDS}`)
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (!l) notFound();
  const { data: pd } = await supabase.from("property_details").select("id,asset_id,property_type,address,land_area_sq_wa,house_no,unit_no,floor_no,building_name,assets!inner(name)")
    .eq("id", l.property_id).maybeSingle();
  if (!pd) notFound();
  const [{ data: deeds }, { data: owners }, { data: people }, { data: banks }, { data: biz }, { data: tenantId }, { data: hand }, { data: sched }, { data: co }] = await Promise.all([
    supabase.from("property_deeds").select("component_type,title_type,title_deed_no,land_no,deed_book,deed_page,land_area_sq_wa,building_area_sqm,sort_order")
      .eq("property_id", pd.id).is("deleted_at", null).order("sort_order"),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,end_date").eq("asset_id", pd.asset_id),
    supabase.from("persons").select("id,title_prefix,full_name_th,address").is("deleted_at", null),
    supabase.from("v_bank_accounts_safe").select("id,asset_id,bank_name,account_name,account_no_masked"),
    l.contract_place_type === "BUSINESS" && l.contract_place_business_id
      ? supabase.from("private_business_details").select("company_name,address").eq("asset_id", l.contract_place_business_id).maybeSingle()
      : Promise.resolve({ data: null }),
    canReveal && l.tenant_id_last4 ? supabase.rpc("reveal_lease_tenant_id", { p_lease_id: l.id }) : Promise.resolve({ data: null }),
    supabase.from("lease_handover_items").select("item_type,name,qty,brand,serial_no,in_condition,in_reading")
      .eq("lease_id", l.id).is("deleted_at", null).order("sort_order").order("created_at"),
    // ตารางค่าเช่าทั้งสัญญาจากฐานข้อมูล (สูตรเดียวกับหน้ารับค่าเช่า) · คิดถึงวันสิ้นสุดสัญญาเดิมแม้เลิกก่อนกำหนด
    supabase.rpc("lease_rent_schedule", { p_lease_id: l.id, p_end: l.end_date }),
    // ใบสรุปผู้เช่าออก (ถ้าบันทึกแล้ว)
    supabase.from("lease_closeouts").select("*").eq("lease_id", l.id).is("deleted_at", null).maybeSingle(),
  ]);
  const bank = (banks ?? []).find((b) => b.asset_id === l.rent_to_asset_id);
  const accountNo = bank && canReveal
    ? ((await supabase.rpc("reveal_bank_account", { p_bank_account_id: bank.id })).data as string | null) ?? null
    : null;

  type Deed = { component_type: string; title_type: string | null; title_deed_no: string | null; land_no: string | null; deed_book: string | null;
    deed_page: string | null; land_area_sq_wa: number | null; building_area_sqm: number | null };
  const ds = (deeds ?? []) as Deed[];
  const lands = ds.filter((x) => x.component_type === "LAND");
  const sqm = ds.filter((x) => x.component_type === "BUILDING" && x.building_area_sqm != null).reduce((t, x) => t + Number(x.building_area_sqm), 0);
  const type = (["HOUSE", "CONDO", "LAND", "OTHER"].includes(pd.property_type) ? pd.property_type : "OTHER") as LeaseData["propertyType"];
  const assetName = (Array.isArray(pd.assets) ? pd.assets[0]?.name : (pd.assets as { name: string } | null)?.name) ?? "";
  const lessors = (owners ?? []).filter((o) => !o.end_date).map((o) => {
    const p = (people ?? []).find((x) => x.id === o.person_id);
    return { name: p?.full_name_th ? `${p.title_prefix ?? ""}${p.full_name_th}` : (o.person_name as string), address: (p?.address as string | null) ?? null };
  });
  const rent = Number(l.rent_amount);
  // ทำที่: ที่อยู่ผู้ให้เช่าที่เลือก (ค่าเริ่มต้น = เจ้าของคนแรก) / ที่อยู่กิจการ / พิมพ์เอง
  const placePerson = (people ?? []).find((x) => x.id === l.contract_place_person_id);
  const place = l.contract_place_type === "LESSOR" ? (placePerson?.address as string | null) ?? null
    : l.contract_place_type === "BUSINESS" ? (biz?.address ?? biz?.company_name ?? null)
    : l.contract_place_type === "TEXT" ? l.contract_place_text : null;
  const tenantJuristic = l.tenant_type === "JURISTIC";
  const d: LeaseData = {
    propertyType: type, propertyName: assetName, address: pd.address, unit: l.unit_label,
    houseNo: pd.house_no, unitNo: pd.unit_no, floorNo: pd.floor_no, buildingName: pd.building_name,
    tenantJuristic, tenantId: (tenantId as string | null) ?? (l.tenant_id_last4 ? `•••••••••${l.tenant_id_last4}` : null),
    tenantAddress: l.tenant_address, tenantPhone: l.tenant_phone, signatory: l.tenant_signatory,
    noticeDays: l.notice_days, lateFee: l.late_return_fee_per_day == null ? null : Number(l.late_return_fee_per_day),
    witnesses: [l.witness1_name, l.witness2_name],
    handover: (hand ?? []).map((h) => ({ type: h.item_type, name: h.name, qty: Number(h.qty), brand: h.brand, serial: h.serial_no,
      condition: h.in_condition, reading: h.in_reading == null ? null : Number(h.in_reading) })),
    deeds: lands.map((x) => ({ titleType: x.title_type, deedNo: x.title_deed_no, landNo: x.land_no, book: x.deed_book, page: x.deed_page,
      areaSqWa: x.land_area_sq_wa == null ? null : Number(x.land_area_sq_wa) })),
    buildingSqm: sqm > 0 ? sqm : null, landSqWa: pd.land_area_sq_wa == null ? null : Number(pd.land_area_sq_wa),
    contractNo: l.contract_no, startDate: l.start_date, endDate: l.end_date, currency: l.rent_currency,
    tenant: l.tenant_name, lessors, rent, frequency: l.payment_frequency, dueDay: l.payment_due_day, prorate: l.prorate_basis,
    timing: l.rent_timing ?? "ADVANCE", graceDays: Number(l.grace_days ?? 0),
    rentLateFee: l.late_fee_per_day == null ? null : Number(l.late_fee_per_day),
    deposit: l.security_deposit == null || Number(l.security_deposit) <= 0 ? null : Number(l.security_deposit),
    utilities: l.utilities_billing,
    bank: bank ? { name: bank.bank_name, accountName: bank.account_name, accountNo } : null,
    lines: ((sched ?? []) as { no: number; due_date: string; cycle_start: string; cycle_end: string; expected_amount: number }[])
      .map((x) => ({ no: x.no, due: x.due_date, from: x.cycle_start, to: x.cycle_end, amount: Number(x.expected_amount) })),
  };

  const warn: string[] = [];
  if (lessors.length === 0) warn.push("ยังไม่ได้ระบุเจ้าของทรัพย์สิน — ช่องผู้ให้เช่าจะเว้นว่าง");
  if (lessors.some((x) => !x.address)) warn.push("สมาชิกบางคนยังไม่มีที่อยู่ในหน้า Family — ช่องที่อยู่จะเว้นเส้นให้เขียนเอง");
  if (!l.tenant_address || !l.tenant_id_last4) warn.push("ยังไม่ได้กรอกเลขบัตร / ที่อยู่ผู้เช่า — กดที่การ์ดสัญญาในหน้าทรัพย์สินเพื่อแก้ไขสัญญา (ว่าง = เว้นเส้นให้เขียนเอง)");
  if (l.tenant_id_last4 && !tenantId) warn.push("เลขบัตร / ทะเบียนผู้เช่าแสดงเต็มเฉพาะ ADMIN / EDITOR — สิทธิ์ของคุณเห็น 4 ตัวท้าย");
  if (l.contract_place_type === "LESSOR" && !place) warn.push("ผู้ให้เช่าที่เลือกเป็นสถานที่ทำสัญญายังไม่มีที่อยู่ในหน้า Family — ช่อง \"ทำที่\" จะเว้นเส้น");
  if (termMonths(l.start_date, l.end_date) > 36) warn.push("สัญญาเกิน 3 ปี ต้องจดทะเบียนการเช่าที่สำนักงานที่ดิน (ไม่จดทะเบียน ฟ้องบังคับได้เพียง 3 ปี)");
  if (!d.lines.length) warn.push("ความถี่ค่าเช่าเป็น \"อื่น ๆ\" — ระบบสร้างตารางค่าเช่าไม่ได้ ข้อค่าเช่าเว้นเส้นให้เขียนกำหนดชำระเอง");
  warn.push(`ร่าง${TITLE[type]}จากแบบมาตรฐานทั่วไป ไม่ใช่คำปรึกษากฎหมาย — ควรให้ทนายตรวจข้อความก่อนใช้จริง · ช่องเส้นประให้เขียนด้วยมือ`);

  type CoLine = { period: string; from: string | null; to: string | null; expected: number; received: number; unpaid: number; over: number };
  const coLines = (co?.lines ?? {}) as { rent?: CoLine[]; charges?: { description: string; amount: number }[] };
  const c: CloseoutData | null = co ? {
    moveOut: co.move_out_date, settled: co.settled_date, deposit: Number(co.deposit_held), unpaid: Number(co.unpaid_rent),
    utilities: Number(co.utilities), damage: Number(co.damage), damageReason: co.damage_reason, forfeit: Number(co.forfeit),
    forfeitReason: co.forfeit_reason, depositRefund: Number(co.deposit_refund), advanceRefund: Number(co.advance_refund), net: Number(co.net_transfer),
    shortfall: Number(co.shortfall ?? 0), tenantPaid: Number(co.tenant_paid ?? 0), owedPending: Number(co.owed_pending ?? 0),
    rent: (coLines.rent ?? []).map((x) => ({ ...x, expected: Number(x.expected), received: Number(x.received), unpaid: Number(x.unpaid), over: Number(x.over) })),
    charges: (coLines.charges ?? []).map((x) => ({ description: x.description, amount: Number(x.amount) })),
  } : null;
  // ?s=closeout (ปุ่ม "พิมพ์ใบสรุปผู้เช่าออก") → เลือกเฉพาะใบสรุปไว้ให้
  const onlyClose = only === "closeout" && !!c;
  const sections: PrintSection[] = [
    { key: "contract", label: TITLE[type], on: !onlyClose, node: <LeaseContract d={d} place={place} signDate={l.start_date} /> },
    ...(d.lines.length ? [{ key: "rent", label: "ตารางค่าเช่า (แนบท้าย)", on: !onlyClose, node: <RentAnnex d={d} /> }] : []),
    { key: "handover", label: type === "LAND" ? "บันทึกสภาพที่ดิน (แนบท้าย)" : "บัญชีทรัพย์สิน / สภาพ (แนบท้าย)", on: !onlyClose, node: <HandoverAnnex d={d} /> },
    ...(c ? [{ key: "closeout", label: "ใบสรุปผู้เช่าออก / คืนเงินประกัน", on: onlyClose, node: <CloseoutSummary d={d} c={c} /> }] : []),
  ];
  return <PrintShell back={`/property/${pd.asset_id}`} sections={sections} warn={warn} />;
}
