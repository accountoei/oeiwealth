import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INS_TYPE, addDays, todayBangkok } from "@/lib/format";
import NewPolicyForm from "./NewPolicyForm";

// ?type=PROPERTY&asset=<id>: กดจากกล่อง "ประกันของทรัพย์สินนี้" ในหน้าทรัพย์สิน → เลือกประเภท / ทรัพย์สินไว้ให้ (ตกลง 3 พ.ย. 2026)
export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<{ type?: string; asset?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: family }, { data: persons }, { data: assets }] = await Promise.all([
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_assets_active").select("id,name").in("asset_group", ["PROPERTY", "ALTERNATIVE"]).eq("status", "ACTIVE").order("name"),
  ]);
  if (me.role === "VIEWER") return <p className="text-sm text-slate-600">สิทธิ์ผู้ดูเพิ่มรายการไม่ได้</p>;
  if (!family) return <p className="text-sm text-red-600">ไม่พบข้อมูลครอบครัว</p>;
  const initialType = INS_TYPE.some(([k]) => k === sp.type) ? (sp.type as string) : "LIFE";
  const initialAsset = initialType === "PROPERTY" && (assets ?? []).some((a) => a.id === sp.asset) ? (sp.asset as string) : "";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">เพิ่มกรมธรรม์ประกัน</h1>
        <p className="text-sm text-slate-500">ประกันชีวิต / สุขภาพ / อุบัติเหตุ / ทรัพย์สิน · กรมธรรม์ที่มีมูลค่าเวนคืนนับเป็นสินทรัพย์</p>
      </div>
      <NewPolicyForm persons={persons ?? []} assets={assets ?? []} goLive={family.go_live_date} initialType={initialType} initialAsset={initialAsset}
        openingDate={addDays(family.go_live_date, -1)} today={todayBangkok()}
        isSetup={family.system_status === "SETUP"} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
