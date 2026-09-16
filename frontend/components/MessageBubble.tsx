"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Pencil,
  RefreshCw,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "./AppContext";
import { copyText } from "@/lib/utils";
import type { ChatMessage, RefItem } from "@/lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
  /** 打开引用弹窗，携带所属消息（含知识库/参数上下文） */
  onOpenRef?: (ref: RefItem, msg: ChatMessage) => void;
  onRegenerate?: (msg: ChatMessage) => void;
}

// Split text by [n] citation markers, preserving the markers.
const REF_RE = /\[(\d+)\]/g;

const KB_LABEL: Record<string, string> = {
  main: "主库",
  left: "左库",
  right: "右库",
};

export function MessageBubble({
  message,
  onOpenRef,
  onRegenerate,
}: MessageBubbleProps) {
  const [showRefs, setShowRefs] = React.useState<boolean>(true);
  const [editing, setEditing] = React.useState<boolean>(false);
  const [draft, setDraft] = React.useState<string>("");
  // 点击角标的弹跳反馈：记录正在弹跳的角标编号
  const [popIdx, setPopIdx] = React.useState<number | null>(null);
  const popTimer = React.useRef<number | null>(null);
  const {
    compareMode,
    isStreaming,
    highlightMsgId,
    switchVersion,
    editAndResend,
    buildShareLink,
  } = useApp();

  const highlighted = highlightMsgId === message.id;
  const versions = message.versions ?? [];
  const vIdx = message.versionIndex ?? versions.length - 1;

  async function handleShare() {
    const link = buildShareLink(message.id);
    const ok = await copyText(link);
    if (ok) toast.success("分享链接已复制，发给好友打开即可查看这段对话");
    else toast.error("复制失败");
  }

  function startEdit() {
    setDraft(message.content);
    setEditing(true);
  }

  async function saveEdit() {
    const q = draft.trim();
    if (!q) return;
    setEditing(false);
    await editAndResend(message.id, q);
  }

  function renderContent(text: string) {
    if (!text) return null;
    const parts = text.split(REF_RE);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const idx = parseInt(part, 10);
        const ref = message.refs.find((r) => r.index === idx);
        return (
          <button
            key={i}
            onClick={() => {
              // 点击反馈：弹跳动画 + 打开弹窗（找不到引用数据时也打开，显示占位信息）
              setPopIdx(idx);
              if (popTimer.current) window.clearTimeout(popTimer.current);
              popTimer.current = window.setTimeout(() => setPopIdx(null), 400);
              const fallback = {
                index: idx,
                file: "",
                page: null,
                score: undefined,
                text: "",
              };
              onOpenRef?.(ref ?? fallback, message);
            }}
            className={
              "mx-0.5 rounded-md bg-accent/20 px-1.5 py-0.5 text-[11px] font-semibold text-accent transition-colors duration-200 hover:bg-accent/30 active:scale-90 " +
              (popIdx === idx ? "citation-pop" : "")
            }
            title={ref ? `${KB_LABEL[message.params.kb] ?? message.params.kb} · ${ref.file} (相似度 ${ref.score ?? "-"})` : `引用 [${idx}]`}
          >
            [{idx}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  // ---------- 用户消息：可复制 / 编辑重发（回溯） ----------
  if (message.role === "user") {
    return (
      <div
        data-msg-id={message.id}
        className={
          "group/msg flex justify-end rounded-2xl px-4 py-2 transition-shadow duration-500 " +
          (highlighted ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "")
        }
      >
        {editing ? (
          <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-2xl border border-primary/25 bg-primary/5 p-3 shadow-sm">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              rows={3}
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                保存后回溯到此处，后续消息将被替换
              </span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void saveEdit()}
                  disabled={!draft.trim() || isStreaming}
                >
                  保存并重新生成
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex max-w-[80%] items-start gap-2">
            <div className="flex flex-col items-end gap-1">
              <div className="rounded-3xl rounded-tr-md border border-primary/20 bg-primary/10 px-4 py-2.5 shadow-[0_4px_14px_rgba(244,143,177,0.15)]">
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
              </div>
              {/* Kimi 风悬停工具条：复制 / 编辑重发（回溯） */}
              <div className="flex gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover/msg:opacity-100">
                <CopyButton getText={() => message.content} />
                {!compareMode && (
                  <IconBtn title="编辑并重新生成" onClick={startEdit} disabled={isStreaming}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
              </div>
            </div>
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-base shadow-sm">
              🐰
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- 助手消息 ----------
  if (message.error) {
    return (
      <div className="flex justify-start px-4 py-2">
        <div className="max-w-[80%]">
          <div className="rounded-2xl rounded-tl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <p className="text-sm text-destructive-foreground">⚠️ {message.error}</p>
            {onRegenerate && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 border-destructive/30"
                onClick={() => onRegenerate(message)}
                disabled={isStreaming}
              >
                重试
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-msg-id={message.id}
      className={
        "group/msg flex justify-start rounded-2xl px-4 py-2 transition-shadow duration-500 " +
        (highlighted ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "")
      }
    >
      <div className="mt-0.5 h-8 w-8 overflow-hidden rounded-full bg-accent/15 shadow-sm">
        {/* AI 头像：自定义小猪图片（frontend/public/pig.jpg），放大裁边保持与空状态一致 */}
        <img src="/pig.jpg" alt="AI" className="h-full w-full scale-[1.45] object-cover" />
      </div>
      <div className="ml-2 flex max-w-[80%] flex-col gap-1.5">
        <div className="rounded-3xl rounded-tl-md border border-border bg-card px-4 py-2.5 shadow-[0_4px_14px_rgba(0,0,0,0.06)]">
          <div className="text-sm leading-relaxed">
            {message.content ? (
              renderContent(message.content)
            ) : (
              <span className="inline-block h-4 w-2 animate-pulse rounded bg-accent/40" />
            )}
          </div>
        </div>

        {/* 豆包风悬停工具条：版本回溯 ‹1/2› / 复制 / 刷新 / 转发 */}
        <div className="flex items-center gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover/msg:opacity-100">
          {versions.length > 1 && (
            <div className="mr-1 flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <IconBtn
                title="上一个版本"
                onClick={() => switchVersion(message.id, -1)}
                disabled={isStreaming || vIdx <= 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </IconBtn>
              <span className="tabular-nums">
                {vIdx + 1}/{versions.length}
              </span>
              <IconBtn
                title="下一个版本"
                onClick={() => switchVersion(message.id, 1)}
                disabled={isStreaming || vIdx >= versions.length - 1}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          )}
          <CopyButton getText={() => message.content} />
          {onRegenerate && (
            <IconBtn
              title="换一个回答"
              onClick={() => onRegenerate(message)}
              disabled={isStreaming}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {!compareMode && (
            <IconBtn title="复制分享链接" onClick={() => void handleShare()}>
              <Share2 className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>

        {message.refs.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
            <button
              onClick={() => setShowRefs(!showRefs)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <span>
                参考来源 ({message.refs.length}) — 点击{showRefs ? "收起" : "展开"}
              </span>
              {showRefs ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            {showRefs && (
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2">
                {message.refs.map((r) => (
                  <button
                    key={r.index}
                    onClick={() => onOpenRef?.(r, message)}
                    className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-left text-xs transition-colors duration-200 hover:border-accent/40 hover:bg-accent/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        [{r.index}] {r.file}
                        {r.page ? ` (p.${r.page})` : ""}
                      </span>
                      <Badge variant="accent" className="shrink-0">
                        {r.score !== undefined ? r.score.toFixed(3) : "-"}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{r.text}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="secondary">
            {KB_LABEL[message.params.kb] ?? message.params.kb}
          </Badge>
          <Badge variant="secondary">size={message.params.chunk_size}</Badge>
          <Badge variant="secondary">overlap={message.params.chunk_overlap}</Badge>
          <Badge variant="secondary">top_k={message.params.top_k}</Badge>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-accent/15 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = React.useState<boolean>(false);
  async function onCopy() {
    const ok = await copyText(getText());
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("复制失败");
    }
  }
  return (
    <IconBtn title="复制" onClick={() => void onCopy()}>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-accent" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </IconBtn>
  );
}
