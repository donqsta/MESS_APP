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

import { getCandidates, advanceState, withProjectLock, markOffered, releaseOffer, Employee } from "./lead-distributor";
import { pingEmployee, waitForOnline, notifyLeadAssigned, notifyGroupLeadAccepted } from "./zalo-bot";
import { matchProject } from "./projectMatcher";
import { assignGetflyAccountOwner } from "./getfly";
import { getGroupByProject } from "./zalo-groups";

const ZALO_TIMEOUT_MS = 60_000;

export interface LeadDetails {
  name: string;
  phone: string;
  projectId?: string | number;
  projectName?: string;
  summary: string;
  pageUrl?: string;
  /** Getfly account ID — dùng để gán người phụ trách sau khi nhân viên accept */
  getflyAccountId?: number;
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

  // Lấy candidates trong lock để tránh race condition khi nhiều lead vào cùng lúc
  const candidates = await withProjectLock(String(projectId), async () => getCandidates(projectId));
  if (candidates.length === 0) {
    console.log(`[distributor] Không có nhân viên nào cho project=${projectId}`);
    return;
  }

  const leadSummary = `${details.name || "Khách"} | ${details.phone}${details.projectName ? ` | ${details.projectName}` : ""}\n${details.summary}`;

  // Dedup: mỗi NV chỉ được ping 1 lần dù xuất hiện ở nhiều nhóm
  const pingedIds = new Set<string>();

  for (const employee of candidates) {
    if (pingedIds.has(employee.id)) {
      console.log(`[distributor] Bỏ qua ${employee.name} — đã ping ở nhóm trước`);
      continue;
    }
    pingedIds.add(employee.id);

    // Đánh dấu NV đang được ping — các lead khác sẽ bỏ qua người này
    markOffered(String(projectId), employee.id);
    console.log(`[distributor] Ping ${employee.name} (zalo=${employee.zaloId}) cho project=${projectId}`);

    try {
      const sent = await pingEmployee(employee, leadSummary);
      if (!sent) {
        releaseOffer(String(projectId), employee.id);
        console.log(`[distributor] Gửi ping thất bại cho ${employee.name}, thử người tiếp theo`);
        continue;
      }

      const online = await waitForOnline(employee, ZALO_TIMEOUT_MS);
      releaseOffer(String(projectId), employee.id);

      if (online) {
        await withProjectLock(String(projectId), async () => advanceState(projectId, employee.id));
        console.log(`[distributor] ${employee.name} online → gán phụ trách + gửi chi tiết lead`);
        // Gán người phụ trách trên Getfly CRM
        if (details.getflyAccountId && employee.getflyUserId) {
          await assignGetflyAccountOwner(details.getflyAccountId, employee.getflyUserId);
        }
        // Thông báo chi tiết cho nhân viên (DM)
        await notifyLeadAssigned(employee, details);
        // Thông báo lên nhóm Zalo của dự án (nếu có)
        const group = getGroupByProject(String(projectId));
        if (group) {
          await notifyGroupLeadAccepted(group.groupId, employee, details);
          console.log(`[distributor] Đã thông báo nhóm "${group.groupName}" (${group.groupId})`);
        }
        return;
      }
    } catch (e) {
      releaseOffer(String(projectId), employee.id);
      throw e;
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

  const pingedIds = new Set<string>();
  for (const employee of candidates) {
    if (pingedIds.has(employee.id)) continue;
    pingedIds.add(employee.id);

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
