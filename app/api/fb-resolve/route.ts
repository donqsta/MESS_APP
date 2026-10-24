import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Đổi link bài viết Facebook dạng mới (/posts/pfbid..., share link) thành Post ID số
 * bằng cách đọc thẻ og:url của trang công khai.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "URL không hợp lệ" }, { status: 400 });
  }
  if (!/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i.test(url.hostname)) {
    return NextResponse.json({ error: "Chỉ hỗ trợ link facebook.com" }, { status: 400 });
  }
  if (url.pathname.startsWith("/ads/library")) {
    return NextResponse.json({
      error:
        "Link Thư viện Quảng cáo chỉ có mã thư viện, không phải Ad ID thật — hãy dán link bài viết của quảng cáo, " +
        "hoặc gắn từ tab \"Khách vừa nhắn\" khi có khách nhắn từ quảng cáo đó",
    }, { status: 422 });
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
      redirect: "follow",
    });
    const html = await res.text();
    const ogUrl = html.match(/property="og:url"\s+content="([^"]+)"|og:url" content="([^"]+)"/);
    const candidates = [ogUrl?.[1] ?? ogUrl?.[2] ?? "", res.url];
    for (const c of candidates) {
      const m =
        c.match(/story_fbid=(\d{6,})/) ??
        c.match(/\/(?:posts|videos|photos|permalink|reel)\/(?:[^/?]+\/)*?(\d{6,})\/?(?:\?|$)/);
      if (m) return NextResponse.json({ id: m[1] });
    }
    return NextResponse.json({ error: "Không tìm thấy Post ID trong link (bài viết có thể không công khai)" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
