"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  Database,
  MessageSquarePlus,
  Sun,
  Moon,
  Search,
  Trash2,
  SplitSquareHorizontal,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApp, PRESETS } from "./AppContext";
import type { KBKey } from "@/lib/types";

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

const KB_LABEL: Record<KBKey, string> = {
  main: "主知识库",
  left: "左侧知识库",
  right: "右侧知识库",
};

export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    currentKB,
    setCurrentKB,
    clearMessages,
    compareMode,
    setCompareMode,
    applyPreset,
    setSearchOpen,
    newConversation,
  } = useApp();
  const { theme, setTheme } = useTheme();

  const [query, setQuery] = React.useState<string>("");
  const [selected, setSelected] = React.useState<number>(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const commands: Command[] = React.useMemo(() => {
    const list: Command[] = [];
    (["main", "left", "right"] as KBKey[]).forEach((k) => {
      list.push({
        id: `kb-${k}`,
        label: `切换知识库: ${KB_LABEL[k]}`,
        icon: <Database className="h-4 w-4" />,
        run: () => setCurrentKB(k),
      });
    });
    PRESETS.forEach((p) => {
      list.push({
        id: `preset-${p.name}`,
        label: `应用预设: ${p.name}`,
        icon: <Wand2 className="h-4 w-4" />,
        run: () => applyPreset(p),
      });
    });
    list.push({
      id: "new-conversation",
      label: "新建对话（当前知识库）",
      icon: <MessageSquarePlus className="h-4 w-4" />,
      run: () => newConversation(),
    });
    list.push({
      id: "search-history",
      label: "搜索历史消息",
      icon: <Search className="h-4 w-4" />,
      run: () => setSearchOpen(true),
    });
    list.push({
      id: "clear",
      label: "清空对话历史",
      icon: <Trash2 className="h-4 w-4" />,
      run: () => clearMessages(),
    });
    list.push({
      id: "theme",
      label: theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
      icon:
        theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        ),
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    });
    list.push({
      id: "compare",
      label: compareMode ? "关闭对比模式" : "开启对比模式",
      icon: <SplitSquareHorizontal className="h-4 w-4" />,
      run: () => setCompareMode(!compareMode),
    });
    return list;
  }, [
    setCurrentKB,
    applyPreset,
    clearMessages,
    theme,
    setTheme,
    compareMode,
    setCompareMode,
    setSearchOpen,
    newConversation,
  ]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  React.useEffect(() => {
    setSelected(0);
  }, [query, paletteOpen]);

  React.useEffect(() => {
    if (paletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  // Cmd/Ctrl+K to open
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) {
        cmd.run();
        setPaletteOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPaletteOpen(false);
    }
  }

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="top-[20%] translate-y-0 p-0">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入命令搜索..."
          className="rounded-none border-0 border-b border-border shadow-none focus-visible:ring-0"
        />
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              无匹配命令
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => {
                  cmd.run();
                  setPaletteOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 " +
                  (idx === selected
                    ? "bg-accent/15 text-accent-foreground"
                    : "text-foreground hover:bg-accent/5")
                }
              >
                {cmd.icon}
                <span>{cmd.label}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
