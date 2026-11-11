import type { NextConfig } from "next";

// Header ความปลอดภัยทุกหน้า (Modern Web Guidance · security.md · 11 พ.ย. 2026)
//   frame-ancestors / X-Frame-Options: เว็บอื่นเอาหน้าแอปไปฝังใน iframe ไม่ได้ (กันหลอกให้กดปุ่มทับ = clickjacking)
//     ใช้ 'self' ไม่ใช่ 'none': หน้าเปิดเอกสาร (/view) แสดงไฟล์ใน iframe ของแอปเอง
//   CSP มีแค่ frame-ancestors: ยังไม่จำกัด script / รูป / แผนที่ (CSP เต็มรูปแบบต้องทดลองแบบ report-only ก่อน)
//   Referrer-Policy = ค่าเริ่มต้นของ browser ปัจจุบัน (ส่งแค่ชื่อเว็บไปเว็บอื่น) · คีย์แผนที่ Esri ที่จำกัดตามชื่อเว็บยังใช้ได้
//   Permissions-Policy: ปิดไมค์ / ตำแหน่ง / จ่ายเงิน / USB ที่แอปไม่ได้ใช้ · ไม่ปิดกล้อง (ถ่ายรูปเอกสารจาก iPad)
//   HSTS ไม่ต้องใส่: โดเมน .app บังคับ https ใน browser อยู่แล้ว (HSTS preload ทั้งโดเมน)
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // จำหน้าที่เพิ่งเปิดไว้ในเบราว์เซอร์ 30 วินาที → กดกลับไปหน้าเดิมขึ้นทันที ไม่ต้องโหลดใหม่
    // ข้อมูลที่ผู้ใช้เพิ่งบันทึกยังอัปเดตทันที (server action เรียก revalidatePath ซึ่งล้างความจำนี้ให้)
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
