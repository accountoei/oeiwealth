import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { searchFull, type SearchHit } from "@/lib/search";
import { PageInfo } from "@/components/HeaderBar";

/** หน้า "ผลการค้นหา" (กด Enter ในช่องค้นหาด้านบน · ตกลง 30 ต.ค. 2026): ค้นทุกข้อมูลที่มีชื่อ / หมายเหตุ เรียงเป็นกลุ่มลงมา */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  await requireAppUser();
  const q = (sp.q ?? "").trim();
  const hits = q.length >= 2 ? await searchFull(q) : [];
  const groups: [string, SearchHit[]][] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && last[0] === h.group) last[1].push(h); else groups.push([h.group, [h]]);
  }
  return (
    <div className="space-y-6">
      <PageInfo>ค้นจากชื่อ เลขที่ รายละเอียด และหมายเหตุของทุกข้อมูล รวมถึงรายการเงิน (คำอธิบาย / ยอดเงิน) · แสดงเฉพาะข้อมูลที่คุณมีสิทธิ์ดู</PageInfo>
      <form action="/search" className="flex max-w-xl gap-2">
        <input name="q" defaultValue={q} data-plain autoFocus={!q} placeholder="ค้นหาข้อมูลในระบบ…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">ค้นหา</button>
      </form>
      {q.length < 2 ? <p className="text-sm text-slate-500">พิมพ์อย่างน้อย 2 ตัวอักษร</p>
        : hits.length === 0 ? <p className="text-sm text-slate-500">ไม่พบ &ldquo;{q}&rdquo;</p> : (
        <>
          <p className="text-sm text-slate-500">พบ {hits.length} รายการ สำหรับ &ldquo;{q}&rdquo;</p>
          {groups.map(([g, list]) => (
            <section key={g} className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-900">{g} <span className="font-normal text-slate-500">({list.length})</span></h2>
              <ul className="divide-y divide-slate-100">
                {list.map((h, i) => (
                  <li key={`${h.href}-${i}`}>
                    <Link href={h.href} className="flex items-baseline justify-between gap-4 px-5 py-2 text-sm hover:bg-blue-50">
                      <span className="min-w-0 text-slate-800">{h.label}</span>
                      {h.sub && <span className="shrink-0 text-right text-xs text-slate-500">{h.sub}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
