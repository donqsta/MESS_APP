import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const GETFLY_BASE_URL = process.env.GETFLY_BASE_URL ?? "";
const GETFLY_API_KEY = process.env.GETFLY_API_KEY ?? "";

export interface GetflyUser {
  user_id: number;
  contact_name: string;
  user_name: string;
  dept_id: number;
  dept_name: string;
  email: string;
  contact_mobile: string;
}

/**
 * GET /api/getfly-users
 * Lấy danh sách nhân viên từ Getfly CRM.
 * Dùng để sync vào module phân chia lead.
 */
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!GETFLY_BASE_URL || !GETFLY_API_KEY) {
    return NextResponse.json({ error: "Chưa cấu hình Getfly" }, { status: 400 });
  }

  try {
    const users: GetflyUser[] = [];
    let offset = 0;
    const limit = 50;

    // Phân trang để lấy hết nhân viên
    while (true) {
      const url = `${GETFLY_BASE_URL}/api/v6.1/users?fields=user_id,contact_name,user_name,dept_id,dept_name,email,contact_mobile&limit=${limit}&offset=${offset}&filtering[valid]=1`;
      const res = await fetch(url, {
        headers: { "X-API-KEY": GETFLY_API_KEY },
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[getfly-users] API lỗi:", res.status, err.slice(0, 200));
        return NextResponse.json({ error: `Getfly API lỗi: ${res.status}` }, { status: 502 });
      }

      const data = await res.json() as { data: GetflyUser[]; has_more?: boolean };
      const batch = data.data ?? [];
      users.push(...batch);

      if (!data.has_more || batch.length < limit) break;
      offset += limit;
    }

    console.log(`[getfly-users] Lấy được ${users.length} nhân viên`);
    return NextResponse.json({ users, total: users.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[getfly-users] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
