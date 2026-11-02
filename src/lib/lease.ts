/** สัญญาเช่า: คำนวณอายุสัญญา ↔ วันสิ้นสุด (ใช้ทั้งฟอร์มกรอกสัญญาและหน้าพิมพ์สัญญา) */

/** จำนวนเดือนเต็มของสัญญา (นับถึงวันถัดจากวันสิ้นสุด: 1 ม.ค. – 31 ธ.ค. = 12 เดือน) */
export function termMonths(start: string, end: string) {
  const e = new Date(`${end}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + 1);
  const m = (e.getUTCFullYear() - Number(start.slice(0, 4))) * 12 + e.getUTCMonth() + 1 - Number(start.slice(5, 7));
  return Math.max(e.getUTCDate() < Number(start.slice(8, 10)) ? m - 1 : m, 0);
}

/** วันสิ้นสุดจากวันเริ่ม + อายุสัญญา (เดือน): 1 ม.ค. + 12 เดือน = 31 ธ.ค. · วันที่ 31 ในเดือนสั้น → วันสุดท้ายของเดือน */
export function termEnd(start: string, months: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(months > 0)) return "";
  const y0 = Number(start.slice(0, 4)), m0 = Number(start.slice(5, 7)) - 1, d0 = Number(start.slice(8, 10));
  const mm = m0 + months, y = y0 + Math.floor(mm / 12), m = mm % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // เดือนปลายทางสั้นกว่าวันเริ่ม (31 ม.ค. + 1 เดือน) → วันสุดท้ายของเดือนนั้น
  const e = new Date(Date.UTC(y, m, Math.min(d0, last)));
  if (d0 <= last) e.setUTCDate(e.getUTCDate() - 1);
  return e.toISOString().slice(0, 10);
}

/** วันถัดไป (ต่อสัญญา: เริ่มวันถัดจากวันสิ้นสุดสัญญาเดิม) */
export function nextDay(d: string) {
  const e = new Date(`${d}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + 1);
  return e.toISOString().slice(0, 10);
}

/** ข้อความอายุสัญญา: 14 → "1 ปี 2 เดือน" */
export const termText = (months: number) => {
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} ปี` : "", m ? `${m} เดือน` : ""].filter(Boolean).join(" ") || "น้อยกว่า 1 เดือน";
};

/** ช่องรายละเอียดพิมพ์สัญญาใน property_leases (select ของหน้าทรัพย์สิน / หน้าพิมพ์) */
export const LEASE_DETAIL_FIELDS = "tenant_type,tenant_address,tenant_phone,tenant_signatory,tenant_id_last4,deposit_months,"
  + "contract_place_type,contract_place_person_id,contract_place_business_id,contract_place_text,notice_days,late_return_fee_per_day,witness1_name,witness2_name";
