import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";
import { getAdLeads } from "@/lib/ad-store";
import { listPagePosts, listAdAccountAds, FBContentItem } from "@/lib/facebook";

/**
 * Danh sách bài viết / quảng cáo để gắn vào dự án Getfly.
 *   ?source=posts&pageId=...  → bài viết của Page (kèm dark post quảng cáo)
 *   ?source=ads               → quảng cáo từ FB_AD_ACCOUNT_IDS (token FB_ADS_TOKEN)
 *   ?source=leads[&pageId=]   → post/ad mà khách đã nhắn tin gần đây (webhook)
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const source = req.nextUrl.searchParams.get("source") ?? "posts";
  const pageId = req.nextUrl.searchParams.get("pageId") ?? undefined;
  const after = req.nextUrl.searchParams.get("after") ?? undefined;

  try {
    if (source === "posts") {
      if (!pageId) return NextResponse.json({ error: "Thiếu pageId" }, { status: 400 });
      const page = getPageFromEnv(pageId);
      if (!page) return NextResponse.json({ error: `Không có token cho page ${pageId}` }, { status: 404 });
      return NextResponse.json(await listPagePosts(pageId, page.accessToken, after));
    }

    if (source === "ads") {
      const accounts = (process.env.FB_AD_ACCOUNT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const token = process.env.FB_ADS_TOKEN?.trim();
      if (accounts.length === 0 || !token) {
        return NextResponse.json({
          items: [],
          error: "Chưa cấu hình FB_AD_ACCOUNT_IDS và FB_ADS_TOKEN (token có quyền ads_read) trong env",
        });
      }
      // after dạng "{accountIndex}:{cursor}" để phân trang qua nhiều tài khoản
      const [idxStr, cursor] = after ? after.split(":") : ["0", undefined];
      const idx = Number(idxStr) || 0;
      const res = await listAdAccountAds(accounts[idx], token, cursor || undefined);
      const next = res.next
        ? `${idx}:${res.next}`
        : idx + 1 < accounts.length ? `${idx + 1}:` : undefined;
      return NextResponse.json({ items: res.items, next });
    }

    if (source === "leads") {
      const byKey = new Map<string, FBContentItem & { leadCount: number }>();
      for (const lead of getAdLeads(pageId)) {
        const r = lead.referral;
        const entries: Array<["post" | "ad", string | undefined]> = [["post", r.post_id], ["ad", r.ad_id]];
        for (const [kind, id] of entries) {
          if (!id) continue;
          const key = `${kind}:${id}`;
          const existing = byKey.get(key);
          if (existing) { existing.leadCount++; continue; }
          byKey.set(key, {
            kind,
            id,
            text: [r.ad_title, r.post_text].filter(Boolean).join("\n"),
            picture: r.photo_url,
            permalink: kind === "post" ? `https://www.facebook.com/${id}` : undefined,
            createdTime: new Date(lead.timestamp).toISOString(),
            postId: kind === "ad" ? r.post_id : undefined,
            leadCount: 1,
          });
        }
      }
      return NextResponse.json({ items: [...byKey.values()] });
    }

    return NextResponse.json({ error: `source không hợp lệ: ${source}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ items: [], error: msg }, { status: 502 });
  }
}
