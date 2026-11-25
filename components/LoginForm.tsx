"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO = [
  { email: "ravi@opmaint.test", label: "Ravi Kumar", role: "Requester" },
  { email: "meena@opmaint.test", label: "Meena Sundaram", role: "Area Owner — Assembly Line A" },
  { email: "arjun@opmaint.test", label: "Arjun Rao", role: "Safety Officer" },
  { email: "divya@opmaint.test", label: "Divya Iyer", role: "Admin" },
];

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("arjun@opmaint.test");
  const [password, setPassword] = useState("permit1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not sign in.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="card login-card">
      <form className="card-pad form-grid" onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 22 }}>Sign in</h1>
          <p className="muted small" style={{ marginTop: 4, marginBottom: 0 }}>
            Permit to Work — Chennai Works &amp; Hosur Unit
          </p>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error ? <div className="notice" data-tone="danger">{error}</div> : null}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="demo-users">
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          Demo accounts — password <code>permit1234</code>
        </div>
        {DEMO.map((person) => (
          <button
            key={person.email}
            type="button"
            onClick={() => {
              setEmail(person.email);
              setPassword("permit1234");
            }}
          >
            <span>
              <strong>{person.label}</strong>
              <span className="muted"> · {person.role}</span>
            </span>
            <span className="mono muted tiny">{person.email.split("@")[0]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
