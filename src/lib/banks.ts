/**
 * ธนาคาร (ชื่อมาตรฐาน) — รายชื่อในช่องเลือกตอนเพิ่ม / แก้บัญชี + แปลงชื่อที่พิมพ์ต่างกันเป็นชื่อเดียว
 * ไฟล์นี้ต้องไม่ import อะไร — ใช้ได้ทั้งฝั่ง server / client
 */
/** รายชื่อธนาคาร: ใช้ในช่องเลือกตอนเพิ่ม / แก้บัญชี · ชื่อที่บันทึก = label */
export const BANKS: { code: string; label: string; aliases: string[] }[] = [
  { code: "BBL", label: "กรุงเทพ (BBL)", aliases: ["bbl", "กรุงเทพ", "bangkokbank", "bualuang"] },
  { code: "KBANK", label: "กสิกรไทย (KBANK)", aliases: ["kbank", "kbiz", "kplus", "กสิกร", "กสิกรไทย", "kasikorn", "kasikornbank"] },
  { code: "SCB", label: "ไทยพาณิชย์ (SCB)", aliases: ["scb", "ไทยพาณิชย์", "siamcommercial", "siamcommercialbank"] },
  { code: "KTB", label: "กรุงไทย (KTB)", aliases: ["ktb", "กรุงไทย", "krungthai", "krungthaibank"] },
  { code: "BAY", label: "กรุงศรี (BAY)", aliases: ["bay", "กรุงศรี", "กรุงศรีอยุธยา", "krungsri", "bankofayudhya"] },
  { code: "TTB", label: "ทีทีบี (TTB)", aliases: ["ttb", "ทีทีบี", "ทหารไทยธนชาต", "ทหารไทย", "ธนชาต", "tmb", "thanachart", "tmbthanachart"] },
  { code: "GSB", label: "ออมสิน (GSB)", aliases: ["gsb", "ออมสิน", "governmentsavings", "governmentsavingsbank"] },
  { code: "BAAC", label: "ธ.ก.ส. (BAAC)", aliases: ["baac", "ธกส", "ธ.ก.ส.", "เพื่อการเกษตรและสหกรณ์การเกษตร"] },
  { code: "GHB", label: "อาคารสงเคราะห์ (GHB)", aliases: ["ghb", "ธอส", "ธ.อ.ส.", "อาคารสงเคราะห์", "governmenthousing"] },
  { code: "UOB", label: "ยูโอบี (UOB)", aliases: ["uob", "ยูโอบี"] },
  { code: "CIMB", label: "ซีไอเอ็มบี ไทย (CIMB)", aliases: ["cimb", "cimbthai", "ซีไอเอ็มบี", "ซีไอเอ็มบีไทย"] },
  { code: "KKP", label: "เกียรตินาคินภัทร (KKP)", aliases: ["kkp", "เกียรตินาคิน", "เกียรตินาคินภัทร", "kiatnakin", "kiatnakinphatra"] },
  { code: "TISCO", label: "ทิสโก้ (TISCO)", aliases: ["tisco", "ทิสโก้"] },
  { code: "LHB", label: "แลนด์ แอนด์ เฮ้าส์ (LH Bank)", aliases: ["lhb", "lhbank", "แลนด์แอนด์เฮ้าส์", "landandhouses"] },
  { code: "TCRB", label: "ไทยเครดิต (TCRB)", aliases: ["tcrb", "ไทยเครดิต", "thaicredit"] },
  { code: "ICBC", label: "ไอซีบีซี ไทย (ICBC)", aliases: ["icbc", "icbcthai", "ไอซีบีซี"] },
  { code: "IBANK", label: "อิสลามแห่งประเทศไทย (ibank)", aliases: ["ibank", "อิสลาม", "อิสลามแห่งประเทศไทย"] },
  { code: "CITI", label: "ซิตี้แบงก์ (Citibank)", aliases: ["citi", "citibank", "ซิตี้", "ซิตี้แบงก์", "ซิตี้แบงค์"] },
  { code: "HSBC", label: "เอชเอสบีซี (HSBC)", aliases: ["hsbc", "เอชเอสบีซี"] },
  { code: "SCBT", label: "สแตนดาร์ดชาร์เตอร์ด (SC)", aliases: ["standardchartered", "สแตนดาร์ดชาร์เตอร์ด", "scbt"] },
];
const bankKey = (s: string) => s.toLowerCase().replace(/ธนาคาร|bank|จำกัด|\(มหาชน\)|มหาชน|pcl|public company limited|[\s.\-()]/g, "");
/** ชื่อธนาคารที่พิมพ์ต่างกัน (BBL / กรุงเทพ / Bangkok Bank) → ชื่อมาตรฐานเดียว · ไม่รู้จัก = ชื่อเดิม */
export function bankLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "-";
  const exact = BANKS.find((b) => b.label === s);
  if (exact) return exact.label;
  const k = bankKey(s);
  const hit = BANKS.find((b) => b.aliases.some((a) => bankKey(a) === k) || bankKey(b.code) === k);
  return hit?.label ?? s;
}
