import { requireUser } from "@/lib/v2/session";
import { ROLE_CATALOG } from "@/lib/v2/role-catalog";
import { Wizard } from "./wizard";

export const dynamic = "force-dynamic";

/** Three-step setup for new accounts: the work you want, what matters, your resume. */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { supabase, user } = await requireUser();
  const { step } = await searchParams;
  const { data: p } = await supabase.from("profiles").select("target_roles,locations,state,min_salary,relocation,job_levels,resume_path,resume_parsed,resume_updated_at").eq("id", user.id).maybeSingle();
  return (
    <Wizard
      initialStep={step === "3" ? 3 : step === "2" ? 2 : 1}
      catalog={ROLE_CATALOG}
      roles={(p?.target_roles as string[] | null) ?? []}
      locations={(p?.locations as string[] | null) ?? ["remote_us"]}
      state={p?.state ?? ""}
      minSalary={p?.min_salary ?? null}
      relocation={Boolean(p?.relocation)}
      levels={(p?.job_levels as string[] | null) ?? ["internship", "new_grad", "entry"]}
      resume={{ has: Boolean(p?.resume_path), parsed: Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length), updatedAt: p?.resume_updated_at ?? null }}
    />
  );
}
