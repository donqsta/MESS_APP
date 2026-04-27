import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getBotGlobalSettings, updateBotGlobalSettings } from "@/lib/ai-bot/botSettings";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getBotGlobalSettings());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const updated = updateBotGlobalSettings(body);
  return NextResponse.json(updated);
}
