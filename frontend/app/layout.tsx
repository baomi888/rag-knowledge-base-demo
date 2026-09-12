import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";

// 圆滚滚的 web 字体（英文/数字），中文回落本地幼圆/圆体
const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-rounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RAG 知识库",
  description: "RAG 知识库管理与问答前端",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${baloo.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
