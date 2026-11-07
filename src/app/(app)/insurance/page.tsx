import Link from "next/link";
import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_OPEN, INS_STATUS, INS_TYPE, addDays, insCountedPaid, money, monthOptions, monthRange, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";
import UrlSelect from "@/components/UrlSelect";
import { payDefaultValue } from "./PayDefaultSelect";
import InsuranceBatch, { type BoxPolicy, type PayOpt, type YLine } from "./InsuranceBatch";
import CashValueBatch, { type CvRow } from "./CashValueBatch";
import CoverageTab, { type CovClaim, type CovItem, type CovPolicy } from "./CoverageTab";
import { recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { premiumPaymentFields } from "@/lib/source-edit";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { endpointValue } from "@/lib/money-endpoint";
import UndoButton from "@/components/UndoButton";
import { bookletCount, bookletGroups, bookletOrder, bookletRole, partLabel } from "@/lib/insurance-booklet";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);
// ความคุ้มครองต่อจากภาพรวม (ตกลง 3 พ.ย. 2026 · เดิมอยู่ท้ายสุด)
const TABS = [["overview", "ภาพรวม"], ["coverage", "ความคุ้มครอง"], ["update", "อัปเดตมูลค่าเวนคืน"], ["benefit", "บันทึกรับผลประโยชน์"], ["premium", "จ่ายชำระเบี้ยประกัน"]] as const;

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
  const linesQ = supabase.from("v_insurance_schedule_status").select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,paid_amount,remaining,status")
    .order("due_date").order("installment_no").then((r) => r);
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
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: dues }, { data: fups }, { data: allLines },
    { data: banks }, { data: cards }, { data: family }, { data: cvTable }, { data: yearLumps }, rec] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status,start_date,paid_from_asset_id,paid_from_credit_card_id")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name").order("sort_order"),
    supabase.from("assets").select("id,current_value,currency,current_value_date").eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
    supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency,notes").is("deleted_at", null),
    supabase.from("insurance_claims").select("id,policy_id,coverage_id,incident_date,claim_date,claimed_amount,received_amount,currency,status,notes").is("deleted_at", null)
      .gte("claim_date", `${year}-01-01`).lte("claim_date", `${year}-12-31`).order("claim_date", { ascending: false }),
    supabase.from("v_insurance_schedule_status").select("policy_id,due_date,remaining,status").eq("kind", "PREMIUM")
      .in("status", ["PENDING", "OVERDUE", "PARTIAL"]).order("due_date"),
    supabase.from("insurance_followups").select("id,person_id,policy_id,role,action,status").is("deleted_at", null)
      .in("status", ["OPEN", "IN_PROGRESS"]).order("created_at"),
    linesQ,
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("insurance_cash_value_table").select("policy_id,policy_year,value_date,value").is("deleted_at", null).lte("value_date", today)
      .order("value_date"),
    // รับเงินก้อนที่ไม่ผูกงวด (ครบสัญญา / เวนคืน / สินไหม) ในปีที่เลือกของแท็บรับ → แสดงใต้ชื่อกรมธรรม์
    supabase.from("insurance_benefit_receipts").select("id,policy_id,receipt_date,amount,currency,outcome").is("line_id", null)
      .gte("receipt_date", `${yBen}-01-01`).lte("receipt_date", `${yBen}-12-31`).is("undone_at", null).is("deleted_at", null).order("receipt_date"),
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
  // เบี้ยงวดถัดไป / เลยกำหนด ต่อกรมธรรม์
  const nextPremium = new Map<string, { due_date: string; remaining: number }>();
  const overduePremium = new Map<string, number>();
  (dues ?? []).forEach((d) => {
    if (d.status === "OVERDUE") overduePremium.set(d.policy_id, (overduePremium.get(d.policy_id) ?? 0) + 1);
    else if (!nextPremium.has(d.policy_id)) nextPremium.set(d.policy_id, { due_date: d.due_date, remaining: Number(d.remaining) });
  });
  const policyName = new Map((data ?? []).map((r) => [r.id, `${r.insurer}${r.policy_no ? ` · ${r.policy_no}` : ""}`]));
  const fupRows = (fups ?? []).filter((f) => pv.isPerson(f.person_id) || rows.some((r) => r.id === f.policy_id));
  const cvOfPol = new Set(pol.map((r) => r.cash_value_asset_id).filter(Boolean));
  const cvTotal = (cvs ?? []).filter((a) => pv.showAsset(a.id) && (!iFilter || cvOfPol.has(a.id)))
    .reduce((s, a) => s + (a.currency === "THB" ? Number(a.current_value ?? 0) * pv.assetShare(a.id) : 0), 0);
  // สรุปด้านบน (กรมธรรม์ที่มีผล · THB)
  const act = mineRows.filter((r) => r.status === "ACTIVE");
  const sumThb = (f: (r: (typeof act)[number]) => number | null, ccyOf: (r: (typeof act)[number]) => string | null) =>
    act.reduce((t, r) => t + ((ccyOf(r) ?? "THB") === "THB" ? Number(f(r) ?? 0) : 0), 0);
  const insuredTotal = sumThb((r) => r.insured_amount, (r) => r.insured_amount_currency);
  const premiumTotal = sumThb((r) => r.premium, (r) => r.premium_currency);
  const overdueTotal = mineRows.reduce((t, r) => t + (overduePremium.get(r.id) ?? 0), 0);
  // งวดสุดท้าย (ปี พ.ศ.) + งวดที่เหลือ ต่อกรมธรรม์
  const lineList = (allLines ?? []) as YLine[];
  const lastOf = (pid: string, kind: string) => {
    const xs = lineList.filter((l) => l.policy_id === pid && l.kind === kind);
    const d = xs.at(-1)?.due_date;
    return d ? { year: Number(d.slice(0, 4)) + 543, left: xs.filter((l) => INS_OPEN.includes(l.status)).length } : null;
  };
  const nextBenefit = (pid: string) => lineList.find((l) => l.policy_id === pid && l.kind === "BENEFIT" && INS_OPEN.includes(l.status));
  const cvOf = (r: (typeof rows)[number]) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
    return c && c.currency === "THB" && c.current_value != null ? Number(c.current_value) * pv.assetShare(c.id) : 0; };
  const bankPays: PayOpt[] = (banks ?? []).map((b) => ({ value: endpointValue({ kind: "bank", id: b.asset_id }), label: `บัญชี ${b.name}`, currency: b.currency }));
  const cardPays: PayOpt[] = (cards ?? []).map((c) => ({ value: endpointValue({ kind: "card", id: c.id }),
    label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency }));
  const canWrite = me.role !== "VIEWER";
  const goLive = family?.go_live_date ?? "";
  const mine = new Set(mineRows.map((r) => r.id));
  const activeIds = new Set(mineRows.filter((r) => r.status === "ACTIVE").map((r) => r.id));
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
  const actRows = rows.filter((r) => r.status === "ACTIVE");
  // แท็บอัปเดตมูลค่าเวนคืน: กรมธรรม์ที่มีผลและมีมูลค่าเวนคืน / ตารางตามสัญญา · ปีล่าสุดที่ถึงวันแล้ว · ยังไม่ได้ลง (เงื่อนไขเดียวกับ sync_insurance_cash_value)
  const dueOf = new Map<string, { year: number; value: number; date: string }>();
  (cvTable ?? []).forEach((c) => dueOf.set(c.policy_id, { year: Number(c.policy_year), value: Number(c.value), date: c.value_date as string }));
  const cvRows: CvRow[] = actRows.filter((r) => r.has_cash_value || r.cash_value_asset_id || dueOf.has(r.id)).map((r) => {
    const a = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : undefined;
    const due = dueOf.get(r.id) ?? null;
    const pending = !!due && (!a ? true : due.date >= goLive && (!a.current_value_date || due.date > a.current_value_date));
    const premiumDue = !!due && lineList.some((l) => l.policy_id === r.id && l.kind === "PREMIUM" && l.due_date < due.date && l.status !== "PAID");
    return { policyId: r.id, assetId: a?.id ?? null, name: policyName.get(r.id) ?? "-", person: r.person_id ? pname.get(r.person_id) ?? null : null,
      currency: a?.currency ?? r.insured_amount_currency ?? "THB", value: a?.current_value == null ? null : Number(a.current_value), date: a?.current_value_date ?? null,
      due, pending, premiumDue, factor: a && a.currency === "THB" ? pv.assetShare(a.id) : 0 };
  });
  // แท็บความคุ้มครอง (ตกลง 3 พ.ย. 2026): กรมธรรม์ที่มีผลตามผู้เอาประกัน · วงเงินต่อปีหักยอดเคลมปีนี้ (ไม่นับปฏิเสธ / ยกเลิก)
  const usedByCov = new Map<string, number>();
  (claims ?? []).filter((c) => c.coverage_id && !["REJECTED", "CANCELLED"].includes(c.status)).forEach((c) =>
    usedByCov.set(c.coverage_id as string, (usedByCov.get(c.coverage_id as string) ?? 0) + Number(c.received_amount ?? c.claimed_amount ?? 0)));
  const activeAll = pol.filter((r) => r.status === "ACTIVE" && r.person_id);
  const activePerson = new Map(activeAll.map((r) => [r.id, r.person_id as string]));
  const covRows = (covs ?? []).filter((c) => activePerson.has(c.policy_id));
  const covItems: CovItem[] = covRows.map((c) => ({ policyId: c.policy_id, personId: activePerson.get(c.policy_id) as string, type: c.coverage_type,
    limit: Number(c.limit_amount), used: usedByCov.get(c.id) ?? 0, currency: c.currency, notes: c.notes }));
  // กรมธรรม์ชีวิต / อุบัติเหตุที่ยังไม่ได้กรอกความคุ้มครองประเภทนั้น → ใช้ทุนประกันของกรมธรรม์
  activeAll.forEach((r) => {
    const k = r.insurance_type === "LIFE" ? "LIFE" : r.insurance_type === "ACCIDENT" ? "ACCIDENT_DEATH" : null;
    if (!k || Number(r.insured_amount ?? 0) <= 0 || covRows.some((c) => c.policy_id === r.id && c.coverage_type === k)) return;
    covItems.push({ policyId: r.id, personId: r.person_id as string, type: k, limit: Number(r.insured_amount), used: 0,
      currency: r.insured_amount_currency ?? "THB", notes: null, fromPolicy: true });
  });
  const covPolicies: CovPolicy[] = activeAll.map((r) => ({ id: r.id, name: policyName.get(r.id) ?? "-", type: r.insurance_type, personId: r.person_id,
    endDate: r.end_date, expiring: r.derived_status === "EXPIRING_SOON", expired: r.derived_status === "EXPIRED",
    premium: Number(r.premium ?? 0), premiumCcy: r.premium_currency ?? "THB", hasCov: covRows.some((c) => c.policy_id === r.id) }));
  const covByIdType = new Map((covs ?? []).map((c) => [c.id, c.coverage_type as string]));
  const policyPerson = new Map((data ?? []).map((r) => [r.id, r.person_id as string | null]));
  const polIds = new Set(pol.map((r) => r.id));
  const covClaims: CovClaim[] = (claims ?? []).filter((c) => polIds.has(c.policy_id)).map((c) => ({ id: c.id, policyId: c.policy_id, personId: policyPerson.get(c.policy_id) ?? null,
    coverageType: c.coverage_id ? covByIdType.get(c.coverage_id) ?? null : null, date: c.claim_date ?? c.incident_date, claimed: Number(c.claimed_amount ?? 0),
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
  // ภาพรวม: สัญญาเพิ่มเติม (บริษัท + เลขกรมธรรม์เดียวกัน) อยู่ใต้รายการหลัก + บรรทัดรวมทั้งเล่ม (ตกลง 6 พ.ย. 2026) · โหมดจัดลำดับ = ลำดับเดิม
  const listGroups = bookletGroups(listRows);
  const shownRows = ordering ? listRows : bookletOrder(listRows);
  const bookTotalRow = (parts: typeof listRows) => {
    const live = parts.filter((x) => x.status === "ACTIVE" && (x.premium_currency ?? "THB") === "THB");
    const prem = live.reduce((t, x) => t + Number(x.premium ?? 0), 0);
    const nexts = live.map((x) => nextPremium.get(x.id)).filter((x): x is { due_date: string; remaining: number } => !!x);
    const due = nexts[0]?.due_date;
    const sameDue = nexts.filter((x) => x.due_date === due);
    return (
      <tr className="bg-slate-50/70 text-xs">
        <td className="py-2 pl-8 pr-4 font-medium text-slate-700">รวมทั้งเล่ม<span className="font-normal text-slate-500"> · {parts.length} ส่วน</span></td>
        <td className="px-4" />
        <td className="px-4 text-right font-medium tabular-nums">{prem > 0 && <>เบี้ย {money(prem, undefined, 0)}/ปี</>}</td>
        <td className="px-4" />
        <td className="px-4">{due && <>{thDate(due)}<div className="font-medium tabular-nums text-slate-700">{money(sameDue.reduce((t, x) => t + x.remaining, 0))}</div></>}</td>
        <td className="px-4" /><td className="px-4" />
      </tr>
    );
  };
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

      <TabPanel id="update">
        <CashValueBatch key={`u${cvRows.map((r) => `${r.policyId}${r.date}`).join("")}`} rows={cvRows} today={today} minDate={goLive} canWrite={canWrite} canCreate={canOrder} filter={insFilter("update")}
          shareNote={pv.personId ? `ยอดรวมท้ายตาราง = ส่วนของ ${pv.personName} ตามสัดส่วนเจ้าของ (มูลค่าในแถว = ทั้งกรมธรรม์)` : null} />
      </TabPanel>

      <TabPanel id="coverage">
        <CoverageTab persons={covPersonsInView} personId={pv.personId} personName={pv.personName} policies={covPolicies} items={covItems} claims={covClaims}
          year={year} printHref={`/print/insurance${pv.personId ? `?p=${pv.personId}` : ""}`} canWrite={canWrite} filter={insFilter("coverage")} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label="กรมธรรม์ที่มีผล" value={bookletCount(act)} unit="ฉบับ"
          sub={<>ทั้งหมด {bookletCount(mineRows)} ฉบับ{bookletCount(mineRows) < mineRows.length && " · สัญญาเพิ่มเติมนับรวมในเล่ม"}</>} />
        <StatBox label="ทุนประกันรวม (THB)" value={money(insuredTotal, "THB", 0)} />
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">เบี้ยรวมต่อปี (THB)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(premiumTotal, "THB", 0)}</div>
          {overdueTotal > 0 && <div className="text-xs text-red-600">เบี้ยเลยกำหนด {overdueTotal} งวด</div>}
        </div>
        <StatBox label={<>{pv.personId ? `มูลค่าเวนคืนส่วนของ ${pv.personName}` : "มูลค่าเวนคืนรวม"} (THB)</>} value={money(cvTotal, "THB", 0)} sub="นับเป็นสินทรัพย์หมวดการเงิน" />
      </section>
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
        {/* รวมกล่อง "กรมธรรม์ที่มีผล" ของแท็บรับ / จ่ายไว้ที่นี่ (ตกลง 3 พ.ย. 2026): ระยะสัญญา · เบี้ยงวดถัดไป · ผลประโยชน์งวดถัดไป */}
        <table className="mt-2 w-full min-w-[60rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">กรมธรรม์ / ระยะสัญญา</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4 text-right">ทุน / เบี้ย</th><th className="px-4 text-right">มูลค่าเวนคืน</th>
              <th className="px-4">เบี้ยงวดถัดไป</th><th className="px-4">ผลประโยชน์งวดถัดไป</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {listRows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">
              {rows.length > 0 ? "ไม่มีกรมธรรม์ตามตัวกรอง" : pv.personId ? `ไม่มีกรมธรรม์ของ ${pv.personName}` : "ยังไม่มีกรมธรรม์"}</td></tr>}
            {shownRows.map((r, i) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              const nb = nextBenefit(r.id);
              const role = ordering ? null : bookletRole(r, listGroups);
              const rider = !!role && !role.isMain;
              return (
                <Fragment key={r.id}>
                <tr className={`${r.status !== "ACTIVE" ? "opacity-50" : ""} ${role ? "bg-slate-50/40" : ""}`}>
                  <td className={`py-3 pr-4 ${rider ? "pl-8" : "pl-4"}`}>
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="insurance_policies" id={r.id} paths={paths} {...neighbors(listRows, i, (x) => x.id)} /></span>}
                    {rider
                      ? <Link href={`/insurance/${role.main.id}`} className="font-medium text-slate-900 hover:underline">↳ สัญญาเพิ่มเติม · {partLabel(r, role.main)}</Link>
                      : <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>}
                    <div className="text-xs text-slate-500">{rider ? "เล่มเดียวกัน" : TYPE[r.insurance_type] ?? r.insurance_type}
                      {role?.isMain && ` (สัญญาหลัก)`}
                      {(r.start_date || r.end_date) && ` · ${r.start_date ? `${thDate(r.start_date)} – ` : "ถึง "}${thDate(r.end_date)}`}</div>
                  </td>
                  <td className="px-4">{r.person_id ? pname.get(r.person_id) : "-"}
                    {r.payer_person_id && r.payer_person_id !== r.person_id && <div className="text-xs text-slate-500">ผู้จ่าย {pname.get(r.payer_person_id)}</div>}</td>
                  <td className="px-4 text-right tabular-nums text-xs">
                    {r.insured_amount != null && <div>ทุน {money(r.insured_amount, r.insured_amount_currency ?? undefined, 0)}</div>}
                    {r.premium != null && <div className="text-slate-500">เบี้ย {money(r.premium, undefined, 0)}/ปี</div>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.has_cash_value ? (c ? <>
                    {money(c.current_value == null ? null : Number(c.current_value) * pv.assetShare(c.id), c.currency, 0)}
                    {pv.assetPct(c.id) != null && <div className="text-xs text-slate-500">{pv.assetPct(c.id)}% ของ {money(c.current_value, c.currency, 0)}</div>}
                  </> : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="px-4 text-xs">
                    {nextPremium.get(r.id) ? <>{thDate(nextPremium.get(r.id)?.due_date)}<div className="tabular-nums text-slate-500">{money(nextPremium.get(r.id)?.remaining)}</div></> : <span className="text-slate-400">-</span>}
                    {overduePremium.get(r.id) && <div className="text-red-600">เลยกำหนด {overduePremium.get(r.id)} งวด</div>}
                    {lastOf(r.id, "PREMIUM") && <div className="text-slate-500">จ่ายถึงปี {lastOf(r.id, "PREMIUM")?.year} · เหลือ {lastOf(r.id, "PREMIUM")?.left} งวด</div>}
                  </td>
                  <td className="px-4 text-xs">
                    {nb ? <>{thDate(nb.due_date)}<div className="tabular-nums text-slate-500">{money(nb.remaining, nb.currency !== "THB" ? nb.currency : undefined)}</div></> : <span className="text-slate-400">-</span>}
                    {lastOf(r.id, "BENEFIT") && <div className="text-slate-500">รับถึงปี {lastOf(r.id, "BENEFIT")?.year} · เหลือ {lastOf(r.id, "BENEFIT")?.left} งวด</div>}
                  </td>
                  <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}</td>
                </tr>
                {role && role.parts.at(-1)?.id === r.id && bookTotalRow(role.parts)}
                </Fragment>
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

