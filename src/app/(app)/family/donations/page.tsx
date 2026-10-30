import Link from "next/link";
import { PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { ActionBar } from "@/components/ActionBar";
import { StatBox } from "@/components/Boxes";
import RowActions from "@/components/RowActions";
import DocumentUpload from "@/components/docs/DocumentUpload";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { DONATION_TAX_KIND_LABEL, DONATION_TAX_STATUS_LABEL, DONEE_TYPE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { DonationAdd, DonationEditor, DonationFilters, FromExpense, type Opt } from "./forms";

type Don = {
  id: string; donation_date: string; year_only: boolean; donor_kind: "PERSON" | "BUSINESS" | "GROUP"; donor_person_id: string | null;
  donor_asset_id: string | null; donor_name: string | null; claimant_person_id: string | null; donee_name: string; donee_type: string | null;
  purpose: string | null; donation_form: string; amount: number; receipt_no: string | null; project_name: string | null;
  tax_status: string; tax_kind: string | null; e_donation: boolean; expense_item_id: string | null; notes: string | null;
};
const COLS = "id,donation_date,year_only,donor_kind,donor_person_id,donor_asset_id,donor_name,claimant_person_id,donee_name,donee_type,purpose,donation_form,amount,receipt_no,project_name,tax_status,tax_kind,e_donation,expense_item_id,notes";
const TAX_CLS: Record<string, string> = { ELIGIBLE: "bg-emerald-50 text-emerald-700", PENDING: "bg-amber-50 text-amber-700", NONE: "bg-slate-100 text-slate-500" };
const year = (d: string) => Number(d.slice(0, 4));

export default async function DonationsPage({ searchParams }: { searchParams: Promise<{ y?: string; d?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  // ประวัติทั้งหมด (หลายร้อยรายการ) → อ่านทีละ 1,000 แถว
  const loadAll = async () => {
    const out: Don[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("donation_records").select(COLS).is("deleted_at", null)
        .order("donation_date", { ascending: false }).order("created_at").range(from, from + 999);
      if (error) return { rows: out, error: error.message };
      out.push(...((data as Don[] | null) ?? []));
      if (!data || data.length < 1000) return { rows: out, error: null };
    }
  };
  const [{ rows: all, error }, { data: persons }, { data: biz }, { data: exps }, { data: drive }] = await Promise.all([
    loadAll(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("assets").select("id,name,private_business_details(company_name)").eq("asset_type", "PRIVATE_BUSINESS").is("deleted_at", null).order("sort_order"),
    supabase.from("expense_items").select("id,date,description,amount,base_amount,currency,person_id").eq("expense_category", "บริจาค").is("deleted_at", null).order("date", { ascending: false }),
    supabase.rpc("drive_status"),
  ]);
  const people: Opt[] = (persons ?? []).map((p) => ({ id: p.id, name: p.name }));
  const businesses: Opt[] = (biz ?? []).map((b) => {
    const d = b.private_business_details as { company_name: string | null } | { company_name: string | null }[] | null;
    const company = (Array.isArray(d) ? d[0] : d)?.company_name;
    return { id: b.id, name: company ? `${b.name} · ${company}` : b.name };
  });
  const pName = new Map(people.map((p) => [p.id, p.name]));
  const bName = new Map(businesses.map((b) => [b.id, b.name]));
  const donorOf = (r: Don) => r.donor_kind === "PERSON" ? pName.get(r.donor_person_id!) ?? "-" : r.donor_kind === "BUSINESS" ? bName.get(r.donor_asset_id!) ?? "-" : r.donor_name || "ไม่ระบุ";

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const connected = !!(drive as { connected?: boolean } | null)?.connected;
  const today = todayBangkok();
  const y = /^\d{4}$/.test(sp.y ?? "") ? sp.y! : "";
  const d = sp.d ?? "";
  const byDonor = (r: Don) => !d ? true : d === "persons" ? r.donor_kind === "PERSON" : d === "business" ? r.donor_kind === "BUSINESS"
    : d === "g" ? r.donor_kind === "GROUP" : d.startsWith("p:") ? r.donor_person_id === d.slice(2) : d.startsWith("b:") ? r.donor_asset_id === d.slice(2) : true;
  const scoped = all.filter(byDonor);
  const rows = y ? scoped.filter((r) => year(r.donation_date) === Number(y)) : scoped;
  const years = [...new Set(all.map((r) => year(r.donation_date)))].sort((a, b) => b - a);
  const sum = (list: Don[]) => list.reduce((s, r) => s + Number(r.amount), 0);
  const eligible = rows.filter((r) => r.tax_status === "ELIGIBLE");
  const pending = rows.filter((r) => r.donor_kind === "PERSON" && r.tax_status === "PENDING");

  // รายจ่ายหมวดบริจาคที่ยังไม่กรอกรายละเอียด
  const linked = new Set(all.map((r) => r.expense_item_id).filter(Boolean));
  const unlinked = (exps ?? []).filter((e) => !linked.has(e.id));

  // สรุปรายปี (เหมือนแผ่นรวมของ Excel เดิม)
  const summary = years.map((yr) => {
    const list = scoped.filter((r) => year(r.donation_date) === yr);
    return { yr, person: sum(list.filter((r) => r.donor_kind === "PERSON")), business: sum(list.filter((r) => r.donor_kind === "BUSINESS")),
      group: sum(list.filter((r) => r.donor_kind === "GROUP")), total: sum(list), n: list.length };
  }).filter((s) => s.n > 0);
  const projects = [...rows.reduce((m, r) => {
    if (!r.project_name) return m;
    const p = m.get(r.project_name) ?? { name: r.project_name, total: 0, n: 0, first: r.donation_date, last: r.donation_date };
    p.total += Number(r.amount); p.n += 1;
    if (r.donation_date < p.first) p.first = r.donation_date;
    if (r.donation_date > p.last) p.last = r.donation_date;
    return m.set(r.project_name, p);
  }, new Map<string, { name: string; total: number; n: number; first: string; last: string }>()).values()].sort((a, b) => b.total - a.total);

  // หลักฐานของรายการที่แสดง (entity DONATION)
  const shown = y || d ? rows : [];
  const ids = shown.map((r) => r.id);
  const docsBy = new Map<string, { id: string; title: string }[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: links } = await supabase.from("document_links").select("entity_id,documents(id,title,deleted_at)")
      .eq("entity_type", "DONATION").in("entity_id", ids.slice(i, i + 200)).is("deleted_at", null);
    (links ?? []).forEach((l) => {
      const doc = (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; deleted_at: string | null } | null;
      if (doc && !doc.deleted_at) docsBy.set(l.entity_id, [...(docsBy.get(l.entity_id) ?? []), doc]);
    });
  }
  const paths = ["/family/donations"];
  const filterNote = d ? " (ตามผู้บริจาคที่เลือก)" : "";

  return (
    <div className="space-y-6">
      <PageInfo>ประวัติการบริจาคของครอบครัว ทั้งในนามบุคคลและในนามกิจการ ทั้งที่ใช้และไม่ใช้สิทธิลดหย่อนภาษี · บันทึกย้อนหลังก่อน Go-live ได้ ·
        หน้านี้ไม่ตัดเงินจากบัญชี (เงินจ่ายจริงบันทึกเป็นรายจ่ายหมวด &ldquo;บริจาค&rdquo; ที่ Income &amp; Expenses แล้วผูกรายละเอียดที่นี่)</PageInfo>
      {/* ปุ่ม · ผู้บริจาค · ปี (ขวาสุด) อยู่แถวแท็บ (ตกลง 30 ต.ค. 2026) */}
      <TabActions>
        {canWrite && <ActionBar><DonationAdd persons={people} businesses={businesses} today={today} /></ActionBar>}
        <DonationFilters years={years} persons={people} businesses={businesses} y={y} d={d} />
      </TabActions>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label={y ? `ยอดบริจาคปี ${Number(y) + 543}` : "ยอดบริจาคทั้งหมด"} value={money(sum(rows))} unit="บาท" sub={`${rows.length.toLocaleString("th-TH")} รายการ${filterNote}`} />
        <StatBox label="บุคคล · ในนามกิจการ" value={money(sum(rows.filter((r) => r.donor_kind === "PERSON")))} unit="บาท"
          sub={`ในนามกิจการ ${money(sum(rows.filter((r) => r.donor_kind === "BUSINESS")))} บาท`} />
        <StatBox label="ใช้สิทธิลดหย่อนได้" value={money(sum(eligible))} unit="บาท" sub={`${eligible.length} รายการ · ยอดจริงที่หักได้ดูที่แท็บ Tax`} />
        <StatBox label="รอตรวจสอบสิทธิภาษี" value={pending.length} unit="รายการ" sub="เฉพาะผู้บริจาคที่เป็นบุคคล" subClass={pending.length ? "text-amber-700" : undefined} />
      </section>

      {canWrite && unlinked.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">รายจ่ายหมวดบริจาคที่ยังไม่กรอกรายละเอียด</h2>
          <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">วันที่</th><th className="px-4">รายละเอียด</th><th className="px-4 text-right">จำนวน</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {unlinked.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2">{thDate(e.date)}</td>
                    <td className="px-4">{e.description}</td>
                    <td className="px-4 text-right tabular-nums">{money(e.amount)} {e.currency !== "THB" && e.currency}</td>
                    <td className="px-4 py-1.5 text-right">
                      <FromExpense persons={people} businesses={businesses} v={{ donation_date: e.date, donor: e.person_id ? `p:${e.person_id}` : people[0] ? `p:${people[0].id}` : "g",
                        claimant_person_id: e.person_id, donee_name: e.description, amount: Number(e.base_amount ?? e.amount), expense_item_id: e.id }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">ยอดเงินเป็นรายจ่ายที่บันทึกไว้แล้ว · กรอกรายละเอียดที่นี่ไม่ตัดเงินซ้ำ</p>
        </section>
      )}

      {!y && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">สรุปรายปี{filterNote}</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">ปี</th><th className="px-4 text-right">บุคคล</th><th className="px-4 text-right">ในนามกิจการ</th><th className="px-4 text-right">ไม่ระบุ / กลุ่ม</th><th className="px-4 text-right">รวม</th><th className="px-4 text-right">รายการ</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">ยังไม่มีรายการ</td></tr>}
                {summary.map((s) => {
                  const q = new URLSearchParams({ y: String(s.yr), ...(d ? { d } : {}) });
                  return (
                    <tr key={s.yr}>
                      <td className="px-4 py-2"><Link href={`/family/donations?${q}`} className="text-blue-700 hover:underline">{s.yr + 543}</Link></td>
                      <td className="px-4 text-right tabular-nums">{s.person ? money(s.person) : "-"}</td>
                      <td className="px-4 text-right tabular-nums">{s.business ? money(s.business) : "-"}</td>
                      <td className="px-4 text-right tabular-nums">{s.group ? money(s.group) : "-"}</td>
                      <td className="px-4 text-right font-medium tabular-nums">{money(s.total)}</td>
                      <td className="px-4 text-right text-slate-500">{s.n}</td>
                    </tr>
                  );
                })}
              </tbody>
              {summary.length > 1 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
                  <tr><td className="px-4 py-2">รวมทุกปี</td>
                    <td className="px-4 text-right tabular-nums">{money(summary.reduce((s, x) => s + x.person, 0))}</td>
                    <td className="px-4 text-right tabular-nums">{money(summary.reduce((s, x) => s + x.business, 0))}</td>
                    <td className="px-4 text-right tabular-nums">{money(summary.reduce((s, x) => s + x.group, 0))}</td>
                    <td className="px-4 text-right tabular-nums">{money(sum(scoped))}</td>
                    <td className="px-4 text-right text-slate-500">{scoped.length}</td></tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-slate-500">กดปีเพื่อดูรายการ · หรือเลือกผู้บริจาคด้านบนเพื่อดูรายการทุกปีของคนนั้น</p>
        </section>
      )}

      {projects.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">โครงการ</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">โครงการ</th><th className="px-4">ช่วงเวลา</th><th className="px-4 text-right">รายการ</th><th className="px-4 text-right">ยอดรวม</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((p) => (
                  <tr key={p.name}><td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 text-slate-600">{p.first === p.last ? thDate(p.first) : `${thDate(p.first)} – ${thDate(p.last)}`}</td>
                    <td className="px-4 text-right text-slate-500">{p.n}</td><td className="px-4 text-right tabular-nums">{money(p.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">รายการบริจาค{y ? ` ปี ${Number(y) + 543}` : ""}</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">วันที่</th><th className="px-4">ผู้บริจาค</th><th className="px-4">ผู้รับบริจาค · รายการ</th><th className="px-4 text-right">จำนวน</th><th className="px-4">สิทธิภาษี</th><th className="px-4">หลักฐาน</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const docs = docsBy.get(r.id) ?? [];
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5">{r.year_only ? `ทั้งปี ${year(r.donation_date) + 543}` : thDate(r.donation_date)}</td>
                      <td className="px-4 py-2.5">{donorOf(r)}
                        {r.donor_kind === "PERSON" && r.claimant_person_id && r.claimant_person_id !== r.donor_person_id &&
                          <div className="text-xs text-slate-500">ใช้สิทธิ: {pName.get(r.claimant_person_id) ?? "-"}</div>}
                        {r.donor_kind === "BUSINESS" && <div className="text-xs text-slate-500">ในนามกิจการ</div>}</td>
                      <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{r.donee_name}</div>
                        <div className="text-xs text-slate-500">{[r.donee_type && DONEE_TYPE_LABEL[r.donee_type], r.purpose, r.project_name && `โครงการ ${r.project_name}`,
                          r.receipt_no && `เลขที่ ${r.receipt_no}`, r.notes].filter(Boolean).join(" · ")}</div>
                        {r.expense_item_id && <div className="text-xs text-blue-700">ผูกกับรายจ่ายใน Income &amp; Expenses</div>}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{money(r.amount)}
                        {r.donation_form === "IN_KIND" && <div className="text-xs text-slate-500">สิ่งของ (มูลค่า)</div>}</td>
                      <td className="px-4 py-2.5">{r.donor_kind === "PERSON"
                        ? <><span className={`rounded px-1.5 py-0.5 text-xs ${TAX_CLS[r.tax_status]}`}>{DONATION_TAX_STATUS_LABEL[r.tax_status]}</span>
                          {r.tax_kind && <div className="mt-0.5 text-xs text-slate-500">{DONATION_TAX_KIND_LABEL[r.tax_kind]}{r.e_donation ? " · e-Donation" : ""}</div>}</>
                        : <span className="text-xs text-slate-400">-</span>}</td>
                      <td className="px-4 py-2.5 text-xs">{docs.length === 0 ? <span className="text-slate-400">-</span> : docs.map((x) => (
                        <div key={x.id}>{connected ? <a href={`/view/${x.id}`} target="_blank" rel="noopener" className="text-blue-700 hover:underline">{x.title}</a> : x.title}</div>))}</td>
                      <td className="px-4 py-2.5 text-right">{canWrite && <RowActions table="donation_records" id={r.id} paths={paths} canDelete={canDelete}
                        deleteEffect="(ลบเฉพาะประวัติการบริจาค · รายจ่ายที่ผูกไว้ใน Income & Expenses ไม่ถูกลบ)"
                        extra={connected ? <DocumentUpload module="FAMILY" link={{ type: "DONATION", id: r.id }} category="DONATION" label="+ แนบใบอนุโมทนา / หลักฐาน" /> : undefined}
                        editor={<DonationEditor persons={people} businesses={businesses} v={{
                          id: r.id, donation_date: r.donation_date, year_only: r.year_only,
                          donor: r.donor_kind === "PERSON" ? `p:${r.donor_person_id}` : r.donor_kind === "BUSINESS" ? `b:${r.donor_asset_id}` : "g",
                          donor_name: r.donor_name, claimant_person_id: r.claimant_person_id, donee_name: r.donee_name, donee_type: r.donee_type, purpose: r.purpose,
                          donation_form: r.donation_form, amount: Number(r.amount), receipt_no: r.receipt_no, project_name: r.project_name,
                          tax_status: r.tax_status, tax_kind: r.tax_kind, e_donation: r.e_donation, notes: r.notes }} />} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {(y || d) && shown.length === 0 && <p className="text-sm text-slate-500">ไม่มีรายการตามที่เลือก</p>}
    </div>
  );
}
