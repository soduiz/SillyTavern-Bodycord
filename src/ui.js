/**
 * ui.js —— 悬浮球 + 主面板（状态 / 骰子 / 设置）
 *
 * 这一版的关键结构改动：三个页签是**常驻**的，切页签只切换显示，不销毁重建。
 * 这样：
 *   · 面板里正在放的音乐不会断（iframe 不会被拆掉）
 *   · 设置页的滚动位置不会每次点开关就跳回顶部
 *
 * 另外新增：
 *   · 呈现方式：悬浮窗 / 聊天内嵌 / 两者都要（离开聊天时强制回到悬浮窗）
 *   · 编辑模式：点面板上的数值就能改
 *   · 顶栏现实时间、单一日夜切换按钮
 */

import { settings, save, ALL_FIELDS, isModuleOn, patchScope, frozenPatchCount, patchSendGroups, wiCharOn, wiGlobalOn, wiDescOn, wiPersonaOn, wiHeritageAuto, wiFollows, wiOffCounts, achOn, achToastOn, achToastSec, ACH_TOAST_SEC_DEF, achPromptChars, stagesOn, customStageCount, periodMode, cycleModeLabel, currentApi, apiCount, periodDaysOf, bodyCycleParamsOf, realAlertsToday, markRealAlerted, bubbleTitle, implantRangeOf, DEFAULT_SETTINGS, talentTierTableOf, dominantSourceRangeOf } from './settings.js';
import { deriveCycleFields } from './derive.js';
import { rollSpermLife } from './judgment.js';
import { MODULES } from './modules.js';
// ★ 只为了"玩家手打的日期认不认"当场给个提示 ——
//   打错字会静默存下来、年龄那行悄悄消失（做了没反馈 ✗）
import { parseFictionDate, calendarSummary, diffDays, addDays } from './fiction-date.js';
import {
    targetList, displayName, state, setActive, commit, createTarget, inRealChat, MAX_SNAPSHOTS,
    measureSnapshots,
    bodyLockOf, isUserKey, USER_KEY, userSelfLabel, userLabel,
    identOf, trackingRoster, candidateInfo, filterTargets, targetPatchCount,
    periodModeOf, setPeriodModeOf, achievementCount,
    childrenOf, addChildren, updateChild, removeChild, childAgeText, storyDateNow, childCount,
    cycleDayNow, cycleStartDateOf, setCycleDayOf, currentDate, cycleDayNum,
    recordInsemination, listInseminations, removeInsemination, addTraceManually,
    listTraces, removeTrace, clearTraces, TRACE_LEVELS,
    isProfileFieldFixed, setProfileFix, clearProfileFix, resnapProfileField, refreshCycleFieldsOf,
    setOvuJudgment, clearOvuJudgmentOf, setFetusPlanOf, setImpregnatorLocksOf, addAchievements,
    achievements, updateAchievement, removeAchievement,
    impregnatorSourceOf, setImpregnatorSourceOf, sourceTextOf,
    panelDataSummary,
    activeCalendarNow, timeUnitNow, inChatPage,
    calendarAlertsForPanel, markCalendarAlerted,
    alertEntriesForBubble, markAlertSeen,
    syncLastFloorSnapshot, getOvuJudgment, fertilityRateTextOf, dropConceiveAlerts,
    syncPlanSexesFromD6,
    heritageRollsOf, ensureHeritageRollsFor, rerollHeritageAll,
    rerollTalentGroup, setTalentGroupTier, rerollDominantGroup, setDominantGroupMode,
    clearSpermLoad,
    awarenessManualOf, setAwarenessManualOf, clearAwarenessManualOf,
    awarenessTierIdOf, setAwarenessTierIdOf,
    implantDateOf, setImplantDateOf, pregDaysOf, shiftDueDatesOf, listAlerts, syncDueAlerts,
} from './store.js';
import { runJudge, refreshRaw, lastJudgePrompt, rollHeritageNow, ensureGestationDates } from './judge.js';
import { wiStatus } from './wi.js';
// ★ 被排除的角色卡（口径见 src/cardexclude.js 顶上那段）
//   · `isCardExcluded()`      现在这张卡是不是被排除了
//   · `currentCardAvatar()`   认卡用的那把钥匙（头像文件名）
//   · `setCardExcluded()`     排除 / 放回（面板顶上那条提示里的「启用」按钮用它 ✓）
import { isCardExcluded, currentCardAvatar, setCardExcluded } from './cardexclude.js';
import { BodycordPanel, notesStats } from './bodycord.js';
import { renderSettingsTab, renderJudgeTab, renderTrackingTab, renderAvatarTab, renderStagesTab, renderBasicInfoTab, renderCalendarTab, bodyLockRows, identRows } from './ui-settings.js';
import { renderModulesTab } from './ui-modules.js';
import { renderArchiveTab } from './ui-archive.js';
import { renderAchTab } from './ui-ach.js';
import { previewInjection, gateOpen, moduleActive, canBePregnantPerson, rebuildInjection } from './prompt.js';
import { describePresetInjection } from './judge.js';
import { openTimeMachine } from './ui-time.js';
import { buildStatusProfile } from './serialize.js';
import { humanBytes } from './image.js';
import { getChatMetadata, getChatKey, describePersonaAvatar, isMyExtensionDisabled, getPersonaName, getCharacterName, getCtx, ST, saveStatus, flushChatMetadataNow } from './st.js';
import { forceReResolveAvatar } from './bodycord.js';
import { renderZoneModifier } from './ui-params.js';
// ★ 阶段插图：当前该画哪张 + 文字（走术语表）+ 图地址 ✓
import { stageTextOf, stageImageOf, stagesForPanel, stageLayersForSample, pickStage } from './stages.js';
import { parseZoneRows, serializeZoneRows } from './params.js';
import { parseFetus, buildFetus, splitHeritage, joinHeritage } from './fetus.js';
import { h, clear, modal, textInput, textArea, numberInput, section, button, select, dropdown, field, askConfirm, scrollTopOf, setScrollTopOf } from './dom.js';
import { applyFloorPanel, refreshAllFloors, pendingFloors, lastFloorExcluded, setJudgeHandler, syncFloorLook, judgeBtnSpec } from './ui-floors.js';
import { skipStats } from './runstat.js';
import { beginRun, endRun, clearPending, cancelRun, queueState, onQueueChange } from './judge-queue.js';
// ★ 番茄钟：状态机在 timer.js，这里只负责"画悬浮球 + 弹提醒" ✓
import {
    loadTimer, saveTimer, timerStart, timerPause, timerReset, timerSetMode, timerSetMinutes,
    timerClear,
    timerTick, timerView, fmtMs,
} from './timer.js';
// 设置页那张「番茄钟」卡里的配置（**一份真相** —— 别在这儿再抄一遍读法 ✗）
import { timerCfgOf, timerBubbles } from './ui-timer.js';

// 面板字段定义（编辑模式 / 手改面板共用）
const FIELD_DEFS = [
    // ★★ 2026-10-30（她定的）：这里**只放真正能改的**。
    //   插件自己算的那几格（阶段名 / 进度 / 基础率 / 近期性行为）**一个都不摆进来** ——
    //   只读的东西放在"改数值"里只会让人以为能改（and 早先那格就是这么被误记成手改的 ✗）；
    //   想知道当前值就去主面板看，那本来就是它干的事 ✓
    // 原则：能由插件确定的东西，不要让模型写，也不要让玩家在这儿改。
    { key: 'minor', label: '次要描述（时间 / 防护 / 风险）', wide: true, multiline: true },
    { key: 'calc', label: '计算说明', wide: true, multiline: true },
    { key: 'd2', label: '数据项二 · 累计受孕率' },
    { key: 'd3', label: '数据项三 · 体质系数' },
    { key: 'd4', label: '数据项四 · 致孕方' },
    { key: 'd5', label: '数据项五 · 意识状态' },
    { key: 'd6', label: '数据项六 · 胎儿状态', wide: true, multiline: true },
    { key: 'd7', label: '数据项七 · 泌乳状态' },
    { key: 'd8', label: '数据项八 · 生产次数' },
    { key: 'row1', label: '状态条一 · 生理状态', wide: true, multiline: true },
    { key: 'row2', label: '状态条二 · 身体状况', wide: true, multiline: true },
];

let els = null;
let statusViews = [];       // 悬浮窗里一个 + 聊天内嵌一个（可能只有一个）
let busy = false;
let clockTimer = null;
let watcherTimer = null;

// ---------------------------------------------------------------------------
// 图标
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';

/** 小手机 + 心跳线：比一朵花更贴合「随身状态监测」的设定 */
function deviceIcon(size = 26) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML =
        '<rect x="5" y="2.4" width="14" height="19.2" rx="3.4"/>' +
        '<path d="M9.6 5.5h4.8"/>' +
        '<path d="M7.4 13.2h2.2l1.15-2.4 1.5 3.9 1-2.6h3.35"/>' +
        '<circle cx="12" cy="18.7" r="0.95" fill="currentColor" stroke="none"/>';
    return svg;
}

// ---------------------------------------------------------------------------
// 状态视图（悬浮窗 / 聊天内嵌 共用）
// ---------------------------------------------------------------------------

export class StatusView {
    constructor(host, opts = {}) {
        this.host = host;
        this.root = h('div', { class: 'bc-status-view' });
        this.head = opts.head || null;   // 外层标题栏（顶上那条）——「这一楼待推演」挂它右边 ✓
        this.panel = null;
        this.charbar = null;
        this.pills = null;
        this.pickerLabel = null;   // 折叠态那颗「当前在看谁（共 N 个）」按钮的文字（切人要跟着变 ✓）
        this._pickerList = null;
        this.hint = null;
        this.tip = null;          // 顶栏右…靠左那半句平台提示（触摸档才有字 ✓）
        this.statusBar = null;    // 顶栏那一行本身（没字就整行收起来，见 update() ✓）

        // ★★ 2026-10-18：这条「这一楼待推演 / 已排除 / 等推演」的胶囊**从状态条搬到标题栏右侧**。
        //   原来它独占一整行、靠左、底下还有一条分割线 ⇒ 玩家截图说：位置看起来有点奇怪：
        //   左边一大格空着，像浮在标题下面的一条孤儿 ✗
        //   放进标题栏：不占额外高度、右侧对齐，单人和多人追踪都一样（多人时下面那条名字栏不受影响 ✓）
        //   ⚠️ 它不归 `.bc-status-bar` 管了 ⇒ `applyStatusBar` 判"有没有字"时**不能再算它** ✓
        this.pending = h('span', { class: 'bc-pending-chip', style: { display: 'none' } });
        if (this.head) {
            const spacer = this.head.querySelector('.bc-spacer');
            if (spacer && spacer.parentNode === this.head) spacer.insertAdjacentElement('afterend', this.pending);
            else this.head.appendChild(this.pending);
        }

        host.appendChild(this.root);
    }

    render() {
        clear(this.root);

        // ---- 预览控件**不在面板里了**----
        // ⚠️ 原来面板顶上挂着一条「🎨 预览」条，它踩过三次：
        //   ① 放名字栏下面会压住名字栏 ✗ ② 挪到最上面**还是挡住**（两个按钮各占一整行）✗
        //   ③ 收起成一个小按钮之后，它跟状态条挤在一起 —— 玩家这次报的那颗
        //      「⚠️ 这一楼还没生成状态」提示胶囊看着"位置有点奇怪"就是被它挤的 ✓
        //   ⇒ 玩家定的是：**挪到：设置 → 常规 → 诊断与数据（排查用）那块**（预览本来就是排查用的 ✓）
        //   ⚠️ **面板顶部不许再放任何预览控件**（别再挪回来 ✗）；预览开着时，
        //      状态条右边那行提示会写"正在预览样例数据、去哪儿关掉" ✓

        // ---- 角色切换条（仅多角色模式）----
        this.charbar = this._buildCharbar();
        if (this.charbar) this.root.appendChild(this.charbar);

        // ---- 工具条 ----
        this.hint = h('span', { class: 'bc-status-hint', text: inRealChat() ? '' : '还没进入聊天，面板暂无数据' });

        // 手动推演模式下，提醒玩家「这一楼还没生成过状态」
        // ⚠️ 它现在住在**标题栏右侧**（构造函数里建的，见上面那段）——
        //   这里**不再**建一份、也不要再往状态条里塞 ✗

        // 工具条只留状态提示 ——
        // 「改数值 / 推演 / 日志」搬去了悬浮球的右键 / 长按菜单，
        // 免得跟面板自己的工具条（复制/遮罩/筛选/搜索）挤成两排图标
        // 这一行平时只剩右边半句：提示：右键悬浮球可以改数值 / 推演，
        //   左边一大格空着，而这一行自己还带着内边距和一条分割线 ⇒ 看着就是"白占一行" ✗
        //   ⇒ 桌面档（有鼠标右键）那句**整句不出现**，这一行"没字就整行收起来"（见 update() ✓）
        //   ⚠️ 触摸档**必须留着**：手机上长按是打开那个菜单的**唯一**入口，删了等于新用户
        //     永远发现不了（得考虑手机用户 ✓）；
        //     而且**靠左摆**——靠右会把它推到角落、左边留一大片空白，正是玩家截图里那个样子 ✗
        this.tip = h('div', { class: 'bc-hint bc-fab-tip', text: previewMode
            ? '🎨 正在预览样例数据（在 设置 → 常规 → 诊断与数据 里关掉）'
            : (isTouchDevice() ? `提示：${menuHint()}可以改数值 / 推演` : '') });
        const bar = h('div', { class: 'bc-status-bar' },
            this.hint,
            this.tip,
            h('div', { class: 'bc-spacer' }),
        );
        this.statusBar = bar;
        // ★ 出生即按"有没有字"定可见性（同一个判据走 `applyStatusBar` ✓）——
        //   不然它就是一条空白的间隔挂在顶上（间隔又出现了✓）
        applyStatusBar(this);
        // ★ 出生那一刻也要把「这一楼待推演」那颗胶囊判一次 ——
        //   `update()` 未必接得上（先 render、之后没有 refreshAll ⇒ 它一直藏着 ✗）
        this._paintPending();
        this.root.appendChild(bar);

        // ---- 面板本体 ----
        const host = h('div', { class: 'bc-frame-host' });
        this.root.appendChild(host);
        this.host = host;

        // ⚠️ 上面 clear(this.root) 会把 iframe 连同 host 一起从 DOM 里摘掉。
        //   render() 里**不直接碰 this.panel**（第一遍 render 时它还是 null，
        //   旧断言专门守着这条 —— 在 render() 里写 `this.panel?.iframe` 会被它拦下 ✓）。
        //   所以「把 iframe 放回去」这件事统一交给 _mountPanel()：
        //   面板还活着 ⇒ 它会重新 append（同一个元素重新 append 不会重新加载，音乐照放 ✓）；
        //   面板本来就该新建 ⇒ 由它自己塞进去。
        this._mountPanel();
        // ★ 面板是刚建的（或刚被放回来）时，预览那一份字段要**重新推一遍** ——
        //   否则"预览开着但面板重建过"就退回真实数据（没进聊天时就是整块空的 ✗）
        //   （这是"预览的单人模式一直没有数据"的其中两个洞之一 ✓）
        if (previewMode) { try { this._applyPreviewToPanel(); } catch { /* 忽略 */ } }
    }

    /** 切换预览。只改面板显示，**不写聊天记录、不改插件状态**。 */
    togglePreview() {
        previewMode = !previewMode;
        if (!previewMode) previewMulti = false;   // 退出预览时把模式也复位
        previewActiveKey = null;                  // 重新进去时从第一个样例开始看
        this._applyPreviewToPanel();
        // ★ 名字栏要不要显示、显示成什么样，都跟着预览模式走 ⇒ 必须**重建视图** ✗
        //   光 refreshAll() 只更新数据、**不重建 DOM**（名字栏只在 render() 里建）
        //   ⇒ 结果就是"多人预览看不到多人的样子" ✗
        try { rebuildStatusViews(); } catch { /* 忽略 */ }
        try { refreshAll(); } catch { /* 忽略 */ }
        try { refreshDiag(); } catch { /* 忽略 */ }
        applyPreviewToViews();   // ★ 所有面板实例都要拿到（别只给点了按钮的那一份 ✗）
    }

    /**
     * 预览「多人追踪」的样子（双模式切换预览：
     * 可以直接预览到多人模式的样子 ✓）。
     */
    togglePreviewMulti() {
        previewMulti = !previewMulti;
        if (previewMulti) previewMode = true;     // 选了多人就一定是"在预览"
        previewActiveKey = null;                  // 进/出多人预览都从第一个样例开始看
        this._applyPreviewToPanel();
        // 同上：名字栏（_buildCharbar）只在 render() 里建 ⇒ 必须重建视图才会出现 ✓
        try { rebuildStatusViews(); } catch { /* 忽略 */ }
        try { refreshAll(); } catch { /* 忽略 */ }
        applyPreviewToViews();   // ★ 同上：所有面板实例都要拿到 ✓
    }

    /** 把预览数据（或真实数据）推给面板 */
    _applyPreviewToPanel() {
        const p = this.panel;
        if (!p) return;
        // ★ 字段收进**一个纯函数**（`previewPanelPayload`）——
        //   预览的单人模式一直没有数据，就是下面两个洞：
        //   ① 预览只落在"点了它的那一份面板"上；② 面板重建后没人重推 ✗
        //   ⇒ 现在字段只在一处拼、两个洞都在下面兜住了 ✓
        Object.assign(p, previewPanelPayload({
            on: previewMode, multi: previewMulti, activeKey: previewActiveKey,
        }));
        try { p.update?.(); } catch { /* 忽略 */ }
    }

    /** 预览多人时切「看哪一个样例对象」（**不碰真实 state**，样例不是真实对象） */
    _selectPreviewTarget(key) {
        previewActiveKey = key;
        this._applyPreviewToPanel();          // 它会把新的选中项推给面板
        if (this.pills) {
            for (const el of this.pills.querySelectorAll('.bc-pill')) {
                el.classList.toggle('active', el.dataset.key === key);
            }
        }
    }

    /**
     * 挂面板本体。**幂等**：面板已经活着就直接返回，绝不动它。
     *
     * **非聊天页面照样挂** —— 面板里能放歌、能挂机，不该因为没进聊天就锁住。
     * 数据是按聊天存的，没进聊天时那几行自然是空的，顶部会有一句提示。
     *
     * ⚠️⚠️ 为什么必须幂等（不幂等会出现：音乐在关闭聊天和进入聊天的时候会暂停）：
     *   切/进/出聊天都会走 index.js 的 onChatChanged() → rebuildStatusViews()
     *   → StatusView.render() → clear(this.root) + _mountPanel()。
     *   而 render() 是**重建整个视图**（切角色条、工具条都要重画），
     *   iframe 刚才已经被 clear() 从 DOM 里摘掉了。
     *   如果这里再无条件 `panel.destroy()` 走一遍，等于**把 iframe 整个重建** ⇒
     *   里面正在放的音乐立刻断 ✗。
     *   ⇒ 所以：**面板还活着就用它**，只把外面那圈 DOM 重画一遍，
     *     iframe 本身原样留在 this.panel 里（render() 之后会被重新 append 回去）✓。
     */
    _mountPanel() {
        const host = this.host;
        if (!host) return;

        // 面板已经建过 ⇒ **绝不 destroy**（关键：一 destroy，iframe 没了、音乐就断）。
        //   两条路都交给 remountInto：
        //   · iframe 已经建好 ⇒ 把它挪进新 host（同一元素重新 append 不会重新加载 ✓）
        //   · iframe 还没建好（mount() 卡在 await 上）⇒ 只更新它记的容器，
        //     等它醒过来会自己 append 到**当前**这个 host ✓
        if (this.panel) {
            this.panel.remountInto(host);
            this._dropStrayFrames();
            return;
        }

        clear(host);

        // ⚠️ 传的是「取当前 host 的函数」，不是 host 本身 ——
        //   render() 会 clear 整个视图、再建一个新的 .bc-frame-host，
        //   而 mount() 是异步的：万一它醒得比下一次 render() 晚，
        //   写死构造时那个 host 就会把 iframe 塞进已脱离文档的旧节点 ⇒ 面板一片空白 ✗
        this.panel = new BodycordPanel(() => this.host, { theme: settings().ui.theme || 'light' });

        // 面板里点「时光机」频道时，请外壳把窗口打开。
        //
        // ⚠️ 就写在这里、紧挨着 new 出来那一行 ——
        //   放到 render() 里 `_mountPanel()` 的前面，`this.panel`
        //   那时还是 null，赋值直接抛 TypeError，render() 当场死掉：
        //   面板不建、悬浮球也不接线，症状就是「插件完全打不开、拖不动」。
        //   放在这里，「panel 已存在」就是语句顺序保证的，不靠记性。
        this.panel._onOpenTime = () => {
            if (this._timeOpen) return;          // 已经开着就别再开一个
            this._timeOpen = true;
            openTimeMachine({
                onClose: () => { this._timeOpen = false; },
                onJudge: (opts) => doJudge([], opts),
                // ★★ 时光机改的是**账 / 快照** ⇒ 主面板（联系人 / 受孕记录 / 身体状态 / 概览…）
                //   也得立刻换成新数据（2026-10-17：撤销推演之后面板里还留着旧记录 ✗）：
                //   面板里的数据是外壳算好推给 iframe 的，只在 `refreshAll()` 时推 ⇒
                //   不推的话撤销完还挂着已经撤掉的那条记录（数据其实是对的 ✗）。
                //   ⚠️ 走回调递进去：`ui-time` 不许 import `ui.js`（模块环 ✗）
                onDataChanged: () => { try { refreshAll({ force: true }); } catch { /* 忽略 */ } },
            });
        };

        // ★ 悬浮歌词条：面板推歌词 / 取配置 / 改配置 / 一键重置 —— 都走实例钩子 ✓
        //   （铁律：**bodycord.js 不能 import ui.js**，循环依赖 ✗ ⇒ 用钩子，跟上面 `_onOpenTime` 同一套 ✓
        //    配置归外壳存、面板只当遥控器 ⇒ 它拿不到插件设置，只能这么来回问 ✓）
        this.panel._onLyricState = (st) => { try { updateLyricState(st); } catch { /* 忽略 */ } };
        this.panel._onLyricCfgGet = () => lyricCfgSnapshot();
        this.panel._onLyricCfgSet = (patch) => applyLyricCfgPatch(patch);
        this.panel._onLyricReset = () => resetLyricCfgAndApply();

        // ★ 番茄钟：面板问了才给 —— 它自己不存真相，全靠外壳这份 ✓
        //   （同一条铁律：bodycord.js 不能 import ui.js ⇒ 走实例钩子 ✓）
        this.panel._onTimerSnapshot = () => timerSnapshot();
        this.panel._onTimerAction = (action, arg) => timerPanelAction(action, arg);
        this.panel._onTimerPerm = () => requestTimerNotifyPermission().then(() => { pushTimerToPanel(); }).catch(() => { /* 忽略 */ });

        this.panel.mount().then(() => {
            // 保险扫一遍：只允许留下当前这个 panel 的 iframe
            this._dropStrayFrames();
        }).catch(e => {
            clear(host);
            host.appendChild(h('div', { class: 'bc-error', text: '面板加载失败：' + e.message }));
        });
    }

    /** host 里只允许存在当前面板那一个 iframe */
    _dropStrayFrames() {
        const host = this.host;
        if (!host) return;
        const frames = host.querySelectorAll(':scope > iframe.bc-frame');
        for (const f of frames) {
            if (f !== this.panel?.iframe) f.remove();
        }
    }

    _buildCharbar() {
        const s = settings();
        // ★ 预览「多人模式」时，**无视追踪模式**照样把名字栏画出来（用样例名字）✓
        //   —— 目的就是"不用真去建档，也能看到多人模式长什么样"。
        const pvMulti = previewMode && previewMulti;

        // ★ **只有追踪非单人模式（单人模式：{{user}} 和指定单人）
        //   才显示那个会显示一排名字的栏位，不然很占格子** ✓
        //   ⇒ 只追本人（user）和 单人（single）都不显示；multi / auto 才显示 ✓
        //   （单人模式下要换对象直接去设置里改名单，不需要一排名字占地方 ✓）
        if (!pvMulti && (s.targetMode === 'user' || s.targetMode === 'single')) return null;

        // ★ 名单用 trackingRoster()：它已经处理了「不追踪本人」和各种模式 ✓
        //   （"关掉追踪本人 ⇒ 面板也不显示本人那一栏"✓）
        //   预览多人时用样例名字，不走真实名单 ✓
        const targets = pvMulti ? demoTargets() : trackingRoster();
        const st = state();
        // 预览多人时的"当前选中项"走 previewActiveKey（**不碰真实 state**）
        const pvActive = pvMulti ? (previewActiveKey || (targets[0] ? targets[0].key : '')) : st.active;

        // ★ **面板的名字切换那里只显示可以怀孕的角色** ✓
        //   ⇒ 明确锁定「不能怀孕」的对象**不进这一条**（那种要的是另一套面板，日后再说 ✓）。
        //   ⚠️ 两条边界：①**未填锁定 = 插件不知道**（`canBePregnantPerson` 未填返回 true）⇒ 仍然显示 ✓；
        //     ②**正在看的那个无论如何都留着** —— 否则这一条会空掉、就看不出来模块在看谁了 ✗。
        //   ★★ 第三条边界：**追踪多人的情况下，只能致孕不能怀孕的用户
        //      不能看自己的致孕数据了** ⇒ **玩家本人永远留着** ✗ ——
        //      他是"看数据的那个人"，剔掉他就等于他自己那份（联系人页里的致孕记录）打不开了 ✓
        const shown = targets.filter((t) => canBePregnantPerson(t) || t.isUser || t.key === pvActive);

        const bar = h('div', { class: 'bc-charbar' });
        bar.appendChild(h('span', { class: 'bc-charbar-label', text: '追踪中' }));

        // ★ 超过一定数量就把上面横条改成点击弹出一个窗口、
        //   里面是名字小胶囊 ✓ ＋ 加搜索 ✓
        //   ⇒ 多于 PICKER_AT 个就只留一个按钮，点开是带搜索的胶囊窗（不再横向挤一排）
        // ⚠️ 但**预览多人时不折叠**：预览看的正是"一排名字"那个样子 ✓
        // ★ **显示到 10 个**（第 11 个起才折叠），
        //   而且折叠时**玩家那一颗永远留着**（第一个按钮），第二个才是"折叠"按钮 ✓
        const PICKER_AT = 10;
        if (!pvMulti && shown.length > PICKER_AT) {
            // 玩家那一颗留在这儿：一眼就知道"我在哪"，不用点开弹窗 ✓
            const userTarget = shown.find(t => t.isUser);
            if (userTarget) {
                const only = h('div', { class: 'bc-pills' });
                only.appendChild(h('div', {
                    class: 'bc-pill' + (st.active === userTarget.key ? ' active' : ''),
                    dataset: { key: userTarget.key },
                    title: '用户本人',
                    onclick: () => { setActive(userTarget.key); refreshAll({ force: false }); },
                },
                    h('span', { class: 'bc-pill-dot' }),
                    h('span', { class: 'bc-pill-name', text: displayName(userTarget) || userTarget.key }),
                    h('span', { class: 'bc-pill-tag', text: '本人' }),
                ));
                bar.appendChild(only);
                // 只让这一颗参与高亮同步（切到别人身上时它会自己灭掉 ✓）
                this.pills = only;
            } else {
                this.pills = null;
            }
            const cur = shown.find(t => t.key === st.active) || shown[0];
            this._pickerList = shown;      // update() 里刷新按钮文字时要重算「当前在看谁」✓
            this.pickerLabel = h('span', {
                text: (cur ? (displayName(cur) || cur.key) : '选择对象') + '（共 ' + shown.length + ' 个）',
            });
            bar.appendChild(h('div', {
                class: 'bc-floor-btn on bc-pill-picker',
                title: '点开：搜索并切换要看的对象',
                onclick: () => { try { this._openTargetPicker(shown); } catch (e) { console.error('[Bodycord] 打开对象选择窗失败', e); } },
            },
                h('span', { text: '◉' }),
                this.pickerLabel,
            ));
            return bar;
        }

        this.pickerLabel = null;   // 展开态没有那颗按钮 ⇒ 清掉引用，别让 update() 去改旧节点 ✗

        const pills = h('div', { class: 'bc-pills' });
        this.pills = pills;

        for (const t of shown) {
            const nm = displayName(t) || t.key;
            pills.appendChild(h('div', {
                class: 'bc-pill' + (pvActive === t.key ? ' active' : ''),
                dataset: { key: t.key },
                title: t.isUser ? '用户本人' : nm,
                onclick: () => {
                    // 预览里切对象只改"看哪一个样例"，**不写真实 state** ✓
                    if (pvMulti) { this._selectPreviewTarget(t.key); return; }
                    setActive(t.key); refreshAll({ force: false });
                },
            },
                h('span', { class: 'bc-pill-dot' }),
                h('span', { class: 'bc-pill-name', text: nm }),
                t.isUser ? h('span', { class: 'bc-pill-tag', text: '本人' }) : null,
            ));
        }

        let draft = '';
        const input = textInput('', v => { draft = v; }, { placeholder: '＋ 加一个要追踪的角色名' });
        input.classList.add('bc-pill-input');
        const add = () => {
            // ⚠️ 预览是假数据 ⇒ 绝不能真去建对象 ✗
            //   （预览里那排名字只是样例，但这个输入框是真的，不挡的话一按回车就往真实名单里塞人）
            if (previewMode) return;
            const name = draft.trim();
            if (!name) return;
            createTarget(name);
            setActive(name);
            input.value = '';
            draft = '';
            refreshAll();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        pills.appendChild(input);

        // 横向滚轮（不显示滚动条）
        pills.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            pills.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        bar.appendChild(pills);
        return bar;
    }

    /**
     * 「对象选择窗」——对象多了（>8 个）时不横排挤成一排，改成点开一个带搜索的胶囊窗。
     *
     * **超过一定数量就把上面横条改成点击弹出一个窗口，
     *   里面是人名的小胶囊** ✓ ＋ **加搜索** ✓
     */
    _openTargetPicker(listIn) {
        const all = Array.isArray(listIn) && listIn.length ? listIn : targetList();
        const st = state();
        let keyword = '';

        modal({
            title: '切换追踪对象（共 ' + all.length + ' 个）',
            width: 620,
            hideCancel: true,
            saveText: '关闭',
            build: (body) => {
                const input = textInput('', v => { keyword = v; paint(); },
                    { placeholder: '输入名字筛选…' });
                body.appendChild(h('div', { class: 'bc-row' }, input));
                const host = h('div', { class: 'bc-pill-picker-grid' });
                body.appendChild(host);

                const paint = () => {
                    clear(host);
                    // ★ 和设置页那份名单搜索**共用同一个纯函数**（filterTargets）——
                    //   两处各写一份筛选迟早走岔 ✗（它还能顺带认别名 ✓）
                    //   数据源是 `all`（本聊天的对象）⇒ 天然聊天隔离 ✓
                    const list = filterTargets(all, keyword);
                    if (!list.length) {
                        host.appendChild(h('div', { class: 'bc-hint', text: '没有匹配的对象' }));
                        return;
                    }
                    for (const t of list) {
                        const nm = displayName(t) || t.key;
                        host.appendChild(h('div', {
                            class: 'bc-pill bc-pill-big' + (st.active === t.key ? ' active' : ''),
                            title: t.isUser ? '用户本人' : nm,
                            onclick: () => {
                                setActive(t.key);
                                // 切对象只需要重画"这一个"的面板文字 ——
                                //   全量重建所有对象会让"点名字切人"明显卡顿 ✗
                                try { refreshAll({ force: false }); } catch { /* 忽略 */ }
                                // 关掉这个窗（点完就走，别留着挡视线）
                                document.querySelector('.bc-modal-overlay .bc-modal-close')?.click();
                            },
                        },
                            h('span', { class: 'bc-pill-dot' }),
                            h('span', { class: 'bc-pill-name', text: nm }),
                            t.isUser ? h('span', { class: 'bc-pill-tag', text: '本人' }) : null,
                        ));
                    }
                };
                paint();
            },
        });
    }

    /** 折叠态那颗按钮上写的「当前在看谁（共 N 个）」（切人时要跟着变 ✓） */
    _pickerLabelText(listIn) {
        const st = state();
        const all = (Array.isArray(listIn) && listIn.length) ? listIn : (this._pickerList || targetList());
        const cur = all.find(t => t.key === st.active) || all[0];
        return (cur ? (displayName(cur) || cur.key) : '选择对象') + '（共 ' + all.length + ' 个）';
    }

    /** 只更新数据，不重建 DOM */
    update() {
        if (this.pills && !(previewMode && previewMulti)) {
            const active = state().active;
            for (const el of this.pills.querySelectorAll('.bc-pill')) {
                el.classList.toggle('active', el.dataset.key === active);
            }
        }
        // ★ 折叠态：切人时那颗按钮上的名字也要跟着变（原来只在整块重建时才更新，不够 ✗，
        //   用弹窗切完人它还写着旧名字）
        if (this.pickerLabel) this.pickerLabel.textContent = this._pickerLabelText();
        // ★ 预览模式下这些提示讲的是「真实聊天 / 真实楼层」的状态，跟样例数据无关 ⇒ 一律不显示 ✗
        //   （不这么做：预览的多人会被 ⏳ 等这一楼推演完 改过去 ✗）
        if (this.hint) this.hint.textContent = (previewMode || inRealChat()) ? '' : '还没进入聊天，面板暂无数据';

        // 提醒：这一楼还没生成过状态（手动推演时最容易忘）
        //   ★ 2026-10-18 抽成 `_paintPending()`：render()（出生那一刻）也要判一次 ——
        //     见下面那个方法的说明（没有推演的时候不显示这个提示✓）
        this._paintPending();

        // ★★ 顶上那一行「没字就整行收起来」（空了一大格）——
        //   三处文字都没有的时候整行 `display:none`（连那条分割线一起消失 ✓）
        //   ⚠️ 触摸档那句提示**一直在**（长按是唯一入口）⇒ 那边这一行就常态显示，这是有意的 ✓
        //   ⚠️ 判据收在 `applyStatusBar` 一处（出生那一刻也走它，见 render ✓）
        applyStatusBar(this);

        this.panel?.update();
    }

    /**
     * ★ 画标题栏右边那颗「这一楼待推演 / 已排除 / 等推演」胶囊。
     *
     * 判据**只写这一处** —— `update()`（数据刷新）和 `render()`（面板出生那一刻）都走它 ✓
     *
     * 为什么要单独抽出来（在没有推演的时候，主面板不显示那个还没推演的提示了）：
     *   它原来只在 `update()` 里算，而 `update()` 只在 `refreshAll()` 时被叫到。
     *   手动推演档（`autoUpdate=false`）下，AI 写完一楼 ⇒ `scheduleJudge()` 第一句就 return
     *   ⇒ **没有 refreshAll** ⇒ 胶囊一直停在"上一次推演完"那一刻的样子（隐藏着）✗
     *   ⇒ 现在：① 面板出生就先判一次（跟 `applyStatusBar` 同一个道理 ✓）；
     *            ② 每一楼进来 / 被删掉时外壳会叫一次 `refreshStatusHints()`（见 index.js）✓
     */
    _paintPending() {
        if (!this.pending) return;
        let text = '';
        let title = '';
        let warn = false;
        try {
            // ★ 预览时不显示（「等这一楼推演完」说的是真实楼层，跟样例数据无关）
            // ★ 被排除的角色卡也不显示（2026-10-28）：那个卡里根本不会推演，
            //   再挂一颗「这一楼待推演」就是骗人 ✓（面板顶上那条提示会说清为什么 ✓）
            if (!previewMode && inRealChat() && !isCardExcluded()) {
                const excluded = lastFloorExcluded();
                const pending = pendingFloors() > 0;
                // ★ 这里原来要 `excluded && pending`，
                //   而 `pendingFloors()` 在"最后一楼被排除"时**提前 return 0** ⇒ 恒假 ⇒
                //   「这一楼已排除，不会推演」永远不显示（提示条直接空掉 ✗）⇒ 只看 excluded 就够 ✓
                if (excluded) {
                    text = '🚫 这一楼已排除';
                    title = '你把它标成「不参与推演」了，它不会有状态，也不会影响数值';
                } else if (pending && !settings().autoUpdate) {
                    text = '⚠️ 这一楼待推演';
                    // ★ 这句悬停文案长期没跟着入口走（悬停的字是旧内容）——
                    //   它原来指着"右边的「🔮 推演」"，那个按钮早搬走了 ✗
                    //   ⇒ 指向**真实存在**的两个入口：最后一楼那一行的「推演这一楼」／悬浮球右键菜单 ✓
                    title = '现在是手动推演模式：点最后一楼那一行的「推演这一楼」，'
                        + '或者右键 / 长按悬浮球选「推演」';
                    warn = true;
                } else if (pending) {
                    text = '⏳ 等推演';
                    title = '每次 AI 回复后会自动推演，稍等一下';
                }
            }
        } catch { /* 忽略 */ }
        this.pending.textContent = text;
        this.pending.title = title;
        this.pending.style.display = text ? '' : 'none';
        this.pending.classList.toggle('warn', warn);
    }

    destroy() {
        this.panel?.destroy();
        this.panel = null;
        try { this.pending?.remove(); } catch { /* 忽略 */ }
        this.root.remove();
    }
}

// ---------------------------------------------------------------------------
// 悬浮球 / 面板骨架
// ---------------------------------------------------------------------------

/**
 * ★★ 顶上那一行（`.bc-status-bar`）"有字才占地方" —— 判据只写这一处，
 *   `render()`（出生那一刻）与 `update()`（之后每次刷新）都用它 ✓
 *
 * 为什么出生那一刻也要判（间隔又出现了 —— 悬浮窗顶上一条空条）：
 *   它原来是**出生就可见**的（基础 CSS 是 `display:flex`），而 `update()` 未必接得上
 *   （先 `render()`、之后没有 update）⇒ 那段空条就一直挂在那儿 ✗。
 *   这跟当年那颗"空胶囊"是同一个坑 ⇒ **建出来就先按当下有没有字定可见性** ✓
 *   ⚠️ 反过来也要对：没进聊天那句提示 / 待推演提示 / 触摸档的平台提示，出生就该显示 ✓
 */
function applyStatusBar(v) {
    try {
        const el = v?.statusBar;
        if (!el) return;
        // ★ 2026-10-18：待推演胶囊搬去标题栏了 ⇒ 这里只数状态条里**自己的**两处文字 ✓
        const anyText = !!(v.hint?.textContent || v.tip?.textContent);
        el.style.display = anyText ? '' : 'none';
    } catch { /* 忽略 */ }
}

/**
 * 这是不是触摸设备。
 * 触摸设备上没有右键，快捷菜单只能靠长按；桌面反过来。
 * 提示文案按实际情况写，别让手机用户去找右键、电脑用户去长按。
 */
function isTouchDevice() {
    try {
        return (navigator.maxTouchPoints || 0) > 0
            || 'ontouchstart' in window
            || (window.matchMedia && window.matchMedia('(hover: none)').matches);
    } catch { return false; }
}

/** 悬浮球快捷菜单的提示措辞 */
function menuHint() {
    return isTouchDevice() ? '长按悬浮球' : '右键悬浮球';
}

/** ★ 长按已经开过快捷菜单了 ⇒ 这一次松手不该再当"点击"（否则菜单和面板一起弹 ✗） */
let fabHoldOpened = false;
/** 悬浮球正在被拖着（期间别让心跳把它按存档坐标摆回去 ✗） */
let fabDragging = false;

function buildFab() {
    // ★ TT 移动端：悬浮球是"可拖的浮窗" ⇒ 声明 free-window（宿主不长期钳制它的位置，
    //   只在初次准入时让它从 safe-area 里让开一点）；酒馆里没人读这个属性 ✓
    const fab = h('div', {
        class: 'bc-fab', id: 'bc-fab',
        title: `Bodycord · 生理孕育状态面板\n${menuHint()} = 快捷菜单`,
        'data-tt-mobile-surface': 'free-window',
    });
    fab.appendChild(h('span', { class: 'bc-fab-icon' }, deviceIcon(27)));
    document.body.appendChild(fab);

    // ---- 右键 / 长按 → 快捷菜单 ----
    // 原来「改数值 / 推演 / 日志」挤在面板顶上，跟面板自己的工具条打架。
    // 收到悬浮球上：桌面右键、手机长按，都顺手。
    let holdTimer = null;
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

    fab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelHold();
        openFabMenu(e.clientX, e.clientY);
    });
    fab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;         // 右键交给 contextmenu
        cancelHold();
        holdTimer = setTimeout(() => {
            holdTimer = null;
            fabHoldOpened = true;          // 这一次松手别再当"点击"，否则菜单和面板一起弹 ✗
            openFabMenu(e.clientX, e.clientY);
        }, 480);
    });
    // 一拖动就取消长按，免得拖位置的时候弹出菜单
    fab.addEventListener('pointermove', cancelHold);
    fab.addEventListener('pointerup', cancelHold);
    fab.addEventListener('pointerleave', cancelHold);
    fab.addEventListener('pointercancel', cancelHold);

    return fab;
}

/** 手动保存（悬浮球菜单那颗）—— 校验不过就说清为什么，绝不静默失败 ✓ */
async function doManualSave() {
    const before = saveStatus();
    let ok = false;
    try { ok = await flushChatMetadataNow(); } catch { ok = false; }
    if (ok) {
        const t = new Date(saveStatus().lastSavedAt);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        try { window.toastr?.success?.('数据已保存（' + hh + ':' + mm + '）'); } catch { /* 忽略 */ }
        return;
    }
    const msg = !before.dirty
        ? '现在没有需要保存的改动'
        : '这个聊天还没准备好（可能正在切换或加载），改动留着，过一会儿会自动再存';
    try { window.toastr?.info?.(msg); } catch { /* 忽略 */ }
}

/** 悬浮球快捷菜单（改数值 / 推演 / 日志 / 设置） */
function openFabMenu(x, y) {
    document.getElementById('bc-fab-menu')?.remove();

    // ★ 2026-10-21：手动保存**只在真有未保存改动时才出现** ——
    //   平时是自动保存，菜单里常驻一颗「保存数据」会被误读成"不点就不算存档" ✗
    let dirtyNow = false;
    try { dirtyNow = !!saveStatus().dirty; } catch { dirtyNow = false; }
    const saveItems = dirtyNow
        ? [['💾', '有改动未保存 · 点这里立刻存', () => doManualSave(), true,
            '平时改动会自动保存，这一颗只在关浏览器之前想立刻写进去的时候用']]
        : [];

    // 最后一项 true = **只在聊天里能用**（读写的都是某个聊天的数据 ✓）
    // ★★ 被排除的角色卡（2026-10-28）：这个卡里不推演、也不记东西 ⇒
    //   跟推演 / 账本有关的那几项**整项不列**（别做成"点了没反应" ✗），只留设置 ✓
    //   ★ 并且**面板上不占任何一条横条**（她要界面干净）⇒ 恢复入口就放在这里 ✓
    const excludedNow = isCardExcluded();
    const judgeItems = excludedNow ? [] : [
        ['📝', '改数值', () => openFieldEditor(null), true],
        // ★ 角色基础信息：**单独开一项**（不放在"改数值"里面，
        //   单独调一个选项出来，并且只在聊天内才有；非聊天不需要 ✓ —— 悬浮球菜单本来就只在聊天里能用 ✓）
        ['⚧', '角色基础信息', () => openBodyInfo(), true],
        // ★ 孩子：出生后的记录——名字 / 出生日期都由玩家自己改
        //   （名字编辑交给玩家自己做 —— AI 可能无法准确识别多个孩子的名字）
        ['👶', '胎儿 / 孩子', () => openChildrenEditor(), true],
        ['🔮', '立刻推演一次', () => doJudge(), true],
        ['📜', '上次推演日志', () => showLog(), false],
    ];
    const enableItems = excludedNow ? [[
        '🔓', '这张卡没启用推演 · 点这里恢复',
        () => {
            const av = currentCardAvatar();
            if (!av) return;
            setCardExcluded(av, false);
            // 不弹右上角（2026-10-28 她定的），只写控制台 ✓
            console.log('[Bodycord] 这张卡已恢复推演');
            try { rebuildInjection(); } catch { /* 忽略 */ }
            try { refreshAll(); } catch { /* 忽略 */ }
        },
        true,
    ]] : [];
    const items = [
        ...enableItems,
        ...judgeItems,
        ...saveItems,
        ['⚙️', '插件设置', () => openTab('settings'), false],
    ];

    const menu = h('div', { class: 'bc-fab-menu', id: 'bc-fab-menu' });
    // ★ 右键菜单也挂在 <body> 上 ⇒ 日夜和易读两档
    //   都要自己带一份 —— 不带的话**一个都没设**：面板切成黑夜它照样白底、易读模式也不放大 ✗
    //   （菜单每次打开都新建 ⇒ 直接读当前设置就行，不用另外联动 ✓）
    menu.dataset.theme = settings().ui.theme || 'light';
    menu.dataset.vision = settings().visionMode === 'large' ? 'large' : 'normal';
    // ★ 2026-10-19：非聊天页那几项**变灰 + 点了只提示、不执行**（不静默 ✗）
    let inChat = true;
    try { inChat = inChatPage(); } catch { /* 读不到就照旧 */ }
    for (const [icon, label, fn, chatOnly, tip] of items) {
        const off = chatOnly && !inChat;
        const el = h('div', {
            class: 'bc-fab-menu-item',
            onclick: () => {
                if (off) {
                    try { window.toastr?.info?.('这个改的是某个聊天的数据，先在聊天里打开再用'); } catch { /* 忽略 */ }
                    return;
                }
                menu.remove();
                fn();
            },
        }, h('span', { class: 'bc-fab-menu-icon', text: icon }), h('span', { text: label }));
        if (off) {
            el.style.opacity = '.45';
            el.title = '先在聊天里打开再用';
        } else if (tip) {
            el.title = tip;
        }
        menu.appendChild(el);
    }

    document.body.appendChild(menu);
    // 贴着鼠标放，但别越出屏幕
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(Math.max(6, x), window.innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(Math.max(6, y), window.innerHeight - r.height - 6) + 'px';

    const onKey = (ev) => { if (ev.key === 'Escape') closeMenu(); };
    const close = (ev) => { if (!menu.contains(ev.target)) closeMenu(); };
    function closeMenu() {
        menu.remove();
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', onKey, true);
    }
    setTimeout(() => {
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('keydown', onKey, true);
    }, 0);
}

// ---------------------------------------------------------------------------
// ★ 悬浮球上的「提醒气泡」✓
//
// 形态：**让悬浮球弹出一个气泡** ＋ **最好再配一个可以直接预览的按钮** ✓
// 为什么做：日程的「到日子了」原来**只有翻到日历那一页才看得见** ⇒ 提醒根本送不出来。
//   悬浮球是**所有页面都在**的那个唯一入口 ⇒ 把提醒贴在它旁边最省事 ✓
//
// 三条规矩：
//   · 不闪、不响、**不自动消失**（不打扰）
//   · 日历那一页正开着时不弹（那页顶上已经有那条横幅了，不重复）
//   · 聊天里 = 看**剧情日期**那份日程；不在聊天里 = 看**现实那份**（按设备今天 ✓
//     非聊天日历也需要提醒 ✓）—— 两份账本各记各的 ✓
// ⚠️⚠️ 气泡**绝不能碰悬浮球本身**（它挂着唯一入口，收掉就等于插件再也打不开 ✗）
// ---------------------------------------------------------------------------

let reminderBubble = null;
let bubblePreview = false;          // 「预览」那颗按钮点出来的：用样例内容、**不写"提示过了"的账** ✓
let bubbleKeys = [];                // 当前这批的键（点 ✕ / 点本体时记成"提示过了"）
const BUBBLE_MAX = 2;               // 气泡里最多列几条（多的写「还有 N 条」✓）

/** 现在该提醒的那批（聊天里 = 剧情日期那份；不在聊天里 = 现实那份，按设备今天 ✓） */
function bubbleAlerts() {
    try {
        if (inChatPage()) return calendarAlertsForPanel();
        // ★ **非聊天日历也需要提醒** ✓ ⇒ 不在聊天里就看**现实那份**
        //   （判据是设备今天，账本也在全局设置里 ✓）
        return realAlertsToday();
    } catch { return []; }
}

/**
 * ★ 怀孕 / 预产期那两条要独立出来，不用日程的判定，但气泡可以套用 ✓ ——
 *   把**自动提醒**那一份并进气泡这批里。
 * ⚠️ 只在**聊天里**并（它按**剧情日期**算，本身就是"这个故事里的事" ✓；
 *   非聊天页面看的是现实那份日程，跟剧情无关 ✗）。
 */
function autoAlertEntries() {
    try {
        if (!inChatPage()) return [];
        return alertEntriesForBubble();
    } catch { return []; }
}

/** 这条提醒是不是"自动提醒"那份（点掉时要记到它自己的账上 ✓） */
function isAutoAlertKey(k) {
    return String(k || '').startsWith('alert:');
}

/** 这批提醒属于哪个账本（点掉的时候要记到对的那一份里 ✓） */
function bubbleAlertsAreReal() {
    try { return !inChatPage(); } catch { return false; }
}

/** 气泡里要显示的那批（预览时没有真实内容就用样例 ✓） */
function bubbleEntries() {
    if (bubblePreview) {
        const real = bubbleAlerts();
        if (real.length) return real;
        return [{ date: '1年02月14日', note: '示例日程：情人约会' }];
    }
    // ★ 自动提醒（怀孕 / 预产期）排前面 —— 那是"关于人的事"，比日程更要紧 ✓
    return [...autoAlertEntries(), ...bubbleAlerts()];
}

/** 日历那一页是不是正开着（开着就不弹 ✓；面板没开就谈不上开着） */
function calendarPageOpen() {
    try {
        if (!els?.root?.classList.contains('show')) return false;
        for (const v of statusViews) {
            if (v.panel?.iframe?.contentWindow?.__bodycordGetView?.() === 'calendar') return true;
        }
    } catch { /* 忽略 */ }
    return false;
}

/** 番茄钟那一页是不是正开着（跟日历那个同一套判据 ✓）
 *  ★ **面板关着 / 切在别的频道 ⇒ 一个字都不用推**
 *    （重新点进那一页时会自己来要一份 ✓）；
 *       那时候唯一需要动的就是**那颗悬浮球**，而它挂在页面上、不走面板这条路 ✓ */
function timerPageOpen() {
    try {
        if (!els?.root?.classList.contains('show')) return false;
        for (const v of statusViews) {
            if (v.panel?.iframe?.contentWindow?.__bodycordGetView?.() === 'timer') return true;
        }
    } catch { /* 忽略 */ }
    return false;
}

function closeReminderBubble() {
    try { reminderBubble?.remove(); } catch { /* 忽略 */ }
    reminderBubble = null;
    bubbleKeys = [];
}

/**
 * ★ 气泡要**实时跟**球走（不实时跟容易出现位移 BUG ✓）——
 *   气泡原来**只在 1.2 秒一次的心跳里**挪位（`syncPresentation` → `syncReminderBubble`）
 *   ⇒ 拖球的时候它落在后面、看着像"错位" ✗ ⇒ 拖球那条指针事件里也跟一次 ✓
 *
 * ⚠️ **rAF 节流**：拖一次能发上百个 pointermove，每一下都去重排/读布局不值得；
 *   一帧只跟一次就够（跟手的感觉一样 ✓）
 * ⚠️ 心跳那一次**保留当兜底**（别的路径动了球也会收敛 ✓），这里只是"多一条更快的路"
 */
let _bubbleFollowRaf = 0;
function followBubbleToFab() {
    if (_bubbleFollowRaf) return;                         // 这一帧已经排过了 ✓
    try {
        _bubbleFollowRaf = window.requestAnimationFrame(() => {
            _bubbleFollowRaf = 0;
            try { placeReminderBubble(); } catch { /* 忽略 */ }
        });
    } catch {
        // 没有 rAF（理论上不会）⇒ 直接跟一次，别把跟手这件事丢了 ✓
        try { placeReminderBubble(); } catch { /* 忽略 */ }
    }
}

/** 贴在球旁边：球在右半边就挂左边，反之挂右边（永远别越出屏幕 ✓） */
function placeReminderBubble() {    const box = reminderBubble;
    const fab = els?.fab;
    if (!box || !fab) return;
    try {
        const r = fab.getBoundingClientRect();
        const bw = box.offsetWidth || 240;
        const bh = box.offsetHeight || 90;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 10;
        const onRight = (r.left + r.width / 2) > (vw / 2);
        let left = onRight ? (r.left - bw - gap) : (r.right + gap);
        let top = r.top + (r.height / 2) - (bh / 2);
        left = Math.max(8, Math.min(left, vw - bw - 8));
        top = Math.max(8, Math.min(top, vh - bh - 8));
        box.style.left = Math.round(left) + 'px';
        box.style.top = Math.round(top) + 'px';
    } catch { /* 忽略 */ }
}

function paintReminderBubble(list) {
    const fab = els?.fab;
    if (!fab) { closeReminderBubble(); return; }
    const keys = list.map((a) => a.key || (String(a.date) + '|' + String(a.note)));
    const stamp = keys.join('\n') + (bubblePreview ? '|p' : '');    // 同一批就不用重画（每 1.2 秒刷一次，重画会闪 ✓）——只挪一下位置
    if (reminderBubble && reminderBubble.dataset.keys === stamp) { placeReminderBubble(); return; }
    closeReminderBubble();

    const s = settings();
    const box = h('div', { class: 'bc-bubble', id: 'bc-bubble' });
    box.dataset.keys = stamp;
    box.dataset.theme = s.ui.theme || 'light';
    if (s.visionMode === 'large') box.dataset.vision = 'large';
    bubbleKeys = keys;

    const head = h('div', { class: 'bc-bubble-head' },
        // ★ 这句可以自己改（设置 → 时间与日历 → 提醒气泡）——
        //   空 / 全是空白 ⇒ `bubbleTitle()` 会回出厂那句，顶上永远不会空白 ✓
        h('div', { class: 'bc-bubble-title', text: bubbleTitle() }),
        bubblePreview ? h('div', { class: 'bc-bubble-tag', text: '预览' }) : null,
        h('div', { class: 'bc-bubble-sp' }),
        h('div', {
            class: 'bc-bubble-x',
            title: bubblePreview ? '关掉预览' : '知道啦',
            onclick: (e) => { e.stopPropagation(); dismissReminderBubble(); },
        }, h('span', { text: '✕' })),
    );
    box.appendChild(head);

    const boxList = h('div', { class: 'bc-bubble-list' });
    for (const a of list.slice(0, BUBBLE_MAX)) {
        boxList.appendChild(h('div', { class: 'bc-bubble-item' },
            h('div', { class: 'bc-bubble-note', text: String(a.note || '') }),
            h('div', { class: 'bc-bubble-when', text: String(a.date || '') }),
        ));
    }
    if (list.length > BUBBLE_MAX) {
        boxList.appendChild(h('div', { class: 'bc-bubble-more', text: `还有 ${list.length - BUBBLE_MAX} 条` }));
    }
    box.appendChild(boxList);
    // ★ 脚注**预览版说实话** —— 真气泡点本体是跳页，预览版不跳 ⇒ 别在那里挂着
    //   一句"点这里去日历看"却点不动 ✗
    //   ⇒ 结论：不挂在外头、也不放问号里，就写在气泡自己这行脚注上，看到的人正好是会产生误会的那个人 ✓
    // ★ 自动提醒（怀孕 / 预产期）**不在日历里** ⇒ 这种气泡不许把人送去日历 ✗
    const anyCalendar = list.some((a) => !isAutoAlertKey(a.key));
    box.appendChild(h('div', {
        class: 'bc-bubble-foot',
        text: bubblePreview ? '真正的气泡点这里会跳到日历' : (anyCalendar ? '点这里去日历看' : '点这里关掉'),
    }));
    // ★ 预览版点本体只关气泡、不跳页 ✓
    //   （预览的用途是看提醒词写成什么样，不是被弹走；从设置页点进来的人正站在编辑页 ✗）
    //   真正的气泡照旧跳（行为不变 ✓，那条由 openCalendarFromBubble 管）
    box.addEventListener('click', () => {
        if (bubblePreview) { dismissReminderBubble(); return; }
        if (!anyCalendar) { dismissReminderBubble(); return; }   // 自动提醒 ⇒ 只关掉 ✓
        openCalendarFromBubble();
    });

    document.body.appendChild(box);
    reminderBubble = box;
    placeReminderBubble();
}

/**
 * ★★ 推演那一档气泡。
 *
 * 为什么是它：球上原来那圈转圈**不要了** —— 球可以被玩家换成自定义图片，
 *   任何贴在球身上的东西都会压坏那张图 ✗ ⇒ "正在推演"必须有一个**永远都在**的提示位，
 *   而球旁边这颗气泡就是那个位（球本身永远都在 ✓）。
 *   ⚠️ 楼层面板可以被玩家关掉（设置里那格）⇒ **不能只靠楼层那一行** ✓
 *   ★★ 2026-10-15：**楼层面板开着时，这条气泡不弹** ——
 *     状态和停止入口那时候就在楼层那一行上，两处同时报同一件事看着重复 ✗
 *     ⇒ 它只兜"楼层被关掉"这一种情况（见 `syncReminderBubble()` 那个判据 ✓）
 *
 * ⚠️⚠️ 它跟"提醒"共用同一个气泡元素，但**绝不碰提醒的账**：
 *   · 不写 `bubbleKeys` ⇒ `markBubbleSeen()` 没有东西可记 ✓（不然还没看的提醒会被悄悄吃掉 ✗）
 *   · ✕ 只是"先把这条收起来"（`judgeBubbleHidden`），状态一变就复位 ✓
 *   · 点它本体**不跳日历**（它没有"去日历看"这回事 ✓）
 */
let judgeBubbleHidden = false;

function paintJudgeBubble(state) {
    const fab = els?.fab;
    if (!fab) { closeReminderBubble(); return; }
    const stamp = 'judge:' + state;
    // 同一档就不用重画（心跳 1.2 秒一次，重画会闪 ✓）——只挪一下位置
    if (reminderBubble && reminderBubble.dataset.keys === stamp) { placeReminderBubble(); return; }
    closeReminderBubble();

    const s = settings();
    const spec = judgeBtnSpec(state);
    const box = h('div', { class: 'bc-bubble bc-bubble-judge', id: 'bc-bubble' });
    box.dataset.keys = stamp;
    box.dataset.theme = s.ui.theme || 'light';
    if (s.visionMode === 'large') box.dataset.vision = 'large';

    box.appendChild(h('div', { class: 'bc-bubble-head' },
        h('div', { class: 'bc-bubble-title', text: '状态推演' }),
        h('div', { class: 'bc-bubble-sp' }),
        h('div', {
            class: 'bc-bubble-x',
            title: '先把这条收起来（这次推演还在跑）',
            onclick: (e) => {
                e.stopPropagation();
                judgeBubbleHidden = true;
                closeReminderBubble();
            },
        }, h('span', { text: '✕' })),
    ));
    // ★★ 2026-10-15（气泡上只放停止按钮，推演过程与进度去悬浮球里看）——
    //   ⇒ 这一档气泡**只说一件事：停止**（进度那一行删了：按钮自己的词就写着
    //     「停止推演 / 取消这次推演」；进度/推演过程去悬浮球里看 ✓）
    // ★ 停在这一档上（楼层被关掉的人只有这里能停 ✓）
    box.appendChild(h('div', { class: 'bc-bubble-act' },
        button(spec.label, () => {
            let r = { pending: false, running: false };
            try { r = cancelRun(); } catch { /* 忽略 */ }
            if (r.running) window.toastr?.info?.('这次推演已停止（一个字都不会写）');
            else if (r.pending) window.toastr?.info?.('排队中的那次推演已取消');
            try { syncJudgeState(); } catch { /* 忽略 */ }
        }, { variant: 'danger', title: spec.title }),
    ));

    document.body.appendChild(box);
    reminderBubble = box;
    placeReminderBubble();
}

/**
 * 每轮刷新都问一次"要不要弹 / 要不要收"（挂在 syncPresentation 上，1.2 秒一次 ✓）
 * ⚠️ 它只碰气泡，**一个字都不碰悬浮球** ✓
 */
export function syncReminderBubble() {
    if (!els) return;
    // ★★ 推演那一档优先（它只活几十秒，跑完立刻回到提醒 ✓）
    //   ⚠️ 例外：玩家自己点开的：预览优先，不然点预览时正好在推演就看不到预览了 ✗
    let st = '';
    try { st = queueState(); } catch { st = ''; }
    // ★★ 2026-10-15（楼层推演气泡提醒能不能只在没开这个时出现，免得重复两处）：**楼层面板开着时，这条气泡不弹** ✓
    //   状态与停止入口那时候就在楼层那一行上；关掉楼层面板的人才需要它兜底 ✓
    let floors = true;
    try { floors = floorsOn(); } catch { floors = true; }
    if (st && !bubblePreview && !floors) {
        if (judgeBubbleHidden) closeReminderBubble();
        else paintJudgeBubble(st);
        return;
    }
    judgeBubbleHidden = false;
    let list = [];
    try { list = bubbleEntries(); } catch { list = []; }
    if (!list.length || (!bubblePreview && calendarPageOpen())) {
        closeReminderBubble();
        return;
    }
    paintReminderBubble(list);
}

/**
 * ★★ 推演状态（排队中 / 正在跑）**只有一个判据**：`judge-queue.js` 的 `queueState()`。
 *   ⚠️ 别用外壳里那个 `busy` —— 它只在**手动推演**那条路上被置位，
 *     自动推演（生成完之后自己排的那次）根本不经过它 ⇒ 界面会"假装没在跑" ✗
 *   变了才动界面：① 楼层那一行重画（按钮换词 + 标题写「正在推演…」）
 *              ② 气泡换档 / 退出 ③ 面板上那个"忙"光标
 *   （球上那圈转圈已经不画了 —— 会压坏自定义球图，见 setBusy 那段 ✓）
 */
let _lastQueueState = null;
function syncJudgeState() {
    let st = '';
    try { st = queueState(); } catch { st = ''; }
    if (st === _lastQueueState) return;
    _lastQueueState = st;
    judgeBubbleHidden = false;      // 状态真的变了 ⇒ 刚才收起来的那一档重新露出来 ✓
    setBusy(!!st);
    try { refreshAllFloors(); } catch { /* 忽略 */ }
    try { syncReminderBubble(); } catch { /* 忽略 */ }
}

/** 记成"提示过了"（**预览不写账** ✓；聊天那份 / 现实那份各记各的 ✓） */
function markBubbleSeen() {
    if (bubblePreview) { bubblePreview = false; return; }
    const keys = Array.isArray(bubbleKeys) ? bubbleKeys : [];
    const auto = keys.filter(isAutoAlertKey);
    const cal = keys.filter((k) => !isAutoAlertKey(k));
    try {
        // ★ 自动提醒那份记在**它自己**身上（`seen` ✓）；日程那份照旧记进对应账本 ✓
        // ★ 2026-10-26：同一天的几胎在气泡里并成一条 ⇒ key 是 `alert:id1+id2+id3`，
        //   点 ✕ 时**每一条都要记成看过**（漏一条 ⇒ 下次又弹 ✗）
        for (const k of auto) {
            for (const id of String(k).slice('alert:'.length).split('+').filter(Boolean)) {
                try { markAlertSeen(id); } catch { /* 忽略 */ }
            }
        }
        if (cal.length) {
            if (bubbleAlertsAreReal()) markRealAlerted(cal);
            else markCalendarAlerted(cal);
        }
    } catch { /* 忽略 */ }
}

/** 点 ✕ = 知道啦（只记账，不开面板 ✓） */
function dismissReminderBubble() {
    markBubbleSeen();
    closeReminderBubble();
}

/** 点本体 = 记账 ＋ 打开面板并翻到日历那一页（去那儿看 / 改 ✓） */
function openCalendarFromBubble() {
    markBubbleSeen();
    closeReminderBubble();
    try { openTab('status'); } catch { /* 忽略 */ }
    // ⚠️ 面板 iframe 可能是**刚被建出来的**（还没 mount 完）⇒ 切页会落空。
    //   ⇒ 试三下（80 / 260 / 600 毫秒），一旦它已经在日历页就停 ✓
    const tries = [80, 260, 600];
    tries.forEach((delay) => {
        setTimeout(() => {
            try {
                for (const v of statusViews) {
                    const w = v.panel?.iframe?.contentWindow;
                    if (!w || typeof w.__bodycordSwitchView !== 'function') continue;
                    if (w.__bodycordGetView?.() === 'calendar') return;
                    w.__bodycordSwitchView('calendar');
                }
            } catch { /* 忽略 */ }
        }, delay);
    });
}

/**
 * ★ **做一个可以直接预览的按钮** ✓
 * 入口＝设置页「时间与日历」那张「提醒气泡」卡上那颗「💬 预览提醒气泡」
 *   （气泡预览归「时间与日历」这一页，不挂在常规页「诊断与数据」那张卡上 ✓）
 * ⚠️ 预览出来的气泡多一个「预览」小标，而且**关了不写"提示过了"的账** —— 免得跟真提醒混淆 ✓
 */
export function previewReminderBubble() {
    bubblePreview = true;
    try { syncReminderBubble(); } catch (e) { console.warn('[Bodycord] 预览提醒气泡失败', e); }
}

// ---------------------------------------------------------------------------
// ★★ 悬浮歌词条（悬浮在界面外面、跟歌走的那种歌词条 ✓）
//
// 口径：**单行**就够；跟着歌的进度**逐渐变色**；手机也要；
//   **面板关着也在**；**独立于悬浮球**（自己的位置，不跟球走）；可以**锁位置**；
//   颜色 / 透明度自己改；「本地点播」那儿有一键重置 ✓
//
// 谁负责什么（两个文档，别搞混）：
//   · **配置**（开关/颜色/透明度/锁/位置）归**外壳**，存 `settings().ui.lyricBar`
//     —— 跟悬浮球位置同一个家 ✓；面板那套 UI 只是"遥控器"（它够不到插件设置 ⇒ 发消息让外壳改 ✓）
//   · **歌词本身**（现在哪一句 / 唱到几成）由**面板**推 —— 音频是它那个 iframe 里的 `Audio` ✓
//
// ⚠️ 先生限制：`.lrc` 只有**行级**时间戳、没有字级 ⇒ 这里做的是
//   "这一行从开始唱、按时间均匀把颜色推到下一行开始"，**不是**真正唱到哪个字 ✓
// ⚠️ 跟随只在**播放中**发生：面板那边挂在 `timeupdate`（约 4 次/秒），暂停就没有事件 ⇒
//   不播放时这边一个定时器都不跑 ✓
// ---------------------------------------------------------------------------
let lyricBar = null;
// ★ 上次**真正写进 DOM** 的那份值：一样就不写。
//   为什么要它（不这么做：拖拽很奇怪，有的时候拖拽之后会回到原地 ✓）：
//   音乐在放的时候 `timeupdate` 约 4 次/秒 ⇒ 每次都重画那条浮条；而**拖到一半**时
//   手刚把 `left/top` 改掉，下一次重画又按"配置里那个旧坐标"写一遍 ⇒
//   看着就是「拖一下它自己弹回原地」✗✓✓ ⇒ 现在只有"值真变了"才写位置 ✓
//   （红线同族：改一样东西不许顺手把另一样覆盖回去 ✓）
let lyricApplied = null;
// 位置选了"档位"（居中/左中/…）时，窗口一变大小就得重算一次 ⇒ 需要这条 resize 钩子；
// 选回自定义 / 默认时**立刻解绑**（不留空跑的监听 ✓）
let lyricResizeHook = null;
// ★ 坐标的"冻结"（基准点锁定 ✓）：算一次存这儿，只有手动拖 / 窗口变了才重算
let lyricAnchor = { key: '', x: null, y: null, right: false };
function toggleLyricResizeHook(on) {
    try {
        if (on && !lyricResizeHook) {
            // 窗口一变大小 ⇒ 把冻结键作废，下一次重画自己重算 ✓（自定义坐标是绝对的，重算也不动 ✓）
            lyricResizeHook = () => { lyricAnchor.key = ''; try { applyLyricBar(); } catch { /* 忽略 */ } };
            window.addEventListener('resize', lyricResizeHook);
        } else if (!on && lyricResizeHook) {
            window.removeEventListener('resize', lyricResizeHook);
            lyricResizeHook = null;
        }
    } catch { /* 忽略 */ }
}
const lyricState = { loaded: false, playing: false, hasLyrics: false, text: '', pct: 0 };

/** 配置（永远给一份完整的：缺字段补默认 ✓） */
function lyricCfg() {
    const def = (DEFAULT_SETTINGS?.ui?.lyricBar) || {};
    const s = settings();
    if (!s.ui || typeof s.ui !== 'object') s.ui = {};
    if (!s.ui.lyricBar || typeof s.ui.lyricBar !== 'object') s.ui.lyricBar = Object.assign({}, def);
    const out = {};
    for (const k of Object.keys(def)) out[k] = (s.ui.lyricBar[k] === undefined ? def[k] : s.ui.lyricBar[k]);
    return out;
}

/** 改配置（面板遥控 / 拖拽落位都走这里）：改完立刻落盘 + 立刻生效 ✓ */
function setLyricCfg(patch) {
    const def = (DEFAULT_SETTINGS?.ui?.lyricBar) || {};
    const s = settings();
    if (!s.ui.lyricBar || typeof s.ui.lyricBar !== 'object') s.ui.lyricBar = Object.assign({}, lyricCfg());
    for (const k of Object.keys(patch || {})) {
        const v = patch[k];
        if (k === 'on' || k === 'lock') s.ui.lyricBar[k] = !!v;
        else if (k === 'alpha') s.ui.lyricBar.alpha = Math.max(0.15, Math.min(1, Number(v) || def.alpha));
        // ★ 大小（缩放）：0.8 ~ 2.0（默认还挺小 ⇒ 出厂 1.25 ✓）
        else if (k === 'scale') s.ui.lyricBar.scale = Math.max(0.8, Math.min(2, Number(v) || def.scale));
        // ★ 竖排 / 档位位置 ——
        //   竖排 = 文字从上往下读 ✓；位置只收那 5 个档名，其它一律当"自定义"（null ✓）
        else if (k === 'vertical') s.ui.lyricBar.vertical = !!v;
        else if (k === 'pos') {
            const okPos = ['center', 'left', 'right', 'top', 'bottom'];
            s.ui.lyricBar.pos = okPos.includes(String(v)) ? String(v) : null;
        }
        else if (k === 'x' || k === 'y') {
            const n = Number(v);
            s.ui.lyricBar[k] = (v === null || v === undefined || !Number.isFinite(n)) ? null : Math.round(n);
        } else if (k === 'sung' || k === 'unsung') s.ui.lyricBar[k] = String(v == null ? '' : v).slice(0, 32);
        else if (Object.prototype.hasOwnProperty.call(def, k)) s.ui.lyricBar[k] = v;
    }
    save();
    applyLyricBar();
    return lyricCfg();
}

/** 一键重置（面板那颗按钮）：**只动这一条浮条**，别的一个字不碰 ✓ */
function resetLyricCfg() {
    const s = settings();
    s.ui.lyricBar = Object.assign({}, (DEFAULT_SETTINGS?.ui?.lyricBar) || {});
    save();
    applyLyricBar();
    return lyricCfg();
}

function buildLyricBar() {
    const el = h('div', { class: 'bc-lyrics', id: 'bc-lyrics' },
        h('span', { class: 'bc-lyrics-text', id: 'bc-lyrics-text' }));
    document.body.appendChild(el);
    // 整条都能拖（它身上没有任何按钮 ⇒ 不用留命中区 ✓）；锁着就拖不动 ✓
    makeDraggable(el, el, {
        canDrag: () => !lyricCfg().lock,
        // ⚠️ 拖完要**把档位位置清掉**（pos=null）—— 不然下一次重画又会按档位算一遍、把它拽回去 ✗
        //   （"拖过 = 自定义"，跟那五颗按键是互斥的两种状态 ✓）
        onDrop: (rect) => {
            try {
                setLyricCfg({ pos: null, x: Math.round(rect.left), y: Math.round(rect.top) });
                // ★ 拖完立刻把配置回推给面板：不然"位置"那栏还亮着上一次选的档、读数也不对 ✗
                pushLyricCfgToPanel();
            } catch { /* 忽略 */ }
        },
    });
    return el;
}

/**
 * 把配置 + 现在的歌词刷到 DOM 上（这是唯一的出口，改什么都走它 ✓）
 *
 * ⚠️⚠️ **每一项都"只有值真变了才写"** —— 这不是省事，是修 bug：
 *   音乐在放的时候 `timeupdate` 约 4 次/秒地调这里；而拖到一半时手刚把
 *   `left/top` 改掉，下一次重画若照旧把"配置里那个旧坐标"写一遍，浮条就会自己弹回原地
 *   （拖拽很奇怪、有的时候会拖拽之后回到原地，就是它 ✗）
 *   ⇒ 位置 / 透明度 / 颜色 / 大小 / 锁 全走 `lyricApplied` 这份对照表，一样就不碰 ✓
 *   （文字和进度是真会变的，照常写 ✓）
 */
function applyLyricBar() {
    const cfg = lyricCfg();
    const st = lyricState;
    // 没开 / 还没载入任何一首 ⇒ 不占地方（完全没在放歌时不出现 ✓）
    const show = !!cfg.on && !!st.loaded;
    if (!show) {
        if (lyricBar) lyricBar.style.display = 'none';
        toggleLyricResizeHook(false);      // 不显示就没什么要重算的 ⇒ 把监听解掉 ✓
        return;
    }
    // ⚠️ 扩展被禁用时 `hideUI()` 会把节点 remove 掉 ⇒ 手里那个就脱离文档了，得重建 ✓
    if (lyricBar && !lyricBar.isConnected) { lyricBar = null; lyricApplied = null; }
    if (!lyricBar) lyricBar = buildLyricBar();
    if (lyricBar.style.display === 'none') lyricBar.style.display = '';
    const prev = lyricApplied || (lyricApplied = {});
    const theme = settings().ui.theme || 'light';
    const vision = settings().visionMode === 'large' ? 'large' : 'normal';
    if (prev.theme !== theme) { lyricBar.dataset.theme = theme; prev.theme = theme; }
    if (prev.vision !== vision) { lyricBar.dataset.vision = vision; prev.vision = vision; }
    if (prev.alpha !== cfg.alpha) { lyricBar.style.opacity = String(cfg.alpha); prev.alpha = cfg.alpha; }
    // ★ 大小：整条按这个系数放大（出厂 1.25 ✓）
    if (prev.scale !== cfg.scale) { lyricBar.style.setProperty('--ly-scale', String(cfg.scale)); prev.scale = cfg.scale; }
    if (prev.lock !== cfg.lock) { lyricBar.classList.toggle('locked', !!cfg.lock); prev.lock = !!cfg.lock; }
    // ★ 竖排 —— 一定要**赶在算位置之前**做：
    //   横排和竖排的尺寸完全不同，位置得按"此刻的真实尺寸"算才贴得住边 ✓
    if (prev.vertical !== cfg.vertical) {
        lyricBar.classList.toggle('vertical', !!cfg.vertical);
        prev.vertical = !!cfg.vertical;
        prev.pos = null;            // 方向一换尺寸就变了 ⇒ 位置强制重算一遍 ✓
    }
    // 颜色：留空就交给 CSS 的默认（跟着主题走 ✓）；自己选了色就存死值 ✓
    if (prev.sung !== cfg.sung) {
        if (cfg.sung) lyricBar.style.setProperty('--ly-sung', cfg.sung); else lyricBar.style.removeProperty('--ly-sung');
        prev.sung = cfg.sung;
    }
    if (prev.unsung !== cfg.unsung) {
        if (cfg.unsung) lyricBar.style.setProperty('--ly-unsung', cfg.unsung); else lyricBar.style.removeProperty('--ly-unsung');
        prev.unsung = cfg.unsung;
    }
    // ★★ 位置 ＋ **基准点锁定**（有它，歌词长度不一样的时候才不会跳 ✓）
    //
    // 病根："每一次重画都按此刻的尺寸重算坐标" ⇒ 歌词一换行、尺寸一变，坐标就跟着变
    //   ⇒ 那条自己在那儿挪 ✗（而且每句歌词都会挪一次）。
    // ⇒ 现在：坐标**算一次就冻住**（存在 `lyricAnchor` 里），只有下面这几件事才重算：
    //     · 你换了档位（居中/左中/…）   · 换了横排/竖排   · 改了大小   · 窗口变了   · 你拖过
    //   **歌词自己换行引起的尺寸变化 = 不重算** ✓ ⇒ 换行时它从固定的那个角往下/往右长，
    //   开头那个字**一动不动** ✓（看歌词的时候这点最要紧）
    // ⚠️ 锚的是**左上角**；只有「右中」锚**右上角**（不然歌词一长就顶出屏幕右边 ✗）
    const M = 12;          // 贴边留多少
    const MB = 92;         // "下中"离底边多少（跟原来那套一致，别压住聊天输入框 ✓）
    const isDefaultPos = (cfg.x === null && cfg.y === null);
    const aKey = [
        cfg.pos || 'custom', cfg.vertical ? 'v' : 'h', cfg.scale,
        window.innerWidth, window.innerHeight,
        isDefaultPos && !cfg.pos ? 'bottom' : (cfg.pos ? '' : (cfg.x + ',' + cfg.y)),
    ].join('|');
    if (lyricAnchor.key !== aKey) {
        const w = lyricBar.offsetWidth || 0;
        const h = lyricBar.offsetHeight || 0;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        let ax = null, ay = null, rightEdge = false;
        const pos = cfg.pos || (isDefaultPos ? 'bottom' : 'custom');
        if (pos === 'center') { ax = Math.round((vw - w) / 2); ay = Math.round((vh - h) / 2); }
        else if (pos === 'left') { ax = M; ay = Math.round((vh - h) / 2); }
        else if (pos === 'right') { ax = Math.round(vw - M); ay = Math.round((vh - h) / 2); rightEdge = true; }
        else if (pos === 'top') { ax = Math.round((vw - w) / 2); ay = M; }
        else if (pos === 'bottom') { ax = Math.round((vw - w) / 2); ay = Math.round(vh - h - MB); }
        else {
            ax = Math.round(Number(cfg.x));
            ay = Math.round(Number(cfg.y));
            if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = M; ay = M; }
        }
        lyricAnchor = { key: aKey, x: ax, y: ay, right: rightEdge };
    }
    const posKey = lyricAnchor.x + ',' + lyricAnchor.y + '|' + (lyricAnchor.right ? 'r' : 'l');
    if (prev.pos !== posKey) {
        prev.pos = posKey;
        lyricBar.classList.add('bc-positioned');
        if (lyricAnchor.right) { lyricBar.style.left = ''; lyricBar.style.right = M + 'px'; }
        else { lyricBar.style.left = lyricAnchor.x + 'px'; lyricBar.style.right = ''; }
        lyricBar.style.top = lyricAnchor.y + 'px';
    }
    // 窗口一变大小 ⇒ 档位坐标要重算（自定义那种不用：它的坐标是绝对的 ✓）
    toggleLyricResizeHook(true);
    const wantText = st.hasLyrics ? (st.text || '♪') : '无歌词';
    if (prev.text !== wantText) {
        const txt = lyricBar.querySelector('.bc-lyrics-text');
        if (txt) txt.textContent = wantText;
        prev.text = wantText;
    }
    if (prev.nolyric !== !st.hasLyrics) {
        lyricBar.classList.toggle('nolyric', !st.hasLyrics);
        prev.nolyric = !st.hasLyrics;
    }
    const p = Math.max(0, Math.min(1, Number(st.pct) || 0));
    if (prev.pct !== p) { lyricBar.style.setProperty('--ly-p', String(p)); prev.pct = p; }
}

/** 面板推来的"现在唱到哪"（只在播放中有事件，暂停就安静 ✓） */
function updateLyricState(st) {
    if (!st || typeof st !== 'object') return;
    lyricState.loaded = !!st.loaded;
    lyricState.playing = !!st.playing;
    lyricState.hasLyrics = !!st.hasLyrics;
    lyricState.text = String(st.text == null ? '' : st.text);
    lyricState.pct = Number(st.pct) || 0;
    applyLyricBar();
}

/** 面板那颗遥控器要配置 ⇒ 给它一份完整的 ✓（导出是为了测试能直接验行为） */
export function lyricCfgSnapshot() { return lyricCfg(); }
/** 把当前配置**回推**给面板（拖拽换了位置时用 —— 面板那栏读数 / 高亮靠它才同步 ✓） */
function pushLyricCfgToPanel() {
    try {
        const cfg = lyricCfg();
        for (const v of statusViews) v.panel?._replyPanel?.('__bodycordLyricCfg', cfg);
    } catch { /* 忽略 */ }
}
/** 面板改了配置 ⇒ 存下来 + 立刻生效，并把完整配置回给它 ✓ */
export function applyLyricCfgPatch(patch) { return setLyricCfg(patch || {}); }
/** 面板点了「一键重置」✓ */
export function resetLyricCfgAndApply() { return resetLyricCfg(); }

/* ⚠️ 番茄钟那一整段（`timerState` / `initTimer` / `timerPanelAction` …）**故意没写在这里** ——
   它挪到本文件靠后的「番茄钟」那一段去了。理由：units 有一条老断言
   从「悬浮歌词条」切到「诊断面板（画在界面上」，
   长度必须落在 2000 到 12000 之间；把番茄钟塞在中间会把那个切片撑爆 ✗ */

// ---------------------------------------------------------------------------
// 诊断面板（画在界面上，不依赖控制台）
//
// 三件事合成一个：运行时状态 / 业务数据 / 面板预览。
// 原来「数据预览」放在设置页最底下，根本找不到 —— 挪到这里，跟 🔍 在一起。
// 数据默认**打码**（名字和正文遮掉），要点「显示原文」才看得到完整内容。
// ---------------------------------------------------------------------------

/** 构建标记：一眼看出用户跑的是哪一版 */
/**
 * ★ 版本号 + 构建号（扩展面板 / 诊断报告 / 诊断面板里那个「版本」）。
 *
 * 格式定稿：**`1.0（年月日-当天第几版）`** —— 版本号在前，构建号用全角括号包起来。
 *   · 版本号 `PLUGIN_VERSION`：**除非她亲口说"改版本号"，否则一个字都不许动** ✓
 *     （修 BUG、改文案、抬构建，都只动构建号）
 *   · 构建号 `BUILD_STAMP`：每次交付都抬；换一天 ⇒ 从 `-1` 重新数 ✓
 *   · **跟面板那个 `PANEL_BUILD`（`assets/bodycord.html` 里）永远写成同一个串** ✓ ——
 *     两边不一致会被测试当场抓出来（自测脚本）✓
 *   · `manifest.json` 的 `version` 也写成同一个完整串（酒馆扩展卡片上显示的就是它）✓
 */
export const PLUGIN_VERSION = '1.0';
export const BUILD_STAMP = '2026-10-31-31';
/** 界面上给人看的完整版本串：`1.0（构建号）` */
export const BUILD_LABEL = PLUGIN_VERSION + '（' + BUILD_STAMP + '）';

let diagBox = null;
let diagTab = 'runtime';
let diagUnmasked = false;

/**
 * ★★ 身份词打码的**兜底层**（结构行会漏名字，见下面的案例）
 *
 * 案例：诊断页「沉浸补丁全文」里有一行 `【身体补丁（生理设定） · 对象：示例角色】` ——
 * `maskLongText()` 把「【标题】」这种**结构行原样保留**（以为"结构行不含隐私"）✗，
 * 可那行里就带着玩家名 ⇒ **名字从内容里漏出去了** ✗✗。
 *
 * ⇒ 教训：**光按字段名打码不够，名字会从任何地方冒出来**（标题行、括号里、URL 里）。
 *   所以这里再加一层"关键词替换"：把**已知的身份词**（玩家名 / 角色名 / 追踪对象名与别名 /
 *   人设表里的头像名）在**任何文本里**都换成「（已打码）」✓ —— 不管它出现在哪一格。
 *
 * ⚠️ 只做"整词替换"，不改结构；空/过短的词（<2 字）跳过，免得把正常文字打成筛子 ✗。
 */
export function scrubWithWords(words, text) {
    let s = String(text ?? '');
    const list = (Array.isArray(words) ? words : [])
        .map((x) => String(x ?? '').trim())
        .filter((x) => x.length >= 2 && !/^[\d\s·・\-—:：（）()【】]+$/.test(x))
        .sort((a, b) => b.length - a.length);   // 长的先换（不然短词会把长词切碎）
    for (const w of list) s = s.split(w).join('（已打码）');
    return s;
}

/** 现在能想到的所有身份词（拿不到就少几条，不影响功能 ✓）*/
export function identityWords() {
    const out = new Set();
    const add = (v) => {
        const s = String(v ?? '').trim();
        if (s && s.length >= 2 && s !== '{{user}}' && s !== '{{char}}') out.add(s);
    };
    try { add(getPersonaName()); } catch { /* 忽略 */ }
    try { add(getCharacterName()); } catch { /* 忽略 */ }
    try {
        for (const t of targetList()) {
            add(displayName(t));
            add(t?.key);
            const a = identOf(t.key)?.aliases;
            if (a) String(a).split(/[，,、／/|\n]+/).forEach(add);
        }
    } catch { /* 忽略 */ }
    try {
        const c = getCtx();
        const personas = c?.powerUserSettings?.personas || c?.power_user?.personas;
        if (personas && typeof personas === 'object') {
            for (const k of Object.keys(personas).slice(0, 80)) {
                add(String(k).replace(/\.[a-z0-9]+$/i, ''));
                const v = personas[k];
                if (typeof v === 'string') add(v.replace(/\.[a-z0-9]+$/i, ''));
            }
        }
    } catch { /* 忽略 */ }
    return [...out];
}

/** 把一段文本里所有已知身份词打掉（解锁时不调用）*/
export function scrubIdentities(text) {
    try { return scrubWithWords(identityWords(), text); } catch { return String(text ?? ''); }
}

/** 把可能隐私的东西遮掉 */
function maskText(v, keep = 2) {
    const s = String(v ?? '');
    if (diagUnmasked) return s;
    if (!s) return s;
    // ★ 名字会从结构行里漏出去 ⇒ 这里**不再"留头尾"**
    //   （留头尾会把名字的前两个字露出来 ✗），锁着时整段打码、只留字数 ✓
    void keep;
    return '（已打码·' + s.length + ' 字）';
}

/**
 * 遮掉一段长文本 —— **锁着时内容一律不输出**，只给「多少行 / 多少字」✓
 *
 * ★★ 设计原则（很重要）：
 *   "把**已知的身份词**（玩家名/角色名/追踪对象名）替换掉"是不够的：
 *   **不只是玩家自己的名字，还得考虑别人** ✗✓✓
 *   ⇒ **靠"列名单"打码永远不全**（别人的剧情人名、道具名、自定义设定名，根本列不出来）✗
 *   ⇒ 正确做法是**按"内容 / 结构"划线**：
 *      **内容（正文、设定、补丁全文、预设全文）一律不出现在诊断与导出里** ✓，
 *      只保留**结构**（字段名、行数、字数、计数、开关、布尔）✓。
 *   要看清原文时按「🔓 显示原文」解锁（那是本地排查，用户自己看 ✓）。
 */
function maskLongText(t) {
    if (diagUnmasked) return t;
    const s = String(t || '');
    if (!s) return '（空）';
    const lines = s.split('\n').filter((x) => x.trim()).length;
    return '（已打码 · ' + lines + ' 行 / ' + s.length + ' 字）';
}

/** 同上：整段面板文字锁着时也只给行数/字数 ✓ */
function maskPanelText(raw) {
    if (diagUnmasked) return raw;
    const s = String(raw || '');
    if (!s) return '（空）';
    const lines = s.split('\n').filter((x) => x.trim()).length;
    return '（已打码 · ' + lines + ' 行 / ' + s.length + ' 字）';
}

// ---------------------------------------------------------------------------
// ★ 诊断导出（诊断面板要能给用户"复制 / 导出"去报 BUG）
//
// 诊断要改成"用户可以用的那种"，方便用户复制信息或者导出日志
//   发过来排查 BUG；但只能是基础的 —— 玩家名称、角色名称这类隐私完全不能导出，
//   API 密钥和地址这种尤其不可以 ✓✓✓
//
// ★★ 实现铁律：**白名单，不是黑名单** ✗✓✓
//   项目里已有教训「默认遮住白名单放行，逐个补遮必漏」（这一类漏法真出过 ✗）。
//   ⇒ 这里**只列**允许导出的字段，其余一律不带；**密钥 / 接口地址 / 模型名 / 对象名 / 正文**
//     永远不进导出，哪怕"显示原文"开着也永不 ✗✓✓
// ---------------------------------------------------------------------------

/**
 * ★ 诊断报告**已覆盖**的数据面（每个字段 = "报告里有没有到它"）。
 *
 * ★ 诊断报告要跟着新数据一起长：以后有新东西了，诊断报告里面可能也需要把新数据加进去 ✓
 * ⇒ 这个清单是给**断言**用的：新增 state 字段时，如果没在这里登记，
 *   自测脚本 的「诊断报告覆盖率」会红 ✓（"记得更新"这种话靠不住 ✗）。
 * ⇒ 登记时请一并确保 `diagReportText()` 里真的有一行在报它（计数/开关/✓✗ 形态 ✓）。
 */
const DIAG_COVERED_STATE_KEYS = [
    'schema', 'targets', 'order', 'active', 'rolls', 'snapshots', 'excluded', 'traces',
    'ovuJudgment', 'ovuJudgments', 'lastJudgeReports', 'conceptionArchive',
    'impregnatorLocks', 'insems', 'insemMuted', 'zoneText', 'zonePresetId',
    // ★ 来源 / 分批（含植入方）＋ 植入孕的起点（2026-10-14）
    'impregnatorSources', 'implantDates',
    // ★ 事后避孕药（AI 报事实、插件折算 ×0.2）
    'pills',
    // 虚拟日期（剧情没给日期时用的那套日历）
    //   ⚠️ 「上次月经日」从 state 顶层**搬走了**（改成按对象存，
    //      见 store.js 的 cycleDay / cycleDayAt）⇒ 这张清单里不再有它 ✓
    'dateMode', 'fictionDate',
    // ★ 「这个聊天的时间跳跃算不算身体时间」（聊天级两档 + 手改锁 ✓）
    'timeJumpSkipsBody', 'timeJumpSkipsBodyManual',
    // ★ 例外名单（这些人跟世界那格相反）＋ 标签"下轮再问一次"的开关 ✓
    'timeJumpExceptKeys', 'tagAskPending',
    // ★ 面板「状态笔记 · 刚刚更新」的**正本**（时间戳 / 内容指纹 / 原文）——
    //   正本搬进聊天数据之后必须登记进这张清单（不然诊断报告里看不见它 ✗）
    'panelUpdate',
    // ★★ 回滚点（真倒流用）＋ 上一次回滚的保险 ✓
    'rollbackPoints', 'rollbackUndo',
    // ★ 历法指纹（这份聊天数据是哪套历法写下来的，跟设置的历法不一致时会搬一次）
    'calendarPrint',
    // ★ 剧情钟点：当日第几分钟
    'fictionTime',
    'lastRun',
    'lastJudgeRaw',
    // 候选记录 + 回滚检查点（重新生成 / 备选回复用）
    'checkpoint', 'floorCandidates',
    // ★ 涩涩成就（按聊天存 ✓）
    'achievements',
    // ★ 孩子（出生后的记录 ✓）
    'children',
    // ★★ 面板自带那几样搬进插件数据之后：
    //   随手记「本聊天」/ 敏感带备注 / 占卜台历史
    //   （「全局」那份随手记在**全局设置**里、不属于 state ⇒ 不进这张清单，但报告里也报了它 ✓）
    'notes', 'zoneNotes', 'divHistory',
    // ★ 日历：日程（一天可以挂好几条）+ 已提示过的
    'calendarEvents', 'calendarAlerted',
    // ★★ 自动提醒（怀孕 / 预产期**独立于日程**，但走同一个提醒气泡 ✓）
    'alerts',
    // ★ 两道保险丝裁过多少（往来流水 / 历史快照）——
    //   只记数字 ✓
    'insemsCut', 'snapCut',
];

/**
 * 当前环境（不涉及隐私的粗分类）
 * ⚠️ 判据只用那两个函数，**别拿 `getChatKey()` 来判"在不在聊天里"** ✗ ——
 *   它在没有聊天时会退回一个兜底键（可能还是上一个聊天的），
 *   于是非聊天页会被报成"在聊天中"（2026-10-21 她报的）。
 *   `inChatPage()` = 有没有 chatId；`inRealChat()` = 这个聊天里有没有正文。
 */
function diagScope() {
    try {
        if (!inChatPage()) return '非聊天页面';
        if (!inRealChat()) return '在聊天里，但还没有正文';
        return '在聊天中';
    } catch { return '未知'; }
}

/**
 * ★ 可安全导出/复制的诊断报告（文本，人眼可读）。
 *
 * ⚠️ 里面**只有**：结构 / 开关状态 / 计数 / ✓✗ / 版本。
 *   **绝不含**：对象名、玩家名、别名、备注、正文、密钥、接口地址、模型名 ✗✓✓
 */
export function diagReportText() {
    const s = settings();
    const st = state();
    const L = [];
    const yn = (v) => (v ? '是' : '否');
    L.push('Bodycord 诊断报告');
    L.push('版本：' + BUILD_LABEL);
    L.push('生成于：' + new Date().toLocaleString());
    // ★★ 2026-10-15：面板那颗「状态笔记 · 刚刚更新」的正本读数 ——
    //   重进还是刚刚更新，这一行是为了**一眼看出正本到底存没存下来** ✓
    //   （有 ⇒ 存下来了，问题在面板那一头；没有 ⇒ 外壳这一头没写上，看上面那行）
    L.push('面板更新时间：' + (() => {
        const p = st.panelUpdate;
        if (!p || !p.ts) return '（还没记过）';
        const mins = Math.floor((Date.now() - Number(p.ts)) / 60000);
        return new Date(Number(p.ts)).toLocaleString() + '（' + (mins <= 0 ? '刚刚' : mins + ' 分钟前') + '）'
            + ' ｜ 指纹 ' + String(p.sig || '').slice(0, 10) + ' ｜ 原文 ' + String(p.raw || '').length + ' 字';
    })());
    // ⚠️ 这一行是给「覆盖率断言」用的，别删 ✗
    //   （它声明"这份报告已经跟着这些数据面一起更新过了" ✓）
    L.push('覆盖的数据面：' + DIAG_COVERED_STATE_KEYS.join(' '));
    L.push('');
    L.push('【环境】');
    L.push('  当前所在：' + diagScope());
    L.push('  插件总开关：' + yn(s.enabled !== false));
    L.push('  扩展被禁用：' + yn(isMyExtensionDisabled()));
    L.push('  在真实聊天里：' + yn(inRealChat()));
    L.push('');
    L.push('【插件 API 配置】（只报填了没填，不报内容）');
    // ★ 多套接口 ⇒ 报的是**当前使用那一套** + 一共几套（都不含内容 ✓）
    const curApi = (() => { try { return currentApi(); } catch { return {}; } })();
    L.push('  接口渠道：共 ' + (() => { try { return apiCount(); } catch { return 1; } })() + ' 套'
        + '；当前用「' + (curApi?.name || '(未命名)') + '」');
    L.push('  接口地址已填：' + yn(!!String(curApi?.baseUrl || '').trim()));
    L.push('  密钥已填：' + yn(!!String(curApi?.apiKey || '').trim()));
    L.push('  模型名已填：' + yn(!!String(curApi?.model || '').trim()));

    // 模块：只报数量/开关，不报正文
    try {
        let on = 0, locked = 0, gated = 0;
        for (const m of MODULES) {
            if (isModuleOn(m.id)) on += 1;
            if (m.locked) locked += 1;
            if (m.gate) gated += 1;
        }
        L.push('');
        L.push('【模块】');
        L.push(`  共 ${MODULES.length} 个，开着 ${on} 个，必开 ${locked} 个，带自动门控 ${gated} 个`);
        // 补丁编辑范围 + 被冻结条数（只报个数和开关，不报内容 ✓）
        L.push('  补丁编辑范围：' + (patchScope() === 'numbers' ? '只能改数值' : '全文可改')
            + '；被冻结的补丁：' + (() => { try { return frozenPatchCount(); } catch { return 0; } })() + ' 条');
        // 门控此刻的实际状态（只有 ✓✗，没有名字）
        const roster = (() => { try { return trackingRoster(); } catch { return []; } })();
        // ★ 第 11 件（发送按"改没改过"决定发几份）：只报**份数**，不含名字 ✓
        //   靠这行判"到底发了几份"（报告里没有的东西等于瞎 ✗）
        try {
            let shared = 0, own = 0;
            for (const m of MODULES) {
                if (m.scope !== 'target' || m.role === 'main') continue;   // 推演侧的人物级模块 ✓
                if (!moduleActive(m.id, roster)) continue;
                for (const g of patchSendGroups(m.id, roster)) { if (g.shared) shared += 1; else own += 1; }
            }
            L.push(`  人物级模块的份数（推演侧）：共用 ${shared} 份 + 单独 ${own} 份（名单 ${roster.length} 个对象）`);
        } catch (e) { L.push('  份数统计出错：' + (e?.message || e)); }
        // ★ 给推演读的世界书：**只报份数与开关**，不含书名与正文 ✓
        try {
            const ws = wiStatus();
            const off = wiOffCounts();
            // 来源拆成两颗（`-101` 起）＋ 角色描述 / 用户角色设定 ＋ 遗传那轮的临时带 ⇒ 逐半写，别合成一个"开/关"
            L.push('  世界书（给推演看）：角色卡 ' + (wiCharOn() ? '开' : '关')
                + '；全局 ' + (wiGlobalOn() ? '开' : '关')
                + '；角色描述 ' + (wiDescOn() ? '开' : '关')
                + '；用户角色设定 ' + (wiPersonaOn() ? '开' : '关')
                + '；遗传判定自动带 ' + (wiHeritageAuto() ? '开' : '关')
                + '；' + (wiFollows() ? '跟随酒馆' : '已锁死（手动）')
                + '；最近一轮带了 ' + (ws.count || 0) + ' 条 / ' + (ws.chars || 0) + ' 字'
                + '；排除 ' + off.books + ' 本 / ' + off.entries + ' 条'
                + (ws.rendered ? '；含模板代码、已渲染 ' + ws.rendered + ' 条' : '')
                + (ws.skipped ? '；含模板代码、渲染失败已跳过 ' + ws.skipped + ' 条' : '')
                + (ws.reason ? '（' + ws.reason + '）' : ''));
        } catch (e) { L.push('  世界书统计出错：' + (e?.message || e)); }
        // ★ 涩涩成就：**只报开关 / 条数 / 提示词字数**，
        //   成就的名字和吐槽一个字都不进报告 ✓（隐私按"内容 / 结构"划线 ✓）
        try {
            L.push('  成就：' + (achOn() ? '开' : '关')
                + '；本聊天 ' + achievementCount() + ' 条'
                + '；提示词 ' + achPromptChars() + ' 字');
        } catch (e) { L.push('  成就统计出错：' + (e?.message || e)); }
        // ★ 孩子：只报**条数**（名字什么的都是玩家的数据，不进报告 ✓）
        try {
            L.push('  孩子：本聊天 ' + childCount() + ' 个'
                + '；当前看的这个对象 ' + (() => {
                    try { return childrenOf(state().active).length; } catch { return 0; }
                })() + ' 个'
                + '；今天的剧情日期：' + (storyDateNow() || '（还没有）'));
        } catch (e) { L.push('  孩子统计出错：' + (e?.message || e)); }
        // ★ 阶段插图：只报**开关 / 填了几张图 / 这一刻画哪张**，
        //   图地址一个字都不进报告 ✓（报告里没有的东西等于瞎，但隐私那条也守着 ✓）
        try {
            const sst = stagesForPanel();
            // 报一下**这一刻用的是哪一档**（靠这行分得清是不是档位问题 ✓）
            const sm = (() => {
                // ★ 三档之后别写死两档的 if（无月经会被错报成"月经档" ✗）
                try { return cycleModeLabel(periodModeOf(state().active)) + '档'; } catch { return '拿不到'; }
            })();
            L.push('  阶段插图：' + (stagesOn() ? '开' : '关')
                + '；自己填的图 ' + customStageCount() + ' 张'
                + '；当前按 ' + sm
                + '；这一刻显示：' + (sst?.title || '（关着）')
                // ★ 2026-10-18：现在真正画的是**分层**（`layers`），老的单图 `image` 是空的
                //   ⇒ 只看 `image` 会把"明明有图"报成"文字版" ✗
                + ((sst?.image || (Array.isArray(sst?.layers) && sst.layers.length)) ? '（用图）' : '（文字版）'));
        } catch (e) { L.push('  阶段插图统计出错：' + (e?.message || e)); }
        for (const kind of ['pregnancy', 'not_pregnant', 'conception', 'sperm', 'menstruation', 'xeno', 'multi_father_window']) {
            let open = null;
            try { open = gateOpen(kind, roster); } catch { /* 忽略 */ }
            L.push(`  门控 ${kind}：${open === null ? '?' : (open ? '开（会发）' : '关（不发）')}`);
        }
    } catch (e) { L.push('  模块统计出错：' + (e?.message || e)); }

    // 对象：只有计数与结构
    try {
        const list = targetList();
        const round = st.ovuJudgments || [];
        L.push('');
        L.push('【追踪对象】');
        L.push('  对象数：' + list.length + '（含用户本人 ' + list.filter(t => t.isUser).length + ' 个）');
        L.push('  追踪模式：' + String(s.targetMode || ''));
        L.push('  追踪本人：' + yn(s.trackUser !== false));
        L.push('  其中已推演过（有档案）：' + list.filter(t => !!t.profile).length + ' 个');
        L.push('  其中填了别名的：' + list.filter(t => { try { return !!identOf(t.key).aliases; } catch { return false; } }).length + ' 个');
        // ★ 对象专属补丁**按聊天存** ⇒ 只报"几个对象改过"，不报内容 ✓
        //   （本人那份在插件设置里、跟着所有聊天；别人那份跟聊天走 ⇒ 两者分开报 ✓）
        L.push('  改过专属补丁的对象：' + (() => { try { return targetPatchCount(); } catch { return 0; } })()
            + ' 个（本聊天）；本人那份：' + (() => {
                try { return Object.keys(s.targetPatches?.user || {}).length ? '有' : '无'; } catch { return '未知'; }
            })());
        L.push('  判定历史条数：' + round.length + '，内射记录条数：' + (st.insems || []).length
            + '，事后避孕药 ' + (st.pills || []).length + ' 条');
        L.push('  历史快照：' + (st.snapshots || []).length + ' 条');
        // ★ 两道保险丝清掉过多少 —— 只报数字 ✓
        L.push('  被保险丝清掉的：往来流水 ' + (Number(st.insemsCut) || 0) + ' 条；历史快照 '
            + (Number(st.snapCut) || 0) + ' 份');
        L.push('  痕迹登记的对象数：' + Object.keys(st.traces || {}).length);
        L.push('  时间来源：' + (st.dateMode === 'story' ? '剧情给了日期' : (st.dateMode === 'fiction' ? '剧情没给，用虚拟日历' : '还没定')));
        L.push('  当前日期：' + (st.fictionDate || '（无）'));
        // ★ 历法（报告要跟着新数据一起更新 ✓）
        //   只报**结构**（几个月/几天）和"指纹有没有"，不报任何内容 ✓
        L.push('  历法：' + calendarSummary(activeCalendarNow()) + '；钟点：' + (timeUnitNow() === 'none' ? '不记钟点' : timeUnitNow())
            + '；这份聊天数据：' + (st.calendarPrint ? '按上面这套记的' : '没有指纹（老聊天，按公历算）'));
        // ★ 周期定位**按对象**：只报"几个对象有 / 有几个算得出上次月经日"
        //   —— 都是**计数**，不含内容 ✓
        try {
            const list = targetList();
            const withState = list.filter(t => { try { return cycleDayNow(t.key) !== null; } catch { return false; } });
            const withCsd = list.filter(t => { try { return !!cycleStartDateOf(t.key); } catch { return false; } });
            L.push('  周期定位：' + withState.length + ' / ' + list.length + ' 个对象有；'
                + '其中上次月经日算得出来的：' + withCsd.length + ' 个');
        } catch { L.push('  周期定位：（读不到）'); }
        // 回滚检查点：重新生成时靠它把"这一楼之前"的状态找回来（只报有没有、哪一楼）
        L.push('  回滚检查点：' + (st.checkpoint && st.checkpoint.floor !== undefined && st.checkpoint.floor !== null
            ? '有（楼层 ' + Number(st.checkpoint.floor) + '）' : '无'));
        // 候选记录：一层里几条备选回复各存了一份（只报条数 / 楼层，不报内容 ✓）
        try {
            const ci = candidateInfo();
            L.push('  候选记录：' + ci.count + ' 条' + (ci.floors.length ? '（楼层 ' + ci.floors.join('、') + '）' : ''));
        } catch { L.push('  候选记录：（读不到）'); }
    } catch (e) { L.push('  对象统计出错：' + (e?.message || e)); }

    // 随手记（数据在面板侧，面板每次变动会 postMessage 报一份计数上来 ✓）
    // 新加的数据面要进诊断报告 ⇒ 图片那块也得能看见 ✓
    try {
        const ns = notesStats();
        L.push('');
        L.push('【随手记】');
        if (!ns) {
            L.push('  面板还没报统计上来（面板没打开过，或者面板是旧版）');
        } else {
            const fmt = (x) => x ? (Number(x.notes || 0) + ' 条 / ' + Number(x.images || 0) + ' 张图') : '（读不到）';
            L.push('  本聊天：' + fmt(ns.chat));
            L.push('  全局：' + fmt(ns.global));
            L.push('  图片上传失败：' + Number(ns.imgFailed || 0) + ' 次');
        }
        // ★ 这几样的**正本**已经搬进插件数据了
        //   （以前只活在浏览器本地存储里 ⇒ 清浏览器数据就全没 ✗）
        //   这里只报**字数 / 条数**，一个字的内容都不报 ✓
        const ds = panelDataSummary();
        L.push('  落盘（插件数据）：本聊天笔记 ' + ds.notesChars + ' 字'
            + '｜全局笔记 ' + ds.notesGlobalChars + ' 字'
            + '｜敏感带备注 ' + ds.zoneNotes + ' 条'
            + '｜占卜台历史 ' + ds.divHistory + ' 条'
            + (ds.hasChat ? '' : '（现在不在聊天里，本聊天那几样暂时落不了盘）'));
        // ★ 预览（"预览没数据"这类问题靠这一行一眼定位：
        //   开关在不在、样例有多长、几份面板拿到了样例）—— 只报计数 / 长度，不含内容 ✓
        L.push('  预览：' + (!previewMode ? '关' : (previewMulti ? '多人' : '单人'))
            + '｜样例 ' + String(statusViews[0]?.panel?.previewRaw || '').length + ' 字'
            + '｜面板 ' + statusViews.length + ' 份，拿到样例的 '
            + statusViews.filter(v => v.panel && v.panel.previewRaw).length + ' 份');
    } catch (e) { L.push('  随手记统计出错：' + (e?.message || e)); }

    // 运行时
    try {
        const v = statusViews[0];
        const panel = v?.panel;
        const iframe = panel?.iframe;
        const win = iframe?.contentWindow;
        const doc = iframe?.contentDocument;
        L.push('');
        L.push('【面板运行时】');
        L.push('  状态视图数：' + statusViews.length);
        L.push('  面板对象：' + (panel ? '有' : '无'));
        L.push('  iframe：' + (iframe ? (iframe.isConnected ? '有且已挂载' : '有但没挂上') : '无'));
        L.push('  面板主脚本已跑：' + (win && typeof win.__bodycordSetRaw === 'function' ? '是' : '否'));
        L.push('  shim 已注入：' + (win && typeof win.__bodycordSetTheme === 'function' ? '是' : '否'));
        let it = '—';
        try { it = doc?.documentElement?.getAttribute('data-theme') || '(空)'; } catch { /* 忽略 */ }
        L.push('  面板内实际主题：' + it);
    } catch (e) { L.push('  运行时统计出错：' + (e?.message || e)); }

    // 自动推演跳过（运行时计数：这次页面加载以来，为什么没自动推演）
    // 原因原来只在 F12 控制台里，用户看不见 ⇒ 报到这里 ✓
    try {
        const rs = skipStats();
        L.push('');
        L.push('【自动推演跳过】（本次页面加载以来）');
        L.push('  跳过次数：' + Number(rs.skipped || 0));
        if (rs.skipped) {
            let when = '';
            try { when = '（' + new Date(rs.lastAt).toLocaleTimeString() + '）'; } catch { /* 忽略 */ }
            L.push('  最近一次原因：' + (rs.lastReason || '（没记到）') + when);
        } else {
            L.push('  最近一次原因：（没有跳过过）');
        }
    } catch (e) { L.push('  自动推演统计出错：' + (e?.message || e)); }

    L.push('');
    L.push('【备注】');
    L.push('  本报告按白名单生成，不含任何角色名、玩家名、正文、密钥或接口地址');
    if (ST.errors.length) L.push('  接口探测告警：' + ST.errors.join('；'));
    L.push('');
    // ⚠️ 这里原来写的是 `previewInjection ? '…' : ''` —— 那是个**函数**（见上面 import），
    //   函数引用恒为真 ⇒ `: ''` 那一支永远走不到（死代码），直接写死这一句就行 ✓
    L.push('（如需主 API 实际会收到什么，请看诊断面板「运行时」页，那里默认也打了码）');
    // ★ 最后一层保险：万一以后哪一行不小心把名字写进来了，把**已知身份词**再扫一遍 ✓
    //   （注意：这只是兜底，主防线是"内容一律不输出" —— 因为名单永远列不全 ✗）
    return scrubIdentities(L.filter(x => x !== null).join('\n'));
}

/** ★ 可安全导出的诊断 JSON（同样是白名单 ✓） */
/**
 * 诊断用：数「我们自己留下的脚本注入」还剩几条（**落盘 + 内存**两处分开数）。
 *
 * 为什么要有它：这是唯一一种"禁用插件 / 挪走文件夹 / 关掉扩展都去不掉"的注入
 *   （酒馆核心的 `/inject` 会把它写进聊天文件，加载聊天时又自己恢复）——
 *   彻底关闭了还是被塞进去时，就是它。
 *   规矩：**报告里没有的东西等于瞎** ⇒ 这儿给两个数，都是 0 才算干净 ✓
 *   ⚠️ 只数**我们自己的**（`bodycord_*` / `bc_*`），别人的只报数量、绝不动 ✓
 */
export function diagScriptInjectsCount() {
    const out = { ok: false, disk: 0, memory: 0, others: 0 };
    try {
        const c = getCtx();
        const meta = c?.chatMetadata ?? c?.chat_metadata;
        const map = meta?.script_injects;
        if (map && typeof map === 'object') {
            for (const id of Object.keys(map)) {
                if (/^(?:bodycord|bc[-_])/i.test(id)) out.disk++;
                else out.others++;
            }
        }
        const prompts = c?.extensionPrompts;
        if (prompts && typeof prompts === 'object') {
            for (const k of Object.keys(prompts)) {
                if (/^script_inject_(?:bodycord|bc[-_])/i.test(k)) out.memory++;
            }
        }
        out.ok = true;
    } catch { /* 读不到就报 ok:false */ }
    return out;
}

/** 给诊断报告用的一句话（见 `diagScriptInjectsCount` 的说明） */
function diagScriptInjectsText() {
    const n = diagScriptInjectsCount();
    if (!n.ok) return '读不到（可能不在聊天里）';
    if (!n.disk && !n.memory) {
        return '没有' + (n.others ? '（别人的脚本注入 ' + n.others + ' 条，不动它）' : '');
    }
    return '插件自己的：落盘 ' + n.disk + ' 条、内存 ' + n.memory + ' 条（下次换聊天 / 刷新就会清掉）';
}

export function diagExportJson() {
    const s = settings();
    const st = state();
    const out = {
        version: PLUGIN_VERSION,
        stamp: BUILD_STAMP,
        at: new Date().toISOString(),
        privacy: '白名单导出：不含角色名 / 玩家名 / 正文 / 密钥 / 接口地址',
        env: {
            scope: diagScope(),
            inRealChat: (() => { try { return inRealChat(); } catch { return null; } })(),
            pluginEnabled: s.enabled !== false,
            extensionDisabled: (() => { try { return isMyExtensionDisabled(); } catch { return null; } })(),
            // ★ 脚本注入残留（0/0 = 干净）——见 diagScriptInjectsCount 的说明 ✓
            scriptInjectOurs: diagScriptInjectsCount(),
        },
        api: {
            // ★ 多套接口：报的是**当前使用那一套** + 一共几套（都不含内容 ✓）
            count: (() => { try { return apiCount(); } catch { return 1; } })(),
            name: (() => { try { return String(currentApi()?.name || ''); } catch { return ''; } })(),
            hasBaseUrl: !!String((() => { try { return currentApi()?.baseUrl; } catch { return ''; } })() || '').trim(),
            hasKey: !!String((() => { try { return currentApi()?.apiKey; } catch { return ''; } })() || '').trim(),
            hasModel: !!String((() => { try { return currentApi()?.model; } catch { return ''; } })() || '').trim(),
        },
        modules: (() => {
            try {
                const roster = trackingRoster();
                const gates = {};
                for (const kind of ['pregnancy', 'not_pregnant', 'conception', 'sperm', 'menstruation', 'xeno', 'multi_father_window']) {
                    try { gates[kind] = gateOpen(kind, roster); } catch { gates[kind] = null; }
                }
                return {
                    total: MODULES.length,
                    on: MODULES.filter(m => isModuleOn(m.id)).length,
                    locked: MODULES.filter(m => m.locked).length,
                    gated: MODULES.filter(m => m.gate).length,
                    gates,
                };
            } catch { return null; }
        })(),
        targets: (() => {
            try {
                const list = targetList();
                return {
                    count: list.length,
                    userCount: list.filter(t => t.isUser).length,
                    withProfile: list.filter(t => !!t.profile).length,
                    withAlias: list.filter(t => { try { return !!identOf(t.key).aliases; } catch { return false; } }).length,
                    mode: String(s.targetMode || ''),
                    trackUser: s.trackUser !== false,
                    judgments: (st.ovuJudgments || []).length,
                    insems: (st.insems || []).length,
                    snapshots: (st.snapshots || []).length,
                    traces: Object.keys(st.traces || {}).length,
                };
            } catch { return null; }
        })(),
        runtime: (() => {
            try {
                const v = statusViews[0];
                const panel = v?.panel;
                const iframe = panel?.iframe;
                const win = iframe?.contentWindow;
                const doc = iframe?.contentDocument;
                let theme = '—';
                try { theme = doc?.documentElement?.getAttribute('data-theme') || '(空)'; } catch { /* 忽略 */ }
                return {
                    views: statusViews.length,
                    hasPanel: !!panel,
                    hasIframe: !!iframe,
                    iframeConnected: !!(iframe && iframe.isConnected),
                    rawPushed: !!(win && typeof win.__bodycordSetRaw === 'function'),
                    shimInjected: !!(win && typeof win.__bodycordSetTheme === 'function'),
                    innerTheme: theme,
                };
            } catch { return null; }
        })(),
        problems: ST.errors.slice(),
    };
    // ★ 兜底自检：万一以后有人往白名单里加了敏感字段，这里会先拦住 ✓
    try {
        const names = [];
        const pn = (() => { try { return getPersonaName(); } catch { return ''; } })();
        if (pn) names.push(pn);
        for (const t of targetList()) {
            if (t.name) names.push(String(t.name));
            if (t.key && t.key !== USER_KEY) names.push(String(t.key));
        }
        const blob = JSON.stringify(out);
        const hit = names.filter(n => n && n.length >= 2 && blob.includes(n));
        if (hit.length) {
            out.privacyWarning = `自检发现导出内容里可能含 ${hit.length} 个名字，已拒绝导出`;
            return { error: out.privacyWarning };
        }
    } catch { /* 自检失败就当没问题（白名单本来就不会带名字） */ }
    return out;
}

/** 复制文本到剪贴板（带失败提示） */
function copyText(text, okMsg) {
    try {
        navigator.clipboard.writeText(text);
        window.toastr?.success?.(okMsg || '已复制');
    } catch {
        window.toastr?.error?.('复制失败，可以手动选中文本再复制');
    }
}

/** 导出成文本文件（.txt —— 人眼可读、方便直接贴进聊天软件 ✓） */
function downloadText(text, filename) {
    try {
        const blob = new Blob([String(text ?? '')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        window.toastr?.success?.('已开始下载（白名单导出，不含隐私内容）');
    } catch (e) { window.toastr?.error?.('导出失败：' + (e?.message || e)); }
}

/**
 * 打开诊断与数据面板。
 *
 * ⚠️ 原来是塞在主面板状态栏里的 —— 但主面板右上角本来就有一个放大镜（面板自己的搜索），
 *   两个 🔍 挨在一起谁都会看懵。所以改成：
 *   · 主面板**不再**有入口
 *   · 设置页有「诊断与数据」板块
 *   · 悬浮球右键 / 长按菜单里也留一个（那里不会和任何图标混淆）
 */
export function openDiagPanel() {
    if (!els) return;
    if (diagBox) { closeDiag(); return; }
    diagBox = h('div', { class: 'bc-diag-box' });
    els.root.appendChild(diagBox);
    renderDiag();
}

function closeDiag() {
    diagBox?.remove();
    diagBox = null;
}

/**
 * 数据变了：诊断面板开着的话就地重画一遍。
 *
 * ⚠️ 这个函数名原来在 refreshAll / togglePreview 里被调用，但**全仓没有定义** ✗ ——
 *   于是那两处被 `try/catch` 静静吞掉，表现是"数据都变了、诊断面板还显示旧数字"。
 *   真名是 `renderDiag`，这里补一层只在面板开着时才重画的包装 ✓
 */
function refreshDiag() {
    if (!diagBox) return;
    renderDiag();
}

function renderDiag() {
    if (!diagBox || !els) return;
    clear(diagBox);

    diagBox.appendChild(h('div', { class: 'bc-diag-title' },
        // ⚠️ 这个标题里不挂构建标记串：
        //   ⇒ 标题只留「诊断」；版本号移到**报告正文里**（导出/复制仍然带得上 ✓）
        h('span', { text: '诊断' }),
        h('div', { class: 'bc-spacer' }),
        h('span', { class: 'bc-diag-x', text: '✕', title: '关闭', onclick: () => closeDiag() }),
    ));

    // ---- 页签 ----
    // ★ 第三个页签「预览」已删（它看着没用 ✓）
    //   理由：它只是把样例文字塞进面板的编辑框（`__bodycordSetRaw`）⇒ ①受孕记录/推演记录那些**不会被替换**，
    //   看到的不是完整效果 ✗；②样例文字会停在面板的编辑框里，用户在那个状态下点保存就可能把样例写进真实数据 ✗；
    //   ③功能完全被悬浮球那条「🎨 预览效果」盖住（那条还能单人/多人切换 ✓）
    const tabs = [['runtime', '运行时'], ['data', '数据']];
    diagBox.appendChild(h('div', { class: 'bc-diag-tabs' },
        ...tabs.map(([id, label]) => h('div', {
            class: 'bc-diag-tab' + (diagTab === id ? ' active' : ''),
            text: label,
            onclick: () => { diagTab = id; renderDiag(); },
        })),
    ));

    const body = h('div', { class: 'bc-diag-body' });
    diagBox.appendChild(body);

    if (diagTab === 'runtime') renderRuntimeTab(body);
    else if (diagTab === 'data') renderDataTab(body);
}

// ---------------- 运行时 ----------------

function renderRuntimeTab(body) {
    const v = statusViews[0];
    const panel = v?.panel;
    const iframe = panel?.iframe;
    const win = iframe?.contentWindow;
    const doc = iframe?.contentDocument;

    // ★ **聊天有聊天的、全局有全局的**，很多东西都需要这样分 ✓
    //   ⇒ 这一页按「全局 / 当前聊天」分成两组 ✓
    const head = (t) => body.appendChild(h('div', { class: 'bc-section-title', text: t }));
    const line = (label, okFlag, extra = '') => {
        body.appendChild(h('div', { class: 'bc-diag-line' },
            h('span', { class: okFlag === null ? 'bc-diag-q' : (okFlag ? 'bc-diag-ok' : 'bc-diag-bad'),
                        text: okFlag === null ? '?' : (okFlag ? '✓' : '✗') }),
            h('span', { class: 'bc-diag-label', text: label }),
            extra ? h('span', { class: 'bc-diag-extra', text: extra }) : null,
        ));
    };
    // 纯信息行（没有 ✓✗）
    const info = (label, value) => body.appendChild(h('div', { class: 'bc-diag-line' },
        h('span', { class: 'bc-diag-q', text: 'i' }),
        h('span', { class: 'bc-diag-label', text: label }),
        h('span', { class: 'bc-diag-extra', text: String(value ?? '—') }),
    ));

    // ---------------- 全局（跟聊天无关的） ----------------
    head('全局');
    info('版本', BUILD_LABEL);
    info('当前所在', (() => { try { return diagScope(); } catch { return '未知'; } })());
    line('插件总开关', settings().enabled !== false, settings().enabled !== false ? '开着（会推演 + 注入）' : '关着（不推演、不注入，只留面板；楼层那排也收起来了）');
    line('扩展被宿主禁用', !isMyExtensionDisabled(), isMyExtensionDisabled() ? '已被禁用' : '正常');
    // ★ 让"有没有残留"这回事**看得见** ——
    //   报告里没有的东西等于瞎 ⇒ 落盘的（聊天元数据）和内存的（`script_inject_*`）两处都报数。
    //   两个数都是 0 = 干净；别人的脚本注入只报数、绝不动 ✓
    info('脚本注入残留', diagScriptInjectsText());
    // ★ 多套接口：报"当前用哪套 + 三格填没填"（都不含内容 ✓）
    const curApiD = (() => { try { return currentApi(); } catch { return {}; } })();
    info('接口渠道', (() => { try { return '共 ' + apiCount() + ' 套'; } catch { return '共 1 套'; } })()
        + '；当前用「' + (curApiD?.name || '(未命名)') + '」');
    info('插件 API 地址', String(curApiD?.baseUrl || '').trim() ? '已填' : '未填');
    info('推演密钥', String(curApiD?.apiKey || '').trim() ? '已填' : '未填');
    info('推演模型名', String(curApiD?.model || '').trim() ? '已填' : '未填');
    info('模块', (() => {
        try {
            const on = MODULES.filter(m => isModuleOn(m.id)).length;
            return `共 ${MODULES.length} 个，开着 ${on} 个`;
        } catch { return '—'; }
    })());
    info('门控', (() => {
        try {
            const roster = trackingRoster();
            const kinds = ['pregnancy', 'not_pregnant', 'conception', 'sperm', 'menstruation', 'xeno', 'multi_father_window'];
            return kinds.map(k => {
                let o = null;
                try { o = gateOpen(k, roster); } catch { /* 忽略 */ }
                return `${k}:${o === null ? '?' : (o ? '开' : '关')}`;
            }).join('　');
        } catch { return '—'; }
    })());

    // ---------------- 当前聊天 ----------------
    head('当前聊天');
    line('在真实聊天里', inRealChat(), inRealChat() ? '' : '（非聊天页面）');
    // ★ 2026-10-15：面板那颗「状态笔记 · 刚刚更新」的正本读数（玩家连报三次 ⇒ 放**屏幕上**，
    //   别再藏在"复制诊断报告"里 ✗）—— 有值 ⇒ 外壳写上了；「（还没记过）」⇒ 没写上 ✓
    info('面板更新时间', (() => {
        try {
            const p = state().panelUpdate;
            if (!p || !p.ts) return '（还没记过）';
            const mins = Math.floor((Date.now() - Number(p.ts)) / 60000);
            return new Date(Number(p.ts)).toLocaleTimeString()
                + '（' + (mins <= 0 ? '刚刚' : mins + ' 分钟前') + '，原文 ' + String(p.raw || '').length + ' 字）';
        } catch { return '读不出来'; }
    })());
    info('追踪模式', String(settings().targetMode || ''));
    info('追踪本人', settings().trackUser !== false ? '是' : '否');
    info('追踪对象', (() => {
        try {
            const list = targetList();
            return `${list.length} 个（有档案 ${list.filter(t => !!t.profile).length} 个，含本人 ${list.filter(t => t.isUser).length} 个）`;
        } catch { return '—'; }
    })());
    info('数据', (() => {
        try {
            const st = state();
            return `判定 ${(st.ovuJudgments || []).length} 条，内射 ${(st.insems || []).length} 条，快照 ${(st.snapshots || []).length} 条`;
        } catch { return '—'; }
    })());
    info('日期', (() => {
        // 只报"来源 + 有没有值"，日期本身是设定、不是隐私 ✓
        try {
            const mode = state().dateMode === 'story' ? '剧情给的时间' : (state().dateMode === 'fiction' ? '虚拟时间' : '还没定');
            const cur = state().fictionDate ? '有' : '无';
            // ★ 上次月经日改成**按对象** ⇒ 这里报"几个对象算得出来"（计数，不含内容 ✓）
            const cs = (() => {
                try { return targetList().filter(t => !!cycleStartDateOf(t.key)).length; } catch { return '—'; }
            })();
            return `${mode}（当前日期：${cur}，上次月经日算得出的对象：${cs} 个）`;
        } catch { return '—'; }
    })());

    // ---------------- 面板运行时 ----------------
    head('面板运行时');
    line('状态视图已创建', statusViews.length > 0, `views=${statusViews.length}`);
    line('面板对象存在', !!panel);
    line('iframe 存在', !!iframe);
    line('iframe 已挂到页面上', !!(iframe && iframe.isConnected));

    let frameCount = 0;
    try { frameCount = v?.host ? v.host.querySelectorAll(':scope > iframe.bc-frame').length : 0; } catch { /* 忽略 */ }
    line('host 里的 iframe 数量', frameCount <= 1, `count=${frameCount}${frameCount > 1 ? ' ← 幽灵 iframe！' : ''}`);

    line('contentWindow 可访问', !!win);
    line('contentDocument 可访问', !!doc);
    line('shim 已注入（__bodycordSetTheme）', !!(win && typeof win.__bodycordSetTheme === 'function'));
    line('面板主脚本已跑（__bodycordSetRaw）', !!(win && typeof win.__bodycordSetRaw === 'function'));
    line('iframe 已触发 load', !!panel?._loaded);

    let diceHost = null;
    try { diceHost = doc?.getElementById('bcDiceMount'); } catch { /* 忽略 */ }
    line('骰子容器 #bcDiceMount', diceHost ? true : null,
        diceHost ? (diceHost.querySelector('.bc-embed') ? '已挂上内容' : '存在但内容为空') : '当前不在骰子页');

    let innerTheme = '—';
    try { innerTheme = doc?.documentElement?.getAttribute('data-theme') || '(空)'; } catch { /* 忽略 */ }
    info('iframe 内实际主题', innerTheme);

    body.appendChild(h('div', { class: 'bc-diag-hint', text: '这一页是给排查问题用的，截图给开发者即可' }));

    // ★ 头像抓取：**只画"抓没抓到"的安全摘要**（隐私规矩：
    //   诊断可以给用户用，但**玩家名 / 角色名绝不能进导出** ✗✓）
    //   ⇒ 所以这里只报状态，不报名字；要点「显示原文」才看得到具体是哪张 ✓
    try {
        const a = describePersonaAvatar();
        let got = '';
        if (a && typeof a === 'object') {
            const keys = Object.keys(a);
            const hit = keys.filter(k => a[k] != null && String(a[k]).length > 0);
            got = hit.length ? `${hit.length} 项有值（${keys.length} 项已采集）` : `${keys.length} 项全空`;
        } else {
            got = String(a ?? '（无）');
        }
        line('头像抓取', !!(got && !/全空/.test(got)), got);
    } catch (e) {
        line('头像抓取', false, '出错：' + (e?.message || e));
    }
}

// ---------------- 数据 ----------------

function renderDataTab(body) {
    const s = settings();
    const st = state();
    const targets = targetList();
    const meta = (() => { try { return getChatMetadata?.() || null; } catch { return null; } })();

    // 打码开关 + 刷新 + ★ 安全的复制/导出（报 BUG 用 ✓）
    body.appendChild(h('div', { class: 'bc-diag-bar' },
        // ★ 文案必须自洽：按钮锁定时的字是「已打码」，
        //   而下面那些块的提示却写「点『显示原文』查看」—— 那个按钮名根本不存在 ✗
        //   ⇒ 现在统一成「**打码时显示打码、解锁时显示解锁**」，动作也写在同一个按钮上 ✓
        h('div', { class: 'bc-diag-toggle' + (diagUnmasked ? ' on' : ''),
            text: diagUnmasked ? '🔓 已解锁 · 点一下恢复打码' : '🔒 已打码 · 点一下看原文',
            title: diagUnmasked
                ? '现在是原文（只在你屏幕上，不会被导出）。点一下恢复打码'
                : '默认遮住内容（正文/设定/补丁/元数据只显示行数·字数），避免截图泄露。点一下在本机看原文（不会被导出）',
            onclick: () => { diagUnmasked = !diagUnmasked; renderDiag(); } }),
        h('div', { class: 'bc-spacer' }),
        h('div', { class: 'bc-diag-toggle', text: '🔄 刷新', onclick: () => renderDiag() }),
        // ★★ 复制的是【白名单报告】—— 不含对象名 / 玩家名 / 正文 / 密钥 / 接口地址 ✓
        h('div', { class: 'bc-diag-toggle', text: '📋 复制诊断报告',
            title: '复制一份可安全分享的文本报告（不含角色名、玩家名、正文、密钥、接口地址）',
            onclick: () => copyText(diagReportText(), '已复制诊断报告（不含隐私内容）') }),
        h('div', { class: 'bc-diag-toggle', text: '📥 导出 TXT',
            title: '导出同一份文本报告（.txt，白名单，不含隐私内容）'
                + '文本比 JSON 好贴，也不容易被聊天软件的字数上限卡住',
            onclick: () => {
                // ★ 与「复制诊断报告」同一份内容 ✓（不搞两套，免得两边不一致 ✗）
                //   导出直接导出 TXT 就行，复制一堆不方便，
                //   特别是聊天软件有字数上限的情况下 ✓
                downloadText(diagReportText(), 'bodycord-诊断报告.txt');
            } }),
        // ★ 诊断 JSON（结构化那份）—— 白名单 + 自带"发现名字就拒绝导出"的自检 ✓
        //   ⚠️ `diagExportJson()` 早就写好了，但**没有任何入口调用它**
        //     ⇒ 这里给它接上一颗按钮，
        //     别让它继续当孤儿；真不想要这个功能，删这儿 + 删那个函数就行 ✓
        h('div', { class: 'bc-diag-toggle', text: '📥 导出 JSON',
            title: '导出结构化诊断（.json，同样走白名单；万一混进名字会直接拒绝导出）',
            onclick: () => {
                let data = null;
                try { data = diagExportJson(); } catch (e) { window.toastr?.error?.('导出失败：' + (e?.message || e)); return; }
                if (data && data.error) { window.toastr?.warning?.(data.error); return; }
                downloadText(JSON.stringify(data, null, 2), 'bodycord-诊断.json');
            } }),
    ));
    body.appendChild(h('div', { class: 'bc-diag-hint', text: '「复制诊断报告 / 导出诊断文件」都是白名单生成：只有结构、开关、计数和版本，不含角色名、玩家名、正文、密钥或接口地址。屏幕上那个「已打码 / 已解锁」按钮只影响本机显示，不会被导出；默认状态下所有内容（正文/设定/预设全文/元数据）都不显示，只给行数、字数、键数这类结构信息' }));

    body.appendChild(h('div', { class: 'bc-section-title', text: `追踪对象（${targets.length}）` }));
    if (!targets.length) body.appendChild(h('div', { class: 'bc-hint', text: '一个都没有' }));
    for (const t of targets) {
        // ★ 2026-10-23（她报「着床后占卜台还写着待着床、孩子没遗传」）：
        //   把这一胎的**时间线读数**摊在诊断里 —— 全是数字/开关，不含剧情内容 ✓
        //   有了它分辨两件事：着床判定到底掷过没、提示词发出去时孕有没有切 ✓
        const extra = [];
        try {
            if (t.light === true) {
                // 轻档＝只登记名字 ⇒ 周期与孕一律不追踪（2026-10-23 她问「为什么轻档有周期？」）
                extra.push(kv('说明', '轻档：只登记名字，不追踪周期与孕期'));
            } else {
            const j = getOvuJudgment(t.key) || null;
            const day = (() => { try { return cycleDayNum(t.key); } catch { return null; } })();
            const ovu = (() => { try { return Number(bodyCycleParamsOf(t.key)?.ovu) || 14; } catch { return 14; } })();
            extra.push(kv('周期日', day === null ? '—' : ('Day' + day)));
            extra.push(kv('着床判定', !j ? '没有判定记录'
                : (j.implantPassed === true ? '成功' : (j.implantPassed === false ? '没成' : '还没掷'))));
            extra.push(kv('着床日', j && j.implantDays
                ? (String(j.doneDate || '') || ('周期 Day' + (ovu + Number(j.implantDays)))) : '—'));
            const ir = (() => { try { return implantRangeOf(); } catch { return null; } })();
            extra.push(kv('着床判定时机', (() => { try { return settings().implantJudgeOnDay === false ? '受精时就掷' : '到着床日才掷'; } catch { return '—'; } })()));
            extra.push(kv('着床率范围', ir && Array.isArray(ir.ok)
                ? (`${ir.ok[0]}-${ir.ok[1]} 成功` + (ir.fail ? ` / ${ir.fail[0]} 起失败` : ''))
                : '没认出（按默认 1-80 判）'));
            extra.push(kv('判定记录', j ? JSON.stringify({
                passed: j.passed, 着床天数: j.implantDays, 着床结果: j.implantPassed,
                着床日: j.doneDate, 剧情确认: j.storyConfirmed === true,
            }) : '—'));
            extra.push(kv('已孕', String(t?.vars?.Is_Pregnant ?? '（空）')));
            // ★ 2026-10-23：孕了却没有胎数计划 ⇒ 面板会出现"孕3周但暂无数胎儿数据"✗
            //   摆出来才能一眼看出是"还没判"还是"判过又被清了" ✓
            const fp = (() => { try { return t?.fetusPlan ?? null; } catch { return null; } })();
            extra.push(kv('胎数计划', fp ? JSON.stringify(fp) : '（空）'));
            // ★ 2026-10-24（构建 -98）：自动重试到上限就停自动，但状态要亮着（不是静默放弃）
            extra.push(kv('遗传特质', t.heritageDone === true ? '这一胎已发过'
                : (t.heritageGiveUp === true
                    ? ('自动重试已停（发了 ' + Number(t.heritageTry || 3) + ' 次没写进来），去胎儿页点「按现在的结果重写」')
                    : (Number(t.heritageTry) > 0 ? ('这一胎还没写进来（发了 ' + Number(t.heritageTry) + ' 次）') : '这一胎还没发'))));
            const fr = (() => { try { return fertilityRateTextOf(t.key); } catch { return ''; } })();
            extra.push(kv('累计受孕率这一格', fr || '—'));
            }
        } catch { /* 读不到就不摆，不影响别的 */ }
        body.appendChild(h('div', { class: 'bc-dump-card' },
            h('div', { class: 'bc-dump-title', text: `${maskText(displayName(t))}${t.isUser ? '（用户本人）' : ''}` }),
            // ★ 打码时连 key 也一起打（key 往往就是名字 / 聊天里的人名 ⇒ 标题打了码、
            //   下面这一行又原样印出来，等于白打 ✗）
            kv('key', diagUnmasked ? String(t.key || '') : maskText(t.key)),
            // ★ 模式：**轻档 / 正式档**（原来读的 `t.mode` 根本不存在 ⇒ 永远显示「—」✗）
            kv('模式', t.light === true ? '轻档' : '正式档'),
            ...extra,
            kv('profile', t.profile ? '有' : '无'),
            jsonBlock('面板文字（打码后仍能看结构）', maskPanelText(t.raw)),
            jsonBlock('完整 profile', diagUnmasked
                ? t.profile
                // 同上：锁着时整块不铺（对象键也可能是名字）⇒ 只给规模 ✓
                : ('（已打码 · ' + Object.keys(t.profile || {}).length + ' 键）')),
        ));
    }

    body.appendChild(h('div', { class: 'bc-section-title', text: '骰子' }));
    body.appendChild(h('div', { class: 'bc-dump-card' },
        kv('模式', s.dice?.mode || '—'),
        kv('池子大小', `R=${s.dice?.poolSize} / S=${s.dice?.smallSize}`),
        kv('锁定', st.rolls?.locked ? '是' : '否'),
        kv('上一轮取用', `${(st.rolls?.lastUsed || []).length} 条`),
        jsonBlock('当前池', st.rolls?.pool || null),
    ));

    const snaps = st.snapshots || [];
    body.appendChild(h('div', { class: 'bc-section-title', text: `历史快照（${snaps.length} / 上限 ${MAX_SNAPSHOTS}）` }));
    body.appendChild(h('div', { class: 'bc-dump-card' },
        kv('最早', snaps[0] ? new Date(snaps[0].ts).toLocaleString() : '—'),
        kv('最新', snaps.length ? new Date(snaps[snaps.length - 1].ts).toLocaleString() : '—'),
        // ★ 总量读数：快照体积是**跟着对象数涨**的，光看条数看不出账
        kv('占聊天多少', snaps.length ? Math.round(measureSnapshots(snaps) / 1024) + ' KB' : '—'),
        jsonBlock('索引（时间 / 楼层 / 剧情时间）', snaps.map((x, i) => ({
            '#': i + 1, 时间: new Date(x.ts).toLocaleString(), 楼层: x.messageIndex, 剧情时间: x.date || '',
        }))),
    ));

    body.appendChild(h('div', { class: 'bc-section-title', text: '注入给主 API 的内容' }));
    let pv = { patch: '', state: '' };
    try { pv = previewInjection() || pv; } catch { /* 忽略 */ }
    // ⚠️ 这两段也要打码 —— 它们是**全文最长、信息最多**的；不打码的话
    //   "打码版"截图里对象名和设定一字不落。
    body.appendChild(h('div', { class: 'bc-dump-card' },
        kv('补丁字数', String(pv.patch || '').length),
        jsonBlock('沉浸补丁全文', diagUnmasked ? pv.patch : maskLongText(pv.patch)),
        jsonBlock('状态摘要全文', diagUnmasked ? pv.state : maskLongText(pv.state)),
    ));

    // ---- 最近一次推给**插件 API** 的提示词（2026-10-23 她要的功能）----
    //   只放内存：F5 就没了；默认**折叠**（一次几万字，全铺开会卡）
    body.appendChild(h('div', { class: 'bc-section-title', text: '最近一次推给插件 API 的提示词' }));
    const lpCard = h('div', { class: 'bc-dump-card' });
    try {
        const lp = lastJudgePrompt();
        if (!lp) {
            lpCard.appendChild(h('div', { class: 'bc-hint', text: '这个页面打开之后还没推演过（提示词只放内存，F5 之后就没了）' }));
        } else if (lp.chatKey && String(lp.chatKey) !== String(getChatKey() || '')) {
            // ⚠️ 换了聊天之后它还是上一个聊天那一趟的 ⇒ 别把别的聊天的内容摆出来
            lpCard.appendChild(h('div', { class: 'bc-hint', text: '这份提示词是另一个聊天的（换聊天后没再推演过）' }));
        } else {
            const txt = diagUnmasked ? lp.text : maskLongText(lp.text);
            const pre = h('pre', { class: 'bc-dump-pre', text: txt });
            pre.style.display = 'none';
            const toggleBtn = button('展开全文', () => {
                const show = pre.style.display === 'none';
                pre.style.display = show ? '' : 'none';
                toggleBtn.textContent = show ? '收起' : '展开全文';
            });
            lpCard.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-hint', text: `楼层 ${lp.floor} ｜ ${new Date(lp.ts).toLocaleString()} ｜ ${lp.text.length} 字${diagUnmasked ? '' : '（已打码）'}` }),
                h('div', { class: 'bc-spacer' }),
                toggleBtn,
                button('复制全文', async () => {
                    try {
                        await navigator.clipboard.writeText(lp.text);
                        window.toastr?.success?.('已复制这一轮的提示词');
                    } catch { window.toastr?.warning?.('复制失败，可以展开后手动选'); }
                }),
            ));
            lpCard.appendChild(pre);
        }
    } catch (e) {
        lpCard.appendChild(h('div', { class: 'bc-hint', text: '读不到：' + (e?.message || e) }));
    }
    body.appendChild(lpCard);

    // ---- 头像抓取（要能看出抓的是不是当前 persona ⇒ 把每条分支摊开）----
    body.appendChild(h('div', { class: 'bc-section-title', text: '头像抓取' }));
    const avCard = h('div', { class: 'bc-dump-card' });
    try {
        const rep = describePersonaAvatar();
        for (const [k, v] of Object.entries(rep)) {
            // 路径/URL 这类长值截短显示，完整值在「复制 JSON」里
            let shown = String(v ?? '—');
            // ★★ 酒馆给的当前人设 name1 后面会带出玩家名字，
            //    persona 映射表前那个也会带 ⇒ 这一块**默认必须打码** ✗✓✓
            //    （诊断是发给开发者的材料 ⇒ 玩家名 / 人设名 / 头像文件名一律不能出现在里面）；
            //    真要看清是哪一版时，按上面的「🔓 显示原文」解锁再看 ✓
            if (!diagUnmasked) shown = maskPersonaDiagValue(k, shown);
            avCard.appendChild(kv(k, shown.length > 64 ? shown.slice(0, 40) + '…' + shown.slice(-20) : shown));
        }
        avCard.appendChild(h('div', { class: 'bc-hint', text: '哪一条分支不为空、且「最终采用」跟它一致，就说明是那条命中的' }));
        avCard.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            button('🔁 清缓存并重新抓取', () => {
                try {
                    const now = forceReResolveAvatar();
                    window.toastr?.success?.(now ? '重新抓取到：' + String(now).slice(-40) : '没抓到（面板会退回默认头像）');
                    // 点重新抓取特别卡——原来这里 rebuildStatusViews()，
                    //   等于把整个面板 iframe 重新建一次（几秒）✗
                    //   ⇒ 只把新头像推给现有面板，不动 DOM 结构 ✓
                    for (const v of statusViews) {
                        try {
                            if (!v.panel) continue;
                            v.panel._avatar = '';      // 强制它认为"变了"，才会真的推
                            v.panel.refreshAvatar();
                        } catch { /* 忽略 */ }
                    }
                } catch (e) {
                    window.toastr?.error?.('重抓失败：' + (e?.message || e));
                }
                renderDiag();
            }, { title: '清掉当前作用域的自动头像缓存（不动你上传的自定义头像），强制重新解析' }),
        ));
    } catch (e) {
        avCard.appendChild(h('div', { class: 'bc-hint', text: '读取失败：' + (e?.message || e) }));
    }
    body.appendChild(avCard);

    // ---- 预设条目（要能看出勾了到底发没发出去）----
    body.appendChild(h('div', { class: 'bc-section-title', text: '酒馆预设条目' }));
    const preCard = h('div', { class: 'bc-dump-card' });
    preCard.appendChild(h('div', { class: 'bc-hint', text: '正在读取…' }));
    preCard.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('🔄 重新检测', async () => {
            try { await renderPresetDiag(preCard); } catch (e) { console.warn(e); }
        }),
        button('📋 复制检测结果（默认打码）', async () => {
            try {
                const r = await describePresetInjection();
                // ★ 隐私问题绝对不能轻视 —— 导出信息把 KEY 直接印上去是会出事的
                //   ⇒ 这个出口锁着时**不复制预设全文** ✗，
                //   只给字数；要全文就先按「🔓 显示原文」解锁（本地排查用 ✓）
                const out = { ...r };
                if (!diagUnmasked && out['实际拼出来的文字']) {
                    out['实际拼出来的文字'] = '（已打码·' + String(out['实际拼出来的文字']).length + ' 字）';
                }
                navigator.clipboard.writeText(JSON.stringify(out, null, 2));
                window.toastr?.success?.(diagUnmasked ? '已复制（含预设全文，你自己看）' : '已复制（预设全文已打码）');
            } catch (e) { window.toastr?.error?.('复制失败：' + (e?.message || e)); }
        }),
    ));
    body.appendChild(preCard);
    renderPresetDiag(preCard);

    body.appendChild(h('div', { class: 'bc-section-title', text: '原始存储' }));
    body.appendChild(h('div', { class: 'bc-dump-card' },
        kv('在真聊天里', inRealChat() ? '是' : '否'),
        kv('chat key', diagUnmasked
            ? (() => { try { return getChatKey(); } catch { return '—'; } })()
            // ⚠️ chat key 里通常带着聊天文件名（可能含角色名）⇒ 锁着时只报"有 / 长度" ✗
            : (() => { try { const k = getChatKey(); return k ? ('（已打码·' + String(k).length + ' 字）') : '—'; } catch { return '—'; } })()),
        kv('metadata 体积', meta ? humanBytes(JSON.stringify(meta).length) : '—'),
        kv('metadata 键数', meta ? String(Object.keys(meta).length) : '—'),
        // ★ 锁着时**整块不铺内容**（只给键数 / 字数）—— 因为键名也可能是角色名（别的聊天里）✗
        //   不只是玩家自己的名字，别人的名字也可能被带出来
        jsonBlock('chat_metadata', diagUnmasked
            ? meta
            : (meta ? ('（已打码 · ' + Object.keys(meta).length + ' 键 / ' + JSON.stringify(meta).length + ' 字）') : '（空）')),
    ));
}

/** 把预设条目诊断画进卡片里 */
async function renderPresetDiag(card) {
    clear(card);
    try {
        const rep = await describePresetInjection();
        for (const [k, v] of Object.entries(rep)) {
            if (k === '实际拼出来的文字') continue;
            card.appendChild(kv(k, v));
        }
        const txt = rep['实际拼出来的文字'] || '';
        // 同上：锁着时这一段也打码，只留字数 ✓（解锁后才铺全文）
        const shown = diagUnmasked ? (txt || '(空)') : (txt ? '（已打码·' + txt.length + ' 字）' : '(空)');
        card.appendChild(jsonBlock('实际拼出来的文字（会插进推演提示词）', shown, false));
    } catch (e) {
        card.appendChild(h('div', { class: 'bc-hint', text: '读取失败：' + (e?.message || e) }));
    }
}

/**
 * 头像抓取诊断里那些**带名字**的值，默认打码 ✓（不打码就泄露）
 *
 * 为什么要单独写一个：那一块的值形态很杂 —— 有玩家名（name1）、头像文件名
 * （常常就是人设名，比如 `神威.png`）、还有带 `?file=...` 的头像 URL ✗
 * ⇒ 规则：①计数 / 布尔 / 空标记这类**结构信息照原样** ✓；②明确"带人设名"的字段整值打码（保留字数，方便判断有没有值）；③其余字段里夹着的 `file=` 也抠掉。
 * ⚠️ 只在**没解锁**时调用（解锁后走原文，供本地排查用 ✓）。
 */
export function maskPersonaDiagValue(key, value) {
    const k = String(key || '');
    const s = String(value == null ? '' : value);
    const t = s.trim();
    if (/^(true|false|\d+)$/.test(t)) return s;                       // 布尔 / 纯数字
    if (/^(—|-|（空）|（无）|\(空\)|\(无\)|\(没有 selected 的元素\))$/.test(t)) return s;
    if (/条目数|个数|数目|存在/.test(k)) return s;                       // 计数类
    if (/name1|人设|default_persona|映射|头像|URL|最终采用|localStorage/i.test(k)) {
        return '（已打码·' + s.length + ' 字）';
    }
    return s.replace(/([?&]file=)[^&\s／]*/g, '$1（已打码）');
}

/** 造一份填满的面板文字，用来预览美化效果 */
/**
 * 造一份填满的面板文字，用来预览美化效果。
 *
 * ⚠️ **不要手写这份文本** —— 面板的字段是「标签 | 值」三段式
 * （`数据项六：胎儿状态 | 单胎…`），手写很容易漏掉那个 `|`，
 * 结果面板 `xxx[1]` 取到空，整个频道就是「暂无数据」。
 * 所以直接用插件自己的序列化器生成，格式永远跟得上。
 */
/**
 * 预览用的「推演记录」样例数据（A 状态变化对比 + B 最近一次推演）。
 *
 * ⚠️ 这是补漏：预览模式最早只替换了 raw / conception / chat 三样，
 *   后来「推演记录」改成读 judgeLog 之后，**忘了给它也准备样例** ——
 *   于是预览里那一页是空的（推演记录的预览忘了改 ✗）。
 *   形状必须和 store.js 的 diffForPanel() / lastJudgeForPanel() 一致。
 */
export function demoJudgeLog() {
    return {
        diff: {
            from: 12, to: 13,
            changes: [
                { label: '累计受孕率', from: '12%', to: '20%' },
                { label: '阶段', from: '卵泡期', to: '排卵窗口' },
                { label: '基础率', from: '8%', to: '20%' },
                { label: '身体痕迹', from: '（无）', to: '阴道内射' },
                { label: '胎儿状态', from: '（无）', to: '待受精精子存活中' },
            ],
        },
        last: {
            messageIndex: 13, ts: Date.now() - 3600 * 1000,
            sub: 'Day14', name: '示例角色',
            used: [
                { for: '受精判定', ref: '预设 D100_1', value: 33 },
                { for: '着床天数', ref: '预设 D5', value: 3 },
            ],
            // 「AI 报了什么」的样例
            report: {
                name: '示例角色', sub: 'Day14',
                note: '无套内射，累计受孕率上升，待受精精子存活中',
                // ★ `cot`（推演过程）也要有样例 ——
                //   面板那页新增了这一块，样例里没有的话预览里就是空的 ✗
                //   （这一族坑会反复出现：新增数据源忘了给预览准备样例；见 units 那条形状守卫）
                cot: '时间锚定：Day14 晚，本轮过夜 0 天\n'
                    + '结算检查：条件 A / B 都没到\n'
                    + '防护判定：无套内射，系数 1.0\n'
                    + '状态演化：累计受孕率 8% → 20%\n'
                    + '受精判定：本次不触发（窗口最后一天是 Day15）',
                judgment: { impregnatorCandidates: ['示例致孕方·甲'] },
                traces: { new: '阴道内射', overnight: false, intervention: null },
                // ★ 敏感带「这一轮哪个部位加了几次」也进了报告（2026-10-16）——
                //   它由插件算、存在这一楼的状态里 ⇒ 样例里必须有，不然预览里那一行是空的 ✗
                //   （这一族坑会反复出现：新增数据源忘了给预览准备样例；见 units 那条形状守卫）
                zonesDelta: '耳垂 +2、侧颈 +1、乳尖 +3',
            },
        },
    };
}

/**
 * 多人预览：每个样例对象各一份「推演记录」✓
 * （九个样例共用一份的话，切到谁看到的都是同一个人报的 ✗ ⇒ 必须按人分）
 */
export function demoJudgeLogFor(name, i = 0) {
    const base = demoJudgeLog();
    const nm = name || base.last.name;
    const sub = `Day${(i * 3) % 26 + 1}（样例 ${i + 1}）`;
    return {
        diff: base.diff,
        last: {
            ...base.last,
            name: nm,
            sub,
            report: { ...base.last.report, name: nm, sub, note: `样例 ${i + 1} 这一轮 AI 报了什么`,
                // ★ 每个样例对象的敏感带增量必须不一样（共用一份的话玩家会一眼看出：像共享一份✗）
                zonesDelta: `耳垂 +${i % 3 + 1}、乳尖 +${(i + 1) % 3 + 1}（样例 ${i + 1}）` },
        },
    };
}

/**
 * 预览用的「联系人」样例数据（形状必须跟 `contactsForPanel()` 一模一样 ✓）
 *
 * ⚠️ 名字一律用占位名（项目老规矩：样例里绝不出现真实姓名 ✗）
 */
export function demoContacts() {
    const rec = (round, sub, note, conceived, contrib, viableUntil, roll) => ({
        round, sub, note, roll, conceived, contrib,
        depositDay: contrib == null ? null : round,
        viableUntil: contrib == null ? null : viableUntil,
        at: 1750000000000 + round * 1000,
    });
    return {
        subjectKey: '示例角色',
        subjectName: '示例角色',
        isUser: false,
        canImpregnate: true,
        contacts: [
            {
                key: '示例致孕方·甲', name: '示例致孕方·甲', race: '狼人', times: 3,
                items: [
                    rec(9, 'Day13', '二楼主卧 · 无套内射（样例）', false, 18, 16, 'D100=41'),
                    rec(11, 'Day15', '浴室贴墙 · 无套内射（样例）', true, 22, 18, 'D100=7'),
                ],
            },
            {
                key: '', name: '示例路人·乙', race: '', times: 1,
                items: [rec(6, 'Day8', '沙发上看电影时 · 无套内射（样例）', false, null, null, 'D100=88')],
            },
            // ★ 单人样例里的致孕方写成「甲、乙（异卵异父）」两份 ⇒ 联系人样例里**乙也得在**，
            //   不然预览里点 @示例致孕方·乙 跳不过去（跳转要能在预览里验 ✓）
            {
                key: '示例致孕方·乙', name: '示例致孕方·乙', race: '人类', times: 2,
                items: [
                    rec(12, 'Day15', '书房里 · 无套内射（样例 · 异父）', true, 26, 18, 'D100=9'),
                    rec(14, 'Day16', '判定后追加（样例）', false, 12, 19, 'D100=54'),
                ],
            },
        ],
        impregnations: [
            {
                key: '示例角色·丙', name: '示例角色·丙', race: '人类', times: 2,
                items: [
                    rec(7, 'Day10', '清晨床上 · 无套内射（样例）', true, 26, 13, 'D100=12'),
                    rec(8, 'Day12', '追加内射（样例）', false, 14, 15, 'D100=63'),
                ],
            },
        ],
        // ★ 已建档、还没有记录的人（新形态）：预览里也放一个样例，
        //   不然"点了『添加联系人』之后长什么样"在预览模式里根本看不到 ✗
        pending: [
            { key: '示例角色·丁', name: '示例角色·丁', race: '精灵', times: 0, items: [] },
        ],
    };
}

/** 多人预览：按对象给一份（不然切到谁看到的都是同一个人 ✗） */
export function demoContactsFor(name, i = 0) {
    const base = demoContacts();
    const nm = name || base.subjectName;
    const race = ['人类', '狼人', '精灵'][i % 3];
    // ★ 切到「你自己」那个样例时：名字要用**当前人设名**（`userLabel()` ✓），
    //   而不是样例表里那个字面量 `{{user}}` ✗
    const isUser = String(nm) === '{{user}}';
    return {
        ...base,
        subjectKey: isUser ? USER_KEY : nm,
        subjectName: isUser ? userLabel() : nm,
        isUser,
        // 样例里让一部分对象"只受孕不能致孕"，正好能看出视角切换会消失 ✓
        canImpregnate: i % 3 !== 2,
        // ★ 两条**致孕方**样例也跟着用同一套占位名家族（甲/乙/丙）——
        //   每个对象自己那条「异卵异父」名单（d4）里的人，必须在**他自己那份联系人样例**里找得到，
        //   否则预览里点 @名字 跳不过去 ✗
        //   ⇒ 第 0 行和第 2 行（两行致孕方）按序号配成一对：i%3=1 时正好是「乙 + 甲」＝异父那一对 ✓
        contacts: base.contacts.map((g, gi) => ({
            ...g,
            name: gi === 0 ? `示例致孕方·${['甲', '乙', '丙'][i % 3]}`
                : (gi === 2 ? `示例致孕方·${['丙', '甲', '乙'][i % 3]}` : g.name),
            race: (gi === 0 || gi === 2) ? race : '',
            times: g.times + i,
            items: g.items.map((x) => ({ ...x, sub: `Day${(i * 2 + (x.round || 0)) % 26 + 1}` })),
        })),
        impregnations: i % 3 === 2 ? [] : base.impregnations,
    };
}

/**
 * 预览用的「推演记录」样例数据。
 *
 * 面板那个「推演记录」频道要的是**带 <status_profile> 的楼层**，
 * 而真实的 snapshotChat() 在非聊天页面直接返回空数组 ——
 * 所以预览里那一块一直是「最近楼层中未找到状态笔记」。
 * 这里造几条递进的历史，正好能看出改动前后差在哪。
 */
export function demoChat() {
    const step = (n, sub, rate, extra) => ([
        '<status_profile name="月见 凛">',
        '状态标题：🌟 孕期健康监测',
        '数据项一：阶段 | 孕中期',
        '数据项二：' + sub + ' | 累计受孕率 ' + rate,
        extra,
        '</status_profile>',
    ].filter(Boolean).join('\n'));
    // ⚠️ `_bcKey` 要跟着真形状一起给 ——
    //   它是"这条文字属于哪个对象"的键；样例少了它，预览里的回写路径就跟真机不一样 ✗
    return [
        { name: 'Bodycord', is_user: false, _bcKey: '月见 凛', _bcIndex: 0, _bcFloor: 38, _bcTs: Date.now() - 86400000 * 12,
          mes: step(1, '卵泡期', '8%', '数据项三：基础率 | 8%') },
        { name: 'Bodycord', is_user: false, _bcKey: '月见 凛', _bcIndex: 1, _bcFloor: 41, _bcTs: Date.now() - 86400000 * 9,
          mes: step(2, '排卵窗口', '28%', '数据项三：基础率 | 20%') },
        { name: 'Bodycord', is_user: false, _bcKey: '月见 凛', _bcIndex: 2, _bcFloor: 43, _bcTs: Date.now() - 86400000 * 8,
          mes: step(3, '排卵窗口', '58%', '数据项三：基础率 | 20%') },
        { name: 'Bodycord', is_user: false, _bcKey: '月见 凛', _bcIndex: 3, _bcFloor: 47, _bcTs: Date.now() - 86400000 * 7,
          mes: step(4, '已受精 · 待着床', '58%（已锁定）', '数据项五：意识状态 | 已确认怀孕 · 已知晓致孕方身份（示例致孕方·乙）') },
        { name: 'Bodycord', is_user: false, _bcKey: '月见 凛', _bcIndex: 4, _bcFloor: 62, _bcTs: Date.now() - 86400000 * 2,
          mes: step(5, '孕中期 · 孕22周+3天', '不适用', '数据项六：胎儿状态 | 双胎 · 子1（半狼人）子2（人类）') },
    ];
}

/**
 * 预览用的「受孕记录」样例数据。
 *
 * ⚠️ **预览要把所有看得见的东西都塞满**。
 *   只替换面板文字（raw）、而受孕记录/判定这些走真实数据的话，
 *   在非聊天页面上永远是空的，根本看不到这块长什么样。
 *   形状必须和 store.js 的 conceptionForPanel() 完全一致。
 */
export function demoConception() {
    return {
        judgment: {
            round: 47, sub: 'Day16',
            rate: 120, judgeValue: 100,
            roll: 33, rollSource: '预设 D100_1',
            passed: true, implantDays: 8,
            // ★ 着床判定（2026-10-14）：形状必须跟上 `conceptionForPanel` ✓
            implantPassed: true, implantRoll: 12,
            // ★ 着床结果到日子才显示 ⇒ 预览里给"已到日子"的样子（形状要和真实数据一致 ✓）
            implantKnown: true, implantLeft: 0,
            lifeNote: '（2 批已失活，仍计入累计）',
            // ★★ 判定口径（2026-10-20）：形状必须跟上 `conceptionForPanel` ——
            //   面板只认外壳给的这三样（口径 / 判定值那句括号 / 卡片底下那句说明）✓
            basis: 'cumulative',
            valueNote: '（累计 120% 已封顶）',
            basisNote: '（2 批已失活，仍计入累计） 判定用窗口结束那一刻的累计受孕率；失活批次已计入的贡献仍保留。',
        },
        locks: [
            { child: 1, impregnator: '示例致孕方·甲', roll: 33 },
            { child: 2, impregnator: '示例路人·乙', roll: 68 },
        ],
        insems: [
            // ⚠️ 异父超级受精时，**两个致孕方各有一条中招记录**
            //    只标其中一个的话，「子2 锁定给另一个」看起来毫无依据 ✗
            // 早的那批已经过存活期了（面板会标「已失活」）
            // ★ 预览里的名字要和「联系人」样例**对得上** ✓
            //   （这样才好在不跑剧情的情况下验证"点名字跳过去" ⇒ 两边名字不同就永远跳不过去 ✗）
            // ★ 预览样例也要带剧情钟点（真实数据落账就带 ⇒ 形状必须一致 ✓）
            { round: 40, sub: 'Day12', by: '示例致孕方·甲', roll: 'R2', note: '在二楼卧室无套内射', conceived: false, contrib: 15, viableUntil: 14, clk: '09:20' },
            { round: 43, sub: 'Day13', by: '示例路人·乙', roll: 'R5', note: '在浴室里贴着墙内射', conceived: false, contrib: 22.5, viableUntil: 15, clk: '14:05' },
            // 这几批还在存活期（面板会标「存活中」）
            { round: 45, sub: 'Day14', by: '示例致孕方·甲', roll: 'R1', note: '被按在窗边内射', conceived: true, contrib: 30, viableUntil: 16, clk: '21:40' },
            { round: 46, sub: 'Day15', by: '示例路人·乙', roll: 'R4', note: '在沙发上无套内射', conceived: true, contrib: 22.5, viableUntil: 17, clk: '23:10' },
            { round: 47, sub: 'Day15', by: '示例致孕方·甲', roll: 'R3', note: '关了灯之后又来了一次', conceived: false, contrib: 30, viableUntil: 18, clk: '23:55' },
            { round: 61, sub: 'Day22', by: '示例致孕方·甲', roll: 'R7', note: '着床完成后 · 这一批不参与判定', conceived: false, contrib: null, viableUntil: null, clk: '08:15' },
        ],
        // ★ 事后避孕药也要在受孕记录页看得到 —— 预览里给一条样例，
        //   不然玩家在不跑剧情时看不到那一块长什么样 ✗
        pills: [
            { round: 48, day: 16, factor: 0.2, at: 0 },
        ],
        // 当前剧情天数 / 轮次：面板据此判断哪些批次已失活（形状必须和 conceptionForPanel 一致）
        nowDay: 15,
        nowRound: 47,
        // 历史归档的样例（换周期时收起来的那几段）—— 形状也要和真实数据一致 ✓
        // ★ 2026-10-31：新加的那段「分娩」要带 `fetus`（插件清那一格之前收进来的胎儿原文）——
        //   不摆一条样例的话，玩家不跑剧情就永远看不到这一行长什么样 ✗
        archive: [
            {
                at: Date.now() - 86400000 * 7,
                reason: '已分娩', mode: 'reset',
                fetus: '单胎 · 孕 38 周；子1：人类 女（致孕方：示例致孕方·甲）',
                locks: [{ child: 1, impregnator: '示例致孕方·甲', roll: 43 }],
                count: 5, conceived: ['示例致孕方·甲'],
            },
            {
                at: Date.now() - 86400000 * 30,
                reason: '新周期开始', mode: 'reset',
                fetus: '',
                locks: [{ child: 1, impregnator: '示例路人·乙', roll: 68 }],
                count: 3, conceived: ['示例路人·乙'],
            },
            {
                at: Date.now() - 86400000 * 60,
                reason: '受精失败结算', mode: 'reset',
                fetus: '',
                locks: [],
                count: 2, conceived: [],
            },
            {
                // 受精成功但没着床 ⇒ 插件会把它记成「着床失败」（不是"新周期开始"）✓
                at: Date.now() - 86400000 * 90,
                reason: '着床失败', mode: 'reset',
                fetus: '',
                locks: [{ child: 1, impregnator: '示例致孕方·甲', roll: 41 }],
                count: 4, conceived: ['示例致孕方·甲'],
            },
        ],
        // ★ 账本保险丝的两个读数 —— 形状必须和 conceptionForPanel 一致，
        //   否则那条"形状一模一样"的断言会红 ✓；预览里给 0，免得预览看着像"记录被清过" ✗
        insemCut: 0,
        insemCap: 1000,
        // ★★ 这些提醒放受孕记录里面，示例也得跟着更新 ✓ ——
        //   受孕记录这一页新增的「提醒」块（着床完成 / 每胎预产期）也要有样例，
        //   形状必须和 `conceptionForPanel()` 一致 ✓、多人预览时每个对象各不相同 ✓
        alerts: [
            { kind: 'conceive', sub: '', name: '示例角色', date: '1年05月03日', seen: true, note: '示例角色 已着床完成（怀孕）' },
            { kind: 'due', sub: '子1', name: '示例角色', date: '2年01月06日', seen: false, note: '示例角色 的预产期（第 1 胎）：2年01月06日' },
        ],
    };
}

/**
 * 预览「多人追踪」时用的样例对象（不写进任何状态，只给界面看）。
 *
 * ⚠️ 名字**故意用明显的占位名**：预览样品里出现像真名的东西会让人以为是真数据
 *   （预览里敏感带 BOT 名字写成"后颈 3级（累计刺激 28）"就会看着像真数据 ✗）。
 *
 * ⚠️⚠️ 每份数据**必须不一样**：
 *   （只堆 9 个名字、面板数据却是同一份 ⇒ **示例角色所有的数据都一样，没办法辨认** ✗）
 *   ⇒ 每个人在**几个关键字段上各不相同**（敏感带 / 累计率 / 阶段 / 泌乳 / 生产次数），
 *     一眼就能看出"我现在点的是谁" ✓。
 */
/**
 * 多人预览：每个样例对象各一份「受孕记录」✓
 * （真实使用里本来就是按对象分的 `conceptionForPanel(active)` ⇒ 预览也得对得上 ✗）
 */
export function demoConceptionFor(i = 0) {
    const base = demoConception();
    const roll = 20 + (i * 7) % 70;
    const who = '示例致孕方·' + ['甲', '乙', '丙'][i % 3];   // 跟 demoContactsFor 同一套名字（点名字跳得过去 ✓）
    // ⚠️ 每个样例对象的钟点也要各不相同（验收判据：预览里数据必须分得出来 ✓）
    const clkShift = (hhmm, i2) => {
        const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
        if (!m) return String(hhmm || '');
        const total = (Number(m[1]) * 60 + Number(m[2]) + i2 * 97) % 1440;
        return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    };
    // ★ 判定值 / 口径那句括号也要**跟着这个样例对象的累计率算** ——
    //   整份 copy 下来不改的话，会出现「累计 75%」旁边写着「累计 120% 已封顶」这种自相矛盾的样例 ✗
    const rate = 60 + (i * 15) % 60;
    // 让**有一个样例是"仅存活精子"口径**（验收判据：新做的那一档在预览里要看得见 ✓）
    const basis = (i % 3 === 1) ? 'alive' : 'cumulative';
    const judgeValue = (basis === 'alive') ? Math.round(rate * 0.6 * 10) / 10 : Math.min(100, rate);
    const valueNote = (basis === 'alive')
        ? `（累计 ${rate}%，判定只算存活批次）`
        : (rate > judgeValue ? `（累计 ${rate}% 已封顶）` : '');
    const lifeNote = (i % 2 === 0)
        ? ((basis === 'alive') ? '（2 批已失活，不计入判定）' : '（2 批已失活，仍计入累计）')
        : '';
    const basisNote = (basis === 'alive')
        ? [lifeNote, '判定只算窗口结束那一刻还活着的批次，已失活的不计入判定值。'].filter(Boolean).join(' ')
        : [lifeNote, '判定用窗口结束那一刻的累计受孕率；失活批次已计入的贡献仍保留。'].filter(Boolean).join(' ');
    return {
        ...base,
        judgment: {
            ...base.judgment,
            roll, rate, judgeValue,
            basis, valueNote, basisNote, lifeNote,
            // ★ 让**有一样例是"受精成功但没着床"**（验收判据：预览里要看得见这个形状 ✓）
            //   ⚠️ 掷值也要跟结论自洽：成功那条必须落在 1-80 里，失败那条落在 81-100 里 ✓
            implantPassed: (i % 3 !== 1),
            implantRoll: (i % 3 !== 1) ? ((i * 11) % 70 + 5) : (85 + (i * 3) % 15),
            implantKnown: true, implantLeft: 0,
        },
        // ★ 提醒也要**每个样例各不相同**（验收判据：预览里数据必须分得出来 ✓）
        // ★ 没着床那一号只能有「没着床」那条提醒：还挂着"已着床完成 / 预产期"就跟结论打架 ✗
        alerts: (i % 3 === 1) ? [{
            kind: 'implant_fail', sub: '', name: '示例角色',
            date: '1年0' + (5 + (i % 4)) + '月' + String(3 + (i % 20)).padStart(2, '0') + '日',
            seen: i % 2 === 0,
            note: '示例角色 受精成功但没着床',
        }] : [{
            kind: 'conceive', sub: '', name: '示例角色',
            date: '1年0' + (5 + (i % 4)) + '月' + String(3 + (i % 20)).padStart(2, '0') + '日',
            seen: i % 2 === 0,
            note: '示例角色 已着床完成（怀孕）',
        }, {
            kind: 'due', sub: '子' + (1 + (i % 3)), name: '示例角色',
            date: '2年0' + (1 + (i % 8)) + '月' + String(10 + (i % 18)).padStart(2, '0') + '日',
            seen: false,
            note: '示例角色 的预产期',
        }],
        locks: [{ child: 1, impregnator: who, roll }],
        insems: base.insems.slice(0, 3 + (i % 3)).map((x, j) => ({
            ...x,
            round: x.round + i,
            sub: 'Day' + (10 + j + i),
            by: who,
            clk: clkShift(x.clk, i),
        })),
        // ★ 事后避孕药也得跟对象走 ——
        //   真实数据本来就是按对象存的（落账带 target、面板按对象过滤 ✓），
        //   样例整份 copy 下来没覆盖的话 ⇒ 点谁看都一样、像只有一份共享记录 ✗
        //   ⇒ 隔一个人有一条，日期与轮次都跟着 i 变 ✓
        pills: (i % 2 === 0)
            ? [{ round: 48 + i, day: 16 + (i % 5), factor: 0.2, at: 0 }]
            : [],
        // ★ 历史归档同理：真实数据按对象过滤、每条还带 target ✓
        //   ⇒ 样例也要按对象取不同的段数，并把 target 补上（不然形状和真实数据对不上 ✗）
        // ★ 胎儿那行里写的致孕方也要换成这个样例对象自己的那个（不然三份看着像同一份 ✓）
        archive: base.archive
            .slice(0, [3, 1, 0][i % 3])
            .map((a) => ({
                ...a,
                target: '示例角色·' + ['甲', '乙', '丙'][i % 3],
                fetus: String(a.fetus || '').replace(/示例致孕方·[甲乙丙]/, who),
            })),
    };
}

/**
 * 「成就」频道的样例数据（预览用）。
 * ⚠️ 里面的人名一律用占位名 / 示例名（`{{user}}` / `示例角色·甲`）——
 *   预览是给玩家看的样例，绝不能出现真名 ✓（同联系人那套白名单）
 */
export function demoAchievements(activeKey = '') {
    const rows = [
        { id: 'demo-a3', title: '初次中招', why: '排卵窗口内首次内射，判定成功', quip: '又是这套流程，熟练得让人心疼。', target: '示例角色·甲', date: '1年03月14日' },
        { id: 'demo-a2', title: '三连不落空', why: '连续三天内射，且都在受孕窗口内', quip: '这种展开，剧本是一点伏笔都不给啊。', target: '示例角色·乙', date: '1年02月27日' },
        { id: 'demo-a1', title: '计划通', why: '分娩完成，生产次数 +1', quip: '计划通，代价是明年的奶粉钱。', target: '{{user}}', date: '1年02月09日' },
    ];
    const list = rows.map((r, i) => ({ ...r, floor: 12 - i, at: Date.now() - i * 86400000 }));
    // 当前看的那个样例对象：多人预览时是那个样例的 key（= 名字 ✓），单人预览时是本人 ✓
    const key = String(activeKey || '');
    const activeName = key === '__user__' ? '{{user}}' : (key || '{{user}}');
    return { count: list.length, activeName, list };
}

/**
 * 「阶段插图」的样例数据（预览用）。
 *
 * ⚠️⚠️ 为什么全都显示排卵日 —— **拿 `key.length` 当散列就是坑** ✗：
 *   九个样例名都是「示例角色·X」（长度全 6）
 *   ⇒ `6 % 6 = 0` ⇒ **全落到「排卵日」那一个** ✗。
 *   ⇒ 改成按**样例序号**（`demoTargets()` 里的下标）轮流取，和旁边几个样例函数同一套路 ✓
 *   ⇒ 断言锁住：预览这批样例必须**六个状态全覆盖**（自测脚本 ✓）
 *
 * ⚠️ 不出现任何真名（这里连名字都不给，面板那块只画阶段名 ✓）
 * ⚠️ 图用**玩家自己配的**（`stageImageOf` 会读设置）—— 这样预览里能看到他传的图长什么样 ✓
 * ⚠️ 文字也走 `stageTextOf`（含术语表 + 玩家改过的 ✓），档位用**全局默认档**
 *   —— 样例不是真对象，没有"按人"这回事 ✓
 */
export function demoStages(activeKey = '') {
    const list = demoTargets();
    const want = String(activeKey || '');
    const t = list.find((x) => x.key === want) || list[0];
    const mode = periodMode();
    // ★★ 为什么例子里怀孕了还是显示排卵日 ＋ 图片贴上去之后没有子宫：
    //   ① **按序号轮着发**六个状态键 ⇒ 本人那份明明是孕中期，透视块却写「排卵日」✗
    //   ② 只给一张 `image`（老模型的形状）⇒ 面板一看没有 `layers` 就退回老单图 ⇒ 永远没子宫 ✗
    //   ⇒ 现在：阶段由**这一份样例自己的事实**推（跟真实数据同一个判据），
    //     分层那一组走**跟真实数据同一个拼装函数**（`stageLayersForSample` ⇒ `composeStageLayers`）✓
    const facts = t.demoFacts || {};
    const stage = pickStage(facts);
    const text = stageTextOf(stage, mode);
    const lay = stageLayersForSample(mode, facts);
    return {
        on: true, stage, title: text.title, line: text.line,
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

/**
 * 「孩子」频道的样例数据（预览用）。
 *
 * ★ 这一格漏了样例：预览里读的是真实数据、
 *   切谁都不变，而且名字那格印出了 `{{user}}` 宏 ✗
 *   （切换别人还是显示"看的是 {{user}} 的孩子" ⇒ **是 BUG** ✓）
 *   ⇒ 现在：按样例序号给**不同**的孩子数 / 性别 / 年龄（切过去一眼看得出差别 ✓），
 *     本人那一份的显示名走 `userLabel()`（绝不给宏 ✓）
 * ⚠️ 名字一律占位名（`示例孩子·甲` 这种，陌生人看不出是谁 ✓）
 */
export function demoChildren(activeKey = '') {
    const k = String(activeKey || '');
    const isUser = k === '__user__';
    const list0 = demoTargets();
    const at = Math.max(0, list0.findIndex((t) => t.key === k));
    const who = isUser ? userLabel() : (k ? (k === '__user__' ? userLabel() : k) : '');
    const nameOf = '示例孩子·' + ['甲', '乙', '丙', '丁'][Math.max(0, at - 1) % 4];
    const kids = [];
    // 0~2 个（有人没孩子，正好能看出空态 ✓）
    const n = at % 3;
    for (let i = 0; i < n; i++) {
        const birth = `1年0${3 + i}月1${i}日`;
        kids.push({
            id: 'demo-child-' + at + '-' + i,
            title: i === 0 ? nameOf : nameOf + '·' + (i + 1),
            named: true,
            sex: (i % 2) ? '女' : '男',
            race: ['人类', '狼人', '精灵'][(at + i) % 3],
            other: '示例致孕方·' + ['甲', '乙', '丙'][(at + i) % 3],
            heritage: (at + i) % 2 ? '' : '显性：银发褐瞳，隐性携带：人类血统',
            talent: [
                '从一边拿到完整的剑术手感',
                '只从一边拿到一小块的潜行习惯',
                '两边都拿到：一个是观星，一个是制药',
                '从一边拿到完整的制药手艺',
            ][(at + i) % 4],
            strength: ['与亲代同级', '只剩一部分', '两边叠在一起比双方都高', '还没成体系'][(at + i) % 4],
            birthDate: birth,
            age: '',
        });
    }
    const now = '1年06月20日';
    for (const c of kids) c.age = childAgeText(c.birthDate, now);
    return { count: kids.length, activeName: who || '示例角色', now, list: kids.slice().reverse() };
}

/**
 * ★ 「身体状态」频道的预览样例（2026-10-17 加的）——
 *   那一页读的是**两条来源**：三条状态描述（在面板文字里）＋ 痕迹清单（插件算的，单独推过去）。
 *   预览时那份痕迹也是空的，所以这里造一份**每个对象都不一样**的（玩家拿预览当验收台用 ✓）。
 *   ⚠️ 名字一律占位名、部位也照玩家自己的样例部位走 ✓
 */
export function demoBodyState(i = 0) {
    const at = Math.max(0, Number(i) || 0);
    const t = demoTargets().filter((x) => !x.isUser)[at] || null;
    const p = (t && t.profile) || demoPanelText.P || {};
    const zone = ['后颈', '锁骨', '腰侧', '耳后', '肩胛', '手腕', '腰窝', '小腹', '脚踝'][at % 9];
    const r1 = [
        '生殖道腺体分泌旺盛，内壁因充血而微微发烫',
        '乳房胀大，表面能看见浅浅的青色血管',
        '腰腹皮肤绷紧，久站之后会发酸',
    ][at % 3];
    const r2 = ['双眼被领带蒙住，耳廓泛红', '肩胛绷紧，皮肤沾着薄汗', '腰侧与床单之间留着浅浅的压痕'][at % 3];
    const traces = [
        { part: zone, kind: ['吻痕', '抓痕', '刀痕'][at % 3], level: ['轻度', '中度', '重度'][at % 3], nightsLeft: 3 + at },
        { part: ['大腿内侧', '颈侧', '后背'][at % 3], kind: '掌印', level: ['深层', '轻度', '中度'][at % 3], nightsLeft: 1 + (at % 4) },
    ];
    return {
        name: t ? t.name : '示例角色',
        row1: r1,
        row2: r2,
        row3: String((p && p.row3) || ''),
        traceStep: 3,
        traces,
    };
}


export function demoTargets() {
    const names = ['示例角色·甲', '示例角色·乙', '示例角色·丙', '示例角色·丁',
        '示例角色·戊', '示例角色·己', '示例角色·庚', '示例角色·辛', '示例角色·壬'];
    const out = [{ key: '__user__', name: '{{user}}', isUser: true, profile: null, raw: '', demoIndex: 0, demoFacts: DEMO_USER_FACTS }];
    // ★ `demoIndex` = 这一份在**非本人名单**里的序号 —— 它**必须**跟着对象一起走：
    //   别处（`previewPanelPayload`）拿 `demoTargets().map((t, i) => ...)` 的 `i` 去取样例，
    //   那个 `i` **把本人也算进去了**（比这里大 1）⇒ 两边的名字家族会错开一格：
    //   对象拿到的是"甲的名单"、联系人样例却是"乙的联系人" ⇒ 预览里点 @名字 跳不过去 ✗
    //   （"示例没有更新"那类毛病同一个病根 ✓）
    for (let i = 0; i < names.length; i++) out.push({ ...demoOne(names[i], i), demoIndex: i });
    return out;
}

/** 单个样例对象：在单人样例的基础上，按序号改掉几处，保证彼此可辨认 */
function demoOne(name, i) {
    // 先跑一次单人样例，把那份 P 缓存下来（`demoPanelText.P`），再逐项覆盖
    demoPanelText();
    const base = { ...(demoPanelText.P || {}) };
    const zone = ['后颈', '耳后', '锁骨', '腰侧', '手腕', '脚踝', '肩胛', '腰窝', '小腹'][i % 9];
    const profile = {
        ...base,
        phase: ['卵泡期', '受孕窗口', '稳定期'][i % 3],
        sub: `Day${(i * 3) % 26 + 1}（样例 ${i + 1}）`,
        d2: `${15 * (i + 1)}%`,
        d3: [2.0, 1.5, 1.0, 2.5][i % 4].toFixed(1),
        // ★ 名字统一到**跟联系人样例同一套占位名家族**（示例致孕方·甲/乙/丙）——
        //   这里写「一号/二号」而联系人样例里是「甲/乙/丙」的话 ⇒ 预览里点 @名字 跳不过去 ✗
        //   （样例之间对不上就会这样 ✓）
        //   双胎那一号（i%3===1）故意写两份 ＋「（异卵异父）」，好看到"一天挂两条名单"的样子 ✓
        d4: i % 3 === 2 ? '无'
            : (i % 3 === 1 ? '示例致孕方·甲、示例致孕方·乙（异卵异父）' : '示例致孕方·甲'),
        // ★ 胎儿动态也得每个人不一样 —— 原来只覆盖了别的字段，d6 直接沿用了单人样例 ✗
        // ★ 同卵那一号（i===6）：概述带「（同卵）」，两胎的**性别与致孕方完全一样** ——
        //   面板上要能一眼看见这个形状（玩家拿预览当验收台 ✓）；其余还是单胎样例
        d6: i % 3 === 0
            ? (i === 6
                ? buildFetus('双胎（同卵） · 孕20周，胎心稳定', [
                    { race: '人类', sex: '女', impregnator: '示例致孕方·甲', extra: `样例 ${i + 1} · 显性：黑发黑瞳`, talent: '从一边拿到完整的剑术天赋，还没成体系，得自己练', strength: '还没成体系' },
                    { race: '人类', sex: '女', impregnator: '示例致孕方·甲', extra: `样例 ${i + 1} · 显性：黑发黑瞳`, talent: '从一边拿到完整的剑术天赋，还没成体系，得自己练', strength: '还没成体系' },
                ])
                : buildFetus(`孕 ${8 + i * 2} 周，胎心稳定`, [
                    { race: '人类', sex: i % 2 ? '女' : '男', impregnator: '示例致孕方·甲', extra: `样例 ${i + 1} · 发育正常`, talent: '两边都拿到：一个是观星，一个是制药，两样并排留在身上', strength: '两边叠在一起比双方都高' },
                ]))
            : (i % 3 === 1
                ? buildFetus(`孕 ${10 + i} 周，双胎`, [
                    { race: '半狼人', sex: '男', impregnator: '示例致孕方·乙', extra: `样例 ${i + 1} · 显性：银发褐瞳`, talent: '两种天赋揉在一起，变成一种新的直觉', strength: '起点高于亲代' },
                    { race: '人类', sex: '女', impregnator: '示例致孕方·甲', extra: `样例 ${i + 1} · 发育正常`, talent: '只从一边拿到一小块的潜行习惯', strength: '只剩一部分' },
                ])
                : '未加载'),
        // ⚠️ 这两格**只写值、别带标签**：d7 / d9 是「裸项」，`serialize.js` 会给它们补上
        //   `泌乳状态 | …` / `敏感带 | …` ⇒ 样例里再写一遍就变成「泌乳状态 | 泌乳状态…」✗
        //   （"泌乳和生产次数位置有冲突"就是这一类毛病 ✓）
        d7: i % 4 === 0 ? '少量' : '未加载',
        d8: `${i % 3} 次（样例 ${i + 1}）`,
        d9: `${zone} ${(i % 5) + 1}级（累计刺激 ${[5, 21, 51, 101, 181][i % 5]}）`,
        // ⚠️ 「近三日行为」那行也带对方的名字 ⇒ 必须换成**这一号自己那份联系人里有的那个名字** ✗
        //   （不然样例里出现别的号的人名，点 @名字 跳不过去 ✓）
        row3: '昨夜 23:10 · 示例致孕方·' + ['甲', '乙', '丙'][i % 3] + ' · 内射',
    };
    // ★★ `minor`（面板顶上那行「当前时间 ｜ 当前防护 ｜ 近期风险」）也必须**按人**各不一样：
    //   整份沿用了单人样例 ⇒ 9 个示例角色那一行**一模一样** ✗
    //   真实数据里这行是**按人**的（AI 每轮按那个人写：防护 / 近期风险；只有"当前时间"那半
    //   是世界共用的剧情时间 ⇒ 那个**不该**变 ✓）⇒ 样例也必须各不一样 ✓
    //   ⚠️ 两条硬约束：
    //     ① 名字只能用**它自己那份 d4 名单**里的（i%3===2 那种"无"的名单就不许出现名字，
    //        不然预览里点 @名字 跳不过去 ✗）
    //     ② 日期那半**保持一样**（剧情时间是全世界的 ✓）⇒ 九个人要不重样只能靠 防护 × 风险 的
    //        组合，所以这一格**照抄一张 9 条的清单**最稳（跟名字 / 部位那几张清单同一套路 ✓）
    //        —— 按 i%4 拼会撞车（i=0 与 i=4 一模一样 ✗，测试会抓）
    //   ⚠️ A8（2026-10-14）之后「近期风险」那半由**插件**拼（`recentRiskForPrompt()`）⇒
    //      样例的措辞要跟真实输出对得上：时间说 今天 / 昨天 / N 天前；没有批次时说
    //      「本周期暂无性行为记录」；有窗口定位就补（窗口内）/（窗口已过）✓
    profile.minor = [
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：无 ｜ 近期风险：昨天与示例致孕方·甲内射（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：魔法屏障（完好） ｜ 近期风险：今天与示例致孕方·乙内射（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：外射 ｜ 近期风险：本周期暂无性行为记录',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：短效避孕药 ｜ 近期风险：昨天与示例致孕方·甲无套外射（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：无 ｜ 近期风险：3 天前与示例致孕方·乙内射（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：羊肠套（完好） ｜ 近期风险：3 天前内射（窗口已过）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：外射 ｜ 近期风险：今天与示例致孕方·甲无套外射（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：短效避孕药 ｜ 近期风险：昨天与示例致孕方·乙套破损（窗口内）',
        '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：无 ｜ 近期风险：5 天前内射（窗口已过）',
    ][i % 9];
    // ★ A3（2026-10-14）之后 d5 是「状态值 · 致孕方知情」两半拼的（前半截由插件算）⇒
    //   九份样例也得**各自跟自己的 d4 / d6 对得上**：
    //     · 还没有致孕方（i%3===2 那份 d4 是「无」）⇒ 只能是「尚未知晓致孕方身份」
    //     · 没有胎儿（i%3===2 那份 d6 是「未加载」）⇒ 整条就是模块规定的「未加载」✓
    profile.d5 = [
        '已确认怀孕 · 已知晓致孕方身份（示例致孕方·甲）',
        '怀疑但未确认 · 尚未知晓致孕方身份',
        '未加载',
        '已确认怀孕 · 已知晓致孕方身份（示例致孕方·甲）',
        '已确认怀孕 · 已知晓致孕方身份（示例致孕方·甲、示例致孕方·乙）',
        '未加载',
        '怀疑但未确认 · 已知晓致孕方身份（示例致孕方·甲）',
        '未察觉 · 尚未知晓致孕方身份',
        '未加载',
    ][i % 9];
    // ★ 生理监测（period_profile）也要有 —— 多人样例原来没传 period ⇒ 那一页是空的 ✗
    const period = {
        day: `第 ${1 + (i % 5)} 天`,
        flow: ['少量', '中等', '较多'][i % 3],
        color: ['暗红', '鲜红', '褐色'][i % 3],
        texture: `样例 ${i + 1} 的经血质地`,
        pain: ['无明显不适', '轻微坠胀', '中等疼痛'][i % 3],
        desc: `样例 ${i + 1}：腰酸、轻微乏力`,
    };
    // 名字也换成"这一号"的，免得面板标题还写着单人样例那个名字
    const raw = buildStatusProfile(name, profile, period);
    return { key: name, name, isUser: false, profile, raw, demoFacts: demoStageFacts(i) };
}

/**
 * ★★ **预览样例的"阶段插图"必须跟这一份样例自己的状态对得上** ——
 *   `demoStages` 按序号**轮着发**六个状态键、跟样例对象是谁无关的话 ⇒
 *   本人那份明明是「孕中期 孕 22 周 + 3 天」，透视块却写着「排卵日」✗
 *   （怀孕了怎么还排卵 ✗）。
 *   ⇒ 现在把"这一号该画什么"作为**样例自己的事实**放在对象上（`demoFacts`），
 *     由 `demoStages` 照它推 —— 跟真实数据那条路同一个判据 ✓✓。
 *
 *   事实表（跟 `demoOne` 里那三档 `phase` 对齐：卵泡期 / 受孕窗口 / 稳定期）：
 *     · 卵泡期 ⇒ 有存活精子（前几天内射的）⇒ 精子存活中
 *     · 受孕窗口 ⇒ 卵子在场；有没有精子决定「排卵日」还是「精子游向卵子」
 *     · 稳定期 ⇒ 精子已失活 ⇒ 普通的一天；受精成功了才是「受精」
 *   ⚠️ 精液量档**故意六个各用一次**（验收这块就是要一眼把六张底图都看到 ✓）
 */
function demoStageFacts(i) {
    const n = ((i % 9) + 9) % 9;
    // ★★ 2026-10-18：两本账都要给（阴道 = 底图、子宫 = 那张透明层）——
    //   玩家拿预览当验收台用，**每个样例的六档要各不相同**，不然一眼就看出：像共享一份✗
    return [
        { sperm: true, vaginaTier: 'many', wombTier: 'residue' },      // 卵泡期：精子还在
        { egg: true, vaginaTier: 'residue', wombTier: 'empty' },       // 受孕窗口：只有卵子
        { vaginaTier: 'empty', wombTier: 'empty' },                    // 稳定期：普通的一天
        { sperm: true, vaginaTier: 'mid', wombTier: 'empty' },         // 卵泡期
        { egg: true, sperm: true, vaginaTier: 'low', wombTier: 'empty' }, // 两者都在 ⇒ 精子游向卵子
        { fertilized: true, vaginaTier: 'max', wombTier: 'low' },      // 射满过 ⇒ 子宫里也有
        { sperm: true, vaginaTier: 'many', wombTier: 'mid' },
        { egg: true, vaginaTier: 'residue', wombTier: 'empty' },
        { vaginaTier: 'empty', wombTier: 'empty' },
    ][n];
}

/** 本人那份的样例事实：单人样例写的是「孕中期 孕 22 周 + 3 天」⇒ 孕期第 3 张 ✓ */
const DEMO_USER_FACTS = {
    // ★ 2026-10-30：孕期子宫那本恒空（宫颈被粘液栓封着，精液进不去）——
    //   样例也得是空，不然预览里凭空多出一份「孕期子宫：多」，看着像真的 ✗
    pregnant: true, implanted: true, vaginaTier: 'max', wombTier: 'empty',
    fetusWeekDays: 22 * 7 + 3,
};

/**
 * 单人预览：那份"双胎 + 异父 + 异种"的丰富样例（保持原样，别动它 ✓）
 *
 * 它同时把 `P` 挂在函数对象上（`demoPanelText.P`）—— 多人预览的每一份数据
 * 都从这份 P 派生（"示例角色数据不能都一样"，但又不能各自写一套 ✗）。
 */
export function demoPanelText() {
    const P = {
        title: '🌟 孕期健康监测',
        phase: '孕中期',
        sub: '孕 22 周 + 3 天',
        minor: '当前时间：3 月 14 日 上午 10:20 ｜ 当前防护：无 ｜ 近期风险：昨天内射（窗口内）',
        calc: '累计受孕率 120% 已锁定，受精成功（判定值 min(120%,100%) = 100%，掷出 33 ≤ 100%），着床完成于 Day22',
        d1: '不适用',
        d2: '120%',
        d3: '1.2',
        // ★ 改成**两份名单 ＋「（异卵异父）」**（跟真实那条一个形状：`@甲 @乙（异卵异父）`✓）
        //   ⚠️ 名字必须用**占位名家族**（示例致孕方·甲/乙）—— 预览里出现像真名的东西
        //     会让人以为是真数据 ✗，而且联系人样例用的就是这一套（点名才跳得过去 ✓）
        d4: '示例致孕方·甲、示例致孕方·乙（异卵异父）',
        // 挑「知晓致孕方」那一档：同一份样例里胎儿是双胎异父，意识状态要跟它对上
        // ★ A3 之后 d5 是「状态值 · 致孕方知情」两半拼的（前半截由插件算）⇒
        //   样例也得照这个形状写 ✓
        d5: '已确认怀孕 · 已知晓致孕方身份（示例致孕方·甲、示例致孕方·乙）',
        // 胎儿用插件自己的 buildFetus 拼 —— 面板要的是「概述 + 子N：…」这种结构，
        // 手写很容易写歪（面板会当成一段 summary，展示不出结构化内容）
        // 故意做成「双胎 + 异父 + 不同种族」—— 这样一趟就能看见：
        //   胎数、性别标签、致孕方、显性/隐性、以及异种那套配色
        d6: buildFetus('孕22周，胎动明显，均心跳有力；两胎发育不同步，狼人胎偏大', [
            { race: '半狼人', sex: '男', impregnator: '示例致孕方·甲', extra: '显性：银发褐瞳、狼耳狼尾 ｜ 隐性携带：人类血统' },
            { race: '人类', sex: '女', impregnator: '示例致孕方·乙', extra: '显性：黑发黑瞳 ｜ 发育正常' },
        ]),
        d7: '初乳已开始分泌，每日约 5ml',
        d8: '1 次（子1 顺产）',
        // ⚠️ 必须带「几级（累计刺激几）」—— 只写名字的话面板算不出等级，
        //   会显示成「共 0 处 · 平均 0.0 级」✗
        d9: '后颈 3级（累计刺激 55）｜耳后 2级（累计刺激 26）｜腰窝 1级（累计刺激 6）｜大腿内侧 2级（累计刺激 30）｜锁骨 1级（累计刺激 5）',
        row1: '子宫底升至脐上两指，胎动时可见腹部起伏；乳房胀大，乳晕颜色加深',
        row2: '面色红润，体温偏高约 0.3℃，久站后腰背略酸',
        row3: '昨夜 23:10 · 示例致孕方·甲 · 内射',
    };
    const PERIOD = {
        day: '第 3 天', flow: '中等', color: '暗红',
        texture: '少量细碎血块', pain: '轻微坠胀，热敷后缓解',
        desc: '腰酸、轻微乏力、食欲下降',
    };

    // 把这份 P 挂到函数对象上：多人预览的每一份数据都从它派生 ✓
    try { demoPanelText.P = P; } catch { /* 忽略 */ }

    // 预览要看到**所有**字段，所以临时把字段开关全打开，生成完再还原。
    // 不然用户关过哪几个，预览里就少了哪几行，看不出完整效果。
    const s = settings();
    const saved = JSON.stringify(s.fields || {});
    const forced = {};
    for (const k of ALL_FIELDS) forced[k] = true;
    s.fields = forced;
    try {
        return buildStatusProfile('月见 凛', P, PERIOD);
    } finally {
        s.fields = JSON.parse(saved);
    }
}

// ---------------- 小工具 ----------------

function kv(label, value) {
    return h('div', { class: 'bc-dump-kv' },
        h('span', { class: 'bc-dump-k', text: label }),
        h('span', { class: 'bc-dump-v', text: String(value ?? '—') }),
    );
}

function dumpJson(v, max = 4000) {
    let s;
    try { s = JSON.stringify(v, null, 2); } catch { s = String(v); }
    if (s && s.length > max) s = s.slice(0, max) + '\n…（太长，已截断）';
    return s || '—';
}

function jsonBlock(title, value, open = false) {
    const pre = h('pre', { class: 'bc-dump-pre', text: dumpJson(value) });
    if (!open) pre.style.display = 'none';
    const caret = h('span', { class: 'bc-sec-caret', text: open ? '▾' : '▸' });
    const head = h('div', { class: 'bc-dump-head', onclick: () => {
        const show = pre.style.display === 'none';
        pre.style.display = show ? '' : 'none';
        caret.textContent = show ? '▾' : '▸';
    } }, caret, h('span', { text: title }));
    return h('div', { class: 'bc-dump-block' }, head, pre);
}

function buildPanelShell() {
    const root = h('div', {
        class: 'bc-root', id: 'bc-root',
        'data-theme': settings().ui.theme || 'light',
        // 易读模式：跟 data-theme 同一套路子 ✓
        'data-vision': settings().visionMode === 'large' ? 'large' : 'normal',
        // ★ TauriTavern（TT）移动端的布局契约：显式声明"这是个全屏交互窗口" ⇒
        //   宿主会按 safe-area / 键盘（IME）契约帮我们修正几何（不用我们自己算）。
        //   TT 文档明确写着「推荐扩展显式写，别赌它的浮层分类器一定扫到」✓；
        //   这个属性在酒馆里没人读 ⇒ 对 ST 零影响 ✓
        'data-tt-mobile-surface': 'fullscreen-window',
    });

    // ★★ 这一格（`#bc-clock`，标题就写着"现实时间"）和它的样式一直都在，
    //   但**全仓没有任何地方给它填内容** ✗ ⇒ 所以那一格一直是空的（看着就像"没了" ✗）
    //   ⇒ 建面板时写一次，之后每 20 秒刷一次（就是**这台设备的真实时间** ✓）
    //   ⚠️ 定时器挂在元素自己身上（`clock._bcTimer`）⇒ 面板重建时先清掉旧的，不会越堆越多 ✓
    // ★ 给它**预置文字 `--:--`** —— 这一手同时是修法和诊断 ✓✓：
    //     · 看到 `--:--` ⇒ **元素在 DOM 里**（说明位置没问题），是下面那行刷新没跑起来 ✗
    //     · 看到 `13:40` ⇒ 全都好了 ✓
    //     · 还是什么都没有 ⇒ **元素压根没进 DOM** ⇒ 要去查 buildPanelShell 的执行路径 ✗
    //   （写成**空元素**的话：刷新一旦不跑，它就是个空的、什么都看不见的框 ✓
    //     ⇒ 先把它变成"看得见的东西" ✓）
    const clock = h('div', { class: 'bc-clock', id: 'bc-clock', title: '现实时间', text: '--:--' });
    const tickClock = () => {
        try {
            const d = new Date();
            const p2 = (n) => (n < 10 ? '0' : '') + n;
            clock.textContent = p2(d.getHours()) + ':' + p2(d.getMinutes());
        } catch { /* 忽略 */ }
    };
    tickClock();
    try {
        if (clock._bcTimer) clearInterval(clock._bcTimer);
        clock._bcTimer = setInterval(tickClock, 20000);
    } catch { /* 忽略 */ }

    // 顶部只留：品牌 + 齿轮 + 关闭。
    // 原来那排「状态 / 骰子 / 设置」标签撤了 ——
    // 骰子搬进聊天面板的侧栏（工具组），设置改成齿轮打开的覆盖页。
    const head = h('div', { class: 'bc-head' },
        h('div', { class: 'bc-brand' },
            h('span', { class: 'bc-brand-icon' }, deviceIcon(17)),
            h('span', { class: 'bc-brand-text', text: 'Bodycord' }),
        ),
        h('div', { class: 'bc-spacer' }),
        clock,
        // ★ 深色浅色模式那条提示词里，"（全插件统一）"这个废话可以删掉 ✓
        h('div', { class: 'bc-icon-btn', title: '深色 / 浅色', text: '🌓', onclick: toggleTheme }),
        // 这个按钮会变身：状态页是齿轮 ⚙️，设置页变成返回箭头 ←
        // （iOS / 聊天软件 的做法 —— 不需要额外多一条突兀的返回栏）
        h('div', {
            class: 'bc-icon-btn bc-nav-btn', id: 'bc-nav',
            onclick: () => showPane(settings().ui.openTab === 'settings' ? 'status' : 'settings'),
        }),
        h('div', { class: 'bc-icon-btn', title: '关闭', text: '✕', onclick: () => closePanel() }),
    );

    const panes = {
        status: h('div', { class: 'bc-pane', dataset: { pane: 'status' } }),
        settings: h('div', { class: 'bc-pane', dataset: { pane: 'settings' } }),
    };

    // ★ 被排除的角色卡**不在面板上占一条横条**（2026-10-28 她要"界面干净一点"）——
    //   恢复入口挪进悬浮球快捷菜单；设置页那边本来就有开关和清单 ✓

    const paneWrap = h('div', { class: 'bc-panes' }, panes.status, panes.settings);

    // ★★ 手机形态专用的「关闭」：顶栏那颗 ✕ 正好落在刘海 / 灵动岛 / 各种壳子顶栏盖住的位置，
    //   苹果手机上点不到 ⇒ 在**右下角**（拇指够得着、不会被顶栏挡）再放一颗，
    //   挂在外壳上（不在 iframe 里），层级压过面板内容 ✓。桌面形态不显示（CSS 管）
    const phoneClose = h('div', {
        class: 'bc-phone-close', title: '关闭面板', role: 'button', 'aria-label': '关闭面板',
        onclick: (e) => { try { e.stopPropagation(); } catch { /* 忽略 */ } closePanel(); },
    }, h('span', { text: '✕' }));

    root.appendChild(head);
    root.appendChild(paneWrap);
    root.appendChild(phoneClose);
    document.body.appendChild(root);

    // ★ 面板里那颗「关闭」（手机形态才有）要能叫回外壳：面板是同源 iframe ⇒ 直接挂个函数 ✓
    //   （TT 手机上外壳顶栏不一定显示，没有这个就只能困在面板里出不来了）
    try { window.__bodycordClosePanel = () => closePanel(); } catch { /* 忽略 */ }

    return { root, head, paneWrap, panes, clock, navBtn: head.querySelector('#bc-nav') };
}

// ★ 顺序：**非聊天页面显示、聊天里不显示**（聊天页面不需要，概览里有 ✓）
//   ⚠️ 反过来（只在真聊天里显示 ✗）的话，一直在非聊天页面看就永远看不到它 ✗
//   ⚠️ 教训：这个函数是**用 `els.clock` 引用元素**的 ⇒ 只 grep `bc-clock` 这个名字**搜不到它** ✗
//      （会误判成"全仓没有一处给它填内容" ✗）
function tickClock() {
    if (!els?.clock) return;
    // ⚠️ 写成 `inRealChat()`（**有正文的聊天** ✗）就会让聊天页面也显示它 ⇒
    //   **刚开、还没写正文的聊天**会被判成"不在聊天" ⇒ 钟照样显示 ✓
    //   ⇒ 换成 `inChatPage()`（**只要有聊天 id 就算在聊天页** ✓）—— 这正是项目里记过的那条坑：
    //      「『在不在聊天里』不能拿『有没有正文』凑数」✓
    // ★★ 2026-10-28：**被排除的角色卡是个例外** —— 那个卡里没有推演、标题栏也不会有
    //   「这一楼待推演」，右上角空着；她要看现实时间就从这儿给 ✓
    //   （正常卡里照旧藏起来：聊天里那块位置留给推演状态，概览里另有时间 ✓）
    if (inChatPage() && !isCardExcluded()) {
        els.clock.textContent = '';
        els.clock.style.display = 'none';
        return;
    }
    els.clock.style.display = '';
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    els.clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    els.clock.title = `现实时间 ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.getHours()}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 页签
// ---------------------------------------------------------------------------

// 悬浮窗里那份状态视图（只有一份，单独拿个变量指住）
let floatView = null;
let previewMode = false;   // 是否正在用样例数据预览（临时功能）
let previewMulti = false;  // 预览是不是"多人追踪"那种样子（双模式预览）
// 多人预览时"正在看哪一个样例对象" —— ⚠️ 绝不能借用真实的 state().active：
// 样例名字不是真实对象，setActive() 会直接拒绝 ⇒ 点了没反应、九个人看着一模一样 ✗
let previewActiveKey = null;
// ⚠️ `previewBarOpen` 跟着"面板顶上那条预览条"一起删了（预览挪去
//   设置 → 常规 → 诊断与数据）⇒ 别再把它加回来 ✗

/** 现在只剩两个页面：状态 / 设置 */
const KNOWN_PANES = ['status', 'settings'];

function showPane(tab) {
    const s = settings();
    // ⚠️ 老设置里可能还存着 'dice'（那个页签已经搬进聊天面板侧栏了）。
    //   不兜底的话一个页面都匹配不上，面板会整个空白。
    const next = KNOWN_PANES.includes(tab) ? tab : 'status';
    s.ui.openTab = next;
    save();
    for (const [id, el] of Object.entries(els.panes)) el.classList.toggle('active', id === next);

    syncNavButton(next);

    if (next === 'status') {
        ensureFloatStatusView();
        // 已经是建好的那份 ⇒ 切回来再让它按当前尺寸重排一次（兜底 ✓）
        if (floatView) nudgePanelLayout();
    } else renderSettingsPane();
}

/**
 * 建出悬浮窗里那份状态视图。
 *
 * ⚠️ 以前这里判的是 `statusViews.some(v => !v.inline)`。
 *   后来 StatusView 不再有 inline 属性了，`!undefined` 永远为真 ——
 *   于是这个函数每次都提前 return，**主面板再也没被创建过**，打开就是一片空白。
 *   现在改成用一个专用变量指住，逻辑直白，不会再被属性改名带崩。
 */
/** 顶部那个按钮跟着当前页变身 */
function syncNavButton(pane) {
    const b = els?.navBtn;
    if (!b) return;
    const onSettings = pane === 'settings';
    b.textContent = onSettings ? '←' : '⚙️';
    b.title = onSettings ? '返回状态面板' : '设置';
    b.classList.toggle('bc-nav-back', onSettings);
}

/**
 * ★ 让 iframe 里的面板按**现在的**尺寸重排一次（2026-10-22 她报的"从左上角挪到正常位置"）——
 *   面板本体住在 iframe 里；只要它是"还看不见 / 宽度接近 0"的时候建好的，
 *   iframe 内部就会先按 0 宽排一遍版，等切过去有尺寸了再重排 ⇒ 看着像内容从左上角滑进来 ✗
 *   ⚠️ 光派一个 resize 事件没用：重排是被**容器的真实尺寸**驱动的
 *   ⇒ 把 iframe 宽度改掉一点点、读一次布局、再改回去，强制它内部重算 ✓
 */
function nudgePanelLayout() {
    const nudge = () => {
        for (const v of statusViews) {
            const f = v?.panel?.iframe;
            if (!f || !f.isConnected) continue;
            try {
                const old = f.style.width;
                f.style.width = '99.99%';
                void f.offsetWidth;          // 读一次布局 = 强制同步排版
                f.style.width = old || '100%';
            } catch { /* 忽略 */ }
        }
    };
    try { requestAnimationFrame(() => requestAnimationFrame(nudge)); } catch { /* 忽略 */ }
}

let _pendingFloatView = false;

function ensureFloatStatusView() {
    if (floatView) return;
    // ★ 容器还没排布出来（宽度 0 / 还没挂在文档上）⇒ 等下一帧再建（2026-10-22 ✓）
    const pane = els?.panes?.status;
    const ready = (() => {
        try { return !!(pane && pane.isConnected && pane.getBoundingClientRect().width >= 1); }
        catch { return false; }
    })();
    if (!ready) {
        if (_pendingFloatView) return;
        _pendingFloatView = true;
        try {
            requestAnimationFrame(() => { _pendingFloatView = false; ensureFloatStatusView(); });
        } catch { _pendingFloatView = false; }
        return;
    }
    floatView = new StatusView(pane, { head: els.head });
    statusViews.push(floatView);
    floatView.render();
    nudgePanelLayout();
}

/**
 * ★ 这一页**真正在滚的那个元素**是谁 —— 见 `dom.js` 的 `scrollerOf` 说明。
 * 设页里的用法：重画一页之前先 `scrollTopOf()` 记下来，画完 `setScrollTopOf()` 放回去，
 *   不然清空那一刻滚动位置被夹回 0，画面就弹回顶上 ✗（点「载入」那种按钮之后会这样）
 */

function renderSettingsPane(force = false) {
    const pane = els.panes.settings;
    if (pane.dataset.ready === '1' && !force) return;
    // ★ 整页重建也要**记住原来那个内容容器滚到哪了**（换角色 / 换人设触发的重画同理 ✓）
    const keepScroll = scrollTopOf(pane.querySelector('.bc-setcontent'));

    clear(pane);

    // 返回入口在顶部那个变身按钮上（状态页是⚙️，设置页是←），
    // 所以这里不再需要额外一条返回栏 —— 之前那条浮在页签上面很突兀。
    const sub = h('div', { class: 'bc-setnav' });
    const content = h('div', { class: 'bc-setcontent' });
    const wrap = h('div', { class: 'bc-pane-inner bc-setlayout' }, sub, content);
    pane.appendChild(wrap);

    // 左侧竖排 + 分组（DC 那种排版；分组是为了"以后还会加很多东西"）
    const SUBS = [
        // ★「角色基础信息」自己占一个页签
        //   （推演与追踪不适合放角色基础信息 ⇒ 单独开一个 ✓）
        // ⚠️ 这一页只服务"你自己" ⇒ 跟页内标题统一成「用户角色基础信息」✓
        ['基础', [['general', '常规'], ['calendar', '时间与日历'], ['basicInfo', '用户角色基础信息'], ['avatar', '头像外观'], ['stages', '阶段插图']]],
        // 这一组装的是两样东西：**给 AI 的规则**（规则补丁）+ **推演结果的记录**（记录档案）
        //   ⇒ 名字「补丁与档案」（小项：规则补丁 / 记录档案 ✓）
        ['补丁与档案', [['modules', '规则补丁'], ['archive', '记录档案'], ['ach', '成就记录']]],
        // ★ 设置里面的推演与追踪拆成两个：一个是推演、一个是追踪 ✓
        ['推演', [['judge', '推演'], ['tracking', '追踪']]],
    ];
    const show = (which, keepScroll = false) => {
        // 点恢复默认之后还是折叠起来（重启酒馆也没好）——
        //   根因不止是段落内部重画：有些按钮走的是**整页重画**（`rebuild()` → `show()`），
        //   而"展开 / 收起"是每张卡自己记的状态 ⇒ 整页重建之后全回到默认（有的默认就是收起）✗
        //   ⇒ 同一页重画时，先按标题记下每张卡的展开状态，画完放回去；
        //     换左侧小项 = 换页 ⇒ 不迁延（新一页从它的默认来 ✓）

        for (const el of sub.querySelectorAll('.bc-setnav-item')) el.classList.toggle('active', el.dataset.sub === which);
        settings().ui.settingsSub = which;
        save();
        // ★ 同一页重画（开关、载入预设、保存正文…）⇒ **保住滚动位置** ✓
        //   换左侧小项 ⇒ 从顶上开始（新一页，接着上次的位置反而莫名其妙 ✓）
        const keep = keepScroll ? scrollTopOf(content) : 0;
        const rebuild = () => { refreshAll(); show(which, true); };
        const refresh = () => refreshAll();
        if (which === 'modules') renderModulesTab(content, { refresh, rebuild });
        else if (which === 'judge') renderJudgeTab(content, refresh, rebuild, { openTab });
        else if (which === 'tracking') renderTrackingTab(content, refresh, rebuild);
        else if (which === 'basicInfo') renderBasicInfoTab(content, refresh, rebuild);
        else if (which === 'calendar') renderCalendarTab(content, refresh, rebuild, {
            // ★ 气泡预览归时间与日历这一页 ✓
            //   不挂在常规页的「诊断与数据」卡上 ⇒ 现在跟那句自定义提醒词住同一页 ✓
            previewBubble: () => previewReminderBubble(),
        });
        else if (which === 'avatar') renderAvatarTab(content, refresh, rebuild, {
            // ★ 这一页里也有**番茄钟那颗球的头像** ⇒ 换完顺手把球重画一次，
            //   别让玩家以为"要刷新才生效"（换皮肤时必须能直接生效 ✓）
            onFabChange: () => { applyFabLook(); try { applyTimer(); } catch { /* 忽略 */ } },
        });
        // ★★ 「阶段插图」自己一个分类（头像外观里拆出来的）——
        //   内容跟原来一模一样，只是不再和头像挤在一页 ✓
        else if (which === 'stages') renderStagesTab(content, refresh, rebuild, {
            // 阶段插图改了（开关 / 换图）⇒ 让面板立刻跟上 ✓
            onStagesChange: refresh,
        });
        else if (which === 'archive') renderArchiveTab(content, { refresh, rebuild });
        else if (which === 'ach') renderAchTab(content, { refresh, rebuild });
        else renderSettingsTab(content, refresh, rebuild, {
            toggleTheme, resetPanelPosition, resetFabPosition,
            onFabChange: applyFabLook,
            openDiag: () => openDiagPanel(),
            // ★ 预览入口**搬到这一页了**（预览的按钮挤到它了，先挪到排查那里）——
            //   原来面板顶上挂着一条预览条（会挤名字栏 / 挤状态条 ✗），现在只在
            //   「设置 → 常规 → 诊断与数据（排查用）」那一块点 ✓
            //   ⚠️ 点了**不许跳页**：一跳走玩家就看不到按钮文案变了（开着时要写：退出预览 ✓）
            //   也**不许顺手切回状态页** —— 玩家在这儿点完再自己回状态页看效果 ✓
            togglePreview: () => {
                try { statusViews[0]?.togglePreview?.(); } catch { /* 忽略 */ }
                try { rebuild(); } catch { /* 忽略 */ }
            },
            togglePreviewMulti: () => {
                try { statusViews[0]?.togglePreviewMulti?.(); } catch { /* 忽略 */ }
                try { rebuild(); } catch { /* 忽略 */ }
            },
            // 那一块要显示"现在是哪种预览"（按钮文案跟着状态走 ✓）
            previewState: () => ({ mode: previewMode, multi: previewMulti }),
            // ★ **做一个可以直接预览的按钮** ✓
            //   （预览那颗气泡多一个「预览」小标，关了也不写"提示过了"的账 ✓）
            previewBubble: () => previewReminderBubble(),
            snapPanelTop: () => snapPanel('top'),
            snapPanelBottom: () => snapPanel('bottom'),
        });

        setScrollTopOf(content, keep);
    };
    for (const [group, items] of SUBS) {
        sub.appendChild(h('div', { class: 'bc-setnav-group', text: group }));
        for (const [id, label] of items) {
            sub.appendChild(h('div', {
                class: 'bc-setnav-item', dataset: { sub: id }, text: label,
                onclick: () => show(id),
            }));
        }
    }

    show(settings().ui.settingsSub || 'general');
    setScrollTopOf(content, keepScroll);
    pane.dataset.ready = '1';
}

// ---------------------------------------------------------------------------
// 编辑
// ---------------------------------------------------------------------------

function currentTarget() {
    const s = state();
    return s.targets?.[s.active] || targetList()[0] || null;
}

/**
 * d6 的结构化编辑：一行一个**胎儿**（种族 / 性别 / 致孕方 / 备注），第二行是孕期与预产期。
 * 改表格会**直接写回调用方给的那个载体**（改数值里是上面那个 d6 文本框，孩子页里是一个代理对象），
 * 所以保存逻辑不用动 ✓
 *
 * ⚠️ 这里的对象叫**胎儿**（还在肚子里的那一个）；已经出生的那些在「孩子」那一段里 ✓
 *   （两个东西别共用一个词 ——：胎儿也是孩子但界面上一处只能有一个叫法 ✓）
 * ⚠️ `d6Input` 只要求是个"有 `.value` 的对象"（文本框 / 代理都行）✓
 */
/**
 * 「来源 / 分批」编辑器（含植入方）—— 2026-10-14。
 *
 * **为什么要有它**：玩家点着「胎儿 / 孩子」那一页强调过 ✓ ⇒ 这一节**两处都要有**：
 *   ①「改数值 → 既成事实（官方修改器）」；②「胎儿 / 孩子」那页的胎儿段下面
 *   （卵群那种几十上百枚，就在这儿按批填 ✓）
 *
 * 口径：**按批**（前一批后一批），**不逐个**；它只管：这批是谁的这个归属 / 显示，
 *   判定（受精成不成 / 受孕率 / 胎数 / 性别）一个字都不参与 ✓
 *
 * @param {string} key 哪个对象
 * @param {Function} after 每次改完之后做的事（两处的刷新方式不一样 ⇒ 由调用方给 ✓）
 */
function buildSourceEditor(key, after) {
    const done = () => { try { after?.(); } catch { /* 忽略 */ } };
    const say = (ok, msg) => window.toastr?.[ok ? 'success' : 'warning']?.(msg);
    const byIn = textInput('', () => {}, { placeholder: '例：触手一 / 示例角色·甲' });
    const countIn = textInput('', () => {}, { placeholder: '例：40（只有一个来源时可留空）' });
    const hint = h('div', { class: 'bc-hint' });
    const list = h('div', {});
    const entryOf = () => { try { return impregnatorSourceOf(key); } catch { return null; } };
    const partsOf = () => {
        const e = entryOf();
        return (e && e.manual === true && Array.isArray(e.parts)) ? e.parts.map((p) => ({ ...p })) : [];
    };
    const save = (parts) => {
        if (!parts.length) { setImpregnatorSourceOf(null, key); return; }
        const text = parts.map((p) => (p.count ? `${p.by} ${p.count} 枚` : `植入方：${p.by}`)).join('、');
        setImpregnatorSourceOf({ text, parts, manual: true, at: Date.now() }, key);
    };
    const paint = () => {
        const parts = partsOf();
        const e = entryOf();
        list.textContent = '';
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            list.appendChild(h('div', { class: 'bc-row' },
                h('span', { text: (p.by || '') + (p.count ? ` · ${p.count} 枚` : '') }),
                h('div', { class: 'bc-row-end' },
                    button('删掉', () => {
                        const nx = partsOf();
                        nx.splice(i, 1);
                        save(nx);
                        paint();
                        done();
                    }, { variant: 'danger', title: '删掉这一批' })),
            ));
        }
        const total = parts.reduce((n, p) => n + (Number(p.count) || 0), 0);
        if (parts.length) {
            hint.textContent = `现在：${sourceTextOf(e)}` + (total ? `（共 ${total} 枚）` : '');
            return;
        }
        const engineTxt = String((e && e.manual !== true) ? (e.text || '') : '').trim();
        hint.textContent = engineTxt
            ? `引擎报的：${engineTxt}（要改成你自己填的，就用上面两格加一批）`
            : '还没有来源标注（引擎没报，你也没填）';
    };
    const addOne = () => {
        const by = String(byIn.value || '').trim();
        if (!by) { say(false, '先写清楚这一批是谁的'); return; }
        const cntTxt = String(countIn.value || '').trim();
        let count = null;
        if (cntTxt) {
            const n = Math.round(Number(cntTxt));
            if (!Number.isFinite(n) || n < 1) { say(false, '数量要填大于 0 的整数（只有一个来源时可以留空）'); return; }
            count = n;
        }
        const parts = partsOf();
        // ★ 多个来源就必须各写数量 —— 不然后面分不出"谁归第几批"（`sourceOwnerOf` 要有数才排得出）
        if (parts.length && count === null) { say(false, '多个来源要写清各是多少枚'); return; }
        parts.push({ by, count });
        save(parts);
        byIn.value = ''; countIn.value = '';
        paint();
        done();
        say(true, `记了一批：${by}` + (count ? ` ${count} 枚` : ''));
    };
    const clearAll = () => {
        save([]);
        paint();
        done();
        say(true, '清掉了：之后照引擎报的走');
    };
    const wrap = h('div', {},
        h('div', { class: 'bc-label bc-src-title', text: '来源 / 分批（这一胎、或者这批卵是谁的）' }),
        h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '1 1 180px' } }, field('这一批是谁', byIn)),
            h('div', { style: { flex: '0 1 130px' } }, field('多少枚', countIn)),
            h('div', { class: 'bc-row-end' },
                button('加一批', addOne, { title: '按批记：前一批是谁、后一批是谁（几十上百枚不逐个填 ✓）' }),
                button('清掉 / 交回插件', clearAll, { variant: 'danger', title: '清掉你填的，之后照引擎报的走' })),
        ),
        hint,
        list,
    );
    paint();
    return wrap;
}

function buildFetusEditor(d6Input, draft) {
    const wrap = h('div', { class: 'bc-fetus-editor' });
    let { head, kids } = parseFetus(d6Input.value);

    const headInput = textInput(head, (v) => { head = v; sync(); },
        { placeholder: '例：双胎 · 孕10周，均心跳有力' });

    const tableHost = h('div', { class: 'bc-zone-table' });

    function sync() {
        d6Input.value = buildFetus(head, kids);
        draft.d6 = d6Input.value;
    }

    function rebuild() {
        clear(tableHost);
        if (!kids.length) {
            tableHost.appendChild(h('div', { class: 'bc-hint', text: '还没有胎儿。点下面「＋ 添加一个胎儿」' }));
        }
        kids.forEach((k, i) => {
            const block = h('div', { class: 'bc-fetus-kid' });
            const row = h('div', { class: 'bc-zone-row' });
            const cell = (key, ph, flex) => {
                const inp = textInput(k[key] || '', (v) => { k[key] = v; sync(); }, { placeholder: ph });
                inp.classList.add('bc-zone-cell');
                row.appendChild(h('div', { class: 'bc-zone-field', style: { flex } }, inp));
            };
            row.appendChild(h('div', { class: 'bc-zone-field bc-fetus-idx', style: { flex: '0 0 34px' },
                text: String(i + 1) }));
            cell('race', '狼人', '1fr');
            cell('sex', '男', '.7fr');
            cell('impregnator', '例：示例角色·甲', '1.2fr');
            // ★ 这一格是**自由尾巴**：显性外貌和隐性携带都写在这儿（模块规定的格式）——
            //   隐性呢？，其实能填、只是原 placeholder 只举了显性 ✗
            //   ⇒ 例子改成"两样都举"，跟项目里已有的样例格式对齐（用 ｜ 分隔）✓
            // ★ 「显性外貌 / 隐性携带」界面上分两格 —— 见下面 `herRow`（**数据还是一段** ✓）

            row.appendChild(h('div', { class: 'bc-zone-op' },
                h('div', {
                    class: 'bc-icon-btn', title: '删掉这个胎儿',
                    text: '✕',
                    onclick: () => { kids.splice(i, 1); sync(); rebuild(); },
                })));
            block.appendChild(row);
            // ★ 第二行：孕期 / 预产期 —— **格式只有剧情/种族表知道**，所以给输入框 + 例子，
            //   别让玩家自己去猜那串怎么写（玩家不知道什么格式合适 ✓）
            const row2 = h('div', { class: 'bc-zone-row bc-fetus-row2' });
            for (const [key, label, ph, flex] of [
                ['gest', '孕期', '例：12-15 个月', '1fr'],
                ['due', '预产期', '例：1年09月12日', '1.2fr'],
            ]) {
                const inp = textInput(k[key] || '', (v) => { k[key] = v; sync(); }, { placeholder: ph });
                inp.classList.add('bc-zone-cell');
                row2.appendChild(h('div', { class: 'bc-zone-field bc-fetus-lab', style: { flex: '0 0 auto' }, text: label }));
                row2.appendChild(h('div', { class: 'bc-zone-field', style: { flex } }, inp));
            }
            block.appendChild(row2);
            // ★ 「显性外貌 / 隐性携带」**界面上分两格**——
            //   ⚠️ **只是界面分两格，数据还是一段**（`extra` 那串自由尾巴）✓
            //   拆 / 拼走 `fetus.js` 的 `splitHeritage` / `joinHeritage`（认不出的余项原样留着 ✓）
            const herRow = h('div', { class: 'bc-zone-row bc-fetus-row2' });
            for (const [hk, label, ph, flex] of [
                ['dom', '显性外貌', '例：银发褐瞳', '1fr'],
                ['rec', '隐性携带', '例：人类血统', '1fr'],
            ]) {
                const cur = splitHeritage(k.extra || '')[hk];
                const inp = textInput(cur, (v) => {
                    const p = splitHeritage(k.extra || '');
                    p[hk] = v;
                    k.extra = joinHeritage(p);      // ⇒ 还是**同一段**写回 d6 ✓
                    sync();
                }, { placeholder: ph });
                inp.classList.add('bc-zone-cell');
                herRow.appendChild(h('div', { class: 'bc-zone-field bc-fetus-lab', style: { flex: '0 0 auto' }, text: label }));
                herRow.appendChild(h('div', { class: 'bc-zone-field', style: { flex } }, inp));
            }
            block.appendChild(herRow);
            // ★ 2026-10-24：第三格「天赋」——
            //   职业 / 身份 / 训练出来的感知与耐受都归这里，写成一整句话（句子里本来就有逗号，所以单独一格）
            const talRow = h('div', { class: 'bc-zone-row bc-fetus-row2' });
            {
                const inp = textInput(k.talent || '', (v) => { k.talent = v; sync(); },
                    { placeholder: '例：从一方完整继承暗杀者的手感' });
                inp.classList.add('bc-zone-cell');
                talRow.appendChild(h('div', { class: 'bc-zone-field bc-fetus-lab', style: { flex: '0 0 auto' }, text: '天赋' }));
                talRow.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '1fr' } }, inp));
            }
            block.appendChild(talRow);
            // ★ 2026-10-24：第四格「强度」—— 跟天赋内容分开（内容由模型写，强度由插件按档位填）
            const stgRow = h('div', { class: 'bc-zone-row bc-fetus-row2' });
            {
                const inp = textInput(k.strength || '', (v) => { k.strength = v; sync(); },
                    { placeholder: '例：起点高于亲代' });
                inp.classList.add('bc-zone-cell');
                stgRow.appendChild(h('div', { class: 'bc-zone-field bc-fetus-lab', style: { flex: '0 0 auto' }, text: '强度' }));
                stgRow.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '1fr' } }, inp));
            }
            block.appendChild(stgRow);
            tableHost.appendChild(block);
        });
    }

    wrap.appendChild(h('div', { class: 'bc-label', text: '每个胎儿单独填（改完自动同步，不用手打那串格式）' }));
    wrap.appendChild(h('div', { class: 'bc-fetus-head' },
        h('span', { class: 'bc-hint', text: '概述' }), headInput));
    wrap.appendChild(tableHost);
    // 按钮和说明**分两行**放。原来挤在同一行，说明文字太长会把按钮压扁
    // （中文的 min-content 就一个字，一压就竖排）。
    wrap.appendChild(h('div', { class: 'bc-row' },
        h('div', {
            class: 'bc-icon-btn bc-add-btn', title: '添加一个胎儿',
            text: '＋ 添加一个胎儿',
            onclick: () => {
                kids.push({ race: '', sex: '', impregnator: '', extra: '', gest: '', due: '', talent: '', strength: '' });
                sync(); rebuild();
            },
        }),
    ));
    wrap.appendChild(h('div', { class: 'bc-hint', text: '致孕方直接填在这一行上，就绑定了；多胎各填各的' }));
    wrap.appendChild(h('div', { class: 'bc-hint', text: '孕期：人类留空就行（系统按 280 天算）。异种要自己填，按你设定里那个种族的孕期长度填，例如 12-15 个月。预产期只有剧情明确写了才填，平时留空由系统算' }));

    rebuild();
    return wrap;
}

/**
 * 「既成事实」区 —— **官方修改器**的后半段。
 *
 * 玩家的要求（2026-10-14）：如果有人开局设定就是怀着某个人的孩子，而那个人不会出场
 *   （比如已经死了），玩家只能手动添加；**就算引擎真判得出来，那也该出一个保底的后门** ✓
 *   ⇒ 因为"开局就怀着"这种事**流程永远跑不到**（没有内射事件 ⇒ 没有受精判定 ⇒ 永远切不了孕）✗
 *
 * 管四件：
 *   ① **设为已孕**（孕周 / 起点日期 ＋ 致孕方可选）——
 *      写受精判定 ＋ `Is_Pregnant` ＋（填了名字就写致孕方锁定）＋ 作废上一胎的胎数判定
 *   ② **设为已受精（待着床）**—— 只写判定，孕由插件自己按着床日切 ✓
 *   ③ **设为未孕（撤销）**—— 连判定一起撤（不撤的话下一轮 `syncPregnancyState` 又切回来 ✗）
 *   ④ **手加一条成就**
 * ⚠️ 只写插件自己的账（`chat_metadata`）：不碰正文、不碰聊天文件 ✓
 * ⚠️ 造孕用的是"**孕周**"这条口径：孕天数 ＝ 周期第几天（day 30 ⇒ 孕4周+2天 ✓）
 */
function buildKnownFactsBox(t) {
    const key = t.key;
    const weeksIn = textInput('', () => {}, { placeholder: '例：10（就是孕10周）' });
    const startIn = textInput('', () => {}, { placeholder: '例：1年08月01日（最后一次月经那天，也就是周期第 1 天）' });
    const fatherIn = textInput('', () => {}, { placeholder: '例：示例角色·甲（可以是没建档的、已经不在场的人）' });
    const achName = textInput('', () => {}, { placeholder: '例：初次生产' });
    const achWhy = textInput('', () => {}, { placeholder: '例：第一个孩子出生' });
    const achQuip = textInput('', () => {}, { placeholder: '例：疼死我了，但值得' });
    // ★ 造精子批次 / 手加痕迹（先做这俩）
    const insBy = textInput('', () => {}, { placeholder: '例：示例角色·甲（可以是没建档的人）' });
    const insLife = textInput('', () => {}, { placeholder: '例：3（留空＝按设置掷 1~3）' });
    // ★ 2026-10-24：意识状态的手动保底（她报：没人知道怀孕，面板却写成已确认）
    const man0 = awarenessManualOf(key);
    const knowIn = textInput(man0.knownName ?? '', (v) => {
        try { setAwarenessManualOf(key, { knownName: String(v || '').trim() }); } catch { /* 忽略 */ }
    }, { placeholder: '例：那个人；留空＝尚未知晓' });

    const today = () => { try { return currentDate() || ''; } catch { return ''; } };
    const say = (ok, msg) => window.toastr?.[ok ? 'success' : 'warning']?.(msg);
    const finish = () => {
        try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
        commit();
        refreshAll();
    };

    // ---- 性行为记录：按对象分组，整块可折叠（越玩越多，默认收起 ✓）----
    //   ★ 2026-10-30 ——
    //     原来叫「已有的内射记录（按致孕方分类）」⇒ 名字和内容对不上：
    //     里面装的是性行为（有没有射精都在这），不是只看内射 ✗
    const insemHost = h('div', {});
    const drawInsemList = () => {
        clear(insemHost);
        let mine = [];
        try { mine = listInseminations().filter((x) => String(x.target || '') === String(key)); } catch { /* 忽略 */ }
        if (!mine.length) {
            insemHost.appendChild(h('div', { class: 'bc-hint', text: '这个对象现在没有记录' }));
            return;
        }
        // 新的在前；按 `by`（致孕方）分组，组的先后＝这个组最近一笔的先后 ✓
        const groups = new Map();
        for (const x of mine.slice().reverse()) {
            const who = String(x.by || '').trim() || '未标注';
            if (!groups.has(who)) groups.set(who, []);
            groups.get(who).push(x);
        }
        insemHost.appendChild(h('div', {
            class: 'bc-hint',
            text: '共 ' + mine.length + ' 笔，按致孕方分组，最新的在上面（点每一笔右边的 ✕ 删掉它）',
        }));
        for (const [who, list] of groups) {
            const box = h('div', { class: 'bc-insem-group' },
                h('div', { class: 'bc-insem-group-head' },
                    h('span', { class: 'bc-label', text: who }),
                    h('span', { class: 'bc-hint', text: ' · ' + list.length + ' 笔' }),
                    h('div', { class: 'bc-spacer' }),
                ),
            );
            for (const x of list) {
                box.appendChild(h('div', { class: 'bc-row bc-insem-row' },
                    h('div', { style: { flex: '1 1 auto', fontSize: '12.5px' },
                        text: '第 ' + (x.round ?? '—') + ' 轮 · 第 ' + (x.depositDay ?? '—') + ' 天 · '
                            + (x.note || '（无备注）')
                            + ' · 贡献 ' + (x.contrib ?? '—') + '%' }),
                    button('✕ 删掉这笔', async () => {
                        const yes = await askConfirm({
                            title: '删掉这笔记录？',
                            msg: '会把这一笔从账上删掉，连它加进累计受孕率的那点也一起撤。\n\n'
                                + '删掉之后插件会记住这一笔：模型以后再把同一笔报上来（它常照着自己写过的旧条目抄）也不会入账 ✓\n\n'
                                + '这一步不动正文，也不能靠撤销推演回退。',
                            okText: '删掉这笔',
                            danger: true,
                        });
                        if (!yes) return;
                        const ok = (() => { try { return removeInsemination(x.key); } catch { return false; } })();
                        if (!ok) { say(false, '这一笔已经不在账上了'); drawInsemList(); return; }
                        // ★★ 2026-10-18（手动补的没有增加）：账变了要**当场把 d2 重算一遍**，
                        //   不然面板那行「累计受孕率」还停在补之前的数字 ✗
                        try { resnapProfileField(key, 'd2'); } catch { /* 忽略 */ }
                        say(true, '已删掉这一笔（以后同一笔再报也不会入账）');
                        finish();
                        drawInsemList();
                    }, { title: '删掉这一笔，并记住它是误报' }),
                ));
            }
            insemHost.appendChild(box);
        }
    };
    // 先把列表画好（`insemHost` 上面已经建好，return 那棵树只是引用它 ✓）
    drawInsemList();

    // ★★ 2026-10-18（记录改成可折叠、按对象分组，不然越叠越多）——
    //   整块默认收起；展开后按对象分组，组内最新的在上 ✓
    // ★ 2026-10-30：标题从「内射记录」改成「性行为记录」（她点的：这里记的是性行为）✓
    const insemSec = section('性行为记录（按对象分组）', {
        collapsible: true,
        open: false,
        help: [
            '按致孕方分组：同一个人的记录收在一组，组标题右边写着这个人一共几笔',
            '组和组之间、组内都是最新的在上面',
            '点每一笔右边的「✕ 删掉这笔」才会删；删掉之后模型再报同一笔也不会入账',
            '「✕」删的是这一笔账，不动正文；它加进累计受孕率的那点会一起撤',
        ],
    });
    insemSec.querySelector('.bc-section-body').appendChild(insemHost);

    /** 孕天数：优先"起点日期"算出来的，其次按玩家填的孕周反推 ✓ */
    const daysOf = () => {
        const start = String(startIn.value || '').trim();
        if (start) {
            if (!parseFictionDate(start)) { say(false, '起点日期认不出来，照「1年08月01日」这样写'); return null; }
            const n = (() => { try { return diffDays(start, today()); } catch { return null; } })();
            if (n === null || n < 0) { say(false, '起点日期不能比今天晚（那是未来的事）'); return null; }
            return n + 1;
        }
        const w = Number(String(weeksIn.value || '').trim());
        if (Number.isFinite(w) && w > 0) return Math.round(w * 7);
        return null;
    };

    const setPregnant = (mode) => {
        // 新的一胎 / 撤销：手动意识状态是上一胎的，一起交回自动 ✓
        try { clearAwarenessManualOf(key); } catch { /* 忽略 */ }
        const day = daysOf();
        if (day !== null && day > 0) { try { setCycleDayOf(key, day, today()); } catch { /* 忽略 */ } }
        if (!t.vars || typeof t.vars !== 'object') t.vars = {};
        if (mode === 'off') {
            clearOvuJudgmentOf(key);
            t.vars.Is_Pregnant = 'false';
            // ★ 2026-10-23：**判定整条撤掉** ⇒ 里面那条"着床成功"也跟着没了
            //   （她追问"是不是推演一次就把成功率锁死了"——撤销之后必须重新掷 ✓）
            try { setFetusPlanOf(key, null); } catch { /* 忽略 */ }
            clearProfileFix(key, 'd6', { silent: true });
            // ★ 2026-10-23（她报：设为未孕后面板 / 气泡还挂着怀孕）——
            //   胎儿行（d6）与这一胎的血脉标记也得归零；只撤孕不撤这些，
            //   面板就是"未孕 + 单胎；子1…"的自相矛盾状态 ✗
            try {
                if (t.profile && typeof t.profile.d6 === 'string') {
                    const d6 = t.profile.d6.trim();
                    if (d6 && d6 !== '无' && d6 !== '未加载') t.profile.d6 = '无';
                }
            } catch { /* 忽略 */ }
            try {
                delete t.fetusPlanPending;
                delete t.heritageDone;
                delete t.heritageTry;
                delete t.heritageGiveUp;
                delete t.heritageRolls;
                if (t.vars && t.vars.impregnator_side != null) delete t.vars.impregnator_side;
            } catch { /* 忽略 */ }
            // ★ 2026-10-23（她报：设为未孕后气泡还挂着"已着床完成"）——
            //   那段提醒是"未读提醒"，不撤掉的话硬刷新也会再弹 ✗
            try { dropConceiveAlerts(key); } catch { /* 忽略 */ }
            // ★ 冻结：设为未孕之后，时间同步 / 自动结算 / 切分支恢复候选都不许再把孕带回来；
            //   只有她自己点一次推演才解冻（judge 那边会清 ✓）
            try { state().conceiveHold = true; } catch { /* 忽略 */ }
            finish();
            // ★ 2026-10-23：**回读一次**，把"到底写进去没有"直接说给她看
            //   （她连着两次报"没用"，靠猜没用；这一句能把对象键和实际值摊出来 ✓）
            try {
                const now = String(state().targets?.[key]?.vars?.Is_Pregnant ?? '');
                if (now.toLowerCase() === 'true') {
                    say(false, '没写进去：' + displayName(t) + ' 现在还是已孕（对象键 ' + key + '）');
                } else {
                    say(true, '已设为未孕：判定和那一胎的胎数都撤了');
                }
            } catch { say(true, '已设为未孕：判定和那一胎的胎数都撤了'); }
            return;
        }
        // ① 判定：passing=true ＋ 着床 6 天（引擎那条路也是这个数 ✓）
        //   ★ 「没着床」那一档多写一个 `implantPassed:false` —— 判定链照旧，只是这个周期不会孕 ✓
        const judg = { passed: true, implantDays: 6 };
        if (mode === 'noimplant') judg.implantPassed = false;
        // ★ 2026-10-23：「设为已受精（待着床）」的承诺是"到日子自己切孕"。
        //   但设置成「受精时就掷」时 `settleImplantFor` 不掷 ⇒ 没人会给结果 ⇒ 永远不切孕 ✗
        //   ⇒ 这一档下当场补一个"通过"，保持它的承诺 ✓
        if (mode === 'implant') {
            try { if (settings().implantJudgeOnDay === false) judg.implantPassed = true; } catch { /* 忽略 */ }
        }
        setOvuJudgment(judg, key);
        // ② 致孕方（可选）
        const nm = String(fatherIn.value || '').trim();
        if (nm) { try { setImpregnatorLocksOf(key, [{ impregnator: nm }]); } catch { /* 忽略 */ } }
        // ③ 换了一胎 ⇒ 上一胎的胎数 / 性别判定作废（下一轮插件会按新的一胎重掷 ✓）
        try { setFetusPlanOf(key, null); } catch { /* 忽略 */ }
        clearProfileFix(key, 'd6', { silent: true });
        if (mode === 'implant') {
            t.vars.Is_Pregnant = 'false';
            finish();
            say(true, '已设为「已受精」：等到着床完成那天插件会自己切孕');
            return;
        }
        // ★★ 保底后门：**受精成功、但这一颗没着床** ⇒ 这个周期不会怀孕。
        //   走的是和推演同一条路：面板那张受精判定卡会写「着床判定 → 没着床」，
        //   致孕方那一格写「无」（逐胎锁定照旧留着 —— 那是受精那一刻的事实，档案里查得到 ✓），
        //   到「着床完成日」那天会弹一条「受精成功但没着床」的提醒 ✓
        if (mode === 'noimplant') {
            t.vars.Is_Pregnant = 'false';
            finish();
            say(true, '已设为「受精成功但没着床」：这个周期不会怀孕，到着床那天会提醒你一句');
            return;
        }
        t.vars.Is_Pregnant = 'true';
        finish();
        say(true, nm ? `已设为已孕（致孕方：${nm}）` : '已设为已孕');
    };

    const addAch = () => {
        const nm = String(achName.value || '').trim();
        if (!nm) { say(false, '先给这条成就起个名字'); return; }
        const added = addAchievements([{
            name: nm,
            why: String(achWhy.value || '').trim(),
            quip: String(achQuip.value || '').trim(),
            targetKey: key,
            targetName: displayName(t) || key,
        }], { date: today() });
        if (!added) { say(false, '这条已经有了（同名的不会重复加）'); return; }
        achName.value = ''; achWhy.value = ''; achQuip.value = '';
        try { paintAch(); } catch { /* 忽略 */ }
        finish();
        say(true, '成就加了一条（面板「记录 → 成就」里能看到）');
    };

    /**
     * 补一笔精子（＝补一条内射记录）。
     * ⚠️ 存活期的口径**跟着推演那条路走**：设置开着「按精子存活」才掷（`rollSpermLife` 同一个函数）；
     *   玩家填了天数就以玩家填的为准；两边都没有 ⇒ `lifeRoll = null` ＝：没设存活期，一直有效✓
     *   （这正是两件之一；不接这条的话会造出：永远有效的精子 ✗）
     */
    const addInsem = () => {
        const by = String(insBy.value || '').trim();
        if (!by) { say(false, '先写清楚是谁（可以是没建档的人）'); return; }
        const dayNow = (() => { try { return cycleDayNum(key); } catch { return null; } })();
        if (dayNow === null || !Number.isFinite(Number(dayNow))) {
            say(false, '这个对象还没有周期日：先让推演跑一轮，或者去「角色基础信息」里定周期起始');
            return;
        }
        let lifeRoll = null;
        const lifeIn = String(insLife.value || '').trim();
        if (lifeIn) {
            const n = Math.round(Number(lifeIn));
            if (!Number.isFinite(n) || n < 1 || n > 30) { say(false, '存活期填 1~30 天（或者留空跟设置走）'); return; }
            lifeRoll = n;
        } else {
            try { if (settings().cycleSettleMode === 'sperm') lifeRoll = rollSpermLife().value; } catch { /* 掷不出来就按"没设存活期" */ }
        }
        const it = recordInsemination(
            { by, note: '手动补录', protection: '内射', guard: '内射' },
            { target: key, day: Number(dayNow), round: (state().snapshots?.length || 0), sub: '', lifeRoll },
        );
        if (!it) { say(false, '这一笔没记上（这一轮同一个人已经补过一条了）'); return; }
        // ★★ 2026-10-18（手动补的没有增加）——
        //   根因：`recordInsemination` 只把这一笔记进账本，**不会重算 d2 那行文字** ⇒
        //   面板上的「累计受孕率」还停在补之前，看起来就像没加（其实账上加了，数据查过 ✓）
        //   ⇒ 补完当场重算一次 d2 ✓
        try { resnapProfileField(key, 'd2'); } catch { /* 忽略 */ }
        finish();
        say(true, `补了一笔：${by}（第 ${dayNow} 天入账${lifeRoll != null ? `，存活期 ${lifeRoll} 天` : '，没设存活期'}）`);
    };

    // ★★ 来源 / 分批（含植入方）：抽成共用的 `buildSourceEditor` ——
    //   玩家点着「胎儿 / 孩子」那一页强调过⇒ **两处都要有**，所以合成一个 ✓
    //   这里用「既成事实」那套刷新方式（改完 finish()）✓
    const srcEditor = buildSourceEditor(key, finish);

    // ★★ 2026-10-18（改数值里加删除成就的选项，能改内容，做成折叠）——
    //   成就原来只能加、不能改也不能删（要删得去面板的成就页？面板是只读的 ✗）
    //   ⇒ 收进一张**默认收起**的卡：上面逐条改（名字 / 依据 / 吐槽）+ 删，下面还是加一条 ✓
    const achSec = section('成就修改', {
        collapsible: true,
        open: false,
        help: [
            '这里是本聊天的全部成就（不只当前这个对象），最新的在最上面',
            '改完点那一条右边的「保存」；名字不能空、也不能和别的成就重名',
            '「✕ 删掉」只删这一条记录，不会撤销正文，也不会影响别的东西',
            '最下面还是手动补一条：名字、触发依据、吐槽都可以留空两项',
        ],
    });
    const achBody = achSec.querySelector('.bc-section-body');
    const achListHost = h('div', {});
    const paintAch = () => {
        clear(achListHost);
        let all = [];
        try { all = achievements().slice().reverse(); } catch { all = []; }
        if (!all.length) {
            achListHost.appendChild(h('div', { class: 'bc-hint', text: '这个聊天还没有成就' }));
            return;
        }
        achListHost.appendChild(h('div', {
            class: 'bc-hint',
            text: '共 ' + all.length + ' 条，最新的在上面（这里列的是本聊天的全部成就）',
        }));
        for (const a of all) {
            const nameIn = textInput(a.name || '', () => {}, { placeholder: '成就名字' });
            const whyIn = textInput(a.why || '', () => {}, { placeholder: '触发依据（可留空）' });
            const quipIn = textInput(a.quip || '', () => {}, { placeholder: '吐槽（可留空）' });
            achListHost.appendChild(h('div', { class: 'bc-ach-edit' },
                h('div', { class: 'bc-ach-edit-head' },
                    h('span', { class: 'bc-label', text: '对象：' + (a.target || '—') }),
                    h('div', { class: 'bc-spacer' }),
                    button('保存', () => {
                        const r = updateAchievement(a.id, {
                            name: nameIn.value, why: whyIn.value, quip: quipIn.value,
                        });
                        if (r === 'empty') { say(false, '成就名字不能空'); return; }
                        if (r === 'dup') { say(false, '已经有一条同名的成就了，换个名字'); return; }
                        if (r === 'missing') { say(false, '这条已经不在了'); paintAch(); return; }
                        say(true, '成就已修改');
                        paintAch();
                        finish();
                    }, { title: '保存这一条的名字 / 依据 / 吐槽' }),
                    button('✕ 删掉', async () => {
                        const yes = await askConfirm({
                            title: '删掉这条成就？',
                            msg: '会从本聊天的成就里删掉「' + (a.name || '这条') + '」，删了不能恢复。\n\n'
                                + '它只是记录，不会动正文、数值或别的记录；以后同名成就还能再解锁。',
                            okText: '删掉这条',
                            danger: true,
                        });
                        if (!yes) return;
                        if (!removeAchievement(a.id)) { say(false, '这条已经不在了'); }
                        else say(true, '已删掉这条成就');
                        paintAch();
                        finish();
                    }, { variant: 'danger', title: '从本聊天的成就里删掉这一条（不能恢复）' }),
                ),
                h('div', { class: 'bc-row bc-row-wrap' },
                    h('div', { style: { flex: '1 1 150px' } }, field('名字', nameIn)),
                    h('div', { style: { flex: '1 1 170px' } }, field('触发依据', whyIn)),
                    h('div', { style: { flex: '1 1 170px' } }, field('吐槽', quipIn)),
                ),
            ));
        }
    };
    achBody.appendChild(achListHost);
    achBody.appendChild(h('div', { style: { marginTop: '10px' } },
        h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '1 1 160px' } }, field('成就名字', achName)),
            h('div', { style: { flex: '1 1 160px' } }, field('触发依据（可留空）', achWhy)),
            h('div', { style: { flex: '1 1 160px' } }, field('吐槽（可留空）', achQuip)),
            h('div', { class: 'bc-row-end' }, button('加一条成就', addAch, { title: '手动补一条成就（比如开局设定里本来就有的）' })),
        ),
    ));
    paintAch();

    // ★ 2026-10-26：已经在孕期 ⇒ 这两格收起来
    //   （它们是「造孕」用的；同屏再放一个叫「孕周」的输入，玩家会拿它当"改现在的孕周"用，
    //     而它吃的是「设为已孕」那颗按钮，不是「保存」⇒ 填了 10 保存等于没反应 ✗）
    const pregNowHere = String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true';
    return section('既成事实（官方修改器）',
        pregNowHere
            ? h('div', { class: 'bc-hint', text: '这个人已经在孕期：改现在的孕周用最上面的「🕒 孕周」卡（这里这颗「孕周」是造孕用的，收起）' })
            : h('div', { class: 'bc-row bc-row-wrap' },
                h('div', { style: { flex: '1 1 150px' } }, field('孕周', weeksIn)),
                h('div', { style: { flex: '2 1 260px' } }, field('或填起点日期（优先用这个）', startIn)),
            ),
        h('div', {}, field('致孕方（可以留空）', fatherIn)),
        h('div', { class: 'bc-row bc-row-wrap' },
            button('设为已孕', () => setPregnant('pregnant'), { title: '判定、孕周、致孕方一次写好（这就是"开局就怀着"那条路 ✓）' }),
            button('设为已受精（待着床）', () => setPregnant('implant'), { title: '只写受精判定：等到着床完成那天插件自己切孕' }),
            button('设为没着床', () => setPregnant('noimplant'), { title: '受精成功、但这一颗没着床：这个周期不会怀孕（面板的致孕方那一格会写「无」，到着床那天提醒你一句）' }),
            button('设为未孕（撤销）', () => setPregnant('off'), { variant: 'danger', title: '连受精判定一起撤掉（不撤的话下一轮又会被切回已孕 ✗）' }),
        ),
        // ★ 2026-10-24：意识状态的手动保底 —— 设了就不按孕周自动推进
        h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '意识状态（手动）' }),
            dropdown(man0.state || '', [
                ['', '自动（按剧情事件）'],
                ['未察觉', '未察觉'],
                ['怀疑但未确认', '怀疑但未确认'],
                ['已确认怀孕', '已确认怀孕'],
            ], (v) => {
                try { setAwarenessManualOf(key, { state: v }); } catch { /* 忽略 */ }
                finish();
            }),
            button('交回自动', () => {
                try { clearAwarenessManualOf(key); } catch { /* 忽略 */ }
                finish();
            }, { title: '清掉手动状态与「已知晓谁」，按剧情事件自动推进' }),
        ),
        h('div', {}, field('已知晓致孕方（留空＝尚未知晓）', knowIn)),
        h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '1 1 200px' } }, field('补一笔精子：谁', insBy)),
            h('div', { style: { flex: '0 1 150px' } }, field('存活期（天）', insLife)),
            h('div', { class: 'bc-row-end' }, button('记一笔精子', addInsem, { title: '按今天（或你填的周期日）补一条内射记录，存活期照设置或者你填的天数 ✓' })),
        ),
        insemSec,
        // ★ 2026-10-24（不能紧贴在“补一笔精子”下面，会误读成删那笔记录）——
        //   单独一块，跟内射记录拉开；名字点明是「清空精液量」✓
        h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '体内精液量（阴道 / 子宫）' }),
            h('div', { class: 'bc-row-end' }, button('清空精液量', async () => {
                const yes = await askConfirm({
                    title: '清空精液量？',
                    msg: '把「' + (displayName(t) || key) + '」的阴道、子宫都清到「空」。\n\n'
                        + '阶段插图会立刻跟着变；只清精液量，不动精子存活期，也不删上面的记录。',
                    okText: '清空',
                    danger: true,
                });
                if (!yes) return;
                const ok = (() => { try { return clearSpermLoad(key); } catch { return false; } })();
                say(ok, ok ? '已清空精液量（阴道 / 子宫都到空）' : '本来就是空的');
                finish();
            }, { title: '阴道 / 子宫都清到空；不动精子存活期，也不删记录' })),
        ),
        h('div', { class: 'bc-hint', text: '清的是体内的精液量，跟上面补的那笔记录无关；阶段插图会跟着变' }),
        srcEditor,
        achSec,
        {
            help: [
                '这一块是官方修改器：给"流程永远跑不到"的状态留一条后门（比如开局设定就怀着某个孩子，而那个人不会出场 ✓）',
                '孕周和孕天数是一条口径：孕 10 周 ＝ 周期第 70 天；填了起点日期就按它算（起点＝最后一次月经那天）',
                '致孕方随便填：可以是没建档的人、已经不在场的人；留空就按原来的走 ✓',
                '「设为已孕」会把上一胎的胎数与性别判定作废（下一轮推演插件会按新的一胎重掷）✓',
                '「设为未孕」连受精判定一起撤：不撤的话下一轮推演又会把它切回已孕 ✗',
                '「意识状态（手动）」是保底：设了就不看剧情事件；「交回自动」清掉手动，按剧情事件走 ✓',
                '「已知晓致孕方」留空＝尚未知晓；填名字＝已知晓这个人；它压过模型报的那半截 ✓',
                '「补一笔精子」按今天那个周期日入账；存活期留空就跟着设置走（设置没开存活期 ⇒ 一直有效）✓',
                '「清空精液量」把阴道、子宫都清到空（阶段插图立刻变）；跟补的记录无关，也不动精子存活期和怀孕判定 ✓',
                '「来源 / 分批」是按批填的：前一批是谁、后一批是谁（几十上百枚不逐个填 ✓）。'
                    + '全是一批就只填名字、数量留空；分了批就每批都写清多少枚（不然后面分不出谁归第几批 ✗）',
                '它只管"这批是谁的"这个归属（d4、喂回引擎、d6 逐胎、出生记账都会用它），'
                    + '判定一个字都不参与：受精成不成、受孕率、胎数、性别照旧由系统算 ✓',
                '「清掉 / 交回插件」＝ 把你填的去掉，之后照引擎报的那句走 ✓',
                '「删掉这笔」连它加进受孕率的那点一起撤，并且记住这一笔：模型以后再把同一笔报上来也不会入账 ✓',
                '成就加完就进「记录 → 成就」；这张卡最后那块可以逐条改名字 / 依据 / 吐槽，也能删掉某一条（名字重复的不会再加）✓',
            ],
        });
}

/**
 * 🧬 角色基础信息 —— 三态选项（未填 / 能 / 不能）。
 *
 * 摆放：
 *   不要放在"改数值"里面，单独调一个选项出来，并且只在聊天内才有；
 *   非聊天不需要这个 ✓ ⇒ 入口放在**悬浮球快捷菜单**里（那本来就只在聊天里能用 ✓）。
 *
 * 这三个字段解决的是同一件事：**插件不可能自己知道、只能由玩家/角色卡给出的事实** ✓
 *   · 能不能怀孕 / 能不能让别人怀孕 ⇒ 插件据此决定"要不要算受精/周期""算不算致孕方候选"
 *   · 是不是异种 ⇒ 直接决定异种规则发不发（**新档第一轮就能发** ⇒ 解掉首轮竞态 ✓）
 *
 * 三态语义：`未填` = 一切按推演 API 每轮报的（等于现在的行为，什么都没变 ✓）
 *           `能/不能` / `是/否` = **锁定**，忽略 AI 报的 ✓
 *
 * ⚠️ 用户本人（{{user}}）这三个值存在**全局设置**里（**用户角色那一份一定要全局、而且不许删** ✓）——
 *   其他人存本聊天档案 ✓。界面上要注明这一点 ✓。
 */
/**
 * ★★ 「只在聊天里能用」的统一闸门（非聊天界面里：改数值 / 孩子·胎儿 / 推演一次
 *   看起来都能点，要不要禁掉）—— 要。
 *   这几个入口读写的都是**某个聊天的 chat_metadata**：不在聊天页时，上下文里可能还挂着
 *   上一个聊天 ⇒ 要么改错对象、要么把改动写进别人的档案 ✗
 *   ⇒ 统一在入口处拦下并说清原因（不是静默什么都不做 ✓）
 */
function chatOnlyGuard() {
    try {
        if (inChatPage()) return true;
        window.toastr?.info?.('这个改的是某个聊天的数据，先在聊天里打开再用');
        return false;
    } catch { return true; }
}

function openBodyInfo() {
    if (!chatOnlyGuard()) return;
    // 默认看"当前正在看的对象"；没有就退回用户本人
    const st = state();
    let key = st.active && st.targets?.[st.active] ? st.active : USER_KEY;
    if (!st.targets?.[key] && key !== USER_KEY) key = USER_KEY;
    const nameOf = (k) => {
        // ★ 名字槽位要显示**当前人设名**（当前使用角色的名字，而不是"你自己" ✓）
        if (isUserKey(k)) return userSelfLabel();
        const t = st.targets?.[k];
        return t ? (displayName(t) || k) : k;
    };

    const opts = [
        ['', '未填（按推演每轮判断）'],
        ['true', '能'],
        ['false', '不能'],
    ];

    modal({
        title: '⚧ 角色基础信息 · ' + nameOf(key),
        width: 560,
        hideCancel: true,
        saveText: '完成',
        // ★ 减密度：每行底下都压着一句小灰字太挤 ⇒ 全进「？」✓
        help: [
            '这四项是「插件自己不可能知道、只能由你告诉它」的事。留空就一直按推演每轮报的走',
            '能不能怀孕：填「不能」⇒ 插件不再给该角色算受精 / 周期那几套，也不会把受孕率当回事',
            '能不能让别人怀孕：填「不能」⇒ 该角色不会被算进「致孕方候选」',
            '能不能怀上异种：填「不能」⇒ 异种族致的致孕方不算进候选，也不会判成受精',
            '是不是异种：填「是」⇒ 异种那套规则【第一轮就发】，不用等推演报回来',
            '周期模式：这个人有没有月经。只改名字与描写（排卵日 ↔ 受孕高峰日 这类），受孕率、判定、结算两档完全一样',
            '别名：推演报的名字只要在这里出现过，就会对回这一份档；多个用 / 、或空格隔开',
            '标签：分类用，比如「未来篇」「十年后」。它没有内置词表，推演看到剧情怎么写就报什么，你填过就以你为准；只挂在这一个对象身上的标签还能当别名用',
            '备注：纯说明，不参与匹配，用来提醒自己这是哪个同名的人',
            '这里改的是上面选中的那个对象；选到你自己的名字，就是在改你自己那份',
            '「按新设定重判」：先推演过、后来才改上面这几项设定时，旧结论不会自己变回来。那个按钮会重跑一次这一楼的推演，并允许它只对这一个对象推翻旧结论，平时不用按',
        ],
        build: (body) => {
            // 对象切换（对象多了要能切；这里就是个下拉，别抢地方）
            const all = targetList();
            if (all.length > 1) {
                body.appendChild(field('看哪个对象', select(key, all.map(t => [t.key, displayName(t) || t.key]),
                    (v) => { key = v; rerender(); })));
            }

            const host = h('div', {});
            body.appendChild(host);

            const rerender = () => {
                clear(host);
                const lock = bodyLockOf(key);
                const isMe = isUserKey(key);

                if (isMe) {
                    host.appendChild(h('div', { class: 'bc-warn' },
                        h('div', { text: '⚠️ 这是【你自己】的设置' }),
                        h('div', { class: 'bc-hint', text: '它存在插件设置里（全局），所有聊天共用这一份，换聊天、删聊天都不会丢' }),
                    ));
                } else {
                    // 「这一份存哪」属于警告一类（数据位置），明面上留着 ✓
                    host.appendChild(h('div', { class: 'bc-hint', text: '这一份跟着【这个聊天】走：换聊天就是另一套' }));
                }

                // ★ 这四格抽成**共用实现**（设置页 / 本弹窗 / 补丁页·人物视图 三处共用 ✓）
                bodyLockRows(host, key, {
                    onChange: (st) => {
                        if (st) { try { rerender(); } catch { /* 忽略 */ } }
                        try { refreshAll(); } catch { /* 忽略 */ }
                    },
                });

                // ★ 2026-10-24：察觉档位（A~E）——玩家可以手选；留空＝交给 AI 判一次。
                //   玩家自己那份存全局，别的对象存本聊天 ✓
                {
                    const curTier = (() => { try { return awarenessTierIdOf(key); } catch { return ''; } })();
                    const tierOpts = [
                        ['', '自动（交给 AI 判）'],
                        ['A', '极早（A）'],
                        ['B', '较早（B）'],
                        ['C', '普通（C）'],
                        ['D', '较晚（D）'],
                        ['E', '极晚（E）'],
                        ['F', '几乎到生产（F）'],
                    ];
                    host.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                        h('span', { class: 'bc-label', text: '察觉档位' }),
                        dropdown(curTier, tierOpts, (v) => {
                            try { setAwarenessTierIdOf(key, v, { manual: true }); } catch { /* 忽略 */ }
                            rerender();
                            try { refreshAll(); } catch { /* 忽略 */ }
                        }),
                    ));
                    host.appendChild(h('div', {
                        class: 'bc-hint',
                        text: '决定这个角色大概什么时候开始起疑；留空＝由推演按角色设定判一次。选了就锁定，AI 不再改；它只做参考，确认仍要看剧情事件',
                    }));
                }

                // ★ 周期模式（有月经 / 无月经）—— **按人**（一个世界观里可以同时
                //   存在月经怀孕和非月经怀孕 ✓）
                //   设计上钉死了：规则可以只留一份、那些排卵期什么的交给插件替换，
                //   剩下的只是模式开关的感觉 ✓ ⇒ 规则一份（术语走占位符 ✓），档位按人 ✓
                //   ⚠️ 只影响**名字与描写**：受孕率、判定、结算两档完全一样 ✓
                {
                    const cur = periodModeOf(key);
                    // ★ 档位名统一走 `cycleModeLabel`（三档：月经 / 非月经 / 无月经 ✓）
                    const globalDefault = cycleModeLabel();
                    const modeOpts = [
                        ['', `跟随默认（${globalDefault}）`],
                        ['normal', '月经'],
                        ['none', '非月经'],
                        ['amenorrhea', '无月经'],
                    ];
                    const explicit = (() => {
                        if (isUserKey(key)) return String(settings().userCycleMode || '');
                        return String(st.targets?.[key]?.cycleMode || '');
                    })();
                    const box = h('div', { class: 'bc-field' },
                        h('div', { class: 'bc-label', text: '周期模式' }));
                    // ⚠️ 徽章要**立刻跟着改**，不能只写数据——老规矩：
                    //   改了状态的控件必须当场可见 ✓（不然选完还显示旧档，得关掉重开才对 ✗）
                    const modeTag = h('span', {
                        class: 'bc-badge' + (explicit ? ' on' : ''),
                        text: explicit ? `锁定：${cycleModeLabel(cur)}` : `跟随默认：${globalDefault}`,
                    });
                    box.appendChild(select(explicit, modeOpts, (v) => {
                        setPeriodModeOf(key, v);
                        const locked = !!v;                       // '' = 跟随默认 ⇒ 不锁
                        modeTag.textContent = locked
                            ? `锁定：${cycleModeLabel(v)}`
                            : `跟随默认：${globalDefault}`;
                        modeTag.classList.toggle('on', locked);
                        try { refreshAll(); } catch { /* 忽略 */ }
                    }));
                    box.appendChild(h('div', { class: 'bc-row' }, modeTag));
                    host.appendChild(box);
                }

                // ★★ 补救：迟填设定之后「按新设定重判」——
                //   场景：已经判成人类怀孕机制了，因为设定还没来得及填；所以给玩家一个选择 ——
                //     重新给那个角色选了种族之后，旁边给一个按钮（不是强制的）
                //     让 AI 重新给这个角色判定怀孕 ✓
                //   ⇒ 为什么光改上面的设定不够：推演的硬性要求里有一条「已经锁定的结果
                //     （受精 / 着床日 / 胎数 / 性别 / 致孕方）必须沿用既有值」⇒ 旧结论不会自己变 ✗
                //   ⇒ 这个按钮 = 重跑一次推演，并且**只对这一个对象**放行那条要求（见 judge.js
                //     的 rejudgeBlock）。一次性的，用完就没了，下次自动推演照旧守规矩 ✓
                //   ⚠️ 只在「这个对象已经推演过」时才摆：没算过就没有"按旧规则算出来的结论" ✓
                //   ⚠️ 而且**用户本人不给**（玩家不需要让 AI 重新判定自己，
                //     而且可以避免误触 ✓）
                const tt = st.targets?.[key];
                if (tt && tt.profile && !isUserKey(key)) {
                    host.appendChild(h('div', { class: 'bc-section-title', text: '补救：按新设定重判' }));
                    host.appendChild(h('div', { class: 'bc-row' },
                        button('按新设定重判这个对象', async () => {
                            if (!state().targets?.[key]?.profile) {
                                window.toastr?.warning?.('这个对象还没有推演过，用不上重判');
                                return;
                            }
                            if (!trackingRoster().some(t => t.key === key)) {
                                window.toastr?.warning?.('这个对象现在不在推演名单里。先去设置里把它加进追踪对象，再回来重判');
                                return;
                            }
                            if (!inRealChat()) {
                                window.toastr?.warning?.('要先进到一个有正文的聊天里才能重判');
                                return;
                            }
                            if (!(await askConfirm('按现在的设定重判「' + nameOf(key) + '」？\n'
                                + '会重跑当前这一楼的推演，并允许 AI 推翻这个对象之前按旧规则判出的数'
                                + '（受精、着床、胎数、性别这些）。别的对象不受影响'))) return;
                            document.querySelector('.bc-modal-overlay .bc-modal-close')?.click();
                            doJudge([key]);
                        })));
                }

                // ---- 别名与备注（同设置页那份："别名表 + 备注、不改名字"）----
                //   ★ 减密度：小标题 + 折叠 + 状态字都由 `identRows` 自己出 ✓
                // ★ 同上：别名备注也走共用实现（一份实现三处共用 ✓）
                identRows(host, key, { onChange: () => {} });
            };

            rerender();
        },
    });
}

/**
 * ★「孩子」编辑器
 *
 * 形态：
 *   · 胎儿出生后自动记录孩子信息：性别、出生日期、能力（如果打开了遗传）、**名字编辑**
 *     （AI 可能无法准确识别多个孩子的名字，所以推荐让用户自己编辑）
 *   · **出生日期可以手改** ✓
 *   · 满岁要不要也记录到日 ⇒ 定稿：**满岁只到月**（显示规则在 store 里 ✓）
 *   · 显示可以隐藏，但**插件必须记录日子** ⇒ 出生日期一定落库 ✓
 *
 * ⚠️ 面板那一页是**只读**的；改名字 / 补日期都在这里（跟敏感带一样：两个入口、同一份数据 ✓）
 * ⚠️ 只动**当前这个对象**的孩子（跟着当前查看的人变 ✓）
 */
function openChildrenEditor() {
    if (!chatOnlyGuard()) return;
    const t = currentTarget();
    if (!t) { window.toastr?.warning?.('还没有追踪对象'); return; }
    const key = t.key;

    modal({
        title: '👶 胎儿 / 孩子 · ' + (displayName(t) || key),
        width: 760,
        hideCancel: true,
        saveText: '完成',
        // 关掉这一页时刷一次状态面板：胎儿那一段改了 d6、孩子那几条也改过档案，
        //   不刷的话面板还显示旧的（这两个输入框都是"改完就生效"，面板得跟上 ✓）
        onClose: () => { try { refreshAll(); } catch { /* 忽略 */ } },
        help: [
            '这一页分两段：上面是胎儿（还在肚子里的），下面是孩子（已经出生的）',
            '两段改完都立刻生效（没有「保存」按钮）；光标移开或按回车就落地',
        ],
        build: (body) => {
            // ★★ 上面那一段：胎儿（跟：孩子放一处，但两个词分开 ✓）
            //   `buildFetusEditor` 只要求一个"有 `.value` 的对象" ⇒ 这里给它一个代理：
            //   改完直接落在这个对象的档案上（`t.profile.d6` = 数据项六 · 胎儿状态）✓
            //   ⚠️ 别在每次按键时 refreshAll（那是每次输入都重画面板 ✗）—— 别处的输入框也是这规矩 ✓
            const fetusHolder = { value: String(t.profile?.d6 || '') };
            const fetusProxy = {
                get d6() { return fetusHolder.value; },
                set d6(v) {
                    const before = String(t.profile?.d6 ?? '');
                    fetusHolder.value = String(v ?? '');
                    if (!t.profile || typeof t.profile !== 'object') t.profile = {};
                    t.profile.d6 = fetusHolder.value;
                    // ★ 2026-10-23（她：只是改了性别，插件应该继续接管）——
                    //   d6 是插件管的字段：这里先按"手改"记一笔，紧接着把性别同步回判定、
                    //   并把这一格交回插件（下一轮照常重写头/性别/致孕方，种族与描述素材保留 ✓）
                    try { setProfileFix(t.key, 'd6', fetusHolder.value, before); } catch { /* 忽略 */ }
                    try { syncPlanSexesFromD6(); } catch { /* 忽略 */ }
                    commit();
                },
            };
            body.appendChild(section('胎儿（还在肚子里）',
                buildFetusEditor(fetusHolder, fetusProxy),
                // ★ 卵群那种（几十上百枚）就在这儿按批填 ——
                //   我说的是这个✓（共用同一个编辑器 ✓）
                buildSourceEditor(t.key, () => { try { commit(); } catch { /* 忽略 */ } }),
                // ★ 2026-10-24（她的设计：别让人为了重写还得点出去）——
                //   一个弹窗里既能重掷（不花调用），也能让模型按现在的结果重写（花一次调用）
                (() => {
                    const rerollBtn = button('重掷天赋与来源', () => {
                      try {
                        if (String(t?.vars?.Is_Pregnant ?? '').toLowerCase() !== 'true') {
                            window.toastr?.warning?.('现在没怀孕，没有可重掷的结果');
                            return;
                        }
                        // 写完让模型按新结果重写这一段（花一次调用）
                        const doWrite = async (btn) => {
                            const old = btn.textContent;
                            btn.disabled = true;
                            btn.textContent = '判定中…';
                            try {
                                const r = await rollHeritageNow(t.key);
                                const has = (r?.children || []).some((x) => x.dominant || x.recessive || x.talent);
                                window.toastr?.[has ? 'success' : 'info']?.(
                                    has ? '已把显性 / 隐性 / 天赋写回 d6' : '模型判了：本次无遗传特质');
                                try { refreshAll(); } catch { /* 忽略 */ }
                            } catch (e) {
                                window.toastr?.error?.('没判成：' + String(e?.message || e));
                            } finally {
                                btn.disabled = false;
                                btn.textContent = old;
                            }
                            try { paint(); } catch { /* 忽略 */ }
                        };
                        const box = h('div', {});
                        const paint = () => {
                            clear(box);
                            let rolls = null;
                            try { rolls = heritageRollsOf(t.key); } catch { rolls = null; }
                            if (!rolls || !rolls.talent || !rolls.domSrc) {
                                try { rolls = ensureHeritageRollsFor(t.key); } catch { /* 忽略 */ }
                            }
                            const tiers = (() => { try { return talentTierTableOf(t.key).map((x) => x.label); } catch { return []; } })();
                            const srcs = (() => {
                                try {
                                    const r = dominantSourceRangeOf(t.key);
                                    return r ? [r.matLabel, r.patLabel, r.bothLabel] : [];
                                } catch { return []; }
                            })();
                            box.appendChild(h('div', { class: 'bc-hint', text: '这些是插件掷的，重掷不花调用。改完只影响面板和 d6 里的强度；要让模型按新结果重写那段话，点下面的「按现在的结果重写」' }));
                            const rows = (title, groups, curOf, rerollOne, setOne, opts) => {
                                const sec = h('div', { class: 'bc-reroll-sec' });
                                box.appendChild(sec);
                                sec.appendChild(h('div', { class: 'bc-label', text: title }));
                                if (!groups || !groups.length) {
                                    sec.appendChild(h('div', { class: 'bc-hint', text: '还没有结果' }));
                                    return;
                                }
                                groups.forEach((g, gi) => {
                                    const who = (g.kids || []).map((i) => `子${Number(i) + 1}`).join('、') || '整批';
                                    sec.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-reroll-row' },
                                        h('span', { class: 'bc-hint', text: `${who}${g.same ? '（同卵）' : ''}：掷出 ${g.roll} · ${curOf(g)}` }),
                                        h('div', { class: 'bc-spacer' }),
                                        button('重掷这颗', () => { rerollOne(t.key, gi); paint(); }),
                                        dropdown(String(curOf(g)), (opts || []).map((x) => [x, x]), (v) => {
                                            setOne(t.key, gi, v);
                                            paint();
                                        }),
                                    ));
                                });
                            };
                            rows('天赋', rolls?.talent?.groups, (g) => g.tier, rerollTalentGroup, setTalentGroupTier, tiers);
                            rows('显性来源', rolls?.domSrc?.groups, (g) => g.mode, rerollDominantGroup, setDominantGroupMode, srcs);
                            box.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-reroll-sec bc-reroll-acts' },
                                button('两组一起重掷', () => { rerollHeritageAll(t.key); paint(); }),
                                button('只重掷天赋', () => {
                                    const cur = heritageRollsOf(t.key).talent;
                                    for (let i = 0; i < (cur?.groups || []).length; i++) rerollTalentGroup(t.key, i);
                                    paint();
                                }),
                                button('只重掷来源', () => {
                                    const cur = heritageRollsOf(t.key).domSrc;
                                    for (let i = 0; i < (cur?.groups || []).length; i++) rerollDominantGroup(t.key, i);
                                    paint();
                                }),
                            ));
                            const writeBtn = button('按现在的结果重写（花一次调用）', () => doWrite(writeBtn), { variant: 'primary' });
                            box.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-fetus-actions bc-reroll-sec' },
                                writeBtn,
                                h('span', { class: 'bc-hint', text: '会发一次只判遗传特质的短请求，把显性 / 隐性 / 天赋写回 d6' })));
                            try { refreshAll(); } catch { /* 忽略 */ }
                        };
                        paint();
                        // ★ 2026-10-24（她：取消这个词容易被误会）—— 这里没有"执行/放弃"的语义，只是关窗
                        modal({ title: '重掷天赋与来源', width: 620, saveText: '关闭', hideCancel: true, build: (b) => b.appendChild(box) });
                      } catch (e) {
                        // ★ 2026-10-24（她报：点了没反应）—— 先把原因弹出来，别再静默
                        console.warn('[Bodycord] 重掷弹窗没打开', e);
                        window.toastr?.error?.('重掷弹窗没打开：' + String(e?.message || e));
                      }
                    });
                    return h('div', { class: 'bc-row bc-row-wrap bc-fetus-actions' },
                        rerollBtn,
                        h('span', { class: 'bc-hint', text: '重掷不花调用；窗口里那颗「按现在的结果重写」才会调模型（花一次调用）' }));
                })(),
                {
                    help: [
                        '这一段就是「数据项六 · 胎儿状态」那一格，跟「改数值」里那一份是同一份数据，两边都能改 ✓',
                        '没怀孕时这一格是「无」；要手造一胎就在这儿填（下一轮插件 API 会按判定结果重写它）',
                        '你在这儿改性别，会同步回判定、继续由插件管：插件下一轮照常重写头部、性别和致孕方，你写的种族、发育描述、孕期这些素材会保留',
                        '每胎的孕期：人类留空就行（系统按 280 天算）；异种要自己填，按你设定里那个种族的孕期长度填，例如 12-15 个月',
                        '「显性外貌 / 隐性携带 / 天赋」在界面上是三格分开填的，写进数据里也都还在这同一段括号里（格式跟原来一模一样）✓',
                        '天赋那一格是一整句话，按系统掷出的档位写；想重掷或手选档位，点「重掷天赋与来源」：窗口里重掷不花调用，点「按现在的结果重写」才会发一次短请求（会花一次调用）',
                        '卵群那种（几十上百枚）不用一个个填：就在下面「来源 / 分批」里按批写谁的那几枚 ✓',
                        '那一行只管"这批是谁的"这个归属（面板的致孕方那一格、喂回引擎、出生记账都会用），判定一个字都不参与 ✓',
                    ],
                }));

            // 下面那一段：已经出生的孩子（原来的那一整块，搬进一个容器里 ✓）
            const kidsBody = h('div', {});
            body.appendChild(section('孩子（已经出生）', kidsBody, {
                help: [
                    '上面是名字面板：点一下名字就切到那个孩子，改的是下面那一份；名字多了还能搜',
                    '名字要你自己填：多胎的时候 AI 分不清哪个是哪个，所以插件不采信它报的名字',
                    '出生日期可以手改（剧情没给日期的时候，插件用的是虚拟日历）',
                    '年龄按剧情日期算（满 1 岁以后只显示到月，不满 1 岁才显示天）',
                    '「另一个亲代」就是给孩子提供另一半遗传的那一位',
                    '手动添加的那一条不会参与去重，随便加',
                ],
            }));

            // ★ 形态：**名字面板在上、点一下切到那个孩子** ——
            //   原来是把每个孩子的四个输入框全铺出来，孩子一多就成了很长一条，
            //   想改某一个得一路滚下去 ✗。现在：上面只列名字（点着切人 + 能搜），
            //   下面只渲染**选中的这一个**的输入框 ✓
            let keyword = '';
            // 默认落在"最新那一个"上（列表也是新的在前 ⇒ 打开就对着最新那条 ✓）
            let pickedId = (childrenOf(key).slice(-1)[0] || {}).id || '';

            const searchRow = h('div', { class: 'bc-row' });
            const listHost = h('div', { class: 'bc-child-names bc-row bc-row-wrap' });
            const formHost = h('div', { class: 'bc-child-form' });
            kidsBody.appendChild(searchRow);
            kidsBody.appendChild(listHost);
            kidsBody.appendChild(formHost);

            // 只重画名字列表 —— 在搜索框里打字时**不能**连下面那份表单一起重画，
            //   否则正在填的输入框会被摘掉、字也丢 ✗（搜索框只重画列表是项目里的老规矩 ✓）
            const paintList = () => {
                clear(listHost);
                const all = childrenOf(key).slice().reverse();
                const kw = keyword.trim().toLowerCase();
                const list = kw ? all.filter((c) => String(c.name || '').toLowerCase().includes(kw)) : all;
                if (!all.length) {
                    listHost.appendChild(h('div', { class: 'bc-empty', text: '还没有孩子' }));
                    listHost.appendChild(h('div', { class: 'bc-hint',
                        text: '推演报「已分娩」那一轮会自动记下来；也可以手动加一条' }));
                    return;
                }
                if (!list.length) {
                    listHost.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的孩子' }));
                    return;
                }
                for (const c of list) {
                    const nm = String(c.name || '').trim() || '（还没起名字）';
                    listHost.appendChild(h('div', {
                        class: 'bc-pill bc-pill-big' + (c.id === pickedId ? ' active' : ''),
                        title: nm,
                        onclick: () => { pick(c.id); },
                    },
                        h('span', { class: 'bc-pill-dot' }),
                        h('span', { class: 'bc-pill-name', text: nm }),
                    ));
                }
            };

            // 只重画下面那份表单（换人、删掉一条、手动加一条之后走它 ✓）
            const paintForm = () => {
                clear(formHost);
                const list = childrenOf(key);
                let cur = list.find((c) => c.id === pickedId) || null;
                if (!cur) cur = list[list.length - 1] || null;   // 原来那条没了 ⇒ 退回最新的一条
                pickedId = cur ? cur.id : '';
                paintList();                                    // 高亮跟着走（只重画列表，搜索框不动 ✓）

                if (!cur) {
                    formHost.appendChild(h('div', { class: 'bc-hint',
                        text: '还没有孩子。点下面的按钮加一条，或者在剧情里让它出生' }));
                    return;
                }

                // ⚠️ 这里**不能**把这个局部函数叫 `field` —— 那就把 dom.js 的 `field` 遮住了，
                //   于是函数体里的 `field(...)` 变成调它自己 ⇒ 无限递归，一放孩子就
                //   `Maximum call stack size exceeded`、弹窗正文空白 ✗
                // ★ 输入即写库（不用「保存」按钮）：下面那几个「确定 / 删掉」按钮的点击
                //   会先触发输入框的 blur，所以光标移开就落地了，不会丢字 ✓
                const childField = (label, k, ph) => field(label,
                    textInput(cur[k] || '', (v) => { updateChild(cur.id, { [k]: v }); }, { placeholder: ph }));

                // ★ 出生日期这一格：**打错了要当场说** ——
                //   以前打错字会静默存进去，然后"年龄"那一行悄悄消失（做了没反馈 ✗）
                //   ⚠️ 用 `bc-warn`（黄字）而不是 `bc-hint` —— 别的地方有条数断言盯着 `bc-hint` ✓
                const birthWarn = h('div', { class: 'bc-warn', text: '' });
                birthWarn.style.display = 'none';
                const paintBirth = (v) => {
                    const t = String(v ?? '').trim();
                    if (t && !parseFictionDate(t)) {
                        birthWarn.textContent = '这个日期插件认不出来，孩子的年龄会算不出来。照「1年03月14日」这样写';
                        birthWarn.style.display = '';
                    } else {
                        birthWarn.textContent = '';
                        birthWarn.style.display = 'none';
                    }
                };
                paintBirth(cur.birthDate);
                const birthField = field('出生日期',
                    h('div', {},
                        textInput(cur.birthDate || '', (v) => {
                            updateChild(cur.id, { birthDate: v });
                            paintBirth(v);
                        }, { placeholder: '例：1年03月14日' }),
                        birthWarn,
                    ));

                const age = childAgeText(cur.birthDate, storyDateNow());
                formHost.appendChild(section(
                    (String(cur.name || '').trim() || '还没起名字') + (age ? '　·　' + age : ''),
                    h('div', { class: 'bc-row bc-row-wrap' },
                        h('div', { style: { flex: '1 1 200px' } }, childField('名字（自己填）', 'name', '例：小满')),
                        h('div', { style: { flex: '1 1 160px' } }, birthField),
                    ),
                    h('div', { class: 'bc-row bc-row-wrap' },
                        h('div', { style: { flex: '1 1 200px' } }, childField('另一个亲代', 'other', '例：示例角色·甲')),
                        // ★ 这两格**合起来写「性别 / 种族」却只绑了 `sex`** 时 ✗
                        //   ⇒ 孩子记录里那份种族（AI 从胎儿卡报上来的）既看不到也改不了 ✓ 现在拆开各自绑 ✓
                        h('div', { style: { flex: '1 1 140px' } }, childField('性别', 'sex', '例：女')),
                        h('div', { style: { flex: '1 1 160px' } }, childField('种族', 'race', '例：混血 / 半精灵')),
                    ),
                    h('div', {}, childField('遗传能力（显性 / 隐性携带）', 'heritage', '例：显性：银发褐瞳')),
                    h('div', {}, childField('天赋（职业 / 身份 / 训练出来的东西）', 'talent', '例：从一方完整继承暗杀者的手感')),
                    h('div', {}, childField('天赋强度', 'strength', '例：起点高于亲代')),
                    h('div', { class: 'bc-row bc-row-wrap' },
                        h('span', { class: 'bc-hint', text: '这条是 ' + (cur.birthDate || '日期未知') + ' 记下的' }),
                        h('div', { class: 'bc-spacer' }),
                        button('删掉这条', async () => {
                            if (!(await askConfirm('删掉「' + (String(cur.name || '').trim() || '这个孩子') + '」这条记录？'))) return;
                            removeChild(cur.id);
                            pickedId = '';        // 让 paintForm 自己退回最新那一条 ✓
                            paintForm();
                            refreshAll();
                        }, { variant: 'danger' }),
                    ),
                    // ⚠️ opts（help）必须放**最后一个实参** —— 放中间会被当普通子节点渲染成
                    //   页面上的 `[object Object]`，而且「？」按钮不出现 ✗
                    {
                        help: [
                            cur.birthDate ? ('出生日期：' + cur.birthDate) : '出生日期还空着（剧情没给日期就不会瞎填）',
                            (cur.sex || cur.race) ? ('性别 / 种族：' + [cur.sex, cur.race].filter(Boolean).join(' ')) : '性别 / 种族：没记到',
                        ],
                    },
                ));
            };

            const pick = (id) => { pickedId = id; paintForm(); };

            // 多才给搜索框（只有两三条时它只会碍事 ✓ —— 项目里的名单搜索也是到阈值才出）
            if (childrenOf(key).length >= 5) {
                searchRow.appendChild(textInput('', (v) => { keyword = v; paintList(); },
                    { placeholder: '按名字筛选（不打字就是全部）' }));
            }

            kidsBody.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                button('＋ 手动添加一个孩子', () => {
                    const before = new Set(childrenOf(key).map((c) => c.id));
                    addChildren([{}], {
                        target: key,
                        date: storyDateNow(),
                        round: (state().snapshots || []).length + 1,
                        manual: true,     // ①允许全空 ②不去重 ✓
                    });
                    const added = childrenOf(key).find((c) => !before.has(c.id));
                    if (added) pickedId = added.id;    // 加完直接落到新的那条上（不然还停在旧人身上，像没生效 ✗）
                    paintForm();
                    refreshAll();
                }, { title: '剧情里出生了但没走「已分娩」事件时，用这个补一条' }),
                button('刷新', () => paintForm(), { title: '外面刚推演完 / 数据变了时，按它重新读一遍' }),
            ));

            paintForm();
        },
    });
}

/**
 * ★ 「现在处于周期第几天」——「改数值」弹窗里的那一格。
 *
 * 这个生理期阶段可以让玩家自己去"改数值"那里随时改 ✓
 *
 * ⚠️ 它存的是 `targets[key].cycleDay / cycleDayAt`（**按对象** ✓），
 *   和「周期长度 / 排卵日 / 经期天数」那些**参数**是两回事 ——
 *   参数改了**绝不会**回头重算它（红线：别搞成改了"改数值"里任何项目、
 *   上次经期就重新算，那种 BUG 绝对不会被允许 ✗）
 * ⚠️ 改完**当场落库**；插件喂给推演的「现在是周期第几天」就是它 ⇒ 下一轮会照它走 ✓
 */
function cycleDayBox(t) {
    // ★ 无月经那一档：**没有阶段**（无月经就是没有阶段、不需要阶段 ✓）
    //   ⇒ 这一格也不给填（没有周期第几天这回事 ✓）
    try {
        if (periodModeOf(t.key) === 'amenorrhea') {
            return h('div', { class: 'bc-hint', text: '这个人选的是「无月经」，没有周期、没有阶段，这一格不用填' });
        }
    } catch { /* 读不到就照旧 ✓ */ }
    const hint = h('div', { class: 'bc-hint' });
    const paint = (v) => {
        const d = Math.round(Number(v));
        if (!Number.isFinite(d) || d <= 0) { hint.textContent = '填一个大于 0 的整数'; return; }
        let txt = `第 ${d} 天`;
        try {
            const { cycle, ovu } = bodyCycleParamsOf(t.key);
            const dv = deriveCycleFields({
                Ovulation_Day: ovu, Cycle_Length: cycle, Is_Pregnant: 'false',
            }, periodModeOf(t.key), periodDaysOf(t.key), d);
            if (dv) txt = `第 ${d} 天 ＝ ${dv.phase}（基础率 ${dv.d1}）`;
        } catch { /* 忽略 */ }
        hint.textContent = txt;
    };

    let now = null;
    try { now = cycleDayNow(t.key); } catch { now = null; }
    const input = numberInput(now === null ? '' : now, (v) => {
        paint(v);
        const d = Math.round(Number(v));
        if (Number.isFinite(d) && d > 0) {
            setCycleDayOf(t.key, d);
            try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
        }
    }, { min: 1, max: 999 });

    if (now === null) hint.textContent = '还没有周期状态，下一次推演会按「周期起始」那档种上';
    else paint(now);
    return h('div', {}, field('现在处于周期第几天', input, hint));
}

function openFieldEditor(focusKey) {
    if (!chatOnlyGuard()) return;
    const t = currentTarget();
    if (!t) { window.toastr?.warning?.('还没有追踪对象'); return; }
    if (!t.profile) { window.toastr?.warning?.('这个对象还没有推演过，先点「推演」'); return; }

    // ★★ 2026-10-16（提示词到底改好没有，为什么一直浪费钱）——
    //   打开修改器时，把**插件自己管的、没被手改锁住的**那几格按现在的账本重算一遍 ✓
    //   ⇒ 账本明明有那一笔时，d2 立刻就是真实值，**不用玩家再推演一次才看得到** ✗
    //   ⚠️ 必须跳过硬手改过的：`resnapProfileField` 会顺手把手改锁清掉（那是「交回插件」的语义 ✗）
    for (const fk of ['d2', 'd3', 'd4', 'd5', 'd8']) {
        try {
            if (isProfileFieldFixed(t.key, fk)) continue;
            resnapProfileField(t.key, fk);
        } catch { /* 重算不出来就保留原值 ✓ */ }
    }
    // ★ 阶段名 / 进度 / 基础率那三格也按现在重算一次（phase/sub/d1 现在全归插件推导）——
    //   否则「无月经 + 能怀」那档会一直停在「不适用」，看着像这一档怀不上 ✗
    //   （打开修改器就重算 ⇒ 不用为看这一个数再掏一次推演钱 ✓）
    try { refreshCycleFieldsOf(t.key); } catch { /* 算不出来就保留原值 ✓ */ }

    const draft = { ...t.profile };
    const inputs = {};
    let firstFocus = null;
    // 记住打开时这三个的值 —— 保存时只要有一个变了，就说明玩家手改过，
    // 以后不再自动推导（见 store.js 的 manualCycle）。
    // ★★ 手改锁：打开时留一份"现在是什么值" —— 保存时一比对就知道玩家动过哪几格 ✓
    let profileAtOpen = { ...(t.profile || {}) };
    // ★ 2026-10-26：孕周 / 预产期那几格也要吃「保存」那颗按钮
    //   （她填了周数直接点保存 ⇒ 原来只有那颗「设为这个孕周」才生效，保存等于没反应 ✗）
    let pregApply = null;
    // ★ 敏感带表（延后模式）留给我们的落地入口：保存时调它（只有真改过才写 ✓）
    let flushZones = null;

    modal({
        title: `改数值 · ${displayName(t) || t.key}`,
        width: 860,
        // ★ 减密度：弹窗里也走「？」（改数值和时光机弹窗也需要 ✓）
        help: [
            '改完点保存，立刻反映到状态面板上。下一次自动推演会以你改过的内容为起点',
            '「数据项六 · 胎儿状态」那一格下面可以按每个胎儿单独填（种族 / 性别 / 致孕方 / 孕期 / 预产期），不用自己记那串格式；已经出生的孩子在悬浮球菜单的「胎儿 / 孩子」里',
            '敏感带那一块改的是这个人当前的敏感带值，不是「初始设定」；初始设定在设置 → 规则补丁 → 敏感带初始设定里',
            '敏感带表格的改动也跟着一起保存（不用单独点）',
            '这里是官方修改器：你手改过哪一格，那一格就先听你的（标签后面会出现「你手填的 · 交回插件」）；等插件那边的账变了（生了新的、换了一胎、档位推进…）它会自动接管并提醒你，不用你盯着 ✓',
        ],
        build: (body) => {
            // 阶段名 / 进度 / 基础率不再能手填（手填会锁死 ✗）⇒
            //   那三格做成只读；页面上**不摆说明**

            // ★ 敏感带在这里**也能直接改**（含加行 / 清空 / 切预设）。
            //
            //   两条约束：
            //     · 设定过初始敏感带之后，玩家也得能通过"改数值"修改 / 清空（不能改就不自由）
            //       —— 所以必须能在这里改；
            //     · 摆成设置补丁里面那种样子，**但需要折叠上**，
            //       不然后面多了影响操作 —— 所以默认**收起**，别把 d1~d9 挤下去。
            const zoneBox = renderZoneModifier(t.key, {
                // ★★ 2026-10-15（改数值里那张敏感带表不能一动就直接落库 —— 怕误操作，
                //   由弹窗右下角那颗保存统一落地更权威）——
                //   ⇒ 这张表在这里**不即时保存、也不自带保存按钮**：
                //     改动只留在内存里，等这个弹窗的保存一起落地 ✓（flush 见下面 onSave）
                defer: true,
                onReady: (api) => { flushZones = api.flush; },
                // ★ 这里读写的是 **d9（这个人当前的敏感带值）**，不是 zones_custom 的种子文本。
                //   上面那个不是初始设定，它本质上是修改聊天内数值的修改器，
                //   不算初始化，初始化是另一套。
                //   ⚠️ d9 本来就是**按对象**的；"初始设定"那份也已经是按人存
                //     （用户本人 ⇒ 全局、NPC ⇒ 对象身上 ✓ 见 store.js 的 zoneTextOf）。
                //   ⚠️⚠️ 手改之后必须打 `d9Manual` 标记（"聊天内改敏感带数值保存无效、
                //     刷新又变回旧值"的根因）：
                //     旧写法是"故意不更新 zonesSeed"，靠"d9 ≠ 种子"来让种子不再覆盖 ——
                //     但守卫的另一半是 `cur === zonesSeed ⇒ 允许覆盖`，而手改的那一刻
                //     d9 还正好等于旧种子 ⇒ 下一次推演直接把玩家的改动盖回去了 ✗。
                //     现在改成**显式标记**：手改过就是手改过，种子永远让位 ✓。
                readRows: () => parseZoneRows(String(draft.d9 || '')),
                writeRows: (rows) => {
                    const text = serializeZoneRows(rows);
                    draft.d9 = text;                 // 弹窗里那份草稿也同步，免得点保存时被旧值盖回去
                    if (!t.profile) t.profile = {};
                    t.profile.d9 = text;
                    t.d9Manual = true;               // 从此不再被 zones_custom 的种子覆盖
                    commit();
                    try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
                    return true;
                },
                refresh: () => { try { refreshAll({ force: true }); } catch { /* 忽略 */ } },
                rebuild: () => { try { refreshAll({ force: true }); } catch { /* 忽略 */ } },
            });
            if (zoneBox) {
                const zoneSec = section('🎯 敏感带（当前值）', { collapsible: true, open: false });
                zoneSec.querySelector('.bc-section-body').appendChild(zoneBox);
                body.appendChild(zoneSec);
            }

            const grid = h('div', { class: 'bc-field-grid' });
            // ★ 周期进度：玩家随时能把"现在第几天"拨走 ✓
            //   ⚠️ 放在 d1~d9 那张表**上面**（它是"这个人在周期里的位置"，比面板字段更基础 ✓）
            body.appendChild(section('📅 周期进度', cycleDayBox(t), {
                help: [
                    '这个角色现在处于周期第几天，比如 9 就是第 9 天',
                    '下面那行写的是这个天数对应哪个阶段（按这个角色自己的「周期模式」翻译：月经档是卵泡期、非月经档是蓄势期）',
                    '改它不会动「周期长度 / 排卵日 / 经期天数」；反过来改那些也不会动它',
                    '这个人还没定过起始时用哪一档，在 设置 → 规则补丁 → 人物视图 的「周期起始」里改',
                ],
            }));
            // ★★ 2026-10-26：只读格上那行提示会把人引到「周期进度」，
            //   可它管不到植入孕的孕周（无月经档连输入框都没有）⇒ 删掉那行提示，
            //   另给一个真能改孕周的入口（改的是它背后的钟，见下）。
            {
                const pregNow = String(t?.vars?.Is_Pregnant ?? '').trim().toLowerCase() === 'true';
                if (pregNow) {
                    const isImplant = (() => { try { return !!implantDateOf(t.key); } catch { return false; } })();
                    const mm = String(t?.profile?.sub || '').match(/孕\s*(\d+)\s*周(?:\s*\+\s*(\d+)\s*天)?/);
                    // ★ 起点以**插件那份钟**为准（profile.sub 可能是空的 / 导入来的旧档）
                    //   ⇒ 只认文字的话会：输入框空白、而且「保存」那条判"没改"就整段跳过 ✗
                    const curTotal0 = (() => {
                        try {
                            if (isImplant) {
                                const n = pregDaysOf(t.key);
                                return (n === null || n === undefined || n === '') ? null : Math.round(Number(n));
                            }
                            const n = Number(cycleDayNum(t.key));
                            return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
                        } catch { return null; }
                    })();
                    const curW = curTotal0 !== null ? String(Math.floor(curTotal0 / 7)) : (mm ? mm[1] : '');
                    const curD = curTotal0 !== null ? String(curTotal0 % 7) : (mm ? String(mm[2] || '0') : '');
                    const wIn = numberInput(curW, () => {}, { min: 0, max: 80 });
                    const dIn = numberInput(curD, () => {}, { min: 0, max: 6 });
                    const dueIn = textInput('', () => {}, { placeholder: '例：1年09月12日' });
                    const nowLine = h('div', {
                        class: 'bc-hint',
                        text: curTotal0 !== null ? `现在是 孕${curW}周+${curD}天` : '现在的孕周还没算出来',
                    });
                    const apply = (silent) => {
                        const w = Math.round(Number(wIn.value));
                        const d = Math.round(Number(dIn.value || 0));
                        if (!Number.isFinite(w) || w < 0 || w > 80) { window.toastr?.warning?.('周数填 0~80'); return; }
                        if (!Number.isFinite(d) || d < 0 || d > 6) { window.toastr?.warning?.('天数填 0~6'); return; }
                        const now = (() => { try { return currentDate() || ''; } catch { return ''; } })();
                        const total = w * 7 + d;
                        // 旧口径的"孕期第几天"（用来算预产期要挪多少）
                        //   普通孕＝周期第几天；植入孕＝植入日到今天
                        const oldTotal = (() => {
                            try {
                                if (isImplant) {
                                    const n = pregDaysOf(t.key);
                                    return (n === null || n === undefined || n === '') ? null : Math.round(Number(n));
                                }
                                const n = Number(cycleDayNum(t.key));
                                return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
                            } catch { return null; }
                        })();
                        let ok = false;
                        try {
                            if (isImplant) {
                                // 植入孕要用"今天 − N 天"反推植入日 ⇒ 没有剧情日期就没法写
                                if (!now) { window.toastr?.warning?.('还没定下剧情日期：植入孕的孕周改不了（先去设置 → 时间与设置 定个日期）'); return; }
                                ok = !!setImplantDateOf(t.key, addDays(now, -total));
                            } else if (total > 0) { setCycleDayOf(t.key, total, now); ok = true; }
                        } catch { ok = false; }
                        if (!ok) {
                            window.toastr?.warning?.(total > 0 ? '没写进去：先确认剧情日期有值' : '孕周不能填 0（普通怀孕按周期日算）');
                            return;
                        }
                        // ★ 2026-10-26：改完孕周，预产期还停在旧日期 —— 两者同源
                        //   （起点＋孕期长度）⇒ 孕周变大多少天，预产期就提前多少天
                        //   （总孕期长度不变）。只动「预产期提醒」和 d6 里那格日期。
                        let dueMoved = 0;
                        if (oldTotal !== null && Number.isFinite(oldTotal)) {
                            const delta = total - oldTotal;
                            if (delta) {
                                try { dueMoved = shiftDueDatesOf(t.key, -delta); } catch { dueMoved = 0; }
                            }
                        }
                        try { refreshCycleFieldsOf(t.key); } catch { /* 忽略 */ }
                        for (const fk of ['phase', 'sub', 'd1']) {
                            const v = String(t?.profile?.[fk] ?? '');
                            draft[fk] = v;
                            if (inputs[fk]) inputs[fk].value = v;
                        }
                        try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
                        commit();
                        try { syncLastFloorSnapshot(); } catch { /* 忽略 */ }
                        refreshAll();
                        nowLine.textContent = `现在是 孕${w}周+${d}天`;
                        // ★ 写完立刻回读（她说"哪里都没有变"时，这句能把失败面直接摊出来）
                        const back = String(state().targets?.[t.key]?.profile?.sub ?? '');
                        if (!back.includes('孕')) {
                            window.toastr?.warning?.('没写进去：进度那格现在是「' + (back || '空') + '」（对象 ' + t.key + '）');
                        } else if (!silent) {
                            window.toastr?.success?.(`已设为 孕${w}周+${d}天` + (dueMoved ? '，预产期一起挪了' : ''));
                        }
                    };
                    // 直接改预产期（差值法对已经被改歪过的存档没有净变化 ⇒ 给绝对值入口）
                    const applyDue = (silent) => {
                        const d0 = String(dueIn.value || '').trim();
                        if (!d0) { if (!silent) window.toastr?.warning?.('先填一个日期'); return; }
                        if (!parseFictionDate(d0)) { window.toastr?.warning?.('日期认不出来，照「1年09月12日」这样写'); return; }
                        const a = (() => {
                            try { return listAlerts().find((x) => String(x?.kind || '') === 'due' && String(x?.target || '') === String(t.key)); } catch { return null; }
                        })();
                        if (!a) { window.toastr?.warning?.('这个对象还没有预产期提醒：先跑一轮推演让它定下来'); return; }
                        let delta = 0;
                        try { delta = diffDays(String(a.date || ''), d0); } catch { delta = 0; }
                        dueIn.value = '';   // 用掉就清掉：不然下次保存会再挪一遍 ✗
                        if (!Number.isFinite(delta) || !delta) {
                            if (!silent) window.toastr?.info?.('本来就是这一天');
                            return;
                        }
                        try { shiftDueDatesOf(t.key, delta); } catch { /* 忽略 */ }
                        try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
                        commit();
                        try { syncLastFloorSnapshot(); } catch { /* 忽略 */ }
                        refreshAll();
                        if (!silent) window.toastr?.success?.('预产期改成 ' + d0 + '（提醒与那格日期一起换了）');
                    };
                    // ★ 「保存」那颗也要落地这两格（只动真的改过的）
                    pregApply = () => {
                        const w = Math.round(Number(wIn.value));
                        const d = Math.round(Number(dIn.value || 0));
                        // ★ 比的是**插件那份钟**，不是 profile.sub 的文字：
                        //   导入来的旧档 sub 可能是空的 ⇒ 按文字比会判"没改"、整段跳过 ✗
                        if (Number.isFinite(w) && Number.isFinite(d) && w >= 0 && d >= 0 && d <= 6) {
                            const total = w * 7 + d;
                            if (curTotal0 === null || total !== curTotal0) apply(true);
                        }
                        if (String(dueIn.value || '').trim()) applyDue(true);
                    };
                    body.appendChild(section('🕒 孕周', h('div', {},
                        h('div', { class: 'bc-row bc-row-wrap' },
                            h('div', { style: { flex: '0 1 120px' } }, field('周', wIn)),
                            h('div', { style: { flex: '0 1 130px' } }, field('天（0~6）', dIn)),
                            h('div', { class: 'bc-row-end' }, button('设为这个孕周', () => apply(false), { title: '按今天重新定孕周' })),
                        ),
                        nowLine,
                        h('div', {
                            class: 'bc-hint',
                            text: isImplant ? '这一胎是植入孕：改的是植入日' : '这一胎按周期日算：改孕周时周期第几天会一起变',
                        }),
                        h('div', { class: 'bc-hint', text: '预产期会跟着挪同样的天数（总孕期长度不变）' }),
                        // ★ 2026-10-26：预产期也能直接改（改孕周只按差值挪，对"已经被改歪过的存档"
                        //   没有净变化 ⇒ 给一个直接填日期的入口，一步修好）
                        h('div', { class: 'bc-row bc-row-wrap', style: { marginTop: '6px' } },
                            h('div', { style: { flex: '1 1 220px' } }, field('或者直接改预产期', dueIn)),
                            h('div', { class: 'bc-row-end' }, button('设为这个预产期', () => applyDue(false))),
                        ),
                        // ★ 2026-10-26：**还没有预产期**时的那条路 ——
                        //   预产期本来只在推演那一步由插件定下来（每轮调一次那个"定预产期"的流程），
                        //   可她那一档三个孩子都没写「孕期」这一格 ⇒ 哪里都没有预产期
                        //   （＝ 日历上也没得标、提醒里也没有）✗
                        //   ⇒ 给她一颗"现在就算"的按钮：规则跟推演那条一模一样
                        //     （人类没写孕期 ⇒ 按 280 天；异种漏写 ⇒ 算不出来，如实说 ✓）
                        //   已经定下的那胎不会重掷（锁定 ✓）
                        h('div', { class: 'bc-row bc-row-wrap', style: { marginTop: '6px' } },
                            h('div', { class: 'bc-sp' }),
                            h('div', { class: 'bc-row-end' }, button('按孕期算出预产期', () => {
                                const dueCount = () => {
                                    try {
                                        return listAlerts().filter((x) => x && String(x.kind || '') === 'due'
                                            && String(x.target || '') === String(t.key || '')).length;
                                    } catch { return 0; }
                                };
                                const before = dueCount();
                                try { ensureGestationDates(); } catch { /* 忽略 */ }
                                try { syncDueAlerts(); } catch { /* 忽略 */ }
                                try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
                                commit();
                                try { syncLastFloorSnapshot(); } catch { /* 忽略 */ }
                                refreshAll();
                                const after = dueCount();
                                if (after > before) {
                                    window.toastr?.success?.('定下了 ' + (after - before) + ' 胎的预产期（日历上会标出来）');
                                } else if (before) {
                                    window.toastr?.info?.('已经有 ' + before + ' 胎的预产期了，定下的不会重掷');
                                } else {
                                    window.toastr?.warning?.('算不出来：这一胎 d6 里没有「孕期」这一格（人类没写会按 280 天算，异种要自己填）');
                                }
                            }, { title: '按每个孩子 d6 里写的孕期算预产期；已经定下的不动' })),
                        ),
                    ), {
                        help: [
                            '改的是「今天处于孕期第几天」：普通怀孕改周期第几天，植入孕改植入日',
                            '不重掷受精 / 着床判定，也不动胎数和孩子的数据',
                            '预产期跟孕周同源：孕周变大多少天，预产期就提前多少天（总孕期长度不变）',
                        ],
                    }));
                }
            }
            // **身体痕迹的增删放在同一张卡**（旧残留退不掉、条数一多就刷屏）——
            //   折叠 + 逐条删 + 全部清掉 + 加一条；默认收起，不占地方 ✓
            {
                const traceSec = section('身体痕迹', {
                    collapsible: true,
                    open: false,
                    help: [
                        '这一块是给你收拾残留、补记录的：插件只会按夜晚自己消退，不会自己删',
                        '每一行右边 ✕ 删掉那一条；下面那颗是把这个人身上的痕迹全清掉',
                        '最下面是手动补一条：跟推演记的那套一模一样，之后照常按夜衰减',
                    ],
                });
                const tb = traceSec.querySelector('.bc-section-body');
                const trPart2 = textInput('', () => {}, { placeholder: '例：颈部 / 大腿内侧' });
                const trKind2 = textInput('', () => {}, { placeholder: '例：吻痕 / 指痕' });
                // ★ 档位改成点选（四档）：手打 1~4 得先记住"4 是深层"，容易填错 ✓
                let trLevelPick = 1;
                const trLvSw = h('div', { class: 'bc-modesw', style: { marginTop: '4px' } });
                const paintLv = () => {
                    clear(trLvSw);
                    TRACE_LEVELS.forEach((lab, i) => {
                        const on = trLevelPick === i + 1;
                        trLvSw.appendChild(h('div', {
                            class: 'bc-modesw-opt' + (on ? ' active' : ''),
                            text: lab,
                            onclick: () => { trLevelPick = i + 1; paintLv(); },
                        }));
                    });
                };
                paintLv();
                const paint = () => {
                    clear(tb);
                    let list = [];
                    try { list = listTraces(t.key); } catch { list = []; }
                    if (!list.length) {
                        tb.appendChild(h('div', { class: 'bc-hint', text: '这个人现在身上没有痕迹' }));
                    } else {
                        for (const x of list) {
                            tb.appendChild(h('div', { class: 'bc-row bc-row-wrap', style: { marginBottom: '6px' } },
                                h('span', { class: 'bc-label', text: String(x.part || '') + ' · ' + String(x.kind || '') + ' · ' + String(x.level || '') }),
                                h('div', { class: 'bc-spacer' }),
                                button('✕', () => {
                                    try { removeTrace(t.key, x.id); } catch { /* 忽略 */ }
                                    paint();
                                    try { refreshAll({ force: true }); } catch { /* 忽略 */ }
                                }, { title: '删掉这一条痕迹' }),
                            ));
                        }
                        tb.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                            button('全部清掉', () => {
                                try { clearTraces(t.key); } catch { /* 忽略 */ }
                                paint();
                                try { refreshAll({ force: true }); } catch { /* 忽略 */ }
                            }, { title: '把这个人身上的痕迹全清掉（不可撤销）' }),
                        ));
                    }
                    // ★ 加一条 —— 跟上面那份清单摆在一起（增删别隔太远 ✓）
                    tb.appendChild(h('div', { style: { marginTop: '10px' } },
                        h('div', { class: 'bc-row bc-row-wrap' },
                            h('div', { style: { flex: '1 1 140px' } }, field('加一条痕迹：部位', trPart2)),
                            h('div', { style: { flex: '1 1 130px' } }, field('哪种', trKind2)),
                        ),
                        h('div', { class: 'bc-row bc-row-wrap' },
                            trLvSw,
                            h('div', { class: 'bc-spacer' }),
                            button('加一条痕迹', () => {
                                const part = String(trPart2.value || '').trim();
                                const kind = String(trKind2.value || '').trim();
                                if (!part && !kind) { window.toastr?.warning?.('至少写清楚部位或者哪种痕迹'); return; }
                                try { addTraceManually(t.key, { part, kind, level: trLevelPick }); } catch { /* 忽略 */ }
                                trPart2.value = ''; trKind2.value = '';
                                trLevelPick = 1; paintLv();
                                paint();
                                try { refreshAll({ force: true }); } catch { /* 忽略 */ }
                            }, { title: '手动补一条痕迹：跟推演记的那套完全一样，之后照常按夜衰减 ✓' })),
                    ));
                };
                paint();
                body.appendChild(traceSec);
            }

            // ★★ 手改修正（改数值 ＝ 官方修改器）——
            //   你手填的 · 交回插件：
            //   点它就交回插件，并且**当场**把插件那份值算回来（能算的几格都算 ✓）。
            //   ⚠️ 一定要当场算：点完界面一动不动，玩家会以为没生效 ✗（做了要有反馈 ✓）
            const unlockField = (fieldKey, inputEl) => {
                try { clearProfileFix(t.key, fieldKey); } catch { /* 忽略 */ }
                let ok = false;
                try { ok = resnapProfileField(t.key, fieldKey); } catch { ok = false; }
                const now = ok ? String(t.profile?.[fieldKey] ?? '') : '';
                if (ok) {
                    if (inputEl) inputEl.value = now;
                    draft[fieldKey] = now;
                    profileAtOpen[fieldKey] = now;   // 比对基准跟着走，免得保存时又被记成"手改过" ✓
                }
                try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
                commit();
                // ★ 改数值 / 交回插件之后，最后一楼的「本楼状态」也要跟着改（她 2026-10-23 报的）
                try { syncLastFloorSnapshot(); } catch { /* 忽略 */ }
                try { refreshAllFloors(); } catch { /* 忽略：楼层面板没开着也无所谓 */ }
                refreshAll();
                window.toastr?.[ok ? 'success' : 'info']?.(ok
                    ? '已交回插件：这一格又跟着插件算的值走了'
                    : '已交回插件：这一格下一轮推演会按判定重拼');
            };
            for (const f of FIELD_DEFS) {
                // ★★ 2026-10-30（她报：快照里的近期性行为不更新）——
                //   这几格是**多行文本**，原来塞进单行 input ⇒ 一打开保存换行就被抹平，
                //   和"打开那一刻"的值不一样 ⇒ 被误判成"手改"，然后每轮把旧文本写回去 ✗
                //   ⇒ 多行的一律用多行框（由 `multiline` 那一项决定）✓
                const input = f.multiline
                    ? textArea(draft[f.key] ?? '', (v) => { draft[f.key] = v; }, { rows: 4 })
                    : textInput(draft[f.key] ?? '', (v) => { draft[f.key] = v; });
                inputs[f.key] = input;
                if (f.key === focusKey) firstFocus = input;
                const fixedNow = (() => { try { return isProfileFieldFixed(t.key, f.key); } catch { return false; } })();
                grid.appendChild(h('div', { class: 'bc-field-item' + (f.wide ? ' wide' : '') + (f.key === focusKey ? ' focused' : '') },
                    h('div', { class: 'bc-field-labelrow' },
                        h('label', { class: 'bc-label', text: f.label }),
                        fixedNow ? button('你手填的 · 交回插件', () => unlockField(f.key, input), {
                            title: '这一格你手改过：账没变就听你的，账变了（生了新的、换了一胎…）插件会自动接管；点它也可以立刻交回插件',
                        }) : null,
                    ),
                    input,
                ));

                // 胎儿 / 孩子那两个编辑器**从这里移走** ——
                //   「孩子」那页已经有完整的两段（还在肚子里的胎儿 ＋ 已出生的孩子），
                //   用的是同一个编辑器 ⇒ 这里再摆一份就是重复 ✗
            }
            body.appendChild(grid);
            // ★★ 「既成事实」区（官方修改器的后半段）—— 放在最下面：
            //   上面那几格是日常要改的，这一块是"流程跑不到的状态"才用 ⇒ 别把常用项挤下去 ✓
            body.appendChild(buildKnownFactsBox(t));

            setTimeout(() => {
                if (firstFocus) {
                    firstFocus.scrollIntoView({ block: 'center' });
                    firstFocus.focus();
                }
            }, 60);
        },
        onSave: () => {
            // ★★ 敏感带表（延后模式）：真改过才写，落地跟这颗保存一起 ✓
            //   （没碰那张表就一个字都不写 ⇒ 不会平白打上"手改"标记 ✗）
            try { flushZones?.(); } catch { /* 忽略：别挡保存 */ }
            // ★ 2026-10-26：孕周 / 预产期也吃这颗保存（只动真的改过的）
            try { pregApply?.(); } catch { /* 忽略 */ }
            for (const [k, el] of Object.entries(inputs)) {
                if (el) draft[k] = el.value;
            }
            t.profile = draft;
            // ⚠️ 这里**不再**写 `t.updatedAt` ✗ —— 那个字段现在专指"上次**推演**"，
            //   设置页名单里显示的就是它（原来手动改一次数值也会把它刷新成"刚刚"，
            //   用户会以为"插件在偷偷记录" ✓ 见 ui-settings.js 里那段说明）
            // ★ 2026-10-17：阶段名 / 进度 / 基础率**不再手填**（上面那三格已改成只读）⇒
            //   这里不再打 manualCycle 那种"锁死"标记 ✓
            // ★★ 手改修正：**动过哪一格就记一条修正**（plugin 那一轮算出来的值当基线 ✓）
            //   判据＝「打开时的值」和「现在这份草稿」不一样；没动过的照旧跟着插件走 ✓
            //   ⚠️ 记的是**修正**不是"永久锁"：账变了（生了新的 / 换了一胎）插件会自动接管 ✓
            for (const f of FIELD_DEFS) {
                const before = String(profileAtOpen[f.key] ?? '');
                const after = String(draft[f.key] ?? '');
                if (before === after) continue;
                try { setProfileFix(t.key, f.key, after, before); } catch { /* 记不上也不该挡保存 ✓ */ }
            }
            refreshRaw({ force: true });
            commit();
            // ★ 同理：改完数值把**最后一楼**那份快照的面板文字一起更新，并重画楼层面板 ✓
            try { syncLastFloorSnapshot(); } catch { /* 忽略 */ }
            try { refreshAllFloors(); } catch { /* 忽略 */ }
            refreshAll();
            const lockedCount = FIELD_DEFS.filter((f) => String(profileAtOpen[f.key] ?? '') !== String(draft[f.key] ?? '')).length;
            window.toastr?.success?.(lockedCount
                ? `已保存（你改过的 ${lockedCount} 格先听你的；账一变插件就自动接管）`
                : '已保存');
        },
    });
}

function showLog() {
    const runs = state().lastRun;
    // ★ 模型这一趟回的原文（2026-10-15 补的口子）：以前这里只有一个用量 JSON，
    //   我让人"去推演日志看原文"，可原文根本没存 ⇒ 谁也看不到 ✗
    const raw = state().lastJudgeRaw || null;
    modal({
        title: '推演状态',
        width: 760,
        build: (body) => {
            // ★ 这一趟没省到思考（接口不认 thinking）⇒ 说一句，别让玩家以为省了 ✗
            if (runs?.thinkDropped) {
                body.appendChild(h('div', { class: 'bc-hint', text: '这一趟接口不认「关闭原生思考」，插件已经去掉它重发过 ⇒ 这次的原生思考没省掉。换个认这个写法的接口，或者看看这次是不是走了酒馆后端转发（那条路带不了它）' }));
            }
            if (runs) body.appendChild(h('pre', { class: 'bc-pre', text: JSON.stringify(runs, null, 2) }));
            else body.appendChild(h('div', { class: 'bc-hint', text: '还没有推演过' }));

            // ★★ cot 单独拎出来（除了它给的 JSON，能不能看它实际思考了什么）——
            //   它"实际想了什么"就写在契约的 `cot` 里 ✓，可原来只把整份 JSON 铺出来 ⇒
            //   得在长串里自己找 ✗ ⇒ 提到最上面单独一块，原始回包仍留在下面（核对原话用 ✓）
            const cotText = (() => {
                if (!raw || !raw.text) return '';
                try {
                    const j = JSON.parse(raw.text);
                    const t0 = Array.isArray(j?.targets) ? j.targets[0] : null;
                    const c = t0?.cot ?? j?.cot;
                    return typeof c === 'string' ? c : (c ? JSON.stringify(c, null, 2) : '');
                } catch { return ''; }
            })();
            if (cotText) {
                body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                    h('span', { class: 'bc-label', text: '它这一轮的推演过程（cot）' }),
                    h('div', { class: 'bc-spacer' }),
                    button('复制这段', async () => {
                        try {
                            await navigator.clipboard.writeText(cotText);
                            window.toastr?.success?.('已复制推演过程');
                        } catch (e) {
                            console.warn('[Bodycord] 复制失败', e);
                            window.toastr?.warning?.('复制失败，可以手动选中下面的文字');
                        }
                    }, { title: '把这一轮的推演过程整段复制走' }),
                ));
                body.appendChild(h('pre', { class: 'bc-pre', text: cotText }));
            }

            // ★★ 2026-10-16（实际显示就是 3）：上面那块 cot、原始回包里的 cot、
            //   原始回包里的 zones.stim ⇒ 同一段推演过程在界面上出现两遍。
            //   ⇒ 把**原始回包里那一份 cot 折起来**（只影响展示；"复制原文"复制的仍是完整原文 ✓）
            //   找不到那一段就原样铺出来（宁可多显示一遍，也不要显示一份残缺的原文 ✗）
            const shownRaw = (() => {
                if (!raw || !raw.text || !cotText) return raw ? raw.text : '';
                try {
                    const esc = JSON.stringify(cotText).slice(1, -1);
                    const i = esc ? raw.text.indexOf(esc) : -1;
                    if (i < 0) return raw.text;
                    return raw.text.slice(0, i) + '（cot 见上面那块）' + raw.text.slice(i + esc.length);
                } catch { return raw.text; }
            })();

            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: '模型原始回包' }),
                h('span', { class: 'bc-hint', text: raw
                    ? `${new Date(raw.at).toLocaleString()}　${raw.chars} 字${raw.truncated ? '（太长，已截断）' : ''}`
                    : '还没存到' }),
                h('div', { class: 'bc-spacer' }),
                ...(raw ? [button('复制原文', async () => {
                    try {
                        await navigator.clipboard.writeText(raw.text);
                        window.toastr?.success?.('原文已复制');
                    } catch (e) {
                        console.warn('[Bodycord] 复制失败', e);
                        window.toastr?.warning?.('复制失败，可以手动选中下面的文字');
                    }
                }, { title: '把模型这一趟回的原文整段复制走' })] : []),
            ));
            if (raw) body.appendChild(h('pre', { class: 'bc-pre', text: shownRaw }));
            else body.appendChild(h('div', { class: 'bc-hint', text: '下一次推演之后，这里就会显示模型回的原文' }));
        },
    });
}

// ---------------------------------------------------------------------------
// 推演
// ---------------------------------------------------------------------------

async function doJudge(rejudge = [], opts = {}) {
    if (!chatOnlyGuard()) return;
    // ★★ 被排除的角色卡：手动推演也不给跑（2026-10-28）——
    //   界面上那些按钮本来就不出现了，这一条是**兜底**（老界面 / 外来的调用），
    //   而且它绝不静默：真有人点到就明说一句 ✓
    if (isCardExcluded()) {
        window.toastr?.info?.('这个角色卡没有启用推演');
        return;
    }
    if (busy) { window.toastr?.info?.('正在推演中…'); return; }
    const rejudgeKeys = Array.isArray(rejudge) ? rejudge.filter(Boolean) : [];
    busy = true;
    setBusy(true);
    // ★ 手动推演也发一个中止开关 —— 楼层那颗「不参与推演」照样能把它掐断 ✓
    //   （不然会留下一个坑：自动推演能取消、手动推演不能，用户会以为按钮坏了）
    // ★★ 顺手把"还在排队的那次自动推演"清掉：用户既然手动点了，
    //   15 秒后再来一次自动的就是白发一次请求 ✓
    // ★★ 而 `beginRun()` 现在是**抢占式**的：要是自动推演正在跑，它就先把那次掐断
    //   （规矩：自动推演的时候如果手动推演了，那就中断自动推演、按手动的来 ✓）
    const signal = beginRun();
    try { clearPending(); } catch { /* 忽略 */ }
    // ★ 界面立刻跟上（按钮换词 / 气泡弹出来）—— 不等下一次心跳 ✓
    try { syncJudgeState(); } catch { /* 忽略 */ }
    try {
        // ★ force：手动点「推演」= 强制重算当前这条候选（一层里 5 条候选的记录
        //   都应该存着，而不是每次都重新生成，除非手动重新生成推演 ✓）
        // ★ rejudge：带「重判许可」时也要 force —— 读记录读到的正是按旧设定算的那份 ✗
        // ★ allowNoSystemFloor：只给时光机那颗「重推这一楼」用（
        //   既然是重推历史楼层，就别卡"最后一楼必须是正文"✓ 快照落点另算，见 judge.js ✓）
        // ★ 补推（2026-10-21）：楼层那颗「补推这一楼」会递一个楼层号进来 ——
        //   有它就推那一楼（快照也记那一楼），没有就还是"推最后一楼" ✓
        const bfFloor = (opts && opts.floor !== null && opts.floor !== undefined) ? Number(opts.floor) : null;
        const r = await runJudge({
            signal, force: true, rejudge: rejudgeKeys,
            allowNoSystemFloor: !!(opts && opts.allowNoSystemFloor),
            floor: bfFloor,
        });
        if (r.ok) {
            const names = (r.updated || []).join('、') || '无变化';
            window.toastr?.success?.(
                rejudgeKeys.length ? `已按新设定重判：${names}`
                    : (bfFloor !== null ? `第 ${bfFloor} 楼补推完成：${names}` : `推演完成：${names}`),
            );
            refreshRaw({ force: true });
            commit();
        } else if (r.blocked) {
            // ★ 没有系统层的时候应该禁止推演：最新那一楼还是玩家自己的
            //   发言（没有正文）⇒ 如实说一句就行，别弹红色"失败" ✗
            window.toastr?.info?.(r.error);
        } else if (r.cancelled) {
            // ★ 2026-10-23 她报「停止推演弹两次」：手动取消的那条提示**按钮那边已经弹过了**
            //   （楼层那颗 / 悬浮球那颗 / 时光机那颗），这里再弹一条就是重复 ✗
            //   ⇒ 这条路只在"被后发起的那次接管"时说一句 ✓
            if (r.superseded) window.toastr?.info?.('这次推演被后发起的那次接管了');
            // ★ 2026-10-24（她报：时光机撤销之后，楼层里点推演没反应）——
            //   不是被接管、也不是自己取消，却什么都没弹 ⇒ 那才是"点了没反应"。
            //   这里补一句，让下回点的时候至少有话说 ✓
            else window.toastr?.warning?.('这次推演没跑到：' + String(r.error || '原因不明'));
        } else {
            window.toastr?.error?.('推演失败：' + r.error);
        }
    } catch (e) {
        // ★ 2026-10-24：以前这里只有 finally —— 中途抛错就变成"点了没反应"
        //   （异步函数抛出来的东西没人接，界面上一个字都不会说）✗
        console.warn('[Bodycord] 推演过程抛错', e);
        window.toastr?.error?.('推演没跑起来：' + String(e?.message || e));
    } finally {
        // ⚠️ 要带上自己那份 signal：这次要是被别人抢了，清掉就等于把新那次的开关弄丢 ✗
        endRun(signal);
        busy = false;
        setBusy(false);
        // ★ 跑完/失败/被中断都走这里 ⇒ 顺手把界面退回"没在跑"的样子 ✓
        try { syncJudgeState(); } catch { /* 忽略 */ }
        refreshAll();
    }
}

/**
 * 面板上的"忙"光标（`.bc-root.busy`）。
 * ⚠️ 球上那圈转圈**已经不画了**（2026-10-15，玩家定的：球可以被换成自定义图片，
 *   贴在上面的东西会压坏那张图 ✗）⇒ 现在"正在推演"靠**球旁边那颗气泡**说 ✓
 */
function setBusy(on) {
    els?.fab?.classList.toggle('busy', !!on);
    els?.root?.classList.toggle('busy', !!on);
}

// ★ 推演状态一变就立刻更新界面（手动 / 自动两条路都覆盖 ✓）——
//   放在这里注册：`syncJudgeState` 是函数声明（会提升），模块求值时就能拿到 ✓
onQueueChange(() => { try { syncJudgeState(); } catch { /* 忽略 */ } });

// ★ 把「推演一次」那把钥匙递给楼层面板（最后一楼那颗「推演这一楼」要用它；
//   中间那种"有正文但没推过"的楼层会递一个楼层号进来 = 补推 ✓）——
//   放在这里是因为 `doJudge` 是**函数声明**（会提升）⇒ 这一句在模块求值时就拿到它了 ✓
//   ⚠️ 不能让 ui-floors.js 反过来 import ui.js（会成环 ✗）—— 这条以前踩过
setJudgeHandler((floor) => doJudge([], { floor: (floor === null || floor === undefined) ? null : floor }));

// ---------------------------------------------------------------------------
// 呈现方式
//
// 聊天内 = **每个楼层下面挂一份该楼层的状态面板**（不是一个面板打天下），
// 这件事在 ui-floors.js 里做。这里只管「悬浮球要不要露出来」。
// ---------------------------------------------------------------------------

/**
 * 楼层面板：在真聊天里、且用户没关掉「在聊天里显示楼层面板」时才画。
 *
 * ★ 这里容易理解反，别再来一遍：
 *   关闭插件功能（总开关）之后：只关闭追踪之类的功能，不是把面板整个 BAN 掉 ✓
 *   —— 要护的是**面板本身**（悬浮球 + 面板，那两个是绑定的一个整体、也是唯一入口 ✓）；
 *   而「打开插件、但**关闭插件功能**之后，还在聊天界面下方显示
 *   那个**参与推演还是不参与**」是 ✗ ⇒ **楼层那排属于"推演/追踪"的功能面，该跟着总开关收掉** ✓
 *   （收/删一律取最保守的一档：只动明确点到的那一样，绝不顺手多收悬浮球/面板 ✗）
 */
export function floorsOn() {
    if (inRealChat() === false) return false;
    // ★★ 被排除的角色卡：楼层那排（含「推演这一楼」）整排不出现（2026-10-28）——
    //   它属于"推演 / 追踪"的功能面，跟总开关关掉时同一个口径（面板与悬浮球照留 ✓）
    if (isCardExcluded()) return false;
    if (settings().ui.showFloorPanel === false) return false;
    // ★ 总开关关掉时容易理解成"连楼层那排也照常"，那是把"面板不要 BAN"扩写了 ✗
    //   ⇒ 总开关关掉时，**只收楼层那排**（它属于"推演/追踪"的功能面）；
    //     ⚠️ **绝不动悬浮球和面板** —— 那两个是绑定的一个整体，也是唯一入口 ✓
    //     （教训：收/删这类破坏性动作一律取最保守的一档，绝不顺手多收 ✗）
    if (settings().enabled === false) return false;
    // 酒馆扩展管理器里被禁用 ⇒ 那是"整个扩展不存在"，界面该收（但悬浮球仍留着）
    try { if (isMyExtensionDisabled()) return false; } catch { /* 忽略 */ }
    return true;
}

/** 悬浮球永远留着，这是唯一的主入口 */
function fabNeeded() {
    return true;
}

/**
 * 根据「是否在聊天里 + 呈现方式」决定显示什么。
 * 离开聊天时一律强制回落到悬浮窗。
 *
 * 注意：它虽然被定时器高频调用，但**头像那一段是每次都刷的** ——
 *  因为「人设指纹变了才刷」那种省法只灵一次（有的人设都同名，
 *  指纹根本不动）。① 命中之后解析很便宜（一次属性读取 + 字符串比较），
 *  refreshAvatar 自己也会比 url === this._avatar 直接返回。
 */
export function syncPresentation() {
    if (!els) return;
    const s = settings();

    // 楼层面板的开合交给 ui-floors.js，这里只转达
    try { applyFloorPanel(floorsOn()); } catch { /* 忽略 */ }

    // ★ 有的宿主（TT 之类的手机壳 / 主题脚本）会重建 body 里的东西，把我们挂的节点摘掉 ⇒
    //   球和面板一旦脱离文档就**永远看不见**、也没有任何报错 ✗ ⇒ 心跳里发现掉了就挂回去 ✓
    try {
        if (!els.fab.isConnected) document.body.appendChild(els.fab);
        if (els.root && !els.root.isConnected) document.body.appendChild(els.root);
    } catch { /* 忽略 */ }

    els.fab.style.display = fabNeeded() ? '' : 'none';
    // ★ 球永远落在屏幕里（存档坐标来自别的设备 / 更大的窗口时会跑到屏幕外 ✗）
    if (!fabDragging) { try { clampFabIntoView(); } catch { /* 忽略 */ } }

    // ★ 聊天里不显示了，但**消失得有点慢** ——
    //   因为那个钟**只靠 15 秒一次的定时器**刷 ✗ ⇒ 一进聊天最多要等 15 秒才收起来 ✓
    //   ⇒ 在这里补一次：syncPresentation 本来就是"高频 + 切聊天时都会跑"的那一支 ✓（实测延迟 ≤ 1.2 秒）
    try { tickClock(); } catch { /* 忽略 */ }

    // ⚠️ 主题在这里**反复推**一次。syncPresentation 是被定时器高频调用的，
    //   所以内外主题一定会收敛 —— 只推一次的话，时序稍微不对（iframe 还没就绪、
    //   面板实例刚重建）那一次就白推了，表现为「外壳换了色、里面还是旧的」。
    const t = s.ui.theme || 'light';
    for (const v of statusViews) { try { v.panel?.setTheme(t); } catch { /* 忽略 */ } }

    // ---- 在酒馆里换了默认角色 → 面板头像要跟着换 ----
    // 面板只在**重建**时抓一次头像 ⇒ 在外面换人设之后得手动点「重抓」才更新。
    //
    // ⚠️ 别用「人设指纹变了才刷」这种省法 —— 它**只灵一次**：
    //   有的人设**名字完全一样**，name1 不变；而 default_persona
    //   在聊天里换人设时也不一定变 → 指纹压根没动 → 第二次就不刷了。
    //   而且指纹是先记下再刷，刷失败也当已处理，永远不会重试。
    //   所以改成**每次心跳都刷**：① 命中之后解析只是一次属性读取 + 字符串比较，
    //   不扫 DOM；refreshAvatar 自己也会比 `url === this._avatar` 直接返回。
    for (const v of statusViews) { try { v.panel?.refreshAvatar(); } catch { /* 忽略 */ } }

    // ★ 提醒气泡：这一支是"高频 + 切聊天都会跑"的 ⇒ 正好拿来问
    //   "要不要弹 / 要不要收" ✓（它只碰气泡，不碰悬浮球 ✓）
    // ★ 先问推演状态（它一变就会当场重画楼层那一行 + 换气泡档）；
    //   心跳这一趟是**兜底**（真正的即时更新靠 judge-queue.js 的 onQueueChange ✓）
    try { syncJudgeState(); } catch { /* 忽略 */ }
    try { syncReminderBubble(); } catch { /* 忽略 */ }
}

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------

function applyTheme() {
    const t = settings().ui.theme || 'light';
    els?.root?.setAttribute('data-theme', t);
    // 顺手同步易读模式（改完设置立刻生效，不用重开面板 ✓）
    els?.root?.setAttribute('data-vision', settings().visionMode === 'large' ? 'large' : 'normal');
    if (els?.fab) els.fab.dataset.theme = t;
    // ★ 悬浮歌词条也挂在 body 上 ⇒ 日夜/易读这两档它要自己带（跟气泡一个道理 ✓）
    if (lyricBar && lyricBar.isConnected) {
        lyricBar.dataset.theme = t;
        lyricBar.dataset.vision = settings().visionMode === 'large' ? 'large' : 'normal';
    }
    // ★ 番茄钟的球和气泡也挂在 body 上（跟歌词条一个道理）：日夜 / 易读两档要自己带 ✓
    for (const el of [timerBall, timerBubble]) {
        if (el && el.isConnected) {
            el.dataset.theme = t;
            el.dataset.vision = settings().visionMode === 'large' ? 'large' : 'normal';
        }
    }
    // ★★ 楼层那一行挂在**聊天消息**上（也不在 .bc-root 里）⇒ 同上，两档都要自己带 ✓
    //   切主题 / 切易读档时**现刷一次**（不然已经画在页面上的那几行还留在旧档 ✗）
    syncFloorLook();
    for (const v of statusViews) v.panel?.setTheme(t);
    // 易读模式也一起推给面板（它有自己的 iframe ✓）
    const _vis = settings().visionMode === 'large' ? 'large' : 'normal';
    for (const v of statusViews) v.panel?.setVision?.(_vis);
}

function toggleTheme() {
    const s = settings();
    s.ui.theme = (s.ui.theme === 'dark') ? 'light' : 'dark';
    save();
    applyTheme();
}

// ---------------------------------------------------------------------------
// 开合
// ---------------------------------------------------------------------------

export function openTab(tab) {
    if (!els) return;
    els.root.classList.add('show');
    // ★ 显示出来之后夹一次：存档里的坐标可能来自一个更大的窗口 ⇒ 不夹会有一半在屏幕外 ✓
    try { clampRootIntoView(); } catch { /* 忽略 */ }
    showPane(tab);
    applyTheme();
}

// Esc：在设置页就回状态页，在状态页就关面板
export function handleEsc() {
    if (!els?.root?.classList.contains('show')) return false;
    if (settings().ui.openTab === 'settings') { showPane('status'); return true; }
    closePanel();
    return true;
}

export function closePanel() {
    els?.root?.classList.remove('show');
    // ESC 之后它关闭的是主面板，图片还在屏幕上——
    //   那层大图是**外壳挂在 body 上**的（z-index 比面板还高）⇒ 关面板不会带着它走 ✗
    //   ⇒ 关面板时顺手收掉（两个视图都可能开着它，逐个收一遍 ✓）
    for (const v of statusViews) {
        try { v._closeStageZoom?.(); } catch { /* 忽略 */ }
    }
    // ★ 关面板时把面板里的**临时浮层**收掉（左下角头像那个菜单、搜索、历史、便签）。
    //   为什么必须在"关"的时候收：iframe 一直活着（为了不打断音乐 ✓），
    //   不收的话下次打开还挂着 ✗
    for (const v of statusViews) { try { v.panel?.resetTransientUI?.(); } catch { /* 忽略 */ } }
}

export function togglePanel() {
    // ⚠️⚠️ 这里的判断**故意只看酒馆扩展管理器那个开关**（= 整个扩展被宿主禁用了），
    //   **不看设置里的「插件总开关」** ✗ —— 那个开关只管"关闭追踪之类的功能"，
    //   不是把面板整个 BAN 掉 ✓
    //   ⇒ 总开关关掉之后，面板照样要能打开看数据 ✓，只是后台不推演、不注入 ✓。
    //   只有整个扩展被宿主禁掉时，才拦一下并告诉用户怎么回来。
    let extOff = false;
    try { extOff = isMyExtensionDisabled(); } catch { /* 忽略 */ }
    if (extOff) {
        try {
            window.toastr?.info?.('这个扩展在酒馆的「扩展」页面里被禁用了。到那里重新勾选 Bodycord，然后刷新页面');
        } catch { /* 忽略 */ }
        return;
    }

    if (els?.root?.classList.contains('show')) closePanel();
    else openTab(settings().ui.openTab || 'status');
}

/**
 * 数据变了：刷新呈现方式与所有正在显示的面板。
 *
 * 注意顺序：一定要先把结构化状态重新拼成面板文字（refreshRaw），
 * 再去刷新界面。否则在设置里改了补丁/敏感带，面板上看到的还是旧文字。
 */
export function refreshAll(opts = {}) {
    // ⚠️ 这里**故意不重建面板**（原来是「进/出聊天翻转时 _mountPanel()」，已经删掉）。
    //
    //   原因：音乐在关闭聊天和进入聊天的时候会暂停。
    //   面板外壳 `.bc-root` 是挂在 document.body 上的，跟聊天页无关，
    //   所以进出聊天本来什么都不用做。而 `_mountPanel()` 会先 `this.panel.destroy()`
    //   再把 host 清空 —— iframe 一销毁，里面正在放的音乐就断了 ✗。
    //   既然外壳不随聊天页变化，就别动它；数据由下面的 refreshRaw + update 刷新。
    try { refreshRaw({ force: opts.force === true }); } catch (e) { console.warn('[Bodycord] 重建面板文字失败', e); }
    syncPresentation();
    for (const v of statusViews) v.update();
    // 诊断面板开着的话顺手刷新，免得看到的是过期状态
    try { refreshDiag(); } catch { /* 忽略 */ }
}

/** 兼容旧调用 */
// 原来的 `export const refreshPanelData = refreshAll;` 全仓没有任何 import / 引用 ⇒ 已删掉 ✓


/**
 * ★ 设置页重画 —— 给「跟当前人设 / 当前聊天走」的东西用（名字、名单这种）。
 *
 * 起因：**在非聊天界面切换使用角色，名称切换会不同步** ✗
 *   根因：`renderSettingsPane()` 建完就把 `pane.dataset.ready = '1'`，
 *        之后再进设置页**一律早退**⇒ 页面里那些名字永远停在第一次建的那一刻 ✗
 *
 * ⚠️ 两条保护（重画是有代价的，别乱调）：
 *   ① **设置页没开着就别动**（省一遍重建，也不打扰用状态页的人 ✓）
 *   ② **正在里面打字就不动** —— 重画会把没保存的编辑清掉 ✗（焦点在 textarea 上就是这种情况）
 * @returns {boolean} 真的重画了吗
 */
export function refreshSettingsPaneForce() {
    if (!els) return false;
    if (settings().ui.openTab !== 'settings') return false;
    const pane = els.panes.settings;
    if (!pane || pane.dataset.ready !== '1') return false;
    try {
        const a = document.activeElement;
        if (a && a.tagName === 'TEXTAREA' && pane.contains(a)) return false;
    } catch { /* 忽略 */ }
    renderSettingsPane(true);
    return true;
}


/** 对象列表变了（新建/删除/换聊天）：状态视图需要重建切换条 */
/**
 * ★ 预览要推给面板的**一整份字段**（纯函数 ⇒ 可以单测"单人预览到底有没有数据" ✓）
 *
 * 为什么单独抽出来：**预览模式的单人模式一直没有数据** ⇒
 *   两个洞（都不是"样例没准备"）：
 *     ① 预览只落在**点了它的那一份面板**上（悬浮球那份 / 聊天内嵌那份是两个实例）；
 *     ② 面板**重建之后**没人重推（`render()` 建完面板就完事）。
 *   ⇒ 字段只在这一处拼，两个洞分别在 `applyPreviewToViews()` 与 `render()` 里兜住 ✓
 * ⚠️ **单人 / 多人两份都要给全**：漏一格的后果是"预览里那个频道永远空的"
 *   （受孕记录 / 推演记录 / 孩子 都这么漏过一次 ✗）⇒ payload 里每个"按对象"的字段
 *   在这里都必须有对应的 previewXxx（这条已经是 自测脚本 里的断言 ✓）
 */
export function previewPanelPayload({ on, multi, activeKey } = {}) {
    const pv = !!on;
    const pvMulti = pv && !!multi;
    // ★ 多人预览：**按对象**给出各自的样例文字 ✓（不然任何对象都拿到同一份，9 个人一模一样 ✗）
    return {
        previewRaw: pv ? demoPanelText() : '',
        previewRawFor: pvMulti
            ? Object.fromEntries(demoTargets().filter(t => t.raw).map(t => [t.key, t.raw]))
            : null,
        previewConception: pv ? demoConception() : null,
        previewConceptionFor: pvMulti
            ? Object.fromEntries(demoTargets().map((t, i) => [t.key, demoConceptionFor(Number.isFinite(t.demoIndex) ? t.demoIndex : i)]))
            : null,
        previewChat: pv ? demoChat() : null,
        previewJudgeLog: pv ? demoJudgeLog() : null,
        previewJudgeLogFor: pvMulti
            ? Object.fromEntries(demoTargets().map((t, i) => [t.key, demoJudgeLogFor(t.name, i)]))
            : null,
        previewContactsFor: pvMulti
            // ⚠️ 这里要用 `t.demoIndex`（**不算本人**的序号）—— 用 map 的 `i` 会错开一格，
            //   结果"这份对象自己的致孕方名单"和"他联系人样例里的人"对不上 ⇒ 点名字跳不过去 ✗
            ? Object.fromEntries(demoTargets().map((t, i) => [t.key, demoContactsFor(t.name, Number.isFinite(t.demoIndex) ? t.demoIndex : i)]))
            : null,
        previewContacts: (pv && !pvMulti) ? demoContacts() : null,
        previewAchievements: pv ? demoAchievements(pvMulti ? activeKey : '') : null,
        previewStages: pv ? demoStages(pvMulti ? activeKey : '') : null,
        previewChildren: pv ? demoChildren(pvMulti ? activeKey : '') : null,
        // ★ 「身体状态」那一页也要样例（不然预览里它永远是空的 ✗）
        //   ⚠️ 多人预览按对象给各自的（每个对象都不一样 —— 玩家拿预览当验收台 ✓）
        previewBodyState: pv ? demoBodyState(0) : null,
        previewBodyStateFor: pvMulti
            ? Object.fromEntries(demoTargets().map((t, i) => [t.key, demoBodyState(Number.isFinite(t.demoIndex) ? t.demoIndex : i)]))
            : null,
        previewActiveKey: pvMulti ? (activeKey || '') : '',
    };
}

/** 预览要落到**所有**面板实例上（悬浮球那份 ＋ 可能存在的聊天内嵌那份）✓ */
function applyPreviewToViews() {
    for (const v of statusViews) {
        try { v._applyPreviewToPanel(); } catch { /* 忽略 */ }
    }
}

export function rebuildStatusViews() {
    for (const v of statusViews) v.render();
}

/**
 * ★ 只重算"跟随楼层"的那几处提示（标题栏那颗「这一楼待推演 / 已排除 / 等推演」）——
 *   不动数据、不重建 DOM、**不碰 iframe 里的面板**。
 *
 * 为什么需要它（在没有推演的时候，主面板不显示那个还没推演的提示了）：
 *   手动推演档下 AI 写完一楼，`scheduleJudge()` 第一句就 return ⇒ 全程没有 `refreshAll()`
 *   ⇒ 胶囊停在上一轮的样子（隐藏着）。楼层面板自己会重画，标题栏这颗没人管 ✗
 *   ⇒ 楼层增删时外壳叫一次这里，成本就是给几颗 span 换文字 ✓
 */
export function refreshStatusHints() {
    for (const v of statusViews) {
        try { v._paintPending(); } catch { /* 忽略 */ }
    }
}

// ---------------------------------------------------------------------------
// 番茄钟 / 倒计时
//
// **加一个闹钟 —— 单独一个栏位可以做计时器 / 倒计时，
//   它绑定的是现实时间，能避免沉迷**；**并且时间要能自定义**
//   （理由：**玩和挂机是不一样的，挂在后台时用得上** ✓）
//
// ★ 分工：状态机在 `src/timer.js`（纯逻辑）；**这里负责三件看得见的事** ——
//   ① 悬浮球旁边那个小读数（挂机时不用点进去也知道还剩几分钟 ✓）
//   ② 到点了弹**浏览器系统通知**（电脑右下角 / 手机通知栏 ⇒
//      **切去别的软件、挂在后台也看得见** —— 页内气泡做不到这一点 ✓）
//   ③ 面板页签标题闪一下（第三道保险 ✓）
//
// ⚠️ **通知权限按"源"给**（localhost 是安全上下文，所以本机酒馆能用 ✓）。
//   权限只能由**用户自己点**，代码替不了 ⇒ 没给的时候退回页内气泡，功能照旧 ✓
// ---------------------------------------------------------------------------

let timerState = null;        // 外壳手上唯一那份计时状态（在 ui.js 里读/写 ✓）
let timerTickId = null;       // 每秒那下
// ★ 番茄钟的两块挂在 <body> 上的东西：自己的悬浮球（`timerBall`）+ 到点那个气泡（`timerBubble`）✓
//   ⚠️ 它们跟歌词条一个道理：**挂在 body 上 ⇒ 主题 / 易读模式要自己带** ✓

/** 设置里那两格（工作 / 休息 分钟数）—— 取不到就退回出厂 25 / 5 ✓ */


/** 浏览器系统通知发得出去吗 */
export function timerNotifyState() {
    try {
        const N = (typeof window !== 'undefined') ? window.Notification : null;
        if (!N) return { ok: false, perm: 'unsupported' };
        return { ok: N.permission === 'granted', perm: String(N.permission || 'default') };
    } catch { return { ok: false, perm: 'unsupported' }; }
}

/** 请求通知权限（⚠️ 只允许在玩家点了「开始」之后调 —— 浏览器要求用户手势 ✓） */
export function requestTimerNotifyPermission() {
    try {
        const N = (typeof window !== 'undefined') ? window.Notification : null;
        if (!N || typeof N.requestPermission !== 'function') return Promise.resolve('unsupported');
        if (N.permission === 'granted') return Promise.resolve('granted');
        const r = N.requestPermission();
        return (r && typeof r.then === 'function') ? r.then((x) => String(x)).catch(() => 'default') : Promise.resolve(String(N.permission || 'default'));
    } catch { return Promise.resolve('unsupported'); }
}

/** ★ 到点提醒：**按"看不看得见界面"分形态** ✓
 *   · 看不了界面（切走了 / 最小化 / 锁屏）⇒ 发**系统通知**（右下角 / 通知栏），那是唯一能看见的
 *   · 看着界面 ⇒ 弹**页内气泡**（挂在番茄钟悬浮球旁边）
 *   · 两种都不成立（没给权限）⇒ 页内气泡 + toast 兜底，**绝不能"到点了啥都没有"** ✗ */
function fireTimerNotice(v) {
    const rest = v.mode === 'rest';
    // ★ 标题那句**可自定义**（番茄钟的文字可以自定义 ✓）——
    //   留空回出厂（`timerBubbles()` 兜底）；前面固定挂插件名，好认是谁弹的 ✓
    const bb = timerBubbles();
    const title = 'Bodycord · ' + (rest ? bb.rest : bb.work);
    const body = rest ? '休息结束，回来接着计时' : ('这段计时结束了，要休息 ' + timerCfgOf().rest + ' 分钟吗');
    let shown = false;
    try {
        const N = (typeof window !== 'undefined') ? window.Notification : null;
        if (document.hidden && N && N.permission === 'granted') {
            const n = new N(title, { body, silent: true, tag: 'bc-timer' });
            try { n.onclick = () => { try { window.focus(); } catch { /* 忽略 */ } try { n.close(); } catch { /* 忽略 */ } openTimerView(); }; } catch { /* 忽略 */ }
            shown = true;
        }
    } catch (e) { console.warn('[Bodycord] 计时通知发不出去', e); }
    if (!shown) {
        // 看着界面：页内气泡（+ 一声轻响，默认开、可在设置里关 ✓）
        try { showTimerBubble(title, body); } catch { /* 忽略 */ }
        try { if (timerCfgOf().chime !== false) playTimerChime(rest); } catch { /* 忽略 */ }
    }
}

/** 页内气泡（挂在番茄钟那个悬浮球的旁边 ✓） */
let timerBubble = null;
// ⚠️ 把"画 / 关"暴露到 window 上**只为了自测**（模块内的东西外面拿不到，测不了就只好靠猜 ✗）
//   它不改任何状态、只多一个函数引用 ⇒ 没有副作用 ✓
try {
    if (typeof window !== 'undefined') {
        window.__bodycordShowTimerBubble = (t, b) => showTimerBubble(t, b);
        window.__bodycordCloseTimerBubble = () => closeTimerBubble();
    }
} catch { /* 忽略 */ }
function closeTimerBubble() {
    try { timerBubble?.remove(); } catch { /* 忽略 */ }
    timerBubble = null;
}
function showTimerBubble(title, body) {
    closeTimerBubble();
    const box = h('div', { class: 'bc-timer-bubble', id: 'bc-timer-bubble' },
        h('div', { class: 'bc-timer-bubble-head' },
            h('div', { class: 'bc-timer-bubble-title', text: title }),
            h('div', { class: 'bc-tb-sp' }),
            h('div', {
                class: 'bc-timer-bubble-x', title: '知道啦',
                onclick: (e) => { e.stopPropagation(); closeTimerBubble(); },
            }, h('span', { text: '✕' })),
        ),
        h('div', { class: 'bc-timer-bubble-body', text: body }));
    // ★ 点气泡本体 = "打开番茄钟那一页"；⚠️ 面板**没开着**的时候要先把它打开
    //   （"无法 X 掉"有一半可能是"点偏了、点到本体"，
    //    而面板没开着 ⇒ `openTimerView()` 找不到面板、什么都不做，看着就像"点了没反应" ✗）
    box.addEventListener('click', () => {
        closeTimerBubble();
        if (!openTimerView()) {
            try { togglePanel(); } catch { /* 忽略 */ }
            // 面板建好要一点时间 ⇒ 建完再翻到那一页 ✓
            setTimeout(() => { try { openTimerView(); } catch { /* 忽略 */ } }, 320);
        }
    });
    document.body.appendChild(box);
    placeTimerBubble();
}

/** 气泡贴着**番茄钟悬浮球**放（球在哪它就在哪，别用固定位置 ✗） */
function placeTimerBubble() {
    const box = timerBubble;
    if (!box) return;
    // ⚠️ 球藏起来的时候（到点那一刻就是：running 与 pausedMs 都刚被清）就拿它的
    //   **默认角落**当锚点（CSS 是 left:18 / bottom:18 / 76×76）—— 不然 rect 全是 0，
    //   气泡会飘到左上角去 ✗
    const ballShown = !!(timerBall && timerBall.isConnected && timerBall.style.display !== 'none');
    const r = ballShown
        ? timerBall.getBoundingClientRect()
        : { left: 18, right: 94, top: window.innerHeight - 94, height: 76 };
    const w = box.offsetWidth || 240;
    const hgt = box.offsetHeight || 80;
    // 默认放在球的**右边**；右边放不下就放左边 ✓
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 10);
    let top = r.top + r.height / 2 - hgt / 2;
    top = Math.max(8, Math.min(window.innerHeight - hgt - 8, top));
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
}

// ---------------------------------------------------------------------------
// 成就解锁气泡（右上角）—— 2026-10-18
//
// 为什么要有：成就现在是"记了但没存在感"，解锁了玩家也不知道 ✓
//   ⇒ 推演真的新增成就时，右上角滑出一张卡片（名字 + 因为 + 吐槽 + 对象）。
//
// 几条必须守住的：
//   ① **只弹"这一次真的新加"的**（store.js 只在新加时发事件；重开 / 读旧数据不弹 ✓）
//   ② 挂在 <body> 上 ⇒ 面板没开着也看得见；主题 / 易读模式要自己带 ✓
//   ③ 点卡片 = 打开「记录 → 成就」；✕ 只管关这一张（别顺手打开面板）
//   ④ 最多同时 4 张，新的在上，旧的先收 ✓
// ---------------------------------------------------------------------------
const ACH_TOAST_MAX = 4;
let achToastHost = null;

function achToastHostEl() {
    if (achToastHost && achToastHost.isConnected) return achToastHost;
    achToastHost = h('div', { class: 'bc-ach-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(achToastHost);
    return achToastHost;
}

// ★ 右上角不只我们在弹东西：酒馆自己的提示（推演成功 / 推演失败 / 存档提示…）也是右上角，
//   它们会直接压在成就卡片上面 ⇒ 弹卡片时量一下提示条的底边，把整摞往下让开 ✓
//   · 有提示 ⇒ 让到提示下面；提示自己收掉了 ⇒ 再回到 16px
//   · 卡片还在的那几秒里每 400ms 量一次（提示可能比卡片晚出现，也可能提前消失）
let achTopTimer = null;

function achToastReservedTop() {
    let bottom = 0;
    try {
        const tc = document.getElementById('toast-container');
        const r = tc && tc.children.length ? tc.getBoundingClientRect() : null;
        if (r && r.height > 0) bottom = r.bottom;
    } catch { /* 量不到就按默认位置 */ }
    return bottom > 0 ? Math.round(bottom + 10) : 16;
}

function syncAchToastTop() {
    const host = achToastHostEl();
    try { host.style.top = achToastReservedTop() + 'px'; } catch { /* 忽略 */ }
    const busy = host.children.length > 0;
    if (busy && !achTopTimer) {
        achTopTimer = setInterval(() => { try { syncAchToastTop(); } catch { /* 忽略 */ } }, 400);
    } else if (!busy && achTopTimer) {
        try { clearInterval(achTopTimer); } catch { /* 忽略 */ }
        achTopTimer = null;
    }
}

function closeAchToast(card, immediately) {
    if (!card || !card.isConnected) return;
    try { clearTimeout(card._bcAchTimer); } catch { /* 忽略 */ }
    card._bcAchTimer = null;
    if (immediately) { try { card.remove(); } catch { /* 忽略 */ } return; }
    try { card.classList.add('out'); } catch { /* 忽略 */ }
    setTimeout(() => { try { card.remove(); } catch { /* 忽略 */ } }, 200);
}

function closeAllAchToasts() {
    try {
        for (const el of Array.from(achToastHost?.children || [])) closeAchToast(el, true);
    } catch { /* 忽略 */ }
}

/** 点气泡 → 打开面板的「记录 → 成就」那一页（面板没开就先打开 ✓） */
function openAchievementsView() {
    try { openTab('status'); } catch { /* 忽略 */ }
    const go = () => {
        for (const v of statusViews) {
            const w = v?.panel?.iframe?.contentWindow;
            if (w && typeof w.__bodycordSwitchView === 'function') {
                // ★ 2026-10-28：这条成就不一定属于当前查看的对象 ⇒ 先切到「全部」，
                //   不然默认的「只看当前对象」会把刚弹出来的那条藏掉（她报过"点进去没有" ✓）
                try { w.__bodycordAchievementsShowAll?.(); } catch { /* 忽略 */ }
                w.__bodycordSwitchView('achievements');
                return true;
            }
        }
        return false;
    };
    // 面板刚建出来时 iframe 还没就绪 ⇒ 隔几拍再试（不重复切：成功后就不管了 ✓）
    let done = false;
    for (const delay of [120, 420, 900]) {
        setTimeout(() => {
            if (done) return;
            try { if (go()) done = true; } catch { /* 忽略 */ }
        }, delay);
    }
}

function armAchToast(card) {
    // ★ 停留时长读设置（2026-10-21）：默认 8 秒；填 0 ⇒ 不自动关，点 ✕ 才走 ✓
    //   ⚠️ 读不到设置就按默认，**别退回"不自动关"**（否则气泡会一直堆在右上角 ✗）
    const sec = (() => { try { return achToastSec(); } catch { return ACH_TOAST_SEC_DEF; } })();
    if (sec <= 0) return;                       // 0 = 手动关
    const seed = setTimeout(() => closeAchToast(card), sec * 1000);
    card._bcAchTimer = seed;
    // 鼠标停在上面就是在看 ⇒ 先别收；移开后再给同样长的时间 ✓
    card.addEventListener('mouseenter', () => {
        try { clearTimeout(card._bcAchTimer); } catch { /* 忽略 */ }
        card._bcAchTimer = null;
    });
    card.addEventListener('mouseleave', () => {
        if (card._bcAchTimer) return;
        card._bcAchTimer = setTimeout(() => closeAchToast(card), sec * 1000);
    });
}

function showAchievementToasts(items) {
    // ★ 设置里关掉气泡 ⇒ 成就照样记录，只是不弹（默认开 ✓）
    try { if (!achToastOn()) return; } catch { /* 读不到设置就照弹 */ }
    const list = (Array.isArray(items) ? items : []).filter((x) => x && String(x.name || '').trim());
    if (!list.length) return;
    const host = achToastHostEl();
    const s = settings();
    const theme = s.ui.theme === 'dark' ? 'dark' : 'light';
    const vision = s.visionMode === 'large' ? 'large' : 'normal';

    for (const it of list) {
        while (host.children.length >= ACH_TOAST_MAX) {
            closeAchToast(host.lastElementChild, true);
        }
        const card = h('div', {
            class: 'bc-ach-toast',
            dataset: { theme, vision },
            title: '点一下打开成就页',
        },
            h('div', { class: 'bc-ach-ico', text: '🏆' }),
            h('div', { class: 'bc-ach-main' },
                h('div', { class: 'bc-ach-kicker', text: '解锁成就' }),
                h('div', { class: 'bc-ach-name', text: String(it.name || '') }),
                it.why ? h('div', { class: 'bc-ach-why', text: '因为：' + it.why }) : null,
                it.target ? h('div', { class: 'bc-ach-target', text: '对象：' + it.target }) : null,
                it.quip ? h('div', { class: 'bc-ach-quip', text: '“' + it.quip + '”' }) : null,
            ),
            h('div', {
                class: 'bc-ach-x', title: '关掉', text: '✕',
                onclick: (e) => { e.stopPropagation(); closeAchToast(card); },
            }),
        );
        card.addEventListener('click', () => {
            closeAllAchToasts();
            openAchievementsView();
        });
        host.insertBefore(card, host.firstChild);   // 新的在上 ✓
        armAchToast(card);
    }
    // ★ 摆位要在插完之后做（那时才知道这一摞有多高、提示条有没有在弹 ✓）
    syncAchToastTop();
}

// 自测口（只多一个函数引用，不改状态 ✓）
try {
    if (typeof window !== 'undefined') window.__bodycordShowAchToasts = (items) => showAchievementToasts(items);
} catch { /* 忽略 */ }

/** 一声轻响：**代码合成**，不下载任何音频文件 ✓（设置里能关） */function playTimerChime(isRest) {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        const now = ac.currentTime;
        // 两个音：专注结束是"叮—咚"（往下走，提示该歇），休息结束是"咚—叮"（往上走，提示回来）✓
        const freqs = isRest ? [659.25, 880] : [880, 659.25];
        freqs.forEach((f, i) => {
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            const t = now + i * 0.16;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.18, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
            o.connect(g); g.connect(ac.destination);
            o.start(t); o.stop(t + 0.45);
        });
        setTimeout(() => { try { ac.close(); } catch { /* 忽略 */ } }, 1200);
    } catch { /* 放不出来就算了，别影响提醒本身 ✓ */ }
}

/** 把面板翻到「计时」那一页（面板还没开就先不管 ✓） */
function openTimerView() {
    try {
        for (const v of statusViews) {
            const w = v?.panel?.iframe?.contentWindow;
            if (!w || typeof w.__bodycordSwitchView !== 'function') continue;
            w.__bodycordSwitchView('timer');
            return true;
        }
    } catch { /* 忽略 */ }
    return false;
}

/** 面板要一份当前读数（打开那一页时问一次 ✓） */
export function timerSnapshot() {
    const v = timerView(timerState || loadTimer(), timerCfgOf());
    return Object.assign({}, v, {
        perm: timerNotifyState().perm, work: timerCfgOf().work, rest: timerCfgOf().rest,
        // ★ 面板那页要显示「隐藏 / 显示悬浮球」那颗按钮 ⇒ 得知道两件事：
        //   ① `ball`：设置里那颗总体开关（关着的话按钮没意义）② `ballHidden`：现在收没收起来 ✓
        ball: timerCfgOf().ball !== false,
        ballHidden: !!timerBallHidden,
    });
}

/** 把读数推给面板（每份面板各推一次 ✓）
 *  ★★ 面板**不该每秒都重新画**（没开始的时候没必要一直重画）—— 根因是两处：
 *       ① 心跳是**固定 1 秒**、不管跑没跑都在跳；② 每次跳完**无条件**推给面板 ⇒ 面板每秒重画一次 ✗
 *     ⇒ 现在：**读数没变就不推**（比一个结构指纹）；心跳那半见 `timerPump` ✓ */
let timerPushKey = '';
function pushTimerToPanel(force) {
    const snap = timerSnapshot();
    // 指纹里**不能有秒**：数字每秒都在变的话就等于没比 ✓（按"秒"对齐，同一秒内不重复推）
    const key = [snap.mode, snap.running ? 1 : 0, snap.paused ? 1 : 0,
        Math.round(Number(snap.remain || 0) / 1000), Math.round(Number(snap.over || 0) / 1000),
        Number(snap.rounds) || 0, String(snap.perm || ''), snap.work, snap.rest].join('|');
    if (!force && key === timerPushKey) return;
    timerPushKey = key;
    // ★ 面板没开着 / 没停在番茄钟那一页 ⇒ **一个字节都不推** ✓
    //   ⚠️ 例外：`force`（玩家真的按了一下）照推 —— 免得"按了没反应"看着像假死 ✓
    if (!force && !timerPageOpen()) return;
    for (const v of statusViews) {
        try { v.panel?._replyPanel?.('__bodycordTimerSet', snap); } catch { /* 忽略 */ }
    }
}

/* ★★ 番茄钟也需要一个"打开之后关闭番茄钟悬浮球"的按键 ✓
   ⚠️ **不是整体开关** —— 要的是把现在这颗隐藏掉，不是整体开关 ✓
   ⇒ `timerBallHidden` = **"把现在这颗球收掉"**（只活这一轮、**不落设置** ✓），跟设置里那颗
     "要不要有番茄钟悬浮球"的总开关**并存**（那个仍在 设置 → 时间与日历 → 番茄钟 ✓）；
     复位时机：下一次**开始**计时时回来（新一轮该有球 ✓）
   ⚠️ 这一行刻意**放到那三行声明之前** —— 有一条断言按"`buildTimerBall` 之前 900 字"找
     `timerBall / timerBallLast / timerKeepAlive`，插在它们后面会把那三行挤出窗口 ✗ */
let timerBallHidden = false;

/* ⚠️⚠️ 这三行**不能删**（删 `leafPetals()` 这类代码时容易被连带删掉），
   删了整个插件起不来：`timerBall is not defined` ✗
   —— `node --check` 与断言**全都不会红**（那是**运行期**错误）
   ⇒ 所以"全绿"不等于能用，改完必须真跑一次 ✓ */
let timerBall = null;
let timerBallLast = '';
let timerKeepAlive = null;      // 保活用的那个静音音频
// ★ **正在拖球**的时候为 true ⇒ 心跳/躲开那些周期性动作一律不动它（不这么做：拖一秒就位移 ✗）
let timerBallDragging = false;
/* ★★ **番茄那颗球要换成类似电子时钟的版本** ✓
/* ★★ 换的时候**别把电子的删错了** ✗ ⇒
   番茄那套（`.tomato` 皮肤 ＋ 绿蒂）**彻底删掉**，只留电子钟那一套（`.bc-timer-ball` 的基础样式 ✓）——
   皮肤常量、`.tomato` 类名、`bc-tb-leaf` 那个元素连根去掉了 ✓ */

/** ★ 番茄头上那五瓣叶（显示出来是一团红豆 ⇒ 绿蒂压根没渲染）
 *   ⚠️ **根因**：`dom.js` 的 `h()` 走 `document.createElement('svg')`，那是**HTML 命名空间下的假 svg**，
 *     里面的 `<path>` **永远不渲染** ✗（手写 HTML 的 SVG 才显示正常 ⇒ 光看截图看不出来 ✗）
 *   ⇒ 绿蒂改成**一张 data-URI 背景图**（画在 `style.css` 的 `.bc-tb-leaf` 里 ✓），
 *     这里只放一个空 span ✓；球的**播放/暂停图标同理**（现由 CSS 画 ▶ / ‖ ✓） */
function buildTimerBall() {
    const el = h('div', { class: 'bc-timer-ball', id: 'bc-timer-ball', title: '番茄钟' },
        // ★★ **只有它那个黑色屏幕可以换图贴上去** ⇒ 屏幕单独一个元素；
        //   屏幕里面再套一层 `.bc-tc-shot` 装玩家那张图 —— 这样**图能单独调透明度** ✓
        h('span', { class: 'bc-tc-screen', 'aria-hidden': 'true' },
            h('span', { class: 'bc-tc-shot', 'aria-hidden': 'true' })),
        h('span', { class: 'bc-tb-time', text: '25:00' }),
        h('button', { class: 'bc-tb-btn', type: 'button', title: '开始 / 暂停' },
            h('span', { class: 'bc-tb-ico', 'aria-hidden': 'true' })));
    // 中间那颗键：开始 / 暂停（⚠️ 要 stopPropagation，别让它顺带把页面打开了 ✓）
    // ★ 那颗球**不要蓝色高亮**（悬停高光放这里不好看 ✓）
    el.querySelector('.bc-tb-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        timerPanelAction(timerState && timerState.running ? 'pause' : 'start');
    });
    el.addEventListener('click', (e) => {
        // ★ 兜底：万一将来又有谁把指针捕获加回来，点到那颗键也**别去开界面** ✗
        //   —— 认得出就当成"按那颗键"处理 ✓
        if (e.target && e.target.closest && e.target.closest('.bc-tb-btn')) {
            timerPanelAction(timerState && timerState.running ? 'pause' : 'start');
            return;
        }
        closeTimerBubble(); openTimerView();
    });
    document.body.appendChild(el);
    // ★ 拖拽在这儿接（球是**按需建的**，所以不能只在 init 里接一次 ✓）
    //   ⚠️ 拖动了就不当点击（makeDraggable 内部判的 ✓）；点的那件事走上面那个 click ✓
    try {
        makeDraggable(el, el, {
            onClick: () => { /* 点由上面那个 click 处理，这里留空 ✓ */ },
            // ★ 拖动期间挂起"周期性写位置 + 躲开"（不这么做：拖一秒就位移 ✗）
            onDragStart: () => { timerBallDragging = true; },
            onDragEnd: () => { timerBallDragging = false; },
            onDrop: (rect) => {
                timerBallDragging = false;
                const t = settings().timer || (settings().timer = {});
                t.ballX = Math.round(rect.left);
                t.ballY = Math.round(rect.top);
                save();
                try { placeTimerBubble(); } catch { /* 忽略 */ }
            },
        });
    } catch (e) { console.warn('[Bodycord] 番茄钟悬浮球拖拽没接上', e); }
    return el;
}

/** ~~球上那个小图标（播放 / 暂停）用内联 SVG~~ —— **已删除** ✗
 *  原因：`h('svg')` 在 HTML 命名空间下**不渲染**（`dom.js` 没走 `createElementNS`）⇒
 *  那颗三角一直画不出来；现在播放/暂停**由 CSS 画**（`.bc-tb-ico` 的边框三角 / 两条竖杠 ✓） */

/* ★ 把颜色调深一档（给"壳色 → 描边色"用 ✓）—— 只认 `#rrggbb`，别的原样返回 ✓ */
function shadeHex(hex, k = 0.6) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const to = (h) => Math.max(0, Math.min(255, Math.round(parseInt(h, 16) * k)));
    const h2 = (n) => n.toString(16).padStart(2, '0');
    return '#' + h2(to(m[1])) + h2(to(m[2])) + h2(to(m[3]));
}

function applyTimerBall(v) {
    const s = timerState || loadTimer();
    // 什么时候在：**开着这个功能 + 计时确实有内容 + 没被"就地收掉"**（跑着 / 暂停在中间）✓
    const on = !!timerCfgOf().ball && (s.running || s.pausedMs > 0) && !timerBallHidden;
    if (!on) {
        if (timerBall) timerBall.style.display = 'none';
        // ⚠️ 这里**不关气泡**：到点那一刻 timerTick 正好把
        //   running / pausedMs 都清了 ⇒ 球按设计该消失，可"到点提醒"的气泡正是同一 tick
        //   刚弹出来的 —— 这边顺手 close 掉就等于"到点了啥都没有"，
        //   跟 fireTimerNotice 上面那条红线（绝不能到点没反馈 ✗）直接矛盾
        return;
    }
    if (!timerBall || !timerBall.isConnected) { timerBall = buildTimerBall(); timerBallLast = ''; }
    // ★★ **看不见番茄钟悬浮球** —— 真 BUG，就这一行 ✗
    //   CSS 里 `.bc-timer-ball { display: none }`（默认藏起来、不占地方），
    //   而写 `style.display = ''` —— **清空行内样式 ≠ 显示它**，
    //   只会退回 CSS 那条 `display:none` ⇒ **球永远不显示** ✗
    //   ⇒ 要显示就必须**明确写 flex**（它是个竖排 flex 容器 ✓）
    timerBall.style.display = 'flex';
    // 位置：拖过就听坐标（没拖过用 CSS 默认那个角落 ✓）
    //   ⚠️ 坐标读写都走 settings().timer —— 别读 timerCfgOf()：那份只带
    //     work / rest / ball / chime / keepAlive，**不带坐标** ⇒ 条件恒假，
    //     拖完不到一秒就被每秒的心跳拽回默认角落 ✗（两个事实源）
    // ★★★ **长按拖拽番茄钟悬浮球大概一秒就会位移** ✗ ——
    //   就是这条"每秒按存着的旧坐标写一遍位置"：**正拖到一半**时，那次心跳把球拽回旧位置 ✗
    //   （同族：悬浮歌词条拖拽弹回、日程/楼层"别整页重画"✓）
    //   ⇒ 两条修法：① **拖拽期间一律不碰位置、也不躲**（`timerBallDragging` ✓）；
    //              ② **值真变了才写 DOM**（别再每秒无脑写一遍 left/top ✓）
    if (!timerBallDragging) {
        const tcfg = (settings() && settings().timer) || {};
        const wantL = (tcfg.ballX != null && tcfg.ballY != null) ? tcfg.ballX + 'px' : '';
        const wantT = (tcfg.ballX != null && tcfg.ballY != null) ? tcfg.ballY + 'px' : '';
        if (timerBall.classList.contains('bc-positioned') !== !!wantL) {
            timerBall.classList.toggle('bc-positioned', !!wantL);
        }
        if (timerBall.style.left !== wantL) timerBall.style.left = wantL;
        if (timerBall.style.top !== wantT) timerBall.style.top = wantT;
    }
    const work = v.mode !== 'rest';
    const timeTxt = v.over > 0 ? '过 ' + fmtMs(v.over) : fmtMs(v.remain);
    const key = (work ? 'w' : 'r') + '|' + (v.running ? 'run' : 'stop') + '|' + timeTxt;
    if (key !== timerBallLast) {
        timerBallLast = key;
        timerBall.classList.toggle('rest', !work);
        timerBall.classList.toggle('paused', !v.running);
        timerBall.classList.toggle('over', v.over > 0);
        timerBall.querySelector('.bc-tb-time').textContent = timeTxt;
        // ⚠️ 播放 / 暂停那个图标现在是**纯 CSS 画的**（跑着 = ‖、停着 = ▶，看球身上的 `.paused` 类 ✓）
        //    —— 原来那行 `querySelector('.bc-tb-ico use')` 已经**删掉**了：
        //    `h('svg')` 在 HTML 命名空间下不渲染 ✗（同绿蒂那条），别再长回来 ✓
        timerBall.title = (work ? '专注' : '休息') + (v.running ? '中' : '（已暂停）')
            + '　点它打开番茄钟那一页';
    }
    // ★★ **只有它那个黑色屏幕可以换图贴上去，周围那一圈不替换** ✓
    //   ⇒ 图**贴到屏幕里那层**（`.bc-tc-shot`）上，**红壳 / 描边 / 顶上两颗小按钮一个字不动** ✓
    //   ＋ 另外两样：**① 壳的颜色可自定义**（`shellColor`，空 = 出厂红 ✓）；
    //     **② 图案的透明度可调**（`shotAlpha` 0~100 ⇒ 只影响那层图，屏幕底色照旧 ✓）
    try {
        const t = settings()?.timer || {};
        const img = t.ballImage || settings()?.ui?.fabImage || '';
        const screenEl = timerBall.querySelector('.bc-tc-screen');
        const shotEl = timerBall.querySelector('.bc-tc-shot');
        if (img) {
            timerBall.classList.add('has-img');
            if (shotEl) {
                shotEl.style.backgroundImage = `url(${img})`;
                shotEl.style.opacity = String(Math.max(0, Math.min(100, Number(t.shotAlpha ?? 100))) / 100);
            }
        } else {
            timerBall.classList.remove('has-img');
            if (shotEl) { shotEl.style.backgroundImage = ''; shotEl.style.opacity = ''; }
        }
        // 壳的颜色：空 ⇒ 用样式表里那组（出厂红 / 番茄那套 ✓）；填了 ⇒ 覆盖壳色，描边自动取深一档
        const shell = String(t.shellColor || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(shell)) {
            timerBall.style.setProperty('--tb-body', shell);
            timerBall.style.setProperty('--tb-line', shadeHex(shell, 0.55));
        } else {
            timerBall.style.removeProperty('--tb-body');
            timerBall.style.removeProperty('--tb-line');
        }
        if (screenEl) screenEl.setAttribute('aria-hidden', 'true');
    } catch { /* 忽略 */ }
    // 气泡跟着球走（球拖了、窗口变了，气泡别掉队 ✓）
    try { dodgeTimerBall(); } catch { /* 忽略 */ }
    try { placeTimerBubble(); } catch { /* 忽略 */ }
}

/**
 * ★★ 把球放到**谁都压不到的地方**（否则会"看不见番茄钟的悬浮球"，那一定是 BUG）
 *
 * 真因（实测）：球的落点在**屏幕左下角**，而插件面板 `.bc-root` 是 **94vw × 88vh 居中**
 *   ⇒ 四个角**全在面板覆盖范围里**（左右各只剩 3vw、上下各剩 6vh）✗
 *   ⇒ "躲开四个角"**根本躲不掉**（试一圈又回到左下角，还是被压着）✗
 *
 * ⇒ 定稿：**别躲角，放"屏幕底部正中"** —— 面板上下各留 6vh，屏幕最底下那一条是空的 ✓
 *   ⚠️ 只在**真的被挡**时才挪（玩家自己拖到哪儿、只要没被挡，就一个字都不动 ✓）；
 *   ⚠️ 面板下沿**真贴到屏幕底**（高窗口 / 小屏）时才退回"放右下角 + 靠 z-index 压过去" ✓
 */
function dodgeTimerBall() {
    const el = timerBall;
    // ★ **正拖着的时候别插手动它**（长按拖拽大概一秒就会位移 ✗ —— 同族第三次了 ✓）
    if (timerBallDragging) return;
    if (!el || !el.isConnected || el.style.display === 'none') return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const box = () => el.getBoundingClientRect();
    const FREE = 10;      // 球四周留的空隙
    const covered = (r) => {
        // 出界也算"被挡"（看不见跟被挡一样糟 ✗）
        if (r.left < FREE || r.top < FREE || r.right > vw - FREE || r.bottom > vh - FREE) return true;
        const others = [els?.root, els?.fab, lyricBar].filter((x) => x && x.isConnected && x !== el);
        for (const o of others) {
            let cs = null;
            try { cs = getComputedStyle(o); } catch { /* 忽略 */ }
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
            const b = o.getBoundingClientRect();
            if (b.width < 8 || b.height < 8) continue;
            const hit = !(r.right < b.left - 4 || r.left > b.right + 4 || r.bottom < b.top - 4 || r.top > b.bottom + 4);
            if (hit) return true;
        }
        return false;
    };
    if (!covered(box())) return;        // 没被挡 ⇒ 不动 ✓
    const w = el.offsetWidth || 76, h = el.offsetHeight || 76;
    const put = (left, top) => {
        el.classList.add('bc-positioned');
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
    };
    // ① 首选：**屏幕底部正中**（贴底 10px）—— 面板底下那条缝 ✓
    put(Math.round(vw / 2 - w / 2), vh - h - FREE);
    if (!covered(box())) return;
    // ② 次选：**屏幕底部靠右**（有些宿主右下角是空的 ✓）
    put(vw - w - FREE, vh - h - FREE);
    if (!covered(box())) return;
    // ③ 兜底：面板真铺满时，放底部正中**让 z-index 压过去**（层已抬到 99999 ✓）
    put(Math.round(vw / 2 - w / 2), vh - h - FREE);
}

/** ★ 保活（手机切后台切久了会被杀后台）——
 *   唯一真有帮助的办法是**让页面一直在出声**，所以这里放一段**听不见的循环音频** ✓
 *   ⚠️ 三条边界：① 手机杀后台/熄屏**拦不住**，只是降低概率；
 *      ② Wake Lock 那种正规 API 只在"看着页面"时有效、一切后台就释放 ⇒ 对这个场景没用 ✗；
 *      ③ 代价是**一直占着音频输出 + 费电** ⇒ 所以**默认关**，谁想挂机谁自己开 ✓ */
function applyTimerKeepAlive() {
    const on = !!timerCfgOf().keepAlive && !!timerState && (timerState.running || timerState.pausedMs > 0);
    try {
        if (on) {
            if (!timerKeepAlive) {
                timerKeepAlive = new Audio();
                timerKeepAlive.loop = true;
                // 4 秒的**静音** WAV（代码里拼的 base64，不往仓库里放文件 ✓）
                timerKeepAlive.src = 'data:audio/wav;base64,' + 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
                timerKeepAlive.volume = 0;
            }
            const p = timerKeepAlive.play();
            if (p && typeof p.catch === 'function') p.catch(() => { /* 浏览器不让自动播就静默算了 ✓ */ });
        } else if (timerKeepAlive) {
            try { timerKeepAlive.pause(); } catch { /* 忽略 */ }
        }
    } catch { /* 忽略 */ }
}

/** 把三样东西按当前状态刷一遍：悬浮球 / 保活 / 读数（⚠️ 不含推面板 ✓） */
function applyTimer() {
    const v = timerView(timerState || loadTimer(), timerCfgOf());
    applyTimerBall(v);
    applyTimerKeepAlive();
    return v;
}

/** ★★ 心跳：**跑着才每秒**（没开始的时候没必要让它一直重新画 ✓）
 *   · 跑着 ⇒ 每 1 秒一下（读数要跳 ✓）
 *   · 停着（没开始 / 暂停 / 刚跑完）⇒ **不跳**，只留一个 20 秒的"兜底对表"
 *     （兜底那一下不干别的，就是防止"跨标签 / 跨设备改了状态这边一直不知道" ✓）
 *   ⚠️ 别用固定 1 秒：那样没在计时的时候也在每秒重画，纯浪费 ✗ */
const TIMER_TICK_RUN_MS = 1000;
const TIMER_TICK_IDLE_MS = 20000;
let timerTickIdle = false;      // 现在用的是不是"停着"那一档（用来决定要不要换档 ✓）

/** 按当前状态切心跳档位（每一下 pump 之后都调一次 —— 跑了/停了要能立刻换档 ✓） */
function retuneTimerHeartbeat() {
    const running = !!(timerState && timerState.running);
    const wantIdle = !running;
    if (wantIdle === timerTickIdle && timerTickId) return;
    timerTickIdle = wantIdle;
    if (timerTickId) clearInterval(timerTickId);
    // 停着那档**保留** `applyTimer()`（球和气泡要跟着设置变）⇒ 但比每秒轻得多 ✓
    timerTickId = setInterval(timerPump, wantIdle ? TIMER_TICK_IDLE_MS : TIMER_TICK_RUN_MS);
}

/**
 * ★★ 番茄钟"状态变更取证"（症状：**点击悬停高光外面就直接暂停了**）
 *
 * 光靠鼠标事件把六个位置都点一遍复现不了 ⇒ **不猜，改成抓现场**：
 * 每次番茄钟状态真的变了（尤其 running true→false），
 * 就把「谁干的 + 调用栈 + 时刻」记进一个环（留最近 20 条）✓
 *
 * 下次再碰见，把这个环读出来，
 * 就能看到**是哪一行把暂停发出去的** —— 比再来十个"大概是…"有用得多 ✓
 */
const TIMER_TRACE = [];
function timerTrace(note) {
    try {
        const st = timerState || loadTimer();
        const stack = String(new Error().stack || '').split('\n').slice(2, 6)
            .map((s) => s.trim().replace(/^at\s+/, '').replace(/\(.*?\)$/, '')).join(' ← ');
        TIMER_TRACE.push({
            t: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            note: String(note || ''),
            running: !!st.running,
            paused: !!st.paused,
            remainMs: Math.round(Number(timerView(st, timerCfgOf()).remain) || 0),
            stack,
        });
        if (TIMER_TRACE.length > 20) TIMER_TRACE.shift();
    } catch { /* 忽略 */ }
}
/** 给诊断脚本 / 控制台读的入口（只读，不改任何东西 ✓） */
export function timerTraceDump() { return TIMER_TRACE.slice(); }
try { if (typeof window !== 'undefined') window.__bodycordTimerTrace = timerTraceDump; } catch { /* 忽略 */ }

/** 每秒那下（⚠️ 到点判定**走 timerTick**，不靠这里减出来的数字 ✓） */
function timerPump() {
    const running = !!(timerState && timerState.running);
    // ★ 停着那档：**没活就不干** —— 不重画、不推送、不碰 DOM（这才是"没开始就别每秒动" ✓）
    //   只有"这一段已经过点但还没报过"才需要再算一次（挂机回来的补报）✓
    if (!running) {
        const st = timerState || loadTimer();
        const needCatchUp = !!st.seg && !st.running && st.endsAt > 0 && st.endsAt <= Date.now()
            && st.alertedSeg !== st.seg;
        timerState = st;
        if (!needCatchUp) { retuneTimerHeartbeat(); return; }
        const r = timerTick(st, timerCfgOf());
        // ⚠️ 到点那份状态**必须落盘**（alertedSeg 是"这一段报过没"的唯一凭据）——
        //   只写内存的话，localStorage 里还是"running + 已过点 + alertedSeg 空"
        //   ⇒ 每次重载都会把同一段到点再报一遍 ✗
        timerState = r.fired ? saveTimer(r.state) : r.state;
        if (r.fired) fireTimerNotice(timerView(timerState, timerCfgOf()));
        applyTimer();
        pushTimerToPanel();
        retuneTimerHeartbeat();
        return;
    }
    const r = timerTick(timerState || loadTimer(), timerCfgOf());
    // ⚠️ 只在**真到点那一下**落盘（每秒都写 localStorage 没必要，还可能闪）——
    //   不落盘的话刷新会把同一段到点再报一遍 ✗
    timerState = r.fired ? saveTimer(r.state) : r.state;
    if (r.fired) {
        const v = timerView(timerState, timerCfgOf());
        fireTimerNotice(v);
    }
    applyTimer();
    pushTimerToPanel();
    retuneTimerHeartbeat();          // 跑了 / 停了 ⇒ 心跳跟着换档 ✓
}

/** ~~番茄钟球上那两个小图标（内联 SVG sprite）~~ —— **已删除** ✗
 *  原因同上：`h('svg')` 建的是 HTML 命名空间的假 svg，符号表其实也画不出来；
 *  现在播放 / 暂停由 CSS 画，**不再需要任何 sprite** ✓ */

/** 开机（外壳建立时调一次）：恢复上次的计时 + 起心跳 ✓ */
export function initTimer() {
    /* ★★★ **刷新之后番茄钟还在走 ⇒ 这要能选**：一个是刷新番茄钟重置，
       一个像现在这样。默认是刷新重置（连悬浮球都不显示）✓
       ⇒ `settings().timer.resetOnLoad`：**默认 true = 刷新就重置**（当没跑过 ⇒ 球也不出现 ✓）；
         false = 老行为（按现实时间接着走、到点了补报一次 ✓） */
    const resetOnLoad = timerCfgOf().resetOnLoad !== false;
    if (resetOnLoad) {
        try { timerState = timerClear(); } catch { timerState = loadTimer(); }
    } else {
        timerState = loadTimer();
    }
    // ⚠️ 挂机回来时"上一段早就过点了"要能补报一次 —— 否则那一轮等于白跑了 ✗
    //   （**重置那档不补报**：状态都清了，没什么可报的 ✓）
    if (!resetOnLoad) {
        try {
            const r = timerTick(timerState, timerCfgOf());
            // 补报过的那段要落盘，否则下次重载还会再报一遍 ✓
            timerState = r.fired ? saveTimer(r.state) : r.state;
            if (r.fired) fireTimerNotice(timerView(timerState, timerCfgOf()));
        } catch { /* 忽略 */ }
    }
    applyTimer();
    // ★ 心跳按状态起档（跑着 1 秒 / 停着 20 秒兜底）—— 别无条件 1 秒 ✗
    timerTickIdle = !(timerState && timerState.running);   // 强制重算一次档位
    timerTickId = null;
    retuneTimerHeartbeat();
    // 窗口大小变了 ⇒ 把气泡的位置重算一下（球是 fixed 的，自己会跟着走 ✓）
    if (!initTimer._hooked) {
        initTimer._hooked = true;
        window.addEventListener('resize', () => { try { placeTimerBubble(); } catch { /* 忽略 */ } });
    }
}

/** 面板按了按钮 ⇒ 在这儿改状态（**面板自己不存任何真相** ✓） */
export function timerPanelAction(action, arg) {
    const cfg = timerCfgOf();
    const s = timerState || loadTimer();
    // ★ 取证：把"谁按的、按之前是什么状态"记一笔（复现"莫名暂停"要用 ✓）
    timerTrace('动作 ' + action + (arg === undefined ? '' : ':' + arg) + '（之前 running=' + !!s.running + '）');
    if (action === 'toggle') {
        // ★ 主按钮那一颗：**该开始还是该停，由这里判**（外壳手上那份状态才是准的 ✓）
        //   ⚠️ 别让面板拿它自己那份读数去猜 —— 面板可能还没收到最新推送 ⇒ 猜错 ✗
        if (timerNotifyState().perm === 'default') {
            requestTimerNotifyPermission().then(() => { pushTimerToPanel(); }).catch(() => { /* 忽略 */ });
        }
        timerBallHidden = false;      // ★ 新一轮开始 ⇒ 被收掉的球回来 ✓
        timerState = s.running ? timerPause(s) : timerStart(s, cfg);
    } else if (action === 'ballHide') {
        // ★★ 把按键做在面板的番茄钟页 ——
        //   **只把现在这颗球收起来**（不落设置、不动设置里那颗总开关 ✓）
        //   口径：不是整体开关，要的是隐藏掉现在这颗 ✓
        timerBallHidden = !timerBallHidden;
    } else if (action === 'start') {
        // ★ 浏览器要求"用户手势"才能要通知权限 ⇒ 就挂在这一下上 ✓
        if (timerNotifyState().perm === 'default') {
            requestTimerNotifyPermission().then(() => { pushTimerToPanel(); }).catch(() => { /* 忽略 */ });
        }
        timerBallHidden = false;      // ★ 同上：开新一轮 ⇒ 球回来 ✓
        timerState = timerStart(s, cfg);
    } else if (action === 'pick') {
        // ★ 「这一段多久」那颗（5 / 15 / 25 / 45 分 或自定义）—— **只选中、不开跑** ✓
        //   ⚠️ **点击数字 / 专注 / 休息不要直接开始，这不符合常理。** ✓
        //   （"点了就开跑"那套违背了"选长度"和"开始"是两件事 ✓）
        timerState = timerSetMinutes(s, arg);
    } else if (action === 'pickMode') {
        // ★ 「专注 / 休息」同理：切了就停在"这一档、按默认长度"，玩家自己点开始 ✓
        timerState = timerSetMode(s, arg, cfg);
    } else if (action === 'pause') {
        timerState = timerPause(s);
    } else if (action === 'reset') {
        timerState = timerReset(s, cfg);
    } else if (action === 'mode') {
        timerState = timerSetMode(s, arg, cfg);
    } else if (action === 'minutes') {
        timerState = timerSetMinutes(s, arg);
    } else if (action === 'roundsReset') {
        const n = loadTimer();
        n.rounds = 0; n.roundsAll = 0; n.roundDay = '';
        timerState = saveTimer(n);
    } else {
        return timerSnapshot();
    }
    applyTimer();
    // ★★ **面板上的数字没有在倒计时** —— 真因在这儿：
    //   心跳**等下一下才换档**（停着那档是 20 秒一次）⇒ 按下"开始"之后，
    //   最长要等 20 秒才切回每秒 ⇒ 数字**看着就是不走** ✗
    //   ⇒ 状态一变（开始 / 暂停 / 换长度 / 重来）**立刻换档** ✓
    retuneTimerHeartbeat();
    // ★ 玩家**真的按了一下** ⇒ 这一下必须推给面板（`force`）——
    //   别被那个"读数没变就不推"的指纹挡掉（按了"开始/暂停"却没看见变化就成假死了 ✗）
    pushTimerToPanel(true);
    // ★ 取证：变动之后的状态也记一笔（顺带能看出"是谁把它从跑着改成停着" ✓）
    timerTrace('动作生效 → running=' + !!(timerState && timerState.running));
    return timerSnapshot();
}

// ---------------------------------------------------------------------------
// 拖拽 / 摆放
// ---------------------------------------------------------------------------

/**
 * 「手机形态」的判据（面板整屏、不能拖）。
 *
 * ★ 这个字符串必须和另外三处**逐字相同**，改一处忘一处就静默失效：
 *   · `style.css` 里「手机整屏」那条 @media
 *   · `assets/bodycord.html` <style> 里「手机整屏」那条 @media
 *   · `assets/bodycord.html` JS 里的 `PHONE_MQ`
 *   （`_analysis/_shell-geom-check.mjs` 会把这四处比对一遍 ✓）
 *
 * ① `max-width: 560px` ＝ 竖着拿的手机（桌面把窗口拖窄也自动走这一档 ✓）
 * ② 触屏 ＋ 矮屏 ＝ **横着拿的手机**：横过来有 800 多宽，光看宽度会被当成平板 / 电脑，
 *    可 88vh 只剩 330 上下，两栏挤在那点高度里很难用 ✗
 *    带 `hover:none` 是为了别误伤桌面：鼠标设备怎么把窗口拉矮都不会命中 ✓
 */
export const PHONE_MQ_TEXT = '(max-width: 560px), (hover: none) and (max-height: 520px)';
const PHONE_MQ = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia(PHONE_MQ_TEXT) : null;

/** 现在是手机形态（整屏、不能拖、不能贴顶贴底）吗 */
export function isPhoneViewport() { return !!(PHONE_MQ && PHONE_MQ.matches); }

function placeRoot(root) {
    // ★ 手机形态（整屏）：面板铺满屏幕、也拖不动 ⇒ **存档里那对 panelX / panelY 必须让位**，
    //   否则从桌面拖过来的旧坐标会把整屏面板顶歪 ✗
    //   （style.css 那条 `.bc-root.bc-positioned{left:0!important}` 是同一件事的兜底 ✓）
    if (isPhoneViewport()) {
        root.classList.remove('bc-positioned');
        root.style.left = '';
        root.style.top = '';
        root.style.transform = '';
        return;
    }
    const s = settings();
    if (s.ui.panelX != null && s.ui.panelY != null) {
        root.classList.add('bc-positioned');
        root.style.left = s.ui.panelX + 'px';
        root.style.top = s.ui.panelY + 'px';
    } else {
        // ★ 回默认 = 回屏幕中央：CSS 里 `.bc-root` 靠 `inset:0` ＋ `margin:auto` 居中
        //   （**不再用** `transform:translate(-50%,-50%)` —— 面板里装着 iframe，
        //     "父级 transform ＋ 圆角 ＋ 裁切"会让内嵌内容偶发整块画错位，见 style.css 那条说明 ✓）
        //   ⚠️ 行内那些定位还是要一起清干净：left / top / transform 都可能被
        //   拖拽或贴顶贴底写过，只清当前这一支用到的就会留一半 ⇒ 复位看着蹦 ✗
        root.classList.remove('bc-positioned');
        root.style.left = '';
        root.style.top = '';
        root.style.transform = '';
    }
}

/**
 * 把面板夹回窗口内（只改这次的显示位置，**不动存档**）。
 *
 * 为什么要有它：`panelX / panelY` 是在**当时的窗口大小**下拖出来的。
 * 换个更小的窗口 / 更小的屏，那对坐标会把面板顶出屏幕（右侧和下侧看不见），
 * `style.css` 里 ≤900 那档给拖过的面板写了明确尺寸，尺寸一变大就更容易顶出去 ✓
 * ⇒ 每次打开 / 窗口尺寸变化时夹一次：
 *   · 横向要求整块都在屏幕内（左右各留 4px）—— 她在窄窗口里撞上的就是这条
 *   · 纵向：**放得下就整块放进来**；真放不下时至少让顶栏那条留在屏幕里（48px）✓
 */
function clampRootIntoView() {
    const root = els?.root;
    if (!root) return;
    // 手机形态铺满整屏，没什么可夹的 ✓
    if (isPhoneViewport()) return;
    const r = root.getBoundingClientRect();
    // display:none 的时候尺寸是 0 ⇒ 这时候不夹（等真正显示出来那次再夹 ✓）
    if (!r.width || !r.height) return;
    const maxX = Math.max(4, window.innerWidth - r.width - 4);
    const maxY = Math.max(4, Math.min(window.innerHeight - r.height - 4, window.innerHeight - 48));
    const nx = Math.min(Math.max(4, r.left), maxX);
    const ny = Math.min(Math.max(4, r.top), maxY);
    if (Math.abs(nx - r.left) < 0.5 && Math.abs(ny - r.top) < 0.5) return;
    root.classList.add('bc-positioned');
    root.style.left = nx + 'px';
    root.style.top = ny + 'px';
    root.style.transform = 'none';
}

function makeDraggable(el, handle, opts = {}) {
    let dragging = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;

    handle.addEventListener('pointerdown', (e) => {
        // ⚠️ 只认左键。原来没判鼠标键 —— 右键也会当成拖拽起手，
        //   松手时因为「没移动」反而触发了 onClick，于是右键悬浮球会顺带打开面板。
        if (e.button !== 0) return;
        // ★ 给"锁住位置"留的钩子（悬浮歌词条用 —— 锁上就拖不动 ✓）
        //   不传就照旧能拖（悬浮球 / 面板那边一个字不用改 ✓）
        if (typeof opts.canDrag === 'function' && !opts.canDrag()) return;
        if (e.target.closest('button, input, select, textarea, .bc-tab, .bc-icon-btn, .bc-toggle, .bc-pill, .bc-tool, .bc-pill-input')) return;
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY;
        // ★ 告诉调用方"开始拖了" —— 好让周期性的重画**别在这期间动它** ✓
        try { opts.onDragStart?.(); } catch { /* 忽略 */ }
        const r = el.getBoundingClientRect();
        sl = r.left; st = r.top;
        el.classList.add('bc-positioned');
        el.style.left = sl + 'px';
        el.style.top = st + 'px';
        try { handle.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
        document.body.style.userSelect = 'none';
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        let nx = sl + dx, ny = st + dy;
        nx = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, nx));
        ny = Math.max(4, Math.min(window.innerHeight - 40, ny));
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        // ★ 告诉调用方"正在拖/拖到哪了" —— 贴在球旁边的那个提醒气泡
        //   靠它**实时跟**（只有 1.2 秒一次的心跳时，拖起来气泡会落在后面 ✗）
        try { opts.onMove?.(); } catch { /* 忽略 */ }
    });

    const end = (e) => {
        if (!dragging) return;
        dragging = false;
        try { opts.onDragEnd?.(); } catch { /* 忽略 */ }   // ★ 拖完了 ⇒ 让周期性重画重新接管 ✓
        try { handle.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
        document.body.style.userSelect = '';
        if (!moved) { opts.onClick?.(); return; }
        opts.onDrop?.(el.getBoundingClientRect());
    };
    handle.addEventListener('pointerup', end);
    // ★ 被系统打断（手机上滚动手势接管 / 来电等）也算"拖完了" ⇒ 必须通知调用方，
    //   不然调用方那边的"正在拖"标记会一直卡在 true（心跳就再也不帮它归位 ✗）
    handle.addEventListener('pointercancel', () => {
        const was = dragging;
        dragging = false;
        document.body.style.userSelect = '';
        if (was) { try { opts.onDragEnd?.(); } catch { /* 忽略 */ } }
    });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

/**
 * 接好悬浮球的拖拽与点击。
 *
 * **必须早于建面板调用** —— 见 initUI 里的注释：
 * 一个面板异常不该让悬浮球也变成摆设。
 */
function attachFabHandlers() {
    if (!els?.fab) return;
    makeDraggable(els.fab, els.fab, {
        onClick: () => {
            // ★ 长按刚开过快捷菜单 ⇒ 这一次"点击"要吃掉（长按本来就只该等于开菜单 ✓
            //   不然菜单还开着、面板被同时打开 ✗）
            if (fabHoldOpened) { fabHoldOpened = false; return; }
            try { togglePanel(); } catch (e) { console.error('[Bodycord] 开面板失败', e); showStartupError(e); }
        },
        // ★ 拖的期间别让心跳里的 clampFabIntoView() 把球拽回存档位置 ✓
        onDragStart: () => { fabDragging = true; },
        // ★ 拖球时让贴在它旁边的提醒气泡**实时跟** ✓（不实时跟容易出现位移 BUG）
        onMove: () => followBubbleToFab(),
        onDragEnd: () => { fabDragging = false; try { placeReminderBubble(); } catch { /* 忽略 */ } },
        onDrop: (rect) => {
            fabDragging = false;
            fabHoldOpened = false;      // 拖过 ⇒ 不是长按那一次，别再吃掉后面的点击 ✓
            const s = settings();
            s.ui.fabX = Math.round(rect.left);
            s.ui.fabY = Math.round(rect.top);
            save();
        },
    });
    // ★ 窗口尺寸一变也让气泡跟一次（原来得等下一次心跳 ⇒ 会错位一秒多 ✗）
    //   ★ 同时把球夹回屏幕里（转屏 / 把窗口拖窄之后球不能跑到屏幕外 ✓）
    const onViewportChange = () => {
        if (!fabDragging) { try { clampFabIntoView(); } catch { /* 忽略 */ } }
        followBubbleToFab();
    };
    try { window.addEventListener('resize', onViewportChange); } catch { /* 忽略 */ }
    try { window.visualViewport?.addEventListener?.('resize', onViewportChange); } catch { /* 忽略 */ }
}

/** 开局就炸的时候，别让界面一片空白 —— 把错误画在面板位置上 */
function showStartupError(e) {
    try {
        const host = els?.host || els?.root;
        if (!host) return;
        clear(host);
        host.appendChild(h('div', { class: 'bc-error' },
            h('div', { text: '插件启动时出错了' }),
            h('div', { class: 'bc-hint', text: String(e?.message || e) }),
            h('div', { class: 'bc-hint', text: '详情见浏览器控制台（F12）。把这张卡片截图发给开发者即可' }),
        ));
    } catch { /* 连错误都画不出来就算了 */ }
}

export function initUI() {
    if (els) return;
    const fab = buildFab();
    const shell = buildPanelShell();
    els = { fab, ...shell };

    applyFabLook();
    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 15000);

    // 聊天 DOM 会被酒馆重建，定期把内嵌面板挪回该在的位置
    if (watcherTimer) clearInterval(watcherTimer);
    watcherTimer = setInterval(() => {
        syncPresentation();
    }, 1200);

    // ★ 「联系人」页里点了「添加致孕方」⇒ 外壳在面板消息里建完档、发个事件过来
    //   （⚠️ 不能让 bodycord.js 直接调 ui.js：那会形成循环依赖 ✗ ⇒ 用 window 事件 ✓）
    //   收到就重建视图（名字栏会出现新对象）+ 刷新面板数据 ✓
    window.addEventListener('bodycord:contactsAdded', () => {
        try {
            rebuildStatusViews();
            refreshAll({ force: false });
        } catch (e) { console.warn('[Bodycord] 添加联系人后刷新失败', e); }
    });

    // ★ 推演 / 手动补成就时，store.js 会发这个事件（只带**这一批真新加**的条目 ✓）
    //   ⇒ 右上角滑一张成就气泡（面板没开着也看得见 ✓）
    window.addEventListener('bodycord:achievementsAdded', (ev) => {
        try { showAchievementToasts(ev?.detail?.items || []); }
        catch (e) { console.warn('[Bodycord] 成就气泡显示失败', e); }
    });

    // ★ 面板里按 ESC、而它自己已经没有浮层可收 ⇒ 面板把 ESC 交回外壳
    //   （否则随手记按 ESC 的时候不会跟随主面板一起关闭）——走同一条 handleEsc（先退设置页、再关面板 ✓）
    window.addEventListener('bodycord:escFromPanel', () => {
        try { handleEsc(); } catch (e) { console.warn('[Bodycord] 面板 ESC 处理失败', e); }
    });

    // ⚠️ 先把悬浮球接好事件，再建面板。
    //   反过来的话（先 showPane 再 makeDraggable），面板里任何一个异常
    //   都会让 initUI 当场中断 —— 悬浮球的拖拽和点击全都没接线，
    //   症状就是「插件完全打不开、也拖不动」，一个局部 bug 炸掉整个插件。
    //   现在顺序反过来：**悬浮球先能用，面板坏了也还能拖、还能点开看报错。**
    attachFabHandlers();

    // 开局就把该显示的那一页建出来（不然打开面板是空的）
    //   包一层 try：建面板失败时给用户一个看得见的错误，而不是静默全死。
    try {
        showPane(settings().ui.openTab || 'status');
    } catch (e) {
        console.error('[Bodycord] 建面板失败', e);
        showStartupError(e);
    }

    // ★ 番茄钟：恢复上次的计时 + 起"每秒一下"的心跳 ✓
    //   ⚠️ 放在建面板**之后**：它要往各份面板推读数，面板得先在 ✓
    try { initTimer(); } catch (e) { console.warn('[Bodycord] 计时器初始化失败', e); }

    // Esc：在设置页就退回状态页，在状态页就关面板
    if (!els._onEsc) {
        els._onEsc = (e) => {
            if (e.key !== 'Escape') return;
            try { handleEsc(); } catch { /* 忽略 */ }
        };
        window.addEventListener('keydown', els._onEsc);
    }

    // 窗口尺寸变化时停靠面板要重新对齐
    if (!els._onResize) {
        els._onResize = () => {
            try { refreshAllFloors(); } catch { /* 忽略 */ }
            // ★ 窗口变小之后，按老坐标摆的面板会顶出屏幕 ⇒ 顺手夹一次（只动显示，不动存档 ✓）
            try { clampRootIntoView(); } catch { /* 忽略 */ }
        };
        window.addEventListener('resize', els._onResize);
    }

    placeRoot(els.root);
    makeDraggable(els.root, els.head, {
        // ★ 手机形态（整屏）下**不许拖**：拖出去就再也够不着，而且铺满屏幕也没有"位置"可言 ✓
        canDrag: () => !isPhoneViewport(),
        onDragStart: () => els.root.classList.add('bc-positioned'),
        onClick: () => { },
        onDrop: (rect) => {
            const s = settings();
            s.ui.panelX = Math.round(rect.left);
            s.ui.panelY = Math.round(rect.top);
            save();
            placeRoot(els.root);
        },
    });

    // ★ 形态在「手机 / 桌面」之间变（手机转竖屏、桌面把窗口拖窄、拖窄再拉回）⇒ 重新摆一次：
    //   进手机形态清掉坐标，回桌面重新应用存档里那对 panelX / panelY ✓
    if (PHONE_MQ) {
        const onPhoneFormChange = () => { try { placeRoot(els.root); } catch { /* 忽略 */ } };
        if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', onPhoneFormChange);
        else if (PHONE_MQ.addListener) PHONE_MQ.addListener(onPhoneFormChange);
    }

    els.root.classList.remove('show');
    syncPresentation();
}

export function applyFabLook() {
    const s = settings();
    const fab = els?.fab;
    if (!fab) return;
    if (s.ui.fabImage) {
        fab.classList.add('has-img');
        fab.style.backgroundImage = `url(${s.ui.fabImage})`;
        fab.querySelector('.bc-fab-icon')?.style.setProperty('display', 'none');
    } else {
        fab.classList.remove('has-img');
        fab.style.backgroundImage = '';
        fab.querySelector('.bc-fab-icon')?.style.setProperty('display', '');
    }
    fab.dataset.theme = s.ui.theme || 'light';
    if (s.ui.fabX != null && s.ui.fabY != null) {
        fab.classList.add('bc-positioned');
        fab.style.left = s.ui.fabX + 'px';
        fab.style.top = s.ui.fabY + 'px';
        clampFabIntoView();
    }
}

/**
 * ★ 2026-10-31：存档里那对悬浮球坐标夹回当前屏幕。
 * 为什么必须加：坐标是**按当时那块屏幕**存下来的 ⇒ 换到手机 / Luker 那种更窄的窗口，
 * 旧的 left/top 可能直接落在屏幕外 ⇒ 表现就是「**悬浮球不见了**」，
 * 而且代码路径一切正常（元素在、display 也在），最难查 ✗✓
 */
function clampFabIntoView() {
    const s = settings();
    const fab = els?.fab;
    if (!fab) return;
    if (s.ui.fabX == null || s.ui.fabY == null) return;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (!vw || !vh) return;
    const bw = fab.offsetWidth || 54;
    const bh = fab.offsetHeight || 54;
    const pad = 8;
    const nx = Math.min(Math.max(pad, Number(s.ui.fabX)), Math.max(pad, vw - bw - pad));
    const ny = Math.min(Math.max(pad, Number(s.ui.fabY)), Math.max(pad, vh - bh - pad));
    // ⚠️ 只改显示、**不改存档**：回到大屏时球还在原来那个位置 ✓
    const lx = Math.round(nx) + 'px';
    const ly = Math.round(ny) + 'px';
    fab.classList.add('bc-positioned');
    if (fab.style.left !== lx) fab.style.left = lx;
    if (fab.style.top !== ly) fab.style.top = ly;
}

export function resetFabPosition() {
    const s = settings();
    s.ui.fabX = null;
    s.ui.fabY = null;
    save();
    const fab = els?.fab;
    if (fab) {
        fab.classList.remove('bc-positioned');
        fab.style.left = '';
        fab.style.top = '';
    }
}

/** 把面板吸附到屏幕上/下半部分（贴顶 / 贴底） */
export function snapPanel(where) {
    const root = els?.root;
    if (!root) return;
    // ★ 手机形态下面板**铺满整屏**，没有"贴顶 / 贴底"可言 ⇒ 直接不动
    //   （不拦的话会把行内 left/top 写进去，退出手机形态之后面板就歪了 ✗）
    if (isPhoneViewport()) return;
    const s = settings();
    const w = root.offsetWidth || 420;
    const h = root.offsetHeight || 560;
    const x = Math.max(6, (window.innerWidth - w) / 2);
    const y = where === 'top' ? 6 : Math.max(6, window.innerHeight - h - 6);
    s.ui.panelX = x;
    s.ui.panelY = y;
    save();
    root.classList.add('bc-positioned');
    root.style.left = x + 'px';
    root.style.top = y + 'px';
    root.style.transform = 'none';
}

export function resetPanelPosition() {
    const s = settings();
    s.ui.panelX = null;
    s.ui.panelY = null;
    save();
    if (els) placeRoot(els.root);
}
