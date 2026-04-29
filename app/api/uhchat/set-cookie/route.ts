import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setManualCookie, invalidateSession } from "@/lib/uhchat";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { cookie } = await req.json() as { cookie?: string };

  if (!cookie?.trim()) {
    return NextResponse.json({ error: "Cookie không được để trống" }, { status: 400 });
  }

  invalidateSession();
  setManualCookie(cookie.trim());

  return NextResponse.json({ success: true, message: "Đã lưu cookie uhchat" });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  invalidateSession();
  setManualCookie("");

  return NextResponse.json({ success: true, message: "Đã xóa cookie uhchat" });
}
