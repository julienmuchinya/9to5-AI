import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { Sidebar } from "@/components/sidebar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user ? (
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar email={user.email ?? ""} />
            <main className="min-w-0 flex-1 overflow-auto p-4 md:p-8">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
