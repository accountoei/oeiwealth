import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // จำหน้าที่เพิ่งเปิดไว้ในเบราว์เซอร์ 30 วินาที → กดกลับไปหน้าเดิมขึ้นทันที ไม่ต้องโหลดใหม่
    // ข้อมูลที่ผู้ใช้เพิ่งบันทึกยังอัปเดตทันที (server action เรียก revalidatePath ซึ่งล้างความจำนี้ให้)
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
