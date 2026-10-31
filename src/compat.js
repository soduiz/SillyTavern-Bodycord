/**
 * compat.js —— 与酒馆核心 / 其它插件共存时要注意的事
 *
 * ⚠️ 这个文件是为了修一个自己造成的坑：
 *
 *   `st.js` 的 `setPrompt()` 原本有三条路，第③条是「用 `/inject` 斜杠命令」的退路：
 *
 *       run(`/inject id=${key} position=system_depth depth=${depth} "${q}"`);
 *
 *   而酒馆核心的 `/inject`（见 `public/scripts/slash-commands.js`）是这样实现的：
 *
 *       chat_metadata.script_injects[id] = { value, position, depth, scan, role, filter };
 *       saveMetadataDebounced();          // ← ★ 它会把这条注入**写进聊天文件**
 *
 *   ⇒ 后果：只要这个插件在酒馆上走了第③条退路，那条注入就被**永久持久化**进
 *     `chat_metadata.script_injects`。于是：
 *       · 禁用插件 → 还在（内容已经落盘）
 *       · 把插件文件夹挪走 → 还在
 *       · 关掉任何扩展 → 还在（是酒馆加载聊天时自己恢复的）
 *       · `extensionPrompts` 看着是空的（因为没插件在跑）
 *     症状就是插件关了提示词还在插入。
 *
 *   ⇒ 两条修法（都在这里）：
 *     ①`st.js` 里**删掉第③条退路**，并且启动时清掉历史留下的 `bodycord_*` 注入；
 *     ②本文件提供 `cleanStaleScriptInjects()` —— **落盘那份和内存那份一起清**，
 *       并且在三处跑：启动时（index.js）、**换聊天时**（onChatChanged）、
 *       以及**被宿主禁用期间的 2 秒兜底监视器**里（lifecycle.js）——
 *       最后那处最要紧：扩展被禁用后 JS 还活着，它保证"禁用状态也一定清干净" ✓
 */

import { getCtx, saveChatMetadata, ST, hasWindow } from './st.js';

/** 酒馆的 `/inject` 存进聊天元数据时，id 的形态 */
const SCRIPT_INJECTS_KEY = 'script_injects';

/**
 * 酒馆把 `/inject` 存进**内存**时用的 key 前缀
 * （见 `public/scripts/slash-commands.js` 的 `SCRIPT_PROMPT_KEY = 'script_inject_'`）。
 */
const SCRIPT_PROMPT_KEY = 'script_inject_';

/** 哪些 id 是我们自己留下的（要清掉） */
const OUR_PREFIX = /^(?:bodycord|bc[-_])/i;

/**
 * 酒馆当前在内存里的扩展注入表（`extension_prompts`）。
 *
 * ⚠️ 为什么必须拿到它：`/inject` 是**两处都写** ——
 *   ① 落盘进聊天文件（`chat_metadata.script_injects`）
 *   ② 同时塞进内存这张表（key = `script_inject_<id>`）
 *   聊天一加载，酒馆的 `processChatSlashCommands()` 又把落盘那份重新塞一遍。
 *   ⇒ **只删落盘那份不够**：当前这个页面会话里，内存那张表还在 ⇒ 提示词照样带着它 ✗
 *     （报障：插件彻底关闭了还是塞进去，就是这条）
 */
function extensionPromptsMap() {
    try {
        const c = getCtx();
        if (c?.extensionPrompts && typeof c.extensionPrompts === 'object') return c.extensionPrompts;
    } catch { /* 试下一条 */ }
    try {
        if (ST.script?.extension_prompts && typeof ST.script.extension_prompts === 'object') return ST.script.extension_prompts;
    } catch { /* 试下一条 */ }
    try {
        if (hasWindow() && window.extension_prompts && typeof window.extension_prompts === 'object') return window.extension_prompts;
    } catch { /* 忽略 */ }
    return null;
}

/**
 * 把内存里那一条清掉。
 *   · 能拿到那张表 ⇒ 直接 delete（酒馆自己也是这么清的，见 `processChatSlashCommands`）
 *   · 拿不到 ⇒ 退一步用官方接口把 value 写空（酒馆构建提示词时 `!value` 就跳过 ✓）
 */
function clearMemoryPrompt(key, inj) {
    try {
        const prompts = extensionPromptsMap();
        if (prompts) {
            if (key in prompts) delete prompts[key];
            return;
        }
    } catch { /* 落到下面那条路 */ }
    try {
        const fn = getCtx()?.setExtensionPrompt || ST.script?.setExtensionPrompt;
        if (typeof fn === 'function') {
            fn(key, '', Number(inj?.position ?? 0), Number(inj?.depth ?? 4),
                !!inj?.scan, Number(inj?.role ?? 0), null);
        }
    } catch { /* 忽略 */ }
}

/**
 * 清掉聊天里「我们自己留下的」脚本注入 —— **落盘那份 + 内存那份**都要清。
 *
 * 为什么要清：那是历史版本走 `/inject` 退路时落盘的，插件现在已经不写它们了，
 *   但酒馆每次加载聊天都会把它们**重新应用**到提示词上 —— 只要不删就永远在。
 *
 * ⚠️ 幂等、便宜：没有我们的 id 时什么都不做（那个 2 秒的兜底监视器每轮都调它 ✓）。
 *
 * @returns {{removed:string[], cleared:string[], remaining:number, ours:number, ok:boolean}}
 */
export function cleanStaleScriptInjects() {
    const out = { removed: [], cleared: [], remaining: 0, ours: 0, ok: false };
    try {
        const c = getCtx();
        const meta = c?.chatMetadata ?? c?.chat_metadata;
        const map = meta?.[SCRIPT_INJECTS_KEY];

        // ---- ① 内存里那份（最要紧：只删落盘的，当前会话照样注入 ✗）----
        const prompts = extensionPromptsMap();
        if (prompts) {
            for (const k of Object.keys(prompts)) {
                if (!k.startsWith(SCRIPT_PROMPT_KEY)) continue;
                const id = k.slice(SCRIPT_PROMPT_KEY.length);
                if (!OUR_PREFIX.test(id)) continue;                 // 别人的注入一个字都不动 ✓
                clearMemoryPrompt(k, map?.[id]);
                out.cleared.push(k);
            }
        }
        if (!meta) { out.ok = true; return out; }                   // 没在聊天里，不用管
        if (!map || typeof map !== 'object') { out.ok = true; return out; }

        // ---- ② 聊天文件里落盘的 ----
        for (const id of Object.keys(map)) {
            if (!OUR_PREFIX.test(id)) continue;
            const inj = map[id] || {};
            clearMemoryPrompt(SCRIPT_PROMPT_KEY + id, inj);
            delete map[id];                                          // 用酒馆自己的语义删 ✓
            out.removed.push(id);
        }

        if (out.removed.length) {
            if (Object.keys(map).length === 0) delete meta[SCRIPT_INJECTS_KEY];
            try { saveChatMetadata(); } catch { /* 忽略 */ }
            console.log('[Bodycord] 已清掉历史遗留的脚本注入（酒馆 /inject 落盘的那种）：'
                + out.removed.join('、'));
        }

        out.remaining = Object.keys(meta[SCRIPT_INJECTS_KEY] || {}).length;
        out.ours = Object.keys(meta[SCRIPT_INJECTS_KEY] || {}).filter((id) => OUR_PREFIX.test(id)).length;
        if (out.cleared.length) {
            console.log('[Bodycord] 已清掉内存里的脚本注入（不然当前这次会话还会带上它）：'
                + out.cleared.join('、'));
        }
        out.ok = true;
        return out;
    } catch (e) {
        console.warn('[Bodycord] 清理历史脚本注入失败', e);
        return out;
    }
}
