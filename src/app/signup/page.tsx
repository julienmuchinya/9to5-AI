import { redirect } from "next/navigation";

/** Sign-up lives on the login page; keep /signup working for old links. */
export default function SignupPage() {
  redirect("/login?mode=signup");
}
