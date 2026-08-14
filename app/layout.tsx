import type { Metadata } from "next";
import { Barlow_Condensed, Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const description =
    "A fast, strategic multiplayer party game for 2–10 players. Draw wisely, challenge boldly, and score your way to the top.";

  return {
    metadataBase,
    title: {
      default: "ScoreUp — Draw. Challenge. Win.",
      template: "%s | ScoreUp",
    },
    description,
    openGraph: {
      type: "website",
      title: "ScoreUp — Draw. Challenge. Win.",
      description,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "ScoreUp — Draw. Challenge. Win.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "ScoreUp — Draw. Challenge. Win.",
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
