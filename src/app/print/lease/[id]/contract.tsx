import { bahtText, INVENTORY_METER_TYPES, INVENTORY_TYPE_LABEL, landText, money, thDate, thDateLong, UTILITIES_BILLING_LABEL } from "@/lib/format";
import { termMonths, termText } from "@/lib/lease";

export { termMonths };

/**
 * สัญญาเช่า (ร่างจากแบบมาตรฐานทั่วไป · ตกลง 2 พ.ย. 2026) — แยกแบบตามประเภททรัพย์สิน
 *   HOUSE = สัญญาเช่าบ้าน · CONDO = สัญญาเช่าห้องชุด · LAND = สัญญาเช่าที่ดิน · OTHER = สัญญาเช่าอาคาร / สถานที่ (เพื่อการค้า)
 *   ข้อความทั้งหมดแก้ที่ไฟล์นี้ไฟล์เดียว · ไม่ใช่คำปรึกษากฎหมาย: ให้ทนายตรวจข้อความก่อนใช้จริง
 *   ข้อมูลที่ระบบไม่มี (เลขบัตร / ที่อยู่ผู้เช่า ฯลฯ) เว้นเส้นให้เขียนเอง
 */
export type LeaseDeed = { titleType: string | null; deedNo: string | null; landNo: string | null; book: string | null; page: string | null; areaSqWa: number | null };
export type LeaseData = {
  propertyType: "HOUSE" | "CONDO" | "LAND" | "OTHER"; propertyName: string; address: string | null; unit: string | null;
  /** จากข้อมูลทรัพย์สิน: บ้านเลขที่ · ห้องชุดเลขที่ / ชั้น / ชื่ออาคาร */
  houseNo: string | null; unitNo: string | null; floorNo: string | null; buildingName: string | null;
  deeds: LeaseDeed[]; buildingSqm: number | null; landSqWa: number | null;
  contractNo: string | null; startDate: string; endDate: string; currency: string;
  tenant: string; lessors: { name: string; address: string | null }[];
  /** ผู้เช่า: บุคคล / นิติบุคคล · เลขบัตร / ทะเบียน (เลขเต็มเฉพาะ ADMIN / EDITOR) · ที่อยู่ · โทร · ผู้มีอำนาจลงนาม */
  tenantJuristic: boolean; tenantId: string | null; tenantAddress: string | null; tenantPhone: string | null; signatory: string | null;
  noticeDays: number | null; lateFee: number | null; witnesses: [string | null, string | null];
  /** รายการส่งมอบของสัญญา (ว่าง = ตารางเปล่าให้เขียนเอง) */
  handover: { type: string; name: string; qty: number; brand: string | null; serial: string | null; condition: string | null; reading: number | null }[];
  rent: number; frequency: string; dueDay: number | null; /** คิดค่าเช่าวันเศษ ACTUAL / DAYS30 */ prorate: string;
  deposit: number | null; utilities: string | null;
  bank: { name: string; accountName: string | null; accountNo: string | null } | null;
  /** งวดค่าเช่าตลอดสัญญา จาก lease_rent_schedule (ไม่มี = ความถี่ "อื่น ๆ") */ lines: { no: number; due: string; from: string; to: string; amount: number }[];
};

export const TITLE: Record<LeaseData["propertyType"], string> = {
  HOUSE: "สัญญาเช่าบ้าน", CONDO: "สัญญาเช่าห้องชุด", LAND: "สัญญาเช่าที่ดิน", OTHER: "สัญญาเช่าอาคาร / สถานที่",
};
const PERIOD_WORD: Record<string, string> = { MONTHLY: "เดือนละ", QUARTERLY: "ทุก 3 เดือน งวดละ", YEARLY: "ปีละ" };
const blank = (w = "10rem") => <span className="inline-block border-b border-dotted border-slate-500 align-bottom" style={{ width: w }} />;
const amountOf = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท (${bahtText(v)})` : `${money(v)} ${ccy}`);
const plain = (v: number, ccy: string) => (ccy === "THB" ? `${money(v)} บาท` : `${money(v)} ${ccy}`);
const oneLine = (v: string) => v.replace(/\s*\n\s*/g, " ");

/** อากรแสตมป์สัญญาเช่าอสังหาริมทรัพย์: 1 บาท ต่อค่าเช่าทุก 1,000 บาท หรือเศษ ตลอดอายุสัญญา */
export const leaseStampDuty = (totalRent: number) => Math.ceil(totalRent / 1000);

/**
 * ข้อความกำหนดชำระ (ตกลง 6 พ.ย. 2026): รอบนับจากวันจ่าย · งวดแรกชำระภายใน 5 วันนับแต่วันเริ่มสัญญา
 *   งวดแรกไม่เต็มรอบ (เข้าอยู่ไม่ตรงวันจ่าย) → ระบุช่วงวันและยอด · สิ้นสุด / เลิกสัญญากลางรอบ → คิดตามวัน + คืนส่วนที่ชำระล่วงหน้าเกิน
 */
function rentTerms(d: LeaseData) {
  const day = d.dueDay ?? Number(d.startDate.slice(8, 10));
  const f = d.lines[0];
  const partFirst = f && Math.abs(f.amount - d.rent) >= 0.005;
  const div = d.prorate === "DAYS30" ? "30" : "จำนวนวันจริงของรอบนั้น";
  return ` ชำระล่วงหน้าทุกวันที่ ${day} ของ${d.frequency === "YEARLY" ? "เดือนที่ครบรอบปีการเช่า" : "เดือนที่ครบกำหนดแต่ละงวด"}`
    + (partFirst ? ` เว้นแต่งวดแรกตั้งแต่วันที่ ${thDateLong(f.from)} ถึงวันที่ ${thDateLong(f.to)} คิดตามจำนวนวันเป็นเงิน ${plain(f.amount, d.currency)}` : "")
    + ` โดยงวดแรกชำระภายใน 5 วันนับแต่วันเริ่มสัญญา ตามตารางค่าเช่าแนบท้ายสัญญา`
    + ` หากสัญญาสิ้นสุดหรือเลิกกันระหว่างรอบ ค่าเช่ารอบนั้นคิดตามจำนวนวันที่เช่าจริง (ค่าเช่าต่องวด ÷ ${div} × จำนวนวัน)`
    + ` และผู้ให้เช่าจะคืนค่าเช่าที่ผู้เช่าชำระล่วงหน้าเกินให้`;
}

/** ชื่อใต้ลายเซ็นผู้เช่า: นิติบุคคล = ชื่อบริษัท โดย ผู้มีอำนาจลงนาม */
const tenantSign = (d: LeaseData) => (d.tenantJuristic && d.signatory ? `${d.tenant} โดย ${d.signatory}` : d.tenant);

function Sign({ role, name }: { role: string; name?: string }) {
  return (
    <div className="text-center">
      <div>ลงชื่อ {blank("11rem")} {role}</div>
      <div className="mt-1">( {name ? <span className="inline-block min-w-[11rem]">{name}</span> : blank("11rem")} )</div>
    </div>
  );
}

/** ข้อ 1 ทรัพย์สินที่เช่า: ตามประเภท */
function premisesText(d: LeaseData) {
  const addr = d.address ? oneLine(d.address) : null;
  const deedTxt = d.deeds.length
    ? d.deeds.map((x) => [`${x.titleType || "โฉนดที่ดิน"} เลขที่ ${x.deedNo || "……"}`, x.landNo && `เลขที่ดิน ${x.landNo}`,
        x.book && `เล่ม ${x.book}`, x.page && `หน้า ${x.page}`, x.areaSqWa != null && `เนื้อที่ ${landText(x.areaSqWa).replace(/ \(.*\)$/, "")}`]
        .filter(Boolean).join(" ")).join(" และ ")
    : null;
  switch (d.propertyType) {
    case "CONDO":
      return <>ห้องชุดเลขที่ {d.unitNo ?? (d.unit ? d.unit.replace(/^ห้อง(ชุด)?\s*(เลขที่)?\s*/, "") : blank("5rem"))}{d.floorNo ? ` ชั้น ${d.floorNo}` : ""} ในอาคารชุด {d.buildingName ?? d.propertyName} ตั้งอยู่ที่ {addr ?? blank("16rem")}
        {d.deeds[0]?.deedNo ? ` หนังสือกรรมสิทธิ์ห้องชุดเลขที่ ${d.deeds[0].deedNo}` : ""} เนื้อที่ห้องชุด {d.buildingSqm != null ? `${d.buildingSqm.toLocaleString("th-TH")} ตารางเมตร` : <>{blank("4rem")} ตารางเมตร</>}
        {" "}พร้อมเฟอร์นิเจอร์และอุปกรณ์ตามบัญชีแนบท้ายสัญญา</>;
    case "LAND":
      return <>ที่ดิน {deedTxt ?? <>โฉนดที่ดินเลขที่ {blank("6rem")}</>} ตั้งอยู่ที่ {addr ?? blank("16rem")}
        {d.landSqWa != null && d.deeds.length !== 1 ? ` รวมเนื้อที่ ${landText(d.landSqWa)}` : ""}{d.unit ? ` (ส่วนที่เช่า: ${d.unit})` : ""}</>;
    case "HOUSE":
      return <>บ้านเลขที่ {d.houseNo ?? blank("5rem")} ({d.propertyName}){d.unit ? ` ส่วนที่เช่า: ${d.unit}` : ""} ตั้งอยู่ที่ {addr ?? blank("16rem")}{deedTxt ? ` ปลูกสร้างบนที่ดิน ${deedTxt}` : ""}
        {" "}พร้อมอุปกรณ์ตามบัญชีแนบท้ายสัญญา</>;
    default:
      return <>อาคาร / สถานที่ {d.propertyName}{d.houseNo ? ` เลขที่ ${d.houseNo}` : ""}{d.unit ? ` (${d.unit})` : ""} ตั้งอยู่ที่ {addr ?? blank("16rem")}{deedTxt ? ` บนที่ดิน ${deedTxt}` : ""}
        {d.buildingSqm != null ? ` พื้นที่ประมาณ ${d.buildingSqm.toLocaleString("th-TH")} ตารางเมตร` : ""}</>;
  }
}

const PURPOSE: Record<LeaseData["propertyType"], React.ReactNode> = {
  HOUSE: "เพื่อใช้เป็นที่อยู่อาศัยเท่านั้น",
  CONDO: "เพื่อใช้เป็นที่อยู่อาศัยเท่านั้น",
  LAND: <>เพื่อ {blank("14rem")} เท่านั้น</>,
  OTHER: <>เพื่อประกอบกิจการ {blank("14rem")} เท่านั้น</>,
};

/** ข้อการใช้และดูแลทรัพย์สิน (แยกตามประเภท) */
function careClauses(t: LeaseData["propertyType"]): string[] {
  const common = [
    "ผู้เช่าจะไม่นำทรัพย์สินที่เช่าไปให้ผู้อื่นเช่าช่วง หรือโอนสิทธิการเช่า ไม่ว่าทั้งหมดหรือบางส่วน เว้นแต่ได้รับความยินยอมเป็นหนังสือจากผู้ให้เช่า",
    "ผู้เช่าจะไม่ใช้ทรัพย์สินที่เช่าทำการใด ๆ ที่ผิดกฎหมาย ผิดศีลธรรม หรือเป็นที่เดือดร้อนรำคาญแก่ผู้อื่น และจะไม่นำวัตถุไวไฟ วัตถุระเบิด หรือสิ่งผิดกฎหมายเข้ามาเก็บไว้",
  ];
  if (t === "LAND") return [
    ...common,
    "ผู้เช่าจะไม่ปลูกสร้างอาคารหรือสิ่งปลูกสร้างใด ๆ ลงบนที่ดินที่เช่า เว้นแต่ได้รับความยินยอมเป็นหนังสือจากผู้ให้เช่า และจะไม่ขุดดิน ถมดิน หรือนำหน้าดินออกไปจากที่ดิน",
    "เมื่อสัญญาสิ้นสุดลงไม่ว่ากรณีใด ผู้เช่าจะรื้อถอนสิ่งปลูกสร้างและทรัพย์สินของผู้เช่าออก และปรับที่ดินคืนสู่สภาพเดิมด้วยค่าใช้จ่ายของผู้เช่าภายใน 30 วัน หากไม่รื้อถอนภายในกำหนด ให้สิ่งปลูกสร้างนั้นตกเป็นกรรมสิทธิ์ของผู้ให้เช่าโดยไม่ต้องชดใช้ราคา",
    "ภาษีที่ดินและสิ่งปลูกสร้างของที่ดินที่เช่า ผู้ให้เช่าเป็นผู้ชำระ ส่วนภาษีหรือค่าธรรมเนียมที่เกิดจากกิจการหรือสิ่งปลูกสร้างของผู้เช่า ผู้เช่าเป็นผู้ชำระ",
  ];
  const keep = [
    "ผู้เช่าจะดูแลรักษาทรัพย์สินที่เช่าเสมือนวิญญูชนจะพึงสงวนทรัพย์สินของตนเอง และซ่อมแซมความเสียหายเล็กน้อยที่เกิดจากการใช้งานตามปกติด้วยค่าใช้จ่ายของผู้เช่า ส่วนการซ่อมแซมใหญ่ที่เกี่ยวกับโครงสร้าง ผู้ให้เช่าเป็นผู้รับผิดชอบ",
    "ผู้เช่าจะไม่ดัดแปลง ต่อเติม หรือรื้อถอนส่วนใด ๆ ของทรัพย์สินที่เช่า เว้นแต่ได้รับความยินยอมเป็นหนังสือจากผู้ให้เช่า สิ่งที่ต่อเติมให้ตกเป็นกรรมสิทธิ์ของผู้ให้เช่า เว้นแต่ตกลงกันไว้เป็นอย่างอื่น",
  ];
  if (t === "CONDO") return [...common, ...keep,
    "ผู้เช่าจะปฏิบัติตามข้อบังคับและระเบียบของนิติบุคคลอาคารชุดโดยเคร่งครัด หากผู้เช่าฝ่าฝืนจนผู้ให้เช่าต้องรับผิดหรือเสียค่าปรับ ผู้เช่าจะชดใช้ให้ผู้ให้เช่าทั้งหมด"];
  if (t === "OTHER") return [...common, ...keep,
    "ผู้เช่าเป็นผู้ขอใบอนุญาตที่จำเป็นต่อการประกอบกิจการเอง และรับผิดชอบค่าภาษีป้าย ค่าธรรมเนียม และความเสียหายที่เกิดจากการประกอบกิจการของผู้เช่า การติดตั้งป้ายต้องได้รับความยินยอมจากผู้ให้เช่า",
    "ผู้เช่าเป็นผู้รับผิดชอบเอาประกันภัยทรัพย์สินและสินค้าของผู้เช่าเอง ผู้ให้เช่าไม่ต้องรับผิดในความสูญหายหรือเสียหายของทรัพย์สินของผู้เช่า"];
  return [...common, ...keep];
}

function utilitiesText(d: LeaseData) {
  if (d.propertyType === "LAND") return null;
  const base = d.utilities === "INCLUDED" ? "ค่าไฟฟ้าและค่าน้ำประปารวมอยู่ในค่าเช่าแล้ว"
    : d.utilities === "REBILL" ? "ค่าไฟฟ้าและค่าน้ำประปา ผู้ให้เช่าเป็นผู้ชำระให้ผู้ให้บริการก่อน และเรียกเก็บจากผู้เช่าตามจำนวนที่ใช้จริง ผู้เช่าตกลงชำระคืนภายใน 7 วันนับแต่ได้รับแจ้ง"
    : "ค่าไฟฟ้า ค่าน้ำประปา ค่าโทรศัพท์ ค่าอินเทอร์เน็ต และค่าบริการอื่น ๆ ที่ผู้เช่าใช้ ผู้เช่าเป็นผู้ชำระตามใบแจ้งหนี้ของผู้ให้บริการ";
  return d.propertyType === "CONDO" ? `${base} ส่วนค่าส่วนกลางของห้องชุด ผู้ให้เช่าเป็นผู้ชำระ` : base;
}

export function LeaseContract({ d, place, signDate }: { d: LeaseData; place: string | null; signDate: string }) {
  const months = termMonths(d.startDate, d.endDate);
  const lessors = d.lessors;
  const la = lessors.map((x) => x.address);
  const sameAddr = la.length > 0 && la.every((x) => x && x === la[0]);
  const addr = (v: string | null | undefined, w = "16rem") => (v ? oneLine(v) : blank(w));
  const per = PERIOD_WORD[d.frequency];
  const util = utilitiesText(d);
  const clauses: React.ReactNode[] = [
    <><b>ทรัพย์สินที่เช่า</b> ผู้ให้เช่าตกลงให้เช่าและผู้เช่าตกลงเช่า {premisesText(d)} {PURPOSE[d.propertyType]}</>,
    <><b>ระยะเวลาการเช่า</b> มีกำหนด {termText(months)} เริ่มตั้งแต่วันที่ {thDateLong(d.startDate)} ถึงวันที่ {thDateLong(d.endDate)}</>,
    <><b>ค่าเช่า</b> ผู้เช่าตกลงชำระค่าเช่า{per ? ` ${per} ${amountOf(d.rent, d.currency)}` : ` ${amountOf(d.rent, d.currency)} ตามกำหนด ${blank("8rem")}`}
      {per ? rentTerms(d) : ""}
      {" "}โดยโอนเข้าบัญชีธนาคาร {d.bank?.name || blank("8rem")}{d.bank?.accountName ? ` ชื่อบัญชี ${d.bank.accountName}` : ""} เลขที่บัญชี {d.bank?.accountNo || blank("8rem")}
      {" "}หรือตามที่ผู้ให้เช่าแจ้งเป็นหนังสือ หากผู้เช่าเป็นนิติบุคคลที่มีหน้าที่หักภาษี ณ ที่จ่าย ให้หักได้ตามกฎหมายและส่งหนังสือรับรองการหักภาษีให้ผู้ให้เช่า</>,
    d.deposit ? <><b>เงินประกัน</b> ในวันทำสัญญานี้ ผู้เช่าได้วางเงินประกันการปฏิบัติตามสัญญาไว้แก่ผู้ให้เช่าเป็นจำนวน {amountOf(d.deposit, d.currency)}
      {" "}ผู้ให้เช่าจะคืนเงินประกันให้ผู้เช่าโดยไม่มีดอกเบี้ย ภายใน 30 วันนับแต่วันที่สัญญาสิ้นสุดและผู้เช่าส่งมอบทรัพย์สินที่เช่าคืนครบถ้วนแล้ว
      {" "}หลังหักค่าเช่า ค่าใช้จ่ายที่ค้างชำระ และค่าเสียหายที่ผู้เช่าต้องรับผิด (ถ้ามี) เงินประกันนี้ไม่ใช่ค่าเช่าล่วงหน้า</> : null,
    util ? <><b>ค่าสาธารณูปโภค</b> {util}</> : null,
    ...careClauses(d.propertyType).map((t, i) => (i === 0 ? <><b>การใช้ทรัพย์สินที่เช่า</b> {t}</> : <>{t}</>)),
    <><b>การตรวจทรัพย์สิน</b> ผู้ให้เช่าหรือตัวแทนมีสิทธิเข้าตรวจดูทรัพย์สินที่เช่าในเวลาอันสมควร โดยแจ้งให้ผู้เช่าทราบล่วงหน้า</>,
    <><b>การผิดสัญญา</b> หากผู้เช่าค้างชำระค่าเช่างวดใดเกิน 15 วัน หรือผิดสัญญาข้อใดข้อหนึ่ง และไม่แก้ไขภายใน 15 วันนับแต่ได้รับหนังสือแจ้งจากผู้ให้เช่า
      {" "}ผู้ให้เช่ามีสิทธิบอกเลิกสัญญาได้ทันที และมีสิทธิหักเงินประกันชดใช้ค่าเช่าและค่าเสียหาย โดยไม่ตัดสิทธิเรียกค่าเสียหายส่วนที่เกิน</>,
    <><b>การเลิกสัญญาก่อนกำหนด</b> หากผู้เช่าประสงค์จะเลิกสัญญาก่อนครบกำหนด ต้องแจ้งเป็นหนังสือล่วงหน้าไม่น้อยกว่า {d.noticeDays ?? blank("3rem")} วัน
      {d.deposit ? " และยินยอมให้ผู้ให้เช่าริบเงินประกันทั้งหมด เว้นแต่ผู้ให้เช่าตกลงเป็นอย่างอื่น" : ""}</>,
    <><b>การส่งมอบคืน</b> เมื่อสัญญาสิ้นสุดลง ผู้เช่าจะส่งมอบทรัพย์สินที่เช่าคืนในสภาพเรียบร้อยเช่นเดียวกับวันที่รับมอบ ยกเว้นความเสื่อมสภาพจากการใช้งานตามปกติ
      {" "}หากส่งมอบล่าช้า ผู้เช่ายินยอมชดใช้ค่าเสียหายในอัตราวันละ {d.lateFee != null ? plain(d.lateFee, d.currency) : <>{blank("5rem")} บาท</>} จนกว่าจะส่งมอบเสร็จ</>,
    months > 36 ? <><b>การจดทะเบียน</b> เนื่องจากการเช่านี้มีกำหนดเกินกว่า 3 ปี คู่สัญญาตกลงไปจดทะเบียนการเช่าต่อพนักงานเจ้าหน้าที่
      {" "}(ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 538) ภายใน {blank("3rem")} วัน โดยค่าธรรมเนียมการจดทะเบียน {blank("8rem")} เป็นผู้ชำระ</> : null,
    <>สัญญานี้ทำขึ้นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน และต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ</>,
  ].filter(Boolean);
  const total = d.lines.reduce((t, x) => t + x.amount, 0);
  return (
    <article className="contract text-[12.5px] leading-[1.7]">
      <h1 className="text-center text-lg font-semibold">{TITLE[d.propertyType]}</h1>
      <div className="mt-2 flex flex-wrap justify-end gap-x-6">
        <span>เลขที่สัญญา {d.contractNo || blank("7rem")}</span>
        <span>ทำที่ {place ? oneLine(place) : blank("12rem")}</span>
      </div>
      <div className="text-right">วันที่ {thDateLong(signDate)}</div>
      <p className="mt-2 indent-10">
        สัญญานี้ทำขึ้นระหว่าง {lessors.length === 0 ? <>{blank("12rem")} ที่อยู่ {blank("16rem")}</>
          : sameAddr || lessors.length === 1 ? <><b>{lessors.map((x) => x.name).join(" และ ")}</b> ที่อยู่ {addr(la[0])}</>
          : lessors.map((x, i) => <span key={i}>{i > 0 && " และ "}<b>{x.name}</b> ที่อยู่ {addr(x.address, "12rem")}</span>)}
        {" "}ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้ให้เช่า&rdquo;</b> ฝ่ายหนึ่ง กับ <b>{d.tenant}</b>
        {d.tenantJuristic
          ? <> เลขทะเบียนนิติบุคคล {d.tenantId ?? blank("9rem")} สำนักงานตั้งอยู่ที่ {addr(d.tenantAddress)} โดย {d.signatory ?? blank("10rem")} กรรมการผู้มีอำนาจลงนาม</>
          : <> เลขประจำตัวประชาชน {d.tenantId ?? blank("9rem")} ที่อยู่ {addr(d.tenantAddress)}</>}
        {" "}โทร {d.tenantPhone ?? blank("6rem")} ซึ่งต่อไปในสัญญานี้เรียกว่า <b>&ldquo;ผู้เช่า&rdquo;</b> อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงกันดังต่อไปนี้
      </p>
      {clauses.map((c, i) => <p key={i} className="indent-10"><b>ข้อ {i + 1}</b> {c}</p>)}
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 break-inside-avoid">
        {(lessors.length ? lessors.map((x) => x.name) : [undefined]).map((n, i) => <Sign key={i} role="ผู้ให้เช่า" name={n} />)}
        <Sign role="ผู้เช่า" name={tenantSign(d)} />
        <Sign role="พยาน" name={d.witnesses[0] ?? undefined} />
        <Sign role="พยาน" name={d.witnesses[1] ?? undefined} />
      </div>
      {d.currency === "THB" && total > 0 && (
        <p className="mt-5 text-[11px] text-slate-500">ติดอากรแสตมป์ {leaseStampDuty(total).toLocaleString("en-US")} บาท
          (ค่าเช่าตลอดสัญญา {plain(total, d.currency)} · 1 บาท ต่อค่าเช่าทุก 1,000 บาท หรือเศษ)</p>
      )}
    </article>
  );
}

/** เอกสารแนบท้าย 1: ตารางค่าเช่ารายงวดตลอดสัญญา */
export function RentAnnex({ d }: { d: LeaseData }) {
  const total = d.lines.reduce((t, x) => t + x.amount, 0);
  return (
    <article className="text-[12px]">
      <h2 className="text-center text-base font-semibold">ตารางค่าเช่า</h2>
      <p className="text-center">แนบท้าย{TITLE[d.propertyType]}{d.contractNo ? ` เลขที่ ${d.contractNo}` : ""} · {d.propertyName}{d.unit ? ` (${d.unit})` : ""} · ผู้เช่า {d.tenant}</p>
      <table className="mt-3 w-full border-collapse">
        <thead><tr className="border-y border-slate-400 text-left"><th className="py-1">งวดที่</th><th>รอบค่าเช่า</th><th>ครบกำหนดชำระ</th><th className="text-right">ค่าเช่า</th><th className="w-40 pl-6">วันที่ชำระ / ลงชื่อผู้รับ</th></tr></thead>
        <tbody>
          {d.lines.map((x) => (
            <tr key={x.no} className="break-inside-avoid border-b border-slate-200">
              <td className="py-0.5">{x.no}</td><td>{thDate(x.from)} – {thDate(x.to)}</td><td>{thDateLong(x.due)}</td><td className="text-right tabular-nums">{money(x.amount)}</td><td />
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-y border-slate-400 font-semibold">
          <td className="py-1" colSpan={3}>รวม {d.lines.length} งวด</td><td className="text-right tabular-nums">{plain(total, d.currency)}</td><td /></tr></tfoot>
      </table>
      <div className="mt-8 grid grid-cols-2 gap-6 break-inside-avoid">
        <Sign role="ผู้ให้เช่า" name={d.lessors.map((x) => x.name).join(" และ ") || undefined} />
        <Sign role="ผู้เช่า" name={tenantSign(d)} />
      </div>
    </article>
  );
}

/** เอกสารแนบท้าย 2: บัญชีทรัพย์สินและสภาพ ณ วันส่งมอบ (ช่องว่างให้กรอกตอนส่งมอบ) */
export function HandoverAnnex({ d }: { d: LeaseData }) {
  const land = d.propertyType === "LAND";
  const meters = d.handover.filter((x) => INVENTORY_METER_TYPES.includes(x.type));
  const items = d.handover.filter((x) => !INVENTORY_METER_TYPES.includes(x.type));
  const rows = Math.max((land ? 8 : 14) - items.length, 4);
  const reading = (v: number | null) => (v != null ? Number(v).toLocaleString("th-TH") : blank("6rem"));
  return (
    <article className="text-[12px]">
      <h2 className="text-center text-base font-semibold">{land ? "บันทึกสภาพที่ดิน ณ วันส่งมอบ" : "บัญชีทรัพย์สินและสภาพ ณ วันส่งมอบ"}</h2>
      <p className="text-center">แนบท้าย{TITLE[d.propertyType]}{d.contractNo ? ` เลขที่ ${d.contractNo}` : ""} · {d.propertyName}{d.unit ? ` (${d.unit})` : ""} · วันที่ส่งมอบ {blank("8rem")}</p>
      {!land && (meters.length ? (
        <div className="mt-3 space-y-0.5">
          {meters.map((m, i) => <p key={i}>{m.name}{m.serial ? ` (เลขที่ ${m.serial})` : ""} · เลขมิเตอร์วันส่งมอบ {reading(m.reading)} หน่วย</p>)}
          {UTILITIES_BILLING_LABEL[d.utilities ?? ""] && <p>ค่าน้ำไฟ: {UTILITIES_BILLING_LABEL[d.utilities!]}</p>}
        </div>
      ) : (
        <p className="mt-3">เลขมิเตอร์ไฟฟ้า {blank("7rem")} หน่วย · เลขมิเตอร์น้ำประปา {blank("7rem")} หน่วย · กุญแจ / บัตรผ่าน {blank("4rem")} ชุด
          {UTILITIES_BILLING_LABEL[d.utilities ?? ""] ? ` · ค่าน้ำไฟ: ${UTILITIES_BILLING_LABEL[d.utilities!]}` : ""}</p>
      ))}
      {land && <p className="mt-3">หลักหมุด / แนวเขต {blank("16rem")} · สิ่งปลูกสร้างเดิมบนที่ดิน {blank("14rem")}</p>}
      <table className="mt-3 w-full border-collapse">
        <thead><tr className="border-y border-slate-400 text-left"><th className="w-10 py-1">ลำดับ</th><th>{land ? "รายการ / จุดที่ตรวจ" : "รายการ (เฟอร์นิเจอร์ / เครื่องใช้ / อุปกรณ์)"}</th>
          {!land && <th className="w-16 text-right">จำนวน</th>}<th className="w-48 pl-4">สภาพ</th><th className="w-40">หมายเหตุ</th></tr></thead>
        <tbody>
          {items.map((x, i) => (
            <tr key={`i${i}`} className="h-7 border-b border-slate-200 align-top">
              <td className="py-1">{i + 1}</td>
              <td className="py-1">{x.name}{x.brand || x.serial ? <span className="text-slate-500"> ({[x.brand, x.serial].filter(Boolean).join(" · ")})</span> : ""}
                <span className="text-slate-400"> · {INVENTORY_TYPE_LABEL[x.type] ?? ""}</span></td>
              {!land && <td className="py-1 text-right tabular-nums">{Number(x.qty).toLocaleString("th-TH")}</td>}
              <td className="py-1 pl-4">{x.condition ?? ""}</td><td />
            </tr>
          ))}
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i} className="h-7 border-b border-slate-200"><td>{items.length + i + 1}</td><td />{!land && <td />}<td /><td /></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3">คู่สัญญาได้ตรวจทรัพย์สินตามรายการข้างต้นร่วมกันแล้ว ถูกต้องตรงตามสภาพจริง</p>
      <div className="mt-8 grid grid-cols-2 gap-6 break-inside-avoid">
        <Sign role="ผู้ส่งมอบ (ผู้ให้เช่า)" name={d.lessors.map((x) => x.name).join(" และ ") || undefined} />
        <Sign role="ผู้รับมอบ (ผู้เช่า)" name={tenantSign(d)} />
      </div>
    </article>
  );
}

/** บันทึกผู้เช่าออก (lease_closeouts · ตัวเลข ณ วันบันทึก) */
export type CloseoutData = {
  moveOut: string; settled: string; deposit: number; unpaid: number; utilities: number; damage: number; damageReason: string | null;
  forfeit: number; forfeitReason: string | null; depositRefund: number; advanceRefund: number; net: number;
  rent: { period: string; from: string | null; to: string | null; expected: number; received: number; unpaid: number; over: number }[];
  charges: { description: string; amount: number }[];
};

/** ใบสรุปผู้เช่าออก / คืนเงินประกัน (ตกลง 6 พ.ย. 2026): เงินประกัน − หักค้าง / ค่าเสียหาย / ริบ + คืนค่าเช่าล่วงหน้า = ยอดคืนผู้เช่า */
export function CloseoutSummary({ d, c }: { d: LeaseData; c: CloseoutData }) {
  const early = c.moveOut < d.endDate;
  const range = (x: { from: string | null; to: string | null; period: string }) =>
    x.from && x.to ? `รอบ ${thDate(x.from)} – ${thDate(x.to)}` : `งวด ${thDate(x.period)}`;
  const cell = "py-1 align-top";
  const amt = (v: number, neg = false) => <td className={`${cell} text-right tabular-nums`}>{neg && v > 0 ? `(${money(v)})` : money(v)}</td>;
  const unpaidRows = c.rent.filter((x) => x.unpaid > 0);
  const overRows = c.rent.filter((x) => x.over > 0);
  return (
    <article className="text-[12px] leading-relaxed">
      <h2 className="text-center text-base font-semibold">บันทึกการส่งคืนทรัพย์สินที่เช่าและการคืนเงินประกัน</h2>
      <p className="text-center">ตาม{TITLE[d.propertyType]}{d.contractNo ? ` เลขที่ ${d.contractNo}` : ""} · {d.propertyName}{d.unit ? ` (${d.unit})` : ""} · ผู้เช่า {d.tenant}</p>
      <p className="mt-3 indent-8">
        ผู้เช่าได้ส่งคืนทรัพย์สินที่เช่าแก่ผู้ให้เช่าเมื่อวันที่ {thDateLong(c.moveOut)}
        {early ? ` ก่อนครบกำหนดสัญญา (สัญญาสิ้นสุดวันที่ ${thDateLong(d.endDate)}) สัญญาเช่าจึงสิ้นสุดลง ณ วันดังกล่าว` : " ตามกำหนดสิ้นสุดสัญญา"}
        {" "}ทั้งสองฝ่ายได้ตรวจสอบค่าเช่าถึงวันส่งคืน ค่าใช้จ่ายที่ค้าง และสภาพทรัพย์สินแล้ว ตกลงยอดเงินดังนี้
      </p>
      <table className="mt-3 w-full border-collapse">
        <tbody>
          <tr className="border-t border-slate-400"><td className={cell}>เงินประกันการเช่าที่ผู้ให้เช่าถืออยู่</td>{amt(c.deposit)}</tr>
          <tr><td className={cell}>หัก ค่าเช่าค้างชำระถึงวันส่งคืน
            {unpaidRows.map((x) => <div key={x.period} className="pl-4 text-slate-600">{range(x)} · ค่าเช่า {money(x.expected)} · ชำระแล้ว {money(x.received)}</div>)}
          </td>{amt(c.unpaid, true)}</tr>
          {(c.utilities > 0 || c.charges.length > 0) && (
            <tr><td className={cell}>หัก ค่าน้ำ / ค่าไฟที่เรียกเก็บ
              {c.charges.map((x, i) => <div key={i} className="pl-4 text-slate-600">{x.description} · {money(x.amount)}</div>)}
            </td>{amt(c.utilities, true)}</tr>
          )}
          <tr><td className={cell}>หัก ค่าเสียหาย{c.damageReason ? `: ${c.damageReason}` : ""}</td>{amt(c.damage, true)}</tr>
          {c.forfeit > 0 && <tr><td className={cell}>หัก ริบเงินประกัน{c.forfeitReason ? `: ${c.forfeitReason}` : ""}</td>{amt(c.forfeit, true)}</tr>}
          <tr className="border-t border-slate-300 font-medium"><td className={cell}>คงเหลือเงินประกันที่คืนผู้เช่า</td>{amt(c.depositRefund)}</tr>
          <tr><td className={cell}>บวก ค่าเช่าที่ผู้เช่าชำระล่วงหน้าเกินวันที่เช่าจริง
            {overRows.map((x) => <div key={x.period} className="pl-4 text-slate-600">{range(x)} · ชำระแล้ว {money(x.received)} · ค่าเช่าถึงวันส่งคืน {money(x.expected)}</div>)}
          </td>{amt(c.advanceRefund)}</tr>
          <tr className="border-y border-slate-400 font-semibold"><td className={cell}>รวมเงินที่ผู้ให้เช่าคืนแก่ผู้เช่า</td>{amt(c.net)}</tr>
        </tbody>
      </table>
      <p className="mt-2">เป็นเงิน {amountOf(c.net, d.currency)} ผู้ให้เช่าชำระคืนเมื่อวันที่ {thDateLong(c.settled)} โดย ☐ โอนเข้าบัญชีผู้เช่า {blank("10rem")} ☐ เงินสด</p>
      <p className="mt-2 indent-8">ผู้เช่าได้รับเงินจำนวนดังกล่าวครบถ้วนแล้ว และทั้งสองฝ่ายไม่มีข้อเรียกร้องใด ๆ ต่อกันอีกเกี่ยวกับสัญญาเช่าฉบับนี้</p>
      <div className="mt-10 grid grid-cols-2 gap-6 break-inside-avoid">
        <Sign role="ผู้ให้เช่า" name={d.lessors.map((x) => x.name).join(" และ ") || undefined} />
        <Sign role="ผู้เช่า" name={tenantSign(d)} />
      </div>
    </article>
  );
}
