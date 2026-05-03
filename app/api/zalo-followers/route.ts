import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAllMappings, deleteMapping, registerEmployee } from "@/lib/zalo-employee-registry";

const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN ?? "";
const ZALO_API_BASE = "https://openapi.zalo.me/v2.0/oa";

interface ZaloFollower {
  user_id: string;
  display_name: string;
  avatar: string;
  is_sensitive: boolean;
}

/**
 * GET /api/zalo-followers
 * Lấy danh sách người theo dõi OA từ Zalo API.
 * Dùng để match tên nhân viên → Zalo ID.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!ZALO_BOT_TOKEN) {
    return NextResponse.json({ error: "Chưa cấu hình ZALO_BOT_TOKEN" }, { status: 400 });
  }

  const offset = req.nextUrl.searchParams.get("offset") ?? "0";
  const count = req.nextUrl.searchParams.get("count") ?? "50";

  try {
    // Bước 1: Lấy danh sách user_id từ /getfollowers
    const listRes = await fetch(
      `${ZALO_API_BASE}/getfollowers?data=${encodeURIComponent(JSON.stringify({ offset: Number(offset), count: Number(count) }))}`,
      { headers: { access_token: ZALO_BOT_TOKEN } }
    );
    const listData = await listRes.json() as {
      error: number;
      message?: string;
      data?: { followers: Array<{ user_id: string }>; total: number };
    };

    if (listData.error !== 0 || !listData.data) {
      return NextResponse.json({ error: listData.message ?? "Lỗi Zalo API", code: listData.error }, { status: 502 });
    }

    const userIds = listData.data.followers.map((f) => f.user_id);
    const total = listData.data.total;

    // Bước 2: Lấy thông tin chi tiết từng user (batch 50)
    const detailRes = await fetch(
      `${ZALO_API_BASE}/getprofile?data=${encodeURIComponent(JSON.stringify({ user_id: userIds[0] ?? "" }))}`,
      { headers: { access_token: ZALO_BOT_TOKEN } }
    );

    // Lấy thông tin từng follower (Zalo không hỗ trợ batch profile — lấy list cơ bản)
    const followers: ZaloFollower[] = userIds.map((id) => ({
      user_id: id,
      display_name: "",
      avatar: "",
      is_sensitive: false,
    }));

    // Thử lấy chi tiết user đầu tiên để xem cấu trúc
    if (userIds.length > 0) {
      try {
        const detail = await detailRes.json() as {
          error: number;
          data?: { user_id: string; display_name: string; avatar: string; is_sensitive: boolean };
        };
        if (detail.error === 0 && detail.data) {
          followers[0] = detail.data;
        }
      } catch { /* ignore */ }
    }

    // Lấy mappings đã đăng ký
    const registeredMappings = getAllMappings();

    return NextResponse.json({ followers, total, offset: Number(offset), registeredMappings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/zalo-followers
 * Lưu mapping phone → zaloId thủ công, hoặc xóa mapping.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const body = await req.json() as { action: string; phone?: string; zaloId?: string };

  if (body.action === "register" && body.phone && body.zaloId) {
    registerEmployee(body.phone, body.zaloId);
    return NextResponse.json({ success: true });
  }

  if (body.action === "delete" && body.phone) {
    deleteMapping(body.phone);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Action không hợp lệ" }, { status: 400 });
}
