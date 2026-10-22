import Link from "next/link";
import { childOrdinal, kinLabel } from "@/lib/format";

export type TreePerson = {
  id: string; name: string; nickname: string | null; photo: string | null; relationship: string | null; status: string;
  father_id: string | null; mother_id: string | null; spouse_id: string | null;
  gender: string | null; title_prefix: string | null; birth_date: string | null;
};

const GEN_LABEL: Record<number, string> = { [-2]: "รุ่นปู่ย่าตายาย", [-1]: "รุ่นพ่อแม่", 0: "รุ่นหัวหน้าครอบครัว", 1: "รุ่นลูก", 2: "รุ่นหลาน", 3: "รุ่นเหลน" };

/**
 * ผังครอบครัวแบบแบ่งรุ่น
 * - รุ่นนับจากหัวหน้าครอบครัว: พ่อ/แม่ = รุ่นบน · ลูก = รุ่นล่าง · คู่สมรส = รุ่นเดียวกัน
 * - ในแต่ละรุ่น: คู่สมรสอยู่ด้วยกัน · รุ่นล่างจัดกลุ่มตามพ่อแม่ ("ลูกของ …")
 * - คนที่ยังไม่ได้ผูกพ่อ/แม่/คู่สมรส → แถว "ยังไม่ได้ผูกในผัง"
 * - kin: สมาชิกทุกคน (รวม Archived) ใช้คิดชื่อเรียกตามเพศ เช่น ปู่ / ตา
 */
export function FamilyTree({ people, headId, kin = people }: { people: TreePerson[]; headId: string | null; kin?: TreePerson[] }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const order = new Map(people.map((p, i) => [p.id, i]));
  const kidsOf = (id: string) => people.filter((p) => p.father_id === id || p.mother_id === id);
  const spouseOf = (p: TreePerson) => (p.spouse_id && byId.has(p.spouse_id) ? p.spouse_id : people.find((q) => q.spouse_id === p.id)?.id ?? null);

  // รุ่น: BFS จากหัวหน้า
  const gen = new Map<string, number>();
  if (headId && byId.has(headId)) {
    gen.set(headId, 0);
    const queue = [headId];
    while (queue.length) {
      const id = queue.shift()!;
      const p = byId.get(id)!; const g = gen.get(id)!;
      const next: [string | null, number][] = [[p.father_id, g - 1], [p.mother_id, g - 1], [spouseOf(p), g],
        ...kidsOf(id).map((k) => [k.id, g + 1] as [string, number])];
      for (const [n, ng] of next) if (n && byId.has(n) && !gen.has(n)) { gen.set(n, ng); queue.push(n); }
    }
  }
  const gens = [...new Set(gen.values())].sort((a, b) => a - b);
  const unlinked = people.filter((p) => !gen.has(p.id));

  /** คนในหน่วยที่มีพ่อ / แม่ในระบบ (ใช้จัดกลุ่ม "ลูกของ …") */
  const bloodOf = (u: TreePerson[]) => u.find((x) => x.father_id || x.mother_id) ?? u[0];
  const keyOf = (p: TreePerson) => (p.father_id || p.mother_id ? `${p.father_id ?? ""}|${p.mother_id ?? ""}` : "");

  // หน่วยครอบครัว (คน + คู่สมรสในรุ่นเดียวกัน) · จัดกลุ่มตามพ่อแม่
  function rows(g: number) {
    const members = people.filter((p) => gen.get(p.id) === g);
    const used = new Set<string>();
    const units: TreePerson[][] = [];
    for (const p of members) {
      if (used.has(p.id)) continue;
      used.add(p.id);
      const s = spouseOf(p);
      if (s && gen.get(s) === g && !used.has(s)) { used.add(s); units.push([p, byId.get(s)!]); } else units.push([p]);
    }
    const groups = new Map<string, { label: string; units: TreePerson[][] }>();
    for (const u of units) {
      const blood = bloodOf(u);
      const key = keyOf(blood);
      const label = key ? `ลูกของ ${[blood.father_id, blood.mother_id].map((x) => (x ? byId.get(x)?.name : null)).filter(Boolean).join(" & ")}` : "";
      if (!groups.has(key)) groups.set(key, { label, units: [] });
      groups.get(key)!.units.push(u);
    }
    return [...groups.values()].sort((a, b) => (order.get(a.units[0][0].id) ?? 0) - (order.get(b.units[0][0].id) ?? 0));
  }

  const Card = ({ p }: { p: TreePerson }) => (
    <Link href={`/family/members/${p.id}`}
      className={`flex w-36 flex-col items-center rounded-lg border bg-white px-2 py-2 text-center hover:bg-slate-50 ${p.id === headId ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"} ${p.status === "DECEASED" ? "opacity-60" : ""}`}>
      {p.photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.photo} alt="" className="h-12 w-12 rounded-full object-cover" />
        : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500">{p.name.slice(0, 1)}</span>}
      <span className="mt-1 w-full truncate text-sm font-medium text-slate-900">{p.name}</span>
      <span className="w-full truncate text-[11px] text-slate-500">
        {p.id === headId ? "★ หัวหน้าครอบครัว" : kinLabel(p, kin, headId)}{p.status === "DECEASED" && " · Archived"}
      </span>
    </Link>
  );

  if (!headId) return <p className="text-sm text-slate-500">ยังไม่ได้ตั้งหัวหน้าครอบครัว — ADMIN ตั้งได้ที่ปุ่ม แก้ไข ในกล่องชื่อครอบครัว</p>;

  return (
    <div className="space-y-6 overflow-x-auto pb-2">
      {gens.map((g, gi) => (
        <div key={g}>
          {gi > 0 && <div className="mx-auto mb-2 h-4 w-px bg-slate-300" />}
          <div className="mb-2 text-center text-xs font-medium text-slate-500">{GEN_LABEL[g] ?? `รุ่นที่ ${g}`}</div>
          <div className="flex flex-wrap justify-center gap-4">
            {rows(g).map((grp, i) => {
              if (!grp.label) return (
                <div key={i} className="flex flex-wrap justify-center gap-3">
                  {grp.units.map((u) => (
                    <div key={u[0].id} className="flex items-center gap-1">
                      <Card p={u[0]} />
                      {u[1] && <><span className="text-slate-300" title="คู่สมรส">—</span><Card p={u[1]} /></>}
                    </div>
                  ))}
                </div>
              );
              // ป้าย "ลูกของ …" อยู่เหนือเฉพาะลูก · คู่สมรสที่มาจากครอบครัวอื่นอยู่ถัดออกไป (คนที่มีคู่สมรสอยู่ท้ายกรอบ ติดกับคู่)
              const split = grp.units.map((u) => {
                const b = bloodOf(u);
                const o = u.find((x) => x !== b);
                return { b, o: o && keyOf(o) !== keyOf(b) ? o : undefined, sib: o && keyOf(o) === keyOf(b) ? o : undefined };
              }).sort((x, y) => Number(!!x.o) - Number(!!y.o) || (childOrdinal(x.b, kin) ?? 0) - (childOrdinal(y.b, kin) ?? 0));
              return (
                <div key={i} className="flex items-end gap-1">
                  <div>
                    <div className="mb-1 text-center text-[11px] text-slate-500">{grp.label}</div>
                    <div className="flex flex-wrap justify-center gap-3">
                      {split.map((x) => (
                        <div key={x.b.id} className="flex items-center gap-1">
                          <Card p={x.b} />
                          {x.sib && <><span className="text-slate-300" title="คู่สมรส">—</span><Card p={x.sib} /></>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {split.filter((x) => x.o).map((x) => (
                    <div key={x.o!.id} className="flex items-center gap-1">
                      <span className="text-slate-300" title={`คู่สมรสของ ${x.b.name}`}>—</span><Card p={x.o!} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {unlinked.length > 0 && (
        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 text-center text-xs font-medium text-slate-500">ยังไม่ได้ผูกในผัง (ใส่พ่อ / แม่ / คู่สมรส ในหน้าข้อมูลของแต่ละคน)</div>
          <div className="flex flex-wrap justify-center gap-3">{unlinked.map((p) => <Card key={p.id} p={p} />)}</div>
        </div>
      )}
    </div>
  );
}
