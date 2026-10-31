/**
 * runstat.js —— 「这次为什么没自动推演」的运行时计数
 *
 * 起因：自动推演被跳过时，原因只写在 F12 控制台里，
 *   平时看不见 ⇒ 面板没更新的时候只能问"为什么"，也看不到线索 ✗
 *   ⇒ 把跳过原因记下来，让「诊断报告」把它报出来 ✓
 *
 * ⚠️ 只活在**这次页面加载**里：
 *   不写 chat_metadata、不写 localStorage、不进导出 ✗
 *   （它只是排查线索，不是业务数据 ⇒ 刷新归零，正合适 ✓）
 *
 * ⚠️ 为什么单独一个文件：index.js（写）和 ui.js（诊断报告里读）都要用它，
 *   而 ui.js 不能反过来 import index.js（会成环）✗ ⇒ 放一个谁都能 import 的小模块 ✓
 */

let _skipped = 0;      // 被跳过的次数
let _lastReason = '';  // 最近一次为什么跳过（短词，例如「被中止」）
let _lastAt = 0;       // 最近一次跳过的时刻

/**
 * 记一次跳过。
 * @param {string} reason 短词，直接用界面语言写，例如「被中止」「没有产出内容」
 */
export function noteSkip(reason) {
    _skipped += 1;
    _lastReason = String(reason || '');
    _lastAt = Date.now();
}

/** 读计数（诊断报告用） */
export function skipStats() {
    return { skipped: _skipped, lastReason: _lastReason, lastAt: _lastAt };
}
