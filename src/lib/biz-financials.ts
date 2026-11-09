// ผลประกอบการ Private Business (ตกลง 9 พ.ย. 2026) — คำนวณค่าที่แสดง จากแถว business_financial_years
//   ตัวเลขทั้งบริษัท 100% · ปี ค.ศ. (แสดงเป็น พ.ศ.) · กำไรสะสม = กำไรรวมทุกปีที่บันทึก − ปันผลที่บริษัทจ่ายรวม

export type FinYear = {
  id: string; asset_id: string | null; past_business_id: string | null; fiscal_year: number;
  revenue_domestic: number | null; revenue_foreign: number | null; employees: number | null; executives: number | null;
  corporate_tax: number | null; net_profit: number | null; dividends_paid: number | null; equity: number | null;
  land_value: number | null; building_cost: number | null; building_depreciation: number | null;
  equipment_cost: number | null; equipment_depreciation: number | null;
  audit_status: string; notes: string | null;
};

export const FIN_COLS = "id,asset_id,past_business_id,fiscal_year,revenue_domestic,revenue_foreign,employees,executives,corporate_tax,net_profit,dividends_paid,equity,"
  + "land_value,building_cost,building_depreciation,equipment_cost,equipment_depreciation,audit_status,notes";

export const AUDIT_LABEL: Record<string, string> = { AUDITED: "ตรวจสอบแล้ว", PRE_AUDIT: "Pre-audit", ESTIMATE: "ประมาณการ" };

const numKeys = ["revenue_domestic", "revenue_foreign", "employees", "executives", "corporate_tax", "net_profit", "dividends_paid", "equity",
  "land_value", "building_cost", "building_depreciation", "equipment_cost", "equipment_depreciation"] as const;

/** แปลงแถวจาก Supabase (numeric มาเป็น string) → number */
export function toFinYears(rows: unknown[] | null | undefined): FinYear[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => {
    const o = { ...r } as Record<string, unknown>;
    for (const k of numKeys) o[k] = r[k] == null ? null : Number(r[k]);
    o.fiscal_year = Number(r.fiscal_year);
    return o as unknown as FinYear;
  });
}

export type FinCalc = FinYear & {
  revenue: number; foreignPct: number | null; growthPct: number | null; marginPct: number | null;
  retained: number; staff: number | null; revPerHead: number | null;
  buildingNet: number | null; equipmentNet: number | null; fixedCost: number | null; fixedDep: number | null; fixedNet: number | null;
  hasFixed: boolean;
};

const z = (v: number | null) => v ?? 0;
const pct = (a: number, b: number) => (b ? (a * 100) / b : null);

/** เรียงปีน้อย → มาก แล้วคำนวณค่าต่อปี (%โต เทียบปีก่อนหน้าที่มีข้อมูล · กำไรสะสมถึงปีนั้น) */
export function calcYears(rows: FinYear[]): FinCalc[] {
  const list = [...rows].sort((a, b) => a.fiscal_year - b.fiscal_year);
  let cum = 0;
  let prevRev: number | null = null;
  return list.map((r) => {
    const revenue = z(r.revenue_domestic) + z(r.revenue_foreign);
    cum += z(r.net_profit) - z(r.dividends_paid);
    const growthPct = prevRev != null && prevRev > 0 ? ((revenue - prevRev) * 100) / prevRev : null;
    prevRev = revenue;
    const hasFixed = [r.land_value, r.building_cost, r.building_depreciation, r.equipment_cost, r.equipment_depreciation].some((v) => v != null);
    const buildingNet = r.building_cost == null && r.building_depreciation == null ? null : z(r.building_cost) - z(r.building_depreciation);
    const equipmentNet = r.equipment_cost == null && r.equipment_depreciation == null ? null : z(r.equipment_cost) - z(r.equipment_depreciation);
    const fixedCost = hasFixed ? z(r.land_value) + z(r.building_cost) + z(r.equipment_cost) : null;
    const fixedDep = hasFixed ? z(r.building_depreciation) + z(r.equipment_depreciation) : null;
    return {
      ...r, revenue, foreignPct: pct(z(r.revenue_foreign), revenue), growthPct,
      marginPct: r.net_profit == null ? null : pct(r.net_profit, revenue),
      retained: cum,
      staff: r.employees == null ? null : r.employees - z(r.executives),
      revPerHead: r.employees ? revenue / r.employees : null,
      buildingNet, equipmentNet, fixedCost, fixedDep, fixedNet: fixedCost == null ? null : fixedCost - z(fixedDep), hasFixed,
    };
  });
}

/** รวมทั้งกลุ่มต่อปี (GRAND TOTAL): รวมทุกบริษัทที่มีข้อมูลปีนั้น · กำไรสะสมกลุ่ม = กำไรรวม − ปันผลรวม ถึงปีนั้น */
export function groupYears(rows: FinYear[]): FinCalc[] {
  const byYear = new Map<number, FinYear[]>();
  rows.forEach((r) => byYear.set(r.fiscal_year, [...(byYear.get(r.fiscal_year) ?? []), r]));
  const sum = (xs: FinYear[], k: (typeof numKeys)[number]) => (xs.some((x) => x[k] != null) ? xs.reduce((t, x) => t + z(x[k]), 0) : null);
  const merged: FinYear[] = [...byYear.entries()].map(([y, xs]) => {
    const o: Record<string, unknown> = { id: `g${y}`, asset_id: null, past_business_id: null, fiscal_year: y, audit_status: "AUDITED", notes: null };
    for (const k of numKeys) o[k] = sum(xs, k);
    o.audit_status = xs.some((x) => x.audit_status !== "AUDITED") ? "PRE_AUDIT" : "AUDITED";
    return o as unknown as FinYear;
  });
  return calcYears(merged);
}
