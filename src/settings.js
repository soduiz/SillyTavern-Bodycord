/**
 * settings.js —— 全局设置（跟着酒馆设置走，所有聊天共用）
 * 每个聊天的「状态数据」不在这里，在 store.js（按聊天独立）。
 */

import { MODULES } from './modules.js';
import { normalizeCalendar } from './fiction-date.js';
import { getExtensionSettings, saveSettings } from './st.js';
// ★ 对象专属补丁**按聊天存** ⇒ 从 store 读 / 写。
//   ⚠️⚠️ 这里和 store.js 是**互相 import**（store 要用 settings 的全局三态、settings 要读按聊天的补丁）
//      ⇒ 这是一个**模块环**。环本身没问题（两边都只在**函数体**内碰对方 ✓），
//        但有一条铁律：**不许在本文件的顶层读 store 导出的 `const`** ✗
//        （函数声明会被提升 ⇒ 顶层写 `import { f }` 再在函数里调是安全的 ✓；
//          `const` 在顶层读会 `Cannot access 'X' before initialization` ✗
//          ⇒ 现在顶层只剩 import，其它一律放到函数里 ✓）
//      ⇒ 真违反了会被测试当场抓到（自测脚本的第一个 import 链就走到这里 ✓）
import { isUserKey, targetPatchText, targetPatchBag, setTargetPatchText, state, USER_KEY, periodModeOf, traceOnOf, timeUnitNow, MAX_CAL_EVENTS_PER_DAY } from './store.js';
// ★ 日程那一套纯逻辑（排序 / 那行字 / 空壳子判定 / 改一格的校验）——
//   现实日历这份跟**聊天里那份**共用一份 ✓（两份迟早走样 ✗）
//   ⚠️ 这个文件是**叶子** ⇒ 放在 import 链上不会造环 ✓
import { calEvId, calEvOn, calEvApply, calEvCard, calEvForPanel, calEvPrune, calEvSort, calEvLabel, calEvFilled, calEvRemindOn, deviceDateKey, parseDeviceDate } from './calendar-events.js';
// ★ 农历那份 —— 节日表里 `lunar` 那格的**写法**只在这一处认：
//   `MM-DD`（农历几月初几）/ `MM-LAST`（那个农历月的最后一天，除夕就是 `12-LAST` ✓）
//   ⚠️ 它也是**叶子**（不 import 任何东西 ✓）⇒ 不会造环 ✓
import { normalizeLunarSpec } from './lunar.js';

export const KEY = 'bodycord';

export const TARGET_MODES = {
    user:  '仅追踪 {{user}}',
    single:'仅追踪指定的一位角色',
    multi: '追踪指定的多位角色',
    // ⚠️ 标签不能按性别写（例如「自动追踪所有某个性别的角色」）—— 代码**没有性别判据**
    //   （`upsertTargetResult` 只看 targetMode / autoCreateTargets），而挑人的条件在**提示词**里
    //   （`judge.js` 的【自动追踪提示】："新出现的角色、且该角色的身体状态值得建档追踪" ✓）
    //   ⇒ 标签和说明一律写「新角色 / 追踪对象」，不提性别 ✓
    //   （挑人的条件在设置页「推演设置」的「？」里说清，并说明能用「额外规则」改口径 ✓）
    auto:  '自动追踪新出现的角色',
};

// ---------------------------------------------------------------------------
// 可自定义的图标槽位
//
// 面板里的消息块头像是「一圈渐变 + 一个内联 SVG」（`.block-avatar.xxx`），
// 侧栏频道图标是 .channel-item .hash 里的内联 SVG。
// 都不改面板的 JS —— 直接用注入 CSS 把背景换成图片、把 SVG 藏起来。
// ---------------------------------------------------------------------------
export const ICON_SLOTS = [
    // ★★ 这格的标签只叫「BOT」说不清它到底是哪个头像 ✗ ⇒
    //   `bot` 是**代码里的类名**（`.block-avatar.bot`），它管的是面板里**共用同一种头像的
    //   那几块消息**：最近一次推演 / 提醒 / 谁干的好事 / 致孕方锁定 / 状态笔记 / 意识状态。
    //   有单独一格的（透视 / 胎儿动态 / 生理监测 …）**不受它影响** ⇒ 标签不许再叫「BOT」✗
    //   （详细是哪几块写在设置页那张卡的「？」里 ✓）
    { key: 'bot',      label: '通用消息头像',   group: '面板头像', def: 'linear-gradient(135deg,#5a65f0,#7a72f5)' },
    { key: 'astro',    label: '占卜台',         group: '面板头像', def: 'linear-gradient(135deg,#8b5cf6,#c9922c)' },
    { key: 'fetus',    label: '胎儿动态',       group: '面板头像', def: 'linear-gradient(135deg,#ec5b9a,#e5487a)' },
    { key: 'zone',     label: '敏感带',         group: '面板头像', def: 'linear-gradient(135deg,#9b5cf0,#7a4de8)' },
    { key: 'period',   label: '生理监测',       group: '面板头像', def: 'linear-gradient(135deg,#ec5b9a,#e5487a)' },
    { key: 'pin',      label: '置顶消息',       group: '面板头像', def: 'linear-gradient(135deg,#e5a41f,#e58d1f)' },
    { key: 'music',    label: '音乐',           group: '面板头像', def: 'linear-gradient(135deg,#14b8a6,#0891b2)' },
    { key: 'notes',    label: '随手记',         group: '面板头像', def: 'linear-gradient(135deg,#e5a41f,#c9922c)' },
    // ★「透视」：发阶段插图的那个 BOT ✓
    //   ⚠️ 默认渐变必须和面板里 `.block-avatar.xray` 那一行**一模一样**（改一处要改两处 ✗）
    { key: 'xray',     label: '透视',           group: '面板头像', def: 'linear-gradient(135deg,#3aa6c9,#5a65f0)' },

    { key: 'ch:overview',  label: '概览',     group: '侧栏频道', view: 'overview' },
    // ⚠️ `ch:period`（生理监测频道图标）**没有图标格** —— 那个频道已并回概览 ✓
    //   那个频道不在侧栏里，留一格图标就成了"给不存在的东西换图"✗
    //   （「面板头像」里的 `period` 那一格**照旧保留** ✓ —— 生理那块消息还在概览里发）
    { key: 'ch:fetus',     label: '胎儿动态', group: '侧栏频道', view: 'fetus' },
    // ★ 新频道「透视」——一整页只画那张插画 ✓
    { key: 'ch:stage',     label: '透视',     group: '侧栏频道', view: 'stage' },
    { key: 'ch:zones',     label: '敏感带',   group: '侧栏频道', view: 'zones' },
    { key: 'ch:dice',      label: '骰子',     group: '侧栏频道', view: 'dice' },
    { key: 'ch:calc',      label: '占卜台',   group: '侧栏频道', view: 'calc' },
    { key: 'ch:localmusic',label: '本地点播', group: '侧栏频道', view: 'localmusic' },
    { key: 'ch:netease',   label: '小云台',   group: '侧栏频道', view: 'netease' },
    { key: 'ch:notes',     label: '随手记',   group: '侧栏频道', view: 'notes' },
    // ★「孩子」频道
    { key: 'ch:children',  label: '孩子',     group: '侧栏频道', view: 'children' },
    // ★ 番茄钟也像别的功能一样有**两块**头像：
    //     ① `timer`  ⇒ 面板里那块「番茄钟」消息块的头像（`assets/bodycord.html` 里 `.block-avatar.timer`）
    //     ② `ch:timer` ⇒ 收起时图标栏里「番茄钟」那颗频道图标（`data-view="timer"`）
    //   ⚠️ 番茄钟那颗**悬浮球**的头像不在这儿 —— 它跟着「悬浮球头像」那张卡里的第二项走
    //      （`settings().timer.ballImage`，见 `ui-settings.js` 的 `fabAvatarSection` ✓）
    // ★ BOT 和侧边栏头像看起来像属于番茄钟 ✗ ⇒ 这两块的 `group` 用 **'番茄钟头像'**
    //   ⇒ 页面上单独成一张卡，不再混在别人的列表里 ✓
    // ★ 两行都叫「番茄钟」根本分不清谁是谁 ✗
    //   ⇒ 标签里写清它占在哪儿（面板 BOT / 侧栏频道）✓
    { key: 'timer',        label: '番茄钟 · 面板消息头像',  group: '番茄钟头像', def: 'linear-gradient(135deg,#bc4a4e,#2d7a4f)' },
    { key: 'ch:timer',     label: '番茄钟 · 侧栏频道',  group: '番茄钟头像', view: 'timer' },
];

/**
 * 把骰子相关设置恢复成默认值。
 * 只动 dice 这一块，别把接口 / 追踪对象 / 图标一起清了。
 */
export function resetDiceDefaults() {
    const s = settings();
    const d = DEFAULT_SETTINGS.dice;
    s.dice = JSON.parse(JSON.stringify(d));
    save();
    return true;
}

/** 取自定义图标表（只保留非空项） */
export function customIcons() {
    const raw = settings().icons || {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
}

/** 设置 / 清除某个槽位的自定义图标 */
export function setCustomIcon(key, url) {
    const s = settings();
    if (!s.icons || typeof s.icons !== 'object') s.icons = {};
    const v = String(url || '').trim();
    if (v) s.icons[key] = v;
    else delete s.icons[key];
    save();
}

// ---------------------------------------------------------------------------
// ★ 插件 API：**多套**（每条一套渠道，列表 + 弹窗编辑）
//
// 形态：可多套 —— 可以存多个 API、可以编辑备注，
//   但**不照抄别人的样子，因为我们有自己的风格** ✓
//   ⇒ **取代原来那套扁平字段**（整块换形态，不是并存 ✓）
//   ⇒ 名字**直接沿用「插件API」**，没必要另想 ✓
//   ⇒ 预设导入**不做** ✓（预设那块**不跟渠道走**）
//
// ⚠️ 两件不许动的事：
//   ① **地址 / 密钥 / 模型三格只由玩家自己填**，新建一套时**一律留空** ✗
//      （**不主动去填写接口地址** ✓ 绝不预填 ✓）
//   ② 老存档里那一套（扁平字段）要**原样搬成第一套**，一个字段都不能丢 ✓
// ---------------------------------------------------------------------------

/** 一套渠道的字段（顺序 = 界面上的顺序 ✓） */
export const API_FIELDS = [
    'baseUrl', 'apiKey', 'model', 'temperature', 'maxTokens', 'timeoutSec',
    'jsonMode', 'noThink', 'extraHeaders', 'extraBody', 'apiMode',
];

/**
 * ★ 渠道的「请求怎么发」三档（顺序＝出厂那档在最左 ✓）。
 *
 * 起因：火山方舟这类接口**不给跨域头**，而插件的请求是浏览器直发的
 *   ⇒ 浏览器直接把请求拦下（Failed to fetch / CORS），服务商那边根本没收到 ✗
 * 解法：让插件的请求改走**酒馆自己的服务器端转发**（`/api/backends/chat-completions/generate`），
 *   由酒馆服务器发出去 ⇒ 没有跨域这回事 ✓（详见 api.js 的 chatViaTavern）
 * ⚠️ 走酒馆后端时，**密钥会随请求体交给本机酒馆服务器** ⇒ 所以给手动档，别偷偷换路 ✓
 */
export const API_MODES = [
    ['auto', '自动（直连优先，被跨域拦了改走酒馆后端）'],
    ['direct', '只用直连'],
    ['backend', '只用酒馆后端转发'],
];

/** 读一条渠道的请求方式（认不出的值 ⇒ 回出厂那档 ✓） */
export function apiModeOf(cfg) {
    const v = String((cfg && cfg.apiMode) || '').trim();
    return API_MODES.some(([id]) => id === v) ? v : 'auto';
}

/**
 * ★ 「超时」这格是**秒**（界面那格写「超时（秒）」✓）
 *   —— 老存档里的值（毫秒，比如 120000）要换算成秒（120）；
 *   **换算完就把老键 `timeout` 删掉** ⇒ 以后没有老键可换、这段跑了等于没跑
 *   （所以它跑几次结果都一样，绝不会把玩家自己填的秒数再除一次 1000 ✓）。
 */
function takeLegacyTimeoutMs(row) {
    if (!row || row.timeout === undefined || row.timeout === null) return;
    const ms = Number(row.timeout);
    if (Number.isFinite(ms) && ms > 0) row.timeoutSec = Math.max(1, Math.round(ms / 1000));
    delete row.timeout;
}

/** 出厂的一套：三格**刻意留空**（地址各人各样，预填反而让人忘改 ✓） */
function blankApi(name) {
    return {
        id: 'api' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        name: String(name || '渠道 1'),
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.6,
        // ★ 最大 token 默认跟常见服务商那套对齐（最大 TOKEN 拉到和别人一样 ✓）
        //   ⚠️ 某个服务商嫌大就在那条渠道的弹窗里改小（改起来现在很便宜 ✓）
        maxTokens: 65535,
        // ★ 超时 180 秒（老存档里的毫秒值会在这儿换算成秒 ✓）
        //   契约 + 模块文案一起发过去，慢一点 / 带思考的模型留点余量 ✓
        timeoutSec: 180,
        jsonMode: true,
        // ★★ 关闭模型原生思考 —— 出厂**默认就关掉原生思考**：
        //   我们的契约本来就强制它把推理**分点写进 cot** ⇒ 模型自带的思考是
        //   **同一件事做两遍** ✗（实测那一轮输出 7679 里有 7025 全是思考）
        //   ⇒ 默认勾上，省的就是这一块 ✓
        //   ⚠️ 接口不认这个写法（严格的接口会回 400）时：`api.js` 会**去掉它再发一次**，
        //     并在推演状态里记一笔 ⇒ 不会因为玩家勾了这个开关就跑不动 ✓
        //   ⚠️ 只走"直连"这条路带得过去 —— 走酒馆后端转发时请求体是酒馆自己重拼的
        //     （源码核过）⇒ 那时这一项不生效（界面上那句说明写了 ✓）
        noThink: true,
        extraHeaders: '',
        extraBody: '',
        // ★ 请求方式：出厂「自动」= 先直连，被跨域拦了才改走酒馆后端 ✓
        apiMode: 'auto',
    };
}

/**
 * 老存档 → 新形态（**纯函数**，好单测 ✓）。
 * 老形状：`api` 上直接挂着 baseUrl / apiKey / model / …（单套）
 * 新形状：`api.list = [那套]` + `currentId`；presetName / presetEntries 留在上层 ✓
 */
export function normalizeApi(api) {
    const a = (api && typeof api === 'object') ? api : {};
    const keepPreset = { presetName: String(a.presetName || ''), presetEntries: (a.presetEntries && typeof a.presetEntries === 'object') ? a.presetEntries : {} };
    const mode = String(a.mode || 'own');
    if (Array.isArray(a.list)) {
        // 已经是新形状：只补结构 + 字段类型，别动玩家的值 ✓
        a.list = a.list.filter((x) => x && typeof x === 'object').map((x, i) => {
            const row = { ...blankApi(String(x.name || ('渠道 ' + (i + 1)))), ...x };
            row.name = String(row.name || ('渠道 ' + (i + 1)));
            return row;
        });
        if (!a.list.length) a.list = [blankApi('渠道 1')];
    } else {
        // 老形状 ⇒ 整体搬成第一套（一个字段都不丢 ✓）
        const first = blankApi('渠道 1');
        for (const k of API_FIELDS) {
            const v = a[k];
            if (v !== undefined && v !== null && !(typeof v === 'string' && v === '')) first[k] = v;
        }
        // ⚠️ 地址 / 密钥 / 模型：老存档里就算是空串也照搬（不预填任何东西 ✓）
        for (const k of ['baseUrl', 'apiKey', 'model']) {
            if (typeof a[k] === 'string') first[k] = a[k];
        }
        // ⚠️ 「超时」的**老键是毫秒**、而且它已经不在 `API_FIELDS` 里了
        //   ⇒ 上面那个循环搬不到它，这里单独搬一下、再让下面的换算把它变成秒 ✓
        if (a.timeout !== undefined && a.timeout !== null) first.timeout = a.timeout;
        a.list = [first];
    }
    // ★ 老存档的「超时」是毫秒 ⇒ 换算成秒（换算完老键就没了 ⇒ 幂等 ✓）
    a.list.forEach(takeLegacyTimeoutMs);
    // 当前那套：指不到就退回第一套 ✓
    if (!a.currentId || !a.list.some((x) => x.id === a.currentId)) a.currentId = a.list[0].id;
    a.mode = mode;
    a.presetName = keepPreset.presetName;
    a.presetEntries = keepPreset.presetEntries;
    // 老形状那些扁平字段留一份也不再用了 ⇒ 清掉（免得两处各有一份、不知道读哪个 ✗）
    for (const k of API_FIELDS) delete a[k];
    delete a.timeout;   // 老键（毫秒那个）也清掉 ✓
    return a;
}

/** 渠道表（读的时候顺手迁移 / 补齐 ✓） */
export function apiList() {
    const s = settings();
    if (!s.api || typeof s.api !== 'object') s.api = {};
    normalizeApi(s.api);
    return s.api.list;
}

/** **正在使用**的那一套（所有请求都读它 ✓） */
export function currentApi() {
    const s = settings();
    const list = apiList();
    return list.find((x) => x.id === s.api.currentId) || list[0];
}

/** 切到某一套（切不动就原样返回 false ✓） */
export function setCurrentApi(id) {
    const s = settings();
    if (!apiList().some((x) => x.id === id)) return false;
    s.api.currentId = id;
    save();
    return true;
}

/** 新建一套（**三格一律留空**，名字给「渠道 N」✓） */
export function addApi(name) {
    const s = settings();
    const list = apiList();
    const row = blankApi(String(name || ('渠道 ' + (list.length + 1))));
    list.push(row);
    s.api.currentId = row.id;      // 新建完就直接用它（玩家接下来要填的就是它 ✓）
    save();
    return row;
}

/** 改一套里的字段（只认白名单里的键 ✓；`name` 也能改 ✓） */
export function updateApi(id, patch = {}) {
    const row = apiList().find((x) => x.id === id);
    if (!row) return false;
    for (const [k, v] of Object.entries(patch)) {
        if (k !== 'name' && !API_FIELDS.includes(k)) continue;
        row[k] = v;
    }
    if (!String(row.name || '').trim()) row.name = '未命名';
    save();
    return true;
}

/** 删一套（**至少留一条** ✗ 删空了插件就没接口可用了） */
export function removeApi(id) {
    const s = settings();
    const list = apiList();
    if (list.length <= 1) return false;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    if (s.api.currentId === id) s.api.currentId = list[0].id;
    save();
    return true;
}

/** 现在有几套（诊断报告 / 设置页读数用 ✓） */
export function apiCount() { return apiList().length; }

// ---------------------------------------------------------------------------
// ★ 阶段插图
//
// 总开关 + 每个状态一张图（图地址为空 = 面板显示**文字版** ✓）。
// ⚠️ 图**只存地址**、不存 base64 —— 一张插画塞进设置会把设置文件撑爆 ✗
//   （上传走酒馆的图片库，见 notes-image.js 的 uploadImageFile ✓）
// ⚠️ 默认**开**；没有图的时候显示文字版，
//   所以新装的玩家也不会看到一块空白 ✓
// ---------------------------------------------------------------------------

/** 阶段插图的配置块（读的时候顺手补齐结构 + 迁移老存档 ✓） */export function stagesCfg() {
    const s = settings();
    if (!s.ui || typeof s.ui !== 'object') s.ui = {};
    if (!s.ui.stages || typeof s.ui.stages !== 'object') s.ui.stages = { on: true, images: {}, text: {} };
    const c = s.ui.stages;
    if (typeof c.on !== 'boolean') c.on = true;
    // ★ 图**按周期档分两套**：
    //   非月经那一档留空 ⇒ 回落到有月经那套（见 stages.js 的 stageImageOf ✓）
    //   ⚠️ 迁移：老存档里是**扁平**的 `images = { egg: url }`（不分档）⇒ 那种老形状
    //     整体搬进 `images.normal`（只有一套图时等于是有月经那一档 ✓）
    if (!c.images || typeof c.images !== 'object' || Array.isArray(c.images)) c.images = {};
    const flatKeys = ['daily', 'egg', 'sperm_only', 'sperm_egg', 'fertilized', 'implanted'];
    if (flatKeys.some((k) => typeof c.images[k] === 'string')) {
        const moved = {};
        for (const k of flatKeys) {
            if (typeof c.images[k] === 'string' && c.images[k].trim()) moved[k] = c.images[k];
            delete c.images[k];
        }
        c.images.normal = { ...(c.images.normal || {}), ...moved };
    }
    for (const m of ['normal', 'none', 'amenorrhea']) {
        if (!c.images[m] || typeof c.images[m] !== 'object' || Array.isArray(c.images[m])) c.images[m] = {};
    }
    // ★★ 2026-10-18：`uterus_*` 是**旧版**（底图＝子宫）那套键 —— 现在永不再读
    //   ⇒ 一次性清掉（不然"已经填了 N 张图"读数一直把这 6 个算进去，而新界面里
    //     玩家根本点不到它们 ✗；玩家清理图片库时删了文件、地址还留着，也会变成破图）
    for (const m of ['normal', 'none', 'amenorrhea']) {
        const bag = c.images[m];
        if (!bag || typeof bag !== 'object') continue;
        for (const k of Object.keys(bag)) if (k.startsWith('uterus_')) delete bag[k];
    }
    // ★ 玩家改过的插图文字（只存改过的那几条 ✓）—— 两档各一份
    if (!c.text || typeof c.text !== 'object' || Array.isArray(c.text)) c.text = {};
    return c;
}

/** 阶段插图开着没有（默认开 ✓） */
export function stagesOn() { return stagesCfg().on !== false; }

export function setStagesOn(v) { stagesCfg().on = !!v; save(); }

/**
 * ★ 「只显示文字」那一档开着没有（默认关 = 有图就给图 ✓）。
 *
 * 为什么要它（内置图一直有，文字版就永远不生效，除非单独给文字版一个开关）✓：
 *   内置图一直有 ⇒ 不切的话**文字版永远不会生效** ✗ ⇒ 给它一颗开关：
 *   打开时外壳**不发图**（`stagesForPanel` 里 image 留空、层给空）⇒ 面板照它原来的规矩走文字版 ✓
 */
export function stageTextOnly() { return stagesCfg().textOnly === true; }
export function setStageTextOnly(v) { stagesCfg().textOnly = !!v; save(); }

/**
 * ★★ 的最终要求（连纠两轮）：**共用一套开关是错的**，要每一档各自独立的开关判定
 *   （问题不在共享，而是每档得能单独判定）——
 *   每档各有自己的「借不借」和「借哪一档」✓；方向/选法沿用原来的（除自己外任选一档），
 *   玩家**没有要求**定死方向链，别自作主张 ✗
 *   默认每档都关 = 只用自己填的图 ✓
 */
const STAGE_MODES = ['normal', 'none', 'amenorrhea'];

function borrowCfg(mode) {
    const c = stagesCfg();
    const m = STAGE_MODES.includes(mode) ? mode : 'normal';
    if (!c.borrowByMode || typeof c.borrowByMode !== 'object' || Array.isArray(c.borrowByMode)) c.borrowByMode = {};
    const b = c.borrowByMode[m];
    if (!b || typeof b !== 'object' || Array.isArray(b)) c.borrowByMode[m] = { on: false, from: 'normal' };
    const out = c.borrowByMode[m];
    if (typeof out.on !== 'boolean') out.on = false;
    if (!STAGE_MODES.includes(out.from)) out.from = 'normal';
    return out;
}

/** 这一档的借用开着没有 */
export function borrowOnFor(mode) { return borrowCfg(mode).on === true; }
export function setBorrowOnFor(mode, v) { borrowCfg(mode).on = !!v; save(); }

/** 这一档借的是哪一档（可能等于自己：切档留下的旧值 ⇒ 借的时候会过滤 ✓） */
export function borrowFromFor(mode) { return borrowCfg(mode).from; }
export function setBorrowFromFor(mode, m) {
    borrowCfg(mode).from = STAGE_MODES.includes(m) ? m : 'normal';
    save();
}

/**
 * 能不能显示孕期胎儿（有人不想要胎儿显示）
 *   · 开（默认）⇒ 怀孕时用孕期 1~5 那张（本身带胎儿）
 *   · 关       ⇒ 不走孕期那张，退回普通剖面（阴道底图 ＋ 子宫层），**不显示胎儿** ✓
 */
export function stageFetusOn() { return stagesCfg().fetus !== false; }
export function setStageFetusOn(v) { stagesCfg().fetus = !!v; save(); }

/**
 * 孕期阶段**按比例分**（不再按绝对周数），而且分界**可自定义**
 *   （高自定义插件不支持自定义显示很可笑）
 *   · 默认 20 / 40 / 60 / 80（%）⇒ 人类 40 周时正好是 8 / 16 / 24 / 32 周（跟以前一样 ✓）
 *   · 异种孕期更长 ⇒ 自动按比例走，不会一直卡在第 5 张 ✓
 */
export function stageCuts() {
    const v = stagesCfg().cuts;
    const d = [20, 40, 60, 80];
    if (!Array.isArray(v) || v.length !== 4) return d.slice();
    const out = v.map((x, i) => {
        const n = Math.round(Number(x));
        return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : d[i];
    });
    // 必须递增，否则归一回默认（别让玩家配出一个乱序的分界）
    for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) return d.slice();
    return out;
}
export function setStageCuts(list) {
    const d = [20, 40, 60, 80];
    const arr = Array.isArray(list) && list.length === 4 ? list.map((x) => Math.round(Number(x))) : d;
    stagesCfg().cuts = arr.every((n) => Number.isFinite(n)) ? arr : d;
    save();
}

/**
 * ⚠️ 旧的**全局**借用来源（`borrowFrom` 单值）已作废 —— 要求
 *   **每一档各自独立**（见上面 `borrowOnFor` / `borrowFromFor`）✗
 */

/** 取某个周期档已填的图（只保留非空项 ✓） */
export function stageImages(mode) {
    const c = stagesCfg();
    const m = (mode === 'amenorrhea') ? 'amenorrhea' : ((mode === 'none') ? 'none' : 'normal');
    const bag = c.images[m] || {};
    const out = {};
    for (const [k, v] of Object.entries(bag)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
}

/** 设置 / 清除某个档次某个状态的图（空串 = 回到文字版 / 回落另一档 ✓） */
export function setStageImage(mode, key, url) {
    const c = stagesCfg();
    const m = (mode === 'amenorrhea') ? 'amenorrhea' : ((mode === 'none') ? 'none' : 'normal');
    if (!c.images[m] || typeof c.images[m] !== 'object') c.images[m] = {};
    const v = String(url || '').trim();
    if (v) c.images[m][key] = v;
    else delete c.images[m][key];
    save();
}

/** 三档加起来填了几张图（设置页读数 + 诊断报告用 ✓） */
export function customStageCount() {
    return Object.keys(stageImages('normal')).length
        + Object.keys(stageImages('none')).length
        + Object.keys(stageImages('amenorrhea')).length;
}

/**
 * ★★ **「残留」怎么算**：两档并列，**不是开关** ✓
 *   · `real`  ＝ 按现实：残留**过一天就回「空」**（＝现实里"第二天就干净了"✓）
 *   · `cycle` ＝ 留到周期结束（**只影响显示**）：周期内一直留着，跨周期时自动清空
 * 默认＝`cycle`（理由：这个玩法本来就没那么现实 ⇒ 按周期留着更合适 ✓）
 */
export function stageResidueMode() {
    const c = stagesCfg();
    return c.residueMode === 'real' ? 'real' : 'cycle';
}

export function setStageResidueMode(v) {
    stagesCfg().residueMode = (v === 'real') ? 'real' : 'cycle';
    save();
}

/**
 * ★★ **「清理效率」**：三档并列，**不是开关** ✓（跟「残留怎么算」同一张卡、同一套写法）
 *   · `std`   ＝ 标准（默认）：阴道 满/多 每次 −1、中/少 −2（底是「空」）；子宫 每次 −1（底是「残留」）
 *   · `fast`  ＝ 快洗：阴道 每次 −2；子宫 满/多 每次 −2、中/少 −1
 *   · `flush` ＝ 一次到底：阴道一次清到「空」，子宫一次清到「残留」
 *   ⚠️ **两本的底不一样**：阴道洗得干净（能到「空」），子宫洗不干净（停在「残留」）✓
 *   ⚠️ 默认 `std`＝2026-10-19 之前的行为 ⇒ 老聊天不受影响 ✓
 */
export function stageCleanMode() {
    const c = stagesCfg();
    return (c.cleanMode === 'fast' || c.cleanMode === 'flush') ? c.cleanMode : 'std';
}

export function setStageCleanMode(v) {
    stagesCfg().cleanMode = (v === 'fast' || v === 'flush') ? v : 'std';
    save();
}

/** ★ 联系人详情里「隐藏已失活」开着没有（默认关 ✓） */
export function contactsHideDead() {
    return settings().contactsHideDead === true;
}

export function setContactsHideDead(v) {
    settings().contactsHideDead = !!v;
    save();
}

/**
 * ★★ **体内精液 → 外观描写**（默认文案 + 每档可改 + 可关）
 *
 * 口径：
 *   · 只有**子宫**「满 / 多 / 中」才有外观，阴道装多少都不写（那撑不起肚子）
 *   · 中 ≈ 三分之一、多 ≈ 三分之二；**满不是三分之三，是超过容量被撑圆了**
 *   · 内外都写：满 / 多 写**外面**的弧度 ＋ 里面的晃动；中 只写**内部的量与充盈**
 *   · **中**默认给一句体内的胀与分量（中档也写一句内部感受）
 *   · **写进哪一条（row1 / row2）每档可选**（可能有人需要中档也发给 row2）
 *     ⇒ 默认：满/多 → row2（体表），中 → row1（体内）；都能改 ✓
 *   · 量级字样**不进界面也不进喂给 AI 的那句**（量级字样可以删掉，可能有人自定义）✓
 *   · 孕期 / 非人形 / 卵生 那些例外由模块正文兜（见 modules.js）
 *
 * ⚠️ 存的是**显示文案**，不是逻辑：改坏了只影响描写，不影响任何判定 ✓
 */
export const SPERM_BELLY_TIERS = ['max', 'many', 'mid'];
export const SPERM_BELLY_DEFAULT = {
    max: '小腹被里面的精液撑得发圆，皮肤绷紧，鼓起的弧度连衣服都盖不住，走动时沉甸甸地坠，里面一阵阵地晃',
    many: '小腹被精液撑起一截明显的凸起，站直看得出，衣服贴身时更明显；动起来里面晃',
    mid: '子宫里积着一滩精液，沉胀发热，换姿势时能感觉到它在晃',
};

/**
 * ★★ 敏感带各等级的「表现描述」（2026-10-22）——从「敏感带等级表现参考」那张卡里读。
 *
 * 为什么要读卡：主 API 那一行现在写成「部位、部位（该等级的表现）」，描述文字直接取玩家改过的卡，
 *   改卡就等于改这一行，不用两处维护 ✓
 * @param {number} level 1~5（0 级不发）
 * @returns {string} 空串 = 卡里读不到这一级（调用方退回不写括号）
 */
export const ZONE_LEVEL_DESC_DEF = {
    0: '触碰无特别反应',
    1: '轻微酥麻，要持续刺激才明显',
    2: '一碰就有反应，呼吸变浅、肌肉微绷',
    3: '轻触即战栗，呻吟或蜷缩',
    4: '不用碰就有反应，气息拂过就发颤',
    5: '几乎瞬间高度兴奋，光是想到就会被唤起',
};

export function zoneLevelDescOf(level) {
    const n = Math.round(Number(level) || 0);
    let text = '';
    try { text = String(moduleText('zone_levels') || ''); } catch { text = ''; }
    const m = text.match(new RegExp('-\\s*' + n + '\\s*级[：:]\\s*([^\\n]+)'));
    // 卡里那几行习惯以句号收尾；嵌进括号里时把句尾的句号去掉，免得出现「…。）」✓
    if (m && m[1].trim()) return m[1].trim().replace(/[。.]+$/, '');
    return String(ZONE_LEVEL_DESC_DEF[n] || '').replace(/[。.]+$/, '');
}

/** 每一档默认写进哪一条状态条（满 / 多 是体表，中 是体内 ✓） */
export const SPERM_BELLY_ROW_DEFAULT = { max: 'row2', many: 'row2', mid: 'row1' };

/** 这一档现在写进哪一条：`row1`（体内）/ `row2`（体表）✓ */
export function spermBellyRow(tier) {
    const bag = stagesCfg().spermBellyRow;
    const v = bag && bag[tier];
    if (v === 'row1' || v === 'row2') return v;
    return SPERM_BELLY_ROW_DEFAULT[tier] || 'row2';
}

/** 这一项开没开（默认开 ✓） */
export function spermBellyOn() {
    return stagesCfg().spermBelly !== false;
}

export function setSpermBellyOn(v) {
    stagesCfg().spermBelly = !!v;
    save();
}

/**
 * ★ 2026-10-22：每档拆成**两段** —— 体内那段固定进状态条一，体表那段进状态条二。
 *
 * 为什么拆：原来每档只有一段、还要二选一 ⇒ 满/多默认只写体表 ⇒ 透视里明明看得到体内满着，
 *   row1 那边却一个字都没有（她截图报的）。现在两格各有一段，都由这张卡管，
 *   不再在别处另立规则 ✓
 */
export const SPERM_BELLY_IN_DEFAULT = {
    max: '子宫腔内超过容量，内壁被撑开，多余的液体向宫颈方向溢出',
    many: '子宫腔内积着厚厚一层，内壁被压着',
    mid: '子宫腔内一小滩，内壁轻度充盈',
};
export const SPERM_BELLY_OUT_DEFAULT = {
    max: '腹部轮廓明显外凸，衣料遮不住',
    many: '腹部明显鼓起，站直时看得见',
    mid: '',   // 中档默认不鼓（想写就在下面自己填）
};
/** 阴道那一本的体内写法（2026-10-22 加：以前这半边没人管，模型只能自己编 = 写歪的根源） */
export const SPERM_BELLY_VAGINA_IN_DEFAULT = {
    max: '阴道内超过容量，多余的部分向外溢出，液体随体位晃动',
    many: '阴道内还存着相当量，内壁覆着一层黏稠液体',
    mid: '阴道内还留着一层，内壁偏湿滑',
};

/** 阴道那段（体内，进状态条一） */
export function spermBellyTextVaginaIn(tier) {
    const c = stagesCfg();
    if (c.spermBellyVaginaIn && Object.prototype.hasOwnProperty.call(c.spermBellyVaginaIn, tier)) {
        return String(c.spermBellyVaginaIn[tier] ?? '').trim();
    }
    return SPERM_BELLY_VAGINA_IN_DEFAULT[tier] || '';
}

export function setSpermBellyTextVaginaIn(tier, text) {
    const c = stagesCfg();
    if (!c.spermBellyVaginaIn || typeof c.spermBellyVaginaIn !== 'object') c.spermBellyVaginaIn = {};
    c.spermBellyVaginaIn[tier] = String(text ?? '').trim();
    save();
}

/** 体内那段（进状态条一）。没设过新字段 ⇒ 把旧版那一段按旧去处归类（老存档不用手动迁 ✓） */
export function spermBellyTextIn(tier) {
    const c = stagesCfg();
    if (c.spermBellyTextIn && Object.prototype.hasOwnProperty.call(c.spermBellyTextIn, tier)) {
        return String(c.spermBellyTextIn[tier] ?? '').trim();
    }
    const bag = c.spermBellyText;
    if (bag && Object.prototype.hasOwnProperty.call(bag, tier)) {
        return (spermBellyRow(tier) === 'row1') ? String(bag[tier] ?? '').trim() : '';
    }
    return SPERM_BELLY_IN_DEFAULT[tier] || '';
}

/** 体表那段（进状态条二）。规矩同上 */
export function spermBellyTextOut(tier) {
    const c = stagesCfg();
    if (c.spermBellyTextOut && Object.prototype.hasOwnProperty.call(c.spermBellyTextOut, tier)) {
        return String(c.spermBellyTextOut[tier] ?? '').trim();
    }
    const bag = c.spermBellyText;
    if (bag && Object.prototype.hasOwnProperty.call(bag, tier)) {
        return (spermBellyRow(tier) === 'row2') ? String(bag[tier] ?? '').trim() : '';
    }
    return SPERM_BELLY_OUT_DEFAULT[tier] || '';
}

export function setSpermBellyTextIn(tier, text) {
    const c = stagesCfg();
    if (!c.spermBellyTextIn || typeof c.spermBellyTextIn !== 'object') c.spermBellyTextIn = {};
    c.spermBellyTextIn[tier] = String(text ?? '').trim();   // 空串＝这一段不写 ✓
    save();
}

export function setSpermBellyTextOut(tier, text) {
    const c = stagesCfg();
    if (!c.spermBellyTextOut || typeof c.spermBellyTextOut !== 'object') c.spermBellyTextOut = {};
    c.spermBellyTextOut[tier] = String(text ?? '').trim();
    save();
}

/** 某一档现在用的文案：改过就用改过的（**空串＝这一档不写**），没改过用默认 ✓ */
export function spermBellyText(tier) {
    const bag = stagesCfg().spermBellyText;
    if (bag && Object.prototype.hasOwnProperty.call(bag, tier)) {
        return String(bag[tier] ?? '').trim();
    }
    return SPERM_BELLY_DEFAULT[tier] || '';
}

/** 把三档都恢复成默认（删掉覆盖，不是塞空串 ✓）——文案和「写进哪一条」一起恢复 ✓ */
export function resetSpermBellyText() {
    const c = stagesCfg();
    delete c.spermBellyText;
    delete c.spermBellyTextIn;
    delete c.spermBellyTextOut;
    delete c.spermBellyVaginaIn;
    delete c.spermBellyRow;
    save();
}

// ---------------------------------------------------------------------------
// ★ 阶段插图的**文字**：玩家可以自己改 ✓
//   —— 判据和成就那条一样：**纯风格，不影响任何机制**
//   ⇒ 默认给好，想改就改 ✓
//
// ⚠️⚠️ 两档**各存一份**：有月经模式说「排卵日 / 卵子」，非月经模式说
//   「受孕高峰日 / 生殖细胞」（两档都得顾到 —— 文字写死了，
//   非月经模式下会冒出"排卵日" ✗）。
//   ⇒ 默认文字由 `stages.js` 的 `stageTextOf(stage, mode)` 拼（走术语表 ✓），
//     这里只存**玩家改过的**那几条（跟默认一样就删掉，不留垃圾 ✓）
// ---------------------------------------------------------------------------

/** 某一档 × 某一显示方式的桶名。
 *  ★ 2026-10-16：**文字也按三档各存各的**（无月经模式怎么没有文字可填）
 *  ★ 2026-10-17：**图版和文字版各存各的**（为什么图片档和文字档的标题是共享的，没隔离开）⇒ 图版那格是：透视页顶上那个标签，文字版那格是图里的大字，
 *    用途不同、写法也该能不同 ✓
 *    ⚠️ 存法用扁平键（`normal` / `normal_text`），老数据不用迁移：`normal` 就是现在的图版那份 ✓
 */
function stageTextBucket(mode, view = 'image') {
    const m = (mode === 'amenorrhea') ? 'amenorrhea' : ((mode === 'none') ? 'none' : 'normal');
    return (view === 'text') ? (m + '_text') : m;
}

/** 某一档（某一显示方式）里玩家改过的那些文字（读的时候顺手补齐结构 ✓） */
export function stageTextOverrides(mode, view = 'image') {
    const c = stagesCfg();
    const m = stageTextBucket(mode, view);
    if (!c.text || typeof c.text !== 'object') c.text = {};
    if (!c.text[m] || typeof c.text[m] !== 'object' || Array.isArray(c.text[m])) c.text[m] = {};
    return c.text[m];
}

/** 某一条被改成了什么（没改过 ⇒ 回落到上一档：无月经 → 非月经 → 有月经；都没有 ⇒ null 用默认 ✓）
 *  ⚠️ 回落只在**同一个显示方式**里回落（图版回落图版、文字版回落文字版），别串 ✓ */
export function stageTextOverride(mode, stage, view = 'image') {
    const chain = (mode === 'amenorrhea') ? ['amenorrhea', 'none', 'normal']
        : ((mode === 'none') ? ['none', 'normal'] : ['normal']);
    for (const m of chain) {
        const o = stageTextOverrides(m, view)[stage];
        if (!o || typeof o !== 'object') continue;
        const title = String(o.title || '').trim();
        const line = String(o.line || '').trim();
        if (title || line) return { title, line };
    }
    return null;
}

/** 记住某一条的文字（title / line 都空 ⇒ 删掉这条，回到默认 ✓） */
export function setStageTextOverride(mode, stage, title, line, view = 'image') {
    const bag = stageTextOverrides(mode, view);
    const t = String(title == null ? '' : title).trim();
    const l = String(line == null ? '' : line).trim();
    if (!t && !l) delete bag[stage];
    else bag[stage] = { title: t, line: l };
    save();
}

/** 这一档（这一显示方式）全部恢复默认 ✓ */
export function resetStageTextOverrides(mode, view = 'image') {
    const m = stageTextBucket(mode, view);
    stagesCfg().text[m] = {};
    save();
}

/** 三档 × 两种显示方式加起来改过几条（设置页读数用 ✓） */
export function customStageTextCount() {
    let n = 0;
    for (const m of ['normal', 'none', 'amenorrhea']) {
        for (const v of ['image', 'text']) {
            try { n += Object.keys(stageTextOverrides(m, v)).length; } catch { /* 忽略 */ }
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// ★ 孩子（出生后的记录）
//
// 定的边界：**只存插件内、不发给主 API**（但给一个选项可以发，**默认关闭**）✓
//   ⇒ 这里就是那个开关。
// ⚠️ **遗传能力得发**：不然主 API 写出来的细节对不上 ⇒ 开关打开时，
//   每个孩子那一行要带上「另一个亲代」和遗传能力 ✓
// ---------------------------------------------------------------------------

export function childrenCfg() {
    const s = settings();
    if (!s.children || typeof s.children !== 'object') s.children = { toMain: false };
    if (typeof s.children.toMain !== 'boolean') s.children.toMain = false;
    return s.children;
}

/** 要不要把「孩子」那一段发给主 API（**默认关** ✓） */
export function childrenToMain() { return childrenCfg().toMain === true; }

export function setChildrenToMain(v) { childrenCfg().toMain = !!v; save(); }

// ---------------------------------------------------------------------------
// ★ 随手记「全局」那一份（见 store.js 末尾那一节）
//
// 为什么不能只写在**浏览器本地存储**里：清浏览器数据 / 换设备就没了 ✗
//   而「本聊天」那份跟敏感带备注、占卜台历史一起进聊天数据（store.js ✓）。
//
// 为什么全局那份放这儿、不放聊天数据：它是**穿过所有聊天**的一份
//   （跟 `userBodyLock` / `userIdent` / `userZonesText` 一个待遇 ✓）——
//   塞进某一个聊天里就不是全局了 ✗
// ---------------------------------------------------------------------------

/** 随手记「全局」那份（面板给的 JSON 字符串，原样存 ✓；空串 = 还没写过） */
export function globalNotes() {
    const v = settings().globalNotes;
    return typeof v === 'string' ? v : '';
}

/** 写「全局」那份随手记 */
export function setGlobalNotes(text) {
    const s = settings();
    const v = String(text == null ? '' : text);
    if (s.globalNotes === v) return true;
    s.globalNotes = v;
    save();
    return true;
}


/**
 * 提醒气泡顶上那句话（可以全局自定义一句提醒词 ✓）。
 * 空 / 全是空白 ⇒ 回到出厂那句 ⇒ **气泡顶上永远不会空白** ✓
 * ⚠️ **不设字数上限** ⇒ 长了由气泡自己折行（`.bc-bubble-title` 的 overflow-wrap ✓）
 */
export function bubbleTitle() {
    const v = String(settings()?.bubbleTitle ?? '').trim();
    return v || DEFAULT_SETTINGS.bubbleTitle;
}

export const DEFAULT_SETTINGS = {
    schema: 1,

    // ---- 总开关 ----
    enabled: true,               // 插件总开关
    // 每次 AI 回复完自动推演状态。
    // ⚠️ 默认**关闭**：它每轮都会调一次推演 API（烧 token），属于"消费类"开关。
    //   不弹任何提示 —— 每次开新聊天弹窗会让玩家烦，想要的人自己去设置里开。
    autoUpdate: false,
    // 生成结束后**等一会儿**再推演（毫秒）。
    // 为什么要等：酒馆有时会"阶段回/空回"，或者回复还没落盘就触发了事件，
    //   立刻推演会拿不到内容、白烧一次 token。
    // ★ 默认 15 秒（截断没法靠代码判出来，只能把自动开始时间拉长一点）：
    //   ⇒ 截断插件判不出来（回复里有字），但延时越长，越有时间
    //     在它开跑前点楼层那颗「不参与推演」把它拦下来 ✓
    // ★ 这两格也是**秒**（毫秒用着很麻烦）✓ ⇒ 字段带 `Sec`、**值就是秒**（跟插件 API 的「超时（秒）」一个口径 ✓）
    //   ⚠️ 老存档里那两个毫秒键由迁移（schema<7）换算过来 ✓
    judgeDelaySec: 15,
    // 报错 / 被中止 / 空回时不自动推演（见 index.js 的标志法 _gotMessageThisGen）
    // ⚠️ 覆盖：报错（400 / 524 等）✓ 被中止 ✓ 空回 ✓
    // ⚠️ 不覆盖：截断 —— 那种回复里有字，只有人读得出来「没写完」，插件做不到 ✗
    judgeSkipEmpty: true,
    // 推演没跑成时的重试间隔（**秒**）
    judgeRetrySec: 5,
    // ★★ 历法（「自定义时间兼容」）——
    //   要的不只是替换名字，而是**非标准时间**也成立（一个月 90 天、一年四个月 360 天这种）；
    //   并且给一个初始表：玩家自己设定一年几个月、一个月多少天 ✓
    //   形态：`{ months: [每月多少天…], leap: 'gregorian' | 'none', weekLen, weekStart }`
    //     · 数组长度 = 一年几个月；`leap:'gregorian'` 只在正好 12 个月时算数（公历那套闰年）
    //     · `weekLen` = 一周几天（1..60）；`weekStart` = 纪元第一天是一周里的第几天（1 起算 ✓）
    //       ⚠️ 出厂 `weekStart: 2`：公历 1年1月1日 是**周一**，按 `0 = 周日` 的口径就是第 2 天 ✓
    //         （为什么不是 1，见 fiction-date.js 顶部那段核算 ✓）
    //     · **出厂 = 公历** ⇒ 老存档零迁移、老行为一字不变 ✓
    //   ⚠️ 它是**世界观级**的（跟"模块开关"同一层，不是某个人的东西）✓
    //   ⚠️ 改了它 ⇒ 聊天数据里那些日期会按「天数守恒」搬一次（见 store.js 的 syncCalendarForChat）
    calendar: { months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], leap: 'gregorian', timeUnit: 'none', weekLen: 7, weekStart: 2 },
    // 精子存活（⚠️ **已废弃**：判决改看 `cycleSettleMode === 'sperm'`）。
    //   它是「可开关、默认关闭」的一个布尔，而这个玩法现在升级成了「周期结算方式」那两档
    //   （界面上的开关早就换成那两档了）⇒ 这个布尔量只剩 `stages.js` 在读，
    //   现在一并改读 `cycleSettleMode` ✓ 字段先留着（不删，免得老存档迁移多一步）
    spermLife: false,
    // ★ 周期结算方式（规则变体，不是可选开关）。两种玩法：
    //   'reset' 按周期清零 —— 进新周期清精子
    //   'sperm' 按精子存活（**默认**）—— 不清零，靠各自的存活期自然失效
    //   ⚠️ 判定那一刻拿哪个数**不在这两档里**：那由 `judgeBasis` 单独决定（默认累计受孕率）
    // ★★ 默认 `sperm`（按精子存活）——
    //   为什么不能是 reset：reset 档下**整个周期的每一次内射都全额累加、永不失效**
    //   ⇒ 卵泡期每天一次，第 7 天就攒满 ⇒ 怎么调基础率都压不住"多做几次就必中" ✗
    //   ⇒ 难度能不能成立，靠的是这一档（让早做的自然退场），不是靠那几个百分比 ✓
    cycleSettleMode: 'sperm',
    // 待生效的模式：在设置页改了不会立刻生效，等周期边界才换挡 ✓
    // （这是规则相关的，随时切换不对劲 ⇒ 卡在周期边界换挡 ✓）
    cycleSettlePending: '',
    // ★ 精子存活期（天）：最短 / 最长，掷的时候**范围里均匀随机**
    //   ⇒ 只让玩家调范围（加权等于插件假装知道精子质量 ✗）
    // ★ 易读模式（⚠️ 注释里也**不许**写"这一档适合谁用"这类说法 ✗，只描述字号与对比度）
    //   'normal' = 正常（**默认**，字号与信息密度按标准来）｜'large' = 易读模式（字号整体放大 + 对比度拉到 AAA + 行距放宽）
    // ★ 周期模式（月经 / 非月经）—— 在补丁那里做一个模式切换 ✓
    //   'normal' = 有月经（默认，**完整保留** ✓）
    //   'none'   = 非月经（不描写经血、阶段名换一套；**受孕机制完全一样** ✓）
    //   ⚠️ 不是"关掉功能"✗ —— 是两套并列的表述 ✓
    periodMode: 'normal',
    // 非月经模式下的阶段名（先给一套中性的 ✓，可随时改 ✓）
    //   key 是 phaseId（稳定 ✓），value 是这一模式下显示的名字
    phaseNamesNone: {
        menstrual: '静息期',
        follicular: '蓄势期',
        ovulation: '高峰窗口',
        ovulationDay: '高峰窗口（当日）',
        transition: '回落期',
        luteal: '稳定期',
    },
    // ★ 术语表（B 方案 ✓）：有月经模式下用医学准确的词，非月经模式下用中性词
    //   非月经那套用中性说法（B 方案定下来的 ✓）
    termNamesNormal: {
        ovulationWindow: '排卵窗口',
        ovulationDay: '排卵日',
        ovum: '卵子',
        cervicalMucus: '宫颈粘液',
        follicle: '卵泡',
        corpusLuteum: '黄体',
    },
    termNamesNone: {
        ovulationWindow: '受孕窗口',
        ovulationDay: '受孕高峰日',
        ovum: '生殖细胞',
        cervicalMucus: '体内分泌物',
        follicle: '生殖细胞',
        corpusLuteum: '稳定期结构',
    },
    // 有月经模式下的阶段名（也可以改 ✓）
    phaseNamesNormal: {
        menstrual: '月经期',
        follicular: '卵泡期',
        ovulation: '排卵期',
        ovulationDay: '排卵期（排卵日）',
        transition: '排卵后过渡期',
        luteal: '黄体期',
    },
    visionMode: 'normal',
    // ★ 提醒气泡顶上那句可以自己写（出厂 = 「到日子了」✓）——
    //   全局一份：气泡只有一个，按聊天存要多存好几份、还会出现"这个聊天这个词、那个聊天那个词"✗
    //   空 ⇒ 回出厂（读取走上面的 `bubbleTitle()` ✓）
    bubbleTitle: '到日子了',
    // ★ 番茄钟：两段默认时长（分钟）——
    //   两段时长都可以自定义 ✓
    //   ⚠️ 这里是**默认值**（面板那页随时能临时改成别的）；计时状态本身不在这儿，
    //      存在浏览器本地（见 `src/timer.js` 那段说明：跟聊天 / 账号都无关 ✓）
    // ★ 番茄钟要有**自己的悬浮球**（别让本体那个变身）+ 页内气泡提醒；
    //   "保活"开关**默认关**（它有真实代价：一直占着音频 + 费电 ✓）
    timer: {
        work: 25, rest: 5, ball: true, keepAlive: false, ballX: null, ballY: null,
        // ★ 番茄钟的文字也要能自定义 ⇒ 到点那个气泡的两句话可改 ✓
        //   留空就回出厂（读取走 ui-timer.js 的 `timerBubbles()` 兜底），跟日历那个「到日子了」同一套 ✓
        bubbles: { work: '', rest: '' },
        // ★ 悬浮球那个页里也要有番茄钟悬浮球 ⇒ 那颗球**自己**的头像 ✓
        //   留空 ⇒ 跟着「悬浮球头像」那张走（再空 ⇒ 用插件自带的番茄样子 ✓）
        ballImage: '',
        // ★★ ① 壳的颜色要能自定义（方便玩家换不同色系的图）⇒ `shellColor`（空 = 出厂红 ✓）
        //   ② 番茄钟的背景图要有透明度调整（有人想要半透明的图 ⇒ `shotAlpha` 百分比 0~100 ✓）
        shellColor: '',
        shotAlpha: 100,
        // ★★ 刷新之后番茄钟怎么处理是选项 ——
        //   一是刷新就重置（连悬浮球都不显示），二是像现在这样按现实时间接着走 ✓
        //   true = 刷新就重置（默认 ✓）；false = 按现实时间接着走（老行为 ✓）
        resetOnLoad: true,
    },
    spermLifeMin: 1,
    spermLifeMax: 7,
    // ★★ 受精判定口径（两档，规则变体不是开关）——
    //   'cumulative' 累计受孕率（**默认**）＝窗口内入过账的批次贡献全部计入，失活的不扣旧贡献
    //   'alive'      仅存活精子 ＝ 只算窗口结束那一刻**还活着**的那几批
    //   ⚠️ 只换「判定值」这一个数：面板上的累计受孕率（d2）两档都是**累计**，不会跟着变小 ✓
    //   ⚠️ 只在「按精子存活」结算方式下才有区别（按周期清零没有存活期 ⇒ 两档恒等）
    //   ⚠️ 切换**不重算**已经判过的结果（重算等于改剧情）⇒ 下一次判定才生效 ✓
    judgeBasis: 'cumulative',
    // ★★ 着床判定什么时候掷（两档）——
    //   true （默认）到着床完成日那一轮才掷：受精那轮只掷天数（用来算哪天揭晓），
    //        结果留到那天，或者剧情跳过那天之后的第一轮补掷 ✓
    //   false 受精判定那一轮就掷好：结果早定，只是到日子才说
    //   ⚠️ 两档都**只掷一次**（掷过就钉住，回滚 / 重推都不会改 ✓）
    //   ⚠️ 插件**不读正文判断结论**（正文是自由文本，解析不可靠 ✗）：
    //     剧情提前给了结论（孕检 / 魔法感应）就用「改数值」里那几颗改数值的入口（保底后门 ✓）
    implantJudgeOnDay: true,
    // 着床天数区间（默认 6~10 天，跟原来 1d5 的映射一模一样）——
    //   范围里**均匀随机**（跟精子存活期 / 孕期同一个做法：真随机，不加权 ✓）
    implantDaysMin: 6,
    implantDaysMax: 10,
    // ★★ 四个基础率：
    //   **这四个数是受孕率计算的唯一真相源**（阶段基础率 × 体质系数 × 防护系数 里的第一个因子）。
    //   ⚠️ 在**三处**各写一份必打架：`cycleDayInfoOf()`（判定用）、[生理周期模块] 正文、
    //   [身体补丁] 正文 ✗
    //   ⇒ 现在只存这一份：判定直接读它，正文里那几处数字由 `applyCycleRateLines()` 在**发送时**渲染进去
    //     （面板上改一格，判定和提示词一起变 ✓；正文里看到的仍是人话「基础率 8%」，不是占位符 ✓）
    cycleRateMenstrual: 1,     // 经期
    cycleRateFollicular: 8,    // 卵泡期
    cycleRateWindow: 20,       // 受孕窗口（含排卵日当天）
    cycleRateTransition: 15,   // 窗口结束后第一天（过渡日）
    // ★★ 第九个数：无月经档（没有周期、没有阶段）
    //   那一档没有"第几天"可落段 ⇒ 每次内射都按这一格算基础率，
    //   别去借五段里的某一段（借了会随天数漂：1% / 8% / 25% / 0% 乱跳 ✗）
    cycleRateAmenorrhea: 10,
    // ★ 成就那三个字数上限（规则句按它们渲染 ✓）
    achNameMax: 8,
    achWhyMax: 20,
    achQuipMax: 120,
    // ★★ 近期性行为：**面板与主 API 显示最近几条**——
    //   记录本身由插件一直留着（`state().sexLog`），这个数只管"露几条出来"；
    //   契约那边不再问条数（AI 每轮只写最近这一次 ✓）
    recentSexKeep: 3,
    // ★ 联系人详情「隐藏已失活」—— 默认**关**（联系人本质是历史记录，默认藏掉会让记录看着少了 ✗）
    contactsHideDead: false,
    // ★ **防护系数表**也做成面板格 ——
    //   这 8 个数是"这一次行为算几个点"的乘数，玩家最可能想调难度；
    //   ⚠️ 这 8 个数现在**代码也读**（A1：情境 → 乘数 → 增量由插件算，见 store.js 的
    //     `inseminationGainOf()`）⇒ 唯一真相源＝设置，正文由 `applyProtectionLines()` 在发送时渲染 ✓
    //   ⚠️ 注意它们是**乘数**不是百分比（0.3 就是 ×0.3）⇒ 夹 0~10、保留小数 ✓
    protInternal: 1.0,        // 内射
    protFriction: 0.3,        // 外部摩擦 / 体液接触
    protCondomTorn: 0.3,      // 避孕套明确破损（小洞 / 轻微撕裂）
    protCondomBurst: 1.0,     // 大面积破裂
    protCondomSlipOff: 0.3,   // 射精前掉落但有前列腺液
    protOutPull: 0.5,         // 无套外射
    protPillShort: 0.05,      // 短效避孕药（仅事前）
    protPre: 0.1,             // 前液接触（没射精，前液流到入口 / 外阴）—— 2026-10-17 加
    protCondomIntact: 0,      // 完好无损 / 无描写兜底
    // ★ **意识状态那五档（A~E）的察觉时间**也做成面板格 ——
    //   正文每档写着「怀疑：孕3-4周（着床后0-7天）｜确认：孕4-5周（着床后7-14天）」，
    //   一共 10 行 × 2 组数，**没有任何代码读**（纯规则，AI 照它判）⇒ 想调挡位只能改正文 ✗
    //   ⚠️ 形态：**每档只存 2 个数**（怀疑的起始孕周 / 确认的起始孕周）——
    //     孕周区间取「起始 ~ 起始+1」、括号里的着床后天数按 `(w-3)*7` 算出来
    //     ⇒ 面板输入更少，也不会出现"周和天数自己打架"（那 4 个数本来就是同一区间的两种写法 ✓）
    awarenessTierA: { suspW0: 3, suspW1: 4, suspD0: 0, suspD1: 7, confW0: 4, confW1: 5, confD0: 7, confD1: 14 },
    awarenessTierB: { suspW0: 4, suspW1: 5, suspD0: 7, suspD1: 14, confW0: 5, confW1: 6, confD0: 14, confD1: 21 },
    awarenessTierC: { suspW0: 5, suspW1: 6, suspD0: 14, suspD1: 21, confW0: 6, confW1: 8, confD0: 21, confD1: 35 },  // 默认档
    awarenessTierD: { suspW0: 8, suspW1: 12, suspD0: 35, suspD1: 63, confW0: 12, confW1: 16, confD0: 63, confD1: 91 },
    awarenessTierE: { suspW0: 16, suspW1: 20, suspD0: 91, suspD1: 119, confW0: 20, confW1: 28, confD0: 119, confD1: 175 },
    // ★ F：几乎到生产才意识到（2026-10-24 她提的“快生了才发现”）
    awarenessTierF: { suspW0: 28, suspW1: 34, suspD0: 175, suspD1: 217, confW0: 34, confW1: 40, confD0: 217, confD1: 259 },
    awarenessUpper: 32,            // E 档那条「上限：孕32周」
    awarenessUpperDays: 203,       // 同一句里的「着床后203天」（**不是** 32×7 ⇒ 单独存 ✓）
    updateOnSwipe: false,        // 左右切换消息分支时也重新推演
    injectToMain: true,          // 往主 API 注入状态与沉浸类模块
    // ★ 「把当前时间也发给主 API」（默认关 ✓）——
    //   开了之后状态摘要开头多一行「当前时间：…」，写正文的 AI 才知道现在几点；
    //   那些剧情里压根不写时间的卡，也能靠这一行拿到一个时间（保底 ✓）
    sendTime: false,
    // 主 API 能看到几条状态栏（越旧的越没用 —— 最新那条已经包含全部状态）
    //   只给主 API 发送最近三层的状态栏 —— 1 条看不出趋势，3 条刚好。
    // ⚠️ 这条必须放在**顶层** —— 界面写的是 `s.stateKeep`、intercept.js 读的也是顶层；
    //   ⚠️ 写进 `judge` 子对象里时界面读不到（从没动过就是 undefined），
    //   实际生效的是 intercept.js 里硬编码的那个 3（看不出来，但两个默认值迟早会打架 ✗）
    stateKeep: 3,

    // ---- 被排除的角色卡（2026-10-28）----
    //   键 = 角色卡的头像文件名，值 = true（见 src/cardexclude.js 顶上那段说明 ✓）
    //   ★ 名单**全局一份**、穿过所有存档（跟世界书排除表同一个存法 ✓）
    //   ★ 默认空 = 所有卡都启用（不改变任何人现在的用法 ✓）
    excludedCards: {},

    // ---- 插件自己的 API（**多套**） ----
    //   ★ 可多套：存多个 API、编辑备注（取代原来那套扁平字段），
    //     但**不照抄别人的样子，因为我们有自己的风格** ✓
    //   ★ 字段就是那 9 个（+ 名字），别人那几个（思考强度 / 流式 /
    //     发送预填充 / 排除参数）**不做** ✓ —— 真需要时用「额外请求体」兜 ✓
    //   ⚠️ 预设导入**不跟渠道走**（没必要绑在一起 ✓）⇒ presetName / presetEntries
    //     留在这一层，不属于任何一套 ✓
    api: {
        mode: 'own',             // 现在只有插件自己的接口这一种（酒馆通道已移除）
        presetName: '',          // 从酒馆哪个预设导入的参数（只是记录，方便回看）
        presetEntries: {},       // 从预设里勾选了哪些「条目」{ identifier: true }
        currentId: '',           // 正在使用的那一套（空 ⇒ 用 list[0] ✓）
        list: [],                // [{ id, name, baseUrl, apiKey, model, temperature, maxTokens, timeoutSec, jsonMode, extraHeaders, extraBody }]
    },

    // ---- 推演行为 ----
    judge: {
        // 受孕记录（谁什么时候让该角色怀上的）—— 做成**可选项**：
        //   记录哪次中招需要可选（可能不是所有人都想用）
        //   关掉之后契约里那一块就不发，也不记。
        conceptionLog: true,
        // 送给插件 API 的最近**角色楼层**数（**只管插件 API 那一次请求**；主 API 写正文时
        // 一个字都不多带 ✓）
        //   ★ 这个数字**永远只数角色楼层**，用户楼层是附带的、
        //     不占这个数（用户信息**跟着系统层、用户层一起发**，不单独算 ✓）。
        //     实现见 judge.js 的 transcriptBlock ✓
        //   ★ 默认 **1**：
        //     推演要的信息全在「上一轮状态」里（那是历史的累加结果），
        //     剧情不归插件管、它只是个无情的记录机器 ⇒ **历史正文是纯浪费** ✓
        //     多给几层只是"以防它漏报"的余量，需要的人自己加大 ✓
        //   ★ 曾经是 12 → 1 → 3（3 是"留一手余量"那个取舍；玩家看过后说：1 就够✓）
        //   ⚠️ **改默认不动存档** ⇒ 老存档里是 12 / 3 的按迁移走（见下面 schema 那几段 ✓）
        historyDepth: 1,
        // 把用户发言也一起送过去 —— **默认关** ✓
        //   默认关闭、不能默认开启（这种废 TOKEN 的事情不干）
        //   ⇒ 推演要的信息都在「上一轮状态」里，用户自己那一段通常对判定没帮助
        //   ⚠️ 这里**不写迁移**：老存档本来就是关的，而且这是个"有人会特意打开"的开关，
        //     一律往回改会把特意打开的人弄烦 ✗（改默认只影响以后的新装）
        includeUserMessages: false,
        // ★ 推演范围：
        //   all（默认）= 全部追踪对象都发给插件 API；
        //   present    = 只发**最近两楼正文里提到**的对象（省 token）。
        //   ⚠️ 没被发的对象只是"这一轮不推演"，时间照常由插件推进（周期日 / 孕周 / 存活期）✓
        scope: 'all',
        maxTargets: 50,          // 自动追踪时最多建档多少个对象（出厂 50）
        noTargetLimit: false,    // ★ 解除上限（后果自负：几十上百个对象会很吃 token / 卡界面）
        autoCreateTargets: true, // 自动模式下发现新角色就建档（⚠️ 代码里**不分性别**：男的女的都建 ✓）
        // ★★ 自动提醒（设置里给开关、默认开启 ✓）——
        //   · notifyConceive：着床完成（怀孕）那一刻提示一次
        //   · notifyDue：每胎的预产期到那天提示（日期由插件掷定：引擎只报「孕期」区间，
        //     插件掷天数并算日期，只掷一次就锁住 ✓ 见 judge.js 的 ensureGestationDates ✓）
        //   ⚠️ 判据一律写 `!== false`（老存档没有这两格 ⇒ 按"开"处理 ✓ 不用写迁移）
        notifyConceive: true,
        notifyDue: true,    },

    // ---- ★ 给推演看的世界书（细节见 src/wi.js 顶上那段说明）----
    //   一句话：插件 API 照酒馆的读法读世界书（常驻 + 关键词命中的那批），
    //   只取「当前角色卡的书 + 全局书」两类；玩家可以在插件里自己开关条目，
    //   默认跟随酒馆，**动过之后锁死**不再跟随；排除表**全局一份**、列全部世界书。
    wi: {
        // **按来源分两颗开关，默认都关**（要给推演看世界书的人自己去打开）——
        //   理由：世界书体量大，默认带 = 每轮白吃一大截 token；
        //   关着时推演只按角色卡 / 剧情判，想更准就回来打开 ✓
        //   · charBooks   = 当前角色卡绑的那几本世界书
        //   · globalBooks = 酒馆里当前开着的全局世界书
        //   ⚠️ 两颗**各管各的、互不门控**（关上面那颗，下面那颗照样能点、照样有用 ✓）
        //   ⚠️ 老存档只有 `enabled` 这一颗 ⇒ 迁移时两颗都跟着它（见 wiCfg ✓）
        enabled: false,     // 老总开关：只为老存档迁移留着，读的时候不再看它
        mode: 'follow',     // 'follow' = 跟随酒馆（默认）｜'manual' = 动过之后锁死
        // **默认也关**（跟上面总开关同一个口径）——
        //   角色描述通常最长、每轮都吃 token，而且常塞着状态栏 / 面板格式 ✓
        desc: false,        // 角色卡的角色描述要不要一起带（有人会往描述里塞状态栏格式 ⇒ 本来就该关）
        // ★ 2026-10-23（她提的）：用户自己那份人设描述要不要也带给推演。
        //   之前推演只看得到「角色卡描述」和世界书，玩家自己写的体质/血脉/天赋根本进不去，
        //   于是"受孕方"那一半在遗传检查里永远是「无」。默认关（那是玩家私密设定 + 每轮吃 token）✓
        persona: false,
        // ★ 2026-10-23：「血脉遗传特质」判定那一轮，**临时**把世界书与用户角色设定带一次
        //   （只看这一轮，不改上面那两颗开关的存值）。默认开：
        //   不开的话，开关都关着的人那一轮照样只能判「无」，这个模块等于白做 ✓
        heritageAuto: true,
        offBooks: {},       // 书名 -> true：整本不给推演看（＝排除）
        offEntries: {},     // 书名 -> { uid: true }：单条不给推演看
    },

    // ---- ★ 涩涩成就 ----
    //   形态：
    //     · AI 给一个成就名字和描述；插件**纯记录**，以后也不会发回给 AI
    //     · 数据**按聊天存**（见 store.js 的 achievements ✓）
    //     · 提示词不要放别的地方，**单独放成就设置那里**
    //     · **不锁提示词**，让玩家自由自定义（只是风格问题）
    //   ⇒ 提示词拆两半：
    //     · ACH_STRUCT（结构句）= **代码固定**、页面上只读展示 ——
    //       它写着"什么时候该报、字段叫什么"，被改坏就静默全哑（AI 不再报、面板永远空）✗
    //     · style = **玩家可自由改**的风格段（语气 / 长度 / 禁忌 / 例子）——
    //       改坏最多是吐槽难听，不会破坏结构 ✓
    ach: {
        on: false,          // 默认关（只对想收集的人有意义；开了才会往推演提示词里加那两段）
        toast: true,        // ★ 解锁成就时右上角弹气泡（2026-10-18；默认开——关了就像没发生过 ✓）
        toastSec: 8,        // ★ 气泡停留几秒（2026-10-21；0 = 不自动关，点 ✕ 才走 ✓）
        style: '',          // '' = 用内置默认（ACH_STYLE_DEFAULT）⇒ 以后改默认文案能跟着走 ✓
    },

    // ---- 追踪对象 ----
    targetMode: 'user',
    targetNames: [],             // single / multi 用的名字列表
    // ★ 要不要追踪"{{user}} 本人"：
    //   玩男性角色、不能怀孕、但想泌乳体质和敏感带的那些，就靠这个
    //   "是否启用追踪 {{user}} 本身"的开关 ✓
    //   ⇒ 关掉之后：不再自动给本人建档、推演名单里没有本人、面板也不显示本人那一栏 ✓
    //   ⚠️ 关掉**不会删**已经存在的本人档案（那只是"不追"，不是"删数据" ✓）
    trackUser: true,
    // ★ 新面孔识别范围：
    //   关（默认）＝ 只有**真的发生了身体相关的事**才登记新面孔；
    //   开 ＝ 剧情里只是明确交代了某个人的种族也登记（异种世界可以提前知道种族）。
    //   为什么默认关：开着会把"只是被提到种族的宠物 / 路人"也建进来，玩家觉得恶心 ✓
    raceScan: false,
    autoHints: '',               // 自动模式的额外提示（例如「只算上场角色」）
    // ★ 「推演之前先剥掉哪些标签」：**一行一个标签名**（加一个自定义剥离的地方 ✓）
    //   内置那几种在 judge.js 的 BUILTIN_STRIP_TAGS 里（面板残留 ＋ 常见思考块 ✓），这里只是**追加** ✓
    stripTags: '',
    // ★★ 2026-11-01（她：变量和我们的面板不能兼容，给个兼容剥离的开关）——
    //   角色卡 / 预设常把自己那一套"变量更新"整段写在正文里，那是喂给酒馆变量系统的元信息，
    //   推演看了只会当成正文 ⇒ 打开这个开关就在送进推演之前把这种块整段删掉。
    //   默认关：有些卡把叙述写在这种块里，剥不剥由玩家自己定 ✓
    //   ⚠️ 识别规则在 judge.js 的 `stripVariableBlocks()`；两家写法不统一，
    //     所以先认标签名，名字认不出来再看内容形状做兜底 ✓
    stripVarBlocks: false,

    // ---- ★「角色基础信息」里专门属于【用户本人】的那一份（全局，不跟聊天走）----
    //
    // 为什么用户本人要单独放全局（用户角色那里一定是要全局的，
    //   用户角色别删、存全局 ✓）：
    //   **{{user}} 是同一个人，穿过所有聊天** ✓ —— 而其他追踪对象是"这个故事里的角色"，
    //   跟着聊天走才对 ✓。所以用户本人这份"我能不能怀孕 / 算不算异种"不该在每个聊天里重填 ✗。
    // ⚠️ 这里的值**任何清理逻辑都不许删** ✓。
    userBodyLock: {
        canBePregnant: null,     // null=未填（按 AI 判）/ true / false
        canImpregnate: null,     // 同上
        isXeno: null,            // 同上
        // ★ 第四项：能不能怀上异种 ——
        //   每个角色的"能不能和非人类种族生"是世界观设定，插件不可能知道 ⇒ 让玩家填 ✓
        //   填「不能」⇒ 名单里写明设定，异种族致的致孕方不算进候选、也不判受精 ✓
        canBearXeno: null,       // 同上
    },

    // ★「你是谁」—— 用户本人的别名表与备注（全局，理由同上 ✓）
    //   别名：这个档还认哪些叫法（`阿杰 / 杰哥 / 小杰`）⇒ 推演报任何一个都对得上 ✓
    //   备注：只给人看的说明（用来区分两个同名角色，比如 `一班的丽娜`）✓
    userIdent: {
        aliases: '',
        note: '',
    },

    // ---- ★「敏感带初始设定」里专门属于【用户本人】的那一份（全局，理由同上面两条）----
    //
    // ★ 存储形状照抄 userBodyLock / userIdent：
    //     · **用户本人** ⇒ 这里（全局，换聊天不丢 ✓）
    //     · **NPC**      ⇒ 本聊天档案（对象自己的 `zonesText` ✓）
    //   为什么不能"一个人一份都存在聊天里"：用户本人的东西是**同一个人穿过所有聊天** ✓
    //   （用户角色和 NPC 不是一个东西 —— 两者不能混着存 ✓）
    //   ⚠️ 老存档把这一份存在"本聊天一份"（`state().zoneText`）里 ⇒ 读的时候必须兜底回退，
    //      绝不能因为换了存放位置就把玩家填过的敏感带弄丢 ✗
    userZonesText: '',
    userZonesPresetId: '',

    // ---- ★ 用户本人的「周期模式」（有月经 / 无月经）----
    //   ★ 周期模式是**按人**的 ——
    //     世界观里同时有"月经怀孕"和"非月经怀孕"两种需求 ⇒ 按人分档这个思路是对的 ✓
    //     ⇒ 规则只有一份（术语走 @@ 占位符、插件替换 ✓），但**每个人属于哪一档是自己的事** ✓
    //     ⇒ 发送时**按档各发一份**（最多两份）而不是每人一份 ⇒ token 不会爆 ✓
    //   存法同上面几条：本人 ⇒ 这里（全局）；NPC ⇒ 本聊天档案（对象身上的 `cycleMode` ✓）
    //   空 = 没定过 ⇒ 跟着全局默认（`settings().periodMode`，它降级成"新建角色的默认档" ✓）
    userCycleMode: '',
    userAwarenessTier: '',           // 玩家自己那份察觉档位（空＝交给 AI 判一次）
    userAwarenessTierManual: false,  // 玩家手选过 ⇒ 锁住，AI 再报也不覆盖

    // ---- ★ 用户本人「属于哪个大类」----
    //   选人外的时候要填种族，还要有一个**选属于哪个大类**的选项 ✓
    //   值 = [异种扩展包 · 西方与通用] 表里那一行的名字（选项表在 modules.js 的 XENO_CLASSES ✓）
    //   空 = 没选 ⇒ 按推演每轮判 ✓；NPC 那份存本聊天档案（`targets[key].xenoClass` ✓）
    userXenoClass: '',

    // ---- ★ 用户本人「新存档的周期起始」----
    //   剧情里的 NPC 周期可以随机 ROLL；玩家不一样，需要自己设置、自由度高，
    //   但同时 NPC 的数据也能编辑（"改数值"那条路已经通了，所以不用担心）✓
    //   ⇒ **玩家本人**：自己设置（下面这两格，在补丁页 · 人物视图里改 ✓）
    //   ⇒ **剧情里的 NPC**：默认**随机 ROLL** 一天（存在对象自己身上，
    //      见 store.js 的 `cycleStartRuleOf` ✓；玩家要改就去「改数值」里改当前第几天 ✓）
    //   ⚠️ 两格都只管「还没定过起始的人」；已经在跑的**一个字都不动**
    //      （红线：改设置 / 改参数都不许重算 ✓）
    userCycleStartRandom: false,   // 本人是不是随机（默认 false = 自己指定 ✓）
    userCycleStartDay: 0,          // 0 = 自动（按参数取卵泡中期）；>0 = 玩家指定的第几天

    // ---- ★ 随手记「全局」那一份 ----
    //   穿过所有聊天的一份笔记（跟 userBodyLock / userIdent 一个待遇 ✓）
    //   存的是面板那边的 JSON 字符串，原样搬运；空串 = 还没写过
    //   ⚠️ 读的时候走 `globalNotes()`、写走 `setGlobalNotes()`（它们带类型兜底 ✓）
    globalNotes: '',

    // ---- 主 API 注入范围 ----
    injectScope: 'present',      // present=只注入本轮出场的对象 / all=全部 / active=只看当前查看的

    // ---- 呈现方式 ----
    // float = 只用悬浮窗；inline = 面板插进聊天；both = 两个都要
    // 无论选哪个，只要没在聊天里，一律强制回落到悬浮窗
    // inline 模式下具体放哪：dock  = 固定在聊天页面内（一直看得见，默认）
    //                     below = 聊天记录最下面（要滚到底才看得到）

    // ---- 骰子 ----
    // 清单定义是全局偏好；掷出来的值按聊天独立存在 store 里
    dice: {
        mode: 'pool',        // pool = 随机数池（AI 按需取用）| list = 固定骰子清单
        poolSize: 14,        // 池模式：一百面池几个数
        smallSize: 4,        // 池模式：五面池几个数
        autoRoll: true,
        entries: null,       // 清单模式：[{ id, label, expr }]，null = 用默认清单
    },

    // ---- 模块（29 条，见 modules.js 顶上的说明 ✓）----
    // id -> { enabled?: bool, text?: string }
    modules: {},

    // ---- 补丁编辑范围（只锁判定层）----
    //   'numbers' = 只能改数值（默认）：**会进插件 API 的那批**规则只有"数字"改动算数，
    //               正文被改写的那份**冻结不删**（不生效，切到全文可改立刻恢复 ✓）
    //   'full'    = 全文可改：文字随便改（改坏了后果自负）
    //   ⚠️ 描写风格那批（只发主 API 的）两档下都能改 —— 它们不吃插件 API 的 token ✓
    patchScope: 'numbers',

    // ---- 对象专属的补丁文案覆盖 ----
    // ⚠️ 只有【用户本人】那一份在这里（键 = `user`）—— 全局，穿过所有聊天 ✓
    //    **其他对象按聊天存**（`state().targets[key].patches`，见 store.js 里那段说明）
    //    用户本人的设定别跟着聊天存 ✓
    targetPatches: {},
    // 提示词档案：一份可命名、可切换、可导出的提示词配置快照（见 archive.js）
    archives: {},
    // 敏感带档案库：{ id: { name, text } } —— 全局共用，但每个聊天选哪份是独立的
    zonePresets: {},
    // ★ 历法预设库：{ id: { name, cal, at } } —— 全局共用 ✓
    //   一条 = 「历法 ＋ 写法」一整套；切过去两样一起换（见 applyCalendarPreset）
    calendarPresets: {},
    // ★★ 日历上的节日 ——
    //   出厂只放**固定公历日期**的那几个 ✓
    //   ⚠️ 农历节日（春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 除夕）**出厂就有**
    //      （`src/lunar.js` ＋ 节日表多一种 `{ lunar }` 写法 ✓）：
    //      ⚠️ 它**只在历法就是真实公历时才算**（虚拟历法跟现实没有对应关系 ✗）；
    //         闰月不匹配（闰八月十五不算中秋 ✗）；除夕用 `12-LAST`（别写 `12-30` ✗）
    //   ⚠️ 「某月第几个星期日」那种（母亲节 / 感恩节）也在表里 ✓（两种历法都算得出来 ✓）
    //   `md` = `MM-DD`（两位，跟着写法无关，纯坐标 ✓）；`lunar` = `MM-DD` / `MM-LAST` ✓
    calendarHolidays: {
        on: true,
        // ★ 格子里那行农历的小字（跟节日开关各管各的 ✓，出厂开）
        //   读取见 lunarDatesOn()：用 `!== false` ⇒ 老存档没这个键也默认开 ✓
        calendarLunar: true,
        list: [
            { md: '01-01', name: '元旦' },
            { md: '02-14', name: '情人节' },
            { md: '03-08', name: '妇女节' },
            { md: '03-14', name: '白色情人节' },
            { md: '04-01', name: '愚人节' },
            { md: '05-01', name: '劳动节' },
            // ★ 双十一**不算节日**（⇒ 不加 ✗）
            //   ⚠️ 但 520 / 521 要收：它们不是节日、是"特殊日子" ✓
            { md: '05-20', name: '520' },
            { md: '05-21', name: '521' },
            { md: '06-01', name: '儿童节' },
            { md: '09-10', name: '教师节' },
            { md: '10-01', name: '国庆节' },
            // ★ 补：万圣夜和万圣节是两天、名字也不一样 ✓
            //   万圣夜 = 10/31（前夜）、万圣节 = 11/01（当天）⇒ 两条各记一次 ✓
            { md: '10-31', name: '万圣夜' },
            { md: '11-01', name: '万圣节' },
            { md: '12-24', name: '平安夜' },
            { md: '12-25', name: '圣诞节' },
            { md: '12-31', name: '跨年夜' },
            // ★ 「某月第几个星期几」那种（母亲节 / 父亲节 / 感恩节 ✓）
            //   ⚠️ 只在真实公历下算得出来（虚拟历法**没有"一周几天"**这回事 ✗）
            //     ⇒ 虚拟历法加了「一周几天 ＋ 纪元第一天是周几」之后也能算 ✓
            //        （自定义历法按它自己的 `weekLen` / `weekStart` ✓）
            //          ⚠️ 自定义历法下的"周日"只是"一周里第 0 天"那个名字，不一定是现实里的周日 ✓
            //          ⚠️ 农历（`lunar`）那条**只在历法就是真实公历时才算**（见 ui-calendar.js ✓）
            { m: 5, nth: 2, wd: 0, name: '母亲节' },
            { m: 6, nth: 3, wd: 0, name: '父亲节' },
            { m: 11, nth: 4, wd: 4, name: '感恩节' },
            // ⚠️ 农历那几个（春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 除夕）都在出厂表里 ✓
            //   （`src/lunar.js` 表 ＋ 节日表 `{ lunar:'MM-DD' | 'MM-LAST' }` ✓，
            //    写法例：`{ lunar:'08-15', name:'中秋' }`、`{ lunar:'12-LAST', name:'除夕' }`）
            //   ⚠️ 除夕**必须写 `12-LAST`**：农历腊月有的年 29 天、有的年 30 天，
            //     写死 `12-30` 会在 29 天那几年直接漏掉（2025–2028 连着四年都是 29 天 ✗）
            //   ⚠️ 它们**只在"剧情日期是真实公历"时才显示**（虚拟历法跟现实没有对应关系 ✓）
            //   ⚠️ 闰月不算：`08-15` 只认"正常八月十五"（闰八月十五 不当中秋 ✓）
            { lunar: '01-01', name: '春节' },
            { lunar: '01-15', name: '元宵' },
            { lunar: '05-05', name: '端午' },
            { lunar: '07-07', name: '七夕' },
            { lunar: '08-15', name: '中秋' },
            { lunar: '09-09', name: '重阳' },
            { lunar: '12-LAST', name: '除夕' },
        ],
    },

    // ★★ 「现实日历」那份日程 ——
    //   非聊天也能存 —— 记录东西这件事不该被剥夺，走全局这一层就存得下 ✓
    //   ⚠️ 不在聊天里时，面板顶上显示的是**设备日期**（真实公历）⇒ 这份按 **`YYYY-MM-DD`** 存，
    //     **跟插件的自定义历法无关**（不然把历法改成"一年四个月"，现实日程就全对不上 ✗）
    //   ⚠️ 存**全局设置**（穿过所有聊天）—— 它记的是现实里的事，跟哪个聊天没关系 ✓
    //   每条 = { id, date:'YYYY-MM-DD', allDay, start, end, note, at }（形状跟聊天那份一样 ✓）
    realEvents: [],

    // ★★ 现实那份的「已经提示过了」账本（非聊天日历也要提醒 ✓）
    //   ⚠️ 它跟聊天那份的 `state().calendarAlerted` **各记各的**（两份日程本来就不串 ✓）
    //   键 = `YYYY-MM-DD|那行字` ✓
    realAlerted: [],

    // ---- 注入给主 API 的模板（可在 设置 → 补丁 → 注入模板 里改） ----
    // 留空 = 用 prompt.js 里的默认模板
    injectTemplates: {},

    // ---- 自动门控 ----
    // 打开时，带 gate 的模块只在条件满足时才发出去（省 token、也少干扰）
    gates: {
        xeno: true,           // 异种的额外规则，只在对象种族不是人类时发送
        menstruation: true,   // 经期相关的补丁只在来月经时发送
        pregnancy: true,      // 孕期相关的补丁只在怀孕时发送
    },

    // ---- 界面 ----
    // 自定义图标：key -> 图片地址（或 data URL）。空 = 用面板自带的样式。
    // 存成全局（插件设置）而不是按聊天 —— 这是外观偏好，换聊天不该变。
    icons: {},

    // ★ 孩子：只存插件内；要不要也发给主 API（默认**关** ✓）
    children: { toMain: false },

    ui: {
        fabImage: '',
        theme: 'light',
        fabX: null,
        fabY: null,
        /* ★ 悬浮歌词条（外挂歌词那种悬浮歌词 ✓）
           —— 配置**归外壳**存（跟悬浮球位置同一个家 ✓）。
           `sung`/`unsung` 留空 = 跟着主题走（浅色深色各自那个紫和灰 ✓）；
           玩家一旦自己选了颜色就存死值（自定义色不跟主题变，这是必然的 ✓）。
           `alpha` 整条透明度；`lock` 锁住位置；`x`/`y` 拖过之后才有 ✓ */
        lyricBar: {
            on: false,              // 默认**关**（不打扰，自己开 ✓）
            sung: '',               // 已唱那部分的颜色（空 = 用主题的强调色）
            unsung: '',             // 未唱那部分的颜色（空 = 用主题的最淡灰）
            alpha: 0.85,
            // ★ 外挂歌词面板要能缩放大小（默认那个其实挺小的）
            //   ⇒ 出厂就从 1.25 起步（14px × 1.25 ≈ 17.5px，明显大一点 ✓）
            scale: 1.25,
            lock: false,
            // ★ 竖着的歌词条 ⇒ 文字竖着排（从上往下读 ✓）
            vertical: false,
            // ★ 加一排档位按键（四五个）：居中 / 左中 / 右中 / 上中 / 下中 ✓
            //   null = 还没选（走 CSS 那套"底部居中"，跟"下中"是同一个位置 ✓）
            //   'center' | 'left' | 'right' | 'top' | 'bottom'
            //   ⚠️ 档位位置**按当前尺寸现算**（不存死坐标）⇒ 调大字号之后它还贴着那条边 ✓
            //   ⚠️ 拖过之后 pos 会清成 null、改存 x/y（那就是"自定义" ✓）
            pos: null,
            x: null,
            y: null,
        },
        panelX: null,
        panelY: null,
        openTab: 'status',
        showFloorPanel: true,     // 聊天里是否挂楼层面板（每个楼层下面那份）
        presetEntriesClosed: false, // 预设条目列表被手动收起过（记住，别下次又自动摊开）
        settingsSub: 'general',
        // 补丁页在哪个视图：'world' 世界观（所有对象共用）/ 'person' 人物（只给某一个人改）
        //   ★ 切换式界面（分两段太长了、翻着累 ✓）
        patchView: 'world',
        // 人物视图里"正在编辑谁"。
        //   ⚠️ 这里**不能**写 USER_KEY —— 它是 store.js 的 `const`，
        //      而 settings ↔ store 是个模块环（见文件顶部那段说明）⇒
        //      在本文件**顶层**读它会 `Cannot access 'USER_KEY' before initialization` ✗
        //      （默认留空，migrate 里在**运行时**填成本人 ✓）
        patchTarget: '',
        patchCat: 'core',         // 补丁页当前打开的分类
        lastAutoAvatar: '',       // 上次插件自动抓的头像（用来判断玩家有没有手动换过）
        // 「角色基础信息 · 你自己」那一页：上次套上的是哪一份人设版本（人物档案 id）✓
        userPersonaArchive: '',
        // ★ 阶段插图：总开关 + 每个状态的图地址（空 = 显示文字版 ✓）
        //   ⚠️ 用 `stagesCfg()` 读，别直接摸这里（它会补齐老存档缺的结构 ✓）
        stages: { on: true, images: {}, text: {} },
    avatarAlgo: 0,            // 头像抓取算法的版本；算法改了就 +1，强制所有人重算一次
    },
};

/**
 * 补丁页那两个界面字段的兜底 / 迁移（**纯函数**，好单测 ✓）。
 *
 * ★ 补丁页有「世界观 / 人物」两个视图：
 *   · `patchView` 只管界面（'world' 世界观 / 'person' 人物）
 *   · `patchTarget` 在新界面里只表示"人物视图正在编辑谁"
 *     ⚠️ 老值是 `__global__`（旧界面那个"全局那份"下拉）—— 现在**没有这个选项了**
 *        （世界观视图直接编全局）⇒ 换成本人 ✓
 */
export function normalizePatchUi(ui) {
    const u = (ui && typeof ui === 'object') ? ui : {};
    if (!['world', 'person'].includes(u.patchView)) u.patchView = 'world';
    if (!u.patchTarget || u.patchTarget === '__global__') u.patchTarget = USER_KEY;
    return u;
}

/** 老版本存下来的值需要修一修 */
function migrate(s) {
    // ★ 历法（「自定义时间兼容」）：老存档没有这一项、存档里那份也可能被改坏
    //   ⇒ 一律规范化一次（**认不出来回公历** ✓，不抛异常，保证插件总能打开 ✓）
    try { s.calendar = normalizeCalendar(s.calendar); } catch { /* 忽略 */ }
    // 历法预设库：坏值兜成空表 —— 里面每一条在**读的时候**再规范化 ✓
    if (!s.calendarPresets || typeof s.calendarPresets !== 'object' || Array.isArray(s.calendarPresets)) {
        s.calendarPresets = {};
    }
    // 节日表：坏值兜回出厂那张（`list` 不是数组也一起兜 ✓）
    if (!s.calendarHolidays || typeof s.calendarHolidays !== 'object' || Array.isArray(s.calendarHolidays)
        || !Array.isArray(s.calendarHolidays.list)) {
        s.calendarHolidays = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.calendarHolidays));
    }
    // 现实日历那份日程：老存档没有 ⇒ 空表（坏值也兜成空表 ✓）
    if (!Array.isArray(s.realEvents)) s.realEvents = [];
    if (!Array.isArray(s.realAlerted)) s.realAlerted = [];
    // ★ 插件 API 是**多套**⇒ 老存档里那套扁平的要搬进 list[0] ✓
    try { normalizeApi(s.api || (s.api = {})); } catch (e) { console.warn('[Bodycord] 迁移接口配置失败', e); }
    // ★ 身体模块的 id 用 `body_base`（不能只叫 `body`：它旁边就有 body_trace / row_body，
    //   仓库里还有一屏 DOM 的 .modal-body，太容易撞 ✓）
    //   ⇒ **对象专属补丁**是按模块 id 存的 ⇒ 老的键得搬过来，不然玩家手改过的那份会失效 ✗
    try {
        const tp = s.targetPatches;
        if (tp && typeof tp === 'object') {
            for (const name of Object.keys(tp)) {
                const bag = tp[name];
                if (bag && typeof bag === 'object' && bag.body !== undefined && bag.body_base === undefined) {
                    bag.body_base = bag.body;
                    delete bag.body;
                }
            }
        }
        // ⚠️ 同一个改名在**另一个桶**里还有一份：`s.modules['body']` 是「世界观」视图
        //   改过的正文（`moduleText` 读那个）⇒ 只搬 targetPatches 的话，
        //   老存档里在世界观视图改过的身体补丁文案会**静默回落内置默认**，
        //   而旧的 `modules.body` 永远躺在设置里、界面上也列不出来 ✗
        const md = s.modules;
        if (md && typeof md === 'object' && md.body !== undefined && md.body_base === undefined) {
            md.body_base = md.body;
            delete md.body;
        }
    } catch { /* 忽略 */ }

    // ★ 配置迁移（**只跑一次** ✓）—— 用 `schema` 记版本号（这个字段以前是个没人读的死字段，
    //   现在拿它当"设置迁移版本"用 ✓）。为什么要版本号：光凭"值等于某个老默认值"判断太脆弱，
    //   玩家哪天自己又把 maxTargets 填成 8（或 historyDepth 填成 1），**每次加载都会被改回去** ✗
    try {
        const SCHEMA_NOW = 9;
        const from = Number(s.schema) || 1;
        if (from < 2) {
            // 老默认值 → 现行默认（**只有正好等于老默认值时才动**，玩家自己填过的数一律不碰 ✓）
            //   `maxTargets`：8 是旧默认
            //   `historyDepth`：12 是老默认；**1 也是老默认**，但**别再把它当老值顶掉** ——
            //     1 现在是**现行默认** ⇒ 拿它当"老值"去改，等于把玩家故意填的 1 顶回默认 ✗
            //     （而且 1 现在就是默认值，顶着也没用 ✓）
            if (Number(s?.judge?.maxTargets) === 8) s.judge.maxTargets = DEFAULT_SETTINGS.judge.maxTargets;
            if (Number(s?.judge?.historyDepth) === 12) s.judge.historyDepth = DEFAULT_SETTINGS.judge.historyDepth;
        }
        if (from < 9) {
            // ★ 2026-10-15：`historyDepth` 的现行默认从 **3 降回 1**（历史正文是纯浪费）⇒
            //   老存档里"正好还是 3"的跟着降下来 ✓；**玩家自己填过别的数一律不动** ✗
            if (Number(s?.judge?.historyDepth) === 3) s.judge.historyDepth = DEFAULT_SETTINGS.judge.historyDepth;
        }
        if (from < 3) {
            // ★ 「敏感带自定义」是**选开里的选开** ——
            //   它一度被锁成"必开"、界面**不给关**，所以老存档里可能留着一个
            //   `{enabled:false}` ⇒ 解锁后会突然显示成"关"，而它在那段时间明明是开着的 ✗
            //   ⇒ **只跑这一次**把它清掉（= 当成"没选过"，回到默认开 ✓）。
            //   之后玩家自己关掉就是真的关，不会再被改回来 ✓
            try {
                if (s.modules && typeof s.modules === 'object'
                    && s.modules.zones_custom && s.modules.zones_custom.enabled === false) {
                    delete s.modules.zones_custom.enabled;
                }
            } catch { /* 忽略 */ }
        }
        if (from < 4) {
            // ★ 插件接口的「超时」是**秒**（老出厂 120000 毫秒 ⇒ 180 秒 ✓）
            //   `normalizeApi`（在本函数最上面）已经把所有老毫秒换算成了秒，
            //   所以这里只剩一件事：**正好等于老出厂默认 120 秒**的那档抬到新默认 180 秒 ✓
            //   （只有正好等于老默认才动，玩家自己填过的别的数一律不碰 ✓）
            try {
                const list = s?.api?.list;
                if (Array.isArray(list)) {
                    for (const row of list) {
                        if (row && Number(row.timeoutSec) === 120) row.timeoutSec = 180;
                    }
                }
            } catch { /* 忽略 */ }
        }
        if (from < 5) {
            // ★ 周期结算方式的默认是 sperm（难度压得下来靠它 ✓）
            //   老存档里**还是老默认 reset** 的那份才动 —— 玩家自己调过的挡位一律不碰 ✓
            //   而且**只写进「待生效」**：这是规则变体，按规矩卡在周期边界换挡 ✓
            try {
                if (s.cycleSettleMode === 'reset' && !s.cycleSettlePending) {
                    s.cycleSettlePending = 'sperm';
                }
            } catch { /* 忽略 */ }
        }
        if (from < 6) {
            // ★ 日历的节日表补厚（补上万圣节、520 / 521 这种特殊日子，
            //   以及母亲节 / 父亲节 / 感恩节那类"某月第几个周日"）——
            //   ⚠️ 老存档里那份是**旧的**，改默认值**动不了它** ✗
            //   ⇒ 一次性把缺的默认条目补进去；**玩家自己加的一条都不碰**（按 key 判有没有 ✓）
            try {
                const box = s.calendarHolidays;
                if (box && Array.isArray(box.list)) {
                    // ⚠️ 键**只许一处算**（`holidayKeyOf`）—— 不许在这儿自己再抄一套 ✗
                    //   （`holidayKeyOf` 是函数声明 ⇒ 提升过了，在这儿调安全 ✓）
                    const keyOf = (x) => holidayKeyOf(x);
                    const have = new Set(box.list.map(keyOf));
                    for (const def of DEFAULT_SETTINGS.calendarHolidays.list) {
                        if (have.has(keyOf(def))) continue;
                        box.list.push(JSON.parse(JSON.stringify(def)));
                        have.add(keyOf(def));
                    }
                }
            } catch { /* 忽略 */ }
        }
        if (from < 7) {
            // ★ 这两格也是**秒**（毫秒用着很麻烦）✓ —— 跟插件 API「超时」一个套路：
            //   **老毫秒值 ÷1000 换算成秒、删掉老键**（不留两个键做两份真相 ✗）
            //   ⚠️ 0 是合法值（"不等待"）⇒ 不能判成"没填"；没填（undefined）才用新默认 ✓
            try {
                const conv = (msKey, secKey, minSec) => {
                    const old = Number(s[msKey]);
                    if (Number.isFinite(old) && old >= 0) {
                        s[secKey] = Math.max(minSec, Math.round(old / 1000));
                    }
                    delete s[msKey];
                };
                conv('judgeDelay', 'judgeDelaySec', 0);
                conv('judgeRetry', 'judgeRetrySec', 1);
            } catch { /* 忽略 */ }
        }
        if (from < 8) {
            // ★ 出厂再补 7 条**农历**节日
            //   （春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 除夕）——
            //   ⚠️ 和 `from < 6` 同一个老实提醒：**改默认值动不了老存档里那份** ✗
            //     ⇒ 缺的按 key 补进去、**玩家自己加的一条都不碰** ✓
            //   ⚠️ 这一步必须**新开**：老存档在 `from < 6` 那步已经跑过，不会再跑 ✗
            //     （所以 SCHEMA_NOW 跟着 7 → 8 ✓）
            //   ⚠️ 只补 `lunar` 那几条：别的出厂节日在 `from < 6` 那步已经补过，别重复补 ✓
            try {
                const box = s.calendarHolidays;
                if (box && Array.isArray(box.list)) {
                    const keyOf = (x) => holidayKeyOf(x);
                    const have = new Set(box.list.map(keyOf));
                    for (const def of DEFAULT_SETTINGS.calendarHolidays.list) {
                        if (!def.lunar) continue;
                        if (have.has(keyOf(def))) continue;
                        box.list.push(JSON.parse(JSON.stringify(def)));
                        have.add(keyOf(def));
                    }
                }
            } catch { /* 忽略 */ }
        }
        s.schema = SCHEMA_NOW;
    } catch { /* 忽略 */ }

    // ★ `cycle_module` / `pregnancy_module` 是**世界观级**
    //   （生理周期模块塞到世界观里面更合适 —— 总不能有人想有两个人两个精子判定吧？
    //     ＋ 怀孕判定那条「只能改数值模式下本来就不能修改」⇒ 两条都归世界观 ✓）
    //   ⚠️ 老存档里如果有人**在「全文可改」下按对象改过**这两条，那份改动从此不再生效 ✗
    //   ⇒ 最小补救：把**用户本人**那一份搬成全局那份（没有就照旧走内置默认）；
    //      别的对象那份**不删**（留在存档里，可回退 ✓），也**不挑一份代表所有人**
    //      （那会把别人的行为一起改掉 ✗）—— 按聊天存的那份（NPC）同理，留在聊天数据里 ✓
    try {
        // ★ `sperm`（精子与受精描写）也是世界观级 ✓
        //   （受精描写是一套口径，不该跟着人走 ✓）
        const MOVED_TO_WORLD = ['cycle_module', 'pregnancy_module', 'sperm'];
        for (const id of MOVED_TO_WORLD) {
            if (!s.modules || typeof s.modules !== 'object') break;
            const hasGlobal = typeof s.modules[id]?.text === 'string' && s.modules[id].text.length > 0;
            if (hasGlobal) continue;
            const mine = s.targetPatches?.[USER_KEY]?.[id];
            if (typeof mine === 'string' && mine.length) s.modules[id] = { ...(s.modules[id] || {}), text: mine };
        }
    } catch { /* 忽略 */ }

    // ★ 「泌乳与产后系统」**拆成两条**（泌乳系统 / 产后恢复与产奶量）——
    //   泌乳的可以不用抠、产后相关的得抠掉 ✓（拆开才能按人藏起来 ✓）
    //   ⇒ 老设置里把那条**开着**的人，新的「产后恢复与产奶量」也一起开
    //     （不然他会悄悄少一段规则，而界面上看不出少了什么 ✗）
    try {
        if (s.modules?.lactation_system?.enabled === true && s.modules?.postpartum_system === undefined) {
            s.modules.postpartum_system = { enabled: true };
        }
    } catch { /* 忽略 */ }

    if (!s.ui || typeof s.ui !== 'object') return s;
    // 「骰子」页签已经搬进聊天面板侧栏了，老的 openTab='dice' 会让面板空白
    if (s.ui.openTab === 'dice') s.ui.openTab = 'status';
    if (!['status', 'settings'].includes(s.ui.openTab)) s.ui.openTab = 'status';
    // ★ 补丁页是「世界观 / 人物」两个视图 ——
    //   老设置里 patchTarget 是 `__global__`（那是旧界面的"全局那份"）⇒
    //   现在**没有"全局"这个选项了**（世界观视图直接编全局）⇒ 换成本人 ✓
    normalizePatchUi(s.ui);
    return s;
}

function deepMerge(base, patch) {
    if (patch === null || patch === undefined) return base;
    if (Array.isArray(base) || typeof base !== 'object') return patch;
    if (typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        out[k] = (k in base) ? deepMerge(base[k], v) : v;
    }
    return out;
}

let _cache = null;
let _detached = false;

export function settings() {
    const store = getExtensionSettings();

    if (_cache) {
        // 第一次调用时可能酒馆还没就绪，拿到了内存兜底版。
        // 一旦真正的存储可用了，就把这份设置接进去，避免「改了不生效」。
        if (_detached && store) {
            _detached = false;
            if (!store[KEY]) store[KEY] = _cache;
            else _cache = migrate(deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), store[KEY]));
            saveSettings();
        }
        return _cache;
    }

    if (!store) {
        console.warn('[Bodycord] 拿不到酒馆的 extension_settings，设置暂时只在内存里');
        _detached = true;
        _cache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        return _cache;
    }

    const cur = store[KEY];
    const merged = migrate(deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), cur || {}));
    store[KEY] = merged;
    _cache = merged;
    return _cache;
}

export function save() {
    const s = settings();
    const store = getExtensionSettings();
    if (store) store[KEY] = s;
    saveSettings();
}

/** 某条模块的最终开关状态 */
export function isModuleOn(id) {
    const mod = MODULES.find(m => m.id === id);
    if (!mod) return false;
    // ★★ 2026-10-15（打开敏感带记录时强制打开等级表现参考、不许关）——
    //   带 `follow` 的模块，开关**完全跟着本体走**：本体开 ⇒ 它开（而且关不掉，见 setModuleOn）；
    //   本体关 ⇒ 它也关 ✓（它自己的 `enabled` 在这条上不算数 ✓）
    if (mod.follow) return isModuleOn(mod.follow);
    // ★ 必开模块一律算开：**无视历史存档** ✓
    //   为什么：`setModuleOn` 不让关必开模块（不会写进 false），但**在它被标成必开
    //   之前**玩家可能已经关过 ⇒ 存档里留着 `{enabled:false}` ⇒ 那条会永远不发 ✗。
    //   （「敏感带自定义」一度从选开改成必开 ⇒ 解锁那一条的旧 false 走下面的迁移清掉 ✓
    //     现在真正锁死的只剩 4 条：core / body_base / cycle_module / pregnancy_module ✓）
    if (mod.locked) return true;
    const ov = settings().modules?.[id];
    if (ov && typeof ov.enabled === 'boolean') return ov.enabled;
    return !!mod.enabled;
}

/**
 * ★ 敏感带**这套功能**现在开着吗 —— 总开关是「身体敏感带记录」✓
 *
 * ★ **敏感带记录是选开的东西，敏感带自定义是在敏感带记录
 * 基础上才用得上的东西** ✓ —— 所以「记录」是唯一的总开关，「自定义」跟着它走
 * （模块上写了 `requires: 'zones_record'` ✓）。
 *
 * ⚠️ 别写成 `isModuleOn('zones_record') || isModuleOn('zones_custom')` ✗ ——
 *   「自定义」是**建立在记录之上**的东西（它可能被玩家自己关掉）⇒ 用它当判据会出现
 *   "记录关着、却还在写 d9 / 还在发敏感带那一行"的半套状态 ✗
 *   （它一度被标成必开 ⇒ `||` 那个写法会**恒为真** ✗）
 */
export function zonesFeatureOn() {
    return isModuleOn('zones_record');
}

/**
 * 开 / 关一个模块。
 *
 * ★ 有前置（`requires`）的模块被打开时，**顺手把缺的那个本体也开上**，不直接拒绝 ✓
 *   为什么不拒绝：拒了之后界面上只剩一个"🔒 需先开本体"，玩家还得自己去找那张卡 ✗
 *
 * @returns {string[]} 这次**顺手打开**的模块 id（空数组 = 没顺手开东西）
 *   ⚠️ 只是想给调用方弹一句提示用；老调用点不看返回值也照旧 ✓
 */
export function setModuleOn(id, on, _seen = null) {
    const mod = MODULES.find(m => m.id === id);
    // 必开模块在数据层也锁住，防止别处误改（UI 上开关本来就是锁的）
    if (mod && mod.locked && on === false) return [];
    // ★ 跟随型模块（`follow`）：**本体开着时不许关它** ✓
    //   —— 就是强制打开、不能关（关掉它，模型就不认识"3级"了 ✗）
    if (mod && mod.follow && on === false && isModuleOn(mod.follow)) return [];
    const s = settings();

    // ★ 硬条件：本体没开时，**顺手把它开上**（在数据层做，UI 就不用自己记 ✓）
    //   ⚠️⚠️ 这一段仍然必须在**任何赋值之前** —— `settings()` 返回的就是酒馆 store 里
    //   那个对象（引用）⇒ 先写进去就已经生效了，后面 `return` 根本回滚不掉，
    //   而且同一条调用链里后面任何一次 `save()` 都会把它落盘 ✗
    //   （症状：补丁页「全部打开」把 heritage_xeno / sperm_xeno 一起点亮，
    //     UI 又把它们的开关换成「🔒 需先开本体」⇒ **没有开关能关掉**，状态卡死 ✓）
    const autoOn = [];
    if (on && mod?.requires) {
        const reqs = Array.isArray(mod.requires) ? mod.requires : [mod.requires];
        const seen = _seen || new Set([id]);       // 防环：本体自己也可能有前置 ✓
        for (const r of reqs) {
            if (seen.has(r)) continue;
            seen.add(r);
            if (!isModuleOn(r)) {
                const sub = setModuleOn(r, true, seen) || [];
                autoOn.push(r, ...sub);
            }
        }
        // ⚠️ 互斥组：顺手开的那个本体如果和别的变体互斥，就在下面那道互斥检查里处理 ✓
    }

    // ★ 互斥组：同一个 exclusive 组里的模块只能开一个。
    //   这些是「现实向 / 二次元向」「人类 / 异种版」这类**变体** ——
    //   门控只管「怀没怀孕」时两个能同时开，于是两套几乎一样的文案
    //   一起发出去，**风格指令还互相矛盾**（"要现实向" + "要二次元轻松向"）。
    if (on && mod?.exclusive) {
        for (const other of MODULES) {
            if (other.exclusive === mod.exclusive && other.id !== id) {
                s.modules[other.id] = { ...(s.modules[other.id] || {}), enabled: false };
            }
        }
    }

    s.modules[id] = { ...(s.modules[id] || {}), enabled: !!on };

    // ★ 反过来：关掉本体时，把依赖它的变体一并关掉 ——
    //   否则会留下「变体开着、本体关着」的无效状态（门控虽然也不会发，
    //   但界面上那个开关是亮的，看着像生效了）。
    if (!on) {
        for (const other of MODULES) {
            if (!other.requires) continue;
            const rs = Array.isArray(other.requires) ? other.requires : [other.requires];
            if (rs.includes(id)) s.modules[other.id] = { ...(s.modules[other.id] || {}), enabled: false };
        }
    }
    save();
    return autoOn;   // 顺手开了哪些（空数组 = 没顺手开东西 ✓）
}

/**
 * 启动时清理互斥冲突：同一个 exclusive 组里有多个开着的话，只留**第一个**。
 *
 * 为什么要它：互斥只在 setModuleOn 里生效，**已经存下的**冲突状态不会被自动纠正。
 * 返回被关掉的模块名，供界面提示。
 */
export function sanitizeModuleExclusivity() {
    const s = settings();
    const seen = new Map();
    const turnedOff = [];
    for (const mod of MODULES) {
        if (!mod.exclusive) continue;
        const on = isModuleOn(mod.id);
        if (!on) continue;
        if (seen.has(mod.exclusive)) {
            s.modules[mod.id] = { ...(s.modules[mod.id] || {}), enabled: false };
            turnedOff.push(mod.name);
        } else {
            seen.set(mod.exclusive, mod.id);
        }
    }
    if (turnedOff.length) save();
    return turnedOff;
}

/**
 * 自动门控是否启用。
 * 打开之后，带 gate 的模块只有在条件满足时才真的发出去 ——
 * 比如「经期其他角色反应」只在角色来月经时才发，平时一个字都不占。
 */
export function isGateEnabled(kind) {
    return settings().gates?.[kind] !== false;
}

export function setGateEnabled(kind, on) {
    const s = settings();
    if (!s.gates) s.gates = {};
    s.gates[kind] = !!on;
    save();
}

// ---------------------------------------------------------------------------
// 字段级开关
//
// 有的人只想看经期记录、不想要身体状态描述，有的人反过来。
// 所以每个字段都能单独关掉 —— 关掉之后：
//   · 推演引擎不再需要它（输出契约里直接不提，省输出 token）
//   · 面板上不显示
//   · 发给主 API 的状态摘要里也不出现
// 默认全开。
// ---------------------------------------------------------------------------

export const ALL_FIELDS = [
    'title', 'phase', 'sub', 'minor', 'calc',
    'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9',
    'row1', 'row2', 'row3',
];

/** 字段分组的显示名（界面分组用） */
export const FIELD_GROUPS = [
    ['basic', '基础信息', ['title', 'phase', 'sub', 'minor', 'calc'],
        '面板顶部那几行：标题、阶段进度、时间/防护/风险、计算过程'],
    ['items', '数据项 d1~d9', ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'],
        '阶段基础率、累计受孕率、体质系数、致孕方、意识状态、胎儿、泌乳、生产次数、敏感带'],
    ['rows', '状态条 row1~row3', ['row1', 'row2', 'row3'],
        '生理状态、身体状况、近期性行为，这三条是给正文描写看的身体状态描述'],
];

export const FIELD_LABEL = {
    title: '状态标题', phase: '阶段名', sub: '进度（Day / 孕周）',
    minor: '次要描述（时间 / 防护 / 风险）', calc: '计算说明',
    d1: 'd1 阶段基础率', d2: 'd2 累计受孕率', d3: 'd3 体质系数', d4: 'd4 致孕方',
    d5: 'd5 意识状态', d6: 'd6 胎儿状态', d7: 'd7 泌乳状态', d8: 'd8 生产次数',
    d9: 'd9 敏感带',
    row1: 'row1 生理状态', row2: 'row2 身体状况', row3: 'row3 近期性行为',
};

/** 这个字段开着没有（默认开） */
export function isFieldOn(key) {
    const f = settings().fields;
    if (!f || typeof f !== 'object') return true;
    return f[key] !== false;
}

export function setFieldOn(key, on) {
    const s = settings();
    if (!s.fields || typeof s.fields !== 'object') s.fields = {};
    s.fields[key] = !!on;
    save();
}

/** 一次性设置一组 */
export function setFieldGroup(keys, on) {
    const s = settings();
    if (!s.fields || typeof s.fields !== 'object') s.fields = {};
    for (const k of keys) s.fields[k] = !!on;
    save();
}

/**
 * 「周期结算模式」的两段精子规则 —— 按**生效中的模式**二选一注入。
 *
 * 两套互斥的规则放在同一个里面会让 AI 产生幻觉 ⇒ 提示词必须隔离开：
 * ⇒ 必须隔离 ✓（两套互斥的规则同时出现，AI 会打架 ✗）
 *
 * ⚠️ 读 cycleSettleMode（生效中），不读 cycleSettlePending（待生效）✓
 *
 * ★ sperm 那段里的「1~3 天」不能**写死在文案里**：
 *   「精子存活期」在设置里有旋钮（spermLifeMin / spermLifeMax）⇒ 写死就是两处事实源 ✗
 *   ⇒ 改成**发送时按旋钮填充**：旋钮调过，提示词里那个区间跟着变 ✓
 *   ⚠️ 顺序一律从小到大（min>max 由玩家填坏时也自愈 ⇒ 和 judgment.js 的掷骰口径一致 ✓）
 */
function spermRuleBlock(settle) {
    if (settle !== 'sperm') {
        return [
            '- 本周期内的精子一律视为存活，全部参与受精判定，不按天数推算死亡。',
            '- 进入新周期后，上周期精子全部清零。',
        ].join('\n');
    }
    const s = settings();
    const lo = Math.max(1, Math.min(30, Math.round(Number(s.spermLifeMin) || 1)));
    const hi = Math.max(1, Math.min(30, Math.round(Number(s.spermLifeMax) || 7)));
    const life = Math.min(lo, hi) === Math.max(lo, hi)
        ? `${Math.max(lo, hi)} 天`
        : `${Math.min(lo, hi)}~${Math.max(lo, hi)} 天`;
    // ★ 失活之后"还剩下什么"要看判定口径 ⇒ 这一句分两档写（见 judgeValueRule 那段说明）
    const afterDead = (judgeBasisOf() === 'alive')
        ? '- 超过存活期限的批次即为「已失活」。它此前贡献过的点数仍然留在累计受孕率里，累计率不会因为失活而变小；但判定时不把它算进去，也不会把它点名成致孕方。'
        : '- 超过存活期限的批次即为「已失活」。它此前贡献过的点数仍然留在累计受孕率里，累计率不会因为失活而变小；判定时它照样计入判定值，只是不再被点名成致孕方。';
    return [
        `- 每批精子有自己的存活期限：内射后存活 ${life}，具体几天由系统掷定，不要自己推算。`,
        afterDead,
        '- 进入新周期后不清零，靠各自的存活期限自然失效。',
    ].join('\n');
}

/**
 * ★★ 「判定值取哪个数」那一句 —— 按**结算方式 × 判定口径**渲染。
 *
 * 为什么必须单独一条：这句话原来是**写死的**（"取窗口结束那一刻的累计受孕率"），
 *   而另一条（精子存活那段的旧文案）又写着"只累计届时尚在存活期内的批次"
 *   ⇒ 两份口径同时出现，模型只能自己挑一个 ⇒ 计算说明与面板打架 ✗
 *   ⇒ 现在只留这一个出口，两档分别写死，不给它挑的余地 ✓
 *
 * @param {'sperm'|'reset'} settle 生效中的结算方式
 */
function judgeValueRule(settle) {
    const tail = '窗口结束之后发生的行为不参与本周期判定（照常累加进累计受孕率，口径同过渡日）。';
    if (settle !== 'sperm') {
        return `- 判定值取@@TERM:ovulationWindow@@结束那一刻的累计受孕率；${tail}`;
    }
    if (judgeBasisOf() === 'alive') {
        return `- 判定值只取@@TERM:ovulationWindow@@结束那一刻还在存活期内的那几批的贡献之和；已经失活的批次不计入判定值（它们计过的贡献仍然留在累计受孕率里，只是判定不用它）。${tail}`;
    }
    return `- 判定值取@@TERM:ovulationWindow@@结束那一刻的累计受孕率，失活批次已经计过的贡献照样算在里面；${tail}`;
}

/** 按当前模式把模块文案里的占位符换掉 */
/**
 * 周期模式（月经 / 非月经）相关的占位符 ✓
 *
 * 设计（不要全 BAN：有覆盖别的的，只需要把月经扣掉就可以 ✓）：
 *   · 整模块级 ⇒ 用已有的 gate（period_* 三个模块 ✓）
 *   · **段落 / 词级 ⇒ 用这里的占位符** ✓✓✓
 *     @@PHASE_MENSTRUAL@@ 之类的 ⇒ 按模式换成对应的名字 ✓
 *     @@MENSTRUATION_BLOCK@@ ⇒ 月经专属段落，非月经模式下**整个消失** ✓
 *
 * ⚠️ 受孕机制**完全不动** ✓（受孕机制还是和月经模式一样）
 *   ⇒ 只换名字、只扣月经专属段落 ✓
 */
/** 内置兜底术语表（设置被改坏时用）—— ★ 导出给界面用（"生理期名字"那张表要显示默认值 ✓） */
export const DEFAULT_TERM_NAMES = {
    ovulationWindow: '排卵窗口', ovulationDay: '排卵日', ovum: '卵子',
    cervicalMucus: '宫颈粘液', follicle: '卵泡', corpusLuteum: '黄体',
};

/**
 * ★ 周期模式的**三档**（第三档是「无月经」）。
 *
 * 定案：**无月经就是没有阶段、也不需要阶段** —— 总得给男玩家一个出路 ✓
 *   · `normal`     有月经（完整版：经血描写 + 阶段名带"月经期"）
 *   · `none`       非月经（**中性说法**，经血全扣；**周期照旧推、照样能怀孕** ✓）
 *   · `amenorrhea` 无月经（**没有周期、没有阶段** —— 男玩家 / 不来月经的种族走这档 ✓）
 *
 * ⚠️ 前两档只差**用词**；第三档是**机制上真的没有那套** ⇒ 消费端要逐个接（见各调用处 ✓）
 */
export function isNeutralMode(mode) {
    const m = mode || periodMode();
    return m === 'none' || m === 'amenorrhea';
}

/** ★ 这个档**没有周期 / 没有阶段**（无月经那档 ✓） */
export function isNoCycleMode(mode) {
    return (mode || periodMode()) === 'amenorrhea';
}

/** ★ 档位的**显示名**（三档统一写在这一处，别在三个页面各写一遍 if ✓） */
export function cycleModeLabel(mode) {
    const m = mode || periodMode();
    return m === 'amenorrhea' ? '无月经' : (m === 'none' ? '非月经' : '月经');
}

/**
 * ★★ 受精判定的**口径**：'cumulative'（累计受孕率，默认）/ 'alive'（仅存活精子）。
 *
 * 为什么要归一而不是直接读字段：老存档没有这个键、设置被手改也可能写进别的值
 *   ⇒ 读到不认识的值会让下游两个分支都走不进去、判定悄悄按 0 算（那是静默改判定 ✗）
 *   ⇒ 一律回默认档，认不出就当累计。
 */
export function judgeBasisOf() {
    return settings().judgeBasis === 'alive' ? 'alive' : 'cumulative';
}

/** 当前（或指定）模式下某个术语该写什么 ✓
 *  ★ 可选的 `mode` —— 周期模式是**按人**的（有人有月经、有人没有 ✓），
 *    所以发送时要按**那个人**的档来换名字 ✓；不传就还是看全局默认（向后兼容 ✓）
 *  ★ 三档之后：**非月经 / 无月经共用那一套中性词** ✓ */
export function termNameOf(termId, mode) {
    const s = settings();
    const table = isNeutralMode(mode) ? s.termNamesNone : s.termNamesNormal;
    return (table && table[termId]) || DEFAULT_TERM_NAMES[termId] || String(termId);
}

/** 全局默认档（新建角色跟着它；每个角色可以各自覆盖 ✓） */
export function periodMode() {
    const v = settings().periodMode;
    return (v === 'none' || v === 'amenorrhea') ? v : 'normal';
}

/** 当前（或指定）模式下某个 phaseId 该显示的名字 */
export function phaseNameOf(phaseId, mode) {
    const s = settings();
    const table = isNeutralMode(mode) ? s.phaseNamesNone : s.phaseNamesNormal;
    return (table && table[phaseId]) || DEFAULT_PHASE_NAMES[phaseId] || String(phaseId);
}

/** 内置兜底（设置里被改坏时用）—— ★ 导出给界面用 ✓ */
export const DEFAULT_PHASE_NAMES = {
    menstrual: '月经期', follicular: '卵泡期', ovulation: '排卵期',
    ovulationDay: '排卵期（排卵日）', transition: '排卵后过渡期', luteal: '黄体期',
};

/**
 * 把**当前**那四个基础率渲染进提示词正文。
 *
 * 为什么要有它（而不是把 `@@RATE:xx@@` 占位符写进正文）：
 *   ① 正文里要留**人话**「基础率 8%」—— 玩家在补丁编辑器里看到的是这个，
 *      写占位符他会一脸问号 ✗；
 *   ② 而判定读的必须是 `settings` 里那四个数（见 `cycleDayInfoOf`）⇒
 *      两个地方要同一个数，就得在**发送时**拿设置去覆盖正文里的数字 ✓
 *   ③ 出厂时渲染结果 = 正文原样（数字一个都不变）⇒ 12 类型数字基线不用重算 ✓
 *
 * ⚠️ 改这里的正则前先看这三条：
 *   · 只在**行首**锚（`基础率` 在别处也出现过，泛匹配会误伤 ✗）
 *   · [身体补丁] 那句是带括号的「基础率同样按阶段表计（1%）」✓
 *   · 示例那句「=（8% × 1.0 × 1.0）」用的是**卵泡期**那个数 ⇒ 跟着换，免得正文里出现
 *     两个不同的卵泡期数字（AI 会挑一个信，那就白改 ✗）
 */
/** 防护系数（乘数）的出厂值 —— 与正文里那 8 处逐字一致 ✓ */
export const PROT_COEF_DEF = {
    internal: 1.0, friction: 0.3, condomTorn: 0.3, condomBurst: 1.0,
    condomSlipOff: 0.3, outPull: 0.5, pillShort: 0.05, condomIntact: 0,
    // 前液也必须判——
    //   没射精、只有前液 / 前列腺液混着体液流到入口或外阴 ⇒ 也算一笔（系数 0.1）
    //   ⚠️ 它是**接触**，不是内射：账本里要能分出来（见 store.js 的 GUARD_DEFS 那条 `pre`）✓
    pre: 0.1,
};

/**
 * 取一个防护系数（设置里的；不合法 ⇒ 回出厂 ✓。夹 0~10，保留两位小数）。
 *
 * ⚠️ 数字转字符串会**吃掉 .0**：出厂 `1.0` 渲染成 `1`、`0` 还是 `0`。
 *   这不影响判定（1 和 1.0 是同一个数），正文读起来也自然；但**写断言时别写成 `1.0`** ✗
 *   （断言里写成 `1.0` 会假红一次 ✗）
 */
export function protCoefOf(key) {
    const def = PROT_COEF_DEF[key];
    const raw = settings()['prot' + key.charAt(0).toUpperCase() + key.slice(1)];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10) return def;
    return Math.round(n * 100) / 100;
}

/**
 * 把**当前**那 8 个防护系数渲染进提示词正文。
 *
 * 为什么要有它：这 8 个数只写在正文里、**没有任何代码读**（算增量是 AI 干的 ⇒ 它们
 * 本质是"给 AI 的规则参数"）⇒ 玩家想调难度就只能改两千字的正文 ✗。
 * ⇒ 现在设置是唯一真相源，正文里那 8 处**在发送时**按设置渲染 ✓
 *   ★ 这 8 个数**代码也读**（A1：模型只报防护情境，乘数与累加归插件 ⇒ 见 store.js 的
 *     `inseminationGainOf()`）⇒ 面板改一格，判定与提示词一起变 ✓
 *   ⚠️ 正文里仍然留着这 8 个数，是给模型判"哪种情境更重"当参照用的，不是让它去乘 ✓
 *
 * ⚠️ 改这里的正则前先看这三条：
 *   · 这 8 个数里 0.3 出现了**四回**（摩擦 / 破损 / 掉落 / 磨损）⇒
 *     一律用"那一行独有的中文"当锚，**绝不**拿一个纯数字当正则 ✗（会连改好几行）
 *   · 短效药那句是 `按系数 0.05 计算`（数在中文之间）✓
 *   · 出厂值渲染 = 正文原样（数字基线不用重算 ✓）
 */
function applyProtectionByKey(t, keys) {
    let out = String(t);
    for (const key of keys) {
        const v = protCoefOf(key);
        switch (key) {
            case 'internal':
                out = out.replace(/^(- 内射 )[\d.]+$/m, `$1${v}`);
                break;
            case 'pre':
                // ★ 2026-10-17 新加的那一档（前液接触）—— 锚在它自己那句独有的中文上 ✓
                out = out.replace(/(- 前液接触[\s\S]{0,120}?系数 )[\d.]+/m, `$1${v}`);
                break;
            case 'friction':
                out = out.replace(/^(- 外部摩擦、体液接触 )[\d.]+/m, `$1${v}`);
                break;
            case 'condomTorn':
                out = out.replace(/(明确破损：[\s\S]{0,20}撕裂 )[\d.]+/m, `$1${v}`);
                break;
            case 'condomBurst':
                out = out.replace(/(明确破损：[\s\S]{0,60}破裂 )[\d.]+/m, `$1${v}`);
                break;
            case 'condomSlipOff':
                out = out.replace(/(前列腺液流出 )[\d.]+/m, `$1${v}`);
                break;
            case 'outPull':
                out = out.replace(/(- 无套外射[\s\S]{0,80}系数 )[\d.]+/m, `$1${v}`);
                break;
            case 'pillShort':
                out = out.replace(/(按系数 )[\d.]+( 计算)/, `$1${v}$2`);
                break;
            case 'condomIntact':
                out = out.replace(/(顺畅无异常 → 默认“完好无损”，系数 )[\d.]+/m, `$1${v}`);
                break;
            default: break;
        }
    }
    return out;
}

/**
 * 意识状态那五档的**察觉时间**渲染。
 *
 * 每档存 **6 个数**：`[怀疑周起, 怀疑周止]`、`[确认周起, 确认周止]`、`[怀疑天数起, 怀疑天数止]`、
 * `[确认天数起, 确认天数止]`。
 *
 * ⚠️⚠️ 别想当然，这两条都踩过：
 *   ① **天数推不出来** —— 它跟孕周不成比例（A 档 孕3-4 周 ↔ 着床后 0-7 天；C 档 孕6-8 周 ↔ 21-35 天；
 *      E 档 孕16-20 周 ↔ 91-119 天 ⇒ 每档的"差几周"都不一样）✗
 *   ② **周区间也不是"起 ~ 起+1"** —— A/B 档是，C 档是 孕5-6 / 孕6-8、D 档是 8-12 / 12-16 ✗
 *   ⇒ **只能按原文老实存**。这么设计唯一的收益是：面板上改一个数，正文那行立刻跟着变 ✓
 */
function awarenessTierOf(k) {
    const def = AWARENESS_TIER_DEF[k];
    const v = settings()['awarenessTier' + k];
    const wk = (x, d) => {
        const n = Math.round(Number(x));
        return (Number.isFinite(n) && n >= 1 && n <= 45) ? n : d;
    };
    const dy = (x, d) => {
        const n = Math.round(Number(x));
        return (Number.isFinite(n) && n >= 0 && n <= 400) ? n : d;
    };
    const p = (f, fbk, conv) => conv((v && v[f] !== undefined) ? v[f] : fbk, fbk);
    return {
        suspW0: p('suspW0', def.suspW0, wk), suspW1: p('suspW1', def.suspW1, wk),
        confW0: p('confW0', def.confW0, wk), confW1: p('confW1', def.confW1, wk),
        suspD0: p('suspD0', def.suspD0, dy), suspD1: p('suspD1', def.suspD1, dy),
        confD0: p('confD0', def.confD0, dy), confD1: p('confD1', def.confD1, dy),
    };
}

export const AWARENESS_TIER_DEF = {
    A: { suspW0: 3, suspW1: 4, suspD0: 0, suspD1: 7, confW0: 4, confW1: 5, confD0: 7, confD1: 14 },
    B: { suspW0: 4, suspW1: 5, suspD0: 7, suspD1: 14, confW0: 5, confW1: 6, confD0: 14, confD1: 21 },
    C: { suspW0: 5, suspW1: 6, suspD0: 14, suspD1: 21, confW0: 6, confW1: 8, confD0: 21, confD1: 35 },   // 默认档
    D: { suspW0: 8, suspW1: 12, suspD0: 35, suspD1: 63, confW0: 12, confW1: 16, confD0: 63, confD1: 91 },
    E: { suspW0: 16, suspW1: 20, suspD0: 91, suspD1: 119, confW0: 20, confW1: 28, confD0: 119, confD1: 175 },
    F: { suspW0: 28, suspW1: 34, suspD0: 175, suspD1: 217, confW0: 34, confW1: 40, confD0: 217, confD1: 259 },
};

/** 一格的「怀疑/确认」半句，写成「孕X-Y周（着床后A-B天）」 */
function pregPhrase(w0, w1, d0, d1) {
    return `孕${w0}-${w1}周（着床后${d0}-${d1}天）`;
}

/**
 * ★ A3（2026-10-14）：**某一档的四个区间**给代码读（跟面板同一个来源 ✓）。
 *
 * 病根：以前这四个区间只**渲染进正文**、由模型每轮读表判「该不该怀疑 / 该不该确认」✗
 *   ⇒ 现在判定归插件：档位由模型只报一次（角色设定），怀疑/确认由这里算 ✓
 * @param {string} letter A~E（认不出 ⇒ 回 C 档，正文那条"信息不足默认 C档"同一个口径 ✓）
 */
export function awarenessWindowsOf(letter) {
    const k = String(letter ?? '').trim().toUpperCase();
    return awarenessTierOf(Object.prototype.hasOwnProperty.call(AWARENESS_TIER_DEF, k) ? k : 'C');
}

/**
 * ★ 察觉的**绝对上限**（E 档那句「上限：孕32周（着床后203天）」）——
 *   超过它还不确认就说明时间表已经用完了 ⇒ 由插件强制切成已确认 ✓
 *   ⚠️ 203 不是 32×7（=224）⇒ 两个数分开存、分开读 ✓
 */
export function awarenessUpperOf() {
    const wk = Math.round(Number(settings().awarenessUpper));
    const dy = Math.round(Number(settings().awarenessUpperDays));
    return {
        week: (Number.isFinite(wk) && wk >= 1 && wk <= 45) ? wk : 32,
        days: (Number.isFinite(dy) && dy >= 0 && dy <= 400) ? dy : 203,
    };
}

// ---------------------------------------------------------------------------
// ★ A5（2026-10-14）：**胎数 / 孩子性别**那两张表 —— 从正文里读出来
//
// 为什么读正文、不把表写进代码：
//   那张表现住在 `pregnancy_module` 的正文里，玩家能在面板上改（想调双胎概率就改它 ✓）
//   ⇒ 搬进代码 = 夺走可编辑性 ✗（跟敏感带阈值表同一个判据，见 `zoneParamsOf` ✓）
//
// ⚠️ 认不出来 ⇒ **一律返回空**，调用方退回"这轮不接管、让模型照旧判" ✓
//   （正文格式被改过就静默失效是最坏的结果 ⇒ 宁可退回老行为，也不瞎猜）
// ---------------------------------------------------------------------------

/** 「单胎 / 双胎 / …」→ 个数（认不出 ⇒ 0 ✓） */
function countOfWord(w) {
    const s = String(w ?? '').trim();
    const num = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8 };
    let m = s.match(/^([一二两三四五六七八])胎/);
    if (m) return num[m[1]] || 0;
    m = s.match(/^(\d+)\s*(?:胎|枚|个)/);
    if (m) return Number(m[1]);
    m = s.match(/^(单胎|双胎|双胞胎|多胎)/);
    if (m) return { 单胎: 1, 双胎: 2, 双胞胎: 2, 多胎: 0 }[m[1]] ?? 0;
    return 0;
}

/**
 * [怀孕判定模块] 里那张胎数表 ⇒ `[{from, to, n}]`（认不出 / 表被改烂 ⇒ `[]` ✓）。
 * 形态：`D100：1-78 单胎，79-94 双胎，95-98 三胎，99-100 四胎或以上`
 */
export function fetusCountTableOf(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        const line = (t.match(/D100\s*[：:]\s*([^\n]+)/) || [])[1] || '';
        const rows = [];
        const re = /(\d+)\s*-\s*(\d+)\s*([^，,。；;]+)/g;
        let m;
        while ((m = re.exec(line))) {
            const n = countOfWord(m[3]);
            const from = Number(m[1]), to = Number(m[2]);
            if (n > 0 && Number.isFinite(from) && Number.isFinite(to) && to >= from) {
                rows.push({ from, to, n });
            }
        }
        return rows;
    } catch { return []; }
}

/**
 * 池里那个数 ⇒ 这一胎几个孩子（认不出 ⇒ 0 ✓）。
 * 上限那条（「四胎或以上」）按 4 算 —— 正文写着具体数量"由推演者决定" ✓
 */
export function fetusCountOf(targetKey = null, value = null) {
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;
    const hit = fetusCountTableOf(targetKey).find((r) => v >= r.from && v <= r.to);
    return hit ? hit.n : 0;
}

/**
 * 同一份正文里的性别区间 ⇒ `{ male:[a,b], female:[a,b] }`（认不出 ⇒ null ✓）。
 * 形态：`1-50 判为男，51-100 判为女`（老正文写的是「为雄性 / 为雌性」⇒ 两种都认 ✓）
 */
export function fetusSexRangeOf(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        // ★ 三种写法都要认：为新版「判为男」、老版「为雄性」、手改过的「为男性」
        const m = t.match(/(\d+)\s*-\s*(\d+)\s*判?为(?:雄性|男性|男)\s*[，,]\s*(\d+)\s*-\s*(\d+)\s*判?为(?:雌性|女性|女)/);
        if (!m) return null;
        const male = [Number(m[1]), Number(m[2])];
        const female = [Number(m[3]), Number(m[4])];
        if (!male.every(Number.isFinite) || !female.every(Number.isFinite)) return null;
        return { male, female };
    } catch { return null; }
}

/**
 * 同一份正文里的「同卵 / 异卵」区间 ⇒ `{ same:[a,b], diff:[c,d] }`（认不出 ⇒ null ✓）。
 * 形态：`同卵判定（D100）：1-33 同卵，34-100 异卵`
 *
 * ⚠️ 只有**多胎**才用得着它（单胎没什么同卵异卵之分）⇒ 单胎根本不掷。
 * ⚠️ 认不出（玩家把这段删了 / 同卵就对上异种表那一路）⇒ 返回 null ⇒
 *    调用方**照旧各自独立判性别**，老行为一字不变 ✓（宁可退回老行为，也不瞎猜）
 */
export function fetusOvumRangeOf(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        const m = t.match(/(\d+)\s*-\s*(\d+)\s*同卵\s*[，,]\s*(\d+)\s*-\s*(\d+)\s*异卵/);
        if (!m) return null;
        const same = [Number(m[1]), Number(m[2])];
        const diff = [Number(m[3]), Number(m[4])];
        if (!same.every(Number.isFinite) || !diff.every(Number.isFinite)) return null;
        return { same, diff };
    } catch { return null; }
}

/**
 * ★ 2026-10-23：同一份正文里的「混合胎」区间 ⇒ `{ none:[a,b], mixed:[c,d] }`（认不出 ⇒ null ✓）。
 * 形态：`混合胎判定（D100）：1-95 不混合，96-100 混合`
 *
 * 用途：只有**胎数 ≥3 且整胎已判成异卵**时才掷它；命中混合＝一对同卵 ＋ 其余异卵。
 * ⚠️ 老正文没有这一行 ⇒ null ⇒ **完全不混合**，老行为一字不变 ✓
 */
export function fetusMixRangeOf(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        const m = t.match(/(\d+)\s*-\s*(\d+)\s*不混合\s*[，,]\s*(\d+)\s*-\s*(\d+)\s*混合/);
        if (!m) return null;
        const none = [Number(m[1]), Number(m[2])];
        const mixed = [Number(m[3]), Number(m[4])];
        if (!none.every(Number.isFinite) || !mixed.every(Number.isFinite)) return null;
        return { none, mixed };
    } catch { return null; }
}

/**
 * ★ 2026-10-24：「天赋判定」五档（正文里的一行区间表）。
 * 形态：`天赋判定（D100）：1-10 两边的天赋都拿到，11-30 超过拿到的那一方，31-60 跟拿到的那一方一样，61-90 还没成体系，91-100 只拿到一部分`
 *
 * 用途：血脉遗传那一轮由**插件**掷一颗，掷出几就落在哪一档；
 *   同卵组共用一颗（同一个基因组），异卵各掷一颗。
 * ⚠️ 正文认不出（老存档 / 玩家删了那行）⇒ 用下面这份出厂表，**不跳过这一档** ——
 *   天赋是这一胎的核心结果，缺了它模型就只能自己编 ✗
 */
export const TALENT_TIERS_DEFAULT = [
    { from: 1, to: 10, label: '两边的天赋都拿到' },
    { from: 11, to: 30, label: '超过拿到的那一方' },
    { from: 31, to: 60, label: '跟拿到的那一方一样' },
    { from: 61, to: 90, label: '还没成体系' },
    { from: 91, to: 100, label: '只拿到一部分' },
];

/** 正文那行 ⇒ `[{from,to,label} …]`（认不出 ⇒ 出厂那份 ✓） */
export function talentTierTableOf(targetKey = null) {
    try {
        // ★ 2026-10-24（她的判断）：天赋档位与显性来源这两行属于「血脉遗传特质」，
        //   已经从怀孕判定模块搬过去了 —— 那两格只在判遗传那一轮才该出现 ✓
        const t = String(moduleText('heritage', targetKey) || '');
        const m = t.match(/天赋判定（D100）\s*[：:]\s*([^\n]+)/);
        if (!m) return TALENT_TIERS_DEFAULT.map((x) => ({ ...x }));
        const out = [];
        for (const seg of m[1].split(/[，,]/)) {
            const s = seg.match(/^\s*(\d+)\s*-\s*(\d+)\s*(\S.*?)\s*$/);
            if (!s) continue;
            const from = Number(s[1]), to = Number(s[2]);
            if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
            out.push({ from, to, label: s[3].trim() });
        }
        if (out.length < 2) return TALENT_TIERS_DEFAULT.map((x) => ({ ...x }));
        return out;
    } catch { return TALENT_TIERS_DEFAULT.map((x) => ({ ...x })); }
}

/** 掷出来的数 ⇒ 档位名（认不出这个数 ⇒ 空串 ✓） */
export function talentTierLabelOf(value, targetKey = null) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '';
    const hit = talentTierTableOf(targetKey).find((x) => v >= x.from && v <= x.to);
    return hit ? hit.label : '';
}

/**
 * ★ 2026-10-24：「显性来源判定」三个区间（正文那一行）。
 * 形态：`显性来源判定（D100）：1-40 主要随受孕方，41-80 主要随致孕方，81-100 两边各取`
 *
 * 用途：模型总爱把几个孩子的显性写成同一套；来源由插件掷，
 *   每个孩子（同卵组共用一颗）从哪边取长相就不一样 ✓
 * 认不出（老存档 / 删了那行）⇒ 返回 null ⇒ 不掷，老行为一字不变 ✓
 */
export function dominantSourceRangeOf(targetKey = null) {
    try {
        // ★ 同上：这一行住在「血脉遗传特质」（2026-10-24 从怀孕判定模块搬走）
        const t = String(moduleText('heritage', targetKey) || '');
        const m = t.match(/显性来源判定（D100）\s*[：:]\s*(\d+)\s*-\s*(\d+)\s*([^，,]+)[，,]\s*(\d+)\s*-\s*(\d+)\s*([^，,]+)[，,]\s*(\d+)\s*-\s*(\d+)\s*([^\n，,]+)/);
        if (!m) return null;
        return {
            mat: [Number(m[1]), Number(m[2])], matLabel: m[3].trim(),
            pat: [Number(m[4]), Number(m[5])], patLabel: m[6].trim(),
            both: [Number(m[7]), Number(m[8])], bothLabel: m[9].trim(),
        };
    } catch { return null; }
}

/** 掷出来的数 ⇒ 显性来源的说法（1 随受孕方 / 2 随致孕方 / 3 两边各取；认不出 ⇒ 空串） */
export function dominantSourceOf(value, targetKey = null) {
    const v = Number(value);
    const r = dominantSourceRangeOf(targetKey);
    if (!r || !Number.isFinite(v)) return '';
    if (v >= r.mat[0] && v <= r.mat[1]) return r.matLabel;
    if (v >= r.pat[0] && v <= r.pat[1]) return r.patLabel;
    if (v >= r.both[0] && v <= r.both[1]) return r.bothLabel;
    return '';
}

/**
 * ★ 2026-10-24：当前正文里的区间表对应哪一档预设（对不上 ⇒ 'custom'）——
 *   设置里那颗下拉要靠它显示"现在是哪一档" ✓
 */
export function detectTalentPreset(targetKey = null) {
    try {
        const tt = talentTierTableOf(targetKey);
        // ★ 2026-10-24（她：外貌不用跟着改）——只看天赋那四刀，显性来源不参与判定 ✓
        const t = tt.slice(0, 4).map((x) => x.to).join(',');
        const P = {
            normal: '10,30,60,90',
            lucky: '25,50,70,90',
            super: '45,70,85,95',
        };
        for (const [k, v] of Object.entries(P)) if (v === t) return k;
        return 'custom';
    } catch { return 'custom'; }
}

/**
 * ★ 2026-10-24（她：显性单独一个档位）——
 *   显性外貌的倾向跟天赋分开：默认双方相同概率 / 偏向受孕方 / 偏向致孕方。
 *   换的仍然是区间表本身 ✓
 */
export function applyDominantPreset(kind = 'equal', targetKey = null) {
    const P = {
        equal: [40, 80],
        mat: [60, 85],
        pat: [25, 85],
    }[String(kind || '')];
    if (!P) return false;
    const cur = String(moduleText('heritage', targetKey) || '');
    if (!cur) return false;
    const r = dominantSourceRangeOf(targetKey);
    const [d1, d2] = P;
    const line = `显性来源判定（D100）：1-${d1} ${(r && r.matLabel) || '主要随受孕方'}，${d1 + 1}-${d2} ${(r && r.patLabel) || '主要随致孕方'}，${d2 + 1}-100 ${(r && r.bothLabel) || '两边各取'}`;
    let out = cur;
    if (/显性来源判定（D100）/.test(out)) out = out.replace(/显性来源判定（D100）[^\n]*/, () => line);
    else out = out.replace(/(天赋判定（D100）[^\n]*\n)/, (m) => m + line + '\n');
    if (out === cur) return false;
    setModuleText('heritage', out, targetKey);
    return true;
}

/** 当前显性来源区间对应哪一档（对不上 ⇒ 'custom'）✓ */
export function detectDominantPreset(targetKey = null) {
    try {
        const r = dominantSourceRangeOf(targetKey);
        if (!r) return 'custom';
        const sig = `${r.mat[1]},${r.pat[1]}`;
        if (sig === '40,80') return 'equal';
        if (sig === '60,85') return 'mat';
        if (sig === '25,85') return 'pat';
        return 'custom';
    } catch { return 'custom'; }
}

/**
 * ★ 2026-10-24（她：给继承加三档运气）——
 *   不做加权，换的是**区间表本身**（三套预设），数值照样在参数面板可见可改 ✓
 *   normal＝现在的出厂值；lucky / super 是把好结果那两段放宽。
 * @param {'normal'|'lucky'|'super'} kind
 * @returns {boolean} 正文有没有变
 */
export function applyTalentPreset(kind = 'normal', targetKey = null) {
    const P = {
        normal: { t: [10, 30, 60, 90], d: [40, 80] },
        lucky: { t: [25, 50, 70, 90], d: [55, 90] },
        super: { t: [45, 70, 85, 95], d: [70, 95] },
    }[String(kind || '')];
    if (!P) return false;
    const cur = String(moduleText('heritage', targetKey) || '');
    if (!cur) return false;
    const defs = ['两边的天赋都拿到', '超过拿到的那一方', '跟拿到的那一方一样', '还没成体系', '只拿到一部分'];
    const tt = talentTierTableOf(targetKey);
    const lab = (i) => (tt[i] && tt[i].label) || defs[i];
    const [t1, t2, t3, t4] = P.t;
    const tLine = `天赋判定（D100）：1-${t1} ${lab(0)}，${t1 + 1}-${t2} ${lab(1)}，${t2 + 1}-${t3} ${lab(2)}，${t3 + 1}-${t4} ${lab(3)}，${t4 + 1}-100 ${lab(4)}`;
    // ★ 2026-10-24（她：外貌不用跟着改，默认就行）——预设只动天赋那一行，
    //   显性来源那行保持玩家自己那份 / 出厂那份 ✓
    let out = cur;
    if (/天赋判定（D100）/.test(out)) out = out.replace(/天赋判定（D100）[^\n]*/, () => tLine);
    else out = out.replace(/(混合胎判定（D100）[^\n]*\n)/, (m) => m + tLine + '\n');
    if (out === cur) return false;
    setModuleText('heritage', out, targetKey);
    return true;
}

/**
 * 同一份正文里的「着床判定」区间 ⇒ `{ ok:[a,b], fail:[c,d]|null }`（认不出 ⇒ null ✓）。
 * 形态：`着床判定（D100）：1-80 着床成功，81 及以上着床失败`
 *
 * ★ 这条基准线跟「累计受孕率」**不是同一回事**：累计受孕率会被行为抬高（做得越多越容易受精），
 *   而着床成不成看的是这颗受精卵本身 ⇒ 这里是一条**固定**的线，玩家自己改。
 *   ⚠️ 把它改成「1-100 着床成功」就等于没人会失败（不用另做开关 ✓ ）。
 *     失败那半写的是「N 及以上」而**不是**「N-100」：上限抬到 100 时它自然变成
 *     「101 及以上着床失败」，读起来是"够不着"；写成区间的话会变成倒挂的 `101-100`，
 *     看着像坏了 ✗
 *   ⚠️ 判定只用到 `ok` 的上界；`fail` 只是照着读出来备用（两种老写法都认 ✓）
 *   ⚠️ 认不出（玩家把这段删了）⇒ 返回 null ⇒ 不做这道判定，老行为一字不变 ✓
 */
export function implantRangeOf(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        const m = t.match(/着床判定（D100）\s*[：:]\s*(\d+)\s*-\s*(\d+)\s*着床成功/);
        if (!m) return null;
        const ok = [Number(m[1]), Number(m[2])];
        if (!ok.every(Number.isFinite)) return null;
        // 失败那半：`81 及以上着床失败` 和老的 `81-100 着床失败` 都认（认不出就留 null ✓）
        const f = t.match(/着床成功\s*[，,]\s*(\d+)\s*(?:-\s*(\d+))?\s*(?:及以上\s*)?着床失败/);
        const fail = f && Number.isFinite(Number(f[1]))
            ? [Number(f[1]), f[2] === undefined ? 100 : Number(f[2])]
            : null;
        return { ok, fail };
    } catch { return null; }
}

/**
 * 这一周该写哪句发育描述（正文那张孕周表里的一句话；认不出 ⇒ 空串 ✓）。
 * 形态：`- 孕 4-6 周：胚胎已着床，器官开始分化。／孕 7-10 周：心跳可检测，四肢芽出现。`
 *   ⇒ 同一行里可能有好几句，按「／」切开逐句认 ✓
 */
export function fetusDevLineOf(targetKey = null, week = null) {
    try {
        const w = Number(week);
        if (!Number.isFinite(w)) return '';
        const hit = fetusDevAllLines(targetKey).find((x) => w >= x.from && w <= x.to);
        return hit ? hit.desc : '';
    } catch { return ''; }
}

/**
 * ★ 2026-10-24（构建 -107）：那张表的**全部**条目（`{from,to,desc}`）——
 *   「概述里的生长情况跟着孕周走」时要靠它把**旧的那句**从概述里认出来换掉 ✓
 */
export function fetusDevAllLines(targetKey = null) {
    try {
        const t = String(moduleText('pregnancy_module', targetKey) || '');
        const hits = [];
        const re = /孕\s*(\d+)\s*-\s*(\d+)\s*周\s*[：:]?\s*([^／/\n。]+)。?/g;
        let m;
        while ((m = re.exec(t))) {
            const from = Number(m[1]), to = Number(m[2]);
            const desc = String(m[3]).trim().replace(/^[：:]\s*/, '');
            // ⚠️ 性别那几句里没有「周」⇒ 天然不会被这条认进来 ✓
            if (desc && Number.isFinite(from) && Number.isFinite(to)) hits.push({ from, to, desc });
        }
        return hits;
    } catch { return []; }
}

export function applyAwarenessTierLines(text, id) {
    if (!text || id !== 'awareness') return text;
    let out = String(text);
    for (const k of Object.keys(AWARENESS_TIER_DEF)) {
        const v = awarenessTierOf(k);
        // ⚠️ 用**那一档独有的名字**（■ A档 / ■ B档 …）锚定 —— 五行的句式一模一样，
        //    只认"怀疑：孕/确认：孕"会改错行 ✗
        const re = new RegExp('(■ ' + k + '档[^\\n]*\\n怀疑：)[\\s\\S]*?( \\| 确认：)[\\s\\S]*?(?=\\n)');
        out = out.replace(re,
            `$1${pregPhrase(v.suspW0, v.suspW1, v.suspD0, v.suspD1)}$2${pregPhrase(v.confW0, v.confW1, v.confD0, v.confD1)}`);
    }
    const up = (() => {
        const n = Math.round(Number(settings().awarenessUpper));
        return (Number.isFinite(n) && n >= 1 && n <= 45) ? n : 32;
    })();
    // ⚠️「上限：孕32周（着床后203天）」里的 203 **不是 32×7**（=224）⇒ 单独存一个天数 ✓
    const upd = (() => {
        const n = Math.round(Number(settings().awarenessUpperDays));
        return (Number.isFinite(n) && n >= 0 && n <= 400) ? n : 203;
    })();
    out = out.replace(/(上限：孕)\d+(周（着床后)\d+(天）)/, `$1${up}$2${upd}$3`);
    return out;
}

/**
 * 产后泌乳时间线**不走设置渲染** ——
 * 它的真相源就是正文本身：`params.js` 那条「产奶量参数」spec 直接把值写回正文 ✓
 * （做成"设置 + 发送时渲染"就得同时维护两个真相源 ✗ ⇒ 只留正文这一份 ✓）
 */

/** 防护系数那几行渲染（只对 [生理周期模块] 生效 ✓） */
function applyProtectionLines(text, id) {
    if (!text) return text;
    if (id !== 'cycle_module') return text;
    return applyProtectionByKey(text, Object.keys(PROT_COEF_DEF));
}

export function applyCycleRateLines(text, id) {
    if (!text) return text;
    if (id !== 'cycle_module' && id !== 'body_base') return text;
    const r = (k) => cycleRateOf(k);
    let out = String(text);
    if (id === 'cycle_module') {
        // ⚠️ 按**各期的名字**分别锚定 —— 绝不能写成"逐次 replace(/基础率\s*\d+%/) 四次"：
        //   那种写法每次都命中**同一行**（第一处），第二行往后一个都不换 ✗（踩过）
        const line = (name, v) => new RegExp(`^(- ${name}[^\\n：]*：基础率\\s*)\\d+%`, 'm');
        out = out
            .replace(line('月经期', r('menstrual')), `$1${r('menstrual')}%`)
            .replace(line('卵泡期', r('follicular')), `$1${r('follicular')}%`)
            .replace(line('排卵窗口', r('window')), `$1${r('window')}%`)
            .replace(line('排卵窗口结束后第一天', r('transition')), `$1${r('transition')}%`)
            // 示例那句「= 0 +（8% × 1.0 × 1.0）= 8%」用的是**卵泡期**那个数 ⇒ 跟着换 ✓
            //   ⚠️ 两个坑都踩过：① 括号是**全角**的；② 乘号前面**有个空格**，
            //     而且"（"和数字之间没空格 ⇒ 写成 /=（\d+%/ 一条都匹配不上 ✗
            //   ⚠️ 只换**首次内射**那一句（它是 0 + …）；「同日第二次」那句是 8% + …，
            //     锚定 `= 0 +（` 就自动排除它 ✓
            .replace(/(= 0 \+（)\d+%( × 1\.0 × 1\.0）)/, `$1${r('follicular')}%$2`);
    } else {
        out = out
            .replace(/(基础率同样按阶段表计（)\d+(%）)/, `$1${r('menstrual')}$2`)
            .replace(/(：基础率\s*)\d+(%，照常累加进累计受孕率)/, `$1${r('transition')}$2`);
    }
    return out;
}

/** 把周期模式相关的占位符换掉（`mode` 不传 = 用全局默认档 ✓）
 *  ★ `xeno`：名单里有没有异种 —— 决定 `@@IF_XENO:…|…@@` 走哪半边 */
export function applyPeriodPlaceholders(text, mode, xeno, targetKey = null) {
    if (!text || text.indexOf('@@') < 0) return text;
    const use = mode || periodMode();
    // ★★ 名单里**两档都有**时只发一份，另一档的叫法写进圆括号 ✓
    //   为什么：那两份内容差只有 6%（1107 / 18574 字），89 处**只是换词**，
    //   却要为此多背一整份（默认那 4 条 ≈ 8617 字 ≈ 7000 token）✗
    //   ⇒ 传 `mode = 'both'` 时：正文用"有月经"那套词渲染，每处差异标成
    //     「排卵日（非月经档：受孕高峰日）」／整段差异标成「（下面这段只在…身上适用）」✓
    //   ⚠️ 单档聊天一个字都不变（只有调用方在两档都有人时才会传 'both' ✓）
    //   ⚠️ 判据仍在**渲染这一层**（词表是同一份 source ⇒ 玩家改了术语名，括号里跟着变 ✓）
    const both = use === 'both';
    const none = both ? false : isNeutralMode(use);
    // ★ 2026-10-16：「无月经」那一档**没有周期、没有阶段**（三档里最特别的那一档 ✓）
    //   它和「非月经」共用中性词，但**不能共用"有周期"的那半句话** ⇒ 单独给玩家一对占位符 ✓
    const noCycle = use === 'amenorrhea';
    let out = text;
    // ---- 词级：阶段名 ----
    for (const id of Object.keys(DEFAULT_PHASE_NAMES)) {
        const main = phaseNameOf(id, use);
        let val = main;
        if (both) {
            const other = phaseNameOf(id, 'none');
            if (other !== main) val = `${main}（非月经档：${other}）`;
        }
        out = out.split(`@@PHASE:${id}@@`).join(val);
    }
    // ---- 词级：生理术语（两套 ✓ —— B 方案）----
    for (const id of Object.keys(DEFAULT_TERM_NAMES)) {
        const main = termNameOf(id, use);
        let val = main;
        if (both) {
            const other = termNameOf(id, 'none');
            if (other !== main) val = `${main}（非月经档：${other}）`;
        }
        out = out.split(`@@TERM:${id}@@`).join(val);
    }
    // ---- 段落级：月经专属段落 ----
    //   @@MENSTRUATION_BLOCK_START@@ ... @@MENSTRUATION_BLOCK_END@@
    //   ⇒ 非月经模式下**整段扣掉** ✓（其余内容照常 ✓）
    out = out.replace(/@@MENSTRUATION_BLOCK_START@@([\s\S]*?)@@MENSTRUATION_BLOCK_END@@/g,
        (m, body) => (none ? '' : (both ? `（下面这段只在"有月经"的对象身上适用）\n${body}` : body)));

    // ---- 段落级：**非月经专属段落**（和上面那对对称 ✓）----
    //   @@NOBLEED_BLOCK_START@@ ... @@NOBLEED_BLOCK_END@@
    //   ⇒ 有月经模式下整段扣掉 ✓
    //   用途：某些段落**两套写法差别太大**，长内联会很难读，
    //   不如给两套各自完整的段落 ✓
    //   （对，只写深度就可以、剥离开具体器官之类的 ✓）
    out = out.replace(/@@NOBLEED_BLOCK_START@@([\s\S]*?)@@NOBLEED_BLOCK_END@@/g,
        (m, body) => (none ? body : (both ? `（下面这段只在"非月经 / 无月经"的对象身上适用）\n${body}` : '')));
    // ---- 段落级：**无月经要扣掉的段落**（2026-10-16 新增，三档之后 ✓）----
    //   @@NOCYCLE_BLOCK_START@@ ... @@NOCYCLE_BLOCK_END@@
    //   ⇒ 只有「无月经」（没有周期、没有阶段）那一档**整段消失** ✓
    //   用途：整段依赖"有卵、有周期"的话（如【卵状态参考】），对没有周期的人根本无从谈起 ✓
    //   ⚠️ 和 MENSTRUATION_BLOCK 不一样：这里**"非月经"那一档照旧保留**（它有周期 ✓）
    //   ⚠️ 这对块能装任意内容（连里面的 @@TERM@@ 一起 ✓）—— 内联那个 @@IF_CYCLE@@ 装不下 ✓
    out = out.replace(/@@NOCYCLE_BLOCK_START@@([\s\S]*?)@@NOCYCLE_BLOCK_END@@/g,
        (m, body) => (noCycle ? '' : body));
    // ---- 段落级：**无月经专属段落**（和上面那对对称 ✓）----
    //   @@NOCYCLE_ONLY_BLOCK_START@@ ... @@NOCYCLE_ONLY_BLOCK_END@@
    //   ⇒ 只有「无月经」那一档保留，其余两档整段扣掉 ✓
    //   用途：整段换说法时，两套各自完整、别挤在一行里 ✓
    out = out.replace(/@@NOCYCLE_ONLY_BLOCK_START@@([\s\S]*?)@@NOCYCLE_ONLY_BLOCK_END@@/g,
        (m, body) => (noCycle ? body : ''));
    // ---- 内联：月经模式的词 vs 非月经模式的词 ----
    //   @@IF_BLEED:有月经时写的话|没月经时写的话@@
    out = out.replace(/@@IF_BLEED:([^|@]*)\|([^@]*)@@/g, (m, a, b) => {
        if (a === b) return a;
        if (both) return a ? `${a}（非月经档：${b}）` : `（非月经档：${b}）`;
        return none ? b : a;
    });
    // ---- 内联：**有没有周期**（2026-10-16 新增，三档之后 ✓）----
    //   @@IF_CYCLE:有周期时写的话|没有周期时写的话@@
    //   判据：**有月经 / 非月经都算"有周期"**（非月经只是不流血，周期照推 ✓）；
    //     只有「无月经」那档走后半句 ✓
    //   ⚠️ 和 @@IF_BLEED@@ / @@IF_XENO@@ 同一个形状（半边里不许出现 @ 或 |）
    //     ⇒ 半边里**不许再套别的占位符**；要整段换/整段扣就用上面的 NOCYCLE 段落块 ✓
    out = out.replace(/@@IF_CYCLE:([^|@]*)\|([^@]*)@@/g, (m, a, b) => (noCycle ? b : a));
    // ---- 内联：异种口径 vs 人类口径 ----
    //   @@IF_XENO:名单里有异种时写的话|没有异种时写的话@@
    //   为什么需要它：同一条规则要同时服务"纯人类世界"和"有异种的世界"，
    //     而两套口径（显性外貌写人类特征、还是写毛色/鳞片）**必须物理上不能同时出现** ✓
    //     —— 这是项目里"提示词层的隔离要用占位符 + 构建时替换"那条教训的延续 ✓
    //   ⚠️ 和 @@IF_BLEED@@ 同一个形状（两边都拒绝 @）⇒ 内联里不许再套别的占位符 ✓
    //   ⚠️ 判据是**名单级**（这批对象里有没有异种），不是逐人 —— 这条模块是全局模块、只发一份 ✓
    out = out.replace(/@@IF_XENO:([^|@]*)\|([^@]*)@@/g, (m, a, b) => (xeno ? a : b));
    // ---- ★ 把「第几天到第几天」按**这个对象**的参数填进去 ----
    //   最后一步做：它只填数字，不参与上面那些词级 / 段落级的替换 ✓
    out = applyDayRanges(out, targetKey);
    return out;
}

/**
 * ★★ 把**周期模式的结构标记**解析成"那一档到底会发什么"（2026-10-19）
 *
 * 只解**结构级**的（块 + 内联两半），**词级的 `@@TERM:xx@@` / `@@PHASE:xx@@` 原样留着** ——
 * 词级那些是术语表驱动的（玩家在设置页改名 ⇒ 跟着变），留着不动才能在编辑时继续跟着走 ✓
 *
 * 用途：设置页那条模块的「版本切换」（月经 / 非月经 / 无月经 各看各的，
 * 不用跑去把默认周期模式切一遍 ✓）。那句话：
 *   「如果想看两套的区别需要划上去切换默认模式，如果是想编辑的也得划上去，这样不方便」
 */
export function projectModeStructure(text, mode = null) {
    let out = String(text || '');
    if (out.indexOf('@@') < 0) return out;
    const use = mode || periodMode();
    const both = use === 'both';
    const none = both ? false : isNeutralMode(use);
    const noCycle = use === 'amenorrhea';
    // 段落级（跟 applyPeriodPlaceholders 里的判据一一对应，改一处就要两处一起改 ✓）
    out = out.replace(/@@MENSTRUATION_BLOCK_START@@([\s\S]*?)@@MENSTRUATION_BLOCK_END@@/g, (m, b) => (none ? '' : b));
    out = out.replace(/@@NOBLEED_BLOCK_START@@([\s\S]*?)@@NOBLEED_BLOCK_END@@/g, (m, b) => (none ? b : ''));
    out = out.replace(/@@NOCYCLE_BLOCK_START@@([\s\S]*?)@@NOCYCLE_BLOCK_END@@/g, (m, b) => (noCycle ? '' : b));
    out = out.replace(/@@NOCYCLE_ONLY_BLOCK_START@@([\s\S]*?)@@NOCYCLE_ONLY_BLOCK_END@@/g, (m, b) => (noCycle ? b : ''));
    // 内联两半
    out = out.replace(/@@IF_BLEED:([^|@]*)\|([^@]*)@@/g, (m, a, b) => (none ? b : a));
    out = out.replace(/@@IF_CYCLE:([^|@]*)\|([^@]*)@@/g, (m, a, b) => (noCycle ? b : a));
    return out;
}

/** 这条模块的正文里有没有"按周期模式分叉"的结构标记（有 ⇒ 设置页给它一个版本切换 ✓） */
export function moduleHasModeVariants(id) {
    const def = defaultModuleText(id);
    return /@@(MENSTRUATION_BLOCK|NOBLEED_BLOCK|NOCYCLE_BLOCK|NOCYCLE_ONLY_BLOCK|IF_BLEED|IF_CYCLE)/.test(String(def || ''));
}

/** 三档的 id（跟周期模式那三档一一对应） */
export const MODULE_VARIANT_MODES = ['normal', 'none', 'amenorrhea'];

/** 玩家给某一档存过的正文（没存过 ⇒ null，回落到"按模板投影"） */
export function moduleVariantText(id, mode) {
    if (moduleScope(id) !== 'global') return null;      // 人物级那几条不做分档（它们是按人存的 ✓）
    const bag = settings().modules?.[id]?.variants;
    const v = bag && (mode === 'both' ? null : bag[mode]);
    return (typeof v === 'string' && v.length) ? v : null;
}

/** 存某一档的正文（和内置投影一样 ⇒ 不留覆盖 ✓） */
export function setModuleVariantText(id, mode, text) {
    if (moduleScope(id) !== 'global' || !MODULE_VARIANT_MODES.includes(mode)) return;
    const s = settings();
    const cur = { ...(s.modules[id] || {}) };
    const bag = { ...(cur.variants || {}) };
    const proj = projectModeStructure(defaultModuleText(id), mode);
    if (String(text ?? '') === proj) delete bag[mode];
    else bag[mode] = text;
    if (Object.keys(bag).length) cur.variants = bag;
    else delete cur.variants;
    if (Object.keys(cur).length) s.modules[id] = cur;
    else delete s.modules[id];
    save();
}

/** 把这条模块的三档覆盖全清掉（"恢复内置默认"用 ✓） */
export function resetModuleVariants(id) {
    const s = settings();
    if (s.modules?.[id] && s.modules[id].variants) {
        delete s.modules[id].variants;
        if (!Object.keys(s.modules[id]).length) delete s.modules[id];
    }
    save();
}

export function applyModePlaceholders(text, mode, xeno, targetKey = null) {    const settle = settings().cycleSettleMode === 'sperm' ? 'sperm' : 'reset';
    let out = text.replace(/@@SPERM_RULE@@/g, spermRuleBlock(settle));
    // ★ 判定值那句话：结算方式 × 判定口径，两档分别写死（见 `judgeValueRule` 那段说明 ✓）
    out = out.replace(/@@JUDGE_VALUE_RULE@@/g, judgeValueRule(settle));
    // ★★ 结算方式专属段落（两种都写，怕 AI 误会）——
    //   `@@RESET_BLOCK_START@@ … @@RESET_BLOCK_END@@` 只在「按周期清零」时留
    //   `@@SPERM_BLOCK_START@@ … @@SPERM_BLOCK_END@@` 只在「按精子存活」时留
    //   为什么必须分：以前那两行是**写死的**（清零那一套），而同一份提示词里
    //     【精子存活与待受精】那段又写着"进入新周期后不清零" ⇒ **两种口径同时出现**，
    //     模型只能自己挑一个 ⇒ 它写的计算说明就是错的 ✗
    //   ⚠️ 段级替换要排在**词级 / 内联替换之前**（段里还套着 @@TERM:…@@ 之类 ✓）
    //   ⚠️ 正则连**两头的换行**一起吃掉：不然删掉一段会留一行空行（有断言盯着空行 ✓）
    out = out.replace(/@@RESET_BLOCK_START@@\n?([\s\S]*?)\n?@@RESET_BLOCK_END@@\n?/g,
        (m, body) => (settle === 'sperm' ? '' : body + '\n'));
    out = out.replace(/@@SPERM_BLOCK_START@@\n?([\s\S]*?)\n?@@SPERM_BLOCK_END@@\n?/g,
        (m, body) => (settle === 'sperm' ? body + '\n' : ''));
    // ★ 周期模式（月经 / 非月经）+ 异种口径 + 日号区间 —— 都按那个人 / 那份名单 ✓
    return applyPeriodPlaceholders(out, mode, xeno, targetKey);
}



// ---------------------------------------------------------------------------
// ★★ 敏感带的「开发增量 ＋ 等级阈值」九个数 —— 真相源在设置
//
// 为什么真相源在设置：这九个数一度是"只改正文文本"的字段（理由曾是
//   「没有任何代码读这张表，等级是 AI 照正文判的」）。插件现在要拿它算等级
//   ⇒ 那个前提没了：插件内置一份会跟面板打架 ✗、再去正则抠正文又是两套解析迟早漂 ✗
//   ⇒ 照「受孕基础率」那条的现成做法：真相源＝设置，正文里的数字在发送时按它渲染 ✓
//   （出厂值下渲染结果与正文原样相同 ⇒ 数字基线不受影响 ✓）
// ---------------------------------------------------------------------------

/** 出厂那三档增量（跟正文里那三行逐字一致 ✓） */
export const ZONE_STEP_DEF = Object.freeze({ light: 1, mid: 2, heavy: 3 });
/** 出厂那六级的起点次数（跟正文里那张表逐字一致 ✓；第 5 级没有上限 ⇒ 只记起点） */
export const ZONE_LV_DEF = Object.freeze([0, 5, 21, 51, 101, 181]);

/**
 * 敏感带那九个数（轻/中/重增量 ＋ 六级阈值起点）—— **读的是模块正文**
 * （对象级 / 全局覆盖 > 内置默认，也就是玩家在面板上改过之后的那一份 ✓）。
 *
 * ★ 这套解析原先**只在 params.js 那条 spec 里**（面板读写用），
 *   而**插件也要拿它算等级** ⇒ 挪到这里、两边共用同一份（一个解析器 ✓）：
 *   · 面板那条 spec 的 read 改成调它 ⇒ 面板改一格，正文与插件读到的是同一个数 ✓
 *   · 插件累加时也调它 ⇒ 不会出现"面板改了阈值、插件还按旧数算" ✗
 * ⚠️ 没有搬去设置存储是**故意的**：真相源本来就是正文（"只改正文文本"那一套），
 *   搬存储要迁移老存档、还要处理"正文与设置不同步"；共用解析则零迁移、零双源 ✓
 * 读不出来（锚点被改坏 / 缺行 / 阈值倒挂）⇒ 回出厂值 ✓（跟面板那条 spec 的老行为一致）
 */
export function zoneParamsOf() {
    const t = (() => { try { return String(moduleTextRaw('zones_record') || ''); } catch { return ''; } })();
    const g = (re, def) => {
        const m = t.match(re);
        if (!m) return def;
        const n = Math.round(Number(m[1]));
        return Number.isFinite(n) && n >= 0 && n <= 9999 ? n : def;
    };
    const light = g(/- 轻度（短暂触碰\/间接刺激）→\s*\+(\d+)/, ZONE_STEP_DEF.light);
    const mid = g(/- 中度（直接触碰\/持续刺激\/明显反应）→\s*\+(\d+)/, ZONE_STEP_DEF.mid);
    const heavy = g(/- 重度（反复刺激\/与高潮相关\/强烈反应）→\s*\+(\d+)/, ZONE_STEP_DEF.heavy);
    // ★ 2026-10-29：阈值表那六行不再挂「次」（那个词留给"次数"那一类事实），
    //   但**老存档里存的正文还是「N 次」** ⇒ 这里 `(?:\s*次)?` 两种都认 ✓
    let lv = [
        g(/^- 0级：\s*(\d+)\s*-\s*\d+(?:\s*次)?/m, ZONE_LV_DEF[0]) || g(/^- 0级：\s*(\d+)\s*(?:次)?\s*以上/m, ZONE_LV_DEF[0]),
        g(/^- 1级：\s*(\d+)\s*-\s*\d+(?:\s*次)?/m, ZONE_LV_DEF[1]),
        g(/^- 2级：\s*(\d+)\s*-\s*\d+(?:\s*次)?/m, ZONE_LV_DEF[2]),
        g(/^- 3级：\s*(\d+)\s*-\s*\d+(?:\s*次)?/m, ZONE_LV_DEF[3]),
        g(/^- 4级：\s*(\d+)\s*-\s*\d+(?:\s*次)?/m, ZONE_LV_DEF[4]),
        g(/^- 5级：\s*(\d+)\s*(?:次)?\s*以上/m, ZONE_LV_DEF[5]),
    ];
    for (let i = 1; i < lv.length; i++) {
        if (lv[i] <= lv[i - 1]) { lv = [...ZONE_LV_DEF]; break; }   // 倒挂 ⇒ 整张表回出厂 ✓
    }
    return { light, mid, heavy, lv };
}

/**
 * ★ 敏感带那份"表格文本"的**解析 / 拼回**（从 `params.js` 挪过来）。
 *
 * 为什么放这儿：插件要**自己累加次数、算等级、拼回 d9** ⇒ 需要同一份解析；
 *   而 `params.js` 依赖 `store.js` ⇒ `store.js` 不能反过来 import 它（会成环 ✗）
 *   ⇒ 落到 `settings.js`（它本来就被两边依赖 ✓），`params.js` 里**转出去**不动别处引用。
 * ⚠️ 格式约定（踩过一次，别改）：**一条 ＝ 一行**；`｜` 是「部位｜备注」的备注分隔符，
 *   **不是条目分隔符** ✗；老数据可能用 `·` 分条 ⇒ 也认，但绝不按 `｜` 分条。
 */
const NOTE_STRIP = /[·、；;｜\n]/g;   // ｜ 现在是分隔符，备注里不该有它 ✓

/**
 * 老文档的尾巴：那句「【AI 使用规则】…」和整段「【没写描述的部位怎么办】…」。
 *
 * ★★ 2026-10-15（这条模块的提示词是废的，只填数据就能用上自定义敏感带）——
 *   那条模块的本体是面板那张表（数据）；两段规则已经各有各的家
 *   （点名报部位的在「身体敏感带记录」、没写描述怎么办在「敏感带等级表现参考」）✓
 *   ⇒ 老存档里那两块：**发出去之前剔掉**、面板读写时跳过（不认识的内容一律原样留 ✓）
 */
export function stripLegacyTailBlocks(t) {
    let out = String(t || '');
    for (const title of ['【AI 使用规则】', '【没写描述的部位怎么办】']) {
        const i = out.indexOf(title);
        if (i < 0) continue;
        const j = out.indexOf('\n【', i + title.length);      // 到下一个标题为止
        out = out.slice(0, i) + (j < 0 ? '' : out.slice(j));
    }
    return out;
}

/** 把文本解析成表格行 */
export function parseZoneRows(text) {
    const rows = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const t = raw.trim().replace(/^[-·•]\s*/, '');
        if (!t) continue;
        const [head, ...tail] = t.split('·').map((s) => s.trim());
        const noteFromTail = tail.filter(Boolean).join(' ');
        // ★ 2026-10-29：括号里那个数从「N 次」改成「累计刺激 N」——
        //   它是按轻 1 / 中 2 / 重 3 加起来的加权量，不是"被碰了几回" ✗
        //   ⇒ 新格式必须认；**老存档 / 老导出里那份「N 次」也照认**（读侧不许丢数据 ✓）
        let m = head.match(/^(.+?)\s*(\d+)\s*级?\s*[（(]\s*(?:累计刺激\s*)?(\d+)\s*(?:次)?\s*[）)]?$/);
        if (m) { rows.push({ name: m[1].trim(), level: m[2], count: m[3], note: noteFromTail }); continue; }
        // 分隔符：现在写「｜」，但**旧的「——」也认** ✓（文本是手写的，宽容一点不会错）
        m = head.match(/^(.+?)\s*(?:[—–]{2,}|｜)\s*(.+)$/);
        if (m) {
            rows.push({ name: m[1].trim(), level: '', count: '', note: [m[2].trim(), noteFromTail].filter(Boolean).join(' ') });
            continue;
        }
        rows.push({ name: head, level: '', count: '', note: noteFromTail });
    }
    return rows;
}

/** 把表格行拼回文本 */
export function serializeZoneRows(rows) {
    return (rows || [])
        .filter((r) => String(r?.name || '').trim())
        .map((r) => {
            const name = String(r.name).trim();
            const lv = String(r.level ?? '').trim();
            const ct = String(r.count ?? '').trim();
            const note = String(r.note ?? '').trim().replace(NOTE_STRIP, ' ').replace(/\s+/g, ' ').trim();
            if (lv !== '' || ct !== '') {
                const base = `${name} ${lv || '0'}级（累计刺激 ${ct || '0'}）`;
                return note ? `${base}·${note}` : base;
            }
            // ⚠️ 分隔符用「｜」（全角竖线），**不用「——」**：
            //   提示词里如果格式需要破折号，那就换一个符号（破折号容易增殖）✓
            if (note) return `${name}｜${note}`;
            return `${name} 0级（累计刺激 0）`;
        })
        .join('\n');
}

/** 某条模块的最终文案（对象级覆盖 > 全局覆盖 > 内置默认）
 *  ★ `mode`：周期模式按人取（`store.periodModeOf(key)` ✓）；不传 = 全局默认档 ✓
 *  ★ `xeno`：名单里有没有异种（决定 `@@IF_XENO@@` 走哪半边 ✓）；不传 = 按"没有异种"渲染
 *    ⚠️ UI 那边（token 估算 / 只读预览）不传 ⇒ 看到的是**人类口径** —— 这是有意的：
 *       界面里编辑的是**原文**（带占位符），发送时才按名单渲染 ✓ */
export function moduleText(id, targetName = null, mode = null, xeno = false) {
    // ★ 最后一步把**当前那四个基础率**渲染进正文 ——
    //   [生理周期模块] / [身体补丁] 里那几处数字从此跟着设置走（不再各写一份 ✗）。
    //   出厂时渲染结果与正文原样相同 ⇒ 数字基线不受影响 ✓
    // ★ 防护系数那 8 处也按设置渲染（同一个做法 ✓）
    // ★ 意识状态五档的察觉时间，也走同一套 ✓
    //   ⚠️ 产后时间线**不走这里** —— 它的真相源是正文本身（`params.js` 那条 spec 直接改正文 ✓）
    // ★★ 2026-10-19：这条模块如果玩家**按档存过正文**（设置页那个"版本切换"里改的），
    //   就先取那一档那份；没存过的档仍然走"原文 + 发送时按档渲染" ✓
    //   （投影里已经把结构标记解掉了，下面的 applyModePlaceholders 只会去解词级占位符 ✓）
    const useMode = mode || periodMode();
    const variantSrc = moduleVariantText(id, useMode);
    const base = applyAwarenessTierLines(
        applyProtectionLines(
            applyCycleRateLines(applyModePlaceholders(variantSrc || moduleTextRaw(id, targetName), mode, xeno, targetName), id),
            id),
        id);
    // ★★ 2026-10-15（这条模块的提示词是废的，只填数据就能用 ✓）：
    //   老存档的「敏感带自定义」里还留着那两块规则（它们已经各有各的家）
    //   ⇒ 发出去之前剔掉，正文只剩名单 ✓（面板读写那条路自己也清，见 params.js ✓）
    return id === 'zones_custom' ? stripLegacyTailBlocks(base) : base;
}

/**
 * ★ 从【生理期体质补丁】的正文里读出「经期天数」（读不到就 5 天）。
 *
 * 为什么要它：`derive.js` 以前把经期写死成 `day <= 5`，可这个数字**玩家能改**
 *   （「生理期参数」面板 → 经期天数，改成 7 / 3 都行）✗ ⇒ 阶段口径、2% 基础率、
 *   「来月经时」那个门控（`isMenstruating` 认 phaseId）全会和面板对不上 ✓。
 *   现在这三处都跟着这个值走，**`period_patch` 的正文就是唯一来源** ✓
 *
 * ⚠️ 锚点 `- 经期天数：N 天` 和 `params.js` 里那个 spec 读的是同一句
 *   （那边是给表单用的字符串，这里是给逻辑用的数字，两边别改歪 ✓）
 */
export function periodDaysOf(targetKey = null) {
    const text = String(moduleText('period_patch', targetKey) || '');
    const m = text.match(/- 经期天数：\s*(\d+(?:\.\d+)?)/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * ★★ 「推演报的跨度最多认多少天」的出厂值 = 1000 年。
 *
 * 它拦的是**模型的笔误**（把年份当天数报、或者报一个荒唐的数），不是玩家：
 *   · 玩家手填的「往未来补 / 往过去退 N 天」**不设上限**（玩家自己按的，看得见也能退回来 ✓）
 *   · 只有推演报回来的 `Story_Days_Passed` 受它约束
 * ⇒ 修仙 / 洪荒那种百年千年的跨度够用；还不够就填 0 解除（后果自负 ✓）
 */
export const SPAN_CAP_DEF = 365000;

/**
 * ★ 「单轮最多认多少天」（读设置里的那一格）。
 * @returns {number|null} **null = 不限制**（玩家填 0 或负数）；读不到 / 填坏 ⇒ 回出厂值
 */
export function spanCapDaysOf() {
    const raw = settings().spanCapDays;
    if (raw === undefined || raw === null || String(raw).trim() === '') return SPAN_CAP_DEF;
    const v = Number(raw);
    if (!Number.isFinite(v)) return SPAN_CAP_DEF;
    return v <= 0 ? null : Math.round(v);
}

/**
 * ★ 每档「降一档要几夜」的出厂值（轻 / 中 / 重 / 深层）。
 *   四档各自的夜数是玩家能改的（「痕迹参数」面板四格）⇒ 面板改了代码不跟就是空头支票 ✗
 */
export const TRACE_NIGHT_DEF = { '轻度': 1, '中度': 3, '重度': 6, '深层': 12 };

/**
 * ★ 从【身体痕迹与恢复追踪】的正文里读出四档各自的夜数（读不到就用出厂值）。
 *
 * 为什么要四档分开：一档 1 夜和"几小时就退的微红"对不上（原来统一 4 夜，
 *   轻度也得挂 4 天 ✗）；深层（鞭痕、结痂、深瘀）按周计，也不能跟轻度同一个节拍。
 *
 * ⚠️ 锚点 `- 轻度：每 N 夜降一档` 四行，和 `params.js` 里那个 spec 读的是同一批句子
 *   （那边给表单用字符串、这边给逻辑用数字，两边别改歪 ✓）
 * ★ 老配置迁移：老版本只有一格 `- 衰减速度：每 N 夜降一档`
 *   ⇒ 以它当中度，按 1:3:6:12 的比例缩放（玩家的手感不会丢 ✓）
 */
export function traceNightsMapOf(targetKey = null) {
    const text = String(moduleText('body_trace', targetKey) || '');
    const out = { ...TRACE_NIGHT_DEF };
    let hit = 0;
    for (const lv of Object.keys(TRACE_NIGHT_DEF)) {
        const m = text.match(new RegExp('- ' + lv + '：每\\s*(\\d+(?:\\.\\d+)?)\\s*夜降一档'));
        if (!m) continue;
        const n = Math.round(Number(m[1]));
        if (!Number.isFinite(n) || n < 1) continue;
        out[lv] = Math.min(30, n);
        hit++;
    }
    if (hit) return out;
    // 老写法：一格衰减速度
    const old = text.match(/- 衰减速度：每\s*(\d+(?:\.\d+)?)\s*夜降一档/);
    const base = old ? Math.round(Number(old[1])) : NaN;
    if (Number.isFinite(base) && base >= 1) {
        out['轻度'] = Math.max(1, Math.round(base / 3));
        out['中度'] = Math.min(30, base);
        out['重度'] = Math.min(30, base * 2);
        out['深层'] = Math.min(30, base * 4);
    }
    return out;
}

/** 某一档降一档要几夜（`level` 认不出来就按中度 ✓） */
export function traceNightsForLevel(level, targetKey = null) {
    const map = traceNightsMapOf(targetKey);
    return map[String(level || '').trim()] || map['中度'];
}

/**
 * ★ 2026-10-21 起每档各自的夜数四档齐用（见 `traceNightsMapOf` / `traceNightsForLevel`）；
 *   原来那格「衰减速度」只剩老存档迁移时认（写在 `traceNightsMapOf` 的回落那一段里 ✓）
 */

/**
 * ★ 从【身体补丁】正文里读出「周期长度 / 排卵日」。
 *
 * 为什么要它：新存档的默认起始天数要**按这个对象自己的参数**算（见 derive.js 的
 *   `follicularMidDay` ✓）—— 写死成"第 9 天"的话，玩家把排卵日改到第 10 天，
 *   第 9 天就正好落进高危窗口了 ✗
 *
 * ⚠️ 锚点：出厂正文是两行 `周期长度：N天` / `排卵日：M`（新排版），
 *   老排版 `周期：N天，排卵日第M天` **也认**（老存档 ✓）。和 `params.js` 里 `body_base`
 *   那个 spec 读的是同一套（那边给表单用字符串、这边给逻辑用数字）。两处**必须一致** ——
 *   自测脚本 有断言拿同一段文本分别走两边比对 ✓
 * ★ 用 `moduleTextRaw`（不替换 @@ 占位符）：这两个锚点在设计上就是**字面数字** ✓
 */
export function parseBodyCycleParams(text) {
    const t = String(text || '');
    // 新排版：两行分开 —— `周期长度：28天` / `排卵日：14`
    const nc = t.match(/周期长度：\s*(\d+(?:\.\d+)?)\s*天/);
    const no = t.match(/排卵日：\s*第?\s*(\d+(?:\.\d+)?)/);
    // 老排版：一句里两个 —— `周期：28天，排卵日第14天`（老存档 / 玩家自己那份旧的 ✓）
    const old = t.match(/周期：\s*(\d+(?:\.\d+)?)\s*天[，,]\s*排卵日第\s*(\d+(?:\.\d+)?)\s*天/);
    const c = Number(nc ? nc[1] : (old ? old[1] : NaN));
    const o = Number(no ? no[1] : (old ? old[2] : NaN));
    return {
        cycle: Number.isFinite(c) && c > 0 ? Math.round(c) : 28,
        ovu: Number.isFinite(o) && o >= 1 ? Math.round(o) : 14,
    };
}

/** 某个对象的周期长度 / 排卵日（读不出来就是默认 28 / 14 ✓） */
export function bodyCycleParamsOf(targetKey = null) {
    return parseBodyCycleParams(moduleTextRaw('body_base', targetKey));
}

// ---------------------------------------------------------------------------
// ★ `d3`（体质系数）的真相源＝身体补丁里那行「日常体质系数」
//
// 模块正文自己就这么写着（core 里写着：体质系数以 [身体补丁] 里那一行的值为准 ✓）
//   ⇒ 插件读的必须是**同一行**，否则面板上的 d3 和实际参与判定/描写的那个数会对不上 ✗
// 为什么解析放这儿：`params.js` 依赖 `store.js` ⇒ store 不能反过来 import 它（会成环 ✗）
//   ⇒ 落到 `settings.js`，**正则也导出**、面板那条 spec 用它（**一份解析** ✓）
// ---------------------------------------------------------------------------

/** 「日常体质系数：1.0」这种写法（`:导出了给 params.js 用，别各写一份 ✓） */
export const BODY_COEF_RE = /日常体质系数[：:]\s*([\d.]+)/;
/** 老排版：中间没有冒号 ✓ */
export const BODY_COEF_OLD_RE = /日常体质系数\s*([\d.]+)/;

/**
 * 某个对象身体补丁里那行「日常体质系数」的**原文数字**（照它写的形态返回，如 `'1.0'`）。
 * @returns {string} 空串 = 读不出来（调用方自己决定回退，别把原值清了 ✓）
 */
export function bodyCoefOf(targetKey = null) {
    // ★ **必须 `{ rebase: false }`** —— 默认那条会把正文
    //   "套回最新内置那份"，于是玩家自己填的值被读成出厂值（跟参数面板两条读法不一致 ✗）
    const t = (() => { try { return String(moduleTextRaw('body_base', targetKey, { rebase: false }) || ''); } catch { return ''; } })();
    const m = t.match(BODY_COEF_RE) || t.match(BODY_COEF_OLD_RE);
    if (!m) return '';
    const n = Number(m[1]);
    return (Number.isFinite(n) && n > 0) ? String(m[1]) : '';
}

/** 「排卵日当天临时提升至 1.5」那种写法（跟 `bodyCoefOf` 同一行、一份解析 ✓） */
export const BODY_PEAK_RE = /排卵日当天临时提升至\s*([\d.]+)/;
/** 老排版：只认「提升至 X」这一小段 ✓ */
export const BODY_PEAK_OLD_RE = /提升至\s*([\d.]+)/;

/**
 * 这个对象**排卵日当天**的体质系数（身体补丁那行括号里的数）。
 *
 * 为什么要它：受孕率公式的第二个因子在排卵日会临时抬一档（出厂 1.0 → 1.5），
 *   正文那个例子「20% × 1.5 = 30%」就是这么来的 ⇒ 插件自己算增量时必须拿到它，
 *   不然排卵日那笔会按日常系数少算 ✗
 * @returns {string} 空串 = 读不出来（调用方退回日常系数，别硬套一个数 ✓）
 */
export function peakCoefOf(targetKey = null) {
    const t = (() => { try { return String(moduleTextRaw('body_base', targetKey, { rebase: false }) || ''); } catch { return ''; } })();
    const m = t.match(BODY_PEAK_RE) || t.match(BODY_PEAK_OLD_RE);
    if (!m) return '';
    const n = Number(m[1]);
    return (Number.isFinite(n) && n > 0) ? String(m[1]) : '';
}

// ---------------------------------------------------------------------------
// ★ 「这个角色的种族」那格 —— 也就是身体补丁里那行
//
// 那行是**玩家自己填的**（面板上有输入框 ＋「选…」）⇒ 它比推演判的那份更权威 ✓
//   所以判定/显示都要读它；解析同样只有一份（这里导出正则，params.js 那边引用 ✓）
// ---------------------------------------------------------------------------

/** 「种族：X」/「{{user}} 的种族为 X」/老写法的三种锚点（导出了给 params.js 用 ✓） */
export const RACE_LINE_RE = /种族：\s*([^\s，,。]+)/;
export const RACE_READ_NEW_RE = /\{\{user\}\}\s*的种族为\s*([^\s，,。]+)/;
export const RACE_READ_OLD_RE = /\{\{user\}\}\s*为\s*([^\s，,。]+?)\s*(?:女性|男性|雌性|雄性|扶她)?\s*体质/;

/** 读一段正文里的种族名（三种写法都认 ✓） */
function raceFromText(t) {
    const s = String(t || '');
    const m = s.match(RACE_LINE_RE) || s.match(RACE_READ_NEW_RE) || s.match(RACE_READ_OLD_RE);
    return m ? String(m[1]).trim() : '';
}

/** 这个对象的身体补丁里那行「种族：X」（玩家填的那格）⇒ 读不出来就是空串 ✓ */
export function bodyRaceOf(targetKey = null) {
    // ★ 跟 `bodyCoefOf` 一样，**必须 `{ rebase: false }`** ——
    //   不然玩家填的「半精灵」会被读成出厂那份 ⇒ 面板显示成"你还没填"（就是那句占位 ✓）
    const t = (() => { try { return moduleTextRaw('body_base', targetKey, { rebase: false }); } catch { return ''; } })();
    return raceFromText(t);
}

/** 出厂正文里那行「种族：X」（用来判断"玩家自己改过没有" ✓） */
export function factoryRaceOf() {
    const t = (() => { try { return defaultModuleText('body_base'); } catch { return ''; } })();
    return raceFromText(t);
}

// ---------------------------------------------------------------------------
// ★ 产后泌乳三段的时间线 ＋ 奶量参考（**真相源＝正文** ✓）
//
// 为什么放这儿：`params.js` 那条「产奶量参数」spec 一直在读这几行，而**插件（喂给推演）也要读**
//   ⇒ 解析收成一份（正则也导出给 params.js 用 ✓，跟 `zoneParamsOf` / 种族那行同一套做法 ✓）
// ⚠️ 值一律**返回字符串**（面板那几格本来就拿字符串 ✓）
// ---------------------------------------------------------------------------

/** 产后泌乳那几行的锚点（导出了给 params.js 用 ✓） */
export const PP_FLOW_RE = /- 产后 (\d+)-\d+ 天：开始大量泌乳/;
export const PP_GROW_RE = /- 产后第 (\d+) 周：奶量快速增长/;
export const PP_STABLE_RE = /- 产后 (\d+)-\d+ 个月：稳定泌乳期/;
export const PP_COLO_RE = /- 初乳期：\s*([\d.\-~～]+)\s*ml/;
export const PP_STABLE_ML_RE = /- 稳定期：\s*([\d.\-~～]+)\s*ml/;
export const PP_MULTI_RE = /- 多胎倍率：\s*([\d.\-~～]+)\s*倍/;

/**
 * 读产后泌乳参数。给了 `text` 就读它（params.js 那条 spec 走这条 ✓），不给就读模块正文 ✓
 * @returns {{flowStart:string, growthStart:string, stableStart:string, colostrum:string, stable:string, multi:string}}
 */
export function postpartumParamsOf(text = null) {
    const t = (text != null)
        ? String(text)
        : (() => { try { return String(moduleTextRaw('postpartum_system') || ''); } catch { return ''; } })();
    const g = (re) => { const m = t.match(re); return m ? String(m[1]).trim() : ''; };
    const wk = g(PP_GROW_RE), mo = g(PP_STABLE_RE);
    return {
        flowStart: g(PP_FLOW_RE),
        // ⚠️ 正文写的是「产后第 2 周」「1-6 个月」⇒ 读回来统一折算成**天**（写回去再折 ✓ 幂等 ✓）
        growthStart: wk ? String(Number(wk) * 7) : '',
        stableStart: mo ? String(Number(mo) * 30) : '',
        colostrum: g(PP_COLO_RE),
        stable: g(PP_STABLE_ML_RE),
        multi: g(PP_MULTI_RE),
    };
}

// ---------------------------------------------------------------------------
// ★ 把「第几天到第几天」算好、渲染进正文
//
// 为什么不填数字：剩下的状态由插件自己管。
//   ⇒ **不让玩家填、也不让 AI 自己推**（那会变成第三份事实源，改排卵日就打架 ✗）
//     由插件按「周期长度 / 排卵日 / 经期天数」算好填进去，玩家一个字不用填 ✓
//
// ⚠️ 这里的「第 N 天属于哪一期」**必须和 derive.js 的判定同源** ——
//   两处各写一份 if 的话，正文说"第 13 到 15 天"、插件却按别的日子判定，就打架了 ✗
//   ⇒ 唯一真相源＝下面的 `cycleDayInfoOf`：derive 取阶段用它、区间扫描也用它 ✓
// ---------------------------------------------------------------------------

/**
 * 四个阶段基础率的**唯一真相源**。
 *
 * 出厂 1 / 8 / 20 / 15（就是正文里原来写死的那四个数 ✓）。
 * 这里是**代码侧**的读口：`cycleDayInfoOf()` 用它算 d1、正文那几行由
 * `applyCycleRateLines()` 在发送时渲染进去 ⇒ 面板改一格，判定与提示词一起变 ✓
 *
 * ⚠️ 夹 0~1000 的整数（0 是合法的："这一段不发生关系"的极端玩法 ✓，负数/乱填 ⇒ 回出厂）
 */
export const CYCLE_RATE_DEF = {
    menstrual: 1, follicular: 8, window: 20, transition: 15,
    // ★ 无月经档那一格：没有阶段可挑 ⇒ 它自己就是"每轮基础率"（出厂 10%）
    amenorrhea: 10,
};

/** 无月经档的基础率（没有周期阶段，不参与 cycleDayInfoOf 分段 ✓） */
export function amenorrheaRateOf() {
    return cycleRateOf('amenorrhea');
}

function cycleRateOf(key) {
    const def = CYCLE_RATE_DEF[key];
    const raw = settings()['cycleRate' + key.charAt(0).toUpperCase() + key.slice(1)];
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > 1000) return def;
    return n;
}

/** 第 N 天属于哪一期 + 那一期的基础率（`derive.js` 与本文件的区间扫描**共用这一处** ✓） */
export function cycleDayInfoOf(day, ovu, pdays) {
    // ⚠️ 分支顺序＝`derive.js` 那条 if 链，一个字都别换位 ✓
    if (day <= pdays) return { phaseId: 'menstrual', d1: cycleRateOf('menstrual') + '%' };
    if (day === ovu) return { phaseId: 'ovulationDay', d1: cycleRateOf('window') + '%' };
    if (day === ovu - 1 || day === ovu + 1) return { phaseId: 'ovulation', d1: cycleRateOf('window') + '%' };
    if (day < ovu - 1) return { phaseId: 'follicular', d1: cycleRateOf('follicular') + '%' };
    if (day === ovu + 2) return { phaseId: 'transition', d1: cycleRateOf('transition') + '%' };
    return { phaseId: 'luteal', d1: '不适用' };
}

/**
 * ★ 一个周期的**结算点**在哪一天 —— 跟正文那句「排卵后第 10 天」同源。
 *
 * 为什么要抽出来：状态摘要里「预计下次月经」那一行、
 *   以及推演里的到点结算判据，读的必须是**同一个数** ——
 *   两处各写一份的话，正文说还有 4 天、面板却当场结算 ✗
 */
export function cycleSettleDayOf(ovuDay) {
    const o = Math.round(Number(ovuDay));
    return (Number.isFinite(o) && o > 0 ? o : 14) + 10;
}

/** 五段的键（顺序＝一个周期里的先后 ✓） */
export const CYCLE_DAY_KEYS = ['menstrual', 'follicular', 'window', 'transition', 'luteal'];

/** 单天不写「到」（第16天 ✓）；跨天写「第13到15天」 */
function fmtDayRange(from, to) {
    return from === to ? `第${from}天` : `第${from}到${to}天`;
}

/**
 * 这个身体的五段日号（`@@DAYS:xxx@@` 的渲染值 ✓）。
 * 参数读不到（玩家把正文改得没有锚点了）⇒ 落到出厂默认 28 / 14 / 5，照样给出合理日号 ✓
 * 参数挤得没有某一段（周期特别短）⇒ 那一段给「本周期没有这一段」，不编日期 ✓
 */
export function cycleDayRanges(cycle, ovu, periodDays) {
    const c = Math.max(5, Math.min(90, Math.round(Number(cycle) || 28)));
    const o = Math.max(1, Math.min(Math.round(Number(ovu) || 14), Math.max(1, c - 2)));
    // ⚠️ 经期最晚在排卵窗口前一天结束（和 derive.js 同一道夹 ✓）
    const p = Math.max(1, Math.min(Math.round(Number(periodDays) || 5), Math.max(1, o - 2)));
    /** 「排卵日」和「窗口」在正文里算一段 ⇒ 归到同一个键 ✓ */
    const bucketOf = (info) => (info.phaseId === 'ovulation' || info.phaseId === 'ovulationDay')
        ? 'window' : info.phaseId;
    const span = {};
    for (let d = 1; d <= c; d++) {
        const b = bucketOf(cycleDayInfoOf(d, o, p));
        if (span[b]) span[b].to = d; else span[b] = { from: d, to: d };
    }
    const out = {};
    for (const k of CYCLE_DAY_KEYS) out[k] = span[k] ? fmtDayRange(span[k].from, span[k].to) : '本周期没有这一段';
    return out;
}

/** 把正文里的 `@@DAYS:xxx@@` 换成实际日号（按**这个对象**的参数 ✓） */
function applyDayRanges(text, targetKey) {
    if (text.indexOf('@@DAYS:') < 0) return text;
    let cycle = 28, ovu = 14, pdays = 5;
    try { const c = bodyCycleParamsOf(targetKey); cycle = c.cycle; ovu = c.ovu; } catch { /* 读不到就用默认 */ }
    try { pdays = periodDaysOf(targetKey); } catch { /* 读不到就用默认 */ }
    const ranges = cycleDayRanges(cycle, ovu, pdays);
    let out = text;
    for (const k of CYCLE_DAY_KEYS) out = out.split(`@@DAYS:${k}@@`).join(ranges[k]);
    return out;
}

/**
 * ★ 这条模块的正文会不会随「周期模式」变（含那几种占位符就是会 ✓）
 *
 * 用途：周期模式是**按人**的 ⇒ 发送时要**按档各发一份**（最多两份），
 *   而不是每人一份（省 token ✓）。判断"要不要分档"就看这个 ✓。
 * ⚠️ 查的是**内置原文 + 全局覆盖**：对象级补丁只在 target 模块上生效，
 *   而 target 模块本来就是按对象各发一份 ⇒ 不参与分档 ✓
 */
export function isCycleDependent(id) {
    const builtin = String(MODULES.find(m => m.id === id)?.text || '');
    const over = String(settings().modules?.[id]?.text || '');
    // ⚠️ 这里**只认周期那套占位符**：`@@IF_XENO@@` 是**名单级**的（一次发送只渲染一种口径），
    //   它不是"按档各发一份"的判据 —— 谁把它加进来，就会多出一份重复的模块 ✗
    return /@@(PHASE|TERM|IF_BLEED|IF_CYCLE|MENSTRUATION_BLOCK_START|NOBLEED_BLOCK_START|NOCYCLE_BLOCK_START|NOCYCLE_ONLY_BLOCK_START)/.test(builtin + over);
}

// ---------------------------------------------------------------------------
// ★ 发送按「改没改过」决定发几份
// ---------------------------------------------------------------------------
// 管着这里所有取舍的口径：
//   **没改过一份 / 某人改过 ⇒ 通用一份排除他 + 他那份 + 标题写明归属** ✓✓
//
// 为什么分组：人物级模块**每个对象各发一份**的话，3 个对象 = 3 份一模一样的规则，纯浪费 ✗
//   ⇒ **生效正文一模一样的对象合成一份** ✓
//   · 没人改过 ⇒ 只剩一份（和「通用那份」一字不差 ✓）← 省下的 token 就在这儿
//   · 谁改过 ⇒ 他单独一份，其余人仍共用那份（**共用那份的标题要写明排除谁** ✓）
//
// ⚠️ 判据是**生效正文**（`moduleTextRaw` 已经处理过"冻结回落"）：
//   被冻结的改动**不算改过** ✓ —— 冻结 = 那份正文当前不生效、发出去的还是通用那份，
//   它自然就该和别人共用一份 ✓（判据要是写成 `isTextOverridden` 会多发一份 ✗）
// ⚠️ 只用于 **scope=target** 的模块（全局模块本来就只发一份 / 按档最多两份 ✓）
// ---------------------------------------------------------------------------

/**
 * 把名单按「这条模块的**生效正文**」分组。
 *
 * @param {string} id 模块 id（scope 必须是 target）
 * @param {Array} targets 名单（用到 `t.key` / `t.isUser`）
 * @returns {Array<{text,mode,shared,targets,excluded}>}
 *   text     = 生效正文（已按这一组的周期档换好 @@ 占位符）⇒ **它就是分组键** ✓
 *   mode     = 这一组的周期档（normal / none；不随周期变的模块是 null）
 *   shared   = 这一组和「通用那份」（全局覆盖 > 内置默认）一字不差吗
 *   targets  = 这一组覆盖谁 / excluded = 谁不在这组（标题写明归属用 ✓）
 */
/**
 * ★ 这一条模块对**这个人**要不要发（每人开关；目前只有「身体痕迹与恢复追踪」用）✓
 *
 * 为什么要它：身体痕迹与恢复追踪放世界观里面更好，
 *   人物里面给一个按钮选择是否给这个角色开启追踪，就像周期模式一样操作就行
 * ⇒ 关掉的人：这条模块**不发给他的那一份**（两条发送路都走 `patchSendGroups` ✓）；
 *   名单里一个都没开 ⇒ 整条不发 ✓（省 token）
 *
 * ⚠️ 判据是**每人的开关**，跟 `isModuleOn`（整条模块的总开关）、门控（自动条件）是三件事，
 *   别混：总开关关 ⇒ 谁都不发；门控不满足 ⇒ 谁都不发；**这里**是"同一条模块按人各发不发" ✓
 */
/**
 * ★ 无月经那一档（`amenorrhea`）**不发、也不显示**的几条。
 *
 * ⚠️ 2026-10-16 起**只剩身体补丁**：玩家要求：不能假定别人不需要
 *   （她的理由：无月经档也可能有人要看内视图，所以不能假定没人需要这一项）——
 *   产后恢复那条**放行**（它自己会按情况写：没生过就不写），
 *   阶段插图也不再整块关（见 stages.js 里那段说明 ✓）。
 * 一份清单**两处共用**（发送 `moduleAppliesTo` / 人物视图的显示）——
 * 分开写两份迟早会漂（同一份清单共用来源 ✓）
 */
export const NO_CYCLE_HIDDEN_IDS = ['body_base'];

export function moduleAppliesTo(id, key = null) {
    if (id === 'body_trace') return traceOnOf(key);
    // ★ 无月经那一档：上面那几条**不发给他** ✓
    //   （「必开」不是"关掉"，而是"这个人根本没有周期 ⇒ 这条对他没有意义" ✓
    //    只隐藏界面等于只闭上了玩家的眼：推演照样会给他写经期和排卵 ✗）
    if (NO_CYCLE_HIDDEN_IDS.includes(id) && isNoCycleMode(periodModeOf(key))) return false;
    return true;
}

export function patchSendGroups(id, targets) {
    // ★ 每人开关（身体痕迹追踪可以在人物里面给一个按钮，选择是否给这个角色开启）：
    //   关掉的人**这一条模块一个字都不发给他** ⇒ 在分组之前就剔掉 ✓
    //   （主 API 与插件 API 两条路都走这个函数 ⇒ 只有这一处判据 ✓；
    //    名单里一个都没开时，`list` 为空 ⇒ 整条自然不发 ✓ 省 token）
    const list = (Array.isArray(targets) ? targets.filter(Boolean) : [])
        .filter((t) => moduleAppliesTo(id, t.key));
    const cycle = isCycleDependent(id);
    const modeOf = (t) => (cycle ? periodModeOf(t.key) : null);
    const textOf = (key, mode) => applyModePlaceholders(moduleTextRaw(id, key), mode, false, key);

    const groups = [];
    const byText = new Map();
    for (const t of list) {
        const mode = modeOf(t);
        const text = textOf(t.key, mode);
        let g = byText.get(text);
        if (!g) {
            g = { text, mode, shared: text === textOf(null, mode), targets: [], excluded: [] };
            byText.set(text, g);
            groups.push(g);
        }
        g.targets.push(t);
    }
    for (const g of groups) {
        // 周期模块：**另一档的人本来就不看这一份** ⇒ 别写进排除名单（那是噪音 ✓）
        g.excluded = list.filter(t => !g.targets.includes(t) && (!cycle || modeOf(t) === g.mode));
    }
    // 「通用那份」排前面（先给通用规则、再给例外 ✓）—— 顺序稳定，测试也能钉 ✓
    groups.sort((a, b) => Number(b.shared) - Number(a.shared));
    return groups;
}

/**
 * 这一组的**标题后缀**（推演侧 / 主 API **共用同一套**，别两处各写一份 ✗）。
 *
 * @param {object} g patchSendGroups 里的一组
 * @param {(t)=>string} nameOf 「这条在提示词里叫什么」（推演侧 judgeNameOf / 主 API displayName）
 * @param {string} tierLabel 周期档的说法（'有月经的对象' / '无月经的对象'；不传 = 不带 ✓）
 * @returns {string} 例：`对象：丽娜` ／ `有月经的对象（除 丽娜 外）` ／ `（除 丽娜 外）` ／ ``
 */
export function patchGroupSuffix(g, nameOf, tierLabel = '') {
    const who = (arr) => (arr || []).map(nameOf).filter(Boolean).join('、');
    const covered = who(g.targets);
    const excluded = who(g.excluded);
    if (!g.shared) {
        // 专属那一份：标题直接把对象写出来 ✓（几个人正文一模一样、共用一份时都列出来 ✓）
        return covered ? `对象：${covered}` : '';
    }
    const head = tierLabel || '';
    if (excluded) {
        // ⚠️ 正文里的「该对象」指的是**这一份的适用对象** ⇒ 有例外就必须写明 ✓
        //   两种写法挑**短的**那一头写（名单长的那一侧写出来又长又吵 ✓）
        return head + (g.targets.length >= g.excluded.length
            ? `（除 ${excluded} 外）`
            : `（只对 ${covered} 适用）`);
    }
    return head;
}

/**
 * 段标题 = `模块名 · 范围`。
 * ⚠️ 范围以「（」开头时**不再加那个分隔点** ✓（`生理期体质补丁（除 甲 外）` 顺一点 ✓）
 */
export function patchBlockTitle(name, suffix) {
    if (!suffix) return name;
    return suffix.startsWith('（') ? `${name}${suffix}` : `${name} · ${suffix}`;
}

/**
 * 同上，但**不替换 @@ 占位符**（拿"存着的原文"）。
 *
 * ★ 为什么要这个：人物档案要保存/还原的是**原文** ——
 *   拿替换过的那份存进档案，等于把"存档那一刻的周期模式"的措辞冻进去 ✗
 *   （此后切到另一个模式，档案里那套字就永远不对了 ✓）
 */
export function moduleTextRaw(id, targetName = null, opts = {}) {
    const s = settings();
    // ★★ 在「只能改数值」模式下，**锁正文的那些条目**要把玩家的数值
    //   套回**最新内置正文**（见 rebaseNumbers 顶上那段说明）：正文更新进得来、数值不丢 ✓
    //   · 描写类（不锁）／「全文可改」⇒ 整份用玩家那份（一个字都不会被换掉 ✓）
    //   · 锁 + 数值档 ⇒ 先试逐行对齐；一行都没配上 ⇒ 回落到老判据
    //     （纯数值改动就用存档那份；否则当成改过正文 ⇒ 落到内置 ✓）
    const numbers = patchScope() === 'numbers';
    const locked = isPatchLocked(id);
    // ⚠️⚠️ `opts.rebase === false` = **给"存着的那份原文"**（不套回内置正文）——
    //   参数面板**读写**必须用这一份 ✗ 用套好的那份会出事（"点恢复默认值没用"就是这个症状）：
    //   套好的那份里，数字已经被内置值取代 ⇒ 面板把"现在的值"读错（读到内置值），
    //   而写回去时又拿着**套好的文本**（内含占位符）去和**内置正文**比 ⇒ 判定"不一样" ⇒
    //   把一份带占位符的副本存进覆盖里 ⇒ 从此**改数值永远存不住**（下一轮又被套回来）✗✗
    const pick = (text) => {
        if (!text) return null;
        if (!numbers || !locked || opts.rebase === false) return text;
        const def = defaultModuleText(id);
        const reb = rebaseNumbers(def, text);
        if (reb) return reb;
        return isNumbersOnlyDiff(def, text) ? text : null;
    };
    if (targetName) {
        const t = targetPatchOf(targetName, id);
        const out = pick(t);
        if (out) return out;
    }
    const g = s.modules?.[id];
    const gt = (g && typeof g.text === 'string' && g.text.length) ? g.text : null;
    const out2 = pick(gt);
    if (out2) return out2;
    return defaultModuleText(id);
}

/** 某个对象改过的这条补丁（**用户本人读全局设置，别人读本聊天** ✓ 见 store.js 顶部那段） */
function targetPatchOf(targetName, id) {
    if (isUserKey(targetName)) {
        const bag = settings().targetPatches?.[targetName];
        const v = bag?.[id];
        return (typeof v === 'string' && v.length) ? v : null;
    }
    return targetPatchText(targetName, id);
}

/** 某条模块的文案是不是被改过 */
export function isTextOverridden(id, targetName = null) {
    const s = settings();
    if (targetName) {
        const t = targetPatchOf(targetName, id);
        if (t) return 'target';
    }
    const g = s.modules?.[id];
    if (g && typeof g.text === 'string' && g.text.length) return 'global';
    // ★ 2026-10-19：按档存的正文（版本切换里改的）也算"改过" —— 不然卡片上看不出来 ✓
    if (g && g.variants && Object.keys(g.variants).length) return 'global';
    return false;
}

/**
 * 这条模块在当前范围下「等于代码默认文案」吗？
 *
 * 用来实现这个诉求：**预设档案只保留已经修改过的内容，不修改的不保存**。
 *   —— 展开「全文编辑」看一眼、没改就点了保存，这**不算修改**，
 *      不该在里面留下一份"存档那一刻默认值"的副本（那会把以后对默认文案的改进冻结掉）。
 */
function isDefaultModuleText(id, text) {
    const def = MODULES.find(m => m.id === id)?.text ?? '';
    return String(text ?? '') === String(def);
}

export function setModuleText(id, text, targetName = null) {
    const s = settings();
    const same = isDefaultModuleText(id, text);
    if (targetName) {
        // ★ 用户本人那份仍然存【全局设置】，其他对象存【本聊天】
        if (!isUserKey(targetName)) {
            // 和默认一样 → 不留覆盖（回落到代码默认）
            setTargetPatchText(targetName, id, same ? null : text);
            return;
        }
        s.targetPatches[targetName] = s.targetPatches[targetName] || {};
        // 和默认一样 → 不留覆盖（回落到代码默认）
        if (same) delete s.targetPatches[targetName][id];
        else s.targetPatches[targetName][id] = text;
        // 空壳也别留垃圾条目
        if (!Object.keys(s.targetPatches[targetName]).length) delete s.targetPatches[targetName];
    } else {
        const cur = { ...(s.modules[id] || {}) };
        if (same) delete cur.text;
        else cur.text = text;
        // 只剩空壳也别留垃圾条目
        if (Object.keys(cur).length) s.modules[id] = cur;
        else delete s.modules[id];
    }
    save();
}

export function resetModuleText(id, targetName = null) {
    const s = settings();
    if (targetName) {
        if (!isUserKey(targetName)) {
            setTargetPatchText(targetName, id, null);
            return;
        }
        const t = s.targetPatches?.[targetName];
        if (t) {
            delete t[id];
            if (!Object.keys(t).length) delete s.targetPatches[targetName];
        }
    } else {
        if (s.modules[id]) delete s.modules[id].text;
    }
    save();
}

/** 某条模块该发给谁：'main' | 'judge' | 'both' */
export function moduleRole(id) {
    return MODULES.find(m => m.id === id)?.role ?? 'judge';
}

export function moduleScope(id) {
    return MODULES.find(m => m.id === id)?.scope ?? 'global';
}

// ---------------------------------------------------------------------------
// 补丁编辑范围：只能改数值 / 全文可改
// ---------------------------------------------------------------------------
// ★ **只锁会进插件 API 的那批**（判定规则 + 两边都发的体质补丁），
//   描写风格那些（只发主 API）不吃插件 API 的 token ⇒ 两种范围下都能改 ✓
// 坑：从「全文可改」切回「只能改数值」时，
//   你之前改过的正文**冻结不删**（不生效，随时能解冻），而且**必须显眼标出来**
//   （"静默忽略你的改动"是这类系统最恶劣的错 ✓）
//
// ★ 为什么"冻结"是**按内容推导**、而不是存一个标记：
//   参数面板和全文编辑**改的是同一份文字**（params.js 的 write 就是在改文案里的锚点 ✓）
//   ⇒ 若给每条存一个"冻结"标记，玩家在数值模式下改数字时，
//     要么覆盖掉那份被冻结的正文（丢数据 ✗）、要么数字改不动（数值模式就没用了 ✗）
//   ⇒ 所以按**内容**判：只把**数字**变了的那份照常生效（这正是"只能改数值"的字面意思 ✓），
//     正文一旦被改写就整条冻结 ✓ —— 无需额外存储，也没有"标记和内容打架"的可能 ✓
// ---------------------------------------------------------------------------

/** 当前补丁编辑范围：'numbers'（只能改数值，默认）| 'full'（全文可改） */
export function patchScope() {
    return settings().patchScope === 'full' ? 'full' : 'numbers';
}

export function setPatchScope(v) {
    const s = settings();
    s.patchScope = (v === 'full') ? 'full' : 'numbers';
    save();
    return s.patchScope;
}

/** 代码里那份内置原文 */
export function defaultModuleText(id) {
    return MODULES.find(m => m.id === id)?.text ?? '';
}

// ---------------------------------------------------------------------------
// ★ 涩涩成就的提示词（两半，见上面 settings().ach 那段说明）
// ---------------------------------------------------------------------------

/**
 * 【结构句】—— 只读，玩家改不了。
 * 它管的是"什么时候报、字段叫什么"：被改坏 ⇒ AI 不再报 ⇒ 面板永远空着，而且不报错 ✗
 */
export const ACH_STRUCT = '【成就】不是每轮都有，大多数轮次应该是空数组：只有达到下面任一条才写（最多 4 条），每条都带 type：普通 / 受精成功 / 着床完成 / 分娩。\n'
    + '普通成就只认这几种：第一次发生（第一次怀孕、第一次做某类事、第一次去某地）；关系、称呼、身份有明确变化；身体或孕期状态跨过一个明确阶段；少见场合或组合；明显的反转、翻车、打脸。普通日常、重复做过的事、换个说法的同一件事、只是对话 / 吃饭 / 洗澡 / 睡觉、只嘴硬装腔没有实质变化，都不算；同一个梗或同一类成就不要每轮都报。\n'
    + '事件成就：这一轮正文跨过了着床完成日 / 受孕窗口结束日，或者剧情里发生了分娩，各补一条（受精成功 / 着床完成 按"成功"写；就算上一轮状态里还写着"还没掷"，也先写一条，系统会按真掷出来的结果筛）。写的是结果本身（怀孕 / 着床成功），吐槽也按已经怀上了写，不要写"到了某天""等着结果""还得掷骰子"这类话。\n'
    + '每条写 name 是成就名字（不超过 8 个字），why 是一句话说明「因为什么」触发的（不超过 20 字，只写推演数据里真有的事实，不许编），quip 是那段吐槽（怎么写见【成就吐槽】）。同一件事只报一次。名字、依据、吐槽都用纯文本，不许出现表情符号。';

/**
 * 成就那三个字数上限的**出厂值**。
 *
 * 为什么要把它们抽出来：规则句里写的是 8 / 20 / 90，而 `store.js` 那边的兜底是
 * 24 / 60 / 80 —— **两套数**（代码是故意放宽的保险丝，不是没对齐 ✗，但玩家看不到这个区别）。
 * ⇒ 现在三个数由设置说了算：规则句里那三个数按它渲染，面板上也能调 ✓
 */
export const ACH_LEN_DEF = { name: 8, why: 20, quip: 120 };

/** 成就那三个字数上限：读设置（1~500），读不到 / 坏值就用出厂值 ✓ */
export function achLenOf(key) {
    const def = ACH_LEN_DEF[key];
    const n = Math.round(Number(settings()['ach' + key.charAt(0).toUpperCase() + key.slice(1) + 'Max']));
    if (!Number.isFinite(n) || n < 1 || n > 500) return def;
    return n;
}

/** 规则句（把三个字数上限渲染成当前值；出厂时与 ACH_STRUCT 逐字相同 ✓） */
export function achStructText() {
    return ACH_STRUCT
        .replace(/(不超过 )\d+( 个字)/, `$1${achLenOf('name')}$2`)
        .replace(/(不超过 )\d+( 字，只写推演数据里真有的事实)/, `$1${achLenOf('why')}$2`);
}

/**
 * 【风格段】的内置默认 —— 玩家可以整段改掉（改坏只影响吐槽好不好听 ✓）
 *
 * ⚠️⚠️ **这里不许放例子**（红线：不要给例子 ✗）。
 *   两条理由，任一都够：
 *     ① **给了例子，AI 会照着抄**（同一个味道反复出现），而且它会把例子里那件事
 *        当成"这个插件就是这样"的模板；
 *     ② **插件是要发布的** —— 例子一定带着某个具体人的具体玩法（角色外号、具体桥段），
 *        那等于把一个人的私货写进所有人都会收到的默认提示词里 ✗
 *   ⚠️ 范例只能是**判据**（"要的是那种效果"），不是要抄进产出的**内容** ✓。
 *   想定风格 ⇒ 写成**可执行的特征**（夸张 / 市井 / 嘴欠 / 该质问就质问 + 点角色名 + 打破第四面墙）✓
 *   ⚠️ 同理：给"备注"输入框写取向色彩举例也不行（换成更中性的，或者干脆不给例子）✓
 */
// ⚠️ 不许加「不许提别的作品里的角色、梗或人名」这类防线 ✗
//   （加了会挡住顺着"银魂 / 死侍"去玩别家梗的味道 —— 那正是这里要的 ✓）
//   ⇒ 这条防线别再自己加回来 ✗
export const ACH_STYLE_DEFAULT = [
    '【成就吐槽】触发成就时，再写一段吐槽当描述：一两句话，不超过 120 字，只写吐槽本身。',
    '开口要像活人突然抢话、插嘴、拆台，直接从这一条成就里最具体的动作、细节或一句反驳起手；不要先喊人，不要用固定的招呼词。',
    '句子要短，句尾带说话的口气（吧 / 嘛 / 啊 / 诶 / 哦），拉长音用重复字或波浪号，不要用破折号。',
    '要欠揍，写到让人想顺着网线过来打你。下面这几样至少做到一两样：',
    '- 阴阳怪气：先假夸一句，紧接着打脸。',
    '- 疯狂揭短：点出这一轮最尴尬的那一个具体细节，不要泛泛而谈。',
    '- 幸灾乐祸：明说自己很乐意看见这个，别装客观。',
    '- 得寸进尺：在成就之上再要一个过分的要求，比如再来一次。',
    '动作感靠说话本身带出来（你听见没有 / 来来来 / 别装 / 抬头看我），不要用括号写舞台动作。',
    '语气：银魂 + 死侍那种，毒舌、嘴欠、夸张、市井，可以打破第四面墙，冲角色、剧情、规则和屏幕外玩家吐槽，也可以自嘲、抢话、吐槽规则本身。',
    '吐槽必须接住这条成就的名字或触发原因，不能换成另一个成就也成立。',
    '· 可以点本作里出现过的角色名、外号、称呼；只点这一轮真的在场或被提到的，没把握就不点。',
    '· 至少抓一个本轮事实来夸张；用数字时只能拿本轮状态里现成的那一格，拿不准就用事件细节，不许自己算、不许补数。',
    '· 可以顺带吐槽自己给成就起的名字烂、敷衍、中二，但只能当补刀，不能整段都在骂名字，也不能替代本轮事实。',
    '· 可以损操作、选择、运气和剧情荒诞，不损智商、身体、现实身份、家人；不人身攻击。',
    '· 结尾像活人补刀或破防，别写成系统通知，也别把自己写成「系统」「旁白」来发布规则。',
    '· 纯文本，不许出现表情符号。',
    '【语感示范，只学这个口气、断句和欠揍的程度，内容一律不要照抄；开头的词也不许照抄】',
    '- 哇，好厉害哦，真的，我鼓掌了，你听见没有。就这你也能做成？那你之前那些搞砸的算什么，热身吗。',
    '- 哦豁，翻车了？太好了，我今天就在等这一刻。来来来，再试一次，我还想看。',
    '- 你刚才是不是心虚了一下？就一下？抬头看我，别装。',
    '- 桥豆麻袋！这也能行？你这运气是出门踩了十斤狗屎，还是偷偷给主API塞了红包？这种阴间概率都能让你撞上，还不快去把下半辈子的彩票全买了。求求你了，赶紧给API续个大套餐，等一下Token一断，我就没法继续愉快地嘲笑你了哦！',
].join('\n');

/** 开关（默认关） */
export function achOn() {
    return settings().ach?.on === true;
}

export function setAchOn(v) {
    const s = settings();
    if (!s.ach || typeof s.ach !== 'object') s.ach = { on: false, style: '' };
    s.ach.on = !!v;
    save();
    return s.ach.on;
}

/** 解锁成就时右上角弹不弹气泡（默认开；老存档没有这格 ⇒ 当作开 ✓） */
export function achToastOn() {
    return settings().ach?.toast !== false;
}

export function setAchToastOn(v) {
    const s = settings();
    if (!s.ach || typeof s.ach !== 'object') s.ach = { on: false, style: '' };
    s.ach.toast = !!v;
    save();
    return s.ach.toast;
}

/** 成就气泡停留几秒（默认 8；0 = 不自动关，点 ✕ 才走；范围 2~30，填 0 / 1 当 0 处理 ✓）
 *  ★ 为什么要有它：成就吐槽最长 90 字，2.5 秒读不完；有人嫌久 —— 一头写死总不合适 ✓ */
export const ACH_TOAST_SEC_DEF = 8;
export function achToastSec() {
    const raw = settings().ach?.toastSec;
    // 老存档没有这格 ⇒ 用默认（不是"不自动关"，这点很关键 ✓）
    if (raw === undefined || raw === null || raw === '') return ACH_TOAST_SEC_DEF;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return ACH_TOAST_SEC_DEF;
    if (n <= 0) return 0;                       // 0 / 负数 ⇒ 不自动关
    return Math.min(30, Math.max(2, n));        // 1 秒太短，抬到 2
}

export function setAchToastSec(v) {
    const s = settings();
    if (!s.ach || typeof s.ach !== 'object') s.ach = { on: false, style: '' };
    const n = Number(v);
    s.ach.toastSec = Number.isFinite(n) ? Math.max(0, Math.min(30, Math.round(n))) : ACH_TOAST_SEC_DEF;
    save();
    return s.ach.toastSec;
}

/** 当前的风格段（没自己改过就是内置默认）
 *  ★ 吐槽那个字数上限（出厂 90）也在这里按设置渲染 ✓ */
export function achStyle() {
    const t = settings().ach?.style;
    const base = (typeof t === 'string' && t.trim()) ? t : ACH_STYLE_DEFAULT;
    // ⚠️ 玩家自己改过风格段时**不替换**（那段是他的原文，动了就是偷偷改他的字 ✗）
    if (typeof t === 'string' && t.trim()) return base;
    return base.replace(/(不超过 )\d+( 字，只写吐槽本身)/, `$1${achLenOf('quip')}$2`);
}

/** 玩家是不是自己改过（用来在界面上标"已改过" / 显示「恢复默认」） */
export function achStyleCustom() {
    const t = settings().ach?.style;
    return !!(typeof t === 'string' && t.trim());
}

export function setAchStyle(t) {
    const s = settings();
    if (!s.ach || typeof s.ach !== 'object') s.ach = { on: false, style: '' };
    s.ach.style = String(t ?? '');
    save();
    return s.ach.style;
}

export function resetAchStyle() {
    return setAchStyle('');
}

/** 成就提示词的字符数（设置页要读数 —— 成本不能隐形 ✓） */
export function achPromptChars() {
    return achStructText().length + achStyle().length;
}

/**
 * 拼给推演看的那两段（开关关着 ⇒ 一个字都不发 ✓）
 * ⚠️ 只发给**推演那条**（插件 API），主 API 一个字都不带 ✓
 * ★ 结构句与风格段都按**当前那三个字数上限设置**渲染（出厂逐字相同 ✓）
 */
export function buildAchText() {
    if (!achOn()) return '';
    return achStructText() + '\n' + achStyle();
}

/**
 * 这条模块的正文在「只能改数值」模式下要不要锁住。
 *
 * 两条理由，缺一不可：
 *   ① 会进插件 API 的那批（judge / both）—— 正文被改会直接把判定规则改坏 ✗
 *   ② ★ 身体补丁（body_base）—— 它只发主 API，但正文里**嵌着这个角色的数值**
 *      （周期长度 / 排卵日 / 体质系数 / 种族名，见 params.js 那张数值面板）。
 *      正文被改写 ⇒ 数值面板的锚点就没了、那些数字也就改不动了。
 *      ⇒ **身体补丁 body_base 也要锁** ✓
 */
export function isPatchLocked(id) {
    // ★ 2026-10-15：`zone_levels`（敏感带等级表现参考）**例外，不锁** ——
    //   它虽然是 both（会进插件 API），但**整条正文就是给玩家改的内容**（各等级什么表现 ✓，
    //   参数面板上那 6 个文本格＝这条正文本身）⇒ 锁它等于"面板上改了也白改" ✗
    //   判据：**这条模块的正文是不是玩家自己拥有的内容** —— 是 ⇒ 不锁 ✓
    //   （它没有判定规则，改坏也只是描写口径偏了，不会算错账 ✓）
    if (id === 'zone_levels') return false;
    return id === 'body_base' || moduleRole(id) !== 'main';
}

/**
 * 「只改了数值面板里那些值、没动正文」吗？
 * 把**数值面板管得着的每一格**换成占位符再比 ——
 *   ① 数字（周期 / 排卵日 / 体质系数 …）
 *   ② ★ 还有一格不是数字：种族名（params.js 的 raceName）——
 *      它同样是数值面板里的一格，漏掉它 ⇒ 改个种族名会被当成"改了正文"、整条被冻结 ✗
 *      ⚠️ 口径是"人类不是体质、是种族"（那格改成写种族）⇒
 *         正文现在是 `{{user}} 的种族为人类`，老存档里可能还是 `{{user}} 为X体质`
 *         ⇒ **先把老写法归一到新写法**，再抹掉名字。不然老存档会平白无故变成"改过正文"被冻结 ✗
 *         （和 params.js 顶上那四个锚点是同一套判据，两处各写一份、靠 units 比对 ✓）
 * 这样"周期从 28 改成 30 / 种族从人类改成精灵"算数值改动 ✓、
 * 而"加一句规则 / 换个措辞"才是正文改动 ✓
 */
function isNumbersOnlyDiff(def, cur) {
    return skelOf(def) === skelOf(cur);
}

/**
 * 一行的「骨架」＝ 把所有**数字**、以及**数值面板管得着的那几格**（种族名等）换成占位符。
 * ⚠️ 三套老排版都要归一到同一骨架（老存档的正文得和新正文骨架相同才配得上 ✓）。
 */
function skelOf(t) {
    return String(t ?? '')
        // ① 老排版 → 新排版
        //   （先「种族为XX」、后把数值句改成一行一格。
        //     摆放方式不同，但点点都是**数值面板里那几格** ⇒ 不该算改正文 ✗）
        .replace(/周期：\s*[\d.]+\s*天[，,]\s*排卵日第\s*[\d.]+\s*天/g, '周期长度：#天\n排卵日：#')
        .replace(/日常体质系数[：:]?\s*[\d.]+\s*[（(]?\s*[，,]?\s*排卵日当天临时提升至\s*[\d.]+\s*[）)]?/g,
            '日常体质系数：#（排卵日当天临时提升至 #）')
        // ② 种族名的三种写法统一成「种族：#」
        //   （`{{user}} 为X体质` ⇒ `{{user}} 的种族为X` ⇒ 现在独占一行 `种族：X`）
        .replace(/(\{\{user\}\}\s*)为\s*[^\s，,。]+?\s*(?:女性|男性|雌性|雄性|扶她)?\s*体质/g, '$1的种族为#')
        .replace(/(\{\{user\}\}\s*的种族为\s*)[^\s，,。]+/g, '种族：#')
        .replace(/(种族：\s*)[^\s，,。]+/g, '种族：#')
        // ③ 剩下的数字
        .replace(/\d+(?:\.\d+)?/g, '#');
}

/**
 * ★★ 「只能改数值」要做到名副其实 ——
 *   把玩家那份里的**数值**套回**最新的内置正文**上。
 *
 * 为什么必须有它（起因：身体补丁 / 生理期体质补丁改了之后会不会同步）：
 *   ① 改一个数字时 `params.js` 会把**存档那一刻的整份正文 ＋ 玩家改的数字**存进存档；
 *   ② 插件以后改内置正文 ⇒ 那份和新正文的差异就**不止数字了** ⇒
 *      `isPatchFrozen` 判成"改过正文"⇒ 整条冻结 ⇒ `moduleTextRaw` 跳过它 ⇒
 *      **那条回落到新内置正文，改过的数字先不生效** ✗
 *   ⇒ 修法：按**行骨架**对齐 —— 内置正文每一行拿那份去按骨架配对，
 *      配上就把**那一行整行**拿来（数字 / 种族名这些差异都在里面 ✓）。
 *    ⇒ 结果：正文更新**进得来**、数值**一个字不丢**、也不会再"假冻结" ✓
 *
 * ⚠️ 语义边界（关键取舍）：「只能改数值」这个模式**本来就只认数字**
 *   （判定规则的正文不许改，这就是这个模式的定义）⇒ 那份里**多出来的散文行会被丢掉**，
 *   这是模式契约的一部分 ✓（不是丢数据 —— 界面上照旧显示"改过正文、现在不生效" ✓）。
 *
 * @returns {string|null} 拼好的正文；一行都没配上 ⇒ null（调用方回落到老判据 ✓）
 */
function rebaseNumbers(defText, curText) {
    const defLines = String(defText ?? '').split('\n');
    const curLines = String(curText ?? '').split('\n');
    const pool = new Map();
    for (const ln of curLines) {
        const sk = skelOf(ln);
        if (!pool.has(sk)) pool.set(sk, []);
        pool.get(sk).push(ln);
    }
    const used = new Map();
    let changed = false;
    const out = defLines.map((ln) => {
        const sk = skelOf(ln);
        const list = pool.get(sk);
        if (!list || !list.length) return ln;
        const i = used.get(sk) || 0;
        used.set(sk, i + 1);
        const hers = list[Math.min(i, list.length - 1)];
        if (hers === ln) return ln;
        changed = true;
        return hers;
    }).join('\n');
    return changed ? out : null;
}

/** 这一层（全局 / 某个对象）改过的补丁原文；没改过 ⇒ null */
function overrideTextOf(id, targetName) {
    if (targetName) return targetPatchOf(targetName, id);
    const g = settings().modules?.[id];
    return (g && typeof g.text === 'string' && g.text.length) ? g.text : null;
}

/**
 * 这条补丁现在是不是**被冻结**（有一份正文改动，但当前范围不让它生效）。
 */
export function isPatchFrozen(id, targetName = null) {
    if (patchScope() !== 'numbers') return false;   // 全文可改 ⇒ 什么都不冻 ✓
    // 不认识的 id（老配置残留 / 别的扩展塞进来的）不算 —— 页面上也列不出它 ✓
    if (!MODULES.some(m => m.id === id)) return false;
    if (!isPatchLocked(id)) return false;           // 描写风格那批本来就不锁 ✓
    const cur = overrideTextOf(id, targetName);
    if (!cur) return false;
    return !isNumbersOnlyDiff(defaultModuleText(id), cur);
}

/** 被冻结的那份原文（界面上要能"看一眼" ✓）；没冻结 ⇒ null */
export function frozenPatchText(id, targetName = null) {
    return isPatchFrozen(id, targetName) ? overrideTextOf(id, targetName) : null;
}

/** 这个对象**改过的补丁文案**有哪些模块 id
 *  ⚠️ 用户本人（USER_KEY）那份存在**全局设置**里、别人存在本聊天 ⇒ 别拿 store 的
 *    targetPatchBag 当通用入口（"清空这个对象的专属补丁"就这么空转过 ✗） */
export function overriddenPatchIds(targetName) {
    const s = settings();
    const bag = isUserKey(targetName)
        ? (s.targetPatches?.[targetName] || {})
        : targetPatchBag(targetName);
    return Object.keys(bag || {});
}

/** 这个上下文（null = 世界观那批 / 某对象 = 人物那批）里被冻结的模块 id */
export function frozenPatchIds(targetName = null) {
    const s = settings();
    const ids = targetName ? overriddenPatchIds(targetName) : Object.keys(s.modules || {});
    return ids.filter((id) => isPatchFrozen(id, targetName));
}

/** 全部上下文里被冻结的条数（切换范围时用它报「有 N 条」✓） */
export function frozenPatchCount() {
    let n = frozenPatchIds(null).length;
    let targets = {};
    try { targets = state().targets || {}; } catch { targets = {}; }
    for (const k of Object.keys(targets)) {
        if (isUserKey(k)) continue;      // 本人那份存在全局设置里，下面单独数 ✓
        n += frozenPatchIds(k).length;
    }
    n += frozenPatchIds(USER_KEY).length;
    return n;
}

// ---------------------------------------------------------------------------
// ★ 给推演读的世界书：配置读写（数据怎么来见 src/wi.js）
// ---------------------------------------------------------------------------
// 规矩（详见 DEFAULT_SETTINGS.wi 那一块）：
//   · 默认**跟随酒馆**（酒馆开着的条目/这轮注入的那批）
//   · 玩家能在插件里自己开关条目 ⇒ **一旦动过就锁死**，不再跟随
//   · 排除表**全局一份**（不是每个聊天各一份 —— 那很麻烦）
//   · 列**全部**世界书、不写死数量（不是只有 185 本）
// ---------------------------------------------------------------------------

/** 这一个区块（老存档缺字段时自动补齐 ✓） */
export function wiCfg() {
    const s = settings();
    if (!s.wi || typeof s.wi !== 'object' || Array.isArray(s.wi)) s.wi = {};
    const w = s.wi;
    // ★ 老存档没有这一格 ⇒ 按**关**处理（跟出厂默认一致：）
    if (typeof w.enabled !== 'boolean') w.enabled = false;
    // ★★ 2026-10-17（角色卡世界书 / 全局世界书分开）——
    //   老存档只有 `enabled` 这一颗 ⇒ 两颗来源都跟着它走（不然老用户开了的总开关会静默失效 ✗）
    if (typeof w.charBooks !== 'boolean') w.charBooks = w.enabled;
    if (typeof w.globalBooks !== 'boolean') w.globalBooks = w.enabled;
    if (w.mode !== 'manual') w.mode = 'follow';
    if (typeof w.desc !== 'boolean') w.desc = false;
    // ★ 2026-10-23 新增两颗开关（老存档没有 ⇒ 按出厂默认补上 ✓）
    if (typeof w.persona !== 'boolean') w.persona = false;
    if (typeof w.heritageAuto !== 'boolean') w.heritageAuto = true;
    // ★ 2026-10-24（她：遗传判定自动带一次，发送什么要能编辑）——
    //   四类来源各自可选；只在遗传那一轮按这份发（正常 / 当场重判共用）✓
    if (!w.heritageSources || typeof w.heritageSources !== 'object' || Array.isArray(w.heritageSources)) {
        w.heritageSources = { charBook: true, globalBook: true, desc: true, persona: true };
    } else {
        for (const hk of ['charBook', 'globalBook', 'desc', 'persona']) {
            if (typeof w.heritageSources[hk] !== 'boolean') w.heritageSources[hk] = true;
        }
    }
    if (!w.offBooks || typeof w.offBooks !== 'object' || Array.isArray(w.offBooks)) w.offBooks = {};
    if (!w.offEntries || typeof w.offEntries !== 'object' || Array.isArray(w.offEntries)) w.offEntries = {};
    return w;
}

/** 给推演带世界书吗（两颗来源任意一颗开着就算要 ✓） */
export function wiOn() { return wiCharOn() || wiGlobalOn(); }
/** 当前角色卡那几本世界书要不要带 */
export function wiCharOn() { return wiCfg().charBooks === true; }
export function setWiCharOn(v) { wiCfg().charBooks = !!v; save(); }
/** 全局世界书要不要带 */
export function wiGlobalOn() { return wiCfg().globalBooks === true; }
export function setWiGlobalOn(v) { wiCfg().globalBooks = !!v; save(); }

/** 被整本排除掉的书名（列表里的「池子」按这份来 —— 不看"当前在不在用" ✓） */
export function wiOffBookNames() { return Object.keys(wiCfg().offBooks || {}); }

/** 还在跟随酒馆吗（false = 已锁死，按玩家自己那份清单走） */
export function wiFollows() { return wiCfg().mode !== 'manual'; }

/** 角色卡的角色描述要不要带 */
export function wiDescOn() { return wiCfg().desc !== false; }
export function setWiDescOn(v) { wiCfg().desc = !!v; save(); }

/** 用户自己那份人设描述要不要带给推演 */
export function wiPersonaOn() { return wiCfg().persona === true; }
export function setWiPersonaOn(v) { wiCfg().persona = !!v; save(); }
/** 遗传判定时自动带的内容（四类来源，各自可选；正常 / 当场重判共用） */
export function wiHeritageSources() {
    const s = wiCfg().heritageSources || {};
    return {
        charBook: s.charBook !== false,
        globalBook: s.globalBook !== false,
        desc: s.desc !== false,
        persona: s.persona !== false,
    };
}
export function setWiHeritageSource(k, v) {
    const s = wiCfg().heritageSources;
    if (!s || !(k in s)) return;
    s[k] = !!v;
    save();
}

/** 「血脉遗传特质」判定那一轮，临时带一次世界书 ＋ 用户角色设定 */
export function wiHeritageAuto() { return wiCfg().heritageAuto !== false; }
export function setWiHeritageAuto(v) { wiCfg().heritageAuto = !!v; save(); }

/** 这本书给推演看吗 */
export function wiBookAllowed(name) { return wiCfg().offBooks[String(name)] !== true; }

/** 这条给推演看吗（关掉的条目 = 单条排除） */
export function wiEntryAllowed(book, uid) {
    const bag = wiCfg().offEntries[String(book)];
    return !(bag && bag[String(uid)] === true);
}

/** 开/关一整本（on=false ⇒ 排除这本）。⚠️ 动过就锁死 ✓ */
export function setWiBook(name, on) {
    const w = wiCfg();
    const k = String(name);
    if (on) delete w.offBooks[k];
    else w.offBooks[k] = true;
    w.mode = 'manual';
    save();
}

/** 开/关某一条。⚠️ 动过就锁死 ✓ */
export function setWiEntry(book, uid, on) {
    const w = wiCfg();
    const b = String(book);
    const u = String(uid);
    if (!w.offEntries[b] || typeof w.offEntries[b] !== 'object') w.offEntries[b] = {};
    if (on) delete w.offEntries[b][u];
    else w.offEntries[b][u] = true;
    if (!Object.keys(w.offEntries[b]).length) delete w.offEntries[b];
    w.mode = 'manual';
    save();
}

/** 「恢复跟随」：把这份清单清空、回到默认（不动总开关和角色描述开关 ✓） */
export function wiResetFollow() {
    const w = wiCfg();
    w.mode = 'follow';
    w.offBooks = {};
    w.offEntries = {};
    save();
}

/** 排除了多少本 / 多少条（界面上只报数字 ✓） */
export function wiOffCounts() {
    const w = wiCfg();
    const books = Object.keys(w.offBooks).length;
    let entries = 0;
    for (const k of Object.keys(w.offEntries)) {
        const bag = w.offEntries[k];
        if (bag && typeof bag === 'object') entries += Object.keys(bag).length;
    }
    return { books, entries };
}

// ---------------------------------------------------------------------------
// 敏感带档案库（全局）
// ---------------------------------------------------------------------------

export function listZonePresets() {
    const m = settings().zonePresets || {};
    return Object.keys(m).map((id) => ({ id, ...m[id] }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
}

export function saveZonePreset(name, text) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: '得给档案起个名字' };
    const s = settings();
    s.zonePresets = s.zonePresets || {};
    if (Object.values(s.zonePresets).some((x) => x.name === n)) {
        return { ok: false, error: '已经有同名的档案了' };
    }
    const id = 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    s.zonePresets[id] = { name: n, text: String(text || ''), at: Date.now() };
    save();
    return { ok: true, id };
}

export function updateZonePreset(id, text) {
    const s = settings();
    if (!s.zonePresets?.[id]) return { ok: false, error: '这个档案不存在' };
    s.zonePresets[id].text = String(text || '');
    s.zonePresets[id].at = Date.now();
    save();
    return { ok: true };
}


export function deleteZonePreset(id) {
    const s = settings();
    if (!s.zonePresets?.[id]) return { ok: false, error: '这个档案不存在' };
    delete s.zonePresets[id];
    save();
    return { ok: true };
}

export function getZonePreset(id) {
    const x = settings().zonePresets?.[id];
    return x ? { id, ...x } : null;
}

// ---------------------------------------------------------------------------
// ★★ 历法预设库（全局）
//
// 为什么不跟聊天走：**搞一个历法预设库，能存几套、一键切** ✓
//
// 一条预设 = 「历法（一年几个月 / 每月几天）＋ 写法（年月日叫什么 / 月份名 / 数字写法）」
//   **一整套** ⇒ 切过去两样一起换 ✓（省得改了一半）
// 内置一条「公历」（出厂那套），**不可删、不可改名** ✓
// 同名就覆盖（跟敏感带那套不一样：那边是报错）—— 这样"改完存回去"只要再输一次同名 ✓
// ---------------------------------------------------------------------------

/** 内置那一条（出厂公历）的 id —— 它不进存档，界面自己画 ✓ */
export const CAL_PRESET_BUILTIN = '__gregorian__';

/** 最多存几条（防手滑，不是玩法限制） */
export const CAL_PRESET_MAX = 20;

export function listCalendarPresets() {
    const m = settings().calendarPresets || {};
    return Object.keys(m)
        .map((id) => ({
            id,
            name: String(m[id]?.name || '没名字'),
            cal: normalizeCalendar(m[id]?.cal),
            at: Number(m[id]?.at) || 0,
        }))
        .sort((a, b) => a.at - b.at);          // 先存的在前（顺序稳定，不按名字乱跳 ✓）
}

export function getCalendarPreset(id) {
    const x = settings().calendarPresets?.[String(id || '')];
    if (!x) return null;
    return { id: String(id), name: String(x.name || '没名字'), cal: normalizeCalendar(x.cal), at: Number(x.at) || 0 };
}

/**
 * 存一条（**同名就覆盖** ✓）。
 * @returns {{ok:boolean,id?:string,overwrote?:boolean,error?:string}}
 */
export function saveCalendarPreset(name, cal) {
    const n = String(name || '').trim().slice(0, 20);
    if (!n) return { ok: false, error: '得给它起个名字' };
    const s = settings();
    s.calendarPresets = s.calendarPresets || {};
    const c = normalizeCalendar(cal);
    // ⚠️ timeUnit 也要打包进去 —— 漏了它，套用这条预设就会把「钟点」冲回「不记钟点」
    //   （normalizeCalendar 对缺字段一律按出厂补 ⇒ 静默丢，面板上的时间列会消失 ✗）
    const box = { months: c.months.slice(), leap: c.leap, style: c.style, timeUnit: c.timeUnit, weekLen: c.weekLen, weekStart: c.weekStart };
    const same = Object.keys(s.calendarPresets).find((k) => String(s.calendarPresets[k]?.name || '') === n);
    if (same) {                                 // 同名 ⇒ 覆盖它
        s.calendarPresets[same] = { name: n, cal: box, at: Date.now() };
        save();
        return { ok: true, id: same, overwrote: true };
    }
    if (Object.keys(s.calendarPresets).length >= CAL_PRESET_MAX) {
        return { ok: false, error: '最多存 ' + CAL_PRESET_MAX + ' 条，先删一条吧' };
    }
    const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    s.calendarPresets[id] = { name: n, cal: box, at: Date.now() };
    save();
    return { ok: true, id };
}

/** 改名（重名不许，且不许叫「公历」—— 那是内置那条的名字 ✓） */
export function renameCalendarPreset(id, name) {
    const s = settings();
    const key = String(id || '');
    if (!s.calendarPresets?.[key]) return { ok: false, error: '这条不存在了' };
    const n = String(name || '').trim().slice(0, 20);
    if (!n) return { ok: false, error: '名字不能空着' };
    if (n === '公历') return { ok: false, error: '「公历」是内置那一条的名字，换一个吧' };
    const clash = Object.keys(s.calendarPresets).some((k) => k !== key && String(s.calendarPresets[k]?.name || '') === n);
    if (clash) return { ok: false, error: '已经有同名的一条了' };
    s.calendarPresets[key].name = n;
    save();
    return { ok: true };
}

export function deleteCalendarPreset(id) {
    const s = settings();
    const key = String(id || '');
    if (!s.calendarPresets?.[key]) return { ok: false, error: '这条不存在了' };
    delete s.calendarPresets[key];
    save();
    return { ok: true };
}

// ---------------------------------------------------------------------------
// ★★ 日历上的节日
//
// 面板右上角那个开关只管"**出厂那张表**显不显示"；
// 玩家自己标的日子（备注 + 红圈）**永远显示**，不受它影响 ✓
// ---------------------------------------------------------------------------

/** 节日显示开关 */
export function holidaysOn() {
    return settings().calendarHolidays?.on !== false;
}

export function setHolidaysOn(v) {
    const s = settings();
    s.calendarHolidays = (s.calendarHolidays && typeof s.calendarHolidays === 'object')
        ? s.calendarHolidays : { on: true, list: [] };
    s.calendarHolidays.on = !!v;
    save();
    return s.calendarHolidays.on;
}

/**
 * ★ 「格子里显示农历」开关（公历那行下面再显示一行农历 ✓）
 *
 * ⚠️ 跟「节日」那个开关**是两件事、各自独立** ✓。
 * ⚠️ 只在**日期是真实公历**时画得出来（虚拟历法跟现实没有对应关系 ⇒ 那一行不画，也不报错 ✓）。
 * 读取用 `!== false`：老存档没有这个键 ⇒ 默认**开**（不想看再关掉 ✓）。
 */
export function lunarDatesOn() {
    return settings().calendarLunar !== false;
}

export function setLunarDatesOn(v) {
    const s = settings();
    s.calendarLunar = !!v;
    save();
    return s.calendarLunar;
}

/**
 * 节日条目的**键**（三种形状各一种写法 ✓）—— 界面按它删、导出导入按它合并
 * ⚠️ 只能有这一处：`holidayList()` / `removeHoliday()` / `applyCalendarBundle()` 共用 ✓
 *   （同一份清单三个地方各写一套 key 规则 ⇒ 迟早对不上 ✗）
 * @returns {string} 认不出来给空串
 */
export function holidayKeyOf(x) {
    const md = String(x?.md || '').trim();
    if (/^\d{2}-\d{2}$/.test(md)) return md;
    // ★ 农历那条 —— 写法规范化**只走 lunar.js 那一处** ✓
    //   （`12-LAST` 和 `12-30` 是**两个不同的键**：前者是"腊月最后一天"、后者是"腊月三十" ✓）
    const lunar = normalizeLunarSpec(x?.lunar);
    if (lunar) return 'lunar:' + lunar;
    const m = Math.floor(Number(x?.m) || 0);
    const nth = Math.floor(Number(x?.nth) || 0);
    const wd = Math.floor(Number(x?.wd));
    if (m >= 1 && m <= 24 && nth >= 1 && nth <= 5 && Number.isFinite(wd) && wd >= 0 && wd <= 6) {
        return 'nth:' + m + ':' + nth + ':' + wd;
    }
    return '';
}

/**
 * 节日表（只读副本，按日期排好 ✓）。
 * 三种形状（出厂表里都用得上）：
 *   · `{ md:'MM-DD', name }`        —— 固定"几月几日"（**虚拟历法下也算得出来** ✓）
 *   · `{ m, nth, wd, name }`        —— 某月第几个星期几（wd: 0=周日）⇒ **两种历法都算得出来** ✓
 *     （公历走真实星期；自定义历法走它自己的 `weekLen` / `weekStart` ✓）
 *   · `{ lunar:'MM-DD' | 'MM-LAST', name }` —— 农历 ✓
 *     ⚠️ 它**只在历法就是真实公历时**才算得出来（虚拟历法跟现实没有对应关系 ✗）——
 *        门槛在 `ui-calendar.js` 那边（`isGregorian(cal)` ✓）
 *     ⚠️ 写法两种：`08-15` = 农历八月十五；`12-LAST` = 腊月最后一天（除夕 ✓）
 *        为什么要有 `LAST`：腊月有的年 29 天、有的年 30 天 ⇒ 写死 `12-30` 会让
 *        "腊月只有 29 天"的那几年**除夕直接消失** ✗（2025–2028 连着几年都这样 ✓）
 * 每条都带一个 `key`（界面按它删 ✓；键怎么算见上面 `holidayKeyOf` ✓）
 */
export function holidayList() {
    const l = settings().calendarHolidays?.list;
    const out = [];
    for (const x of (Array.isArray(l) ? l : [])) {
        const name = String(x?.name || '').trim();
        if (!name) continue;
        const key = holidayKeyOf(x);
        if (!key) continue;
        const md = String(x?.md || '').trim();
        const lunar = normalizeLunarSpec(x?.lunar);
        if (/^\d{2}-\d{2}$/.test(md)) { out.push({ md, name, key }); continue; }
        if (lunar) { out.push({ lunar, name, key }); continue; }
        out.push({
            m: Math.floor(Number(x?.m) || 0),
            nth: Math.floor(Number(x?.nth) || 0),
            wd: Math.floor(Number(x?.wd)),
            name, key,
        });
    }
    return out;
}

/**
 * 把玩家敲的那一格**认成一条节日**（两种写法都收 ✓）
 *
 * ★ 「5月第2个周日」这种格式必须**支持** ✗
 *   （那一格原来只认 `09-15`），可表里偏偏**显示**成
 *   「5月第2个周日」（出厂那三个是 nth 形状）⇒ 显示一个敲不出来的格式 ✗
 *   ⇒ 两种都能敲，而且说明里写出来 ✓
 *
 * 收这三种：
 *   · `09-15` / `9-15` / `9月15日`            ⇒ `{ md:'09-15' }`
 *   · `5月第2个周日` / `5月的第二个星期日` / `11月第4个周四` ⇒ `{ m:5, nth:2, wd:0 }`（wd: 0=周日 ✓）
 *   · `农历八月初五` ⇒ `{ lunar:'08-05' }`；`除夕` / `农历腊月最后一天` ⇒ `{ lunar:'12-LAST' }`
 *     （农历这一种；`LAST` = 那个农历月的最后一天 ✓）
 * @returns {{ok:true, item:object}|{ok:false, error:string}}
 */
export function parseHolidayInput(text) {
    const s = String(text || '').trim();
    if (!s) return { ok: false, error: '日期还没写' };
    // ① 「几月几日」（1~2 位都收，写成 `09-15` 那种规范写法 ✓）
    let m = s.match(/^(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?$/);
    if (m) {
        const mo = Number(m[1]);
        const d = Number(m[2]);
        if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) {
            return { ok: false, error: '这个日期不存在，写成 09-15 这样' };
        }
        return { ok: true, item: { md: String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') } };
    }
    // ② 「某月第几个星期几」—— 按界面上显示的那种写法一字不差地收 ✓
    const CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const cn2num = (t) => {
        if (/^\d+$/.test(t)) return Number(t);
        if (t === '十') return 10;
        const mm = t.match(/^十([一二三四五六七八九])$/);
        if (mm) return 10 + CN[mm[1]];
        return CN[t] || 0;
    };
    // ★ 农历的「几月」：正月 / 元月 = 1；冬月 / 十一月 = 11；腊月 / 十二月 = 12 ✓
    const cnMonthNum = (t) => {
        if (/^\d{1,2}$/.test(t)) return Number(t);
        if (/^[正一元]$/.test(t)) return 1;
        if (t === '冬' || t === '十一') return 11;
        if (t === '腊' || t === '十二') return 12;
        return CN[t] || 0;
    };
    // ★ 农历的「初几」：初一…初十 / 十一…十九 / 二十 / 廿一…廿九 / 三十 ✓
    const cnDayNum = (t) => {
        if (/^\d{1,2}$/.test(t)) return Number(t);
        if (t === '二十' || t === '廿') return 20;
        if (t === '三十' || t === '卅') return 30;
        const c10 = t.match(/^初(十|[一二三四五六七八九])$/);
        if (c10) return c10[1] === '十' ? 10 : (CN[c10[1]] || 0);
        const c20 = t.match(/^廿([一二三四五六七八九])$/);
        if (c20) return 20 + CN[c20[1]];
        const c1x = t.match(/^十([一二三四五六七八九])?$/);
        if (c1x) return 10 + (c1x[1] ? CN[c1x[1]] : 0);
        return CN[t] || 0;
    };
    const nthRe = /^(\d{1,2})\s*月\s*(?:的)?\s*第?\s*([一二三四五1-5])\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天0-7])$/;
    const n = s.match(nthRe);
    if (n) {
        const mo = Number(n[1]);
        const nth = cn2num(n[2]);
        const wdRaw = n[3];
        let wd;
        if (/\d/.test(wdRaw)) {
            const num = Number(wdRaw);
            wd = (num === 7) ? 0 : num;            // 7 和 0 都是周日 ✓
        } else {
            wd = ({ '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 })[wdRaw] ?? -1;
        }
        // ⚠️ 月份上限是 **12**（这种节日只在真实公历下算 ⇒ 跟着公历走 ✓；
        //   24 是自定义历法那边的月数上限，别抄过来 ✗ —— 抄了会放过"13月第2个周日"✓）
        if (!(mo >= 1 && mo <= 12) || !(nth >= 1 && nth <= 5) || !(wd >= 0 && wd <= 6)) {
            return { ok: false, error: '这种日子认不出来，写成 5月第2个周日 这样' };
        }
        return { ok: true, item: { m: mo, nth, wd } };
    }
    // ③ ★ 农历 ——
    //   农历数据要找一份现成资料（这部分不用自己攒 ✓）
    //   ⚠️ 数据源与校验结论见 `src/lunar.js` 顶上那一段 ✓
    //   ⚠️ 「除夕」不用带农历两个字也收（大家就是这么叫的 ✓）——
    //      它是**腊月最后一天**、不是"腊月三十"（腊月 29 天的那几年没有三十 ✗）
    if (/^(除夕|大年三十|大年廿九|腊月最后一天)$/.test(s)) return { ok: true, item: { lunar: '12-LAST' } };
    if (/^农历/.test(s)) {
        const body = s.replace(/^农历\s*/, '');
        // ⓵ 「…月最后一天」那种 —— 只有腊月那种有意义（它就是除夕 ✓）
        const last = body.match(/^(.+?)\s*月\s*(?:最后一天|最后一日)$/);
        if (last && cnMonthNum(last[1].trim()) === 12) return { ok: true, item: { lunar: '12-LAST' } };
        // ⓶ 「几月初几」
        const lz = body.match(/^(.+?)\s*月\s*(.+?)\s*日?$/);
        if (lz) {
            const mo = cnMonthNum(lz[1].trim());
            const dd = cnDayNum(lz[2].trim());
            if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 30) {
                return { ok: true, item: { lunar: String(mo).padStart(2, '0') + '-' + String(dd).padStart(2, '0') } };
            }
        }
        // ⚠️ 认不出来就**说实话**（别再写"还没做"了 —— 现在做了 ✓）
        return { ok: false, error: '这个农历写法看不懂，例：农历八月初五 / 农历腊月最后一天' };
    }
    return { ok: false, error: '认不出来。写 09-15 / 5月第2个周日 / 农历八月初五 这样' };
}

/** 加 / 改一条（同一个键就是覆盖 ✓）；名字留空 = 把那天去掉 ✓ */
export function setHoliday(dateText, name) {
    const n = String(name || '').trim().slice(0, 12);
    if (!n) {
        // 名字留空 ⇒ 当成"删掉这天"：先换算成**键**（`09-15` 和 `5月第2个周日` 都能删 ✓）
        const r0 = parseHolidayInput(dateText);
        return removeHoliday(r0.ok ? holidayKeyOf(r0.item) : String(dateText || '').trim());
    }
    const r = parseHolidayInput(dateText);
    if (!r.ok) return { ok: false, error: r.error };
    const item = { ...r.item, name: n };
    const key = holidayKeyOf(item);
    const s = settings();
    s.calendarHolidays = (s.calendarHolidays && typeof s.calendarHolidays === 'object')
        ? s.calendarHolidays : { on: true, list: [] };
    if (!Array.isArray(s.calendarHolidays.list)) s.calendarHolidays.list = [];
    // ⚠️ 覆盖要按**同一个键**找（`holidayKeyOf` 只许一处 ✓）—— 只比 `md` 的话，
    //   "5月第2个周日"这种加进去会变成两条 ✗
    const i = s.calendarHolidays.list.findIndex((x) => holidayKeyOf(x) === key);
    if (i >= 0) s.calendarHolidays.list[i] = item;
    else {
        if (s.calendarHolidays.list.length >= 60) return { ok: false, error: '最多 60 个，先删几个吧' };
        s.calendarHolidays.list.push(item);
    }
    save();
    return { ok: true, key, item };
}

export function removeHoliday(key) {
    const k = String(key || '').trim();
    const s = settings();
    const l = s.calendarHolidays?.list;
    if (!k || !Array.isArray(l)) return { ok: false, error: '那天本来就没有' };
    // ⚠️ 键怎么算**只许一处**（`holidayKeyOf`）—— 不许在这儿自己再抄一套 ✗
    const i = l.findIndex((x) => holidayKeyOf(x) === k);
    if (i < 0) return { ok: false, error: '那天本来就没有' };
    l.splice(i, 1);
    save();
    return { ok: true, removed: true };
}

// ---------------------------------------------------------------------------
// ★★ 现实日历那份日程
//
// 非聊天也能存 —— 记录东西这件事不该被剥夺，走全局这一层就存得下 ✓✓
//   （非聊天也当然存得下 —— 走全局这一层就行 ✓）
//
// ⚠️ 它跟聊天那份的**唯一区别是日期格式**：
//   聊天那份 = 按当前写法渲染出来的串（`1年02月14日` / `第三轮·孟春·初七`）
//   这份     = **真实公历 `YYYY-MM-DD`**（面板不在聊天里时显示的就是设备日期 ⇒ 必须跟它对齐 ✓）
//   ⇒ 两边**不会互相串**（一串真实公历日期和"1年02月14日"本来就长得不一样 ✓）
// ⚠️ 排序 / 那行字 / 空壳子判定 / 改一格的校验**跟聊天那份共用** `calendar-events.js` ✓
// ---------------------------------------------------------------------------

/** 一天最多挂几条 / 整份最多多少条（跟聊天那份一个口径 ✓） */
const MAX_REAL_EVENTS = 1000;

/** 现实日历那份所有日程（全局设置里 ✓） */
export function realEvents() {
    const s = settings();
    if (!Array.isArray(s.realEvents)) s.realEvents = [];
    return s.realEvents;
}

/** 某一天（`YYYY-MM-DD`）的日程，排好序 ✓ */
export function realEventsOn(date) {
    return calEvOn(realEvents(), date);
}

/** 给这一天加一条空的 ✓ */
export function addRealEvent(date) {
    const d = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const arr = realEvents();
    const same = arr.filter((x) => String(x?.date || '') === d);
    if (same.length >= MAX_CAL_EVENTS_PER_DAY) return null;
    const e = { id: calEvId(), date: d, title: '', allDay: true, start: '', end: '', note: '', at: Date.now() };
    arr.push(e);
    if (arr.length > MAX_REAL_EVENTS) arr.splice(0, arr.length - MAX_REAL_EVENTS);
    save();
    return { id: e.id, date: e.date };
}

/** 改一条（只改给进来的那几格 ✓） */
export function updateRealEvent(date, id, patch = {}) {
    const d = String(date || '').trim();
    const key = String(id || '').trim();
    if (!d || !key) return { ok: false, warn: '这条日程已经不在了' };
    const e = realEvents().find((x) => String(x?.id || '') === key && String(x?.date || '') === d);
    if (!e) return { ok: false, warn: '这条日程已经不在了' };
    const r = calEvApply(e, patch);
    save();
    return {
        ok: true,
        warn: r.warn,
        entry: { id: e.id, date: e.date, allDay: !!e.allDay, start: e.start, end: e.end, note: e.note },
    };
}

/** 删掉一条 ✓ */
export function deleteRealEvent(date, id) {
    const d = String(date || '').trim();
    const key = String(id || '').trim();
    if (!d || !key) return false;
    const arr = realEvents();
    const i = arr.findIndex((x) => String(x?.id || '') === key && String(x?.date || '') === d);
    if (i < 0) return false;
    arr.splice(i, 1);
    save();
    return true;
}

/** 给面板格子的那份（纯数据 ✓） */
export function realEventsForPanel() {
    return calEvForPanel(realEvents(), timeUnitNow());
}

/** 某一天的小卡片（`day` 直接从 `YYYY-MM-DD` 里取 ✓，不用过插件那套历法 ✓） */
export function realEventDayCard(date) {
    const p = parseDeviceDate(date);
    if (!p) return null;
    const card = calEvCard(realEvents(), date, timeUnitNow());
    return { day: p.d, label: card.label ? card.label.slice(0, 6) : '', count: card.count };
}

/** 清掉空壳子（`keepDate` = 正在编辑的那一天，不碰 ✓） */
export function pruneEmptyRealEvents(keepDate) {
    const n = calEvPrune(realEvents(), keepDate, timeUnitNow());
    if (n) save();
    return n;
}


/**
 * ★★ 现实那份「到日子了」该提示的（非聊天日历也要提醒 ✓）
 *
 * ⚠️ 判据是**这台设备上的今天**（`new Date()`）—— 跟聊天那份"剧情日期走到了"不一样：
 *   现实里的日程就该按现实的时间到点 ✓（这正是它和"沉浸式那份"的分工）
 * ⚠️ 关掉提醒的那条（`remind === false`）跳过 ✓
 * @returns {Array<{date:string, note:string, key:string, iso:string}>}
 */
export function realAlertsToday() {
    let now;
    try { now = new Date(); } catch { return []; }
    if (!now || !Number.isFinite(now.getTime())) return [];
    const today = deviceDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
    let done;
    try { done = new Set((settings().realAlerted || []).map(String)); } catch { done = new Set(); }
    const u = timeUnitNow();
    const out = [];
    for (const e of calEvSort(realEvents())) {
        if (!calEvFilled(e, u)) continue;
        if (!calEvRemindOn(e)) continue;
        const iso = String(e?.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
        if (iso > today) continue;                      // 还没到那天（字符串比较就是日期比较 ✓）
        const note = calEvLabel(e, u);
        if (!note) continue;
        const key = iso + '|' + note;
        if (done.has(key)) continue;
        const p = parseDeviceDate(iso);
        out.push({
            date: p ? (p.y + '年' + p.m + '月' + p.d + '日') : iso,   // 给人看的那种写法 ✓
            note,
            key,
            iso,
        });
    }
    return out;
}

/** 把现实那批记成"已经提示过了" ✓ */
export function markRealAlerted(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).map(String).filter(Boolean);
    if (!list.length) return 0;
    const s = settings();
    if (!Array.isArray(s.realAlerted)) s.realAlerted = [];
    let n = 0;
    for (const k of list) {
        if (!s.realAlerted.includes(k)) { s.realAlerted.push(k); n += 1; }
    }
    if (s.realAlerted.length > 400) s.realAlerted.splice(0, s.realAlerted.length - 400);
    if (n) save();
    return n;
}


// ---------------------------------------------------------------------------
// ★★ 「时间与日历」的导入导出（节日和年历也能导入导出，
//   方便把整理好的东西分享到其他设备或者其他人 ✓）
//
// 一份文件 = **这一页的全部设置**：
//   历法结构 ＋ 日期写法（都在 `calendar` 里）＋ 历法预设库 ＋ 节日表 ✓
// ⚠️ 导入是**合并**，不是覆盖：预设按 id、节日按 key，同名 / 同键才覆盖 ——
//   别人分享给你的东西不该把你自己的那堆冲掉 ✗
// ⚠️ 里面**不含任何聊天数据**（日程 / 红圈 / 提醒账本都不在 ✓）；
//   注意两份日程的归属不一样：**剧情那份按聊天存、现实那份在插件设置里**（都不在这个包里 ✓）
// ---------------------------------------------------------------------------

export const CAL_BUNDLE_KIND = 'bodycord-calendar';

/** 打包这一页的设置（纯数据，直接 `JSON.stringify` 就能存成文件 ✓） */
export function calendarBundle() {
    const s = settings();
    const presets = [];
    const bag = s.calendarPresets;
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
        for (const [id, p] of Object.entries(bag)) {
            if (!p || typeof p !== 'object') continue;
            presets.push({
                id: String(id),
                name: String(p.name || '').slice(0, 20),
                cal: normalizeCalendar(p.cal),
            });
        }
    }
    const hs = [];
    for (const x of (Array.isArray(s.calendarHolidays?.list) ? s.calendarHolidays.list : [])) {
        if (!holidayKeyOf(x)) continue;
        hs.push(JSON.parse(JSON.stringify(x)));
    }
    return {
        kind: CAL_BUNDLE_KIND,
        version: 1,
        at: Date.now(),
        calendar: normalizeCalendar(s.calendar),
        presets,
        holidays: hs,
    };
}

/** 认一下这是不是我们导出的那种文件（导入前先校验 ✓） */
export function looksLikeCalendarBundle(obj) {
    return !!(obj && typeof obj === 'object' && obj.kind === CAL_BUNDLE_KIND);
}

/**
 * 把一份包**并**进来。
 * @returns {{ok:boolean, error?:string, added?:number, overwrote?:number, skipped?:number, holidays?:number}}
 */
export function applyCalendarBundle(obj) {
    if (!looksLikeCalendarBundle(obj)) return { ok: false, error: '这个文件不是「时间与日历」的导出文件' };
    const s = settings();
    // ① 历法（结构 ＋ 写法）——⚠️ 直接写进设置就行：换历法要搬日期那件事是**懒搬家**
    //   （下次 `currentDate()` 会比指纹、自己搬一次 ✓），不用在这里手动调 store ✓
    if (obj.calendar) s.calendar = normalizeCalendar(obj.calendar);

    // ② 预设库：按 id 合并（同名 id 覆盖；新的一直加到 20 条为止 ✓）
    let added = 0, overwrote = 0, skipped = 0;
    if (!s.calendarPresets || typeof s.calendarPresets !== 'object' || Array.isArray(s.calendarPresets)) {
        s.calendarPresets = {};
    }
    if (Array.isArray(obj.presets)) {
        for (const p of obj.presets) {
            const id = String(p?.id || '').trim();
            if (!id) continue;
            const one = {
                name: (String(p?.name || '').trim() || '导入的历法').slice(0, 20),
                cal: normalizeCalendar(p?.cal),
                at: Date.now(),
            };
            if (s.calendarPresets[id]) { s.calendarPresets[id] = one; overwrote += 1; continue; }
            if (Object.keys(s.calendarPresets).length >= CAL_PRESET_MAX) { skipped += 1; continue; }
            s.calendarPresets[id] = one;
            added += 1;
        }
    }

    // ③ 节日表：按**同一套键**合并 ✓（`md` / `lunar:xx` / `nth:m:n:wd`）
    let hAdded = 0;
    if (Array.isArray(obj.holidays)) {
        s.calendarHolidays = (s.calendarHolidays && typeof s.calendarHolidays === 'object')
            ? s.calendarHolidays : { on: true, list: [] };
        if (!Array.isArray(s.calendarHolidays.list)) s.calendarHolidays.list = [];
        const list = s.calendarHolidays.list;
        for (const raw of obj.holidays) {
            if (!raw || typeof raw !== 'object') continue;
            const item = JSON.parse(JSON.stringify(raw));
            const k = holidayKeyOf(item);
            if (!k) continue;
            const i = list.findIndex((x) => holidayKeyOf(x) === k);
            if (i >= 0) { list[i] = item; continue; }
            if (list.length >= 60) continue;
            list.push(item);
            hAdded += 1;
        }
    }
    save();
    return { ok: true, added, overwrote, skipped, holidays: hAdded };
}
