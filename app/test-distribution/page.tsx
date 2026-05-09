"use client";

/**
 * TEST PAGE — Mô phỏng phân bổ lead
 * Trang tạm thời để kiểm tra logic weighted round-robin.
 * Xóa thư mục app/test-distribution/ sau khi kiểm tra xong.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, RotateCcw, ChevronLeft, Zap, Check, Clock, ChevronRight, AlertTriangle, Plus } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string; name: string; getflyUserId: number; zaloId: string;
  active: boolean; phone?: string; position?: string;
}

interface AnnotatedEmployee extends Employee {
  groupId: string;
  groupName: string;
  groupWeight: number;
}

interface GroupMember { employeeId: string; weight: number; }
interface Group { id: string; name: string; weight: number; members: GroupMember[]; }
interface ProjectDistribution { groups: Group[]; }
interface GroupState { counts: Record<string, number>; }
interface ProjectState { groupCounts: Record<string, number>; groups: Record<string, GroupState>; }
interface Config {
  employees: Employee[]; projects: Record<string, ProjectDistribution>;
  state: Record<string, ProjectState>;
}

type LeadStatus = "pending" | "accepted" | "no_response_all";

interface ActiveLead {
  id: number;
  queue: AnnotatedEmployee[];
  currentIdx: number;
  status: LeadStatus;
  acceptedBy?: AnnotatedEmployee;
  skipped: AnnotatedEmployee[];
}

interface LogEntry {
  seq: number; time: string;
  accepted?: { name: string; groupName: string };
  skipped: Array<{ name: string; groupName: string }>;
  result: "accepted" | "no_response_all";
}

interface ConcurrentSlot {
  leadNo: number;
  candidate?: { id: string; name: string; groupId: string; groupName: string; zaloId: string };
  acceptedBy?: { name: string; groupName: string };
  skipped: Array<{ id: string; name: string; groupName: string }>;
  status: "reserving" | "pinging" | "accepted" | "no_response_all" | "error";
  elapsedMs?: number;
}

interface MultiPendingLead {
  id: number;
  candidate: AnnotatedEmployee | null;
  groupName: string;
  skippedIds: string[];
  skippedNames: Array<{ name: string; groupName: string }>;
  status: "reserving" | "pinging" | "accepted" | "no_response_all";
  acceptedBy?: { name: string; groupName: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────────


// ── Component ─────────────────────────────────────────────────────────────────

let leadSeq = 0;

export default function TestDistributionPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [candidates, setCandidates] = useState<AnnotatedEmployee[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [activeLead, setActiveLead] = useState<ActiveLead | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [concurrentCount, setConcurrentCount] = useState(4);
  const [concurrentSlots, setConcurrentSlots] = useState<ConcurrentSlot[]>([]);
  const [concurrentRunning, setConcurrentRunning] = useState(false);

  // Multi-pending: thêm từng lead trong khi lead trước vẫn đang chờ
  const [multiPending, setMultiPending] = useState<MultiPendingLead[]>([]);
  const [multiPendingBusy, setMultiPendingBusy] = useState(false);

  const load = useCallback(async (pid?: string) => {
    const p = pid ?? selectedProject;
    const url = p
      ? `/api/debug/simulate-distribution?projectId=${p}`
      : `/api/debug/simulate-distribution`;
    const res = await fetch(url);
    const data = await res.json();
    setConfig(data.config);
    setCandidates(data.candidates ?? []);
    setProjectName(data.projectName ?? "");
    if (data.projectNames) setProjectNames(data.projectNames);
    if (!p && Object.keys(data.config.projects).length > 0) {
      setSelectedProject(Object.keys(data.config.projects)[0]);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedProject) load(selectedProject); }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Concurrent simulation ─────────────────────────────────────────────────

  async function startConcurrent() {
    if (!selectedProject || concurrentRunning) return;
    setConcurrentRunning(true);

    // Init all slots then reserve candidates simultaneously
    const initSlots: ConcurrentSlot[] = Array.from({ length: concurrentCount }, (_, i) => ({
      leadNo: i + 1, status: "reserving", skipped: [],
    }));
    setConcurrentSlots([...initSlots]);

    // Reserve a candidate for each slot simultaneously
    await Promise.all(
      initSlots.map(async (slot) => {
        const res = await fetch("/api/debug/simulate-distribution", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reserve", projectId: selectedProject }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setConcurrentSlots((prev) => prev.map((s) =>
            s.leadNo === slot.leadNo ? { ...s, status: "no_response_all" } : s
          ));
          return;
        }
        const emp = data.employee as AnnotatedEmployee & { zaloId: string };
        setConcurrentSlots((prev) => prev.map((s) =>
          s.leadNo === slot.leadNo
            ? { ...s, status: "pinging", candidate: { id: emp.id, name: emp.name, groupId: emp.groupId ?? "", groupName: data.group?.name ?? "", zaloId: emp.zaloId } }
            : s
        ));
      })
    );
  }

  async function concurrentAccept(leadNo: number) {
    const slot = concurrentSlots.find((s) => s.leadNo === leadNo);
    if (!slot?.candidate || slot.status !== "pinging") return;
    const { id, name, groupName } = slot.candidate;
    const skippedSnapshot = slot.skipped;

    // Mark as accepted immediately to prevent double-click
    setConcurrentSlots((prev) =>
      prev.map((s) => s.leadNo === leadNo ? { ...s, status: "accepted" as const, acceptedBy: { name, groupName } } : s)
    );

    await fetch("/api/debug/simulate-distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", projectId: selectedProject, employeeId: id }),
    });

    leadSeq++;
    setLog((l) => [{
      seq: leadSeq,
      time: new Date().toLocaleTimeString("vi-VN"),
      accepted: { name, groupName },
      skipped: skippedSnapshot,
      result: "accepted",
    }, ...l]);

    await load(selectedProject);

    setConcurrentSlots((prev) => {
      const updated = prev.map((s) =>
        s.leadNo === leadNo ? { ...s, status: "accepted" as const, acceptedBy: { name, groupName } } : s
      );
      if (updated.every((s) => ["accepted", "no_response_all"].includes(s.status))) {
        setConcurrentRunning(false);
      }
      return updated;
    });
  }

  async function concurrentNoResponse(leadNo: number) {
    const slot = concurrentSlots.find((s) => s.leadNo === leadNo);
    if (!slot?.candidate || slot.status !== "pinging") return;
    const { id, name, groupName } = slot.candidate;
    const newSkipped = [...slot.skipped, { id, name, groupName }];

    // Release current, get next
    setConcurrentSlots((prev) => prev.map((s) =>
      s.leadNo === leadNo ? { ...s, status: "reserving" as const, candidate: undefined, skipped: newSkipped } : s
    ));

    const res = await fetch("/api/debug/simulate-distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "release",
        projectId: selectedProject,
        employeeId: id,
        // Gửi danh sách NV đã bị skip để server loại trừ, tránh ping lại
        skippedIds: slot.skipped.map((s) => s.id).filter(Boolean),
      }),
    });
    const data = await res.json();

    if (!data.ok || !data.next) {
      setConcurrentSlots((prev) => {
        const updated = prev.map((s) => s.leadNo === leadNo ? { ...s, status: "no_response_all" as const, skipped: newSkipped } : s);
        if (updated.every((s) => ["accepted", "no_response_all"].includes(s.status))) {
          setConcurrentRunning(false);
        }
        return updated;
      });
      return;
    }

    const nextEmp = data.next.employee as AnnotatedEmployee & { zaloId: string };
    const nextGroupName = data.next.group?.name ?? "";
    setConcurrentSlots((prev) => prev.map((s) =>
      s.leadNo === leadNo
        ? { ...s, status: "pinging" as const, candidate: { id: nextEmp.id, name: nextEmp.name, groupId: nextEmp.groupId ?? "", groupName: nextGroupName, zaloId: nextEmp.zaloId }, skipped: newSkipped }
        : s
    ));
  }

  // ── Multi-pending: nhiều lead pending cùng lúc ────────────────────────────

  async function addPendingLead() {
    if (!selectedProject || multiPendingBusy) return;
    setMultiPendingBusy(true);
    leadSeq++;
    const thisId = leadSeq;

    setMultiPending((prev) => [...prev, {
      id: thisId, candidate: null, groupName: "", skippedIds: [], skippedNames: [],
      status: "reserving" as const,
    }]);

    const res = await fetch("/api/debug/simulate-distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reserve", projectId: selectedProject }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setMultiPending((prev) => prev.map((l) =>
        l.id === thisId ? { ...l, status: "no_response_all" as const } : l
      ));
    } else {
      const emp = data.employee as AnnotatedEmployee;
      setMultiPending((prev) => prev.map((l) =>
        l.id === thisId
          ? { ...l, status: "pinging" as const, candidate: emp, groupName: data.group?.name ?? "" }
          : l
      ));
    }
    setMultiPendingBusy(false);
  }

  async function multiAccept(leadId: number) {
    const lead = multiPending.find((l) => l.id === leadId);
    if (!lead?.candidate || lead.status !== "pinging") return;
    const { id, name } = lead.candidate;
    const { groupName, skippedNames } = lead;

    setMultiPending((prev) => prev.map((l) =>
      l.id === leadId ? { ...l, status: "accepted" as const, acceptedBy: { name, groupName } } : l
    ));

    await fetch("/api/debug/simulate-distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", projectId: selectedProject, employeeId: id }),
    });

    leadSeq++;
    setLog((l) => [{ seq: leadSeq, time: new Date().toLocaleTimeString("vi-VN"), accepted: { name, groupName }, skipped: skippedNames, result: "accepted" }, ...l]);
    await load(selectedProject);
  }

  async function multiNoResponse(leadId: number) {
    const lead = multiPending.find((l) => l.id === leadId);
    if (!lead?.candidate || lead.status !== "pinging") return;
    const { id, name } = lead.candidate;
    const { groupName, skippedIds, skippedNames } = lead;
    const newSkippedIds = [...skippedIds, id];
    const newSkippedNames = [...skippedNames, { name, groupName }];

    setMultiPending((prev) => prev.map((l) =>
      l.id === leadId ? { ...l, status: "reserving" as const, candidate: null, skippedIds: newSkippedIds, skippedNames: newSkippedNames } : l
    ));

    const res = await fetch("/api/debug/simulate-distribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", projectId: selectedProject, employeeId: id, skippedIds }),
    });
    const data = await res.json();

    if (!data.ok || !data.next) {
      setMultiPending((prev) => prev.map((l) =>
        l.id === leadId ? { ...l, status: "no_response_all" as const, skippedNames: newSkippedNames } : l
      ));
      leadSeq++;
      setLog((l) => [{ seq: leadSeq, time: new Date().toLocaleTimeString("vi-VN"), skipped: newSkippedNames, result: "no_response_all" }, ...l]);
      return;
    }

    const nextEmp = data.next.employee as AnnotatedEmployee;
    const nextGroupName = data.next.group?.name ?? "";
    setMultiPending((prev) => prev.map((l) =>
      l.id === leadId
        ? { ...l, status: "pinging" as const, candidate: nextEmp, groupName: nextGroupName, skippedIds: newSkippedIds, skippedNames: newSkippedNames }
        : l
    ));
  }

  function clearMultiPending() {
    multiPending.filter((l) => l.status === "pinging" && l.candidate).forEach((lead) => {
      fetch("/api/debug/simulate-distribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", projectId: selectedProject, employeeId: lead.candidate!.id }),
      });
    });
    setMultiPending([]);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  async function resetState() {
    if (!selectedProject) return;
    clearMultiPending();
    setMultiPending([]);
    await fetch(`/api/debug/simulate-distribution?projectId=${selectedProject}`, { method: "DELETE" });
    setActiveLead(null);
    setLog([]);
    leadSeq = 0;
    await load(selectedProject);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) return <div className="p-8 text-gray-500">Đang tải...</div>;

  const projectIds = Object.keys(config.projects);
  const dist = selectedProject ? config.projects[selectedProject] : null;
  const state = selectedProject ? config.state[selectedProject] : null;
  const totalLeads = Object.values(state?.groupCounts ?? {}).reduce((s, v) => s + v, 0);
  const empMap = new Map(config.employees.map((e) => [e.id, e]));

  const groupStats = dist?.groups.map((g) => {
    const count = state?.groupCounts?.[g.id] ?? 0;
    const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
    return { ...g, count, pct };
  }) ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/distribution" className="text-gray-400 hover:text-gray-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Test Phân Bổ Lead
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Mô phỏng — không gửi Zalo thật.
            Xóa <code className="bg-gray-100 px-1 rounded">app/test-distribution/</code> sau khi test.
          </p>
        </div>
        <button onClick={() => load(selectedProject)} className="ml-auto text-gray-400 hover:text-gray-600 p-1.5 rounded hover:bg-gray-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Column 1: Stats ──────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Project selector */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Dự án</label>
            <select
              value={selectedProject}
              onChange={(e) => { setSelectedProject(e.target.value); setActiveLead(null); clearMultiPending(); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
            >
              {projectIds.map((pid) => (
                <option key={pid} value={pid}>
                  {projectNames[pid] ?? `Project #${pid}`}
                </option>
              ))}
            </select>
            {projectIds.length === 0 && (
              <p className="text-xs text-orange-500 mt-2">
                Chưa có dự án. <Link href="/distribution" className="underline">Cấu hình tại đây</Link>.
              </p>
            )}
          </div>

          {/* Group stats */}
          {groupStats.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Phân bổ nhóm — {totalLeads} lead
              </div>
              <div className="space-y-3">
                {groupStats.map((g) => {
                  const diff = Math.abs(g.pct - g.weight);
                  const ok = totalLeads === 0 || diff <= 5;
                  return (
                    <div key={g.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{g.name}</span>
                        <span>
                          <span className={ok ? "text-teal-600 font-semibold" : "text-red-500 font-bold"}>
                            {g.pct.toFixed(1)}%
                          </span>
                          <span className="text-gray-400"> / {g.weight}% ({g.count})</span>
                        </span>
                      </div>
                      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-teal-400 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(g.pct, 100)}%` }} />
                        <div className="absolute inset-y-0 w-0.5 bg-gray-400 opacity-50"
                          style={{ left: `${g.weight}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Member counts */}
          {dist && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Chi tiết NV</div>
              <div className="space-y-3">
                {dist.groups.map((g) => {
                  const gs = state?.groups?.[g.id] ?? { counts: {} };
                  return (
                    <div key={g.id}>
                      <div className="text-xs text-gray-400 mb-1">{g.name} (tỷ lệ {g.weight}%)</div>
                      {g.members.map((m) => {
                        const emp = empMap.get(m.employeeId);
                        const count = gs.counts?.[m.employeeId] ?? 0;
                        const isNext = multiPending.length === 0 && candidates[0]?.id === m.employeeId && candidates[0]?.groupId === g.id;
                        return (
                          <div key={m.employeeId}
                            className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg mb-0.5 ${isNext ? "bg-teal-50 border border-teal-200" : "bg-gray-50"}`}>
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${emp?.active ? "bg-green-400" : "bg-gray-300"}`} />
                            <span className="flex-1 truncate text-gray-700">{emp?.name ?? m.employeeId}</span>
                            {!emp?.zaloId && <span className="text-orange-400">no zalo</span>}
                            <span className="font-mono text-gray-500">{count}</span>
                            {isNext && <span className="text-teal-600 font-semibold">← next</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={resetState} disabled={loading}
            className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg px-4 py-2 text-sm transition-colors">
            <RotateCcw className="w-4 h-4" />
            Reset state về 0
          </button>
        </div>

        {/* ── Column 2: Simulation ──────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Always-visible new lead button */}
          <button onClick={addPendingLead}
            disabled={multiPendingBusy || candidates.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white rounded-xl px-4 py-4 text-sm font-semibold transition-colors">
            <Zap className="w-4 h-4" />
            {multiPendingBusy ? "Đang lấy NV..." : "Có lead mới vào"}
          </button>

          {/* Active + completed lead cards */}
          {multiPending.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <div className="text-xs text-gray-400 flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> đang ping</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> đã nhận</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> hết người</span>
                </div>
                <button onClick={clearMultiPending} className="text-xs text-gray-400 hover:text-red-500">Xóa tất cả</button>
              </div>

              {multiPending.map((lead) => (
                <div key={lead.id} className={`rounded-xl border p-3 text-xs transition-all ${
                  lead.status === "pinging" ? "bg-yellow-50 border-yellow-300" :
                  lead.status === "accepted" ? "bg-green-50 border-green-200" :
                  lead.status === "no_response_all" ? "bg-orange-50 border-orange-200" :
                  "bg-gray-50 border-gray-100"
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-semibold text-gray-600">Lead #{lead.id}</span>
                    {lead.skippedNames.length > 0 && (
                      <span className="text-gray-400 truncate">bỏ qua: {lead.skippedNames.map((s) => s.name).join(" → ")}</span>
                    )}
                  </div>

                  {lead.status === "reserving" && (
                    <div className="text-gray-300 italic animate-pulse">Đang tìm NV rảnh...</div>
                  )}

                  {lead.status === "pinging" && lead.candidate && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-bold flex-shrink-0">
                          {lead.candidate.name.charAt(0)}
                        </div>
                        <div>
                          <span className="font-semibold text-gray-800">{lead.candidate.name}</span>
                          <span className="text-gray-400 ml-1">({lead.groupName})</span>
                          {!lead.candidate.zaloId && <span className="text-orange-400 ml-1">⚠ no zalo</span>}
                        </div>
                        <span className="ml-auto text-yellow-600 animate-pulse font-medium">🔔 pinging...</span>
                      </div>
                      <div className="bg-white border border-gray-100 rounded-lg p-2 mb-2 font-mono text-gray-500 whitespace-pre-wrap leading-relaxed">
                        {`🔔 Lead mới cần tư vấn!\nNguyễn Văn A | 09****** | ${projectName || "Dự án"}\n\nTrả lời:\n✅ "ok" / "nhận" → nhận lead\n❌ "bận" / "không" → chuyển người khác`}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => multiAccept(lead.id)}
                          className="flex-1 flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white rounded-lg px-2 py-2 font-medium transition-colors">
                          <Check className="w-3 h-3" /> ✅ &quot;ok&quot; — Nhận
                        </button>
                        <button onClick={() => multiNoResponse(lead.id)}
                          className="flex-1 flex items-center justify-center gap-1 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 rounded-lg px-2 py-2 font-medium transition-colors">
                          <Clock className="w-3 h-3" /> ❌ Bận / timeout
                        </button>
                      </div>
                    </div>
                  )}

                  {lead.status === "accepted" && lead.acceptedBy && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-green-700 font-semibold">
                        <Check className="w-4 h-4" />
                        {lead.acceptedBy.name} nhận
                        <span className="text-gray-400 font-normal ml-1">({lead.acceptedBy.groupName})</span>
                      </div>
                      <div className="text-gray-400 font-semibold uppercase tracking-wide" style={{ fontSize: "10px" }}>DM gửi NV:</div>
                      <div className="bg-green-50 border border-green-100 rounded-lg p-2 font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {`✅ Lead đã được phân chia cho bạn trên Getfly\n\n👤 Khách: Nguyễn Văn A\n📞 SĐT: 09******\n🏢 Dự án: ${projectName || "Dự án"}`}
                      </div>
                      <div className="text-gray-400 font-semibold uppercase tracking-wide" style={{ fontSize: "10px" }}>Thông báo nhóm Zalo:</div>
                      <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {`📣 Lead đã được nhận!\n👤 Nhân viên: @${lead.acceptedBy.name}\n📞 Khách: Ng*** | 09***\n🏢 Dự án: ${projectName || "Dự án"}`}
                      </div>
                    </div>
                  )}

                  {lead.status === "no_response_all" && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-orange-600 font-semibold">
                        <AlertTriangle className="w-4 h-4" />
                        Tất cả không phản hồi — lead chưa được assign
                      </div>
                      <div className="text-orange-500 bg-orange-50 border border-orange-100 rounded p-2">
                        Thực tế: lead vẫn tồn tại trên Getfly chưa được assign. State không thay đổi.
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Summary */}
              {multiPending.length > 1 && multiPending.some((l) => l.status === "pinging") && (() => {
                const pingingNames = multiPending.filter((l) => l.status === "pinging").map((l) => l.candidate?.name);
                const hasDup = pingingNames.length !== new Set(pingingNames).size;
                return (
                  <div className={`text-xs rounded-lg px-3 py-2 font-semibold border ${hasDup ? "bg-red-50 text-red-600 border-red-200" : "bg-teal-50 text-teal-700 border-teal-200"}`}>
                    {hasDup
                      ? "⚠ Có NV đang bị ping cho 2 lead cùng lúc — lỗi!"
                      : `✅ ${pingingNames.length} lead đang chờ — mỗi lead được ping một NV khác nhau`}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Concurrent simulation */}
          <div className="bg-white rounded-xl border border-purple-200 p-4">
            <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">
              ⚡ Nhiều lead cùng lúc
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Gửi N lead <span className="font-semibold">đồng thời</span> (Promise.all). Kiểm tra lock có phân bổ đúng không.
            </p>
            <div className="flex gap-2 mb-3">
              <input type="number" min={2} max={8} value={concurrentCount}
                onChange={(e) => setConcurrentCount(Math.min(8, Number(e.target.value)))}
                className="w-20 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-purple-400"
              />
              <button onClick={startConcurrent} disabled={concurrentRunning || loading || candidates.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
                <Zap className="w-4 h-4" />
                {concurrentRunning ? "Đang chạy..." : `Bắn ${concurrentCount} lead cùng lúc`}
              </button>
            </div>

            {/* Concurrent slots */}
            {concurrentSlots.length > 0 && (
              <div className="space-y-2 mt-1">
                <div className="text-xs text-gray-400">
                  Tất cả lead chạy song song — mỗi lead có nút riêng:
                </div>

                {concurrentSlots.map((slot) => (
                  <div key={slot.leadNo}
                    className={`rounded-lg border p-3 text-xs transition-all ${
                      slot.status === "reserving" ? "bg-gray-50 border-gray-100" :
                      slot.status === "pinging" ? "bg-yellow-50 border-yellow-300" :
                      slot.status === "accepted" ? "bg-green-50 border-green-200" :
                      slot.status === "no_response_all" ? "bg-orange-50 border-orange-200" :
                      "bg-red-50 border-red-100"
                    }`}>
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-600">Lead {slot.leadNo}</span>
                      {slot.skipped.length > 0 && (
                        <span className="text-gray-400 truncate">
                          bỏ qua: {slot.skipped.map((s) => s.name).join(", ")}
                        </span>
                      )}
                    </div>

                    {slot.status === "reserving" && (
                      <div className="text-gray-300 italic animate-pulse">đang chờ NV rảnh...</div>
                    )}

                    {slot.status === "pinging" && slot.candidate && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-7 h-7 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-bold flex-shrink-0">
                            {slot.candidate.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-800">{slot.candidate.name}</div>
                            <div className="text-gray-400">{slot.candidate.groupName}
                              {!slot.candidate.zaloId && <span className="text-orange-400 ml-1">⚠ no zalo</span>}
                            </div>
                          </div>
                          <span className="ml-auto text-yellow-600 animate-pulse font-medium">🔔 pinging...</span>
                        </div>

                        {/* Preview: tin nhắn bot gửi cho NV */}
                        <div className="bg-white border border-gray-200 rounded-lg p-2 mb-2 font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                          {`🔔 Lead mới cần tư vấn!\nNguyễn Văn A | 09****** | ${projectName || "Dự án"}\n\nTrả lời:\n✅ "ok" / "nhận" → nhận lead\n❌ "bận" / "không" → chuyển người khác`}
                        </div>

                        <div className="flex gap-1.5">
                          <button onClick={() => concurrentAccept(slot.leadNo)}
                            className="flex-1 flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white rounded-lg px-2 py-1.5 font-medium transition-colors">
                            <Check className="w-3 h-3" /> ✅ &quot;ok&quot; — Nhận
                          </button>
                          <button onClick={() => concurrentNoResponse(slot.leadNo)}
                            className="flex-1 flex items-center justify-center gap-1 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 rounded-lg px-2 py-1.5 font-medium transition-colors">
                            <Clock className="w-3 h-3" /> ❌ &quot;bận&quot; / timeout
                          </button>
                        </div>
                      </div>
                    )}

                    {slot.status === "accepted" && slot.acceptedBy && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-green-700 font-semibold">
                          <Check className="w-4 h-4" />
                          {slot.acceptedBy.name} nhận
                          <span className="text-gray-400 font-normal ml-1">({slot.acceptedBy.groupName})</span>
                        </div>
                        {/* Preview: tin nhắn bot gửi cho NV sau khi nhận */}
                        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">DM gửi NV:</div>
                        <div className="bg-green-50 border border-green-100 rounded-lg p-2 font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                          {`✅ Lead đã được phân chia cho bạn trên Getfly\n\n👤 Khách: Nguyễn Văn A\n📞 SĐT: 09******\n🏢 Dự án: ${projectName || "Dự án"}\n📝 Khách quan tâm dự án`}
                        </div>
                        {/* Preview: tin nhắn nhóm Zalo */}
                        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Thông báo nhóm Zalo dự án:</div>
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                          {`📣 Lead đã được nhận!\n👤 Nhân viên: @${slot.acceptedBy.name}\n📞 Khách: Ng*** | 09***\n🏢 Dự án: ${projectName || "Dự án"}`}
                        </div>
                      </div>
                    )}

                    {slot.status === "no_response_all" && (
                      <div className="flex items-center gap-2 text-orange-600">
                        <AlertTriangle className="w-4 h-4" />
                        Tất cả không phản hồi — lead chưa được assign
                      </div>
                    )}
                  </div>
                ))}

                {/* Summary */}
                {concurrentSlots.length > 0 && concurrentSlots.every((s) => ["accepted", "no_response_all"].includes(s.status)) && (() => {
                  const accepted = concurrentSlots.filter((s) => s.status === "accepted").map((s) => s.acceptedBy?.name);
                  const hasDup = accepted.length !== new Set(accepted).size;
                  return (
                    <div className={`text-xs rounded-lg px-3 py-2 font-semibold border ${hasDup ? "bg-red-50 text-red-600 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                      {hasDup
                        ? "⚠ Có NV nhận 2 lead — race condition!"
                        : `✅ Không có NV nào nhận 2 lead — ${accepted.length}/${concurrentSlots.length} lead được phân bổ`}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 3: Log ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 h-fit">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Lịch sử ({log.length})
            </div>
            {log.length > 0 && (
              <button onClick={() => setLog([])} className="text-xs text-gray-400 hover:text-red-500">Xóa</button>
            )}
          </div>

          {log.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-8">Chưa có lead nào</div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {log.map((entry, i) => (
                <div key={i}
                  className={`rounded-lg p-2.5 text-xs border ${entry.result === "accepted" ? "bg-green-50 border-green-100" : "bg-orange-50 border-orange-100"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-gray-400">#{entry.seq}</span>
                    <span className="text-gray-400">{entry.time}</span>
                  </div>
                  <div className="flex items-start gap-1 flex-wrap">
                    {entry.skipped.map((s, si) => (
                      <span key={si} className="flex items-center gap-0.5">
                        <span className="text-gray-400 line-through">{s.name}</span>
                        <span className="text-gray-300 text-xs">({s.groupName})</span>
                        <ChevronRight className="w-2.5 h-2.5 text-gray-300" />
                      </span>
                    ))}
                    {entry.accepted ? (
                      <span className="flex items-center gap-1">
                        <span className="text-green-700 font-semibold">{entry.accepted.name}</span>
                        <span className="text-gray-400">({entry.accepted.groupName})</span>
                        <span className="text-green-600">✅</span>
                      </span>
                    ) : (
                      <span className="text-orange-600 font-semibold">⚠ không ai nhận</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
