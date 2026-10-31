/**
 * stages.js —— 「阶段插图」（面板**「透视」频道那一页**，不放在概览 ✓）
 *
 * 定的形态（管着这里所有取舍）：
 *   · 是**插画**，不是状态指示灯 ⇒ 一次只显示**一张**，不并列（明确不是窄图 ✓）
 *   · 五个状态各一张画，外加「普通的一天」用文字顶（数过是五个，
 *     最后定的是**五个**：精子在场 / 卵子在场 / 两者都在 是**三种不同画面** ✓）
 *   · 全部由**现有数据**推出来 —— 不为它新增任何契约字段 ✓
 *   · 图没到之前显示**文字版**（尺寸位置一样，图到了直接换，代码不用改 ✓）
 *   · 跟着「当前正在查看的那个对象」走（跟受孕记录 / 成就一个口径 ✓）
 *
 * ⚠️ 为什么推导放**外壳**、不放在面板里：
 *   面板只拿得到"序列化之后的面板文字"，精子存活 / 受精判定 / 着床这些数据它看不见
 *   ⇒ 外壳算好一个 stage 键推给它，它只负责画 ✓（和"写操作只能走外壳"同一条纪律）
 *
 * ⚠️ 面板**不认识** stage 键的语义 —— 名字和一句话都由这里给（STAGE_TEXT）✓
 *   这样以后改文案只动这一处，不用去大 HTML 里翻。
 */

import { settings } from './settings.js';
import { stageImages, stagesOn, stageTextOverride, termNameOf, isNeutralMode, stageTextOnly, borrowOnFor, borrowFromFor, stageFetusOn, stageCuts } from './settings.js';
import { state, getOvuJudgment, viableFertility, periodModeOf, cycleDayNum, SPERM_TIERS, vaginaLoadTierOf, wombLoadTierOf, pregnancyStateForPrompt, pregDaysOf, listAlerts, currentDate, fetusPlanOf, pregnantNowOf } from './store.js';
import { diffDays } from './fiction-date.js';
import { isPregnant, hasSperm } from './prompt.js';

/**
 * 孕期那张图该出场了没 —— 2026-10-23 定稿（她的口径）
 *
 * **着床有它自己那张配图**：刚着床那几天要显示「着床」那张（并且保留子宫层），
 * 不能被孕期那张盖掉、更不能提前显示胚胎。
 * ⇒ 判据：已孕 **且胎儿那边已经有数据**（有胎数计划，或孩子格已经写着内容）。
 *   胎儿数据还没出来 ⇒ 继续显示着床那张 ✓
 */
function pregnancyArtReady(k, t) {
    try {
        if (!isPregnant(t)) return false;
        // ★★ 2026-10-23（她报：刚着床内视图就有胚胎）——
        //   切孕那一轮胎数 / 性别还没掷（`fetusPlanPending`）⇒ 继续用「着床」那张＋子宫层。
        //   这个判据必须读**插件自己的结构**，不能只读 d6：d6 是模型能写的字段，
        //   它这一轮会自己编「单胎（女），孕3周，胚胎已完成着床…」✗
        if (t?.fetusPlanPending === true) return false;
        if (fetusPlanOf(k)) return true;
        const d6 = String(t?.profile?.d6 || '').trim();
        return !!d6 && !/^无/.test(d6) && d6 !== '—';
    } catch { return false; }
}


/**
 * 设置页里那六个槽位的排列顺序：按事情推进的顺序排，「普通的一天」放最后 ✓
 * （别直接把 STAGE_KEYS 当显示顺序用 —— 那个是按"优先级从低到高"写的 ✗）
 */
export const STAGE_ORDER = ['egg', 'sperm_only', 'sperm_egg', 'fertilized', 'implanted', 'daily'];

/**
 * 「卵子在场」的阶段 = 排卵窗口（排卵日 + 前后各一天）。
 * ⚠️ 用 phaseId 判（稳定身份 ✓），不靠中文阶段名 ✗（和 prompt.js 的 isMenstruating 同一条纪律）
 */
export const EGG_PHASES = ['ovulation', 'ovulationDay'];

/**
 * 没图时面板显示的文字版；也是「？」弹窗里那份说明的底 ✓
 *
 * ⚠️⚠️ **这是一套模板，不是最终文字** —— 里面的 `{ovum}` / `{ovuDay}` 由
 *   `stageTextOf(stage, mode)` 按**术语表**替换掉：
 *     有月经模式 ⇒ 卵子 / 排卵日；非月经模式 ⇒ 生殖细胞 / 受孕高峰日 ✓
 *   （补这一层的原因：非月经模式怀孕一开始被漏了 ✗
 *     —— 文字写死的话，非月经模式下会冒出"排卵日" ✗✓）
 *   ⇒ 好处：把「生理期名字」那张表里的词改了之后，插图**跟着变** ✓✓
 *
 * ⚠️ 字段叫 `title` **不叫 `name`** —— 和成就那条同一个理由：
 *   自测脚本 有一条"不许出现硬编码中文人名"的断言是按 `name: '两个汉字'`
 *   扫的 ⇒ 阶段名写进 `name:` 会被它当成可疑人名顶红 ✗（成就那边早踩过同一条 ✓）
 * ⚠️ 这里**不许**用破折号（界面文案里的破折号读起来费劲 ✗）
 */
export const STAGE_TEXT = {
    daily:      { title: '普通的一天',       line: '这一刻既没有{ovum}，也没有在游的精子' },
    egg:        { title: '{ovuDay}',         line: '{ovum}已经{ovumOut}，正在等' },
    sperm_only: { title: '精子存活中',       line: '体内还有精子在游，但这一刻没有{ovum}' },
    sperm_egg:  { title: '精子游向{ovum}',   line: '{ovum}在场，精子正游过去' },
    // ★ 例子里画的本来是卵子被精子钻入，实则是受精 ✓：
    //   这一档的**层名 / 设置页槽位名都是「受精」**，透视块那句却写成「卵子被精子钻入」
    //   ⇒ 同一件事两个词（"同一处必须一直用同一个词"）✗ ⇒ 标题改成**受精** ✓
    fertilized: { title: '受精', line: '精子已经钻进去了，正在等着床' },
    implanted:  { title: '着床',             line: '胚泡已经进入子宫，正在着床' },
};

/**
 * ★★ 2026-10-16（无月经那一档也要有自己的说法，并让我去写；
 *   写完之后玩家指着其中几句点回来）——
 * 「无月经」那一档有自己的默认说法 ✓，但**第一版我把"给模型看的注解"写进文案里了** ✗
 *   （「这一档没有『卵』这个概念」「按剧情与设定描写」这种是规则说明，不是界面该说的话 ✗）。
 * ⇒ 规矩：面板上这两行只写**这一刻是什么状态**（跟别的档同一个口吻 ✓），
 *   机制说明一个字都不许进来 ✗ —— 不提"这一档"、不提"按什么描写"、不提"没有某个概念" ✓
 */
const STAGE_TEXT_NO_CYCLE = {
    daily:      { title: '普通的一天',     line: '这一刻没有特别的变化' },
    egg:        { title: '受孕时机',       line: '时机到了' },
    sperm_only: { title: '精子存活中',     line: '体内还有精子在游，正往更深处移动' },
    sperm_egg:  { title: '精子游向深处',   line: '精子正在往更深处游' },
    fertilized: { title: '受精',           line: '精子已经钻进去了，正在等着床' },
    implanted:  { title: '着床',           line: '胚泡已经进入子宫，正在着床' },
};

/**
 * 某个状态最终该显示什么字（给面板 / 设置页 / 预览用 ✓）
 *
 * 优先级：**玩家改过的** > 模板 + 术语表 ✓
 * @param {string} stage
 * @param {'normal'|'none'|'amenorrhea'|null} [mode] 这个对象的周期模式（不传 = 全局默认档）
 */
export function stageTextOf(stage, mode, view = null) {
    const key = STAGE_TEXT[stage] ? stage : 'daily';
    // ★ 2026-10-16：**三档各留自己的 mode**（原来把无月经并进 'none' ⇒
    //   它在"这一档的文字"里改的永远读不到 ✗ 见 settings.js 的 stageTextBucket ✓）
    const m = (mode === 'amenorrhea') ? 'amenorrhea' : (isNeutralMode(mode) ? 'none' : 'normal');
    // ★★ 2026-10-17：**图版和文字版各存各的**（为什么图片阶段和文字阶段的标题是共享的）——
    //   不传就看现在选的是哪一档显示方式（面板那条路就是这么走的 ✓）
    const v = (view === 'text' || view === 'image') ? view : (stageTextOnly() ? 'text' : 'image');
    // ★ 默认那份：无月经用它自己那张表（不依赖周期 ✓）
    const base = (m === 'amenorrhea') ? (STAGE_TEXT_NO_CYCLE[key] || STAGE_TEXT[key]) : STAGE_TEXT[key];
    // ① 玩家改过的优先
    let own = null;
    try { own = stageTextOverride(m, key, v); } catch { own = null; }
    if (own) return { title: own.title || expand(base.title, m), line: own.line || expand(base.line, m) };
    // ② 默认：模板 + 术语表
    return { title: expand(base.title, m), line: expand(base.line, m) };
}

/** 把模板里的占位符按这一档的术语表换掉 ✓ */
function expand(s, mode) {
    const ovum = termNameOf('ovum', mode);
    const ovuDay = termNameOf('ovulationDay', mode);
    // 「排出」只在有月经那一档说；中性那两档用「就位」这个中性说法 ✓
    const ovumOut = isNeutralMode(mode) ? '就位' : '排出';
    return String(s || '')
        .split('{ovum}').join(ovum)
        .split('{ovuDay}').join(ovuDay)
        .split('{ovumOut}').join(ovumOut);
}

/**
 * 内置图（画好之后：把文件放进 `assets/stages/`，再把这里的文件名填上就行 ✓）
 * ⚠️ 现在**全是空的** ⇒ 面板显示文字版（图还没画好时用文字代替 ✓）
 * ⚠️ 也可以在设置页「阶段插图」里逐张上传（那条路完全不改代码 ✓）
 */
export const BUILTIN_STAGE_FILES = {
    daily: '', egg: '', sperm_only: '', sperm_egg: '', fertilized: '', implanted: '',
};

// ---------------------------------------------------------------------------
// ★★ **分层合成**（2026-10-18 起：底图＝阴道，子宫是一张透明层）
//
// 形态（朋友 2026-10-18 交的那套图就是照这个画 ✓）：
//   · **底图**：阴道，按**阴道的精液量**分六档（空 / 残留 / 少 / 中 / 多 / 满），不透明 jpg
//   · **子宫层**：透明底 png，按**子宫里的精液量**分同样的六档，盖在底图上
//   · **孕期底图**：孕期1 到 孕期5 五张，按孕周选（整张图、本身就带胎儿 ✓）
//   · **叠加层**：精子 / 卵子 / 精子游向卵子 / 受精 / 已着床，透明底 png
//
// ⚠️ 精子和精液是**两张账**（点清的 ✓）：
//   精子 ⇒ 精子存活期（好几天）；精液 ⇒ 六档，而且**阴道一本、子宫一本**（见 store.js ✓）
// ⚠️ 为什么阴道是底图、子宫是层：朋友就是：阴道 六张 jpg（整幅）＋ 子宫 六张 png（透明）✓
//   ⇒ 两套同一张 1200×900 画布，直接叠，不用算坐标 ✓
// ---------------------------------------------------------------------------

/** 叠加层的顺序＝**从下往上**画（子宫那一层由 `WOMB` 单独管，见 compose ✓） */
export const STAGE_LAYERS = ['sperm', 'egg', 'sperm_egg', 'fertilized', 'implanted'];

/** 层的名字（设置页 / 诊断用 ✓） */
export const STAGE_LAYER_LABEL = {
    sperm: '精子', egg: '卵子', sperm_egg: '精子游向卵子',
    fertilized: '受精', implanted: '着床',
};

/**
 * 孕期的五个档（朋友画的「孕期1」到「孕期5」✓）。
 * 按**孕周**选（插件内部本来就按孕周算 ✓），分界：≤8 周 / ≤16 / ≤24 / ≤32 / 更多
 */
export const PREGNANT_STAGES = [1, 2, 3, 4, 5];
export const PREGNANT_WEEK_CUTS = [8, 16, 24, 32, 40];

/** 孕周 ⇒ 该用孕期第几张（按**比例**分：拿不到总孕期才退回绝对周数 ✓） */
export function pregnantStageOf(weekDays, totalDays = null) {
    // ⚠️ `Number(null) === 0` ⇒ 不先挡掉的话"拿不到孕周"会算成第 1 张 ✗
    if (weekDays === null || weekDays === undefined || weekDays === '') return 3;
    const d = Number(weekDays);
    if (!Number.isFinite(d)) return 3;
    // 按：已孕天数 ÷ 这一胎总孕期的百分比分档（分界可自定义 ✓）
    //   人类 40 周 + 默认 20/40/60/80 ⇒ 正好是 8 / 16 / 24 / 32 周（跟以前一致 ✓）
    //   异种孕期更长 ⇒ 自动铺开，不会过了 32 周就一直停在第 5 张 ✓
    const total = Number(totalDays);
    if (Number.isFinite(total) && total > 0) {
        const cuts = stageCuts();
        const pct = (d / total) * 100;
        for (let i = 0; i < cuts.length; i++) if (pct <= cuts[i]) return PREGNANT_STAGES[i];
        return PREGNANT_STAGES[PREGNANT_STAGES.length - 1];
    }
    // 拿不到总孕期 ⇒ 退回按绝对周数
    const weeks = d / 7;
    for (let i = 0; i < PREGNANT_WEEK_CUTS.length; i++) {
        if (weeks <= PREGNANT_WEEK_CUTS[i]) return PREGNANT_STAGES[i];
    }
    return PREGNANT_STAGES[PREGNANT_STAGES.length - 1];
}

/**
 * 这一胎的**总孕期天数**（从"预产期提醒"反推：已孕天数 ＋ 到预产期还剩几天）。
 * 拿不到（没定过预产期 / 没有剧情日期）⇒ null ⇒ 退回绝对周数 ✓
 */
function totalGestDaysOf(key) {
    try {
        const due = (listAlerts() || []).find((a) => a && a.kind === 'due'
            && String(a.target || '') === String(key || ''));
        if (!due || !due.date) return null;
        const now = String(currentDate() || '');
        if (!now) return null;
        const left = diffDays(now, due.date);            // 还剩几天（过了预产期会是负数）
        const preg = Number(pregDaysOf(key));
        if (!Number.isFinite(left) || !Number.isFinite(preg) || preg <= 0) return null;
        const total = preg + left;
        return total > 0 ? total : null;
    } catch { return null; }
}

/**
 * ★★ 已经放进仓库的内置图（2026-10-18 起：朋友那套拆分好的图已经按这张表命名放好了 ✓）
 *
 * ⚠️ 文件名是**英文**、中文对照见同目录 README.md：
 *   阴道 空/残留/少/中/多/满 ⇒ `vagina_*.webp`
 *   子宫 空/残留/少/中/多/满 ⇒ `womb_*.webp`
 *   孕期1~5 ⇒ `pregnant_1..5.webp`
 *   ⚠️ 2026-10-18 统一转成**无损 WebP**（像素一模一样，省 29%，因为插件要上传发布 ✓）
 *   ⚠️ 换图时**照原名覆盖**就行，机制这边一行都不用改 ✓
 */
export const BUILTIN_VAGINA_FILES = {
    empty: 'vagina_empty.webp', residue: 'vagina_residue.webp', low: 'vagina_low.webp',
    mid: 'vagina_mid.webp', many: 'vagina_many.webp', max: 'vagina_max.webp',
};

/** 子宫那一组（透明底，按子宫里的精液量分档 ✓） */
export const BUILTIN_WOMB_FILES = {
    empty: 'womb_empty.webp', residue: 'womb_residue.webp', low: 'womb_low.webp',
    mid: 'womb_mid.webp', many: 'womb_many.webp', max: 'womb_max.webp',
};

/** 孕期那五张（按孕周选，见 `pregnantStageOf` ✓） */
export const BUILTIN_PREGNANT_FILES = {
    1: 'pregnant_1.webp', 2: 'pregnant_2.webp', 3: 'pregnant_3.webp',
    4: 'pregnant_4.webp', 5: 'pregnant_5.webp',
};

/** 五张叠加层的内置文件 ✓ */
export const BUILTIN_LAYER_FILES = {
    sperm: 'sperm.webp',
    egg: 'egg.webp',
    sperm_egg: 'sperm_egg.webp',          // 精子游向卵子（复合图：两者都在时优先用它 ✓）
    fertilized: 'fertilized.webp',
    implanted: 'implanted.webp',
};

/** 三类图在玩家存档里的键名（跟叠加层分开，免得撞名 ✓） */
export function vaginaKeyOf(tier) {
    return 'vagina_' + String(tier || 'empty');
}

export function wombKeyOf(tier) {
    return 'womb_' + String(tier || 'empty');
}

export function pregnantKeyOf(n) {
    return 'pregnant_' + String(n || 3);
}

/**
 * 一层 / 一张底图这一刻该用哪个地址（玩家填的 > 另一档填的 > 内置 > 空 ✓）
 * ⚠️ 两个键**不是同一个**：玩家存档那边底图叫 `vagina_档位` / `womb_档位`，而内置表是按**档位**存的
 *   ⇒ 必须分开传，别拿一个去查另一个 ✗
 *
 * ★★ 2026-10-18（非月经与无月经默认不借月经档的图，但要能给一个借用开关）——
 *   · 默认（开关关着）⇒ **只用自己这一档**填的图，不往别的档借 ✓
 *   · 开关打开 ⇒ 照老规矩回落（无月经 → 非月经 → 有月经 ✓）
 *   ⚠️ 内置图是**全局一套**（不分模式）⇒ 两种情况下都照用（不然没填图的人永远是空白 ✗）
 */
function resolveStageImage(mode, playerKey, builtinFile) {
    const self = (mode === 'amenorrhea') ? 'amenorrhea' : (isNeutralMode(mode) ? 'none' : 'normal');
    // ★ 2026-10-18：开关打开之后**借哪一档也要能选**（月经 / 非月经 / 两档依次 ✓）
    const chain = [self];
    // **每一档各自独立的借用开关**（不是全局一个 ✓）
    if (borrowOnFor(self)) {
        const from = borrowFromFor(self);
        if (from && from !== self) chain.push(from);
    }
    for (const m of chain) {
        const own = stageImages(m)[playerKey];
        if (own) return own;
    }
    if (!builtinFile) return '';
    try { return new URL('../assets/stages/' + builtinFile, import.meta.url).href; } catch { return ''; }
}

/** 某一类图、某一档，这一刻有没有图可画（玩家填过 或 内置里有 ✓） */
export function stageHasImage(kind, mode, tier) {
    if (kind === 'pregnant') {
        const n = Number(tier);
        return !!resolveStageImage(mode, pregnantKeyOf(n), BUILTIN_PREGNANT_FILES[n]);
    }
    if (kind === 'womb') return !!resolveStageImage(mode, wombKeyOf(tier), BUILTIN_WOMB_FILES[tier]);
    return !!resolveStageImage(mode, vaginaKeyOf(tier), BUILTIN_VAGINA_FILES[tier]);
}

/** 这一类图某一档的地址（找不到就是空串 ✓） */
export function stageImageFor(kind, mode, tier) {
    if (kind === 'pregnant') {
        const n = Number(tier);
        return resolveStageImage(mode, pregnantKeyOf(n), BUILTIN_PREGNANT_FILES[n]);
    }
    if (kind === 'womb') return resolveStageImage(mode, wombKeyOf(tier), BUILTIN_WOMB_FILES[tier]);
    return resolveStageImage(mode, vaginaKeyOf(tier), BUILTIN_VAGINA_FILES[tier]);
}


/**
 * 没画的那几档 ⇒ **回落到最近的已画档**（先往下找、再往上找 ✓）
 *   例：少/中没画 ⇒ 用「残留」；满没画 ⇒ 用「多」✓（永远不破图 ✓）
 *   孕期那五张也走同一条规则（1..5 当序号 ✓）
 */
export function nearestIn(kind, mode, tier) {
    const list = (kind === 'pregnant') ? PREGNANT_STAGES : SPERM_TIERS;
    const want = (kind === 'pregnant') ? Number(tier) : String(tier || 'empty');
    const idx = Math.max(0, list.indexOf(want));
    for (let i = idx; i >= 0; i--) if (stageHasImage(kind, mode, list[i])) return list[i];
    for (let i = idx + 1; i < list.length; i++) if (stageHasImage(kind, mode, list[i])) return list[i];
    return '';
}

/**
 * ★★ 单向联动（显示用，存储值一个字不动 ✓）—— 改的：
 *   **子宫有残留，阴道可以是空的**（阴道好清理；子宫里那点残留也不一定滴下来）⇒
 *   原来那条「子宫 ≥ 残留 ⇒ 阴道至少残留」**已删** ✓
 *   **还保留的两条**：
 *     · 子宫 ≥ 多   ⇒ 阴道至少「少」
 *     · 阴道 ≥ 多   ⇒ 子宫至少「残留」
 *     · 阴道 = 满   ⇒ 子宫至少「少」
 *   ⇒ 量大的时候才互相顶，小量（残留）不连锁 ✓
 *   ⚠️ 只抬高不降低；阴道「少 / 中」不会顶到子宫（少量灌不上去 ✓）
 *   ★ 2026-10-30：`sealed`（孕期）⇒ **一律不抬子宫**。
 *     为什么：孕期宫颈被封着，子宫那本永远是空；可这两条联动会把
 *     「阴道满」抬成「子宫少」，于是读数和图下文字又冒出个「少」✗
 *     （她当天就看到了「从满溢变成少了」）
 * @param {boolean} [sealed] 孕期（子宫不收任何东西）
 */
export function effectiveLoads(vaginaTier, wombTier, sealed = false) {
    const idx = (t) => {
        const i = SPERM_TIERS.indexOf(String(t || 'empty'));
        return i < 0 ? 0 : i;
    };
    let v = idx(vaginaTier);
    let w = idx(wombTier);
    if (sealed) return { vagina: SPERM_TIERS[v], womb: 'empty' };
    for (let k = 0; k < 3; k++) {
        const nv = Math.max(v, w >= idx('many') ? idx('low') : 0);
        const nw = Math.max(w, v >= idx('many') ? idx('residue') : 0, v >= idx('max') ? idx('low') : 0);
        if (nv === v && nw === w) break;
        v = nv; w = nw;
    }
    return { vagina: SPERM_TIERS[v], womb: SPERM_TIERS[w] };
}


/**
 * 纯决策：几个事实进去，这一刻该画**哪一档底图 ＋ 哪几层**（好单测 ✓、不依赖全局状态 ✓）
 * @param {object} f { vaginaTier, wombTier, pregnant, wombSealed, implanted, fertilized, egg, sperm }
 *   （`tier` 当 `vaginaTier` 的老写法也认 ✓）
 *   `wombSealed`：子宫这本书封没封（孕期）。不给就按 `pregnant` 算 ✓
 */
export function pickStageLayers(f = {}) {
    const overlays = [];
    // ★ 怀孕之后**不再贴任何层**：朋友那五张孕期图本身就是整张图（含子宫和胎儿 ✓）
    //   （原来贴「胎儿」那套做法作废：多胎只显示一个 ✓）
    if (f.pregnant) { /* 什么都不贴 ✓ */ }
    else if (f.implanted) overlays.push('implanted');
    else if (f.fertilized) overlays.push('fertilized');
    else {
        if (f.sperm) overlays.push('sperm');
        if (f.egg) overlays.push('egg');
    }
    const vWant = String((f.vaginaTier !== undefined) ? f.vaginaTier : (f.tier || ''));
    const vaginaStored = SPERM_TIERS.includes(vWant) ? vWant : 'empty';
    const wombStored = SPERM_TIERS.includes(String(f.wombTier || '')) ? String(f.wombTier) : 'empty';
    // ★ 显示用的两档都按联动抬一抬；孕期子宫那一本**不参与抬升**（见 effectiveLoads）
    //   `wombSealed` 单独给：刚着床那几天画面还是「着床」那张（pregnant=false），
    //   但她已经在孕期了 ⇒ 抬升得按"真孕期"封，不能按"孕期图出没出场"封 ✗
    const sealed = (f.wombSealed !== undefined) ? !!f.wombSealed : !!f.pregnant;
    const eff = effectiveLoads(vaginaStored, wombStored, sealed);
    const vaginaTier = eff.vagina;
    const wombTier = eff.womb;
    // ⚠️⚠️ `pregnant` 必须**一起带出去**（漏了 ⇒ 孕期那一支永远不跑 ✗ 2026-10-13 漏过一次）
    return { vaginaTier, vaginaStored, wombTier, wombStored, overlays, pregnant: !!f.pregnant };
}

/** 孕期天数（孕 X 周+Y 天 ⇒ X*7+Y；拿不到 ⇒ null ⇒ 孕期档走默认中间那档 ✓） */
function pregnancyWeekDaysOf(key) {
    const s = (() => { try { return pregnancyStateForPrompt(key); } catch { return ''; } })();
    const m = String(s || '').match(/孕\s*(\d+)\s*周(?:\s*\+?\s*(\d+)\s*天)?/);
    if (!m) return null;
    return Number(m[1]) * 7 + Number(m[2] || 0);
}

/**
 * 这一刻该画的那一组图（底图 ＋ 子宫层 ＋ 叠加层，都是地址；没有的层直接不给 ✓）
 * @param {string} key 看哪个对象
 */
export function stageLayersFor(key) {
    const k = String(key || state().active || '');
    const t = (state().targets || {})[k] || null;
    const mode = (() => { try { return periodModeOf(k) || null; } catch { return null; } })();
    // ★ 胎儿数据还没出来（刚着床那几天）⇒ 继续用着床那张＋子宫层，不换成孕期图 ✓
    const pregnant = (() => { try { return pregnancyArtReady(k, t); } catch { return false; } })();
    // ★ 2026-10-30：**真孕期**单独一个事实（管子宫那本的封口）。
    //   刚着床那几天 `pregnant`（画哪张图）还是 false，但子宫已经不能进精液了 ✓
    const wombSealed = (() => { try { return pregnantNowOf(k); } catch { return false; } })();
    const flow = conceptionStageOf(t);
    // ★★ 两本账各读各的（阴道挑底图、子宫挑那张透明层 ✓）
    const vaginaTier = (() => { try { return vaginaLoadTierOf(k); } catch { return 'empty'; } })();
    const wombTier = (() => { try { return wombLoadTierOf(k); } catch { return 'empty'; } })();
    const picked = pickStageLayers({
        vaginaTier,
        wombTier,
        pregnant,
        wombSealed,
        implanted: flow === 'implanted',
        fertilized: flow === 'fertilized',
        egg: eggPresent(t),
        sperm: spermAliveOf(t),
    });
    return composeStageLayers(mode, picked, {
        fetusWeekDays: pregnancyWeekDaysOf(k),
        fetusTotalDays: totalGestDaysOf(k),
    });
}

/**
 * ★★ **从"几个事实"拼出这一组图**（底图 ＋ 子宫层 ＋ 叠加层）—— 真实数据和「预览」样例共用它。
 *
 * 为什么必须抽出来共用（"把图片贴上去之后没有子宫"的**真因**）：
 *   面板预览那条路（`ui.js` 的 `demoStages`）当时**返回的还是老模型的形状**（只有一张 `image`、
 *   没有 `layers`）⇒ 面板一看没有层，就退回去画那张老单图 ⇒ **预览里永远看不到子宫底图** ✗。
 *   ⇒ 现在两边**走同一个拼装函数**：以后再加层，真实数据和样例一起动，不会再一边新一边旧 ✓。
 *
 * @param {'normal'|'none'|null} mode
 * @param {{vaginaTier:string, wombTier:string, overlays:string[], pregnant?:boolean}} picked
 * @param {{fetusWeekDays?:number|null}} [fetus] 孕期那张按孕周挑第几张
 */
export function composeStageLayers(mode, picked, fetus = {}) {
    const layers = [];
    // ★ 底图 = **阴道**那一本（整幅不透明图 ✓）—— 孕期也要铺（孕期那几张是**透明底**的子宫特写，
    //   下面没铺底图的话背景会空掉 ✓）
    const vUse = nearestIn('vagina', mode, picked.vaginaTier);
    const base = vUse ? stageImageFor('vagina', mode, vUse) : '';
    if (base) layers.push({ src: base, dx: 0, dy: 0, s: 1 });
    // **孕期胎儿可以关**（可能有人不想看到胎儿）
    //   ⇒ 关着时不走孕期那张（它本身带胎儿），退回普通剖面（阴道底图 ＋ 子宫层）✓
    if (picked.pregnant && !stageFetusOn()) {
        const wOff = nearestIn('womb', mode, picked.wombTier);
        const wSrc = wOff ? stageImageFor('womb', mode, wOff) : '';
        if (wSrc) layers.push({ src: wSrc, dx: 0, dy: 0, s: 1 });
        return {
            vaginaTier: picked.vaginaTier, vaginaStored: picked.vaginaStored, wombTier: picked.wombTier,
            usedTier: vUse, wombUsedTier: wOff, pregnantUsed: '',
            overlays: [], uterus: base, layers, pregnant: true,
        };
    }
    // ★★ 孕期 ⇒ 用「孕期 N」那张**代替子宫层**（按孕周选；没画就回落最近的已画档 ✓）
    //   ⚠️ 不再叠精子 / 卵子 / 着床：怀孕了这些都不对 ✓
    if (picked.pregnant) {
        const want = pregnantStageOf(fetus.fetusWeekDays ?? null, fetus.fetusTotalDays ?? null);
        const useN = nearestIn('pregnant', mode, want);
        const src = useN ? stageImageFor('pregnant', mode, useN) : '';
        if (src) layers.push({ src, dx: 0, dy: 0, s: 1 });
        return {
            // ★ 2026-10-24（她：但我子宫是空）—— 孕期图不贴子宫层，但**文字读数**要真实档；
            //   以前这里写死 `wombTier:'empty'` ⇒ 图下文字永远显示「子宫：空」✗
            vaginaTier: picked.vaginaTier, vaginaStored: picked.vaginaStored, wombTier: picked.wombTier,
            usedTier: vUse, wombUsedTier: '', pregnantUsed: useN,
            overlays: [], uterus: base, layers, pregnant: true,
        };
    }
    // ★ 子宫那一层**每一档都要贴**（含「空」）——
    //   ⚠️ 报：子宫没有了：底图（阴道）那张**本身不带子宫**，
    //     子宫是单独一张透明图；以前「子宫空就不贴」⇒ 空档时整个子宫都不出现 ✗
    const wUse = nearestIn('womb', mode, picked.wombTier);
    const wombSrc = wUse ? stageImageFor('womb', mode, wUse) : '';
    if (wombSrc) layers.push({ src: wombSrc, dx: 0, dy: 0, s: 1 });
    // ★ 「精子游向卵子」那张**复合图**（两者都在时优先用它 ✓ 没有就退回两张单图）
    const bothSE = picked.overlays.includes('sperm') && picked.overlays.includes('egg');
    const seUrl = bothSE ? resolveStageImage(mode, 'sperm_egg', BUILTIN_LAYER_FILES.sperm_egg) : '';
    const useOverlays = (bothSE && seUrl) ? ['sperm_egg'] : picked.overlays;
    for (const id of useOverlays) {
        const u = resolveStageImage(mode, id, BUILTIN_LAYER_FILES[id]);
        if (u) layers.push({ src: u, dx: 0, dy: 0, s: 1 });
    }
    return {
        vaginaTier: picked.vaginaTier, vaginaStored: picked.vaginaStored, wombTier: picked.wombTier,
        usedTier: vUse, wombUsedTier: wUse, pregnantUsed: '',
        overlays: useOverlays, uterus: base, layers, pregnant: false,
    };
}

/**
 * ★ 面板「预览」用：给一组**编出来的事实**，拼出跟真实数据**形状完全一样**的那一组图。
 *   （⚠️ 别再在这儿另写一套 —— 那正是「预览里没有子宫」的根因 ✗）
 */
export function stageLayersForSample(mode, facts = {}) {
    const picked = pickStageLayers(facts);
    return composeStageLayers(mode, picked, {
        fetusWeekDays: facts.fetusWeekDays ?? null,
        fetusTotalDays: facts.fetusTotalDays ?? null,
    });
}

// ---------------------------------------------------------------------------
// 事实提取
// ---------------------------------------------------------------------------

/** 从 "Day14" / "14" / "孕 84 天" 这类写法里抠出第一段数字（跟 derive.js 同一套口径 ✓） */
function firstNum(v) {
    const m = String(v ?? '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

/**
 * 这一刻卵子在不在场（排卵窗口内）。
 * ⚠️ 拿不到 phaseId（还没推演过）⇒ 不在场 ✓
 */
export function eggPresent(t) {
    return EGG_PHASES.includes(String(t?.profile?.phaseId || ''));
}

/**
 * 体内还有没有活精子。
 *
 * ★ 两个口径，取决于「按精子存活」那一档开没开（看 `cycleSettleMode`，
 *   **不是**那个已废弃的 `spermLife` 布尔量 ✓）：
 *   · 开着 ⇒ 用 `viableFertility` 真算（哪几批还在存活期内 ✓）
 *   · 没开 ⇒ 规则上"本周期里的精子一律视为存活" ⇒ 退回 `hasSperm()`
 *     （它看的是 d6「胎儿状态」和 d2 累计受孕率，都还在本周期口径里 ✓）
 *   ⚠️ 为什么不一律用 hasSperm：精子存活开着的时候，累计率**不会因为失活而变小**
 *     ⇒ 只看 d2 会永远显示"有精子"，退回日常这一步就永远不发生 ✗
 */
export function spermAliveOf(t) {
    try {
        if (settings().cycleSettleMode === 'sperm') {
            // ★ 周期日走 `cycleDayNum`（插件自己按剧情日期算的那个数 ✓）
            const nowDay = cycleDayNum(t?.key);
            if (Number.isFinite(nowDay)) return viableFertility(nowDay, t?.key).alive > 0;
        }
    } catch { /* 忽略，退回下面的近似 */ }
    return hasSperm(t);
}

/**
 * 受精之后走到哪一步了。
 *
 * @returns {'implanted'|'fertilized'|''} 空串 = 没有在进行的受精
 *
 * ★ 着床用 `isPregnant()` 判，**不做日期推算** ——
 *   它是权威信号（AI 报的 Is_Pregnant / 状态标题里的"孕期"）✓，
 *   而"着床日"要跨周期算天数，边界必然出错 ✗（宁可晚一步，不可假报）
 *
 * ★ 「退回」规则就在这里：受精判定过了、但着床窗口过完还没怀上
 *   ⇒ 当作"没有在进行"，图自动回到下面那几格 ✓
 *   （不然图会一直停在"受精卵"，而"显示跟实际不符"是最忌讳的 ✗）
 */
export function conceptionStageOf(t) {
    if (isPregnant(t)) return 'implanted';
    const j = getOvuJudgment(t?.key);
    if (!j || j.passed !== true) return '';
    const days = Number(j.implantDays);
    // ★ 周期日走 `cycleDayNum`（插件自己算的那个数 ✓）
    const nowDay = cycleDayNum(t?.key);
    // ★ 判定当天优先用记录里的**数字** `j.day` ——
    //   展示串 `j.sub` 靠不住（无月经档恒为「—」、手改档也可能没有数字）⇒ 抠不到就整段跳过、
    //   图会一直停在「受精卵钻入」✗（`j.day` 就是为这件事补上的 ✓）
    //   ⚠️ 老记录没有 `day` ⇒ 回落原来的 `sub` 抠数字（老行为一字不变 ✓）
    const rawDay = (j.day === null || j.day === undefined || j.day === '') ? null : Number(j.day);
    const judgeDay = Number.isFinite(rawDay) ? rawDay : firstNum(j.sub);
    if (Number.isFinite(days) && Number.isFinite(nowDay) && Number.isFinite(judgeDay)) {
        let diff = nowDay - judgeDay;
        // 跨周期了就补一整圈（补错了也只会多显示几天，不会假报怀孕 ✓）
        if (diff < 0) diff += firstNum(t?.vars?.Cycle_Length) || 28;
        if (diff > days) return '';
    }
    return 'fertilized';
}

/** 纯决策：几个事实进去，该画哪张出来（好单测 ✓，也不依赖任何全局状态） */
export function pickStage(f = {}) {
    if (f.implanted) return 'implanted';
    if (f.fertilized) return 'fertilized';
    if (f.egg && f.sperm) return 'sperm_egg';
    if (f.egg) return 'egg';
    if (f.sperm) return 'sperm_only';
    return 'daily';
}

/** 从几个事实 + 一个对象，得出这一刻该画哪张 */
export function stageOf(t) {
    const flow = conceptionStageOf(t);
    return pickStage({
        implanted: flow === 'implanted',
        fertilized: flow === 'fertilized',
        egg: eggPresent(t),
        sperm: spermAliveOf(t),
    });
}

// ---------------------------------------------------------------------------
// 给面板 / 设置页用的那份
// ---------------------------------------------------------------------------

/**
 * 这个状态这一刻用哪张图。
 *
 * 优先级（**图还没画好时用什么顶**）：
 *   ① 这一档自己填的图 > ② **另一档**（有月经那套）填的图 > ③ 内置文件 > ④ 空（面板显示文字版）
 *   ⇒ 也就是「**非月经那一档留空就回落**」：只要画一套，非月经那档也不会空着一块 ✗
 *   ⇒ 文字不一样（文字**不回落**，各档用各自的词 ✓，见 `stageTextOf`）
 */
export function stageImageOf(key, mode) {
    return resolveStageImage(mode, key, BUILTIN_STAGE_FILES[key]);
}

/**
 * 推给面板的那份（纯数据，怎么画由 bodycord.html 决定 ✓）
 * @param {string} [key] 看哪个对象；不给就"当前正在查看的那个"
 */
export function stagesForPanel(key) {
    if (!stagesOn()) return { on: false };
    const k = String(key || state().active || '');
    // ★★ 2026-10-16（无月经也可能有人看内视图，别假定别人不需要，也要给无月经做阶段插图）——
    //   以前这里对无月经档**整块返回 {on:false}** ✗，理由是"别给没有周期的人画排卵/受孕的插图"。
    //   但那个担心其实不需要靠"整块关"来解决：**卵子层看的是 `profile.phaseId`**，
    //   而无月经的人**根本没有阶段**（`deriveCycleFields` 对他返回空 ⇒ phaseId 空）
    //   ⇒ `eggPresent()` 自然是 false ⇒ 根本不会画排卵/卵子 ✓
    //   而怀孕时该有的孕期那几张、以及与周期无关的层（精子 / 受精 / 着床）
    //   都是**共用逻辑**，玩家要看就该给玩家看 ✓ ⇒ 这里不再特判 ✓
    const t = (state().targets || {})[k] || null;
    const stage = stageOf(t);
    // ★ 文字按**这个人自己的周期模式**取（周期模式是按人的 ✓）：
    //   非月经那一档说「受孕高峰日 / 生殖细胞」，不会冒出"排卵日" ✗✓
    const mode = (() => {
        try { return periodModeOf(k) || null; } catch { return null; }
    })();
    const text = stageTextOf(stage, mode);
    // ★ 标题跟着**图**走（2026-10-23）：胎儿数据出来了才切成孕早/中/晚期＋孕周；
    //   刚着床那几天图还是着床那张，标题也就是「着床」——两边永远同一件事 ✓
    //   ⚠️ 孕周必须跟**图**用同一个来源（`pregnancyWeekDaysOf` 读的是插件算好的
    //     「孕 X 周+Y 天」那行）—— 以前这里用 `pregDaysOf`，那只在**植入孕**上才有值，
    //     普通怀孕永远是 null ⇒ 图已经换成孕期那张、标题却还写着「着床」✗
    const pregHead = (() => {
        try {
            if (!pregnancyArtReady(k, t)) return null;
            const wd = pregnancyWeekDaysOf(k);
            if (!Number.isFinite(wd) || wd <= 0) return null;
            const w = Math.floor(wd / 7), d = wd % 7;
            return {
                title: w <= 13 ? '孕早期' : (w <= 27 ? '孕中期' : '孕晚期'),
                line: `孕 ${w} 周${d ? ` + ${d} 天` : ''}`,
            };
        } catch { return null; }
    })();
    const headTitle = pregHead ? pregHead.title : text.title;
    const headLine = pregHead ? pregHead.line : text.line;
    // ★★ 2026-10-16：切到「只显示文字」时**干脆不发图** ——
    //   `image` 留空、层给空 ⇒ 面板按它原来的规矩走文字版 ✓（不用动面板本体 ✓）
    //   ⚠️ 键要**给齐**（面板那几个键都读）⇒ 不留 undefined ✗
    if (stageTextOnly()) {
        return {
            on: true, stage, title: headTitle, line: headLine,
            image: '', uterus: '', layers: [], overlays: [],
            spermTier: '', vaginaTier: '', wombTier: '', usedTier: '', wombUsedTier: '',
        };
    }
    // ★★ 分层那套（底图 ＋ 子宫层 ＋ 叠加层 ✓）—— 老的 `image` 先留着，
    //   等设置页那批迁完再把它拆掉 ✗（这一批先保证不破任何老行为 ✓）
    const lay = (() => {
        try { return stageLayersFor(k); } catch {
            return { vaginaTier: 'empty', wombTier: 'empty', usedTier: '', wombUsedTier: '', overlays: [], uterus: '', layers: [] };
        }
    })();
    return {
        on: true,
        stage,
        title: headTitle,
        line: headLine,
        image: stageImageOf(stage, mode),
        uterus: lay.uterus,
        layers: lay.layers,
        overlays: lay.overlays,
        spermTier: lay.vaginaTier,
        vaginaTier: lay.vaginaTier,
        wombTier: lay.wombTier,
        usedTier: lay.usedTier,
        wombUsedTier: lay.wombUsedTier,
    };
}
