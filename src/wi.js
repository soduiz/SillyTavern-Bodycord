/**
 * wi.js —— 「给推演看的世界书」
 *
 * 这一份需求清单管着这个文件所有取舍：
 *   · 插件 API 也要读世界书 —— 让它更准地判定角色情况 ✓
 *   · 要有**排除**世界书的选项：纯科普之类的会污染判定、还白吃 TOKEN ✓
 *   · 读法**跟主 API 一致**：主 API 怎么读（常驻 / 关键词），插件 API 就怎么读 ✓
 *   · 聊天内只认**当前角色卡的世界书 + 全局世界书** ✓
 *   · 条目可以单独开关，默认跟随酒馆；**一旦改过就锁死**、不再跟随酒馆 ✓
 *   · 推演必须带世界书（没生成过快照时也不许干脆不带）✓
 *   · **一个字都不截**（世界书条目动辄很大，不要设字数上限 ✓）
 *   · 书名数量不封顶（不止一百多本）⇒ 一切**按需**、不预读 ✗
 *
 * 怎么实现的（两条路）：
 *   ① **正常路**：酒馆自己扫世界书时会发两个事件 ——
 *      `worldinfo_entries_loaded`（扫之前，给"四类来源"的全部条目）＋
 *      `world_info_activated`（扫之后，只给**这一轮真的进了提示词**的那批）
 *      ⇒ 这里只留 **全局书 + 当前角色卡的书** 这两类（聊天书 / 人设书丢掉 ✗），
 *        正常路直接用"这一轮注入的那批" ⇒ 和主 API 看到的是同一份设定 ✓
 *   ② **兜底路**（没快照：手动点推演、刚开聊天还没生成过）：
 *      现场调一次 `getWorldInfoPrompt(..., isDryRun=true)` 触发扫描
 *      ⇒ 拿"这两类书里**开启的条目**"顶上（最早定下的就是只读当前世界书开启的条目 ✓）
 *      ⚠️ dry run 是只读的：不改聊天数据（ST 源码里 `isDryRun` 会跳过 timedWorldInfo 写入 ✓）
 *
 * ⚠️ 这里所有数据**只活在内存里**，不落盘、不写世界书文件 ✓
 */

import { getCtx, getChat, getChatKey, getEventSource, getEventTypes, personaDescriptionForChat } from './st.js';
import { wiOn, wiCharOn, wiGlobalOn, wiBookAllowed, wiEntryAllowed, wiDescOn, wiPersonaOn, wiFollows } from './settings.js';
// ★ 「不参与推演」的楼层要被排除（标记在 state().excluded 里，见 store.js 的 isExcluded ✓）
import { isExcluded } from './store.js';
// ★ 「提示词模板的代码」渲染（选「乙」）—— 详见 pt-ejs.js 顶部那段说明
import { hasEjs, ptRenderReady, renderEjsText } from './pt-ejs.js';

let _installed = false;

/** 最近一次扫描的快照（每次生成时刷新） */
const _snap = {
    chatKey: null,      // 这份快照属于哪个聊天（换聊天就作废 ✓）
    at: 0,
    globalBooks: [],    // 全局世界书的书名
    charBooks: [],      // 当前角色卡在用的世界书的书名
    entries: [],        // 这两类的**全部**条目（含被关掉的）—— 兜底路用 ✓
    activated: [],      // 这一轮真的注入提示词的那批 —— 正常路用 ✓
    scanned: false,     // 这个聊天里扫过至少一次吗（激活 0 条也算扫过 ✓）
};

/** 最近一次"打包给推演"的结果（界面 / 诊断报告读它 ✓）
 *  ⚠️ `rendered` / `skipped` 是「提示词模板的代码」那一套的读数：
 *     rendered = 这一轮有几条是**渲染成正文之后**才发出去的；
 *     skipped  = 有几条含模板代码、但**没能渲染**（这一条一个字都没发 ✓） */
let _last = { at: 0, count: 0, chars: 0, mode: '', books: 0, desc: 0, persona: 0, reason: '', rendered: 0, skipped: 0 };

function key() {
    try { return getChatKey(); } catch { return 'global'; }
}

function uniq(arr) {
    return [...new Set(arr)];
}

/** 当前聊天 - 当前角色卡绑的那本（事件还没来时，界面上"置顶"用它 ✓） */
export function currentCharBook() {
    try {
        const c = getCtx() || {};
        const list = Array.isArray(c.characters) ? c.characters : [];
        const id = c.characterId;
        const ch = (id !== undefined && id !== null && list[id]) ? list[id] : null;
        const w = ch?.data?.extensions?.world;
        return typeof w === 'string' ? w : '';
    } catch { return ''; }
}

/** 当前角色卡的角色描述（每次都现取 ⇒ 永远是最新的 ✓） */
export function characterDescription() {
    try {
        const c = getCtx() || {};
        const list = Array.isArray(c.characters) ? c.characters : [];
        const id = c.characterId;
        const ch = (id !== undefined && id !== null && list[id]) ? list[id]
            : (list.find(x => x && x.name === c.name2) || null);
        if (!ch) return '';
        let d = String(ch.description || '').trim();
        if (!d) return '';
        // `{{char}}` 换成角色名；`{{user}}` **保持原样**（推演契约里玩家本人就是写 {{user}} ✓）
        const nm = String(ch.name || c.name2 || '');
        if (nm) d = d.replace(/\{\{\s*char\s*\}\}/gi, nm);
        return d;
    } catch { return ''; }
}

/**
 * 挂上世界书的两个事件（和 intercept.js 同一个套路）。
 * @returns {{ok:boolean, error?:string}}
 */
export function installWorldInfoHooks() {
    if (_installed) return { ok: true };
    try {
        const es = getEventSource();
        if (!es || typeof es.on !== 'function') return { ok: false, error: '拿不到 eventSource' };
        const ET = getEventTypes() || {};

        // ① 扫描之前：拿到"四类来源"的全部条目 ⇒ 这里只留这两类 ✓
        es.on(ET.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded', (data) => {
            try {
                const g = Array.isArray(data?.globalLore) ? data.globalLore : [];
                const c = Array.isArray(data?.characterLore) ? data.characterLore : [];
                _snap.globalBooks = uniq(g.map(e => String(e?.world || '')).filter(Boolean));
                _snap.charBooks = uniq(c.map(e => String(e?.world || '')).filter(Boolean));
                // ⚠️ 只要这两类：聊天书（chatLore）/ 人设书（personaLore）一律不要 ✗
                _snap.entries = [...g, ...c];
                _snap.chatKey = key();
                _snap.at = Date.now();
                _snap.activated = [];       // 新一轮 ⇒ 上一轮的激活记录作废
                _snap.scanned = true;       // 扫过就算有快照（哪怕一条都没激活 ✓）
            } catch (e) { console.warn('[Bodycord] 读世界书条目失败', e); }
        });

        // ② 扫描之后：这一轮真的进了提示词的那批（⭐ 酒馆只在"有条目被激活"时才发它 ⇒
        //    所以"没收到"不等于"没扫过"，上面那个 scanned 才是判据 ✓）
        es.on(ET.WORLD_INFO_ACTIVATED || 'world_info_activated', (entries) => {
            try {
                if (!Array.isArray(entries)) return;
                _snap.activated = entries;
                _snap.chatKey = key();
                _snap.at = Date.now();
                _snap.scanned = true;
            } catch (e) { console.warn('[Bodycord] 读世界书激活记录失败', e); }
        });

        _installed = true;
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}


/**
 * 兜底：现场只读扫一遍（干的就是酒馆给正文扫世界书那件事，只是不落任何副作用 ✓）
 * @returns {Promise<boolean>} 拿到条目了吗
 */
async function scanNow() {
    const c = getCtx() || {};
    const fn = c.getWorldInfoPrompt;
    if (typeof fn !== 'function') {
        console.warn('[Bodycord] 这版酒馆没给 getWorldInfoPrompt，世界书兜底扫描跑不了');
        return false;
    }
    try {
        // ⚠️ 「不参与推演」的标记早就从 `m.extra.bodycordExcluded` 搬到了 `state().excluded`
        //   ⇒ 老写法恒不成立，被排除的楼层照样喂给世界书兜底扫描
        //   用 filter 的第二个参数拿到**原数组下标**，跟 judge 那边同一个判据 ✓
        const chat = getChat()
            .filter((m, i) => m && typeof m.mes === 'string' && !isExcluded(i))
            .map(m => `${m.is_user ? (c.name1 || '用户') : (m.name || c.name2 || '角色')}: ${m.mes}`)
            .reverse();
        const scanData = {
            personaDescription: String(c.powerUserSettings?.persona_description || ''),
            characterDescription: characterDescription(),
            characterPersonality: '',
            characterDepthPrompt: '',
            scenario: '',
            creatorNotes: '',
            trigger: 'normal',
        };
        await fn(chat, Number(c.maxContext) || 8192, true, scanData);
        return _snap.entries.length > 0;
    } catch (e) {
        console.warn('[Bodycord] 世界书兜底扫描失败', e);
        return false;
    }
}

/**
 * 世界书 / 角色描述里那几种"叫名字"的占位写法，统一处理一下（
 * 「可以，做一下简单替换」✓）。**不碰作品原文里的其它宏**（`{{getvar}}` 之类留给酒馆）✓
 *   · `<user>`（大小写）⇒ `{{user}}`：推演契约里玩家本人就是这个写法，一眼对得上 ✓
 *   · `{{char}}` / `<char>` ⇒ 当前聊天角色卡的角色名（跟主 API 那边一样 ✓）
 *   ⚠️ 拿不到角色名时**保持原样**（宁可留着，也别替换成空 ✗）
 */
function substituteMacros(text) {
    let s = String(text || '');
    if (!s) return s;
    s = s.replace(/<\s*user\s*>/gi, '{{user}}');
    let nm = '';
    try { nm = String(getCtx()?.name2 || '').trim(); } catch { nm = ''; }
    if (nm) s = s.replace(/(\{\{\s*char\s*\}\}|<\s*char\s*>)/gi, nm);
    return s;
}

/** 这一轮该给推演看哪些条目（已经过"来源 + 排除表"的筛 ✓）
 *  @param {boolean} force 临时把来源都当"开"（遗传判定那一轮用；玩家自己的排除照样生效） */
function pickEntries(force = false, charOnly = false, sources = null) {
    // ★★ 2026-10-17 修（最近一轮带了 0 条 / 0 字）——
    //   **干跑只发 `WORLD_INFO_ENTRIES_LOADED`、不发 `WORLD_INFO_ACTIVATED`**
    //   （酒馆里那条 emit 带 `!isDryRun` 闸）⇒ 干跑之后 `scanned` 是 true、`activated` 却是空的
    //   ⇒ 以前这里只看 `scanned` ⇒ 拿空数组去筛 ⇒ **一条都不发** ✗（玩家开了全局书也一样）
    //   ⇒ 判据改成"有激活结果才用激活结果，没有就用这两类书里开着的条目" ✓
    //   （也正好覆盖"酒馆因预算这一轮一条都没注进去"的情况 ✓）
    const useActivated = _snap.scanned && _snap.activated.length > 0;
    const use = useActivated
        ? _snap.activated                                   // 正常路：跟酒馆注入的那批一样 ✓
        : _snap.entries.filter(e => e && e.disable !== true); // 兜底路：这两类书里"开启的条目" ✓
    // ⚠️ 只认这两类来源（聊天内只认当前角色卡的世界书 + 全局世界书）——
    //   `activated` 那份是**四类来源**混在一起的，所以必须按书名再筛一道 ✓
    //   （聊天书 / 人设书一律丢掉 ✗）
    // ★★ 2026-10-17：
    //   角色卡那几本看「角色卡世界书」那颗，全局那几本看「全局世界书」那颗；
    //   **同一本两边都挂 ⇒ 按角色卡算**（那本是被这张卡明确绑定的 ✓）
    const charSet = new Set(_snap.charBooks);
    const globalSet = new Set(_snap.globalBooks);
        const mine = new Set([..._snap.charBooks, ..._snap.globalBooks]);
        const sourceOn = (book) => {
            // ★ 2026-10-24：遗传判定那轮按**编辑好的四类来源**精确发（true 带 / false 不带）✓
            if (sources) {
                if (charSet.has(book)) return sources.charBook === true;
                if (globalSet.has(book)) return sources.globalBook === true;
                return false;
            }
            if (force) return true;
            if (charSet.has(book)) return wiCharOn();
            if (globalSet.has(book)) return wiGlobalOn();
            return false;
        };
        return use.filter((e) => {
            if (!e) return false;
            const book = String(e.world || '');
            if (!book || !mine.has(book)) return false;
            // ★ 2026-10-24：当场重判只带**角色卡那几本**，全局书不要 ✓
            if (charOnly && !charSet.has(book)) return false;
            if (!sourceOn(book)) return false;                   // 这一类来源关着 ✓
            if (!wiBookAllowed(book)) return false;             // 整本排除
            if (!wiEntryAllowed(book, e.uid)) return false;      // 单条排除
            return !!String(e.content || '').trim();
        });
}

/**
 * ★ 当前聊天真正会用的世界书（角色卡那几本在前、全局在后，去重）——
 *   世界书清单**只列这些**（库里那 100 多本大部分永远用不到 ✗）
 */
export function currentBookNames() {
    // ★ 角色卡那本**永远排第一**：就算这次扫描没回名单、或者快照里只有全局那几本，
    //   也不能把"当前这张卡绑的那本书"从列表里弄丢（角色卡世界书的编辑没了 ✓）
    const one = currentCharBook();
    return uniq([one, ..._snap.charBooks, ..._snap.globalBooks].filter(Boolean));
}

/**
 * ★ 手动「刷新」：只读重扫一遍（拿最新的"当前在用的世界书 ＋ 条目"）✓
 *   ⚠️ 扫之前**不清空旧名单**：`getWorldInfoPrompt` 的干跑不一定回发"名单"事件，
 *     清空再扫会把上一次的名单弄丢
 * @returns {Promise<{ok:boolean, books:number}>}
 */
export async function refreshWiBooks() {
    const oldGlobal = [..._snap.globalBooks];
    const oldChar = [..._snap.charBooks];
    _snap.entries = [];
    _snap.activated = [];
    _snap.scanned = false;
    _snap.chatKey = key();
    let ok = false;
    try { ok = await scanNow(); } catch { ok = false; }
    // 这一轮没扫出新名单 ⇒ 把旧的放回去（宁可留旧的，也别把列表清光 ✓）
    if (!_snap.globalBooks.length) _snap.globalBooks = oldGlobal;
    if (!_snap.charBooks.length) _snap.charBooks = oldChar;
    return { ok, books: currentBookNames().length };
}

/** 条目在这份快照里的唯一键（书名 + uid）—— 用来把"渲染结果"对回条目 ✓ */
function wiKey(e) {
    return String(e?.world || '') + '\u0000' + String(e?.uid ?? '');
}

/**
 * 组装要注入推演提示词的那段文字。
 *
 * ★ 「提示词模板的代码」（选「乙」）：世界书条目正文里可能有
 *   `<% ... %>`（提示词模板的语法），那是**要到提示词发出去之前才渲染**的，
 *   而插件读的是条目原文 ⇒ 直接发过去，推演会吃到一坨源码 ✗
 *   ⇒ 由调用方先把含 `<%` 的条目请提示词模板渲染好、放进 `renderMap` 传进来 ✓
 *
 * @param {{picks?:Array, renderMap?:Map<string,string>|null}} opts
 *   · `picks`     —— 这一步用哪批条目（不传就现算一份；调用方传进来可以避免中间被换聊天影响 ✓）
 *   · `renderMap` —— 渲染结果（键用 `wiKey`）。**传了它才启用"渲染口径"**：
 *                    含 `<%` 的条目必须能在表里找到；找不到 ⇒ **这一条一个字都不发**
 *                    （渲染失败，宁可少一条，也绝不把模板源码喂给推演 ✗）
 *   ⚠️ **不传 `renderMap`**（老调用方 / 单测 / 没装提示词模板）⇒ 一切照旧、一个字都不变 ✓
 * @returns {{text:string, count:number, chars:number, mode:string, books:number, desc:number, reason:string, rendered:number, skipped:number}}
 */
export function packWorldInfo(opts = {}) {
    const renderMap = opts.renderMap || null;
    const empty = (reason, extra = {}) => {
        _last = {
            at: Date.now(), count: 0, chars: 0,
            mode: wiFollows() ? '跟随酒馆' : '已锁死（手动）',
            books: 0, desc: 0, persona: 0, reason,
            rendered: 0, skipped: 0, ...extra,
        };
        return { text: '', ..._last };
    };
    // ★★ 2026-10-17（这两个开关不该绑在一起）——
    //   **两个开关各管各的**：总开关只管**世界书条目**，描述那格只管**角色卡描述** ✓
    //   以前总开关一关就整份空掉 ⇒ 描述那格变成一颗"点了没反应"的开关 ✗
    //   （摆在界面上的东西就该真的有用 ✓）
    const src = (opts.sources && typeof opts.sources === 'object') ? opts.sources : null;
    const desc = src
        ? (src.desc === true ? characterDescription() : '')
        : ((opts.skipDesc === true) ? '' : (wiDescOn() ? characterDescription() : ''));
    // ★ 2026-10-23：用户自己那份人设描述（她提的「用户角色信息也要一颗开关」）——
    //   没开就不取；`forcePersona` 是遗传判定那一轮的临时放行（**不改开关的存值** ✓）
    const persona = src
        ? (src.persona === true ? personaDescriptionForChat() : '')
        : ((wiPersonaOn() || opts.forcePersona === true) ? personaDescriptionForChat() : '');
    const wiEntriesOn = src
        ? (src.charBook === true || src.globalBook === true)
        : (wiOn() || opts.forceWi === true);
    const picked = wiEntriesOn
        ? (Array.isArray(opts.picks) ? opts.picks : pickEntries(opts.forceWi === true))
        : [];                                   // 总开关关着 ⇒ 条目一条都不取
    if (!picked.length && !desc && !persona) {
        return empty(wiEntriesOn
            ? (_snap.scanned ? '这一轮酒馆没有注入任何世界书条目' : '还没有世界书数据')
            : '世界书开关关着，角色描述与用户角色设定也没开');
    }

    // ⚠️ 一个字都不截（世界书条目动辄很大，"默认多少字"这种上限不要搞 ✓）
    let rendered = 0, skipped = 0;
    const used = [];
    const parts = [];
    for (const e of picked) {
        let body = String(e.content).trim();
        if (hasEjs(body) && renderMap) {
            if (!renderMap.has(wiKey(e))) { skipped++; continue; }   // 渲染失败 ⇒ 这一条不发 ✗
            body = String(renderMap.get(wiKey(e))).trim();
            rendered++;
        }
        // ★ 2026-10-17（直接发里头的文本就行）——
        //   **不再加「[书名] 条目名」那一行**：条目名与书名对判定没有用，白吃 token ✗
        //   代价：两本书记载的设定互相矛盾时，模型看不出哪句出自哪里（诊断里仍报条数与字数）
        parts.push(substituteMacros(body));
        used.push(e);
    }
    if (desc) parts.push(`[角色卡] 当前角色描述\n${substituteMacros(desc)}`);
    // ★ 用户角色设定：**单独一块**，抬头写明这是玩家自己写的（别和角色卡描述混成一堆）
    if (persona) parts.push(`[玩家角色] 玩家自己写的角色设定\n${substituteMacros(persona)}`);

    // 条目全被跳过（含模板代码的那几条渲染失败）⇒ 如实报，别假装"没有世界书" ✓
    if (!used.length && !desc && !persona) {
        return empty(skipped ? '含模板代码的条目没能渲染，已跳过' : '这一轮没有可用的条目', { skipped });
    }

    // 抬头按"这次到底带了什么"来写 —— 只带角色描述时说"世界书设定"会自相矛盾 ✗
    const head = used.length
        ? [
            '===== 世界书设定（只读参考） =====',
            '下面是这个世界当前生效的设定资料，用来帮助你理解角色、种族与背景。',
            '它们只是设定，不是判定规则；不要照抄原文的句子，也不要因为这里没提到就自行编造。',
        ].join('\n')
        : (desc ? [
            '===== 角色设定（只读参考） =====',
            '下面这段是当前角色卡里的角色描述，用来帮助你理解这个人。',
            '它只是设定，不是判定规则；不要照抄原文的句子。',
        ].join('\n') : [
            '===== 用户角色设定（只读参考） =====',
            '下面这段是玩家自己写的人设描述，用来帮助你理解 {{user}} 的身份、体质与背景。',
            '它只是设定，不是判定规则；不要照抄原文的句子。',
        ].join('\n'));

    const text = `${head}\n\n${parts.join('\n\n')}\n`;
    _last = {
        at: Date.now(),
        count: used.length,
        chars: text.length,
        mode: wiFollows() ? '跟随酒馆' : '已锁死（手动）',
        books: uniq(used.map(e => String(e.world))).length,
        desc: desc ? 1 : 0,
        persona: persona ? 1 : 0,
        reason: '',
        rendered,
        skipped,
    };
    return { text, ..._last };
}

/**
 * 推演前调它：把这一轮要带给推演的"参考设定"准备好。
 * ⚠️ 两个开关各管各的：总开关关着 ⇒ 不扫、不带条目，
 *   但**角色描述**那格仍然照它的开关走 ✓
 * @param {{forceWi?:boolean, forcePersona?:boolean}} [opts]
 *   forceWi / forcePersona：**只看这一轮**临时放行（遗传判定那一轮用），不改任何开关 ✓
 * @returns {Promise<string>} 要注入的文字（'' = 真的没有）
 */
export async function prepareWorldInfoForJudge(opts = {}) {
    // 总开关关着 ⇒ 世界书那半整段跳过（不扫、不取、不渲染）；描述那半下面照样组装 ✓
    // ★ 2026-10-24：`sources` = 遗传判定那轮按编辑好的四类来源**精确发**（覆盖常驻开关）✓
    const src = (opts.sources && typeof opts.sources === 'object') ? opts.sources : null;
    const wiEntriesOn = src
        ? (src.charBook === true || src.globalBook === true)
        : (!opts.skipWi && (wiOn() || opts.forceWi === true));
    if (wiEntriesOn) {
        try {
            const k = key();
            if (_snap.chatKey !== k) {
                // 换聊天了 ⇒ 旧快照作废（跟主 API 保持一样：那份快照属于上一个聊天 ✗）
                _snap.chatKey = k;
                _snap.scanned = false;
                _snap.activated = [];
                _snap.entries = [];
                _snap.globalBooks = [];
                _snap.charBooks = [];
            }
            if (!_snap.scanned) {
                // 没扫过 ⇒ 现场补一次（推演必须带世界书 ✓）
                await scanNow();
            }
        } catch (e) {
            console.warn('[Bodycord] 准备世界书失败', e);
        }
    }

    // ★ 「提示词模板的代码」渲染（选「乙」）——
    //   先把这次该带的条目**取一份快照**，再只对含 `<%` 的那几条请提示词模板渲染，
    //   最后拿**同一份快照**去组装 ⇒ 渲染期间就算换了聊天，发出去的也还是这一批 ✓
    let picks = [];
    let renderMap = null;
    if (wiEntriesOn) {
        try {
            picks = src ? pickEntries(false, false, src) : pickEntries(opts.forceWi === true, opts.charOnly === true);
        } catch { picks = []; }
        try {
            const need = picks.filter(e => hasEjs(e?.content));
            if (need.length && ptRenderReady()) {
                renderMap = new Map();
                for (const e of need) {
                    const kk = wiKey(e);
                    if (renderMap.has(kk)) continue;          // 同一个条目只渲染一次 ✓
                    const out = await renderEjsText(e.content);
                    if (typeof out === 'string') renderMap.set(kk, out);
                }
            }
        } catch (e) {
            console.warn('[Bodycord] 世界书里的模板代码渲染失败', e);
        }
    }

    // ⚠️ 提示词模板没装 / 它自己关着 ⇒ `renderMap` 保持 null ⇒ 原样发
    //   （它的文档写着"关掉之后 <% %> 会原样发给 LLM"⇒ 跟主 API 同一个口径 ✓）
    return packWorldInfo({
        picks, renderMap,
        forceWi: opts.forceWi === true,
        forcePersona: opts.forcePersona === true,
        skipDesc: opts.skipDesc === true,
        sources: src,
    }).text;
}

/** 界面 / 诊断报告的读数（只有数字与开关，不含正文 ✓） */
export function wiStatus() {
    const last = _last;
    return {
        mode: last.mode || (wiFollows() ? '跟随酒馆' : '已锁死（手动）'),
        count: last.count || 0,
        chars: last.chars || 0,
        books: last.books || 0,
        desc: last.desc || 0,
        persona: last.persona || 0,
        reason: last.reason || '',
        rendered: last.rendered || 0,
        skipped: last.skipped || 0,
        scanned: _snap.scanned,
        globalBooks: _snap.globalBooks.length,
        charBooks: _snap.charBooks.length,
        at: last.at || _snap.at || 0,
    };
}

/** 表格里"置顶"用的：当前角色卡的世界书（优先用快照里的，没有就现读卡片 ✓） */
export function pinnedCharBooks() {
    // ★ 角色卡那本**永远算角色卡**（同 currentBookNames 的口径 ✓）
    return uniq([currentCharBook(), ..._snap.charBooks].filter(Boolean));
}


/**
 * 读一本书的条目（**按需**：只有玩家展开某本时才调 ✓ 免得卡顿）
 * @returns {Promise<Array<{uid:string, title:string, disable:boolean}>>}
 */
export async function bookEntries(name) {
    const c = getCtx() || {};
    const fn = c.loadWorldInfo;
    if (typeof fn !== 'function' || !name) return [];
    try {
        const data = await fn(String(name));
        const entries = data && data.entries && typeof data.entries === 'object' ? data.entries : {};
        return Object.keys(entries).map((uid) => {
            const e = entries[uid] || {};
            return {
                uid: String(uid),
                title: String(e.comment || e.name || '').trim() || ('（第 ' + uid + ' 条）'),
                disable: e.disable === true,
                chars: String(e.content || '').length,
            };
        });
    } catch (e) {
        console.warn('[Bodycord] 读世界书条目失败：' + name, e);
        return [];
    }
}
