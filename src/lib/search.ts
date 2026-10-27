"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";

export type SearchHit = { group: string; label: string; sub?: string; href: string };

/** กลุ่มของสินทรัพย์ตามประเภท (ป้ายในผลค้นหา) */
function assetGroup(group: string, type: string): string {
  if (type === "BANK_ACCOUNT") return "บัญชีธนาคาร";
  if (type === "LOAN_RECEIVABLE") return "เงินให้กู้";
  if (type === "PRIVATE_BUSINESS") return "ธุรกิจ";
  if (type === "INVESTMENT_PORTFOLIO") return "พอร์ตลงทุน";
  if (type === "INSURANCE_CASH_VALUE") return "ประกัน";
  if (group === "PROPERTY") return "อสังหาริมทรัพย์";
  if (group === "ALTERNATIVE") return "สินทรัพย์อื่น";
  return "สินทรัพย์";
}
const STATUS: Record<string, string> = { SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย", CLOSED: "ปิดแล้ว", INACTIVE: "ไม่ได้ใช้งาน" };
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

/**
 * ช่องค้นหาด้านบน (27 ต.ค. 2026 · ระยะแรก): ค้นจากชื่อ / เลขที่ของรายการหลัก ตามสิทธิ์ (RLS) ของผู้ใช้
 * ค้นเฉพาะตอนพิมพ์ · ไม่ค้นรายการรายรับ-รายจ่าย (ระยะถัดไป)
 */
export async function searchAll(raw: string): Promise<SearchHit[]> {
  const q = raw.replace(/[%,()*\\]/g, " ").trim();
  if (q.length < 2) return [];
  await requireAppUser();
  const supabase = await createClient();
  const like = `%${q}%`;
  const N = 8;
  const [assets, holds, cards, liabs, persons, docs, pols] = await Promise.all([
    supabase.from("assets").select("id,name,asset_group,asset_type,status").is("deleted_at", null).ilike("name", like).order("name").limit(N * 2),
    supabase.from("investment_holdings").select("id,name,symbol,investment_portfolios(asset_id,assets(name))").is("deleted_at", null)
      .or(`name.ilike.${like},symbol.ilike.${like}`).limit(N),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4").is("deleted_at", null)
      .or(`issuer.ilike.${like},card_name.ilike.${like},card_last4.ilike.${like}`).limit(N),
    supabase.from("liabilities").select("id,name,lender").is("deleted_at", null).or(`name.ilike.${like},lender.ilike.${like}`).limit(N),
    supabase.from("persons").select("id,name").is("deleted_at", null).ilike("name", like).limit(N),
    supabase.from("documents").select("id,title,document_type").is("deleted_at", null).eq("version_status", "CURRENT")
      .or(`title.ilike.${like},document_type.ilike.${like}`).limit(N),
    supabase.from("insurance_policies").select("id,insurer,policy_no").is("deleted_at", null).or(`insurer.ilike.${like},policy_no.ilike.${like}`).limit(N),
  ]);
  const hits: SearchHit[] = [];
  for (const a of assets.data ?? []) {
    // ประกันที่มีมูลค่าเงินสด = แสดงจากกรมธรรม์แทน
    if (a.asset_type === "INSURANCE_CASH_VALUE") continue;
    hits.push({ group: assetGroup(a.asset_group, a.asset_type), label: a.name, sub: a.status !== "ACTIVE" ? STATUS[a.status] ?? a.status : undefined, href: `/a/${a.id}` });
  }
  for (const h of holds.data ?? []) {
    const pf = one(h.investment_portfolios as unknown as { asset_id: string; assets: { name: string } | { name: string }[] | null } | null);
    if (pf) hits.push({ group: "หลักทรัพย์", label: h.symbol ? `${h.symbol} · ${h.name}` : h.name, sub: one(pf.assets)?.name, href: `/investments/${pf.asset_id}/holding/${h.id}` });
  }
  for (const c of cards.data ?? []) hits.push({ group: "บัตรเครดิต", label: [c.issuer, c.card_name].filter(Boolean).join(" "), sub: c.card_last4 ? `•••• ${c.card_last4}` : undefined, href: `/liabilities/cards/${c.id}` });
  for (const l of liabs.data ?? []) hits.push({ group: "หนี้สิน", label: l.name, sub: l.lender ?? undefined, href: `/liabilities/${l.id}` });
  for (const p of pols.data ?? []) hits.push({ group: "ประกัน", label: p.insurer, sub: p.policy_no ?? undefined, href: `/insurance/${p.id}` });
  for (const p of persons.data ?? []) hits.push({ group: "สมาชิก", label: p.name, href: `/family/members/${p.id}` });
  for (const d of docs.data ?? []) hits.push({ group: "เอกสาร", label: d.title, sub: d.document_type ?? undefined, href: `/family/documents?q=${encodeURIComponent(d.title)}` });
  // เรียงตามกลุ่ม (คงลำดับในกลุ่ม)
  const order = ["บัญชีธนาคาร", "พอร์ตลงทุน", "หลักทรัพย์", "เงินให้กู้", "ธุรกิจ", "อสังหาริมทรัพย์", "สินทรัพย์อื่น", "ประกัน", "บัตรเครดิต", "หนี้สิน", "สมาชิก", "เอกสาร", "สินทรัพย์"];
  return hits.map((h, i) => ({ h, i })).sort((a, b) => order.indexOf(a.h.group) - order.indexOf(b.h.group) || a.i - b.i).map((x) => x.h);
}
