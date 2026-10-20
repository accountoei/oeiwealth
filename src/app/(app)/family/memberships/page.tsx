import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import { MembershipForm, PointsForm } from "./member-forms";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle, neighbors } from "@/components/SortControls";
import { orderHrefs } from "@/lib/sort";
import { ActionBar } from "@/components/ActionBar";
import { addDays } from "@/lib/format";

type Card = { id: string; person_id: string; issuer: string; card_name: string | null };

export default async function MembershipsPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder ? sp.order ?? "" : "";      // "members" | "points"
  const oh = (key: string) => orderHrefs("/family/memberships", { p: sp.p }, key);
  const [pv, { data, error }, { data: persons }, { data: members }, { data: points }] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("credit_cards").select("id,person_id,issuer,card_name").is("deleted_at", null).order("sort_order").order("issuer"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("memberships").select("*").is("deleted_at", null).order("sort_order").order("program_name"),
    supabase.from("points_accounts").select("*").is("deleted_at", null).order("sort_order").order("program_name"),
  ]);
  // มุมมองรายบุคคล: สมาชิกภาพ / แต้ม เป็นของคนเดียว → แสดงเฉพาะของคนที่เลือก (ยอดเต็ม)
  const cards = ((data as Card[] | null) ?? []).filter((c) => pv.isPerson(c.person_id));
  const memberRows = (members ?? []).filter((m) => pv.isPerson(m.person_id));
  const pointRows = (points ?? []).filter((pt) => pv.isPerson(pt.person_id));
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const pmap = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const soon = addDays(today, 60);
  const activeMembers = memberRows.filter((m) => m.status === "ACTIVE");
  const memberSoon = activeMembers.filter((m) => m.expiry_date && m.expiry_date >= today && m.expiry_date <= soon).length;
  const memberExpired = activeMembers.filter((m) => m.expiry_date && m.expiry_date < today).length;
  const pointSoon = pointRows.filter((pt) => pt.expiry_date && pt.expiry_date >= today && pt.expiry_date <= soon).length;
  const pointsStale = pointRows.filter((pt) => !pt.balance_date || pt.balance_date < addDays(today, -90)).length;
  const pointLinks = [
    ...(members ?? []).map((m) => ({ value: `m:${m.id}`, label: `สมาชิกภาพ ${m.program_name}` })),
    ...cards.map((c) => ({ value: `c:${c.id}`, label: `บัตร ${c.issuer} ${c.card_name ?? ""}` }))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Membership &amp; Points</h1>
          <p className="text-sm text-slate-500">
            สมาชิกภาพ / สิทธิประโยชน์ และแต้มสะสม / ไมล์ ของสมาชิกในครอบครัว
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} shareNote={false} />
          {canWrite && (
            <ActionBar>
              <MembershipForm persons={persons ?? []} />
              <PointsForm persons={persons ?? []} today={today} links={pointLinks} />
            </ActionBar>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Box label="สมาชิกภาพที่ใช้งาน" value={activeMembers.length} unit="รายการ" sub={`ทั้งหมด ${memberRows.length} รายการ`} />
        <Box label="สมาชิกภาพใกล้หมดอายุ (60 วัน)" value={memberSoon} unit="รายการ"
          sub={memberExpired ? `เลยวันหมดอายุแล้ว ${memberExpired} รายการ` : "ไม่มีรายการเลยวันหมดอายุ"} warn={memberSoon + memberExpired > 0} />
        <Box label="บัญชีแต้ม / ไมล์" value={pointRows.length} unit="บัญชี" sub={pointsStale ? `ยอดเกิน 90 วัน ${pointsStale} บัญชี` : "ยอดอัปเดตภายใน 90 วัน"} warn={pointsStale > 0} />
        <Box label="แต้มใกล้หมดอายุ (60 วัน)" value={pointSoon} unit="บัญชี" sub="แต้ม / ไมล์ ไม่นับใน Net Worth" warn={pointSoon > 0} />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">สมาชิกภาพ</h2>
          {canOrder && memberRows.length > 1 && <SortToggle active={ordering === "members"} {...oh("members")} />}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">โปรแกรม</th><th className="px-4">สมาชิก</th><th className="px-4">ระดับ / สิทธิ</th><th className="px-4">หมดอายุ</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {memberRows.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">ยังไม่มี</td></tr>}
              {memberRows.map((m, i) => (
                <tr key={m.id} className={`align-top ${m.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5">{ordering === "members" && <div className="mb-1"><MoveButtons table="memberships" id={m.id} paths={["/family/memberships"]} {...neighbors(memberRows, i, (x) => x.id)} /></div>}<div className="font-medium">{m.program_name}</div>{m.member_id && <div className="text-xs text-slate-500">เลขสมาชิก {m.member_id}</div>}</td>
                  <td className="px-4">{pmap.get(m.person_id) ?? "-"}</td>
                  <td className="px-4 text-xs">{m.tier}{m.benefits && <div className="text-slate-500">{m.benefits}</div>}</td>
                  <td className={`px-4 ${m.expiry_date && m.expiry_date < today ? "text-red-600" : ""}`}>{thDate(m.expiry_date)}</td>
                  <td className="px-4 text-right">{canWrite && <RowActions table="memberships" id={m.id} paths={["/family/memberships"]} canDelete={canDelete} fields={[
                    { name: "program_name", label: "โปรแกรม", value: m.program_name }, { name: "member_id", label: "เลขสมาชิก", value: m.member_id },
                    { name: "tier", label: "ระดับ", value: m.tier, width: "w-24" }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: m.expiry_date },
                    { name: "status", label: "สถานะ", type: "select", value: m.status, options: [["ACTIVE", "ใช้งาน"], ["EXPIRED", "หมดอายุ"], ["CANCELLED", "ยกเลิก"]] },
                    { name: "benefits", label: "สิทธิประโยชน์", value: m.benefits, width: "w-48" }]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">แต้มสะสม / ไมล์</h2>
          {canOrder && pointRows.length > 1 && <SortToggle active={ordering === "points"} {...oh("points")} />}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">โปรแกรม</th><th className="px-4">สมาชิก</th><th className="px-4 text-right">คงเหลือ</th><th className="px-4">แต้มหมดอายุ</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pointRows.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">ยังไม่มี</td></tr>}
              {pointRows.map((pt, i) => (
                <tr key={pt.id} className="align-top">
                  <td className="px-4 py-2.5 font-medium">{ordering === "points" && <div className="mb-1"><MoveButtons table="points_accounts" id={pt.id} paths={["/family/memberships"]} {...neighbors(pointRows, i, (x) => x.id)} /></div>}{pt.program_name}</td>
                  <td className="px-4">{pmap.get(pt.person_id) ?? "-"}</td>
                  <td className="px-4 text-right"><div className="tabular-nums">{Number(pt.balance).toLocaleString("th-TH")}</div><div className="text-xs text-slate-500">ณ {thDate(pt.balance_date)}</div></td>
                  <td className={`px-4 ${pt.expiry_date && pt.expiry_date <= today ? "text-red-600" : ""}`}>{thDate(pt.expiry_date)}</td>
                  <td className="px-4 text-right">{canWrite && <RowActions table="points_accounts" id={pt.id} paths={["/family/memberships"]} canDelete={canDelete} fields={[
                    { name: "balance", label: "คงเหลือ", type: "number", value: pt.balance }, { name: "balance_date", label: "ณ วันที่", type: "date", value: today },
                    { name: "expiry_date", label: "หมดอายุ", type: "date", value: pt.expiry_date }]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">แต้ม / ไมล์ ไม่นับรวมใน Net Worth · กดแก้ไขเพื่ออัปเดตยอดตาม Statement ·
          บัตรเครดิตอยู่ที่ <Link href="/liabilities#cards" className="text-blue-700 hover:underline">Liabilities → บัตรเครดิต</Link></p>
      </section>
    </div>
  );
}

function Box({ label, value, unit, sub, warn }: { label: string; value: number; unit: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value} <span className="text-sm font-normal text-slate-500">{unit}</span></div>
      {sub && <div className={`mt-1 text-xs ${warn ? "text-amber-700" : "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}
