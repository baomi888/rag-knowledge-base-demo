"use client";

import * as React from "react";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { ComparePanel } from "@/components/ComparePanel";
import { ParamPanel } from "@/components/ParamPanel";
import { FileUploadOverlay } from "@/components/FileUpload";
import { CommandPalette } from "@/components/CommandPalette";
import { SearchHistory } from "@/components/SearchHistory";
import { useApp } from "@/components/AppContext";

export default function HomePage() {
  const { compareMode } = useApp();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {compareMode ? <ComparePanel /> : <ChatArea />}
        <ParamPanel />
      </div>
      <FileUploadOverlay />
      <CommandPalette />
      <SearchHistory />
    </div>
  );
}
