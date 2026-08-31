import type { ReactNode } from "react";

export const metadata = {
  title: "Uptime Monitor",
  description: "Know the instant your site goes down.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
