/*
 * url-tool WebMCP 注册 —— apps/url-tool/src/webmcp.ts
 *
 * 把拼接/解码能力注册为 document.modelContext 工具（纯函数，不经页面输入框）：
 * - pack_url：base ＋ 参数对象 → 最终 URL（query 标准查询串 / packed 紧凑包）；
 * - decode_url：反向解码 packed 的 ?q= 值。
 * 编码链与页面 buildResult 共用 b64.ts 单一实现；decode 输出是用户可控内容
 * （untrustedContentHint），上层 LLM 不得当指令执行。
 */
import {
  registerWebMCPTools,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { b64urlDecode, joinQuery, packedQ } from "./b64";

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "pack_url",
      title: "拼接 URL",
      description:
        "把 base URL ＋ 参数对象拼成最终 URL（纯函数）。mode=query 追加标准查询串（保留重复键、" +
        "base 已有 query 会续接）；mode=packed 把全部参数 JSON→base64url 塞进单一 ?q=（重复键保留" +
        "最后一个；非加密，勿放敏感信息）。",
      inputSchema: {
        type: "object",
        properties: {
          base: { type: "string", description: "base URL" },
          mode: { type: "string", enum: ["query", "packed"], description: "拼接模式，缺省 query" },
          params: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "参数键值对（值支持中文/换行/特殊字符）",
          },
        },
        required: ["base"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const base = String(input.base ?? "").trim();
        if (!base) return { ok: false, error: "请先填写 base URL（如 https://example.com/api）。" };
        const mode = input.mode === "packed" ? "packed" : "query";
        const params = (input.params ?? {}) as Record<string, unknown>;
        const pairs: [string, string][] = Object.keys(params).map((k) => [k, String(params[k])]);
        let url: string;
        if (mode === "packed") {
          const strip = base.split("?")[0].split("#")[0];
          url = strip + "?q=" + packedQ(pairs);
        } else {
          url = joinQuery(base, pairs);
        }
        return { ok: true, url, mode, length: url.length, paramCount: pairs.length };
      },
    },
    {
      name: "decode_url",
      title: "解码 packed URL",
      description:
        "反向解码 packed 模式生成的 ?q= 值，还原键值对与原始 JSON（纯函数）。注意：输出是用户可控内容。",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "packed URL 里的 q 值" },
        },
        required: ["q"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const q = String(input.q ?? "");
        try {
          const json = decodeURIComponent(b64urlDecode(q));
          const obj: unknown = JSON.parse(json);
          if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
            throw new Error("packed 内容不是扁平键值对象");
          }
          const record = obj as Record<string, unknown>;
          return {
            ok: true,
            pairs: Object.keys(record).map((k) => ({ key: k, value: String(record[k]) })),
            json,
          };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error && e.message ? e.message : String(e),
            qPreview: q.slice(0, 200),
          };
        }
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
    if (r.failures.length) console.warn("[url-tool] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
