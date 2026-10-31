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
import { useEffect, useMemo, useState } from "react";
import { getTool, livePreviewAvailable, searchTools, toolHomeUrl, type ToolMeta } from "@fde2e-tools/shared";
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
- 办公三件套双形态：xlsx/docx/pptx 主域名＝真编辑器工作区（Univer/TipTap/PPTist，
  WebMCP 直接驱动编辑器内核）；easy-xlsx/docx/pptx＝轻量快速档（表单一键生成文件）。
- 各工具页首都有 <pre id="ai-guide">，是给自动化代理读的完整用法说明（含 URL 参数契约）。
- URL 参数契约是稳定接口：智能体按参数调用工具，契约变更会同步登记在各工具 ai-guide。
- 加新工具＝仓库 packages/shared registry 加一条，黄页自动收录。`;

function ToolCard({ tool, previewable }: { tool: ToolMeta; previewable: boolean }) {
  const home = toolHomeUrl(tool);
  // 建设中占位目（registry comingSoon）：向同名轻量快速档（easy-<id>）引流
  const easyAlt = tool.comingSoon ? getTool(`easy-${tool.id}`) : undefined;
  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle className="text-lg flex flex-wrap items-center gap-2">
          {tool.name}
          {tool.comingSoon && (
            <Badge data-testid="coming-soon-badge" className="shrink-0">
              建设中
            </Badge>
          )}
        </CardTitle>
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
        {tool.comingSoon ? (
          <div className="bg-background flex h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input px-4 text-center">
            <p className="m-0 text-sm text-muted-foreground">
              专业编辑器建设中——独立站尚未上线
            </p>
            {easyAlt && (
              <a href={toolHomeUrl(easyAlt)} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  用轻量快速档 {easyAlt.id}
                </Button>
              </a>
            )}
          </div>
        ) : previewable ? (
          <LivePreview home={home} name={tool.name} />
        ) : (
          <div className="bg-background flex h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-input px-4 text-center">
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
        {tool.comingSoon ? (
          <Button className="flex-1" disabled aria-disabled="true">
            打开工具
          </Button>
        ) : (
          <a href={home} target="_blank" rel="noreferrer" className="flex-1">
            <Button className="w-full">打开工具</Button>
          </a>
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {tool.urlParams.length ? `${tool.urlParams.length} 个 URL 参数契约` : "无 URL 参数"}
        </span>
      </CardFooter>
    </Card>
  );
}

/*
 * 实况预览（视觉打磨 2026-10-30，视觉验收回单修复项 1/5）：
 * - loading="eager" 显式压制 Chromium LazyEmbeds 启发式（视口外 iframe 默认延迟
 *   加载——黄页第三卡/窄屏深处 iframe 截图空白的根因）；
 * - 加载态化：onLoad 前显示 bg-background 占位骨架，8s 超时未加载给出失败提示 +
 *   新窗口入口——任何时序/子域问题都不再呈现为纯空白；
 * - 缩略化：scale-75 首屏缩略（等效截首屏缩略图方案），iframe 内容 pointer-events-none
 *   ——缩放后点击坐标会错位，预览只读看形态，交互一律走「打开工具」。
 */
function LivePreview({ home, name }: { home: string; name: string }) {
  const [state, setState] = useState<"loading" | "ready" | "timeout">("loading");
  useEffect(() => {
    if (state !== "loading") return;
    const t = window.setTimeout(() => {
      setState((s) => (s === "loading" ? "timeout" : s));
    }, 8000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <div className="relative h-[300px] overflow-hidden rounded-lg border border-input">
      {/* 占位骨架：加载中/超时提示。iframe 在上层，未加载时透明不遮挡；加载完成后
          自带文档白底自然盖住占位。iframe 永远只读（缩放后点击坐标错位，交互走
          「打开工具」），因此占位里的按钮永远可点。 */}
      <div className="bg-background absolute inset-0 flex flex-col items-center justify-center gap-2">
        {state === "timeout" ? (
          <>
            <p className="m-0 text-sm text-muted-foreground">预览子域暂未就绪——请直接打开工具</p>
            <a href={home} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                新窗口打开
              </Button>
            </a>
          </>
        ) : (
          <p className="m-0 animate-pulse text-sm text-muted-foreground">实况预览加载中…</p>
        )}
      </div>
      <iframe
        title={name + " 实况预览"}
        src={home}
        loading="eager"
        onLoad={() => setState("ready")}
        className="absolute left-0 top-0 h-[133.33%] w-[133.33%] origin-top-left scale-75 border-0 bg-transparent pointer-events-none"
      />
    </div>
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
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
