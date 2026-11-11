/**
 * เครือญาติ — เพศ / ชื่อเรียกตามความสัมพันธ์กับหัวหน้าครอบครัว / ลำดับพี่น้อง (หน้า Family → Members และผังครอบครัว)
 *   ป้ายความสัมพันธ์พื้นฐาน (RELATIONSHIP_LABEL) และรุ่น (RELATION_GEN) อยู่ใน format.ts กับป้ายอื่น ๆ
 */
import { RELATIONSHIP_LABEL } from "@/lib/format";

const PREFIX_GENDER: Record<string, "M" | "F"> = {
  "นาย": "M", "เด็กชาย": "M", "ด.ช.": "M", "mr.": "M", "mr": "M", "master": "M",
  "นาง": "F", "นางสาว": "F", "น.ส.": "F", "เด็กหญิง": "F", "ด.ญ.": "F", "mrs.": "F", "mrs": "F", "ms.": "F", "ms": "F", "miss": "F",
};
/** เพศจากคำนำหน้า (ตรงกับ private.gender_from_prefix ในฐานข้อมูล) */
export function genderFromPrefix(prefix: string | null | undefined): "M" | "F" | null {
  return PREFIX_GENDER[(prefix ?? "").trim().toLowerCase()] ?? null;
}

export type KinPerson = {
  id: string; relationship: string | null; gender?: string | null; title_prefix?: string | null; birth_date?: string | null;
  father_id: string | null; mother_id: string | null; spouse_id: string | null;
};

/** เพศที่ใช้แสดง: ที่บันทึกไว้ → จากคำนำหน้า → จากผัง (เป็นพ่อ / แม่ของใคร · ตรงข้ามกับคู่สมรส) */
export function genderOf(p: KinPerson, people: KinPerson[], viaSpouse = true): "M" | "F" | null {
  if (p.gender === "M" || p.gender === "F") return p.gender;
  const g = genderFromPrefix(p.title_prefix);
  if (g) return g;
  const father = people.some((c) => c.father_id === p.id), mother = people.some((c) => c.mother_id === p.id);
  if (father !== mother) return father ? "M" : "F";
  const spouse = viaSpouse ? people.find((x) => x.id === p.spouse_id || x.spouse_id === p.id) : undefined;
  const sg = spouse ? genderOf(spouse, people, false) : null;
  return sg === "M" ? "F" : sg === "F" ? "M" : null;
}

/** ลำดับพี่น้อง (คนที่ 1, 2, …) ในพ่อแม่เดียวกัน ใช้กับบุตร / หลาน · นับทุกเพศ · เรียงวันเกิด (ไม่มีวันเกิด → ต่อท้าย ตามลำดับในรายชื่อ) · ลูกคนเดียว / ไม่ได้ผูกพ่อแม่ → null */
export function childOrdinal(p: KinPerson, people: KinPerson[]): number | null {
  if (!p.father_id && !p.mother_id) return null;
  const sibs = people.filter((x) => x.relationship === p.relationship && x.father_id === p.father_id && x.mother_id === p.mother_id);
  if (sibs.length < 2) return null;
  const idx = new Map(sibs.map((x, i) => [x.id, i]));
  const key = (x: KinPerson) => x.birth_date ?? "9999";
  sibs.sort((a, b) => (key(a) !== key(b) ? (key(a) < key(b) ? -1 : 1) : idx.get(a.id)! - idx.get(b.id)!));
  const n = sibs.findIndex((x) => x.id === p.id);
  return n < 0 ? null : n + 1;
}

/** ชื่อเรียกตามเพศ เทียบกับหัวหน้าครอบครัว (บิดา / มารดา · บุตรชาย / บุตรสาว · ปู่ / ย่า / ตา / ยาย ฯลฯ) */
export function kinLabel(p: KinPerson, people: KinPerson[], headId: string | null | undefined, ordinal = true): string {
  const rel = p.relationship ?? "";
  const base = RELATIONSHIP_LABEL[rel] ?? "-";
  const g = genderOf(p, people);
  const head = headId ? people.find((x) => x.id === headId) : undefined;
  const pick = (m: string, f: string, both = base) => (g === "M" ? m : g === "F" ? f : both);
  switch (rel) {
    case "SPOUSE": return pick("สามี", "ภรรยา");
    case "PARENT": return pick("บิดา", "มารดา");
    case "CHILD": {
      const n = ordinal ? childOrdinal(p, people) : null;
      return pick("บุตรชาย", "บุตรสาว") + (n ? ` คนที่ ${n}` : "");
    }
    case "CHILD_IN_LAW": return pick("ลูกเขย", "ลูกสะใภ้");
    case "GRANDCHILD": {
      const n = ordinal ? childOrdinal(p, people) : null;
      return pick("หลานชาย", "หลานสาว") + (n ? ` คนที่ ${n}` : "");
    }
    case "GRANDPARENT": {
      const parentOf = (pid: string | null) => people.find((x) => x.id === pid);
      const isParentOf = (x: KinPerson | undefined) => !!x && (x.father_id === p.id || x.mother_id === p.id);
      const side = isParentOf(parentOf(head?.father_id ?? null)) ? "F" : isParentOf(parentOf(head?.mother_id ?? null)) ? "M" : null;
      if (side === "F") return pick("ปู่", "ย่า", "ปู่ / ย่า");
      if (side === "M") return pick("ตา", "ยาย", "ตา / ยาย");
      return pick("ปู่ / ตา", "ย่า / ยาย");
    }
    case "PARENT_IN_LAW": {
      const hg = head ? genderOf(head, people) : null;
      if (hg === "M") return pick("พ่อตา", "แม่ยาย", "พ่อตา / แม่ยาย");
      if (hg === "F") return pick("พ่อสามี", "แม่สามี", "พ่อ / แม่สามี");
      return pick("พ่อของคู่สมรส", "แม่ของคู่สมรส");
    }
    case "SIBLING": {
      const hb = head?.birth_date, pb = p.birth_date;
      if (hb && pb && hb !== pb) return pb < hb ? pick("พี่ชาย", "พี่สาว", "พี่") : pick("น้องชาย", "น้องสาว", "น้อง");
      return pick("พี่ชาย / น้องชาย", "พี่สาว / น้องสาว");
    }
    default: return base;
  }
}
