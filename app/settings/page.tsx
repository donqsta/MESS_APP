"use client";

import { useEffect, useState } from "react";
import { Bot, ChevronLeft, RotateCcw, Zap, MessageSquare } from "lucide-react";
import Link from "next/link";

interface BotSettings {
  defaultEnabled: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bot/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(console.error);
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
