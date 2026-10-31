/**
 * st.js —— 与 SillyTavern 本体的桥梁
 *
 * 设计原则：全部走「运行时探测 + 动态 import」，不写死静态 import。
 * 这样不同版本的酒馆（官方版 / 各种 fork）都不会因为某个内部路径改名而整个插件加载失败。
 */

export const ST = {
    ready: false,
    ext: null,          // extensions.js 模块
    script: null,       // script.js 模块
    errors: [],
};

/**
 * 动态加载酒馆内部模块（失败不致命）。
 *
 * 路径说明（实测 SillyTavern 1.13 系）：
 *   - 本站脚本在 /scripts/extensions/third-party/<扩展名>/src/
 *   - extensions.js 在 /scripts/extensions.js      → 相对要退 4 级
 *   - script.js     在 /script.js                  → 相对要退 5 级
 *   - 但不同 fork / 反代部署下根路径不一定一样，所以绝对路径和相对路径都试一遍
 *
 * 另外注意：setExtensionPrompt 其实是在 script.js 里，不在 extensions.js，
 * 所以能不用 import 就不用 —— 优先走 getContext()。
 */
/**
 * 单次 import 最多等多久。
 * ⚠️ 不设上限的话，任何一个宿主（云酒馆反代 / Luker / TT 等）在这里卡住，
 *   `boot()` 就永远停在 `await initST()` —— 后面的 initUI 一次都不跑 ⇒ **悬浮球不出现** ✗
 *   这两个模块拿不到也只是少几条退路（大部分功能走 getContext()），不值得为它卡死启动 ✓
 */
const IMPORT_TIMEOUT_MS = 4000;

async function tryImport(paths) {
    for (const p of paths) {
        try {
            const url = new URL(p, import.meta.url).href;
            let timer = null;
            const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), IMPORT_TIMEOUT_MS); });
            try { return await Promise.race([import(url), timeout]); }
            finally { clearTimeout(timer); }
        } catch { /* 试下一个 */ }
    }
    return null;
}

export async function initST() {
    if (ST.ready) return ST;
    // ★ 相对路径放**前面**：按本文件的位置去找，部署在子路径下（云酒馆反代成 /xxx/）也对得上
    //   宿主自己那份模块（同一个 URL ⇒ 同一个实例）✓
    //   绝对路径放最后兜底 —— 子路径部署时它指向的是**别的地址**，
    //   最坏会把酒馆的 script.js 再加载一份新实例（等于再跑一遍酒馆初始化）✗
    ST.ext = await tryImport([
        '../../../../extensions.js',
        '../../../extensions.js',
        '/scripts/extensions.js',
    ]);
    ST.script = await tryImport([
        '../../../../../script.js',
        '../../../../script.js',
        '/script.js',
    ]);
    if (!ST.ext) ST.errors.push('extensions.js 没加载到（大部分功能仍可通过 getContext() 工作）');
    if (!ST.script) ST.errors.push('script.js 没加载到（大部分功能仍可通过 getContext() 工作）');
    ST.ready = true;
    return ST;
}

/** 当前酒馆上下文（每次现取，因为切聊天会换） */
export function getCtx() {
    try { return window.SillyTavern?.getContext?.() ?? null; }
    catch { return null; }
}

/**
 * 这个扩展是不是被酒馆禁用了？
 *
 * ⚠️ 为什么这个判断这么重要：酒馆的扩展开关**不重载页面**
 *   （扩展管理器里点一下走的是 `disableExtension(name, false)`，只置 `requiresReload`）。
 *   于是"被禁用"之后，插件的 JS 其实还在内存里跑着 —— **事件回调照常触发**，
 *   包括那个「生成前重建注入」的 `GENERATION_STARTED` 处理器 ✗。
 *   光靠"定时清一次注入"根本没用：清完立刻又被重建回来。
 *   所以必须让**注入本身**知道"我不该干活了"。
 *
 * 放在 st.js 而不是 lifecycle.js：prompt.js 要用它，而 lifecycle.js 已经 import 了
 *   prompt.js —— 写那边会绕成循环依赖。
 */
export function isMyExtensionDisabled() {
    try {
        const c = getCtx();
        const s = c?.extensionSettings
            ?? ST.ext?.extension_settings
            ?? (hasWindow() && window.extension_settings)
            ?? null;
        const list = s?.disabledExtensions;
        if (!Array.isArray(list) || !list.length) return false;
        return list.some((n) => /bodycord/i.test(String(n)));
    } catch {
        return false;
    }
}

export function getEventSource() {
    const c = getCtx();
    return c?.eventSource ?? ST.script?.eventSource ?? null;
}

export function getEventTypes() {
    const c = getCtx();
    return c?.eventTypes ?? ST.script?.event_types ?? {};
}

/** 当前环境有没有 window（Node 里跑测试时为 false） */
export function hasWindow() {
    return typeof window !== 'undefined' && !!window;
}

/** 扩展设置对象（全局，跟着酒馆设置走） */
export function getExtensionSettings() {
    const c = getCtx();
    if (ST.ext?.extension_settings) return ST.ext.extension_settings;
    if (c?.extensionSettings) return c.extensionSettings;
    if (hasWindow() && window.extension_settings) return window.extension_settings;
    return null;
}

export function saveSettings() {
    try {
        if (ST.ext?.saveSettingsDebounced) return ST.ext.saveSettingsDebounced();
        if (getCtx()?.saveSettingsDebounced) return getCtx().saveSettingsDebounced();
    } catch { /* 忽略 */ }
}

/** 聊天级元数据（按聊天独立存储的地方） */
export function getChatMetadata() {
    const c = getCtx();
    return c?.chatMetadata ?? null;
}

/**
 * 有没有"还没落盘"的聊天数据 ＋ 落盘状态（诊断 / 界面用 ✓）
 *
 * ★★ 2026-10-21 的规矩（这版酒馆里 `saveMetadata` 就是"整份聊天重写"，见下面）：
 *   ① **只有真有改动才写**（脏标记驱动，没改动永远不碰文件）；
 *   ② **写之前先核三件事**，任一条不对就跳过、脏标记留着等下次：
 *      · 现在还是改动发生时那本聊天（防切聊天 / 还原 / 新建聊天时串档）
 *      · 内存里的消息条数不比改动时少（防"只有半份"时把文件写短）
 *      · 不是群聊（酒馆对群聊保存会直接报错）
 *   ③ **不在关页面那一刻写**（那正是内存最可能只有半份的时刻 ⇒ 见 installSaveFlushHooks）。
 *   用户那边还有一颗手动的「保存数据」（悬浮球菜单）当保底 ✓
 */
let _metaDirty = false;
let _saveTimer = null;
let _saveGuard = null;      // 改动发生时：{ chatId, len }
let _saveRetry = 0;
let _lastSavedAt = 0;
let _lastSaveOk = null;

/** 改动之后等多久自动写（毫秒） */
export const SAVE_DELAY = 800;

function saveCtx() { try { return getCtx(); } catch { return null; } }

/** 抓一份"现在能不能安全写"的快照：拿不到聊天编号 / 没有消息 / 群聊 ⇒ null */
function grabSaveGuard(c) {
    if (!c) return null;
    const id = String(c.chatId || '');
    const len = Array.isArray(c.chat) ? c.chat.length : 0;
    if (!id || len <= 0 || c.groupId) return null;
    return { chatId: id, len };
}

/**
 * 记一笔"数据变了，需要落盘"，并排一次延迟写入（只排一次，防抖）。
 * 这里**只记标记，不碰文件**；真正写不写由 `flushChatMetadataNow` 核对后再定 ✓
 */
export function saveChatMetadata() {
    _metaDirty = true;
    const g = grabSaveGuard(saveCtx());
    if (g) _saveGuard = g;
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        flushChatMetadataNow().catch(() => { /* 忽略 */ });
    }, SAVE_DELAY);
}

/** 落盘状态（给界面 / 诊断看） */
export function saveStatus() {
    return { dirty: _metaDirty, lastSavedAt: _lastSavedAt, ok: _lastSaveOk };
}

/**
 * ★ 真的写一次（**先核三件事**）。
 *
 * ⚠️ 为什么不能直接写：这版酒馆里 `getContext().saveMetadata` 的实现是
 *   `return await saveChatConditional()` ⇒ 它会把**内存里的整份聊天** POST 回
 *   `characters[this_chid].chat` 那个文件。内存对不上文件的时候（切聊天 / 还原 / 加载中）
 *   就会把一个聊天写成 1 条 ✗✗（2026-10-21 就是被这个覆盖过的）
 *   ⇒ 所以这里必须自己守：聊天编号一致 ＋ 条数不少 ＋ 不是群聊。
 *
 * @returns {Promise<boolean>} 真的写了没有
 */
export async function flushChatMetadataNow() {
    if (!_metaDirty) return false;
    const c = saveCtx();
    if (!c) return false;
    const g = _saveGuard;
    const id = String(c.chatId || '');
    const len = Array.isArray(c.chat) ? c.chat.length : 0;
    const bail = () => {
        // 现在不能写 —— 脏标记留着，过一会儿再试（最多 3 次，别无限空转）
        if (_saveRetry < 3) {
            _saveRetry++;
            if (!_saveTimer) {
                _saveTimer = setTimeout(() => {
                    _saveTimer = null;
                    flushChatMetadataNow().catch(() => { /* 忽略 */ });
                }, 4000);
            }
        }
        return false;
    };
    if (!g || id !== g.chatId) return bail();       // 已经不是那本聊天了
    if (len <= 0 || len < g.len) return bail();     // 内存里是半份
    if (c.groupId) return bail();                   // 群聊不归这条管
    const fn = c.saveMetadata;
    if (typeof fn !== 'function') return bail();
    try {
        await fn();
        _metaDirty = false;
        _saveRetry = 0;
        _saveGuard = { chatId: id, len };
        _lastSavedAt = Date.now();
        _lastSaveOk = true;
        return true;
    } catch (e) {
        _lastSaveOk = false;
        console.warn('[Bodycord] 保存失败，改动还留着，下次再试', e);
        return bail();
    }
}

/**
 * 收尾落盘的钩子 —— **仍然不挂**（2026-10-21）。
 *
 * 切标签 / 关页面那一刻正是"内存可能只有半份"的时候，而酒馆的保存入口是整份重写
 * ⇒ 在这种时机补写风险最大 ✗（要补的话玩家用悬浮球菜单里那颗「保存数据」✓）
 * 留着函数只为让 `index.js` 的调用点不用改（它拿返回值决定要不要 warn）。
 */
export function installSaveFlushHooks() {
    if (!hasWindow()) return false;
    return true;
}

/** 当前聊天/角色的唯一标识 */
export function getChatKey() {
    const c = getCtx();
    if (!c) return 'global';
    if (c.chatId) return 'chat_' + c.chatId;
    if (c.chatMetadata?.chat_id) return 'chat_' + c.chatMetadata.chat_id;
    if (c.charId !== undefined && c.charId !== null) return 'char_' + c.charId;
    if (c.name2) return 'char_' + c.name2;
    return 'global';
}

export function getPersonaName() {
    const c = getCtx();
    return c?.name1 || '{{user}}';
}

export function getCharacterName() {
    const c = getCtx();
    return c?.name2 || '{{char}}';
}

/** 跑宏替换（{{user}} / {{char}} / {{time}} 等） */
export function substitute(text) {
    if (!text) return '';
    try {
        const c = getCtx();
        const fn = ST.script?.substituteParams || c?.substituteParams;
        if (typeof fn === 'function') return fn(text);
    } catch { /* 忽略 */ }
    // 兜底：至少把 user/char 换掉
    try {
        return String(text)
            .replace(/\{\{user\}\}/gi, getPersonaName())
            .replace(/\{\{char\}\}/gi, getCharacterName());
    } catch { return text; }
}

/** 取聊天消息数组 */
export function getChat() {
    const c = getCtx();
    return Array.isArray(c?.chat) ? c.chat : [];
}

/**
 * 把聊天存盘。
 * 楼层小面板的「排除」标记写在消息对象上，需要存一次才会跟着聊天走。
 * 存不了也不算致命 —— 只是这次的标记不持久。
 */
export function saveChat() {
    // ⚠️⚠️ 这个函数**故意不做任何事**，请别把它改回去。⚠️⚠️
    //
    // 它曾经调用 getContext().saveChat()，而那其实是 ST 的 saveChatConditional ——
    // 会把**内存里的整个 chat + chat_metadata** 重写回聊天文件。
    // 实测代价：一整份聊天就是这样被覆盖成「1 条消息 + 一份全新的 chat_metadata」的 ✗
    //
    // 插件没有任何理由去改聊天文件。楼层排除标记现在存在插件自己的 state 里。
    console.warn('[Bodycord] saveChat() 被调用，但已禁用以保护你的聊天记录');
    return false;
}

/**
 * 往主 API 注入一段提示词。
 *
 * ⚠️ 关键的坑：setExtensionPrompt 定义在 script.js，不在 extensions.js。
 * 但它挂在 getContext() 上（st-context.js 有导出），所以这里第一优先走 getContext()。
 * value 为空字符串 = 清除该 key（等于完全不注入，不占 token）。
 */
export const PROMPT_POS = { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const PROMPT_ROLE = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };

export function setPrompt(key, value, position = PROMPT_POS.IN_PROMPT, depth = 4, role = PROMPT_ROLE.SYSTEM, filter = null) {
    const text = value == null ? '' : String(value);
    const c = getCtx();

    // ① 官方上下文（最稳）
    try {
        const fn = c?.setExtensionPrompt;
        if (typeof fn === 'function') {
            fn(key, text, position, depth, false, role, filter);
            return true;
        }
    } catch (e) { ST.errors.push('setExtensionPrompt(ctx) 失败：' + e.message); }

    // ② script.js 里的原函数
    try {
        const fn = ST.script?.setExtensionPrompt;
        if (typeof fn === 'function') {
            fn(key, text, position, depth, false, role, filter);
            return true;
        }
    } catch (e) { ST.errors.push('setExtensionPrompt(script) 失败：' + e.message); }

    // ③ ❌ 这里原本还有一条「用 `/inject` 斜杠命令」的退路 —— 已删除，别加回来。
    //
    //   酒馆核心的 `/inject`（public/scripts/slash-commands.js）会做这件事：
    //       chat_metadata.script_injects[id] = { value, position, depth, scan, role, filter };
    //       saveMetadataDebounced();        // ← 把注入**写进聊天文件**
    //   于是那条注入被**永久持久化**：禁用插件还在、挪走插件文件夹还在、
    //   关掉任何扩展也还在（酒馆加载聊天时会自己恢复）。症状就是
    //   插件关了提示词还在插入。
    //   ⇒ 宁可这次不注入（下面 return false 让调用方知道），也绝不污染聊天文件。
    ST.errors.push('setPrompt 失败：拿不到 setExtensionPrompt（不用 /inject 退路，避免污染聊天文件）');
    return false;
}

/** 注入通道是否可用（用来在设置页给用户一个明确提示） */
/**
 * 现在到底能不能注入？
 *
 * ⚠️ 只认 `setExtensionPrompt` 这一条路。
 *   以前这里还认「有 executeSlashCommandsWithOptions（能发 /inject 斜杠命令）」，
 *   但酒馆的 `/inject` 会把注入**落盘进聊天文件** —— 宁可注入不了，也不污染聊天文件。
 *   （详见 `src/compat.js` 顶部的说明。）
 */
export function canInject() {
    try {
        if (typeof getCtx()?.setExtensionPrompt === 'function') return true;
        if (typeof ST.script?.setExtensionPrompt === 'function') return true;
    } catch { /* 忽略 */ }
    return false;
}

/**
 * 读插件自己的 HTML 文件（settings.html 之类）。
 *
 * ⚠️ 以前这里调 ST 的 renderExtensionTemplateAsync 时**参数传错了**：
 *   它的签名是 `(扩展名, 模板名)`，比如 `renderExtensionTemplateAsync('third-party/Foo', 'settings')`
 *   → 拼出 `scripts/extensions/third-party/Foo/settings.html`。
 *   把整个路径当成「扩展名」传进去，ST 拼出来的是
 *   `.../SillyTavern-Bodycord/settings.html/undefined.html` —— 必然 404，
 *   于是 ST 内部先弹了一个红色的「Error rendering template」。
 *   而兜底又成功了，所以看着"没影响"，其实每次重载都在报错。
 *
 * 我们的模板里没有任何 Handlebars 宏，干脆自己 fetch —— 最稳，也不惊动 ST 的模板系统。
 */
// ⚠️ 这个模块住在 src/ 里，而 settings.html / style.css / assets 都在**扩展根目录**。
//   以前写 `new URL('./settings.html', import.meta.url)`，解析出来是
//   `…/SillyTavern-Bodycord/src/settings.html` —— 404，而且 ST 还会弹
//   「Error rendering template」。所有根目录资源都必须用 EXT_ROOT 拼。
export const EXT_ROOT = new URL('../', import.meta.url);

export async function renderTemplate(file, data = {}) {
    const leaf = String(file).split('/').pop() || 'settings.html';

    // 首选：直接取扩展根目录下的文件
    try {
        const url = new URL(leaf, EXT_ROOT);
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) return await res.text();
        console.warn(`[Bodycord] 读不到 ${leaf}：HTTP ${res.status}`);
    } catch (e) {
        console.warn(`[Bodycord] 读 ${leaf} 出错`, e);
    }

    // 兜底：走 ST 的模板接口，这次参数是对的
    try {
        const fn = getCtx()?.renderExtensionTemplateAsync || ST.ext?.renderExtensionTemplateAsync;
        if (typeof fn === 'function') {
            // 扩展目录名 = 根目录路径的最后一段（原来取的是 src/，所以变成了 "src"）
            const dir = EXT_ROOT.pathname.split('/').filter(Boolean).pop();
            if (dir) return await fn(`third-party/${dir}`, leaf.replace(/\.html$/, ''), data);
        }
    } catch { /* 忽略 */ }

    return '';
}

// 死代码清理：这里的 `isGenerating()` 全仓（含测试）无引用 ⇒ 删掉 ✓
//   （"这次生成有没有产出消息"由 index.js 的 MESSAGE_RECEIVED / GENERATION_STOPPED 标志判，
//     不再去问酒馆"是不是在生成" ✓）

/** 提示条 */
export function toast(msg, type = 'info') {
    try {
        if (window.toastr) {
            const fn = window.toastr[type] || window.toastr.info;
            fn.call(window.toastr, msg);
            return;
        }
    } catch { /* 忽略 */ }
    console.log('[Bodycord]', type, msg);
}

// ---------------------------------------------------------------------------
// 用户人设头像
//
// 面板自带的抓取逻辑在没有「用户历史消息」时会退化成「persona 列表里的第一个」，
// 于是抓到别人的头像。这里我们自己按可靠性从高到低找，找到了就直接喂给面板，
// 面板拿到 bc_custom_avatar 之后就不会再去扫描了。
// ---------------------------------------------------------------------------

function docsForScan() {
    const out = [document];
    if (!hasWindow()) return out;
    try { if (window.parent && window.parent !== window && window.parent.document) out.push(window.parent.document); } catch { /* 跨域就跳过 */ }
    try { if (window.top && window.top !== window && window.top.document) out.push(window.top.document); } catch { /* 忽略 */ }
    return out;
}

function personaUrlFromId(id) {
    if (!id || typeof id !== 'string' || id.length < 3) return null;
    return '/thumbnail?type=persona&file=' + encodeURIComponent(id);
}

/**
 * 当前聊天里"应该用哪个人设"——只认两条硬信息：
 *   ① 这个聊天明确锁定的人设（ST 的 chat_metadata.persona）
 *   ② 当前角色 / 群组**连接**的人设（ST 的 persona_descriptions[].connections）
 * ⚠️ 绝不先返回 default_persona —— 那是"新聊天默认用谁"，不是"这个聊天现在用谁"。
 *   重置之后变回默认用户角色头像就是这一条：
 *   那个聊天里连的是另一个人设，而旧代码先返回 default_persona ✗
 */
function personaIdForChat(c) {
    // ① 聊天锁定
    const lock = c?.chatMetadata?.persona;
    if (typeof lock === 'string' && lock) return lock;

    // ② 角色 / 群组连接
    const personas = c?.powerUserSettings?.personas || c?.power_user?.personas;
    const descs = c?.powerUserSettings?.persona_descriptions || c?.power_user?.persona_descriptions;
    if (!personas || !descs) return null;
    const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const charAvatar = c?.characters?.[c?.characterId]?.avatar || null;
    const groupId = (c?.groupId !== undefined && c?.groupId !== null && String(c.groupId) !== '')
        ? String(c.groupId) : null;
    if (!charAvatar && !groupId) return null;

    const hits = [];
    for (const [id, d] of Object.entries(descs)) {
        if (!has(personas, id)) continue;
        const conns = Array.isArray(d?.connections) ? d.connections : [];
        for (const x of conns) {
            if (!x) continue;
            if (charAvatar && x.type === 'character' && x.id === charAvatar) { hits.push(id); break; }
            if (groupId && x.type === 'group' && String(x.id) === groupId) { hits.push(id); break; }
        }
    }
    // 同一个人设连了多个角色 ⇒ 上面会重复；去重
    const uniq = [...new Set(hits)];
    // 连了不止一个（ST 会弹窗让人选）⇒ 不猜，交给后面的"当前已选 / 最近一条消息" ✓
    return uniq.length === 1 ? uniq[0] : null;
}

/** 名字 → 头像文件名；**只有唯一命中时**才算数（玩家有 20 多个人设重名 ✗） */
function uniquePersonaIdForName(c, name1) {
    const ids = personaIdsForName(c, name1);
    return ids.length === 1 ? ids[0] : null;
}

/** 酒馆的默认人设（非聊天页 / 聊天里没有更具体的信息时用它） */
function defaultPersonaId(c) {
    const dp = c?.powerUserSettings?.default_persona || c?.power_user?.default_persona;
    const obj = c?.powerUserSettings?.personas || c?.power_user?.personas;
    if (typeof dp === 'string' && dp && (!obj || Object.prototype.hasOwnProperty.call(obj, dp))) return dp;
    return null;
}

/**
 * 从酒馆的 persona 表里找「某个名字对应的头像文件名」（诊断 / 兜底用）。
 *
 * ⚠️ 这里踩过一个坑：按 `personas[名字]` 取是错的，因为
 * **SillyTavern 的 power_user.personas 实际是 `{ 头像文件名: 人设名 }`** ——
 * 键是文件名、值是名字，方向正好相反。
 *
 * 优先级（2026-10-18 修正）：聊天锁定 / 角色连接 → **唯一**同名 → 默认人设。
 * 旧代码把 default_persona 放第一位 ⇒ 每个聊天都拿到"默认头像"✗
 */
function lookupPersonaAvatarId(c, name1) {
    const forChat = (c && c.chatId) ? personaIdForChat(c) : null;
    if (forChat) return forChat;
    const byName = (c && c.chatId) ? uniquePersonaIdForName(c, name1) : null;
    if (byName) return byName;
    return defaultPersonaId(c);
}



/**
 * 当前聊天该用的那份「用户角色设定」（人设描述）—— 2026-10-23 新增。
 *
 * 为什么要它：推演以前只看得到世界书和**角色卡**描述，玩家自己写的人设进不去，
 *   于是遗传检查里"受孕方"那一半永远是「无」。
 * 取法跟头像同一套优先级（聊天锁定 → 角色连接 → 唯一同名 → 默认人设），
 * 保证"看到的那份"和"头像用的那份"是同一个人设 ✓
 * ⚠️ 酒馆两版字段都认：`persona_descriptions[id]` 新版是对象（取 .description）、
 *   老版可能直接是字符串；都没有就退回 `persona_description`（默认人设那份）✓
 */
export function personaDescriptionForChat() {
    try {
        const c = getCtx() || {};
        const descs = c.powerUserSettings?.persona_descriptions || c.power_user?.persona_descriptions || null;
        const pick = (v) => {
            if (!v) return '';
            if (typeof v === 'string') return String(v).trim();
            if (typeof v === 'object') return String(v.description || '').trim();
            return '';
        };
        const id = lookupPersonaAvatarId(c, c.name1);
        let d = (id && descs) ? pick(descs[id]) : '';
        if (!d) d = pick(c.powerUserSettings?.persona_description || c.power_user?.persona_description);
        return d;
    } catch { return ''; }
}


/** 名字 → 命中的头像文件名列表（用来诊断「重名」这种事） */
export function personaIdsForName(c, name1) {
    const obj = (c?.powerUserSettings?.personas || c?.power_user?.personas) || null;
    if (!obj || !name1) return [];
    const out = [];
    for (const [id, nm] of Object.entries(obj)) {
        if (nm === name1) out.push(id);
        else if (nm && typeof nm === 'object' && (nm.name === name1 || nm.persona === name1)) out.push(id);
    }
    return out;
}

/** 尽力找到「当前正在使用」的用户人设头像 URL */
/**
 * 头像抓取诊断 —— 把四条来源分支各自抓到了什么，一条条摊开。
 *
 * 为什么要这个：报障"抓的头像不是当前 persona，甚至像是列表中间那个"，
 * 但 resolvePersonaAvatar() 是短路返回的，看不出**是哪一条分支命中**的。
 * 灯下黑 —— 只有把每一分支的结果都摆出来，才知道该修哪一条。
 */
export function describePersonaAvatar() {
    const out = {
        '酒馆给的当前人设 name1': null,
        'persona 映射表存在': false,
        'persona 映射表条目数': 0,
        'persona 映射表里 name1 对应的值': null,
        '一 · persona 映射 → URL': null,
        '二 · persona 管理面板里 selected 的 id': null,
        '二 · → URL': null,
        '三 · 用户消息里的头像': null,
        '四 · 兜底：列表里第一个非 default 的 id': null,
        '四 · → URL': null,
        '最终采用': null,
        '面板 localStorage 里现有的': null,
    };

    let c = null;
    try { c = getCtx(); } catch { /* 忽略 */ }
    out['酒馆给的当前人设 name1'] = c?.name1 || '(空)';

    // ① persona 名字 → 头像文件名的映射表
    try {
        const personas = c?.powerUserSettings?.personas || c?.power_user?.personas;
        if (personas && typeof personas === 'object') {
            out['persona 映射表存在'] = true;
            const keys = Object.keys(personas);
            out['persona 映射表条目数'] = keys.length;
            const v = personas[c?.name1];
            out['persona 映射表里 name1 对应的值'] = v == null
                ? '(表里没有这个名字)'
                : (typeof v === 'string' ? v : JSON.stringify(v));
            // 把前几对键值摊出来 —— 一眼看出键是名字还是文件名（方向错了就是这里暴露的）
            out['persona 映射表前 3 对（键=值）'] = keys.slice(0, 3)
                .map((k) => k + ' = ' + (typeof personas[k] === 'string' ? personas[k] : JSON.stringify(personas[k])))
                .join(' ／ ');
            out['default_persona'] = c?.powerUserSettings?.default_persona || c?.power_user?.default_persona || '(无)';
            const ids = personaIdsForName(c, c?.name1);
            out['同名命中的头像个数'] = ids.length + (ids.length > 1 ? '  ← 重名！按名字查没有唯一答案' : '');
            out['同名命中的头像'] = ids.length ? ids.join(' ／ ') : '(无)';
            out['当前人设解析结果（聊天锁定 / 角色连接 / 唯一同名 / 默认）'] = lookupPersonaAvatarId(c, c?.name1) || '(没找到)';
            const id = (typeof v === 'string') ? v : (v?.avatar || v?.avatarId);
            out['一 · persona 映射 → URL'] = personaUrlFromId(id) || '(id 不合法)';
        } else {
            out['persona 映射表存在'] = false;
        }
    } catch (e) {
        out['一 · persona 映射 → URL'] = '出错：' + (e?.message || e);
    }

    for (const doc of docsForScan()) {
        if (!doc) continue;

        // ② persona 管理面板里被选中的那一个
        try {
            const sel = doc.querySelectorAll('#user_avatar_block .avatar.selected');
            out['二 · persona 管理面板里 selected 的 id'] = sel.length
                ? (sel[0].getAttribute?.('data-avatar-id') || '(没有 data-avatar-id)')
                : '(没有 selected 的元素)';
            if (sel.length && !out['二 · → URL']) {
                const id = sel[0].getAttribute?.('data-avatar-id')
                    || sel[0].querySelector?.('[data-avatar-id]')?.getAttribute('data-avatar-id');
                out['二 · → URL'] = personaUrlFromId(id) || '(退回 img.src)';
            }
        } catch (e) { out['二 · persona 管理面板里 selected 的 id'] = '出错：' + (e?.message || e); }

        // ③ 用户消息里的头像
        try {
            const img = doc.querySelector('.mes[is_user="true"] .avatar img, .mes[is_user="true"] .mesAvatarWrapper img');
            out['三 · 用户消息里的头像'] = img?.src ? img.src.slice(-60) : '(没有用户消息 / 没有头像元素)';
        } catch (e) { out['三 · 用户消息里的头像'] = '出错：' + (e?.message || e); }

        // ④ 兜底
        try {
            let first = null;
            for (const el of doc.querySelectorAll('#user_avatar_block [data-avatar-id]')) {
                const id = el.getAttribute('data-avatar-id');
                if (id && !/default/i.test(id)) { first = id; break; }
            }
            out['四 · 兜底：列表里第一个非 default 的 id'] = first || '(一个都没有)';
            out['四 · → URL'] = first ? (personaUrlFromId(first) || '(id 不合法)') : '(无)';
        } catch (e) { out['四 · 兜底：列表里第一个非 default 的 id'] = '出错：' + (e?.message || e); }
    }

    try { out['最终采用'] = resolvePersonaAvatar() || '(null)'; } catch (e) { out['最终采用'] = '出错：' + (e?.message || e); }
    try {
        // 面板那份 localStorage 的键带作用域前缀（非聊天是 nochat），这里按同一个口径读 ✓
        const scope = (c && c.chatId) ? String(c.chatId) : 'nochat';
        const ls = window.localStorage;
        out['面板 localStorage 里现有的（自定义）'] = ls.getItem(`bc_chat__${scope}__bc_custom_avatar`) || '(空)';
        out['面板 localStorage 里现有的（自动）'] = ls.getItem(`bc_chat__${scope}__bc_auto_avatar`) || '(空)';
    } catch { /* 忽略 */ }

    return out;
}

export function resolvePersonaAvatar() {
    let c = null;
    try { c = getCtx(); } catch { /* 忽略 */ }
    // 「在不在聊天里」只认真实的 chatId（和 bodycord.js 的 avatarScopeId 同一个判据）
    const inChat = !!(c && c.chatId);

    // ① 聊天锁定 / 当前角色连接的人设 —— 这才是"这个聊天现在用的头像"
    if (inChat) {
        try {
            const url = personaUrlFromId(personaIdForChat(c));
            if (url) return url;
        } catch { /* 继续 */ }
    }

    for (const doc of docsForScan()) {
        if (!doc) continue;

        if (inChat) {
            // ② 酒馆人设面板里**当前选中的**那个（临时切换、同名不同图都能认出来 ✓）
            try {
                const sel = doc.querySelector('#user_avatar_block .avatar.selected');
                if (sel) {
                    const id = sel.getAttribute?.('data-avatar-id')
                        || sel.querySelector?.('[data-avatar-id]')?.getAttribute('data-avatar-id');
                    const url = personaUrlFromId(id);
                    if (url) return url;
                    const img = sel.querySelector?.('img');
                    if (img?.src && img.src.length > 40) return img.src;
                }
            } catch { /* 忽略 */ }

            // ③ 用户消息里的头像 —— 取**最后一条**（最近的才最接近当前用的人设）。
            try {
                const imgs = doc.querySelectorAll('.mes[is_user="true"] .avatar img, .mes[is_user="true"] .mesAvatarWrapper img');
                const img = imgs.length ? imgs[imgs.length - 1] : null;
                if (img?.src && img.src.length > 40) return img.src;
            } catch { /* 忽略 */ }
        }
    }

    if (inChat && c) {
        // ④ 名字**唯一**命中时才按名字查（玩家有 20 多个人设叫同一个名字 ⇒ 重名不猜）
        try {
            const url = personaUrlFromId(uniquePersonaIdForName(c, c?.name1));
            if (url) return url;
        } catch { /* 继续 */ }
    }

    // ⑤ 默认人设 —— 非聊天页就是它；聊天里没有更具体的信息时也用它 ✓
    if (c) {
        try {
            const url = personaUrlFromId(defaultPersonaId(c));
            if (url) return url;
        } catch { /* 继续 */ }
    }

    // ⑥ 非聊天页的最后一档：人设面板里选中的那个（拿不到默认人设时）
    for (const doc of docsForScan()) {
        try {
            const sel = doc.querySelector('#user_avatar_block .avatar.selected');
            if (!sel) continue;
            const id = sel.getAttribute?.('data-avatar-id')
                || sel.querySelector?.('[data-avatar-id]')?.getAttribute('data-avatar-id');
            const url = personaUrlFromId(id);
            if (url) return url;
        } catch { /* 忽略 */ }
    }

    // 宁可抓不到（面板用自带图标），也**绝不能给错的** ✓
    return null;
}
