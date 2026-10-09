import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  COST_STATUS, FREQ_LABEL, LEASE_STATUS, PERIODS_PER_YEAR, PROPERTY_TYPE_LABEL, TH_MONTHS, USAGE_LABEL, UTIL_EXPENSE_CATEGORY,
  UTIL_LABEL, addDays, landText, money, scheduleText, thDate, thMonth, todayBangkok,
} from "@/lib/format";
import {
  EditPropertyForm, NewLeaseForm, RecordCostForm, RecordRentForm, SettleDepositForm, SuggestVacant, TerminateLeaseForm,
  UtilityForm, ValuationForm,
} from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import { PayAssetForm, SellAssetForm } from "@/components/AssetTrade";
import AssetTradeHistory from "@/components/AssetTradeHistory";
import EntityDocuments from "@/components/docs/EntityDocuments";

const SOURCE_LABEL: Record<string, string> = { OPENING: "มูลค่าตั้งต้น", APPRAISAL: "ผู้ประเมิน", USER: "ผู้ใช้", STATEMENT: "Statement" };
const METHOD_LABEL: Record<string, string> = {
  USER_ESTIMATE: "ประมาณเอง", APPRAISAL: "ประเมิน", BOOK_VALUE: "ราคาทุน", LATEST_TRANSACTION: "ราคาซื้อขายล่าสุด", STATEMENT: "Statement",
};
const DEPOSIT_LABEL: Record<string, { text: string; cls: string }> = {
  HELD: { text: "ถือไว้ (เป็นหนี้)", cls: "text-slate-700" },
  DUE_SOON: { text: "ใกล้ครบกำหนดคืน", cls: "text-amber-700" },
  DEPOSIT_REFUND_OVERDUE: { text: "เลยกำหนดคืนแล้ว", cls: "text-red-600" },
  SETTLED: { text: "ปิดแล้ว", cls: "text-slate-500" },
};
const RENT_STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "text-emerald-700" }, PENDING: { text: "รอรับ", cls: "text-slate-600" },
  OVERDUE: { text: "ค้างรับ", cls: "text-red-600" }, DISMISSED: { text: "ยกเว้น", cls: "text-slate-400" },
};

type Lease = { id: string; unit_label: string | null; tenant_name: string; contract_no: string | null; start_date: string;
  end_date: string; terminated_date: string | null; rent_amount: number; rent_currency: string; payment_frequency: string;
  payment_due_day: number | null; security_deposit: number | null; deposit_currency: string | null;
  deposit_received_date: string | null; deposit_settled_date: string | null; deposit_settlement_type: string | null;
  deposit_refunded_amount: number | null; deposit_carried_amount: number | null; status: string; notes: string | null;
  lease_status: string; deposit_status: string; deposit_due_date: string };
type Util = { id: string; utility_type: string; provider: string | null; account_no: string | null; meter_no: string | null;
  notes: string | null; deleted_at: string | null; expected_amount: number | null; currency: string; frequency: string | null;
  due_day: number | null; due_month: number | null; active: boolean };
type Cost = { utility_id: string; utility_type: string; provider: string | null; cost_period: string; due_date: string;
  expected_amount: number; paid_amount: number; gap: number; currency: string; status: string; last_paid_date: string | null };
type Rent = { lease_id: string; name: string; income_period: string; due_date: string; expected_amount: number;
  received_amount: number; currency: string; status: string };

export default async function PropertyDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const editing = (await searchParams).edit === "1";
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: pd }, { data: owners }, { data: vals }, { data: leaseRows }, { data: rentRows },
    { data: banks }, { data: family }, { data: persons }, { data: costRows }, { data: cardRows }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("property_details").select("*, property_utilities(id,utility_type,provider,account_no,meter_no,notes,deleted_at,expected_amount,currency,frequency,due_day,due_month,active)")
      .eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,valuation_method,source,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }),
    supabase.from("v_lease_status").select("*").eq("property_asset_id", id).order("start_date", { ascending: false }),
    supabase.from("v_lease_rent_tracking").select("*").eq("property_asset_id", id)
      .order("income_period", { ascending: false }).limit(36),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_property_cost_tracking").select("utility_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,gap,currency,status,last_paid_date")
      .eq("property_asset_id", id).order("cost_period", { ascending: false }).order("utility_type").limit(48),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
  ]);
  if (!a || !pd) notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/property/${id}`, "/property", "/liabilities", "/income-expenses"];
  const canSettle = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const leases = (leaseRows as Lease[] | null) ?? [];
  const rents = (rentRows as Rent[] | null) ?? [];
  const bankList = banks ?? [];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const liveLeases = leases.filter((l) => ["ACTIVE", "EXPIRING_SOON", "UPCOMING"].includes(l.lease_status));
  const carryOptions = leases
    .filter((l) => Number(l.security_deposit ?? 0) > 0 && !l.deposit_settled_date)
    .map((l) => ({ id: l.id, label: [l.unit_label, l.tenant_name, `ถึง ${thDate(l.end_date)}`].filter(Boolean).join(" · "),
      deposit: Number(l.security_deposit), currency: l.deposit_currency ?? l.rent_currency }));
  const stale = !a.current_value_date || a.current_value_date < addDays(today, -90);
  const utilities = ((pd.property_utilities ?? []) as Util[]).filter((u) => !u.deleted_at);
  const costs = (costRows as Cost[] | null) ?? [];
  const cards = (cardRows ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const yearly = utilities.filter((u) => u.frequency && u.active)
    .reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount ?? 0) * (PERIODS_PER_YEAR[u.frequency!] ?? 0)), new Map<string, number>());
  const utilName = (t: string, provider: string | null) => [UTIL_LABEL[t] ?? t, provider].filter(Boolean).join(" · ");
  const isRental = pd.usage_type === "RENTAL" || liveLeases.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/property" className="text-sm text-slate-500 hover:underline">← Property</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{a.name}</h1>
        <p className="text-sm text-slate-500">
          {PROPERTY_TYPE_LABEL[pd.property_type] ?? pd.property_type} · {USAGE_LABEL[pd.usage_type] ?? pd.usage_type}
          {pd.location_group && ` · ${pd.location_group}`} · {a.currency}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">มูลค่าล่าสุด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(a.current_value, a.currency, 0)}</div>
          <div className={`mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>
            ณ {thDate(a.current_value_date)}{stale && " · เกิน 90 วัน ควรประเมินใหม่"}
          </div>
          {a.acquisition_cost != null && (
            <div className="mt-1 text-xs text-slate-500">ราคาที่ได้มา {money(a.acquisition_cost, undefined, 0)}{a.acquisition_date && ` (${thDate(a.acquisition_date)})`}</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">รายละเอียด</div>
            {canWrite && (editing
              ? <Link href={`/property/${id}`} scroll={false} className="text-xs text-slate-500 underline">ปิดแก้ไข</Link>
              : <Link href={`/property/${id}?edit=1#edit`} className="text-xs text-blue-700 underline">แก้ไข</Link>)}
          </div>
          <ul className="mt-1 space-y-0.5">
            <li>เนื้อที่ {landText(pd.land_area_sq_wa)}</li>
            <li>เอกสารสิทธิ์ {[pd.title_type, pd.title_deed_no && `เลขที่ ${pd.title_deed_no}`, pd.land_no && `เลขที่ดิน ${pd.land_no}`].filter(Boolean).join(" · ") || "-"}</li>
            {pd.address && <li className="text-slate-600">{pd.address}</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เจ้าของ</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {activeOwners.map((o) => <li key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}
          </ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {/* ---------------- มูลค่า: อัปเดต + ประวัติ ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">มูลค่า</h2>
        {canWrite && a.status === "ACTIVE" && (
          <>
            <p className="mb-3 text-xs text-slate-500">อัปเดตมูลค่า · แนะนำประเมินใหม่อย่างน้อยทุก 90 วัน (หรือเมื่อมีการประเมินจากธนาคาร)</p>
            <ValuationForm assetId={id} currency={a.currency} today={today} minDate={goLive} />
          </>
        )}
        <h3 className="mb-2 mt-5 text-sm font-medium text-slate-700">ประวัติมูลค่า</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">วันที่</th><th className="text-right">มูลค่า</th><th className="pl-4">วิธี</th><th className="pl-4">ที่มา</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value, undefined, 0)}</td>
                <td className="pl-4">{METHOD_LABEL[v.valuation_method] ?? v.valuation_method}</td>
                <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                <td className="pl-4 text-slate-500">{v.notes}</td>
                <td className="pl-2 text-right">
                  {canWrite && <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                    fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                      { name: "value", label: "มูลค่า", type: "number", value: v.value },
                      { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canWrite && a.status === "ACTIVE" && (
        <div className="flex flex-wrap gap-2">
          <PayAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} />
          <SellAssetForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} paths={paths} hasLease={liveLeases.length > 0} />
        </div>
      )}
      <AssetTradeHistory assetId={id} currency={a.currency} status={a.status} cost={a.acquisition_cost != null ? Number(a.acquisition_cost) : null}
        paths={paths} canWrite={canWrite} canDelete={canDelete} />

      {/* ---------------- สัญญาเช่า ---------------- */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">สัญญาเช่า</h2>
        {!isRental && leases.length === 0 && (
          <p className="text-sm text-slate-500">
            ทรัพย์สินนี้{USAGE_LABEL[pd.usage_type] ?? ""} — ไม่ต้องมีสัญญาเช่า (ไม่นับว่าข้อมูลขาด)
          </p>
        )}
        {canWrite && pd.usage_type === "RENTAL" && liveLeases.length === 0 && <SuggestVacant assetId={id} />}

        {leases.map((l) => {
          const st = LEASE_STATUS[l.lease_status];
          const dep = Number(l.security_deposit ?? 0);
          const ds = DEPOSIT_LABEL[l.deposit_status];
          const leaseEnded = l.deposit_due_date <= today;
          return (
            <div key={l.id} className="rounded-lg border border-slate-200 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? l.lease_status}</span>
                <span className="font-medium">{[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}</span>
                {l.contract_no && <span className="text-xs text-slate-500">สัญญาเลขที่ {l.contract_no}</span>}
              </div>
              <div className="mt-1 text-slate-600">
                {thDate(l.start_date)} – {thDate(l.end_date)}
                {l.terminated_date && <span className="text-red-600"> · เลิก {thDate(l.terminated_date)}</span>}
                {" · "}ค่าเช่า {money(l.rent_amount, l.rent_currency)} {FREQ_LABEL[l.payment_frequency] ?? ""}
                {l.payment_due_day && ` · จ่ายทุกวันที่ ${l.payment_due_day}`}
              </div>
              {dep > 0 && (
                <div className="mt-1">
                  เงินประกัน {money(dep, l.deposit_currency ?? undefined)}
                  {l.deposit_carried_amount && <span className="text-slate-500"> (ยกมา {money(l.deposit_carried_amount)})</span>}
                  {" · "}<span className={ds?.cls}>{ds?.text ?? l.deposit_status}</span>
                  {l.deposit_received_date && l.deposit_received_date < goLive && l.deposit_status !== "SETTLED" &&
                    <span className="text-xs text-slate-500"> · รับก่อน Go-live = อยู่ในยอดตั้งต้น</span>}
                  {l.deposit_settlement_type === "REFUNDED" &&
                    <span className="text-xs text-slate-500"> · คืน {money(l.deposit_refunded_amount)} เมื่อ {thDate(l.deposit_settled_date)}</span>}
                  {l.deposit_settlement_type === "CARRIED_TO_NEW_LEASE" &&
                    <span className="text-xs text-slate-500"> · ยกไปสัญญาใหม่ {thDate(l.deposit_settled_date)}</span>}
                </div>
              )}
              {l.notes && <div className="mt-1 whitespace-pre-line text-xs text-slate-500">{l.notes}</div>}
              <div className="mt-2 flex flex-wrap gap-4">
                {canWrite && l.status === "ACTIVE" && l.end_date > today && (
                  <TerminateLeaseForm assetId={id} leaseId={l.id} today={today} startDate={l.start_date} />
                )}
                {canWrite && (
                  <RowActions table="property_leases" id={l.id} paths={paths} canDelete={false} fields={[
                    { name: "tenant_name", label: "ผู้เช่า", value: l.tenant_name },
                    { name: "unit_label", label: "ห้อง", value: l.unit_label, width: "w-24" },
                    { name: "contract_no", label: "เลขสัญญา", value: l.contract_no, width: "w-24" },
                    { name: "end_date", label: "สิ้นสุด", type: "date", value: l.end_date },
                    { name: "rent_amount", label: "ค่าเช่า", type: "number", value: l.rent_amount },
                    { name: "payment_due_day", label: "จ่ายวันที่", type: "number", value: l.payment_due_day, width: "w-16" },
                    { name: "notes", label: "หมายเหตุ", value: l.notes, width: "w-40" }]} />
                )}
                {canDelete && <DeleteEntity kind="lease" id={l.id} paths={paths} label="ลบสัญญา" needReason={false}
                  hint="รายการรับเงินประกันของสัญญานี้จะถูกลบด้วย" />}
                {canSettle && dep > 0 && !l.deposit_settled_date && leaseEnded && (
                  <SettleDepositForm assetId={id} leaseId={l.id} deposit={dep} currency={l.deposit_currency ?? l.rent_currency}
                    banks={bankList} minDate={l.deposit_due_date} today={today} />
                )}
              </div>
              {dep > 0 && !l.deposit_settled_date && !leaseEnded && (
                <p className="mt-1 text-xs text-slate-400">คืนเงินประกันได้ตั้งแต่ {thDate(l.deposit_due_date)}</p>
              )}
            </div>
          );
        })}

        {canWrite && (
          <NewLeaseForm assetId={id} banks={bankList} goLive={goLive} currency={a.currency} carryOptions={carryOptions}
            label={leases.length === 0 ? "+ เริ่มให้เช่า (เพิ่มสัญญา)" : "+ สัญญาใหม่ / ต่อสัญญา"} />
        )}
      </section>

      {rents.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">ค่าเช่าที่ควรได้ vs ได้รับจริง</h2>
          <p className="mb-3 text-xs text-slate-500">นับตั้งแต่เดือน Go-live · การบันทึกรับจะสร้างรายได้ค่าเช่าและเงินเข้าบัญชีให้</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">งวด</th><th>สัญญา</th><th className="text-right">ควรได้</th><th className="text-right">ได้รับ</th>
                <th className="pl-4">สถานะ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rents.map((r) => (
                <tr key={`${r.lease_id}-${r.income_period}`} className="align-top">
                  <td className="py-1.5">{thMonth(r.income_period)}</td>
                  <td className="text-xs text-slate-600">{r.name.split(" · ").slice(1).join(" · ")}<div className="text-slate-400">ครบ {thDate(r.due_date)}</div></td>
                  <td className="text-right tabular-nums">{money(r.expected_amount)}</td>
                  <td className="text-right tabular-nums">{Number(r.received_amount) > 0 ? money(r.received_amount) : "-"}</td>
                  <td className={`pl-4 ${RENT_STATUS[r.status]?.cls ?? ""}`}>{RENT_STATUS[r.status]?.text ?? r.status}</td>
                  <td className="text-right">
                    {canWrite && (r.status === "OVERDUE" || r.status === "PENDING") && (
                      <RecordRentForm assetId={id} leaseId={r.lease_id} period={r.income_period}
                        expected={Number(r.expected_amount) - Number(r.received_amount)} currency={r.currency}
                        banks={bankList} today={today} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------- ค่าใช้จ่ายประจำ / สาธารณูปโภค ---------------- */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-slate-900">ค่าใช้จ่ายประจำ / สาธารณูปโภค</h2>
          {[...yearly.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
            <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
          ))}
        </div>
        {utilities.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล · เพิ่มค่าส่วนกลาง ภาษีที่ดิน ไฟ น้ำ พร้อมยอดประมาณเพื่อติดตามการจ่าย</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">รายการ</th><th className="text-right">ยอดประมาณ</th><th className="pl-4">กำหนดจ่าย</th><th className="pl-4">ข้อมูลอ้างอิง</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {utilities.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-1.5">{utilName(u.utility_type, u.provider)}</td>
                  <td className="text-right tabular-nums">{u.expected_amount != null ? money(u.expected_amount, u.currency) : <span className="text-slate-400">ไม่ติดตาม</span>}</td>
                  <td className="pl-4 text-slate-600">{scheduleText(u.frequency, u.due_day, u.due_month) || "-"}</td>
                  <td className="pl-4 text-xs text-slate-500">
                    {[u.account_no && `เลขที่ผู้ใช้ ${u.account_no}`, u.meter_no && `มิเตอร์ ${u.meter_no}`, u.notes].filter(Boolean).join(" · ")}
                  </td>
                  <td className="pl-2 text-right">
                    {canWrite && <RowActions table="property_utilities" id={u.id} paths={paths} canDelete={canDelete} fields={[
                      { name: "provider", label: "ผู้ให้บริการ / ผู้เก็บ", value: u.provider },
                      { name: "expected_amount", label: "ยอดประมาณ", type: "number", value: u.expected_amount, width: "w-28" },
                      { name: "frequency", label: "จ่าย", type: "select", value: u.frequency ?? "", options: [["", "ไม่ติดตาม"],
                        ["MONTHLY", FREQ_LABEL.MONTHLY], ["QUARTERLY", FREQ_LABEL.QUARTERLY], ["YEARLY", FREQ_LABEL.YEARLY]] },
                      { name: "due_month", label: "เดือน (รายปี/3 เดือน)", type: "select", value: u.due_month ?? "",
                        options: [["", "-"], ...TH_MONTHS.map((m, i) => [String(i + 1), m] as [string, string])] },
                      { name: "due_day", label: "ทุกวันที่", type: "number", value: u.due_day, width: "w-16" },
                      { name: "account_no", label: "เลขที่ผู้ใช้", value: u.account_no }, { name: "meter_no", label: "มิเตอร์", value: u.meter_no },
                      { name: "notes", label: "หมายเหตุ", value: u.notes }]} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canWrite && <UtilityForm assetId={id} propertyId={pd.id} currency={a.currency} />}

        {costs.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">ประมาณ vs จ่ายจริง</h3>
            <p className="mb-2 text-xs text-slate-500">นับตั้งแต่เดือน Go-live · บันทึกจ่ายแล้วจะเข้าหน้า Income &amp; Expenses และหักจากบัญชีที่เลือกให้</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">งวด</th><th>รายการ</th><th className="text-right">ประมาณ</th><th className="text-right">จ่ายจริง</th>
                  <th className="text-right">ส่วนต่าง</th><th className="pl-4">สถานะ</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {costs.map((c) => (
                  <tr key={`${c.utility_id}-${c.cost_period}`} className="align-top">
                    <td className="py-1.5">{thMonth(c.cost_period)}<div className="text-xs text-slate-400">ครบ {thDate(c.due_date)}</div></td>
                    <td>{utilName(c.utility_type, c.provider)}</td>
                    <td className="text-right tabular-nums">{money(c.expected_amount)}</td>
                    <td className="text-right tabular-nums">{Number(c.paid_amount) > 0 ? money(c.paid_amount) : "-"}</td>
                    <td className={`text-right tabular-nums ${c.status === "PAID" && Number(c.gap) < 0 ? "text-red-700" : c.status === "PAID" && Number(c.gap) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {c.status === "PAID" ? money(-Number(c.gap)) : "-"}
                    </td>
                    <td className={`pl-4 ${COST_STATUS[c.status]?.cls ?? ""}`}>{COST_STATUS[c.status]?.text ?? c.status}</td>
                    <td className="text-right">
                      {canWrite && c.status !== "PAID" && (
                        <RecordCostForm assetId={id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
                          label={`${utilName(c.utility_type, c.provider)} · ${a.name} (${thMonth(c.cost_period)})`}
                          category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
                          banks={bankList} cards={cards} persons={persons ?? []} today={today} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canWrite && editing && (
        <section id="edit" className="scroll-mt-20 rounded-xl border border-blue-200 bg-white p-5 ring-1 ring-blue-100">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-medium text-slate-900">แก้ไขข้อมูลทรัพย์สิน</h2>
            <Link href={`/property/${id}`} scroll={false} className="text-xs text-slate-500 underline">ปิด</Link>
          </div>
          <p className="mb-3 text-xs text-slate-500">แก้เฉพาะข้อมูล ไม่กระทบมูลค่า · แก้เจ้าของที่การ์ด &ldquo;เจ้าของ&rdquo; ด้านบน</p>
          <EditPropertyForm p={{ ...pd, name: a.name, notes: a.notes, acquisition_date: a.acquisition_date,
            acquisition_cost: a.acquisition_cost, asset_id: id }} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะทรัพย์สิน"
              options={[["ACTIVE", "ถืออยู่"], ["SOLD", "ขายแล้ว"], ["GIFTED", "ยกให้แล้ว"], ["LOST", "สูญหาย / เสียหาย"]]} />
          </div>
          {canDelete && <div className="mt-4 border-t border-slate-100 pt-3">
            <DeleteEntity kind="asset" id={id} redirectTo="/property" paths={["/property"]} label="ลบทรัพย์สินนี้"
              hint="สัญญาเช่า มูลค่า และสาธารณูปโภคจะถูกลบด้วย · ลบไม่ได้ถ้ามีค่าเช่า / เงินประกันที่บันทึกแล้ว" />
          </div>}
        </section>
      )}
      <EntityDocuments entityType="ASSET" entityId={id} module="PROPERTY" role={me.role} paths={paths} />
    </div>
  );
}
