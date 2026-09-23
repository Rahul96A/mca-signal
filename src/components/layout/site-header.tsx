"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Bookmark, Database, LogIn, LogOut, Search } from "lucide-react";
import { useSession } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "../ui/primitives";
import { ThemeToggle } from "./theme-toggle";
import { CommandBar } from "./command-bar";

const NAV = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/sources", label: "Data sources", icon: Database },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: user } = useSession();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.setQueryData(["me"], null);
    qc.removeQueries({ queryKey: ["watchlist"] });
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          <span className="hidden sm:inline">MCA Signal</span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", pathname.startsWith(n.href) && "bg-muted text-foreground")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => window.dispatchEvent(new Event("mca:open-command"))}
          className="ml-auto flex h-9 w-full max-w-xs items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-muted"
          aria-label="Open search"
        >
          <Search className="size-4" />
          <span className="flex-1 truncate text-left">Search company, CIN, DIN…</span>
          <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
        </button>
        <ThemeToggle />
        {user ? (
          <Button variant="ghost" size="sm" onClick={logout} title={user.email}>
            <LogOut /> <span className="hidden lg:inline">Sign out</span>
          </Button>
        ) : (
          <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="hidden sm:block">
            <Button variant="outline" size="sm">
              <LogIn /> Sign in
            </Button>
          </Link>
        )}
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto border-t px-2 py-1 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground", pathname.startsWith(n.href) && "bg-muted text-foreground")}>
            <n.icon className="size-3.5" /> {n.label}
          </Link>
        ))}
        {!user && (
          <Link href="/login" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground">
            <LogIn className="size-3.5" /> Sign in
          </Link>
        )}
      </nav>
      <CommandBar />
    </header>
  );
}
