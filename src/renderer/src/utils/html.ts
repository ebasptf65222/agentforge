// P2-OPT28: Shared HTML utility functions
// 提取重复的 escapeHtml 实现，供 CodeBlock.vue 和 markdown.ts 共用

/**
 * 转义 HTML 特殊字符，防止 XSS。
 *
 * 转义映射：
 * - &  → &amp;
 * - <  → &lt;
 * - >  → &gt;
 * - "  → &quot;
 * - '  → &#039;
 *
 * @param str - 需要转义的原始字符串
 * @returns 转义后的安全字符串，可安全插入 HTML 文本内容或属性
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
