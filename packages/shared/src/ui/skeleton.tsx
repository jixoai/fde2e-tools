/*
 * shadcn/ui 官方 registry 一手源（style=base-nova，2026-10-30 经
 * https://ui.shadcn.com/r/styles/base-nova/skeleton.json 取回）。逐字收编；机械适配点：
 * registry 生成器占位 IconPlaceholder → lucide-react 图标组件（保留既有
 * className），与 AGENTS.md 收编纪律允许的两处适配一致。
 * 升级对照：重取 registry JSON diff 本文件。
 */
import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
