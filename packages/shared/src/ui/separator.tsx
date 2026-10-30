/*
 * shadcn/ui 官方 registry 一手源（style=base-nova，2026-10-30 经
 * https://ui.shadcn.com/r/styles/base-nova/{name}.json 取回）。
 * 逐字收编，零改动（imports 仍指官方约定的 "cn" / "@base-ui/react/*"）。
 * 升级对照：重取 registry JSON diff 本文件。
 */
"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "cn"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
