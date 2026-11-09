/**
 * codex-bind.js —— 「这个角色绑的是图鉴哪一条」以及「单独调」的存储
 *
 * 三件事，都只做存储与判断：
 *   1. 绑定：对象 → 图鉴条目的编号（本人存全局设置、其他对象存本聊天档案 ✓）
 *   2. 对不上时的匹配：按名字、别名各试一遍；撞到多条就交给玩家挑，**绝不默认当人类** ✓
 *   3. 个人覆盖：这个对象单独调过的几项数值（第三批起判定会读它 ✓）
 *
 * 存哪（照「属于哪个大类」那一套）：
 *   · 本人：`settings().userCodexId` / `settings().userCodexOverride`
 *   · 其他对象：`state().targets[key].codexId` / `.codexOverride`
 *
 * ⚠️ 绑定的锚是**编号**，不是名字：改名不断绑定 ✓
 * ⚠️ 手打了别的名字却没选条目 ⇒ 绑定自动清掉（不然名字写着"骷髅"、绑着"人类"，第三批会算错 ✗）
 */

import { settings, save } from './settings.js';
import { state, targetList, isUserKey, displayName, raceJudgeOf, commit, tempRaceOf } from './store.js';
import { codexEntries, codexEntry } from './codex.js';

/** 比名字用的归一化：空白 / 间隔点 / 大小写都不算差别 */
function normRace(s) {
    return String(s || '').replace(/[\s·・]/g, '').toLowerCase();
}

/**
 * ★ 2026-11-08：对不上的名字 ⇒ 最像的几条（发送层的候选、临时种族的来源都用这一处）。
 * 打分：完全同名 100；包含 60 起；否则按共同字的占比给 40 以内。
 * 低于 25 的不算候选（不然"魔族"会靠一个「族」字蹭到虫族亚人 ✗）。
 */
export function nearestRaceEntries(texts, limit = 6) {
    const queries = (Array.isArray(texts) ? texts : [texts]).map(normRace).filter(Boolean);
    if (!queries.length) return [];
    const scored = [];
    for (const e of codexEntries()) {
        if (e.status !== 'on') continue;
        const names = [e.name, ...(e.aliases || [])].map(normRace).filter(Boolean);
        let best = 0;
        for (const q of queries) {
            for (const n of names) {
                if (n === q) best = Math.max(best, 100);
                else if (n.includes(q) || q.includes(n)) best = Math.max(best, 60 + Math.min(n.length, q.length) * 2);
                else {
                    let common = 0;
                    for (const ch of new Set(q)) if (n.includes(ch)) common++;
                    best = Math.max(best, Math.round((common / Math.max(1, q.length)) * 40));
                }
            }
        }
        if (best >= 25) scored.push({ e, s: best });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => x.e);
}

/**
 * 对一段种族文字取条目：名字 / 别名 / 包含 → 再退到**这个聊天的临时映射**。
 *
 * ★★ 2026-11-09：临时映射**必须她确认过**才算数（见 store.js 那段说明）——
 *   没确认的记录一律当"没对上"，免得插件悄悄替她借了另一族的数据 ✗
 * @returns {{entry:object|null, cands:object[], how:string, tempName?:string}}
 */
export function resolveRaceWithTemp(text) {
    const m = resolveRaceText(text);
    if (m.entry) return m;
    const t = tempRaceOf(text);
    if (t && t.confirmed === true) {
        const e = codexEntry(t.sourceId);
        if (e && e.status === 'on') return { entry: e, cands: [e], how: 'temp', tempName: t.name || String(text || '') };
    }
    return m;
}

/** 这个对象绑的是哪一条（'' = 没绑） */
export function codexIdOf(key) {
    if (!key) return '';
    if (isUserKey(key)) return String(settings().userCodexId || '');
    return String(state().targets?.[key]?.codexId || '');
}

/** 设绑定（空串 = 解绑） */
export function setCodexIdOf(key, id) {
    const v = String(id || '');
    if (v && !codexEntry(v)) return false;
    if (isUserKey(key)) {
        settings().userCodexId = v;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (v) t.codexId = v; else delete t.codexId;
    commit();
    return true;
}

/** 这个对象单独调过的数值（对象，空对象 = 全部跟随种族） */
export function codexOverrideOf(key) {
    if (!key) return {};
    const raw = isUserKey(key) ? settings().userCodexOverride : state().targets?.[key]?.codexOverride;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
}

/**
 * ★ 2026-11-08：**这个对象的性特征按哪一族写**（图鉴条目编号，空 = 跟随它自己绑的那一条）。
 *
 * 为什么要有：亡灵类（幽灵 / 僵尸 / 丧尸）的形状跟着生前那一族走，可提示词里没有
 * 「生前是人」对应那份正文 ⇒ 光写一句「照生前那一族」主 API 根本不知道长什么样 ✗
 * ⇒ 让玩家在「单独调」里挑一条，发送时把**那一条的性特征整段**带上，标题注明按谁 ✓
 */
export function sexBorrowOf(key) {
    if (!key) return '';
    const ov = codexOverrideOf(key);
    const v = ov && ov.sexBorrowId && typeof ov.sexBorrowId === 'object' ? String(ov.sexBorrowId.text || '') : '';
    return v;
}

/**
 * 写单独调的数值。
 * @param {string} key
 * @param {object} values  { [数值项]: { min, max } 或 { text } }；传空对象 = 全部恢复跟随
 */
export function setCodexOverride(key, values) {
    const clean = {};
    for (const [k, v] of Object.entries(values || {})) {
        if (!v || typeof v !== 'object') continue;
        if ('num' in v) {
            // ★ 第四批：单个数（显怀起点那种）
            const num = Number(v.num);
            if (Number.isFinite(num) && num > 0) clean[k] = { num };
        } else if ('min' in v || 'max' in v) {
            const min = v.min === '' || v.min === null || v.min === undefined ? null : Number(v.min);
            const max = v.max === '' || v.max === null || v.max === undefined ? null : Number(v.max);
            if (min === null && max === null) continue;
            clean[k] = { min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
        } else if ('text' in v) {
            const text = String(v.text ?? '');
            if (!text.trim()) continue;
            clean[k] = { text };
        }
    }
    if (isUserKey(key)) {
        settings().userCodexOverride = clean;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (Object.keys(clean).length) t.codexOverride = clean; else delete t.codexOverride;
    commit();
    return true;
}

export function clearCodexOverride(key) {
    return setCodexOverride(key, {});
}

// ---------------------------------------------------------------------------
// ★ 显怀起点（2026-11-06）：这个人「第几周开始显怀」的那一个数
//
// 为什么单独存、不塞进 codexOverride：
//   · 它不是「某一项数值的覆盖」，而是「体质」——这个人固定一个周数，换胎不重掷；
//   · 也不该跟着条目走：条目给的是范围，范围里落到哪一周是这个人自己的事。
// 存法跟别的"属于谁"一致：本人存全局设置，其他对象存对象身上 ✓
// ---------------------------------------------------------------------------

/** 这个人存下的显怀起点（0 = 还没定过） */
export function showWeekOf(key) {
    if (!key) return 0;
    const raw = isUserKey(key) ? settings().userShowWeek : state().targets?.[key]?.showWeek;
    const n = Number(raw);
    return (Number.isFinite(n) && n >= 1) ? Math.round(n) : 0;
}

/** 写显怀起点（传 0 / 空 = 清掉，下次用到时重新随机）；opts.manual = 玩家自己定的 */
export function setShowWeekOf(key, week, opts = {}) {
    const n = Number(week);
    const v = (Number.isFinite(n) && n >= 1) ? Math.round(n) : 0;
    const manual = !!opts.manual;
    if (isUserKey(key)) {
        if (v) settings().userShowWeek = v; else delete settings().userShowWeek;
        if (manual) settings().userShowWeekManual = true; else delete settings().userShowWeekManual;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (v) t.showWeek = v; else delete t.showWeek;
    if (manual) t.showWeekManual = true; else delete t.showWeekManual;
    commit();
    return true;
}

/** 这个显怀起点是不是玩家自己定的（本人 / 其他人，跟数一起存 ✓） */
export function showWeekManualOf(key) {
    if (!key) return false;
    return isUserKey(key) ? !!settings().userShowWeekManual : !!state().targets?.[key]?.showWeekManual;
}

/** 这个对象是不是单独调过（界面读数用） */
export function codexOverrideCount(key) {
    return Object.keys(codexOverrideOf(key)).length;
}

/**
 * 把一行种族文字对到图鉴条目。
 * 顺序：名字完全相等 → 别名完全相等 → 包含（只有唯一一条才算）
 * @returns {{entry:object|null, cands:object[], how:string}}
 */
export function resolveRaceText(text) {
    const q = normRace(text);
    if (!q) return { entry: null, cands: [], how: '' };
    const all = codexEntries();
    const byName = all.filter((e) => normRace(e.name) === q);
    if (byName.length === 1) return { entry: byName[0], cands: byName, how: 'name' };
    if (byName.length > 1) return { entry: null, cands: byName, how: 'name-many' };
    const byAlias = all.filter((e) => (e.aliases || []).some((a) => normRace(a) === q));
    if (byAlias.length === 1) return { entry: byAlias[0], cands: byAlias, how: 'alias' };
    if (byAlias.length > 1) return { entry: null, cands: byAlias, how: 'alias-many' };
    const loose = all.filter((e) => {
        const names = [e.name, ...(e.aliases || [])].map(normRace).filter(Boolean);
        return names.some((n) => n.includes(q) || q.includes(n));
    });
    return { entry: loose.length === 1 ? loose[0] : null, cands: loose, how: 'loose' };
}

/**
 * ★ 第八批：反查「谁在用这一条」。
 * 两种都算在用（发主 API 时绑定优先，没绑定就按名字对上）：
 *   · bound    明确绑了这一条
 *   · matched  名字 / 别名能对上这一条，还没绑
 * 本人就算还没正式建过档，只要在设置里绑了这条，也列出来 ✓
 * @param {string} id 图鉴条目编号
 * @returns {{key:string, name:string, how:string, overrides:number}[]}
 */
export function codexUsageOf(id) {
    const want = String(id || '');
    if (!want) return [];
    const out = [];
    const seen = new Set();
    for (const r of chatBindings()) {
        seen.add(r.key);
        if (r.boundId === want) {
            out.push({ key: r.key, name: r.name, how: 'bound', overrides: r.overrides });
        } else if (!r.boundId && r.matched && r.matched.id === want) {
            out.push({ key: r.key, name: r.name, how: 'matched', overrides: r.overrides });
        } else if (!r.boundId && r.tempSource && r.tempSource.id === want) {
            out.push({ key: r.key, name: r.name, how: 'temp', overrides: r.overrides });
        }
    }
    if (!seen.has('user') && codexIdOf('user') === want) {
        out.push({ key: 'user', name: '你自己', how: 'bound', overrides: codexOverrideCount('user') });
    }
    return out;
}

/**
 * 这个聊天的角色 → 图鉴的对照表。
 * status：
 *   bound        已经绑了一条（且那条还在）
 *   matched      名字 / 别名能对上唯一一条，但还没绑
 *   temp         临时映射，而且**她确认过**（借那一条的数据）
 *   temp-pending 有个自动记下的临时映射，**她还没确认** ⇒ 现在不生效，等她点
 *   ambiguous    撞到多条，要玩家挑
 *   unmatched    一条都算不上
 *   missing      绑的编号在图鉴里找不到了（条目被删 / 以后换数据）
 *   empty        连种族文字都还没填
 *
 * ★ 2026-11-09（B 方案）：`near` ＝"最像的几条"，给界面一键借数据用；
 *   插件**不再自己借**，只把候选摆出来 ✓
 */
export function chatBindings() {
    const out = [];
    for (const t of targetList()) {
        const key = t.key;
        let race = '';
        // ★ 2026-11-09：**推演报的族名也要算进来**（`asked`）——
        //   以前只看 `set`（玩家填的那格），于是"模型报了一个图鉴里没有的族"这种情况
        //   在绑定表里显示成「还没填种族」，她根本看不到该不该借数据 ✗
        //   ⚠️ 两个都没有时仍然算"还没填"：`raceJudgeOf().race` 那个兜底是「人类」，
        //     拿它凑数会让每个新对象都显示"名字人类能对上" ✗
        try {
            const rj = raceJudgeOf(key);
            race = String(rj.set || rj.asked || '').trim();
        } catch { /* 忽略 */ }
        const boundId = codexIdOf(key);
        const bound = boundId ? codexEntry(boundId) : null;
        const m = bound ? { entry: bound, cands: [bound], how: 'bind' } : resolveRaceWithTemp(race);
        // 没绑、名字也没对上 ⇒ 给"最像的几条"当候选（一条都没有就是空数组 ✓）
        const pending = (!bound && race && !m.entry) ? tempRaceOf(race) : null;
        const near = (!bound && race && !m.entry)
            ? (() => { try { return nearestRaceEntries([race], 3); } catch { return []; } })()
            : [];
        let status = 'empty';
        if (boundId && !bound) status = 'missing';
        else if (bound) status = 'bound';
        else if (!race) status = 'empty';
        else if (m.entry) status = m.how === 'temp' ? 'temp' : 'matched';
        else if (pending && pending.sourceId) status = 'temp-pending';
        else if (m.cands.length > 1) status = 'ambiguous';
        else status = 'unmatched';
        out.push({
            key,
            name: (() => { try { return displayName(t); } catch { return key; } })(),
            race,
            boundId,
            entry: bound,
            matched: m.entry,
            cands: m.cands,
            near,
            status,
            tempName: m.how === 'temp' ? String(m.tempName || race) : '',
            tempSource: m.how === 'temp' ? m.entry : null,
            // 未确认的那条映射记的是哪个来源（界面上要写清"本来想借谁"）
            pendingSource: pending
                ? (() => { try { return codexEntry(pending.sourceId) || null; } catch { return null; } })()
                : null,
            overrides: codexOverrideCount(key),
        });
    }
    return out;
}
