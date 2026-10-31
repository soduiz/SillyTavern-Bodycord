/**
 * judgment.js —— 由插件掷骰并判定的那几件事
 *
 * ⚠️ 这版是**重写**的。早先自己造了一套「从池子里取数」的逻辑，
 *    后来核对发现：受精判定交给插件掷这个是之前就有的 —— 一查，果然：
 *      · dice.js 的 DICE_PRESETS 里早就有 { id:'D100_1', label:'受精判定', expr:'1d100' }
 *      · 也早有 { id:'D5', label:'着床天数', expr:'1d5' }
 *      · IMPLANT_DAYS = { 1:6, 2:7, 3:8, 4:9, 5:10 } 也是现成的
 *      · dice.js 里甚至写着「已经锁定的判定结果（受精成功与否、着床日、胎数、性别、致孕方身份）
 *        必须沿用上一轮状态，不得因为骰值变化而重新判定」
 *    所以这版**改成复用**这些，不再另起一套。
 *
 * 额外的好处：走 rollOne() 掷出来的值会**写进酒馆的骰子面板**，
 * 玩家在「骰子」页签里能直接看到，也能对账。
 *
 * 判定规则照抄 [生理周期模块] 的【排卵窗口受精判定】：
 *   判定时刻 = 排卵窗口最后一天的 23:55
 *   判定值   = min(累计受孕率, 100%)
 *   掷 1-100，随机数 ≤ 判定值 → 受精成功
 *   ★ 成功后 → 再掷一颗「着床判定」（跟正文那条固定的着床率比）：
 *     没着床 ⇒ 这个周期不会怀孕（`implantPassed = false`，`syncPregnancyState` 据此不切孕）
 *     着床了 ⇒ 再掷着床天数（1→6天 … 5→10天）
 */

import { rollOne, currentPool, getLastUsage, recordUsage, poolSlotTakenBy } from './dice.js';
// 精子存活期的范围可配（settings.js 只依赖 modules/st，不会循环 ✓）
import { settings, implantRangeOf } from './settings.js';

/** 现成预设的 id（那边的 DICE_PRESETS 改了名字，这里要跟着改） */
const ID_FERTILIZE = 'D100_1';   // 受精判定 · 1d100

/** 兜底：预设被玩家删掉时自己掷一个 */
function fallbackRoll(faces) {
    return Math.floor(Math.random() * faces) + 1;
}

/** 掷一次受精判定随机数（1-100）。优先走现成预设，这样会写进骰子面板 */
export function rollFertilize() {
    let v = null;
    try { v = rollOne(ID_FERTILIZE); } catch { /* 预设没了就走兜底 */ }
    const usedPreset = Number.isFinite(v);
    return { value: usedPreset ? v : fallbackRoll(100), source: usedPreset ? `预设 ${ID_FERTILIZE}` : '兜底真随机' };
}

/**
 * ★ 掷一次「这次受精会不会着床」（1-100，独立掷、不占池子）。
 *
 * 口径跟 `rollSpermLife` 一个做法：插件自己掷一颗、骰子页上单独记一条 ✓
 * 基准线在正文里（`着床判定（D100）：1-80 着床成功，81 及以上着床失败`），玩家能改 ✓
 */
export function rollImplantJudge() {
    return { value: fallbackRoll(100), source: '着床判定专用掷（1~100）' };
}

/**
 * 掷一次着床天数随机数（1-5），并折算成 6-10 天
 */
export function rollImplant() {
    // ★ 改成「在区间里均匀掷」（2026-10-20）：原来固定 1d5 → 6~10 天，只有 5 个可能值，
    //   连着几次同一天数看着就很可疑（实测三次都 8 天）；现在区间可调，值就是天数 ✓
    //   ⚠️ 依旧是**真随机**：区间里每天概率一样，不做任何概率倾斜 ✓
    let lo = 6, hi = 10;
    try {
        const st = settings();
        lo = Math.max(1, Math.min(60, Math.round(Number(st.implantDaysMin) || 6)));
        hi = Math.max(lo, Math.min(60, Math.round(Number(st.implantDaysMax) || 10)));
    } catch { /* 读不到就用默认 6~10 */ }
    const span = hi - lo + 1;
    const days = span <= 1 ? lo : (lo + (fallbackRoll(span) - 1));
    return {
        value: days,
        days,
        source: span <= 1 ? `着床天数固定 ${lo} 天` : `着床天数专用掷（${lo}~${hi} 天，均匀）`,
    };
}

/**
 * 掷一次「这批精子能活几天」：在设置的范围里**均匀随机**（真随机，不做概率倾斜）。
 *
 * 把分布改窄、再塞一个尾巴的做法
 *    ⇒ **这里只认范围均匀**：
 *    · 范围由玩家在设置里填（最短 / 最长），掷出来的每一天概率一样 ✓
 *    · 想要"平均一到三天、偶尔到七天"，就把最长填成 7 —— 但那是均匀的，
 *      平均会跟着上去，**不许我们在背后偷偷改概率** ✗
 *    · 最短 = 最长 ⇒ 固定值，不掷 ✓
 */
export function rollSpermLife() {
    // ⚠️ 以前这里借用了 ID_FERTILIZE（受精判定的骰位）✗ —— 会覆盖骰子面板上
    //   受精判定那一次的对账值，而且它根本不是「受精判定」这个用途。
    //   ⇒ 改成独立掷，并在骰子面板里单独记一条，不去碰判定的骰位 ✓
    let lo = 1, hi = 7;
    try {
        const st = settings();
        lo = Math.max(1, Math.min(30, Math.round(Number(st.spermLifeMin) || 1)));
        hi = Math.max(1, Math.min(30, Math.round(Number(st.spermLifeMax) || 7)));
        if (hi < lo) hi = lo;
    } catch { /* 读不到就用默认 */ }
    const span = hi - lo + 1;
    const v = span <= 1 ? lo : (lo + (fallbackRoll(span) - 1));
    return {
        value: Math.max(lo, Math.min(hi, v)),
        source: hi === lo ? `精子存活专用（固定 ${lo} 天）` : `精子存活专用掷（${lo}~${hi} 天，均匀）`,
    };
}


/**
 * ★★ 掷一次「这一胎的孕期天数」（口径：异种要掷、人类不掷，
 *   人类生产日期很固定，除非流产 / 早产 ✓）。
 *
 * 为什么让它掷、不让 AI 报日期：各族孕期是**区间**（精灵 12-15 个月、龙裔 12-18 个月…），
 *   而 AI 不是随机源 —— 它只会挑一个"差不多"的数，每轮还可能不一样 ✗
 *   ⇒ 跟「精子存活期」同一个做法：**引擎照表报区间、插件在区间里掷一个天数** ✓
 *   （照项目那条判据：随机与算数归插件，AI 只负责查表 ✓）
 *
 * @param {number} lo 最少天数
 * @param {number} hi 最多天数（等于 lo 时就是"固定值"，不掷）
 * @returns {{value:number, source:string}}
 */
export function rollGestationDays(lo, hi) {
    let a = Math.max(1, Math.min(3650, Math.round(Number(lo) || 0)));
    let b = Math.max(1, Math.min(3650, Math.round(Number(hi) || 0)));
    if (b < a) b = a;
    const span = b - a + 1;
    const v = span <= 1 ? a : (a + (fallbackRoll(span) - 1));
    return {
        value: Math.max(a, Math.min(b, v)),
        source: span <= 1 ? `孕期固定（${a} 天）` : `孕期专用掷（${a}~${b} 天）`,
    };
}

/**
 * 池子里取一个没用过的 1-100（逐胎致孕方锁定用）。
 *
 * 为什么这个不能走预设：DICE_PRESETS 里有「胎数」「子1~子4性别」，
 * **但没有「致孕方」这一项** —— 而模块原文写的就是「直接使用随机数池里的一个数，
 * 按人数均等分配区间」，所以这里只能从池里取。
 *
 * ★★ 修（「乙」）：**取的时候要记住"取的是哪一格"**。
 *   原来两处毛病：
 *     ① 排除只按**值**比（`used.has(value)`）⇒ 池里出现重复值时，
 *        取了一个数、那一格的**同值孪生格子**会被一起当成已用（或反过来，同一格被取第二次）✗
 *     ② 返回的 `source` 只写「随机数池 R」，**没说是第几格** ⇒ 记账里丢了归属，
 *        骰子页/审计那头没法把"用了哪一格"对上 ✗（也正是"同一格能被取两次"的根因）
 *   ⇒ 现在：排除判据统一走 `poolSlotTakenBy()`（**编号和值都对得上才算占格**，
 *     和"核对模型自报"同一套），命中后把 `ref` 记成 `R3` 这种**具体格号** ✓
 */
export function drawFromPool(label = '致孕方锁定') {
    let value = null;
    let ref = '';
    let source = '兜底真随机';
    try {
        const pool = currentPool();
        // 这一轮已经占掉的池格（只认"编号+值都对得上"的；模型瞎报的编号不算，不占格 ✓）
        const taken = new Set(
            (getLastUsage() || []).map((u) => poolSlotTakenBy(u, pool)).filter(Boolean)
        );
        const free = (pool?.R || [])
            .map((n, i) => ({ ref: 'R' + (i + 1), value: Number(n) }))
            .filter((x) => Number.isFinite(x.value) && !taken.has(x.ref));
        if (free.length) {
            const pick = free[Math.floor(Math.random() * free.length)];
            value = pick.value;
            ref = pick.ref;
            source = '随机数池 R';
        }
    } catch { /* 池子取不到 */ }
    if (!Number.isFinite(value)) value = fallbackRoll(100);
    return { value, ref, source, label };
}

/**
 * 执行一次受精判定。
 *
 * @param {number} rate 判定当时的累计受孕率（百分数，如 52.5）
 */
export function runFertilizationJudgment(rate) {
    try {
        const r0 = Number(rate);
        if (!Number.isFinite(r0)) return { ok: false, error: '累计受孕率不是数字' };
        // 判定值按模块规则封顶 100%
        const judgeValue = Math.max(0, Math.min(100, r0));
        const roll = rollFertilize();
        const passed = roll.value <= judgeValue;

        let implantRoll = null;
        let implantDays = null;
        // ★ 着床判定：受精成功之后**再掷一颗**，跟正文那条固定的
        //   「着床率」比 —— 现实里受精成功也不一定着床（生化妊娠）✓
        //   `implantPassed`：null = 正文没写这一条 ⇒ **不做这道判定**（老行为一字不变 ✓）
        let implantJudge = null;
        let implantPassed = null;
        // 着床判定要不要现在掷（默认留到着床日那一轮，见 settings 的 implantJudgeOnDay）
        // 天数必须现在掷：它是算「哪天揭晓」的依据
        const _judgeNow = (() => { try { return settings().implantJudgeOnDay !== true; } catch { return true; } })();
        if (passed) {
            const r = implantRangeOf();
            if (r && _judgeNow) {
                implantJudge = rollImplantJudge();
                implantPassed = (implantJudge.value >= r.ok[0] && implantJudge.value <= r.ok[1]);
            }
            // ⚠️ 没着床也照样掷「着床天数」：那是**这颗受精卵预计的着床日**，
            //   也是"到哪天才能确认没成"的日子（提醒 / 喂回给模型都拿它当揭晓日 ✓）
            implantRoll = rollImplant();
            implantDays = implantRoll.days;
        }

        // 记进「本轮取用了哪些数值」，骰子面板上能对账
        // ★ 打上 `by: 'plugin'` —— 这几颗是**插件自己掷的**，
        //   不是引擎从池里取的；骰子页要靠它把两类分开显示 ✓
        try {
            const used = (getLastUsage() || []).slice();
            used.push({ for: '受精判定', ref: roll.source, value: roll.value, by: 'plugin' });
            if (implantJudge) used.push({ for: '着床判定', ref: implantJudge.source, value: implantJudge.value, by: 'plugin' });
            if (implantRoll) used.push({ for: '着床天数', ref: implantRoll.source, value: implantRoll.value, by: 'plugin' });
            recordUsage(used);
        } catch { /* 记不上不影响判定 */ }

        return { ok: true, rate: r0, judgeValue, roll, passed, implantDays, implantRoll, implantJudge, implantPassed };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * 逐胎锁定致孕方（异卵异父用）。
 *
 * 模块规则：名单多人时，用池里的数按人数均等分配区间，ROLL 到谁就锁定谁。
 *
 * @param {string[][]} candidatesByChild 每个孩子的候选致孕方名单
 */
export function lockImpregnatorsPerChild(candidatesByChild) {
    const out = [];
    (candidatesByChild || []).forEach((cands, i) => {
        // ⚠️ AI 会把它报成**一层扁平名单**（如 `["阿杰","阿明"]`，契约里专门警告过），
        //   那时 `cands` 是字符串 ⇒ 直接 `.map` 会抛 TypeError，
        //   而调用点那个 try/catch 会把它吞掉、**连刚掷出来的受精判定结果一起丢掉** ✗
        //   （调用点先 runFertilizationJudgment 再 setOvuJudgment，中间挂掉就是这个后果）
        const arr = Array.isArray(cands) ? cands : (cands == null ? [] : [cands]);
        const list = arr.map((x) => String(x || '').trim()).filter(Boolean);
        if (!list.length) return;
        const roll = drawFromPool(`子${i + 1} 致孕方锁定`);
        // ★★ **取完立刻记账** —— 两个作用，缺哪个都不行：
        //   ① 下次循环的 `drawFromPool()` 会读 `getLastUsage()` ⇒ 这一格才算真的占掉，
        //      子2/子3/子4 不会又抽回同一格（原来这里不记账 ⇒ 同格能被取多次 ✗）
        //   ② 骰子页「上一轮取用了哪些」原来**看不到这一颗**（它是从池里取的，却没进记账）✗
        //   ⚠️ 必须用"读 → push → 写回"（`recordUsage()` 是**整体赋值**，不是追加 ✗）
        try {
            const used = (getLastUsage() || []).slice();
            // ★ 这一颗也是**插件自己掷的**（从池里取的那条路）——
            //   以前漏了 `by: 'plugin'` ⇒ 骰子页把它标成「引擎取」，等于界面在骗人 ✗
            used.push({ for: roll.label || `子${i + 1} 致孕方锁定`, ref: roll.ref || roll.source, value: roll.value, by: 'plugin' });
            recordUsage(used);
        } catch { /* 记不上不影响锁定 */ }
        // ★ 以前用固定段宽 floor(100/N)，余数全压在最后一人身上
        //   （6 人时最后一人拿 20%、别人各 16%）⇒ 改成按比例直接算，余数自然分摊 ✓
        //   ⚠️ 3 人时结果和模块示例（1-33 / 34-66 / 67-100）仍然一致 ✓
        const idx = Math.min(list.length - 1, Math.floor((roll.value * list.length) / 100));
        out.push({ child: i + 1, roll, impregnator: list[idx] });
    });
    return out;
}
