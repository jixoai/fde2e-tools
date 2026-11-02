/*
 * Canvas 预处理/字体/图标/demo 单测 —— scripts/canvas-preprocess-test.mjs
 *
 * 运行：node --test scripts/canvas-preprocess-test.mjs
 * （Node 22+ 原生 type stripping 直接 import 纯数据/纯函数；DOM/WebGL 相关
 *  链路走 canvas-e2e 真浏览器。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FONT_CATALOG,
  getFontCatalogEntry,
  listFontCatalog,
} from "../apps/canvas/src/font-catalog.ts";
import { DEMOS, demoPreprocessKeys, demoSummary, getDemo, listDemos } from "../apps/canvas/src/demos.ts";
import { normalizeSpec, validatePreprocessMap } from "../apps/canvas/src/spec.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = JSON.parse(readFileSync(join(ROOT, "apps/canvas/src/icons/catalog.generated.json"), "utf8"));
const LIBRARIES = ["lucide", "tabler", "heroicons", "bootstrap", "fontawesome", "material"];

/* ---------------- 字体目录 ---------------- */

test("字体目录：≥15 条、中文 ≥9、英文 ≥10，字段完整", () => {
  assert.ok(FONT_CATALOG.length >= 15, `字体数 ${FONT_CATALOG.length}`);
  assert.ok(FONT_CATALOG.filter((f) => f.languages.includes("zh")).length >= 9);
  assert.ok(FONT_CATALOG.filter((f) => f.languages.includes("en")).length >= 10);
  const ids = new Set();
  for (const f of FONT_CATALOG) {
    assert.ok(f.id && f.family && f.source && f.license, `字段缺失：${f.id}`);
    assert.ok(f.languages.length > 0 && f.styles.length > 0 && f.weights.length > 0, `${f.id} 缺 languages/styles/weights`);
    assert.ok(f.usage === "satori" || f.usage === "text_to_svg", `${f.id} usage 非法`);
    assert.equal(typeof f.builtin, "boolean");
    assert.ok(!ids.has(f.id), `重复字体 id：${f.id}`);
    ids.add(f.id);
    if (f.url) assert.match(f.url, /^https:\/\//, `${f.id} 的 url 必须是 https`);
    if (f.cssUrl) assert.match(f.cssUrl, /^https:\/\//, `${f.id} 的 cssUrl 必须是 https`);
  }
});

test("字体目录：内置 Noto 走 Satori，外部字体全部 text_to_svg", () => {
  const builtin = FONT_CATALOG.filter((f) => f.builtin);
  assert.equal(builtin.length, 1);
  assert.equal(builtin[0].id, "noto-sans-sc");
  assert.equal(builtin[0].family, "Noto Sans SC");
  assert.equal(builtin[0].usage, "satori");
  for (const f of FONT_CATALOG.filter((x) => !x.builtin)) {
    assert.equal(f.usage, "text_to_svg", `${f.id} 外部字体必须 text_to_svg`);
  }
});

test("字体目录：语言/风格/关键词过滤", () => {
  const zh = listFontCatalog({ language: "zh" });
  assert.ok(zh.length >= 9 && zh.every((f) => f.languages.includes("zh")));
  const en = listFontCatalog({ language: "en" });
  assert.ok(en.length >= 10 && en.every((f) => f.languages.includes("en")));
  const mono = listFontCatalog({ style: "mono" });
  assert.deepEqual(mono.map((f) => f.id), ["jetbrains-mono"]);
  assert.ok(listFontCatalog({ q: "inter" }).some((f) => f.id === "inter"));
  assert.equal(getFontCatalogEntry("nope"), null);
  assert.equal(getFontCatalogEntry("noto-sans-sc")?.family, "Noto Sans SC");
});

test("字体目录：已知直链来自 @fontsource jsDelivr（不编造 URL）", () => {
  for (const id of [
    "inter",
    "space-grotesk",
    "playfair-display",
    "bebas-neue",
    "caveat",
    "jetbrains-mono",
    "noto-serif-sc",
    "zcool-xiaowei",
    "ma-shan-zheng",
    "long-cang",
  ]) {
    const f = getFontCatalogEntry(id);
    assert.ok(f?.url, `${id} 应有已验证直链`);
    assert.match(f.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\//);
  }
  // 无直链条目只给来源/cssUrl，不塞 404 URL
  for (const id of ["manrope", "dm-sans", "oswald", "libre-baskerville", "lxgw-wenkai", "smiley-sans", "alibaba-puhuiti"]) {
    const f = getFontCatalogEntry(id);
    assert.ok(f, `${id} 应存在`);
    assert.equal(f.url, undefined, `${id} 不应编造直链`);
    assert.ok(f.cssUrl || f.source, `${id} 应有来源线索`);
  }
});

/* ---------------- 图标目录 ---------------- */

test("图标目录：≥80 条、六族每族 ≥10、字段完整", () => {
  assert.ok(Array.isArray(ICONS));
  assert.ok(ICONS.length >= 80, `图标数 ${ICONS.length}`);
  const perLib = Object.fromEntries(LIBRARIES.map((l) => [l, 0]));
  const ids = new Set();
  for (const icon of ICONS) {
    assert.ok(LIBRARIES.includes(icon.library), `未知库 ${icon.library}`);
    perLib[icon.library] += 1;
    assert.equal(icon.id, `${icon.library}:${icon.name}`);
    assert.ok(Array.isArray(icon.tags) && icon.tags.includes(icon.library));
    assert.match(icon.viewBox, /^\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/);
    assert.ok(typeof icon.innerSvg === "string" && icon.innerSvg.length > 0);
    assert.ok(typeof icon.license === "string" && icon.license.length > 0);
    assert.ok(!ids.has(icon.id), `重复图标 id：${icon.id}`);
    ids.add(icon.id);
  }
  for (const lib of LIBRARIES) assert.ok(perLib[lib] >= 10, `${lib} 只有 ${perLib[lib]} 个`);
});

test("图标目录：innerSvg 无脚本/事件/外部 href", () => {
  for (const icon of ICONS) {
    assert.ok(!/<script[\s>]/i.test(icon.innerSvg), `${icon.id} 含 script`);
    assert.ok(!/\son[a-z]+\s*=/i.test(icon.innerSvg), `${icon.id} 含事件属性`);
    assert.ok(!/(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i.test(icon.innerSvg), `${icon.id} 含外部 href`);
  }
});

test("图标目录：覆盖常用语义（star/heart/bolt/menu/mail/github/image 等）", () => {
  const names = new Set(ICONS.map((i) => i.name));
  for (const key of ["star", "heart", "bolt", "play", "check", "menu", "search", "user", "home", "settings", "mail", "phone", "calendar", "clock", "map-pin", "sparkles", "rocket", "bulb", "chart", "target", "trophy", "shield-check", "github", "image", "camera", "music", "file", "folder", "lock", "globe"]) {
    assert.ok(names.has(key), `缺图标语义 ${key}`);
  }
  for (const lib of LIBRARIES) {
    assert.ok(ICONS.some((i) => i.library === lib && i.name === "star"), `${lib} 缺 star`);
  }
});

/* ---------------- Demo 目录 ---------------- */

test("Demo：≥12 个、≥4 个 preprocess、三级齐全、id 唯一", () => {
  assert.ok(DEMOS.length >= 12, `demo 数 ${DEMOS.length}`);
  assert.ok(DEMOS.filter((d) => d.level === "preprocess").length >= 4);
  for (const level of ["basic", "advanced", "preprocess"]) {
    assert.ok(DEMOS.some((d) => d.level === level), `缺 ${level} demo`);
  }
  assert.equal(new Set(DEMOS.map((d) => d.id)).size, DEMOS.length);
  assert.equal(getDemo("preprocess-four-assets")?.level, "preprocess");
  assert.equal(getDemo("nope"), null);
});

test("Demo：listDemos 只回摘要（不含 spec，explain ≤200 字）", () => {
  const summaries = listDemos().map(demoSummary);
  assert.equal(summaries.length, DEMOS.length);
  for (const s of summaries) {
    assert.ok(!("spec" in s));
    assert.ok(s.explain.length <= 200);
    assert.ok(s.id && s.title && s.level && Array.isArray(s.features));
  }
  assert.ok(listDemos({ level: "preprocess" }).every((d) => d.level === "preprocess"));
  assert.ok(listDemos({ q: "shader" }).length >= 3);
});

test("Demo：每个 spec 都能通过 normalizeSpec", () => {
  for (const demo of DEMOS) {
    let result;
    try {
      result = normalizeSpec(demo.spec);
    } catch (e) {
      assert.fail(`demo ${demo.id} 校验失败：${e.message}`);
    }
    assert.equal(result.spec.width > 0, true);
    assert.equal(result.spec.root.type, "div");
  }
});

function collectPreRefs(node, out) {
  if (!node || typeof node !== "object") return;
  const props = node.props ?? {};
  if (typeof props.src === "string" && props.src.startsWith("pre:")) out.push(props.src);
  for (const key of ["href", "xlink:href", "src"]) {
    if (typeof props[key] === "string" && props[key].startsWith("pre:")) out.push(props[key]);
  }
  const bg = props.style?.backgroundImage;
  if (typeof bg === "string") {
    for (const m of bg.matchAll(/url\(\s*['"]?((?:pre|asset):[A-Za-z0-9_-]+)['"]?\s*\)/g)) out.push(m[1]);
  }
  if (Array.isArray(props.children)) for (const child of props.children) collectPreRefs(child, out);
}

test("Demo：pre: 引用只指向自身 preprocess map 的 key（不造假 id）", () => {
  for (const demo of DEMOS) {
    const spec = demo.spec;
    const keys = new Set(demoPreprocessKeys(demo));
    const refs = [];
    collectPreRefs(spec.root, refs);
    for (const ref of refs) {
      if (!ref.startsWith("pre:")) continue;
      const key = ref.slice(4);
      assert.ok(keys.has(key), `demo ${demo.id} 引用了未声明的 ${ref}`);
    }
    if (!spec.preprocess) {
      assert.equal(refs.filter((r) => r.startsWith("pre:")).length, 0, `demo ${demo.id} 无 preprocess 却用了 pre:`);
    }
  }
});

/* ---------------- preprocess 校验（spec.ts） ---------------- */

function specWithPreprocess(preprocess, extra = {}) {
  return {
    width: 600,
    height: 400,
    preprocess,
    root: { type: "div", props: { id: "root", children: "x" } },
    ...extra,
  };
}

function expectSpecError(fn, code, key) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.code, code, `期望 ${code}，实际 ${e.code}: ${e.message}`);
    if (key) assert.equal(e.key, key);
    return;
  }
  assert.fail(`期望抛出 ${code}`);
}

test("preprocess：条目 >8 / text >2000 / icon size 越界 → E_PREPROCESS_LIMIT", () => {
  const nine = {};
  for (let i = 0; i < 9; i++) nine[`k${i}`] = { type: "icon", library: "lucide", name: "star" };
  expectSpecError(() => normalizeSpec(specWithPreprocess(nine)), "E_PREPROCESS_LIMIT");

  expectSpecError(
    () => validatePreprocessMap({ t: { type: "text", text: "x".repeat(2001) } }),
    "E_PREPROCESS_LIMIT",
    "t",
  );
  expectSpecError(
    () => validatePreprocessMap({ i: { type: "icon", library: "lucide", name: "star", size: 8 } }),
    "E_PREPROCESS_LIMIT",
    "i",
  );
  expectSpecError(
    () => validatePreprocessMap({ i: { type: "icon", library: "lucide", name: "star", size: 513 } }),
    "E_PREPROCESS_LIMIT",
    "i",
  );
});

test("preprocess：未知 type / 纯数字 key → 结构化错误", () => {
  expectSpecError(() => validatePreprocessMap({ a: { type: "video" } }), "E_PREPROCESS_TYPE", "a");
  expectSpecError(
    () => validatePreprocessMap({ "1": { type: "icon", library: "lucide", name: "star" } }),
    "E_PREPROCESS_KEY",
  );
});

test("preprocess：source 顺序/类型/缺失 → E_PREPROCESS_ORDER", () => {
  // 引用后面声明的 key
  expectSpecError(
    () =>
      validatePreprocessMap({
        glass: { type: "shader", preset: "glass-prism", source: "bg" },
        bg: { type: "shader", preset: "mesh-sunset" },
      }),
    "E_PREPROCESS_ORDER",
    "glass",
  );
  // 引用不存在的 key
  expectSpecError(
    () => validatePreprocessMap({ glass: { type: "shader", preset: "glass-prism", source: "nope" } }),
    "E_PREPROCESS_ORDER",
    "glass",
  );
  // source 必须是 shader/image 产物
  expectSpecError(
    () =>
      validatePreprocessMap({
        title: { type: "text", text: "hi" },
        glass: { type: "shader", preset: "glass-prism", source: "title" },
      }),
    "E_PREPROCESS_ORDER",
    "glass",
  );
  // 合法顺序 + pre: 前缀
  const ok = validatePreprocessMap({
    bg: { type: "shader", preset: "mesh-sunset" },
    glass: { type: "shader", preset: "glass-prism", source: "pre:bg" },
  });
  assert.deepEqual(Object.keys(ok), ["bg", "glass"]);
  assert.equal(ok.glass.source, "bg");
});

test("preprocess：外部/私网 URL 走既有校验（不得绕过）", () => {
  expectSpecError(
    () => validatePreprocessMap({ p: { type: "image", url: "http://example.com/a.png" } }),
    "E_PREPROCESS_URL",
    "p",
  );
  expectSpecError(
    () => validatePreprocessMap({ p: { type: "image", url: "https://192.168.1.2/a.png" } }),
    "E_PREPROCESS_URL",
    "p",
  );
  expectSpecError(
    () => validatePreprocessMap({ i: { type: "icon", url: "http://example.com/i.svg" } }),
    "E_PREPROCESS_URL",
    "i",
  );
  expectSpecError(
    () => validatePreprocessMap({ t: { type: "text", text: "x", fontUrl: "http://example.com/f.woff2" } }),
    "E_PREPROCESS_URL",
    "t",
  );
  // shader.source 不允许外部 URL
  expectSpecError(
    () => validatePreprocessMap({ s: { type: "shader", preset: "glass-prism", source: "https://evil.example/x.png" } }),
    "E_PREPROCESS_URL",
    "s",
  );
});

test("preprocess：img.src / backgroundImage / SVG href 的 pre: 白名单", () => {
  const spec = normalizeSpec({
    width: 600,
    height: 400,
    preprocess: { bg: { type: "shader", preset: "mesh-sunset" }, logo: { type: "icon", library: "lucide", name: "star" } },
    root: {
      type: "div",
      props: {
        id: "root",
        style: { backgroundImage: "url(pre:bg)" },
        children: [
          { type: "img", props: { id: "bg", src: "pre:bg" } },
          { type: "img", props: { id: "logo", src: "pre:logo" } },
          {
            type: "svg",
            props: {
              id: "s",
              children: [{ type: "image", props: { id: "i", href: "pre:logo", width: 10, height: 10 } }],
            },
          },
        ],
      },
    },
  });
  assert.equal(spec.spec.preprocess.bg.type, "shader");

  // 任意外部 url() 仍被拒绝
  expectSpecError(
    () =>
      normalizeSpec({
        width: 100,
        height: 100,
        root: { type: "div", props: { id: "root", style: { backgroundImage: "url(https://evil.example/x.png)" } } },
      }),
    "E_SPEC_URL",
  );
  // img.src 不能是任意字符串
  expectSpecError(
    () => normalizeSpec({ width: 100, height: 100, root: { type: "div", props: { id: "r", children: [{ type: "img", props: { id: "i", src: "pre:a b" } }] } } }),
    "E_SPEC_IMG",
  );
});

test("preprocess：未声明 preprocess 时返回 undefined", () => {
  assert.equal(validatePreprocessMap(undefined), undefined);
  const { spec } = normalizeSpec({ width: 100, height: 100, root: { type: "div", props: { id: "root", children: "x" } } });
  assert.equal(spec.preprocess, undefined);
});
