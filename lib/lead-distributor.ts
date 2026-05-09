/**
 * Lead Distributor — phân chia lead theo nhóm/nhân viên.
 *
 * Thuật toán:
 *  - Groups: round-robin giữa các nhóm của 1 dự án
 *  - Members: weighted round-robin trong nhóm
 *    → Chọn người có tỷ lệ count/weight thấp nhất (ít được chia nhất so với ưu tiên)
 *
 * Persistence: data/lead-distribution.json (config + state)
 */

import fs from "fs";
import path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  name: string;
  getflyUserId: number;
  zaloId: string;
  active: boolean;
  phone?: string;      // SĐT lấy từ Getfly (contact_mobile)
  position?: string;   // Phòng ban / chức danh (dept_name từ Getfly)
  /** Admin có thể đăng ký nhóm Zalo bằng lệnh setgroup trong nhóm */
  isAdmin?: boolean;
}

export interface GroupMember {
  employeeId: string;
  weight: number; // 1–10, tỷ lệ nhận lead so với người khác trong nhóm
}

export interface Group {
  id: string;
  name: string;
  /** Tỷ lệ % nhóm nhận lead so với các nhóm khác trong dự án (ví dụ: 30, 40, 60) */
  weight: number;
  members: GroupMember[];
}

export interface ProjectDistribution {
  groups: Group[];
}

interface GroupState {
  counts: Record<string, number>; // employeeId → số lần đã nhận lead
}

interface ProjectState {
  /** số lead đã nhận theo groupId — dùng cho weighted round-robin giữa các nhóm */
  groupCounts: Record<string, number>;
  groups: Record<string, GroupState>; // groupId → state
}

export interface DistributionConfig {
  employees: Employee[];
  projects: Record<string, ProjectDistribution>; // key = projectId (string)
  state: Record<string, ProjectState>; // key = projectId (string)
}

// ── File I/O ──────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), "data", "lead-distribution.json");

export function loadConfig(): DistributionConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return emptyConfig();
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DistributionConfig>;
    return {
      employees: parsed.employees ?? [],
      projects: parsed.projects ?? {},
      state: parsed.state ?? {},
    };
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: DistributionConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("[lead-distributor] Không thể ghi config:", e);
  }
}

function emptyConfig(): DistributionConfig {
  return { employees: [], projects: {}, state: {} };
}

// ── Active offers (ngăn ping 2 lead cho cùng 1 NV) ───────────────────────────

/**
 * Theo dõi NV đang được ping cho 1 lead khác — in-process, reset khi restart.
 * getCandidates sẽ bỏ qua NV này, tránh 2 lead cùng ping 1 người.
 */
const activeOffers = new Map<string, Set<string>>(); // projectId → Set<employeeId>

export function markOffered(projectId: string, employeeId: string): void {
  const pid = String(projectId);
  if (!activeOffers.has(pid)) activeOffers.set(pid, new Set());
  activeOffers.get(pid)!.add(employeeId);
}

export function releaseOffer(projectId: string, employeeId: string): void {
  activeOffers.get(String(projectId))?.delete(employeeId);
}

export function getActiveOffers(projectId: string): Set<string> {
  return activeOffers.get(String(projectId)) ?? new Set();
}

/**
 * Số NV đang được ping (offered) theo groupId.
 * Dùng để điều chỉnh ratio chọn nhóm khi nhiều lead vào cùng lúc,
 * tránh pile-up vào cùng 1 nhóm trước khi ai accept.
 */
export function getGroupPendingCounts(
  projectId: string,
  groups: Group[]
): Record<string, number> {
  const offered = getActiveOffers(projectId);
  const result: Record<string, number> = {};
  for (const g of groups) {
    result[g.id] = g.members.filter((m) => offered.has(m.employeeId)).length;
  }
  return result;
}

// ── In-process mutex (ngăn race condition khi nhiều lead vào cùng lúc) ────────

/**
 * Hàng đợi promise per-project. Mỗi advanceState phải chờ lần trước hoàn tất
 * trước khi đọc + ghi state, đảm bảo thứ tự chính xác.
 */
const projectLocks = new Map<string, Promise<void>>();

export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  let resolveLock!: () => void;
  const lockPromise = new Promise<void>((r) => { resolveLock = r; });
  projectLocks.set(projectId, lockPromise);

  return prev.then(() => fn()).finally(() => resolveLock());
}

// ── Employee lookup ───────────────────────────────────────────────────────────

export function getEmployee(id: string): Employee | undefined {
  return loadConfig().employees.find((e) => e.id === id);
}

export function getEmployeeByZaloId(zaloId: string): Employee | undefined {
  return loadConfig().employees.find((e) => e.zaloId === zaloId);
}

// ── Weighted round-robin selection ────────────────────────────────────────────

/**
 * Chọn nhân viên kế tiếp trong nhóm dựa theo weighted round-robin.
 * Người có count/weight thấp nhất sẽ được chọn.
 * Chỉ xét nhân viên active.
 */
function pickFromGroup(
  group: Group,
  groupState: GroupState,
  employees: Employee[]
): Employee | null {
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const activeMembers = group.members.filter((m) => {
    const emp = empMap.get(m.employeeId);
    return emp?.active && m.weight > 0;
  });

  if (activeMembers.length === 0) return null;

  // Tìm người có count/weight thấp nhất
  let best: GroupMember | null = null;
  let bestRatio = Infinity;

  for (const member of activeMembers) {
    const count = groupState.counts[member.employeeId] ?? 0;
    const ratio = count / member.weight;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = member;
    }
  }

  if (!best) return null;
  return empMap.get(best.employeeId) ?? null;
}

/**
 * Trả về danh sách nhân viên theo thứ tự ưu tiên cho projectId.
 * Dùng để thử lần lượt khi check online.
 *
 * - Nhóm được sắp xếp theo weighted RR (nhóm ưu tiên cao nhất trước).
 * - Nếu tất cả NV trong nhóm không phản hồi, tự động thử nhóm kế tiếp.
 * - Không thay đổi state — state chỉ cập nhật sau khi assign thành công.
 */
export function getCandidates(projectId: string | number): Employee[] {
  const config = loadConfig();
  const pid = String(projectId);
  const projectDist = config.projects[pid];
  if (!projectDist || projectDist.groups.length === 0) return [];

  const projectState = config.state[pid] ?? { groupCounts: {}, groups: {} };
  const groupCounts = projectState.groupCounts ?? {};
  const empMap = new Map(config.employees.map((e) => [e.id, e]));
  const offered = getActiveOffers(pid);

  // Cộng thêm số NV đang được ping vào count để tránh pile-up khi nhiều lead vào cùng lúc
  const pendingCounts = getGroupPendingCounts(pid, projectDist.groups);

  // Sắp xếp nhóm theo weighted RR ratio tăng dần (ưu tiên nhất trước)
  const sortedGroups = [...projectDist.groups].sort((a, b) => {
    const ra = ((groupCounts[a.id] ?? 0) + (pendingCounts[a.id] ?? 0)) / (a.weight ?? 1);
    const rb = ((groupCounts[b.id] ?? 0) + (pendingCounts[b.id] ?? 0)) / (b.weight ?? 1);
    return ra - rb;
  });

  const result: Employee[] = [];
  for (const group of sortedGroups) {
    const groupState: GroupState = projectState.groups[group.id] ?? { counts: {} };

    // Sắp xếp NV trong nhóm theo count/weight ratio tăng dần
    const activeMembers = group.members
      .filter((m) => {
        const emp = empMap.get(m.employeeId);
        // Bỏ qua NV đang được ping cho lead khác
        return emp?.active && m.weight > 0 && !offered.has(m.employeeId);
      })
      .sort((a, b) => {
        const ra = (groupState.counts[a.employeeId] ?? 0) / a.weight;
        const rb = (groupState.counts[b.employeeId] ?? 0) / b.weight;
        return ra - rb;
      });

    for (const m of activeMembers) {
      const emp = empMap.get(m.employeeId);
      if (emp) result.push(emp);
    }
  }

  return result;
}

/**
 * Cập nhật state sau khi lead được assign thành công cho employee.
 * Tìm nhóm chứa employee (không re-run weighted RR) để xử lý đúng
 * khi employee đến từ nhóm fallback (nhóm 1 không phản hồi → nhóm 2 nhận).
 */
export function advanceState(projectId: string | number, employeeId: string): void {
  const config = loadConfig();
  const pid = String(projectId);
  const projectDist = config.projects[pid];
  if (!projectDist) return;

  if (!config.state[pid]) {
    config.state[pid] = { groupCounts: {}, groups: {} };
  }
  const projectState = config.state[pid];

  // Tìm nhóm chứa employee này
  const group = projectDist.groups.find((g) =>
    g.members.some((m) => m.employeeId === employeeId)
  );
  if (!group) return;

  // Tăng count nhóm
  if (!projectState.groupCounts) projectState.groupCounts = {};
  projectState.groupCounts[group.id] = (projectState.groupCounts[group.id] ?? 0) + 1;

  // Tăng count nhân viên trong nhóm
  if (!projectState.groups[group.id]) {
    projectState.groups[group.id] = { counts: {} };
  }
  const groupState = projectState.groups[group.id];
  groupState.counts[employeeId] = (groupState.counts[employeeId] ?? 0) + 1;

  saveConfig(config);
  console.log(
    `[lead-distributor] Assigned: project=${pid} group=${group.name}(w=${group.weight ?? 1}) employee=${employeeId} groupCount=${projectState.groupCounts[group.id]} memberCount=${groupState.counts[employeeId]}`
  );
}

// ── Config mutations ──────────────────────────────────────────────────────────

export function upsertEmployee(emp: Employee): void {
  const config = loadConfig();
  const idx = config.employees.findIndex((e) => e.id === emp.id);
  if (idx >= 0) {
    config.employees[idx] = emp;
  } else {
    config.employees.push(emp);
  }
  saveConfig(config);
}

export function deleteEmployee(id: string): void {
  const config = loadConfig();
  config.employees = config.employees.filter((e) => e.id !== id);
  // Xóa khỏi tất cả groups
  for (const dist of Object.values(config.projects)) {
    for (const group of dist.groups) {
      group.members = group.members.filter((m) => m.employeeId !== id);
    }
  }
  saveConfig(config);
}

export function setProjectDistribution(
  projectId: string | number,
  dist: ProjectDistribution
): void {
  const config = loadConfig();
  const pid = String(projectId);
  config.projects[pid] = dist;
  // Reset state cho project này
  config.state[pid] = { groupCounts: {}, groups: {} };
  saveConfig(config);
}

export function resetProjectState(projectId: string | number): void {
  const config = loadConfig();
  const pid = String(projectId);
  config.state[pid] = { groupCounts: {}, groups: {} };
  saveConfig(config);
}
