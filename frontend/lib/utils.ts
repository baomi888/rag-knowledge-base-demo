import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function extractFileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Parse a Markdown refs blob (returned by backend) into structured RefItem[].
 *
 * 后端 rag_core._format_refs 的真实格式（按 ｜ 分三段）：
 *   **[1]** nba.txt 第3页 ｜ score=0.410 ｜ NBA（美国职业篮球联赛）知识库 NBA 成立于...
 *
 * 同时兼容旧格式（行首 [n]，后续行为片段文本）：
 *   [1] **file.pdf** (p.3) (score=0.87)
 *   snippet text ...
 */
export function parseRefsMarkdown(md: string): { index: number; file: string; page?: number | null; score?: number; text: string }[] {
  const out: { index: number; file: string; page?: number | null; score?: number; text: string }[] = [];
  if (!md) return out;
  const lines = md.split("\n");
  let current: { index: number; file: string; page?: number | null; score?: number; text: string } | null = null;

  // 行首角标：兼容 [1] / **[1]** 两种写法
  const headRe = /^\s*\**\[(\d+)\]\**\s*(.*)$/;
  const scoreRe = /score\s*=\s*([0-9.]+)/i;

  const push = () => {
    if (current) out.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw;
    const m = line.match(headRe);
    if (!m) {
      // 旧格式：非角标行作为片段文本累积
      if (current && !current.text) current.text = line.trimEnd();
      continue;
    }
    push();
    const idx = parseInt(m[1], 10);
    const rest = m[2].trim();
    // 按全角/半角竖线分段：文件+页码 ｜ score ｜ 片段预览
    const segs = rest.split(/[｜|]/).map((s) => s.trim());
    if (segs.length >= 3) {
      const headPart = segs[0]!.replace(/\*\*/g, "").trim();
      const pageM = headPart.match(/第\s*(\d+)\s*页/);
      const file = pageM
        ? headPart.replace(/第\s*\d+\s*页/, "").trim()
        : headPart;
      const scoreM = segs[1]!.match(scoreRe);
      const text = segs.slice(2).join("｜").replace(/\.{3}$/, "").trim();
      current = {
        index: idx,
        file: file || "(未知文件)",
        page: pageM ? parseInt(pageM[1], 10) : null,
        score: scoreM ? parseFloat(scoreM[1]) : undefined,
        text,
      };
    } else {
      // 旧格式兜底：[1] **file.pdf** (p.3) (score=0.87)
      const fileM = rest.match(/\*+([^\*\n]+)\*+/);
      const pageM = rest.match(/p\.?\s*(\d+)/i);
      const scoreM = rest.match(scoreRe);
      current = {
        index: idx,
        file: fileM ? fileM[1]!.trim() : rest.replace(/\*\*/g, "").trim() || "(未知文件)",
        page: pageM ? parseInt(pageM[1], 10) : null,
        score: scoreM ? parseFloat(scoreM[1]) : undefined,
        text: "",
      };
    }
  }
  push();
  return out;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- 剪贴板 / 分享链接 / 时间格式化 ----------

/** 复制文本到剪贴板（非安全上下文时回退 execCommand） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 消息时间：今天显示 HH:MM，否则 M/D HH:MM */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** UTF-8 安全的 base64 编码（用于分享链接） */
export function encodeShareData(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** 与 encodeShareData 配套的解码，失败返回 null */
export function decodeShareData<T>(s: string): T | null {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
