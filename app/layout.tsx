import type { Metadata } from "next";
import Link from "next/link";
import { currentUser, ROLE_LABELS } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Permit to Work · Opmaint",
  description: "Permit to Work module for a CMMS — hot work, confined space, work at height, LOTO.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body>
        {user ? (
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                Opmaint <span>Permit to Work</span>
              </Link>
              <nav className="nav">
                <Link href="/">Permits</Link>
                <Link href="/approvals">My approvals</Link>
                <Link href="/permits/new">Raise a permit</Link>
              </nav>
              <div className="topbar-right">
                <div className="who">
                  <strong>{user.name}</strong>
                  <span>{ROLE_LABELS[user.role]}</span>
                </div>
                <form action="/api/auth/logout" method="post">
                  <button className="btn btn-sm" type="submit" style={{ background: "transparent", color: "#d8e1d2", borderColor: "#3c5145" }}>
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
        ) : null}
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
