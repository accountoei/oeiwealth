import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { PROPERTY_TYPE_LABEL, USAGE_LABEL, landText, todayBangkok } from "@/lib/format";
import { COMPONENT_FIELDS, COMP_TYPE_LABEL, compName, type Component } from "@/app/(app)/property/components";
import PropertyPrintView, { type PrintPlot } from "./print-view";

// absolute = ไม่ต่อท้ายชื่อระบบ (ชื่อนี้เป็นชื่อไฟล์ตอนบันทึกเป็น PDF)
export const metadata = { title: { absolute: "พิมพ์ทรัพย์สินพร้อมแผนที่" } };

const STATUS: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย / เสียหาย", CLOSED: "ปิดแล้ว" };

/**
 * พิมพ์ / PDF ทรัพย์สินพร้อมแผนที่ (ตกลง 10 พ.ย. 2026) — ขนาด A4
 *   ?ids=<asset_id,…> ตามลำดับที่ส่งมา (หน้ารวมส่งตามตัวกรอง · หน้าแปลงส่ง 1 รายการ) · ?title= หัวกระดาษ (เช่น กลุ่มทำเล) · ?back= ลิงก์กลับ
 *   หลายแปลง: หน้าแรก = แผนที่รวม + ตารางสรุป · ตามด้วยหน้าละ 1 แปลง (รูปดาวเทียมพร้อมชื่อสถานที่ + รายละเอียด)
 *   มูลค่า (ราคาที่ได้มา / มูลค่าล่าสุด) ซ่อนไว้ก่อน ติ๊ก "แสดงมูลค่า" ในแถบบนถ้าต้องการ (ส่งให้นายหน้า / ช่างได้โดยไม่มีตัวเลข)
 */
export default async function PrintPropertyPage({ searchParams }: { searchParams: Promise<{ ids?: string; title?: string; back?: string }> }) {
  const sp = await searchParams;
  await requireAppUser();
  const ids = [...new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, 300);
  const supabase = await createClient();
  type Row = {
    asset_id: string; property_type: string; usage_type: string; location_group: string | null; land_area_sq_wa: number | null;
    latitude: number | null; longitude: number | null; address: string | null; house_no: string | null; unit_no: string | null; floor_no: string | null;
    building_name: string | null; subdistrict: string | null; district: string | null; province: string | null;
    assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string;
      acquisition_cost: number | null; acquisition_date: string | null; notes: string | null };
    property_deeds: (Component & { deleted_at: string | null; sort_order: number | null; created_at: string })[];
  };
  const [{ data }, { data: owners }] = ids.length ? await Promise.all([
    supabase.from("property_details")
      .select(`asset_id,property_type,usage_type,location_group,land_area_sq_wa,latitude,longitude,address,house_no,unit_no,floor_no,building_name,subdistrict,district,province,
        assets!inner(name,currency,current_value,current_value_date,status,acquisition_cost,acquisition_date,notes,deleted_at),property_deeds(${COMPONENT_FIELDS})`)
      .in("asset_id", ids).is("deleted_at", null).is("assets.deleted_at", null),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_name,ownership_percent,end_date").in("asset_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.asset_id, r]));
  const plots: PrintPlot[] = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r).map((r) => {
    const comps = (r.property_deeds ?? []).filter((c) => !c.deleted_at && !c.ended_date)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at));
    let landIdx = 0;
    return {
      id: r.asset_id, name: r.assets.name, typeLabel: PROPERTY_TYPE_LABEL[r.property_type] ?? r.property_type,
      usage: r.usage_type, usageLabel: USAGE_LABEL[r.usage_type] ?? r.usage_type, status: STATUS[r.assets.status] ?? r.assets.status,
      group: r.location_group, area: r.land_area_sq_wa != null ? landText(r.land_area_sq_wa) : null,
      place: [r.subdistrict, r.district, r.province].filter(Boolean).join(" · ") || null,
      address: r.address, unit: r.unit_no ? [`เลขที่ ${r.unit_no}`, r.floor_no && `ชั้น ${r.floor_no}`, r.building_name].filter(Boolean).join(" · ") : null,
      houseNo: r.house_no,
      geo: r.latitude != null && r.longitude != null ? { lat: Number(r.latitude), lng: Number(r.longitude) } : null,
      owners: (owners ?? []).filter((o) => o.asset_id === r.asset_id && !o.end_date)
        .sort((a, b) => Number(b.ownership_percent) - Number(a.ownership_percent))
        .map((o) => `${o.person_name} · ${Number(o.ownership_percent)}%`),
      acquired: r.assets.acquisition_date, notes: r.assets.notes,
      cost: r.assets.acquisition_cost != null ? Number(r.assets.acquisition_cost) : null,
      value: r.assets.current_value != null ? Number(r.assets.current_value) : null, valueDate: r.assets.current_value_date, currency: r.assets.currency,
      comps: comps.map((c) => ({
        name: compName(c, c.component_type === "LAND" ? landIdx++ : 0), kind: COMP_TYPE_LABEL[c.component_type],
        detail: (c.component_type === "LAND"
          ? [c.land_no && `เลขที่ดิน ${c.land_no}`, c.deed_book && `เล่ม ${c.deed_book}`, c.deed_page && `หน้า ${c.deed_page}`, c.map_sheet && `ระวาง ${c.map_sheet}`,
            c.survey_page && `หน้าสำรวจ ${c.survey_page}`]
          : []).filter(Boolean).join(" · "),
        area: c.component_type === "LAND" ? (c.land_area_sq_wa != null ? landText(c.land_area_sq_wa) : null)
          : c.building_area_sqm != null ? `${Number(c.building_area_sqm).toLocaleString("en-US")} ตร.ม.` : null,
      })),
    };
  });
  const back = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/property";
  return <PropertyPrintView plots={plots} title={(sp.title ?? "").slice(0, 80)} back={back} today={todayBangkok()} missing={ids.length - plots.length} />;
}
