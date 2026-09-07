import { NextRequest, NextResponse } from "next/server";
import { createWalletChallenge, WalletLinkError } from "../../../../lib/wallet-link";

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
  if (typeof input.token !== "string" || typeof input.address !== "string") {
    return json({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  try {
    const challenge = await createWalletChallenge({
      token: input.token,
      address: input.address,
      chainId: input.chainId,
      domain: request.nextUrl.host
    });
    return json({ ok: true, ...challenge });
  } catch (error) {
    if (error instanceof WalletLinkError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    return json({ ok: false, code: "WALLET_CHALLENGE_FAILED", message: "Horris could not create a wallet challenge." }, 500);
  }
}

export async function GET() {
  return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
}
