import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import Link from "next/link";
import { FX_BBL_RATE_LABEL, FX_SOURCE_LABEL, HOLDING_TYPE_LABEL, addDays, money, thDate, todayBangkok } from "@/lib/format";
import ExpandRows, { type ExpandRow } from "./ExpandRows";
import FxSourceForm from "./FxSourceForm";
import { ActionBar } from "@/components/ActionBar";
import OverrideForm from "./OverrideForm";
import FxRefreshButton from "./FxRefreshButton";
import { redirect } from "next/navigation";

const JOB_RESULT: Record<string, string> = { SUCCESS: "สำเร็จ", PARTIAL: "บางส่วน", FAILED: "ล้มเหลว", RUNNING: "กำลังทำงาน" };
const JOB_LABEL: Record<string, string> = { FX_FETCH: "อัตราแลกเปลี่ยน", FX_BACKFILL: "อัตราแลกเปลี่ยน (ย้อนหลัง)", BACKUP: "สำรองข้อมูล", PRICE_FETCH: "ราคาอัตโนมัติ" };
const SKIP_REASON: Record<string, string> = { DEVIATION_OVER_5PCT: "ต่างจากก่อนหน้าเกิน 5%", NOT_CURRENT_SOURCE: "ไม่ใช่แหล่งปัจจุบัน", DEVIATION_OVER_20PCT: "ต่างจากก่อนหน้าเกิน 20%",
  NO_HOLDING: "ไม่พบหลักทรัพย์ / ปิดดึงราคาแล้ว", NOT_FOUND: "ไม่พบราคา", HAS_STATEMENT: "มีราคาจาก Statement วันนั้นแล้ว", BAD_DATE: "วันที่ไม่ถูกต้อง", UNIT: "หน่วยไม่ใช่ บาททองคำ / กรัม", PERIOD_LOCKED: "อยู่ในงวดที่ปิดแล้ว",
  NEEDS_BASELINE: "รอยืนยันราคาฐาน", NO_ASSOC_PRICE: "อ่านราคาสมาคมค้าทองคำไม่ได้", SOURCE_MISMATCH: "ราคาสมาคมฯ ต่างจากราคาโลกเกิน 3%" };

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // Opening Setup แยกเป็นแท็บของ Settings แล้ว (ลิงก์เดิม ?tab=opening ยังใช้ได้)
  if ((await searchParams).tab === "opening") redirect("/settings/opening");
  const me = await requireAppUser();
  const supabase = await createClient();
  const isAdmin = me.role === "ADMIN";
  const [{ data: family }, { data: fx }, { data: jobs }, { data: recent }, { data: autoHolds }, { data: autoGolds }, { data: lastPrice }, { data: lastRefresh }] = await Promise.all([
    supabase.from("families").select("base_currency,go_live_date,system_status,fx_source,fx_bbl_rate,fx_source_since").maybeSingle(),
    supabase.from("v_fx_status").select("currency,latest_rate_date,rate_to_thb,source,is_override,age_days,is_stale").order("currency"),
    isAdmin
      ? supabase.from("system_job_runs").select("id,job_type,started_at,result,details").order("started_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { id: number; job_type: string; started_at: string; result: string; details: unknown }[] }),
    // อัตราย้อนหลัง ~3 สัปดาห์ (แสดงเมื่อกดขยายแถวของสกุลนั้น)
    supabase.from("fx_rates").select("rate_date,currency,rate_to_thb,source,override_reason").is("deleted_at", null)
      .gte("rate_date", addDays(todayBangkok(), -21)).order("rate_date", { ascending: false }).limit(500),
    supabase.from("investment_holdings").select("id,name,symbol,holding_type,currency,price_pending,investment_portfolios(asset_id)")
      .eq("auto_price", true).eq("status", "ACTIVE").is("deleted_at", null).order("name"),
    supabase.from("alternative_asset_details").select("asset_id,price_pending,assets!inner(name,status,deleted_at)")
      .eq("auto_price", true).is("deleted_at", null).eq("assets.status", "ACTIVE").is("assets.deleted_at", null),
    supabase.from("investment_valuations").select("valuation_date").eq("source", "MARKET").is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1),
    // ปุ่มอัปเดตอัตรา: ครั้งล่าสุด + วันหมดอายุของ GitHub token (เตือนก่อน 30 วัน)
    isAdmin
      ? supabase.from("audit_logs").select("event_at,metadata").eq("entity_type", "fx_rates").eq("field_name", "fx_refresh_request")
          .order("event_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as { event_at: string; metadata: unknown }[] }),
  ]);
  const tokenExp = ((lastRefresh?.[0]?.metadata as { token_expires?: string | null } | null)?.token_expires ?? "").slice(0, 10);
  const tokenDays = tokenExp ? Math.round((Date.parse(tokenExp) - Date.parse(todayBangkok())) / 86400000) : null;

  const fxSource = family?.fx_source === "BBL" ? "BBL" : "BOT";

  // ราคาอัตโนมัติ: ราคาล่าสุดของแต่ละรายการ + ย้อนหลัง ~45 วัน (กดขยาย)
  const since = addDays(todayBangkok(), -45);
  const holdIds = (autoHolds ?? []).map((h) => h.id);
  const goldIds = (autoGolds ?? []).map((g) => g.asset_id);
  const [{ data: hv }, { data: gv }] = await Promise.all([
    holdIds.length
      ? supabase.from("investment_valuations").select("holding_id,valuation_date,price,source").in("holding_id", holdIds).is("deleted_at", null)
          .gte("valuation_date", since).order("valuation_date", { ascending: false }).limit(2000)
      : Promise.resolve({ data: [] as { holding_id: string; valuation_date: string; price: number | null; source: string }[] }),
    goldIds.length
      ? supabase.from("asset_valuations").select("asset_id,valuation_date,value,source,notes").in("asset_id", goldIds).is("deleted_at", null)
          .gte("valuation_date", since).order("valuation_date", { ascending: false }).limit(2000)
      : Promise.resolve({ data: [] as { asset_id: string; valuation_date: string; value: number; source: string; notes: string | null }[] }),
  ]);
  const VAL_SOURCE: Record<string, string> = { MARKET: "อัตโนมัติ", STATEMENT: "Statement", USER: "ผู้ใช้", APPRAISAL: "ประเมิน", OPENING: "ยอดตั้งต้น" };
  const today = todayBangkok();
  const status = (date: string | undefined, pending: unknown) => pending
    ? <span className="text-amber-700">รอยืนยันราคา</span>
    : !date ? <span className="text-red-600">ยังไม่มีราคา</span>
    : date < addDays(today, -5) ? <span className="text-amber-700">เก่ากว่า 5 วัน</span>
    : <span className="text-emerald-700">ปกติ</span>;
  // ทองคำ: ราคารับซื้อต่อบาททองคำอยู่ในหมายเหตุของราคาอัตโนมัติ (ถ้าไม่มี แสดงมูลค่ารวม)
  const goldPrice = (v: { value: number; notes: string | null }) => {
    const m = v.notes?.match(/รับซื้อ ([\d,.]+)\/บาททองคำ/);
    return m ? `${money(Number(m[1].replace(/,/g, "")), "THB", 0)} / บาททองคำ` : `มูลค่า ${money(v.value, "THB", 0)}`;
  };
  const priceRows: ExpandRow[] = [
    ...(autoHolds ?? []).map((h) => {
      const vs = (hv ?? []).filter((v) => v.holding_id === h.id && v.price != null);
      const pf = (h.investment_portfolios as unknown as { asset_id: string } | null)?.asset_id;
      const last = vs[0];
      return {
        key: `H:${h.id}`,
        cells: [
          pf ? <Link href={`/investments/${pf}/holding/${h.id}`} className="hover:underline">{h.symbol || h.name}</Link> : h.symbol || h.name,
          HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type,
          last ? `${money(Number(last.price), h.currency, 4)}` : "-",
          last ? thDate(last.valuation_date) : "-",
          last ? VAL_SOURCE[last.source] ?? last.source : "-",
          status(last?.valuation_date, h.price_pending),
        ],
        history: vs.slice(1, 11).map((v) => [thDate(v.valuation_date), money(Number(v.price), h.currency, 4), VAL_SOURCE[v.source] ?? v.source]),
      };
    }),
    ...(autoGolds ?? []).map((g) => {
      const vs = (gv ?? []).filter((v) => v.asset_id === g.asset_id && v.source !== "ACCOUNT_SETUP");
      const last = vs[0];
      const name = (g.assets as unknown as { name: string } | null)?.name ?? "ทองคำ";
      return {
        key: `G:${g.asset_id}`,
        cells: [
          <Link key="n" href={`/alternative/${g.asset_id}`} className="hover:underline">{name}</Link>,
          "ทองคำ",
          last ? goldPrice(last) : "-",
          last ? thDate(last.valuation_date) : "-",
          last ? VAL_SOURCE[last.source] ?? last.source : "-",
          status(last?.valuation_date, g.price_pending),
        ],
        history: vs.slice(1, 11).map((v) => [thDate(v.valuation_date), goldPrice(v), VAL_SOURCE[v.source] ?? v.source]),
      };
    }),
  ];

  // อัตราแลกเปลี่ยน: แถวละสกุล (วันที่ล่าสุด) · ขยายดู 10 วันก่อนหน้า
  const fxLabel = (r: { source: string; override_reason: string | null }) =>
    r.source === "ADMIN_OVERRIDE" ? `Override: ${r.override_reason}` : FX_SOURCE_LABEL[r.source] ?? r.source;
  const fxRows: ExpandRow[] = (fx ?? []).map((r) => ({
    key: r.currency,
    cells: [
      <span key="c" className="font-medium">{r.currency}</span>,
      r.rate_to_thb ?? "-",
      thDate(r.latest_rate_date),
      r.source ? FX_SOURCE_LABEL[r.source] ?? r.source : "-",
      r.is_stale ? <span className="text-red-600">ไม่มี / เก่าเกิน 5 วัน</span> : <span className="text-emerald-700">ปกติ</span>,
    ],
    history: (recent ?? []).filter((x) => x.currency === r.currency && x.rate_date !== r.latest_rate_date).slice(0, 10)
      .map((x) => [thDate(x.rate_date), String(x.rate_to_thb), fxLabel(x)]),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">FX &amp; Prices</h1>
        <p className="text-sm text-slate-500">
          สกุลเงินหลัก {family?.base_currency} · Go-live {thDate(family?.go_live_date)} · {family?.system_status}
        </p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-900">อัตราแลกเปลี่ยนของสกุลที่ใช้งาน</h2>
            <p className="mt-1 text-sm text-slate-700">
              แหล่งปัจจุบัน: <b>{fxSource === "BBL" ? "ธนาคารกรุงเทพ" : "ธปท."}</b>
              {fxSource === "BBL" && <> · {FX_BBL_RATE_LABEL[family?.fx_bbl_rate ?? "MID"]}</>}
              {family?.fx_source_since && <span className="text-slate-500"> · ตั้งแต่ {thDate(family.fx_source_since)}</span>}
            </p>
          </div>
          {isAdmin && <ActionBar><FxRefreshButton /><FxSourceForm source={fxSource} bblRate={family?.fx_bbl_rate ?? "MID"} /><OverrideForm today={todayBangkok()} /></ActionBar>}
        </div>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          ดึงอัตราทุกวันราว 09:15 · 14:15 · 19:15 (GitHub อาจเริ่มช้ากว่านี้ได้) · การคำนวณใช้ Rate <b>ของวันเดียวกัน</b> (ยังไม่มี = Rate ล่าสุดก่อนหน้า) · Rate ที่อัปเดตระหว่างวันมีผลทันที แต่ยอดบาทของรายการที่บันทึกแล้วไม่เปลี่ยน · Rate เก่ากว่า 5 วัน = FX_STALE (ปิดเดือนไม่ได้) · เปลี่ยนแหล่งแล้วอัตราที่บันทึกไว้เดิมไม่เปลี่ยน
        </p>
        {isAdmin && lastRefresh?.[0] && (
          <p className={`mb-3 text-xs ${tokenDays != null && tokenDays <= 30 ? "text-amber-700" : "text-slate-500"}`}>
            กดอัปเดตครั้งล่าสุด {thDate(lastRefresh[0].event_at.slice(0, 10))}
            {tokenExp && <> · GitHub token หมดอายุ {thDate(tokenExp)}{tokenDays != null && tokenDays <= 30 && ` (อีก ${tokenDays} วัน — สร้าง token ใหม่แล้วใส่ใน Supabase Secrets)`}</>}
          </p>
        )}
        {(fx ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">ยังไม่มีทรัพย์สินที่เป็นเงินต่างประเทศ</p>
        ) : (
          <ExpandRows head={["สกุล", "Rate ล่าสุด", "วันที่", "ที่มา", "สถานะ"]} historyHead={["วันที่", "1 หน่วย = บาท", "ที่มา"]}
            rows={fxRows} alignRight={[1]} />
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ราคาอัตโนมัติ</h2>
        <p className="mt-1 text-sm text-slate-700">
          เปิดอยู่: หลักทรัพย์ {autoHolds?.length ?? 0} ตัว · ทองคำ {autoGolds?.length ?? 0} รายการ
          {lastPrice?.[0]?.valuation_date && <span className="text-slate-500"> · ราคาล่าสุด {thDate(lastPrice[0].valuation_date)}</span>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          ดึงทุกวันจันทร์–ศุกร์ 18:45 · หุ้นไทย / ต่างประเทศจาก Yahoo Finance (ฟรี ไม่เป็นทางการ) · กองทุนไทยจาก ก.ล.ต. (ต้องตั้ง SEC_API_KEY) ·
          ทองคำประมาณจากราคาตลาดโลก × อัตราแลกเปลี่ยน · เปิดทีละรายการที่หน้าหลักทรัพย์ / หน้าทองคำ → แก้ไขข้อมูล ·
          ราคาครั้งแรก (หรือเว้นไปเกิน 30 วัน) และราคาที่ต่างจากราคาครั้งก่อนเกิน 20% ยังไม่บันทึก — รอ ADMIN / EDITOR กดยืนยันที่หน้ารายการ (แจ้งในหน้าแรก) · ไม่ทับราคาจาก Statement
        </p>
        {priceRows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <ExpandRows head={["รายการ", "ประเภท", "ราคาล่าสุด", "วันที่", "ที่มา", "สถานะ"]} historyHead={["วันที่", "ราคา", "ที่มา"]}
              rows={priceRows} alignRight={[2]} />
          </div>
        )}
      </section>

      {isAdmin && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">ประวัติงานอัตโนมัติ (ล่าสุด 10 ครั้ง)</h2>
            {(jobs ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">เวลา</th><th>งาน</th><th>ผล</th><th>จำนวน</th><th>หมายเหตุ</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(jobs ?? []).map((j) => {
                    const d = (j.details ?? {}) as { rows?: number; source?: string; error?: string; run_url?: string | null; skipped?: { date: string; currency?: string; symbol?: string; rate?: number; price?: number; previous?: number; reason: string }[] };
                    const sk = d.skipped ?? [];
                    return (
                      <tr key={j.id} className="align-top">
                        <td className="py-1.5">{new Date(j.started_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                        <td>{JOB_LABEL[j.job_type] ?? j.job_type}{d.source && <div className="text-xs text-slate-500">{FX_SOURCE_LABEL[d.source] ?? d.source}</div>}</td>
                        <td className={j.result === "PARTIAL" ? "text-amber-700" : j.result === "FAILED" ? "text-red-600" : ""}>{JOB_RESULT[j.result] ?? j.result}</td>
                        <td>{d.rows ?? "-"}</td>
                        <td className="text-xs text-slate-600">{d.error && <div className="text-red-600">{d.error}
                          {d.run_url && <> · <a href={d.run_url} target="_blank" rel="noreferrer" className="underline">ดู Log</a></>}</div>}
                          {sk.length === 0 ? "" : <>
                          ไม่บันทึก {sk.length} รายการ
                          {sk.slice(0, 3).map((x, i) => <div key={i}>{thDate(x.date)} {x.currency ?? x.symbol} {x.rate ?? x.price ?? ""}
                            {x.previous != null && ` (ก่อนหน้า ${x.previous})`} · {SKIP_REASON[x.reason] ?? x.reason}</div>)}
                        </>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
      )}
    </div>
  );
}
