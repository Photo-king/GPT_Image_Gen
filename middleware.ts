import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  // The old photobooth endpoint automatically generated multiple paid styles.
  if (req.nextUrl.pathname.startsWith("/api/photobooth")) return NextResponse.json({ error: "旧版批量生成已停用，请使用工作台费用确认流程。" }, { status: 410 });
  const host = req.headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return NextResponse.json({ error: "仅允许本机访问" }, { status: 403 });
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  let sameOrigin = false;
  try { sameOrigin = new URL(origin || referer || "").origin === `http://${host}`; } catch { /* deny */ }
  if (!sameOrigin) return NextResponse.json({ error: "Forbidden - invalid Origin/Referer" }, { status: 403 });
  const type = req.headers.get("content-type") || "";
  const multipart = /^\/api\/studio\/(quote|generate)$/.test(req.nextUrl.pathname) && type.startsWith("multipart/form-data");
  if (req.method === "POST" && !type.startsWith("application/json") && !multipart) return NextResponse.json({ error: "Unsupported Media Type" }, { status: 415 });
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*"] };
