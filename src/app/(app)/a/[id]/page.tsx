import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** ลิงก์กลางไปหน้ารายละเอียดของสินทรัพย์ตามประเภท (ใช้จาก Checklist / Opening Setup) */
export default async function AssetRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from("assets").select("id,asset_group,asset_type").eq("id", id).maybeSingle();
  if (!a) notFound();
  if (a.asset_type === "BANK_ACCOUNT") redirect(`/financial/cash/${id}`);
  if (a.asset_type === "LOAN_RECEIVABLE") redirect(`/financial/loans/${id}`);
  if (a.asset_type === "PRIVATE_BUSINESS") redirect(`/financial/business/${id}`);
  if (a.asset_type === "INVESTMENT_PORTFOLIO") redirect(`/investments/${id}`);
  if (a.asset_type === "INSURANCE_CASH_VALUE") {
    const { data: p } = await supabase.from("insurance_policies").select("id").eq("cash_value_asset_id", id).maybeSingle();
    redirect(p ? `/insurance/${p.id}` : "/insurance");
  }
  if (a.asset_group === "PROPERTY") redirect(`/property/${id}`);
  if (a.asset_group === "ALTERNATIVE") redirect(`/alternative/${id}`);
  redirect("/");
}
