import SearchBox from "./SearchBox";
import HeaderActions, { type TodoCount } from "./HeaderActions";
import { HEADER_INFO_ID, HEADER_SLOT_ID, HeaderTitle, PendingBar } from "./HeaderBar";
import { HeaderHeightVar } from "./BatchSave";

/**
 * แถบบน (ตกลง 2 พ.ย. 2026): ชื่อเมนู (กว้างคงที่) · ช่องค้นหาชิดซ้าย เริ่มที่เดิมทุกหน้า · คน / เดือนของหน้า (HeaderFilters) · กระดิ่ง To-Do + ผู้ใช้ ขวาสุด
 *   แถบบนกว้าง ≥ 58.5rem (936px · จอ 1280 ที่แถบซ้ายกว้างปกติ รวมแถบเลื่อน Windows) = แถวเดียว · แคบกว่านั้น = คน / เดือนขึ้นบรรทัดที่สอง (ชิดขวา)
 *   ช่องชื่อเมนูกว้าง 13.5rem = พอดีชื่อที่ยาวที่สุด (เดิม Cash & Bank Accounts + ⓘ · 4 พ.ย. 2026 เปลี่ยนเป็น Bank Accounts → ชื่อยาวสุดตอนนี้สั้นกว่านี้) · แถบบนแคบ (< 40rem) = 12rem ตัวเล็กลง
 *   ช่องค้นหากว้างตามความกว้างแถบบนเท่านั้น (ไม่ขึ้นกับตัวเลือกของหน้า) → ขอบซ้าย / ขวาอยู่ที่เดิมทุกหน้า
 *   มือถือ: ช่องค้นหาเป็นปุ่มแว่นขยาย · เว้นที่ซ้ายให้ปุ่ม ☰ · คน / เดือนบรรทัดที่สองใช้เต็มความกว้าง
 *   ขนาดดูจากความกว้างของแถบบนเอง (@container) ไม่ใช่ขนาดจอ → ยุบ / ยืดแถบซ้ายแล้วจัดใหม่ถูกเอง
 */
export default function AppHeader({ todo, user }: { todo: Promise<TodoCount | null>; user: { name: string; email: string; role: string } }) {
  return (
    <header className="@container sticky top-0 z-10 border-b border-slate-200 bg-white/90 py-2 pl-[6.5rem] pr-3 backdrop-blur md:px-8">
      <div className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-2 md:gap-x-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 md:w-48 md:flex-none @min-[40rem]:w-[13.5rem]">
          <HeaderTitle /><span id={HEADER_INFO_ID} className="inline-flex shrink-0" />
        </div>
        <div className="contents md:block md:min-w-0 md:max-w-md md:flex-1 @min-[58.5rem]:w-[clamp(13rem,calc(100cqw-45.5rem),28rem)] @min-[58.5rem]:flex-none">
          <SearchBox />
        </div>
        <div className="contents @min-[58.5rem]:ml-auto @min-[58.5rem]:flex @min-[58.5rem]:items-center @min-[58.5rem]:gap-3">
          <div id={HEADER_SLOT_ID} className="order-last -ml-[5.75rem] flex basis-[calc(100%+5.75rem)] justify-end empty:hidden md:ml-0 md:basis-full @min-[58.5rem]:order-none @min-[58.5rem]:basis-auto" />
          <HeaderActions todo={todo} user={user} className="ml-auto @min-[58.5rem]:ml-0" />
        </div>
      </div>
      <PendingBar />
      <HeaderHeightVar />
    </header>
  );
}
