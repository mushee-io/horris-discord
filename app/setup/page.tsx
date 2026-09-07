export default function DiscordSetupPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f5f2e9", padding: "48px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", borderTop: "1px solid #444", borderBottom: "1px solid #444", padding: "32px 0" }}>
        <p style={{ fontSize: 11, letterSpacing: ".12em", color: "#888" }}>HORRIS / DISCORD SETUP</p>
        <h1 style={{ fontFamily: "Inter, Arial, sans-serif", fontSize: "clamp(48px, 8vw, 96px)", lineHeight: .9, margin: "20px 0 28px", letterSpacing: "-.06em" }}>REGISTER<br />COMMANDS</h1>
        <p style={{ maxWidth: 650, color: "#aaa", lineHeight: 1.6 }}>
          This registers the fixed Horris command set to the configured test server using the credentials already stored in Vercel. No token or secret is shown in the browser.
        </p>
        <form method="post" action="/api/register-commands" style={{ marginTop: 28 }}>
          <button type="submit" style={{ border: "1px solid #f5f2e9", background: "#f5f2e9", color: "#0a0a0a", padding: "14px 18px", font: "inherit", cursor: "pointer" }}>
            REGISTER HORRIS COMMANDS →
          </button>
        </form>
        <p style={{ marginTop: 22, fontSize: 11, color: "#666" }}>Expected: /trade · /help · /strategy · /risk · /perp-risk · /perp-status · Analyze with Horris</p>
      </div>
    </main>
  );
}
