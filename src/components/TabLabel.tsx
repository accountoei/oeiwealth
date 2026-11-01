/** ชื่อแท็บที่กว้างเท่าเดิมทั้งตอนเลือก (ตัวหนา) และไม่เลือก → แท็บไม่ขยับเมื่อสลับ (.tab-label ใน globals.css)
 *  ใช้ได้ทั้ง server และ client component */
export default function TabLabel({ children }: { children: string }) {
  return <span className="tab-label" data-label={children}>{children}</span>;
}
