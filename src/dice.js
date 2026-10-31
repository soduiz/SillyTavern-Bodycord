/**
 * dice.js —— 骰子
 *
 * 两种模式：
 *
 *  【池模式 · 默认】「用得上才用」
 *    插件每轮生成一组随机数（R 池 1-100、S 池 1-5），全部编号登记。
 *    推演引擎在**本轮确实触发判定**时才按顺序取用，没触发就不取，
 *    并且必须回报「哪个判定用了哪个编号」。
 *    这样既不是固定掷 8 颗，也不是 AI 自己编 —— 随机性由插件提供，用多少由 AI 决定。
 *
 *  【清单模式】老行为：你自己指定要哪几颗骰子，插件照着掷。
 *
 * 名字沿用最初那套 D100_1 ~ D100_7 / D5，所以模块文案里写的
 * 「优先读取系统注入的 D100_1」依然对得上，不用改规则。
 */

import {
    diceValues, setDiceValue, clearDiceValues,
    poolLocked, setPoolLocked, rollPool, setRollPool, lastRollUsage, setLastRollUsage,
} from './store.js';
import { settings, save, fetusOvumRangeOf } from './settings.js';

// ---------------------------------------------------------------------------
// 池模式
// ---------------------------------------------------------------------------

export function poolMode() {
    return settings().dice?.mode !== 'list';
}

const rnd = (n) => Math.floor(Math.random() * n) + 1;

/** 生成一组随机数，登记编号 */
export function generatePool() {
    const s = settings();
    const n = Math.max(4, Math.min(40, Number(s.dice?.poolSize) || 14));
    const m = Math.max(1, Math.min(10, Number(s.dice?.smallSize) || 4));
    const R = [];
    const S = [];
    for (let i = 0; i < n; i++) R.push(rnd(100));
    for (let i = 0; i < m; i++) S.push(rnd(5));
    return { R, S, at: Date.now() };
}

export function currentPool() {
    return rollPool();
}

export function rerollPool() {
    const p = generatePool();
    setRollPool(p);
    setLastRollUsage(null);
    return p;
}

export function clearPool() {
    setRollPool(null);
    setLastRollUsage(null);
    setPoolLocked(false);
}

export function isLocked() { return poolLocked(); }
export function lock(v) { setPoolLocked(!!v); }

// ---------------------------------------------------------------------------
// 清单模式（老的固定骰子）
// ---------------------------------------------------------------------------

export const DICE_PRESETS = [
    { id: 'D100_1', label: '受精判定', expr: '1d100', note: '与当轮累计受孕率比较' },
    { id: 'D5', label: '着床天数', expr: '1d5', note: '着床天数现在由插件在可调区间里直接掷（默认 6~10 天）；这一项只留着手动掷' },
    { id: 'D100_2', label: '胎数判定', expr: '1d100', note: '按种族表换算胎数' },
    { id: 'D100_3', label: '子1性别', expr: '1d100', note: '1-50 男，51-100 女' },
    { id: 'D100_4', label: '子2性别', expr: '1d100', note: '多胎时逐个判定' },
    { id: 'D100_5', label: '子3性别', expr: '1d100', note: '多胎时逐个判定' },
    { id: 'D100_6', label: '子4性别', expr: '1d100', note: '多胎时逐个判定' },
    { id: 'D100_7', label: '整批性别倾向', expr: '1d100', note: '胎数≥5 的卵生/虫族/鱼类使用' },
];

export const DEFAULT_DICE = ['D100_1', 'D5', 'D100_2', 'D100_3'];
export const IMPLANT_DAYS = { 1: 6, 2: 7, 3: 8, 4: 9, 5: 10 };

export function parseExpr(expr) {
    const m = String(expr || '').trim().match(/^(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?$/);
    if (!m) return null;
    const n = m[1] === '' ? 1 : parseInt(m[1], 10);
    const faces = parseInt(m[2], 10);
    const mod = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
    if (!n || !faces || n > 100 || faces > 100000) return null;
    return { n, faces, mod };
}

export function rollExpr(expr) {
    const p = parseExpr(expr);
    if (!p) return null;
    const detail = [];
    let total = 0;
    for (let i = 0; i < p.n; i++) {
        const v = Math.floor(Math.random() * p.faces) + 1;
        detail.push(v);
        total += v;
    }
    total += p.mod;
    return {
        value: total,
        detail,
        expr: `${p.n}d${p.faces}${p.mod ? (p.mod > 0 ? '+' + p.mod : String(p.mod)) : ''}`,
    };
}

function presetById(id) { return DICE_PRESETS.find(p => p.id === id) || null; }

function defs() {
    const s = settings();
    if (!Array.isArray(s.dice.entries) || !s.dice.entries.length) {
        s.dice.entries = DEFAULT_DICE.map(id => {
            const p = presetById(id);
            return { id: p.id, label: p.label, expr: p.expr };
        });
        save();
    }
    return s.dice.entries;
}

function saveDefs(list) {
    settings().dice.entries = list;
    save();
}

export function entries() {
    const vals = diceValues();
    return defs().map(d => ({
        ...d,
        value: vals[d.id]?.value ?? null,
        detail: vals[d.id]?.detail ?? null,
    }));
}

export function rollOne(id) {
    const d = defs().find(x => x.id === id);
    if (!d) return null;
    const r = rollExpr(d.expr);
    if (!r) return null;
    setDiceValue(id, { value: r.value, detail: r.detail });
    return r.value;
}

export function clearOne(id) { setDiceValue(id, null); }

export function fillEmpty() {
    let n = 0;
    for (const e of entries()) {
        if (e.value == null) {
            const r = rollExpr(e.expr);
            if (r) { setDiceValue(e.id, { value: r.value, detail: r.detail }); n++; }
        }
    }
    return n;
}

export function rollAll() {
    const list = entries();
    for (const e of list) {
        const r = rollExpr(e.expr);
        if (r) setDiceValue(e.id, { value: r.value, detail: r.detail });
    }
    return list.length;
}

export function clearAll() {
    clearDiceValues();
    setPoolLocked(false);
}

export function addEntry(id, label, expr) {
    const list = defs();
    const key = String(id || '').trim() || ('自定义' + (list.length + 1));
    if (list.some(x => x.id === key)) return false;
    list.push({ id: key, label: label || key, expr: expr || '1d100' });
    saveDefs(list);
    return true;
}

export function addPreset(id) {
    const list = defs();
    if (list.some(x => x.id === id)) return false;
    const p = presetById(id);
    if (!p) return false;
    list.push({ id: p.id, label: p.label, expr: p.expr });
    saveDefs(list);
    return true;
}

export function removeEntry(id) {
    saveDefs(defs().filter(x => x.id !== id));
    setDiceValue(id, null);
}

export function updateEntry(id, patch) {
    const list = defs();
    const e = list.find(x => x.id === id);
    if (!e) return;
    if ('label' in patch) e.label = patch.label;
    if ('expr' in patch) e.expr = patch.expr;
    saveDefs(list);
}

export function missingPresets() {
    const have = new Set(defs().map(x => x.id));
    return DICE_PRESETS.filter(p => !have.has(p.id));
}

// ---------------------------------------------------------------------------
// 推演前取骰
// ---------------------------------------------------------------------------

/**
 * - 池模式：锁定了就沿用；否则每轮新生成一组随机数
 * - 清单模式：锁定了就沿用；否则按设置补空位（或只用手动掷的）
 */
export function acquirePool() {
    if (poolMode()) {
        if (isLocked()) {
            const p = currentPool();
            if (p) return p;
        }
        return rerollPool();
    }
    if (isLocked()) return entries();
    if (settings().dice.autoRoll !== false) {
        fillEmpty();
        return entries();
    }
    return entries();
}

// ---------------------------------------------------------------------------
// 拼给推演引擎看
// ---------------------------------------------------------------------------

function listPrompt(list) {
    const items = (list || entries()).filter(e => e.value != null);
    if (!items.length) {
        // ★★ 改口径：
        //   **原来这里写着「若推演中确实需要随机判定，请你按合理概率自行决定」** ✗
        //   —— 那等于**授权引擎自己编数字**，和池模式那句
        //   「只能从这里取用，严禁自己编造任何数字」**直接矛盾** ✗✗
        //   （清单模式 + 关掉「推演前自动把没掷的补上」+ 手上一个骰子都没掷 ⇒ 就会碰到这句）
        //   ⇒ 改成"没有骰值就别骰、并在 cot 里写明"，两处口径对齐 ✓
        //   ⚠️ 「本轮骰值」「没有掷任何骰子」这两个词**被测试断言钉着**
        //     ⇒ 保留这两个词，只换掉"授权自骰"那半句 ✓
        return '[本轮骰值]\n（本轮没有掷任何骰子，也没有可用的随机数池。本轮不要自行编造任何数字：'
            + '确实需要随机判定时，跳过该判定、不要给数值，并在 cot 里写明「本章无系统骰值」。）';
    }
    const lines = ['[本轮骰值 · 必须且只能使用以下数值，严禁自行编造]'];
    for (const e of items) {
        let extra = '';
        if (e.id === 'D5' && IMPLANT_DAYS[e.value]) extra = `（${e.value} 对应着床 ${IMPLANT_DAYS[e.value]} 天）`;
        else if (e.expr) extra = `（${e.expr}）`;
        lines.push(`- ${e.id} = ${e.value}　${e.label || ''}${extra}`);
    }
    // ★ 这里原来还有一句"已经锁定的判定结果必须沿用上一轮状态"——
    //   推演 system 的硬性要求第 3 条已经写着同一件事（judge.js），还是逐条列了那五项
    //   ⇒ 同一份提示里说两遍，删掉这里那一句 ✓（池模式那边也删了同一句）
    return lines.join('\n');}

function poolPromptText(pool) {
    const R = Array.isArray(pool?.R) ? pool.R : [];
    const S = Array.isArray(pool?.S) ? pool.S : [];
    const rLine = R.map((v, i) => `R${i + 1}=${v}`).join('，');
    const sLine = S.map((v, i) => `S${i + 1}=${v}`).join('，');

    return [
        '[本轮随机数池 · 只能从这里取用，严禁自己编造任何数字]',
        `一百面池（给 1-100 的判定用）：${rLine || '（空）'}`,
        `五面池（给 1-5 的判定用）：${sLine || '（空）'}`,
        '',
        '取用规则（重要）：',
        // ★ 这两条原来带 markdown 加粗（`**确实触发**` / `**不要取用**`）——
        //   骰值这一段是**真发给模型看的提示词**，加粗星号有被它照抄进 calc 的风险
        //   （契约与模块正文早就有"不许加粗"的硬规矩，池提示这一段是漏网的）⇒ 去掉星号 ✓
        //   并在 units 里补了一条"整份推演提示词里没有 **"的全量守卫 ✓
        '1. 只有当本轮确实触发了某个随机判定时，才从池里取一个值，用得上才用。',
        '2. 需要 1-100 的判定从「一百面池」按顺序取（第一个判定取 R1，第二个取 R2，依此类推）；需要 1-5 的从「五面池」取（一般只有着床天数会用到）。',
        '3. 本轮没触发的判定不要取用，也不要为了把数字用掉而硬凑一个判定出来。',
        // ★ 原来这里还有两条 ——
        //   「已经锁定的判定沿用旧值不重新取用」和「取用情况必须写进 rollsUsed（含例子）」。
        //   前者的原文在推演 system 的硬性要求第 3 条里（逐条列了同样那五项 ✓），
        //   后者的字段定义在契约的「关于 rollsUsed」那四条里（连编号格式与对账说明都全 ✓）
        //   ⇒ 两处都是同一份提示里说第二遍，删掉 ✓（跨文件断言盯着 rollsUsed 仍在契约里）
    ].join('\n');
}

export function poolPrompt(pool) {
    if (!pool) return poolPromptText({ R: [], S: [] });
    if (Array.isArray(pool)) return listPrompt(pool);          // 清单模式
    if (pool.R || pool.S) return poolPromptText(pool);          // 池模式
    return '';
}

/** 记录这一轮取用了哪些随机数
 *  ★ 多带一个 `by` —— **是谁掷的**：
 *    `'engine'` = 推演引擎按规则从池里取的（它自己在 rollsUsed 里报）
 *    `'plugin'` = 插件自己掷的（受精判定 / 着床判定 / 着床天数 / 精子存活 / 胎数判定 / 同卵判定 / 子N性别）
 *  ⇒ 骰子页上原来这两类混在一起显示，看着像"这一轮取了 5 个"，
 *    其实里面几颗是插件掷的 ✗ ⇒ 界面按 `by` 分开标 ✓
 */
export function recordUsage(used) {
    if (!Array.isArray(used)) return;
    setLastRollUsage(used.map(u => {
        const row = {
            for: String(u?.for ?? u?.slot ?? '').slice(0, 40),
            ref: String(u?.ref ?? u?.id ?? '').slice(0, 20),
            value: u?.value ?? null,
            by: (u?.by === 'plugin') ? 'plugin' : 'engine',
        };
        // ★ 2026-10-23：判定结果一起存（「同卵 / 异卵判定 → 异卵」「混合胎判定 → 混合（2+1）」）——
        //   原来这里把 result 丢了，于是骰子页只剩一个 89，会被读成"掷出来就是同卵" ✓
        if (u?.result) row.result = String(u.result).slice(0, 24);
        return row;
    }).filter(u => u.for || u.ref));
}

/**
 * 取用记账的**显示名** —— 历史名并到现名（记账里存的是当时那个名字，不会自己改）。
 * 例：旧记录的「同卵判定」→「同卵 / 异卵判定」✓
 */
const USED_DISPLAY_NAME = { '精子存活': '本次精子存活天数', '同卵判定': '同卵 / 异卵判定' };
export function usedNameOf(u) {
    const f = String(u?.for || '');
    return USED_DISPLAY_NAME[f] || f;
}

/**
 * 这一行要不要带一个结果（「89（异卵）」）——
 * 新记录自己带 `result`；旧记录只留了一个数 ⇒ 按同一行区间（1-33 同卵、34-100 异卵）回推。
 * 认不出区间就**不显示**，不瞎猜 ✓
 */
export function usedResultOf(u) {
    if (!u) return '';
    if (u.result) return String(u.result);
    if (!/同卵|异卵/.test(String(u.for || ''))) return '';
    const n = Number(u.value);
    if (!Number.isFinite(n)) return '';
    const r = fetusOvumRangeOf();
    if (!r) return '';
    if (n >= r.same[0] && n <= r.same[1]) return '同卵';
    if (n >= r.diff[0] && n <= r.diff[1]) return '异卵';
    return '';
}

export function getLastUsage() { return lastRollUsage(); }

/**
 * ★ 取用记账里的 `ref` 在界面上怎么写 —— **只换显示，不动记账本身**
 *
 * 为什么要有它：插件自己掷的那几颗，`ref` 存的是来源原句
 *   （`精子存活专用掷（1~7 天，均匀）`、`着床判定专用掷（1~100）`…）。
 *   骰子页那一行本来就只有 ref / 值 / 用途 三格，塞一句 17 个字的长句
 *   会把值挤到右边、还让"这一条到底是什么骰子"看不出来 ✗
 *
 * 口径：压成三类 —— 池格 `R3` / 预设 `预设 D5` / 独立掷 `独立掷 1~7`。
 *   ⚠️ **原文一个字都不丢**：调用方把原 `ref` 挂进 title，悬停照样能看到来路 ✓
 *   ⚠️ 别在这里改 `recordUsage()` —— 记账要留着原句给对账和导出看
 */
export function shortRef(ref) {
    const s = String(ref ?? '').trim();
    if (!s) return '—';
    let m;
    // 精子存活 / 孕期：范围均匀掷
    if ((m = s.match(/^(?:精子存活|孕期)专用掷（\s*(\d+\s*~\s*\d+)\s*天/))) return `独立掷 ${m[1]}`;
    // 精子存活 / 孕期：设置里最短=最长 ⇒ 固定值，不掷（两家来源的写法不一样：
    //   `精子存活专用（固定 4 天）` / `孕期固定（280 天）`，得分开匹配 ✓）
    if ((m = s.match(/^(?:精子存活专用（固定|孕期固定（)\s*(\d+)\s*天/))) return `固定 ${m[1]} 天`;
    // 着床判定：永远 1~100 的独立掷
    if ((m = s.match(/^着床判定专用掷（\s*([^）]+?)\s*）/))) return `独立掷 ${m[1]}`;
    // 预设丢了、走兜底
    if (/^兜底真随机$/.test(s)) return '独立掷';
    // 从池子取、但当时没记下格号（正常不会发生，防一手）
    if (/^随机数池\s*R$/i.test(s)) return '池内';
    // 池格 R3 / S1、预设 D5 / D100_1 ⇒ 本来就短，原样
    if (/^[RS]\d+$/i.test(s) || /^预设\s/.test(s)) return s;
    // 认不出的来源：别让它把行撑开
    return s.length > 10 ? s.slice(0, 9) + '…' : s;
}

/**
 * ★★ 把「只报了编号」的取用**补上值** —— 值不用模型写，插件按编号去池子里查。
 *
 * 为什么：池子本来就是插件发出去的（发出去时就是「R1 = 42」这种写法）⇒
 *   让模型把值再抄一遍纯属白花输出 token，抄错还会让对账误报 ✗
 * 口径：认不出的编号（清单模式的预设骰）原样留着，不添乱 ✓
 */
export function fillUsageValues(used, pool) {
    const p = pool || (() => { try { return currentPool(); } catch { return null; } })();
    if (!Array.isArray(used)) return [];
    return used.map((u) => {
        try {
            if (!u || typeof u !== 'object' || u.value != null) return u;
            const m = String(u.ref || '').match(/^([RS])(\d+)$/i);
            if (!m) return u;
            const arr = (m[1].toUpperCase() === 'R') ? (p?.R || []) : (p?.S || []);
            const i = Number(m[2]) - 1;
            return (i >= 0 && i < arr.length) ? { ...u, value: arr[i] } : u;
        } catch { return u; }
    });
}

/**
 * ★★ **核对"模型自报的取用"是不是真在池子里**（补的那后半）。
 *
 * 为什么需要它：契约要求模型把"我取了哪个编号"报回来（`rollsUsed`），插件照收，
 *   可**收进来一个字都不校验** ✗ ⇒ 模型要是根本没取、却编一条
 *   `{"for":"受精判定","ref":"R1","value":42}`，骰子页照样显示得像它真取了 ——
 *   等于"严禁自己编造"那条规矩只靠提示词，**缺一道机器检查** ✓
 *
 * 判据（**故意写得保守**）：
 *   · `by === 'plugin'`（插件自己掷的：受精判定 / 着床判定 / 着床天数 / 精子存活 / 胎数判定 / 同卵判定 / 子N性别）⇒ **不参与核对**
 *   · 编号不是 `R1 / S2` 这种池内编号（比如清单模式的 `预设 D100_1`）⇒ **不判**（返回 true）
 *   · 编号认得出、但**值对不上**或**池里根本没这个编号** ⇒ 返回 false ✓
 *
 * @returns {boolean} true = 这条和池子对得上（或本来就不该用池子核对）
 */
export function usageMatchesPool(usage, pool) {
    const hit = poolHitOf(usage, pool);
    return hit === null ? true : hit.ok;
}

/** 把一条记账解析成"它指的是池子哪一格"，返回 null = 不该按池子核 */
function poolHitOf(usage, pool) {
    try {
        if (!usage || typeof usage !== 'object') return null;
        // ★★ 修：**"是不是池格"一律看编号形状，不看 `by`** ✓
        //   原来这里有 `if (usage.by === 'plugin') return null` —— 那时"插件掷的"全是
        //   预设骰（`预设 D100_1` / `预设 D5`）＋ 纯随机（孕期 / 精子存活），确实不来自池子。
        //   但后来给「逐胎致孕方锁定」也打上了 `by: 'plugin'`（它**确实是从池里取的** ✓）
        //   ⇒ 留着那行的话，它既**不算占格**（`drawFromPool` 排除不掉 ⇒ 同一格会被取两次 ✗）
        //     又**不参与核对** ✗ ⇒ 两处都错。所以那行必须去掉：
        //     **`by` 只决定骰子页那个标签（插件掷 / 引擎取）；是不是池格只看编号** ✓
        const m = String(usage.ref || '').match(/^([RS])(\d+)$/i);
        if (!m) return null;                                    // 认不出池内编号 ⇒ 不冤枉它
        const arr = (m[1].toUpperCase() === 'R') ? (pool?.R || []) : (pool?.S || []);
        const idx = Number(m[2]) - 1;
        if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return { idx, arr: m[1].toUpperCase(), ok: false };
        return { idx, arr: m[1].toUpperCase(), ok: Number(arr[idx]) === Number(usage.value) };
    } catch { return null; }                                    // 核不了就别报假警 ✓
}

/**
 * ★★ **这一条占掉了池子里的哪一格？**（没占就返回 null）
 *
 * 拆出它是因为"排除谁"必须**和核对用同一套判据**：
 *   只有"编号和值都对得上"才算这一格被用掉了 ⇒ **模型瞎报的编号不会误占池格** ✓
 *   （反过来，值对不上的也不能算 —— 那正是"它编的"那种情况）
 */
export function poolSlotTakenBy(usage, pool) {
    try {
        const hit = poolHitOf(usage, pool);
        if (!hit || !hit.ok) return null;
        return hit.arr + (hit.idx + 1);                          // 规范成 'R3' / 'S1'
    } catch { return null; }
}

/** 给界面用的一句话预览 */
export function poolSummary() {
    if (poolMode()) {
        const p = currentPool();
        if (!p) return '尚未生成随机数池';
        const used = getLastUsage();
        return `${(p.R || []).length + (p.S || []).length} 个随机数已就绪` + (used?.length ? `　上轮取用 ${used.length} 个` : '');
    }
    const items = entries().filter(e => e.value != null);
    if (!items.length) return '尚未掷骰';
    return items.map(e => `${e.id}=${e.value}`).join('　');
}
