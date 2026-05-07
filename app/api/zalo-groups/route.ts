/**
 * /api/zalo-groups — CRUD quản lý nhóm Zalo và gắn với dự án.
 *
 * GET    /api/zalo-groups              → danh sách tất cả nhóm
 * POST   /api/zalo-groups              → thêm nhóm thủ công { groupId, groupName }
 * PATCH  /api/zalo-groups              → gắn / bỏ nhóm khỏi dự án { groupId, projectId? }
 * DELETE /api/zalo-groups?groupId=xxx  → xóa nhóm
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getAllGroups,
  saveZaloGroup,
  linkGroupToProject,
  unlinkGroupFromProject,
  deleteZaloGroup,
} from "@/lib/zalo-groups";

async function requireAuth(): Promise<boolean> {
  const session = await getSession();
  return session.isLoggedIn === true;
}

// GET — list all groups
export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ groups: getAllGroups() });
}

// POST — add group manually
export async function POST(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as { groupId?: string; groupName?: string };
  const { groupId, groupName } = body;
  if (!groupId || !groupName) {
    return NextResponse.json({ error: "groupId và groupName là bắt buộc" }, { status: 400 });
  }
  const group = saveZaloGroup(groupId.trim(), groupName.trim());
  return NextResponse.json({ ok: true, group });
}

// PATCH — link/unlink group to project
export async function PATCH(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as { groupId?: string; projectId?: string | null };
  const { groupId, projectId } = body;
  if (!groupId) {
    return NextResponse.json({ error: "groupId là bắt buộc" }, { status: 400 });
  }
  if (projectId) {
    const ok = linkGroupToProject(groupId, String(projectId));
    if (!ok) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ ok: true, linked: { groupId, projectId } });
  } else {
    const ok = unlinkGroupFromProject(groupId);
    if (!ok) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ ok: true, unlinked: groupId });
  }
}

// DELETE — remove group
export async function DELETE(req: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const groupId = req.nextUrl.searchParams.get("groupId") ?? "";
  if (!groupId) {
    return NextResponse.json({ error: "groupId là bắt buộc" }, { status: 400 });
  }
  const ok = deleteZaloGroup(groupId);
  if (!ok) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
