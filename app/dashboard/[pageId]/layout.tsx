import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPagesFromEnv, getPageFromEnv } from "@/lib/pages";
import PageSwitcher from "@/components/PageSwitcher";
import ConversationList from "@/components/ConversationList";
import WebhookStatus from "@/components/WebhookStatus";
import { MessageSquare, LogOut, Megaphone, Bug, Settings } from "lucide-react";
import Link from "next/link";

interface Props {
  children: React.ReactNode;
  params: Promise<{ pageId: string }>;
}

export default async function PageLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  const { pageId } = await params;
  const pages = getPagesFromEnv();
  const page = getPageFromEnv(pageId);

  if (!page) redirect("/dashboard");

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className="w-[300px] flex-shrink-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="bg-blue-800 p-3">
          <Link href="/dashboard" className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-white" />
            <span className="font-bold text-base text-white">Mess App</span>
          </Link>
          <PageSwitcher pages={pages} />
        </div>

        <div className="flex-1 overflow-hidden">
          <ConversationList pageId={pageId} />
        </div>

        <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-3">
          <Link
            href="/ads"
            className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700 transition-colors"
          >
            <Megaphone className="w-3.5 h-3.5" />
            Ads leads
          </Link>
          <Link
            href="/debug"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Bug className="w-3.5 h-3.5" />
            Webhook log
          </Link>
        </div>

        <WebhookStatus pageId={pageId} />

        <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="text-xs text-gray-500 truncate">
            <span className="font-medium">{page.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Cài đặt
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
