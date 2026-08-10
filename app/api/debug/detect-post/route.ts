import { NextRequest, NextResponse } from "next/server";
import { getFBPostContent } from "@/lib/facebook";
import { matchProject, getProjects } from "@/lib/projectMatcher";
import { getPageFromEnv } from "@/lib/pages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { postId, adId, postText, pageId } = body as {
      postId?: string;
      adId?: string;
      postText?: string;
      pageId?: string;
    };

    let textToAnalyze = postText?.trim() ?? "";
    let source = "direct_input";

    const pageToken = pageId
      ? getPageFromEnv(pageId)?.accessToken
      : process.env.FB_PAGE_TOKEN;

    if (!textToAnalyze && (postId || adId)) {
      if (!pageToken) {
        return NextResponse.json(
          {
            success: false,
            error: "Thiếu Page Access Token (truyền pageId có cấu hình token hoặc đặt FB_PAGE_TOKEN trong env)",
          },
          { status: 400 }
        );
      }

      source = postId ? `facebook_post:${postId}` : `facebook_ad:${adId}`;
      const fetched = await getFBPostContent({ post_id: postId, ad_id: adId }, pageToken);
      if (fetched) {
        textToAnalyze = fetched;
      }
    }

    if (!textToAnalyze) {
      return NextResponse.json(
        {
          success: false,
          error: "Không trích xuất được nội dung bài viết/quảng cáo. Hãy kiểm tra postId/adId hoặc quyền Token.",
        },
        { status: 404 }
      );
    }

    // Match dự án bằng Keyword & AI Fallback
    const projectId = await matchProject(textToAnalyze);
    const projects = getProjects();
    const matchedProject = projects.find((p) => p.id === projectId);

    return NextResponse.json({
      success: true,
      source,
      extractedPostText: textToAnalyze,
      detectedProjectId: projectId,
      detectedProjectName: matchedProject?.name ?? null,
      matchedKeywords: matchedProject?.keywords ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
