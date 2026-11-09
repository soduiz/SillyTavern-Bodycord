/**
 * codex.js —— 种族图鉴的数据层（读写、编号、复制、启停）
 *
 * 数据存在哪：
 *   · 内置条目：`codex-data.js`（跟随插件版本走）
 *   · 玩家改过的内置条目：`settings().codex.overrides[编号]`（整条快照）
 *   · 玩家自建的条目：`settings().codex.custom`（数组，一条一份）
 *   · 停用：写在那份快照的 `status: 'off'` 上（内置条目改回默认时一起消失 ✓）
 *
 * 为什么覆盖存整条快照、而不是逐字段 diff：
 *   1) 数值表、发育段都是数组，逐字段合并的规则比"整条存"更容易出岔子；
 *   2) 一条快照几 KB，玩家自己改的条目撑死几十条，代价可以忽略；
 *   3) 「恢复默认」只要删掉那个键，一行就做完了 ✓
 *
 * ⚠️ 这一批只做目录：这些数据**还没有**接进判定与提示词（第三批才读）✓
 */

import { settings, save } from './settings.js';
import { normalizeEntry, makeCodexId, CODEX_CATS, codexMatch } from './codex-schema.js';

// ---------------------------------------------------------------------------
// ★★ 2026-11-09（A 方案）：内置图鉴**用到才读进内存**，不再在插件启动时解析那 757KB
//
// 为什么要这样：她换新机上手机之后，"刷新那一下"要把整个插件（约 2.5MB JS）解析一遍，
//   其中 `codex-data.js` 一家就占 757KB（714 条 × 四段正文）。Node 里量过：光这一个模块
//   的 import + 解析约 40ms，手机上乘以几倍 ⇒ 挪出启动关键路径，等页面画完再读。
//
// 代价与对策（**这是这一改唯一要小心的地方**）：
//   · 读进来之前 `codexEntries()` 是空的 ⇒ 拿它拼提示词会拼出"图鉴里一个族都没对上"的
//     种族目录，等于骗模型 ✗ ⇒ `prompt.js` 那边专门挡了一道：**没读完就整段不发**；
//   · 读完之后 `index.js` 会重建一次注入、刷一次界面 ⇒ 那一段立刻补齐，不会一直缺 ✓；
//   · 界面（图鉴页）在没读完时显示"正在读入…"，读完自动重画 ✓
// ---------------------------------------------------------------------------

/** 内置条目（还没读进来时是 null；**外部一律走 `builtinList()`**） */
let BUILTIN = null;
let _builtinLoad = null;
const _readyHooks = [];

/** 内置图鉴读进来了没有 */
export function builtinReady() { return Array.isArray(BUILTIN); }

/** 读进来之后要干的事（index.js 用它重建注入 / 刷界面）；已经读好就下一拍直接调 ✓ */
export function onBuiltinReady(fn) {
    if (typeof fn !== 'function') return;
    if (builtinReady()) { Promise.resolve().then(() => { try { fn(); } catch { /* 忽略 */ } }); return; }
    _readyHooks.push(fn);
}

/**
 * 确保内置图鉴读进来了（幂等；重复调用拿同一个 promise）。
 * @returns {Promise<object[]>} 内置条目
 */
export function ensureBuiltinCodex() {
    if (builtinReady()) return Promise.resolve(BUILTIN);
    if (_builtinLoad) return _builtinLoad;
    _builtinLoad = import('./codex-data.js').then((m) => {
        BUILTIN = Array.isArray(m?.BUILTIN_CODEX) ? m.BUILTIN_CODEX : [];
        // 读进来之前可能已经按"空图鉴"算过一份缓存 ⇒ 作废重来
        codexInvalidate();
        for (const fn of _readyHooks.splice(0)) { try { fn(BUILTIN); } catch { /* 一个监听方坏了不影响别人 ✓ */ } }
        return BUILTIN;
    }).catch((e) => {
        _builtinLoad = null;      // 允许下次再试（比如网络 / 文件暂时读不到）
        console.error('[Bodycord] 图鉴数据没读进来，这一轮先不发种族设定', e);
        return [];
    });
    return _builtinLoad;
}

/** 内置条目列表（没读进来时是空数组 —— 别拿它当"图鉴是空的"用 ✓） */
function builtinList() { return Array.isArray(BUILTIN) ? BUILTIN : []; }

/** 这个编号是不是内置条目 */
export function isBuiltinCodexId(id) {
    return builtinList().some((b) => b.id === id);
}

const CAT_ORDER = new Map(CODEX_CATS.map((c, i) => [c[0], i]));

/**
 * ★ 2026-11-06（第三批）：条目一保存就通知一声 —— 判定那边要拿新数值重新算预产期。
 * 为什么放在这一层：界面里保存的入口有十几处（每次打字都存），
 *   挂在这里只写一遍；监听方自己决定要不要防抖 ✓
 */
const _saveHooks = [];
export function onCodexSaved(fn) {
    if (typeof fn === 'function') _saveHooks.push(fn);
}

/** 图鉴的存储块（读的时候顺手补结构，老存档不会被改坏 ✓） */
export function codexCfg() {
    const s = settings();
    if (!s.codex || typeof s.codex !== 'object' || Array.isArray(s.codex)) {
        s.codex = { overrides: {}, custom: [] };
    }
    const c = s.codex;
    if (!c.overrides || typeof c.overrides !== 'object' || Array.isArray(c.overrides)) c.overrides = {};
    if (!Array.isArray(c.custom)) c.custom = [];
    return c;
}

/** 所有编号（内置 + 自建），查重用 */
export function codexIds() {
    const set = new Set(builtinList().map((e) => e.id));
    for (const e of codexCfg().custom) if (e && e.id) set.add(String(e.id));
    for (const id of Object.keys(codexCfg().overrides)) set.add(id);
    return set;
}

/**
 * 全部条目（内置套上覆盖 + 自建）。
 * 顺序：先按分类排，同分类里内置在前、自建在后，再按名字。
 *
 * ★ 2026-11-07 优化：整本图鉴已经四百多条，这个方法每调一次都要重新套覆盖再排序（约 3 毫秒），
 *   而界面一屏里会被调几十次（列表每行、统计、字数合计、绑定对照…）⇒ 点进图鉴会明显顿一下。
 *   现在结果缓存一份，只在保存 / 删除 / 恢复默认时作废 ✓
 */
let _entriesCache = null;
let _entriesById = null;

/** 缓存作废（改完图鉴要调；codexSave / codexRemove / codexReset 里已经接好了 ✓） */
export function codexInvalidate() {
    _entriesCache = null;
    _entriesById = null;
}

/** 中文按名字排：Intl.Collator 比每次调 localeCompare 快得多 ✓ */
const NAME_COLLATOR = (() => {
    try { return new Intl.Collator('zh'); } catch { return null; }
})();

/**
 * 一条条目存成快照（覆盖 / 自建 / 导出 都用这一份字段表）。
 * ★ 2026-11-08：单独抽出来，是为了"整批改状态"时能绕开逐条 save 直接写 ✓
 */
function snapshotOf(e) {
    return {
        id: e.id,
        name: e.name,
        aliases: e.aliases,
        cat: e.cat,
        species: e.species,
        source: e.source,
        status: e.status,
        intro: e.intro,
        physio: e.physio,
        repro: e.repro,
        extra: e.extra,
        // ★ 2026-11-06：繁殖数据借用自哪一条（跟着条目一起存 / 一起导出 ✓）
        borrowFrom: e.borrowFrom || '',
        // ★ 2026-11-08：性特征（跟着条目一起存 / 一起导出 ✓）
        sexTrait: e.sexTrait,
        rows: e.rows,
        stages: e.stages,
        notes: e.notes,
    };
}

/**
 * ★ 2026-11-08：「改过」只看**内容**，不看启停。
 *   她报：只是停用了一下，列表就标成「改过」，可她确实没改过内容。
 *   ⇒ 覆盖快照里除 status 以外的字段跟内置一样 ⇒ 不算改过（停用有它自己的角标 ✓）
 */
const EDIT_FIELDS = ['name', 'aliases', 'cat', 'species', 'source', 'intro', 'physio', 'repro', 'extra', 'borrowFrom', 'sexTrait', 'rows', 'stages', 'notes'];

function contentSame(a, b) {
    const A = normalizeEntry(a);
    const B = normalizeEntry(b);
    for (const k of EDIT_FIELDS) {
        if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) return false;
    }
    return true;
}

export function codexEntries() {
    // ★ 只在"内置读进来了"的时候才算数：没读进来之前这份结果是**不完整**的，
    // 拿它当缓存会让图鉴一直空着（读进来时 ensureBuiltinCodex 会再作废一次，双保险 ✓）
    if (_entriesCache && builtinReady()) return _entriesCache;
    const c = codexCfg();
    const out = [];
    for (const b of builtinList()) {
        const ov = c.overrides[b.id];
        const e = normalizeEntry(ov ? { ...b, ...ov } : b);
        e.builtin = true;
        e.edited = !!ov && !contentSame(ov, b);
        out.push(e);
    }
    for (const cu of c.custom) {
        if (!cu || !cu.id) continue;
        const e = normalizeEntry(cu);
        e.builtin = false;
        e.edited = true;
        out.push(e);
    }
    // 先按大类排（顺序见 CODEX_CATS），同一大类的内置在前、再按名字 ✓
    out.sort((a, b) => {
        const ca = CAT_ORDER.get(a.cat) ?? 99;
        const cb = CAT_ORDER.get(b.cat) ?? 99;
        if (ca !== cb) return ca - cb;
        if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
        if (NAME_COLLATOR) return NAME_COLLATOR.compare(a.name, b.name);
        return a.name.localeCompare(b.name, 'zh');
    });
    _entriesById = new Map(out.map((e) => [e.id, e]));
    // ★ 内置还没读进来 ⇒ 这份列表**不缓存**（它只是"自建那几条"，读完要重算）✓
    if (builtinReady()) _entriesCache = out;
    return out;
}

/** 单条（找不到给 null）—— 走缓存里的编号表，不再为了找一条排一次序 ✓ */
export function codexEntry(id) {
    codexEntries();
    return (_entriesById && _entriesById.get(id)) || null;
}

/** 内置条目有没有被改过（停用也算改过 ✓） */
export function codexIsEdited(id) {
    return !!codexCfg().overrides[id];
}

/** 保存一条（内置 ⇒ 写覆盖；自建 ⇒ 替换整条；自建不存在 ⇒ 追加） */
export function codexSave(entry) {
    const c = codexCfg();
    const e = normalizeEntry(entry);
    if (!e.id) e.id = makeCodexId(e.builtin === false ? 'cr-' : 'bi-', codexIds());
    const snap = snapshotOf(e);
    const builtin = builtinList().some((b) => b.id === e.id);
    if (builtin) {
        c.overrides[e.id] = snap;
    } else {
        const i = c.custom.findIndex((x) => x && x.id === e.id);
        if (i >= 0) c.custom[i] = snap;
        else c.custom.push(snap);
    }
    codexInvalidate();
    save();
    for (const fn of _saveHooks) {
        try { fn(e.id); } catch { /* 一个监听方坏了不拦保存 ✓ */ }
    }
    return e.id;
}

/** 新建一条自建条目（返回整条，界面直接进详情 ✓） */
export function codexCreate() {
    const id = makeCodexId('cr-', codexIds());
    const entry = normalizeEntry({
        id,
        name: '新种族',
        cat: 'other',
        source: 'origin',
        intro: '',
    });
    entry.builtin = false;
    entry.edited = true;
    codexSave(entry);
    return entry;
}

/** 复制一条（内置 ⇒ 生成自建；自建 ⇒ 再复制一份） */
export function codexDuplicate(id) {
    const src = codexEntry(id);
    if (!src) return null;
    const copy = normalizeEntry({
        ...src,
        id: makeCodexId('cr-', codexIds()),
        name: src.name + '（副本）',
        status: 'on',
    });
    copy.builtin = false;
    copy.edited = true;
    codexSave(copy);
    return copy;
}

/** 删一条（只有自建能删；内置只能停用 ✓） */
export function codexRemove(id) {
    const c = codexCfg();
    if (builtinList().some((b) => b.id === id)) return false;
    const i = c.custom.findIndex((x) => x && x.id === id);
    if (i < 0) return false;
    c.custom.splice(i, 1);
    delete c.overrides[id];
    codexInvalidate();
    save();
    return true;
}

/** 停用 / 启用（内置与自建都走这一条） */
export function codexSetStatus(id, on) {
    const e = codexEntry(id);
    if (!e) return false;
    e.status = on ? 'on' : 'off';
    codexSave(e);
    return true;
}

/**
 * 恢复默认：内置条目 ⇒ 删掉覆盖（改动与停用一起没了）；
 * 自建条目 ⇒ 没有"默认"可言，返回 false（界面不画这个按钮 ✓）
 */
export function codexReset(id) {
    const c = codexCfg();
    if (!builtinList().some((b) => b.id === id)) return false;
    if (!c.overrides[id]) return false;
    delete c.overrides[id];
    codexInvalidate();
    save();
    return true;
}

/** 统计（界面开头那行读数） */
export function codexStats() {
    const list = codexEntries();
    return {
        total: list.length,
        builtin: list.filter((e) => e.builtin).length,
        custom: list.filter((e) => !e.builtin).length,
        edited: list.filter((e) => e.builtin && e.edited).length,
        off: list.filter((e) => e.status === 'off').length,
    };
}

/**
 * ★ 2026-11-08：按种类整批改启用状态（返回改了几条）。
 *   她要求能整族一起关（条目多了，不能让玩家一条一条点）；同日又补：种类可以只选一个，也可以选好几个
 *   ⇒ species 收 string 或 string[]。内置与自建都走同一条路。
 *   ⚠️ 整批只能 **save 一次**：原来逐条 codexSetStatus ⇒ 每条都落盘 + 重排整本图鉴，
 *      全选 33 族时会卡住好一会儿，表现就是"点了没反应" ✗
 */
export function codexSetStatusBySpecies(species, on) {
    const set = speciesSetOf(species);
    if (!set.size) return 0;
    const c = codexCfg();
    const targets = codexEntries().filter((e) => set.has(e.species || '') && (e.status === 'on') !== !!on);
    if (!targets.length) return 0;
    const builtinIds = new Set(builtinList().map((b) => b.id));
    for (const e of targets) {
        const snap = snapshotOf(e);
        snap.status = on ? 'on' : 'off';
        if (builtinIds.has(e.id)) c.overrides[e.id] = snap;
        else {
            const i = c.custom.findIndex((x) => x && x.id === e.id);
            if (i >= 0) c.custom[i] = snap;
        }
    }
    codexInvalidate();
    save();
    for (const fn of _saveHooks) {
        try { fn(''); } catch { /* 一个监听方坏了不拦保存 ✓ */ }
    }
    return targets.length;
}

/**
 * ★ 2026-11-08（她：手动一条条恢复按不下去了，要有批量恢复）：
 *   按种类整批「恢复默认」，跟批量停用同一个入口形状。
 *
 *   · 只处理**内置**条目（自建没有"默认"可言）；
 *   · 覆盖里存着的东西一律清掉，所以**停用也会一起恢复**（跟单条那颗按钮同一个口径，
 *     弹窗里会写明这一点）；
 *   · 整批只落盘一次（跟批量停用同一个理由：逐条 save 会把整本图鉴重排一遍）✓
 * @param {string|string[]} species 种类；'__none__' = 没有指定种类的那一批
 * @returns {number} 恢复了几条
 */
export function codexResetBySpecies(species) {
    const set = speciesSetOf(species);
    if (!set.size) return 0;
    const c = codexCfg();
    const targets = codexEntries().filter((e) => e.builtin && set.has(e.species || '') && c.overrides[e.id]);
    if (!targets.length) return 0;
    for (const e of targets) delete c.overrides[e.id];
    codexInvalidate();
    save();
    for (const fn of _saveHooks) {
        try { fn(''); } catch { /* 一个监听方坏了不拦保存 ✓ */ }
    }
    return targets.length;
}

/** 按种类筛时用：'__none__' 代表「没有指定种类」那一批（种类留空的条目也选得到 ✓） */
export const SPECIES_NONE_KEY = '__none__';

function speciesSetOf(species) {
    const set = new Set();
    for (const s of (Array.isArray(species) ? species : [species])) {
        if (s === SPECIES_NONE_KEY) set.add('');
        else if (s) set.add(s);
    }
    return set;
}

/** 按关键字、分类（人类 / 动物 / 亚人 / 兽人）与种类（犬 / 猫 / 猪…）筛；传空 = 不筛 ✓ */
export function codexFilter(list, q, cat, species = '') {
    return list.filter((e) => (!cat || e.cat === cat)
        && (!species || e.species === species)
        && codexMatch(e, q));
}
