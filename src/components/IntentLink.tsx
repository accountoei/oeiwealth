"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/** ต้องชี้เมาส์ค้างนานเท่านี้ก่อนโหลดหน้าล่วงหน้า (เลื่อนเมาส์ผ่านเมนูเฉย ๆ ไม่โหลด) */
const HOVER_INTENT_MS = 150;

/**
 * ลิงก์เมนูซ้าย / แท็บ (30 ต.ค. 2026): ชี้เมาส์ค้าง 0.15 วินาที หรือแตะบนมือถือ → โหลดข้อมูลหน้านั้นล่วงหน้าทั้งหน้า
 * - เลื่อนเมาส์ผ่านหลายเมนู / เปิดหน้าที่มีแถบแท็บ → ไม่สั่งโหลดหลายหน้าพร้อมกัน (เดิมแย่ง Supabase แผนฟรีกับหน้าที่กำลังเปิดจริง)
 * - ไม่ได้ชี้ค้าง → ใช้การโหลดล่วงหน้าปกติของ Next.js (โครงหน้า loading.tsx) · กดแล้วโหลดข้อมูลตามปกติ
 * - ใช้ router.prefetch แบบ FULL เพราะ unstable_dynamicOnHover ทำงานเฉพาะเมื่อเปิด experimental.dynamicOnHover (เดิมไม่ได้เปิด)
 */
export default function IntentLink({ href, onMouseEnter, onMouseLeave, onTouchStart, ...rest }:
  Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const target = href.split("#")[0];
  // หน้าที่เปิดอยู่แล้วไม่ต้องโหลดซ้ำ
  const prefetchFull = () => { if (target !== pathname) router.prefetch(target, { kind: PrefetchKind.FULL }); };
  return (
    <Link href={href} {...rest}
      onMouseEnter={(e) => { onMouseEnter?.(e); clearTimeout(timer.current); timer.current = setTimeout(prefetchFull, HOVER_INTENT_MS); }}
      onMouseLeave={(e) => { onMouseLeave?.(e); clearTimeout(timer.current); }}
      onTouchStart={(e) => { onTouchStart?.(e); prefetchFull(); }} />
  );
}
