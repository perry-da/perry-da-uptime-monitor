import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "@/lib/fontawesome";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "Uptime Monitor: know the instant your site goes down",
  description: "Add a URL, get alerted before your customers notice. Free HTTP, ping, TCP, and SSL-expiry monitoring.",
};

// Marketing pages get SiteHeader/SiteFooter via (marketing)/layout.tsx; the
// dashboard gets its own app-shell sidebar via dashboard/layout.tsx — this
// root layout only owns html/body-level concerns shared by both.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
