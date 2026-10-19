import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { validatePayload, sizeError, usageCost } from "../lib/studio/config";
import { blendPixels } from "../lib/studio/pixels";
import { makeQuote, runJob, readJob } from "../lib/studio/server";
import { POST } from "../app/api/studio/generate/route";
import { readStudioRequest } from "../lib/studio/request";
import { payloadForm } from "../lib/studio/transport";
const p = { prompt: "保留调色，仅增强山峰细节", quality: "max" as const, size: "3840x2160" };
test("Sunburst resolution bounds include 4K portrait, landscape and square", () => {
  for (const size of ["3840x2160", "2160x3840", "2880x2880", "3456x2304", "1024x1024"]) assert.equal(sizeError(size), null);
  for (const size of ["3840x3840", "4096x2048", "1234x1024", "16x16", "3840x256", "bad"]) assert.ok(sizeError(size));
  assert.throws(() => validatePayload({ ...p, quality: "ultra" }));
  assert.throws(() => validatePayload({ ...p, mask: "data:image/png;base64,YQ==" }));
});
test("local composite preserves every unselected RGBA byte and blends only mask coverage", () => {
  const original = new Uint8ClampedArray([17, 41, 82, 255, 24, 33, 44, 255, 11, 22, 33, 0]);
  const generated = new Uint8ClampedArray([250, 250, 250, 255, 124, 133, 144, 255, 100, 101, 102, 255]);
  const mask = new Uint8ClampedArray([0,0,0,0, 0,0,0,128, 0,0,0,255]);
  const result = blendPixels(original, generated, mask);
  assert.deepEqual([...result.slice(0,4)], [...original.slice(0,4)]);
  assert.deepEqual([...result.slice(4,8)], [74,83,94,255]);
  assert.deepEqual([...result.slice(8)], [...generated.slice(8)]);
  assert.deepEqual([...original.slice(4,8)], [24,33,44,255]);
});
test("cost uses returned modality tokens, never fabricates a missing usage estimate", () => {
  assert.equal(usageCost(), null);
  assert.equal(usageCost({ output_tokens: 10000 }), null);
  assert.equal(usageCost({ output_tokens: 10000, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 } }), .321);
});
test("one confirmation permits at most one upstream call across concurrent and later submissions", async (t) => {
  const old = process.env.STUDIO_DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "studio-test-")); process.env.STUDIO_DATA_DIR = dir;
  let calls = 0; let upstream: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/images/generations"); upstream = JSON.parse(String(init?.body));
    return Response.json({ data: [{ b64_json: "YQ==" }], usage: { output_tokens: 10000, input_tokens_details: { text_tokens: 0, image_tokens: 0 } } });
  });
  try {
    const q = await makeQuote(p);
    await assert.rejects(runJob(q.id, { ...p, size: "1024x1024" }, "test-key"), /参数已改变/);
    await Promise.all([runJob(q.id, p, "test-key"), runJob(q.id, p, "test-key")]);
    assert.equal(calls, 1); assert.equal(upstream.model, "gpt-image-2.5-sunburst"); assert.equal(upstream.quality, "max"); assert.equal(upstream.size, "3840x2160"); assert.equal(upstream.n, 1);
    assert.equal((await runJob(q.id, p, "test-key")).status, "complete"); assert.equal(calls, 1);
    assert.equal((await readJob(q.id))?.cost, .3);
  } finally { if (old === undefined) delete process.env.STUDIO_DATA_DIR; else process.env.STUDIO_DATA_DIR = old; await rm(dir, { recursive: true }); }
});
test("masked edits forward alpha mask; failed requests are never automatically retried", async (t) => {
  const old = process.env.STUDIO_DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "studio-test-")); process.env.STUDIO_DATA_DIR = dir;
  const payload = { ...p, image: "data:image/png;base64,YQ==", mask: "data:image/png;base64,Yg==" }; let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/images/edits"); const body = init?.body as FormData;
    assert.ok(body instanceof FormData);
    assert.equal(await (body.get("image[]") as Blob).text(), "a");
    assert.equal(await (body.get("mask") as Blob).text(), "b");
    assert.equal(body.get("quality"), "max");
    assert.equal(body.get("size"), "3840x2160");
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    throw new Error("network interrupted");
  });
  try { const q = await makeQuote(payload); assert.equal((await runJob(q.id, payload, "test-key")).status, "failed"); await runJob(q.id, payload, "test-key"); assert.equal(calls, 1); }
  finally { if (old === undefined) delete process.env.STUDIO_DATA_DIR; else process.env.STUDIO_DATA_DIR = old; await rm(dir, { recursive: true }); }
});
test("unconfirmed requests, cross-site requests, nonlocal hosts and legacy paid route are blocked", async () => {
  const r = await POST(new Request("http://127.0.0.1/api/studio/generate", { method: "POST", body: JSON.stringify({ payload: p }) })); assert.equal(r.status, 400);
  const request = (host: string, origin: string, route = "studio/generate") => new NextRequest(`http://localhost:3000/api/${route}`, { method: "POST", headers: { host, origin, "Content-Type": "application/json" } });
  assert.equal(middleware(request("127.0.0.1:3000", "http://127.0.0.1:3000")).status, 200);
  assert.equal(middleware(request("127.0.0.1:3000", "https://evil.example")).status, 403);
  assert.equal(middleware(request("evil.example", "http://evil.example")).status, 403);
  assert.equal(middleware(request("127.0.0.1:3000", "http://127.0.0.1:3000", "photobooth")).status, 410);
});

test("24 MB PNG survives browser/server/upstream multipart transport without resolution or byte changes", async (t) => {
  const old = process.env.STUDIO_DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "studio-large-")); process.env.STUDIO_DATA_DIR = dir;
  const bytes = Buffer.alloc(24_000_000, 137);
  const image = "data:image/png;base64," + bytes.toString("base64");
  const payload = { ...p, image, mask: "data:image/png;base64,Yg==" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    calls++;
    const form = init?.body as FormData;
    const file = form.get("image[]") as Blob;
    assert.equal(file.size, bytes.length);
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes));
    assert.equal(form.get("size"), "3840x2160");
    assert.equal(form.get("quality"), "max");
    return Response.json({ data: [{ b64_json: "YQ==" }] });
  });
  try {
    assert.equal(validatePayload(payload).image, image);
    const body = payloadForm(payload);
    assert.equal((body.get("image") as Blob).size, bytes.length);
    const request = new Request("http://127.0.0.1/api/studio/quote", { method: "POST", body });
    const parsed = await readStudioRequest(request);
    assert.equal(parsed.payload.image, image);
    const q = await makeQuote(parsed.payload);
    assert.equal(calls, 0, "quote must not upload to OpenAI");
    assert.equal((await runJob(q.id, parsed.payload, "test-key")).status, "complete");
    await runJob(q.id, parsed.payload, "test-key");
    assert.equal(calls, 1);
  } finally { if (old === undefined) delete process.env.STUDIO_DATA_DIR; else process.env.STUDIO_DATA_DIR = old; await rm(dir, { recursive: true }); }
});
test("binary file limit replaces 20 MiB encoded-string limit", () => {
  const make = (bytes: number) => ({ ...p, image: "data:image/png;base64," + Buffer.alloc(bytes).toString("base64") });
  assert.doesNotThrow(() => validatePayload(make(49_000_000)));
  assert.throws(() => validatePayload(make(50_000_000)), /50 MB/);
});
test("multipart upload still requires a local origin", () => {
  for (const origin of ["http://127.0.0.1:3000", "https://evil.example"]) {
    const req = new NextRequest("http://localhost:3000/api/studio/quote", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "Content-Type": "multipart/form-data; boundary=test" } });
    assert.equal(middleware(req).status, origin.startsWith("http://127") ? 200 : 403);
  }
});
