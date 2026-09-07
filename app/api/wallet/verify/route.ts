import { NextRequest, NextResponse } from "next/server";
import { notifyDiscordWalletLinked, verifyWalletChallenge, WalletLinkError } from "../../../../lib/wallet-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

export async function POST(request: NextRequest) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json({ ok: false, code: "UNSUPPORTED_CONTENT_TYPE" }, 415);
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ ok: false, code: "INVALID_JSON" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, code: "INVALID_REQUEST" }, 400);

  const input = body as Record<string, unknown>;
  if (typeof input.token !== "string" || typeof input.address !== "string" || typeof input.signature !== "string") {
    return json({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  try {
    const result = await verifyWalletChallenge({ token: input.token, address: input.address, signature: input.signature });
    const discordConfirmed = await notifyDiscordWalletLinked(result.interactionToken, result.link);
    return json({
      ok: true,
      walletAddress: result.link.walletAddress,
      chainId: result.link.chainId,
      verifiedAt: result.link.verifiedAt,
      discordConfirmed
    });
  } catch (error) {
    if (error instanceof WalletLinkError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    return json({ ok: false, code: "WALLET_VERIFICATION_FAILED", message: "Horris could not verify this wallet signature." }, 500);
  }
}

export async function GET() {
  return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
}
