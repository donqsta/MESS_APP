import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";
import { sendMessage } from "@/lib/facebook";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const body = await req.json();
  const { pageId, recipientId, text } = body as {
    pageId: string;
    recipientId: string;
    text: string;
  };

  if (!pageId || !recipientId || !text?.trim()) {
    return NextResponse.json(
      { error: "Thiếu pageId, recipientId hoặc text" },
      { status: 400 }
    );
  }

  const page = getPageFromEnv(pageId);
  if (!page) {
    return NextResponse.json({ error: "Không tìm thấy page" }, { status: 404 });
  }

  try {
    console.log(`[Reply] Sending from pageId=${pageId} to recipientId=${recipientId} text="${text}"`);
    const result = await sendMessage(pageId, page.accessToken, recipientId, text.trim());
    console.log(`[Reply] Success:`, result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    console.error(`[Reply] Error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
