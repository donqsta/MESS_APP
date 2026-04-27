import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mess App - Facebook Fanpage Messenger",
  description: "Quản lý tin nhắn Messenger trên nhiều Facebook Fanpage",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
