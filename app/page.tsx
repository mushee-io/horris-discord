import HorrisActivity from "../components/HorrisActivity";

function safeTerminalUrl() {
  const fallback = "https://horris-delta.vercel.app/terminal";
  const raw = process.env.HORRIS_TERMINAL_URL?.trim() || fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <HorrisActivity clientId={process.env.DISCORD_APPLICATION_ID?.trim() || ""} terminalUrl={safeTerminalUrl()} />;
}
