import { MessageSquare } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Chính sách Quyền riêng tư — Mess App",
  description: "Chính sách quyền riêng tư của ứng dụng Mess App",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
            <MessageSquare className="w-5 h-5" />
            <span className="font-bold text-base">Mess App</span>
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-500 text-sm">Chính sách Quyền riêng tư</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Chính sách Quyền riêng tư
        </h1>
        <p className="text-sm text-gray-400 mb-8">
          Cập nhật lần cuối: {new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "long", year: "numeric" })}
        </p>

        <div className="prose prose-gray max-w-none space-y-8">

          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Giới thiệu</h2>
            <p className="text-gray-600 leading-relaxed">
              Mess App ("chúng tôi", "ứng dụng") là công cụ quản lý tin nhắn Messenger trên Facebook
              Fanpage thông qua API của Meta. Chính sách này giải thích cách chúng tôi thu thập, sử
              dụng và bảo vệ thông tin của bạn khi sử dụng ứng dụng.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Thông tin chúng tôi thu thập</h2>
            <p className="text-gray-600 leading-relaxed mb-3">
              Khi bạn đăng nhập bằng Facebook, chúng tôi thu thập:
            </p>
            <ul className="list-disc list-inside text-gray-600 space-y-2 pl-2">
              <li>
                <strong>Page Access Token</strong> — để đọc và gửi tin nhắn Messenger thay mặt
                fanpage của bạn.
              </li>
              <li>
                <strong>Thông tin fanpage</strong> — tên, ID, danh mục và ảnh đại diện của các
                fanpage bạn quản lý.
              </li>
              <li>
                <strong>Nội dung hội thoại</strong> — danh sách hội thoại và tin nhắn được hiển
                thị trực tiếp từ API của Meta; chúng tôi không lưu trữ chúng lên máy chủ của mình.
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">3. Cách chúng tôi sử dụng thông tin</h2>
            <ul className="list-disc list-inside text-gray-600 space-y-2 pl-2">
              <li>Hiển thị danh sách hội thoại và nội dung tin nhắn trong giao diện ứng dụng.</li>
              <li>Cho phép bạn trả lời tin nhắn từ khách hàng trực tiếp trong ứng dụng.</li>
              <li>Xác thực quyền truy cập vào các trang fanpage bạn sở hữu.</li>
            </ul>
            <p className="text-gray-600 leading-relaxed mt-3">
              Chúng tôi <strong>không</strong> bán, chia sẻ, hay sử dụng dữ liệu của bạn cho mục
              đích quảng cáo hoặc phân tích của bên thứ ba.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Lưu trữ dữ liệu</h2>
            <p className="text-gray-600 leading-relaxed">
              Page Access Token được lưu trong session cookie mã hóa trên trình duyệt của bạn
              (sử dụng <code className="bg-gray-100 px-1 rounded text-sm">iron-session</code>).
              Cookie có thời hạn <strong>7 ngày</strong> và tự động hết hạn sau đó. Chúng tôi
              không lưu token hay tin nhắn vào cơ sở dữ liệu.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Quyền của bạn</h2>
            <ul className="list-disc list-inside text-gray-600 space-y-2 pl-2">
              <li>
                <strong>Thu hồi quyền truy cập:</strong> Vào{" "}
                <a
                  href="https://www.facebook.com/settings?tab=applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  Cài đặt Facebook → Ứng dụng và trang web
                </a>{" "}
                để xóa quyền của Mess App.
              </li>
              <li>
                <strong>Đăng xuất:</strong> Sử dụng nút "Đăng xuất" trong ứng dụng để xóa session
                cookie ngay lập tức.
              </li>
              <li>
                <strong>Xóa dữ liệu:</strong> Vì chúng tôi không lưu dữ liệu trên máy chủ, việc
                đăng xuất và thu hồi quyền trên Facebook là đủ để xóa hoàn toàn.
              </li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Bảo mật</h2>
            <p className="text-gray-600 leading-relaxed">
              Session cookie được mã hóa bằng AES-GCM và chỉ gửi qua HTTPS (trong môi trường
              production). Chúng tôi không log hay lưu trữ access token dưới bất kỳ hình thức
              nào ngoài cookie mã hóa phía client.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">7. API của Meta / Facebook</h2>
            <p className="text-gray-600 leading-relaxed">
              Ứng dụng sử dụng{" "}
              <a
                href="https://developers.facebook.com/docs/graph-api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                Facebook Graph API v25.0
              </a>
              . Việc sử dụng dữ liệu từ Meta tuân theo{" "}
              <a
                href="https://developers.facebook.com/terms/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                Điều khoản nền tảng Meta
              </a>{" "}
              và{" "}
              <a
                href="https://www.facebook.com/policy.php"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                Chính sách dữ liệu Facebook
              </a>
              .
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Thay đổi chính sách</h2>
            <p className="text-gray-600 leading-relaxed">
              Chúng tôi có thể cập nhật chính sách này theo thời gian. Mọi thay đổi sẽ được đăng
              tải tại trang này với ngày cập nhật mới. Việc tiếp tục sử dụng ứng dụng sau khi thay
              đổi được coi là bạn chấp nhận chính sách mới.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Liên hệ</h2>
            <p className="text-gray-600 leading-relaxed">
              Nếu bạn có câu hỏi về chính sách quyền riêng tư này, vui lòng liên hệ qua email
              hoặc tạo issue trên repository của dự án.
            </p>
          </section>
        </div>

        {/* Back link */}
        <div className="mt-12 pt-8 border-t border-gray-100">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
          >
            ← Quay về trang chủ
          </Link>
        </div>
      </main>
    </div>
  );
}
