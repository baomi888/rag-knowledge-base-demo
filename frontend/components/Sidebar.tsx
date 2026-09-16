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
import { toast } from "sonner";
import { Globe } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "./AppContext";
import {
  fetchFileContent,
  searchImportUrls,
  searchPreview,
  type FileContentResponse,
} from "@/lib/api";
import type { SearchPreviewResult } from "@/lib/api";
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
  // 网页导入（ima 式）：输入 URL 抓取正文入当前知识库
  const [webUrl, setWebUrl] = React.useState<string>("");
  const [importing, setImporting] = React.useState<boolean>(false);
  // 搜索预览弹窗（先看后导）：结果列表 + 勾选集合
  const [previewOpen, setPreviewOpen] = React.useState<boolean>(false);
  const [previewQuery, setPreviewQuery] = React.useState<string>("");
  const [previewResults, setPreviewResults] = React.useState<SearchPreviewResult[]>([]);
  const [selectedUrls, setSelectedUrls] = React.useState<Set<string>>(new Set());
  // 侧栏文件预览：点击文件名查看原文
  const [viewFile, setViewFile] = React.useState<string | null>(null);
  const [viewContent, setViewContent] = React.useState<FileContentResponse | null>(null);
  const [viewLoading, setViewLoading] = React.useState<boolean>(false);

  async function openFilePreview(path: string) {
    if (viewLoading) return;
    setViewFile(path);
    setViewContent(null);
    setViewLoading(true);
    try {
      setViewContent(await fetchFileContent(path));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "预览加载失败");
      setViewFile(null);
    } finally {
      setViewLoading(false);
    }
  }

  function toggleUrl(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleWebImport() {
    const input = webUrl.trim();
    if (!input || importing) return;
    setImporting(true);
    try {
      if (/^https?:\/\//.test(input)) {
        // 网址 → 单页导入
        const { importFromUrl } = await import("@/lib/api");
        const r = await importFromUrl({ url: input, kb: currentKB });
        toast.success(`网页已导入：${r.title || "无标题"}（${r.chars} 字，共 ${r.chunks} 个片段）`);
        setWebUrl("");
        await refreshStatus();
      } else {
        // 关键词 → 先预览搜到的资料，勾选后再导入
        const r = await searchPreview({ query: input });
        setPreviewQuery(r.query);
        setPreviewResults(r.results);
        setSelectedUrls(new Set(r.results.map((x) => x.url))); // 默认全选
        setPreviewOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (selectedUrls.size === 0 || importing) return;
    setImporting(true);
    try {
      const r = await searchImportUrls({
        query: previewQuery,
        kb: currentKB,
        urls: Array.from(selectedUrls),
      });
      toast.success(r.status);
      setPreviewOpen(false);
      setWebUrl("");
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

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
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title="点击预览原文"
                  onClick={() => void openFilePreview(f)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate transition-colors duration-200 hover:text-primary">
                    {extractFileName(f)}
                  </span>
                </button>
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
        {/* 网页导入（ima 式）：粘贴链接 → 抓取正文 → 入当前知识库 */}
        <div className="mt-3 flex items-center gap-1.5">
          <input
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleWebImport();
            }}
            placeholder="粘贴链接或输入关键词搜资料…"
            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none transition-colors duration-200 focus:border-primary/60"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => void handleWebImport()}
            disabled={importing || isStreaming}
            title="抓取网页正文并入当前知识库"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          当前参数: chunk={params.chunk_size} / overlap={params.chunk_overlap}
        </div>
      </div>

      {/* 搜索资料预览弹窗：先看后导 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>找到 {previewResults.length} 篇「{previewQuery}」资料</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {previewResults.map((r) => (
              <label
                key={r.url}
                className={
                  "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors duration-200 " +
                  (selectedUrls.has(r.url)
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-accent/5")
                }
              >
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedUrls.has(r.url)}
                    onChange={() => toggleUrl(r.url)}
                    className="mt-1 h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span className="flex-1">
                    <span className="block text-xs font-semibold leading-snug">
                      {r.title || "未命名文章"}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {new URL(r.url).hostname} · {r.chars} 字
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {r.preview}…
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <span className="mr-auto text-[10px] text-muted-foreground">
              已选 {selectedUrls.size} / {previewResults.length} 篇
            </span>
            <Button
              size="sm"
              onClick={() => void handleConfirmImport()}
              disabled={importing || selectedUrls.size === 0}
            >
              {importing ? "导入中…" : `导入选中 ${selectedUrls.size} 篇`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 侧栏文件原文预览弹窗 */}
      <Dialog open={viewFile !== null} onOpenChange={(o) => !o && setViewFile(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6 text-sm">
              {viewFile ? extractFileName(viewFile) : "预览"}
            </DialogTitle>
          </DialogHeader>
          {viewLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载原文…
            </div>
          ) : viewContent ? (
            <>
              <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed">
                {viewContent.content}
              </div>
              <DialogFooter>
                <span className="mr-auto text-[10px] text-muted-foreground">
                  共 {viewContent.total_chars} 字
                  {viewContent.truncated ? "（预览已截断）" : ""}
                </span>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
