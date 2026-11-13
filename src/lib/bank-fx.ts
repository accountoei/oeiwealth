import { ratesAt, type RateAt } from "@/lib/net-invested";

/** ส่วนต่างค่าเงินของเงินฝากสกุลอื่นในเดือน (ตกลง 13 พ.ย. 2026) — หน้า Bank Accounts กล่องแรก + pop up Dashboard "อื่น ๆ"
 *  = ยอดสิ้นเดือนก่อน (สกุลเดิม · ตามสัดส่วนถือ) × (อัตรา ณ ปลายงวด − อัตราสิ้นเดือนก่อน)
 *  อัตรา = MID_AVERAGE ล่าสุดถึงวันนั้น (กติกาเดียวกับ private.fx_rate_row ที่ Dashboard ใช้คิดยอดสิ้นเดือน) · ดึงอัตราตั้งแต่ 14 วันก่อนสิ้นเดือนก่อน
 *  เงินเข้า–ออกระหว่างเดือนคิดด้วยอัตราปลายงวดอยู่แล้ว → ไม่มีส่วนต่างค่าเงิน */
export function bankFx(prevBalances: { currency: string; amount: number }[], rates: RateAt[], prevEnd: string, asOf: string): number {
  const r0 = ratesAt(rates, prevEnd), r1 = ratesAt(rates, asOf);
  return prevBalances.reduce((t, b) => {
    const from = r0(b.currency), to = r1(b.currency);
    return b.currency === "THB" || b.amount <= 0 || from == null || to == null ? t : t + b.amount * (to - from);
  }, 0);
}
