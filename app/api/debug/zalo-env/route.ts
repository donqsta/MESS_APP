import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Debug endpoint: kiểm tra env var ZALO_BOT_SECRET / ZALO_BOT_TOKEN
 * có đúng không trên server đang chạy.
 * Chỉ trả về metadata (length + first 4 chars) — KHÔNG lộ secret.
 * Cần đăng nhập admin.
 */
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.ZALO_BOT_SECRET ?? "";
  const token = process.env.ZALO_BOT_TOKEN ?? "";

  return NextResponse.json({
    ZALO_BOT_SECRET: {
      defined: !!secret,
      length: secret.length,
      preview: secret ? `${secret.slice(0, 4)}...${secret.slice(-2)}` : "(empty)",
    },
    ZALO_BOT_TOKEN: {
      defined: !!token,
      length: token.length,
      preview: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : "(empty)",
    },
    NODE_ENV: process.env.NODE_ENV,
  });
}
