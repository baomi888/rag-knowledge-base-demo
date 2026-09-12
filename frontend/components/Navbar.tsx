"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  Database,
  Menu,
  Moon,
  Sun,
  Search,
  Settings,
  SplitSquareHorizontal,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "./AppContext";
import type { KBKey } from "@/lib/types";

const KB_LABEL: Record<KBKey, string> = {
  main: "主知识库",
  left: "左侧知识库",
  right: "右侧知识库",
};

export function Navbar() {
  const { theme, setTheme } = useTheme();
  const {
    currentKB,
    setCurrentKB,
    compareMode,
    setCompareMode,
    setPaletteOpen,
    setSidebarOpen,
    setSearchOpen,
  } = useApp();

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        {/* 移动端：打开侧栏抽屉 */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="打开侧栏"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Database className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">RAG 知识库</span>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              {KB_LABEL[currentKB]}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {(Object.keys(KB_LABEL) as KBKey[]).map((k) => (
              <DropdownMenuItem
                key={k}
                onSelect={() => setCurrentKB(k)}
                className={k === currentKB ? "bg-accent/10" : ""}
              >
                {KB_LABEL[k]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchOpen(true)}
          aria-label="搜索历史"
          title="搜索历史 (Ctrl+F)"
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPaletteOpen(true)}
          aria-label="命令面板"
        >
          <Settings className="h-4 w-4" />
        </Button>
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="切换主题"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        )}
        <div className="ml-2 flex items-center gap-2">
          <SplitSquareHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">对比</span>
          <Switch
            checked={compareMode}
            onCheckedChange={(v) => setCompareMode(v)}
          />
        </div>
      </div>
    </header>
  );
}
