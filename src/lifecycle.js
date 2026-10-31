/**
 * lifecycle.js —— 扩展的生命周期钩子 + 一道兜底
 *
 * 为什么单独一个文件：
 *   钩子函数必须是 `index.js` 导出的（酒馆 `callExtensionHook` 会
 *   `await import('/scripts/extensions/<name>/index.js')` 然后调它）。
 *   但 `index.js` 的顶层代码会去等酒馆上下文、启动整套 UI —— **在 Node 里
 *   跑测试时一 import 就炸**（`document is not defined`、`boot()` 一堆 DOM 操作）。
 *   所以逻辑放这里，`index.js` 只写 `export { onDisable } from './src/lifecycle.js'`。
 *
 * ⚠️ 为什么必须有 onDisable：
 *   报过的 bug：插件在「管理扩展程序」里关掉之后，提示词还在插入。
 *   根因是**酒馆的扩展开关不重载页面** —— `disableExtension(name, false)`，
 *   然后在扩展管理器里点一下就走这条路（`reload = false`）。
 *   于是插件的 JS 还在内存里跑着，那份 `setExtensionPrompt` 写进去的内容
 *   也还留在 `extension_prompts` 里，AI 每一轮继续收到「角色身体状态 / 沉浸补丁」。
 *
 * ⚠️⚠️ 为什么还要有 startDisabledWatch（兜底）：
 *   钩子能不能被调到，取决于酒馆能不能通过 `manifests[name]` 找到我们 ——
 *   而本地安装的扩展、不同酒馆版本、名字前缀（`third-party/`）这些都有变数。
 *   明确指出过：这个问题你并没有修复，我插件是关闭状态还会发送这个提示词，
 *   所以不能再赌钩子：**自己盯 `extension_settings.disabledExtensions`**，
 *   只要发现自己在禁用名单里，就持续清注入 + 收界面。
 *   这条路径不依赖任何钩子，只要插件的 JS 还活着（禁用后它本来也还在）就一定生效。
 */

import { clearInjection } from './prompt.js';
import { isMyExtensionDisabled } from './st.js';
import { cleanStaleScriptInjects } from './compat.js';

/**
 * 插件是不是"整个被关掉了"（只算**酒馆扩展管理器**那个开关）。
 *
 * ***** 这里**绝对不能看设置里的「插件总开关」`settings().enabled`** ✗✗✗
 *   —— 纠正过两次：
 *     ① 总开关关的是"追踪 / 推演"这类功能，**不是把面板都封了** ✓
 *        ⇒ 总开关只关"推演 + 注入"，**面板/悬浮球**照常能用能看 ✓
 *        （★ 补充更正：**楼层那排不算"面板"** —— 更早的说法是"关闭插件功能之后，
 *          还在聊天界面下方显示参与推演还是不参与"✗
 *          ⇒ 楼层那排属于"推演/追踪"的功能面，跟着总开关收掉；收的地方在 ui.js 的
 *            `floorsOn()`。**这个监视器只管"宿主禁用了整个扩展"那一种情况** ✓）
 *     ②总开关也加进这个判断之后**当场炸了**：报的现象是"刚打开面板就消失了、悬浮球从实心
 *       变成半透明的"＋控制台刷 `检测到插件已被关掉…界面已收起` ✗
 *        ⇒ 说明这个判断在那边**一直是 true**，每 2 秒收一次界面（面板刚开就被收掉）。
 *          （`isMyExtensionDisabled()` 那条老逻辑从来没误报过，是新加的那条
 *           `settings().enabled === false` 引入了误判 —— 但无论原因是什么，
 *           语义上它本来就不该出现在这里 ✓）
 *        ⇒ 这也是一条教训：**"关闭态"的判断只许用宿主/权威信号**，
 *          自己家的设置项不要塞进**周期性**的破坏逻辑里 ✓
 *
 * ⇒ 结论：**"整个插件不存在"只有一种情况 = 宿主把扩展禁用了** ✓。
 */
function pluginIsOff() {
    try { return isMyExtensionDisabled(); } catch { return false; }
}

/**
 * 把插件的界面收掉（看不见 = 关掉了）。
 *
 * ⚠️⚠️ 这里只在**酒馆扩展被宿主禁用**时才被调用（`pluginIsOff` 里看的是
 *   `isMyExtensionDisabled()`；**不是**设置里的「插件总开关」✗）。
 *   纠正过一处：
 *   「**我说的是只关闭追踪之类的功能，不是把面板都 BAN 了啊**」✓
 *   ⇒ 「插件总开关」= 只关推演与注入，**界面照旧能用、能看** ✓；
 *     扩展被宿主禁用 = 整个插件不该存在，界面才该收 ✓。
 *
 * ⚠️ 但**悬浮球（`#bc-fab`）永远不收** ✗ —— 它是唯一入口，
 *   收了就再也打不开插件了（也报过"刷新之后悬浮球没了" ✓）。
 */
function hideUI() {
    try {
        // ⚠️⚠️ 分成**两类** ——
        //   ① **临时浮层**（弹窗 / 楼层面板 / 歌词条）：直接 remove ✓（它们本来就随时重建）
        //   ② **只建一次的东西**（面板外壳 `.bc-root`、状态栏视图、设置页抽屉、内联宿主）：
        //      原来也 remove ✗ ⇒ 取消禁用之后（页面没重载）它们**回不来** ——
        //      `initUI()` 全仓只跑一次，`togglePanel()` 只是给脱离文档的节点加类名 ⇒
        //      点悬浮球一点反应都没有、抽屉永远缺一块 ✗
        //      ⇒ 改成**加类名隐藏**，由 `restoreUI()` 摘掉 ✓
        document.querySelectorAll(
            '.bc-modal-overlay, .bc-floor, .bc-floor-body, .bc-lyrics',
        ).forEach((el) => el.remove());
        document.querySelectorAll(
            '.bc-root, .bc-inline-host, .bc-status-view, .bodycord-drawer',
        ).forEach((el) => el.classList.add('bc-off-hidden'));
        const fab = document.getElementById('bc-fab');
        if (fab) {
            // ★ 原标题先记下来，恢复时还回去（别写死一句会过期的提示 ✗）
            if (!fab.dataset.bcPrevTitle) fab.dataset.bcPrevTitle = fab.title || '';
            fab.classList.add('off');
            fab.title = '扩展在酒馆的「扩展」页面里被禁用了，到那里重新勾选就能用';
        }
    } catch { /* 没有 DOM，忽略 */ }
}

/** ★ 把 `hideUI()` 收掉的东西**放回来** ——
 *  取消禁用之后**不刷新页面**也能继续用（不然那句"自动恢复"就是空承诺 ✗）✓ */
function restoreUI() {
    try {
        document.querySelectorAll('.bc-off-hidden').forEach((el) => el.classList.remove('bc-off-hidden'));
        const fab = document.getElementById('bc-fab');
        if (fab) {
            fab.classList.remove('off');
            if (fab.dataset.bcPrevTitle) {
                fab.title = fab.dataset.bcPrevTitle;
                delete fab.dataset.bcPrevTitle;
            }
        }
    } catch { /* 忽略 */ }
}

let _watching = false;
let _wasDisabled = false;

/**
 * 兜底监视器：不依赖酒馆的钩子，自己盯着"我是不是被关掉了"。
 *
 * 一旦发现被关掉（**扩展开关**）→ 持续清注入 + 收界面。
 * 重新打开后（页面还没重载时）自动恢复。
 *
 * ⚠️ 这里**每轮都要收界面**，不能只在"刚变成关掉"那一次收：
 *   ui.js 的 syncPresentation（1.2 秒一次的心跳）会按 floorsOn() 决定画不画楼层，
 *   而那个监视器只看 `isMyExtensionDisabled()`（**不看总开关** ✓）⇒ 宿主禁用期间
 *   楼层不会被画回来；但"关掉的那一刻还没生效"的窗口里，残留的面板必须被抹掉 ✓
 *   ⇒ 两处都判、一处持续收，双保险。
 *
 * @param {number} everyMs 检查间隔
 */
export function startDisabledWatch(everyMs = 2000) {
    if (_watching) return;
    _watching = true;
    setInterval(() => {
        const off = pluginIsOff();
        if (off) {
            // 每轮都清一次：关掉期间任何一次残留都会被抹掉
            try { clearInjection(); } catch { /* 忽略 */ }
            try { hideUI(); } catch { /* 忽略 */ }
            // ★★ （报障：彻底关闭了还是塞进去）：**落盘的脚本注入也要清**。
            //   酒馆加载聊天时会把 `chat_metadata.script_injects` 里的东西重新塞进提示词，
            //   而我们那两段是不会被 `clearInjection()` 碰到的（那是内存里的扩展注入表，
            //   是不同的 key）⇒ 禁用期间也要把这份清掉，不然"关了还在"永远成立 ✗
            //   幂等 + 便宜：没有我们的 id 时什么都不做 ✓
            try { cleanStaleScriptInjects(); } catch { /* 忽略 */ }
            if (!_wasDisabled) {
                _wasDisabled = true;
                console.log('[Bodycord] 检测到插件已被关掉（扩展开关）—— 注入已清除、界面已收起');
            }
        } else if (_wasDisabled) {
            _wasDisabled = false;
            // ★ 把 hideUI 收掉的界面**放回来**（不刷新页面也能继续用 ✓）
            try { restoreUI(); } catch { /* 忽略 */ }
            console.log('[Bodycord] 插件已重新启用');
        }
    }, everyMs);
}

/** 扩展被禁用时（酒馆的 disable 钩子）：把注入从提示词里撤干净 */
export function onDisable() {
    try {
        // setPrompt(key, '') —— 酒馆侧 getAllExtensionPrompts() 里
        // `if (!value) continue`，空值等于完全不注入、不占 token。
        clearInjection();
        console.log('[Bodycord] 已被禁用，注入已清除 —— 不会再有内容插进提示词');
    } catch (e) {
        console.warn('[Bodycord] 禁用时清理注入失败', e);
    }
    hideUI();
}

// ---------------------------------------------------------------------------
// ⚠️ 这里**故意没有 onEnable**，别加回来。
//
// 原因：扩展管理器里那个勾选框走的是 `enableExtension(name, false)`（reload = false），
//   而它第一行就是 `callExtensionHook(name, 'enable')` —— 那个函数会
//   `await import(index.js)`。**而插件被禁用时 index.js 压根没加载过**，
//   于是这次 import 会把顶层代码从头跑一遍：waitForST → boot → 整套 UI 初始化，
//   **面板会当场弹出来盖在扩展管理器后面**。
//   现象：插件还没载入的时候点一下那个勾选框，就会弹出这个透明框盖在管理器后面 ✗
//   判据：**单纯点一下不该触发载入**。
//
// 不声明 enable 钩子 → `callExtensionHook` 里 `if (!Object.hasOwn(manifest.hooks, hookName)) return`
//   → 直接返回、不 import → 插件不载入 → **等关掉管理器、酒馆重载时才正常启动**。
//
// 对比：disable 钩子是安全的 —— 那时插件**正在跑**、模块早就加载过，
//   同样的 import 只会拿到缓存实例，不会重跑顶层代码。
// ---------------------------------------------------------------------------
