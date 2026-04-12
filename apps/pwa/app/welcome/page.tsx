import Link from "next/link";

export default function WelcomePage() {
  return (
    <section className="hero">
      <div className="hero-box">
        <span className="pill">Welcome</span>
        <h1>Ahava eWallet</h1>
        <p className="muted">Register, login, manage wallet, send money, and review history.</p>
        <div className="grid-2">
          <Link href="/register"><button>Create account</button></Link>
          <Link href="/login"><button className="button-alt">Login</button></Link>
        </div>
      </div>
    </section>
  );
}

