import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import UhchatPanel from "@/components/UhchatPanel";
import { MessageSquare, LogOut, Settings, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function UhchatPage() {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  return (
    <div className="flex h-screen bg-gray-50 flex-col overflow-hidden">
      {/* Top nav */}
      <header className="bg-blue-800 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-blue-200 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
          <span className="text-blue-500">|</span>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            <span className="font-bold text-sm">Website Chat</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="flex items-center gap-1 text-xs text-blue-200 hover:text-white transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Cài đặt
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-1 text-xs text-blue-200 hover:text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Đăng xuất
            </button>
          </form>
        </div>
      </header>

      {/* Panel chiếm toàn bộ màn hình còn lại */}
      <div className="flex-1 overflow-hidden">
        <UhchatPanel />
      </div>
    </div>
  );
}
