/**
 * WebMCP schema 单源测试 —— src/webmcp-schema.test.ts
 *
 * 契约（file-viewer-frameless A4）：`preview_file` 的 inputSchema 必须由
 * registry `urlParams` 单源派生——新增 frameless/size/background 后，派生结果
 * 必须自动带上三参，页面不得手写第二份 schema。
 */
import { describe, expect, it } from 'vitest';
import { TOOLS } from '@fde2e-tools/shared/registry';
import { schemaFromUrlParams } from '@fde2e-tools/shared/webmcp';

const fileViewer = TOOLS.find((t) => t.id === 'file-viewer')!;

describe('file-viewer registry urlParams（单源）', () => {
  it('登记了无壳三参且语义可读', () => {
    const names = fileViewer.urlParams.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['url', 'name', 'decoder', 'frameless', 'size', 'background']),
    );
    const frameless = fileViewer.urlParams.find((p) => p.name === 'frameless')!;
    expect(frameless.enum).toEqual(['1', 'true']);
  });

  it('preview_file 入口仍在 registry 工具清单里', () => {
    expect(fileViewer.tools.map((t) => t.name)).toContain('preview_file');
  });
});

describe('schemaFromUrlParams（派生）', () => {
  it('无壳三参自动进入 JSON Schema（不手写第二份）', () => {
    const schema = schemaFromUrlParams(fileViewer) as {
      type: string;
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      additionalProperties: boolean;
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    for (const name of ['url', 'name', 'decoder', 'frameless', 'size', 'background']) {
      expect(schema.properties[name]).toMatchObject({ type: 'string' });
      expect(schema.properties[name].description.length).toBeGreaterThan(0);
    }
    expect(schema.properties.frameless.enum).toEqual(['1', 'true']);
  });
});
