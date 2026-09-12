"use client";

import * as React from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useApp, PRESETS, type Params } from "./AppContext";

export function ParamPanel() {
  const {
    paramPanelOpen,
    setParamPanelOpen,
    compareMode,
    params,
    setParams,
    leftParams,
    rightParams,
    setLeftParams,
    setRightParams,
    currentKB,
    indexStatus,
    rebuildIndex,
    applyPreset,
    isStreaming,
  } = useApp();

  if (!paramPanelOpen) {
    return (
      <div className="flex w-10 flex-col items-center border-l border-border bg-card py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setParamPanelOpen(true)}
          aria-label="展开参数面板"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* 移动端：点击遮罩关闭 */}
      <div
        className="fixed inset-0 z-30 bg-black/30 md:hidden"
        onClick={() => setParamPanelOpen(false)}
      />
      {/* 桌面端在文档流内；小屏时为右侧覆盖抽屉，避免挤占聊天区 */}
      <aside className="fixed inset-y-0 right-0 z-40 flex w-72 max-w-[85vw] flex-col border-l border-border bg-card shadow-xl md:static md:z-auto md:max-w-none md:shadow-none">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">参数</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setParamPanelOpen(false)}
          aria-label="折叠参数面板"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {compareMode ? (
          <>
            <SideParams
              title="左侧参数"
              params={leftParams}
              onChange={setLeftParams}
            />
            <Separator className="my-3" />
            <SideParams
              title="右侧参数"
              params={rightParams}
              onChange={setRightParams}
            />
          </>
        ) : (
          <>
            <SectionTitle>建库参数</SectionTitle>
            <SliderRow
              label="chunk_size"
              value={params.chunk_size}
              min={100}
              max={2000}
              step={50}
              onChange={(v) => setParams({ chunk_size: v })}
            />
            <SliderRow
              label="chunk_overlap"
              value={params.chunk_overlap}
              min={0}
              max={500}
              step={10}
              onChange={(v) => setParams({ chunk_overlap: v })}
            />

            <SectionTitle>检索参数</SectionTitle>
            <SliderRow
              label="top_k"
              value={params.top_k}
              min={1}
              max={10}
              step={1}
              onChange={(v) => setParams({ top_k: v })}
            />

            <MismatchNotice
              current={{
                chunk_size: params.chunk_size,
                chunk_overlap: params.chunk_overlap,
              }}
              kb={currentKB}
              indexStatus={indexStatus}
              onRebuild={() => void rebuildIndex()}
            />
          </>
        )}

        <Separator className="my-3" />
        <SectionTitle>预设方案</SectionTitle>
        <div className="flex flex-col gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.name}
              variant="outline"
              size="sm"
              onClick={() => applyPreset(p)}
              className="justify-start"
            >
              <span className="font-medium">{p.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {p.chunk_size}/{p.chunk_overlap}/{p.top_k}
              </span>
            </Button>
          ))}
        </div>

        <Separator className="my-3" />
        <Button
          onClick={() => void rebuildIndex()}
          disabled={isStreaming}
          className="w-full"
        >
          <RefreshCw className="h-4 w-4" />
          重建索引
        </Button>
      </div>
      </aside>
    </>
  );
}

function SideParams({
  title,
  params,
  onChange,
}: {
  title: string;
  params: Params;
  onChange: (p: Partial<Params>) => void;
}) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <SliderRow
        label="chunk_size"
        value={params.chunk_size}
        min={100}
        max={2000}
        step={50}
        onChange={(v) => onChange({ chunk_size: v })}
      />
      <SliderRow
        label="chunk_overlap"
        value={params.chunk_overlap}
        min={0}
        max={500}
        step={10}
        onChange={(v) => onChange({ chunk_overlap: v })}
      />
      <SliderRow
        label="top_k"
        value={params.top_k}
        min={1}
        max={10}
        step={1}
        onChange={(v) => onChange({ top_k: v })}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(arr) => {
          const v = arr[0];
          if (typeof v === "number") onChange(v);
        }}
      />
    </div>
  );
}

function MismatchNotice({
  current,
  kb,
  indexStatus,
  onRebuild,
}: {
  current: { chunk_size: number; chunk_overlap: number };
  kb: "main" | "left" | "right";
  indexStatus: ReturnType<typeof useApp>["indexStatus"];
  onRebuild: () => void;
}) {
  const status = indexStatus?.[kb];
  if (!status) return null;
  if (status.chunk_size == null || status.chunk_overlap == null) return null;
  const mismatch =
    status.chunk_size !== current.chunk_size ||
    status.chunk_overlap !== current.chunk_overlap;
  if (!mismatch) return null;
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1">
        参数与当前库不一致 (库: {status.chunk_size}/{status.chunk_overlap})
      </div>
      <Button size="sm" variant="outline" onClick={onRebuild}>
        立即重建
      </Button>
    </div>
  );
}
