"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Plus, Trash2, ChevronLeft, Save, RefreshCw, Bell, X, Check, AlertCircle, Download, Search } from "lucide-react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  getflyUserId: number;
  zaloId: string;
  active: boolean;
  phone?: string;
  position?: string; // Phòng ban / chức danh
}

interface GetflyUser {
  user_id: number;
  contact_name: string;
  user_name: string;
  dept_name: string;
  dept_id: number;
  contact_mobile: string;
  email: string;
}

interface ZaloFollower {
  user_id: string;
  display_name: string;
  avatar: string;
}

interface ZaloMapping {
  phone: string;
  zaloId: string;
}

interface GroupMember {
  employeeId: string;
  weight: number;
}

interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

interface ProjectDistribution {
  groups: Group[];
}

interface GroupState {
  counts: Record<string, number>;
}

interface ProjectState {
  groupIndex: number;
  groups: Record<string, GroupState>;
}

interface DistributionConfig {
  employees: Employee[];
  projects: Record<string, ProjectDistribution>;
  state: Record<string, ProjectState>;
}

interface ProjectEntry {
  id: number;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function apiPost(action: string, extra: object = {}) {
  const res = await fetch("/api/lead-distribution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json();
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DistributionPage() {
  const [config, setConfig] = useState<DistributionConfig | null>(null);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Employee form state
  const [empForm, setEmpForm] = useState<Employee>({ id: "", name: "", getflyUserId: 0, zaloId: "", active: true, phone: "", position: "" });
  const [editEmpId, setEditEmpId] = useState<string | null>(null);

  // Getfly sync
  const [getflyUsers, setGetflyUsers] = useState<GetflyUser[]>([]);
  const [loadingGetfly, setLoadingGetfly] = useState(false);
  const [showGetflySync, setShowGetflySync] = useState(false);
  const [selectedGetflyIds, setSelectedGetflyIds] = useState<Set<number>>(new Set());

  // Zalo followers
  const [zaloFollowers, setZaloFollowers] = useState<ZaloFollower[]>([]);
  const [zaloMappings, setZaloMappings] = useState<ZaloMapping[]>([]);
  const [loadingZalo, setLoadingZalo] = useState(false);
  const [showZaloPanel, setShowZaloPanel] = useState(false);
  const [zaloSearchPhone, setZaloSearchPhone] = useState("");
  const [zaloSearchName, setZaloSearchName] = useState("");

  // Active project tab
  const [activeProject, setActiveProject] = useState<string | null>(null);

  // Ping status per employee
  const [pinging, setPinging] = useState<Record<string, boolean>>({});

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, projRes] = await Promise.all([
        fetch("/api/lead-distribution").then((r) => r.json()),
        fetch("/api/bot/sync-projects").then((r) => r.json()),
      ]);
      setConfig(cfgRes as DistributionConfig);
      const allProjects: ProjectEntry[] = (projRes.projects ?? []).filter((p: ProjectEntry) => p.id !== 41);
      setProjects(allProjects);
      if (!activeProject && allProjects.length > 0) {
        setActiveProject(String(allProjects[0].id));
      }
    } catch {
      showToast("Không thể tải dữ liệu", false);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Getfly sync ─────────────────────────────────────────────────────────────

  async function fetchGetflyUsers() {
    setLoadingGetfly(true);
    try {
      const res = await fetch("/api/getfly-users");
      const data = await res.json() as { users?: GetflyUser[]; error?: string };
      if (data.error) { showToast(data.error, false); return; }
      setGetflyUsers(data.users ?? []);
      // Pre-select users not yet in config
      const existingIds = new Set((config?.employees ?? []).map((e) => e.getflyUserId));
      setSelectedGetflyIds(new Set((data.users ?? []).filter((u) => !existingIds.has(u.user_id)).map((u) => u.user_id)));
      setShowGetflySync(true);
    } catch {
      showToast("Không thể kết nối Getfly", false);
    } finally {
      setLoadingGetfly(false);
    }
  }

  async function importSelectedGetflyUsers() {
    setSaving(true);
    try {
      const toImport = getflyUsers.filter((u) => selectedGetflyIds.has(u.user_id));
      for (const u of toImport) {
        const emp: Employee = {
          id: `getfly_${u.user_id}`,
          name: u.contact_name,
          getflyUserId: u.user_id,
          zaloId: zaloMappings.find((m) => m.phone === normalizePhone(u.contact_mobile))?.zaloId ?? "",
          active: true,
          phone: u.contact_mobile ? normalizePhone(u.contact_mobile) : "",
          position: u.dept_name ?? "",
        };
        await apiPost("upsert_employee", { employee: emp });
      }
      showToast(`Đã import ${toImport.length} nhân viên`);
      setShowGetflySync(false);
      await loadAll();
      // Reload Zalo mappings if panel open
      if (showZaloPanel) await fetchZaloFollowers();
    } finally {
      setSaving(false);
    }
  }

  // ── Zalo follower lookup ─────────────────────────────────────────────────────

  async function fetchZaloFollowers() {
    setLoadingZalo(true);
    try {
      const res = await fetch("/api/zalo-followers");
      const data = await res.json() as {
        followers?: ZaloFollower[];
        registeredMappings?: ZaloMapping[];
        error?: string;
      };
      if (data.error) { showToast(data.error, false); return; }
      setZaloFollowers(data.followers ?? []);
      setZaloMappings(data.registeredMappings ?? []);
      setShowZaloPanel(true);
    } catch {
      showToast("Không thể tải followers Zalo", false);
    } finally {
      setLoadingZalo(false);
    }
  }

  async function saveZaloMapping(phone: string, zaloId: string) {
    const res = await fetch("/api/zalo-followers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", phone, zaloId }),
    });
    const data = await res.json() as { success?: boolean };
    if (data.success) {
      showToast(`Đã lưu: ${phone} → ${zaloId}`);
      setZaloMappings((prev) => {
        const filtered = prev.filter((m) => m.phone !== phone);
        return [...filtered, { phone, zaloId }];
      });
      // Nếu nhân viên trong config có SĐT trùng → cập nhật zaloId
      if (config) {
        const updated = config.employees.map((e) => {
          const emp = getflyUsers.find((u) => u.user_id === e.getflyUserId);
          if (emp && normalizePhone(emp.contact_mobile) === normalizePhone(phone)) {
            return { ...e, zaloId };
          }
          return e;
        });
        if (JSON.stringify(updated) !== JSON.stringify(config.employees)) {
          const newConfig = { ...config, employees: updated };
          setConfig(newConfig);
          await apiPost("save_full_config", { config: newConfig });
        }
      }
    }
  }

  // ── Employee CRUD ───────────────────────────────────────────────────────────

  function startEditEmp(emp: Employee) {
    setEmpForm({ ...emp });
    setEditEmpId(emp.id);
  }

  function resetEmpForm() {
    setEmpForm({ id: "", name: "", getflyUserId: 0, zaloId: "", active: true, phone: "", position: "" });
    setEditEmpId(null);
  }

  async function saveEmployee() {
    if (!empForm.name.trim()) { showToast("Nhập tên nhân viên", false); return; }
    const emp: Employee = {
      ...empForm,
      id: editEmpId || empForm.id || genId(),
      getflyUserId: Number(empForm.getflyUserId) || 0,
    };
    setSaving(true);
    try {
      const r = await apiPost("upsert_employee", { employee: emp });
      if (r.success) {
        showToast(editEmpId ? "Đã cập nhật nhân viên" : "Đã thêm nhân viên");
        resetEmpForm();
        await loadAll();
      } else {
        showToast(r.error ?? "Lỗi", false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmp(id: string) {
    if (!confirm("Xóa nhân viên này?")) return;
    const r = await apiPost("delete_employee", { employeeId: id });
    if (r.success) { showToast("Đã xóa"); await loadAll(); }
    else showToast(r.error ?? "Lỗi", false);
  }

  async function toggleActive(emp: Employee) {
    const r = await apiPost("upsert_employee", { employee: { ...emp, active: !emp.active } });
    if (r.success) await loadAll();
  }

  async function testPing(emp: Employee) {
    if (!emp.zaloId) { showToast("Nhân viên chưa có Zalo ID", false); return; }
    setPinging((p) => ({ ...p, [emp.id]: true }));
    try {
      const r = await apiPost("test_ping", { zaloId: emp.zaloId });
      showToast(r.sent ? `Đã gửi ping đến ${emp.name}` : "Gửi ping thất bại — kiểm tra Zalo Bot Token", r.sent);
    } finally {
      setPinging((p) => ({ ...p, [emp.id]: false }));
    }
  }

  // ── Project distribution editor ─────────────────────────────────────────────

  function getProjectDist(pid: string): ProjectDistribution {
    return config?.projects[pid] ?? { groups: [] };
  }

  function updateProjectDist(pid: string, dist: ProjectDistribution) {
    if (!config) return;
    setConfig({ ...config, projects: { ...config.projects, [pid]: dist } });
  }

  function addGroup(pid: string) {
    const dist = getProjectDist(pid);
    const newGroup: Group = { id: genId(), name: `Nhóm ${dist.groups.length + 1}`, members: [] };
    updateProjectDist(pid, { groups: [...dist.groups, newGroup] });
  }

  function removeGroup(pid: string, gid: string) {
    const dist = getProjectDist(pid);
    updateProjectDist(pid, { groups: dist.groups.filter((g) => g.id !== gid) });
  }

  function updateGroupName(pid: string, gid: string, name: string) {
    const dist = getProjectDist(pid);
    updateProjectDist(pid, {
      groups: dist.groups.map((g) => g.id === gid ? { ...g, name } : g),
    });
  }

  function addMember(pid: string, gid: string, employeeId: string) {
    if (!employeeId) return;
    const dist = getProjectDist(pid);
    updateProjectDist(pid, {
      groups: dist.groups.map((g) => {
        if (g.id !== gid) return g;
        if (g.members.find((m) => m.employeeId === employeeId)) return g;
        return { ...g, members: [...g.members, { employeeId, weight: 1 }] };
      }),
    });
  }

  function removeMember(pid: string, gid: string, empId: string) {
    const dist = getProjectDist(pid);
    updateProjectDist(pid, {
      groups: dist.groups.map((g) =>
        g.id === gid ? { ...g, members: g.members.filter((m) => m.employeeId !== empId) } : g
      ),
    });
  }

  function setWeight(pid: string, gid: string, empId: string, weight: number) {
    const dist = getProjectDist(pid);
    updateProjectDist(pid, {
      groups: dist.groups.map((g) =>
        g.id === gid
          ? { ...g, members: g.members.map((m) => m.employeeId === empId ? { ...m, weight } : m) }
          : g
      ),
    });
  }

  async function saveProjectDist(pid: string) {
    setSaving(true);
    try {
      const dist = getProjectDist(pid);
      const r = await apiPost("set_project_distribution", { projectId: pid, distribution: dist });
      if (r.success) showToast("Đã lưu cấu hình nhóm");
      else showToast(r.error ?? "Lỗi", false);
    } finally {
      setSaving(false);
    }
  }

  async function resetState(pid: string) {
    if (!confirm("Reset trạng thái queue về 0?")) return;
    const r = await apiPost("reset_project_state", { projectId: pid });
    if (r.success) { showToast("Đã reset queue"); await loadAll(); }
    else showToast(r.error ?? "Lỗi", false);
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function empName(id: string) {
    return config?.employees.find((e) => e.id === id)?.name ?? id;
  }

  function queueNext(pid: string): string {
    if (!config) return "—";
    const dist = config.projects[pid];
    const state = config.state[pid];
    if (!dist?.groups.length) return "Chưa cấu hình";
    const gi = (state?.groupIndex ?? 0) % dist.groups.length;
    const group = dist.groups[gi];
    if (!group?.members.length) return "Nhóm trống";

    const groupState = state?.groups[group.id] ?? { counts: {} };
    const empMap = new Map(config.employees.map((e) => [e.id, e]));
    const active = group.members.filter((m) => empMap.get(m.employeeId)?.active && m.weight > 0);
    if (!active.length) return "Không có NV active";

    let best = active[0];
    let bestRatio = (groupState.counts[best.employeeId] ?? 0) / best.weight;
    for (const m of active.slice(1)) {
      const r = (groupState.counts[m.employeeId] ?? 0) / m.weight;
      if (r < bestRatio) { bestRatio = r; best = m; }
    }
    return `${group.name} → ${empName(best.employeeId)}`;
  }

  const filteredFollowers = zaloFollowers.filter((f) => {
    const nameMatch = !zaloSearchName || f.display_name.toLowerCase().includes(zaloSearchName.toLowerCase());
    return nameMatch;
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Đang tải...</p>
      </div>
    );
  }

  const pid = activeProject;
  const dist = pid ? getProjectDist(pid) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <span className="text-gray-300">|</span>
        <Users className="w-4 h-4 text-indigo-600" />
        <h1 className="text-base font-semibold text-gray-800">Phân chia Lead</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Nhân viên ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Danh sách nhân viên</h2>
            <span className="text-xs text-gray-400">{config?.employees.length ?? 0} người</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={fetchGetflyUsers}
                disabled={loadingGetfly}
                className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                {loadingGetfly ? "Đang tải..." : "Sync từ Getfly"}
              </button>
              <button
                onClick={showZaloPanel ? () => setShowZaloPanel(false) : fetchZaloFollowers}
                disabled={loadingZalo}
                className="flex items-center gap-1.5 text-xs bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
              >
                <Search className="w-3.5 h-3.5" />
                {loadingZalo ? "Đang tải..." : showZaloPanel ? "Ẩn Zalo" : "Tìm Zalo ID"}
              </button>
            </div>
          </div>

          {/* ── Getfly sync panel ─────────────────────────────────────────── */}
          {showGetflySync && getflyUsers.length > 0 && (
            <div className="border-b border-gray-100 bg-blue-50">
              <div className="px-5 py-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-800">
                  {getflyUsers.length} nhân viên từ Getfly — chọn để import
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={importSelectedGetflyUsers}
                    disabled={saving || selectedGetflyIds.size === 0}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    Import {selectedGetflyIds.size} người
                  </button>
                  <button onClick={() => setShowGetflySync(false)} className="text-blue-500 hover:text-blue-700 p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="divide-y divide-blue-100 max-h-64 overflow-y-auto">
                {getflyUsers.map((u) => {
                  const alreadyIn = (config?.employees ?? []).some((e) => e.getflyUserId === u.user_id);
                  const checked = selectedGetflyIds.has(u.user_id);
                  const mappedZalo = zaloMappings.find((m) => m.phone === normalizePhone(u.contact_mobile));
                  return (
                    <label key={u.user_id} className={`flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-blue-100 transition-colors ${alreadyIn ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={alreadyIn}
                        onChange={(e) => {
                          setSelectedGetflyIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(u.user_id);
                            else next.delete(u.user_id);
                            return next;
                          });
                        }}
                        className="accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{u.contact_name}</p>
                        <p className="text-xs text-gray-500">
                          #{u.user_id} · {u.dept_name || "—"}
                          {u.contact_mobile ? ` · ${u.contact_mobile}` : ""}
                        </p>
                      </div>
                      {alreadyIn && <span className="text-xs text-gray-400">Đã có</span>}
                      {mappedZalo && !alreadyIn && (
                        <span className="text-xs text-teal-600">Zalo ✓</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Zalo followers/mapping panel ─────────────────────────────── */}
          {showZaloPanel && (
            <div className="border-b border-gray-100 bg-teal-50">
              <div className="px-5 py-3 flex items-center gap-3">
                <p className="text-xs font-semibold text-teal-800 flex-1">
                  Tìm Zalo ID qua followers OA / đăng ký thủ công
                </p>
                <button onClick={() => setShowZaloPanel(false)} className="text-teal-500 hover:text-teal-700 p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Đăng ký tự động */}
              <div className="px-5 pb-3 text-xs text-teal-700 bg-teal-50/80 border-b border-teal-100">
                <p className="font-medium mb-1">Cách 1 — Nhân viên tự đăng ký (khuyên dùng):</p>
                <p>Nhân viên nhắn <code className="bg-white px-1 rounded border border-teal-200">dangky</code> vào Zalo Bot → trả lời SĐT → hệ thống tự lưu mapping</p>
              </div>

              {/* Đăng ký thủ công */}
              <div className="px-5 py-3 border-b border-teal-100">
                <p className="text-xs font-medium text-teal-800 mb-2">Cách 2 — Nhập thủ công (SĐT → Zalo ID):</p>
                <div className="flex gap-2">
                  <input
                    value={zaloSearchPhone}
                    onChange={(e) => setZaloSearchPhone(e.target.value)}
                    placeholder="SĐT nhân viên (0909...)"
                    className="flex-1 border border-teal-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-teal-400 bg-white"
                  />
                  <input
                    value={zaloSearchName}
                    onChange={(e) => setZaloSearchName(e.target.value)}
                    placeholder="Zalo User ID"
                    className="flex-1 border border-teal-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-teal-400 bg-white"
                  />
                  <button
                    onClick={async () => {
                      if (zaloSearchPhone && zaloSearchName) {
                        await saveZaloMapping(zaloSearchPhone, zaloSearchName);
                        setZaloSearchPhone("");
                        setZaloSearchName("");
                      }
                    }}
                    disabled={!zaloSearchPhone || !zaloSearchName}
                    className="flex items-center gap-1 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    <Check className="w-3 h-3" />
                    Lưu
                  </button>
                </div>
              </div>

              {/* Đã đăng ký */}
              {zaloMappings.length > 0 && (
                <div className="px-5 py-2">
                  <p className="text-xs font-medium text-teal-700 mb-1">Đã đăng ký ({zaloMappings.length}):</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {zaloMappings.map((m) => (
                      <div key={m.phone} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="font-mono">{m.phone}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-mono text-teal-700">{m.zaloId}</span>
                        <button
                          onClick={async () => {
                            await fetch("/api/zalo-followers", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", phone: m.phone }),
                            });
                            setZaloMappings((prev) => prev.filter((x) => x.phone !== m.phone));
                          }}
                          className="text-red-400 hover:text-red-600 ml-auto"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Followers list */}
              {filteredFollowers.length > 0 && (
                <div className="px-5 py-2 border-t border-teal-100">
                  <p className="text-xs font-medium text-teal-700 mb-1">Followers OA ({filteredFollowers.length}):</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {filteredFollowers.map((f) => (
                      <div key={f.user_id} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-700 flex-1">{f.display_name || f.user_id}</span>
                        <code className="text-teal-600 font-mono">{f.user_id}</code>
                        <button
                          onClick={() => setZaloSearchName(f.user_id)}
                          className="text-teal-500 hover:text-teal-700 text-xs px-1.5 py-0.5 rounded border border-teal-200 hover:bg-teal-50"
                        >
                          Dùng ID này
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Employee list */}
          {(config?.employees.length ?? 0) > 0 && (
            <div className="divide-y divide-gray-100">
              {config!.employees.map((emp) => {
                const isEditing = editEmpId === emp.id;
                return (
                  <div key={emp.id}>
                    {/* Normal row */}
                    <div className="flex items-center gap-3 px-5 py-3">
                      {/* Active toggle */}
                      <button
                        onClick={() => toggleActive(emp)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                          emp.active ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                        }`}
                        title={emp.active ? "Active — click để tắt" : "Tắt — click để bật"}
                      >
                        <span className={`w-2 h-2 rounded-full ${emp.active ? "bg-green-500" : "bg-gray-400"}`} />
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{emp.name}</p>
                        <p className="text-xs text-gray-400">
                          {emp.position
                            ? <span className="text-indigo-500 font-medium">{emp.position} · </span>
                            : ""}
                          Getfly #{emp.getflyUserId || "—"}
                          {emp.phone ? <span className="text-gray-500"> · {emp.phone}</span> : ""}
                          {emp.zaloId
                            ? <span className="text-teal-600"> · Zalo ✓</span>
                            : <span className="text-orange-400"> · Chưa có Zalo ID</span>
                          }
                        </p>
                      </div>

                      {/* Ping test */}
                      <button
                        onClick={() => testPing(emp)}
                        disabled={pinging[emp.id] || !emp.zaloId}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                        title={!emp.zaloId ? "Chưa có Zalo ID" : "Gửi tin nhắn test"}
                      >
                        <Bell className="w-3.5 h-3.5" />
                        {pinging[emp.id] ? "Gửi..." : "Ping"}
                      </button>

                      <button
                        onClick={() => {
                          if (isEditing) {
                            resetEmpForm();
                          } else {
                            startEditEmp(emp);
                          }
                        }}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                          isEditing
                            ? "text-gray-500 bg-gray-100 hover:bg-gray-200"
                            : "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                        }`}
                      >
                        {isEditing ? "Hủy" : "Sửa"}
                      </button>

                      <button
                        onClick={() => deleteEmp(emp.id)}
                        className="text-xs text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Inline edit row */}
                    {isEditing && (
                      <div className="px-5 py-3 bg-indigo-50 border-t border-indigo-100 flex flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-[140px]">
                          <label className="block text-xs text-indigo-700 mb-1 font-medium">Tên</label>
                          <input
                            value={empForm.name}
                            onChange={(e) => setEmpForm((f) => ({ ...f, name: e.target.value }))}
                            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-xs text-indigo-700 mb-1 font-medium">Getfly ID</label>
                          <input
                            type="number"
                            value={empForm.getflyUserId || ""}
                            onChange={(e) => setEmpForm((f) => ({ ...f, getflyUserId: Number(e.target.value) }))}
                            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                          />
                        </div>
                        <div className="w-32">
                          <label className="block text-xs text-indigo-700 mb-1 font-medium">SĐT</label>
                          <input
                            value={empForm.phone ?? ""}
                            onChange={(e) => setEmpForm((f) => ({ ...f, phone: e.target.value }))}
                            placeholder="0909..."
                            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                          />
                        </div>
                        <div className="flex-1 min-w-[140px]">
                          <label className="block text-xs text-indigo-700 mb-1 font-medium">Phòng ban / Chức danh</label>
                          <input
                            value={empForm.position ?? ""}
                            onChange={(e) => setEmpForm((f) => ({ ...f, position: e.target.value }))}
                            placeholder="Kinh doanh, Tư vấn..."
                            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                          />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                          <label className="block text-xs text-indigo-700 mb-1 font-medium">Zalo User ID</label>
                          <input
                            value={empForm.zaloId}
                            onChange={(e) => setEmpForm((f) => ({ ...f, zaloId: e.target.value }))}
                            placeholder="Nhập Zalo ID..."
                            autoFocus
                            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                          />
                        </div>
                        <button
                          onClick={saveEmployee}
                          disabled={saving}
                          className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 self-end"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {saving ? "..." : "Lưu"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add / Edit form */}
          <div className="px-5 py-4 bg-gray-50 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-3">
              {editEmpId ? "Sửa nhân viên" : "Thêm nhân viên thủ công"}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs text-gray-500 mb-1">Tên</label>
                <input
                  value={empForm.name}
                  onChange={(e) => setEmpForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nguyễn Văn A"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phòng ban / Chức danh</label>
                <input
                  value={empForm.position ?? ""}
                  onChange={(e) => setEmpForm((f) => ({ ...f, position: e.target.value }))}
                  placeholder="Kinh doanh..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Getfly User ID</label>
                <input
                  type="number"
                  value={empForm.getflyUserId || ""}
                  onChange={(e) => setEmpForm((f) => ({ ...f, getflyUserId: Number(e.target.value) }))}
                  placeholder="123"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">SĐT</label>
                <input
                  value={empForm.phone ?? ""}
                  onChange={(e) => setEmpForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="0909..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Zalo User ID</label>
                <input
                  value={empForm.zaloId}
                  onChange={(e) => setEmpForm((f) => ({ ...f, zaloId: e.target.value }))}
                  placeholder="zalo_user_id"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={saveEmployee}
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "..." : editEmpId ? "Cập nhật" : "Thêm"}
                </button>
                {editEmpId && (
                  <button onClick={resetEmpForm} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-2">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Nhóm theo dự án ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Cấu hình nhóm theo dự án</h2>
          </div>

          {/* Project tabs */}
          <div className="flex gap-0 overflow-x-auto border-b border-gray-100 px-5 pt-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProject(String(p.id))}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeProject === String(p.id)
                    ? "border-teal-500 text-teal-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {pid && dist && (
            <div className="p-5 space-y-4">
              {/* Queue status */}
              <div className="flex items-center justify-between text-xs">
                <div className="text-gray-500">
                  Lead kế tiếp sẽ vào:{" "}
                  <span className="font-semibold text-gray-800">{queueNext(pid)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resetState(pid)}
                    className="flex items-center gap-1 text-orange-600 hover:text-orange-800 px-2 py-1 rounded-lg hover:bg-orange-50 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset queue
                  </button>
                  <button
                    onClick={() => saveProjectDist(pid)}
                    disabled={saving}
                    className="flex items-center gap-1.5 bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-60"
                  >
                    <Save className="w-3 h-3" />
                    Lưu
                  </button>
                </div>
              </div>

              {/* Groups */}
              {dist.groups.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  Chưa có nhóm nào. Nhấn &quot;Thêm nhóm&quot; để bắt đầu.
                </p>
              )}

              {dist.groups.map((group, gi) => {
                const groupState = config?.state[pid]?.groups[group.id] ?? { counts: {} };
                return (
                  <div key={group.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <span className="text-xs text-gray-400 font-mono">#{gi + 1}</span>
                      <input
                        value={group.name}
                        onChange={(e) => updateGroupName(pid, group.id, e.target.value)}
                        className="flex-1 text-sm font-medium text-gray-800 bg-transparent outline-none border-b border-transparent focus:border-gray-300 transition-colors"
                      />
                      <button
                        onClick={() => removeGroup(pid, group.id)}
                        className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Members */}
                    <div className="divide-y divide-gray-100">
                      {group.members.map((member) => {
                        const emp = config?.employees.find((e) => e.id === member.employeeId);
                        const count = groupState.counts[member.employeeId] ?? 0;
                        return (
                          <div key={member.employeeId} className="flex items-center gap-3 px-4 py-2.5">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${emp?.active ? "bg-green-400" : "bg-gray-300"}`} />
                            <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">
                              {emp?.name ?? member.employeeId}
                              {emp && !emp.zaloId && <span className="text-orange-400 text-xs ml-1">(chưa có Zalo)</span>}
                            </span>
                            <span className="text-xs text-gray-400 w-16 text-right">
                              {count} lead{count !== 1 ? "s" : ""}
                            </span>
                            <div className="flex items-center gap-1.5 w-32">
                              <span className="text-xs text-gray-500 w-12 text-right">x{member.weight}</span>
                              <input
                                type="range"
                                min={1}
                                max={10}
                                value={member.weight}
                                onChange={(e) => setWeight(pid, group.id, member.employeeId, Number(e.target.value))}
                                className="flex-1 accent-teal-600"
                              />
                            </div>
                            <button
                              onClick={() => removeMember(pid, group.id, member.employeeId)}
                              className="text-gray-300 hover:text-red-500 p-1 rounded transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {/* Add member select */}
                      <div className="px-4 py-2.5 bg-gray-50">
                        <select
                          defaultValue=""
                          onChange={(e) => { addMember(pid, group.id, e.target.value); e.target.value = ""; }}
                          className="text-xs text-gray-600 border border-dashed border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-teal-400 w-full"
                        >
                          <option value="" disabled>+ Thêm nhân viên vào nhóm...</option>
                          {(config?.employees ?? [])
                            .filter((e) => !group.members.find((m) => m.employeeId === e.id))
                            .map((e) => (
                              <option key={e.id} value={e.id}>{e.name}{!e.zaloId ? " ⚠" : ""}</option>
                            ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add group button */}
              <button
                onClick={() => addGroup(pid)}
                className="w-full flex items-center justify-center gap-2 text-sm text-teal-600 hover:text-teal-800 border-2 border-dashed border-teal-200 hover:border-teal-400 rounded-xl py-3 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Thêm nhóm
              </button>
            </div>
          )}
        </section>

        {/* ── Hướng dẫn Zalo Bot ───────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Bell className="w-4 h-4 text-yellow-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Cấu hình Zalo Bot</h2>
          </div>
          <div className="px-5 py-4 text-sm text-gray-600 space-y-3">
            <p>Để hệ thống gửi ping kiểm tra online cho nhân viên qua Zalo, cần cấu hình:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 pl-2">
              <li>Tạo Zalo Bot tại <a href="https://bot.zapps.me" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">bot.zapps.me</a></li>
              <li>Thêm vào <code className="bg-gray-100 px-1 rounded text-xs">.env.local</code>:
                <pre className="mt-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 font-mono">
{`ZALO_BOT_TOKEN=your_oa_access_token
ZALO_BOT_SECRET=your_app_secret`}
                </pre>
              </li>
              <li>Webhook URL: <code className="bg-gray-100 px-1 rounded text-xs">https://your-domain/api/zalo-webhook</code></li>
              <li>Nhân viên <strong>follow</strong> OA → nhắn <code className="bg-gray-100 px-1 rounded text-xs">dangky</code> → trả lời SĐT → tự đăng ký Zalo ID</li>
            </ol>
            <p className="text-xs text-gray-400">
              Nếu chưa cấu hình Zalo Bot, hệ thống sẽ tạo lead bình thường mà không check online hay gửi thông báo.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}


// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  getflyUserId: number;
  zaloId: string;
  active: boolean;
}

interface GroupMember {
  employeeId: string;
  weight: number;
}

interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

interface ProjectDistribution {
  groups: Group[];
}

interface GroupState {
  counts: Record<string, number>;
}

interface ProjectState {
  groupIndex: number;
  groups: Record<string, GroupState>;
}

