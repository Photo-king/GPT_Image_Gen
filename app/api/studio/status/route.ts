import { readJob } from "@/lib/studio/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) return Response.json((await readJob(id)) ?? { status: "pending", id, error: "尚无结果记录；不会重新发送付费请求。" }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ configured: Boolean(process.env.OPENAI_API_KEY?.trim()) }, { headers: { "Cache-Control": "no-store" } });
}
