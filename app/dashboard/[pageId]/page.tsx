import { MessageCircle } from "lucide-react";

export default function SelectConversationPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
      <MessageCircle className="w-16 h-16 opacity-20" />
      <p className="text-lg font-medium">Chọn một hội thoại</p>
      <p className="text-sm">Chọn từ danh sách bên trái để bắt đầu đọc tin nhắn</p>
    </div>
  );
}
