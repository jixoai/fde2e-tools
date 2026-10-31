/*
 * 工具黄页 WebMCP 注册 —— apps/directory/src/webmcp.ts
 *
 * 「黄页支持 WebMCP」的最小正确形态：agent 到黄页一次枚举全部工具——
 * - list_tools：全量 registry 元数据（含 URL 参数契约与各工具的 WebMCP 入口点）；
 * - search_tools：与页面搜索同源的过滤（searchTools）。
 * 数据单源＝packages/shared/registry（黄页卡片、各工具页、本注册三面共用）。
 */
import { searchTools, TOOLS, toolHomeUrl } from "@fde2e-tools/shared";
import { registerWebMCPTools, type WebMCPToolDef } from "@fde2e-tools/shared/webmcp";

function project(tool: (typeof TOOLS)[number]) {
  return {
    id: tool.id,
    name: tool.name,
    tagline: tool.tagline,
    description: tool.description,
    tags: tool.tags,
    subdomain: tool.subdomain,
    homeUrl: toolHomeUrl(tool),
    comingSoon: !!tool.comingSoon,
    urlParams: tool.urlParams,
    webmcpTools: tool.tools,
    repoPath: tool.repoPath,
  };
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "list_tools",
      title: "枚举全部工具",
      description:
        "返回工具黄页收录的全部工具元数据：id/名称/一句话/子域/标签/URL 参数契约/该工具的 WebMCP 入口点/独立站 URL/comingSoon（true＝建设中占位，独立站未上线，轻量快速档见 easy-* 子域）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return { ok: true, count: TOOLS.length, tools: TOOLS.map(project) };
      },
    },
    {
      name: "search_tools",
      title: "搜索工具",
      description:
        "按关键词过滤工具（名称/定位/描述/标签/用法摘要，空格分词 AND），返回命中工具的完整元数据。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（空格分词 AND；空串＝全量）" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const query = String(input.query ?? "");
        const tools = searchTools(query);
        return { ok: true, query, count: tools.length, tools: tools.map(project) };
      },
    },
  ];
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）；返回注册结果供调试 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[directory] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
