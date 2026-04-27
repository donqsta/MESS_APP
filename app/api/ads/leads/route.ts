import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAdLeads } from "@/lib/ad-store";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.userToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pageId = req.nextUrl.searchParams.get("pageId") ?? undefined;
  return NextResponse.json({ leads: getAdLeads(pageId) });
}
