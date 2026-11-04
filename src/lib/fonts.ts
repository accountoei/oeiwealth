/**
 * แบบอักษรที่ผู้ใช้เลือกได้ (ตกลง 4 พ.ย. 2026) — เลือกที่เมนูผู้ใช้มุมขวาบน › การแสดงผล · จำไว้ที่เครื่องนั้น (cookie)
 *   เกณฑ์: ตัวเลขกว้างเท่ากัน (ยอดเงินในตารางตรงหลัก) · ความกว้างไม่เกินแบบเดิม 10% → ขนาดกล่อง / คอลัมน์ที่ตั้งไว้ใช้ได้เหมือนเดิม
 *   ไฟล์ฟอนต์อยู่ในระบบเอง (@fontsource) · เบราว์เซอร์โหลดเฉพาะแบบที่เลือกจริง
 *   หน้าพิมพ์ (/print) ใช้แบบเริ่มต้นเสมอ → การขึ้นหน้าใหม่ของเอกสารไม่เปลี่ยน
 */
export const FONT_COOKIE = "fwv_font";

export const FONTS = [
  { key: "plex", label: "IBM Plex Sans Thai", note: "แบบเริ่มต้น · ไม่มีหัว", family: '"IBM Plex Sans Thai"' },
  { key: "noto-looped", label: "Noto Sans Thai Looped", note: "มีหัว · ใกล้เคียง Tahoma", family: '"Noto Sans Thai Looped"' },
  { key: "sarabun", label: "Sarabun", note: "มีหัว · แบบเอกสารราชการ", family: '"Sarabun"' },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];
export const DEFAULT_FONT: FontKey = "plex";

/** ค่าใน cookie → แบบอักษร (ค่าที่ไม่รู้จัก = แบบเริ่มต้น) */
export const fontKey = (v: string | null | undefined): FontKey =>
  FONTS.find((f) => f.key === v)?.key ?? DEFAULT_FONT;

/** ค่า --font-sans ของแบบอักษรนั้น */
export const fontStack = (key: FontKey) =>
  `${FONTS.find((f) => f.key === key)?.family ?? FONTS[0].family}, system-ui, sans-serif`;
