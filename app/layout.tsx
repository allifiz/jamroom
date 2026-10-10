import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/fredoka/600.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header, Footer } from "@/components/shell";
export const metadata: Metadata = {
  title: {
    default: "JAMROOM — Your friends. Your frequency.",
    template: "%s · JAMROOM",
  },
  description:
    "A permanent little corner of the internet to listen together. Create a music room, queue YouTube tracks, and bring your friends.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
