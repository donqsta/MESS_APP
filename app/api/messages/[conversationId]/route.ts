import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";
import { getMessages } from "@/lib/facebook";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { conversationId } = await params;
  const pageId = req.nextUrl.searchParams.get("pageId");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  if (!pageId) {
    return NextResponse.json({ error: "Thiếu pageId" }, { status: 400 });
  }

  const page = getPageFromEnv(pageId);
  if (!page) {
    return NextResponse.json({ error: "Không tìm thấy page" }, { status: 404 });
  }

  try {
    const data = await getMessages(conversationId, page.accessToken, cursor);
    return NextResponse.json({
      ...data,
      data: [...data.data].reverse(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
