/**
 * intercept.js —— 发送前瘦身：只留最近 N 条状态栏
 *
 * 需求：只给主 API 发**最近三条**状态栏，而且只数**系统层**（不包括用户层）✓
 *
 * 为什么这么做是对的：
 *   状态栏是**累积**的 —— 第 7 轮那块里已经写着「累计受孕率 52.5%、Day15」，
 *   前面第 5、6 轮那两块的信息**全部过时且重复**，纯属白吃 token。
 *   留最近几条还多一个好处：AI 能看出**变化趋势**（22.5% → 37.5% → 52.5%），
 *   比只留一条更好。
 *
 * 怎么做到的：
 *   酒馆在真正发请求之前会派发事件，扩展可以在**内存里**改要发的内容 ——
 *     · 聊天补全（chat completion）→ CHAT_COMPLETION_PROMPT_READY，eventData.chat 是消息数组
 *     · 文本补全（text completion）→ GENERATE_AFTER_COMBINE_PROMPTS，eventData.prompt 是字符串
 *   ⚠️ 是**内存**里改，绝不碰用户的聊天文件（那是红线）。
 */

import { getEventSource, getEventTypes } from './st.js';
import { settings } from './settings.js';

/** 一轮状态栏的样子（主 API 看到的） */
const BLOCK_RE = /<status_profile[\s\S]*?<\/status_profile>/gi;

/** 是否包含状态栏（不用 .test —— 带 g 的正则有 lastIndex 状态，会漏判） */
function hasBlock(text) {
    return typeof text === 'string' && /<status_profile[\s\S]*?<\/status_profile>/i.test(text);
}

/** 剥掉一条里的全部状态栏 */
function stripBlocks(text) {
    return String(text)
        .replace(BLOCK_RE, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** 该留几条（0 或负数 = 全剥；undefined = 默认 3） */
function keepCount() {
    const v = settings()?.stateKeep;
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 3;
}

/**
 * 把「最近 keep 条以外」的状态栏从消息数组里剥掉。
 *
 * 从后往前数：只要**含状态栏**的消息才计数，用户消息天然不含，所以自动跳过。
 *
 * @param {Array} chat   消息数组（会被就地修改）
 * @param {number} keep  保留最近几条
 * @returns {{kept:number, stripped:number, chars:number}} 统计（诊断用）
 */
export function stripOldStateBlocks(chat, keep = keepCount()) {
    const out = { kept: 0, stripped: 0, chars: 0 };
    if (!Array.isArray(chat)) return out;

    let seen = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m) continue;
        // 多模态的 content 是数组，跳过（拆开重组容易出错）
        const text = typeof m.content === 'string' ? m.content : (typeof m.mes === 'string' ? m.mes : null);
        if (text === null || !hasBlock(text)) continue;

        seen++;
        if (seen <= keep) { out.kept++; continue; }

        const before = text.length;
        const after = stripBlocks(text);
        if (typeof m.content === 'string') m.content = after;
        else m.mes = after;
        out.stripped++;
        out.chars += before - after.length;
    }
    return out;
}

/**
 * 文本补全那条路（prompt 是一整条长字符串，里面每轮状态栏都串在一起）。
 * 同样只留最近 keep 条。
 */
export function stripOldStateBlocksFromText(prompt, keep = keepCount()) {
    const text = String(prompt || '');
    const hits = text.match(BLOCK_RE);
    if (!hits || hits.length <= keep) return text;
    // 从后往前数，保留最后 keep 个，其余就地删掉
    let n = 0;
    return text.replace(BLOCK_RE, (m) => {
        n++;
        return n > hits.length - keep ? m : '';
    }).replace(/\n{3,}/g, '\n\n');
}

let _installed = false;

/**
 * 挂上拦截器。initUI 之后调用一次即可。
 * @returns {{ok:boolean, error?:string}}
 */
export function installPromptInterceptor() {
    if (_installed) return { ok: true };
    try {
        const es = getEventSource();
        if (!es || typeof es.on !== 'function') return { ok: false, error: '拿不到 eventSource' };
        const ET = getEventTypes() || {};

        // ① 聊天补全：改消息数组
        const evChat = ET.CHAT_COMPLETION_PROMPT_READY || 'CHAT_COMPLETION_PROMPT_READY';
        es.on(evChat, (data) => {
            try {
                if (!data || !Array.isArray(data.chat)) return;
                const r = stripOldStateBlocks(data.chat, keepCount());
                if (r.stripped) console.debug(`[Bodycord] 状态栏瘦身：留 ${r.kept} 条，剥掉 ${r.stripped} 条（省 ${r.chars} 字符）`);
            } catch (e) { console.warn('[Bodycord] 状态栏瘦身失败（聊天补全）', e); }
        });

        // ② 文本补全：改整条 prompt 字符串
        const evText = ET.GENERATE_AFTER_COMBINE_PROMPTS || 'GENERATE_AFTER_COMBINE_PROMPTS';
        es.on(evText, (data) => {
            try {
                if (!data || typeof data.prompt !== 'string') return;
                data.prompt = stripOldStateBlocksFromText(data.prompt, keepCount());
            } catch (e) { console.warn('[Bodycord] 状态栏瘦身失败（文本补全）', e); }
        });

        _installed = true;
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}
