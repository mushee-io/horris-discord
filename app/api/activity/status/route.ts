import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { ActivityAuthError, verifyActivityIdentity } from "../../../../lib/activity-auth";
import { getPerpStatus, HorrisApiError } from "../../../../lib/horris-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_STATUS_REQUEST_BYTES = 4 * 1024;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  try {
    await verifyActivityIdentity(request.headers.get("authorization"));
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ error: "Unsupported content type.", readOnly: true }, 415);

    const declared = request.headers.get("content-length");
    if (declared) {
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length < 0) return json({ error: "Invalid content length.", readOnly: true }, 400);
      if (length > MAX_STATUS_REQUEST_BYTES) return json({ error: "Request too large.", readOnly: true }, 413);
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_STATUS_REQUEST_BYTES) return json({ error: "Request too large.", readOnly: true }, 413);

    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request.", readOnly: true }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request.", readOnly: true }, 400);
    const account = typeof (body as Record<string, unknown>).account === "string" ? String((body as Record<string, unknown>).account).trim() : "";
    if (!isAddress(account)) return json({ error: "Enter a valid Celo wallet address.", readOnly: true }, 400);
    const data = await getPerpStatus(account);
    return json({ ...data, account, readOnly: true, executionEnabled: false });
  } catch (error) {
    if (error instanceof ActivityAuthError) return json({ error: error.message, readOnly: true }, error.status);
    if (error instanceof HorrisApiError) return json({ error: "Live UpDown status is temporarily unavailable.", readOnly: true }, error.status >= 400 && error.status < 600 ? error.status : 502);
    return json({ error: "Live status failed safely.", readOnly: true }, 502);
  }
}
