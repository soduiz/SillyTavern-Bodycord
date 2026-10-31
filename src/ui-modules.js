/**
 * ui-modules.js —— 「补丁」页（卡片式 + 分类分页签）
 *
 * 每一类是一个单独的页签，不用一路往下滑。
 * 每张补丁卡：名称 + 徽章 + 开关 → 说明 → 展开全文编辑。
 * 标了「必开」的模块不给关（开关直接锁掉）。
 */

import { MODULES, GROUP_LABEL, CATEGORIES, GATE_LABEL, GATE_GLOSSARY } from './modules.js';
import {
    settings, save, isModuleOn, setModuleOn,
    moduleText, moduleTextRaw, setModuleText, resetModuleText, isTextOverridden,
    moduleScope, patchScope, setPatchScope, isPatchLocked, isPatchFrozen,
    frozenPatchText, frozenPatchIds, frozenPatchCount, overriddenPatchIds,
    DEFAULT_TERM_NAMES, DEFAULT_PHASE_NAMES, cycleModeLabel, NO_CYCLE_HIDDEN_IDS, isNoCycleMode,
    periodMode, moduleHasModeVariants, moduleVariantText, setModuleVariantText, resetModuleVariants,
    projectModeStructure, MODULE_VARIANT_MODES, applyTalentPreset, detectTalentPreset, applyDominantPreset, detectDominantPreset,
} from './settings.js';
import { defaultCycleStartDay } from './derive.js';
import { templates, previewInjection, moduleActive, unknownTemplatePlaceholders } from './prompt.js';
import { estimateTokens, formatTokens, tokenLevel, sumTokens } from './tokens.js';
import { targetList, displayName, hasConceptionData, USER_KEY, userLabel, userSelfLabel, anyTargetHasCycle, isUserKey, state, setPeriodModeOf, awarenessTierIdOf, setAwarenessTierIdOf, traceOnOf, setTraceOnOf, cycleStartRuleOf, setCycleStartRuleOf, cycleDayNow, periodModeOf } from './store.js';
import { h, clear, button, modal, textArea, textInput, numberInput, select, dropdown, toggle, askConfirm, cardHead, helpButton } from './dom.js';
import { renderParamFields } from './ui-params.js';
// ★ 角色基础信息那四格 + 别名备注：**三处共用一份实现**（设置页 / 悬浮球弹窗 / 这里 ✓）
import { bodyLockRows, identRows } from './ui-settings.js';
import {
    askArchiveName, loadWorldArchiveInteractive, applyPersonArchiveInteractive,
} from './ui-archive.js';
import {
    saveArchive, savePersonArchive, getArchive, archiveLabel, summarize,
    listWorldArchives, listPersonArchives, personBlocksLabel,
} from './archive.js';
import {
    moduleRole, isGateEnabled, setGateEnabled,
    isFieldOn, setFieldOn, setFieldGroup, ALL_FIELDS, FIELD_GROUPS, FIELD_LABEL,
} from './settings.js';
const GROUP_ORDER = ['main', 'judge', 'both'];

/** 一个 token 徽章 */
function tokenBadge(textOrCount, title) {
    const n = typeof textOrCount === 'number' ? textOrCount : estimateTokens(textOrCount);
    const el = h('span', {
        class: 'bc-token-badge lv-' + tokenLevel(n),
        title: title || `约 ${n} tokens`,
        text: '≈ ' + formatTokens(n) + ' tk',
    });
    // ★ 把"后缀说明"存在元素上 ⇒ 刷新数字时不会把它冲掉 ✓
    //   （只有门控模块才带那句"只在条件满足时发送" ✓）
    if (title) el.dataset.titleSuffix = title;
    return el;
}

/**
 * ★ 只改一个徽章的数字，**不重建 DOM** ✓
 *
 * 为什么要"只改数字"：模块卡里是个 textarea ⇒ 重建会让**焦点和未保存的内容一起丢** ✗
 *   （⚠️ 不这么做的话：只有保存之后才估算 TOKEN ✗）
 */
function setBadge(el, n) {
    if (!el) return;
    el.className = 'bc-token-badge lv-' + tokenLevel(n);
    el.textContent = '≈ ' + formatTokens(n) + ' tk';
    const suf = el.dataset.titleSuffix;
    el.title = suf
        ? suf.replace(/约 \d[\d,]* tokens/, `约 ${n} tokens`)
        : `约 ${n} tokens`;
}

/** 固定字段：改了插件就认不出来了。这里只做「显示」，不会发给 AI。 */
const FIXED_FIELDS = [
    // [字段名, 是什么, 改了会怎样]
    ['d1 ~ d9', '数据项一至九', '那一格的信息直接丢失，面板读不出来'],
    ['row1 / row2 / row3', '状态条一至三（生理状态 / 身体状况 / 近期性行为）', '同上'],
    ['cot', '推演过程', '推演记录里就没有「推演过程」那一块了'],
    ['period', '生理监测（不需要时填 null）', '经期面板读不出来'],
    ['name', '追踪对象的名字', '面板分不清是哪个对象'],
    ['Is_Pregnant', '是否怀孕。已改由系统自己维护（着床完成时切 true、分娩或妊娠终止时切 false），不再问模型', '孕期门控全乱：该发的不发、不该发的照发'],
    ['race', '该对象的种族', '异种规则的门控失灵（那是按种族发的）'],
    ['is_xeno', '算不算人类以外的种族（true / false）', '人类 / 异种的分流失灵'],
    ['Time_Scale', '剧情时间（周期日 / 孕周）。已改由系统按剧情日期自己算，不再问模型', '它由系统每轮自己写；你看到的数改不动也没关系'],
    ['Ovulation_Day', '排卵日。由系统按身体补丁那一行同步，不用模型报', '改这里不再影响计算（计算读的是身体补丁）'],
    ['Cycle_Length', '周期长度。由系统按身体补丁那一行同步，不用模型报', '同上'],
];

// ---------------------------------------------------------------------------
// 只显示给用户的说明块（绝不进提示词）
// ---------------------------------------------------------------------------

/**
 * 固定字段表：弹窗形式（内容多，平时挂着占地方 ✗）。
 *
 * 内容很多 ⇒ 单独一个表，点那个按钮就能弹出窗口 ✓
 * 三个小决定：顶部那块撤掉换一行 ✓ / 编辑区小字放**上方** ✓ / 内容连"改了会怎样"一起列 ✓
 */
function fixedFieldsModal() {
    modal({
        title: '🔒 这些字段名是固定的',
        width: 780,
        cancelText: '知道了',
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-hint', text: '补丁正文里可以随便改措辞、加减规则。但下面这些「字段名」被改了，插件就认不出来，那条信息会直接丢失。这张表只是给你看的，不会发给 AI' }));
            const table = h('div', { class: 'bc-ff-table' });
            table.appendChild(h('div', { class: 'bc-ff-row bc-ff-head' },
                h('div', { class: 'bc-ff-key', text: '字段名' }),
                h('div', { class: 'bc-ff-what', text: '是什么' }),
                h('div', { class: 'bc-ff-broke', text: '改了会怎样' }),
            ));
            for (const [key, what, broke] of FIXED_FIELDS) {
                table.appendChild(h('div', { class: 'bc-ff-row' },
                    h('div', { class: 'bc-ff-key' }, h('code', { text: key })),
                    h('div', { class: 'bc-ff-what', text: what }),
                    h('div', { class: 'bc-ff-broke', text: broke }),
                ));
            }
            body.appendChild(table);
        },
    });
}

/** 一行提示 + 按钮 */
function fixedFieldsBar() {
    return h('div', { class: 'bc-ff-bar' },
        h('span', { class: 'bc-hint', text: '🔒 有些「字段名」是插件认的，改了那条信息就会丢' }),
        button('查看固定字段', () => fixedFieldsModal()),
    );
}

// ---------------------------------------------------------------------------
// 门控术语表（可折叠）
// ---------------------------------------------------------------------------

/**
 * 折叠按钮必须显眼（占太大一格 ✗）
 *
 * 做法：默认**收起**，只留一条「入口条 + 一颗强调色按钮」；点开才铺出那八条解释。
 *   · 显隐一律**明确写 `flex` / `none`** —— 写 `''` 表示"恢复 CSS 值"，
 *     在 `display:none` 的 CSS 下等于永远藏起来 ✗
 *   · 开合状态放**模块级**变量 ⇒ 分类页签重建 / 重画之后不会自己弹回去 ✓
 *   · 开合**不走整页 rerender**（原地改显示与按钮文字）⇒ 不丢滚动位置、也不闪 ✓
 */
let _glossaryOpen = false;

function gateGlossaryBlock() {
    const rows = h('div', { class: 'bc-gate-glossary-body' },
        ...GATE_GLOSSARY.map(([term, desc]) => h('div', { class: 'bc-gate-glossary-row' },
            h('code', { text: term }),
            h('span', { text: desc }),
        )),
    );
    // 强调色那颗按钮 = 「显眼」（走既有的 bc-btn-primary，不另造一套 ✓）
    const btn = button('展开解释', () => {
        _glossaryOpen = !_glossaryOpen;
        apply();
    }, { variant: 'primary' });
    function apply() {
        rows.style.display = _glossaryOpen ? 'flex' : 'none';
        btn.textContent = _glossaryOpen ? '收起解释' : '展开解释';
    }
    apply();
    return h('div', { class: 'bc-gate-glossary' },
        h('div', { class: 'bc-ff-bar' },
            h('span', { class: 'bc-hint', text: '上面那些词（怀孕 / 经期 / 异种…）是什么意思' }),
            btn,
        ),
        rows,
    );
}
// ---------------------------------------------------------------------------
// 注入模板
// ---------------------------------------------------------------------------

// ⚠️ 那串「可用：{{xxx}} …」不画在每个输入框下面（一屏六行，很占地方）——
//   ⇒ 收进「？」里，改由下面的 help 列给 ✓
const TPL_FIELDS = [
    ['stateHeader', '状态摘要 · 抬头', 3],
    ['stateRule', '状态的用法（放在系统段，不跟摘要走）', 4],
    ['targetBlock', '状态摘要 · 每个对象的模板', 8],
    ['stateFooter', '状态摘要 · 结尾（可留空）', 2],
    ['patchHeader', '沉浸设定 · 抬头', 3],
    ['patchItem', '沉浸设定 · 全局模块模板', 3],
    ['patchItemTarget', '沉浸设定 · 按对象模块模板', 3],
];

// ★ 这六个框**必须有草稿** —— 敲进去、不点「保存模板」
//   就切分类页签（那张卡会重建）⇒ 内容**静默丢掉** ✗（模块卡那边有 `_draft` 扛得住，这里没有）。
//   草稿放**模块级**（不是渲染级）⇒ 任何重建都留着；点「保存模板」/「恢复默认模板」时清空 ✓
const _tplDraft = {};

function templatesCard(handlers) {
    const card = h('div', { class: 'bc-card' });
    const T = templates();

    card.appendChild(h('div', { class: 'bc-card-head' },
        h('span', { class: 'bc-card-title', text: '注入模板' }),
        h('span', { class: 'bc-badge', text: '发给主 API' }),
        h('div', { class: 'bc-spacer' }),
        h('span', { class: 'bc-param-status bc-tpl-status' }),
        helpButton('注入模板', [
            '这就是插件「输出给酒馆正文」的那两段提示词。想改语气、改格式、加减说明，都在这里',
            '「状态摘要」是 AI 看到的角色身体状态那一块，「沉浸设定」是同一轮里那些规则与设定',
            '留空 = 用内置默认；这里改了会直接进正文生成，改坏了 AI 会照着错的写',
            '改完要点下面的「保存模板」才算数：没点保存就不生效，草稿会留着（标题右边会写「有改动未保存」）',
            '某一行只有占位符、而它算出来是空的时候，这一行会整行消失',
            '可用的占位符（哪一段就写哪一段的）：',
            '· 状态摘要 · 每个对象的模板：{{name}} {{isUser}} {{pregnancy}} {{menstruation}} {{nextPeriod}} {{fetus}} {{due}} {{milk}} {{zones}} {{birth}} {{impregnator}} {{awareness}} {{physio}} {{body}} {{traces}} {{recentSex}}',
            '· 沉浸设定 · 全局模块模板：{{name}}（模块名）{{text}}（模块正文）',
            '· 沉浸设定 · 按对象模块模板：{{name}} {{target}}（对象名）{{text}}',
        ]),
    ));

    // ★ 模板里拼错的占位符要点名说一句 ✗：
    //   renderTemplate 把认不出的键替换成空串（整行还会消失）⇒ 不报错、看不出来，
    //   那一块信息就永久不发了。这里只在**真拼错**时才出现一行警告 ✓
    const badTpl = unknownTemplatePlaceholders();
    if (badTpl.length) {
        card.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 有认不出的占位符，那一块不会发出去：' + badTpl.join('、') }));
    }

    const body = h('div', { class: 'bc-card-body' });
    card.appendChild(body);

    const inputs = {};
    // ★ 有草稿时给标题右边那行状态字一个提示（不然"没保存"完全看不出来 ✓）
    const markDirty = () => {
        if (!status) return;
        status.textContent = '有改动未保存';
        status.style.color = 'var(--bc-amber, #d99a1f)';
    };
    for (const [key, label, rows] of TPL_FIELDS) {
        // ★ 草稿优先（编辑中但还没保存的内容 ✓）；没有草稿才用已保存的那份 ✓
        const ta = textArea(_tplDraft[key] !== undefined ? _tplDraft[key] : (T[key] || ''),
            (v) => { _tplDraft[key] = v; markDirty(); }, { rows });
        inputs[key] = ta;
        body.appendChild(h('div', { class: 'bc-field' },
            h('label', { class: 'bc-label', text: label }),
            ta,
        ));
    }

    const status = card.querySelector('.bc-tpl-status');
    card.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('保存模板', () => {
            const t = settings().injectTemplates || (settings().injectTemplates = {});
            for (const [key] of TPL_FIELDS) t[key] = inputs[key].value;
            for (const k of Object.keys(_tplDraft)) delete _tplDraft[k];   // ★ 草稿落盘了就清掉 ✓
            save();
            status.textContent = '已保存';
            status.style.color = 'var(--bc-green)';
            handlers.refresh?.();
            setTimeout(() => { status.textContent = ''; }, 1800);
        }, { variant: 'primary' }),
        button('预览现在会发出去什么', () => {
            const pv = previewInjection();
            modal({
                title: '主 API 现在会收到的内容',
                width: 880,
                build: (bd) => {
                    bd.appendChild(h('div', { class: 'bc-hint', text: '上面「状态摘要」放在对话末尾附近（倒数第 2 条消息之前），下面「沉浸设定」放在系统段，状态的用法那段也在系统段里，一起发' }));
                    bd.appendChild(h('div', { class: 'bc-section-title', text: '状态摘要' }));
                    bd.appendChild(h('pre', { class: 'bc-pre', text: pv.state || '（空）' }));
                    bd.appendChild(h('div', { class: 'bc-section-title', text: '沉浸设定' }));
                    bd.appendChild(h('pre', { class: 'bc-pre', text: pv.patch || '（空）' }));
                },
            });
        }),
        button('恢复默认模板', async () => {
            if (!(await askConfirm('把这三段模板恢复成插件默认？\n\n你正在编辑、还没保存的内容也会一起清掉'))) return;
            for (const k of Object.keys(_tplDraft)) delete _tplDraft[k];   // ★ 草稿也清 ✓
            settings().injectTemplates = {};
            save();
            handlers.rebuild?.();
        }),
    ));

    return card;
}

// 二选一的模块对：两个都开会互相打架
const EXCLUSIVE_PAIRS = [
    ['maternal_real', 'maternal_anime', '孕期母体反应：现实向 / 二次元轻松向是二选一，两个都开会互相打架'],
    ['heritage', 'heritage_xeno', '血脉遗传特质：人类版 / 异种版是二选一，两个都开孩子特质会写两遍'],
];

/** 当前的开关组合里有没有互斥冲突 */
function conflictWarnings() {
    const out = [];
    for (const [a, b, msg] of EXCLUSIVE_PAIRS) {
        if (isModuleOn(a) && isModuleOn(b)) out.push(msg);
    }
    return out;
}

// ---------------------------------------------------------------------------
// 字段开关
// ---------------------------------------------------------------------------

function fieldsCard(handlers) {
    const card = h('div', { class: 'bc-card' });
    // ★ 这一张卡里不塞说明：两块 ⚠️ 说明 + 5 行小灰字会是全页最挤 ✗
    //   ⇒ 说明全进「？」，页面上只留分组标题和开关本身 ✓
    const fieldHelp = [
        '关掉 = 不推演、不显示、不发给主 API',
        '有的人只想看经期记录，不想要身体状态描述；有的人反过来。这里每个字段都能单独关掉',
        '关掉之后：插件 API 不再需要它（输出契约里直接不提，省输出 token）、上一轮状态里也不带它、面板上不显示、发给主 API 的摘要里也不出现。不带它这一步是必须的，不然模型照样看得到，token 就白省了',
        '⚠️ 这里和「分类页签里的模块开关」是两层，不是同一个东西',
        '「分类页签里的模块开关」= 这一整套「规则」发不发。比如关掉「泌乳系统」，插件 API 就完全不知道泌乳这回事',
        '「这里的字段开关」= 某一个「格子」要不要。比如泌乳模块开着，但你只想看产奶量、不想让它写进 panel，就把 d7 关掉',
        '例外：「d6 胎儿状态」这一格关掉只是不显示。推演照旧记着它，不然分娩时孩子会落不了库',
        '两者是「与」的关系：模块关掉，字段开着也不会推演；模块开着，字段关掉就不推那一格。插件不会帮你联动（关了模块不会自动去关字段，那样很容易误伤），所以想彻底不推演某个东西，两边都看一下',
        '「只留经期记录」这类预设只是帮你一次性勾好，之后照样可以单独改',
    ];
    for (const [, gname, , ghint] of FIELD_GROUPS) fieldHelp.push(`【${gname}】${ghint}`);
    card.appendChild(cardHead('字段开关', fieldHelp));

    const body = h('div', { class: 'bc-card-body' });
    card.appendChild(body);

    for (const [gid, gname, keys] of FIELD_GROUPS) {
        const onCount = keys.filter(isFieldOn).length;
        const grid = h('div', { class: 'bc-field-switches' });
        for (const k of keys) {
            const on = isFieldOn(k);
            grid.appendChild(h('label', { class: 'bc-field-switch' + (on ? ' on' : '') },
                toggle(on, (v) => { setFieldOn(k, v); handlers.refresh?.(); handlers.rebuild?.(); }),
                h('span', { text: FIELD_LABEL[k] || k }),
            ));
        }
        body.appendChild(h('div', { class: 'bc-card-group-title' },
            h('span', { text: gname }),
            h('span', { class: 'bc-cat-count', text: `${onCount}/${keys.length}` }),
            h('div', { class: 'bc-spacer' }),
            button('全开', () => { setFieldGroup(keys, true); handlers.rebuild?.(); }),
            button('全关', () => { setFieldGroup(keys, false); handlers.rebuild?.(); }),
        ));
        body.appendChild(grid);
    }

    body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('全部打开', () => { setFieldGroup(ALL_FIELDS, true); handlers.rebuild?.(); }, { variant: 'primary' }),
        button('只留经期记录', () => {
            // 只关心月经：留下阶段、进度、计算、敏感带与三条状态条之外的全关掉
            setFieldGroup(ALL_FIELDS, false);
            setFieldGroup(['phase', 'sub', 'calc', 'd2', 'd9'], true);
            handlers.rebuild?.();
        }),
        button('只留身体状态描述', () => {
            setFieldGroup(ALL_FIELDS, false);
            setFieldGroup(['title', 'phase', 'sub', 'row1', 'row2', 'row3'], true);
            handlers.rebuild?.();
        }),
        button('恢复全开', () => { setFieldGroup(ALL_FIELDS, true); handlers.rebuild?.(); }),
    ));

    return card;
}

// ---------------------------------------------------------------------------
// 补丁卡片
// ---------------------------------------------------------------------------

/**
 * ★ 某条模块卡片在**哪个视图**（world / person）—— 一处定义，两处用：
 *   ① 补丁页按它决定这条列在哪一页（`scoped()`）✓
 *   ② 跳转按它决定「要切到哪一页」—— 根因：跳转只在当前页里找卡片，
 *      而目标在**另一个视图**里 ⇒ 找不到 ✗
 *   （两个例外：敏感带记录 ⇒ 世界观；敏感带自定义 ⇒ 人物 ✓）
 */
const VIEW_OVERRIDE = { zones_record: 'world', zones_custom: 'person', body_trace: 'world' };

/** 这条模块卡片属于哪个视图（表达式和页面里那份 `scoped()` 完全同源 ✓） */
function viewOfModule(id) {
    return VIEW_OVERRIDE[id] || (moduleScope(id) === 'global' ? 'world' : 'person');
}

/**
 * 跳到另一个模块卡片，并在那边放一个「跳回来」的按钮。
 *
 * 附属因为没开本体导致锁了之后，要有一个跳转到本体的按钮，
 *   点完之后再跳回这个之前被锁的条目。
 *
 * ⚠️ 补丁页**一次只画当前视图 + 当前分类页签**那一页 ⇒ 目标在另一页时，
 *   DOM 里根本没有那张卡片 ⇒ 光在当前页里翻是永远找不到的（只会弹一句"没找到"）✗
 *   ⇒ 现在先切「视图 + 分类」、重画一页，然后才找卡片；「跳回来」走同一条路 ✓
 */
function jumpToModule(targetId, fromId, targetName, fromName, handlers) {
    // 找不到就退回按标题文字找（万一 data 属性没设上）
    const find = (id) => {
        const byAttr = document.querySelector(`.bc-module-card[data-module="${id}"]`);
        if (byAttr) return byAttr;
        const name = MODULES.find(x => x.id === id)?.name;
        if (!name) return null;
        return [...document.querySelectorAll('.bc-module-card')]
            .find((el) => (el.querySelector('.bc-card-title')?.textContent || '') === name) || null;
    };

    /**
     * 目标不在当前这一页 ⇒ 切视图 + 切分类，再重画。
     * @returns {string} 切到了哪个视图（没切就返回空串）
     */
    const ensureVisible = (id) => {
        if (find(id)) return '';
        const s = settings();
        const wantView = viewOfModule(id);
        const wantCat = MODULES.find(m => m.id === id)?.cat || null;
        let changed = false;
        if (s.ui.patchView !== wantView) { s.ui.patchView = wantView; changed = true; }
        if (wantCat && s.ui.patchCat !== wantCat) { s.ui.patchCat = wantCat; changed = true; }
        // 视图与分类本来就是对的 ⇒ 卡片是真找不到（多半被"非月经 / 只能改数值"藏了，
        // 那就走下面那句"没找到"的回话，别假装切过了 ✓）
        if (!changed) return '';
        save();
        try { handlers?.rebuild?.(); } catch { /* 忽略 */ }
        return wantView === 'person' ? '人物' : '世界观';
    };

    const go = (el, label, note) => {
        if (!el) {
            // 报障「点不了」—— 多半是"点了但看不出发生了什么"，所以每次都明确回话
            window.toastr?.warning?.('没找到那张卡片，它可能不在当前分组里，往上翻一下就能看到');
            return false;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bc-jump-flash');
        setTimeout(() => el.classList.remove('bc-jump-flash'), 1600);
        window.toastr?.info?.((label ? `已跳到「${label}」` : '已跳转') + (note ? `，${note}` : ''));
        return true;
    };

    const switched = ensureVisible(targetId);
    const target = find(targetId);
    if (!go(target, targetName || targetId, switched ? '已切到' + switched + '视图' : '')) return;

    // 目标卡片上挂一个临时的「跳回来」（旧的先清掉，免得堆一排）
    target.querySelectorAll('.bc-jump-back').forEach((x) => x.remove());
    const bar = h('div', { class: 'bc-card-hint bc-jump-back' },
        button('↩ 回到「' + (fromName || fromId) + '」', () => {
            bar.remove();
            // ★ 回来时同样可能跨视图/跨分类 ⇒ 走同一条路 ✓
            const back = ensureVisible(fromId);
            go(find(fromId), fromName || fromId, back ? '已切到' + back + '视图' : '');
        }));
    target.appendChild(bar);
    // 自己又点走 / 刷新了，10 秒后自己消失，不留垃圾
    setTimeout(() => bar.remove(), 10000);
}

/** ★ 这个模块算不算"条件发送" —— `gate`（可数组）和 **`gateAny`** 都算 ✓
 *  ⚠️ 只判 `mod.gate` 不够 ⇒ 只用 `gateAny` 的模块（"怀孕时或来月经时"那条共用小模块）
 *    既没有「自动」徽章、还会被算进"常驻"那一桶 ⇒ TOKEN 总览把它报价成常驻 ✗ */
function isGated(mod) {
    return !!(mod?.gate || (Array.isArray(mod?.gateAny) && mod.gateAny.length));
}

/**
 * 某几条模块卡片自己的「？」（大多数卡没有；文案照玩家的口径：短句、不用破折号）。
 * 加它的起因：世界观那条痕迹卡关着时，人物那个开关到底还管不管用，
 * 光看卡片看不出来 ⇒ 把"两个开关谁管谁"写在总开关这张卡上 ✓
 */
const MODULE_HELP = {
    // ★ 这张卡下面「精子怎么算」那三行是新加的（2026-10-20）——
    //   三行长得像三个并列开关，所以「？」里必须把它们的关系讲清 ✓
    cycle_module: [
        '卡片下面「精子怎么算」那三行，是同一个问题的三层，不是三个并列的开关',
        '精子跨不跨周期：「跨」＝换周期不清空，每批精子到自己的存活期才失效；「不跨」＝进新周期直接把精子清空。这一行相当于选难度，切了要等下一个周期边界才换挡',
        '存活期多长：只在选「跨」时有用。每批精子在这两个数之间随机决定活几天，每天概率一样，调大最长也不会偷偷改概率',
        '判定取哪个数：受孕窗口结束时会算一次能不能怀上。「累计所有批次」＝窗口内发生过的都算，哪怕精子后来失效；「仅计算存活批次」＝只算那一刻还活着的精子。两档都不改变界面上显示的累计受孕率，也不会回头重算已经算过的结果',
        '还有一件事跟那三行无关：累计受孕率是「这一个周期」的，进新周期从 0 重新累计，两档都一样。那一档只决定精子跨不跨周期，不决定这个数字',
    ],
    body_trace: [
        '吻痕、指痕这类短期痕迹：记下来、按夜消退、残留一段时间',
        '这张卡是总开关。它关着的时候，两个 API 都不收痕迹相关的内容，也不吃 token；人物视图里那个「身体痕迹追踪」开关只是先记着',
        '它打开之后，人物视图那个开关才生效：按人决定发给谁（关掉的人既不发规则、推演也不会给他记痕迹）',
    ],
};

function moduleCard(mod, targetKey, handlers) {
    // 这个变体依赖的本体模块有没有开（见 prompt.js 的 moduleActive 双锁）。
    // ⚠️ 必须写在 moduleCard 里 —— 之前误插到了 templatesCard（那里没有 mod），
    //   运行时 ReferenceError: missingBase is not defined，整个面板建不出来。
    const reqIds = mod.requires ? (Array.isArray(mod.requires) ? mod.requires : [mod.requires]) : [];
    const missingBase = reqIds.filter(r => !isModuleOn(r));

    const isTargetScope = mod.scope === 'target';
    const useTarget = isTargetScope && targetKey !== '__global__' ? targetKey : null;
    // ★ 参数面板（数值 / 那张敏感带表）按**哪个对象**读写：
    //   · 人物视图 ⇒ 当前这个对象（不管模块是 global 还是 target —— 玩家填的东西都是"某个人的" ✓）
    //   · 世界观视图 ⇒ null（共用那份）
    //   ⚠️ 不能直接用 useTarget：「敏感带自定义」是 global 模块，但那张表**按人存**
    //      ⇒ 用 useTarget（null）会让它在人物视图里读写不到当前这个人 ✗
    const paramTarget = targetKey !== '__global__' ? targetKey : null;
    const ov = isTextOverridden(mod.id, useTarget);
    const on = isModuleOn(mod.id);
    // ★「补丁编辑范围」= 只能改数值（默认）/ 全文可改 —— 见 settings.js 顶上那段说明 ✓
    //   只有**会进插件 API 的那批**会被锁正文（描写风格那批发给主 API，不算它的 token ✓）
    const lockText = (patchScope() === 'numbers') && isPatchLocked(mod.id);
    const frozen = isPatchFrozen(mod.id, useTarget);

    const card = h('div', {
        class: 'bc-card bc-module-card' + (on ? ' on' : ''),
        // 跳转靠它认卡片（「去开启本体」/「跳回来」都要按 id 找）
        'data-module': mod.id,
    });

    // ---- 头部 ----
    // ⚠️ 2026-10-17：**不要在卡片头部再放一颗「恢复内置默认」** ✗ ——
    //   可编辑的卡本来就有那一行（恢复内置默认 / 保存 / 收起），我在头部又加一颗
    //   就被玩家当场指着问：做两个是干什么？✓ ⇒ 那一颗是重复的，撤掉 ✓
    //   （真缺这颗的是"正文不给编辑"的那类卡，要补也只补那种 ✗ 别一律加）
    // ★ 这一格的 TOKEN 徽章要存引用 ⇒ 编辑时能实时改数字（不重建 DOM ✓）
    let cardTkEl = null;
    card.appendChild(h('div', { class: 'bc-card-head' },
        h('span', { class: 'bc-card-title', text: mod.name }),
        mod.locked ? h('span', { class: 'bc-badge bc-badge-lock', text: '必开' }) : null,
        // ★ 跟随型模块（`follow`）：说清它跟着谁的开关走 ✓
        mod.follow ? h('span', { class: 'bc-badge bc-badge-lock', text: '跟着「' + (MODULES.find(m => m.id === mod.follow)?.name || mod.follow) + '」' }) : null,
        missingBase.length ? h('span', { class: 'bc-badge bc-badge-lock', text: '本体未开' }) : null,
        h('span', { class: 'bc-badge', text: isTargetScope ? '按对象' : '全局' }),
        h('span', { class: 'bc-badge', text: GROUP_LABEL[mod.role] }),
        // ★ 判据带上 `gateAny`（见上面 isGated 的说明 ✓）
        isGated(mod) ? h('span', { class: 'bc-badge bc-badge-gate', text: '自动' }) : null,
        (cardTkEl = tokenBadge(moduleText(mod.id, useTarget), isGated(mod)
            ? `约 ${estimateTokens(moduleText(mod.id, useTarget))} tokens（只在条件满足时发送）`
            : undefined)),
        frozen ? h('span', { class: 'bc-badge bc-badge-frozen', text: '已冻结' })
            : ov ? h('span', { class: 'bc-badge bc-badge-edit', text: '已改' }) : null,
        MODULE_HELP[mod.id] ? helpButton(mod.name, MODULE_HELP[mod.id]) : null,
        h('div', { class: 'bc-spacer' }),
        h('div', { class: 'bc-card-toggle' },
            // ★ 「生理周期模块」是必开的：卡头这里照旧显示「🔒 必开」，
            //   「周期结算方式」那颗**搬到卡身**跟判定口径并成一组了（见下面的 spermGroup）——
            //   两颗规则变体原来一颗在头、一颗在身 ⇒ 会被读成"同一件事的两个开关" ✗
            mod.locked
                // 必开模块：不给关，直接把开关锁掉
                ? h('span', { class: 'bc-lock-locked', title: '这是必开模块，规则依赖它，不能关闭' }, '🔒 必开')
                // ★ 跟随型模块、而且本体正开着 ⇒ 也不给关（强制打开、不能关 ✓）
                //   ⚠️ 本体关着时**照样给开关**：打开它会顺手把本体也开上（跟 requires 一个待遇 ✓）
                : (mod.follow && isModuleOn(mod.follow))
                    ? h('span', { class: 'bc-lock-locked', title: '「' + (MODULES.find(m => m.id === mod.follow)?.name || mod.follow) + '」开着时它必须跟着开：等级是什么意思全靠它解释，关了就没人认识「3级」了' }, '🔒 跟着开')
                // 硬条件没满足 → **照样给开关**：打开时会顺手把本体也开上 ✓
                //   ⚠️ 不能换成「🔒 需先开本体」⇒ 玩家还得自己去找那张卡 ✗
                : toggle(on, (v) => {
                    const auto = setModuleOn(mod.id, v) || [];
                    // 顺手开了东西就说一声（别让人看不出为什么 ✓）
                    //   ⚠️ 后面那个括号没用，这种废话提示不加 ⇒ 只留"顺手开了谁"，别加解释 ✗
                    if (auto.length) {
                        const nm = auto.map(x => MODULES.find(m => m.id === x)?.name || x).join('、');
                        try { window.toastr?.info?.('顺手把「' + nm + '」也打开了'); } catch { /* 忽略 */ }
                    }
                    card.classList.toggle('on', isModuleOn(mod.id));
                    // 必须走 rebuild：顶上那条 TOKEN 总览是它算的，
                    // 只调轻量 refresh 的话数字不会跟着动
                    handlers.rebuild?.();
                })),
    ));

    card.appendChild(h('div', { class: 'bc-card-desc', text: mod.desc }));

    // ★ 2026-10-24（她：给继承加三档运气）——
    //   不做加权：一键只是把「怀孕判定模块」里那两行区间**换成对应的一套**，
    //   换完照样能在参数面板逐格改 ✓（预设是"换表"，不是"改概率偏向"）
    if (mod.id === 'heritage') {
        // ★ 2026-10-24（她：三颗按钮看不出现在用的是哪档）⇒ 改成下拉，当前档位一眼可见 ✓
        const curPreset = (() => { try { return detectTalentPreset(useTarget); } catch { return 'custom'; } })();
        const curLabel = { normal: '正常', lucky: '好运', super: '超好运' }[curPreset] || '自定义（现在这套）';
        card.appendChild(h('div', { class: 'bc-card-hint', text:
            '运气档位决定孩子拿到好天赋的概率，外貌不受这一项影响。换完还能在参数面板逐格改。' }));
        const presetOpts = [
            ['normal', '正常（默认）'],
            ['lucky', '好运'],
            ['super', '超好运'],
        ];
        // ★ 2026-10-24（她：咋四个）——「自定义」只在当前值认不出预设时才出现在列表里 ✓
        if (curPreset === 'custom') presetOpts.push(['custom', curLabel]);
        card.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '运气档位' }),
            dropdown(curPreset, presetOpts, (v) => {
                if (v === 'custom' || v === curPreset) return;
                try { applyTalentPreset(v, useTarget); } catch { /* 忽略 */ }
                handlers.rebuild?.();
            }),
            h('span', { class: 'bc-hint', text: '当前：' + curLabel + (curPreset === 'custom' ? '（参数面板里改过，选上面三档可以覆盖回去）' : '') }),
        ));
        // ★ 2026-10-24（她：显性单独一个档位，跟天赋隔开）——
        //   显性外貌从哪一边取，单独一颗下拉：默认双方相同概率 / 偏向受孕方 / 偏向致孕方 ✓
        const curDom = (() => { try { return detectDominantPreset(useTarget); } catch { return 'custom'; } })();
        const domLabel = { equal: '双方相同概率', mat: '偏向受孕方', pat: '偏向致孕方' }[curDom] || '自定义（现在这套）';
        const domOpts = [
            ['equal', '双方相同概率（默认）'],
            ['mat', '偏向受孕方'],
            ['pat', '偏向致孕方'],
        ];
        if (curDom === 'custom') domOpts.push(['custom', domLabel]);
        card.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '显性倾向' }),
            dropdown(curDom, domOpts, (v) => {
                if (v === 'custom' || v === curDom) return;
                try { applyDominantPreset(v, useTarget); } catch { /* 忽略 */ }
                handlers.rebuild?.();
            }),
            h('span', { class: 'bc-hint', text: '当前：' + domLabel + '（只影响显性外貌从哪一边取）' }),
        ));
    }

    // ★ 异种：各族比例是按"物种现实 + 作品惯例"定的。
    //   ⇒ **只进界面**，提示词一个字都不加（加了白吃 TOKEN）✓
    if (mod.id === 'xenotype') {
        card.appendChild(h('div', { class: 'bc-card-hint', text:
            '各族胎数按物种现实定（犬科一窝 4-8 只、鱼类成百上千枚、虫族按作品惯例）' +
            '性别比例同理：真实昆虫按生物学（蜂/蚁的工蜂全是雌性），虫族默认「雌性稀有」' }));
        card.appendChild(h('div', { class: 'bc-card-hint', text:
            '想换成别的世界观，直接改这个模块文案里那一行：' }));
        card.appendChild(h('div', { class: 'bc-numhint', text:
            '虫族性别 · 雌性稀有（默认）  1-12 雌，13-100 雄\n' +
            '虫族性别 · 雌性主导          1-97 雌，98-100 雄\n' +
            '虫族性别 · 均衡              1-50 雌，51-100 雄' }));
    }

    // ★★ 精子这一组三行并在一起（2026-10-20）——
    //   原来「周期结算方式」在卡头、「判定口径」在卡身、中间夹着存活期 ⇒
    //   三个不同层级的旋钮挤在一起，而且两颗规则变体都用「存活」这个词
    //   ⇒ 现在包成一块、每行前面写清它管什么，名字也不再撞 ✓
    if (mod.id === 'cycle_module') card.appendChild(spermGroup(handlers));
    // ★ 着床判定什么时候掷（怀孕判定模块那张卡）
    if (mod.id === 'pregnancy_module') {
        card.appendChild(implantDaysRow(handlers));
        card.appendChild(implantTimingRow(handlers));
    }
    // 互斥的变体（现实向/二次元向、人类版/异种版）明确说明二选一
    if (mod.exclusive) {
        const mates = MODULES.filter(m => m.exclusive === mod.exclusive && m.id !== mod.id);
        if (mates.length) {
            card.appendChild(h('div', { class: 'bc-card-hint', text: '与其他变体二选一：' + mates.map(m => m.name).join('、') }));
        }
    }
    // 本体没开就明说，别让人打开变体却看不出为什么没效果
    //   ⚠️ 这一块**不能套进 `if (mod.exclusive)` 里** ✗
    //     ⇒ 只有"互斥变体"才可能走到，而互斥那两条偏偏没有 requires ⇒
    //       带 requires 的（敏感带自定义 / 异种血脉 / 异种精子）永远看不到这句说明 +
    //       「去开启本体」那颗跳转按钮，jumpToModule 也整条不可达 ✗
    if (missingBase.length) {
        const baseId = missingBase[0];
        const baseName = MODULES.find(x => x.id === baseId)?.name || baseId;
        card.appendChild(h('div', { class: 'bc-card-hint bc-card-hint-warn' },
            h('span', { text: '⚠️ 这个变体需要先打开：' + missingBase.map(id => MODULES.find(x => x.id === id)?.name || id).join('、') }),
            // 跳转到本体的按钮：点完之后还要能跳回这个之前被锁的条目
            button('🔓 去开启「' + baseName + '」', () => {
                // ★ 要带上 handlers：跳转可能要**换视图 / 换分类**再重画一页 ✓
                jumpToModule(baseId, mod.id, baseName, mod.name, handlers);
            }, { variant: 'primary' }),
        ));
    }

    // ---- 展开区 ----
    const body = h('div', { class: 'bc-card-body' });
    card.appendChild(body);

    // 数值字段（如果这条有）—— 按 paramTarget 读写（见上面那段说明 ✓）
    const paramHost = h('div', {});
    if (frozen) {
        // ★ 被冻结的那条**不给改数字** ✗ —— 数值面板和全文编辑改的是同一份文字，
        //   在这里改数字会把那份被冻结的正文覆盖掉（等于偷偷删掉改动 ✗）
        //   ⇒ 换成一条说明 + 两个出口（切全文可改 / 丢弃）✓
        paramHost.appendChild(frozenBar(mod, useTarget, handlers));
    } else {
        const pf = renderParamFields(mod.id, paramTarget, handlers);
        if (pf) paramHost.appendChild(pf);
    }
    body.appendChild(paramHost);

    // 全文编辑（默认折叠）
    const fullHost = h('div', { class: 'bc-full-text' });
    body.appendChild(fullHost);

    // ★ 全文编辑器里带**原文**：
    //   ⇒ 显示的是**没替换过占位符的原文**（`@@TERM:ovulationDay@@` 这种），
    //     存回去也就不会把"那一档当时的措辞"冻进存档 ✓
    //     （数值面板那条反过来：读的时候给人看人话、写回用原文 ✓）
    const PLACEHOLDER_HINT = '这里是原文：@@TERM:ovulationDay@@ 这种叫「占位符」，发出去之前插件会按每个人的周期模式换成对应的名字（排卵日 / 受孕高峰日这类）。把它删掉或改坏，这一处就不会被替换了';
    /** @@ 配对自检：只拦"明显被改坏"的（数量是奇数 ⇒ 少了一半）✓ 合法的增删不拦 */
    const placeholderBroken = (text) => (String(text || '').match(/@@/g) || []).length % 2 !== 0;

    // ★★ 2026-10-19：给"按周期模式分叉"的模块做一条「版本」切换 ——
    //   **两个视图都要有**：只读那份（只能改数值档）也要能切着看，
    //   不然那一档下根本看不到另一套长什么样 ✗
    //   ⚠️ 它只决定"你在看哪一档"，不改「默认周期模式」，也不改发送时按谁取 ✓
    const currentVariantMode = () => {
        const m = (() => { try { return periodMode(); } catch { return 'normal'; } })();
        return MODULE_VARIANT_MODES.includes(m) ? m : 'normal';
    };
    /** 画那条切换栏；`onPick(该档)` 只管换内容，不用管按钮的选中态 ✓ */
    const buildVariantBar = (onPick) => {
        let vmode = currentVariantMode();
        const row = h('div', { class: 'bc-row' });
        const paint = () => {
            clear(row);
            row.appendChild(h('span', { class: 'bc-hint', text: '正在看哪个版本：' }));
            for (const m of MODULE_VARIANT_MODES) {
                row.appendChild(button(cycleModeLabel(m), () => {
                    if (m === vmode) return;
                    vmode = m;
                    onPick(m);
                    paint();
                }, m === vmode ? { variant: 'primary' } : {}));
            }
            row.appendChild(h('div', { class: 'bc-spacer' }));
            row.appendChild(h('span', { class: 'bc-hint', text: '只影响你在看哪一档，不会改动「默认周期模式」' }));
        };
        paint();
        return { row, getMode: () => vmode };
    };

    // 「只能改数值」模式下，正文**只看不改**（要的是"能看到全文"，不是"看不到" ✓）
    const openReadOnly = () => {
        clear(fullHost);
        const withVariants = moduleHasModeVariants(mod.id);
        const ta = textArea(withVariants ? moduleText(mod.id, useTarget, currentVariantMode()) : moduleText(mod.id, useTarget), () => {}, { rows: 16, class: 'bc-code', readOnly: true });
        const bar = withVariants
            ? buildVariantBar((m) => { ta.value = moduleText(mod.id, useTarget, m); })
            : null;
        fullHost.appendChild(h('div', { class: 'bc-row' },
            h('span', { class: 'bc-hint', text: '只读' + (isTargetScope && useTarget ? '这一份是这个对象的专属补丁' : '这一份是所有对象共用的补丁') + (withVariants ? '（上面换版本只看，不会改任何东西）' : '') }),
            h('div', { class: 'bc-spacer' }),
            button('收起', () => { clear(fullHost); showFullBtn(); }),
        ));
        if (bar) fullHost.appendChild(bar.row);
        fullHost.appendChild(ta);
    };

    const openFull = () => {
        clear(fullHost);
        // ★★ 2026-10-19：这条正文如果是**按周期模式分叉**的（月经 / 非月经 / 无月经 各一套），
        //   就在这里给一个「版本」切换 —— 玩家的话：
        //   「如果想看两套的区别需要划上去切换默认模式，如果是想编辑的也得划上去，这样不方便」
        //   ⚠️ 它**只决定你在看 / 改哪一档**，不改「默认周期模式」，也不改发送时按谁取 ✓
        //   ⚠️ 存的是"这一档的正文"（`modules.<id>.variants.<档>`）；
        //      没存过的档仍然按内置原文投影，所以不存就一点额外体积都没有 ✓
        const withVariants = moduleHasModeVariants(mod.id);
        const projOf = (m) => projectModeStructure(moduleTextRaw(mod.id, useTarget, { rebase: false }), m);
        const variantSrc = (m) => moduleVariantText(mod.id, m) || projOf(m);
        let vmode = currentVariantMode();
        let dirty = false;

        // ★ 打字时就更新 TOKEN（⚠️ 空回调的话只有保存后才变 ✗）
        //   两处都动，而且**都只改数字、不重建**（重建会丢焦点和未保存内容 ✗）
        const ta = textArea(withVariants ? variantSrc(vmode) : moduleTextRaw(mod.id, useTarget, { rebase: false }), (v) => {
            dirty = true;
            setBadge(cardTkEl, estimateTokens(v));
            handlers.onDraftEdit?.(mod.id, v);
        }, { rows: 16, class: 'bc-code' });

        // 「版本」那一条（只有分档的模块才有；和只读视图共用同一个画法 ✓）
        const varBar = withVariants
            ? buildVariantBar((m) => {
                if (dirty) {
                    try { window.toastr?.info?.('切到「' + cycleModeLabel(m) + '」这一档了，刚才那档没保存的改动没留下来'); } catch { /* 忽略 */ }
                }
                vmode = m;
                dirty = false;
                ta.value = variantSrc(m);
                setBadge(cardTkEl, estimateTokens(ta.value));
            })
            : null;

        fullHost.appendChild(h('div', { class: 'bc-row' },
            h('span', { class: 'bc-hint', text: isTargetScope && useTarget ? '正在编辑：这个对象的专属补丁' : '正在编辑：全局补丁' }),
            h('div', { class: 'bc-spacer' }),
            button('恢复内置默认', async () => {
                if (!(await askConfirm('把这条补丁恢复成插件内置的原文？'))) return;
                if (withVariants) resetModuleVariants(mod.id);
                resetModuleText(mod.id, useTarget);
                handlers.onDraftClear?.(mod.id);   // 草稿也要清 ✓
                handlers.rebuild?.();
            }),
            button('保存', () => {
                // ⚠️ 存坏了要**当场说**（占位符少了一半 ⇒ 那一处以后不会被替换）
                if (placeholderBroken(ta.value)) {
                    window.toastr?.warning?.('这段正文里的 @@ 占位符没配对，那一处不会被替换（其余的照旧）');
                }
                if (withVariants) setModuleVariantText(mod.id, vmode, ta.value);
                else setModuleText(mod.id, ta.value, useTarget);
                dirty = false;
                // ★ 保存后草稿就没意义了（读设置就是新值 ✓）⇒ 清掉 ✓
                handlers.onDraftClear?.(mod.id);
                handlers.refresh?.();
                handlers.rebuild?.();
            }, { variant: 'primary' }),
            // 收起 = 放弃这次编辑 ⇒ 草稿也要清（不然它会一直压着设置里的值 ✗）
            button('收起', () => {
                handlers.onDraftClear?.(mod.id);
                clear(fullHost);
                showFullBtn();
            }),
        ));
        if (varBar) fullHost.appendChild(varBar.row);
        fullHost.appendChild(h('div', { class: 'bc-ff-bar bc-ff-bar-top' },
            h('span', { class: 'bc-hint', text: '🔒 正文里有些「字段名」不能改（改了插件就认不出来）。改措辞、加减规则都没问题' }),
            button('看看是哪些', () => fixedFieldsModal()),
        ));
        fullHost.appendChild(h('div', { class: 'bc-ff-bar' },
            h('span', { class: 'bc-hint', text: PLACEHOLDER_HINT }),
        ));
        fullHost.appendChild(ta);
    };

    const fullBtn = button('展开全文编辑', () => { clear(fullHost); openFull(); },
        lockText
            ? { disabled: true, title: '现在是「只能改数值」：想改这段文字，把上面的「补丁编辑范围」切到「全文可改」' }
            : {});
    const showFullBtn = () => {
        clear(fullHost);
        fullHost.appendChild(h('div', { class: 'bc-row' },
            fullBtn,
            lockText
                ? h('span', { class: 'bc-hint', text: '想改这段文字，把上面的「补丁编辑范围」切到「全文可改」' })
                : h('span', { class: 'bc-hint', text: '想改结构、加减规则、换措辞，都从这里进' }),
            // ⚠️ 不能叫「看一下原文（只读）」：它给的是**替换过占位符的成文**
            //   ⇒ 叫「全文」才对得上（"原文"专指全文编辑器里那份带 @@ 的 ✓）
            lockText ? button('看一下全文（只读）', () => { clear(fullHost); openReadOnly(); }) : null,
            // ★★ 正文被锁住的卡（「只能改数值」）**没有那行编辑器** ⇒ 它就没有「恢复内置默认」✗
            //   生理期系统、身体痕迹与恢复追踪 ✓
            //   ⇒ 只在这种卡上补一颗（可编辑的卡本来就有，补在那边会变成两颗 ✗ 玩家当场问过：做两个是干什么？）
            lockText ? button('恢复内置默认', async () => {
                if (!(await askConfirm('把这条补丁恢复成插件内置的原文？'))) return;
                // ★ 分档的模块：三档的覆盖也一起清（不然"恢复默认"只清了 text，版本里那几份还留着 ✗）
                if (moduleHasModeVariants(mod.id)) resetModuleVariants(mod.id);
                resetModuleText(mod.id, useTarget);
                handlers.onDraftClear?.(mod.id);
                handlers.rebuild?.();
            }) : null,
        ));
    };
    showFullBtn();

    return card;
}

// ---------------------------------------------------------------------------
// 两个视图：世界观 / 人物
//
// ★ 顶上**切换**两个视图（不是分成上下两段）——
//   分上下两段太长，翻着累 ✓
//   白捡的好处：世界观视图里只列世界观模块、人物视图里只列人物模块
//   ⇒ "选着某个对象却改到全体那份"（静默改到所有人）那个坑被**结构**直接消灭了 ✓
//   （比在卡片上挂一条「注意：这条是全局的」警告干净得多 ✓）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 「补丁编辑范围」：只能改数值 / 全文可改
//
// ★ 只锁**会进插件 API 的那批** ——
//   判定规则 + 两边都发的体质补丁；描写风格那些（发给主 API 的）不受影响 ✓
// ★ 铁律：从「全文可改」切回「只能改数值」时，改过的正文**冻结不删**，
//   而且要**显眼标出来** —— "静默忽略你的改动"是这类系统最恶劣的错 ✗
// ---------------------------------------------------------------------------

/** 顶上的「补丁编辑范围」切换 */
function patchScopeSwitch(handlers) {
    const wrap = h('div', {
        class: 'bc-modesw',
        title: '只能改数值：规则里只有数字改动算数。全文可改：文字随便改，改坏了后果自负',
    });
    const opts = [['numbers', '只能改数值'], ['full', '全文可改']];
    const els = {};
    const sync = () => {
        const now = patchScope();
        for (const [id] of opts) els[id]?.classList.toggle('active', id === now);
    };
    for (const [id, label] of opts) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            if (patchScope() === id) return;
            // 切之前先数一遍：切到「全文可改」之后就没有"冻结"这个概念了 ✓
            const before = frozenPatchCount();
            setPatchScope(id);
            sync();
            if (id === 'numbers') {
                const n = frozenPatchCount();
                if (n > 0) {
                    window.toastr?.warning?.(`已切回「只能改数值」：有 ${n} 条正文改动被冻结（现在不生效，改动没删。切到「全文可改」就恢复）`);
                } else {
                    window.toastr?.success?.('已切到「只能改数值」：规则里现在只有数字能改');
                }
            } else if (before > 0) {
                window.toastr?.success?.(`已切到「全文可改」：${before} 条被冻结的改动恢复了`);
            }
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    return wrap;
}

/**
 * 这条被冻结了：正文改动留着、但不生效（当前是「只能改数值」）✓
 *
 * 为什么连数值面板也收起来：数值面板和全文编辑改的是**同一份文字**
 *   ⇒ 在这里改数字会把那份被冻结的正文覆盖掉（等于偷偷删掉改动 ✗）
 *   ⇒ 只给两个出口：切到「全文可改」（恢复生效）／丢掉这份改动（回到内置原文）✓
 */
function frozenBar(mod, useTarget, handlers) {
    const peekHost = h('div', {});
    return h('div', { class: 'bc-frozen-bar' },
        h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-frozen-title', text: '这条被冻结了（现在不生效）' }),
            h('div', { class: 'bc-spacer' }),
            button('看一眼改过的那份', () => {
                if (peekHost.firstChild) { clear(peekHost); return; }
                peekHost.appendChild(textArea(frozenPatchText(mod.id, useTarget) || '', () => {},
                    { rows: 14, class: 'bc-code', readOnly: true }));
            }),
            button('切到全文可改（恢复生效）', () => {
                setPatchScope('full');
                window.toastr?.success?.('已切到「全文可改」：被冻结的改动都恢复了');
                handlers?.rebuild?.();
            }),
            button('丢弃这份改动（回到内置原文）', async () => {
                if (!(await askConfirm('把这条改过的正文丢掉、回到插件内置的原文？\n\n只丢这一条，别的补丁不受影响'))) return;
                resetModuleText(mod.id, useTarget);
                handlers?.rebuild?.();
            }, { variant: 'danger' }),
        ),
        h('div', { class: 'bc-hint', text:
            '你改过这条的正文，但现在是「只能改数值」⇒ 正文那部分不生效（用的是插件内置的最新正文），'
            + '你自己填的数字照旧生效。改动一个字都没删' }),
        h('div', { class: 'bc-hint', text:
            '这条的数值面板也先收起来了：数字和正文是同一份，在这儿改数字会把那份改动覆盖掉' }),
        peekHost,
    );
}


/** 顶上的两档切换（世界观 / 人物） */
function viewSwitch(handlers) {
    const wrap = h('div', {
        class: 'bc-modesw',
        title: '世界观 = 所有对象共用的规则；人物 = 只给某一个人改的那份',
    });
    const opts = [['world', '世界观'], ['person', '人物']];
    const els = {};
    const sync = () => {
        const now = (settings().ui?.patchView === 'person') ? 'person' : 'world';
        for (const [id] of opts) els[id]?.classList.toggle('active', id === now);
    };
    for (const [id, label] of opts) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            const s2 = settings();
            if (!s2.ui) s2.ui = {};
            s2.ui.patchView = id;
            save();
            sync();
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    return wrap;
}

/** 人物视图里「正在编辑谁」——没选过 / 选的人没了 ⇒ 落到「你自己」✓ */
function personTargetKey() {
    const s = settings();
    if (!s.ui) s.ui = {};
    const k = s.ui.patchTarget;
    const targets = targetList();
    if (k && k !== '__global__' && (k === USER_KEY || targets.some(t => t.key === k))) return k;
    return USER_KEY;
}

function personTargetSelector(container, rerender) {
    const s = settings();
    const targets = targetList();
    const cur = personTargetKey();
    const opts = [];
    // ★ 「你自己」永远可选 ✓ —— 默认就是只追踪 USER
    //   ⚠️ 名字槽位要显示**当前人设名**（不能写「你自己」：
    //     要替换成当前使用角色的名字 ✓）
    opts.push([USER_KEY, userSelfLabel()]);
    for (const t of targets) {
        if (t.key === USER_KEY) continue;
        opts.push([t.key, '对象：' + (displayName(t) || t.key)]);
    }
    container.appendChild(h('div', { class: 'bc-toolbar' },
        h('div', { class: 'bc-toolbar-label', text: '正在编辑' }),
        select(cur, opts, (v) => {
            s.ui.patchTarget = v;
            save();
            rerender();
        }),
        h('div', { class: 'bc-hint', text: '这一栏改的只对这一个对象生效' }),
    ));
}

/** 挑一份档案的小弹窗（世界观 / 人物共用 ✓） */
function pickArchiveModal(list, opts) {
    modal({
        title: opts.title,
        width: 640,
        cancelText: '关闭',
        build: (body, close) => {
            body.appendChild(h('div', { class: 'bc-hint', text: opts.hint }));
            if (!list.length) {
                body.appendChild(h('div', { class: 'bc-empty', text: opts.empty }));
                return;
            }
            for (const a of list) {
                body.appendChild(h('div', { class: 'bc-arch-card' },
                    h('div', { class: 'bc-arch-head' },
                        h('div', { class: 'bc-arch-name', text: archiveLabel(a) }),
                    ),
                    h('div', { class: 'bc-arch-sum' },
                        h('span', { class: 'bc-arch-chip', text: opts.chip(a) })),
                    h('div', { class: 'bc-row bc-row-wrap' },
                        button('套上这份', () => { close(); opts.onPick(a); }, { variant: 'primary' })),
                ));
            }
        },
    });
}

/** 世界观视图：存 / 取整套规则 */
function worldArchiveRow(handlers) {
    return h('div', { class: 'bc-card bc-arch-row-card' },
        cardHead('世界观档案', [
            // ★ 不写「整套规则存下来 / 换一套」——
            //   卡片标题和两颗按钮已经把这句说完了（纯废话 ✗）
            '管的是「所有对象共用」的那一套。只想给某一个人换，切到「人物」那一栏',
            '导入会把当前的提示词配置替换成那一份（替换前自动存一份备份，能切回来）',
        ]),
        h('div', { class: 'bc-card-body' },
            h('div', { class: 'bc-row bc-row-wrap' },
                button('📦 存成世界观档案', async () => {
                    const r0 = await askArchiveName('存为世界观档案');
                    if (!r0) return;
                    const r = saveArchive(r0.name, r0.note);
                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                    window.toastr?.success?.(`已存为「${archiveLabel(getArchive(r.id) || r0)}」`);
                }, { variant: 'primary' }),
                button('📥 从档案导入…', () => {
                    pickArchiveModal(listWorldArchives(), {
                        title: '挑一份世界观档案套上',
                        hint: '会把当前的提示词配置替换成那一份（替换前自动存一份备份，能切回来 ✓）',
                        empty: '还没有世界观档案。可以先去「记录档案」那一页存一份',
                        chip: (a) => {
                            const sum = summarize(a.data);
                            return `模块 ${sum['模块']} · 改过文案 ${sum['改过文案']}`;
                        },
                        // ⚠️ 它是 async ⇒ 必须 await：不 await 的话确认框还没点就 rebuild 了，
                        //   点完"确定"反倒没人重画 ✗
                        onPick: async (a) => { if (await loadWorldArchiveInteractive(a)) handlers?.rebuild?.(); },
                    });
                }),
            ),
        ),
    );
}

/** 人物视图：存 / 取这个人的一整套设定 */
function personArchiveRow(targetKey, handlers) {
    const isUser = targetKey === USER_KEY;
    // ★ 名字槽位用**当前人设名** ✓
    const who = isUser ? userLabel() : (targetLabel(targetKey) || targetKey);
    const card = h('div', { class: 'bc-card bc-arch-row-card' },
        cardHead('人物档案', [
            '基础信息 / 补丁 / 别名、标签与备注，只装动过的那些块',
            isUser
                ? '你自己那份存在全局（穿过所有聊天）：换人设时用它一键切，「设置 → 角色基础信息」那一页也有一个下拉'
                : '这些补丁只存在这个聊天里（平行世界不串味）；你自己那份仍然全局',
        ]),
        h('div', { class: 'bc-card-body' },
            h('div', { class: 'bc-row bc-row-wrap' },
                button('📦 存成人物档案', async () => {
                    const r0 = await askArchiveName(
                        `把「${who}」存成一份人物档案`, who, '',
                        `会把这个对象「动过的」那几块（基础信息 / 补丁 / 别名、标签与备注）一起存下来。没动过的块不装`);
                    if (!r0) return;
                    const r = savePersonArchive(targetKey, r0.name, r0.note);
                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                    window.toastr?.success?.(`已存为「${archiveLabel(getArchive(r.id) || r0)}」`);
                }, { variant: 'primary' }),
                button('📥 从档案导入…', () => {
                    // ★ 两份名单**故意分开**：
                    //   「你自己」的人设版本 ↔ 其他角色的人物档案，套错对象没意义、还容易误盖 ✗
                    const pool = listPersonArchives().filter((a) => !!a?.data?.isUser === isUser);
                    pickArchiveModal(pool, {
                        title: `挑一份人物档案套到「${who}」`,
                        hint: '按块勾选要套哪几块（默认全勾）；档案里没装的块一个字都不会碰 ✓',
                        empty: isUser ? `还没有给「${who}」存过人设版本` : '还没有给角色存过人物档案',
                        chip: (a) => `装了：${personBlocksLabel(a)}`,
                        onPick: async (a) => {
                            const ok = await applyPersonArchiveInteractive(a, targetKey);
                            if (ok) handlers?.rebuild?.();
                        },
                    });
                }),
            ),
        ),
    );
    return card;
}

/** 这个对象在界面上显示成什么 */
function targetLabel(key) {
    const t = targetList().find(x => String(x.key) === String(key));
    return t ? (displayName(t) || t.key) : String(key);
}

/**
 * ★★ 「精子怎么算」这一组（2026-10-20）—— 三个旋钮放在一起、各自标明管什么。
 *
 * 为什么并成一组：这三件是同一个问题的三层，但原来分居卡头和卡身，而且
 *   「按精子存活」和「仅存活精子」两个名字读起来像同一件事 ⇒ 会被当成重复开关 ✗
 * 现在的层级（行标签都是 2026-10-20 被打回一轮后换的大白话）：
 *   ① 精子跨不跨周期 …… 跨（自然失效）/ 不跨（进新周期清零）
 *   ② 存活期多长 …… 每批掷几天（只在①选「跨」时有意义）
 *   ③ 判定取哪个数 …… 失效的那几批算不算进判定（累计受孕率 / 只算还活着的批次）
 */
/**
 * ★ 「着床判定什么时候掷」两档（2026-10-20）—— 到着床日才掷（默认）/ 受精时掷。
 *
 * 为什么要有这一档：默认档里受精那轮只掷「几天后见分晓」，结果留到着床日那一轮才掷；
 *   剧情一口气跳过那天也没关系，后面第一次推演会补掷（玩家不用回滚重玩 ✓）。
 */
/**
 * ★ 着床天数区间（2026-10-20）：在区间里**均匀掷**，值就是天数。
 * 为什么改：原来固定 1d5 → 6~10 天，只有 5 个可能值，连着几次同一天数看着像坏了
 *   （实测三次都是 8 天）。区间可调之后重复会少一些，而且口径跟精子存活期／孕期一致 ✓
 */
function implantDaysRow(handlers) {
    const DEF = { min: 6, max: 10 };
    let st = null;
    try { st = settings(); } catch { st = {}; }
    const row = h('div', { class: 'bc-inline bc-rule-row bc-spermlife' });
    row.appendChild(h('span', { class: 'bc-label', text: '着床天数（天）' }));
    const mk = (val, key) => {
        const inp = h('input', {
            type: 'number', min: '1', max: '60', step: '1',
            class: 'bc-num-sm', value: String(val),
            title: key === 'implantDaysMin' ? '最短几天着床' : '最长几天着床',
        });
        inp.onchange = () => {
            let v = Math.round(Number(inp.value));
            if (!Number.isFinite(v)) v = (key === 'implantDaysMin') ? DEF.min : DEF.max;
            v = Math.max(1, Math.min(60, v));
            const s2 = settings();
            s2[key] = v;
            if (Number(s2.implantDaysMin) > Number(s2.implantDaysMax)) {
                if (key === 'implantDaysMin') s2.implantDaysMax = v;
                else s2.implantDaysMin = v;
            }
            inp.value = String(v);
            save();
            handlers?.rebuild?.();
        };
        return inp;
    };
    row.appendChild(mk(st.implantDaysMin ?? DEF.min, 'implantDaysMin'));
    row.appendChild(h('span', { class: 'bc-num-sep', text: '~' }));
    row.appendChild(mk(st.implantDaysMax ?? DEF.max, 'implantDaysMax'));
    const reset = button('↩', () => {
        const s2 = settings();
        s2.implantDaysMin = DEF.min;
        s2.implantDaysMax = DEF.max;
        save();
        handlers?.rebuild?.();
    }, { title: '把这一格恢复成默认值（' + DEF.min + ' ~ ' + DEF.max + '）' });
    reset.classList.add('bc-param-reset');
    try { reset.disabled = (Number(st.implantDaysMin) === DEF.min && Number(st.implantDaysMax) === DEF.max); } catch { /* 忽略 */ }
    row.appendChild(reset);
    row.appendChild(h('span', {
        class: 'bc-hint bc-hint-inline',
        text: '受精之后过几天才着床：这个区间里每天的可能性都一样',
    }));
    return row;
}

function implantTimingRow(handlers) {
    let onDay = true;
    try { onDay = settings().implantJudgeOnDay !== false; } catch { onDay = true; }
    const row = h('div', { class: 'bc-inline bc-rule-row' });
    row.appendChild(h('span', { class: 'bc-label', text: '着床判定什么时候掷' }));
    const opts = [['day', '到着床日才掷'], ['fertile', '受精时掷']];
    const wrap = h('div', { class: 'bc-modesw' });
    const els = {};
    const sync = () => {
        let cur = 'day';
        try { cur = settings().implantJudgeOnDay === false ? 'fertile' : 'day'; } catch { cur = 'day'; }
        for (const [id] of opts) els[id]?.classList.toggle('active', id === cur);
    };
    for (const [id, label] of opts) {
        const el = h('div', {
            class: 'bc-modesw-opt', text: label,
            title: id === 'day'
                ? '那几天里结果还没定，到着床日（或跳过之后第一次推演）才掷出来'
                : '受精那一轮就掷好，到着床日才告诉你',
        });
        el.onclick = () => {
            settings().implantJudgeOnDay = (id === 'day');
            save();
            sync();
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    row.appendChild(wrap);
    row.appendChild(h('span', {
        class: 'bc-hint bc-hint-inline',
        text: '两档都只掷一次。剧情要是提前给了结论（孕检、魔法感应），用「改数值」里那几颗直接设，插件不猜正文',
    }));
    return row;
}

function spermGroup(handlers) {
    const box = h('div', { class: 'bc-spermblock' });
    box.appendChild(h('div', { class: 'bc-spermblock-title', text: '精子怎么算' }));
    const row = h('div', { class: 'bc-inline bc-rule-row' });
    row.appendChild(h('span', { class: 'bc-label', text: '精子跨不跨周期' }));
    row.appendChild(cycleModeSwitch(handlers));
    // ★ 光靠两档的名字看不出这档在干什么（抽象的问题式标签试过，玩家读不懂 ⇒ 改讲结果）
    //   ⇒ 行尾补一句大白话，把两档的**差别**说出来（不是重复名字，是讲后果 ✓）
    row.appendChild(h('span', {
        class: 'bc-hint bc-hint-inline',
        // ★ 两档成对读：前半讲"不清空但各自失效"，后半讲"直接全清"
        //   （只写"不会全部死亡"会被读成"精子不会死" ✗）
        text: '换周期不清空，每批到自己的存活期才失效；不跨的档一到新周期就全部归零',
    }));
    box.appendChild(row);
    box.appendChild(spermLifeRow(handlers));
    box.appendChild(judgeBasisRow(handlers));
    return box;
}

/**
 * ★★ 「判定取哪个数」两档（2026-10-20）—— 累计受孕率（默认）/ 只算还活着的批次。
 *
 * 口径：**只换"判定那一刻拿哪个数"**，不换累计受孕率那个数本身
 *   ⇒ 面板上 d2 永远还是累计（两档一样），变的只有判定卡上的「判定值」✓
 *
 * ⚠️ 和结算方式那两档不同：这一档**不做"等周期边界"那一套**（它不改任何已经发生的数，
 *   只影响"下一次判定用哪个数" ⇒ 立刻改、下次判定生效就够了 ✓）
 */
function judgeBasisRow(handlers) {
    const s = settings();
    // 不在"按精子存活"模式下就没有存活期 ⇒ 两档结果恒等，说明一下并压暗（不隐藏 ✓）
    const on = (s.cycleSettleMode === 'sperm')
        || (s.cycleSettlePending === 'sperm');
    const row = h('div', { class: 'bc-inline bc-rule-row bc-judgebasis' + (on ? '' : ' off') });
    row.appendChild(h('span', { class: 'bc-label', text: '判定取哪个数' }));
    // ★ 顺序＝**默认那一档排左边**（跟 `cycleModeSwitch` 同一条规矩 ✓）
    // ⚠️ 名字不许再出现「存活」两个字：上面「精子跨不跨周期」那颗已经用了那个词，
    //    两处同名会被读成"同一个开关的两份" ✗
    // ★ 选项名用"玩家能看懂的结果"，不用"只算还活着的批次"这种绕的说法（2026-10-20）
    const opts = [['cumulative', '累计所有批次'], ['alive', '仅计算存活批次']];
    const wrap = h('div', { class: 'bc-modesw' });
    const els = {};
    const sync = () => {
        const cur = settings().judgeBasis === 'alive' ? 'alive' : 'cumulative';
        for (const [id] of opts) els[id]?.classList.toggle('active', id === cur);
    };
    for (const [id, label] of opts) {
        const el = h('div', {
            class: 'bc-modesw-opt', text: label,
            title: id === 'alive'
                ? '失效的精子直接剔除，不算进当前这次受孕率'
                : '哪怕精子已经失效，之前累积的概率依然保留',
        });
        el.onclick = () => {
            settings().judgeBasis = id;
            save();
            sync();                       // ★ 立刻反馈（只 save 不动 DOM ⇒ 看着像坏的）
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    row.appendChild(wrap);
    row.appendChild(h('span', {
        class: 'bc-hint bc-hint-inline',
        text: on
            ? '仅改变受孕率的计算方式。修改后从下次判定生效，不追溯已经判过的数据'
            : '只在上面选「跨：自然失效」时有区别（不跨的档没有存活期，两档结果一样）',
    }));
    return row;
}

/**
 * @param {HTMLElement} container
 * @param {{refresh?:Function, rebuild?:Function}} handlers
 */
/**
 * 精子存活期的范围（最短/最长），只挂在「生理周期模块」卡片上。
 *
 * 要求：做一个最长最短，然后不需要做加权吧？
 *       ★ 2026-10-18：要求随机就是真随机，禁止伪随机 ⇒
 *         这里就是**范围内均匀掷**，每天概率一样；想要更长就把最长填大，但不许暗改概率 ✓
 */
function spermLifeRow(handlers) {
    const s = settings();
    // 不在"按精子存活"模式下就说明它是干嘛的、并压暗（不隐藏，免得人以为没这功能）
    const on = (s.cycleSettleMode === 'sperm')
        || (s.cycleSettlePending === 'sperm');
    const row = h('div', { class: 'bc-inline bc-spermlife' + (on ? '' : ' off') });
    row.appendChild(h('span', { class: 'bc-label', text: '精子存活期（天）' }));

    const mk = (val, key, ph) => {
        const inp = h('input', {
            type: 'number', min: '1', max: '30', step: '1',
            class: 'bc-num-sm', value: String(val), placeholder: ph,
            title: key === 'spermLifeMin' ? '最短活几天' : '最长活几天',
        });
        inp.onchange = () => {
            let v = Math.round(Number(inp.value));
            if (!Number.isFinite(v)) v = key === 'spermLifeMin' ? 1 : 7;
            v = Math.max(1, Math.min(30, v));
            const st = settings();
            st[key] = v;
            // 顺手保证 min ≤ max（别让用户配出一个空区间）
            if (Number(st.spermLifeMin) > Number(st.spermLifeMax)) {
                if (key === 'spermLifeMin') st.spermLifeMax = v;
                else st.spermLifeMin = v;
            }
            inp.value = String(v);
            save();
            handlers?.rebuild?.();
        };
        return inp;
    };
    row.appendChild(mk(s.spermLifeMin ?? 1, 'spermLifeMin', '1'));
    row.appendChild(h('span', { class: 'bc-num-sep', text: '~' }));
    row.appendChild(mk(s.spermLifeMax ?? 7, 'spermLifeMax', '7'));
    // ★★ 每个条目都有自己单独的重置（要的是整个条目，不是单格）——
    //   这一行是**手写的行**（不是参数面板那种 spec 条目）⇒ 原来一颗「↩」都没有 ✗
    //   默认值就取 `settings.js` 里那两条的出厂值 ✓（换出厂值要一起改这里）
    const SPM_DEF = { min: 1, max: 7 };
    const reset = button('↩', () => {
        const st = settings();
        st.spermLifeMin = SPM_DEF.min;
        st.spermLifeMax = SPM_DEF.max;
        save();
        handlers?.rebuild?.();
    }, { title: '把这一格恢复成默认值（' + SPM_DEF.min + ' ~ ' + SPM_DEF.max + '）' });
    reset.classList.add('bc-param-reset');
    // ★ 置灰的判据＝"两个数都等于默认值"（跟参数面板那条同一个口径 ✓）
    try {
        reset.disabled = (Number(s.spermLifeMin) === SPM_DEF.min && Number(s.spermLifeMax) === SPM_DEF.max);
    } catch { /* 忽略 */ }
    row.appendChild(reset);
    row.appendChild(h('span', {
        class: 'bc-hint bc-hint-inline',
        // ★ 文案口径（2026-10-20 定）：说结果，别说过程 —— 不讲"掷一次""算不算它"，
        //   直接讲"过期会怎样、会不会扣数"✓
        text: on
            ? `每批精子在这两个数之间随机存活。过期失效只影响这次计算，已经累积的受孕率不会扣减`
            : '只在上面选「跨：自然失效」时有用（不跨的档一到新周期就清零，用不到存活期）',
    }));
    return row;
}

/**
 * 「周期结算方式」的紧凑两档切换（在「精子怎么算」那一组的第一行）。
 *
 * 它是**规则变体**，不是开关 —— 这相当于选择难度而不是随手的啃面包。
 * 改动只写进 cycleSettlePending，等周期边界才换挡（AI 全程只看到一种规则）✓
 *
 * ⚠️ 点击要用 onclick（本项目 h() 的约定），并且**立刻更新视觉** ——
 *    用 addEventListener 且不动 DOM 会让人以为「无法点击切换」✗
 */
function cycleModeSwitch(handlers) {
    const wrap = h('div', { class: 'bc-modesw', title: '规则变体：切换后从下一个周期开始生效' });
    // ★ 选项名＝回答"换周期会不会清空"，而不是讲"精子怎么死"（2026-10-20 定）
    const opts = [['sperm', '跨：不随新周期清空'], ['reset', '不跨：进新周期清零']];
    const els = {};

    const sync = () => {
        const now = (settings().cycleSettlePending || '') || (settings().cycleSettleMode || 'reset');
        for (const [id] of opts) {
            const el = els[id];
            if (!el) continue;
            el.classList.toggle('active', id === now);
        }
        const hasPending = settings().cycleSettlePending && settings().cycleSettlePending !== (settings().cycleSettleMode || 'reset');
        if (hasPending) wrap.title = '已选中，本周期结束后自动换过来';
        else if (hasConceptionData()) wrap.title = '规则变体。这个聊天已经在跑，改动会等下一个周期开始时生效';
        // ⚠️ 说真话：判据是"这个聊天有没有推演数据"，不是"聊天新旧" ✗
        //    （旧聊天如果从没跑过插件，同样是没有数据 ⇒ 同样立刻生效 ✓）
        else wrap.title = '规则变体。这个聊天还没有推演数据，改动立刻生效';
    };

    for (const [id, label] of opts) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            const cur = settings().cycleSettleMode || 'reset';
            // ★ 这个聊天还没有推演数据 ⇒ 直接生效 ✓
            //   判据是「插件里有没有这个聊天的账」，不是「聊天新不新」✓
            //   （旧聊天若从没跑过插件，同样没有账 ⇒ 同样立刻生效）
            //   没有账就没有"数据不自洽"的风险，延迟只会让它显得没生效 ✗
            if (!hasConceptionData()) {
                settings().cycleSettleMode = id;
                settings().cycleSettlePending = '';
            } else {
                settings().cycleSettlePending = (id === cur) ? '' : id;   // 选回生效中的 = 取消待切换
            }
            save();
            sync();                       // ★ 立刻反馈（只 save 不动 DOM ⇒ 看着像坏的）
            // ★ 必须走 rebuild：卡片上那个 TOKEN 徽章是它算的，
            //   只调轻量 refresh 的话数字不会跟着动 ✓
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    return wrap;
}

/**
 * 补丁页顶部的「**默认**周期模式」切换 ✓
 *
 *   · 有月经（默认，**完整保留** ✓）
 *   · 非月经（不描写经血、阶段名换一套、月经专属段落扣掉 ✓）
 *   · ⚠️ **受孕机制完全一样** ✓（受孕机制还是和月经模式一样）
 *
 * ★ 它只管「**新建角色的默认档**」：
 *   周期模式是**按人**的（世界观里可以同时有"有月经怀孕"和"非月经怀孕"）
 *   ⇒ 每个人可以在「角色基础信息」里各自改 ✓
 *   这里改的是"没单独设过的人跟着哪一档" ✓
 */
function periodModeSwitch(handlers) {
    const cur = () => {
        const v = settings().periodMode;
        return (v === 'none' || v === 'amenorrhea') ? v : 'normal';
    };
    const wrap = h('div', { class: 'bc-modesw',
        title: '默认档：没在「角色基础信息」里单独设过的对象跟着它。月经 / 非月经只差名字与描写（受孕率、判定、结算完全一样）；无月经 = 这个人没有周期、没有阶段' });
    // ★ 界面上的档位名统一成「月经 / 非月经 / 无月经」（三档 ✓ —— 名字走
    //   settings.js 的 `cycleModeLabel`，三个页面共用一份，别在各自写 if ✓）
    const opts = [['normal', '月经'], ['none', '非月经'], ['amenorrhea', '无月经']];
    const els = {};
    const sync = () => {
        const now = cur();
        for (const [id] of opts) els[id]?.classList.toggle('active', id === now);
    };
    for (const [id, label] of opts) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            settings().periodMode = id;
            save();
            sync();
            // ★ 必须 rebuild：TOKEN 总览、阶段名、各处文案都跟着变 ✓
            handlers?.rebuild?.();
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    return wrap;
}

/**
 * 补丁页 · **人物**视图的「角色基础信息」卡（四态锁定 + 别名备注）。
 *
 * **这些面板在规则补丁那里也要有一份**（角色基础信息不只是用户角色用的）✓
 *   ⇒ 那四格 + 别名备注在这儿也来一份（内容走 `ui-settings.js` 的共用实现 ✓
 *     和设置页「你自己」、悬浮球弹窗**同一份**，三处不会各写一遍 ✗）
 * ⚠️ 「你自己」那一份存**全局设置**（穿所有聊天 ✓），别的对象存**本聊天档案** ——
 *   这个分流在 `store.js` 的 `bodyLockOf / setBodyLockField` 里，共用实现自动走对 ✓
 */
function personBasicInfoCard(targetKey, rerender) {
    const body = h('div', { class: 'bc-card-body' });
    const onChange = () => { try { rerender?.(); } catch { /* 忽略 */ } };
    // ★ 规则补丁的人物这里不重复画「属于哪个大类」那一格（下面有一个 ✓）
    //   ＋这一页也带上**种族名**（要能自定义名字）
    //   ⇒ 这张卡**不重复画**那两格（下面「身体补丁（生理设定）」的参数面板里都有 ✓）。
    //   ⚠️ **只在下面那份真的画得出来时才藏**：
    //     ① 无月经那一档：身体补丁整条不发、卡片也不画 ⇒ 下面没有
    //     ② 这条正文被冻结：卡里换成"冻结提示条"、参数面板不画 ⇒ 下面也没有
    //     这两种情况下必须把这两格留在上面，否则在人物里就彻底找不到它们了 ✗
    //     （本项目老规矩：被藏起来的控件 = 等于不存在 ✓）
    let paramBelow = true;
    try {
        paramBelow = !isNoCycleMode(periodModeOf(targetKey)) && !isPatchFrozen('body_base', targetKey);
    } catch { paramBelow = true; }
    bodyLockRows(body, targetKey, { onChange, hideParamDup: paramBelow });
    // ★ 2026-10-24：察觉档位（A~E）——这里也能改；玩家自己存全局，别的存本聊天
    {
        const curTier = (() => { try { return awarenessTierIdOf(targetKey); } catch { return ''; } })();
        const tierOpts = [
            ['', '自动（交给 AI 判）'],
            ['A', '极早（A）'],
            ['B', '较早（B）'],
            ['C', '普通（C）'],
            ['D', '较晚（D）'],
            ['E', '极晚（E）'],
            ['F', '几乎到生产（F）'],
        ];
        body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '察觉档位' }),
            dropdown(curTier, tierOpts, (v) => {
                try { setAwarenessTierIdOf(targetKey, v, { manual: true }); } catch { /* 忽略 */ }
                onChange();
            }),
        ));
        body.appendChild(h('div', {
            class: 'bc-hint',
            text: '决定这个角色大概什么时候开始起疑；留空＝由推演按角色设定判一次。选了就锁定，AI 不再改；它只做参考，确认仍要看剧情事件',
        }));
    }
    // ★ 「别名与备注」那个小标题 + 折叠由 `identRows` 自己出 ✓
    identRows(body, targetKey, { onChange: () => {} });
    return h('div', { class: 'bc-card bc-basicinfo-card' },
        cardHead('角色基础信息', [
            '这四项是「插件自己不可能知道、只能由你告诉它」的事。留空就一直按推演每轮报的走',
            '能不能怀孕：填「不能」⇒ 插件不再给这个人算受精 / 周期那几套',
            '能不能让别人怀孕：填「不能」⇒ 这个人不会被算进「致孕方候选」',
            '能不能怀上异种：填「不能」⇒ 这个人不会因为异种族致的致孕方而受孕',
            '是不是异种：填「是」⇒ 异种那套规则第一轮就发，不用等推演报回来',
            '别名：推演报的名字只要在这里出现过，就会对回这一份档；多个用 / 、或空格隔开（同名两个角色各填不同别名就不会串）',
            '标签：分类用，比如「未来篇」「十年后」。它没有内置词表，推演看到剧情怎么写就报什么，你手填过就以你为准；只挂在一个对象身上的标签还能当别名用',
            '备注：纯说明，不参与匹配，用来提醒自己这是哪个同名的人',
            // ⚠️ 不要写"这里改的是当前这个对象那一份；「你自己」那一份在设置页" ✗
            //   读起来像"这一页改不了你自己"，实际**选中你自己就能在这儿改** ✓
            '这里改的是上面选中的那个对象；选到你自己的名字，就是在改你自己那份',
            '察觉档位：决定这个角色大概什么时候开始起疑；留空＝由推演按角色设定判一次。选了就锁定 AI 不再改；它只做参考，确认仍看剧情事件',
            '你自己那份存在插件设置里，穿所有聊天；别的角色那份只跟当前聊天走',
            '设置里那页「用户角色基础信息」是同一个入口，专门给你自己用',
        ]),
        body,
    );
}

/**
 * 补丁页 · **人物**视图的「周期起始」行。
 *
 * 剧情里的 NPC 周期可以随机 ROLL；玩家需要自己设置、自由度高
 *   ⇒ 这一行放在**人物**视图 ✓
 *   ⚠️ 放进**世界观**视图会找不到 ✗
 *      （教训：入口要放在"那一刻人在哪"，别按自己的信息架构分类 ✓）
 * ⇒ **本人默认指定**（留空 = 自动取卵泡中期）；**NPC 默认随机** ✓
 * ⚠️ 它只管"这个人的起始**还没定过**"的时候 ——
 *   已经在跑的那个人，去「改数值」里改「现在处于周期第几天」 ✓
 */
function personCycleStartRow(targetKey, rerender) {
    const autoDay = (() => { try { return defaultCycleStartDay(targetKey); } catch { return 9; } })();
    const now = (() => { try { return cycleDayNow(targetKey); } catch { return null; } })();

    const els = {};
    const wrap = h('div', { class: 'bc-modesw' });
    const readout = h('div', { class: 'bc-hint' });
    const input = numberInput('', (v) => {
        const d = Math.round(Number(v) || 0);
        setCycleStartRuleOf(targetKey, { random: false, day: d > 0 ? d : 0 });
        paint();
    }, { min: 1, max: 999 });
    // ★ 2026-10-18（周期起始的问号位置很奇怪）——
    //   根因：`.bc-input` 默认 width:100%，在这一行 flex 里抢满整行 ⇒ 把「？」挤到下一行、
    //   孤零零挂在输入框左下角 ✗
    //   ⇒ 给输入框一个固定小宽度（只有两三位数），「？」就回到同一行右侧 ✓
    input.placeholder = '第几天';
    input.style.width = '100%';
    const inputBox = h('div', { style: { flex: '0 0 118px', minWidth: '96px' } }, input);

    const paint = (r) => {
        const cur = r || cycleStartRuleOf(targetKey);
        els.random?.classList.toggle('active', cur.random);
        els.day?.classList.toggle('active', !cur.random);
        input.value = cur.random ? '' : (cur.day > 0 ? String(cur.day) : '');
        inputBox.style.display = cur.random ? 'none' : '';
        const tail = (now === null)
            ? '｜这个角色还没有周期状态，下一次推演会按上面这档种上'
            : `｜这个角色现在第 ${now} 天（已经在跑了，改上面这档不会动它；要改去「改数值」）`;
        readout.textContent = cur.random
            ? `随机：建档时在 1 到周期长度之间掷一天${tail}`
            : `指定：留空就自动取卵泡中期（当前参数下第 ${autoDay} 天）${tail}`;
    };
    for (const [id, label] of [['random', '随机'], ['day', '指定']]) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            setCycleStartRuleOf(targetKey, { random: id === 'random' });
            paint();
            try { rerender?.(); } catch { /* 忽略 */ }
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    paint();

    return h('div', {},
        h('div', { class: 'bc-toolbar' },
            h('div', { class: 'bc-toolbar-label', text: '周期起始' }),
            wrap,
            inputBox,
            helpButton('周期起始', [
                '这个人还没有周期状态时，从周期的第几天开始',
                '随机：建档那一刻在 1 到周期长度之间掷一天（剧情里的 NPC 默认走这个）',
                '指定：留空就自动取卵泡中期（默认参数下是第 9 天），也可以自己填一天',
                '只管还没开始的：已经在跑的那个人，去悬浮球菜单的「改数值」里改「现在处于周期第几天」',
                '改这里不会重算任何已经跑起来的周期',
            ]),
        ),
        readout,
    );
}

/**
 * 补丁页 · **人物**视图的「身体痕迹追踪」开关。
 *
 * 身体痕迹与恢复追踪那张**规则卡**放**世界观**里，人物这边只给一个按钮
 *   选是否给这个角色开启追踪，操作跟周期模式一样
 * ⇒ 那张**规则卡**搬去**世界观**视图（见 `VIEW_OVERRIDE` ✓），
 *   人物这边只留**这个人要不要**（开 / 关两态，跟周期模式那一行同一个样式 ✓）
 *
 * ⚠️ 关掉 = 这条模块**不发给他的那一份**（主 API / 插件 API 两条路都走 `patchSendGroups` ✓），
 *   名单里同时标一句「未开启身体痕迹追踪」⇒ 推演也不会给他记痕迹 ✓
 */
function personTraceRow(targetKey, rerender) {
    const wrap = h('div', { class: 'bc-modesw',
        title: '这个角色要不要追踪身体痕迹（吻痕、指痕这类短期痕迹的残留与消退）。关掉之后这条规则不为该角色发送，推演也不会给 ta 记痕迹' });
    const els = {};
    const sync = () => {
        const on = traceOnOf(targetKey);
        els.on?.classList.toggle('active', on);
        els.off?.classList.toggle('active', !on);
    };
    for (const [id, label, val] of [['on', '开', true], ['off', '关', false]]) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            setTraceOnOf(targetKey, val);
            sync();
            try { rerender?.(); } catch { /* 忽略 */ }
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    // ★ 后果不能只挂在 hover 的 title 上 —— 本项目规矩是「说明一律走「？」」
    //   （同屏的「周期起始」就有）⇒ 补一个 ✓
    return h('div', { class: 'bc-toolbar' },
        h('div', { class: 'bc-toolbar-label', text: '身体痕迹追踪' }),
        helpButton('身体痕迹追踪', [
            '这个角色要不要追踪身体痕迹：吻痕、指痕这类短期痕迹的残留与消退',
            '关掉 = 这条规则不为 ta 发送（发给正文和推演两条路都不发），推演也不会给 ta 记痕迹',
            '规则本身（阈值、消退速度那些）在世界观视图那张卡里；这里只管这一个人开不开',
            '世界观那条「身体痕迹与恢复追踪」是总开关。它关着时，两个 API 都不收痕迹内容，也不吃 token；人物这里的开关只是先记着',
            '总开关打开才生效：那时候按这一格决定发给谁',
        ]),
        wrap,
    );
}

/**
 * 补丁页 · **人物**视图顶上的「周期模式」行（有月经 / 无月经 / 跟随默认）✓
 *
 * 为什么放这儿：周期模式是**按人**的。只塞进「角色基础信息」的话，
 *   在人物里面根本看不见可以切换成非生理期模式的东西 ✗
 *   ⇒ 要的就是"改这个人的东西时，顺手就能切" ✓（原则：入口放在那一刻人在哪 ✓）
 */
function personCycleModeRow(targetKey, rerender) {
    const explicitOf = () => {
        if (isUserKey(targetKey)) return String(settings().userCycleMode || '');
        return String(state().targets?.[targetKey]?.cycleMode || '');
    };
    const globalDefault = cycleModeLabel();
    const opts = [
        ['', `跟随默认（${globalDefault}）`],
        ['normal', '月经'],
        ['none', '非月经'],
        ['amenorrhea', '无月经'],
    ];
    const wrap = h('div', { class: 'bc-modesw',
        title: '这个人的周期模式。月经 / 非月经只差名字与描写（受孕率、判定、结算完全一样）；无月经 = 没有周期、没有阶段，那一批周期相关的条目也会给 ta 藏起来' });
    const els = {};
    const sync = () => {
        const now = explicitOf();
        for (const [id] of opts) els[id]?.classList.toggle('active', id === now);
    };
    for (const [id, label] of opts) {
        const el = h('div', { class: 'bc-modesw-opt', text: label });
        el.onclick = () => {
            setPeriodModeOf(targetKey, id);
            sync();
            try { rerender?.(); } catch { /* 忽略 */ }
        };
        els[id] = el;
        wrap.appendChild(el);
    }
    sync();
    // ★ 后果不能只挂在 hover 的 title 上 ⇒ 按项目规矩（说明走「？」）补一个 ✓
    return h('div', { class: 'bc-toolbar' },
        h('div', { class: 'bc-toolbar-label', text: '周期模式' }),
        helpButton('周期模式', [
            '这个人的周期模式（只影响 ta 一个；选「跟随默认」就按设置里那档走）',
            '月经 / 非月经只差名字与描写：受孕率、受精判定、周期结算完全一样',
            '无月经 = 没有周期、没有阶段，那一批周期相关的条目也会给 ta 藏起来',
        ]),
        wrap,
    );
}

/**
 * 世界观：**两档的名字**（术语 / 阶段名）—— 玩家可以自己起名 ✓
 *
 * 把自定义模式的生理期规则修改放到**世界观**那里，方便玩家自定义 ✓
 *
 * ⚠️⚠️ 这张卡上容易连错两次，别犯：
 *   ① 把"默认那档"做成**永久只读** ✗
 *   ② 把"默认那档"改成**跟着「补丁编辑范围」走** ✗
 *   ⇒ 根因：**"默认 / 自定义"说的是那个开关的两档**（默认＝只能改数值 / 自定义＝全文可改），
 *      **不是**有月经 / 无月经 ✗ —— 两个不相干的东西不能绑在一起 ✗✗
 *   ⇒ 正解：这张卡就是**两张普通的设置表**，**两档都能填**；能不能改正文是**那个开关**的事，
 *      与这里无关 ✓（别往这张卡上加任何"锁" ✗）
 */
function periodNamesCard(handlers) {
    const s = settings();
    const ensure = () => {
        if (!s.termNamesNormal || typeof s.termNamesNormal !== 'object') s.termNamesNormal = {};
        if (!s.termNamesNone || typeof s.termNamesNone !== 'object') s.termNamesNone = {};
        if (!s.phaseNamesNormal || typeof s.phaseNamesNormal !== 'object') s.phaseNamesNormal = {};
        if (!s.phaseNamesNone || typeof s.phaseNamesNone !== 'object') s.phaseNamesNone = {};
    };
    ensure();

    /** 写一格：留空 = 回到内置默认 ✓ */
    const write = (bagKey, id, v) => {
        ensure();
        const val = String(v || '').trim();
        if (val) s[bagKey][id] = val; else delete s[bagKey][id];
        save();
        // ⚠️ 这里**不许 rebuild** ✗ —— textInput 是每敲一个字符就回调一次，
        //   而 rebuild 会把整页拆了重建 ⇒ 正在打字的那个输入框被摘掉、焦点回 body，
        //   一个字要点一次输入框（同文件 466 行那段写明过这条规矩 ✓）
    };
    const rowFor = (id, fallback, bagNormal, bagNone) => h('div', { class: 'bc-names-row' },
        h('div', { class: 'bc-names-cell', text: id }),
        h('div', { class: 'bc-names-cell' },
            textInput(String(s[bagNormal][id] ?? ''), (v) => write(bagNormal, id, v), { placeholder: fallback })),
        h('div', { class: 'bc-names-cell' },
            textInput(String(s[bagNone][id] ?? ''), (v) => write(bagNone, id, v), { placeholder: fallback })),
    );

    const grid = h('div', { class: 'bc-names-grid' });
    grid.appendChild(h('div', { class: 'bc-names-row bc-names-head' },
        h('div', { class: 'bc-names-cell', text: '项目' }),
        // ★ 第二列**不是"无月经档"专用** ——
        //   termNameOf / phaseNameOf 里 `isNeutralMode(mode)` 为真就用 `termNamesNone`，
        //   而它同时覆盖「非月经」和「无月经」两档（无月经那档压根没有阶段名可改）✗
        h('div', { class: 'bc-names-cell', text: '有月经那档叫什么' }),
        h('div', { class: 'bc-names-cell', text: '非月经 / 无月经那档叫什么' }),
    ));
    // 术语（⚠️ 两张表里有同名 id —— `ovulationDay` 两边都有 ⇒ 必须显式传 bagKey，别去猜 ✗）
    grid.appendChild(h('div', { class: 'bc-names-row bc-names-group' },
        h('div', { class: 'bc-names-cell', text: '术语' })));
    for (const id of Object.keys(DEFAULT_TERM_NAMES)) {
        grid.appendChild(rowFor(id, DEFAULT_TERM_NAMES[id], 'termNamesNormal', 'termNamesNone'));
    }
    // 阶段名
    grid.appendChild(h('div', { class: 'bc-names-row bc-names-group' },
        h('div', { class: 'bc-names-cell', text: '阶段名' })));
    for (const id of Object.keys(DEFAULT_PHASE_NAMES)) {
        grid.appendChild(rowFor(id, DEFAULT_PHASE_NAMES[id], 'phaseNamesNormal', 'phaseNamesNone'));
    }

    // 整个都很奇怪：原来它用的是可折叠 `.bc-section`，
    //   而上面「默认周期模式」用的是 `.bc-card` ⇒ 两种标题的内边距不一样
    //   （「？」贴着卡片顶边、标题离左边界也更近）✗
    //   ⇒ 统一成 `.bc-card` ＋ `.bc-card-head` 那一套，只是内容默认折起来 ✓
    const help = helpButton('生理期名字（两档各一套）', [
        '规则只有一份，名字由插件按每个人属于哪一档替换。这里可以改两档各自叫什么',
        '改名字完全不影响受孕率、判定、结算',
        '留空 = 用内置默认',
    ]);
    const boxBody = h('div', { class: 'bc-card-body' });
    boxBody.appendChild(grid);
    boxBody.appendChild(h('div', { class: 'bc-row' },
        button('↩ 全部恢复内置默认', async () => {
            if (!(await askConfirm('把这两张表全部恢复成内置默认名字？'))) return;
            s.termNamesNormal = {};
            s.termNamesNone = {};
            s.phaseNamesNormal = {};
            s.phaseNamesNone = {};
            save();
            handlers?.rebuild?.();
        }, { variant: 'danger' })));
    boxBody.style.display = 'none';

    const caret = h('span', { class: 'bc-sec-caret', text: '▸' });
    const head = h('div', { class: 'bc-card-head bc-sec-toggle', title: '点击收起 / 展开' },
        caret,
        h('div', { class: 'bc-card-title', text: '生理期名字（两档各一套）' }),
        h('div', { class: 'bc-spacer' }),
        help,
    );
    help.addEventListener('click', (e) => e.stopPropagation());
    let open = false;
    head.addEventListener('click', () => {
        open = !open;
        caret.textContent = open ? '▾' : '▸';
        boxBody.style.display = open ? '' : 'none';
    });

    const box = h('div', { class: 'bc-card bc-names-card' }, head, boxBody);
    return box;
}

export function renderModulesTab(container, handlers = {}) {
    const { refresh } = handlers;
    clear(container);
    const s = settings();
    if (!s.ui) s.ui = {};
    const rerender = () => { if (handlers.rebuild) handlers.rebuild(); else renderModulesTab(container, handlers); };

    // ★ 当前是哪个视图（世界观 / 人物）—— 页面只列**这个视图**的模块 ✓
    const view = (s.ui.patchView === 'person') ? 'person' : 'world';
    const isWorld = view === 'world';
    // ★ 两条敏感带模块的**界面归属**：
    //   敏感带记录是选开的东西，敏感带自定义是在敏感带记录基础上才用得上的东西
    //   ⇒ 世界观那里放敏感带记录 ✓
    //   ⇒ 「身体敏感带记录」＝这套功能的总开关 ⇒ 显示在**世界观** ✓
    //   ⇒ 「敏感带自定义」＝内容/起点，跟着记录走 ⇒ 显示在**人物**（旁边就是那张表 ✓）
    //   ⚠️ 只改**显示**，不动 `scope`（scope 管的是"提示词发几份"，两件事别混 ✓）
    //   ⇒「生理期系统」：**放世界观**、人物那里【只是】给那个人一个
    //     切换**是否月经怀孕** ✓
    //     —— "自定义模式"＝「**全文可改**」（自定义只是
    //        全文可改的顺口叫法 ✓）⇒ 判据就是 `patchScope() === 'full'` ✓
    //     ⚠️ 定稿就这两句：
    //        ①**位置 = 世界观**；②**可见性 = 只在「全文可改」下**（平常根本不列它 ✓）
    // ⚠️ 例外表 `VIEW_OVERRIDE` 已提到文件上面（跳转那边也要用它认视图 ✓ 见 viewOfModule）
    const PERIOD_SYSTEM = 'period_system';
    const scoped = (id) => {
        // 生理期系统：世界观视图里**常驻**（不然就成"全文可改"模式下才能用了，这不对）
        //   ⚠️ 不能做成「只有自定义（=全文可改）模式下可以看见」——
        //     数值档下这张卡整个消失、连"有这个板块"都看不出来 ✗
        if (id === PERIOD_SYSTEM) return isWorld;
        const ov = VIEW_OVERRIDE[id];
        if (ov) return ov === view;
        return (moduleScope(id) === 'global') === isWorld;
    };
    // ★★ 人物那里**每个人和每个人不一样** ⇒ 按**当前正在编辑的这个人**判 ✓
    //   ⚠️ 不能按"**名单里没有人**属于有月经那一档才藏"：那会让 B 的档决定 A 看到什么 ✗
    //     · 这个人自己是 非月经 / 无月经 ⇒ 藏掉"生理期"那几条（他根本用不到）✓
    //     · 这个人自己是 **无月经** ⇒ 连「身体补丁（生理设定）」一起藏（没有周期的人 ✓）
    //   ⚠️ 只藏**显示**：开关状态和已经填过的数据一个字都不动 ✓
    //   ⚠️ 世界观视图没有"某个人" ⇒ 还是看名单整体（`anyTargetHasCycle()` ✓）
    const _viewKey = isWorld ? null : (() => { try { return personTargetKey(); } catch { return null; } })();
    const _viewMode = (() => { try { return periodModeOf(_viewKey); } catch { return 'normal'; } })();
    const pmNone = isWorld ? !anyTargetHasCycle() : (_viewMode !== 'normal');
    const pmNoCycle = !isWorld && _viewMode === 'amenorrhea';
    //   ⚠️ 但**「生理期系统」例外**：它是一条**大规则**，在世界观视图里**常驻显示** ✓
    //     （数值档下它显示成"已冻结"，和别的判定规则一样 ✓ 见上面 `scoped`）
    //     ⇒ 它也不受"非月经隐藏"影响 ✓
    //     ⇒ 藏的只是"当前用不到的**数据/描写**类"（生理期体质补丁、经期其他角色反应）✓
    const isPeriodGated = (m) => m.id !== PERIOD_SYSTEM
        && (Array.isArray(m.gate) ? m.gate : [m.gate]).includes('menstruation');
    const viewMods = MODULES.filter(m => scoped(m.id)
        && !(pmNone && isPeriodGated(m))
        && !(pmNoCycle && NO_CYCLE_HIDDEN_IDS.includes(m.id)));

    // ★ 草稿表：**还没保存**的编辑 ✓
    //   为什么要它：TOKEN 要跟着你**正在敲的内容**变，
    //   而读设置只能读到上次保存的值 ✗（只有在保存之后才会估算 TOKEN ✗）
    const _draft = {};
    // 汇总各数字徽章的引用 ⇒ 刷新时只改它们的文本，**不重建 DOM** ✓
    const _barEls = {};

    // 人物视图：正在编辑哪个对象（世界观视图不需要它 ✓）
    const targetKey = isWorld ? null : personTargetKey();
    const _tkTarget = targetKey;   // null ⇒ 不传对象 ✓

    // ★ 取文本的方式必须和**实际发送**一致（judge.js / prompt.js 都是这么做的 ✓）：
    //   全局模块 ⇒ 不传对象；对象模块 ⇒ 按当前编辑的对象取 ✓
    const _tkText = (id) => {
        // ★ 草稿优先（你正在编辑但还没保存的内容 ✓）
        if (_draft[id] !== undefined) return _draft[id];
        return moduleScope(id) === 'global' ? moduleText(id) : moduleText(id, _tkTarget);
    };

    const _pluginMods = viewMods.filter(m => moduleRole(m.id) !== 'main');
    // ★ 非月经模式下，带「来月经时」门控的模块**永远不会发** ✓（而且已经从 viewMods 里藏掉了 ✓）
    //   ⇒ 它们也不该出现在 TOKEN 统计里（否则"全开"那个数字会误导 ✓）
    const _pmIsNone = pmNone;
    // ★ 两个桶都按 `isGated` 分（**带上 gateAny**）——
    //   ⚠️ 只判 `m.gate` 的话 ⇒ 只用 gateAny 的模块被算进"常驻"，TOKEN 总览报错 ✗
    const alwaysOn = _pluginMods.filter(m => !isGated(m));
    const gatedOn = _pluginMods.filter(m => isGated(m)
        && !(_pmIsNone && (Array.isArray(m.gate) ? m.gate : [m.gate]).includes('menstruation')));

    const _updateTokenBar = () => {
        const tx = (id) => (_draft[id] !== undefined ? _draft[id] : _tkText(id));
        const a = sumTokens(alwaysOn.filter(m => moduleActive(m.id, null)).map(m => tx(m.id)));
        const g = sumTokens(gatedOn.filter(m => moduleActive(m.id, null)).map(m => tx(m.id)));
        setBadge(_barEls.always, a);
        setBadge(_barEls.gated, g);
        setBadge(_barEls.total, a + g);
    };

    // ★ 一个统一的 handlers（内部传递用 ✓）——
    //   ⚠️ 每次新建 `{ refresh, rebuild }` 的话，塞的字段会被丢掉 ✓
    const H = {
        ...handlers, refresh, rebuild: rerender,
        // 卡片里的编辑器改动时调它 ✓（只改数字，不重建 ✓）
        onDraftEdit: (id, text) => { _draft[id] = text; _updateTokenBar(); },
        onDraftClear: (id) => { delete _draft[id]; _updateTokenBar(); },
    };

    // ---- 顶部：视图切换（世界观 / 人物）----
    //   ⚠️ 对象选择器要塞进**这张卡的 body** 里 —— 直接 append 到 page container 的话，
    //      它会跑到卡片**上面**去（h() 的参数先求值、卡片后挂 ✓）
    const viewBody = h('div', { class: 'bc-card-body' });
    // 补丁视图这行标题可以删掉 —— 下面两个页签（世界观 / 人物）
    //   已经把"这是哪一视图"说清楚了，再挂一行同名标题就是重复 ✗
    //   ⇒ 视图切换 ＋ 「？」直接摆在页顶，不再套一张卡 ✓
    viewBody.appendChild(h('div', { class: 'bc-inline bc-viewsw-head' },
        viewSwitch(handlers),
        h('div', { class: 'bc-spacer' }),
        helpButton('补丁视图', [
            isWorld
                ? '世界观：所有对象共用的规则。改一次，名单里每个人都按这套走'
                : '人物：某一个人的专属设定。没给他改过的条目，他自己那份就是内置默认',
            '「补丁编辑范围」只能改数值：判定规则的正文锁住（数字照常能改），切到「全文可改」才能改文字',
            '「全文可改」：所有文字都能改，改坏了判定后果自负',
        ]),
    ));
    // ★「补丁编辑范围」跟「正在编辑」并排（在补丁页顶上 ✓）
    viewBody.appendChild(h('div', { class: 'bc-toolbar' },
        h('div', { class: 'bc-toolbar-label', text: '补丁编辑范围' }),
        patchScopeSwitch(H),
    ));
    if (!isWorld) {
        personTargetSelector(viewBody, rerender);
        // ★ 这些面板在规则补丁这里也要有一份
        //   （角色基础信息不只是用户角色用的）⇒ 四态锁定 + 别名备注在这儿也来一份 ✓
        viewBody.appendChild(personBasicInfoCard(targetKey, rerender));
        // ★ 这个人的「周期模式」（有月经 / 无月经）—— **按人** ✓
        //   ⚠️ 只放进「角色基础信息」（悬浮球弹窗 + 设置页）的话，人物里面看不到 ✗
        //     ⇒ 补在人待着的地方（补丁页 · 人物视图的对象选择器旁边 ✓
        //        原则：入口要放在"那一刻人在哪" ✓）
        viewBody.appendChild(personCycleModeRow(targetKey, rerender));
        // ★ 这个人的「周期起始」（本人指定 / NPC 默认随机 ✓）
        //   ⚠️ 放进世界观视图会找不到 ⇒ 放在"人物"里、紧挨着周期模式 ✓
        viewBody.appendChild(personCycleStartRow(targetKey, rerender));
        // ★ 这个人的「身体痕迹追踪」开关（规则卡在世界观视图 ✓）
        viewBody.appendChild(personTraceRow(targetKey, rerender));
    }
    // ★ 说明搬进「？」（含散在卡头 / 工具条上的那几句 ✓）
    container.appendChild(viewBody);

    // ★ 有被冻结的补丁就**显眼报一句**（"静默忽略你的改动"是最恶劣那类错 ✓）
    const frozenHere = frozenPatchIds(isWorld ? null : targetKey);
    if (frozenHere.length) {
        container.appendChild(h('div', { class: 'bc-warn' },
            '有 ' + frozenHere.length + ' 条补丁被冻结（' + (isWorld ? '世界观' : '「' + targetLabel(targetKey) + '」') + '这一批）：'
            + '这些条目改过正文，而现在是「只能改数值」⇒ 正文那部分不生效（你自己填的数字照旧生效）。'
            + '切到「全文可改」就恢复；改动一个字都没删'));
    }

    // ---- TOKEN 总览（改任何东西都会重新算） ----
    // 分两档：常驻 = 每轮都发；非常驻 = 有自动门控，只在满足条件时才发
    const alwaysTk = sumTokens(alwaysOn.filter(m => moduleActive(m.id, null)).map(m => _tkText(m.id)));
    const alwaysAll = sumTokens(alwaysOn.map(m => _tkText(m.id)));
    const gatedTk = sumTokens(gatedOn.filter(m => moduleActive(m.id, null)).map(m => _tkText(m.id)));
    const gatedAll = sumTokens(gatedOn.map(m => _tkText(m.id)));
    const judgeTk = alwaysTk + gatedTk;
    const pv = previewInjection();
    const mainTk = estimateTokens(pv.patch);

    container.appendChild(h('div', { class: 'bc-token-bar' },
        h('div', { class: 'bc-token-item' },
            h('span', { class: 'bc-token-label', text: '插件 API · 常驻' }),
            (_barEls.always = tokenBadge(alwaysTk)),
            h('span', { class: 'bc-hint', text: `每轮都发　${alwaysOn.filter(m => moduleActive(m.id, null)).length}/${alwaysOn.length} 条生效（全开 ${formatTokens(alwaysAll)} tk）` }),
        ),
        h('div', { class: 'bc-token-item' },
            h('span', { class: 'bc-token-label', text: '插件 API · 非常驻' }),
            (_barEls.gated = tokenBadge(gatedTk)),
            h('span', { class: 'bc-hint', text: `带「自动」徽章，条件满足才发　${gatedOn.filter(m => moduleActive(m.id, null)).length}/${gatedOn.length} 条生效（全开 ${formatTokens(gatedAll)} tk）`
                + (_pmIsNone ? '　※ 非月经模式：经期相关的那几条已排除' : '') }),
        ),
        h('div', { class: 'bc-token-item' },
            h('span', { class: 'bc-token-label', text: '本轮合计' }),
            (_barEls.total = tokenBadge(judgeTk)),
        ),
        h('div', { class: 'bc-token-item' },
            h('span', { class: 'bc-token-label', text: '注入主 API' }),
            (_barEls.main = tokenBadge(mainTk)),
        ),
        h('div', { class: 'bc-spacer' }),
        // ★ 这四格是什么意思搬进「？」（不在页面上占一行 ✓）
        helpButton('TOKEN 总览', [
            '插件 API · 常驻：每轮都发的那些补丁总共多少',
            '插件 API · 非常驻：带「自动」徽章、条件满足才发的那些总共多少（全开值写在括号里）',
            '本轮合计：上面两格加起来，就是这一轮推演真的送出去的量',
            '注入主 API：整套注入（状态摘要 + 沉浸设定）的体量',
            isWorld
                ? '这里只算「世界观」这一批（所有对象共用，只发一次）'
                : `这里只算给「${targetLabel(targetKey)}」的「人物」这一批（没改过的对象共用一份，改过的各单独一份；这里按一份算）`,
            '改任何开关、改任何正文，这些数字都会当场重算',
        ]),
    ));

    // ---- 世界观视图专属：周期模式 + 自动门控 + 世界观档案 ----
    if (isWorld) {
        // ★ 周期模式（月经 / 非月经）—— 放在最上面，因为它管的就是"发哪一套规则" ✓
        //   ★ 它只管「**默认**周期模式」—— 每个对象可以在「角色基础信息」里各自改 ✓
        container.appendChild(h('div', { class: 'bc-card bc-periodmode-card' },
            cardHead('默认周期模式', [
                '没单独设过的对象跟着它；月经与非月经之间，受孕率与判定完全一样，只有名字和描写不同',
                '有月经：阶段名是「月经期 / 卵泡期 / 排卵期 / 黄体期」，经期描写照常',
                '非月经：阶段名改成中性说法（静息期 / 蓄势期 / 高峰窗口 / 回落期 / 稳定期），经血相关描写全部扣掉。周期照旧推、照样能怀孕',
                '无月经：这个人没有周期、没有阶段（面板那一行写「不适用」）。周期相关的条目在他的人物视图里会藏起来，推演也不会收到他的身体补丁。男玩家、不来月经的种族走这一档',
                '无月经这一档默认按「不能怀孕」算。要改成能怀，去「角色基础信息」里把「能不能怀孕」填成能：填了之后判定改成每轮一次，这一轮攒下的受孕率在这一轮结束时判一次，判完清零，下一轮重新累计；判中之后照样等几天，再判有没有着床',
            ]),
            h('div', { class: 'bc-card-body' },
                periodModeSwitch(handlers),
            ),
        ));

        // ★ 自定义那档的**名字**（术语 / 阶段名）—— 玩家可以先给自定义那档起名 ✓
        //   把自定义模式的生理期规则修改放到世界观那里，方便玩家自定义 ✓
        container.appendChild(periodNamesCard(handlers));

        // ---- 自动门控（放在这里而不是设置页：它管的就是「哪些提示词发出去」） ----
        const gateBody = h('div', { class: 'bc-gate-grid' });
        // ★ 非月经模式下，「来月经时」这个门控永远不会开 ⇒ 不显示它 ✓
        const _pmNone = pmNone;
        for (const [kind, label] of Object.entries(GATE_LABEL)) {
            if (kind === 'menstruation' && _pmNone) continue;   // 跳过 ✓
            const isOn = isGateEnabled(kind);
            // ★ 归属要把「gate 数组里含它」和「gateAny 里含它」都算上 ——
            //   ⚠️ 只认 `m.gate === kind` 的话 ⇒ heritage_once 那一行的模块名单是空的（看着像没人在用），
            //   挂着 gateAny 的那条共用小模块也永远不出现 ✗
            const owned = MODULES.filter((m) => {
                const gs = Array.isArray(m.gate) ? m.gate : (m.gate ? [m.gate] : []);
                return gs.includes(kind) || (Array.isArray(m.gateAny) && m.gateAny.includes(kind));
            });
            gateBody.appendChild(h('label', { class: 'bc-gate-item' + (isOn ? ' on' : '') },
                toggle(isOn, (v) => { setGateEnabled(kind, v); refresh?.(); rerender(); }),
                h('div', { class: 'bc-gate-main' },
                    h('div', { class: 'bc-gate-label', text: label }),
                    h('div', { class: 'bc-hint', text: owned.map(m => m.name).join(' · ') }),
                ),
            ));
        }
        container.appendChild(h('div', { class: 'bc-card bc-gate-card' },
            cardHead('自动门控（省 token）', [
                '打开之后，带「自动」徽章的补丁只在条件满足时才真的发出去，平时一个字都不占，不是「发了叫 AI 忽略」',
                '关掉某条 = 那一类永远发送',
            ]),
            h('div', { class: 'bc-card-body' },
                (_pmNone
                    ? h('div', { class: 'bc-hint', text: '当前是「非月经」模式，「来月经时」那条自动关闭（不显示在这里）' })
                    : null),
                gateBody,
                gateGlossaryBlock(),
            ),
        ));

        // ---- 世界观档案（存 / 取整套规则 ✓）----
        container.appendChild(worldArchiveRow(H));
    } else {
        // ---- 人物视图：这个人的档案（三块能任意组合带 ✓）----
        container.appendChild(personArchiveRow(targetKey, H));
    }

    // ---- 分类页签（每一类一个单独页面，不用一路往下滑） ----
    // ★ 只列**这个视图里有模块**的分类 ✓（世界观视图里不会出现「身体与体质」这种纯人物分类）
    const SPECIAL = isWorld ? ['__fields__', '__tpl__'] : [];
    const viewCats = CATEGORIES.filter(c => viewMods.some(m => m.cat === c[0]));
    const TABS = [
        ...viewCats.map(c => [c[0], c[1], c[2]]),
        ...(isWorld
            ? [['__fields__', '字段开关', '哪些字段要推演、要显示、要发给主 API'],
               ['__tpl__', '注入模板', '插件输出给主 API 的那两段提示词，以及固定字段说明']]
            : []),
    ];
    const active = TABS.some(t => t[0] === s.ui.patchCat) ? s.ui.patchCat : TABS[0][0];

    const tabBar = h('div', { class: 'bc-cat-tabs' });
    for (const [id, label] of TABS) {
        // ★ 页签上的"几条 / 多少 tk"必须和**下面真正列出来的**是同一份清单 ✓
        //   ⚠️ 不能写 `MODULES.filter(m => m.cat === id && scoped(m.id))` ✗ —— 那只按视图过滤，
        //      **没算"非月经时藏起来的那几条"** ⇒ 页签名和下面列出来的条数对不上 ✗
        //      ⇒ 统一走 `viewMods` ✓
        const mods = SPECIAL.includes(id) ? [] : viewMods.filter(m => m.cat === id);
        const tk = sumTokens(mods.map(m => _tkText(m.id)));   // 和总览同一套取法 ✓
        tabBar.appendChild(h('div', {
            class: 'bc-cat-tab' + (id === active ? ' active' : ''),
            title: label,
            onclick: () => { s.ui.patchCat = id; save(); rerender(); },
        },
            h('div', { class: 'bc-cat-tab-name', text: label }),
            h('div', { class: 'bc-cat-tab-meta' },
                mods.length ? h('span', { class: 'bc-cat-count', text: mods.length + ' 条' }) : null,
                mods.length ? tokenBadge(tk) : null,
            ),
        ));
    }
    container.appendChild(tabBar);

    const pane = h('div', { class: 'bc-cat-pane' });

    // 互斥提示：放在最上面，切到哪一页都看得见
    for (const msg of conflictWarnings()) {
        container.appendChild(h('div', { class: 'bc-warn' }, '⚠️ 规则冲突：' + msg));
    }
    container.appendChild(pane);

    if (active === '__tpl__') {
        pane.appendChild(templatesCard(H));
        pane.appendChild(fixedFieldsBar());
    } else if (active === '__fields__') {
        pane.appendChild(fieldsCard(H));
    } else {
        const cat = CATEGORIES.find(c => c[0] === active);
        if (cat) pane.appendChild(h('div', { class: 'bc-hint', text: cat[2] }));

        const mods = viewMods.filter(m => m.cat === active);
        mods.sort((a, b) => GROUP_ORDER.indexOf(a.role) - GROUP_ORDER.indexOf(b.role));
        for (const m of mods) {
            // ★ 人物视图：卡片编辑的是**当前这个对象**那份 ✓（世界观视图：直接编全局 ✓）
            pane.appendChild(moduleCard(m, isWorld ? '__global__' : targetKey, H));
        }
    }

    // ---- 底部：批量操作（按**当前视图**限范围 ✓）----
    const toolbar = h('div', { class: 'bc-toolbar' },
        button('全部打开' + (isWorld ? '（世界观）' : '（人物）'),
            () => { for (const m of viewMods) setModuleOn(m.id, true); refresh?.(); rerender(); }),
        // 注意：必开的保持开，其余的关掉。
        // ⚠️ 这里必须写 !!m.locked：写成 !m.locked 会把非必开的全打开 ✗
        button('全部关闭（必开除外）',
            () => { for (const m of viewMods) setModuleOn(m.id, !!m.locked); refresh?.(); rerender(); }),
    );
    if (isWorld) {
        toolbar.appendChild(button('恢复出厂设置（含文案）', async () => {
            if (!(await askConfirm('会把所有补丁开关恢复成默认，并清掉你改过的文案与模板。确定吗？'))) return;
            s.modules = {};
            s.injectTemplates = {};
            save();
            refresh?.();
            rerender();
        }, { variant: 'danger' }));
        // ★ 那句话搬进工具栏的「？」（不在页面上占一行 ✓）
        toolbar.appendChild(h('div', { class: 'bc-spacer' }));
        toolbar.appendChild(helpButton('批量操作', [
            '「全部打开 / 全部关闭」只作用于当前视图：世界观那一批，或者当前这个对象的专属那份',
            '「恢复出厂设置」只清世界观那批（开关 + 改过的文案 + 注入模板）',
            '人物专属补丁在「人物」那一栏单独清，这里不会碰它',
        ]));
    } else {
        toolbar.appendChild(button('清空这个对象的专属补丁', async () => {
            const who = targetLabel(targetKey);
            if (!(await askConfirm(`把「${who}」改过的补丁文案全部清掉（回到内置默认）？\n\n别的对象不受影响`))) return;
            // ⚠️ 用 overriddenPatchIds：**用户本人那份存在全局设置里**，不在 targetPatchBag
            //   （对「你自己」直接用 targetPatchBag 会恒为空循环 ⇒ 点了「已清空」其实啥也没清 ✗）
            for (const id of overriddenPatchIds(targetKey)) resetModuleText(id, targetKey);
            window.toastr?.success?.(`已清空「${who}」的专属补丁`);
            refresh?.();
            rerender();
        }, { variant: 'danger' }));
    }
    container.appendChild(toolbar);
}

