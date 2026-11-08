import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INS_TYPE, todayBangkok } from "@/lib/format";
import NewPolicyForm from "./NewPolicyForm";
import { InfoTip } from "@/components/HeaderBar";

// ?type=PROPERTY&asset=<id>: กดจากกล่อง "ประกันของทรัพย์สินนี้" ในหน้าทรัพย์สิน → เลือกประเภท / ทรัพย์สินไว้ให้ (ตกลง 3 พ.ย. 2026)
export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<{ type?: string; asset?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: assets }, { data: banks }, { data: cards }] = await Promise.all([
    supabase.from("families").select("id").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_assets_active").select("id,name").in("asset_group", ["PROPERTY", "ALTERNATIVE"]).eq("status", "ACTIVE").order("name"),
    // จ่ายเบี้ยจาก (ค่าตั้งต้น · ตกลง 3 พ.ย. 2026)
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  const initialType = INS_TYPE.some(([k]) => k === sp.type) ? (sp.type as string) : "LIFE";
  const initialAsset = initialType === "PROPERTY" && (assets ?? []).some((a) => a.id === sp.asset) ? (sp.asset as string) : "";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-1 text-2xl font-semibold text-slate-900">เพิ่มกรมธรรม์ประกัน <InfoTip label="คำอธิบาย">ประกันชีวิต / สุขภาพ / อุบัติเหตุ / ทรัพย์สิน · กรมธรรม์ที่มีมูลค่าเวนคืนนับเป็นสินทรัพย์ (ใส่ตารางมูลค่าเวนคืนได้ที่หน้ากรมธรรม์หลังบันทึก · ระบบสร้างและลงยอดให้เอง)</InfoTip></h1>
      </div>
      <NewPolicyForm persons={persons ?? []} assets={assets ?? []} initialType={initialType} initialAsset={initialAsset}
        banks={(banks ?? []) as { asset_id: string; name: string; currency: string; frequent: boolean | null }[]}
        cards={(cards ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string,
          label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }))}
        today={todayBangkok()} />
    </div>
  );
}
