/** ส่วนประกอบของทรัพย์สิน (ตกลง 29 ต.ค. 2026): ที่ดิน (โฉนด) · อาคาร · สิ่งปลูกสร้างอื่น — ใช้ทั้งฝั่งหน้าจอและ server action
 *  ตาราง property_deeds (component_type) · มูลค่าแต่ละแถว = asset_valuation_parts.deed_id · Net Worth ใช้ยอดรวม */
export type CompType = "LAND" | "BUILDING" | "OTHER";

export type Component = {
  id: string; component_type: CompType; label: string | null;
  title_type: string | null; title_deed_no: string | null; land_no: string | null; deed_book: string | null; deed_page: string | null;
  map_sheet: string | null; survey_page: string | null; land_area_sq_wa: number | null;
  building_area_sqm: number | null; useful_life_years: number | null; acquired_date: string | null; acq_cost: number | null; notes: string | null;
  /** ขาย / รื้อถอนแล้ว (ตกลง 29 ต.ค. 2026) · ยังอยู่ในประวัติ ไม่นับในเนื้อที่ / ต้นทุน / มูลค่า */
  ended_date: string | null; end_reason: "SOLD" | "DEMOLISHED" | null; end_event_id: string | null;
};

export const COMPONENT_FIELDS = "id,sort_order,component_type,label,title_type,title_deed_no,land_no,deed_book,deed_page,map_sheet,survey_page,land_area_sq_wa,building_area_sqm,useful_life_years,acquired_date,acq_cost,notes,ended_date,end_reason,end_event_id,created_at,deleted_at";

export const END_REASON_LABEL: Record<"SOLD" | "DEMOLISHED", string> = { SOLD: "ขายแล้ว", DEMOLISHED: "รื้อถอนแล้ว" };

export const COMP_TYPE_LABEL: Record<CompType, string> = { LAND: "ที่ดิน", BUILDING: "อาคาร", OTHER: "สิ่งปลูกสร้างอื่น" };

/** ชื่อที่แสดงของแต่ละแถว */
export function compName(c: Pick<Component, "component_type" | "label" | "title_type" | "title_deed_no" | "land_no">, i = 0): string {
  if (c.component_type !== "LAND") return c.label || COMP_TYPE_LABEL[c.component_type];
  return c.label || [c.title_type, c.title_deed_no && `เลขที่ ${c.title_deed_no}`].filter(Boolean).join(" ")
    || (c.land_no ? `ที่ดินเลขที่ ${c.land_no}` : `ที่ดินแปลงที่ ${i + 1}`);
}

/** แถวที่ส่งให้ save_property_components (ตัวเลขเป็นข้อความไม่มีจุลภาค · ว่าง = "") */
export type CompInput = {
  id?: string; type: CompType; label: string; title_type: string; title_deed_no: string; land_no: string; deed_book: string; deed_page: string;
  map_sheet: string; survey_page: string; land_area_sq_wa: string; building_area_sqm: string; useful_life_years: string;
  acquired_date: string; acq_cost: string; notes: string; value?: string;
};
