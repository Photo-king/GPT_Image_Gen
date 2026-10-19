import { readStudioRequest } from "@/lib/studio/request";
import { validatePayload } from "@/lib/studio/config";
import { makeQuote } from "@/lib/studio/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) return Response.json({ error: "请先在 .env.local 配置 OPENAI_API_KEY，然后重启应用。" }, { status: 503 });
    const body = await readStudioRequest(request);
    const payload = validatePayload(body.payload ?? body);
    return Response.json(await makeQuote(payload));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "请求无效" }, { status: 400 }); }
}
