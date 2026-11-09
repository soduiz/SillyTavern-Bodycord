
import { phaseNameOf, periodDaysOf, bodyCycleParamsOf, isNoCycleMode, cycleDayInfoOf, amenorrheaRateOf, windowRateOf } from './settings.js';

// ★ 2026-11-07：**滞育**（熊那种：受精卵悬浮几个月、等冬眠了才着床）。
//   判据只有一条：着床天数长到 60 天以上，就不可能是"普通的着床等待"，
//   而是胚胎压根还没开始发育 ⇒ ① 孕期那几档按**着床日**起算 ② 这几个月不算周期在走。
//   ⚠️ 60 是分界线不是"上限"：真正的族（熊 130-170 天）远在这之上，
//     而现有的长着床族（象 35-50 天）仍按原来的算法走，一个字不变 ✓
export const DIAPAUSE_IMPLANT_DAYS = 60;

/**
 * 孕期早晚的切法（2026-11-07 改成按**总孕期**比例切）。
 *
 * 为什么改：原来写死「12 周 / 27 周」，那是人类 40 周的口径 ——
 *   鼠 20 天、兔 31 天、熊（实际发育）60 天这些族，整个孕期都会显示「孕早期」✗。
 *   比例取 30% / 70%：人类 280 天 × 30% = 84 天 = 孕 12 周、× 70% = 196 天 = 孕 28 周，
 *   跟医学口径**正好对上**（人类的说法一个字没变 ✓）；短孕期的族也跟着按自己的长度切 ✓
 * ⚠️ 总孕期读不到（还没定预产期）⇒ 退回老口径 12 / 27 周，不假造总长度 ✓
 */
export function pregPhaseOf(days, totalDays) {
    const d = Math.max(0, Math.round(Number(days) || 0));
    const t = Math.round(Number(totalDays) || 0);
    let phaseId;
    if (t >= 14) {
        const r = d / t;
        phaseId = r <= 0.3 ? 'pregEarly' : (r < 0.7 ? 'pregMid' : 'pregLate');
    } else {
        const w = Math.floor(d / 7);
        phaseId = w <= 12 ? 'pregEarly' : (w <= 27 ? 'pregMid' : 'pregLate');
    }
    return { phaseId, phase: { pregEarly: '孕早期', pregMid: '孕中期', pregLate: '孕晚期' }[phaseId] };
}
/**
 * derive.js —— 由插件推导「本该插件算」的字段
 *
 * 问题：有没有那种本该完全由插件托管、却让 AI 去管了的东西
 *
 * 答案就是这三个：**phase（阶段名）/ sub（进度）/ d1（阶段基础率）**。
 * 它们不是「AI 算不准」，而是 **AI 算了也是白算** —— 规则完全确定，
 * AI 只是把「DayX + 排卵日 + 周期长」读一遍再查个表。
 *
 * 真正的危险在于**三个字段各自算各自的，谁也不知道谁错了**：
 *     phase: 黄体期        ← AI 从剧情判断
 *     sub:   Day10 / 28    ← AI 从别处推的
 *     d1:    15%           ← 但 15% 是卵泡期的
 * 插件托管之后，这三个永远自洽。
 *
 * ⚠️ 基础率表原来写在 [生理周期模块] 的文案里，现在**这里是唯一实现**。
 *    改数值要改这里（模块文案里那份保留作为 AI 的理解参考，但不再决定输出）。
 */

/** 从 "Day14" / "14" / "孕 84 天" 这类写法里抠出数字 */
function num(v, fallback) {
    // ⚠️ 只取**第一段**数字。以前是 `.replace(/[^\d]/g,'')` 把所有数字粘成一个数：
    //   "Day14 / 28" ⇒ 1428、"孕12周+3天" ⇒ 123 ⇒ 阶段名 / 进度 / 基础率全错，
    //   而这三个字段是插件**覆盖** AI 写的那份（错了看不出来 ✗）
    const m = String(v ?? '').match(/\d+/);
    if (!m) return fallback;
    const n = parseInt(m[0], 10);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 阶段名 / 进度 / 基础率。
 *
 * @param {object} vars 契约里的 vars（Is_Pregnant / Ovulation_Day / Cycle_Length）
 * @param {'normal'|'none'|null} mode 这个对象的周期模式（**按人** ✓；不传 = 全局默认档）
 * @param {number} periodDays 这个人的「经期天数」（来自「生理期参数」面板，见 settings.periodDaysOf ✓；不传 = 5）
 * @param {number|null} cycleDay **周期日** —— ★★ 唯一来源＝插件自己按剧情日期
 *   算出来的那个数（`store.js` 的 `cycleDayNow()`）；契约里的 `Time_Scale` 已经不问了。
 *   读不到就"不接管"（返回 null），**绝不回落到轮次** ✗
 * @param {number|null} pregDays **孕期已经过了几天**（可选）—— 只给「植入卵」那种用：
 *   **这个和怀孕不太一样，因为是植入的，所以应该从植入那天算**✓
 *   不给（普通怀孕）⇒ 照旧用周期日当孕周基准（LMP 那套，一个字不变 ✓）
 * @param {{noConception?:boolean, totalDays?:number|null, diapauseWait?:boolean}} [opts]
 *   `noConception`＝这个对象锁了「能不能怀孕：不能」⇒ **没有阶段可算**（见下面那段注释）；
 *   `totalDays`＝这一族的孕期总天数（用来按比例切孕早/中/晚，读不到就退回 12/27 周 ✓）；
 *   `diapauseWait`＝受精成功、但着床还隔着几个月（滞育）⇒ 阶段写「滞育」 ✓
 *   不传＝照旧按周期日算 ✓
 * @returns {{phase:string, sub:string, d1:string}|null} 拿不到天数时返回 null（不接管）
 */
export function deriveCycleFields(vars = {}, mode = null, periodDays = 5, cycleDay = null, pregDays = null, opts = {}) {
    const isPregnant = String(vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true';
    // 周期日在函数开头就归一化：**孕周和未孕的日号用的是同一个数** ✓
    const _d0 = Number(cycleDay);
    const day = (Number.isFinite(_d0) && _d0 > 0) ? Math.round(_d0) : NaN;

    // ---- 孕期：按 LMP 孕周分早/中/晚 ----
    // ⚠️ 这一段必须排在「无月经」早退**前面**：
    //   无月经 = 没有**周期**阶段，可孕期阶段（孕早/中/晚期）与周期模式无关 ✓
    //   早退写在前面的话，「无月经」档的对象一旦怀上，阶段会被覆盖成「不适用」、
    //   孕周变「—」（还会连带把受精判定的"本周期只判一次"守卫弄失效 ✗）
    if (isPregnant) {
        // ★ 植入卵：孕周**从植入那天算**，不走 LMP 那套 ——
        //   （她定的口径：植入孕从植入那天算孕周）✓
        //   给了 pregDays 就用它；普通怀孕照旧用周期日（一个字不变 ✓）
        // ⚠️ `Number(null)` 是 0（不是 NaN）⇒ 必须先从"有没有给"这一步判，不然
        //   普通怀孕会被当成"植入第 0 天"，孕周永远 0 ✗（这个坑当场被测试抓到过一次）
        const given = !(pregDays === null || pregDays === undefined || pregDays === '');
        const pd = given ? Number(pregDays) : NaN;
        const days = (Number.isFinite(pd) && pd >= 0) ? Math.round(pd) : day;
        if (!Number.isFinite(days)) return null;
        const w = Math.floor(days / 7);
        const d = days % 7;
        // ★ 2026-11-07：早晚按**这一族的**总孕期比例切（见 pregPhaseOf ✓）
        const { phaseId, phase } = pregPhaseOf(days, opts?.totalDays);
        // 孕期的 d1 固定「不适用」
        return { phaseId, phase, sub: `孕${w}周+${d}天`, d1: '不适用' };
    }

    // ---- 滞育：受精成功、但离着床还有几个月 ----
    // ★ 2026-11-07：这几个月**不算周期在走**，也不算孕期（胚胎还没开始发育）。
    //   不特判的话面板会写「黄体期 · Day164 / 28」，看着像坏了 ✗
    //   阶段插图那行另有「滞育」的标题（stages.js），这里给的是阶段名 / 进度 / 基础率 ✓
    if (opts?.diapauseWait === true) {
        return { phaseId: null, phase: '滞育', sub: '—', d1: '不适用' };
    }

    // ---- 锁了「不能怀孕」：**没有阶段、没有进度、没有基础率** ----
    // ★★ 2026-11-03（她报：user 是男的、已经锁了「能不能怀孕＝不能」，
    //   面板还显示「排卵期 · Day14 / 28」和阶段插图）——
    //   根因：那把锁以前只掐受精 / 受孕率 / 孕期模块，**周期这条链从来没读过它** ✗
    //   ⇒ 男角色身上照样按"默认月经档"种周期、走到第 14 天就自己算出排卵日。
    //   这里接上：调用方把锁的结果传进来，这一档一律「不适用」（跟无月经那一档同一个说法）。
    //   ⚠️ 周期日（`cycleDay`）**照旧保留、不删不改** —— 玩家哪天把锁改成「能」，
    //      回来重算就还是对的那一天（不吞数据 ✓）
    //   ⚠️ 排在孕期后面：万一旧存档里"已孕 + 不能怀孕"同时在，孕期那只优先级更高 ✓
    if (opts && opts.noConception === true) {
        return { phaseId: null, phase: '不适用', sub: '—', d1: '不适用' };
    }

    // ★★ 2026-11-08 产后恢复：分娩之后那一段**没有月经、没有周期阶段**，
    //   进度写「产后第 N 天 · 还有 M 天恢复周期」。
    //   ⚠️ 基础率**不能写"不适用"**：恢复期能怀（她拍板），判定按「无月经」那一格算
    //     ⇒ 这里照实显示那个数，跟无月经那一档同一个理由 ✓
    //   ⚠️ 排在「不能怀孕」之后：那一档连阶段都不算，恢复期也一样 ✓
    //   ⚠️ 只有 `active` 为真才写这一段：恢复日那天起就交回正常周期（周期第 1 天）✓
    if (opts && opts.postpartum && opts.postpartum.active === true) {
        const d = Math.max(0, Math.round(Number(opts.postpartum.dayNo) || 0));
        const left = Math.max(0, Math.round(Number(opts.postpartum.left) || 0));
        // ★ 2026-11-08：恢复期最后那几天算「排卵已恢复」（现实里排卵比第一次月经先回来）⇒
        //   基础率抬到受孕窗口那一档；其余时间仍按「无月经」那一格 ✓
        let rate = '不适用';
        try { rate = (opts.postpartum.ovuRecovered === true ? windowRateOf() : amenorrheaRateOf()) + '%'; } catch { /* 读不到就照旧 */ }
        return {
            phaseId: 'postpartum',
            phase: '产后恢复',
            sub: `产后第 ${d} 天 · 还有 ${left} 天恢复周期`
                + (opts.postpartum.ovuRecovered === true ? ' · 排卵已恢复' : ''),
            d1: rate,
        };
    }

    // ★ 无月经那一档：**没有周期、没有阶段**（无月经就是没有阶段，不需要阶段 ——
    //   总得给男玩家一个出路 ✓）⇒ 阶段与周期位一律「不适用」
    //   ⚠️ 但**基础率不能说"不适用"**：判定确实会给每一次内射乘一个固定的基础率
    //     （那一档没有阶段可挑 ⇒ 用它自己那一格）⇒ 读数照实显示那个数，
    //     不然面板写着"不适用"、判定却在算，玩家会以为这一档怀不上 ✗
    if (isNoCycleMode(mode)) {
        let rate = '不适用';
        try { rate = amenorrheaRateOf() + '%'; } catch { /* 读不到就照旧 */ }
        return { phaseId: null, phase: '不适用', sub: '—', d1: rate };
    }

    // ---- 未孕：按周期日查表 ----
    if (!Number.isFinite(day) || day <= 0) return null;
    const len = num(vars?.Cycle_Length, 28) || 28;
    // ★ 2026-11-08：排卵日写成「不固定（交配后排卵）」⇒ **没有排卵日**（null），
    //   不是退回 14 天。`cycleDayInfoOf` / `cycleDayRanges` 都认这个 null ✓
    //   ⚠️ 契约里**没给**这一格（老存档 / 刚建的对象）仍按老行为退 14 —— 只有明确写了
    //      "不固定"这类字样的才当没有排卵日 ✓
    const ovuText = String(vars?.Ovulation_Day ?? '').trim();
    const ovuMatch = ovuText.match(/(\d+)/);
    const ovu = ovuMatch
        ? Math.max(1, Math.min(Number(ovuMatch[1]), Math.max(1, len - 2)))
        : (ovuText ? null : 14);

    // 基础率表（来自 [生理周期模块] 的【周期规则与基础率】）
    // ★ 只算 phaseId（稳定身份 ✓），名字交给 phaseNameOf 按**周期模式**翻译 ✓
    //   不要全 BAN，只把月经那一档扣掉 ✓ ⇒ 阶段名就是那个"月经" ✓
    // ★ A5：经期天数**跟着「生理期参数」面板走**，不再是写死的 5 ✗
    //   （面板改了 7/3，而这里写死 5 ⇒ 阶段口径 / 2% 基础率 / 「来月经时」门控全会和面板对不上）
    //   ⚠️ 夹一道上限：经期最晚在**排卵窗口前一天**结束 —— 否则经期会把排卵日吞掉，
    //      把 30% 的高危日算成 2%，比写死 5 还糟 ✗
    const pdays = (ovu === null)
        ? Math.max(1, Math.min(Math.round(Number(periodDays) || 5), Math.max(1, len - 2)))
        : Math.max(1, Math.min(Math.round(Number(periodDays) || 5), Math.max(1, ovu - 2)));
    // ★ A12（定下丙案）：这条 if 链**搬进 settings.js 的 `cycleDayInfoOf`** ——
    //   正文里那句「第几天到第几天」（@@DAYS:xxx@@）要用**同一套**算法，
    //   两处各写一份迟早打架（正文说第13到15天、判定却按别的日子 ✗）✓
    const { phaseId, d1 } = cycleDayInfoOf(day, ovu, pdays);
    // ★ 数值批（口径 B）：四档整体压低，目标＝认真玩大多 1~2 个周期怀上。
    //   旧值 2 / 15 / 30 / 25 在新口径下会变成"只要不避孕就必中"（窗口三天 105%）✗
    //   ⚠️ 改档位必须**同时改「生理周期模块」正文那张表**（两处不能对不上 ✓）
    //   ⇒ 四个数字现在住在 `settings.js` 的 `cycleDayInfoOf` 里 ✓
    // ⚠️ 受孕机制**一行没动** ✓（受孕机制和月经模式一样）
    //   ★ 阶段名按**这个对象自己的档**翻译（周期模式按人 ✓）
    return { phaseId, phase: phaseNameOf(phaseId, mode), sub: `Day${day} / ${len}`, d1 };
}

/**
 * ★ 新存档的默认周期起始日 = **卵泡中期**。
 *
 * 默认卵泡中期（非月经怀孕也是对应的阶段）；
 *   而默认经期的话玩家会很烦，反而更不好 ✓
 *     （以前的默认是第 1 天 = 经期：一开局角色就被判定成"正在流血"，
 *       而且剧情不给日期时时间不推进 ⇒ 可能几十楼都停在经期、基础率只有 2% ✗）
 *
 * ★ 为什么**不能写死成数字**（比如 9）：玩家把排卵日改到第 10 天时，
 *   第 9 天正好落进高危窗口（排卵日 ±1）✗ ⇒ 必须从参数算 ✓
 * ★ 取的是「经期结束那天」和「高危窗口开始那天」的**中点**：
 *   离两头一样远 —— 有铺垫（离高危期还有几天），也不会一开局就是经期 ✓
 * ⚠️ 参数挤得没有卵泡期（周期特别短）⇒ 退回"经期结束后的第一天" ✓
 *
 * @param {number} ovu 排卵日（第几天）
 * @param {number} periodDays 经期天数
 */
export function follicularMidDay(ovu = 14, periodDays = 5) {
    const o = Math.max(2, Math.round(Number(ovu) || 14));
    // 夹一道上限：经期最晚在**高危窗口前一天**结束（和 deriveCycleFields 同一个口径 ✓）
    const p = Math.max(1, Math.min(Math.round(Number(periodDays) || 5), Math.max(1, o - 2)));
    const windowStart = Math.max(1, o - 1);
    // ⚠️ 参数挤得没有卵泡期（周期特别短）⇒ 退回**经期最后一天**，**绝不**退回高危窗口：
    //   掉进高危窗口正是"玩家什么都没做就被丢进排卵期"那种抱怨 ✗
    if (windowStart - p < 2) return Math.max(1, p);
    return Math.floor((p + windowStart) / 2);     // 中点
}

/**
 * 新存档该从**第几天**开始。
 *   · `customDay > 0` ⇒ 听玩家填的那一天
 *   · 否则 ⇒ 按这个对象自己的参数取卵泡中期 ✓
 * 结果夹在 1 ~ 周期长度之间（越界值不许写进去 ✗）
 */
export function defaultCycleStartDay(targetKey = null, customDay = 0) {
    let cycle = 28;
    let ovu = 14;
    try {
        const p = bodyCycleParamsOf(targetKey);
        cycle = p.cycle;
        ovu = p.ovu;
    } catch { /* 读不到就用默认参数 ✓ */ }
    let pdays = 5;
    try { pdays = periodDaysOf(targetKey); } catch { /* 忽略 */ }
    const want = Math.round(Number(customDay) || 0);
    const day = want > 0 ? want : follicularMidDay(ovu, pdays);
    return Math.max(1, Math.min(day, Math.max(1, cycle)));
}

/**
 * ★ 随机那档（**剧情里的 NPC 默认随机** ✓）。
 *
 * 剧情里的 NPC 周期可以随机 ROLL，玩家不一样 ——
 *           玩家需要自己设置，自由度高 ✓
 * ⇒ 在 1 ~ 周期长度 之间等概率取一天（**整个周期**都算 —— 只在意"玩家本人"
 *   开局别是经期，NPC 是剧情里的人，落在哪一段都合理 ✓）
 * ⚠️ 只在**建档那一次**掷（掷完存下来，永不重掷 —— 红线 ✓）
 */
export function randomCycleStartDay(targetKey = null) {
    let cycle = 28;
    try { cycle = bodyCycleParamsOf(targetKey).cycle; } catch { /* 忽略 */ }
    const n = Math.max(1, Math.round(Number(cycle) || 28));
    return 1 + Math.floor(Math.random() * n);
}
