/**
 * codex-values.js —— 第三批：判定读图鉴（数值那一层）
 *
 * 一句话：**「这一族怀多久、生几个、同卵多少、几天着床」从图鉴条目里读**，
 *   读不出来才退回原来的地方（规则正文 / 全局设置）—— 退回去这件事**要留痕**，不许静默 ✓
 *
 * 三层（计划里定的，按顺序取第一个有值的）：
 *   ① 个人：这个角色单独调过的那几项（`codexOverrideOf`）
 *   ② 条目：他绑的那一条（没绑就按名字 / 别名对一条）
 *   ③ 全局：还是原来的规则正文 / 设置页那几格（这一步由调用方自己兜，本文件只回报"没有值"）
 *
 * 本文件产出两类东西：
 *   · `readXxxOf(key, …)` —— 判定真正要用的值（带 `layer`，能说清这个值来自哪一层）
 *   · `shadowOf(key)`     —— 影子比对：条目这边算出来的 vs 原来那边算出来的，逐项列出
 *
 * ⚠️ 单位换算只在这里做一次：刻度是「天 / 周 / 月」，月按 30 天（跟 judge 里那条口径一致 ✓）
 * ⚠️ 卵生那一套（枚数本身是区间、孵化期另算）**这一批不接**：读到那种写法就明说"读不出"，
 *   绝不半懂不懂地猜一个数（卵生是第五批 ✓）
 */

import { settings, setCodexCycleReader, setBodyRaceReader, setCodexEstrusReader } from './settings.js';
import { cycleHooks } from './cycle-hooks.js';
import { codexEntry, codexEntries } from './codex.js';
import { rowOf, VALUE_ROWS } from './codex-schema.js';
import { codexIdOf, codexOverrideOf, resolveRaceWithTemp, showWeekOf, setShowWeekOf, showWeekManualOf } from './codex-bind.js';
import { state, raceJudgeOf, isUserKey } from './store.js';
import { parseFetus } from './fetus.js';
import {
    fetusCountTableOf, fetusSexRangeOf, fetusOvumRangeOf, fetusMixRangeOf,
} from './settings.js';

/** 人类那一条（「同人类」就是跟着它走；孕期兜底 280 天也是它 ✓） */
export const HUMAN_ENTRY_ID = 'bi-human';

/** 这个值来自哪一层（界面 / 影子比对都用这几个词） */
export const LAYER_TEXT = {
    person: '单独调',
    entry: '这一条',
    borrow: '借用的条目',
    human: '人类那一条',
    global: '全局',
};

export function layerText(layer) {
    return LAYER_TEXT[layer] || '';
}

const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const RANGE_SEP = '[-–—~～至到]';

// ---------------------------------------------------------------------------
// 解析（纯函数：吃一条条目 / 一段文字，不碰存档）
// ---------------------------------------------------------------------------

function rowHasValue(row) {
    if (!row) return false;
    if (row.kind === 'range') return row.min != null || row.max != null;
    if (row.kind === 'number') return Number.isFinite(Number(row.num)) && Number(row.num) > 0;
    return String(row.text ?? '').trim() !== '';
}

function rowTextOf(entry, key) {
    const r = rowOf(entry, key);
    return r && r.kind !== 'range' ? String(r.text ?? '').trim() : '';
}

/** 胎数分档：「D100：1-78 单胎，79-94 双胎…」⇒ [{from,to,n}] */
export function parseLitterText(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return [];
    const segs = raw.replace(/D100\s*[：:]/gi, ' ')
        .split(/[，,、；;。\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (!segs.length) return [];
    const out = [];
    for (const seg of segs) {
        const m = seg.match(new RegExp('(\\d+)\\s*' + RANGE_SEP + '\\s*(\\d+)\\s*([\\s\\S]*)'));
        if (!m) return [];
        const from = Number(m[1]);
        const to = Number(m[2]);
        const tail = String(m[3] || '');
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
        // 枚数本身是区间（「产 3-4 枚」）⇒ 还要再掷一次数量，这一批不接 ✓
        if (new RegExp('\\d+\\s*' + RANGE_SEP + '\\s*\\d+').test(tail)) return [];
        const n = countInTail(tail);
        // ★ 2026-11-07：数量**不设上限**（原来是 1~20，超过整条读不出来）——
        //   蜂蚁白蚁、鱼这类一窝几百上千枚的族也得能填；上界只留一个"是整数"的底
        //   ⇒ 后面各处按量取整，不逐枚摊开（见「胎儿卡只列前几行」与「出生按量建档」✓）
        if (!(Number.isFinite(n) && n >= 1)) return [];
        out.push({ from, to, n });
    }
    return out;
}

function countInTail(tail) {
    const s = String(tail ?? '');
    let m = s.match(/(\d+)\s*(?:胎|枚|只|个)/);
    if (m) return Number(m[1]);
    m = s.match(/([一二两三四五六七八九十])胎/);
    if (m) return CN_DIGIT[m[1]] || 0;
    if (/单胎/.test(s)) return 1;
    if (/双胎|双胞胎/.test(s)) return 2;
    return 0;
}

/** 性别区间：「1-50 男，51-100 女」/「1-50 判为雄，51-100 判为雌」⇒ {male,female,标签}
 *  ★ 2026-11-07：写「不分性别」⇒ {none:true}（这一族的孩子没有性别，插件不掷 ✓） */
export function parseSexText(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    if (/不分性别|无性别|不判性别|没有性别/.test(s)) return { none: true };
    const re = new RegExp('(\\d+)\\s*' + RANGE_SEP + '\\s*(\\d+)\\s*(?:判为|判做|分为|为|是)?\\s*(偏?[男女雄雌])', 'g');
    const hits = [];
    let m;
    while ((m = re.exec(s)) !== null) {
        hits.push({ from: Number(m[1]), to: Number(m[2]), label: String(m[3]).replace(/^偏/, '') });
    }
    const male = hits.find((h) => /男|雄/.test(h.label));
    const female = hits.find((h) => /女|雌/.test(h.label));
    if (!male || !female) return null;
    if (!(male.to >= male.from) || !(female.to >= female.from)) return null;
    return { male: [male.from, male.to], female: [female.from, female.to], maleLabel: male.label, femaleLabel: female.label };
}

/** 同卵 / 异卵 / 混合：「1-33 同卵，34-100 异卵；96-100 为混合胎」 */
export function parseTwinText(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    if (/不判[^。；;\n]*同卵/.test(s)) return { none: true };
    const out = {};
    const m = s.match(new RegExp('(\\d+)\\s*' + RANGE_SEP + '\\s*(\\d+)\\s*同卵\\s*[，,、]\\s*(\\d+)\\s*' + RANGE_SEP + '\\s*(\\d+)\\s*异卵'));
    if (m) { out.same = [Number(m[1]), Number(m[2])]; out.diff = [Number(m[3]), Number(m[4])]; }
    const mx = s.match(new RegExp('(\\d+)\\s*' + RANGE_SEP + '\\s*(\\d+)\\s*(?:为)?\\s*混合'));
    if (mx) out.mixed = [Number(mx[1]), Number(mx[2])];
    return (out.same || out.mixed) ? out : null;
}

/** 「280 天」/「12-15 个月」⇒ 天数区间（认不出 ⇒ null；月按 30 天 ✓） */
export function parseGestDaysText(txt) {
    const s = String(txt ?? '');
    const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    const per = /周/.test(s) ? 7 : (/天|日/.test(s) ? 1 : 30);
    return {
        lo: Math.round(Math.min(...nums) * per),
        hi: Math.round(Math.max(...nums) * per),
    };
}

function scaleWord(scale) {
    const s = String(scale || '天');
    if (s === '月') return '个月';
    return s;
}

function fmtRange(a, b, scale) {
    const w = scaleWord(scale);
    return (a === b) ? (a + ' ' + w) : (a + '-' + b + ' ' + w);
}

// ---------------------------------------------------------------------------
// 这个对象是哪一条（绑定优先，其次按名字 / 别名）
// ---------------------------------------------------------------------------

function raceTextOf(key) {
    try {
        const r = raceJudgeOf(key);
        return String(r?.race || r?.set || '').trim();
    } catch { return ''; }
}

/** 按一段种族文字对条目（停用的不算；对不上时退到聊天里的临时映射 ✓） */
export function entryForRace(raceText) {
    const q = String(raceText ?? '').trim();
    if (!q) return null;
    try {
        const m = resolveRaceWithTemp(q);
        return (m.entry && m.entry.status === 'on') ? m.entry : null;
    } catch { return null; }
}

/** 这个对象用哪一条（停用 / 对不上 ⇒ null ⇒ 调用方退回全局） */
export function codexEntryOf(key) {
    if (!key) return null;
    try {
        const id = codexIdOf(key);
        if (id) {
            const e = codexEntry(id);
            return (e && e.status === 'on') ? e : null;
        }
        return entryForRace(raceTextOf(key));
    } catch { return null; }
}

function humanEntry() {
    try {
        const e = codexEntry(HUMAN_ENTRY_ID);
        return (e && e.status === 'on') ? e : null;
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// 三层取值
// ---------------------------------------------------------------------------

/** 个人单独调过的那一行（对不上固定项 / 空 ⇒ null） */
function personRowOf(key, rowKey) {
    let ov = null;
    try { ov = codexOverrideOf(key)[rowKey]; } catch { return null; }
    if (!ov || typeof ov !== 'object') return null;
    const def = VALUE_ROWS.find((r) => r.key === rowKey);
    if (!def) return null;
    if (def.kind === 'range') {
        const min = (ov.min === null || ov.min === undefined) ? null : Number(ov.min);
        const max = (ov.max === null || ov.max === undefined) ? null : Number(ov.max);
        const okMin = Number.isFinite(min);
        const okMax = Number.isFinite(max);
        if (!okMin && !okMax) return null;
        return { key: rowKey, label: def.label, kind: 'range', min: okMin ? min : null, max: okMax ? max : null };
    }
    if (def.kind === 'number') {
        const n = Number(ov.num);
        if (!Number.isFinite(n) || n <= 0) return null;
        const row = { key: rowKey, label: def.label, kind: 'number', num: n };
        if (def.unit) row.unit = def.unit;
        return row;
    }
    if (def.kind === 'select') {
        const t = String(ov.text ?? '');
        if (!def.options.includes(t)) return null;
        return { key: rowKey, label: def.label, kind: 'select', text: t, options: def.options.slice() };
    }
    const t = String(ov.text ?? '');
    if (!t.trim()) return null;
    return { key: rowKey, label: def.label, kind: 'text', text: t };
}

/**
 * 这一条借用的来源（'' / 自己 / 不存在 / 停用 ⇒ null）。
 * ★ 2026-11-06（第八批第二批）：只借数值，不借正文 ✓
 */
function borrowedEntryOf(entry) {
    const id = String(entry?.borrowFrom || '');
    if (!id || !entry || id === entry.id) return null;
    try {
        const e = codexEntry(id);
        return (e && e.status === 'on' && e.id !== entry.id) ? e : null;
    } catch { return null; }
}

/**
 * 顺着「繁殖数据借用」链找这一行（**不查个人单独调**）。
 * 顺序：本条目填了就用本条目，空着看借的那条，借的那条也空着再往它的来源找。
 * 成环 / 太深 ⇒ 当没找到（不递归炸掉 ✓）。
 * @returns {{row:object|null, layer:'entry'|'borrow'|'', from:object|null}}
 */
export function resolveRowOf(entry, rowKey) {
    const seen = new Set();
    let cur = entry || null;
    let depth = 0;
    while (cur && depth < 12) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const r = rowOf(cur, rowKey);
        if (r && rowHasValue(r)) {
            return { row: r, layer: cur === entry ? 'entry' : 'borrow', from: cur };
        }
        cur = borrowedEntryOf(cur);
        depth++;
    }
    return { row: null, layer: '', from: null };
}

/** 文字类那一行（顺着借用链找，返回空串 = 没写） */
function resolveTextRow(entry, rowKey) {
    const hit = resolveRowOf(entry, rowKey);
    return { text: hit.row ? String(hit.row.text ?? '').trim() : '', layer: hit.layer, from: hit.from };
}

function pickRow(key, entry, rowKey, allowPerson = true) {
    if (allowPerson) {
        const p = personRowOf(key, rowKey);
        if (p) return { row: p, layer: 'person', from: null };
    }
    const hit = resolveRowOf(entry, rowKey);
    return { row: hit.row, layer: hit.layer, from: hit.from };
}

function rowPlain(row) {
    if (!row) return null;
    if (row.kind === 'range') return { min: row.min, max: row.max };
    if (row.kind === 'number') return { num: row.num };
    return { text: String(row.text ?? '') };
}

/**
 * 一项数值现在是什么、来自哪一层（界面读数用）。
 * @returns {{value:{min?:number,max?:number,text?:string}, layer:string, entry:object|null}|null}
 */
export function codexValueOf(key, rowKey, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    const hit = pickRow(key, entry, rowKey, true);
    if (!hit.row) return null;
    return { value: rowPlain(hit.row), layer: hit.layer, entry };
}

/**
 * ★ 2026-11-08（规则剥离第一步）：这一族的「周期长度 / 排卵日」平均值。
 *
 * 三层跟别的数值一样：个人单独调 > 这一条 > 借用链（`pickRow` 自己会走 ✓）。
 * 空着 ⇒ 返回 null / 那一半 null，调用方（settings.bodyCycleParamsOf）退回全局 28 / 14。
 * ⚠️ 空着**不代表**这一族没有周期：有没有周期由「周期模式」三档管 ✓
 */
export function readCycleParamsOf(key, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    if (!entry) return null;
    const pick = (rowKey) => {
        const hit = pickRow(key, entry, rowKey, true);
        if (!hit.row) return null;
        const n = Number(hit.row.num);
        return Number.isFinite(n) && n > 0 ? { n: Math.round(n), layer: hit.layer } : null;
    };
    const c = pick('cycle_len');
    const o = pick('cycle_ovu');
    if (!c && !o) return null;
    return { cycle: c ? c.n : null, ovu: o ? o.n : null, layer: (c || o).layer };
}

// 注册给 settings.js（那边不能 import 这里，会成环 ✓）
setCodexCycleReader((key) => readCycleParamsOf(key));

/**
 * ★ 2026-11-08：这个对象是不是「交配后排卵」（兔 / 猫这类）。
 *   读图鉴条目的「排卵方式」那一格；认不出就看老存档的 cycle_ovu 空不空？
 *   —— 不，不做那个推断：空着就是按周期（她定过「空着 = 跟全局」，别偷偷改语义 ✗）
 */
export function readOvuModeOf(key, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    if (!entry) return 'cyclic';
    const hit = pickRow(key, entry, 'ovu_mode', true);
    const v = hit.row ? String(hit.row.text || '').trim() : '';
    return v === '交配后排卵' ? 'induced' : 'cyclic';
}

// ---------------------------------------------------------------------------
// ★ 2026-11-08（发情期第 0 批）：发情期四格
// ---------------------------------------------------------------------------

/**
 * 「发情季节」那一格读成区间表（**一年里的位置**，0~1 的比例）。
 *
 * 为什么不用月份序号：历法可以自定义（一年几个月、每月几天都能改）⇒
 *   存「第几月」换个历法就错位；存比例则换个历法照样落在同一段时间里 ✓
 * @returns {Array<[number,number]>|null} null ＝ 没填（＝全年发情）/ 读不出
 */
export function parseSeasonRanges(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    let arr;
    try { arr = JSON.parse(s); } catch { return null; }
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const x of arr) {
        if (!Array.isArray(x) || x.length < 2) continue;
        const a = Number(x[0]);
        const b = Number(x[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = Math.max(0, Math.min(1, a));
        const hi = Math.max(0, Math.min(1, b));
        if (hi > lo) out.push([lo, hi]);
    }
    if (!out.length) return null;
    out.sort((p, q) => p[0] - q[0]);
    return out;
}

/** 区间表写回那一格（空表 ⇒ 空串 = 全年） */
export function seasonRangesText(ranges) {
    const list = Array.isArray(ranges) ? ranges : [];
    const clean = list
        .map((x) => [Number(x?.[0]), Number(x?.[1])])
        .filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0])
        .map((x) => [Math.max(0, Math.min(1, x[0])), Math.max(0, Math.min(1, x[1]))])
        .sort((a, b) => a[0] - b[0]);
    if (!clean.length) return '';
    return JSON.stringify(clean.map((x) => [Number(x[0].toFixed(6)), Number(x[1].toFixed(6))]));
}

/**
 * 这一族有没有发情期、多久一次、一次几天、一年里哪几个月。
 * 三层跟别的数值一样：个人单独调 > 这一条 > 借用链（`pickRow` 自己会走 ✓）。
 * ⚠️ 只认「有」；「无」与空着都等于不发（发情期**没有全局默认**，她定的按原型来 ✓）
 * @returns {{on:boolean, cycle:[number,number]|null, days:[number,number]|null, season:Array<[number,number]>|null}|null}
 */
export function readEstrusOf(key, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    if (!entry) return null;
    const hit = pickRow(key, entry, 'estrus', true);
    const txt = hit.row ? String(hit.row.text || '').trim() : '';
    if (!txt) return null;
    const on = txt === '有';
    const rangeOf = (rowKey) => {
        const h = pickRow(key, entry, rowKey, true);
        if (!h.row) return null;
        const a = Number(h.row.min);
        const b = Number(h.row.max);
        const lo = Number.isFinite(a) ? a : null;
        const hi = Number.isFinite(b) ? b : null;
        if (lo === null && hi === null) return null;
        const x = lo === null ? hi : lo;
        const y = hi === null ? lo : hi;
        return [Math.min(x, y), Math.max(x, y)];
    };
    const sh = pickRow(key, entry, 'estrus_season', true);
    return {
        on,
        cycle: rangeOf('estrus_cycle'),
        days: rangeOf('estrus_days'),
        season: parseSeasonRanges(sh.row ? sh.row.text : ''),
    };
}

// 注册给 settings.js（那边不能 import 图鉴这一族，会成环 ✓）
setCodexEstrusReader((key) => readEstrusOf(key));

/** 诱导排卵的两个区间（发生率 % / 延迟 小时）；没填的给空数组，settings 那边补默认 */
export function readInducedParamsOf(key, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    if (!entry) return null;
    const pick = (rowKey) => {
        const hit = pickRow(key, entry, rowKey, true);
        if (!hit.row) return null;
        const min = Number(hit.row.min);
        const max = Number(hit.row.max);
        const a = Number.isFinite(min) ? min : null;
        const b = Number.isFinite(max) ? max : null;
        if (a === null && b === null) return null;
        return [a === null ? b : a, b === null ? a : b];
    };
    return { rate: pick('ovu_rate') || [], delay: pick('ovu_delay') || [] };
}

cycleHooks.ovuMode = (key) => readOvuModeOf(key);
cycleHooks.inducedParams = (key) => readInducedParamsOf(key);

/**
 * ★ 2026-11-08：身体补丁那行「种族」输出成**有效名字** ——
 *   图鉴条目名（绑定的 / 按名字对上的）> 推演报的种族 > 空（空 = 正文那行原样）。
 * 目的：图鉴里改了名字 / 直接绑定了一条，提示词里那行不会还写着旧名字 ✓
 */
setBodyRaceReader((key) => {
    try {
        const e = codexEntryOf(key);
        if (e) return e.name;
    } catch { /* 忽略 */ }
    try { return String(raceJudgeOf(key)?.race || '').trim(); } catch { return ''; }
});

function findHumanTwinText() {
    const h = humanEntry();
    return h ? rowTextOf(h, 'twin') : '';
}

// ---------------------------------------------------------------------------
// 判定要用的那几项
// ---------------------------------------------------------------------------

/** 刻度（天 / 周 / 月） */
export function readScaleOf(key, entryArg = null) {
    const entry = entryArg || codexEntryOf(key);
    const hit = pickRow(key, entry, 'scale', true);
    const scale = hit.row ? String(hit.row.text || '天') : '天';
    return { scale, layer: hit.layer || 'global' };
}

/**
 * 孕期（体内孕育优先，没有就看体外孵化）⇒ 天数区间。
 * @param {string} raceText 孩子那一族的名字（不同种族的孩子孕期不一样）
 */
export function readPregDaysOf(key, raceText = '') {
    const own = codexEntryOf(key);
    const byRace = entryForRace(raceText);
    const diffRace = !!(byRace && own && byRace.id !== own.id);
    const entry = diffRace ? byRace : (own || byRace || null);
    const allowPerson = !diffRace;
    const sc = pickRow(key, entry, 'scale', allowPerson);
    let scale = sc.row ? String(sc.row.text || '天') : '天';
    const inRow = pickRow(key, entry, 'preg_in', allowPerson);
    const outRow = pickRow(key, entry, 'preg_out', allowPerson);
    const use = rowHasValue(inRow.row) ? inRow : (rowHasValue(outRow.row) ? outRow : null);
    if (!use) return null;
    // ★ 2026-11-06：借来的值按**借来源那条的刻度**换算（两条的刻度可能不一样 ✓）
    if (use.layer === 'borrow' && use.from) scale = String(rowOf(use.from, 'scale')?.text || scale);
    const per = scale === '周' ? 7 : (scale === '月' ? 30 : 1);
    const a = use.row.min != null ? Number(use.row.min) : Number(use.row.max);
    const b = use.row.max != null ? Number(use.row.max) : Number(use.row.min);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.round(Math.min(a, b) * per);
    const hi = Math.round(Math.max(a, b) * per);
    return {
        lo, hi, text: fmtRange(Math.min(a, b), Math.max(a, b), scale),
        scale, layer: use.layer, entry,
    };
}

/**
 * ★ 2026-11-06（第五批）：这一族怎么生 —— 读条目上的「生育方式」那一行。
 *
 *   · `viviparous`：胎生（默认；没写 / 读不出都算这个，老行为一字不变 ✓）
 *   · `egg_out`  ：卵生（体外孵化）—— 体内孕育一段 ＋ 体外孵化一段，中间那天产卵
 *   · `egg_in`   ：卵生（体内孵化）—— 只有体内一段，出生在产卵那天（没有待孵）
 *
 * ⚠️ 按**孩子那一族**取（跟孕期同一个口径：化形不算，孩子是哪族就按哪族 ✓）
 */
export function readBirthModeOf(key, raceText = '') {
    const own = codexEntryOf(key);
    const byRace = entryForRace(raceText);
    const entry = byRace || own || null;
    if (!entry) return { mode: 'viviparous', text: '', layer: 'global', entry: null };
    const t = String(rowOf(entry, 'birth')?.text || '').trim();
    let mode = 'viviparous';
    if (/体内孵化/.test(t)) mode = 'egg_in';
    else if (/卵生/.test(t)) mode = 'egg_out';
    return { mode, text: t, layer: 'entry', entry };
}

/**
 * ★ 2026-11-06（第五批）：卵生那两段孕期（体内孕育 ＋ 体外孵化）⇒ 天数区间。
 *
 * 口径：
 *   · 单位跟着条目的「刻度」走（天 / 周 / 月，月按 30 天 ✓）
 *   · **两段少一段 ⇒ null**（体外孵化缺体内那一段就算不出产卵日；缺孵化那一段就没有待孵）——
 *     这时候调用方退回原来的单段孕期（老行为一字不变），等条目把两段都填好自动接上 ✓
 *     （宁可不接管，也不替她编一个"产卵日 ＝ 起点"）
 * @returns {{mode:'out'|'in', inLo:number, inHi:number, outLo:number, outHi:number,
 *            unit:string, scale:string, layer:string, entry:object|null}|null}
 */
export function readEggSpansOf(key, raceText = '') {
    const bm = readBirthModeOf(key, raceText);
    if (bm.mode === 'viviparous') return null;
    const entry = bm.entry || codexEntryOf(key) || null;
    const span = (hit) => {
        const r = hit.row;
        if (!r || (r.min == null && r.max == null)) return null;
        // ★ 借来的值按借来源那条的刻度换算
        const sc = String(rowOf(hit.from || entry, 'scale')?.text || '天');
        const per = sc === '周' ? 7 : (sc === '月' ? 30 : 1);
        const a = r.min != null ? Number(r.min) : Number(r.max);
        const b = r.max != null ? Number(r.max) : Number(r.min);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        const loN = Math.min(a, b);
        const hiN = Math.max(a, b);
        return {
            lo: Math.max(0, Math.round(loN * per)),
            hi: Math.max(0, Math.round(hiN * per)),
            text: fmtRange(loN, hiN, sc),
        };
    };
    const inS = entry ? span(resolveRowOf(entry, 'preg_in')) : null;
    const outS = (bm.mode === 'egg_in') ? { lo: 0, hi: 0, text: '' } : (entry ? span(resolveRowOf(entry, 'preg_out')) : null);
    // ★★ 2026-11-06（第五批）：**两段少一段就不接管** ——
    //   体外孵化缺「体内孕育」⇒ 算不出产卵日；缺「体外孵化」⇒ 没有待孵那一段。
    //   这时候退回原来的单段孕期（老行为一字不变），等她/图鉴内容那一批把两段都填好，
    //   这个功能会自动接上 ✓（宁可不接管，也不替她编一个"产卵日 ＝ 起点"）
    if (bm.mode === 'egg_in') {
        if (!inS) return null;
    } else if (!inS || !outS) {
        return null;
    }
    const unit = (entry ? resolveTextRow(entry, 'unit').text : '') || '枚';
    const parts = [];
    if (inS && inS.text) parts.push('体内 ' + inS.text);
    if (outS && outS.text) parts.push('孵化 ' + outS.text);
    return {
        mode: bm.mode === 'egg_in' ? 'in' : 'out',
        inLo: inS ? inS.lo : 0,
        inHi: inS ? inS.hi : 0,
        outLo: outS ? outS.lo : 0,
        outHi: outS ? outS.hi : 0,
        unit,
        scale: entry ? String(rowOf(entry, 'scale')?.text || '天') : '天',
        layer: 'entry', entry,
        // d6 那一格写什么（两段都写出来，玩家在面板上能看见 ✓）
        gestText: parts.join(' · '),
    };
}

/**
 * 显怀范围（第四批；2026-11-06 改成一条范围）：
 *   条目给「这一族最早到最晚第几周开始显怀」，个人可以单独调这个范围。
 *   没写 ⇒ 不接管（调用方照旧让模型按规则里的显怀模块判 ✓）。
 * @returns {{lo:number, hi:number, layer:string}|null}
 */
export function readShowWeeksOf(key) {
    const entry = codexEntryOf(key);
    const hit = pickRow(key, entry, 'show_weeks', true);
    if (!hit.row || hit.row.kind !== 'range') return null;
    const a = hit.row.min != null ? Number(hit.row.min) : Number(hit.row.max);
    const b = hit.row.max != null ? Number(hit.row.max) : Number(hit.row.min);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.max(1, Math.round(Math.min(a, b)));
    const hi = Math.max(lo, Math.round(Math.max(a, b)));
    return { lo, hi, layer: hit.layer };
}

/** 显怀五档（顺序就是界面上的顺序） */
export const SHOW_LEVELS = ['早', '偏早', '正常', '偏晚', '晚'];

/** 五档的分位线（2026-11-06 她定的；每条只占自己的区间，不许重叠） */
const SHOW_LEVEL_CUTS = [10, 30, 70, 90];

/** 这个周数落在哪一档（0 = 早 … 4 = 晚） */
export function showLevelOfWeek(lo, hi, week) {
    const a = Number(lo); const b = Number(hi); const w = Number(week);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(w)) return 2;
    if (b <= a) return 2;                       // 范围只有一个数 ⇒ 就是正常 ✓
    const p = ((w - a) / (b - a)) * 100;
    if (p <= SHOW_LEVEL_CUTS[0]) return 0;
    if (p <= SHOW_LEVEL_CUTS[1]) return 1;
    if (p <= SHOW_LEVEL_CUTS[2]) return 2;
    if (p <= SHOW_LEVEL_CUTS[3]) return 3;
    return 4;
}

/** 某一档里有哪些整周数（范围窄时可能一个都没有） */
export function showWeeksInLevel(lo, hi, level) {
    const out = [];
    for (let w = lo; w <= hi; w++) if (showLevelOfWeek(lo, hi, w) === level) out.push(w);
    return out;
}

/** 在某一档里随机挑一个整周数；这一档没有整周数就退到最近的档 */
export function showWeekForLevel(lo, hi, level) {
    const lv = Math.max(0, Math.min(4, Math.round(Number(level) || 0)));
    let got = showWeeksInLevel(lo, hi, lv);
    for (let d = 1; d <= 4 && !got.length; d++) {
        got = showWeeksInLevel(lo, hi, Math.max(0, lv - d))
            .concat(showWeeksInLevel(lo, hi, Math.min(4, lv + d)));
    }
    if (!got.length) got = [Math.round((lo + hi) / 2)];
    return got[Math.floor(Math.random() * got.length)];
}

/** 随机一档（五个档一样可能；第一次用到时才掷） */
export function randomShowLevel() {
    return Math.floor(Math.random() * 5);
}

/**
 * 这个人的显怀起点（周）。
 *   存过就用存的那个（体质，按人固定，换胎不重掷）；
 *   没存过 ⇒ 随机一档、在那一档里挑一个整周数，存下来。
 * @returns {{week:number, lo:number, hi:number, level:number, layer:string}|null}
 */
export function readShowWeekOf(key) {
    const r = readShowWeeksOf(key);
    if (!r) return null;
    let wk = 0;
    let manual = false;
    try { wk = Number(showWeekOf(key)) || 0; } catch { wk = 0; }
    try { manual = showWeekManualOf(key); } catch { manual = false; }
    // ★ 2026-11-06（她定的）：**用户本人默认「正常」**，其他角色才随机；
    //   玩家自己改过（manual）就一直听玩家的 ✓
    if (isUserKey(key) && !manual) {
        const def = showWeekForLevel(r.lo, r.hi, 2);
        if (def !== wk) {
            wk = def;
            try { setShowWeekOf(key, wk); } catch { /* 存不上也不影响这一轮 */ }
        }
    } else if (!(wk >= 1)) {
        wk = showWeekForLevel(r.lo, r.hi, randomShowLevel());
        try { setShowWeekOf(key, wk); } catch { /* 存不上也不影响这一轮 */ }
    }
    return { week: wk, lo: r.lo, hi: r.hi, level: showLevelOfWeek(r.lo, r.hi, wk), layer: r.layer };
}

/** 着床天数（条目 → 全局设置） */
export function readImplantDaysOf(key) {
    const entry = codexEntryOf(key);
    const hit = pickRow(key, entry, 'implant_days', true);
    if (rowHasValue(hit.row)) {
        const a = hit.row.min != null ? Number(hit.row.min) : Number(hit.row.max);
        const b = hit.row.max != null ? Number(hit.row.max) : Number(hit.row.min);
        if (Number.isFinite(a) && Number.isFinite(b)) {
            return { lo: Math.round(Math.min(a, b)), hi: Math.round(Math.max(a, b)), layer: hit.layer };
        }
    }
    // ★ 2026-11-07：上界放到 400（滞育族要走 130-170 天 ✓；默认仍是 6~10）
    let lo = 6;
    let hi = 10;
    try {
        const st = settings();
        lo = Math.max(1, Math.min(400, Math.round(Number(st.implantDaysMin) || 6)));
        hi = Math.max(lo, Math.min(400, Math.round(Number(st.implantDaysMax) || 10)));
    } catch { /* 读不到就用默认 6~10 */ }
    return { lo, hi, layer: 'global' };
}

/** 单位（胎 / 枚 / 只） */
export function readUnitOf(key) {
    const entry = codexEntryOf(key);
    const hit = pickRow(key, entry, 'unit', true);
    const unit = hit.row ? String(hit.row.text || '').trim() : '';
    return { unit: unit || '胎', layer: hit.layer || 'global' };
}

/**
 * 胎数分档：条目（「同人类」就跟着人类那条）⇒ 没有就 null（调用方退回规则正文）
 * @returns {{tiers:Array<{from:number,to:number,n:number}>, layer:string}|null}
 */
export function readLitterTiersOf(key) {
    const own = codexEntryOf(key);
    const p = personRowOf(key, 'litter');
    if (p && p.kind === 'text') {
        const t = parseLitterText(p.text);
        if (t.length) return { tiers: t, layer: 'person' };
    }
    const ownRow = own ? resolveTextRow(own, 'litter') : { text: '', layer: '' };
    const ownText = ownRow.text;
    const direct = parseLitterText(ownText);
    if (direct.length) return { tiers: direct, layer: ownRow.layer || 'entry' };
    if (/同人类/.test(ownText)) {
        const h = humanEntry();
        const ht = h ? parseLitterText(rowTextOf(h, 'litter')) : [];
        if (ht.length) return { tiers: ht, layer: 'human' };
    }
    return null;
}

/** 性别区间：条目 ⇒ 「同人类」⇒ null */
export function readSexRangesOf(key) {
    const own = codexEntryOf(key);
    const p = personRowOf(key, 'sex');
    if (p && p.kind !== 'range') {
        const r = parseSexText(p.text);
        if (r) return { ...r, layer: 'person' };
    }
    const ownRow = own ? resolveTextRow(own, 'sex') : { text: '', layer: '' };
    const ownText = ownRow.text;
    const direct = parseSexText(ownText);
    if (direct) return { ...direct, layer: ownRow.layer || 'entry' };
    if (/同人类/.test(ownText)) {
        const h = humanEntry();
        const hr = h ? parseSexText(rowTextOf(h, 'sex')) : null;
        if (hr) return { ...hr, layer: 'human' };
    }
    return null;
}

/**
 * ★ 2026-11-08：这一族喂不喂奶、是哪种奶。
 *
 * 判据只看条目里「泌乳」那一格（跟生育方式无关：卵生不等于没奶，鸭嘴兽卵生也产奶）。
 * 取值：'有（乳腺乳）' / '有（嗉囊乳这类）' / '无' / 空（按设定与剧情）。
 * 返回 { text, kind, layer }，kind：'milk' | 'crop' | 'none' | ''
 *   · milk ⇒ 照现在的产后泌乳那套写（参考量按天算）
 *   · crop ⇒ 喂雏是从嗉囊 / 食道反刍出来喂的，不是乳腺、没有按天算的奶量
 *   · none ⇒ 这一族不喂奶，d7 填「无」，不写哺乳与胀奶
 *   · ''   ⇒ 条目里没写，插件不替玩家编（正文按设定与剧情判）
 */
export function readMilkOf(key) {
    const own = codexEntryOf(key);
    if (!own) return { text: '', kind: '', layer: '' };
    const p = personRowOf(key, 'milk');
    if (p && p.kind !== 'range') {
        const t = String(p.text || '').trim();
        if (t) return { text: t, kind: milkKindOf(t), layer: 'person' };
    }
    const r = resolveTextRow(own, 'milk');
    const t = String(r.text || '').trim();
    return { text: t, kind: milkKindOf(t), layer: r.layer || 'entry' };
}

function milkKindOf(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (t === '无') return 'none';
    if (t.includes('嗉囊')) return 'crop';
    return 'milk';
}

/** 混血组：条目（或个人单独调）里写的那一格；空 = 只跟同族生 ✓ */
export function readBreedGroupOf(key) {
    const own = codexEntryOf(key);
    if (!own) return { group: '', layer: '' };
    const p = personRowOf(key, 'breedGroup');
    if (p && p.kind !== 'range') {
        const t = String(p.text || '').trim();
        if (t) return { group: t, layer: 'person' };
    }
    const r = resolveTextRow(own, 'breedGroup');
    return { group: String(r.text || '').trim(), layer: r.layer || 'entry' };
}

function breedGroupOfEntry(e) {
    if (!e) return '';
    try { return String(resolveTextRow(e, 'breedGroup').text || '').trim(); } catch { return ''; }
}

/** 品种：统称下面是品种时才有值；空 = 统称的通用形态 ✓ */
export function readBreedOf(key) {
    const own = codexEntryOf(key);
    if (!own) return { breed: '', layer: '' };
    const p = personRowOf(key, 'breed');
    if (p && p.kind !== 'range') {
        const t = String(p.text || '').trim();
        if (t) return { breed: t, layer: 'person' };
    }
    const r = resolveTextRow(own, 'breed');
    return { breed: String(r.text || '').trim(), layer: r.layer || 'entry' };
}

function breedOfEntry(e) {
    if (!e) return '';
    try { return String(resolveTextRow(e, 'breed').text || '').trim(); } catch { return ''; }
}

/**
 * ★ 2026-11-08（她定的）：**混血产物**也要进池子。
 *
 * 起因：半精灵是人和精灵的混血 —— 光有条目不行，池子里不加它，人类 × 精灵永远掷不出半精灵 ✗
 * 口径：一条规则 = 孩子那一条 ＋ 父母两边各自的编号（任一侧对得上就行）；孩子权重 1，
 *   父母各 2 ⇒ 人类 × 精灵 = 40% / 40% / 20%（半精灵）。
 * ⚠️ 以后有别的混血族（半矮人、半兽人…）往这张表里加一条就行，别改判定逻辑 ✓
 */
const HYBRID_RULES = [
    {
        child: 'bi-half-elf',
        a: ['bi-human'],
        b: ['bi-elf', 'bi-elf-high', 'bi-elf-dark', 'bi-elf-wood'],
    },
];

/**
 * 孩子种族的候选池（2026-11-07 她定的）：父母各 2 份，同组同品种的其他成员各 1 份。
 * · 父母同族 ⇒ null（不用掷）
 * · 统称的通用形态（品种空）⇒ 只和同组、品种也空的成员混
 * · 具体品种 ⇒ 只和同一品种的成员混，不会凭空出别的品种
 * · 跨组 / 没有组 ⇒ 只算父母两个
 * · 混血产物（半精灵这种）按 HYBRID_RULES 加一份 ⇒ 父母跨族也能生出混血 ✓
 */
export function mixedRacePoolOf(motherKey, fatherKey) {
    return mixedRacePoolOfEntries(codexEntryOf(motherKey), codexEntryOf(fatherKey), {
        mg: readBreedGroupOf(motherKey).group, fg: readBreedGroupOf(fatherKey).group,
        mb: readBreedOf(motherKey).breed, fb: readBreedOf(fatherKey).breed,
    });
}

/** 按条目直接算（界面预览用，不需要绑定对象 ✓） */
export function mixedRacePoolOfEntries(m, f, own = null) {
    if (!m || !f) return null;
    if (m.id === f.id) return null;
    const mg = own ? own.mg : breedGroupOfEntry(m);
    const fg = own ? own.fg : breedGroupOfEntry(f);
    const mb = own ? own.mb : breedOfEntry(m);
    const fb = own ? own.fb : breedOfEntry(f);
    const map = new Map();
    const put = (e, w) => {
        if (!e || e.status !== 'on') return;
        const cur = map.get(e.id);
        if (!cur || w > cur.weight) map.set(e.id, { entry: e, weight: w });
    };
    put(m, 2); put(f, 2);
    // ★ 只扩展同一品种层：通用形态不拉具体品种，具体品种也不拉别的品种 ✓
    const expand = (g, b) => {
        if (!g) return;
        for (const e of codexEntries()) {
            if (e.status !== 'on') continue;
            if (breedGroupOfEntry(e) !== g) continue;
            if (breedOfEntry(e) !== String(b || '')) continue;
            put(e, 1);
        }
    };
    if (mg && fg) {
        // ★ 跨组只在父母两个里选（她 2026-11-07 的口径）；同组才按各自品种层扩展 ✓
        if (mg === fg) { expand(mg, mb); expand(fg, fb); }
    } else if (mg) expand(mg, mb);
    else if (fg) expand(fg, fb);
    // ★ 混血产物（半精灵这种）：父母跨族也进池子，权重 1 ✓
    for (const r of HYBRID_RULES) {
        const hit = (r.a.includes(m.id) && r.b.includes(f.id))
            || (r.b.includes(m.id) && r.a.includes(f.id));
        if (!hit) continue;
        let c = null;
        try { c = codexEntry(r.child); } catch { c = null; }
        if (c) put(c, 1);
    }
    return [...map.values()];
}

/** 同卵 / 异卵：条目 ⇒ 「同人类」⇒ null；`{none:true}` = 这一族明确不判 */
export function readOvumOf(key) {
    const own = codexEntryOf(key);
    const p = personRowOf(key, 'twin');
    const ownTwin = own ? resolveTextRow(own, 'twin') : { text: '', layer: '' };
    const cands = [];
    if (p && p.kind !== 'range') cands.push({ text: p.text, layer: 'person' });
    if (own) cands.push({ text: ownTwin.text, layer: ownTwin.layer || 'entry' });
    for (const c of cands) {
        if (!String(c.text || '').trim()) continue;
        const r = parseTwinText(c.text);
        if (!r) continue;
        if (r.none) return { none: true, layer: c.layer };
        if (r.same) return { same: r.same, diff: r.diff, layer: c.layer };
    }
    const ownText = ownTwin.text;
    if (/同人类/.test(ownText)) {
        const hr = parseTwinText(findHumanTwinText());
        if (hr && hr.same) return { same: hr.same, diff: hr.diff, layer: 'human' };
    }
    return null;
}

/** 混合胎：条目 ⇒ 「同人类」⇒ null */
export function readMixOf(key) {
    const own = codexEntryOf(key);
    const p = personRowOf(key, 'twin');
    const ownTwin = own ? resolveTextRow(own, 'twin') : { text: '', layer: '' };
    const cands = [];
    if (p && p.kind !== 'range') cands.push({ text: p.text, layer: 'person' });
    if (own) cands.push({ text: ownTwin.text, layer: ownTwin.layer || 'entry' });
    for (const c of cands) {
        const r = parseTwinText(c.text);
        if (!r) continue;
        if (r.none) return { none: true, layer: c.layer };
        if (r.mixed) return { mixed: r.mixed, layer: c.layer };
    }
    const ownText = ownTwin.text;
    if (/同人类/.test(ownText)) {
        const hr = parseTwinText(findHumanTwinText());
        if (hr && hr.mixed) return { mixed: hr.mixed, layer: 'human' };
    }
    return null;
}

/** 胎数数值 ⇒ 几个孩子（读不出 ⇒ 0） */
export function readCountOf(key, value) {
    const t = readLitterTiersOf(key);
    const v = Number(value);
    if (!t || !Number.isFinite(v)) return { n: 0, layer: t ? t.layer : '' };
    const hit = t.tiers.find((r) => v >= r.from && v <= r.to);
    return { n: hit ? hit.n : 0, layer: t.layer };
}

/**
 * 发育段（第四批）：条目里那几段「起始刻度 + 一句话」⇒ 按孕周取的那张表。
 *
 * 只认写得出「孕 X 到 Y 周」的段；写月的（人外那 12 到 15 个月）这一批读不出 ⇒ 空，
 * 调用方照旧让模型按自己的规则写（宁可不接管，也不瞎猜 ✓）。
 * @returns {{stages:Array<{from:number,to:number,desc:string}>, entry:object|null}}
 */
export function readDevStagesOf(key, raceText = '') {
    const own = codexEntryOf(key);
    const byRace = entryForRace(raceText);
    const entry = byRace || own || null;
    if (!entry) return { stages: [], entry: null };
    const stages = [];
    for (const s of (entry.stages || [])) {
        const at = String(s?.at || '');
        const m = at.match(/孕\s*(\d+)\s*[-–—~～至到]\s*(\d+)\s*周/);
        if (!m) continue;
        const desc = String(s?.text || '').trim();
        if (!desc) continue;
        const from = Number(m[1]);
        const to = Number(m[2]);
        if (!(to >= from)) continue;
        stages.push({ from, to, desc });
    }
    return { stages, entry };
}

// ---------------------------------------------------------------------------
// 影子比对：条目这边 vs 原来那边（规则正文 / 全局设置 / d6 里写的）
// ---------------------------------------------------------------------------

function fmtTiers(tiers, unit = '胎') {
    if (!tiers || !tiers.length) return '（没有）';
    return tiers.map((t) => t.from + '-' + t.to + ' ' + t.n + unit).join('，');
}

function fmtSex(r) {
    if (!r) return '（没有）';
    if (r.none) return '不分性别';
    return r.male[0] + '-' + r.male[1] + ' ' + (r.maleLabel || '男') + '，'
        + r.female[0] + '-' + r.female[1] + ' ' + (r.femaleLabel || '女');
}

function fmtPair(p) {
    if (!p) return '（没有）';
    return p[0] + '-' + p[1];
}

function oldTiersOf(key) {
    try { return fetusCountTableOf(key) || []; } catch { return []; }
}

/**
 * 一个对象的影子比对。
 * @param {string} key
 * @param {{judged?:boolean}} opt judged=false ⇒ 这条走人外表，第三批不接管（只比孕期）
 */
export function shadowOf(key, opt = {}) {
    const judged = opt.judged !== false;
    const own = codexEntryOf(key);
    const noEntryNote = own ? '' : '这个对象还没对上图鉴条目，仍在用原来那份';
    const items = [];
    const push = (label, entry, old, same, note = '', warn = false) => {
        items.push({ label, entry, old, same, note: note || noEntryNote, warn });
    };

    // ① 孕期：逐个孩子按「孩子那一族」比（条目 vs d6 里模型写的）
    let kids = [];
    try { kids = parseFetus(state().targets?.[key]?.profile?.d6 || '').kids || []; } catch { kids = []; }
    if (kids.length) {
        kids.forEach((k, i) => {
            const race = String(k.race || '').trim();
            // ★ 2026-11-06（第五批）：卵生那两段单独比（体内 ＋ 孵化，d6 里也写这两段 ✓）
            const egg = race ? readEggSpansOf(key, race) : null;
            const pr = race ? readPregDaysOf(key, race) : null;
            const od = parseGestDaysText(k.gest);
            const who = '孕期 · 子' + (i + 1) + (race ? '（' + race + '）' : '');
            const oldTxt = String(k.gest || '').trim();
            if (egg) {
                const same = String(egg.gestText || '') === oldTxt;
                push(who, egg.gestText + '（' + egg.inLo + '-' + egg.inHi + ' 体内 ＋ '
                    + egg.outLo + '-' + egg.outHi + ' 孵化 天）',
                    oldTxt || '（d6 没写）', same,
                    same ? '' : '两段孕期（体内 ＋ 孵化）写在 d6 那一格的两个分段里');
                return;
            }
            if (!pr) {
                push(who, '（这一条没写孕期）', oldTxt || '（d6 也没写）', true, '没有可读的值，仍按 d6 里写的算');
                return;
            }
            if (!od) {
                push(who, pr.text, '（d6 没写）', true, '这一条补上了 d6 里缺的孕期');
                return;
            }
            const same = pr.lo === od.lo && pr.hi === od.hi;
            push(who, pr.text + '（' + pr.lo + '-' + pr.hi + ' 天）',
                oldTxt + '（' + od.lo + '-' + od.hi + ' 天）', same);
        });
    } else {
        push('孕期', '（还没判出孩子）', '—', true);
    }

    // ② ~ ⑤ 胎数 / 性别 / 同卵 / 混合：只有插件真接管的那条路才比
    if (judged) {
        const unit = readUnitOf(key).unit;
        const ownLitterText = own ? resolveTextRow(own, 'litter').text : '';
        const rl = readLitterTiersOf(key);
        const ol = oldTiersOf(key);
        if (rl) {
            push('胎数分档', fmtTiers(rl.tiers, unit) + '（' + layerText(rl.layer) + '）', fmtTiers(ol, '胎') + '（规则正文）',
                JSON.stringify(rl.tiers) === JSON.stringify(ol));
        } else if (String(ownLitterText || '').trim()) {
            push('胎数分档', '（这一条写了，但读不出来）', fmtTiers(ol, '胎') + '（规则正文）', false,
                '改写成一格一格的区间（1-78 单胎…）才读得出', true);
        } else {
            push('胎数分档', '（这一条没写）', fmtTiers(ol, '胎') + '（规则正文）', true, '空着 = 仍用规则正文');
        }

        const ownSexText = own ? resolveTextRow(own, 'sex').text : '';
        const rs = readSexRangesOf(key);
        const os = (() => { try { return fetusSexRangeOf(key); } catch { return null; } })();
        if (rs && rs.none) {
            push('性别区间', '不分性别（' + layerText(rs.layer) + '）', fmtSex(os) + '（规则正文）', false,
                '条目说这一族不分性别 ⇒ 插件不掷性别');
        } else if (rs) {
            push('性别区间', fmtSex(rs) + '（' + layerText(rs.layer) + '）', fmtSex(os) + '（规则正文）',
                !!os && rs.male[0] === os.male[0] && rs.male[1] === os.male[1]
                && rs.female[0] === os.female[0] && rs.female[1] === os.female[1]);
        } else if (String(ownSexText || '').trim()) {
            push('性别区间', '（这一条写了，但读不出来）', fmtSex(os) + '（规则正文）', false,
                '写成「1-50 男，51-100 女」这种才读得出', true);
        } else {
            push('性别区间', '（这一条没写）', fmtSex(os) + '（规则正文）', true, '空着 = 仍用规则正文');
        }

        const ownTwinText = own ? resolveTextRow(own, 'twin').text : '';
        const ro = readOvumOf(key);
        const oo = (() => { try { return fetusOvumRangeOf(key); } catch { return null; } })();
        if (ro && ro.none) {
            push('同卵 / 异卵', '这一族不判（' + layerText(ro.layer) + '）', oo ? ('同卵 ' + fmtPair(oo.same) + '，异卵 ' + fmtPair(oo.diff)) : '（没有）', false,
                '条目说这一族不掷同卵 ⇒ 插件不掷');
        } else if (ro) {
            push('同卵 / 异卵', '同卵 ' + fmtPair(ro.same) + '，异卵 ' + fmtPair(ro.diff) + '（' + layerText(ro.layer) + '）',
                oo ? ('同卵 ' + fmtPair(oo.same) + '，异卵 ' + fmtPair(oo.diff)) : '（没有）',
                !!oo && ro.same[0] === oo.same[0] && ro.same[1] === oo.same[1]
                && ro.diff[0] === oo.diff[0] && ro.diff[1] === oo.diff[1]);
        } else if (String(ownTwinText || '').trim()) {
            push('同卵 / 异卵', '（这一条写了，但读不出来）', oo ? ('同卵 ' + fmtPair(oo.same)) : '（没有）', false,
                '写成「1-33 同卵，34-100 异卵」这种才读得出', true);
        } else {
            push('同卵 / 异卵', '（这一条没写）', oo ? ('同卵 ' + fmtPair(oo.same)) : '（没有）', true, '空着 = 仍用规则正文');
        }

        const rm = readMixOf(key);
        const om = (() => { try { return fetusMixRangeOf(key); } catch { return null; } })();
        if (rm) {
            push('混合胎', fmtPair(rm.mixed) + '（' + layerText(rm.layer) + '）', om ? fmtPair(om.mixed) + '（规则正文）' : '（没有）',
                !!om && rm.mixed[0] === om.mixed[0] && rm.mixed[1] === om.mixed[1]);
        } else if (String(ownTwinText || '').trim() && !/不判/.test(ownTwinText) && !/同人类/.test(ownTwinText)) {
            push('混合胎', '（这一条没写混合那一段）', om ? fmtPair(om.mixed) + '（规则正文）' : '（没有）', true, '空着 = 不混合');
        }
    }

    // ⑥ 着床天数：条目 vs 全局设置
    const ri = readImplantDaysOf(key);
    const st = (() => { try { return settings(); } catch { return {}; } })();
    const gLo = Math.round(Number(st.implantDaysMin) || 6);
    const gHi = Math.round(Number(st.implantDaysMax) || 10);
    push('着床天数', ri.lo + '-' + ri.hi + ' 天（' + layerText(ri.layer) + '）', gLo + '-' + gHi + ' 天（全局设置）',
        ri.lo === gLo && ri.hi === gHi);

    // ⑦ 单位与刻度（原来只在规则正文里当文字用，没有可比的数）
    const ru = readUnitOf(key);
    const rs2 = readScaleOf(key);
    push('单位', ru.unit + '（' + layerText(ru.layer) + '）', '（原来写死在规则里）', true);
    push('刻度', rs2.scale + '（' + layerText(rs2.layer) + '）', '（原来写死在规则里）', true);

    return {
        key,
        own,
        judged,
        items,
        diffs: items.filter((x) => !x.same).length,
        dataWarns: items.filter((x) => x.warn).length,
    };
}

const _shadowSig = new Map();

/**
 * 判定真的用了这些值时调一次：有差异就在控制台报一条（同一个差异只报一次）。
 * 不弹提示：这是给排查用的，不该打扰玩家 ✓
 */
export function shadowLog(key) {
    try {
        const rep = shadowOf(key);
        const bad = rep.items.filter((x) => !x.same);
        if (!bad.length) return 0;
        const sig = bad.map((x) => x.label + '=' + x.entry + '|' + x.old).join('§');
        if (_shadowSig.get(key) === sig) return 0;
        _shadowSig.set(key, sig);
        console.warn('[Bodycord] 影子比对有差异（' + (key || '?') + '）：'
            + bad.map((x) => x.label + ' 条目=' + x.entry + ' / 原来=' + x.old).join('；'));
        return bad.length;
    } catch { return 0; }
}
