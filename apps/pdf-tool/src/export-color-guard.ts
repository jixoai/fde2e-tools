/*
 * 导出色守卫 —— apps/pdf-tool/src/export-color-guard.ts
 *
 * B1（对抗审查 2026-10-30）：TW4/solid-glass 令全元素色值走 oklch——vendored
 * html2canvas 1.4.x 不识别 oklch 直接抛错，导出 100% 失败。
 *
 * 修复（审查官实测方案）：导出瞬间向主文档注入覆盖样式——
 *   1. 变量层全量钉扎：遍历全部 stylesheet，抓 :root / .dark 规则里所有含 oklch
 *      的自定义属性，运行时精确转换成 sRGB（hex / rgba）覆盖（仅钉 html/body
 *      或仅 .pdf-content * 实测不够——html2canvas 克隆整文档，任何元素的非
 *      sRGB 计算色都会炸）；
 *   2. 通配兜底：* 的 border/outline/caret/accent/column-rule-color 钉成中性
 *      sRGB（.pdf-content 内显式 border 简写特异性更高不受影响，排版零漂移）；
 *   3. 导出完成（成功或失败）移除守卫，页面恢复主题原样。
 */

/** oklch(L C H [/ alpha]) → sRGB。OKLab→线性 sRGB 用标准矩阵，带 alpha 输出 rgba() */
export function oklchToCssSrgb(input: string): string | null {
  const m = input.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg)?)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (!m) return null;
  const pct = (s: string, scale = 1) =>
    s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s);
  const L = pct(m[1]);
  const C = pct(m[2]);
  const Hdeg = m[3].endsWith("deg") ? parseFloat(m[3]) : parseFloat(m[3]);
  const alpha = m[4] !== undefined ? pct(m[4]) : 1;
  if (!isFinite(L) || !isFinite(C) || !isFinite(Hdeg)) return null;

  // oklch → oklab
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  // OKLab → 线性 sRGB（Björn Ottosson 标准矩阵）
  let lr = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  let lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  let lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const [r, g, bl] = [gamma(lr), gamma(lg), gamma(lb)];
  if (alpha >= 1) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(bl)}`;
  }
  return `rgba(${r}, ${g}, ${bl}, ${Math.round(alpha * 1000) / 1000})`;
}

interface VarBundle {
  light: Map<string, string>;
  dark: Map<string, string>;
}

/** 遍历全部 stylesheet（递归 media/nesting 层），收集含 oklch 的自定义属性 */
function collectOklchVars(): VarBundle {
  const bundle: VarBundle = { light: new Map(), dark: new Map() };
  const visit = (rules: CSSRuleList) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as CSSRule;
      if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
        visit((rule as CSSMediaRule).cssRules);
        continue;
      }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const sel = (rule as CSSStyleRule).selectorText || "";
      const style = rule as CSSStyleRule;
      const isDark = /(^|[\s,])\.dark/.test(sel);
      const isRoot = sel.includes(":root") || sel.includes("html");
      if (!isDark && !isRoot) continue;
      for (let p = 0; p < style.style.length; p++) {
        const prop = style.style[p];
        if (!prop.startsWith("--")) continue;
        const value = style.style.getPropertyValue(prop);
        if (!value.includes("oklch")) continue;
        const converted = oklchToCssSrgb(value.trim());
        if (converted) {
          (isDark ? bundle.dark : bundle.light).set(prop, converted);
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // 跨域 stylesheet 不可读——本仓产物同源，理论不发生；跳过防炸
    }
  }
  return bundle;
}

const GUARD_ID = "pdf-export-color-guard";
/* 通配兜底不带 !important：特异性让 .pdf-content 内显式 border 简写照常生效，
   兜底只命中「没有任何显式色」的元素（其 border-color 默认 currentColor，
   html2canvas 对 currentColor 沿链解析后可能仍是 oklch——钉成中性 sRGB）。 */
const WILDCARD_FALLBACK = `
*, *::before, *::after {
  border-color: #d8dde5;
  outline-color: #0f62d6;
  caret-color: #1c2330;
  accent-color: #0f62d6;
  column-rule-color: #d8dde5;
}`;

/**
 * 注入色守卫（导出前调用）。返回卸载函数——导出 promise 落定（成功或失败）
 * 后必须调用，恢复主题原样。守卫样式元素只建一次、缓存复用。
 */
export function installExportColorGuard(): () => void {
  let guard = document.getElementById(GUARD_ID) as HTMLStyleElement | null;
  if (!guard) {
    const bundle = collectOklchVars();
    const block = (vars: Map<string, string>, selector: string) => {
      if (vars.size === 0) return "";
      const lines = [...vars.entries()].map(([k, v]) => `  ${k}: ${v};`);
      return `${selector} {\n${lines.join("\n")}\n}`;
    };
    const css = [
      block(bundle.light, ":root"),
      block(bundle.dark, ".dark"),
      WILDCARD_FALLBACK,
    ]
      .filter(Boolean)
      .join("\n");
    guard = document.createElement("style");
    guard.id = GUARD_ID;
    guard.textContent = css;
    document.head.appendChild(guard);
  } else {
    // 复用时确保在 head 末尾（盖过任何后续注入的同特异性规则）
    document.head.appendChild(guard);
  }
  return () => {
    guard?.remove();
  };
}
