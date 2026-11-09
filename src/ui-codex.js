/**
 * ui-codex.js —— 「种族图鉴」设置页（设置 → 补丁与档案 → 种族图鉴）
 *
 * 这一页管什么（第一批）：
 *   列表、搜索、分类、详情、数值表、发育段、备注、复制、启停、恢复默认。
 *   导入导出排在第八批，不在这页；判定与提示词也还没读这里的数（第三批才接）✓
 *
 * 形态定下的几条：
 *   · 列表 → 详情**在同一页里换**（不弹窗：一条要编十几项，弹窗在手机上滚不动 ✗）
 *   · 打字**不重画**：只在列表 / 结构（加行、删行、换条目）变化时重画 ✓
 *   · 内置条目能改能停用，不能删；自建能删；改过的内置可以「恢复默认」✓
 */

import {
    h, button, section, textArea, textInput, numberInput, dropdown, checkRow, toggle,
        clear, askConfirm, askText, field, modal,
} from './dom.js';
import {
    CODEX_CATS, CODEX_SPECIES, codexCatLabel, codexSpeciesLabel, scaleOf, rowOf,
    SEX_ENUMS, SEX_LABELS, SEX_KEYS,
} from './codex-schema.js';
// ★ 2026-11-09：图鉴数据是用到才读进来的 —— 这页要先问"读进来了没"（builtinReady / ensureBuiltinCodex）
import {
    codexEntries, codexEntry, codexFilter, codexSave, codexCreate, codexDuplicate,
    codexRemove, codexSetStatus, codexReset, codexStats, onCodexSaved, codexSetStatusBySpecies, codexIsEdited,
    codexResetBySpecies, SPECIES_NONE_KEY,
    builtinReady, ensureBuiltinCodex,
} from './codex.js';
import {
    codexIdOf, setCodexIdOf, codexOverrideOf, setCodexOverride,
    chatBindings, codexUsageOf,
} from './codex-bind.js';
// ★ 第八批：图鉴自己的导入导出（只碰 settings().codex，不动角色与聊天数据 ✓）
import {
    codexExportPayload, codexExportText, parseCodexFile, planCodexImport, applyCodexImport,
} from './codex-io.js';
// ★ 第三批：影子比对（条目这边 vs 原来那边）与「改条目立刻重算预产期」
import { shadowOf, parseLitterText, parseSexText, parseTwinText, resolveRowOf, mixedRacePoolOfEntries, parseSeasonRanges, seasonRangesText } from './codex-values.js';
import { activeCalendar } from './fiction-date.js';
import { targetList, displayName, confirmTempRace, removeTempRace, setTempRace } from './store.js';
import { isXeno, codexTargets, codexNeedRepro } from './prompt.js';
import { settings, save } from './settings.js';
import { buildCodexPlan } from './codex-send.js';
import { formatTokens } from './tokens.js';
import { ensureGestationDates } from './judge.js';

/** 这一页自己的小状态（切走再切回来还在；重开面板就重置 ✓） */
let _q = '';
let _openId = '';
let _cat = '';
let _species = '';
/** 列表一页 20 条（2026-11-07 她定的：条目只会越来越多，不能一口气翻到底 ✓） */
const PAGE_SIZE = 20;
let _page = 1;

const HELP_LIST = [
    '这里是一份可以搜、可以分类的种族目录：名字、其他叫法、四段正文、一张数值表、几段发育描述',
    '找条目：先在上面选大类，种类那个下拉就只列这一类里的种类（带条数）；再选种类，列表就只剩那一族。两个都选「全部」就是整本图鉴',

    '判定读的是这里的数值：孕期、胎数分档、性别区间、同卵与混合、着床天数、单位与刻度',
    '这几项空着，就还是用原来那份（规则正文 / 设置页）；空着不等于 0',
    '这一轮在场的种族会把条目正文发给主 API（看下面「这一轮会发什么」：只发在场的，按阶段筛段）',
    '内置条目能改、能停用，不能删（改坏了点「恢复默认」）；自己新建的能删',
    '条目多了可以整族一起关：点「按种类批量停用」，点一行选一族（可以只选一族，也可以选好几族），再点确定，这些族的全部条目一起停用；也能一起开回来',
    '改多了也能整族一起恢复：点「按种类恢复默认」，同样点一行选一族，确定后这一族改过的内容回到内置默认（停用的也会一起开回来）',
    '编号是绑定的锚：改名不会断绑定，编号永远不变',
    '导入导出是图鉴自己的一套文件，只带你改过的和自建的条目，不进世界观档案；同一个编号内容不一样时，逐条让你挑保留哪边',
    '字数只数正文（四段加发育段），方便看这一族写了多少；数值表和备注不算',
    '「繁殖数据借用」只借数值，不借正文；空着的项从借来的那条读，自己填了的仍然用自己的',
];

const HELP_DETAIL = [
    '名字与其他叫法：推演里报别的名字也能对回这一条；撞到多条时会标「要你挑」',
    '分类只是目录用的标签，不参与判定',
    '数值表：一行一项，刻度（天 / 周 / 月）管着孕期与发育段怎么写；胎数 / 性别 / 同卵这三行不用写骰子区间，按栏目填几个数就行，区间插件自己折；显怀填这一族最早到最晚第几周；空着 = 判定仍用全局那份',
    '「繁殖数据借用」：只借数值，不借正文；空着的项从借来的那条读，自己填了的仍然用自己的。刻度 / 生育方式按这一条自己填，不跟着借',
    '发育段：每段「起始刻度 + 一句话」；一段都不填 = 这一族不生成生长描述，模型也不许编',
    '备注只给你自己看：不进提示词、不参与匹配',
];

const SEND_HELP = [
    '这一块算的是：这一轮发给主 API 的那段「种族设定」里到底会有哪几族、哪几段、多少字',
    '只发在场的种族：这一轮在场的那几个对象，各自绑定的那一条（没绑定就按名字 / 其他叫法对上的那一条）',
    '人类也走图鉴条目：人类数据要从规则里剥离，所以这里不因为「是人类」就不发；没有人类在场才不发',
    '按阶段筛：生理天天发；「生育」只在受孕、怀孕、待孵那几轮才带上；「补充」有就常驻',
    '「介绍（外貌）」默认不发：很多角色卡自己写了外貌，图鉴再发一份两处会打架；想要就打开上面那个开关',
    '名字对不上图鉴的种族：会发一份「每族一行」的种族目录，不会默认当人类，也不会替你借别的族的数据',
    '条目这段只给主 API（写正文的那个）；推演那边的种族数值走的是数值表，不走这段',
];

function statusBadges(entry) {
    const out = [];
    if (entry.builtin) out.push(h('span', { class: 'bc-badge', text: '内置' }));
    else out.push(h('span', { class: 'bc-badge bc-badge-edit', text: '自建' }));
    if (entry.builtin && entry.edited) out.push(h('span', { class: 'bc-badge bc-badge-edit', text: '改过' }));
    if (entry.status === 'off') out.push(h('span', { class: 'bc-badge bc-badge-lock', text: '停用' }));
    return out;
}

/**
 * ★ 第八批：字数统计。
 * 只数正文（四段 + 发育段的文字），空白不算；数值表、备注不数（它们不是发出去的主 API 正文）。
 */
function plainLen(s) {
    return String(s ?? '').replace(/\s+/g, '').length;
}

function textStatsOf(entry) {
    const intro = plainLen(entry.intro);
    const physio = plainLen(entry.physio);
    const repro = plainLen(entry.repro);
    const extra = plainLen(entry.extra);
    const stages = (entry.stages || []).reduce((n, s) => n + plainLen(s.at) + plainLen(s.text), 0);
    return { intro, physio, repro, extra, stages, total: intro + physio + repro + extra + stages };
}

function metaLine(entry) {
    // 分类＝两层：第一层 人类 / 动物 / 亚人 / 兽人，第二层 犬 / 猫 / 猪…（只用来查找 ✓）
    const bits = [codexCatLabel(entry.cat)];
    const spLabel = codexSpeciesLabel(entry.species);
    if (spLabel) bits.push(spLabel);
    const unit = rowOf(entry, 'unit')?.text;
    if (unit) bits.push('单位 ' + unit);
    const stats = textStatsOf(entry);
    bits.push('正文 ' + stats.total + ' 字');
    const stages = entry.stages.length;
    bits.push(stages ? '发育段 ' + stages : '没有发育段');
    return bits.join(' · ');
}

/** 一行「名字」输入（打字不重画 ⇒ 只存不画 ✓） */
function nameField(entry, onChange) {
    return field('名字',
        textInput(entry.name, (v) => { entry.name = v; codexSave(entry); onChange?.(); }, { placeholder: '这一族叫什么' }),
    );
}

function aliasBlock(entry, repaint) {
    const wrap = h('div', { class: 'bc-chip-list' });
    for (const a of entry.aliases) {
        wrap.appendChild(h('span', { class: 'bc-chip' },
            h('span', { text: a }),
            h('span', {
                class: 'bc-chip-x', text: '✕',
                onclick: () => {
                    entry.aliases = entry.aliases.filter((x) => x !== a);
                    codexSave(entry);
                    repaint();
                },
            }),
        ));
    }
    wrap.appendChild(button('+ 加名字', async () => {
        const v = await askText({ title: '加一个别的名字', placeholder: '推演里可能用的别的叫法', maxLen: 32 });
        if (v === null) return;
        const name = v.trim();
        if (!name) return;
        if (!entry.aliases.includes(name)) entry.aliases.push(name);
        codexSave(entry);
        repaint();
    }));
    return wrap;
}

// ---------------------------------------------------------------------------
// ★ 2026-11-06：胎数 / 性别 / 同卵改成「按栏目填」
//
// 为什么改：原来是让玩家自己写「D100：1-78 单胎，79-94 双胎…」，她截图问
//   「你这让玩家怎么编写？完全无从下手」✗ ⇒ 现在界面上只有几个格子，
//   骰子区间由插件折算。**存法没变**（还是那一行文字），判定侧照旧解析，
//   老存档 / 导入的那份照样读得懂 ✓
//
// 读不出结构的情况（比如卵生的「产 3-4 枚」、三档性别）⇒ 明确退回文字输入，
// 不硬套、也不把原文字弄丢 ✓
// ---------------------------------------------------------------------------

const DICE_KEYS = new Set(['litter', 'sex', 'twin']);
/** 混血那三项单独收一张卡（2026-11-07 她定的，不要散在数值表里 ✓） */
const MIX_KEYS = new Set(['breedGroup', 'breed']);

const bandPct = (from, to) => Math.max(0, Math.round(Number(to) - Number(from) + 1));

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
const cnNum = (n) => CN_NUM[n] || String(n);

/** 胎数：文字 ⇒ 一档一档；读不出（枚数成区间 / 同人类 / 空）⇒ null */
export function litterTiersOf(text) {
    const t = String(text || '').trim();
    if (!t || /同人类/.test(t)) return null;
    const segs = parseLitterText(t);
    if (!segs.length) return null;
    return segs.map((s) => ({ n: s.n, pct: bandPct(s.from, s.to) }));
}

/** 胎数：一档一档 ⇒ 文字（最后一档补到 100） */
export function litterTextOf(tiers) {
    const list = (tiers || []).filter((x) => x && Number(x.n) >= 1 && Number(x.pct) > 0);
    if (!list.length) return '';
    let cursor = 1;
    const parts = [];
    list.forEach((x, i) => {
        const last = i === list.length - 1;
        const n = Math.round(Number(x.n));
        const pct = Math.max(1, Math.round(Number(x.pct)));
        const to = last ? 100 : Math.min(100, cursor + pct - 1);
        const label = n === 1 ? '单胎' : (n === 2 ? '双胎' : (n === 3 ? '三胎' : cnNum(n) + '胎或以上'));
        parts.push(cursor + '-' + to + ' ' + label);
        cursor = to + 1;
    });
    return 'D100：' + parts.join('，');
}

/** 性别：文字 ⇒ {malePct, femalePct, maleLabel, femaleLabel}；读不出 / 不是正好两档 ⇒ null */
export function sexPairOf(text) {
    const t = String(text || '').trim();
    if (!t || /同人类/.test(t)) return null;
    const r = parseSexText(t);
    if (!r || r.none) return null;
    const malePct = bandPct(r.male[0], r.male[1]);
    const femalePct = bandPct(r.female[0], r.female[1]);
    if (malePct + femalePct !== 100 || r.male[0] !== 1 || r.female[1] !== 100) return null;
    return { malePct, femalePct, maleLabel: r.maleLabel, femaleLabel: r.femaleLabel };
}

/** 性别：两个称呼 + 一边占比 ⇒ 文字；`{none:true}` ⇒ 不分性别 */
export function sexTextOf(pair) {
    if (pair && pair.none) return '不分性别';
    const p = Math.max(1, Math.min(99, Math.round(Number(pair.malePct) || 50)));
    const a = String(pair.maleLabel || '男').trim() || '男';
    const b = String(pair.femaleLabel || '女').trim() || '女';
    return '1-' + p + ' ' + a + '，' + (p + 1) + '-100 ' + b;
}

/** 同卵：文字 ⇒ {none} 或 {samePct, mixedPct}；读不出 ⇒ null */
export function twinPairOf(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const r = parseTwinText(t);
    if (!r) return null;
    if (r.none) return { none: true };
    if (!r.same || !r.diff) return null;
    const samePct = bandPct(r.same[0], r.same[1]);
    if (samePct + bandPct(r.diff[0], r.diff[1]) !== 100 || r.same[0] !== 1) return null;
    return { samePct, mixedPct: r.mixed ? bandPct(r.mixed[0], r.mixed[1]) : 0 };
}

/** 同卵：占比 ⇒ 文字 */
export function twinTextOf(pair) {
    if (pair && pair.none) return '这一族不判同卵 / 异卵';
    const s = Math.max(1, Math.min(99, Math.round(Number(pair?.samePct) || 50)));
    let out = 'D100：1-' + s + ' 同卵，' + (s + 1) + '-100 异卵';
    const m = Math.max(0, Math.min(99, Math.round(Number(pair?.mixedPct) || 0)));
    if (m > 0) out += '；胎数 3 及以上时，' + (101 - m) + '-100 为混合胎';
    return out;
}

/** 「这一条写的是什么」的一句人话（单独调那边抬头用） */
function diceHumanText(key, text) {
    const t = String(text || '').trim();
    if (!t) return '（空 = 跟全局那份）';
    if (/同人类/.test(t)) return '跟人类那条一样';
    if (key === 'litter') {
        const list = litterTiersOf(t);
        if (!list) return t;
        return list.map((x) => x.pct + '% ' + (x.n === 1 ? '单胎' : (x.n === 2 ? '双胎' : (x.n === 3 ? '三胎' : x.n + ' 胎及以上')))).join(' / ');
    }
    if (key === 'sex') {
        const p = sexPairOf(t);
        if (!p) return t;
        return (p.maleLabel || '男') + ' ' + p.malePct + '% / ' + (p.femaleLabel || '女') + ' ' + p.femalePct + '%';
    }
    const p = twinPairOf(t);
    if (!p) return t;
    if (p.none) return '这一族不判同卵 / 异卵';
    return '同卵 ' + p.samePct + '% / 异卵 ' + (100 - p.samePct) + '%'
        + (p.mixedPct ? ('；混合 ' + p.mixedPct + '%（3 胎起）') : '；不混合');
}

/** 读不出结构时退回文字输入（并说清为什么，不把原文弄丢） */
function diceTextFallback(text, onChange, note) {
    return h('div', {},
        h('div', { class: 'bc-hint', text: note }),
        textInput(text || '', (v) => onChange(v), { placeholder: '按这一族特殊写法填' }),
    );
}

/** 数字框 + 单位 + 删行 */
function tierRowEl(row, i, list, build, commit) {
    return h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-hint bc-inline-tip', text: '一档' }),
        fixedBox(numberInput(row.n, (v) => { row.n = Number(v) || 0; commit(); }, { min: 1, max: 20 }), 64),
        h('span', { class: 'bc-hint bc-inline-tip', text: '个 · 占' }),
        fixedBox(numberInput(row.pct, (v) => { row.pct = Number(v) || 0; commit(); }, { min: 1, max: 100 }), 78),
        h('span', { class: 'bc-hint bc-inline-tip', text: '%' }),
        button('删', () => { list.splice(i, 1); build(); commit(); }),
    );
}

/** 胎数：一行一档 */
function tierEditor(tiers, onChange, repaint) {
    const box = h('div', {});
    const list = tiers.map((x) => ({ n: x.n, pct: x.pct }));
    const sumLine = h('div', { class: 'bc-hint bc-inline-tip' });
    const refreshSum = () => {
        const s = list.reduce((a, b) => a + (Number(b.pct) || 0), 0);
        sumLine.textContent = '合计 ' + s + '%' + (s === 100 ? '' : '（不用凑满：最后一档自动补到 100）');
    };
    const commit = () => { refreshSum(); onChange(litterTextOf(list)); };
    const build = () => {
        clear(box);
        list.forEach((row, i) => box.appendChild(tierRowEl(row, i, list, build, commit)));
        box.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            button('+ 加一档', () => {
                const lastN = list.length ? Number(list[list.length - 1].n) || 1 : 0;
                list.push({ n: lastN + 1, pct: 10 });
                build(); commit();
            }),
            h('div', { class: 'bc-spacer' }),
            sumLine,
        ));
        refreshSum();
    };
    build();
    void repaint;
    return box;
}

/** 性别：两个称呼 + 一边占比 */
function sexEditor(pair, onChange) {
    const p = { ...pair };
    const commit = () => onChange(sexTextOf(p));
    return h('div', { class: 'bc-row bc-row-wrap' },
        fixedBox(textInput(p.maleLabel, (v) => { p.maleLabel = v; commit(); }, { placeholder: '雄' }), 90),
        h('span', { class: 'bc-hint bc-inline-tip', text: '占' }),
        fixedBox(numberInput(p.malePct, (v) => { p.malePct = Number(v) || 0; commit(); }, { min: 1, max: 99 }), 70),
        h('span', { class: 'bc-hint bc-inline-tip', text: '% ；' }),
        fixedBox(textInput(p.femaleLabel, (v) => { p.femaleLabel = v; commit(); }, { placeholder: '雌' }), 90),
        h('span', { class: 'bc-hint bc-inline-tip', text: '占剩下的' }),
        button('不分性别', () => onChange(sexTextOf({ none: true }))),
    );
}

/** 同卵：同卵占比 + 混合占比 + 不判 */
function twinEditor(pair, onChange, repaint) {
    const p = { samePct: 33, mixedPct: 0, ...pair };
    let none = !!p.none;
    const box = h('div', {});
    const body = h('div', {});
    const commit = () => onChange(none ? twinTextOf({ none: true }) : twinTextOf(p));
    const build = () => {
        clear(body);
        if (none) {
            body.appendChild(h('div', { class: 'bc-hint', text: '这一族不掷同卵 / 异卵（单胎也没有这一说）' }));
            return;
        }
        body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-hint bc-inline-tip', text: '同卵占' }),
            fixedBox(numberInput(p.samePct, (v) => { p.samePct = Number(v) || 0; commit(); }, { min: 1, max: 99 }), 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: '%（异卵是剩下的）' }),
        ));
        body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-hint bc-inline-tip', text: '混合胎占' }),
            fixedBox(numberInput(p.mixedPct, (v) => { p.mixedPct = Number(v) || 0; commit(); }, { min: 0, max: 99 }), 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: '%（3 胎及以上才可能，填 0 = 不混合）' }),
        ));
    };
    const toggleBtn = button(none ? '改成会掷同卵' : '这一族不判同卵', () => {
        none = !none;
        toggleBtn.textContent = none ? '改成会掷同卵' : '这一族不判同卵';
        build(); commit(); void repaint;
    });
    const toggle = h('div', { class: 'bc-row bc-row-wrap' }, toggleBtn);
    build();
    box.appendChild(body);
    box.appendChild(toggle);
    return box;
}

/** 三行合一的入口：读得出就画栏目，读不出退回文字 */
function diceEditor(key, text, onChange, repaint) {
    const t = String(text || '').trim();
    if (key === 'litter') {
        const list = litterTiersOf(t);
        if (list) return tierEditor(list, onChange, repaint);
        if (/同人类/.test(t)) {
            return h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-badge', text: '跟人类那条一样' }),
                button('改成自己填', () => onChange(litterTextOf([
                    { n: 1, pct: 78 }, { n: 2, pct: 16 }, { n: 3, pct: 4 }, { n: 4, pct: 2 },
                ]))),
            );
        }
        if (!t) {
            return tierEditor([
                { n: 1, pct: 78 }, { n: 2, pct: 16 }, { n: 3, pct: 4 }, { n: 4, pct: 2 },
            ], onChange, repaint);
        }
        return diceTextFallback(t, onChange, '这一条是卵生的枚数写法（比如「产 3-4 枚」），按档填这一批还接不了，先用文字。');
    }
    if (key === 'sex') {
        if (/不分性别|无性别|不判性别/.test(t)) {
            return h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-badge', text: '不分性别' }),
                h('span', { class: 'bc-hint bc-inline-tip', text: '孩子不掷性别' }),
                button('改成按比例', () => onChange(sexTextOf({ malePct: 50, maleLabel: '男', femaleLabel: '女' }))),
            );
        }
        const p = sexPairOf(t);
        if (p) return sexEditor(p, onChange);
        if (/同人类/.test(t)) {
            return h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-badge', text: '跟人类那条一样' }),
                button('改成自己填', () => onChange(sexTextOf({ malePct: 50, maleLabel: '男', femaleLabel: '女' }))),
            );
        }
        if (!t) return sexEditor({ malePct: 50, maleLabel: '男', femaleLabel: '女' }, onChange);
        return diceTextFallback(t, onChange, '这一条的性别是分几批判的（比如偏雄 / 均衡 / 偏雌），按两档填会丢东西，先用文字。');
    }
    const p = twinPairOf(t);
    if (p) return twinEditor(p, onChange, repaint);
    if (!t) return twinEditor({ samePct: 33, mixedPct: 5 }, onChange, repaint);
    return diceTextFallback(t, onChange, '这一条的写法比较特殊，按栏目填会丢东西，先用文字。');
}

/** 窄输入用的小盒子（`.bc-input` 本身是 width:100%，不套一层就会占满一行 ✓） */function fixedBox(el, px) {
    return h('div', { style: { flex: '0 0 ' + px + 'px', minWidth: '0' } }, el);
}

/** 会伸缩的一格（一句话 / 描述那种） */
function growBox(el, basis = '220px') {
    return h('div', { style: { flex: '1 1 ' + basis, minWidth: '0' } }, el);
}

/**
 * ★ 2026-11-08（发情期第 0 批）：「发情季节」那一格的月份勾选。
 *
 * 存的是**一年里的位置**（0~1 的比例），不是月份序号 —— 历法一改（一年 4 个月、每月 90 天）
 *   月份序号就全错位了；存位置则照样落在同一段时间里 ✓
 * 界面上按**当前这套历法**列月份：12 个月就 12 个格子，4 个月就 4 个 ✓
 * 空着 ＝ 全年发情（全部勾上，但内部是空串，不是"全选"）✓
 */
function monthSpansOf(cal) {
    const raw = Array.isArray(cal?.months) ? cal.months : [];
    const days = raw.map((n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 31));
    const total = days.reduce((a, b) => a + b, 0) || 365;
    const out = [];
    let acc = 0;
    for (const n of days) {
        out.push([acc / total, (acc + n) / total]);
        acc += n;
    }
    return out;
}

function monthsEditor(text, onChange) {
    const cal = activeCalendar();
    const spans = monthSpansOf(cal);
    const cur = parseSeasonRanges(text) || [];
    const names = Array.isArray(cal?.style?.months) ? cal.style.months : [];
    // 勾中的月份（空 = 全年 ⇒ 全部勾上 ✓）
    const picked = new Set();
    for (let i = 0; i < spans.length; i++) {
        if (!cur.length) { picked.add(i); continue; }
        const [a, b] = spans[i];
        const mid = (a + b) / 2;
        if (cur.some(([x, y]) => mid >= x && mid < y)) picked.add(i);
    }
    /** 勾中的月份 → 「一年里的位置」区间串（相邻的并成一段，空串＝全年 ✓） */
    const textOfPicked = (set) => {
        const ranges = [];
        let lo = null;
        let hi = null;
        for (const j of [...set].sort((x, y) => x - y)) {
            if (lo === null) { lo = j; hi = j; continue; }
            if (j === hi + 1) { hi = j; continue; }
            ranges.push([spans[lo][0], spans[hi][1]]);
            lo = j; hi = j;
        }
        if (lo !== null) ranges.push([spans[lo][0], spans[hi][1]]);
        return seasonRangesText(ranges);
    };
    // ★ 2026-11-09：用插件自己画的勾选行（`checkRow`），不再用裸 <input type="checkbox">
    //   —— 裸的那个会被酒馆主题刷成酒馆的样子，跟插件不是一套 ✗
    const wrap = h('div', { class: 'bc-check-grid' });
    for (let i = 0; i < spans.length; i++) {
        wrap.appendChild(checkRow(
            names[i] || ('第 ' + (i + 1) + ' 月'),
            picked.has(i),
            (next) => {
                if (next) picked.add(i); else picked.delete(i);
                onChange(textOfPicked(picked));
            },
            { class: 'bc-check-month', title: '点一下勾上这个月，再点一下取消' },
        ));
    }
    return wrap;
}

/** 数值表的一行 */
function valueRow(entry, row, repaint) {
    // 个别行自带单位（着床天数是「天」），其余 range 行跟「刻度」走 ✓
    const unit = row.unit || scaleOf(entry);
    let control;
    if (DICE_KEYS.has(row.key)) {
        // ★ 2026-11-06：这三行不再让玩家写 D100 区间
        control = diceEditor(row.key, row.text, (v) => { row.text = v; codexSave(entry); }, repaint);
    } else if (row.kind === 'range') {
        const mk = (key) => numberInput(row[key], (v) => {
            row[key] = v === '' ? null : v;
            codexSave(entry);
        }, { min: 0 });
        control = h('div', { class: 'bc-row' },
            fixedBox(mk('min'), 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: '到' }),
            fixedBox(mk('max'), 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: unit }),
        );
    } else if (row.kind === 'number') {
        // ★ 第四批：显怀起点这种「一个数」
        control = h('div', { class: 'bc-row' },
            fixedBox(numberInput(row.num, (v) => { row.num = (v === '' || v === null) ? null : Number(v); codexSave(entry); }, { min: 0 }), 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: row.unit || '周' }),
        );
    } else if (row.key === 'breedGroup') {
        control = breedGroupPicker(entry, row, repaint);
    } else if (row.key === 'breed') {
        control = breedPicker(entry, row, repaint);
    } else if (row.kind === 'select') {
        // ★ 2026-11-09：下拉里**不许出现没字的选项**（她截图问「为什么有一个这个」✗）
        //   · 空着本身有专门含义的（泌乳：留空 = 按设定）⇒ 给这个空选项一个名字
        //   · 空着就等于某个选项的（发情期：空着 = 无）⇒ 干脆不列空选项，直接显示成那个 ✓
        const opts = (row.options || [])
            .filter((o) => o !== '' || row.blankLabel)
            .map((o) => [o, o === '' ? String(row.blankLabel || '') : o]);
        const shown = (!row.text && row.blankAs) ? row.blankAs : row.text;
        control = dropdown(shown, opts, (v) => {
            row.text = v;
            codexSave(entry);
            // 换刻度 ⇒ 上面那几个「单位」的字要跟着变，重画这一页 ✓
            repaint();
        });
    } else if (row.kind === 'months') {
        control = monthsEditor(row.text, (v) => { row.text = v; codexSave(entry); repaint(); });
    } else {
        control = textInput(row.text, (v) => { row.text = v; codexSave(entry); }, {
            placeholder: row.placeholder || '',
        });
    }
    // ★ 2026-11-09：月份勾选那一格**占满整行** —— 一格只有 230 来像素时
    //   12 个月会竖成一条（截图里就是那样 ✗）；占满整行才排得成几列 ✓
    return h('div', {
        class: 'bc-field' + ((DICE_KEYS.has(row.key) || row.kind === 'months') ? ' bc-codex-wide' : ''),
    },
        h('label', { class: 'bc-label', text: row.label }),
        control,
    );
}

/** 图鉴里某一格的一句话值（读不到就是空） */
function codexRowText(e, key) {
    try { const r = rowOf(e, key); return String(r?.text || '').trim(); } catch { return ''; }
}

/** 混血组：下拉里放已经存在的组，加一个「新建组」；新建的组别人也能选 ✓ */
function breedGroupPicker(entry, row, repaint) {
    const cur = String(row.text || '').trim();
    const opts = [['', '不设组（只跟同族生）']];
    for (const g of [...new Set(codexEntries().map((e) => codexRowText(e, 'breedGroup')).filter(Boolean))].sort()) opts.push([g, g]);
    if (cur && !opts.some(([v]) => v === cur)) opts.splice(1, 0, [cur, cur]);
    opts.push(['__new__', '新建组…']);
    return dropdown(cur, opts, (v) => {
        if (v === '__new__') {
            askText({ title: '新建混血组', placeholder: '同一个原型的统称，比如 犬 / 羊 / 马' }).then((name) => {
                const t = String(name || '').trim();
                if (!t) return;
                row.text = t; codexSave(entry); repaint();
            });
            return;
        }
        row.text = v; codexSave(entry); repaint();
    });
}

/** 品种：下拉里放同组已有的品种，加一个「新建品种」；留空 = 统称的通用形态 ✓ */
function breedPicker(entry, row, repaint) {
    const group = codexRowText(entry, 'breedGroup');
    const cur = String(row.text || '').trim();
    const opts = [['', '统称的通用形态']];
    const breeds = [...new Set(codexEntries()
        .filter((e) => codexRowText(e, 'breedGroup') === group)
        .map((e) => codexRowText(e, 'breed'))
        .filter(Boolean))].sort();
    for (const b of breeds) opts.push([b, b]);
    if (cur && !opts.some(([v]) => v === cur)) opts.splice(1, 0, [cur, cur]);
    opts.push(['__new__', '新建品种…']);
    return dropdown(cur, opts, (v) => {
        if (v === '__new__') {
            askText({ title: '新建品种', placeholder: '比如 金毛 / 柯基' }).then((name) => {
                const t = String(name || '').trim();
                if (!t) return;
                row.text = t; codexSave(entry); repaint();
            });
            return;
        }
        row.text = v; codexSave(entry); repaint();
    });
}

/** 混血池：这一条的同组同品种成员，以及和人类配对时的百分比 ✓ */
/** 混血：把「混血可行性与折算 / 混血组 / 品种 / 混血池」收在一张卡里 ✓
 *  她知道 2026-11-07：混血相关不要散在数值表里、池子也不要离得远 ✓ */
function mixCard(entry, repaint) {
    const box = section('混血');
    const body = box.querySelector('.bc-section-body');
    const fields = h('div', { class: 'bc-codex-grid' });
    for (const key of ['breedGroup', 'breed']) {
        const row = rowOf(entry, key);
        if (row) fields.appendChild(valueRow(entry, row, repaint));
    }
    body.appendChild(fields);
    const group = codexRowText(entry, 'breedGroup');
    const breed = codexRowText(entry, 'breed');
    if (!group) {
        body.appendChild(h('div', { class: 'bc-hint', text: '这一条没有混血组，只跟同族生。' }));
        return box;
    }
    body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-badge', text: '混血组：' + group }),
        h('span', { class: 'bc-badge', text: breed ? '品种：' + breed : '品种：通用形态' }),
    ));
    const same = codexEntries().filter((e) => e.status === 'on'
        && codexRowText(e, 'breedGroup') === group
        && codexRowText(e, 'breed') === breed);
    body.appendChild(h('div', { class: 'bc-hint', text: '同组同品种：' + same.map((e) => e.name).join('、') }));
    const human = codexEntry('bi-human');
    const pool = human ? mixedRacePoolOfEntries(human, entry) : null;
    if (pool && pool.length) {
        const total = pool.reduce((s, x) => s + x.weight, 0);
        body.appendChild(h('div', { class: 'bc-hint', text: '和人类配对时的池子：' }));
        body.appendChild(h('div', { class: 'bc-hint', text: pool.map((x) => x.entry.name + ' ' + Math.round(x.weight / total * 100) + '%').join(' / ') }));
    }
    body.appendChild(h('div', { class: 'bc-hint', text: '换成别的父母时按同一条规则算：同品种层才扩展，跨组只算父母两个。' }));
    return box;
}

/** 自己加的一行（键值都由玩家写；只给一句话） */
function customRow(entry, row, repaint) {
    const labelIn = textInput(row.label, (v) => { row.label = v; codexSave(entry); }, { placeholder: '这项叫什么' });
    const textIn = textInput(row.text, (v) => { row.text = v; codexSave(entry); }, { placeholder: '值' });
    return h('div', { class: 'bc-row bc-row-wrap' },
        labelIn, textIn,
        button('删除', () => {
            entry.rows = entry.rows.filter((r) => r.key !== row.key);
            codexSave(entry);
            repaint();
        }),
    );
}

function stagesBlock(entry, repaint) {
    const box = h('div', {});
    if (!entry.stages.length) {
        box.appendChild(h('div', { class: 'bc-empty', text: '没有发育段' }));
        box.appendChild(h('div', { class: 'bc-hint', text: '空着 = 这一族不生成生长描述（模型不许自己编）' }));
    }
    entry.stages.forEach((s, i) => {
        box.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '0 0 46%', minWidth: '0' } },
                textInput(s.at, (v) => { s.at = v; codexSave(entry); }, { placeholder: '起始刻度，比如 孕 18 周', class: 'bc-codex-at' })),
            growBox(textInput(s.text, (v) => { s.text = v; codexSave(entry); }, { placeholder: '一句话描述' }), '160px'),
            button('删除', () => {
                entry.stages.splice(i, 1);
                codexSave(entry);
                repaint();
            }),
        ));
    });
    box.appendChild(h('div', { class: 'bc-row' },
        button('+ 加一段', () => {
            entry.stages.push({ at: '', text: '' });
            codexSave(entry);
            repaint();
        }),
    ));
    return box;
}

const BORROW_HELP = [
    '只借数值，不借正文：介绍、生理、繁殖、补充还是这一条自己写的',
    '空着的项从借来的那条读；自己填了的项仍然用自己的；个人单独调最优先',
    '刻度与生育方式按这一条自己填（默认天 / 胎生），不跟着借',
    '不能选自己，也不能选已经直接或间接借了这一条的条目（会成环）',
];

/** 借用下拉里能选的条目（排掉自己和会成环的） */
function borrowOptionsFor(entry) {
    const reaches = (fromId, targetId) => {
        let cur = codexEntry(fromId);
        const seen = new Set();
        while (cur && !seen.has(cur.id)) {
            if (cur.id === targetId) return true;
            seen.add(cur.id);
            cur = cur.borrowFrom ? codexEntry(cur.borrowFrom) : null;
        }
        return false;
    };
    return codexEntries()
        .filter((e) => e.id !== entry.id && !reaches(e.id, entry.id))
        .map((e) => [e.id, e.name + (e.status === 'off' ? '（停用）' : '')]);
}

/** ★ 第八批第二批：繁殖数据借用（只借数值，不借正文） */
function borrowCard(entry, repaint) {
    const box = section('繁殖数据借用', { help: BORROW_HELP });
    const b = box.querySelector('.bc-section-body');
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        dropdown(entry.borrowFrom || '', [['', '不借用'], ...borrowOptionsFor(entry)], (v) => {
            entry.borrowFrom = String(v || '');
            codexSave(entry);
            console.log('[Bodycord] 繁殖数据借用', entry.id, '→', entry.borrowFrom || '不借用');
            repaint();
        }),
    ));
    const cur = entry.borrowFrom ? codexEntry(entry.borrowFrom) : null;
    if (entry.borrowFrom && !cur) {
        b.appendChild(h('div', { class: 'bc-hint', text: '原来借用的条目已经不在图鉴里了，现在没有借到任何数值；空着的项按全局默认算' }));
    } else if (cur) {
        b.appendChild(h('div', {
            class: 'bc-hint',
            text: '现在借用「' + cur.name + '」的数值'
                + (cur.status === 'off' ? '，但这一条已停用，等于没借到' : ''),
        }));
    } else {
        b.appendChild(h('div', { class: 'bc-hint', text: '不借用：空着的项按全局默认算' }));
    }
    return box;
}

const USAGE_HELP = [
    '这里列的是这个聊天里正在用这一条的对象。换一个聊天就是另一批人',
    '已绑定 = 明确把这一条选给了这个对象；名字对上了还没绑 = 推演按名字能对到这一条，发主 API 时也按这一条算',
    '停用的条目照样列出来，好让你知道停用会影响谁',
    '删自建条目前先看一眼这里：还绑着它的对象会变成「原来绑的条目没了」',
];

/** ★ 第八批：反查谁在用这一条 */
function usageCard(entry) {
    const box = section('谁在用这一条', { help: USAGE_HELP });
    const b = box.querySelector('.bc-section-body');
    const list = codexUsageOf(entry.id);
    if (!list.length) {
        b.appendChild(h('div', { class: 'bc-empty', text: '这个聊天里还没有对象在用它' }));
        b.appendChild(h('div', { class: 'bc-hint', text: '给角色绑这一条在「人物页 → 角色基础信息 → 种族」，或者用下面「这个聊天的角色」里那颗「挑一条」' }));
        return box;
    }
    for (const u of list) {
        b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { class: 'bc-codex-main' },
                h('div', { class: 'bc-codex-name', text: u.name }),
                h('div', { class: 'bc-codex-meta', text: u.how === 'bound' ? '已绑定这一条' : '名字对上了，还没绑' }),
            ),
            u.overrides ? h('span', { class: 'bc-hint', text: '单独调了 ' + u.overrides + ' 项' }) : null,
        ));
    }
    return box;
}

const SEX_HELP = [
    '上面四项是固定选项，拿不准就留「没填」；下面的长框只写它们没说的，写重复了会多占 token',
    '雌性只写两项：外阴、阴蒂。不要写子宫这类内部器官名，主模型会把它当说明文写进正文',
    '这一栏跟正文一样常驻发送，写多少字就发多少字',
];

/** ★ 2026-11-08（第 0 批）：性特征那一栏（总开关关着时整栏不显示 ✓） */
function sexCard(entry, touch = null) {
    const mark = () => { if (typeof touch === 'function') touch(); };
    if (!entry.sexTrait || typeof entry.sexTrait !== 'object') {
        entry.sexTrait = { surface: '', glans: '', lock: '', node: '', double: '', baculum: '', cloaca: '', delivery: '', male: '', outer: '', clit: '' };
    }
    const s = entry.sexTrait;
    const card = section('性特征', { help: SEX_HELP });
    // ★ 2026-11-08：这张卡的间距单独一套（她截图说太近）⇒ 挂个专属类，别动全局间距 ✓
    card.classList.add('bc-sex-card');
    const body = card.querySelector('.bc-section-body');
    // 性别术语跟条目的大类走：兽形用雄 / 雌，亚人与兽人用男 / 女 ✓
    const maleWord = entry.cat === 'animal' ? '雄性' : '男性';
    const femaleWord = entry.cat === 'animal' ? '雌性' : '女性';
    const opts = (k) => [['', '没填'], ...SEX_ENUMS[k].filter(Boolean).map((v) => [v, v])];
    const group = (title, ...children) => h('div', { class: 'bc-sex-group' },
        h('div', { class: 'bc-label', text: title }), ...children);
    const grid = h('div', { class: 'bc-codex-grid' });
    for (const k of SEX_KEYS) {
        grid.appendChild(field(SEX_LABELS[k], dropdown(s[k] || '', opts(k), (v) => {
            s[k] = v; codexSave(entry); mark();
        })));
    }
    body.appendChild(group(maleWord,
        grid,
        field(maleWord + '的其余细节', textArea(s.male || '', (v) => {
            s.male = v; codexSave(entry); mark();
        }, {
            rows: 4,
            placeholder: '只写上面四个下拉没说的：阴茎骨、形状细节、锁结多久、射精量、气味、尺寸。两三句',
        }))));
    body.appendChild(group(femaleWord,
        field('外阴', textArea(s.outer || '', (v) => {
            s.outer = v; codexSave(entry); mark();
        }, { rows: 2, placeholder: '一句：外面看起来什么样、紧或宽、有没有褶皱；不写内部器官名' })),
        field('阴蒂', textArea(s.clit || '', (v) => {
            s.clit = v; codexSave(entry); mark();
        }, { rows: 2, placeholder: '一句：位置、大小、是否外露' }))));
    return card;
}

/** 详情页 */
function paintDetail(container, entry, repaint, onBack) {
    // ★ 2026-11-08：「恢复默认」原来只在**打开这一条时就已经改过**才出现；
    //   而打字不重画（为了不丢焦点）⇒ 刚改完滚到底看不到它，看起来像"不见了" ✗
    //   ⇒ 按钮一直在（内置才有），每次保存随手改它的显隐 ✓
    let resetBtn = null;
    const touchEdited = () => {
        if (!resetBtn) return;
        // ★ 2026-11-08：点完恢复默认它**不许消失**（她报了「按钮就消失了」）——
        //   没改过时灰掉但留在原地，让人看得见这条路存在 ✓
        const on = codexIsEdited(entry.id);
        resetBtn.disabled = !on;
        resetBtn.classList.toggle('bc-btn-off', !on);
        resetBtn.title = on ? '' : '这一条现在就是默认的样子';
    };
    const card = (title, help, ...children) => section(title, ...children, ...(help ? [{ help }] : []));

    container.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('← 返回列表', () => onBack()),
        h('div', { class: 'bc-spacer' }),
        ...statusBadges(entry),
    ));
    container.appendChild(h('div', { class: 'bc-hint', text: entry.id }));

    // ---- 基本信息 ----
    const basic = card('基本信息', HELP_DETAIL.slice(0, 2));
    const bB = basic.querySelector('.bc-section-body');
    bB.appendChild(nameField(entry, repaint));
    // 分类：两层 —— 第一层 人类 / 动物 / 亚人 / 兽人，第二层具体是哪种（犬 / 猫 / 猪…）✓
    const clsGrid = h('div', { class: 'bc-codex-grid' });
    clsGrid.appendChild(field('分类', dropdown(entry.cat, CODEX_CATS, (v) => {
        entry.cat = v; codexSave(entry); repaint();
    })));
    clsGrid.appendChild(field('种类', dropdown(entry.species || '', [['', '不指定'], ...CODEX_SPECIES], (v) => {
        entry.species = v; codexSave(entry); repaint();
    })));
    bB.appendChild(clsGrid);
    bB.appendChild(h('div', { class: 'bc-field' },
        h('label', { class: 'bc-label', text: '其他可以用的种族名称' }),
        aliasBlock(entry, repaint),
    ));
    container.appendChild(basic);

    // ---- 四段正文 ----
    const body = card('正文', HELP_DETAIL.slice(2, 3));
    const bBody = body.querySelector('.bc-section-body');
    // ★ 第八批：这一条正文多少字；每一段下面跟着走，打字时也在变 ✓
    const statLine = h('div', { class: 'bc-hint' });
    const syncStats = () => {
        const s = textStatsOf(entry);
        statLine.textContent = '这一条正文合计 ' + s.total + ' 字：介绍 ' + s.intro
            + '，生理 ' + s.physio + '，繁殖 ' + s.repro + '，补充 ' + s.extra + '，发育段 ' + s.stages;
    };
    syncStats();
    bBody.appendChild(statLine);
    const ta = (label, key, rows) => {
        const hint = h('div', { class: 'bc-hint', text: plainLen(entry[key]) + ' 字' });
        const input = textArea(entry[key], (v) => {
            entry[key] = v;
            codexSave(entry);
            hint.textContent = plainLen(v) + ' 字';
            syncStats();
            touchEdited();
        }, { rows });
        return field(label, input, hint);
    };
    bBody.appendChild(ta('简单介绍（兼目录摘要）', 'intro', 3));
    bBody.appendChild(ta('生理', 'physio', 5));
    bBody.appendChild(ta('繁殖受孕', 'repro', 5));
    bBody.appendChild(ta('自由补充', 'extra', 3));
    container.appendChild(body);

    // ---- 性特征（第 0 批）----
    // ★ 总开关关着时整栏不出现（她定的：关掉后图鉴里也不显示 ✓）
    try {
        if (settings().sexTraitsOn === true) container.appendChild(sexCard(entry, touchEdited));
    } catch { /* 读不到设置就不显示，不拦详情页 ✓ */ }

    // ---- 繁殖数据借用（第八批第二批）----
    container.appendChild(borrowCard(entry, repaint));

    // ---- 数值表 ----
    const nums = card('数值表', HELP_DETAIL.slice(3, 4));
    const bN = nums.querySelector('.bc-section-body');
    const fixed = entry.rows.filter((r) => r.kind !== undefined && !String(r.key).startsWith('x-') && !MIX_KEYS.has(r.key));
    const customs = entry.rows.filter((r) => String(r.key).startsWith('x-'));
    // ★ 2026-11-06：改成两列网格 —— 一行一项地竖着排太长了，
    //   三个「按栏目填」的行（胎数 / 性别 / 同卵）占满整行 ✓
    const grid = h('div', { class: 'bc-codex-grid' });
    for (const row of fixed) grid.appendChild(valueRow(entry, row, repaint));
    bN.appendChild(grid);
    if (customs.length) {
        bN.appendChild(h('div', { class: 'bc-label', text: '自己加的项' }));
        for (const row of customs) bN.appendChild(customRow(entry, row, repaint));
    }
    bN.appendChild(h('div', { class: 'bc-row' },
        button('+ 加一行', () => {
            entry.rows.push({ key: 'x-' + Date.now().toString(36) + Math.floor(Math.random() * 100), label: '新项', kind: 'text', text: '' });
            codexSave(entry);
            repaint();
        }),
    ));
    container.appendChild(nums);
    // ★ 2026-11-07：混血三项和池子收在紧挨着的一张卡里
    container.appendChild(mixCard(entry, repaint));

    // ---- 发育段 ----
    const st = card('发育段', HELP_DETAIL.slice(4, 5));
    const bS = st.querySelector('.bc-section-body');
    bS.appendChild(stagesBlock(entry, repaint));
    container.appendChild(st);

    // ---- 备注 ----
    // ★ 2026-11-07：备注不发送，这件事要常驻写出来（光放在 placeholder 里，一输入就看不见了 ✗）
    const note = card('备注');
    note.querySelector('.bc-section-body').appendChild(
        textArea(entry.notes, (v) => { entry.notes = v; codexSave(entry); }, { rows: 3, placeholder: '可以留空' }),
    );
    note.querySelector('.bc-section-body').appendChild(
        h('div', { class: 'bc-hint', text: '只给你自己看，不发送给模型，也不进提示词。' }),
    );
    container.appendChild(note);

    // ---- 谁在用这一条（第八批：反查）----
    container.appendChild(usageCard(entry));

    // ---- 操作 ----
    const ops = section('这一条的操作');
    const bO = ops.querySelector('.bc-section-body');
    bO.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('复制这一条', () => {
            const copy = codexDuplicate(entry.id);
            if (copy) { _openId = copy.id; repaint(); }
        }),
        button(entry.status === 'off' ? '重新启用' : '停用', () => {
            codexSetStatus(entry.id, entry.status === 'off');
            repaint();
        }),
        entry.builtin
            ? (resetBtn = button('恢复默认', async () => {
                if (!(await askConfirm('把这一条恢复成内置的样子？你改过的和停用都会一起没了'))) return;
                codexReset(entry.id);
                repaint();
            }))
            : null,
        entry.builtin
            ? null
            : button('删除', async () => {
                const using = codexUsageOf(entry.id).length;
                const msg = using
                    ? ('删掉这条自建条目？删了就找不回来了。\n\n现在有 ' + using + ' 个对象在用它（绑着或名字对上），删了他们会变成「原来绑的条目没了」，要重新挑一条。')
                    : '删掉这条自建条目？删了就找不回来了';
                if (!(await askConfirm({ msg, danger: true }))) return;
                codexRemove(entry.id);
                onBack();
            }, { variant: 'danger' }),
    ));
    container.appendChild(ops);
    // ★ 2026-11-08：按"现在改没改过"决定这颗按钮露不露（刚打开就已经改过的直接露 ✓）
    touchEdited();
}

// ---------------------------------------------------------------------------
// 第三批：影子比对（条目这边算出来的 vs 原来那边算出来的）
// ---------------------------------------------------------------------------

let _resyncTimer = null;
/** 条目一改 ⇒ 过一会儿按新数值重算预产期（打字会连着保存，防抖一下 ✓） */
function scheduleDueResync() {
    if (_resyncTimer) clearTimeout(_resyncTimer);
    _resyncTimer = setTimeout(() => {
        _resyncTimer = null;
        try { ensureGestationDates(); } catch { /* 重算失败不影响保存 ✓ */ }
    }, 700);
}
onCodexSaved(() => scheduleDueResync());

const SHADOW_HELP = [
    '孕期 / 胎数 / 性别 / 同卵 / 混合 / 着床天数，判定读的是图鉴条目里的值',
    '这里逐条列出「条目这边」和「原来那边」各算出什么；不一样就标出来，不静默',
    '条目空着就还是用原来那份（规则正文 / 设置页），空着不等于 0',
    '条目写了却读不出来的，也会标出来（那一行要按「1-78 单胎」这种写法才读得出）',
];

/** 影子比对那一块：只列不一致的；都一致就写「零差异」 */
function shadowCard() {
    const list = (() => { try { return targetList(); } catch { return []; } })();
    const box = section('影子比对', { help: SHADOW_HELP });
    const b = box.querySelector('.bc-section-body');
    if (!list.length) {
        b.appendChild(h('div', { class: 'bc-empty', text: '这个聊天还没有追踪对象' }));
        b.appendChild(h('div', { class: 'bc-hint', text: '推演过一轮之后，这里会列出每个对象的比对结果' }));
        return box;
    }
    let badTotal = 0;
    for (const t of list) {
        let rep = null;
        try { rep = shadowOf(t.key, { judged: !isXeno(t) }); } catch { rep = null; }
        if (!rep) continue;
        const name = (() => { try { return displayName(t); } catch { return t.key; } })();
        badTotal += rep.diffs;
        b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { class: 'bc-codex-main' },
                h('div', { class: 'bc-codex-name', text: name }),
                h('div', { class: 'bc-codex-meta', text: rep.judged
                    ? '插件自己判这一条（条目会生效）'
                    : '异种：这一批不接管，只比孕期' },
                ),
            ),
            h('span', { class: 'bc-hint', text: rep.diffs ? ('不一致 ' + rep.diffs + ' 项') : '零差异' }),
        ));
        for (const it of rep.items) {
            if (it.same) continue;
            b.appendChild(h('div', { class: 'bc-hint', text: '· ' + it.label
                + '：条目这边是 ' + it.entry + '；原来是 ' + it.old
                + (it.note ? '（' + it.note + '）' : '') }));
        }
    }
    b.appendChild(h('div', { class: 'bc-hint', text: badTotal
        ? ('一共 ' + badTotal + ' 项不一致：上面列出来的就是判定现在会跟原来不一样的地方')
        : '全部零差异：这一批接上之后，算出来的和以前一样' }));
    return box;
}

/** 列表页 */
export function renderCodexTab(container, handlers = {}) {    // ⚠️ 设置页的 content 是同一个容器 —— 每个页签自己清（漏了会两页叠在一起 ✗）
    clear(container);

    const repaint = () => {
        // 切走再切回来会由设置页重画；这里只管本页内部的状态变化（切条目、加行…）
        _paint(container, repaint, handlers);
    };
    _paint(container, repaint, handlers);
}

function _paint(container, repaint, handlers) {
    clear(container);
    // ★ 2026-11-09：内置图鉴是用到才读进来的（757KB，不占启动）——
    //   还没读进来时就别画一个"共 0 条"的空图鉴（她会以为数据丢了 ✗），
    //   先写一句正在读入，读完这一页自动重画 ✓
    if (!builtinReady()) {
        const waitBox = section('种族图鉴', { help: HELP_LIST });
        waitBox.querySelector('.bc-section-body').appendChild(
            h('div', { class: 'bc-empty', text: '图鉴正在读入…' }));
        container.appendChild(waitBox);
        ensureBuiltinCodex().then(() => { try { repaint(); } catch { /* 忽略 */ } }).catch(() => { /* 忽略 */ });
        return;
    }
    if (_openId) {
        const entry = codexEntry(_openId);
        if (entry) {
            paintDetail(container, entry, repaint, () => { _openId = ''; repaint(); });
            return;
        }
        _openId = '';
    }

    const stats = codexStats();
    const box = section('种族图鉴', { help: HELP_LIST });
    const b = box.querySelector('.bc-section-body');

    // ---- 搜索 / 分类 / 新建 ----
    const search = textInput(_q, (v) => {
        _q = v;
        _page = 1;
        paintList();
    }, { placeholder: '搜名字、其他叫法' });
    // ★ 2026-11-08（她说图鉴东西多了，要能选一个分类把别的收起来）：
    //   两个下拉原来各管各的，种类菜单把 33 个种类平铺出来（选了大类也照样全列 ⇒ 看着还是一大堆 ✗）。
    //   现在改成**先大类、再种类**：种类菜单只列当前大类下面真正有的种类（还带条数），
    //   选了大类以后，别的大类的种类在第二层根本不出现；换大类时对不上的旧种类一并清掉 ✓
    const searchRow = h('div', { class: 'bc-row bc-row-wrap' }, search);
    b.appendChild(searchRow);
    const filterRow = h('div', { class: 'bc-row bc-row-wrap' });
    b.appendChild(filterRow);

    function paintFilters() {
        // 只换下拉，不碰搜索框（正在打字时重画会丢焦点 ✗）
        for (const el of [...filterRow.querySelectorAll('.bc-dd')]) el.remove();
        const all = codexEntries();
        const catCount = new Map();
        const spCount = new Map();   // 键是「大类|种类」⇒ 选了大类就只数这一类
        for (const e of all) {
            catCount.set(e.cat, (catCount.get(e.cat) || 0) + 1);
            const k = e.cat + '|' + (e.species || '');
            spCount.set(k, (spCount.get(k) || 0) + 1);
        }
        const catDd = dropdown(_cat || '', [['', '全部分类'], ...CODEX_CATS.map(([k, l]) => [k, l + '（' + (catCount.get(k) || 0) + '）'])], (v) => {
            _cat = v; _page = 1;
            // 换了大类：原来选的种类不在这一类里 ⇒ 清掉（留着会筛出 0 条，看着像坏了 ✗）
            if (_species && !spCount.has(_cat + '|' + _species)) _species = '';
            paintFilters(); paintList();
        });
        const spOpts = [['', '全部种类']];
        for (const [k, l] of CODEX_SPECIES) {
            const n = _cat ? (spCount.get(_cat + '|' + k) || 0) : all.filter((e) => e.species === k).length;
            if (!n) continue;                     // 这一类里没有的种类不占位置 ✓
            spOpts.push([k, l + '（' + n + '）']);
        }
        const spDd = dropdown(_species || '', spOpts, (v) => {
            _species = v; _page = 1; paintList();
        });
        filterRow.appendChild(catDd);
        filterRow.appendChild(spDd);
    }
    paintFilters();
    const wordTotal = codexEntries().reduce((n, e) => n + textStatsOf(e).total, 0);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-hint', text: `共 ${stats.total} 条 · 内置 ${stats.builtin} · 自建 ${stats.custom} · 改过 ${stats.edited} · 停用 ${stats.off} · 正文合计 ${wordTotal} 字` }),
        h('div', { class: 'bc-spacer' }),
        button('新建条目', () => {
            const e = codexCreate();
            _openId = e.id;
            repaint();
        }),
        // ★ 第八批：图鉴自己的导出 / 导入（跟世界观档案是两套，互不混 ✓）
        button('导出图鉴', () => exportCodex()),
        button('导入图鉴', () => importCodex(repaint)),
        // ★ 2026-11-08：按种类整批停用 / 启用（条目多了，不能一条条点 ✓）
        button('按种类批量停用', () => openBulkStatus(repaint)),
        // ★ 2026-11-08：按种类整批恢复默认（她手动一条条恢复按不下去了）
        button('按种类恢复默认', () => openBulkReset(repaint)),
    ));

    // ---- 列表（只重画这一块：搜索框的焦点不能丢 ✓）----
    const listBox = h('div', { class: 'bc-codex-list' });
    b.appendChild(listBox);
    container.appendChild(box);
    // ★ 这个聊天的角色绑到哪一条（锚在编号上；对不上不默认当人类 ✓）
    container.appendChild(bindingsCard(repaint));
    // ★ 第六批：这一轮到底会发哪几族、哪几段、多少字（她靠这块验收）
    container.appendChild(sendCard(repaint));
    // ★ 第三批：条目这边 vs 原来那边的比对结果
    container.appendChild(shadowCard());

    function paintList() {
        clear(listBox);
        const all = codexEntries();
        const list = codexFilter(all, _q, _cat, _species);
        if (!list.length) {
            _page = 1;
            listBox.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的条目' }));
            return;
        }
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (_page > pages) _page = pages;
        if (_page < 1) _page = 1;
        const start = (_page - 1) * PAGE_SIZE;
        const pageItems = list.slice(start, start + PAGE_SIZE);
        // 翻页放上面：点下一页之后视野还在顶部，不用再往回滚 ✓
        if (pages > 1) {
            listBox.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-codex-pager' },
                button('上一页', () => { if (_page > 1) { _page--; paintList(); } }, { disabled: _page <= 1 }),
                h('span', { class: 'bc-hint', text: '第 ' + _page + ' / ' + pages + ' 页 · 共 ' + list.length + ' 条' }),
                button('下一页', () => { if (_page < pages) { _page++; paintList(); } }, { disabled: _page >= pages }),
            ));
        }
        for (const e of pageItems) {
            listBox.appendChild(h('div', {
                class: 'bc-codex-item' + (e.status === 'off' ? ' off' : ''),
                onclick: () => { _openId = e.id; repaint(); },
            },
                h('div', { class: 'bc-codex-main' },
                    h('div', { class: 'bc-codex-name', text: e.name || '（没有名字）' }),
                    h('div', { class: 'bc-codex-meta', text: metaLine(e) }),
                ),
                ...statusBadges(e),
            ));
        }
    }
    paintList();
}

// ---------------------------------------------------------------------------
// 按种类整批停用 / 启用
// ---------------------------------------------------------------------------

/**
 * ★ 2026-11-08（她要求能按种类整族一起关：条目多了，不能让玩家一条一条点）；
 *   同一天她又补：种类要能多选，也要能单选 ⇒ 这里点一行就是选一族，点几行就选几族 ✓
 *   分类 / 种类只管分组，停用是每一条自己的状态 ⇒ 走 codexSetStatusBySpecies 整批写 ✓
 */
/**
 * ★ 2026-11-08：批量操作（停用 / 恢复默认）共用的「按种类分组」。
 *   种类列表里没有「没有指定种类」那一批（人类、精灵、天使…都留空）⇒ 单列一行，别让它们选不到 ✓
 */
function bulkKinds() {
    const all = codexEntries();
    const kinds = [];
    for (const [k, l] of CODEX_SPECIES) {
        const rows = all.filter((e) => e.species === k);
        if (rows.length) kinds.push({ k, l, rows });   // 图鉴里没有条目的种类不占位置 ✓
    }
    const noneRows = all.filter((e) => !e.species);
    if (noneRows.length) kinds.push({ k: SPECIES_NONE_KEY, l: '（没有指定种类）', rows: noneRows });
    return kinds;
}

function openBulkStatus(repaint) {
    const kinds = bulkKinds();
    if (!kinds.length) {
        modal({
            title: '没有可批量处理的种类',
            width: 460,
            saveText: '知道了',
            hideCancel: true,
            build: (body) => body.appendChild(h('div', { class: 'bc-modal-text', text: '图鉴里的条目都还没指定种类。' })),
        });
        return;
    }
    // ⚠️ 打开时**不预选**任何种类：预填"当前筛选的那一族"会让人以为上一次选的还留着，
    //   再选一族就变成两族一起动（她 2026-11-08 就是被这个弄懵的）⇒ 每次从空开始，想关哪族自己点 ✓
    const picked = new Set();
    let action = 'off';

    const pickedKinds = () => kinds.filter((x) => picked.has(x.k));
    const namesOfPicked = (max = 4) => {
        const names = pickedKinds().map((x) => x.l);
        return names.length > max ? names.slice(0, max).join('、') + ' 等 ' + names.length + ' 种' : names.join('、');
    };

    const listBox = h('div', { class: 'bc-codex-species' });
    const info = h('div', { class: 'bc-hint' });

    const paintInfo = () => {
        if (!picked.size) {
            info.textContent = '还没有选种类：在上面点一行就行，只选一族、选好几族都可以。';
            return;
        }
        const rows = pickedKinds().flatMap((x) => x.rows);
        const on = rows.filter((e) => e.status === 'on').length;
        const off = rows.length - on;
        const hit = action === 'off' ? on : off;
        info.textContent = hit
            ? `已选 ${picked.size} 种（${namesOfPicked()}），共 ${rows.length} 条：在用 ${on} 条、已停用 ${off} 条。确定后把${action === 'off' ? '在用的 ' + hit + ' 条一起停用' : '已停用的 ' + hit + ' 条一起开回来'}。`
            : `已选 ${picked.size} 种（${namesOfPicked()}），共 ${rows.length} 条，${action === 'off' ? '现在没有在用的条目了' : '现在没有停用的条目'}，不用改。`;
    };
    const paintList = () => {
        clear(listBox);
        for (const x of kinds) {
            const on = picked.has(x.k);
            const inUse = x.rows.filter((e) => e.status === 'on').length;
            listBox.appendChild(h('div', {
                class: 'bc-row bc-wi-pick',
                title: on ? '点一下取消这一族' : '点一下选中这一族',
                // ★ 点的时候现查 picked（别用画这一行时算好的 on —— 重画跟不上时会按旧状态取反 ✗）
                onclick: () => {
                    if (picked.has(x.k)) picked.delete(x.k); else picked.add(x.k);
                    paintList(); paintInfo();
                },
            },
                h('span', { class: 'bc-label', text: x.l }),
                h('span', { class: 'bc-hint', text: `共 ${x.rows.length} 条，在用 ${inUse} 条` }),
                h('div', { class: 'bc-spacer' }),
                // 选中不靠整行变色（她那边会深蓝底、字看不见 ✗）⇒ 右边勾选框 + 文字两样都给 ✓
                on ? h('span', { class: 'bc-wi-tick', text: '已选' }) : null,
                h('span', { class: 'bc-check' + (on ? ' on' : '') }),
            ));
        }
    };

    modal({
        title: '按种类批量停用',
        width: 560,
        saveText: '确定',
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-row bc-codex-species-head' },
                h('span', { class: 'bc-label', text: '种类' }),
                h('div', { class: 'bc-spacer' }),
                button('全选', () => { for (const x of kinds) picked.add(x.k); paintList(); paintInfo(); }),
                button('全不选', () => { picked.clear(); paintList(); paintInfo(); }),
            ));
            body.appendChild(h('div', { class: 'bc-hint bc-codex-species-tip', text: '点一行选一族，可以只选一族，也可以多选。' }));
            body.appendChild(listBox);
            body.appendChild(field('要做什么', dropdown(action, [['off', '选中的全部停用'], ['on', '选中的全部重新启用']], (v) => {
                action = v; paintInfo();
            })));
            body.appendChild(info);
            paintList();
            paintInfo();
        },
        onSave: () => {
            if (!picked.size) {
                info.textContent = '先在上面点一行，选一个种类再点确定。';
                return false;        // 一个都没选就留在弹窗里，别让人以为点空了 ✓
            }
            let n = 0;
            try {
                n = codexSetStatusBySpecies([...picked], action === 'on');
            } catch (e) {
                // 写失败就把原因留在弹窗里（别静默关窗，那样看着像"点了没反应" ✗）
                console.warn('[Bodycord] 按种类批量改状态失败', e);
                info.textContent = '没改成：' + ((e && (e.message || e)) || '未知错误') + '。可以再点一次确定。';
                return false;
            }
            console.log(`[Bodycord] 按种类批量${action === 'off' ? '停用' : '启用'}：${namesOfPicked(99)} ${n} 条`);
            repaint();
            return true;
        },
    });
}

// ---------------------------------------------------------------------------
// 按种类批量恢复默认（2026-11-08）
// ---------------------------------------------------------------------------

/**
 * ★ 她：之前出过一次 bug，一堆条目被标成「改过」，手动一条条恢复按不下去了 ⇒
 *   要一个跟「按种类批量停用」同样形状的批量恢复。
 *
 * 口径（跟单条那颗按钮一致）：恢复默认 = 把这一条的覆盖整个删掉，所以
 *   **改过的内容和停用会一起回到内置状态**；弹窗里把这两样都写清楚，不埋伏笔 ✓
 */
function openBulkReset(repaint) {
    const kinds = bulkKinds();
    if (!kinds.length) {
        modal({
            title: '没有可批量恢复的种类',
            width: 460,
            saveText: '知道了',
            hideCancel: true,
            build: (body) => body.appendChild(h('div', { class: 'bc-modal-text', text: '图鉴里的条目都还没指定种类。' })),
        });
        return;
    }
    const picked = new Set();
    const pickedKinds = () => kinds.filter((x) => picked.has(x.k));
    const namesOfPicked = (max = 4) => {
        const names = pickedKinds().map((x) => x.l);
        return names.length > max ? names.slice(0, max).join('、') + ' 等 ' + names.length + ' 种' : names.join('、');
    };
    const listBox = h('div', { class: 'bc-codex-species' });
    const info = h('div', { class: 'bc-hint' });

    const paintInfo = () => {
        if (!picked.size) {
            info.textContent = '还没有选种类：在上面点一行就行，只选一族、选好几族都可以。';
            return;
        }
        const rows = pickedKinds().flatMap((x) => x.rows);
        const edited = rows.filter((e) => codexIsEdited(e.id)).length;
        const off = rows.filter((e) => e.status === 'off').length;
        info.textContent = `已选 ${picked.size} 种（${namesOfPicked()}），共 ${rows.length} 条：改过的 ${edited} 条、停用的 ${off} 条。确定后把改过的内容恢复成内置默认，停用的也一起开回来。`;
    };
    const paintList = () => {
        clear(listBox);
        for (const x of kinds) {
            const on = picked.has(x.k);
            const edited = x.rows.filter((e) => codexIsEdited(e.id)).length;
            listBox.appendChild(h('div', {
                class: 'bc-row bc-wi-pick',
                title: on ? '点一下取消这一族' : '点一下选中这一族',
                onclick: () => {
                    if (picked.has(x.k)) picked.delete(x.k); else picked.add(x.k);
                    paintList(); paintInfo();
                },
            },
                h('span', { class: 'bc-label', text: x.l }),
                h('span', { class: 'bc-hint', text: `共 ${x.rows.length} 条，改过 ${edited} 条` }),
                h('div', { class: 'bc-spacer' }),
                on ? h('span', { class: 'bc-wi-tick', text: '已选' }) : null,
                h('span', { class: 'bc-check' + (on ? ' on' : '') }),
            ));
        }
    };

    modal({
        title: '按种类恢复默认',
        width: 560,
        saveText: '确定',
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-row bc-codex-species-head' },
                h('span', { class: 'bc-label', text: '种类' }),
                h('div', { class: 'bc-spacer' }),
                button('全选', () => { for (const x of kinds) picked.add(x.k); paintList(); paintInfo(); }),
                button('全不选', () => { picked.clear(); paintList(); paintInfo(); }),
            ));
            body.appendChild(h('div', { class: 'bc-hint bc-codex-species-tip', text: '点一行选一族，可以只选一族，也可以多选。' }));
            body.appendChild(listBox);
            body.appendChild(info);
            paintList();
            paintInfo();
        },
        onSave: () => {
            if (!picked.size) {
                info.textContent = '先在上面点一行，选一个种类再点确定。';
                return false;
            }
            let n = 0;
            try {
                n = codexResetBySpecies([...picked]);
            } catch (e) {
                console.warn('[Bodycord] 按种类批量恢复默认失败', e);
                info.textContent = '没改成：' + ((e && (e.message || e)) || '未知错误') + '。可以再点一次确定。';
                return false;
            }
            console.log(`[Bodycord] 按种类批量恢复默认：${namesOfPicked(99)} ${n} 条`);
            repaint();
            return true;
        },
    });
}

// ---------------------------------------------------------------------------
// 第八批：图鉴自己的导入 / 导出
// ---------------------------------------------------------------------------

const IO_HELP = [
    '导出带你改过的、自建的、停用的条目；内置条目原样不重复导出（插件版本里本来就有）',
    '导入只动图鉴条目：角色绑定、聊天档案、剧情日期、记录一个字都不碰',
    '同一个编号：内容一样就跳过；不一样算冲突，逐条让你挑保留哪边，不闷头覆盖',
];

/** 导出成 JSON 文件（成功只写 console.log，不弹右上角 ✓） */
function exportCodex() {
    const payload = codexExportPayload();
    if (!payload.entries.length) {
        modal({
            title: '没有可导出的条目',
            width: 460,
            saveText: '知道了',
            hideCancel: true,
            build: (body) => body.appendChild(h('div', {
                class: 'bc-modal-text',
                text: '图鉴里现在没有你改过的或自建的条目。内置条目原样不进导出文件，所以现在导出来会是空的。',
            })),
        });
        return;
    }
    const blob = new Blob([codexExportText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    a.download = `bodycord-种族图鉴-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    console.log('[Bodycord] 已导出图鉴 ' + payload.entries.length + ' 条');
}

/** 选一个文件、读完先对一遍（还没写任何东西 ✓） */
function importCodex(repaint) {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('cancel', () => input.remove());
    input.addEventListener('change', async () => {
        const f = input.files?.[0];
        input.remove();
        if (!f) return;
        try {
            const text = await f.text();
            const parsed = parseCodexFile(text);
            const plan = planCodexImport(parsed.entries);
            showImportPlan(f.name, plan, repaint);
        } catch (err) {
            console.warn('[Bodycord] 图鉴导入失败', err);
            window.toastr?.error?.('这个文件读不了：' + (err?.message || err));
        }
    });
    document.body.appendChild(input);
    input.click();
}

/** 导入预览：新增几条、跳过几条、冲突逐条选 */
function showImportPlan(filename, plan, repaint) {
    const { add, same, conflicts } = plan;
    if (!add.length && !conflicts.length) {
        modal({
            title: '没有需要导入的条目',
            width: 460,
            saveText: '知道了',
            hideCancel: true,
            build: (body) => body.appendChild(h('div', {
                class: 'bc-modal-text',
                text: '这个文件里的 ' + same.length + ' 条和图鉴里的一模一样，没有要加或要改的。',
            })),
        });
        return;
    }

    // 冲突默认「保留我的」（宁可少改，也不替玩家覆盖 ✓）
    const picks = {};
    for (const c of conflicts) picks[c.id] = 'mine';

    modal({
        title: '导入图鉴',
        width: 720,
        help: IO_HELP,
        saveText: '导入',
        build: (body) => {
            body.appendChild(h('div', {
                class: 'bc-hint',
                text: '从「' + filename + '」读到 ' + (add.length + same.length + conflicts.length)
                    + ' 条：新增 ' + add.length + ' 条，一模一样 ' + same.length + ' 条，冲突 ' + conflicts.length + ' 条',
            }));
            if (add.length) {
                const names = add.slice(0, 6).map((e) => e.name).join('、')
                    + (add.length > 6 ? ' 等 ' + add.length + ' 条' : '');
                body.appendChild(h('div', { class: 'bc-hint', text: '新增的直接加进来：' + names }));
            }
            if (same.length) {
                body.appendChild(h('div', { class: 'bc-hint', text: '一模一样的不会重复导入，跳过 ' + same.length + ' 条' }));
            }
            if (conflicts.length) {
                body.appendChild(h('div', { class: 'bc-label', text: '编号一样的冲突，逐条选' }));
                for (const c of conflicts) {
                    body.appendChild(h('div', { class: 'bc-field' },
                        h('label', { class: 'bc-label', text: c.name + '（' + c.id + '）' }),
                        h('div', {
                            class: 'bc-hint',
                            text: '现在这一条是' + c.mineKind + '，和文件里不一样：' + (c.diff.length ? c.diff.join('、') : '内容不同'),
                        }),
                        dropdown(picks[c.id], [['mine', '保留我的'], ['file', '用文件里的']], (v) => { picks[c.id] = v; }),
                    ));
                }
            }
        },
        onSave: () => {
            const r = applyCodexImport(plan, picks);
            console.log('[Bodycord] 图鉴导入：新增 ' + r.added + ' 条，用文件里的 ' + r.replaced
                + ' 条，保留我的 ' + r.kept + ' 条，跳过 ' + same.length + ' 条');
            try { repaint?.(); } catch { /* 重画失败不影响已经写进去的条目 ✓ */ }
        },
    });
}

// ---------------------------------------------------------------------------
// 第二批：绑定（选条目 / 单独调 / 这个聊天的对照表）
// ---------------------------------------------------------------------------

/** 数值项在这一条里给的是什么（"这一条：12 到 15 个月"那行） */
function rowValueText(entry, r) {
    // ★ 第八批第二批：空着的项可能来自借用的那条，读数要把来源带出来
    const hit = resolveRowOf(entry, r.key);
    const row = hit.row || r;
    const fromName = (hit.layer === 'borrow' && hit.from) ? hit.from.name : '';
    const text = (() => {
        if (DICE_KEYS.has(row.key)) return diceHumanText(row.key, row.text);
        if (row.kind === 'range') {
            if (row.min == null && row.max == null) return '（不适用）';
            const unit = row.unit || scaleOf(entry);
            const lo = row.min == null ? '?' : row.min;
            const hi = row.max == null ? '?' : row.max;
            return (lo === hi ? String(lo) : lo + ' 到 ' + hi) + ' ' + unit;
        }
        if (row.kind === 'number') {
            return (row.num == null ? '（不接管）' : (row.num + ' ' + (row.unit || '周')));
        }
        return String(row.text || '').trim() || '（空）';
    })();
    return text + (fromName ? '（借用 ' + fromName + '）' : '');
}

function overrideRow(entry, r, draft, refs) {
    const cur = draft[r.key] || {};
    // ★ 第八批第二批：这一格现在生效的值可能来自「繁殖数据借用」
    const base = resolveRowOf(entry, r.key).row || r;
    const box = h('div', { class: 'bc-field' },
        h('label', { class: 'bc-label', text: r.label }),
        h('div', { class: 'bc-hint', text: '这一条：' + rowValueText(entry, r) }),
    );
    if (DICE_KEYS.has(r.key)) {
        // ★ 2026-11-06：单独调这三行也走栏目填，别在这里露 D100 原文
        const baseText = String(base.text || '');
        const curText = String(cur.text || '');
        box.appendChild(diceEditor(r.key, curText || baseText, (v) => {
            if (String(v) === baseText) delete draft[r.key];
            else draft[r.key] = { text: v };
        }, () => {}));
        return box;
    }
    // ★ 2026-11-06：**每一格都预填这一条现在的值**（她要求把默认值摆进格子里，别空着像装饰）——
    //   以前空着 = 跟随，看着像装饰 ✗。现在显示的是生效值，改回原值就等于恢复跟随 ✓
    if (r.kind === 'number') {
        const put = (v) => {
            const same = (v === '' || v === null) ? base.num == null : Number(v) === Number(base.num);
            if (same) delete draft[r.key];
            else draft[r.key] = { num: Number(v) };
        };
        const inp = numberInput(cur.num ?? base.num ?? '', put, { min: 0 });
        refs.push(() => { inp.value = base.num ?? ''; });
        box.appendChild(h('div', { class: 'bc-row' },
            fixedBox(inp, 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: r.unit || '周' }),
        ));
    } else if (r.kind === 'range') {
        const unit = r.unit || scaleOf(entry);
        const read = (el) => (el.value === '' ? null : Number(el.value));
        const put = () => {
            const min = read(minI);
            const max = read(maxI);
            const sameMin = min == null ? base.min == null : Number(min) === Number(base.min);
            const sameMax = max == null ? base.max == null : Number(max) === Number(base.max);
            if (sameMin && sameMax) delete draft[r.key];
            else draft[r.key] = { min, max };
        };
        const minI = numberInput(cur.min ?? base.min ?? '', put, { min: 0 });
        const maxI = numberInput(cur.max ?? base.max ?? '', put, { min: 0 });
        refs.push(() => { minI.value = base.min ?? ''; maxI.value = base.max ?? ''; });
        box.appendChild(h('div', { class: 'bc-row' },
            fixedBox(minI, 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: '到' }),
            fixedBox(maxI, 78),
            h('span', { class: 'bc-hint bc-inline-tip', text: unit }),
        ));
    } else if (r.kind === 'select') {
        const dd = dropdown(String(cur.text ?? base.text ?? ''), (r.options || []).map((o) => [o, o]), (v) => {
            if (String(v) === String(base.text || '')) delete draft[r.key];
            else draft[r.key] = { text: v };
        });
        refs.push(() => { /* 重画时按条目值重来 ✓ */ });
        box.appendChild(dd);
    } else if (r.kind === 'months') {
        const baseText = String(base.text || '');
        box.appendChild(monthsEditor(String(cur.text ?? baseText ?? ''), (v) => {
            if (String(v) === baseText) delete draft[r.key];
            else draft[r.key] = { text: v };
        }));
    } else {
        const inp = textInput(String(cur.text ?? base.text ?? ''), (v) => {
            const t = String(v).trim();
            if (!t) delete draft[r.key];
            else if (String(v) === String(base.text || '')) delete draft[r.key];
            else draft[r.key] = { text: v };
        }, { placeholder: '留空 = 跟随这一条' });
        refs.push(() => { inp.value = base.text || ''; });
        box.appendChild(inp);
    }
    return box;
}

/** 给某个对象单独调几项（空着 = 跟随它绑的那一条） */
export function openCodexOverrideEditor(key, onDone) {
    const entry = codexEntry(codexIdOf(key));
    if (!entry) return false;
    const draft = { ...codexOverrideOf(key) };
    const refs = [];
    modal({
        title: '单独调：' + entry.name,
        width: 640,
        help: [
            '每一格都填着这一条现在的值；改了就单独用这个值，改回原值 = 恢复跟随',
            '胎数 / 性别 / 同卵：只对下一次「胎数判定」生效，已经判过的那一胎不会改（想改那一胎用改数值）',
            '孕期 / 显怀范围 / 着床天数：下一次判定就按新值算',
            '单位 / 混血 / 产后恢复：这几项是文字，怎么读由判定那边决定',
            '周期长度 / 排卵日不在这里调：去「参数面板 → 身体基础参数」，那里就是这个人自己的值',
        ],
        onSave: () => {
            setCodexOverride(key, draft);
            try { onDone?.(); } catch { /* 忽略 */ }
        },
        build: (body) => {
            const host = h('div', {});
            const render = () => {
                clear(host);
                refs.length = 0;
                host.appendChild(h('div', { class: 'bc-hint', text: '这一条的值已经填在格子里；改了才算单独调，改回原值就恢复跟随。' }));
                // ★ 2026-11-08：性特征按哪一族（幽灵 / 僵尸这类要套生前那一族时用）
                try {
                    if (settings().sexTraitsOn === true) {
                        const bid = draft.sexBorrowId && typeof draft.sexBorrowId === 'object' ? String(draft.sexBorrowId.text || '') : '';
                        const be = bid ? codexEntry(bid) : null;
                        host.appendChild(h('div', { class: 'bc-field' },
                            h('label', { class: 'bc-label', text: '性特征按哪一族' }),
                            h('div', { class: 'bc-row bc-row-wrap' },
                                h('span', { class: 'bc-hint', text: be ? ('现在按「' + be.name + '」那一族写') : ('现在跟随这一条（' + entry.name + '）') }),
                                button('选一族…', () => {
                                    openCodexPicker({
                                        curId: bid,
                                        title: '性特征按哪一族',
                                        onPick: (picked) => {
                                            if (!picked || !picked.id) return;
                                            draft.sexBorrowId = { text: picked.id };
                                            render();
                                        },
                                    });
                                }),
                                be ? button('恢复跟随这一条', () => { delete draft.sexBorrowId; render(); }) : null,
                            ),
                            h('div', { class: 'bc-hint', text: '给幽灵 / 僵尸 / 丧尸这类用：挑生前那一族，发出去的就是那一族的性特征。' }),
                        ));
                    }
                } catch { /* 读不到设置就不画这一格 */ }
                // ★ 2026-11-08（她定的）：周期长度 / 排卵日不在「单独调」里画 ——
                //   参数面板「身体基础参数」那两格已经是这个人的个人值了，
                //   再放一份就是两个入口、两份存储互相盖，改哪边都可能对不上 ✗
                //   ⇒ 数值调整统一收到参数面板那处 ✓
                for (const r of entry.rows) {
                    if (r.key === 'cycle_len' || r.key === 'cycle_ovu') continue;
                    host.appendChild(overrideRow(entry, r, draft, refs));
                }
            };
            render();
            body.appendChild(host);
            body.appendChild(h('div', { class: 'bc-row' },
                button('全部恢复跟随', () => {
                    for (const k of Object.keys(draft)) delete draft[k];
                    for (const f of refs) f();
                    render();
                }),
            ));
        },
    });
    return true;
}

/** 从图鉴里挑一条（搜索名字 / 别名） */
export function openCodexPicker({ curId = '', onPick, onCustom = null, allowCustom = false, allowClear = false, onClear = null, title = '从图鉴里选一个种族' } = {}) {
    modal({
        title,
        width: 560,
        help: [
            '点一行就选它',
            '上面可以按分类、种类收窄，搜索框管名字和其他叫法',
            allowCustom ? '图鉴里没有的在最上面直接打名字；手打的名字不会绑定到条目上' : '直接打字也行，不过手打的名字不会绑定到条目上',
        ],
        build: (body, close) => {
            // ★ 2026-11-08：顶部这几行统一放进一个竖排容器，按 10px 间隔排（以前挤在一起）
            const top = h('div', { class: 'bc-codex-picker-top' });
            top.appendChild(h('div', { class: 'bc-hint', text: '点一行就选它；手打别的名字也能用，但那样不算绑定' }));
            if (allowCustom) {
                let custom = '';
                top.appendChild(h('div', { class: 'bc-row' },
                    h('div', { class: 'bc-dd-host' },
                        textInput('', (v) => { custom = v; }, { placeholder: '图鉴里没有的话，直接打名字（例：魔族）' })),
                    button('用这个名字', () => {
                        const nm = String(custom || '').trim();
                        if (!nm) return;
                        try { onCustom?.(nm); } catch (err) { console.warn('[Bodycord] 手打种族失败', err); }
                        try { close(); } catch { /* 忽略 */ }
                    }),
                ));
            }
            if (allowClear) {
                top.appendChild(h('div', { class: 'bc-row' },
                    button('清空这一格', () => {
                        try { onClear?.(); } catch (err) { console.warn('[Bodycord] 清空种族失败', err); }
                        try { close(); } catch { /* 忽略 */ }
                    }, { title: '把这一格清空，改回按图鉴绑定或推演报的种族' })));
            }
            const PICKER_PER = 20;
            const listHost = h('div', { class: 'bc-codex-list' });
            const pager = h('div', { class: 'bc-row bc-row-wrap' });
            const filterRow = h('div', { class: 'bc-row bc-row-wrap' });
            let q = '';
            let page = 1;
            let cat = '';
            let species = '';
            // 分类 / 种类跟图鉴列表同一套：先大类、再种类，种类只列这一类里有的（带条数）
            const paintFilters = () => {
                for (const el of [...filterRow.querySelectorAll('.bc-dd')]) el.remove();
                const all = codexEntries();
                const catCount = new Map();
                const spCount = new Map();
                for (const e of all) {
                    catCount.set(e.cat, (catCount.get(e.cat) || 0) + 1);
                    const k = e.cat + '|' + (e.species || '');
                    spCount.set(k, (spCount.get(k) || 0) + 1);
                }
                filterRow.appendChild(dropdown(cat, [['', '全部分类'], ...CODEX_CATS.map(([k, l]) => [k, l + '（' + (catCount.get(k) || 0) + '）'])], (v) => {
                    cat = v;
                    page = 1;
                    if (species && !spCount.has(cat + '|' + species)) species = '';
                    paintFilters();
                    draw();
                }));
                const spOpts = [['', '全部种类']];
                for (const [k, l] of CODEX_SPECIES) {
                    const n = cat ? (spCount.get(cat + '|' + k) || 0) : all.filter((e) => e.species === k).length;
                    if (!n) continue;
                    spOpts.push([k, l + '（' + n + '）']);
                }
                filterRow.appendChild(dropdown(species, spOpts, (v) => { species = v; page = 1; draw(); }));
            };
            const draw = () => {
                clear(listHost);
                clear(pager);
                const hit = codexFilter(codexEntries(), q, cat, species);
                if (!hit.length) {
                    listHost.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的条目' }));
                    return;
                }
                const total = Math.max(1, Math.ceil(hit.length / PICKER_PER));
                if (page > total) page = total;
                if (page < 1) page = 1;
                for (const e of hit.slice((page - 1) * PICKER_PER, page * PICKER_PER)) {
                    listHost.appendChild(h('div', {
                        class: 'bc-codex-item' + (e.id === curId ? ' on' : '') + (e.status === 'off' ? ' off' : ''),
                        onclick: () => {
                            try { onPick?.(e); } catch (err) { console.warn('[Bodycord] 选种族失败', err); }
                            try { close(); } catch { /* 忽略 */ }
                        },
                    },
                        h('div', { class: 'bc-codex-main' },
                            h('div', { class: 'bc-codex-name', text: e.name }),
                            h('div', { class: 'bc-codex-meta', text: metaLine(e) }),
                        ),
                        ...statusBadges(e),
                    ));
                }
                // ★ 2026-11-08：跟图鉴列表一样一页 20 条＋翻页（以前 706 条一条路滚到底 ✗）
                if (total > 1) {
                    pager.appendChild(button('上一页', () => { if (page > 1) { page--; draw(); } }, { disabled: page <= 1 }));
                    pager.appendChild(h('span', { class: 'bc-hint', text: '第 ' + page + ' / ' + total + ' 页' }));
                    pager.appendChild(button('下一页', () => { if (page < total) { page++; draw(); } }, { disabled: page >= total }));
                }
            };
            top.appendChild(textInput('', (v) => { q = v; page = 1; draw(); }, { placeholder: '搜索名字或其他叫法' }));
            top.appendChild(filterRow);
            body.appendChild(top);
            body.appendChild(listHost);
            body.appendChild(pager);
            paintFilters();
            draw();
        },
    });
}

/**
 * 「显示当前值、点一下开图鉴选择器」的控件（种族那一格用）。
 * 为什么不再用输入框：占满整行的大输入框会让人以为只能手打，手打入口收进选择器里更清楚。
 * @param {() => string} getValue 读当前显示值
 * @param {(entry: object|null, name?: string) => void} onPick 选中条目；手打/清空时 entry 为 null
 * @param {{curId?: (() => string)|string, title?: string}} opts
 */
export function codexPickControl(getValue, onPick, opts = {}) {
    const val = h('span', { class: 'bc-pick-value' });
    // ★ 2026-11-08（她指出：右边那句提示会让人以为只有文字能点，其实整格都能点）——
    //   ⇒ 右边不放字，改画一个下拉箭头（CSS 画的，不用字符，免得她机器上缺字）✓
    const caret = h('span', { class: 'bc-pick-caret' });
    const el = h('button', {
        class: 'bc-readout-box bc-pick-btn',
        type: 'button',
        title: opts.title || '点这里选',
        onclick: () => openCodexPicker({
            curId: typeof opts.curId === 'function' ? opts.curId() : (opts.curId || ''),
            allowCustom: true,
            allowClear: true,
            onPick: (e) => { try { onPick?.(e, e?.name || ''); } finally { paint(); } },
            onCustom: (nm) => { try { onPick?.(null, nm); } finally { paint(); } },
            onClear: () => { try { onPick?.(null, ''); } finally { paint(); } },
        }),
    }, val, caret);
    const paint = () => {
        const v = String(getValue() || '').trim();
        val.textContent = v || '未填';
        if (v) el.classList.remove('is-empty'); else el.classList.add('is-empty');
    };
    paint();
    return { el, paint };
}

const BIND_HELP = [
    '这里列的是这个聊天里的追踪对象，各自绑到图鉴的哪一条',
    '名字或其他叫法能对上的，会提示你绑定；对不上就标出来让你挑，不会默认当人类',
    '绑定锚在编号上：以后改了条目的名字，绑定不会断',
    '名字对不上图鉴的族，插件不会自己替你借某一族的数据，要你点一下「用这一条」才算数',
];

function bindStatusText(r) {
    switch (r.status) {
        case 'bound': return '已绑：' + r.entry.name + (r.overrides ? ' · 单独调了 ' + r.overrides + ' 项' : '');
        case 'matched': return '名字「' + r.race + '」能对上「' + r.matched.name + '」，还没绑';
        case 'temp': return '临时：图鉴里没有「' + (r.tempName || r.race) + '」，借用「' + (r.tempSource ? r.tempSource.name : '') + '」';
        case 'temp-pending':
            return '名字「' + r.race + '」图鉴里没有。以前自动借过「'
                + (r.pendingSource ? r.pendingSource.name : '一条')
                + '」，现在不借了，要借得你点一下';
        case 'ambiguous': return '名字「' + r.race + '」撞到 ' + r.cands.length + ' 条，要你挑';
        case 'unmatched': return '名字「' + r.race + '」一条都没对上';
        case 'missing': return '原来绑的条目已经不在图鉴里了';
        default: return '还没填种族';
    }
}

function bindActions(r, repaint) {
    const out = [];
    const pick = (label) => button(label, () => {
        openCodexPicker({
            curId: r.boundId,
            onPick: (e) => {
                setCodexIdOf(r.key, e.id);
                console.log('[Bodycord] 绑定种族', r.key, '→', e.id);
                repaint();
            },
        });
    });
    // ★ 2026-11-09（B 方案）：名字对不上时，插件**只把候选摆出来**，
    //   借不借、借哪一条由她点；点了才写 `confirmed` ✓
    const borrow = (label, entry) => button(label, () => {
        setTempRace(r.race, entry.id, true);
        console.log('[Bodycord] 确认临时种族', r.race, '→', entry.id);
        repaint();
    });
    if (r.status === 'matched') {
        out.push(button('绑定到「' + r.matched.name + '」', () => {
            setCodexIdOf(r.key, r.matched.id);
            console.log('[Bodycord] 绑定种族', r.key, '→', r.matched.id);
            repaint();
        }));
    }
    if (r.status === 'temp-pending') {
        if (r.pendingSource) out.push(borrow('用「' + r.pendingSource.name + '」的数据', r.pendingSource));
        out.push(button('不要，就不发这一族', () => {
            removeTempRace(r.race);
            console.log('[Bodycord] 不借了', r.race);
            repaint();
        }));
    }
    if (r.status === 'temp') {
        out.push(button('取消借用', () => {
            removeTempRace(r.race);
            repaint();
        }));
    }
    // 名字一条都没对上、但确实有"最像的几条" ⇒ 一次点击就能借（她确认过才生效 ✓）
    if ((r.status === 'unmatched' || r.status === 'ambiguous') && Array.isArray(r.near) && r.near.length) {
        const top = r.near[0];
        out.push(borrow('借「' + top.name + '」的数据', top));
    }
    if (r.status === 'bound') {
        out.push(pick('改绑'));
        out.push(button('单独调', () => { openCodexOverrideEditor(r.key, () => repaint()); }));
    } else {
        out.push(pick('挑一条'));
    }
    return out;
}

/**
 * ★ 第六批：这一轮会发什么。
 *
 * 她拿界面当验收台 ⇒ 这里要能直接看出三件事：
 *   ① 这一轮在场哪几个对象、发了哪几族；
 *   ② 每一族发的**哪几段**（介绍 / 生理 / 生育 / 补充）＋多少字、多少 token；
 *   ③ 名字对不上的种族会怎么办（发种族目录，不默认当人类）。
 */
function sendCard(repaint) {
    const box = section('这一轮会发什么', { help: SEND_HELP });
    const b = box.querySelector('.bc-section-body');
    // ★ 2026-11-09：介绍（外貌）这一段发不发主 API。默认关：
    //   角色卡自己写了外貌，图鉴再发一份会打架。
    //   只影响「介绍」这一段，生理 / 生育 / 补充照发 ✓
    const introOn = settings().codexIntroOn === true;
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap', style: { marginTop: '0' } },
        toggle(introOn, (v) => {
            settings().codexIntroOn = !!v;
            save();
            repaint?.();
        }),
        h('span', { class: 'bc-label', text: '发「介绍（外貌）」' }),
        h('span', {
            class: 'bc-hint',
            text: introOn
                ? '开：这一族的长相也会发给主 API。角色卡里已经写了外貌的话，两处说法容易打架'
                : '关：外貌交给角色卡，只发生理（生育、补充照发）。想让人形族之外的族也由图鉴管长相再打开',
        }),
    ));
    let plan = null;
    try { plan = buildCodexPlan(codexTargets(), { needRepro: codexNeedRepro, introOn: settings().codexIntroOn === true }); } catch { plan = null; }

    if (!plan || !plan.targetCount) {
        b.appendChild(h('div', { class: 'bc-empty', text: '这个聊天还没有追踪对象' }));
        b.appendChild(h('div', { class: 'bc-hint', text: '有对象之后，这里会列出这一轮会发哪几族、发哪几段、多少字' }));
        return box;
    }

    const sent = plan.entries.filter((e) => e.segments.length);
    if (sent.length) {
        b.appendChild(h('div', { class: 'bc-hint', text: `这一轮在场 ${plan.targetCount} 个对象，发 ${sent.length} 个种族的设定：这段一共 ${plan.chars} 字，约 ${formatTokens(plan.tokens)} token` }));
        for (const e of sent) {
            b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('div', { class: 'bc-codex-main' },
                    h('div', { class: 'bc-codex-name', text: e.name }),
                    h('div', { class: 'bc-codex-meta', text: e.segLabels.join('、') + (e.who.length ? ' · ' + e.who.join('、') : '') }),
                ),
                h('span', { class: 'bc-hint', text: e.chars + ' 字 · 约 ' + formatTokens(e.tokens) + ' token' }),
            ));
        }
    } else {
        b.appendChild(h('div', { class: 'bc-empty', text: '这一轮没有要发的种族设定' }));
        if (!plan.entries.length) {
            b.appendChild(h('div', { class: 'bc-hint', text: '在场对象还没对到图鉴条目；对上了才会发（人类也要对到人类那一条）' }));
        }
    }

    // 条目一个字都没写的：列出来，别让人以为"发了但看不见" ✓
    for (const e of plan.entries) {
        if (e.segments.length) continue;
        b.appendChild(h('div', { class: 'bc-hint', text: '· ' + e.name + ' 还没写正文，这一轮不会发' }));
    }
    for (const u of plan.unmatched) {
        const why = u.how === 'ambiguous' ? '撞到多条' : (u.how === 'missing' ? '原来绑的条目没了' : '一条都没对上');
        b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { class: 'bc-codex-main' },
                h('div', { class: 'bc-codex-name', text: '名字「' + u.race + '」' }),
                h('div', { class: 'bc-codex-meta', text: '图鉴里没对上（' + why + '），不会默认当人类，也不替你借别的族' }),
            ),
            h('span', { class: 'bc-hint', text: '会发一份种族目录' }),
        ));
    }
    return box;
}

/** 这个聊天的角色 → 图鉴的对照表 */
function bindingsCard(repaint) {    const list = chatBindings();
    const box = section('这个聊天的角色', { help: BIND_HELP });
    const b = box.querySelector('.bc-section-body');
    if (!list.length) {
        b.appendChild(h('div', { class: 'bc-empty', text: '这个聊天还没有追踪对象' }));
        b.appendChild(h('div', { class: 'bc-hint', text: '推演过一次、或者手动建过档之后，这里会列出每个角色绑到图鉴的哪一条' }));
        return box;
    }
    for (const r of list) {
        b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { class: 'bc-codex-main' },
                h('div', { class: 'bc-codex-name', text: r.name }),
                h('div', { class: 'bc-codex-meta', text: bindStatusText(r) }),
            ),
            ...bindActions(r, repaint),
        ));
    }
    return box;
}
