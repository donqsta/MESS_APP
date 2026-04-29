"use client";

import { useEffect, useState, useCallback } from "react";
import { Bot, ChevronLeft, RotateCcw, Zap, MessageSquare, RefreshCw, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import Link from "next/link";

interface BotSettings {
  defaultEnabled: boolean;
}

interface ProjectEntry {
  id: number;
  name: string;
  keywords: string[];
  domains: string[];
  pageIds: string[];
}

// Tag input component
function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function add() {
    const trimmed = input.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput("");
  }

  return (
    <div className="flex flex-wrap gap-1 border border-gray-200 rounded-lg px-2 py-1.5 bg-white min-h-[36px] focus-within:border-blue-400 transition-colors">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-md">
          {tag}
          <button onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-red-500 ml-0.5">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] text-xs outline-none bg-transparent text-gray-700 placeholder:text-gray-400"
      />
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editState, setEditState] = useState<Record<number, { keywords: string[]; domains: string[]; pageIds: string[] }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const loadProjects = useCallback(() => {
    fetch("/api/bot/sync-projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    fetch("/api/bot/settings").then((r) => r.json()).then(setSettings).catch(console.error);
  }, []);

  async function toggleDefault() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bot/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultEnabled: !settings.defaultEnabled }),
      });
      const updated = await res.json();
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }

  async function resetMemory(full: boolean) {
    setResetStatus("Đang xóa...");
    try {
      const res = await fetch("/api/bot/reset-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full, reloadPrompt: true }),
      });
      const data = await res.json();
      setResetStatus(data.success ? "✓ Đã xóa thành công" : "✗ Lỗi");
    } catch {
      setResetStatus("✗ Lỗi kết nối");
    }
    setTimeout(() => setResetStatus(null), 3000);
  }

  async function syncProjects(fillEmpty = false) {
    setSyncStatus(fillEmpty ? "Đang sync + AI suggest keywords..." : "Đang sync từ Getfly...");
    try {
      const res = await fetch("/api/bot/sync-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fillEmpty }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncStatus(`✓ ${data.message}`);
        loadProjects();
      } else {
        setSyncStatus(`✗ ${data.error}`);
      }
    } catch {
      setSyncStatus("✗ Lỗi kết nối");
    }
    setTimeout(() => setSyncStatus(null), 8000);
  }

  function toggleExpand(id: number, p: ProjectEntry) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      // seed edit state with current values if not already editing
      if (!editState[id]) {
        setEditState((prev) => ({ ...prev, [id]: { keywords: [...p.keywords], domains: [...p.domains], pageIds: [...(p.pageIds ?? [])] } }));
      }
    }
  }

  async function saveProject(id: number) {
    const patch = editState[id];
    if (!patch) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/bot/sync-projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, keywords: patch.keywords, domains: patch.domains, pageIds: patch.pageIds }),
      });
      const data = await res.json();
      if (data.success) {
        loadProjects();
        setSavedId(id);
        setTimeout(() => setSavedId(null), 2000);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function reloadPrompt() {
    setResetStatus("Đang reload...");
    try {
      await fetch("/api/bot/reload-prompt", { method: "POST" });
      setResetStatus("✓ Prompt đã được reload");
    } catch {
      setResetStatus("✗ Lỗi kết nối");
    }
    setTimeout(() => setResetStatus(null), 3000);
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
        <h1 className="text-base font-semibold text-gray-800">Cài đặt</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Bot AI */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-600" />
            <h2 className="font-semibold text-gray-800 text-sm">AI Bot</h2>
          </div>

          <div className="divide-y divide-gray-100">
            {/* Default enabled toggle */}
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Bật bot mặc định</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Tất cả hội thoại mới sẽ tự động bật AI bot — không cần toggle thủ công từng conversation
                </p>
              </div>
              <button
                onClick={toggleDefault}
                disabled={saving || !settings}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  settings?.defaultEnabled ? "bg-blue-600" : "bg-gray-300"
                } ${saving ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings?.defaultEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Status badge */}
            {settings && (
              <div className="px-5 py-3 bg-gray-50">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
                    settings.defaultEnabled
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      settings.defaultEnabled ? "bg-green-500" : "bg-gray-400"
                    }`}
                  />
                  {settings.defaultEnabled
                    ? "Bot đang bật cho tất cả hội thoại"
                    : "Bot tắt theo mặc định — cần bật thủ công từng conversation"}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Dự án Getfly */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-green-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Dự án Getfly</h2>
            <span className="text-xs text-gray-400">{projects.length} dự án</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => syncProjects(false)}
                className="flex items-center gap-1.5 text-xs bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync
              </button>
              <button
                onClick={() => syncProjects(true)}
                className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                title="AI suggest keywords cho dự án đang trống"
              >
                <Zap className="w-3.5 h-3.5" />
                AI Fill
              </button>
            </div>
          </div>

          {syncStatus && (
            <div className="px-5 py-2.5 bg-green-50 border-b border-green-100">
              <p className="text-xs text-green-700">{syncStatus}</p>
            </div>
          )}

          {/* Project list */}
          <div className="divide-y divide-gray-100">
            {projects.map((p) => {
              const isExpanded = expandedId === p.id;
              const edit = editState[p.id] ?? { keywords: p.keywords, domains: p.domains };
              const isSaving = savingId === p.id;
              const isSaved  = savedId  === p.id;

              return (
                <div key={p.id}>
                  {/* Row header */}
                  <button
                    onClick={() => toggleExpand(p.id, p)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className="text-xs text-gray-400 w-6 shrink-0">#{p.id}</span>
                    <span className="text-sm font-medium text-gray-800 flex-1">{p.name}</span>
                    {p.keywords.length === 0 && p.id !== 41 && (
                      <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">no keywords</span>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </button>

                  {/* Expanded edit form */}
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100 space-y-3">
                      <div className="pt-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Keywords <span className="text-gray-400 font-normal">(Enter hoặc dấu , để thêm)</span>
                        </label>
                        <TagInput
                          value={edit.keywords}
                          onChange={(v) => setEditState((prev) => ({ ...prev, [p.id]: { ...edit, keywords: v } }))}
                          placeholder="vd: springville, spring ville..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Domains <span className="text-gray-400 font-normal">(pattern domain website)</span>
                        </label>
                        <TagInput
                          value={edit.domains}
                          onChange={(v) => setEditState((prev) => ({ ...prev, [p.id]: { ...edit, domains: v } }))}
                          placeholder="vd: spring-ville.city, springville..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Fanpage IDs <span className="text-gray-400 font-normal">(fallback khi không match keyword)</span>
                        </label>
                        <TagInput
                          value={edit.pageIds ?? []}
                          onChange={(v) => setEditState((prev) => ({ ...prev, [p.id]: { ...edit, pageIds: v } }))}
                          placeholder="vd: 280565692725266..."
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => saveProject(p.id)}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                        >
                          {isSaved ? <Check className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          {isSaving ? "Đang lưu..." : isSaved ? "Đã lưu!" : "Lưu"}
                        </button>
                        <button
                          onClick={() => {
                            setEditState((prev) => ({ ...prev, [p.id]: { keywords: [...p.keywords], domains: [...p.domains], pageIds: [...(p.pageIds ?? [])] } }));
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
                        >
                          Hoàn tác
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Prompt */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-600" />
            <h2 className="font-semibold text-gray-800 text-sm">System Prompt</h2>
          </div>

          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Reload prompt từ file</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sau khi chỉnh sửa file <code className="bg-gray-100 px-1 rounded">skills/*.md</code>, nhấn để áp dụng ngay mà không cần restart
              </p>
            </div>
            <button
              onClick={reloadPrompt}
              className="flex items-center gap-1.5 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              Reload
            </button>
          </div>
        </section>

        {/* Developer tools */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold text-gray-800 text-sm">Developer Tools</h2>
          </div>

          <div className="divide-y divide-gray-100">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Xóa lịch sử hội thoại</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Xóa memory + context AI. Giữ nguyên trạng thái bật/tắt bot
                </p>
              </div>
              <button
                onClick={() => resetMemory(false)}
                className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Xóa history
              </button>
            </div>

            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Reset toàn bộ</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Xóa tất cả — memory, trạng thái bật/tắt, cache prompt. Dùng khi test lại từ đầu
                </p>
              </div>
              <button
                onClick={() => resetMemory(true)}
                className="text-xs bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Full reset
              </button>
            </div>
          </div>

          {resetStatus && (
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-600">{resetStatus}</p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
