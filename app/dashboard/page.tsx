import { getSession } from "@/lib/session";
import { getPagesFromEnv } from "@/lib/pages";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Building2, LogOut, Settings } from "lucide-react";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  const pages = getPagesFromEnv();

  if (pages.length === 1) {
    redirect(`/dashboard/${pages[0].id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-blue-800 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          <span className="font-bold text-lg">Mess App</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-sm text-blue-200 hover:text-white transition-colors"
          >
            <Settings className="w-4 h-4" />
            Cài đặt
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-1 text-sm text-blue-200 hover:text-white transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Đăng xuất
            </button>
          </form>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <h2 className="text-xl font-semibold text-gray-700 mb-6">
          Chọn Fanpage để quản lý tin nhắn
        </h2>

        {pages.length === 0 ? (
          <div className="text-center text-gray-400">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Chưa có fanpage nào trong cấu hình.</p>
            <p className="text-sm mt-1">Thêm PAGE_TOKEN_1, PAGE_ID_1 vào .env.local rồi restart server.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-3xl">
            {pages.map((page) => (
              <Link
                key={page.id}
                href={`/dashboard/${page.id}`}
                className="flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all group"
              >
                {page.picture ? (
                  <img
                    src={page.picture}
                    alt={page.name}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-6 h-6 text-blue-600" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 truncate group-hover:text-blue-700">
                    {page.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{page.id}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
