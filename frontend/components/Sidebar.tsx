"use client";

import * as React from "react";
import {
  HardDrive,
  FileText,
  MessageSquare,
  Plus,
  Trash2,
  Upload,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useApp } from "./AppContext";
import { extractFileName, formatTime } from "@/lib/utils";
import type { KBKey } from "@/lib/types";

const KB_ITEMS: { key: KBKey; label: string }[] = [
  { key: "main", label: "主知识库" },
  { key: "left", label: "左侧知识库" },
  { key: "right", label: "右侧知识库" },
];

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useApp();

  return (
    <>
      {/* 桌面端：固定在左侧的常驻侧栏 */}
      <aside className="hidden w-60 flex-col border-r border-border bg-card md:flex">
        <SidebarContent />
      </aside>

      {/* 移动端：抽屉式侧栏（Navbar 上的菜单按钮触发） */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 max-w-[80vw] flex-col border-r border-border bg-card shadow-xl">
            <SidebarContent onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const {
    currentKB,
    setCurrentKB,
    indexStatus,
    params,
    rebuildIndex,
    refreshStatus,
    loadingStatus,
    setDragActive,
    defaults,
    removeKBFile,
    isStreaming,
    conversations,
    activeConvId,
    newConversation,
    switchConversation,
    deleteConversation,
  } = useApp();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState<boolean>(false);
  const [deletingFile, setDeletingFile] = React.useState<string | null>(null);

  // 当前知识库的对话列表（最近更新在前）
  const kbConvs = React.useMemo(
    () =>
      conversations
        .filter((c) => c.kb === currentKB)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, currentKB],
  );

  const currentFiles = React.useMemo(() => {
    if (!indexStatus) return [];
    return indexStatus[currentKB].files;
  }, [indexStatus, currentKB]);

  async function handleFilesSelected(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      await rebuildIndex(list);
    } finally {
      setUploading(false);
    }
  }

  function onPickClick() {
    fileInputRef.current?.click();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void handleFilesSelected(e.target.files);
    }
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesSelected(e.dataTransfer.files);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function selectKB(kb: KBKey) {
    setCurrentKB(kb);
    onNavigate?.();
  }

  async function handleDelete(file: string) {
    if (deletingFile) return;
    if (!window.confirm(`确定从当前知识库移除「${extractFileName(file)}」吗？移除后将自动重建索引。`)) {
      return;
    }
    setDeletingFile(file);
    try {
      await removeKBFile(file);
    } finally {
      setDeletingFile(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          知识库
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refreshStatus()}
          disabled={loadingStatus}
          aria-label="刷新状态"
        >
          {loadingStatus ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <HardDrive className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex flex-col gap-1 px-2 py-2">
        {KB_ITEMS.map((it) => {
          const status = indexStatus?.[it.key];
          const chunks = status?.chunks ?? 0;
          const active = it.key === currentKB;
          return (
            <button
              key={it.key}
              onClick={() => selectKB(it.key)}
              className={
                "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-200 " +
                (active
                  ? "bg-accent/15 text-accent-foreground"
                  : "hover:bg-accent/5 text-foreground")
              }
            >
              <span>{it.label}</span>
              <Badge variant={active ? "accent" : "secondary"}>{chunks}</Badge>
            </button>
          );
        })}
      </div>

      <Separator className="my-2" />

      {/* 当前知识库的对话列表 */}
      <div className="flex items-center justify-between px-4 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          对话 ({kbConvs.length})
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            newConversation();
            onNavigate?.();
          }}
          disabled={isStreaming}
          aria-label="新建对话"
          title="新建对话"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {activeConvId === null && !isStreaming && (
        <div className="mx-2 mb-1 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
          新对话（发送后自动保存）
        </div>
      )}

      <div className="max-h-44 overflow-y-auto px-2 pb-1">
        {kbConvs.length === 0 ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">
            暂无历史对话
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {kbConvs.map((c) => {
              const active = c.id === activeConvId;
              return (
                <li
                  key={c.id}
                  className={
                    "group flex items-center rounded-lg transition-colors duration-200 " +
                    (active ? "bg-accent/15" : "hover:bg-accent/5")
                  }
                >
                  <button
                    onClick={() => {
                      switchConversation(c.id);
                      onNavigate?.();
                    }}
                    className="flex min-w-0 flex-1 flex-col items-start px-2.5 py-1.5 text-left"
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <MessageSquare
                        className={
                          "h-3 w-3 shrink-0 " +
                          (active ? "text-accent-foreground" : "text-muted-foreground")
                        }
                      />
                      <span className="truncate text-xs">{c.title || "新对话"}</span>
                    </span>
                    <span className="pl-[18px] text-[10px] text-muted-foreground">
                      {formatTime(c.updatedAt)} · {c.messages.length} 条
                    </span>
                  </button>
                  <button
                    className="mr-1.5 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                    aria-label="删除对话"
                    onClick={() => deleteConversation(c.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Separator className="my-2" />

      <div className="px-4 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          当前文件
        </span>
      </div>

      <ScrollArea className="flex-1 px-2 py-2">
        {currentFiles.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            暂无文件
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {currentFiles.map((f, i) => (
              <li
                key={`${f}-${i}`}
                className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/5"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{extractFileName(f)}</span>
                </div>
                <button
                  // 触屏无 hover，移动端常显；桌面端 hover 才出现
                  className="text-muted-foreground hover:text-destructive md:hidden md:group-hover:block"
                  aria-label="删除文件"
                  disabled={deletingFile === f || isStreaming}
                  onClick={() => void handleDelete(f)}
                >
                  {deletingFile === f ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <div className="p-3">
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={onPickClick}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-center transition-colors duration-200 hover:border-primary/60 hover:bg-accent/5"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            拖拽文件到此处或点击上传
          </span>
          <span className="text-[10px] text-muted-foreground">
            {defaults
              ? `支持 ${defaults.supported_extensions.join(" ")} (≤ ${defaults.max_upload_mb} MB)`
              : "支持 .txt .md .pdf"}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf"
          className="hidden"
          onChange={onInputChange}
        />
        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          当前参数: chunk={params.chunk_size} / overlap={params.chunk_overlap}
        </div>
      </div>
    </>
  );
}
