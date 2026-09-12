"use client";

import * as React from "react";
import { toast } from "sonner";
import { BookOpen, FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchFileContent, type FileContentResponse } from "@/lib/api";
import { extractFileName } from "@/lib/utils";
import { useApp } from "./AppContext";
import type { OpenRefPayload } from "@/lib/types";

const KB_LABEL: Record<string, string> = {
  main: "主知识库",
  left: "左侧知识库",
  right: "右侧知识库",
};

interface RefModalProps {
  payload: OpenRefPayload | null;
  onClose: () => void;
}

export function RefModal({ payload, onClose }: RefModalProps) {
  const { indexStatus } = useApp();
  // 原文预览：懒加载（点击才请求），切换片段时重置
  const [preview, setPreview] = React.useState<FileContentResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);

  const refKey = payload ? `${payload.kb}:${payload.ref.index}:${payload.ref.file}` : null;

  // 切换到另一个片段时清空上一次的预览
  React.useEffect(() => {
    if (loadedFor !== null && loadedFor !== refKey) {
      setPreview(null);
      setLoading(false);
      setLoadedFor(null);
    }
  }, [refKey, loadedFor]);

  async function loadPreview() {
    if (!payload || loading) return;
    if (!payload.ref.file) {
      toast.error("该引用缺少文件来源信息（可能是旧消息），重新提问即可恢复");
      return;
    }
    setLoading(true);
    try {
      // refs 里的 file 是 basename（nba.txt），预览接口需要完整路径：
      // 从当前库文件列表中按文件名匹配出完整路径
      const files = indexStatus?.[payload.kb]?.files ?? [];
      const full = files.find((f) => extractFileName(f) === payload.ref.file);
      const res = await fetchFileContent(full ?? payload.ref.file);
      setPreview(res);
      setLoadedFor(refKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`原文加载失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  const refItem = payload?.ref;

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {payload && refItem && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                参考片段 [{refItem.index}]
                <Badge variant="accent">{KB_LABEL[payload.kb] ?? payload.kb}</Badge>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                <span>文件: {refItem.file || "（来源缺失，重新提问可恢复）"}</span>
                {refItem.page != null && <span>页码: {refItem.page}</span>}
                {refItem.score != null && (
                  <span>相似度: {refItem.score.toFixed(3)}</span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* 片段本身 */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                命中片段
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
                {refItem.text || "(无片段文本)"}
              </pre>
            </div>

            {/* 检索参数快照 */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>检索参数:</span>
              <Badge variant="secondary">size={payload.params.chunk_size}</Badge>
              <Badge variant="secondary">overlap={payload.params.chunk_overlap}</Badge>
              <Badge variant="secondary">top_k={payload.params.top_k}</Badge>
            </div>

            {/* 原文预览 */}
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">原文预览</div>
              {preview === null && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadPreview()}
                  disabled={loading || !refItem.file}
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookOpen className="h-3.5 w-3.5" />
                  )}
                  加载原文
                </Button>
              )}
            </div>
            <ScrollArea className="max-h-[45vh] rounded-md border border-border">
              {preview === null ? (
                <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在读取文件...
                    </>
                  ) : (
                    "点击「加载原文」查看该片段在文件中的位置"
                  )}
                </div>
              ) : (
                <div className="p-3">
                  {preview.truncated && (
                    <div className="mb-2 rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
                      文件较长（{preview.total_chars.toLocaleString()} 字符），仅显示前{" "}
                      {preview.content.length.toLocaleString()} 字符
                    </div>
                  )}
                  <FullTextWithHighlight content={preview.content} needle={refItem.text} />
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 把连续空白折叠为单个空格，并记录折叠后每个字符在原文中的位置 */
function normalizeWithMap(s: string): { out: string; pos: number[] } {
  let out = "";
  const pos: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      out += " ";
      pos.push(i);
      while (i < s.length && /\s/.test(s[i])) i++;
    } else {
      out += s[i];
      pos.push(i);
      i++;
    }
  }
  return { out, pos };
}

/**
 * 全文渲染，并把命中片段高亮、自动滚动到可视区。
 * 片段预览来自后端（换行被替换成空格、可能截断），与原文存在空白差异，
 * 因此做三级匹配：精确 → 空白归一化 → 归一化前 40 字 → 失败（不高亮，提示）。
 */
function FullTextWithHighlight({
  content,
  needle,
}: {
  content: string;
  needle: string;
}) {
  // mark 挂载后自动滚动到高亮位置
  const [markEl, setMarkEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (markEl) markEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [markEl]);

  const { before, hit, after, found } = React.useMemo(() => {
    const n = (needle ?? "").trim();
    if (!n) return { before: content, hit: "", after: "", found: false };

    // 1) 精确匹配
    let idx = content.indexOf(n);
    let len = n.length;
    if (idx === -1) {
      // 2) 空白归一化匹配（把两边连续空白都折叠为单空格）
      const { out: nc, pos } = normalizeWithMap(content);
      const nn = n.replace(/\s+/g, " ");
      let nIdx = nc.indexOf(nn);
      if (nIdx === -1 && nn.length > 40) {
        // 3) 归一化后用前 40 字匹配
        nIdx = nc.indexOf(nn.slice(0, 40));
      }
      if (nIdx !== -1) {
        idx = pos[nIdx]!;
        const endPos = pos[Math.min(nIdx + nn.length - 1, pos.length - 1)]!;
        len = endPos - idx + 1;
      }
    }
    if (idx === -1) return { before: content, hit: "", after: "", found: false };
    return {
      before: content.slice(0, idx),
      hit: content.slice(idx, idx + len),
      after: content.slice(idx + len),
      found: true,
    };
  }, [content, needle]);

  return (
    <div>
      {!found && (
        <div className="mb-2 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          未能精确定位片段位置（原文可能存在空白差异），已展示全文
        </div>
      )}
      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
        {before}
        {found && (
          <mark
            ref={setMarkEl}
            className="rounded bg-primary/25 px-0.5 font-medium text-foreground"
          >
            {hit}
          </mark>
        )}
        {after}
      </div>
    </div>
  );
}
