import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_STATUS, INS_TYPE, addDays, deathCoverage, insCountedPaid, money, monthOptions, monthRange, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";
import { ShareBox, SHARE_COLORS, type ShareRow } from "@/components/ShareTable";
import MemberShareBox, { type MemberShareRow } from "./MemberShareBox";
import UrlSelect from "@/components/UrlSelect";
import { payDefaultValue } from "./PayDefaultSelect";
import InsuranceBatch, { type BoxPolicy, type PayOpt, type YLine } from "./InsuranceBatch";
import CoverageTab, { type CovClaim, type CovItem, type CovPolicy } from "./CoverageTab";
import { recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { premiumPaymentFields } from "@/lib/source-edit";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { endpointValue } from "@/lib/money-endpoint";
import UndoButton from "@/components/UndoButton";
import { PART_LABEL, bookletCount, bookletGroups, bookletOrder, bookletRole, partLabel } from "@/lib/insurance-booklet";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);
// ความคุ้มครองต่อจากภาพรวม (ตกลง 3 พ.ย. 2026 · เดิมอยู่ท้ายสุด) · เลิกแท็บอัปเดตมูลค่าเวนคืน (8 พ.ย. 2026 · ลงตามตารางเองทุกวัน · ปรับรายเล่มที่หน้ากรมธรรม์)
const TABS = [["overview", "ภาพรวม"], ["coverage", "ความคุ้มครอง"], ["benefit", "บันทึกรับผลประโยชน์"], ["premium", "จ่ายชำระเบี้ยประกัน"]] as const;

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; s?: string; yb?: string; yp?: string; tab?: string; m?: string; i?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/insurance"];
  const sortMap = await loadSortMap("insurance_policies");
  const supabase = await createClient();
  const today = todayBangkok();
  // เดือนที่เลือก (แถบบน · ตกลง 28 ต.ค. 2026): เดือนนี้ = แท็บรับ / จ่ายแบบเดิม (ค้าง + ภายใน 60 วัน · ครบแล้วภายใน 60 วัน)
  //   เดือนอื่น = งวดค้าง + งวดที่ครบถึงสิ้นเดือนนั้น · งวดครบแล้วที่บันทึกในเดือนนั้น · วันที่ตั้งต้น = สิ้นเดือน (ไม่เกินวันนี้)
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const isCur = ym === today.slice(0, 7);
  const { end: mEnd } = monthRange(ym);
  const defaultDate = mEnd < today ? mEnd : today;
  const year = today.slice(0, 4);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  // แท็บรับ / จ่าย = กล่องเดียวต่อปีแบบเงินให้กู้ (ตกลง 3 พ.ย. 2026) · ปีจาก dropdown ของแต่ละแท็บ (?yb= รับ · ?yp= จ่าย · ตกลง 6 พ.ย. 2026)
  //   ไม่ระบุ = ปีของเดือนที่เลือก · เปลี่ยนเดือนแล้วปีกลับไปตามเดือน (MonthPicker reset) · เปลี่ยนคน / บริษัทคงปีไว้ · ออกจากเมนูแล้วกลับมา = ปีปัจจุบัน
  //   ปีนี้ = งวดที่ครบในปี + งวดค้างจากปีก่อน + งวดที่ครบภายใน 60 วัน (ข้ามปี) · ช่องกรอกเฉพาะงวดที่ค้าง / ครบถึง soon
  const yNow = Number(year);
  const yParam = (v: string | undefined) => /^\d{4}$/.test(v ?? "") ? Number(v) : isCur ? yNow : Number(ym.slice(0, 4));
  const yBen = yParam(sp.yb), yPrem = yParam(sp.yp);
  const yrOf = (kind: string) => (kind === "PREMIUM" ? yPrem : yBen);
  const soon = isCur ? addDays(today, 60) : mEnd;
  const inBox = (l: YLine) => {
    const yr = yrOf(l.kind);
    return (l.due_date >= `${yr}-01-01` && l.due_date <= `${yr}-12-31`)
      || (yr === yNow && INS_OPEN.includes(l.status) && (l.due_date < `${yr}-01-01` || l.due_date <= soon));
  };
  // ทุกงวดของทุกกรมธรรม์: Supabase ส่งครั้งละไม่เกิน 1,000 แถว (ตอนนี้ ~800 แถว · ข้อมูลจริงเกินได้) → อ่านทีละ 1,000 แถวจนครบ
  const linesQ = (async () => {
    const out: YLine[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("v_insurance_schedule_status").select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,paid_amount,remaining,status")
        .order("due_date").order("installment_no").order("id").range(from, from + 999);
      if (error) return { data: out, error };
      out.push(...((data as YLine[] | null) ?? []));
      if (!data || data.length < 1000) return { data: out, error: null };
    }
  })();
  // ที่จ่าย / รับแล้วของงวดในกล่อง (ทีละครั้ง · กดแก้ / ยกเลิก) → ต่อจากผลของ linesQ ในรอบเดียวกัน
  const recQ = linesQ.then(async ({ data: ls }) => {
    const ids = ((ls ?? []) as YLine[]).filter((l) => inBox(l) && Number(l.paid_amount ?? 0) > 0).map((l) => l.id);
    if (ids.length === 0) return { pays: [] as { id: string; insurance_schedule_line_id: string; date: string; amount: number; currency: string }[],
      bens: [] as { id: string; line_id: string; receipt_date: string; amount: number; currency: string; outcome: string | null }[] };
    const [p, b] = await Promise.all([
      supabase.from("expense_items").select("id,insurance_schedule_line_id,date,amount,currency").in("insurance_schedule_line_id", ids).is("deleted_at", null).order("date"),
      supabase.from("insurance_benefit_receipts").select("id,line_id,receipt_date,amount,currency,outcome").in("line_id", ids).is("undone_at", null).is("deleted_at", null).order("receipt_date"),
    ]);
    return { pays: p.data ?? [], bens: b.data ?? [] };
  });
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: fups }, { data: allLines },
    { data: banks }, { data: cards }, { data: family }, { data: yearLumps }, { data: allLumps }, rec] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status,start_date,paid_from_asset_id,paid_from_credit_card_id,plan_name,coverage_scope")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name").order("sort_order"),
    supabase.from("assets").select("id,current_value,currency,current_value_date,asset_ownerships(person_id,ownership_percent,start_date,end_date,deleted_at)")
      .eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
    supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency,notes,max_count,count_period,label").is("deleted_at", null),
    supabase.from("insurance_claims").select("id,policy_id,coverage_id,incident_date,claim_date,claimed_amount,received_amount,currency,status,notes").is("deleted_at", null)
      .gte("claim_date", `${year}-01-01`).lte("claim_date", `${year}-12-31`).order("claim_date", { ascending: false }),
    supabase.from("insurance_followups").select("id,person_id,policy_id,role,action,status").is("deleted_at", null)
      .in("status", ["OPEN", "IN_PROGRESS"]).order("created_at"),
    linesQ,
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    // รับเงินก้อนที่ไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) ในปีที่เลือกของแท็บรับ → แสดงใต้ชื่อกรมธรรม์
    supabase.from("insurance_benefit_receipts").select("id,policy_id,receipt_date,amount,currency,outcome").is("line_id", null)
      .gte("receipt_date", `${yBen}-01-01`).lte("receipt_date", `${yBen}-12-31`).is("undone_at", null).is("deleted_at", null).order("receipt_date"),
    // รับเงินก้อนที่ไม่ผูกงวด ทุกปี → กล่อง "ได้คืนเทียบเบี้ย" (แบบหน้ากรมธรรม์)
    supabase.from("insurance_benefit_receipts").select("policy_id,amount,currency").is("line_id", null).is("undone_at", null).is("deleted_at", null),
    recQ,
  ]);
  const pname = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const cv = new Map((cvs ?? []).map((a) => [a.id, a]));
  // ตัวกรองบริษัทประกัน (?i= · ใช้กับทุกแท็บ · ตกลง 6 พ.ย. 2026)
  const insurers = [...new Set((data ?? []).map((r) => r.insurer as string).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  const iFilter = insurers.includes(sp.i ?? "") ? (sp.i as string) : "";
  const pol = (data ?? []).filter((r) => !iFilter || r.insurer === iFilter);
  // มุมมองรายบุคคล: กรมธรรม์ที่คนนั้นเป็นผู้เอาประกัน หรือเป็นเจ้าของมูลค่าเวนคืน · มูลค่าเวนคืน × สัดส่วนเจ้าของ
  const mineRows = bySort(pol.filter((r) => pv.isPerson(r.person_id) || (pv.personId !== "" && r.payer_person_id === pv.personId)
    || (!!r.cash_value_asset_id && pv.personId !== "" && pv.showAsset(r.cash_value_asset_id))), (r) => r.id, sortMap);
  // ตัวกรองด้านบนตารางภาพรวม แบบหน้าทรัพย์สิน (ตกลง 3 พ.ย. 2026): ประเภท (?t=) · สถานะ (?s= · ตั้งต้น = มีผล · all = ทั้งหมด)
  const types = INS_TYPE.map(([k]) => k).filter((k) => mineRows.some((r) => r.insurance_type === k));
  const tFilter = types.includes(sp.t ?? "") ? sp.t : undefined;
  const rows = tFilter ? mineRows.filter((r) => r.insurance_type === tFilter) : mineRows;
  const statuses = INS_STATUS.map(([k]) => k).filter((k) => k === "ACTIVE" || mineRows.some((r) => r.status === k));
  const sFilter = sp.s === "all" ? "all" : statuses.includes(sp.s ?? "") ? (sp.s as string) : "ACTIVE";
  const listRows = sFilter === "all" ? rows : rows.filter((r) => r.status === sFilter);
  const sParam = sFilter === "ACTIVE" ? undefined : sFilter;
  const fHref = (t: string | undefined, s: string | undefined) => {
    const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (iFilter) q.set("i", iFilter); if (t) q.set("t", t); if (s && s !== "ACTIVE") q.set("s", s);
    const x = q.toString(); return `/insurance${x ? `?${x}` : ""}`;
  };
  const lineList = (allLines ?? []) as YLine[];
  // เบี้ยเลยกำหนดต่อกรมธรรม์ (ใต้สถานะ · ตกลง 7 พ.ย. 2026 · เลิกคอลัมน์เบี้ย / ผลประโยชน์งวดถัดไป เพราะมีแท็บแล้ว)
  const overduePremium = new Map<string, number>();
  lineList.forEach((l) => { if (l.kind === "PREMIUM" && l.status === "OVERDUE") overduePremium.set(l.policy_id, (overduePremium.get(l.policy_id) ?? 0) + 1); });
  const policyName = new Map((data ?? []).map((r) => [r.id, `${r.insurer}${r.policy_no ? ` · ${r.policy_no}` : ""}`]));
  const fupRows = (fups ?? []).filter((f) => pv.isPerson(f.person_id) || rows.some((r) => r.id === f.policy_id));
  const cvOfPol = new Set(pol.map((r) => r.cash_value_asset_id).filter(Boolean));
  const cvTotal = (cvs ?? []).filter((a) => pv.showAsset(a.id) && (!iFilter || cvOfPol.has(a.id)))
    .reduce((s, a) => s + (a.currency === "THB" ? Number(a.current_value ?? 0) * pv.assetShare(a.id) : 0), 0);
  // กล่องสรุปด้านบน (ตกลง 7 พ.ย. 2026 · กรมธรรม์ที่มีผล · THB)
  const act = mineRows.filter((r) => r.status === "ACTIVE");
  const activeIds = new Set(act.map((r) => r.id));
  const sumThb = (f: (r: (typeof act)[number]) => number | null, ccyOf: (r: (typeof act)[number]) => string | null) =>
    act.reduce((t, r) => t + ((ccyOf(r) ?? "THB") === "THB" ? Number(f(r) ?? 0) : 0), 0);
  //   ทุนประกันชีวิต = ชีวิต + บำนาญ (สุขภาพใช้วงเงิน · ส่วนใหญ่เป็นเบี้ยทิ้ง → ไม่รวม) · อุบัติเหตุ = เสียชีวิตจากอุบัติเหตุเพิ่มอีก
  const lifeTotal = sumThb((r) => (r.insurance_type === "LIFE" || r.insurance_type === "ANNUITY" ? r.insured_amount : 0), (r) => r.insured_amount_currency);
  const accidentTotal = sumThb((r) => (r.insurance_type === "ACCIDENT" ? r.insured_amount : 0), (r) => r.insured_amount_currency);
  const premiumTotal = sumThb((r) => r.premium, (r) => r.premium_currency);
  const overdueTotal = mineRows.reduce((t, r) => t + (overduePremium.get(r.id) ?? 0), 0);
  //   ปีนี้ยังต้องจ่าย = เบี้ยงวดที่ยังจ่ายไม่ครบ ครบกำหนดไม่เกินสิ้นปีนี้ (รวมงวดเลยกำหนด)
  const premLeftYear = lineList.filter((l) => l.kind === "PREMIUM" && activeIds.has(l.policy_id) && l.currency === "THB"
    && INS_OPEN.includes(l.status) && l.due_date <= `${year}-12-31`).reduce((t, l) => t + Number(l.remaining ?? 0), 0);
  //   ได้คืนเทียบเบี้ย (สูตรเดียวกับหน้ากรมธรรม์ รวมทุกฉบับ) = (ผลประโยชน์ที่รับ + เงินก้อน + มูลค่าเวนคืนปัจจุบัน) ÷ เบี้ยที่จ่ายรวม
  //   เฉพาะกรมธรรม์ที่มีผล มีเงินคืน (มูลค่าเวนคืน / ตารางผลประโยชน์) และมีเบี้ยที่จ่ายแล้ว · ทั้งกรมธรรม์ (ไม่คูณสัดส่วนเจ้าของ) · THB
  const benefitPols = new Set(lineList.filter((l) => l.kind === "BENEFIT").map((l) => l.policy_id));
  const paidOf = new Map<string, number>();
  lineList.forEach((l) => { if (l.kind === "PREMIUM" && l.currency === "THB") paidOf.set(l.policy_id, (paidOf.get(l.policy_id) ?? 0) + insCountedPaid(l)); });
  const withBack = act.filter((r) => r.has_cash_value || r.cash_value_asset_id || benefitPols.has(r.id));
  const savings = withBack.filter((r) => (paidOf.get(r.id) ?? 0) > 0);
  const savingIds = new Set(savings.map((r) => r.id));
  const premPaid = savings.reduce((t, r) => t + (paidOf.get(r.id) ?? 0), 0);
  const backGot = lineList.filter((l) => l.kind === "BENEFIT" && l.currency === "THB" && savingIds.has(l.policy_id)).reduce((t, l) => t + insCountedPaid(l), 0)
    + (allLumps ?? []).filter((b) => b.currency === "THB" && savingIds.has(b.policy_id)).reduce((t, b) => t + Number(b.amount), 0)
    + savings.reduce((t, r) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
      return t + (c && c.currency === "THB" ? Number(c.current_value ?? 0) : 0); }, 0);
  const backPct = premPaid > 0 ? (backGot / premPaid) * 100 : null;
  // กล่องสัดส่วน (ตกลง 8 พ.ย. 2026 · แบบแรก) · THB เหมือนกล่องสรุปด้านบน
  //   ซ้าย = เบี้ยต่อปีตามบริษัทประกัน (ตามตัวกรองคน + บริษัท) · ขวา = ตามสมาชิกครอบครัว (ทั้งครอบครัวแบบหน้า Alternative · ตามตัวกรองบริษัท)
  const isThb = (c: string | null) => (c ?? "THB") === "THB";
  const isLife = (t: string) => t === "LIFE" || t === "ANNUITY";
  const byInsurer = new Map<string, { name: string; value: number; pols: typeof act }>();
  act.forEach((r) => {
    if (!isThb(r.premium_currency) || !(Number(r.premium ?? 0) > 0)) return;
    const k = String(r.insurer ?? "").trim().toLowerCase();
    const x = byInsurer.get(k) ?? { name: String(r.insurer ?? "").trim() || "-", value: 0, pols: [] };
    x.value += Number(r.premium); x.pols.push(r); byInsurer.set(k, x);
  });
  const insurerRows: ShareRow[] = [...byInsurer.entries()].sort((a, b) => b[1].value - a[1].value)
    .map(([k, x], i) => ({ key: k || "-", name: x.name, value: x.value, color: SHARE_COLORS[i % SHARE_COLORS.length], sub: `(${bookletCount(x.pols)} ฉบับ)` }));
  const famAct = pol.filter((r) => r.status === "ACTIVE");
  const mem = new Map<string, { premium: number; life: number; cv: number }>();
  const memOf = (k: string) => { const x = mem.get(k) ?? { premium: 0, life: 0, cv: 0 }; mem.set(k, x); return x; };
  famAct.forEach((r) => {
    const k = (r.person_id as string | null) ?? "";            // ไม่มีผู้เอาประกัน = ประกันทรัพย์สิน
    if (isThb(r.premium_currency)) memOf(k).premium += Number(r.premium ?? 0);
    if (isLife(r.insurance_type) && isThb(r.insured_amount_currency)) memOf(k).life += Number(r.insured_amount ?? 0);
  });
  type Own = { person_id: string; ownership_percent: number; start_date: string; end_date: string | null; deleted_at: string | null };
  (cvs ?? []).filter((a) => a.currency === "THB" && (!iFilter || cvOfPol.has(a.id)) && Number(a.current_value ?? 0) > 0).forEach((a) => {
    const os = ((a.asset_ownerships ?? []) as Own[]).filter((o) => !o.deleted_at && o.start_date <= today && (!o.end_date || o.end_date >= today));
    if (!os.length) { memOf("?").cv += Number(a.current_value); return; }
    os.forEach((o) => { memOf(o.person_id).cv += (Number(a.current_value) * Number(o.ownership_percent)) / 100; });
  });
  const memberRows: MemberShareRow[] = [...mem.entries()].filter(([, x]) => x.premium > 0 || x.life > 0 || x.cv > 0)
    .sort((a, b) => b[1].premium - a[1].premium || b[1].life - a[1].life || b[1].cv - a[1].cv)
    .map(([k, x], i) => ({ key: k || "-", ...x, color: SHARE_COLORS[i % SHARE_COLORS.length], current: !!pv.personId && k === pv.personId,
      name: k === "" ? "ประกันทรัพย์สิน" : k === "?" ? "ยังไม่ระบุเจ้าของ" : pname.get(k) ?? "สมาชิก" }));
  const fxNote = (n: number) => (n > 0 ? <p className="mt-2 text-xs text-slate-500">ไม่รวมกรมธรรม์สกุลเงินอื่น {n} ฉบับ</p> : null);
  const fxAct = act.filter((r) => !isThb(r.premium_currency)).length;
  const fxFam = famAct.filter((r) => !isThb(r.premium_currency) || (isLife(r.insurance_type) && !isThb(r.insured_amount_currency))).length;
  const cvOf = (r: (typeof rows)[number]) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
    return c && c.currency === "THB" && c.current_value != null ? Number(c.current_value) * pv.assetShare(c.id) : 0; };
  const bankPays: PayOpt[] = (banks ?? []).map((b) => ({ value: endpointValue({ kind: "bank", id: b.asset_id }), label: `บัญชี ${b.name}`, currency: b.currency }));
  const cardPays: PayOpt[] = (cards ?? []).map((c) => ({ value: endpointValue({ kind: "card", id: c.id }),
    label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency }));
  const canWrite = me.role !== "VIEWER";
  const goLive = family?.go_live_date ?? "";
  const mine = new Set(mineRows.map((r) => r.id));
  const OUTCOME: Record<string, string> = { MATURED: "ครบสัญญา", SURRENDERED: "เวนคืน", CLAIMED: "สินไหม" };
  // ยอดที่จ่าย / รับแล้วของงวด → กดเพื่อแก้ / ลบ (ตกลง 28 ต.ค. 2026) · เบี้ย = ฟอร์มเดียวกับหน้ากรมธรรม์ · ผลประโยชน์ = ยกเลิกทั้งก้อนแล้วบันทึกใหม่
  const editsOf = (l: YLine): Recorded[] => {
    const paths = ["/insurance", `/insurance/${l.policy_id}`, "/income-expenses"];
    return [
      ...rec.pays.filter((e) => e.insurance_schedule_line_id === l.id).map((e) => ({ id: e.id as string, node: recEdit({
        canWrite, canDelete: canOrder, table: "expense_items", id: e.id as string, label: recLabel("จ่ายแล้ว", e.date as string, Number(e.amount), e.currency as string),
        paths, fields: premiumPaymentFields(e as { date: string; amount: number }) }) })),
      ...rec.bens.filter((b) => b.line_id === l.id).map((b) => {
        const label = recLabel(b.outcome ? OUTCOME[b.outcome] ?? "รับแล้ว" : "รับแล้ว", b.receipt_date as string, Number(b.amount), b.currency as string);
        return { id: b.id as string, node: canOrder && !b.outcome
          ? <span className="inline-flex items-center gap-2"><span className="text-xs text-emerald-700">{label}</span>
              <UndoButton kind="BENEFIT" id={b.id as string} paths={paths} label="ยกเลิก"
                confirmText={`ยกเลิกการรับ ${money(Number(b.amount), b.currency as string)} วันที่ ${thDate(b.receipt_date as string)} (งวดที่ ${l.installment_no}) ทั้งก้อน?\nเงินที่ถอนจากมูลค่าเวนคืน / รายได้ของครั้งนี้ถูกย้อนทั้งหมด แล้วบันทึกยอดที่ถูกใหม่ในตารางได้`} /></span>
          : recLink(label, `/insurance/${l.policy_id}`) };
      }),
    ];
  };
  // กล่องรายปี: กรมธรรม์ (ตามตัวกรองคน · ลำดับเดียวกับภาพรวม) ที่มีงวดในกล่อง หรือรับเงินก้อนในปีนั้น
  const boxOf = (kind: "PREMIUM" | "BENEFIT"): BoxPolicy[] => {
    const prem = kind === "PREMIUM";
    const yStart = `${yrOf(kind)}-01-01`, yEnd = `${yrOf(kind)}-12-31`;
    const ls = lineList.filter((l) => l.kind === kind && mine.has(l.policy_id) && inBox(l));
    const lumps = prem ? [] : (yearLumps ?? []).filter((b) => mine.has(b.policy_id));
    const ids = new Set([...ls.map((l) => l.policy_id), ...lumps.map((b) => b.policy_id)]);
    // จ่ายเบี้ย: กรมธรรม์เล่มเดียวกัน (ชีวิต + สัญญาเพิ่มเติม) อยู่ติดกัน + แถวรวมทั้งเล่ม (ตกลง 6 พ.ย. 2026)
    const inBoxPols = mineRows.filter((r) => ids.has(r.id));
    const groups = prem ? bookletGroups(inBoxPols) : new Map<string, typeof inBoxPols>();
    return (prem ? bookletOrder(inBoxPols) : inBoxPols).map((r) => {
      const who = prem ? (r.payer_person_id ?? r.person_id) : r.person_id;
      const role = bookletRole(r, groups);
      return { id: r.id, name: policyName.get(r.id) ?? "-", person: who ? pname.get(who) ?? null : null, active: r.status === "ACTIVE",
        booklet: role ? { key: role.key, part: partLabel(r, role.main), rider: !role.isMain, last: role.parts.at(-1)?.id === r.id, size: role.parts.length } : undefined,
        pay: prem ? payDefaultValue(r) : "",
        lines: ls.filter((l) => l.policy_id === r.id).map((l) => ({ id: l.id, no: l.installment_no, due: l.due_date, amount: Number(l.amount),
          paid: insCountedPaid(l), remaining: l.status === "CLOSED" ? 0 : Number(l.remaining), currency: l.currency, status: l.status,
          benefitType: l.benefit_type, edits: editsOf(l),
          tag: l.due_date < yStart ? `ค้างจากปี ${Number(l.due_date.slice(0, 4)) + 543}` : l.due_date > yEnd ? `งวดปี ${Number(l.due_date.slice(0, 4)) + 543}` : null })),
        lumps: lumps.filter((b) => b.policy_id === r.id).map((b) => ({ id: b.id as string,
          node: recLink(recLabel(OUTCOME[b.outcome ?? ""] ?? "รับเงินก้อน", b.receipt_date as string, Number(b.amount), b.currency as string), `/insurance/${r.id}`) })),
      };
    });
  };
  // dropdown ปี: ปีแรก–ปีสุดท้ายที่มีงวด (รวมปีนี้) · ✓ = มีงวด · "ค้าง" = มีงวดเลยกำหนด
  const yearsOf = (kind: string) => {
    const ys = lineList.filter((l) => l.kind === kind && mine.has(l.policy_id)).map((l) => Number(l.due_date.slice(0, 4)));
    const yr = yrOf(kind);
    const lo = Math.min(yNow, yr, ...ys), hi = Math.max(yNow, yr, ...ys);
    const has = new Set(ys);
    const late = new Set(lineList.filter((l) => l.kind === kind && mine.has(l.policy_id) && l.status === "OVERDUE").map((l) => Number(l.due_date.slice(0, 4))));
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((y) => ({ value: y, mark: late.has(y) ? "· ค้าง" : has.has(y) ? "✓" : undefined }));
  };
  // ลิงก์เปลี่ยนปีของแท็บหนึ่ง: คงปีของอีกแท็บ + ตัวกรองอื่นไว้
  const yKeep = (q: URLSearchParams, skip?: string) => { (["yb", "yp"] as const).forEach((k) => { if (k !== skip && sp[k]) q.set(k, sp[k] as string); }); };
  const yHrefOf = (t: "benefit" | "premium") => { const own = t === "benefit" ? "yb" : "yp";
    const q = new URLSearchParams({ tab: t }); if (sp.p) q.set("p", sp.p); if (sp.m) q.set("m", sp.m); if (iFilter) q.set("i", iFilter); yKeep(q, own);
    return `/insurance?${q.toString()}&${own}=__Y__`; };
  // งวดค้าง (เลยกำหนด ณ วันนี้ · THB · ทุกปี) → บรรทัดสีแดงใต้ตาราง (เลิกการ์ด 3 กล่องด้านบน · ตกลง 6 พ.ย. 2026)
  const lateOf = (kind: "PREMIUM" | "BENEFIT") => {
    const late = lineList.filter((l) => l.kind === kind && activeIds.has(l.policy_id) && l.currency === "THB"
      && (l.status === "OVERDUE" || (l.status === "PARTIAL" && l.due_date < today)) && Number(l.remaining) > 0);
    return { count: late.length, amount: late.reduce((t, l) => t + Number(l.remaining), 0) };
  };
  // แท็บความคุ้มครอง (ตกลง 3 พ.ย. 2026): กรมธรรม์ที่มีผลตามผู้เอาประกัน · วงเงินต่อปีหักยอดเคลมปีนี้ (ไม่นับปฏิเสธ / ยกเลิก)
  const usedByCov = new Map<string, number>();
  (claims ?? []).filter((c) => c.coverage_id && !["REJECTED", "CANCELLED"].includes(c.status)).forEach((c) =>
    usedByCov.set(c.coverage_id as string, (usedByCov.get(c.coverage_id as string) ?? 0) + Number(c.received_amount ?? c.claimed_amount ?? 0)));
  const activeAll = pol.filter((r) => r.status === "ACTIVE" && r.person_id);
  const activePerson = new Map(activeAll.map((r) => [r.id, r.person_id as string]));
  // คุ้มครองเฉพาะ (ต่อส่วนของเล่ม · ตกลง 8 พ.ย. 2026) → แถวแยกในแท็บความคุ้มครอง ไม่บวกกับวงเงินทั่วไป
  const scopeOf = new Map(activeAll.map((r) => [r.id, (r.coverage_scope as string | null) ?? null]));
  const covRows = (covs ?? []).filter((c) => activePerson.has(c.policy_id));
  const covItems: CovItem[] = covRows.map((c) => ({ policyId: c.policy_id, personId: activePerson.get(c.policy_id) as string, type: c.coverage_type,
    limit: Number(c.limit_amount), used: usedByCov.get(c.id) ?? 0, currency: c.currency, notes: c.notes, maxCount: c.max_count,
    period: c.count_period, label: c.label, scope: scopeOf.get(c.policy_id) ?? null }));
  // กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองประเภทนั้น → ใช้ทุนประกันของกรมธรรม์
  activeAll.forEach((r) => {
    const k = deathCoverage(r.insurance_type);
    if (!k || Number(r.insured_amount ?? 0) <= 0 || covRows.some((c) => c.policy_id === r.id && c.coverage_type === k)) return;
    covItems.push({ policyId: r.id, personId: r.person_id as string, type: k, limit: Number(r.insured_amount), used: 0,
      currency: r.insured_amount_currency ?? "THB", notes: null, fromPolicy: true, scope: scopeOf.get(r.id) ?? null });
  });
  const covPolicies: CovPolicy[] = activeAll.map((r) => ({ id: r.id, name: policyName.get(r.id) ?? "-", type: r.insurance_type, personId: r.person_id,
    endDate: r.end_date, expiring: r.derived_status === "EXPIRING_SOON", expired: r.derived_status === "EXPIRED",
    premium: Number(r.premium ?? 0), premiumCcy: r.premium_currency ?? "THB", hasCov: covRows.some((c) => c.policy_id === r.id),
    plan: r.plan_name ?? null, scope: r.coverage_scope ?? null }));
  const covByIdType = new Map((covs ?? []).map((c) => [c.id, c.coverage_type as string]));
  const covByIdLabel = new Map((covs ?? []).map((c) => [c.id, c.label as string | null]));
  const policyPerson = new Map((data ?? []).map((r) => [r.id, r.person_id as string | null]));
  const polIds = new Set(pol.map((r) => r.id));
  const covClaims: CovClaim[] = (claims ?? []).filter((c) => polIds.has(c.policy_id)).map((c) => ({ id: c.id, policyId: c.policy_id, personId: policyPerson.get(c.policy_id) ?? null,
    coverageType: c.coverage_id ? covByIdType.get(c.coverage_id) ?? null : null, coverageLabel: c.coverage_id ? covByIdLabel.get(c.coverage_id) ?? null : null, date: c.claim_date ?? c.incident_date, claimed: Number(c.claimed_amount ?? 0),
    received: Number(c.received_amount ?? 0), currency: c.currency, status: c.status, notes: c.notes }));
  const covPersonsInView = pv.persons.filter((x) => pv.isPerson(x.id));
  // ตัวกรองบริษัทประกันของแต่ละแท็บ (เปลี่ยนแล้วอยู่แท็บเดิม · คงตัวกรองอื่นไว้)
  const insFilter = (t: string) => insurers.length < 2 && !iFilter ? null : (
    <UrlSelect label="บริษัทประกัน" value={iFilter} options={["", ...insurers].map((v) => {
      const q = new URLSearchParams(); if (t !== "overview") q.set("tab", t); if (sp.p) q.set("p", sp.p); if (sp.m) q.set("m", sp.m);
      if (v) q.set("i", v); if (t === "overview") { if (tFilter) q.set("t", tFilter); if (sParam) q.set("s", sParam); }
      if (t === "benefit" || t === "premium") yKeep(q);
      return { value: v, label: v || "ทั้งหมด", href: `/insurance${q.size ? `?${q.toString()}` : ""}` };
    })} />
  );
  // ภาพรวม: สัญญาเพิ่มเติม (บริษัท + เลขกรมธรรม์เดียวกัน) อยู่ใต้รายการหลัก · โหมดจัดลำดับ = ลำดับเดิม
  //   เบี้ยรวมทั้งเล่มต่อท้าย "↳ สัญญาเพิ่มเติม" ของส่วนสุดท้าย (แทนบรรทัดรวมทั้งเล่ม · ตกลง 7 พ.ย. 2026)
  const listGroups = bookletGroups(listRows);
  const shownRows = ordering ? listRows : bookletOrder(listRows);
  const ccyTag = (c: string | null) => (c && c !== "THB" ? c : undefined);
  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <PageInfo>กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</PageInfo>
      <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /><MonthPicker months={monthOptions(goLive, today, 12, ym)} value={ym} reset={["yb", "yp"]} /></HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/insurance/new" className={ADD_BTN}>+ เพิ่มกรมธรรม์</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="benefit" className="space-y-4">
        <InsuranceBatch key={`b${ym}${yBen}${lineList.length}`} kind="BENEFIT" year={yBen} years={yearsOf("BENEFIT")} hrefOf={yHrefOf("benefit")} policies={boxOf("BENEFIT")} filter={insFilter("benefit")} late={lateOf("BENEFIT")}
          pays={bankPays} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
      </TabPanel>
      <TabPanel id="premium" className="space-y-4">
        <InsuranceBatch key={`p${ym}${yPrem}${lineList.length}`} kind="PREMIUM" year={yPrem} years={yearsOf("PREMIUM")} hrefOf={yHrefOf("premium")} policies={boxOf("PREMIUM")} filter={insFilter("premium")} late={lateOf("PREMIUM")}
          pays={[...bankPays, ...cardPays]} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
      </TabPanel>

      <TabPanel id="coverage">
        <CoverageTab persons={covPersonsInView} personId={pv.personId} personName={pv.personName} policies={covPolicies} items={covItems} claims={covClaims}
          year={year} printHref={`/print/insurance${pv.personId ? `?p=${pv.personId}` : ""}`} canWrite={canWrite} filter={insFilter("coverage")} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* กล่องสรุป 4 อัน (ตกลง 7 พ.ย. 2026): มูลค่าเวนคืน (+ จำนวนกรมธรรม์) · ทุนประกันชีวิต · เบี้ยต่อปี (+ ปีนี้ยังต้องจ่าย) · ได้คืนเทียบเบี้ย */}
        <StatBox label={<>{pv.personId ? `มูลค่าเวนคืนส่วนของ ${pv.personName}` : "มูลค่าเวนคืนรวม"} (THB)</>} value={money(cvTotal, "THB", 0)}
          sub={`กรมธรรม์ที่มีผล ${bookletCount(act)} ฉบับ`} />
        <StatBox label="ทุนประกันชีวิตรวม (THB)" value={money(lifeTotal, "THB", 0)}
          sub={accidentTotal > 0 ? `เสียชีวิตจากอุบัติเหตุ เพิ่มอีก ${money(accidentTotal, undefined, 0)}` : "ชีวิต + บำนาญ · สุขภาพดูวงเงินที่แท็บความคุ้มครอง"} />
        <StatBox label="เบี้ยรวมต่อปี (THB)" value={money(premiumTotal, "THB", 0)} sub={`ปีนี้ยังต้องจ่าย ${money(premLeftYear, undefined, 0)}`}>
          {overdueTotal > 0 && <div className="mt-1 text-xs text-red-600">เลยกำหนด {overdueTotal} งวด</div>}
        </StatBox>
        <StatBox label="ได้คืนเทียบเบี้ย" value={backPct == null ? "-" : `${backPct.toFixed(0)}%`} valueClass={backPct != null && backPct >= 100 ? "text-emerald-700" : undefined}
          sub={backPct == null
            ? (withBack.length === 0 ? "ไม่มีกรมธรรม์ที่มีมูลค่าเวนคืน / เงินคืน" : "ยังไม่มีเบี้ยที่จ่ายแล้วของกรมธรรม์ที่มีเงินคืน")
            : <><span className="whitespace-nowrap">เบี้ยจ่ายแล้ว {money(premPaid, undefined, 0)}</span> · <span className="whitespace-nowrap">ได้คืน {money(backGot, undefined, 0)}</span>
                <div className="text-slate-400">เฉพาะกรมธรรม์ที่มีเงินคืน {bookletCount(savings)} ฉบับ</div></>} />
      </section>
      {(insurerRows.length > 0 || memberRows.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <ShareBox title={<>เบี้ยต่อปีตามบริษัทประกัน{pv.personId ? `ของ ${pv.personName}` : ""}</>} label="บริษัทประกัน" valueLabel="เบี้ยต่อปี (THB)"
            rows={insurerRows} footer={fxNote(fxAct)} empty="ยังไม่มีเบี้ยของกรมธรรม์ที่มีผล" />
          <MemberShareBox rows={memberRows} footer={fxNote(fxFam)} />
        </section>
      )}
      {fupRows.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">กรมธรรม์ที่ต้องติดตาม (สมาชิก Archived) · ค้าง {fupRows.length} รายการ</h2>
          <ul className="space-y-1 text-sm">
            {fupRows.map((f) => (
              <li key={f.id}>
                <Link href={`/insurance/${f.policy_id}`} className="font-medium hover:underline">{policyName.get(f.policy_id) ?? "กรมธรรม์"}</Link>
                {" · "}{pname.get(f.person_id)} ({FOLLOWUP_ROLE[f.role]}) · {f.action}
                <span className="ml-1 text-xs text-amber-800">[{Object.fromEntries(FOLLOWUP_STATUS)[f.status]}]</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* ตัวกรอง + ยอดรวมตามตัวกรองอยู่แถวบน แบบหน้าทรัพย์สิน (ตกลง 3 พ.ย. 2026 · เดิมยอดรวมอยู่ท้ายตาราง) */}
        <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-xs text-slate-600">
          {insFilter("overview")}
          <UrlSelect label="ประเภท" value={tFilter ?? ""} options={[{ value: "", label: "ทั้งหมด", href: fHref(undefined, sParam) },
            ...types.map((t) => ({ value: t, label: TYPE[t] ?? t, href: fHref(t, sParam) }))]} />
          <UrlSelect label="สถานะ" value={sFilter} options={[{ value: "all", label: "ทั้งหมด", href: fHref(tFilter, "all") },
            ...statuses.map((k) => ({ value: k, label: STATUS[k] ?? k, href: fHref(tFilter, k) }))]} />
          {listRows.length > 0 && (() => {
            const prem = listRows.filter((r) => r.status === "ACTIVE" && (r.premium_currency ?? "THB") === "THB").reduce((t, r) => t + Number(r.premium ?? 0), 0);
            const cvSum = listRows.reduce((t, r) => t + cvOf(r), 0);
            return (
              <span className="ml-auto text-right text-sm text-slate-700">
                รวม{tFilter || iFilter || sFilter !== "ACTIVE" ? "ตามตัวกรอง" : ""} {bookletCount(listRows)} ฉบับ
                {prem > 0 && <> · เบี้ย <b className="tabular-nums">{money(prem, undefined, 0)}</b>/ปี</>}
                {cvSum > 0 && <> · มูลค่าเวนคืน <b className="tabular-nums">{money(cvSum, undefined, 0)}</b></>}
              </span>
            );
          })()}
          {canOrder && listRows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/insurance", { p: sp.p, i: iFilter || undefined, t: tFilter, s: sParam })} />}
        </div>
        {/* คอลัมน์ (ตกลง 7 พ.ย. 2026): ประเภท · ทุน · เบี้ย · วันเริ่ม / วันสิ้นสุด แยกช่อง · งวดถัดไปดูที่แท็บรับ / จ่าย */}
        <table className="mt-2 w-full min-w-[64rem] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="py-2 pl-4 pr-3">กรมธรรม์</th><th className="px-2.5">ประเภท</th><th className="px-2.5">ผู้เอาประกัน</th>
              <th className="px-2.5 text-right">ทุนประกัน</th><th className="px-2.5 text-right">เบี้ยต่อปี</th><th className="px-2.5 text-right">มูลค่าเวนคืน</th>
              <th className="px-2.5">วันเริ่มสัญญา</th><th className="px-2.5">วันสิ้นสุดสัญญา</th><th className="pl-3 pr-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {listRows.length === 0 && <tr><td colSpan={9} className="px-2.5 py-6 text-center text-slate-500">
              {rows.length > 0 ? "ไม่มีกรมธรรม์ตามตัวกรอง" : pv.personId ? `ไม่มีกรมธรรม์ของ ${pv.personName}` : "ยังไม่มีกรมธรรม์"}</td></tr>}
            {shownRows.map((r, i) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              const role = ordering ? null : bookletRole(r, listGroups);
              const rider = !!role && !role.isMain;
              // ส่วนสุดท้ายของเล่ม: เบี้ยรวมทั้งเล่ม (ส่วนที่มีผล · THB)
              const bookPrem = rider && role.parts.at(-1)?.id === r.id
                ? role.parts.filter((x) => x.status === "ACTIVE" && (x.premium_currency ?? "THB") === "THB").reduce((t, x) => t + Number(x.premium ?? 0), 0) : 0;
              const late = overduePremium.get(r.id) ?? 0;
              return (
                <tr key={r.id} className={`${r.status !== "ACTIVE" ? "opacity-50" : ""} ${role ? "bg-slate-50/40" : ""}`}>
                  <td className={`py-3 pr-3 ${rider ? "pl-8" : "pl-4"}`}>
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="insurance_policies" id={r.id} paths={paths} {...neighbors(listRows, i, (x) => x.id)} /></span>}
                    {rider
                      ? <><Link href={`/insurance/${role.main.id}`} className="whitespace-nowrap font-medium text-slate-900 hover:underline">↳ สัญญาเพิ่มเติม</Link>
                          {bookPrem > 0 && <> <span className="whitespace-nowrap text-xs text-slate-500">· รวมทั้งเล่ม {money(bookPrem, undefined, 0)}/ปี</span></>}</>
                      : <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>}
                  </td>
                  <td className="whitespace-nowrap px-2.5">{PART_LABEL[r.insurance_type] ?? TYPE[r.insurance_type] ?? r.insurance_type}</td>
                  <td className="whitespace-nowrap px-2.5">{r.person_id ? pname.get(r.person_id) : "-"}
                    {r.payer_person_id && r.payer_person_id !== r.person_id && <div className="text-xs text-slate-500">ผู้จ่าย {pname.get(r.payer_person_id)}</div>}</td>
                  <td className="px-2.5 text-right tabular-nums">{money(r.insured_amount, ccyTag(r.insured_amount_currency), 0)}</td>
                  <td className="px-2.5 text-right tabular-nums">{money(r.premium, ccyTag(r.premium_currency), 0)}</td>
                  <td className="px-2.5 text-right tabular-nums">{r.has_cash_value ? (c ? <>
                    {money(c.current_value == null ? null : Number(c.current_value) * pv.assetShare(c.id), ccyTag(c.currency), 0)}
                    {pv.assetPct(c.id) != null && <div className="text-xs text-slate-500">{pv.assetPct(c.id)}% ของ {money(c.current_value, ccyTag(c.currency), 0)}</div>}
                  </> : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="whitespace-nowrap px-2.5">{thDate(r.start_date)}</td>
                  <td className="whitespace-nowrap px-2.5">{thDate(r.end_date)}</td>
                  <td className="whitespace-nowrap pl-3 pr-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}
                    {late > 0 && <div className="text-red-600">เบี้ยเลยกำหนด {late} งวด</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

