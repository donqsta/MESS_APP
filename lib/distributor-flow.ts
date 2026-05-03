/**
 * distributor-flow.ts — Điều phối phân chia lead cho nhân viên.
 *
 * Luồng (tạo lead trước, phân bổ sau — fire-and-forget):
 *  1. createGetflyLead() → tạo lead ngay lập tức (không bị chặn)
 *  2. distributeAfterCreate() → fire-and-forget sau khi lead tạo thành công:
 *       a. getCandidates(projectId) → danh sách ưu tiên
 *       b. Với mỗi NV: pingEmployee → waitForOnline(60s)
 *       c. NV đầu tiên online → advanceState + notifyLeadAssigned
 *       d. Nếu tất cả offline → chỉ log, lead vẫn đã tồn tại trên Getfly
 */

import { getCandidates, advanceState, Employee } from "./lead-distributor";
import { pingEmployee, waitForOnline, notifyLeadAssigned } from "./zalo-bot";
import { matchProject } from "./projectMatcher";

const ZALO_TIMEOUT_MS = 60_000;

export interface LeadDetails {
  name: string;
  phone: string;
  projectId?: string | number;
  projectName?: string;
  summary: string;
  pageUrl?: string;
}

/**
 * Gọi sau khi lead đã được tạo thành công trên Getfly.
 * Tự detect dự án nếu chưa có, sau đó ping lần lượt nhân viên cho đến khi
 * có người phản hồi hoặc hết danh sách.
 *
 * Hàm này nên được gọi fire-and-forget: distributeAfterCreate(...).catch(...)
 */
export async function distributeAfterCreate(details: LeadDetails): Promise<void> {
  // Resolve project ID nếu chưa có
  let projectId = details.projectId;
  if (!projectId && details.pageUrl) {
    const matched = await matchProject(details.pageUrl);
    if (matched) projectId = matched;
  }
  if (!projectId) {
    console.log("[distributor] Không xác định được dự án, bỏ qua phân bổ");
    return;
  }

  const candidates = getCandidates(projectId);
  if (candidates.length === 0) {
    console.log(`[distributor] Không có nhân viên nào cho project=${projectId}`);
    return;
  }

  const leadSummary = `${details.name || "Khách"} | ${details.phone}${details.projectName ? ` | ${details.projectName}` : ""}\n${details.summary}`;

  for (const employee of candidates) {
    console.log(`[distributor] Ping ${employee.name} (zalo=${employee.zaloId}) cho project=${projectId}`);

    const sent = await pingEmployee(employee, leadSummary);
    if (!sent) {
      console.log(`[distributor] Gửi ping thất bại cho ${employee.name}, thử người tiếp theo`);
      continue;
    }

    const online = await waitForOnline(employee, ZALO_TIMEOUT_MS);
    if (online) {
      advanceState(projectId, employee.id);
      console.log(`[distributor] ${employee.name} online → gửi chi tiết lead`);
      await notifyLeadAssigned(employee, details);
      return;
    }

    console.log(`[distributor] ${employee.name} không phản hồi sau ${ZALO_TIMEOUT_MS / 1000}s`);
  }

  console.log("[distributor] Tất cả nhân viên offline, lead không được phân bổ");
}

// ── Legacy helpers (vẫn export để tương thích) ───────────────────────────────

export async function assignLeadToEmployee(
  projectId: string | number,
  leadSummary: string
): Promise<Employee | null> {
  const candidates = getCandidates(projectId);
  if (candidates.length === 0) return null;

  for (const employee of candidates) {
    const sent = await pingEmployee(employee, leadSummary);
    if (!sent) continue;

    const online = await waitForOnline(employee, ZALO_TIMEOUT_MS);
    if (online) {
      advanceState(projectId, employee.id);
      return employee;
    }
  }
  return null;
}

export async function notifyEmployee(
  employee: Employee,
  leadDetails: { name: string; phone: string; project: string; summary: string }
): Promise<void> {
  try {
    await notifyLeadAssigned(employee, {
      name: leadDetails.name,
      phone: leadDetails.phone,
      projectName: leadDetails.project,
      summary: leadDetails.summary,
    });
  } catch (err) {
    console.warn("[distributor] Gửi thông báo Zalo thất bại:", err instanceof Error ? err.message : err);
  }
}
