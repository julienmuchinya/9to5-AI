"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/v2/session";
import { decryptSecret, encryptSecret, generatePortalPassword } from "@/lib/v2/vault";

const hostOf = (u: string) => {
  try {
    return new URL(u.includes("://") ? u : `https://${u}`).hostname.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
};

/** Decrypts one saved portal password for its owner and records the view. */
export async function revealPortalPassword(id: string): Promise<{ password?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("application_accounts").select("id,password_enc").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data?.password_enc) return { error: "No password saved for this login." };
  try {
    const password = decryptSecret(data.password_enc);
    await supabase.from("password_access_logs").insert({ user_id: user.id, application_account_id: id, action: "reveal" });
    return { password };
  } catch {
    return { error: "This password can't be decrypted (the server key changed)." };
  }
}

export async function savePortalAccount(form: FormData) {
  const { supabase, user } = await requireUser();
  const loginUrl = String(form.get("login_url") ?? "").trim();
  const host = hostOf(loginUrl);
  if (!host) return;
  const pw = String(form.get("password") ?? "").trim() || generatePortalPassword();
  await supabase.from("application_accounts").upsert(
    {
      user_id: user.id,
      company_name: String(form.get("company_name") ?? "").trim() || host,
      portal_host: host,
      portal_name: host,
      login_url: loginUrl.includes("://") ? loginUrl : `https://${loginUrl}`,
      email_used: String(form.get("email_used") ?? "").trim() || user.email,
      password_enc: encryptSecret(pw),
      created_by: "user",
      account_created: form.get("account_created") === "on",
      notes: String(form.get("notes") ?? "").trim() || null,
    },
    { onConflict: "user_id,portal_host" }
  );
  revalidatePath("/accounts");
}

export async function markPortalCreated(id: string) {
  const { supabase, user } = await requireUser();
  await supabase.from("application_accounts").update({ account_created: true }).eq("id", id).eq("user_id", user.id);
  revalidatePath("/accounts");
}

export async function deletePortalAccount(id: string) {
  const { supabase, user } = await requireUser();
  await supabase.from("application_accounts").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/accounts");
}
