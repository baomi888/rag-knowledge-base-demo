"use client";

import * as React from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageBubble } from "./MessageBubble";
import { RefModal } from "./RefModal";
import { useApp } from "./AppContext";
import type { ChatMessage, OpenRefPayload } from "@/lib/types";

export function ComparePanel() {
  const {
    leftMessages,
    rightMessages,
    leftParams,
    rightParams,
    runCompare,
    isStreaming,
    streamStatus,
    indexStatus,
  } = useApp();

  const [input, setInput] = React.useState<string>("");
  const leftScrollRef = React.useRef<HTMLDivElement | null>(null);
  const rightScrollRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const syncing = React.useRef<boolean>(false);

  // 输入内容变化时自动撑高输入框（上限后内部滚动）
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const [openRef, setOpenRef] = React.useState<OpenRefPayload | null>(null);

  function syncScroll(source: "left" | "right") {
    if (syncing.current) return;
    const src = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const dst = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!src || !dst) return;
    syncing.current = true;
    try {
      const ratio =
        src.scrollHeight - src.clientHeight === 0
          ? 0
          : src.scrollTop / (src.scrollHeight - src.clientHeight);
      dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
    } finally {
      // release flag on next frame
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    }
  }

  // auto-scroll to bottom on new messages
  React.useEffect(() => {
    const l = leftScrollRef.current;
    const r = rightScrollRef.current;
    if (l) l.scrollTop = l.scrollHeight;
    if (r) r.scrollTop = r.scrollHeight;
  }, [leftMessages, rightMessages, streamStatus]);

  async function handleSend() {
    if (!input.trim()) return;
    await runCompare(input);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文输入法选词/确认时的 Enter 不应发送消息
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <section className="flex flex-1 flex-col bg-background">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        {isStreaming ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{streamStatus || "对比生成中..."}</span>
          </>
        ) : (
          <>
            <span>对比模式</span>
            <span>·</span>
            <span>
              左库 {indexStatus?.left.chunks ?? 0} 片段 /{" "}
              {indexStatus?.left.files.length ?? 0} 文件
            </span>
            <span>·</span>
            <span>
              右库 {indexStatus?.right.chunks ?? 0} 片段 /{" "}
              {indexStatus?.right.files.length ?? 0} 文件
            </span>
          </>
        )}
      </div>

      {/* 小屏上下堆叠，md+ 左右并排 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <CompareSide
          title="左侧"
          params={leftParams}
          messages={leftMessages}
          scrollRef={leftScrollRef}
          onScroll={() => syncScroll("left")}
          onOpenRef={(ref, msg) =>
            setOpenRef({ ref, kb: msg.params.kb, params: msg.params })
          }
        />
        <div className="h-px w-full bg-border md:h-auto md:w-px" />
        <CompareSide
          title="右侧"
          params={rightParams}
          messages={rightMessages}
          scrollRef={rightScrollRef}
          onScroll={() => syncScroll("right")}
          onOpenRef={(ref, msg) =>
            setOpenRef({ ref, kb: msg.params.kb, params: msg.params })
          }
        />
      </div>

      <div className="border-t border-border bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入问题，将同时发送到左右两侧..."
            className="min-h-[44px] max-h-40 flex-1 resize-none overflow-y-auto"
            rows={1}
          />
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={!input.trim() || isStreaming}
            aria-label="发送对比"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <RefModal payload={openRef} onClose={() => setOpenRef(null)} />
    </section>
  );
}

function CompareSide({
  title,
  params,
  messages,
  scrollRef,
  onScroll,
  onOpenRef,
}: {
  title: string;
  params: { chunk_size: number; chunk_overlap: number; top_k: number };
  messages: ReturnType<typeof useApp>["leftMessages"];
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onOpenRef: (r: ChatMessage["refs"][number], msg: ChatMessage) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold">{title}</span>
        <Badge variant="secondary">size={params.chunk_size}</Badge>
        <Badge variant="secondary">overlap={params.chunk_overlap}</Badge>
        <Badge variant="secondary">top_k={params.top_k}</Badge>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无对话
          </div>
        ) : (
          <div className="flex flex-col py-2">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenRef={onOpenRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
