import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { toggleBot, isBotEnabled, registerSenderMapping } from "@/lib/ai-bot/botMemory";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId, pageId, senderId } = await req.json();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // Đăng ký mapping để webhook có thể tra cứu conversationId từ senderId
  if (pageId && senderId) {
    registerSenderMapping(pageId, senderId, conversationId);
  }

  const enabled = toggleBot(conversationId);
  return NextResponse.json({ conversationId, enabled });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const pageId = req.nextUrl.searchParams.get("pageId");
  const senderId = req.nextUrl.searchParams.get("senderId");

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // Đăng ký mapping khi UI mở hội thoại
  if (pageId && senderId) {
    registerSenderMapping(pageId, senderId, conversationId);
  }

  const enabled = isBotEnabled(conversationId);
  return NextResponse.json({ conversationId, enabled });
}
