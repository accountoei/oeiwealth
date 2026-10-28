import Link from "next/link";
import { PageInfo } from "@/components/HeaderBar";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getAttention } from "@/lib/attention";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";

// ย้ายมาจากหน้า Dashboard (ตกลง 27 ต.ค. 2026): เมนู "สิ่งที่ต้องทำ" → หน้านี้ 2 แท็บ · กดรายการไปแก้แล้วกด Back กลับมาที่รายการได้
const FIELD: Record<string, string> = {
  document: "เอกสาร", ownership: "เจ้าของครบ 100%", valuation: "มูลค่า", acquisition_date: "วันที่ได้มา",
  acquisition_cost: "ราคาที่ได้มา", account_no: "เลขบัญชี", title_deed_no: "เลขโฉนด", land_area_sq_wa: "เนื้อที่",
};

type Comp = { asset_id: string; name: string; asset_group: string; asset_type: string; score: number | null; missing: string[] };

export default async function TodoPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  await requireAppUser();
  const supabase = await createClient();
  const [attention, { data: completeness }] = await Promise.all([getAttention(), supabase.rpc("asset_completeness")]);
  const comp = (completeness ?? []) as Comp[];
  const avg = comp.length ? Math.round(comp.reduce((s, c) => s + Number(c.score ?? 0), 0) / comp.length) : null;
  const notDone = comp.filter((c) => Number(c.score) < 100).sort((a, b) => Number(a.score) - Number(b.score));
  const tab = sp.tab === "data" ? "data" : "todo";
  const tabs = [["todo", `สิ่งที่ต้องทำ (${attention.length})`], ["data", `ความครบถ้วนของข้อมูล${avg != null ? ` (${avg}%)` : ""}`]] as const;

  return (
    <TabsProvider initial={tab} defaultKey="todo">
      <div className="space-y-4">
        <PageInfo>ณ วันนี้ · กดรายการเพื่อไปแก้ไข แล้วกด Back กลับมาที่หน้านี้</PageInfo>
        <div className="border-b border-slate-200"><TabNav tabs={tabs} /></div>

        <TabPanel id="todo">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            {attention.length === 0 ? <p className="text-sm text-emerald-700">ไม่มีงานค้าง ✓</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {attention.map((a, i) => (
                  <li key={i} className="flex gap-2 py-2">
                    <span className={a.tone === "red" ? "text-red-600" : a.tone === "amber" ? "text-amber-600" : "text-slate-400"}>●</span>
                    <Link href={a.href} className="hover:underline">{a.text}</Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">● แดง = ต้องทำก่อน (เช่น ปิดเดือน บัญชีติดลบ) · ● เหลือง = ควรตรวจ · ● เทา = แจ้งให้ทราบ</p>
          </div>
        </TabPanel>

        <TabPanel id="data">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-xs text-slate-500">คิดจากข้อมูลที่แนะนำ (เอกสาร เจ้าของ มูลค่า ฯลฯ) · ไม่กระทบตัวเลข Net Worth</p>
              {avg != null && <span className="text-xl font-semibold tabular-nums">{avg}%</span>}
            </div>
            {comp.length > 0 && notDone.length === 0 ? <p className="text-sm text-emerald-700">ครบทุกรายการ ✓</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {notDone.map((c) => (
                  <li key={c.asset_id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2">
                    <Link href={`/a/${c.asset_id}`} className="hover:underline">{c.name}</Link>
                    <span className="text-xs text-slate-500">{c.score}% · ขาด {c.missing.map((m) => FIELD[m] ?? m).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabPanel>
      </div>
    </TabsProvider>
  );
}
