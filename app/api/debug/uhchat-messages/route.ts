import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getMessages } from "@/lib/uhchat";

/**
 * Debug endpoint — lấy messages đã parse của 1 session UChat.
 * Yêu cầu đăng nhập admin.
 * Dùng: GET /api/debug/uhchat-messages?sessionId=<32-char-hex>
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
  if (!/^[a-f0-9]{32}$/.test(sessionId)) {
    return NextResponse.json({ error: "sessionId không hợp lệ (cần 32 hex chars)" }, { status: 400 });
  }

  try {
    const { messages, meta } = await getMessages(sessionId);
    const visitorMessages = messages.filter((m) => m.from === "visitor");
    const fullVisitorText = visitorMessages.map((m) => m.text).join(" ");

    // Trích SĐT bằng regex đơn giản để so sánh
    const phoneRegex = /(0[3-9]\d{8})/g;
    const phones = [...new Set([...fullVisitorText.matchAll(phoneRegex)].map((m) => m[1]))];

    return NextResponse.json({
      sessionId,
      meta,
      totalMessages: messages.length,
      visitorMessageCount: visitorMessages.length,
      visitorMessages: visitorMessages.map((m) => ({ text: m.text, time: m.time })),
      fullVisitorText,
      phonesFound: phones,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
