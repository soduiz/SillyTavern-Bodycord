/**
 * ui-floors.js —— 楼层状态面板
 *
 * 每个楼层（用户层 / 系统层都挂）下面挂一份**该楼层的状态**，
 * 不是一个面板打天下。数据来自插件每轮存的历史快照（store.js 的 snapshots），
 * 每份快照记着「这一楼推演完之后，面板长什么样」。
 *
 * ⚠️ 层级口径（早先写成"系统消息层"，纠正过来了 ✗）：
 *   **酒馆只有两层 —— 用户层（玩家自己发的那一楼）和系统层（就是正文，AI 写的那一层）** ✓。
 *   两层的唯一分别：**用户层不给「参与推演」开关**（它不需要被推演，见 buildPanel 里的说明），
 *   系统层（正文）本来就该有这颗开关 ✓。
 *
 * 同时这里也负责「参与推演」开关：
 * 被排除的楼层，推演引擎读正文时会直接跳过。
 *
 * 排除标记存在插件自己的 state 里（chat_metadata 下面），
 * 按楼层下标记 —— 这样插件**永远不需要去写用户的聊天文件**。
 *
 * ⚠️ 早先的版本把它写在消息对象上（msg.extra.bodycordExcluded），
 *   那就得调 ST 的 saveChat() 才能持久化。而 getContext().saveChat 实际是
 *   ST 的 saveChatConditional，会把内存里的整个 chat 覆盖回磁盘 ——
 *   实测造成过一次真实的聊天记录丢失，所以这条路径已经被彻底拆掉了。
 */

import { h } from './dom.js';
import { getChat } from './st.js';
import { isExcluded, setExcluded, isTargetLight, isImportedTarget, stripDateText } from './store.js';
import { refreshRaw } from './judge.js';
import { snapshots, hashText } from './store.js';
import { cancelRun, queueState } from './judge-queue.js';
import { settings } from './settings.js';

let bound = false;
let timer = null;
let enabled = false;

/**
 * ★ 「立刻推演一次」那把钥匙 —— 由 `ui.js` 在定义完 `doJudge` 之后递进来。
 *
 * 为什么不能直接 import：`doJudge` 住在 `ui.js`，而 `ui.js` 已经 import 了本文件
 * ⇒ 反向 import 会成环 ✗（这条以前踩过，别试）
 */
let judgeHandler = null;
export function setJudgeHandler(fn) {
    judgeHandler = typeof fn === 'function' ? fn : null;
}

/**
 * ★★ 楼层这一行挂在**聊天消息**上、不在 `.bc-root` 里 ⇒ 日夜 / 易读两档要**自己带**
 *   （跟气泡 / 右键菜单 / 歌词条那几层同一个道理 ✓）。
 *
 * 不带的话：那套主题变量一个都拿不到 ⇒ 底色退化成那个"几乎全透明"的浅灰兜底
 *   （透明面板就是它），深色主题下也不会变，
 *   而且易读模式的字号缩放（`--bc-fs-scale`）在玩家那儿也一直没生效 ✗
 */
function floorLookAttrs() {
    let theme = 'light';
    let vision = 'normal';
    try {
        theme = settings().ui.theme || 'light';
        vision = settings().visionMode === 'large' ? 'large' : 'normal';
    } catch { /* 读不到就用默认 */ }
    return { theme, vision };
}

/** 把日夜 / 易读两档刷到**已经在页面上的**每一行（切主题时要现刷一次 ✓） */
export function syncFloorLook() {
    try {
        const { theme, vision } = floorLookAttrs();
        for (const el of document.querySelectorAll('.bc-floor')) {
            el.dataset.theme = theme;
            el.dataset.vision = vision;
        }
    } catch { /* 忽略 */ }
}

/** 这一楼是不是被排除在推演之外 */
export function isFloorExcluded(idx) {
    return isExcluded(idx);
}


/** 最后一个有正文的楼层下标（-1 = 没有） */
export function lastContentFloor() {
    const chat = getChat();
    if (!Array.isArray(chat)) return -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && typeof m.mes === 'string' && m.mes.trim()) return i;
    }
    return -1;
}

/**
 * 最后一楼是不是被排除了。
 * 自动推演会看这个 —— 被排除的楼**连状态都不记**，不是「记了但不显示」。
 */
export function lastFloorExcluded() {
    const i = lastContentFloor();
    return i >= 0 && isFloorExcluded(i);
}

/**
 * 最后一楼有没有对应的状态快照。
 * 手动推演时用这个提示玩家「这一楼还没生成过状态」。
 */
/** 有没有「欠着没推」的楼层 */
export function pendingFloors() {
    const i = lastContentFloor();
    if (i < 0 || isFloorExcluded(i)) return 0;
    const list = snapshots();
    const last = list.length ? list[list.length - 1].messageIndex : -1;
    return last < i ? 1 : 0;
}

export function setFloorExcluded(idx, off) {
    // ⚠️ 绝对不要在这里调 ST 的 saveChat()。
    //   楼层排除本来就只是插件自己的状态，没有任何理由去重写用户**整个聊天文件** ——
    //   而 getContext().saveChat 实际是 ST 的 saveChatConditional，会把内存里的
    //   chat + chat_metadata 整个覆盖回磁盘。这曾经造成过一次真实的数据损失。
    setExcluded(idx, off);
    try { refreshRaw({ force: true }); } catch { /* 忽略 */ }
}

// ---------------------------------------------------------------------------
// 把面板文字拆成一行行字段
// ---------------------------------------------------------------------------

const FIELD_CN = {
    状态标题: '标题', 进度描述: '进度', 次要描述: '次要', 计算说明: '计算',
    数据项一: 'd1 阶段基础率', 数据项二: 'd2 累计受孕率', 数据项三: 'd3 体质系数',
    数据项四: 'd4 致孕方', 数据项五: 'd5 意识状态', 数据项六: 'd6 胎儿状态',
    数据项七: 'd7 泌乳状态', 数据项八: 'd8 生产次数', 数据项九: 'd9 敏感带',
    // ★ 2026-10-16：这一轮「哪个部位加了几次」——不是面板字段，是插件算好存在这一楼的状态里的
    //   （模型不再写进 cot ✓）；只在这一楼真有刺激时出现 ✓
    zonesDelta: '敏感带更新',
    状态条一: 'row1 生理状态', 状态条二: 'row2 身体状况', 状态条三: 'row3 近期性行为',
};

/**
 * 去掉值前面那几段标签。
 *
 * ★ 规则（乙-1 / 编号 28 之后统一，楼层面板与时光机**共用这一条**）：
 *   · **状态条**是「图标 ｜ 标签 ｜ 值」三段 ⇒ 剥 2 段
 *   · **数据项**是「标签 ｜ 值」两段 ⇒ 剥 1 段
 *   · 其余（状态标题 / 进度描述 / **次要描述** / 计算说明）**原样显示** ——
 *     次要描述现在由系统拼成「当前时间：… ｜ 当前防护：… ｜ 近期风险：…」三段，
 *     再拿"剥第一段 / 取最后一段"那套处理就会吃掉内容 ✗（以前时光机只留最后一段）
 */
export function stripLeadLabels(key, value) {
    const s = String(value || '');
    const strip1 = (v) => v.replace(/^[^|｜]*[|｜]\s*/, '');
    if (/^数据项[一二三四五六七八九]$/.test(key)) {
        const one = strip1(s);
        return one.trim() ? one : s;
    }
    if (/^状态条[一二三]$/.test(key)) {
        const one = strip1(s);
        const two = strip1(one);
        return two.trim() ? two : (one.trim() ? one : s);
    }
    return s;
}

/** 面板文字 → { 字段名: 值 }，顺带把空的和「未加载」剔掉 */
export function parsePanelText(raw) {
    const out = [];
    const lines = String(raw || '').split('\n');
    let cur = null;
    let inPeriod = false;
    for (const line of lines) {
        const t = line.trim();
        // ★ **块标签不是字段内容** ——
        //   以前"不是字段名的非空行"一律往当前字段上贴 ⇒ 快照 raw 末尾那行 `</status_profile>`
        //   被塞进**最后一个字段**（默认 row3），经期那几层还会把整个 `<period_profile>` 块
        //   （第几天 / 流量 / 颜色 / 质地 / 痛经 / 症状）一起吞进去 ✗
        //   （楼层面板与时光机都用这个解析器 ⇒ 两边都显示那串垃圾）
        if (/^<period_profile\b[^>]*>\s*$/i.test(t)) { inPeriod = true; continue; }
        if (/^<\/?(?:status_profile|period_profile)\b[^>]*>\s*$/i.test(t)) { inPeriod = false; continue; }
        if (inPeriod) continue;               // 生理监测那一块由 periodFields() 单独渲染 ✓
        const m = line.match(/^\s*(状态标题|进度描述|次要描述|计算说明|数据项[一二三四五六七八九]|状态条[一二三])\s*[:：]\s*([\s\S]*)$/);
        if (m) {
            if (cur) out.push(cur);
            cur = { key: m[1], value: m[2].trim() };
        } else if (cur && line.trim()) {
            cur.value += (cur.value ? '\n' : '') + line.trim();
        }
    }
    if (cur) out.push(cur);

    // 去掉纯占位
    return out.filter(r => {
        const v = r.value.replace(/^[^|]*\|\s*/, '').trim();
        return v && v !== '未加载' && v !== '无' && v !== '—' && v !== '-';
    });
}

/** 这一楼对应的快照（优先挑"这一楼当前那条候选"的记录，没有就往前找最近一份） */
function snapshotFor(idx) {
    const list = snapshots();
    if (!list.length) return null;
    // ★ 一层 5 条候选 = 5 份记录（这几条记录都要存着 ✓）
    //   ⇒ 先找"正文指纹和现在这条候选一样"的那一份 ✓
    let want = '';
    try { want = hashText(getChat()?.[idx]?.mes || ''); } catch { want = ''; }
    if (want) {
        let hit = null;
        for (const s of list) {
            if (Number(s.messageIndex) === Number(idx) && String(s.hash || '') === want) hit = s;
        }
        if (hit) return hit;
    }
    let best = null;
    for (const s of list) {
        if (s.messageIndex >= 0 && s.messageIndex <= idx) best = s;
    }
    // ⚠️ 找不到就**什么都不要显示**（返回 null）。
    //   以前这里是 `return best || list[0]` —— 那一楼比**所有**快照都早时，
    //   它会退回 `list[0]`（= **更晚**那一楼的快照）⇒ 早期楼层显示后续楼层的样子，
    //   跟上面那句注释（"往前找最近一份"）正好相反 ✗
    return best;
}

/**
 * ★ 这个槽位现在是不是"轻档"（只登记了名字和种族的那种对象，见 store.js）。
 *   ⚠️ 包一层 try：拿不到状态就当"不是"（宁可多显示一块，也别让整页渲染炸掉 ✓）
 */
function isTargetLightNow(key) {
    try { return isTargetLight(key); } catch { return false; }
}

/**
 * ★ 一份面板文字是不是"整份都是占位"（轻档在老快照里留下的空壳）。
 *   判据：`emptyProfile()` 那份占位同时带着这两句，而真档案一定带着算出来的数 ⇒
 *   两句同时出现就当占位 ✓（只用一句话判会误伤：真档案里偶尔也会出现"尚未推演"这种词）
 */
function isPlaceholderPanelText(raw) {
    const t = String(raw || '');
    return /尚未推演/.test(t) && /等待第一次状态推演/.test(t);
}

// ---------------------------------------------------------------------------
// ★★ 性能优化第二刀：输入没变的楼层**不重画** ✓
//
// 为什么值得：以前每个聊天事件（收到新楼 / 切候选 / 编辑 / 删楼）都会把**所有**楼层的
//   面板拆了重建 —— 300 楼 × 3 个对象大约要重画三四万个元素，而真正变了的通常只有最新那一楼 ✗
//   ⇒ 现在每楼先算一份"输入"，跟上次画的时候比一遍，一样就直接跳过 ✓
//
// ⚠️⚠️ 加东西的人注意（这是这一刀唯一的坑）：
//   以后往楼层面板上**加任何新东西**（多显示一个字段 / 多读一个状态 / 多一个分支），
//   必须两处一起动：
//     ① `floorInputs()` 里把它**读出来**；
//     ② `sameInputs()` 里把它**比一遍**。
//   漏了第②步 = 那一格会停在旧值（界面不报错、数据也没错，是最难查的那种 ✗）
// ---------------------------------------------------------------------------

/** 上次画每一楼时用的输入：idx -> { idx, isUser, inputs } */
const _floorInputs = new Map();

/**
 * 这一楼面板的**全部输入**（`buildPanel` 和复用判据都从这里取，只有这一处算）。
 * @returns {{excluded:boolean, snap:object|null, hasCur:boolean, swipeN:number, own:boolean, anyOther:boolean, judgeState:string}}
 */
function floorInputs(idx, isUser) {
    const excluded = isFloorExcluded(idx);
    // 被排除的那一楼不读快照（跟原来一样：排除 = 这一楼连状态都不显示）
    const snap = excluded ? null : snapshotFor(idx);
    // ★★ 推演状态也**算这一楼的输入**（2026-10-15）——
    //   那一行的按钮要换词、标题要写「正在推演…」⇒ 状态变了必须重画这一楼。
    //   ⚠️ 光在 `buildPanel` 里读它没用：`paintAll()` 拿 `sameInputs` 比完发现"没变"就跳过 ✗
    //     （这个坑文件顶上那段注释专门警告过 ⇒ 加东西必须两处一起动 ✓）
    const judgeState = (() => { try { return queueState(); } catch { return ''; } })();

    // ★★ 「这一楼是不是最后一楼」也必须算输入（重新生成之后
    //   『推演这一楼』跑到 56 楼去了、58 楼没有）——
    //   重新生成 = 酒馆先删楼再生楼：删掉的瞬间上一楼成了"最后一楼"，它的面板被重画时
    //   带上了那颗按钮；新楼生成后，它的输入和上一轮看起来一模一样 ⇒ `sameInputs` 判定
    //   "没变、不用重画" ⇒ 按钮留在旧楼上，新楼永远不长出来 ✗
    //   ⇒ 把 isLast 放进输入：谁是最后一楼一变，相关两楼都会重画 ✓
    const isLast = idx === lastContentFloor();

    let hasCur = false, swipeN = 0, own = false, anyOther = false;
    try {
        const cur = getChat()?.[idx];
        hasCur = !!cur;
        const curHash = hashText(cur?.mes || '');
        const list = snapshots();
        // 这一楼现在这条候选**有没有自己的记录**（用正文指纹认）——
        // 下面 buildPanel 里那段"这一楼有 N 个候选回复"的说明要用它 ✓
        own = curHash ? list.some((x) => Number(x.messageIndex) === Number(idx) && String(x.hash || '') === curHash) : false;
        anyOther = list.some((x) => Number(x.messageIndex) === Number(idx));
        swipeN = Array.isArray(cur?.swipes) ? cur.swipes.length : 0;
    } catch { /* 读不到就不说 */ }

    // ★ **顺手抄一份 raw 的副本**（`sameInputs` 用它对比）——
    //   缓存里存的是快照**对象引用**，而时光机保存（`applySnapshotChat`）是**就地改** `snap.raw[key]`：
    //   两次拿到的都是同一个对象 ⇒ 逐键比较永远相等 ⇒ 楼层面板一直显示旧文字 ✗
    //   （抄的只是几个字符串引用，很便宜 ✓）
    const rawCopy = snap && snap.raw ? { ...snap.raw } : null;
    // ★ 2026-10-16：这一轮「敏感带哪个部位加了几次」（插件算的，存在快照的 judge 里）——
    //   它不在面板文字里，所以要单独带进输入（不然 sameInputs 认不出它变了 ⇒ 界面停在旧值 ✗）
    const zonesDelta = (() => {
        try { return String(snap?.judge?.rep?.zonesDelta || ''); } catch { return ''; }
    })();
    return { excluded, snap, rawCopy, hasCur, swipeN, own, anyOther, judgeState, zonesDelta, isLast };
}

/**
 * 两份输入"长得一样"吗 —— 一样就不重画这一楼 ✓
 *
 * ⚠️ 判据必须覆盖 `floorInputs()` 里的**每一项**（漏一个 = 界面停在旧值 ✗）。
 * ⚠️ raw 比的是 `floorInputs()` **每次画时抄下来的那份副本**（`rawCopy`），不是对象引用 ——
 *   就地改同一个快照（时光机保存走 `applySnapshotChat`）时，比引用永远相等 ⇒ 面板停在旧值 ✗
 *   逐键 `===` 比字符串本身几乎不花时间（没改过就是同一个字符串），也不会漏 ✓
 */
function sameInputs(a, b) {
    if (!a || !b) return false;
    if (a.excluded !== b.excluded) return false;
    if (a.hasCur !== b.hasCur) return false;
    if (a.swipeN !== b.swipeN) return false;
    if (a.own !== b.own || a.anyOther !== b.anyOther) return false;
    // ★ 推演状态（那一行的按钮换词 / 标题写「正在推演…」）也在这里比 —— 漏了它，
    //   推演开始/结束时那一行会停在旧样子（界面不报错，最难查 ✗）
    if (String(a.judgeState || '') !== String(b.judgeState || '')) return false;
    // ★ 是不是最后一楼也在这里比 —— 漏了它，"推演这一楼"会赖在上一楼不走（2026-10-18 ✗）
    if (!!a.isLast !== !!b.isLast) return false;
    // ★ 敏感带「这一轮加了几次」也在这里比（漏了它，重推之后那一行会停在旧值 ✗）
    if (String(a.zonesDelta || '') !== String(b.zonesDelta || '')) return false;

    const sa = a.snap, sb = b.snap;
    if (!sa || !sb) return !sa && !sb;
    if (Number(sa.messageIndex) !== Number(sb.messageIndex)) return false;

    const ra = a.rawCopy || sa.raw, rb = b.rawCopy || sb.raw;
    if (!ra || !rb) return !ra && !rb;
    const ka = Object.keys(ra);
    const kb = Object.keys(rb);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return false;
        if (ra[ka[i]] !== rb[kb[i]]) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * ★★ 那颗按钮在推演的不同阶段长什么样 —— **纯函数**（只有这一处定词，可以单测 ✓）
 *
 * 形态：**同一颗按钮**换词，不新增控件 ——
 *   闲时「推演这一楼」／推演中「停止推演」／排队中「取消这次推演」。
 * 为什么敢让一颗按钮换意思：这两个动作是**互斥**的（在跑的不能开新的，闲的没得停），
 *   而且位置和大小都不变 ⇒ 想按的人一直在同一个地方找得到 ✓
 * @param {''|'pending'|'running'} state
 * @param {boolean} hasOwn 这一楼**自己**有没有推演记录（假 = 现在显示的这份是从别的楼沿用来的）
 *   ★ 2026-10-15（本楼还没推演过，那颗按钮的说明却写着：重跑）——
 *     本楼没记录时那句 title 不能写"重跑"，那不成立 ⇒ 按这个参数分两种说法 ✓
 */
export function judgeBtnSpec(state, hasOwn = true, backfill = false) {
    if (state === 'running') {
        return {
            label: '停止推演',
            action: 'cancel',
            title: '把正在跑的这次推演停下。停下来一个字都不会写（推演是整段跑完才落库）',
        };
    }
    if (state === 'pending') {
        return {
            label: '取消这次推演',
            action: 'cancel',
            title: '把排队中的那次推演取消（还没开跑，一个字都不会写）',
        };
    }
    // ★ 补推（2026-10-21）：这一楼**不是最后一楼**、又一直没有自己的记录 ⇒ 那颗按钮点下去是"补"
    if (backfill) {
        return {
            label: '推演这一楼',
            action: 'judge',
            title: '这一楼有正文，但一直没有自己的推演记录（当时忘了点）⇒ 补推一次。'
                + '只把快照记在这一楼，别的楼层一概不动（会调用插件 API、花 token）',
        };
    }
    return {
        label: '推演这一楼',
        action: 'judge',
        title: hasOwn
            ? '按这一楼现在的正文重推一次（会盖掉这一楼自己那份记录；会调用插件 API、花 token）'
            : '按这一楼现在的正文推演一次（这一楼还没有自己的推演记录，上面那份是从别的楼沿用来的；会调用插件 API、花 token）',
    };
}

/** 推演期间那一行的读数写什么（闲时返回空串 ⇒ 用原来那三种写法 ✓） */
export function judgeRowText(state) {
    if (state === 'running') return '正在推演…';
    if (state === 'pending') return '等待推演…';
    return '';
}

/**
 * 画一楼的 DOM。
 * @param {number} idx
 * @param {boolean} isUser 玩家自己那一楼（不给「参与推演」开关）
 * @param {object|null} inputs 已经算好的输入（`floorInputs()` 的返回值）；
 *        不传就自己算一份 —— ⚠️ 性能优化第二刀之后，**调用方应该尽量把 inputs 传进来**，
 *        免得同一轮里把"这一楼的输入"算两遍 ✓
 * @returns {HTMLElement|null} null = **这一楼什么都不画**（只有用户层会这样，见下）
 */
function buildPanel(idx, isUser = false, inputs = null) {
    const inp = inputs || floorInputs(idx, isUser);
    const excluded = inp.excluded;
    const snap = inp.snap;

    // ★★ 用户层那一行要收掉：
    //   ① 那一行里「参与推演」没了，右边的"本楼暂无状态"却还在
    //   ⇒ **两头一起收**：
    //     ① **源头**：最新那一楼不是正文（AI 还没回）时，`runJudge()` 直接拒绝跑
    //        （见 judge.js 的 `hasSystemFloor()`）⇒ 快照再也不可能落在用户层上 ✓
    //     ② **界面**：用户层**整行都不画**（连折叠行都不要）✓
    //   为什么该整行不画：推演记录记在**正文（系统层）那一楼**，用户自己发的那一楼平时永远是
    //   「本楼暂无状态（还没推演到）」、点开也是空的 ⇒ 纯占位置 ✗
    //   ⚠️ 万一老存档里真有一份落在用户层上的快照（这道闸之前造出来的）：这一行不显示了，
    //     但**数据一份都没丢** —— 时光机 / 推演记录那个频道照样列得出来 ✓
    //   ⚠️ 这一句要放在**解析前面**（用户层不该为了一次不画的渲染去解析面板文字 ✓）
    if (isUser) return null;

    // 每个对象一份，可能有多人
    const blocks = [];
    if (snap && snap.raw) {
        for (const [name, raw] of Object.entries(snap.raw)) {
            // ★★ 轻档不画（轻档不应该显示在这里）——
            //   轻档指的是"只登记了名字和种族"的对象：没有身体记录、也不参与推演。
            //   源头（拼面板文字 / 记快照）已经不收它了，但**老快照里那份还在** ⇒
            //   显示时再挡一道（判据两条，任一条命中就跳过）：
            //     ① 它现在还是轻档；
            //     ② 它那份文字整份都是占位（轻档升格之后，老快照里留下的仍是这样一份空壳，
            //        而真正的档案一定带着算出来的数，不会同时出现这两句占位 ✓）
            if (isTargetLightNow(name) || isPlaceholderPanelText(raw)) continue;
            const rows = parsePanelText(raw);
            // ★ 2026-10-26：从别的档「仅状态」导入的对象，日期属于另一条时间轴
            //   ⇒ 楼层这里也整段不显示日期（和面板 / 主 API 摘要同一个口径 ✓）
            if (rows.length) blocks.push({ name, rows, imported: isImportedTarget(name) });
        }
    }

    // ★★ 「这份状态是借来的」要写出来——
    //   这一楼**自己**没有推演记录时，`snapshotFor` 会沿用**更早那一楼**的快照
    //   （那是特意写的：状态本来就一直沿用到下一次推演 ✓）。
    //   可原来标题只要 blocks 非空就一律写「本楼状态」⇒ **看不出是借来的** ✗
    //   （我已经推演过了，仔细一比才发现和上一条一模一样 ✗）
    //   判据：借来的数据必须在**折叠行标题上**就说清 —— 光写在展开后的说明里不够，
    //   玩家常常不展开就下判断 ✓
    //   ⚠️ 楼层号沿用全插件同一个口径（`messageIndex`，跟时光机里那个「楼层 N」一致 ✓）
    const srcFloor = snap ? Number(snap.messageIndex) : -1;
    // ★★ 2026-10-23（她报的）：**同一楼里"别的候选"留下的快照也算借来的** ——
    //   原来只比楼层号，重新生成之后那一楼还挂着旧候选的快照（楼层号相同）⇒ 被当成
    //   "这一楼自己的状态"，标题写「本楼状态」、数字也是旧的 ✗
    //   ⇒ 判据改成"这条正文的指纹在快照里有没有"，没有就算没有自己的记录 ✓
    const curHash = (() => { try { return hashText(String(getChat()?.[idx]?.mes || '')); } catch { return ''; } })();
    const snapHash = String(snap?.hash || '');
    const ownRecord = !!snap && srcFloor === Number(idx) && !!snapHash && snapHash === curHash;
    const borrowed = blocks.length > 0 && !excluded && !ownRecord;
    // ★ 这一楼**自己**没有推演记录（快照是别处的 / 别的候选的、或者压根一份都没有）——
    //   补推按钮的判断用它，**不能用 `borrowed`**：一份快照都没有时 borrowed 是 false ✓
    const noOwnRecord = !excluded && !ownRecord;
    // ★ 这一楼那份敏感带明细属于哪个对象（见下面 grid 里那一行的归属说明 ✓）
    const zonesOwner = (() => { try { return String(snap?.judge?.target || ''); } catch { return ''; } })();

    // ---- 头 ----
    //
    // ★ 用户楼层不要加"是否参与推演" ——
    //   用户消息那块不需要被正式推演，放在那里也很奇怪 ✓
    //   ⇒ 玩家自己那一楼不给「参与推演」开关（他要排除的话是排除**回复**那一楼，
    //     不是排除自己说的话）。这一楼也就不需要排除标记，`⊘`/`🌸` 直接不出现 ✓
    // ★★ 定下 B 案：这里原来是**点一下取反的单按钮**（🌸 参与推演 / ⊘ 不参与推演）✗
    //   项目规矩是「布尔项做成两档两颗：两颗都看得见、选中高亮、默认那颗排最左」
    //   ⇒ 换成别处早就有的同一个控件 `.bc-modesw`（周期模式 / 身体痕迹追踪那种）✓
    //   说明（原来挂在单按钮上的后果）挪到整块上，两颗共用 ✓
    const toggleBtn = isUser ? null : h('div', {
        class: 'bc-modesw',
        title: '这一楼要不要参与状态推演。排除适合 OOC、小剧场、番外；还在排队的那次推演会一起取消，'
            + '这一楼的状态也不会再记录（想补回来要手动推演一次）',
    });
    if (toggleBtn) {
        for (const [id, label] of [['on', '参与推演'], ['off', '不参与推演']]) {
            const el = h('div', {
                class: 'bc-modesw-opt' + ((id === 'off') === excluded ? ' active' : ''),
                text: label,
            });
            el.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                applyExclude(id === 'off');     // 点的是当前那颗 ⇒ 里面直接返回（不反复重画 ✓）
            });
            toggleBtn.appendChild(el);
        }
    }

    /** ★ 排除 / 恢复的副作用都收在这一处（两颗按钮共用 ✓） */
    function applyExclude(now) {
        if (now === isFloorExcluded(idx)) return;
        setFloorExcluded(idx, now);
        // ⚠️ 重画这一楼要连"复用缓存"一起更新（见 repaintOne 里的说明）✗ 别只 replaceWith
        repaintOne(idx, isUser, btn.closest('.bc-floor'));
        if (!now) return;
        // ★ 顺手把这一次推演拦下来：
        //   「看到回复不对劲（截断、写歪了），点这颗按钮就把它拦下来」
        //   ⇒ 排队中（还在等延时）= 清掉定时器；正在跑 = 掐断请求 ✓
        //   ⚠️ 只在点的是**最后一楼**时取消 —— 排队中的那次推演本来就是为它排的，
        //     点更早的楼层不该动当前这次 ✗
        let canceled = { pending: false, running: false };
        try {
            if (idx === lastContentFloor()) canceled = cancelRun();
        } catch { /* 拿不到就只当普通排除 */ }
        if (canceled.pending) window.toastr?.info?.('这一楼已排除，还在排队的那次推演也取消了');
        else if (canceled.running) window.toastr?.info?.('这一楼已排除，正在跑的那次推演已中断（数据没写）');
        else window.toastr?.info?.('这一楼已排除，不再参与状态推演');
    }

    /** ★★ 那一颗按钮：
     *   闲时「推演这一楼」／推演中「停止推演」／排队中「取消这次推演」——
     *   词和颜色换，位置与大小不换 ⇒ 不新增控件 ✓
     *   ① 挂两种楼层（2026-10-21 放开）：
     *      · 最后一楼 —— 照旧，推演就是推它
     *      · **不是最后一楼、但自己一直没有推演记录**的那一层 ⇒ 补推
     *        （补哪层就把快照记哪层，前后楼层一概不动、也不连锁重推 ✓）
     *   ② 已排除的那一楼不挂（那一楼本来就不参与推演，挂上去自相矛盾）
     *   ③ 钥匙（`judgeHandler`）没递进来时不画 —— 别画一颗点了没反应的按钮 ✗
     *   ④ 状态从 `inp.judgeState` 拿（`floorInputs` 里读、`sameInputs` 里比 ✓） */
    const st = inp.judgeState || '';
    const backfill = !inp.isLast && noOwnRecord;      // 中间那层、自己没有记录 ⇒ 补推
    const spec = judgeBtnSpec(st, !borrowed, backfill);
    const judgeBtn = (!excluded && judgeHandler && (inp.isLast || backfill))
        ? h('div', {
            class: 'bc-floor-btn ' + (spec.action === 'cancel' ? 'bc-floor-cancel' : 'bc-floor-judge'),
            title: spec.title,
            text: spec.label,
        })
        : null;
    if (judgeBtn) {
        judgeBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            // 停止 / 取消：两个动作都是"把这一次拦下来"，**不会写任何数据** ✓
            if (spec.action === 'cancel') {
                let r = { pending: false, running: false };
                try { r = cancelRun(); } catch { /* 拿不到就什么都不做 */ }
                if (r.running) window.toastr?.info?.('这次推演已停止（一个字都不会写）');
                else if (r.pending) window.toastr?.info?.('排队中的那次推演已取消');
                // 界面怎么变**不在这里管**：`judge-queue.js` 状态一变就会喊一声，
                //   外壳那边收到之后重画这一行 + 那颗气泡（见 ui.js 的 syncJudgeState ✓）
                return;
            }
            // ★ 最后一楼 ⇒ 不传楼层（照旧那条路）；中间那层 ⇒ 把楼层号递过去 = 补推 ✓
            try { judgeHandler(backfill ? Number(idx) : null); } catch { /* 钥匙那头自己会报错 */ }
        });
    }

    // ★ 三种写法（借来的那份要写明来源，见上面 `borrowed` 那段 ✓）：
    //   · 已排除 ⇒ 说排除
    //   · 借来的 ⇒ 「本楼暂无推演记录（下面是第 N 楼的）」
    //   · 自己的 ⇒ 「本楼状态」；一份都没有 ⇒ 「本楼暂无状态（还没推演到）」
    const titleText = excluded ? '已排除，这一楼不推演'
        : borrowed ? (srcFloor >= 0 && srcFloor !== Number(idx)
            ? `本楼暂无推演记录（下面是第 ${srcFloor} 楼的）`
            : (srcFloor >= 0
                ? '本楼暂无推演记录（现在这条还没算过，下面是别的候选的）'
                : '本楼暂无推演记录（下面是沿用来的）'))
            : blocks.length ? '本楼状态'
                : '本楼暂无状态（还没推演到）';

    const title = h('span', { class: 'bc-floor-title', text: titleText });

    const btn = h('div', { class: 'bc-floor-btn bc-floor-fold', title: '展开 / 收起这一楼的状态' },
        h('span', { class: 'bc-floor-arrow', text: '▸' }),
        title,
    );

    const bar = h('div', { class: 'bc-floor' + (excluded ? ' off' : ''), 'data-bc-floor': String(idx) },
        h('div', { class: 'bc-floor-head' }, toggleBtn, judgeBtn, btn),
    );
    // ★ 日夜 / 易读两档自己带上（见 `floorLookAttrs` 顶上那段说明 ✓）
    {
        const look = floorLookAttrs();
        bar.dataset.theme = look.theme;
        bar.dataset.vision = look.vision;
    }

    // ---- 身体 ----
    const body = h('div', { class: 'bc-floor-body' });

    // ★ 借来的状态：折叠行那句只说了"有借"，这里说清"借的谁的"（见上面 `borrowed` ✓）
    if (borrowed) {
        body.appendChild(h('div', { class: 'bc-floor-empty', text: (srcFloor >= 0 && srcFloor !== Number(idx))
            ? `这一楼自己还没有推演记录，下面显示的是第 ${srcFloor} 楼推演完时留下来的状态（状态本来就是一直沿用到下一次推演）`
            : (srcFloor >= 0
                ? '这一楼自己还没有推演记录：现在这条正文还没算过，下面显示的是同一楼别的候选算出来的那份'
                : '这一楼自己还没有推演记录，下面显示的是沿用来的状态') }));
    }

    // ★ 一层里放了多个候选回复（备选回复）时的**实话实说**：
    //   旧的某一楼切候选时不重算、不动数据，只在界面上写清楚 ✓
    //   判据：这一楼现在这条候选**有没有自己的记录**（用正文指纹认 ✓）
    //   ⚠️ 和"重新生成"不是一回事：重新生成 = 酒馆先把那一楼删掉再生成新的，
    //     那一楼的旧记录直接作废（别把这两件事混起来 ✗）
    //   ⚠️ 这几个判据已经在 `floorInputs()` 里算好了（第二刀之后取数只有那一处）✓
    if (inp.hasCur && inp.swipeN > 1 && !inp.own && inp.anyOther) {
        body.appendChild(h('div', { class: 'bc-floor-empty', text:
            `这一楼有 ${inp.swipeN} 个候选回复；现在这条还没有推演记录，下面显示的是别的候选算出来的。切候选不会重算；要按现在这条重算，就在最后一楼那颗「推演这一楼」` }));
    }

    for (const b of blocks) {
        if (blocks.length > 1) body.appendChild(h('div', { class: 'bc-floor-name', text: '■ ' + b.name }));
        const grid = h('div', { class: 'bc-floor-grid' });
        for (const r of b.rows) {
            const val = stripLeadLabels(r.key, r.value);
            grid.appendChild(h('div', { class: 'bc-floor-cell' },
                h('span', { class: 'bc-floor-key', text: FIELD_CN[r.key] || r.key }),
                h('span', { class: 'bc-floor-val', text: b.imported ? stripDateText(val) : val }),
            ));
        }
        // ★ 2026-10-16（能不能改成在面板上写哪个加了几）——
        //   敏感带那一行只写累计次数，看不出"这一轮加了多少" ⇒ 在它下面补一行插件算的增量。
        //   ⚠️ 归属：这份明细按对象存（`snap.judge.target`）⇒ 多对象时只挂在该对象那一块上；
        //      老快照没记 target ⇒ 只有一块时就显示 ✓
        if (inp.zonesDelta && (zonesOwner ? zonesOwner === b.name : blocks.length === 1)) {
            grid.appendChild(h('div', { class: 'bc-floor-cell' },
                h('span', { class: 'bc-floor-key', text: FIELD_CN.zonesDelta }),
                h('span', { class: 'bc-floor-val', text: inp.zonesDelta }),
            ));
        }
        body.appendChild(grid);
    }
    if (!blocks.length) {
        body.appendChild(h('div', { class: 'bc-floor-empty', text: excluded ? '（这一楼不参与推演）' : '（还没有推演到这一楼）' }));
    }
    bar.appendChild(body);

    let open = false;
    btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        open = !open;
        bar.classList.toggle('open', open);
        btn.querySelector('.bc-floor-arrow').textContent = open ? '▾' : '▸';
    });

    return bar;
}

/**
 * 只重画这一楼（排除状态刚被翻过来时用）。
 *
 * ⚠️⚠️ 必须**顺手把复用缓存更新掉**：第二刀之后 `paintAll()` 会拿缓存里的输入跟现在的比，
 *   如果这里只 replaceWith、不更新缓存，下一次 paintAll 就会认为"这一楼没变"而跳过它
 *   ⇒ 界面停在**翻转前**的状态（数据是对的、界面是旧的，最难查 ✗）
 */
function repaintOne(idx, isUser, node) {
    let inputs = null;
    try { inputs = floorInputs(idx, isUser); } catch { inputs = null; }
    const fresh = buildPanel(idx, isUser, inputs);
    // ⚠️ buildPanel 可能返回 null（用户层没状态 ⇒ 整行不画）——
    //   无条件 `replaceWith(fresh)` 传 null 会当场抛 ✗ ⇒ 改成"该画才画、
    //   不画就把旧的摘掉"，并且缓存只在真的画了时才记 ✓
    if (fresh) { if (node && node.parentNode) node.replaceWith(fresh); }
    else if (node && node.parentNode) node.remove();
    if (inputs && fresh) _floorInputs.set(idx, { idx, isUser, inputs });
    else _floorInputs.delete(idx);
    return fresh;
}

function paintAll() {
    if (!enabled) return;
    const nodes = document.querySelectorAll('#chat .mes');
    const seen = new Set();
    for (const node of nodes) {
        const idx = Number(node.getAttribute('mesid'));
        if (!Number.isInteger(idx)) continue;

        // ⚠️ 以前「无限增殖」的 bug：往 .mes_block 里塞，却在 .mes 底下找。
        //   现在改成「在哪个容器里塞，就在哪个容器里找」。
        const host = node.querySelector(':scope > .mes_block') || node;
        const found = host.querySelectorAll(':scope > .bc-floor');
        // 保险：历史版本可能已经塞了多个，顺手清掉多余的
        for (let k = 1; k < found.length; k++) found[k].remove();

        // 玩家自己那一楼：不给「参与推演」开关（见 buildPanel 里的说明）
        //
        // ⚠️⚠️ 修（报障：我自己发的那一楼也出现了参与推演这颗开关）：
        //   真正的根因是**判断方式用错了** —— 酒馆**从来不给 `.mes` 加 `is_user` 这个类**，
        //   它只写**属性** `is_user="true"` / `"false"`：
        //     · 消息模板：`public/index.html` 里 `<div class="mes" mesid="" ch_name="" is_user="" is_system="" ...>`
        //     · 赋值处：`public/script.js` 的 `messageElement.attr({ 'is_user': mes.is_user, ... })`
        //     · 酒馆自己的 `style.css` 里搜 `is_user` **零命中**（它用的是属性选择器 `.mes[is_user="true"]`）
        //   所以原来那句 `node.classList.contains('is_user')` **永远返回 false**
        //   ⇒ 每一楼（包括用户自己发的）都被当成"角色楼"，那颗开关就全都画上了 ✗
        //   （对照：本项目的 `st.js` 一直用的是属性写法 `.mes[is_user="true"]` ⇒ 只有这里写错 ✓）
        //   ⇒ 属性优先；类名一并认着，万一某个主题/版本真的加了类也不会退回去 ✗
        const isUser = node.getAttribute('is_user') === 'true' || node.classList.contains('is_user');
        seen.add(idx);

        // ★★ 第二刀：**输入没变就直接跳过**（省掉解析 + 上百个元素的重建）✓
        //   三个前提缺一不可：
        //     ① 这一楼的面板**还在 DOM 里**、而且**就是这个楼层**的
        //        （酒馆重建过消息节点 / 楼层号被挪过 ⇒ 必须重画 ✗）
        //        ⚠️ 用户层没有状态时**本来就不该有面板**（buildPanel 返回 null）⇒
        //        那种楼层"DOM 里没有"才是正常状态，不进这个前提，照常往下走 ✓
        //     ② 输入算得出来（算不出来就老老实实重画，别拿"没变"当结论）
        //     ③ 输入和上次画的时候一样
        let inputs = null;
        try { inputs = floorInputs(idx, isUser); } catch { inputs = null; }
        const prev = _floorInputs.get(idx);
        if (found.length && inputs && prev && prev.idx === idx && prev.isUser === isUser
            && Number(found[0].getAttribute('data-bc-floor')) === idx
            && sameInputs(prev.inputs, inputs)) continue;

        // ★ buildPanel 可能返回 null（用户层没状态 ⇒ 整行不画）⇒
        //   那种楼层连"上次画的缓存"一起清掉，别让下一次以为它还在 DOM 里 ✗
        const fresh = buildPanel(idx, isUser, inputs);
        if (fresh) {
            if (found.length) found[0].replaceWith(fresh);
            else host.appendChild(fresh);
        } else if (found.length) {
            found[0].remove();
        }
        if (inputs && fresh) _floorInputs.set(idx, { idx, isUser, inputs });
        else _floorInputs.delete(idx);
    }
    // 这一轮没看到的楼层（删楼 / 换聊天）⇒ 把记录扔掉：
    // 下标会被后面的楼层复用，留着旧输入就可能把"该画的"当成"没变"而跳过 ✗
    for (const k of [..._floorInputs.keys()]) if (!seen.has(k)) _floorInputs.delete(k);
}

function schedulePaint() {
    if (!bound) return;
    clearTimeout(timer);
    timer = setTimeout(paintAll, 60);
}

function removeAll() {
    for (const el of document.querySelectorAll('#chat .bc-floor')) el.remove();
    // DOM 都没了 ⇒ 复用缓存一起清（不然下一次会以为"这一楼还画着"✗）
    _floorInputs.clear();
}

/**
 * 打开 / 关闭楼层面板。
 * 由 ui.js 的 syncPresentation 决定传什么 —— 也就是
 * 「在聊天里 && 呈现方式不是只用悬浮窗」的时候才开。
 *
 * ⚠️ 之前这里只调 schedulePaint()，而它开头有一句 `if (!bound) return`。
 *   bound 是 mountFloors 里设的，只要酒馆没给出 eventSource 就一直是 false ——
 *   结果「插进聊天里」这个功能**从头到尾一次都没画出来过**。
 *   现在打开时直接画一次，事件监听只是「之后有变化再补一下」。
 */
export function applyFloorPanel(on) {
    const next = !!on;

    // ⚠️ syncPresentation 每次刷新都会调这里，而刷新是被定时器高频触发的。
    //   如果每次都重建，鼠标悬停的高亮状态会被反复清掉 —— 看起来就是「一直在闪」。
    //   所以**状态没变就什么都不做**，只有开关真的翻转时才重画。
    if (next === enabled) {
        if (!next) removeAll();
        return;
    }

    enabled = next;
    if (!enabled) {
        removeAll();
        return;
    }
    // 不等防抖，立刻画一次
    clearTimeout(timer);
    paintAll();
    // 再补一次：有些主题/扩展会在渲染完之后再插一次消息节点
    timer = setTimeout(paintAll, 120);
}

/** 酒馆给不给事件系统都能用，没事件就在需要的时候手动补画 */
export function mountFloors(ctx) {
    if (bound) { schedulePaint(); return; }
    const es = ctx?.eventSource;
    const et = ctx?.eventTypes;
    // ★ **拿到事件源才置 `bound`** ——
    //   以前先 `bound = true` 再判断 ⇒ 第一次调用没拿到 eventSource 的话，
    //   以后就算拿到了也**永远不会绑**那 7 个事件（只剩 resize / visibilitychange 补画）✗
    if (!es || !et) {
        console.warn('[Bodycord] 拿不到酒馆事件系统，楼层面板改成按需重画');
        schedulePaint();
        return;
    }
    bound = true;

    const watch = [
        'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_RECEIVED',
        'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED',
        'MESSAGE_DELETED', 'CHAT_CHANGED', 'GENERATION_ENDED',
    ];
    // ★ 重新生成 / 新出一楼时，酒馆是「先删楼、再生楼」，而上面这些事件常常
    //   **早于新节点的 mesid 挂好** —— 那一刻 paintAll 扫不到这一楼（Number(null) 不是整数，
    //   直接 continue），之后又没有事件再来 ⇒ 这一楼的面板（含「推演这一楼」那颗按钮）
    //   就永远不出现。报：重新生成之后推演的按键会消失就是这个时序。
    //   ⇒ 每个事件都**再补一次延迟重画**：420ms 之后节点肯定挂好了，paintAll 又是幂等的 ✓
    let lateTimer = 0;
    const repaintSoon = () => {
        schedulePaint();
        clearTimeout(lateTimer);
        lateTimer = setTimeout(() => {
            if (!enabled) return;
            try { paintAll(); } catch { /* 忽略：补画失败不该影响数据 */ }
        }, 420);
    };
    for (const key of watch) {
        const name = et[key];
        if (typeof name === 'string' && name) es.on(name, repaintSoon);
    }

    // 兜底：切标签页或窗口尺寸变了补一次。
    // 注意**不要监听 scroll** —— 滚动时重建所有楼层面板会让它们跟着页面抖。
    document.addEventListener('visibilitychange', schedulePaint);
    window.addEventListener('resize', schedulePaint);

    if (enabled) paintAll();
}

// 死代码清理：原来的 `unmountFloors()` 全仓无调用点（ui.js 只 import 过、从没用）
//   ⇒ 删掉 ✓。⚠️ 以后真要加"卸载楼层面板"，别只照抄原来那几行 —— 它只摘了 document/window
//   两个监听，**eventSource 上那 7 个 `es.on(name, schedulePaint)` 一个都没摘** ✗
//   （eventemitter3 允许重复注册 ⇒ 卸载后再挂一次就会有第二份 schedulePaint 在跑）

/**
 * 时光机那几颗按钮（重推 / 撤销这次推演 / 回滚 / 撤销回滚）改完账之后，手动补画一次楼层面板。
 *
 * ⚠️ 不能直接复用 schedulePaint：它开头有 `if (!bound) return`，
 *   而酒馆没给出 eventSource 时 bound 永远是 false ⇒ 一次都不画 ✗
 *   （同一个坑在 applyFloorPanel 上面那段注释里写过 ✓）
 * ⚠️ 为什么必须有它（撤销推演之后楼层不实时刷新）：
 *   那几颗按钮改的是**快照与账本**，走的是时光机自己的 redraw()，
 *   而楼层面板只跟着酒馆那 7 个消息事件重画 ⇒ 消息没变就一次都不会重画，
 *   界面停在撤销之前的样子（数据其实已经对了，最难查 ✗）
 */
export function repaintFloors() {
    if (!enabled) return;
    clearTimeout(timer);
    try { paintAll(); } catch { /* 忽略：补画失败不该影响数据 */ }
}

export { schedulePaint as refreshAllFloors };
