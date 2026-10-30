"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INCOME_TYPE_LABEL, ITX_LABEL, MOVE_LABEL, money, thDate } from "@/lib/format";

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
const MONEY_GROUP = "รายการเงิน";
type MoneyRow = { kind: "INCOME" | "EXPENSE" | "MOVE" | "INVEST"; id: string; d: string; title: string | null; type: string | null;
  amount: number; currency: string; account: string | null; portfolio_asset_id: string | null; holding_id: string | null };

/** ผลค้นหารายการเงิน → ลิงก์ไปเดือน / แท็บ / หลักทรัพย์ของรายการ + ?hl= ให้หน้าปลายทางเลื่อนไปไฮไลต์บรรทัด (RowHighlight) */
function moneyHit(m: MoneyRow): SearchHit {
  const ym = m.d.slice(0, 7);
  const typeLabel = m.kind === "INCOME" ? INCOME_TYPE_LABEL[m.type ?? ""] ?? "รายได้"
    : m.kind === "EXPENSE" ? "ค่าใช้จ่าย"
    : m.kind === "MOVE" ? MOVE_LABEL[m.type ?? ""] ?? "เงินเข้า–ออก"
    : ITX_LABEL[m.type ?? ""] ?? "รายการพอร์ต";
  const href = m.kind === "INCOME" ? `/income-expenses?tab=income&m=${ym}&hl=i-${m.id}`
    : m.kind === "EXPENSE" ? `/income-expenses?tab=expense&m=${ym}&hl=e-${m.id}`
    : m.kind === "MOVE" ? `/income-expenses?tab=overview&m=${ym}&hl=m-${m.id}`
    : m.holding_id ? `/investments/${m.portfolio_asset_id}/holding/${m.holding_id}?hl=x-${m.id}`
    : `/investments/${m.portfolio_asset_id}?tab=tx&m=${ym}&hl=x-${m.id}`;
  const label = [`${typeLabel}${m.title && m.title !== m.type ? ` · ${m.title}` : ""}`, m.account].filter(Boolean).join(" · ");
  return { group: MONEY_GROUP, label, sub: `${thDate(m.d)} · ${money(m.amount, m.currency)}`, href };
}

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

/**
 * ช่องค้นหาด้านบน (27 ต.ค. 2026 · ระยะแรก): ค้นจากชื่อ / เลขที่ของรายการหลัก ตามสิทธิ์ (RLS) ของผู้ใช้
 * ค้นเฉพาะตอนพิมพ์ · รายการเงิน (รายได้ · ค่าใช้จ่าย · เงินเข้า–ออก · รายการพอร์ต) ค้นด้วย RPC search_money ครั้งเดียว (30 ต.ค. 2026)
 */
export async function searchAll(raw: string): Promise<SearchHit[]> {
  const q = raw.replace(/[%,()*\\]/g, " ").trim();
  if (q.length < 2) return [];
  await requireAppUser();
  const supabase = await createClient();
  const like = `%${q}%`;
  const N = 8;
  const [assets, holds, cards, liabs, persons, docs, pols, money_] = await Promise.all([
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
    supabase.rpc("search_money", { p_q: raw.trim(), p_limit: 20 }),
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
  for (const m of (money_.data as MoneyRow[] | null) ?? []) hits.push(moneyHit(m));
  // เรียงตามกลุ่ม (คงลำดับในกลุ่ม) · รายการเงินอยู่ท้ายสุด (ล่าสุดก่อน)
  const order = ["บัญชีธนาคาร", "พอร์ตลงทุน", "หลักทรัพย์", "เงินให้กู้", "ธุรกิจ", "อสังหาริมทรัพย์", "สินทรัพย์อื่น", "ประกัน", "บัตรเครดิต", "หนี้สิน", "สมาชิก", "เอกสาร", "สินทรัพย์", MONEY_GROUP];
  return hits.map((h, i) => ({ h, i })).sort((a, b) => order.indexOf(a.h.group) - order.indexOf(b.h.group) || a.i - b.i).map((x) => x.h);
}
