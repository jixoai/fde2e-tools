/*
 * WebMCP 接口一致性静态 lint —— scripts/interface-lint.mjs
 *
 * 制度化绿门（2026-10-31 接口一致性审查裁决）：接口变更（新增/改参/改名）必须
 * 过本 lint ＋ 对照 docs/webmcp-interface-guidelines.md。四条硬断言：
 * 1. schema 面卫生：每个工具 inputSchema 必须 additionalProperties:false；
 *    参数名一律 camelCase（禁 snake_case/大写开头键）；
 * 2. 选择器命名：「导出什么/操作哪个」类选择器参数统一叫 items；旧名
 *    （sheets/section/pages）仅作 v1 兼容别名——出现新选择器名即失败；
 * 3. ok:false 必带 error：execute 返回值形态契约（禁静默失败/裸 message）；
 * 4. registry 三面一致：registry.ts tools ↔ 各 app webmcp.ts 注册名 ↔
 *    webmcp-check EXPECT，三面逐 app 逐一工具比对。
 * 附：文档双层契约——img-tool 工具层描述禁 %23（URL 层编码形态不入工具层），
 * registry urlParams（URL 层）必须保留 %23 形态。
 *
 * 用法：node scripts/interface-lint.mjs（纯静态，无需构建）
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAILURES = [];

function fail(msg) {
  FAILURES.push(msg);
}

function read(p) {
  return readFileSync(join(ROOT, p), "utf8");
}

/* ---------- 收集三面数据 ---------- */

/** registry.ts：每 app 的 tools[].name（urlParams 的 name 不算——取 tools: [ 到 repoPath 之间） */
function parseRegistry() {
  const src = read("packages/shared/src/registry.ts");
  const out = {};
  // 条目切分：id: " 到下一 id: " 或文件尾（正则贪穿多行嵌套不可靠——editor
  // tools:[] 与两 audio 新条目实证）。每段内独立解析。
  const parts = src.split(/\n  \{\n    id: /).slice(1);
  for (const part of parts) {
    const id = (part.match(/^"([a-z-]+)"/) ?? [])[1];
    if (!id) continue;
    const repo = (part.match(/repoPath: "([^"]+)"/) ?? [])[1] ?? "";
    if (!repo.startsWith("apps/")) continue; // external（editor AGPL 镜像）跳过
    if (repo !== `apps/${id}`) fail(`registry 条目 id=${id} 与 repoPath=${repo} 不一致`);
    const toolsBlock = (part.match(/tools: \[([\s\S]*?)\n    \],/) ?? [])[1] ?? "";
    const names = [...toolsBlock.matchAll(/\bname: "([a-z0-9_-]+)"/g)].map((x) => x[1]);
    if (!names.length) fail(`registry 条目 ${id} tools 面为空或解析失败`);
    if (new Set(names).size !== names.length) fail(`registry 条目 ${id} tools 面有重名: ${names.join(",")}`);
    out[id] = names;
  }
  if (!Object.keys(out).length) fail("registry.ts 未解析出任何条目（解析器与文件形态失配？）");
  return out;
}

/** 各 app webmcp.ts：name: "x",\n title: 形态的工具定义 */
function parseAppTools(app) {
  const src = read(`apps/${app}/src/webmcp.ts`);
  const names = [...src.matchAll(/name: "([a-z0-9_-]+)",\s*\n\s*title:/g)].map((x) => x[1]);
  return { names, src };
}

/** webmcp-check.mjs EXPECT 面 */
function parseExpect() {
  const src = read("scripts/webmcp-check.mjs");
  const out = {};
  for (const m of src.matchAll(/^\s*"?:?([a-z-]+)"?: \{ tools: \[([^\]]+)\] \},?$/gm)) {
    out[m[1]] = [...m[2].matchAll(/"([a-z0-9_-]+)"/g)].map((x) => x[1]);
  }
  if (!Object.keys(out).length) fail("webmcp-check EXPECT 未解析出任何条目");
  return out;
}

const registry = parseRegistry();
const expect = parseExpect();

/* ---------- 断言 1/2/3：逐 app schema 面卫生＋选择器命名＋ok:false 带 error ---------- */

const SELECTOR_WHITELIST = new Set(["items", "sheets", "section", "pages"]);
const APPS = Object.keys(registry);

for (const app of APPS) {
  // editor＝AGPL 上游镜像（external repoPath，不经本仓构建）——无本仓 webmcp.ts 可读
  if (app === "editor") continue;
  const { names, src } = parseAppTools(app);
  // 三面一致（断言 4 的 app 侧）
  const reg = registry[app] ?? [];
  const exp = expect[app] ?? [];
  if (JSON.stringify(reg) !== JSON.stringify(names)) {
    fail(`[${app}] registry tools 与 app webmcp.ts 注册面不一致：\n  registry: ${JSON.stringify(reg)}\n  app:      ${JSON.stringify(names)}`);
  }
  if (JSON.stringify(exp) !== JSON.stringify(names)) {
    fail(`[${app}] webmcp-check EXPECT 与 app webmcp.ts 注册面不一致：\n  expect:   ${JSON.stringify(exp)}\n  app:      ${JSON.stringify(names)}`);
  }

  // 每个工具 inputSchema 必须 additionalProperties:false（schemaFromUrlParams 派生面豁免——registry urlParams 单源）
  const schemaBlocks = [...src.matchAll(/inputSchema: (\{[\s\S]*?\n      \})(?=,\s*\n\s*(?:annotations|async execute))/g)].map((m) => m[1]);
  for (const block of schemaBlocks) {
    if (!block.includes("additionalProperties: false")) {
      const nameMatch = /name: "([a-z0-9_-]+)"/.exec(src.slice(Math.max(0, src.indexOf(block) - 200), src.indexOf(block)));
      fail(`[${app}] 存在未关 additionalProperties 的 inputSchema（工具 ${nameMatch?.[1] ?? "?"}）——非法入参应显式拒绝`);
    }
  }

  // 参数名 camelCase＋选择器白名单（schema properties 键）
  for (const m of src.matchAll(/([a-zA-Z][a-zA-Z0-9_]*): \{\s*\n\s+(?:type|anyOf|description|required|items):/g)) {
    const key = m[1];
    if (key === "type" || key === "properties" || key === "items" || key === "anyOf") continue; // schema 关键字
    if (/[a-z]_[a-z0-9]/.test(key) || /^[A-Z]/.test(key)) {
      fail(`[${app}] schema 参数名非 camelCase: ${key}（指南 §1）`);
    }
    if (/(list|ids?|pages|sheets|sections?|selection|selector|units?)s?$/i.test(key) && !SELECTOR_WHITELIST.has(key)) {
      fail(`[${app}] 疑似选择器参数未走 items 统一命名: ${key}（指南 §2——items 主形态，旧名 sheets/section/pages 仅作兼容别名）`);
    }
  }

  // ok:false 分支必带 error
  for (const m of src.matchAll(/ok: false/g)) {
    const window = src.slice(m.index, m.index + 240);
    if (!/error/.test(window)) {
      fail(`[${app}] ok:false 分支缺 error（指南 §3——禁静默失败）：…${src.slice(Math.max(0, m.index - 40), m.index + 80).replace(/\s+/g, " ")}…`);
    }
  }
}

// EXPECT 覆盖面：registry 有而 EXPECT 无的 app（漏绿门）
for (const app of Object.keys(registry)) {
  if (!expect[app]) fail(`[${app}] webmcp-check EXPECT 缺该 app 的工具面断言`);
}

/* ---------- 文档双层契约：URL 层 %23 ／ 工具层裸 # ---------- */

const imgWebmcp = read("apps/img-tool/src/webmcp.ts");
const imgNonComment = imgWebmcp
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");
if (/%23rrggbb/.test(imgNonComment)) {
  fail("[img-tool] 工具层 webmcp.ts 把 %23rrggbb 当入参教法（指南 §6——工具层永远写解码后形态 #rrggbb；%23 只许以「兼容剥离」语汇出现）");
}
if (!/#rrggbb/.test(imgNonComment)) {
  fail("[img-tool] 工具层 description 缺裸 #rrggbb 形态（指南 §6）");
}
const registrySrc = read("packages/shared/src/registry.ts");
if (!/%23rrggbb/.test(registrySrc)) {
  fail("[img-tool] registry urlParams 缺 URL 层 %23rrggbb 契约（指南 §6——URL 层必须写编码后形态）");
}

/* ---------- 出口 ---------- */

if (FAILURES.length) {
  console.error(`✗ 接口 lint 失败（${FAILURES.length} 项）：`);
  for (const f of FAILURES) console.error("  -", f);
  process.exit(1);
}
console.log(`✓ 接口 lint 全过：${APPS.length} app 三面一致（registry/EXPECT/webmcp）· schema additionalProperties 全关 · 参数 camelCase · 选择器 items 统一（别名白名单 ${[...SELECTOR_WHITELIST].join("/")}）· ok:false 全带 error · URL/工具双层契约分立`);
