import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";
import { getConversations } from "@/lib/facebook";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { pageId } = await params;
  const page = getPageFromEnv(pageId);
  if (!page) {
    return NextResponse.json({ error: "Không tìm thấy page" }, { status: 404 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  try {
    const data = await getConversations(pageId, page.accessToken, cursor);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
