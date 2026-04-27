import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface PageToken {
  id: string;
  name: string;
  accessToken: string;
  category: string;
  picture?: string;
}

export interface SessionData {
  isLoggedIn?: boolean;
  userToken?: string;
  // Pages không lưu vào cookie (quá lớn) — dùng lib/pages.ts để đọc từ env
}

const sessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: "mess_app_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
