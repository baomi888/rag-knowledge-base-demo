"use client";

import * as React from "react";
import { Send, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "./MessageBubble";
import { RefModal } from "./RefModal";
import { useApp } from "./AppContext";
import type { OpenRefPayload } from "@/lib/types";

export function ChatArea() {
  const {
    messages,
    sendQuestion,
    isStreaming,
    streamStatus,
    abortRef,
    params,
    currentKB,
    indexStatus,
    regenerate,
  } = useApp();

  const [input, setInput] = React.useState<string>("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [openRef, setOpenRef] = React.useState<OpenRefPayload | null>(null);
  const stickToBottom = React.useRef<boolean>(true);

  // 输入内容变化时自动撑高输入框（上限后内部滚动）
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Auto-scroll to bottom when new messages arrive (only if user was near bottom).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamStatus]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 80;
  }

  async function handleSend() {
    if (!input.trim()) return;
    await sendQuestion(input);
    setInput("");
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文输入法选词/确认时的 Enter 不应发送消息
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const kbStatus = indexStatus?.[currentKB];

  return (
    <section className="flex flex-1 flex-col bg-background">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        {isStreaming ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{streamStatus || "生成中..."}</span>
          </>
        ) : (
          <>
            <span>当前库: {currentKB}</span>
            <span>·</span>
            <span>片段数: {kbStatus?.chunks ?? 0}</span>
            <span>·</span>
            <span>
              chunk={params.chunk_size} / overlap={params.chunk_overlap} /
              top_k={params.top_k}
            </span>
          </>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* 马卡龙可爱风空状态：小猫打招呼 + 示例问题引导 */
          <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-5xl shadow-[0_6px_20px_rgba(244,143,177,0.18)]">
              🐱
            </div>
            <p className="text-base font-medium text-foreground">
              喵~ 我是你的知识库小助手！
            </p>
            <p>选好知识库就可以提问啦</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["什么是RAG？", "科比单场最高分是多少？", "光速是多少？"].map(
                (q) => (
                  <button
                    key={q}
                    onClick={() => void sendQuestion(q)}
                    disabled={isStreaming}
                    className="rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs text-primary transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {q}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col py-2">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenRef={(ref, msg) =>
                  setOpenRef({ ref, kb: msg.params.kb, params: msg.params })
                }
                onRegenerate={m.role === "assistant" ? regenerate : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
            className="min-h-[44px] max-h-40 flex-1 resize-none overflow-y-auto"
            rows={1}
          />
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={handleStop}
              aria-label="停止生成"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <RefModal payload={openRef} onClose={() => setOpenRef(null)} />
    </section>
  );
}
