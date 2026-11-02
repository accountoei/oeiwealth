import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import PrintShell, { type PrintSection } from "../../loan/[id]/print-shell";
import { HandoverAnnex, LeaseContract, RentAnnex, rentLines, termMonths, TITLE, type LeaseData } from "./contract";

export const metadata = { title: "พิมพ์สัญญาเช่า" };

/**
 * หน้าพิมพ์สัญญาเช่า (นอกเมนูหลัก · ขนาด A4 · ตกลง 2 พ.ย. 2026) — แบบเดียวกับหน้าพิมพ์สัญญาเงินให้กู้
 *   1) สัญญาเช่า แยกแบบตามประเภททรัพย์สิน 2) ตารางค่าเช่าแนบท้าย 3) บัญชีทรัพย์สิน / สภาพ ณ วันส่งมอบ
 *   ผู้ให้เช่า = เจ้าของตามสัดส่วนความเป็นเจ้าของ (ชื่อเต็ม + ที่อยู่จากหน้า Family) · ข้อมูลผู้เช่านอกจากชื่อ เว้นเส้นให้เขียนเอง
 *   เลขบัญชีรับค่าเช่าเต็มเฉพาะ ADMIN / EDITOR (ฐานข้อมูลตรวจซ้ำ · บันทึก Audit)
 */
export default async function PrintLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canReveal = me.role === "ADMIN" || me.role === "EDITOR";
  const { data: l } = await supabase.from("property_leases")
    .select("id,property_id,unit_label,tenant_name,contract_no,start_date,end_date,rent_amount,rent_currency,payment_frequency,payment_due_day,security_deposit,utilities_billing,rent_to_asset_id")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (!l) notFound();
  const { data: pd } = await supabase.from("property_details").select("id,asset_id,property_type,address,land_area_sq_wa,assets!inner(name)")
    .eq("id", l.property_id).maybeSingle();
  if (!pd) notFound();
  const [{ data: deeds }, { data: owners }, { data: people }, { data: banks }] = await Promise.all([
    supabase.from("property_deeds").select("component_type,title_type,title_deed_no,land_no,deed_book,deed_page,land_area_sq_wa,building_area_sqm,sort_order")
      .eq("property_id", pd.id).is("deleted_at", null).order("sort_order"),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,end_date").eq("asset_id", pd.asset_id),
    supabase.from("persons").select("id,title_prefix,full_name_th,address").is("deleted_at", null),
    supabase.from("v_bank_accounts_safe").select("id,asset_id,bank_name,account_name,account_no_masked"),
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
  const d: LeaseData = {
    propertyType: type, propertyName: assetName, address: pd.address, unit: l.unit_label,
    deeds: lands.map((x) => ({ titleType: x.title_type, deedNo: x.title_deed_no, landNo: x.land_no, book: x.deed_book, page: x.deed_page,
      areaSqWa: x.land_area_sq_wa == null ? null : Number(x.land_area_sq_wa) })),
    buildingSqm: sqm > 0 ? sqm : null, landSqWa: pd.land_area_sq_wa == null ? null : Number(pd.land_area_sq_wa),
    contractNo: l.contract_no, startDate: l.start_date, endDate: l.end_date, currency: l.rent_currency,
    tenant: l.tenant_name, lessors, rent, frequency: l.payment_frequency, dueDay: l.payment_due_day,
    deposit: l.security_deposit == null || Number(l.security_deposit) <= 0 ? null : Number(l.security_deposit),
    utilities: l.utilities_billing,
    bank: bank ? { name: bank.bank_name, accountName: bank.account_name, accountNo } : null,
    lines: rentLines(l.start_date, l.end_date, l.payment_frequency, l.payment_due_day, rent),
  };

  const warn: string[] = [];
  if (lessors.length === 0) warn.push("ยังไม่ได้ระบุเจ้าของทรัพย์สิน — ช่องผู้ให้เช่าจะเว้นว่าง");
  if (lessors.some((x) => !x.address)) warn.push("สมาชิกบางคนยังไม่มีที่อยู่ในหน้า Family — ช่องที่อยู่จะเว้นเส้นให้เขียนเอง");
  if (termMonths(l.start_date, l.end_date) > 36) warn.push("สัญญาเกิน 3 ปี ต้องจดทะเบียนการเช่าที่สำนักงานที่ดิน (ไม่จดทะเบียน ฟ้องบังคับได้เพียง 3 ปี)");
  if (!d.lines.length) warn.push("ความถี่ค่าเช่าเป็น \"อื่น ๆ\" — ระบบสร้างตารางค่าเช่าไม่ได้ ข้อค่าเช่าเว้นเส้นให้เขียนกำหนดชำระเอง");
  warn.push(`ร่าง${TITLE[type]}จากแบบมาตรฐานทั่วไป ไม่ใช่คำปรึกษากฎหมาย — ควรให้ทนายตรวจข้อความก่อนใช้จริง · ช่องเส้นประให้เขียนด้วยมือ`);

  const sections: PrintSection[] = [
    { key: "contract", label: TITLE[type], on: true, node: <LeaseContract d={d} place={null} signDate={l.start_date} /> },
    ...(d.lines.length ? [{ key: "rent", label: "ตารางค่าเช่า (แนบท้าย)", on: true, node: <RentAnnex d={d} /> }] : []),
    { key: "handover", label: type === "LAND" ? "บันทึกสภาพที่ดิน (แนบท้าย)" : "บัญชีทรัพย์สิน / สภาพ (แนบท้าย)", on: true, node: <HandoverAnnex d={d} /> },
  ];
  return <PrintShell back={`/property/${pd.asset_id}`} sections={sections} warn={warn} />;
}
