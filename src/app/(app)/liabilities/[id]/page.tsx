import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { LIABILITY_TYPE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { AddBalanceForm, EditLiabilityForm } from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";

const SOURCE_LABEL: Record<string, string> = { OPENING: "ยอดตั้งต้น", STATEMENT: "Statement", USER: "ผู้ใช้" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "ยังผ่อนอยู่", CLOSED: "ปิดหนี้แล้ว", WRITTEN_OFF: "ตัดหนี้สูญ / ยกหนี้" };

export default async function LiabilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: l }, { data: owners }, { data: vals }, { data: family }, { data: persons }] = await Promise.all([
    supabase.from("liabilities").select("*, linked:assets!liabilities_linked_asset_id_fkey(name)")
      .eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("liability_ownerships").select("id,person_id,responsibility_percent,persons(name)")
      .eq("liability_id", id).is("deleted_at", null),
    supabase.from("liability_valuations").select("id,valuation_date,balance,source,notes")
      .eq("liability_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (!l) notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/liabilities/${id}`, "/liabilities"];
  const ownerRows = (owners ?? []).map((o) => ({
    id: o.id, person_id: o.person_id as string, pct: Number(o.responsibility_percent),
    name: (Array.isArray(o.persons) ? o.persons[0]?.name : (o.persons as { name: string } | null)?.name) ?? "-",
  }));
  const ownerTotal = ownerRows.reduce((s, o) => s + o.pct, 0);
  const linked = (Array.isArray(l.linked) ? l.linked[0] : l.linked) as { name: string } | null;
  const paid = l.original_amount && l.outstanding_amount != null ? Number(l.original_amount) - Number(l.outstanding_amount) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/liabilities" className="text-sm text-slate-500 hover:underline">← Liabilities</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{l.name}</h1>
        <p className="text-sm text-slate-500">
          {LIABILITY_TYPE_LABEL[l.liability_type] ?? l.liability_type}{l.lender && ` · ${l.lender}`} · {l.currency}
          {" · "}<span className={l.status === "ACTIVE" ? "" : "text-slate-400"}>{STATUS_LABEL[l.status] ?? l.status}</span>
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดคงค้างล่าสุด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-700">{money(l.outstanding_amount, l.currency)}</div>
          <div className="mt-1 text-xs text-slate-500">ณ {thDate(l.balance_date)}</div>
          {paid != null && paid > 0 && (
            <div className="mt-1 text-xs text-slate-500">จากวงเงิน {money(l.original_amount)} · ชำระแล้ว {money(paid)}</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="text-xs text-slate-500">เงื่อนไข</div>
          <ul className="mt-1 space-y-0.5">
            <li>ดอกเบี้ย {l.interest_rate != null ? `${Number(l.interest_rate)}% ต่อปี` : "-"}</li>
            <li>ค่างวด {l.monthly_payment ? `${money(l.monthly_payment)}/เดือน` : "-"}{l.payment_due_day ? ` · ทุกวันที่ ${l.payment_due_day}` : ""}</li>
            <li>สัญญา {thDate(l.start_date)} – {thDate(l.due_date)}</li>
            {linked && <li>ผูกกับ: {linked.name}</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ผู้รับผิดชอบหนี้</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {ownerRows.map((o) => <li key={o.id}>{o.name} · {o.pct}%</li>)}
          </ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุผู้รับผิดชอบ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="liability" id={id} persons={persons ?? []} paths={paths} today={todayBangkok()}
            current={ownerRows.map((o) => ({ person_id: o.person_id, percent: o.pct }))} />}
        </div>
      </section>

      {canWrite && l.status === "ACTIVE" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">อัปเดตยอดคงค้าง</h2>
          <p className="mb-3 text-xs text-slate-500">
            กรอกยอดเงินต้นคงเหลือจาก Statement / แอปธนาคาร (แนะนำทุกสิ้นเดือน) · ระบบไม่หักค่างวดให้เอง
          </p>
          <AddBalanceForm liabilityId={id} currency={l.currency} today={todayBangkok()} minDate={family?.go_live_date ?? ""} />
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติยอดคงค้าง</h2>
        {(vals ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มียอด</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th className="text-right">ยอดคงค้าง</th><th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(vals ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="py-1.5">{thDate(v.valuation_date)}</td>
                  <td className="text-right tabular-nums">{money(v.balance)}</td>
                  <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                  <td className="pl-4 text-slate-500">{v.notes}</td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="liability_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                      fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                        { name: "balance", label: "ยอด", type: "number", value: v.balance },
                        { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">แก้ไขข้อมูลหนี้</h2>
          <p className="mb-3 text-xs text-slate-500">แก้เฉพาะข้อมูลสัญญา ไม่กระทบยอดคงค้าง</p>
          <EditLiabilityForm l={l} />
          {canDelete && <div className="mt-4 border-t border-slate-100 pt-3">
            <DeleteEntity kind="liability" id={id} redirectTo="/liabilities" paths={["/liabilities"]} label="ลบหนี้รายการนี้"
              hint="ปิดหนี้จริงให้เปลี่ยนสถานะเป็น &quot;ปิดหนี้แล้ว&quot;" />
          </div>}
        </section>
      )}
    </div>
  );
}
