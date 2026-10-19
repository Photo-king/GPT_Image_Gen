import { readStudioRequest } from "@/lib/studio/request";
import { validatePayload } from "@/lib/studio/config";
import { runJob } from "@/lib/studio/server";
export const runtime = "nodejs";
export const maxDuration = 900;
export async function POST(request: Request) {
  try {
    const body = await readStudioRequest(request);
    if (body?.confirmed !== true || typeof body?.quoteId !== "string") throw new Error("必须先确认费用");
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return Response.json({ error: "缺少 OPENAI_API_KEY" }, { status: 503 });
    const job = await runJob(body.quoteId, validatePayload(body.payload), key);
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "请求失败" }, { status: 400 }); }
}
