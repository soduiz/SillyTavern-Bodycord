/**
 * serialize.js —— 把结构化状态拼成面板认识的文字
 *
 * 关键：Bodycord 面板是「读一段 <status_profile> 文字 → 自己画界面」。
 * 所以这里只要拼出跟原来一模一样的文字格式，面板就能原样工作，它的解析器一个字都不用改。
 *
 * 另外：被「字段开关」关掉的字段，这里直接不写 —— 面板上自然就不显示。
 */

import { isFieldOn } from './settings.js';

// 数据项与状态条的中文序号（面板是按「数据项一」「状态条一」这种 key 取行的）
const D_KEY = { d1: '一', d2: '二', d3: '三', d4: '四', d5: '五', d6: '六', d7: '七', d8: '八', d9: '九' };
const ROW_KEY = { row1: '一', row2: '二', row3: '三' };

// 带固定标签的项
const D_LABEL = {
    d1: '阶段基础率',
    d2: '累计受孕率',
    d3: '体质系数',
    d4: '致孕方',
    d6: '胎儿状态',
    d8: '生产次数',
};
// d5 / d7 / d9 是「可能整条未加载」的项
const D_BARE = ['d5', 'd7', 'd9'];
// 但这三项在「有值」的时候，面板是读 `|` 后面的第二段来显示的
//（比如敏感带那一页读的就是 d9[1]）。所以有值时必须带上标签，
// 否则面板会一直显示「暂无数据」——这就是之前敏感带填了却不显示的根因。
const BARE_LABEL = { d5: '意识状态', d7: '泌乳状态', d9: '敏感带' };

const ROW_LABEL = {
    row1: '🌸 | 生理状态',
    row2: '🌡️ | 身体状况',
    row3: '💧 | 近期性行为',
};

function clean(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\r?\n/g, ' ').trim();
}

/**
 * ★ 2026-10-29（她：快照里三条记录粘成一句）——
 * 状态条是多行值（row3 一条一行），而**面板文字一行一个字段**，所以必须压成一行。
 *   `clean()` 是拿空格压的 ⇒ 三条就变成「…射入口腔 示例甲 & …」，读起来还是一句话 ✗
 * ⇒ 这里按行拼：上一行已经有句末标点的用空格，没有的补一个「；」（**只动边界标点** ✓）。
 */
function rowLine(v) {
    const parts = String(v ?? '').split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
    let out = '';
    for (const one of parts) {
        if (!out) { out = one; continue; }
        out += /[。！？!?；;]$/.test(out) ? ' ' : '；';
        out += one;
    }
    return out;
}

/**
 * ★ 「计算说明」末尾不再重复「致孕方锁定：名字」（2026-10-22 她报的"算重复信息吗"）。
 *
 * 为什么：同一屏上「数据项四 · 致孕方」已经把名字写了一遍，
 *   计算说明是**说明**那一行，里面再抄一次名字只是让人把同一件事读两遍。
 *   名字是从【喂回给模型的判定那一行】抄过来的（那份照旧带名字 —— d6 的归属要靠它照抄 ✓），
 *   所以这里只在**拼面板文字时**剥掉尾巴，不改档案里的值、也不动提示词 ✓
 *
 * ⚠️ 只剥**末尾**那一段（`| 致孕方锁定：…`），前面的计算过程一个字不动；
 *    剥完如果什么都不剩 ⇒ 原样留着（宁可重复，也别让这一行空掉 ✓）
 */
function dropLockTail(txt) {
    const raw = String(txt || '');
    let out = raw;
    for (let i = 0; i < 4; i++) {
        const next = out.replace(/\s*[|｜]\s*致孕方锁定\s*[:：][^|｜]*$/u, '').trim();
        if (next === out) break;
        out = next;
    }
    return out || raw;
}

/**
 * ★ d9（敏感带）专用：**不要**把换行压成空格，压成「·」。
 *
 * 为什么：`clean()` 把换行换成空格，可**面板文字是"一行一项"的**，而面板的 `parseZones()`
 *   只按 `·、；;｜|\n` 切条 ⇒ 一整行用空格连起来的 5 个部位会被它算成**1 处** ✗
 *   （多个敏感带被判为一个，就是这个：面板文字里成了
 *   `耳朵 1级（累计刺激 5） 脖子 1级（累计刺激 5） …`；`profile.d9` 本身还是多行 ⇒ 「改数值」那边看着正常 ✓）。
 * `·` 是面板认的条目分隔符，而且 `serializeZoneRows()` 已经把备注里的 `·` 换掉了 ⇒ 没有歧义 ✓
 */
function cleanZones(v) {
    if (v === null || v === undefined) return '';
    // ⚠️ 别顺手把已有的 `·` 两边的空格也规范掉：老数据就长成 `甲 · 乙`，
    //   把它掰成 `甲·乙` 会让"原样透传"的回归断言变红（没必要动的东西别动 ✓）
    return String(v).replace(/\r?\n+/g, '·').trim();
}

/**
 * 面板的名字是正则 name="..." 抓出来的，
 * 所以名字里不能有引号、尖括号，否则整个面板会解析失败。
 */
function safeName(v) {
    const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
    return s.replace(/["<>]/g, '').slice(0, 60) || '对象';
}

/**
 * @param {string} name     面板上显示的名字
 * @param {object} profile  { title, phase, sub, minor, calc, d1..d9, row1..row3 }
 * @param {object|null} period { day, flow, color, texture, pain, desc }
 * @returns {string} 面板能直接吃的文字
 */
// ---------------------------------------------------------------------------
// 标题图标由**插件**加，不让 AI 写
//
// 以前契约里写着「title 填 🌙 生理周期监测 或 🌟 孕期健康监测」，让模型自己挑表情 ——
// 但那是插件早就知道的事（看 Is_Pregnant 就行），让模型写只会多一个出错点：
// 它可能写错图标、加两个、或者干脆不加。
// 所以：把 AI 写的表情剥掉，由插件统一补上正确的那一个。
// ---------------------------------------------------------------------------

const ICON_PREG = '🌟';
const ICON_CYCLE = '🌙';

/** 去掉开头的一串表情符号（拿不到 Unicode 属性支持时退回一个保守写法） */
function stripLeadingEmoji(txt) {
    const t = String(txt || '');
    try {
        return t.replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0F\u200D\s]+/u, '').trim();
    } catch {
        // 老引擎：只削掉常见的表情区间
        return t.replace(/^[\u2190-\u2BFF\u2600-\u27BF\uFE0F\u200D\s]+/, '').trim();
    }
}

/** 把 AI 写的标题规整成「图标 + 文字」 */
export function normalizeTitle(title, isPregnant) {
    const bare = stripLeadingEmoji(title);
    const fallback = isPregnant ? '孕期健康监测' : '生理周期监测';
    return (isPregnant ? ICON_PREG : ICON_CYCLE) + ' ' + (bare || fallback);
}

export function buildStatusProfile(name, profile = {}, period = null, opts = {}) {
    const p = profile || {};
    const L = [];
    const who = safeName(name);

    L.push(`<status_profile name="${who}">`);
    // 图标由插件补（见 normalizeTitle），不依赖模型写对
    // ★ 标题**完全由插件算**：不读 p.title。
    //   契约已经不向模型要 title 了，但老聊天里可能存着旧值 ——
    //   如果继续读它，会一直显示当初模型写的那个（或别人手改的），跟 isPregnant 脱节。
    if (isFieldOn('title')) L.push(`状态标题：${normalizeTitle('', !!opts.isPregnant)}`);
    if (isFieldOn('phase') || isFieldOn('sub')) {
        L.push(`进度描述：${clean(p.phase) || '监测中'} | ${clean(p.sub)}`);
    }
    if (isFieldOn('minor')) L.push(`次要描述：${clean(p.minor)}`);
    if (isFieldOn('calc')) L.push(`计算说明：${dropLockTail(clean(p.calc))}`);

    for (const k of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']) {
        if (!isFieldOn(k)) continue;
        const v = (k === 'd9') ? cleanZones(p[k]) : clean(p[k]);
        // ⚠️ 这里**不许**剔「强度」：这份 raw 同时给面板用（面板要显示强度）；
        //   只有发给插件 API 的提示词才剔，见 judge.js 里对 messages 的处理 ✓
        if (D_BARE.includes(k)) {
            let val = v || '未加载';
            // 有内容但没带标签时补上，保证面板的 xxx[1] 能取到东西
            if (val !== '未加载' && val !== '无' && !/[|｜]/.test(val)) {
                val = `${BARE_LABEL[k]} | ${val}`;
            }
            L.push(`数据项${D_KEY[k]}：${val}`);
        } else {
            // ⚠️ 2026-10-31（她报：生产次数那格的值又写了一遍标题）——
            //   老写入路径把标签一起存进了这一格（d8 存成「生产次数 | 0」）⇒
            //   这里再拼一遍就变成「生产次数 | 生产次数 | 0」，面板取第二段正好取到标题 ✗
            //   ⇒ 值里已经带同一个标签就先剥掉；d8 只剩纯数字时补上「次」
            let val = v || '无';
            const dup = new RegExp(`^${D_LABEL[k]}\\s*[|｜]\\s*`);
            if (dup.test(val)) val = val.replace(dup, '').trim();
            if (k === 'd8' && /^\d+$/.test(val)) val += ' 次';
            L.push(`数据项${D_KEY[k]}：${D_LABEL[k]} | ${val}`);
        }
    }

    for (const k of ['row1', 'row2', 'row3']) {
        if (!isFieldOn(k)) continue;
        L.push(`状态条${ROW_KEY[k]}：${ROW_LABEL[k]} | ${rowLine(p[k]) || '无'}`);
    }

    L.push('</status_profile>');

    if (period && (period.day || period.flow || period.desc)) {
        L.push('');
        L.push(buildPeriodProfile(who, period));
    }

    return L.join('\n');
}

export function buildPeriodProfile(name, period = {}) {
    const who = safeName(name);
    return [
        `<period_profile name="${who}">`,
        `第几天：${clean(period.day) || '—'}`,
        `流量：${clean(period.flow) || '—'}`,
        `颜色：${clean(period.color) || '—'}`,
        `质地：${clean(period.texture) || '—'}`,
        `痛经：${clean(period.pain) || '—'}`,
        `经期症状：${clean(period.desc) || '—'}`,
        '</period_profile>',
    ].join('\n');
}

/** 还没推演过时的占位面板 */
export function emptyProfile(isPregnant = false) {
    return {
        title: isPregnant ? '🌟 孕期健康监测' : '🌙 生理周期监测',
        phase: '待初始化',
        sub: '—',
        minor: '当前时间: — / 当前防护: — / 近期风险: —',
        calc: '尚未推演',
        d1: '不适用', d2: '0%', d3: '1.0', d4: '无',
        d5: '未加载', d6: '无', d7: '未加载', d8: '0 次', d9: '未加载',
        row1: '等待第一次状态推演',
        row2: '—',
        row3: '无',
    };
}
