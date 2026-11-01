/**
 * prompt.js —— 组装发给「主 API」的东西
 *
 * 分流原则（这是整个改造的重点）：
 *   ✅ 发主 API：角色的身体状态摘要 + 影响正文怎么写的沉浸类模块
 *   ❌ 不发主 API：所有判定层模块、精子与受精描写（那些只影响面板文字）
 *
 * 关掉的模块 = 根本不写进去，不是「注入了叫 AI 忽略」。
 *
 * 这里注入的两段文字本身也是**可编辑的**（设置 → 补丁 → 注入模板）：
 *   1. 状态摘要：把角色现在什么状态告诉主 API
 *   2. 沉浸设定：把影响正文写法的补丁正文发给主 API
 * 模板里的 {{占位符}} 会在渲染时替换；某个占位符算出来是空的时候，
 * 它所在的那一行会整行消失，所以模板可以写得整齐点。
 */

import { MODULES, XENO_CLASSES_EAST, XENO_CLASS_HUMAN, XENO_EAST_HINTS, XENO_WEST_HINTS, parseXenoSideAnswer } from './modules.js';
import { settings, isModuleOn, isGateEnabled, moduleText, moduleRole, moduleScope, isFieldOn, zonesFeatureOn, isCycleDependent, patchSendGroups, patchGroupSuffix, patchBlockTitle, childrenToMain, isNeutralMode, bodyCycleParamsOf, zoneLevelDescOf } from './settings.js';
import { setPrompt, substitute, isMyExtensionDisabled, PROMPT_ROLE } from './st.js';
import { targetList, displayName, state, bodyLockOf, xenoClassOf, periodModeOf, childrenOf, childAgeText, fetusPlanOf, fetusBriefText, hasRealHeritage, storyDateNow, storyDateTimeNow, cycleDayNow, getOvuJudgment, BODY_FLAG_VARS, reportedBool, reportedBodyFlagOf, tracesForPrompt, traceOnOf, awarenessReferenceForPrompt, stripDateText, dueMarksOf, mergeDueByDate, nextPeriodFactOf, pregnantNowTarget } from './store.js';
// ★ 被排除的角色卡：这一段**一个字都不发**（判断只写这一处，所有调用点自动失效 ✓）
import { isCardExcluded } from './cardexclude.js';

const KEY_STATE = 'bodycord_state';
const KEY_PATCH = 'bodycord_patch';
// ★ 状态摘要的「用法说明」（禁令那半句）：**基本不变** ⇒ 和沉浸设定一起放系统段 ✓
//   2026-11-01 从状态摘要抬头里拆出来的：那句"不要在正文里输出面板/字段名/数值"原来跟着
//   每轮都变的那块走，落在整段提示词的最后一句 ⇒ 等于把预设塞在 d0 的条目顶掉（报障：破不开）✗
const KEY_RULE = 'bodycord_rule';
// ★「孩子」那一段：默认**不发**；设置里开了才发 ✓
const KEY_CHILDREN = 'bodycord_children';

/**
 * ★★ 状态摘要的注入深度（2026-11-01 她拍板：从 0 挪到 2）。
 *
 * `深度 N` ＝排在**倒数第 N 条消息之前**；`深度 0` ＝最后一条消息之后，也就是整段提示词的
 * 最后一块 —— 中文破限预设普遍拿 d0 放格式或破限条目，酒馆会把同深度同角色的注入拼成同一条
 * 消息，我们的排在后面就等于把预设的最后一句顶掉（报障现象：换了 d0 密集型预设之后正文写不出来、
 * 预设本来的效果消失）。
 *
 * ⚠️ 缓存不吃亏：缓存看的是"这块之前的内容是否一模一样"，深度 2 只比深度 0 多一两条消息要重算。
 *   真正吃亏的是把它挪回系统段 —— 状态每轮变，后面的角色卡 / 世界书 / 全部历史都不吃缓存 ✗
 */
const STATE_DEPTH = 2;

const _setKeys = new Set();

// ---------------------------------------------------------------------------
// 自动门控：满足条件时才真的发出去
//
// 例：角色没来月经，「经期其他角色反应」就一个字都不发；
//     角色没怀孕，孕期那一堆补丁也一个字都不发。
// 这比"注入了叫 AI 忽略"省得多 —— 省的是真金白银的 token。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ★ 角色基础信息的三条"能力"
//
//   · canBePregnant 能不能怀孕   —— 填「不能」⇒ 插件不再给该对象算受精/周期那几套，
//                                面板也不显示受孕率这类无关数值 ✓
//   · canImpregnate 能不能让别人怀孕 —— 填「不能」⇒ 该对象不会被算进"致孕方候选" ✓
//   · canBearXeno 能不能怀上异种 —— 填「不能」⇒
//     异种族致的致孕方不进候选、也不判受精 ✓
//     （为什么要有它：每个角色"能不能跟非人类生"是世界观设定，推演引擎猜不出来 ✓
//      而且有了它，就不用为了"这个人不跟龙裔生"去单独改一整段规则文案 ✓）
//
// 四态：`null` = 未填 ⇒ **看推演这一轮报的值**（`vars` 里那三个字段 ✓）；
//              推演也没报 / 报得认不出来 ⇒ 才按"能"处理（跟以前一模一样 ✓）
//        `false` = 明确不能 ⇒ 生效 ✓
//        `true`  = 明确能 ⇒ 直接用（玩家说能就是能，推到推演之前 ✓）
//
// ★ 坑：界面那四格的下拉写着「未填（按推演每轮判断）」，
//   但只有「是不是异种」真读了 AI 报的值，另外三格 null 一律按"能"算
//   ⇒ 人设明写"不能怀孕"的角色会被当成能怀孕 —— 那显然不对
//   ⇒ 三格都要读 AI 报的（取值的优先顺序：**玩家填的 > AI 报的 > 兜底按能** ✓）
// ---------------------------------------------------------------------------

/** 这个对象这一轮报的某个能力值（先看手上这份 t.vars，再退回本聊天的档案 ✓） */
function reportedFlag(t, field) {
    const fromT = reportedBool(t?.vars?.[BODY_FLAG_VARS[field]]);
    if (fromT !== null) return fromT;
    return reportedBodyFlagOf(t?.key, field);
}

/** 这个对象能不能怀孕（玩家没填就看推演报的，都没报 ⇒ 按能 ✓） */
export function canBePregnantPerson(t) {
    if (!t?.key) return true;
    try {
        const lock = bodyLockOf(t.key);
        if (typeof lock.canBePregnant === 'boolean') return lock.canBePregnant;
        const rep = reportedFlag(t, 'canBePregnant');
        if (rep !== null) return rep;
    } catch { /* 忽略 */ }
    // ★★ 2026-10-16（无月经就是不会来月经 ⇒ 不能怀；能怀的是：非月经那档）——
    //   周期模式是「无月经」的对象，**没手填也没报过**时按"不能怀孕"算 ✓
    //   ⚠️ 只是**默认值**：玩家手填过、或推演报过 ⇒ 上面那两处早就返回了，以他们为准 ✓
    try { if (periodModeOf(t.key) === 'amenorrhea') return false; } catch { /* 忽略 */ }
    return true;
}

/** 这个对象能不能让别人怀孕（同上） */
export function canImpregnatePerson(t) {
    if (!t?.key) return true;
    try {
        const lock = bodyLockOf(t.key);
        if (typeof lock.canImpregnate === 'boolean') return lock.canImpregnate;
        const rep = reportedFlag(t, 'canImpregnate');
        if (rep !== null) return rep;
    } catch { /* 忽略 */ }
    return true;
}

/** 这个对象能不能怀上异种的孩子（同上；这条是世界观设定，同样按推演报的走 ✓） */
export function canBearXenoPerson(t) {
    if (!t?.key) return true;
    try {
        const lock = bodyLockOf(t.key);
        if (typeof lock.canBearXeno === 'boolean') return lock.canBearXeno;
        const rep = reportedFlag(t, 'canBearXeno');
        if (rep !== null) return rep;
    } catch { /* 忽略 */ }
    return true;
}

export function isPregnant(t) {
    // ★ 填了「不能怀孕」⇒ 插件按"不会怀孕"处理 ✓
    if (!canBePregnantPerson(t)) return false;
    // ★ 2026-10-30：判据收到 store 的 `pregnantNowTarget`（子宫那本账的封口也用它）
    //   ⇒ 两处只有一份口径，不会出现"这边算没怀孕、那边算怀孕"✗
    return pregnantNowTarget(t);
}

export function isMenstruating(t) {
    // 孕期不会来月经
    if (isPregnant(t)) return false;
    // ⚠️ 只认「阶段名」，不能认 t.period。
    //   因为 period_system 本身就是被这条门控管的：一旦门控关上，
    //   推演就不再更新 t.period，那个值会永远停在"上次来月经"的样子，
    //   门控就再也关不掉了（自己锁死自己）。
    //   而「阶段名」是生理周期模块每轮都会重写的，才是可靠的信号。
    // ★ 非月经模式：经期这个概念不存在 ⇒ 门控**永远关** ✓
    // ★ 周期模式按人：这个人自己是不是"无月经"那一档 ✓
    //   ★ 三档之后：**非月经 / 无月经都不存在"来月经"这个概念** ⇒ 门控永远关 ✓
    if (periodModeOf(t?.key) !== 'normal') return false;
    // 用 phaseId 判（稳定 ✓），不靠中文名 ✗
    const pid = String(t?.profile?.phaseId || '');
    if (pid) return pid === 'menstrual';
    return /月经期|经期/.test(t?.profile?.phase || '');
}

/** 从「数据项二」里抠出累计受孕率的数值 */
export function conceptionRate(t) {
    // ★ 填了「不能怀孕」⇒ 受孕率这类数值没有意义 ⇒ 按 0 处理 ✓
    //   （"不能怀孕"时面板也不该显示那些无关数值 ✓）
    if (!canBePregnantPerson(t)) return 0;
    const raw = t?.profile?.d2;
    if (!raw) return 0;
    const m = String(raw).match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
    const n = String(raw).match(/(\d+(?:\.\d+)?)/);
    return n ? parseFloat(n[1]) : 0;
}

/** 有没有「还在体内、还可能受精」的精子，或者已经在孕期了 */
/** 人类的各种写法 —— 除了这些，其他都算异种 */
// 只作**兜底**用（AI 没报 is_xeno 时）。放宽一点，覆盖常见的「人类」写法。
const HUMAN_RACE = /^(人类|人|human|human\s*female|human\s*male|普通人类|人类女性|人类男性|人族|地球人|人类血统|纯人类|无|未知|不确定|—|-)$/i;

/**
 * 这个对象是不是异种／人外。
 *
 * 种族来自 AI 在 vars.race 里报的值（契约里要求它写；只在还没报过时问一次，报过就记着 ✓）。
 * **没报、或写了「未知」就当人类** —— 宁可不发那些额外规则，也不要误fire。
 */
export function isXeno(t) {
    // ★★ 先看玩家/角色卡**锁定的**值（「角色基础信息 → 是不是人外」）✓
    //   这一格是"插件不可能自己知道的事实"⇒ 填了就锁定、忽略 AI 报的 ✓
    //   这同时**解掉了首轮竞态**：新档第一轮插件还没有 AI 报的值，
    //   但玩家要是提前勾了"是人外"，规则表**第一轮就能发出去** ✓。
    try {
        const lock = t?.key ? bodyLockOf(t.key) : null;
        if (lock && typeof lock.isXeno === 'boolean') return lock.isXeno;
    } catch { /* 忽略 */ }
    // ★ 优先用 AI 自己报的判断。
    //   人外有很多、甚至还有原创的，锁死了不合适 ——
    //   任何"人类白名单"都盖不全（地球人 / 人族 / 原创种族…），
    //   而 AI 本来就在读剧情，**它最清楚算不算人外**。所以让 it 直接报布尔值，
    //   插件只做读取，不再拿字符串去猜。
    const v = t?.vars?.is_xeno;
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        return /^(true|1|yes|是|异种|人外)$/i.test(String(v).trim());
    }
    // 兜底：AI 没报布尔值（老数据 / 漏报）时，才用种族文本估一下
    const r = String(t?.vars?.race ?? '').trim();
    if (!r) return false;
    return !HUMAN_RACE.test(r);
}


export function hasSperm(t) {
    if (isPregnant(t)) return true;
    const d6 = t?.profile?.d6;
    if (d6 && String(d6).trim() && !/^无$/.test(String(d6).trim())) return true;
    return conceptionRate(t) > 0;
}

/** 受孕流程是否还在进行（受精成功待着床 / 已孕 / 产后恢复） */
export function inConceptionFlow(t) {
    return hasSperm(t);
}

/**
 * 某个门控现在开着没有。
 *
 * 想法很简单：**不在这个阶段的东西，一个字都不发**。
 * 比如怀孕期间根本不需要算受孕率，那整条「生理周期模块」就可以先歇着；
 * 反过来没受精的时候，「怀孕判定模块」也用不上。
 */
/**
 * 这一胎的「另一个亲代」属于哪一边（**可能不止一边**）。
 *
 * ★ 异种规则表原来只按"追踪对象"（受孕方）发 ⇒ 人类妈妈 ＋ 异种爸爸
 *   那一胎，混血的孕期 / 遗传规则根本没发出去、全按人类算 ✗ ⇒ 它也算一路判据 ✓
 * ★★ 那一格从「算不算异种」升级成「属于哪一边」 ——
 *   只有"是异种"的话，异种妈妈（西方）＋ 异种爸爸（东方）时插件挑不出东方那张表 ✗
 *   ⇒ 现在读契约的 `impregnator_side`，解析口径**只有一份**（modules.js 的
 *     parseXenoSideAnswer，store.js 那边判"这份答案用不用得上"用的也是它 ✓）
 *
 * 返回：`['west']` / `['east']` / `['east','west']`（东西混血）/ `[]`（人类、留空、认不出 ✓）
 *   ⚠️ 留空 / 认不出 ⇒ **不参与**（跟老行为一致：不收紧，交给 sidesIn 兜 ✓）
 */
function fatherSides(t) {
    try { return parseXenoSideAnswer(t?.vars?.impregnator_side).sides; } catch { return []; }
}

/**
 * 这一胎的「另一个亲代」算不算异种（认得出属于西 / 东任何一边 ⇒ 算 ✓）。
 * 门控 `xeno` 用它：妈妈的规则要发、**爸爸那一胎的异种规则也要发** ✓
 */
function fatherIsXeno(t) {
    return fatherSides(t).length > 0;
}

export function gateOpen(kind, targets) {
    if (!kind) return true;
    const list = (targets && targets.length) ? targets : targetList();

    // ★ 门控可以是**数组**：多个条件要同时满足（AND）。
    //   门控改成"识别到有异种之后才生效"时，需要同时判定两个条件 ——
    //   一是异种，二是是否符合那个补丁本身 ⇒ 所以异种模块挂 ['xeno', 'pregnancy'] 这样。
    //   关掉了自动门控的 kind 视为"不拦"，全部 kind 都关掉时一律发送（跟原来单条件的语义一致）。
    const kinds = Array.isArray(kind) ? kind : [kind];
    const active = kinds.filter(k => isGateEnabled(k));
    if (!active.length) return true;
    return active.every(k => gateSatisfied(k, list));
}

/**
 * 这一胎的「血脉遗传特质」该发了没 —— 门控与"那一轮临时带世界书"两处共用同一判据 ✓
 *
 * 判据 ＝ 已孕 ＋ 这一胎还没发过 ＋ **孩子状态（d6）已经有内容**。
 * 为什么最后一条必须加（2026-10-23 她点出来的）：这个模块是"判遗传"用的，
 *   不是"着床"用的。正文里时间快进跨过着床日时，着床与 d6 都在回包**之后**才出现 ⇒
 *   早一轮发它只能对着还不存在的孩子格空写，白花 token 还容易让它编 ✗
 *   d6 出来了那一轮再发，正好是"判遗传"的那一刻 ✓
 * ⚠️ 拿不到 d6（老存档 / profile 缺失）时按"还没写"处理：宁可晚一轮，也别空写。
 */
export function heritageDue(t) {
    try {
        if (!t) return false;
        if (t.heritageDone === true) return false;
        // ★★ 2026-10-24（构建 -98）：自动重试到上限 ⇒ 停自动（不烧 token），但不标成"判过" ——
        //   状态留在 `heritageGiveUp`，诊断里亮着，玩家点「按现在的结果重写」才清 ✓
        if (t.heritageGiveUp === true) return false;
        // ★★ 2026-10-23 定稿（她的口径：**先判着床，才能判胎儿和遗传**）：
        //   已经孕了（着床完成）才算进这一步；然后是"胎儿那边有数据了"（胎数/性别那一轮之后），
        //   最后才是遗传。三件事按轮次排开，不许挤在着床那一轮 ✗
        if (!isPregnant(t)) return false;
        let hasFetus = false;
        try { hasFetus = !!fetusPlanOf(t.key); } catch { hasFetus = false; }
        const d6 = String(t?.profile?.d6 || '').trim();
        if (!hasFetus && !(d6 && !/^无/.test(d6) && d6 !== '—')) return false;
        // 孩子格里已经有**真正的**遗传判定了 ⇒ 不再发（「显性：无」不算，见 hasRealHeritage ✓）
        if (hasRealHeritage(d6)) return false;
        return true;
    } catch { return false; }
}

function gateSatisfied(kind, list) {
    switch (kind) {
        // 异种／人外：对象的种族不是人类时才需要那些额外规则。
        // ⚠️ 种族由 AI 在 vars.race 里报（只问一次 ✓）；没报就**当人类**（宁可不发，也不误发）。
        // ★ **另一个亲代是异种也算** —— 人类妈妈 ＋ 异种爸爸那一胎，
        //   混血的孕期 / 遗传规则必须照发；只看妈妈的话会全按人类算 ✗
        case 'xeno':
            return list.some(isXeno) || list.some(fatherIsXeno);
        // 血脉遗传特质：跟着「怀孕判定模块」同一个门控（conception）走，见 heritageDue ✓
        // 血脉遗传特质：**只在"这一胎的孩子状态已经出来、还没发过"时发一次**。
        //   ⚠️ 2026-10-23 她纠的口径：判据要挂在"判遗传"那一刻，**不是挂在着床**：
        //     · 正常逐日推进时，着床那一轮 AI 就会判 d6 ⇒ 同一轮发正好 ✓
        //     · 正文里时间快进跨过着床日时，着床和 d6 都在回包**之后**才有 ⇒
        //       早一轮发它只会对着还不存在的孩子格空写 ⇒ 等 d6 出来了下一轮再发 ✓
        //   ⇒ 所以判据里要带上「d6 已经有内容」这一条（见 heritageDue ✓）
        case 'heritage_once':
            return list.some(heritageDue);
        case 'pregnancy':      // 孕期相关的沉浸补丁
            return list.some(isPregnant);
        case 'menstruation':   // 经期相关的沉浸补丁
            return list.some(isMenstruating);
        case 'conception':     // 受孕流程（着床、孕周、分娩重置）
            return list.some(inConceptionFlow);
        case 'sperm':          // 精子与受精描写
            return list.some(hasSperm);
        // ★★ 这条原来是**名单级**的"全员没怀孕"：`!list.some(isPregnant)`。
        //   可名单里只要有一个人怀孕，**未孕那个人**的周期规则就整条拿不到了
        //   （基础率表 / 累计起算与增量公式 / 防护情境判定 / 判定时机 / 精子存活与待受精）
        //   而 core 里那句"孕期那条模块不发，这一条就跳过"是**按人写的** ⇒ 自相矛盾 ✗
        //   ⇒ 判据换成"**名单里有人没怀孕**就发"：单档聊天行为一字不变（全未孕 true、全已孕 false），
        //     只有"一个已孕 ＋ 一个未孕"这种混合名单才会多出这一条 —— 那正是需要它的场景 ✓
        //   ⚠️ 已孕那位不会被带偏：推演骨架第 3.1 条写着"带状态条件的规则只对处于该状态的对象生效" ✓
        //   ⚠️ 顺手扫过 gateSatisfied 里所有 kind：只有这一条原来是"全员"语义，其余都是 list.some ✓
        case 'not_pregnant':   // 只要名单里还有"没怀孕的对象"就发（周期推进、受孕率计算）
            return list.some((t) => !isPregnant(t));
        // ★ 多致孕方与异卵异父：按「受孕窗口」发，而不是「怀孕时」。
        //   为什么：它要教的候选名单规则，必须用在受精判定那一轮（窗口结束后的下一轮），
        //   那时候还没着床、Is_Pregnant 还是 false ⇒ 挂「怀孕时」等于判定那一轮它不在场，
        //   规则从来没被用上过 ✗
        //   判据：① 还没判定过、且周期日已经到排卵日的前一天（默认第 13 天）⇒ 该发了；
        //         ② 已经判定过、但这次受精成功且还没着床完成 ⇒ 继续发（多胎归属还要用）
        case 'multi_father_window':
            return list.some((t) => {
                let j = null;
                try { j = getOvuJudgment(t.key); } catch { j = null; }
                if (j) {
                    if (j.passed !== true) return false;
                    if (!isPregnant(t)) return true;
                    // ★ **已孕那一轮还得留一轮**。
                    //   模块里有一段【大批量卵】（5 胎以上的归属怎么填），它自己写着
                    //   "胎数在着床完成那一轮才知道，届时再套用本段" —— 而原来这个判据
                    //   一怀上就 return false ⇒ 那一段**永远发不出去**（单人名单时必然）✗
                    //   ⇒ 改成：已孕时再看一眼 d6，胎数还没落库就继续发（就是判定那一轮），
                    //     胎数写进去了就收工 ✓（模型没写 d6 时它会一直开着，正好能自愈）
                    const d6 = String(t?.profile?.d6 ?? '').trim();
                    return !d6 || d6 === '无';
                }
                try {
                    const day = Number(cycleDayNow(t.key));
                    const ovu = Number(bodyCycleParamsOf(t.key)?.ovu) || 14;
                    return Number.isFinite(day) && day >= ovu - 1;
                } catch { return false; }
            });
        default:
            return true;
    }
}

/**
 * 这个对象属于哪一边的异种：西方与通用 / 东方 / 判不出来。
 *
 * ★ 西异种和东方异种是两套键：两张表都开时，两边的规则会全塞进提示词（每轮 5183 字符）✗
 *   ⇒ 两张表各挂 `gateSide`，这里负责"这个对象算哪一边"。
 *
 * 判据优先级：
 *   ① 玩家手填的「属于哪个大类」（角色基础信息 / 补丁页那个人物视图里那格）—— 最准，优先 ✓
 *   ② AI 在 vars.race 里报的种族名（只问一次 ✓）—— 只在**两张表的互斥关键词**里命中**一边**时才算数 ✓
 *   ③ 都判不出来 ⇒ `'unknown'`（调用方**不收紧**，退回"都发"）✓
 *
 * ⚠️ 分寸：宁可多背一张表，也不能让 AI 少一份规则 ⇒ 含糊一律 unknown ✓
 */
export function xenoSide(t) {
    let cls = '';
    try { cls = String(xenoClassOf(t?.key) || '').trim(); } catch { cls = ''; }
    if (cls === XENO_CLASS_HUMAN) return 'human';         // 明确是人类 ⇒ 哪一边都不是
    if (cls) return XENO_CLASSES_EAST.includes(cls) ? 'east' : 'west';

    const race = String(t?.vars?.race ?? '').trim();
    if (!race) return 'unknown';
    // ⚠️ 参数名别用 h（项目里 h 是画 DOM 的助手名，导入检查会当成漏 import ✗）
    const e = XENO_EAST_HINTS.some(kw => race.includes(kw));
    const w = XENO_WEST_HINTS.some(kw => race.includes(kw));
    if (e && !w) return 'east';
    if (w && !e) return 'west';
    return 'unknown';                                     // 两边都命中 / 都没命中 ⇒ 不收紧
}

/**
 * 名单里判得出来的那几边（空集合 = 全都判不出来）。
 *
 * ★★ 修的就是"混血胎算漏表"那个洞：
 *   ① **另一个亲代那一边也算** —— 异种妈妈（西方）＋ 异种爸爸（东方）⇒ 两张表都得在场，
 *      混血要取双方种族的中间值（模块正文早就这么写了 ✓ 是插件没把表凑齐 ✗）
 *   ② **判不出哪一边、但它确实是异种的**（原创种族这类）⇒ 当"两边都可能"，
 *      两张表都别裁。以前是靠"集合为空 ⇒ 不收紧"侥幸成立的，一旦爸爸那边贡献了一边，
 *      这个兜底就会失效 ⇒ 现在把它写实 ✓（口径：宁可多背一张表，不能少一份规则 ✓）
 */
function sidesIn(list) {
    const out = new Set();
    for (const t of list) {
        const s = xenoSide(t);
        if (s === 'east' || s === 'west') { out.add(s); continue; }
        if (s !== 'unknown') continue;                    // 明确是人类 ⇒ 哪一边都不是 ✓
        let x = false;
        try { x = isXeno(t); } catch { x = false; }
        if (x) { out.add('east'); out.add('west'); }      // 是异种但判不出边 ⇒ 两边都别裁 ✓
    }
    // ★ 爸爸那一边（可以多个；留空 / 人类 ⇒ 什么都不加 ✓）
    for (const t of list) for (const f of fatherSides(t)) out.add(f);
    return out;
}

/**
 * `gateSide` 那一层的判定 —— 只在"名单里判得出是哪一边"时才收紧。
 *   ① 一边都判不出来 ⇒ 发（含糊不收紧 ✓）
 *   ② 我这边的族在名单里 ⇒ 发
 *   ③ 我这边没匹配上：如果**其它开着的表也一边都没匹配** ⇒ 还是发
 *      （不然会出现"一张表都不发"⇒ AI 手里没有任何种族规则 ✗）
 */
function sideGateOk(mySide, list, selfId) {
    const matched = sidesIn(list);
    if (!matched.size) return true;
    if (matched.has(mySide)) return true;
    const others = MODULES
        .filter(m => m.gateSide && m.id !== selfId && isModuleOn(m.id))
        .map(m => m.gateSide);
    return !others.some(s => matched.has(s));
}

/** 这个模块此刻该不该发（开关 + 门控） */
export function moduleActive(id, targets) {
    if (!isModuleOn(id)) return false;
    const mod = MODULES.find(m => m.id === id);
    if (!mod) return true;

    // ★ 双锁：变体模块依赖的本体没开，这个变体也不能生效。
    //   血脉遗传特质要是本体板块没开，那么就算现在这个板块
    //   开了也不能生效 —— 以前只有**文案**写着「没开就一并失效」，
    //   代码层面根本不拦。现在改成本体没开就真的不发。
    if (mod.requires) {
        const reqs = Array.isArray(mod.requires) ? mod.requires : [mod.requires];
        if (reqs.some(r => !isModuleOn(r))) return false;
    }

    const list = (targets && targets.length) ? targets : targetList();

    // ★★ `gateAny`：跟 `gate` 长得很像，但语义是**任一满足就发**（并集）。
    //   为什么要有它：一条模块可能对**两种互不相干的场景**都适用 —— 例如「别让角色 OOC」
    //   这种共用小模块，它该在「怀孕时」和「来月经时」都发；
    //   用 `gate: ['pregnancy','menstruation']` 会变成"必须同时满足"（并集写成交集 ✗）。
    //   ⚠️ 只用 `gate` 时语义不变（每个条件都得满足，AND ✓）。
    if (!mod.gate && mod.gateAny) {
        const anys = Array.isArray(mod.gateAny) ? mod.gateAny : [mod.gateAny];
        const active = anys.filter(k => isGateEnabled(k));
        if (active.length && !active.some(k => gateSatisfied(k, list))) return false;
    } else if (mod.gate) {
        if (!gateOpen(mod.gate, list)) return false;
    }

    // ★★ `gateSide`（两张异种表各挂一边之后加的）：
    //   两张表（西方与通用 / 东方）各挂一边，名单里判得出是哪一边时只发那一边 ✓
    //   判不出来就退回"都发"（见 sideGateOk 里的三条）✓
    if (mod.gateSide && !sideGateOk(mod.gateSide, list, mod.id)) return false;

    return true;
}

/**
 * 写入一条注入。
 *
 * ★ 关键是那个 filter —— 酒馆的 `setExtensionPrompt(key, value, position, depth,
 *   scan, role, filter)` 第六个参数是个函数，**酒馆在构建提示词时会实际调用它**
 *   （源码里 `const hasFilter = typeof prompt.filter === 'function';
 *     if (hasFilter && !await prompt.filter()) { continue; }`），
 *   返回 false 这一条就被跳过。
 *
 *   ⇒ 这比自己"定时去清"可靠得多：那是在生成之前由**酒馆**来问"现在要不要发"，
 *     所以哪怕插件这边的 JS 因为禁用而不再跑事件，这条注入也不会漏出去。
 *     插件被禁用时 `isMyExtensionDisabled()` 为真 → 直接不发。
 */
function put(key, value) {
    setPrompt(key, value, 0 /* IN_PROMPT */, 4, PROMPT_ROLE.SYSTEM, injectionFilter);
    _setKeys.add(key);
}

/**
 * 写入一条**末尾注入**（塞进聊天末尾那一块，不是系统段）。
 *
 * ★★ 2026-10-15（前面只有 0% 没变，从第 3 条（共 70 条）开始变）——
 *   状态摘要**每轮都在变**，而它原来走 `put()`（IN_PROMPT）：
 *   酒馆把 IN_PROMPT 的注入放在**主提示词之后、角色卡 / 世界书 / 全部历史之前**
 *   （`public/scripts/openai.js`：`newIndex = position === 'end' ? indexOfMain + 1 : indexOfMain`）
 *   ⇒ 它一变，后面几十条全部重算 ⇒ 主 API 的缓存一点吃不到 ✗
 *   ⇒ 改成 IN_CHAT ＋ 固定深度（= 靠近请求尾巴）：
 *     稳定前缀就变成「系统段 ＋ 到这块之前的整段历史」，每轮只有尾巴这一小块在变 ✓
 *   ⚠️ `depth` 只对 in-chat 注入生效 —— `put()` 里那个 4 对 IN_PROMPT 完全不起作用 ✓
 *   ⚠️ 只挪**每轮都会变的那块**（状态摘要）：沉浸设定 / 孩子那种基本不变的留在系统段 ✓
 *     （系统段的位置对正文风格影响更大，能不动就不动 ✓）
 *   ⚠️★ 深度用 `STATE_DEPTH`（现在是 2，**不是 0**）—— 0 是整段提示词的最后一句，
 *     会和预设塞在 d0 的破限条目抢同一个槽并把预设顶掉 ✗ 见上面那条注释 ✓
 */
function putTail(key, value) {
    setPrompt(key, value, 1 /* IN_CHAT */, STATE_DEPTH, PROMPT_ROLE.SYSTEM, injectionFilter);
    _setKeys.add(key);
}

/** 酒馆在构建提示词时会调用这个 —— 返回 false 就不注入 */
function injectionFilter() {
    // ① 被酒馆禁用（扩展管理器里取消勾选）→ 绝不注入
    if (isMyExtensionDisabled()) {
        // 打到日志里，方便在控制台确认"闸刀到底落没落"
        if (!injectionFilter._logged) {
            injectionFilter._logged = true;
            console.log('[Bodycord] 已被酒馆禁用 → 提示词注入已停止（这条注入不会再发出去）');
        }
        return false;
    }
    injectionFilter._logged = false;
    // ② 插件自己的开关关掉了 → 不注入
    try {
        const s = settings();
        if (!s.enabled || !s.injectToMain) return false;
    } catch { /* 读不到就按能发处理，避免误伤 */ }
    return true;
}

/**
 * 诊断用：**一行输出全部关键值**，避免控制台把嵌套对象折叠掉。
 *
 * 用法：控制台打 `__bodycordDiag()` —— 它会 console.log 一整行，
 *   然后 return 一个对象（不展开也不会丢信息，因为已经打进日志了）。
 */
if (typeof window !== 'undefined') {
    try {
        window.__bodycordDiag = () => {
            const c = (window.SillyTavern && window.SillyTavern.getContext) ? window.SillyTavern.getContext() : null;
            const es = c?.extensionSettings;
            const list = Array.isArray(es?.disabledExtensions) ? es.disabledExtensions : null;
            const matched = list ? list.filter((n) => /bodycord/i.test(String(n))) : null;
            let own = null;
            try { const s2 = settings(); own = { enabled: s2.enabled, injectToMain: s2.injectToMain }; } catch { own = '(读不到)'; }

            const line = [
                '版本=' + 'filter-v2',
                'getContext=' + !!c,
                'extensionSettings=' + !!es,
                '禁用总数=' + (list ? list.length : '(读不到)'),
                '含bodycord的项=' + (matched ? JSON.stringify(matched) : '(读不到)'),
                '禁用列表前5=' + (list ? JSON.stringify(list.slice(0, 5)) : '(读不到)'),
                '插件自己的开关=' + JSON.stringify(own),
                '我算被禁用吗=' + isMyExtensionDisabled(),
            ].join('  ｜  ');
            console.log('%c[Bodycord 诊断] ' + line, 'color:#59609e;font-weight:bold');

            const out = {
                '版本标记': 'filter-v2',
                'getContext 拿得到吗': !!c,
                'extensionSettings 拿得到吗': !!es,
                '禁用总数': list ? list.length : '(读不到)',
                '含 bodycord 的项': matched && matched.length ? matched : '（没有！所以酒馆不认为我被禁用）',
                '禁用列表前 5 条': list ? list.slice(0, 5) : '(读不到)',
                '插件自己的开关': own,
                '我算被禁用吗': isMyExtensionDisabled(),
            };
            return out;
        };
        // 兼容旧名字
        window.__bodycordWhy = window.__bodycordDiag;
    } catch { /* 忽略 */ }
}

/** 清掉插件注入过的所有内容（一个字都不留） */
export function clearInjection() {
    for (const k of _setKeys) setPrompt(k, '');
    _setKeys.clear();
    setPrompt(KEY_STATE, '');
    setPrompt(KEY_RULE, '');
    setPrompt(KEY_PATCH, '');
    setPrompt(KEY_CHILDREN, '');
}

// ---------------------------------------------------------------------------
// 默认模板
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATES = {
    stateHeader: [
        '[角色身体状态 · 由系统维护]',
        '下面是写这一轮正文之前的事实。',
    ].join('\n'),

    // ★★ 2026-11-01 新增：状态摘要的**用法说明**（含"不要在正文里输出面板 / 字段名 / 数值"那句）。
    //   为什么从抬头里拆出来：抬头跟着**每轮都变**的状态摘要走尾巴，等于把整段提示词的
    //   最后一句变成禁令 ⇒ 把预设塞在 d0 的破限条目顶掉（报障：预设效果没了）✗
    //   这句基本不变 ⇒ 跟沉浸设定一起放系统段，照样吃缓存 ✓
    stateRule: [
        '[状态摘要怎么用]',
        '状态摘要列出的是写这一轮正文之前的事实，请据此描写角色的身体与反应。不要在正文里输出任何面板、字段名、数值格式或状态标签，也不要把这些参考数据照抄进正文；那些级别与累计刺激尤其不要写。',
        '正文里也不要用卵泡期、黄体期、排卵期这类周期术语，不写周期第几天。角色的身体变化用日常说法写（比如"这几天腰有点酸、胃口比平时好"），不要报生理阶段的名称。',
    ].join('\n'),

    // 每个追踪对象渲染一次；算出来是空的占位符所在行会自动消失
    targetBlock: [
        '■ {{name}}{{isUser}}',
        '- {{pregnancy}}',
        '- {{menstruation}}',
        // ★ 2026-10-28（她：周期也要兼容主 API 的时间跳跃）——
        //   只给事实：下次月经大概哪天、距今几天。时间一跳，主 API 靠这两个数
        //   自己就能判断"这一跳里来过没有"（比一次减法，不用算余数 ✓）
        '- {{nextPeriod}}',
        '- {{fetus}}',
        // ★ 2026-10-26（她定的）：预产期也发给主 API ——
        //   模型对"还剩多久"没有概念，不给它日期就会写"孕期漫长得看不到头"、
        //   或者预产期早过了还在写"再过几个月" ✗
        '- {{due}}',
        '- {{milk}}',
        '- {{zones}}',
        '- {{birth}}',
        '- {{impregnator}}',
        '- {{awareness}}',
        // ★ row123 都发：这个其实对剧情有帮助 ✓
        //   以前只发 row3（近期性行为）⇒ 现在三条状态条都进状态摘要 ✓
        '- {{physio}}',
        '- {{body}}',
        // ★ 身体痕迹只给这一行，**身上没痕迹时整行消失** ✓
        '- {{traces}}',
        '- {{recentSex}}',
    ].join('\n'),

    stateFooter: '',

    patchHeader: [
        '[沉浸设定 · 系统维护]',
        '以下设定用于指导你如何描写角色的身体与反应。它们是写作参考，不要在正文里复述这些条目标题。',
    ].join('\n'),

    patchItem: '【{{name}}】\n{{text}}',
    patchItemTarget: '【{{name}} · 对象：{{target}}】\n{{text}}',
};

/**
 * ★★ 敏感带那一行**给主 API 的形态**：只留"哪个部位"＋强弱词，**不带等级与累计刺激**。
 *
 * 为什么：模型把摘要里的参考数据**照抄进正文** ——
 *   正文出现了「侧颈2级的敏感度上，他每一次开口都像电流贴着皮走」✗，
 *   而摘要里喂给它的原文正是「侧颈 2级（累计刺激 39）」⇒ **它没编，是照着抄** ✓。
 * ⇒ **从源头去掉数字**：模型没数字可抄 ✓（正文里不许出现数值格式 ✓）。
 * ⚠️ 认不出格式的条目**原样保留**（宁可留着，也别把玩家的自定义写法吃掉 ✗）。
 */
export function zonesWords(raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    // ★★ 2026-10-22（她定的形态）：**不给数字、也不给"有点敏感/敏感"这类等级名**，
    //   改成「部位、部位（该等级的表现）· 部位（另一档的表现）」——
    //   数字会被照抄进正文（正文里冒出「侧颈2级」就是这么来的），干脆一个都不给；
    //   括号里的描述取自「敏感带等级表现参考」那张卡（玩家改卡 = 改这一行 ✓）
    const groups = new Map();   // level -> Set(部位)
    const others = [];
    for (const piece of t.split(/[·、，,；;|｜\n]+/).map((s) => s.trim()).filter(Boolean)) {
        const m = piece.match(/^(.+?)\s*(\d+)\s*级/);
        if (!m) {
            const keep = piece.replace(/（[^）]*）/g, '').trim();
            if (keep) others.push(keep);
            continue;
        }
        const part = m[1].trim();
        const lv = Math.round(Number(m[2]) || 0);
        if (!(lv > 0)) continue;                 // 0 级 = 还没被碰出来 ⇒ 不进这一行
        const L = Math.max(1, Math.min(5, lv));
        if (!groups.has(L)) groups.set(L, []);
        groups.get(L).push(part);
    }
    const out = [];
    // 由强到弱：正文里优先写最敏感的那几处 ✓
    for (const L of [...groups.keys()].sort((a, b) => b - a)) {
        const parts = groups.get(L);
        if (!parts || !parts.length) continue;
        const desc = zoneLevelDescOf(L);
        out.push(parts.join('、') + (desc ? `（${desc}）` : ''));
    }
    if (others.length) out.push(others.join('、'));
    return out.join(' · ');
}

export function templates() {
    const s = settings();
    if (!s.injectTemplates || typeof s.injectTemplates !== 'object') s.injectTemplates = {};
    for (const [k, v] of Object.entries(DEFAULT_TEMPLATES)) {
        if (typeof s.injectTemplates[k] !== 'string') s.injectTemplates[k] = v;
    }
    // ★ 那两条默认抬头原来写作「由插件维护 / 插件维护」，而提示词硬规矩是
    //   **不许出现「插件」二字**（AI 会跳戏）。只改默认值不够 —— 老存档里可能已经存下了
    //   旧那份 ⇒ 这里**只按字面替换那两个说法**，玩家自己改过的内容一个字都不动 ✓
    const OLD_HEADER_WORDS = [['由插件维护', '由系统维护'], ['· 插件维护', '· 系统维护']];
    // ★★ 2026-10-16：模型把摘要里的参考数据**照抄进正文**（正文里出现了「侧颈2级…」✗）——
    //   默认那句补上"也不要把这些参考数据照抄进正文（敏感带的级别与次数尤其不要写）"。
    //   ⚠️ 模板是**存在设置里**的 ⇒ 只改默认值不够：这里把**还等于旧默认**的那份一起换掉，
    //     **玩家自己改过（字面对不上）的一个字都不动** ✓
    //   ⚠️ 那句里**不许出现「敏感带」这个词** —— 有一条断言是"关掉敏感带之后摘要里不许有『敏感带』"
    //     （用词一致性那族 ✓）⇒ 说成"那些级别与次数尤其不要写"就够了 ✓
    const OLD_STATE_SENTENCE = '不要在正文里输出任何面板、字段名、数值格式或状态标签';
    const NEW_STATE_SENTENCE = '不要在正文里输出任何面板、字段名、数值格式或状态标签，也不要把这些参考数据照抄进正文；那些级别与累计刺激尤其不要写';
    {
        const cur = s.injectTemplates.stateHeader;
        if (typeof cur === 'string' && cur.includes(OLD_STATE_SENTENCE) && !cur.includes('照抄进正文')) {
            s.injectTemplates.stateHeader = cur.split(OLD_STATE_SENTENCE).join(NEW_STATE_SENTENCE);
        }
    }
    // ★ 2026-10-29：敏感带那个数从「次」改成「累计刺激」——
    //   d9 那一行不再有「N 次」，照抄禁令里那个词也得跟着换（不然它还在盯着一个不存在的词）✓
    //   ⚠️ 模板存在设置里 ⇒ 只改默认值不够；这里按**字面**换那一句
    //     （玩家把别处改过的照样不动：只换这半句 ✓）
    {
        const cur = s.injectTemplates.stateHeader;
        if (typeof cur === 'string' && cur.includes('那些级别与次数尤其不要写')) {
            s.injectTemplates.stateHeader = cur.split('那些级别与次数尤其不要写').join('那些级别与累计刺激尤其不要写');
        }
    }
    for (const k of ['stateHeader', 'patchHeader']) {
        let v = s.injectTemplates[k];
        if (typeof v !== 'string') continue;
        for (const [a, b] of OLD_HEADER_WORDS) v = v.split(a).join(b);
        s.injectTemplates[k] = v;
    }
    // ★★ 2026-11-01：禁令那半句从「状态摘要抬头」挪去系统段（KEY_RULE）——
    //   模板存在设置里 ⇒ 老存档那份抬头里还带着那句 ✗ 这里按**字面**拆开：
    //   · 抬头里含禁令的**整行**去掉（那行前半句"请据此描写角色"跟着一起搬过去，语义不丢）
    //   · stateRule 里还没有那句 ⇒ 给新的默认值（默认那段本来就包含它，内容不会丢）
    //   ⚠️ 玩家自己改写过的抬头（不含禁令字面）一个字都不动 ✓
    //   ⚠️ 玩家当年**故意删掉**禁令的那种抬头也不动；但 stateRule 是新键，默认值会补上
    //     —— 这是"拆键"的代价，比让禁令继续压在提示词最后一句要好 ✓
    {
        const AT = '不要在正文里输出';
        const cur = String(s.injectTemplates.stateHeader || '');
        if (cur.includes(AT)) {
            const kept = cur.split('\n').filter((l) => !l.includes(AT)).join('\n').trim();
            s.injectTemplates.stateHeader = kept || DEFAULT_TEMPLATES.stateHeader;
            if (!String(s.injectTemplates.stateRule || '').includes(AT)) {
                s.injectTemplates.stateRule = DEFAULT_TEMPLATES.stateRule;
            }
        }
    }
    // ★★ 2026-10-26：状态摘要新增了「预产期」那一行 ——
    //   模板是**存在设置里**的 ⇒ 光改默认值不够：老存档里存的那份没有 {{due}}，
    //   这一行就永远发不出去 ✗ ⇒ 给"还有 {{fetus}} 但没有 {{due}}"的那份**补一行**。
    //   ⚠️ 玩家自己删掉/改过顺序的照样按他的来（只是在他 {{fetus}} 那行后面插一条 ✓）
    {
        const cur = String(s.injectTemplates.targetBlock || '');
        if (cur && !cur.includes('{{due}}') && /^\s*[-•*·]\s*\{\{fetus\}\}\s*$/m.test(cur)) {
            s.injectTemplates.targetBlock = cur.replace(/(^\s*[-•*·]\s*\{\{fetus\}\}\s*$)/m, '$1\n- {{due}}');
        }
    }
    // ★★ 2026-10-28：状态摘要新增了「预计下次月经」那一行 ——
    //   跟 {{due}} 同一个道理：模板存在设置里，光改默认值不够，老存档里那份没有 {{nextPeriod}}，
    //   这一行就永远发不出去 ⇒ 给"还没有它"的那份**补一行**。
    //   ⚠️ 插在 {{menstruation}} 后面（那是它的位置）；玩家把那一行删了的，退一步插在 {{pregnancy}} 后面；
    //      两个都没有（自己重排过）⇒ **一个字都不动**（那是他自己的模板 ✓）
    {
        const cur = String(s.injectTemplates.targetBlock || '');
        if (cur && !cur.includes('{{nextPeriod}}')) {
            const after = /\{\{menstruation\}\}/.test(cur) ? 'menstruation' : (/\{\{pregnancy\}\}/.test(cur) ? 'pregnancy' : '');
            if (after) {
                s.injectTemplates.targetBlock = cur.replace(
                    new RegExp('(^\\s*[-•*·]\\s*\\{\\{' + after + '\\}\\}\\s*$)', 'm'),
                    '$1\n- {{nextPeriod}}');
            }
        }
    }
    return s.injectTemplates;
}

/**
 * ★ **【注入模板】里可以用的占位符白名单**。
 *
 * ⚠️ 只放"真正会被替换"的键：
 *   · `vars.*` 那些（状态摘要那一行行）✓
 *   · prompt.js 以**字面量**传给 renderTemplate 的三个（`name` / `text` / `target`，
 *     沉浸设定那两条模板用）✓
 * ⚠️ 这份名单和真实键的对账由 自测脚本 的一条断言盯着（怕两边漂 ✓）。
 */
export const KNOWN_TEMPLATE_VARS = [
    'name', 'isUser', 'pregnancy', 'menstruation', 'nextPeriod', 'fetus', 'due', 'milk', 'zones', 'birth',
    'impregnator', 'awareness', 'physio', 'body', 'traces', 'recentSex',
    'text', 'target',
];

/**
 * 模板里**认不出的占位符**（写了但没人替换 ⇒ 会被静默吃掉）。
 *
 * `renderTemplate` 遇到认不出的键会替换成空串，
 *   整行只有占位符时那一行还会整行消失 ⇒ 玩家把 `{{awareness}}` 打成 `{{awarenesss}}`
 *   既不报错、预览也看不出，那一块信息就永久不发了 ✗
 * ⇒ 设置里「注入模板」那一块拿这个列表报一句警告 ✓
 */
export function unknownTemplatePlaceholders() {
    const T = templates();
    const known = new Set(KNOWN_TEMPLATE_VARS);
    const bad = new Set();
    for (const v of Object.values(T || {})) {
        for (const m of String(v ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
            if (!known.has(m[1])) bad.add(m[1]);
        }
    }
    return [...bad].sort();
}

// ---------------------------------------------------------------------------
// 占位符渲染
// ---------------------------------------------------------------------------

const ONLY_PLACEHOLDER = /^\s*(?:[-•*·]\s*)?\{\{(\w+)\}\}\s*$/;

/** 渲染模板：整行只有占位符、而该占位符是空的时候，把这一行丢掉 */
function renderTemplate(tpl, vars) {
    const out = [];
    for (const line of String(tpl ?? '').split('\n')) {
        const only = line.match(ONLY_PLACEHOLDER);
        if (only && !String(vars[only[1]] ?? '').trim()) continue;
        const text = line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
        // 变成「- 」这种空壳行也丢掉
        if (/^\s*(?:[-•*·]\s*)?$/.test(text)) continue;
        out.push(text.replace(/[ \t]+$/, ''));
    }
    return out.join('\n');
}

// ---------------------------------------------------------------------------
// 状态摘要
// ---------------------------------------------------------------------------

function isLoaded(v) {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    return !!s && s !== '未加载' && s !== '无' && s !== '—' && s !== '-';
}

/** 从 profile 里剥掉可能带的标签，只取值 */
function bare(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const i = s.lastIndexOf('|');
    return i >= 0 ? s.slice(i + 1).trim() : s;
}

/**
 * 意识状态那一行。
 *
 * ★ A3（2026-10-14）之后：那个状态值**由插件算**（档位 ＋ 孕周 ⇒ `store.js` 的 `awarenessStateOf`），
 *   推演引擎不用再读任何区间表。但主 API 确实需要一条**常识**：不可能刚着床就知道自己怀孕了 ——
 * 否则它会写出「玩家摸着肚子想，是不是有了」这种时间线错乱的正文。
 *
 * 所以这里不发规则表，只把**结论 + 一句写作约束**发过去。几行字解决，省下整张表。
 */
function awarenessLine(d5, ref = '') {
    const v = bare(d5);
    if (!v) return '';
    // ★ 2026-10-24（她定）：档位只做参考，状态只认剧情事件。
    //   参考说“可能开始留意”时，可以写起疑/观察，但不许写成已确认 ✓
    const tail = ref ? `（察觉参考：${ref}）` : '';
    // ⚠️ 这一段进**主 API**（写正文那个 AI 会读它）⇒ 两个坑都得避开：
    //   ① **不许写死性别代词「她 / 他」** —— 追踪对象可能是男性 / 扶她 / 单性种族，
    //      写了"她"就等于告诉主 API 这个角色是女的 ✗（要用「该角色」）
    //   ② **不许有 markdown 加粗** —— 主 API 是纯文本渲染，加了粗会在正文里冒出星号 ✗
    // 这三句是**系统按时间表给的参考**，不是硬规定 ——
    //   剧情提前发现时引擎该报 `awareness_event` 让它提前；万一引擎漏报了，
    //   主 API 这边也不该跟**已经写出来的正文**打架 ⇒ 统一挂一句"以正文为准" ✓
    //   （引擎那一侧的同类兜底在 `modules.js` 的【描写原则】："若角色行为与档位明显不符，
    //     以剧情表现为准" ✓）
    const FALLBACK = '（这是系统按时间表给的参考，跟已经写出来的正文冲突时以正文为准。）';
    if (/未察觉/.test(v)) {
        const canSuspect = /可能开始留意|可能会去确认|上限/.test(String(ref || ''));
        if (canSuspect) {
            return `意识状态：${v}`
                + '，该角色还没确认怀孕；按该角色的察觉档位，这个阶段可能开始留意身体变化、起疑'
                + '（可以写犯嘀咕、偷偷观察、拖着不去验），但不要直接下结论。'
                + tail + FALLBACK;
        }
        return `意识状态：${v}`
            + '，关键常识：该角色自己还不知道怀孕。不要安排其主动验孕、算月经推迟、'
            + '怀疑自己有了，也不要流露"最近怎么这么累"这类自觉联想；'
            + '身体变化可以客观存在，但该角色会归因成别的原因（累、吃坏了、天气）。'
            + tail + FALLBACK;
    }
    if (/怀疑/.test(v)) {
        return `意识状态：${v}`
            + '，该角色只是隐约觉得身体不太对（月经迟了、早上犯恶心），还没确认，'
            + '可以犹豫、可以拖着不去验，但不要直接下结论。'
            + tail + FALLBACK;
    }
    if (/已确认/.test(v)) {
        return `意识状态：${v}，该角色已经知道自己怀孕了，可以有相应的心理活动与决定。` + tail + FALLBACK;
    }
    return `意识状态：${v}` + tail;
}

/**
 * 算出这个对象的所有占位符取值。
 *
 * 关键：每一项都受**模块开关**约束 —— 模块关了，值就是空字符串，
 * 对应的那一行在模板里直接消失，绝不会"关了还在往主 API 发"。
 */
/**
 * 「孕 13 周+0 天」⇒ 91 天。认不出就返回 null（宁可少给这一个括号，也别猜数 ✓）。
 * 给它累计天数的理由：模型做「周加天」的进位老是错（13 周+0 加 7 天写成 13 周+2），
 * 而一个纯数字的加法它稳得多 ✓
 */
function pregDaysOf(sub) {
    const m = String(sub || '').match(/(\d+)\s*周(?:\s*[+＋]\s*(\d+)\s*天)?/);
    if (!m) return null;
    return Number(m[1]) * 7 + Number(m[2] || 0);
}

function targetVars(t) {
    const p = t.profile || {};

    // 敏感带这套的总开关是「身体敏感带记录」（「自定义」跟着它走 ✓ 见 settings.zonesFeatureOn）
    const zonesOn = zonesFeatureOn();
    const milkOn = isModuleOn('lactation_system') || isModuleOn('lactation_patch');
    const awarenessOn = isModuleOn('awareness');
    const periodOn = isModuleOn('period_system');

    // ★★ 只走**唯一那份判据** `isPregnant(t)`（它还会看「能不能怀孕」那把玩家锁）——
    //   这里以前自己重算一遍、不看锁 ⇒ 同一个 prompt 里主 API 收到「已孕」、
    //   而 pregnancy / conception / not_pregnant 那几道门控却按「未孕」走（自相矛盾 ✗）
    const pregnant = isPregnant(t);

    const vars = {};
    vars.name = displayName(t) || t.key;
    vars.isUser = t.isUser ? '（用户本人）' : '';
    // ★ 周期模式**按人** —— 这一段写的是"这个人"的月经/周期状态 ✓
    // ★★ 中性那套词是**两档共用**（非月经 / 无月经）——
    //   这里原来只认 'none' ⇒ 无月经的人会收到「月经状态：非经期（不适用 · —）」✗
    const noBleed = isNeutralMode(periodModeOf(t.key));

    // 进度是「—」时不要拼进句子里（不然会拼出「不适用 · —」这种）
    const clean2 = (v) => (v && v !== '—' ? v : '');
    if (pregnant) {
        // ★ 2026-10-27（她：起码得写孕周和天，括号里可以换算）：周和天照写，
        //   后面括号补一个累计天数 —— 模型加天数比"周加天进位"稳得多 ✓
        const days = pregDaysOf(p.sub);
        const subTxt = clean2(p.sub) + (days != null ? `（第 ${days} 天）` : '');
        const w = [subTxt, clean2(p.phase)].filter(Boolean).join(' · ');
        vars.pregnancy = `怀孕状态：已孕${w ? ' · ' + w : ''}（写正文之前的孕周）`;
        vars.menstruation = noBleed
            ? '周期状态：不适用（当前为孕期）'
            : '月经状态：不适用（当前为孕期）';
    } else {
        vars.pregnancy = '怀孕状态：未孕';
        // ★★ 2026-11-01（有玩家反馈：正文里一直在提「卵泡期 / 黄体期」这种，很出戏）——
        //   那些是给面板和判定看的术语，写正文的人不需要 ⇒ **主 API 这边不再发阶段名和周期进度**，
        //   它就没词可抄了 ✓（跟"敏感带去掉数字"同一个病根：源头不给，正文里就不会出现）
        //   ⚠️ 经期那几天照旧发「月经期 + 流量 / 痛经」：那是剧情里真的会发生的事，模型要知道 ✓
        //   ⚠️ 无月经 / 非月经档整行不发（她们没有"经期"这回事，发了只会让模型去编）
        if (noBleed) {
            vars.menstruation = '';
        } else if (periodOn && t.period && (t.period.day || t.period.flow)) {
            vars.menstruation = `月经状态：月经期 · ${t.period.day || ''}`
                + (t.period.flow ? ` · 流量${t.period.flow}` : '')
                + (t.period.pain ? ` · 痛经${t.period.pain}` : '');
        } else {
            vars.menstruation = '月经状态：非经期';
        }
    }

    // ★ 2026-10-28（她：周期也要兼容主 API 的时间跳跃）——
    //   只给事实，外加一句"怎么用这个数"：主 API 只要拿跳过天数跟"距今"比一下大小，
    //   就知道这一跳里来过没有 ⇒ 不用它算余数、也不用它猜日子 ✓
    //   ⚠️ 为什么写在同一行里、不另起一条规则段：这件事只跟这一行有关，
    //     单独铺一段就是让一件小事占掉一整块提示词（她 2026-10-28 点过我"把简单的事做复杂" ✗）
    vars.nextPeriod = (() => {
        if (!periodOn || pregnant) return '';
        try {
            const np = nextPeriodFactOf(t.key);
            return np
                ? `预计下次月经：${np.date}（距今 ${np.days} 天；这一轮要是把时间跳到第二天或更晚、`
                    + `跳过的天数不小于这个数，说明这一跳里来过，正文照常写，别写「第几天」这类数）`
                : '';
        } catch { return ''; }
    })();

    // ★★ 2026-10-24（她定的）：胎儿这一行**只发 胎数 / 同卵异卵 / 每胎性别 / 致孕方** ——
    //   显性 / 隐性 / 天赋 / 强度一概不发（那是面板与出生后孩子账本的事）；
    //   孕周在「怀孕状态」那一行里已经有了，这里不重复 ✓
    vars.fetus = (pregnant && isFieldOn('d6')) ? (() => {
        try {
            const brief = fetusBriefText(t.key);
            return brief ? `胎儿状态：${brief}` : '';
        } catch { return ''; }
    })() : '';

    // ★★ 2026-10-26（她定的）：**预产期也发给主 API** ——
    //   理由：不少模型对时间没有概念，不给它日期就会把孕期写成"漫长得看不到头"，
    //     或者预产期早过了还在写"再过几个月" ✗
    //   口径：**只给事实**（日期 ＋ 还有几天 / 已过几天），不给"所以现在该显怀 / 该生了"这种结论
    //     —— 判断一律留给模型按她写的设定做 ✓
    //   多胎各写各的（`子1 … · 子2 …`）；一个预产期都没有 ⇒ 整行为空（模板那行自己消失 ✓）
    //   ⚠️ 这个日期是插件按"今天 ＋ 剩余孕期"现算的，不是模型能改的格 ✓
    vars.due = (pregnant && isFieldOn('d6')) ? (() => {
        try {
            const marks = dueMarksOf(t.key);
            if (!marks.length) return '';
            // ★ 同一天的那几胎并成一条（`子1、2、3`）—— 三行说的是同一件事，念一遍就够 ✓
            const groups = mergeDueByDate(marks);
            const parts = groups.map((g) => {
                const head = (g.fetus.length && (groups.length > 1 || g.fetus.length > 1))
                    ? ('子' + g.fetus.join('、') + ' ') : '';
                const rel = g.late > 0 ? ('已过 ' + g.late + ' 天')
                    : (g.late === 0 ? '就是今天' : ('还有 ' + Math.abs(g.late) + ' 天'));
                return head + g.date + '（' + rel + '）';
            });
            return '预产期：' + parts.join(' · ');
        } catch { return ''; }
    })() : '';

    vars.milk = (milkOn && isFieldOn('d7') && isLoaded(p.d7)) ? `泌乳状态：${bare(p.d7)}` : '';
    vars.zones = (zonesOn && isFieldOn('d9') && isLoaded(p.d9)) ? `敏感带：${zonesWords(p.d9)}` : '';
    vars.birth = (isFieldOn('d8') && isLoaded(p.d8)) ? `生产次数：${bare(p.d8)}` : '';
    vars.impregnator = (isFieldOn('d4') && isLoaded(p.d4)) ? `致孕方：${bare(p.d4)}` : '';
    // ★ **没怀孕的对象不发这一行**。
    //   意识状态讲的是"怀了、但角色知不知道"，可这一行原来只看模块与字段开关，
    //   没怀孕的对象照样会被注入 —— 而模型给未孕对象写的 d5 很可能是「未察觉」，
    //   awarenessLine 就把它渲染成「该角色自己还不知道怀孕 / 不要安排其主动验孕…」
    //   ⇒ 主 API 拿到一堆对没怀孕角色毫无道理的约束（面板也会显示成那样）✗
    //   ⇒ 判据取当前对象：没孕 ⇒ 这一行整行不出现（跟「孩子」那一行同一个写法 ✓）
    vars.awareness = (() => {
        if (!(pregnant && awarenessOn && isFieldOn('d5') && isLoaded(p.d5))) return '';
        let ref = '';
        try { ref = awarenessReferenceForPrompt(t.key) || ''; } catch { ref = ''; }
        return awarenessLine(p.d5, ref);
    })();
    // ★ row123 都发：这个其实对剧情有帮助 ✓
    //   以前只有 row3 会进状态摘要 ⇒ 现在三条都发（row1 生理状态 / row2 身体状况 / row3 近期性行为）
    vars.physio = (isFieldOn('row1') && isLoaded(p.row1)) ? `生理状态：${bare(p.row1)}` : '';
    vars.body = (isFieldOn('row2') && isLoaded(p.row2)) ? `身体状况：${bare(p.row2)}` : '';
    // ★★ 体内精液那几句**只写在状态条里**（2026-10-23）——
    //   推演按档位把这一档写进 row1 / row2，主 API 从这两行读；
    //   原来这里还会把同一档的那句再贴一遍，同一件事在摘要里出现两份
    //   （旧的那句 ＋ 我们补的这句），它就把我们补的那句当成交的成品 ✗
    //   ⇒ 现在这里一句都不补，同一条事实只留一份 ✓
    // ★★ 身体痕迹给主 API 的**唯一一条** ——
    //   完整规则只发推演（traces / row2 / cot 那些只有推演需要吃）；
    //   这里只把"当前痕迹 ＋ 不许凭空编"贴在同一个句子里 ⇒
    //   口径：身体插件判定受伤、剧情里却啥事没有，那不行；
    //   要严格按照插件给的数据来算，不能私自瞎编
    //   ⚠️⚠️ 约束的边界（别再写过头 ✗）：
    //     **只能禁"凭空编出没记过的旧痕迹"这一件事**。正文里的新痕迹、加重、
    //     以及**外物处理**（清洗 / 抹药 / 治愈魔法 / 遮挡）都必须照写 ——
    //     推演正是从剧情里读 intervention 那一档的；写成"谁来消退由系统算"
    //     等于把这条通路锁死 ✗（那样就锁死了正文里用外物消退的可能性 ✓）
    //   ⚠️ **身上没痕迹时整行消失**（渲染层现成机制），所以没开追踪的人一个字符都不花 ✓
    //   ⚠️ 关掉追踪的人身上可能还留着旧数据 ⇒ 这里也看 traceOnOf，跟模块一个口径 ✓
    //   ★★ 2026-10-15（世界观那条关着，人物那里的开关还会不会让两个 API 看见？）——
    //     **总开关关着一律不发**：原来这里只看"按人开关"⇒ 那个人身上只要还有旧痕迹
    //     （或手动加过一条），主 API 照样会收到这一行 ✗ ⇒ 加上 isModuleOn('body_trace') ✓
    let tracesTxt = '';
    try { tracesTxt = (traceOnOf(t.key) && isModuleOn('body_trace')) ? tracesForPrompt(t.key) : ''; } catch { tracesTxt = ''; }
    vars.traces = tracesTxt
        ? `身体痕迹：${tracesTxt}（系统当前的记录。唯一的要求是不要凭空写出这份记录里没有的旧痕迹；`
            + '剧情里真出现了新痕迹、或者角色做了处理（清洗、抹药、治愈魔法等），照实写就行，系统会跟着更新）'
        : '';
    // ★ 2026-10-26：从别的档**仅状态**导入的对象，这一行里的日期属于另一条时间轴 ⇒
    //   发给主 API 之前把日期去掉（不然它会写"都在 9 月中旬"这种旧存档时间 ✗）
    vars.recentSex = (isFieldOn('row3') && isLoaded(p.row3))
        ? `近期性行为：${bare((t && t.imported === true) ? stripDateText(p.row3) : p.row3)}`
        : '';

    return vars;
}

function buildStateText(targets) {
    const T = templates();
    const blocks = [];
    for (const t of targets) {
        const vars = targetVars(t);
        const block = renderTemplate(T.targetBlock, vars).trim();
        if (block) blocks.push(block);
    }
    if (!blocks.length) return '';
    const head = String(T.stateHeader || '').trim();
    const foot = String(T.stateFooter || '').trim();
    // ★ 「把当前时间也发给主 API」（默认关）——
    //   一整段时间轴只发一行（按人重复没有意义 ✓）。
    //   为什么要有：剧情里压根不写时间的卡，主 API 只能靠猜；开了这行它才有时间可用（保底 ✓）
    //   ⚠️ 钟点那档是「不记钟点」时 `storyDateTimeNow()` 只给日期，照样能发 ✓
    let timeLine = '';
    try {
        if (settings().sendTime) {
            const now = storyDateTimeNow();
            if (now) timeLine = `当前时间：${now}`;
        }
    } catch { timeLine = ''; }
    // ★★ 2026-10-27（她：主 API 在时间快进时不算快进后的孕周）——
    //   快进是正文里写的，插件发提示词时还停在旧日期 ⇒ 这一轮的孕周只有主 API 自己加得出来；
    //   插件等回包后按它报的跨度落账，下一轮状态摘要里的孕周才是准的（所以这句写了"临时值" ✓）。
    //   ⚠️ 不写换算表（一个月 30 天那种）—— 那等于拿人历套到自定义世界上（她会否 ✗）；
    //      有日期按日期算、没日期按正文说法算，这两条都不写死单位 ✓
    //   ⚠️ 不给"算不清就算了"的出口 —— 那等于教它偷懒（她 2026-10-27 指出的 ✓）
    let skipLine = '';
    try {
        if (targets.some((t) => isPregnant(t))) {
            skipLine = '【时间跳到第二天或更晚】这一轮正文如果把时间跳到了第二天或更晚，跳过几天就直接把天数加到孕周上：'
                + '7 天算一周、不满一周的按天算（孕 20 周+0 天是第 140 天，加 7 天就是孕 21 周+0 天、第 147 天）。'
                + '不要倒推一个起点，也不要写「从几周推到几周」。'
                + '写正文之前先把这三步写出来：第 A 天 ＋ 跳过天数 ＝ 第 B 天 ＝ 孕 X 周+Y 天。'
                + '正文按加完的孕周写，显不显怀和反应轻重也按它。'
                + '这个孕周只是这一轮的临时值，下一轮以状态摘要里系统算好的为准。'
                + '正文没说跳到第二天，孕周照旧。';
        }
    } catch { skipLine = ''; }
    return [head, timeLine, blocks.join('\n\n'), skipLine, foot].filter(Boolean).join('\n\n').replace(/[ \t]+$/gm, '') + '\n';
}

// ---------------------------------------------------------------------------
// 沉浸类模块
// ---------------------------------------------------------------------------

function buildPatchText(targets) {
    const T = templates();
    const chunks = [];
    const primary = targets[0] ? (displayName(targets[0]) || targets[0].key) : '';
    // 模块原文写的是 {{user}}。追踪对象不一定是玩家本人，所以这里要换成真名：
    //   · 只有一个对象 → 直接用它的名字
    //   · 多个对象     → 用「该对象」，并在抬头说明对每个对象都适用
    const globalWho = (targets.length === 1 && primary) ? primary : '该对象';
    const localize = (text, who) => String(text || '')
        .replace(/\{\{\s*user\s*\}\}/gi, who)
        .replace(/\{\{\s*char\s*\}\}/gi, who);

    // ★ 异种口径：名单里有没有异种 ⇒ 决定 `@@IF_XENO@@` 走哪半边
    //   （全局模块一次只发一份 ⇒ 名单级判据，和 judge.js 那边同一套 ✓）
    const hasXeno = targets.some(isXeno);

    for (const m of MODULES) {
        const role = moduleRole(m.id);
        if (role !== 'main' && role !== 'both') continue;
        if (!moduleActive(m.id, targets)) continue;

        if (moduleScope(m.id) === 'global') {
            // ★ 周期模式按人：含周期占位符的模块 ⇒ **按档各发一份**（最多两份 ✓）
            //   和推演那边（judge.js）同一套规矩 ✓
            if (isCycleDependent(m.id)) {
                // ★★ 周期模式三档（normal / none / amenorrhea），"非月经"与"无月经"共用中性词
                //   ⇒ 按 isNeutralMode 判，别写死两档（名单全是无月经时会出现"一份都不发" ✗）
                const GROUPS = [];
                if (targets.some(t => periodModeOf(t.key) === 'normal')) GROUPS.push(['normal', '有月经的对象']);
                if (targets.some(t => periodModeOf(t.key) === 'none')) GROUPS.push(['none', '非月经的对象']);
                // ★★ 2026-10-16：第三档（无月经＝没有周期）单独发一份，别并进"非月经" ✗
                if (targets.some(t => periodModeOf(t.key) === 'amenorrhea')) GROUPS.push(['amenorrhea', '无月经的对象']);
                for (const [mode, label] of GROUPS) {
                    const text = localize(moduleText(m.id, null, mode, hasXeno), globalWho);
                    if (text) chunks.push(renderTemplate(T.patchItem, { name: `${m.name}（${label}）`, text }));
                }
                continue;
            }
            const text = localize(moduleText(m.id, null, null, hasXeno), globalWho);
            if (text) chunks.push(renderTemplate(T.patchItem, { name: m.name, text }));
            continue;
        }

        // ★★ **按"改没改过"决定发几份** ——
        //   和推演那边（judge.js）**同一套分组算法**，别两处各写一份 ✗
        for (const g of patchSendGroups(m.id, targets)) {
            // 这一组只有一个人 ⇒ 正文里还能点他的名；多个人共用一份时写「该对象」✓
            const nm = g.targets.length === 1 ? (displayName(g.targets[0]) || g.targets[0].key) : globalWho;
            const text = localize(g.text, nm);
            if (!text) continue;
            // ★ 中性那套词（非月经 / 无月经）共用一份正文 ⇒ 标题别写错档 ✗
            const tier = isCycleDependent(m.id)
                ? (g.mode === 'amenorrhea' ? '无月经的对象'
                    : (isNeutralMode(g.mode) ? '非月经的对象' : '有月经的对象')) : '';
            const suffix = patchGroupSuffix(g, (t) => displayName(t) || t.key, tier);
            // 专属那一份（只有一个人）照旧走 `patchItemTarget` 模板 —— 它把「模块名 · 对象：XX」
            //   拆成两个占位符，玩家自己改过这个模板的话要照样生效 ✓
            if (!g.shared && g.targets.length === 1) {
                chunks.push(renderTemplate(T.patchItemTarget, { name: m.name, target: nm, text }));
            } else {
                chunks.push(renderTemplate(T.patchItem, { name: patchBlockTitle(m.name, suffix), text }));
            }
        }
    }

    if (!chunks.length) return '';
    const head = String(T.patchHeader || '').trim();
    const body = chunks.join('\n\n');
    // ★ 人物级模块的正文里写的是**字面的「该对象」**（契约不再点名，是它自己的写法）
    //   ⇒ 主 API 这边必须解释它指谁，否则模型会读到一句没头没尾的「该对象」✗
    //   判据跟着**正文里实际出现没出现**走，不跟着对象个数走 ✓：
    //     · 多个对象 ⇒ 指的是名单里每一个对象（全局模块那一份就是这么用的）
    //     · 只有一个 ⇒ 指的就是这一个角色（它的块标题里已经写着名字）
    const note = !body.includes('该对象') ? ''
        : (targets.length > 1
            ? '（下面的「该对象」指的是追踪名单里的每一个对象，请分别套用）'
            : '（下面的「该对象」指的就是这一个角色）');
    return [head, note, body].filter(Boolean).join('\n\n').replace(/[ \t]+$/gm, '') + '\n';
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 本轮该注入哪些对象 */
export function injectTargets() {
    const s = settings();
    // ★★ 2026-10-22：**轻档一律不注入** —— 轻档只有名字和种族、没有任何身体账，
    //   注进去就会给主 API 一段「怀孕状态：未孕 / 生理状态：等待第一次状态推演」的空壳（她截图报的）。
    //   判据跟推演名单、「轻档不进快照」同一套：`t.light === true` ⇒ 跳过；
    //   有了身体事实会自己升格成正式档，到那时才回来 ✓
    const all = targetList().filter((t) => t.light !== true);
    if (!all.length) return [];
    if (s.injectScope === 'all') return all;
    if (s.injectScope === 'active') {
        const key = state().active;
        const a = all.find(t => t.key === key);
        return a ? [a] : all.slice(0, 1);
    }
    // present：本轮推演判定为出场的对象（默认）
    const present = all.filter(t => t.present !== false);
    return present.length ? present : all;
}

export function rebuildInjection() {
    clearInjection();

    // ⚠️ 被酒馆禁用时**绝不再注入**。
    //   这一条是必须的：酒馆禁用扩展**不重载页面**，插件的 JS 还在跑，
    //   而 `GENERATION_STARTED` 那个处理器会在每次生成前调这里的 rebuild ——
    //   于是"定时清一次"永远会被它覆盖回来，提示词照发不误。
    //   把判断放这里 = 所有调用点自动失效，不用一个个去堵。
    if (isMyExtensionDisabled()) return;

    // ★★ 被排除的角色卡：**一个字都不注入**（2026-10-28）——
    //   判断放在这里的原因跟上面那条一模一样：所有调用点自动失效，不用一个个去堵 ✓
    //   （`clearInjection()` 已经在第一行跑过 ⇒ 这里 return 就等于"干净的空手" ✓）
    if (isCardExcluded()) return;

    const s = settings();
    if (!s.enabled || !s.injectToMain) return;

    const targets = injectTargets();
    if (!targets.length) return;

    // ★ 状态摘要：**每轮都在变** ⇒ 走尾巴注入（不然它后面的全部内容都不吃缓存 ✗ 见 putTail 的说明）
    //   ⚠️ 深度是 STATE_DEPTH（2），不是 0 —— d0 让给预设的破限条目 ✓
    const stateText = buildStateText(targets);
    if (stateText) putTail(KEY_STATE, substitute(stateText));

    // ★ 状态摘要的用法说明：基本不变 ⇒ 系统段（每轮都发，但它不动，不伤缓存 ✓）
    const ruleText = String(templates().stateRule || '').trim();
    if (ruleText) put(KEY_RULE, substitute(ruleText));

    const patchText = buildPatchText(targets);
    if (patchText) put(KEY_PATCH, substitute(patchText));

    // ★ 孩子（默认关）：开了才发，而且**只给主 API** ✓
    const kidsText = buildChildrenText(targets);
    if (kidsText) put(KEY_CHILDREN, substitute(kidsText));
}

/**
 * ★「孩子」那一段 ——**只给主 API**、而且**默认关** ✓
 *
 * 口径：只存插件内、不发给主 API（但可以给一个选项，发送给主 API，默认关闭）；
 *      遗传能力要发，不然细节对不上 ✓
 *
 * ⚠️ 这是**提示词** ⇒ 三条硬规矩照旧：不许出现「插件」二字、不许 markdown 加粗、
 *   不许描述性破折号 ✓（断言会扫这里 ✓）
 * ⚠️ 空的时候返回空串（开关关着 / 没孩子 ⇒ 一个字都不发 ✓）
 *
 * ★★ 每一行都是**"谁的孩子"**，所以跟"这一轮追了几个对象"无关：
 *   只需要发孩子信息，加上孩子的父母（或者其他称呼都可以）能力、出生日、
 *   年龄就行；至于其他追踪对象，跟他们没关系 —— 发送信息的是孩子，别被他们影响 ✓
 *   ⇒ 别加"追踪对象多于一个就整段不发"（怕主 API 把甲的孩子读成乙的）：
 *     孩子天生挂在某个对象名下、每行开头就写着那个人的名字，
 *     根本不会被别的追踪对象影响 ✗ ⇒ 每个对象各发各自的孩子（和状态摘要同一套规矩 ✓）
 */
function buildChildrenText(targets) {
    try {
        if (!childrenToMain()) return '';
        if (!Array.isArray(targets) || !targets.length) return '';
        const lines = [];
        for (const t of targets) {
            const nm = displayName(t) || t.key;
            const kids = childrenOf(t.key);
            if (!kids.length) continue;
            const now = storyDateNow();
            for (const c of kids) {
                const bits = [];
                // ★ 只发这几样：**父母（另一个亲代）+ 出生日 + 年龄** 就够 ✓
                //   （性别 / 种族 / 遗传能力这些"额外的"不再发 —— 写正文用不到，省 token ✓）
                const age = childAgeText(c.birthDate, now);
                if (age) bits.push(age);
                if (c.birthDate) bits.push('生于 ' + c.birthDate);
                if (c.other) bits.push('另一个亲代 ' + c.other);
                lines.push(`- ${nm}的孩子：${String(c.name || '').trim() || '还没起名字'}（${bits.join('，')}）`);
            }
        }
        if (!lines.length) return '';
        return '【已经出生的孩子】\n' + lines.join('\n') + '\n（这些是已经记下来的事实，不要改孩子的名字与出生日期）';
    } catch { return ''; }
}

/** 给设置界面预览用：把当前会发出去的东西原样渲染出来 */
export function previewInjection() {
    const targets = injectTargets();
    return {
        state: targets.length ? buildStateText(targets) : '（没有追踪对象）',
        // ★ 用法说明跟着沉浸设定一起走系统段 ⇒ 预览里并成一段展示（她靠预览验收 ✓）
        patch: targets.length
            ? [String(templates().stateRule || '').trim(), buildPatchText(targets)].filter(Boolean).join('\n\n')
                || '（空）'
            : '（没有追踪对象）',
        children: targets.length ? (buildChildrenText(targets) || '（没开，或者这个对象还没有孩子）')
            : '（没有追踪对象）',
    };
}
