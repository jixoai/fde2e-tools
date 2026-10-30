/**
 * shiki 高亮共享层 —— src/lib/highlight.ts
 *
 * markdown / text / json 三个解码器共用：
 * - 扩展名 → shiki 语言 id 映射（未知扩展名/无扩展名 → 'text' 纯文本）；
 * - codeToHtml 双主题（亮/暗 CSS 变量），跟站内 .dark 自动翻面；
 * - 失败兜底：shiki 不认识的语法/加载失败 → 自行转义的 <pre><code>（零 HTML 注入）。
 */
import { codeToHtml, type BundledLanguage } from 'shiki';

/** 扩展名 → shiki 语言 id（小写扩展名键；覆盖常见文本/代码类）。 */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  json: 'json', jsonc: 'json', map: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  xml: 'xml', xsl: 'xml', plist: 'xml',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini', env: 'ini',
  py: 'python', pyw: 'python',
  rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', lua: 'lua', pl: 'perl', pm: 'perl',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  ps1: 'powershell', psm1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  diff: 'diff', patch: 'diff',
  makefile: 'makefile', dockerfile: 'dockerfile',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  vim: 'vim', zig: 'zig', dart: 'dart', ex: 'elixir', exs: 'elixir',
  hs: 'haskell', ml: 'ocaml', r: 'r', jl: 'julia', scala: 'scala',
  tf: 'hcl', hcl: 'hcl',
};

/** 扩展名 → shiki 语言 id；未知一律 'text'（shiki 的纯文本语言，恒可用）。 */
export function langForFile(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
  // 无扩展名时对「无扩展名但语义明确」的常见名做识别（Dockerfile/Makefile 等）
  return EXT_TO_LANG[ext] ?? 'text';
}

let shikiFailed = false;

/**
 * 代码块 → 高亮 HTML（<pre>）。双主题经 CSS 变量落色，亮暗皮肤共用一份产物。
 * shiki 加载/语法解析失败时不抛出——回退纯转义 <pre><code>，保住「不渲染乱码、
 * 不白屏」底线。
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  if (shikiFailed) return plainCodeHtml(code);
  try {
    return await codeToHtml(code, {
      lang: lang as BundledLanguage, // 未知语言在运行时抛错 → 下方重试纯文本
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    // 语言不可用再试一次纯文本；仍失败则永久走兜底
    try {
      return await codeToHtml(code, {
        lang: 'text',
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });
    } catch {
      shikiFailed = true;
      return plainCodeHtml(code);
    }
  }
}

/** HTML 转义（属性值/文本节点通用）。 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function plainCodeHtml(code: string): string {
  return `<pre class="md-code-fallback"><code>${escapeHtml(code)}</code></pre>`;
}
