import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPagesFromEnv } from "@/lib/pages";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  return NextResponse.json({ pages: getPagesFromEnv() });
}
