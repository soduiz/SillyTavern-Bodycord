/**
 * index.js —— 插件入口
 *
 * 职责：
 *   1. 等酒馆就绪，挂上悬浮球
 *   2. 监听事件：AI 回复完自动推演、切聊天重新绑定
 *   3. 组装注入主 API 的内容
 *   4. 挂载扩展抽屉里的设置块
 */

import { initST, getEventSource, getEventTypes, getCtx, renderTemplate, toast, installSaveFlushHooks } from './src/st.js';
import { settings, save, sanitizeModuleExclusivity, currentApi } from './src/settings.js';
import { ensureBaseTargets, state, commit, targetList, displayName, clearCandidateRecords, dropSnapshotsOfFloor, pruneOrphanSnapshots, syncFloorIds, resolveDeletedFloor, migrateFloorIndices, rekeyEditedFloor, healConceiveHold, repairFetusPending, recoverEventAchievementsFromLastRaw, syncPlanSexesFromD6, repairHeritageRetry } from './src/store.js';
import { runJudge, refreshRaw, restoreCachedCandidate } from './src/judge.js';
import { forceReResolveAvatar } from './src/bodycord.js';
import { rebuildInjection, clearInjection } from './src/prompt.js';
import { initUI, refreshAll, rebuildStatusViews, refreshStatusHints, syncPresentation, openTab, applyFabLook, refreshSettingsPaneForce, floorsOn, BUILD_LABEL } from './src/ui.js';
import { mountFloors, applyFloorPanel, lastFloorExcluded } from './src/ui-floors.js';
import { installPromptInterceptor } from './src/intercept.js';
import { installWorldInfoHooks } from './src/wi.js';
// ★ 被排除的角色卡（口径见 src/cardexclude.js 顶上那段；自动推演的入口在这里堵 ✓）
import { isCardExcluded } from './src/cardexclude.js';
import { emptyProfile, buildStatusProfile } from './src/serialize.js';
import { noteSkip } from './src/runstat.js';
import { scheduleRun, beginRun, endRun, clearPending, abortRun, isRunning } from './src/judge-queue.js';

/**
 * ★ 版本串 —— 扩展面板上会显示它（`版本：1.0（构建号）`）。
 *
 * 为什么需要：**扩展管理器里那个勾选框根本不重载页面** ——
 *   页面里跑的还是"上次加载时"的旧代码，改动压根不生效 ✗。
 *   有了这个标记，一眼就能看出「跑的是不是最新的那份」：**界面上的号跟源码对不对得上**。
 *
 * ⚠️ 它直接取 `ui.js` 里拼好的那一个串（`BUILD_LABEL`）——只有一处来源，
 *   不会出现"面板号变了、这里还是旧的" ✗
 */
const BUILD = BUILD_LABEL;

let ready = false;
let judging = false;
let lastJudgeAt = 0;
const MIN_JUDGE_GAP = 1500; // 防止事件重复触发
/**
 * ★ 自动推演撞上"别人正在跑"时，最多再等一轮（A3）。
 *   为什么不能硬抢：手动推演正跑着的时候来一次自动推演，
 *   抢的话就是把玩家的请求掐掉换成自动的 —— 那正好搞反了方向 ✗
 *   （自动跑着时手动推演 ⇒ 中断自动、按手动的来 ✓）
 */
let _busyRetry = 0;

// ---------------------------------------------------------------------------

function chatKeySafe() {
    try { return getCtx()?.chatId ?? getCtx()?.charId ?? 'unknown'; }
    catch { return 'unknown'; }
}

/**
 * 「当前是谁在人机上」的指纹 = 用户角色名 + 角色卡名。
 *
 * ★ 在非聊天界面切换使用角色，名称会不同步 ✗
 *   根因：换人设时只 `syncPresentation()`（那是**头像视角**的省法），
 *        而设置页建完就锁住（`pane.dataset.ready === '1'` ⇒ 之后再进一律早退）
 *        ⇒ 里面显示的名字永远停在第一次建的那一刻 ✗
 *   ⇒ 现在按**名字真的变了没**分流：变了才重画（没变只推一遍头像/位置）✓
 *   ⚠️ 光靠事件还不准：`PERSONA_UPDATED` 也可能只是改了头像/描述（名字没变）✓
 */
function whoFingerprint() {
    try {
        const c = getCtx();
        return String(c?.name1 || '') + '\u0000' + String(c?.name2 || '');
    } catch { return ''; }
}
let _whoFp = '';

function ensurePlaceholder() {
    // 新建档的对象先给一个占位面板，免得悬浮球点开是空的
    for (const t of targetList()) {
        if (!t.profile) {
            t.profile = emptyProfile(false);
            t.raw = buildStatusProfile(displayName(t) || t.key, t.profile, t.period);
        }
    }
    commit();
}

async function doJudge(reason = '') {
    const s = settings();
    if (!s.enabled) return;
    if (judging) return;

    // 被「不参与推演」排除掉的楼层：**连状态都不记**。
    // 不是"记了但不显示" —— 玩家标记它就是为了让它彻底不影响数值。
    try {
        if (lastFloorExcluded()) {
            console.log('[Bodycord] 这一楼被标记为「不参与推演」，跳过', reason ? `（触发：${reason}）` : '');
            return;
        }
    } catch { /* 忽略 */ }
    const now = Date.now();
    if (now - lastJudgeAt < MIN_JUDGE_GAP) return;
    lastJudgeAt = now;

    // 借酒馆通道时不用填地址密钥，跟着酒馆当前预设走
    // ⚠️ 判据必须读**当前那条渠道**（`currentApi()`）—— 老写法读 `s.api.baseUrl / model`，
    //   而那两个字段在「插件 API 改成多套」时被 normalizeApi 永久删掉（值只存在于 list[i] 里）
    //   ⇒ 条件恒真、**自动推演一次都不跑**（手动推演照常，极难自查 ✗）
    const apiCfg = currentApi();
    if (s.api.mode !== 'st'
        && (!apiCfg || !String(apiCfg.baseUrl || '').trim() || !String(apiCfg.model || '').trim())) {
        console.warn('[Bodycord] 还没配置插件自己的 API，跳过推演');
        return;
    }

    judging = true;
    // ★ 给这次推演一个可以掐断的开关（在楼层上点「不参与推演」就能取消它）
    const signal = beginRun();
    // ★ 这次后来被别人（手动推演）抢掉了吗 —— 抢掉的话收尾时别刷新
    //   （接手那次跑完自己会刷；这里刷只会闪一下"回滚后"的旧状态 ✗）
    let superseded = false;
    try {
        const r = await runJudge({ silent: true, signal });
        if (r.ok) {
            console.log('[Bodycord] 推演完成：', r.updated, reason ? `（触发：${reason}）` : '');
        } else if (r.cancelled) {
            superseded = r.superseded === true;
            // 玩家自己取消的 ⇒ 不是失败，别弹红色提示 ✓
            console.log(superseded
                ? '[Bodycord] 这次推演被后来的那次接管了（按手动的来）'
                : '[Bodycord] 这次推演被玩家取消了', reason ? `（触发：${reason}）` : '');
        } else if (r.blocked) {
            // ★ 没有系统层的时候应该禁止推演：
            //   最新那一楼不是正文（是玩家的发言 / 这次没产出正文）⇒ 不推演是**对的**，
            //   不是失败 ⇒ 不弹红提示，只记一行、并记进「自动推演跳过」✓
            console.log('[Bodycord] 最新一楼没有正文，跳过推演', reason ? `（触发：${reason}）` : '');
            try { noteSkip('没有正文'); } catch { /* 忽略 */ }
        } else {
            console.warn('[Bodycord] 推演失败：', r.error);
            toast('状态推演失败：' + r.error, 'error');
        }
    } catch (e) {
        console.error('[Bodycord] 推演异常', e);
    } finally {
        // ⚠️ 要带上自己那份 signal：这次要是被别人（手动推演）抢了，
        //   `_runCtrl` 已经是它那次的了，清掉就等于把它的中止开关弄丢 ✗
        endRun(signal);
        judging = false;
        try {
            if (!superseded) {
                rebuildInjection();
                refreshAll();
            }
        } catch (e) { console.warn('[Bodycord] 刷新失败', e); }
    }
}

function onChatChanged() {
    try {
        // ★ 换了聊天 ⇒ 把还在排队的那次推演清掉 ✓
        //   排队中的那次推演是**上一个聊天**的（延时已经从 8 秒拉长到 15 秒，
        //   窗口更宽了）；留着它开跑就会拿**这个**聊天的最后一楼去推 ⇒ 推错人 ✗
        try { clearPending(); } catch { /* 忽略 */ }
        // ★★ 正在跑的那次也要掐断：
        //   原来这里**只清排队**，已经发出去的请求照样会回来，而 `runJudge` 全程读
        //   `state()`（= 当前这个聊天的 chat_metadata）⇒ 旧聊天那份状态会被整份写进
        //   **新聊天**、还追加一条错快照 ✗。
        //   ⇒ 这里掐断（第一道防线），`judge.js` 里那三处换聊天守卫是第二 / 三道 ✓
        //   ⚠️ 它不算"失败"也不算"被取代"，所以 `runJudge` 会走"还原现场"那条路 ——
        //     还原的也是**旧聊天那份** beforeRun（请求期间没人改过它 ⇒ 等价于什么都没做 ✓）
        try { abortRun(); } catch { /* 忽略 */ }
        // ★ 换聊天常常连带换用户角色（酒馆的人设可以按聊天绑定）⇒ 指纹跟着重记 ✓
        _whoFp = whoFingerprint();
        // ★ 换聊天 ⇒ 楼层指纹也要重记（新聊天的楼层跟上一个聊天毫无关系）
        try { syncFloorIds(); } catch { /* 忽略 */ }
        // ★ 排队里的那次自动推演也算"上一个聊天"的（顶掉它的语义交给 scheduleRun）
        _busyRetry = 0;
        // ★ 刚打开的这个聊天里可能还躺着历史版本落盘的脚本注入
        //   （`chat_metadata.script_injects` + 内存里的 `script_inject_*`）——
        //   酒馆加载聊天时会把它重新应用上去 ⇒ 不在这儿清，界面就会看到
        //   「插件已经关了 / 被禁用着，提示词里却还有那两段」✗
        try { cleanStaleScriptInjects(); } catch { /* 忽略 */ }
        ensureBaseTargets();
        ensurePlaceholder();
        // ★ 2026-10-23：撤销 / 回滚之后那份存档可能被旧版写坏（未孕却挂着提醒 / 胎儿行）
        //   ⇒ 打开聊天时先自愈一次，再拼面板文字（不然刷新也还是那副样子 ✗）
        try { healConceiveHold(); } catch (e) { console.warn('[Bodycord] 冻结期自愈失败', e); }
        // ★ 2026-10-23：「刚着床那一轮」的尾巴（模型自己写的 d6 / 没被消费的待判标记）
        try { repairFetusPending(); } catch (e) { console.warn('[Bodycord] 刚着床残留清理失败', e); }
        // ★ 2026-10-23：手改 d6 时把性别同步回 fetusPlan（她：两男一女）
        try { syncPlanSexesFromD6(); } catch (e) { console.warn('[Bodycord] 同步胎性别失败', e); }
        // ★ 2026-10-23：血脉遗传特质没写进 d6 ⇒ 清掉"已发"标记，下一轮重发
        try { repairHeritageRetry(); } catch (e) { console.warn('[Bodycord] 安排重发血脉遗传失败', e); }
        // ★ 2026-10-23：从上次回包里补回被误杀的事件成就（每条回包只补一次）
        try { recoverEventAchievementsFromLastRaw(); } catch (e) { console.warn('[Bodycord] 补回事件成就失败', e); }
        refreshRaw({ force: true });
        rebuildInjection();
        // 换了聊天：切换条要重建，呈现方式也要重新判断（可能从内嵌切回悬浮窗）
        rebuildStatusViews();
        syncPresentation();
        refreshAll();
    } catch (e) {
        console.warn('[Bodycord] 切换聊天时出错', e);
    }
}

function bindEvents() {
    const es = getEventSource();
    const et = getEventTypes();

    if (!es || !et) {
        console.warn('[Bodycord] 拿不到酒馆事件系统，自动更新会失效（手动推演仍然可用）');
        return;
    }

    const on = (name, fn) => { if (et[name] && typeof es.on === 'function') es.on(et[name], fn); };

    // 在外面（酒馆的用户角色面板）换人设 —— 面板头像要跟着换，**名字也要跟着换** ✓
    //   （为什么要按名字分流：见上面 whoFingerprint() 那段注释 ✓）
    //   ⚠️ 读名字要**等一拍**：事件到的时候酒馆那边的 name1 可能还没换完 ✗
    const onPersonaChanged = () => {
        setTimeout(() => {
            const now = whoFingerprint();
            if (now === _whoFp) {
                try { syncPresentation(); } catch { /* 忽略 */ }
                return;
            }
            _whoFp = now;
            console.log('[Bodycord] 换了用户角色名，跟着刷新界面');
            try { forceReResolveAvatar(); } catch { /* 忽略 */ }   // 头像跟着新人设
            try { rebuildStatusViews(); } catch { /* 忽略 */ }     // 面板上的名字
            try { refreshAll(); } catch { /* 忽略 */ }
            try { refreshSettingsPaneForce(); } catch { /* 忽略 */ } // 设置页里的名字
        }, 0);
    };
    on('PERSONA_CHANGED', onPersonaChanged);
    on('PERSONA_UPDATED', onPersonaChanged);
    on('PERSONA_RENAMED', onPersonaChanged);
    on('CHAT_CHANGED', () => {
        onChatChanged();
        // 换聊天 ⇒ 设置页里那些"跟这个聊天走"的东西（已建档名单之类）也要重画 ✓
        try { refreshSettingsPaneForce(); } catch { /* 忽略 */ }
        // ★ 以前这里**无参**调 `applyFloorPanel()` ⇒
        //   `next = !!undefined = false` ⇒ 把开关打成 false + 整块摘掉，要等 ≤1.2 秒心跳才画回来 ✗
        //   ⇒ 传当前该不该开（`floorsOn()` 就是 ui.js 每次刷新用的那个判据 ✓）
        try { applyFloorPanel(floorsOn()); } catch { /* 忽略 */ }
    });

    /**
     * 生成结束后**延时**再推演。
     *
     * 默认延时必须长一点（太短的话，酒馆会出现截断或者空回的情况）；
     *   空回 / 报错这类情况不要自动生成状态栏；自动重试间隔放进设置让玩家自己填
     *   （默认 5 秒 —— 这个确实容易白白浪费 token）
     *
     * ⇒ 三件事：①延时（默认 15 秒，
     *   理由是"截断判不出来，多点时间才好赶在它开跑前把它拦下来"）
     *   ②空回/报错直接不推演 ③没跑成时按设置的重试间隔再试。
     */
    /**
     * 这次生成到底有没有**真的产出消息**。
     *
     * 「报错就不推演」—— 400 / 524 这类报错会让生成失败，
     * **失败就不会有新消息** ✓ ⇒ 所以不用去解析状态码（插件也看不到主 API 的状态码 ✗），
     * 只要看"有没有新消息"就够了 ✓
     *
     * 这一套同时覆盖三种情况：报错 ✓ 被中止 ✓ 空回 ✓
     * ⚠️ 不覆盖"截断"（文字被掐断时**里面是有字的**，只有人读得出来 ✗）——
     *    截断的里面其实也有字，只是看着像是没有写完的样子
     */
    let _gotMessageThisGen = false;

    /**
     * 这次生成是不是**被玩家按了停止**（酒馆的 GENERATION_STOPPED）。
     *
     * 为什么值得单独记：报错和按停止都"没有产出消息"，跳过推演的行为一样，
     *   但原因不一样。分开记之后，「诊断报告」能说出到底是哪一种 ✓
     * ⚠️ 它的信号比 GENERATION_ENDED **晚一步**（酒馆是先发 ENDED、再发 STOPPED，
     *   见 script.js 的 stopGeneration）⇒ 所以跟它有关的原因要**等一拍再定** ✗（见下）
     */
    let _genAborted = false;

    function scheduleJudge(reason) {
        const s = settings();
        // ★★ 被排除的角色卡：不排自动推演（2026-10-28）——
        //   这里是**自动推演唯一的入口**（GENERATION_ENDED / MESSAGE_RECEIVED 那几条都走它 ✓）
        if (isCardExcluded()) return;
        if (!s.autoUpdate) return;

        // 空回（最后一楼正文是空的）→ 不推演（内容都没有，推了也是白烧 token）
        // ⚠️ 这里只管"正文空不空"这一格；报错 / 被中止那一格在下面的标志法里管 ✓
        //    截断 —— 那要靠人读文意，插件判断不了 ✗
        //    ⇒ 界面文案别写"截断"（不实 ✗）
        if (s.judgeSkipEmpty !== false) {
            try {
                const chat = getCtx()?.chat || [];
                const last = [...chat].reverse().find(m => m && typeof m.mes === 'string' && !m.is_user);
                const txt = String(last?.mes ?? '').trim();
                if (!txt) {
                    console.log('[Bodycord] 最后一楼是空的，跳过自动推演');
                    try { noteSkip('最后一楼是空的'); } catch { /* 忽略 */ }
                    return;
                }
            } catch { /* 读不到就照常推演 */ }
        }

        // ★ 重试间隔和生成结束后的自动推演延时都改成**秒**
        //   （毫秒用着很麻烦）⇒ 设置里存的是秒，这里乘回毫秒 ✓
        //   ⚠️ 别写成 `Number(x) || 15` —— 填 0（不等待）是**合法值**，`||` 会把它变成 15 ✗
        const _delaySec = Number(s.judgeDelaySec);
        const delay = Math.max(0, Number.isFinite(_delaySec) ? _delaySec : 15) * 1000;
        // ⚠️ 这里原来还有一道 `if (isStBusy()) 再过一会儿重试` ——
        //   那是给「借用酒馆通道」防递归用的。通道删掉之后 `_stBusy` 永远是 false，
        //   整段是死代码（而且"推演会触发 GENERATION_ENDED"这个前提也不存在了），
        //   所以一起删了。要重新支持"借酒馆通道"的话，得连这套标记一起恢复。
        // ★ 排队交给 judge-queue 管（新的会顶掉旧的，而且玩家能从楼层上取消它）✓
        scheduleRun(() => {
            // ★★ 已经有一次在跑（多半是刚点的手动推演）⇒ **让位，不抢**（A3）✓
            //   抢的话就是把玩家的请求掐掉换成自动的 —— 方向正好反了 ✗
            //   （自动跑着时手动推演 ⇒ 中断自动、按手动的来 ✓）
            if (isRunning()) {
                if (_busyRetry < 1) {
                    _busyRetry++;
                    console.log('[Bodycord] 已经有一次推演在跑了，这次自动推演再等一轮');
                    scheduleJudge(reason);
                    return;
                }
                console.log('[Bodycord] 已经有一次推演在跑，这次自动推演跳过');
                try { noteSkip('另一次推演还在跑'); } catch { /* 忽略 */ }
                return;
            }
            _busyRetry = 0;
            doJudge(reason);
        }, delay);
    }

    on('GENERATION_ENDED', () => {
        // ★ 这次生成没产出任何消息（报错 / 被中止 / 空回）⇒ 不推演，别白烧 token ✓
        const sawMessage = _gotMessageThisGen;
        _gotMessageThisGen = false;      // 读完就重置，保证下次是干净的 ✓
        if (settings().judgeSkipEmpty !== false && !sawMessage) {
            // ⚠️ 这里**不能立刻定原因**：酒馆是先发 ENDED、后发 STOPPED
            //   （stopGeneration 里 hideStopButton 先跑 ⇒「被中止」的信号晚一步到 ✗）
            //   ⇒ 等一拍（同一轮事件循环结束）再记，那时两种信号都齐了 ✓
            setTimeout(() => {
                const why = _genAborted ? '被中止' : '没有产出内容';
                _genAborted = false;
                console.log(`[Bodycord] 这次生成${why}，跳过自动推演`);
                try { noteSkip(why); } catch { /* 忽略 */ }
            }, 0);
            return;
        }
        scheduleJudge('GENERATION_ENDED');
    });

    // ★ 玩家按了停止（也可能被别的扩展中止）—— 记下来，好和"报错"分开 ✓
    on('GENERATION_STOPPED', () => { _genAborted = true; });

    on('MESSAGE_RECEIVED', () => {
        // ★ 真的有消息进来了 ⇒ 这次生成是成功的 ✓（报错的路径不会走到这里）
        _gotMessageThisGen = true;
        // 多了一楼 ⇒ 楼层指纹跟着记一份（删楼时靠它反推被删的是哪一楼 ✓）
        try { syncFloorIds(); } catch { /* 忽略 */ }
        // ★ 多了一楼 ⇒ 标题栏那颗「这一楼待推演」要立刻亮起来。
        //   手动推演档下 `scheduleJudge()` 第一句就 return、全程不会 `refreshAll()`
        //   ⇒ 原来这颗胶囊会一直停在上一次推演完的样子（隐藏着）✗
        try { refreshStatusHints(); } catch { /* 忽略 */ }
        // 有些版本没有 GENERATION_ENDED，这里兜底
        if (!getEventTypes().GENERATION_ENDED) scheduleJudge('MESSAGE_RECEIVED');
    });

    on('MESSAGE_SWIPED', (mesId) => {
        // ★ 只认**最后一楼**：
        //   旧的某一楼切候选（备选回复）时**不重算、不动数据** ✓ —— 真要重算就得从那一楼往后
        //   全部重来，代价太大；所以那边只在楼层面板上写清"显示的是当初推演时的那个候选" ✓
        //   （⚠️ 这跟"重新生成"不是一回事：重新生成是酒馆先把那一楼删掉再生成新的 ⇒
        //     同一楼、内容换了 ⇒ 走回滚重算 ✓；别把这两件事混起来 ✗）
        try {
            const chat = getCtx()?.chat || [];
            if (Number(mesId) !== chat.length - 1) {
                console.log('[Bodycord] 切的是旧楼层的候选回复，按约定不重算（面板会写明它显示的是当初那个候选）');
                return;
            }
        } catch { /* 读不到就照旧 */ }

        // 候选换了 ⇒ 楼层指纹跟着更新（删楼时靠它反推真下标 ✓）
        try { syncFloorIds(); } catch { /* 忽略 */ }

        // ★★ 这一条候选**算过** ⇒ 直接读它自己的记录（零调用、不烧 token）✓
        //   这几条候选的记录都应该存着，而不是每次都重新生成 ✓
        try {
            const r = restoreCachedCandidate();
            if (r.ok) {
                console.log('[Bodycord] 切到一条算过的候选，直接读记录（楼层 ' + r.floor + '）');
                try { refreshAll(); } catch { /* 忽略 */ }
                return;
            }
        } catch { /* 没记录就往下走 */ }

        // 没有记录：老版本留下的候选，或者刚生成还没算过 ⇒ 按设置决定要不要补算一次
        if (settings().updateOnSwipe) scheduleJudge('MESSAGE_SWIPED');
    });

    // ★★ 「消息被删除」—— 重新生成会**先删掉那一楼**再生成新的
    //   （script.js 的 Generate：`chat.length = chat.length - 1` ＋ MESSAGE_DELETED），
    //   所以那一楼的旧候选记录**直接作废、删掉** ✓
    //   重新生成的话旧记录可以删掉，因为 ROLL 走的东西回不来了；
    //     但备选回复不一样 ✓✓ —— 而备选回复（swipe）**不发这个事件** ⇒ 记录留着 ✓
    //
    //   ★★ 但酒馆给的**不是"被删掉的那一楼"**（script.js 里四个发事件的地方给的都是
    //     **删完之后**的 `chat.length` ✗）—— 删最后一楼时刚好相等，删中间那一楼就不等了。
    //     ⇒ 用楼层指纹反推真下标（`resolveDeletedFloor`），再把按楼层存的东西整体往前挪
    //       （`migrateFloorIndices`）✓ 详见 store.js 顶部那段说明
    on('MESSAGE_DELETED', (reported) => {
        try {
            const idx = resolveDeletedFloor(reported);
            if (idx < 0) { console.warn('[Bodycord] 认不出被删的是哪一楼，这次不动按楼层存的东西'); return; }
            const n = clearCandidateRecords(idx);
            const sn = dropSnapshotsOfFloor(idx);
            const moved = migrateFloorIndices(idx);
            // ★ 兜底：按指纹再审一遍（事件认错楼层 / 落盘被守卫挡住时也能清掉幽灵快照 ✓）
            try { pruneOrphanSnapshots(); } catch { /* 忽略 */ }
            const bits = [];
            if (n) bits.push('作废候选记录 ' + n + ' 条');
            if (sn) bits.push('删掉这一楼的时光机快照 ' + sn + ' 条');
            if (moved.excluded) bits.push('挪「不参与推演」标记 ' + moved.excluded + ' 处');
            if (moved.floors) bits.push('挪候选楼层 ' + moved.floors + ' 个');
            if (moved.snapshots) bits.push('挪快照楼层号 ' + moved.snapshots + ' 条');
            console.log(`[Bodycord] 第 ${idx} 楼被删了（酒馆给的数是 ${reported}）` + (bits.length ? '：' + bits.join('、') : ''));
        } catch (e) { console.warn('[Bodycord] 处理「消息被删除」出错', e); }
        // ★ 少了一楼 ⇒ 「这一楼待推演」可能不用亮了（或刚亮的该灭）⇒ 当场重算一次 ✓
        try { refreshStatusHints(); } catch { /* 忽略 */ }
    });

    // 改了正文 ⇒ 楼层指纹跟着更新（不然下次删楼会认错是哪一楼 ✗）
    //   ★ 2026-10-23 她报「修改正文之后记录丢失」：候选记录与时光机快照都按正文指纹认哪一条，
    //     正文一改指纹就变 ⇒ 记录对不上，楼层面板说"本楼暂无推演记录"，下次清理还会当孤儿删掉 ✗
    //     ⇒ 先把这一楼的记录换到新指纹上，再同步楼层号 ✓
    //   ⚠️ 不在这里再挂一个 MESSAGE_SWIPED —— 上面已经有一个了（重复挂虽然不炸，但没必要）
    const syncFloors = () => { try { syncFloorIds(); } catch { /* 忽略 */ } };
    const onEdited = (reported) => {
        try {
            const idx = Number(reported);
            if (Number.isFinite(idx) && idx >= 0) {
                const n = rekeyEditedFloor(idx);
                if (n) console.log(`[Bodycord] 第 ${idx} 楼正文改过：把 ${n} 条记录换到新指纹上`);
            }
        } catch (e) { console.warn('[Bodycord] 处理「消息被编辑」出错', e); }
        syncFloors();
    };
    on('MESSAGE_EDITED', onEdited);
    on('MESSAGE_UPDATED', onEdited);

    on('GENERATION_STARTED', () => {
        // ★ 新一次生成开始 ⇒ 先假设这次什么都产不出来，等 MESSAGE_RECEIVED 来翻案 ✓
        _gotMessageThisGen = false;
        _genAborted = false;
        // 生成前确保注入是最新的
        try { rebuildInjection(); } catch { /* 忽略 */ }
    });

    // 楼层小面板：把「楼层与推演追踪」那排折叠面板挂进聊天楼之间（开关在设置里那个「楼层显示」✓）
    try { mountFloors(getCtx()); } catch { /* 忽略 */ }
    // ★ 启动时也传当前该不该开（无参 = false ⇒ 白摘一次 ✗）
    try { applyFloorPanel(floorsOn()); } catch { /* 忽略 */ }
}

// ---------------------------------------------------------------------------
// 扩展抽屉里的设置块
// ---------------------------------------------------------------------------

async function mountDrawer() {
    let html;
    try {
        html = await renderTemplate('settings.html');
    } catch (e) {
        console.warn('[Bodycord] settings.html 加载失败', e);
        return;
    }

    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host) return;

    const wrap = document.createElement('div');
    wrap.className = 'bodycord-drawer';
    wrap.innerHTML = html;
    host.appendChild(wrap);

    // ⚠️ 这里原来还有 5 段 `wrap.querySelector('#bc-drawer-…')` ——「打开面板 / 设置 /
    //   手动推演 / 自动更新 / 注入主 API」那五颗控件。但 `settings.html` 里**从来没有过**
    //   这五个元素（它只渲染「启用插件」这一格）⇒ 那 5 段永远落空、静默跳过，
    //   是死代码。
    //   ⇒ 删掉，不再假装这里能配（那几个开关的真实入口：抽屉下面那颗「启用插件」、
    //     设置页里的推演与追踪、悬浮球菜单 / 面板本身）✓
    //   ⚠️ 以后要往这里加控件，先把 `<input id="bc-drawer-…">` 写进 settings.html ✗

    // 版本徽章：一眼看出当前跑的是哪一版
    try {
        const host2 = wrap.querySelector('.inline-drawer-content') || wrap;
        {
            const v = document.createElement('div');
            v.style.cssText = 'margin-top:6px;opacity:.6;font-size:11px';
            v.textContent = '版本：' + BUILD;
            host2.appendChild(v);
        }
    } catch { /* 忽略 */ }

    const enableBox = wrap.querySelector('#bc-drawer-enabled');
    if (enableBox) {
        enableBox.checked = !!settings().enabled;
        enableBox.addEventListener('change', () => {
            settings().enabled = enableBox.checked;
            save();
            if (settings().enabled) rebuildInjection();
            else clearInjection();
        });
    }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

async function boot() {
    if (ready) return;
    ready = true;

    await initST();

// 发送前瘦身：只让主 API 看到最近几条状态栏（老的状态栏信息完全重复，白吃 token）
try {
    const r = installPromptInterceptor();
    if (!r.ok) console.warn('[Bodycord] 状态栏瘦身没挂上：' + (r.error || '未知原因'));
} catch (e) { console.warn('[Bodycord] 挂拦截器失败', e); }

// 给推演读世界书：挂上世界书的两个事件（扫之前给条目、扫之后给"这一轮真注入的那批" ✓）
try {
    const r = installWorldInfoHooks();
    if (!r.ok) console.warn('[Bodycord] 世界书监听没挂上：' + (r.error || '未知原因'));
} catch (e) { console.warn('[Bodycord] 挂世界书监听失败', e); }

// ★ 收尾落盘：
//   酒馆的落盘有 1 秒防抖 ⇒ 改完 1 秒内刷新 / 关页面，最后那一下可能没写进文件 ✗
//   ⇒ 页面被藏起来（切标签 / 最小化 / 关）时用非防抖入口立刻补一次 ✓（只对聊天数据有效）
try {
    if (!installSaveFlushHooks()) console.warn('[Bodycord] 收尾落盘钩子没挂上（拿不到 window？）');
} catch (e) { console.warn('[Bodycord] 挂收尾落盘失败', e); }

    // 把设置缓存清掉，确保读的是酒馆里的最新值
    try { settings(); } catch (e) { console.warn('[Bodycord] 读取设置失败', e); }

    // 清理模块互斥冲突（老存档可能留着「现实向 + 二次元向」两个都开的状态）
    try {
        const off = sanitizeModuleExclusivity();
        if (off.length) toast(`已自动关掉冲突的模块：${off.join('、')}（同类变体只能开一个）`);
    } catch { /* 忽略 */ }

    initUI();
    applyFabLook();

    // 兜底：酒馆的 disable 钩子万一没被调到（本地扩展命名 / 版本差异），
    // 自己盯着"我是不是被禁用了" —— 只要 JS 还活着就一定能清掉注入。
    try { startDisabledWatch(); } catch (e) { console.warn('[Bodycord] 禁用监视器没起来', e); }

    // 清掉历史版本走「/inject 退路」时落进聊天文件的那两条注入 ——
    // 不清的话，酒馆每次加载聊天都会把它们重新应用上去（禁用插件也去不掉）。
    try { cleanStaleScriptInjects(); } catch (e) { console.warn('[Bodycord] 清历史注入失败', e); }

    onChatChanged();
    bindEvents();
    mountDrawer().catch(e => console.warn('[Bodycord] 抽屉挂载失败', e));

    console.log('[Bodycord] 已加载。聊天：', chatKeySafe());
}

/** 等酒馆上下文可用再启动 */
function waitForST(tries = 60) {
    if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        boot();
        return;
    }
    if (tries <= 0) {
        console.warn('[Bodycord] 等不到 SillyTavern.getContext()，插件不会启动');
        return;
    }
    setTimeout(() => waitForST(tries - 1), 250);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForST(), { once: true });
} else {
    waitForST();
}

// ---------------------------------------------------------------------------
// 扩展钩子（manifest.json 里声明 hooks.disable / hooks.enable）
//
// ⚠️ 为什么要 onDisable：酒馆的扩展开关**不重载页面**
//   （扩展管理器里点开关走 disableExtension(name, false)），
//   于是插件被禁用后 JS 还在跑、注入还留在提示词里 ——
//   症状（插件在管理扩展程序关闭之后提示词还在插入）就是这个。
//   逻辑放在 src/lifecycle.js（那里能单独测），这里只负责转出去。
// ---------------------------------------------------------------------------

// ⚠️ 只转 onDisable —— 绝对不能加 onEnable，原因见 src/lifecycle.js 里的注释
export { onDisable } from './src/lifecycle.js';
import { startDisabledWatch } from './src/lifecycle.js';
import { cleanStaleScriptInjects } from './src/compat.js';

// 提供给控制台调试用
window.__bodycord = {
    settings, save, state, runJudge, rebuildInjection, clearInjection, openTab,
    version: BUILD_LABEL,
};
