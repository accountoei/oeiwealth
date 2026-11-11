import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { detailTitle } from "@/lib/page-title";
import { requireAppUser } from "@/lib/auth";
import { thDate } from "@/lib/format";
import { FIN_COLS, toFinYears } from "@/lib/biz-financials";
import { DetailItem as Item } from "@/components/Boxes";
import EditToggle from "@/components/EditToggle";
import FinResults from "../../FinResults";
import { PastBusinessForm } from "../../results";

// ข้อมูลหลักของหน้า: ใช้ทั้งชื่อแท็บเบราว์เซอร์และในหน้า (cache → โหลดครั้งเดียวต่อการเปิดหน้า)
const loadPast = cache(async (id: string) =>
  (await createClient()).from("past_businesses").select("id,name,company_name,established_date,closed_date,notes").eq("id", id).is("deleted_at", null).maybeSingle());

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return detailTitle(() => loadPast(id).then((r) => r.data?.name), "Private Business");
}

/** บริษัทที่ปิดแล้ว (เก็บเป็นประวัติผลประกอบการ · ไม่ใช่ทรัพย์สิน · ตกลง 9 พ.ย. 2026) */
export default async function PastBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: c }, { data: rows }] = await Promise.all([
    loadPast(id),
    supabase.from("business_financial_years").select(FIN_COLS).eq("past_business_id", id).is("deleted_at", null),
  ]);
  if (!c) notFound();
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const events: Record<number, string[]> = {};
  if (c.established_date) events[Number(c.established_date.slice(0, 4))] = [`${c.name} จัดตั้ง ${thDate(c.established_date)}`];
  if (c.closed_date) events[Number(c.closed_date.slice(0, 4))] = [...(events[Number(c.closed_date.slice(0, 4))] ?? []), `${c.name} ปิด ${thDate(c.closed_date)}`];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/business?tab=results" className="text-sm text-slate-500 hover:underline">← Private Business · ผลประกอบการ</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{c.name}</h1>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">ปิดแล้ว</span>
        </div>
        {c.company_name && <p className="text-sm text-slate-500">{c.company_name}</p>}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <EditToggle title="รายละเอียด" canEdit={canWrite}
          view={
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Item label="ชื่อบริษัท">{c.company_name || "-"}</Item>
              <Item label="วันที่จัดตั้ง">{thDate(c.established_date)}</Item>
              <Item label="วันที่ปิดกิจการ">{thDate(c.closed_date)}</Item>
              <Item label="หมายเหตุ">{c.notes || "-"}</Item>
            </dl>
          }
          edit={<PastBusinessForm row={c} canDelete={canDelete} />} />
      </section>
      <FinResults owner={{ pastId: id }} rows={toFinYears(rows)} canWrite={canWrite} canDelete={canDelete} events={events} />
    </div>
  );
}
