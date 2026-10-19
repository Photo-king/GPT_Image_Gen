import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { MODEL, PRICING, type StudioPayload, type Usage, usageCost } from "./config";
const root = () => process.env.STUDIO_DATA_DIR || path.join(process.cwd(), ".local", "studio");
const digest = (p: StudioPayload) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
export type Job = { id: string; status: "pending" | "complete" | "failed"; image?: string; error?: string; usage?: Usage; cost?: number | null; requestId?: string; createdAt: string };
export async function makeQuote(payload: StudioPayload) {
  await mkdir(path.join(root(), "quotes"), { recursive: true, mode: 0o700 });
  const id = randomUUID(), expires = Date.now() + 10 * 60_000;
  await writeFile(path.join(root(), "quotes", id + ".json"), JSON.stringify({ hash: digest(payload), expires }), { mode: 0o600, flag: "wx" });
  return { id, expires, model: MODEL, pricing: PRICING, quality: payload.quality, size: payload.size };
}
export async function readJob(id: string): Promise<Job | null> {
  if (!validId(id)) return null;
  try { return JSON.parse(await readFile(path.join(root(), "jobs", id, "result.json"), "utf8")); }
  catch { return null; }
}
async function saveJob(job: Job) {
  const dir = path.join(root(), "jobs", job.id);
  await writeFile(path.join(dir, "result.tmp"), JSON.stringify(job), { mode: 0o600 });
  await rename(path.join(dir, "result.tmp"), path.join(dir, "result.json"));
}
export async function runJob(id: string, payload: StudioPayload, apiKey: string): Promise<Job> {
  if (!validId(id)) throw new Error("无效确认单");
  const quote = JSON.parse(await readFile(path.join(root(), "quotes", id + ".json"), "utf8"));
  if (quote.hash !== digest(payload)) throw new Error("参数已改变，请重新确认费用");
  const existing = await readJob(id);
  if (existing) return existing;
  if (quote.expires < Date.now()) throw new Error("确认单已过期，请重新确认");
  await mkdir(path.join(root(), "jobs"), { recursive: true, mode: 0o700 });
  const job: Job = { id, status: "pending", createdAt: new Date().toISOString() };
  // Atomic directory creation is a durable at-most-once gate, including after restarts.
  try { await mkdir(path.join(root(), "jobs", id), { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return (await readJob(id)) ?? job; throw e; }
  await saveJob(job);
  try {
    const settings = { model: MODEL, prompt: payload.prompt, quality: payload.quality, size: payload.size, n: 1, output_format: "png" };
    let body: FormData | string;
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (payload.image) {
      const form = new FormData();
      for (const [key, value] of Object.entries(settings)) form.set(key, String(value));
      for (const [field, url] of [["image[]", payload.image], ["mask", payload.mask]] as const) {
        if (url) form.set(field, new Blob([Buffer.from(url.slice(url.indexOf(",") + 1), "base64")], { type: "image/png" }), field === "mask" ? "mask.png" : "image.png");
      }
      body = form;
    } else {
      body = JSON.stringify(settings);
      headers["Content-Type"] = "application/json";
    }
    // Native fetch never retries. The same confirmation still permits only one call.
    const response = await fetch(`https://api.openai.com/v1/images/${payload.image ? "edits" : "generations"}`, {
      method: "POST", headers, body, signal: AbortSignal.timeout(15 * 60_000),
    });
    job.requestId = response.headers.get("x-request-id") ?? undefined;
    const result = await response.json();
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${result.error?.message || "请求失败"}`);
    if (!result.data?.[0]?.b64_json) throw new Error("未收到最终图片");
    job.image = `data:image/png;base64,${result.data[0].b64_json}`;
    job.usage = result.usage;
    job.cost = usageCost(result.usage);
    job.status = "complete";
  } catch (error) {
    job.status = "failed";
    job.error = `${error instanceof Error ? error.message : "请求失败"}。未自动重试；超时或网络中断仍可能已计费，请先查看 OpenAI 用量。`;
  }
  await saveJob(job);
  return job;
}
