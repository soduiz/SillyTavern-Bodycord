
import { phaseNameOf, periodDaysOf, bodyCycleParamsOf, isNoCycleMode, cycleDayInfoOf, amenorrheaRateOf } from './settings.js';
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
 * @returns {{phase:string, sub:string, d1:string}|null} 拿不到天数时返回 null（不接管）
 */
export function deriveCycleFields(vars = {}, mode = null, periodDays = 5, cycleDay = null, pregDays = null) {
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
        //   原话：「这个和怀孕不太一样，因为是植入的，所以我认为应该是从植入那天算」✓
        //   给了 pregDays 就用它；普通怀孕照旧用周期日（一个字不变 ✓）
        // ⚠️ `Number(null)` 是 0（不是 NaN）⇒ 必须先从"有没有给"这一步判，不然
        //   普通怀孕会被当成"植入第 0 天"，孕周永远 0 ✗（这个坑当场被测试抓到过一次）
        const given = !(pregDays === null || pregDays === undefined || pregDays === '');
        const pd = given ? Number(pregDays) : NaN;
        const days = (Number.isFinite(pd) && pd >= 0) ? Math.round(pd) : day;
        if (!Number.isFinite(days)) return null;
        const w = Math.floor(days / 7);
        const d = days % 7;
        // 孕 1-12 周 = 孕早期；13-27 = 孕中期；28 周至分娩 = 孕晚期
        const phaseId = w <= 12 ? 'pregEarly' : (w <= 27 ? 'pregMid' : 'pregLate');
        // 孕期阶段名**与周期模式无关** ✓（不翻译 ✓）
        const phase = { pregEarly: '孕早期', pregMid: '孕中期', pregLate: '孕晚期' }[phaseId];
        // 孕期的 d1 固定「不适用」
        return { phaseId, phase, sub: `孕${w}周+${d}天`, d1: '不适用' };
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
    // ★ 排卵日也要夹一道边界（老存档 / 模型报回来的值都可能越界）。
    //   不夹的话「排卵窗口最后一天」可能落在周期之外 ⇒ 受精判定永不触发 ✗
    const ovu = Math.max(1, Math.min(num(vars?.Ovulation_Day, 14), Math.max(1, len - 2)));

    // 基础率表（来自 [生理周期模块] 的【周期规则与基础率】）
    // ★ 只算 phaseId（稳定身份 ✓），名字交给 phaseNameOf 按**周期模式**翻译 ✓
    //   不要全 BAN，只把月经那一档扣掉 ✓ ⇒ 阶段名就是那个"月经" ✓
    // ★ A5：经期天数**跟着「生理期参数」面板走**，不再是写死的 5 ✗
    //   （面板改了 7/3，而这里写死 5 ⇒ 阶段口径 / 2% 基础率 / 「来月经时」门控全会和面板对不上）
    //   ⚠️ 夹一道上限：经期最晚在**排卵窗口前一天**结束 —— 否则经期会把排卵日吞掉，
    //      把 30% 的高危日算成 2%，比写死 5 还糟 ✗
    const pdays = Math.max(1, Math.min(Math.round(Number(periodDays) || 5), Math.max(1, ovu - 2)));
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
