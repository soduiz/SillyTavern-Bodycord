/**
 * store.js —— 按聊天独立的状态存储
 *
 * 每个聊天（chat）单独一份档案，存进该聊天自己的 metadata，跟着聊天文件走。
 * 换角色卡、开新聊天，数据完全隔离，互不串。
 */

import { getChatMetadata, saveChatMetadata, getChatKey, getPersonaName, substitute, getCtx } from './st.js';
import { settings, save, amenorrheaRateOf, periodDaysOf, periodMode, isNeutralMode, termNameOf, traceNightsMapOf, traceNightsForLevel, getCalendarPreset, CAL_PRESET_BUILTIN, bodyCycleParamsOf, achLenOf, parseZoneRows, serializeZoneRows, zoneParamsOf, bodyCoefOf, peakCoefOf, protCoefOf, cycleDayInfoOf, cycleSettleDayOf, bodyRaceOf, factoryRaceOf, postpartumParamsOf, stageResidueMode, stageCleanMode, contactsHideDead, spermBellyOn, spermBellyTextIn, spermBellyTextOut, spermBellyTextVaginaIn, isModuleOn, awarenessWindowsOf, awarenessUpperOf, fetusCountOf, fetusSexRangeOf, fetusOvumRangeOf, fetusMixRangeOf, fetusDevAllLines, judgeBasisOf, talentTierLabelOf, talentTierTableOf, dominantSourceRangeOf, dominantSourceOf } from './settings.js';
import { deriveCycleFields, defaultCycleStartDay, randomCycleStartDay } from './derive.js';
// ★ 后半段那几个是「自定义历法」：换算都在 fiction-date.js 里，
//   store 只负责"现在用哪套 + 换套时把当前聊天的日期搬一次" ✓
//   ⚠️ import 的花括号里**不许写注释**（imports 测试的解析器会把注释当成标识符 ✗）
import {
    parseFictionDate, formatFictionDate, addDays, diffDays, FICTION_DATE_START,
    normalizeCalendar, activeCalendar, setCalendarProvider,
    calendarPrint, calendarFromPrint, convertDate, daysInMonthOf, formatClock, parseClock,
} from './fiction-date.js';
// ★ 日程那一套纯逻辑（排序 / 那行字 / 空壳子判定 / 改一格的校验）——
//   跟"现实日历"那份（存全局设置）**共用一份** ✓
//   （非聊天页面也要能记日程 —— 记录这件事本身不该被剥夺 ✓）
import { calEvId, calEvLabel, calEvFilled, calEvSort, calEvOn, calEvApply, calEvCard, calEvForPanel, calEvPrune, calEvRemindOn } from './calendar-events.js';
// ★ 胎儿状态（d6）的结构化读写 —— 「自动提醒」要从每个孩子的括号里读「预产期」✓
//   ⚠️ fetus.js 是叶子模块（它不 import 任何人）⇒ 引它不会成环 ✓
import { parseFetus, buildFetus, stripWeekBand } from './fetus.js';
// ★ 异种那格的解析只有一份（modules.js 是叶子模块 ⇒ 引它不成环）✓
import { parseXenoSideAnswer } from './modules.js';
export { FICTION_DATE_START };

// ★ 把"现在用哪套历法"接到全局设置上（`settings()` 是函数声明 ⇒ 惰性调用，不会踩模块环 ✓）
//   为什么用注入而不是在 fiction-date.js 里直接 import settings：
//   fiction-date 是**叶子模块**（谁都能引、它不引别人）⇒ 直接引会造出模块环 ✗
setCalendarProvider(() => settings().calendar);

export const STATE_KEY = 'bodycord_state';
export const USER_KEY = 'user';
// 时光机：上限提到 300。一个快照含全部对象的 raw 文本，
// 超出上限的会被挤掉（并提示导出）。
//
// ⚠️ 这里原来是写「300 条对 chat_metadata 大约几十 KB」—— 那句是**单对象时代**的账，早就不对了 ✗
//   （实测：300 层 × 3 个对象已经 0.61 MB，8 个对象 1.62 MB）
//   ⇒ 根因：这个上限是**按"条数"**卡的，而每条却存**每个对象一份完整面板文字**
//     ⇒ 对象一多，体积线性翻倍，可条数上限一点没变 ✗
export const MAX_SNAPSHOTS = 300;

// ★ 第二道闸：**总量保险丝**（不是玩法限制，别把它当"内容上限"看 ✗）
//
// 为什么要有它：`MAX_SNAPSHOTS` 只管条数，管不住体积 —— 追踪 8 个对象、跑上几百楼之后，
//   快照能涨到 1.6 MB 以上，而这份数据住在**聊天文件**里，每次落盘都要整份序列化一遍 ⇒ 越存越钝。
// 为什么定 1.5 MB：出厂那一档（1 个对象）300 条只有约 0.21 MB，**连零头都不到**
//   ⇒ 单一对象的玩家**永远碰不到这闸**（行为一字不变 ✓）；
//   8 个对象跑满 300 条是约 1.62 MB ⇒ 只在"对象很多、跑很久"时才开始从最旧的丢 ✓。
// 口径：量的是 `JSON.stringify` 之后的长度，也就是**真正要落盘的那份**。
export const SNAPSHOT_BUDGET = 1500000;
// ★ 往来流水账本的上限（**从 200 抬到 1000**）——
//   起因：数据尽量别截断，而那道 200 的闸正是**真会掉数据**的那一道。
//   ⚠️ 它仍然是**保险丝**（防聊天文件无限涨），不是内容上限；所以裁了要**记账**
//     （`state().insemsCut` 累计被裁掉的条数），界面会明说"更早的 N 条已经清掉了" ✓
export const INSEM_CAP = 1000;

/** 这份快照数据有多大（字符数，就是落盘那个口径）*/
export function measureSnapshots(snaps) {
    try { return JSON.stringify(Array.isArray(snaps) ? snaps : []).length; } catch { return 0; }
}

/**
 * 裁剪逻辑本体（**纯函数**，好单测 ✓）：按"从最旧的开始丢"把快照裁到两道闸之内。
 *
 * 两道闸：① 条数 `MAX_SNAPSHOTS`；② 总量 `SNAPSHOT_BUDGET`。
 * 注意它**原地改这个数组**（调用方给的就是 `state().snapshots`），返回丢了几条。
 */
export function pruneSnapshotList(list) {
    if (!Array.isArray(list)) return 0;
    const before = list.length;
    // ① 条数（老闸，先过一遍 —— 省得下面白算一次大 JSON）
    if (list.length > MAX_SNAPSHOTS) list.splice(0, list.length - MAX_SNAPSHOTS);
    // ② 总量（新闸）
    while (list.length > 1 && measureSnapshots(list) > SNAPSHOT_BUDGET) list.shift();
    return before - list.length;
}

/**
 * 把当前聊天的快照裁到上限之内。
 *
 * ⚠️ 只动 `state().snapshots`，别的地方一概不碰（红线：
 *    改数值时只碰被修改的那份数据，其他数据一律别碰）✓
 *
 * @returns {number} 丢了几条（0 = 没动）
 */
export function pruneSnapshots() {
    return pruneSnapshotList(state().snapshots);
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

function blankState() {
    return {
        schema: 1,
        targets: {},     // key -> target
        order: [],       // 显示顺序
        active: null,    // 当前查看的对象 key
        rolls: { values: {}, pool: null, lastUsed: null, locked: false, at: 0 },
        snapshots: [],
        // ★ 两个「保险丝裁过多少」的读数——
        //   只记**数字**（被清掉几条流水 / 几份快照），界面与诊断报告据此明说一句 ✓
        //   ⚠️ 必须在 `blankState()` 里登记：不然"新增字段要进诊断覆盖清单"那条断言看不见它 ✗
        insemsCut: 0,
        snapCut: 0,
        // ★ 面板那颗「状态笔记 · 刚刚更新」的**正本**（重新进酒馆还是刚刚更新）——
        //   原来时间戳与"内容指纹"只存在**面板 iframe 的浏览器缓存**里，而那个存储在
        //   某些环境里直接不可用（我们的 shim 会静默退回内存版）⇒ 一重进就归零 ✗
        //   ⇒ 现在正本跟着**聊天文件**走（`{ ts, sig, raw }`：时间戳 / 内容指纹 / 那一份原文）✓
        panelUpdate: null,
        // 「不参与推演」的楼层下标。
        // 以前是写在消息对象的 extra 上（msg.extra.bodycordExcluded），
        // 那逼得插件必须调 ST 的 saveChat() 去写用户的聊天文件 —— 太危险，改成存这里。
        excluded: [],
        // 身体痕迹登记表（插件托管，按对象 key 分开存；见文件末尾的痕迹函数）
        traces: {},
        // 排卵窗口受精判定的结果（由插件掷骰，见 judgment.js）
        //   { round, sub, rate, judgeValue, roll, passed, implantDays, at }
        //   ⚠️ 这两个是**旧的全局面**（只留一份），新版按对象分账见下面的 ovuJudgments ✓
        ovuJudgment: null,
        // ★★ 按对象分账的受精判定历史（受孕记录按对象分账 ✓ ——
        //   症状是"看哪个对象的受孕记录都是同一份全局历史" ✗）
        //   每条 = { target, round, sub, rate, judgeValue, roll, passed, implantDays, at }
        //   ⇒ `getOvuJudgment(key)` 取"这个对象最近一次的判定"✓
        ovuJudgments: [],
        // 判官最近一次报了什么（精简版：note / judgment / traces）
        // ★ 按对象分账（推演记录也按人分）——
        //   键 = 对象 key，值 = 那个人最近一次推演里 AI 报了什么 ✓
        //   （以前是一份全局的，切到别人看到的还是上一个人的报告 ✗）
        lastJudgeReports: {},
        // ★ 周期归档：换周期/分娩时，把当时的锁定和事件收进来（可随时查看）
        conceptionArchive: [],
        // 逐胎锁定的致孕方（异卵异父用）：[{ child, roll, impregnator }]
        impregnatorLocks: null,
        // ★ 来源 / 分批（2026-10-14）：「这一胎 / 这批卵是谁的」——
        //   一个字段两种用法：**单批＝植入方**（触手塞卵那种没有受精的）、**多批＝分批致孕方** ✓
        //   每条 = { target, text, parts:[{ by, count }], manual, at }
        //   ⚠️ 它**覆盖**逐胎锁定的**归属**（谁是孩子的爹），但**不参与任何判定**
        //     （受精成不成 / 受孕率 / 胎数 / 性别 / 同卵 一个都不碰 ✓）见 `impregnatorTextOf`
        impregnatorSources: null,
        // ★ 植入孕的起点（2026-10-14）：键 = 对象 key，值 = 剧情日期串 ✓
        //   有它就说明这一胎是**植入**来的（不是受精）⇒ ① 孕周从这天算（derive.js 的 pregDays）
        //   ② 跳过受精判定与着床判定（正文【表里没有对应大类】那段写着"受精判定跳过"✓）
        implantDates: {},
        // 内射 / 受孕记录（能回溯每一次受孕是哪次性行为导致的）
        // 每条 = 一次内射事件；其中 conceived=true 的那条就是中的那一次。
        // 世界书做不到这个（它没有累积状态、也不记得用了哪个骰子）。
        insems: [],
        // ★★ 2026-10-16（明明没有内射却记成内射）——
        //   玩家亲手删掉的那几笔**记在这儿**（存的是内射记录的去重键 `round|target|by|note`）：
        //   以后模型再报同一笔（它常常照着自己前几轮写过的条目抄 ✗）**直接不入账** ✓
        //   ⇒ 删掉就是真的删掉，不会下一轮又长回来 ✓
        insemMuted: [],
        // ★ 事后避孕药：AI 只报**事实**（本轮有没有服药），
        //   折扣由插件算 —— 每个对象每条 = `{ target, day, factor, round, at }`。
        //   为什么要记它：累计受孕率是"每次内射加几个点"的累加，而事后药是**把已累加的总数打折**
        //   ⇒ 光靠 contrib 表达不出来（以前那套"让 AI 把 d2 改成削减后的数"是空承诺 ✗）。
        //   ⚠️ `day` 是**周期日号**（和 insems 的 depositDay 同一个单位）⇒ 换周期时必须清掉，
        //     不然上一周期的药会折到本周期的批次上（周期日会重头数 ✗）
        pills: [],
        // 敏感带：本聊天自己的那一份（全局的「档案库」在 settings.zonePresets 里）
        zoneText: '',
        zonePresetId: '',
        // ★ 虚拟日期（剧情没给日期时用的那套日历）
        //   dateMode: 'story' = 剧情给了日期，用它 ✓ / 'fiction' = 剧情没给，用虚拟日历 ✓
        //   fictionDate: 当前虚拟日期，形如 `1年01月01日` ✓
        //   ⚠️ 这两项是**整个世界共用的**（剧情时间只有一个 ✓）—— 放在全局层是对的 ✓
        //   ★ 「上次月经日」**从这里搬走了** —— 它是**某个人的身体**、
        //     不是世界时间 ⇒ 现在按对象存在 `targets[key].cycleDay / cycleDayAt`（见下面那一节 ✓）
        //     老字段 `cycleStartDate` 只在读老存档时出现一次，`state()` 里会摊给每个对象再删掉 ✓
        dateMode: '',
        fictionDate: '',
        // ★ 这个聊天的日期是**哪套历法**写下来的（历法指纹）——
        //   老聊天没有这个字段 ⇒ 按公历算（它们确实是公历记的 ✓）。
        //   跟插件当前的历法不一致时，`syncCalendarForChat()` 会**天数守恒**搬一次 ✓
        calendarPrint: '',
        // ★★ 「这个聊天的时间跳跃算不算身体时间」（**聊天级**，默认算 ✓）——
        //   关掉 ⇒ 推演报回来的跨度只把日历往前挪，**已记日期一起搬**（差值守恒）⇒
        //   孕周 / 周期第几天 / 痕迹一个都不动（肉身穿越去未来 ✓）
        timeJumpSkipsBody: false,
        // ★ 玩家**自己点过**那一档没有（手改锁 ⇒ 定过就以玩家为准、不再每轮问引擎 ✓）
        timeJumpSkipsBodyManual: false,
        // ★★ 例外名单：这些人跟"世界那格"**相反**
        //   例：世界选「算身体时间」，名单里的人就是"身体没经历" ✓
        timeJumpExceptKeys: [],
        // ★ 标签那一格"下轮再问一次"的一次性开关（发生时间跳跃之后置上、问过就清 ✓）
        tagAskPending: false,
        // ★★ **回滚点**（真倒流用）：每推演一楼存一份"这一楼之前"的状态，
        //   玩家在时光机里点「从这里重新开始」就能整套退回去 ✓
        //   ⚠️ 只留最近几份（每份 ≈ 18 KB）；它属于"书架"，回滚时不动 ✓
        rollbackPoints: [],
        // ★ 上一次回滚之前抓的那份保险（「撤销刚才那次回滚」用；用完就丢 ✓）
        rollbackUndo: null,
        // ★ 当日第几分钟——
        //   ⚠️ 它**跟 fictionDate 分开存**：日期那套一字没动 ⇒ 周期/受孕/痕迹/年龄/
        //     换历法搬家**全都不用改** ✓✓（代价只是多一个整数 ✓）
        //   0 = 00:00；历法那档是「不记钟点」时它一律是 0 ✓
        fictionTime: 0,
        // 上面三项属于"时间"，不进诊断白名单字段清单时可忽略（它只报结构）
        lastRun: null,
        // ★ 最近一次推演的**模型原始回包**（诊断用，只留一份；见 setLastJudgeRaw）
        lastJudgeRaw: null,
        // ★ 回滚检查点 + 候选记录——
        //   ① checkpoint = "这一楼之前"的状态（任何一个候选重算时的起点）
        //   ② floorCandidates = 这一楼的**每一条备选回复各自算出来的记录**
        //   解决"重新生成 / 换候选会把同一段剧情算两次"和"5 条候选的记录都要留着" ✓
        checkpoint: null,
        floorCandidates: {},
        // ★ 涩涩成就——
        //   按**聊天**存（成就归聊天）：换聊天不带走，跟 insems 账本一个待遇 ✓
        //   每条 = { id, name, quip, target, targetKey, date, floor, at }
        achievements: [],
        // ★ 孩子（出生后的记录）——
        //   按**聊天**存，但每条带 `key`（谁生的）⇒ 面板按"当前查看的人"过滤 ✓
        //   每条 = { id, batch, key, name, sex, race, other, heritage, birthDate, floor, round, at }
        children: [],
        // ★★ 面板自带的那几样「玩家自己写的东西」（见文件末尾那一节）——
        //   以前它们只写在**浏览器本地存储**里 ⇒ 清浏览器数据就全没 ✗
        //   notes      = 随手记「本聊天」那一份（存的是面板那边的 JSON 字符串，原样存 ✓）
        //   zoneNotes  = 敏感带备注（按部位名索引）
        //   divHistory = 占卜台算过的历史记录（数组）
        //   ⚠️ 「全局」那份随手记不在这里 —— 它穿过所有聊天，跟 userBodyLock 一样存全局设置 ✓
        notes: '',
        zoneNotes: {},
        divHistory: [],
        // ★ 日历上的日程——
        //   每条 = { id, date: 剧情日期串, allDay, start, end, note, at }
        //   ⚠️ 按**聊天**存（跟 insems / achievements 一个待遇：这是这个故事的日程 ✓）
        //   ⚠️ 换历法时要跟着"天数守恒"搬（见 `_DATE_KEYS` 那条白名单 ✓）
        calendarEvents: [],
        // 已经提示过的日程（键 = `日期|那行字`）—— 到点那个小提示**只弹一次** ✓
        calendarAlerted: [],
        // ★★ 自动提醒（**独立于日历日程那套**，但复用那个提醒气泡 ✓）——
        //   每条 = { id, kind:'conceive'|'due', target, sub:'子N', name, date, note, seen, at }
        //   · `conceive` = 着床完成（怀孕了）⇒ 当场提示一次
        //   · `due` = 某胎的预产期 ⇒ 到那天提示（按剧情日期比 ✓）
        //   ⚠️ 按**聊天**存（跟日程 / 成就一个待遇 ✓）；时间轴平移时要跟着搬日期 ✓
        alerts: [],
    };
}

const _mem = new Map(); // 拿不到 chatMetadata 时的兜底

export function state() {
    const meta = getChatMetadata();
    if (!meta) {
        const k = getChatKey();
        if (!_mem.has(k)) _mem.set(k, blankState());
        return _mem.get(k);
    }
    if (!meta[STATE_KEY] || typeof meta[STATE_KEY] !== 'object') {
        meta[STATE_KEY] = blankState();
    }
    const s = meta[STATE_KEY];
    // 补齐可能缺的字段（版本升级用）
    if (!s.targets) s.targets = {};
    // ★★ 2026-10-30：顺手清掉老存档里那条**误记的「row3 手改」**——
    //   它会让每轮推演把旧文本写回近期性行为，快照/楼层那一行从此不再更新 ✗
    //   （读侧已经不算它了，见 `profileFixKeysOf`；这里只是别让它继续躺在存档里）
    for (const t of Object.values(s.targets)) {
        if (t && t.profileFix && typeof t.profileFix === 'object') delete t.profileFix.row3;
    }
    if (!Array.isArray(s.order)) s.order = [];
    if (!s.rolls) s.rolls = { values: {}, pool: null, lastUsed: null, locked: false, at: 0 };
    if (!s.rolls.values || typeof s.rolls.values !== 'object') s.rolls.values = {};
    if (!Array.isArray(s.snapshots)) s.snapshots = [];
    // 后加的字段也要补齐 —— 老聊天的状态对象里没有它们
    if (!Array.isArray(s.excluded)) s.excluded = [];
    if (!s.traces || typeof s.traces !== 'object' || Array.isArray(s.traces)) s.traces = {};
    if (typeof s.zoneText !== 'string') s.zoneText = '';
    if (typeof s.zonePresetId !== 'string') s.zonePresetId = '';
    // 虚拟日期（剧情没给日期时用的那套日历）—— 后加的字段，老聊天没有 ✓
    if (typeof s.dateMode !== 'string') s.dateMode = '';        // 'story'=剧情给了日期 / 'fiction'=虚拟 / ''=还没定
    if (typeof s.fictionDate !== 'string') s.fictionDate = '';
    if (typeof s.calendarPrint !== 'string') s.calendarPrint = '';   // 历法指纹（老聊天没有 ✓）
    // 当日第几分钟（老聊天没有 ⇒ 0 = 00:00 ✓）
    if (!Number.isFinite(Number(s.fictionTime))) s.fictionTime = 0;
    s.fictionTime = Math.min(1439, Math.max(0, Math.round(Number(s.fictionTime) || 0)));
    // ★ 老存档搬家：以前「上次月经日」是**整个聊天一份**（`s.cycleStartDate`），
    //   现在按对象存 ⇒ 见到它就摊给每个已建档的对象，然后把老字段删掉（不留两份真相 ✗）
    //   ⚠️ 这里**不 commit**（state() 是只读入口，谁取都会走到）——
    //     下一次正常落盘时它自然就被写回去了 ✓
    if (typeof s.cycleStartDate === 'string' && s.cycleStartDate) {
        const _legacy = s.cycleStartDate;
        const _d = s.fictionDate ? diffDays(_legacy, s.fictionDate) : null;
        const _day = (_d === null ? 0 : _d) + 1;
        for (const _k of (Array.isArray(s.order) ? s.order : Object.keys(s.targets || {}))) {
            const _t = s.targets?.[_k];
            if (!_t) continue;
            const _has = Number(_t.cycleDay) > 0;
            if (_has) continue;
            _t.cycleDay = Math.max(1, _day);
            _t.cycleDayAt = s.fictionDate || '';
        }
        delete s.cycleStartDate;
    } else if (s.cycleStartDate !== undefined) {
        delete s.cycleStartDate;
    }
    // 判官报告：按对象分账（后加的结构，老聊天没有 ✓）
    if (!s.lastJudgeReports || typeof s.lastJudgeReports !== 'object' || Array.isArray(s.lastJudgeReports)) s.lastJudgeReports = {};
    // 回滚检查点：后加的字段，老聊天没有 ✓
    if (s.checkpoint === undefined) s.checkpoint = null;
    // 玩家删掉的那几笔内射（后加的字段，老聊天没有 ✓）
    if (!Array.isArray(s.insemMuted)) s.insemMuted = [];
    // 候选记录（备选回复）：后加的字段，老聊天没有 ✓
    if (!s.floorCandidates || typeof s.floorCandidates !== 'object' || Array.isArray(s.floorCandidates)) s.floorCandidates = {};
    // 涩涩成就（后加的字段，老聊天没有 ✓）
    if (!Array.isArray(s.achievements)) s.achievements = [];
    // 孩子（后加的字段，老聊天没有 ✓）
    if (!Array.isArray(s.children)) s.children = [];
    // 面板自带那几样（后加的字段，老聊天没有 ✓）
    if (typeof s.notes !== 'string') s.notes = '';
    if (!s.zoneNotes || typeof s.zoneNotes !== 'object' || Array.isArray(s.zoneNotes)) s.zoneNotes = {};
    if (!Array.isArray(s.divHistory)) s.divHistory = [];
    // 日历：日程 + 已提示过的（后加字段，老聊天没有 ✓）
    //   ⚠️ 老键搬家那一段抽成了 `_calMigrateLegacy()` —— 因为 `state()` 在
    //      **拿不到 chat_metadata 时会提前 return**（走 `_mem` 兜底那条路），
    //      所以迁移还得在 `calendarEvents()` 里也走一遍 ✓
    _calMigrateLegacy(s);
    return s;
}

export function commit() {
    saveChatMetadata();
}

export function resetAll() {
    const meta = getChatMetadata();
    if (meta) meta[STATE_KEY] = blankState();
    else _mem.set(getChatKey(), blankState());
    commit();
}

// ---------------------------------------------------------------------------
// ★ 角色基础信息（「这个角色是什么」）
//
// 这一块装**插件不可能自己知道、只能由玩家/角色卡给出的事实** ——
//   · 能不能怀孕 / 能不能让别人怀孕 / 是不是异种
// 三个字段都三态：`null` = **未填**（一切按现在的行为、由推演 API 每轮报的说了算 ✓）
//                  `true` / `false` = 填了 ⇒ 插件**锁定用这个值**、忽略 AI 报的 ✓
//
// ⚠️⚠️ 存哪：**用户本人（{{user}}）存【全局设置】**，其他对象存【本聊天的档案】✓
//   **用户角色那一份一定要全局**、而且**不许删** ✓
//   理由：{{user}} 是同一个人、穿过所有聊天；而别的对象是"这个故事里的角色"，跟着聊天走 ✓
//   ⇒ 所以用户本人的值**任何清理逻辑都不许删** ✗
// ---------------------------------------------------------------------------

export const BODY_LOCK_FIELDS = ['canBePregnant', 'canImpregnate', 'isXeno', 'canBearXeno'];

function bodyLockEmpty() {
    return { canBePregnant: null, canImpregnate: null, isXeno: null, canBearXeno: null };
}

/** 这个对象是不是"用户本人"（只有它走全局存储） */
export function isUserKey(key) {
    return String(key) === USER_KEY;
}

/** 读某个对象的三态值（用户本人读全局设置，其他读本聊天档案） */
export function bodyLockOf(key) {
    if (!key) return bodyLockEmpty();
    if (isUserKey(key)) {
        const u = settings().userBodyLock || {};
        return {
            canBePregnant: u.canBePregnant ?? null,
            canImpregnate: u.canImpregnate ?? null,
            isXeno: u.isXeno ?? null,
            canBearXeno: u.canBearXeno ?? null,
        };
    }
    const t = state().targets?.[key];
    const b = t?.bodyLock || {};
    return {
        canBePregnant: b.canBePregnant ?? null,
        canImpregnate: b.canImpregnate ?? null,
        isXeno: b.isXeno ?? null,
        canBearXeno: b.canBearXeno ?? null,
    };
}

/**
 * 设某个对象的三态值。
 * @param {'canBePregnant'|'canImpregnate'|'isXeno'|'canBearXeno'} field
 * @param {boolean|null} value  null = 恢复"未填"（回到按 AI 判断）
 */
export function setBodyLockField(key, field, value) {
    if (!key || !BODY_LOCK_FIELDS.includes(field)) return false;
    const v = (value === true || value === false) ? value : null;
    if (isUserKey(key)) {
        const s = settings();
        if (!s.userBodyLock || typeof s.userBodyLock !== 'object') s.userBodyLock = bodyLockEmpty();
        s.userBodyLock[field] = v;
        save();                      // ★ 全局：立刻落盘，换聊天不丢 ✓
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (!t.bodyLock || typeof t.bodyLock !== 'object') t.bodyLock = bodyLockEmpty();
    t.bodyLock[field] = v;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// ★★ AI 每轮报的「能力」布尔值（四态设计的另一半）
//
// **角色设定里明显写着不能怀孕的，推演也必须判不能怀孕**——
//   总不能人设说不能怀孕、判定却给了能怀孕 ✓
//
// 查出来的洞：界面上那四格的下拉**都**写着「未填（按推演每轮判断）」，
//   但代码里只有「是不是异种」真接了 AI（prompt.js 读 vars.is_xeno）；
//   另外三格 null 一律按「能」算，契约里也从来没问过 ⇒ 界面在说谎 ✗
//   （四态本来就写着「null 未填＝全按推演报的」，
//    只做了"玩家锁定"那一半 ⇒ 这里把 AI 那一半接上 ✓）
//
// 判据：玩家填了 ⇒ 锁死、忽略 AI（这半早就做好了 ✓）；没填 ⇒ 看 AI 这一轮报的；
//      AI 也没报 / 报得认不出来 ⇒ 按「能」（跟以前一模一样，不改变老行为 ✓）
// ---------------------------------------------------------------------------

/** 「角色基础信息」那四格 ⇄ 契约里 AI 每轮报的字段名（同名的那个就是它 ✓） */
export const BODY_FLAG_VARS = {
    canBePregnant: 'can_be_pregnant',
    canImpregnate: 'can_impregnate',
    isXeno: 'is_xeno',
    canBearXeno: 'can_bear_xeno',
};

/** AI 报的值 → true / false / null（null = 没报，或者报了认不出来的话） */
export function reportedBool(v) {
    if (v === true || v === false) return v;
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (/^(true|1|yes|是|能|可以|异种|人外)$/i.test(s)) return true;
    if (/^(false|0|no|否|不是|不能|不可以|无)$/i.test(s)) return false;
    return null;
}

/** AI 这一轮给某个对象报的能力值（null = 没报 / 认不出来 ⇒ 调用方按老行为兜底） */
export function reportedBodyFlagOf(key, field) {
    const varKey = BODY_FLAG_VARS[field];
    if (!key || !varKey) return null;
    try { return reportedBool(state().targets?.[key]?.vars?.[varKey]); } catch { return null; }
}

/**
 * ★ 这一胎的另一个亲代算不算异种：
 * 只在**已经怀上**（`Is_Pregnant` 为真）、而且还没报过时问一次 ✓
 * 为什么问：异种规则表原来只按"追踪对象"（＝受孕方）发 ⇒ **人类妈妈 ＋ 异种爸爸那一胎，
 *   混血的孕期 / 遗传规则根本没发出去、全按人类算** ✗（孕期不会换爸爸 ⇒ 问一次就够 ✓）
 *
 * ★★ 这一格从「是 / 不是异种」**升级成「属于哪一边」** ——
 *   光有"是/不是"挑不出表：异种妈妈（西方）＋ 异种爸爸（东方）时，插件只知道
 *   "爸爸是异种"、不知道他属于东方那张表 ⇒ **东方那几行发不出去、混血的中间值算不出来** ✗
 *   ⇒ 现在问的是 `impregnator_side`：人类 / 西方与通用 / 东方（东西混血两个都填）；
 *   一个事实源同时回答"算不算异种"（不是人类就是异种 ✓）与"发哪张表"（见 prompt.js 的 fatherSides ✓）
 *   ⚠️ 剧情里还没交代那个亲代是什么种族 ⇒ 留空：插件下一轮还会问（这就是"改判通道" ✓），
 *     也**不白发异种表**（留空 ⇒ 不参与，跟老行为一致 ✓）
 */
export function needsImpregnatorSide(key) {
    const t = state().targets?.[key];
    if (!t) return false;
    if (String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() !== 'true') return false;   // 没怀上 ⇒ 不问 ✓
    // ★★ 判据必须是「**这份答案我能不能用**」，不是「字串空不空」✗
    //   原来只判空串 ⇒ 模型填了「未知」或填一个我们解析不出的大类名时，就变成
    //   **再也不问 ＋ 当人类处理** ⇒ 两张异种表永久不发、混血规则全按人类算（静默丢失）✗
    //   ⇒ 现在：留空 ⇒ 接着问；认得出属于哪一边 / 明确说人类 ⇒ 记着；认不出 ⇒ 接着问 ✓
    //   （跟 needsRaceCaps 遇「存疑」会继续问是同一套口径 ✓）
    const raw = String(t?.vars?.impregnator_side ?? '').trim();
    if (raw === '') return true;
    return parseXenoSideAnswer(raw).kind === 'unknown';
}

/**
 * ★ 这个对象的「种族 ＋ 那几格能力」还需要推演报一次吗？
 *
 * 这几格是**角色设定**（一次说清、不会每轮变）⇒ 一旦玩家在面板上锁了三态、或者推演报过一次，
 *   就不再每轮重复问 ✓（跟 `fertility_tier` 完全同一套做法）
 * ⚠️ 要害在于：**要的是"第一次就完全知道这个对象是什么种族"** ✗ 不是每轮重问
 *   ⇒ 所以"判据写死"在契约那几格的说明里（优先读世界书 / 角色描述 / 名单设定），
 *     这里负责**记住**它、并在**剧情揭晓时允许改判**（那一轮报了就覆盖 ✓ 见 `upsertTargetResult`）
 * @returns {boolean} true = 契约里要带上那几行
 */
export function needsRaceCaps(key) {
    const t = state().targets?.[key];
    if (!t) return false;
    let lock = null;
    try { lock = bodyLockOf(key); } catch { /* 忽略 */ }
    for (const field of Object.keys(BODY_FLAG_VARS)) {
        if (lock && typeof lock[field] === 'boolean') continue;          // 玩家锁了 ⇒ 不用问 ✓
        if (reportedBodyFlagOf(key, field) !== null) continue;            // 推演报过 ⇒ 不用问 ✓
        return true;                                                     // 有一格没定 ⇒ 要问
    }
    const rj = raceJudgeOf(key);
    if (!rj.race) return true;                                           // 种族还没报过 ⇒ 要问 ✓
    return rj.src === '存疑';                                             // 报得没把握 ⇒ 下一轮接着问（等材料出现）✓
}

/**
 * ★ 这个对象的**真实种族 ＋ 这一格是怎么来的**（「强制判对」）。
 *
 * 来源四态（优先级从高到低）：
 *   · **玩家**  —— 你在面板上点了「是不是异种」⇒ 锁死，AI 判什么都盖不住 ✓
 *   · **设定**  —— 推演说依据是世界书 / 角色描述 / 名单设定里明写的真相 ✓
 *   · **推断**  —— 推演说是从剧情或角色卡推出来的 ✓
 *   · **存疑**  —— 没报来源 / 报得认不出来 / 明说材料里没写 ⇒ **不算已确认**，
 *                 面板上会摆出来给你看，而且下一轮还会再问它一次 ✓
 * ⚠️ 这一格**只进判定层与面板**，不碰描写层（剧情里对谁公开是主 API 的事 ✓）
 * @returns {{race:string, src:'玩家'|'设定'|'推断'|'存疑'}}
 */
export function raceJudgeOf(key) {
    const t = state().targets?.[key];
    const asked = String(t?.vars?.race ?? '').trim();                   // 推演报的那份
    const set = (() => { try { return bodyRaceOf(key); } catch { return ''; } })();       // 补丁那格
    const factory = (() => { try { return factoryRaceOf(); } catch { return ''; } })();   // 出厂那份
    // ★ **光靠"跟出厂不一样"猜不出"你改过没有"** ✗ ——
    //   `人类` 正好就是出厂值：玩家选了它，却被判成"没改过" ✗
    //   ⇒ 现在以**真的动过这格**为准（`t.raceManual`，面板写那格时打上，照敏感带那套"手改锁" ✓），
    //     "跟出厂不一样"只当老数据/别处写正文时的兜底 ✓
    const manual = t?.raceManual === true;
    const mine = (set && (manual || set !== factory)) ? set : '';
    // ★ **出厂那份也是个值** —— 以前 `mine` 空了就当成"没填"，
    //   于是把种族填成「人类」（正好等于出厂值）时，读数说"还没填" ✗
    const race = mine || asked || set;
    let lock = null;
    try { lock = bodyLockOf(key); } catch { /* 忽略 */ }
    const locked = !!(lock && typeof lock.isXeno === 'boolean');
    if (mine) return { race, set, asked, src: '玩家', locked, manual };  // 你动过那格 ⇒ 你说了算 ✓
    if (asked) {
        const raw = String(t?.vars?.race_source ?? '').trim();
        if (raw.includes('设定')) return { race, set, asked, src: '设定', locked, manual };
        if (raw.includes('推断')) return { race, set, asked, src: '推断', locked, manual };
        return { race, set, asked, src: '存疑', locked, manual };        // 报了但说不出依据 ⇒ 待确认 ✓
    }
    if (set) return { race, set, asked, src: '默认', locked, manual };   // 补丁里那行（出厂就有的）⇒ 按设定 ✓
    return { race, set, asked, src: locked ? '玩家' : '存疑', locked, manual };
}

/** ★ 面板上**动过「这个角色的种族」那格** ⇒ 打这个标记（照敏感带那套手改锁 ✓） */
export function setRaceManualOf(key, on = true) {
    const t = state().targets?.[key];
    if (!t) return false;
    if (on) t.raceManual = true; else delete t.raceManual;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// ★ 「受孕体质档」
//
// 让 AI 按角色设定判断受孕体质 —— 设定明显很弱的（怀孕能力之类的）
//   或者很强的，都由 AI 自己填这个角色（NPC）的初始体质。
//
// 它 = 身体补丁里那行「日常体质系数」，由推演**按角色设定判一个档**填初值。
//   · 只判一次（这个对象定过档就不再问 ⇒ 省 token、也不会一轮一个数地飘 ✓）
//   · 玩家手改过 ⇒ 记 `fertilityManual`，AI 一律不再覆盖（照敏感带那套"手改锁" ✓）
//   · **只管 NPC**：用户本人那份是全局设置、穿所有聊天，这一版不动它 ✓
// 存哪：本聊天的 `targets[key]`（跟 xenoClass / bodyLock 一个待遇 ✓）
// ---------------------------------------------------------------------------

/** AI 给这个对象判的受孕体质档（'' = 还没判过） */
export function fertilityTierOf(key) {
    if (!key) return '';
    return String(state().targets?.[key]?.fertilityTier || '');
}

/** 记下 AI 判的档（定过就不再问 ✓） */
export function setFertilityTierOf(key, tier) {
    const t = state().targets?.[key];
    if (!t) return false;
    const v = String(tier ?? '').trim();
    if (v) t.fertilityTier = v; else delete t.fertilityTier;
    commit();
    return true;
}

/** 玩家手改过这一格没有（改过 ⇒ AI 不许再覆盖 ✓） */
export function fertilityManualOf(key) {
    if (!key) return false;
    return state().targets?.[key]?.fertilityManual === true;
}

export function setFertilityManualOf(key, on) {
    const t = state().targets?.[key];
    if (!t) return false;
    if (on) t.fertilityManual = true; else delete t.fertilityManual;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// ★ A3（2026-10-14）：**察觉档位**（A~E）＋**剧情强制提前**这两件事由插件记着
//
// 病根：那两个区间表就在设置里（面板上还能改），孕周 / 着床后天数也是插件算好喂回去的，
//   可「该不该怀疑、该不该确认」以前是模型**每轮读那张大表自己判** ✗
//   ⇒ 模型判飘了没人拦得住，而且正文里那张表每轮都要背一遍。
//
// 现在：
//   · **档位**（A~E）＝角色设定 ⇒ 只问一次（跟 `fertilityTier` 同一套做法 ✓）
//     剧情/设定上有了更准的判断时模型可以再报一次，以新的为准（改判通道 ✓）
//   · **怀疑 / 确认**＝插件按「档位区间 × 孕周（或着床后天数）」算 ⇒ `awarenessStateOf()`
//   · **剧情强制提前**（验孕、就医、他人告知）＝只有剧情知道的事实 ⇒ 模型报一次，
//     插件记下来并且**只前进不后退**（正文自己写着"已有剧情明确表现察觉程度时以剧情为准" ✓）
//
// 存哪：本聊天的 `targets[key]`（跟 fertilityTier 一个待遇 ✓）；新一轮怀孕时清掉提前事件 ✓
// ---------------------------------------------------------------------------

/** 这个对象的察觉档位（'' = 还没判过；认不出 / 坏的 ⇒ 回 C 档由调用方兜 ✓） */
export function awarenessTierIdOf(key) {
    if (!key) return '';
    if (isUserKey(key)) return String(settings().userAwarenessTier || '').trim().toUpperCase();
    return String(state().targets?.[key]?.awarenessTier || '').trim().toUpperCase();
}

/**
 * 记下档位（定过就不再问 ✓；传空 = 忘掉它，下次怀孕会再问一次 ✓）
 * @param {{manual?: boolean}} opts manual=true = 玩家手选 ⇒ 锁住，AI 再报也不覆盖
 */
export function setAwarenessTierIdOf(key, tier, opts = {}) {
    const t = state().targets?.[key];
    if (!t) return false;
    const v = String(tier ?? '').trim().toUpperCase();
    const manual = opts.manual === true;
    // ★ 玩家自己那份存全局（跟身体补丁 / 能不能怀孕一个待遇）✓
    if (isUserKey(key)) {
        const s = settings();
        if (v && s.userAwarenessTierManual === true && !manual) return false;
        s.userAwarenessTier = v;
        s.userAwarenessTierManual = v ? (manual || s.userAwarenessTierManual === true) : false;
        save();
        return true;
    }
    if (v && t.awarenessTierManual === true && !manual) return false;
    if (v) {
        t.awarenessTier = v;
        t.awarenessTierManual = manual || t.awarenessTierManual === true;
    } else {
        delete t.awarenessTier;
        delete t.awarenessTierManual;
    }
    commit();
    return true;
}

/** 剧情强制提前记到哪一档了（'' / '怀疑' / '确认'）—— 只前进不后退 ✓ */
export function awarenessEventOf(key) {
    if (!key) return '';
    return String(state().targets?.[key]?.awarenessEvent || '').trim();
}

/**
 * 记一次「剧情让它提前知道了」的事实。
 *
 * ⚠️ 只前进不后退：已经到"确认"之后再报"怀疑"不算数（剧情不会把已知的事变回未知 ✓）。
 *   清空（传空串）只在**新一轮怀孕**时由 `syncPregnancyState` 调 ✓
 */
export function noteAwarenessEvent(key, word) {
    const t = state().targets?.[key];
    if (!t) return false;
    const rank = { '': 0, '怀疑': 1, '确认': 2 };
    const v = String(word ?? '').trim();
    if (!(v in rank)) return false;
    const cur = String(t.awarenessEvent || '');
    if (rank[v] > (rank[cur] ?? 0)) {
        t.awarenessEvent = v;
        commit();
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// ★ 「属于哪个大类」：
//   选人外的时候填种族，然后还要能选属于哪个大类 ✓
//
//   它 = 这个对象属于 [异种扩展包 · 西方与通用] 那张表的**哪一行**（选项表在 `modules.js` 的 XENO_CLASSES ✓）
//   · 空 = 没选 ⇒ **按推演每轮判**（专门留了这一项 ✓）
//   · 选了就写进**推演名单**（judge.js 的 rosterBlock：「异种大类＝X」）⇒ AI 不用自己猜 ✓
//   存哪照老规矩：**本人 ⇒ 全局设置**（穿所有聊天 ✓）、其他对象 ⇒ 本聊天档案 ✓
// ---------------------------------------------------------------------------

/** 这个人属于哪个大类（'' = 没选，按推演每轮判 ✓） */
export function xenoClassOf(key) {
    if (!key) return '';
    if (isUserKey(key)) return String(settings().userXenoClass || '');
    return String(state().targets?.[key]?.xenoClass || '');
}

/** 设某个对象的大类（空串 = 清掉 ⇒ 回到"按推演每轮判" ✓） */
export function setXenoClassOf(key, value) {
    const v = String(value ?? '').trim();
    if (isUserKey(key)) {
        settings().userXenoClass = v;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (v) t.xenoClass = v; else delete t.xenoClass;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// ★ 别名与备注（"怎么认出是同一个人"）
//
// 两条设计约束：
//   · AI 可能把同一个角色拆成两个差异化的角色 ⇒ 需要考虑合并 ✓
//   · 还要处理"同名但不是同一个人"的情况 ✓
//   · 方案：**别名表 + 备注信息，但不是改名字** ✓✓
//
// ⇒ 设计：**名字不是身份，别名表才是** ✓
//   · **别名**：这一份档还认哪些叫法（例：`阿杰 / 杰哥 / 小杰`）⇒ 推演报任何一个都会对上它 ✓
//   · **备注**：只给人看的说明（例：`一班的丽娜`），用来区分两个同名角色 ✓
//   · 同名两人各自填不同别名 ⇒ **各归各家、不打架** ✓
//   · **不靠"改档案名"来解决同名** ✗（改名字那条路不可走）
//
// ⚠️ 存哪同「角色基础信息」：**用户本人存全局**、其他对象存本聊天档案 ✓
// ---------------------------------------------------------------------------

/** 把一串别名文本切开：支持 `/`、`、`、`,`、`|`、空白、换行 ✓ */
export function parseAliases(text) {
    return String(text || '')
        .split(/[\/、,，|｜\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

/** 这个对象的身份信息（别名表 + 备注 + 标签），编辑区用 */
export function identOf(key) {
    if (!key) return { aliases: '', note: '', tags: '' };
    if (isUserKey(key)) {
        const u = settings().userIdent || {};
        return { aliases: String(u.aliases || ''), note: String(u.note || ''), tags: String(u.tags || '') };
    }
    const t = state().targets?.[key];
    const i = t?.ident || {};
    return { aliases: String(i.aliases || ''), note: String(i.note || ''), tags: String(i.tags || '') };
}

/** 改这个对象的别名 / 备注 / 标签（跟 setBodyLockField 一个套路：用户本人走全局 ✓） */
export function setIdentField(key, field, value) {
    if (!key || (field !== 'aliases' && field !== 'note' && field !== 'tags')) return false;
    const v = String(value ?? '');
    if (isUserKey(key)) {
        const s = settings();
        if (!s.userIdent || typeof s.userIdent !== 'object') s.userIdent = { aliases: '', note: '', tags: '' };
        s.userIdent[field] = v;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (!t.ident || typeof t.ident !== 'object') t.ident = { aliases: '', note: '', tags: '' };
    t.ident[field] = v;
    // ★ 标签打了"手改锁"：引擎之后不再覆盖它（跟种族 / 体质档那套一样 ✓）
    //   ⚠️ 只有**标签**才打锁；别名与备注本来就只有玩家会写 ✓
    if (field === 'tags') t.ident.tagsManual = true;
    commit();
    return true;
}


/**
 * ★ 只挂在**一个**对象上的标签 ⇒ 可以当别名参与对档 ✓
 *   （同一个标签挂在两个人身上时只当分类，不然"未来篇"这种词会把两个人一起匹上 ✗）
 */
export function uniqueTags() {
    const count = new Map();
    for (const t of targetList()) {
        let arr = [];
        try { arr = parseAliases(identOf(t.key).tags); } catch { arr = []; }
        for (const x of arr) {
            const k = x.toLowerCase();
            count.set(k, (count.get(k) || 0) + 1);
        }
    }
    const out = [];
    for (const [k, n] of count) if (n === 1) out.push(k);
    return out;
}

/**
 * ★ 引擎报回来的标签 ⇒ 并进这个对象（**手改过就以玩家为准，不覆盖** ✓）。
 * 只并进来、不删旧的（标签只增不减，想删是玩家在界面上删 ✓）
 */
export function applyReportedTags(key, tags) {
    const k = String(key || '');
    if (!k) return false;
    const t = state().targets?.[k];
    if (!t) return false;
    if (!t.ident || typeof t.ident !== 'object') t.ident = { aliases: '', note: '', tags: '' };
    if (t.ident.tagsManual === true) return false;          // 手改锁 ⇒ 一个字都不动 ✓
    const incoming = (Array.isArray(tags) ? tags : [tags])
        .flatMap((x) => { try { return parseAliases(x); } catch { return []; } });
    if (!incoming.length) return false;
    const have = new Set((() => { try { return parseAliases(t.ident.tags); } catch { return []; } })().map((x) => x.toLowerCase()));
    const add = incoming.filter((x) => !have.has(x.toLowerCase()));
    if (!add.length) return false;
    t.ident.tags = [...(t.ident.tags ? parseAliases(t.ident.tags) : []), ...add].join(' / ');
    commit();
    return true;
}



// ---------------------------------------------------------------------------
// ★ 对象专属的补丁文案（**按聊天存**）
//
// **用户本人那份仍然全局、其他角色按聊天** ✓
//
// 为什么必须按聊天：补丁文本里**嵌着这个角色的数值**（周期长度 / 排卵日 / 体质系数
//   就写在「身体补丁」那段散文里，参数面板改的就是它）。
//   以前它按**名字**存在插件设置里 ⇒ 跨聊天共用 ⇒
//   在 A 聊天把丽娜改成异种，B 聊天里那个普通人的丽娜也跟着变味 ✗
//   而身体档案 / 敏感带 / 三态**早就都是按聊天存的** ⇒ 现在规则统一 ✓
//
// ⚠️ 用户本人（USER_KEY）**不走这里** —— 它在 settings().targetPatches 里，
//   见 settings.js 的 moduleText / setModuleText（那边做了分流）✓
// ⚠️ 存在 `targets[key].patches` 里（不是另开一个 metadata 键）：
//   这样**删对象 / 并对象时数据天然跟着走**，也不会多出一个得各处登记的键 ✓
// ---------------------------------------------------------------------------

/** 这个对象改过的补丁（moduleId -> 文案）。没有就返回空对象。 */
export function targetPatchBag(key) {
    const t = state().targets?.[key];
    const bag = t?.patches;
    return (bag && typeof bag === 'object' && !Array.isArray(bag)) ? bag : {};
}

/** 这个对象某条模块的专属文案（没改过 ⇒ null） */
export function targetPatchText(key, id) {
    const v = targetPatchBag(key)?.[id];
    return (typeof v === 'string' && v.length) ? v : null;
}

/**
 * 写 / 删这个对象的某条专属文案。
 * @param {string|null} text 传 null ⇒ 删掉这条（回到"没改过"）
 */
export function setTargetPatchText(key, id, text) {
    const t = state().targets?.[key];
    if (!t) return false;
    // 用户本人那份在全局设置里，别在这儿也存一份（两处会打架 ✗）
    if (isUserKey(key)) return false;
    if (!t.patches || typeof t.patches !== 'object' || Array.isArray(t.patches)) t.patches = {};
    if (text === null || text === undefined) delete t.patches[id];
    else t.patches[id] = String(text);
    if (!Object.keys(t.patches).length) delete t.patches;   // 不留空壳 ✓
    commit();
    return true;
}

/** 有几个对象改过专属补丁（诊断报告用，只报个数不报内容 ✓） */
export function targetPatchCount() {
    const s = state();
    return Object.keys(s.targets || {}).filter(k => Object.keys(targetPatchBag(k)).length).length;
}

/**
 * 把一个名字对回已有的追踪对象（**先比别名表、再比档案名**）。
 *
 * ⚠️⚠️ 顺序很关键（"同名但不是同一个人怎么办"就靠它解 ✓）：
 *   **先看谁的别名表里有这个名字 ⇒ 就是谁** ✓
 *   ⇒ 两个同名角色各自填了不同别名（`丽娜 / 一班` 和 `丽娜 / 二班`）时，
 *     推演报「一班的丽娜」只会命中第一个 ✓ **各归各家、不打架** ✓
 *   别名都没命中 ⇒ 再退回"档案名完全相等"（老行为，兜底 ✓）。
 *
 * @returns {object|null} 命中的对象（没有就 null）
 */
// ---------------------------------------------------------------------------
// ★ 名字上的"装饰"要能剥掉（AI 顺手把名单里的说明抄回来）
//
// 起因（实测）：推演名单里本人那一行写的是
//   `示例角色（用户本人 / 主控角色）`，而契约又写着「name 必须与名单写法完全一致」⇒
//   引擎照抄整行回来时**两边都对不上** ⇒ 自动模式下会凭空建出一个
//   叫「示例角色（用户本人 / 主控角色）」的**幽灵对象** ✗
// ⇒ 匹配时先按**原样**试一次，不行再把**尾部括号**剥掉试一次 ✓
//   （名字本来就带括号的人照样能对上，因为原样那一次排在前面 ✓）
// ---------------------------------------------------------------------------
const NAME_TAIL_DECOR = /[\s]*[（(【\[][^）)】\]]*[）)】\]][\s]*$/;

/** 剥掉名字尾部的括号说明（「示例角色（用户本人）」⇒「示例角色」；最多剥三层） */
export function stripNameDecor(name) {
    let s = String(name ?? '').trim();
    for (let i = 0; i < 3; i++) {
        const next = s.replace(NAME_TAIL_DECOR, '').trim();
        if (next === s || !next) break;      // 剥空了（名字本身就是括号）⇒ 保持原样 ✓
        s = next;
    }
    return s;
}

export function findTargetByReportedName(rawName, opts = {}) {
    const want = String(rawName || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!want) return null;
    const s = state();
    // ★ 新参数 `skipUser`：**同名时"角色优先"** —— 本人那一支由调用方放到最后兜底 ✓
    const list = s.order.map(k => s.targets[k]).filter(Boolean)
        .filter(t => !(opts.skipUser && t.isUser));
    // ① 先比"别名表 ＋ 独一无二的标签"（排除"完全等于档案 key"这种老路，留给第 ② 步）
    const uniq = (() => { try { return new Set(uniqueTags()); } catch { return new Set(); } })();
    for (const t of list) {
        const words = (() => {
            try {
                const idn = identOf(t.key);
                // ★ 标签里**只挂在这一个人身上**的那些才参与对档 ✓
                //   （挂在两个人身上的只当分类用，不然会把两个人一起匹上 ✗）
                return [
                    ...parseAliases(idn.aliases),
                    ...parseAliases(idn.tags).filter((x) => uniq.has(x.toLowerCase())),
                ];
            } catch { return []; }
        })();
        if (words.some(a => a.trim().toLowerCase().replace(/\s+/g, '') === want)) return t;
    }
    // ② 再比档案名（老行为）
    for (const t of list) {
        try { if (displayName(t).trim().toLowerCase().replace(/\s+/g, '') === want) return t; } catch { /* 忽略 */ }
    }
    return null;
}

// ---------------------------------------------------------------------------
// 追踪对象
// ---------------------------------------------------------------------------

/** 用户自己的显示名（真人设名，兜底 {{user}}） */
export function userDisplayName() {
    try {
        const n = getPersonaName();
        if (n && n !== '{{user}}') return n;
    } catch { /* 忽略 */ }
    return '{{user}}';
}

/**
 * ★ 「你自己」在界面上的**名字**（给用户看的地方一律用它 ✓）
 *
 * 名字显示成「你自己」是不对的，
 *   应该替换成**当前使用角色的名字** ✓✓
 *   ⇒ 凡是**名字槽位**（存档默认名、下拉里的显示名、错误提示里指谁），
 *     都要显示**当前人设名**；拿不到（或还是 `{{user}}` 那种宏）才退回「你自己」✓
 *
 * ⚠️ 别拿 `userDisplayName()` 直接给用户看 —— 它拿不到人设名时返回的是宏 `{{user}}` ✗
 */
export function userLabel() {
    try {
        const n = String(userDisplayName() || '').trim();
        if (n && !n.includes('{{')) return n;
    } catch { /* 忽略 */ }
    return '你自己';
}

/**
 * 名单/下拉里那一项的显示名：`示例角色（你自己）`（拿不到人设名就只写「你自己」✓）
 * 名单里其他对象显示成「对象：丽娜」，本人这一项要一眼看出"是自己" ✓
 */
export function userSelfLabel() {
    const n = userLabel();
    return n === '你自己' ? '你自己' : `${n}（你自己）`;
}

export function displayName(t) {
    if (!t) return '';
    return substitute(t.name || '');
}

/**
 * 按关键词筛「追踪对象」（显示名 / key / 别名），大小写不敏感。空关键词 ⇒ 原样返回。
 *
 * ★ 为什么要抽成纯函数：面板的「对象选择窗」和设置页的「已建档对象列表」是**同一件事**，
 *   两处各写一份筛选逻辑迟早会走岔 ✗ ⇒ 一处实现、两边共用（也能被单测直接锁 ✓）。
 *
 * ★★ 边界：**只吃传进来的 `list`，绝不自己去读全局配置** ✗
 *   这份名单是【本聊天】的（调用方给 `targetList()`，它读的是 chat_metadata）——
 *   要是这里顺手去读 `settings().targetNames`，就会把别的聊天的名字搜出来 ✓（口径：
 *   设置页的名单搜索也按聊天隔离、不要全局，因为非聊天页面只有 USER 一个角色 ✓）。
 */
export function filterTargets(list, keyword) {
    const all = Array.isArray(list) ? list.filter(Boolean) : [];
    const kw = String(keyword ?? '').trim().toLowerCase();
    if (!kw) return all;
    return all.filter((t) => {
        let aliases = '';
        try { aliases = identOf(t?.key).aliases; } catch { /* 忽略 */ }
        return [displayName(t), t?.key, aliases]
            .some((p) => String(p ?? '').toLowerCase().includes(kw));
    });
}

export function createTarget(name, opts = {}) {
    const trimmed = String(name).trim();
    const isMacro = trimmed === '{{user}}';
    let key = opts.key || (isMacro ? USER_KEY : trimmed);
    // ★ 用户本人的键是**保留**的（内部就是 'user'）——
    //   一个真叫 "user" 的角色要是也用它，就会**静默并进本人那一份** ✗
    //   （实测过的洞 ⇒ 给它换一个不会撞的键，显示名不变 ✓）
    if (!opts.key && !isMacro && key === USER_KEY) key = USER_KEY + '·角色';
    if (!key) return null;
    const s = state();
    if (!s.targets[key]) {
        s.targets[key] = {
            key,
            name: key === USER_KEY ? '{{user}}' : trimmed,
            isUser: key === USER_KEY,
            createdAt: Date.now(),
            updatedAt: 0,
            present: true,
            vars: {},
            profile: null,
            period: null,
            raw: '',
            note: '',
        };
        s.order.push(key);
        // ★ 新对象：顺手种上"新存档的周期起始"（默认卵泡中期，设置里可自定义 ✓）
        //   ⚠️ 只对**新建**的对象种 —— 已有对象一个字都不动（红线 ✓）
        //   这时剧情日期可能还没有 ⇒ 锚点留空，等第一次推演拿到日期再补上 ✓
        try { ensureCycleState(key); } catch (e) { console.warn('[Bodycord] 种周期起始失败', e); }
    }
    if (!s.active) s.active = key;
    commit();
    return s.targets[key];
}

export function removeTarget(key) {
    const s = state();
    delete s.targets[key];
    s.order = s.order.filter(k => k !== key);
    if (s.active === key) s.active = s.order[0] || null;
    commit();
}

export function targetList() {
    const s = state();
    return s.order.map(k => s.targets[k]).filter(Boolean);
}

export function setActive(key) {
    const s = state();
    if (s.targets[key]) { s.active = key; commit(); }
}

// ---------------------------------------------------------------------------
// ★★ 「轻档」——
//   自动模式里"只露过一面、身上一点账都没有"的名字，**只登记名字**
//
// 病根：自动建档原来"报到就建正式档" ⇒ 这些档把 **追踪人数上限** 占满
//   （`trackingRoster()` 是按建档顺序取前 N 个）⇒ 真正要追的人被挤出去 ✗
//
// 口径：
//   · **不进推演名单**（不吃 token、不占人数上限）✓
//   · 身上一有账（这一轮报来身体事实 / 内射 / 判定 / 怀孕 / 孩子 / 锁定 / 来源 /
//     敏感带 / 泌乳 / 生产次数 / 痕迹 / 手改过周期）⇒ **升格**成正式档 ✓
//   · **玩家手加 / 手选的一律是正式档**（`createTarget` 默认就不是轻档 ✓）
//   ⚠️ 升格之后**不自动降回**（不然它的数据会忽隐忽现 ✗）
//   ⚠️ 它跟正式档是**同一份档案**，只是带一个标记 ⇒ 升格 ＝ 把标记摘掉，数据一行都不用搬 ✓
// ---------------------------------------------------------------------------

/** 这个对象现在是不是"轻档"（只登记了名字的） */
export function isTargetLight(key) {
    try { return state().targets?.[String(key || '')]?.light === true; } catch { return false; }
}

/** 设 / 取消轻档（`light=false` ⇒ 升格成正式档 ✓）
 *  ★ 2026-10-23（她问「为什么轻档有周期？」）—— 轻档的定义是"只登记名字、不进推演名单"，
 *    可 `createTarget` 建对象时会**无条件**种一份周期起始 ⇒ 轻档身上挂着 Day25、0% 这种读数，
 *    看着像真在追踪 ✗ ⇒ 退回轻档时把那颗种子清掉（升格后第一次进推演会重新种 ✓） */
export function setTargetLight(key, light) {
    try {
        const t = state().targets?.[String(key || '')];
        if (!t) return false;
        if (light) {
            t.light = true;
            try { delete t.cycleDay; delete t.cycleDayAt; } catch { /* 忽略 */ }
        } else delete t.light;
        commit();
        return true;
    } catch { return false; }
}

/** 这一轮报回来的那份资料里，有没有"身体事实"（＝这个人值得追踪） */
export function reportedBodyFactOf(res) {
    try {
        const has = (v) => {
            const x = String(v ?? '').trim();
            return !!x && !/^(无|—|-|未加载|不适用)$/.test(x);
        };
        if (has(res?.profile?.row3)) return true;    // 近期性行为
        if (has(res?.profile?.d6)) return true;      // 胎儿状态
        if (has(res?.profile?.d7)) return true;      // 泌乳状态
        const pill = String(res?.vars?.emergency_pill ?? '').trim().toLowerCase();
        if (pill === 'true') return true;            // 吃过事后药
        const imp = String(res?.vars?.implanted ?? '').trim().toLowerCase();
        if (imp === 'true' || imp === '1' || imp === 'yes' || imp === '是') return true;   // 发生过植入
    } catch { /* 忽略 */ }
    return false;
}

/** 插件这边已经给这个对象记过账没有（判定 / 内射 / 怀孕 / 孩子 / 锁定 / 来源 / 敏感带 / 泌乳…） */
export function hasBodyLedger(key) {
    try {
        const s = state();
        const k = String(key || '');
        if (!k) return false;
        const mine = (arr, f) => Array.isArray(arr) && arr.some((x) => String(x?.[f] || '') === k);
        if (mine(s.insems, 'target')) return true;
        if (Array.isArray(s.ovuJudgments) && s.ovuJudgments.some((x) => String(x?.target || '') === k && x?.settled !== true)) return true;
        if (mine(s.children, 'key')) return true;
        if (mine(s.impregnatorLocks, 'target')) return true;
        if (mine(s.impregnatorSources, 'target')) return true;
        if (String(s.implantDates?.[k] || '').trim()) return true;
        const t = s.targets?.[k];
        if (!t) return false;
        if (t.fetusPlan) return true;
        if (String(t.vars?.Is_Pregnant || '').toLowerCase() === 'true') return true;
        const has = (v) => {
            const x = String(v ?? '').trim();
            return !!x && !/^(无|—|-|未加载|不适用)$/.test(x);
        };
        if (has(t.profile?.d9)) return true;         // 敏感带
        if (has(t.profile?.d7)) return true;         // 泌乳
        if (has(t.profile?.d8)) return true;         // 生产次数
        if (Array.isArray(t.traces) && t.traces.length) return true;   // 身体痕迹
    } catch { /* 忽略 */ }
    return false;
}

/** 全部"轻档"对象（设置里那行「见过的其他人」用它 ✓） */
export function lightTargetList() {
    try { return targetList().filter((t) => t.light === true); } catch { return []; }
}

// ---------------------------------------------------------------------------
// ★★ 「新面孔」——
//   推演顺手报一次"剧情里出现过、又不在追踪名单里的人"的**基础资料**
//   （名字 ＋ 种族 ＋ 种族的依据）⇒ 插件把他登记成**轻档**：
//     · 只存基础信息，身体那一套一概不碰
//     · 不进推演名单、不吃名单那份 token、也不占追踪名额 ✓
//     · 以后身上真有了身体事实 ⇒ 走 `upsertTargetResult` 那套自动升格 ✓
//
// 为什么要它：联系人那一栏会认出"只做过 / 只出现过"的名字，而**没档案的名字
//   插件手里没有种族可读**（只能显示「种族未知」）—— 种族这种由设定决定的东西
//   只有引擎看得见（世界书 / 角色描述），所以让它报一次就够 ✓
//
// ⚠️ 这里**只收名字 ＋ 种族**：能力那四格（能不能怀孕 / 能不能致孕 / 异种…）不问 ——
//   轻档不参与推演 ⇒ 那几格记了也没人消费，等它真进名单时按"只问一次"
//   那套问才准 ✓（要不要记，结论是这个 ✓）
// ---------------------------------------------------------------------------

/** 一轮最多登记几个新面孔（模型报疯了也不至于灌进来一堆对象 ✓） */
export const NEW_FACE_CAP = 6;

/** 把"新面孔"报来的种族写进那个对象（**只在这个对象还没报过种族时**写一次 ✓） */
function writeNewFaceRace(t, race, src) {
    try {
        if (!t || !race) return false;
        if (String(t?.vars?.race ?? '').trim()) return false;     // 报过的不动：以先报的那次为准 ✓
        if (!t.vars || typeof t.vars !== 'object') t.vars = {};
        t.vars.race = race;
        if (/设定|推断|存疑/.test(src)) t.vars.race_source = src;
        commit();
        return true;
    } catch { return false; }
}

/**
 * 收「新面孔」：
 *   · 已经有档案（正式档 / 轻档都算）⇒ **只补种族**，别的什么都不动 ✓
 *   · 还没有 ⇒ 建一个**轻档**（跟"只登记了名字"同一档，不占名额 ✓）
 * @param {Array<{name?:string, race?:string, race_source?:string}>} list 契约顶层 `newFaces`
 * @returns {Array<{key:string,name:string}>} 这一轮**新建**的对象（给日志 / 界面用 ✓）
 */
export function applyNewFacesReport(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    let made = 0;
    const persona = (() => { try { return String(userDisplayName() || '').trim(); } catch { return ''; } })();
    for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const nm = stripNameDecor(String(it.name ?? '').trim());
        if (!nm || nm.length > 20) continue;
        if (nm === '{{user}}' || /^(user|你|我)$/i.test(nm)) continue;     // 本人不在这儿建 ✓
        if (persona && nm === persona) continue;
        const race = String(it.race ?? '').trim();
        const src = String(it.race_source ?? '').trim();
        let t = null;
        try { t = resolveExistingTargetByName(nm); } catch { t = null; }
        if (t) { if (race) writeNewFaceRace(t, race, src); continue; }
        if (made >= NEW_FACE_CAP) continue;
        const created = createTarget(nm);
        if (!created) continue;
        setTargetLight(created.key, true);          // 引擎报来的新面孔 ⇒ 轻档 ✓
        made += 1;
        if (race) writeNewFaceRace(created, race, src);
        out.push({ key: created.key, name: displayName(created) || nm });
    }
    return out;
}

/**
 * 「联系人」里那颗「改种族」用的：按名字找已有档案，没有就**轻档**建一个 ✓
 *
 * 为什么是轻档：这是"联系人里认出来的一个名字"，跟「新面孔」同一档
 *   （面板上「添加联系人」那颗仍然是正式档，两条路别混 ✗）
 * 以后真有身体事实会自动升格 ✓
 */
export function findOrCreateLightTarget(name) {
    const nm = stripNameDecor(String(name || '').trim());
    if (!nm) return null;
    let t = null;
    try { t = resolveExistingTargetByName(nm); } catch { t = null; }
    if (t) return t;
    t = createTarget(nm);
    if (t) setTargetLight(t.key, true);
    return t;
}

export function upsertTargetResult(res, opts = {}) {
    const s = state();
    const rawName = String(res?.name || '').trim();
    if (!rawName) return null;

    // 把推演结果里的名字对回已有对象（容错：真人设名 / {{user}} / 角色名 / **别名表**）
    // ★★ 匹配顺序：**先认角色，最后才落本人** ——
    //    以前「rawName 正好等于人设名 ⇒ 判给本人」这条排在**最前面** ⇒
    //    追踪了一个和人设同名的角色时，那个角色的数据会被**全抢到本人名下** ✗
    //    （别名表也救不了，因为根本轮不到它 ✓）
    let key = null;
    // ★ 这一次是不是"自动建档"出来的新名字（**轻档只对它生效** ✓ 见下面那段）
    let autoNew = false;
    const persona = userDisplayName();
    const cleanName = stripNameDecor(rawName);
    const isUserish = (v) => v === '{{user}}' || /^(user|你|我)$/i.test(String(v ?? '').trim());
    // ★ 名单里本人那一行自带「用户本人 / 主控角色」这个说明 ⇒ 引擎照抄整行时，
    //   它**明确指向本人**（哪怕场上正好有个同名角色 ✓）
    const looksLikeUserLine = /用户本人|主控角色/.test(rawName);
    if (isUserish(rawName) || isUserish(cleanName) || looksLikeUserLine) {
        key = USER_KEY;
    } else {
        // ① 原样 ② 剥掉尾部括号说明（引擎把名单里的说明抄回来了）—— 两轮都**跳过本人那一份**
        const tries = (cleanName && cleanName !== rawName) ? [rawName, cleanName] : [rawName];
        for (const nm of tries) {
            const hit = findTargetByReportedName(nm, { skipUser: true });
            if (hit) { key = hit.key; break; }
            for (const k of s.order) {
                const t = s.targets[k];
                if (!t || t.isUser) continue;
                if (k === nm || t.name === nm || displayName(t) === nm) { key = k; break; }
            }
            if (key) break;
        }
        // ③ 兜底：没有任何同名角色 ⇒ 报真名就是本人（老行为保留 ✓，不然玩家那份会丢）
        if (!key && (rawName === persona || cleanName === persona)) key = USER_KEY;
        // ⚠️⚠️ 这个开关的名字是「**自动模式**发现新的女性角色时自动建档」——
        //   所以它**只能**在 targetMode === 'auto' 时生效 ✗
        //   （默认「仅追踪 {{user}}」+ 这个开关默认是开的
        //     ⇒ 推演只要报出一个新角色名，插件就给他建档 ⇒ 面板切换条里冒出一堆
        //      本来不想跟踪的角色 ✗。开关写着"自动模式"，实现却没管模式 ✓）
        //   ⇒ 显式要求模式是 auto：别的模式该追谁由 targetNames 说了算。
        //   ★ 建档用**剥过装饰**的那个名字（治「示例角色（用户本人 / 主控角色）」这种幽灵对象 ✓）
        if (!key && settings().targetMode === 'auto' && settings().judge.autoCreateTargets) {
            key = cleanName || rawName;
            autoNew = true;
        }
        if (!key) return null;
    }

    const t = createTarget(key === USER_KEY ? '{{user}}' : key, { key });
    if (!t) return null;
    // ★★ 轻档 / 升格：
    //   · 这一轮**有身体事实**（或者插件这边早就有账）⇒ 正式档（本来就是轻档的在这里升格 ✓）
    //   · 都没有、而且是**这次自动建档**出来的新名字 ⇒ 只登记名字：
    //     不进推演名单、不吃 token、**也不占人数上限** ✓
    //   ⚠️ 手加 / 手选的对象不走这条（它们本来就是正式档 ✓）；升格之后不自动降回 ✓
    try {
        if (reportedBodyFactOf(res) || hasBodyLedger(key)) {
            if (isTargetLight(key)) setTargetLight(key, false);
        } else if (autoNew) {
            setTargetLight(key, true);
        }
    } catch { /* 忽略 */ }

    // ★★ 引擎报回来的**标签** ⇒ 并进这个对象（它是"只有剧情知道的事实"：
    //   这个人属于哪一篇 / 是哪一版 ✓）
    //   ⚠️ 玩家手打过标签的（`tagsManual`）⇒ 一个字都不动，以玩家为准 ✓
    if (key && key !== USER_KEY) {
        try { applyReportedTags(key, res?.tags); } catch { /* 忽略 */ }
    }

    // 「血脉遗传特质」只发一次 —— 这里管那个标记。
    //   规则：**第一次判定出怀孕的那一轮不标**（那时模块还没发出去），
    //        下一轮孕着、模块发过了，才标成 done；没孕就复位（下一胎还要判）。
    // ★ `Is_Pregnant` 是**插件的账**（见 syncPregnancyState）——
    //   契约已经不问这一格 ⇒ 落报告时先把插件那份抄下来，替换掉 res.vars 之后再放回去，
    //   免得模型偶尔照抄旧值 / 报个相反的把它盖掉 ✗（AI 只读不写 ✓）
    const wasPregnant = String(t.vars?.Is_Pregnant ?? '').toLowerCase() === 'true';

    // ★ 契约只在"还没定过"时问那三格能力 ＋ 种族本身也是可空的 ⇒
    //   **问过之后就不会每轮回传**，而下一行是**整份替换** ⇒ 不抄回来就会被抹掉、
    //   下一轮又问一遍（问答隔一轮抖一次 ✗），被抹掉的那一轮异种门控还会退回"当人类" ✗
    //   ⇒ 跟 `Is_Pregnant` 同一个写法：先抄下来、替换完再放回去 ✓（这一轮回传了就以它为准 ✓）
    const keepVars = {};
    for (const vk of ['race', 'race_source', 'is_xeno', 'can_be_pregnant', 'can_impregnate', 'can_bear_xeno', 'impregnator_side']) {
        const v = t.vars?.[vk];
        if (String(v ?? '').trim() !== '') keepVars[vk] = v;    }
    t.vars = res.vars && typeof res.vars === 'object' ? res.vars : (t.vars || {});
    if (!t.vars || typeof t.vars !== 'object') t.vars = {};
    for (const [vk, v] of Object.entries(keepVars)) {
        if (String(t.vars[vk] ?? '').trim() === '') t.vars[vk] = v;
    }
    t.vars.Is_Pregnant = wasPregnant ? 'true' : 'false';
    // ★ 顺手同步一次：这一轮报回来的周期日可能已经过了着床完成日 ⇒ 这一轮就切 true ✓
    const willPregnant = syncPregnancyState(key);
    // ★ 2026-10-23：heritageDone 的标记挪到**手改修正收尾之后**（看最终生效的 d6），
    //   见本函数下方「血脉遗传特质：没写就不算发过」那一段 ✓
    // ★★ 手改修正：先把「玩家填的值 ＋ 基线」抄下来，并从这儿开始记「这一轮插件那份账是多少」✓
    //   ⚠️ 必须放在下面那句 d8 写入**之前**（那句也在整份替换之前 ⇒ 抄晚了就抄不到玩家的值 ✗）
    const keepFix = (() => {
        const out = {};
        try {
            const all = profileFixOf(key);
            for (const lk of profileFixKeysOf(key)) {
                out[lk] = { mine: String(all[lk]?.mine ?? ''), base: String(all[lk]?.base ?? '') };
            }
        } catch { /* 读不到就当没改过 */ }
        return out;
    })();
    const freshFix = {};   // 这一轮"插件那份账"分别是多少（手改修正靠它判过期 ✓）
    // ★ **生产次数（d8）也是插件的账** ——
    //   孩子账本里记着每一次分娩（`batch` ＝ 谁生的＋哪一天）⇒ 插件数得出来，
    //   不该再让 AI 报（它只能靠自己的旧描述数，多胎 / 分次分娩都容易错 ✗）
    //   ⚠️ 报告里那格照样收下（状态摘要用它渲染）—— 但**值由插件覆盖** ✓
    //   ⚠️ 死胎天然不计入：死胎不落账本（只有「已分娩」那一轮才写孩子 ✓）
    try {
        // ⚠️⚠️ 这句**只能算值、不能在这里写 `t.profile.d8`** ——
        //   下面紧接着就是 `t.profile = res.profile` 那句**整份替换**，
        //   在这儿写会被替换抹掉（实测：报告里没带 d8 时 d8 直接变 undefined ✗
        //   —— 这是 2026-10-14 做手改修正时才暴露出来的老 bug ✓）
        //   ⇒ 真正的写入挪到整份替换**之后**（跟 d2/d4/d5 同一个位置 ✓）
        freshFix.d8 = birthCountOf(key) + ' 次';
    } catch (e) { console.warn('[Bodycord] 同步生产次数失败', e); }
    // ★★ **排卵日 / 周期长度以身体补丁正文为准** ——
    //   参数面板改的就是补丁里那两行（`params.js` 的锚点），而日号 / 阶段 / 阶段插图 /
    //   受精窗口一直读的是**它每轮报的**那两个数 ⇒ 玩家把排卵日 14 改成 16 之后，
    //   面板上的日号与阶段可能还按 14 走，而受精窗口已经按 16 算了 ✗（两处事实源）
    //   ⇒ 收下报告后**用补丁里的值覆盖**，而且要在下面 `deriveCycleFields` **之前**
    //     （那样下游一次全对齐，不用每个消费方各改一遍 ✓）；
    //     整份 vars 每轮会喂回给它 ⇒ 它照样知道该按哪天算 ✓
    try {
        const cp = bodyCycleParamsOf(key);
        if (cp && t.vars && typeof t.vars === 'object') {
            t.vars.Ovulation_Day = 'Day' + cp.ovu;
            t.vars.Cycle_Length = String(cp.cycle);
        }
    } catch { /* 读不到补丁就照旧用它报的 */ }
    // ★★ 先把玩家手填的三个值抄下来 ——
    //   下一行 `t.profile = res.profile` 是**整份替换**，而这几个字段**契约里没有**
    //   （phase / sub / d1 是插件自己算的）⇒ 模型不会回传它们，
    //   手动档（manualCycle）下每轮推演都会把玩家填的值抹掉 ✗
    // ★ d9 由**插件**维护，契约不再问它 ⇒ 下面那句"整份替换"会把它抹掉
    //   （跟 d8 一样）⇒ 先抄下来，替换完再写回、并叠上本轮刺激 ✓
    const prevD9 = (t.profile && typeof t.profile.d9 === 'string') ? t.profile.d9 : '';
    // ★ A3：`d5` 也要先抄下来 —— 下一行 `t.profile = res.profile` 是整份替换，
    //   模型这轮要是没报 d5（字段关了 / 忘了写），后半个「致孕方知情」就没了 ✗
    const prevD5 = (t.profile && typeof t.profile.d5 === 'string') ? t.profile.d5 : '';
    // ★★ 近期性行为（row3）从 2026-10-17 起**归插件记账**：
    //   AI 每轮只报最近这一条（没有就「无」），插件收进清单、再把最近 N 条渲染回 row3。
    //   ⇒ 这两份都得在"整份替换"之前抄下来：老的用来搬家、新的用来落账 ✓
    const prevRow3 = (t.profile && typeof t.profile.row3 === 'string') ? t.profile.row3 : '';
    const reportedRow3 = (res && res.profile && typeof res.profile.row3 === 'string') ? res.profile.row3 : '';

    // ★ 2026-10-24（她：胎儿那套不必每轮写）：契约现在允许本轮 d6 留空
    //   ⇒ 整份替换之前先抄下来，模型没写就还原，别把上一轮那份抹掉 ✗
    const prevD6 = (t.profile && typeof t.profile.d6 === 'string') ? t.profile.d6 : '';
    // ⚠️ 手改锁那份 `keepLocked` 在上面（d8 那句**之前**）就抄好了 —— 这里不许再抄一遍 ✗
    t.profile = res.profile && typeof res.profile === 'object' ? res.profile : t.profile;
    // ★★ 2026-10-24（她：它把我数据搞坏了）——
    //   d6 不回喂 ⇒ 模型手里没有旧那份，它随便抄一段进来就会把已经写好的
    //   显性 / 隐性携带 / 天赋整片盖掉。实测那一格的概述就是提示词里
    //   「胎儿状态：」那行的原样（三胎（异卵）：子1 男（致孕方：…） · 子2 女 …）
    //   ＋一句发育描述 ⇒ 它抄的是摘要，不是重判。
    //   以前只在"回包是空"时才还原旧值 ⇒ 抄了非空的一段就整份替换 ✗
    //   ⇒ 多一道闸：**旧那份有真遗传内容、新这份没有（且不是明确的「无」）⇒ 保留旧的**。
    //     · 遗传轮 / 当场重判：新回包本来就带那三格 ⇒ 照常覆盖 ✓
    //     · 分娩 / 终止：模型写「无」⇒ 那是明确清空，照常生效 ✓
    //     · 手改冻结走 `keepLocked` 那条路，跟这道闸不冲突 ✓
    try {
        if (t.profile && typeof t.profile === 'object') {
            const nowD6 = String(t.profile.d6 ?? '').trim();
            const cleared = !nowD6 || /^无/.test(nowD6) || nowD6 === '未加载';
            // ★★ 2026-10-24（复查补的洞）：「无」也不许乱清 ——
            //   分娩 / 妊娠终止那一轮写「无」才是该清的（事件或"这一轮已经不是孕"说得清）；
            //   孕期中间它顺手写个「无」⇒ 一样把整格抹掉 ✗ ⇒ 这种情况照样保留旧的 ✓
            const ev = String(res?.Cycle_Event || '').trim();
            const endEvent = /分娩|终止/.test(ev);
            const canClear = !willPregnant || endEvent
                || !prevD6 || /^无/.test(prevD6) || prevD6 === '未加载';
            if (!nowD6) t.profile.d6 = prevD6;
            else if (cleared) {
                if (canClear) { /* 分娩 / 终止 / 本来就没内容：照它清 ✓ */ }
                else if (hasRealHeritage(prevD6)) {
                    console.log('[Bodycord] 回包里把 d6 写成「无」但这一轮没分娩/终止：不采信（旧的原样留着）');
                    t.profile.d6 = prevD6;
                }
            } else if (hasRealHeritage(prevD6) && !hasRealHeritage(nowD6)) {
                console.log('[Bodycord] 回包里的 d6 没有遗传三格、存档里有：这一段不采信（旧的原样留着）');
                t.profile.d6 = prevD6;
            }
        }
    } catch { /* 忽略 */ }
    // ★ 2026-10-24 回退：模型重写的孩子数据照旧收（这条保护先撤掉，她说把胎儿/孩子页的功能吃掉了）
    // ★★ 2026-10-23（她报：刚着床内视图就有胚胎）——
    //   切孕那一轮（`fetusPlanPending`）**胎数 / 性别还没掷** ⇒ 模型报回来的 d6 一律不采信，
    //   按回「无」（它这一轮会自己编「单胎（女），继承…，孕3周…」✗）。
    //   下一轮插件掷完胎数，`applyFetusPlanOf` 会把 d6 写成插件格式 ✓
    try {
        if (t.fetusPlanPending === true) {
            if (!t.profile || typeof t.profile !== 'object') t.profile = {};
            if (String(t.profile.d6 || '').trim() !== '无') {
                t.profile.d6 = '无';
                console.log('[Bodycord] 刚着床、胎数还没掷：' + (displayName(t) || key) + ' 的 d6 按回「无」（不采信模型自己写的孩子数据）');
            }
        }
    } catch { /* 忽略 */ }
    // ★★ 2026-10-24（构建 -108）：概述里的「生长情况」由**模型**写 ——
    //   它只在"孕周跨档那一轮"填 `fetus_note` 一句；这里把那句并进概述，
    //   换掉旧的那句（表里所有句子都识别），**子项一个字都不动** ✓
    try {
        const rawNote = String(t.profile?.fetus_note ?? '').trim();
        // ★ 2026-10-29：模型照表里的原句抄，常把表头「孕 11-14 周」也带进来 ⇒ 收进来先剥掉
        //   （生成侧就该干净，别让它在概述里躺着跟上面那行孕周打架 ✓）
        const note0 = stripWeekBand(rawNote);
        // 去掉首尾的标点 / 分隔符，别把句号带进概述的分隔链里 ✓
        const note = note0.replace(/^[\s，,、。；;·]+/, '').replace(/[\s，,、。；;·]+$/, '').trim();
        if (note) {
            const olds = fetusDevAllLines(key).map((x) => x.desc).filter(Boolean);
            const f0 = parseFetus(t.profile?.d6 || '');
            let h = String(f0.head || '');
            for (const line of olds) h = h.split(line).join('');
            // ★ 2026-10-24（概述里出现「三胎（异卵） · 。 · 心跳…」）——
            //   旧句末尾带句号时，删掉旧句会剩下一段「· 。」；这里先清掉空的分隔段，
            //   再接到新句上，别把句号留在两个「·」之间 ✓
            h = h.replace(/\s*·\s*[。；;]+\s*(?=·|$)/g, ' · ')
                .replace(/(?:\s*·\s*){2,}/g, ' · ')
                .replace(/[\s，,、。；;·]+$/g, '')
                .trim();
            if (!t.profile || typeof t.profile !== 'object') t.profile = {};
            t.profile.d6 = buildFetus(h ? (h + ' · ' + note) : note, f0.kids);
        }
        if (t.profile && typeof t.profile === 'object') delete t.profile.fetus_note;
    } catch { /* 合并失败不影响主流程 */ }
    // ★★ 近期性行为落账（API 只写一条、记录归插件、报：无不顶掉）
    try {
        const hadEv = Array.isArray(res?.sex_events) && res.sex_events.length > 0;
        applyReportedSex(key, prevRow3, reportedRow3, Number.isFinite(Number(opts.floor)) ? Number(opts.floor) : null, hadEv);
    } catch (e) { console.warn('[Bodycord] 近期性行为落账失败', e); }

    // ★★ 植入（2026-10-14）：引擎报「本轮发生了外部植入（触手 / 寄生体塞卵）」⇒
    //   ① **直接切孕** —— 植入没有受精判定，而 `syncPregnancyState` 只认"受精通过 ＋ 着床日到点"
    //      ⇒ 以前这条路永远切不到孕（正文那句"受精判定跳过"本来就是对插件说的，没人接）✗
    //   ② 记下**植入起点** ⇒ 孕周从那天算
    //   ⚠️ 幂等：同一次植入只记第一次那天（后面几轮不改 ✓）
    try {
        const imp = String(res?.implanted ?? '').trim().toLowerCase();
        if (imp === 'true' || imp === '1' || imp === 'yes' || imp === '是') {
            if (!t.vars || typeof t.vars !== 'object') t.vars = {};
            const today = String(res?.vars?.Story_Date || '').trim() || currentDate() || '';
            if (!implantDateOf(t.key) && today) setImplantDateOf(t.key, today);
            t.vars.Is_Pregnant = 'true';
            // ★ 2026-10-30：一进孕期，子宫那本账就归零（见 pregnantNowTarget 那段）。
            //   不写这一步的话，孕前存下的「多 / 满」会一直躺在存档里，
            //   等分娩、孕期结束那一刻又冒出来 ✗
            t.wombLoad = 'empty';
        }
    } catch (e) { console.warn('[Bodycord] 记植入失败', e); }

    // ★ phase（阶段名）/ sub（进度）/ d1（阶段基础率）由插件推导，不信 AI 写的。
    //   这三样是"完全可以交给插件托管、却还在让 AI 管"的典型：
    //   规则完全确定（DayX + 排卵日 + 周期长 → 阶段名/进度/基础率），AI 只是查表。
    //   让 AI 写反而会出现「phase 说黄体期、d1 却填了卵泡期的 15%」这类自相矛盾，
    //   而且三个字段各算各的，谁也发现不了。在这里覆盖一次，下游就全都一致了。
    // 这三项**只由插件推导**（手填不该把它锁死，
    //   不然过几天还停在手填那天 ✗）——
    //   要改"第几天"请走「周期进度」（它改的是锚点，之后照旧自动往前走 ✓）；
    //   要改基础率请走参数面板。老存档留下的 `manualCycle` 顺手清掉（自愈 ✓）。
    try {
        if (t.manualCycle === true) delete t.manualCycle;
        {
            // ★ 经期天数也跟着「生理期参数」面板走（以前 derive 里写死 5 ✗）
            //   ★ 第 5 个参数＝植入孕的孕周基准（不是植入孕 ⇒ null ⇒ 照旧用周期日 ✓）
            const dv = deriveCycleFields(t.vars || {}, periodModeOf(t.key), periodDaysOf(t.key), cycleDayNum(t.key), pregDaysOf(t.key));
            if (dv) {
                if (!t.profile) t.profile = {};
                t.profile.phase = dv.phase;
                t.profile.sub = dv.sub;
                t.profile.d1 = dv.d1;
                // ★ **phaseId 也要落盘** ——
                //   `deriveCycleFields()` 一直算得出来，但这里只抄了三个 ⇒
                //   `stages.js` 的 `eggPresent()` 读 `profile.phaseId` 永远是空 ⇒
                //   「排卵日」「精子游向卵子」两格在**真数据里永不出现**（预览能看到，是因为预览走写死的顺序）✗
                //   它是"稳定身份"（不随周期模式换名字），阶段插图与经期门控都按它判 ✓
                t.profile.phaseId = dv.phaseId || '';
            }
        }
    } catch (e) { console.warn('[Bodycord] 推导阶段字段失败', e); }
    // ★ 敏感带（d9）归插件 ——
    //   ① 先把上一轮那份救回来（契约不问它了，不救就被整份替换抹掉 ✗）
    //   ② 再把这一轮报的「刺激部位 + 程度」累加进去、按阈值表换算等级、拼回文本 ✓
    //   AI 只报事实（哪个部位被碰了、多重）；累加 / 换算 / 保留 / 白名单全归插件 ✓
    try {
        if (!t.profile || typeof t.profile !== 'object') t.profile = {};
        const d9Before = prevD9 || (typeof t.profile.d9 === 'string' ? t.profile.d9 : '');
        const stim = Array.isArray(res?.zones?.stim) ? res.zones.stim : [];
        t.profile.d9 = applyZoneStim(d9Before, stim);
    } catch (e) { console.warn('[Bodycord] 累加敏感带失败', e); }
    t.period = res.period && typeof res.period === 'object' ? res.period : null;
    // ★ `period.day`（周期第几天）归插件 ——
    //   它手上有周期日（`cycleDayNum(key)`，跟阶段 / 判定 / 喂回都是同一个数 ✓）⇒
    //   契约不再问这一格，这里用插件算出来的值覆盖（AI 报什么都盖掉）；
    //   ⚠️ 读不到周期日（还没建档 / 没日期）⇒ 保留原值，绝不清空 ✓
    if (t.period) {
        const cdNow = cycleDayNum(key);
        if (cdNow !== null) t.period.day = `Day${cdNow}`;
    }
    // ★ `d3`（体质系数）归插件 —— 真相源就是身体补丁里那行「日常体质系数」✓
    //   （模块正文自己写着"以 [身体补丁] 里那一行为准" ⇒ 插件读同一行，不会再和它对不上 ✓）
    //   契约不再问这一格 ⇒ 这里用读到的值覆盖（AI 报什么都盖掉）；**读不到 ⇒ 保留原值** ✓
    if (t.profile && typeof t.profile === 'object') {
        const coef = bodyCoefOf(key);
        if (coef) { freshFix.d3 = coef; t.profile.d3 = coef; }
    }
    // ★ `d2`（累计受孕率）也归插件 —— 数值与标注都照模块那张表自己算 ✓
    if (t.profile && typeof t.profile === 'object') {
        const d2txt = fertilityRateTextOf(key);
        if (d2txt) { freshFix.d2 = d2txt; t.profile.d2 = d2txt; }
    }
    // ★★ 计算说明里「阶段名 / 阶段基础率」也归插件 ——
    //   这一轮没有新增风险行为 ⇒ **整句由插件写**（阶段换了就跟着换，不再照抄上一轮 ✗）；
    //   有事件 ⇒ 只把开头那句的阶段名 / 基础率校正一下（判定值、历史回顾一个字不动 ✓）
    if (t.profile && typeof t.profile === 'object') {
        try {
            const quiet = quietCalcTextOf(key, res);
            if (quiet) t.profile.calc = quiet;
            else {
                const fixed = fixCalcLeadPhase(key);
                if (fixed) t.profile.calc = fixed;
            }
        } catch (e) { console.warn('[Bodycord] 校正计算说明失败', e); }
    }
    // ★★ 来源 / 分批（2026-10-14）：引擎报的那句自由文本 ⇒ 宽松解析后存一份 ✓
    //   ⚠️ **必须在 d4 那一步之前**：d4 要拿它显示（放后面就会晚一轮 ✗）
    //   ⚠️ 只认解析得出来的；认不出就一个字都不动（绝不用空值清掉 ✓）
    //   ⚠️ 玩家手填的那份**优先** ⇒ 引擎报的不覆盖它（要交回插件就点「↩」✓）
    try {
        const rawSrc = String(res?.impregnator_source ?? '').trim();
        const curSrc = impregnatorSourceOf(key);
        if (rawSrc && !(curSrc && curSrc.manual === true)) {
            const parsed = parseImpregnatorSource(rawSrc);
            if (parsed) setImpregnatorSourceOf({ ...parsed, manual: false, at: Date.now() }, key);
        }
    } catch (e) { console.warn('[Bodycord] 记来源 / 分批失败', e); }
    // ★ `d4`（致孕方）也归插件 —— 值就是插件自己掷定的那份逐胎锁定，
    //   以前让 AI 照抄一遍（抄错就错，而它没有别的用途）⇒ 契约里不再问这一格 ✓
    //   读不出结论（比如还没判过）⇒ 一个字不动，绝不清空 ✓
    if (t.profile && typeof t.profile === 'object') {
        const d4txt = impregnatorTextOf(key);
        if (d4txt) { freshFix.d4 = d4txt; t.profile.d4 = d4txt; }
    }
    // ★ A3：`d5` 的前半截（意识状态）也归插件 ——
    //   模型只报后半截（致孕方知情情况），插件的状态值拼在它前面 ✓
    //   模块没开 / 状态算不出来 ⇒ 空串 ⇒ 一个字不动（保留原值，绝不清空 ✓）
    if (t.profile && typeof t.profile === 'object') {
        const d5txt = awarenessTextOf(key, res?.profile?.d5 || prevD5);
        if (d5txt) { freshFix.d5 = d5txt; t.profile.d5 = d5txt; }
    }
    // ★ `d8`（生产次数）归插件 —— 按孩子账本的 `batch` 数，**放在整份替换之后写** ✓
    //   （详见上面那句的注释：写在替换之前等于白写 ✗）
    try {
        if (freshFix.d8 && t.profile && typeof t.profile === 'object') t.profile.d8 = freshFix.d8;
    } catch (e) { console.warn('[Bodycord] 写生产次数失败', e); }
    // ★★ 手改修正收尾：玩家手改过的那几格，按：**账变了没**决定留谁的 ✓
    //   · 插件这一轮的账 ＝ 基线⇒ 账没变 ⇒ 保留玩家填的值 ✓
    //   · 账变了 ⇒ 玩家那次数过期了 ⇒ **插件接管** ＋ 留一条提醒（这是
    //     当场纠正的那条："之后再生，生产次数照样得涨" ✓）
    //   · `d6` 不在这儿判（它靠"换了一胎 / 分娩"清 —— 见 `syncPregnancyState` ✓）
    try {
        const tookBack = [];
        for (const fk of profileFixKeysOf(key)) {
            const fix = keepFix[fk] || { mine: '', base: '' };
            const fresh = (fk === 'd6') ? fix.base : String(freshFix[fk] ?? '');
            if (fresh && fresh !== fix.base) {
                clearProfileFix(key, fk, { silent: true });
                tookBack.push({ field: fk, fresh });
                continue;
            }
            if (t.profile && typeof t.profile === 'object') t.profile[fk] = fix.mine;
        }
        if (tookBack.length) {
            const who = displayName(t) || key;
            const label = { d2: '累计受孕率', d3: '体质系数', d4: '致孕方', d5: '意识状态', d8: '生产次数' }[tookBack[0].field] || tookBack[0].field;
            upsertAlert({
                kind: 'profileFix', target: key, sub: String(tookBack[0].field), name: who,
                date: (() => { try { return currentDate() || ''; } catch { return ''; } })(),
                seen: false,
                note: `${who} 的「${label}」因为账变了（${tookBack[0].fresh}），已经换回插件算的值；想再手改就再去改数值里改`,
            });
        }
    } catch (e) { console.warn('[Bodycord] 手改修正收尾失败', e); }
    // ★★ 2026-10-23（她报：血脉遗传特质没有 ROLL）——
    //   它不是掷的，是模型按遗传规则写进 d6 的；但**模型这一轮没写**时，
    //   原来插件照样把它标成"发过了"（heritage_once）⇒ 以后再也不发 ✗
    //   ⇒ 改成：看**最终生效的 d6** 里有没有「显性 / 隐性」；
    //     没写就再发一轮（最多 3 次，别无限烧 token）✓
    // ★★ 2026-10-24（构建 -97）：判「这一胎判过遗传没有」改成**只看这一轮发没发卡** ——
    //   以前每轮都拿 d6 里的字去反推，而 d6 会被覆盖 / 会被模型少写 ⇒ 判过的那一胎
    //   被重新当成"没判过"，卡每轮都发、它每轮都知道要编天赋 ✗
    //   ⇒ 现在：只有**这一轮真的把卡发出去**（`opts.heritageAsked`）才动状态：
    //     · 回包里写回三格 ⇒ 判过；
    //     · 没写 ⇒ 次数 +1（到上限先照旧停，构建 -98 再改成"停自动、入口留着"）；
    //     · 没发卡的轮次 ⇒ 状态一个字都不动（不再拿 d6 反推）
    let askedNow = false;
    try {
        askedNow = (opts && opts.heritageAsked instanceof Set)
            ? opts.heritageAsked.has(String(key || '')) : false;
        if (!willPregnant) {
            t.heritageDone = false;
            t.heritageTry = 0;
            delete t.heritageGiveUp;
        } else if (wasPregnant && askedNow) {
            if (hasRealHeritage(t.profile?.d6)) {
                t.heritageDone = true;
                t.heritageTry = 0;
                delete t.heritageGiveUp;
            } else {
                const n = (Number(t.heritageTry) || 0) + 1;
                t.heritageTry = n;
                // ★★ 2026-10-24（构建 -98）：到上限**不再静默放弃**（以前这里写 heritageDone = n>=3，
                //   等于"当作判过了"，玩家只会看到卡忽然不再发、也不知道为什么 ✗）
                //   ⇒ 现在是"自动停、手动留"：heritageGiveUp 只关掉自动重发（不烧 token），
                //     状态在诊断里亮着，玩家要判就点胎儿页那颗「按现在的结果重写」✓
                if (n >= 3) t.heritageGiveUp = true;
            }
        }
    } catch { /* 不算也不影响主流程 */ }
    // ★★ 2026-10-24（构建 -99）：漏写要**在场面出声**（以前只有诊断里能看见）——
    //   同一件事只留一条：第一次没写 ⇒ 一条"下一轮会再试"；到上限 ⇒ 换成"自动重试停了"；写成了 ⇒ 撤掉 ✓
    //   ⚠️ 第 2 次失败不重复建（她点掉过就别再烦她）✓
    try {
        const dropHeritageAlerts = () => {
            const s2 = state();
            if (!Array.isArray(s2.alerts)) return;
            const before = s2.alerts.length;
            s2.alerts = s2.alerts.filter((x) => !(String(x?.kind || '') === 'heritage'
                && String(x?.target || '') === String(key)));
            if (s2.alerts.length !== before) commit();
        };
        const today = (() => { try { return currentDate() || ''; } catch { return ''; } })();
        const who = displayName(t) || key;
        if (!willPregnant || hasRealHeritage(t.profile?.d6)) {
            dropHeritageAlerts();
        } else if (askedNow) {
            if (t.heritageGiveUp === true) {
                dropHeritageAlerts();
                upsertAlert({
                    kind: 'heritage', target: String(key), sub: 'giveup', name: who, date: today, seen: false,
                    note: `${who} 的遗传三格自动重试停了（发了 ${Number(t.heritageTry) || 3} 次都没写进来）。去「胎儿 / 孩子」页点「按现在的结果重写」就能补上`,
                });
            } else if ((Number(t.heritageTry) || 0) === 1) {
                upsertAlert({
                    kind: 'heritage', target: String(key), sub: 'retry', name: who, date: today, seen: false,
                    note: `${who} 的遗传三格（显性 / 隐性携带 / 天赋）这一轮没写进孩子那一格，下一轮会再试`,
                });
            }
        }
    } catch (e) { console.warn('[Bodycord] 遗传提醒失败', e); }
    // ★ 「强制判对」提醒（气泡）—— 推演完发现种族还是存疑、或者跟大类对不上 ⇒ 提一次 ✓
    //   同一个对象只记一条：点掉就不再提；改了那格（来源变"玩家"）也就不再触发 ✓
    try {
        const rj = raceJudgeOf(key);
        const cls = String(xenoClassOf(key) || '');
        const byClass = cls ? (cls !== '人类') : null;
        const rep = reportedBodyFlagOf(key, 'isXeno');
        const clash = (byClass !== null && rep !== null && byClass !== rep);
        // ★ **没推演过也得能报** —— 种族名跟「属于哪个大类」本来就矛盾时
        //   （大类选人类、种族却写着"半精灵"这种）直接算可疑 ✓
        const raceSaysXeno = !!(rj.race && !/人/.test(rj.race));
        const clashRace = (byClass === false && raceSaysXeno);
        const bad = (rj.src === '存疑') || clash || clashRace;
        const already = listAlerts().some((a) => a && a.kind === 'race' && String(a.target || '') === String(key));
        if (bad && !already) {
            const who = displayName(t) || key;
            upsertAlert({
                kind: 'race', target: key, sub: '', name: who, date: (() => { try { return currentDate() || ''; } catch { return ''; } })(),
                seen: false, note: `${who} 的种族还没确认（会影响异种判定与孕期），确认一下那格`,
            });
        }
    } catch (e) { /* 提醒失败不影响推演 ✓ */ }
    t.raw = typeof res.raw === 'string' && res.raw.includes('<status_profile') ? res.raw : '';
    t.note = typeof res.note === 'string' ? res.note : '';
    if (typeof res.present === 'boolean') t.present = res.present;
    t.updatedAt = Date.now();
    commit();
    return t;
}

/** 按设置里的模式，保证该有的基础对象都存在 */
export function ensureBaseTargets() {
    const s = settings();
    const st = state();
    // ★ 有一个"要不要追踪本人"的开关 ✓
    //   ⚠️ 关掉只是**不追**（不建档 / 不进推演名单 / 面板不显示），
    //      **不会删**已经存在的本人档案 ✗（那是数据，删了就是丢东西 ✓）
    const trackUser = s.trackUser !== false;
    if (trackUser && !st.targets[USER_KEY]) createTarget('{{user}}', { key: USER_KEY });
    // ★ 2026-10-24：老聊天里玩家档位记在对象上 ⇒ 第一次读到搬到全局（只补空，不覆盖）✓
    if (trackUser && !String(settings().userAwarenessTier || '').trim()) {
        const legacy = String(st.targets[USER_KEY]?.awarenessTier || '').trim();
        if (legacy) { try { settings().userAwarenessTier = legacy; save(); } catch { /* 忽略 */ } }
    }
    if (s.targetMode === 'single' || s.targetMode === 'multi') {
        for (const n of (s.targetNames || [])) {
            const name = String(n).trim();
            if (name) createTarget(name);
        }
    }
    if (!state().active) state().active = state().order[0] || null;
    commit();
}

/** 本轮该交给推演的追踪对象名单 */
export function trackingRoster() {
    const s = settings();
    const all = targetList();
    // ★ 「不追踪本人」时，本人一律不进名单（任何模式都适用 ✓）
    //   （玩男性角色、不能怀孕、但想要泌乳体质和敏感带的人，
    //     也需要一个开关来决定要不要追踪 {{user}} 本人 ✓）
    const withUser = s.trackUser !== false;
    // ★ 2026-10-18：**轻档一律不进名单**（本人也一样）——
    //   本人也能退回轻档 ⇒ 退回之后本人只留名字/种族，不能继续参与推演 ✓
    const pool = (withUser ? all : all.filter(t => !t.isUser)).filter(t => t.light !== true);
    if (s.targetMode === 'user') return pool.filter(t => t.isUser);
    if (s.targetMode === 'single') return pool.filter(t => t.isUser || (s.targetNames || []).includes(t.name));
    if (s.targetMode === 'multi') return pool.filter(t => t.isUser || (s.targetNames || []).includes(t.name));
    // auto：全部已建档对象，但默认限制数量。
    //   ★ 名单是要能扩，但有人可能一搞就是上千个；
    //     那就加一个解除限制模式，但告诉用户后果自负 ✓
    //   ⇒ 勾了 noTargetLimit 就**不截断**（后果由用户承担：很吃 token、界面也会变重）
    // ★★ 轻档不进名单（2026-10-14）：只登记过名字、身上一点账都没有的 ⇒
    //   不进推演、不吃 token、**也不占人数上限** ✓（升格之后就回来了 ✓）
    const active = pool;
    if (s.judge.noTargetLimit === true) return active;
    return active.slice(0, Math.max(1, s.judge.maxTargets || 50));
}

// ---------------------------------------------------------------------------
// ★ 虚拟日期（剧情没给日期时用的那套日历）
//
// 三条口径：
//   · **在剧情里面没有给日期的情况下，给一个初始的虚拟时间** ✓
//   · **虚拟时间显示 1年01月01日 就行** ✓
//   · **"上次月经是哪天"肯定需要记录** ✓
// ⇒ 只管"剧情没给日期"的情况；剧情给了日期就照用剧情日期 ✓
// ---------------------------------------------------------------------------

/** 现在这套时间该怎么走：'story'（用剧情日期）| 'fiction'（用虚拟日历） */
export function dateMode() {
    return String(state().dateMode || '');
}

// ---------------------------------------------------------------------------
// ★★ 自定义历法（「自定义时间兼容」）
//
// 主要是那种**非标准时间**的历法，不只是替换了月份名字 ——
//   比如一个月有 90 天、一年四个月共 360 天；另外可以搞一个初始表，
//   让玩家自己设定一年几个月、一个月多少天 ✓
//
// 三层分工（别混）：
//   ① **历法设定**（一年几个月 / 每月几天）存在**全局设置** `settings().calendar` ✓
//   ② **每个聊天记一枚指纹** `state().calendarPrint` = 这份数据是**哪套历法**写下来的 ✓
//      （老聊天没有这个字段 ⇒ 按公历算，因为那时候只有公历 ✓）
//   ③ 两者不一致 ⇒ `syncCalendarForChat()` 把**这个聊天里已经记下的日期**
//      按「从纪元第一天起第几天」**天数守恒**地翻译过去 ✓
//
// ⚠️ 为什么非要"天数守恒"：红线是改数值时只碰被修改的那份数据、
//   其他数据别碰。不守恒的话，改一次历法，所有人的周期第几天会一起跳 ✗ ⇒
//   那就成了"改一个设置顺带重算了别的数据" ✓ 正好踩线。
//
// ⚠️ 为什么搬到 `currentDate()` 里（而不是 `state()`）：
//   `state()` 在 settings.js 自己的迁移里也会被调到 ⇒ 在那个地方反过来调 `settings()`
//   会绕进初始化过程（危险）；而 `currentDate()` 只在真正要读日期时被调 ✓
// ---------------------------------------------------------------------------

/** 现在生效的历法（界面 / 诊断读它 ✓） */
export function activeCalendarNow() {
    return activeCalendar();
}

/**
 * 把一个日期字符串从 `from` 历法翻译到 `to` 历法（天数守恒）。
 * 认不出来（玩家自己打错的日期）⇒ 返回空串，调用方**原样保留** ✓
 */
function _shiftDate(text, from, to) {
    const t = String(text ?? '').trim();
    if (!t) return '';
    return convertDate(t, from, to);
}

/**
 * 搬家清单（**白名单**，不遍历整个状态对象 ✗）。
 * 只收"插件自己写进去、而且会被算数或显示用到"的日期字段：
 *   · `fictionDate`              当前剧情日期（一切差值的基准）
 *   · `targets[].cycleDayAt`     这个对象的周期锚点（算"今天第几天"）
 *   · `targets[].lastSettleDate` 上次周期结算日（算"距上次结算几天"）
 *   · `children[].birthDate`     出生日期（算年龄）
 *   · `achievements[].date`      成就记的剧情日期（纯显示，但一起搬看着才一致）
 * ⚠️ 刻意**不碰**：随手记 / 占卜台历史（那是玩家自己写的字，里面就算有"1年1月1日"
 *   也不是我们的日期 ✗）、快照（只存真实时间戳）、insems 的 depositDay（那是周期日号，不是日期 ✓）
 */
const _DATE_KEYS = ['cycleDayAt', 'lastSettleDate', 'birthDate', 'date'];
// ★ 「经历了」那一档的"全套往回"要**留住**的那几格（2026-10-16）：
//   · `cycleDayAt`（周期锚点）留住 ⇒ 周期第几天 / 孕周跟着日期一起退回来 ✓
//   · `lastSettleDate`（上次结算日）留住 ⇒ 往回退**不生出新账** ✓
const _KEEP_ANCHOR_KEYS = new Set(['cycleDayAt', 'lastSettleDate']);

function _migrateChatDates(s, from, to) {
    let n = 0;
    const fix = (host, key) => {
        if (!host || typeof host !== 'object') return;
        const v = host[key];
        if (typeof v !== 'string' || !v.trim()) return;
        const next = _shiftDate(v, from, to);
        if (next && next !== v) { host[key] = next; n += 1; }
    };
    fix(s, 'fictionDate');
    for (const t of Object.values(s.targets || {})) {
        for (const k of _DATE_KEYS) fix(t, k);
    }
    for (const c of (Array.isArray(s.children) ? s.children : [])) fix(c, 'birthDate');
    for (const a of (Array.isArray(s.achievements) ? s.achievements : [])) fix(a, 'date');
    // ★ 日历上那几条日程也要跟着搬（不然换完历法红圈全跑了 ✗）
    for (const ev of (Array.isArray(s.calendarEvents) ? s.calendarEvents : [])) fix(ev, 'date');
    return n;
}

let _calSyncing = false;

/**
 * 懒搬家：插件历法 ≠ 这份数据写下来时那套 ⇒ 就地翻一次，并更新指纹。
 * 幂等（一致就直接返回 false ✓），能在任何地方安全调用。
 * @returns {boolean} 真搬了返回 true
 */
export function syncCalendarForChat() {
    if (_calSyncing) return false;
    let s;
    try { s = state(); } catch { return false; }
    const want = calendarPrint(activeCalendar());
    const have = String(s.calendarPrint || '') || calendarPrint(normalizeCalendar(null));
    if (want === have) return false;
    _calSyncing = true;
    try {
        const from = calendarFromPrint(have);
        const to = activeCalendar();
        const n = _migrateChatDates(s, from, to);
        s.calendarPrint = want;
        // ⚠️ 没进聊天时 `commit()` 也是安全的（st.js 的 saveChatMetadata 现在一个文件都不写，
        //   只记一个"有未落盘数据"的标记 ✓）⇒ 不用在这里特判 ✓
        commit();
        if (n) {
            console.log('[Bodycord] 历法变了，已按同一时间轴搬走 ' + n + ' 个日期（周期第几天、年龄都不会变）');
        }
        return true;
    } catch (e) {
        console.warn('[Bodycord] 历法搬家失败（数据保持原样）', e);
        return false;
    } finally {
        _calSyncing = false;
    }
}

/**
 * 换历法（界面那三个数字走这里 ✓）。
 * 一次做完三件事：写进全局设置 ＋ 立刻把当前聊天搬一次 ＋ 落盘 ✓
 * @returns {object} 规范化之后的历法
 */
export function setCalendar(raw) {
    // ⚠️ 传进来的对象**缺 timeUnit** 时，沿用当前这份历法的钟点档 ——
    //   别让 normalizeCalendar 把"没传"当成"设成不记钟点"（改一次日期写法 / 点一下公历
    //   就把钟点冲掉、面板上的时间列凭空消失）
    const src = (raw && typeof raw === 'object' && raw.timeUnit == null)
        ? { ...raw, timeUnit: (settings().calendar || {}).timeUnit ?? 'none' }
        : raw;
    const cal = normalizeCalendar(src);
    const st = settings();
    // ⚠️ 一定要**换一个新对象**（不要原地改 months 数组 / style）——
    //   别的地方缓存的可能是同一个引用 ✓
    // ★ 周那两个字段也得一起存下去 —— 漏了的话改一次写法 / 钟点就把它冲回默认 ✗
    st.calendar = {
        months: cal.months.slice(), leap: cal.leap, style: cal.style, timeUnit: cal.timeUnit,
        weekLen: cal.weekLen, weekStart: cal.weekStart,
    };
    save();
    syncCalendarForChat();
    return cal;
}

/**
 * 应用一条历法预设（界面点一下走这里 ✓）。
 * **历法 ＋ 写法一整套一起换**，并触发天数守恒搬家（时间轴一天不动 ✓）。
 * 内置那条「公历」= 出厂那套（结构 ＋ 写法全部回出厂 ✓）
 * @returns {object|null} 换成了哪套；那条不存在就 null
 */
export function applyCalendarPreset(id) {
    const want = String(id || '');
    if (!want || want === CAL_PRESET_BUILTIN) {
        return setCalendar({ months: null, leap: null, style: null });
    }
    const pre = getCalendarPreset(want);
    if (!pre || !pre.cal) return null;
    return setCalendar(pre.cal);
}

// ---------------------------------------------------------------------------
// ★★ 日历上的日程
//
// 重要节日就是在指定的时间添加备注、然后圈红圈 ✓
// 日程刚好可以塞进默认的下半部分（跨月的不塞），
//   圈红圈是为了醒目；交互也从"点击弹那张图"改成直接点这个日期、在日历下半部分编辑内容 ✓
//
// ⇒ 形状：**一天可以挂好几条**（原来是"一天一条备注" ✗）——
//   每条 = { id, date, allDay, start, end, note, at }
//   ⚠️ **排序 / 显示那行字 / 空壳子判定 / 改一格的校验**全在 `calendar-events.js` 里，
//     跟"现实日历"那份（存全局设置、按设备日期）**共用一份** ✓（两份迟早走样 ✗）
//   ⚠️ 按**聊天**存（跟 insems / achievements 一个待遇：这是这个故事的日程 ✓）
//   ⚠️ 换历法时要跟着"天数守恒"搬（见 `_DATE_KEYS` 那条白名单 ✓）
//   ⚠️ 老存档那份 `calendarMarks`（一天一条）由 `state()` 搬成"一条全天日程"、不留两份 ✓
// ---------------------------------------------------------------------------

/** 一天最多挂几条 / 整个聊天最多多少条（保险丝，别让它无限涨 ✓）
 *  ★ 一天的上限从 50 改成 **30** ——
 *    50 都嫌多，25 都不一定有人用得到，所以一天上限设 30 条。
 *    ⚠️ 整份的 1000 没动（那是防"无限涨"，跟一天的密度是两件事 ✓） */
export const MAX_CAL_EVENTS_PER_DAY = 30;
const MAX_CAL_EVENTS = 1000;

/**
 * 老存档搬家：`calendarMarks`（一天一条备注）⇒ `calendarEvents`（一天可以挂好几条）
 *
 * ⚠️ 要**两个入口都走一遍**：`state()` 在拿不到 chat_metadata 时会提前 return
 *   （走 `_mem` 兜底），所以 `calendarEvents()` 里也得调它一次 ✓
 * ⚠️ 这里**不 commit**（`state()` 是只读入口）—— 下一次正常落盘时它自然被写回去 ✓
 */
function _calMigrateLegacy(s) {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.calendarMarks) && s.calendarMarks.length) {
        if (!Array.isArray(s.calendarEvents)) s.calendarEvents = [];
        for (const mk of s.calendarMarks) {
            const d = String(mk?.date || '').trim();
            const note = String(mk?.note || '').trim();
            if (!d || !note) continue;
            const dup = s.calendarEvents.some((x) => x && String(x.date || '') === d
                && String(x.note || '') === note);
            if (dup) continue;
            s.calendarEvents.push({
                id: calEvId(), date: d, allDay: true, start: '', end: '',
                note, at: Number(mk?.at) || Date.now(),
            });
        }
    }
    if (s.calendarMarks !== undefined) delete s.calendarMarks;
    if (!Array.isArray(s.calendarEvents)) s.calendarEvents = [];
    if (!Array.isArray(s.calendarAlerted)) s.calendarAlerted = [];
}

/** 所有日程（按聊天存 ✓） */
export function calendarEvents() {
    const s = state();
    _calMigrateLegacy(s);          // 老键可能还在（见上面那段说明 ✓）
    return s.calendarEvents;
}

/** 某一天的日程（排好序的副本 ✓） */
export function calendarEventsOn(date) {
    return calEvOn(calendarEvents(), date);
}

// ---------------------------------------------------------------------------
// ★★ 自动提醒（怀孕 / 预产期）—— **独立于日历日程**，但走同一个提醒气泡
//
// 把怀孕 / 预产期这两样从日程的填写里独立出来，
//   不用日程的判定、但气泡可以套用；设置里给开关，默认开启 ✓
// ⇒ ① 自己一份数据（不进 `calendarEvents` ⇒ 不占日程额度、不跟日程规则搅在一起）；
//    ② 到没到日子**插件自己按剧情日期判**（不借日程那套判据 ✓）；
//    ③ 显示**复用那个提醒气泡**（`ui.js` 的 `bubbleAlerts()` 把这份并进去 ✓）；
//    ④ 设置里两颗开关（怀孕提示 / 预产期提示），默认开 ✓。
// ---------------------------------------------------------------------------

/** 自动提醒那一份（按聊天存 ✓） */
export function listAlerts() {
    const s = state();
    if (!Array.isArray(s.alerts)) s.alerts = [];
    return s.alerts;
}

/**
 * 记一条自动提醒（**幂等**：同一个 kind ＋ 对象 ＋ 子项只留一条；日期变了就更新那一条 ✓）。
 * @param {{kind:string, target:string, sub?:string, name?:string, date?:string, note?:string}} a
 */
export function upsertAlert(a = {}) {
    const s = state();
    if (!Array.isArray(s.alerts)) s.alerts = [];
    const kind = String(a.kind || '');
    const target = String(a.target || '');
    const sub = String(a.sub || '');
    if (!kind || !target) return null;
    let e = s.alerts.find((x) => String(x?.kind || '') === kind
        && String(x?.target || '') === target && String(x?.sub || '') === sub);
    if (!e) {
        e = {
            id: 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            kind, target, sub,
            name: String(a.name || ''), date: String(a.date || ''),
            note: String(a.note || ''), seen: false, at: Date.now(),
        };
        s.alerts.push(e);
    } else {
        if (a.name) e.name = String(a.name);
        if (a.date) e.date = String(a.date);
        if (a.note) e.note = String(a.note);
    }
    // ★ 2026-10-26：预产期那条把"孕期总天数"也存上 —— 日期以后按它现算，
    //   不靠一条存死的日期（时间一变就成好几年前 ✗）
    if (a.gestDays != null && Number.isFinite(Number(a.gestDays))) e.gestDays = Math.round(Number(a.gestDays));
    // 保险丝：留最近 100 条（跟别处一个思路 ✓）
    if (s.alerts.length > 100) s.alerts.splice(0, s.alerts.length - 100);
    commit();
    return e;
}

/** 记成"提示过了"（气泡点掉时走这里 ✓） */
export function markAlertSeen(id) {
    const key = String(id || '');
    if (!key) return false;
    const e = listAlerts().find((x) => String(x?.id || '') === key);
    if (!e) return false;
    e.seen = true;
    commit();
    return true;
}

/**
 * 删掉某个对象那几条"怀孕提醒"（2026-10-23）——
 * 她报：改数值里「设为未孕（撤销）」之后，气泡还挂着「已着床完成（怀孕）」。
 * 原因：设未孕只撤了判定与胎数，没撤这条提醒 ⇒ 它是"未读提醒"，硬刷新也会再弹 ✗
 * 判据：孕已经撤了，那几条基于孕的提醒就不该再存在（含没着床那条）✓
 * @returns {number} 删掉几条
 */
export function dropConceiveAlerts(targetKey) {
    const s = state();
    if (!Array.isArray(s.alerts)) return 0;
    const k = String(targetKey || '');
    const before = s.alerts.length;
    s.alerts = s.alerts.filter((x) => {
        const kind = String(x?.kind || '');
        if (kind !== 'conceive' && kind !== 'implant_fail') return true;
        if (k && String(x?.target || '') !== k) return true;
        return false;
    });
    const n = before - s.alerts.length;
    if (n) commit();
    return n;
}

/**
 * ★ 2026-10-26：改孕周之后，把这一胎的「预产期」一起挪。
 *
 * 预产期 ＝ 起点 ＋ 孕期长度，而孕周是「今天离起点多少天」⇒ **同一个源头**。
 * 孕周变大 = 起点更早 ⇒ 预产期要提前同样的天数（总孕期长度不变）。
 * （不然会出现：孕 32 周了，预产期还在九个月后 ✗）
 *
 * 只动两处：`kind='due'` 的提醒（含 note 里那个日期）＋ d6 里写着的「预产期：X」。
 * 受精 / 着床判定、胎数、孩子数据、孕期那一格一律不动 ✓
 *
 * @param {string} targetKey 对象键
 * @param {number} deltaDays 要挪几天（正数＝往后，负数＝提前）
 * @returns {number} 动了几处
 */
export function shiftDueDatesOf(targetKey, deltaDays) {
    const s = state();
    const k = String(targetKey || s.active || '');
    const d = Math.round(Number(deltaDays));
    if (!k || !Number.isFinite(d) || !d) return 0;
    let n = 0;
    if (Array.isArray(s.alerts)) {
        for (const a of s.alerts) {
            if (!a || String(a.kind || '') !== 'due') continue;
            if (String(a.target || '') !== k) continue;
            const nd = addDays(String(a.date || ''), d);
            if (!nd) continue;
            a.date = nd;
            const nm = String(a.name || '').trim();
            const sub = String(a.sub || '');
            const idx = /^子(\d+)$/.exec(sub);
            if (nm && idx) a.note = nm + ' 的预产期（第 ' + idx[1] + ' 胎）：' + nd;
            n++;
        }
    }
    // d6 里那格「预产期：X」也是这个日期的一份 ⇒ 一起挪（只动日期，别的一个字不碰）
    try {
        const t = s.targets?.[k];
        const d6 = String(t?.profile?.d6 || '');
        if (d6) {
            const next = d6.replace(/(预产期\s*[:：]\s*)([^\s，,、；;）)]+)/g, (m0, p1, p2) => {
                const nd = addDays(p2, d);
                return nd ? p1 + nd : m0;
            });
            if (next !== d6) { t.profile.d6 = next; n++; }
        }
    } catch { /* 忽略 */ }
    if (n) commit();
    return n;
}
/**
 * 该弹的那批自动提醒（`ui.js` 的气泡把这份并进日程那批里 ✓）。
 * 判据：
 *   · `conceive`（怀孕）⇒ 还没提示过就弹（它记的就是"发现的那一刻"）
 *   · `due`（预产期）⇒ **剧情日期到那天或过了**、且还没提示过
 * ⚠️ 比的是**剧情日期**（跟日程那套同一个口径 ✓）
 *
 * ★★ 着床完成那一刻可能被剧情跳过去 ⇒ **文案带上"距今多少天"** ——
 *   剧情一下子跳过一个月时，这条提醒会在**事后**才弹（判据见上，它不会丢 ✓），
 *   那就得说清"不是刚着床，是已经 N 天了" ✓。
 *   ⚠️ 天数**在这里现算**（不是记提醒那一刻算死 ✗）—— 可能隔几天才看到气泡，
 *     现算的才对 ✓（`doneDate` / 预产期本来就存着，一减就有 ✓）。
 */
export function alertEntriesForBubble() {
    const out = [];
    let today = '';
    try { today = currentDate(); } catch { today = ''; }
    /** 距今几天（正数 = 那件事已经过去 N 天；拿不到就 null） */
    const daysAgo = (d) => {
        if (!today || !d) return null;
        try { const n = diffDays(d, today); return Number.isFinite(n) ? n : null; } catch { return null; }
    };
    // ★ 2026-10-26（她问出来的）：**同一天的那些胎并成一条**
    //   （三胎同一天原来念三遍「第 1 胎 / 第 2 胎 / 第 3 胎」，说的是同一件事 ✓）
    //   ⚠️ 底层提醒还是每胎一条，这里只是念法；`ids` 全带着 ⇒ 点 ✕ 时一起记成看过 ✓
    const dueGroups = new Map();
    let duePos = -1;
    for (const e of listAlerts()) {
        if (!e || e.seen) continue;
        const kind = String(e.kind || '');
        const key = 'alert:' + String(e.id || '');
        const who = String(e.name || '');
        if (kind === 'conceive') {
            if (settings().notifyConceive === false) continue;
            // 差 0 天（当场）⇒ 照旧那句；已经过去 N 天 ⇒ 说清是"XX 天前着床的" ✓
            const ago = daysAgo(String(e.date || ''));
            const note = (ago !== null && ago > 0)
                ? (who + ' 已着床 ' + ago + ' 天（怀孕）')
                : String(e.note || '');
            out.push({ date: String(e.date || today || ''), note, key });
        } else if (kind === 'implant_fail') {
            // ★ 受精成功但没着床（2026-10-14）：跟怀孕那条一样，天数**在这里现算** ✓
            if (settings().notifyConceive === false) continue;
            const ago = daysAgo(String(e.date || ''));
            const note = (ago !== null && ago > 0)
                ? (who + ' 受精成功但没着床（' + ago + ' 天前）')
                : (who + ' 受精成功但没着床');
            out.push({ date: String(e.date || today || ''), note, key });
        } else if (kind === 'race') {
            // ★ 「强制判对」待确认项 —— 记了就弹一次（点掉就不再提 ✓）
            out.push({ date: String(e.date || today || ''), note: String(e.note || (who + ' 的种族还没确认')), key });
        } else if (kind === 'heritage') {
            // ★ 2026-10-24（构建 -99）：遗传三格没写进来 / 自动重试停了 —— 记一条弹一次（点掉不再提 ✓）
            out.push({ date: String(e.date || today || ''), note: String(e.note || (who + ' 的遗传三格还没写进来')), key });
        } else if (kind === 'rewind') {
            // ★ 真倒流：引擎报了「过去·经历」⇒ 提醒玩家自己去时光机点回去
            //   （**绝不自动退账** —— 整套回滚是破坏性操作，得玩家亲手点 ✓）
            out.push({ date: String(e.date || today || ''), note: String(e.note || '这一轮是真倒流：去时光机点「从这里重新开始」'), key });
        } else if (kind === 'dayfix') {
            // ★ 按剧情把日期修回来了一天（时间跟着自己走）——
            //   这条**不静默改数据**：气泡里说一句，玩家随时能看到改过什么 ✓
            out.push({ date: String(e.date || today || ''), note: String(e.note || '按剧情把日期退回来一天'), key });
        } else if (kind === 'due') {
            if (settings().notifyDue === false) continue;
            if (!today || !e.date) continue;
            let back = null;
            try { back = diffDays(today, e.date); } catch { back = null; }
            if (back === null || back > 0) continue;      // 还没到那天 ⇒ 不弹 ✓
            // back ≤ 0 ⇒ 到那天（0）或者已经逾期（负数）✓ 两种都要说清 ✓
            const late = -back;
            const gk = String(e.date || '') + '|' + who + '|' + late;
            let g = dueGroups.get(gk);
            if (!g) {
                if (duePos < 0) duePos = out.length;
                g = { date: String(e.date || ''), who, late, fetus: [], ids: [] };
                dueGroups.set(gk, g);
            }
            const nth = Number(String(e.sub || '').match(/\d+/)?.[0] || 0);
            if (nth > 0) g.fetus.push(nth);
            if (e.id) g.ids.push(String(e.id));
        }
    }
    if (dueGroups.size) {
        const merged = [...dueGroups.values()].map((g) => {
            const label = g.fetus.length
                ? ('（第 ' + g.fetus.sort((a, b) => a - b).join('、') + ' 胎）')
                : '';
            const note = g.late > 0
                ? (g.who + ' 预产期已过 ' + g.late + ' 天' + label)
                : (g.who + ' 的预产期到了' + label);
            return { date: g.date, note, key: 'alert:' + g.ids.join('+') };
        });
        out.splice(duePos < 0 ? out.length : duePos, 0, ...merged);
    }
    return out;
}

/**
 * 按每个对象的 d6（胎儿状态）**建 / 更新预产期提醒**。
 * ★ 一个孩子一条（`sub` = 子N）⇒ 同一个孩子改了日期就是更新那一条，不会越攒越多 ✓
 * ⚠️ 日期**不是引擎报的**：引擎只在那个孩子的括号里报「孕期」区间/固定值，
 *   **掷天数、算日期、掷一次锁住**都在 `judge.js` 的 `ensureGestationDates()` 里 ✓
 *   （这条路只剩"引擎/玩家直接写了 `预产期：X`"那种兼容情形 ✓）
 */
export function syncDueAlerts() {
    let n = 0;
    try {
        if (settings().notifyDue === false) return 0;
        for (const t of targetList()) {
            const kids = parseFetus(t?.profile?.d6 || '').kids;
            kids.forEach((k, i) => {
                const due = String(k?.due || '').trim();
                if (!due) return;
                const who = displayName(t) || t.key || '';
                upsertAlert({
                    kind: 'due', target: String(t.key || ''), sub: '子' + (i + 1),
                    name: who, date: due,
                    note: who + ' 的预产期（第 ' + (i + 1) + ' 胎）：' + due,
                });
                n += 1;
            });
        }
    } catch (e) { console.warn('[Bodycord] 同步预产期提醒失败', e); }
    return n;
}

/** 给这一天加一条空的（默认"全天"，玩家想标时间自己关 ✓） */
export function addCalendarEvent(date) {    const d = String(date || '').trim();
    if (!d) return null;
    const arr = calendarEvents();
    const same = arr.filter((x) => String(x?.date || '') === d);
    if (same.length >= MAX_CAL_EVENTS_PER_DAY) return null;
    const e = { id: calEvId(), date: d, title: '', allDay: true, start: '', end: '', note: '', at: Date.now() };
    arr.push(e);
    if (arr.length > MAX_CAL_EVENTS) arr.splice(0, arr.length - MAX_CAL_EVENTS);
    commit();
    return { id: e.id, date: e.date };
}

/**
 * 改一条日程（只改给进来的那几格 ✓；时间怎么存、认不出来怎么办，全在共用那份里 ✓）
 * @returns {{ok:boolean, warn?:string, entry?:object}}
 */
export function updateCalendarEvent(date, id, patch = {}) {
    const d = String(date || '').trim();
    const key = String(id || '').trim();
    if (!d || !key) return { ok: false, warn: '这条日程已经不在了' };
    const e = calendarEvents().find((x) => String(x?.id || '') === key && String(x?.date || '') === d);
    if (!e) return { ok: false, warn: '这条日程已经不在了' };
    const r = calEvApply(e, patch);
    commit();
    return {
        ok: true,
        warn: r.warn,
        entry: { id: e.id, date: e.date, allDay: !!e.allDay, start: e.start, end: e.end, note: e.note },
    };
}

/** 删掉一条（返回真删了没有 ✓） */
export function deleteCalendarEvent(date, id) {
    const d = String(date || '').trim();
    const key = String(id || '').trim();
    if (!d || !key) return false;
    const arr = calendarEvents();
    const i = arr.findIndex((x) => String(x?.id || '') === key && String(x?.date || '') === d);
    if (i < 0) return false;
    arr.splice(i, 1);
    commit();
    return true;
}

/** 给面板格子的那份：有日程的那些日子 + 那天第一行的字（纯数据 ✓） */
export function calendarEventsForPanel() {
    return calEvForPanel(calendarEvents(), timeUnitNow());
}

/**
 * 某一天的那张小卡片信息（保存完回给面板，让它**只贴一下格子**、不用整页重画 ✓）
 * @returns {{day:number, label:string, count:number}|null}
 */
export function calendarDayCard(date) {
    const d = String(date || '').trim();
    if (!d) return null;
    const u = timeUnitNow();
    const card = calEvCard(calendarEvents(), d, u);
    const p = parseFictionDate(d);
    return {
        day: p ? p.d : 0,
        label: card.label ? card.label.slice(0, 6) : '',
        count: card.count,
    };
}

/**
 * 清掉"空壳子"日程（点了「加一条」又什么都没写的那些 ✓）
 * ⚠️ `keepDate` 是**玩家正在编辑的那一天** —— 它一条都不碰（别把人家正打字的行抽走 ✗）
 * @returns {number} 清掉几条
 */
export function pruneEmptyCalendarEvents(keepDate) {
    const n = calEvPrune(calendarEvents(), keepDate, timeUnitNow());
    if (n) commit();
    return n;
}

/**
 * 到点该提示的日程（日子已经到 / 过了，而且还没提示过 ✓）。
 * ⚠️ 判据是**剧情日期走到了**，不是现实时间 —— 剧情时间是剧情推进的 ✓
 *   （现实日历那份走的是**设备今天**，逻辑在 settings.js 那边 ✓）
 */
export function calendarAlertsForPanel() {
    const today = currentDate();
    if (!today) return [];
    let done;
    try { done = new Set((state().calendarAlerted || []).map(String)); } catch { done = new Set(); }
    const out = [];
    const u = timeUnitNow();
    for (const e of calEvSort(calendarEvents())) {
        if (!calEvFilled(e, u)) continue;
        if (!calEvRemindOn(e)) continue;          // ★ 这一条被玩家关掉提醒了 ⇒ 跳过 ✓
        const d = String(e?.date || '');
        const note = calEvLabel(e, u);
        if (!d || !note) continue;
        const key = d + '|' + note;
        if (done.has(key)) continue;
        const back = diffDays(d, today);
        if (back !== null && back >= 0) out.push({ date: d, note, key });
    }
    return out;
}

/** 把这些提示记成"已经提示过了"（面板上点掉之后外壳调它 ✓） */
export function markCalendarAlerted(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).map(String).filter(Boolean);
    if (!list.length) return 0;
    const s = state();
    if (!Array.isArray(s.calendarAlerted)) s.calendarAlerted = [];
    let n = 0;
    for (const k of list) {
        if (!s.calendarAlerted.includes(k)) { s.calendarAlerted.push(k); n += 1; }
    }
    if (s.calendarAlerted.length > 400) s.calendarAlerted.splice(0, s.calendarAlerted.length - 400);
    if (n) commit();
    return n;
}

/** 当前该显示的日期（剧情模式返回剧情日期、虚拟模式返回虚拟日期） */
export function currentDate() {
    // ★ 顺手把历法对齐一次（幂等、只比一个字符串 ⇒ 便宜 ✓）
    syncCalendarForChat();
    return String(state().fictionDate || '');
}

/**
 * 设当前日期。
 * @param {string} value 形如 `1年01月01日`（会做格式校验，认不出来就不写 ✓）
 * @param {'story'|'fiction'} [mode] 不给就沿用现有模式
 */
export function setCurrentDate(value, mode) {
    const s = state();
    const text = String(value ?? '').trim();
    if (text) {
        const p = parseFictionDate(text);          // 校验用**当前生效**的那套历法 ✓
        if (!p) return false;                      // 认不出来的日期不要写进去 ✗
        s.fictionDate = formatFictionDate(p);
    } else {
        s.fictionDate = '';
    }
    if (mode === 'story' || mode === 'fiction') s.dateMode = mode;
    else if (!s.dateMode) s.dateMode = 'fiction';  // 没定过就默认"虚拟"（剧情给了日期时会被标成 story ✓）
    commit();
    // ★ 2026-10-26：导入时还没有日期 ⇒ 那批相对日期挂着；现在有日期了，落一次
    try {
        const pend = state().pendingRelDates;
        if (pend && typeof pend === 'object') {
            state().pendingRelDates = null;
            commit();
            applyRelDates(pend);
        }
    } catch { /* 忽略 */ }
    return true;
}

// ---------------------------------------------------------------------------
// ★★ 钟点（小时和分钟）
//   存的是 `state().fictionTime`（**当日第几分钟**，0~1439）——
//   ⚠️ 它跟 `fictionDate` **分开存** ⇒ 日期那套一字没动、老机制全不受影响 ✓✓
//   ⚠️ 历法那档是「不记钟点」时：一律 0、界面也不显示 ✓（出厂＝这档 ✓）
// ---------------------------------------------------------------------------

/** 历法当前那档钟点粒度（'none' / 'hour' / 'minute'） */
export function timeUnitNow() {
    try { return activeCalendar().timeUnit; } catch { return 'none'; }
}

/** 当日第几分钟（0~1439） */
export function currentTime() {
    try {
        const n = Number(state().fictionTime);
        return Number.isFinite(n) ? Math.min(1439, Math.max(0, Math.round(n))) : 0;
    } catch { return 0; }
}

/** 设当日第几分钟（认不出来 ⇒ 不写、返回 false ✓） */
export function setCurrentTime(min, mode) {
    const n = Number(min);
    if (!Number.isFinite(n)) return false;
    state().fictionTime = Math.min(1439, Math.max(0, Math.round(n)));
    if (mode === 'story' || mode === 'fiction') setCurrentDate(currentDate(), mode);  // 顺手标来源 ✓
    commit();
    return true;
}

/** 日期 ＋ 钟点，给人看的那一串（「不记钟点」时就是光秃秃的日期 ✓） */
export function storyDateTimeNow() {
    const d = currentDate();
    if (!d) return '';
    const clock = formatClock(currentTime(), timeUnitNow());
    return clock ? (d + ' ' + clock) : d;
}

/**
 * 往后推 n 天（剧情过了一夜就 +1、"三天后"就 +3）
 * ★ **推日期这件事由插件做**（不让 AI 自己算 ✓）——
 *   因为 AI 只熟公历，换成自定义历法 / 自定义写法它必错 ✗
 * @param {number} n 天数
 * @param {'story'|'fiction'} [mode] 给了就顺手把"时间来源"标过去
 */
export function advanceDate(n, mode) {
    const cur = currentDate();
    if (!cur) return '';
    const next = addDays(cur, n);
    if (next) setCurrentDate(next, mode);
    return next;
}

/**
 * ★★ 把**已经记下的日期**整体搬 n 天（不动"今天"）。
 *
 * 用途＝「身体没经历这段」：日历挪了，但**差值守恒** ⇒ 孕周 / 周期第几天 / 年龄 /
 *   痕迹一个都不变（肉身穿越 ✓）。
 * ⚠️ 里面会把"今天"**绝对赋值**回去 —— `_shiftChatDatesByDays` 连 `fictionDate` 一起搬，
 *   不复位的话"今天"会走两遍 ✗
 * ⚠️ 只搬**剧情日期串**，不碰 `at` / `ts` 那些真实时间戳（见 `_forEachChatDate` ✓）
 * @returns {number} 搬了几处
 */
export function shiftRecordedDatesBy(days, opts = {}) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n) || n === 0) return 0;
    // ★★ `opts.only`（对象键数组）＝**只搬这几个人的**日期 ⇒ 混合情况用 ✓
    //   （没给 ⇒ 老行为：连世界上的事一起搬 ✓）
    const only = (Array.isArray(opts.only) && opts.only.length)
        ? new Set(opts.only.map((x) => String(x || '')).filter(Boolean))
        : null;
    const s = state();
    const today = currentDate();
    const moved = _shiftChatDatesByDays(s, n, only);
    if (today) setCurrentDate(today, dateMode() === 'story' ? 'story' : 'fiction');
    commit();
    return moved;
}

/**
 * ★ 2026-10-26：仅状态档案**跨时间轴**导入 ⇒ 把记录里的日期按新时间轴重锚。
 *
 * 语义：**相对量守恒**（孕周 / 还剩几天 都不变），绝对日期换成新档的日子。
 *   · 周期锚点单独处理：当时第几天 ＝ cycleDay ＋(锚点→原剧情日期)，
 *     新锚点直接落到新档日期上（跟着整体 +dd 会凭空多出这十年 ✗）
 *   · 植入起点整体 +dd（植入孕的孕周是"到今天几天"，平移后不变）
 *   · 其余日期记录（判定日 / 预产期 / 孩子生日 / 成就日期 / 提醒 / 精子窗口）整体 +dd
 *
 * @param {string[]} keys 要重锚的对象键
 * @param {string} fromDate 文件里的原剧情日期
 * @param {string} toDate 当前聊天的剧情日期
 * @returns {number} 动了几处
 */
export function rebaseImportedDatesOf(keys, fromDate, toDate) {
    const s = state();
    const list = (Array.isArray(keys) ? keys : []).map(String).filter(Boolean);
    const from = String(fromDate || '').trim();
    const to = String(toDate || '').trim();
    if (!list.length || !from || !to) return 0;
    const dd = diffDays(from, to);
    if (!Number.isFinite(dd) || !dd) return 0;
    const set = new Set(list);
    let n = 0;
    // ① 周期锚点（先算，再交给下面跳过的表）
    for (const k of set) {
        const t = s.targets?.[k];
        if (!t) continue;
        const at = String(t.cycleDayAt || '');
        if (!at) continue;
        const day = Number(t.cycleDay);
        if (Number.isFinite(day)) {
            const d0 = diffDays(at, from);
            if (Number.isFinite(d0)) t.cycleDay = Math.max(1, Math.round(day + d0));
        }
        t.cycleDayAt = to;
        n += 1;
    }
    // ② 植入起点
    for (const k of set) {
        const v = String(s.implantDates?.[k] || '');
        if (!v) continue;
        const nv = addDays(v, dd);
        if (nv) { s.implantDates[k] = nv; n += 1; }
    }
    // ③ 其余日期记录（跳过已经处理过的周期锚点）
    n += _shiftChatDatesByDays(s, dd, set, new Set(['cycleDayAt']));
    if (n) commit();
    return n;
}

/**
 * ★ 2026-10-26：预产期按"孕期总天数"现算，不存死日期。
 *
 * 预产期 ＝ 起点（上一次月经那天）＋ 孕期总天数；而今天离起点多少天就是孕周天数
 *   ⇒ 预产期 ＝ 今天 ＋ (孕期总天数 − (孕周天数 − 1))。
 *   时间一推进/一导入，重新算一遍即可，玩家永远看到的是未来那天 ✓
 *   没存 `gestDays` 的老提醒不动（没有依据，不假造）。
 * @returns {number} 改了几条
 */
export function refreshDueDates() {
    const s = state();
    const list = Array.isArray(s.alerts) ? s.alerts : [];
    const today = currentDate();
    if (!today) return 0;
    let n = 0;
    for (const a of list) {
        if (!a || String(a.kind || '') !== 'due') continue;
        const g = Number(a.gestDays);
        if (!Number.isFinite(g) || g <= 0) continue;
        const key = String(a.target || '');
        let dayNow = 0;
        try { dayNow = Number(cycleDayNum(key) || pregDaysOf(key) || 0); } catch { dayNow = 0; }
        if (!Number.isFinite(dayNow) || dayNow <= 0) continue;
        const due = addDays(today, Math.round(g - (dayNow - 1)));
        if (!due || due === String(a.date || '')) continue;
        a.date = due;
        const m = /^子(\d+)$/.exec(String(a.sub || ''));
        if (a.name && m) a.note = String(a.name) + ' 的预产期（第 ' + m[1] + ' 胎）：' + due;
        n += 1;
    }
    if (n) commit();
    return n;
}

/**
 * ★ 2026-10-26：日历要标的**预产期**（只读，一个对象/一胎一条）。
 *
 * 口径（跟 `refreshDueDates()` 同一条公式，但这里**一个字都不写盘** ✓）：
 *   · 有 `gestDays` ⇒ 预产期 ＝ 今天 ＋ (孕期总天数 − (今天孕几天 − 1))（现算，会跟着孕周走 ✓）
 *   · 没有 ⇒ 用提醒里记着的那天（老数据没有依据，不假造 ✓）
 * 为什么日历要自己算、不写进日程（calendarEvents）：日程是**玩家自己填**的东西，
 *   预产期是插件算出来的事实 ⇒ 混进去以后她改不动、时间一跳还留一条死日期 ✗
 * @returns {Array<{date:string, name:string, fetus:number, late:number, key:string}>}
 *   `late` ＝ 已经过期的天数（0 = 就是今天；负数 = 还没到）
 */
export function dueMarksForPanel() {
    const today = currentDate();
    const out = [];
    const list = Array.isArray(state().alerts) ? state().alerts : [];
    for (const a of list) {
        if (!a || String(a.kind || '') !== 'due') continue;
        const m0 = dueMarkOf(a, today);
        if (m0) out.push(m0);
    }
    // 旧 → 新（`diffDays(a, b)` ＝ b − a，正数说明 a 在前 ✓）
    out.sort((x, y) => {
        const d = Number(diffDays(x.date, y.date));
        return Number.isFinite(d) ? d : 0;
    });
    return out;
}

/** 一条 due 提醒 → 一个现算出来的标记（`later` 里那些共用，别写两遍公式 ✓） */
function dueMarkOf(a, today) {
    if (!a) return null;
    let date = String(a.date || '');
    const g = Number(a.gestDays);
    if (today && Number.isFinite(g) && g > 0) {
        let dayNow = 0;
        try { dayNow = Number(cycleDayNum(String(a.target || '')) || pregDaysOf(String(a.target || '')) || 0); } catch { dayNow = 0; }
        if (Number.isFinite(dayNow) && dayNow > 0) {
            const live = addDays(today, Math.round(g - (dayNow - 1)));
            if (live) date = live;
        }
    }
    if (!date) return null;
    const m = /^子(\d+)$/.exec(String(a.sub || ''));
    let late = 0;
    try { late = Number(diffDays(date, today)) || 0; } catch { late = 0; }
    return { date, name: String(a.name || ''), fetus: m ? Number(m[1]) : 0, late, key: String(a.target || '') };
}

/**
 * ★ 2026-10-26（她问出来的）：**同一天的那些胎并成一条**（只在显示层并 ✓）。
 *
 * 三胎同一天预产期时，原来会念三遍「（第 1 胎）…（第 2 胎）…（第 3 胎）…」，
 *   说的是同一件事 ⇒ 气泡和日历里都改成一条「（第 1、2、3 胎）」。
 * ⚠️ **底层一条都不动**：提醒还是每胎一条（各自能改期），这里只是念法 ✓
 * @param {Array} list dueMarksOf / dueMarksForPanel 那种标记
 * @returns {Array<{date:string, name:string, late:number, fetus:number[]}>}
 */
export function mergeDueByDate(list) {
    const groups = new Map();
    for (const m of (Array.isArray(list) ? list : [])) {
        if (!m) continue;
        const gk = String(m.date || '') + '|' + String(m.name || '');
        let g = groups.get(gk);
        if (!g) {
            g = { date: String(m.date || ''), name: String(m.name || ''), late: Number(m.late) || 0, fetus: [] };
            groups.set(gk, g);
        }
        if (Number(m.fetus) > 0) g.fetus.push(Number(m.fetus));
    }
    return [...groups.values()].map((g) => ({ ...g, fetus: g.fetus.sort((a, b) => a - b) }));
}

/**
 * 某一个对象的预产期（现算；给状态摘要那行用 ✓）。
 * ⚠️ 跟 `dueMarksForPanel()` 同一份算法、同一个数据源（提醒那本账）——
 *   别在这儿另写一套"按 d6 猜"，插件只在推演/手动那颗按钮里才"定"预产期 ✓
 */
export function dueMarksOf(key) {
    const k = String(key || '');
    const today = currentDate();
    const list = Array.isArray(state().alerts) ? state().alerts : [];
    const out = [];
    for (const a of list) {
        if (!a || String(a.kind || '') !== 'due') continue;
        if (String(a.target || '') !== k) continue;
        const m0 = dueMarkOf(a, today);
        if (m0) out.push(m0);
    }
    out.sort((x, y) => {
        const d = Number(diffDays(x.date, y.date));
        return Number.isFinite(d) ? d : 0;
    });
    return out;
}


/**
 * ★ 2026-10-26：「仅状态」导出 —— 把绝对日期从档案里剥掉，只留相对天数。
 *
 * 为什么：仅状态是"换新时间点"用的，时间线属于那个聊天，不该跟着档案走。
 *   可是对象、判定记录、内射记录、提醒、孩子生日里都带着具体日期 ⇒ 原样导出
 *   等于把旧时间线搬进新档（2012 的判定日出现在 2022 的档里）✗。
 *   现在一律换成本档案剧情日期为基准的**相对天数**（`__rel`），导入后按新档日期重算。
 *
 * @param {object} st 深拷贝出来的整份 state（会被就地改：日期字段被删掉）
 * @returns {Object<string, number>} 相对天数表
 */
export function exportOnlyStateDates(st) {
    const rel = {};
    const base = String(st?.fictionDate || '').trim();
    const put = (obj, key, tag) => {
        if (!obj || typeof obj !== 'object') return;
        const v = String(obj[key] || '').trim();
        if (!v) return;
        if (base) {
            const n = diffDays(base, v);
            if (Number.isFinite(n)) rel[tag] = n;
        }
        delete obj[key];
    };
    for (const [k, t] of Object.entries(st?.targets || {})) {
        put(t, 'cycleDayAt', 't:' + k + ':cycleDayAt');
        put(t, 'lastSettleDate', 't:' + k + ':lastSettleDate');
        put(t, 'date', 't:' + k + ':date');
        put(t, 'birthDate', 't:' + k + ':birthDate');
        // ★ 2026-10-26：这两格也带着绝对日期（上次月经 / 精子那天的锚点）——
        //   不剥的话，导入后推演会拿旧日期去算周期日（2012 的月经日 ⇒ 孕 506 周 ✗）
        put(t?.vars, 'Cycle_Start_Date', 'v:' + k);
        put(t, 'spermLoadDate', 's:' + k);
        // 手改对照里也嵌着日期文本，仅状态不需要它（它不是身体状态，是"你改过哪格"的账）
        delete t.profileFix;
    }
    (Array.isArray(st?.children) ? st.children : []).forEach((c, i) => put(c, 'birthDate', 'c:' + i));
    // ★★ 2026-10-28（她报：仅状态导入后成就还带日期，旧成就被写成新档的日期）——
    //   成就的日期**不换成相对天数**：成就是"那时候解锁过"的历史，它属于旧时间线，
    //   在新时间轴上落出一个日期就是假的（旧成就全被标成新档的日子 ✗）。
    //   ⇒ 导出只把日期删掉、**不记 `__rel`**；导入时给这些成就打 `imported`，
    //     面板与设置页都不显示它们的日期（新档里正常解锁的成就没有这个标记 ✓）
    (Array.isArray(st?.achievements) ? st.achievements : []).forEach((a) => {
        if (a && typeof a === 'object') delete a.date;
    });
    (Array.isArray(st?.ovuJudgments) ? st.ovuJudgments : []).forEach((j, i) => put(j, 'doneDate', 'j:' + i));
    put(st?.ovuJudgment, 'doneDate', 'jall');
    (Array.isArray(st?.insems) ? st.insems : []).forEach((x, i) => put(x, 'depotDate', 'i:' + i));
    (Array.isArray(st?.alerts) ? st.alerts : []).forEach((a, i) => put(a, 'date', 'al:' + i));
    (Array.isArray(st?.conceptionArchive) ? st.conceptionArchive : []).forEach((a, i) => {
        (Array.isArray(a?.insems) ? a.insems : []).forEach((x, j) => put(x, 'depotDate', 'ca:' + i + ':' + j));
    });
    for (const k of Object.keys(st?.implantDates || {})) {
        const d = String(st.implantDates[k] || '').trim();
        if (!d) continue;
        if (base) { const n = diffDays(base, d); if (Number.isFinite(n)) rel['im:' + k] = n; }
        delete st.implantDates[k];
    }
    put(st, 'tracesDecayedOn', 'w:tracesDecayedOn');
    // ★ 2026-10-26：仅状态导出还漏了「近期性行为」这一份 ——
    //   清单里每条的 `time` 是文本日期，而 `profile.row3` 是把它渲染出来的缓存
    //   ⇒ 两处都把日期剥掉（只剥日期与钟点，事件 / 人物一个字都不动 ✓）
    for (const k of Object.keys(st?.sexLog || {})) {
        const list = st.sexLog[k];
        if (!Array.isArray(list)) continue;
        for (const x of list) {
            if (x && typeof x.time === 'string') {
                const t2 = stripDateText(x.time).trim();
                if (t2 !== x.time) x.time = t2;
            }
        }
    }
    for (const t of Object.values(st?.targets || {})) {
        if (t && t.profile && typeof t.profile.row3 === 'string') {
            const t2 = stripDateText(t.profile.row3).trim();
            if (t2 !== t.profile.row3) t.profile.row3 = t2;
        }
    }
    return rel;
}

/**
 * 把 `__rel` 那批相对天数按**当前聊天的剧情日期**落回具体的日期字段。
 * 相对量守恒：导出时"还有几天 / 已经过了几天"，导进来还是那样，只是换成新时间轴的日子。
 * @returns {number} 落了几处
 */
export function applyRelDates(rel) {
    if (!rel || typeof rel !== 'object') return 0;
    const cur = currentDate();
    if (!cur) return 0;
    const s = state();
    let n = 0;
    const setAt = (obj, key, d) => {
        if (!obj || typeof obj !== 'object' || !d) return;
        obj[key] = d; n += 1;
    };
    for (const [tag, daysRaw] of Object.entries(rel)) {
        const days = Number(daysRaw);
        if (!Number.isFinite(days)) continue;
        const d = addDays(cur, Math.round(days));
        if (!d) continue;
        const p = String(tag).split(':');
        if (p[0] === 't') setAt(s.targets?.[p[1]], p[2], d);
        else if (p[0] === 'v') { const t2 = s.targets?.[p[1]]; if (t2) { if (!t2.vars || typeof t2.vars !== 'object') t2.vars = {}; t2.vars.Cycle_Start_Date = d; n += 1; } }
        else if (p[0] === 's') setAt(s.targets?.[p[1]], 'spermLoadDate', d);
        else if (p[0] === 'c') setAt(s.children?.[Number(p[1])], 'birthDate', d);
        // ★ 2026-10-28：旧版档案里还带着成就的相对天数（`a:i`）—— **一律不落**。
        //   成就的日期属于旧时间线，落到新时间轴上只会把旧成就写成新档的日期 ✗
        //   （现在导出也不再产生这条；这里留着是为了兼容已经导出过的旧文件）
        else if (p[0] === 'a') { /* 成就日期不按新时间轴重算 ✓ */ }
        else if (p[0] === 'j') setAt(s.ovuJudgments?.[Number(p[1])], 'doneDate', d);
        else if (tag === 'jall') setAt(s.ovuJudgment, 'doneDate', d);
        else if (p[0] === 'i') setAt(s.insems?.[Number(p[1])], 'depotDate', d);
        else if (p[0] === 'al') setAt(s.alerts?.[Number(p[1])], 'date', d);
        else if (p[0] === 'ca') setAt(s.conceptionArchive?.[Number(p[1])]?.insems?.[Number(p[2])], 'depotDate', d);
        else if (p[0] === 'im') {
            if (!s.implantDates || typeof s.implantDates !== 'object') s.implantDates = {};
            s.implantDates[p[1]] = d; n += 1;
        } else if (tag === 'w:tracesDecayedOn') { s.tracesDecayedOn = d; n += 1; }
    }
    if (n) commit();
    return n;
}

/** 导入时还没有剧情日期 ⇒ 先挂着，等这个档第一次有日期再落（绝不静默跳过 ✓） */
export function setPendingRelDates(rel) {
    state().pendingRelDates = (rel && typeof rel === 'object') ? rel : null;
    commit();
}

/**
 * ★★ 这一轮"谁的身体没经历"的最终判定（纯函数，方便测 ✓）。
 *
 * 优先级：
 *   ① 玩家在界面上点过的**例外名单** ⇒ 跟世界那格**相反**（名单＝例外，本来就是相对世界说的 ✓）
 *   ② 否则按引擎这一轮**对这个对象**报的 ⇒ 直接采用（它对具体的人更准 ✓）
 *   ③ 否则按世界答案（`time_jump` 或玩家那颗三颗档）✓
 */
export function bodySkipsFor(key, worldSkips, reportedSkip) {
    const k = String(key || '');
    const excepts = Array.isArray(state().timeJumpExceptKeys) ? state().timeJumpExceptKeys.map(String) : [];
    if (k && excepts.includes(k)) return worldSkips !== true;
    if (reportedSkip === true || reportedSkip === false) return reportedSkip;
    return worldSkips === true;
}

/** 标签那一格"下轮再问一次"的一次性开关（发生时间跳跃之后置上、问到就清 ✓） */
export function setTagAskPending(on) {
    state().tagAskPending = on === true;
    commit();
}

/** 例外名单：这些人跟世界那格相反（没经历 ⇄ 经历）✓ */
export function timeJumpExceptKeys() {
    return (Array.isArray(state().timeJumpExceptKeys) ? state().timeJumpExceptKeys : []).map(String);
}

export function setTimeJumpExceptKeys(keys) {
    state().timeJumpExceptKeys = (Array.isArray(keys) ? keys : []).map((x) => String(x || '')).filter(Boolean);
    commit();
}

/**
 * ★ 这次平移**能不能做**（预检）：往回搬的时候，只要有一条已记日期会掉到**历法第一天之前**，
 *   就整个拒绝（"判不出来只许拒、绝不半搬" ✓）—— 调换方向也绝不悄悄改 ✓
 */
export function canShiftRecordedDatesBy(days) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n) || n === 0) return false;
    if (n > 0) return true;
    try { return _datesClippedByShift(state(), n).length === 0; } catch { return false; }
}

/**
 * ★ 「这个聊天的时间跳跃算不算身体时间」（**聊天级**，默认**算** ✓）。
 * 关掉 ⇒ 推演报回来的跨度只挪日历、已记日期一起搬（差值守恒）⇒
 *   孕周 / 周期 / 痕迹都不动（肉身穿越去未来写在正文里时走这条 ✓）
 * ⚠️ 玩家**没自己点过**的时候，这一格由**引擎每轮报的 `body_experienced`** 决定 ✓
 */
export function timeJumpSkipsBody() {
    return state().timeJumpSkipsBody === true;
}

/** 玩家在界面上自己定过这一档没有（定过 ⇒ 契约里就不再问那一格、以玩家为准 ✓） */
export function timeJumpSkipsBodyManual() {
    return state().timeJumpSkipsBodyManual === true;
}

export function setTimeJumpSkipsBody(on) {
    const s = state();
    s.timeJumpSkipsBody = on === true;
    // ★ 打上"手改锁"（跟种族 / 受孕体质档那套一样）：之后**以玩家为准**，不再每轮问引擎 ✓
    s.timeJumpSkipsBodyManual = true;
    commit();
}

/** ★ 回到"让引擎每轮自己判断"（把那个手改锁摘掉 ✓） */
export function setTimeJumpSkipsBodyAuto() {
    const s = state();
    s.timeJumpSkipsBodyManual = false;
    s.timeJumpSkipsBody = false;
    commit();
}

/**
 * ★★ 手动「往前补 N 天」。
 *
 * 为什么需要：时间是由 AI 报的**事实**推动的（日期加减是插件做的），可**两个 AI 都会犯蠢**：
 *   · 插件 API（推演引擎）漏报 / 报错 ⇒ 该过的天数没走，日历停着不动 ✗
 *   · 主 API（写正文）把时间写歪 ⇒ 插件只能照正文读 ⇒ 时间轴跟着歪 ✗
 * 需求：AI 有时候会算错时间、时间意识没那么好，所以这个功能可能会有用 ✓
 *
 * ★ 走的是**和推演完全相同**的那条路（`advanceDate`）⇒ 周期日 / 孕周 / 精子存活窗口
 *   都按新日期算，不会出现"日期走了、周期没动"的脱节 ✓
 *   （落账那一趟见 `judge.js` 的 `settleAfterTimeShift()`：补完当场把该算的账算掉 ✓）
 * ⚠️ 只往前。**往回退**要多做一件事：把已经记下的**绝对日期**一起搬走
 *   （孩子生日 / 成就日期 / 日历日程 / 着床完成日…）⇒ 所以「往回退」要单独做 ✓
 *
 * ★★ 两条**必须堵死**的路（非聊天页面可以补，并且
 *   1.1.1 往前补会往后补 —— 这俩路都要堵死 ✗）：
 *   ① **不在聊天里** ⇒ 不许补。那时 `state()` 落在一份"不属于任何聊天"的临时状态上
 *      ⇒ 补的天数写进空气里（在设置页点一下会弹出「1年01月01日 → 1年01月02日」✗）
 *   ② **还没有剧情日期** ⇒ 不许补。以前这里会"先垫 `1年01月01日` 再往前推"✗ ——
 *      那就是**凭空造一个时间轴起点**再往下走，和「最后一层必须是系统层」是同一条原则：
 *      **源头不许自己编事实** ✓ ⇒ 想补就先把日期跑出来（推演会按剧情报的日期 /
 *      虚拟日历起点把它落下来）✓
 *
 * @param {number} days 天数（1 以上；**不设上限** —— 玩家手填的，看得见也能退回来 ✓）
 * @param {object} [opts] `{ bodyExperienced }`：这一段**该角色的身体有没有经历**（默认 true＝经历 ✓）
 * @returns {{ok:boolean, days?:number, from?:string, to?:string, moved?:number, experienced?:boolean, clamped?:boolean, error?:string}}
 */
export function shiftDateForward(days, opts = {}) {
    const want = Math.round(Number(days));
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '天数要填 1 以上的整数' };
    // 堵路①：不在聊天里（或这个聊天还没有正文）⇒ 没地方可落
    if (!inRealChat()) return { ok: false, error: '还没进聊天（或这个聊天里还没有正文），补时间没有地方可落' };
    // 堵路②：还没有剧情日期 ⇒ 不许凭空造起点
    const from = currentDate();
    if (!from) return { ok: false, error: '这个聊天还没有剧情日期，先让推演跑一轮再来补' };
    // ★ 这里**不再夹天数**：手填的是玩家自己的决定（推演报的那个数才需要防笔误，
    //   夹子在 `judge.js` 的 `normalizeDaysPassed` + 设置里那格「单轮最多认多少天」✓）
    const step = want;
    const mode = dateMode() === 'story' ? 'story' : 'fiction';

    // ★★ 「身体没经历这段」（肉身穿越去未来、只有灵魂过去、被扔到十年后…）——
    //   做的是**跟「往过去退」同一套平移**：把**所有已经记下的日期**一起往前搬 ⇒
    //   差值守恒 ⇒ **孕周 / 周期第几天 / 痕迹一个都不变** ✓，而且**不该结算**（账没动，
    //   由调用方跳过 `settleAfterTimeShift` ✓）。
    //   ⚠️ 顺序：先整体平移、再用**绝对赋值**把"今天"钉到同一个值上（跟「往过去退」一样，
    //     直接 `advanceDate` 再搬会让今天走两遍 ✗）
    if (opts.bodyExperienced === false) {
        // ⚠️ 顺序：先推"今天"，再用 `shiftRecordedDatesBy` 把已记日期搬同样多 ——
        //   那一步会把"今天"绝对赋值回去 ⇒ 今天不会走两遍 ✓
        const to0 = advanceDate(step, mode);
        if (!to0) return { ok: false, error: '推不动：日期读不出来' };
        // ★★ 例外名单也吃（手填那条路跟引擎那条**同一个口径** ✓）——
        //   名单里的人跟"没经历"相反 ⇒ 他们**不搬**（账跟着走）✓；名单空 ⇒ 老行为（全搬）✓
        const s0 = state();
        const all = (Array.isArray(s0.order) ? s0.order : []).map((x) => String(x)).filter(Boolean);
        const skippers = all.filter((k) => bodySkipsFor(k, true, undefined));
        const moved = (skippers.length && skippers.length < all.length)
            ? shiftRecordedDatesBy(step, { only: skippers })
            : shiftRecordedDatesBy(step);
        commit();
        return { ok: true, days: step, from, to: to0, moved, experienced: false, clamped: false };
    }

    const to = advanceDate(step, mode);
    if (!to) return { ok: false, error: '推不动：日期读不出来' };
    commit();
    return { ok: true, days: step, from, to, experienced: true, clamped: step !== want };
}

/**
 * ★★ 手动「往未来补 N 天」且**身体经历了这段**时，按 N 夜把痕迹衰减一遍。
 *
 * 为什么需要它：痕迹的衰减**只由推演的痕迹报告推进**，
 *   而补时间这条路径不接那一步 ⇒ 补了一千年，日期走了、周期也推进了，**吻痕还在** ✗
 * 口径跟推演那条路完全一致：**夜数 × 恢复体质档倍率**（快 2 / 标准 1 / 慢 0.5 ✓）
 * ⚠️ 「身体没经历」那一档**不许调它**（账本来就不该动 ✓）
 * @returns {number} 这次动到了几个对象
 */
export function decayTracesForElapsedDays(nights) {
    const n = Number(nights);
    if (!Number.isFinite(n) || n <= 0) return 0;
    let hit = 0;
    for (const k of Object.keys(state().targets || {})) {
        try {
            decayTracesForTarget(k, n);
            hit++;
        } catch (e) { console.warn('[Bodycord] 补时间后衰减痕迹失败', e); }
    }
    return hit;
}

/** 只给一个对象按夜数衰减（乘上他的恢复体质档倍率 ✓） */
export function decayTracesForTarget(key, nights) {
    const n = Number(nights);
    if (!Number.isFinite(n) || n <= 0) return;
    const con = String(traceConstitutionOf(key) || '').trim();
    decayTraces(n * (TRACE_RECOVER_FACTOR[con] ?? 1), key);
}

/**
 * 把所有**已经记下的剧情日期**整体平移 n 天（n 可正可负）。
 *
 * ★ 为什么「往过去退」必须用它：
 *   只把 `fictionDate` 退回去 ⇒ "今天"退了、可**已经落账的那些记录还停在旧日子** ✗
 *   （孩子生日、成就日期、日历日程、着床完成日、批次日期、周期锚点…）
 *   ⇒ 两边对不上，年龄 / 孕周 / 日程全跟着歪。
 *
 * ★ 一起搬的好处（这一条是这个设计的关键）：
 *   `cycleDayAt`（周期锚点）和 `lastSettleDate` 也在里面 ⇒
 *   **周期第几天 = cycleDay + (今天 − cycleDayAt)** ⇒ 两头同时退 N 天 ⇒ **结果一天都不变** ✓
 *   （同理 `depositDay` / `viableUntil` 那些**周期日号**是相对量，根本不用动 ✓）
 *
 * ⚠️ 只搬**剧情日期串**，绝不碰 `at` / `ts` 这些真实时间戳 ✗
 * @returns {number} 搬了几处
 */
function _forEachChatDate(s, fn, only = null, skipKeys = null) {
    if (!s) return;
    // ★★ `only`（可选）＝**只搬这些对象自己的**日期（＝这一跳里"身体没经历"的那几个 ✓）
    //   给了它就**不搬世界上的事**（今天 / 日历日程）——
    //   因为今天那一格是"整个世界那一次跳跃"本身、日程是世界日历上的事 ✓
    //   不给 ⇒ 老行为：一把全搬 ✓
    const world = !only;
    const mine = (who) => world || (only.has(String(who || '')));
    const hit = (host, key) => {
        if (!host || typeof host !== 'object') return;
        const v = host[key];
        if (typeof v !== 'string' || !v.trim()) return;
        fn(host, key, v);
    };
    if (world) hit(s, 'fictionDate');
    for (const [key, t] of Object.entries(s.targets || {})) {
        if (!mine(key)) continue;
        for (const k of _DATE_KEYS) {
            // ★ 可以点名"这几格不许搬"（2026-10-16：往回退的"经历了"那一档要**留住周期锚点**，
            //   那样周期第几天 / 孕周才会跟着日期一起退回来 ✓）
            if (skipKeys && skipKeys.has(k)) continue;
            hit(t, k);
        }
    }
    for (const c of (Array.isArray(s.children) ? s.children : [])) if (mine(c?.key)) hit(c, 'birthDate');
    for (const a of (Array.isArray(s.achievements) ? s.achievements : [])) if (mine(a?.targetKey)) hit(a, 'date');
    if (world) for (const ev of (Array.isArray(s.calendarEvents) ? s.calendarEvents : [])) hit(ev, 'date');
    for (const j of (Array.isArray(s.ovuJudgments) ? s.ovuJudgments : [])) if (mine(j?.target)) hit(j, 'doneDate');
    if (world) hit(s.ovuJudgment, 'doneDate');
    for (const x of (Array.isArray(s.insems) ? s.insems : [])) if (mine(x?.target)) hit(x, 'depotDate');
    // ★ 自动提醒（怀孕 / 预产期）也一起搬 —— 不搬的话"时间退了、提醒还挂在旧日子"✗
    for (const a of (Array.isArray(s.alerts) ? s.alerts : [])) if (mine(a?.target)) hit(a, 'date');
    // 归档里那几段：里面的批次日期也一起搬（不然归档页和现在对不上 ✓）
    for (const a of (Array.isArray(s.conceptionArchive) ? s.conceptionArchive : [])) {
        if (!mine(a?.target)) continue;
        for (const x of (Array.isArray(a?.insems) ? a.insems : [])) hit(x, 'depotDate');
    }
}

function _shiftChatDatesByDays(s, n, only = null, skipKeys = null) {
    const step = Number(n) || 0;
    if (!step || !s) return 0;
    let count = 0;
    _forEachChatDate(s, (host, key, v) => {
        const next = addDays(v, step);
        if (next && next !== v) { host[key] = next; count += 1; }
    }, only, skipKeys);
    // ★ 精子的**绝对天**存活窗口也要跟着平移 ——
    //   它是数字（不是日期串）⇒ 上面那张槽位表扫不到它。
    //   不搬的话，"往过去退 3 天"会让每一批的存活期凭空多出 3 天 ✗
    const world = !only;
    const mine = (who) => world || (only.has(String(who || '')));
    const shiftAbs = (x) => {
        const v = Number(x?.viableUntilAbs);
        if (!Number.isFinite(v)) return;
        x.viableUntilAbs = v + step;
        count += 1;
    };
    for (const x of (Array.isArray(s.insems) ? s.insems : [])) if (mine(x?.target)) shiftAbs(x);
    // 归档里那几段的批次也一起（跟它们的 `depotDate` 同一待遇 ✓）
    for (const a of (Array.isArray(s.conceptionArchive) ? s.conceptionArchive : [])) {
        if (!mine(a?.target)) continue;
        for (const x of (Array.isArray(a?.insems) ? a.insems : [])) shiftAbs(x);
    }
    return count;
}

/**
 * ★ **搬之前先预检**会不会撞历法第一天。
 *
 * `fiction-date.js` 的 `fromAbs()` 里有个 `Math.max(0, …)` ⇒ 越过纪元那天会被
 * **静默夹成「1年01月01日」**：于是"退了 10 天"其实只退了一部分，孩子生日 / 成就日期 /
 * 周期锚点被改坏（"出生 6 天"变"刚出生"）✗。
 *
 * 判据＝**实际位移和你要的位移不一致，就是被夹了**（正常搬都是整段位移 ✓）。
 * 槽位走同一张表（`_forEachChatDate`）⇒ 预检和真搬不会漂 ✓
 *
 * @returns {Array<{key:string, from:string, to:string}>} 会被夹住的那些（空 = 随便退 ✓）
 */
function _datesClippedByShift(s, step, only = null, skipKeys = null) {
    const out = [];
    _forEachChatDate(s, (_host, key, v) => {
        const next = addDays(v, step);
        if (!next || next === v) return;
        const moved = diffDays(v, next);      // 实际搬了几天（b − a）
        if (moved !== step) out.push({ key, from: v, to: next });
    }, only, skipKeys);
    return out;
}

/**
 * ★★ 手动「往过去退 N 天」。
 *
 * 什么时候用：主 API 把时间写多了（正文里"三个月后"其实只过了一天）⇒ 时间轴走歪 ⇒ 玩家退回来 ✓
 *
 * ★ 跟"往未来补"的两处不同：
 *   ① **要一起搬已经记下的绝对日期**（见 `_shiftChatDatesByDays`）—— 不退它们就会错位 ✗
 *   ② **不重跑结算 / 受精判定** —— 时间往回走不该**生出新账** ✓
 *      （只把孕期状态按新日期对齐一次，见 judge.js 的 `syncAfterTimeBack()`）
 * ⚠️ **已经落账的结算收不回来**（已经判成着床成功、已经分娩的那笔账不会消失）⇒
 *   界面明面留着这句警告 ✓
 * ⚠️ 退到**历法第一天之前**直接拒（判不出来只许拒，**绝不改方向** ✓）
 *
 * @returns {{ok:boolean, days?:number, from?:string, to?:string, moved?:number, clamped?:boolean, error?:string}}
 */
export function shiftDateBackward(days) {
    const want = Math.round(Number(days));
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '天数要填 1 以上的整数' };
    if (!inRealChat()) return { ok: false, error: '还没进聊天（或这个聊天里还没有正文），退时间没有地方可落' };
    const from = currentDate();
    if (!from) return { ok: false, error: '这个聊天还没有剧情日期，先让推演跑一轮再来退' };
    const step = want;   // ★ 同"往未来补"：手填的不夹（夹子只管推演报的那个数 ✓）
    // 退到历法第一天之前 ⇒ 拒（不许"判不出来就朝反方向走" ✗）
    let elapsed = null;
    try { elapsed = diffDays(FICTION_DATE_START, from); } catch { elapsed = null; }
    if (elapsed === null || elapsed < step) {
        return { ok: false, error: '退不了那么多：再退就早于历法第一天（' + FICTION_DATE_START + '）了' };
    }
    const to = addDays(from, -step);
    if (!to) return { ok: false, error: '退不动：日期算不出来' };
    const s = state();
    // ★ 只校验"今天"不够 —— 比今天更早的那些记录（孩子生日 /
    //   成就 / 日程 / 着床完成日 / 周期锚点）会被 `fromAbs` 静默夹到历法第一天，
    //   看着成功了、其实把数据改坏 ✗ ⇒ 先预检，只要有一条会被夹住就**整个拒绝**
    //   （判不出来只许拒，绝不半搬 ✓）
    const clipped = _datesClippedByShift(s, -step);
    if (clipped.length) {
        return {
            ok: false,
            error: '退不了那么多：更早的记录会掉到历法第一天之前（' + clipped.length
                + ' 处，最早的是 ' + clipped[0].from + '）',
        };
    }
    const moved = _shiftChatDatesByDays(s, -step);   // 已经记下的日期一起搬 ✓
    setCurrentDate(to, dateMode() === 'story' ? 'story' : 'fiction');   // 绝对赋值，不会重复搬 ✓
    commit();
    return { ok: true, days: step, from, to, moved, clamped: step !== want };
}

/**
 * ★★ 「经历了」那一档要的**全套往回**（往回退按：这段算不算在该角色身上走 ✓）——
 *   日期 ＋ 已经记下的那些日期一起往回挪（孩子生日 / 成就 / 日程 / 着床完成日 / 精子存活窗口 ✓），
 *   **但周期锚点留着** ⇒ 周期第几天 / 孕周**跟着一起退回来** ✓（这正是玩家那件事要的效果 ✓）
 *
 * ⚠️ 两条路别混（2026-10-31 删掉了早先那条 `shiftStoryDateOnly`，全仓没人调用）：
 *   · **这个** ＝ 日期 ＋ 已记日期（**留住周期锚点** ⇒ 周期第几天跟着退 ✓）
 *   · `shiftDateBackward` ＝ 连周期锚点一起搬（周期第几天**不变** ✓）
 * ⚠️ 一样**不结算**（往回退不该生出新账 ✓）
 * @returns {{ok:boolean, error?:string, days?:number, from?:string, to?:string, moved?:number}}
 */
export function shiftDateBackwardFull(days) {
    const want = Math.round(Number(days));
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '天数要填 1 以上的整数' };
    if (!inRealChat()) return { ok: false, error: '还没进聊天（或这个聊天里还没有正文），退时间没有地方可落' };
    const from = currentDate();
    if (!from) return { ok: false, error: '这个聊天还没有剧情日期，先让推演跑一轮再来退' };
    // 退到历法第一天之前 ⇒ 拒（判不出来也只许拒，绝不半搬 ✓）
    let elapsed = null;
    try { elapsed = diffDays(FICTION_DATE_START, from); } catch { elapsed = null; }
    if (elapsed === null || elapsed < want) {
        return { ok: false, error: '退不了那么多：再退就早于历法第一天（' + FICTION_DATE_START + '）了' };
    }
    const to = addDays(from, -want);
    if (!to) return { ok: false, error: '退不动：日期算不出来' };
    const s = state();
    // 预检与真搬走**同一张跳过清单** ⇒ 不会漂 ✓
    const clipped = _datesClippedByShift(s, -want, null, _KEEP_ANCHOR_KEYS);
    if (clipped.length) {
        return {
            ok: false,
            error: '退不了那么多：更早的记录会掉到历法第一天之前（' + clipped.length
                + ' 处，最早的是 ' + clipped[0].from + '）',
        };
    }
    const moved = _shiftChatDatesByDays(s, -want, null, _KEEP_ANCHOR_KEYS);
    setCurrentDate(to, dateMode() === 'story' ? 'story' : 'fiction');
    commit();
    return { ok: true, days: want, from, to, moved };
}

// ---------------------------------------------------------------------------
// ★ 时间往回走**只有两条路**（2026-10-31 清掉第三条：`shiftStoryDateOnly` 全仓没人调用，
//   界面实际走的是下面这条 `shiftDateBackwardFull` ⇒ 删了，别再加回来）：
//   · `shiftDateBackward`      ＝ 只挪日历（周期第几天**不变** ✓）
//   · `shiftDateBackwardFull`  ＝ 日期 ＋ 已记日期一起挪（**留住周期锚点** ⇒ 周期第几天跟着退 ✓）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ★ 周期状态：**每个对象一份**
//
// ⚠️ 不许"整个聊天一份「上次月经日」" ✗ ——
//   "剧情时间是整个世界共用的"那句话**只对日期成立**，
//   对"某人的上次月经"不成立：一个聊天里两个能怀孕的对象会共用同一天、阶段完全同步 ✗
//
// ⇒ 现在每个对象自己记两样（都按聊天存，因为它是**相对剧情时间**算的 ✓）：
//   · `cycleDay`   —— 那一刻他处于周期第几天
//   · `cycleDayAt` —— 这个天数是**哪一天**记的（锚点；初始化时剧情日期可能还没有 ⇒ 留空，之后补上 ✓）
//   ⇒ 今天第几天 = cycleDay + （今天 − cycleDayAt）
//
// ★ 「上次月经日」**不单独存**，它是**算出来的**（今天 − (第几天 − 1)）—— 少一个真相 ✓
// ★ **初始化不算上次经期**（生理阶段初始化的时候上次经期可以不用算 ✓）：虚拟日历从 1年01月01日 起算、往前没有日期了，
//   所以剧情日期还没走够天数时，它就是「还没记录」（返回空串 ✓）
// ---------------------------------------------------------------------------

/** 这个对象的周期状态（没有就返回 null）：{ day, at } */
export function cycleStateOf(key) {
    const t = state().targets?.[key];
    const day = Number(t?.cycleDay);
    if (!Number.isFinite(day) || day <= 0) return null;
    return { day: Math.round(day), at: String(t?.cycleDayAt || '') };
}

/**
 * 把这个对象的周期拨到第几天（`at` 不给就用当前剧情日期 ✓）。
 * ⚠️ 这个函数**只被"玩家手改"和"收下剧情报的日期"这两处调用** ——
 *   改参数（周期长度 / 排卵日 / 经期天数）**永远不许**走到这里 ✗（红线 ✓）
 */
export function setCycleDayOf(key, day, at) {
    const t = state().targets?.[key];
    if (!t) return false;
    const n = Math.round(Number(day));
    if (!Number.isFinite(n) || n <= 0) return false;
    t.cycleDay = n;
    t.cycleDayAt = String(at || currentDate() || '');
    commit();
    return true;
}

/** 今天这个对象处于周期第几天（算不出来返回 null —— 别把 null 当 0 ✗） */
export function cycleDayNow(key) {
    const st = cycleStateOf(key);
    if (!st) return null;
    const cur = currentDate();
    // 剧情没给日期 / 还没记过锚点 ⇒ 不推进（"剧情没说就不推进" ✓）
    if (!cur || !st.at) return st.day;
    const d = diffDays(st.at, cur);
    return d === null ? st.day : st.day + d;
}

/**
 * ★★ **周期日只有一个来源** —— 插件自己按剧情日期算的那一个
 *   （`cycleDayNow()`：上次月经日锚点 ＋ 今天 − 锚点）。
 *
 *   以前这里读契约里的 `Time_Scale`（AI 每轮报它自己的日号），那跟插件自己算的
 *   是**同族两来源** ⇒ 两边一漂移，阶段 / 孕周 / 批次日期 / 受精窗口就对不上 ✗。
 *   现在契约**不再问这一格**了，所有消费方都走这个函数 ✓
 *
 * @returns {number|null} null = 还没有周期状态 / 读不到 ⇒ 调用方自己决定怎么办，**别拿轮次顶上** ✗
 */
export function cycleDayNum(key) {
    try {
        const d = cycleDayNow(key);
        if (d === null || d === undefined || d === '') return null;
        const n = Number(d);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}

/**
 * 「上次月经日」= 今天 − (第几天 − 1)，**算出来的**。
 * @returns {string} 空串 = 还没记录（落不到日历里 / 剧情日期还没走够 ✓）
 */
export function cycleStartDateOf(key) {
    const day = cycleDayNow(key);
    const cur = currentDate();
    if (!day || !cur) return '';
    const back = day - 1;
    if (back <= 0) return cur;
    const fromStart = diffDays(FICTION_DATE_START, cur);
    if (fromStart === null || back > fromStart) return '';   // 初始化不算上次经期 ✓
    return addDays(cur, -back);
}

/**
 * ★★ 「预计下次月经」—— 给主 API 的**一条事实**（不是结论 ✓）。
 *
 * 为什么需要它：主 API 写正文时手上只有"今天周期第几天"，
 *   时间一跳，它就不知道这一跳会不会跨过月经 ⇒ 正文和面板必然打架，
 *   或者它只能自己编一个日子 ✗（她 2026-10-28 问"周期是不是也要兼容时间跳跃"）
 *
 * 口径：下一次「第 1 天」＝ 结算点那天（`cycleSettleDayOf`），
 *   跟推演里的到点结算**同一个数** ⇒ 正文里写的那次月经和账本落的是同一天 ✓
 *
 * 不给的三种情况（这几种下一次不一定准时来，给了就是让她去写一个会打架的事实 ✗）：
 *   · 不是「有月经」那一档（非月经 / 无月经没有月经这回事）
 *   · 已经怀孕（孕期不来月经）
 *   · 受精成功、着床判定还没出（那一次到底成不成还没定）
 *
 * @returns {{date:string, days:number}|null} days ＝ 距今几天（1 起步）
 */
export function nextPeriodFactOf(key) {
    try {
        if (!key) return null;
        if (periodModeOf(key) !== 'normal') return null;
        const t = state().targets?.[key];
        if (!t) return null;
        if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() === 'true') return null;
        let j = null;
        try { j = getOvuJudgment(key); } catch { j = null; }
        if (j && j.passed === true && !j.implantJudge) return null;
        const day = cycleDayNow(key);
        const cur = currentDate();
        if (!day || !cur) return null;
        let ovu = 14;
        try { ovu = Number(bodyCycleParamsOf(key)?.ovu) || 14; } catch { ovu = 14; }
        const left = Math.round(cycleSettleDayOf(ovu) - day);
        if (!(left >= 1)) return null;                    // 已经到（或过了）结算点 ⇒ 不假造一个负数 ✓
        const date = addDays(cur, left);
        if (!date) return null;
        return { date, days: left };
    } catch { return null; }
}

/**
 * ★ 「新存档起始」的规则（**按人**）。
 *
 * 剧情里面的 NPC，周期可以随机 ROLL；但玩家不一样 ——
 *   玩家要自己设置、自由度高。同时 NPC 的数据也要能编辑
 *   （"改数值"里可以改，所以这一点不用额外担心）✓
 * ⇒ **用户本人**：默认"指定"（不随机），天数 0 = 自动取卵泡中期 ✓
 * ⇒ **剧情里的 NPC**：默认**随机 ROLL** 一天 ✓（玩家要改就进「改数值」改当前第几天）
 * 存哪照老规矩：本人 ⇒ 全局设置（`userCycleStartRandom / userCycleStartDay`，穿所有聊天 ✓）；
 *               NPC ⇒ 本聊天档案（对象身上的 `cycleStartRandom / cycleStartDay` ✓）
 * ⚠️ 它只管「**还没定过起始**的人」；已经在跑的那个人去「改数值」里改当前第几天 ✓
 */
export function cycleStartRuleOf(key) {
    if (!key) return { random: false, day: 0 };
    if (isUserKey(key)) {
        const s = settings();
        return {
            random: s.userCycleStartRandom === true,
            day: Math.max(0, Math.round(Number(s.userCycleStartDay) || 0)),
        };
    }
    const t = state().targets?.[key];
    const raw = t?.cycleStartRandom;
    return {
        // NPC 没单独设过 ⇒ **默认随机** ✓
        random: raw === undefined ? true : raw === true,
        day: Math.max(0, Math.round(Number(t?.cycleStartDay) || 0)),
    };
}

/** 改某个人的「新存档起始」规则（只给的那一项会覆盖，没给的沿用 ✓） */
export function setCycleStartRuleOf(key, patch = {}) {
    if (!key) return false;
    const cur = cycleStartRuleOf(key);
    const random = (patch.random === undefined) ? cur.random : patch.random === true;
    const day = (patch.day === undefined) ? cur.day : Math.max(0, Math.round(Number(patch.day) || 0));
    if (isUserKey(key)) {
        const s = settings();
        s.userCycleStartRandom = random;
        s.userCycleStartDay = day;
        save();                      // ★ 全局：立刻落盘，换聊天不丢 ✓
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    t.cycleStartRandom = random;
    t.cycleStartDay = day;
    commit();
    return true;
}

/**
 * 保证这个对象有一份周期状态（**只种一次**：已经有值就一个字都不动 ✓）。
 *   · 没有 ⇒ 按这个人的「新存档起始」规则种上（NPC 默认**随机**、本人默认**指定** ✓）
 *   · 有值但还没记过锚点（建档时剧情日期还没有）⇒ 把当前日期补成锚点 ✓
 * @returns {boolean} 真的写入了没有
 */
export function ensureCycleState(key) {
    const t = state().targets?.[key];
    if (!t) return false;
    const cur = currentDate() || '';
    if (cycleStateOf(key)) {
        if (!String(t.cycleDayAt || '') && cur) { t.cycleDayAt = cur; commit(); return true; }
        return false;
    }
    let day = 1;
    try {
        const rule = cycleStartRuleOf(key);
        day = rule.random ? randomCycleStartDay(key) : defaultCycleStartDay(key, rule.day);
    } catch { day = 1; }
    // ★ 2026-10-26：记录里要能标「第几个周期」（仅状态导入的记录靠它定位）
    if (!Number.isFinite(Number(t.cycleNo)) || Number(t.cycleNo) < 1) t.cycleNo = 1;
    t.cycleDay = Math.max(1, Math.round(Number(day) || 1));
    t.cycleDayAt = cur;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// 骰值
//
// 清单本身（有哪些骰子、叫什么、骰式是什么）是偏好设置，放全局设置里；
// 这里只存「这个聊天里掷出来的值」，所以换聊天不会带着别人的骰值。
// ---------------------------------------------------------------------------

export function diceValues() {
    const s = state();
    if (!s.rolls.values || typeof s.rolls.values !== 'object') s.rolls.values = {};
    return s.rolls.values;
}

export function setDiceValue(id, v) {
    const vals = diceValues();
    if (v == null) delete vals[id];
    else vals[id] = v;
    commit();
}

export function clearDiceValues() {
    state().rolls.values = {};
    commit();
}

export function setPoolLocked(v) {
    state().rolls.locked = !!v;
    commit();
}

export function poolLocked() {
    return !!state().rolls.locked;
}

/** 随机数池（池模式下用） */
export function rollPool() {
    return state().rolls.pool || null;
}

export function setRollPool(p) {
    const s = state();
    s.rolls.pool = p;
    s.rolls.at = Date.now();
    commit();
}

/** 上一轮推演取用了哪些随机数（审计用） */
export function lastRollUsage() {
    return state().rolls.lastUsed || null;
}

export function setLastRollUsage(u) {
    state().rolls.lastUsed = u || null;
    commit();
}

// ---------------------------------------------------------------------------
// 历史快照（供面板的「历史 / 置顶」功能读）
// 只有在真正处于某个聊天里、并且聊天里已经有正文时才会记录，
// 避免在角色选择页 / 空白页乱刷新。
// ---------------------------------------------------------------------------

/** 当前是否真的在一个有内容的聊天里 */
export function inRealChat() {
    try {
        const c = getCtx();
        if (!c) return false;
        if (!c.chatId) return false;
        const chat = Array.isArray(c.chat) ? c.chat : [];
        return chat.some(m => m && typeof m.mes === 'string' && m.mes.trim());
    } catch { return false; }
}

/**
 * 当前是不是停在某个聊天页面（哪怕这个聊天里还没有正文）。
 *
 * ⚠️ 它和 inRealChat() **不是一回事**，别混用：
 *   inRealChat() = 在一个「已经有正文」的聊天里 ⇒ 有没有状态可推演 / 可更新
 *   inChatPage() = 就在某个聊天页里（有 chatId）⇒ 这份数据属于这个聊天
 *
 * 随手记要按聊天分账，判据必须是这个 —— 拿 inRealChat() 当判据的话，
 * 刚开的新聊天（还没有正文）会被当成「非聊天页面」，随手记就显示成全局那份 ✗
 * （明明在聊天内、显示出来的却是全局那份，真因就是它）
 */
export function inChatPage() {
    try {
        const c = getCtx();
        return !!(c && c.chatId);
    } catch { return false; }
}

// ---------------------------------------------------------------------------
// ★★ 楼层下标对账
//
// 为什么需要：酒馆发 `MESSAGE_DELETED` 时**带的不是"被删掉的那一楼"** ——
//   它带的是**删完之后**的 chat.length（script.js 里四个发事件的地方都是这么写的 ✗）。
//   删最后一楼时这两个数恰好相等 ⇒ 这个洞不会暴露；
//   **删中间某一楼**时它等于"最后一楼的下标"⇒ 会去清最后一楼的记录、
//   真正被删那一楼的记录原样留着，而且 `excluded`（不参与推演的标记）
//   不会跟着往前挪 ⇒ 标记漂到别的楼层上 ✗
//
// ⇒ 做法：自己记一份"每一楼长什么样"的指纹，删消息时拿**删之前**那份和现在这份比一遍，
//   反推出真正被删的是哪一楼 ✓
//   ⚠️ 只在"确实只少了一楼、而且少掉之后尾部能对上"时才认这个结论；
//     对不上（还没对过账 / 一次删了好几楼 / 中间还有别的改动）就退回酒馆给的那个数
//     —— 也就是**老行为**，至少"删最后一楼"这条主路它是准的 ✓
// ---------------------------------------------------------------------------

let _floorIds = null;   // string[] | null；null = 还没对过账（这时不猜）

function floorIdsOfChat() {
    try {
        const chat = getCtx()?.chat;
        if (!Array.isArray(chat)) return null;
        return chat.map((m) => (m && m.is_user ? 'u:' : 'a:') + hashText(m?.mes ?? ''));
    } catch { return null; }
}

/** 记下"现在聊天里每一楼的指纹"（换聊天 / 收到新楼 / 切候选 / 生成结束都该调一次） */
export function syncFloorIds() {
    _floorIds = floorIdsOfChat();
    return Array.isArray(_floorIds) ? _floorIds.length : 0;
}

/**
 * 反推「被删掉的是哪一楼」。
 * @param {number|undefined} reported 酒馆事件带给我们的那个数（= 删完之后的 chat.length，不是真下标 ✗）
 * @returns {number} 真的被删掉的那一楼；推不出来时退回 reported
 */
export function resolveDeletedFloor(reported) {
    const now = floorIdsOfChat();
    const prev = _floorIds;
    _floorIds = now;      // 不管认不认得出，先把最新那份记下 ✓
    const fallback = Number.isFinite(Number(reported)) ? Number(reported) : -1;
    if (!Array.isArray(now) || !Array.isArray(prev)) return fallback;
    if (prev.length !== now.length + 1) return fallback;
    for (let i = 0; i < now.length; i++) {
        if (prev[i] === now[i]) continue;
        // 第一个不一样的地方就是"被删的那一楼"——
        // 但要确认尾部能整体对上，免得把"某一楼被改过"认成"被删" ✗
        let aligned = true;
        for (let j = i; j < now.length; j++) { if (prev[j + 1] !== now[j]) { aligned = false; break; } }
        return aligned ? i : fallback;
    }
    return now.length;    // 前面全都一样 ⇒ 删的是最后一楼
}

/** 这一楼是不是被排除在推演之外 */
export function isExcluded(idx) {
    const s = state();
    return Array.isArray(s.excluded) && s.excluded.includes(idx);
}

/** 设置某一楼的排除状态 */
export function setExcluded(idx, off) {
    const s = state();
    if (!Array.isArray(s.excluded)) s.excluded = [];
    const at = s.excluded.indexOf(idx);
    if (off && at < 0) s.excluded.push(idx);
    else if (!off && at >= 0) s.excluded.splice(at, 1);
    s.excluded.sort((a, b) => a - b);
    commit();
}

/**
 * ★★ 回滚检查点 —— 解决「重新 ROLL / 换分支时同一段剧情被算两次」
 *
 * 酒馆支持重新 ROLL：重新生成相当于覆盖，之前的正文也就没了；
 *   另外酒馆支持一层里放多个回复，这种情况也要兼容 ✓
 *   ⇒ 采用 **回滚重算** ✓
 *   ★ "重新生成相当于覆盖"这一点是对的（别把它的行为和"切换备选回复"混了 ✗）：
 *     重新生成 = 酒馆先把那一楼删掉再生成新的（script.js 的 Generate 里 `chat.length - 1`＋MESSAGE_DELETED）
 *     ⇒ **旧正文不会留成候选**；而"备选回复"（swipe）那条路才是不删、留着的 ✓
 *
 * 为什么必须回滚：我们的数值是**累加**的（内射、累计受孕率、身体痕迹、判定都是往上叠的），
 *   而"重新生成"在酒馆里就是**又一次生成** ⇒ 结束后照常自动推演 ⇒
 *   模型拿到的【上一轮状态】已经是**算过一遍之后**的了 ⇒ 同一段剧情被算两次 ✗
 *   （而且快照也会同一楼追加两条，时光机里多出一条"幽灵分支"✗）
 *
 * ⇒ 做法：每次推演**之前**先存一份"这一楼之前的状态"；
 *   下次发现"还是同一楼"（重新生成 / 换分支 / 手改这一楼）⇒ **先回滚，再按新正文重算** ✓
 *   ⇒ 同一楼反复 ROLL 也永远从同一个起点重来，账不会越滚越多 ✓
 *
 * ⚠️ 只留**最近一份**：能"重新生成"的只可能是最后一楼，旧的那份用不上 ✓
 * ⚠️ `snapshots` / `checkpoint` / `floorCandidates` 都不进 `data`（快照另存；后两个进了会自我嵌套 ✗）
 */

/** 正文指纹：认"这一条候选算过没有"。带上长度，减少碰撞 ✓ */
export function hashText(text) {
    const t = String(text || '');
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36) + '_' + t.length;
}

/**
 * ★★ 清掉「对不上现有正文」的快照（2026-10-23 她定的口径，事件兜底）——
 *
 * 判据只看**指纹还活不活着**：
 *   · 这一楼现在的那条消息还剩哪些候选（当前正文 ＋ 它自己的 swipes），指纹对得上 ⇒ 留 ✓
 *   · 这一楼整个没了 / 指纹一条都对不上（典型＝重新生成把旧正文换掉了）⇒ 删 ✗
 *
 * 为什么要有它：删楼那条事件不一定抓得住（认不出楼层号、事件没发、落盘被守卫挡住…），
 *   光靠事件删就会留下"挂着但不属于任何正文"的快照 ⇒ 时光机里出现对不上号的记录 ✗
 *   ⚠️ 老快照没指纹 ⇒ **一律不动**（认不出就保守留着，别误删 ✓）
 *   ⚠️ 拿不到聊天 ⇒ 也**一律不动**（宁可不删，别把她数据删了 ✗）
 *
 * @returns {number} 删了几条
 */
export function pruneOrphanSnapshots() {
    const s = state();
    if (!Array.isArray(s.snapshots) || !s.snapshots.length) return 0;
    let chat = [];
    try { chat = getCtx()?.chat || []; } catch { chat = []; }
    if (!Array.isArray(chat) || !chat.length) return 0;
    const aliveOf = (floor) => {
        const cur = chat[Number(floor)];
        if (!cur) return null;                 // 这一楼已经不存在
        const set = new Set();
        const add = (t) => { const h = hashText(String(t || '')); if (h) set.add(h); };
        add(cur.mes);
        if (Array.isArray(cur.swipes)) for (const sw of cur.swipes) add(sw);
        return set;
    };
    const before = s.snapshots.length;
    const cache = {};
    s.snapshots = s.snapshots.filter((sn) => {
        const f = Number(sn?.messageIndex);
        const h = String(sn?.hash || '');
        if (!Number.isFinite(f) || f < 0) return true;
        if (!h) return true;                   // 没有指纹的老快照，认不出 ⇒ 不动
        if (!(f in cache)) cache[f] = aliveOf(f);
        const set = cache[f];
        if (!set) return false;                // 这一楼没了
        return set.has(h);                     // 指纹还在不在
    });
    const n = before - s.snapshots.length;
    if (n) commit();
    return n;
}

/**
 * ★ 改数值之后，把**最后一楼**那份快照的面板文字跟着改过来（2026-10-23 她报的）。
 *
 * 为什么：楼层面板的「本楼状态」读的是 `snapshots` 里那一楼存下的 `raw`（推演当时的面板文字）。
 *   改数值改的是**当前状态**，不会重新推演 ⇒ 快照还是旧的，看着像"改了没反应" ✗
 * ⇒ 只同步**最后一楼、且正文指纹对得上**的那份快照（还有同楼的候选记录），
 *   历史楼层一个字不动；拿不到正文 / 对不上指纹 ⇒ 一条都不改 ✓
 * @returns {number} 改了几份
 */
export function syncLastFloorSnapshot() {
    let chat = [];
    try { chat = getCtx()?.chat || []; } catch { chat = []; }
    if (!Array.isArray(chat) || !chat.length) return 0;
    const idx = chat.length - 1;
    const cur = chat[idx];
    if (!cur || cur.is_user) return 0;                 // 最后一楼是玩家发言 ⇒ 还没有快照
    const h = hashText(String(cur.mes || ''));
    if (!h) return 0;
    const raw = {};
    for (const t of targetList()) {
        if (t.light === true) continue;
        raw[t.key] = t.raw || '';
    }
    if (!Object.values(raw).some(Boolean)) return 0;
    const s = state();
    let n = 0;
    if (Array.isArray(s.snapshots)) {
        const active = s.targets?.[s.active] || null;
        for (const x of s.snapshots) {
            if (Number(x?.messageIndex) !== idx) continue;
            if (String(x?.hash || '') !== h) continue;
            if (JSON.stringify(x.raw) === JSON.stringify(raw)) continue;
            x.raw = raw;
            if (active) x.sub = String(active.profile?.sub ?? x.sub ?? '');
            // ★ 日期那份也跟着现在的剧情日期走（不然这一楼的「剧情时间」还停在旧那天）
            try { x.date = String(currentDate() || x.date || ''); } catch { /* 忽略 */ }
            n++;
        }
    }
    const c = s.floorCandidates?.[String(idx)]?.[h];
    if (c && JSON.stringify(c.raw) !== JSON.stringify(raw)) { c.raw = raw; n++; }
    if (n) commit();
    return n;
}

/**
 * ★★ 2026-10-28（她报：快照里 d5 还是旧状态，这种是 BUG）——
 *   一次性修掉**旧快照**里晚了一轮的 d5。
 *
 * 为什么会有：同一轮里 d5 在 awareness_event 写进去**之前**就拼好了
 *   ⇒ 确认 / 怀疑发生的那一楼，存进快照的还是上一档。
 * 怎么认：d5 的前半截只会往前走（未察觉 → 怀疑 → 已确认）⇒
 *   如果**下一楼**已经比这一楼高，那这一楼就是晚了一轮的那一楼，用下一楼的值补上。
 *   · 只改「数据项五」那一行，别的字一个不动 ✓
 *   · 只往前挪（下一楼不比这一楼高就跳过）—— 分娩后回到「未加载」不会被误改 ✓
 *   · 只处理**已经怀上**的楼层（前半截是状态词），没怀的那段不碰 ✓
 * @returns {number} 改了几份快照
 */
export function repairStaleSnapshotD5() {
    try {
        if (!inRealChat()) return 0;
        const s = state();
        if (Number(s.snapD5FixV) >= 1) return 0;
        s.snapD5FixV = 1;
        const snaps = Array.isArray(s.snapshots) ? s.snapshots : [];
        if (!snaps.length) { commit(); return 0; }
        const rankOf = (text) => {
            const st = String(text || '').split(/[·・]/)[0].trim();
            if (st === '已确认怀孕') return 3;
            if (st === '怀疑但未确认') return 2;
            if (st === '未察觉') return 1;
            return 0;
        };
        const lineOf = (raw) => {
            const m = String(raw || '').match(/^数据项五[：:].*$/m);
            return m ? m[0] : '';
        };
        const textOf = (line) => {
            const i = String(line || '').search(/[|｜]/);
            return (i >= 0 ? String(line).slice(i + 1) : String(line).replace(/^数据项五[：:]/, '')).trim();
        };
        const setLine = (raw, text) => String(raw || '').replace(/^数据项五[：:].*$/m, `数据项五：意识状态 | ${text}`);
        // 每个对象一份：它出现在哪些快照里
        const byKey = new Map();
        for (const snap of snaps) {
            if (!snap || !snap.raw || typeof snap.raw !== 'object') continue;
            for (const [k, raw] of Object.entries(snap.raw)) {
                if (!lineOf(raw)) continue;
                if (!byKey.has(k)) byKey.set(k, []);
                byKey.get(k).push(snap);
            }
        }
        let n = 0;
        for (const [k, list] of byKey) {
            const arr = list.slice().sort((a, b) => (Number(a.messageIndex) - Number(b.messageIndex)) || (Number(a.ts) - Number(b.ts)));
            // 先把原来的值抄下来（边改边读会串味）
            const lines = arr.map((x) => lineOf(x.raw[k]));
            for (let i = 0; i < arr.length - 1; i++) {
                const curText = textOf(lines[i]);
                const nextText = textOf(lines[i + 1]);
                const cur = rankOf(curText);
                const next = rankOf(nextText);
                if (cur < 1 || next <= cur) continue;   // 没怀 / 没往前 ⇒ 不是晚一轮那一楼
                if (!nextText || nextText === curText) continue;
                arr[i].raw[k] = setLine(arr[i].raw[k], nextText);
                n++;
            }
        }
        if (n) commit();
        if (n) console.log('[Bodycord] 修好了 ' + n + ' 份晚一轮的意识状态快照');
        return n;
    } catch (e) {
        console.warn('[Bodycord] 修晚一轮的快照失败', e);
        return 0;
    }
}


/**
 * ★ 改了某一楼的正文之后，把这一楼的记录从旧指纹挪到新指纹上（2026-10-23）。
 *
 * 根因：候选记录与时光机快照都按**正文指纹**认"这是哪一条候选"。
 *   正文一改，指纹就变了 ⇒ 记录对不上任何正文：
 *   楼层面板显示"本楼暂无推演记录"，下一次 `pruneOrphanSnapshots()` 还会把它当孤儿删掉 ✗
 *   （她报的"修改正文之后记录丢失"就是这个）
 * ⇒ 只换指纹（键），记录内容一个字不动；按楼层 + 当前候选号认是哪一条。
 *   认不准（同层多条、又没有候选号）就一条都不动 ✓
 */
export function rekeyEditedFloor(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) return 0;
    let msg = null;
    try { msg = getCtx()?.chat?.[f] || null; } catch { msg = null; }
    if (!msg) return 0;
    const newHash = hashText(String(msg.mes || ''));
    if (!newHash) return 0;
    const sw = (msg.swipe_id === null || msg.swipe_id === undefined) ? null : Number(msg.swipe_id);
    const s = state();
    let n = 0;
    // ① 时光机快照
    if (Array.isArray(s.snapshots)) {
        const mine = s.snapshots.filter((x) => Number(x?.messageIndex) === f);
        for (const x of mine) {
            const xs = (x.swipe === null || x.swipe === undefined) ? null : Number(x.swipe);
            const same = (xs !== null && sw !== null) ? xs === sw : (mine.length === 1);
            if (!same) continue;
            if (String(x.hash || '') === newHash) continue;
            x.hash = newHash;
            n++;
        }
    }
    // ② 楼层候选记录
    const bag = s.floorCandidates?.[String(f)];
    if (bag) {
        const keys = Object.keys(bag);
        const hit = keys.filter((k) => {
            const e = bag[k] || {};
            const es = (e.swipe === null || e.swipe === undefined) ? null : Number(e.swipe);
            return (es !== null && sw !== null) ? es === sw : (keys.length === 1);
        });
        for (const k of hit) {
            if (k === newHash || bag[newHash]) continue;
            bag[newHash] = bag[k];
            delete bag[k];
            n++;
        }
    }
    if (n) commit();
    return n;
}

/** 深拷贝一份"可回滚的状态"（去掉快照 / 检查点 / 候选记录 / 回滚点这几样"书架"） */
function cloneStateForRecord() {
    const s = state();
    const data = {};
    for (const [k, v] of Object.entries(s)) {
        if (SHELF_KEYS.has(k)) continue;
        data[k] = v === undefined ? null : JSON.parse(JSON.stringify(v));
    }
    return data;
}

/**
 * ★ "书架"：它们**不是内容**，回滚时一律不动 ✓
 *   ⚠️ `rollbackPoints` / `rollbackUndo` 必须也在这儿 ——
 *     不然"回滚点里再装一份回滚点"会**指数级膨胀** ✗（而且撤销的那份也会被自己覆盖掉 ✗）
 */
const SHELF_KEYS = new Set(['snapshots', 'checkpoint', 'floorCandidates', 'rollbackPoints', 'rollbackUndo',
    // ★ 2026-10-23：**冻结标记不能跟着恢复一起被抹掉** ——
    //   她报"设为未孕后又变回已孕"的真因就在这：`applyStateData` 会把不在记录里的键全删掉，
    //   于是 conceiveHold 被删、孕和提醒又被候选/回滚点带回来 ✗
    'conceiveHold']);

/** 这个对象的「已孕」那一格是不是 true */
function _pregFlag(t) {
    return String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true';
}

/**
 * ★★ 这个对象现在算不算**孕期**（口径 2026-10-30 定）。
 * 子宫那本账的"能不能进"只认这一个判据。
 *
 * 为什么要有它：以前 `in_womb`（模型报"射进子宫"）和「射满就溢进子宫」两条路
 *   都不看怀没怀 ⇒ 孕期照样把子宫那档推上去，清洗还能把它降一档，
 *   等于承认孕期的子宫里能灌进精液 ✗ 现实里不可能（宫颈被粘液栓封着，
 *   而且精浆本来就进不了子宫腔）。
 * ⇒ 口径：孕期子宫那本账**恒为空**，读写两头都封（存入值也一起按空处理）。
 * ⚠️ 判据只此一处：别在调用点各写一遍 `Is_Pregnant === 'true'`，
 *   漏一处就是孕期子宫又涨回去了 ✗
 */
export function pregnantNowTarget(t) {
    if (!t) return false;
    if (_pregFlag(t)) return true;
    // 兜底：身份标题写着孕期 / 妊娠（和 prompt.js 的 isPregnant 同一套判据）
    return /孕期|妊娠/.test(String(t?.profile?.title || ''));
}

/** 同上，按对象 key 查（目标必须已在 state 里） */
export function pregnantNowOf(key) {
    return pregnantNowTarget(state().targets?.[String(key || '')]);
}

/**
 * ★★ 2026-10-23（她追问「是不是推演一次就把握床成功率锁死了」）——
 * 撤掉这些对象**当前那条判定**里的着床结果（判定值 / 成没成），让它到日子**重新掷**。
 *
 * 为什么必须撤：判定里留着 `implantPassed = true` ⇒ ①`settleImplantFor` 见到"已经判过"
 *   连骰都不掷；②`syncPregnancyState` 见到"着床成功 + 日子到了"就直接把人切成已孕。
 *   而这条结果往往来自**被撤销掉的那个世界**（候选/回滚快照带回来的）⇒ 等于 100% 必中，
 *   正文里那条 80%（或玩家自定义）的着床率被整段跳过 ✗
 *
 * ⚠️ 只删「着床判定 / 着床成没成」两格：`implantDays` / `doneDate` 留着 ——
 *   它们是「哪天揭晓」，不揭示成败 ✓
 * @returns {number} 撤了几条判定
 */
function _voidImplantOutcomes(keys) {
    const s = state();
    const set = new Set((keys || []).map(String));
    const seen = new Set();
    let n = 0;
    const one = (rec) => {
        if (!rec || seen.has(rec) || !set.has(String(rec?.target || ''))) return 0;
        seen.add(rec);
        if (rec.implantPassed === undefined && rec.implantJudge === undefined) return 0;
        delete rec.implantJudge;
        delete rec.implantPassed;
        return 1;
    };
    if (Array.isArray(s.ovuJudgments)) for (const rec of s.ovuJudgments) n += one(rec);
    n += one(s.ovuJudgment);
    return n;
}

/**
 * 就地套用一份记录。
 * ⚠️ **不换掉整个状态对象** —— 别处（面板 / 监听器）可能正握着它的引用 ✓
 * ⚠️ 快照 / 检查点 / 候选记录 / 回滚点这几样**不动**：它们是"书架"，不是"内容" ✓
 *
 * ★★ 2026-10-23（她报：撤销/回滚之后孕、提醒、胎儿行又一起回来）——
 *   **冻结期（`conceiveHold`）恢复任何整份记录，都要过一道"那一胎不许回来"的闸**。
 *   做法不再是在恢复完再分别补刀（补一处漏一处，实测漏了提醒 / d6 / 着床结果），
 *   而是按**对象**判：
 *   · 快照里"那个对象还怀着"、但现在这份状态里没怀 ⇒ **这个对象整份不套用**，
 *     保留冻结期现在这一份（孕 / 提醒 / d6 胎儿行 / 胎数判定 / 周期日 / 面板文字全都不动 ✓）
 *   · 那条判定也按对象换回现在这份 —— 尤其不能把"着床成功"带回来（见 `_voidImplantOutcomes`）
 *   · 本来就怀着别的对象（快照和现在都是已孕）⇒ 照旧恢复，不误伤 ✓
 */
function applyStateData(data) {
    const s = state();
    const hold = s.conceiveHold === true;
    // 冻结期才需要抓现场（恢复很频繁，别让正常路径多付一份深拷贝）
    const pre = hold ? {
        targets: JSON.parse(JSON.stringify(s.targets || {})),
        alerts: JSON.parse(JSON.stringify(Array.isArray(s.alerts) ? s.alerts : [])),
        judgments: JSON.parse(JSON.stringify(Array.isArray(s.ovuJudgments) ? s.ovuJudgments : [])),
        single: s.ovuJudgment ? JSON.parse(JSON.stringify(s.ovuJudgment)) : null,
        active: s.active || '',
        panelUpdate: s.panelUpdate ? JSON.parse(JSON.stringify(s.panelUpdate)) : null,
    } : null;
    for (const k of Object.keys(s)) {
        if (SHELF_KEYS.has(k)) continue;
        delete s[k];
    }
    Object.assign(s, JSON.parse(JSON.stringify(data || {})));
    if (hold && pre) {
        // 要被按回去的对象：快照说它怀着、冻结期现在说它没怀
        const keep = [];
        for (const [k, t] of Object.entries(s.targets || {})) {
            if (!_pregFlag(t)) continue;
            if (_pregFlag(pre.targets?.[k])) continue;   // 本来就怀着 ⇒ 别误伤
            keep.push(k);
        }
        if (keep.length) {
            const mine = (x) => keep.includes(String(x?.target || ''));
            for (const k of keep) if (pre.targets?.[k]) s.targets[k] = pre.targets[k];
            if (Array.isArray(s.ovuJudgments)) {
                s.ovuJudgments = [...(pre.judgments || []).filter(mine), ...s.ovuJudgments.filter((x) => !mine(x))];
            }
            if (s.ovuJudgment && mine(s.ovuJudgment)) {
                s.ovuJudgment = (pre.single && mine(pre.single)) ? pre.single : null;
            }
            s.alerts = [...(pre.alerts || []).filter(mine),
                ...(Array.isArray(s.alerts) ? s.alerts.filter((x) => !mine(x)) : [])];
            if (keep.includes(String(s.active || pre.active || ''))) {
                s.active = pre.active;
                if (pre.panelUpdate) s.panelUpdate = pre.panelUpdate;
            }
            const voided = _voidImplantOutcomes(keep);
            try {
                console.log('[Bodycord] 冻结期恢复记录：' + keep.map((k) => displayName(s.targets[k]) || k).join('、')
                    + ' 那一胎按回未孕（提醒 / 胎数 / 着床结果都不跟着回来）'
                    + (voided ? '，着床结果撤了 ' + voided + ' 条（到日子重新掷）' : ''));
            } catch { /* 记不上不影响恢复 */ }
        }
    }
    commit();
}

/**
 * ★ 取一份"现在这份状态"的深拷贝。
 *
 * 为什么需要：推演**开始**时会把状态回滚到"这一楼之前"当起点，
 *   万一这次请求失败 / 被取消，就没人把它还原回去了 ⇒
 *   玩家会看到数字**自己往回退**（"涨了又退"属于明确不能接受的负面反馈 ✗）。
 *   ⇒ 跑之前先抓一份，出事就套回去 ✓
 */
export function captureStateData() {
    return cloneStateForRecord();
}

/**
 * 把状态还原成这份深拷贝（不动快照 / 检查点 / 候选记录那三个"书架" ✓）。
 * @param {object} data captureStateData() 抓下来的那份
 * @returns {boolean} 真的还原了没有
 */
export function restoreStateData(data) {
    if (!data || typeof data !== 'object') return false;
    applyStateData(data);
    return true;
}

/** 存一份检查点：记下"这一楼之前"的状态（= 任何一个候选重算时的起点） */
export function setCheckpoint(floor, swipeId = null) {
    const s = state();
    s.checkpoint = {
        floor: Number(floor),
        swipeId: (swipeId === null || swipeId === undefined) ? null : Number(swipeId),
        at: Date.now(),
        data: cloneStateForRecord(),
    };
    // ★★ 顺手往"回滚点"里也放一份（同一份深拷贝，不额外花内存 ✓）——
    //   那是给玩家用的（时光机里「从这里重新开始」⇒ 真倒流 ✓）
    //   ⚠️ 只留最近 ROLLBACK_KEEP 份：每份 ≈ 18 KB（本机实测），6 份 ≈ 108 KB，
    //     跟快照那 1.5 MB 预算比起来很小 ✓
    try {
        const f = Number(floor);
        const pts = (Array.isArray(s.rollbackPoints) ? s.rollbackPoints : [])
            .filter((p) => Number(p?.floor) !== f);          // 同一楼再来一次 ⇒ 覆盖 ✓
        pts.push({ floor: f, swipeId: s.checkpoint.swipeId, at: s.checkpoint.at, data: s.checkpoint.data });
        s.rollbackPoints = pts.slice(Math.max(0, pts.length - ROLLBACK_KEEP));
    } catch (e) { console.warn('[Bodycord] 存回滚点失败', e); }
    // ★ 候选记录只给**最后一楼**留着（能重新生成 / 换候选的只有它）；
    //   换到新的一楼时，把旧楼的候选记录清掉 —— 旧楼的"记录"仍然留在快照里 ✓
    const keep = String(Number(floor));
    for (const k of Object.keys(s.floorCandidates || {})) {
        if (String(k) !== keep) delete s.floorCandidates[k];
    }
    commit();
    return s.checkpoint;
}

/** 回滚点最多留几份（真倒流用） */
const ROLLBACK_KEEP = 6;


/** 这一楼能不能点回去（时光机里那颗按钮灰不灰看它 ✓） */
export function canRollbackTo(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f)) return false;
    return (state().rollbackPoints || []).some((p) => Number(p?.floor) === f);
}

/**
 * ★★ 真倒流：**回到某一楼之前的那份状态**（整份回滚）——
 *   账本 / 孩子 / 痕迹 / 受精判定 / 周期锚点**全都跟着退** ✓
 *   （那段经历要作废，就是契约里 time_jump 的那一格 ✓）
 *
 * ⚠️ 只退**插件的账**，一个字都不碰正文（红线 ✓）—— 剧情怎么处理是玩家自己的事 ✓
 * ⚠️ 动手前先抓一份"现在这份"当保险 ⇒ `undoRollback()` 能整套回来 ✓
 * @returns {{ok:boolean, floor?:number, error?:string}}
 */
export function rollbackToFloor(floor) {
    const f = Number(floor);
    const pts = Array.isArray(state().rollbackPoints) ? state().rollbackPoints : [];
    const p = pts.find((x) => Number(x?.floor) === f);
    if (!p || !p.data) return { ok: false, error: '这一楼的状态没留着（只留最近 ' + ROLLBACK_KEEP + ' 次推演的）' };
    const s = state();
    // 保险先抓（`applyStateData` 不动"书架" ⇒ 它不会被自己删掉 ✓）
    // ★ 2026-10-23：**同一楼退第二次时别覆盖那份保险** ——
    //   退过一次之后再退同一楼，当前这份已经是"退过之后"的了，拿它当撤销点没意义 ✗
    if (!s.rollbackUndo || Number(s.lastRollbackFloor) !== f) {
        s.rollbackUndo = { at: Date.now(), floor: f, data: cloneStateForRecord() };
    }
    applyStateData(p.data);
    // ★ 2026-10-23（她报：时光机撤销了，怎么又冒出已孕）——
    //   撤销之后，除了**她自己再推演一次**，任何自动/时间同步的路都不许再把孕切回来。
    //   这个标记由 `syncPregnancyState` / `settleImplantFor` 认；推演开跑时会清掉 ✓
    s.conceiveHold = true;
    // ★ 2026-10-23：记下"刚退到哪一楼之前" —— 时光机里再点「重推这一楼」时，
    //   已经退过了就别再退一次（再退会覆盖掉「撤销刚才那次回滚」的那份保险 ✗）
    s.lastRollbackFloor = f;
    commit();
    return { ok: true, floor: f };
}

/** 回滚前那份保险还在吗（界面用） */
export function rollbackUndoInfo() {
    const u = state().rollbackUndo;
    if (!u || !u.data) return null;
    return { at: Number(u.at) || 0, floor: Number(u.floor) };
}

/** ★ 撤销刚才那次回滚（把回滚前那一份套回去 ✓；用完就丢，免得反复点绕晕 ✓） */
export function undoRollback() {
    const s = state();
    const u = s.rollbackUndo;
    if (!u || !u.data) return { ok: false, error: '没有可以撤销的回滚' };
    const floor = Number(u.floor);
    // ★ 2026-10-23：**冻结标记必须在套用之前撤掉** ——
    //   撤销"那次回滚"＝要把回滚**前**那个世界整个拿回来（那时候可能正怀着）。
    //   先套用的话，`applyStateData` 会把"快照里怀着、现在没怀"的那个对象按回未孕，
    //   等于撤销回滚只退了一半 ✗
    try { delete s.conceiveHold; } catch { /* 忽略 */ }
    try { delete s.lastRollbackFloor; } catch { /* 忽略 */ }
    applyStateData(u.data);
    try { state().rollbackUndo = null; commit(); } catch { /* 忽略 */ }
    return { ok: true, floor };
}

/** 看一眼检查点是哪一楼的（诊断/界面用；不返回 data，太大） */
export function checkpointInfo() {
    const cp = state().checkpoint;
    if (!cp || !cp.data) return null;
    return { floor: Number(cp.floor), swipeId: cp.swipeId ?? null, at: cp.at || 0 };
}

/**
 * 回滚到检查点（"这一楼之前"）。
 * @returns {number|null} 回滚到的那一楼；没有检查点就返回 null
 */
export function restoreCheckpoint() {
    const s = state();
    const cp = s.checkpoint;
    if (!cp || !cp.data || cp.floor === undefined) return null;
    const floor = Number(cp.floor);
    applyStateData(cp.data);
    return floor;
}

// ---------------------------------------------------------------------------
// ★★ 候选记录（备选回复）
//
// 有备选回复时，一层里生成过的几条候选各自的记录都要存着，
//   不要每次都重新生成；只有手动重新生成推演时才重算 ✓✓
//
// ⇒ 一条候选 = 一份记录（**它自己那套状态** + 它当时的面板文字）：
//   · 切到某条候选 ⇒ 直接读它的记录恢复（**零调用、不烧 token**）✓
//   · 这条候选还没算过 ⇒ 从"这一楼之前"的检查点开始算一次，然后把结果存成它的记录 ✓
//   · 手动点「推演」= 强制重算当前这条，覆盖它自己的记录 ✓
//
// ⚠️ 身份 = **正文指纹**（不是候选号）：重新生成会把整楼删掉重来（候选号又从 0 开始），
//   但正文变了 ⇒ 指纹不同 ⇒ 不会被当成"同一条候选"而误用旧记录 ✓
//   （重新生成 ≠ 切换备选回复，别混 ✗）
// ---------------------------------------------------------------------------

/** 取某条候选的记录（没有就返回 null） */
export function getFloorCandidate(floor, hash) {
    const bag = state().floorCandidates?.[String(Number(floor))];
    if (!bag || !hash) return null;
    return bag[String(hash)] || null;
}

/** 存 / 覆盖某条候选的记录 */
export function setFloorCandidate(floor, hash, payload = {}) {
    const s = state();
    if (!s.floorCandidates || typeof s.floorCandidates !== 'object') s.floorCandidates = {};
    const f = String(Number(floor));
    if (!s.floorCandidates[f]) s.floorCandidates[f] = {};
    s.floorCandidates[f][String(hash)] = {
        swipe: (payload.swipe === null || payload.swipe === undefined) ? null : Number(payload.swipe),
        // 这条候选当时的面板文字（没传就从当前状态里抓一份 ✓）
        raw: payload.raw || (() => {
            const o = {};
            for (const t of targetList()) o[t.key] = t.raw || '';
            return o;
        })(),
        at: Date.now(),
        data: payload.data || cloneStateForRecord(),
    };

    // ★ 上限：同一条楼层最多留 8 份候选记录（每份约 18 KB —— 本机实测）
    //   超了就丢**最早**的那份 ⇒ 之后切到它会重新算一次（花一次调用，但数据不会错 ✓）
    const MAX_CANDIDATES = 8;
    const keys = Object.keys(s.floorCandidates[f]);
    if (keys.length > MAX_CANDIDATES) {
        keys.sort((a, b) => Number(s.floorCandidates[f][a]?.at || 0) - Number(s.floorCandidates[f][b]?.at || 0));
        for (const k of keys.slice(0, keys.length - MAX_CANDIDATES)) delete s.floorCandidates[f][k];
    }
    commit();
    return s.floorCandidates[f][String(hash)];
}

// 注意：「这条候选当时的面板文字」由 `getFloorCandidate()` 的 `raw` 给，
//   面板里那份假聊天记录走的是 `snapshotChat()` ✓

/**
 * 清掉"孤儿候选记录" —— 2026-10-23（她报：撤销之后记录还在，可那一楼在时光机里已经没了、点不到）
 *
 * 判据：某楼层有候选记录、但**一份快照都没有** ⇒ 那条记录没有任何地方能看到/能撤销 ⇒ 清掉 ✓
 * （候选记录只会由推演写入，而推演那一轮末尾必定同时写一条快照；有记录没快照＝旧版撤销留下的残渣）
 * @returns {number} 清掉几楼
 */
export function pruneOrphanCandidates() {
    const s = state();
    const bag = s.floorCandidates;
    if (!bag || typeof bag !== 'object') return 0;
    const snaps = Array.isArray(s.snapshots) ? s.snapshots : [];
    const floorsWithSnap = new Set(snaps.map((x) => String(Number(x?.messageIndex))));
    let n = 0;
    for (const f of Object.keys(bag)) {
        if (floorsWithSnap.has(String(f))) continue;
        delete bag[f];
        n++;
    }
    if (n) commit();
    return n;
}


/**
 * 时光机用：删掉某一楼的**候选记录**（「撤销这次推演」/「重推这一楼」要一起拿走 ✓）。
 * ★ 2026-10-23（她报：从时光机撤销了，那条记录还在）——
 *   撤销只删了快照，`floorCandidates` 里那一楼的记录没动 ⇒ 楼层/推演记录照样显示"这一楼算过了" ✗
 *   认法跟快照一致：楼层 + 正文指纹；只给楼层 = 整楼清掉 ✓
 * @returns {boolean} 真删了没有
 */
export function dropFloorCandidate(floor, hash = null) {
    const s = state();
    const f = String(Number(floor));
    const bag = s.floorCandidates?.[f];
    if (!bag || typeof bag !== 'object') return false;
    if (hash === null || hash === undefined) {
        delete s.floorCandidates[f];
        commit();
        return true;
    }
    const k = String(hash);
    if (!Object.prototype.hasOwnProperty.call(bag, k)) return false;
    delete bag[k];
    if (!Object.keys(bag).length) delete s.floorCandidates[f];
    commit();
    return true;
}

/** 把某条候选的记录恢复成当前状态 */
export function restoreCandidate(floor, hash) {
    const e = getFloorCandidate(floor, hash);
    if (!e || !e.data) return false;
    // ★ 2026-10-23（她报：撤销之后切候选，孕 / 提醒 / 胎儿行一起回来）——
    //   清理收在 `applyStateData` 里做：冻结期按对象判"快照里那一胎还怀着、现在没怀"，
    //   那个对象整份不套用（以前只把孕按回 false，提醒和 d6 就漏了 ✗）✓
    applyStateData(e.data);
    return true;
}

/**
 * ★★ 2026-10-23：冻结期落盘自愈（打开聊天 / 换聊天时跑一次）。
 *
 * 为什么要这一步：上面那道闸只拦"以后"的恢复；**已经被旧版写坏的那份存档**
 *   （未孕却挂着提醒、d6 还写着「单胎；子1…」、判定里躺着"着床成功"）得当场收拾掉，
 *   不然她一刷新还看到「到日子了 … 已着床完成（怀孕）」那个气泡 ✗
 *
 * 判据（只认**自相矛盾**的痕迹，不误伤别的对象）：
 *   · 没怀着，判定里却是 `implantPassed = true`   ⇒ 着床成功该已孕，矛盾
 *   · 没怀着，d6 却写着胎儿行 / 还留着胎数判定     ⇒ 矛盾
 * 命中之后：着床结果作废（到日子重掷）、怀孕提醒删掉、胎儿行归零、胎数 / 血脉标记清掉。
 * ⚠️ 玩家**手填过 d6** 的不动（`isProfileFieldFixed`）—— 那是他的设定，不是插件算出来的 ✓
 * ⚠️ 没着床那条提醒（`implant_fail`）只有在这个对象被判定"痕迹矛盾"时才删；
 *   正常没着床的对象（未孕 + 没着床 + 有提醒）是**自洽**的，不在这儿动 ✓
 * @returns {number} 收拾掉几处
 */
export function healConceiveHold() {
    const s = state();
    if (s.conceiveHold !== true) return 0;
    const bad = [];
    for (const [k, t] of Object.entries(s.targets || {})) {
        if (_pregFlag(t)) continue;                       // 真怀着就不动
        const d6 = String(t?.profile?.d6 ?? '').trim();
        const d6GotFetus = !!d6 && d6 !== '无' && d6 !== '未加载';
        let implantOk = false;
        try {
            const j = getOvuJudgment(k);
            implantOk = (j && j.implantPassed === true) ? true : false;
        } catch { implantOk = false; }
        if (implantOk || d6GotFetus || t.fetusPlan || t.fetusPlanPending) bad.push(k);
    }
    if (!bad.length) return 0;
    let n = _voidImplantOutcomes(bad);
    const beforeAlerts = Array.isArray(s.alerts) ? s.alerts.length : 0;
    if (Array.isArray(s.alerts)) {
        s.alerts = s.alerts.filter((x) => {
            const kind = String(x?.kind || '');
            if (kind !== 'conceive' && kind !== 'implant_fail') return true;
            return !bad.includes(String(x?.target || ''));
        });
    }
    n += beforeAlerts - (s.alerts?.length || 0);
    for (const k of bad) {
        const t = s.targets[k];
        if (!t) continue;
        if (t.fetusPlan) { delete t.fetusPlan; n++; }
        if (t.heritageRolls) { delete t.heritageRolls; n++; }
        if (t.fetusPlanPending) { delete t.fetusPlanPending; n++; }
        if (t.heritageDone) { delete t.heritageDone; n++; }
        if (t.heritageTry) { delete t.heritageTry; n++; }
        if (t.heritageGiveUp) { delete t.heritageGiveUp; n++; }
        if (t.awarenessEvent) { delete t.awarenessEvent; n++; }
        if (t.vars && t.vars.impregnator_side != null) { delete t.vars.impregnator_side; n++; }
        let fixed = false;
        try { fixed = isProfileFieldFixed(k, 'd6'); } catch { fixed = false; }
        const d6 = String(t?.profile?.d6 ?? '').trim();
        if (!fixed && d6 && d6 !== '无' && d6 !== '未加载') { t.profile.d6 = '无'; n++; }
    }
    if (n) {
        commit();
        try {
            console.log('[Bodycord] 冻结期自愈：' + bad.map((k) => displayName(s.targets[k]) || k).join('、')
                + ' 残留的怀孕痕迹（提醒 / 胎儿行 / 着床结果）已清掉，共 ' + n + ' 处');
        } catch { /* 忽略 */ }
    }
    return n;
}

/**
 * ★★ 2026-10-23：修掉「刚着床那一轮的尾巴」（打开聊天 / 换聊天时跑一次）。
 *
 * 两件都是被模型或旧版写坏的：
 *   ① 模型在切孕那一轮自己往 d6 写了孩子数据（插件这时还没掷胎数）⇒ 按回「无」；
 *   ② 「这一轮先不判胎儿」的标记**跨轮留下**了（旧版回检查点之后拿旧对象去删，删空了）
 *      ⇒ 不留它，不然下一次推演还会再白跳一轮、胎数要拖到再下一轮才掷。
 * ⚠️ 已经掷过胎数的（`fetusPlan` 在）⇒ 只清标记，d6 一个字不动 ✓
 * ⚠️ 玩家手填过 d6 的不动 ✓
 * @returns {number} 修了几处
 */
/**
 * ★ 2026-10-23（她：只是改了性别，插件应该继续接管）——
 *   d6 是**插件管的字段**：玩家改 d6 时，把里面写的性别同步回 `fetusPlan`，
 *   然后**不冻结 d6** —— 插件下一轮照常重写（头、性别、致孕方），
 *   玩家写的种族 / 发育描述 / 孕期这些**素材**仍会被 `applyFetusPlanOf` 读出来保留 ✓
 *   ⚠️ 胎数对不上 / 性别读不出 ⇒ 不动（那种是手造胎儿，按老规矩留着）✓
 */
export function syncPlanSexesFromD6() {
    let n = 0;
    try {
        for (const t of targetList()) {
            const key = t?.key;
            const plan = t?.fetusPlan;
            if (!key || !plan || !(Number(plan.count) >= 1)) continue;
            if (!isProfileFieldFixed(key, 'd6')) continue;
            const f = parseFetus(t.profile?.d6 || '');
            const kids = Array.isArray(f.kids) ? f.kids : [];
            if (kids.length !== Number(plan.count)) continue;       // 胎数对不上 ⇒ 手造的，别碰
            const sexes = kids.map((x) => {
                const s = String(x?.sex || '').trim();
                if (/^(雄|男)/.test(s)) return '男';
                if (/^(雌|女)/.test(s)) return '女';
                return '';
            });
            if (sexes.some((x) => !x)) continue;
            plan.sexes = sexes;
            // ★ 交回插件：d6 不再冻结（下一轮/下面这句就按 plan 重写头、性别、致孕方 ✓）
            try { clearProfileFix(key, 'd6', { silent: true }); } catch { /* 忽略 */ }
            try { applyFetusPlanOf(key); } catch { /* 写不进去也不影响 plan ✓ */ }
            n++;
        }
        if (n) {
            commit();
            console.log('[Bodycord] 手改的 d6 已同步性别并交回插件：' + n + ' 个对象');
        }
    } catch (e) { console.warn('[Bodycord] 从 d6 同步胎性别失败', e); }
    return n;
}

/**
 * ★★ 2026-10-24（她：这胎是混合规则上线前判的，补掷怎么补）——
 *   给**旧规则下判成异卵**的多胎补一颗「混合胎判定」：
 *   · 只补这一颗，胎数 / 性别 / 致孕方都不重掷 ✓
 *   · 命中（默认 96-100）⇒ 从**性别相同**的两个孩子里挑一对做同卵组，
 *     其余保持异卵；这样尽量不改已有性别（没有同性子对才改一胎）✓
 *   · 没命中 ⇒ 保持全异卵，只记一笔"补判过"✓
 * @param {number} value 1-100
 */
export function applyRetroMixed(key, value) {
    try {
        const t = state().targets?.[String(key || '')];
        const plan = t?.fetusPlan;
        if (!plan || Number(plan.count) < 3) return { ok: false, reason: '只有 3 胎以上才能补判混合' };
        if (plan.sameOvum !== false) return { ok: false, reason: '只有异卵才能补判混合' };
        if (plan.mixedChecked) return { ok: false, reason: '这一胎已经补判过了' };
        if ((plan.groups || []).some((g) => g && g.same && Array.isArray(g.kids) && g.kids.length > 1)) {
            return { ok: false, reason: '已经有同卵分组了' };
        }
        const v = Math.max(1, Math.min(100, Math.round(Number(value) || 0)));
        const r = (() => { try { return fetusMixRangeOf(key); } catch { return null; } })();
        const mixed = r ? (v >= r.mixed[0] && v <= r.mixed[1]) : (v >= 96 && v <= 100);
        plan.mixedChecked = true;
        plan.mixedValue = v;
        let a = 0;
        let b = 1;
        if (mixed) {
            const sexes = Array.isArray(plan.sexes) ? plan.sexes : [];
            let found = false;
            const n = Number(plan.count);
            for (let i = 0; i < n && !found; i++) {
                for (let j = i + 1; j < n; j++) {
                    if (String(sexes[i] || '') && String(sexes[i]) === String(sexes[j])) { a = i; b = j; found = true; break; }
                }
            }
            if (!found && sexes.length > 1) sexes[b] = sexes[a] || sexes[b];   // 没同性子对 ⇒ 改一胎凑同卵
            const groups = [{ kids: [a, b], same: true }];
            for (let i = 0; i < n; i++) if (i !== a && i !== b) groups.push({ kids: [i], same: false });
            plan.groups = groups;
            plan.sameOvum = null;                    // 混合：既不是全同卵，也不是全异卵
            try { collapseLocksForSameOvum(key); } catch { /* 忽略 */ }
            try { applyFetusPlanOf(key); } catch { /* 忽略 */ }
        }
        commit();
        return { ok: true, value: v, mixed, groups: plan.groups || null, pair: mixed ? [a + 1, b + 1] : null };
    } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** 补判用的一颗 D100 */
export function rollRetroMixed(key) {
    return applyRetroMixed(key, Math.floor(Math.random() * 100) + 1);
}

/**
 * ★★ 2026-10-24（她：卡在第三轮）——
 *   d6 里写了「显性：无 / 隐性携带：无」**不等于**遗传判定完成了：
 *   那只是模型偷懒/没写，应该继续重试；只有真的写了特质，或明确写了「本次无遗传特质」，才算完 ✓
 */
export function hasRealHeritage(d6) {
    const s = String(d6 || '');
    const real = (v) => {
        const t = String(v || '').trim();
        return !!t && t !== '无' && t !== '无。' && t !== '—' && t !== '-';
    };
    const dm = s.match(/显性\s*[:：]\s*([^，,；;）)\n]*)/);
    const rm = s.match(/隐性(?:携带)?\s*[:：]\s*([^，,；;）)\n]*)/);
    // ★ 2026-10-24（她：已经有天赋还被再判一次）——
    //   天赋也是"这一胎判过了"的证据：三格里任意一格有真内容就算判完 ✓
    //   （只看显性/隐性时，只有天赋的那一胎会被当成"还没判"⇒ 模块又发一次、天赋被重写 ✗）
    const tm = s.match(/天赋\s*[:：]\s*([^，,；;）)\n]*)/);
    if (real(dm?.[1]) || real(rm?.[1]) || real(tm?.[1])) return true;
    return /无遗传特质/.test(s);
}

/**
 * ★ 2026-10-23（她：当场重新 ROLL）——
 *   把「当场重判」拿到的显性/隐性/天赋写回 d6（替换旧的，其它素材原样留着）✓
 * @param {Array<{i:number,dominant:string,recessive:string,talent:string}>} list
 * @returns {number} 写了几个孩子
 */
export function applyHeritageNow(key, list) {
    try {
        const t = state().targets?.[String(key || '')];
        if (!t) return 0;
        const f = parseFetus(t.profile?.d6 || '');
        if (!Array.isArray(f.kids) || !f.kids.length) return 0;
        const arr = Array.isArray(list) ? list : [];
        for (let i = 0; i < f.kids.length; i++) {
            const hit = arr.find((x) => Number(x?.i) === i + 1) || {};
            // ★ 2026-10-24（她：别设字数上限，容易被截断）——这三格不截断 ✓
            const dom = String(hit?.dominant || '').trim();
            const rec = String(hit?.recessive || '').trim();
            // ★ 2026-10-24（她报：已有天赋时当场重判不覆盖）——
            //   以前只在"模型给了非空 talent"时才写 ⇒ 模型答"无"或答了空串，旧天赋会留着 ✗
            //   现在按"这一条里有没有 talent 这个键"判：有键就照它的值覆盖（含清空），
            //   整个键都没给（模型没答这一格）才保留原文 ✓
            const hasTalKey = hit && Object.prototype.hasOwnProperty.call(hit, 'talent');
            const tal = String(hit?.talent || '').trim();
            const clean = (x) => (x === '无' || x === '无。' ? '' : x);
            if (hasTalKey) f.kids[i].talent = clean(tal);
            let extra = String(f.kids[i].extra || '').trim();
            // 先摘掉旧的「显性 / 隐性」，再把新的接上；其它余项（发育正常之类）原样留着 ✓
            // ★ 2026-10-24：显性值里本来就有逗号 ⇒ 按「下一个键名」切，别按逗号切 ✗
            extra = extra
                .replace(/显性\s*[:：][\s\S]*?(?=[，,；;｜|]\s*(?:隐性携带|隐性|天赋|强度)\s*[：:]|$)/, '')
                .replace(/隐性(?:携带)?\s*[:：][\s\S]*?(?=[，,；;｜|]\s*(?:天赋|强度)\s*[：:]|$)/, '')
                .replace(/[，,；;]\s*([，,；;])/g, '$1')
                .replace(/^[，,；;\s]+|[，,；;\s]+$/g, '')
                .trim();
            const add = [clean(dom) ? `显性：${clean(dom)}` : '', clean(rec) ? `隐性携带：${clean(rec)}` : ''].filter(Boolean).join('，');
            f.kids[i].extra = [extra, add].filter(Boolean).join('，');
        }
        try { clearProfileFix(key, 'd6', { silent: true }); } catch { /* 忽略 */ }
        if (!t.profile || typeof t.profile !== 'object') t.profile = {};
        t.profile.d6 = buildFetus(f.head, f.kids);
        t.heritageDone = true;
        t.heritageTry = 0;
        delete t.heritageGiveUp;
        commit();
        return f.kids.length;
    } catch (e) {
        console.warn('[Bodycord] 写回遗传特质失败', e);
        return 0;
    }
}

/**
 * ★ 2026-10-23（她：加一个手动 ROLL 血脉遗传的兜底）——
 *   它不是掷的，是模型写进 d6 的；这个兜底＝**让下一轮推演再发一次那个模块**（不额外发包）✓
 *   清掉 heritageDone / heritageTry，下一轮 `heritageDue` 就会重新带上它 ✓
 */
export function requestHeritageReroll(key) {
    try {
        const t = state().targets?.[String(key || '')];
        if (!t) return false;
        t.heritageDone = false;
        t.heritageTry = 0;
        delete t.heritageGiveUp;
        t.heritageRerollAt = Date.now();
        commit();
        return true;
    } catch { return false; }
}

/**
 * ★ 2026-10-24（构建 -97）：这里原来做的是"已经标了判过、但 d6 里没有三格 ⇒ 清掉标记、
 *   下一轮再发"。那条是拿 d6 反推状态 —— d6 一旦被覆盖或模型少写，判过的那一胎就被
 *   重新当成"没判过"，于是卡每轮都发、它每轮都知道要编天赋 ✗
 *   ⇒ 现在改成**单向对齐**：d6 里已经有真遗传内容、标记却还是 false ⇒ 补成 true。
 *     判过之后不管 d6 后面怎么变，都不再自动打回去；要重判走胎儿页那颗入口 ✓
 */
export function repairHeritageRetry() {
    let n = 0;
    try {
        for (const t of targetList()) {
            // ★ 2026-10-24：打开聊天时顺手把天赋的「强度」补齐 ——
            //   有一版把强度从面板那份文字里剔掉了，这里自愈，不用等重推 ✓
            try { if (t?.key) applyTalentStrength(t.key); } catch { /* 忽略 */ }
            if (!t?.key) continue;
            if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() !== 'true') continue;
            if (t.heritageDone === true) continue;
            if (!hasRealHeritage(t?.profile?.d6)) continue;
            t.heritageDone = true;
            t.heritageTry = 0;
            delete t.heritageGiveUp;
            n++;
        }
        if (n) {
            commit();
            console.log('[Bodycord] d6 里已经有遗传三格：补标为已发过 ' + n + ' 个对象');
        }
    } catch (e) { console.warn('[Bodycord] 对齐血脉遗传标记失败', e); }
    return n;
}

export function repairFetusPending() {
    const s = state();
    let n = 0;
    for (const [k, t] of Object.entries(s.targets || {})) {
        if (!t || t.fetusPlanPending !== true) continue;
        let hasPlan = false;
        try { hasPlan = !!fetusPlanOf(k); } catch { hasPlan = false; }
        if (!hasPlan) {
            let fixed = false;
            try { fixed = isProfileFieldFixed(k, 'd6'); } catch { fixed = false; }
            const d6 = String(t?.profile?.d6 ?? '').trim();
            if (!fixed && d6 && d6 !== '无' && d6 !== '未加载') {
                t.profile.d6 = '无';
                n++;
            }
        }
        delete t.fetusPlanPending;
        n++;
    }
    if (n) {
        commit();
        try { console.log('[Bodycord] 清掉「刚着床那一轮」的残留：' + n + ' 处（d6 按回「无」、待判标记清掉）'); } catch { /* 忽略 */ }
    }
    return n;
}

/**
 * 删掉某一楼的候选记录。
 *
 * ★ 重新生成时旧记录可以删掉，因为被 ROLL 走的东西已经回不来了；
 *   但备选回复不一样（那些记录要留着）✓✓
 *   ⇒ 判据靠酒馆的事件：**重新生成会先发一条「消息被删除」**（script.js 的 Generate：
 *     `chat.length = chat.length - 1` ＋ `MESSAGE_DELETED`）⇒ 那一楼的旧候选全作废、直接删 ✓；
 *     而**备选回复（swipe）不发这个事件** ⇒ 记录留着 ✓
 * @param {number} floor 被删掉的那一楼（= 事件带的下标）
 */
export function clearCandidateRecords(floor) {
    const s = state();
    if (!s.floorCandidates || typeof s.floorCandidates !== 'object') return 0;
    if (floor === undefined || floor === null || !Number.isFinite(Number(floor))) {
        const n = Object.values(s.floorCandidates).reduce((a, b) => a + Object.keys(b || {}).length, 0);
        s.floorCandidates = {};
        commit();
        return n;
    }
    const f = String(Number(floor));
    const n = Object.keys(s.floorCandidates[f] || {}).length;
    delete s.floorCandidates[f];
    commit();
    return n;
}

/**
 * ★ 删掉某一楼 / 重新生成覆盖某一楼时，把**这一楼的时光机快照全部删掉**（2026-10-23 她定的）。
 *
 * 为什么整楼删、而不是挑着删：**一层被删掉，那一层整个就没了** ——
 *   候选回复、正文、它下面的东西全都不存在；重新生成也一样，只是把整层覆盖掉再建一个新的。
 *   ⇒ 那些快照对应的正文已经不在了，留着只会让时光机里出现"这一楼"却对不上任何正文，
 *     还可能被「从这里重新开始」当成回滚点 ⇒ 是误删数据的入口 ✗
 *   （原来的写法是"保留历史、不静默删"，被她判成缺陷 ✓）
 *
 * ⚠️ 只删 `messageIndex === 这一楼` 的；比它大的由 `migrateFloorIndices()` 往前挪 ✓
 * @returns {number} 删了几条快照
 */
export function dropSnapshotsOfFloor(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) return 0;
    const s = state();
    if (!Array.isArray(s.snapshots)) return 0;
    const before = s.snapshots.length;
    s.snapshots = s.snapshots.filter((x) => Number(x?.messageIndex) !== f);
    const n = before - s.snapshots.length;
    if (n) commit();
    return n;
}

/**
 * 删掉某一楼之后，把"按楼层号存的东西"整体往前挪一格。
 *
 * ★ 哪些要挪、哪些不挪（判据：**活键**跟着挪，**历史标签**不动）：
 *   · `excluded`（哪几楼不参与推演）—— 活键 ⇒ 必须挪（不挪的话标记会漂到别的楼层上 ✗）
 *   · `floorCandidates`（按楼层存的候选记录）—— 活键 ⇒ 必须挪
 *   · `checkpoint.floor`（"这一楼之前"那个底座）—— 活键 ⇒ 必须挪
 *   · `snapshots[].messageIndex`（时光机里那一楼的号）—— 半活：楼层面板要按它找快照 ⇒ 一起挪
 *   · `insems[].floor`（"哪次做爱中的招"里那个楼层号）—— 纯历史标签 ⇒ **不动**
 *   ★ 被删那一楼自己的**快照已经由 `dropSnapshotsOfFloor()` 整楼删掉**（2026-10-23）——
 *     那一层不存在了，它的快照也就没有对应的正文，留着只会误导 ✗
 * @param {number} deleted 真正被删掉的那一楼（用 `resolveDeletedFloor()` 反推出来的那个 ✓）
 * @returns {{excluded:number, floors:number, snapshots:number, candidates:number}} 挪了几处（给日志/诊断用）
 */
export function migrateFloorIndices(deleted) {
    const out = { excluded: 0, floors: 0, snapshots: 0, candidates: 0 };
    const d = Number(deleted);
    if (!Number.isFinite(d) || d < 0) return out;
    const s = state();
    // ① 不参与推演的标记
    if (Array.isArray(s.excluded)) {
        const next = [];
        for (const x of s.excluded) {
            const n = Number(x);
            if (!Number.isFinite(n)) continue;
            if (n === d) continue;                  // 被删那一楼的标记跟着走
            if (n > d) { next.push(n - 1); out.excluded++; }
            else next.push(n);
        }
        s.excluded = next;
    }
    // ② 候选记录（被删那一楼那份已经作废 ⇒ 丢掉；比它大的往前挪一格）
    if (s.floorCandidates && typeof s.floorCandidates === 'object') {
        const next = {};
        for (const [k, v] of Object.entries(s.floorCandidates)) {
            const n = Number(k);
            if (!Number.isFinite(n)) continue;
            if (n === d) { out.candidates += Object.keys(v || {}).length; continue; }
            if (n > d) out.floors++;
            next[String(n > d ? n - 1 : n)] = v;
        }
        s.floorCandidates = next;
    }
    // ③ 回滚检查点
    if (s.checkpoint && Number.isFinite(Number(s.checkpoint.floor)) && Number(s.checkpoint.floor) > d) {
        s.checkpoint = { ...s.checkpoint, floor: Number(s.checkpoint.floor) - 1 };
    }
    // ④ 时光机快照上的楼层号（只挪号；被删那一楼那份已经整楼删掉了 ✓）
    if (Array.isArray(s.snapshots)) {
        for (const snap of s.snapshots) {
            if (snap && Number.isFinite(Number(snap.messageIndex)) && Number(snap.messageIndex) > d) {
                snap.messageIndex = Number(snap.messageIndex) - 1;
                out.snapshots++;
            }
        }
    }
    commit();
    return out;
}

/** 诊断报告用：候选记录有几条、哪些楼层 */
export function candidateInfo() {
    const bag = state().floorCandidates || {};
    const floors = Object.keys(bag);
    let n = 0;
    for (const f of floors) n += Object.keys(bag[f] || {}).length;
    return { floors: floors.map(Number), count: n };
}

/**
 * 记一份快照（时光机的数据源）。
 *
 * 存的东西：
 *   ts          现实时间戳
 *   messageIndex 楼层号
 *   raw         每个对象的完整面板文字（时光机靠它重放画面）
 *   sub         剧情内时间 —— 取自面板「进度描述」的后半段（孕X周+X天 / DayX）
 *   name        当时正在看谁
 *   swipe       这一楼当时算的是**第几个候选回复**（酒馆的 swipe_id）——
 *               一层可以有多个候选，面板要能说清"我显示的是当初那个候选" ✓
 *   hash        那条候选的**正文指纹** —— 一层 5 条候选 = 5 份记录，靠它认"是哪一条" ✓
 *
 * ⚠️ 没有 `sub` 时只存现实时间，时光机里排出来全是「MM-DD 15:30」这种，
 *   跟剧情对不上 ⇒ 虚拟时间一律用**进度描述里的时间**。
 */
export function pushSnapshot(messageIndex = -1, swipeId = null, hash = '') {
    if (!inRealChat()) return;
    // ★ 存新快照之前，先把"对不上现有正文"的旧快照清掉（2026-10-23 ✓）——
    //   这样即使删楼事件没抓住，重新生成之后也不会挂一条幽灵记录
    try { pruneOrphanSnapshots(); } catch { /* 清不掉不影响存快照 */ }
    const s = state();
    const raw = {};
    // ★★ 轻档不进快照（轻档不应该显示在这里）——
    //   轻档指的是"只登记了名字和种族"的对象，它没有身体记录、也不参与推演，
    //   以前照样被存进快照 ⇒ 楼层面板里多出一块只有占位文字的空块 ✗
    //   ⇒ 不收（升格成正式档之后自然又回到这里 ✓）
    for (const t of targetList()) {
        if (t.light === true) continue;
        raw[t.key] = t.raw || '';
    }
    if (!Object.values(raw).some(Boolean)) return;

    const active = s.targets?.[s.active] || Object.values(s.targets || {})[0] || null;

    const last = s.snapshots[s.snapshots.length - 1];
    if (!hash && last && last.messageIndex === messageIndex && JSON.stringify(last.raw) === JSON.stringify(raw)) return;

    const entry = {
        ts: Date.now(),
        messageIndex,
        // 这一楼是按第几个候选算的（拿不到就不写，老快照也没有 ✓）
        swipe: (swipeId === null || swipeId === undefined) ? null : Number(swipeId),
        // 那条候选的正文指纹槽（用来认"是哪一条候选的记录" ✓）
        hash: String(hash || ''),
        raw,
        // ★ 2026-10-26：这一楼存下来的**剧情日期**（以前只存了 profile.sub，
        //   而界面把 sub 当成「剧情时间」显示 ⇒ 那一列印出来是「孕15周+6天」✗）
        date: (() => { try { return currentDate() || ''; } catch { return ''; } })(),
        sub: String(active?.profile?.sub || ''),
        name: active ? (displayName(active) || active.key) : '',
        // ★ B 方案（每轮存明细）✓
        //   ⇒ 每轮把**推演明细的精简版**也钉进快照 —— 只存"用了哪些骰子 + AI 报了什么要点"
        //     （不存整份 report ✗：那是几 KB，300 楼会撑爆 chat_metadata）
        //   ⚠️ **只对以后有效**：以前那些轮已经没存，补不回来 ✓（界面上会写明这一点 ✓）
        judge: (() => {
            try {
                const key = s.active;
                const rep = (key && s.lastJudgeReports) ? (s.lastJudgeReports[key] || null) : null;
                const used = Array.isArray(s.rolls?.lastUsed)
                    ? s.rolls.lastUsed.map((x) => {
                        const row = { for: x.for || '', ref: x.ref || '', value: x.value };
                        // ★ 2026-10-23：判定结果与来源一起钉进快照 —— 少了 result，
                        //   时光机的「这一轮用了哪些骰子」就只看到一个数（同卵/异卵看不出结论 ✓）
                        if (x.result) row.result = x.result;
                        if (x.by) row.by = x.by;
                        return row;
                    })
                    : [];
                if (!used.length && !rep) return null;
                return {
                    // ★ 这份明细属于哪个对象（多对象时界面靠它认领那一块 ✓）
                    target: String(key || ''),
                    used,
                    rep: rep ? { round: rep.round ?? null, sub: rep.sub || '', name: rep.name || '', note: rep.note || '',
                        // ★ 2026-10-16：这一轮敏感带「哪个部位加了几次」（插件按增量表算的）——
                        //   模型不再写进 cot 了（省 token），这段信息改存在这一楼的状态里给界面看 ✓
                        zonesDelta: rep.zonesDelta || '' } : null,
                };
            } catch { return null; }
        })(),
    };

    // ★ 一层 5 条候选 = 5 份记录（这 5 条的记录都应该存着 ✓）
    //   ⇒ 同一楼 + 同一条候选（正文指纹一样）就是**同一份记录** ⇒ 更新它，不追加 ✓；
    //     指纹不一样 = 另一条候选 ⇒ 追加一条（两条并存 ✓）
    if (hash) {
        const i = s.snapshots.findIndex((x) => Number(x.messageIndex) === Number(messageIndex) && String(x.hash || '') === String(hash));
        if (i >= 0) {
            entry.ts = s.snapshots[i].ts || entry.ts;   // 保留"第一次算出来"的时间
            s.snapshots[i] = entry;
        } else {
            s.snapshots.push(entry);
        }
    } else {
        s.snapshots.push(entry);
    }
    // ★ 裁快照统一走 `pruneSnapshots()`：条数 ＋ 总量两道闸
    //   （原来这儿是一行只看条数的 splice —— 对象一多就管不住体积了 ✗）
    // ★ 裁了多少要**记账**（原来返回值被扔掉 ⇒ 悄悄丢，
    //   界面上只看得到"300，已满"、不知道已经掉了多少 ✗）
    const cutN = pruneSnapshots();
    if (cutN > 0) s.snapCut = (Number(s.snapCut) || 0) + cutN;
    commit();
}

/**
 * 时光机用：删掉某一条快照（「撤销这次推演」要把那次记录一起拿走 ✓）。
 * 认法：**楼层 + 正文指纹**（同一楼的不同候选各自一条 ⇒ 不能只按楼层删 ✗）。
 * @returns {boolean} 真删了没有
 */
export function dropSnapshot(messageIndex, hash) {
    const s = state();
    const list = Array.isArray(s.snapshots) ? s.snapshots : [];
    const i = list.findIndex((x) => Number(x.messageIndex) === Number(messageIndex)
        && String(x.hash || '') === String(hash || ''));
    if (i < 0) return false;
    list.splice(i, 1);
    commit();
    return true;
}

/**
 * 时光机用：按时间顺序取快照（旧 → 新），附带序号。
 * 只读 —— 里面的对象是浅拷贝外壳，改它不会影响真实状态。
 */
export function timeline() {
    const s = state();
    const list = Array.isArray(s.snapshots) ? s.snapshots : [];
    return list.map((snap, i) => ({
        index: i,
        序号: i + 1,
        ts: snap.ts,
        楼层: snap.messageIndex,
        // 这一楼如果有备选回复，标出这是第几条候选的记录（没有就不写 ✓）
        候选: (snap.swipe === null || snap.swipe === undefined) ? null : (Number(snap.swipe) + 1),
        hash: snap.hash || '',
        // ★ 2026-10-26：这里要的是**剧情日期**，不是对象的「进度（孕周）」——
        //   老快照没有 date ⇒ 若 sub 长得像日期就退回它，否则留空（界面写「无剧情时间」✓）
        剧情时间: snap.date || (/年/.test(String(snap.sub || '')) ? String(snap.sub) : ''),
        对象: snap.name || '',
        raw: snap.raw || {},
        // 每轮的推演明细（老快照这里是 undefined ⇒ 界面上要说明）
        judge: snap.judge || null,
    }));
}

export function snapshots() {
    if (!inRealChat()) return [];
    return state().snapshots || [];
}

/**
 * 供面板 iframe 使用的假聊天记录（最近的在后面）
 *
 * ★★ 这里**不许**再带 `_bcRaw: snap.raw`（该时刻**所有对象**的完整文字）✗
 *   —— 300 层 × 8 个对象 ⇒ 这份 payload **2082 KB**，而它**每次刷新都要跨 iframe 结构化克隆**，
 *   实测 **4.08 ms/次**（浏览器只会更慢），还带 2 MB 的内存分配 ✗。
 *   而全仓 **没有任何地方读 `_bcRaw`**（生产端就这一处）⇒ 纯死重量 ✓
 *   ⇒ 去掉之后：**2082 KB → 253 KB（省 88%）**、克隆 **4.08 ms → 0.48 ms** ✓
 *
 * ⚠️ 以后要"别的对象在某一层的历史文字"时，**显式加一个字段**（或按需向外壳要那一层）✓，
 *   别再走"反正都带着"这条路 ✗（units 里有断言守着这个字段白名单）。
 * 保留的三个内部字段各自的用处：`_bcIndex` 保存回写要认（`applySnapshotChat`）、
 * `_bcTs` / `_bcFloor` 面板显示楼层信息用（数值，很小）。
 */
export function snapshotChat() {
    if (!inRealChat()) return [];
    const s = state();
    const activeKey = s.active;
    // ⚠️ `_bcKey` 是**回写要用的那一个 key**：这一条文字是从 `snap.raw` 里哪个槽取的，
    //   就必须写回哪个槽。以前回写用 `state().active`（"此刻在看谁"）——
    //   算快照时在看甲、后来切到乙，再在楼层面板里改这条文字，就会写进**乙**的槽 ✗
    //   （看到的虽是甲的文字，落进去变成乙的）。用 `raw` 里第一个兜底时更明显：
    //   面板显示的是甲，回写却给了 active（=乙）⇒ 等于把甲的话复制给了乙。
    //   顺手也解掉"active 为空时写成 raw['null']"（一个不存在的对象）✓
    //   ⚠️ 它只是**回写要认的键**，不是显示数据（面板不会拿它当东西画）✓
    const pickKey = (snap) => {
        const raw = snap.raw || {};
        if (activeKey && raw[activeKey]) return activeKey;
        return Object.keys(raw).find((k) => raw[k]) || activeKey || '';
    };
    return (s.snapshots || []).map((snap, i) => ({
        name: 'Bodycord',
        is_user: false,
        mes: snap.raw?.[activeKey] || Object.values(snap.raw || {})[0] || '',
        _bcKey: pickKey(snap),
        _bcIndex: i,
        _bcTs: snap.ts,
        _bcFloor: snap.messageIndex,
    })).filter(m => m.mes);
}

export function applySnapshotChat(chat) {
    const s = state();
    for (const m of chat || []) {
        if (m._bcIndex === undefined) continue;
        const snap = s.snapshots[m._bcIndex];
        if (!snap) continue;
        // ★ 用面板带上来的 `_bcKey`（= 这条文字原本属于谁），不再用"此刻在看谁" ✗
        //   （老数据 / 极端情况没有这个字段时退回 active；active 也空就跳过，别写 raw['null'] ✗）
        const key = String(m._bcKey || s.active || '');
        if (!key) continue;
        snap.raw[key] = m.mes;
    }
    commit();
}

// ---------------------------------------------------------------------------
// 身体痕迹（插件托管）
//
// 为什么要插件来管：原来这个模块全靠 AI 自己记住"上一轮面板写了哪些痕迹"，
// 于是整篇 2000 字里有一大半是在求它别忘（数据源规则 / 强制自查 / cot 怎么写）。
// 现在痕迹变成结构化表格存在这，**按对象分开**（每个被追踪角色各有自己的），
// 插件自己算衰减、每轮把当前痕迹喂回去 ——
// AI 只需要报告"这一轮新增了什么 + 有没有过夜 + 有没有用恢复手段"。
// ---------------------------------------------------------------------------

export const TRACE_LEVELS = ['轻度', '中度', '重度', '深层'];

/**
 * ★ 「恢复体质档」→ 过夜一次顶几夜。
 *   每档降一档要几夜由玩家改（「痕迹参数」四格，出厂 1 / 3 / 6 / 12）
 *   ⇒ 这里的倍率是**在它之上**再乘：标准 = 1、快 = 2（半速退）、慢 = 0.5（靠小数）
 */
const TRACE_RECOVER_FACTOR = { '快': 2, '标准': 1, '慢': 0.5 };

/**
 * ★ 一条痕迹的总寿命上限 = 该档满值的几倍。
 *
 * 为什么要上限：同一处被反复留痕时"再报一次就重新算满"会把一条痕迹永远续下去
 *   （模型把残留当新增报上来时尤其明显）⇒ 给总寿命一个上限：累计过的夜数到了上限，
 *   就不再重新算满，只能按现在这一档往下退。
 * 深层次按 3 倍（12 × 3 = 36 夜）：鞭痕本来就要好几周，两倍太短。
 */
export const TRACE_LIFE_FACTOR = 3;

/** 程度 → 档位（1=轻度 2=中度 3=重度 4=深层） */
function lvNum(lv) {
    const i = TRACE_LEVELS.indexOf(String(lv || '').trim());
    return i < 0 ? 1 : i + 1;
}
function numLv(n) {
    if (n <= 0) return null;            // 消退
    return TRACE_LEVELS[Math.min(n, TRACE_LEVELS.length) - 1];
}

/** 痕迹挂在谁身上：不指定时用当前查看的对象，再退回 {{user}} */
function traceKey(key) {
    if (key) return key;
    const s = state();
    return s.active || Object.keys(s.targets || {})[0] || USER_KEY;
}

function traceBag(key, create = false) {
    const s = state();
    if (!s.traces || typeof s.traces !== 'object' || Array.isArray(s.traces)) s.traces = {};
    const k = traceKey(key);
    if (!Array.isArray(s.traces[k])) {
        if (!create) return [];
        s.traces[k] = [];
    }
    return s.traces[k];
}

// ---------------------------------------------------------------------------
// 近期性行为（插件记账；AI 每轮只报一条）
//
// 
//   · 推演那边**固定只写最近这一次**（没有就写「无」）—— 它也看不到以前那些，所以抄不回去 ✓
//   · **记录归插件**：按对象存清单，收到「无」时清单原样不动（不许被顶掉 ✓）
//   · 面板与主 API 都只取最近 N 条，N 在参数面板里调
// ⚠️ 渲染回 `profile.row3` 的那份仍是出厂三段式「时间 & 人物 & 事件」——
//   一则是面板 / 时光机一直这么显示，二则联系人里「只做过」那条路靠它认人
//   （见 `row3SexPartners`）✓
// ---------------------------------------------------------------------------

export const SEX_KEEP_DEF = 3;
// 存储的天花板（保险丝，不是内容上限）：清单可以一直留着，面板只显示最近 N 条
export const SEX_CAP = 200;

/** 显示条数（参数面板那个数；夹到 1~9，认不出来用出厂 3 ✓） */
export function sexKeepNum() {
    const n = Math.round(Number(settings().recentSexKeep));
    if (!Number.isFinite(n) || n < 1) return SEX_KEEP_DEF;
    return Math.min(9, n);
}

function sexBag(key, create = false) {
    const s = state();
    if (!s.sexLog || typeof s.sexLog !== 'object' || Array.isArray(s.sexLog)) s.sexLog = {};
    const k = key || s.active || Object.keys(s.targets || {})[0] || USER_KEY;
    if (!Array.isArray(s.sexLog[k])) {
        if (!create) return [];
        s.sexLog[k] = [];
    }
    return s.sexLog[k];
}


/**
 * 把一格文字拆成一条或几条。
 * 出厂形状是「时间 & 人物 & 事件」；认得出来就拆三段，认不出来**整句当事件** ✓
 * （绝不因为格式不对就丢掉玩家的记录 ✗）
 */
function parseSexLines(txt) {
    const out = [];
    const raw = String(txt || '').trim();
    if (!raw || /^(无|—|-|未加载|不适用)$/.test(raw)) return out;
    // ★ 2026-10-29：**句末标点不参与比对** ——
    //   渲染回去时每条末尾补了一个句号（条目之间要能分开），模型下一轮原样抄回来
    //   就带着那个句号 ⇒ 不剔掉的话会被当成"新的一条"再记一遍 ✗
    const tidy = (s) => String(s || '').replace(/[。；;，,、\s]+$/, '');
    for (const line of raw.split(/\n|[；;]/).map((s) => s.trim()).filter(Boolean)) {
        const seg = line.split('&').map((s) => s.trim()).filter(Boolean);
        if (seg.length >= 3) out.push({ time: seg[0], by: seg[1], event: tidy(seg.slice(2).join(' & ')) });
        else if (seg.length === 2) out.push({ time: seg[0], by: '', event: tidy(seg[1]) });
        else out.push({ time: '', by: '', event: tidy(line) });
    }
    return out;
}

/** 收一条（时间 + 人物 + 事件全一样 ⇒ 当重复，不再记 ✓） */
export function addSexEntry(one, opts = {}) {
    const k = opts.key || state().active;
    const time = String(one?.time || '').trim();
    const by = String(one?.by || '').trim();
    const event = String(one?.event || '').trim();
    if (!time && !by && !event) return false;
    const bag = sexBag(k, true);
    if (bag.some((x) => x.time === time && x.by === by && x.event === event)) return false;
    // 只替换：**每一楼只留一条记录** ⇒ 条目要记着自己属于哪一楼 ✓
    //   ⚠️ `Number(null) === 0` ⇒ 不能直接 Number(floor) 判，否则"没给楼层"会变成 0 楼、
    //     把同一楼判成永远同一条（踩过一次：两次上报只剩一条 ✗）
    const rawF = opts.floor;
    const fl = (rawF === null || rawF === undefined || rawF === '') ? NaN : Number(rawF);
    bag.unshift({ time, by, event, floor: Number.isFinite(fl) ? fl : null, at: Date.now() });
    if (bag.length > SEX_CAP) bag.length = SEX_CAP;
    return true;
}

/**
 * 把清单渲染成面板文字（最近 limit 条；没内容 ⇒ **空串**）。
 * ⚠️ 空串是故意的：主 API 那边靠它决定"这一行发不发"——
 *   只让它看实质性的东西，所以这里绝不回填「无」✗
 */
export function renderSexLog(key, limit = null) {
    const bag = sexBag(key);
    const n = Math.max(0, Number(limit == null ? sexKeepNum() : limit) || 0);
    return bag.slice(0, n)
        .map((x) => {
            const line = [x.time, x.by, x.event].filter(Boolean).join(' & ');
            // ★ 2026-10-29（截图：三条记录粘成「…射入口腔示例甲 & …」）——
            //   条目之间只靠**换行**隔开，而有的显示位置会把换行吃掉 ⇒ 两条就粘成一句 ✗
            //   ⇒ 每条末尾补一个句号（**只动边界标点，正文一个字不改** ✓）；
            //     已经有句末标点的原样留着，不重复加 ✓
            return /[。！？!?；;，,、]$/.test(line) ? line : (line + '。');
        })
        .join('\n');
}

/**
 * ★ 2026-10-26：把一段文字里的"日期 ＋ 钟点"整段删掉（**只给界面显示用**）。
 *   用途：从别的档导入进来的那些记录，时间属于另一条时间轴 ⇒ 干脆不显示，
 *   而不是换成"N 天前"（导入的数据按"没有这段时线"处理）。
 */
export function stripDateText(text) {
    let s = String(text || '');
    // ★ 2026-11-01：日期可能带「纪元名」前缀（日期写法里设了某某历）——
    //   前缀要跟日期一起收掉，不然记录前面会剩下一个孤零零的名字 ✗
    let era = '';
    try { era = String(activeCalendar().style.era || '').trim(); } catch { era = ''; }
    const eraRe = era ? (era.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*') : '';
    // 日期 ＋ 可选钟点（含 20:47~20:59 这种区间）＋ 后面那个分隔符一起收掉
    // ⚠️ 分隔符要连 `&` 一起收：row3 的出厂形状是「时间 & 人物 & 事件」✓
    s = s.replace(new RegExp('(?:' + eraRe + ')?(\\d{1,4})\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日(\\s*\\d{1,2}:\\d{2}(\\s*[~～-]\\s*\\d{1,2}:\\d{2})?)?\\s*([·・|｜,，&]\\s*)?', 'g'), '');
    // 收完可能留下开头的分隔符 / 多余空格
    s = s.replace(/^[\s·・|｜,，&]+/, '').replace(/[·・|｜]\s*(?=[·・|｜])/g, '');
    return s;
}

/**
 * ★ 2026-10-26：这个对象是不是「仅状态」从别的档导入进来的。
 *   判据就一条：`targets[key].imported === true`（只在 withTime === false 那条分支里打）。
 *   用途：所有给玩家看的日期都要按它决定显不显示 ✓
 */
export function isImportedTarget(key) {
    try {
        const t = state().targets?.[key];
        return !!(t && t.imported === true);
    } catch { return false; }
}

/**
 * ★★ 2026-10-28：这条成就是不是「仅状态」从别的档导入进来的。
 *   导入进来的成就，日期属于旧时间线 ⇒ 界面不显示日期（新档里正常解锁的照旧显示 ✓）。
 *
 * 判据分两档：
 *   ① 有标记就以标记为准（2026-10-28 起，导入时会打 `imported = true`；
 *      之后在本聊天里新解锁的会打 `false`）；
 *   ② 老数据没有标记（这个 bug 之前导入的）⇒ 按当时导入留下的痕迹认：
 *      导入会把**按楼层**存的 `floor` 清空，而且这个人本身也带着 `imported` ✓
 *      （正常游玩解锁的都有楼层号，不会被误认）
 */
export function isImportedAchievement(a) {
    if (!a || typeof a !== 'object') return false;
    if (a.imported === true) return true;
    if (a.imported === false) return false;
    if (a.floor !== null && a.floor !== undefined && a.floor !== '') return false;
    const key = String(a.targetKey || '');
    if (key) return isImportedTarget(key);
    // 老成就可能没存 targetKey ⇒ 按当时的名字找回那个人
    const nm = String(a.target || '').trim();
    if (!nm) return false;
    try {
        for (const k of Object.keys(state().targets || {})) {
            if (!isImportedTarget(k)) continue;
            const t = state().targets[k];
            if (String(displayName(t) || '') === nm || String(t?.name || '') === nm) return true;
        }
    } catch { /* 认不出来就当没导入 */ }
    return false;
}


/**
 * 推演落报告时走这里：把这一轮报的那一条收进清单，再把清单渲染回 `row3`。
 *
 * @param {string} key 对象 key
 * @param {string} prevRow3 替换前那一格的原文（老数据搬家用 ✓）
 * @param {string} reported 这一轮报回来的那一条（可能是「无」⇒ 清单不动 ✓）
 */
export function applyReportedSex(key, prevRow3, reported, floor = null, hadEvent = false) {
    const s = state();
    const t = (s.targets || {})[key];
    if (!t) return;
    // ① 清单还没有过 ⇒ 先把老的那格拆进来（老聊天升级；一次 ✓）
    if (!Array.isArray((s.sexLog || {})[key]) || !s.sexLog[key].length) {
        const old = parseSexLines(prevRow3);
        if (old.length) {
            const bag = sexBag(key, true);
            for (let i = old.length - 1; i >= 0; i--) bag.push({ ...old[i], at: 0 });
        }
    }
    // ② 这一轮的（报「无」时 `parseSexLines` 返回空数组 ⇒ 清单一个字都不动 ✓）
    // ★★ 2026-10-23 她问「口交为什么没有记录」——
    //   以前这里只看 `sex_events` 有没有：口交不是风险事件 ⇒ 整轮 row3 一律不采信 ✗
    //   但「近期性行为」本来就是记录**所有**性行为（口交 / 手交 / 避孕成功都算）✓
    //   ⇒ 现在：有风险事件照收；没有风险事件，但 row3 报了一条**清单里没有的新条目**，也收 ✓
    //   ⚠️ 唯一的防线：模型把上一轮那格原样抄回来时（`reported === prevRow3`）不收，
    //      以及清单里已经有一模一样的（时间 + 人物 + 事件）不重复记 ✓
    const parsed = parseSexLines(reported);
    const repNorm = String(reported || '').trim();
    const prevNorm = String(prevRow3 || '').trim();
    const sameAsPrev = !!repNorm && repNorm === prevNorm;
    const bag0 = sexBag(key);
    const allInLog = parsed.length > 0 && parsed.every((one) => bag0.some((x) => x.time === one.time && x.by === one.by && x.event === one.event));
    const hasNewLine = parsed.some((one) => !bag0.some((x) => x.time === one.time && x.by === one.by && x.event === one.event));
    // ★ 2026-10-23：只拦"原样抄回来、而且清单里已经有"的那种；
    //   如果界面上那行字在清单里根本没记（老数据 / 落账失败过），就算和上一轮一样也要补记 ✓
    const copyBack = sameAsPrev && allInLog;
    // 只替换：**每一楼只留一条** ——
    //   重推同一楼时先把这一楼原来那条**换掉**，别的楼层一个字不动 ✓
    //   （老条目没有 `floor` ⇒ 不参与这条判据，留给老数据自己慢慢走完 ✓）
    const flRaw = floor;
    const fl = (flRaw === null || flRaw === undefined || flRaw === '') ? NaN : Number(flRaw);
    const incoming = (!copyBack && (hadEvent || hasNewLine || !allInLog)) ? parsed : [];
    if (incoming.length && Number.isFinite(fl)) {
        const bag = sexBag(key, true);
        const kept = bag.filter((x) => Number(x.floor) !== fl);
        if (kept.length !== bag.length) {
            bag.length = 0;
            for (const x of kept) bag.push(x);
        }
    }
    for (const one of incoming) addSexEntry(one, { key, floor: Number.isFinite(fl) ? fl : null });
    // ③ 渲染回去（面板 / 主 API / 联系人都读这一格）
    if (!t.profile || typeof t.profile !== 'object') t.profile = {};
    t.profile.row3 = renderSexLog(key);
}

/** 某个对象当前的痕迹清单（只读副本） */
export function listTraces(key) {
    return traceBag(key).map((x) => ({ ...x }));
}

/**
 * ★ 按"现在的剧情日期"重算一次阶段名 / 进度 / 基础率（
 *   「都第二天了为什么周期没有推进？」）——
 *   根因：推演里**先处理对象、后推日期** ⇒ 那一次算出来的 Day 还是旧的 ✗
 *   ⇒ 日期动完之后再补算一遍 ✓（跟推演里那段用的是同一个 `deriveCycleFields`）
 */
export function refreshCycleFieldsOf(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    try {
        const dv = deriveCycleFields(t.vars || {}, periodModeOf(t.key), periodDaysOf(t.key), cycleDayNum(t.key), pregDaysOf(t.key));
        if (!dv) return false;
        if (!t.profile || typeof t.profile !== 'object') t.profile = {};
        t.profile.phase = dv.phase;
        t.profile.sub = dv.sub;
        t.profile.d1 = dv.d1;
        t.profile.phaseId = dv.phaseId || '';
        commit();
        return true;
    } catch { return false; }
}

/**
 * 一条痕迹「大约还能维持几夜」（面板读数与喂给 AI 的那份共用 ✓）
 *
 * 算法：这一档还差几夜退档，再加上后面每一档各自要的夜数。
 *   （四档各自的夜数由「痕迹参数」定，`acc` 记的是**当前档已经攒了几夜**）
 */
export function traceNightsLeftOf(x, key) {
    const map = traceNightsMapOf(key);
    const lv = Math.min(TRACE_LEVELS.length, Math.max(1, lvNum(x?.level)));
    let left = Math.max(0, (Number(map[numLv(lv)]) || 0) - (Number(x?.acc) || 0));
    for (let l = lv - 1; l >= 1; l--) left += Number(map[numLv(l)]) || 0;
    // ★ 2026-10-21 修的：**总寿命上限会截断它**
    //   到期续命的痕迹可能"档位还没掉完、但累计夜数已经快用满"⇒
    //   照档位算会说"还剩 4 夜"，实际下一夜就到上限消失 ✗（面板与 row2 的"约剩几夜"都读这里）
    const used = Number(x?.used);
    const cap = Number(x?.cap);
    if (Number.isFinite(used) && Number.isFinite(cap) && cap > 0) {
        left = Math.min(left, Math.max(0, cap - used));
    }
    return Math.max(0, Math.round(left));
}

/**
 * ★★ 「身体状态」频道要的那一份（放在状态这一类里、概览下面）。
 *
 * 为什么要有这一页：那三条状态描述（生理状态 / 身体状况 / 近期性行为）原来
 *   **只在楼层和推演记录里出现过**（都是"这一楼变了什么"的变化视角），
 *   主面板没有一个地方能安安静静看"现在是什么样" ✗；痕迹更只有推演报告里那一行。
 *
 * 这里只做**拼装**，不发明任何规则：
 *   · 三条原文照 `t.profile` 给（面板自己会按字段拆）
 *   · 痕迹照 `listTraces()` 给，附一个"大约还能维持几夜"的读数（这一个是插件算的 ✓）
 *
 * ⚠️ "还能维持几夜"是**大约**：每档降一档要几夜由「痕迹参数」那四格决定；
 *    同一部位反复留痕时，它自己那一档先不动（跟 `decayTraces` 的 `slowed` 同口径）✓
 */
export function bodyStateForPanel(key) {
    const s = state();
    const want = key || s.active || '';
    const t = (s.targets && s.targets[want]) || null;
    const p = (t && t.profile) || {};
    const stepMap = traceNightsMapOf(want);   // 四档各自的夜数（玩家可改）
    const traces = listTraces(want).map((x) => ({
        part: String(x.part || ''),
        kind: String(x.kind || ''),
        level: String(x.level || ''),
        nightsLeft: traceNightsLeftOf(x, want),
    }));
    // ★ 2026-10-26：这一栏用**记录清单**渲染，别用 profile.row3 ——
    //   那条可能被推演写成「无」，而 sexLog 里明明有记录（身体状态页就整段空了 ✗）
    let row3Text = String(p.row3 || '');
    try {
        const log = renderSexLog(want, sexKeepNum());
        if (log) row3Text = log;
    } catch { /* 读不出来就用原文 */ }
    const tImp = t && t.imported === true;
    return {
        name: t ? (displayName(t) || t.key || want) : String(want || ''),
        row1: String(p.row1 || ''),
        row2: String(p.row2 || ''),
        // ★ 2026-10-26：正常游玩照旧显示原来的日期；从别的档导入的对象**整段不显示日期**
        //   （只影响显示；存档里那份原文不动 —— 那份要喂模型、还要拿去判重 ✓）
        row3: tImp ? stripDateText(row3Text) : row3Text,
        traceStep: Number(stepMap['中度']) || 3,
        traces,
    };
}

/**
 * ★ 某个对象的「恢复体质档」（慢 / 标准 / 快）—— 插件记着，不每轮问。
 *
 * 为什么：它是**角色设定**（跟种族 / 受孕体质档同一类），说一次就定了。
 *   以前契约每轮都问一遍，白花 token，还可能一轮一个档、让痕迹忽快忽慢地消 ✗
 *   ⇒ 问过一次就存这儿，之后契约里不再问那一格（想改还是能改：哪一轮再报一次就覆盖 ✓）。
 */
export function traceConstitutionOf(key) {
    const s = state();
    const m = (s.traceConstitution && typeof s.traceConstitution === 'object' && !Array.isArray(s.traceConstitution))
        ? s.traceConstitution : {};
    return String(m[traceKey(key)] || '');
}

function setTraceConstitution(key, v) {
    const s = state();
    if (!s.traceConstitution || typeof s.traceConstitution !== 'object' || Array.isArray(s.traceConstitution)) s.traceConstitution = {};
    s.traceConstitution[traceKey(key)] = String(v || '');
}

/** 这个人还没定过恢复体质档 ⇒ 契约里才问那一格（跟 `needsFertilityTier` 同一套做法 ✓） */
export function needsTraceConstitution(key) {
    return !TRACE_RECOVER_FACTOR[String(traceConstitutionOf(key) || '').trim()];
}

/**
 * 记录一轮的痕迹报告。
 *
 * @param {object} rep  AI 报告的 { new: [{part,kind,level}], overnight, intervention }
 * @param {object} [opts] { key, round, sub }
 */
export function applyTraceReport(rep, opts = {}) {
    const s = state();
    const k = traceKey(opts.key);
    traceBag(k, true);
    const r = rep || {};
    const round = opts.round ?? 0;
    const sub = opts.sub ?? '';
    const map = traceNightsMapOf(k);

    // ---- 1. 先衰减（新痕迹不该当轮就降档）----
    // ★ 「恢复体质档」真的接上了（以前是个空头支票：
    //   契约要 AI 报 constitution、模块也承诺「快 = 过夜一次等于两次」，可这里从来不读 ✗）
    //   · 快 ⇒ 过夜一次按两次算  · 标准 ⇒ 一次算一次  · 慢 ⇒ 一次算半次（小数累加 ✓）
    // ★★ 「这一轮算几夜」＝ **剧情跳过了几天**（原稿口径：跳几天就等效几次过夜），
    //   不是固定一夜 ⇒ 跳 3 天记 3 夜、跳 30 天记 30 夜（再乘体质档倍率 ✓）
    const nightsRep = Number(r.nights);
    const nights = (Number.isFinite(nightsRep) && nightsRep > 0) ? nightsRep : (r.overnight ? 1 : 0);
    if (nights > 0) {
        const conRep = String(r.constitution || '').trim();
        if (TRACE_RECOVER_FACTOR[conRep]) setTraceConstitution(k, conRep);
        const conEff = TRACE_RECOVER_FACTOR[conRep] ? conRep : traceConstitutionOf(k);
        decayTraces(nights * (TRACE_RECOVER_FACTOR[conEff] ?? 1), k);
    }

    // ---- 2. 外部干预 ----
    // ★ 2026-10-21：干预改成「直接降档」，不再借"衰减 N 夜"折算 ——
    //   四档的夜数各自不同之后，"抵几夜"会随档位飘（用了药面板上看不出变化 ✗）
    //   · 轻度（止痛消肿 / 局部处理）    ⇒ 降一档
    //   · 中度（特效药 / 常规治愈魔法）  ⇒ 降两档
    //   · 重度（高阶治愈 / 科技修复 / 许愿）⇒ 全清
    //   ⚠️ 重度那支必须排前面：「高阶治愈魔法」里含「治愈魔法」，排后面会被中度截胡 ✗
    const itv = String(r.intervention || '').trim();
    if (/重度|高阶|许愿|科技修复|完全修复/.test(itv)) clearTraces(k);
    else if (/中度|特效药|治愈魔法|常规治疗/.test(itv)) dropTraceLevels(k, 2);
    else if (/轻度|止痛|消肿|局部处理/.test(itv)) dropTraceLevels(k, 1);

    // ---- 3. 新增 / 加重 ----
    let added = 0;
    const cur = traceBag(k, true);
    for (const t of (Array.isArray(r.new) ? r.new : [])) {
        const part = String(t?.part || '').trim();
        if (!part) continue;
        const kind = String(t?.kind || '其他').trim();
        // 体液（精液 / 爱液 / 前列腺液 / 汗）不是皮肤上的印记；
        // 酸痛之类体感也不再算痕迹（2026-10-21 摘掉「肌肉酸软」那一类）⇒ 直接跳过 ✓
        if (/精液|体液|爱液|前列腺液|汗渍|唾液|湿痕|气味|酸痛|酸软/.test(kind)) continue;
        let level = String(t?.level || '轻度').trim();
        if (!TRACE_LEVELS.includes(level)) level = '轻度';
        const same = cur.find((x) => x.part === part && x.kind === kind);
        if (same) {
            // ★ 同一处同一类型再被留 ＝ 加重：取更重档，剩余夜数重设成该档满值
            //   （旧版只改档位、不重设计时 ⇒ 刚被吸成中度的痕迹可能一夜就退了 ✗）
            const nl = lvNum(level) > lvNum(same.level) ? level : same.level;
            if (same.used === undefined) {
                same.acc = (Number(same.acc) || 0) * (Number(map[numLv(lvNum(same.level))]) || 1);
            }
            same.level = nl;
            same.used = Number(same.used) || 0;
            same.cap = Math.max(Number(same.cap) || 0, TRACE_LIFE_FACTOR * (Number(map[nl]) || 1));
            if (same.used < same.cap) same.acc = 0;   // 累计夜数到上限了：不再重新算满，只能自然退
            same.round = round;
            same.sub = sub;
        } else {
            cur.push({
                id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                part, kind, level, round, sub,
                acc: 0, used: 0, cap: TRACE_LIFE_FACTOR * (Number(map[level]) || 1),
            });
        }
        added++;
    }

    commit();
    return { added, remaining: cur.length, key: k };
}

/**
 * 外部干预：把这个人所有痕迹直接降 n 档（不足一档就消失）。
 * 计时按新档重新开始（处理过之后，新档要从头算 nights ✓）。
 */
function dropTraceLevels(key, n = 1) {
    const list = traceBag(key, true);
    const k = traceKey(key);
    for (const x of list) {
        const lv = lvNum(x.level) - Math.max(1, Math.round(Number(n) || 1));
        if (lv < 1) { x._gone = true; continue; }
        x.level = numLv(lv);
        x.acc = 0;
    }
    const s = state();
    s.traces[k] = list.filter((x) => !x._gone);
    commit();
    return s.traces[k].length;
}

/**
 * 衰减 nights 夜。
 *
 * 规则（2026-10-21 起，四档各自的节拍）：
 *   · 每档降一档要几夜**由玩家在「痕迹参数」面板改**（四格，出厂 1 / 3 / 6 / 12）
 *     （`traceNightsMapOf` 从这条模块的正文里读；面板写进去的就是那四行 ✓）
 *   · 一条痕迹各自计时：这一档攒够它自己的夜数就降一档，余下的夜数接着算下一档
 *   · 总寿命有上限（该档满值的 3 倍）：累计夜数到了上限就不再重新算满，只能自然退
 *   · 小数累加（`x.acc`）撑着两件事：慢体质（半速）与"这一档还没攒够"
 *   · 「同一处挂着好几条就变慢」那条已撤（和"再报一次就重新算满"意思太近，
 *     而且模型数不出这一处有几条）⇒ 同一处的不同痕迹各算各的 ✓
 */
export function decayTraces(nights = 1, key) {
    const list = traceBag(key, true);
    const map = traceNightsMapOf(key);
    const eff = Math.max(0, Number(nights) || 0);
    if (!eff) return list.length;
    for (const x of list) {
        // ★ 老存档迁移：以前 `acc` 记的是"占一档的几分之几"（0~1），现在记的是**夜数**
        //   （四档各自的夜数不同之后，用比例表达会随档位飘 ✗）⇒ 老条目按当前档换算一次
        if (x.used === undefined) {
            x.acc = (Number(x.acc) || 0) * (Number(map[numLv(lvNum(x.level))]) || 1);
            x.used = 0;
        }
        if (!Number(x.cap)) x.cap = TRACE_LIFE_FACTOR * (Number(map[numLv(lvNum(x.level))]) || 1);

        x.used += eff;
        x.acc = (Number(x.acc) || 0) + eff;
        // 逐档往下掉：这一档攒够它自己的夜数就降一档，余下的夜数接着算下一档
        let lv = lvNum(x.level);
        while (lv >= 1) {
            const need = Number(map[numLv(lv)]) || 1;
            if (x.acc < need) break;
            x.acc -= need;
            lv -= 1;
        }
        // 掉到底，或者累计夜数到上限（上限之后不再重新算满）⇒ 这条痕迹没了
        if (lv < 1 || x.used >= x.cap) { x._gone = true; continue; }
        x.level = numLv(lv);
    }
    const s = state();
    const k = traceKey(key);
    s.traces[k] = list.filter((x) => !x._gone);
    commit();
    return s.traces[k].length;
}

/**
 * 手动加一条身体痕迹（**官方修改器**用 —— 比如开局就带着吻痕、或者补一条剧情里写过、
 * 但推演没报上来的痕迹 ✓）。
 *
 * 形状跟 `applyTraceReport` 那条路**完全一样**（`{ id, part, kind, level, round, sub, acc, used, cap }`）
 *   ⇒ 衰减 / 面板 / 喂回提示词那三处都照常认得它 ✓（不会长出一套"只有修改器认识"的字段 ✗）
 * @param {string} key 哪个对象
 * @param {{part?:string, kind?:string, level?:number}} one 部位 / 哪种痕迹 / 档位（1~4）
 * @returns {boolean} 记上了没有
 */
export function addTraceManually(key, one) {
    const k = traceKey(key);
    const part = String(one?.part || '').trim();
    const kind = String(one?.kind || '').trim();
    if (!part && !kind) return false;
    const lv = Math.min(TRACE_LEVELS.length, Math.max(1, Math.round(Number(one?.level) || 1)));
    const level = numLv(lv);
    const bag = traceBag(k, true);
    bag.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        part, kind, level,
        round: (state().snapshots?.length || 0), sub: '',
        acc: 0, used: 0,
        cap: TRACE_LIFE_FACTOR * (Number(traceNightsForLevel(level, k)) || 1),
    });
    commit();
    return true;
}

/** 清空某个对象的痕迹（重度干预时用） */
export function clearTraces(key) {
    const s = state();
    s.traces[traceKey(key)] = [];
    commit();
}

/**
 * 删掉某一条痕迹（改数值里给个删除入口，
 *   不然旧残留只能靠自己慢慢消退、痕迹一多就刷屏 ✓）
 */
export function removeTrace(key, id) {
    const s = state();
    const k = traceKey(key);
    const list = traceBag(k);
    const i = list.findIndex((x) => String(x.id || '') === String(id || ''));
    if (i < 0) return false;
    list.splice(i, 1);
    s.traces[k] = list;
    commit();
    return true;
}

/** 给提示词用的紧凑文本：把当前痕迹喂回给 AI，它就不用"取自上一轮面板"了 */
export function tracesForPrompt(key) {
    const list = listTraces(key);
    if (!list.length) return '';
    // ★ 2026-10-20——
    //   以前只给「部位｜类型｜程度」，推演那边根本不知道这条快消了还是刚开始
    //   ⇒ row2 只能猜。现在把「约剩几夜」一起给出去，row2 照它定语气 ✓
    return list.map((x) => `${x.part}｜${x.kind}｜${x.level}｜约剩${traceNightsLeftOf(x, key)}夜`).join(' · ');
}

// ---------------------------------------------------------------------------
// ★ 周期模式（有月经 / 无月经）—— **按人**
//
// 一个世界观里同时存在"有月经怀孕"和"非月经怀孕"该怎么处理？
//   一个世界观里两套并存是**要支持的**，用全局一个模式覆盖不了这种玩法 ✗
//
// 设计（四层，缺一不可 ✓）：
//   · **规则文本**：一份 —— 术语写成 `@@TERM:…@@` 这类占位符，不重复写两套 ✓
//   · **术语 / 阶段名**：由插件按**那个人属于哪一档**替换（`settings.js` 的 applyPeriodPlaceholders(text, mode) ✓）
//   · **每个人属于哪一档**：存在那个人身上（本人 ⇒ 全局设置；NPC ⇒ 本聊天档案 ✓）
//   · **发送**：**按档各发一份**（最多两份：有月经那份发给有月经的、无月经那份发给其余的 ✓）
//     ⇒ 不是每人一份（token 不会爆 ✓），也**不会给同一个人同时发两套**（不会打架 ✓）
//
// `settings().periodMode` 从"全世界一个模式"降级成**新建角色的默认档** ✓
// ---------------------------------------------------------------------------

/** ★ 三档的合法值（第三档 `amenorrhea` =「无月经」：**没有周期、没有阶段** ✓） */
export const CYCLE_MODES = ['normal', 'none', 'amenorrhea'];

/** 这个对象是「有月经 / 非月经 / 无月经」（没定过 ⇒ 跟全局默认 ✓） */
export function periodModeOf(key) {
    const fallback = periodMode();          // ★ 全局默认档（三档都认 ✓）
    if (!key) return fallback;
    if (isUserKey(key)) {
        const v = settings().userCycleMode;
        return CYCLE_MODES.includes(v) ? v : fallback;
    }
    const v = state().targets?.[key]?.cycleMode;
    return CYCLE_MODES.includes(v) ? v : fallback;
}

/** 设某个对象的档位（'' = 清掉、回到跟随默认 ✓） */
export function setPeriodModeOf(key, mode) {
    const v = CYCLE_MODES.includes(mode) ? mode : '';
    if (!key) return false;
    if (isUserKey(key)) {
        const s = settings();
        s.userCycleMode = v;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (v) t.cycleMode = v; else delete t.cycleMode;
    commit();
    return true;
}

/** 名单上有没有人"有月经"（补丁页决定要不要把生理期那几条藏起来 ✓）
 *  ⚠️ 名单是空的时候（新聊天）看**全局默认档** —— 否则默认是"有月经"也会被藏掉 ✗ */
export function anyTargetHasCycle() {
    const list = targetList();
    // ⚠️ 空名单时看全局默认档 —— 判据必须跟别处一样走 isNeutralMode：
    //   「无月经」（amenorrhea）也是中性档，写成 `!== 'none'` 会把它当成"有月经" ✗
    //   ⇒ 世界观视图会显示生理期那几条、人物视图却藏着（同一个问题两个答案）
    if (!list.length) return !isNeutralMode(settings().periodMode);
    return list.some((t) => periodModeOf(t.key) === 'normal');
}

// ---------------------------------------------------------------------------
// ★ 「身体痕迹与恢复追踪」—— **按人开关**
//
// 身体痕迹与恢复追踪那张规则卡放到世界观视图里更好；
//   人物视图上给一个按钮，选择是否给这个角色开启追踪，操作方式跟周期模式一样就行 ✓
// ⇒ 那张**规则卡搬去世界观视图**（`ui-modules.js` 的 VIEW_OVERRIDE ✓），
//   人物视图上只留**这个人要不要**（开 / 关，见 `personTraceRow`）✓
//
// 判据只在一个地方用：`settings.moduleAppliesTo()` ⇒ `patchSendGroups()` 里过滤
//   ⇒ 关掉的人，这一条模块**一个字都不发给他**（主 API 与插件 API 两条发送路都走那儿 ✓）
//   ⇒ 名单里**一个都没开**时，这一整条自然就不发了（省 token ✓）
// 同时 `judge.js` 的名单里给他标一句「未开启身体痕迹追踪」⇒ 推演别给他报 traces ✓
//
// ⚠️ 没设过 = **开**（保持加这个开关之前的行为，零回归 ✓）
// ⚠️ 本人那一份跟周期模式一样存**全局**（"你自己"穿所有聊天 ✓）
// ---------------------------------------------------------------------------

/** 这个对象要不要追踪身体痕迹（没设过 ⇒ 开 ✓） */
export function traceOnOf(key) {
    if (!key) return true;
    if (isUserKey(key)) return settings().userTraceOn !== false;
    return state().targets?.[key]?.traceOn !== false;
}

/** 设某个对象的身体痕迹追踪开关（只有明确 `false` 才是关 ✓） */
export function setTraceOnOf(key, on) {
    if (!key) return false;
    const v = on !== false;
    if (isUserKey(key)) {
        const s = settings();
        if (v) delete s.userTraceOn; else s.userTraceOn = false;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    if (v) delete t.traceOn; else t.traceOn = false;
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// 敏感带：本聊天自己那一份（**老层，只作兜底**）
//
// 敏感带要搞成可切换的档案，但每个聊天独立 —— 这样换人设
// （或者单纯想换个玩法）的时候，可以切换到不一样的档案。
// 所以分成两层：
//   · 档案库（全局，见 settings.zonePresets）—— 可以跨聊天复用、可导入导出
//   · 本聊天这一份（存在这里）—— 改了不影响档案库，也不影响别的聊天
//
// ★★ **"本聊天一份"只是兜底层** ✓
//   起因：
//     「敏感带初始设定」本质上是**某个人的东西**，按"本聊天一份"存既不对、
//     还会让多对象时**所有人共用同一套起点** ✗
//   ⇒ 现在照「角色基础信息」那套：**用户本人存全局（settings.userZonesText）、NPC 存对象身上** ✓
//   ⚠️ 但老数据（以前存的本聊天一份）**必须还能读出来** ⇒ `zoneTextOf` 里兜底回退，
//      玩家填过的东西一个字都不许丢 ✗
// ---------------------------------------------------------------------------

/** 本聊天的敏感带文本（**老层 / 兜底层**，空 = 没定过） */
export function zoneChatText() {
    return String(state().zoneText || '');
}

/** 写入本聊天的敏感带文本（老层；新代码请用 setZoneTextOf ✓） */
export function setZoneChatText(text) {
    state().zoneText = String(text || '');
    commit();
}

/** 本聊天当前用的是哪份档案（老层；只作显示用） */
export function zonePresetId() {
    return String(state().zonePresetId || '');
}

export function setZonePresetId(id) {
    state().zonePresetId = String(id || '');
    commit();
}

/** 清掉本聊天的敏感带覆盖，回退到档案 / 默认文案（老层） */
export function clearZoneChatText() {
    const s = state();
    s.zoneText = '';
    s.zonePresetId = '';
    commit();
}

// ---------------------------------------------------------------------------
// ★ 敏感带初始设定：按"是谁的"读写（照「角色基础信息」那套 ✓）
//
//   · **用户本人** ⇒ 全局设置（同一个人穿过所有聊天 ✓）
//   · **NPC**      ⇒ 本聊天里那个对象身上 ✓
//   · 两个都没有 ⇒ 回退老的"本聊天一份"（老数据兜底 ✓）
// ---------------------------------------------------------------------------

/** 读某个对象的敏感带初始设定文本（空 = 没定过，由调用方回退到预设/默认文案） */
export function zoneTextOf(key) {
    if (!key) return zoneChatText();
    if (isUserKey(key)) {
        const own = String(settings().userZonesText || '');
        return own || zoneChatText();          // ⚠️ 老数据兜底 ✓
    }
    const own = String(state().targets?.[key]?.zonesText || '');
    return own || zoneChatText();              // ⚠️ 老数据兜底 ✓
}

/** 写某个对象的敏感带初始设定文本 */
export function setZoneTextOf(key, text) {
    const v = String(text || '');
    if (!key) { setZoneChatText(v); return true; }
    if (isUserKey(key)) {
        const s = settings();
        s.userZonesText = v;
        save();                                 // ★ 全局：立刻落盘，换聊天不丢 ✓
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    t.zonesText = v;
    commit();
    return true;
}

/** 这个对象当前用的是哪份档案（只作显示用） */
export function zonePresetOf(key) {
    if (!key) return zonePresetId();
    if (isUserKey(key)) return String(settings().userZonesPresetId || '') || zonePresetId();
    return String(state().targets?.[key]?.zonesPresetId || '') || zonePresetId();
}

export function setZonePresetOf(key, id) {
    const v = String(id || '');
    if (!key) { setZonePresetId(v); return true; }
    if (isUserKey(key)) {
        const s = settings();
        s.userZonesPresetId = v;
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    t.zonesPresetId = v;
    commit();
    return true;
}

/** 清掉这个对象的敏感带覆盖（回退预设 / 默认文案）—— 只影响这一个人 ✓ */
export function clearZoneTextOf(key) {
    if (!key) { clearZoneChatText(); return true; }
    if (isUserKey(key)) {
        const s = settings();
        s.userZonesText = '';
        s.userZonesPresetId = '';
        save();
        return true;
    }
    const t = state().targets?.[key];
    if (!t) return false;
    t.zonesText = '';
    t.zonesPresetId = '';
    commit();
    return true;
}

// ---------------------------------------------------------------------------
// 内射 / 受孕记录
//
// 需求：希望能记录一次怀孕是哪次性行为造成的。
//   以前用世界书的时候有人问过，但世界书做不到，插件应该可以。
//
// 为什么插件做得到：它有**快照（每轮的状态 + 剧情时间）**和**骰子使用记录**，
// 而世界书既没有累积状态、也不知道哪次判定对应哪次行为。
//
// 分工：AI 只报「谁 / 用了哪个骰子 / 有没有中」——那是它判的；
//       轮次、楼层、剧情时间由插件补（这些它自己有）。
// ---------------------------------------------------------------------------

// ★★ A1（2026-10-14）：**增量这一步归插件**
//
// 病根：增量 = 阶段基础率 × 体质系数 × 防护系数，而这三个因子插件全都有
//   （阶段基础率＝cycleDayInfoOf / 体质系数＝身体补丁那行 / 防护系数＝设置里那 8 格）
//   ⇒ 以前却让模型去做这个乘法并报一个数回来。算错就是账错，而且面板、判定跟着错 ✗。
//
// 现在：模型只报**它判出来的防护情境**（那是只有剧情知道的那半），
//   乘数与累加归插件 ⇒ 这里就是那个唯一的换算口 ✓
//
// ⚠️ 情境词与设置里那 8 个键**一一对应**（顺序＝判定优先级，别随手挪）：
//   模型可能写成「套破损（小洞）」这种带括号的样子 ⇒ 一律用**子串认**，认不出再兜底 ✓
const GUARD_DEFS = [
    { key: 'pillShort', word: '短效避孕药', re: /短效/ },
    { key: 'condomIntact', word: '套完好', re: /完好|无损|未破|没破/ },
    { key: 'condomBurst', word: '套大面积破裂', re: /大面积|完全破裂|破裂/ },
    { key: 'condomTorn', word: '套破损', re: /破损|小洞|撕裂|磨损/ },
    { key: 'condomSlipOff', word: '套掉落', re: /掉落|滑落|脱落/ },
    { key: 'outPull', word: '无套外射', re: /外射/ },
    // **前液也算一笔**（没射精，前液 / 前列腺液流到入口或外阴）
    //   ⚠️ 顺序放在「内射」之前、「外射」之后：同一句里既有"内射"又有"前液"时按内射算
    //     （宁可多算一笔风险 ✓），只有真的没写内射时才落到这一档 ✓
    { key: 'pre', word: '前液接触', re: /前液|前列腺液/ },
    { key: 'internal', word: '内射', re: /内射|内漏|卵植入|体内射精/ },
    { key: 'friction', word: '外部摩擦', re: /摩擦|蹭|体液接触|接触|体外/ },
];

/**
 * 把模型报的情境文字认成设置里那个键（认不出 ⇒ 空串）。
 *
 * 兜底两条（都只在"一个词都没命中"时生效）：
 *   ① **屏障类** ⇒ 按「完好无损」算（正文那条终极兜底也是这么写的 ✓）
 *      ★ 2026-10-15 扩：正文只报了**手段名**、没带程度词时也算挡住了 ——
 *        羊肠套 / 鱼鳔套 / 宫颈帽 / 隔膜 / 护盾 / 结界 / 魔法屏障这些表里没有的手段
 *        （手段不限，见模块里【表里没有的手段怎么归位】）⇒ 归那一档（系数 0）。
 *        不这么认的话它会掉进下面那条"按内射算"的兜底 ⇒ **少算风险**，是最坏的方向 ✗
 *      ⚠️ 但**带失效字样时不许走这一条**（护盾被打碎 / 屏障破了个口子 ⇒ 那时它没挡住 ✓）
 *   ② 其余 ⇒ 按最常见的「内射」算：**宁可多算一笔风险，也别把一次真的内射静默丢掉** ✗
 *      （少算会让判定悄悄变假，而且很难发现）
 */
export function guardKeyOf(text) {
    const s = String(text || '');
    for (const d of GUARD_DEFS) if (d.re.test(s)) return d.key;
    if (/避孕套|安全套|套子|羊肠|鱼鳔|宫颈帽|隔膜|屏障|护盾|结界|挡住/.test(s)
        && !/破|裂|碎|掉|落|漏|脱|失效|碎掉|没挡/.test(s)) return 'condomIntact';
    return s.trim() ? 'internal' : '';
}

/** 情境文字 → 规范词（面板 / 提示词里显示用；认不出 ⇒ 空串） */
export function guardWordOf(text) {
    const k = guardKeyOf(text);
    return k ? (GUARD_DEFS.find((d) => d.key === k)?.word || '') : '';
}

/**
 * 这一笔行为新加几个百分点（= 阶段基础率 × 体质系数 × 防护系数）。
 *
 * @param {string} targetKey 追踪对象
 * @param {string} guardText 模型报的防护情境（认不出时会退回 note）
 * @param {number|null} day 周期日（拿不到 ⇒ 自己按剧情日期算一次）
 * @param {string} [noteText] 那笔的备注（情境为空时当第二个来源 ✓）
 * @returns {number|null} null = 真的算不出来（调用方按"这一批没有贡献"处理，别编一个数 ✗）
 */
export function inseminationGainOf(targetKey, guardText, day, noteText) {
    try {
        const src = String(guardText || '').trim() || String(noteText || '');
        const key = guardKeyOf(src);
        if (!key) return null;
        // 周期日 ＋ 这个身体的排卵日 / 经期天数（跟 derive / 判定同一个来源 ✓）
        let d = Number(day);
        if (!Number.isFinite(d)) d = cycleDayNum(targetKey);
        let ovu = 14, pdays = 5;
        try { const bp = bodyCycleParamsOf(targetKey); ovu = Math.round(Number(bp?.ovu)) || 14; } catch { /* 默认 */ }
        try { pdays = Number(periodDaysOf(targetKey)) || 5; } catch { /* 默认 */ }
        // ★ 无月经档：没有周期、没有阶段 ⇒ 基础率直接读它自己那一格
        //   （以前去借"周期第几天"落段，会随天数在 1% / 8% / 25% / 0% 之间乱跳，
        //     那个数不存在时更会算不出来、按 0 记 ⇒ 永远判不中 ✗）
        const noCycle = (() => { try { return periodModeOf(targetKey) === 'amenorrhea'; } catch { return false; } })();
        let base;
        if (noCycle) {
            base = amenorrheaRateOf();
        } else {
            if (!Number.isFinite(d)) return null;
            // ① 阶段基础率（黄体期是「不适用」⇒ 这一笔不增加，记 0 ✓）
            const m = String(cycleDayInfoOf(d, ovu, pdays)?.d1 || '').match(/([\d.]+)/);
            base = m ? Number(m[1]) : 0;
        }
        // ② 体质系数（排卵日当天按身体补丁那行临时抬一档，出厂 1.0 → 1.5 ✓）
        let coef = Number(bodyCoefOf(targetKey));
        if (!Number.isFinite(coef) || coef <= 0) coef = 1;
        if (d === ovu) {
            const peak = Number(peakCoefOf(targetKey));
            if (Number.isFinite(peak) && peak > 0) coef = peak;
        }
        // ③ 防护系数（设置里那 8 格；不合法 ⇒ 出厂值，protCoefOf 自己会兜 ✓）
        const prot = Number(protCoefOf(key));
        return Math.round(base * coef * (Number.isFinite(prot) ? prot : 1) * 100) / 100;
    } catch { return null; }
}

/**
 * 这一批算不算**上一周期**的（换周期后累计率归零 ⇒ 它不该再当"近期风险" ✓）。
 *
 * 判据两条，命中一条就算：
 *   ① 入账的周期日比现在还大（周期日号被拨回第 1 天之后才会这样 ✓）
 *   ② 入账的剧情日期早于"本周期第 1 天"（跨周期最可靠的那条 ✓）
 * 判不出来 ⇒ 当本周期（宁可多显示一条，也别把最近那笔藏起来 ✓）
 */
function isPrevCycleBatch(x, targetKey) {
    try {
        const dep = Number(x?.depositDay);
        const now = cycleDayNum(targetKey);
        if (Number.isFinite(dep) && Number.isFinite(now) && dep > now) return true;
        const depAbs = absDayOfDateStr(x?.depotDate);
        const startAbs = cycleStartAbsOf(targetKey);
        if (depAbs !== null && startAbs !== null && depAbs < startAbs) return true;
    } catch { /* 判不出来当本周期 */ }
    return false;
}

/**
 * ★ A8（2026-10-14）：面板那行「近期风险」的后半段，由插件拼。
 *
 * 病根：那句话说的就是"最近一次有受孕风险的行为"，而内射账本上谁 / 哪天 / 哪一轮
 *   插件全都有 ⇒ 以前却让模型自己从剧情里回想（日期容易写飘 ✗）。
 *   「当前防护」那半仍归模型：套破没破只有剧情知道 ✓
 *
 * 形态：`3 天前 · 示例致孕方·甲 · 内射（窗口内）`
 *   （时间 / 人 / 行为分开，别写成「与某人内射」——读着不顺 ✓）
 *   · 本周期还没有批次 ⇒ `本周期暂无性行为记录`
 *   · 日期算不出来 ⇒ 退回轮次（`第45轮`）
 *   · 完全读不到 ⇒ 空串（调用方保留模型原来写的那半，绝不清空 ✓）
 */
export function recentRiskForPrompt(targetKey = null) {
    try {
        const mine = listInseminations()
            .filter((x) => String(x.target || '') === String(targetKey || ''));
        // ★ 无月经那档没有周期 ⇒ 不说「本周期」
        const noCycle0 = (() => { try { return periodModeOf(targetKey) === 'amenorrhea'; } catch { return false; } })();
        const noneWord = noCycle0 ? '暂无性行为记录' : '本周期暂无性行为记录';
        if (!mine.length) return noneWord;
        const cur = mine.filter((x) => !isPrevCycleBatch(x, targetKey));
        if (!cur.length) return noneWord;
        const last = cur[cur.length - 1];
        const bits = [];
        // 什么时候（日期差是准的；算不出来就说轮次）
        const depDate = String(last.depotDate || '');
        const today = (() => { try { return currentDate() || ''; } catch { return ''; } })();
        if (depDate && today) {
            const back = diffDays(depDate, today);
            if (Number.isFinite(back)) bits.push(back <= 0 ? '今天' : (back === 1 ? '昨天' : `${back} 天前`));
        }
        if (!bits.length) bits.push(`第${last.round ?? '?'}轮`);
        // 谁 + 什么情境（情境读不出就按账本里最常见的"内射"）
        const who = String(last.by || '').trim();
        const whoOk = !!who && !/^(未知|未标注|unknown)$/i.test(who);
        const act = guardWordOf(last.protection || last.note || '内射') || '内射';
        if (whoOk) bits.push(who);
        bits.push(act);
        // 窗口定位（跟判定同一个口径：窗口最后一天 = 排卵日 +1，过渡日 = +2 ✓）
        const dep = Number(last.depositDay);
        let ovu = 14;
        try { ovu = Math.round(Number(bodyCycleParamsOf(targetKey)?.ovu)) || 14; } catch { /* 默认 */ }
        let tag = '';
        // ★ 无月经没有窗口 ⇒ 不贴「窗口前 / 窗口内 / 窗口已过」
        // ⚠️ 必须**两头都判**：原来只写 `dep <= ovu + 1` ⇒ 窗口**之前**那些天也被贴成「窗口内」，
        //   玩家会以为那时候怀上的几率已经拉满了 ✗（窗口 = 排卵日前后各一天，跟封窗同一个口径 ✓）
        if (Number.isFinite(dep) && !noCycle0) {
            if (dep < ovu - 1) tag = '窗口前';
            else if (dep <= ovu + 1) tag = '窗口内';
            else tag = '窗口已过';
        }
        return bits.join(' · ') + (tag ? `（${tag}）` : '');
    } catch { return ''; }
}

/** 追加一条记录（同一轮同一人只记一次，避免重复调用时叠加） */
export function recordInsemination(ev, opts = {}) {
    // opts: { round, floor, sub, lifeRoll }  —— lifeRoll 由 judge.js 掷好传进来
    const s = state();
    if (!Array.isArray(s.insems)) s.insems = [];
    const by = String(ev?.by || '').trim() || '未标注';
    const round = opts.round ?? (s.snapshots?.length || 0) + 1;
    // 同一轮 + 同一人 + 同一条 note，视为重复
    // ⚠️ 去重键必须带 target：同一轮里"同一个致孕方 → 两个不同对象"、
    //   而 AI 的 note 是模板化措辞（两个人写同一句很正常）⇒ 不带 target 会把
    //   第二条当成重复静默丢掉，那个对象这轮的内射就永久不入账（累计率少算 ✗）
    const key = `${round}|${String(opts.target || '')}|${by}|${String(ev?.note || '')}`;
    if (s.insems.some((x) => x.key === key)) return null;
    // ★ 玩家删过这一笔 ⇒ 不再收（模型下一轮常常照着自己写过的条目再报一次 ✗）
    if (Array.isArray(s.insemMuted) && s.insemMuted.indexOf(key) >= 0) return null;
    // ★ A1：这一笔的增量由插件算（见上面 `inseminationGainOf`）——
    //   ① 调用方先算好传进来（judge.js 要用它决定掷不掷存活期）⇒ 用它的 ✓
    //   ② 老数据 / 测试 / 预览直接给了数字 ⇒ 用那个数字（老行为一字不变 ✓）
    //   ③ 都没有 ⇒ 按模型报的防护情境换算 ✓
    //   ⚠️ 空串要当"没有"（`Number('')` 是 0，会把一笔真的内射算成 0 ✗）
    const guardSrc = String(ev?.protection ?? ev?.guard ?? '').trim();
    const numOf = (v) => (v === null || v === undefined || String(v).trim() === '') ? NaN : Number(v);
    const gain = (() => {
        const fromCaller = numOf(opts?.gain);
        if (Number.isFinite(fromCaller)) return fromCaller;
        const fromData = numOf(ev?.contrib);
        if (Number.isFinite(fromData)) return fromData;
        return inseminationGainOf(opts.target, guardSrc, opts.day, ev?.note);
    })();
    const item = {
        key,                       // 同一轮+同一人+同一条 note 的去重键
        target: String(opts.target || ''),   // ★ 这条事件属于哪个追踪对象（多对象追踪要按它分账）
        round,
        floor: opts.floor ?? null,
        sub: String(opts.sub || ''),
        by,
        roll: String(ev?.roll || ''),
        note: String(ev?.note || ''),
        conceived: ev?.conceived === true,
        // ★ 精子存活（可选功能，默认关）：这一批的贡献 + 它能活到第几轮
        //   contrib：这次新加几个百分点 —— 由插件算（A1，见上面那段）
        //   lifeRoll / viableUntil：插件掷 D3（1~3），表示还能参与判定的轮次
        contrib: gain,
        // ★ 模型报的防护情境原样留着（面板与排查看它；判定读的是上面那个数 ✓）
        protection: guardSrc,
        lifeRoll: null,
        viableUntil: null,
        // ★ 存活期还存一份**绝对天数**（跨周期天然正确 ✓）
        viableUntilAbs: null,
        // ★ 这一批是「周期第几天」入账的 —— **无条件记**。
        //   为什么要它：受精判定的判定值要算「窗口结束那一刻的累计」，
        //   判据就是"这批是窗口内还是窗口后发生的" ⇒ 没有它就永远算不出来 ✗。
        //   只在「按精子存活」那档记的话，另一档下这个数压根不存在 ✓
        // ★ 拿不到周期日就存 null（**别拿轮次顶上** —— 那是另一个单位，会和窗口切点混用 ✗）。
        //   下游 `fertilityThroughDay` 对"没有 depositDay"的老数据
        //   本来就是按"窗口内"处理（宁可宽一点 ✓）
        depositDay: (opts.day == null || !Number.isFinite(Number(opts.day))) ? null : Number(opts.day),
        // ★ 2026-10-26：这一笔属于**第几个周期** ——
        //   导入进来的记录只显示「第 N 周期 · 第 D 天」，靠这个数定位（不是推演轮次 ✓）
        cycleNo: (() => { try { return currentCycleNoOf(opts.target || state().active || ''); } catch { return 1; } })(),
        // ★ **落账那一刻的剧情钟点**也一起记下来。
        //   为什么要它：只记轮次 / 楼层 / 周期日的话，"哪次做爱中的招"这回事
        //   缺了时间那一维（同一个周期日里可能有好几次）✓
        //   ⚠️ 历法那档是「不记钟点」时**存空串**（不是 0）—— 0 是"凌晨 0 点"，
        //     会让面板把不记钟点的存档显示成"00:00" ✗
        clk: (() => {
            try {
                // 明明是 4 号的精子，记录却写着 3 号 21:40——
                //   根因：内射是**先记账、后推日期**的 ⇒ 记账那一刻拿到的是旧日期 / 旧钟点 ✗
                //   ⇒ 推演那边会把这轮该用的日期 / 钟点一起传进来，有就以它为准 ✓
                if (String(opts.clk || '').trim()) return String(opts.clk).trim();
                if (timeUnitNow() === 'none') return '';
                return formatClock(currentTime(), timeUnitNow()) || '';
            } catch { return ''; }
        })(),
        // ★ **落账那一刻的剧情日期**也要 ——
        //   喂回给 AI 那句「距最近一次内射过了多久」要靠它（`clk` 只有钟点，
        //   没有日期就分不清"今天早上"和"昨天早上"，那个数就等于没说 ✗）
        depotDate: (() => {
            // 同上：推演给的日期优先（不然会记成"前一天" ✗）
            if (String(opts.date || '').trim()) return String(opts.date).trim();
            try { return currentDate() || ''; } catch { return ''; }
        })(),
        at: Date.now(),
    };
    // 存活期由调用方（judge.js）掷好传进来 —— store 不引骰子模块，避免循环依赖
    // ★ 单位是**剧情天数**（模块文案写的就是"天"），不是推演轮次 ✓
    //   拿不到剧情天数时调用方会退回轮次（opts.day 传 round），不会崩 ✓
    // ⚠️ depositDay 是 null 时**别算存活截止**（`null + n = n` ⇒ 会被判成"早就失活"、
    //   白丢一批 ✗）
    if (opts.lifeRoll != null && item.contrib != null && item.depositDay != null) {
        item.lifeRoll = opts.lifeRoll;
        item.viableUntil = item.depositDay + opts.lifeRoll;
        // ★ 同一件事再存一份**绝对天数**（入账那天的绝对天 + 存活天数）——
        //   它是"不会随周期切换而失真"的写法，之后判活优先用它 ✓
        //   ⚠️ 拿不到剧情日期（`depotDate` 空）⇒ 留 null ⇒ 读的时候退回周期日号口径 ✓
        const depAbs = absDayOfDateStr(item.depotDate);
        if (depAbs !== null) item.viableUntilAbs = depAbs + opts.lifeRoll;
    }
    s.insems.push(item);
    // ★ 超上限 ⇒ 丢最旧的，**并且记账**——
    //   裁掉多少一个字都不说的话，界面上看着就像"更早的记录本来就不存在" ✗
    if (s.insems.length > INSEM_CAP) {
        const cut = s.insems.length - INSEM_CAP;
        s.insems.splice(0, cut);
        s.insemsCut = (Number(s.insemsCut) || 0) + cut;
    }
    // ★★ 2026-10-16（有精子时受孕率为什么是 0）——这一笔进账之后**立刻重算 d2** ✓
    //   以前只在"规范化 profile"那一步算（`store.js` 里 `fertilityRateTextOf` 那一处），
    //   而内射账本往往是在那一步**之后**才写进来的 ⇒ d2 停在旧值（明明有精子却写 0%）✗
    try {
        const tk = String(opts.target || '');
        const tt = state().targets?.[tk];
        if (tt) {
            if (!tt.profile || typeof tt.profile !== 'object') tt.profile = {};
            const txt = fertilityRateTextOf(tk);
            if (txt) tt.profile.d2 = txt;
        }
    } catch { /* 忽略：d2 下一轮还会再算一次 ✓ */ }
    commit();
    return item;
}

/** 全部记录（旧 → 新） */
export function listInseminations() {
    const s = state();
    return (Array.isArray(s.insems) ? s.insems : []).map((x) => ({ ...x }));
}

/**
 * ★★ 玩家亲手删掉一笔内射记录（明明没有内射却记成内射）
 *
 * 为什么要「记住」这一笔：删掉之后，模型下一轮**还会照着自己写过的「最近性行为记录」再报一次** ✗
 *   ⇒ 光删账没用（下一轮又长回来），撤销 / 重推也一样删不干净 ✓
 *   ⇒ 把这一笔的去重键记进 `insemMuted`：同一笔再报**直接不入账** ✓，
 *     而且它不会再出现在喂给模型的「最近性行为记录」里 ⇒ 模型没有可抄的源头 ✓
 * @param {string} key 内射记录的去重键（`round|target|by|note`）
 * @returns {boolean} 真删掉了才算 true
 */
export function removeInsemination(key) {
    const s = state();
    const k = String(key || '');
    if (!k || !Array.isArray(s.insems)) return false;
    const i = s.insems.findIndex((x) => String(x?.key || '') === k);
    if (i < 0) return false;
    const gone = s.insems[i];
    s.insems.splice(i, 1);
    if (!Array.isArray(s.insemMuted)) s.insemMuted = [];
    if (s.insemMuted.indexOf(k) < 0) s.insemMuted.push(k);
    // 顺手把 d2 重算一遍（跟记一笔时同一个动作 ✓）
    try {
        const tk = String(gone?.target ?? '');
        const tt = state().targets?.[tk];
        if (tt) {
            if (!tt.profile || typeof tt.profile !== 'object') tt.profile = {};
            const txt = fertilityRateTextOf(tk);
            if (txt) tt.profile.d2 = txt;
        }
    } catch { /* 忽略 */ }
    commit();
    return true;
}

// ★★ 精子存活期的**绝对天数**口径
//
// 病根：`viableUntil` 存的是**周期日号**（入账那天 + 存活天数）——
//   周期一切换，周期日被拨回第 1 天，可那个日号没人重新起算
//   ⇒ 上一周期已经过期的批次，在新周期前 N 天又被算成"活着"
//   （显示「精子存活中」，还把"有效累计受孕率"喂大 ✗）。
//
// 修法：新记的批次**额外存一个绝对天数** `viableUntilAbs`
//   ＝「入账那天的绝对天（从历法第一天起算）」＋ 存活天数。
//   绝对天数跨周期天然正确；换历法、平移时间轴也都不用管 ✓
//   ⚠️ 老批次没有这个字段 ⇒ **退回原来的周期日号口径**（老行为一字不变、零迁移 ✓）。
//
// ⚠️ 为什么不改 `fertilityThroughDay`（判定值那条）：它先用「入账周期日 > 窗口最后一天」
//   把上一周期的批次挡掉了（跨周期的批次本来就已经结算过、不该再参与新周期判定 ✓）
//   ⇒ 那边本来就对，只有"显示 + 有效累计"需要绝对口径 ✓
// ---------------------------------------------------------------------------

/** 今天（剧情日期）的绝对天；没有剧情日期 / 读不出来 ⇒ null（退回周期日号口径用） */
function todayAbsDay() {
    try {
        const d = currentDate();
        if (!d) return null;
        const n = diffDays(FICTION_DATE_START, d);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}

/** 一个剧情日期串的绝对天；空串 / 认不出来 ⇒ null
 *  ★ 2026-10-23：先剥掉后面的钟点再解析 —— 「2020年09月15日 08:02」这种带时间的写法
 *    原来整串丢给日期解析 ⇒ 解析失败 ⇒ 排序键全变 0 ⇒ 联系人详情只剩插入顺序（看着顺序全乱）✗
 */
function absDayOfDateStr(s) {
    try {
        if (!s) return null;
        const m = String(s).match(/(\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
        const date = m ? m[1].replace(/\s+/g, '') : String(s);
        const n = diffDays(FICTION_DATE_START, date);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}

/**
 * 这一批精子在某个时间点还算不算活着。
 *
 * ★ 口径怎么选（这一版的关键）：
 *   · 默认走**周期日号**口径（跟以前一字不变 ✓）
 *   · **只在这一批属于上一个周期时**（`depotDate` 早于"本周期第 1 天"）才切**绝对天数**口径 ——
 *     周期一切换，周期日号会被拨回第 1 天，拿它比就会把早过期的批次算活 ✗；
 *     而同周期下两种口径**必然等价**（`untilAbs − refAbs === untilDay − nowDay`）
 *     ⇒ 不用切、老行为与老测试零变化 ✓
 *
 * @param {object} x 一条内射记录
 * @param {number|null} nowDay 当前周期日（周期日号口径要用）
 * @param {number|null} [cycleStartAbs] 本对象"本周期第 1 天"的绝对天（拿不到 ⇒ 不切口径 ✓）
 * @param {boolean} [forceAbs] 明确要"按今天判"（结算清账那条用 ✓）
 * @returns {{alive:boolean, left:number|null, abs:boolean, untilAbs:number|null, untilDay:number|null, expired:boolean}}
 *   · `abs:true` ⇒ 这次是按绝对天数判的；`left` = 还剩几天（0 = 那一天到期）
 *   · 没设存活期的批次 ⇒ 一直有效（`alive:true, left:null`）✓
 */
function spermBatchState(x, nowDay, cycleStartAbs, forceAbs) {
    const dayState = (() => {
        const rawDay = x?.viableUntil;
        const untilDay = (rawDay == null || rawDay === '') ? NaN : Number(rawDay);
        if (!Number.isFinite(untilDay)) {
            return { alive: true, left: null, abs: false, untilAbs: null, untilDay: null, expired: false };
        }
        const left = Number.isFinite(Number(nowDay)) ? untilDay - Number(nowDay) : null;
        return { alive: left === null ? true : left >= 0, left, abs: false, untilAbs: null, untilDay, expired: left !== null && left < 0 };
    })();
    const rawAbs = x?.viableUntilAbs;
    const untilAbs = (rawAbs == null || rawAbs === '') ? NaN : Number(rawAbs);
    if (!Number.isFinite(untilAbs)) return dayState;          // 老数据（没有绝对天数）⇒ 老口径 ✓
    const depAbs = absDayOfDateStr(x?.depotDate);
    const ref = todayAbsDay();
    if (depAbs === null || ref === null) return dayState;      // 缺日期 ⇒ 老口径 ✓
    const started = (typeof cycleStartAbs === 'number' && Number.isFinite(cycleStartAbs)) ? cycleStartAbs : null;
    const useAbs = (forceAbs === true) || (started !== null && depAbs < started);
    if (!useAbs) return dayState;                             // 同周期：两种口径等价 ⇒ 走老口径 ✓
    const left = untilAbs - ref;
    return { alive: left >= 0, left, abs: true, untilAbs, untilDay: dayState.untilDay, expired: left < 0 };
}

/** 这个对象"本周期第 1 天"的绝对天；拿不到（初始化 / 没日期 / 没周期日）⇒ null */
function cycleStartAbsOf(targetKey) {
    try {
        const d = cycleStartDateOf(String(targetKey || ''));
        if (!d) return null;
        return absDayOfDateStr(d);
    } catch { return null; }
}

/**
 * ★ **待受精精子那一栏**由插件算好喂回去。
 *
 * 为什么该插件干：账本里每批都有「入账的周期日」＋「存活到第几个周期日」，
 *   而提示词以前让 AI 自己写「最后一次内射日期与精子存活窗口」✗（它得去翻 row3 和 d2 的标注）。
 *
 * 形态（跟「距最近一次内射」拼成一句，省一栏）：`待受精精子 1 批，第14天入账，存活到第20天，还有 6 天`
 *   · 存活期没开（`viableUntil` 为空）⇒ 写「没设存活期，一直有效」
 *   · 存活期已过 ⇒ 写「存活期已过」
 *   · 没有批次 ⇒ 空串（调用方当"这一栏不发"处理 ✓）
 *
 * ⚠️ 单位是**周期天**（`depositDay` / `viableUntil` 都是周期日，见 recordInsemination 那段说明）
 *   ⇒ 文案里写明"第 N 天"，别让 AI 当成剧情日期 ✗
 */
export function pendingSpermForPrompt(targetKey = null) {
    try {
        const mine = listInseminations()
            .filter((x) => String(x.target || '') === String(targetKey || ''));
        if (!mine.length) return '';
        const nowDay = (() => {
            try { return cycleDayNow(targetKey); } catch { return null; }
        })();
        // ★ 本对象"本周期第 1 天"的绝对天（这一批属于上一个周期时才切口径 ✓）
        const startAbs = cycleStartAbsOf(targetKey);
        // 只看**还可能有活精子**的批次（判据与 viableFertility 同一条：走 `spermBatchState` ✓）
        const noCycle = (() => { try { return periodModeOf(targetKey) === 'amenorrhea'; } catch { return false; } })();
        const alive = mine.filter((x) => spermBatchState(x, nowDay, startAbs).alive);
        const last = mine[mine.length - 1];
        // ★ 这一栏给的是**写 row1 时该用的说法**（不是原始批数）——
        //   原因：模块里写「照抄这一栏」，给到"8 批"它就抄"8 批"，
        //   而规矩是 3 批及以上一律说「多批」（2026-10-23 她连问两次）
        const batchWord = alive.length === 0 ? '0 批'
            : (alive.length === 1 ? '1 批' : (alive.length === 2 ? '2 批' : '多批'));
        const bits = [`待受精精子 ${batchWord}`];
        if (alive.length) {
            const a = alive[alive.length - 1];
            const dep = Number(a.depositDay);
            if (Number.isFinite(dep) && !noCycle) bits.push(`最近一批第${dep}天入账`);
            else if (noCycle && a.depotDate) bits.push(`最近一批 ${a.depotDate} 入账`);
            const st = spermBatchState(a, nowDay, startAbs);
            if (st.abs) {
                // ★ 这一批属于上一个周期 ⇒ 周期日号会读歪 ⇒ 改说**日期**（跨周期也读得懂 ✓）
                const untilDate = (() => {
                    try { return addDays(FICTION_DATE_START, st.untilAbs) || ''; } catch { return ''; }
                })();
                bits.push(st.alive
                    ? `存活到 ${untilDate}（还有 ${st.left} 天）`
                    : `存活期已过（到 ${untilDate}）`);
            } else if (st.untilDay === null) {
                bits.push('没设存活期，一直有效');
            } else if (st.alive) {
                bits.push(noCycle
                    ? (st.left === null ? '还在存活期内' : `还在存活期内，还有 ${st.left} 天`)
                    : (st.left === null ? `存活到第${st.untilDay}天` : `存活到第${st.untilDay}天，还有 ${st.left} 天`));
            } else {
                bits.push(noCycle ? '存活期已过' : `存活期已过（到第${st.untilDay}天）`);
            }
        } else {
            bits.push(noCycle
                ? '最近一批存活期已过'
                : `最近一批存活期已过（最后入账第${Number.isFinite(Number(last.depositDay)) ? Number(last.depositDay) : '?'}天）`);
        }
        return bits.join('，');
    } catch { return ''; }
}

/**
 * ★ **距最近一次内射过了多久** —— 由插件算好喂回去。
 *
 * 为什么该插件干（原则：插件能计算的东西不要让 AI 代劳）：
 *   账本里每批都有周期日 ＋ 剧情钟点 ＋ 剧情日期，
 *   不该让 AI「根据 row3 的时间与当前周期日推算过了多久」✗ ——
 *   row3 是它自己写的描述，让它去推等于让它翻旧账。
 *
 * ⚠️ **能给到什么粒度，说清边界**（别假装能算小时）：
 *   · 剧情日期不一样 ⇒ 天数差是**准的**（"跨天"这一档就靠它）
 *   · 日期相同但两个钟点都有 ⇒ 小时差也是**准的**（`Story_Time` 模型每轮会报 ✓）
 *   · 日期相同、只有一边有钟点 ⇒ 小时差算不出来 ⇒ **只报事实**（两边的钟点照给，
 *     让 AI 自己看着办）—— 它知道的剧情细节比插件多，这一档交给它更准 ✓
 *   · 历法那档是「不记钟点」⇒ 只给天数差，不给小时 ✓
 *
 * 形态：一句人话（中文键），跟「上次结算」那条一个写法 ✓
 * @returns {string} 读不到（没有批次 / 没有日期）⇒ 空串（调用方当"这一栏不发"处理）
 */
export function inseminationElapsedForPrompt(targetKey = null) {
    try {
        const mine = listInseminations()
            .filter((x) => String(x.target || '') === String(targetKey || ''));
        if (!mine.length) return '';
        const last = mine[mine.length - 1];
        const depDate = String(last.depotDate || '');
        const today = currentDate() || '';
        const depClk = String(last.clk || '');
        const nowClk = (() => {
            try { return timeUnitNow() === 'none' ? '' : (formatClock(currentTime(), timeUnitNow()) || ''); } catch { return ''; }
        })();
        const bits = [`最近一次内射：第${last.round ?? '?'}轮`];
        if (depDate) {
            const back = diffDays(depDate, today);
            if (Number.isFinite(back)) bits.push(back === 0 ? '就在今天' : `距今 ${back} 天`);
        }
        // 同一天里才谈小时（跨天的话"几小时"没有意义，那已经是"跨天"那一档 ✓）
        const sameDay = !!(depDate && today && depDate === today);
        if (sameDay && depClk && nowClk) {
            try {
                const a = parseClock(depClk), b = parseClock(nowClk);
                if (a !== null && b !== null) {
                    const mins = b - a;
                    if (mins >= 0) bits.push(`约 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟前`);
                    else bits.push(`${depClk} 那次（当前钟点 ${nowClk}）`);
                }
            } catch { /* 认不出来 ⇒ 不写小时 ✓ */ }
        } else if (sameDay && depClk) {
            // 只有"那一次"的钟点、当前钟点不明 ⇒ 报事实，别硬算 ✓
            bits.push(`那一次在 ${depClk}`);
        }
        return bits.join('，');
    } catch { return ''; }
}

/**
 * ★ **孕周与着床后天数**由插件算好、喂给推演。
 *
 * 病根：正文两处（core 的「周期日与孕周由系统写好」、awareness 的「照抄【上一轮状态】的
 *   「怀孕状态」那一行」）都指着一个**推演提示里根本不存在**的项 ✗ ⇒
 *   模型找不到那个数，只能自己猜孕周，而「意识状态演化」那五档恰好是按孕周分的 ✗。
 *
 * 为什么该插件算：孕周 ＝ 周期日 ÷ 7（`deriveCycleFields` 一直在算，主 API 那份摘要用的也是它），
 *   着床后天数 ＝ 判定时存下的「着床完成日」⇄ 今天 ⇒ 两个数插件手上都有 ✓
 *   （口径：插件能计算的东西不要让 AI 代劳 ✓）
 *
 * 形态（跟主 API 摘要那行同口径）：`孕14周+3天 · 着床后 10 天 · 孕中期`
 *   · 没孕 ⇒ 空串（调用方当"这一项不发"处理 ✓）
 *   · 拿不到着床完成日（老记录）⇒ 只给孕周那半，**不假造天数** ✓
 */
export function pregnancyStateForPrompt(targetKey = null) {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return '';
        if (String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() !== 'true') return '';
        const dv = deriveCycleFields(t.vars || {}, periodModeOf(targetKey), periodDaysOf(targetKey), cycleDayNum(targetKey), pregDaysOf(targetKey));
        const weeks = String(dv?.sub || '').trim();
        if (!weeks) return '';
        const bits = [weeks];
        try {
            const done = String(getOvuJudgment(targetKey)?.doneDate || '').trim();
            if (done) {
                const back = diffDays(done, currentDate());
                if (Number.isFinite(back) && back >= 0) bits.push(`着床后 ${back} 天`);
            }
        } catch { /* 算不出这一半就不写 ✓ */ }
        if (dv?.phase) bits.push(dv.phase);
        return bits.join(' · ');
    } catch { return ''; }
}

// ---------------------------------------------------------------------------
// ★ A3（2026-10-14）：**意识状态**（d5 的前半截）由插件算
//
// 以前：模型每轮读正文里那张 A~E 大表，拿孕周去比，自己判「该不该怀疑 / 该不该确认」✗
//   （表是设置里的格子、孕周是插件算的 ⇒ 它做的只是"查表"这件事）
// 现在：档位问一次（角色设定）、区间算一次、状态由这里出 ✓
//
// 口径（照正文那几句，一条都不多编）：
//   · 孕周**为主**、着床后天数为**括号里的补充**（正文自己这么写的）⇒ 先按孕周整周比，
//     孕周算不出来才退回着床后天数 ✓
//   · 档位没定过 ⇒ 按 C 档（正文："信息不足或无法判断时，默认 C档" ✓）
//   · 时间表用完（上限 孕32周 / 着床后203天）还没确认 ⇒ 强制已确认 ✓
//   · 剧情强制提前（验孕 / 就医 / 他人告知）＝模型报一次事实，插件记着，**只前进不后退** ✓
// ---------------------------------------------------------------------------

/** 状态名的顺序（只前进不后退全靠它 ✓） */
export const AWARENESS_STATES = ['未察觉', '怀疑但未确认', '已确认怀孕'];

/** 模型报的那半截 d5 → 只留「致孕方知情情况」（认不出就原样用 ✓） */
function awarenessHalfOf(v) {
    let s = String(v ?? '').trim();
    if (!s || s === '未加载') return '';
    // 去掉「意识状态 |」这类标签（半角 / 全角竖线都认）
    const parts = s.split(/[|｜]/);
    if (parts.length > 1) s = parts[parts.length - 1].trim();
    // 老口径写成「未察觉 · 尚未知晓致孕方身份」⇒ 把前面那个状态值也丢掉 ✓
    const m = s.match(/^(未察觉|怀疑但未确认|已确认怀孕)\s*[·・]\s*(.+)$/);
    if (m) return m[2].trim();
    if (AWARENESS_STATES.includes(s)) return '';
    return s;
}

/** 孕周（整周；喂给推演那行、A3 的档位、A5 的发育描述都用它 —— 一份算法 ✓） */
function pregWeeksOf(targetKey) {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return null;
        const dv = deriveCycleFields(t.vars || {}, periodModeOf(targetKey), periodDaysOf(targetKey), cycleDayNum(targetKey), pregDaysOf(targetKey));
        const m = String(dv?.sub || '').match(/孕\s*(\d+)\s*周/);
        return m ? Number(m[1]) : null;
    } catch { return null; }
}

/**
 * ★ 2026-10-24：只递两个事实，不判这一楼是几周。
 *
 *   · 上次写过：模型上次写这句时是哪一档（从 d6 概述里认表里的原句）
 *   · 上一轮结束时：上一轮结束时孕几周、落在哪一档（同一个孕周来源，纯事实）
 *
 * 这一楼跳了多久、写着写着过了几天，只有插件 API 从正文里看得到；
 *   它拿「上一轮结束时」这一档当起点自己往后算，跨没跨档也由它判。
 */
export function fetusGrowthStageForPrompt(targetKey = null) {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return null;
        if (String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() !== 'true') return null;
        const lines = fetusDevAllLines(targetKey);
        if (!lines.length) return null;
        const d6 = String(t?.profile?.d6 || '');
        const last = lines
            .filter((x) => x.desc && d6.includes(x.desc))
            .sort((a, b) => b.from - a.from)[0] || null;
        const week = pregWeeksOf(targetKey);
        const cur = Number.isFinite(week)
            ? (lines.find((x) => week >= x.from && week <= x.to) || null)
            : null;
        return {
            week: Number.isFinite(week) ? week : null,
            cur: cur ? { from: cur.from, to: cur.to } : null,
            last: last ? { from: last.from, to: last.to } : null,
        };
    } catch { return null; }
}

/**
 * ★ 2026-10-24：意识状态的手动保底（改数值 → 既成事实）。
 *   `state`：'' = 自动；否则 未察觉 / 怀疑但未确认 / 已确认怀孕
 *   `knownName`：null = 自动；'' = 尚未知晓；非空 = 已知晓（名字）
 * 设了 state 就不再让插件按孕周自动推进；设了 knownName 就压过模型报的那半截。
 */
export function awarenessManualOf(targetKey = null) {
    const t = state().targets?.[String(targetKey || '')];
    const m = t?.awarenessManual;
    return {
        state: String(m?.state || ''),
        knownName: (m && Object.prototype.hasOwnProperty.call(m, 'knownName')) ? String(m.knownName || '') : null,
    };
}

export function setAwarenessManualOf(targetKey = null, patch = {}) {
    const t = state().targets?.[String(targetKey || '')];
    if (!t) return false;
    const cur = awarenessManualOf(targetKey);
    const next = {
        state: ('state' in patch) ? String(patch.state || '') : cur.state,
        knownName: ('knownName' in patch) ? patch.knownName : cur.knownName,
    };
    if (!['', '未察觉', '怀疑但未确认', '已确认怀孕'].includes(next.state)) next.state = '';
    if (next.state === '' && next.knownName === null) delete t.awarenessManual;
    else {
        const m = {};
        if (next.state) m.state = next.state;
        if (next.knownName !== null) m.knownName = String(next.knownName || '');
        t.awarenessManual = m;
    }
    commit();
    return true;
}

export function clearAwarenessManualOf(targetKey = null) {
    const t = state().targets?.[String(targetKey || '')];
    if (!t) return false;
    if ('awarenessManual' in t) { delete t.awarenessManual; commit(); }
    return true;
}

/**
 * ★ 2026-10-24（她定）：**状态只认剧情事件**，档位表只做参考。
 *   以前是「档位区间 × 孕周」自动推到怀疑 / 确认 ⇒ 7 周 C 档就自动"已确认"，
 *   可剧情里根本没人知道。现在：
 *     · 状态只由 `awarenessEvent`（模型报的剧情事件）推进，只进不退；
 *     · 档位表只用来给 AI 一句参考（`awarenessReferenceForPrompt`），不写状态；
 *     · 手动保底仍可压过一切。
 */
export function awarenessStateOf(targetKey = null) {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return '';
        if (!isModuleOn('awareness')) return '';
        // 怀没怀：插件自己那格 ＋ 玩家那把"不能怀孕"的锁（跟 fertilityRateTextOf 同一个口径 ✓
        //   ⚠️ `isPregnant()` 在 prompt.js 里，而 prompt.js 依赖 store.js ⇒ 这儿不能反向 import ✓）
        let lockA = null;
        try { lockA = bodyLockOf(targetKey); } catch { /* 忽略 */ }
        const isPregA = String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true'
            && !(lockA && lockA.canBePregnant === false);
        if (!isPregA) return '未加载';
        // ★ 手动保底优先（设了就不看剧情事件）
        if (t?.awarenessManual?.state) return String(t.awarenessManual.state);
        const ev = awarenessEventOf(targetKey);
        if (ev === '确认') return '已确认怀孕';
        if (ev === '怀疑') return '怀疑但未确认';
        return '未察觉';
    } catch { return ''; }
}

/**
 * ★ 2026-10-24：给 AI 的「察觉参考」——档位表只在这里用，**不写状态**。
 *   告诉它：按这个角色的察觉档位和现在的孕周，大概到哪一步了；
 *   但"有没有确认"只认剧情事件。
 * @returns {string} 空串 = 没孕 / 模块没开 / 孕周算不出来
 */
export function awarenessReferenceForPrompt(targetKey = null) {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return '';
        if (!isModuleOn('awareness')) return '';
        if (String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() !== 'true') return '';
        const st = awarenessStateOf(targetKey);
        const tier = awarenessTierIdOf(targetKey) || 'C';
        const w = awarenessWindowsOf(tier);
        const up = awarenessUpperOf();
        let weeks = pregWeeksOf(targetKey);
        let days = null;
        try {
            const done = String(getOvuJudgment(targetKey)?.doneDate || '').trim();
            if (done) {
                const back = diffDays(done, currentDate());
                if (Number.isFinite(back) && back >= 0) days = back;
            }
        } catch { /* 两个都拿不到 ⇒ 空串 */ }
        if (weeks === null && days === null) return '';
        // 同一个档位表，两种口径都有就按孕周（跟老算法一致 ✓）
        const at = (wv, dv) => (weeks !== null ? weeks >= wv : days >= dv);
        let ref;
        if (st === '已确认怀孕') ref = '她已经确认过了';
        else if (at(w.confW0, w.confD0)) ref = '按她的察觉档位，这个阶段可能会去确认（验孕 / 就医 / 问人），但剧情没发生就还没确认';
        else if (at(w.suspW0, w.suspD0)) ref = '按她的察觉档位，这个阶段可能开始留意身体变化、起疑，但还没确认';
        else ref = '按她的察觉档位，这个阶段还不会往怀孕上想';
        if (tier !== 'F' && st !== '已确认怀孕' && at(up.week, up.days)) ref += '（参考表的时间已经走到上限，但她还是没确认）';
        return ref;
    } catch { return ''; }
}

/**
 * ★ A3：把 `d5` 整个值拼出来（前半截＝插件算的状态，后半截＝模型报的「致孕方知情」）。
 *
 * 形态：`未察觉 · 尚未知晓致孕方身份`
 *   ⚠️ **不带「意识状态 |」那个标签** —— 面板渲染时自己会补（serialize.js 的裸项 ✓）
 * @param {string} aiValue 模型这回报的 d5（可能是老口径的整串）
 * @returns {string} 空串 = 这次不动它（模块没开 / 状态算不出来 ⇒ 保留原值，绝不清空 ✓）
 */
export function awarenessTextOf(targetKey = null, aiValue = '') {
    try {
        const t = state().targets?.[targetKey];
        if (!t) return '';
        const st = awarenessStateOf(targetKey);
        if (!st) return '';
        if (st === '未加载') return '未加载';
        // ★ 2026-10-24：手动保底的那半截优先（knownName 设了就不看模型报的）
        const man = t?.awarenessManual;
        let half;
        if (man && Object.prototype.hasOwnProperty.call(man, 'knownName')) {
            half = man.knownName
                ? `已知晓致孕方身份（${String(man.knownName)}）`
                : '尚未知晓致孕方身份';
        } else {
            half = awarenessHalfOf(aiValue) || awarenessHalfOf(t.profile?.d5) || '尚未知晓致孕方身份';
        }
        // 硬规矩：只有「已确认怀孕」之后才允许出现「已知晓致孕方身份」✓
        const fixed = (st !== '已确认怀孕' && /已知晓/.test(half)) ? '尚未知晓致孕方身份' : half;
        return `${st} · ${fixed}`;
    } catch { return ''; }
}

// ---------------------------------------------------------------------------
// ★ A5（2026-10-14）：**胎数 / 孩子性别**由插件判、写进 d6
//
// 以前：池里的数是插件发的、表在正文里，而"取数 ＋ 查表"是模型干的 ✗
//   （它查错就写错 d6，而 d6 还要用来落孩子账本 ⇒ 一错到底）
// 现在：表仍住正文（玩家能改概率 ✓），插件把它读出来（settings 的 `fetusCountTableOf`），
//   在着床完成之后自己取数、自己判，结果存进 `targets[key].fetusPlan`；
//   每轮再把 d6 的**胎数与各胎性别**按 plan 对齐（模型那份当素材：种族 / 致孕方 / 发育描述留着 ✓）
//
// ★ 同卵 / 异卵（跟胎数同一轮、排在性别前面）：
//   胎数 ≥ 2 时才多掷一次，结果也并进 plan（`sameOvum`）；同卵 ⇒ 各胎的
//   性别 / 致孕方 / 种族 / 显性隐性 全跟子1 一样（同一个基因组 ✓），d6 概述写成「双胎（同卵）」
//   ⚠️ 单胎不掷（没什么同卵异卵之分）；正文那段认不出 ⇒ `sameOvum = null` ＝ 老行为 ✓
//
// ⚠️ 只接管**没走异种表**的胎（异种那两套按族逐行判，写在异种包里 ⇒ 先不碰，老行为一字不变 ✓）
// ⚠️ 表认不出来 / 数不够 ⇒ 返回 null ⇒ 调用方什么都不做（老行为一字不变 ✓）
// ---------------------------------------------------------------------------

/** 胎数的中文词（d6 概述开头那个词 ✓） */
const FETUS_COUNT_WORDS = { 1: '单胎', 2: '双胎', 3: '三胎', 4: '四胎', 5: '五胎', 6: '六胎' };

/** 这个对象的胎数 / 性别判定结果（null = 还没判过 / 这一胎不走人类表 ✓） */
export function fetusPlanOf(key) {
    if (!key) return null;
    const p = state().targets?.[key]?.fetusPlan;
    return (p && Number(p.count) >= 1) ? p : null;
}

export function setFetusPlanOf(key, plan) {
    const t = state().targets?.[key];
    if (!t) return false;
    if (plan && Number(plan.count) >= 1) t.fetusPlan = plan; else delete t.fetusPlan;
    commit();
    return true;
}

/**
 * ★ 这一胎是不是同卵 —— 判据两处，任一成立即算：
 *   ① 插件判出来那份（`fetusPlan.sameOvum`）
 *   ② d6 概述里写着「（同卵）」：**玩家自己手改过那一格时以文字为准** ✓
 *      （手改锁之后插件不再改写 d6 ⇒ 那段文字就是事实源；不然会出现
 *        "面板概述写着同卵、致孕方那格却列着两个人"这种自相矛盾 ✗ 玩家明确交代过不可能异父）
 *   ⚠️ 单胎写「（同卵）」算乱写，不当真（只有 ≥ 2 胎才算 ✓）
 */
export function sameOvumOf(key) {
    try {
        if (fetusPlanOf(key)?.sameOvum === true) return true;
        const raw = String(state().targets?.[String(key || '')]?.profile?.d6 || '');
        if (!raw.includes('（同卵）')) return false;
        return (parseFetus(raw).kids || []).length >= 2;
    } catch { return false; }
}

/** 判「这是不是人类的孩子」—— d6 里没写种族时默认人类（跟 `applyFetusPlanOf` 的兜底一致 ✓） */
const HUMAN_RACES = ['人类', '人', '人族'];
function isHumanRace(race) {
    const r = String(race || '').trim();
    if (!r) return true;
    return HUMAN_RACES.includes(r) || /^人类/.test(r);
}

/**
 * 孩子性别的**用词**：人类写「男 / 女」，非人类写「雄 / 雌」。
 *
 * 判据：同一个事实按对象换词 —— 人类孩子的性别不写成「雄 / 雌」那种说法。
 * 数据里两种写法都可能出现（插件判的、模型写的、老存档的）⇒ 这里统一按种族归一 ✓
 */
export function sexWordForRace(race, sex) {
    const s = String(sex || '').trim();
    if (!s) return '';
    if (isHumanRace(race)) return s.replace(/^雄/, '男').replace(/^雌/, '女');
    return s.replace(/^男/, '雄').replace(/^女/, '雌');
}

/**
 * 池里的数 ＋ 正文那几张表 ⇒ `{count, sexes:['男','女'…], sameOvum}`（认不出 ⇒ null ✓）。
 * @param {number} countValue 用途「胎数判定」的那个 1-100 数
 * @param {number[]} sexValues 用途「子N性别」的那些数（按胎位顺序 ✓）
 * @param {number|null} ovumValue 用途「同卵判定」的那个 1-100 数（只有多胎才掷 ✓）
 *
 * ★ 同卵：胎数 ≥ 2 时才判，跟胎数同一轮、排在性别前面。
 *   · 同卵 ⇒ 各胎性别**必然一样**（同一个基因组）⇒ 这里直接把子1 那个铺满
 *   · 表认不出 / 没给数 ⇒ `sameOvum = null` ⇒ 调用方照旧各自独立（老行为 ✓）
 */
export function makeFetusPlan(targetKey, countValue, sexValues, ovumValue = null, groupsIn = null) {
    try {
        const count = fetusCountOf(targetKey, countValue);
        if (!(count >= 1 && count <= 8)) return null;      // 认不出 / 离谱 ⇒ 不接管 ✓
        const sexR = fetusSexRangeOf(targetKey);
        if (!sexR) return null;                           // 性别表认不出 ⇒ 整件不接管（宁可不做 ✗）
        const list = Array.isArray(sexValues) ? sexValues : [];
        const sexes = [];
        for (let i = 0; i < count; i++) {
            const v = Number(list[i]);
            if (!Number.isFinite(v)) { sexes.push(''); continue; }
            sexes.push(v >= sexR.male[0] && v <= sexR.male[1] ? '男'
                : (v >= sexR.female[0] && v <= sexR.female[1] ? '女' : ''));
        }
        let sameOvum = null;
        let groups = null;
        if (count >= 2) {
            const ovR = fetusOvumRangeOf(targetKey);
            const v = Number(ovumValue);
            if (ovR && Number.isFinite(v)) {
                sameOvum = (v >= ovR.same[0] && v <= ovR.same[1]);
            }
            // ★ 2026-10-23：分组（兼容老行为）
            //   · 全同卵 ⇒ 一个组；全异卵 ⇒ 每人一个组；混合 ⇒ 调用方给的分组（一对同卵＋其余异卵）
            //   ⚠️ 判定表认不出（sameOvum 仍是 null）⇒ **不分、也不声明**（老行为一字不变 ✓）
            if (sameOvum === true) {
                groups = [{ kids: Array.from({ length: count }, (_, i) => i), same: true }];
            } else if (sameOvum === false) {
                groups = (Array.isArray(groupsIn) && groupsIn.length)
                    ? groupsIn
                    : Array.from({ length: count }, (_, i) => ({ kids: [i], same: false }));
            }
            // 同卵组内：性别照抄第一个（一个基因组 ✓）
            for (const g of groups) {
                if (!g || !Array.isArray(g.kids) || g.kids.length < 2 || !g.same) continue;
                const first = Number(g.kids[0]);
                for (const k of g.kids.slice(1)) {
                    const ki = Number(k);
                    if (Number.isFinite(ki) && ki >= 0 && ki < sexes.length) sexes[ki] = sexes[first] ?? '';
                }
            }
        }
        return { count, sexes, sameOvum, groups };
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// ★ 2026-10-24：天赋判定 / 显性来源的**分组**（人类、类人异种、卵群共用一套）
//
// 为什么不再看"人类胎那份判定记录"：异种走种族表、卵群只有一句概括，都没有那份记录，
//   结果是骰子根本不掷 ⇒ 模型只能自己编。分组只认 d6（大家都往这里写）。
// 顺序：① 人类判过且记着分组 → 用它（当时锁定，最准）
//       ② d6 概述里的同卵标记（「（同卵）」／「同卵：子1、子2」）
//       ③ 每个孩子一组
//       ④ 没有逐胎（卵群）→ 整批一组
// 存的位置：对象自己身上（`heritageRolls`），不再塞进人类胎那份记录；
//   老存档还在老位置的，读的时候兼容过来 ✓
// ---------------------------------------------------------------------------

function rndD100() { return Math.floor(Math.random() * 100) + 1; }

/** 从 d6 概述里的同卵标记推分组（认不出 ⇒ null） */
function sameOvumGroupsFromD6(key, n) {
    try {
        if (n < 2) return null;
        const d6 = String(state().targets?.[String(key || '')]?.profile?.d6 || '');
        // ⚠️ 只取到下一个分隔符为止：`（同卵：子1、子2；异卵：子3）` 里那个「子3」不能算进同卵组 ✗
        const m = d6.match(/同卵\s*[:：]\s*([^）)；;\n]*)/);
        if (m) {
            const idx = [];
            const re = /子\s*(\d+)/g;
            let x;
            while ((x = re.exec(m[1]))) idx.push(Number(x[1]) - 1);
            const ks = idx.filter((i) => i >= 0 && i < n);
            if (ks.length >= 2) {
                const set = new Set(ks);
                const out = [{ kids: ks, same: true }];
                for (let i = 0; i < n; i++) if (!set.has(i)) out.push({ kids: [i], same: false });
                return out;
            }
        }
        if (/（同卵）/.test(d6)) return [{ kids: Array.from({ length: n }, (_, i) => i), same: true }];
        return null;
    } catch { return null; }
}

/** 这一胎的分组：`[{kids:[下标…], same, bulk?}]`（不依赖是不是异种 ✓） */
export function heritageGroupsOf(key) {
    const k = String(key || '');
    const t = state().targets?.[k];
    let kids = [];
    try { kids = parseFetus(t?.profile?.d6 || '').kids || []; } catch { kids = []; }
    const n = kids.length;
    // ④ 没有逐胎（卵群那种一句概括）⇒ 整批一组
    if (!n) return [{ kids: [], same: false, bulk: true }];
    // ① 人类判过、且记着分组
    const plan = t?.fetusPlan;
    if (plan && Array.isArray(plan.groups) && plan.groups.length) {
        const out = [];
        const covered = new Set();
        for (const g of plan.groups) {
            const ks = (g?.kids || []).map(Number).filter((i) => i >= 0 && i < n);
            if (!ks.length) continue;
            for (const i of ks) covered.add(i);
            out.push({ kids: ks, same: !!(g.same && ks.length > 1) });
        }
        for (let i = 0; i < n; i++) if (!covered.has(i)) out.push({ kids: [i], same: false });
        if (out.length) return out;
    }
    // ② d6 概述里的同卵标记
    const g2 = sameOvumGroupsFromD6(k, n);
    if (g2) return g2;
    // ③ 每个孩子一组
    return Array.from({ length: n }, (_, i) => ({ kids: [i], same: false }));
}

/** 分组的指纹：组变了（换胎 / 孩子数变 / 同卵标记变）才重掷 ✓ */
function heritageSigOf(groups) {
    return JSON.stringify((groups || []).map((g) => [(g.kids || []).join(','), !!g.same, !!g.bulk]));
}

/** 这一胎掷过的结果（对象级；老存档在人类胎记录里的也要读得到 ✓） */
export function heritageRollsOf(key) {
    const k = String(key || '');
    const t = state().targets?.[k];
    const at = t?.heritageRolls;
    const plan = t?.fetusPlan;
    const pick = (a, b) => ((a && Array.isArray(a.groups)) ? a : ((b && Array.isArray(b.groups)) ? b : null));
    return {
        talent: pick(at?.talent, plan?.talent),
        domSrc: pick(at?.domSrc, plan?.dominantSrc),
    };
}

function saveHeritageRolls(key, patch) {
    const t = state().targets?.[String(key || '')];
    if (!t) return;
    if (!t.heritageRolls || typeof t.heritageRolls !== 'object') t.heritageRolls = {};
    Object.assign(t.heritageRolls, patch, { at: Date.now() });
}

/**
 * 掷（或取现成的）这一胎的天赋判定：`{form, groups:[{kids,same,bulk,roll,tier}]}`
 * · 同卵组共用一颗（一个基因组），异卵各一颗，卵群整批一颗 ✓
 */
export function rollTalentFor(key) {
    const k = String(key || '');
    if (!state().targets?.[k]) return null;
    const groups = heritageGroupsOf(k);
    const sig = heritageSigOf(groups);
    const have = heritageRollsOf(k).talent;
    if (have && have.sig === sig) return have;
    const out = { sig, at: Date.now(), form: Math.floor(Math.random() * 2) + 1, groups: [] };
    for (const g of groups) {
        const roll = rndD100();
        out.groups.push({
            kids: g.kids, same: g.same, bulk: !!g.bulk,
            roll, tier: talentTierLabelOf(roll, k) || '',
        });
    }
    saveHeritageRolls(k, { talent: out });
    commit();
    return out;
}

/**
 * ★ 2026-10-24：显性来源也掷（她：AI 真的会偷懒）——
 *   骰子决定不了长相，但能决定**从哪一边取**；每个孩子抽到的来源不同，
 *   写出来就不可能几个孩子一模一样 ✓ 同卵组共用一颗，卵群整批一颗。
 */
export function rollDominantSrcFor(key) {
    const k = String(key || '');
    if (!state().targets?.[k]) return null;
    const range = dominantSourceRangeOf(k);
    if (!range) return null;                       // 正文没有这一行 ⇒ 完全不掷（老行为 ✓）
    const groups = heritageGroupsOf(k);
    const sig = heritageSigOf(groups);
    const have = heritageRollsOf(k).domSrc;
    if (have && have.sig === sig) return have;
    const out = { sig, at: Date.now(), groups: [] };
    for (const g of groups) {
        const roll = rndD100();
        out.groups.push({
            kids: g.kids, same: g.same, bulk: !!g.bulk,
            roll, mode: dominantSourceOf(roll, k) || '',
        });
    }
    saveHeritageRolls(k, { domSrc: out });
    commit();
    return out;
}

/**
 * ★ 2026-10-24：同卵组内「显性 / 隐性 / 天赋」必须一致 ——
 *   人类那条靠 `applyFetusPlanOf` 的组统一；异种没有那份记录，所以要单独做一次 ✓
 *   以组里第一个有内容的孩子为准，其余照它写；**跟种族无关**。
 *   ⚠️ 手改过 d6 的对象不动（那是玩家的）✓
 * @returns {boolean} 有没有改动
 */
export function unifySameOvumTraits(targetKey = null) {
    try {
        const key = String(targetKey || '');
        const t = state().targets?.[key];
        if (!t) return false;
        if (isProfileFieldFixed(key, 'd6')) return false;
        const groups = heritageGroupsOf(key).filter((g) => g.same && (g.kids || []).length > 1);
        if (!groups.length) return false;
        const f = parseFetus(t.profile?.d6 || '');
        if (!Array.isArray(f.kids) || !f.kids.length) return false;
        let changed = false;
        for (const g of groups) {
            const ks = g.kids.filter((i) => i >= 0 && i < f.kids.length);
            if (ks.length < 2) continue;
            const pick = (field) => {
                for (const i of ks) {
                    const v = String(f.kids[i]?.[field] || '').trim();
                    if (v) return v;
                }
                return '';
            };
            const extra = pick('extra');
            const talent = pick('talent');
            const strength = pick('strength');
            for (const i of ks) {
                if (extra && String(f.kids[i].extra || '').trim() !== extra) { f.kids[i].extra = extra; changed = true; }
                if (talent && String(f.kids[i].talent || '').trim() !== talent) { f.kids[i].talent = talent; changed = true; }
                if (strength && String(f.kids[i].strength || '').trim() !== strength) { f.kids[i].strength = strength; changed = true; }
            }
        }
        if (!changed) return false;
        if (!t.profile || typeof t.profile !== 'object') t.profile = {};
        t.profile.d6 = buildFetus(f.head, f.kids);
        commit();
        return true;
    } catch { return false; }
}

/** 五档 ⇒ 天赋「强度」那一格的说法（跟区间表一一对应；序号是表里的顺序 ✓） */
const TALENT_STRENGTH_WORDS = ['起点高于亲代', '起点高于亲代', '与亲代同级', '还没成体系', '只剩一部分'];

/** 档位名 ⇒ 强度说法（认不出 ⇒ 空串 ✓） */
export function talentStrengthOfTier(tier, key = null) {
    try {
        const i = talentTierTableOf(key).findIndex((x) => String(x.label) === String(tier));
        return (i >= 0 && TALENT_STRENGTH_WORDS[i]) ? TALENT_STRENGTH_WORDS[i] : '';
    } catch { return ''; }
}

/**
 * ★ 2026-10-24：把「强度」写进 d6（这一格由**插件**填，不让模型转述档位）——
 *   模型只写天赋内容，强度按这一胎掷出的档位填；手改过 d6 的对象不动 ✓
 * @returns {boolean} 有没有改动
 */
export function applyTalentStrength(key) {
    try {
        const k = String(key || '');
        const t = state().targets?.[k];
        if (!t) return false;
        if (isProfileFieldFixed(k, 'd6')) return false;
        const rolls = heritageRollsOf(k).talent;
        if (!rolls || !Array.isArray(rolls.groups)) return false;
        const f = parseFetus(t.profile?.d6 || '');
        if (!Array.isArray(f.kids) || !f.kids.length) return false;
        let changed = false;
        for (const g of rolls.groups) {
            // ★ 2026-10-24（她：双方都拿到那个强度忘了做）——
            //   第一档的强度要分三种形态（并列 / 同源加强 / 混合变异），只有模型知道是哪一种
            //   ⇒ 这一档**不覆盖**它写的强度；它没写才兜一个最简说法 ✓
            const idxOfTier = (() => {
                try { return talentTierTableOf(k).findIndex((x) => String(x.label) === String(g.tier)); } catch { return -1; }
            })();
            if (idxOfTier === 0) {
                const cur = String(f.kids?.[(g.kids || [])[0]]?.strength || '').trim();
                if (cur) continue;
            }
            // ★★ 2026-10-24（构建 -100）：强度**跟着天赋内容同一轮落** ——
            //   这一胎还没有「天赋」内容（模型没写、或只写了"无"）时，**不许**先把强度写进 d6：
            //   那会让那一格看着像"判过了"，实际三格是空的（她就是这么被绕进去的 ✗）
            const talOf = (i) => {
                const v = String(f.kids?.[i]?.talent || '').trim();
                return !!v && v !== '无' && v !== '无。';
            };
            const gk = (g.kids || []).filter((i) => i >= 0 && i < f.kids.length);
            if (!gk.some(talOf)) continue;      // 这一组还没有天赋内容 ⇒ 强度一律不写
            // ★★ 2026-10-24（按原文补严）：第一档的强度**不许用档位名**（以前兜「两边都拿到」，
            //   那是档位名不是强度 ✗）⇒ 模型没写就按形态骰给：1 混合变异、2 并列继承。
            //   同源加强（两边同一类）由模型写「超过父母双方」，插件分不出来，不猜 ✓
            const word = (idxOfTier === 0)
                ? (Number(rolls.form) === 1 ? '两样揉成一个新方向，比原来宽' : '起点高于亲代')
                : talentStrengthOfTier(g.tier, k);
            if (!word) continue;
            for (const i of gk) {
                if (!talOf(i)) continue;        // 没天赋的那个孩子也不写强度
                if (String(f.kids[i].strength || '') !== word) { f.kids[i].strength = word; changed = true; }
            }
        }
        if (!changed) return false;
        if (!t.profile || typeof t.profile !== 'object') t.profile = {};
        t.profile.d6 = buildFetus(f.head, f.kids);
        commit();
        return true;
    } catch { return false; }
}

/** 取（没有就先掷）这一胎的两组结果 —— 弹窗打开时用 ✓ */
export function ensureHeritageRollsFor(key) {
    const tal = rollTalentFor(key);
    const dom = rollDominantSrcFor(key);
    return { talent: tal, domSrc: dom };
}

/** 重掷某一组天赋（不花调用）；gi 是组下标 ✓ */
export function rerollTalentGroup(key, gi) {
    const k = String(key || '');
    const rolls = heritageRollsOf(k).talent;
    if (!rolls || !Array.isArray(rolls.groups)) return null;
    const g = rolls.groups[Number(gi)];
    if (!g) return null;
    g.roll = rndD100();
    g.tier = talentTierLabelOf(g.roll, k) || '';
    rolls.at = Date.now();
    saveHeritageRolls(k, { talent: rolls });
    commit();
    applyTalentStrength(k);
    return g;
}

/** 手动指定某一组天赋的档位（修改器口径：不掷，直接定）✓ */
export function setTalentGroupTier(key, gi, tier) {
    const k = String(key || '');
    const rolls = heritageRollsOf(k).talent;
    if (!rolls || !Array.isArray(rolls.groups)) return null;
    const g = rolls.groups[Number(gi)];
    if (!g) return null;
    const table = talentTierTableOf(k);
    const i = table.findIndex((x) => String(x.label) === String(tier));
    if (i < 0) return null;
    g.tier = table[i].label;
    g.roll = Math.round((table[i].from + table[i].to) / 2);   // 手定时给个落在区间里的代表值
    g.manual = true;
    rolls.at = Date.now();
    saveHeritageRolls(k, { talent: rolls });
    commit();
    applyTalentStrength(k);
    return g;
}

/** 重掷某一组显性来源 ✓ */
export function rerollDominantGroup(key, gi) {
    const k = String(key || '');
    const rolls = heritageRollsOf(k).domSrc;
    if (!rolls || !Array.isArray(rolls.groups)) return null;
    const g = rolls.groups[Number(gi)];
    if (!g) return null;
    g.roll = rndD100();
    g.mode = dominantSourceOf(g.roll, k) || '';
    rolls.at = Date.now();
    saveHeritageRolls(k, { domSrc: rolls });
    commit();
    return g;
}

/** 手动指定某一组显性来源 ✓ */
export function setDominantGroupMode(key, gi, mode) {
    const k = String(key || '');
    const rolls = heritageRollsOf(k).domSrc;
    if (!rolls || !Array.isArray(rolls.groups)) return null;
    const g = rolls.groups[Number(gi)];
    if (!g) return null;
    const r = dominantSourceRangeOf(k);
    if (!r) return null;
    const hit = [[r.matLabel, r.mat], [r.patLabel, r.pat], [r.bothLabel, r.both]]
        .find(([lab]) => String(lab) === String(mode));
    if (!hit) return null;
    g.mode = hit[0];
    g.roll = Math.round((hit[1][0] + hit[1][1]) / 2);
    g.manual = true;
    rolls.at = Date.now();
    saveHeritageRolls(k, { domSrc: rolls });
    commit();
    return g;
}

/** 两组一起自动重掷（不花调用）✓ */
export function rerollHeritageAll(key) {
    const k = String(key || '');
    const tal = heritageRollsOf(k).talent;
    const dom = heritageRollsOf(k).domSrc;
    for (let i = 0; i < (tal?.groups || []).length; i++) rerollTalentGroup(k, i);
    for (let i = 0; i < (dom?.groups || []).length; i++) rerollDominantGroup(k, i);
    return heritageRollsOf(k);
}

/**
 * 胎数词 + 同卵 / 异卵标签：`单胎` / `双胎（同卵）` / `三胎（异卵）` /
 * `三胎（同卵：子1、子3；异卵：子2）`
 * ★ 两处共用（d6 概述头、发给模型的胎儿摘要）—— 判据只写一份 ✓
 */
function fetusCountParts(n, sameOvum = null, groups = null) {
    const count = Math.max(1, Number(n) || 1);
    const word = FETUS_COUNT_WORDS[count] || `${count}胎`;
    // ★ 2026-10-23：多胎一律标清——同卵「（同卵）」、异卵「（异卵）」、
    //   混合「（同卵：子1、子2；异卵：子3）」，别再让"没标"代表异卵 ✓
    let tag = '';
    if (count >= 2) {
        const same = [];
        const diff = [];
        if (Array.isArray(groups) && groups.length) {
            for (const g of groups) {
                const kids = Array.isArray(g?.kids) ? g.kids : [];
                for (const k of kids) (g.same && kids.length > 1 ? same : diff).push(Number(k) + 1);
            }
        } else if (sameOvum === true) {
            for (let i = 1; i <= count; i++) same.push(i);
        } else if (sameOvum === false) {
            for (let i = 1; i <= count; i++) diff.push(i);
        }
        same.sort((a, b) => a - b);
        diff.sort((a, b) => a - b);
        if (same.length && diff.length) {
            tag = `（同卵：${same.map((i) => '子' + i).join('、')}；异卵：${diff.map((i) => '子' + i).join('、')}）`;
        } else if (same.length) tag = '（同卵）';
        else if (diff.length) tag = '（异卵）';
    }
    return { word, tag };
}

/** d6 概述开头那个词按 plan 对齐（没有就补在最前面 ✓）；同卵 / 异卵 / 混合都标出来 */function fixFetusHead(head, n, sameOvum = null, groups = null) {
    const { word, tag } = fetusCountParts(n, sameOvum, groups);
    let s = String(head || '').trim();
    // ★ 2026-10-24：旧句被换掉后可能留下「· 。」这种空分隔段 ⇒ 每次重写头部时顺手清掉 ✓
    s = s.replace(/\s*·\s*[。；;]+\s*(?=·|$)/g, ' · ')
        .replace(/(?:\s*·\s*){2,}/g, ' · ')
        .trim();
    // 开头那个胎数词（连同上一轮可能写的标签）每次按这次判定重写，后面一个字不动 ✓
    const re = /^\s*(单胎|双胞胎|双胎|三胎|四胎|五胎|六胎|多胎|\d+\s*胎)\s*(?:（(?:同卵|异卵)[^）]*）)?/;
    if (!re.test(s)) return s ? `${word}${tag} · ${s}` : `${word}${tag}`;
    return s.replace(re, word + tag);
}

/**
 * ★★ 发给模型的「胎儿摘要」（主 API 与插件 API 共用）—— 只给四样：
 *   **胎数（同卵 / 异卵）· 每胎性别 · 致孕方**。
 *   ⚠️ 显性 / 隐性携带 / 天赋 / 强度 / 发育描述**一概不发**：
 *     那几格是面板与「出生后的孩子账本」用的，两个模型只需要知道"怀了几个、什么性别、是谁的" ✓
 *   ⚠️ 孕周不在这里 —— 主 API 与插件 API 各自那栏「怀孕状态」已经带着 ✓
 *   ⚠️ d6 已经不回喂了（2026-10-24），所以这几项必须由插件算好、直接喂过去 ✓
 * @returns 空串 = 还没判出胎儿（未孕 / 刚着床还没掷胎数）
 */
export function fetusBriefText(targetKey = null) {
    try {
        const t = state().targets?.[String(targetKey || '')];
        if (!t) return '';
        const plan = t.fetusPlan || null;
        const kids = parseFetus(t.profile?.d6 || '').kids || [];
        const n = Math.max(0, Number(plan?.count) || kids.length || 0);
        if (!n) return '';
        const { word, tag } = fetusCountParts(n, plan?.sameOvum ?? null, plan?.groups || null);
        // 致孕方：d6 里那格优先（逐胎锁定写进去的），缺了再从锁定表补 ✓
        let locks = [];
        try { locks = getImpregnatorLocks(t.key || targetKey) || []; } catch { /* 忽略 */ }
        const rows = [];
        for (let i = 0; i < n; i++) {
            const k = kids[i] || {};
            // 性别以 plan（插件掷的）为准；d6 那份只是照抄 ✓
            const sex = String((plan?.sexes || [])[i] || k.sex || '').trim();
            let imp = String(k.impregnator || '').trim();
            if (!imp) {
                const hit = locks.find((x) => (Number(x?.child) || 1) === i + 1);
                imp = String(hit?.impregnator || '').trim();
            }
            const body = `${sex}${imp ? `（致孕方：${imp}）` : ''}`.trim();
            const who = (n === 1) ? '' : `子${i + 1} `;
            rows.push(`${who}${body || '（未写）'}`);
        }
        return `${word}${tag}：${rows.join(' · ')}`;
    } catch { return ''; }
}

/**
 * ★ A5：把 plan 落到 d6 上（每轮都可以调，幂等 ✓）。
 *
 * 保留模型那份素材：每胎的**种族 / 致孕方 / 发育描述 / 孕期 / 预产期**照它写的留着，
 * 只把「胎数（概述开头那个词）」与「每个孩子的性别」换成插件判的 ✓
 * · 模型少写了某一胎 ⇒ 补一行（种族默认人类、致孕方取锁定结果 ✓）
 * · 模型多写了 ⇒ 按 plan 截掉（plan 是权威 ✓）
 * @returns {boolean} 有没有改动
 */
export function applyFetusPlanOf(targetKey = null) {
    try {
        const t = state().targets?.[targetKey];
        const plan = t?.fetusPlan;
        if (!t || !plan || !(Number(plan.count) >= 1)) return false;
        // ★ 手改修正：玩家手改过 d6 ⇒ 这一格归玩家（换了一胎时 `syncPregnancyState` 会交回 ✓）
        if (isProfileFieldFixed(targetKey, 'd6')) return false;
        // ⚠️ **没孕就别再往里写**：分娩 / 妊娠终止之后模型会把 d6 写成「无」，
        //   而 plan 要到**下一胎怀上**才清（`syncPregnancyState`）⇒ 不加这道闸，
        //   生完孩子那一轮 d6 会被 plan 又填回"子1 子2"✗
        if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() !== 'true') return false;
        const f = parseFetus(t.profile?.d6 || '');
        const locks = (() => { try { return getImpregnatorLocks(targetKey) || []; } catch { return []; } })();
        // ★ 来源 / 分批（2026-10-14）：有它就**压过**掷骰那份归属（按批分配 ✓）
        const srcEntry = (() => { try { return impregnatorSourceOf(targetKey); } catch { return null; } })();
        const kids = [];
        // ★ 胎位只掷了子1~子4（`IMPREGNATOR_SLOTS`）⇒ 第 5 胎起照正文【大批量卵】那条
        //   "几十上百枚不逐枚掷骰：整批按子1 那一条归属" ⇒ 没有自己那一胎的锁定时取子1 ✓
        const manyFetus = Number(plan.count) >= 5;
        // ★★ 2026-10-23（她报：多胎只有第一个孩子写了致孕方）——
        //   受精时**只有一个候选**的话，锁定只落了「子1」一条（那一刻还没有胎数）⇒
        //   后面几胎查 `locks[i]` 查不到，d6 就只有第一个孩子带致孕方 ✗
        //   ⇒ 只有一个致孕方时，它就是**所有孩子**的父；后面几胎都用它兜底 ✓
        //   （多个候选 / 异父时不兜底，各胎按自己的锁定来）
        const distinctFathers = [...new Set(locks
            .map((x) => String(x?.impregnator || '').trim())
            .filter(Boolean))];
        const singleFather = (distinctFathers.length === 1) ? distinctFathers[0] : '';
        for (let i = 0; i < Number(plan.count); i++) {
            const src = f.kids[i] || {};
            const lock = locks[i] || (manyFetus ? locks[0] : null)
                || (singleFather ? { impregnator: singleFather } : null);
            const own = sourceOwnerOf(srcEntry, i + 1);
            const race = String(src.race || '人类').trim();
            kids.push({
                race,
                // ★ 人类的孩子写男/女，非人类写雄/雌（同一个事实按对象换词 ✓）
                sex: sexWordForRace(race, plan.sexes?.[i] || src.sex || ''),
                impregnator: String(own || src.impregnator || lock?.impregnator || singleFather || '').trim(),
                gest: src.gest || '',
                due: src.due || '',
                extra: src.extra || '',
                // ★ 2026-10-24：天赋那句也要原样带过去，否则重写 d6 时会把它丢掉 ✗
                talent: src.talent || '',
                strength: src.strength || '',
            });
        }
        // ★ 2026-10-23：按**组**统一（不再只认"整胎同卵"）——
        //   同卵组内：致孕方 / 种族 / 显性隐性 / 性别必须完全一样（同一个基因组 ✓）；
        //   异卵的各自独立，混合胎只合那一对 ✓
        const planGroups = (() => {
            if (Array.isArray(plan.groups) && plan.groups.length) return plan.groups;
            const n = Number(plan.count) || 0;
            if (n >= 2 && plan.sameOvum === true) return [{ kids: Array.from({ length: n }, (_, i) => i), same: true }];
            return null;
        })();
        if (planGroups) {
            for (const g of planGroups) {
                const gk = (g && Array.isArray(g.kids)) ? g.kids.map(Number).filter((i) => i >= 0 && i < kids.length) : [];
                if (!g.same || gk.length < 2) continue;
                for (const fname of ['impregnator', 'race', 'extra', 'talent', 'strength', 'sex']) {
                    let v = '';
                    for (const k of gk) { const s = String(kids[k]?.[fname] || '').trim(); if (s) { v = s; break; } }
                    if (v) for (const k of gk) kids[k][fname] = v;
                }
            }
        }
        // ★ 2026-10-24（-108，她定的分工）：概述里的「生长情况」**由模型写**（插件只管递材料），
        //   所以这里不再替它按孕周填那句；概述里有什么就保留什么 ✓
        const head = f.head;
        const next = buildFetus(fixFetusHead(head, Number(plan.count), plan.sameOvum,
            Array.isArray(plan.groups) ? plan.groups : null), kids);
        if (next && next !== t.profile.d6) {
            if (!t.profile || typeof t.profile !== 'object') t.profile = {};
            t.profile.d6 = next;
            commit();
            return true;
        }
        return false;
    } catch { return false; }
}

// ---------------------------------------------------------------------------
// ★★ **手改修正**（改数值 ＝ 官方修改器＋ 当天的修正）
//
// 病根：改数值里那几格是**插件每轮自己写**的（`upsertTargetResult` 里那句
//   `t.profile = res.profile` 是整份替换，后面还有一串 d2/d3/d4/d5/d8 覆盖）
//   ⇒ 玩家在界面上手改完，下一轮推演就被盖回去，等于：这个修改器改不动账 ✗
//   （实测：`_analysis/_probe-editor-overwrite.mjs`）
//
// 口径：**手改是「修正」，不是「冻结」** ——
//   · 你改的那一刻，插件那份值被记成**基线** ✓
//   · 之后每轮：**插件那份值还等于基线**（账没变）⇒ 保留你填的值 ✓
//   · **插件那份值变了**（生了新的、换了一胎、档位推进…）⇒ 说明你那次数已经过期
//     ⇒ **插件接管**（写新值）＋ 留一条提醒告诉玩家 ✓✓（这就是：之后再生，生产次数照样涨 ✓）
//   · 任何时候都能点「↩ 交回插件」立刻交回 ✓
//   · `phase` / `sub` / `d1` 三格走**老的** `manualCycle`（「↩ 恢复自动推导」管它们 ✓）
//   ⚠️ **不做"永久钉住"** —— 明确说没必要 ✓
//   ⚠️ **不碰叙述类**（minor / calc / row1~3）：那是模型每轮新写的素材 ✓
// ---------------------------------------------------------------------------

/** 这个对象手改修正着的数据格（数组，方便 includes ✓） */
export function profileFixKeysOf(key) {
    const t = state().targets?.[String(key || '')];
    const m = (t && typeof t.profileFix === 'object' && t.profileFix) ? t.profileFix : null;
    if (!m) return [];
    // ★★ 2026-10-30（她报：快照里的近期性行为不更新）——
    //   `row3` 归**插件**记账（按清单渲染回来的），它不该是"手改字段"：
    //   老存档里那条是**误记**的（改数值那一格原先是单行框，多行值一进一出就被抹平，
    //   和打开时不一样 ⇒ 被当成"你改过"）⇒ 读侧一律不算它，免得每轮把旧文本写回去 ✓
    return Object.keys(m).filter((k) => m[k] && typeof m[k] === 'object' && k !== 'row3');
}

/** 这一格是不是玩家手改修正着的（phase / sub / d1 走老的 manualCycle ✓） */
export function isProfileFieldFixed(key, field) {
    const f = String(field || '');

    return profileFixKeysOf(key).includes(f);
}

/** 这个对象全部手改修正（`{ 格: { mine, base } }`） */
export function profileFixOf(key) {
    const t = state().targets?.[String(key || '')];
    const m = (t && typeof t.profileFix === 'object' && t.profileFix) ? t.profileFix : {};
    return m;
}

/**
 * 记下一条手改修正。
 * @param {string} key 对象
 * @param {string} field 哪一格（d2 / d3 / d4 / d5 / d6 / d8；phase/sub/d1 走 manualCycle ✓）
 * @param {string} mine 玩家填的值
 * @param {string} base **改之前**插件那份值（＝基线，用来判"账变了没" ✓）
 */
export function setProfileFix(key, field, mine, base) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const f = String(field || '');
    if (!f) return false;
    if (f === 'phase' || f === 'sub' || f === 'd1') {
    
        commit();
        return true;
    }
    if (!t.profileFix || typeof t.profileFix !== 'object') t.profileFix = {};
    // ⚠️ 已经有这一条时**不要动基线和玩家的值** —— 玩家一改一连串按键都会走到这儿，
    //   每按一次就把"现在的值"当基线的话，账一变就永远判不出来 ✗
    if (!t.profileFix[f] || typeof t.profileFix[f] !== 'object') {
        t.profileFix[f] = { mine: String(mine ?? ''), base: String(base ?? '') };
    } else {
        t.profileFix[f].mine = String(mine ?? '');
    }
    commit();
    return true;
}

/** 撤掉一条手改修正（`silent` 只是不 commit —— 调用方自己收尾 ✓） */
export function clearProfileFix(key, field, opts = {}) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const f = String(field || '');
    if (f === 'phase' || f === 'sub' || f === 'd1') {

    } else if (t.profileFix && typeof t.profileFix === 'object') {
        delete t.profileFix[f];
        if (!Object.keys(t.profileFix).length) delete t.profileFix;
    }
    if (opts.silent !== true) commit();
    return true;
}

/**
 * 「↩ 交回插件」之后**立刻**把插件那份值算回来（能算的几格当场算 ✓）。
 *
 * 为什么要它：点了交回、界面一动不动，玩家会以为没生效 ✗（做了要有反馈 ✓）
 * ⚠️ `d6` 这格算不出来（要等下一轮推演按判定重拼）⇒ 返回 false，界面照实说 ✓
 * @returns {boolean} 真的把插件值写进去了没有
 */
export function resnapProfileField(key, field) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const f = String(field || '');
    if (!t.profile || typeof t.profile !== 'object') t.profile = {};
    let v = '';
    try {
        if (f === 'd2') v = fertilityRateTextOf(key);
        else if (f === 'd3') v = bodyCoefOf(key);
        else if (f === 'd4') v = impregnatorTextOf(key);
        else if (f === 'd5') {
            // 后半截（致孕方知情）是模型报的，交回时从当前值里把它摘出来接着用 ✓
            const cur = String(t.profile.d5 || '');
            const at = cur.indexOf(' · ');
            v = awarenessTextOf(key, at >= 0 ? cur.slice(at + 3) : '');
        }
        else if (f === 'd8') v = birthCountOf(key) + ' 次';
    } catch (e) { console.warn('[Bodycord] 交回插件时重算失败', e); v = ''; }
    if (!v) return false;
    t.profile[f] = v;
    clearProfileFix(key, f, { silent: true });
    commit();
    return true;
}
// ---------------------------------------------------------------------------
// ★★ **精液量**这笔账
//
// 为什么要它：阶段插图要"分层合成"（子宫底图按精液量分档 ＋ 精子/卵子/受精/着床/中出 叠上去）
//   ⇒ 得有个地方记住"体内现在有多少精液" ✓
//
// ⚠️⚠️ **精子和精液不是一回事**（别把两者混了 ✗）：
//   · **精子**（细胞）＝ 按我们**精子存活期**那套设定走（能在体内活好几天 ✓ 现成就有）
//   · **精液**（液体）＝ 这一笔账：AI 只报"这次射了多少"和"这轮清理过没有"，档位由插件算 ✓
//   ⇒ 清洗清的是**精液**，清不掉**精子**（精子已经钻进宫颈黏液里了 ✓ 模块正文里也这么写）
//
// 档位顺序＝从小到大（空 < 残留 < 少 < 中 < 多 < 大量 ✓）——**顺序本身就是判据**，
//   取 max / 降一档 全靠它 ✓
// ---------------------------------------------------------------------------

/** 精液量的六档（顺序＝档位大小 ✓） */
export const SPERM_TIERS = ['empty', 'residue', 'low', 'mid', 'many', 'max'];

/**
 * 档位的中文名（设置页 / 诊断 / 报告里用 ✓）
 * ★ 2026-10-18：`max` 从「大量」改成「满」—— 朋友那套图就叫：阴道 满 / 子宫 满，
 *   界面上的档位名跟文件名用同一个词，找图的时候不用换算 ✓
 */
export const SPERM_TIER_LABEL = { empty: '空', residue: '残留', low: '少', mid: '中', many: '多', max: '满' };


function spermTierIdx(x) {
    const i = SPERM_TIERS.indexOf(String(x || ''));
    return i < 0 ? 0 : i;
}

/**
 * 把推理报的"量"认成档位。
 * 认「少/中/多/大量」这四个词，也认档位 id（`low` 这种，方便测试）；
 * 认不出来 / 空 ⇒ `null`（调用方当"这次没报"处理，**绝不瞎猜成某一档** ✓）
 */
export function spermTierFromText(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    for (const t of SPERM_TIERS) {
        if (s === t) return t;
    }
    if (/大量|很多|极多|满溢|塞满|满/.test(s)) return 'max';
    if (/多/.test(s)) return 'many';
    if (/中/.test(s)) return 'mid';
    if (/少/.test(s)) return 'low';
    if (/残留|余/.test(s)) return 'residue';
    if (/没有|无|空|干净/.test(s)) return 'empty';
    return null;
}

/**
 * ★★ 2026-10-29（她报的坑）：**孕期 / 无月经档的「残留」会一直挂着**。
 *
 * 病根：「残留」原本只在**周期结算**时清（`settleResidueLoad`），
 *   而这两种人等不到周期结算 —— 孕期不结算，无月经档压根没有周期
 *   ⇒ 清洗完那个「残留」会一直留在面板和状态摘要里（现实中第二天就该干净了）✗
 *
 * 口径：这两种人直接吃「按现实」那一档的判定（过一天回空）；
 *   有月经档**完全不变**，玩家自己选的那一档也不动 ✓
 *   判据跟 `periodModeOf` 同源：本人读设置、NPC 读自己那一格，都没设就跟全局默认 ✓
 */
export function residueClearsByDay(t, key = '') {
    try { if (stageResidueMode() === 'real') return true; } catch { /* 读不到就按下面判 */ }
    // 孕期（跟 `isPregnant()` 同一套判据：那一格或标题里的孕期字样）
    try {
        if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() === 'true') return true;
        if (/孕期|妊娠/.test(String(t?.profile?.title || ''))) return true;
    } catch { /* 忽略 */ }
    try {
        const k = String(key || t?.key || '');
        if (k && periodModeOf(k) === 'amenorrhea') return true;
    } catch { /* 忽略 */ }
    return false;
}

/**
 * 读某一本账的当前档（含「残留怎么算」那条规则 ✓）。
 * ★ 「残留怎么算」那一档（默认＝**留到周期结束**；⚠️ 它只管显示，不参与判定）：
 *   · `cycle`（默认）⇒ 周期内一直显示，跨周期时自动清空 ✓
 *   · `real`        ⇒ **只有「残留」会过一天就回「空」**（＝现实里"第二天就干净了"✓）
 *     —— 判据是**剧情日期变了**（懒判，不需要任何定时器 ✓）
 *   ★ 2026-10-29：孕期 / 无月经档也走「过一天回空」（见 `residueClearsByDay` ✓）
 */
function loadTierOfField(t, field, key = '') {
    // ★ 2026-10-30：孕期子宫那一本**恒为空**（见 pregnantNowTarget 那段说明）。
    //   读口封住 ⇒ 面板读数 / 阶段插图那行文字 / 喂回模型的「阴道｜子宫」一起变干净；
    //   存档里的旧值也不作数（不靠改存档，只靠这里判）。
    if (field === 'wombLoad' && pregnantNowTarget(t)) return 'empty';
    const cur = String(t[field] || 'empty');
    if (cur === 'residue' && residueClearsByDay(t, key)) {
        const d = String(t.spermLoadDate || '');
        let today = '';
        try { today = String(currentDate() || ''); } catch { today = ''; }
        if (d && today && d !== today) return 'empty';
    }
    return cur;
}

/** 阴道那一本现在是多少（阶段插图挑底图用 ✓） */
export function vaginaLoadTierOf(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return 'empty';
    return loadTierOfField(t, 'vaginaLoad', key);
}

/** 子宫那一本现在是多少（阶段插图挑那张透明层用 ✓） */
export function wombLoadTierOf(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return 'empty';
    return loadTierOfField(t, 'wombLoad', key);
}

/**
 * ★ 体内**最满的那一本**（"有没有精液"这类判断用它 ✓）。
 *   ⚠️ 别拿它去挑底图 —— 底图看的是**阴道**那一本 ✗（`vaginaLoadTierOf` ✓）
 */
export function spermLoadTierOf(key) {
    const a = vaginaLoadTierOf(key);
    const b = wombLoadTierOf(key);
    return spermTierIdx(a) >= spermTierIdx(b) ? a : b;
}



/** 两本一起写（顺手记下"哪一天变成这样的"✓ 残留规则要它） */
function writeLoads(t, v, w) {
    t.vaginaLoad = String(v || 'empty');
    t.wombLoad = String(w || 'empty');
    try { t.spermLoadDate = String(currentDate() || ''); } catch { t.spermLoadDate = ''; }
}

/**
 * 一次内射 ⇒ 两本账一起算。
 *
 * ★ 分配规则（2026-10-21 改成"再射就往上推一档"）：
 *   · **先记进阴道**：取这次和现在的**较高那档**；要是两档一样（＝这次没超过现在的量），
 *     **再往上推一档** —— 已经「多」了又射一波，就该到「满」，不能原地不动 ✓
 *     （顶到头了就是「满」，不再涨 ✓）
 *   · `inWomb === true`（AI 报了"直接射进子宫"）⇒ **子宫按同一套规则涨** ✓
 *   · 否则 **灌满了才溢进子宫**：报「满」⇒ 子宫升一档；量小（少 / 中 / 多）子宫一动不动 ✓
 *   · 子宫升上去之后**自己不会掉** —— 清理也降得慢（见 `decaySpermLoad`）
 *   · ★ 孕期 ⇒ 子宫那本**永远不动**（宫颈被粘液栓封着，精液只到阴道 ✓）
 * @param {boolean} [inWomb] 这一次是不是直接射进子宫里（默认 false ✓）
 * @returns {boolean} 两本账有没有变（变了才 commit ✓）
 */
export function bumpSpermLoad(key, tier, inWomb = false) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const wanted = String(tier || '');
    if (!SPERM_TIERS.includes(wanted)) return false;      // 认不出 ⇒ 一个字都不动 ✓
    const v0 = loadTierOfField(t, 'vaginaLoad', key);
    const w0 = loadTierOfField(t, 'wombLoad', key);
    const TOP = SPERM_TIERS.length - 1;
    // 这一本该到多少：取较高那档；没超过现在的档 ⇒ 再推一档（同档再射也算一次 ✓）
    const stepFrom = (cur, base) => {
        const m = Math.max(cur, base);
        return (m === cur) ? Math.min(TOP, cur + 1) : m;
    };
    const v1 = SPERM_TIERS[stepFrom(spermTierIdx(v0), spermTierIdx(wanted))];
    // ★★ 2026-10-30：孕期 ⇒ 子宫那本**一个字节都不进**（粘液栓封着宫颈口，
    //   精液只停在阴道；模型就算报了 in_womb=true 也不作数）。
    //   ⇒ 见 pregnantNowTarget 那段：读写两头都得封，不然清洗还能把它降一档。
    const pregnant = pregnantNowTarget(t);
    const w1 = pregnant
        ? 'empty'
        : (inWomb
            ? SPERM_TIERS[stepFrom(spermTierIdx(w0), spermTierIdx(wanted))]
            : ((wanted === 'max')
                ? SPERM_TIERS[Math.min(TOP, spermTierIdx(w0) + 1)]
                : w0));
    const changed = (v1 !== v0) || (w1 !== w0);
    writeLoads(t, v1, w1);
    t.spermCleaned = false;      // 又射进来了 ⇒ 重新算"没清理" ✓
    commit();
    return changed;
}

/**
 * ★ 强度封口（2026-10-23）：那一档的现成句后面统一挂这句。
 *   为什么：只给句子不给约束，模型会"润色"成更顺口的弱化说法
 *   （「满」档原文写着「连衣服都盖不住」，它写成「微微发圆」✗）。
 *   ⚠️ 只写"不许弱化"会被读成"那可以加强" ⇒ 两头都要封死。
 */
const TIER_STRENGTH_GUARD = '（程度就按这一档，不许弱化也不许强化）';

export function spermBellyLine(key) {
    try {
        if (!spermBellyOn()) return '';
        // ★ 2026-10-23：只认阶段插图那个开关（精液量描写），**不再看精子模块** ——
        //   精液量外观属于阶段插图，精子模块关着它也该单独生效 ✓
        const IN_ROW1 = ['mid', 'many', 'max'];
        const lines = [];
        // 清洗过 ⇒ 档位后面标一下：让模型知道"这些档位是洗过之后的"，别把"洗过"读成"残留" ✗
        let cleaned = false;
        try { cleaned = !!state().targets?.[String(key || '')]?.spermCleaned; } catch { cleaned = false; }
        const tag = (tier) => `${SPERM_TIER_LABEL[tier]}${cleaned ? '（洗过）' : ''}`;
        // ① 阴道那本（体内）—— 这半边以前没人管，模型只能自己编 = 写歪的根源
        const v = vaginaLoadTierOf(key);
        if (IN_ROW1.includes(v)) {
            const t = spermBellyTextVaginaIn(v);
            if (t) lines.push(`阴道 ${tag(v)}（体内）：现在就是这一档，这一档长这样：${t}${TIER_STRENGTH_GUARD}`);
        }
        // ②③ 子宫那本：体内进 row1、体表进 row2
        // ★ 2026-10-30：孕期那本恒空（读口已经封住，这里根本拿不到「中 / 多 / 满」），
        //   所以原来那条"孕期：这一档的轮廓是精液撑出来的"分支**整个删掉**了 ——
        //   宫颈被粘液栓封着，孕期的子宫里不会有精液，写出一句“被精液撑鼓”就是错的 ✗
        const w = wombLoadTierOf(key);
        if (IN_ROW1.includes(w)) {
            const inside = spermBellyTextIn(w);
            if (inside) lines.push(`子宫 ${tag(w)}（体内）：现在就是这一档，这一档长这样：${inside}${TIER_STRENGTH_GUARD}`);
            const outside = spermBellyTextOut(w);
            if (outside) {
                lines.push(`子宫 ${tag(w)}（体表）：现在就是这一档，这一档长这样：${outside}${TIER_STRENGTH_GUARD}`);
            }
        }
        return lines.join('\n');
    } catch { return ''; }
}

/**
 * 一键清空体内精液：阴道 / 子宫两本账都清到空。
 * 给阶段插图那边的快捷入口用（不是清洗，清洗只能降档；这是直接清空 ✓）。
 */
export function clearSpermLoad(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const v0 = loadTierOfField(t, 'vaginaLoad', key);
    const w0 = loadTierOfField(t, 'wombLoad', key);
    if (v0 === 'empty' && w0 === 'empty') { t.spermCleaned = true; commit(); return false; }
    writeLoads(t, 'empty', 'empty');
    t.spermCleaned = true;
    commit();
    return true;
}

/**
 * 清理（清洗 / 擦拭 / 洗澡）⇒ **按当时的量分档降**。
 *
 * ★ 两本的**底不一样**（2026-10-20）：
 *   · **阴道**洗得干净 ⇒ 底是「空」（多洗几次就没有了 ✓）
 *   · **子宫**洗不干净 ⇒ 底是「残留」（"残留"那条规则说的是子宫，不是阴道 ✓）
 *
 * 二次元的量，需要多清理几次很正常吧 ⇒ 这条改成**量越大越难洗**：
 *   · 阴道：满 / 多 ⇒ 每次只掉 1 档；中 / 少 ⇒ 每次掉 2 档（少量一次就干净）
 *   · 子宫：每次掉 1 档（本来就比阴道难洗，不再按量提速）
 *   这是「标准」档（`stageCleanMode() === 'std'`，默认）。
 *
 * ★★ 另有「清理效率」两档：
 *   · `fast`  快洗：阴道 每次 −2；子宫 满/多 −2、中/少 −1
 *   · `flush` 一次到底：阴道一次清到「空」，子宫一次清到「残留」
 *   洗到「空」（阴道）/「残留」（子宫）各要几次（标准 / 快洗 / 一次到底）：
 *     满：阴道 5 / 3 / 1 · 子宫 4 / 3 / 1
 *     多：阴道 4 / 2 / 1 · 子宫 3 / 2 / 1
 *     中：阴道 2 / 2 / 1 · 子宫 2 / 2 / 1
 *     少：阴道 1 / 1 / 1 · 子宫 1 / 1 / 1
 *   原来的固定步长（阴道恒 −2、两本都停在残留）让"满"洗两次就到残留、
 *   而阴道又永远洗不干净，和二次元那种塞满的量对不上 ✗
 * ⚠️ 已经空的那一本**保持空**（别把「空」算成「降两档 ⇒ 残留」✗）
 */
export function decaySpermLoad(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const v0 = loadTierOfField(t, 'vaginaLoad', key);
    const w0 = loadTierOfField(t, 'wombLoad', key);
    if (spermTierIdx(v0) === 0 && spermTierIdx(w0) === 0) { t.spermCleaned = true; commit(); return false; }
    const vIdx = spermTierIdx(v0);
    const wIdx = spermTierIdx(w0);
    const mode = stageCleanMode();
    let v1, w1;
    if (mode === 'flush') {
        // 一次到底：阴道有量就一次清到「空」；子宫只到「残留」（残留是子宫那本的底 ✓）
        v1 = 'empty';
        w1 = wIdx === 0 ? 'empty' : 'residue';
    } else {
        // 阴道：标准看量分档（多 / 满只掉 1 档），快洗恒定掉 2 档；**底是「空」** ✓
        const vStep = mode === 'fast' ? 2 : (vIdx >= spermTierIdx('many') ? 1 : 2);
        // 子宫：标准恒掉 1 档；快洗在「多 / 满」掉 2 档；**底是「残留」** ✓
        const wStep = mode === 'fast' ? (wIdx >= spermTierIdx('many') ? 2 : 1) : 1;
        v1 = vIdx === 0 ? 'empty' : SPERM_TIERS[Math.max(0, vIdx - vStep)];
        w1 = wIdx === 0 ? 'empty' : SPERM_TIERS[Math.max(1, wIdx - wStep)];
    }
    // ★ 2026-10-30：孕期子宫恒空 —— 清洗**不许**去动子宫那本
    //   （以前会掉一档，等于承认孕期的子宫里有精液 ✗）
    if (pregnantNowTarget(t)) w1 = 'empty';
    const changed = (v1 !== v0) || (w1 !== w0);
    writeLoads(t, v1, w1);
    t.spermCleaned = true;
    commit();
    return changed;
}

/**
 * ★★ 跨周期：**只把「残留」清成空**，有量（少 / 中 / 多 / 满）的**不动** ✓
 *   （跨周期只把残留清空、有量的不动；跨周直接清精液不合理）
 *   调用点：`settleCycle` 里本周期结束那一段 ✓
 */
export function settleResidueLoad(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return false;
    const v0 = loadTierOfField(t, 'vaginaLoad', key);
    const w0 = loadTierOfField(t, 'wombLoad', key);
    const v1 = (v0 === 'residue') ? 'empty' : v0;
    const w1 = (w0 === 'residue') ? 'empty' : w0;
    if (v1 === v0 && w1 === w0) return false;
    writeLoads(t, v1, w1);
    commit();
    return true;
}


/**
 * ★ **row3 里"内射 / 卵植入"那几笔**由插件把时间与人物喂回去。
 *
 * 为什么只喂一半（这一批的判据）：row3 是一个**混合格** —— 它按时间倒序记
 * "最近 1~N 次性行为"，其中
 *   · **内射 / 卵植入**那几笔：账本里每条都有剧情日期 ＋ 钟点 ＋ 人物 ✓
 *     ⇒ 插件手上是准的，让 AI 自己回想日期只会写飘 ✗；
 *   · **外射 / 口交 / 手交这类非内射行为**：只有剧情里知道
 *     ⇒ 搬不走，仍归 AI ✗。
 * ⇒ 走「只喂数、不抢字段」（跟 d7 那一格同一套路）：插件只把可算的那半写成
 *   日期 钟点 · 人物 的一串喂回去，**row3 那一格仍然由 AI 写**（它照抄时间与人物、
 *   事件与状态自己写、再补上剧情里那些非内射的）✓。
 *
 * 形态（新 → 旧，用「；」串起来）：`1年04月07日 13:05 · 示例致孕方·甲；1年04月06日 · 示例路人·乙`
 *   · 历法是「不记钟点」那档 ⇒ 只有日期（`clk` 是空串 ✓，别写成 00:00 ✗）
 *   · 老数据没有 `depotDate` ⇒ 退回那一批的周期日 `sub`（至少有个时间锚）
 *   · 一条都拼不出来 / 没有批次 ⇒ 空串（调用方当"这一栏不发"处理 ✓）
 *
 * @param {string|null} targetKey 按对象分账（跟 insems 的 `target` 对齐 ✓）
 * @param {number} keep 保留几条（＝模块正文那一格「最多保留 N 条」，由 `recentSexKeep()` 给 ✓）
 * @returns {string} 空串 = 没有可喂的
 */
export function recentInsemForPrompt(targetKey = null, keep = 3) {
    try {
        const mine = listInseminations()
            .filter((x) => String(x.target || '') === String(targetKey || ''));
        if (!mine.length) return '';
        const n = Math.max(1, Math.min(9, Math.round(Number(keep)) || 3));
        const rows = mine.slice(-n).reverse().map((x) => {
            const when = [String(x.depotDate || '').trim(), String(x.clk || '').trim()]
                .filter(Boolean).join(' ');
            // 老数据没有剧情日期 ⇒ 退回周期日（`sub` 形如 Day14），**不假造一个日期** ✓
            const head = when || String(x.sub || '').trim();
            const by = String(x.by || '').trim();
            return [head, by].filter(Boolean).join(' · ');
        }).filter(Boolean);
        if (!rows.length) return '';
        return rows.join('；');
    } catch { return ''; }
}

// ---------------------------------------------------------------------------
// ★ 事后避孕药（让插件真支持 ×0.2）
//
// 分工：AI 只报**事实**（契约的 `emergency_pill` 那一格填 true/false），
//   折算由插件做 —— 「当前累计受孕率 × 0.2」是**对已累加总数打折**，
//   光靠每次内射的 contrib 表达不出来（让 AI 自己改 d2 是空承诺 ✗）。
//
// 口径（跟模块正文一致）：
//   · 只折**服药之前**已经入账的批次；服药之后的新内射照常全额累加 ✓
//   · 折完不归零，之后的批次继续往上加 ✓
//   · `day` 是**周期日号**，和 `insems[].depositDay` 同一个单位 ⇒ 换周期时清掉（周期日会重头数 ✗）
// ---------------------------------------------------------------------------

/** 事后药最多留多少条（够用就行：一场戏里吃两次都算多了 ✓） */
export const PILL_CAP = 200;
/** 出厂折扣：×0.2（即减去 80%）—— 和模块正文写的一致 ✓ */
export const PILL_FACTOR_DEF = 0.2;

/**
 * 记一条「事后避孕药」事件。
 *
 * ⚠️ 去重按**同一个对象 + 同一个周期日**：AI 很可能连着两轮都在 cot 里报 true
 *   （它记的是剧情事实，不是"本轮新增"）⇒ 不判重就会把累计率反复打 0.2 折 ✗
 *
 * @returns {boolean} 真的记上了才 true（已记过 / 拿不到周期日 ⇒ false）
 */
export function recordEmergencyPill(target, day, opts = {}) {
    const s = state();
    if (!Array.isArray(s.pills)) s.pills = [];
    const t = String(target || '');
    const d = (day == null || day === '' || !Number.isFinite(Number(day))) ? null : Number(day);
    if (d === null) return false;          // 没周期日 ⇒ 不记（宁可这次不折，也别折错批次 ✗）
    if (s.pills.some((x) => String(x.target || '') === t && Number(x.day) === d)) return false;
    const f = Number(opts.factor);
    s.pills.push({
        target: t,
        day: d,
        factor: Number.isFinite(f) && f > 0 && f < 1 ? f : PILL_FACTOR_DEF,
        round: opts.round ?? null,
        at: Date.now(),
    });
    if (s.pills.length > PILL_CAP) s.pills.splice(0, s.pills.length - PILL_CAP);
    commit();
    return true;
}

/** 这个对象当前周期里记着的事后药（旧 → 新） */
export function listPills(target = null) {
    const s = state();
    const all = Array.isArray(s.pills) ? s.pills : [];
    const list = target ? all.filter((x) => String(x.target || '') === String(target)) : all;
    return list.map((x) => ({ ...x }));
}

/**
 * 某一批精子（`depositDay` 那天入账的）到 `cutoffDay` 为止，被事后药打过几次折。
 *
 * @returns {number} 1 = 没打折；0.2 = 折过一次；0.04 = 折过两次
 */
export function pillFactorFor(target, depositDay, cutoffDay) {
    const list = listPills(target);
    if (!list.length) return 1;
    let f = 1;
    const cut = Number(cutoffDay);
    const dd = (depositDay == null || depositDay === '') ? null : Number(depositDay);
    for (const p of list) {
        const pd = Number(p.day);
        if (!Number.isFinite(pd)) continue;
        // 还没到那一天（判定要回溯到窗口末尾）⇒ 这次不算
        if (Number.isFinite(cut) && pd > cut) continue;
        // 药在“这一批入账”之前 ⇒ 不影响这一批（服药之后的新内射照常全额 ✓）
        if (dd !== null && Number.isFinite(dd) && dd > pd) continue;
        f *= Number(p.factor) || 1;
    }
    return f;
}

// ---------------------------------------------------------------------------
// ★ 合并对象
//
// 背景：**AI 可能会把同一个角色拆成两个差异化的角色 ⇒ 所以需要做合并** ✓
//
// 规则（**按"生命进程优先级覆盖"**）：
//   ① 敏感带：**直接叠加**（同一部位取更高的那档；最淡的那档也一起留 ✓）
//   ② 精子记录：两边都没有"怀孕/受精卵"时 ⇒ 叠加合并 ✓
//   ③ 受精卵：只要有一边有 ⇒ **以那一边为主** ✓
//   ④ 怀孕：只要有一边怀 ⇒ **全看怀孕那边**（影响孩子 ✓）⇒ 周期也跟着它 ✓
//   ⑤ 周期：**两边都没怀孕**时 ⇒ 让玩家自己选一个 ✓（不能怀孕那份不列进候选 ✓）
//   ⑥ 两个都怀孕 ⇒ 玩家选"留哪个"（就是选谁当主档）✓
//
// ⚠️ 合并只动**这个聊天档案**里的这几个对象，不碰别的对象、也不写聊天文件 ✓
// ---------------------------------------------------------------------------

/**
 * 把一格 d9（敏感带）解析成 名称 -> 原文 的映射。
 *
 * ⚠️⚠️ 分隔符的**真实约定**（踩过一次，记清楚）：
 *   · **一条 = 一行**（`serializeZoneRows` 用换行分隔 ✓）
 *   · `｜` 是「**部位｜备注**」的备注分隔符，**不是条目分隔符** ✗
 *   · 历史数据可能用 `·` 分隔条目 ⇒ 也顺便认一下 ✓（但 `｜` **绝不能**当条目分隔，
 *     否则一条带备注的会被劈成"只剩后半"✗）
 */
function zoneMapOf(d9) {
    const out = new Map();
    const text = String(d9 || '').replace(/^[^|｜]*[|｜]/, '');   // 去掉「敏感带 |」这种抬头
    // ★ 先按换行分条；没有换行时退回 `·`（老格式）；**不按 ｜ 分** ✓
    let parts = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) parts = text.split(/[·、；;]+/).map(s => s.trim()).filter(Boolean);
    for (const s of parts) {
        // 部位名 = 第一个「级」/「(」/「｜」之前那一段；
        //   只有备注的行（没有级数）就取「｜」之前那一段 ✓
        const head = s.split(/[|｜]/)[0].trim();
        const m = head.match(/^(.+?)\s*(?:\d+\s*级.*)?$/);
        const name = (m?.[1] || head).trim();
        if (name) out.set(name, s);
    }
    return out;
}

/** 按阈值表算等级（`bounds` = 六级起点；超出最后一级 ⇒ 5 级 ✓） */
function zoneLevelOf(count, bounds) {
    const n = Number(count);
    const b = (Array.isArray(bounds) && bounds.length === 6) ? bounds : [0, 5, 21, 51, 101, 181];
    if (!Number.isFinite(n)) return 0;
    for (let i = 5; i >= 1; i--) if (n >= b[i]) return i;
    return 0;
}

/** 程度 → 增量（跟正文那张增量表同一个语义；出厂 轻 1 / 中 2 / 重 3 ✓） */
const ZONE_STIM_STEP = { 轻度: 1, 中度: 2, 重度: 3, 轻: 1, 中: 2, 重: 3 };

/**
 * ★ 「本轮刺激」→ 部位 : 这一次真加的次数。
 *
 * 同一部位报两条会先合并、再统一夹到「重度那档」（逐条夹不够：同一个部位报两条就成 +6 ✗）；
 * 认不出的程度算 0（那个部位就当没报）。
 * ⚠️ 抽出来是为了**同一份账被两处用**：`applyZoneStim` 拿它累加 d9，
 *    `zonesStimSummary` 拿它给界面拼「哪个部位加了几次」——
 *    两处各写一份算法，迟早会算出不一样的数 ✗
 */
function zoneStimSteps(list) {
    const { light, mid, heavy } = zoneParamsOf();
    const stepOf = (k) => {
        const s = String(k || '').trim();
        if (s === '轻度') return light;
        if (s === '中度') return mid;
        if (s === '重度') return heavy;
        return ZONE_STIM_STEP[s] || 0;
    };
    const raw = new Map();
    for (const s of list) {
        const name = String(s?.part ?? s?.name ?? '').trim();
        if (!name) continue;
        const step = stepOf(s?.level);
        if (!step) continue;
        raw.set(name, (raw.get(name) || 0) + step);
    }
    const out = new Map();
    for (const [name, n] of raw) out.set(name, Math.min(heavy, n));
    return out;
}

/**
 * ★ 给界面看的「这一轮哪个部位加了几次」。
 *
 * 形态：`耳垂 +2、乳尖 +3、…`（顺序＝模型报的顺序）；没有刺激 ⇒ 空串 ✓
 * 为什么要有它：这段信息原来由**模型写在 cot 里**（费输出 token，而且它自己算的数
 *   可能和插件按同一张增量表算出来的对不上 ⇒ 两边不一致时到底谁错也看不出来）✓
 * 现在改由**插件算**、跟着这一楼的状态走：楼层面板与时光机里显示（见 pushSnapshot 的 judge ✓）
 */
export function zonesStimSummary(stim) {
    const list = Array.isArray(stim) ? stim : [];
    if (!list.length) return '';
    try {
        const m = zoneStimSteps(list);
        return [...m.entries()].filter(([, n]) => n > 0).map(([k, n]) => k + ' +' + n).join('、');
    } catch { return ''; }
}

/**
 * ★ 把"本轮被刺激的部位 + 程度"累加进 d9，并重算等级。
 *
 * 分工：AI 只判断"哪个部位被碰了、多重"（那只有它知道）；**累加次数 / 换算等级 / 保留历史 /
 *   白名单**全归插件 ✓ —— 这几样正是当初最容易漂的地方（它忘了保留、或跨天清空 ✗）。
 *
 * · 累计刺激：读现有那条的（累计刺激 N）＋ 增量；没有这条 ⇒ 从 0 开始 ✓
 * · 等级：**只按阈值表算**（`zoneParamsOf()`，出门值 0/5/21/51/101/181 ✓）—— 增量不直接定级 ✓
 * · 上限：单个部位每轮最多 +「重度那档」（跟正文那句一致 ✓）
 * · 白名单：只列累计刺激 ≥1 的部位；一个都没有 ⇒ 「无」✓
 * · 保留：没被这一轮碰到的部位**原样留着**（那条"跨天不许重置"的规则从此不用再叮嘱 AI ✓）
 *
 * @param {string} d9 现有的 d9 文本
 * @param {Array<{part?:string,name?:string,level?:string}>} stim 本轮刺激
 * @returns {string} 新的 d9 文本（没有刺激 ⇒ 原样返回 ✓）
 */
export function applyZoneStim(d9, stim) {
    const list = Array.isArray(stim) ? stim : [];
    if (!list.length) return String(d9 || '');
    const { lv: bounds } = zoneParamsOf();
    // 现有那些部位（去掉「敏感带 |」抬头；老格式整行用 `·` 分条的先拆成多行 ✓）
    let text = String(d9 || '').replace(/^\s*[^|｜\n]*[|｜]\s*/, '');
    if (!/\n/.test(text) && text.includes('·')) {
        const parts = text.split('·').map((s) => s.trim()).filter(Boolean);
        if (parts.filter((s) => /\d+\s*级/.test(s)).length >= 2) text = parts.join('\n');
    }
    const byName = new Map();
    for (const r of parseZoneRows(text)) {
        const name = String(r.name || '').trim();
        if (!name) continue;
        byName.set(name, { name, count: Number(r.count) || 0, note: r.note || '' });
    }
    // 单个部位每轮最多 +「重度那档」（跟正文那句一致 ✓）⇒ 先把同一部位的几条合并、再夹上限 ——
    //   ⚠️ 逐条夹是不够的：AI 万一同一个部位报了两条，逐条夹就成了 +6 ✗
    const stepByName = zoneStimSteps(list);
    let touched = 0;
    for (const [name, step] of stepByName) {
        const cur = byName.get(name) || { name, count: 0, note: '' };
        cur.count += step;
        byName.set(name, cur);
        touched += 1;
    }
    if (!touched) return String(d9 || '');
    const outRows = [...byName.values()]
        .filter((r) => r.count >= 1)              // 白名单：次数 ≥1 才列 ✓
        .map((r) => ({ name: r.name, level: String(zoneLevelOf(r.count, bounds)), count: String(r.count), note: r.note }));
    if (!outRows.length) return '无';
    return serializeZoneRows(outRows);
}

/** 合并两格的敏感带（① 直接叠加：同部位保留"更高那档"的原文 ✓） */
export function mergeZoneText(a, b) {
    const ma = zoneMapOf(a);
    const mb = zoneMapOf(b);
    if (!ma.size) return String(b || '');
    if (!mb.size) return String(a || '');
    const out = new Map(ma);
    for (const [name, line] of mb) {
        if (!out.has(name)) { out.set(name, line); continue; }
        // 同部位：取"级数更高"的那条
        const lv = (s) => { const m = String(s).match(/(\d+)\s*级/); return m ? Number(m[1]) : -1; };
        if (lv(line) > lv(out.get(name))) out.set(name, line);
    }
    return [...out.values()].join('\n');
}

const PREG_WORDS = /孕期|妊娠|孕\d|怀/;

/** 这个对象算不算"有孩子/已怀孕"（合并时决定主档用） */
function looksPregnant(t) {
    try {
        if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() === 'true') return true;
    } catch { /* 忽略 */ }
    return PREG_WORDS.test(String(t?.profile?.title || '')) || PREG_WORDS.test(String(t?.profile?.phase || ''));
}

/** 有没有"受精成功待着床"的信号（③ 用） */
function hasConceptionSignal(t) {
    try {
        const d6 = String(t?.profile?.d6 || '').trim();
        if (d6 && d6 !== '无' && !/^未加载$/.test(d6)) return true;
    } catch { /* 忽略 */ }
    return false;
}

/**
 * 合并若干个对象为一份。
 *
 * @param {string[]} keys 要合并的对象（≥2）
 * @param {string} keepKey 保留哪一个（它的名字/别名/能力设定都留着 ✓）
 * @param {{cycleFrom?:string}} [opts] 两边都没怀孕时，周期从哪个对象取 ✓
 * @returns {{ok:boolean, error?:string, report?:object}}
 */
export function mergeTargets(keys, keepKey, opts = {}) {
    const s = state();
    const list = (keys || []).filter(k => k && s.targets?.[k]);
    if (list.length < 2) return { ok: false, error: '至少要选两个对象' };
    if (!s.targets[keepKey]) return { ok: false, error: '要保留的那个对象不存在' };
    // ⚠️ 用户本人那一份不能删（红线：用户角色那份不许删）✓
    if (list.includes(USER_KEY) && keepKey !== USER_KEY) {
        return { ok: false, error: `「${userLabel()}」那一份不能并进别人里（你自己不能被删掉）` };
    }

    const others = list.filter(k => k !== keepKey);
    const keep = s.targets[keepKey];
    const report = { merged: others, zones: 0, insems: 0, traces: 0, patches: 0, children: 0, cycleFrom: '' };

    // 主档/孩子归属：有一边怀孕 ⇒ 全看怀孕那边 ✓（③④⑥）
    const pregKeys = list.filter(k => looksPregnant(s.targets[k]));
    const concKeys = list.filter(k => hasConceptionSignal(s.targets[k]));

    // 哪个对象的"孕产相关格"（title/phase/sub/d6/d2…）说了算？
    //   有怀孕的 ⇒ 选怀孕的那个（多个怀孕由玩家选的 keepKey 优先，玩家选"留哪个"就是⑥ ✓）
    let source = keepKey;
    if (pregKeys.length) source = pregKeys.includes(keepKey) ? keepKey : pregKeys[0];
    else if (concKeys.length) source = concKeys.includes(keepKey) ? keepKey : concKeys[0];

    const srcP = s.targets[source]?.profile || {};

    // ① 敏感带叠加（所有参与对象的 d9 全并起来 ✓）
    let zone = '';
    for (const k of list) {
        const d9 = s.targets[k]?.profile?.d9;
        zone = mergeZoneText(zone, d9);
        if (String(d9 || '').trim()) report.zones++;
    }

    // 把"孕产相关格"从主档来源盖过来（其余格：keep 的留着）
    if (!keep.profile) keep.profile = {};
    for (const f of ['title', 'phase', 'phaseId', 'sub', 'minor', 'calc', 'd1', 'd2', 'd3', 'd4', 'd6', 'd7', 'd8', 'd5', 'row1', 'row2', 'row3']) {
        const v = srcP[f];
        if (v !== undefined && String(v).trim()) keep.profile[f] = v;
    }
    // 敏感带用叠加后的结果（①）
    if (zone) keep.profile.d9 = zone;

    // ⑤ 周期：两边都没怀孕 ⇒ 玩家选的那个说了算 ✓
    if (!pregKeys.length && !concKeys.length) {
        const from = opts.cycleFrom && s.targets[opts.cycleFrom] ? opts.cycleFrom : keepKey;
        report.cycleFrom = from;
        const cp = s.targets[from]?.profile || {};
        for (const f of ['phase', 'phaseId', 'sub', 'd1']) {
            if (cp[f] !== undefined) keep.profile[f] = cp[f];
        }
        // 手改标记也一起带过来（玩家手改过的周期不该被自动推导盖掉 ✓）
        
        // ★ 周期状态（第几天 + 锚点日期）：主档没有就从被合并的那一份带过来 ✓
        //   （不带的话，合并完这个人的周期会回到默认天数，看着像凭空倒退 ✗）
        if (!(Number(keep.cycleDay) > 0)) {
            const src = [from, ...others].find(k => Number(s.targets?.[k]?.cycleDay) > 0);
            if (src) {
                keep.cycleDay = s.targets[src].cycleDay;
                keep.cycleDayAt = String(s.targets[src].cycleDayAt || '');
            }
        }
    }

    // ② 精子/受精记录：把别份的记录**改指向主档**（= 叠加合并 ✓）
    //   ⚠️ 绝不删记录（那是历史），只把 target 重指 ✓
    const insems = Array.isArray(s.insems) ? s.insems : [];
    for (const item of insems) {
        if (others.includes(String(item?.target || ''))) { item.target = keepKey; report.insems++; }
    }
    // ★ 孩子：**同一个人被拆成两个档**时，孩子的归属也要跟着改指向（不然合并完孩子在"别人"名下 ✗）
    //   （这就是"数据转移"的兼容 ✓）
    for (const c of (Array.isArray(s.children) ? s.children : [])) {
        if (others.includes(String(c?.key || ''))) { c.key = keepKey; report.children++; }
    }

    // ★★ **所有"按对象分账"的东西都要跟着改指向** ——
    //   判定 / 锁定 / 周期归档 / 上次推演记录。读取端（`getOvuJudgment`、
    //   `getImpregnatorLocks`、受孕记录面板）全是**严格按 target 比**的，而被合并掉的那个
    //   key 一旦被删，这些条目就变成**指向不存在对象的孤儿**：永远读不到、也不会被清 ✗
    //   ⇒ 症状：AI 重新锁致孕方（违反"锁定不可逆"）、判定历史凭空消失、受孕归档串到别人名下
    const repoint = (arr, field) => {
        let n = 0;
        for (const it of (Array.isArray(arr) ? arr : [])) {
            if (others.includes(String(it?.[field] || ''))) { it[field] = keepKey; n++; }
        }
        return n;
    };
    report.locks = repoint(s.impregnatorLocks, 'target');
    report.sources = repoint(s.impregnatorSources, 'target');
    // 植入起点是 map（键 = 对象）⇒ 单独搬（不搬的话合并后人身上就"不是植入孕"了 ✗）
    try {
        if (s.implantDates && typeof s.implantDates === 'object') {
            for (const k of others) {
                if (s.implantDates[k]) { s.implantDates[keepKey] = s.implantDates[k]; delete s.implantDates[k]; }
            }
        }
    } catch { /* 忽略 */ }
    report.ovuJudgments = repoint(s.ovuJudgments, 'target');
    report.conceptionArchive = repoint(s.conceptionArchive, 'target');
    report.pills = repoint(s.pills, 'target');   // ★ 事后药也是按对象分账的
    // 单数那份（最近一次判定）也得跟着改（它可能是 Array 里最后一条的副本 ✓）
    if (s.ovuJudgment && others.includes(String(s.ovuJudgment.target || ''))) s.ovuJudgment.target = keepKey;
    // ★ 上次推演记录是**按 key 索引的对象**（不是列表）⇒ 把被并掉那几份搬到主档名下
    //   （主档已经有就用主档那份，别覆盖 ✓）
    report.judgeReports = 0;
    if (s.lastJudgeReports && typeof s.lastJudgeReports === 'object') {
        for (const k of others) {
            if (!s.lastJudgeReports[k]) continue;
            if (!s.lastJudgeReports[keepKey]) {
                s.lastJudgeReports[keepKey] = s.lastJudgeReports[k];
                report.judgeReports++;
            }
            delete s.lastJudgeReports[k];
        }
    }

    // 身份：别名合并进来（这样两边的叫法都还能对上 ✓）
    const ident = identOf(keepKey);
    const aliasSet = new Set(parseAliases(ident.aliases));
    const notes = [];
    if (ident.note) notes.push(ident.note);
    for (const k of others) {
        const oi = identOf(k);
        for (const a of parseAliases(oi.aliases)) aliasSet.add(a);
        // 别份的档案名本身也是个叫法 ✓（否则以前那个名字就对不上了）
        const nm = String(s.targets[k]?.name || '').trim();
        if (nm) aliasSet.add(nm);
        if (oi.note && !notes.includes(oi.note)) notes.push(oi.note);
    }
    setIdentField(keepKey, 'aliases', [...aliasSet].join(' / '));
    if (notes.length) setIdentField(keepKey, 'note', notes.join('；'));

    // 痕迹：合并过来（同部位同类型由 applyTraceReport 的规则处理，这里只并列表 ✓）
    const keepBag = traceBag(keepKey, true);
    for (const k of others) {
        const bag = traceBag(k);
        for (const x of bag) { keepBag.push({ ...x }); report.traces++; }
        s.traces[traceKey(k)] = [];
    }

    // 敏感带的"种子"：主档留着自己的；别份的丢掉（不然会把手改值盖回去 ✗）
    //   （keep 的 d9Manual 语义保持不动 ✓）

    // ★ 专属补丁：并过来（**主档自己那份优先**，缺的才从别份补 ✓）
    //   补丁是按聊天存的 ⇒ 被合并掉的那个对象一旦删掉，它改过的文案也会跟着没
    //   ⇒ 不主动搬的话，玩家手改的规则会**静默消失** ✗
    {
        const merged = { ...(keep.patches || {}) };
        for (const k of others) {
            for (const [id, text] of Object.entries(s.targets[k]?.patches || {})) {
                if (merged[id] === undefined) { merged[id] = text; report.patches++; }
            }
        }
        if (Object.keys(merged).length) keep.patches = merged;
    }

    // 删掉被合并掉的对象
    for (const k of others) {
        delete s.targets[k];
        s.order = s.order.filter(x => x !== k);
    }
    if (!s.targets[s.active]) s.active = keepKey;
    commit();
    return { ok: true, report };
}

/**
 * 精子存活（方案 B）：只累计**还在存活期内**的批次，得到"当前有效累计"。
 *
 * 为什么不用"减累计率"：那样玩家会觉得数字莫名其妙变少 ✗
 * 这里累计率永远是历史总和，只是**判定时**不把失活的批次算进去 ✓
 *
 * @param {number} nowDay 当前剧情天数（周期 DayX）
 * @param {string} [target] 只看这个追踪对象的批次；不给就是全部
 * @param {{onlyCurrentCycle?:boolean, sinceAt?:number}} [opts]
 *   · `onlyCurrentCycle` ⇒ 只算**本周期**入账的批次
 *   · `sinceAt` ⇒ 只算这个时间戳之后的批次（无月经档的"判完清零"用 ✓）
 *   （ⓘ 累计受孕率的定义就是"当前周期的受孕率"，两档都一样 ⇒ 面板那两处都传它 ✓）
 * @returns {{viable:number, sum:number, alive:number, dead:number, deadList:Array}}
 */
export function viableFertility(nowDay, target, opts = {}) {
    const all = Array.isArray(state().insems) ? state().insems : [];
    // ★ 按对象分账：多对象追踪时不能把别人的批次算进来
    const list = target ? all.filter((x) => String(x.target || '') === String(target)) : all;
    let viable = 0, sum = 0, alive = 0, dead = 0;
    const deadList = [];
    // ★ 每个对象"本周期第 1 天"的绝对天（同一次调用里缓存，别逐条重算 ✓）
    const startAbsCache = new Map();
    const startAbsFor = (k) => {
        const key = String(k || '');
        if (!startAbsCache.has(key)) startAbsCache.set(key, cycleStartAbsOf(key));
        return startAbsCache.get(key);
    };
    for (const x of list) {
        const c = Number(x.contrib);
        if (!Number.isFinite(c)) continue;
        // ★ 只要本周期的批次：跨周期档下账本里会留着上个周期还活着的批次，
        //   但它们属于上一个周期，不该再算进"这个周期的受孕率" ✓
        if (opts.onlyCurrentCycle && isPrevCycleBatch(x, String(x.target || target || ''))) continue;
        // ★ 无月经档：只算"上次判完清零之后"的批次（清零只清百分比，账本照留 ✓）
        if (Number(opts.sinceAt) > 0 && Number(x.at || 0) <= Number(opts.sinceAt)) continue;
        // ★ 事后避孕药：这一批到 nowDay 为止被折过几次 ⇒ 折完再累加 ✓
        const eff = c * pillFactorFor(String(x.target || target || ''), x.depositDay, nowDay);
        sum += eff;
        // 注意：必须先判 null/undefined。Number(null) 是 0，
        // 直接 Number() 会让「没开这个功能」的批次被误判成「第 0 轮就过期」✗
        // ★ 判活统一走 `spermBatchState` —— 有绝对天数就按它判
        //   （跨周期不会再被算活 ✓），老数据退回周期日号口径（老行为一字不变 ✓）
        const st = spermBatchState(x, nowDay, startAbsFor(x.target));
        if (st.alive) {
            viable += eff;
            alive++;
        } else {
            dead++;
            deadList.push({ round: x.round, by: x.by, contrib: eff, until: st.untilDay });
        }
    }
    return { viable: Math.round(viable * 10) / 10, sum: Math.round(sum * 10) / 10, alive, dead, deadList };
}

// ---------------------------------------------------------------------------
// ★ 无月经档（2026-10-20）：没有周期 ⇒ 判定改成「这一轮结束判一次，判完清零」
//   · 清零点存 targets[key].fertilityMarkAt（毫秒时间戳），只影响**百分比**，账本照留 ✓
//   · 判定值 ＝ 这个时间点之后入账的批次之和（amenorrheaLedgerOf）
//   · 成功后走现成的着床天数 ＋ 到日判着床；着床完成日从**判定那天**往后数 ✓
// ---------------------------------------------------------------------------

/** 这个对象「上次判完清零」的时间戳；没判过 ⇒ 0（= 所有批次都算 ✓） */
export function amenorrheaMarkOf(key) {
    const t = state().targets?.[String(key || '')];
    const v = Number(t?.fertilityMarkAt);
    return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 记下清零点（判定那一刻调它 ⇒ 下一轮重新累计 ✓） */
export function setAmenorrheaMark(key, ts) {
    const t = state().targets?.[String(key || '')];
    if (!t) return;
    t.fertilityMarkAt = Number(ts) || Date.now();
    commit();
}

/**
 * 无月经档的「这一轮攒下多少」—— 判定值与候选致孕方都从这里取。
 * @returns {{rate:number, alive:number, dead:number, candidates:string[], count:number}}
 */
export function amenorrheaLedgerOf(key) {
    const mark = amenorrheaMarkOf(key);
    const all = Array.isArray(state().insems) ? state().insems : [];
    const list = all.filter((x) => String(x.target || '') === String(key || '')
        && Number(x.at || 0) > mark);
    const nowDay = (() => { try { return cycleDayNum(key); } catch { return null; } })();
    const startAbs = (() => { try { return cycleStartAbsOf(key); } catch { return null; } })();
    const aliveOnly = (() => { try { return judgeBasisOf() === 'alive'; } catch { return false; } })();
    let rate = 0, alive = 0, dead = 0;
    const candidates = [];
    for (const x of list) {
        const c = Number(x.contrib);
        if (!Number.isFinite(c)) continue;
        const st = spermBatchState(x, nowDay, startAbs);
        if (st.alive) alive++; else dead++;
        if (aliveOnly && !st.alive) continue;
        rate += c * pillFactorFor(String(key || ''), x.depositDay, nowDay);
        if (st.alive) {
            const who = String(x.by || '').trim();
            if (who && who !== '未标注' && !/^(未知|unknown)$/i.test(who) && !candidates.includes(who)) {
                candidates.push(who);
            }
        }
    }
    return { rate: Math.round(rate * 10) / 10, alive, dead, candidates, count: list.length };
}

/**
 * ★ 「截至某一天的累计受孕率」—— 受精判定的**判定值**就取这个。
 *
 * 为什么不再用 AI 报的那个数：判定的时机现在由插件自己掌握，那就得能**回溯到窗口结束那一刻**
 *   —— 剧情一口气跳过整段窗口时，AI 报的"当前累计"已经是跳过之后的了，而判定要的是窗口末尾那个 ✓
 * 规则（跟模块正文一致）：
 *   ① 窗口结束**之后**才发生的行为不参与本周期判定（照常累加进累计受孕率 ✓）
 *   ② **判定口径**由设置 `judgeBasis` 决定（两档，见 `judgeBasisOf()`）：
 *      · 'cumulative'（默认）＝**判定值 = 窗口结束那一刻的累计受孕率** —— 累计率不会因为精子失活而变小
 *        ⇒ 已经计入的贡献照常保留（失活只表示它不再"新增"，不是把旧贡献扣掉 ✓）
 *      · 'alive' ＝**只算窗口结束那一刻还活着的那几批** —— 已失活的批次不进判定值
 *        （它们已经计过的贡献仍然留在累计受孕率里，只是判定不用它 ✓）
 *   ③ 候选致孕方 = 判定时仍有活精子的那批人（**两档都一样**：死掉的批次不会再当致孕方）✓
 *
 * @param {string} target 只看这个追踪对象的批次
 * @param {number} cutoffDay 截止到周期第几天（含）—— 判定时传「窗口最后一天」
 * @param {'cumulative'|'alive'} [basis] 不传 ⇒ 读设置（传参只给自测用，真相源只有设置一处 ✓）
 * @returns {{rate:number, alive:number, dead:number, candidates:string[], basis:string, inWindow:number}}
 *   · `inWindow` = 窗口内一共几批（不管死活）—— 判定那边靠它区分
 *     "根本没有账本"和"窗口内全死光了"（后者判定值就是 0，不能退回它报的数 ✗）
 */
export function fertilityThroughDay(target, cutoffDay, basis) {
    const mode = (basis === 'alive' || basis === 'cumulative') ? basis : judgeBasisOf();
    const cut = Number(cutoffDay);
    const all = Array.isArray(state().insems) ? state().insems : [];
    // ★ 按对象分账：多对象追踪时不能把别人的批次算进来
    const list = target ? all.filter((x) => String(x.target || '') === String(target)) : all;
    let rate = 0, alive = 0, dead = 0, inWindow = 0;
    const candidates = [];
    for (const x of list) {
        const c = Number(x.contrib);
        if (!Number.isFinite(c)) continue;
        // ① 窗口结束之后才发生的 ⇒ 不参与本周期判定
        //   （老数据没有 depositDay ⇒ 认不出来，按"窗口内"处理，宁可宽一点 ✓）
        const d = Number(x.depositDay);
        if (Number.isFinite(cut) && Number.isFinite(d) && d > cut) continue;
        inWindow++;
        // ② 判定那一刻是否还活着 —— 用来算"几批失活"、候选名单，并按口径决定算不算进判定值
        const rawUntil = x.viableUntil;
        const until = (rawUntil == null || rawUntil === '') ? NaN : Number(rawUntil);
        const deadAtCut = Number.isFinite(cut) && Number.isFinite(until) && until < cut;
        if (deadAtCut) dead++; else alive++;
        // ★ 事后避孕药：判定要能回溯到窗口末尾 ⇒ 只算"那一天之前"吃过的药 ✓
        // ★ 'alive' 档：已失活的批次**不进判定值**（累计率那一份由 `viableFertility` 另外算，不在这儿扣）
        if (!(mode === 'alive' && deadAtCut)) {
            rate += c * pillFactorFor(String(x.target || target || ''), x.depositDay, cut);
        }
        if (deadAtCut) continue;
        // ③ 候选致孕方：写不出名字的那些（未标注 / 未知）不列进来
        const who = String(x.by || '').trim();
        if (who && who !== '未标注' && !/^(未知|unknown)$/i.test(who) && !candidates.includes(who)) {
            candidates.push(who);
        }
    }
    return { rate: Math.round(rate * 10) / 10, alive, dead, candidates, basis: mode, inWindow };
}

/** 契约里那些"一次性动作"标记：有没有写 true（字符串写法也认 ✓） */
function flagOn(v) {
    return v === true || /^(true|1|yes|是)$/i.test(String(v ?? '').trim());
}

/** 正则转义（阶段名是玩家可改的，里面可能有括号 ✓） */
function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 所有周期模式下的阶段名（用来认「开头那句写的是哪一期」✓） */
function phaseNamesAll() {
    try {
        const s = settings();
        const out = [];
        for (const tb of [s.phaseNamesNormal, s.phaseNamesNone]) {
            for (const v of Object.values(tb || {})) {
                const x = String(v || '').trim();
                if (x && !out.includes(x)) out.push(x);
            }
        }
        return out.sort((a, b) => b.length - a.length);
    } catch { return []; }
}

/**
 * ★ 窗口 / 排卵日的叫法按这个对象的周期模式换回来（月经档不说中性词 ✓）
 * @returns {string} 改好的整句；空串 = 不用动
 */
export function fixCycleTermText(key, text) {
    const src = String(text || '');
    if (!src) return '';
    try {
        const mode = periodModeOf(key);
        const win = termNameOf('ovulationWindow', mode);
        const oday = termNameOf('ovulationDay', mode);
        const wrongWin = isNeutralMode(mode) ? '排卵窗口' : '受孕窗口';
        const wrongDay = isNeutralMode(mode) ? '排卵日' : '受孕高峰日';
        let out = src;
        if (wrongWin && wrongWin !== win) out = out.split(wrongWin).join(win);
        if (wrongDay && wrongDay !== oday) out = out.split(wrongDay).join(oday);
        return out === src ? '' : out;
    } catch { return ''; }
}

/**
 * ★★ 把「计算说明」开头那句里的**阶段名 / 阶段基础率**改成这一轮真正的值。
 *
 * 为什么插件要管这一句：阶段名和基础率是**插件自己按周期日算的**（见 derive.js），
 *   可模型每轮写 calc 时很容易把上一轮的整句照抄过来 ⇒ 进度写着「排卵期」、
 *   计算说明还写着「卵泡期基础率 8%」（两边打架，玩家会以为数据坏了 ✗）。
 *   ⇒ 只改**开头那一小段**（历史回顾、判定值那些一个字不动 ✓）。
 *
 * @returns {string} 改好的整句；空串 = 不用动（本来就对 / 认不出开头 / 没有周期阶段）
 */
export function fixCalcLeadPhase(key) {
    const t = state().targets?.[String(key || '')];
    if (!t) return '';
    const calc = String(t.profile?.calc || '');
    const phase = String(t.profile?.phase || '');
    const d1 = String(t.profile?.d1 || '');
    if (!calc) return '';
    // ① 窗口 / 排卵日的叫法按周期模式换回来（月经档不说中性词 ✓）
    let out = fixCycleTermText(key, calc) || calc;
    // ② 只在**整句开头**找阶段名 + 基础率（`Day12 卵泡期…` 这种历史回顾不会被误伤 ✓）
    if (phase && phase !== '不适用' && /^\d+(?:\.\d+)?%$/.test(d1)) {
        const names = phaseNamesAll().filter((x) => x !== phase);
        if (names.length) {
            const re = new RegExp('^\\s*(' + names.map(escapeRe).join('|') + ')\\s*基础率\\s*[\\d.]+%');
            if (re.test(out)) out = out.replace(re, `${phase}基础率${d1}`);
        }
    }
    return out === calc ? '' : out;
}

/**
 * ★★ 「这一轮没有新发生什么」时的计算说明 —— 整句由插件写。
 *
 * 口径：没有新增风险行为 ⇒ 公式只有「阶段基础率 × 体质系数」，
 *   累计值不变；判定结果那半照抄插件自己的 d2 标注 / 受精判定原文（不自己造词 ✓）。
 *   时间推进到新的一天、阶段换了 ⇒ 这句话跟着换（不再出现"上一轮那句"✗）。
 *
 * @returns {string} 空串 = 这一轮不是静默轮 / 没有周期阶段 / 没什么可写
 */
export function quietCalcTextOf(key, res) {
    const t = state().targets?.[String(key || '')];
    if (!t) return '';
    const phase = String(t.profile?.phase || '');
    const d1 = String(t.profile?.d1 || '');
    if (!phase || phase === '不适用' || !/^\d+(?:\.\d+)?%$/.test(d1)) return '';
    const quiet = !(Array.isArray(res?.sex_events) && res.sex_events.length)
        && !flagOn(res?.vars?.cleaned)
        && !flagOn(res?.vars?.emergency_pill)
        && !flagOn(res?.implanted)
        && !(String(res?.Cycle_Event || '').trim() && !/^无$/.test(String(res.Cycle_Event).trim()));
    if (!quiet) return '';
    const coef = String(t.profile?.d3 || '').trim();
    const head = `${phase}基础率${d1}` + (coef ? ` × 体质系数${coef}` : '') + '，本轮无新增性行为';
    // ① 有判定结果 ⇒ 直接照抄插件那份（判定值 / 掷出 / 着床日都在里面 ✓）
    const judge = (() => { try { return judgmentForPrompt(key) || ''; } catch { return ''; } })();
    if (judge) return `${head} | ${judge}`;
    // ② 没有判定 ⇒ 用 d2 的标注（那本来就是插件按同一张表写的 ✓）
    const d2 = String(t.profile?.d2 || '');
    const pct = (d2.match(/^([\d.]+%)/) || [])[1] || '';
    const tail = (d2.match(/（([^）]*)）/) || [])[1] || '';
    // 这一轮刚结算过周期 ⇒ 不是"保持"，别写那个词（新周期已经从头算了 ✓）
    const settledToday = (() => {
        try { return !!t.lastSettleDate && String(t.lastSettleDate) === String(currentDate() || ''); }
        catch { return false; }
    })();
    let formula = head;
    if (!settledToday && pct) formula += `，累计受孕率保持原有${pct}不变`;
    return `${formula} | ${tail || '本周期状态没有变化'}`;
}

/**
 * ★ `d2`（累计受孕率）由插件自己填。
 *
 * **数值**＝历史累计（`viableFertility().sum`，事后避孕药的折减已经算进去了）——
 *   口径照模块里的说法：累计率本身不会因为失活而变小，只是判定时不再把这一批算进去 ✓
 * **标注**＝逐字照模块那张【d2状态标注】表（那七条状态的输入插件全都有 ✓）：
 *   窗口前无内射 / 窗口内无精子 / 窗口内有精子 / 窗口后无受精可能 / 受精失败 / 已受精待着床 / 已孕
 *   ⇒ 台词抄模块的，**别自己造词**；`@@TERM:ovulationWindow@@` 的默认渲染是「受孕窗口」✓
 * 「不能怀孕」⇒ 整格填「不适用」（模块里明说的 ✓）
 *
 * @returns {string} 空串＝这个对象不存在（调用方保留原值，绝不清空 ✓）
 */
export function fertilityRateTextOf(key) {
    const t = state().targets?.[key];
    if (!t) return '';
    const day = cycleDayNum(key);
    const isNoCycle = (() => { try { return periodModeOf(key) === 'amenorrhea'; } catch { return false; } })();
    let sum = 0;
    try {
        // ★ 无月经档：只算「上次判完清零之后」的批次（它没有周期可言 ✓）
        const vf = isNoCycle
            ? viableFertility(day, key, { sinceAt: amenorrheaMarkOf(key) })
            : viableFertility(day, key, { onlyCurrentCycle: true });
        if (vf && Number.isFinite(Number(vf.sum))) sum = Number(vf.sum);
    } catch { /* 读不到就按 0 */ }
    const pct = `${Math.round(sum * 10) / 10}%`;
    // 能不能怀孕：锁定的三态 > AI 报的那一格 > 兜底"能"（跟 prompt.js 的 canBePregnantPerson 同一口径 ✓）
    let lock = null;
    try { lock = bodyLockOf(key); } catch { /* 忽略 */ }
    const repCan = String(t?.vars?.can_be_pregnant ?? '').trim().toLowerCase();
    if ((lock && lock.canBePregnant === false) || repCan === 'false') return '不适用';
    const pregnant = String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true';
    if (pregnant) return `${pct}（已着床，数值锁定）`;
    const j = (() => { try { return getOvuJudgment(key); } catch { return null; } })();
    if (j && j.passed === true) return `${pct}（已受精，待着床）`;
    let phase = '';
    try {
        const bp = bodyCycleParamsOf(key);
        if (day !== null && bp) phase = cycleDayInfoOf(day, bp.ovu, periodDaysOf(key)).phaseId;
    } catch { /* 读不到阶段就不往下判 */ }
    const aliveBatch = (() => { try { return viableFertility(day, key).alive > 0; } catch { return false; } })();
    // ★ 窗口的叫法**按这个对象自己的周期模式**走 ——
    //   月经档说「排卵窗口」，非月经 / 无月经档才说「受孕窗口」
    //   （2026-10-20：这里原来写死了「受孕窗口」，月经档的面板跟着说错 ✗）
    const win = (() => { try { return termNameOf('ovulationWindow', periodModeOf(key)) || '排卵窗口'; } catch { return '排卵窗口'; } })();
    // ★ 无月经这一档：没有周期、没有窗口 ⇒ 不许出现「受孕窗口 / 尚未进入 / 待周期结算」这些说法
    //   （这一档的正文写的是「受孕时机按设定与剧情给的日期」✓）
    if (periodModeOf(key) === 'amenorrhea') {
        // 这一轮判过、没中 ⇒ 明说，别让人以为还在等
        if (j && j.passed === false) return `${pct}（这一轮没中，下一轮重新累计）`;
        if (aliveBatch) return `${pct}（体内还有存活精子）`;
        const everInsem = (() => {
            try { return listInseminations().some((x) => String(x.target || '') === String(key || '')); }
            catch { return false; }
        })();
        return everInsem ? `${pct}（体内的精子已经失效）` : `${pct}（暂未发生内射）`;
    }
    if (phase === 'transition' || phase === 'luteal') {
        if (j && j.passed === false) return `${pct}（受精失败，待周期结算）`;
        return `${pct}（本周期无受精可能）`;
    }
    if (phase === 'ovulation' || phase === 'ovulationDay') {
        return aliveBatch
            ? `${pct}（待受精精子存活中，${win}结束时判定）`
            : `${pct}（${win}内暂无待受精精子）`;
    }
    // ★★ 2026-10-16（有精子时受孕率为什么是 0）——卵泡期这一档原来只看：sum 是不是 0
    //   就写「暂未发生内射」✗ ⇒ 本周期**明明记过内射**（只是还没进窗口）时也这么说 ✗
    //   ⇒ 判据改成"**本周期有没有内射记录**"，措辞跟窗口内那一档对齐 ✓
    const hasInsem = (() => {
        try { return listInseminations().some((x) => !isPrevCycleBatch(x, key)); }
        catch { return false; }
    })();
    if (hasInsem) {
        return aliveBatch
            ? `${pct}（待受精精子存活中，尚未进入${win}）`
            : `${pct}（尚未进入${win}）`;
    }
    return sum > 0 ? pct : `${pct}（暂未发生内射）`;
}

/**
 * ★ **当前泌乳阶段 ＋ 参考产奶量** —— 喂给推演，让它照抄进 d7 ✓
 *
 * 为什么是"喂数"而不是"插件直接写 d7"：d7 是**三样混在一起**的
 *   （产奶量 ml/天 · 状态描述 · 乳汁特征），后两样只有剧情/设定知道 ✗
 *   ⇒ 插件只算**它算得出来的那半**（产后第几天 ⇒ 哪一段 ⇒ 参考量 ⇒ 多胎倍率），
 *     让 AI 照这个阶段和参考写，具体数值它按体质与场景在区间内定 ✓（正文本来就是这么写的 ✓）
 * · 产后第几天 ＝ 孩子账本里**最近那次**的出生日 ⇄ 今天（同一套剧情日期 ✓）
 * · 多胎倍率：那一次分娩（同一个 batch）生了几个 ✓
 * @returns {string} 空串 = 没生过 / 没日期 ⇒ 不干预 ✓
 */
export function lactationRefForPrompt(key) {
    try {
        const all = Array.isArray(state().children) ? state().children : [];
        const mine = all.filter((c) => String(c?.key || '') === String(key || '') && String(c?.birthDate || '').trim());
        if (!mine.length) return '';
        const last = mine[mine.length - 1];                 // 账本按时间推进 ⇒ 最后一条最新 ✓
        const today = currentDate();
        if (!today) return '';
        const days = diffDays(String(last.birthDate), today);
        if (!Number.isFinite(days) || days < 0) return '';
        const p = postpartumParamsOf();
        const flow = Number(p.flowStart) || 2;
        const grow = Number(p.growthStart) || 14;
        const stab = Number(p.stableStart) || 30;
        let stage = '', ref = '';
        if (days < flow) { stage = '初乳期'; ref = p.colostrum; }
        else if (days < grow) { stage = '开始大量泌乳'; }
        else if (days < stab) { stage = '奶量快速增长'; }
        else { stage = '稳定泌乳期'; ref = p.stable; }
        const batch = String(last.batch || '');
        const n = batch ? all.filter((c) => String(c?.batch || '') === batch).length : 1;
        const multi = (n >= 2 && p.multi) ? `，多胎（${n} 胎）再乘 ${p.multi}` : '';
        const refTxt = ref ? `参考产奶量 ${ref} ml / 天` : '这一段的量按体质与场景写';
        return `产后第 ${days} 天 · 当前阶段：${stage} · ${refTxt}${multi}`;
    } catch { return ''; }
}

/**
 * 给【上一轮状态】用的一句话：本周期**累计受孕率**（两本账的合计，事后避孕药的折减已算进去）。
 *
 * 只按精子存活模式 / 吃过事后药时给。目的是让 AI 照抄进 d2，免得它自己另算一个总数 ✗
 * ★★ 报的数永远是**累计**（＝d2 那一格），**不是判定值** —— 判定口径两档都只影响"判定那一刻拿哪个数"，
 *   累计受孕率本身不会因为精子失活而变小（那正是"数字莫名其妙变少"的由来 ✗）
 *   ⇒ 失活批次只用一句括号说明"还留在累计里、判定用不用"（按当前口径写 ✓）
 * ⚠️ 返回值是**提示词文本** ⇒ 不许提「插件」、不许加粗、不许描述性破折号 ✓
 *
 * @param {number} nowDay 当前剧情天数
 * @param {string} [target] 这个追踪对象
 * @returns {string} 空串表示「不用干预」（没有存活批次 / 算不出来）
 */
export function effectiveFertilityForPrompt(nowDay, target) {
    let vf;
    const _noCycle = (() => { try { return periodModeOf(target) === 'amenorrhea'; } catch { return false; } })();
    try {
        vf = _noCycle
            ? viableFertility(nowDay, target, { sinceAt: amenorrheaMarkOf(target) })
            : viableFertility(nowDay, target, { onlyCurrentCycle: true });
    } catch { return ''; }
    if (!vf || !vf.alive) return '';
    // ★ 两档的说法不一样：累计档它照样进判定值，仅存活档它不进（写错会带歪计算说明 ✗）
    const alive = judgeBasisOf() === 'alive';
    const note = vf.dead > 0
        ? (alive ? `（另有 ${vf.dead} 批已失活，只留在累计里、不参与判定）`
                 : `（另有 ${vf.dead} 批已失活，仍计入累计）`)
        : '';
    const head = (() => {
        try { return periodModeOf(target) === 'amenorrhea' ? '累计受孕率' : '本周期累计受孕率'; }
        catch { return '本周期累计受孕率'; }
    })();
    return `${head} ${vf.sum}%${note}。`;
}

// ---------------------------------------------------------------------------
// ★ 孕期状态（`Is_Pregnant`）由插件自己掌握
//
// 分工：
//   · **起点**（未孕 → 已孕）：受精成功过的对象走到**着床完成日**（排卵日 + 系统掷的着床天数）
//     ⇒ 插件自己切成 true（就是下面这个 `syncPregnancyState`）
//   · **终点**（已孕 → 未孕）：剧情报事件（分娩 / 妊娠终止）⇒ `settleCycle` 里跟着切回 false
//   · 契约**不再问这一格**：AI 只在【上一轮状态】的 vars 里读它，不许自己写
// 为什么搬：这一格门控着孕期模块 / 发给主 API 的状态摘要 / 阶段插图，
//   AI 报错或报漏一次就是连锁故障；而"到没到着床完成日"插件手上全有
//   （排卵日、着床天数、周期日）⇒ 正是那条原则：插件能计算的东西不要让 AI 代劳 ✓
// ---------------------------------------------------------------------------

/**
 * 按当前进度同步一次孕期状态（幂等，可以每轮随便调）。
 *
 * ⚠️ 周期日走 `cycleDayNum` ⇒ 就是**插件自己按剧情日期算的那个数**，
 *   它已经是全插件唯一来源（契约不再问 `Time_Scale`）✓
 *
 * @param {string} [key] 哪个对象（不给 = 当前查看的那个）
 * @returns {boolean} 现在算不算孕期
 */
export function syncPregnancyState(key) {
    try {
        const s = state();
        const k = key || s.active || '';
        const t = (s.targets || {})[k];
        if (!t) return false;
        if (!t.vars || typeof t.vars !== 'object') t.vars = {};
        // 已经孕着 ⇒ 什么都不做（终点那半由事件触发的 settleCycle 管 ✓）
        if (String(t.vars.Is_Pregnant ?? '').toLowerCase() === 'true') return true;
        // ★ 撤销之后（`conceiveHold`）⇒ 只有推演能切孕；时间同步 / 自动结算一律不许
        if (state().conceiveHold === true) return false;
        const j = getOvuJudgment(k);
        if (!j || j.passed !== true || !j.implantDays) return false;   // 没受精成功 ⇒ 谈不上着床
        let ovu = 14;
        try { ovu = Number(bodyCycleParamsOf(k)?.ovu) || 14; } catch { /* 读不到就用默认 14 */ }
        const done = ovu + Number(j.implantDays);
        // 无月经档没有周期日 ⇒ 按「判定那天 ＋ 着床天数」这个日期比
        const _noCycle = (() => { try { return periodModeOf(k) === 'amenorrhea'; } catch { return false; } })();
        // 剧情已经明确确认怀上了 ⇒ 不再等日子（正文都写了，面板也得跟上）
        const _storyOk = (j.storyConfirmed === true);
        // ★★ 2026-10-23：**着床还没掷 ⇒ 先不切孕**（除非剧情已确认怀孕）。
        //   原来这里漏了这一条 ⇒ "没掷"被当成"没失败" ⇒ 到着床日自动切孕、成功率形同 100% ✗
        //   （她那边就出现了：已孕=true、着床判定却是"还没掷"、剧情里也从没提过怀孕）
        //   ⇒ 掷骰归 settleImplantFor，这里只认结果；没结果就不动孕。
        if (!_storyOk && j.implantPassed !== true && j.implantPassed !== false) {
            try { console.log('[Bodycord] 着床还没掷，先不切孕（' + (displayName(t) || k) + '）'); } catch { /* 忽略 */ }
            return false;
        }
        // ⚠️ 这个 now 后面还要用（孕周 / 日志），别缩进到 else 里 ✗
        const now = cycleDayNum(k);
        if (_storyOk) {
            /* 直接往下走去切孕 */
        } else if (_noCycle) {
            const dd = String(j.doneDate || '');
            const today = (() => { try { return currentDate() || ''; } catch { return ''; } })();
            const left = (dd && today) ? diffDays(today, dd) : null;
            if (left === null || left > 0) return false;
        } else if (now === null || !Number.isFinite(now) || now < done) {
            return false;
        }
        // ★ 着床判定没过 ⇒ 这个周期**永远不会**怀孕（受精成功也可能没着床）
        //   到"着床那天"才提醒一次（幂等：`upsertAlert` 同一个 kind ＋ 对象只留一条 ✓），
        //   早提醒会剧透 —— 那几天剧情还该照着床过程正常演 ✓
        if (j.implantPassed === false) {
            try {
                if (settings().notifyConceive !== false) {
                    const who = displayName(t) || k;
                    upsertAlert({
                        kind: 'implant_fail', target: k, name: who,
                        date: String(j.doneDate || '') || currentDate() || '',
                        note: who + ' 受精成功但没着床',
                    });
                }
            } catch { /* 记不上不影响正事 ✓ */ }
            return false;
        }
        t.vars.Is_Pregnant = 'true';
        // ★ 2026-10-30：切孕这一刻把子宫那本清零（理由同植入那一处：
        //   孕前存下的量不能留到分娩之后又冒出来）✓
        t.wombLoad = 'empty';
        // ★★ 2026-10-23（她的口径：**禁止同一轮**）——
        //   着床判定与胎数/性别判定**不许在同一个轮次里做完**：
        //   切孕这一轮只算着床，胎数/性别留到下一轮的推演里判。
        //   这个标记就是"这一轮别判胎儿"；judge 那边见到它会跳过一次并清掉 ✓
        t.fetusPlanPending = true;
        // ★ **新一轮怀孕 ⇒ 忘掉上一次那个亲代**（不然上一次报的"哪一边"会挂到这一胎上 ✗）
        delete t.vars.impregnator_side;
        // ★ A3：**新一轮怀孕也得忘掉上一次"剧情强制提前"记到哪一档** ——
        //   不然上一胎验孕确认过，这一胎一怀上就直接显示"已确认"✗（档位本身是角色设定，留着 ✓）
        delete t.awarenessEvent;
        // ★ A5：**上一胎的胎数 / 性别判定也得忘掉**（不然这一胎直接套用上一胎几个孩子 ✗）
        delete t.fetusPlan;
        // ★ 2026-10-24：这一胎掷过的天赋 / 显性来源也一起忘掉（新一轮怀孕要重掷 ✓）
        delete t.heritageRolls;
        // ★ 手改修正：**换了一胎** ⇒ 玩家手填的 d6 已经过期了 ⇒ 交回插件 ✓
        //   （不能永久锁住 d6：不然下一胎的胎儿状态还挂着玩家上次填的那份 ✗）
        clearProfileFix(k, 'd6', { silent: true });
        // ★★ 2026-10-23（她报：刚着床内视图就有胚胎、d6 已有孩子数据）——
        //   切孕这一刻**胎数 / 性别还没掷**（`fetusPlanPending`）⇒ d6 只能是「无」。
        //   模型这一轮很可能自己编了胎数 / 性别 / 孕周（它看到"到日子了"就会替系统写），
        //   这里直接按回「无」：面板、内视图、喂回给模型的上一轮状态都跟着干净 ✓
        //   （`upsertTargetResult` 那边还会再按一次 —— 模型回包是在这之后才落账的 ✓）
        try {
            if (!t.profile || typeof t.profile !== 'object') t.profile = {};
            t.profile.d6 = '无';
        } catch { /* 忽略 */ }
        // ★★ 切孕这一刻顺手记一条**自动提醒**（怀孕之类的通知也可以做 ✓）
        //   ⚠️ 幂等靠这里：本函数开头"已经孕着就直接 return" ⇒ 这条只会落一次 ✓
        //   开关关掉 ⇒ 不记（设置里要有开关、默认开启 ✓）
        try {
            if (settings().notifyConceive !== false) {
                const who = displayName(t) || k;
                // ★ 记的是**着床完成那一天**（不是"今天"）——
                //   着床完成那一刻可能被剧情跳过去：
                //   ⇒ 剧情跳过去时这条会在**事后**才弹（不会丢 ✓），日期得是事件真正发生的日子，
                //     气泡那边再拿它跟今天一减，就能说清"已经 N 天了" ✓
                //   优先用判定时存下的 `j.doneDate`，没有就按"今天 − 已经过了几天"反推 ✓
                let doneDate = String(j?.doneDate || '');
                if (!doneDate) {
                    try {
                        const today = currentDate();
                        const dayNow = Number(cycleDayNum(k)) || 0;
                        if (today && dayNow) doneDate = addDays(today, done - dayNow);
                    } catch { /* 算不出来就留空 ⇒ 退回用今天 */ }
                }
                upsertAlert({
                    kind: 'conceive', target: k, name: who, date: doneDate || currentDate() || '',
                    note: who + ' 已着床完成（怀孕）',
                });
            }
        } catch { /* 记不上不影响正事 ✓ */ }
        commit();
        console.log('[Bodycord] 着床完成（' + (displayName(t) || k) + '）：周期 Day' + now
            + ' 已到完成日 Day' + done + '，孕期状态由系统切为已孕');
        return true;
    } catch (e) {
        console.warn('[Bodycord] 同步孕期状态失败', e);
        return false;
    }
}

/**
 * ★ 周期边界：按当前模式结算，并把旧的锁定 / 事件归档。
 *
 * @param {string} mode 'reset'（按周期清零）| 'sperm'（按精子存活）
 * @param {string} reason 触发原因（新周期开始 / 已分娩 / 受精失败结算 / 妊娠终止）
 * @param {{pregnant?:boolean, target?:string, finalReason?:string}} [opts] target = 结算哪个对象（不给就用当前查看的 ✓）；
 *   `finalReason` = **事件自己带来的原因，不许被下面那条派生覆盖**（妊娠终止就是它 ✓）
 */
/** 这个对象现在是第几个周期（1 起；还没记过就是 1 ✓） */
export function currentCycleNoOf(key) {
    try {
        const n = Number(state().targets?.[String(key || state().active)]?.cycleNo);
        return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
    } catch { return 1; }
}

export function settleCycle(mode, reason, opts = {}) {
    const s = state();
    // ★ 按对象分账：只结算**这个对象**的判定 / 锁定 / 事件 ✓
    const who = opts.target || s.active || '';
    const locks = getImpregnatorLocks(who);
    const insems = (Array.isArray(s.insems) ? s.insems : [])
        .filter((x) => !who || String(x.target || '') === String(who));
    // ★ 事后避孕药也按对象取出来（归档要带上它；清账规则见下面那条 ✓）
    const pills = (Array.isArray(s.pills) ? s.pills : [])
        .filter((x) => !who || String(x.target || '') === String(who));

    // ★ 派生「着床失败」：受精成功过（ovuJudgment.passed = true），
    //   但这个周期走完了却没变成怀孕 ⇒ 那就是着床失败 ✓
    //   这种情况在那里写上"着床失败"比较好，不然容易误会
    //   （插件自己判得出：受精成功 + 没怀孕 ⇒ 着床失败，不用加契约字段 ✓）
    // ⚠️ 但**事件自带的原因优先**（`finalReason`）：妊娠终止时受精判定可能
    //   早就 passed 了 ⇒ 派生不该把「妊娠终止」改写成「着床失败」✗
    let finalReason = String(opts.finalReason || reason || '');
    try {
        if (!opts.finalReason) {
            const j = getOvuJudgment(who);
            if (j && j.passed === true && opts.pregnant !== true) {
                finalReason = '着床失败';
            }
        }
    } catch { /* 判不了就用传进来的 */ }
    // ★★ 2026-10-31（她报：分娩之后「胎儿动态」还显示那一胎）——
    //   胎儿那一格平时允许模型不写，插件对"模型没写"的做法是**保留上一轮**
    //   （防孕期中间它顺手写「无」把整格抹掉）⇒ 结果**状态机的终点**也没人走：
    //   分娩 / 妊娠终止那一轮模型不写「无」，旧胎儿就一直挂着，对不对全靠运气 ✗
    //   ⇒ 终点由**插件自己**清；清之前先把原文**挪进归档**（不许借清理之名丢数据：
    //     分娩那批孩子账本只留了种族 / 性别 / 显隐 / 天赋，妊娠终止则一条都没落 ✓）
    const fetusEnd = /已分娩|妊娠终止/.test(finalReason);
    const fetusRaw = (() => {
        try { return String(s.targets?.[who]?.profile?.d6 ?? '').trim(); } catch { return ''; }
    })();
    const fetusKeep = fetusEnd && !!fetusRaw && fetusRaw !== '无' && fetusRaw !== '未加载';
    // 有东西才归档，别塞空记录
    if (locks.length || insems.some((x) => Number(x.contrib) > 0) || pills.length || fetusKeep) {
        if (!Array.isArray(s.conceptionArchive)) s.conceptionArchive = [];
        s.conceptionArchive.push({
            at: Date.now(),
            target: who,
            reason: finalReason,
            mode: String(mode || ''),
            // 胎儿原文（只有分娩 / 妊娠终止那一轮才有；其它结算留空 ✓）
            fetus: fetusKeep ? fetusRaw : '',
            locks: locks.map((x) => ({ ...x })),
            insems: insems.map((x) => ({ ...x })),
            pills: pills.map((x) => ({ ...x })),
        });
        // 只留最近 20 段
        if (s.conceptionArchive.length > 20) {
            s.conceptionArchive.splice(0, s.conceptionArchive.length - 20);
        }
    }
    // ★ 归档完了才清那一格（顺序不能反：先存后清 ✓）
    //   ⚠️ 只认**终点事件**：换周期 / 受精失败结算照旧不动它（那时还怀着呢 ✓）
    if (fetusEnd) {
        try {
            const t0 = (s.targets || {})[who];
            if (t0) {
                if (!t0.profile || typeof t0.profile !== 'object') t0.profile = {};
                if (String(t0.profile.d6 ?? '').trim() !== '无') {
                    t0.profile.d6 = '无';
                    console.log('[Bodycord] ' + (displayName(t0) || who) + ' 的胎儿那一格按回「无」（' + finalReason + '）');
                }
            }
        } catch { /* 清不掉不影响结算本身 */ }
    }
    // ★ 事后避孕药：**两种模式都清**——
    //   它的 `day` 是**周期日号**，换周期之后会重头数（第 14 天 → 又是第 1 天）
    //   ⇒ 留着会把本周期的批次按上一周期的药折一遍（静默算错 ✗）。记录已经归档 ✓
    if (Array.isArray(s.pills) && pills.length) {
        s.pills = s.pills.filter((x) => !who || String(x.target || '') !== String(who));
    }
    // 按模式处理（⚠️ 只动这个对象的批次；别人的账不能跟着清零 ✗）
    // ★ 妊娠终止：本周期**就此结束** ⇒ 精子批次两种模式都要真清掉。
    //   为什么不能走"按精子存活那档自然失效"：那一档是给**周期正常轮转**用的
    //   （存活期还没到的批次留着继续参与判定 ✓）；而妊娠终止之后这个周期不该再有受精可能，
    //   留着活批次 ⇒ 累计受孕率不会归零、d2 还会被喂回一个不该有的数 ✗
    const ended = finalReason === '妊娠终止';
    if (mode === 'sperm' && !ended) {
        // 按精子存活：不清零，让它们按各自的存活期限自然失效
        // （但因为要把"参与判定"的账重新起算，这里只清空"已失活"的旧批次）
        // ★ 判活走 `spermBatchState`，而且这里**明确按"今天"判**
        //   （`forceAbs`）—— 结算就是要清掉**到今天就已失活**的旧批次；
        //   若写成 `Number(viableUntil) > 0` 就永远为真 ⇒ 死批次一直留着、下个周期又被算活 ✗
        //   老数据（只有周期日号、没有绝对天数）保持老行为：留着 ✓
        const keepBatch = (x) => spermBatchState(x, null, cycleStartAbsOf(who), true).alive;
        s.insems = (Array.isArray(s.insems) ? s.insems : []).filter((x) => {
            if (who && String(x.target || '') !== String(who)) return true;   // 别人的留着 ✓
            return keepBatch(x);
        });
    } else {
        // 按周期清零：**这个对象**上周期精子全部清零（记录已归档）
        s.insems = (Array.isArray(s.insems) ? s.insems : []).filter(
            (x) => who && String(x.target || '') !== String(who));
    }
    // 锁定与"当前判定"也按对象清 ✓
    // ⚠️ 同样只认**明确写了 target** 的那批（方案 B）：以前 `String(x?.target || who) !== who`
    //   ⇒ 没带 target 的老条目会在**任何对象结算时**被当成自己的清掉（误删别人的 ✗）。
    //   现在这类老条目一律不认 ⇒ 顺手把它们清出去（口径：没有老玩家，直接丢 ✓）
    if (Array.isArray(s.impregnatorLocks)) {
        const rest = s.impregnatorLocks.filter((x) => {
            const t = String(x?.target || '');
            return t && t !== String(who);       // 别人的留着；没写 target 的（老数据）丢掉 ✓
        });
        s.impregnatorLocks = rest.length ? rest : null;
    }
    // ★ 来源 / 分批也是按对象分账的 ⇒ 同一个口径清
    //   （换了周期 / 分娩之后不该还挂着上一胎的归属 ✓ 判定那份归档留着 ✓）
    if (Array.isArray(s.impregnatorSources)) {
        const rest = s.impregnatorSources.filter((x) => {
            const t = String(x?.target || '');
            return t && t !== String(who);
        });
        s.impregnatorSources = rest.length ? rest : null;
    }
    // ★ 植入起点同理：清了之后这一胎就不再是"植入孕" ⇒ 孕周基准回到周期日 ✓
    try {
        if (s.implantDates && typeof s.implantDates === 'object') delete s.implantDates[String(who)];
    } catch { /* 忽略 */ }
    if (Array.isArray(s.ovuJudgments)) {
        // 判定历史保留（那是账），但"当前那份"要清掉 ✓
        // ⚠️⚠️ 光清 `s.ovuJudgment`（单数）**没用** —— `getOvuJudgment()` 优先读数组，
        //   而每条判定都会 push 进数组 ⇒ 清完之后那个「受精成功 → 着床还需 N 天」
        //   依旧会被 `judgmentForPrompt()` 每轮喂回给 AI，之后每次结算又继续判成「着床失败」✗
        //   ⇒ 改成给**这个对象**的条目打 `settled` 标记（历史照留，只是不再算"当前判定"）✓
        let touched = false;
        for (const r of s.ovuJudgments) {
            if (String(r?.target || '') === String(who)) { r.settled = true; touched = true; }
        }
        if (touched) s.ovuJudgment = null;
    }
    // 老数据（只有单数那份）也要清，而且要**只清属于这个对象的那份** ✓
    if (s.ovuJudgment && String(s.ovuJudgment.target || '') === String(who)) s.ovuJudgment = null;
    // ★ 记下「这个对象上次结算是在哪个剧情日期」——
    //   契约里的条件 B（距上次结算 > Cycle_Length 天）**没有数据源** ✓
    //   ⚠️ 初始**留白**：没有日期就不写，绝不假造一个（口径：初始默认不要硬搞这个东西，
    //      就跟刚进入游戏里面的 1 级一样白板 ✓）
    try {
        const tt = (s.targets || {})[who];
        // ★ **事件型终点**（分娩 / 妊娠终止）⇒ 孕期状态由插件切回 false。
        //   （起点"着床完成 ⇒ 切 true"在 `syncPregnancyState` 里 ✓）
        //   ⚠️ 这一段**不许挂在 `today` 上**：剧情还没给日期时分娩照样得生效 ✗
        if (tt && /新周期开始|已分娩|妊娠终止/.test(finalReason)) {
            if (!tt.vars || typeof tt.vars !== 'object') tt.vars = {};
            if (/已分娩|妊娠终止/.test(finalReason)) {
                tt.vars.Is_Pregnant = 'false';
                // ★ 2026-10-30：孕期里子宫那本一直是空的（孕期进不去精液）⇒
                //   出孕期时也按空落盘，别让孕前的旧值借这个机会冒出来 ✓
                tt.wombLoad = 'empty';
            }
            // ★★ **这一胎的「另一个亲代属于哪一边」也一起忘掉** ——
            //   那格是"这一胎"的属性（怀孕时问一次、之后记着）⇒ 孕期一结束就该清 ✓
            //   ⚠️ 只靠"下一次怀孕时清"（syncPregnancyState 里那处）会留一个空窗：
            //     产后每轮还靠它把异种门控开着、继续发两张表，空窗期内新来的
            //     混血对象还会拿**上一胎**那一边去裁表 ✗
            delete tt.vars.impregnator_side;
            // 周期结束只把：残留清空，有量（少/中/多/满）的不动
            //   ⇒ 周期结束**只把「残留」清空**，有量（少/中/多/满）的**不动** ✓
            //   （不是整本清零：玩家明确说过：跨周直接清精液不合理✗）
            try { settleResidueLoad(who); } catch { /* 记不上不影响结算 */ }
        }
        const today = currentDate();
        if (tt && today) {
            tt.lastSettleDate = today;
            // ★ 连**原因**一起记下来 ——
            //   结算可能是插件自己触发的，AI 得靠这个才知道"这一轮为什么结算了"，
            //   好在计算说明里写清过程（AI 仍写过程、但不参与任何数值判断 ✓）
            tt.lastSettleReason = finalReason;
        }
        // ★ 2026-10-26：一次结算 = 一个周期走完 ⇒ 周期序号 +1
        //   （记录里"第几个周期"靠它；只用于相对定位，不碰时间轴 ✓）
        if (tt) tt.cycleNo = Math.max(1, (Number(tt.cycleNo) || 1) + 1);
    } catch { /* 记不上不影响结算本身 */ }
    commit();
    return { mode, reason: finalReason, archived: true };
}

/**
 * 这个聊天有没有开始跑（有没有任何推演痕迹）。
 *
 * 用来判断「周期结算模式」该立刻生效还是等下个周期：
 * 数据是空的（刚建的聊天 / 还没推演过）⇒ **直接生效** ✓
 * 已经有数据了 ⇒ 才需要等到周期边界换挡（规则中途变 AI 会懵 ✗）
 */
export function hasConceptionData() {
    const s = state();
    return !!((s.snapshots || []).length || (s.insems || []).length || s.ovuJudgment || s.impregnatorLocks
        || (Array.isArray(s.impregnatorSources) && s.impregnatorSources.length)
        || Object.keys(s.implantDates || {}).length);
}

/**
 * 记下这次受精判定的结果。
 *
 * ★ **按对象分账**（别让看哪个对象的受孕记录都是同一份 ✗）：
 *   每条判定都带 `target`，压进 `ovuJudgments`；`ovuJudgment`（单数）保留成"当前查看对象的最近一次"，
 *   这样面板/提示词的旧读法不用改也不会串 ✗✓
 *
 * @param {object} j 判定结果
 * @param {string} [key] 这次判定属于哪个对象；不给就用"当前查看的对象" ✓
 */
/**
 * ★ 改一条**已经存下**的判定记录（不新加一条）。
 *
 * 用途：着床判定默认留到着床日那一轮才掷 ⇒ 掷完要把它补进原来那条记录里
 *   （受精成功那条是已经存好的，不能为了补个着床结果再多压一条 ✗）。
 * · 只动这个对象**最近一条**判定（`ovuJudgments` 里 target 匹配的最后一条）＋ 单数那份
 * · 找不到就什么都不做（调用方自己保证前置条件 ✓）
 *
 * @param {string} key 对象键
 * @param {object} patch 要覆盖的字段（implantJudge / implantPassed / doneDate …）
 * @returns {boolean} 改到了没有
 */
export function patchOvuJudgment(key, patch) {
    const s = state();
    const k = String(key || s.active || '');
    if (!k || !patch || typeof patch !== 'object') return false;
    let hit = null;
    if (Array.isArray(s.ovuJudgments)) {
        for (let i = s.ovuJudgments.length - 1; i >= 0; i--) {
            if (String(s.ovuJudgments[i]?.target || '') === k) { hit = s.ovuJudgments[i]; break; }
        }
    }
    if (!hit) return false;
    Object.assign(hit, patch);
    if (String(s.ovuJudgment?.target || '') === k && s.ovuJudgment === hit) { /* 同一引用，已一起改 ✓ */ }
    else if (String(s.ovuJudgment?.target || '') === k) Object.assign(s.ovuJudgment, patch);
    commit();
    return true;
}

export function setOvuJudgment(j, key) {
    const s = state();
    const t = key || s.active || '';
    if (j) {
        const rec = { ...j, target: t, at: Date.now() };
        if (!Array.isArray(s.ovuJudgments)) s.ovuJudgments = [];
        s.ovuJudgments.push(rec);
        // 只留最近 50 条（够回溯，也不至于把 metadata 撑大）
        if (s.ovuJudgments.length > 50) s.ovuJudgments.splice(0, s.ovuJudgments.length - 50);
        s.ovuJudgment = rec;
    } else {
        s.ovuJudgment = null;
    }
    commit();
    return s.ovuJudgment;
}

/**
 * 撤掉某个对象身上的受精判定（**官方修改器**用：玩家要：设为未孕时连判定一起撤 ✓）。
 * ⚠️ 只撤这个对象的 —— 判定是**按对象**存的（`ovuJudgments` 数组）✓
 * ⚠️ 不清它的话：`syncPregnancyState` 下一轮会照着旧判定再把 `Is_Pregnant` 切回 true ✗
 */
export function clearOvuJudgmentOf(key) {
    const s = state();
    const k = String(key || s.active || '');
    if (!k) return false;
    if (Array.isArray(s.ovuJudgments)) {
        s.ovuJudgments = s.ovuJudgments.filter((x) => String(x?.target || '') !== k);
    }
    if (String(s.ovuJudgment?.target || '') === k) s.ovuJudgment = null;
    commit();
    return true;
}

/**
 * 手动写「致孕方锁定」（**官方修改器**用 —— 比如开局就怀着某个不出场 / 已经没了的人的孩子 ✓）。
 * @param {string} key 哪个对象
 * @param {Array<{impregnator?:string, side?:string}>} list 每胎一条（留空的名字会被跳过 ✓）
 */
export function setImpregnatorLocksOf(key, list) {
    const s = state();
    const k = String(key || '');
    if (!k) return false;
    const rest = Array.isArray(s.impregnatorLocks)
        ? s.impregnatorLocks.filter((x) => String(x?.target || '') !== k)
        : [];
    const mine = [];
    for (const x of (Array.isArray(list) ? list : [])) {
        const nm = String(x?.impregnator || '').trim();
        if (!nm) continue;
        const rec = { target: k, impregnator: nm };
        if (String(x?.side || '').trim()) rec.side = String(x.side).trim();
        mine.push(rec);
    }
    const all = rest.concat(mine);
    s.impregnatorLocks = all.length ? all : null;
    commit();
    return mine.length > 0;
}

/**
 * 取某个对象最近一次的受精判定。
 * @param {string} [key] 不给就用"当前查看的对象" ✓（老调用点不用改）
 */
export function getOvuJudgment(key) {
    const s = state();
    const want = key || s.active || '';
    if (Array.isArray(s.ovuJudgments) && s.ovuJudgments.length) {
        for (let i = s.ovuJudgments.length - 1; i >= 0; i--) {
            const r = s.ovuJudgments[i];
            // ★ 已结过周期的判定不再当"当前判定"（周期边界时打的 settled 标记 ✓）
            if (r?.settled === true) continue;
            if (String(r?.target || '') === String(want)) return { ...r };
        }
        return null;   // 有历史、但这个对象没有 ⇒ 就是没有 ✓（别把别人的给它 ✗）
    }
    // 老数据（只有单数那份）⇒ 只在"没指定对象/就是当前"时给，别串账 ✓
    const j = s.ovuJudgment;
    if (!j) return null;
    if (!want || String(j.target || want) === String(want)) return { ...j };
    return null;
}

/** 逐胎致孕方锁定（异卵异父）—— 同样按对象分账 ✓ */
export function setImpregnatorLocks(list, key) {
    const s = state();
    const t = key || s.active || '';
    // ⚠️⚠️ **只替换这个对象的那一份** ✓
    //   原来是整表赋值（`s.impregnatorLocks = 新数组` 或 null）⇒ 只要这一轮有**任何一个**
    //   对象报的不是"每个胎儿一份名单"（传 null），**全场所有对象刚锁好的那几胎一起被清空** ✗
    //   （症状：喂回 AI 的「致孕方锁定」凭空消失，AI 会重新锁 ⇒ 违反"锁定不可逆" ✓）
    const others = (Array.isArray(s.impregnatorLocks) ? s.impregnatorLocks : [])
        .filter((x) => String(x?.target || t) !== String(t));
    const mine = Array.isArray(list) && list.length
        ? list.map((x) => ({ ...x, target: x.target || t }))
        : [];
    const all = [...others, ...mine];
    s.impregnatorLocks = all.length ? all : null;
    commit();
    return s.impregnatorLocks;
}

/**
 * 取某个对象的逐胎锁定。
 * @param {string} [key] 不给就用"当前查看的对象" ✓
 */
export function getImpregnatorLocks(key) {
    const l = state().impregnatorLocks;
    if (!Array.isArray(l)) return [];
    const want = key || state().active || '';
    if (!want) return [];
    // ⚠️ 只认**明确写了 target** 的条目（方案 B）：
    //   以前是 `String(x?.target || want) === want` ⇒ 没带 target 的老条目会被**任何对象认领**
    //   （查 B 也能拿到 A 那份致孕方锁定，还会被喂回给 AI ⇒ 串账 ✗）。
    //   口径：没有老玩家 —— 从没真跑过剧情、没有要照顾的老存档，
    //   所以这类条目**直接不认**（宁可少一条，也不要串到别人身上）✓
    const out = l.filter((x) => String(x?.target || '') === String(want));
    return out.map((x) => ({ ...x }));
}

// ---------------------------------------------------------------------------
// ★★ 来源 / 分批（含植入方）—— 定
//
// 为什么要有：**只有剧情知道**"这批卵是谁塞进来的 / 这一胎是谁的"⇒ 让引擎报一条自由文本，
//   插件只做**宽松解析**（认不出就整格作废、退回原来那套显示，绝不污染数据 ✓）。
// ⚠️ 口径：**按批，不逐个**（逐个精准地算容易算炸）✓
//   它只是一个"归属 / 显示"的事实源：**判定一个字都不参与** ✓
//   （受精成不成 / 受孕率 / 胎数 / 性别 / 同卵 全不碰 ✓）
// ---------------------------------------------------------------------------

/** 宽松解析引擎报的那句「来源 / 分批」。认不出 ⇒ null（整格作废 ✓） */
export function parseImpregnatorSource(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const parts = [];
    const seen = new Set();
    const push = (by, count) => {
        const name = String(by || '').trim().replace(/^(?:前|后|第)\s*/, '');
        if (!name || name.length > 16) return;
        const n = Number.isFinite(count) && count > 0 ? Math.round(count) : null;
        const k = name + '|' + (n === null ? '' : n);
        if (seen.has(k)) return;
        seen.add(k);
        parts.push({ by: name, count: n });
    };
    // 语序一：名字在前（「触手一 40 枚」「甲共 30 个」）
    for (const m of text.matchAll(/([^\s，,、；;：:0-9]{1,16})\s*(?:共|约|各)?\s*(\d+)\s*(?:枚|颗|个|胎)/g)) {
        push(m[1], Number(m[2]));
    }
    // 语序二：数字在前（「40 枚属触手一」「前 30 枚归甲」）
    for (const m of text.matchAll(/(\d+)\s*(?:枚|颗|个|胎)\s*(?:属|归|是|由|为)?\s*([^\s，,、；;0-9]+)/g)) {
        push(m[2], Number(m[1]));
    }
    if (!parts.length) {
        // 单批没写数量（契约教它写「植入方：触手一」）⇒ **必须带前缀才认** ✓
        //   ⚠️ 不能"短句就当一个名字"：那样随便一句看不懂的话都会被当成来源，
        //     整格作废（null）才是对的行为 ✗
        const m = text.match(/^(?:植入方|来源|来自)\s*[:：]\s*([^\s]{1,16})$/);
        if (m && !/[，,、；;]/.test(m[1])) push(m[1], null);
    }
    if (!parts.length) return null;
    return { text, parts };
}

/** 这个对象的来源 / 分批（**玩家手填的优先**于引擎报的 ✓） */
export function impregnatorSourceOf(key) {
    try {
        const want = String(key || state().active || '');
        const list = Array.isArray(state().impregnatorSources) ? state().impregnatorSources : [];
        const mine = list.filter((x) => String(x?.target || '') === want);
        if (!mine.length) return null;
        return mine.find((x) => x.manual === true) || mine[mine.length - 1];
    } catch { return null; }
}

/** 写这个对象的来源 / 分批（`entry` 传 null ⇒ 只清他那一份 ✓） */
export function setImpregnatorSourceOf(entry, key) {
    const s = state();
    const t = String(key || s.active || '');
    const others = (Array.isArray(s.impregnatorSources) ? s.impregnatorSources : [])
        .filter((x) => String(x?.target || t) !== t);
    const mine = entry ? [{ ...entry, target: t }] : [];
    const all = [...others, ...mine];
    s.impregnatorSources = all.length ? all : null;
    commit();
    return s.impregnatorSources;
}

/** 来源标注显示成什么（d4 那一格 / 受孕记录都用它 ✓） */
export function sourceTextOf(entry) {
    if (!entry) return '';
    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    if (!parts.length) return String(entry.text || '').trim();
    const withN = parts.filter((p) => p.count);
    if (parts.length === 1 && !withN.length) return parts[0].by;
    if (parts.length === withN.length && parts.length > 1) {
        return parts.map((p) => p.by).join('、') + '（分批 ' + parts.map((p) => p.count).join('/') + '）';
    }
    // 混着写（有的带数、有的没带）⇒ 老老实实列出来
    return parts.map((p) => (p.count ? p.by + ' ' + p.count : p.by)).join('、');
}

/** 第 i 个（从 1 数）胎位归属谁（按分批的累计数分配 ✓）；分不出来 ⇒ '' */
export function sourceOwnerOf(entry, index) {
    const parts = Array.isArray(entry?.parts) ? entry.parts : [];
    if (!parts.length) return '';
    const counted = parts.filter((p) => p.count);
    if (!counted.length) return parts.length === 1 ? parts[0].by : '';
    let at = 0;
    for (const p of counted) {
        at += p.count;
        if (index <= at) return p.by;
    }
    return counted[counted.length - 1].by;   // 超出总数 ⇒ 归最后一批（几十上百枚只能这样 ✓）
}

/** 这个对象的植入起点日期（空串 = 不是植入孕 ✓） */
export function implantDateOf(key) {
    try {
        const want = String(key || state().active || '');
        return String(state().implantDates?.[want] || '').trim();
    } catch { return ''; }
}

/** 植入孕的孕周基准：植入那天到今天的**天数**（不是植入孕 ⇒ null ✓） */
export function pregDaysOf(key) {
    try {
        const d = implantDateOf(key);
        if (!d) return null;
        const today = currentDate();
        if (!today) return null;
        const n = diffDays(d, today);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch { return null; }
}

/** 记 / 清植入起点（`date` 传空 ⇒ 清掉 ✓） */
export function setImplantDateOf(key, date) {
    const s = state();
    if (!s.implantDates || typeof s.implantDates !== 'object') s.implantDates = {};
    const k = String(key || s.active || '');
    const d = String(date || '').trim();
    if (d) s.implantDates[k] = d; else delete s.implantDates[k];
    commit();
    return s.implantDates[k] || '';
}

/**
 * ★★ 同卵 ⇒ 逐胎锁定的致孕方全并到子1 那条（**同卵不可能异父** ✓ 专门交代过）。
 *
 * 为什么要改**存下来的锁定**、而不只是改某处的显示：
 *   d4 名单（`impregnatorTextOf`）/ 喂回给引擎的锁定行 / 受孕记录面板 / 出生时落孩子账本
 *   全都直接读这份锁定 ⇒ **改一处管全部** ✓（散着改迟早漏一处，而漏掉正是玩家最怕的那种错）
 * ⚠️ 只改「哪个人」，**掷出来的骰子（roll）一个字不动**（那是当时真掷过的记录 ✓）
 * ⚠️ 子1 那条没名字 ⇒ 什么都不动（宁可不改，也别把别人名字清掉 ✗）
 * @returns {boolean} 有没有改动
 */
export function collapseLocksForSameOvum(key) {
    try {
        const locks = getImpregnatorLocks(key);
        if (!Array.isArray(locks) || locks.length < 2) return false;
        const plan = (() => { try { return fetusPlanOf(key); } catch { return null; } })();
        // 老存档 / 整胎同卵：没有 groups 时按"全部并到子1"的老行为 ✓
        // ⚠️ 但「同卵/异卵表认不出」的不许当成同卵（老行为不动 ✓）
        const groups = (Array.isArray(plan?.groups) && plan.groups.length)
            ? plan.groups
            : (plan && plan.sameOvum === true
                ? [{ kids: locks.map((x) => (Number(x?.child) || 1) - 1), same: true }]
                : null);
        if (!groups) return false;
        const next = locks.map((x) => ({ ...x }));
        const find = (child) => next.find((x) => (Number(x?.child) || 1) === child);
        let changed = false;
        for (const g of groups) {
            if (!g || !g.same || !Array.isArray(g.kids) || g.kids.length < 2) continue;
            const children = g.kids.map((k) => Number(k) + 1).filter((n) => Number.isFinite(n) && n >= 1);
            let who = '';
            for (const c of children) {
                const e = find(c);
                const nm = String(e?.impregnator || '').trim();
                if (nm) { who = nm; break; }
            }
            if (!who) continue;
            for (const c of children) {
                let e = find(c);
                if (!e) { e = { target: key, child: c, impregnator: '' }; next.push(e); }
                if (String(e.impregnator || '').trim() !== who) { e.impregnator = who; changed = true; }
            }
        }
        if (!changed) return false;
        setImpregnatorLocks(next, key);
        return true;
    } catch { return false; }
}

/**
 * ★★ 「体内现在有什么」这一栏（2026-10-21）。
 *
 * 为什么要有它：row1 的定义里只列了体内器官 / 腺体 / 生殖道 / 内分泌，受精卵压根没被提到，
 *   模型手上明明有「已受精待着床」这个事实也不会往 row1 里写，只会接着上一轮继续写精子。
 *   这里把"体内现在有什么"直接摆给它，栏名和模块里那句**一字不差**，它照抄就行。
 *
 * ★ 四档，**一律不预告结果**（着床判定默认到日子那一轮才掷，这一刻谁都说不准）：
 *   · 只有精子：`只有精子（N 批）`
 *   · 只有受精卵：`只有受精卵，还没着床（着床判定日 X，还有 N 天）`
 *   · 两样都有：`有受精卵，还没着床（着床判定日 X，还有 N 天）；另外还有 N 批活精子`
 *   · 判过没成：`受精卵没能着床，正在被吸收`
 *   · 已孕 / 什么都没有 ⇒ 空串（孕期那几栏在管，或整栏不发 ✓）
 */
export function implantEggForPrompt(targetKey = null) {
    const key = String(targetKey || '');
    if (!key) return '';
    try {
        const t = state().targets?.[key];
        if (!t) return '';
        // 已经着床完成（已孕）⇒ 交给孕期那几栏，别在这里再说一遍
        if (String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true') return '';
        const alive = (() => {
            try { return Number(viableFertility(cycleDayNum(key), key)?.alive) || 0; } catch { return 0; }
        })();
        const spermWord = alive > 0 ? `${alive} 批` : '';
        const j = getOvuJudgment(key);
        if (!j || j.passed !== true || !j.implantDays) {
            return alive > 0 ? `只有精子（${spermWord}）` : '';
        }
        if (j.implantPassed === false) return '受精卵没能着床，正在被吸收';
        if (j.implantPassed === true) return '';
        const ovu = Number(bodyCycleParamsOf(key)?.ovu) || 14;
        const done = ovu + Number(j.implantDays);
        const now = Number(cycleDayNow(key));
        const left = Number.isFinite(now) ? Math.max(0, done - now) : null;
        // ★ 2026-10-26：这一栏不写具体日期，只写"受精之后第几天 + 还有几天"
        //   （日期属于那条时间轴，写进来会被导出/导入带着跑；相对天数够用了 ✓）
        const egg = '受精卵，还没着床（受精之后第 ' + Number(j.implantDays) + ' 天'
            + (left === null ? '' : `，还有 ${left} 天`) + '）';
        return alive > 0
            ? `有${egg}；另外还有 ${spermWord}活精子`
            : `只有${egg}`;
    } catch { return ''; }
}

/**
 * ★★ row1 的兜底补写（2026-10-21）。
 *
 * 病根不在"它没看到事实"，而在**它在照抄上一轮的 row1**：
 *   连续三轮 row1 一字不差，第一轮歪了（精子全死光了还在写精子）之后就一直歪下去；
 *   摘要里明明写着「只有受精卵，还没着床（…）」，它还是接着写"精子已全部失去活力"。
 * ⇒ 插件能确定的事实就别指望它：这一格缺了这颗蛋，插件就补在最前面。
 *
 * ⚠️ **只补不改**：它写的器官 / 腺体那半是好的，原句原样留着，只在最前面加一句事实。
 * ⚠️ 已经出现「受精卵 / 囊胚 / 胚胎」⇒ 不动（它写了就别重复）✓
 * ⚠️ 玩家手改过这一格（`isProfileFieldFixed`）⇒ 不动 ✓
 */
export function patchRow1ForEgg(key) {
    try {
        const t = state().targets?.[String(key || '')];
        if (!t || !t.profile) return false;
        const row1 = String(t.profile.row1 || '');
        if (!row1.trim()) return false;
        if (/受精卵|囊胚|胚胎/.test(row1)) return false;
        if (isProfileFieldFixed(key, 'row1')) return false;
        const fact = implantEggForPrompt(key);
        if (!fact) return false;
        const brief = /^只有受精卵/.test(fact) ? '体内有受精卵，还没着床'
            : /^有受精卵/.test(fact) ? '体内有受精卵，还没着床，另外体内还有活精子'
                : /^受精卵没能着床/.test(fact) ? '体内那颗受精卵没能着床，正在被吸收'
                    : '';
        if (!brief) return false;
        t.profile.row1 = `${brief}。${row1}`;
        return true;
    } catch { return false; }
}

/** 给提示词看的一句话（喂回给 AI，让它接着写着床 / 或者知道没中） */
// ★ **着床完成那一天的剧情日期** —— 喂回去当**事实**用。
//
// ⚠️ 别拿它当预产期的起点：预产期的口径是**「从上次月经那天起算」**（LMP，跟孕周同源；见 judge.js 的
//   ensureGestationDates，且那个日期**由插件自己算**、不交给模型）
//   ⇒ 这一格的用途只是"让模型知道着床哪天完成"，**不是预产期的起点** ✗
// · 「该种族的孕期长度」是模型侧的表 ⇒ 它照抄区间就行，加法归插件 ✓（插件能算的别让 AI 代劳）
// · 「着床完成那天」插件手上有（受精判定掷的 `implantDays` ＋ 排卵日 ⇒ 周期日）
//   ⇒ 把那个**周期日换算成剧情日期**喂回去，省得它做两次换算 ✓
//   （只喂「周期 Day18」的话，那是个周期日号、不是能加天数的日期）
// · 拿不到日期（剧情日期还没推进 / 读不到周期锚点）⇒ 只给周期日那句，别假装有日期 ×
// ---------------------------------------------------------------------------


export function judgmentForPrompt(key, fetusCount = 0) {
    const j = getOvuJudgment(key);
    if (!j) return '';
    // ★ 「仅存活精子」那一档的判定值会比累计小 ⇒ 回给模型时**标明口径**，
    //   不然它会拿"累计 16% → 判定值 8%"去解释，写成"系统算错了"这种话 ✗
    const basisTag = (j.basis === 'alive') ? '（判定只算还活着的批次）' : '';
    const _sub = String(j.sub || '').trim();
    const line = `${_sub ? _sub + ' ' : ''}累计 ${j.rate}% → 判定值 ${j.judgeValue}%${basisTag} · 掷出 ${j.roll?.value} → ${j.passed ? '受精成功' : '未受精'}`;
    // ★★ 模块承诺"会连同着床完成日一起告诉你"，
    //   而只给"着床还需 N 天"的话，那个 N 是**自排卵日算起**的 6 到 10 天
    //   ⇒ 判定是在排卵日之后才跑的，那个数把已经过去的天数又算了一遍（偏大）✗
    //   现在两个都给：完成日 = 排卵日 + 着床天数（和模块里"Day(排卵日+6) 到 Day(排卵日+10)"同源 ✓），
    //   "还需"按**现在的周期日**减出来 ✓
    const extra = (() => {
        if (!(j.passed && j.implantDays)) return '';
        // ★ 着床判定没过：**到着床那天才告诉它** ——
        //   早说的话，剧情会提前几天就演"没怀上"（那几天本来还该照着床过程走 ✓）
        if (j.implantPassed === false) {
            try {
                const ovu = Number(bodyCycleParamsOf(key)?.ovu) || 14;
                const doneDay = ovu + Number(j.implantDays);
                const now = Number(cycleDayNow(key));
                if (Number.isFinite(now) && now >= doneDay) {
                    return `；受精成功但没能着床（着床日 ${j.doneDate || ('周期 Day' + doneDay)} 已过），本周期不会怀孕，按没怀上写`;
                }
            } catch { /* 算不出来就照旧往下走 */ }
        }
        // ★ 无月经那档没有排卵日 ⇒ 文案里不许写「自排卵日算起」（那是编事实 ✗）
        const noCycle = (() => { try { return periodModeOf(key) === 'amenorrhea'; } catch { return false; } })();
        try {
            const ovu = Number(bodyCycleParamsOf(key)?.ovu) || 14;
            const done = ovu + Number(j.implantDays);
            const now = Number(cycleDayNow(key));
            const left = Number.isFinite(now) ? Math.max(0, done - now) : null;
            // ★ 起点必须写出来（2026-10-20 她报"着床天数 10 天 vs 还需 8 天，看着不对"）——
            //   「着床天数」是从**排卵日**算的总天数，「还需」是从**今天**算的剩余天数，
            //   两个起点不同、都正确，但不写清楚就会被读成自相矛盾 ✗
            const anchor = noCycle ? '' : `（自排卵日 Day${ovu} 算起）`;
            const dayTag = noCycle ? '' : `（周期 Day${done}）`;
            // ★ 2026-10-26：不报具体日期，只报"受精之后第几天 + 还有几天"——
            //   日期属于时间轴，写进记录会被导出/导入带着跑（2012 日期落进 2022 的档就是这么来的）✓
            return `；着床天数 ${j.implantDays} 天${anchor}，着床判定日 = 受精之后第 ${Number(j.implantDays)} 天${dayTag}`
                + (left === null ? '' : `，还有 ${left} 天`);
        } catch {
            return `；着床天数 ${j.implantDays} 天` + (noCycle ? '' : '（自排卵日算起）');
        }
    })();
    const locks = getImpregnatorLocks(key);
    // ★ 判定那一轮就把胎位掷满（子1..子4），可那时**胎数还没判出来**
    //   ⇒ 喂回给 AI 的只列**已知胎数那几条**（胎数还不知道时只列子1）✓
    // ★ 同卵 ⇒ 只有一个致孕方，别列成一串（同卵不可能异父 ✓）
    //   ⚠️ 胎数没传进来时**用插件自己判出来的那个**（别默认 1，否则双胎会被截成子1 ✓）
    const _n = Math.max(1, Number(fetusCount) || knownFetusCountOf(key) || 0);
    // ★ 胎数很多（≥5）⇒ 只喂子1（正文【大批量卵】：几十上百枚整批按子1 归属 ✓）
    const show = (sameOvumOf(key) || _n >= 5)
        ? locks.filter((x) => (Number(x.child) || 1) === 1).slice(0, 1)
        : locks.filter((x) => (Number(x.child) || 1) <= _n);
    // ★★ 来源 / 分批（2026-10-14）：有它就喂它 —— 让引擎照抄着写 d6 / cot（归属以它为准 ✓）
    //   ⚠️ 只喂**归属**：判定那半（受精 / 受孕率 / 胎数 / 性别）一个字都不受影响 ✓
    const srcTxt = (() => { try { return sourceTextOf(impregnatorSourceOf(key)); } catch { return ''; } })();
    // ★★ 锁定行**一律不写「子N」**——
    //   这一刻还没着床、胎数也没判出来，根本还没有"子1、子2"这种东西；
    //   写上去会被读成"已经有几个孩子了 / 只有一个孩子" ✗
    //   ⇒ 只列致孕方的名字（同一个人的多胎并成一个名字），掷值跟在名字后面便于对账 ✓
    const lockTxt = (() => {
        if (!show.length) return '';
        const picked = [];       // [{ name, roll }]，按出现顺序
        for (const x of show) {
            const nm = String(x.impregnator || '').trim();
            if (!nm) continue;
            const hit = picked.find((p) => p.name === nm);
            if (hit) { if (hit.roll == null && x.roll) hit.roll = x.roll; continue; }
            picked.push({ name: nm, roll: x.roll || null });
        }
        return picked.map((p) => p.name + (p.roll ? `（掷${p.roll.value}）` : '')).join('、');
    })();
    // ★ 未受精没有"致孕方锁定" —— 这一行只在 j.passed === true 时才拼 ✓
    const lockLine = (j.passed !== true)
        ? ''
        : (srcTxt
            ? `｜致孕方锁定：${srcTxt}`
            : (lockTxt ? `｜致孕方锁定：${lockTxt}` : ''));
    return line + extra + lockLine;
}

/**
 * ★★ `d4`（致孕方）也归插件 —— 这一格的来源本来就是**插件自己掷的锁定结果**，
 *    AI 只是把它照抄一遍（抄错面板就错，而它没有别的用途 ⇒ 不该让它抄）。
 *
 * 口径（跟模块里那句一致）：
 *   · 受精成功 ＋ 有锁定 ⇒ 名单（单人就写名字；多人写成 `甲、乙（异卵异父）`）
 *   · ★ 同卵 ⇒ 永远只有一个名字（同卵不可能异父 ✓ 就算锁定那份还没并好，这里也不认第二个）
 *   · 其余（没判过 / 受精失败 / 分娩或妊娠终止后锁被清掉）⇒ 「无」
 * @returns {string} 空串 = 读不出结论（这种情况一个字都不动，绝不清空 ✓）
 */
export function impregnatorTextOf(key) {
    try {
        const j = getOvuJudgment(key);
        // ★ 未受精 ⇒ 没有致孕方（来源 / 分批那一格也不能盖过这个结论 ✓）
        if (j && j.passed === false) return '无';
        // ★ 着床判定没过 ⇒ 这个周期没怀上（连来源也不显示 ✓）；植入没有判定 ⇒ 这一条不适用
        if (j && j.passed === true && j.implantPassed === false) return '无';
        // ★★ 来源 / 分批**压过**掷骰那份归属（2026-10-14）——
        //   ① 它讲的是"这批是谁的"，比"子1 是谁"更贴近事实 ✓
        //   ② **植入卵根本没有受精判定**，靠下面那条路永远只会得到「无」✗
        //   ⚠️ 只管归属：判定（受精 / 受孕率 / 胎数 / 性别）一个字都不碰 ✓
        const src = impregnatorSourceOf(key);
        if (src) {
            const txt = sourceTextOf(src);
            if (txt) return txt;
        }
        const locks = locksWithinFetusCount(key, getImpregnatorLocks(key));
        if (!j || j.passed !== true || !locks.length) return '无';
        const sameOvum = sameOvumOf(key);
        // ★ 胎数很多（≥5）时也只报子1 —— 正文【大批量卵】那条：
        //   "几十上百枚不逐枚掷骰：整批按子1 那一条归属"（胎数从这一胎的 plan 读 ✓）
        const manyFetus = (() => {
            try { return Number(fetusPlanOf(key)?.count) >= 5; } catch { return false; }
        })();
        const pool = (sameOvum || manyFetus)
            ? [locks.find((x) => (Number(x?.child) || 1) === 1) || locks[0]]
            : locks;
        const names = [];
        for (const x of pool) {
            const n = String(x?.impregnator || '').trim();
            if (n && !names.includes(n)) names.push(n);
        }
        if (!names.length) return '无';
        if (names.length === 1) return names[0];
        return names.join('、') + '（异卵异父）';
    } catch { return ''; }
}

/**
 * ★★ 把「中招」标到账本上 —— 由插件按判定与锁定结果自己算，不再让 AI 贴这个标记。
 *
 * 判据：
 *   · **只标一条**（账本注释写的就是"conceived=true 的那条就是中的那一次" ✓）
 *   · 受精成功 ＋ 致孕方在锁定名单里 ＋ 落在受孕窗口内
 *   · **判定时仍存活**（已失活的不算）＋ 只认真的内射（前液 / 外射 / 外部摩擦不算）
 *   · 同一人有多条合格批次时，取**最晚入账**的那一条（同一天按轮次）
 *   · 每次判定先把**本周期**的旧标记清掉再标（重判成失败时不会留着上一次的中招 ✓）
 * @returns {number} 这次标了几笔（0 或 1）
 */
export function markConceivedInsems(key, windowLast) {
    try {
        const s = state();
        if (!Array.isArray(s.insems)) return 0;
        const limit = Number(windowLast);
        // ① 先清本周期旧标记（历史周期的中招不动 ✓）
        let cleared = false;
        for (const it of s.insems) {
            if (String(it?.target || '') !== String(key || '')) continue;
            if (isPrevCycleBatch(it, key)) continue;
            if (it.conceived === true) { it.conceived = false; cleared = true; }
        }
        const j = getOvuJudgment(key);
        if (!j || j.passed !== true) {
            if (cleared) commit();
            return 0;
        }
        const names = new Set(getImpregnatorLocks(key).map((x) => String(x?.impregnator || '').trim()).filter(Boolean));
        if (!names.size) {
            if (cleared) commit();
            return 0;
        }
        // ② 合格批次：窗口内、判定时还活着、真内射、致孕方对得上
        const pool = [];
        for (const it of s.insems) {
            if (String(it?.target || '') !== String(key || '')) continue;
            if (isPrevCycleBatch(it, key)) continue;
            const d = Number(it?.depositDay);
            if (Number.isFinite(d) && Number.isFinite(limit) && limit > 0 && d > limit) continue;
            const u = Number(it?.viableUntil);
            if (Number.isFinite(u) && Number.isFinite(limit) && limit > 0 && u < limit) continue;
            const guard = String(it?.protection || it?.guard || '').trim();
            if (/^(前液接触|外部摩擦|无套外射|完好无损|短效避孕药)$/.test(guard)) continue;
            if (!names.has(String(it?.by || '').trim())) continue;
            pool.push(it);
        }
        if (!pool.length) {
            if (cleared) commit();
            return 0;
        }
        pool.sort((a, b) => (Number(b.depositDay) || 0) - (Number(a.depositDay) || 0)
            || (Number(b.round) || 0) - (Number(a.round) || 0));
        pool[0].conceived = true;
        commit();
        return 1;
    } catch { return 0; }
}

// ---------------------------------------------------------------------------
// ★ 孩子（出生后的记录）
//
// 形态：
//   · 胎儿出生后自动记录孩子信息：性别、出生日期、能力（如果打开了遗传）、名字编辑
//     （AI 可能认不准多个孩子的名字，所以推荐让用户自己编辑）、日后的年龄追踪（比如一年后一岁）
//   · 还得记录孩子的爹 ⇒ 用项目既有的中性词：**另一个亲代** ✓
//   · 胎儿动态是胎儿，出生了就不是胎儿了 ⇒ 单开一个「孩子」频道 ✓
//   · 存聊天 + 跟着当前查看的人变（不要把所有孩子塞一起）⇒ 按对象过滤 ✓
//   · 显示可以隐藏，但插件必须记录日子 ⇒ 出生日期一定落库（精确到日）✓
//   · 满岁只到月、不显示天（定稿 ✓）
//
// ⚠️ 边界：
//   ① **只存插件内**（不发给主 API；但给了个选项，**默认关闭** ✓）
//   ② 就在 state 里 ⇒ 自动跟着回滚 / 快照 / 迁移走（`cloneStateForRecord` 是整表拷贝 ✓）
//   ③ 一条孩子 = 一次落库；**同一次分娩只记一次**（去重键见 addChild ✓）
//   ④ 名字**不采信 AI**（AI 认不准多胎的名字）⇒ 只由玩家填，默认空 ✓
// ---------------------------------------------------------------------------

const CHILD_MAX = 200;

/** 本聊天的孩子表（保证是数组；老聊天没有这个字段 ⇒ 这里补齐 ✓） */
export function children() {
    const s = state();
    if (!Array.isArray(s.children)) s.children = [];
    return s.children;
}

export function childCount() { return children().length; }

/**
 * ★ **生产次数**从孩子账本数出来（不再问 AI）。
 *
 * 判据（和模块那句「填次数，死胎不计入」对齐）：
 *   · 数的是**分娩次数**，不是孩子个数 ⇒ 按 `batch`（谁生的 ＋ 哪一天）去重 ✓
 *     （双胞胎算 1 次、两天各生一个算 2 次 ✓ —— 这正是 addChildren 的 batch 语义）
 *   · **死胎天然不计入** —— 死胎根本不落孩子账本（只有 `已分娩` 那一轮才写 ✓）
 * @param {string} [key] 只看这个对象；不给就全部
 * @returns {number}
 */
export function birthCountOf(key) {
    try {
        const want = String(key || '').trim();
        const list = want ? children().filter((x) => String(x.key || '') === want) : children();
        const batches = new Set();
        for (const x of list) batches.add(String(x.batch || ''));
        return batches.size;
    } catch { return 0; }
}

/** 只看某个对象生的（"跟着当前查看的人变" ✓）；不给 key = 全部 */
export function childrenOf(key) {
    const want = String(key || '').trim();
    const list = children();
    if (!want) return list.map((x) => ({ ...x }));
    return list.filter((x) => String(x.key || '') === want).map((x) => ({ ...x }));
}

function childId() {
    return 'c' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * 记一批新出生的孩子（推演报「已分娩」那一轮调用 ✓）。
 *
 * @param {Array<{race?:string,sex?:string,impregnator?:string,extra?:string}>} kids 从胎儿卡拆出来的
 * @param {object} opts { target, date, floor, round, manual }
 *   ⚠️ `manual: true` = **玩家手动加的**（悬浮球菜单那个按钮）⇒ ①允许全空
 *      ②**不去重**（同一天可以加两条，去重键用随机 id ✓）
 * @returns {Array} 这次真正落库的那几条（去重掉的不算）
 */
export function addChildren(kids, opts = {}) {
    const s = state();
    const manual = opts.manual === true;
    const raw = Array.isArray(kids) ? kids.filter((k) => k && typeof k === 'object') : [];
    const list = manual ? raw : raw.filter((k) => (String(k.race || '').trim() || String(k.sex || '').trim() || String(k.impregnator || '').trim()));
    if (!list.length) return [];
    const key = String(opts.target || s.active || '');
    const date = String(opts.date || '').trim();
    // ★ 去重键 = 「谁生的 + 哪一天（拿不到日期就退回轮次）」——
    //   同一次分娩重复推演不会多记；**分次分娩**（两天各生一个）日期不同 ⇒ 各记一条 ✓
    const batch = manual ? ('manual|' + childId()) : `${key}|${date || ('r' + (opts.round ?? ''))}`;
    if (!Array.isArray(s.children)) s.children = [];
    if (!manual && s.children.some((x) => String(x.batch || '') === batch)) return [];
    const out = [];
    for (const k of list) {
        const rec = {
            id: childId(),
            batch,
            key,
            name: '',                                    // 名字留给玩家填（AI 不采信 ✓）
            sex: String(k.sex || '').trim(),
            race: String(k.race || '').trim(),
            other: String(k.impregnator || '').trim(),   // 「另一个亲代」（数据字段沿用胎儿卡那套 ✓）
            heritage: String(k.extra || '').trim(),      // 遗传能力（显性 / 隐性携带）
            talent: String(k.talent || '').trim(),        // 天赋（职业 / 身份 / 训练出来的东西，一整句话）
            strength: String(k.strength || '').trim(),    // 天赋强度（插件按档位填）
            birthDate: date,                             // 出生日期（精确到日；剧情没给就是虚拟日期 ✓）
            floor: opts.floor ?? null,
            round: opts.round ?? null,
            at: Date.now(),
        };
        s.children.push(rec);
        out.push(rec);
    }
    // 上限：丢最旧的（聊天跑很久也不能把 chat_metadata 撑爆 ✓）
    if (s.children.length > CHILD_MAX) s.children.splice(0, s.children.length - CHILD_MAX);
    commit();
    return out;
}

/** 改一条（名字 / 出生日期 / 另一个亲代 / 遗传能力 —— 玩家手改走这里 ✓） */
export function updateChild(id, patch = {}) {
    const rec = children().find((x) => String(x.id) === String(id));
    if (!rec) return false;
    const map = { name: 'name', sex: 'sex', race: 'race', other: 'other', heritage: 'heritage', talent: 'talent', strength: 'strength', birthDate: 'birthDate' };
    let changed = false;
    for (const [k, f] of Object.entries(map)) {
        if (patch[k] === undefined) continue;
        const v = String(patch[k] ?? '').trim();
        if (rec[f] !== v) { rec[f] = v; changed = true; }
    }
    if (changed) commit();
    return changed;
}

export function removeChild(id) {
    const s = state();
    const i = (s.children || []).findIndex((x) => String(x.id) === String(id));
    if (i < 0) return false;
    s.children.splice(i, 1);
    commit();
    return true;
}


// ---------------------------------------------------------------------------
// 年龄（按**剧情日期**算，不按现实时间 ✓）
// ---------------------------------------------------------------------------

/** 当前剧情日期（插件一直在维护 state().fictionDate ✓） */
export function storyDateNow() {
    // ★ 走 currentDate()（而不是直接读 state）—— 它顺手把历法对齐一次 ✓
    try { return currentDate().trim(); } catch { return ''; }
}

/**
 * 年龄拆成 年 / 月 / 天（**按当前这套历法算**，不是拿天数硬除 365 ✗）。
 * @returns {{y:number,m:number,d:number,days:number}|null} 日期缺一个 / 还没出生 ⇒ null
 */
export function childAgeParts(birthDate, nowDate) {
    const cal = activeCalendar();
    const b = parseFictionDate(birthDate, cal);
    const n = parseFictionDate(nowDate, cal);
    if (!b || !n) return null;
    const days = diffDays(b, n, cal);
    if (days == null || days < 0) return null;
    const nM = cal.months.length;                 // ★ 一年几个月由历法决定（4 个月一年也照样对 ✓）
    let y = n.y - b.y;
    let m = n.m - b.m;
    let d = n.d - b.d;
    if (d < 0) {
        // 借上一个月的天数（1 月要跨回上一年的最后一个月 ✓）
        let pm = n.m - 1;
        let py = n.y;
        if (pm < 1) { pm = nM; py = n.y - 1; }
        const pdays = daysInMonthOf(cal, py, pm);
        m -= 1;
        d += pdays;
    }
    if (m < 0) { y -= 1; m += nM; }
    return { y: Math.max(0, y), m: Math.max(0, m), d: Math.max(0, d), days };
}

/**
 * 年龄写成一句话。
 * ★ 档位：不满 1 个月给天数；不满 1 岁给「M 个月 D 天」；**满岁只到月**（不带天 ✓）
 * @returns {string} 空串 = 算不出来（日期缺一个 / 剧情日期没推进）
 */
export function childAgeText(birthDate, nowDate) {
    const p = childAgeParts(birthDate, nowDate);
    if (!p) return '';
    if (p.y > 0) return `${p.y} 岁${p.m ? ` ${p.m} 个月` : ''}`;
    if (p.m > 0) return `${p.m} 个月 ${p.d} 天`;
    if (p.days <= 0) return '刚出生';
    return `出生 ${p.days} 天`;
}

/**
 * 给面板「孩子」频道那份（纯数据，怎么画由 bodycord.html 决定 ✓）。
 * ★ 按对象过滤（跟着当前查看的人变，不要把所有孩子塞里面 ✓）
 */
export function childrenForPanel(key) {
    const s = state();
    const want = String(key || s.active || '');
    const list = childrenOf(want);
    const now = storyDateNow();
    let activeName = '';
    try {
        const t = want ? (s.targets || {})[want] : null;
        // ★★ 名字槽位走 `userLabel()`（本人那一档的档案名是字面的 `{{user}}`，
        //   直接 displayName 会把宏印到界面上 ✗ —— 会显示成「看的是 {{user}} 的孩子」，
        //   跟「消息」页头是同一个病 ✓）
        activeName = t ? (isUserKey(t.key) ? userLabel() : (displayName(t) || t.key || '')) : '';
    } catch { activeName = ''; }
    return {
        count: list.length,
        activeName,
        now,
        // 新的在前（最近出生的看着最顺 ✓）
        list: list.slice().reverse().map((x, i) => ({
            id: x.id,
            // ⚠️ 给面板的字段叫 `title` 不叫 `name`（跟成就同一个理由：
            //   "不许硬编码中文人名"那条断言是按 `name:` 扫的 ✗）
            title: String(x.name || '').trim() || `第 ${list.length - i} 个孩子`,
            named: !!String(x.name || '').trim(),
            sex: x.sex || '',
            race: x.race || '',
            other: x.other || '',
            heritage: x.heritage || '',
            talent: x.talent || '',
            strength: x.strength || '',
            birthDate: x.birthDate || '',
            age: childAgeText(x.birthDate, now),
        })),
    };
}

// ---------------------------------------------------------------------------
// ★ 涩涩成就
//
// 形态：
//   · AI 只给一个成就名字和描述，插件负责记录 —— 纯记录，以后也不会发回给 AI
//   · 按聊天存 ✓（就在 state 里，换聊天不带走）
//   · 每条带一个虚拟时间记录，触发的时候落库 ✓
//   · 名称上限八个字
//
// ⚠️ 四条不许动的边界：
//   ① 成就内容**永不回喂给 AI** ⇒ 这里刻意不提供任何"喂进提示词"的函数 ✗
//   ② **同名 = 同一件事**：因为①，AI 看不到已有清单 ⇒ 只能靠名字去重（要求它同名不重复报）
//   ③ 有条数上限，超了**丢最旧的** —— 聊天跑很久也不能把 chat_metadata 撑爆 ✓
//   ④ 就在 state 里 ⇒ 自动跟着回滚 / 快照走，平行世界不串味 ✓
// ---------------------------------------------------------------------------

const ACH_MAX = 300;
let _achSeq = 0;

/** 本聊天的成就表（保证是数组；老的聊天没有这个字段 ⇒ 这里补齐 ✓） */
export function achievements() {
    const s = state();
    if (!Array.isArray(s.achievements)) s.achievements = [];
    return s.achievements;
}

export function achievementCount() {
    return achievements().length;
}

/** 去重用：名字去空格、转小写（「初次中招」和「初次中招 」算同一条） */
function achNameKey(name) {
    return String(name ?? '').trim().toLowerCase();
}

/**
 * 落库一批新成就（推演触发的**那一轮**调用）。
 * @param {Array<{name?:string, quip?:string, targetKey?:string, targetName?:string}>} list
 * @param {{date?:string, floor?:number|null}} opts
 * @returns {number} 真的新增了几条（空名字 / 同名的会被丢掉）
 */
/**
 * ★★ 2026-10-23：把模型报的成就**统一成数组**（一轮可以报多条）。
 *
 * 以前契约里只有一格 `achievement: {…}`，模型就算想报两条也没有地方写 ⇒
 *   怀孕 / 着床 / 分娩同轮撞在一起时只能挑一条（她指出的就是这个）。
 * 现在：数组、最多 cap 条；单对象（老写法）也认；空名字丢掉 ✓
 * @param {any} raw 契约里的 achievement（数组 / 单个对象 / null）
 * @param {number} [cap] 一轮最多收几条（默认 4，跟气泡上限对齐）
 */
export function normalizeReportedAchievements(raw, cap = 4) {
    const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
    const out = [];
    for (const a of arr) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
        const name = String(a.name ?? '').trim();
        if (!name) continue;
        out.push({
            name,
            why: String(a.why ?? ''),
            quip: String(a.quip ?? ''),
            type: String(a.type ?? a.kind ?? '').trim(),
            // ★ 2026-10-24：这条成就是关于谁的（顶层字段；老的回包没有就留空）
            about: String(a.about ?? a.owner ?? a.subject ?? '').trim(),
        });
        if (out.length >= cap) break;
    }
    return out;
}

/**
 * ★★ 2026-10-24：一条成就是「关于谁」的，要认成哪个追踪对象。
 *
 * 以前成就嵌在每个对象里，写在谁下面就记在谁头上；现在每条自己带 `about`，
 *   由这里按名字认人：玩家本人（{{user}} / 你 / 我…）⇒ USER_KEY；
 *   名单里的人 ⇒ 按显示名 / 别名认；认不出来 ⇒ 空串（**不许硬塞给谁**）✓
 */
const ACH_USER_ABOUT = /^(?:\{\{\s*user\s*\}\}|user|you|你|我|你自己|用户本人|主控角色|玩家)$/i;

export function resolveAchievementOwnerKey(rawAbout) {
    const raw = String(rawAbout ?? '').trim();
    if (!raw) return '';
    // ★★ 2026-10-28（她定：成就只能记正式档）——
    //   轻档只登记名字和种族，不进推演名单，也不该挂成就；
    //   名字撞上轻档就**不认**（留空 = 按聊天级的那条记名字，不硬塞给人 ✓）
    const formalOnly = (key) => {
        if (!key) return '';
        try {
            const t = state().targets?.[key];
            if (t && t.light === true) return '';
        } catch { /* 忽略 */ }
        return key;
    };
    const bare = stripNameDecor(raw);
    const isUserWord = (x) => ACH_USER_ABOUT.test(String(x || '').trim());
    if (isUserWord(raw) || isUserWord(bare)) return formalOnly(USER_KEY);
    for (const nm of [raw, bare]) {
        if (!nm) continue;
        try {
            const t = findTargetByReportedName(nm);
            if (t) return formalOnly(t.key);
        } catch { /* 忽略 */ }
    }
    return '';
}

/**
 * ★★ 2026-10-24：从**一次回包**里收集这一轮的成就（顶层一份；兼容旧版写在对象里的）。
 *
 * 为什么要有它：成就按聊天存，不该按对象分。模型只要写清「关于谁」，
 *   插件就能把成就挂到对的人头上；认不出来就只记名字，**绝不塞给名单里的人** ✗
 *
 * @param {any} json 推演回包
 * @param {number} [cap] 最多收几条（默认 8，留给事件筛掉之后还能补上；最终上限仍是 4）
 * @returns {Array<{name:string,why:string,quip:string,type:string,about:string,targetKey:string,targetName:string}>}
 */
export function collectReportedAchievements(json, cap = 8) {
    const out = [];
    const push = (a, aboutFallback) => {
        if (out.length >= cap) return;
        const name = String(a?.name ?? '').trim();
        if (!name) return;
        const about = String(a?.about ?? '').trim() || String(aboutFallback || '').trim();
        const key = resolveAchievementOwnerKey(about);
        const t = key ? state().targets?.[key] : null;
        let targetName = '';
        if (t) targetName = displayName(t) || t.key || '';
        else if (key === USER_KEY) targetName = userLabel();
        else targetName = about;
        out.push({
            name,
            why: String(a?.why ?? ''),
            quip: String(a?.quip ?? ''),
            type: String(a?.type ?? '').trim(),
            about,
            targetKey: key,
            targetName,
        });
    };
    // ① 新写法：顶层一份
    for (const a of normalizeReportedAchievements(json?.achievements, cap)) push(a, '');
    // ② 旧写法（兼容）：写在各对象里面的，按"写在谁下面就属于谁"兜底
    const items = Array.isArray(json?.targets) ? json.targets : [];
    for (const item of items) {
        for (const a of normalizeReportedAchievements(item?.achievement, cap)) push(a, item?.name);
    }
    return out;
}

export function addAchievements(list, opts = {}) {
    const arr = achievements();
    // ★★ 2026-10-24（她：不能吞任何数据）——
    //   普通成就不再按「名字＋依据」去重：模型报几条就记几条，重复的也照记（她自己会删）。
    //   只保留**事件键**去重：同一次事件重推 / 回滚重算不该重复解锁 ✓
    const haveKey = new Set(arr.map((x) => String(x?.key || '')).filter(Boolean));
    let added = 0;
    const fresh = [];   // ★ 这一批**真的新加**的条目（给右上角气泡用 ✓）
    for (const raw of (Array.isArray(list) ? list : [])) {
        const name = String(raw?.name ?? '').trim();
        if (!name) continue;
        // ★ 事件键：插件事件成就用它去重（重推同一楼 / 回滚重算不会重复解锁 ✓）
        const evKey = String(raw?.key || raw?.eventKey || '').trim();
        if (evKey && haveKey.has(evKey)) continue;
        if (evKey) haveKey.add(evKey);
        _achSeq++;
        // ★ 下面三格的 24 / 60 / 80 只是**保险丝**（不是规则）——
        //   而出厂的吐槽上限是 90 > 80 ⇒ 出厂状态就会被切掉尾巴；玩家把上限调到 80 / 60 / 24 以上
        //   也完全不起作用 ✗（规则句由设置说了算，保险丝只兜底）
        //   ⇒ 保险丝取「设置上限 + 4」与原保险丝里大的那个（+4 留点余量，免得把词切半截 ✓）
        const achFuse = (k, base) => Math.max(base, achLenOf(k) + 4);
        const entry = {
            // id 只要在这个聊天里唯一就行（面板按钮 / 删除都按它认）
            id: 'a' + Date.now().toString(36) + '_' + _achSeq,
            name: name.slice(0, achFuse('name', 24)),   // 规则是 8 字；保险丝跟着设置走 ✓
            quip: String(raw?.quip ?? '').trim().slice(0, achFuse('quip', 80)),
            // ★ 「触发依据」——
            //   光看描述看不懂这个成就到底指什么 ⇒ 给它加一个"因为什么数据触发"的字段 ✓
            //   ⇒ 由 AI 一起报（它才知道这一轮到底发生了什么），≤20 字、只在真解锁时输出 ✓
            why: String(raw?.why ?? '').trim().slice(0, achFuse('why', 60)),
            target: String(raw?.targetName ?? '').trim(),
            targetKey: String(raw?.targetKey ?? ''),
            date: String(opts.date ?? '').trim(),
            floor: (opts.floor === null || opts.floor === undefined) ? null : Number(opts.floor),
            // ★ 2026-10-28：本聊天里**新解锁**的成就显式标 false ——
            //   老数据里"没有标记"的才按导入痕迹去认（见 isImportedAchievement ✓）
            imported: false,
            at: Date.now(),
        };
        if (evKey) entry.key = evKey;
        if (raw?.type) entry.type = String(raw.type).trim().slice(0, 12);
        arr.push(entry);
        fresh.push(Object.assign({}, entry));
        added++;
    }
    if (arr.length > ACH_MAX) arr.splice(0, arr.length - ACH_MAX);   // 丢最旧的 ✓
    if (added) {
        commit();
        // ★ 2026-10-18：真解锁了才发事件（设置页手动补一条也走这儿 ✓）。
        //   只发**新加的那几条**，不带整张表 —— 事件只负责"弹一下气泡" ✓
        try {
            if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('bodycord:achievementsAdded', { detail: { items: fresh } }));
            }
        } catch { /* 忽略 */ }
    }
    return added;
}

/**
 * ★★ 2026-10-23（她报：回包给了成就却被插件吃掉）——
 *   从**上一次回包**里把被误杀的事件成就捡回来（打开聊天时跑一次）。
 *
 * 为什么需要：事件成就的判据（这一轮真的发生了吗 / 内容像不像"等待结果"）是我们自己写的，
 *   判错一次就会把模型写好的那条永久丢掉；而模型已经为它花过 token 了。
 *   ⇒ 只要回包里那条**现在仍然成立**（着床完成＝当前确实怀着；受精成功＝判定本来就是 passed），
 *     就按事件键补记回去 ✓
 *
 * ⚠️ 每条回包只补一次（记 `lastRawAchRecoveredAt`）——不然她手动删掉之后，下次加载又会长回来 ✗
 * ⚠️ 只补**事件成就**（带 type 的那两种）；普通成就不碰（没有事件键，补了会重复）✓
 * @returns {number} 补了几条
 */
export function recoverEventAchievementsFromLastRaw() {
    try {
        const s = state();
        const raw = String(s.lastJudgeRaw?.text || '');
        const at = Number(s.lastJudgeRaw?.at || 0);
        if (!raw || !at) return 0;
        if (Number(s.lastRawAchRecoveredAt) === at) return 0;
        const a = raw.indexOf('{');
        const b = raw.lastIndexOf('}');
        if (a < 0 || b <= a) return 0;
        let json = null;
        try { json = JSON.parse(raw.slice(a, b + 1)); } catch { return 0; }
        const TYPE = { '受精成功': 'fertilize', '着床完成': 'conceive' };
        let n = 0;
        // ★ 2026-10-24：新回包把成就放在顶层、每条带「关于谁」；
        //   老回包是按对象写的 ⇒ 交给同一个收集器（它会按 about 认人、没有就按写在谁下面兜底）✓
        for (const x of collectReportedAchievements(json, 8)) {
            const kind = TYPE[String(x.type || '').trim()];
            if (!kind) continue;
            const key = String(x.targetKey || '');
            const t = key ? s.targets?.[key] : null;
            if (!key || !t) continue;
            // 写歪成"等待结果"的也不捡回来（跟 judge 那道语义校验同一个口径 ✓）
            if (/(判定日|等着|等待|结果还没|还没出|还得掷|掷骰子)/.test(
                String(x.name || '') + String(x.quip || ''))) continue;
            let j = null;
            try { j = getOvuJudgment(key); } catch { j = null; }
            if (kind === 'conceive') {
                if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() !== 'true') continue;
            } else {
                if (!(j && j.passed === true)) continue;
            }
            const id = String(j?.doneDate || '') || (kind === 'fertilize' ? ('Day' + (j?.day || '')) : (currentDate() || ''));
            const evKey = kind + ':' + key + ':' + id;
            const date = String(j?.doneDate || id || currentDate() || '');
            n += addAchievements([{
                name: x.name, why: x.why, quip: x.quip, type: x.type, key: evKey,
                targetKey: key, targetName: displayName(t) || key,
            }], { date, floor: null });
        }
        // 不管补没补到，都记下"这条回包已经处理过"（不然她删掉后每次加载又长回来 ✗）
        s.lastRawAchRecoveredAt = at;
        commit();
        if (n) console.log('[Bodycord] 从上次回包里补回事件成就 ' + n + ' 条');
        return n;
    } catch (e) {
        console.warn('[Bodycord] 补回事件成就失败', e);
        return 0;
    }
}

/** 删一条（面板是只读的 ⇒ 只有设置页会调它 ✓） */
export function removeAchievement(id) {
    const arr = achievements();
    const i = arr.findIndex((x) => String(x.id) === String(id));
    if (i < 0) return false;
    arr.splice(i, 1);
    commit();
    return true;
}

/**
 * 改一条成就的内容（2026-10-18，改数值里的「成就可改可删」）。
 *
 * 只改**内容**：名字 / 触发依据 / 吐槽。对象、日期、楼层是"当时发生了什么"，
 * 手改它们只会让记录和正文对不上 ⇒ 不给改 ✓
 *
 * @returns {'ok'|'empty'|'dup'|'missing'} 空名字 / 和别的成就重名 / 这条已经不在了
 */
export function updateAchievement(id, patch = {}) {
    const arr = achievements();
    const a = arr.find((x) => String(x.id) === String(id));
    if (!a) return 'missing';
    const f = (k, base) => Math.max(base, achLenOf(k) + 4);
    if ('name' in patch) {
        const nm = String(patch.name ?? '').trim();
        if (!nm) return 'empty';
        const k = achNameKey(nm);
        if (arr.some((x) => x !== a && achNameKey(x.name) === k)) return 'dup';
        a.name = nm.slice(0, f('name', 24));
    }
    if ('why' in patch) a.why = String(patch.why ?? '').trim().slice(0, f('why', 60));
    if ('quip' in patch) a.quip = String(patch.quip ?? '').trim().slice(0, f('quip', 80));
    commit();
    return 'ok';
}

/** 清空本聊天的成就（记录类的东西要能删能清 ✓） */
export function clearAchievements() {
    const arr = achievements();
    const n = arr.length;
    if (n) { arr.splice(0, arr.length); commit(); }
    return n;
}

/**
 * 给面板「成就」频道用的数据（纯数据，怎么画由 bodycord.html 决定 ✓）。
 * ⚠️ 成就是**按聊天**的、不按对象分 ⇒ 每条自己带着当时那个对象的名字 ✓
 */
export function achievementsForPanel(key) {
    const s = state();
    const arr = achievements();
    // 当前面板正在看哪个对象（面板自己不知道名字 ⇒ 这里一并给它 ✓）
    //   存还是按聊天，**看**跟当前对象走（跟旁边的受孕记录 / 推演记录一致），面板靠 activeName 过滤 ✓
    const k = String(key || s.active || '');
    let activeName = '';
    try {
        const t = k ? (s.targets || {})[k] : null;
        activeName = t ? (displayName(t) || t.key || '') : '';
    } catch { activeName = ''; }
    return {
        count: arr.length,
        activeName,
        // ⚠️ 给面板的字段叫 `title`（不是 `name`）——
        //   面板 / 预览那两条"不许出现真人名"的断言是按 `name:` 扫的，
        //   成就名字是标题、不是人名 ⇒ 用 title 既准确又不削弱那两条断言 ✓
        list: arr.map((x) => ({
            id: x.id,
            title: x.name || '',
            why: x.why || '',
            quip: x.quip || '',
            target: x.target || '',
            // ★ 2026-10-28：从「仅状态」档案导入进来的成就（`imported`）**不显示日期** ——
            //   它的日期属于旧时间线，换成新时间轴的日子就是假的（旧成就被写成新档日期 ✗）。
            //   新档里正常解锁的成就没有这个标记，照旧显示 ✓
            date: isImportedAchievement(x) ? '' : (x.date || ''),
            floor: x.floor ?? null,
            at: x.at || 0,
        })).reverse(),      // 新的在前 ✓
    };
}

/**
 * 这一胎**到底几个孩子**（胎数判过就用它；没判过 / 没孕 ⇒ 0 ＝ "还不知道"）。
 *
 * ★ 为什么需要它：锁定是在受精成功那一刻按子1~子4 逐个掷的，那时胎数还没判
 *   ⇒ 会留下"单胎却锁了两个子位"这种记录 ✓
 *   ⇒ 胎数一旦知道，**多出来的子位就没意义**，各处显示时只留胎数范围内的那几条 ✓
 */
export function knownFetusCountOf(key) {
    try {
        const plan = fetusPlanOf(key);
        const n = Number(plan?.count);
        if (Number.isFinite(n) && n >= 1) return n;
    } catch { /* 读不到就往下走 */ }
    try {
        const t = state().targets?.[String(key || '')];
        return (parseFetus(t?.profile?.d6 || '').kids || []).length;
    } catch { return 0; }
}

/** 只留"真的存在"的那几个胎位的锁定（胎数还不知道 ⇒ 原样给 ✓） */
function locksWithinFetusCount(key, locks) {
    const n = knownFetusCountOf(key);
    if (!(n >= 1)) return locks || [];
    return (locks || []).filter((x) => (Number(x?.child) || 1) <= n);
}

/** 给面板「受孕记录」频道用的数据（纯数据，界面怎么画由 bodycord.html 决定） */
export function conceptionForPanel(key) {
    // ★ 按对象分账：不给 key 就用"当前查看的对象" ✓
    //   以前这里读的是**全局** ovuJudgment / insems / impregnatorLocks
    //   ⇒ 无论看哪个对象，受孕记录都是同一份全局历史 ✗（"不对劲"的真身 ✓）
    const s = state();
    const want = key || s.active || '';
    const j = getOvuJudgment(want);
    // ★ 未受精没有"致孕方锁定"——
    //   判定失败时这一页不能再摆锁定；手动锁（没有判定）照旧给，别把修改器弄坏 ✓
    // ★ 胎数判出来之后只留胎数范围内的锁（单胎不会摆出两个致孕方 ✓）
    let locks = (j && j.passed === false) ? [] : locksWithinFetusCount(want, getImpregnatorLocks(want));
    // ★ 同一个致孕方只摆一条 —— 单父多胎不需要把「子1·子2·子3·子4」摊成四格
    //   （单父多胎不摊成四个子位 ✓）
    if (locks.length > 1) {
        const uniq = new Set(locks.map((x) => String(x?.impregnator || '').trim()).filter(Boolean));
        if (uniq.size <= 1) locks = [locks.find((x) => (Number(x?.child) || 1) === 1) || locks[0]];
    }
    // ★ 着床完成日到了没有：到了才允许面板显示"着床 / 没着床"
    //   · 无月经档：按 doneDate 这个日期比
    //   · 其他档：按周期日比（排卵日 + 着床天数）
    // ★ 还差几天到着床完成日（到日子了就返回 0）
    const _implantLeft = (() => {
        try {
            if (!j || j.passed !== true || !j.implantDays) return null;
            if (periodModeOf(want) === 'amenorrhea') {
                const dd = String(j.doneDate || '');
                const today = currentDate() || '';
                const left = (dd && today) ? diffDays(today, dd) : null;
                return left === null ? null : Math.max(0, left);
            }
            const ovu = Number(bodyCycleParamsOf(want)?.ovu) || 14;
            const done = ovu + Number(j.implantDays);
            const now = cycleDayNum(want);
            if (now === null || !Number.isFinite(now)) return null;
            return Math.max(0, done - now);
        } catch { return null; }
    })();
    const _implantKnown = (() => {
        try {
            if (!j || j.passed !== true || !j.implantDays) return false;
            if (periodModeOf(want) === 'amenorrhea') {
                const dd = String(j.doneDate || '');
                const today = currentDate() || '';
                const left = (dd && today) ? diffDays(today, dd) : null;
                return left !== null && left <= 0;
            }
            const ovu = Number(bodyCycleParamsOf(want)?.ovu) || 14;
            const done = ovu + Number(j.implantDays);
            const now = cycleDayNum(want);
            return now !== null && Number.isFinite(now) && now >= done;
        } catch { return false; }
    })();
    return {
        judgment: j ? {
            round: j.round, sub: j.sub, rate: j.rate, judgeValue: j.judgeValue,
            roll: j.roll?.value ?? null, rollSource: j.roll?.source || '',
            passed: !!j.passed, implantDays: j.implantDays ?? null,
            // ★★ 着床结果**到着床完成日之前不许显示**（2026-10-20 她报的剧透）——
            //   判定那一轮其实已经掷好了，但写出来等于提前告诉玩家"这胎没着床" ✗
            //   ⇒ 面板只认 implantKnown；到日子之后才把 implantPassed / implantRoll 给出去 ✓
            implantKnown: _implantKnown,
            // 还要几天才到着床日（面板那句"着床还需 N 天"用它，别再拿总天数当剩余天数 ✗）
            implantLeft: _implantKnown ? 0 : _implantLeft,
            implantPassed: _implantKnown && (j.implantPassed === true || j.implantPassed === false) ? j.implantPassed : null,
            implantRoll: _implantKnown ? (j.implantJudge?.value ?? null) : null,
            // 精子存活开着时才有：判了几个批次被排除（面板要说明"为什么少了"）
            lifeNote: j.lifeNote || '',
            // ★★ 判定口径（2026-10-20）：'alive' = 只算存活精子；'' = 老记录（当时只有累计这一档）
            //   这是**判定当时**用的口径（判定记录里存下来的），不是"现在设置里选的哪一档" ——
            //   切换不重算旧判定，所以面板必须照记录上的那一档说 ✓
            basis: (j.basis === 'alive' ? 'alive' : (j.basis === 'cumulative' ? 'cumulative' : '')),
            // ★ 「判定值」旁边那句括号由插件写好（面板不自己算）：两档的意思不一样 ——
            //   · 累计超过 100% ⇒ 已封顶
            //   · 仅存活精子 ⇒ 判定值比累计小，是裁掉了失活批次，不是封顶（写错会读成"被砍了一刀"✗）
            valueNote: (() => {
                const r = Number(j.rate), v = Number(j.judgeValue);
                if (!Number.isFinite(r) || !Number.isFinite(v) || !(r > v)) return '';
                const rr = Math.round(r * 10) / 10;
                return (j.basis === 'alive')
                    ? `（累计 ${rr}%，判定只算存活批次）`
                    : `（累计 ${rr}% 已封顶）`;
            })(),
            // ★ 卡片底下那句说明：两档必须分开写（累计档不许再说"失活的不计入" ✗）
            basisNote: (() => {
                const life = String(j.lifeNote || '');
                const alive = (j.basis === 'alive');
                if (alive) {
                    return (life ? life + ' ' : '') + '判定只算窗口结束那一刻还活着的批次，已失活的不计入判定值。';
                }
                if (j.basis === 'cumulative') {
                    return (life ? life + ' ' : '') + '判定用窗口结束那一刻的累计受孕率；失活批次已计入的贡献仍保留。';
                }
                return life;      // 老记录：只有那句"几批已失活"，不替它编口径
            })(),
        } : null,
        // ★ 同卵 ⇒ 只给子1 那条（这一页也不许出现两个致孕方：同卵不可能异父 ✓）
        locks: (sameOvumOf(want)
            ? locks.filter((x) => (Number(x?.child) || 1) === 1).slice(0, 1)
            : locks
        ).map((x) => ({
            child: x.child, impregnator: x.impregnator, roll: x.roll?.value ?? null,
        })),
        // 内射记录本来每条就带 target ✓ ⇒ 只给这个对象的 ✓
        insems: listInseminations()
            .filter((x) => !want || String(x.target || '') === String(want))
            .map((x) => ({
                target: x.target || '',
                round: x.round, sub: x.sub, by: x.by, roll: x.roll, note: x.note,
                // ★ 当前判定失败 ⇒ 一条「中招」都不该显示（旧标记可能是上一次判定留下的）
                //   只有当前判定成功时才信这些标记 ✓
                conceived: (j && j.passed === true) ? !!x.conceived : false,
                // 精子存活：这一批的贡献 + 能活到第几轮（面板据此标"已失活"）
                contrib: x.contrib ?? null,
                viableUntil: x.viableUntil ?? null,
                // ★ **"现在还活不活"由外壳算好给面板** ——
                //   面板自己拿周期日号跟 `nowDay` 比，跨周期切换后会算错（明明过期了还显示"存活中" ✗）
                //   ⚠️ 老数据（没有绝对天数）⇒ 给 null，面板退回它原来那套比较 ✓
                spermAliveNow: (() => {
                    try {
                        const k = String(x.target || '');
                        const st = spermBatchState(x, cycleDayNum(k), cycleStartAbsOf(k));
                        return st.abs ? st.alive : null;
                    } catch { return null; }
                })(),
            })),
        // ★ 事后避孕药：受孕记录那一页也要看得到它 ——
        //   药只体现在累计受孕率的数字上的话，玩家看不出"那天吃了药" ✗
        pills: listPills(want).map((x) => ({
            target: x.target || '',
            day: (x.day == null || x.day === '') ? null : Number(x.day),
            factor: (x.factor == null) ? null : Number(x.factor),
            round: (x.round == null) ? null : Number(x.round),
            at: x.at || 0,
        })),
        // 当前剧情天数：面板据此判断哪些批次已失活（跟存活期同一个时间轴 ✓）
        nowDay: (() => {
            try {
                // ★ 跟推演那边**同一个读法** —— 周期日就是插件自己算的那个数 ✓
                const d = cycleDayNum(state().active);
                if (d !== null) return d;
            } catch { /* 忽略 */ }
            return (state().snapshots || []).length + 1;   // 两个都读不到才退回轮次（只影响面板的"已失活"标记）
        })(),
        nowRound: (state().snapshots || []).length + 1,
        // 历史归档（换周期 / 分娩时收起来的那几段），面板上可展开查看 ✓
        // ⚠️ 必须**按对象过滤**（同函数里 judgment / locks / insems 早就都过滤了）——
        //   漏了的话"受孕记录按对象分账"这条就被破掉：看甲的对象页里会混进乙的归档 ✗
        //   （顺带把 target 也给面板，将来按人分栏不用再改协议）
        archive: (Array.isArray(state().conceptionArchive) ? state().conceptionArchive : [])
            .filter((x) => !want || String(x.target || '') === String(want))
            .map((x) => ({
                target: x.target || '',
                at: x.at || 0,
                reason: x.reason || '',
                mode: x.mode || '',
                locks: (x.locks || []).map((y) => ({ child: y.child, impregnator: y.impregnator, roll: y.roll?.value ?? null })),
                count: (x.insems || []).length,
                conceived: (x.insems || []).filter((y) => y.conceived).map((y) => y.by),
                // 分娩 / 妊娠终止那一刻收进来的胎儿原文（其余结算为空串 ✓）
                fetus: String(x.fetus || ''),
            })),
        // ★ 账本被保险丝裁掉过多少条（抬到 1000 + 到上限时明说 ✓）
        insemCut: Number(state().insemsCut) || 0,
        insemCap: INSEM_CAP,
        // ★★ 这些提醒也要放在频道里，就放"受孕记录"里 ——
        //   **插件自己发的提醒**（着床完成 / 每胎预产期）住「受孕记录」这一页：它就是这本账的后续 ✓
        //   按对象过滤（跟这份数据其它字段一个口径 ✓）
        //   ⚠️ 必须留在**最后**：有一条断言按 `Object.keys()` **顺序**比"demo 和真实形状一致" ✗
        //      （放在最前面会红 ✓）
        alerts: listAlerts()
            .filter((a) => !want || String(a?.target || '') === String(want))
            .map((a) => ({
                kind: String(a?.kind || ''),
                sub: String(a?.sub || ''),
                name: String(a?.name || ''),
                date: String(a?.date || ''),
                seen: !!a?.seen,
                note: String(a?.note || ''),
            })),
    };
}

// ---------------------------------------------------------------------------
// 「联系人」视图要的数据（只读 ✓）
//
// ★ 形态：频道列表最上面那个 💬，点开显示**当前对象**的
//   联系人（谁跟这个人做过 / 这个人致孕过谁），点某人看和这个人的所有记录。
//   ⇒ 两个视角：「联系人」/「致孕记录」（后者只在主体"能致孕"时给 ✓）
//
// ⚠️ 这里必须**只读** —— 不能用 `findTargetByReportedName()`：那个函数在
//    自动模式下会**顺手建档** ✗（一个"查看"动作不该改用户数据）。所以另写一个
//    只查已有档案的解析器 ✓
// ---------------------------------------------------------------------------

/** 只按"已有的档案"认名字（只读，不会建档 ✓） */
function resolveExistingTargetByName(rawName) {
    const want = String(rawName || '').trim();
    if (!want) return null;
    let list = [];
    try { list = targetList(); } catch { return null; }
    for (const t of list) {
        if (!t) continue;
        if (t.key === want) return t;
        if (displayName(t) === want) return t;
        try {
            const a = identOf(t.key)?.aliases;   // 别名表：这个人"还认哪些叫法"
            if (a) {
                const arr = String(a).split(/[，,、／/|\n]+/).map((x) => x.trim()).filter(Boolean);
                if (arr.includes(want)) return t;
            }
            // ★ 独一无二的标签也算"他还认的叫法" ✓
            const uniq = new Set(uniqueTags());
            const tg = parseAliases(identOf(t.key)?.tags).filter((x) => uniq.has(x.toLowerCase()));
            if (tg.includes(want)) return t;
        } catch { /* 忽略 */ }
    }
    return null;
}

/** 这个对象"自己的名字集合"（档案名 / key / 别名）—— 用来反查"我致孕过谁" */
function namesOfTarget(key) {
    const out = new Set();
    const t = state().targets?.[key] || null;
    if (!t) { if (key) out.add(String(key)); return out; }
    const nm = displayName(t);
    if (nm) out.add(nm);
    if (t.key) out.add(t.key);
    if (t.name) out.add(String(t.name));
    try {
        const a = identOf(t.key)?.aliases;
        if (a) String(a).split(/[，,、／/|\n]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => out.add(x));
        // ★ 独一无二的标签也一起（它本来就当别名用 ✓）
        const uniq = new Set(uniqueTags());
        parseAliases(identOf(t.key)?.tags).filter((x) => uniq.has(x.toLowerCase())).forEach((x) => out.add(x));
    } catch { /* 忽略 */ }
    return out;
}

/**
 * 那个人面板上要显示的种族（拿不到就空串 ⇒ 面板显示「种族未知」✓）
 *
 * ⚠️ 读的是**权威那一份**：你手填的 > 推演报的 > 补丁里的设定。
 *   以前只读"推演报过的那份" ⇒ 你在「角色基础信息 → 这个角色的种族」里填过，
 *   联系人那行照样写「种族未知」（同一个人的种族，两页显示不一样 ✗ ）
 * ⚠️ 只有**出厂那句默认**（谁都没报过、你也没填过）时仍然算"未知" ✓ ——
 *   那时候摆一个「人类」出来，等于替玩家认了一个没确认过的答案 ✗
 */
function raceOfTarget(t) {
    try {
        if (!t?.key) return '';
        const rj = raceJudgeOf(t.key);
        if (rj.src === '默认') return '';
        return String(rj.race || '').trim();
    } catch { return ''; }
}

/** 一条内射记录里面板要看的那几格（含精子数据 ✓） */
/**
 * ★ 一条记录的「剧情时间」排序键（按正常顺序记）。
 *
 * 两种记录各有各的时间写法：
 *   · 内射账本 → `date`（剧情日期）＋ `clk`（钟点）
 *   · 近期性行为补的那几条 → 只有一段 `sub` 文本（"2020年9月3日 20:17"）
 * ⇒ 统一折成「绝对天 × 10000 ＋ 当天分钟数」，判不出来 ⇒ 0（排最前，不乱插队 ✓）
 */
function whenSortKey(rec) {
    try {
        const clkOf = (s) => {
            const m = String(s || '').match(/(\d{1,2})[:：](\d{2})/);
            return m ? (Number(m[1]) * 60 + Number(m[2])) : 0;
        };
        const mins = clkOf(rec.clk) || clkOf(rec.sub);
        let day = absDayOfDateStr(rec.date || '');
        if (day == null) day = absDayOfDateStr(String(rec.sub || ''));
        if (day == null) return 0;
        return day * 10000 + mins;
    } catch { return 0; }
}

function contactRecord(x) {
    const spermText = spermSurvivalTextOf(x);
    return {
        round: x.round,
        sub: x.sub || '',
        // ★ 2026-10-26（她说的是"导入之后"）：**正常游玩**的记录照旧显示日期 + 钟点；
        //   只有从别的档**导入进来**的那些（`imported`）才改成「第 N 轮 · 第 D 天」——
        //   它们的时间属于另一条时间轴，搬过来就是改时间线 ✗
        date: x.imported === true
            ? (x.cycleNo != null
                ? `第 ${x.cycleNo} 周期 · 第 ${x.depositDay ?? '—'} 天`
                : `第 ${x.round ?? '—'} 轮 · 第 ${x.depositDay ?? '—'} 天`)
            : (x.depotDate || ''),
        clk: x.imported === true ? '' : (x.clk || ''),
        note: x.note || '',
        roll: x.roll || '',
        conceived: x.conceived === true,
        contrib: x.contrib == null ? null : x.contrib,
        depositDay: x.depositDay == null ? null : x.depositDay,
        viableUntil: x.viableUntil == null ? null : x.viableUntil,
        // ★★ 存活情况由插件算好，面板直接显示（别让面板拿周期日号自己比 ✗）——
        //   已失活 ⇒ 「已失活」；其余 ⇒ 「存活到 <日期>」；
        //   算不出日期的老记录才退回「存活到第 N 天」✓
        spermText,
        // ★ 给「隐藏已失活」筛选用：已失活 = true（面板不用再读文字判断 ✓）
        spermDead: spermText === '已失活',
        at: x.at || 0,
    };
}

/**
 * ★ 喂给推演的「精液量」状态（两本账各一档）—— 源头修法。
 *
 * 为什么要有它：A2 那句「体内精液」只在子宫「满 / 多 / 中」时发，残留时整栏不发
 *   ⇒ 模型只能顺着上一轮 row1 续写「沉胀感」✗
 *   ⇒ 现在**每一轮都把两本账的档位明确告诉它**，残留直接标「基本无感」，
 *     让它不用猜、也不用在输出层删句子 ✓
 *
 * 形态：`阴道：空｜子宫：残留（清洗后的余量，基本无感）`
 */
export function spermLoadTiersForPrompt(key) {
    try {
        const label = (t) => {
            const k = String(t || 'empty');
            if (k === 'residue') return '残留（清洗后的余量，基本无感）';
            return SPERM_TIER_LABEL[k] || '空';
        };
        return `阴道：${label(vaginaLoadTierOf(key))}｜子宫：${label(wombLoadTierOf(key))}`;
    } catch { return ''; }
}

/**
 * ★ 体内体征（激素 / 体温）—— **只在阶段或孕期转折的那一轮才给**（2026-10-22 她定的）。
 *
 * 为什么要它：`row1 生理状态怎么写` 那张卡里写着"另含腺体、体温、激素"，
 *   但输入里从来没给过这三样 ⇒ 模型只能写手上有的（精子 / 受精卵），
 *   那一格就越写越瘦（她截图看出来的）。
 *
 * 口径（她选的「有变化才给」）：
 *   · 把周期阶段压成几档：经期 / 卵泡 / 黄体（排卵前后与过渡并入黄体前后，不再细分，
 *     否则一天一个"变化"就变成每轮都发）；
 *   · 跟上一轮记下的那一档比，**没变就整栏不发**（发空串 ⇒ 那一栏不出现）；
 *   · 变了才给一句「激素：偏高｜体温：偏高」——只说高低，不给阶段名（契约也不许写阶段名）。
 *   · 没周期（无月经档）⇒ 一律不发（这一档本来就不谈周期词）。
 * ⚠️ 腺体分泌这一项**暂时不给**：插件没有爱液 / 分泌量的账本，硬编一句就是瞎写。
 * @returns {string} 空串 = 这一轮没有转折 / 不该发
 */
export function vitalsForPrompt(key) {
    try {
        const k = String(key || '');
        const t = state().targets?.[k];
        if (!t) return '';
        const preg = Number(pregDaysOf(k)) > 0;
        let phase = '';
        try {
            if (periodModeOf(k) === 'normal') {
                const d = cycleDayNum(k);
                if (d) {
                    const { ovu } = bodyCycleParamsOf(k);
                    phase = cycleDayInfoOf(d, ovu, periodDaysOf(k)).phaseId || '';
                }
            }
        } catch { /* 忽略 */ }
        const bucket = preg ? 'pregnant'
            : (phase === 'menstrual' ? 'menstrual'
                : (phase === 'luteal' || phase === 'transition' ? 'luteal'
                    : (phase ? 'follicular' : '')));
        if (!bucket) return '';                       // 没周期 / 读不到 ⇒ 不发
        if (String(t.vitalsSig || '') === bucket) return '';   // 没转折 ⇒ 不发
        t.vitalsSig = bucket;                         // 记下来：下次只有真转折才会再发
        const high = (bucket === 'pregnant' || bucket === 'luteal');
        return `激素：${high ? '偏高' : '偏低'}｜体温：${high ? '偏高' : '偏低'}`;
    } catch { return ''; }
}

/**
 * ★ 一条内射记录该显示的「存活」文字（给联系人 / 后续只读面板用 ✓）。
 *
 * 为什么不在面板里算：面板只拿得到账本里那几个数，跨周期时周期日号会被拨回
 *   第 1 天 ⇒ 拿 `viableUntil` 直接比会读歪（明明活到下一周期第 4 天，
 *   面板写成「第 32 天」✗）⇒ 判活与换算都走插件这边 ✓
 *
 * @returns {string} 空串 = 没设存活期 / 不需要显示；已失活 ⇒ 「已失活」
 */
export function spermSurvivalTextOf(x) {
    try {
        if (!x || x.contrib == null) return '';
        const key = String(x.target || '');
        const nowDay = cycleDayNum(key);
        const startAbs = cycleStartAbsOf(key);
        const st = spermBatchState(x, nowDay, startAbs);
        // 没设存活期的批次 ⇒ 不挂「存活到」（面板原来也不显示 ✓）
        if (st.untilDay === null && (st.untilAbs == null || !Number.isFinite(Number(st.untilAbs)))) return '';
        if (!st.alive) return '已失活';
        // ★★ 2026-10-29（她判「存活到第 103 天很明显是 BUG，锚点是什么」）：
        //   存活期一律写**日期**（入账那天 ＋ 存活天数）。
        //   原来这里写「存活到第 N 天」，那个 N 是**周期日号**——平时它落在 1~周期长度内
        //   读着正常；可孕期周期不重置、日号一路涨（孕周就是拿它除出来的）⇒
        //   孕期那几笔会冒出远超一个周期的数，而且同一个说法在平时/孕期指的是两种起点 ✗
        //   ⇒ 用日期当锚点：不管在哪种状态下都不会读歪 ✓
        //   算不出日期（很老的记录：没有落账日期、也没有绝对天数）才退回天数 ✓
        const untilDate = (() => {
            try {
                // ⚠️ `Number(null)` 是 0、`Number('')` 也是 0 ⇒ 会把"没有绝对天数"当成
                //   "历法第 0 天"、印出一个 1年01月01日 ✗（空值必须先挑出来）
                const rawAbs = x?.viableUntilAbs;
                const abs = (rawAbs == null || rawAbs === '') ? NaN : Number(rawAbs);
                if (Number.isFinite(abs)) return addDays(FICTION_DATE_START, abs) || '';
                const dep = absDayOfDateStr(x?.depotDate);
                const rawRoll = x?.lifeRoll;
                const roll = (rawRoll == null || rawRoll === '') ? NaN : Number(rawRoll);
                if (dep !== null && Number.isFinite(roll)) return addDays(FICTION_DATE_START, dep + roll) || '';
            } catch { /* 落回天数 */ }
            return '';
        })();
        if (untilDate) return `存活到 ${untilDate}`;
        return st.untilDay !== null ? `存活到第 ${st.untilDay} 天` : '';
    } catch { return ''; }
}

/**
 * ★ 「联系人」一次给面板带几条（继续加载）——
 *   点详情页底部那颗「还有 N 条更早的」再加一页 ✓
 *   为什么不一口气全给：这份数据每轮都要**跨 iframe** 推一次，随记录无限涨的话
 *   会拖慢整个面板（项目里量过：payload 才是真凶 ✓）
 */
export const CONTACT_PAGE = 10;

/**
 * 「联系人」视图的数据（只读 ✓）
 * @param {string} key 追踪对象的 key；不给就用当前查看的那个
 * @param {Object|null} more 「这个人已经展开过几页」的记账（键 `页签|名字`，外壳记着 ✓）；
 *   不传 = 每人只给第一页 ✓
 */
/**
 * ★ 从某个人那一格的 `row3`（近期性行为）里抽出"和谁做过"。
 *
 * 为什么要有它：联系人页原来只认**内射账本** ⇒ "插入但没内射"的那些人一个都不出现，
 *   页面上还写着「还没有和谁做过」，跟剧情矛盾 ✗（明明已经做过了，却说没有做过）
 * ⚠️ 出厂的 row3 格式是「时间戳 & 人物 & 事件」（最多 3 条、时间倒序、多条按行/；分 ✓）——
 *   **只认这个格式**；老格式或玩家自己改过的写法（例如：与某人发生…）一律**跳过**，
 *   绝不从自由文本里瞎猜人名 ✗（认不出就当这轮没这条事实 ✓）
 */
function row3SexPartners(me) {
    const out = [];
    try {
        // ★ 2026-10-23：优先读**底层清单**（最多 200 条），不再只读渲染出来的最近几行 ——
        //   不然口交这类会被后面几次挤出去，联系人里就"没有记录" ✗
        //   老数据没有清单 ⇒ 回落到那一格的文字（照旧只认出厂三段格式）✓
        const key = String(me?.key || '');
        const bag = key ? sexBag(key) : [];
        const src = bag.length
            ? bag.map((x) => ({ time: x.time, by: x.by, ev: x.event }))
            : parseSexLines(me?.profile?.row3).map((x) => ({ time: x.time, by: x.by, ev: x.event }));
        const seen = new Set();
        for (const one of src) {
            const who = String(one.by || '').trim();
            if (!who || who.length > 20) continue;
            if (/^(无|—|-|你|我|\{\{user\}\}|user)$/i.test(who)) continue;
            const ev = String(one.ev || '').trim();
            const sig = `${one.time}|${who}|${ev}`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            out.push({ time: one.time, by: who, ev });
        }
    } catch { /* 忽略 */ }
    return out;
}

/** 「日期 + 钟点」归一成一个认领键（去掉空白、全角冒号统一成半角） */
function timeKeyOf(date, clk) {
    let d = String(date || '').replace(/\s+/g, '');
    // ★ 2026-11-01：日期串可能带纪元名前缀，认领要跟从正文里抽出来的那种（不带前缀）对上 ✓
    try {
        const era = String(activeCalendar().style.era || '').trim();
        if (era && d.startsWith(era)) d = d.slice(era.length);
    } catch { /* 忽略 */ }
    const t = String(clk || '').replace(/\s+/g, '').replace(/：/g, ':');
    return (d || t) ? (d + '|' + t) : '';
}
/** 从「2020年09月15日 08:02」这种一段文字里抽出同一个键 */
function timeKeyOfText(s) {
    const txt = String(s || '');
    const dm = txt.match(/(\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
    const tm = txt.match(/(\d{1,2}[:：]\d{2})/);
    return timeKeyOf(dm ? dm[1] : '', tm ? tm[1] : '');
}

export function contactsForPanel(key, more = null) {
    const s = state();
    const want = key || s.active || '';
    const me = (s.targets && s.targets[want]) || null;
    const isUser = !!me?.isUser || want === USER_KEY;
    // ★★ 名字槽位一律给**当前人设名**，绝不给宏 ✗
    //   这里要显示**当前用户角色的名字**，
    //   不是某个写死的名字 ✓
    //   ⇒ 根因：本人那一档的档案名存的就是字面的 `{{user}}`（推演侧要用它当身份锚 ✓），
    //     而这里直接拿 `displayName()` ⇒ 把宏印到界面上了 ✗
    //   ⇒ 走 `userLabel()`（人设名；拿不到才退回「你自己」✓）
    const subjectName = isUser
        ? userLabel()
        : (me ? (displayName(me) || me.key || want) : String(want || ''));

    // 能不能致孕：只读玩家锁定的那一格（未填 = 能 ✓，跟别处同一套判据）
    let canImpregnate = true;
    try {
        const lock = bodyLockOf(want);
        if (lock && lock.canImpregnate === false) canImpregnate = false;
    } catch { /* 忽略 */ }

    // ★ 「能不能怀孕」也推给面板 —— 页头那行状态字要按**两格**判 ✓
    //   起因：只能致孕不能怀孕的 {{user}}，联系人界面现有的设计能不能覆盖？
    //   ⇒ 结构上够用，只是那行字**只读"能不能致孕"** ⇒ 对这种本人会写成「可受孕也可致孕」✗
    //   ⚠️ 这一格**只管那行字**：页签藏不藏还是只看 canImpregnate（跟两个视角有关的是它 ✓）
    let canBePregnant = true;
    try {
        const lock = bodyLockOf(want);
        if (lock && lock.canBePregnant === false) canBePregnant = false;
    } catch { /* 忽略 */ }

    const all = listInseminations();

    // ---- 视角一：谁跟我做过 ----
    const mine = new Map();
    // 明明有内射记录，还写只做过——
    //   这份账里出现过的人记下来，下面补 row3 那几条时**跳过他们** ✓
    const fromInsem = new Set();
    // ★ 2026-10-23：同一件事在受孕账 + 性行为清单里各有一条 ⇒ 联系人会并排显示两条。
    //   这里按「日期 + 钟点 + 人物」认领：账本里已经有的那一笔，性行为清单里同时间的就跳过 ✓
    const insemAt = new Map();
    for (const x of all) {
        if (String(x.target || '') !== String(want)) continue;
        const by = String(x.by || '').trim() || '未标注';
        fromInsem.add(by);
        const k0 = timeKeyOf(x.depotDate, x.clk);
        if (k0) {
            if (!insemAt.has(by)) insemAt.set(by, new Set());
            insemAt.get(by).add(k0);
        }
        if (!mine.has(by)) {
            const t = resolveExistingTargetByName(by);
            mine.set(by, { key: t?.key || '', name: by, race: raceOfTarget(t), times: 0, items: [] });
        }
        const g = mine.get(by);
        g.times += 1;
        g.items.push(contactRecord(x));
    }
    // ★★ 2026-10-16（明明做过了却说没做过 ⇒ 选甲）——
    //   把**性行为事实**（本人那格的 row3）也接进来：只做过、还没内射的人也会出现在这一栏 ✓
    //   ★ 2026-10-30：补条目不再加任何前缀（原来那句「只做过（还没有内射记录）」已删，
    //     见下面那段注释）—— 这一条**不动账本**，只是显示 ✓
    for (const r of row3SexPartners(me)) {
        // **这些本来就是性行为记录，哪怕没射过也要留着** ✗ 不能因为
        //   "这个人已经有内射记录"就把它们丢掉（面板本来就是记做爱相关的）
        // ★ 2026-10-30 ——
        //   「只做过（还没有内射记录）」这半句**整个删掉**：联系人本来就是记性行为的，
        //   拿"有没有内射记录"当标准，等于说没内射就不算做过 ✗
        //   ⇒ 现在一律只写事件本身，两种人一样对待 ✓
        const hadInsem = fromInsem.has(r.by);
        // ★ 账本里已经有同一时间的那一笔 ⇒ 这条只是同一件事的重复记录，跳过 ✓
        const k1 = timeKeyOfText(r.time);
        if (hadInsem && k1 && insemAt.get(r.by)?.has(k1)) continue;
        if (!mine.has(r.by)) {
            const t = resolveExistingTargetByName(r.by);
            mine.set(r.by, { key: t?.key || '', name: r.by, race: raceOfTarget(t), times: 0, items: [] });
        }
        const gm = mine.get(r.by);
        gm.times += 1;
        gm.items.push({
            round: null, sub: r.time,
            note: r.ev,
            roll: '', conceived: false,
            contrib: null, depositDay: null, viableUntil: null, at: 0,
        });
    }

    // ---- 视角二：我致孕过谁 ----
    const myNames = namesOfTarget(want);
    const theirs = new Map();
    for (const x of all) {
        if (!myNames.size || !myNames.has(String(x.by || '').trim())) continue;
        const who = String(x.target || '').trim();
        if (!who || who === want) continue;
        if (!theirs.has(who)) {
            const t = (s.targets && s.targets[who]) || resolveExistingTargetByName(who);
            theirs.set(who, {
                key: t?.key || who,
                name: t ? (displayName(t) || t.key || who) : who,
                race: raceOfTarget(t), times: 0, items: [],
            });
        }
        const g = theirs.get(who);
        g.times += 1;
        g.items.push(contactRecord(x));
    }

    const finish = (m, tab) => [...m.values()]
        .map((g) => {
            // 射精在前液的后面，为什么显示在前面？不能按正常顺序记吗——
            //   记录里两半是**分开拼**的（内射账本 + 近期性行为补的那几条），原来各按各的顺序 ⇒
            //   混在一起看就是乱的 ✗ ⇒ 统一按**剧情时间**排：旧的在前、新的在后 ✓
            //   （判不出时间 ⇒ 键 0，排最前，至少不打断已知的先后）
            const sorted = g.items.slice().sort((a, b) => whenSortKey(a) - whenSortKey(b));
            // ★ 全部给出去，**显示多少由面板自己控制**（默认 20；展开/收起都在面板里完成，
            //   不再让外壳按页重推 —— 上一次「收起」就是死在这条来回推数据的路上 ✗）
            return { ...g, items: sorted };
        })
        .sort((a, b) => {
            const la = a.items[a.items.length - 1]?.at || 0;
            const lb = b.items[b.items.length - 1]?.at || 0;
            return lb - la;   // 最近有来往的排前面 ✓
        });

    // ---- ★★ 已建档、但还没有记录的人（B 方案 ✓）----
    //   起因："这个按钮好像完全没用" ✗ —— 那个按钮只建档、不产记录，
    //   而这个列表是**按内射流水生成**的 ⇒ 刚加的人根本不出现、看着像什么都没发生 ✗
    //   ⇒ 补这一档：把名单里"还没有任何记录"的人单独列出来，让玩家**点完立刻看得见**，
    //     并且明说"还没有记录"（也要说明一下为什么没记录 ✓）
    //
    //   判据：
    //     · 只列**本聊天的追踪名单/建档对象**（= 玩家自己加得进来的那批 ✓）
    //     · 已经在 contacts / impregnations 里的**不重复列**（有记录的人走原来那两档 ✓）
    //     · 不列本人、不列当前正在看的这个人 ✓
    //   `side` 决定它出现在哪个页签：'contacts'（可能跟我做的人）/ 'both'（两种视角都可能）✓
    let pending = [];
    try {
        const listedNames = new Set([...mine.keys(), ...theirs.keys()]);
        //   ⚠️ 用 `targetList()`（本聊天全部已建档对象）而不是 `trackingRoster()` ——
        //     后者在「仅追踪本人」模式下会把人滤掉，那正好是玩家点按钮加人时的情况 ✗
        const list = targetList() || [];
        for (const t of list) {
            if (!t) continue;
            if (t.isUser) continue;                       // 本人不进这份名单 ✓
            if (t.key === want) continue;                 // 正在看的这个人也不进 ✓
            const nm = displayName(t) || t.key || '';
            if (!nm || nm === subjectName) continue;
            if (listedNames.has(nm) || listedNames.has(t.key) || listedNames.has(t.name)) continue;
            pending.push({ key: t.key, name: nm, race: raceOfTarget(t), times: 0, items: [] });
        }
    } catch { pending = []; }

    return {
        subjectKey: want,
        subjectName,
        isUser,
        canImpregnate,
        canBePregnant,
        // ★ 面板「还有 N 条 / 收起」要知道每页多大（别在面板里另写一个 20 ✗）
        pageSize: CONTACT_PAGE,
        // ★ 联系人详情「隐藏已失活」开关（默认关；面板照着摆 ✓）
        hideDead: contactsHideDead(),
        contacts: finish(mine, 'contacts'),
        impregnations: finish(theirs, 'impregnations'),
        // ★ 账本被保险丝裁掉过多少条（0 = 一次都没裁过 ✓ 面板据此明说一句）
        insemCut: Number(s.insemsCut) || 0,
        insemCap: INSEM_CAP,
        // 面板自己按页签挑：'contacts' 那半边全要；'impregnations' 只要可能跟我做的人
        // （不能致孕的人出现在「我致孕过谁」里没意义 ✗）✓
        pending: pending.filter((x) => {
            if (!canImpregnate) return true;          // 只看本人 ⇒ 两种视角都可能 ✓
            try {
                const lk = bodyLockOf(x.key);
                return !(lk && lk.canImpregnate === false);
            } catch { return true; }
        }),
    };
}

// ---------------------------------------------------------------------------
// 「推演记录」要的两样数据（都是纯插件算的，不吃 token）
// ---------------------------------------------------------------------------

/** 把面板文字拆成 { 标签: 值 } —— 面板每行都是「标签：值」或「标签 | 值」 */
function parsePanelLines(text) {
    const out = {};
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // 形如 数据项二：累计受孕率 | 37.5%   →  标签取冒号前，值取竖线后
        const m = line.match(/^([^：:|]{1,24})\s*[：:]\s*(.*)$/);
        if (!m) continue;
        const label = m[1].trim();
        let value = m[2].trim();
        const bar = value.lastIndexOf('|');
        if (bar >= 0) value = value.slice(bar + 1).trim();
        out[label] = value;
    }
    return out;
}

/**
 * A：状态变化对比 —— 拿两层快照逐字段比，返回变了的那些。
 *
 * ★ 时光机里能不能查更久之前的历史推演记录？
 *   （只是临时看看，退出去之后就回到现在的数据 ✓）
 *   ⇒ 加了个可选参数：**比哪一层**由调用方说了算（不给 = 还是比最近两层 ✓，老调用点一行不用改）。
 *
 * @param {number} [upToIndex] 要对比"这一层 vs 它上一层"（快照数组里的下标）；不给 = 最后一层
 * @param {string} [forKey] 看哪个对象（不给 = 当前 active ✓）
 * @returns {{from:number|null, to:number|null, changes:Array<{label,from,to}>}}
 */
export function diffForPanel(upToIndex, forKey) {
    const s = state();
    const snaps = (s.snapshots || []).filter((x) => x && x.raw);
    if (snaps.length < 2) return { from: null, to: null, changes: [] };

    const activeKey = forKey || s.active;
    // ★ 别写成 `|| Object.values(raw)[0]` ——
    //   指定的对象**这一层没有文字**时（刚建档 / 还没推演 / 那一轮没轮到它），
    //   那样会回落到**第一个对象**的文字 ⇒「这一楼变了什么」拿甲的文字比乙，
    //   标题和数字全是别人的，还静默不报错 ✗
    //   ⇒ 只有在"调用方压根没指定看谁（`s.active` 也空）、而且这份 raw 里**只有一个**对象"时
    //     才用那唯一的一份（那是面板在"还没有当前对象"时的老行为保底 ✓），
    //     其余情况：没有就是没有，交给调用方（时光机那边据此不显示这一段 ✓）
    const pick = (snap) => {
        const raw = snap.raw || {};
        const direct = raw[activeKey];
        if (typeof direct === 'string' && direct.trim()) return direct;
        if (!activeKey) {
            const keys = Object.keys(raw);
            if (keys.length === 1 && typeof raw[keys[0]] === 'string') return raw[keys[0]];
        }
        return '';
    };
    const toIdx = (typeof upToIndex === 'number' && upToIndex >= 1 && upToIndex < snaps.length)
        ? upToIndex : snaps.length - 1;
    const a = snaps[toIdx - 1];
    const b = snaps[toIdx];
    const A = parsePanelLines(pick(a));
    const B = parsePanelLines(pick(b));

    const changes = [];
    const labels = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const label of labels) {
        const from = A[label];
        const to = B[label];
        if (from === to) continue;
        // 过滤掉纯占位（未加载 / — / 空）
        if (!to && (!from || /^(未加载|—|-|无)$/.test(from))) continue;
        changes.push({ label, from: from || '（无）', to: to || '（无）' });
    }
    return {
        from: a.messageIndex ?? null,
        to: b.messageIndex ?? null,
        changes: changes.slice(0, 20),
    };
}

/**
 * B：最近一次推演的明细 —— 现在能给的：时间、楼层、剧情时间、取用了哪些骰子。
 * （「AI 报了什么」还需要另外记录，之后再补。）
 */
/** 记下这次判官报了什么（精简版：note + judgment + traces），**按对象存** ✓ */
export function setLastJudgeReport(rep, key) {
    const s = state();
    const k = String(key || s.active || '').trim();
    if (!k) return null;
    if (!s.lastJudgeReports || typeof s.lastJudgeReports !== 'object') s.lastJudgeReports = {};
    s.lastJudgeReports[k] = rep ? { ...rep, at: Date.now() } : null;
    if (!rep) delete s.lastJudgeReports[k];
    commit();
    return s.lastJudgeReports[k] || null;
}

/**
 * ★ 把"模型这一趟回的原文"留一份（2026-10-15 补的口子）。
 *
 * 为什么要有：玩家报：输出 7,679 / 命中 0%时，我让玩家去：推演日志看原文 ——
 *   可那儿只存了用量数字，**原文一个字都没存** ✗ ⇒ 谁也看不到，只能瞎猜。
 * 规矩：**只留最近一次**（不是历史列表，别把 chat_metadata 撑大）；
 *   超过上限就截断并标 `truncated`（记长度，好知道原来多长 ✓）。
 */
const JUDGE_RAW_CAP = 120000;

export function setLastJudgeRaw(text, extra = {}) {
    const s = state();
    const t = String(text ?? '');
    if (!t) { s.lastJudgeRaw = null; return null; }
    s.lastJudgeRaw = {
        at: Date.now(),
        chars: t.length,
        truncated: t.length > JUDGE_RAW_CAP,
        text: t.length > JUDGE_RAW_CAP ? t.slice(0, JUDGE_RAW_CAP) : t,
        ok: extra.ok !== false,
    };
    return s.lastJudgeRaw;
}


export function lastJudgeForPanel() {
    const s = state();
    const snaps = (s.snapshots || []).filter((x) => x && x.raw);
    if (!snaps.length) return null;
    // ★ 按"当前看的那个对象"取：找最近一份**包含它的**快照 ✓
    const key = s.active;
    let last = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
        if (key && snaps[i].raw && snaps[i].raw[key] != null) { last = snaps[i]; break; }
    }
    if (!last) last = snaps[snaps.length - 1];
    let used = [];
    try {
        const u = s.rolls?.lastUsed;
        if (Array.isArray(u)) used = u.map((x) => ({ for: x.for || '', ref: x.ref || '', value: x.value }));
    } catch { /* 忽略 */ }
    // 「AI 报了什么」：判官每次的 note / judgment / traces（精简版，不是整份 JSON）
    // ★ 也按对象取（键 = 对象 key）；名字/进度描述优先用它，避免"报告是别人的、楼层是别人的" ✗
    const rep = (key && s.lastJudgeReports) ? (s.lastJudgeReports[key] || null) : null;
    return {
        messageIndex: last.messageIndex ?? null,
        ts: last.ts || 0,
        // ★ 2026-10-26：这一格是**剧情时间**（日期），不是对象那格「进度（孕周）」——
        //   老快照没有 date ⇒ 只有 sub 长得像日期时才退回它，否则空着
        sub: (() => {
            const d = String(last.date || '').trim();
            if (d) return d;
            const r = String(rep?.sub || '').trim();
            if (/年/.test(r)) return r;
            return '';
        })(),
        name: rep?.name || last.name || '',
        used,
        report: rep,
        // ★ 系统最终判定（插件在模型回包之后才算出来的）——
        //   模型的 cot 写在判定前，可能还写着上一轮的旧结果；
        //   这一行放在 cot 上面，两边就不会看着互相打架 ✓
        final: (() => { try { return judgmentForPrompt(key) || ''; } catch { return ''; } })(),
    };
}

// ---------------------------------------------------------------------------
// ★★ 面板自带的那几样「玩家自己写的东西」：从浏览器存储搬进插件数据
//
// 起因：别处有反馈说刷新或关掉重开之后数据就没了、
//   还得重新设置 ⇒ 查了一遍，唯一一处就是这里 ——
//   面板本体原本是一张**纯前端的角色卡**，它只会写浏览器的本地存储；
//   包成酒馆扩展之后，随手记 / 敏感带备注 / 占卜台历史**还是写在浏览器里** ✗
//   ⇒ 刷新和重开撑得住，但**清浏览器数据 / 换浏览器 / 换设备 / 换域名
//     （localhost 与 127.0.0.1 是两个域）**就全没了，而且找不回来 ✗
//
// 搬去哪（跟插件里其它数据一个口径 ✓）：
//   · 随手记「本聊天」那份 / 敏感带备注 / 占卜台历史 ⇒ 这里（聊天数据，跟着聊天文件走）
//   · 随手记「全局」那份 ⇒ 全局设置（穿过所有聊天，跟 userBodyLock 一个待遇 ✓）
//
// ⚠️ 面板那边**一行都不用改** —— 它照旧读自己那几个键（`bc_notes_*` / `bc_zone_note_*`
//   / `bc_div_history`）；外壳负责两件事：①打开面板前把插件数据灌进浏览器缓存
//   ②面板写缓存的时候顺手把内容落盘（桥在 src/bodycord.js 里 ✓）
// ---------------------------------------------------------------------------

/** 随手记「本聊天」那份（面板给的 JSON 字符串，原样存 ✓；空串 = 这个聊天还没写过） */
export function chatNotes() {
    const v = state().notes;
    return typeof v === 'string' ? v : '';
}

/** 写「本聊天」那份随手记（value 是面板那份 JSON 字符串，原样存 ✓） */
export function setChatNotes(text) {
    const s = state();
    const v = String(text == null ? '' : text);
    if (s.notes === v) return true;
    s.notes = v;
    commit();
    return true;
}

/** 敏感带备注（部位名 → 备注文字；一张表，按聊天存 ✓） */
export function zoneNotes() {
    const z = state().zoneNotes;
    return (z && typeof z === 'object' && !Array.isArray(z)) ? z : {};
}

/** 写某个部位的备注（空串 = 删掉这一条 ✓） */
export function setZoneNote(name, text) {
    const k = String(name || '').trim();
    if (!k) return false;
    const s = state();
    if (!s.zoneNotes || typeof s.zoneNotes !== 'object' || Array.isArray(s.zoneNotes)) s.zoneNotes = {};
    const v = String(text == null ? '' : text);
    if (v) {
        if (s.zoneNotes[k] === v) return true;
        s.zoneNotes[k] = v;
    } else {
        if (!(k in s.zoneNotes)) return true;
        delete s.zoneNotes[k];
    }
    commit();
    return true;
}

/** 占卜台算过的历史记录（数组，最新在前 ✓） */
export function divHistory() {
    const a = state().divHistory;
    return Array.isArray(a) ? a : [];
}

/**
 * 写占卜台历史（外壳收到的是面板那份 JSON 字符串 ✓）。
 * 上限 30 条：面板自己只留 5 条，这里留宽一点、只防"哪天面板改了口径"把聊天数据撑爆 ✓
 */
export function setDivHistoryJSON(text) {
    let list;
    try {
        list = JSON.parse(String(text == null ? '' : text));
    } catch { return false; }
    if (!Array.isArray(list)) return false;
    if (list.length > 30) list = list.slice(0, 30);
    const s = state();
    const before = JSON.stringify(s.divHistory || []);
    if (before === JSON.stringify(list)) return true;
    s.divHistory = list;
    commit();
    return true;
}

/** 有没有聊天数据区（没有 ⇒ 只有「全局那份随手记」落得了盘，别假装成功 ✗） */
export function hasChatMeta() {
    try { return !!getChatMetadata(); } catch { return false; }
}

/**
 * 诊断报告用：只报**计数与字数**，绝不报内容 ✓
 *   （隐私线：内容一律不输出，只给结构信息）
 */
export function panelDataSummary() {
    try {
        // 全局那份随手记在全局设置里（读出来只为数字数，不上报内容 ✓）
        let globalChars = 0;
        try { globalChars = String(settings().globalNotes || '').length; } catch { /* 忽略 */ }
        return {
            notesChars: chatNotes().length,
            notesGlobalChars: globalChars,
            zoneNotes: Object.keys(zoneNotes()).length,
            divHistory: divHistory().length,
            hasChat: hasChatMeta(),
        };
    } catch {
        return { notesChars: 0, notesGlobalChars: 0, zoneNotes: 0, divHistory: 0, hasChat: false };
    }
}
