/**
 * calendar-events.js —— 日程那一套**纯逻辑**（聊天那份和"现实日历"那份共用 ✓）
 *
 * 为什么单独一个文件：
 *   · **聊天里的日程**存在**当前聊天**（`store.js`，按聊天各存一份 ✓ 沉浸式）
 *   · **现实日历那版**（不在聊天里、按设备日期）存在**全局设置**（`settings.js`）
 *     —— 非聊天场景也要能记东西，这件事不该被剥夺 ✓
 *   ⚠️ 两边**日期格式还不一样**：聊天那份是"按当前写法渲染出来的串"（`1年02月14日` /
 *     `第三轮·孟春·初七`），现实那份必须是**真实公历的 `YYYY-MM-DD`**
 *     （不然把历法改成"一年四个月"，现实日程就全对不上了 ✗）
 *   ⇒ 数据源不同、格式不同，但**排序 / 显示那行字 / 空壳子判定 / 改一格的校验**完全一样
 *     ⇒ 抽到这里共用一份（同一份清单只许有一个来源 ✓，两份迟早走样 ✗）
 *
 * ⚠️ 本文件只 import `fiction-date.js`（它也是叶子）⇒ 谁都引它、不会造模块环 ✓
 */

import { parseClock } from './fiction-date.js';

/** 造一个不重复的条目 id（面板拿它指"改的是哪一条" ✓） */
export function calEvId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 一条日程"给人看的那行字"（格子上那行小字、到点提示、面板下半部分都用它 ✓）
 * 「不记钟点」那档 ⇒ 只有内容（跟以前一模一样 ✓）
 */
export function calEvLabel(e, unit) {
    const u = String(unit == null ? 'none' : unit);
    const title = String(e?.title || '').trim();
    const note = String(e?.note || '').trim();
    // ★ A8：日程要有「标题」这一格，允许留空 ✓
    //   标题＝这一条叫什么，内容＝细节；**那行小字优先显示标题**（没填标题就跟以前完全一样 ✓）
    const text = title ? (note ? (title + '：' + note) : title) : note;
    const start = String(e?.start || '').trim();
    const end = String(e?.end || '').trim();
    if (u === 'none') return text;
    if (e?.allDay) return text ? ('全天 ' + text) : '全天';
    // ★ 只填了「结束」也得显示出来 ——
    //   以前 `span` 只看 start ⇒ 结束时间整段丢掉；如果同时没标题没内容，整行就是**空串**
    //   ⇒ 格子上只有红圈没有字、而且提醒那两处 `if (!note) continue` 会跳过它 ⇒ **永远不提醒** ✗
    const span = start ? (start + (end ? ('~' + end) : '')) : (end ? ('到 ' + end) : '');
    if (span && text) return span + ' ' + text;
    return span || text;
}

/**
 * 这条有没有内容（空壳子不算"这一天有日程"、不画红圈 ✓）
 * ⚠️ `unit` 由调用方给（钟点档在设置里，这里保持纯函数 ✓）
 */
export function calEvFilled(e, unit) {
    if (String(e?.title || '').trim()) return true;   // ★ A8：只填了标题也算有内容 ✓
    if (String(e?.note || '').trim()) return true;
    // ★ **时间也是"已经记下来的内容"** —— 钟点档只决定
    //   「显不显示」，不决定「这条有没有内容」✗。
    //   以前这里是 `unit === 'none' ⇒ return false`，于是这条路上会丢数据：
    //   「先在『记到分钟』记一条只有开始 / 结束时间的日程」⇒「再去设置把钟点切成不记钟点」
    //   ⇒ 它被判成空壳子，被 calEvPrune 连数据一起 splice 掉（不可撤销 ✗）。
    //   ⚠️ `unit` 这个参数保留（调用方都还传），但现在不参与判据了。
    return !!(String(e?.start || '').trim() || String(e?.end || '').trim());
}

/**
 * 这一条要不要提醒（"每条单独配"✓）
 * ⚠️ **老数据没有这个字段 ⇒ 一律当"要提醒"**（不然以前记的日程会突然全不提醒 ✗）
 */
export function calEvRemindOn(e) {
    return e?.remind !== false;
}

/** 开始时间 → 分钟数（认不出来排最后 ✓） */
function startMin(e) {
    const p = parseClock(String(e?.start || ''));
    return p === null ? 1441 : p;
}

/** 排一下：全天最前 → 按开始时间 → 按写下来的先后 ✓ */
export function calEvSort(list) {
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
        if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
        const am = startMin(a);
        const bm = startMin(b);
        if (am !== bm) return am - bm;
        return (Number(a.at) || 0) - (Number(b.at) || 0);
    });
}

/** 某一天的日程（排好序的副本 ✓） */
export function calEvOn(list, date) {
    const d = String(date || '').trim();
    if (!d) return [];
    return calEvSort((Array.isArray(list) ? list : []).filter((x) => String(x?.date || '') === d));
}

/**
 * 往一条上写（只改给进来的那几格 ✓）
 * ⚠️ 时间：认得出（`13:05` / `下午1点`）就存**规范写法**；认不出就**原样留着** + 回一句提醒
 *   （宁可留着让人自己看见，也别默默丢掉打进来的字 ✗）
 * @returns {{warn:string}} 有警告就把那句话带回去
 */
export function calEvApply(e, patch = {}) {
    const bad = [];
    if ('allDay' in patch) e.allDay = !!patch.allDay;
    // ★ 这一条要不要提醒：提醒**按每一条日程单独配**，
    //   不是全局开关 —— 缺省（老数据）一律**当开** ✓
    if ('remind' in patch) e.remind = !!patch.remind;
    for (const k of ['start', 'end']) {
        if (!(k in patch)) continue;
        // ★ **缺键**和**值是 undefined** 都算"这次没带这一格" ⇒ 一个字都不动 ✗
        //   面板在「不记钟点」档下根本不渲染时间输入框（bodycord.html 的 calRowValues
        //   只读"存在的那几格"，注释还写着"别把存着的时间抹掉"），而外壳是无条件带上这两个键的
        //   （bodycord.js 的 calendarSave：`start: e.start`）⇒ patch[k] 就是 undefined。
        //   以前把它当"清空" ⇒ 玩家在那一档下改一个字，存着的时间就被静默抹掉 ✗
        //   ⇒ 只有**明确给了空串 / null** 才算清空 ✓
        if (patch[k] === undefined) continue;
        const raw = String(patch[k] == null ? '' : patch[k]).trim().slice(0, 12);
        if (!raw) { e[k] = ''; continue; }
        const min = parseClock(raw);
        if (min === null) { e[k] = raw; bad.push(k === 'start' ? '开始时间' : '结束时间'); }
        else e[k] = pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
    }
    // ★ A8：标题（可留空；和内容一样去空格、夹一个长度上限 ✓）
    if ('title' in patch) e.title = String(patch.title == null ? '' : patch.title).trim().slice(0, 40);
    // ★ 2026-10-26：备注**不设上限**（玩家自己写的内容不许截；格子里显示不下是显示层的事）
    if ('note' in patch) e.note = String(patch.note == null ? '' : patch.note).trim();
    e.at = Date.now();
    return { warn: bad.length ? (bad.join('和') + '看不懂，写成 13:05 这样') : '' };
}

function pad2(n) { return String(n < 10 ? '0' + n : n); }

/** 这一天的"小卡片"（格子那行字 + 有几条 ✓）—— 日号那边各自的 store 自己算（历法不同 ✓） */
export function calEvCard(list, date, unit) {
    const d = String(date || '').trim();
    if (!d) return { label: '', count: 0 };
    const hit = calEvSort((Array.isArray(list) ? list : []).filter((x) => String(x?.date || '') === d
        && calEvFilled(x, unit)));
    const labels = hit.map((x) => calEvLabel(x, unit)).filter(Boolean);
    return { label: labels[0] || '', count: labels.length, title: labels.join('，') };
}

/** 给面板格子的那份：有日程的那些日子 + 那天第一行的字（纯数据 ✓） */
export function calEvForPanel(list, unit) {
    const byDate = new Map();
    for (const e of (Array.isArray(list) ? list : [])) {
        if (!calEvFilled(e, unit)) continue;
        const d = String(e?.date || '');
        if (!d) continue;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(e);
    }
    return [...byDate.entries()].map(([date, arr]) => {
        const labels = calEvSort(arr).map((x) => calEvLabel(x, unit)).filter(Boolean);
        return { date, label: labels[0] || '', count: labels.length, title: labels.join('，') };
    });
}

/**
 * 清掉"空壳子"日程（点了「加一条」又什么都没写的那些 ✓）
 * ⚠️ `keepDate` 是**玩家正在编辑的那一天** —— 它一条都不碰（别把人家正打字的行抽走 ✗）
 * @returns {number} 清掉几条
 */
export function calEvPrune(arr, keepDate, unit) {
    const list = Array.isArray(arr) ? arr : [];
    const keep = String(keepDate || '');
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e || typeof e !== 'object') { list.splice(i, 1); n += 1; continue; }
        if (calEvFilled(e, unit)) continue;
        if (keep && String(e.date || '') === keep) continue;
        list.splice(i, 1);
        n += 1;
    }
    return n;
}

/** 真实公历某个月有几天（不依赖 Date ✓）—— deviceDateKey / parseDeviceDate 用它挡"不存在的日子" */
export function daysInRealMonth(y, m) {
    const yy = Math.max(1, Math.floor(Number(y) || 1));
    const mm = Math.min(12, Math.max(1, Math.floor(Number(m) || 1)));
    if (mm === 2) {
        const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
        return leap ? 29 : 28;
    }
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
}

/**
 * 真实公历的日期键：`YYYY-MM-DD`（现实日历那份用这个 ✓）
 * ★ 日号**夹到当月天数**里 —— 以前只夹 1~31，
 *   于是 `deviceDateKey(2026, 9, 31)` 会造出 `2026-09-31` 这个**不存在的日子**，
 *   写在它上面的日程永远匹配不到日历格子（红圈 / 小字 / 点开都没有 ✗）。
 */
export function deviceDateKey(y, m, d) {
    const yy = Math.max(1, Math.floor(Number(y) || 1));
    const mm = Math.min(12, Math.max(1, Math.floor(Number(m) || 1)));
    const dd = Math.min(daysInRealMonth(yy, mm), Math.max(1, Math.floor(Number(d) || 1)));
    return String(yy).padStart(4, '0') + '-' + pad2(mm) + '-' + pad2(dd);
}

/** 把 `YYYY-MM-DD` 拆回 `{y,m,d}`（认不出来给 null ✓；★ 日号超出当月天数也算认不出来） */
export function parseDeviceDate(text) {
    const s = String(text || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!(y >= 1) || !(mo >= 1 && mo <= 12)) return null;
    if (!(d >= 1) || d > daysInRealMonth(y, mo)) return null;
    return { y, m: mo, d };
}
