/**
 * wi-bind.js —— 「设定来源」：这个角色绑了哪几条世界书条目（2026-11-06 · 第七批）
 *
 * 需求口径（见 种族图鉴-计划.md 第六节）：
 *   · 角色级：一个对象绑一条或多条**世界书条目**（不是整本）✓
 *   · 只存绑定关系，**不存内容副本**，每次现读 ✓（这里落盘只落 书名 + 编号 + 条目名）
 *   · 没绑定 ⇒ 推演照旧走关键词扫描，行为一个字不变 ✓
 *   · 遗传判定那一轮：先带两边绑定的条目；都没绑，才临时带一次整本 ✓
 *
 * 存哪（跟图鉴绑定同一个口径 ✓）：
 *   · 本人：`settings().userWiBind`
 *   · 其他对象：`state().targets[key].wiBind`
 *
 * ⚠️ 绑定的锚是「书名 + uid」，不是条目名：作者改了条目名，绑定不断 ✓
 * ⚠️ uid 在酒馆里会随重排变化 ⇒ 读不到时**按条目名回退**找一次（同书内条目名唯一 ✓）
 * ⚠️ 这里一个字都不写世界书文件、也不改酒馆的勾选 ✓
 */

import { settings, save } from './settings.js';
import { state, commit, targetList, isUserKey, displayName, identOf, getImpregnatorLocks, parseAliases } from './store.js';
import { getCtx } from './st.js';

const SEP = '\u0000';

/** 一条绑定的唯一键（书名 + uid） */
export function wiBindKey(b) {
    return String(b?.book || '') + SEP + String(b?.uid ?? '');
}

/** 把存下来的那份洗一遍：缺书名 / 缺 uid 的丢掉，重复的合一（同一本书同一条只绑一次 ✓） */
export function normWiBinds(raw) {
    const out = [];
    const seen = new Set();
    for (const b of Array.isArray(raw) ? raw : []) {
        const book = String(b?.book || '').trim();
        const uid = String(b?.uid ?? '').trim();
        if (!book || !uid) continue;
        const k = book + SEP + uid;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ book, uid, title: String(b?.title || '').trim() });
    }
    return out;
}

/** 这个对象绑了哪几条（读不出来 ⇒ 空数组） */
export function wiBindsOf(key) {
    if (!key) return [];
    try {
        const raw = isUserKey(key) ? settings().userWiBind : state().targets?.[key]?.wiBind;
        return normWiBinds(raw);
    } catch { return []; }
}

/** 改绑（整份写入；传空数组 = 全部解绑） */
export function setWiBindsOf(key, list) {
    const clean = normWiBinds(list);
    try {
        if (isUserKey(key)) {
            settings().userWiBind = clean;
            save();
            return true;
        }
        const t = state().targets?.[key];
        if (!t) return false;
        if (clean.length) t.wiBind = clean; else delete t.wiBind;
        commit();
        return true;
    } catch { return false; }
}

/** 加一条绑定（已经绑过就什么都不做 ✓） */
export function addWiBindOf(key, item) {
    const add = normWiBinds([item])[0];
    if (!add) return false;
    const list = wiBindsOf(key);
    if (list.some((b) => wiBindKey(b) === wiBindKey(add))) return true;
    list.push(add);
    return setWiBindsOf(key, list);
}

/** 解一条绑定（按 书名 + uid） */
export function removeWiBindOf(key, book, uid) {
    const k = String(book || '') + SEP + String(uid ?? '');
    return setWiBindsOf(key, wiBindsOf(key).filter((b) => wiBindKey(b) !== k));
}

/** 这个对象绑了几条 */
export function wiBindCountOf(key) {
    return wiBindsOf(key).length;
}

/** 一串对象绑的条目（去重；给推演那一轮用 ✓） */
export function boundsOfTargets(list) {
    const out = [];
    const seen = new Set();
    for (const t of Array.isArray(list) ? list : []) {
        for (const b of wiBindsOf(t?.key)) {
            const k = wiBindKey(b);
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(b);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 「角色描述」取自哪张角色卡（2026-11-09 她提的：给对象绑一段角色描述）
//   · 只存**卡名**，描述每次现取 ⇒ 她改卡立刻生效，不留旧副本 ✓
//   · 卡删了 / 改名了 ⇒ 读不到就不发，界面上标「找不到」（不拿旧副本冒充 ✓）
//   · 存哪跟世界书绑定同一个口径：本人 `settings().userCardDesc`，其他对象 `targets[key].cardDesc`
// ---------------------------------------------------------------------------

/** 这个对象绑了哪张角色卡（空串 = 没绑） */
export function cardDescOf(key) {
    if (!key) return '';
    try {
        const raw = isUserKey(key) ? settings().userCardDesc : state().targets?.[key]?.cardDesc;
        return String(raw || '').trim();
    } catch { return ''; }
}

/** 改绑（传空串 = 解绑；只存卡名，不存正文 ✓） */
export function setCardDescOf(key, name) {
    const n = String(name || '').trim();
    try {
        if (isUserKey(key)) {
            if (n) settings().userCardDesc = n; else delete settings().userCardDesc;
            save();
            return true;
        }
        const t = state().targets?.[key];
        if (!t) return false;
        if (n) t.cardDesc = n; else delete t.cardDesc;
        commit();
        return true;
    } catch { return false; }
}

/**
 * 一串对象各自绑的角色卡（给推演那一轮用）——
 * 一个人一张卡，同名对象本就只有一个 ⇒ 不去重，照对象列 ✓
 * @returns {Array<{key:string, who:string, name:string}>}
 */
export function cardDescsOfTargets(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : []) {
        const k = String(t?.key || '');
        if (!k) continue;
        const name = cardDescOf(k);
        if (!name) continue;
        let who = '';
        try { who = isUserKey(k) ? String(getCtx()?.name1 || '').trim() : String(displayName(t) || '').trim(); } catch { who = ''; }
        out.push({ key: k, who: who || k || name, name });
    }
    return out;
}

/** 按名字找追踪对象（先 key、再显示名、最后别名）—— 遗传判定那轮要认另一个亲代 ✓ */
export function targetKeyByName(name) {
    const q = String(name || '').trim();
    if (!q) return '';
    const list = targetList();
    for (const t of list) if (String(t?.key) === q) return String(t.key);
    for (const t of list) if (displayName(t) === q) return String(t.key);
    for (const t of list) {
        let al = [];
        try { al = parseAliases(identOf(t.key).aliases); } catch { al = []; }
        if (al.includes(q)) return String(t.key);
    }
    return '';
}

/**
 * 遗传判定那一轮要带的两个亲代（受孕方 ＋ 锁定的致孕方）——
 * 致孕方可能不是追踪对象（合并卡那种），拿不到就只算受孕方 ✓
 */
export function heritageSideKeys(key) {
    const keys = [];
    const k = String(key || '');
    if (k) keys.push(k);
    try {
        for (const l of getImpregnatorLocks(k) || []) {
            const nm = String(l?.impregnator || '').trim();
            if (!nm) continue;
            const other = targetKeyByName(nm);
            if (other) keys.push(other);
        }
    } catch { /* 忽略 */ }
    return [...new Set(keys)];
}

/** 遗传判定那一轮：两边绑的条目（一边都没绑 ⇒ 空数组，调用方退回"临时带整本"） */
export function heritageBoundsOf(key) {
    return boundsOfTargets(heritageSideKeys(key).map((k) => ({ key: k })));
}

/** 同上，但一次算好几个受孕方（一轮里可能有两个人都到判遗传的时候 ✓） */
export function heritageBoundsOfMany(keys) {
    const out = [];
    const seen = new Set();
    for (const k of Array.isArray(keys) ? keys : []) {
        for (const b of heritageBoundsOf(k)) {
            const bk = wiBindKey(b);
            if (seen.has(bk)) continue;
            seen.add(bk);
            out.push(b);
        }
    }
    return out;
}

/**
 * 现读世界书：把绑定关系变成条目正文。
 * @param {Array<{book:string,uid:string,title:string}>} binds
 * @returns {Promise<{entries:Array<{world:string,uid:string,content:string,disable:boolean}>, missing:Array}>}
 *   entries 的形状跟酒馆 `worldinfo_entries_loaded` 给的条目一致 ⇒ 直接能进 `packWorldInfo` ✓
 *   missing = 书没了 / 条目没了 / 正文是空的那几条（**如实报出来，不静默吞** ✓）
 */
export async function readBoundEntries(binds) {
    const list = normWiBinds(binds);
    const byBook = new Map();
    for (const b of list) {
        if (!byBook.has(b.book)) byBook.set(b.book, []);
        byBook.get(b.book).push(b);
    }
    const entries = [];
    const missing = [];
    for (const [book, items] of byBook) {
        let data = null;
        try {
            const fn = getCtx()?.loadWorldInfo;
            if (typeof fn === 'function') data = await fn(book);
        } catch (e) { console.warn('[Bodycord] 读世界书失败：' + book, e); }
        const bag = data && data.entries && typeof data.entries === 'object' ? data.entries : null;
        for (const b of items) {
            if (!bag) { missing.push({ ...b, why: '找不到这本书' }); continue; }
            let e = bag[b.uid] || null;
            let uid = b.uid;
            if (!e && b.title) {
                // 编号变了（作者重排条目）⇒ 按条目名找一次；同书里同名只认第一条 ✓
                const hit = Object.entries(bag).find(([, x]) =>
                    String(x?.comment ?? x?.name ?? '').trim() === b.title);
                if (hit) { e = hit[1]; uid = String(hit[0]); }
            }
            const content = String(e?.content ?? '');
            if (!e || !content.trim()) { missing.push({ ...b, why: '找不到这一条' }); continue; }
            entries.push({ world: book, uid: String(uid), content, disable: false });
        }
    }
    return { entries, missing };
}

// ---------------------------------------------------------------------------
// 「疑似设定」：按名字 / 别名比对条目名（纯粹是个字符串比对，**不读世界书** ✓）
//   读不读由调用方决定：现在只有"打开挑选弹窗、点开某本书"那一刻才用 ✓
// ---------------------------------------------------------------------------

/** 归一化：空白、间隔点、大小写都不算差别 */
function normText(s) {
    return String(s || '').replace(/[\s·・]/g, '').toLowerCase();
}

/**
 * 在一个条目清单里找"疑似这个人的设定"。
 * 判据：条目名里**含**这个名字（或这个名字里含条目名），长度 ≥ 2 才算（单字太容易误中 ✓）
 * @param {Array<{uid,title}>} entries
 * @param {string} name
 * @param {string[]} aliases
 */
export function matchSettingEntries(entries, name, aliases) {
    const words = [name, ...(Array.isArray(aliases) ? aliases : [])]
        .map((w) => String(w || '').trim()).filter((w) => w.length >= 2);
    const qs = [...new Set(words.map(normText).filter((q) => q.length >= 2))];
    const out = [];
    const seen = new Set();
    for (const e of Array.isArray(entries) ? entries : []) {
        const title = String(e?.title || '').trim();
        if (!title) continue;
        const t = normText(title);
        if (!t) continue;
        // 两个方向都要 ≥ 2 字：单字条目名（比如「甲」）在中文里几乎啥都含得进去，会误中一片 ✗
        const hit = qs.some((q) => t.includes(q) || (t.length >= 2 && q.includes(t)));
        if (!hit) continue;
        const k = String(e?.uid ?? '') + '\u0001' + title;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
    }
    return out;
}
