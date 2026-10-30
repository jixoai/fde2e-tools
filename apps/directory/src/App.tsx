/*
 * 工具黄页 —— apps/directory/src/App.tsx
 *
 * tool.fde2e.com 主入口：工具卡片 + 纯前端搜索 + iframe 实况预览 + 入口。
 * 数据单源＝@fde2e-tools/shared/registry（加新工具＝registry 加一条，本页零改动）。
 *
 * 预览策略（Owner 2026-10-30 指令）：生产域（*.fde2e.com，X-Frame-Options 由
 * 服务器侧放行）渲染 iframe 实况嵌各工具子域；本地构建一律「新窗口打开」兜底，
 * 不做 iframe。
 */
import { useMemo, useState, useEffect } from "react";
import { livePreviewAvailable, searchTools, toolHomeUrl, type ToolMeta } from "@fde2e-tools/shared";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { Badge } from "@fde2e-tools/shared/ui/badge";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Input } from "@fde2e-tools/shared/ui/input";
import { Separator } from "@fde2e-tools/shared/ui/separator";
import { registerAppTools } from "./webmcp";

/** 给 AI/自动化代理的黄页级说明（registry 单源的人类可读投影） */
const DIRECTORY_AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是 FDE2E 工具黄页（tool.fde2e.com）：全部工具零后端、静态托管。
- 每个工具有独立站：<tool-id>.tool.fde2e.com（卡片上的「打开工具」）。
- 各工具页首都有 <pre id="ai-guide">，是给自动化代理读的完整用法说明（含 URL 参数契约）。
- URL 参数契约是稳定接口：智能体按参数调用工具，契约变更会同步登记在各工具 ai-guide。
- 加新工具＝仓库 packages/shared registry 加一条，黄页自动收录。`;

function ToolCard({ tool, previewable }: { tool: ToolMeta; previewable: boolean }) {
  const home = toolHomeUrl(tool);
  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle className="text-lg">{tool.name}</CardTitle>
        <CardDescription>
          {tool.tagline} · <span className="font-mono text-xs">{tool.subdomain}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{tool.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {tool.tags.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
        {previewable ? (
          <iframe
            title={tool.name + " 实况预览"}
            src={home}
            className="h-[360px] w-full rounded-lg border border-input"
          />
        ) : (
          <div className="glass-well flex h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-input px-4 text-center">
            <p className="m-0 text-sm text-muted-foreground">
              实况预览仅在生产域开放（本地构建走新窗口兜底）
            </p>
            <a href={home} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                新窗口打开 {tool.id}
              </Button>
            </a>
          </div>
        )}
        <p className="m-0 font-mono text-xs/5 text-muted-foreground">{tool.aiGuideSummary}</p>
        {tool.tools.length > 0 && (
          <p className="m-0 text-xs text-muted-foreground">
            WebMCP：{tool.tools.map((t) => t.name).join(" / ")}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <a href={home} target="_blank" rel="noreferrer" className="flex-1">
          <Button className="w-full">打开工具</Button>
        </a>
        <span className="font-mono text-xs text-muted-foreground">
          {tool.urlParams.length ? `${tool.urlParams.length} 个 URL 参数契约` : "无 URL 参数"}
        </span>
      </CardFooter>
    </Card>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const previewable = useMemo(() => livePreviewAvailable(window.location.host), []);
  const tools = useMemo(() => searchTools(query), [query]);

  // WebMCP：list_tools / search_tools（agent 到黄页一次枚举全部工具）
  useEffect(() => {
    void registerAppTools();
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">FDE2E 工具黄页</h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        全静态、零后端的公共工具集——每个工具一个独立站，黄页负责预览、搜索与入口。
      </p>

      <AiGuide>{DIRECTORY_AI_GUIDE}</AiGuide>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索工具（名称 / 定位 / 标签 / 用法，空格分词 AND）…"
          aria-label="搜索工具"
          className="h-10 max-w-[520px] flex-1 bg-background/60 py-2.5 text-base"
        />
        <span className="text-sm text-muted-foreground">
          {tools.length} / {searchTools("").length} 个工具
        </span>
      </div>

      {tools.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            没有匹配「{query}」的工具——试试更短的关键词。
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} previewable={previewable} />
          ))}
        </div>
      )}

      <Separator className="my-8" />
      <footer className="text-[13px] text-muted-foreground">
        FDE2E Tools · 纯静态零后端 · 数据单源 packages/shared registry · 未来动态代理类功能将加认证限制（见 openspec project-bootstrap）
      </footer>
    </div>
  );
}
