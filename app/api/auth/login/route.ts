import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPagesFromEnv } from "@/lib/pages";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const validUser = process.env.APP_USERNAME;
  const validPass = process.env.APP_PASSWORD;

  if (!validUser || !validPass) {
    return NextResponse.json(
      { error: "Server chưa cấu hình APP_USERNAME / APP_PASSWORD trong .env" },
      { status: 500 }
    );
  }

  if (username !== validUser || password !== validPass) {
    return NextResponse.json({ error: "Sai tên đăng nhập hoặc mật khẩu" }, { status: 401 });
  }

  const envPages = getPagesFromEnv();
  if (envPages.length === 0) {
    return NextResponse.json(
      { error: "Chưa cấu hình PAGE_TOKEN / PAGE_ID trong .env" },
      { status: 500 }
    );
  }

  const session = await getSession();
  session.isLoggedIn = true;
  session.userToken = "app_login";
  await session.save();

  return NextResponse.json({ success: true });
}
