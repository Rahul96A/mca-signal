"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api-client";
import type { SessionUser } from "@/lib/client/hooks";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";

function LoginForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get("next") ?? "/watchlist";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/watchlist";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = (await api<SessionUser>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password, name }) })).data;
      qc.setQueryData(["me"], user);
      router.push(safeNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">{mode === "login" ? "Sign in" : "Create account"}</CardTitle>
        <CardDescription>Needed only for your watchlist. Research pages are public.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <Input type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
        <button className="mt-4 w-full text-center text-xs text-primary hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
        <p className="mt-4 rounded-md bg-muted p-2 text-center text-[11px] text-muted-foreground">Demo mode account: demo@mcasignal.local / demo12345</p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
