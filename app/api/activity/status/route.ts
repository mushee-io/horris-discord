import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { ActivityAuthError, verifyActivityIdentity } from "../../../../lib/activity-auth";
import { getPerpStatus, HorrisApiError } from "../../../../lib/horris-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  try {
    await verifyActivityIdentity(request.headers.get("authorization"));
    const length = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(length) && length > 4_096) return json({ error: "Request too large.", readOnly: true }, 413);
    const body = await request.json() as { account?: unknown };
    const account = typeof body?.account === "string" ? body.account.trim() : "";
    if (!isAddress(account)) return json({ error: "Enter a valid Celo wallet address.", readOnly: true }, 400);
    const data = await getPerpStatus(account);
    return json({ ...data, account, readOnly: true, executionEnabled: false });
  } catch (error) {
    if (error instanceof ActivityAuthError) return json({ error: error.message, readOnly: true }, error.status);
    if (error instanceof HorrisApiError) return json({ error: "Live UpDown status is temporarily unavailable.", readOnly: true }, error.status >= 400 && error.status < 600 ? error.status : 502);
    return json({ error: "Live status failed safely.", readOnly: true }, 502);
  }
}
