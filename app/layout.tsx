import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sunburst · 本地影像工作台",
  description:
    "本地照片精修、蒙版编辑与像素保护",
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Browser extensions can add attributes to <html> before React hydrates.
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body
        className={"antialiased h-full bg-background text-foreground"}
      >
        {children}
      </body>
    </html>
  );
}
