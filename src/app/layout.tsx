import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { AppShell } from "@/components/sidebar";
import { THEME_SCRIPT } from "@/components/theme";
import { TimeZoneCookie } from "@/components/tz-cookie";
import { currentUser } from "@/lib/v2/session";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user } = await currentUser();
  // Name for the avatar and the "Needs you" count for the bell. Both are tiny queries; failures just hide them.
  const [prof, needs] = user
    ? await Promise.all([
        supabase.from("profiles").select("first_name,last_name").eq("id", user.id).maybeSingle(),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "needs_user"),
      ])
    : [null, null];
  const name = [prof?.data?.first_name, prof?.data?.last_name].filter(Boolean).join(" ");

  return (
    <html lang="en" className={inter.variable} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-[var(--card)] focus:px-3 focus:py-2">
          Skip to content
        </a>
        <TimeZoneCookie />
        {user ? (
          <div className="flex min-h-screen">
            <AppShell email={user.email ?? ""} name={name} needs={needs?.count ?? 0}>
              {children}
            </AppShell>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
