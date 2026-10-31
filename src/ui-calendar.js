/**
 * ui-calendar.js —— 面板「日历」那一页的 HTML（**外壳算好、面板只负责挂上去** ✓）
 *
 * 日历这一页要做的东西：
 *   · 主面板要一个日历：可以写备注、圈红圈、有提醒，沉浸感更强一点
 *   · 重要节日就是在指定的时间添加备注、然后圈红圈
 *   · 聊天内的日历只需要显示虚拟日期就行；非聊天可以显示电脑上的日历
 *   · 照着手机日历那套做就行（顶上写年月、7 列格子、
 *      今天高亮、有东西的日子点一个小点）
 *   · 节日显示是可以关闭的，放右上角左上角哪个地方都行，不用那么死板
 *   · 农历先别做（一开始觉得好麻烦、每年都不一样）✓ —— ⚠️ 这是**最初**的判断；
 *     后来改口：先去找一份现成资料就行（不用自己知道去哪找）
 *     ⇒ 那一刀已经做了（数据源 ＋ 校验结论见 `src/lunar.js` 顶上 ✓）
 *       现在 `{ lunar:'MM-DD' | 'MM-LAST' }` 那种节日**算得出来**了，但**只在历法就是真实公历时** ✓
 *
 * ★ 标在日子上的东西**升级成「日程」**：
 *   日程的东西刚好可以塞进默认视图的下半部分（跨月的就不塞了）；圈红圈更醒目；
 *   不再是点击弹图一，而是直接点这个日期、在日历下半部分编辑内容 ✓
 *   ⇒ ① 只在「默认」视图铺下半部分（跨月只用来连着看 ✓）
 *      ② 点一个日子 ⇒ **下半部分就地编辑**（不再弹那个窗 ✗）
 *      ③ 一天可以挂好几条；有日程的日子**保留红圈**（"醒目"✓）
 *
 * 三条设计决定（管着这里所有取舍）：
 *   ① **在外壳这一侧算、拼好 HTML 再塞给面板** —— 面板里**不重建一份日期引擎** ✓
 *      （同一个东西存两份真相，迟早打架 ✗；面板那边只认 `data-cal-*` 几个属性）
 *   ② **格子还是 7 列纯数字网格、不带"日一二三四五六"表头**（自定义历法下那个表头本来就没意义 ✗）
 *      ⚠️ 补：历法**有「一周几天」了**（`weekLen` / `weekStart` ✓），但那只用来算
 *        「某月第几个星期几」那种节日；**网格没有跟着按周排**（还是 1 号落在第一格 ✓）
 *        ⇒ 这一页没有"星期几"那一行，格子位置跟星期无关（别误会成日历的列＝星期 ✗）
 *   ③ **节日按"几月几日"挂、不挂年份** ⇒ 每年都会自己出现 ✓
 *      · 固定"几月几日" / "某月第几个星期几" ⇒ 两种历法都算得出来 ✓
 *      · 农历（`{ lunar }`）⇒ **只在历法就是真实公历时才算** ✗
 *        （剧情日期是虚拟的、跟现实没有对应关系 ⇒ 虚拟历法下算不了，见下面那段注释 ✓）
 *        ⚠️ 口径：闰月不匹配（闰八月十五不算中秋 ✗）；除夕要用 `12-LAST`（别写 `12-30` ✗）
 */

// ★ 按周排（周一开始）：`absDayOf` 给"从纪元起第几天"、`weekday0` 给"那是第几天"
//   ⚠️ 两套历法走**同一条路**：真实公历用它自己那份结构，自定义历法用它自己的 `weekLen` / `weekStart` ✓
//   ⚠️ 注释**不许写在 import 的花括号里面** —— imports 套件会把它当成导入的名字报错 ✗
import {
    activeCalendar, normalizeCalendar, isGregorian, GREGORIAN,
    parseFictionDate, formatFictionDate, daysInMonthOf, monthLabelOf,
    nthWeekdayInMonth,
    absDayOf, weekday0,
} from './fiction-date.js';
import { deviceDateKey } from './calendar-events.js';
import {
    currentDate, calendarEventsForPanel, calendarEventsOn,
    calendarAlertsForPanel, timeUnitNow, dueMarksForPanel, mergeDueByDate,
} from './store.js';
import { holidayList, holidaysOn, lunarDatesOn, realEventsForPanel, realEventsOn, realAlertsToday } from './settings.js';
// ★ 农历（做通了 ✓）：节日表里 `lunar` 那条靠它算 ——
//   `lunarOf()` 公历→农历、`lunarSpecMatches()` 比那格写法（含"闰月不算" / `MM-LAST` ✓）
//   ⚠️ 它是**叶子**（不 import 任何东西 ✓）⇒ 不会造环 ✓
import { lunarOf, lunarSpecMatches, lunarCellText } from './lunar.js';

/** HTML 里要转义（日程内容 / 节日名都是玩家自己写的 ✓） */
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `MM-DD` → 那天的日号（不是那个月就返回 0 ✓） */
function holidayDayOf(md, m) {
    const s = String(md || '');
    if (!/^\d{2}-\d{2}$/.test(s)) return 0;
    if (Number(s.slice(0, 2)) !== Number(m)) return 0;
    return Number(s.slice(3)) || 0;
}

/**
 * 某年某月**第几个星期几**是几号（`wd`：0=周日…6=周六）⇒ 给母亲节那种用 ✓
 * ⚠️ **真实公历那条老路：一个字都没动** —— 走 JS 自己的 `Date`（回归风险为零 ✓）
 *   调用方只在"历法就是出厂公历"时才走这条（非聊天那版永远走它 ✓）
 * ★ 导出只是为了**让回归有断言守着**（加自定义历法那条路时，
 *   拿"母亲节 2026 = 5月10日"这种已知事实钉住它 ✓）—— 别的模块不用它 ✓
 */
export function nthWeekdayOf(y, m, nth, wd) {
    // ★★ 顺手修的老 bug（加自定义历法那轮扫出来的）：
    //   `new Date(1, 4, 1)` 会被 JS 当成 **1901**-05-01（两位数年份自动加 1900 的老规矩 ✗）
    //   —— 而"1年5月"恰恰是剧情日期最常见的写法（默认历法就是公历）！
    //   ⇒ 年份 0~99 先挪一个 **400 年**周期再问 Date：400 年 146097 天正好是 7 的整数倍，
    //     星期与闰年规则都不变 ⇒ 结果一样 ✓
    const yy = Number(y);
    const safeY = (Number.isFinite(yy) && yy >= 0 && yy < 100) ? yy + 400 : yy;
    const first = new Date(safeY, m - 1, 1);
    if (Number.isNaN(first.getTime())) return 0;
    const d = 1 + ((Number(wd) - first.getDay() + 7) % 7) + (Number(nth) - 1) * 7;
    return d >= 1 ? d : 0;
}

/**
 * 下半部分里**一条日程的那一行**（每格都是输入框 ⇒ 就地编辑 ✓）
 *
 * ⚠️ 面板**不许写状态**（老规矩）⇒ 这里的输入框只是"看得见的样子"，
 *   真正落盘是面板把这一行的值 postMessage 回外壳、由外壳写 ✓（见 bodycord.html）
 * ⚠️ 「不记钟点」那档：**不给时间格子**（钟点三档 ✓）
 *   ⇒ 但 `data-cal-all` 还是照**存着的那个值**写（别顺手把它改成 true ✗）
 */
function evRowHtml(e, unit) {
    const id = esc(e.id);
    const allDay = !!e.allDay;
    const off = allDay ? ' off' : '';
    const remind = e.remind !== false;      // 老数据没有这个字段 ⇒ 当"要提醒" ✓
    // ★ 日程的提醒和不提醒不该做成一个按钮，应该做成两个 ✓
    //   ⇒ 做成**两档胶囊**（跟面板里「默认 / 跨月」那种一个形式）：两颗都看得见，
    //     选中的那颗亮着；默认那颗（「提醒」）排在**最左** ✓
    const remindChip = '<div class="bc-cal-ev-remind' + (remind ? ' on' : '') + '" data-cal-remind="' + id + '"'
        + ' data-remv="1" title="到日子会提醒你">提醒</div>'
        + '<div class="bc-cal-ev-remind' + (remind ? '' : ' on') + '" data-cal-remind="' + id + '"'
        + ' data-remv="0" title="这条不提醒（到日子不弹）">不提醒</div>';
    // ★ 全天 / 具体时间的位置问题：上一版只有一颗「全天」、
    //   亮/灰表示两种状态，**"具体时间"那三个字压根没出现在界面上** ✗ ⇒ 找不到是必然的
    //   ⇒ 现在跟「提醒」一样做成**两档两颗**：`全天` / `具体时间`，选中的亮着 ✓
    //     （「全天」排最左 = 默认那档 ✓；只有关了它才会出现「开始 / 结束」两格 ✓）
    const time = (unit === 'none') ? '' :
        ('<div class="bc-cal-ev-all' + (allDay ? ' on' : '') + '" data-cal-allday="' + id + '"'
            + ' data-allday-v="1" title="整天的事，不用填时间">全天</div>'
        + '<div class="bc-cal-ev-all' + (allDay ? '' : ' on') + '" data-cal-allday="' + id + '"'
            + ' data-allday-v="0" title="有开始 / 结束时间">具体时间</div>'
        + '<input class="bc-cal-ev-clock' + off + '" data-cal-f="start" data-cal-eid="' + id + '"'
            + ' value="' + esc(e.start || '') + '" placeholder="开始" title="开始时间，例 09:00">'
        + '<span class="bc-cal-ev-tilde' + off + '">~</span>'
        + '<input class="bc-cal-ev-clock' + off + '" data-cal-f="end" data-cal-eid="' + id + '"'
            + ' value="' + esc(e.end || '') + '" placeholder="结束" title="结束时间">');
    return '<div class="bc-cal-ev" data-cal-ev="' + id + '" data-cal-all="' + (allDay ? '1' : '0') + '"'
        + ' data-cal-rem="' + (remind ? '1' : '0') + '">'
        + '<div class="bc-cal-ev-top">' + time + remindChip + '<div class="bc-cal-sp"></div>'
        + '<div class="bc-cal-ev-x" data-cal-del="' + id + '" title="删掉这条（删了就没了，没有撤销）">✕</div></div>'
        // ★ A8（定下）：标题格（可留空）—— 在内容上面
        + '<input class="bc-cal-ev-title" data-cal-f="title" data-cal-eid="' + id + '"'
        + ' value="' + esc(e.title || '') + '" placeholder="标题（可留空）">'
        + '<input class="bc-cal-ev-note" data-cal-f="note" data-cal-eid="' + id + '"'
        + ' value="' + esc(e.note || '') + '" placeholder="这一天做什么">'
        + '<div class="bc-cal-ev-warn"></div>'
        + '</div>';
}

/** 一条预产期念成一句人话（日历下半部分那行用 ✓）
 *  ★ 2026-10-26：同一天的那几胎已经并成一条（见 store.js 的 mergeDueByDate），
 *    所以这里收的是 `{ fetus: [1,2,3] }` 那种形状 ✓ */
function dueLineText(g) {
    const who = g.name || '这一胎';
    const nth = (Array.isArray(g.fetus) && g.fetus.length) ? ('第 ' + g.fetus.join('、') + ' 胎') : '';
    let when = '';
    if (g.late > 0) when = '已过 ' + g.late + ' 天';
    else if (g.late === 0) when = '就是今天';
    else when = '还有 ' + Math.abs(g.late) + ' 天';
    return who + (nth ? ' ' + nth : '') + '预产期：' + g.date + '（' + when + '）';
}

/** 下半部分那一整块（哪一天 + 那天的几条 + 「加一条」✓） */
function dayEditorHtml(dateStr, entries, unit, dueMarks) {
    const rows = entries.map((e) => evRowHtml(e, unit)).join('');
    // ★ 全天 / 具体时间那两颗的位置：
    //   钟点是「不记钟点」时（出厂默认）那两颗压根不画 ⇒ 界面上找不到，也没有一个字说明为什么 ✗
    //   ⇒ 补一行提示（**只在"不记钟点 ＋ 这一天真有日程"时出现** ✓：没有日程时它也没用 ✓）
    const tip = (unit === 'none' && entries.length)
        ? '<div class="bc-cal-day-tip">想给日程标时间：设置 → 时间与日历 → 钟点</div>'
        : '';
    return '<div class="bc-cal-day" data-cal-date="' + esc(dateStr) + '">'
        + '<div class="bc-cal-day-head">'
        +   '<div class="bc-cal-day-d">' + esc(dateStr) + '</div>'
        +   '<div class="bc-cal-day-c">' + (entries.length ? (entries.length + ' 条') : '还没有') + '</div>'
        +   '<div class="bc-cal-sp"></div>'
        +   '<div class="bc-cal-day-add" data-cal-add="1">＋ 加一条</div>'
        + '</div>'
        // ★ 2026-10-26：这一天如果是预产期，在这儿写清是谁、第几胎、还有几天 / 已过几天
        //   （格子上只放得下「预产期」三个字 ⇒ 细节放这儿 ✓）
        //   ⚠️ 这块**只读**：预产期是插件算的，不写进日程，日历里也不许编辑它 ✓
        + ((Array.isArray(dueMarks) && dueMarks.length)
            ? ('<div class="bc-cal-duenote">' + mergeDueByDate(dueMarks).map(dueLineText).map(esc).join('　·　') + '</div>')
            : '')
        + '<div class="bc-cal-day-list">'
        +   (rows ? ('<div class="bc-cal-ev-list">' + rows + '</div>')
                   : '<div class="bc-cal-empty">这一天还没有日程</div>')
        + '</div>'
        + tip
        + '</div>';
}

/**
 * 不在聊天里那版（设备日期）的下半部分：**跟聊天里一样能写** ✓
 *
 * 明明非聊天也能存，为什么不能搞？非聊天也可以记录东西，
 *   不能剥夺这个权利 ✓✓ ⇒ 这份存**全局设置**（穿过所有聊天），
 * 日期按**真实公历 `YYYY-MM-DD`** 记（跟设备日期对齐 ✓，跟插件的自定义历法无关 ✓）
 * ⚠️ 面板那边完全不改：它只认 `data-cal-date`（这儿就是那个 ISO 串 ✓）
 */
function realDayEditorHtml(iso) {
    return dayEditorHtml(iso, realEventsOn(iso), timeUnitNow());
}

/**
 * 拼「日历」这一页。
 * @param {{inChat?:boolean, y?:number, m?:number, mode?:string,
 *          sel?:{y:number,m:number,d:number}, _bare?:boolean}} opts
 * @returns {{html:string, y:number, m:number, months:number, inChat:boolean, mode:string, sel:object|null}}
 */
export function calendarViewHtml(opts = {}) {
    const inChat = !!opts.inChat;
    // ★ 跨月视图（默认 / 跨月都要做，不然圈日子怎么办 ✓）
    //   `mode = 'span'` ⇒ 连着排 3 个月（前一个 / 这个 / 后一个），竖着滚 ✓
    //   `_bare` = 内部递归用（只要那一个月的网格，不要外面那圈头尾 ✓）
    const mode = (opts.mode === 'span') ? 'span' : 'default';
    const bare = !!opts._bare;
    // ⚠️ 不在聊天里 ⇒ 走**设备上的真实公历**（非聊天可以显示电脑上的日历 ✓）
    const cal = inChat ? normalizeCalendar(activeCalendar()) : normalizeCalendar(GREGORIAN);
    const nM = cal.months.length;

    let today = null;
    if (inChat) {
        const p = parseFictionDate(currentDate(), cal);
        if (p) today = p;
    } else {
        const now = new Date();
        today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    let y = Math.max(1, Math.floor(Number(opts.y)) || (today ? today.y : 1));
    let m = Math.floor(Number(opts.m)) || (today ? today.m : 1);
    m = Math.min(nM, Math.max(1, m));
    if (y < 1) y = 1;

    const days = daysInMonthOf(cal, y, m);
    const title = monthLabelOf(y, m, cal);

    // ★ 「某月第几个星期几」（母亲节那种）**两种历法都算得出来**了 ——
    //   · 历法就是出厂公历 ⇒ 走**老路**（`new Date(...).getDay()`，一个字没动 ✓）
    //     （不在聊天里那版永远走它：设备日期本来就是真实公历 ✓；
    //       聊天里只要历法是公历，剧情日期本身就是真实公历 ⇒ 也该算得出来 ✓）
    //   · 自定义历法 ⇒ 走 fiction-date.js 的纯函数（一周几天按 `weekLen` ✓）
    //     ⚠️ 虚拟历法可以加"一周几天 + 纪元第一天是周几"✓
    //     ⇒ 原来那道 `nthOk = isGregorian(cal)` 的拦截**去掉了** ✓
    //   · 农历那条（`lunar`）**做通了** ✓ —— 但**只在历法就是真实公历时才算** ✗
    //     为什么：自定义 / 虚拟历法跟现实哪一天**没有对应关系**（既有口径 ✓）——
    //     "农历八月十五"在有 90 天一个月的世界观里落不到某一天上，算了就是瞎猜 ✗
    const holOn = holidaysOn();
    // ★ 格子里那行小字要不要画农历（公下面要写农历，就像手机日历那样 ✓）
    //   ⚠️ 只有**日期是真实公历**时才算得出来；虚拟历法跟现实没有对应关系 ⇒ 不画（不报错）✓
    const lunOn = lunarDatesOn() && isGregorian(cal);
    const holByDay = {};
    if (holOn) {
        for (const h of holidayList()) {
            let d = 0;
            if (h.md) d = holidayDayOf(h.md, m);
            else if (h.lunar) {
                // 这个月里逐天问"这一天的农历是不是它"（`lunarOf` 超范围返回 null ⇒ 自然不匹配 ✓）
                if (isGregorian(cal)) {
                    for (let dd = 1; dd <= days; dd++) {
                        if (lunarSpecMatches(lunarOf(y, m, dd), h.lunar)) { d = dd; break; }
                    }
                }
            }
            else if (h.m === m) {
                d = isGregorian(cal)
                    ? nthWeekdayOf(y, m, h.nth, h.wd)
                    : nthWeekdayInMonth(y, m, h.nth, h.wd, cal);
            }
            if (d >= 1 && d <= days && !holByDay[d]) holByDay[d] = h.name;
        }
    }

    // ---- 日程（红圈 + 格子上那行小字）----
    //   ★ 两份数据源（明明非聊天也能存，就该能搞 ✓）：
    //     聊天里 = 当前聊天那份（日期是"按当前写法渲染的串"）
    //     非聊天 = 全局那份（日期是真实公历 `YYYY-MM-DD`，跟设备日期对齐 ✓）
    const evByDay = {};
    if (inChat) {
        for (const card of calendarEventsForPanel()) {
            const p = parseFictionDate(card.date, cal);
            if (!p || p.y !== y || p.m !== m) continue;
            evByDay[p.d] = card;
        }
    } else {
        for (const card of realEventsForPanel()) {
            const s = String(card.date || '');
            if (Number(s.slice(0, 4)) !== y || Number(s.slice(5, 7)) !== m) continue;
            evByDay[Number(s.slice(8, 10))] = card;
        }
    }

    // ---- 预产期（★ 2026-10-26 新加：**一直标在日历上**）----
    //   口径：插件按"今天 + 剩余孕期"现算（见 store.js 的 dueMarksForPanel），
    //   **不写进日程** —— 日程是玩家自己填的，预产期跟着孕周动，混在一起会留死日期 ✗
    //   ⚠️ 只聊天里有（现实日历那份没有剧情孕周 ✓）
    const dueAll = inChat ? (() => { try { return dueMarksForPanel(); } catch { return []; } })() : [];
    const dueByDay = {};
    for (const m0 of dueAll) {
        const p = parseFictionDate(m0.date, cal);
        if (!p || p.y !== y || p.m !== m) continue;
        (dueByDay[p.d] = dueByDay[p.d] || []).push(m0);
    }

    // ---- 下半部分正在编辑的是哪一天 ✓ ----
    //   优先外壳记住的那天（点过的那天）；它不在正在看的这一个月时，
    //   落回"今天"（今天就在这个月的话）、否则落回 1 号 ✓
    let sel = null;
    // ★ 跨月视图是靠**递归调自己**拼出 3 个月的（见下面 monthGrid）——
    //   递归那次会重新算一遍 `sel`（落回"今天 / 1 号"）⇒ 3 个月里各画出一个"正在编辑"圈，
    //   而跨月**根本没有下半部分编辑器** ✗ ⇒ 递归时传 `_noSel` 明确说"这一遍不画圈" ✓
    if (opts._noSel) sel = null;
    else if (inChat) {
        const s0 = opts.sel;
        const sy = Math.max(1, Math.floor(Number(s0 && s0.y) || 0));
        const sm = Math.floor(Number(s0 && s0.m) || 0);
        const sd = Math.floor(Number(s0 && s0.d) || 0);
        if (sy === y && sm === m && sd >= 1 && sd <= days) sel = { y, m, d: sd };
        else if (today && today.y === y && today.m === m) sel = { y, m, d: today.d };
        else sel = { y, m, d: 1 };
    } else {
        // ★ 非聊天那版也要**点得动**（报过的现象：非聊天的日历还是不能点击切换 ✗）
        //   它不铺日程（日程按聊天各存一份 ✓），但选中得亮起来 ＋ 得说清为什么写不了 ✓
        const s0 = opts.sel;
        const sy = Math.max(1, Math.floor(Number(s0 && s0.y) || 0));
        const sm = Math.floor(Number(s0 && s0.m) || 0);
        const sd = Math.floor(Number(s0 && s0.d) || 0);
        if (sy === y && sm === m && sd >= 1 && sd <= days) sel = { y, m, d: sd };
        // ★ 落回"今天"时要**夹到当月天数**里 ——
        //   设备今天 10/31、翻到 9 月时，以前会把下半部分开在「2026-09-31」这个
        //   **不存在的日子**上（deviceDateKey 也造得出这个键、addRealEvent 也照收），
        //   在那儿写的日程永远匹配不到格子（红圈 / 小字 / 点开都没有 ✗）
        else sel = { y, m, d: Math.min(today ? today.d : 1, days) };
    }

    // ---- 到点的小提示（只弹一次，点掉之后记成"提示过了" ✓）----
    //   ★ 聊天里 = 剧情日期那份；不在聊天里 = **现实那份**（按设备今天，账本在全局 ✓
    //     非聊天日历也需要提醒 ✓）
    const alerts = inChat ? calendarAlertsForPanel() : realAlertsToday();
    let banner = '';
    if (alerts.length) {
        // ★ 多条提醒之间要有分隔 ——
        //   以前 `join('')` ⇒ 两条连成「吃饭2026年10月3日买菜2026年10月4日」（第一条的日期和第二条的标题粘一起）✗
        //   ⚠️ 用全角空格 + 间隔号做分隔（纯文字，不依赖 CSS ✓）
        const items = alerts.map((a) => '<b>' + esc(a.note) + '</b><span class="bc-cal-al-when">' + esc(a.date) + '</span>').join('　·　');
        banner = '<div class="bc-cal-alert">'
            + '<div class="bc-cal-al-text">到日子了：' + items + '</div>'
            + '<div class="bc-cal-al-x" data-cal-dismiss="' + esc(alerts.map((a) => a.key).join('\n')) + '" title="知道了">✕</div>'
            + '</div>';
    }

    // ---- 按周排（格子按周排就像这样、这样格子才能方正，而且周一开始 ✓）----
    //   ⚠️ 为什么按周排才能"方正"：不按周排时 1 号永远在第一格 ⇒ **行数随月份长短变**（4~6 行），
    //     同一排只能"都按最高那格" ⇒ 凑不出固定形状 ✗；按周排之后行数固定（5~6 行）⇒ 格子可以定成方形 ✓
    //   ⚠️ 星期怎么算：两套历法走**同一条**纯函数（真实公历 / 自定义历法都用它自己的 `weekLen` / `weekStart`）
    //   ⚠️ 一周特别长（比如 60 天）排不出来 ⇒ 退回老排法（1 号在第一格、不带表头）✓
    const wk = Math.max(1, Math.floor(Number(cal.weekLen) || 7));
    const byWeek = wk >= 2 && wk <= 14;
    const cols = byWeek ? wk : 7;
    let lead = 0;
    if (byWeek) {
        const w0 = weekday0(absDayOf(y, m, 1, cal), cal);
        // 表头**周一开始**；周日挪到最后一列 ✓
        //   ⚠️ 只有"一周 7 天"才有"周一"这回事 ⇒ 别的 weekLen 就按原本第 0 天在最左 ✓
        lead = (wk === 7) ? ((w0 + 6) % 7) : w0;
    }
    // 表头（只有按周排才有 ✓）
    const WD_CN = ['一', '二', '三', '四', '五', '六', '日'];
    let heads = '';
    if (byWeek) {
        for (let i = 0; i < wk; i++) {
            heads += '<div class="bc-cal-wd">' + ((wk === 7) ? WD_CN[i] : ('第' + (i + 1) + '天')) + '</div>';
        }
    }
    // 前后月那些灰格（照图二那种：能看见日子和农历，但**不可点** ✓）
    const padCell = (py, pm, pd) => {
        const t = lunOn ? lunarCellText(py, pm, pd) : '';
        return '<div class="bc-cal-cell bc-cal-pad">'
            + '<div class="bc-cal-d">' + pd + '</div>'
            + (t ? '<div class="bc-cal-u">' + esc(t) + '</div>' : '')
            + '</div>';
    };
    const monthCount = Math.max(1, (cal.months || []).length || 12);

    // ---- 格子 ----
    let cells = '';
    // 上个月末尾几天（占满第一行前面那几个位置 ✓）
    if (byWeek && lead > 0) {
        const pm = (m - 1 >= 1) ? (m - 1) : monthCount;
        const py = (m - 1 >= 1) ? y : (y - 1);
        const pd = (py >= 1) ? daysInMonthOf(cal, py, pm) : 0;
        let filled = 0;
        for (let k = Math.max(1, pd - lead + 1); k <= pd; k++) { cells += padCell(py, pm, k); filled += 1; }
        // ★ 补不满 `lead` 个就用**空壳**补齐 ——
        //   元年 1 月（没有上个月，py=0）与"上个月天数 < lead"的自定义历法（月份可以只有 1 天），
        //   以前一个灰格都不补 ⇒ 整个月**按列错位**、跟表头对不上 ✗
        for (let k = filled; k < lead; k++) cells += '<div class="bc-cal-cell bc-cal-pad"></div>';
    }
    for (let d = 1; d <= days; d++) {
        const isToday = !!(today && today.y === y && today.m === m && today.d === d);
        const card = evByDay[d] || null;
        const hol = holByDay[d] || '';
        // 农历那一行（民间日历的写法：初一显示月名「九月」，其余显示「初二 / 廿三」✓）
        const lun = lunOn ? lunarCellText(y, m, d) : '';
        // 正在编辑的那一天加一圈（不然切完日子不知道下半部分在说哪一天 ✗）
        const isSel = !!(sel && sel.d === d && mode === 'default');
        // ★ 预产期这一格（多胎同一天 ⇒ 数一下几条，别只显示一条蒙人 ✓）
        const dueList = dueByDay[d] || [];
        const due = dueList.length ? dueList[0] : null;
        const tips = [];
        if (card) tips.push(String(card.title || ''));
        if (due) {
            // ★ 同一天那几胎并成一条（第 1、2、3 胎），别在提示里念三遍 ✓
            tips.push(dueLineText(mergeDueByDate(dueList)[0]));
        }
        if (!tips.length) tips.push('点一下在下面写日程');
        const cls = 'bc-cal-cell'
            + (isToday ? ' bc-cal-on' : '')
            + (card ? ' bc-cal-mark' : '')
            + (due ? ' bc-cal-hasdue' : '')
            + (isSel ? ' bc-cal-sel' : '');
        cells += '<div class="' + cls + '" data-cal-day="' + d + '" title="'
            + esc(tips.join('　·　')) + '">'
            + '<div class="bc-cal-d">' + d + '</div>'
            + (lun ? '<div class="bc-cal-u">' + esc(lun) + '</div>' : '')
            + (hol ? '<div class="bc-cal-h">' + esc(hol) + '</div>' : '')
            + (due ? '<div class="bc-cal-due">预产期' + (dueList.length > 1 ? (' ' + dueList.length + ' 胎') : '') + '</div>' : '')
            + (card ? '<div class="bc-cal-n">' + esc(String(card.label || '').slice(0, 6)) + '</div>' : '')
            + '</div>';
    }
    // 补满最后一行 —— 纯装饰、不参与点击 ✓
    //   按周排 ⇒ 用**下个月开头几天**填（照手机日历那种做法）；老排法 ⇒ 空壳子填满 7 的整数倍 ✓
    if (byWeek) {
        const rest = (cols - ((lead + days) % cols)) % cols;
        const nm = (m + 1 <= monthCount) ? (m + 1) : 1;
        const ny = (m + 1 <= monthCount) ? y : (y + 1);
        for (let k = 1; k <= rest; k++) cells += padCell(ny, nm, k);
    } else {
        const pad = (cols - (days % cols)) % cols;
        for (let i = 0; i < pad; i++) cells += '<div class="bc-cal-cell bc-cal-pad"></div>';
    }

    // ⚠️ 格子上带 `data-cal-y` / `data-cal-m`：跨月视图里有 3 个月，
    //   面板点了一格必须说清**那是哪个月**（不然外壳会当成正在看的那个月 ✗）
    // ⚠️ 表头**放回同一个网格里**（拆出去那版跟格子对不齐、偏了约 30px ✗）——
    //   同网格就一定对齐 ✓；它不会被撑高的办法是**给网格显式声明第一行 `auto`**（见 `.bc-cal-grid`）：
    //   第一行按内容高、后面的行才吃 `grid-auto-rows:1fr` ✓
    const gridHtml = '<div class="bc-cal-grid" style="grid-template-columns:repeat(' + cols + ',1fr)"'
        + ' data-cal-y="' + y + '" data-cal-m="' + m + '">' + heads + cells + '</div>';

    // ★ 头部按面板现有的规矩来（跟「成就」那页一样：**一句大读数 + 一行小字** ✓）
    //   报过的现象：现在这个风格好像有点怪怪的，不是完全符合我们的 UI 样子 ✗
    const todayText = today
        ? (inChat ? ('今天：' + (currentDate() || '（剧情还没给日期）'))
                  : ('这台设备上的今天：' + today.y + '年' + today.m + '月' + today.d + '日'))
        : '今天：（还没定）';
    const subLine = '这个月 ' + days + ' 天　·　' + todayText + (mode === 'span' ? '　·　连着看 3 个月' : '');

    // ★ 还少了**跳转日期**，另外还要一个**跳转回当前日期**的选项 ✓
    //   · 点标题 → 跳指定的年月（自定义历法下"一年四个月"，一个月一个月翻到第 50 年是受罪 ✗）
    //   · 「回到今天」那颗**只在你看的不是当前那个月时才出现**（省地方，也正好是需要它的时候 ✓）
    const onToday = !!(today && today.y === y && today.m === m);
    const todayChip = onToday ? ''
        : '<div class="bc-cal-today" data-cal-today="1" title="跳回今天那个月">今天</div>';
    // ★ 2026-10-26：有预产期就多一颗「跳到预产期」——
    //   格子上有标记，可预产期常在好几个月之后，一个月一个月翻太费劲 ✓
    //   （没有孕 / 没定下预产期 ⇒ 这颗不出现，别放个点了没反应的按钮 ✗）
    const dueJump = (inChat && dueAll.length)
        ? '<div class="bc-cal-duejump" data-cal-due="1" title="跳到最近一胎的预产期那个月">跳到预产期</div>'
        : '';

    const head = '<div class="bc-cal-head">'
        + '<div class="bc-cal-hd-main">'
        +   '<div class="bc-cal-title bc-cal-jump" data-cal-jump="1" title="点一下跳到指定的年月">' + esc(title) + '</div>'
        +   '<div class="bc-cal-sub">'
        +     '<span class="bc-cal-mode' + (mode === 'default' ? ' on' : '') + '" data-cal-mode="default">默认</span>'
        +     '<span class="bc-cal-mode' + (mode === 'span' ? ' on' : '') + '" data-cal-mode="span" title="连着看 3 个月；写日程要切回「默认」">跨月</span>'
        +     '<span class="bc-cal-sub-tx">' + esc(subLine) + '</span>'
        +   '</div>'
        + '</div>'
        + '<div class="bc-cal-sp"></div>'
        + '<div class="bc-cal-nav" data-cal-nav="-1" title="上一个月">‹</div>'
        + '<div class="bc-cal-nav" data-cal-nav="1" title="下一个月">›</div>'
        + dueJump
        + todayChip
        + '<div class="bc-cal-hol' + (holOn ? ' on' : '') + '" data-cal-holidays="1" title="'
        // ★ 边界：这个开关**只管出厂那张节日表**
        //   （机制见 bodycord.js 的 holidayList）；玩家自己标的日子不受影响 ✓
        + (holOn ? '节日：开着（点一下关掉）' : '节日：关着（点一下打开）')
        + '。只管出厂那张节日表，你自己标的日子不受影响' + '">节日</div>'
        + '</div>';

    // ⚠️ 文案说「设备」不说「电脑」—— 之前问过：
    //   这个地方改成设备会不会好一点（虽然你可能把手机做成显示手机了）✓
    //   面板在 TT 手机端也会跑 ⇒ 「设备」才准 ✓
    // ★ 又指了一次（这次是「日历」vs「日期」）：
    //   改成"日期"会比较好 —— 节日是预填充的，准确来讲不算日历 ✓
    //   ⇒ 说得对：这里给的是**设备当前的日期 + 那个月的格子**，
    //     节日是插件**自己带的固定表**、不是从设备历法来的 ⇒ 说「日期」才准 ✓
    // ★ 疑问：这是设备上的日期，日程存在这台设备上（不跟聊天走），很奇怪，
    //   能不能判断一下为什么？⇒ 查出来的三条根因：
    //   ① 它跟「年历和节日」那张卡的「？」里那句「它们跟着各自的聊天走」**说法正好相反** ——
    //      其实两句都对（插件里是**两份**日程：剧情那份按聊天存、现实那份在插件设置里 ✓），
    //      但两句都只说了一半 ⇒ 摆在一起就像插件自己没想清楚 ✗
    //   ② 它讲的是"数据存在哪"（实现细节）；玩家站在这一页真正要问的是「**这是哪个日历**」
    //   ③ 「不跟聊天走」是内部行话，还裹在括号里 ✗
    //   ⇒ 脚注现在只回答"这是哪个日历"（两份各有一个名字 ✓）；"存在哪 / 备份带不走"交给「？」✓
    const foot = inChat
        ? '<div class="bc-cal-foot">剧情日历：点一个日子就能在下面写日程，有日程的日子圈红圈</div>'
        : '<div class="bc-cal-foot">这是现实日历：按这台设备的今天算，跟剧情日程分开记</div>';

    // ★ 跨月：把「前一个 / 这个 / 后一个」连起来（**借一次单月渲染、递归调自己** ✓
    //   免得把那一大段网格代码抄第二遍 ✗ —— 两份迟早走样 ✓）
    const monthGrid = (yy, mm) => calendarViewHtml({
        inChat, y: yy, m: mm, mode: 'default', _bare: true, _noSel: true,
    });

    if (bare) {
        return { html: gridHtml, title, y, m, days, months: nM, inChat, mode, sel };
    }

    if (mode === 'span') {
        const wrapYM = (mm) => {
            let y2 = y;
            let m2 = Math.floor(Number(mm) || 1);
            while (m2 < 1) { m2 += nM; y2 -= 1; }           // 月数不定 ⇒ 前后都能绕 ✓
            while (m2 > nM) { m2 -= nM; y2 += 1; }
            return { y: Math.max(1, y2), m: m2 };
        };
        let secs = '';
        for (const off of [-1, 0, 1]) {
            const t = wrapYM(m + off);
            const g = monthGrid(t.y, t.m);
            secs += '<div class="bc-cal-sec"' + (off === 0 ? ' data-cal-focus="1"' : '') + '>'
                + '<div class="bc-cal-sec-title">' + esc(g.title) + '</div>'
                + g.html + '</div>';
        }
        // ⚠️ 跨月**不铺下半部分**（日程的东西刚好可以塞进默认的下半部分，跨月的就不塞了 ✓）
        return {
            html: '<div class="bc-cal-wrap">' + banner + head
                + '<div class="bc-cal-scroll">' + secs + '</div>' + foot + '</div>',
            y, m, months: nM, inChat, mode, sel,
        };
    }

    // ★ 下半部分：点中的那一天就地编辑（**只在默认视图** ✓）
    //   聊天里 = 这个故事那份日程；非聊天 = 现实日历那份（存全局，按设备日期 ✓）
    let dayBox = '';
    if (sel) {
        if (inChat) {
            const selDate = formatFictionDate(sel, cal);
            if (selDate) {
                dayBox = dayEditorHtml(selDate, calendarEventsOn(selDate), timeUnitNow(), dueByDay[sel.d] || []);
            }
        } else {
            dayBox = realDayEditorHtml(deviceDateKey(sel.y, sel.m, sel.d));
        }
    }

    return {
        html: '<div class="bc-cal-wrap">' + banner + head + gridHtml + dayBox + foot + '</div>',
        y, m, months: nM, inChat, mode, sel,
    };
}
