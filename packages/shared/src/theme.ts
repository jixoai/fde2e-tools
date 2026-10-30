/*
 * 主题辅助 —— packages/shared/src/theme.ts
 *
 * 官方 solid-glass 主题（vendor 原件 theme/solid-glass.css）的深色路径只有
 * `.dark` 类（官方原件无 prefers-color-scheme 块）。存量三工具均支持系统深色
 * 自动翻面——为保住该行为，各 app 启动时调用 applySystemDark()：系统深色时给
 * <html> 挂 .dark，激活官方 .dark token 组；显式 data-theme="light" 时不挂
 * （为未来手动切换预留）。不引入任何新颜色值。
 */
export function applySystemDark(): void {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    const forcedLight = document.documentElement.getAttribute("data-theme") === "light";
    document.documentElement.classList.toggle("dark", prefersDark.matches && !forcedLight);
  };
  sync();
  // 跟随系统实时翻面（无手动切换面时即系统偏好唯一权威）
  prefersDark.addEventListener?.("change", sync);
}
