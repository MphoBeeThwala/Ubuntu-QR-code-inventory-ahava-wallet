"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { register, saveSession, ApiError } from "../../lib/api-client";

export default function RegisterPage() {
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
      const data = await register(phoneNumber, pin);
      saveSession({
        userId: data.userId,
        walletId: data.walletId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        deviceId: localStorage.getItem("ahava.deviceId") || "web-device",
      });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to register right now");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <div className="hero-box">
        <h2>Create account</h2>
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
            PIN (4-6 digits)
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
          <button type="submit" disabled={busy}>{busy ? "Creating..." : "Register"}</button>
        </form>
        <p className="muted">Already registered? <Link href="/login">Login</Link></p>
      </div>
    </section>
  );
}

