/**
 * pt-ejs.js —— 把世界书里的「提示词模板代码」渲染成正文（选「乙」）
 *
 * 要解决的问题：
 *   插件读世界书是读**条目原文**，而提示词模板的 `<% ... %>` 是在**提示词拼完之后**
 *   才渲染的 ⇒ 推演那条 API 会收到没渲染的模板源码（实测有台机器上 14 本书、91 条正文里有）。
 *
 * 走的路（「乙」）：
 *   调提示词模板给外部留的公开入口 `globalThis.EjsTemplate.evalTemplate(文本)`。
 *   渲染出来的就是**主 API 看到的那段字**，正文一个字不丢 ✓
 *
 * 三条边界（都是项目既有规矩）：
 *   ① 提示词模板**没装或关着** ⇒ 不渲染、世界书原样发。
 *      理由：它的文档写着「关掉之后 `<% %>` 会原样发给 LLM」⇒ 那时主 API 看到的也是源码，
 *      插件跟主 API 保持同一个口径（主 API 怎么读，插件 API 就怎么读 ✓），
 *      不在这里自作主张改口径 ✓
 *   ② 渲染**报错 / 拿不到结果** ⇒ 那一条不给推演（由调用方跳过）。
 *      宁可少一条，也绝不把模板源码喂给推演 ✗
 *   ③ 同一轮里同一条目只渲染一次（调用方按 uid 去重）。
 *      ⚠️ **不许跨轮缓存**：渲染结果跟着变量走，缓存了下一次就会发上一轮的内容 ✗
 *
 * ⚠️ 已知代价：卡作者写在这些段里的 JS 会被**多跑一次**。
 *   多数是 `getvar` 读值 / 按条件选一段文字（跑两遍没影响）；
 *   少数写「变量自增 / 掷随机数 / 斜杠命令」的会算两遍。
 */

import { getExtensionSettings } from './st.js';

/**
 * 这段文字里有没有提示词模板的代码？
 * 只认 `<%`（EJS 的开标签）—— 提示词模板的装饰器 `@@xxx` 只写在**世界书条目内容的第一行**，
 * 提示词模板自己会在处理世界书时剥掉，不归这里管 ✓
 */
export function hasEjs(text) {
    return /<%/.test(String(text ?? ''));
}

/** 现在能不能请提示词模板帮忙渲染？（没装 / 它自己关着 ⇒ 不能） */
export function ptRenderReady() {
    try {
        const pt = getExtensionSettings()?.EjsTemplate;
        if (pt && pt.enabled === false) return false;
        return typeof globalThis?.EjsTemplate?.evalTemplate === 'function';
    } catch {
        return false;
    }
}

let _warnedOnce = false;

/**
 * 请提示词模板把这段模板代码渲染成正文。
 * @param {string} text
 * @returns {Promise<string|null>} 渲染结果；失败返回 null（调用方据此跳过这一条）
 */
export async function renderEjsText(text) {
    const fn = globalThis?.EjsTemplate?.evalTemplate;
    if (typeof fn !== 'function') return null;
    try {
        const out = await fn(String(text ?? ''));
        return typeof out === 'string' ? out : null;
    } catch (e) {
        if (!_warnedOnce) {
            _warnedOnce = true;
            console.warn('[Bodycord] 世界书里的模板代码渲染失败（这一条不给推演）', e);
        }
        return null;
    }
}
