/// <reference types="vite/client" />

/* .vue 单文件组件对纯 tsc 不透明：shim 为任意模块（vendored 树的 .vue 由
   Vite vue 插件编译，类型检查由上游 vue-tsc 负责，本仓绿门只查 glue 层 .ts） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

/* scss 以字符串形态 ?inline 导入（global reset 作用域化注入用） */
declare module '*.scss?inline' {
  const css: string;
  export default css;
}

/* vendored 树内的 .vue 通用 shim（含 ?query 形态） */
declare module '*.vue?inline' {
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
