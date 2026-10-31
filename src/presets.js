/**
 * presets.js —— 接入酒馆自己的预设列表
 *
 * 能做到什么、不能做到什么（这点先说清楚，免得你以为是坏的）：
 *
 *   ✅ 读酒馆里所有 Chat Completion 预设的名字（不改动酒馆，也不动你当前启用的那个）
 *   ✅ 把选中预设的「模型 + 采样参数」导进插件自己的配置
 *   ✅ 预设要是 custom 源或带反代地址，连地址一起带过来
 *   ❌ 密钥导不过来 —— 酒馆的密钥存在服务端，预设文件里根本没有
 *
 * 所以密钥得自己填（插件自己的接口那一套配置）。
 */

// （这里原来 import 了 `getCtx, ST`，两个都没用到 ⇒ 删掉 ✓）

// ★ 预设条目正文里可能带**提示词模板的代码**（`<% ... %>`）——
//   列表里要标出来（跟「含变量宏」同一个待遇 ✓），推演那边要先渲染再发（见 judge.js 的 buildPresetText）
import { hasEjs } from './pt-ejs.js';

let _pmMod = null;

async function presetManagerModule() {
    // （原来是 `_pmMod !== undefined && _pmMod !== null` —— `_pmMod` 只可能是模块对象或 null，
    //   `!== undefined` 恒真 ⇒ 简写 ✓）
    if (_pmMod) return _pmMod;
    const paths = [
        '/scripts/preset-manager.js',
        '../../../../preset-manager.js',
        '../../../preset-manager.js',
    ];
    for (const p of paths) {
        try { _pmMod = await import(p); return _pmMod; }
        catch { /* 试下一个 */ }
    }
    _pmMod = null;
    return null;
}

/** 插件要接的是 Chat Completion（openai）那一套预设 */
const API_ID = 'openai';

/**
 * 列出酒馆里的预设名
 * @returns {Promise<string[]>}
 */
export async function listPresets() {
    // ① 走酒馆的 preset-manager
    try {
        const mod = await presetManagerModule();
        const pm = mod?.getPresetManager?.(API_ID);
        if (pm && typeof pm.getPresetList === 'function') {
            const { presets, preset_names } = pm.getPresetList();
            const names = Object.keys(preset_names || {});
            // 有些版本 preset_names 是 { 下标: 名字 }
            if (names.length && names.every(n => /^\d+$/.test(n))) {
                return names.map(n => preset_names[n]).filter(Boolean);
            }
            if (names.length) return names;
            return (presets || []).map(p => p?.name).filter(Boolean);
        }
    } catch { /* 落到 DOM */ }

    // ② 读界面上的预设下拉框
    try {
        const sel = document.querySelector('#preset_select') || document.querySelector('select[data-preset-manager-for*="openai"]');
        if (sel) return Array.from(sel.options).map(o => o.value || o.textContent).filter(Boolean);
    } catch { /* 忽略 */ }

    return [];
}

/** 取预设原始对象 */
export async function getPreset(name) {
    try {
        const mod = await presetManagerModule();
        const pm = mod?.getPresetManager?.(API_ID);
        if (pm && typeof pm.getPresetList === 'function') {
            const { presets, preset_names } = pm.getPresetList();
            let idx = preset_names?.[name];
            if (idx === undefined) {
                const k = Object.keys(preset_names || {}).find(k => preset_names[k] === name);
                if (k !== undefined) idx = Number(k);
            }
            if (idx !== undefined && presets?.[idx]) return presets[idx];
        }
    } catch { /* 忽略 */ }
    return null;
}

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * 把预设里的东西拆成插件能用的配置
 * ⚠️ **不含接口地址**（`baseUrl` 故意不解析）—— 搬它等于把主 API 的地址填进插件这一套，
 *   明确否掉过（它把主 API 填进去了 ✗ / 不主动去填写接口地址 ✓）
 * @returns {{model?:string, temperature?:number, maxTokens?:number, extraHeaders?:string, extraBody?:string, source:string, notes:string[]}}
 */
export function extractConfig(preset) {
    const out = { source: 'openai', notes: [] };
    if (!preset || typeof preset !== 'object') return out;

    out.source = preset.chat_completion_source || 'openai';
    out.name = preset.name || '';

    if (preset.openai_model) out.model = String(preset.openai_model);

    const t = num(preset.temperature ?? preset.temp_openai);
    if (t !== null) out.temperature = t;

    const mt = num(preset.openai_max_tokens);
    if (mt !== null && mt > 0) out.maxTokens = mt;

    // ★★ 地址**故意不搬**（报过：导入预设时把主 API 的地址填进了插件这一套 ✗）
    //   预设里的 `custom_url` / `reverse_proxy` **就是主 API 那套连接设置**（反代那一项尤其）
    //   ⇒ 搬它 = 替玩家把主 API 的地址写进插件这一套 ✗
    //     规矩是**不主动填写接口地址**，界面上那句承诺本来就写着
    //     "导入只拿「模型 + 采样参数」（见 ui-settings.js）" ✓ —— 现在代码跟它对齐 ✓
    if (preset.custom_url || preset.reverse_proxy) {
        out.notes.push('预设里带着接口地址，但插件不搬它（免得把你的主 API 地址填进插件这一套），要自己填一份');
    }

    if (preset.custom_include_headers) out.extraHeaders = String(preset.custom_include_headers);

    // 采样参数：全部塞进 extraBody，接口支持就生效、不支持就忽略
    const body = {};
    const put = (k, v) => { const n = num(v); if (n !== null) body[k] = n; };

    put('top_p', preset.top_p);
    put('frequency_penalty', preset.frequency_penalty);
    put('presence_penalty', preset.presence_penalty);
    put('top_k', preset.top_k);
    put('min_p', preset.min_p);
    put('repetition_penalty', preset.repetition_penalty);
    const seed = num(preset.seed);
    if (seed !== null && seed >= 0) body.seed = seed;

    if (preset.custom_include_body) {
        try { Object.assign(body, JSON.parse(preset.custom_include_body)); }
        catch { out.notes.push('预设的自定义请求体不是合法 JSON，已跳过'); }
    }

    if (Object.keys(body).length) out.extraBody = JSON.stringify(body, null, 2);

    if (preset.chat_completion_source && preset.chat_completion_source !== 'custom') {
        out.notes.push(`这个预设走的是酒馆的「${preset.chat_completion_source}」通道，密钥存在酒馆服务端，插件读不到，所以要自己在这里填一个密钥`);
    }

    return out;
}

/** 一步到位：列出名字 + 详情，给设置界面用 */
export async function describePreset(name) {
    const p = await getPreset(name);
    if (!p) return null;
    return extractConfig(p);
}


// ---------------------------------------------------------------------------
// 预设里的「条目」
//
// 一个预设可能有上百条（破限、字数、语言、思维链……）。
// 这里把它们读出来，让玩家**在插件里**单独开关，只影响插件自己的那次请求。
//
// ⚠️ 安全：很多条目用了 {{setvar::}} / {{addvar::}} / {{getvar::}} 这类酒馆变量宏。
// 插件**不会**去展开它们 —— 展开会在你的酒馆里写入变量，那是动你的东西。
// 含这类宏的条目会被标出来，默认不勾选。
// ---------------------------------------------------------------------------

const VAR_MACRO = /\{\{\s*(setvar|addvar|getvar|setglobalvar|getglobalvar|delvar)\s*::/i;

export function hasVarMacro(text) {
    return VAR_MACRO.test(String(text || ''));
}

/**
 * 列出某个预设里的所有「有内容」的条目
 * @returns {Promise<Array<{id,name,role,content,presetEnabled,hasMacro}>>}
 */
export async function listPresetEntries(name) {
    const preset = await getPreset(name);
    if (!preset) return [];

    const byId = new Map();
    for (const p of (preset.prompts || [])) {
        if (!p || !p.identifier) continue;
        byId.set(p.identifier, p);
    }

    const order = Array.isArray(preset.prompt_order) && preset.prompt_order[0]?.order
        ? preset.prompt_order[0].order
        : [];

    const seen = new Set();
    const out = [];

    const push = (identifier, enabled) => {
        if (seen.has(identifier)) return;
        seen.add(identifier);
        const p = byId.get(identifier);
        if (!p) return;
        const content = String(p.content || '').trim();
        if (!content) return;   // 空条目（只是结构占位）不用列
        out.push({
            id: identifier,
            name: String(p.name || identifier),
            role: String(p.role || 'system'),
            content,
            presetEnabled: !!enabled,
            hasMacro: hasVarMacro(content),
            hasEjs: hasEjs(content),
        });
    };

    for (const o of order) {
        if (o && o.identifier) push(o.identifier, o.enabled);
    }
    for (const p of (preset.prompts || [])) {
        if (p && p.identifier) push(p.identifier, false);
    }
    return out;
}

/** 取勾选的那些条目的正文（按预设顺序） */
export async function selectedPresetEntries(selected) {
    if (!selected || typeof selected !== 'object') return [];
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (!ids.length) return [];
    // 从任意一个含这些 id 的预设里取内容：先试当前记录的那个预设
    const { settings } = await import('./settings.js');
    const name = settings().api?.presetName;
    let entries = name ? await listPresetEntries(name) : [];
    if (!entries.length) return [];
    return entries.filter(e => selected[e.id]);
}

/** 只做最安全的宏替换：{{user}} / {{char}}。绝不动酒馆变量宏。 */
export function safeSubstitute(text, user, char) {
    return String(text || '')
        .replace(/\{\{user\}\}/gi, user || '{{user}}')
        .replace(/\{\{char\}\}/gi, char || '{{char}}');
}
