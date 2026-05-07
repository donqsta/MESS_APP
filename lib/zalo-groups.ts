/**
 * zalo-groups.ts
 *
 * Lưu trữ mapping Zalo Group ↔ Dự án.
 * Admin đăng ký nhóm bằng cách tag bot trong nhóm và gửi lệnh:
 *   setgroup [tên nhóm]
 * Bot lưu groupId + tên nhóm, admin sau đó gắn nhóm với dự án qua UI.
 *
 * File: data/zalo-groups.json
 */

import fs from "fs";
import path from "path";

const GROUPS_FILE = path.join(process.cwd(), "data", "zalo-groups.json");

export interface ZaloGroup {
  groupId: string;
  groupName: string;
  /** projectId (string) từ lead-distribution — undefined nếu chưa gắn */
  projectId?: string;
  registeredAt: string; // ISO timestamp
}

interface GroupsStore {
  groups: ZaloGroup[];
}

function loadStore(): GroupsStore {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return { groups: [] };
    return JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8")) as GroupsStore;
  } catch {
    return { groups: [] };
  }
}

function saveStore(store: GroupsStore): void {
  const dir = path.dirname(GROUPS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/** Lưu hoặc cập nhật nhóm (upsert theo groupId). */
export function saveZaloGroup(groupId: string, groupName: string): ZaloGroup {
  const store = loadStore();
  const existing = store.groups.find((g) => g.groupId === groupId);
  if (existing) {
    existing.groupName = groupName;
    saveStore(store);
    console.log(`[zalo-groups] Cập nhật nhóm: id=${groupId} name="${groupName}"`);
    return existing;
  }
  const group: ZaloGroup = { groupId, groupName, registeredAt: new Date().toISOString() };
  store.groups.push(group);
  saveStore(store);
  console.log(`[zalo-groups] Đăng ký nhóm mới: id=${groupId} name="${groupName}"`);
  return group;
}

/** Gắn nhóm với dự án. */
export function linkGroupToProject(groupId: string, projectId: string): boolean {
  const store = loadStore();
  const group = store.groups.find((g) => g.groupId === groupId);
  if (!group) return false;
  group.projectId = projectId;
  saveStore(store);
  console.log(`[zalo-groups] Gắn nhóm ${groupId} → project=${projectId}`);
  return true;
}

/** Bỏ liên kết nhóm với dự án. */
export function unlinkGroupFromProject(groupId: string): boolean {
  const store = loadStore();
  const group = store.groups.find((g) => g.groupId === groupId);
  if (!group) return false;
  delete group.projectId;
  saveStore(store);
  return true;
}

/** Lấy groupId của nhóm gắn với projectId. */
export function getGroupByProject(projectId: string): ZaloGroup | undefined {
  return loadStore().groups.find((g) => g.projectId === String(projectId));
}

/** Lấy nhóm theo groupId. */
export function getGroupById(groupId: string): ZaloGroup | undefined {
  return loadStore().groups.find((g) => g.groupId === groupId);
}

/** Danh sách tất cả nhóm đã đăng ký. */
export function getAllGroups(): ZaloGroup[] {
  return loadStore().groups;
}

/** Xóa nhóm theo groupId. */
export function deleteZaloGroup(groupId: string): boolean {
  const store = loadStore();
  const before = store.groups.length;
  store.groups = store.groups.filter((g) => g.groupId !== groupId);
  if (store.groups.length === before) return false;
  saveStore(store);
  return true;
}
