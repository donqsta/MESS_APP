import { NextRequest, NextResponse } from "next/server";
import { syncProjectsFromGetfly, getProjects, updateProject } from "@/lib/projectMatcher";

export async function POST(req: NextRequest) {
  let fillEmpty = false;
  try {
    const body = await req.json().catch(() => ({})) as { fillEmpty?: boolean };
    fillEmpty = !!body.fillEmpty;
  } catch { /* ignore */ }

  try {
    const result = await syncProjectsFromGetfly({ fillEmptyKeywords: fillEmpty });
    const total = getProjects().length;
    const hasChanges = result.added.length > 0 || result.updated.length > 0 || result.filled.length > 0;
    const parts: string[] = [];
    if (result.added.length)  parts.push(`${result.added.length} thêm mới`);
    if (result.updated.length) parts.push(`${result.updated.length} cập nhật tên`);
    if (result.filled.length)  parts.push(`${result.filled.length} bổ sung keywords`);

    return NextResponse.json({
      success: true,
      ...result,
      total,
      message: hasChanges
        ? `Đã sync: ${parts.join(", ")}.`
        : "Không có thay đổi, projects.json đã đồng bộ.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SyncProjects] Lỗi:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const projects = getProjects();
  return NextResponse.json({
    total: projects.length,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      keywords: p.keywords,
      domains: p.domains,
      pageIds: p.pageIds ?? [],
    })),
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { id: number; keywords: string[]; domains: string[]; pageIds?: string[] };
    if (typeof body.id !== "number") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await updateProject(body.id, {
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String).filter(Boolean) : undefined,
      domains:  Array.isArray(body.domains)  ? body.domains.map(String).filter(Boolean)  : undefined,
      pageIds:  Array.isArray(body.pageIds)  ? body.pageIds.map(String).filter(Boolean)   : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
