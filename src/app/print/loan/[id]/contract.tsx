import { bahtText, money, thDateLong } from "@/lib/format";

/** ข้อมูลที่ใช้ร่างสัญญา / ตารางแนบท้าย (มาจากข้อมูลสัญญาในระบบ · ช่องที่ไม่มีข้อมูลเว้นเส้นให้เขียนเอง) */
export type ContractData = {
  contractNo: string | null; loanDate: string | null; dueDate: string | null; currency: string;
  borrower: string; borrowerPhone: string | null; lenders: string[]; purpose: string | null;
  /** รายละเอียดคู่สัญญา (ไม่มี = เว้นเส้นให้เขียนเอง) · เลขบัตรเต็มเฉพาะ ADMIN / EDITOR */
  borrowerAddress?: string | null; borrowerId?: string | null;
  /** ผู้กู้เป็นกิจการ → "เลขทะเบียนนิติบุคคล" (ค่าเริ่มต้น "เลขประจำตัวประชาชน") */
  borrowerIdLabel?: string;
  lenderAddresses?: (string | null)[];
  place?: string | null;
  bank?: { name: string; accountNo: string | null; accountName: string | null } | null;
  guarantor?: { name: string; phone: string | null; address: string | null; id: string | null } | null;
  witnesses?: (string | null)[];
  principal: number; ratePct: number | null;
  lines: { no: number; due: string; principal: number; interest: number }[];
};

/** เลขบัตรประชาชน 13 หลัก → 1-2345-67890-12-3 */
const fmtId = (v: string) => (/^\d{13}$/.test(v) ? `${v[0]}-${v.slice(1, 5)}-${v.slice(5, 10)}-${v.slice(10, 12)}-${v[12]}` : v);
const blank = (w = "10rem") => <span className="inline-block border-b border-dotted border-slate-500 align-bottom" style={{ width: w }} />;
const monthGap = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const amountOf = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท (${bahtText(v)})` : `${money(v)} ${ccy}`);
const plain = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท` : `${money(v)} ${ccy}`);

/** อากรแสตมป์สัญญากู้ยืม: 1 บาท ต่อทุก 2,000 บาท หรือเศษ · สูงสุด 10,000 บาท */
export function stampDuty(principal: number) {
  return Math.min(Math.ceil(principal / 2000), 10000);
}

/** ข้อ 3 การชำระคืน: ข้อความตามแบบตารางผ่อน (ไม่มีตาราง / ดอกรายงวดคืนต้นตอนจบ / ผ่อนต้น + ดอก)
 *  doc = "addendum" → ตารางแนบท้าย "บันทึกนี้" (บันทึกให้กู้เพิ่ม) แทน "สัญญานี้" */
export function repaymentText(d: ContractData, doc: "contract" | "addendum" = "contract"): string {
  const L = d.lines, n = L.length;
  const due = d.dueDate ? `วันที่ ${thDateLong(d.dueDate)}` : null;
  if (n === 0) return `ผู้กู้ตกลงชำระคืนเงินต้นพร้อมดอกเบี้ยทั้งหมดให้แก่ผู้ให้กู้ภายใน${due ?? "วันที่ ____________________"}`;
  const first = L[0], last = L[n - 1];
  const monthly = n > 1 && L.slice(1).every((x, i) => monthGap(L[i].due, x.due) === 1);
  const freq = monthly ? `เป็นรายเดือน ทุกวันที่ ${Number(first.due.slice(8, 10))} ของเดือน` : "เป็นงวด";
  const span = `เริ่มงวดแรกวันที่ ${thDateLong(first.due)} งวดสุดท้ายวันที่ ${thDateLong(last.due)}`;
  const tbl = doc === "addendum" ? "ตารางผ่อนชำระแนบท้ายบันทึกนี้ ซึ่งถือเป็นส่วนหนึ่งของบันทึกนี้" : "ตารางผ่อนชำระแนบท้ายสัญญานี้ ซึ่งถือเป็นส่วนหนึ่งของสัญญา";
  const annex = `ตาม${tbl}`;
  if (n === 1) return `ผู้กู้ตกลงชำระคืนเงินต้น ${plain(last.principal, d.currency)} พร้อมดอกเบี้ย ${plain(last.interest, d.currency)} ภายในวันที่ ${thDateLong(last.due)}`;
  if (L.slice(0, -1).every((x) => x.principal === 0)) {
    return `ผู้กู้ตกลงชำระดอกเบี้ย${freq} รวม ${n} งวด ${span} และชำระคืนเงินต้นทั้งหมดพร้อมดอกเบี้ยงวดสุดท้าย ${annex}`;
  }
  const t = (x: { principal: number; interest: number }) => x.principal + x.interest;
  const same = L.slice(1, -1).every((x) => Math.abs(t(x) - t(first)) < 1);
  return same
    ? `ผู้กู้ตกลงผ่อนชำระเงินต้นพร้อมดอกเบี้ย${freq} รวม ${n} งวด งวดละ ${plain(t(first), d.currency)}${Math.abs(t(last) - t(first)) >= 1 ? ` (งวดสุดท้าย ${plain(t(last), d.currency)})` : ""} ${span} ${annex}`
    : `ผู้กู้ตกลงผ่อนชำระเงินต้นพร้อมดอกเบี้ย${freq} รวม ${n} งวด ${span} ตามจำนวนเงินที่กำหนดใน${tbl}`;
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
  const g = d.guarantor;
  const addr = (v: string | null | undefined, w = "16rem") => (v ? v.replace(/\s*\n\s*/g, " ") : blank(w));
  // ผู้ให้กู้หลายคน: ที่อยู่เดียวกัน → แสดงครั้งเดียว · ต่างกัน → แสดงต่อท้ายแต่ละคน
  const la = d.lenderAddresses ?? [];
  const sameAddr = la.length > 0 && la.every((x) => x && x === la[0]);
  return (
    <article className="contract text-[13px] leading-[1.75]">
      <h1 className="text-center text-lg font-semibold">สัญญากู้ยืมเงิน</h1>
      <div className="mt-2 flex flex-wrap justify-end gap-x-6">
        <span>เลขที่สัญญา {d.contractNo || blank("7rem")}</span>
        <span>ทำที่ {d.place ? d.place.replace(/\s*\n\s*/g, " ") : blank("12rem")}</span>
      </div>
      <div className="text-right">วันที่ {d.loanDate ? thDateLong(d.loanDate) : blank("10rem")}</div>
      <p className="mt-2 indent-10">
        สัญญานี้ทำขึ้นระหว่าง <b>{d.borrower}</b> {d.borrowerIdLabel ?? "เลขประจำตัวประชาชน"} {d.borrowerId ? fmtId(d.borrowerId) : blank("9rem")} ที่อยู่ {addr(d.borrowerAddress)}
        {d.borrowerPhone ? ` โทร ${d.borrowerPhone}` : ""} ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้กู้&rdquo;</b> ฝ่ายหนึ่ง
        กับ {d.lenders.length === 0 ? <>{blank("12rem")} ที่อยู่ {blank("16rem")}</>
          : sameAddr || d.lenders.length === 1 ? <><b>{d.lenders.join(" และ ")}</b> ที่อยู่ {addr(la[0])}</>
          : d.lenders.map((n, i) => <span key={i}>{i > 0 && " และ "}<b>{n}</b> ที่อยู่ {addr(la[i], "12rem")}</span>)}
        {" "}ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้ให้กู้&rdquo;</b> อีกฝ่ายหนึ่ง
        ทั้งสองฝ่ายตกลงกันดังต่อไปนี้
      </p>
      <p className="indent-10"><b>ข้อ 1 จำนวนเงินกู้</b> ผู้กู้ได้กู้ยืมเงินจากผู้ให้กู้เป็นจำนวน {amountOf(d.principal, d.currency)}
        {d.purpose ? ` เพื่อ${d.purpose.startsWith("เพื่อ") ? d.purpose.slice(5) : d.purpose}` : ""} และผู้กู้ได้รับเงินจำนวนดังกล่าวไปครบถ้วนแล้วในวันทำสัญญานี้</p>
      <p className="indent-10"><b>ข้อ 2 ดอกเบี้ย</b> {rate > 0
        ? `ผู้กู้ตกลงชำระดอกเบี้ยให้แก่ผู้ให้กู้ในอัตราร้อยละ ${rate} ต่อปี ของเงินต้นที่ค้างชำระ นับแต่วันที่ได้รับเงินกู้เป็นต้นไป`
        : "ผู้ให้กู้ไม่คิดดอกเบี้ยจากเงินกู้ตามสัญญานี้"}</p>
      <p className="indent-10"><b>ข้อ 3 การชำระคืน</b> {repaymentText(d)}</p>
      <p className="indent-10"><b>ข้อ 4 วิธีชำระ</b> ผู้กู้จะชำระเงินโดยโอนเข้าบัญชีธนาคาร {d.bank?.name || blank("8rem")}{d.bank?.accountName ? ` ชื่อบัญชี ${d.bank.accountName}` : ""} เลขที่บัญชี {d.bank?.accountNo || blank("8rem")} หรือตามที่ผู้ให้กู้แจ้งเป็นหนังสือ
        เงินที่ได้รับให้นำไปชำระดอกเบี้ยที่ค้างก่อน ส่วนที่เหลือนำไปชำระเงินต้น ผู้กู้มีสิทธิชำระคืนก่อนกำหนดได้ โดยคิดดอกเบี้ยถึงวันที่ชำระจริง</p>
      <p className="indent-10"><b>ข้อ 5 การผิดนัด</b> หากผู้กู้ผิดนัดชำระงวดใดงวดหนึ่ง และไม่ชำระภายใน 30 วันนับแต่วันที่ได้รับหนังสือบอกกล่าวจากผู้ให้กู้
        ให้ถือว่าผู้กู้ผิดนัดชำระหนี้ทั้งหมด ผู้ให้กู้มีสิทธิเรียกให้ผู้กู้ชำระหนี้ที่ค้างทั้งหมดได้ทันที พร้อมดอกเบี้ยผิดนัดตามที่กฎหมายกำหนด</p>
      {g && (
        <p className="indent-10"><b>ข้อ 6 การค้ำประกัน</b> {g.name} เลขประจำตัวประชาชน {g.id ? fmtId(g.id) : blank("9rem")} ที่อยู่ {addr(g.address)}
          {g.phone ? ` โทร ${g.phone}` : ""} ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้ค้ำประกัน&rdquo;</b> ตกลงค้ำประกันการชำระหนี้ของผู้กู้ตามสัญญานี้
          หากผู้กู้ผิดนัดชำระหนี้ ผู้ค้ำประกันยินยอมรับผิดชำระหนี้แทนผู้กู้ ทั้งนี้ภายในขอบเขตที่กฎหมายกำหนด</p>
      )}
      <p className="indent-10"><b>ข้อ {g ? 7 : 6}</b> สัญญานี้ทำขึ้นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว
        จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน และต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ</p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        <Sign role="ผู้กู้" name={d.borrower} />
        {(d.lenders.length ? d.lenders : [undefined]).map((n, i) => <Sign key={i} role="ผู้ให้กู้" name={n} />)}
        {g && <Sign role="ผู้ค้ำประกัน" name={g.name} />}
        <Sign role="พยาน" name={d.witnesses?.[0] ?? undefined} />
        <Sign role="พยาน" name={d.witnesses?.[1] ?? undefined} />
      </div>
      {d.currency === "THB" && (
        <p className="mt-5 text-[11px] text-slate-500">ติดอากรแสตมป์ {money(stampDuty(d.principal), undefined, 0)} บาท (1 บาท ต่อทุก 2,000 บาท หรือเศษ · สูงสุด 10,000 บาท)</p>
      )}
    </article>
  );
}

/** เอกสารแนบท้าย: ตารางผ่อนชำระ (ทั้งแผน ไม่มีสถานะการรับ)
 *  left = เงินต้นคงเหลือหลังแต่ละงวด (ไม่ส่ง = เงินต้นรวมตามตาราง − เงินต้นสะสม) · caption / sub = บรรทัดใต้หัวเรื่อง (ใช้กับตารางแนบท้ายบันทึกให้กู้เพิ่ม) */
export function ScheduleAnnex({ d, left: leftIn, caption, sub, note }: { d: ContractData; left?: number[]; caption?: string; sub?: string; note?: string }) {
  const sum = (k: "principal" | "interest") => d.lines.reduce((s, x) => s + x[k], 0);
  // เงินต้นคงเหลือหลังแต่ละงวด = เงินต้นรวมตามตาราง − เงินต้นสะสมถึงงวดนั้น
  const left = leftIn ?? d.lines.map((_, i) => Math.max(Math.round((sum("principal") - d.lines.slice(0, i + 1).reduce((s, x) => s + x.principal, 0)) * 100) / 100, 0));
  return (
    <article className="text-[12px]">
      <h2 className="text-center text-base font-semibold">ตารางผ่อนชำระ</h2>
      <p className="text-center">{caption ?? `แนบท้ายสัญญากู้ยืมเงิน${d.contractNo ? ` เลขที่ ${d.contractNo}` : ""}${d.loanDate ? ` ลงวันที่ ${thDateLong(d.loanDate)}` : ""}`}</p>
      <p className="text-center">{sub ?? `ผู้กู้ ${d.borrower} · เงินต้น ${plain(d.principal, d.currency)}${d.ratePct ? ` · ดอกเบี้ยร้อยละ ${d.ratePct} ต่อปี` : ""}`}</p>
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
      {note && <p className="mt-2 text-[11px] text-slate-600">{note}</p>}
      <div className="mt-8 grid grid-cols-2 gap-6 break-inside-avoid">
        <Sign role="ผู้กู้" name={d.borrower} />
        <Sign role="ผู้ให้กู้" name={d.lenders.join(" และ ") || undefined} />
      </div>
    </article>
  );
}

/** ข้อมูลการให้กู้เพิ่ม 1 ครั้ง (จากรายการจ่ายเงินกู้หลังเริ่มสัญญา) */
export type LendData = {
  /** ครั้งที่ (นับจากการให้กู้เพิ่มครั้งแรก) */
  no: number; date: string; amount: number;
  /** เงินต้นค้างชำระทั้งหมด ณ วันทำบันทึก (หลังรวมยอดที่ให้กู้เพิ่มครั้งนี้) */
  balance: number;
  /** งวดผ่อนที่ครบกำหนดหลังวันให้กู้เพิ่ม (ตารางแนบท้ายบันทึก) */
  lines: ContractData["lines"];
};

/**
 * บันทึกข้อตกลงต่อท้ายสัญญากู้ยืมเงิน (ให้กู้เพิ่ม) — ร่างจากแบบมาตรฐาน · 1 หน้า A4 (ตกลง 3 พ.ย. 2026)
 * อ้างสัญญาเดิม · จำนวนที่กู้เพิ่ม · เงินต้นค้างรวม · ผ่อนตามตารางใหม่ · ผู้ค้ำยินยอม · ข้ออื่นตามสัญญาเดิม · อากรคิดจากยอดที่กู้เพิ่ม
 * ไม่ใช่คำปรึกษากฎหมาย: ให้ทนายตรวจข้อความก่อนใช้จริง
 */
export function LendAddendum({ d, a }: { d: ContractData; a: LendData }) {
  const rate = d.ratePct ?? 0;
  const g = d.guarantor;
  const addr = (v: string | null | undefined, w = "16rem") => (v ? v.replace(/\s*\n\s*/g, " ") : blank(w));
  const la = d.lenderAddresses ?? [];
  const sameAddr = la.length > 0 && la.every((x) => x && x === la[0]);
  const ref = <>สัญญากู้ยืมเงิน เลขที่ {d.contractNo || blank("7rem")} ลงวันที่ {d.loanDate ? thDateLong(d.loanDate) : blank("10rem")}</>;
  // เลขข้อ: 1–4 คงที่ · มีผู้ค้ำ = ข้อ 5 · ถัดไปเลื่อนตาม
  const k = g ? 6 : 5;
  return (
    <article className="contract text-[13px] leading-[1.75]">
      <h1 className="text-center text-lg font-semibold">บันทึกข้อตกลงต่อท้ายสัญญากู้ยืมเงิน</h1>
      <p className="text-center font-medium">(ให้กู้เพิ่ม ครั้งที่ {a.no})</p>
      <div className="mt-2 flex flex-wrap justify-end gap-x-6">
        <span>แนบท้ายสัญญาเลขที่ {d.contractNo || blank("7rem")}</span>
        <span>ทำที่ {d.place ? d.place.replace(/\s*\n\s*/g, " ") : blank("12rem")}</span>
      </div>
      <div className="text-right">วันที่ {thDateLong(a.date)}</div>
      <p className="mt-2 indent-10">
        บันทึกนี้ทำขึ้นระหว่าง <b>{d.borrower}</b> {d.borrowerIdLabel ?? "เลขประจำตัวประชาชน"} {d.borrowerId ? fmtId(d.borrowerId) : blank("9rem")} ที่อยู่ {addr(d.borrowerAddress)}
        {d.borrowerPhone ? ` โทร ${d.borrowerPhone}` : ""} ซึ่งต่อไปเรียกว่า <b>&ldquo;ผู้กู้&rdquo;</b> ฝ่ายหนึ่ง
        กับ {d.lenders.length === 0 ? <>{blank("12rem")} ที่อยู่ {blank("16rem")}</>
          : sameAddr || d.lenders.length === 1 ? <><b>{d.lenders.join(" และ ")}</b> ที่อยู่ {addr(la[0])}</>
          : d.lenders.map((x, i) => <span key={i}>{i > 0 && " และ "}<b>{x}</b> ที่อยู่ {addr(la[i], "12rem")}</span>)}
        {" "}ซึ่งต่อไปเรียกว่า <b>&ldquo;ผู้ให้กู้&rdquo;</b> อีกฝ่ายหนึ่ง
        ซึ่งเป็นคู่สัญญาตาม{ref} (ต่อไปเรียกว่า <b>&ldquo;สัญญาเดิม&rdquo;</b>) ทั้งสองฝ่ายตกลงทำบันทึกต่อท้ายสัญญาเดิม ดังต่อไปนี้
      </p>
      <p className="indent-10"><b>ข้อ 1 จำนวนเงินกู้เพิ่ม</b> ผู้กู้ได้กู้ยืมเงินจากผู้ให้กู้เพิ่มเติมเป็นจำนวน {amountOf(a.amount, d.currency)}{" "}
        และผู้กู้ได้รับเงินจำนวนดังกล่าวไปครบถ้วนแล้วในวันทำบันทึกนี้</p>
      <p className="indent-10"><b>ข้อ 2 เงินต้นค้างชำระรวม</b> ผู้กู้ยอมรับว่า ณ วันทำบันทึกนี้ ผู้กู้มีเงินต้นค้างชำระตามสัญญาเดิมรวมกับเงินกู้เพิ่มตามข้อ 1
        เป็นจำนวนทั้งสิ้น {amountOf(a.balance, d.currency)}</p>
      <p className="indent-10"><b>ข้อ 3 ดอกเบี้ย</b> {rate > 0
        ? `ผู้กู้ตกลงชำระดอกเบี้ยของเงินต้นค้างชำระตามข้อ 2 ในอัตราร้อยละ ${rate} ต่อปี นับแต่วันทำบันทึกนี้เป็นต้นไป`
        : "ผู้ให้กู้ไม่คิดดอกเบี้ยจากเงินกู้ตามบันทึกนี้"}</p>
      <p className="indent-10"><b>ข้อ 4 การชำระคืน</b> {repaymentText({ ...d, lines: a.lines }, "addendum")}</p>
      {g && (
        <p className="indent-10"><b>ข้อ 5 การค้ำประกัน</b> {g.name} ผู้ค้ำประกันตามสัญญาเดิม ได้ทราบข้อความในบันทึกนี้แล้ว
          และยินยอมค้ำประกันการชำระหนี้ของผู้กู้ตามสัญญาเดิมรวมทั้งเงินกู้เพิ่มตามบันทึกนี้ ทั้งนี้ภายในขอบเขตที่กฎหมายกำหนด</p>
      )}
      <p className="indent-10"><b>ข้อ {k}</b> ข้อความอื่นในสัญญาเดิมที่ไม่ได้แก้ไขโดยบันทึกนี้ ให้คงมีผลใช้บังคับต่อไปทุกประการ และให้ถือว่าบันทึกนี้เป็นส่วนหนึ่งของสัญญาเดิม</p>
      <p className="indent-10"><b>ข้อ {k + 1}</b> บันทึกนี้ทำขึ้นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว
        จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน และต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ</p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        <Sign role="ผู้กู้" name={d.borrower} />
        {(d.lenders.length ? d.lenders : [undefined]).map((x, i) => <Sign key={i} role="ผู้ให้กู้" name={x} />)}
        {g && <Sign role="ผู้ค้ำประกัน" name={g.name} />}
        <Sign role="พยาน" name={d.witnesses?.[0] ?? undefined} />
        <Sign role="พยาน" name={d.witnesses?.[1] ?? undefined} />
      </div>
      {d.currency === "THB" && (
        <p className="mt-5 text-[11px] text-slate-500">ติดอากรแสตมป์ {money(stampDuty(a.amount), undefined, 0)} บาท (คิดจากยอดที่ให้กู้เพิ่ม · 1 บาท ต่อทุก 2,000 บาท หรือเศษ · สูงสุด 10,000 บาท)</p>
      )}
    </article>
  );
}
