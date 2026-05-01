import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loginUhchat, setManualCookie } from "@/lib/uhchat";

export async function GET() {
  const hasCredentials = !!(process.env.UHCHAT_EMAIL && process.env.UHCHAT_PASSWORD);
  return NextResponse.json({ hasCredentials, email: process.env.UHCHAT_EMAIL ?? "" });
}

export async function POST() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!process.env.UHCHAT_EMAIL || !process.env.UHCHAT_PASSWORD) {
    return NextResponse.json(
      { error: "Chưa cấu hình UHCHAT_EMAIL / UHCHAT_PASSWORD trong .env.local" },
      { status: 400 }
    );
  }

  try {
    const cookie = await loginUhchat();
    setManualCookie(cookie);
    console.log("[uhchat/auto-login] Đăng nhập thành công, cookie đã lưu");
    return NextResponse.json({ success: true, message: "Đăng nhập uhchat thành công" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Đăng nhập thất bại";
    console.error("[uhchat/auto-login] Lỗi:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
