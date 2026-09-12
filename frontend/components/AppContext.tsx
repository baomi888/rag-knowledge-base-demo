"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  buildIndex,
  compareIndex,
  deleteFile,
  fetchDefaults,
  fetchIndexStatus,
  streamChat,
} from "@/lib/api";
import {
  decodeShareData,
  encodeShareData,
  parseRefsMarkdown,
  uid,
} from "@/lib/utils";
import type {
  ChatDefaults,
  ChatMessage,
  CompareResponse,
  Conversation,
  IndexStatus,
  KBKey,
  KBStatus,
} from "@/lib/types";

export interface Params {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
}

export interface Preset {
  name: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
}

export const PRESETS: Preset[] = [
  { name: "均衡", chunk_size: 500, chunk_overlap: 50, top_k: 3 },
  { name: "精细", chunk_size: 300, chunk_overlap: 30, top_k: 5 },
  { name: "粗略", chunk_size: 800, chunk_overlap: 100, top_k: 2 },
];

// 对话历史本地持久化的存储键（v2：多对话结构；v1 为旧单对话格式，仅作迁移源）
const STORAGE_KEY = "rag-chat-history-v2";
const STORAGE_KEY_V1 = "rag-chat-history-v1";

interface AppState {
  // KB status
  indexStatus: IndexStatus | null;
  defaults: ChatDefaults | null;
  loadingStatus: boolean;

  // current KB
  currentKB: KBKey;
  setCurrentKB: (kb: KBKey) => void;

  // params (single mode)
  params: Params;
  setParams: (p: Partial<Params>) => void;

  // compare params
  leftParams: Params;
  rightParams: Params;
  setLeftParams: (p: Partial<Params>) => void;
  setRightParams: (p: Partial<Params>) => void;

  // compare mode
  compareMode: boolean;
  setCompareMode: (v: boolean) => void;

  // param panel open
  paramPanelOpen: boolean;
  setParamPanelOpen: (v: boolean) => void;

  // mobile sidebar drawer
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  // history search
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;

  // message highlight (search jump target)
  highlightMsgId: string | null;
  focusMessage: (id: string) => void;

  // chat history
  messages: ChatMessage[];
  leftMessages: ChatMessage[];
  rightMessages: ChatMessage[];
  clearMessages: () => void;

  // conversations（每个知识库独立的对话列表）
  conversations: Conversation[];
  activeConvId: string | null;
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;

  // streaming
  isStreaming: boolean;
  streamStatus: string;
  abortRef: React.MutableRefObject<AbortController | null>;

  // drag overlay
  dragActive: boolean;
  setDragActive: (v: boolean) => void;

  // command palette
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  // actions
  refreshStatus: () => Promise<void>;
  sendQuestion: (q: string) => Promise<void>;
  regenerate: (msg: ChatMessage) => Promise<void>;
  runCompare: (q: string) => Promise<void>;
  rebuildIndex: (files?: File[]) => Promise<void>;
  removeKBFile: (file: string) => Promise<void>;
  applyPreset: (preset: Preset) => void;

  // 回溯 / 版本 / 分享
  switchVersion: (msgId: string, dir: 1 | -1) => void;
  editAndResend: (userMsgId: string, newQuestion: string) => Promise<void>;
  buildShareLink: (uptoMsgId?: string) => string;
}

const AppContext = React.createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [indexStatus, setIndexStatus] = React.useState<IndexStatus | null>(null);
  const [defaults, setDefaults] = React.useState<ChatDefaults | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState<boolean>(false);

  const [currentKB, setCurrentKBState] = React.useState<KBKey>("main");
  const [params, setParamsState] = React.useState<Params>({
    chunk_size: 500,
    chunk_overlap: 50,
    top_k: 3,
  });
  const [leftParams, setLeftParamsState] = React.useState<Params>({
    chunk_size: 500,
    chunk_overlap: 50,
    top_k: 3,
  });
  const [rightParams, setRightParamsState] = React.useState<Params>({
    chunk_size: 800,
    chunk_overlap: 100,
    top_k: 3,
  });

  const [compareMode, setCompareMode] = React.useState<boolean>(false);
  const [paramPanelOpen, setParamPanelOpen] = React.useState<boolean>(true);
  const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(false);

  const [searchOpen, setSearchOpen] = React.useState<boolean>(false);
  const [highlightMsgId, setHighlightMsgId] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState<boolean>(false);

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [leftMessages, setLeftMessages] = React.useState<ChatMessage[]>([]);
  const [rightMessages, setRightMessages] = React.useState<ChatMessage[]>([]);

  // 多对话：每个知识库独立的对话列表
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = React.useState<string | null>(null);
  const [activeByKB, setActiveByKB] = React.useState<Record<KBKey, string | null>>({
    main: null,
    left: null,
    right: null,
  });

  // refs：保证跨函数读取到最新值（切换对话/知识库时的同步持久化依赖）
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;
  const activeConvIdRef = React.useRef(activeConvId);
  activeConvIdRef.current = activeConvId;
  const conversationsRef = React.useRef(conversations);
  conversationsRef.current = conversations;
  const currentKBRef = React.useRef(currentKB);
  currentKBRef.current = currentKB;
  const compareModeRef = React.useRef(compareMode);
  compareModeRef.current = compareMode;
  const leftMessagesRef = React.useRef(leftMessages);
  leftMessagesRef.current = leftMessages;
  const rightMessagesRef = React.useRef(rightMessages);
  rightMessagesRef.current = rightMessages;

  const [isStreaming, setIsStreaming] = React.useState<boolean>(false);
  const [streamStatus, setStreamStatus] = React.useState<string>("");
  const abortRef = React.useRef<AbortController | null>(null);

  const [dragActive, setDragActive] = React.useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = React.useState<boolean>(false);

  // Initial load
  React.useEffect(() => {
    // 小屏（< md/768px）默认折叠参数面板，避免挤占聊天区
    if (window.innerWidth < 768) setParamPanelOpen(false);
    void refreshStatus();
    fetchDefaults()
      .then((d) => {
        setDefaults(d);
        setParamsState((p) => ({
          ...p,
          chunk_size: p.chunk_size || d.chunk_size,
          chunk_overlap: p.chunk_overlap || d.chunk_overlap,
          top_k: p.top_k || d.top_k,
        }));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`加载默认参数失败: ${msg}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 历史持久化 + 分享链接载入 ----------
  React.useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#share=")) {
      // 转发链接：载入为当前知识库下的一个新对话（只带文本，不含引用）
      const data = decodeShareData<{
        v: number;
        msgs: { r: string; c: string; t?: number }[];
      }>(hash.slice("#share=".length));
      if (data && Array.isArray(data.msgs) && data.msgs.length > 0) {
        const kb = currentKBRef.current;
        const shared: ChatMessage[] = data.msgs.map((m, i) => ({
          id: uid(),
          role: m.r === "user" ? "user" : "assistant",
          content: m.c,
          refs: [],
          params: { kb, chunk_size: 500, chunk_overlap: 50, top_k: 3 },
          timestamp: m.t ?? Date.now() - (data.msgs.length - i) * 1000,
          versions: [],
          versionIndex: -1,
        }));
        const conv: Conversation = {
          id: uid(),
          kb,
          title: `分享的对话（${shared.length} 条）`,
          messages: shared,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setConversations((prev) => [...prev, conv]);
        setActiveConvId(conv.id);
        setMessages(shared);
        setActiveByKB((prev) => ({ ...prev, [kb]: conv.id }));
        toast.success(`已载入分享的对话（${shared.length} 条消息）`);
      }
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      // 本地历史：优先 v2 多对话格式，其次迁移 v1 旧格式
      try {
        const rawV2 = window.localStorage.getItem(STORAGE_KEY);
        if (rawV2) {
          const data = JSON.parse(rawV2) as {
            conversations?: Conversation[];
            activeByKB?: Partial<Record<KBKey, string | null>>;
            leftMessages?: ChatMessage[];
            rightMessages?: ChatMessage[];
          };
          const convs = Array.isArray(data.conversations) ? data.conversations : [];
          setConversations(convs);
          const ab: Record<KBKey, string | null> = {
            main: data.activeByKB?.main ?? null,
            left: data.activeByKB?.left ?? null,
            right: data.activeByKB?.right ?? null,
          };
          setActiveByKB(ab);
          // 恢复 main 库的激活对话
          const active = convs.find((c) => c.id === ab.main && c.kb === "main");
          if (active) {
            setActiveConvId(active.id);
            setMessages(active.messages);
          }
          if (Array.isArray(data.leftMessages)) setLeftMessages(data.leftMessages);
          if (Array.isArray(data.rightMessages)) setRightMessages(data.rightMessages);
        } else {
          const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
          if (rawV1) {
            const data = JSON.parse(rawV1) as {
              messages?: ChatMessage[];
              leftMessages?: ChatMessage[];
              rightMessages?: ChatMessage[];
            };
            if (Array.isArray(data.leftMessages)) setLeftMessages(data.leftMessages);
            if (Array.isArray(data.rightMessages)) setRightMessages(data.rightMessages);
            // 旧 main 历史迁移为一条对话
            if (Array.isArray(data.messages) && data.messages.length > 0) {
              const firstUser = data.messages.find((m) => m.role === "user");
              const conv: Conversation = {
                id: uid(),
                kb: "main",
                title: firstUser ? firstUser.content.slice(0, 24) : "历史对话",
                messages: data.messages,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              setConversations([conv]);
              setActiveConvId(conv.id);
              setMessages(conv.messages);
              setActiveByKB({ main: conv.id, left: null, right: null });
            }
          }
        }
      } catch {
        // 历史数据损坏时静默丢弃，从空对话开始
      }
    }
    setHydrated(true);
  }, []);

  /** 把当前 messages 同步进激活的对话（标题自动取首个提问）。 */
  function persistCurrent() {
    const id = activeConvIdRef.current;
    if (!id) return;
    const msgs = messagesRef.current;
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const cur = prev[idx]!;
      const firstUser = msgs.find((m) => m.role === "user");
      const title = cur.title || (firstUser ? firstUser.content.slice(0, 24) : "");
      // 内容未变则跳过（切换对话加载后引用相同数组）
      if (cur.messages === msgs && cur.title === title) return prev;
      const next = [...prev];
      next[idx] = { ...cur, messages: msgs.slice(-300), title, updatedAt: Date.now() };
      return next;
    });
  }

  // messages 变化（含流式 token）时同步进激活对话
  React.useEffect(() => {
    if (!hydrated) return;
    persistCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, messages, activeConvId]);

  // 持久化到 localStorage（对话上限 100 条，消息上限 300 条）
  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          conversations: conversations.slice(-100),
          activeByKB,
          leftMessages: leftMessages.slice(-300),
          rightMessages: rightMessages.slice(-300),
        }),
      );
    } catch {
      // 配额不足时静默放弃
    }
  }, [hydrated, conversations, activeByKB, leftMessages, rightMessages]);

  async function refreshStatus() {
    setLoadingStatus(true);
    try {
      const s = await fetchIndexStatus();
      setIndexStatus(s);
      // sync slider values from currently-selected KB when it has params
      const kb = currentKB;
      const status = s[kb];
      if (status.chunk_size != null && status.chunk_overlap != null) {
        setParamsState((p) => ({
          ...p,
          chunk_size: status.chunk_size as number,
          chunk_overlap: status.chunk_overlap as number,
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`获取索引状态失败: ${msg}`);
    } finally {
      setLoadingStatus(false);
    }
  }

  function setCurrentKB(kb: KBKey) {
    if (kb === currentKBRef.current) return;
    // 先把当前对话内容写回，再加载目标库的对话
    persistCurrent();
    setCurrentKBState(kb);
    // sync params from that KB if available
    if (indexStatus) {
      const s = indexStatus[kb];
      if (s.chunk_size != null && s.chunk_overlap != null) {
        setParamsState((p) => ({
          ...p,
          chunk_size: s.chunk_size as number,
          chunk_overlap: s.chunk_overlap as number,
        }));
      }
    }
    // 加载该库上次激活的对话；没有则展示该库最近一条；都没有则进入空白新对话
    const convs = conversationsRef.current;
    const remembered = activeByKB[kb];
    const conv =
      convs.find((c) => c.id === remembered && c.kb === kb) ??
      convs.filter((c) => c.kb === kb).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (conv) {
      setActiveConvId(conv.id);
      setMessages(conv.messages);
      setActiveByKB((prev) => ({ ...prev, [kb]: conv.id }));
    } else {
      setActiveConvId(null);
      setMessages([]);
    }
  }

  function setParams(p: Partial<Params>) {
    setParamsState((prev) => ({ ...prev, ...p }));
  }

  function setLeftParams(p: Partial<Params>) {
    setLeftParamsState((prev) => ({ ...prev, ...p }));
  }

  function setRightParams(p: Partial<Params>) {
    setRightParamsState((prev) => ({ ...prev, ...p }));
  }

  // ---------- 对话操作 ----------

  /** 新建对话：当前库开启空白对话（原对话保留在列表中）。 */
  function newConversation() {
    if (isStreaming) return;
    persistCurrent();
    setActiveConvId(null);
    setMessages([]);
    setActiveByKB((prev) => ({ ...prev, [currentKBRef.current]: null }));
  }

  /** 切换到当前库的某条对话。 */
  function switchConversation(id: string) {
    if (id === activeConvIdRef.current) return;
    const conv = conversationsRef.current.find((c) => c.id === id);
    if (!conv) return;
    if (isStreaming) return;
    persistCurrent();
    setActiveConvId(id);
    setMessages(conv.messages);
    setActiveByKB((prev) => ({ ...prev, [conv.kb]: id }));
  }

  /** 删除对话：若是激活对话则回到空白新对话。 */
  function deleteConversation(id: string) {
    const conv = conversationsRef.current.find((c) => c.id === id);
    if (!conv) return;
    if (!window.confirm(`确定删除对话「${conv.title || "新对话"}」吗？`)) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeConvIdRef.current) {
      setActiveConvId(null);
      setMessages([]);
      setActiveByKB((prev) => ({ ...prev, [conv.kb]: null }));
    }
  }

  function clearMessages() {
    if (!window.confirm("确定清空全部知识库的全部对话历史吗？此操作不可恢复。")) return;
    setConversations([]);
    setActiveConvId(null);
    setMessages([]);
    setLeftMessages([]);
    setRightMessages([]);
    setActiveByKB({ main: null, left: null, right: null });
  }

  function applyPreset(preset: Preset) {
    setParams({
      chunk_size: preset.chunk_size,
      chunk_overlap: preset.chunk_overlap,
      top_k: preset.top_k,
    });
    setLeftParams({
      chunk_size: preset.chunk_size,
      chunk_overlap: preset.chunk_overlap,
      top_k: preset.top_k,
    });
    setRightParams({
      chunk_size: preset.chunk_size,
      chunk_overlap: preset.chunk_overlap,
      top_k: preset.top_k,
    });
    toast.success(`已应用预设: ${preset.name}`);
  }

  async function rebuildIndex(files?: File[]) {
    const useFiles = files ?? [];
    if (useFiles.length === 0 && !indexStatus) {
      toast.error("没有文件可用于建库");
      return;
    }
    const building = toast.loading(
      useFiles.length > 0 ? "正在上传并重建索引..." : "正在重建索引...",
    );
    try {
      const res = await buildIndex({
        files: useFiles,
        chunkSize: params.chunk_size,
        chunkOverlap: params.chunk_overlap,
        kb: currentKB,
      });
      toast.success(
        `建库完成: ${res.chunks} 个片段 (${res.files.length} 个文件)`,
        { id: building },
      );
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`建库失败: ${msg}`, { id: building });
    }
  }

  async function removeKBFile(file: string) {
    const removing = toast.loading("正在移除文件并重建索引...");
    try {
      const res = await deleteFile({ kb: currentKB, file });
      toast.success(res.status, { id: removing });
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`移除失败: ${msg}`, { id: removing });
    }
  }

  async function sendQuestion(question: string) {
    const q = question.trim();
    if (!q) return;
    if (isStreaming) return;

    // 懒创建：空白新对话首次发送时才真正建立对话记录
    if (!activeConvIdRef.current) {
      const conv: Conversation = {
        id: uid(),
        kb: currentKBRef.current,
        title: q.slice(0, 24),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations((prev) => [...prev, conv]);
      setActiveConvId(conv.id);
      activeConvIdRef.current = conv.id;
      setActiveByKB((prev) => ({ ...prev, [conv.kb]: conv.id }));
    }

    const msgParams = {
      kb: currentKB,
      chunk_size: params.chunk_size,
      chunk_overlap: params.chunk_overlap,
      top_k: params.top_k,
    };
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: q,
      refs: [],
      params: msgParams,
      timestamp: Date.now(),
      versions: [],
      versionIndex: -1,
    };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      refs: [],
      params: msgParams,
      timestamp: Date.now(),
      versions: [],
      versionIndex: -1,
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    await streamIntoMessage(q, { kb: msgParams.kb, top_k: msgParams.top_k }, assistantId);
  }

  /** 把流式回答写入指定 assistant 消息；完成后追加为一个新版本（回溯用）。 */
  async function streamIntoMessage(
    question: string,
    p: { kb: KBKey; top_k: number },
    assistantId: string,
  ) {
    const ac = new AbortController();
    abortRef.current = ac;
    setIsStreaming(true);
    setStreamStatus("准备中...");

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      await streamChat(
        { question, top_k: p.top_k, kb: p.kb },
        {
          onStatus: (text) => setStreamStatus(text),
          onToken: (text, refsMd) =>
            patch((m) => ({
              ...m,
              content: text,
              refs: parseRefsMarkdown(refsMd),
              error: undefined,
            })),
          onDone: (answer, refsMd) => {
            const refs = parseRefsMarkdown(refsMd);
            patch((m) => {
              const versions = [...(m.versions ?? []), { content: answer, refs }];
              return {
                ...m,
                content: answer,
                refs,
                versions,
                versionIndex: versions.length - 1,
              };
            });
            setStreamStatus("");
          },
          onError: (detail) => {
            patch((m) => {
              // 失败时回滚到上一个版本，避免半截内容留在界面上
              const v = m.versions?.[m.versionIndex ?? -1];
              return {
                ...m,
                content: v?.content ?? "",
                refs: v?.refs ?? [],
                error: detail,
              };
            });
            setStreamStatus("");
            toast.error(detail);
          },
        },
        ac.signal,
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamStatus("");
    }
  }

  async function regenerate(msg: ChatMessage) {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === msg.id);
    if (idx > 0) {
      const prev = messages[idx - 1];
      if (prev && prev.role === "user") {
        // 不删除旧回答：在原消息上追加新版本，可用 ‹ 1/2 › 回溯切换
        await streamIntoMessage(prev.content, { kb: msg.params.kb, top_k: msg.params.top_k }, msg.id);
        return;
      }
    }
    toast.error("找不到对应的问题");
  }

  /** 回溯：编辑某条历史提问，截断其后所有消息并重新生成。 */
  async function editAndResend(userMsgId: string, newQuestion: string) {
    if (isStreaming) return;
    const q = newQuestion.trim();
    if (!q) return;
    const idx = messages.findIndex((m) => m.id === userMsgId);
    if (idx === -1) return;
    const src = messages[idx];
    if (!src || src.role !== "user") return;

    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      refs: [],
      params: src.params,
      timestamp: Date.now(),
      versions: [],
      versionIndex: -1,
    };
    setMessages((prev) => [
      ...prev.slice(0, idx).map((m) =>
        m.id === userMsgId ? { ...m, content: q, timestamp: Date.now() } : m,
      ),
      assistantMsg,
    ]);
    await streamIntoMessage(q, { kb: src.params.kb, top_k: src.params.top_k }, assistantId);
  }

  /** 回溯：在同一问题的多个历史回答版本间切换。 */
  function switchVersion(msgId: string, dir: 1 | -1) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.versions || m.versions.length === 0) return m;
        const cur = m.versionIndex ?? m.versions.length - 1;
        const next = cur + dir;
        if (next < 0 || next >= m.versions.length) return m;
        const v = m.versions[next]!;
        return { ...m, versionIndex: next, content: v.content, refs: v.refs, error: undefined };
      }),
    );
  }

  /** 转发：把当前对话（截至某条消息）编码进 URL，生成可分享的链接。 */
  function buildShareLink(uptoMsgId?: string): string {
    let list = messages;
    if (uptoMsgId) {
      const i = messages.findIndex((m) => m.id === uptoMsgId);
      if (i !== -1) list = messages.slice(0, i + 1);
    }
    const msgs = list.slice(-30).map((m) => ({
      r: m.role === "user" ? "user" : "assistant",
      c: m.content.length > 4000 ? `${m.content.slice(0, 4000)}…` : m.content,
      t: m.timestamp,
    }));
    const payload = encodeShareData({ v: 1, msgs });
    return `${window.location.origin}${window.location.pathname}#share=${payload}`;
  }

  /** 搜索跳转：定位到目标消息并短暂高亮（必要时切换主区/对比模式）。
   * 用 ref 读取状态，确保跨对话切换后仍能正确判断。 */
  function focusMessage(id: string) {
    setHighlightMsgId(id);
    window.setTimeout(() => {
      const inMain = messagesRef.current.some((m) => m.id === id);
      const inCompare =
        leftMessagesRef.current.some((m) => m.id === id) ||
        rightMessagesRef.current.some((m) => m.id === id);
      if (inMain && compareModeRef.current) setCompareMode(false);
      if (inCompare && !compareModeRef.current) setCompareMode(true);
      const sel = `[data-msg-id="${id.replace(/"/g, '\\"')}"]`;
      document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    window.setTimeout(() => {
      setHighlightMsgId((cur) => (cur === id ? null : cur));
    }, 2400);
  }

  async function runCompare(question: string) {
    const q = question.trim();
    if (!q) return;
    if (isStreaming) return;
    setIsStreaming(true);
    setStreamStatus("正在对比两侧知识库...");

    const userTs = Date.now();
    const leftUser: ChatMessage = {
      id: uid(),
      role: "user",
      content: q,
      refs: [],
      params: {
        kb: "left",
        chunk_size: leftParams.chunk_size,
        chunk_overlap: leftParams.chunk_overlap,
        top_k: leftParams.top_k,
      },
      timestamp: userTs,
    };
    const rightUser: ChatMessage = { ...leftUser, id: uid(), params: { ...leftUser.params, kb: "right" as const, chunk_size: rightParams.chunk_size, chunk_overlap: rightParams.chunk_overlap } };

    const leftAsst: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      refs: [],
      params: leftUser.params,
      timestamp: userTs,
    };
    const rightAsst: ChatMessage = {
      ...leftAsst,
      id: uid(),
      params: rightUser.params,
    };
    setLeftMessages((m) => [...m, leftUser, leftAsst]);
    setRightMessages((m) => [...m, rightUser, rightAsst]);

    try {
      const res: CompareResponse = await compareIndex({
        question: q,
        top_k: leftParams.top_k,
        left_params: {
          chunk_size: leftParams.chunk_size,
          chunk_overlap: leftParams.chunk_overlap,
        },
        right_params: {
          chunk_size: rightParams.chunk_size,
          chunk_overlap: rightParams.chunk_overlap,
        },
      });
      applySide("left", res.left, leftAsst.id);
      applySide("right", res.right, rightAsst.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`对比失败: ${msg}`);
      setLeftMessages((prev) =>
        prev.map((m) =>
          m.id === leftAsst.id ? { ...m, error: msg } : m,
        ),
      );
      setRightMessages((prev) =>
        prev.map((m) =>
          m.id === rightAsst.id ? { ...m, error: msg } : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setStreamStatus("");
    }
  }

  function applySide(side: "left" | "right", data: CompareResponse["left"], msgId: string) {
    const setter = side === "left" ? setLeftMessages : setRightMessages;
    if (data.status === "error") {
      setter((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: "", refs: [], error: data.detail ?? "错误" }
            : m,
        ),
      );
      return;
    }
    // Backend /api/compare already returns structured refs[].
    const refs = Array.isArray(data.refs) ? data.refs : [];
    setter((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, content: data.answer, refs }
          : m,
      ),
    );
  }

  const value: AppState = {
    indexStatus,
    defaults,
    loadingStatus,
    currentKB,
    setCurrentKB,
    params,
    setParams,
    leftParams,
    rightParams,
    setLeftParams,
    setRightParams,
    compareMode,
    setCompareMode,
    paramPanelOpen,
    setParamPanelOpen,
    sidebarOpen,
    setSidebarOpen,
    searchOpen,
    setSearchOpen,
    highlightMsgId,
    focusMessage,
    messages,
    leftMessages,
    rightMessages,
    clearMessages,
    conversations,
    activeConvId,
    newConversation,
    switchConversation,
    deleteConversation,
    isStreaming,
    streamStatus,
    abortRef,
    dragActive,
    setDragActive,
    paletteOpen,
    setPaletteOpen,
    refreshStatus,
    sendQuestion,
    regenerate,
    runCompare,
    rebuildIndex,
    removeKBFile,
    applyPreset,
    switchVersion,
    editAndResend,
    buildShareLink,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useKBStatus(kb: KBKey): KBStatus | null {
  const { indexStatus } = useApp();
  return indexStatus ? indexStatus[kb] : null;
}
