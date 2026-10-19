import { MAX_INPUT_BYTES, validatePayload } from "./config";
export async function readStudioRequest(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return request.json();
  const size = Number(request.headers.get("content-length"));
  if (size > 2 * MAX_INPUT_BYTES + 1_000_000) throw new Error("上传请求过大");
  const form = await request.formData();
  const metadata = form.get("metadata");
  if (typeof metadata !== "string" || metadata.length > 100_000) throw new Error("无效上传参数");
  const body = JSON.parse(metadata);
  const payload = validatePayload(body?.payload);
  for (const field of ["image", "mask"] as const) {
    const file = form.get(field);
    if (file === null) continue;
    if (typeof file === "string" || file.type !== "image/png" || !file.size || file.size >= MAX_INPUT_BYTES) throw new Error("API 输入及蒙版须为小于 50 MB 的 PNG 文件");
    payload[field] = `data:image/png;base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }
  return { ...body, payload: validatePayload(payload) };
}
