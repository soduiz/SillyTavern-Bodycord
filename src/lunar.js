/**
 * lunar.js —— 农历 ↔ 公历（**只干这一件事** ✓）
 *
 * ★ 先去找一份现成的农历资料 ✓
 *   （更早一天踩过刹车 —— 觉得这事每年都不一样、太麻烦；
 *     现在有了**验过的**数据源，这刀才敢下 ✓）
 *
 * ⚠️⚠️ 数据源与**校验结论**（这一段是这一刀的依据，别删）：
 *
 *   表来自 `solarlunar@3.1.0`（unpkg）：https://unpkg.com/solarlunar@3.1.0/dist/solarlunar.cjs
 *   它是 Ajing(JJonline) 那套广为人知的 `lunarInfo`（一年一个 0x 压缩整数，1900–2100）。
 *   ⚠️ 那个仓库 issue 列表里有一条标题就叫「数据源有错」⇒ **不盲信**，先算后核 ✓
 *
 *   用**这张表**算出来的，跟权威来源**逐个对过**（全部一致 ✓）：
 *     · 2025 春节 = 2025-01-29 —— 国务院办公厅《关于2025年部分节假日安排的通知》：
 *       「春节：1月28日（农历除夕、周二）至2月4日（农历正月初七、周二）」
 *       ⇒ 除夕 1/28 ⇒ 正月初一 = 1/29 ✓
 *       https://www.gov.cn/gongbao/2024/issue_11726/202411/content_6989767.html
 *     · 2026 春节 = 2026-02-17 —— 国务院办公厅《关于2026年部分节假日安排的通知》：
 *       「春节：2月15日（农历腊月二十八、周日）至23日（农历正月初七、周一）」
 *       ⇒ 2/15 = 腊月廿八、2/23 = 正月初七 ⇒ 正月初一 = 2/17 ✓
 *       https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 *     · 2027 春节 = 2027-02-06 ／ 2028 春节 = 2028-01-26 —— 澎湃新闻转赣南日报，
 *       引中国科学院紫金山天文台科普主管王科超：「从2025年开始直到2029年，连续5年的除夕
 *       都是"大年二十九"。这些日子分别是：2025年1月28日、2026年2月16日、2027年2月5日、
 *       2028年1月25日、2029年2月12日」⇒ 除夕 + 1 天 = 正月初一 ✓
 *       https://m.thepaper.cn/newsDetail_forward_29545101
 *     · 2025 端午 = 2025-05-31 —— 2025 年放假通知：「端午节：5月31日（周六）至6月2日」✓
 *     · 2026 端午 = 2026-06-19 ／ 2026 中秋 = 2026-09-25 —— 2026 年放假通知：
 *       「端午节：6月19日…」「中秋节：9月25日…」✓
 *     · 2025 中秋 = 2025-10-06 —— 新华社《秀我中国丨最晚中秋巧遇超级月亮》：
 *       「10月6日迎中秋，今年的中秋节是本世纪最晚中秋」
 *       https://www.news.cn/20251006/5166b16ac4ac434ba6f3c4fcb3c02dde/c.html
 *     · 旁证（口径）：那张「除夕连着 5 年都是廿九」的表，跟本表 `monthDays(2025..2028, 12)`
 *       全是 **29** 完全对上；而 `monthDays(2022, 12) = 30`（2023-01-21 是年三十）也跟
 *       民间历法一致 ✓ ⇒ 表没有"整表移位"这类硬错 ✓
 *
 *   ⇒ 结论：**这张表可以用**（至少 2025–2028 这段逐个权威核过 ✓）。
 *
 * ⚠️ 抄表规矩：**只抄 `lunarInfo`**（加公历每月天数的那个小表）——
 *   原库里的干支 / 生肖 / 节气 / 节日 / 中文写法**一个都不抄**（这插件用不着 ✓）。
 *   本文件是**叶子**（不 import 任何东西 ✓）⇒ 放 import 链上不会造环 ✓
 *
 * ⚠️ 口径（两处都见断言）：
 *   ① **闰月不匹配**：`08-15` 只认"正常八月十五"，**闰八月十五不算中秋** ✗
 *      （闰月是历法里的"重复那个月"，把它当中秋会一年过两个 / 或者过错日子 ✓）
 *   ② **腊月最后一天不许写死 `12-30`**：腊月有的年 29 天、有的年 30 天 ✗
 *      ⇒ 多给一种写法 `<MM>-LAST` = "那个农历月的最后一天" ⇒ 除夕 = `12-LAST` ✓
 *      （写死 `12-30` 的后果：2025–2028 连着几年除夕都是廿九 ⇒ 那几年**除夕直接消失** ✗✗）
 */

/**
 * 农历 1900–2100 的**闰月 + 大小月**压缩表（一年一个整数）。
 * 位含义（原库口径，别改）：
 *   · `& 0x000f`            = 闰月是几月（0 = 那一年没有闰月）
 *   · `& 0x10000`           = 闰月是**大月**（30 天）；不置位 = 小月（29 天）
 *   · `& 0x8000 … & 0x0010` = 正月 … 腊月的**每月天数**（置位 = 30 天，不置位 = 29 天）
 *     （`0x8000` 对正月、`0x0010` 对腊月 —— 正好是 `0x10000 >> 月份` ✓）
 * ⚠️ **这张表必须原样抄**（一个 0x 都别手改）—— 它已经被 2025–2028 那些权威日期钉住了 ✓
 *   修改 / 替换它之前，先把本文件顶上那段校验**重跑一遍** ✗
 */
const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520, // 2100
];

/** 表的覆盖范围（**超出就返回 null，绝不抛错** ✓） */
export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;

/** 表里第一天的公历时刻 = 农历 1900 年正月初一 = **1900-01-31** ✓ */
const LUNAR_EPOCH_UTC = Date.UTC(1900, 0, 31);

const DAY_MS = 86400000;

/** 两位补零（`09-05` 那种写法 ✓） */
function pad2(n) {
    return String(n).padStart(2, '0');
}

/** 那一年在表里吗（整数、且在 1900–2100） */
function inTable(ly) {
    return Number.isInteger(ly) && ly >= LUNAR_MIN_YEAR && ly <= LUNAR_MAX_YEAR;
}

/**
 * 农历 `ly` 年的闰月是几月（**0 = 那一年没有闰月** ✓）
 * 年份不在表里 ⇒ 0（当成"没有闰月"比抛错好 —— 调用方本来就在往 null 上收敛 ✓）
 */
export function leapMonthOf(ly) {
    if (!inTable(ly)) return 0;
    return LUNAR_INFO[ly - LUNAR_MIN_YEAR] & 0xf;
}

/**
 * 农历 `ly` 年某一"个月"有多少天（29 / 30）✓
 * @param {number} ly  农历年
 * @param {number} lm  农历月 1..12
 * @param {boolean} [leap] 是不是那个月的**闰月**（闰月不是每年都有 ⇒ 没有就返回 0 ✓）
 * @returns {number} 0 = 这个月不存在
 */
export function lunarMonthDays(ly, lm, leap = false) {
    if (!inTable(ly)) return 0;
    if (!Number.isInteger(lm) || lm < 1 || lm > 12) return 0;
    const info = LUNAR_INFO[ly - LUNAR_MIN_YEAR];
    if (leap) {
        // 闰月只跟"那一年闰的是不是这个月"有关；天数由那个独立的高位决定 ✓
        if (leapMonthOf(ly) !== lm) return 0;
        return (info & 0x10000) ? 30 : 29;
    }
    return (info & (0x10000 >> lm)) ? 30 : 29;
}

/** 农历 `ly` 年一整年多少天（354 / 355 / 383 / 384 / 385）✓ */
export function lunarYearDays(ly) {
    if (!inTable(ly)) return 0;
    const info = LUNAR_INFO[ly - LUNAR_MIN_YEAR];
    let sum = 348;   // 12 × 29（先全按小月算，再把"大月"一格一格加回来 ✓）
    for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
        if (info & bit) sum += 1;
    }
    return sum + (leapMonthOf(ly) ? ((info & 0x10000) ? 30 : 29) : 0);
}

/**
 * ★ 公历 → 农历。
 * @param {number} y 公历年
 * @param {number} m 公历月 1..12
 * @param {number} d 公历日
 * @returns {{y:number, m:number, d:number, leap:boolean}|null}
 *   `y` = **农历年**（`m` / `d` 是那一年的第几月第几日）；`leap` = 是不是闰月 ✓
 *   ⚠️ **超出 1900–2100 一律返回 null**（不抛错 ✓）——
 *      另外 `1900-01-01 ~ 1900-01-30` 也在表外（表从 1900-01-31 起）⇒ 同样 null ✓
 */
export function lunarOf(y, m, d) {
    const gy = Number(y);
    const gm = Number(m);
    const gd = Number(d);
    if (!Number.isInteger(gy) || !Number.isInteger(gm) || !Number.isInteger(gd)) return null;
    if (gy < LUNAR_MIN_YEAR || gy > LUNAR_MAX_YEAR) return null;
    if (gm < 1 || gm > 12 || gd < 1) return null;
    const t = Date.UTC(gy, gm - 1, gd);
    const at = new Date(t);
    // 防"2月30日"这种：滚到下个月的日期当无效 ✓
    if (at.getUTCFullYear() !== gy || at.getUTCMonth() + 1 !== gm || at.getUTCDate() !== gd) return null;

    let off = (t - LUNAR_EPOCH_UTC) / DAY_MS;
    if (off < 0) return null;

    // ① 先减掉整年，定位农历年
    let ly = LUNAR_MIN_YEAR;
    while (ly <= LUNAR_MAX_YEAR) {
        const len = lunarYearDays(ly);
        if (off < len) break;
        off -= len;
        ly++;
    }
    if (ly > LUNAR_MAX_YEAR) return null;

    // ② 再减掉整月（**闰月紧跟在"同号的正常月"后面** ✓）
    const leapM = leapMonthOf(ly);
    for (let lm = 1; lm <= 12; lm++) {
        const days = lunarMonthDays(ly, lm, false);
        if (off < days) return { y: ly, m: lm, d: off + 1, leap: false };
        off -= days;
        if (leapM === lm) {
            const ld = lunarMonthDays(ly, lm, true);
            if (off < ld) return { y: ly, m: lm, d: off + 1, leap: true };
            off -= ld;
        }
    }
    return null;
}


// ---------------------------------------------------------------------------
// ★ 节日表里 `lunar` 那格的**写法**（键 / 显示 / 匹配**共用这一处** ✓）
//
// 两种写法：
//   · `MM-DD`   —— 农历几月初几（`08-15` = 八月十五 ✓）
//   · `MM-LAST` —— **那个农历月的最后一天**（`12-LAST` = 除夕 ✓）
//     ⚠️ 为什么要有 `LAST`：腊月有的年 29 天、有的年 30 天 ⇒
//       写死 `12-30` 的话，"腊月只有 29 天"的那几年**除夕直接没有** ✗
//       （实测 2025–2028 连着几年腊月都是 29 天 ⇒ 写死就是连着几年丢掉除夕 ✗）
// ---------------------------------------------------------------------------

const SPEC_MD = /^(\d{2})-(\d{2})$/;
const SPEC_LAST = /^(\d{2})-LAST$/;

/**
 * 把一格 `lunar` 写法**规范成** `MM-DD` / `MM-LAST`（认不出来返回空串 ✓）。
 * ⚠️ 只许这一处认它 —— `settings.js` 的键 / 显示 / 导入合并都走这里 ✓
 */
export function normalizeLunarSpec(spec) {
    const raw = String(spec == null ? '' : spec).trim().toUpperCase();
    if (!raw) return '';
    let m = SPEC_MD.exec(raw);
    if (m) {
        const mo = Number(m[1]);
        const dd = Number(m[2]);
        // 农历月 1..12、日 1..30（农历没有 31 ✓）
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 30) return pad2(mo) + '-' + pad2(dd);
        return '';
    }
    m = SPEC_LAST.exec(raw);
    if (m) {
        const mo = Number(m[1]);
        if (mo >= 1 && mo <= 12) return pad2(mo) + '-LAST';
        return '';
    }
    return '';
}

/**
 * ★ 农历写法的**中文读法**（界面显示用）✓
 *
 * 口径（丙改）：农历的说法要按中文习惯来 ⇒
 *   设置里不再显示成「农历 08-15」那种坐标写法，改成人话：
 *   `08-15` → 「八月十五」、`01-01` → 「正月初一」、`12-LAST` → 「腊月最后一天」✓
 * ⚠️ 这只是**显示**；存进设置里的仍然是 `MM-DD` / `MM-LAST` 那个规范写法 ✓
 */
const LUNAR_MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_TENS_CN = ['初', '十', '廿', '三'];
const LUNAR_UNIT_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function lunarSpecText(spec) {
    const norm = normalizeLunarSpec(spec);
    if (!norm) return '';
    const [mm, dd] = norm.split('-');
    const mo = LUNAR_MONTH_CN[Number(mm) - 1] || mm;
    if (dd === 'LAST') return mo + '月最后一天';
    const n = Number(dd);
    if (!(n >= 1 && n <= 30)) return mo + '月' + dd;
    let day;
    if (n === 10) day = '初十';
    else if (n === 20) day = '二十';
    else if (n === 30) day = '三十';
    else day = LUNAR_TENS_CN[Math.floor((n - 1) / 10)] + LUNAR_UNIT_CN[(n - 1) % 10];
    return mo + '月' + day;
}

/**
 * ★ 日历格子里那一行小字（公下面是农，就像手机日历那样 ✓）
 *
 * 口径照民间日历的惯例：
 *   · **初一**显示**月名**（「九月」）而不是「初一」✓
 *   · 其余显示日名（初二 / 十二 / 廿三 / 三十）✓
 *   · 算不出来（超出 1900–2100、或历法不是真实公历）⇒ **返回空串**（宁可空着，不瞎猜 ✓）
 */
export function lunarCellText(y, m, d) {
    const l = lunarOf(y, m, d);
    if (!l) return '';
    // ★ 闰月的初一要标出「闰」——
    //   以前这里明明拿得到 `l.leap` 却没用 ⇒ 闰八月初一也显示成「八月」，
    //   整片看下来像"八月"重复了一遍（民间日历写「闰八月」✓）
    if (l.d === 1) return (l.leap ? '闰' : '') + (LUNAR_MONTH_CN[Number(l.m) - 1] || String(l.m)) + '月';
    const n = Number(l.d);
    if (n === 10) return '初十';
    if (n === 20) return '二十';
    if (n === 30) return '三十';
    return LUNAR_TENS_CN[Math.floor((n - 1) / 10)] + LUNAR_UNIT_CN[(n - 1) % 10];
}

/**
 * ★ 这一天的农历，是不是就是 `spec` 说的那天（`lunarOf()` 的返回值直接喂进来 ✓）。
 *
 * ⚠️ 口径①（闰月不匹配）：`lunar.leap === true` **一律不算** ⇒
 *   `08-15` 只认"正常八月十五"；那一年的"闰八月十五"**不算中秋** ✗
 * 口径②（`MM-LAST`）：拿那个农历月的**真实天数**去比 ⇒
 *   腊月 29 天那年，`12-LAST` 落在廿九；30 天那年落在三十 ✓（写死 `12-30` 做不到 ✓）
 */
export function lunarSpecMatches(lunar, spec) {
    if (!lunar) return false;
    if (lunar.leap) return false;
    const norm = normalizeLunarSpec(spec);
    if (!norm) return false;
    const mo = Number(norm.slice(0, 2));
    if (lunar.m !== mo) return false;
    const tail = norm.slice(3);
    if (tail === 'LAST') return lunar.d === lunarMonthDays(lunar.y, mo, false);
    return lunar.d === Number(tail);
}
