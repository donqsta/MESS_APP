import { NextRequest, NextResponse } from "next/server";
import { assignContentToProject } from "@/lib/projectMatcher";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { kind?: string; id?: string; projectId?: number | null };
    if ((body.kind !== "post" && body.kind !== "ad") || !body.id) {
      return NextResponse.json({ success: false, error: "kind (post|ad) và id là bắt buộc" }, { status: 400 });
    }
    const projectId = typeof body.projectId === "number" ? body.projectId : null;
    assignContentToProject(body.kind, String(body.id), projectId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
