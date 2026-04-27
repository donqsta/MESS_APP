import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPageFromEnv } from "@/lib/pages";
import { getConversation } from "@/lib/facebook";
import { getAdLeadBySender } from "@/lib/ad-store";
import MessageThread from "@/components/MessageThread";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface Props {
  params: Promise<{ pageId: string; conversationId: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  const { pageId, conversationId } = await params;
  const page = getPageFromEnv(pageId);
  if (!page) redirect("/dashboard");

  let conversation = null;
  let otherParticipant = null;
  let pageParticipantId = pageId; // fallback
  let adLead = undefined;

  try {
    conversation = await getConversation(conversationId, page.accessToken);
    // Identify which participant is the user (not the page)
    const participants = conversation.participants.data;
    
    // Người dùng là participant có ID khác với Page ID
    const userParticipant = participants.find((p) => p.id !== pageId);
    otherParticipant = userParticipant ?? participants[0];
    
    const pageParticipant = participants.find((p) => p.id === pageId);
    pageParticipantId = pageParticipant?.id ?? pageId;
    
    // Fetch Ad Lead for this user if available
    if (otherParticipant?.id && otherParticipant.id !== pageId) {
      adLead = getAdLeadBySender(otherParticipant.id);
    }
  } catch {
    // If we can't load, still show thread
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Conversation header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white shadow-sm">
        <Link
          href={`/dashboard/${pageId}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 md:hidden"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
          {otherParticipant?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div>
          <p className="font-semibold text-gray-800 text-sm">
            {otherParticipant?.name ?? "Người dùng"}
          </p>
          <p className="text-xs text-gray-400">Messenger · {page.name}</p>
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-hidden">
        <MessageThread
          conversationId={conversationId}
          pageId={pageId}
          pageScoped={pageParticipantId}
          initialRecipientId={otherParticipant?.id ?? ""}
          initialAdLead={adLead}
        />
      </div>
    </div>
  );
}
