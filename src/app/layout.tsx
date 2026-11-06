import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { Sidebar } from "@/components/sidebar";
import { currentUser } from "@/lib/v2/session";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user } = await currentUser();

  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">
        {user ? (
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar email={user.email ?? ""} />
            <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
