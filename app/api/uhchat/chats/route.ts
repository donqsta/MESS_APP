import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getStoredLeads } from "@/lib/uhchat-store";

/**
 * GET /api/uhchat/chats
 * Trả về danh sách leads từ uhchat đã được lưu trong store.
 * Dashboard gọi route này để hiển thị dữ liệu.
 */
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = getStoredLeads();

  return NextResponse.json({
    leads,
    total: leads.length,
    timestamp: new Date().toISOString(),
  });
}
