import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VOIDSTRIKE — Arena Protocol",
  description:
    "Drop in. Lock on. Leave nothing. A top-down twin-stick arena shooter running a deterministic 60Hz simulation. Season 01 ranked ladder is live.",
  keywords: [
    "VOIDSTRIKE",
    "arena shooter",
    "twin-stick",
    "browser game",
    "ranked",
  ],
  authors: [{ name: "VOIDSTRIKE STUDIOS" }],
  icons: { icon: "/vs-mark.svg" },
  openGraph: {
    title: "VOIDSTRIKE — Arena Protocol",
    description: "Drop in. Lock on. Leave nothing.",
    siteName: "VOIDSTRIKE",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${chakra.variable} ${inter.variable} ${jetbrains.variable} antialiased bg-void text-ink`}
      >
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" theme="dark" closeButton />
      </body>
    </html>
  );
}
