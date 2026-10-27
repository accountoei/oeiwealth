import { bahtText, money, thDateLong } from "@/lib/format";

/** ข้อมูลที่ใช้ร่างสัญญา / ตารางแนบท้าย (มาจากข้อมูลสัญญาในระบบ · ช่องที่ไม่มีข้อมูลเว้นเส้นให้เขียนเอง) */
export type ContractData = {
  contractNo: string | null; loanDate: string | null; dueDate: string | null; currency: string;
  borrower: string; borrowerPhone: string | null; lenders: string[]; purpose: string | null;
  principal: number; ratePct: number | null;
  lines: { no: number; due: string; principal: number; interest: number }[];
};

const blank = (w = "10rem") => <span className="inline-block border-b border-dotted border-slate-500 align-bottom" style={{ width: w }} />;
const monthGap = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const amountOf = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท (${bahtText(v)})` : `${money(v)} ${ccy}`);
const plain = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท` : `${money(v)} ${ccy}`);

/** อากรแสตมป์สัญญากู้ยืม: 1 บาท ต่อทุก 2,000 บาท หรือเศษ · สูงสุด 10,000 บาท */
export function stampDuty(principal: number) {
  return Math.min(Math.ceil(principal / 2000), 10000);
}

/** ข้อ 3 การชำระคืน: ข้อความตามแบบตารางผ่อน (ไม่มีตาราง / ดอกรายงวดคืนต้นตอนจบ / ผ่อนต้น + ดอก) */
export function repaymentText(d: ContractData): string {
  const L = d.lines, n = L.length;
  const due = d.dueDate ? `วันที่ ${thDateLong(d.dueDate)}` : null;
  if (n === 0) return `ผู้กู้ตกลงชำระคืนเงินต้นพร้อมดอกเบี้ยทั้งหมดให้แก่ผู้ให้กู้ภายใน${due ?? "วันที่ ____________________"}`;
  const first = L[0], last = L[n - 1];
  const monthly = n > 1 && L.slice(1).every((x, i) => monthGap(L[i].due, x.due) === 1);
  const freq = monthly ? `เป็นรายเดือน ทุกวันที่ ${Number(first.due.slice(8, 10))} ของเดือน` : "เป็นงวด";
  const span = `เริ่มงวดแรกวันที่ ${thDateLong(first.due)} งวดสุดท้ายวันที่ ${thDateLong(last.due)}`;
  const annex = "ตามตารางผ่อนชำระแนบท้ายสัญญานี้ ซึ่งถือเป็นส่วนหนึ่งของสัญญา";
  if (n === 1) return `ผู้กู้ตกลงชำระคืนเงินต้น ${plain(last.principal, d.currency)} พร้อมดอกเบี้ย ${plain(last.interest, d.currency)} ภายในวันที่ ${thDateLong(last.due)}`;
  if (L.slice(0, -1).every((x) => x.principal === 0)) {
    return `ผู้กู้ตกลงชำระดอกเบี้ย${freq} รวม ${n} งวด ${span} และชำระคืนเงินต้นทั้งหมดพร้อมดอกเบี้ยงวดสุดท้าย ${annex}`;
  }
  const t = (x: { principal: number; interest: number }) => x.principal + x.interest;
  const same = L.slice(1, -1).every((x) => Math.abs(t(x) - t(first)) < 1);
  return same
    ? `ผู้กู้ตกลงผ่อนชำระเงินต้นพร้อมดอกเบี้ย${freq} รวม ${n} งวด งวดละ ${plain(t(first), d.currency)}${Math.abs(t(last) - t(first)) >= 1 ? ` (งวดสุดท้าย ${plain(t(last), d.currency)})` : ""} ${span} ${annex}`
    : `ผู้กู้ตกลงผ่อนชำระเงินต้นพร้อมดอกเบี้ย${freq} รวม ${n} งวด ${span} ตามจำนวนเงินที่กำหนดในตารางผ่อนชำระแนบท้ายสัญญานี้ ซึ่งถือเป็นส่วนหนึ่งของสัญญา`;
}

function Sign({ role, name }: { role: string; name?: string }) {
  return (
    <div className="text-center">
      <div>ลงชื่อ {blank("11rem")} {role}</div>
      <div className="mt-1">( {name ? <span className="inline-block min-w-[11rem]">{name}</span> : blank("11rem")} )</div>
    </div>
  );
}

/**
 * สัญญากู้ยืมเงิน (ร่างจากแบบมาตรฐาน · 1 หน้า A4) — เนื้อหาแก้ที่ไฟล์นี้ไฟล์เดียว
 * ไม่ใช่คำปรึกษากฎหมาย: ให้ทนายตรวจข้อความก่อนใช้จริง
 */
export function LoanContract({ d }: { d: ContractData }) {
  const rate = d.ratePct ?? 0;
  const lenders = d.lenders.length ? d.lenders.join(" และ ") : null;
  return (
    <article className="contract text-[13px] leading-[1.75]">
      <h1 className="text-center text-lg font-semibold">สัญญากู้ยืมเงิน</h1>
      <div className="mt-2 flex flex-wrap justify-end gap-x-6">
        <span>เลขที่สัญญา {d.contractNo || blank("7rem")}</span>
        <span>ทำที่ {blank("12rem")}</span>
      </div>
      <div className="text-right">วันที่ {d.loanDate ? thDateLong(d.loanDate) : blank("10rem")}</div>
      <p className="mt-2 indent-10">
        สัญญานี้ทำขึ้นระหว่าง <b>{d.borrower}</b> เลขประจำตัวประชาชน {blank("9rem")} ที่อยู่ {blank("16rem")}
        {d.borrowerPhone ? ` โทร ${d.borrowerPhone}` : ""} ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้กู้&rdquo;</b> ฝ่ายหนึ่ง
        กับ {lenders ? <b>{lenders}</b> : blank("12rem")} ที่อยู่ {blank("16rem")} ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้ให้กู้&rdquo;</b> อีกฝ่ายหนึ่ง
        ทั้งสองฝ่ายตกลงกันดังต่อไปนี้
      </p>
      <p className="indent-10"><b>ข้อ 1 จำนวนเงินกู้</b> ผู้กู้ได้กู้ยืมเงินจากผู้ให้กู้เป็นจำนวน {amountOf(d.principal, d.currency)}
        {d.purpose ? ` เพื่อ${d.purpose.startsWith("เพื่อ") ? d.purpose.slice(5) : d.purpose}` : ""} และผู้กู้ได้รับเงินจำนวนดังกล่าวไปครบถ้วนแล้วในวันทำสัญญานี้</p>
      <p className="indent-10"><b>ข้อ 2 ดอกเบี้ย</b> {rate > 0
        ? `ผู้กู้ตกลงชำระดอกเบี้ยให้แก่ผู้ให้กู้ในอัตราร้อยละ ${rate} ต่อปี ของเงินต้นที่ค้างชำระ นับแต่วันที่ได้รับเงินกู้เป็นต้นไป`
        : "ผู้ให้กู้ไม่คิดดอกเบี้ยจากเงินกู้ตามสัญญานี้"}</p>
      <p className="indent-10"><b>ข้อ 3 การชำระคืน</b> {repaymentText(d)}</p>
      <p className="indent-10"><b>ข้อ 4 วิธีชำระ</b> ผู้กู้จะชำระเงินโดยโอนเข้าบัญชีธนาคาร {blank("8rem")} เลขที่บัญชี {blank("8rem")} หรือตามที่ผู้ให้กู้แจ้งเป็นหนังสือ
        เงินที่ได้รับให้นำไปชำระดอกเบี้ยที่ค้างก่อน ส่วนที่เหลือนำไปชำระเงินต้น ผู้กู้มีสิทธิชำระคืนก่อนกำหนดได้ โดยคิดดอกเบี้ยถึงวันที่ชำระจริง</p>
      <p className="indent-10"><b>ข้อ 5 การผิดนัด</b> หากผู้กู้ผิดนัดชำระงวดใดงวดหนึ่ง และไม่ชำระภายใน 30 วันนับแต่วันที่ได้รับหนังสือบอกกล่าวจากผู้ให้กู้
        ให้ถือว่าผู้กู้ผิดนัดชำระหนี้ทั้งหมด ผู้ให้กู้มีสิทธิเรียกให้ผู้กู้ชำระหนี้ที่ค้างทั้งหมดได้ทันที พร้อมดอกเบี้ยผิดนัดตามที่กฎหมายกำหนด</p>
      <p className="indent-10"><b>ข้อ 6</b> สัญญานี้ทำขึ้นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว
        จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน และต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ</p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        <Sign role="ผู้กู้" name={d.borrower} />
        {(d.lenders.length ? d.lenders : [undefined]).map((n, i) => <Sign key={i} role="ผู้ให้กู้" name={n} />)}
        <Sign role="พยาน" />
        <Sign role="พยาน" />
      </div>
      {d.currency === "THB" && (
        <p className="mt-5 text-[11px] text-slate-500">ติดอากรแสตมป์ {money(stampDuty(d.principal), undefined, 0)} บาท (1 บาท ต่อทุก 2,000 บาท หรือเศษ · สูงสุด 10,000 บาท)</p>
      )}
    </article>
  );
}

/** เอกสารแนบท้าย: ตารางผ่อนชำระ (ทั้งแผน ไม่มีสถานะการรับ) */
export function ScheduleAnnex({ d }: { d: ContractData }) {
  const sum = (k: "principal" | "interest") => d.lines.reduce((s, x) => s + x[k], 0);
  // เงินต้นคงเหลือหลังแต่ละงวด = เงินต้นรวมตามตาราง − เงินต้นสะสมถึงงวดนั้น
  const left = d.lines.map((_, i) => Math.max(Math.round((sum("principal") - d.lines.slice(0, i + 1).reduce((s, x) => s + x.principal, 0)) * 100) / 100, 0));
  return (
    <article className="text-[12px]">
      <h2 className="text-center text-base font-semibold">ตารางผ่อนชำระ</h2>
      <p className="text-center">แนบท้ายสัญญากู้ยืมเงิน{d.contractNo ? ` เลขที่ ${d.contractNo}` : ""}{d.loanDate ? ` ลงวันที่ ${thDateLong(d.loanDate)}` : ""}</p>
      <p className="text-center">ผู้กู้ {d.borrower} · เงินต้น {plain(d.principal, d.currency)}{d.ratePct ? ` · ดอกเบี้ยร้อยละ ${d.ratePct} ต่อปี` : ""}</p>
      <table className="mt-3 w-full border-collapse">
        <thead><tr className="border-y border-slate-400 text-left">
          <th className="py-1">งวดที่</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th>
          <th className="text-right">รวมชำระ</th><th className="text-right">เงินต้นคงเหลือ</th></tr></thead>
        <tbody>
          {d.lines.map((x, i) => (
            <tr key={x.no} className="break-inside-avoid border-b border-slate-200">
              <td className="py-0.5">{x.no}</td><td>{thDateLong(x.due)}</td>
              <td className="text-right tabular-nums">{money(x.principal)}</td><td className="text-right tabular-nums">{money(x.interest)}</td>
              <td className="text-right tabular-nums">{money(x.principal + x.interest)}</td><td className="text-right tabular-nums">{money(left[i])}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-y border-slate-400 font-semibold">
          <td className="py-1" colSpan={2}>รวม {d.lines.length} งวด</td>
          <td className="text-right tabular-nums">{money(sum("principal"))}</td><td className="text-right tabular-nums">{money(sum("interest"))}</td>
          <td className="text-right tabular-nums">{money(sum("principal") + sum("interest"))}</td><td /></tr></tfoot>
      </table>
      <div className="mt-8 grid grid-cols-2 gap-6 break-inside-avoid">
        <Sign role="ผู้กู้" name={d.borrower} />
        <Sign role="ผู้ให้กู้" name={d.lenders.join(" และ ") || undefined} />
      </div>
    </article>
  );
}
