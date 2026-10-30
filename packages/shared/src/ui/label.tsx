/*
 * shadcn/ui 官方 registry 一手源（style=base-nova，2026-10-30 经
 * https://ui.shadcn.com/r/styles/base-nova/{name}.json 取回）。
 * 逐字收编，零改动（imports 仍指官方约定的 "cn" / "@base-ui/react/*"）。
 * 升级对照：重取 registry JSON diff 本文件。
 */
"use client"

import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
