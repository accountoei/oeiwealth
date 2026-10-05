import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { addDays, money, thDate } from "@/lib/format";
import ConfirmGoLive from "./ConfirmGoLive";

type Row = {
  category: string; entity_type: string; entity_id: string | null; name: string; currency: string | null;
  opening_value: number | null; opening_date: string | null; status: string; message: string | null;
};

const CATEGORY: { key: string; label: string }[] = [
  { key: "SYSTEM", label: "ระบบและสมาชิก" },
  { key: "CASH", label: "บัญชีเงินฝาก" },
  { key: "FINANCIAL", label: "สินทรัพย์ทางการเงินอื่น (เงินให้กู้ / ธุรกิจ / มูลค่าเวนคืนประกัน)" },
  { key: "INVESTMENT", label: "การลงทุน" },
  { key: "PROPERTY", label: "อสังหาริมทรัพย์" },
  { key: "ALTERNATIVE", label: "ทรัพย์สินอื่น" },
  { key: "LIABILITY", label: "หนี้สินและบัตรเครดิต" },
  { key: "OWNERSHIP", label: "การระบุเจ้าของ" },
  { key: "FX", label: "อัตราแลกเปลี่ยน" },
];

const BADGE: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WARN: "bg-amber-50 text-amber-800 border-amber-200",
  MISSING: "bg-red-50 text-red-700 border-red-200",
  NOT_REQUIRED: "bg-slate-50 text-slate-500 border-slate-200",
};
const STATUS_LABEL: Record<string, string> = { READY: "พร้อม", WARN: "ควรตรวจ", MISSING: "ยังขาด", NOT_REQUIRED: "ไม่ต้องมี" };

// ลิงก์ไปหน้าที่ใช้แก้รายการนั้น (หน้าที่ยังไม่ทำจะเป็นหน้า "อยู่ระหว่างพัฒนา")
function fixLink(r: Row): string {
  switch (r.entity_type) {
    case "PERSON": case "APP_USER": return "/settings/family-users";
    case "FX_RATE": return "/settings/system";
    case "CREDIT_CARD": return "/family/cards";
    case "LIABILITY": return "/liabilities";
    case "HOLDING": return "/investments";
    case "LOAN": return "/financial/loans";
    case "INSURANCE_POLICY": return "/insurance";
  }
  if (r.category === "CASH" && r.entity_id) return `/financial/cash/${r.entity_id}`;
  if (r.category === "OWNERSHIP" && r.entity_type === "ASSET") return "/financial/cash";
  if (r.category === "PROPERTY") return "/property";
  if (r.category === "ALTERNATIVE") return "/alternative";
  if (r.category === "FINANCIAL") return "/financial/business";
  return "/";
}

export default async function OpeningSetupPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: rows, error }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status,go_live_confirmed_at").maybeSingle(),
    supabase.from("v_go_live_readiness").select("category,entity_type,entity_id,name,currency,opening_value,opening_date,status,message"),
  ]);
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;

  const list = (rows as Row[] | null) ?? [];
  const count = (s: string) => list.filter((r) => r.status === s).length;
  const order = { MISSING: 0, WARN: 1, READY: 2, NOT_REQUIRED: 3 } as Record<string, number>;
  const isLive = family.system_status === "LIVE";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Opening Setup</h1>
        <p className="text-sm text-slate-500">
          ตรวจยอดตั้งต้นก่อน Go-live · Go-live {thDate(family.go_live_date)} · ยอดตั้งต้น = ยอด ณ สิ้นวัน {thDate(addDays(family.go_live_date, -1))}
        </p>
      </div>

      {isLive ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          ระบบ LIVE แล้ว (ยืนยันเมื่อ {thDate(family.go_live_confirmed_at)}) · ยอดตั้งต้นถูกล็อก แก้ได้เฉพาะ ADMIN พร้อมเหตุผล
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-3">
          {(["MISSING", "WARN", "READY"] as const).map((s) => (
            <div key={s} className={`rounded-xl border p-4 ${BADGE[s]}`}>
              <div className="text-xs">{STATUS_LABEL[s]}</div>
              <div className="text-2xl font-semibold">{count(s)}</div>
            </div>
          ))}
        </section>
      )}

      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      {list.length === 0 && !error && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          ยังไม่มีรายการ — เริ่มเพิ่มสมาชิก บัญชีเงินฝาก และทรัพย์สินอื่น ๆ ระบบจะตรวจความพร้อมให้อัตโนมัติ
        </p>
      )}

      {CATEGORY.map(({ key, label }) => {
        const items = list.filter((r) => r.category === key).sort((a, b) => order[a.status] - order[b.status]);
        if (items.length === 0) return null;
        return (
          <section key={key} className="rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-5 py-3 font-medium text-slate-900">{label}</h2>
            <ul className="divide-y divide-slate-100">
              {items.map((r, i) => (
                <li key={`${r.entity_type}-${r.entity_id ?? r.name}-${i}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className={`rounded border px-2 py-0.5 text-xs ${BADGE[r.status]}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span className="min-w-40 flex-1 font-medium text-slate-800">{r.name}</span>
                  <span className="tabular-nums text-slate-600">
                    {r.opening_value != null && r.category !== "OWNERSHIP" ? money(r.opening_value, r.currency ?? undefined) : ""}
                    {r.opening_date && r.category !== "OWNERSHIP" ? ` · ${thDate(r.opening_date)}` : ""}
                  </span>
                  {r.message && <span className="w-full text-xs text-slate-500 sm:w-auto">{r.message}</span>}
                  {(r.status === "MISSING" || r.status === "WARN") && (
                    <Link href={fixLink(r)} className="text-xs text-slate-700 underline">ไปแก้</Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {!isLive && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">Confirm Go-live</h2>
          {me.role === "ADMIN"
            ? <ConfirmGoLive missing={count("MISSING")} warn={count("WARN")} goLive={thDate(family.go_live_date)} />
            : <p className="text-sm text-slate-500">เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้นที่ Confirm Go-live ได้</p>}
        </section>
      )}
    </div>
  );
}
