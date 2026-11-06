import Link from "next/link";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionPill } from "@/world/SessionPill";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Comment Desk",
  description: "Verifiable public input: one real human, one counted voice, recountable by anyone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="site-header">
          <Link href="/" className="brand">Comment Desk</Link>
          <nav>
            <Link href="/">Dockets</Link>
            <Link href="/join">Join</Link>
            <Link href="/agent">Agent</Link>
          </nav>
          <SessionPill />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
