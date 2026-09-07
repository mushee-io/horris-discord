import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Horris Trade · Discord",
  description: "AI trade planning and deterministic risk controls inside Discord.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
