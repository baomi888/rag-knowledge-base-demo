export type KBKey = "main" | "left" | "right";

export interface KBStatus {
  chunks: number;
  chunk_size: number | null;
  chunk_overlap: number | null;
  files: string[];
}

export interface IndexStatus {
  main: KBStatus;
  left: KBStatus;
  right: KBStatus;
}

export interface BuildIndexResponse {
  chunks: number;
  status: string;
  kb: KBKey;
  files: string[];
}

export interface ChatDefaults {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  supported_extensions: string[];
  max_upload_mb: number;
}

export interface RefItem {
  index: number;
  file: string;
  page?: number | null;
  score?: number;
  text: string;
}

export interface MessageParams {
  kb: KBKey;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
}

export type Role = "user" | "assistant" | "system";

/** 回溯用：同一条 assistant 消息的一个历史回答版本 */
export interface MessageVersion {
  content: string;
  refs: RefItem[];
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  refs: RefItem[];
  params: MessageParams;
  timestamp: number;
  error?: string;
  /** 重新生成的全部版本（含当前），配合 versionIndex 实现 ‹1/2› 回溯 */
  versions?: MessageVersion[];
  versionIndex?: number;
}

/** 引用弹窗载荷：片段 + 来源知识库上下文 */
export interface OpenRefPayload {
  ref: RefItem;
  kb: KBKey;
  params: MessageParams;
}

/** 一段对话：归属于某个知识库，支持多对话切换 */
export interface Conversation {
  id: string;
  kb: KBKey;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CompareSide {
  status: string;
  chunk_size: number;
  chunk_overlap: number;
  chunks: number;
  answer: string;
  refs: RefItem[];
  detail?: string;
}

export interface CompareResponse {
  left: CompareSide;
  right: CompareSide;
}

// Raw SSE event payloads — refs in token/done are Markdown strings from backend.
export interface SSEStatusPayload {
  text: string;
}

export interface SSETokenPayload {
  text: string;
  refs: string;
}

export interface SSEDonePayload {
  answer: string;
  refs: string;
}

export interface SSEErrorPayload {
  detail: string;
}
