"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "./AppContext";

export function FileUploadOverlay() {
  const { dragActive, setDragActive, rebuildIndex, defaults } = useApp();
  const dragCounter = React.useRef<number>(0);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) {
        return;
      }
      e.preventDefault();
      dragCounter.current += 1;
      setDragActive(true);
    }
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer) e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) {
        return;
      }
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setDragActive(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      const allowed = defaults?.supported_extensions ?? [".txt", ".md", ".pdf"];
      const rejected = list.filter(
        (f) =>
          !allowed.some((ext) => f.name.toLowerCase().endsWith(ext.toLowerCase())),
      );
      if (rejected.length > 0) {
        toast.error(
          `不支持的文件类型: ${rejected.map((f) => f.name).join(", ")}`,
        );
        return;
      }
      void (async () => {
        await rebuildIndex(list);
      })();
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [rebuildIndex, setDragActive, defaults]);

  if (!dragActive) return null;

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/90"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-card px-10 py-8 shadow-sm">
        <UploadCloud className="h-10 w-10 text-primary" />
        <div className="text-sm font-medium">松开以上传文件</div>
        <div className="text-xs text-muted-foreground">
          将使用当前参数重建索引
        </div>
      </div>
    </div>
  );
}
