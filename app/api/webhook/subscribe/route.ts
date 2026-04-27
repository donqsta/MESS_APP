import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";

const FB_GRAPH = "https://graph.facebook.com/v25.0";
const SUBSCRIBED_FIELDS = "messages,messaging_postbacks,message_echoes,message_deliveries,message_reads";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const pageId = req.nextUrl.searchParams.get("pageId");
  if (!pageId) {
    return NextResponse.json({ error: "Thiếu pageId" }, { status: 400 });
  }

  const page = getPageFromEnv(pageId);
  if (!page) {
    return NextResponse.json({ error: "Không tìm thấy page" }, { status: 404 });
  }

  const res = await fetch(
    `${FB_GRAPH}/${pageId}/subscribed_apps?subscribed_fields=${SUBSCRIBED_FIELDS}&access_token=${page.accessToken}`,
    { method: "POST" }
  );

  const data = await res.json();

  if (data.error) {
    return NextResponse.json(
      { error: `Subscribe thất bại: ${data.error.message}` },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: data.success, fields: SUBSCRIBED_FIELDS });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const pageId = req.nextUrl.searchParams.get("pageId");
  if (!pageId) {
    return NextResponse.json({ error: "Thiếu pageId" }, { status: 400 });
  }

  const page = getPageFromEnv(pageId);
  if (!page) {
    return NextResponse.json({ error: "Không tìm thấy page" }, { status: 404 });
  }

  const res = await fetch(
    `${FB_GRAPH}/${pageId}/subscribed_apps?access_token=${page.accessToken}`
  );

  const data = await res.json();

  if (data.error) {
    return NextResponse.json({ error: data.error.message }, { status: 400 });
  }

  return NextResponse.json({ apps: data.data ?? [] });
}
