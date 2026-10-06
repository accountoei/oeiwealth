import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ACCOUNT_TYPE_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { AccountNoPanel, EditInfoForm, UpdateBalanceForm } from "./forms";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";

const SOURCE_LABEL: Record<string, string> = {
  OPENING: "ยอดตั้งต้น", ACCOUNT_SETUP: "เปิดบัญชีในระบบ", BALANCE_UPDATE: "อัปเดตยอด",
  RECONCILIATION: "กระทบยอดสิ้นเดือน", STATEMENT: "Statement", USER: "ผู้ใช้", APPRAISAL: "ประเมิน",
};
const MOVE_LABEL: Record<string, string> = {
  INCOME: "รายได้", EXPENSE: "ค่าใช้จ่าย", TRANSFER: "โอน", FX_EXCHANGE: "แลกเงิน", INVESTMENT_OUT: "โอนเข้าพอร์ต",
  INVESTMENT_IN: "รับจากพอร์ต", LOAN_DISBURSEMENT: "ให้กู้", LOAN_PRINCIPAL_RECEIPT: "รับชำระเงินกู้",
  ASSET_PURCHASE: "ซื้อทรัพย์สิน", ASSET_SALE: "ขายทรัพย์สิน", CARD_PAYMENT: "จ่ายบัตรเครดิต",
  LIABILITY_PAYMENT: "จ่ายหนี้", SECURITY_DEPOSIT_IN: "รับเงินประกัน", SECURITY_DEPOSIT_OUT: "คืนเงินประกัน",
  REIMBURSEMENT_IN: "เงินคืนค่าใช้จ่าย", OTHER_IN: "เงินเข้าอื่น ๆ", OTHER_OUT: "เงินออกอื่น ๆ",
};

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: acc }, { data: bal }, { data: owners }, { data: vals }, { data: moves }, { data: family }, { data: persons }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_bank_balance_current").select("*").eq("asset_id", id).maybeSingle(),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("asset_valuations").select("id,valuation_date,value,source,unexplained_difference,notes")
      .eq("asset_id", id).is("deleted_at", null).order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,amount,fee,counter_amount,description,is_derived,source_entity_type")
      .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`).is("deleted_at", null)
      .order("movement_date", { ascending: false }).limit(50),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (!acc) notFound();

  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/financial/cash/${id}`, "/financial/cash", "/income-expenses"];
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financial/cash" className="text-sm text-slate-500 hover:underline">← Cash &amp; Deposits</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{acc.name}</h1>
        <p className="text-sm text-slate-500">
          {acc.bank_name} · {ACCOUNT_TYPE_LABEL[acc.account_type] ?? acc.account_type} · {acc.currency}
          {acc.account_no_masked && ` · ${acc.account_no_masked}`}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดคงเหลือ (คำนวณ ณ วันนี้)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(bal?.calculated_balance, acc.currency)}</div>
          <div className={`mt-1 text-xs ${bal?.balance_label === "CALCULATED" ? "text-amber-700" : "text-emerald-700"}`}>
            {bal?.balance_label === "CALCULATED" ? "มีรายการหลังวันที่ยืนยันยอด" : "ตรงกับยอดที่ยืนยันล่าสุด"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ยอดที่ยืนยันล่าสุด</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(bal?.confirmed_balance, acc.currency)}</div>
          <div className="mt-1 text-xs text-slate-500">ณ {thDate(bal?.confirmed_date)}</div>
          {bal?.last_unexplained_difference != null && Number(bal.last_unexplained_difference) !== 0 && (
            <div className="mt-1 text-xs text-amber-700">
              ผลต่างที่ยังไม่อธิบาย {money(bal.last_unexplained_difference, acc.currency)} (ตรวจตอนกระทบยอดสิ้นเดือน)
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">เจ้าของบัญชี</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {activeOwners.map((o) => <li key={o.person_name}>{o.person_name} · {Number(o.ownership_percent)}%</li>)}
          </ul>
          {ownerTotal < 100 && <div className="mt-1 text-xs text-amber-700">ยังไม่ระบุเจ้าของ {100 - ownerTotal}%</div>}
          {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={todayBangkok()}
            current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
        </div>
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">อัปเดตยอดคงเหลือ</h2>
          <p className="mb-3 text-xs text-slate-500">
            กรอกยอดจริงจากแอปธนาคาร / Statement · ระบบไม่สร้างรายการค่าใช้จ่ายจากผลต่างให้เอง
          </p>
          <UpdateBalanceForm assetId={id} currency={acc.currency} today={todayBangkok()} minDate={family?.go_live_date ?? ""} />
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">เลขบัญชี</h2>
        <AccountNoPanel assetId={id} bankAccountId={acc.id} masked={acc.account_no_masked}
          canReveal={canEdit} canSet={canWrite} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติยอดที่ยืนยัน</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">วันที่</th><th className="text-right">ยอด</th><th className="pl-4">ที่มา</th>
              <th className="text-right">ผลต่าง</th><th className="pl-4">หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(vals ?? []).map((v) => (
              <tr key={v.id}>
                <td className="py-1.5">{thDate(v.valuation_date)}</td>
                <td className="text-right tabular-nums">{money(v.value)}</td>
                <td className="pl-4">{SOURCE_LABEL[v.source] ?? v.source}</td>
                <td className="text-right tabular-nums text-amber-700">
                  {v.unexplained_difference != null && Number(v.unexplained_difference) !== 0 ? money(v.unexplained_difference) : ""}
                </td>
                <td className="pl-4 text-slate-500">{v.notes}</td>
                <td className="pl-2 text-right">
                  {canWrite && v.source !== "RECONCILIATION" && (
                    <RowActions table="asset_valuations" id={v.id} paths={paths} canDelete={canDelete && (vals ?? []).length > 1}
                      fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                        { name: "value", label: "ยอด", type: "number", value: v.value },
                        { name: "notes", label: "หมายเหตุ", value: v.notes, width: "w-40" }]} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-medium text-slate-900">รายการเงินเข้า–ออก (ล่าสุด 50 รายการ)</h2>
        <p className="mb-3 text-xs text-slate-500">รายการเกิดจากการบันทึกรายได้ ค่าใช้จ่าย การโอน และการลงทุน ในหน้าที่เกี่ยวข้อง</p>
        {(moves ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="text-right">เข้า</th><th className="text-right">ออก</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(moves ?? []).map((m) => {
                const isIn = m.to_asset_id === id;
                const inAmt = isIn ? (m.movement_type === "FX_EXCHANGE" ? m.counter_amount : m.amount) : null;
                const outAmt = !isIn ? Number(m.amount) + Number(m.fee ?? 0) : null;
                return (
                  <tr key={m.id}>
                    <td className="py-1.5">{thDate(m.movement_date)}</td>
                    <td>{MOVE_LABEL[m.movement_type] ?? m.movement_type}</td>
                    <td className="text-slate-500">{m.description}</td>
                    <td className="text-right tabular-nums text-emerald-700">{inAmt != null ? money(inAmt) : ""}</td>
                    <td className="text-right tabular-nums text-red-700">{outAmt != null ? money(outAmt) : ""}</td>
                    <td className="pl-2 text-right">
                      {canWrite && !m.is_derived && !["INCOME", "EXPENSE", "REIMBURSEMENT_IN", "SECURITY_DEPOSIT_OUT", "LOAN_PRINCIPAL_RECEIPT"].includes(m.movement_type) && (
                        <RowActions table="cash_movements" id={m.id} paths={paths} canDelete={canDelete}
                          fields={[{ name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
                            { name: "amount", label: "จำนวน", type: "number", value: m.amount },
                            { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
                      )}
                      {m.is_derived && <span className="text-xs text-slate-400">แก้ที่ต้นทาง</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-medium text-slate-900">แก้ไขข้อมูลบัญชี</h2>
          <p className="mb-3 text-xs text-slate-500">แก้เฉพาะข้อมูลบัญชี ไม่กระทบยอดเงิน</p>
          <EditInfoForm acc={acc} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <StatusSelect table="assets" id={id} value={acc.status} paths={paths}
              options={[["ACTIVE", "ใช้งาน"], ["CLOSED", "ปิดบัญชีแล้ว"]]} label="สถานะบัญชี" />
          </div>
          {canDelete && <div className="mt-4 border-t border-slate-100 pt-3">
            <DeleteEntity kind="asset" id={id} redirectTo="/financial/cash" paths={["/financial/cash"]} label="ลบบัญชีนี้"
              hint="ลบได้เมื่อไม่มีรายการเงินเข้าออกผูกอยู่ · ปิดบัญชีจริงให้เปลี่ยนสถานะในแก้ไขข้อมูล" />
          </div>}
        </section>
      )}
      <EntityDocuments entityType="ASSET" entityId={id} module="FINANCIAL" role={me.role} paths={paths} />
    </div>
  );
}
