/**
 * ui-settings.js —— 「设置」页
 * 插件自己的 API 配置、更新时机、追踪对象模式、注入范围等等。
 */

import { settings, save, TARGET_MODES, ICON_SLOTS, customIcons, setCustomIcon,
    stagesOn, setStagesOn, stageImages, setStageImage, customStageCount,
    stageResidueMode, setStageResidueMode,
    stageCleanMode, setStageCleanMode,
    spermBellyOn, setSpermBellyOn, resetSpermBellyText,
    spermBellyTextIn, setSpermBellyTextIn, spermBellyTextOut, setSpermBellyTextOut,
    spermBellyTextVaginaIn, setSpermBellyTextVaginaIn, SPERM_BELLY_TIERS,
    stageTextOverride, setStageTextOverride, resetStageTextOverrides, customStageTextCount,
    periodMode, cycleModeLabel, isNeutralMode, childrenToMain, setChildrenToMain,
    stageTextOnly, setStageTextOnly,
    borrowOnFor, setBorrowOnFor, borrowFromFor, setBorrowFromFor,
    stageFetusOn, setStageFetusOn, stageCuts, setStageCuts,
    apiList, currentApi, setCurrentApi, addApi, updateApi, removeApi, apiCount,
    apiModeOf, API_MODES,
    listCalendarPresets, saveCalendarPreset, renameCalendarPreset, deleteCalendarPreset, CAL_PRESET_BUILTIN,
    holidayList, setHoliday, removeHoliday, holidaysOn, setHolidaysOn, lunarDatesOn, setLunarDatesOn,
    calendarBundle, applyCalendarBundle, looksLikeCalendarBundle, spanCapDaysOf, SPAN_CAP_DEF,
} from './settings.js';
// ★ 阶段插图：状态键 / 文字（走术语表）/ 当前该画哪张（推导全在 stages.js ✓）
//   ★ 图那半边是**分层**（阴道底图 6 档 ＋ 子宫层 6 档 ＋ 孕期 5 张 ＋ 叠加层 5 张）✓
import { STAGE_ORDER, stageTextOf, stageLayersFor,
    STAGE_LAYERS, STAGE_LAYER_LABEL,
    vaginaKeyOf, wombKeyOf, pregnantKeyOf, PREGNANT_STAGES } from './stages.js';
// ★ 「属于哪个大类」的选项表（一份来源：照抄 [异种扩展包 · 西方与通用] 那张表第一列 ✓）
//   ＋ 最前面的「人类」那一项（见 modules.js 的 XENO_CLASS_HUMAN ✓）
import { XENO_CLASSES, XENO_CLASSES_EAST, XENO_CLASS_HUMAN, RACE_NAME_SUGGESTIONS } from './modules.js';
// ★ 「上次推演」那行说人话（命中率 / 输入输出），口径只写在 tokens.js 一处 ✓
import { formatUsage } from './tokens.js';
// ★ 「这个角色的种族」那一格的读写走 params 的同一份 spec（锚点只写一处 ✓）
//   ⚠️ params.js 只 import settings / store ⇒ 这里 import 它不会成环 ✓
import { PARAM_SPECS, readParams, writeParams } from './params.js';
// ⚠️ import 的花括号里**不许写注释**（imports 测试的解析器会把注释当成标识符 ✗）——
//   所以"为什么引这两个"写在这儿：内嵌「子宫底图」那六档槽位要用 ✓
import {
    targetList, displayName, createTarget, removeTarget, setActive, state,
    lightTargetList, setTargetLight,
    resetAll, commit, userLabel, filterTargets,
    bodyLockOf, setBodyLockField, USER_KEY, xenoClassOf, setXenoClassOf, reportedBodyFlagOf, raceJudgeOf, setRaceManualOf,
    awarenessTierIdOf, setAwarenessTierIdOf,
    identOf, setIdentField, mergeTargets, setPeriodModeOf, periodModeOf, parseAliases,
    childrenOf, trackingRoster,
    activeCalendarNow, setCalendar, applyCalendarPreset, timeUnitNow,
    storyDateTimeNow, dateMode, shiftDateForward, shiftDateBackward, shiftDateBackwardFull, exportOnlyStateDates, applyRelDates, setPendingRelDates, FICTION_DATE_START,
    inRealChat, inChatPage, currentDate,
    decayTracesForElapsedDays,
    timeJumpSkipsBody, setTimeJumpSkipsBody, timeJumpSkipsBodyManual, setTimeJumpSkipsBodyAuto,
    timeJumpExceptKeys, setTimeJumpExceptKeys, findTargetByReportedName,
    SPERM_TIERS, SPERM_TIER_LABEL,
} from './store.js';
// ★ 往未来补：补完要**当场把该算的账算掉**（孕期状态 + 时间型结算 + 受精判定）✓
//   ⚠️ 这条不会成环：judge.js 只 import settings / store / params / prompt 那几个，不碰 ui-* ✓
import { settleAfterTimeShift, syncAfterTimeBack, splitStripTags } from './judge.js';
// ★ 历法那一套纯函数（界面只用它做校验、读数、判断现在是哪一档 ✓）
//   ⚠️ import 的花括号里**不许写注释**（imports 测试的解析器会把注释当成标识符 ✗）
import {
    isGregorian, isUniformCalendar, calendarSummary, makeUniformCalendar, monthsPerYear,
    MAX_MONTHS, MAX_DAYS_PER_MONTH, MAX_WEEK_LEN, calendarPrint, GREGORIAN,
    formatFictionDate, NUM_STYLES, checkStyle, TIME_UNITS, addDays, diffDays,
} from './fiction-date.js';
import { testConnection, listModels } from './api.js';
import { pickAndCompressImage, pickImageFile, humanBytes } from './image.js';
// ★ 阶段插图：图只存地址 ⇒ 走酒馆图片库那条路 ✓
import { saveStageImage, deleteNotesImage } from './notes-image.js';
import { ST, getCtx } from './st.js';
import { askArchiveName, applyPersonArchiveInteractive } from './ui-archive.js';
import { wiSection } from './ui-wi.js';
import { lunarSpecText } from './lunar.js';
import {
    listPersonArchives, savePersonArchive, deleteArchive, downloadArchive, archiveLabel, getArchive,
} from './archive.js';
import {
    h, clear, button, section, textInput, numberInput, textArea, select, toggle, modal, askConfirm, field, dropdown,
    groupHeading, helpButton, askText,
} from './dom.js';
// ★ 番茄钟那张卡单独一个文件（`src/ui-timer.js`）—— 这样它能被**单独挂进真浏览器点一遍** ✓
//   ⚠️ 它住**「时间与日历」页**：多久 / 提示音 / 保活讲的都是"时间"的事，不是头像 ✗
import { timerSection } from './ui-timer.js';
// ★ 角色卡排除（口径见 src/cardexclude.js 顶上那段）
import { currentCardAvatar, isCardExcluded, setCardExcluded, excludedCardList, cardNameOf, allCards } from './cardexclude.js';
// ★ 排除 / 恢复要**当场**生效：把已经注进去的那段清掉，或者重新拼一份 ✓
import { rebuildInjection } from './prompt.js';

/**
 * 对象多到这个数，设置页的「已建档对象」列表才出现搜索框（没几个对象时不占地方）。
 * ★ 和面板名字栏的折叠阈值（ui.js 的 `PICKER_AT = 10`）取同一个数：都是"超过 10 个就不好翻了" ✓
 */
const TARGET_SEARCH_AT = 10;

/**
 * 「预设条目还没保存就离开页面」的那条 beforeunload 提醒。
 *
 * ⚠️ renderEntries() 会被反复调用（每次重建设置页、换预设都会），
 *   所以这里记着**上一次挂的那一个**，重建时先撤掉再挂新的 ⇒ 全程只有一个 ✓
 *   （靠 `entryHost` 上一个 `bc-dispose` 事件解绑不行：全仓没人派发它 ✗）
 */
let _unloadWarnOff = null;

function apiSection(container, onChange) {
    const s = settings();
    const api = s.api;

    // ★ 术语统一：界面上就两套叫法 ——
    //   「主 API」（酒馆自己那条，写正文）和「插件 API」（插件单独调那条，跑状态推演）✓
    //   ⇒ 虽然一般叫副 API，但「插件API」这个叫法更合适 ✓
    //   ⇒ 加括号写清它干的活（推演），免得和「推演记录」频道联想不上 ✓
    // 上面那行分组标题、以及这张卡自己的标题
    //   ⇒ 卡片本身留着（内容一块不少），下面两块各有自己的小标题，所以不缺名字 ✓
    const box = h('div', { class: 'bc-section' });
    const b = h('div', { class: 'bc-section-body' });
    box.appendChild(b);

    // ---- 接口（只保留插件自己的接口） ----
    // 「借用酒馆通道」已经删掉了：它跟着酒馆当前预设走，
    // 会把破限、字数、思维链那一大堆写作要求一股脑塞进「算数值」的请求里，
    // 又贵又容易把 JSON 输出带偏。插件只该用一条干净的通道。
    // ★ 这里不再铺「这里填的是插件自己用来算数值的那个接口…」，
    //   和卡片右上角那个「？」里的说明重复 ⇒ 删掉，页面上只留输入框与警告 ✓

    // ---- 从酒馆预设导入 ----
    let presetName = api.presetName || '';
    let presetNames = [];
    const ddHost = h('div', { class: 'bc-dd-host' });
    const presetInfo = h('div', { class: 'bc-hint' });

    function renderPresetDd() {
        clear(ddHost);
        ddHost.appendChild(dropdown(
            presetName,
            [['', '（选择酒馆里的一个预设）'], ...presetNames.map(n => [n, n])],
            (v) => {
                presetName = v;
                api.presetName = v;
                save();
                // ★ 换了预设 ⇒ 重新列它的条目。
                //   ⚠️ 挂**整个 ddHost 的 click** 不行：点下拉框本身就触发 click ⇒
                //     一点下拉框（哪怕只是想看看有哪些预设）列表就被重建，
                //     手动「关闭列表」也会被这一下点回来 ✗（选完预设默认展开、关掉下次又展开）。
                //   只在**真的选中了某一项**时才重建 ✓
                renderEntries();
            },
            { class: 'bc-dd-wide' },
        ));
        // ★ 取消预设（选了只能一直选而不能关上✗）——
        //   下拉里那项空选项是**占位提示**，不好找；这里给一颗明确的 ✕ ✓
        //   ⚠️ 取消要**两样一起清**：`presetName` ＋ 勾过的 `presetEntries`
        //     （judge.js 读 `presetEntries` 时**不看 presetName** ⇒ 只清名字的话，
        //      勾过的条目还会继续被发出去 ✗）
        if (presetName) {
            const off = button('✕ 不用预设', () => {
                presetName = '';
                api.presetName = '';
                api.presetEntries = {};
                save();
                renderPresetDd();
                renderEntries();
                window.toastr?.success?.('已不用预设：勾过的条目也一并清掉了（酒馆里那份不动）');
            }, { title: '取消：插件不再借用这个预设的任何条目' });
            ddHost.appendChild(off);
        }
    }
    renderPresetDd();

    async function fillPresets() {
        presetInfo.textContent = '正在读取酒馆预设…';
        try {
            const { listPresets } = await import('./presets.js');
            presetNames = await listPresets();
            renderPresetDd();
            // ★ 这段不要铺废话 ✗ ⇒ 读数只留数字，解释进「?」✓
            presetInfo.textContent = presetNames.length
                ? `读到了 ${presetNames.length} 个预设`
                : '没读到预设。可能是酒馆版本不一样，或者你用的是 Text Completion 那套预设';
        } catch (e) {
            presetInfo.textContent = '读取预设失败：' + e.message;
        }
    }

    const importBtn = button('导入这个预设的参数', async () => {
        const name = presetName;
        if (!name) { window.toastr?.warning?.('先选一个预设'); return; }
        const { describePreset } = await import('./presets.js');
        const cfg = await describePreset(name);
        if (!cfg) { window.toastr?.error?.('读不到这个预设的内容'); return; }

        // ★ 多套接口：导入写进**当前使用中的那一条** ✓
        //   （预设导入不跟渠道绑在一起（没必要）⇒ 预设那块不跟渠道绑定，
        //     但导入出来的参数总得落到某一条上 ⇒ 落到正在用的那条最不意外 ✓）
        const target = currentApi();
        if (cfg.model) target.model = cfg.model;
        if (cfg.temperature !== undefined) target.temperature = cfg.temperature;
        if (cfg.maxTokens !== undefined) target.maxTokens = cfg.maxTokens;
        // ★ 地址**不搬**（预设会把主 API 地址填进来 ✗）
        //   预设里的自定义接口 / 反代就是**主 API 那套连接设置** ⇒ 搬过来等于偷偷替玩家填地址 ✗
        //   （界面上那句"导入只拿「模型 + 采样参数」"就是这么承诺的，代码得跟它对齐 ✓）
        if (cfg.extraHeaders) target.extraHeaders = cfg.extraHeaders;
        if (cfg.extraBody) target.extraBody = cfg.extraBody;
        api.presetName = name;      // ⚠️ 预设名留在 api 这一层（**不跟渠道走** ✓）
        save();
        onChange?.(true);
        renderEntries();

        const lines = [`已从「${name}」导入`];
        if (cfg.model) lines.push('模型：' + cfg.model);
        if (cfg.temperature !== undefined) lines.push('温度：' + cfg.temperature);
        if (cfg.maxTokens !== undefined) lines.push('最大输出：' + cfg.maxTokens);
        for (const n of (cfg.notes || [])) lines.push('· ' + n);
        window.toastr?.success?.(lines.join('<br>'), '预设已导入', { escapeHtml: false, timeOut: 12000 });
    });

    // ★ 这一块是一大段废话 ✗
    //   ⇒ 按定的规矩来（页面只留 ⚠️ 警告 + 当前状态读数 + 小标题，其余进「?」）：
    //     预设是什么 / 导入拿什么 / 不搬什么 / 想用预设内容怎么办 ⇒ 全进「?」✓
    b.appendChild(h('div', { class: 'bc-section-title' },
        h('div', { class: 'bc-sec-titlerow' },
            h('span', { text: '从酒馆预设导入' }),
            h('div', { class: 'bc-spacer' }),
            helpButton('从酒馆预设导入', [
                '这里的预设就是大家说的「破限预设」，里面装的是破限、字数、语言、思维链那一堆写作要求',
                '导入只拿「模型 + 采样参数（温度、top_p、惩罚项等）」，不会改动酒馆里的预设',
                '破限提示词不会自动全搬进来；接口地址也不会搬（那是你自己主 API 那一套，要单独填）',
                '想让插件 API 也用上你预设里的内容，在下面「预设条目」里自己勾几条',
            ]),
        ),
    ));
    b.appendChild(h('div', { class: 'bc-row' }, ddHost, button('刷新列表', fillPresets), importBtn));
    b.appendChild(presetInfo);
    // 这条是**警告**（不说会让人以为密钥会跟着过来，然后推演一直报错）⇒ 只留最短的后果 ✓
    b.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 密钥导不过来，得自己填一次' }));
    setTimeout(fillPresets, 30);

    // ---- 预设条目：单独开关（只影响插件自己的请求） ----
    const entryHost = h('div', {});
    b.appendChild(entryHost);

    /**
     * 列表被手动关掉时，只留一个「重新打开」。
     *
     * ⚠️ 这个标记**存在插件设置里**（settings().ui.presetEntriesClosed），不是局部变量 ——
     *   写成 `let entriesClosed = false` 的话，设置页一重建就回到 false ⇒
     *   表现就是「关掉了，下次进来看它又自动摊开了」✗
     */
    const entriesClosed = () => settings().ui.presetEntriesClosed === true;
    const setEntriesClosed = (v) => { settings().ui.presetEntriesClosed = !!v; save(); };

    // ★ 并发令牌：本函数会 await（动态 import + 读预设条目，首次明显慢），
    //   而"进设置页时自动跑一次"和"下面又选了一次预设"会重叠 ⇒ 两次都 clear、两次都 append，
    //   旧那份醒来时把条目贴进已经清过的宿主 ⇒ 列表里同时出现两个预设的条目 ✗
    let _entriesSeq = 0;
    async function renderEntries() {
        const _seq = ++_entriesSeq;
        clear(entryHost);
        const name = presetName;

        if (entriesClosed()) {
            entryHost.appendChild(h('div', { class: 'bc-row' },
                button('重新打开预设条目列表', () => { setEntriesClosed(false); renderEntries(); }),
            ));
            return;
        }

        if (!name) {
            entryHost.appendChild(h('div', { class: 'bc-hint', text: '先在上面选一个预设，这里就会列出它的条目' }));
            return;
        }
        // ★ 上面那块啰嗦 ⇒ 这块同一族，一起收：
        //   页面上只留 ⚠️ 警告，其余说明进「?」✓
        entryHost.appendChild(h('div', { class: 'bc-section-title' },
            h('div', { class: 'bc-sec-titlerow' },
                h('span', { text: '预设条目（单独开关，只影响插件自己的请求）' }),
                h('div', { class: 'bc-spacer' }),
                helpButton('预设条目', [
                    '一个预设动辄上百条，但插件做状态推演真正用得上的通常只有那么几条，比如「必须用简体中文」「不得提及具体年龄」「不要输出多余解释」这类约束',
                    '勾选只作用于插件发的那次推演请求，不会改动酒馆里的预设，也不会影响写正文时的提示词',
                    '用上面的搜索框按条目名或内容找；「一键勾上已启用的」＝ 把预设里开着的那批一次性勾上，「只看已勾上的」是筛选（打开后列表只显示已勾的，按钮会亮起来）',
                    '「全部勾上」＝ 把当前列出来的（搜索 / 筛选之后的）全部勾上；带「含变量宏」标记的会跳过',
                ]),
            ),
        ));
        entryHost.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 带「含变量宏」标记的条目默认不勾（插件不展开酒馆变量宏，那会往你的酒馆里写变量）；带「含模板代码」的会先渲染再发，渲染不了就这一条不发' }));

        let entries = [];
        try {
            const { listPresetEntries } = await import('./presets.js');
            entries = await listPresetEntries(name);
        } catch (e) {
            entryHost.appendChild(h('div', { class: 'bc-warn', text: '读取条目失败：' + e.message }));
            return;
        }
        // ★ 醒过来时已经不是最新那一次了（中间又选了一个预设）⇒ 整个丢弃，
        //   别把旧预设的条目贴进已经清过的宿主 ✗
        if (_seq !== _entriesSeq) return;
        if (!entries.length) {
            entryHost.appendChild(h('div', { class: 'bc-hint', text: '这个预设里没有带正文的条目' }));
            return;
        }

        // 草稿式：勾选只改草稿，点「保存」才写进插件设置
        let draft = { ...(api.presetEntries || {}) };
        let dirty = false;
        let keyword = '';
        let onlyEnabled = false;
        let limit = 80;   // 一个预设可能上百条，一次只渲染这么多，剩下的点「显示更多」
        let lastMatched = [];   // ★ 「全部勾上」只认**当前列出来的**那批（搜索 / 筛选之后 ✓）

        const counter = h('span', { class: 'bc-hint' });
        const status = h('span', { class: 'bc-param-status' });
        const listBox = h('div', { class: 'bc-preset-entries' });

        const refresh = (keepScroll = true) => {
            const keep = keepScroll ? listBox.scrollTop : 0;
            clear(listBox);

            const kw = keyword.trim().toLowerCase();
            const matched = entries.filter(e => {
                if (onlyEnabled && !e.presetEnabled) return false;
                if (kw && !(e.name.toLowerCase().includes(kw) || e.content.toLowerCase().includes(kw))) return false;
                return true;
            });

            lastMatched = matched;
            const shown = matched.slice(0, limit);
            for (const e of shown) {
                const cb = h('input', {
                    type: 'checkbox', checked: !!draft[e.id],
                    onchange: (ev) => {
                        draft[e.id] = ev.target.checked;
                        dirty = true;
                        // 只更新这一行，不重建整个列表（否则长列表会卡、滚动也会跳）
                        ev.target.closest('.bc-preset-entry')?.classList.toggle('on', ev.target.checked);
                        updateCounter();
                    },
                });
                listBox.appendChild(h('label', { class: 'bc-preset-entry' + (draft[e.id] ? ' on' : '') },
                    cb,
                    h('div', { class: 'bc-preset-entry-main' },
                        h('div', { class: 'bc-preset-entry-name' },
                            h('span', { text: e.name }),
                            h('span', { class: 'bc-badge', text: e.role }),
                            e.presetEnabled ? h('span', { class: 'bc-badge bc-badge-on', text: '预设里已启用' }) : null,
                            e.hasMacro ? h('span', { class: 'bc-badge bc-badge-lock', text: '含变量宏' }) : null,
                            e.hasEjs ? h('span', { class: 'bc-badge bc-badge-lock', text: '含模板代码' }) : null,
                        ),
                        h('div', { class: 'bc-preset-entry-preview', text: e.content.replace(/\s+/g, ' ').slice(0, 110) }),
                    ),
                ));
            }

            if (!matched.length) {
                listBox.appendChild(h('div', { class: 'bc-hint', text: '没有匹配的条目' }));
            } else if (matched.length > shown.length) {
                listBox.appendChild(h('div', { class: 'bc-row' },
                    button(`还有 ${matched.length - shown.length} 条，点这里继续显示`, () => { limit += 120; refresh(false); }),
                ));
            }

            listBox.scrollTop = keep;
            updateCounter(matched.length);
        };

        const updateCounter = (matchedCount) => {
            const n = Object.values(draft).filter(Boolean).length;
            counter.textContent = `共 ${entries.length} 条，草稿里勾了 ${n} 条`
                + (typeof matchedCount === 'number' && matchedCount !== entries.length ? `，匹配 ${matchedCount} 条` : '')
                + (dirty ? '　（有改动还没保存）' : '');
            counter.style.color = dirty ? 'var(--bc-yellow)' : '';
        };

        const search = textInput('', (v) => { keyword = v; limit = 80; refresh(false); }, { placeholder: '搜索条目名或内容…' });

        const saveBtn = button('💾 保存勾选', () => {
            api.presetEntries = { ...draft };
            dirty = false;
            save();
            updateCounter();
            status.textContent = `已保存：勾选了 ${Object.values(api.presetEntries).filter(Boolean).length} 条`;
            status.style.color = 'var(--bc-green)';
            clearTimeout(status._t);
            status._t = setTimeout(() => { status.textContent = ''; }, 3000);
        }, { variant: 'primary' });

        entryHost.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            search,
            // ★ 这两颗前缀几乎同名、容易点错，而且筛选那颗**不回显开着没有** ⇒
            //   改名（筛选 = 「只看已勾上的」，动作 = 「一键勾上已启用的」）＋ 筛选打开时高亮 ✓
            button('只看已勾上的', () => { onlyEnabled = !onlyEnabled; limit = 80; refresh(false); },
                onlyEnabled ? { variant: 'primary' } : undefined),
            button('一键勾上已启用的', () => {
                for (const e of entries) if (e.presetEnabled && !e.hasMacro) draft[e.id] = true;
                dirty = true; refresh(false);
            }),
            button('全部勾上', () => {
                // ⚠️ 只勾**当前列出来的**那批（有搜索词 / 开了「只看已勾上的」筛选时，就是筛出来的那些 ✓）
                //    带「含变量宏」标记的跳过 —— 跟旁边那颗的口径一致（插件不展开酒馆变量宏 ✓）
                for (const e of lastMatched) if (!e.hasMacro) draft[e.id] = true;
                dirty = true; refresh(false);
            }),
            button('全不选', () => {
                for (const k of Object.keys(draft)) draft[k] = false;
                dirty = true; refresh(false);
            }),
            h('div', { class: 'bc-spacer' }),
            saveBtn,
            button('放弃改动', () => {
                draft = { ...(api.presetEntries || {}) };
                dirty = false; refresh(false);
                status.textContent = '已还原成上次保存的样子';
                status.style.color = '';
            }),
            button('关闭列表', () => { setEntriesClosed(true); renderEntries(); }),
        ));
        entryHost.appendChild(h('div', { class: 'bc-row' }, counter, h('div', { class: 'bc-spacer' }), status));
        entryHost.appendChild(listBox);
        refresh(false);

        // 有未保存改动时离开这一页给个提醒
        // ⚠️ 这个监听**每次都挂**（renderEntries 会被反复调用），
        //   ⚠️ `entryHost.addEventListener('bc-dispose', …)` 是**死代码** ——
        //   全仓没有任何地方派发 `bc-dispose` ⇒ 监听器永远不摘，
        //   攒一堆闭包（还挟着已脱离 DOM 的整棵子树），关页面时多个陈旧的 warn 轮流跑 ✗
        //   ⇒ 自己记着上一份，重建时先把旧的撤掉，全程只留一个 ✓
        if (_unloadWarnOff) { try { _unloadWarnOff(); } catch { /* 忽略 */ } _unloadWarnOff = null; }
        const warn = (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } };
        window.addEventListener('beforeunload', warn);
        _unloadWarnOff = () => window.removeEventListener('beforeunload', warn);
    }

    // 换预设时的重新列条目已经挂在 dropdown 的 onChange 里（见上面 renderPresetDd）。
    //   ⚠️ 绝对不要在这里挂 ddHost 的 click —— 那会让"点开下拉框"也触发重建 ✗
    renderEntries();

    // ---- 插件自己的接口配置 ----
    // ★ 接口地址（Base URL）默认不填（`settings.js` 里刻意留空 ✓）。
    //   ⚠️ **"现在是空的" ≠ "从来没填过"**：那串地址可能是**「从酒馆预设导入」搬进来的**
    //      （预设里的 `reverse_proxy` / `custom_url` 就是主 API 那一套连接设置 ✗）
    //   ⇒ 所以两件事：
    //      ① **灰字**：`placeholder` 说状态（还没填 / 可留空），示例与说明全进这个「？」✓
    //      ② **导入不搬地址**（`presets.js` 的 `extractConfig` 不解析 baseUrl，
    //         导入那句提示也照实写"接口地址不会搬" ✓）
    const ownBox = h('div', {});
    ownBox.appendChild(h('div', { class: 'bc-section-title' },
        h('div', { class: 'bc-sec-titlerow' },
            h('span', { text: '插件自己的接口配置' }),
            h('div', { class: 'bc-spacer' }),
            helpButton('插件自己的接口配置', [
                '这里是插件自己用来「算数值」的那个接口，跟写正文用的那条通道是分开的，互不影响',
                '可以存多套（比如家里一条、公司一条；或者换服务商时留着旧的那条）。'
                + '列表里点一下就是「换成用它」，正在用的那条会标出来',
                '每套的字段：备注名 / 接口地址 / 密钥 / 模型名 / 温度 / 最大输出 / 超时（秒） / 强制 JSON 输出 / 额外请求头 / 额外请求体',
                // ★ 这排数值格不能一句说明都没有：连代价都得说 ✗
                '「温度」越高越发散、越低越稳，推演这种要 JSON 的输出建议 0.3 上下；「最大输出」调小可能装不下推演要的 JSON，那一轮直接算失败，但 token 照样花掉了',
                '接口地址（Base URL）：填到 /v1 为止就行，插件在它后面自己接 /chat/completions。例：https://api.deepseek.com/v1',
                '不填这一项，推演会直接报「还没填插件 API 的地址」，不会偷偷用别的接口',
                '密钥（API Key）：必填。它导不进来（酒馆的密钥存在服务端），只能自己填一次；填完界面上只显示成几个圆点',
                '模型名：必填，自己填服务商那边的模型名字（例：deepseek-chat）。忘了叫什么就点「拉取模型列表」，插件去这条的接口问一份清单让你挑',
                '这三项没填全之前，推演一律不跑',
                '「强制 JSON 输出」：模型不支持 JSON 模式、报错了，就把它关掉；关掉后插件会自己从回复里抠 JSON',
                '「超时（秒）」：等这条接口回话最多等多久，超了就报错。默认 180 秒，模型慢（带思考的）就填大一点',
                '「额外请求头 / 额外请求体」：填 JSON。某些服务商要的特殊参数（比如思考强度、top_p）填在这里就行，不用专门做开关',
            ]),
        ),
    ));

    // ---- 渠道列表（列表 + 弹窗，不把字段摊在页面上 ✓）----
    //   ⚠️ 用**列表**不用下拉（清单 / 多选场景要表格式 ✓）
    const apiListHost = h('div', { class: 'bc-api-list' });
    const apiHint = h('div', { class: 'bc-hint' });

    const paintApiHint = () => {
        const cur = (() => { try { return currentApi(); } catch { return null; } })();
        const n = (() => { try { return apiCount(); } catch { return 1; } })();
        const missing = [];
        if (!String(cur?.baseUrl || '').trim()) missing.push('地址');
        if (!String(cur?.apiKey || '').trim()) missing.push('密钥');
        if (!String(cur?.model || '').trim()) missing.push('模型名');
        apiHint.textContent = '当前用「' + (cur?.name || '未命名') + '」；一共 ' + n + ' 套'
            + (missing.length ? '。这条还缺：' + missing.join(' / ') : '');
    };

    const paintApiList = () => {
        clear(apiListHost);
        let list = [];
        let curId = '';
        try { list = apiList(); curId = currentApi()?.id || ''; } catch { list = []; }
        for (const row of list) {
            const on = row.id === curId;
            apiListHost.appendChild(h('div', {
                class: 'bc-api-row' + (on ? ' on' : ''),
                onclick: () => {
                    if (on) return;
                    if (setCurrentApi(row.id)) { paintApiList(); paintApiHint(); onChange?.(); }
                },
            },
                h('div', { class: 'bc-api-row-main' },
                    h('span', { class: 'bc-api-name', text: row.name || '未命名' }),
                    h('span', { class: 'bc-api-model', text: String(row.model || '').trim() || '模型还没填' }),
                ),
                h('div', { class: 'bc-spacer' }),
                on ? h('span', { class: 'bc-badge on', text: '使用中' }) : null,
                button('编辑', (e) => {
                    e?.stopPropagation?.();
                    // ★ 2026-10-31：有人报「点编辑没反应」——这条路上任何异常原来只会进控制台，
                    //   界面上一点声音都没有 ⇒ 包起来，出事就把原因弹出来，别再装没事 ✓
                    try {
                        openApiEditor(row.id, () => { paintApiList(); paintApiHint(); onChange?.(); });
                    } catch (err) {
                        console.error('[Bodycord] 打开接口编辑窗口失败', err);
                        window.toastr?.error?.('打开编辑窗口失败：' + (err?.message || err));
                    }
                }),
                button('删除', async (e) => {
                    e?.stopPropagation?.();
                    if (list.length <= 1) { window.toastr?.warning?.('至少要留一套接口'); return; }
                    if (!(await askConfirm('删掉「' + (row.name || '未命名') + '」这套接口配置？'))) return;
                    removeApi(row.id);
                    paintApiList();
                    paintApiHint();
                    onChange?.();
                }, { variant: 'danger', disabled: list.length <= 1 }),
            ));
        }
    };

    paintApiList();
    ownBox.appendChild(apiListHost);
    ownBox.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('＋ 新建渠道', () => {
            try {
                const row = addApi();
                paintApiList();
                paintApiHint();
                onChange?.();
                openApiEditor(row.id, () => { paintApiList(); paintApiHint(); onChange?.(); });
            } catch (err) {
                console.error('[Bodycord] 新建接口失败', err);
                window.toastr?.error?.('新建渠道失败：' + (err?.message || err));
            }
        }, { variant: 'primary' }),
        button('测试当前这套', async () => {
            window.toastr?.info?.('正在测试…');
            const r = await testConnection();
            if (r.ok) window.toastr?.success?.('✅ 连接成功');
            else window.toastr?.error?.('❌ ' + r.error);
        }),
        button('看看这次请求会发什么', () => {
            modal({
                title: '将发送到接口的请求（不含密钥）',
                width: 800,
                build: (body) => {
                    const cfg = (() => { try { return currentApi(); } catch { return {}; } })();
                    const shown = { ...cfg, apiKey: cfg.apiKey ? '（已隐藏）' : '' };
                    body.appendChild(h('pre', { class: 'bc-pre', text: JSON.stringify(shown, null, 2) }));
                },
            });
        }),
    ));
    ownBox.appendChild(apiHint);
    paintApiHint();

    b.appendChild(ownBox);
    container.appendChild(box);
}

/**
 * 编辑一套接口配置的弹窗。
 *
 * 形态（列表 + 弹窗），样式和字段都是**我们自己的** ✓：
 *   · 字段只有那 9 个（+备注名）；别人那几个（思考强度 / 流式 / 预填充 / 排除参数）不做 ✓
 *   · 「测试连接 / 拉取模型列表 / 看请求」都在弹窗里，作用于**手里正在改的这套** ✓
 *   · ⚠️ 地址 / 密钥 / 模型**只由玩家自己填**，插件绝不预填 ✗
 *   · 点「完成」才写回（可以取消 ✓）
 */
function openApiEditor(id, onDone) {
    let row = null;
    try { row = apiList().find((x) => x.id === id); } catch { row = null; }
    if (!row) {
        // 找不到那条配置时以前是**静默返回** ⇒ 表现就是「点了编辑没反应」✗ ⇒ 说一句 ✓
        try { window.toastr?.error?.('找不到这套接口配置（可能刚被删掉了）'); } catch { /* 忽略 */ }
        return;
    }
    const draft = { ...row };
    const result = h('div', { class: 'bc-hint' });

    modal({
        title: '接口配置 · ' + (row.name || '未命名'),
        width: 760,
        help: [
            '接口地址填到 /v1 为止；密钥导不进来，只能自己填一次',
            '模型名可以手填，也可以点「拉取模型列表」让插件去这条接口问一份清单（被跨域拦了会自动改走酒馆后端拉）',
            '「强制 JSON 输出」：模型不吃 JSON 模式就关掉，插件会自己从回复里抠 JSON',
            '「请求方式」：服务商不给跨域头时（如火山方舟），浏览器会拦掉直连；选「只用酒馆后端转发」就由酒馆服务器替我们发',
            '走酒馆后端时，密钥会随请求交给本机酒馆服务器（不出本机）；不愿意的话就选「只用直连」',
            '「额外请求头 / 额外请求体」填 JSON；某些服务商要的特殊参数填在这儿就行',
            '点「完成」才保存',
        ],
        onSave: () => {
            updateApi(id, draft);
            onDone?.();
        },
        build: (body) => {
            body.appendChild(field('备注名（给你自己认）',
                textInput(draft.name, (v) => { draft.name = v; }, { placeholder: '例：豆包 · 主力' })));
            body.appendChild(field('接口地址（Base URL）',
                textInput(draft.baseUrl, (v) => { draft.baseUrl = v.trim(); }, { placeholder: '还没填（必填）' })));
            body.appendChild(field('密钥（API Key）',
                textInput(draft.apiKey, (v) => { draft.apiKey = v.trim(); }, { type: 'password', placeholder: '还没填（必填）' })));

            const modelInput = textInput(draft.model, (v) => { draft.model = v.trim(); },
                { placeholder: '还没填（必填）· 自己填服务商给的模型名字吧' });
            const modelBtn = button('拉取模型列表', async () => {
                if (!String(draft.baseUrl || '').trim()) { window.toastr?.warning?.('先把上面的接口地址填上，再去拉模型列表'); return; }
                const old = modelBtn.textContent;
                modelBtn.textContent = '正在拉取…';
                modelBtn.disabled = true;
                try {
                    // ★ 拉的是**手里正在改的这条**（不是"当前使用中"那条 ✓）
                    const r = await listModels(draft);
                    if (!r.ok) { window.toastr?.error?.('拉取失败：' + r.error); return; }
                    pickModelModal(r.models, (m) => {
                        draft.model = m;
                        modelInput.value = m;      // 就地回填，不重建整页 ✓
                        window.toastr?.success?.('已选：' + m);
                    });
                } finally {
                    modelBtn.textContent = old;
                    modelBtn.disabled = false;
                }
            });
            body.appendChild(field('模型名', h('div', { class: 'bc-row bc-model-row' }, modelInput, modelBtn)));

            // ★ 请求方式：火山方舟这类接口不给跨域头 ⇒ 浏览器直连会被拦 ✗
            //   走酒馆后端转发就没有这个问题（请求由酒馆服务器发出去 ✓）
            body.appendChild(h('div', { class: 'bc-section-title', text: '请求方式' }));
            body.appendChild(h('div', {
                class: 'bc-hint',
                text: '服务商不给跨域头时（例如火山方舟），浏览器会把直连的请求拦下来，所以这一档决定怎么发。'
                    + '走酒馆后端 = 请酒馆的服务器替我们发（密钥会交给本机酒馆服务器，不出本机）',
            }));
            {
                const curMode = apiModeOf(draft);
                const mrow = h('div', { class: 'bc-choice' });
                for (const [id, label] of API_MODES) {
                    const on = curMode === id;
                    mrow.appendChild(h('div', {
                        class: 'bc-choice-row' + (on ? ' active' : ''),
                        onclick: () => {
                            draft.apiMode = id;
                            // 就地换高亮（别重建整页：这弹窗里还有别的输入框，重建会让人失焦 ✗）
                            for (const el of mrow.children) el.classList.remove('active');
                            for (const el of mrow.children) {
                                const dot = el.querySelector?.('.bc-choice-dot');
                                if (dot) dot.classList.remove('on');
                            }
                            const idx = API_MODES.findIndex(([x]) => x === id);
                            const target = mrow.children[idx];
                            target?.classList?.add('active');
                            target?.querySelector?.('.bc-choice-dot')?.classList?.add('on');
                        },
                    },
                        h('span', { class: 'bc-choice-dot' + (on ? ' on' : '') }),
                        h('div', { class: 'bc-choice-body' }, h('div', { class: 'bc-choice-label', text: label })),
                    ));
                }
                body.appendChild(mrow);
            }

            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                field('温度', numberInput(draft.temperature, (v) => { draft.temperature = v; }, { step: 0.1, min: 0, max: 2 })),
                field('最大输出 tokens', numberInput(draft.maxTokens, (v) => { draft.maxTokens = v; }, { step: 100, min: 256 })),
                field('超时（秒）', numberInput(draft.timeoutSec, (v) => { draft.timeoutSec = v; }, { step: 10, min: 5 })),
            ));

            // ⚠️ 这两行用 `bc-row`（它带 8px 上边距 ✓）—— 光用 `bc-inline` 会**贴在上一条身上** ✗
            //   （`.bc-inline` 只有 flex+gap，没有 margin ✓ 截图报过：这俩贴一起了）
            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: '强制 JSON 输出（response_format）' }),
                toggle(draft.jsonMode !== false, (v) => { draft.jsonMode = v; }),
            ));

            // ★ 「关闭原生思考」：我们的契约本来就强制它把推理写进 cot
            //   ⇒ 模型自带的思考是**同一件事做两遍** ✗ ⇒ 勾上就在请求体里带 thinking.disabled
            //   ★ 2026-10-15 起它**出厂就是勾上的**（默认省那一份），并配了"接口不认就自动退回" ✓
            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: '关闭模型原生思考（thinking.disabled）' }),
                toggle(draft.noThink === true, (v) => { draft.noThink = v; }),
            ));
            body.appendChild(h('div', { class: 'bc-hint', text: '出厂就是勾上的：我们的契约本来就要求它把推理分点写进 cot，模型自带的思考等于同一件事做两遍，勾上能省掉那一份。火山方舟 / DeepSeek 认这个写法；接口不认（严格的接口会回 400）时插件会去掉它再发一次，那一趟就按"带思考"跑，推演状态里会记一笔' }));
            body.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 这一项只在「直连」这条路上带得过去。走酒馆后端转发时请求体是酒馆自己重拼的，这一项和下面的"额外请求体 / 额外请求头"都会被丢掉（要它们生效就把请求方式改成只用直连）' }));

            body.appendChild(field('额外请求头（JSON，可留空）',
                textArea(draft.extraHeaders, (v) => { draft.extraHeaders = v; }, { rows: 2, placeholder: '可留空 · 例：{"X-Foo":"bar"}' })));
            body.appendChild(field('额外请求体（JSON，可留空）',
                textArea(draft.extraBody, (v) => { draft.extraBody = v; }, { rows: 3, placeholder: '可留空 · 例：{"top_p":0.9}' })));

            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                button('测试这条', async () => {
                    result.textContent = '正在测试…';
                    result.style.color = '';
                    const r = await testConnection(draft);   // ★ 测的是**手里这条** ✓
                    result.textContent = r.ok ? '✅ 连接成功' : '❌ ' + r.error;
                    result.style.color = r.ok ? 'var(--bc-green)' : 'var(--bc-red)';
                }, { variant: 'primary' }),
                button('看看这条会发什么', () => {
                    modal({
                        title: '将发送到接口的请求（不含密钥）',
                        width: 800,
                        build: (b2) => {
                            const shown = { ...draft, apiKey: draft.apiKey ? '（已隐藏）' : '' };
                            b2.appendChild(h('pre', { class: 'bc-pre', text: JSON.stringify(shown, null, 2) }));
                        },
                    });
                }),
            ));
            body.appendChild(result);
        },
    });
}

/**
 * 挑模型的弹窗（配合「拉取模型列表」✓）。
 *
 * 界面规矩：**清单要有搜索**、**别一次把上千个铺出来**（超过上限就只列前一段并写明）✓
 * ⚠️ 选中要"就地回填 + 关窗"，**不重建整页**（这页里还有别的输入框，重建会让人失焦 ✗）
 */
function pickModelModal(models, onPick) {
    const CAP = 200;
    let keyword = '';
    let closeRef = null;      // 弹窗的关闭函数（从 build 里拿到 ✓）
    const listHost = h('div', { class: 'bc-model-list' });
    const draw = () => {
        clear(listHost);
        const k = keyword.trim().toLowerCase();
        const hit = k ? models.filter((m) => m.toLowerCase().includes(k)) : models;
        if (!hit.length) {
            listHost.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的模型' }));
            return;
        }
        for (const m of hit.slice(0, CAP)) {
            listHost.appendChild(h('div', { class: 'bc-model-item' },
                h('span', { class: 'bc-model-name', text: m }),
                button('用这个', () => { closeRef?.(); onPick(m); }, { variant: 'primary' }),
            ));
        }
        if (hit.length > CAP) {
            listHost.appendChild(h('div', { class: 'bc-hint', text: `只列了前 ${CAP} 个（一共 ${hit.length} 个）· 用上面的搜索缩小范围` }));
        }
    };
    modal({
        title: `这个接口有 ${models.length} 个模型`,
        width: 640,
        cancelText: '关闭',
        build: (body, close) => {
            closeRef = close;
            body.appendChild(textInput('', (v) => { keyword = v; draw(); }, { placeholder: '搜模型名字…' }));
            body.appendChild(listHost);
            draw();
        },
    });
}

/**
 * 「推演总开关与时机」—— 一次推演的最外圈：推不推、什么时候推。
 * 顺序按"一次推演从头到尾"排：总开关 → 自动更新 → 等几秒 → 重试 → 报错跳过 → 切分支也更新
 * （延时 / 重试 / 报错跳过原来单独一张「什么时候推演」的卡，2026-10-31 并到这张最外圈的卡里 ✓）
 */
function timingSection(container, onChange) {
    const s = settings();
    // ★ 说明搬进右上角「？」弹窗；只有「注入主 API」那条
    //   在明面留一句最短的**后果**（警告不许藏 ✗）
    const box = section('推演总开关与时机', {
        help: [
            '「插件总开关」关掉之后不推演、不注入，聊天里那排楼层按钮也收起来；面板和悬浮球照常能看能改',
            '「每次 AI 回复完自动更新状态」最省事。关掉后只能用悬浮球里的「立刻推演一次」手动更新',
            '「生成结束后等几秒再自动推演」默认 15 秒（填 0 = 生成完马上推）。酒馆有时会空回或者回得慢，等一会儿再推更稳，也省 token。延时越长，你越来得及在这一楼点「不参与推演」把这次推演拦下来',
            '「推演没跑成时的重试间隔」默认 5 秒。酒馆正忙的时候过一会儿再试',
            '「报错或没响应时不自动推演」模型报错（400 / 524 之类）、生成被中止、或者什么都没输出时，就不推演。判断方式是「这次到底有没有真的产出一条消息」，所以不用去认错误码',
            '「切换消息分支（swipe）时也更新」只管切到一条还没算过的分支时要怎么办',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    const row = (label, hint, get, set) => h('div', { class: 'bc-switch-row' },
        h('div', {}, h('div', { class: 'bc-label', text: label }), hint ? h('div', { class: 'bc-hint', text: hint }) : null),
        toggle(get(), (v) => { set(v); save(); onChange?.(); }),
    );
    // ★ 带「？」的开关行（说明太长、或者"什么时候算、什么时候不算"必须讲清 ⇒ 走弹窗 ✓）
    //   ⚠️ `bc-switch-row` 是 flex ⇒ 塞进来的「？」会被排到最右边，正好挨着开关 ✓
    const rowHelp = (label, helpLines, get, set) => h('div', { class: 'bc-switch-row' },
        h('div', {}, h('div', { class: 'bc-label' },
            h('div', { class: 'bc-sec-titlerow' },
                h('span', { text: label }),
                h('div', { class: 'bc-spacer' }),
                helpButton(label, helpLines),
            ),
        )),
        toggle(get(), (v) => { set(v); save(); onChange?.(); }),
    );

    b.appendChild(row('插件总开关', '关掉之后不推演、不注入，聊天里那排楼层按钮也收起来；面板和悬浮球照常能看能改', () => s.enabled, v => s.enabled = v));
    b.appendChild(row('每次 AI 回复完自动更新状态', '', () => s.autoUpdate, v => s.autoUpdate = v));
    // 生成后延时推演：太短不行（酒馆会出现阶段或者空回的情况）。
    // ★ 默认 15 秒（截断没法靠代码判出来，只能把自动开始时间拉长一点）
    //   ⇒ 留出"看到不对就点楼层那颗按钮拦下来"的时间 ✓
    // ★ 这两格都是**秒**（毫秒用着很麻烦）✓（填 0 = 不等待 ✓）
    b.appendChild(field('生成结束后等几秒再自动推演（秒）',
        numberInput(s.judgeDelaySec ?? 15, v => { s.judgeDelaySec = v; save(); }, { min: 0, max: 600, step: 1 })));
    b.appendChild(field('推演没跑成时的重试间隔（秒）',
        numberInput(s.judgeRetrySec ?? 5, v => { s.judgeRetrySec = v; save(); }, { min: 1, max: 600, step: 1 })));
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '报错或没响应时不自动推演' }),
        toggle(s.judgeSkipEmpty !== false, v => { s.judgeSkipEmpty = v; save(); }),
    ));
    b.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 有一种情况它判不出来：文字被「截断」（写到一半断了）。那种回复里是有字的，只有人读得出来「没写完」，插件做不到，所以它照常会推演。要是你看出来了，趁它还在等上面那个延时的功夫，给那一楼点「不参与推演」，这次推演就整个取消了（已经在跑的也会被中断，不会写进任何数据）' }));
    // ★ 这一条的说明**必须写清楚"手动更新算不算"** ——
    //   只写一句"不常开"的话，会让人以为「手动推演」也被这个开关管着 ✗
    b.appendChild(rowHelp('切换消息分支（swipe）时也更新', [
        '「更新」在这里指的是重新推演一次（会调用插件 API、花 token），不是只刷新一下面板文字',
        '切到已经算过的分支：直接读它自己那份记录，面板和发给主 API 的内容一起换过去。这一步零调用、不花 token，跟这个开关无关',
        '切到还没算过的分支（老版本留下的，或者刚生成还没算过）：这个开关开 ⇒ 自动补算一次；关（默认）⇒ 什么都不做，保持原来的状态',
        '你手动点悬浮球里的「立刻推演一次」永远都能重算，跟这个开关无关',
        '切的是不是最后一楼的分支（往回翻旧楼切候选）：一律不重算、不动数据。楼层面板会写明它显示的是当初推演时的那个候选',
    ], () => s.updateOnSwipe, v => s.updateOnSwipe = v));

    container.appendChild(box);
}

/**
 * 「推演结果给谁」—— 推演出来的状态交给主 API 怎么用。
 * ⚠️ 这里装的全是"给主 API 的"，跟推演本身怎么跑无关 ⇒ 单独一张卡、排在整页最后
 *   （原来它跟"什么时候推"混在同一张卡里，一个在最前一个在最后，读起来是反的 ✗）
 */
function injectSection(container, onChange) {
    const s = settings();
    const box = section('推演结果给谁', {
        help: [
            '「把状态设定注入主 API」打开（默认）：插件会把「角色现在什么状态」作为一段额外提示词塞进正文生成里，写正文的那个 AI 才知道这个角色怀孕了、正在经期、身上有痕迹这些事',
            '接着上一条：关掉之后，那段提示词一个字都不发。主 API 完全不知道面板里记了什么，它会当这些事不存在，很可能写出跟面板对不上的正文（面板写着已怀孕，正文里这个角色还在喝酒）',
            '什么时候该关：你只想让面板当个自己看的记录本，不想让 AI 知道',
            '「把『孩子』也发给主 API」发的是这一轮要注入的那些对象各自的孩子（每行开头写着是谁的孩子 ✓）',
            '「把当前时间也发给主 API」默认关。开了之后，那段提示词开头会多一行「当前时间：几月几日 几点」，写正文的 AI 才知道现在几点；剧情里本来就不写时间的卡，也能靠这一行拿到一个时间',
            '「主 API 保留最近几条状态栏」状态栏是累积的，最新那条已经包含全部信息，所以旧的纯属重复。留 3 条还能让 AI 看出变化趋势（1 条就看不出了）。填 0 = 全部剥掉',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    const row = (label, hint, get, set) => h('div', { class: 'bc-switch-row' },
        h('div', {}, h('div', { class: 'bc-label', text: label }), hint ? h('div', { class: 'bc-hint', text: hint }) : null),
        toggle(get(), (v) => { set(v); save(); onChange?.(); }),
    );

    b.appendChild(row('把状态设定注入主 API', '关掉后主 API 完全不知道面板里的状态，可能写出跟面板对不上的正文', () => s.injectToMain, v => s.injectToMain = v));
    // ★ 「把当前时间也发给主 API」——默认关
    //   开了之后状态摘要开头多一行「当前时间：…」，剧情不写时间的卡也能有一个时间可跟 ✓
    b.appendChild(row('把当前时间也发给主 API', '', () => s.sendTime === true, v => s.sendTime = v));
    // ★ 孩子：**默认关** ✓（口径：只存插件内，
    //   但给一个选项可以发给主 API，且**默认关闭** ✓；⚠️ 遗传能力得发，
    //   不然细节对不上 ✓）
    const kidHint = h('div', { class: 'bc-hint' });
    const paintKidHint = () => {
        let n = 0;
        try {
            for (const t of (trackingRoster() || [])) n += childrenOf(t.key).length;
        } catch { /* 忽略 */ }
        // 明面只留读数（发不发由上面那个开关说了算；这段跟着"这一轮要注入的对象"走 ✓）
        kidHint.textContent = n ? '现在名单里 ' + n + ' 个孩子' : '现在名单里还没有孩子';
    };
    b.appendChild(h('div', { class: 'bc-switch-row' },
        h('div', {},
            h('div', { class: 'bc-label' },
                h('div', { class: 'bc-sec-titlerow' },
                    h('span', { text: '把「孩子」也发给主 API' }),
                    h('div', { class: 'bc-spacer' }),
                    helpButton('把「孩子」也发给主 API', [
                        '默认关。开了之后，写正文的 AI 才知道这个对象有几个孩子、多大了',
                        '发出去的内容：每个孩子一行「名字 · 年龄 · 出生日期 · 另一个亲代」。两个家长的名字都在里面：开头是生这个孩子的那一方，末尾「另一个亲代」是另一个家长',
                        // ⚠️ 说明里不许写"只在追踪对象只有一个时才发" ✗：
                        //   每一行开头就写着是谁的孩子 ⇒ 别的追踪对象影响不到它 ⇒ 不需要这个限制 ✓
                        '这段跟着这一轮要注入的对象走：每个对象各发各自的孩子，和"追了几个对象"无关',
                        '这一整段只发给主 API，插件 API（状态推演）一个字也收不到',
                    ]),
                ),
            ),
            h('div', { class: 'bc-hint' }),
        ),
        toggle(childrenToMain(), (v) => { setChildrenToMain(v); paintKidHint(); }),
    ));
    b.appendChild(kidHint);
    paintKidHint();

    b.appendChild(field('注入哪些对象', select(s.injectScope, [
        ['present', '只注入本轮出场的对象（推荐，省 token）'],
        ['active', '只注入当前查看的那一个对象'],
        ['all', '注入全部已建档对象'],
    ], v => { s.injectScope = v; save(); onChange?.(); })));

    // ★ 「主 API 保留最近几条状态栏」原来单独一张「主 API 那边」的卡夹在推演设置里，
    //   它跟上面几颗一样都是"结果交给主 API"的事 ⇒ 并到这张卡的最后一格 ✓
    b.appendChild(field('主 API 保留最近几条状态栏', numberInput(s.stateKeep ?? 3, v => { s.stateKeep = v; save(); }, { min: 0, max: 20 })));

    container.appendChild(box);
}

/** 「单轮最多认多少天」那一格现在是什么（0 = 不限制 ⇒ 说清 ✓） */
function spanCapTextOf() {
    const cap = spanCapDaysOf();
    return cap === null
        ? '现在不限制：推演报多少就照走多少'
        : ('现在最多认 ' + cap + ' 天（约 ' + Math.round(cap / 365) + ' 年）');
}

/**
 * 「推演谁」—— 这一轮把哪些对象交给推演，以及自动建档的名额。
 * ⚠️ 名单本身（追谁、轻档转正、删人）在「追踪」页的「追踪对象」卡里；
 *   这张卡只管"这一轮发给谁" ⇒ 两张卡别把同一件事各写一半 ✗
 */
function whoSection(container, onChange) {
    const s = settings();
    const box = section('推演谁', {
        help: [
            '「推演范围」默认是全部追踪对象。切成「只推演最近提到的对象」后，只有最近两楼正文里点名的对象会发给插件 API（本人一直带上），人多的存档能省不少 token',
            '接着上一条：没被提到的人这一轮不推演，但时间照常推进（周期日、孕周、精子存活期都会走），下次被提到时接着推。代价是 TA 那段没被推演的空白里不会有新的状态描述',
            '「自动追踪时最多追几个对象」管的是每一轮交给推演的名字数量（含你自己），不是"能建多少份档案"。超出的人档案照样留着、联系人页照样看得到，只是这一轮不推演',
            '「自动模式发现新角色时自动建档」只在「追踪模式 = 自动」时起作用：AI 每轮推演时会按提示词里的条件申报值得建档的新对象，那个条件可以在下面的「额外规则」里改',
            '申报进来的新对象，如果身上还没有任何身体记录，会先只登记名字：不参与推演、不占追踪名额；一旦有了身体记录，就自动转成正式追踪对象 ✓',
            '也可以去「追踪」页的「追踪对象」卡里点「开始追踪」，把某个只登记了名字的对象手动转正 ✓',
            '只报名字的致孕方不建档也照样记账（联系人页里会显示"种族未知"）。要给他填四项锁定、挂专属补丁，或者让他的身体状态也进推演时才需要建档，那时他会占上面那个名额',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    // 人多了可以只推演在场的那几个（说明进「？」）
    b.appendChild(field('推演范围', select(s.judge.scope || 'all',
        [['all', '全部追踪对象'], ['present', '只推演最近提到的对象']],
        (v) => { s.judge.scope = v; save(); onChange?.(true); })));
    b.appendChild(field('自动追踪时最多追几个对象（含你自己）', numberInput(s.judge.maxTargets, v => { s.judge.maxTargets = v; save(); }, { min: 1, max: 200 })));
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '解除上限（后果自负）' }),
        toggle(s.judge.noTargetLimit === true, v => { s.judge.noTargetLimit = v; save(); }),
    ));
    // ★ 这行小字删掉（上限本身不贵、不值得单独占一行）✓
    //   ⚠️ 这里**故意不把那句说明抄进注释**：断言是扫整个文件的（含注释），
    //     抄一遍等于自己把自己判红 ✗（查文案的断言要先剥注释）
    //   那个数字**只说一遍**就够（在「追踪名单」那张卡的「？」里 ✓）
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '自动模式发现新角色时自动建档' }),
        toggle(s.judge.autoCreateTargets !== false, v => { s.judge.autoCreateTargets = v; save(); }),
    ));
    b.appendChild(field('自动追踪的额外规则（可留空）', textArea(s.autoHints, v => { s.autoHints = v; save(); }, { rows: 3, placeholder: '例如：只追踪有名字的角色，路人和群众演员不算' })));

    container.appendChild(box);
}

/** 「喂给推演什么」—— 那一次插件 API 请求里装什么。 */
function feedSection(container, onChange) {
    const s = settings();
    const box = section('喂给推演什么', {
        help: [
            '「送给插件 API 的最近角色楼层数」只管插件 API（状态推演）那一次请求，主 API 写正文时一个字都不多带',
            '这个数字只数角色楼层，你自己的那几层是附带的、不占这个数',
            '推演要的信息都在「上一轮状态」里（精子、累计受孕率、致孕方、周期日…），那是历史的累加结果，所以填 1（默认就是它）就够跑；调大只是让 AI 多看几层正文，用来给它留点余量。⚠️ 正文是整条原文一起送过去的，你的回复越长这里越贵',
            '「把用户发言也一起送过去」默认关。打开之后，上面那个数还是只数角色楼层：每条角色楼层前面紧挨着的那条用户发言、以及比最后一条角色楼层还新的用户发言会一起带上，都不占那个数。推演要的信息都在「上一轮状态」里，你自己写的那一层通常对判定没帮助，带上纯属白花 token（想带就自己打开）',
            '「推演前剥掉的标签」：送进推演之前把这些内容整段删掉。内置能剥的只有两类：一是网页注释，就是 <!-- 这样的 --> 写法（连内容一起删，可以多行）；二是成对的标签（例如 <thinking>…</thinking>，标签名要在 status_profile / period_profile / thinking / reasoning / analysis / think / cot 这一串里）',
            '⚠️ 剥不了的三类：只有开头没有闭合的标签、方括号 / 方头括号那类写法（[COT] 、【思考】）、以及模型自己的特殊 token（<|thinking|> 这种，一般也不会出现在正文里）',
            '想剥别的就把标签名加进来（回车或点「添加」变成一个胶囊，点胶囊上的 ✕ 删掉）。一次填好几个的话，用顿号、逗号、斜杠或换行隔开都行 ✓',
            '标签名可以是中文。例如填 人物栏，就是把 <人物栏> 到 </人物栏> 之间整段删掉。两头带的那对括号不用自己写，写了也会帮你去掉',
            '⚠️ 要成对才剥得掉：只有开头、没有 </标签名> 结尾的那种（模型偶尔会写成两边都是开头）剥不了',
            '例（可以直接复制）：details、summary、scratchpad、draft。想连折叠块一起剥，就把 details 加进来 ✓',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    // ⚠️ min 不能写 2 —— 推荐值就是 1，写 2 就填不进去（浏览器判定非法就不存）。
    //   这个数字是「送给插件 API 的最近**角色楼层**数」（用户楼层是附带的、不占这个数 ✓
    //   —— 见 judge.js 的 transcriptBlock），1 = 只给当前这一层。
    //   ★ 默认 **1**：推演要的信息全在：上一轮状态里，
    //     历史正文是纯浪费 ⇒ 默认只给当前这一层，需要余量的人自己加大 ✓
    //     ⚠️ 这个框只影响**插件 API** 那一次请求，主 API 写正文不受影响 ✓
    b.appendChild(field('送给插件 API 的最近角色楼层数',
        numberInput(s.judge.historyDepth, v => { s.judge.historyDepth = v; save(); }, { min: 1, max: 60 })));
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '把用户发言也一起送过去' }),
        toggle(s.judge.includeUserMessages !== false, v => { s.judge.includeUserMessages = v; save(); }),
    ));
    // ★ 「推演之前先剥掉哪些标签」——要求：加一个自定义剥离的地方 ✓
    //   内置那几种（面板残留 ＋ 常见的思考块）一直都在剥；这一格只是**追加**你自己的 ✓
    // ★ 「推演前剥掉的标签」改成**胶囊列表**（每加一个标签就变成一个可叉掉的胶囊 ✓）
    //   ⚠️ 存储还是同一格 `s.stripTags`（换行分隔的字符串 ✓）⇒ 老的填法照旧认得 ✓
    {
        const chipHost = h('div', { class: 'bc-chip-list' });
        const readTags = () => String(s.stripTags || '').split(/[\n,，、;；/]+/).map((x) => x.trim()).filter(Boolean);
        const paintTags = () => {
            chipHost.textContent = '';
            const names = readTags();
            // ⚠️ 空的时候**不留小灰字**（那一页有"小灰字总行数"的守卫 ⇒ 空状态靠输入框的
            //   占位提示说清就够了 ✓）
            if (!names.length) return;
            for (const n of names) {
                chipHost.appendChild(h('span', { class: 'bc-chip' },
                    h('span', { text: n }),
                    h('span', {
                        class: 'bc-chip-x', text: '✕', title: '删掉这个标签',
                        onclick: () => {
                            s.stripTags = readTags().filter((x) => x !== n).join('\n');
                            save();
                            paintTags();
                        },
                    }),
                ));
            }
        };
        let draft = '';
        // ★ 切法 / 清洗口径跟推演那边**共用同一个函数**（`judge.js` 的 `splitStripTags` ✓）——
        //   以前界面和推演各写一份正则 ⇒ 两边切法不一致，界面上会画出怪胶囊 ✗
        const input = textInput('', (v) => { draft = v; }, { placeholder: '例如：thinking（回车即可添加）' });
        const add = () => {
            // ★★ 一次填好几个：顿号 / 逗号 / 分号 / 斜杠 / 空格 / 换行都当分隔符
            //   （「？」里那句"一次填好几个的话隔开就行"就是这么承诺的 ⇒ 这里必须真认 ✓）
            //   ⚠️ 以前是把**整串**当成一个名字 ⇒ `summary、scratchpad` 被拼成 `summaryscratchpad`，
            //     画出一颗谁也看不懂的胶囊 ✗（比"没加进去"更像插件坏了）
            const parts = splitStripTags(draft);
            if (!parts.length) {
                // ★★ **不许静默**：以前直接 `return` ⇒ 界面上一点反应都没有
                //   （用户报的"回车不了、按了没反应、添加不了"就是这个 ✗）
                //   ⚠️ 现在只拦"真的没法当标签名"的（光标点 / 光空格）：中文名是**能用**的 ✓
                if (String(draft || '').trim()) {
                    window.toastr?.warning?.('这个当不了标签名：名字里不能有尖括号和空格（那是标签语法本身），'
                        + '而且至少要有一个字或数字。填 thinking 或 人物栏 都行');
                }
                return;
            }
            const names = readTags();
            for (const p of parts) if (!names.includes(p)) names.push(p);
            s.stripTags = names.join('\n');
            save();
            input.value = '';
            draft = '';
            paintTags();
        };
        // ⚠️ 输入法**组字中**那一下回车是"收字"，不是"提交" ⇒ 别拿去添加
        //   （那时输入框里还是半截内容：真拿去加会加进一个错的，
        //     而弹一句"只能用英文字母"更是误导 ⇒ 两种都不做，让输入法自己收完 ✓）
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
            add();
        });
        b.appendChild(field('推演前剥掉的标签（内置的会自动剥，这里加额外的）',
            h('div', {}, h('div', { class: 'bc-row' }, input, button('添加', add)), chipHost)));
        paintTags();
    }

    container.appendChild(box);
}

/** 「记什么、认多少天」—— 推演回来要记哪些内容、一次最多认多少天。 */
function recordSection(container, onChange) {
    const s = settings();
    const box = section('记什么、认多少天', {
        help: [
            '「记录受孕过程」开：每次推演会多让 AI 报一段「受孕事件」，稍微多花一点 token。关掉：这段整个不问，也省下那点 token',
            '「单轮最多认多少天」管的是推演报回来的跨度（它可能把年份当天数报，所以设一道上限）。默认 ' + Math.round(SPAN_CAP_DEF / 365) + ' 年，填 0 = 不限制。⚠️ 这一格是全局的：所有聊天共用同一个数',
            '填 0 之后：它报错一个大数就会一下跳到很远（还会顺带把周期结算掉、把受孕记录归档），只能自己去「时间与日历」那页退回来',
            '玩家手填的「时间跳跃与修正」那两颗按钮不受这一格限制：想补多少天就补多少天',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    b.appendChild(field('记录受孕过程（谁什么时候让该角色怀上的）', toggle(s.conceptionLog !== false, v => { s.conceptionLog = v; save(); })));
    // 「周期结算方式」在补丁页的「生理周期模块」卡片上（占原「必开」的位置）
    // ★★ 「单轮最多认多少天」——**从「时间」那页搬过来**（玩家是全局设置 ⇒ 别住在按聊天的卡里 ✗）
    //   它管的是**推演报回来的跨度**（模型可能把年份当天数报出来，所以设一道上限）；
    //   玩家手填的补 / 退**不受它限制**（那是玩家自己按的，看得见也能退回来 ✓）
    const capNote = h('div', { class: 'bc-hint', text: spanCapTextOf() });
    const capInput = numberInput(spanCapDaysOf() ?? 0, (v) => {
        const st2 = settings();
        st2.spanCapDays = (v === '' ? '' : Math.round(Number(v)));
        save();
        capNote.textContent = spanCapTextOf();
    }, { min: 0 });
    b.appendChild(field('单轮最多认多少天', capInput, '填 0 = 不限制。只管推演报的跨度，手填的那两颗按钮不受它限制'));
    b.appendChild(capNote);

    container.appendChild(box);
}

/**
 * ★ 追踪模式那四档各自是干什么的（为什么追踪模式的说明没给每个模式有说明）——
 *   摆在模式下拉**下面那行读数**里，跟着选择换 ✓（原生下拉的选项里塞不下说明 ✗）
 * ⚠️ 这四句只写在这一处；这张卡里别处那几条提示不许再抄一遍（同一个东西只许写一处 ✓）
 */
const TARGET_MODE_HINT = {
    user: '只追你自己那一份，剧情里的别人不进名单（想追谁就把模式换成「指定」或「自动」）。下面那个「追踪 {{user}} 本人」开关管的是追不追你自己。',
    single: '只追名单里的一位：在下面那格填名字、回车添加；换人就把名字换掉。',
    multi: '追名单里的所有人：下面那格一个一个加。人越多越吃 token，名额上限在下面可以解除。',
    auto: '推演每轮自己按条件申报该建档的新对象，那个条件在下面的「自动追踪的额外规则」里改。只登记了名字、身上还没记录的人会先落到「只登记了名字的对象」那一栏，不占追踪名额。',
};

function targetSection(container, onChange) {
    const s = settings();
    // ⚠️ 2026-10-18：这一页的簇标题已经去掉了（「追踪对象」和卡片名重了两遍 ✗）
    //   ⇒ 现在只有卡片标题「追踪对象」，页面上一眼看到的就是它 ✓
    const box = section('追踪对象', {
        help: [
            '每个追踪对象都有自己独立的一份身体档案，互不共用数值',
            '「追踪 {{user}} 本人」关掉之后只追别人，不追你自己（自己这一份不再推演、不再记数据、也不注入状态）。已经存下来的本人数据不会删，随时可以再打开。适合玩「上帝视角 / 世界意识」这类不亲自下场的玩家',
            // ⚠️ 这一条跟「解除上限」下面那行小字**说的是同一句** —— 屏幕上到处都是同一个数字 ✗
            '真正费 token 的是「给很多人改专属补丁」：给谁改一条，那个人就多领一份；改几条多几份，不是把整批模块都发一遍',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    b.appendChild(field('追踪哪些对象', select(s.targetMode, Object.entries(TARGET_MODES), (v) => {
        s.targetMode = v;
        save();
        onChange?.(true);
    })));
    // ★★ 2026-10-16（为什么追踪模式的说明没给每个模式有说明）——
    //   那四档各自是干什么的，界面上原来一个字都没有（选项是原生下拉，塞不下说明 ✗）。
    //   ⇒ 在它下面摆**一行跟着选择变的读数**（换档位会整页重建 ⇒ 读数自己就换了 ✓「改了状态当场可见」）。
    //   ⚠️ 四句只写在这一处，**不再往「？」里抄一份**（同一个东西只许写一处 ✓）
    b.appendChild(h('div', { class: 'bc-hint', text: TARGET_MODE_HINT[s.targetMode] || '' }));

    // 新面孔识别要不要：提前认种族
    //   关＝只有真正发生了身体相关的事才登记（默认，免得把宠物 / 路人建进来）；
    //   开＝剧情只是交代了种族也登记（异种世界想提前知道种族时打开）
    b.appendChild(toggleRow('提前识别异种种族',
        s.raceScan === true,
        (v) => {
            s.raceScan = v;
            save();
            onChange?.(true);
        },
        '打开后：剧情里只是交代了某人的种族，也会先登记成「只登记了名字的对象」（适合异种多的世界）。关着：只有真的发生了身体相关的事才会登记'));

    // ★ 要不要追踪"{{user}} 本人" ✓
    //   玩男性角色、不能怀孕、但想泌乳体质和敏感带的那些，就靠这个开关 ✓
    b.appendChild(toggleRow('追踪 {{user}} 本人',
        s.trackUser !== false,
        (v) => {
            s.trackUser = v;
            save();
            // 关掉 ⇒ 顺手把当前查看的对象切到一个"还在追"的人身上（不然面板会停在本人那页 ✓）
            if (!v) {
                const other = targetList().find(t => !t.isUser);
                if (other && state().active === USER_KEY) setActive(other.key);
            }
            onChange?.(true);
        },
        '关掉后不再追你自己，已经存下来的数据不会删'));

    if (s.targetMode === 'single' || s.targetMode === 'multi') {
        const list = h('div', { class: 'bc-chip-list' });
        const names = s.targetNames || [];
        if (!names.length) list.appendChild(h('span', { class: 'bc-hint', text: '还没有添加名字' }));
        for (const n of names) {
            list.appendChild(h('span', { class: 'bc-chip' },
                h('span', { text: n }),
                h('span', {
                    class: 'bc-chip-x', text: '✕',
                    onclick: () => {
                        s.targetNames = names.filter(x => x !== n);
                        save();
                        const t = targetList().find(tt => tt.name === n);
                        if (t) removeTarget(t.key);
                        onChange?.(true);
                    },
                }),
            ));
        }
        b.appendChild(list);

        if (s.targetMode === 'single') {
            // ⚠️ 这里**不能**在 oninput 里 onChange(true) —— 那会在每敲一个键时重建整个设置页，
            //   输入框被摘掉 ⇒ 失焦、字也跟着没了（敲「阿杰」只剩「阿」）✗
            //   ⇒ 跟下面多角色那一支一样：攒在本地，回车 / 失焦 / 点「确定」才提交 ✓
            let draft = '';
            const input = textInput('', (v) => { draft = v; },
                { placeholder: '输入名字后回车即可添加' });
            const commit = () => {
                const name = draft.trim();
                if (!name) return;
                if (String(s.targetNames?.[0] || '') === name) return;   // 没改就什么都不做
                s.targetNames = [name];
                save();
                createTarget(name);
                input.value = '';
                draft = '';
                onChange?.(true);
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
            input.addEventListener('blur', commit);
            b.appendChild(h('div', { class: 'bc-row' }, field('角色名字', input), button('确定', commit)));
        } else {
            let draft = '';
            const input = textInput('', (v) => { draft = v; }, { placeholder: '输入名字' });
            const add = () => {
                const name = draft.trim();
                if (!name) return;
                if (!(s.targetNames || []).includes(name)) {
                    s.targetNames = [...(s.targetNames || []), name];
                    save();
                    createTarget(name);
                }
                input.value = '';
                draft = '';
                onChange?.(true);
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
            b.appendChild(h('div', { class: 'bc-row' }, input, button('添加', add)));
        }
    }

    if (s.targetMode === 'auto') {
        // ⚠️ 「AI 按条件申报新对象 + 去哪儿改条件」那半句已经在下拉下面那行读数里说了 ⇒
        //   这里只留"能手动删"这一句（同一个东西别写两处 ✗）
        b.appendChild(h('div', { class: 'bc-hint', text: '自动建档进来的对象，你可以随时在这里手动删掉不想追踪的' }));
    }

    // ★★ 轻档：自动模式里出现过、但**身上还没有任何身体记录**的对象 ——
    //   只登记名字：不进推演、不吃 token、**也不占追踪名额** ✓
    //   ⇒ 这里给一颗「开始追踪」让人能手动升格（比如刚出场、还没发生任何事的重要角色 ✓）
    //   ⚠️ 说明里**不提性别**（挑人的条件在提示词那边，这里只说事实 ✓）
    {
        // ★ 2026-10-18：轻档不再提供「查看」⇒ 如果**之前**把某个轻档设成了当前对象，
        //   这里顺手切回第一个正式档，别让玩家打开主面板还看着一个：没记录却显示可受孕的人 ✓
        try {
            const curKey = state().active;
            const cur = curKey ? state().targets[curKey] : null;
            if (cur && cur.light) {
                const first = targetList().find((x) => x.light !== true);
                if (first) { setActive(first.key); onChange?.(true); }
            }
        } catch { /* 读不到就算了，不影响这一段渲染 */ }
        const lights = lightTargetList();
        if (lights.length) {
            b.appendChild(h('div', { class: 'bc-section-title', text: '只登记了名字的对象' }));
            // ⚠️ 说明要把**两条来路**都写上（2026-10-16：轻档不光"自动模式出现过"这一种，
            //   在联系人里给某个人记种族也会建成轻档 ✓）—— 只写默认那种情况读起来就是错的 ✗
            b.appendChild(h('div', { class: 'bc-hint', text: '身上还没有任何身体记录的对象（自动模式里出现过的，或者在联系人里记过种族的）：暂时不参与推演，也不占追踪名额' }));
            for (const t of lights) {
                b.appendChild(h('div', { class: 'bc-row' },
                    h('span', { text: displayName(t) || t.key }),
                    h('div', { class: 'bc-row-end' },
                        // 查看：
                        //   轻档没有致孕/受孕这些记录，切进主面板会按默认值显示成
                        //   「可受孕 / 可致孕」，看着像插件替他编了事实 ✗
                        //   ⇒ 轻档只能「开始追踪」升格，或直接「移除」；不提供"切过去看" ✓
                        button('开始追踪', () => {
                            setTargetLight(t.key, false);
                            save();
                            onChange?.(true);
                        }, { title: '转成正式追踪对象：从下一轮起进名单，也会占一个名额' }),
                        // 只登记了名字的对象只有添加没有移除——
                        //   轻档本身没有身体数据，移除＝把这条登记删掉（以后再出现会重新登记）✓
                        //   ⚠️ 本人这一行**不给移除**：他就是你自己，删掉以后没有地方重建 ✓
                        t.isUser ? null : button('移除', async () => {
                            if (!(await askConfirm(`把「${displayName(t) || t.key}」从「只登记了名字的对象」里移除？\n\n`
                                + '这一条只有名字和种族，没有身体数据可删；以后再出现会重新登记。'))) return;
                            removeTarget(t.key);
                            onChange?.(true);
                        }, { variant: 'danger', title: '移除这条登记（不含身体数据）' })),
                ));
            }
        }
    }

    // 已建档对象列表
    // ★ 设置页的名单搜索按**聊天内**那一份来、搞聊天隔离，
    //   不要全局（因为非聊天只有 USER 一个角色）✓
    //   ⇒ 这份名单本来就是【本聊天】的（`targetList()` 读 chat_metadata）——
    //     **别为了"搜得更多"去翻全局配置** ✗（那会搜出别的聊天的同名角色 ✗）
    //   ⇒ 对象没几个时不摆搜索框（不占地方），超过阈值才出现 ✓
    // ★★ 2026-10-16（到底是轻档还是正式档？为什么已经是轻档还要显示退回轻档）：
    //   这份名单原来取的是**本聊天全部对象**（`targetList()` 把轻档也算进来）⇒
    //   同一个致孕方在上面「只登记了名字」和这里各列了一遍，而这里那排按钮
    //   （退回轻档 / 删除）是给正式档设计的 ⇒ 出现对它没意义的「退回轻档」（点了当然没反应 ✗）。
    //   ⇒ 这份**只列正式档**；轻档一律在上面那一栏（那边有「查看」和「开始追踪」✓）。
    //   ⚠️ 这是老毛病，不是新写的：以前没人有轻档，所以那行从没露过面 ✓
    const targets = targetList().filter((t) => t.light !== true);
    b.appendChild(h('div', { class: 'bc-section-title', text: '当前聊天已建档的对象' }));
    if (!targets.length) {
        // ★ 轻档都列在上面那一栏了 ⇒ 这里空着的时候说清楚去哪儿看，别只写「暂无」（会像数据没了 ✗）
        b.appendChild(h('div', {
            class: 'bc-hint',
            text: lightTargetList().length ? '暂无（只登记了名字的都在上面那一栏）' : '暂无',
        }));
    } else {
        let kw = '';
        const listHost = h('div', {});

        // 只重画列表那一段 —— 整段重画会让输入框失焦（联系人页那条教训 ✓）
        const paint = () => {
            clear(listHost);
            const list = filterTargets(targets, kw);
            if (!list.length) {
                listHost.appendChild(h('div', { class: 'bc-hint', text: '没有匹配的对象' }));
                return;
            }
            const tbl = h('div', { class: 'bc-target-list' });
            for (const t of list) {
                const nm = displayName(t) || t.key;
                const isActive = state().active === t.key;
                // ★ 标签也摆在这儿（一眼看出谁是哪一版 / 哪一篇 ✓）
                const tagList = (() => { try { return parseAliases(identOf(t.key).tags); } catch { return []; } })();
                tbl.appendChild(h('div', { class: 'bc-target-row' + (isActive ? ' active' : '') },
                    h('div', { class: 'bc-target-main' },
                        h('div', { class: 'bc-target-name' },
                            nm,
                            t.isUser ? h('span', { class: 'bc-badge', text: '用户本人' }) : null,
                            ...tagList.map((tg) => h('span', { class: 'bc-badge', text: tg })),
                        ),
                        // ⚠️ 这个时间戳只由**推演成功**写（`upsertTargetResult`）——
                        //   面板里「改数值」保存时也写一次的话，会出现"总开关关着还在记"的错觉 ✗
                        //   ⇒ ①去掉手动保存那一处写入（见 ui.js）
                        //     ②这里照实叫「上次推演」，没推演过就明说 ✓
                        h('div', { class: 'bc-hint', text: t.updatedAt ? '上次推演：' + new Date(t.updatedAt).toLocaleString() : '还没推演过' }),
                    ),
                    h('div', { class: 'bc-target-actions' },
                        isActive ? h('span', { class: 'bc-badge bc-badge-on', text: '正在查看' })
                                 : button('查看', () => { setActive(t.key); onChange?.(true); }),
                        // **本人也能退回轻档** ✓
                        //   轻档＝只留名字和种族，不进推演、不占名额；想再追就点「开始追踪」✓
                        button('退回轻档', async () => {
                            if (!(await askConfirm(`把「${nm}」改成只登记名字？\n\n`
                                + '改完就不参与推演、不占追踪名额了（身体数据一条不删，还留着）。\n\n'
                                + '想再追随时，在下面「只登记了名字的对象」那一行点「开始追踪」就行。'))) return;
                            setTargetLight(t.key, true);
                            onChange?.(true);
                        }, { title: '退回"只登记名字"：不再参与推演、不占名额（数据保留）' }),
                        t.isUser ? null : button('删除', async () => {
                            if (!(await askConfirm(`删除「${nm}」的身体档案？这个操作不可撤销`))) return;
                            removeTarget(t.key);
                            onChange?.(true);
                        }, { variant: 'danger' }),
                    ),
                ));
            }
            listHost.appendChild(tbl);
        };

        if (targets.length > TARGET_SEARCH_AT) {
            const input = textInput('', (v) => { kw = v; paint(); }, { placeholder: '搜索对象名…' });
            b.appendChild(h('div', { class: 'bc-row' }, input));
        }
        paint();
        b.appendChild(listHost);
    }

    // 手动添加对象（任何模式都能用）
    let draft2 = '';
    const input2 = textInput('', v => { draft2 = v; }, { placeholder: '手动添加一个要追踪的角色名' });
    const add2 = () => {
        const name = draft2.trim();
        if (!name) return;
        createTarget(name);
        input2.value = '';
        draft2 = '';
        onChange?.(true);
    };
    input2.addEventListener('keydown', (e) => { if (e.key === 'Enter') add2(); });
    b.appendChild(h('div', { class: 'bc-row' }, input2, button('添加对象', add2)));

    container.appendChild(box);
}

/**
 * 「合并对象」弹窗。
 *
 * 诉求：
 *   · **AI 可能会把同一个角色拆成两个差异化的角色，所以需要做合并** ✓
 *   · **同名但不是同一个人的怎么算？**⇒ 靠**别名表**（另一个功能 ✓）
 *   · 合并规则：
 *     ① 敏感带**叠加** ✓
 *     ② 精子记录：都没怀孕/受精卵时**叠加** ✓
 *     ③ 受精卵：有那边为主 ✓
 *     ④ 怀孕：**全看怀孕那边**（影响孩子）⇒ 周期也跟着它 ✓
 *     ⑤ 周期：**两边都没怀孕**时**让玩家自己选** ✓
 *     ⑥ 两个都怀孕 ⇒ **玩家选留哪个** ✓（就是这里的"保留哪一个"）
 *
 * ⚠️ 这里**只做"选哪些 / 留哪个 / 周期用谁的"**，真正合并交给 `store.mergeTargets()` ✓
 *   （它带 `confirmBox` 之外的规则实现和断言 ✓）
 */
function openMergeDialog(onChange) {
    const all = targetList();
    if (all.length < 2) {
        window.toastr?.warning?.('现在只有一个对象，没什么可合的');
        return;
    }
    // 选中的对象（默认全不选，自己挑）
    const picked = new Set();
    let keepKey = '';
    let cycleFrom = '';

    modal({
        title: '合并对象',
        width: 620,
        saveText: '合并（不可撤销）',
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-hint', text: '勾选"其实是同一个人"的那几个档（至少两个），再选保留哪一个。合并后其余档会被删掉，它们的数值、记录、别名都会并进保留的那份' }));
            body.appendChild(h('div', { class: 'bc-hint', text: '⚠️ 建议先「导出当前聊天档案」备份一下再合' }));

            const host = h('div', {});
            body.appendChild(host);

            const paint = () => {
                clear(host);
                const list = targetList();
                const grid = h('div', { class: 'bc-pill-picker-grid' });
                for (const t of list) {
                    const nm = displayName(t) || t.key;
                    const on = picked.has(t.key);
                    const isUser = t.isUser || t.key === USER_KEY;
                    grid.appendChild(h('div', {
                        class: 'bc-pill bc-pill-big' + (on ? ' active' : '') + (isUser ? ' bc-pill-locked' : ''),
                        title: isUser ? `「${userLabel()}」那一份不能被并掉` : nm,
                        onclick: () => {
                            if (isUser) { window.toastr?.info?.(`「${userLabel()}」那一份不能并进别人里`); return; }
                            if (picked.has(t.key)) picked.delete(t.key);
                            else picked.add(t.key);
                            if (!picked.has(keepKey)) keepKey = [...picked][0] || '';
                            paint();
                        },
                    },
                        h('span', { class: 'bc-pill-dot' }),
                        h('span', { class: 'bc-pill-name', text: nm }),
                        on ? h('span', { class: 'bc-pill-tag', text: '已选' }) : null,
                    ));
                }
                host.appendChild(h('div', { class: 'bc-section-title', text: '一 · 选要合并的档（' + picked.size + ' 个）' }));
                host.appendChild(grid);

                if (picked.size >= 2) {
                    // ② 保留哪一个（两个都怀孕时也是选它 ✓）
                    const keys = [...picked];
                    host.appendChild(h('div', { class: 'bc-section-title', text: '二 · 保留哪一个' }));
                    host.appendChild(select(keepKey || keys[0], keys.map(k => {
                        const t = state().targets?.[k];
                        return [k, (t ? (displayName(t) || k) : k)];
                    }), (v) => { keepKey = v; paint(); }));
                    host.appendChild(h('div', { class: 'bc-hint', text: '保留的那份会带着自己的名字、别名、能力设定；其余档会被删掉' }));

                    // ③ 两边都没怀孕 ⇒ 周期让玩家选 ✓
                    const w = (k) => {
                        const t = state().targets?.[k];
                        if (!t) return false;
                        if (String(t.vars?.Is_Pregnant ?? '').toLowerCase() === 'true') return true;
                        return /孕期|妊娠|孕\d|怀/.test(String(t.profile?.title || '') + String(t.profile?.phase || ''));
                    };
                    const preg = keys.filter(w);
                    if (!preg.length) {
                        host.appendChild(h('div', { class: 'bc-section-title', text: '三 · 周期用谁的' }));
                        host.appendChild(h('div', { class: 'bc-hint', text: '两边都没怀孕，所以有两个"正在进行的周期"，挑一个当合并后的周期' }));
                        host.appendChild(select(cycleFrom || keepKey || keys[0], keys.map(k => {
                            const t = state().targets?.[k];
                            const nm = t ? (displayName(t) || k) : k;
                            const sub = t?.profile?.sub ? '（' + t.profile.sub + '）' : '';
                            return [k, nm + sub];
                        }), (v) => { cycleFrom = v; }));
                    } else {
                        const nm = preg.map(k => { const t = state().targets?.[k]; return t ? displayName(t) : k; }).join('、');
                        host.appendChild(h('div', { class: 'bc-hint', text: '三 · 周期不用选：有 ' + nm + ' 怀孕了，按规则全看怀孕那份' }));
                    }
                }
            };
            paint();
        },
        onSave: () => {
            const keys = [...picked];
            if (keys.length < 2) { window.toastr?.warning?.('至少选两个档'); return false; }
            const keep = keepKey || keys[0];
            const r = mergeTargets(keys, keep, { cycleFrom: cycleFrom || keep });
            if (!r?.ok) { window.toastr?.error?.('合并失败：' + (r?.error || '未知原因')); return false; }
            onChange?.(true);
            window.toastr?.success?.(
                `已合并 ${keys.length} 个档到「${displayName(state().targets?.[keep]) || keep}」`,
                '合并完成');
            try { import('./ui.js').then(m => m.refreshAll?.()); } catch { /* 忽略 */ }
            return true;
        },
    });
}

/**
 * ★ 聊天档案导出（两个版本，文件名不一样 ✓）
 *
 * 「仅状态」= 受孕率 / 精子 / 妊娠 / 账本 / 孩子 / 成就（换新时间点、只想要身体状态时用）
 * 「含时间与日程」= 上面那些 ＋ 剧情日期、钟点、时间来源、历法指纹、日程（续写同一时间轴时用）
 * 文件里带 `__export.includeTime` 标记 ⇒ 导入时按它决定要不要连时间一起搬（旧文件没标记＝仅状态 ✓）
 */
const EXPORT_TIME_KEYS = ['dateMode', 'fictionDate', 'fictionTime', 'calendarPrint', 'calendarEvents'];

function exportChatArchive(st, withTime) {
    const payload = JSON.parse(JSON.stringify(st || {}));
    // ★★ 2026-10-26（仅状态就该只有状态）：绝对日期一律换成**相对天数**再导出，
    //   时间线属于这个聊天、不跟着档案走 ⇒ 导进别的档也不会把 2012 搬进 2022 ✓
    //   ⚠️ 这一步万一出错，也不能让整个导出挂掉（连文件都不生成）⇒ 兜底成"带绝对日期"并告警
    let rel = null;
    if (!withTime) {
        try { rel = exportOnlyStateDates(payload); }
        catch (e) {
            rel = null;
            console.warn('[Bodycord] 导出相对日期失败，改为原样导出：', e);
        }
    }
    if (!withTime) for (const k of EXPORT_TIME_KEYS) delete payload[k];
    payload.__export = { includeTime: !!withTime, version: 3, storyDate: String(st?.fictionDate || '') };
    if (rel && Object.keys(rel).length) payload.__rel = rel;
    // ★ 2026-10-26：导入导出**不在右上角弹提示**（她说不要弹）⇒ 只写控制台，界面不打扰
    // ★ 文件名带上**这个聊天的名字**（导出文件要能看出是哪个聊天来的）——
    //   名字取自酒馆的 chatId（就是聊天列表里看到的那一串），文件名非法字符换成下划线 ✓
    const chatName = (() => {
        try {
            const id = String(getCtx()?.chatId || '').trim();
            if (!id) return '';
            return id.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
        } catch { return ''; }
    })();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (chatName ? chatName + ' - ' : '')
        + (withTime ? '含时间与日程' : '仅状态') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function dataSection(container, onChange) {
    // ★ 2026-10-18：簇标题「数据」已经去掉 ⇒ 只留卡片自己这个内容名「聊天档案」✓
    const box = section('聊天档案', {
        help: [
            '这份数据保存在这个聊天自己的文件里，换聊天、换角色卡都不会串',
            // ★ 2026-10-21：自动保存这件事必须写出来，否则玩家会以为要手动点才算存档 ✗
            '改动会自动保存，不用手动点。只有在关浏览器之前想立刻写进去时，才用悬浮球菜单里那颗「保存数据」（它只在你还有没保存的改动时才出现）',
            '「合并对象」= 同一个人被 AI 拆成两个档的时候用，选保留哪一个，其余的数值、记录、别名都会并进来',
            '「导出（仅状态）」= 存成文件，只带身体状态与记录（受孕率 / 精子 / 妊娠 / 账本 / 孩子 / 成就），换新时间点时用',
            '「导出（含时间与日程）」= 在「仅状态」的基础上再带上剧情日期、钟点、时间来源、日程（续写同一时间轴时用）',
            '「从档案文件导入（迁移到这里）」= 把旧档案搬进当前聊天，同名对象会被文件里的数据覆盖，当前聊天里其他对象不受影响；连不连时间一起搬，看文件是哪种导出的',
            // ★ 按楼层的记录不搬（时光机显示的是上一个聊天的楼层）
            '导入不搬按楼层存的记录（历史快照 / 时光机、回滚点、「不参与推演」的楼层标记）：楼层号属于原来那个聊天，搬过来会撞号。想看旧历史用「时光机 → 导入档案」（只读）',
            // ★ 日期也不搬（可能是新的时间点）
            '导入也不搬剧情日期与钟点：新聊天是新的时间点，日期留在它自己那份里。周期起始（第几天）在对象身上，照常搬',
            // ★ 2026-10-26：仅状态跨时间轴时的日期处理（不然 2012 的判定日会出现在 2022 的档里）
            '「仅状态」导出时会把记录里的具体日期换成相对天数（孕第几天、还剩几天）：时间线属于那个聊天，不跟着档案走。导入后按当前聊天的剧情日期重新算成日期；当前档还没有日期就先挂着，等第一次有日期再落',
            // ★ 那颗红按钮整张卡的说明里一个字都没提，代价还被说小了 ✗
            '「清空当前聊天档案」= 把这个聊天里插件存的东西整个清掉：对象与数值、日程、成就、随手记、占卜台历史、孩子、历史快照。只影响这个聊天，但删了回不来，建议先导出一份',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    const st = state();
    b.appendChild(h('div', { class: 'bc-hint', text: `当前聊天：${Object.keys(st.targets || {}).length} 个对象，${(st.snapshots || []).length} 条历史快照 · 改动会自动保存，不用手动点` }));
    // ★★ 2026-10-19（在非聊天界面清档案会不会出 BUG）——
    //   **会**：不在聊天页时，酒馆上下文中可能还挂着**上一个聊天**的 metadata
    //   ⇒ 这时候点清空／导入，打的是那份数据，还会被落盘 ✗
    //   ⇒ 这一整排放操作按钮在"不在聊天页"时禁掉，并写清为什么 ✓
    const notInChat = !inChatPage();
    const off = (why) => (notInChat ? { disabled: true, title: why } : {});
    if (notInChat) {
        b.appendChild(h('div', { class: 'bc-warn', text: '这些按钮操作的是「某个聊天」的档案。现在不在聊天里，先打开要处理的聊天再回来，否则可能作用在上一次打开的那个聊天上' }));
    }
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        // ★ 合并对象（AI 可能把同一个角色拆成两个档 ⇒ 需要合并 ✓）
        button('合并对象（同一个人被拆成两个档时用）', () => openMergeDialog(onChange), off('先打开要处理的聊天')),
        // ★ 2026-10-19：导出分成**两种**，文件名也不一样（容易搞错是因为导出文件名一样，改成不一样的就行 ＋：需要日子的不一定需要只有状态的）——
        //   · 仅状态：受孕率 / 精子 / 妊娠 / 账本 / 孩子 / 成就（新时间点用）
        //   · 含时间与日程：在"仅状态"的基础上再带上剧情日期、钟点、时间来源、历法指纹、日程
        //   导入时**按文件里的标记**决定要不要连时间一起搬（旧文件没有标记 ⇒ 当作"仅状态" ✓）
        button('导出（仅状态）', () => exportChatArchive(st, false), off('先打开要导出的那个聊天')),
        button('导出（含时间与日程）', () => exportChatArchive(st, true), off('先打开要导出的那个聊天')),
        // ★ 导入 = 把旧档案**迁移**到当前聊天：
        //   不是复制文本、而是**挪过去**（相当于迁移）；
        //   旧的里面有数据就迁到新的档，哪怕不是同一个角色卡也行 ✓）
        button('从档案文件导入（迁移到这里）', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            input.addEventListener('change', async () => {
                const f = input.files?.[0];
                input.remove();
                if (!f) return;
                try {
                    const text = await f.text();
                    const incoming = JSON.parse(text);
                    if (!incoming || typeof incoming !== 'object' || !incoming.targets || typeof incoming.targets !== 'object') {
                        window.toastr?.error?.('这个文件不像 Bodycord 的档案');
                        return;
                    }
                    const cur = state();
                    const inKeys = Object.keys(incoming.targets);
                    const clash = inKeys.filter(k => cur.targets && cur.targets[k]);
                    // ⚠️ 必须在拼确认文字**之前**算好（下面那段要用；放到后面会报
                    //   "Cannot access 'withTime' before initialization" ✗）
                    const withTime = incoming.__export?.includeTime === true;
                    const ask = `导入会把这 ${inKeys.length} 个对象搬进【当前聊天】。\n\n`
                        + (clash.length
                            ? `⚠️ 其中有 ${clash.length} 个当前聊天里已经有同名对象（${clash.slice(0, 5).join('、')}${clash.length > 5 ? '…' : ''}），它们会被文件里的数据覆盖。\n\n`
                            : '')
                        + '按楼层存的记录不会搬（历史快照 / 时光机、回滚点、「不参与推演」的楼层标记）：'
                        + '它们是原来那个聊天的楼层号，搬过来会和这个聊天的楼层撞号。\n'
                        + (withTime
                            ? '这份文件是「含时间与日程」的：剧情日期、钟点、时间来源、日程会一起搬过来。\n'
                            : '这份文件是「仅状态」的：剧情日期、钟点、时间来源、日程都不搬（新聊天是新的时间点）。\n')
                        + '记录里的「第几楼」会清空，但「第几轮」那种流水号保留（它表示带过来的是第几次）。\n'
                        + '想看旧历史，用「时光机 → 导入档案」，那里是只读的。\n\n'
                        + '当前聊天里其他对象不受影响。确定导入吗？';
                    if (!(await askConfirm(ask))) return;

                    // ★ 2026-10-19：搬过来的记录里凡是记着**楼层号**的（每条内射 / 性行为流水 /
                    //   推演记录 / 成就 / 回滚点…都带一个 floor），一律清空 —— 那是原来那个聊天的楼层。
                    //   ⚠️ 但「第几轮」那种**流水号**（`round`）保留：它不是楼层号，
                    //      搬过来正好表示"这是带过来的第 N 次" ✓
                    const stripFloors = (v) => {
                        if (!v || typeof v !== 'object') return;
                        if (Array.isArray(v)) { for (const x of v) stripFloors(x); return; }
                        for (const k of Object.keys(v)) {
                            if (k === 'floor') v[k] = null;
                            else stripFloors(v[k]);
                        }
                    };
                    // 合并：文件里的对象逐个覆盖进来；当前聊天里别的对象**保留** ✓
                    for (const k of inKeys) {
                        const src = incoming.targets[k];
                        if (!src || typeof src !== 'object') continue;
                        cur.targets[k] = JSON.parse(JSON.stringify(src));
                        stripFloors(cur.targets[k]);
                        if (!cur.order.includes(k)) cur.order.push(k);
                    }
                    // 顺带把"这一份档案的上下文"也接上（档案/骰值/痕迹/周期归档……）
                    //   ⚠️ 这些是"整份状态"级别的：只在文件里确实有、且当前聊天是空的时才接，
                    //      免得把当前聊天已经产生的进度冲掉 ✗
                    if (!cur.order.length) cur.order = [...(incoming.order || [])];
                    if (!cur.active) cur.active = incoming.active || cur.order[0] || null;
                    // ★ 孩子：**迁移也要带上**（时光机 / 旧搬新窗口那类兼容 ✓）
                    // ⚠️⚠️ 这张单子必须**跟着导出的状态走**：导出侧是整份 `state()`
                    //   （见上面的「导出当前聊天档案」），所以这里漏一个字段就等于
                    //   迁移时**静默丢一样数据** ✗ —— `ovuJudgments`（按对象分的受精判定历史）
                    //   和 `conceptionArchive`（周期归档）就是这么丢的
                    //   （诊断报告那张覆盖清单 `ui.js` 的 DIAG_COVERED_STATE_KEYS 里两个都有 ⇒ 是漏抄）
                    // ★★ **别再手抄白名单** —— 导出侧给的是整份 `state()`
                    //   （见上面那颗「导出当前聊天档案」），导入侧却只搬 10 个键 ⇒
                    //   成就 / 日程 / 随手记 / 敏感带备注 / 占卜台历史 / 剧情时间轴 /
                    //   上次推演记录…全都在迁移时**静默丢掉** ✗
                    //   ⇒ 改成"整份 state 减去**明确不该搬**的键"：
                    //     · targets / order / active ⇒ 上面单独逐个覆盖（不冲别人 ✓）
                    //     · snapshots ⇒ 下面按「楼层 + 时间戳」去重合并 ✓
                    //     · checkpoint / floorCandidates ⇒ 绑楼层，搬到新聊天没有意义 ✗
                    //     · lastRun ⇒ 只是"上次推演成没成"的运行态，不是数据 ✓
                    // ★★ 2026-10-19（时光机还显示上一个聊天的层数，会和新窗口楼层冲突）——
                    //   **按楼层存的东西一律不搬**：它们的楼层号是**原来那个聊天**的，
                    //   搬进新聊天（新聊天从第 0 楼开始）只会撞号，时光机就会显示一堆不存在的楼层 ✗
                    //   · snapshots（时光机）／checkpoint／floorCandidates
                    //   · excluded（哪几楼"不参与推演"）／rollbackPoints / rollbackUndo（都绑楼层）
                    //   ⇒ 想看旧历史请用「时光机 → 导入档案」（那是只读的，不写进聊天 ✓）
                    // ★★ 2026-10-19 追加一条：**年月日和几点也不搬** ——
                    //   剧情日期 / 钟点 / 时间来源 / 历法指纹都**属于那个聊天的时间轴**，
                    //   新聊天大概率是另一个时间点，搬过来只会让面板顶着旧日期 ✗
                    //   （周期锚点在对象里、跟人走，那个照搬 ✓）
                    const IMPORT_SKIP = new Set([
                        'targets', 'order', 'active', '__export', '__rel',
                        'snapshots', 'checkpoint', 'floorCandidates',
                        'excluded', 'rollbackPoints', 'rollbackUndo',
                        'lastRun', 'lastJudgeRaw',
                    ]);
                    // ★ 时间与日程：**跟着文件走** —— 「含时间与日程」那份才搬，
                    //   「仅状态」那份和没有标记的老文件都不搬 ✓
                    if (!withTime) {
                        for (const k of EXPORT_TIME_KEYS) IMPORT_SKIP.add(k);
                    }
                    for (const [f2, val] of Object.entries(incoming)) {
                        if (IMPORT_SKIP.has(f2) || val == null) continue;
                        const hasCur = (() => {
                            const v = cur[f2];
                            if (v == null) return false;
                            if (Array.isArray(v)) return v.length > 0;
                            if (typeof v === 'object') return Object.keys(v).length > 0;
                            return String(v).length > 0;
                        })();
                        // ⚠️ 仍然只接"当前聊天这份是空的"那些键（不冲掉已经产生的进度 ✓）
                        if (!hasCur) {
                            cur[f2] = JSON.parse(JSON.stringify(val));
                            // 楼层号一律清掉（上面那条说明）；没别的东西要动 ✓
                            stripFloors(cur[f2]);
                        }
                    }
                    // ★★ 2026-10-26：仅状态的日期是**相对天数**（`__rel`）——
                    //   这个档有剧情日期就按它落；还没有就先挂着，等第一次有日期再落 ✓
                    if (!withTime) {
                        const rel = (incoming.__rel && typeof incoming.__rel === 'object') ? incoming.__rel : null;
                        const cnt = rel ? Object.keys(rel).length : 0;
                        if (cnt) {
                            if (String(cur.fictionDate || '').trim()) {
                                let moved = 0;
                                try { moved = applyRelDates(rel); } catch { moved = 0; }
                                console.log('[Bodycord] 导入：日期已按当前剧情日期落好（' + moved + ' 处）');
                            } else {
                                try { setPendingRelDates(rel); } catch { /* 忽略 */ }
                                console.log('[Bodycord] 导入：这个档还没有剧情日期，日期先挂着');
                            }
                        } else {
                            console.log('[Bodycord] 导入：这份文件是旧版导出的（没有相对日期）');
                        }
                        // ★ 2026-10-26：这批记录的**时间**属于另一条时间轴 ⇒ 打个标记，
                        //   界面只把它们显示成「第 N 轮 · 第 D 天」（正常游玩的记录不受影响 ✓）
                        try {
                            const keys = new Set(inKeys.map(String));
                            for (const k of inKeys) {
                                // 这个对象是从别的档搬进来的 ⇒ 界面上的时间按"没有时间线"处理 ✓
                                if (cur.targets?.[k]) cur.targets[k].imported = true;
                            }
                            for (const x of (Array.isArray(cur.insems) ? cur.insems : [])) {
                                if (!keys.has(String(x?.target || ''))) continue;
                                x.imported = true;
                                // 老记录没存周期序号 ⇒ 按这个对象当前的周期序号补上（相对量，不碰时间线）
                                if (x.cycleNo == null) x.cycleNo = Number(cur.targets?.[x.target]?.cycleNo) || 1;
                            }
                            for (const k of inKeys) {
                                const bag = cur.sexLog && cur.sexLog[k];
                                if (Array.isArray(bag)) {
                                    const cno = Number(cur.targets?.[k]?.cycleNo) || 1;
                                    for (const e of bag) { e.imported = true; if (e.cycleNo == null) e.cycleNo = cno; }
                                }
                            }
                            for (const a of (Array.isArray(cur.alerts) ? cur.alerts : [])) {
                                if (keys.has(String(a?.target || ''))) a.imported = true;
                            }
                            // ★★ 2026-10-28（她报：仅状态导入后，旧成就被写上新档的日期）——
                            //   成就也有时间线：从旧档搬来的那些，日期属于旧时间轴 ⇒ 打 `imported`，
                            //   面板 / 设置页都不显示它们的日期（新档里正常解锁的没有这个标记 ✓）。
                            //   认法按**文件里那条成就的 id**（复制时原样带过来，不会认错到本聊天自己解锁的）✓
                            const impAchIds = new Set(
                                (Array.isArray(incoming.achievements) ? incoming.achievements : [])
                                    .map((a) => String(a?.id || '')).filter(Boolean));
                            if (impAchIds.size) {
                                for (const a of (Array.isArray(cur.achievements) ? cur.achievements : [])) {
                                    if (impAchIds.has(String(a?.id || ''))) a.imported = true;
                                }
                            }
                        } catch { /* 标记失败不影响导入 */ }
                    }
                    // ★ 快照**不再合并进来**（2026-10-19）：
                    //   原来的"按 messageIndex + 时间戳去重合并"看起来聪明，实际就是上面那个撞号的根
                    //   —— 旧聊天的第 12 楼和新聊天的第 12 楼是两回事，合并之后时光机分不清 ✗
                    commit();
                    // ⚠️ refreshAll 在 ui.js 里 ⇒ **不能静态 import**（ui.js 已经 import 了本文件，
                    //   会成循环依赖 ✗）⇒ 用动态 import（项目里已有这种用法 ✓）
                    try { const m = await import('./ui.js'); m.refreshAll?.(); } catch { /* 忽略 */ }
                    // 楼层小面板也跟着重画（不然还挂着旧的那几行 ✓）
                    try { const fl = await import('./ui-floors.js'); fl.refreshAllFloors?.(); } catch { /* 忽略 */ }
                    onChange?.(true);
                    // ★ 2026-10-26：导入完成也不弹右上角提示（她说不要弹）⇒ 只写控制台
                    console.log('[Bodycord] 已迁移 ' + inKeys.length + ' 个对象进来');
                } catch (e) {
                    console.warn('[Bodycord] 导入档案失败', e);
                    window.toastr?.error?.('导入失败：' + (e?.message || e));
                }
            });
            document.body.appendChild(input);
            input.click();
        }, off('先打开要导进去的那个聊天')),
        button('清空当前聊天档案', async () => {
            // ★ 说明里只写「身体档案」不行 —— 这个动作清的是**整个 state**
            //   （对象数值 / 日程 / 成就 / 随手记 / 占卜台历史 / 孩子 / 历史快照）⇒ 代价会被说小 ✗
            if (!(await askConfirm('把这个聊天里插件存的东西整个清空？\n\n包括对象与数值、日程、成就、随手记、占卜台历史、孩子、历史快照。\n\n只影响这个聊天，其他聊天不受影响；删了回不来，建议先「导出当前聊天档案」'))) return;
            resetAll();
            onChange?.(true);
        }, notInChat ? { variant: 'danger', disabled: true, title: '先打开要清的那个聊天（不在聊天里时，可能清到上一次打开的那个）' } : { variant: 'danger' }),
    ));

    const last = st.lastRun;
    if (last) {
        // ★ 「上次推演」那一行说人话：只报事实（时间 / 成没成 / 命中率 / 输入输出），**不带金额、也不倒 JSON** ✓
        const use = last.usage ? formatUsage(last.usage) : '';
        b.appendChild(h('div', { class: 'bc-hint', text: `上次推演：${new Date(last.ts).toLocaleString()}　${last.ok ? '成功' : '失败：' + (last.error || '')}${use ? '　' + use : ''}` }));
    }

    if (ST.errors.length) {
        b.appendChild(h('div', { class: 'bc-warn', text: '与酒馆本体的接口探测有告警（一般不影响使用）：' + ST.errors.join('；') }));
    }

    container.appendChild(box);
}

/** 一行「标题 + 开关 + 说明」 */
function toggleRow(label, value, onChange, hint) {
    const sw = toggle(!!value, (v) => onChange?.(v));
    return h('div', { class: 'bc-toggle-row' },
        h('div', { class: 'bc-toggle-main' },
            h('div', { class: 'bc-toggle-label', text: label }),
            hint ? h('div', { class: 'bc-hint', text: hint }) : null,
        ),
        h('div', { class: 'bc-toggle-sw' }, sw),
    );
}

/**
 * 「易读模式」—— 放在常规页**最上面**。
 *
 * ★ 放在常规页**最上面**：它是影响观看的那种开关 ✓
 * 名字来历：「大字报」= 用户名后面跟上更大的字（DC 那套）⇒ 皮一下 ✓
 *
 * ⚠️ 必须持久化（记得做一下记忆模式，别这次打开了下次就关上了）
 *    ⇒ 走 settings() + save() ⇒ ST 的 saveSettings() 落盘 ✓，并有断言实测 ✓
 */
function readabilitySection(container, onChange) {
    // ★ 那句「看不清的时候开易读模式…」搬进「？」✓
    const box = section('易读模式', {
        help: [
            '开易读模式：字号整体放大，最淡的那档灰加深，行距也放宽',
            '这个开关会记住，不用每次重开',
            '两档只影响「看着省不省力」，不改任何数据和判定',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    const opts = [
        // ★ 说明里**不许**写"这一档适合谁用"的说法（注释里也一样 ✗）
        //   ⇒ 只描述「字号和信息密度」本身 ✓
        ['normal', '正常', ''],   // ★ 说明不写"默认。字号和信息密度按标准来"（那只是把档名换个说法）✗
        ['large', '易读模式', '字号 ×1.3、对比度拉到 AAA、行距放宽，看着省力'],
    ];
    const row = h('div', { class: 'bc-choice' });
    const els = {};
    const sync = () => {
        const cur = settings().visionMode === 'large' ? 'large' : 'normal';
        for (const [id] of opts) {
            const el = els[id];
            if (!el) continue;
            el.classList.toggle('active', id === cur);
            // 圆点也要点亮：样式靠 .bc-choice-dot.on ✓
            el.querySelector('.bc-choice-dot')?.classList.toggle('on', id === cur);
        }
    };
    for (const [id, label, hint] of opts) {
        const el = h('div', {
            class: 'bc-choice-row',
            // 用 onclick（本项目约定 ✓）+ 点完立刻更新视觉 ✓
            onclick: () => {
                settings().visionMode = id;
                save();                        // ★ 落盘
                sync();                        // ★ 立刻反馈
                try {
                    document.getElementById('bc-root')?.setAttribute('data-vision', id);
                } catch { /* 忽略 */ }
                try { onChange?.(); } catch { /* 忽略 */ }
            },
        },
            h('span', { class: 'bc-choice-dot' }),
            h('div', { class: 'bc-choice-body' },
                h('div', { class: 'bc-choice-label' }, label,
                    id === 'large' ? h('span', { class: 'bc-choice-tag', text: '大字报' }) : null),
                h('div', { class: 'bc-choice-hint', text: hint }),
            ),
        );
        els[id] = el;
        row.appendChild(el);
    }
    b.appendChild(row);
    sync();

    container.appendChild(box);      // ★ 别忘了挂进 DOM ✗（漏了就是"建了但看不见"，而且不报错）
}

function appearanceSection(container, onChange, actions) {
    // ★ 五句说明搬进「？」（页面上只留按钮 ✓）
    const box = section('呈现方式与位置', {
        help: [
            '面板一律用「悬浮窗」：能拖、能缩、位置记得住，进不进聊天都在',
            '每个聊天楼层下面还会挂一份「该楼层的状态」（收起时只有一行，点箭头展开），跟着消息走，不用额外设置',
            '楼层面板的内容来自插件每轮存的历史快照，所以你看的是「那一楼当时的状态」，不是当前状态',
            '悬浮球长什么样、面板 / 侧栏的头像图标，都在「头像外观」那一页改',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        // ⚠️ 别在这两个按钮上加符号 —— 有些机器上几何图形类符号会变豆腐块 ✗
        button('贴到屏幕顶部', () => { actions.snapPanelTop?.(); }),
        button('贴到屏幕底部', () => { actions.snapPanelBottom?.(); }),
    ));
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('🎯 面板回到屏幕中央', () => { actions.resetPanelPosition?.(); }),
        button('🌸 悬浮球回到默认位置', () => { actions.resetFabPosition?.(); }),
    ));

    container.appendChild(box);

    // ---- 楼层开关 ----
    const fbox = section('楼层开关', {
        help: [
            '每个楼层面板最左边都有一个「参与推演 / 不参与推演」按钮',
            '点成「不参与推演」之后，插件 API 读正文时会直接跳过这一楼，适合 OOC、作者的话、小剧场、番外，或者你不想让它影响数值的任何一楼',
            '最新一楼如果还不是正文（比如你刚发完、AI 还没回，或者那一楼是系统提示），推演会直接不跑',
            '排除标记是写在消息上的，跟着聊天走：删楼、重 roll、换设备都不会串位',
        ],
    });
    const fb = fbox.querySelector('.bc-section-body');
    fb.appendChild(field('在聊天里显示楼层面板',
        toggle(settings().ui.showFloorPanel !== false, (v) => {
            settings().ui.showFloorPanel = v;
            save();
            onChange?.(true);
        }),
        '关闭后：聊天界面移除小面板，悬浮窗保留。推演的停止按钮改到悬浮球侧边的气泡上（推演进度在悬浮球里照旧能看）。'));
    container.appendChild(fbox);

}

/**
 * @param {HTMLElement} container
 * @param {() => void} onRefresh   轻量刷新（布尔开关用，不重建 DOM，所以不会跳回顶部）
 * @param {() => void} onRebuild   结构性变化才重建（换追踪模式、增删对象等）
 * @param {object} actions
 */
// ---------------------------------------------------------------------------
// 图标外观
// ---------------------------------------------------------------------------

/** 选图 → 自动压缩 → 回填。原图多大都行。 */
function pickIconImage(onPick) {
    pickAndCompressImage((res) => onPick(res.dataUrl), {
        preset: 'icon',
        label: '图标已压缩',
    });
}

function iconSection(container, onChange, opts = {}) {
    // 这一块最长（17 个槽位），默认收起，需要了再展开
    // ★ 开头那三行说明搬进「？」✓
    const box = section(opts.title || '图标外观', {
        collapsible: true,
        open: opts.open === true,
        // ★ 番茄钟那一块要自己一套说明 ⇒ 允许调用方整个换掉 ✓
        help: opts.help || [
            '这里换的全是面板里那些小圆头像：通用消息头像、占卜台、胎儿动态、敏感带、生理监测、置顶消息、音乐、随手记、透视。留空就用面板自带的渐变样子',
            '「通用消息头像」管的是面板里共用同一种头像的那几块消息：最近一次推演 / 提醒 / 谁干的好事 / 致孕方锁定 / 状态笔记 / 意识状态。上面有单独一格的（透视、胎儿动态、生理监测…）都不归它管',
            '支持图片直链（https://…）或上传本地图片（会自动压缩后存进插件设置）。改完立刻生效，不用重开面板',
            '侧栏频道的图标会加在「#」号前面，「#」是频道标记，保留着才和别的频道一致',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    const icons = customIcons();

    // 哪些槽位归这一块管（「侧边栏头像」和「悬浮球头像」各自独立成分类）
    const slots = opts.groups ? ICON_SLOTS.filter((s) => opts.groups.includes(s.group)) : ICON_SLOTS;

    // 拉平成一列，不再「折叠里套折叠」。
    //   原因：侧栏频道现在**只在收起的图标栏里显示图片**，「文字栏」那一列
    //   根本不换图，所以没必要再按「面板头像 / 侧栏频道」
    //   分两个可折叠子组。分组标题留着当分隔，但不再是可折叠的。
    const groups = new Map();
    const groupBox = (name) => {
        if (groups.has(name)) return groups.get(name);
        const box = h('div', { class: 'bc-icon-group' },
            h('div', { class: 'bc-section-title', text: name }),
        );
        b.appendChild(box);
        groups.set(name, box);
        return box;
    };

    for (const slot of slots) {
        const host = groupBox(slot.group);
        const cur = icons[slot.key] || '';

        // 有自定义图就不画那圈边框 —— 透明底的图标套个圆圈特别碍眼
        const preview = h('div', {
            class: 'bc-icon-preview' + (cur ? ' has-image' : ''),
            style: cur
                ? { backgroundImage: `url("${cur}")`, backgroundSize: 'cover', backgroundPosition: 'center', background: '' }
                : { background: slot.def || 'var(--bc-hover)' },
        });

        // ⚠️ 这里**不能**在 oninput 里 onChange(true) —— 那会每敲一个键就重建整个设置页，
        //   输入框被摘掉 ⇒ 失焦、没法完整粘贴图片直链 ✗
        //   ⇒ 只更新这一块自己的预览；面板那边等这一页下次重画时自然跟上 ✓
        const bump = () => { try { refreshPreview(); } catch { /* 忽略 */ } };
        const urlInput = textInput(cur, (v) => {
            setCustomIcon(slot.key, v.trim());
            bump();
        }, { placeholder: '留空 = 默认；或粘贴 https://… 图片直链' });

        const refreshPreview = () => {
            const now = customIcons()[slot.key] || '';
            if (now) {
                preview.style.background = '';
                preview.style.backgroundImage = `url("${now}")`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.classList.add('has-image');
            } else {
                preview.style.backgroundImage = '';
                preview.style.background = slot.def || 'var(--bc-hover)';
                preview.classList.remove('has-image');
            }
            urlInput.value = now;   // ⚠️ 有了这一行，输入框里那点空白也会被抹掉 ⇒ 别在 oninput 里带 onChange 重建 ✗
        };

        const controls = h('div', { class: 'bc-row bc-row-wrap' },
            // ★★ 上传一张图不能让折叠栏折叠起来（那样没法连续上传）✗
            //   根因：传 `onChange?.(true)` 就是**整页重建**（见 `renderAvatarTab` 里那句
            //   `structural ? onRebuild : onRefresh`）⇒ 重建之后那几张可折叠的卡又回到"收起" ✗
            //   ⇒ 传 `onChange?.()` ＝ 只 `refreshAll()`：页面不动（折叠状态保住 ✓），
            //     而图标照样会随 `statusViews[].update()` 推到面板（`iconCss` 就在那份 payload 里 ✓）
            button('📁 上传图片', () => {
                pickIconImage((url) => { setCustomIcon(slot.key, url); bump(); onChange?.(); });
            }),
            button('恢复默认', () => {
                setCustomIcon(slot.key, ''); bump(); onChange?.();
            }),
        );

        host.appendChild(h('div', { class: 'bc-icon-row' },
            preview,
            h('div', { class: 'bc-icon-row-main' },
                h('div', { class: 'bc-label', text: slot.label }),
                urlInput,
                controls,
            ),
        ));
    }

    // ★ 额外的行（番茄钟那颗球的头像）**位置**很讲究 ✗
    //   追加在「全部恢复默认」**后面**的话，那个按钮夹在两块头像中间、看着像只属于下面那块 ✗
    //   ⇒ 额外的行**放到按钮前面**，按钮留在卡片最底下 ✓
    for (const node of (opts.extra || [])) {
        if (node) b.appendChild(node);
    }

    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('全部恢复默认', () => {
            for (const slot of slots) setCustomIcon(slot.key, '');
            opts.extraReset?.();          // ★ 额外的行也是"这一卡的东西" ⇒ 一起恢复 ✓
            onChange?.();                 // ★ 同上：只刷不重建（重建会把折叠栏收起来 ✗）
            window.toastr?.success?.('已全部恢复默认图标');
        }),
    ));

    container.appendChild(box);
    return box;      // ★ 调用方要能往这张卡里再塞东西（`opts.extra` 之外的兜底 ✓）
}

// ---------------------------------------------------------------------------
// 头像外观（悬浮球头像 + 侧边栏头像 各自独立成分类）
// ---------------------------------------------------------------------------

/** 悬浮球头像 */
/**
 * 一行「头像」控件（预览 ＋ 上传 ＋ 恢复默认）—— 三处共用一份实现 ✓
 * ★ 从 `fabAvatarSection` 里抽出来，好让「番茄钟头像」那张卡也能用 ✓
 */
function avatarRow(label, hint, getImg, setImg, actions = {}) {
    const preview = h('div', { class: 'bc-icon-preview', style: { borderRadius: '50%' } });
    const paint = () => {
        const img = getImg() || '';
        if (img) {
            preview.style.background = '';
            preview.style.backgroundImage = `url("${img}")`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.classList.add('has-image');
        } else {
            preview.classList.remove('has-image');
            preview.style.backgroundImage = '';
            preview.style.background = 'var(--bc-blurple)';
        }
    };
    paint();
    return h('div', { class: 'bc-icon-row' },
        preview,
        h('div', { class: 'bc-icon-row-main' },
            h('div', { class: 'bc-label', text: label }),
            hint ? h('div', { class: 'bc-hint', text: hint }) : null,
            h('div', { class: 'bc-row bc-row-wrap' },
                button('📁 上传图片', () => pickAndCompressImage((res) => {
                    setImg(res.dataUrl);
                    save();
                    paint();
                    actions.onFabChange?.();
                }, { preset: 'avatar', label: label + '已压缩' })),
                button('恢复默认', () => {
                    setImg('');
                    save();
                    paint();
                    actions.onFabChange?.();
                }),
            ),
        ),
    );
}

function fabAvatarSection(container, onChange, actions = {}) {
    // ★ 两句说明搬进「？」✓
    // ★ BOT 和侧边栏头像看起来像属于番茄钟 ✗ ⇒ **番茄钟那三块头像集中到
    //   下面「番茄钟头像」那张卡里**（这颗球的头像也在那边 ⇒ 这张卡只剩「悬浮球头像」一行 ✓）
    const box = section('悬浮球头像', {
        help: [
            '就是右上角那个能拖动的小圆球，点它开面板',
            '不设就用插件自带的图标。上传的图会自动压缩，多大的原图都行',
            '番茄钟自己的三块头像（面板消息头像 / 侧栏频道 / 计时那颗球）都在下面「番茄钟头像」那张卡里 ✓',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    b.appendChild(avatarRow('悬浮球头像', '', () => settings().ui.fabImage,
        (v) => { settings().ui.fabImage = v; }, actions));

    /* ★★ 两条：
       ① 壳的颜色要能自定义（方便玩家换不同色系的图）⇒ 一排色块 ＋ 一个取色器 ✓
       ② 番茄钟的背景图要有透明度调整
          ⇒ 一条 0~100 的滑杆，**只影响贴进屏幕的那张图**（屏幕底色照旧 ✓） */
    // ★★ 光加一个小标题不够 —— 下面的头像也得隔离开，
    //   不然看起来像 BOT 和侧边栏头像属于番茄钟 ✗
    //   （小标题夹在两组东西中间，看着像给上面那几行当注脚 ✗）
    //   ⇒ **整块拆成独立一张卡**（壳色 / 屏幕图案透明度都归它），归属再无歧义 ✓
    const box2 = section('番茄钟悬浮球的外观', {
        help: [
            '「球壳颜色」= 计时那颗球外圈那层壳的底色（不填就用自带配色）',
            '「屏幕图案透明度」= 它屏幕里那张图案的浓淡，调到 0 就只剩纯色（屏幕底色照旧 ✓）',
            '这颗球本身的头像在上面「悬浮球头像」那张卡的「番茄钟悬浮球」那一行 ✓',
        ],
    });
    const b2 = box2.querySelector('.bc-section-body');
    const t = () => settings().timer || (settings().timer = {});
    /* 色系要有两套：色块给常用的（一按就有 ✓）、**色号输入框给"想什么色就什么色"**（覆盖任意色 ✓） */
    const SHELLS = [
        '', '#d0201f', '#e2604a', '#d97b2b', '#b9932a', '#8b8f2a',
        '#2f8f4e', '#12a3a3', '#2f6fb5', '#4338ca', '#6b4fbb', '#c2569b',
        '#8a6b4f', '#666b73', '#2b2b2b', '#f2f2f2',
    ];
    const shellRow = h('div', { class: 'bc-row bc-row-wrap', style: { alignItems: 'center' } },
        h('span', { class: 'bc-label', text: '球壳颜色' }));
    const hexInput = h('input', {
        class: 'bc-input bc-hex',
        type: 'text',
        maxlength: '7',
        spellcheck: 'false',
        placeholder: '#7a4de8',
        title: '填色号（# 开头 6 位）',
        onchange: (e) => {
            let v = String(e.target.value || '').trim();
            if (v && v[0] !== '#') v = '#' + v;
            if (!/^#[0-9a-f]{6}$/i.test(v)) {
                // 填得不对 ⇒ 退回"当前值"，别静默当成某个色 ✗
                e.target.value = String(t().shellColor || '');
                return;
            }
            t().shellColor = v;
            save();
            paintShells();
            actions.onFabChange?.();
        },
    });
    const paintShells = () => {
        const cur = String(t().shellColor || '');
        shellRow.querySelectorAll('.bc-swatch').forEach((el) => {
            el.classList.toggle('on', String(el.dataset.color || '') === cur);
        });
        if (document.activeElement !== hexInput) hexInput.value = cur;
    };
    for (const c of SHELLS) {
        shellRow.appendChild(h('button', {
            class: 'bc-swatch' + (c ? '' : ' bc-swatch-def'),
            type: 'button',
            title: c ? c : '默认（出厂红）',
            'data-color': c,
            style: c ? { background: c } : null,
            onclick: () => {
                t().shellColor = c;
                save();
                paintShells();
                actions.onFabChange?.();
            },
        }, c ? null : h('span', { text: '默认' })));
    }
    shellRow.appendChild(hexInput);
    paintShells();
    b2.appendChild(shellRow);

    const alphaOut = h('span', { class: 'bc-readout', text: String(Number(t().shotAlpha ?? 100)) + '%' });
    b2.appendChild(h('div', { class: 'bc-row', style: { alignItems: 'center' } },
        h('span', { class: 'bc-label', text: '屏幕图案透明度' }),
        h('input', {
            class: 'bc-range',
            type: 'range',
            min: '0',
            max: '100',
            step: '5',
            value: String(Number(t().shotAlpha ?? 100)),
            oninput: (e) => {
                const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                t().shotAlpha = v;
                alphaOut.textContent = v + '%';
                save();
                actions.onFabChange?.();
            },
        }),
        alphaOut,
    ));

    container.appendChild(box);
    container.appendChild(box2);
}

/**
 * 「阶段插图」—— 2026-10-17 起**自己一个分类**（从「头像外观」里拆出来，玩家说后面还要往里加东西）。
 *
 * 形态：
 *   · 总开关**默认开** ✓；位置 = 面板的**「透视」频道那一页**
 *     （不放「概览」最下面 ✓）
 *   · 关掉开关 ⇒ 那一页显示一句空状态（不是空白 ✓）
 *   · 图是**分层**的：底图（阴道：按精液量六档）＋ 子宫层（透明，五档）＋ 孕期五张 ＋ 透明底叠加层（五张）✓
 *   · 图**只存地址**（上传到酒馆图片库）—— 一张插画塞进设置会把设置文件撑爆 ✗
 *   · 没图的那一格自动显示文字版，所以"一张图都没有"也是能看的 ✓
 *
 * ⚠️ 打字时**不许重建整页**（这条是项目老规矩）：输入框只存值 + 就地更新那张小预览 ✓
 */
function stageSection(container, onChange, actions = {}) {
    // ⚠️ 位置文案里**不许写"最上面"** —— 位置是**面板的「透视」频道那一页** ✓
    // ★ 阶段插图的说明只留"界面自己看不出来的事"：
    //   ⇒ 这一份「？」压到 6 条：删掉"解释界面自己能看见的事"（没填图会怎样、回落怎么算）
    //     与重复描述；顺手把 `**` 去掉（「？」是 `text:` 纯文本渲染 ⇒ 星号会原样显示出来 ✗）
    const box = section('阶段插图', {
        help: [
            '在面板的「透视」频道里发一张插画，跟着当前状态换',
            '关掉上面这个开关 ⇒ 那一页只显示一句空状态（侧栏那一项还在 ✓）',
            '「透视」里画什么：只显示图片（本档没填的就用内置图）；切到「只显示文字」就一张图都不发，那一页只给文字',
            '标题和那句话按这一刻的状态换：排卵日的卵子 / 精子存活中 / 精子游向卵子 / 受精 / 受精卵着床；都不是就显示「普通的一天」',
            '图只存地址：你自己上传的图放在酒馆的图片库里（user/images/bodycord_stages/），设置里只记那个地址，不会把设置文件撑大',
            '内置图放在插件目录的 assets/stages/ 里，文件名对照表见同目录的 README.md；换图照原名覆盖就行，不用改代码',
            '跟着「当前正在查看的那个对象」走；月经 / 非月经 / 无月经三档各一套图，打开时自动选好当前这个角色在用的那一档（默认不会去借别的档的图，想借就打开下面那颗开关）',
            '「透视」的头像在「面板头像」里换',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    // ---- 自动选档：默认看**当前正在查看的那个对象**在用的那一档 ✓ ----
    //   （自动切换 —— 别让玩家先去点两档才看到自己该改的那份 ✓）
    const autoMode = (() => {
        try {
            const k = state().active;
            // ★★ 2026-10-16：**三档都要认**（加一个无月经的内视图）——
            //   以前中性那两档都落到 'none' ⇒ 无月经没有自己的一档 ✗
            if (k) {
                const pm = periodModeOf(k);
                return pm === 'amenorrhea' ? 'amenorrhea' : (isNeutralMode(pm) ? 'none' : 'normal');
            }
        } catch { /* 忽略 */ }
        try {
            const pm = periodMode();
            return pm === 'amenorrhea' ? 'amenorrhea' : (isNeutralMode(pm) ? 'none' : 'normal');
        } catch { return 'normal'; }
    })();
    let viewMode = autoMode;

    // ★ 2026-10-17：图版 / 文字版**各存各的**，这里是"现在在编辑哪一份"的唯一判据。
    //   ⚠️ 必须是**函数**、不能是 textSection 里的局部常量：`saveText()` 在它外面
    //     （兄弟函数），拿局部常量会当场 ReferenceError ⇒ 打字一个字都存不进去 ✗
    //     （第二次踩这个坑：第一次是 -67 上线后玩家报：保存的文字切一下就被清空）
    const curView = () => (stageTextOnly() ? 'text' : 'image');

    // ---- 总开关 + 一行读数 ----
    const nowLine = h('div', { class: 'bc-hint' });
    const modeLine = h('div', { class: 'bc-hint' });
    const paintNow = () => {
        let n = 0, t = 0;
        let lay = {};
        try { n = customStageCount(); } catch { /* 忽略 */ }
        try { t = customStageTextCount(); } catch { /* 忽略 */ }
        try { lay = stageLayersFor(state().active) || {}; } catch { /* 忽略 */ }
        // ★ 读数说的是"这一刻实际会画什么"——
        //   ⚠️ 2026-10-16 改成准确说法：内置图一直有 ⇒ 不能说"没填的用文字版" ✗
        //   ★★ 2026-10-18：改成**两个部位各报各的**（阴道一本账、子宫一本账 ✓）
        const tierName = (x) => SPERM_TIER_LABEL[x] || x;
        const parts = [];
        if (!stageTextOnly()) {
            if (lay.pregnant) {
                const vT0 = lay.vaginaTier || 'empty';
                if (vT0 !== 'empty') parts.push('阴道（' + tierName(vT0) + '）');
                parts.push('孕期第 ' + (lay.pregnantUsed || '?') + ' 张');
            } else {
                const vT = lay.vaginaTier || 'empty';
                const wT = lay.wombTier || 'empty';
                // ⚠️ 别解释这一档是怎么来的（不能只说成子宫溢下来的，也可能是阴道自己没清干净）⇒ 残留可以是子宫溢下来、
                //   也可以是阴道自己没清干净 ⇒ 读数只写档位，不猜来源 ✓
                if (vT !== 'empty') {
                    parts.push('阴道（' + tierName(vT)
                        + (lay.usedTier && lay.usedTier !== vT ? '，还没画 ⇒ 先用' + tierName(lay.usedTier) : '') + '）');
                }
                if (wT !== 'empty') {
                    parts.push('子宫（' + tierName(wT)
                        + (lay.wombUsedTier && lay.wombUsedTier !== wT ? '，还没画 ⇒ 先用' + tierName(lay.wombUsedTier) : '') + '）');
                }
            }
            for (const id of (lay.overlays || [])) parts.push(STAGE_LAYER_LABEL[id] || id);
        }
        nowLine.textContent = (stageTextOnly()
            ? '这一刻「透视」画的是文字版（你选了「只显示文字」，图一律不发）'
            : '这一刻「透视」会画：' + (parts.length ? parts.join(' ＋ ') : '（还没有图）'))
            + '；已经填了 ' + n + ' 张图'
            + (t ? '、改了 ' + t + ' 条文字' : '')
            + (stageTextOnly() ? '' : '（内置图有一整套，没填的格子也会用内置图）');
        // ★★ 2026-10-16（那句话容易误读成不能同时兼容三档透视图）——
        //   原来写的是「下面在编辑的是「X」这一档（你手动切过来的）」✗：
        //   它想说"你在编辑哪一档"，可读起来像"同时只能用一档" ✗
        //   ⇒ 说清三件事：**三档各存各的、谁用哪套由那个角色自己的周期模式决定、
        //     这一行只是"你在编辑哪一档"**；顺手把"留空借用上一档 / 清空只清本档"点出来 ✓
        // ★★ 2026-10-16（只显示文字那档下面看着像在说图片）——
        //   那一行原来一律说"下面填的是「X」这一档的图 / 留空就借用上一档的图" ✗
        //   可只文字档下**图那几段是收起来的**、下面填的其实是**文字** ⇒ 说法要跟着切 ✓
        modeLine.textContent = stageTextOnly()
            ? ('下面填的是「' + modeLabel(viewMode) + '」这一档的文字；'
                + '三档各存各的，谁用哪一套由那个角色自己的周期模式决定')
            : ('下面填的是「' + modeLabel(viewMode) + '」这一档的图；'
                + '三档各存各的，谁用哪一套由那个角色自己的周期模式决定。'
                + (borrowOnFor(viewMode)
                    ? '这一档留空会借用下面选的那一档的图（清空只清这一档，别的档不受影响）'
                    : '这一档留空就用内置图，不借用别的档（想要借用就打开下面那颗开关）'));
    };
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '让「透视」显示' }),
        toggle(stagesOn(), (v) => {
            setStagesOn(v);
            paintNow();
            // 面板要立刻跟上（关掉就不推了）⇒ 让它重建一次视图 ✓
            actions.onStagesChange?.();
        }),
    ));
    // ★★ 2026-10-16（文字版没意义，除非单独给文字版一个开关）——
    //   内置图一直有 ⇒ 不切这一档的话，**文字版永远不会生效** ✗
    //   ⇒ 布尔项两档两颗（默认排最左 ✓）：有图就给图 / 只显示文字
    const textSw = h('div', { class: 'bc-modesw' });
    // ★★ 2026-10-16（高亮在「只显示图片」、下面却还写着「你选的是只显示文字」）——
    //   根因：点击里只重画了**这排胶囊**（paintTextSw）＋读数（paintNow），
    //   **没重画下面的内容**（host 里那两段是按旧值渲染的）✗ ⇒ 看着自相矛盾
    //   ⇒ 改成点完直接 `redrawAll()`（它自己会重画胶囊 ＋ 读数 ＋ 内容 ✓）
    // ★ 名字按玩家的更正改过
    const paintTextSw = () => {
        clear(textSw);
        for (const [id, label] of [['image', '只显示图片'], ['text', '只显示文字']]) {
            const on = (id === 'text') === stageTextOnly();
            textSw.appendChild(h('div', {
                class: 'bc-modesw-opt' + (on ? ' active' : ''),
                text: label,
                onclick: () => {
                    if ((id === 'text') === stageTextOnly()) return;
                    setStageTextOnly(id === 'text');
                    redrawAll();            // ★ 胶囊 ＋ 读数 ＋ 下面的内容，一起重画
                    actions.onStagesChange?.();
                },
            }));
        }
    };
    paintTextSw();
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '「透视」里画什么' }), textSw));
    // 能不能显示孕期胎儿（有人不想要胎儿显示）
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '孕期显示胎儿' }),
        toggle(stageFetusOn(), (v) => {
            setStageFetusOn(v);
            redrawAll();
            actions.onStagesChange?.();
        }),
    ));
    b.appendChild(h('div', {
        class: 'bc-hint',
        text: '关掉之后，怀孕时不贴孕期那几张图，改回普通剖面（也就是不显示胎儿，其它照旧）',
    }));
    b.appendChild(nowLine);
    paintNow();

    // ---- 两档切换（默认已经自动选好了；点了只是"看另一档" ✓）----
    const modeSw = h('div', { class: 'bc-modesw' });
    const paintSw = () => {
        clear(modeSw);
        for (const m of ['normal', 'none', 'amenorrhea']) {
            modeSw.appendChild(h('div', {
                class: 'bc-modesw-opt' + (m === viewMode ? ' active' : ''),
                text: modeLabel(m),
                onclick: () => { if (m !== viewMode) { viewMode = m; redrawAll(); } },
            }));
        }
    };
    b.appendChild(modeSw);
    b.appendChild(modeLine);

    /**
     * **每一档各自独立的开关**（不是全局共用一个 ✓）
     *
     * ⚠️⚠️ 报：重启过了开关还是共享的——**真因**：这两行原来 append 到 `b`
     *   （永久区），而切档只重建 `host` ⇒ 控件一直是第一次渲染的那份，切到别的档看到的
     *   还是上一档的状态，**看起来就像共享** ✗
     *   ⇒ 抽成函数，在 `redrawAll()` 里跟图那几段一起重建 ✓
     */
    function borrowSection() {
        const box = h('div', {});
        box.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '借用别的档的图' }),
            toggle(borrowOnFor(viewMode), (v) => {
                setBorrowOnFor(viewMode, v);
                redrawAll();
                actions.onStagesChange?.();
            }),
        ));
        // ★ 只列**除自己以外**的那两档，单选 ✓
        const fromSw = h('div', { class: 'bc-modesw' });
        const others = ['normal', 'none', 'amenorrhea'].filter((m) => m !== viewMode);
        const cur = borrowFromFor(viewMode);
        // 存的值不在可选里（切档留下的自己那一档）⇒ 界面先显示第一个可选档
        const shown = others.includes(cur) ? cur : others[0];
        for (const m of others) {
            fromSw.appendChild(h('div', {
                class: 'bc-modesw-opt' + (m === shown ? ' active' : ''),
                text: modeLabel(m),
                onclick: () => {
                    if (borrowFromFor(viewMode) === m) return;
                    setBorrowFromFor(viewMode, m);
                    redrawAll();
                    actions.onStagesChange?.();
                },
            }));
        }
        box.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '从哪一档借' }), fromSw));
        box.appendChild(h('div', {
            class: 'bc-hint',
            text: borrowOnFor(viewMode)
                ? '「' + modeLabel(viewMode) + '」这一档留空的那一格，会按上面选的那一档去借（关掉就只用自己填的图）'
                : '「' + modeLabel(viewMode) + '」这一档现在只用自己填的图（三档各自独立，互不影响）',
        }));
        return box;
    }

    // ---- 一个容器装两段（每次切档整体重画这一段，别的区块不动 ✓）----
    const host = h('div', {});
    b.appendChild(host);

    function redrawAll() {
        // 为什么点击恢复默认之后会折叠起来？——
        //   根因：这一段是**整块重建**（`clear(host)` 再重新 append），而"展开 / 收起"
        //   是每张卡自己记的状态 ⇒ 重建之后全回到默认（有的默认就是收起）✗
        //   ⇒ 重建前按标题记下每张卡的展开状态，重建后按标题放回去 ✓
        // ★ 展开状态由 dom.js 的 section() 自己按标题记着（见那边 _secOpen）⇒ 这儿不用管 ✓

        // ★★ 2026-10-16（高亮停在「只显示图片」、读数却写「你选了只显示文字」）——
        //   根因：**这里漏了 `paintTextSw()`** ✗ ⇒ 值改对了、读数与内容也对，就那排胶囊不重画
        //   ⇒ 从此"这个开关的一切"（胶囊 / 读数 / 内容）都只由 redrawAll() 一处负责 ✓
        paintSw();
        paintTextSw();
        paintNow();
        clear(host);
        // ★ 图那半边是**分层**（底图 ＋ 叠加层 ＋ 残留两档）✓
        // ★★ 2026-10-16（重启后还显示底图地址，怀疑做错了）——
        //   我上一版只改了**发给面板的那份**（面板不再画图 ✓），**设置页的图槽位没动** ✗
        //   ⇒ 选「只显示文字」时，图那两段**整段不摆**（那一档一张图都不会发，摆着只会让人以为没生效 ✓）
        //   切回「有图就显示图」它们就回来 —— **图一点没删** ✓
        const onlyTextNow = stageTextOnly();
        if (!onlyTextNow) {
            // ★ 借用开关也在 host 里重建（否则切档看到的还是上一档的状态 ✗ 报过）
            host.appendChild(borrowSection());
            host.appendChild(baseSection());
            host.appendChild(wombSection());
            host.appendChild(pregnantSection());
            host.appendChild(layerSection());
        } else {
            host.appendChild(h('div', { class: 'bc-hint', text: '你选的是「只显示文字」⇒ 图那几段先收起来了（图一张都没删；切回「只显示图片」就能继续管）' }));
        }
        // 把残留怎么算、清理效率、精液撑出的外观挪到下面，别挤走文字编辑 ⇒ **文字编辑器排在前面**，这三块一律沉到它下面 ✓
        //   ⚠️ 顺序：图 → 文字 → 残留 → 清理效率 → 外观（图文两种模式都摆在这里）✓
        host.appendChild(textSection());

        // 「残留怎么算」还是跟着图走（它管的是"残留显示多久"，没有图就没什么可算的）✓
        if (!onlyTextNow) host.appendChild(residueRow());
        // 「清理效率」「精液撑出的外观」**不跟图走**：账照样在算 ⇒ 两档都摆 ✓
        host.appendChild(cleanRow());
        host.appendChild(bellySection());

    }

    /** 一行图槽位（底图 / 叠加层共用同一套骨架 ✓「同类控件长成一个样」） */
    function imgRow(sb, key, title, desc) {
        // ★★ 「清空」／重新上传**不能只改设置里那一格**：传上去的文件会**留在酒馆图片库里** ✗
        //   ⇒ 反复传同一张就会堆一串孤儿（`bodycord_stages` 里能积 21 个）✗
        //   ⇒ 现在**清空 / 被替换掉的那张，顺手从图片库删掉** ✓
        //   ⚠️ 两道闸：① 只删**我们自己传上去的**（`/user/images/bodycord_stages/` 下面那几个；
        //      外链、手填的地址一律不碰 ✗）② 还被别的格子引用着就不删 ✓
        const stillUsed = (url) => {
            for (const m of ['normal', 'none', 'amenorrhea']) {
                const bag = stageImages(m) || {};
                for (const k2 of Object.keys(bag)) if (bag[k2] === url) return true;
            }
            return false;
        };
        const dropUploaded = (url) => {
            const p = String(url || '').replace(/^\//, '');
            if (!/^user\/images\/bodycord_stages\//.test(p)) return;
            if (stillUsed(url)) return;
            deleteNotesImage(p).catch(() => { /* 删不掉也不影响设置已经清空 ✓ */ });
        };
        const preview = h('div', { class: 'bc-stage-preview' });
        // ★★ 2026-10-18（没借图时还显示图片容易误会）——
        //   槽位只画**玩家自己填的那张**；没填就是空槽（内置图那张不摆在这儿 ✗
        //   不然看着像"这一格已经填了"，而且会跟"借用别的档"混起来 ✓）
        const painted = () => {
            const own = String(stageImages(viewMode)[key] || '');
            if (own) {
                preview.style.background = '';
                preview.style.backgroundImage = 'url("' + own + '")';
                preview.classList.add('has-image');
                preview.title = '';
            } else {
                preview.style.backgroundImage = '';
                preview.style.background = 'var(--bc-hover)';
                preview.classList.remove('has-image');
                preview.title = '这一格留空 = 用内置图';
            }
            return own;
        };
        const urlInput = textInput('', (v) => {
            // ⚠️ 只存 + 就地更新预览，**不重建整页**（重建会把正在打字的输入框换掉 ✗）
            setStageImage(viewMode, key, v);
            painted();
            paintNow();
        }, { placeholder: '留空 = 用内置图' });
        urlInput.value = stageImages(viewMode)[key] || '';
        painted();

        sb.appendChild(h('div', { class: 'bc-stage-row' },
            preview,
            h('div', { class: 'bc-stage-row-main' },
                h('div', { class: 'bc-label', text: title }),
                // ★ 没说明就别画那一行（空的 `.bc-hint` 会白占一行间距 ✓）
                desc ? h('div', { class: 'bc-hint', text: desc }) : null,
                urlInput,
                h('div', { class: 'bc-row bc-row-wrap' },
                    button('📁 上传图片', () => pickImageFile(async (file) => {
                        try {
                            window.toastr?.info?.('正在上传…');
                            const before = String(stageImages(viewMode)[key] || '');   // 要被换掉的那张
                            const r = await saveStageImage(file);
                            setStageImage(viewMode, key, r.url);
                            urlInput.value = r.url;
                            painted();
                            paintNow();
                            actions.onStagesChange?.();
                            dropUploaded(before);   // ★ 换掉的那张顺手清掉（免得图片库里越堆越多 ✓）
                            window.toastr?.success?.(
                                `已上传：${humanBytes(r.bytes)}（${r.width}×${r.height}）`);
                        } catch (e) {
                            console.warn('[Bodycord] 阶段插图上传失败', e);
                            window.toastr?.error?.('上传失败：' + (e?.message || e));
                        }
                    })),
                    button('清空', () => {
                        const before = String(stageImages(viewMode)[key] || '');
                        setStageImage(viewMode, key, '');
                        urlInput.value = '';
                        painted();
                        paintNow();
                        actions.onStagesChange?.();
                        dropUploaded(before);   // ★ 顺手把那张图也从图片库删掉 ✓
                    }),
                ),
            ),
        ));
    }

    // ---- 底图：阴道（整幅不透明），按阴道里的精液量分六档（默认收起，不占地方 ✓）----
    // ★ 只留"这一档是什么"里看不出来的那两句（空 / 残留）：
    //   少 / 中 / 多 / 满 标签自己就说清了 ✗
    const TIER_DESC = {
        empty: '体内没有精液',
        residue: '清理之后的余量',
    };
    /** 六档的短名（设置页槽位标题用 ✓） */
    const tierLabel = (tier) => (SPERM_TIER_LABEL[tier] || tier);
    function baseSection() {
        const slots = section('底图（阴道，按精液量分档）', {
            collapsible: true,
            open: false,
            plain: true,
            help: [
                '建议画布 1200×900（4:3）。主体放中间、四周留点余量',
                '底图按阴道里精液的多少换一张：空 / 残留 / 少 / 中 / 多 / 满',
                '子宫里那一份精液是单独一张透明图，盖在这张上面（在下面「子宫」那一段里填）',
                '没画的档位会自动用最近的已画档顶上（少的没画就用「残留」，满的没画就用「多」）',
            ],
        });
        const sb = slots.querySelector('.bc-section-body');
        for (const tier of SPERM_TIERS) {
            imgRow(sb, vaginaKeyOf(tier), '底图 · ' + tierLabel(tier), TIER_DESC[tier] || '');
        }
        return slots;
    }

    // ---- 子宫：透明层，按子宫里的精液量分六档（空也要贴！底图里没有子宫 ✓）----
    function wombSection() {
        const slots = section('子宫（透明底，盖在底图上）', {
            collapsible: true,
            open: false,
            plain: true,
            help: [
                '必须是透明底 png，跟底图同一张 1200×900 画布，直接盖上去不用对位置',
                '按子宫里精液的多少换一张：空 / 残留 / 少 / 中 / 多 / 满',
                '底图那张（阴道）本身不带子宫，所以这一层每一档都会贴，空的时候也要贴「空」那张',
                '清洗的时候阴道降得快、子宫降得慢：阴道洗几次能到「空」，子宫最低只到「残留」',
                '内置图放在插件目录的 assets/stages/ 里，文件名对照表见同目录 README.md',
            ],
        });
        const sb = slots.querySelector('.bc-section-body');
        for (const tier of SPERM_TIERS) {
            imgRow(sb, wombKeyOf(tier), '子宫 · ' + tierLabel(tier), tier === 'residue' ? '清理之后的余量' : '');
        }
        return slots;
    }

    // ---- 孕期：五张整图，按孕周换 ----
    const PREG_DESC = {
        1: '前 8 周', 2: '9 到 16 周', 3: '17 到 24 周', 4: '25 到 32 周', 5: '33 周以后',
    };
    function pregnantSection() {
        const slots = section('孕期（按孕周换图）', {
            collapsible: true,
            open: false,
            plain: true,
            help: [
                '这五张是整张图（子宫和胎儿都画好了），怀孕的时候直接用它当底图，不再叠子宫层',
                '按已孕天数占总孕期的比例分五档，分界默认 20% / 40% / 60% / 80%，可以在下面改',
                '多胎只显示一个胎儿（这就是一张参考图，用来看胎儿大概多大了）',
            ],
        });
        const sb = slots.querySelector('.bc-section-body');
        for (const n of PREGNANT_STAGES) {
            imgRow(sb, pregnantKeyOf(n), '孕期 · 第 ' + n + ' 张', PREG_DESC[n] || '');
        }
        // ★★ 是自定义显示（高自定义插件不支持自定义显示很可笑）——
        //   分界按**比例**，四个百分比可以自己改 ✓
        const cutRow = h('div', { class: 'bc-row bc-row-wrap' });
        cutRow.appendChild(h('span', { class: 'bc-label', text: '分界（%）' }));
        const cutsNow = stageCuts();
        cutsNow.forEach((val, i) => {
            const inp = h('input', {
                type: 'number', min: '1', max: '99', step: '1',
                class: 'bc-num-sm', value: String(val), title: '第 ' + (i + 1) + ' 到第 ' + (i + 2) + ' 张的分界',
            });
            inp.onchange = () => {
                const cur = stageCuts().slice();
                cur[i] = Math.round(Number(inp.value)) || cur[i];
                setStageCuts(cur);
                redrawAll();
                actions.onStagesChange?.();
            };
            cutRow.appendChild(inp);
        });
        cutRow.appendChild(h('span', {
            class: 'bc-hint bc-hint-inline',
            text: '按"已孕天数 ÷ 这一胎总孕期"算。默认 20/40/60/80：人类 40 周时正好是 8/16/24/32 周',
        }));
        sb.appendChild(cutRow);
        return slots;
    }

    // ---- 叠加层：透明底，盖在子宫上（从下往上 ✓）----
    const LAYER_DESC = {
        sperm: '体内还有活精子时贴',
        egg: '排卵窗口内贴',
        sperm_egg: '两者都在时优先用它',
        fertilized: '受精成功、还没着床时贴',
        implanted: '已经着床时贴',
    };
    function layerSection() {
        const slots = section('叠加层（透明底的图，盖在底图上）', {
            collapsible: true,
            open: false,
            plain: true,
            // ⚠️ 这几条要跟当前的**五层**模型对上（不许留「六张」「胎儿」那类旧话 ✗）
            //   也没有 `**`（「？」是纯文本，星号会原样显示 ✗）
            help: [
                '必须是透明底 png，跟底图同一张 1200×900 画布，直接叠上去不用对位置',
                '五张各管一件事：精子 / 卵子 / 精子游向卵子 / 受精 / 已着床，按这一刻的状态自动贴或收',
                '清洗影响的是精液（底图和子宫层），这几张照旧贴',
            ],
        });
        const sb = slots.querySelector('.bc-section-body');
        for (const id of STAGE_LAYERS) {
            imgRow(sb, id, STAGE_LAYER_LABEL[id] || id, LAYER_DESC[id] || '');
        }
        return slots;
    }

    // ---- 「清理效率」三档并列----
    //   跟上面「残留怎么算」同一套写法（bc-modesw 胶囊，不是开关）✓
    const CLEAN_MODE_OPTS = [
        ['std', '标准'],
        ['fast', '快洗'],
        ['flush', '一次到底'],
    ];
    const CLEAN_MODE_DESC = {
        std: '标准：阴道「满 / 多」每次降一档、「中 / 少」每次降两档，洗到「空」要 满 5 次 / 多 4 次 / 中 2 次 / 少 1 次；子宫每次降一档，最低停在「残留」。',
        fast: '快洗：阴道每次都降两档，洗到「空」要 满 3 次 / 多 2 次 / 中、少 1 次；子宫「满 / 多」降两档，最低停在「残留」。',
        flush: '一次到底：阴道一次清到「空」，子宫一次清到「残留」。适合不想管洗几次、只想快点回到干净画面的玩法。',
    };
    function cleanRow() {
        const box = h('div', { class: 'bc-row bc-row-wrap' });
        box.appendChild(h('span', { class: 'bc-label', text: '清理效率' }));
        const sw = h('div', { class: 'bc-modesw' });
        const hint = h('div', { class: 'bc-hint' });
        const paint = () => {
            clear(sw);
            for (const [val, label] of CLEAN_MODE_OPTS) {
                sw.appendChild(h('div', {
                    class: 'bc-modesw-opt' + (stageCleanMode() === val ? ' active' : ''),
                    text: label,
                    onclick: () => { setStageCleanMode(val); paint(); },
                }));
            }
            hint.textContent = CLEAN_MODE_DESC[stageCleanMode()];
        };
        paint();
        box.appendChild(sw);
        return h('div', {}, box, hint);
    }

    // ---- 体内精液撑出的外观（A2：默认文案 + 每档可改 + 可关）----
    // 满、中、多的标题别带后面的括号 ⇒ 只留档位名 ✓
    const BELLY_LABEL = { max: '满', many: '多', mid: '中' };
    function bellySection() {
        const on = spermBellyOn();
        const head = h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '精液量的描写' }),
            h('div', { class: 'bc-spacer' }),
            h('span', { class: 'bc-label', text: '开' }),
            toggle(on, (v) => { setSpermBellyOn(v); redrawAll(); }),
        );
        const body = h('div', {});
        if (on) {
            // ★★ 2026-10-22 她嫌"分类有点奇怪，看着容易混乱" ⇒ 改成**按去处分三组**，
            //   每组里再按 满 / 多 / 中 排三行（原来九格按档位平铺，像九件不相干的事 ✗）
            const SLOTS = [
                { title: '阴道 · 体内（写进状态条一）', get: spermBellyTextVaginaIn, set: setSpermBellyTextVaginaIn, ph: '阴道那本的体内写法（留空 = 这一段不写）' },
                { title: '子宫 · 体内（写进状态条一）', get: spermBellyTextIn, set: setSpermBellyTextIn, ph: '子宫那本的体内写法（留空 = 这一段不写）' },
                { title: '子宫 · 体表（写进状态条二）', get: spermBellyTextOut, set: setSpermBellyTextOut, ph: '肚子那段怎么写（留空 = 这一段不写，中档默认不鼓）' },
            ];
            for (const slot of SLOTS) {
                const grp = h('div', { class: 'bc-field' },
                    h('div', { class: 'bc-row bc-row-wrap' },
                        h('label', { class: 'bc-label', text: slot.title }),
                    ),
                );
                for (const tier of SPERM_BELLY_TIERS) {
                    grp.appendChild(h('div', { class: 'bc-row bc-row-wrap', style: { marginTop: '6px' } },
                        h('label', { class: 'bc-label', text: BELLY_LABEL[tier] || tier }),
                    ));
                    grp.appendChild(textArea(slot.get(tier), (v) => slot.set(tier, v), {
                        rows: 2,
                        placeholder: slot.ph,
                    }));
                }
                body.appendChild(grp);
            }
            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                button('恢复默认文案', async () => {
                    if (!(await askConfirm('把三档的文案都恢复成默认？自己改过的会被覆盖'))) return;
                    resetSpermBellyText();
                    redrawAll();
                }),
            ));
        } else {
            body.appendChild(h('div', { class: 'bc-hint', text: '关掉了：状态里不会再有按精液量给出的句子，写不写全看剧情。' }));
        }
        return h('div', {},
            head,
            body,
            h('div', {
                class: 'bc-hint',
                text: '三个格子：阴道和子宫各有一本自己的量（满 / 多 / 中才写，少 / 残留 / 空不写），都写进状态条一；只有子宫会撑出肚子，那一段写进状态条二。哪一段留空就不写（中档体表默认是空的）。孕期的体型以孕周为准；非人形 / 卵生的对象按自己的载体写，不套小腹。改这里只影响描写，不影响任何判定。',
            }),
        );
    }

    // ---- 「残留」怎么算：两档并列（不是开关 ✓）----
    function residueRow() {
        const box = h('div', { class: 'bc-row bc-row-wrap' });
        box.appendChild(h('span', { class: 'bc-label', text: '残留怎么算' }));
        const sw = h('div', { class: 'bc-modesw' });
        const paint = () => {
            clear(sw);
            for (const [val, label] of [['cycle', '留到周期结束'], ['real', '按现实（第二天就干净）']]) {
                sw.appendChild(h('div', {
                    class: 'bc-modesw-opt' + (stageResidueMode() === val ? ' active' : ''),
                    text: label,
                    onclick: () => { setStageResidueMode(val); paint(); },
                }));
            }
        };
        paint();
        box.appendChild(sw);
        return h('div', {},
            box,
            // 改一下说明啊太容易被人误解了 ⇒ 拆成三条短句，一条管一件事 ✓
            h('div', {
                class: 'bc-hint',
                text: '这一项只影响显示，不参与任何判定。选「留到周期结束」：周期内一直显示；选「按现实」：过一天就回「空」。',
            }),
            h('div', {
                class: 'bc-hint',
                text: '「残留」是精液量的一档，阴道和子宫分开记，各有一份自己的量。清洗时阴道能一路洗到「空」，子宫最低停在「残留」；上面两档管的是这一档留多久，清理一次降几档由下面「清理效率」决定。',
            }),
            h('div', {
                class: 'bc-hint',
                text: '跨周期时，停在「残留」的会自动清空；「少 / 中 / 多 / 满」不会因为跨周期消失。',
            }),
        );
    }

    // ---- 六个状态的文字（可改；纯风格、不影响机制 ✓）----
    // ★★ 2026-10-16（只显示文字那档为什么不能编辑文字）——
    //   选了「只显示文字」时，面板上显示的就是这一段里的字 ⇒ **默认展开**（原来默认收起，
    //   玩家切过去只看到一屏图槽位，找不到该改哪儿 ✗）＋ 顶上补一句指路 ✓
    function textSection() {
        const onlyText = stageTextOnly();
        // ★ 2026-10-17：图版 / 文字版**各存各的**（为什么图片阶段和文字阶段的标题是共享的）——
        //   这一段改的就是"当前选中的那个显示方式"自己那一份 ✓
        const view = curView();
        const box2 = section('这一档的文字（可以自己改）', {
            collapsible: true,
            open: onlyText,
            plain: true,
            help: [
                '名字 = 面板「透视」那一页顶上那个标签；那一句话只在「只显示文字」那档才显示',
                '留空 = 用这一档的默认说法',
                '默认说法里的「卵子 / 排卵日」会跟着下面那张名字表走：月经那一档说「卵子」，非月经那一档说「生殖细胞」',
                '改完立刻生效（不用点保存），面板刷一下就能看到',
            ],
        });
        const tb = box2.querySelector('.bc-section-body');
        if (onlyText) {
            tb.appendChild(h('div', { class: 'bc-hint', text: '你现在选的是「只显示文字」⇒ 面板「透视」那一页显示的就是下面这些句子（上面的图槽位这时候一张都不发）' }));
        } else {
            // 图版里那个：一句话填了没反应（截图里指的是第二格输入框）
            //   —— 对：图版（`stageArtHtml(d, big)` 那条路）**不显示那一句话**，
            //      只有「只显示文字」那档才把它印在图上 ✗
            //   ⇒ 图版时**不摆**那一格（摆了就是个改了没反应的输入框 ✗），
            //     切到「只显示文字」自然就出现了（数据没删，改过的也还在 ✓）
            tb.appendChild(h('div', { class: 'bc-hint', text: '现在选的是「只显示图片」⇒ 下面只有名字那一格（它就是顶上那个标签）；那一句话要切到「只显示文字」才看得到，所以先不摆出来' }));
        }

        for (const key of STAGE_ORDER) {
            const def = stageTextOf(key, viewMode, view);
            const own = stageTextOverride(viewMode, key, view);
            const nameIn = textInput(own ? own.title : '', (v) => {
                saveText(key, v, null);           // 只存不重画 ✓
                paintNow();
            }, { placeholder: def.title + '（默认）' });
            const lineIn = onlyText ? textInput(own ? own.line : '', (v) => {
                saveText(key, null, v);
                paintNow();
            }, { placeholder: def.line + '（默认）' }) : null;

            tb.appendChild(h('div', { class: 'bc-stage-row' },
                h('div', { class: 'bc-stage-row-main' },
                    h('div', { class: 'bc-label', text: def.title }),
                    nameIn,
                    lineIn,
                    h('div', { class: 'bc-row bc-row-wrap' },
                        button('恢复默认', () => {
                            setStageTextOverride(viewMode, key, '', '', view);
                            redrawAll();
                            actions.onStagesChange?.();
                        }),
                        own ? h('span', { class: 'bc-badge', text: '已改过' }) : null,
                    ),
                ),
            ));
        }
        tb.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            button('这一档全部恢复默认', () => {
                resetStageTextOverrides(viewMode, view);
                redrawAll();
                actions.onStagesChange?.();
            }, { title: '只清这一档改过的文字' }),
        ));
        return box2;
    }

    /** 存文字：传进来的那项为准，另一项保持原样（都空 ⇒ 删掉这条 ✓） */
    function saveText(key, title, line) {
        const view = curView();               // ★ 必须在这儿取（见 stageSection 顶上 curView 那段 ✓）
        const cur = stageTextOverride(viewMode, key, view) || { title: '', line: '' };
        setStageTextOverride(viewMode, key,
            title == null ? cur.title : title,
            line == null ? cur.line : line, view);
    }

    redrawAll();
    container.appendChild(box);
}

/** 周期档的叫法（界面上三档：月经 / 非月经 / 无月经 ✓） */
function modeLabel(m) {
    return (m === 'amenorrhea') ? '无月经' : ((m === 'none') ? '非月经' : '月经');
}

/**
 * 「头像外观」页签。
 *
 * 结构：设置里面单开一个分类，
 *   把侧边栏头像和悬浮球头像放进去 ✓
 * ⇒ 所以这里只放**跟头像/图标有关**的几块，别的都留在「常规」页：
 *   · 悬浮球头像        —— 右上角那个球
 *   · 面板头像（面板里那九个小圆头像）
 *   · 侧边栏头像（九个频道图标）
 *   · 阶段插图（住在面板的「透视」频道那一页 ✓）
 */
export function renderAvatarTab(container, onRefresh, onRebuild, actions = {}) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    fabAvatarSection(container, onChange, actions);
    // ★★ BOT 和侧边栏头像看起来像属于番茄钟 ✗ ⇒
    //   **番茄钟那三块头像集中到这一张卡**：① 面板里那个「番茄钟」BOT 头像
    //   ② 侧栏收起时那颗「番茄钟」频道图标 ③ 计时那颗悬浮球自己的头像 ✓
    //   ⚠️ 三块要齐，缺一块就还是看着像分家 ✗
    iconSection(container, onChange, {
        title: '番茄钟头像',
        groups: ['番茄钟头像'],
        // ★ **默认收起** ✓
        //   （这一页连着四张头像卡，全都摊开太长 ⇒ 一律默认收起、点标题再开 ✓）
        open: false,
        help: [
            '番茄钟自己的三块头像：一 · 面板里那块「番茄钟」消息的小圆头像 二 · 侧栏收起时那颗「番茄钟」频道图标 三 · 计时那颗悬浮球的头像',
            '留空就用面板自带的渐变样子；上传的图会自动压缩后存进插件设置',
            '第三块（计时那颗球）留空时，会跟着上面「悬浮球头像」那张卡走 ✓',
        ],
        extra: [
            avatarRow('计时那颗球的头像', '计时的时候才出现；不设就跟着上面「悬浮球头像」那张走',
                () => (settings().timer || {}).ballImage,
                (v) => { const t = settings().timer || (settings().timer = {}); t.ballImage = v; },
                actions),
        ],
        // ★ 「全部恢复默认」在这张卡里要连第三块一起恢复 ✓（不然只清上面两块 ✗）
        extraReset: () => { const t = settings().timer || (settings().timer = {}); t.ballImage = ''; },
    });
    iconSection(container, onChange, { title: '面板头像', groups: ['面板头像'] });
    iconSection(container, onChange, { title: '侧边栏头像', groups: ['侧栏频道'] });
    // ⚠️⚠️ 这一页只放**头像类**的东西，两条别再犯：
    //   ① 别把整块「番茄钟」卡（多久 / 提示音 / 保活）搬进这一页 ✗
    //      （那些讲的是"时间"的事，番茄钟那张卡属于「时间与日历」✓）
    //   ② 别给番茄钟那颗球**单开一块头像槽位** ✗
    //      ⇒ 那颗球**共用上面「悬浮球头像」那一张图**（`settings().ui.fabImage`）——
    //        **不单开槽位** ✓（`ui.js` 的 `applyTimerBall` 会跟着那张图走 ✓）
    // ★★ 「阶段插图」2026-10-17 **自己占一个分类**（
    //   「插图阶段给它单独一个分类吧，放在头像外观下面，我后面还需要加东西，
    //    比如说更多拆分，因为怀孕的话阴道可能会有精液……之类的」✓）
    //   ⇒ 这里不再画它（见 renderStagesTab）；页面的**内容一个字没改**，只是挪了个家 ✓
}

/**
 * 「阶段插图」独立分类（2026-10-17 从「头像外观」里拆出来的）。
 *
 * 为什么要拆：玩家后面还要往这块里加东西（更多拆分，比如怀孕时阴道里可能有精液那种）
 * ⇒ 一直挤在"头像外观"里会和头像混在一起，越加越乱 ✓
 * ⚠️ 内容照旧全部来自 `stageSection()`（一份实现，两处不各写一份 ✗）
 */
export function renderStagesTab(container, onRefresh, onRebuild, actions = {}) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    stageSection(container, onChange, actions);
}

// ---------------------------------------------------------------------------
// 诊断与数据
//
// ⚠️ 不放主面板状态栏里：主面板右上角本来就有一个放大镜（面板自己的搜索），
// 两个 🔍 挨在一起会看懵 ⇒ 放这里（放在最上面，免得又找不到），
// 悬浮球的右键 / 长按菜单里也留了一个入口。
// ---------------------------------------------------------------------------

function diagSection(container, onChange, actions) {
    // 放在「常规」页最前面 —— 埋在最后面会找不到 ✓
    // ★ 说明搬进「？」✓
    const box = section('诊断与数据（排查用）', {
        collapsible: true,
        open: false,
        help: [
            '运行时状态、追踪数据、注入内容都能在这里看',
            '默认打码（只给行数 / 字数 / 开关这类结构信息），截图给别人也不会漏隐私',
            '要看原文按面板里的「显示原文」解锁，那只影响你本机屏幕，不会被导出',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    // 预览入口从**面板顶上**搬到这一块（原来是挤着设置入口了）
    //   ⇒ 预览本来就是排查用的，放这儿最顺 ✓
    //   ⚠️ 文案必须**跟着状态走**（开着时写"退出预览"，不然玩家在预览里找不到出口 ✗）
    const pv = (actions.previewState && actions.previewState()) || { mode: false, multi: false };
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('🔍 打开诊断与数据面板', () => actions.openDiag?.()),
        button(pv.mode ? '↩ 退出预览，回到真实数据' : '🎨 用样例数据预览面板', () => {
            if (actions.togglePreview) actions.togglePreview();
            else actions.openDiag?.();
        }, pv.mode ? { variant: 'primary' } : {}),
        // 多人那一颗只在预览开着时才有意义（跟以前那条预览条一个口径 ✓）
        pv.mode ? button(pv.multi ? '👥 多人模式预览' : '👤 单人模式预览', () => {
            if (actions.togglePreviewMulti) actions.togglePreviewMulti();
        }, {
            title: pv.multi ? '现在看的是多人追踪的样子；点一下回单一样例' : '点一下看多人追踪的样子',
        }) : null,
        // ★ 气泡预览在「时间与日历 → 提醒气泡」那张卡（跟自定义提醒词挨着 ✓）
    ));

    container.appendChild(box);
}

/**
 * 「日期怎么写」—— 写法模板。
 *
 * 要解决的是：年月日都是自定义名字的情况 ⇒ 四样可配：三个单位名 / 每个月的名字 / 数字怎么写 / 连接符。
 *
 * ⚠️ 铁律：**数字是唯一真相，名字只是外衣** ——
 *   算数永远走"从纪元第一天起第几天"，写法只负责读进来和写出去 ⇒
 *   改写法**时间轴一天都不动**（跟换历法走同一条天数守恒搬家 ✓）
 * ⚠️ 出厂写法就是 `1年01月01日` ⇒ 老存档一字不变 ✓
 */
function dateStyleSection(container, onChange) {
    const box = section('日期怎么写', {
        help: [
            '这里只改「日期看起来是什么样」，不改时间轴，周期第几天和孩子的年龄都不受影响',
            '三个单位：年 / 月 / 日 各叫什么。比如都改成 轮 / 朔 / 辰',
            '单位里写 # 代表数字的位置。想写成「第三轮」就填 第#轮；填 年 就是老样子「3年」',
            '数字怎么写：阿拉伯（1 2 3）/ 中文数字（一 二 三）/ 中文序数（初一 初二）',
            '月份名：想给每个月起名字就一行一个填，第 1 行就是 1 月。留空的那个月就用数字',
            '改完立刻生效。已经记下的日期会按同一个「第几天」重新写一遍',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    const cur = activeCalendarNow();
    const nM = cur.months.length;

    // ⚠️ 提示行要定义在用到它的函数**被调用之前**（不然就是 TDZ 报错 ✗）
    const warn = h('div', { class: 'bc-warn', text: '' });
    warn.style.display = 'none';

    const preview = h('div', { class: 'bc-hint', text: '' });
    const paintPreview = () => {
        const live = String(state().fictionDate || '').trim();
        const cal = activeCalendarNow();
        const sample = live || formatFictionDate({ y: 3, m: 2, d: 7 }, cal);
        preview.textContent = '现在会写成：' + sample + (live ? '（拿当前剧情日期举例）' : '（还没有剧情日期，拿 3 年 2 月 7 日举例）');
    };

    const apply = (patch) => {
        const now = activeCalendarNow();
        const style = Object.assign({}, now.style, patch);
        const problem = checkStyle(style, now.months.length);
        if (problem) {
            warn.textContent = problem;
            warn.style.display = '';
            return;
        }
        warn.textContent = '';
        warn.style.display = 'none';
        // ⚠️ 别忘了把「周」那两个字段也带回去 —— 带漏了就会在改一次写法时被规范化冲回默认 ✗
        setCalendar({
            months: now.months, leap: now.leap, style,
            weekLen: now.weekLen, weekStart: now.weekStart,
        });
        paintPreview();
    };

    // ---- 三个单位名 ----
    const unitInputs = ['年', '月', '日'].map((label, i) => h('div', { style: { flex: '1 1 90px' } },
        field(label + '叫什么', textInput(cur.style.units[i] || '', (v) => {
            const units = activeCalendarNow().style.units.slice();
            units[i] = String(v ?? '').slice(0, 8);
            apply({ units });
        }, { placeholder: '例：第#轮' }))));
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, ...unitInputs));

    // ---- 三个数字怎么写 ----
    const numInputs = ['年', '月', '日'].map((label, i) => h('div', { style: { flex: '1 1 130px' } },
        field(label + '的数字', dropdown(cur.style.nums[i] || 'ar', NUM_STYLES, (v) => {
            const nums = activeCalendarNow().style.nums.slice();
            nums[i] = v;
            apply({ nums });
        }))));
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, ...numInputs));

    // ---- 连接符 ----
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('div', { style: { flex: '1 1 90px' } },
            field('连接符', textInput(cur.style.sep || '', (v) => {
                apply({ sep: String(v ?? '').slice(0, 4) });
            }, { placeholder: '例：·' })))));

    // ---- 每个月叫什么（一行一个；留空就用数字 ✓）----
    const nameVal = (cur.style.months || []).join('\n');
    const nameBox = textArea(nameVal, (v) => {
        const lines = String(v ?? '').split('\n');
        const months = [];
        for (let i = 0; i < nM; i++) months.push(String(lines[i] ?? '').trim().slice(0, 8));
        apply({ months });
    }, { rows: Math.min(Math.max(nM, 3), 6), placeholder: '第 1 行 = 1 月\n留空就用数字' });
    b.appendChild(field('每个月叫什么（' + nM + ' 个月）', nameBox));

    b.appendChild(preview);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('恢复默认写法', () => {
            const now = activeCalendarNow();
            setCalendar({
                months: now.months, leap: now.leap, style: null,
                weekLen: now.weekLen, weekStart: now.weekStart,
            });
            onChange?.(true);
        })));
    paintPreview();
    b.appendChild(warn);

    container.appendChild(box);      // ★ 别忘了挂进 DOM ✗
}

/**
 * 「时间与日历」—— 自定义历法（「自定义时间兼容」）。
 *
 * 要的不只是替换名字，而是**非标准时间**也成立：
 *   一个月有 90 天、一年四个月 360 天这种 ✓
 *   ＋ 并且给一个初始表：玩家自己设定一年几个月、一个月多少天 ✓
 *
 * 形态（两档）：
 *   · 「公历」＝出厂那套（12 个月、四年一闰）
 *   · 「自定义」＝两个数字：一年几个月 ＋ 每月几天（每月都一样）
 * ⚠️ 内部存的是**一张每月天数的表** ⇒ 以后要"某个月长一点"只加界面，不用改数据结构 ✓
 * ⚠️ 改的时候**当场落盘 + 当场把当前聊天里的日期按天数守恒搬一次**（见 store.js）✓
 *
 * 为什么留一个模块级的草稿 `_calDraft`：两个输入框每次输入都会重建读数，
 *   但**清空重填的那一瞬间**（比如把 12 删成空）也得记住要填什么，
 *   否则一重建就把空值丢了、光标也跳 ✓
 */
let _calDraft = null;
// ★ 这份草稿是按**哪套历法**建的（`calendarPrint` 指纹）—— 历法一变就重建它 ✓
let _calDraftPrint = '';

function timeSection(container, onChange) {
    // ★ 卡片名按**内容**取——
    //   侧栏那一项已经叫「时间与日历」，卡上再顶着同一个名字纯属重复 ✗
    const box = section('时间怎么算', {
        help: [
            '公历就是现实里那套：12 个月，平年 365 天，四年一闰',
            '自定义：填「一年几个月」和「每月几天」。填 4 和 90，就是一年 4 个月、每月 90 天、一年 360 天',
            '自定义还能定「一周几天」和「纪元第一天是第几天」：只有算「5月第2个周日」那种节日用得上，跟时间轴无关',
            '插件跟时间有关的事都按它算：日期认不认、天数怎么加、两个日期差几天、孩子的年龄',
            '改历法不会动时间轴。已经记下的日期会按同一个「第几天」重新写一遍，周期第几天和年龄都不会变',
            '剧情里没给日期的时候，虚拟时间就从这套日历推，起点是 1 年 1 月 1 日',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    const cur = activeCalendarNow();
    const greg = isGregorian(cur);
    // ⚠️ 草稿要**跟着当前历法走** —— 只在 null 时建一次的话：
    //   导入历法包 / 点一条预设 / 切公历之后，两个输入框还显示旧值，
    //   再改任意一格，`applyDraft` 就会拿**旧草稿**算出另一套历法、静默改掉 ✗
    //   ⇒ 用历法指纹比一下：变了就重建；没变就保留草稿（清空重填那一瞬间的值和光标不丢 ✓）
    const curPrint = calendarPrint(cur);
    if (!_calDraft || _calDraftPrint !== curPrint) {
        _calDraftPrint = curPrint;
        _calDraft = {
            months: monthsPerYear(cur) || 12,
            days: isUniformCalendar(cur) ? cur.months[0] : 30,
            // ★ 周：一周几天 / 纪元第一天是第几天（跟上面两个格子一起当草稿 ✓）
            weekLen: cur.weekLen,
            weekStart: cur.weekStart,
        };
    }

    // 读数（现在这套历法到底是什么，一眼能看）
    const readout = h('div', { class: 'bc-hint', text: '现在这套：' + calendarSummary(cur) });
    // 提示行（填得不对时才有字）—— ⚠️ 必须定义在 `mkMode` **被调用之前**
    //   （箭头函数里引用它，调用时若还没初始化就是 TDZ 报错 ✗）
    const _calWarn = h('div', { class: 'bc-hint', text: '' });
    _calWarn.style.display = 'none';

    // ---- 两档：公历 / 自定义 ----
    const choice = h('div', { class: 'bc-choice' });
    const mkMode = (id, label, hint) => {
        const on = (greg ? 'gregorian' : 'custom') === id;
        return h('div', {
            class: 'bc-choice-row' + (on ? ' active' : ''),
            onclick: () => {
                if (id === 'gregorian') {
                    // ★ 只把**结构**换回公历那套 12 个月，**写法保留** ✓
                    //   （「写法」是上面那块的事；要连写法一起回出厂，就点预设里那条「公历」✓）
                    setCalendar({ style: activeCalendarNow().style });
                } else {
                    const c = makeUniformCalendar(_calDraft.months, _calDraft.days, _calDraft.weekLen, _calDraft.weekStart);
                    if (!c) {                       // 草稿不合法就不切（提示在下面那行读出来）
                        _calWarn.textContent = '先把两个格子填好，再切到自定义';
                        _calWarn.style.display = '';
                        return;
                    }
                    setCalendar(c);
                }
                onChange?.(true);                    // 结构变了（多/少两格）⇒ 重建这一页
            },
        },
            h('span', { class: 'bc-choice-dot' + (on ? ' on' : '') }),
            h('div', { class: 'bc-choice-body' },
                h('div', { class: 'bc-choice-label', text: label }),
                h('div', { class: 'bc-choice-hint', text: hint }),
            ),
        );
    };
    choice.appendChild(mkMode('gregorian', '公历', '12 个月，四年一闰'));
    choice.appendChild(mkMode('custom', '自定义', '自己定一年几个月、每月几天'));

    // ---- ★ 历法预设库（存几套，点一下就切过去）----
    //   一条预设 = 「历法 ＋ 写法」一整套 ⇒ 切过去两样一起换，省得改一半 ✓
    const presetChips = h('div', { class: 'bc-chip-list' });
    const presetNote = h('div', { class: 'bc-hint', text: '' });

    /** 现在是哪一条（**按内容比，不看名字** ✓；对不上就是"自己改的"） */
    const activePresetName = () => {
        const now = calendarPrint(activeCalendarNow());
        if (calendarPrint(GREGORIAN) === now) return '公历';
        const hit = listCalendarPresets().find((p) => calendarPrint(p.cal) === now);
        return hit ? hit.name : '';
    };

    const pickPreset = (id, name) => {
        const r = applyCalendarPreset(id);
        if (!r) { window.toastr?.warning?.('这条预设不见了'); return; }
        window.toastr?.success?.('已切到「' + name + '」');
        onChange?.(true);                    // 历法 ＋ 写法都换了 ⇒ 整页重建
    };

    const saveCurrentPreset = () => {
        // ★ 不用 window.prompt（安卓 WebView 里可能静默返回空 ✗）
        askText({
            title: '给这套历法起个名字',
            placeholder: '例：一年四个月',
            maxLen: 20,
            help: [
                '存进全局预设库，别的聊天也能用',
                '名字重复就是覆盖它',
            ],
        }).then((name) => {
            if (name === null) return;                 // 取消 ✓
            const r = saveCalendarPreset(name, activeCalendarNow());
            if (!r.ok) { window.toastr?.warning?.(r.error); return; }
            const n = String(name).trim();
            window.toastr?.success?.(r.overwrote ? ('已覆盖「' + n + '」') : ('已存为「' + n + '」'));
            redrawPresets();
        });
    };

    const redrawPresets = () => {
        clear(presetChips);
        const onName = activePresetName();
        // 内置那条：出厂公历（不可删、不可改名 ✓）
        presetChips.appendChild(h('div', {
            class: 'bc-chip bc-chip-pick' + (onName === '公历' ? ' bc-chip-on' : ''),
            title: '出厂那套：一年 12 个月，日期写法也是出厂那套',
            onclick: () => pickPreset(CAL_PRESET_BUILTIN, '公历'),
        }, h('span', { class: 'bc-pill-name', text: '公历' })));
        for (const p of listCalendarPresets()) {
            const on = p.name === onName;
            presetChips.appendChild(h('div', {
                class: 'bc-chip bc-chip-pick' + (on ? ' bc-chip-on' : ''),
                onclick: () => pickPreset(p.id, p.name),
            },
                h('span', { class: 'bc-pill-name', text: p.name }),
                h('span', {
                    class: 'bc-chip-x', text: '改', title: '改名字',
                    onclick: (e) => {
                        e.stopPropagation();
                        askText({ title: '改成什么名字', value: p.name, maxLen: 20 }).then((name) => {
                            if (name === null) return;
                            const r = renameCalendarPreset(p.id, name);
                            if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                            redrawPresets();
                        });
                    },
                }),
                h('span', {
                    class: 'bc-chip-x', text: '✕', title: '删掉这一条',
                    onclick: async (e) => {
                        e.stopPropagation();
                        if (!(await askConfirm('删掉预设「' + p.name + '」？现在用的这套不受影响'))) return;
                        deleteCalendarPreset(p.id);
                        window.toastr?.success?.('已删掉「' + p.name + '」');
                        redrawPresets();
                    },
                }),
            ));
        }
        presetChips.appendChild(h('div', {
            class: 'bc-chip bc-chip-add', title: '把现在这套存成一条',
            onclick: saveCurrentPreset,
        }, h('span', { text: '＋ 存成一条' })));
        presetNote.textContent = onName ? ('当前用的是预设「' + onName + '」') : '当前这套还没存过，想留着就点右边那个加号';
    };

    redrawPresets();

    // ⚠️ 不加「历法预设」这行小标题 —— 多余 ✗
    //   （底下那句读数「当前用的是预设「X」」已经把这一排是什么说清了 ✓）
    b.appendChild(presetChips);
    b.appendChild(presetNote);
    b.appendChild(readout);
    b.appendChild(choice);

    if (!greg) {
        const applyDraft = () => {
            const c = makeUniformCalendar(_calDraft.months, _calDraft.days, _calDraft.weekLen, _calDraft.weekStart);
            if (!c) {
                _calWarn.textContent = '一年 1 到 ' + MAX_MONTHS + ' 个月，每个月 1 到 ' + MAX_DAYS_PER_MONTH
                    + ' 天。两个格子都要填';
                _calWarn.style.display = '';
                return;
            }
            _calWarn.textContent = '';
            _calWarn.style.display = 'none';
            setCalendar(c);
            readout.textContent = '现在这套：' + calendarSummary(c);
        };

        const row = h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '1 1 140px' } },
                field('一年几个月', numberInput(_calDraft.months, (v) => {
                    _calDraft.months = v;
                    applyDraft();
                }, { min: 1, max: MAX_MONTHS }))),
            h('div', { style: { flex: '1 1 140px' } },
                field('每月几天', numberInput(_calDraft.days, (v) => {
                    _calDraft.days = v;
                    applyDraft();
                }, { min: 1, max: MAX_DAYS_PER_MONTH }))),
        );

        // ★★ 虚拟历法也要能算「某月第几个周几」⇒ 两个格子：
        //   一周几天（1..60）＋ 纪元第一天是这一周里的第几天（1..weekLen ✓）
        //   ⚠️ 改"一周几天"时要把"纪元第一天是第几天"**夹进新范围**（旧值越界就废了 ✗）
        //   ⚠️ `weekStartInput` 要先声明（handler 里要用它把夹好的值写回输入框 ✓）
        let weekStartInput = null;
        const weekStartField = field('纪元第一天是第几天',
            numberInput(_calDraft.weekStart, (v) => {
                const L = Math.floor(Number(_calDraft.weekLen));
                const n = Math.floor(Number(v));
                // 越界就夹回 weekLen（别让它落到"规范化兜回默认"那条路上 —— 界面上会看不出发生了什么 ✗）
                if (Number.isFinite(L) && L >= 1 && Number.isFinite(n) && n > L) {
                    _calDraft.weekStart = L;
                    if (weekStartInput) weekStartInput.value = String(L);
                } else {
                    _calDraft.weekStart = v;
                }
                applyDraft();
            }, { min: 1, max: MAX_WEEK_LEN }),
            '第1天就是周日，节日表按它数「第几个周几」');
        weekStartInput = weekStartField.querySelector('input');
        const weekRow = h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { style: { flex: '1 1 140px' } },
                field('一周几天', numberInput(_calDraft.weekLen, (v) => {
                    _calDraft.weekLen = v;
                    // 一周变短了 ⇒ 纪元那天那个号也得跟着夹（不然就超出 1..weekLen ✗）
                    const L = Math.floor(Number(_calDraft.weekLen));
                    if (Number.isFinite(L) && L >= 1 && Number(_calDraft.weekStart) > L) {
                        _calDraft.weekStart = L;
                        if (weekStartInput) weekStartInput.value = String(L);
                    }
                    applyDraft();
                }, { min: 1, max: MAX_WEEK_LEN }),
                '「某月第几个周几」那种节日按它算')),
            h('div', { style: { flex: '1 1 140px' } }, weekStartField),
        );

        b.appendChild(row);
        b.appendChild(weekRow);
        b.appendChild(_calWarn);
        b.appendChild(h('div', { class: 'bc-hint', text: '一年多少天不用填，插件按「几个月 × 每月几天」自己算' }));
    } else {
        b.appendChild(_calWarn);
    }

    // ★ 钟点 ——
    //   三档：不记钟点（出厂）/ 记到小时 / 记到分钟 ✓
    b.appendChild(h('div', { class: 'bc-section-title', text: '钟点' }));
    // ★ 这一组三档要在页面上说一句：页面上和「？」里都一个字没提 ✗
    b.appendChild(h('div', { class: 'bc-hint', text: '记了之后推演和面板都会带上时间；改这一档不会动已经记下的日期' }));
    {
        const curU = timeUnitNow();
        const urow = h('div', { class: 'bc-choice' });
        for (const [id, label] of TIME_UNITS) {
            const on = curU === id;
            urow.appendChild(h('div', {
                class: 'bc-choice-row' + (on ? ' active' : ''),
                onclick: () => {
                    const now = activeCalendarNow();
                    setCalendar({
                        months: now.months, leap: now.leap, style: now.style, timeUnit: id,
                        weekLen: now.weekLen, weekStart: now.weekStart,
                    });
                    onChange?.(true);
                },
            },
                h('span', { class: 'bc-choice-dot' + (on ? ' on' : '') }),
                h('div', { class: 'bc-choice-body' }, h('div', { class: 'bc-choice-label', text: label })),
            ));
        }
        b.appendChild(urow);
    }

    container.appendChild(box);      // ★ 别忘了挂进 DOM ✗（漏了就是"建了但看不见"，而且不报错）
}

/**
 * 「时间与日历」页签。
 * 为什么单独一个页签：**别塞常规里面 —— 那边太长了** ✓
 * 里面两块：历法（一年几个月 / 每月几天 ＋ 预设库）＋ 日期怎么写（单位名 / 月份名 / 数字写法 / 连接符）
 */
/**
 * 「节日」—— 日历上出厂那张节日表（**可加可删可改** ✓）。
 *
 *   ⇒ ① 出厂表要厚（万圣夜 10/31 和万圣节 11/01 **分开两条** ✓）；
 *      ② 这张卡给玩家自己加（**农历节日也支持** —— `src/lunar.js`，
 *         能填「农历八月初五」这种了；⚠️ 但农历那条**只在历法就是真实公历时才算得出来** ✓）
 */
/**
 * 节日那条要显示成什么样（名字 ＋ **日期** ✓）
 *
 * ★ 节日表里每一行都得有日期 ✗ ——
 *   「母亲节 / 父亲节 / 感恩节」是"某月第几个星期几"那种形状，不写的话**日期是空的** ✗
 *   ⇒ 三种形状都写成看得懂的中文日期 ✓
 */
function holidayDateText(hh) {
    const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (hh.md) return hh.md.replace(/^0?(\d+)-0?(\d+)$/, '$1月$2日');
    if (hh.lunar) {
        // ★ 显示成人话，不显示「农历 08-15」那种坐标写法 ——
        //   `08-15` →「农历八月十五」、`01-01` →「农历正月初一」、`12-LAST` →「农历腊月最后一天」✓
        //   ⚠️ `12-LAST` = 那个农历月的**最后一天**（除夕就是它）—— 不能写死 `12-30`：
        //     腊月有的年 29 天（2025–2028 连着几年都是）⇒ 写死会把那几年的除夕丢掉 ✗
        //   （中文读法与匹配口径都在 src/lunar.js ✓）
        return '农历' + lunarSpecText(hh.lunar);
    }
    if (Number(hh.m) > 0 && Number(hh.nth) > 0 && Number.isFinite(Number(hh.wd))) {
        return hh.m + '月第' + hh.nth + '个' + (WD[hh.wd] || ('星期' + hh.wd));
    }
    return '';
}

function holidaySection(container, onChange) {
    const box = section('节日', {
        help: [
            '日历上日子下面那行小字，就是这里来的',
            '节日挂在「几月几日」上、不挂年份，所以每年都会自己出现',
            '这一格能写三种：一 · 几月几日，例 `09-15`（也可以写 `9月15日`）；二 · 某月第几个星期几，例 `5月第2个周日`（周日 / 星期一 / 礼拜天 都认）；三 · 农历，例 `农历八月初五`（除夕写 `除夕` 或 `农历腊月最后一天`）',
            '⚠️ 第二种（母亲节那种）两种历法都算：历法是"公历"时按真实星期算；自定义历法按你定的「一周几天 + 纪元第一天是第几天」算',
            '⚠️ 第三种（农历）只在历法是"公历"时才算。自定义历法跟现实没有对应关系，农历落不到某一天上（那种历法下它不显示）',
            '⚠️ 农历不算闰月（闰八月十五不是中秋）',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    const warn = h('div', { class: 'bc-warn', text: '' });
    warn.style.display = 'none';
    const listHost = h('div', { class: 'bc-chip-list' });
    const mdInput = textInput('', () => {}, { placeholder: '日期，例：09-15 / 5月第2个周日 / 农历八月初五' });
    const nameInput = textInput('', () => {}, { placeholder: '叫什么，例：中秋' });

    const redraw = () => {
        clear(listHost);
        const list = holidayList();
        if (!list.length) {
            listHost.appendChild(h('span', { class: 'bc-hint', text: '（现在一个都没有）' }));
            return;
        }
        for (const hh of list) {
            listHost.appendChild(h('div', { class: 'bc-chip' },
                h('span', { class: 'bc-pill-name', text: hh.name }),
                // ★ 日期：三种形状都写出来 ✓
                h('span', { class: 'bc-pill-tag', text: holidayDateText(hh) }),
                h('span', {
                    class: 'bc-chip-x', text: '✕', title: '删掉这一天',
                    onclick: () => { removeHoliday(hh.key); redraw(); onChange?.(); },
                }),
            ));
        }
    };

    const add = () => {
        const r = setHoliday(String(mdInput.value || '').trim(), String(nameInput.value || '').trim());
        if (!r.ok) { warn.textContent = r.error; warn.style.display = ''; return; }
        warn.textContent = '';
        warn.style.display = 'none';
        mdInput.value = '';
        nameInput.value = '';
        redraw();
        onChange?.();
    };

    b.appendChild(toggleRow('在日历上显示节日', holidaysOn(), (v) => { setHolidaysOn(v); redraw(); onChange?.(); }));
    // ★ 公历下面再写一行农历 ⇒ 格子里多一行农历
    //   ⚠️ 跟上面那个节日开关**各管各的** ✓
    b.appendChild(toggleRow('格子里显示农历', lunarDatesOn(), (v) => { setLunarDatesOn(v); redraw(); onChange?.(); },
        '只在剧情日期是真实公历时显示'));
    b.appendChild(listHost);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('div', { style: { flex: '1 1 130px' } }, mdInput),
        h('div', { style: { flex: '1 1 170px' } }, nameInput),
        button('加一个', add)));
    b.appendChild(warn);
    redraw();

    container.appendChild(box);      // ★ 别忘了挂进 DOM ✗
}

/**
 * 「年历和节日」—— 把这一页整理好的东西打包带走 / 拿别人的进来 ✓
 *
 * 节日和年历也要能导入导出，方便把整理好的东西分享到其他设备或者其他人 ✓
 * ⚠️ 卡片名用「年历和节日」：卡片名要**按内容起名**，不写动作
 *   （按钮那两颗叫「导出这一页 / 导入」—— 那是动作，本来就该那么写 ✓）
 * ⚠️ 导入是**合并**（同名预设 / 同一天的节日才覆盖）—— 别把别人自己那堆冲掉 ✗
 * ⚠️ 里面没有日程 / 红圈 / 提醒账本（**两份都不在里面**：剧情那份按聊天存、现实那份在插件设置里 ✓）——
 *    help 里要写清楚，只说「它们跟着各自的聊天走」的话那只说对了剧情那一份 ✗
 */
function shareSection(container, onChange) {
    const box = section('年历和节日', {
        help: [
            '导出的是这一整页：历法、日期怎么写、历法预设库、节日表',
            '发给别人或拷到另一台设备，导入一下就都在了',
            '导入是合并：同名的历法预设、同一天的节日会被覆盖，你原本其它的条目都留着',
            '日程（红圈）和提醒不在这里面：日程跟着各自的聊天走，提醒气泡那句话跟着插件设置走，换聊天也还在',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('📤 导出这一页', () => {
            try {
                const data = calendarBundle();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'bodycord-calendar.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                window.toastr?.success?.(`已导出（历法 ＋ ${data.presets.length} 条预设 ＋ ${data.holidays.length} 个节日）`);
            } catch (e) {
                window.toastr?.error?.('导出失败：' + (e?.message || e));
            }
        }),
        button('📥 导入', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            input.addEventListener('change', async () => {
                const f = input.files?.[0];
                input.remove();
                if (!f) return;
                try {
                    const incoming = JSON.parse(await f.text());
                    if (!looksLikeCalendarBundle(incoming)) {
                        window.toastr?.error?.('这个文件不是「时间与日历」的导出文件');
                        return;
                    }
                    if (!(await askConfirm('导入会把文件里的历法换过来，并把你没有的历法预设 / 节日加进来。\n\n'
                        + '同名的预设、同一天的节日会被文件里的覆盖，其它条目都留着。确定吗？'))) return;
                    const r = applyCalendarBundle(incoming);
                    if (!r.ok) { window.toastr?.error?.(r.error || '导入失败'); return; }
                    window.toastr?.success?.(`导入完成：历法已换，预设新增 ${r.added} 条 / 覆盖 ${r.overwrote} 条，节日新增 ${r.holidays} 条`
                        + (r.skipped ? `，${r.skipped} 条预设因已满 20 条没进来` : ''));
                    onChange?.(true);          // 页面上那排预设胶囊要跟着重画 ✓
                } catch (e) {
                    window.toastr?.error?.('导入失败：' + (e?.message || e));
                }
            });
            document.body.appendChild(input);
            input.click();
        }),
    ));
    container.appendChild(box);
}

/**
 * 「提醒气泡」那张卡。
 *
 * 口径：提醒气泡要能搞一个全局自定义的提醒词，放在设置里面 ✓
 * ⇒ 一句可改的提醒词 ＋ 那颗预览按钮，**住同一张卡**（改完点一下就能看见 ✓）。
 *   （预览按钮属于这一张卡，不再挂在「常规 → 诊断与数据」那张排查用的卡上 ✓）
 *   ⚠️ **那颗预览按钮**叫「日程气泡」；
 *     ⚠️ **卡片名仍然叫「提醒气泡」** —— 别顺手把卡片名也改了 ✗
 *     （卡片一起改名会撞断言，而且改的只是那颗按钮 ✓）
 *
 * ⚠️ **不设字数上限** ⇒ 长了由气泡自己折行（见 style.css 的 `.bc-bubble-title` ✓）
 * ⚠️ 留空 = 回出厂那句（读取有兜底，气泡顶上不会空白 ✓），那句状态写在灰字里 ✓
 */
function bubbleSection(container, onChange, actions = {}) {
    const box = section('提醒气泡', {
        help: [
            '日程到日子了，会从悬浮球旁边冒一个气泡提醒你，它不会自己消失',
            '点 ✕ 就是知道了，点气泡本身会跳到日历那一页',
            '气泡顶上那句可以自己写，改完点「日程气泡」立刻能看到',
            '留空就用出厂的「到日子了」',
            '预览出来的那个气泡只给你看长相，点它不会跳页',
            '番茄钟到点那个气泡是另一套词（在下面那张「番茄钟」卡里改）',
            '下面两颗是插件自己发的提醒：着床完成（怀孕）那一刻、以及每胎的预产期到那天',
            '气泡里会写清"距今多少天"（例：已着床 32 天、预产期已过 5 天），剧情跳过一段时间也不会看错',
            '这两条不会写进日历日程，只是借这个气泡弹一下：不占你的日程、也不跟你的日程混在一起',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    b.appendChild(field('气泡上那句', textInput(
        String(settings().bubbleTitle ?? ''),
        (v) => { settings().bubbleTitle = String(v ?? ''); save(); },
        { placeholder: '留空就用「到日子了」' },
    )));
    // ★★ 在设置里面给一个开关控制提示，默认开启 ✓
    //   （**独立出来**的那两条自动提醒各一颗开关 ✓；判据一律写 `!== false` ⇒ 老存档按"开" ✓）
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '受孕结果提醒我（着床完成 / 受精成功但没着床）' }),
        toggle(settings().notifyConceive !== false, v => { settings().notifyConceive = !!v; save(); }),
    ));
    b.appendChild(h('div', { class: 'bc-inline' },
        h('span', { class: 'bc-label', text: '到预产期提醒我（每胎一条）' }),
        toggle(settings().notifyDue !== false, v => { settings().notifyDue = !!v; save(); }),
    ));
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('日程气泡', () => { actions.previewBubble?.(); }),
    ));
    // ★★ 「这个聊天里插件记下的提醒」**不占设置页的明面** ✗ ——
    //   它是**这个聊天的游戏数据**，该住在**面板的频道**里
    //   （不列出来的话，掷定的预产期除了"到那天弹气泡"就再也看不见了）
    //   ⚠️ 数据本身在 `state().alerts`（跟日程 / 成就一个待遇，跟着聊天走 ✓），
    //     这里只是没有那个"查看口" —— 面板那边的入口还没定放哪个频道 ✓
    container.appendChild(box);
}

/**
 * 「修正剧情时间」—— 手动把剧情日期平移 N 天，**两个方向都做**。
 *
 * 起因：AI 有的时候会算错时间（它的时间意识没那么好）✓
 * 两个 AI 都会犯蠢：**插件 API**（推演引擎）漏报 / 报错 ⇒ 该过的天数没走；
 *   **主 API**（写正文）把时间写歪 ⇒ 插件只能照正文读 ⇒ 时间轴跟着歪。
 * ⇒ 两行按钮：**往未来补**（补上漏掉的天数）／**往过去退**（时间走多了退回来）✓
 *
 * ★★ 命名：**不许写「往前 / 往后」**（那两个词有歧义 ✗）——
 *   那两个词在时间语境里两个方向都能读（"往前看"=未来、"往前推"=过去）⇒
 *   一律用**未来 / 过去**，谁读都不会错 ✓
 *
 * ★★ **判不出来的时候只许拒，绝不许悄悄朝反方向走** ✓
 *     （两行各自有闸，见下面 `blockedReason()`；退到历法第一天之前也是拒 ✓）
 *
 * ⚠️ 都**不可逆**（现场结算过的那笔账收不回来）⇒ 按项目规矩：明面留一句最短的后果，
 *   详细解释进「？」；按钮上直接写清"几天"，点完如实报结果（不许含糊 ✗）。
 */
function shiftDaySection(container, onChange) {
    const box = section('时间跳跃与修正', {
        help: [
            '什么时候用：剧情里明明过了一段时间（过夜、三天后、隔了一个月），但推演那边没报出来，日历停着不动',
            '或者反过来：写正文那个把时间写多了（写「三个月后」其实只过了一天）⇒ 时间轴走歪了，要退回来',
            '往未来补 N 天：补上漏掉的天数。补完当场把该算的账算掉（该来月经的来月经、该着床的着床、跨过受孕窗口的当场判定）',
            '往过去退 N 天：把日期退回去。退哪些东西看上面那两档：选「经历了」＝日期和已经记下的日期一起往过去退（周期锚点留着 ⇒ 周期第几天 / 孕周也跟着退回来）；选「没经历」＝只挪日历，已经记下的日期一起搬、周期第几天不变',
            '⚠️ 两个方向都不撤销已经算过的账：来月经、着床、分娩这些落过账的收不回来。填之前先确认剧情到底过了多久',
            '「这次手填的改动」那两档是穿越用的：选「经历了」＝这 N 天真的过了（周期、孕周、痕迹都跟着走，该结算的结算）',
            '选「没经历」＝只有日历挪过去，该角色的身体一个都没动（孕周 / 周期 / 痕迹不变，也不结算）⇒ 肉身穿越、只有灵魂过去、被丢到很多年以后，都走这一档',
            '⚠️ 这两档都是"整个世界一起"的（一个聊天只有一根时间轴）：选「没经历」时，所有角色已记的日期会一起搬 ⇒ 它说的是"这一次时间改动，对这个聊天里的所有人算不算数"，不是按人分开的',
            '下面「推演每轮自己报的跳跃」管的是另一条路：推演每轮自己报的这次时间跳跃（往哪边跳、跳多少、身体有没有经历都由它说）。三颗默认是「让推演判断」，时间来回跳也不用你管；想固定住"身体那半"（整篇都是这一类设定）就点「算身体时间」或「不算」，之后以你点的为准，插件也不再每轮问它 ✓',
            '「例外」是给部分人用的：选进来的人跟上面那格相反（上面选「算身体时间」，选进来的就是"身体没经历"）⇒ 剧情里"一拨人真的过了十年、另一拨身体没跟着走"那种就靠它 ✓',
            '例外可以多选，也可以直接手输名字；输进去的名字不在追踪名单里的话，插件会明说、不会静默失效 ✓',
            '标签（在「角色基础信息」里）是给同一部作品的不同版本 / 篇章分类用的，比如「未来篇」「十年后」。它没有预设清单，推演看到剧情里怎么写就怎么报；你手打过就以你为准 ✓',
            '⚠️ 「回过去 ＋ 身体经历了这段」原来算真倒流（那段经历要作废）、那颗按钮在这儿是灰的；2026-10-16 改成能点了：往回退要退哪些东西由上面那两档自己挑 ✓（真要从剧情上退回某一楼之前，还是走时光机的「从这里重新开始」）',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    const readout = h('div', { class: 'bc-hint' });
    // ⚠️ **能不能点**要当面说清（不说的话在设置页点了，结果可能补进空气里 ✗）——
    //   不能点的时候按钮灰掉但**留着**（项目规矩），下面一句最短的原因 ✓
    const noteFwd = h('div', { class: 'bc-hint' });
    const noteBack = h('div', { class: 'bc-hint' });
    /** 这个方向现在能不能做？不能就返回一句人话（能做返回空串） */
    const blockedReason = (dir) => {
        try {
            // ★ 被排除的角色卡：剧情日期属于推演账本 ⇒ 这一格不给改（2026-10-28）
            //   （按钮灰着但留着，旁边写着这句原因 —— 项目规矩：不能点也要说清为什么 ✓）
            if (isCardExcluded()) return '这个角色卡没有启用推演，改不了剧情日期';
            if (!inRealChat()) return '先进入一个聊天（里面要有正文），这一格才有地方改';
            const cur = currentDate();
            if (!cur) return '这个聊天还没有剧情日期，先让推演跑一轮再来改';
            if (dir === 'back') {
                // ★★ 2026-10-16（按钮点不动那设计它做什么 ＋
                //   "那个时光机是很久之前的事情了…这个也得改"）——
                //   原来这里有一条闸：选「经历了」时"回过去 ＋ 经历"算真倒流 ⇒ **整颗灰掉**、
                //   只让玩家走时光机 ✗。玩家的判断是：**按钮存在就该能用**，老规矩不该一直挡着 ✓
                //   ⇒ 现在不灰了：选「经历了」就**只退日期**（周期第几天 / 孕周跟着变回来 ✓），
                //     选「没经历」就照旧连已记的日期一起搬 —— 分在 `doShift` 里做 ✓
                //   ⚠️ 只剩这条硬边界：退到历法第一天之前 ⇒ 拒（判不出来也只许拒 ✓）
                const n = Math.round(Number(input.value));
                if (!Number.isFinite(n) || n <= 0) return '';
                let elapsed = null;
                try { elapsed = diffDays(FICTION_DATE_START, cur); } catch { elapsed = null; }
                if (elapsed === null || elapsed < n) {
                    return '退不了那么多：再退就早于历法第一天（' + FICTION_DATE_START + '）了';
                }
            }
        } catch { /* 忽略 */ }
        return '';
    };

    // ⚠️ 警告**不许藏**（不可逆）⇒ 明面留这一句，详细理由进上面那个「？」
    const warn = h('div', { class: 'bc-warn', text: '⚠️ 时间轴改了就退不回来' });

    // ★★ 「这段时间该角色的身体」两档（两档两颗，默认那档排最左 ✓）——
    //   它决定**这两颗方向按钮各自算什么**（见「？」里那三条 ✓）
    let bodyExperienced = true;
    const mExperience = h('div', { class: 'bc-chip bc-chip-pick', text: '经历了', title: '这 N 天真的过了：周期、孕周、痕迹都跟着走' });
    const mSkip = h('div', { class: 'bc-chip bc-chip-pick', text: '没经历', title: '只有日历挪过去，该角色的身体一个都没动' });
    const modeNote = h('div', { class: 'bc-hint' });
    const modeRow = h('div', { class: 'bc-chip-list' }, mExperience, mSkip);
    mExperience.onclick = () => { bodyExperienced = true; paint(); };
    mSkip.onclick = () => { bodyExperienced = false; paint(); };

    // ★ 手填的**不设上限**（玩家自己按的，看得见也能退回来）⇒ 输入框也不封顶 ✓
    const input = numberInput(3, () => paint(), { min: 1 });
    const chips = h('div', { class: 'bc-chip-list' });
    for (const n of [1, 3, 7, 30]) {
        chips.appendChild(h('div', {
            class: 'bc-chip bc-chip-pick',
            text: n + ' 天',
            title: '点一下＝把左边的天数改成 ' + n,
            onclick: () => { input.value = String(n); paint(); },
        }));
    }

    const btnFwd = button('往未来补 3 天', () => doShift('fwd'));
    const btnBack = button('往过去退 3 天', () => doShift('back'));

    /**
     * 一处画四样：读数（现在 / 来源 / **两个方向各会到哪天**）、两颗按钮上各写几天、
     * 不能点时的原因。⚠️ 那两个"到哪天"是给眼睛看的：不用自己在脑子里加减 ✓
     */
    function paint() {
        const n = Math.round(Number(input.value));
        const okN = Number.isFinite(n) && n > 0;
        const step = okN ? n : 0;

        let now = '', src = '', fwd = '', back = '';
        try { now = storyDateTimeNow(); } catch { /* 忽略 */ }
        try {
            const m = dateMode();
            src = m === 'story' ? '剧情给的日期' : (m === 'fiction' ? '虚拟日历（从 1年01月01日 起算）' : '还没有定');
        } catch { /* 忽略 */ }
        try {
            const d = now ? now.split(' ')[0] : '';
            if (d && step) {
                fwd = addDays(d, step) || '';
                back = addDays(d, -step) || '';
                // ⚠️ 退到历法第一天之前 ⇒ 那一格不显示（判不出来就不给数，别显示一个假的 ✗）
                let elapsed = null;
                try { elapsed = diffDays(FICTION_DATE_START, d); } catch { elapsed = null; }
                if (elapsed === null || elapsed < step) back = '';
            }
        } catch { /* 忽略 */ }
        readout.textContent = '现在：' + (now || '（还没有日期）') + '　来源：' + src
            + (fwd ? ('　往未来 ' + step + ' 天：' + fwd) : '')
            + (back ? ('　往过去 ' + step + ' 天：' + back + (bodyExperienced ? '（全套往回）' : '（只挪日历）')) : '');

        // ★ 「没经历」那档不是"补"，是"跳"（这 N 天没算在该角色身上）⇒ 按钮上跟着换词 ✓
        btnFwd.textContent = okN ? (bodyExperienced ? ('往未来补 ' + step + ' 天') : ('往未来跳 ' + step + ' 天'))
            : (bodyExperienced ? '往未来补' : '往未来跳');
        btnBack.textContent = okN ? ('往过去退 ' + step + ' 天') : '往过去退';
        // ★★ 「往过去退」按**这一档**做事（只留经历和没经历那一排就够 ✓）：
        //   选了「经历了」⇒ **全套往回**（日期 ＋ 已记日期一起退，周期锚点留着 ⇒ 周期第几天 / 孕周跟着退回来 ✓）
        //   选了「没经历」⇒ 只挪日历（已记日期一起搬 ⇒ 周期第几天不变 ✓）
        btnBack.title = bodyExperienced
            ? '日期和已经记下的日期都往回退，周期第几天 / 孕周跟着回去（已经结算过的账收不回来）'
            : '只挪日历：已经记下的日期一起搬，周期第几天不变';
        mExperience.classList.toggle('bc-chip-on', bodyExperienced);
        mSkip.classList.toggle('bc-chip-on', !bodyExperienced);
        modeNote.textContent = bodyExperienced
            ? '这段算在该角色身上：周期、孕周跟着走，痕迹按天数消，该结算的结算'
            : '这段不算在该角色身上：只有日历挪过去，孕周 / 周期 / 痕迹一个都不变';
        const blockFwd = blockedReason('fwd');
        const blockBack = blockedReason('back');
        const offFwd = !!blockFwd || !okN;
        const offBack = !!blockBack || !okN;
        btnFwd.disabled = offFwd;
        btnFwd.classList.toggle('bc-btn-off', offFwd);
        btnBack.disabled = offBack;
        btnBack.classList.toggle('bc-btn-off', offBack);

        noteFwd.textContent = blockFwd;
        noteFwd.style.display = blockFwd ? '' : 'none';
        noteBack.textContent = blockBack;
        noteBack.style.display = blockBack ? '' : 'none';
    }
    paint();

    function doShift(dir) {
        // ★★ 2026-10-16（按钮点不动那设计它做什么）——
        //   「往过去退」按**档位**做两件不同的事（跟"往未来"那颗一样按档换行为 ✓）：
        //     · 选了「经历了」⇒ 日期和已记日期一起退（`shiftDateBackwardFull`）：周期第几天 / 孕周**跟着变回来** ✓
        //       —— 这正是玩家那件事（插件把同一天的时间快进报成过了一夜、日期多走一天）的解药 ✓
        //     · 选了「没经历」⇒ 照旧 `shiftDateBackward`：连已记的日期一起搬（周期第几天不变 ✓）
        //   ⚠️ 「只退日期」那条路**不搬已记日期、也不结算**（已经落过的账收不回来 ✓）
        const r = dir === 'back'
            ? (bodyExperienced
                ? shiftDateBackwardFull(input.value)   // 「经历了」⇒ 全套往回（周期第几天 / 孕周跟着退 ✓）
                : shiftDateBackward(input.value))      // 「没经历」⇒ 只挪日历（周期第几天不变 ✓）
            : shiftDateForward(input.value, { bodyExperienced });
        if (!r.ok) { window.toastr?.warning?.(r.error); paint(); return; }
        const bits = [];
        // ★ 痕迹锚点跟着日历走：往过去退 / 身体没经历这两条都不衰减痕迹，
        //   但锚点必须挪到新日期，否则下一轮推演会把这段差额补算一遍（痕迹凭空消掉 ✗）
        try { state().tracesDecayedOn = currentDate() || ''; commit(); } catch { /* 忽略 */ }
        if (dir === 'back') {
            bits.push('已往过去退 ' + r.days + ' 天：' + r.from + ' → ' + r.to);
            if (r.moved) bits.push('一起退了 ' + r.moved + ' 处已记日期');
            else bits.push('只退了日期：周期第几天 / 孕周跟着变回来了（已经结算过的账收不回来）');
            try { syncAfterTimeBack(); } catch (e) { console.warn('[Bodycord] 退时间后对齐失败', e); }
        } else if (!bodyExperienced) {
            // ★ 「身体没经历」⇒ 只把日历（和所有已记日期）一起挪过去，**不算账** ✓
            bits.push('已往未来跳 ' + r.days + ' 天：' + r.from + ' → ' + r.to);
            if (r.moved) bits.push('一起搬了 ' + r.moved + ' 处已记日期');
            bits.push('该角色的身体没经历这段：孕周 / 周期 / 痕迹都没动');
        } else {
            bits.push('已往未来补 ' + r.days + ' 天：' + r.from + ' → ' + r.to);
            // ★ 痕迹按 N 夜衰减 —— 补上"补了一千年、吻痕还在"那个缺口 ✓
            //   （口径跟推演那条路一样：夜数 × 恢复体质档倍率 ✓）
            let hitTr = 0;
            try { hitTr = decayTracesForElapsedDays(r.days); } catch (e) { console.warn('[Bodycord] 补时间后衰减痕迹失败', e); }
            // ★ 锚点跟着挪：不然下一轮推演会按"上次消到哪天"再补一遍（补两次 ✗）
            try { state().tracesDecayedOn = currentDate() || ''; commit(); } catch { /* 忽略 */ }
            if (hitTr) bits.push('痕迹按 ' + r.days + ' 夜衰减（' + hitTr + ' 个对象）');
            let res = null;
            try { res = settleAfterTimeShift(); } catch (e) { console.warn('[Bodycord] 补时间后结算失败', e); }
            if (res?.settled?.length) bits.push('结算：' + res.settled.map(x => x.name).join('、'));
            if (res?.judged?.length) bits.push('判定：' + res.judged.map(x => x.name).join('、'));
        }
        paint();
        window.toastr?.success?.(bits.join('；'));
        onChange?.();      // 让别的页 / 面板读数跟着刷
    }

    b.appendChild(readout);
    b.appendChild(warn);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, chips));
    // ★ 「这段时间该角色的身体」两档放在方向按钮**上面**（先选这一段算不算该角色的，再点方向 ✓）
    b.appendChild(h('div', { class: 'bc-hint', text: '这次手填的改动：算在该角色身上吗' }));
    b.appendChild(modeRow);
    b.appendChild(modeNote);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, input, btnFwd));
    b.appendChild(noteFwd);
    b.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, btnBack));
    b.appendChild(noteBack);
    // ★★ 「推演每轮自己报的跳跃」身体那半谁说了算（**聊天级**）——
    //   那应该是有三个档啊？不是应该还有一个让推演自动判断吗？✓
    //   ⇒ **三颗**：让推演判断（默认）／固定成算／固定成不算。
    //   ⚠️ 三档一起摆出来，图表上**永远恰好亮一颗** ⇒ 不再需要那颗「恢复自动判断」✓
    const mJumpAuto = h('div', { class: 'bc-chip bc-chip-pick', text: '让推演判断', title: '每轮都看推演怎么说：这次时间怎么跳的、身体有没有经历' });
    const mJumpOn = h('div', { class: 'bc-chip bc-chip-pick', text: '算身体时间', title: '固定住：真的过了，周期、孕周、痕迹都跟着走' });
    const mJumpOff = h('div', { class: 'bc-chip bc-chip-pick', text: '不算', title: '固定住：只挪日历，孕周 / 周期 / 痕迹都不动' });
    const jumpRow = h('div', { class: 'bc-chip-list' }, mJumpAuto, mJumpOn, mJumpOff);
    const jumpNote = h('div', { class: 'bc-hint' });
    const paintJump = () => {
        const manual = timeJumpSkipsBodyManual();
        const skip = timeJumpSkipsBody();
        mJumpAuto.classList.toggle('bc-chip-on', !manual);
        mJumpOn.classList.toggle('bc-chip-on', manual && !skip);
        mJumpOff.classList.toggle('bc-chip-on', manual && skip);
        jumpNote.textContent = !manual
            ? '现在交给推演判断：它每轮会说这次时间怎么跳的、身体有没有经历'
            : (skip ? '已固定成：不算身体时间（只挪日历，孕周 / 周期 / 痕迹都不动）'
                : '已固定成：算身体时间（周期、孕周、痕迹都跟着走）');
    };
    const pickJump = (mode) => {
        // ⚠️ 它按聊天存 ⇒ 不在聊天里点了没地方落（跟上面那两颗按钮同一条规矩 ✓）
        if (!inRealChat()) { window.toastr?.warning?.('先进入一个聊天，这一格才有地方落'); return; }
        if (mode === 'auto') setTimeJumpSkipsBodyAuto();
        else setTimeJumpSkipsBody(mode === 'skip');
        paintJump();
        onChange?.();
    };
    mJumpAuto.onclick = () => pickJump('auto');
    mJumpOn.onclick = () => pickJump('live');
    mJumpOff.onclick = () => pickJump('skip');
    paintJump();
    b.appendChild(h('div', { class: 'bc-hint', text: '推演每轮自己报的跳跃：身体那半' }));
    b.appendChild(jumpRow);
    b.appendChild(jumpNote);

    // ---- 例外选人（多选角色 ＋ 手输名字 ✓）----
    function openExceptPicker(done) {
        if (!inRealChat()) { window.toastr?.warning?.('先进入一个聊天，这一格才有地方落'); return; }
        const picked = new Set(timeJumpExceptKeys().map(String));
        let typed = '';
        const chips = h('div', { class: 'bc-chip-list' });
        const paintChips = () => {
            clear(chips);
            const list = (() => { try { return targetList(); } catch { return []; } })();
            if (!list.length) { chips.appendChild(h('div', { class: 'bc-hint', text: '这个聊天还没有建档对象' })); return; }
            for (const t of list) {
                const k = String(t.key);
                const on = picked.has(k);
                chips.appendChild(h('div', {
                    class: 'bc-chip bc-chip-pick' + (on ? ' bc-chip-on' : ''),
                    text: displayName(t) || k,
                    onclick: () => { if (picked.has(k)) picked.delete(k); else picked.add(k); paintChips(); },
                }));
            }
        };
        paintChips();
        modal({
            title: '例外：这几个人跟上面那格相反',
            width: 460,
            saveText: '确定',
            build: (body) => {
                body.appendChild(chips);
                body.appendChild(h('div', { class: 'bc-hint', text: '点一下选中 / 取消。选中的这些，身体那一档跟上面那格相反' }));
                body.appendChild(field('也可以手输名字（用「、」或空格隔开）',
                    textInput('', (v) => { typed = v; }, { placeholder: '例：甲、乙 / 丙' })));
            },
            onSave: () => {
                const unknown = [];
                for (const nm of String(typed).split(/[、,，／/|｜\s]+/).map((x) => x.trim()).filter(Boolean)) {
                    let hit = null;
                    try { hit = findTargetByReportedName(nm, { skipUser: true }); } catch { hit = null; }
                    if (hit?.key) picked.add(String(hit.key));
                    else unknown.push(nm);
                }
                setTimeJumpExceptKeys([...picked]);
                if (unknown.length) {
                    window.toastr?.warning?.('这几个名字不在追踪名单里，当不了例外：' + unknown.join('、'));
                }
                done?.();
                return true;
            },
        });
    }

    // ★★ 例外名单（**多选角色 ＋ 能手输名字** ✓）——
    //   语义：名单里的人跟上面那格**相反**（上面选"算"，他们就是"身体没经历" ✓）
    //   为什么要有它：引擎报不出来 / 报错了的时候，玩家得能自己纠正 ✓
    const btnExcept = button('选人…', () => openExceptPicker(() => { paintExcept(); onChange?.(); }));
    const btnExceptClear = button('清空例外', () => {
        if (!inRealChat()) { window.toastr?.warning?.('先进入一个聊天，这一格才有地方落'); return; }
        setTimeJumpExceptKeys([]);
        paintExcept();
        onChange?.();
    });
    const exceptRow = h('div', { class: 'bc-chip-list' }, btnExcept, btnExceptClear);
    const exceptNote = h('div', { class: 'bc-hint' });
    const nameOfExceptKey = (k) => {
        try { const t = targetList().find((x) => String(x.key) === String(k)); return t ? displayName(t) : String(k); } catch { return String(k); }
    };
    const paintExcept = () => {
        const keys = timeJumpExceptKeys();
        exceptNote.textContent = keys.length
            ? ('例外：' + keys.map(nameOfExceptKey).join('、') + '（他们跟上面那格相反）')
            : '现在：名单里的人都按上面那格';
        btnExceptClear.style.display = keys.length ? '' : 'none';
    };
    paintExcept();
    b.appendChild(h('div', { class: 'bc-hint', text: '例外（只对某几个人不一样）' }));
    b.appendChild(exceptRow);
    b.appendChild(exceptNote);
    // （★ 「单轮最多认多少天」原来住在这儿，它是**全局设置** ⇒ 按"卡片标题＝这张卡归谁"搬去了「推演设置」✓）
    // ⚠️ 这一句忘不得（"每个 section 都挂了 container.appendChild(box)"那条守卫断言会抓 ✗）——
    //   忘了挂，卡片根本不会出现在页面上 ✗ ⇒ 新增 section 函数时，最后一句别忘 ✓
    container.appendChild(box);
}

export function renderCalendarTab(container, onRefresh, onRebuild, actions = {}) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    // ★ 页面上**不留簇标题** —— 顶上堆三行字太多：
    //   「时间」（簇标题）＋「时间与日历」（卡片标题，跟侧栏那一项同名）＋「历法预设」（卡内小标题）✗
    //   ⇒ 只剩两张**按内容命名**的卡：「时间怎么算」和「日期怎么写」
    //     （跟别的页一个规矩：卡片叫内容的名字，不叫页的名字 ✓）
    timeSection(container, onChange);
    // ★ 「时间往未来补」—— AI 漏报 / 写歪时间时，玩家自己把天数补回来 ✓
    //   ⚠️ 名字里**不许写「往前」**（会被读成"回到过去" ⇒ 有歧义 ✗）
    shiftDaySection(container, onChange);
    dateStyleSection(container, onChange);
    // ★ 节日表给玩家自己改 ✓
    holidaySection(container, onChange);
    // ★ 整理好的节日 / 年历能带走、能收别人的 ✓
    shareSection(container, onChange);
    // ★ 提醒气泡那一块（自定义提醒词 ＋ 预览按钮）——
    //   气泡本来就是"日程到日子了"的提醒 ⇒ 住在日历这一页最合理 ✓
    bubbleSection(container, onChange, actions);
    // ★ 番茄钟那张卡（多久 / 悬浮球 / 提示音 / 保活）**住这一页** ✓
    //   ⚠️ 别搬去「头像外观」✗（这些讲的都是"时间"的事，不是头像 ⇒ 就该在时间这一页 ✓）
    timerSection(container, onChange);
}

export function renderSettingsTab(container, onRefresh, onRebuild, actions = {}) {
    clear(container);
    // 各区块统一用 onChange(true) 表示「需要重建」，onChange() 表示「刷一下就行」
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    // 显示：
    //   第一张卡自己就叫得出名字，簇标题只留"组与组之间"那些 ✓
    readabilitySection(container, onChange);     // ★ 放最上面：它影响整页的观看 ✓
    appearanceSection(container, onChange, actions);
    // ★ 时间与日历单独分出来，别塞常规里面（那边太长了）✓
    //   ⇒ 历法（时间与日历 ＋ 日期怎么写）已经搬到自己的页签（见 renderCalendarTab）
    // ⚠️⚠️ 图标 / 头像**不在这里** —— 它们有自己的「头像外观」分类 ✓
    //   ⚠️ 这里**不许再挂** `iconSection(container, onChange, { title: '图标' })`：
    //     它没带 `groups` ⇒ 会把**全部 17 个槽位**再画一遍，跟「头像外观」页一模一样的内容重复两页 ✗
    // ★ 那一行分组标题 点名删掉（它下面只有这张卡，自己就是废字 ✓）
    apiSection(container, onChange);
    // ⚠️ 诊断放在**最下面**：它本来就是"排查用"的东西，不该占常规页的头几屏 ✓
    container.appendChild(groupHeading('排查'));
    diagSection(container, onChange, actions);
    // ⚠️ 推演设置 / 推演结果给谁 / 追踪对象 / 数据都不在这里，
    //   它们在「推演与追踪」那个独立页签（见下方 renderJudgeTab）。
}

/**
 * 「推演与追踪」页签。
 *
 * 推演那些单独一个大分类：注入哪些对象、追踪对象、追踪模式和数据都在里面 ✓
 *
 * 归到这里的判断标准：**凡是决定「插件去推演什么、推演出什么状态、这些状态发给谁」的**，
 * 都算这一块 —— 它们是一件事的各个环节，分散在三四个页签里很难找。
 *   · timingSection    总开关与时机（什么时候触发推演）
 *   · whoSection       推演谁（范围 / 自动建档 / 名额）
 *   · feedSection      喂给推演什么（给几层正文、剥哪些标签）
 *   · wiSection        世界书（给推演看）
 *   · cardSection      哪些角色卡完全不推演
 *   · recordSection    记什么（记不记受孕、单轮最多认多少天）
 *   · injectSection    推演结果给谁（注入主 API、保留几条状态栏）
 *   · targetSection    追踪谁（模式 / 名单）
 *   · dataSection      数据（导出 / 清空 / 档案中的状态数据）
 */
/**
 * ⚧ 角色基础信息（**用户本人那一份**）—— 设置里的入口。
 *
 *   ① 这里讲的其实是角色基础信息里 {{user}} 的，要在设置里给个位置 ✓
 *   ② 推演与追踪不适合放角色基础信息 ⇒ 把它单独开一页 ✓
 *   ⇒ 它**自己占一个页签**（`basicInfo`），**不塞在「推演与追踪」里** ✓
 *
 * ⚠️ 为什么单独拎出来说：**{{user}} 的那一份是【全局】的**（用户角色那里一定是要全局的、
 *   用户角色别删、存全局 ✓）——
 *   其他人是"这个故事里的角色"，跟着聊天走；而"你自己"穿过所有聊天 ✓。
 */
export function renderBasicInfoTab(container, onRefresh, onRebuild) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    userBodyInfoSection(container, onChange);
}

/**
 * ★ 人设版本（在「角色基础信息 · 你自己」那一页最上面）
 *
 * 用户人设除了可以导入导出之外，还能在全局里面随时切换存的版本 ✓
 *   ⇒ 落地：
 *     · 下拉 = 列出**对象是你自己**的那些人物档案，选一套就一键套上 ✓
 *     · 「存成新版本」= 存一份人物档案（对象自动填「你自己」）✓
 *     · 导出 / 删除 = 跟人物档案同一套操作 ✓
 *   ⚠️ 为什么复用人物档案、不新造一套"版本"存储：
 *      两套存储迟早会出现"明明存了、这儿却没有" ✗ ⇒ 复用人物档案 ✓
 *
 * ⚠️ 「当前用哪套」记的是**上次套上的那一套**（落在 settings().ui.userPersonaArchive）——
 *   套完之后再手改数值，下拉不会跟着变（那不是错，是"上次套的是它" ✓）
 */
function personaVersionRow(b, onChange) {
    // ★ 2026-10-18：不再用「小节标题」那一行（会跟卡片标题一起变成"俩抬头" ✗）——
    //   改成普通的一格：标签 ＋ 右边的「？」＋ 下面一排控件 ✓
    const wrap = h('div', { class: 'bc-field' });
    wrap.appendChild(h('div', { class: 'bc-label-row' },
        h('div', { class: 'bc-label', text: '人设版本' }),
        h('div', { class: 'bc-spacer' }),
        helpButton('人设版本', [
            `这一份就是「${userLabel()}」的人物档案（下面的基础信息 / 补丁 / 别名、标签与备注一起存）`,
            '同一个人设想存好几套就存成几个版本，在这里选一下一键切',
            '它跟着插件设置走，穿过所有聊天',
        ]),
    ));

    const versions = listPersonArchives().filter((a) => a?.data?.isUser);
    const applied = String(settings().ui?.userPersonaArchive || '');
    const curId = versions.some((a) => a.id === applied) ? applied : (versions[0]?.id || '');

    const row = h('div', { class: 'bc-row bc-row-wrap' });

    if (versions.length) {
        const opts = versions.map((a) => [a.id, archiveLabel(a)]);
        row.appendChild(select(curId, opts, async (v) => {
            const a = versions.find((x) => x.id === v);
            if (!a) return;
            const ok = await applyPersonArchiveInteractive(a, USER_KEY, {
                title: `把「${userLabel()}」换成「${archiveLabel(a)}」`,
                hint: '这份人设档案里装了下面这些内容，默认全勾；不想动哪一块就取消它。没勾的块一个字都不会碰',
            });
            if (!ok) return;
            settings().ui.userPersonaArchive = a.id;
            save();
            window.toastr?.success?.(`「${userLabel()}」已换成「${archiveLabel(a)}」`);
            try { onChange?.(true); } catch { /* 忽略 */ }
        }));
        row.appendChild(button('📤 导出这一套', () => {
            downloadArchive([curId]);
            window.toastr?.success?.('已导出');
        }));
        row.appendChild(button('🗑 删除这一套', async () => {
            const a = versions.find((x) => x.id === curId);
            if (!a) return;
            if (!(await askConfirm(`确定删掉人设版本「${archiveLabel(a)}」？删了就没了，建议先导出`))) return;
            deleteArchive(curId);
            settings().ui.userPersonaArchive = '';
            save();
            window.toastr?.success?.('已删除');
            try { onChange?.(true); } catch { /* 忽略 */ }
        }, { variant: 'danger' }));
    } else {
        row.appendChild(h('span', { class: 'bc-hint', text: '还没有人设版本' }));
    }

    row.appendChild(button('📦 存成新版本', async () => {
        // ★ 默认名字用**当前人设名**（显示成"你自己"不对，要替换成当前使用角色的名字 ✓）
        const r0 = await askArchiveName(
            `把「${userLabel()}」存成一个人设版本`, userLabel(), '',
            '会把你自己现在「动过的」那几块（基础信息 / 补丁 / 别名、标签与备注）一起存下来。没动过的块不装');
        if (!r0) return;
        const r = savePersonArchive(USER_KEY, r0.name, r0.note);
        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
        settings().ui.userPersonaArchive = r.id;
        save();
        window.toastr?.success?.(`已存为「${archiveLabel(getArchive(r.id) || r0)}」`);
        try { onChange?.(true); } catch { /* 忽略 */ }
    }, { variant: 'primary' }));

    wrap.appendChild(row);
    b.appendChild(wrap);
}

/**
 * ★ 角色基础信息那四格 —— **一份实现，三处共用** ✓
 *   （设置页「你自己」／悬浮球菜单那个弹窗／补丁页 · 人物视图）
 *
 * ★ **这些面板在规则补丁那里也要有一份，因为角色基础信息只是用户角色用的** ✓
 *   ⇒ 抽出来共用（同一份清单共用来源，别三处各写一遍 ✗）
 * @param {HTMLElement} host 渲染到哪儿
 * @param {string} key 哪个对象（USER_KEY ⇒ 读全局设置；其他 ⇒ 本聊天档案 ✓）
 * @param {{onChange?: (structural?: boolean) => void}} opts
 *   `onChange(true)` = 需要**整页重建**；只有「能不能怀孕」会用到
 *   （它决定「能不能怀上异种」那一格生不生效 ⇒ 不重建就得等下次进这页才看得见 ✗）
 */
export function bodyLockRows(host, key, opts = {}) {
    const notify = opts.onChange || (() => {});
    // ⚠️ 这里的数据不是实时刷新、要切换才能看见它刷新 ✗ ⇒ 有变化之后就刷 ✓
    //   这一块里任何一处改动，都顺手把下面那行读数与警告**当场重画** ✓
    //   （读数还没建好时（render 早期）调用会被 try 挡掉，不会炸 ✓）
    const onChange = (structural) => { notify(structural); try { paintRace(); } catch { /* 还没建好 */ } };
    // ★ 补丁页 · 人物视图那份卡**默认不画**「属于哪个大类」和「这个角色的种族」——
    //   下面的「身体补丁（生理设定）」参数面板里那两格都有（而且种族就在大类上面，放一起更顺）✓
    //   同一份数据、别处照样能改 ✓
    //   ⚠️ 只在"下面那份真的画得出来"时才藏（判据在调用方 `personBasicInfoCard`）：
    //     无月经那档 body_base 整条不画、正文被冻结时卡里只有一条提示 ⇒ 那时**必须留着**，
    //     不然这两格在界面上就彻底找不到了 ✗（本项目老规矩：藏起来 = 等于不存在 ✓）
    const withParamDup = opts.hideParamDup !== true;
    const opts3 = [['', '未填（按推演每轮判断）'], ['true', '能'], ['false', '不能']];
    const yesOpts = [['', '未填（按推演每轮判断）'], ['true', '是'], ['false', '不是']];

    // ★ 徽章的措辞要跟那一行的问题对得上（"是不是异种"那行显示成"锁定：能/不能"就不对 ✗）
    //   ⇒ 每行自己带一对词，别一律用"能/不能" ✓
    //
    // ★★ 不能做成**每格三行** ——
    //   标签 / 下拉 / 再一行「徽章 + 恢复自动」⇒ 四格白占四行，而且未填时那一行纯属白占
    //   （徽章写「未填」跟下拉里那句重复，「恢复自动」也没东西可恢复 ✗）。
    //   ⇒ ① 徽章上到**标签那一行**；② 「恢复自动」挪到**下拉那一行**的右边，
    //   而且**只在锁定时才出现** ⇒ 每格固定两行，一个字都没藏 ✓
    const row = (label, field, options, words = ['能', '不能']) => {
        // ★ 未填时**不只写「未填」** —— 把推演这一轮判的值印出来 ✓
        //   要的正是这个（人设里面明明写着不能怀孕，那就肯定得判 ——
        //   总不能人家不能怀孕却判了能怀孕）⇒ 徽章要能看出"现在是按推演判的哪一边" ✓
        const ai = reportedBodyFlagOf(key, field);
        const wordOf = (v) => (v === null
            ? (ai === null ? '未填' : '推演判：' + (ai ? words[0] : words[1]))
            : '锁定：' + (v ? words[0] : words[1]));
        const lock = bodyLockOf(key);
        // ★ 不能怀孕 ⇒「能不能怀上异种」这一格**不生效**（变灰 + 一行小字）——
        //   ⚠️ 只改**显示**：数据一个字都不动（红线：改一个格子别顺手动另一个 ✗）
        const moot = (field === 'canBearXeno') && lock.canBePregnant === false;
        // 徽章要先建出来，好让下面的下拉能**当场**改它
        const tag = h('span', {
            class: 'bc-badge bc-lock-tag' + (lock[field] !== null ? ' on' : ''),
            text: wordOf(lock[field]),
        });
        // ⚠️ 要切换一下别的选项才显示锁定 ✗ ⇒ 数据显示是立刻的，问题在显示层
        //   ⇒ 选完**当场**把徽章与「恢复自动」一起改掉 ✓（本项目规矩：改了状态的控件必须当场可见 ✓）
        const paintTag = (v) => {
            tag.textContent = wordOf(v);
            tag.classList.toggle('on', v !== null);
            restore.style.display = v === null ? 'none' : '';
        };
        const restore = button('↩ 恢复自动', () => {
            setBodyLockField(key, field, null);
            paintTag(null);
            onChange(field === 'canBePregnant');
        });
        const dd = select(lock[field] === null ? '' : String(lock[field]), options, (v) => {
            const val = v === '' ? null : (v === 'true');
            setBodyLockField(key, field, val);
            paintTag(val);                       // ★ 当场同步视觉 ✓
            onChange(field === 'canBePregnant'); // 只有它要整页重建 ✓
        }, moot ? { disabled: true, title: '这个人不能怀孕，这一格不生效' } : {});
        const box2 = h('div', { class: 'bc-field' },
            h('div', { class: 'bc-label-row' },
                h('div', { class: 'bc-label', text: label }),
                tag,
            ),
            // ⚠️ 下拉要包一层 `.bc-dd-host`：它自己 `width:100%`，直接当 flex 子项会不被压缩 ✓
            h('div', { class: 'bc-row' }, h('div', { class: 'bc-dd-host' }, dd), restore),
        );
        if (moot) box2.appendChild(h('div', { class: 'bc-hint', text: '这个人不能怀孕，这一格不生效' }));
        paintTag(lock[field]);      // 未填 ⇒ 把「恢复自动」藏起来 ✓
        host.appendChild(box2);
    };

    row('能不能怀孕', 'canBePregnant', opts3);
    row('能不能让别人怀孕', 'canImpregnate', opts3);
    // 第四项：能不能跟非人类生 ✓
    row('能不能怀上异种', 'canBearXeno', opts3);
    row('是不是异种', 'isXeno', yesOpts, ['是', '不是']);
    // ★ 人外还要能选「属于哪个大类」（留一个「按推演每轮判」✓）
    if (withParamDup) host.appendChild(xenoClassField(key, onChange));
    // ★ 基础种族要能自定义名字 ⇒
    //   这一页也带上「这个角色的种族」（自由输入 ＋ 「选…」），和参数面板同一份数据 ✓
    if (withParamDup) host.appendChild(raceNameField(key, onChange));
    // ★ 读数和警告**摆在「这个角色的种族」那格下面**（讲的就是它 ✓）——
    //   读数说清真身是哪来的：你改过的 ⇒ 你定的；推演判的 ⇒ 带依据；只有出厂那份 ⇒ 按设定；
    //   真什么都没有 ⇒ 还没填；判不准 / 跟大类对不上 ⇒ 补一句 ⚠️ 黄字 ✓
    //   ⚠️ 读数 ＋ 警告要**当场重画**（"要切换才看得见刷新" ✗）
    //   ⚠️ 这一格只进判定层：描写层对谁公开是主 API 的事，插件不碰 ✓
    const raceLine = h('div', { class: 'bc-param-sub', text: '' });
    const raceWarn = h('div', { class: 'bc-warn', text: '' });
    const paintRace = () => {
        const rj = raceJudgeOf(key);
        if (rj.src === '玩家') raceLine.textContent = `真实种族：${rj.race || '（还没填）'} · 你定的`;
        else if (rj.asked) raceLine.textContent = `种族：${rj.asked} · 推演判（依据：${rj.src === '存疑' ? '待确认' : rj.src}）`;
        else if (rj.race) raceLine.textContent = `种族：${rj.race} · 按设定`;
        else raceLine.textContent = '种族：还没填';
        const cls = String(xenoClassOf(key) || '');
        const byClass = cls ? (cls !== '人类') : null;
        const rep = reportedBodyFlagOf(key, 'isXeno');
        const clash = (byClass !== null && rep !== null && byClass !== rep);
        const raceSaysXeno = !!(rj.race && !/人/.test(rj.race));
        const clashRace = (byClass === false && raceSaysXeno);
        let warn = '';
        if (clashRace) warn = `⚠️ 「属于哪个大类」选的是人类，种族却写着「${rj.race}」，确认一下`;
        else if (clash) warn = '⚠️ 和上面选的「属于哪个大类」对不上，确认一下';
        else if (rj.src === '存疑') warn = '⚠️ 种族待确认：会影响异种规则与孕期，确认一下这格';
        raceWarn.textContent = warn;
        raceWarn.style.display = warn ? '' : 'none';
    };
    // ★ 2026-10-18（种族那行和下面：别名、标签与备注贴太近）——
    //   这两块之间原来没有任何间隔（读数自己的 margin-top 只管它和上面）
    //   ⇒ 包一层统一的底距：警告有没有显示都留出这段，别因为 raceWarn 隐藏就贴住 ✓
    const raceBlock = h('div', { style: { marginBottom: '12px' } }, raceLine, raceWarn);
    host.appendChild(raceBlock);
    paintRace();
}

/**
 * ★ 「属于哪个大类」那一格：
 *   选人外的时候要填种族，还要有一个**选属于哪个大类**的选项 ✓
 *
 * **一份实现两处用**：角色基础信息（三处入口都会带出来 ✓）＋ 身体补丁的参数面板 ✓
 * ⚠️ 选项表只有一份（`modules.js` 的 `XENO_CLASSES`，照抄表里第一列 ✓，
 *   ＋ 它前面那项「人类」= `XENO_CLASS_HUMAN` ✓），
 *   并有断言钉住"每一项都能在 [异种扩展包 · 西方与通用] 正文里找到" ✓
 * ⚠️ 第一项是「未选（按推演每轮判）」—— 这个选项要保留 ✓
 *   （「人类」紧跟它，是**所有具体种族里的第一项** ✓ —— "最前面"指的就是这个位置 ✓）
 * ⚠️ 故意**不做**"不是异种就变灰"这类联动（只要"留一个 AI 自判的选项" ✗）
 */
export function xenoClassField(key, onChange = () => {}) {
    const box = h('div', { class: 'bc-field' },
        h('div', { class: 'bc-label', text: '属于哪个大类' }));
    // ★ 把下拉表换成面板（可以搜索之类的那种）✓
    //   ⇒ 这一格不再是一个 30 多项的下拉，改成"读数 + 一颗选择按钮"，点开是带搜索的面板 ✓
    const cur = h('span', { class: 'bc-param-status' });
    const paint = () => { cur.textContent = xenoClassOf(key) || '未选（按推演每轮判）'; };
    paint();
    // ⚠️ **属于哪个大类这个板块的 UI 要和别的对齐** ✗ ——
    //   那一页别的格都是"整行一个框 ＋ 右边一颗按钮"，只有这一格是**裸文字** ⇒
    //   读数套上同一个框（`.bc-readout-box`，只读），按钮挪到框右边，和「这个角色的种族」那一格
    //   一模一样 ✓；标签也统一成「选…」（两边不能写两套 ✗）
    box.appendChild(h('div', { class: 'bc-row' },
        h('div', { class: 'bc-dd-host' }, h('div', { class: 'bc-readout-box' }, cur)),
        // ⚠️ 选择框离左边太远的话，第一眼看不见在哪里选择 ✗
        //   ⇒ 值框占满整行、按钮紧贴它右边（不是拿 spacer 推到整行最右的空位 ✓）
        button('选…', () => openXenoClassPicker(key, (v) => {
            setXenoClassOf(key, v);
            paint();
            try { onChange(false); } catch { /* 忽略 */ }
        })),
    ));
    // ★ 外面太光秃秃了容易摸不到头脑 —— 而且这一格的信息
    //   不该需要主动去看，应该**被动显示** ✓
    //   ⇒ 这一格自带一句**被动**提示（属于"单个控件下面 ≤35 字的后果"那一档 ✓）
    //   ⚠️ 用 `.bc-param-sub`、**不许用 `.bc-hint`** —— 参数面板页面上 `.bc-hint` 必须为 0
    //     （那条守卫是"说明一律搬进「？」"留下的，两件事别搅在一起 ✓）
    box.appendChild(h('div', {
        class: 'bc-param-sub',
        text: '点「选…」可以看详细分类，不填就由推演每轮自己判',
    }));
    return box;
}

/**
 * 「属于哪个大类」的选择面板（用面板，不用下拉 ✓）
 *   结构：
 *   第一层 = 本函数：「未选」「人类」直接列出来（点一下就选好）；
 *            「西方与通用」「东方」是**两颗大按键**，点开才进第二层的方块列表 ✓
 *   为什么这么分：因为太长了、拖拽起来很麻烦，万一日后又要加的话需要拖很久，
 *     虽然点击三次有点麻烦，但算是取舍 ✓
 *   第二层 = openXenoClassList()：带搜索的列表，点一行就选好，**两层一起关** ✓
 * ⚠️ 选中的那一项要标出来（`.on` 高亮 + 圈填色）；右侧那行读数（「15 项」）只是"这一组有多少"✓
 */
function openXenoClassPicker(key, pick) {
    const west = XENO_CLASSES.filter(c => !XENO_CLASSES_EAST.includes(c));
    const curVal = xenoClassOf(key);

    modal({
        title: '属于哪个大类',
        width: 520,
        help: [
            '这一格是提前告诉推演"这个对象属于哪一类"，免得 AI 每轮自己猜',
            '「人类」= 走人类默认规则；选具体大类 = 按对应那张种族表里那一行判',
            '拿不准就选最上面的「未选」，推演每轮自己判',
            '亚人（只有耳 / 尾 / 翼这类少量非人特征、其余都是人形的那种）选「类人」：胎数与性别跟人类一样，孕期按「类人·其他」算，约 9-10 个月 ✓',
            '「西方与通用」「东方」里面还有一层：点开才看到具体大类，点一行就选好了',
        ],
        build: (body, close) => {
            // 一行：左边是名字，右边那点小字是"这一组有多少"（不是后缀 ✓）
            const big = (label, right, isCur, onclick) => h('div', {
                class: 'bc-preset-entry bc-xeno-row' + (isCur ? ' on' : ''),
                onclick,
            },
                h('div', { class: 'bc-preset-entry-main' },
                    h('div', { class: 'bc-preset-entry-name' }, h('span', { text: label }))),
                right ? h('span', { class: 'bc-param-status', text: right }) : null,
            );
            const done = (v) => { pick(v); try { close(); } catch { /* 忽略 */ } };

            // ⚠️ 这句提示要**在这个弹窗里**，不能只加在外面那一格上 ✗
            //   （不用去点右上角的「？」✓，这就是"应该被动显示"那条规矩 ✓）
            body.appendChild(h('div', { class: 'bc-hint', text: '选好之后，推演就按这一类判它' }));
            body.appendChild(h('div', { class: 'bc-hint', text: '「人类」走默认规则；两张表里的大类，按「异种扩展包（西方与通用）」或「异种扩展包（东方）」里对应那一行判' }));
            // ★ 亚人：只有耳 / 尾 / 翼这类少量非人特征、其余人形的，
            //   归到「类人」就行 —— 不新开大类（"亚人"是伞词，狼人/精灵/半妖都能这么叫，
            //   繁殖参数却完全不同 ⇒ 塞进一行会算错 ✓）。这句要**被动显示在这儿**（不用点「？」✓）
            body.appendChild(h('div', { class: 'bc-hint bc-hint-gap', text: '只有耳朵 / 尾巴 / 翅膀这类少量非人特征、其余都是人形的那种，选「类人」就行' }));
            body.appendChild(big('未选（按推演每轮判）', '', !curVal, () => done('')));
            body.appendChild(big(XENO_CLASS_HUMAN, '走默认规则', curVal === XENO_CLASS_HUMAN,
                () => done(XENO_CLASS_HUMAN)));
            body.appendChild(big('西方与通用', west.length + ' 项', west.includes(curVal),
                () => openXenoClassList('西方与通用', west, curVal, done)));
            body.appendChild(big('东方', XENO_CLASSES_EAST.length + ' 项', XENO_CLASSES_EAST.includes(curVal),
                () => openXenoClassList('东方', XENO_CLASSES_EAST, curVal, done)));
        },
    });
}

/**
 * 第二层：一组大类的列表（带搜索）。
 * @param {(v:string)=>void} onPick 选好之后干什么（调用方负责**把外面那层也关掉** ✓）
 */
function openXenoClassList(title, items, curVal, onPick) {
    modal({
        title: title + ' · 属于哪个大类',
        width: 520,
        // ⚠️ 这一层（点大按键之后那份列表）也得有说明，不能只有第一层有「？」✗
        //   （项目老规矩：界面上的说明一律走「？」弹窗，别往页面上铺解释性长句 ✓）
        help: [
            '这里列的是大类，照抄「异种扩展包（' + title + '）」那张表的第一列（是表的分类，不是具体种族名）',
            '点一行就是选好了，两层一起关',
            '左边那个圈填色 + 整行变亮 = 现在选的是它',
            '列表里没有你要的：回上一层选「未选」，推演每轮会自己判',
        ],
        build: (body, close) => {
            let q = '';
            const listHost = h('div', { class: 'bc-preset-entries' });
            // ⚠️ 两层问题：选项没提示不知道点哪里 ＋ 就是没边框 ✗
            //   ⇒ ① 每行加**边框**（一眼看出是条目）② 左边画一个**单选圈** ✓
            //   ⚠️ 圈**自己画**，不用裸 `<input type=radio>` —— 酒馆主题把那玩意儿的
            //     appearance 清掉了 ⇒ 看着什么都没有（"没边框"就是这个 ✗）
            const row = (c) => h('div', {
                class: 'bc-preset-entry bc-xeno-row' + (curVal === c ? ' on' : ''),
                onclick: () => { onPick(c); try { close(); } catch { /* 忽略 */ } },
            },
                h('span', { class: 'bc-xeno-dot' + (curVal === c ? ' on' : '') }),
                h('div', { class: 'bc-preset-entry-main' },
                    h('div', { class: 'bc-preset-entry-name' }, h('span', { text: c }))),
            );
            const draw = () => {
                clear(listHost);
                const kw = q.trim().toLowerCase();
                const hit = items.filter(c => !kw || c.toLowerCase().includes(kw));
                for (const c of hit) listHost.appendChild(row(c));
                if (!hit.length) listHost.appendChild(h('div', { class: 'bc-hint', text: '没有匹配的大类' }));
            };
            // ★ 读数：进来先写清"现在选的是哪个"（没有它，未选的时候整页看不出状态 ✓）
            body.appendChild(h('div', { class: 'bc-hint' },
                h('span', { text: '现在选的是：' }),
                h('span', { class: 'bc-param-status', text: curVal || '未选（按推演每轮判）' })));
            body.appendChild(textInput('', (v) => { q = v; draw(); }, { placeholder: '搜索大类（例：龙、妖、精灵、山海经）…' }));
            body.appendChild(listHost);
            draw();
        },
    });
}

/**
 * ★ 两件事：基础种族要能自定义名字 ＋ 身体补丁（生理设定）也要能选种族列表 ✓
 *   ⇒ 一处补齐：**自由输入照旧**（自定义一个字都不受限）＋ 一颗「选…」打开**常见种族名**列表。
 *   列表只是候选（`modules.js` 的 RACE_NAME_SUGGESTIONS），点一行填进输入框，填完照样能改 ✓
 * ⚠️ 它和「属于哪个大类」是两格、两个概念：这里是**这个对象叫什么种族**，
 *   大类是**推演拿它对异种表哪一行** ✓ 别混
 */
export function openRaceNamePicker(cur, onPick) {
    modal({
        title: '选一个种族名',
        width: 520,
        help: [
            '这里只是常见种族名的候选，点一行就填进输入框，填完照样能自己改',
        ],
        build: (body, close) => {
            body.appendChild(h('div', { class: 'bc-hint', text: '点一行就填进去；列表里没有就直接打字' }));
            let q = '';
            const listHost = h('div', { class: 'bc-preset-entries' });
            const row = (c) => h('div', {
                class: 'bc-preset-entry' + (cur === c ? ' on' : ''),
                onclick: () => { onPick(c); try { close(); } catch { /* 忽略 */ } },
            },
                h('div', { class: 'bc-preset-entry-main' },
                    h('div', { class: 'bc-preset-entry-name' }, h('span', { text: c }))),
            );
            const draw = () => {
                clear(listHost);
                const kw = q.trim().toLowerCase();
                const hit = RACE_NAME_SUGGESTIONS.filter(c => !kw || c.toLowerCase().includes(kw));
                for (const c of hit) listHost.appendChild(row(c));
                if (!hit.length) listHost.appendChild(h('div', { class: 'bc-hint', text: '没有匹配的种族名' }));
            };
            body.appendChild(textInput('', (v) => { q = v; draw(); }, { placeholder: '搜索种族（例：龙、妖、精灵、兽人）…' }));
            body.appendChild(listHost);
            draw();
        },
    });
}

/**
 * 「这个角色的种族」那一格：一个输入框 ＋ 一颗「选…」✓
 * 读写走 `params.js` 的 body_base spec（锚点 `种族：X` 只写一处，别在这儿再抄一份 ✗）。
 */
export function raceNameField(key, onChange = () => {}) {
    const spec = PARAM_SPECS.find(s => s.moduleId === 'body_base');
    const readOne = () => {
        if (!spec) return '';
        try { return String((readParams(spec, key) || {}).raceName || ''); } catch { return ''; }
    };
    const writeOne = (v) => {
        if (!spec) return;
        try { writeParams(spec, key, { raceName: v }); } catch { /* 忽略 */ }
        // ★ 动过这格就打个标记 —— 这样"你选了人类"才不会被当成"你没改过" ✗
        try { setRaceManualOf(key, true); } catch { /* 忽略 */ }
        try { onChange(false); } catch { /* 忽略 */ }
    };
    const box = h('div', { class: 'bc-field' },
        h('div', { class: 'bc-label', text: '这个角色的种族' }));
    const inp = textInput(readOne(), (v) => writeOne(v), { placeholder: '例：精灵 / 龙族 / 九尾狐…（自己打也行）' });
    box.appendChild(h('div', { class: 'bc-row' },
        h('div', { class: 'bc-dd-host' }, inp),
        button('选…', () => openRaceNamePicker(inp.value, (v) => { inp.value = v; writeOne(v); })),
    ));
    // ★ 被动提示（应该被动显示 ✓）
    box.appendChild(h('div', {
        class: 'bc-param-sub',
        text: '填什么名字都行；点「选…」可以从常见种族里挑一个',
    }));
    return box;
}

/**
 * ★ 别名与备注两格 —— 同上，一份实现三处共用 ✓
 *
 * ★★ 两格合成**一条可折叠的行**（默认收起）。
 *   折叠起来容易错过的顾虑 ⇒ 折叠条右边**带状态字**
 *   （「还没填」/「已填：别名 + 备注」），不展开也一眼看得出填没填 ✓
 *   （对齐项目规矩：这一格填了没**不许**靠"看着像填好了"来表达 ✗）
 *   形态照 `section(collapsible)` 那一套（`.bc-sec-toggle` + 箭头 + `.collapsed` ✓），
 *   标题也是它自己出的 ⇒ 三处调用点**不要再各写一个「别名与备注」小标题** ✗
 */
export function identRows(host, key, opts = {}) {
    const onChange = opts.onChange || (() => {});
    const idn = identOf(key);
    const cur = { aliases: String(idn.aliases || ''), note: String(idn.note || ''), tags: String(idn.tags || '') };

    const stateText = h('span', { class: 'bc-ident-state' });
    const caret = h('span', { class: 'bc-sec-caret' });
    const body = h('div', { class: 'bc-ident-body' });
    const head = h('div', { class: 'bc-section-title bc-sec-toggle', title: '点击展开 / 收起' },
        caret, h('span', { text: '别名、标签与备注' }),
        h('div', { class: 'bc-spacer' }),
        stateText,
    );

    // 状态字：不展开也知道填没填 ✓（两个都空 = 还没填）
    const paintState = () => {
        const filled = [];
        if (cur.aliases.trim()) filled.push('别名');
        if (cur.tags.trim()) filled.push('标签');
        if (cur.note.trim()) filled.push('备注');
        stateText.textContent = filled.length ? '已填：' + filled.join(' + ') : '还没填';
    };

    body.appendChild(field('别名（还认哪些叫法）',
        textInput(cur.aliases, (v) => {
            cur.aliases = v; paintState();
            setIdentField(key, 'aliases', v); onChange(false);
        }, { placeholder: '例：阿杰 / 杰哥 / 小杰' })));
    // ★★ 标签：**没有预设清单**（现造、随用随长 ✓）
    //   ① 引擎也会报（它知道剧情：这个人属于哪一篇 / 是哪一版 ✓）
    //   ② 你手打过就以你为准，引擎不再覆盖 ✓
    //   ③ 只挂在这一个人身上的标签，**还能当别名用** ✓
    body.appendChild(field('标签（分类用；只挂在这一个人身上的还能当别名）',
        textInput(cur.tags, (v) => {
            cur.tags = v; paintState();
            setIdentField(key, 'tags', v); onChange(false);
        }, { placeholder: '例：未来篇、十年后（用「、」或空格隔开）' })));
    body.appendChild(field('备注（只给你自己看）',
        textInput(cur.note, (v) => {
            cur.note = v; paintState();
            setIdentField(key, 'note', v); onChange(false);
        }, { placeholder: '例：一班的那个' })));

    // 默认收起（项目规矩：别让东西默认展开占地方 ✓）
    let open = false;
    const sync = () => {
        body.classList.toggle('collapsed', !open);
        caret.textContent = open ? '▾' : '▸';
    };
    head.addEventListener('click', () => { open = !open; sync(); });

    paintState();
    sync();
    host.appendChild(head);
    host.appendChild(body);
}

function userBodyInfoSection(container, onChange) {
    // ★ 每行底下不压小灰字（四项 + 周期模式 + 两句人设版本的说明太多）
    //   ⇒ 全部搬进标题右边那个「？」✓
    const box = section('⚧ 用户角色基础信息', {
        help: [
            '这四项是「插件自己不可能知道、只能由你告诉它」的事。留空就一直按推演每轮报的走',
            '能不能怀孕：填「不能」⇒ 插件不再给该角色算受精 / 周期那几套',
            '能不能让别人怀孕：填「不能」⇒ 你不会被算进「致孕方候选」',
            '能不能怀上异种：填「不能」就不会怀上异种',
            '是不是异种：填「是」就从第一轮起按异种那套规则判，不用等推演报回来',
            '周期模式：你自己有没有月经。只改名字与描写（排卵日 ↔ 受孕高峰日 这类），受孕率、判定、结算两档完全一样',
            '别名：推演报的名字只要在这里出现过，就会对回这一份档；多个用 / 、或空格隔开（同名两个角色各自填不同别名，就不会互相串）',
            '标签：分类用，比如「未来篇」「十年后」。它没有内置词表，推演看到剧情怎么写就报什么，你手填过就以你为准；只挂在一个对象身上的标签还能当别名用',
            '备注：纯说明，不参与匹配，用来提醒自己这是哪个同名的人',
            // ★ 补一句"不会因为切换人设跟着变化" ✓
            //   （取舍：**不按人设自动存**，几百个人设会爆数据 ⇒ 靠玩家自己存档 ✓）
            '换人设（在酒馆里换 persona）不会换这里的内容：这几样跟着插件走，不跟人设走',
            '想按人设分开：把这一套存成「人物档案」，切完人设再从那套档案套回来（套的时候能逐块勾选）',
            '会进「人物档案」的是这几样：这四项 + 别名、标签与备注 + 敏感带初始设定 + 周期模式档',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    // ★ 2026-10-18：人设版本放**卡片最上面**（先选版本再编辑，切换/保存都在同一排，
    //   不用先滚到底）。它不再单独占一行小标题，只当普通的一格 ✓
    personaVersionRow(b, onChange);

    b.appendChild(h('div', { class: 'bc-warn' },
        h('div', { text: '⚠️ 这几项是全局的，所有聊天共用' }),
        h('div', { class: 'bc-hint', text: '所有聊天共用这一份，换聊天、删聊天都不会丢' }),
        // ★ 明面留**最短的那句后果**，细节进上面那个「？」✓
        h('div', { class: 'bc-hint', text: '换人设不会跟着变，要跟着换就自己存一份档案' }),
    ));

    // ★ 这四格**抽成共用实现**（设置页 / 悬浮球弹窗 / 补丁页·人物视图 三处共用 ✓）
    //   —— 这些面板在规则补丁那里也要有一份，因为角色基础信息只是用户角色用的 ✓
    bodyLockRows(b, USER_KEY, { onChange: (st) => { try { onChange?.(st); } catch { /* 忽略 */ } } });

    // ★ 2026-10-24：察觉档位（玩家自己那份，存全局；留空＝交给 AI 判一次）
    {
        const curTier = (() => { try { return awarenessTierIdOf(USER_KEY); } catch { return ''; } })();
        const tierOpts = [
            ['', '自动（交给 AI 判）'],
            ['A', '极早（A）'],
            ['B', '较早（B）'],
            ['C', '普通（C）'],
            ['D', '较晚（D）'],
            ['E', '极晚（E）'],
            ['F', '几乎到生产（F）'],
        ];
        b.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-label', text: '察觉档位' }),
            dropdown(curTier, tierOpts, (v) => {
                try { setAwarenessTierIdOf(USER_KEY, v, { manual: true }); } catch { /* 忽略 */ }
                try { onRefresh?.(); } catch { /* 忽略 */ }
            }),
        ));
        b.appendChild(h('div', {
            class: 'bc-hint',
            text: '决定你自己大概什么时候开始起疑；留空＝由推演按角色设定判一次。选了就锁定，AI 不再改；它只做参考，确认仍要看剧情事件',
        }));
    }

    // ★ 周期模式（有月经 / 无月经）—— **按人**（一个世界观里两套要能并存 ✓）
    //   规则只有一份（术语走 @@ 占位符、插件替换 ✓），这里存的是"你自己属于哪一档" ✓
    //   ⚠️ 只改名字与描写；受孕率、判定、结算两档完全一样 ✓
    {
        // ★ 档位名统一走 `cycleModeLabel`（三档，三个页面共一份 ✓）——
        //   和「阶段插图」那页里那两档的叫法一致（那边走 periodTierName ✓）
        const globalDefault = cycleModeLabel();
        const explicit = String(settings().userCycleMode || '');
        const modeOpts = [
            ['', `跟随默认（${globalDefault}）`],
            ['normal', '月经'],
            ['none', '非月经'],
            ['amenorrhea', '无月经'],
        ];
        const b2 = h('div', { class: 'bc-field' },
            h('div', { class: 'bc-label', text: '周期模式' }));
        b2.appendChild(select(explicit, modeOpts, (v) => {
            setPeriodModeOf(USER_KEY, v);
            // ★ 这里要的是**整页重建**（`onChange(true)`）—— 上面那颗胶囊写的就是"锁定：有/无月经"，
            //   只轻量刷新的话它会一直停在旧值上（原来靠 select() 的第 4 个参数 `{rebuild:true}`，
            //   而 dom.js 的 select 根本没有那个参数 ⇒ 被丢掉，等于没重建 ✗）
            try { onChange?.(true); } catch { /* 忽略 */ }
        }));
        b2.appendChild(h('div', { class: 'bc-row' },
            h('span', { class: 'bc-badge' + (explicit ? ' on' : ''),
                text: explicit ? `锁定：${cycleModeLabel(explicit)}` : `跟随默认：${globalDefault}` })));
        b.appendChild(b2);
    }

    // ---- 别名与备注 ----
    //   AI 可能会把同一个角色拆成两个差异化的角色，所以需要做合并；
    //     同名但不是同一个人的靠别名表区分
    //     方案是 **别名表 + 备注信息，但不是改名字** ✓
    //   ★ 那小标题与说明都由 `identRows` 自己出（它现在是可折叠的一行 ✓）
    identRows(b, USER_KEY, { onChange: () => { try { onChange?.(); } catch { /* 忽略 */ } } });

    container.appendChild(box);
}

/**
 * 「角色卡」那一块 —— 哪些角色卡不让插件管（2026-10-28）。
 *
 * 口径（完整版在 src/cardexclude.js 顶上）：卡级、认头像文件名、名单全局一份、群聊不管；
 *   排除后停的是「推演一族」（注入 / 判定 / 推演账本 / 推演按钮），
 *   面板、番茄钟、骰子、随手记、日历（现实日期）照常能用 ✓
 *
 * ⚠️ 这一块**必须能在外面勾**（她 2026-10-28 指出的缺口）：
 *   原来只按"当前这张卡"认，结果只能先进那个聊天才能排 ——
 *   可进去之后第一轮生成已经跑过、账本已经写下了，那就成"事后才排" ✗
 *   ⇒ 现在改成**列出全部角色卡**，在外面勾一下就行；聊天里那颗保留当快捷方式 ✓
 *
 * ⚠️ 另外两条不能改的：
 *   ① 已有记录**一个字节都不删、也不改**（排除只是"以后不再动它"）
 *   ② 排除**不能是单向门**：任何一行取消勾选就能恢复 ✓
 */
function cardSection(container, onChange) {
    const box = section('角色卡', {
        help: [
            '这一块管的是：哪些角色卡不让插件推演。不用进那张卡的聊天，点「选择角色卡…」勾就行',
            '勾上之后：不注入提示词、不跑推演、不往那个聊天里写推演记录，楼层和悬浮球里跟推演有关的按钮也不出现',
            '面板本身照旧能开：番茄钟、骰子、随手记照常能用；日历显示的是现实日期，不是剧情日期',
            '已经有的记录一个字节都不删、也不改。想恢复取消勾选就行',
            '排除认的是角色卡的头像文件名（卡名会重名、也会改）。群聊里不做这个判断',
            '名单存一份，穿过所有存档：同一张卡在别的存档里也一样排除',
        ],
    });
    const b = box.querySelector('.bc-section-body');

    // ① 当前这张卡（在角色卡的聊天里才有）：快捷开关，进都进来了就顺手一点
    const cur = currentCardAvatar();
    if (cur) {
        b.appendChild(h('div', { class: 'bc-switch-row' },
            h('div', {},
                h('div', { class: 'bc-label', text: '这个角色卡不启用推演' }),
                h('div', { class: 'bc-hint', text: cardNameOf(cur) }),
            ),
            toggle(isCardExcluded(cur), (v) => {
                setCardExcluded(cur, v);
                // 当场生效：排除 ⇒ 把已经注进去的那段清掉；恢复 ⇒ 重新拼一份 ✓
                try { rebuildInjection(); } catch { /* 忽略 */ }
                // ★ 排除 / 恢复都**不弹右上角**（2026-10-28 她要的）——
                //   行里那行字和面板顶上那条已经说清了，再弹一下纯属打扰 ⇒ 只写控制台 ✓
                console.log('[Bodycord] 角色卡' + (v ? '已排除' : '已恢复') + '：' + cardNameOf(cur));
                onChange?.(true);
            }),
        ));
    }

    // ② 清单**不铺在页面上**（卡多会把页面拉爆）⇒ 只留一行读数 ＋ 一颗按钮，点开才是弹窗 ✓
    const all = allCards();
    const n = excludedCardList().length;
    const readout = all.length
        ? ('共 ' + all.length + ' 张角色卡' + (n ? '，已排除 ' + n + ' 张' : '，现在一张都没排除'))
        : '读不到角色卡清单（酒馆还没加载完？）';
    b.appendChild(h('div', { class: 'bc-switch-row' },
        h('div', {},
            h('div', { class: 'bc-label', text: '不启用推演的角色卡' }),
            h('div', { class: 'bc-hint', text: readout }),
        ),
        button('选择角色卡…', () => openCardPicker(() => onChange?.(true))),
    ));

    container.appendChild(box);
}

/**
 * 「选角色卡」弹窗 —— 全部卡都在这里勾（外面也能设，不用先进那个聊天 ✓）。
 *
 * ⚠️ 为什么不开在页面上：卡一多就会把设置页拉得很长
 *   ⇒ 清单只住弹窗里，带搜索和翻页；页面那一块只有一行读数 ✓
 * ⚠️ 每行**带头像**（卡多了只看名字不好认，头像才是一眼认得出的那个 ✓），
 *   图加载不出来就留一个首字，不占位不闪 ✓
 * ⚠️ 勾完**立刻生效**（注入当场清 / 重拼），已经有的记录一个字节都不动 ✓
 */
function openCardPicker(onDone) {
    const cards = allCards();
    const orphan = excludedCardList().filter((x) => !cards.some((cd) => cd.avatar === x.avatar));
    const PER_PAGE = 20;      // 跟世界书那个清单同一个量（一屏能扫完，又不会卡 ✓）
    let q = '';
    let page = 1;

    modal({
        title: '选角色卡',
        width: 560,
        cancelText: '完成',
        help: [
            '勾上就是这张卡不启用推演，点完立刻生效，不用先进入那个聊天',
            '已经有的记录不会删；取消勾选就恢复原样',
            '群聊不受这个影响',
        ],
        onClose: () => { try { onDone?.(); } catch { /* 忽略 */ } },
        build: (body, close) => {
            if (!cards.length) {
                body.appendChild(h('div', {
                    class: 'bc-hint',
                    text: '读不到角色卡清单（酒馆还没加载完？）。回到角色列表看一眼再回来',
                }));
                return;
            }
            const count = h('div', { class: 'bc-hint' });
            const listHost = h('div', { class: 'bc-target-list' });
            const draw = () => {
                clear(listHost);
                const n = cards.filter((cd) => isCardExcluded(cd.avatar)).length;
                count.textContent = '已排除 ' + n + ' / ' + cards.length + ' 张';
                const kw = q.trim().toLowerCase();
                const shown = kw ? cards.filter((cd) => cd.name.toLowerCase().includes(kw)) : cards;

                const totalPages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
                page = Math.min(Math.max(1, page), totalPages);
                const items = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE);

                for (const cd of items) {
                    const on = isCardExcluded(cd.avatar);
                    const av = h('div', { class: 'bc-pick-av' }, h('span', { text: String(cd.name || '?').slice(0, 1) }));
                    const img = h('img', {
                        class: 'bc-pick-av-img', alt: '',
                        src: '/thumbnail?type=avatar&file=' + encodeURIComponent(cd.avatar),
                    });
                    // 图挂了就把它藏掉，露出下面那个首字（不留白框 ✓）
                    img.addEventListener('error', () => { img.style.display = 'none'; });
                    av.appendChild(img);
                    listHost.appendChild(h('div', { class: 'bc-target-row' },
                        av,
                        h('div', {},
                            h('div', { class: 'bc-label', text: cd.name }),
                            h('div', { class: 'bc-hint', text: on ? '已排除：不推演、不注入、不记录' : '启用中' }),
                        ),
                        h('div', { class: 'bc-spacer' }),
                        toggle(on, (v) => {
                            setCardExcluded(cd.avatar, v);
                            try { rebuildInjection(); } catch { /* 忽略 */ }
                            // ★ 不弹右上角：这行的字已经是结果了，弹一下纯属打扰（2026-10-28）✓
                            console.log('[Bodycord] 角色卡' + (v ? '已排除' : '已恢复') + '：' + cd.name);
                            draw();
                            // 面板顶上那条提示跟着变（弹窗不重建，只刷外面 ✓）
                            try { onDone?.(); } catch { /* 忽略 */ }
                        }),
                    ));
                }
                if (!shown.length) listHost.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的角色卡' }));

                if (totalPages > 1) {
                    listHost.appendChild(h('div', { class: 'bc-row' },
                        button('上一页', () => { page = page - 1; draw(); }, { disabled: page <= 1 }),
                        h('span', { class: 'bc-hint', text: '第 ' + page + ' / ' + totalPages + ' 页（共 ' + shown.length + ' 张）' }),
                        button('下一页', () => { page = page + 1; draw(); }, { disabled: page >= totalPages }),
                    ));
                }
            };
            body.appendChild(textInput('', (v) => { q = v; page = 1; draw(); }, { placeholder: '搜索角色卡名…' }));
            body.appendChild(count);
            body.appendChild(listHost);
            draw();

            if (orphan.length) {
                body.appendChild(h('div', { class: 'bc-label', text: '已经不在角色列表里的排除项（' + orphan.length + '）' }));
                body.appendChild(h('div', { class: 'bc-hint', text: '这几张卡已经不在酒馆的角色列表里了，名单里还留着。点「放回」就把它们清掉' }));
                for (const x of orphan) {
                    body.appendChild(h('div', { class: 'bc-target-row' },
                        h('div', {}, h('div', { class: 'bc-label', text: x.name })),
                        h('div', { class: 'bc-spacer' }),
                        button('放回', () => {
                            setCardExcluded(x.avatar, false);
                            console.log('[Bodycord] 已从排除名单里清掉：' + x.name);
                            try { onDone?.(); } catch { /* 忽略 */ }
                            try { close(); } catch { /* 忽略 */ }
                        }),
                    ));
                }
            }
        },
    });
}

export function renderJudgeTab(container, onRefresh, onRebuild, actions = {}) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    // ★ 推演与追踪拆成两页：
    //   ⇒ 这一页只留「**怎么推**」＋「**推完给谁**」，
    //     「追踪谁 / 那些数据」在 renderTrackingTab ✓
    // ★ 2026-10-31（她要求重排）：整页顺序＝**一次推演从头到尾**，不再把"总开关"和"注入"拆到页首页尾。
    //   1 总开关与时机 → 2 推演谁 → 3 喂给推演什么 → 4 世界书 → 5 角色卡 → 6 记什么 → 7 结果给谁
    //   ⚠️ 那条簇标题「触发与范围」删掉了：它只出现在「角色卡」上面一次，
    //     前面几张卡看着像没有归属，不如让每张卡自己的名字说清 ✓
    timingSection(container, onChange);
    whoSection(container, onChange);
    feedSection(container, onChange);
    wiSection(container);
    cardSection(container, onChange);
    recordSection(container, onChange);
    injectSection(container, onChange);
}

/**
 * 「追踪」页签（从「推演与追踪」里拆出来的那个"追踪"）。
 *
 *   · targetSection  追踪谁（模式 / 名单 / 上限 / 自动建档）
 *   · dataSection    这些追踪对象的数据（导出 / 清空 / 档案里的状态数据）
 */
export function renderTrackingTab(container, onRefresh, onRebuild) {
    clear(container);
    const onChange = (structural) => { if (structural) onRebuild?.(); else onRefresh?.(); };
    // 
    //   卡片自己就有名字，再叠一层同义的簇标题，看起来像同一个东西写了两遍 ✗
    targetSection(container, onChange);
    dataSection(container, onChange);
}
