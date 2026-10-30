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

type Sb = Awaited<ReturnType<typeof createClient>>;
type Q = PromiseLike<{ data: unknown[] | null }>;
/** ค้น 1 แหล่ง: ตาราง → แปลงแต่ละแถวเป็นผลค้นหา (ข้ามแถวที่คืน null) */
type Source = { q: (sb: Sb, like: string, n: number) => Q; hit: (r: Rec) => SearchHit | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const ors = (like: string, cols: string[]) => cols.map((c) => `${c}.ilike.${like}`).join(",");
/** ข้อความสั้น ๆ ที่ตรงคำค้น (หมายเหตุ / รายละเอียดยาว ๆ) */
const snip = (q: string, ...xs: (string | null | undefined)[]) => {
  const t = q.toLowerCase();
  const x = xs.find((v) => v && v.toLowerCase().includes(t));
  if (!x) return undefined;
  const i = x.toLowerCase().indexOf(t);
  return (i > 20 ? "…" : "") + x.slice(Math.max(0, i - 20), i + t.length + 30).trim() + (i + t.length + 30 < x.length ? "…" : "");
};
const assetOf = (x: unknown) => one(x as Rec | Rec[] | null);

/**
 * แหล่งค้นหา
 * - QUICK = กล่องใต้ช่องค้นหาตอนพิมพ์ (ชื่อ / เลขที่ของรายการหลัก) · 8 ต่อแหล่ง
 * - FULL = หน้า "ผลการค้นหา" (กด Enter) ค้นทุกข้อมูลที่มีชื่อ / หมายเหตุ · 50 ต่อแหล่ง (ตกลง 30 ต.ค. 2026)
 * ทุกแหล่งผ่าน RLS ของผู้ใช้ และไม่แสดงรายการที่ลบแล้ว
 */
function sources(q: string, full: boolean): Source[] {
  const S: Source[] = [
    { q: (sb, like, n) => sb.from("assets").select("id,name,notes,asset_group,asset_type,status").is("deleted_at", null)
        .or(ors(like, full ? ["name", "notes"] : ["name"])).order("name").limit(n * 2),
      // ประกันที่มีมูลค่าเงินสด = แสดงจากกรมธรรม์แทน
      hit: (a) => a.asset_type === "INSURANCE_CASH_VALUE" ? null : { group: assetGroup(a.asset_group, a.asset_type), label: a.name,
        sub: a.status !== "ACTIVE" ? STATUS[a.status] ?? a.status : full ? snip(q, a.notes) : undefined, href: `/a/${a.id}` } },
    { q: (sb, like, n) => sb.from("investment_holdings").select("id,name,symbol,notes,purpose,investment_portfolios(asset_id,assets(name))").is("deleted_at", null)
        .or(ors(like, full ? ["name", "symbol", "notes", "purpose"] : ["name", "symbol"])).limit(n),
      hit: (h) => {
        const pf = one(h.investment_portfolios as Rec | Rec[] | null);
        return pf ? { group: "หลักทรัพย์", label: h.symbol ? `${h.symbol} · ${h.name}` : h.name, sub: assetOf(pf.assets)?.name,
          href: `/investments/${pf.asset_id}/holding/${h.id}` } : null;
      } },
    { q: (sb, like, n) => sb.from("credit_cards").select("id,issuer,card_name,card_last4,notes").is("deleted_at", null)
        .or(ors(like, full ? ["issuer", "card_name", "card_last4", "notes"] : ["issuer", "card_name", "card_last4"])).limit(n),
      hit: (c) => ({ group: "บัตรเครดิต", label: [c.issuer, c.card_name].filter(Boolean).join(" "), sub: c.card_last4 ? `•••• ${c.card_last4}` : undefined, href: `/liabilities/cards/${c.id}` }) },
    { q: (sb, like, n) => sb.from("liabilities").select("id,name,lender,notes").is("deleted_at", null)
        .or(ors(like, full ? ["name", "lender", "notes"] : ["name", "lender"])).limit(n),
      hit: (l) => ({ group: "หนี้สิน", label: l.name, sub: l.lender ?? undefined, href: `/liabilities/${l.id}` }) },
    { q: (sb, like, n) => sb.from("insurance_policies").select("id,insurer,policy_no,notes").is("deleted_at", null)
        .or(ors(like, full ? ["insurer", "policy_no", "notes"] : ["insurer", "policy_no"])).limit(n),
      hit: (p) => ({ group: "ประกัน", label: p.insurer, sub: p.policy_no ?? undefined, href: `/insurance/${p.id}` }) },
    { q: (sb, like, n) => sb.from("persons").select("id,name,nickname,full_name_th,full_name_en,phone,email,occupation,workplace,job_title,notes").is("deleted_at", null)
        .or(ors(like, full ? ["name", "nickname", "full_name_th", "full_name_en", "phone", "email", "occupation", "workplace", "job_title", "notes"] : ["name", "nickname"])).limit(n),
      hit: (p) => ({ group: "สมาชิก", label: p.name, sub: full ? snip(q, p.full_name_th, p.full_name_en, p.nickname, p.occupation, p.workplace, p.job_title, p.notes) : undefined,
        href: `/family/members/${p.id}` }) },
    { q: (sb, like, n) => sb.from("documents").select("id,title,document_type,notes").is("deleted_at", null).eq("version_status", "CURRENT")
        .or(ors(like, full ? ["title", "document_type", "notes"] : ["title", "document_type"])).limit(n),
      hit: (d) => ({ group: "เอกสาร", label: d.title, sub: d.document_type ?? undefined, href: `/family/documents?q=${encodeURIComponent(d.title)}` }) },
    // ผู้เช่า / ผู้กู้ / สมาชิกภาพ / แต้ม / เลขโฉนด (ตกลง 30 ต.ค. 2026)
    { q: (sb, like, n) => sb.from("property_leases").select("id,tenant_name,unit_label,contract_no,notes,property_details(asset_id,assets(name))").is("deleted_at", null)
        .or(ors(like, full ? ["tenant_name", "unit_label", "contract_no", "notes"] : ["tenant_name"])).limit(n),
      hit: (l) => {
        const pd = one(l.property_details as Rec | Rec[] | null);
        return pd ? { group: "ผู้เช่า", label: l.tenant_name || l.unit_label || "สัญญาเช่า",
          sub: [assetOf(pd.assets)?.name, l.unit_label].filter(Boolean).join(" · ") || undefined, href: `/property/${pd.asset_id}` } : null;
      } },
    { q: (sb, like, n) => sb.from("loan_details").select("id,asset_id,borrower_name,contract_no,purpose,notes,assets(name)").is("deleted_at", null)
        .or(ors(like, full ? ["borrower_name", "contract_no", "purpose", "notes"] : ["borrower_name"])).limit(n),
      hit: (l) => ({ group: "ผู้กู้", label: l.borrower_name || assetOf(l.assets)?.name || "เงินให้กู้", sub: assetOf(l.assets)?.name, href: `/financial/loans/${l.asset_id}` }) },
    { q: (sb, like, n) => sb.from("memberships").select("id,program_name,tier,benefits,notes").is("deleted_at", null)
        .or(ors(like, full ? ["program_name", "tier", "benefits", "notes"] : ["program_name"])).limit(n),
      hit: (m) => ({ group: "สมาชิกภาพ / แต้ม", label: m.program_name, sub: m.tier ?? undefined, href: "/family/memberships" }) },
    { q: (sb, like, n) => sb.from("points_accounts").select("id,program_name").is("deleted_at", null).ilike("program_name", like).limit(n),
      hit: (m) => ({ group: "สมาชิกภาพ / แต้ม", label: m.program_name, sub: "แต้มสะสม / ไมล์", href: "/family/memberships" }) },
    { q: (sb, like, n) => sb.from("property_details").select("id,asset_id,title_deed_no,land_no,address,subdistrict,district,province,notes,assets(name)").is("deleted_at", null)
        .or(ors(like, full ? ["title_deed_no", "land_no", "address", "subdistrict", "district", "province", "notes"] : ["title_deed_no", "land_no"])).limit(n),
      hit: (p) => ({ group: "อสังหาริมทรัพย์", label: assetOf(p.assets)?.name ?? "ทรัพย์สิน",
        sub: snip(q, p.title_deed_no ? `โฉนด ${p.title_deed_no}` : null, p.land_no ? `เลขที่ดิน ${p.land_no}` : null, p.address, p.subdistrict, p.district, p.province, p.notes),
        href: `/property/${p.asset_id}` }) },
    { q: (sb, like, n) => sb.from("property_deeds").select("id,title_deed_no,land_no,label,notes,property_details(asset_id,assets(name))").is("deleted_at", null)
        .or(ors(like, full ? ["title_deed_no", "land_no", "label", "notes"] : ["title_deed_no", "land_no"])).limit(n),
      hit: (d) => {
        const pd = one(d.property_details as Rec | Rec[] | null);
        return pd ? { group: "อสังหาริมทรัพย์", label: assetOf(pd.assets)?.name ?? "ทรัพย์สิน",
          sub: snip(q, d.title_deed_no ? `โฉนด ${d.title_deed_no}` : null, d.land_no ? `เลขที่ดิน ${d.land_no}` : null, d.label, d.notes), href: `/property/${pd.asset_id}` } : null;
      } },
  ];
  if (!full) return S;
  // หน้า "ผลการค้นหา": รายละเอียด / หมายเหตุของข้อมูลอื่น ๆ
  const assetLink = (group: string, fields: string[], cols: string) => ({
    q: (sb: Sb, like: string, n: number) => sb.from(group).select(`asset_id,${cols},assets(name,asset_group,asset_type)`).is("deleted_at", null).or(ors(like, fields)).limit(n),
    hit: (r: Rec) => {
      const a = assetOf(r.assets);
      return a ? { group: assetGroup(a.asset_group, a.asset_type), label: a.name, sub: snip(q, ...fields.map((f) => r[f])), href: `/a/${r.asset_id}` } : null;
    },
  });
  return [...S,
    assetLink("bank_accounts", ["bank_name", "account_name", "branch", "notes"], "bank_name,account_name,branch,notes"),
    assetLink("investment_portfolios", ["institution", "notes"], "institution,notes"),
    assetLink("private_business_details", ["company_name", "registration_no", "notes"], "company_name,registration_no,notes"),
    assetLink("alternative_asset_details", ["brand", "model", "serial_no", "storage_location", "details"], "brand,model,serial_no,storage_location,details"),
    { q: (sb, like, n) => sb.from("property_utilities").select("id,provider,account_no,meter_no,notes,property_details(asset_id,assets(name))").is("deleted_at", null)
        .or(ors(like, ["provider", "account_no", "meter_no", "notes"])).limit(n),
      hit: (u) => {
        const pd = one(u.property_details as Rec | Rec[] | null);
        return pd ? { group: "อสังหาริมทรัพย์", label: assetOf(pd.assets)?.name ?? "ทรัพย์สิน",
          sub: snip(q, u.provider, u.account_no, u.meter_no, u.notes), href: `/property/${pd.asset_id}` } : null;
      } },
    { q: (sb, like, n) => sb.from("insurance_beneficiaries").select("policy_id,beneficiary_name,insurance_policies(insurer)").is("deleted_at", null).ilike("beneficiary_name", like).limit(n),
      hit: (b) => ({ group: "ประกัน", label: assetOf(b.insurance_policies)?.insurer ?? "กรมธรรม์", sub: `ผู้รับประโยชน์ ${b.beneficiary_name}`, href: `/insurance/${b.policy_id}` }) },
    { q: (sb, like, n) => sb.from("insurance_coverages").select("policy_id,notes,insurance_policies(insurer)").is("deleted_at", null).ilike("notes", like).limit(n),
      hit: (c) => ({ group: "ประกัน", label: assetOf(c.insurance_policies)?.insurer ?? "กรมธรรม์", sub: snip(q, c.notes), href: `/insurance/${c.policy_id}` }) },
    { q: (sb, like, n) => sb.from("insurance_claims").select("policy_id,notes,insurance_policies(insurer)").is("deleted_at", null).ilike("notes", like).limit(n),
      hit: (c) => ({ group: "ประกัน", label: assetOf(c.insurance_policies)?.insurer ?? "กรมธรรม์", sub: snip(q, c.notes), href: `/insurance/${c.policy_id}` }) },
    { q: (sb, like, n) => sb.from("health_checkups").select("person_id,checkup_date,hospital,package_name,notes,persons(name)").is("deleted_at", null)
        .or(ors(like, ["hospital", "package_name", "notes"])).limit(n),
      hit: (h) => ({ group: "สุขภาพ", label: [assetOf(h.persons)?.name, h.hospital].filter(Boolean).join(" · ") || "ตรวจสุขภาพ",
        sub: [h.checkup_date ? thDate(h.checkup_date) : null, snip(q, h.package_name, h.notes)].filter(Boolean).join(" · ") || undefined,
        href: `/family/health?p=${h.person_id}` }) },
    { q: (sb, like, n) => sb.from("donation_records").select("id,donee_name,purpose,project_name,receipt_no,notes").is("deleted_at", null)
        .or(ors(like, ["donee_name", "purpose", "project_name", "receipt_no", "notes"])).limit(n),
      hit: (d) => ({ group: "บริจาค", label: d.donee_name || d.project_name || "การบริจาค", sub: snip(q, d.purpose, d.project_name, d.receipt_no, d.notes), href: "/family/donations" }) },
    { q: (sb, like, n) => sb.from("tax_returns").select("id,person_id,tax_year,reference_no,notes").is("deleted_at", null)
        .or(ors(like, ["reference_no", "notes"])).limit(n),
      hit: (t) => ({ group: "ภาษี", label: `ภาษีปี ${Number(t.tax_year) + 543}`, sub: snip(q, t.reference_no, t.notes), href: `/family/tax?p=${t.person_id}&y=${t.tax_year}` }) },
    { q: (sb, like, n) => sb.from("recurring_income_templates").select("id,name,notes").is("deleted_at", null).or(ors(like, ["name", "notes"])).limit(n),
      hit: (t) => ({ group: "รายการประจำ", label: t.name, sub: "รายได้ประจำ", href: "/income-expenses?tab=settings&st=income" }) },
    { q: (sb, like, n) => sb.from("recurring_expense_templates").select("id,name,notes").is("deleted_at", null).or(ors(like, ["name", "notes"])).limit(n),
      hit: (t) => ({ group: "รายการประจำ", label: t.name, sub: "ค่าใช้จ่ายประจำ", href: "/income-expenses?tab=settings&st=expense" }) },
  ];
}

// เรียงตามกลุ่ม (คงลำดับในกลุ่ม) · รายการเงินอยู่ท้ายสุด (ล่าสุดก่อน)
const ORDER = ["บัญชีธนาคาร", "พอร์ตลงทุน", "หลักทรัพย์", "เงินให้กู้", "ผู้กู้", "ธุรกิจ", "อสังหาริมทรัพย์", "ผู้เช่า", "สินทรัพย์อื่น", "ประกัน",
  "บัตรเครดิต", "หนี้สิน", "สมาชิก", "สมาชิกภาพ / แต้ม", "สุขภาพ", "บริจาค", "ภาษี", "เอกสาร", "รายการประจำ", "สินทรัพย์", MONEY_GROUP];

async function run(raw: string, full: boolean): Promise<SearchHit[]> {
  const q = raw.replace(/[%,()*\\]/g, " ").trim();
  if (q.length < 2) return [];
  await requireAppUser();
  const supabase = await createClient();
  const like = `%${q}%`;
  const N = full ? 50 : 8;
  const src = sources(q, full);
  const [rows, money_] = await Promise.all([
    Promise.all(src.map((s) => s.q(supabase, like, N))),
    supabase.rpc("search_money", { p_q: raw.trim(), p_limit: full ? 50 : 20 }),
  ]);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    for (const x of r.data ?? []) {
      const h = src[i].hit(x as Rec);
      // ซ้ำ (เช่น ทรัพย์สินเดียวกันเจอทั้งจากชื่อและหมายเหตุ) → แสดงครั้งเดียว
      if (!h || seen.has(`${h.group}|${h.href}|${h.label}`)) continue;
      seen.add(`${h.group}|${h.href}|${h.label}`);
      hits.push(h);
    }
  });
  for (const m of (money_.data as MoneyRow[] | null) ?? []) hits.push(moneyHit(m));
  const rank = (g: string) => { const i = ORDER.indexOf(g); return i < 0 ? ORDER.length : i; };
  return hits.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h.group) - rank(b.h.group) || a.i - b.i).map((x) => x.h);
}

/**
 * ช่องค้นหาด้านบน (27 ต.ค. 2026): ค้นจากชื่อ / เลขที่ของรายการหลัก ตามสิทธิ์ (RLS) ของผู้ใช้ · ค้นเฉพาะตอนพิมพ์
 * รายการเงิน (รายได้ · ค่าใช้จ่าย · เงินเข้า–ออก · รายการพอร์ต) ค้นด้วย RPC search_money ครั้งเดียว (30 ต.ค. 2026)
 */
export async function searchAll(raw: string): Promise<SearchHit[]> {
  return run(raw, false);
}

/** หน้า "ผลการค้นหา" (กด Enter): ค้นทุกข้อมูลที่มีชื่อ / หมายเหตุ ผลมากกว่ากล่องตอนพิมพ์ */
export async function searchFull(raw: string): Promise<SearchHit[]> {
  return run(raw, true);
}
