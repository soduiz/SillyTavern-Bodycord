/**
 * judge-queue.js —— 自动推演「排着队 / 正在跑」的状态，以及取消它
 *
 * 要一个"可以中断生成"的能力，且要分**开始前 / 开始后**两种 ✓
 *   ⇒ 两格分开管：
 *     **开始前**（还在等那几秒延时）= 排队中 ⇒ 清掉定时器 ✓
 *     **开始后**（请求已经发出去、正等模型）= 正在跑 ⇒ 掐断它 ✓（靠 api.js 的 signal）
 *
 * ⚠️ 取消**不会留半截数据** —— `runJudge()` 是整段跑完才写一次
 *   （见 judge.js 末尾那次 `commit()`；中途失败只会留一行"上次推演失败"）
 *   ⇒ 所以"已写入的数据要不要清除"这个问题不存在：它压根没写 ✓
 *
 * ⚠️ 这个模块**不 import 业务模块**：
 *   index.js（排队的那个）和 ui-floors.js（楼层上那颗按钮）都要用它，
 *   而 ui-floors 不能反过来 import index.js（会成环）✗ ⇒ 放一个谁都能 import 的小模块 ✓
 *
 * ★★ 抢占（A3）：
 *   规则：自动推演途中手动推演 ⇒ 中断自动那次，按手动的来 ✓
 *   ⇒ `beginRun()` 现在是**抢占式**的：已经有一次在跑 ⇒ 先把它掐断，再开新的 ✓
 *   ⇒ 被抢掉的那次**一个字都不许写**（它的"失败还原"也不能做，否则会拿旧数据盖新数据 ✗）
 *     判据就是 `isSuperseded(signal)` —— 只有"被别人抢掉"才算，
 *     "自己点了不参与推演"仍然走原来的取消路径 ✓
 */

import { noteSkip } from './runstat.js';

let _pendingTimer = null;   // 排队中（还没到点）
let _runCtrl = null;        // 正在跑的那次的中止开关
// 被后来的推演抢掉的那些 signal（用 WeakSet：signal 对象一没人引用就自己回收 ✓）
const _superseded = new WeakSet();

/**
 * ★ 状态一变就喊一声（2026-10-15 加的）——
 *   楼层那一行的按钮要换词、球旁边那颗气泡要显示「正在推演…」，
 *   两处都得**立刻**跟上；靠 1.2 秒一次的心跳去发现虽然也行，但会慢一拍 ✓
 * ⚠️ 只通知，不传参数：要什么状态自己调 `queueState()` 问（省得两份状态对不上 ✓）
 */
const _watchers = new Set();
export function onQueueChange(fn) {
    if (typeof fn === 'function') _watchers.add(fn);
}
function notifyQueue() {
    for (const fn of [..._watchers]) {
        try { fn(); } catch { /* 一个坏了不影响别的 ✓ */ }
    }
}

/** 排队中吗（在等延时） */
export function isPending() { return _pendingTimer !== null; }

/** 正在跑吗（请求已经发出去） */
export function isRunning() { return !!_runCtrl; }

/**
 * ★★ 现在推演是什么状态 —— **界面上"正在推演"这件事只认这一个函数** ✓
 *   `''` 没在跑 ／ `'pending'` 排着队（还在等那几秒延时）／ `'running'` 请求已经发出去
 *
 * ⚠️ 别自己另立一个标志（例如外壳里那个 `busy`）：那个只在**手动推演**那条路上被置位，
 *   而**自动推演**（生成完之后自己排的那次）根本不经过它 ⇒ 只看它，界面会"假装没在跑" ✗
 *   （同一件事只能有一个控制点 —— 这里就是那个点 ✓）
 */
export function queueState() {
    if (isRunning()) return 'running';
    if (isPending()) return 'pending';
    return '';
}

/**
 * 排一次：delay 毫秒之后跑 run()。
 * ★ 新的会**顶掉**旧的（同一时刻只排一次）✓
 */
export function scheduleRun(run, delay) {
    clearPending();
    const ms = Math.max(0, Number(delay) || 0);
    _pendingTimer = setTimeout(() => {
        _pendingTimer = null;
        try { run(); } catch (e) { console.warn('[Bodycord] 排队的推演跑挂了', e); }
    }, ms);
    notifyQueue();
}

/** 清掉排队中那次（返回"真的清掉了"） */
export function clearPending() {
    if (_pendingTimer === null) return false;
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
    notifyQueue();
    return true;
}

/**
 * 开跑：造一个中止开关，把 signal 交给 api.js。
 * ★ 抢占：已经有一次在跑 ⇒ 先掐断它（它会被标成 superseded，自己什么都不写）✓
 * ⚠️ 跑完一定要 `endRun(signal)`（index.js / ui.js 都放在 finally 里）✓
 */
export function beginRun() {
    if (_runCtrl) {
        const old = _runCtrl.signal;
        _superseded.add(old);
        try { _runCtrl.abort(); } catch { /* 忽略 */ }
    }
    _runCtrl = new AbortController();
    notifyQueue();
    return _runCtrl.signal;
}

/**
 * 这次推演是不是**被别人抢掉了**（而不是自己取消的）。
 * ★ 被抢掉的那次**连失败还原都不能做** —— 接手的那次已经在改状态了，
 *   旧的那次再套一份旧数据回去就是把它盖掉 ✗
 */
export function isSuperseded(signal) {
    return !!signal && _superseded.has(signal);
}

/**
 * 收尾（正常跑完、失败、被中断都走这里）。
 * ⚠️ 要带上自己那份 signal：**现在跑的那次不是自己**（被抢了）时，
 *   绝不能把它的中止开关清掉 ✗
 */
export function endRun(signal) {
    if (!_runCtrl) return;
    if (signal && _runCtrl.signal !== signal) return;
    _runCtrl = null;
    notifyQueue();
}

/** 掐断正在跑的那次（返回"真的掐了"） */
export function abortRun() {
    if (!_runCtrl) return false;
    try { _runCtrl.abort(); } catch { /* 忽略 */ }
    notifyQueue();
    return true;
}

/**
 * ★ 按了楼层那颗「参与推演 / 不参与推演」⇒ 把这一次推演拦下来。
 *   排队中和正在跑，两格都试（哪格有就取消哪格）✓
 * @returns {{pending:boolean, running:boolean}} 取消了哪一格
 */
export function cancelRun() {
    const pending = clearPending();
    const running = abortRun();
    // 记进「自动推演跳过」（诊断报告里能看见）—— 取消也算"这次没推演" ✓
    if (pending || running) { try { noteSkip('被取消'); } catch { /* 忽略 */ } }
    return { pending, running };
}
