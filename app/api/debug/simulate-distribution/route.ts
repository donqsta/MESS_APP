import { NextRequest, NextResponse } from "next/server";
import {
  loadConfig, saveConfig, getCandidates,
  markOffered, releaseOffer, getActiveOffers,
  withProjectLock,
} from "@/lib/lead-distributor";
import { getProjects } from "@/lib/projectMatcher";

/** Get current config + state + annotated candidate queue */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const config = loadConfig();

  if (projectId) {
    const pid = String(projectId);
    const candidates = getCandidates(pid);
    const dist = config.projects[pid];
    const offered = [...getActiveOffers(pid)];

    const annotated = candidates.map((emp) => {
      const group = dist?.groups.find((g) => g.members.some((m) => m.employeeId === emp.id));
      return { ...emp, groupId: group?.id ?? "", groupName: group?.name ?? "", groupWeight: group?.weight ?? 1 };
    });

    // Resolve project name from projectMatcher
    const projects = getProjects();
    const projectName = projects.find((p) => String(p.id) === pid)?.name ?? `Project #${pid}`;

    return NextResponse.json({ config, candidates: annotated, offered, projectName });
  }

  // Return project name map for the selector
  const projects = getProjects();
  const projectNames: Record<string, string> = {};
  for (const p of projects) projectNames[String(p.id)] = p.name;
  return NextResponse.json({ config, candidates: [], offered: [], projectNames });
}

/**
 * POST body shapes:
 *  { action: "reserve",  projectId }             → getCandidates (respecting offered) + markOffered → return candidate
 *  { action: "accept",   projectId, employeeId } → advanceState + releaseOffer
 *  { action: "release",  projectId, employeeId } → releaseOffer only (no response / skip)
 *  { action: "accept-auto", projectId }          → reserve + immediately accept (legacy bulk mode)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action = "accept-auto", projectId, employeeId } = body as {
    action?: string; projectId: string; employeeId?: string;
  };

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const pid = String(projectId);
  const config = loadConfig();
  const dist = config.projects[pid];
  if (!dist) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // ── reserve ──────────────────────────────────────────────────────────────
  if (action === "reserve") {
    // Atomic: lock → getCandidates (skips offered) → markOffered first candidate
    const result = await withProjectLock(pid, async () => {
      const candidates = getCandidates(pid);
      if (!candidates.length) return null;
      const emp = candidates[0];
      const group = dist.groups.find((g) => g.members.some((m) => m.employeeId === emp.id));
      markOffered(pid, emp.id);
      return { emp, group };
    });

    if (!result) return NextResponse.json({ error: "no available candidates" }, { status: 409 });

    return NextResponse.json({
      ok: true,
      employee: result.emp,
      group: result.group ? { id: result.group.id, name: result.group.name, weight: result.group.weight } : null,
    });
  }

  // ── accept ────────────────────────────────────────────────────────────────
  if (action === "accept") {
    if (!employeeId) return NextResponse.json({ error: "employeeId required" }, { status: 400 });
    const group = dist.groups.find((g) => g.members.some((m) => m.employeeId === employeeId));
    if (!group) return NextResponse.json({ error: "employee not in any group" }, { status: 400 });

    await withProjectLock(pid, async () => {
      const cfg = loadConfig();
      if (!cfg.state[pid]) cfg.state[pid] = { groupCounts: {}, groups: {} };
      const ps = cfg.state[pid];
      if (!ps.groupCounts) ps.groupCounts = {};
      ps.groupCounts[group.id] = (ps.groupCounts[group.id] ?? 0) + 1;
      if (!ps.groups[group.id]) ps.groups[group.id] = { counts: {} };
      ps.groups[group.id].counts[employeeId] = (ps.groups[group.id].counts[employeeId] ?? 0) + 1;
      saveConfig(cfg);
    });

    releaseOffer(pid, employeeId);
    return NextResponse.json({ ok: true, group: { id: group.id, name: group.name, weight: group.weight }, employeeId });
  }

  // ── release (no response) ─────────────────────────────────────────────────
  if (action === "release") {
    if (!employeeId) return NextResponse.json({ error: "employeeId required" }, { status: 400 });

    // skippedIds: danh sách NV đã bị bỏ qua trong lead này (gửi từ client)
    const skippedIds: string[] = Array.isArray(body.skippedIds) ? body.skippedIds : [];
    // Thêm NV vừa release vào danh sách loại trừ
    const excludeSet = new Set([...skippedIds, employeeId]);

    releaseOffer(pid, employeeId);

    // Tìm NV tiếp theo chưa bị thử cho lead này
    const nextCandidates = getCandidates(pid);
    const nextEmp = nextCandidates.find((e) => !excludeSet.has(e.id));
    if (nextEmp) {
      const group = dist.groups.find((g) => g.members.some((m) => m.employeeId === nextEmp.id));
      markOffered(pid, nextEmp.id);
      return NextResponse.json({ ok: true, next: { employee: nextEmp, group } });
    }
    return NextResponse.json({ ok: true, next: null });
  }

  // ── accept-auto (legacy: reserve + accept in one step) ────────────────────
  const candidates = getCandidates(pid);
  if (!candidates.length) return NextResponse.json({ error: "no candidates" }, { status: 400 });
  const emp = employeeId ? (candidates.find((e) => e.id === employeeId) ?? candidates[0]) : candidates[0];
  const group = dist.groups.find((g) => g.members.some((m) => m.employeeId === emp.id));
  if (!group) return NextResponse.json({ error: "employee not in any group" }, { status: 400 });

  await withProjectLock(pid, async () => {
    const cfg = loadConfig();
    if (!cfg.state[pid]) cfg.state[pid] = { groupCounts: {}, groups: {} };
    const ps = cfg.state[pid];
    if (!ps.groupCounts) ps.groupCounts = {};
    ps.groupCounts[group.id] = (ps.groupCounts[group.id] ?? 0) + 1;
    if (!ps.groups[group.id]) ps.groups[group.id] = { counts: {} };
    ps.groups[group.id].counts[emp.id] = (ps.groups[group.id].counts[emp.id] ?? 0) + 1;
    saveConfig(cfg);
  });

  return NextResponse.json({ ok: true, group: { id: group.id, name: group.name, weight: group.weight }, employeeId: emp.id });
}

/** Reset simulation state for a project */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const config = loadConfig();
  config.state[projectId] = { groupCounts: {}, groups: {} };
  saveConfig(config);
  // Also clear active offers for this project
  const { getActiveOffers: _get } = await import("@/lib/lead-distributor");
  const offered = [..._get(projectId)];
  offered.forEach((eid) => releaseOffer(projectId, eid));
  return NextResponse.json({ ok: true });
}
