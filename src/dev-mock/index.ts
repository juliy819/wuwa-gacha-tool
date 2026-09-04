/**
 * dev-mock 模块
 *
 * 开发环境下的模拟数据/功能集合，用于在不依赖真实后端或真实数据的情况下，
 * 预览和调试特定 UI 场景。
 *
 * 核心原则：
 *   1. 生产构建中完全不可达（所有入口均以 import.meta.env.DEV 守卫）
 *   2. 每个 mock 场景一个文件，导出一个 hook 或注册函数
 *   3. 组件内调用一行搞定，不污染生产代码结构
 *
 * 新增 mock 场景的步骤：
 *   1. 在本目录新建文件，如 `xxx-preview.ts`
 *   2. 导出一个 hook 或函数，内部用 `import.meta.env.DEV` 守卫
 *   3. 在下方 index 中导出
 *   4. 在对应页面/组件中调用
 *
 * 当前可用 mock：
 *   - useDevMockUpdatePreview — 更新公告多版本展示预览
 */

export { useDevMockUpdatePreview } from './update-preview';
export type { UpdateHistoryEntry } from './update-preview';
