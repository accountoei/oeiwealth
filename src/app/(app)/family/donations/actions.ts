"use server";

import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str, type FormState } from "@/lib/format";

export type ActionState = FormState;

/** บันทึก / แก้ไขรายการบริจาค (มี id = แก้ไข) · ไม่สร้างเงินออก (รายจ่ายจริงอยู่ที่ Income & Expenses) */
export async function saveDonation(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get("id"));
  const donor = str(form.get("donor")) ?? "";
  const kind = donor.startsWith("p:") ? "PERSON" : donor.startsWith("b:") ? "BUSINESS" : "GROUP";
  const yearOnly = form.get("year_only") === "on";
  let date = str(form.get("donation_date"));
  if (!date) return { error: "กรุณาใส่วันที่" };
  if (yearOnly) date = `${date.slice(0, 4)}-12-31`;
  const amount = num(form.get("amount"));
  if (!amount || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน / มูลค่า" };
  const taxStatus = str(form.get("tax_status")) ?? "PENDING";
  const row = {
    donation_date: date, year_only: yearOnly, donor_kind: kind,
    donor_person_id: kind === "PERSON" ? donor.slice(2) : null,
    donor_asset_id: kind === "BUSINESS" ? donor.slice(2) : null,
    donor_name: kind === "GROUP" ? str(form.get("donor_name")) : null,
    claimant_person_id: kind === "PERSON" ? str(form.get("claimant_person_id")) : null,
    donee_name: str(form.get("donee_name")), donee_type: str(form.get("donee_type")), purpose: str(form.get("purpose")),
    donation_form: str(form.get("donation_form")) ?? "CASH", amount,
    receipt_no: str(form.get("receipt_no")), project_name: str(form.get("project_name")),
    tax_status: kind === "PERSON" ? taxStatus : "NONE",
    tax_kind: kind === "PERSON" && taxStatus !== "NONE" ? str(form.get("tax_kind")) : null,
    e_donation: kind === "PERSON" && form.get("e_donation") === "on",
    notes: str(form.get("notes")),
  };
  if (!row.donee_name) return { error: "กรุณาใส่ชื่อผู้รับบริจาค" };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("donation_records").update(row).eq("id", id)
    : await supabase.from("donation_records").insert({ ...row, expense_item_id: str(form.get("expense_item_id")) });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/donations");
  return { ok: id ? "บันทึกแล้ว" : "เพิ่มรายการบริจาคแล้ว" };
}
