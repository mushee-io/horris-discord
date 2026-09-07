import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "Horris Discord",
    description: "Read-only Discord interface for Horris Core",
    interactionEndpoint: "/api/discord",
    health: "/api/health",
    commands: ["help", "strategy", "risk", "perp-risk", "perp-status"],
    executionEnabled: false
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
