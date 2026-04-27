import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isBotEnabled, getProfile } from "@/lib/ai-bot/botMemory";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const enabled = isBotEnabled(conversationId);
  const profile = getProfile(conversationId);

  return NextResponse.json({
    conversationId,
    enabled,
    profile: profile ?? null,
  });
}
