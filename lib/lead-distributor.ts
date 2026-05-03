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
}

export interface GroupMember {
  employeeId: string;
  weight: number; // 1–10, tỷ lệ nhận lead so với người khác trong nhóm
}

export interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

export interface ProjectDistribution {
  groups: Group[];
}

interface GroupState {
  counts: Record<string, number>; // employeeId → số lần đã nhận lead
}

interface ProjectState {
  groupIndex: number; // nhóm hiện tại (round-robin)
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

// ── Employee lookup ───────────────────────────────────────────────────────────

export function getEmployee(id: string): Employee | undefined {
  return loadConfig().employees.find((e) => e.id === id);
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
 * Trả về: [employee được chọn trước, các employee còn lại trong nhóm, ...]
 * Không thay đổi state — state chỉ được cập nhật sau khi assign thành công.
 */
export function getCandidates(projectId: string | number): Employee[] {
  const config = loadConfig();
  const pid = String(projectId);
  const projectDist = config.projects[pid];
  if (!projectDist || projectDist.groups.length === 0) return [];

  const projectState = config.state[pid] ?? {
    groupIndex: 0,
    groups: {},
  };

  const groups = projectDist.groups;
  const groupIndex = projectState.groupIndex % groups.length;
  const group = groups[groupIndex];
  if (!group) return [];

  const groupState: GroupState = projectState.groups[group.id] ?? { counts: {} };
  const empMap = new Map(config.employees.map((e) => [e.id, e]));

  // Sắp xếp active members theo count/weight ratio tăng dần
  const activeMembers = group.members
    .filter((m) => {
      const emp = empMap.get(m.employeeId);
      return emp?.active && m.weight > 0;
    })
    .sort((a, b) => {
      const ratioA = (groupState.counts[a.employeeId] ?? 0) / a.weight;
      const ratioB = (groupState.counts[b.employeeId] ?? 0) / b.weight;
      return ratioA - ratioB;
    });

  return activeMembers
    .map((m) => empMap.get(m.employeeId))
    .filter((e): e is Employee => !!e);
}

/**
 * Cập nhật state sau khi lead được assign thành công cho employee.
 * Tăng count của employee, advance group index nếu cần.
 */
export function advanceState(projectId: string | number, employeeId: string): void {
  const config = loadConfig();
  const pid = String(projectId);
  const projectDist = config.projects[pid];
  if (!projectDist) return;

  if (!config.state[pid]) {
    config.state[pid] = { groupIndex: 0, groups: {} };
  }
  const projectState = config.state[pid];
  const groups = projectDist.groups;
  const groupIndex = projectState.groupIndex % groups.length;
  const group = groups[groupIndex];
  if (!group) return;

  if (!projectState.groups[group.id]) {
    projectState.groups[group.id] = { counts: {} };
  }
  const groupState = projectState.groups[group.id];
  groupState.counts[employeeId] = (groupState.counts[employeeId] ?? 0) + 1;

  // Kiểm tra xem đã "hoàn thành vòng" trong nhóm này chưa
  // → advance group sau mỗi lần assign (round-robin giữa các nhóm)
  projectState.groupIndex = (groupIndex + 1) % groups.length;

  saveConfig(config);
  console.log(
    `[lead-distributor] Assigned: project=${pid} group=${group.name} employee=${employeeId} count=${groupState.counts[employeeId]}`
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
  config.state[pid] = { groupIndex: 0, groups: {} };
  saveConfig(config);
}

export function resetProjectState(projectId: string | number): void {
  const config = loadConfig();
  const pid = String(projectId);
  config.state[pid] = { groupIndex: 0, groups: {} };
  saveConfig(config);
}
