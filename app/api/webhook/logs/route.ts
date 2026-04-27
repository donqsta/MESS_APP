import { NextResponse } from "next/server";
import { getLogs, clearLogs } from "@/lib/webhook-log";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ logs: getLogs() });
}

export async function DELETE() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  clearLogs();
  return NextResponse.json({ cleared: true });
}
