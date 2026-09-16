"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useApp } from "./AppContext";
import { formatTime } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

type Area = "main" | "left" | "right";

const AREA_LABEL: Record<Area, string> = {
  main: "主库",
  left: "左库",
  right: "右库",
};

interface SearchItem {
  msg: ChatMessage;
  area: Area;
  /** 消息所属对话（主库消息才有；对比模式左右栏为 null） */
  convId?: string;
  convTitle?: string;
}

export function SearchHistory() {
  const {
    searchOpen,
    setSearchOpen,
    leftMessages,
    rightMessages,
    focusMessage,
    conversations,
    activeConvId,
    switchConversation,
  } = useApp();

  const [query, setQuery] = React.useState<string>("");
  const [selected, setSelected] = React.useState<number>(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // 搜索范围：全部知识库的全部对话 + 对比模式左右两栏
  const results = React.useMemo<SearchItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all: SearchItem[] = [
      ...conversations.flatMap((c) =>
        c.messages.map((m) => ({ msg: m, area: c.kb as Area, convId: c.id, convTitle: c.title })),
      ),
      ...leftMessages.map((m) => ({ msg: m, area: "left" as const })),
      ...rightMessages.map((m) => ({ msg: m, area: "right" as const })),
    ];
    return all
      .filter((it) => it.msg.content && it.msg.content.toLowerCase().includes(q))
      .sort((a, b) => b.msg.timestamp - a.msg.timestamp)
      .slice(0, 50);
  }, [query, conversations, leftMessages, rightMessages]);

  React.useEffect(() => setSelected(0), [query, searchOpen]);

  React.useEffect(() => {
    if (searchOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [searchOpen]);

  // Ctrl+F / Cmd+F 打开历史搜索（拦截浏览器查找）
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  function jump(item: SearchItem) {
    setSearchOpen(false);
    // 命中其他对话时先切换过去，再定位高亮（focusMessage 内部延时等状态提交）
    if (item.convId && item.convId !== activeConvId) {
      switchConversation(item.convId);
    }
    focusMessage(item.msg.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[selected];
      if (item) jump(item);
    }
  }

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="top-[15%] translate-y-0 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索历史对话..."
            className="rounded-none border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-1">
          {query.trim() === "" ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              输入关键词搜索全部知识库的全部对话（含对比模式左右两栏）
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有找到相关消息
            </div>
          ) : (
            results.map((item, idx) => (
              <button
                key={item.msg.id}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => jump(item)}
                className={
                  "flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors duration-200 " +
                  (idx === selected ? "bg-accent/15" : "hover:bg-accent/5")
                }
              >
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {item.msg.role === "user" ? (
                    <span>🐰</span>
                  ) : (
                    /* AI 头像：小猪图片缩略版 */
                    <img src="/pig.jpg" alt="AI" className="inline-block h-3.5 w-3.5 rounded-full object-cover align-[-2px]" />
                  )}
                  <Badge variant="secondary">{AREA_LABEL[item.area]}</Badge>
                  {item.convTitle && (
                    <span className="max-w-[10rem] truncate">「{item.convTitle}」</span>
                  )}
                  <span>{formatTime(item.msg.timestamp)}</span>
                </div>
                <p className="line-clamp-2 text-xs text-foreground">
                  <HighlightText
                    text={snippet(item.msg.content, query.trim())}
                    query={query.trim()}
                  />
                </p>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          ↑↓ 选择 · Enter 跳转高亮 · Esc 关闭 · Ctrl+F 随时打开
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 截取命中位置附近的文本片段 */
function snippet(text: string, q: string, radius = 40): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  return (start > 0 ? "…" : "") + text.slice(start, idx + q.length + radius);
}

/** 高亮文本中的关键词 */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i <= lower.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={k++} className="rounded bg-primary/30 px-0.5 text-foreground">
        {text.slice(idx, idx + ql.length)}
      </mark>,
    );
    i = idx + ql.length;
  }
  return <>{parts}</>;
}
