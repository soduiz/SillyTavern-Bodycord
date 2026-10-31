/**
 * api.js —— 插件自己的 API 客户端
 *
 * 走标准的 OpenAI 兼容格式（/chat/completions），
 * 所以 OpenAI、DeepSeek、OpenRouter、硅基流动、本地 Ollama / LM Studio / 各种中转站都能直接用。
 */

import { currentApi, apiModeOf } from './settings.js';
import { postJson } from './csrf.js';

function joinUrl(base, path) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    return b + path;
}

function parseJsonLoose(text, what) {
    if (!text || !text.trim()) return null;
    try { return JSON.parse(text); }
    catch (e) {
        console.warn(`[Bodycord] ${what} 不是合法 JSON，已忽略：`, e.message);
        return null;
    }
}

/**
 * ★ 这个错误像不像「被浏览器跨域 / 网络拦下了」？
 *
 * 为什么要认它（火山方舟这类服务商）：
 *   火山方舟这类接口**不给跨域头**，而插件的请求是浏览器直发的 ⇒ 浏览器直接拦掉，
 *   报出来是一句没头没脑的 `Failed to fetch`（服务商那边其实**根本没收到请求**）✗
 *   ⇒ 认出来之后：① 错误文案要说人话 ② 「自动」档改走酒馆后端转发（见下）
 * ⚠️ 超时 / 主动取消（AbortError）**不算**跨域 —— 那是真发出去过、只是没等到 ✓
 */
export function looksCrossOriginBlocked(e) {
    if (!e) return false;
    const name = String(e.name || '');
    if (name === 'AbortError') return false;
    if (name === 'TypeError') return true;   // fetch 的网络/跨域失败就是这个 name
    return /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_FAILED|ERR_NETWORK/i.test(String(e.message || e));
}

const CROSS_HINT = '像是被浏览器跨域拦下了（这个接口没给跨域头，请求其实没发出去）。'
    + '把这条渠道的「请求方式」改成「只用酒馆后端转发」就能用，或者换一个支持跨域的服务商。';

/**
 * ★ 这个报错像不像「接口不认我们多加的那一项」？
 *
 * 为什么要认：`thinking`（关闭原生思考）与 `response_format`（强制 JSON）都是
 *   **我们额外塞进去的**，而严格的接口（OpenAI 那边就是一例）会直接回 400
 *   `Unrecognized request argument supplied: thinking` ⇒ 一次就整条路失败 ✗
 *   ⇒ 认出来就**去掉那一项再发一次**（跟酒馆后端那条路早就有的 json_schema 重试一个道理 ✓）
 *
 * ⚠️ 宁可认宽一点：判错最坏的结果只是"多发一次请求"，判漏的后果是"玩家一勾开关就报错" ✗
 */
const REJECT_THINK = /thinking|reasoning_effort|unrecognized|unknown (request )?argument|unsupported|invalid[_ ]parameter|extra fields?|unknown parameter/i;

/**
 * 走**酒馆自己的服务器端转发**发请求（用来绕开服务商的跨域限制）。
 *
 * 用的是酒馆现成的 `/api/backends/chat-completions/generate`：
 *   · `chat_completion_source: 'openai'` + `reverse_proxy`（填地址）+ `proxy_password`（填密钥）
 *     ⇒ 这条分支**只在服务器端发请求**，浏览器不参与 ⇒ 没有跨域这回事 ✓
 *   · 它只**读**密钥、不写任何设置、也不触发事件 ⇒ 不会影响主 API 那条生成 ✓（源码核过）
 *   · 服务商报错时它也回 200、身体是 `{error:{message}}` ⇒ 这里认出来 ✓
 * ⚠️ 代价：密钥会随请求体交给**本机**酒馆服务器（不出本机）—— 所以界面上给了手动档 ✓
 */
async function chatViaTavern(cfg, body, signal, useJson) {
    const payload = {
        chat_completion_source: 'openai',
        reverse_proxy: String(cfg.baseUrl || '').trim().replace(/\/+$/, ''),
        proxy_password: String(cfg.apiKey || ''),
        model: cfg.model,
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        stream: false,
    };
    // 强制 JSON：酒馆的 openai 分支不转发 `response_format`，只认 `json_schema`
    //   （宽松 schema + strict:false ⇒ 尽量别把服务商惹毛 ✓）
    if (useJson) {
        payload.json_schema = {
            name: 'bodycord',
            strict: false,
            value: { type: 'object', additionalProperties: true },
        };
    }

    const once = async (withSchema) => {
        const p = { ...payload };
        if (!withSchema) delete p.json_schema;
        // ⚠️ 这里必须自己兜住异常（units 抓到过一次：酒馆后端不可达时异常会一路冒到调用方 ✗）
        //   常见来源：拿不到 CSRF 令牌、酒馆没开、网络断了 ⇒ 都变成"这一条路失败"，好让上层去试别的路 ✓
        try {
            const res = await postJson('/api/backends/chat-completions/generate', p, { signal });
            const rawText = await res.text();
            if (!res.ok) return { ok: false, error: `酒馆后端 HTTP ${res.status}：${rawText.slice(0, 300)}` };
            const data = parseJsonLoose(rawText, 'response');
            if (!data) return { ok: false, error: '酒馆后端返回的不是 JSON：' + rawText.slice(0, 300) };
            if (data.error) {
                const msg = String(data.error.message || JSON.stringify(data.error));
                return { ok: false, error: '服务商报错：' + msg, schemaRejected: /json_schema|response_format/i.test(msg) };
            }
            const text = data?.choices?.[0]?.message?.content;
            if (typeof text !== 'string') return { ok: false, error: '接口返回里没有 choices[0].message.content' };
            return { ok: true, text, usage: data.usage ?? null, error: null };
        } catch (e) {
            const msg = (e?.name === 'AbortError') ? '请求被中断或超时' : (e?.message || String(e));
            return { ok: false, error: '酒馆后端：' + msg };
        }
    };

    let r = await once(Boolean(useJson));
    // 服务商不吃 json_schema ⇒ 去掉它再试一次（不要让"强制 JSON"把整条路堵死 ✓）
    if (!r.ok && r.schemaRejected && useJson) r = await once(false);
    return r;
}

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {{signal?:AbortSignal, jsonMode?:boolean, cfg?:object}} opts
 *   ★ `cfg` = 指定用哪一套接口配置（不传就读"正在使用的那一套" ✓）——
 *     编辑弹窗里的「测试连接」要测**手里正在改的那套**（还没保存的那种）✓
 * @returns {Promise<{ok:boolean, text:string, usage:object|null, error:string|null, cancelled?:boolean, via?:string}>}
 *   `via` = 这一次实际走的是哪条路（`'direct'` 直连 / `'backend'` 酒馆后端）✓
 */
export async function chatCompletion(messages, opts = {}) {
    // ★ 多套接口 ⇒ 默认读**正在使用的那一套** ✓
    const cfg = opts.cfg || currentApi() || {};

    if (!cfg.baseUrl) return { ok: false, text: '', usage: null, error: '还没填插件 API 的地址，去「设置 → 基础 → 常规」里把接口地址填上' };
    if (!cfg.model) return { ok: false, text: '', usage: null, error: '还没填模型名' };

    // ★ 请求方式：自动 / 只用直连 / 只用酒馆后端 ✓
    const mode = apiModeOf(cfg);

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const extraH = parseJsonLoose(cfg.extraHeaders, 'extraHeaders');
    if (extraH && typeof extraH === 'object') Object.assign(headers, extraH);

    const body = {
        model: cfg.model,
        messages,
        temperature: Number(cfg.temperature ?? 0.6),
        max_tokens: Number(cfg.maxTokens ?? 65535),
        stream: false,
    };
    const useJson = opts.jsonMode ?? cfg.jsonMode ?? true;
    if (useJson) body.response_format = { type: 'json_object' };
    // ★★ 「关闭模型原生思考」——
    //   我们的契约本来就要求它把推理**写进 cot**（"分点写推演过程"）⇒ 模型自带的思考
    //   等于**同一件事做两遍** ✗ ⇒ 给玩家一个开关，勾上就在请求体里带这一句。
    //   火山方舟 seed 系列 / DeepSeek 认 `thinking.type`；不认的接口一般会忽略它 ✓
    //   ⚠️ 必须排在 `extraBody` **之前**：玩家要是自己手写了另一种写法，手写那份优先 ✓
    if (cfg.noThink) body.thinking = { type: 'disabled' };
    const extraB = parseJsonLoose(cfg.extraBody, 'extraBody');
    if (extraB && typeof extraB === 'object') Object.assign(body, extraB);

    // ★ 「超时」是整个**这一次调用**的上限（直连失败后走酒馆后端也在同一个上限里 ✓）
    const ctrl = new AbortController();
    // ★ 超时是**秒**（界面那格也写「超时（秒）」，默认 180 秒 ✓）
    const timeoutSec = Math.max(1, Number(cfg.timeoutSec) || 180);
    const timer = setTimeout(() => ctrl.abort(new Error('超时')), timeoutSec * 1000);
    // ★ 自己按了「取消推演」⇒ 和"超时"要分开，不然界面会报成失败 ✗
    let cancelled = false;
    if (opts.signal) {
        if (opts.signal.aborted) { cancelled = true; ctrl.abort(); }
        else opts.signal.addEventListener('abort', () => { cancelled = true; ctrl.abort(); }, { once: true });
    }

    /**
     * ★ 从 `body` 派生一份"少带一项"的请求体（2026-10-15 加）——
     *   ① `response_format`（强制 JSON）② `thinking`（关闭原生思考）
     *   这两项都可能被服务商**当不认识的参数拒掉**（回 400），而"去掉它再试一次"
     *   得拿着一份少了那一项的请求体 ⇒ 这里派生，**不动 `body` 本身** ✓
     *   （`extraBody` 里玩家自己手写的东西本来就在 `body` 上，派生时原样带走 ✓）
     */
    const bodyWith = (useJson2, useThink) => {
        const b = { ...body };
        if (!useJson2) delete b.response_format;
        if (!useThink) delete b.thinking;
        return b;
    };

    /** 直连（原来的老路，最快 ✓） */
    const tryDirect = async (useJson2 = useJson, useThink = true) => {
        try {
            const res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
                method: 'POST',
                headers,
                body: JSON.stringify(bodyWith(useJson2, useThink)),
                signal: ctrl.signal,
            });

            const rawText = await res.text();

            if (!res.ok) {
                let detail = rawText.slice(0, 500);
                const j = parseJsonLoose(rawText, 'error');
                if (j?.error?.message) detail = j.error.message;
                return { ok: false, text: '', usage: null, error: `HTTP ${res.status}：${detail}` };
            }

            const data = parseJsonLoose(rawText, 'response');
            if (!data) return { ok: false, text: '', usage: null, error: '接口返回的不是 JSON：' + rawText.slice(0, 300) };

            const text = data?.choices?.[0]?.message?.content;
            if (typeof text !== 'string') {
                return { ok: false, text: '', usage: data?.usage ?? null, error: '接口返回里没有 choices[0].message.content' };
            }
            return { ok: true, text, usage: data.usage ?? null, error: null, via: 'direct' };
        } catch (e) {
            const msg = cancelled ? '已取消'
                : (e?.name === 'AbortError' ? `请求被中断或超时（${timeoutSec} 秒）` : (e?.message || String(e)));
            const blocked = !cancelled && looksCrossOriginBlocked(e);
            return { ok: false, text: '', usage: null, error: msg, cancelled, blocked };
        }
    };

    try {
        // ① 只用酒馆后端 ⇒ 直接跳过直连
        //   ⚠️ 这条路**带不了** `thinking` 和 `extraBody` / `extraHeaders`：
        //     酒馆后端是照自己的白名单重拼请求体的（源码核过：openai 那一支只带
        //     model / messages / temperature / max_tokens 那几个），我们塞的字段会被丢掉 ✗
        //     ⇒ 界面上那句说明写清了这一点（别让人以为勾了就一定生效 ✓）
        if (mode === 'backend') {
            const r = await chatViaTavern(cfg, body, ctrl.signal, useJson);
            return r.ok ? { ...r, via: 'backend' }
                : { ok: false, text: '', usage: null, error: '酒馆后端：' + r.error, cancelled };
        }

        // ② 直连（自动档与手动"只用直连"都走这儿）
        const wantThink = !!cfg.noThink;
        let direct = await tryDirect(useJson, wantThink);
        // ★★ 「关闭原生思考」被接口拒了 ⇒ **去掉它再发一次** ✓
        //   玩家勾这个开关是为了省思考那一段 token，绝不能因此让整条推演失败 ✗
        //   （出错就退回"跟没勾一样"，并在推演状态里记一笔，让玩家知道这次没省到 ✓）
        if (!direct.ok && !direct.cancelled && wantThink && REJECT_THINK.test(String(direct.error || ''))) {
            console.warn('[Bodycord] 这个接口不认 thinking 这一项，去掉它再试一次');
            const again = await tryDirect(useJson, false);
            if (again.ok) direct = { ...again, thinkDropped: true };
        }
        if (direct.ok || !direct.blocked || mode === 'direct') {
            // 「只用直连」时把跨域提示补上，别让人对着 Failed to fetch 发呆 ✓
            if (direct.blocked && mode === 'direct') return { ...direct, error: direct.error + '，' + CROSS_HINT };
            return direct;
        }

        // ③ 自动档：直连被跨域拦了 ⇒ 改走酒馆后端
        const back = await chatViaTavern(cfg, body, ctrl.signal, useJson);
        if (back.ok) return { ...back, via: 'backend', fellBack: true };
        return {
            ok: false, text: '', usage: null, cancelled,
            error: `直连：${direct.error}；酒馆后端：${back.error}（${CROSS_HINT}）`,
        };
    } finally {
        clearTimeout(timer);
    }
}

/** 从可能带代码围栏的文字里抠出 JSON 对象 */
export function extractJson(text) {
    if (!text) return null;
    let t = String(text).trim();

    // 去掉 ```json ... ``` 围栏
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();

    // 直接试
    try { return JSON.parse(t); } catch { /* 继续 */ }

    // ★★ 抠**所有**平衡的 { ... }（会跳过字符串里的括号 ✓）
    //   口径（2026-10-14）：模型可能先写一段草稿、草稿里出现过一个 JSON 片段 ⇒
    //   原来那种"从头找第一个平衡块"会把**草稿那个**当成结果 ✗ ⇒ 现在把全部抠出来，
    //   先挑"像契约的那个"（正式结果都带 `targets`，判定那一轮至少带 `rollsUsed` ✓），
    //   都挑不出来才退回"第一个能解析的"（老行为不变 ✓）
    const blocks = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) start = i; depth++; }
        else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) { blocks.push(t.slice(start, i + 1)); start = -1; }
            }
        }
    }
    const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    for (const b of blocks) {
        const o = parse(b);
        if (o && typeof o === 'object' && !Array.isArray(o) && ('targets' in o || 'rollsUsed' in o)) return o;
    }
    for (const b of blocks) { const o = parse(b); if (o) return o; }
    return null;
}

/** 连通性测试（`cfgIn` 不传就测"正在使用的那一套" ✓） */
export async function testConnection(cfgIn = null) {
    const r = await chatCompletion([
        { role: 'system', content: '你是一个测试助手，只输出 JSON。' },
        { role: 'user', content: '输出 {"ok":true}' },
    ], cfgIn ? { jsonMode: true, cfg: cfgIn } : { jsonMode: true });
    return r;
}

/**
 * 走酒馆后端**拉模型清单**（`POST /api/backends/chat-completions/status`）。
 *
 * ★ 为什么这条能绕开跨域：这个路由是**酒馆服务器端**去 `GET <地址>/models`，
 *   浏览器不参与 ⇒ 没有跨域这回事 ✓（同一个手法也用在 chatViaTavern 上）
 *   参数跟走酒馆后端发聊天时一样：`chat_completion_source:'openai'` +
 *   `reverse_proxy`（地址）+ `proxy_password`（密钥），密钥只交给本机酒馆 ✓
 * ⚠️ 拉不到**不一定是插件的问题**：有的服务商（含火山方舟的接入点形态）压根不提供 /models ⇒
 *   那时返回"手填就行"，别让人以为配错了 ✓
 */
async function modelsViaTavern(cfg, signal) {
    // ⚠️ 同样自己兜住异常（拿不到 CSRF / 酒馆没开 / 网络断）⇒ 变成"这条路失败"，别冒到调用方 ✗
    try {
        const res = await postJson('/api/backends/chat-completions/status', {
            chat_completion_source: 'openai',
            reverse_proxy: String(cfg.baseUrl || '').trim().replace(/\/+$/, ''),
            proxy_password: String(cfg.apiKey || ''),
        }, { signal });

        if (!res.ok) {
            const t = await res.text().catch(() => '');
            return { ok: false, models: [], error: `酒馆后端 HTTP ${res.status}：${String(t).slice(0, 200)}` };
        }
        const data = parseJsonLoose(await res.text(), 'models');
        const models = pickModels(data);
        if (!models.length) {
            return {
                ok: false, models: [],
                error: '酒馆后端没拿到模型清单（这个服务商可能不实现 /models，那就手填吧；火山方舟要填接入点 ID）',
            };
        }
        return { ok: true, models, error: null, via: 'backend' };
    } catch (e) {
        const msg = (e?.name === 'AbortError') ? '请求被中断或超时' : (e?.message || String(e));
        return { ok: false, models: [], error: msg };
    }
}

/** 兼容三种形状：{data:[{id}]}（标准）/ {data:["a","b"]} / ["a","b"] ✓ */
function pickModels(data) {
    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = arr
        .map((x) => String((x && (x.id || x.name || x.model)) || (typeof x === 'string' ? x : '')).trim())
        .filter(Boolean);
    models.sort((a, b) => a.localeCompare(b));
    return models;
}

/**
 * 拉这个接口支持的模型清单（OpenAI 兼容的 `GET /models`）。
 *
 * 设计：拉取模型清单 ✓
 *   —— 起因是模型名那一格以前预填着 `gpt-4o-mini`，看着像配好了、其实对不上服务商 ✗
 *
 * ★ 加了**走酒馆后端**的那条路（`/status`）——
 *   跨域被拦的服务商（火山）现在也能拉到；策略跟聊天请求一样（自动档先直连、被拦了改走酒馆）✓
 *
 * ⚠️ 有的服务商 / 中转站不实现 `/models` ⇒ 返回的是"拉不到"，**不是"你填错了"**：
 *   错误文案里要写清"也可以自己手填"，别让人以为这条路必须走通 ✓
 * @returns {Promise<{ok:boolean, models:string[], error:string|null, via?:string}>}
 */
export async function listModels(cfgIn = null) {
    // ★ 多套接口：不传就拉**正在使用的那一套**的模型清单 ✓
    //   （编辑弹窗里拉的是**手里正在改的那套**，所以支持传进来 ✓）
    const cfg = cfgIn || currentApi() || {};
    if (!cfg.baseUrl) return { ok: false, models: [], error: '还没填接口地址' };

    const mode = apiModeOf(cfg);

    const headers = {};
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const extraH = parseJsonLoose(cfg.extraHeaders, 'extraHeaders');
    if (extraH && typeof extraH === 'object') Object.assign(headers, extraH);

    // 跟 chatCompletion 用同一个超时口径；不给它留一个能挂住的请求 ✓
    const ctrl = new AbortController();
    // ★ 这里也是**秒**（跟「超时（秒）」那一格同一个字段 ✓）
    const timeoutSec = Math.max(1, Number(cfg.timeoutSec) || 180);
    const timer = setTimeout(() => ctrl.abort(new Error('超时')), timeoutSec * 1000);

    /** 直连拉（老路：浏览器直发，能被跨域拦） */
    const tryDirect = async () => {
        try {
            const res = await fetch(joinUrl(cfg.baseUrl, '/models'), { method: 'GET', headers, signal: ctrl.signal });
            const rawText = await res.text();
            if (!res.ok) {
                let detail = rawText.slice(0, 300);
                const j = parseJsonLoose(rawText, 'error');
                if (j?.error?.message) detail = j.error.message;
                return { ok: false, models: [], error: `HTTP ${res.status}：${detail}` };
            }
            const models = pickModels(parseJsonLoose(rawText, 'models'));
            if (!models.length) {
                return { ok: false, models: [], error: '这个接口没返回模型清单（有的服务商不提供 /models，那就手填吧）' };
            }
            return { ok: true, models, error: null, via: 'direct' };
        } catch (e) {
            if (looksCrossOriginBlocked(e)) {
                return { ok: false, models: [], error: '被浏览器跨域拦下了（这个接口没给跨域头）', blocked: true };
            }
            const msg = (e?.name === 'AbortError') ? `请求被中断或超时（${timeoutSec} 秒）` : (e?.message || String(e));
            return { ok: false, models: [], error: msg };
        }
    };

    try {
        if (mode === 'backend') {
            const r = await modelsViaTavern(cfg, ctrl.signal);
            return r.ok ? r : { ...r, error: '酒馆后端：' + r.error };
        }

        const direct = await tryDirect();
        // ⚠️ 「只用直连」这一档**不许**偷偷改走酒馆后端（units 抓到过：漏了 mode 判断 ✗）
        if (direct.ok || !direct.blocked || mode === 'direct') {
            if (direct.blocked) return { ...direct, error: direct.error + '，模型名手填就行（去服务商控制台复制模型 ID）' };
            return direct;
        }

        // 自动档：被跨域拦了 ⇒ 改走酒馆后端拉 ✓
        const back = await modelsViaTavern(cfg, ctrl.signal);
        if (back.ok) return { ...back, fellBack: true };
        return {
            ok: false, models: [], via: 'backend',
            error: `直连：${direct.error}；酒馆后端：${back.error}`,
        };
    } finally {
        clearTimeout(timer);
    }
}
