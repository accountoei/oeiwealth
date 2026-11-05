import Link from "next/link";
import { PageInfo } from "@/components/HeaderBar";
import { StatBox } from "@/components/Boxes";
import { TabActions } from "@/components/TabActions";
import DocumentUpload from "@/components/docs/DocumentUpload";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INCOME_TYPE_LABEL, TAX_FORM_LABEL, TAX_METHOD_LABEL, TAX_RETURN_STATUS_LABEL, TAX_SETTLEMENT_LABEL, money, thDate, todayBangkok } from "@/lib/format";
import { calcTax } from "@/lib/tax";
import { ActButton, AmendReturn, CreateReturn, DeleteReturn, FileReturn, LineEditor, SettlementForm, TaxFilters, type LineV } from "./forms";

type Ret = {
  id: string; tax_year: number; version: number; form_type: string; status: string; amend_reason: string | null; filed_date: string | null;
  reference_no: string | null; tax_result: number | null; settlement_status: string | null; settled_date: string | null;
  refreshed_at: string | null; notes: string | null;
};
type Line = LineV & { sort_order: number; detail: Record<string, unknown> | null };
const STATUS_CLS: Record<string, string> = { DRAFT: "bg-slate-100 text-slate-700", REVIEWED: "bg-blue-50 text-blue-700", FILED: "bg-emerald-50 text-emerald-700" };
const SECTIONS: { key: string; title: string; note?: string }[] = [
  { key: "INCOME", title: "2. เงินได้พึงประเมิน ม.40(1)–(8)", note: "ยอดจากระบบ = รายได้ที่บันทึกไว้ใน Income & Expenses ของปีภาษี (1 ม.ค. – 31 ธ.ค.) เป็นบาท ก่อนหักภาษี" },
  { key: "EXPENSE", title: "3. ค่าใช้จ่าย", note: "ค่าใช้จ่าย 40(5) จากระบบ = รายจ่ายของทรัพย์สินกลุ่มอสังหาฯ (ใช้เมื่อเลือกหักตามจริง) · ยอดหักแบบเหมาคำนวณในส่วนที่ 5" },
  { key: "DEDUCTION", title: "4. ค่าลดหย่อน", note: "จำนวนคนจากข้อมูลสมาชิก (คู่สมรส · บุตร · บิดามารดาอายุ 60+) · เบี้ยประกันจากงวดเบี้ยที่จ่ายแล้ว · ดอกเบี้ยบ้านจากหนี้ประเภทสินเชื่อบ้าน · อื่น ๆ กรอกเอง" },
  { key: "DONATION", title: "4. เงินบริจาค", note: "จากแท็บ Donations: เฉพาะรายการที่ผู้ใช้สิทธิเป็นคนนี้และสถานะ “ใช้สิทธิได้”" },
  { key: "CREDIT", title: "4. ภาษีที่ชำระแล้ว / เครดิตภาษี", note: "ภาษีหัก ณ ที่จ่ายจากรายได้ที่บันทึกไว้ · ตรวจกับหนังสือรับรอง 50 ทวิ" },
];
const n = (v: unknown) => (v == null ? null : Number(v));
const eff = (l: Line) => n(l.filed_amount) ?? n(l.system_amount);

/** ที่มาของยอด (ใต้ชื่อรายการ) */
function Detail({ l }: { l: Line }) {
  const d = l.detail as { by_type?: Record<string, { amount: number }>; shared_amount?: number | null; items?: unknown[]; pending?: number; pending_amount?: number | null; review_wht?: number | null } | null;
  if (!d) return null;
  const parts: string[] = [];
  if (d.by_type) parts.push(Object.entries(d.by_type).map(([k, v]) => `${k.startsWith("OTHER:") ? k.slice(6) : INCOME_TYPE_LABEL[k] ?? (k === "PENDING_SPLIT" ? "รายได้รอแยก" : k)} ${money(v.amount)}`).join(" · "));
  if (d.items?.length) parts.push(`${d.items.length} รายการ`);
  return (
    <>
      {parts.length > 0 && <div className="text-xs text-slate-500">{parts.join(" · ")}</div>}
      {!!d.shared_amount && <div className="text-xs text-amber-700">รวมรายได้ที่แบ่งตามสัดส่วนเจ้าของทรัพย์สิน {money(d.shared_amount)} บาท — ตรวจว่าตรงกับผู้มีเงินได้ตามเอกสาร</div>}
      {!!d.pending && <div className="text-xs text-amber-700">รอตรวจสอบสิทธิ {d.pending} รายการ ({money(d.pending_amount ?? 0)} บาท) — ยังไม่รวม</div>}
      {!!d.review_wht && <div className="text-xs text-amber-700">ภาษีหักของรายได้รอตรวจสอบ {money(d.review_wht)} บาท — ยังไม่รวม</div>}
    </>
  );
}

const LINE_COLS = "id,section,code,label,sort_order,system_amount,qty,detail,filed_amount,filed_qty,method,reason";
/** ปีภาษีที่เลือกได้: ปีนี้ย้อนหลัง 4 ปี + ปีที่มีแบบภาษี */
const yearsOf = (thisYear: number, extra: number[]) =>
  [...new Set([thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4, ...extra])].sort((a, b) => b - a);
type Sb = Awaited<ReturnType<typeof createClient>>;

/** ทั้งครอบครัว: แบบภาษีฉบับล่าสุดของแต่ละคนในปีที่เลือก + บรรทัดที่เก็บไว้ (2 รอบ · ไม่เรียก tax_system_lines) */
async function loadFamilyTax(supabase: Sb, yParam: string | undefined, thisYear: number) {
  const { data } = await supabase.from("tax_returns").select("id,person_id,tax_year,version,status,tax_result")
    .is("deleted_at", null).order("version", { ascending: false });
  const rets = (data ?? []) as { id: string; person_id: string; tax_year: number; version: number; status: string; tax_result: number | null }[];
  const years = yearsOf(thisYear, rets.map((r) => r.tax_year));
  const y = /^\d{4}$/.test(yParam ?? "") && years.includes(Number(yParam)) ? Number(yParam) : Math.max(0, ...rets.map((r) => r.tax_year)) || thisYear;
  const latest = new Map<string, (typeof rets)[number]>();
  rets.filter((r) => r.tax_year === y).forEach((r) => { if (!latest.has(r.person_id)) latest.set(r.person_id, r); });
  const ids = [...latest.values()].map((r) => r.id);
  const { data: lineRows, error } = ids.length
    ? await supabase.from("tax_return_lines").select(`return_id,${LINE_COLS}`).in("return_id", ids).is("deleted_at", null)
    : { data: [], error: null };
  return { years, y, latest, lines: (lineRows ?? []) as (Line & { return_id: string })[], error };
}

function FamilyTax({ info, people, fam, thisYear, today }: {
  info: React.ReactNode; people: { id: string; name: string; birth_date: string | null }[];
  fam: Awaited<ReturnType<typeof loadFamilyTax>>; thisYear: number; today: string;
}) {
  const { y } = fam;
  const rows = people.map((x) => {
    const ret = fam.latest.get(x.id);
    if (!ret) return { ...x, ret, calc: null };
    const age = x.birth_date ? y - Number(x.birth_date.slice(0, 4)) : null;
    return { ...x, ret, calc: calcTax(fam.lines.filter((l) => l.return_id === ret.id), y, { age }) };
  });
  const done = rows.filter((r) => r.calc);
  const resultOf = (r: (typeof rows)[number]) => (r.ret?.status === "FILED" && r.ret.tax_result != null ? Number(r.ret.tax_result) : r.calc?.result ?? 0);
  const tot = (f: (c: NonNullable<(typeof rows)[number]["calc"]>) => number) => done.reduce((t, r) => t + f(r.calc!), 0);
  const totResult = done.reduce((t, r) => t + resultOf(r), 0);
  const num = "px-3 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="space-y-6">
      {info}
      <TabActions><TaxFilters persons={people} years={fam.years} p="all" y={y} /></TabActions>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ทั้งครอบครัว · ปีภาษี {y + 543}</h2>
        <p className="mb-3 text-xs text-slate-500">
          ยอดจากแบบภาษีที่สร้างไว้ของแต่ละคน (ไม่ดึงยอดจากระบบใหม่) · ยื่นแล้วใช้ยอดตามที่ยื่น · คนที่ยังไม่สร้างแบบร่าง กดที่ชื่อเพื่อเข้าไปสร้าง
          {y >= thisYear && <span className="text-amber-700"> · ปีภาษียังไม่จบ ยอดเป็นข้อมูลถึงวันที่ {thDate(today)}</span>}
        </p>
        {fam.error && <p className="mb-2 text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {fam.error.message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-3">ผู้เสียภาษี</th><th className="pr-3">สถานะ</th><th className="px-3 text-right">เงินได้พึงประเมิน</th>
                <th className="px-3 text-right">หักค่าใช้จ่าย / ลดหย่อน</th><th className="px-3 text-right">เงินได้สุทธิ</th><th className="px-3 text-right">ภาษีทั้งปี</th>
                <th className="px-3 text-right">หัก ณ ที่จ่าย / เครดิต</th><th className="pl-3 text-right">ชำระเพิ่ม / ขอคืน</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const c = r.calc;
                const res = resultOf(r);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-3"><Link href={`/family/tax?p=${r.id}&y=${y}`} scroll={false} className="font-medium text-blue-700 hover:underline">{r.name}</Link></td>
                    <td className="whitespace-nowrap pr-3">{r.ret
                      ? <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLS[r.ret.status]}`}>{TAX_RETURN_STATUS_LABEL[r.ret.status]}{r.ret.version > 1 ? ` (ครั้งที่ ${r.ret.version})` : ""}</span>
                      : <span className="text-xs text-slate-400">ยังไม่สร้างแบบร่าง</span>}</td>
                    {c ? (
                      <>
                        <td className={num}>{money(c.assessable)}</td>
                        <td className={num}>{money(c.expenses + c.deductions + c.donations)}</td>
                        <td className={num}>{money(c.taxable)}</td>
                        <td className={num}>{money(c.tax)}</td>
                        <td className={num}>{money(c.credits)}</td>
                        <td className={`pl-3 text-right tabular-nums whitespace-nowrap ${res < 0 ? "text-emerald-700" : ""}`}>{res < 0 ? "ขอคืน" : "ชำระ"} {money(Math.abs(res))}
                          {r.ret?.status !== "FILED" && <div className="text-xs text-slate-500">ประมาณการ</div>}</td>
                      </>
                    ) : <td colSpan={6} className="px-3 text-center text-xs text-slate-400">-</td>}
                  </tr>
                );
              })}
            </tbody>
            {done.length > 1 && (
              <tfoot className="border-t border-slate-200 font-medium">
                <tr><td className="py-2 pr-3">รวม {done.length} คน</td><td />
                  <td className={num}>{money(tot((c) => c.assessable))}</td><td className={num}>{money(tot((c) => c.expenses + c.deductions + c.donations))}</td>
                  <td className={num}>{money(tot((c) => c.taxable))}</td><td className={num}>{money(tot((c) => c.tax))}</td><td className={num}>{money(tot((c) => c.credits))}</td>
                  <td className={`pl-3 text-right tabular-nums whitespace-nowrap ${totResult < 0 ? "text-emerald-700" : ""}`}>{totResult < 0 ? "ขอคืน" : "ชำระ"} {money(Math.abs(totResult))}</td></tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ p?: string; y?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const isAdmin = me.role === "ADMIN";
  const today = todayBangkok();
  const thisYear = Number(today.slice(0, 4));

  // ความเร็ว (5 พ.ย. 2026): รายชื่อ · แบบภาษีของคนที่น่าจะเปิด · สถานะ Drive เริ่มพร้อมกัน แล้วบรรทัดภาษีต่อจากแบบภาษีในรอบเดียวกัน (เดิม 3 รอบ → 2 รอบ)
  const personsP = (isAdmin
    ? supabase.from("persons").select("id,name,birth_date").is("deleted_at", null).order("sort_order").order("created_at").then((r) => r.data ?? [])
    : me.person_id ? supabase.from("persons").select("id,name,birth_date").eq("id", me.person_id).then((r) => r.data ?? []) : Promise.resolve([]))
    .then((d) => d as { id: string; name: string; birth_date: string | null }[]);
  const info = <PageInfo>ภาษีเงินได้บุคคลธรรมดารายปีของสมาชิกแต่ละคน · ยอดดึงจากรายได้ / รายจ่าย / ประกัน / หนี้ / การบริจาคที่บันทึกไว้แล้ว (ไม่ต้องกรอกซ้ำ) ·
    แก้ยอดใช้ยื่นได้พร้อมเหตุผล · ยื่นแล้วล็อกยอดตามที่ยื่น · ADMIN เห็นทุกคน บทบาทอื่นเห็นเฉพาะของตัวเอง</PageInfo>;

  // ทั้งครอบครัว (ADMIN): อ่านเฉพาะยอดที่เก็บไว้ในแบบภาษี ไม่ดึงยอดจากระบบมาคำนวณใหม่ (ตกลง 5 พ.ย. 2026)
  if (isAdmin && sp.p === "all") {
    const [people, fam] = await Promise.all([personsP, loadFamilyTax(supabase, sp.y, thisYear)]);
    return <FamilyTax info={info} people={people} fam={fam} thisYear={thisYear} today={today} />;
  }

  const guess = sp.p && sp.p !== "all" ? sp.p : me.person_id ?? null;
  const loadOne = (pid: string) => supabase.from("tax_returns")
    .select("id,tax_year,version,form_type,status,amend_reason,filed_date,reference_no,tax_result,settlement_status,settled_date,refreshed_at,notes")
    .eq("person_id", pid).is("deleted_at", null).order("tax_year", { ascending: false }).order("version", { ascending: false })
    .then(async ({ data: rets }) => {
      const all = (rets ?? []) as Ret[];
      const years = yearsOf(thisYear, all.map((r) => r.tax_year));
      const y = /^\d{4}$/.test(sp.y ?? "") && years.includes(Number(sp.y)) ? Number(sp.y) : all[0]?.tax_year ?? thisYear;
      const versions = all.filter((r) => r.tax_year === y);
      const cur = versions[0];
      const [lineRes, { data: links }] = await Promise.all([
        cur
          ? supabase.from("tax_return_lines").select(LINE_COLS).eq("return_id", cur.id).is("deleted_at", null).order("sort_order")
          // ยังไม่สร้างแบบร่าง → ดึงยอดจากระบบมาแสดงเป็นตัวอย่าง (ครั้งเดียวที่ต้องคำนวณจากรายได้ / รายจ่าย)
          : supabase.rpc("tax_system_lines", { p_person: pid, p_year: y }),
        versions.length
          ? supabase.from("document_links").select("entity_id,documents(id,title,deleted_at)").eq("entity_type", "TAX_RETURN").in("entity_id", versions.map((v) => v.id)).is("deleted_at", null)
          : Promise.resolve({ data: [] as { entity_id: string; documents: unknown }[] }),
      ]);
      return { pid, all, years, y, versions, cur, lineRows: lineRes.data as unknown[] | null, lineErr: lineRes.error, links };
    });
  const firstP = guess ? loadOne(guess) : null;
  const [people, first, { data: drive }] = await Promise.all([personsP, firstP, supabase.rpc("drive_status")]);
  if (people.length === 0) {
    return <div className="space-y-4">{info}<p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      บัญชีผู้ใช้ของคุณยังไม่ได้ผูกกับสมาชิกครอบครัว จึงยังไม่มีข้อมูลภาษีให้ดู · ให้ ADMIN ผูกที่ Settings → User &amp; Security</p></div>;
  }
  const p = people.find((x) => x.id === sp.p)?.id ?? people.find((x) => x.id === me.person_id)?.id ?? people[0].id;
  const canWrite = isAdmin || ((me.role === "EDITOR" || me.role === "CONTRIBUTOR") && p === me.person_id);
  const canDelete = canWrite && (isAdmin || me.role === "EDITOR");
  // คนที่เริ่มดึงไว้ไม่ใช่คนที่เปิดจริง (ลิงก์เก่า / ไม่มีสิทธิ์) → ดึงใหม่ของคนที่ถูก (ไม่ค่อยเกิด)
  const { all, years, y, versions, cur, lineRows, lineErr, links } = first && first.pid === p ? first : await loadOne(p);
  const lines = ((lineRows ?? []) as Line[]).map((l, i) => ({ ...l, id: l.id ?? `preview-${i}` }));
  const connected = !!(drive as { connected?: boolean } | null)?.connected;
  const docs = (links ?? []).map((l) => (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; deleted_at: string | null } | null)
    .filter((d): d is { id: string; title: string; deleted_at: string | null } => !!d && !d.deleted_at);

  const editable = !!cur && cur.status !== "FILED" && canWrite;
  const sum = (sec: string, f: (l: Line) => number | null = eff, skip?: string) =>
    lines.filter((l) => l.section === sec && l.code !== skip).reduce((s, l) => s + (f(l) ?? 0), 0);
  const review = lines.find((l) => l.code === "REVIEW");
  const changed = lines.filter((l) => l.filed_amount != null && l.system_amount != null && Number(l.filed_amount) !== Number(l.system_amount)).length;
  const person = people.find((x) => x.id === p);
  const personName = person?.name ?? "";
  // อายุ ณ 31 ธ.ค. ของปีภาษี (ยกเว้นเงินได้ผู้มีอายุ 65 ปีขึ้นไป)
  const age = person?.birth_date ? y - Number(person.birth_date.slice(0, 4)) : null;
  const calc = calcTax(lines, y, { age });

  return (
    <div className="space-y-6">
      {info}
      {/* ตัวกรองผู้เสียภาษี / ปีภาษี อยู่แถวแท็บ (ตกลง 30 ต.ค. 2026) */}
      <TabActions><TaxFilters persons={people} years={years} p={p} y={y} /></TabActions>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mr-auto">
          <div className="font-medium text-slate-900">{personName} · ปีภาษี {y + 543}
            {cur && <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_CLS[cur.status]}`}>{TAX_RETURN_STATUS_LABEL[cur.status]}</span>}
            {cur && <span className="ml-2 text-sm font-normal text-slate-500">{TAX_FORM_LABEL[cur.form_type]}{cur.version > 1 ? ` · ยื่นเพิ่มเติมครั้งที่ ${cur.version - 1}` : ""}</span>}</div>
          <div className="text-xs text-slate-500">
            {!cur ? "ยังไม่มีแบบภาษีของปีนี้ — ด้านล่างเป็นยอดจากระบบ (ตัวอย่าง)" : cur.status === "FILED"
              ? `ยื่นแล้ว ${thDate(cur.filed_date!)}${cur.reference_no ? ` · เลขอ้างอิง ${cur.reference_no}` : ""}${cur.tax_result != null ? ` · ${Number(cur.tax_result) < 0 ? "ขอคืน" : "ชำระเพิ่ม"} ${money(Math.abs(Number(cur.tax_result)))} บาท` : ""}${cur.settlement_status ? ` · ${TAX_SETTLEMENT_LABEL[cur.settlement_status]}` : ""}${cur.settled_date ? ` ${thDate(cur.settled_date)}` : ""}`
              : `ดึงยอดจากระบบล่าสุด ${cur.refreshed_at ? thDate(cur.refreshed_at.slice(0, 10)) : "-"}${changed ? ` · แก้ยอดเอง ${changed} รายการ` : ""}`}
            {y >= thisYear && <span className="ml-1 text-amber-700">· ปีภาษียังไม่จบ ยอดเป็นข้อมูลถึงวันที่ {thDate(today)}</span>}
          </div>
          {cur?.amend_reason && <div className="text-xs text-slate-500">เหตุผลที่ยื่นเพิ่มเติม: {cur.amend_reason}</div>}
        </div>
        {!cur && canWrite && <CreateReturn personId={p} year={y} />}
        {editable && <ActButton act="refresh" id={cur.id} label="ดึงยอดจากระบบใหม่" />}
        {editable && cur.status === "DRAFT" && <ActButton act="status" id={cur.id} label="ตรวจแล้ว" extra={{ status: "REVIEWED" }} />}
        {editable && cur.status === "REVIEWED" && <ActButton act="status" id={cur.id} label="กลับเป็นฉบับร่าง" extra={{ status: "DRAFT" }} />}
        {editable && <FileReturn id={cur.id} today={today} result={calc.result} />}
        {editable && canDelete && <DeleteReturn id={cur.id} />}
        {cur?.status === "FILED" && canWrite && <SettlementForm id={cur.id} v={cur} />}
        {cur?.status === "FILED" && canWrite && <AmendReturn id={cur.id} />}
      </section>
      {lineErr && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {lineErr.message}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">1. สรุปจากระบบ</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBox label="เงินได้พึงประเมินรวม" value={money(sum("INCOME", eff, "REVIEW"))} unit="บาท" sub={cur ? "ตามยอดใช้ยื่น" : "ยอดจากระบบ"} />
          <StatBox label="ภาษีหัก ณ ที่จ่าย / ชำระแล้ว" value={money(sum("CREDIT"))} unit="บาท" />
          <StatBox label="ค่าลดหย่อน + บริจาค (ก่อนเพดาน)" value={money(sum("DEDUCTION") + sum("DONATION"))} unit="บาท" sub="ยอดเงิน (ไม่รวมลดหย่อนรายคน) · หลังเพดานดูส่วนที่ 5" />
          <StatBox label="รายได้รอตรวจสอบ" value={money(n(review?.system_amount) ?? 0)} unit="บาท" sub="ยังไม่รวมคำนวณ · ตรวจแล้วใส่ในช่อง ม.40 ที่ถูกต้อง"
            subClass={n(review?.system_amount) ? "text-amber-700" : undefined} />
        </div>
      </section>

      {SECTIONS.map((s) => {
        const list = lines.filter((l) => l.section === s.key);
        if (list.length === 0) return null;
        return (
          <section key={s.key} className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900">{s.title}</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-4 py-2">รายการ</th>{s.key === "DEDUCTION" && <th className="px-4 text-right">จำนวน (คน)</th>}
                    {s.key === "EXPENSE" && <th className="px-4">วิธีหัก</th>}<th className="px-4 text-right">ยอดจากระบบ</th><th className="px-4 text-right">ยอดใช้ยื่น</th><th className="px-4">เหตุผล</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((l) => {
                    const diff = l.filed_amount != null && Number(l.filed_amount) !== Number(l.system_amount ?? NaN);
                    const qty = n(l.filed_qty) ?? n(l.qty);
                    return (
                      <tr key={l.code} className={`align-top ${l.code === "REVIEW" ? "bg-amber-50/40" : ""}`}>
                        <td className="px-4 py-2.5"><div className="text-slate-900">{l.label}</div><Detail l={l} /></td>
                        {s.key === "DEDUCTION" && <td className="px-4 py-2.5 text-right tabular-nums">{qty ?? "-"}
                          {l.filed_qty != null && l.qty != null && Number(l.filed_qty) !== Number(l.qty) && <div className="text-xs text-slate-500">ระบบ {l.qty}</div>}</td>}
                        {s.key === "EXPENSE" && <td className="px-4 py-2.5 text-slate-600">{l.method ? TAX_METHOD_LABEL[l.method] : "-"}</td>}
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{l.system_amount == null ? "-" : money(l.system_amount)}</td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${diff ? "font-medium text-blue-800" : ""}`}>{eff(l) == null ? "-" : money(eff(l)!)}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{l.reason ?? ""}</td>
                        <td className="px-4 py-1.5 text-right">{editable && <LineEditor v={l} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {s.note && <p className="text-xs text-slate-500">{s.note}</p>}
          </section>
        );
      })}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">5. คำนวณภาษี (ประมาณการ)</h2>
        {calc.warning && <p className="text-sm text-amber-700">{calc.warning}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {calc.steps.map((st, i) => (
                  <tr key={i} className={st.strong ? "bg-slate-50 font-medium" : ""}>
                    <td className="px-4 py-2">{st.label}{st.note && <div className="text-xs font-normal text-slate-500">{st.note}</div>}</td>
                    <td className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${st.amount < 0 ? "text-slate-600" : ""}`}>{money(st.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            <StatBox label={calc.result < 0 ? "ประมาณการขอคืนภาษี" : "ประมาณการชำระภาษีเพิ่ม"} value={money(Math.abs(calc.result))} unit="บาท"
              valueClass={calc.result < 0 ? "text-emerald-700" : undefined}
              sub={<>ภาษีทั้งปี {money(calc.tax)} บาท · เงินได้สุทธิ {money(calc.taxable)} บาท{calc.assessable ? <> · อัตราเฉลี่ย <span className="font-semibold">{(calc.tax / calc.assessable * 100).toFixed(2)}%</span> ของเงินได้</> : null}</>} />
            {calc.brackets.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">เงินได้สุทธิ</th><th className="px-4 text-right">อัตรา</th><th className="px-4 text-right">ภาษี</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {calc.brackets.map((b) => (
                      <tr key={b.from}><td className="px-4 py-1.5 tabular-nums">{money(b.from)} – {Number.isFinite(b.to) ? money(b.to) : "ขึ้นไป"}</td>
                        <td className="px-4 text-right">{b.rate}%</td><td className="px-4 text-right tabular-nums">{money(b.tax)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {calc.capped.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                <div className="mb-1 font-medium text-amber-800">ใช้สิทธิได้ไม่เต็มยอด (ติดเพดาน)</div>
                <ul className="space-y-1 text-amber-900">
                  {calc.capped.map((x) => <li key={x.code}>{x.label}: {money(x.claimed)} → ใช้ได้ {money(x.allowed)} <span className="text-xs text-amber-700">({x.note})</span></li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">ประมาณการตามอัตราและเพดานของปีภาษี {calc.rulesYear + 543} จากยอดใช้ยื่นด้านบน · ไม่รวม &ldquo;รอตรวจสอบ&rdquo; ·
          บุตรคนที่ 2 ขึ้นไปที่เกิดตั้งแต่ปี 2561 ได้ 60,000 / ค่าเช่าที่ดิน / 40(8) บางประเภทมีอัตราเหมาต่างกัน — แก้ยอดในรายการด้านบน · ยอดจริงให้ยึดตามแบบที่ยื่นกับกรมสรรพากร</p>
      </section>

      {cur && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">เอกสาร</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            {docs.length === 0 ? <span className="text-slate-400">ยังไม่มีเอกสาร</span> : docs.map((d) => (
              <span key={d.id}>{connected ? <a href={`/view/${d.id}`} target="_blank" rel="noopener" className="text-blue-700 hover:underline">{d.title}</a> : d.title}</span>))}
            {canWrite && connected && <span className="ml-auto"><DocumentUpload module="FAMILY" link={{ type: "TAX_RETURN", id: cur.id }} category="TAX" label="+ แนบแบบ ภ.ง.ด. / 50 ทวิ / ใบเสร็จ" /></span>}
          </div>
          <p className="text-xs text-slate-500">เอกสารที่แนบเก็บใน Google Drive และแสดงในแท็บ Documents ตามสิทธิ์ของหน้า Documents</p>
        </section>
      )}

      {versions.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">ประวัติการยื่นปีภาษี {y + 543}</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">ฉบับ</th><th className="px-4">สถานะ</th><th className="px-4">วันที่ยื่น · เลขอ้างอิง</th><th className="px-4 text-right">ผลภาษี</th><th className="px-4">เหตุผลที่ยื่นเพิ่มเติม</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map((v) => (
                  <tr key={v.id}><td className="px-4 py-2">{v.version === 1 ? "ฉบับแรก" : `ยื่นเพิ่มเติมครั้งที่ ${v.version - 1}`}</td>
                    <td className="px-4"><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLS[v.status]}`}>{TAX_RETURN_STATUS_LABEL[v.status]}</span></td>
                    <td className="px-4">{v.filed_date ? thDate(v.filed_date) : "-"}{v.reference_no ? ` · ${v.reference_no}` : ""}</td>
                    <td className="px-4 text-right tabular-nums">{v.tax_result == null ? "-" : `${Number(v.tax_result) < 0 ? "ขอคืน" : "ชำระ"} ${money(Math.abs(Number(v.tax_result)))}`}</td>
                    <td className="px-4 text-slate-600">{v.amend_reason ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
