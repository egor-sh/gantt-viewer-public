import type { Metadata } from "next";
import "./globals.css";
import { Toaster as SonnerToaster } from "sonner";

export const metadata: Metadata = {
  title: "Просмотрщик диаграмм Ганта — MS Project XML для macOS",
  description: "Простой просмотрщик диаграмм Ганта для файлов Microsoft Project (XML). Работает локально на macOS.",
  keywords: ["Gantt", "Microsoft Project", "MS Project", "просмотрщик", "macOS", "diagram", "XML"],
  authors: [{ name: "Gantt Viewer" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <SonnerToaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
