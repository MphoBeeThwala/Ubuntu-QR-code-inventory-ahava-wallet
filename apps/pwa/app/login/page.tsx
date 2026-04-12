"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError, getSession, login, saveSession } from "../../lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const data = await login(phoneNumber, pin);
      const existing = getSession();
      saveSession({
        userId: data.userId,
        walletId: existing?.walletId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        deviceId: localStorage.getItem("ahava.deviceId") || "web-device",
      });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to login right now");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <div className="hero-box">
        <h2>Login</h2>
        <form onSubmit={onSubmit}>
          <label>
            Phone Number
            <input
              required
              placeholder="0821234567"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </label>
          <label>
            PIN
            <input
              required
              type="password"
              minLength={4}
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </label>
          {error && <p className="state error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "Signing in..." : "Login"}</button>
        </form>
        <p className="muted">No account yet? <Link href="/register">Register</Link></p>
      </div>
    </section>
  );
}

