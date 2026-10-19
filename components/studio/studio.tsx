"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Brush, Download, Eraser, Hand, ImagePlus, Layers, ShieldCheck, Sparkles, Sun, Undo2 } from "lucide-react";
import Viewer from "./viewer";
import { payloadForm } from "@/lib/studio/transport";
import { MODEL, PRICING, QUALITIES, SIZES, sizeError, type Quality, type StudioPayload } from "@/lib/studio/config";
import { composite, hasSelection, loadImage, maskCanvas, normalizePhoto, prepareInput, type Stroke } from "@/lib/studio/canvas";
import { workspaceStore } from "@/lib/studio/storage";
import type { Job } from "@/lib/studio/server";
type Source = { url: string; width: number; height: number; name: string };
type Version = { id: string; url: string; raw: string; base?: Source; width: number; height: number; prompt: string; quality: string; size: string; cost?: number | null; protected: boolean };
type Pending = { id: string; payload: StudioPayload; source?: Source; strokes: Stroke[]; protect: boolean };
type Settings = { quality: Quality; size: string; mode: "edit" | "generate"; local: boolean; protect: boolean; custom: boolean };
type Workspace = { settings?: Settings; source?: Source; versions: Version[]; strokes: Stroke[]; prompt: string; pending?: Pending };
type Quote = { id: string; expires: number; payload: StudioPayload; source?: Source; strokes: Stroke[]; protect: boolean };
async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/studio/${path}`, body === undefined ? { cache: "no-store" } : body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || "请求失败"); return data;
}
function bestSize(w: number, h: number) {
  let best = "1536x1024", score = Infinity;
  for (let x = 256; x <= 3840; x += 16) {
    const y = Math.round(x * h / w / 16) * 16; const size = `${x}x${y}`;
    if (sizeError(size)) continue;
    const s = Math.abs(x / y - w / h) * 100 + (8294400 - x * y) / 8294400;
    if (s < score) { score = s; best = size; }
  }
  return best;
}
export default function Studio() {
  const [source, setSource] = useState<Source>(), [versions, setVersions] = useState<Version[]>([]), [strokes, setStrokes] = useState<Stroke[]>([]);
  const [prompt, setPrompt] = useState(""), [quality, setQuality] = useState<Quality>("max"), [size, setSize] = useState("3840x2160"), [custom, setCustom] = useState(false);
  const [mode, setMode] = useState<"edit" | "generate">("edit"), [local, setLocal] = useState(true), [protect, setProtect] = useState(true);
  const [tool, setTool] = useState<"pan" | "brush" | "erase">("pan"), [radius, setRadius] = useState(100);
  const [selected, setSelected] = useState(""), [comparison, setComparison] = useState("original"), [showMask, setShowMask] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null), [ready, setReady] = useState(false), [pending, setPending] = useState<Pending>(), [quote, setQuote] = useState<Quote>(), [ack, setAck] = useState(false);
  const file = useRef<HTMLInputElement>(null), lock = useRef(false), saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    const refresh = () => {
      api("status").then(s => { if (active) setConfigured(s.configured); }).catch(() => { if (active) setConfigured(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    workspaceStore<Workspace>().then(s => { if (s) { setSource(s.source); setVersions(s.versions); setStrokes(s.strokes); setPrompt(s.prompt); setPending(s.pending); if (s.settings) { setQuality(s.settings.quality); setSize(s.settings.size); setMode(s.settings.mode); setLocal(s.settings.local); setProtect(s.settings.protect); setCustom(s.settings.custom); } else if (s.source) { setSize(bestSize(s.source.width, s.source.height)); setCustom(true); } } }).catch(() => setNotice("无法读取本地历史，请保持页面打开并下载结果。")).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { saveQueue.current = saveQueue.current.then(() => workspaceStore({ source, versions, strokes, prompt, pending, settings: { quality, size, mode, local, protect, custom } })).then(() => {}).catch(() => setNotice("浏览器存储不足或不可用，请下载结果；刷新可能丢失当前工作区。")); }, 400);
    return () => clearTimeout(timer);
  }, [ready, source, versions, strokes, prompt, pending, quality, size, mode, local, protect, custom]);
  const version = versions.find(v => v.id === selected);
  const other = versions.find(v => v.id === comparison);
  const displayedBase = version?.base ?? source;
  const before = version ? (other?.url ?? version.base?.url ?? version.url) : source?.url;
  const width = version?.width ?? source?.width ?? 1600, height = version?.height ?? source?.height ?? 1000;
  const editing = !version && mode === "edit" && Boolean(source);
  const dirty = busy || Boolean(quote) || Boolean(pending);
  async function upload(f?: File) {
    if (!f || dirty) return; setBusy(true); setError("");
    try { const s = await normalizePhoto(f); setSource(s); setStrokes([]); setSelected(""); setMode("edit"); setSize(bestSize(s.width, s.height)); setCustom(true); setTool("pan"); setNotice("原图已保留在本机。API 输入会适配所选分辨率；局部合成导出仍使用原图尺寸。"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function getQuote() {
    if (lock.current || pending) return; lock.current = true; setBusy(true); setError("");
    try {
      if (!prompt.trim()) throw new Error("请描述你想生成或修改的内容。");
      const err = sizeError(size); if (err) throw new Error(err);
      let payload: StudioPayload = { prompt, quality, size };
      let base: Source | undefined;
      if (mode === "edit") {
        if (!source) throw new Error("请先导入照片。"); base = source;
        const selection = local ? maskCanvas(source.width, source.height, strokes) : undefined;
        if (selection && !hasSelection(selection)) throw new Error("请先用画笔涂抹需要修改的区域，或切换到整图精修。");
        const [w, h] = size.split("x").map(Number);
        payload = { ...payload, ...await prepareInput(source.url, w, h, selection) };
      }
      const q = await api("quote", payloadForm(payload));
      setAck(false); setQuote({ id: q.id, expires: q.expires, payload, source: base, strokes: local ? structuredClone(strokes) : [], protect: Boolean(base && local && protect) });
    } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  async function acceptJob(job: Job, p: Pending) {
    if (job.status === "pending") { setNotice("任务尚未完成。稍后点击“检查已有结果”，这只读取本机记录，不会重新生成。若应用中途关闭，任务可能无法恢复。 "); return; }
    if (job.status === "failed") { setError(job.error || "请求失败"); setPending(undefined); return; }
    if (!job.image) throw new Error("结果没有图片");
    let url = job.image;
    if (p.protect && p.source) url = await composite(p.source.url, job.image, maskCanvas(p.source.width, p.source.height, p.strokes));
    const image = await loadImage(url);
    const v: Version = { id: job.id, url, raw: job.image, base: p.source, width: image.naturalWidth, height: image.naturalHeight, prompt: p.payload.prompt, quality: p.payload.quality, size: p.payload.size, cost: job.cost, protected: p.protect };
    setVersions(prev => prev.some(x => x.id === v.id) ? prev : [...prev, v]); setSelected(v.id); setComparison("original"); setPending(undefined); setTool("pan"); setNotice("结果已保存。切换版本、比较和下载均不会产生 API 费用。");
  }
  async function generate() {
    if (!quote || !ack || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const p: Pending = { id: quote.id, payload: quote.payload, source: quote.source, strokes: quote.strokes, protect: quote.protect };
    try {
      // Persist recovery context before the only paid POST. Failure here prevents charging.
      setPending(p);
      await saveQueue.current;
      await workspaceStore({ source, versions, strokes, prompt, pending: p, settings: { quality, size, mode, local, protect, custom } }); setQuote(undefined);
      await acceptJob(await api("generate", payloadForm(p.payload, { quoteId: p.id, confirmed: true })), p);
    } catch (e) { setError(`${(e as Error).message}。不会自动重试。若已提交，请用“检查已有结果”恢复。`); }
    finally { setBusy(false); lock.current = false; }
  }
  async function recover() {
    if (!pending || lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await acceptJob(await api(`status?id=${pending.id}`), pending); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  const download = (url: string, name: string) => { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); };
  return <main className="studio">
    <header className="studio-header"><div className="brand"><Sun size={27} /><div>SUNBURST <span>PHOTO STUDIO</span></div></div><div className="local-badge"><i /> 本地工作台 <span> / </span> {configured === true ? "API Key 已配置" : configured === false ? "等待 API Key" : "正在检查本地服务"}</div><a href={PRICING.url} target="_blank" rel="noreferrer">模型与费用 <ArrowUpRight size={14} /></a></header>
    <div className="studio-body"><aside className="control-panel"><div className="panel-heading"><span>创作面板</span><small>01 / CREATE</small></div>
      <fieldset disabled={dirty || !ready}><div className="segmented"><button className={mode === "edit" ? "active" : ""} onClick={() => { setMode("edit"); setSelected(""); }}>照片精修</button><button className={mode === "generate" ? "active" : ""} onClick={() => { setMode("generate"); setTool("pan"); }}>文字生图</button></div>
      {mode === "edit" && <><button className="upload-card" onClick={() => file.current?.click()}><ImagePlus size={23} /><strong>{source ? "更换照片" : "导入已调色照片"}</strong><span>{source?.name ?? "JPEG / PNG / WebP · 最大 100 MB / 60MP"}</span></button><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="section-label">编辑范围</div><div className="segmented"><button className={!local ? "active" : ""} onClick={() => { setLocal(false); setTool("pan"); }}>整图精修</button><button className={local ? "active" : ""} onClick={() => setLocal(true)}>画笔选区</button></div>
      {local && <div className="mask-controls"><div className="tools">{([{ id: "brush", Icon: Brush, label: "画笔" }, { id: "erase", Icon: Eraser, label: "橡皮" }, { id: "pan", Icon: Hand, label: "平移" }] as const).map(({ id, Icon, label }) => <button key={id} className={tool === id ? "active" : ""} onClick={() => { setSelected(""); setTool(id); }}><Icon size={16} />{label}</button>)}<button aria-label="撤销笔画" disabled={!strokes.length} onClick={() => setStrokes(s => s.slice(0, -1))}><Undo2 size={16} /></button></div><label className="range-label">画笔直径 <span>{radius * 2}px</span><input type="range" min="2" max="500" value={radius} onChange={e => setRadius(+e.target.value)} /></label><div className="mask-actions"><label><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} />显示蒙版</label><button onClick={() => setStrokes([])}>清空选区</button></div><label className="protection"><input type="checkbox" checked={protect} onChange={e => setProtect(e.target.checked)} /><ShieldCheck size={17} /><span>仅合成选区，保护原图像素</span></label></div>}</>}
      <label className="section-label" htmlFor="prompt">{mode === "edit" ? "用自然语言描述修改" : "描述你的画面"}<Sparkles size={14} /></label><textarea id="prompt" value={prompt} maxLength={32000} onChange={e => setPrompt(e.target.value)} placeholder={mode === "edit" ? "例如：保留现有调色与构图，仅增强雪山纹理，让天空云层更有层次。避免过度锐化与饱和。" : "描述主体、光线、构图、风格与细节…"} />
      <div className="prompt-presets">{["天空层次", "雪山细节", "前景清理"].map((p, i) => <button key={p} onClick={() => setPrompt(["保留原有调色和构图，仅优化选区内的天空云层层次与自然光线，避免色带和过饱和。", "保留整体曝光、色彩与构图，仅增强选区内雪山的自然纹理，避免过度锐化和虚构山体。", "保留原有调色，仅移除选区前景中的干扰物，自然补全纹理、光影和景深。"][i])}>{p}</button>)}</div>
      <div className="section-label">生成设置 <span>SUNBURST 2.5</span></div><div className="setting-row"><label>画质<select value={quality} onChange={e => setQuality(e.target.value as Quality)}>{QUALITIES.map(q => <option key={q} value={q}>{q.toUpperCase()}{q === "max" ? " · 最高" : ""}</option>)}</select></label><label>输出格式<div className="static-field">PNG · 无损</div></label></div>
      <label className="resolution-label">API 输出分辨率<select value={custom ? "custom" : size} onChange={e => { if (e.target.value === "custom") setCustom(true); else { setCustom(false); setSize(e.target.value); } }}>{SIZES.map(s => <option key={s}>{s}</option>)}<option value="custom">自定义 / 匹配照片比例</option></select></label>{custom && <input aria-label="自定义分辨率" className="custom-size" value={size} onChange={e => setSize(e.target.value)} />}
      <p className="field-note">{size.split("x").map(Number).reduce((a, b) => a * b, 1) > 3686400 ? "当前为实验性高分辨率，最高 8.29MP。" : "宽高为 16 的倍数，支持自定义比例。"}</p></fieldset>
      <div className="submit-area"><button className="primary-button" disabled={dirty || !ready} onClick={getQuote}><Sparkles size={18} />{busy ? "正在处理…" : "预览费用并生成"}</button><p>每次只生成 1 张 · 确认后才付费 · 不自动重试</p></div>
    </aside>
    <section className="workspace"><div className="workspace-heading"><div><span className="eyebrow">YOUR DIGITAL DARKROOM</span><h1>{version ? "每一处细节，都值得比较。" : "保留你的色彩，精修你的视野。"}</h1></div><span className="quality-badge">{quality.toUpperCase()} QUALITY</span></div>
      {!configured && ready && <div className="setup-message">在项目的 <code>.env.local</code> 中填写 <code>OPENAI_API_KEY=你的密钥</code> 。页面每 5 秒自动检查配置；如仍未识别，请重启服务。密钥仅服务端读取，无需登录此应用。</div>}
      {error && <div role="alert" className="message error">{error}<button aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}{notice && <div role="status" className="message">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
      {pending && <div className="pending-message"><span>{busy ? "Sunburst 正在生成，请保持应用运行。" : "存在已提交的任务，避免重复付费。"}</span><button disabled={busy} onClick={recover}>检查已有结果</button><button disabled={busy} onClick={() => { if (window.confirm("这不会取消 OpenAI 任务或退款。确认已检查用量并仍要解除等待？下一次生成需重新确认费用。")) setPending(undefined); }}>解除等待</button></div>}
      {version && <div className="compare-controls"><label>Before <select aria-label="对比版本" value={comparison} onChange={e => setComparison(e.target.value)}><option value="original">{version.base ? "原始照片" : "当前版本"}</option>{versions.filter(v => v.id !== version.id && v.base?.url === version.base?.url && v.width === version.width && v.height === version.height).map((v) => <option key={v.id} value={v.id}>版本 {versions.indexOf(v) + 1} · {v.quality}</option>)}</select></label><button disabled={dirty} onClick={() => { setSource({ url: version.url, width: version.width, height: version.height, name: `版本 ${versions.indexOf(version) + 1}` }); setStrokes([]); setSelected(""); setMode("edit"); setSize(bestSize(version.width, version.height)); setCustom(true); }}>以此版本继续精修</button><button onClick={() => download(version.raw, `sunburst-${version.id}-AI.png`)}>下载 AI 原始结果</button><button onClick={() => download(version.url, `sunburst-${version.id}.png`)}><Download size={15} />{version.protected ? "下载保护合成 PNG" : "下载 PNG"}</button></div>}
      <Viewer before={before} after={version?.url} width={width} height={height} strokes={editing && local ? strokes : []} onStrokes={setStrokes} tool={editing && local ? tool : "pan"} radius={radius} disabled={busy} showMask={editing && local && showMask} />
      <div className="canvas-caption"><span><ShieldCheck size={14} />{version?.protected ? "选区外解码像素保持不变 · 原始尺寸合成" : "本机查看与合成 · 仅确认生成时发送照片给 OpenAI"}</span><span>{displayedBase?.name || "UNTITLED"}</span></div>
      <div className="versions-heading"><span><Layers size={16} /> 版本记录 <small>{versions.length}</small></span><small>保存在此浏览器 · 下载留存重要作品</small></div><div className="version-strip"><button className={`version-card original-card ${!selected ? "selected" : ""}`} onClick={() => { setSelected(""); setComparison("original"); }}>{source ? <img src={source.url} alt="原图缩略图" /> : <ImagePlus size={28} />}<span>原图 / 编辑选区</span></button>{versions.map((v, i) => <button key={v.id} className={`version-card ${selected === v.id ? "selected" : ""}`} onClick={() => { setSelected(v.id); setComparison("original"); setTool("pan"); }}><img src={v.url} alt={`版本 ${i + 1}`} /><span>V{String(i + 1).padStart(2, "0")} · {v.quality.toUpperCase()}</span><small>{v.cost == null ? "费用未返回" : `参考 $${v.cost.toFixed(4)}`}{v.protected ? " · 局部保护" : ""}</small></button>)}{!versions.length && <div className="versions-empty">你的每一次探索，都会保留在这里。</div>}</div>
      <p className="workflow-note">建议上传 sRGB 副本。工作台使用浏览器 8-bit RGBA；不会保留 RAW、16-bit、EXIF 或原始 ICC。局部保护指蒙版外解码像素不变，边缘抗锯齿像素会混合。整图精修可能改变全部画面。</p>
    </section></div>
    {quote && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="cost-dialog" onKeyDown={e => {
      if (e.key === "Escape" && !busy) setQuote(undefined);
      if (e.key === "Tab") {
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a,button:not(:disabled),input:not(:disabled)'));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}><span className="eyebrow">ONE REQUEST · ONE IMAGE</span><h2 id="confirm-title">确认本次 API 费用</h2><p>{MODEL}<br />{quote.payload.quality.toUpperCase()} · {quote.payload.size} · PNG · 1 张</p><table><tbody><tr><td>文字输入 / 百万 tokens</td><td>$5.00</td></tr><tr><td>图片输入 / 百万 tokens</td><td>$8.00</td></tr><tr><td>图片输出 / 百万 tokens</td><td>$30.00</td></tr></tbody></table><p>无法在生成前准确预估 Sunburst 的 token 数量。举例：10,000 个输出 tokens 为 $0.30，另加输入费用；这不是本次报价或费用上限。</p><p>实际费用以 OpenAI 账单为准。最高画质与高分辨率可能增加费用；应用不会自动重试。<a href={PRICING.url} target="_blank" rel="noreferrer">查看官方单价 ↗</a></p><label className="cost-ack"><input autoFocus type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />我接受按实际 token 计费，并授权这一次请求。</label><div className="dialog-actions"><button disabled={busy} onClick={() => setQuote(undefined)}>返回修改</button><button className="primary-button" disabled={!ack || busy} onClick={generate}>确认付费并生成 1 张</button></div></section></div>}
  </main>;
}
