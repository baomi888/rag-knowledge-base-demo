import type {
  BuildIndexResponse,
  ChatDefaults,
  CompareResponse,
  IndexStatus,
  KBKey,
} from "./types";

const BASE = "http://localhost:8000";

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string };
    if (data && typeof data.detail === "string") return data.detail;
    return `请求失败 (${res.status})`;
  } catch {
    return `请求失败 (${res.status})`;
  }
}

export async function fetchIndexStatus(): Promise<IndexStatus> {
  const res = await fetch(`${BASE}/api/index/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as IndexStatus;
}

export async function fetchDefaults(): Promise<ChatDefaults> {
  const res = await fetch(`${BASE}/api/config/defaults`, { cache: "no-store" });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as ChatDefaults;
}

export async function buildIndex(opts: {
  files: File[];
  chunkSize: number;
  chunkOverlap: number;
  kb: KBKey;
}): Promise<BuildIndexResponse> {
  const form = new FormData();
  for (const f of opts.files) form.append("files", f);
  form.append("chunk_size", String(opts.chunkSize));
  form.append("chunk_overlap", String(opts.chunkOverlap));
  form.append("kb", opts.kb);
  const res = await fetch(`${BASE}/api/index/build`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as BuildIndexResponse;
}

export async function deleteFile(opts: {
  kb: KBKey;
  file: string;
}): Promise<BuildIndexResponse> {
  const qs = new URLSearchParams({ kb: opts.kb, file: opts.file });
  const res = await fetch(`${BASE}/api/index/file?${qs.toString()}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as BuildIndexResponse;
}

export interface FileContentResponse {
  file: string;
  name: string;
  ext: string;
  content: string;
  total_chars: number;
  truncated: boolean;
}

/** 原文预览：获取 data/ 内文件的文本内容（引用弹窗用） */
export async function fetchFileContent(file: string): Promise<FileContentResponse> {
  const qs = new URLSearchParams({ file });
  const res = await fetch(`${BASE}/api/index/file/content?${qs.toString()}`);
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as FileContentResponse;
}

export interface ChatStreamHandlers {
  onStatus?: (text: string) => void;
  onToken?: (text: string, refsMd: string) => void;
  onDone?: (answer: string, refsMd: string) => void;
  onError?: (detail: string) => void;
}

export async function streamChat(
  body: { question: string; top_k: number; kb: KBKey },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await parseError(res);
    handlers.onError?.(detail);
    return;
  }
  if (!res.body) {
    handlers.onError?.("响应为空");
    return;
  }
  await consumeSSEStream(res.body, handlers);
}

export async function compareIndex(opts: {
  question: string;
  top_k: number;
  left_params: { chunk_size: number; chunk_overlap: number };
  right_params: { chunk_size: number; chunk_overlap: number };
}): Promise<CompareResponse> {
  const res = await fetch(`${BASE}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as CompareResponse;
}

async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        dispatchEvent(rawEvent, handlers);
      }
    }
    // flush remaining buffer
    if (buffer.trim().length > 0) {
      dispatchEvent(buffer, handlers);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // user-initiated abort; do not surface as error
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    handlers.onError?.(msg);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function dispatchEvent(raw: string, handlers: ChatStreamHandlers): void {
  const lines = raw.split(/\r?\n/);
  let eventName = "message";
  let dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return;
  const dataStr = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }

  if (eventName === "status" && isRecord(data)) {
    const t = data.text;
    if (typeof t === "string") handlers.onStatus?.(t);
  } else if (eventName === "token" && isRecord(data)) {
    const t = data.text;
    const r = typeof data.refs === "string" ? data.refs : "";
    if (typeof t === "string") handlers.onToken?.(t, r);
  } else if (eventName === "done" && isRecord(data)) {
    const a = data.answer;
    const r = typeof data.refs === "string" ? data.refs : "";
    if (typeof a === "string") handlers.onDone?.(a, r);
  } else if (eventName === "error" && isRecord(data)) {
    const d = data.detail;
    handlers.onError?.(typeof d === "string" ? d : "未知错误");
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
