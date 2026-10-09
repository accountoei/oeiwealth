// แสดงทันทีที่คลิกเมนู / ลิงก์ ระหว่างรอข้อมูลจาก Server (เมนูด้านซ้ายยังอยู่ ไม่กระพริบ)
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">กำลังโหลด…</span>
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="h-3 w-20 rounded bg-slate-100" />
            <div className="mt-3 h-6 w-32 rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="h-4 w-1/3 rounded bg-slate-100" />
            <div className="h-4 w-24 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
