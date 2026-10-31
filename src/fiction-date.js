/**
 * fiction-date.js —— 剧情日期（虚拟日历 + 自定义历法）
 *
 * 定的方向：
 *   · 剧情里没给日期时，给一个初始的虚拟时间 ✓
 *   · 虚拟时间从 `1年01月01日` 开始显示就行 ✓
 *   · 肯定需要记录（指"上次月经是哪天"）✓
 *
 * ⇒ 规则：
 *   **① 剧情给了日期 ⇒ 就用剧情日期**（这套只管"剧情没给"的情况）
 *   **② 剧情没给 ⇒ 起一个初始虚拟时间，从「1年01月01日」开始推**
 *   **③ 只记【日期】、不看钟点**（不猜小时、不编未来时间）
 *   **④ 有剧情跨度才推进**（过夜 +1 天 / "三天后" +3 天）；**剧情完全没说 ⇒ 不推进**
 *
 * ⚠️ 这一套是**记录用的日历**，不是"模拟真实"。机制原则是
 *   游戏化 / 娱乐化 / 简单化 ⇒ 不要在这里引入时区、闰秒、天文历那些东西 ✗
 *
 * ---------------------------------------------------------------------------
 * ★★ 历法可以自定义（「自定义时间兼容」）
 *
 * 自定义时间兼容 —— 古代那种，或者其他什么称呼；
 *   **主要是非标准时间的，不只是替换了名字**（比如一个月 90 天、
 *   一年四个月、360 天这种，举个例子，肯定还有更多的）✓
 * 另外可以搞一个初始表，让玩家自己设定一年几个月、一个月多少天 ✓
 *
 * **模型**：`{ months: [每月多少天…], leap: 'gregorian' | 'none' }`
 *   · 数组**长度** = 一年几个月，第 i 个数 = 第 i 个月多少天
 *   · `leap:'gregorian'` 只在「正好 12 个月」时才算数（那是公历那套闰年）
 *   · 出厂 = 公历 ⇒ **老存档、老行为一个字都不变** ✓
 *   · 界面上目前只露「一年几个月 + 每月几天」（每月一样），
 *     但**内部存的就是这张表** ⇒ 以后要"某个月长一点"不用改数据结构 ✓
 *
 * ⚠️⚠️ 一条铁律：**历法是"日期怎么写"，不是"时间轴本身"** ⇒
 *   换历法时，已经记下的日期必须按「从纪元第一天起第几天」**天数守恒**地翻译
 *   （见 `convertDate()`）⇒ 周期第几天、孩子年龄、痕迹衰减全都不会跳 ✓
 *   （红线：任何改数值只需要去碰修改过的数据，其他数据别碰）
 * ---------------------------------------------------------------------------
 */

export const FICTION_DATE_START = '1年01月01日';

// ---------------------------------------------------------------------------
// 历法
//
// ★★ 加上「周」（"一周几天 + 纪元第一天是周几"✓）
//
// 两个字段（都在历法结构里，跟 months / leap 一层 ✓）：
//   · `weekLen`   —— 一周几天，1..60 ✓
//   · `weekStart` —— **纪元第一天（1年1月1日）是一周里的第几天**，**1 起算** ✓
// 口径跟节日表既有的 `wd` 一致：**0 起算、0 = 周日**（自定义历法下"周日"只是"第 0 天"那个名字 ✓）
//   ⇒ 星期几 = `weekday0(从纪元第一天起第几天, cal)`（见下面那一段 ✓）
// ---------------------------------------------------------------------------

/** 一周几天的上限（防手滑，也给界面当校验边界 —— 不是玩法限制 ✓） */
export const MAX_WEEK_LEN = 60;

/**
 * 出厂值（缺失 / 非法一律回这两个数，绝不抛 ✓）。
 *
 * ⚠️⚠️ `DEFAULT_WEEK_START = 2` 是**算出来的、不是随便填的**，改它之前先看这里 ——
 *   本文件那套"从纪元第一天起第几天"（`toAbs` / `absDayOf`）算的是**前推格里高利历**：
 *   第 0 天 = 1年1月1日，而那一天是**周一**（拿已知事实核过两个锚点：
 *   1年1月1日 = 周一、2026年5月1日 = 周五 ⇒ 见 自测脚本 的断言 ✓）。
 *   按 `weekday0 = (第几天 + weekStart - 1) % weekLen`、`0 = 周日` 的口径：
 *     填 1 ⇒ `weekday0(0) = 0` ⇒ 说 1年1月1日 是**周日**（错一天 ✗）
 *     填 2 ⇒ `weekday0(0) = 1` ⇒ 周一 ✓
 *   ⇒ **必须填 2**，否则整个公历的星期全体偏一天 ✗
 */
const DEFAULT_WEEK_LEN = 7;
const DEFAULT_WEEK_START = 2;

/** 出厂历法：公历（12 个月、平年 365 天、四年一闰、一周 7 天） */
export const GREGORIAN = Object.freeze({
    months: Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]),
    leap: 'gregorian',
    // ⚠️ 这两个值不是"凑出来的默认"，是公历的事实（为什么是 2 见上面那段 ✓）
    weekLen: DEFAULT_WEEK_LEN,
    weekStart: DEFAULT_WEEK_START,
});

/** 上限（防手滑，也给界面当校验边界）—— 不是玩法限制，是"填错了要拦住"的保险丝 */
export const MAX_MONTHS = 24;
export const MAX_DAYS_PER_MONTH = 999;

/** 一周几天（缺失 / 非整数 / 越界 ⇒ 回 7 ✓，绝不抛） */
function normalizeWeekLen(v) {
    const n = Number(v);
    return (Number.isInteger(n) && n >= 1 && n <= MAX_WEEK_LEN) ? n : DEFAULT_WEEK_LEN;
}

/**
 * 纪元第一天是一周里的第几天（1 起算；缺失 / 非整数 / 越界 ⇒ 回默认 ✓）。
 * ⚠️ 越界判据是 `1..weekLen`（不是 1..7）⇒ 一周只有 1 天时，默认那 2 也得压回 1 ✓
 */
function normalizeWeekStart(v, weekLen) {
    const L = normalizeWeekLen(weekLen);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= L) return n;
    return Math.min(DEFAULT_WEEK_START, L);
}

/**
 * 校验 + 规范化一份历法设定。
 * ⚠️ **认不出来就回公历，绝不抛异常**（存档坏了也要能打开 ✓）
 * ⚠️ 周那两个字段（`weekLen` / `weekStart`）缺失或非法也**回出厂值**（7 / 2 ✓，为什么是 2 见上面那段）
 * @returns {{months:number[],leap:'gregorian'|'none',weekLen:number,weekStart:number}}
 */
export function normalizeCalendar(raw) {
    const fallback = () => ({
        months: GREGORIAN.months.slice(),
        leap: GREGORIAN.leap,
        weekLen: GREGORIAN.weekLen,
        weekStart: GREGORIAN.weekStart,
        // ⚠️ 历法结构坏了也**别把写法一起清掉**（两件事，各兜各的 ✓）
        style: normalizeStyle(raw && typeof raw === 'object' ? raw.style : null, GREGORIAN.months.length),
        timeUnit: normalizeTimeUnit(raw && typeof raw === 'object' ? raw.timeUnit : null),
    });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback();
    const months = Array.isArray(raw.months) ? raw.months : null;
    if (!months || !months.length || months.length > MAX_MONTHS) return fallback();
    const out = [];
    for (const v of months) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 1 || n > MAX_DAYS_PER_MONTH) return fallback();
        out.push(n);
    }
    // 闰年只对"正好 12 个月"成立（自定义历法一律按"每月固定"算）
    const leap = (raw.leap === 'gregorian' && out.length === 12) ? 'gregorian' : 'none';
    // ★ 周：坏值一律兜回出厂那套（7 天 / 纪元那天是第 2 天 ✓）
    const weekLen = normalizeWeekLen(raw.weekLen);
    const weekStart = normalizeWeekStart(raw.weekStart, weekLen);
    // ★ 日期怎么写（第二步）：坏值一律兜回出厂写法 ✓
    // ★ ＋ 钟点粒度：老存档没有 ⇒ 兜回 `'none'`（＝只记日期 ✓）
    return { months: out, leap, weekLen, weekStart, style: normalizeStyle(raw.style, out.length), timeUnit: normalizeTimeUnit(raw.timeUnit) };
}

/** 两份历法是不是同一套（按内容比，不看引用 ✓） */
export function sameCalendar(a, b) {
    const x = normalizeCalendar(a);
    const y = normalizeCalendar(b);
    if (x.leap !== y.leap || x.months.length !== y.months.length) return false;
    // ★ 周也是历法的一部分（一周几天 / 纪元第一天是第几天 不一样 ⇒ 不是同一套 ✓）
    if (x.weekLen !== y.weekLen || x.weekStart !== y.weekStart) return false;
    return x.months.every((v, i) => v === y.months[i]);
}

/** 是不是出厂那套公历 */
export function isGregorian(cal) {
    return sameCalendar(cal, GREGORIAN);
}

/**
 * 历法指纹 —— 存进聊天数据，用来判断"这份数据是哪套历法写下来的"。
 * 老聊天没有这个字段 ⇒ 按公历算（它们确实是公历记的 ✓）
 */
export function calendarPrint(cal) {
    const c = normalizeCalendar(cal);
    return JSON.stringify({
        months: c.months, leap: c.leap, weekLen: c.weekLen, weekStart: c.weekStart,
        style: c.style, timeUnit: c.timeUnit,
    });
}

/** 指纹 → 历法（认不出来回公历 ✓） */
export function calendarFromPrint(text) {
    const s = String(text ?? '').trim();
    if (!s) return normalizeCalendar(GREGORIAN);
    try { return normalizeCalendar(JSON.parse(s)); } catch { return normalizeCalendar(GREGORIAN); }
}

/**
 * 组一份「每月都一样」的历法（界面上那几个数字走这里 ✓）。
 * @param {number} monthCount 一年几个月
 * @param {number} daysPerMonth 每个月几天
 * @param {number} [weekLen] 一周几天（不给 / 非法 ⇒ 7 ✓）
 * @param {number} [weekStart] 纪元第一天是一周里的第几天、1 起算（不给 / 非法 ⇒ 2 ✓）
 * @returns {{months:number[],leap:'none',weekLen:number,weekStart:number}|null} 数字不合法 ⇒ null（界面据此提示）
 */
export function makeUniformCalendar(monthCount, daysPerMonth, weekLen, weekStart) {
    const n = Math.floor(Number(monthCount));
    const d = Math.floor(Number(daysPerMonth));
    if (!Number.isFinite(n) || n < 1 || n > MAX_MONTHS) return null;
    if (!Number.isFinite(d) || d < 1 || d > MAX_DAYS_PER_MONTH) return null;
    // ★ 周也一起带上（不然界面上填好的"一周几天"会在下一次 setCalendar 时被规范化吃掉 ✗）
    const L = normalizeWeekLen(weekLen);
    return { months: Array(n).fill(d), leap: 'none', weekLen: L, weekStart: normalizeWeekStart(weekStart, L) };
}

/** 界面上那一行读数（例：`自定义（4 个月 × 90 天 = 360 天）`） */
export function calendarSummary(cal) {
    const c = normalizeCalendar(cal);
    const n = c.months.length;
    const total = c.months.reduce((a, b) => a + b, 0);
    // ★ 第二步：写法不是出厂那套时，顺手把"长什么样"带一句（拿 3年2月7日 举例 ✓）
    // ★ 这里原来写的是 `renderFictionDate`（**全仓没有这个函数**，
    //   真名是 `formatFictionDate`）⇒ 只要写法不是出厂那套（改过单位名 / 月份名 / 数字写法 /
    //   连接符任一项），这个三元就要求值 ⇒ 抛 ReferenceError ⇒ 设置页「时间与日历」整块挂掉 ✗
    //   （测试一直没抓到：旧断言只拿出厂写法调它，`isDefaultStyle` 为真 ⇒ 右边永不求值）
    const tail = isDefaultStyle(c.style) ? '' : '，日期写法：' + formatFictionDate({ y: 3, m: 2, d: 7 }, c);
    if (c.leap === 'gregorian') return `公历（12 个月，平年 ${total} 天，四年一闰）${tail}`;
    const uniform = c.months.every((v) => v === c.months[0]);
    const head = uniform
        ? `自定义（${n} 个月 × ${c.months[0]} 天 = 一年 ${total} 天）`
        : `自定义（${n} 个月，一年 ${total} 天）`;
    return head + tail;
}

/** 这套历法是不是"每月都一样"（界面用它决定那一格怎么显示 ✓） */
export function isUniformCalendar(cal) {
    const c = normalizeCalendar(cal);
    return c.months.every((v) => v === c.months[0]);
}

// ---------------------------------------------------------------------------
// ★★ 日期「怎么写」（写法模板）
//
// 起因：有的历法年月日都是自定义的名字（前面还提过"古代那种或者其他什么称呼"）
//   ⇒ 四样可配：
//     ① 三个**单位名**：年 / 月 / 日 各叫什么（「轮 / 朔 / 辰」）
//     ② 每个月的**名字**（1 月叫「孟春」）
//     ③ 每个数字**怎么写**：阿拉伯 / 中文数字 / 中文序数
//     ④ 三段之间用什么**连接**（`·`）
//
// ⚠️⚠️ 一条铁律：**数字是唯一真相，名字只是外衣** ——
//   算数永远走"从纪元第一天起第几天"这个整数，写法只负责**读进来**和**写出去** ✓
//   ⇒ 所以写法改了，时间轴一天都不会动（跟换历法走同一条"天数守恒"搬家 ✓）
//
// ⚠️ 出厂写法就是 `1年01月01日` ⇒ **老存档、老行为一字不变** ✓
// ---------------------------------------------------------------------------

/** 数字的三种写法（界面上那一格的下拉就用它 ✓） */
export const NUM_STYLES = [
    ['ar', '阿拉伯（1 / 2 / 3）'],
    ['cn', '中文数字（一 / 二 / 三）'],
    ['ord', '中文序数（初一 / 初二 / 初三）'],
];

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 数字 → 中文（0~9999；再大就退回阿拉伯数字，绝不瞎编 ✓） */
export function toCnNum(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v) || v < 0) return '';
    if (v > 9999) return String(v);
    if (v < 10) return CN_DIGITS[v];
    if (v < 20) return '十' + (v % 10 ? CN_DIGITS[v % 10] : '');
    if (v < 100) return CN_DIGITS[Math.floor(v / 10)] + '十' + (v % 10 ? CN_DIGITS[v % 10] : '');
    if (v < 1000) {
        const q = Math.floor(v / 100);
        const r = v % 100;
        const head = CN_DIGITS[q] + '百';
        if (r === 0) return head;
        if (r < 10) return head + '零' + CN_DIGITS[r];
        return head + toCnNum(r);
    }
    // ★ 四位数的分支以前**根本不存在** ——
    //   `q = Math.floor(v / 100)` 能到 99，而 `CN_DIGITS` 只有 0~9 ⇒ 1000~9999 会拼出
    //   `undefined百二十六` 这种串；那个串 `parseFictionDate` 又认不回来
    //   ⇒ 「年」用中文数字 / 中文序数且年份 ≥ 1000 时，日期**静默推不动** ✗
    const q = Math.floor(v / 1000);          // v ≤ 9999 ⇒ 1~9 ✓
    const r = v % 1000;
    const head = CN_DIGITS[q] + '千';
    if (r === 0) return head;
    if (r < 100) return head + '零' + toCnNum(r);   // 1005 / 1050 要带「零」
    return head + toCnNum(r);
}

/**
 * 中文（含序数、也含阿拉伯数字）→ 数字。
 * 认不出来 ⇒ null（调用方据此判"这个日期不合法" ✓）
 */
export function fromCnNum(text) {
    let t = String(text ?? '').trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    if (t.startsWith('初')) t = t.slice(1);          // 初一 / 初十
    const D = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (D[t] !== undefined) return D[t];
    let total = 0;
    let num = 0;
    let ok = false;
    for (const ch of t) {
        if (D[ch] !== undefined) { num = D[ch]; ok = true; continue; }
        if (ch === '十') { total += (num || 1) * 10; num = 0; ok = true; continue; }
        if (ch === '百') { total += (num || 1) * 100; num = 0; ok = true; continue; }
        // ★ 千位也得认回来 —— toCnNum 现在会写「一千二百三十四」，
        //   这里不认的话那个日期就永远读不回来（写出去读不回来 = 闭环断了 ✗）
        if (ch === '千') { total += (num || 1) * 1000; num = 0; ok = true; continue; }
        return null;
    }
    return ok ? total + num : null;
}

/** 出厂写法：`1年01月01日`（跟以前一字不差 ✓） */
export const DEFAULT_STYLE = Object.freeze({
    units: Object.freeze(['年', '月', '日']),
    nums: Object.freeze(['ar', 'ar', 'ar']),
    months: Object.freeze([]),
    sep: '',
});

// ---------------------------------------------------------------------------
// ★★ 钟点（先把小时和分钟做了 ✓）
//
// 形态：**三档** —— 不记钟点（**出厂＝这个，老行为一字不变** ✓）/ 记到小时 / 记到分钟
// 内部一律存「**当日第几分钟**」（0~1439）这一个整数 ✓（比存 `13:05` 字符串稳：
//   排序、比较、加减都是纯数字 ✓，换档也不用搬数据 ✓）
//
// ⚠️ **不碰**日期的存法：`fictionDate` 还是那个字符串 ⇒ 所有老机制（周期 / 受孕 /
//   痕迹 / 年龄 / 换历法搬家）**一行都不用改** ✓✓
// ---------------------------------------------------------------------------

/** 界面那一格的三档（顺序＝默认在最左 ✓） */
export const TIME_UNITS = [
    ['none', '不记钟点'],
    ['hour', '记到小时'],
    ['minute', '记到分钟'],
];

export function normalizeTimeUnit(v) {
    return (v === 'hour' || v === 'minute') ? v : 'none';
}

/** 当日第几分钟 → `13:05`（`'none'` 给空串 ✓；`'hour'` 只到整点 ✓） */
export function formatClock(min, unit) {
    const u = normalizeTimeUnit(unit);
    if (u === 'none') return '';
    let n = Math.floor(Number(min));
    if (!Number.isFinite(n)) n = 0;
    n = ((n % 1440) + 1440) % 1440;
    const h = Math.floor(n / 60);
    const mm = (u === 'hour') ? 0 : (n % 60);
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

const CN_CLOCK_DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

/**
 * 中文数字（0~59 够用）→ 整数；认不出来 ⇒ null。
 * 为什么要有：模型有时候会照抄剧情里的写法（「十一点三十四分」），
 * 只认阿拉伯数字的话这种整条认不出来 ⇒ 钟点静默停住 ✗
 */
function cnNum(str) {
    const s = String(str ?? '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    if (s === '零' || s === '〇') return 0;      // 「零点五分」那种整点 ✓
    const shi = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (shi) return (shi[1] ? CN_CLOCK_DIGITS[shi[1]] : 1) * 10 + (shi[2] ? CN_CLOCK_DIGITS[shi[2]] : 0);
    const one = s.match(/^[零〇]?([一二两三四五六七八九])$/);
    if (one) return CN_CLOCK_DIGITS[one[1]];
    return null;
}

/**
 * `13:05` / `13点` / `下午1点` 这种 → 当日第几分钟。
 * 认不出来 ⇒ **null**（调用方据此"宁可不动" ✓，别当 0 ✗）
 */
export function parseClock(text) {
    let s = String(text ?? '').trim();
    if (!s) return null;
    let pm = false;
    let am = false;
    let night = false;   // ★ 「晚上 / 夜里」这一类：12 点指午夜（0 点）✓
    if (/^(下午|晚上|傍晚|夜(里|间)?|晚)/.test(s)) {
        pm = true;
        night = /^(晚上|夜(里|间)?)/.test(s);
        s = s.replace(/^(下午|晚上|傍晚|夜(里|间)?|晚)/, '');
    }
    else if (/^(凌晨|早上|早晨|上午|清晨)/.test(s)) { am = true; s = s.replace(/^(凌晨|早上|早晨|上午|清晨)/, ''); }
    else if (/^中午/.test(s)) { pm = true; s = s.replace(/^中午/, ''); }
    let h = null;
    let m = 0;
    // ★ 剥掉时段词之后**先吃掉空格** ——
    //   以前两条正则都以 `^\d` 开头 ⇒ 「下午 3 点」「晚上 20:30」整条认不出来
    //   ⇒ 按"认不出来就不动"被吞掉，钟点静默不生效 ✗
    s = s.replace(/^\s+/, '');
    let mm = s.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})/);
    if (mm) { h = Number(mm[1]); m = Number(mm[2]); }
    else {
        mm = s.match(/^(\d{1,2})\s*[点时]\s*(\d{1,2})?\s*分?/);
        if (mm) { h = Number(mm[1]); m = Number(mm[2] || 0); }
    }
    // ★ 中文数字那一份（照抄剧情写法时会出现）：十一点 / 十一点三十四分 / 十一点半 / 零点五分 ✓
    if (h === null) {
        mm = s.match(/^([零〇一二两三四五六七八九十]+)\s*[点时]\s*(半|[零〇一二三四五六七八九十]+)?\s*分?/);
        if (mm) {
            const hh = cnNum(mm[1]);
            const mv = mm[2] === '半' ? 30 : (mm[2] ? cnNum(mm[2]) : 0);
            if (hh !== null && mv !== null) { h = hh; m = mv; }
        }
    }
    if (h === null || !Number.isFinite(h) || h > 24) return null;
    if (!Number.isFinite(m) || m > 59) return null;
    if (pm && h < 12) h += 12;                  // 下午 1 点 ⇒ 13 点 ✓
    if (am && h === 12) h = 0;                  // 凌晨 12 点 ⇒ 0 点 ✓
    // ★ 两个午夜口径统一 ——
    //   · 「晚上 12 点 / 夜里 12 点」= 午夜 ⇒ 0 点（以前留住 12 ⇒ 给的是**正午 12:00** ✗）
    //   · 「24:30」不是合法写法 ⇒ 拒（24 点只允许整点 ✓）
    if (night && h === 12) h = 0;
    if (h === 24 && m !== 0) return null;
    if (h === 24) h = 0;
    return ((h * 60 + m) % 1440 + 1440) % 1440;
}

/**
 * 校验 + 规范化一份写法（认不出来就回出厂写法 ✓，绝不抛）
 * @param {object} raw
 * @param {number} monthsCount 一年几个月（月份名那张表的长度按它裁 ✓）
 */
export function normalizeStyle(raw, monthsCount) {
    const base = {
        units: ['年', '月', '日'],
        nums: ['ar', 'ar', 'ar'],
        months: [],
        sep: '',
    };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const u = Array.isArray(raw.units) ? raw.units : [];
        for (let i = 0; i < 3; i++) {
            const v = u[i];
            // undefined / 非字符串 ⇒ 用出厂那个字；显式给空串 ⇒ **真的不要单位**（`第三轮·孟春·初七` 那种 ✓）
            if (typeof v === 'string') base.units[i] = v.trim().slice(0, 8);
        }
        const n = Array.isArray(raw.nums) ? raw.nums : [];
        for (let i = 0; i < 3; i++) {
            const v = String(n[i] ?? '');
            if (v === 'ar' || v === 'cn' || v === 'ord') base.nums[i] = v;
        }
        const cnt = Math.max(0, Math.min(Math.floor(Number(monthsCount) || 0), MAX_MONTHS));
        const ms = Array.isArray(raw.months) ? raw.months : [];
        for (let i = 0; i < cnt; i++) base.months.push(String(ms[i] ?? '').trim().slice(0, 8));
        // ★ 掐掉**末尾的空名字** —— 它跟"没有名字"是同一件事，但 JSON 长得不一样 ⇒
        //   会让 `calendarPrint()` 比出假的"不一样"（界面上那个"当前用的是预设「公历」"
        //   就是被它搞成永远不高亮的 ✗，被断言抓出来）
        while (base.months.length && !base.months[base.months.length - 1]) base.months.pop();
        if (typeof raw.sep === 'string') base.sep = raw.sep.slice(0, 4);
    }
    return base;
}

/** 写法是不是就是出厂那套（是的话解析可以直接走老那条路 ✓） */
export function isDefaultStyle(style) {
    const s = style || DEFAULT_STYLE;
    return (s.months || []).every((v) => !v)
        && (s.sep || '') === ''
        && (s.units || []).join('|') === '年|月|日'
        && (s.nums || []).join('|') === 'ar|ar|ar';
}

/**
 * 写法填得对不对（界面据此**拦住不存** + 给一句人话 ✓）。
 * @returns {string} 空串 = 没问题
 */
export function checkStyle(raw, monthsCount) {
    const st = normalizeStyle(raw, monthsCount);
    // ① 连接符空着时，三个单位都得有字 —— 不然拼出来的串认不回来
    //    （例：年月日都不填 + 没有连接符 ⇒ `10701` 这种，谁也解不出来 ✗）
    if (!String(st.sep || '') && st.units.some((u) => !String(u || '').trim())) {
        return '连接符空着的时候，年 / 月 / 日 三个单位都要填一个字，不然日期认不回来';
    }
    // ② 月份名不许重复、也不许只写数字（重了 / 混了都会认错）
    const seen = [];
    for (let i = 0; i < st.months.length; i++) {
        const n = String(st.months[i] || '').trim();
        if (!n) continue;
        if (/^\d+$/.test(n)) return '第 ' + (i + 1) + ' 个月的名字不能只写数字';
        if (seen.includes(n)) return '月份名不能重复：' + n;
        seen.push(n);
    }
    return '';
}

/** 一个数字按某种写法拼出来（月份有名字时外面不再拼单位 ✓） */
function renderNumBy(v, mode) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (mode === 'cn') return toCnNum(n) || String(n);
    // 序数：1~10 带「初」，11 起就是普通中文数字（初一…初十、十一…三十 ✓）
    if (mode === 'ord') return (n >= 1 && n <= 10) ? ('初' + toCnNum(n)) : toCnNum(n);
    return String(n).padStart(2, '0');
}

/**
 * 单位名拆成"数字前 / 数字后"两半 —— 单位里写 `#` 就是数字的位置 ✓
 *   例：`第#轮` ⇒ pre=`第` post=`轮` ⇒ 3 拼成「第三轮」
 *   例：`年`（没有 `#`）⇒ pre=`` post=`年` ⇒ 3 拼成「3年」（跟老写法一样 ✓）
 */
function unitParts(u) {
    const s = String(u ?? '');
    const i = s.indexOf('#');
    if (i < 0) return { pre: '', post: s };
    return { pre: s.slice(0, i), post: s.slice(i + 1) };
}

/** 把一段"数字的写法"套上单位名（`#` 是数字的位置 ✓） */
function withUnit(txt, unit) {
    const { pre, post } = unitParts(unit);
    return pre + txt + post;
}

/** 两段之间的连接符（空串就是直接连 ✓） */
function styleSep(style) {
    return String((style && style.sep) || '');
}

// ---------------------------------------------------------------------------
// 当前历法（由外壳注入，见 store.js 顶部的 setCalendarProvider ✓）
//
// 为什么要"注入"而不是直接 import settings：fiction-date 是**叶子模块**
//   （谁都能引、它不引别人 ⇒ 不会制造模块环 ✓）
// ---------------------------------------------------------------------------

let _provider = null;

/** 装一个"现在用哪套历法"的取值函数（store.js 在模块顶层装好 ✓） */
export function setCalendarProvider(fn) {
    _provider = (typeof fn === 'function') ? fn : null;
}

/** 现在生效的历法（没装 provider / 取值炸了 ⇒ 回公历 ✓，绝不抛） */
export function activeCalendar() {
    if (!_provider) return normalizeCalendar(GREGORIAN);
    try { return normalizeCalendar(_provider()); } catch { return normalizeCalendar(GREGORIAN); }
}

// ---------------------------------------------------------------------------
// 天数换算（内部一律用"从纪元 1年1月1日 起过了多少天"这个整数 ✓）
// ---------------------------------------------------------------------------

function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 某年某月多少天（`c` 必须是已规范的历法） */
function dimRaw(c, y, m) {
    if (!Number.isFinite(m) || m < 1 || m > c.months.length) return 0;
    if (c.leap === 'gregorian' && m === 2) return isLeap(y) ? 29 : 28;
    return c.months[m - 1];
}

/** 某年多少天（公历那年闰就 366 ✓） */
function diyRaw(c, y) {
    let n = 0;
    for (let m = 1; m <= c.months.length; m++) n += dimRaw(c, y, m);
    return n;
}

/** 一个月多少天（外面要用时走它 ✓） */
export function daysInMonthOf(cal, y, m) {
    return dimRaw(normalizeCalendar(cal), Math.floor(Number(y) || 1), Math.floor(Number(m) || 0));
}


/** 一年几个月 */
export function monthsPerYear(cal) {
    return normalizeCalendar(cal).months.length;
}

/** 天数 → 从元年 1/1 起算的绝对天数（用来做加减和差值） */
function toAbs(c, p) {
    let days = 0;
    for (let y = 1; y < p.y; y++) days += diyRaw(c, y);
    for (let m = 1; m < p.m; m++) days += dimRaw(c, p.y, m);
    return days + (p.d - 1);
}

function fromAbs(c, abs) {
    let rest = Math.max(0, Math.floor(abs));
    let y = 1;
    for (;;) {
        const n = diyRaw(c, y);
        if (rest < n) break;
        rest -= n;
        y += 1;
    }
    const nM = c.months.length;
    let m = 1;
    for (;;) {
        const n = dimRaw(c, y, m);
        if (rest < n) break;
        rest -= n;
        m += 1;
        if (m > nM) { m = 1; y += 1; }
    }
    return { y, m, d: rest + 1 };
}


// ---------------------------------------------------------------------------
// ★★ 星期（虚拟历法可以加"一周几天 + 纪元第一天是周几"✓）
//
// 口径跟节日表既有的 `wd` **完全一致**：0 起算、**0 = 周日** ✓
//   （自定义历法下"周日"只是"一周里第 0 天"那个名字，不一定是真实公历的周日 ✓）
// 算法：一切走 `toAbs()` 那个"从纪元第一天起第几天"的整数（跟换历法搬家用的是同一套守恒算法 ✓）
//   ⇒ 一周几天由 `weekLen` 定；纪元那天是一周里的第几天由 `weekStart` 定（1 起算 ✓）
// ⚠️ 真实公历那条**老路**（`new Date(...).getDay()`）留在 ui-calendar.js、一个字没动 ✓
//   这里这几个纯函数是给**自定义历法**用的 ✓
// ---------------------------------------------------------------------------

/**
 * 某年某月某日 ⇒ 从纪元第一天（1年1月1日）起第几天，**0 起算**（1年1月1日 ⇒ 0）。
 * 用途：算星期几（见 `weekday0`）—— 它跟 `toAbs()` 是**同一个整数** ✓
 * 认不出来的输入一律往下兜（绝不抛 ✓）
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @param {object} [cal] 不给就用当前生效的那套 ✓
 * @returns {number}
 */
export function absDayOf(y, m, d, cal) {
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    return toAbs(c, {
        y: Math.max(1, Math.floor(Number(y) || 1)),
        m: Math.max(1, Math.floor(Number(m) || 1)),
        d: Math.max(1, Math.floor(Number(d) || 1)),
    });
}

/**
 * 第 `dayIndex` 天是一周里的第几天（**0 起算**，0 = 周日 ✓）。
 * `weekStart` 是"纪元第一天是一周里的第几天"、**1 起算** ⇒ 减一挪到 0 基再对一周的天数取模 ✓
 * @param {number} dayIndex 从纪元第一天起第几天（0 起算，见 `absDayOf` ✓）
 * @param {object} [cal]
 * @returns {number} 0 .. weekLen-1
 */
export function weekday0(dayIndex, cal) {
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const n = Math.floor(Number(dayIndex));
    if (!Number.isFinite(n)) return 0;
    return ((n + (c.weekStart - 1)) % c.weekLen + c.weekLen) % c.weekLen;
}

/**
 * 某年某月**第 nth 个"周 wd"** 是几号（`wd`：0 = 周日…6 = 周六 ✓）——
 * 母亲节 / 父亲节 / 感恩节那种节日（节日表里的 `{ m, nth, wd }`）✓
 * 自定义历法走的就是它（一周几天按 `weekLen` ✓，不再是写死的 7 ✗）
 * @returns {number} 日号；参数不像话 / 算不出来 ⇒ 0（调用方再判"在不在这个月里" ✓）
 */
export function nthWeekdayInMonth(y, m, nth, wd, cal) {
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const n = Math.floor(Number(nth));
    const w = Math.floor(Number(wd));
    if (!Number.isFinite(n) || n < 1 || !Number.isFinite(w)) return 0;
    const first = weekday0(absDayOf(y, m, 1, c), c);              // 这个月 1 号是周几
    const off = ((w - first) % c.weekLen + c.weekLen) % c.weekLen; // 1 号之后第几天轮到 wd
    return 1 + off + (n - 1) * c.weekLen;
}

// ---------------------------------------------------------------------------
// 对外的四个函数（签名与以前一致，多了一个可选的历法参数 ✓）
// ---------------------------------------------------------------------------

/** 日期正则：日最多几位跟着历法走（公历 2 位、自定义大月 3 位）✓ */
const RE_CN2 = /^(\d{1,5})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/;
const RE_CN3 = /^(\d{1,5})\s*年\s*(\d{1,2})\s*月\s*(\d{1,3})\s*日?$/;
const RE_NUM2 = /^(\d{1,5})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const RE_NUM3 = /^(\d{1,5})[-/.](\d{1,2})[-/.](\d{1,3})$/;

/** 正则里要把用户填的字面量转义（单位名 / 连接符 / 月份名都可能带符号 ✓） */
function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 各写法的"数字长什么样"（给正则用） */
const NUM_RE = {
    ar: '\\d{1,5}',
    // ★ 字符类补上「千」、上限放宽到 10 ——
    //   不然「二千零二十六」这种四位中文年根本匹配不上（toCnNum 写得出来、这边读不回来 ✗）
    cn: '[零一二三四五六七八九十百千两]{1,10}',
    ord: '初?[零一二三四五六七八九十百千两]{1,10}',
};

/** 按这套写法拼一条正则（月那一格允许"数字"或"那个月自己的名字"；单位里 `#` 是数字的位置 ✓） */
function buildStyledRe(c) {
    const st = c.style;
    const names = (st.months || []).map((v) => String(v || '').trim()).filter(Boolean)
        .sort((a, b) => b.length - a.length).map(escRe);
    const mAlt = [NUM_RE[st.nums[1]] || NUM_RE.ar].concat(names).join('|');
    const sep = st.sep ? escRe(st.sep) + '?' : '';
    const wrap = (i, numRe) => {
        const { pre, post } = unitParts(st.units[i]);
        return (pre ? '(?:' + escRe(pre) + ')?' : '')
            + '(' + numRe + ')'
            + (post ? '(?:' + escRe(post) + ')?' : '');
    };
    return new RegExp(
        '^\\s*' + wrap(0, NUM_RE[st.nums[0]] || NUM_RE.ar) + '\\s*' + sep
        + '\\s*' + wrap(1, mAlt) + '\\s*' + sep
        + '\\s*' + wrap(2, NUM_RE[st.nums[2]] || NUM_RE.ar) + '\\s*$'
    );
}

/** 月份那一格：填的是名字就用那个名字对应的月，数字就按数字 ✓ */
function monthTokenToIndex(tok, c) {
    const t = String(tok ?? '').trim();
    const names = c.style.months || [];
    for (let i = 0; i < names.length; i++) {
        if (names[i] && names[i] === t) return i + 1;
    }
    return fromCnNum(t);
}

/** 三元组范围校验（两条解析路都走它 ✓） */
function checkParts(c, y, mo, d) {
    if (!Number.isFinite(y) || y < 1) return null;
    if (!Number.isFinite(mo) || mo < 1 || mo > c.months.length) return null;
    if (!Number.isFinite(d) || d < 1 || d > dimRaw(c, y, mo)) return null;
    return { y: Math.floor(y), m: Math.floor(mo), d: Math.floor(d) };
}

/**
 * 解析一个日期。**两条路都认** ✓
 *   ① 规范写法：`1年01月01日` / `1年1月1日` / `1-01-01` / `1/1/1`（老数据、玩家手打 ✓）
 *   ② 这套写法：单位名 / 月份名 / 中文数字 / 序数（「第三轮·孟春·初七」✓）
 * @param {string} text
 * @param {object} [cal] 不给就用当前生效的那套 ✓
 * @returns {{y:number,m:number,d:number}|null}
 */
export function parseFictionDate(text, cal) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    // ① 规范写法（日最多几位：跟着"最长的那个月"走 —— 公历 31 ⇒ 2 位，跟以前一字不差 ✓）
    const wide = c.months.some((v) => v > 99);
    let m = s.match(wide ? RE_CN3 : RE_CN2) || s.match(wide ? RE_NUM3 : RE_NUM2);
    if (m) return checkParts(c, Number(m[1]), Number(m[2]), Number(m[3]));
    // ★ **一串纯数字不许走写法那条路** ——
    //   写法正则里单位和连接符都是**可选**的 ⇒ `2026` 会被切成 20年02月06日（时间轴凭空跳 19 年 ✗）、
    //   `111` ⇒ {1,1,1}。下面那道 `isDefaultStyle` 只挡住出厂写法，改了写法就漏 ⇒
    //   这里按"没有任何写法特征（全是数字）⇒ 拒"兜住 ✓
    if (/^\d+$/.test(s)) return null;
    // ② 这套写法（出厂写法时不跑这条 —— 免得把 `10101` 这种怪东西认成日期 ✗）
    if (isDefaultStyle(c.style)) return null;
    let ms;
    try { ms = s.match(buildStyledRe(c)); } catch { ms = null; }
    if (!ms) return null;
    return checkParts(c, fromCnNum(ms[1]), monthTokenToIndex(ms[2], c), fromCnNum(ms[3]));
}

/**
 * 把一个日期拼成字符串（**按这套写法拼** ✓）
 *   · 出厂写法 ⇒ `1年01月01日`（跟以前一字不差 ✓）
 *   · 自定义写法 ⇒ 比如 `第三轮·孟春·初七`
 * ⚠️ 存进存档的就是这个串 ⇒ **写法改了要跟着"天数守恒"搬一次**
 *   （见 store.js 的 syncCalendarForChat ✓）
 * 超出这套历法的部分会夹到边界里 ✓
 */
export function formatFictionDate(parts, cal) {
    if (!parts) return '';
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const st = c.style;
    const nM = c.months.length;
    const y = Math.max(1, Math.floor(parts.y));
    const m = Math.min(nM, Math.max(1, Math.floor(parts.m)));
    const d = Math.min(dimRaw(c, y, m), Math.max(1, Math.floor(parts.d)));
    // 出厂那套走老路（保证跟以前输出的字符串**一字不差** ✓）
    if (isDefaultStyle(st)) {
        return `${y}${st.units[0]}${String(m).padStart(2, '0')}${st.units[1]}${String(d).padStart(2, '0')}${st.units[2]}`;
    }
    const name = String(st.months[m - 1] || '').trim();
    const yTxt = y > 9999 ? String(y) : renderNumBy(y, st.nums[0]).replace(/^0+(?=\d)/, '');
    const mTxt = name || renderNumBy(m, st.nums[1]);
    const dTxt = renderNumBy(d, st.nums[2]);
    const sep = styleSep(st);
    const seg = [
        withUnit(yTxt, st.units[0]),
        name ? name : withUnit(mTxt, st.units[1]),
        withUnit(dTxt, st.units[2]),
    ];
    return seg.join(sep);
}

/**
 * 顶栏那行「这是哪年哪月」（**跟着写法走** ✓）。
 * 例：出厂写法是 `1年02月`；自定义写法可能是 `第3轮·孟春` ✓
 * （面板的日历顶上要写它 —— 那份不该由面板自己拼，写法只有这一处知道 ✓）
 */
export function monthLabelOf(y, m, cal) {
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const st = c.style;
    const yy = Math.max(1, Math.floor(Number(y) || 1));
    const mm = Math.min(c.months.length, Math.max(1, Math.floor(Number(m) || 1)));
    const name = String(st.months[mm - 1] || '').trim();
    const yTxt = yy > 9999 ? String(yy) : renderNumBy(yy, st.nums[0]).replace(/^0+(?=\d)/, '');
    const mTxt = renderNumBy(mm, st.nums[1]);
    return withUnit(yTxt, st.units[0]) + styleSep(st) + (name || withUnit(mTxt, st.units[1]));
}

/** 往后推 n 天（n 可以给 0；负数就往前） */
export function addDays(text, n, cal) {    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const p = typeof text === 'string' ? parseFictionDate(text, c) : text;
    if (!p) return '';
    return formatFictionDate(fromAbs(c, toAbs(c, p) + Math.floor(Number(n) || 0)), c);
}

/**
 * 两个日期差几天（b − a）⇒ 用来算「周期 DayX = 今天 − 上次月经那天 + 1」
 * @returns {number|null} 算不出来返回 null（别把 null 当 0 ✗）
 */
export function diffDays(a, b, cal) {
    const c = cal ? normalizeCalendar(cal) : activeCalendar();
    const pa = typeof a === 'string' ? parseFictionDate(a, c) : a;
    const pb = typeof b === 'string' ? parseFictionDate(b, c) : b;
    if (!pa || !pb) return null;
    return toAbs(c, pb) - toAbs(c, pa);
}

/**
 * ★★ 换历法的核心：把一个日期从一套历法翻译到另一套。
 *
 * 判据是**天数守恒** —— 时间轴上的"第几天"不变，变的只是怎么写 ✓
 * 所以：周期第几天、孩子年龄、痕迹衰减、判定时机**一个都不会跳** ✓
 *
 * @returns {string} 翻译不了（原日期本身就认不出来）⇒ 空串（调用方原样保留 ✓）
 */
export function convertDate(text, fromCal, toCal) {
    const from = normalizeCalendar(fromCal);
    const to = normalizeCalendar(toCal);
    const p = parseFictionDate(text, from);
    if (!p) return '';
    return formatFictionDate(fromAbs(to, toAbs(from, p)), to);
}

// 死代码清理：`looksLikeDate(text)` 全仓（含测试）无引用 ⇒ 删掉 ✓
//   要判"像不像日期"直接用 `parseFictionDate()` 就够了（它本来就是"认不出来返回 null"）
