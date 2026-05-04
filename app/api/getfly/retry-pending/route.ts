/**
 * /api/getfly/retry-pending
 *
 * Quản lý hàng chờ lead thất bại (data/pending-leads.json).
 *
 * GET  → Trả về danh sách leads đang chờ retry
 * POST → Retry toàn bộ hàng chờ, xóa lead nào tạo thành công
 */

import { NextResponse } from "next/server";
import { createGetflyLead, readPendingLeads, writePendingLeads } from "@/lib/getfly";
import type { PendingLead } from "@/lib/getfly";
import { getSession } from "@/lib/session";

// ── Auth guard ────────────────────────────────────────────────────────────────

async function isAuthenticated(): Promise<boolean> {
  try {
    const session = await getSession();
    return !!(session as Record<string, unknown>).username;
  } catch {
    return false;
  }
}

// ── GET: danh sách leads đang chờ ────────────────────────────────────────────

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = readPendingLeads();
  return NextResponse.json({
    count: leads.length,
    leads: leads.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      phone: l.input.phone.slice(0, 3) + "****" + l.input.phone.slice(-3),
      pageName: l.input.pageName,
      retryCount: l.retryCount,
      lastError: l.lastError,
    })),
  });
}

// ── POST: retry toàn bộ hàng chờ ─────────────────────────────────────────────

export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = readPendingLeads();
  if (leads.length === 0) {
    return NextResponse.json({ message: "Không có lead nào trong hàng chờ", succeeded: 0, failed: 0 });
  }

  const remaining: PendingLead[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const lead of leads) {
    console.log(`[retry-pending] Retrying lead ${lead.id} (phone: ${lead.input.phone.slice(0, 3)}***)`);
    const result = await createGetflyLead(lead.input);

    if (result.success) {
      succeeded++;
      console.log(`[retry-pending] ✓ Lead ${lead.id} tạo thành công`);
    } else {
      failed++;
      remaining.push({
        ...lead,
        retryCount: lead.retryCount + 1,
        lastError: { status: 0, message: result.error ?? "Lỗi không xác định" },
      });
      console.warn(`[retry-pending] ✗ Lead ${lead.id} vẫn thất bại: ${result.error}`);
    }
  }

  writePendingLeads(remaining);

  return NextResponse.json({
    message: `Retry hoàn tất: ${succeeded} thành công, ${failed} thất bại`,
    succeeded,
    failed,
    remainingCount: remaining.length,
  });
}
