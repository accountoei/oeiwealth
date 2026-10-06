// ค่าตรวจที่ใช้บ่อย (บันทึกเป็นรหัสภาษาอังกฤษ ตามใบผลแล็บ · เพิ่มเองได้)
export const METRICS: { code: string; label: string; unit: string; min?: number; max?: number }[] = [
  { code: "WEIGHT", label: "น้ำหนัก", unit: "kg" },
  { code: "BMI", label: "BMI", unit: "kg/m²", min: 18.5, max: 22.9 },
  { code: "SYSTOLIC_BP", label: "ความดันตัวบน", unit: "mmHg", max: 120 },
  { code: "DIASTOLIC_BP", label: "ความดันตัวล่าง", unit: "mmHg", max: 80 },
  { code: "FBS", label: "น้ำตาลในเลือด (FBS)", unit: "mg/dL", min: 70, max: 100 },
  { code: "HBA1C", label: "HbA1c", unit: "%", max: 5.7 },
  { code: "CHOLESTEROL", label: "คอเลสเตอรอลรวม", unit: "mg/dL", max: 200 },
  { code: "LDL", label: "LDL", unit: "mg/dL", max: 130 },
  { code: "HDL", label: "HDL", unit: "mg/dL", min: 40 },
  { code: "TRIGLYCERIDE", label: "ไตรกลีเซอไรด์", unit: "mg/dL", max: 150 },
  { code: "CREATININE", label: "ครีเอตินิน", unit: "mg/dL" },
  { code: "EGFR", label: "eGFR (การทำงานของไต)", unit: "mL/min/1.73m²", min: 90 },
  { code: "URIC_ACID", label: "กรดยูริก", unit: "mg/dL" },
  { code: "SGOT", label: "SGOT (AST)", unit: "U/L" },
  { code: "SGPT", label: "SGPT (ALT)", unit: "U/L" },
];
export const METRIC_LABEL: Record<string, string> = Object.fromEntries(METRICS.map((m) => [m.code, m.label]));
