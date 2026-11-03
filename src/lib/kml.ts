/**
 * ไฟล์แผนที่ KML ของทรัพย์สิน (นำเข้า Google My Maps / Google Earth) — สร้างในเบราว์เซอร์ ไม่ส่งข้อมูลออกไปไหน
 * แยกโฟลเดอร์ตามกลุ่มทำเล · ข้อมูลประกอบ (กลุ่มทำเล / ประเภท / การใช้งาน) ใส่ใน ExtendedData ให้ My Maps "จัดกลุ่มตาม" ได้
 * ไม่ใส่มูลค่า / ราคา (ไฟล์อาจถูกส่งต่อ) · ตกลง 3 พ.ย. 2026
 */
export type KmlPlace = {
  name: string; lat: number; lng: number; group: string | null; type: string; usage: string; usageCode: string;
  area: string | null; address: string | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// สีหมุดตามการใช้งาน (KML สี = aabbggrr)
const USAGE_STYLE: Record<string, string> = {
  BUSINESS_USE: "ff8b3d48",
  OWNER_OCCUPIED: "ff3c14dc",
  PERSONAL_USE: "ff3c14dc",
  RENTAL: "ffd77800",
  VACANT: "ff8c8c8c",
};

export function buildKml(title: string, places: KmlPlace[]): string {
  const groups = new Map<string, KmlPlace[]>();
  for (const p of places) {
    const g = p.group?.trim() || "(ไม่ระบุกลุ่มทำเล)";
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const styles = [...Object.entries(USAGE_STYLE), ["OTHER", "ff00a5ff"]].map(([k, c]) =>
    `<Style id="u-${k}"><IconStyle><color>${c}</color><scale>1.1</scale>`
    + `<Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`).join("\n    ");
  const folders = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "th")).map(([g, ps]) => {
    const marks = ps.map((p) => {
      const desc = [`${p.type} · ${p.usage}`, p.area, p.address].filter(Boolean).join("<br>");
      const style = USAGE_STYLE[p.usageCode] ? p.usageCode : "OTHER";
      return `      <Placemark>
        <name>${esc(p.name)}</name>
        <description>${esc(desc)}</description>
        <styleUrl>#u-${style}</styleUrl>
        <ExtendedData>
          <Data name="กลุ่มทำเล"><value>${esc(g)}</value></Data>
          <Data name="ประเภท"><value>${esc(p.type)}</value></Data>
          <Data name="การใช้งาน"><value>${esc(p.usage)}</value></Data>
        </ExtendedData>
        <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
      </Placemark>`;
    }).join("\n");
    return `    <Folder>\n      <name>${esc(g)} (${ps.length})</name>\n${marks}\n    </Folder>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(title)}</name>
    ${styles}
${folders}
  </Document>
</kml>
`;
}
