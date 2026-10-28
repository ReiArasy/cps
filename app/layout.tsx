import type { Metadata, Viewport } from "next";
import { Geist, Outfit } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: "Cuanki POS",
  description: "Kasir dan rekonsiliasi shift Cuanki multi-cabang",
  applicationName: "Cuanki POS",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Cuanki POS" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#161010",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${geist.variable} ${outfit.variable}`}>{children}</body>
    </html>
  );
}
