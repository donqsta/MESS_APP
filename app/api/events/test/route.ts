import { NextRequest, NextResponse } from "next/server";
import { publish } from "@/lib/webhook-store";

/**
 * POST /api/events/test?pageId=xxx
 * Gửi test event thủ công để kiểm tra SSE có hoạt động không.
 */
export async function POST(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get("pageId") ?? "729397667519994";

  publish({
    pageId,
    senderId: "test-sender",
    text: "🧪 Test SSE message " + new Date().toLocaleTimeString("vi-VN"),
    mid: "test-" + Date.now(),
    timestamp: Date.now(),
  });

  return NextResponse.json({ ok: true, pageId });
}
