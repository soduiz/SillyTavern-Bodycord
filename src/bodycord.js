/**
 * bodycord.js —— 把 Bodycord 美化面板装进悬浮球 / 聊天内嵌位
 *
 * 面板本体（assets/bodycord.html）原本挂在正则里，现在由插件直接装进来。
 * 插件只在装载时对「外壳」做调整，面板内部的解析器、样式、音乐、便签、
 * 占卜台一行都没动：
 *
 *   1. 把写死的 {{user}} 换成真实的用户人设名（原来是字面量，抓不到名字）
 *   2. 直接喂正确的人设头像（面板自己那套在没有用户发言时会抓错人）
 *   3. ★ 2026-10-14：收起那套（小胶囊 / 折叠按钮 / 那两条"藏掉它并强制展开"的规则）
 *      **已经从面板里整套删掉**了 ⇒ 外壳这边不再需要做这件事（面板本来就是展开的 ✓）
 *   4. 去掉面板自带的日夜切换按钮：全插件只留一个
 *   5. 去掉外层滚动：面板正好铺满容器
 *   6. 暴露刷新钩子，并支持「点一下数值就改」
 */

import { getChatKey, getCtx, resolvePersonaAvatar, EXT_ROOT, hasWindow } from './st.js';
// ★ 被排除的角色卡（口径见 src/cardexclude.js 顶上那段）——
//   这里只用它一处：日历要不要按现实日期显示 ✓
import { isCardExcluded } from './cardexclude.js';
import { renderDiceTab } from './ui-dice.js';
import { snapshotChat, applySnapshotChat, state, commit, hashText, userDisplayName, displayName, raceJudgeOf, findOrCreateLightTarget, inRealChat, inChatPage, conceptionForPanel, contactsForPanel, createTarget, diffForPanel, lastJudgeForPanel, achievementsForPanel, childrenForPanel, children, updateChild, bodyStateForPanel, chatNotes, setChatNotes, zoneNotes, setZoneNote, divHistory, setDivHistoryJSON, hasChatMeta, addCalendarEvent, updateCalendarEvent, deleteCalendarEvent, calendarDayCard, pruneEmptyCalendarEvents, markCalendarAlerted, activeCalendarNow, dueMarksForPanel } from './store.js';
// ★ 「联系人」里那颗「改种族」写的就是「角色基础信息」里那一格
//   ⇒ 复用参数面板那条写库路（它会顺手打上"玩家手改过"的标记 ✓）
import { specFor, writeParams } from './params.js';
import { formatFictionDate, parseFictionDate, activeCalendar } from './fiction-date.js';
import { settings, save, customIcons, globalNotes, setGlobalNotes, holidaysOn, setHolidaysOn, addRealEvent, updateRealEvent, deleteRealEvent, realEventDayCard, pruneEmptyRealEvents, markRealAlerted, setContactsHideDead } from './settings.js';
import { stagesForPanel } from './stages.js';
import { buildIconCss, ICON_STYLE_ID } from './icons.js';
import { saveNotesImage, deleteNotesImages } from './notes-image.js';
import { calendarViewHtml } from './ui-calendar.js';
import { deviceDateKey } from './calendar-events.js';
import { askText } from './dom.js';

const TEMPLATE_URL = new URL('../assets/bodycord.html', import.meta.url);

let _tpl = null;
let _lastNotesStats = null;   // 面板报上来的随手记计数（只报计数、不带内容 ✓，诊断报告用）
// ★ 日历现在翻到哪个月（面板那边不自己算日期 ⇒ **由外壳记着** ✓）
//   主面板的日历：翻月走 postMessage 回来重算 ✓
let _calYM = null;
// ★ 日历现在是哪一档视图（'default' 一个月一屏 / 'span' 跨月连着看）——
//   跟 `_calYM` 一个待遇：**状态放外壳**（HTML 是外壳拼的，它必须知道是哪档 ✓）
let _calMode = 'default';
// ★ 日历下半部分正在编辑的是**哪一天**（直接点击这个日期，
//   就在日历的下半部分编辑内容 ✓）—— 一个 `{y,m,d}`，跟上面两位一个待遇：状态放外壳 ✓
let _calSel = null;
// ★★ 现在这一屏日历是**哪一份日程**（非聊天也能存，就该能搞；
//   非聊天也可以记录东西，不能剥夺这个权利 ✓）——
//   true = 不在聊天里 ⇒ 读写的是**全局那份**（现实日历，按设备日期 `YYYY-MM-DD` ✓）
//   ⚠️ 用**拼这一屏时**记下的值来分流（不是再问一次 `inChatPage()`）：
//     面板上画着的就是那一份，写也得写到那一份去 ✓ 两边问两次迟早对不上 ✗
let _calReal = false;
// ★★ 上一屏日历是**哪个上下文**（`chatId|chat|real`）。
//   进聊天之后日历锚定在：非聊天那份上看的那个月/那一天，反过来也一样 ⇒
//   数据源换了、锚点还沿用 ✗ ⇒ 换上下文那一刻把 `_calYM / _calSel / _calMode` 清掉，
//   各自落回"今天那个月" ✓（换聊天同理：两个聊天也是两份不同的日历 ✓）
let _calCtx = '';
// ★★ 「联系人」每个人展开过几页（「乙：继续加载」）——
//   键是 `页签|名字`（`contacts|阿杰` / `impregnations|阿杰`，两个视角各算各的 ✓）。
//   为什么记账放外壳：跨 iframe 一次只推一页 20 条（payload 不能随记录无限涨），
//   面板点「还有 N 条更早的」时回外壳说一声、外壳把这一页加上再重推 ✓
//   ⚠️ 换了"正在看的那个对象"就整份作废（不然会串到别人身上 ✗）
let _ctMore = Object.create(null);
let _ctSubject = null;

/** 那天 → **这一天的剧情日期串**（写法跟着当前写法走 ✓） */
function _calDateOf(parts) {
    const p = parts || {};
    const y = Math.max(1, Math.floor(Number(p.y) || 1));
    const m = Math.max(1, Math.floor(Number(p.m) || 1));
    const d = Math.max(1, Math.floor(Number(p.d) || 1));
    try { return formatFictionDate({ y, m, d }, activeCalendarNow()); } catch { return ''; }
}

/** 现在选中的那天（讲给 store 听的那个串 ✓；没选/拼不出来就给空串 ✓） */
function _calSelDate() {
    return _calSel ? _calDateOf(_calSel) : '';
}

/**
 * "正在编辑的那一天"该用哪个**键**给 store 的清理函数（空壳子不碰它 ✓）
 * ⚠️ 两份日程的日期格式不一样：聊天那份是**按当前写法渲染的串**、
 *   现实那份是**真实公历 `YYYY-MM-DD`** ⇒ 分流不能弄混 ✗
 */
function _calKeepKey() {
    if (!_calSel) return '';
    if (_calReal) return deviceDateKey(_calSel.y, _calSel.m, _calSel.d);
    return _calSelDate();
}

/** 随手记的统计（数据在面板侧；面板每次变动会 post 一份上来）*/
export function notesStats() {
    return _lastNotesStats;
}

export async function loadTemplate() {
    if (_tpl) return _tpl;
    // ⚠️⚠️ `cache: 'no-store'`：面板本体是**另一个 URL**（assets/bodycord.html），
    //   浏览器会单独缓存它 —— 于是会出现「外层 JS 是新的（设置页能看到新页签）、
    //   面板还是旧的（新频道压根不存在）」，而且**不报错**，看着就像"没刷新" ✗。
    //   撞上这条的现象就是预览里找不到成就频道 ⇒ 干脆别吃缓存 ✓
    const res = await fetch(TEMPLATE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('读取面板模板失败：HTTP ' + res.status);
    _tpl = await res.text();
    return _tpl;
}

function jsLiteral(obj) {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// 人设头像：喂给面板，并且判断用户有没有手动换过
// ---------------------------------------------------------------------------

/**
 * 面板启动时会读 localStorage 的 bc_custom_avatar；
 * 一旦有值，它就完全不扫描了（startAvatar 的分支）。
 * 所以这里：
 *   - 用户自己换过（值 ≠ 我们上次自动填的）→ 尊重用户，不动
 *   - 否则 → 填我们算出来的正确头像
 */
/**
 * 头像抓取算法的版本。
 *
 * 每次改了抓取逻辑就 +1 —— 这样**所有老用户的错缓存会被强制重算一次**。
 * 为什么需要它：光靠「缓存 ≠ 上次自动填的值」判断不出缓存是错的 ——
 * 用户机器上的实测：那对值一个相对一个绝对，永远不等，于是被当成「用户手动换过」而永久锁死。
 */
const AVATAR_ALGO_VERSION = 3;

/**
 * 头像 / 签名 / 在线状态的**作用域**（2026-10-18）。
 *
 * 非聊天一份，每个聊天各自一份。
 * ⚠️ 不能用 `rawChatId()` 当作用域 —— 它拿不到 chatId 时会退回 `getChatKey()`，
 *   而那个函数还能按**旧的** chatMetadata / 角色算出同一个 key
 *   ⇒ 非聊天和上一个聊天共用一格存储（非聊天用了上个聊天的头像就是它）✗
 * ⇒ 判据只认**当前真的有 chatId**：有 ⇒ 这个聊天；没有 ⇒ 固定哨兵 `nochat` ✓
 */
export function avatarScopeId() {
    try {
        const c = getCtx();
        if (!c || !c.chatId) return 'nochat';
        return String(c.chatId);
    } catch { return 'nochat'; }
}

/** 清掉当前作用域的「自动头像」缓存（绝不动玩家上传的 bc_custom_avatar ✗） */
function clearPanelAutoCache() {
    try {
        const id = avatarScopeId();
        window.localStorage.removeItem(`bc_chat__${id}__bc_auto_avatar`);
        window.localStorage.removeItem('bc_auto_avatar');
    } catch { /* 忽略 */ }
}

export function pickAvatarForPanel() {
    const s = settings();

    // 算法升级过 → 认定老缓存不可信
    if (s.ui.avatarAlgo !== AVATAR_ALGO_VERSION) {
        s.ui.avatarAlgo = AVATAR_ALGO_VERSION;
        s.ui.lastAutoAvatar = '';
        clearPanelAutoCache();
        save();
    }

    // 每次都真解析一次。
    //
    // ⚠️ 这里原来有两层坑，都拆掉了：
    //   ① 有个 `userSet` 早退：把「localStorage 里的值 ≠ 上次自动填的值」
    //   当成「用户手动换过」→ 直接返回缓存、不重算。
    //   但它判不出「缓存是错的」——实测那对值一个相对一个绝对，永远不等，
    //   于是错值被永久锁死；换人设也再不会跟。
    //   而且父窗口这个 key 本来就**只有插件自己写**，所以这个判断从来就没有
    //   真正的「用户手选」可保护 —— 拆掉反而没有副作用。
    //   ② 曾经靠「比对归一化后的地址」来判断用户换没换过（相对 vs 绝对不等），
    //   但那治不了根 —— 现在一律真解析，压根不需要比。
    const fresh = resolvePersonaAvatar();
    if (fresh) {
        // ★ 性能优化第一刀：**只在真的变了的时候才写设置** ✓
        //   为什么：`syncPresentation()` 每 1.2 秒心跳都会调到 `refreshAvatar()`
        //   （在 ui.js 里，那里明确写了"每次心跳都刷"），而这里原来**无条件 save()** ⇒
        //   插件开着的时候等于每秒把 extension_settings 写一遍，
        //   内容还往往一个字没变（同一个头像解析出来的还是同一个地址）✗
        //   ⚠️ 别顺手把上面那句 resolvePersonaAvatar() 也省掉 —— 注释里写过为什么：
        //     "人设指纹变了才刷"那套判不出来（两个人设可能同名）✗ 这里只省**写盘** ✓
        if (s.ui.lastAutoAvatar !== fresh) {
            s.ui.lastAutoAvatar = fresh;
            save();
        }
        return fresh;
    }

    // 抓不到就返回空 —— 绝不把旧值顶上去（旧值可能是以前的兜底乱抓的）
    return '';
}

/** 强制重抓：清掉所有缓存，下次 pickAvatarForPanel 一定重新解析 */
export function forceReResolveAvatar() {
    const s = settings();
    s.ui.lastAutoAvatar = '';
    s.ui.avatarAlgo = AVATAR_ALGO_VERSION;
    clearPanelAutoCache();
    save();
    return resolvePersonaAvatar();
}

// ---------------------------------------------------------------------------
// iframe 内容
// ---------------------------------------------------------------------------

/** 面板自带的那个小胶囊 / 主题按钮，还有外层滚动，全部关掉 */
// ⚠️ 2026-10-14：那枚「收起成小胶囊」(`.mini-server` / `#miniServer`) 和里面的折叠按钮
//   (`#btnFold`) 已经**从面板里整套删掉**了 ⇒ 这里原先那三条"藏掉它 + 强制展开"的规则
//   也一起删（面板现在本来就是展开的，没有要藏的东西 ✓）。
//   当初它们在这里的真正毛病：这整段是注入在**文档末尾**的，而面板的初始标记是"收起" ⇒
//   浏览器会先把小胶囊画一帧、样式到了再纠正 ⇒ 玩家看到：闪一下 ✗
const SHELL_CSS = `
html,body{height:100%!important;padding:0!important;margin:0!important;overflow:hidden!important}
body{display:block!important}
.bc-shell{height:100%!important;max-width:none!important;padding:0!important}
.bc-app{height:100%!important;border-radius:0!important;border:0!important}
#btnTheme{display:none!important}
/* 滚动条统一成细条并跟随主题（夜模式下不再冒出一条突兀的亮条） */
*{scrollbar-width:thin;scrollbar-color:var(--scroll-thumb,rgba(0,0,0,.2)) transparent}
*::-webkit-scrollbar{width:8px;height:8px}
*::-webkit-scrollbar-track,*::-webkit-scrollbar-corner{background:transparent}
*::-webkit-scrollbar-thumb{background:var(--scroll-thumb,rgba(0,0,0,.2));border-radius:4px}
*::-webkit-scrollbar-thumb:hover{background:var(--scroll-thumb-hover,rgba(0,0,0,.32))}
/* 这几块本来就只该纵向滚，横向直接掐掉 */
.channel-list,.message-scroll,.view-panel,.bc-app{overflow-x:hidden!important}
`;

// 注意最后一个入参 inChatPage 会遮蔽同名的导入函数 —— 这个函数体里不调用它，是故意的
function buildShim({ raw, chat, chatId, avatarScope = 'nochat', userName, theme, avatar, inChat, inChatPage = false, iconCss, conception = null, judgeLog = null, contacts = null, achievements = null, stages = null, children = null, calendar = null, bodyState = null, vision = 'normal', shellLs = {} }) {
    return `<script>
(function(){
 try{
  var RAW = ${jsLiteral(String(raw || ''))};
  var CHAT = ${jsLiteral(chat || [])};
  var CHATID = ${jsLiteral(String(chatId || 'global'))};
  // ★ 头像 / 签名 / 在线状态的作用域（非聊天固定 nochat，聊天里＝chatId）——
  //   ⚠️ 它和 CHATID 是两回事：CHATID 还要给面板的 SillyTavern.getContext 用 ✓
  var AVATAR_SCOPE = ${jsLiteral(String(avatarScope || 'nochat'))};
  var THEME = ${jsLiteral(String(theme || 'light'))};
  var VISION = ${jsLiteral(String(vision || 'normal'))};   // 易读模式（normal / large）
  var IN_CHAT = ${inChat ? 'true' : 'false'};
  var IN_CHAT_PAGE = ${inChatPage ? 'true' : 'false'};   // 就在某个聊天页里（哪怕还没有正文）
  var CONCEPTION = ${jsLiteral(conception)};
  var JUDGELOG = ${jsLiteral(judgeLog)};
  var CONTACTS = ${jsLiteral(contacts)};   // 「联系人」视图的数据（只读 ✓）
  var ACHIEVEMENTS = ${jsLiteral(achievements)};   // 「成就」频道的数据（按聊天，只读 ✓）
  var STAGES = ${jsLiteral(stages)};   // 阶段插图（面板「透视」频道那一页：一组图 ＋ 一个状态键 ✓）
  var CHILDREN = ${jsLiteral(children)};   // 「孩子」频道（出生后的记录，按对象过滤 ✓）
  var CALENDAR = ${jsLiteral(calendar)};   // 「日历」频道（外壳算好的整页 HTML ✓）
  var BODYSTATE = ${jsLiteral(bodyState)};   // 「身体状态」频道（三条状态描述 ＋ 插件算的痕迹读数 ✓）

  /* ── 让「头像 / 个性签名 / 在线状态」跟着聊天走 ──────────────────
     面板是把这三样直接写进 localStorage 的（bc_custom_avatar / bc_user_sign /
     bc_user_status），换聊天时当然就串了。
     这里在面板脚本跑起来**之前**把 localStorage 换成一个代理：
     这三个 key 会自动加上当前聊天的前缀，其它 key 原样透传。
     面板一行代码都不用改，也不用知道 key 在哪。 */
  var SCOPED = /^bc_(custom_avatar|auto_avatar|user_sign|user_status)$/;
  // ⚠️ srcdoc iframe 里访问 window.localStorage 有可能**直接抛 SecurityError**
  //   （opaque origin / 存储被分区或禁用）。这一行原来没有保护，
  //   一旦抛错就会把整个 shim 掐死在开头 —— 后面 window.SillyTavern、
  //   applyRaw()、__bodycordSetTheme 全部不会定义，表现就是
  //   「面板永远是默认值 + 主题推不进去 + 骰子挂不上」。
  //   所以：拿不到就退回一个内存版，绝不让它把整体拖死。
  var REAL_LS;
  try {
    REAL_LS = window.localStorage;
    if (!REAL_LS) throw new Error('localStorage 不可用');
  } catch(e) {
    try { console.warn('[Bodycord] localStorage 不可用，退回内存存储：' + e); } catch(_){}
    var _memStore = {};
    var _memKeys = [];
    REAL_LS = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(_memStore, k) ? _memStore[k] : null; },
      setItem: function(k, v){ if (_memKeys.indexOf(k) < 0) _memKeys.push(k); _memStore[k] = String(v); },
      removeItem: function(k){ delete _memStore[k]; var i = _memKeys.indexOf(k); if (i >= 0) _memKeys.splice(i, 1); },
      clear: function(){ _memStore = {}; _memKeys = []; },
      key: function(i){ return _memKeys[i] == null ? null : _memKeys[i]; },
      get length(){ return _memKeys.length; }
    };
  }
  // 注意用函数：切聊天 / 进出聊天时 AVATAR_SCOPE 会变（面板不重建 iframe），前缀必须跟着变
  function prefix(){ return 'bc_chat__' + AVATAR_SCOPE + '__'; }
  function scopeKey(k){
    return SCOPED.test(String(k)) ? prefix() + k : String(k);
  }
  function scopedNameIn(key){
    var p = prefix();
    return key.indexOf(p) === 0 ? key.slice(p.length) : null;
  }
  /* ★ 面板自带的那几样（随手记 / 敏感带备注 / 占卜台历史）现在**同时**要落进插件数据
     （它们原来只活在浏览器里 ⇒ 清浏览器数据就全没 ✗）
     ⇒ 写的时候顺手发一份给外壳，外壳写进聊天数据 / 全局设置 ✓
     面板那边一行都不用改 —— 它还是在写自己的 localStorage（走上面那个代理）✓
     ⚠️ 这个正则跟外壳那四个键常量一一对应（改一处要改两处 ✗） */
  var BRIDGED_KEY = /^(bc_notes_global|bc_notes_chat_|bc_zone_note_|bc_div_history)/;
  /* ★★ 2026-10-15：「状态笔记 · 刚刚更新」那两把钥匙（时间戳 / 上次内容）**归外壳管** ——
     它们原来存在面板 iframe 自己的 localStorage 里，而那个存储在有些环境下**直接不可用**
     （见上面那段：会静默退回内存版）⇒ 反馈里「重进之后还显示刚刚更新」就是它 ✗
     ⇒ 这两把钥匙改成：**读**用外壳随文档带下来的 SHELL_LS（正本在聊天数据里 ✓），
       **写**转发给外壳落盘 ⇒ 面板那边一行都不用改（它照旧读写 localStorage ✓）
     ⚠️ 这段注释里**不许出现反引号** —— 整段 shim 是一个模板字符串，反引号会把它截断 ✗ */
  var SHELL_KEYS = /^bc_(last_update|last_raw)_/;
  var SHELL_LS = ${jsLiteral(shellLs || {})};
  function shellKeyOut(k, v){
    try{
      window.parent.postMessage({
        __bodycord: true, type: 'panelNoteWrite', key: String(k),
        value: String(v == null ? '' : v)
      }, '*');
    }catch(e){}
  }
  function bridgeOut(k, v){
    try{
      var key = String(k == null ? '' : k);
      if(!BRIDGED_KEY.test(key)) return;
      window.parent.postMessage({
        __bodycord: true, type: 'panelNoteWrite', key: key,
        value: String(v == null ? '' : v)
      }, '*');
    }catch(e){}
  }
  var LS_PROXY = {
    getItem: function(k){
      // ★ 那两把「更新时间」钥匙走外壳带下来的那份（正本在聊天数据里 ✓）
      var sk = String(k);
      if (SHELL_KEYS.test(sk)) return Object.prototype.hasOwnProperty.call(SHELL_LS, sk) ? SHELL_LS[sk] : null;
      try { return REAL_LS.getItem(scopeKey(k)); } catch(e){ return null; }
    },
    setItem: function(k, v){
      var sk = String(k);
      if (SHELL_KEYS.test(sk)) { SHELL_LS[sk] = String(v == null ? '' : v); shellKeyOut(sk, v); return; }
      try { REAL_LS.setItem(scopeKey(k), v); } catch(e){} bridgeOut(k, v);
    },
    removeItem: function(k){
      var sk = String(k);
      if (SHELL_KEYS.test(sk)) { delete SHELL_LS[sk]; shellKeyOut(sk, ''); return; }
      try { REAL_LS.removeItem(scopeKey(k)); } catch(e){} bridgeOut(k, '');
    },
    // clear 只清「当前聊天这一份」，绝不能把整个酒馆的 localStorage 抹了
    clear: function(){
      try {
        var p = prefix(), kill = [];
        for (var i = 0; i < REAL_LS.length; i++){
          var key = REAL_LS.key(i);
          if (key && key.indexOf(p) === 0) kill.push(key);
        }
        for (var j = 0; j < kill.length; j++) REAL_LS.removeItem(kill[j]);
      } catch(e){}
    },
    key: function(i){
      try {
        var out = [], n = REAL_LS.length;
        for (var j = 0; j < n; j++){
          var k = REAL_LS.key(j);
          if (!k) continue;
          var bare = scopedNameIn(k);
          if (bare != null) out.push(bare);
          else if (!SCOPED.test(k)) out.push(k);
        }
        return out[i] == null ? null : out[i];
      } catch(e){ return null; }
    },
    get length(){
      try {
        var n = 0;
        for (var i = 0; i < REAL_LS.length; i++){
          var k = REAL_LS.key(i);
          if (!k) continue;
          if (scopedNameIn(k) != null || !SCOPED.test(k)) n++;
        }
        return n;
      } catch(e){ return 0; }
    }
  };
  try {
    Object.defineProperty(window, 'localStorage', {
      value: LS_PROXY, configurable: true, writable: false
    });
  } catch(e){ /* 定义不了就算了，退回原来的行为 */ }

  /* 面板启动前先写好它自己的开关：
     theme = 跟随插件的日夜模式（全插件只有一个按钮）
     auto_avatar = 自动解析出来的人设头像（按当前作用域存，只当"启动时就有的那张"，
                   免得面板先闪一下默认图标）；**玩家上传的图走 bc_custom_avatar**，
                   两者分开，重置才不会被自动值顶掉 ✓
     ⚠️ 2026-10-14：原来还写一个 bc_open = 1（强制展开），那套收起 / 展开整个删了 ⇒ 不再写 ✓ */
  try{
    localStorage.setItem('bc_theme', THEME);
    ${
        avatar
            ? `if (!localStorage.getItem('bc_auto_avatar')) localStorage.setItem('bc_auto_avatar', ${jsLiteral(String(avatar))});`
            : ''
    }
  }catch(e){}

  function applyRaw(){
    var el = document.getElementById('time-capsule');
    if (el) el.value = RAW;
  }
  applyRaw();

  window.SillyTavern = {
    getContext: function(){ return { chatId: CHATID, chat: CHAT, name2: '' }; },
    chat: CHAT,
    saveChat: function(){
      try { window.parent.postMessage({ __bodycord: true, type: 'save', chat: CHAT }, '*'); } catch(e){}
      return Promise.resolve();
    }
  };

  /* ★ 性能优化第一刀：数据一个字没变就**别重画** ✓
     外壳每次 refreshAll（推演完 / 改设置 / 切页 / 改补丁）都会调到这里，
     而 window.__bodycordSetRaw → render() 会把**当前频道整屏重建一遍** ——
     数据没变时那一遍是白做的（实测：一次全量重画要重建上千个元素 ✗）。
     ⚠️ 判据有三样，缺一个都会出真 bug：
        ① 面板文字（raw）没变 ✓
        ② 聊天 key 没变 —— 换聊天时面板文字可能一模一样（新聊天还没推演过），
           但随手记那份要跟着聊天 key 走 ⇒ 换 key 必须重画 ✓
        ③ **那份历史（CHAT）没变** —— 「推演记录 / 时光机」是从它渲染的，
           条数一样而内容变了（时光机里改一条正文 / 导入档案）不认就会显示旧数据 ✗
     ⚠️ 各频道的其它数据（受孕记录 / 联系人 / 推演记录 / 成就 / 孩子 / 阶段插图）
        走的是 __bodycordSet*，它们各自按"正停在这一页才重画"处理，不受这里影响 ✓ */
  var _lastPushedRaw = null, _lastPushedKey = '';
  /* 两份历史一样不一样 —— 只比**面板真会读到的字段**（正文 + 楼层信息）✓
     （面板读楼层用的是 msg.mes；_bcKey/_bcIndex/_bcFloor 是它显示楼层信息的来源） */
  function chatIsSame(nextChat){
    if(!Array.isArray(nextChat)) return true;      // 外壳这次没带历史 ⇒ 当没变
    if(nextChat.length !== CHAT.length) return false;
    for(var i = 0; i < nextChat.length; i++){
      var a = nextChat[i] || {}, b = CHAT[i] || {};
      if(String(a.mes == null ? '' : a.mes) !== String(b.mes == null ? '' : b.mes)) return false;
      if(a._bcKey !== b._bcKey || a._bcIndex !== b._bcIndex || a._bcFloor !== b._bcFloor) return false;
    }
    return true;
  }
  window.__bodycordUpdate = function(nextRaw, nextChat, nextKey, nextUpdateTs){
    var nextRawStr = String(nextRaw == null ? '' : nextRaw);
    var nextKeyStr = nextKey ? String(nextKey) : _lastPushedKey;
    var same = (nextRawStr === _lastPushedRaw && nextKeyStr === _lastPushedKey) && chatIsSame(nextChat);
    RAW = nextRawStr;
    applyRaw();
    // ★ 2026-10-15：面板那颗「刚刚更新」的时间戳**由外壳给**（＝该对象上次推演的时间 ✓）——
    //   必须排在下面那句 same 就 return 的**前面**：推演完可能文字一个字没变、
    //   但时间戳要往前走 ✓（面板那边的 markUpdated 已经被"外壳给了值就不再自己盖"锁住了 ✓）
    //   ⚠️ 这段注释里不许出现反引号 —— 整段 shim 是一个模板字符串，反引号会把它截断 ✗
    if (nextUpdateTs != null) {
      try {
        if (typeof window.__bodycordSetUpdateTs === 'function') window.__bodycordSetUpdateTs(Number(nextUpdateTs) || 0);
      } catch(e){}
    }
    if (Array.isArray(nextChat)){ CHAT.length = 0; for (var i=0;i<nextChat.length;i++) CHAT.push(nextChat[i]); }
    if (nextKey) CHATID = nextKeyStr;
    _lastPushedRaw = nextRawStr; _lastPushedKey = nextKeyStr;
    if (same) return;
    if (typeof window.__bodycordSetRaw === 'function') window.__bodycordSetRaw(RAW);
  };

  /* 受孕记录：插件那边更新后推过来，面板重画那个频道 */
  window.__bodycordSetConception = function(next){
    CONCEPTION = next || null;
    if (typeof window.__bodycordConceptionChanged === 'function') {
      try { window.__bodycordConceptionChanged(); } catch(e){}
    }
  };
  window.__bodycordGetConception = function(){ return CONCEPTION; };

  window.__bodycordGetJudgeLog = function(){ return JUDGELOG; };
  window.__bodycordSetJudgeLog = function(next){
    JUDGELOG = next || null;
    if (typeof window.__bodycordJudgeLogChanged === 'function') { try { window.__bodycordJudgeLogChanged(); } catch(e){} }
  };
  /* 联系人视图：跟受孕记录同一套路子（外壳推过来 → 面板重画那一页 ✓） */
  window.__bodycordGetContacts = function(){ return CONTACTS; };
  window.__bodycordSetContacts = function(next){
    CONTACTS = next || null;
    if (typeof window.__bodycordContactsChanged === 'function') { try { window.__bodycordContactsChanged(); } catch(e){} }
  };
  /* 成就：同上（成就是按聊天的 ⇒ 换聊天时外壳推过来的那份自然就换了 ✓） */
  window.__bodycordGetAchievements = function(){ return ACHIEVEMENTS; };
  window.__bodycordSetAchievements = function(next){
    ACHIEVEMENTS = next || null;
    if (typeof window.__bodycordAchievementsChanged === 'function') { try { window.__bodycordAchievementsChanged(); } catch(e){} }
  };

  /* 阶段插图：跟受孕记录同一套路子 ——
     外壳算好"这一刻该画哪张"推过来，面板只负责画 ✓
     （面板自己看不见精子存活 / 受精判定 / 着床这些数据 ⇒ 推导必须在外面做 ✓） */
  window.__bodycordGetStages = function(){ return STAGES; };
  window.__bodycordSetStages = function(next){
    STAGES = next || null;
    if (typeof window.__bodycordStagesChanged === 'function') { try { window.__bodycordStagesChanged(); } catch(e){} }
  };

  /* 「孩子」频道：跟成就同一套路子 ✓ */
  window.__bodycordGetChildren = function(){ return CHILDREN; };
  window.__bodycordSetChildren = function(next){
    CHILDREN = next || null;
    if (typeof window.__bodycordChildrenChanged === 'function') { try { window.__bodycordChildrenChanged(); } catch(e){} }
  };

  /* 「日历」频道：外壳把整页 HTML 算好推过来 ✓ */
  window.__bodycordGetCalendar = function(){ return CALENDAR; };
  window.__bodycordSetCalendar = function(next){
    CALENDAR = next || null;
    if (typeof window.__bodycordCalendarChanged === 'function') { try { window.__bodycordCalendarChanged(); } catch(e){} }
  };

  /* 「身体状态」频道：三条状态描述本来就在面板文字里，只有痕迹那份是插件算的 ⇒
     单独推一份过来（跟着"当前正在查看的那个对象"变 ✓） */
  window.__bodycordGetBodyState = function(){ return BODYSTATE; };
  // ★ 2026-10-26：面板「身体状态」页读的是面板文字原文（不走上面那份）——
  //   正常游玩原样显示日期；从别的档导入的对象**整段不显示日期** ✓
  window.__bodycordRelDate = function(text){
    try {
      const t = state().targets?.[state().active];
      if (t && t.imported === true) return stripDateText(text);
      return text;
    } catch(e){ return text; }
  };
  window.__bodycordSetBodyState = function(next){
    BODYSTATE = next || null;
    if (typeof window.__bodycordBodyChanged === 'function') { try { window.__bodycordBodyChanged(); } catch(e){} }
  };

  // ⚠️ 光写 localStorage 不够：面板的 initState() 可能在 shim 之前就跑了
  //   （shim 是插在面板主脚本后面的），它读到的会是上一次的旧值 ——
  //   现象就是「外壳换了色、里面还是旧的」。
  //   所以 shim 自己也把 data-theme 定死，并在文档就绪后再补一次。
  function applyThemeEverywhere(){
    try{ document.documentElement.setAttribute('data-theme', THEME); }catch(e){}
  try{ document.documentElement.setAttribute('data-vision', VISION); }catch(e){}
  }
  applyThemeEverywhere();
  try{
    document.addEventListener('DOMContentLoaded', applyThemeEverywhere);
    window.addEventListener('load', applyThemeEverywhere);
    setTimeout(applyThemeEverywhere, 0);
  }catch(e){}

  // 易读模式：外壳改完设置推一下（照 __bodycordSetTheme 写 ✓）
  window.__bodycordSetVision = function(v){
    try{
      VISION = String(v || 'normal');
      if (VISION !== 'large') VISION = 'normal';
      document.documentElement.setAttribute('data-vision', VISION);
    }catch(e){}
  };

  window.__bodycordSetTheme = function(t){
    THEME = String(t || 'light');
    applyThemeEverywhere();
    try{ localStorage.setItem('bc_theme', THEME); }catch(e){}
  };

  /* ── 没进聊天的时候，别让「XX 秒前更新」那玩意儿跑起来 ──────────
     它是面板自己按 bc_last_update_<聊天key> 记的时间戳（写在 localStorage，
     是持久的，不是一次性的），然后每 30 秒刷新一次文字。
     非聊天页面根本没有状态可更新，让它显示/计时只会误导，所以直接藏掉。

     ⚠️ 这个类名千万别叫 bc-nochat，style.css 里曾经有一个同名的布局类
     （display:flex + align-items:center + justify-content:center），
     而骰子那块的样式表会被注入进这个 iframe，于是它把**整个文档**居中了。
     症状极有迷惑性：只有非聊天页面排版错乱。所以这里用 bc-outside-chat。 */
  try{
    var st = document.createElement('style');
    st.textContent = [
      'html.bc-outside-chat .last-update{display:none!important}',
      // 工具类页面的消息块不再有悬停高亮 —— 它们是「工具」不是「对话」，
      // 鼠标扫过时整块变色反而干扰。状态笔记 / 置顶那些保留。
      '.msg-block:has(.block-avatar.notes):hover,',
      '.msg-block:has(.block-avatar.astro):hover,',
      '.msg-block:has(.block-avatar.music):hover,',
      // ★ 敏感带的悬停高亮为什么收掉：这个界面只有这一个大类
      //   ⇒ 判据同上（悬停高亮是给"能点的消息块"的提示）：敏感带那一页**只有一个大块**，
      //     划上去整块变灰纯干扰 ⇒ 一起收掉 ✓（别的页的块照旧保留 ✓）
      '.msg-block:has(.block-avatar.zone):hover{background:transparent}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
  function applyChatChrome(){
    try{ document.documentElement.classList.toggle('bc-outside-chat', !IN_CHAT); }catch(e){}
  }
  applyChatChrome();
  window.__bodycordSetInChat = function(f){ IN_CHAT = !!f; applyChatChrome(); };

  /* ── 「在不在某个聊天页」是另一回事（别和上面那个混） ─────────────
     IN_CHAT      = 在一个已经有正文的聊天里（有状态可更新）
     IN_CHAT_PAGE = 就在某个聊天页里，哪怕还没写正文
     随手记要按聊天分账，用的是后者 —— 用前者的话，刚开的新聊天会被
     当成「非聊天页面」，随手记就显示成全局那份 ✗
     （症状：在聊天内显示的却是全局那一份） */
  function applyNotesChrome(){
    try{ document.documentElement.classList.toggle('bc-notes-outside-chat', !IN_CHAT_PAGE); }catch(e){}
  }
  applyNotesChrome();
  window.__bodycordSetInChatPage = function(f){
    var next = !!f;
    // 值没变就别惊动面板（心跳每次都会推，白重画没意义）
    if (next === IN_CHAT_PAGE) return;
    IN_CHAT_PAGE = next;
    applyNotesChrome();
    // ⚠️ 光切类名不够：随手记「读哪一份」在标志变化**之前**就已经读过一次了 ⇒
    //   必须让面板重新读一遍，否则进聊天那一刻列表还停在全局那份 ✗
    //   （症状：点进去聊天之后还是显示全局那一份）
    try{ if (typeof window.__bodycordNotesChatPageChanged === 'function') window.__bodycordNotesChatPageChanged(); }catch(e){}
  };
  window.__bodycordInChatPage = function(){ return !!IN_CHAT_PAGE; };

  /* ── 头像 / 签名 / 在线状态的作用域切换 ───────────────────────
     外壳每次推数据前先喊这个（值没变就是空操作）。
     变了就让面板重读"这个作用域自己的"三样东西 ——
     面板不重建 iframe，不重读就会一直显示上一个聊天 / 非聊天时读到的那份 ✗ */
  window.__bodycordSetAvatarScope = function(s){
    var next = String(s || 'nochat');
    if (next === AVATAR_SCOPE) return;
    AVATAR_SCOPE = next;
    try{ if (typeof window.__bodycordReloadScopedAvatar === 'function') window.__bodycordReloadScopedAvatar(); }catch(e){}
  };


  /* ── 自定义图标 ───────────────────────────────────────────────
     不再**在这里拼 CSS** —— 那段逻辑搬去 src/icons.js 用真正的 JS 写了。
     原因：模板字符串里的注释不能有反引号、换行要写成 fromCharCode、反斜杠要穿三层转义，
     这些坑都踩过四次。现在这里只负责把算好的 CSS 塞进 <style>。 */
  var ICON_CSS = ${jsLiteral(iconCss || '')};
  var ICON_APPLIED = null;   // ★ 上一次**真正写进 <style>** 的那一份（用来跳过重复写入 ✓）

  function applyIcons(css){
    try{
      var next = String(css == null ? ICON_CSS : css);
      // ★★ 手机用户可能会卡，所以量了一遍：
      //   外壳每次刷新都会把这份 CSS 整段推过来（里面可能含自定义头像的 **data URL**，几十上百 KB ✗）
      //   而把同一段字符串再写回 textContent，会让浏览器**重新解析一遍样式** ✗
      //   （⚠️ 这段代码住在模板串里 ⇒ 注释里**绝不能出现反引号** —— 我刚又踩了一次 ✗）
      //   ⇒ 内容没变就一个字都别写 ✓（字符串比较是 O(n)，比重新解析便宜得多 ✓）
      if (ICON_APPLIED === next){ var e0 = document.getElementById(${jsLiteral(ICON_STYLE_ID)}); if (e0) return; }
      var el = document.getElementById(${jsLiteral(ICON_STYLE_ID)});
      if (!el){
        el = document.createElement('style');
        el.id = ${jsLiteral(ICON_STYLE_ID)};
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = next;
      ICON_APPLIED = next;
    }catch(e){}
  }
  applyIcons();
  window.__bodycordSetIcons = function(css){
    ICON_CSS = String(css || '');
    applyIcons();
  };

  window.__bodycordSetAvatar = function(url){
    try{
      if (!url) return;
      // ★ 自动头像只写 auto 键（玩家上传的那张是 custom 键，绝不能覆盖 ✗）
      localStorage.setItem('bc_auto_avatar', url);
      var el = document.getElementById('userPanelAvatar');
      if (!el) return;
      var old = el.querySelector('img.dc-avatar-img');
      if (old) old.remove();
      var img = document.createElement('img');
      img.className = 'dc-avatar-img';
      img.alt = '';
      img.src = url;
      el.insertBefore(img, el.firstChild);
    }catch(e){}
  };
 }catch(_bcShimErr){
  // 到了这一步说明 shim 挂了 —— 绝不能静默。既写进控制台，也显示在面板上。
  try{ console.error('[Bodycord] shim 初始化失败（插件功能会大面积失效）：', _bcShimErr); }catch(_){}
  try{
    var _b = document.createElement('div');
    _b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:999999;background:#a3262b;color:#fff;'
      + 'font:12.5px/1.7 monospace;padding:8px 12px;white-space:pre-wrap';
    _b.textContent = '⚠️ Bodycord shim 初始化失败：' + (_bcShimErr && _bcShimErr.message ? _bcShimErr.message : _bcShimErr)
      + String.fromCharCode(10) + '请把这一行发给开发者';
    (document.body || document.documentElement).appendChild(_b);
  }catch(_){}
 }
})();
</script>
<style>${SHELL_CSS}</style>`;
}

export function buildDoc(tpl, { raw, chat, chatId, avatarScope = 'nochat', userName, theme, vision = 'normal', avatar = '', inChat = false, inChatPage = false, iconCss = '', conception = null, judgeLog = null, contacts = null, achievements = null, stages = null, children = null, calendar = null, bodyState = null, panelShellLs = null }) {
    let doc = tpl;

    // 面板里那个 JS 兜底字符串先清掉，免得用户名里的引号把脚本搞坏
    doc = doc.replace("|| '{{user}}'", "|| ''");
    // 左下角与编辑栏的名字：面板原本写死成字面量 {{user}}，所以永远抓不到名字
    // ⚠️ 必须用**函数式替换**：把名字当替换串的话，名字里含 `$&` / `$'` / 反引号美元符时
    //   会被 String.replace 当成替换模式展开（`$'` 甚至会把后面整份模板复制一份进来，
    //   注入进 iframe 的文档被悄悄改坏、不报错 ✗）
    doc = doc.replace(/\{\{user\}\}/g, () => escHtml(userName));

    return doc
        .replace('{{BODYCORD_RAW}}', '')
        .replace('<!--BODYCORD_SHIM-->',
            // ⚠️ vision 必须放在对象里 ✓（放外面会变成 replace 的第三个参数、被忽略 ⇒ 静默失效 ✗）
            buildShim({ raw, chat, chatId, avatarScope, userName, theme, vision, avatar, inChat, inChatPage, iconCss, conception, judgeLog, contacts, achievements, stages, children, calendar, bodyState, shellLs: panelShellLs || {} }));
}

// style.css 的文本（只取一次，之后走缓存）
let _cssPromise = null;
function extCss() {
    if (!_cssPromise) {
        // 同 loadTemplate：外层样式也是独立 URL、会被浏览器单独缓存 ⇒ 别吃缓存 ✓
        _cssPromise = fetch(new URL('style.css', EXT_ROOT).href, { cache: 'no-store' })
            .then(r => (r.ok ? r.text() : ''))
            .catch(() => '');
    }
    return _cssPromise;
}

function rawChatId() {
    try {
        const c = getCtx();
        if (c?.chatId) return c.chatId;
    } catch { /* 忽略 */ }
    return getChatKey();
}

// ---------------------------------------------------------------------------
// ★★ 面板自带数据的桥（随手记 / 敏感带备注 / 占卜台历史）
//
// 起因：面板本体原本是一张**纯前端的角色卡**，它只会写浏览器的本地存储；
//   包成酒馆扩展之后它们**还是只写在浏览器里** ⇒ 清浏览器数据 / 换浏览器 /
//   换设备 / 换域名（localhost 与 127.0.0.1 是两个域）就全没，而且找不回来 ✗
//
// 怎么修（**面板那边一行都不改** ✓）：它照旧读自己那几个键，外壳负责两头 ——
//   ① 打开面板 / 切聊天之前：把插件里的数据灌进浏览器缓存（`syncPanelNotesBridge`）
//   ② 面板往缓存里写的时候：shim 里那个 localStorage 代理顺手发一份给外壳，
//      外壳落进插件数据（`applyPanelNoteWrite`）
//
// 存哪：本聊天那几样 ⇒ 聊天数据（store.js）；「全局」那份随手记 ⇒ 全局设置 ✓
// ⚠️ 只有"插件数据 → 浏览器缓存"这一个方向：浏览器里原来那些老数据**不再自动搬家**
//   （那套迁移逻辑已经删掉 ✓）—— 面板照旧读得到它们，
//   下次一编辑就落进插件数据 ✓
// ---------------------------------------------------------------------------

// 面板那边用的键（跟 assets/bodycord.html 里的常量一字不差 —— 改一处要改两处 ✗）
const LS_NOTES_GLOBAL = 'bc_notes_global';
const LS_NOTES_CHAT = 'bc_notes_chat_';
const LS_ZONE_NOTE = 'bc_zone_note_';
const LS_DIV_HISTORY = 'bc_div_history';

/** 外壳这边能用的 localStorage（拿不到就返回 null ⇒ 整套桥降级成"照旧" ✓） */
export function hostLS() {
    if (!hasWindow()) return null;
    try { return window.localStorage || null; } catch { return null; }
}

/**
 * 面板那边「本聊天」用的 id —— 它的 `notesChatId()` 读的就是**父窗口 live 的 chatId** ✓
 * （所以这里也读 live 值，不能拿外壳推给面板的那个一次性标志 ✗）
 */
export function panelNotesChatId() {
    try {
        const c = getCtx();
        if (!c) return '';
        if (c.chatId !== undefined && c.chatId !== null && String(c.chatId) !== '') return String(c.chatId);
        if (c.chatMetadata?.chat_id) return String(c.chatMetadata.chat_id);
        if (c.chat_metadata?.chat_id) return String(c.chat_metadata.chat_id);
    } catch { /* 忽略 */ }
    return '';
}

/** 面板那边 `getChatKey()` 的口径（'chat_<id>' / 'global'）—— 敏感带备注的键用它 ✓ */
export function panelChatKey() {
    const id = panelNotesChatId();
    return id ? ('chat_' + id) : 'global';
}

/** 这个键属于面板那几样里的哪一样（认不出 ⇒ ''，外壳不碰它 ✓） */
export function panelNoteKind(key) {
    const k = String(key || '');
    const id = panelNotesChatId();
    if (k === LS_NOTES_GLOBAL) return 'notesGlobal';
    if (id && k === LS_NOTES_CHAT + id) return 'notesChat';
    if (k === LS_DIV_HISTORY) return 'divHistory';
    if (k.startsWith(LS_ZONE_NOTE + panelChatKey() + '_')) return 'zoneNote';
    // ★ 面板那颗「状态笔记 · 刚刚更新」的两把钥匙（2026-10-15）——
    //   原来是面板自己写在浏览器缓存里的，现在**正本在聊天数据**（`state().panelUpdate`）✓
    if (/^bc_(last_update|last_raw)_/.test(k)) return 'panelUpdate';
    return '';
}

/**
 * 面板那两把钥匙写回来了 ⇒ 落进聊天数据（`state().panelUpdate`）。
 *
 * ⚠️ `bc_last_update_*` 是天数戳、`bc_last_raw_*` 是那一份原文 —— 只认**当前聊天**那两个 ✓
 * @returns {boolean} 真的落盘了没有
 */
function setPanelStamp(key, value) {
    if (!hasChatMeta()) return false;
    const k = String(key || '');
    const isTs = k.startsWith('bc_last_update_');
    const s = state();
    const cur = (s.panelUpdate && typeof s.panelUpdate === 'object') ? s.panelUpdate : null;
    const next = {
        ts: Number(cur && cur.ts) || 0,
        sig: String((cur && cur.sig) || ''),
        raw: String((cur && cur.raw) || ''),
    };
    if (isTs) next.ts = Math.max(0, Number(value) || 0);
    else next.raw = String(value || '');
    if (cur && next.ts === cur.ts && next.sig === cur.sig && next.raw === cur.raw) return true;  // 没变就不写盘 ✓
    s.panelUpdate = next;
    commit();
    return true;
}

/**
 * 面板写了一份内容 ⇒ 落进插件数据。
 *
 * @returns {string} 落进了哪一格（'' = 没落：键不属于这几样 / 不在聊天里 / 写不进去）
 * ⚠️ 两道防串味的闸：① `bc_notes_chat_<别的聊天>` 直接不理 ✗
 *                    ② 没进聊天（拿不到聊天数据区）时只有「全局」那份落得了盘，
 *                       其余一律返回 '' —— 别假装成功（那正是"以为存了其实没存" ✗）
 */
export function applyPanelNoteWrite(key, value) {
    const k = String(key || '');
    const text = String(value == null ? '' : value);
    // ⚠️ 归类**只走 panelNoteKind 一处** —— 两处各写一套匹配早晚改错一边 ✗
    const kind = panelNoteKind(k);
    if (!kind) return '';

    // ★ 面板那两把「更新时间」钥匙 ⇒ 进聊天数据（见 setPanelStamp ✓）
    if (kind === 'panelUpdate') return setPanelStamp(k, text) ? 'panelUpdate' : '';

    // 「全局」那份穿过所有聊天 ⇒ 不进聊天也落得了盘 ✓
    if (kind === 'notesGlobal') { setGlobalNotes(text); return 'notesGlobal'; }

    // 底下这几样都按聊天存 ⇒ 拿不到聊天数据区就一律不落、如实返回 ''（别假装成功 ✗）
    if (!hasChatMeta()) return '';
    if (kind === 'notesChat') { setChatNotes(text); return 'notesChat'; }
    if (kind === 'divHistory') return setDivHistoryJSON(text) ? 'divHistory' : '';

    // 敏感带备注：键尾巴是部位名（面板那边过了一层 encodeURIComponent ✓）
    const zp = LS_ZONE_NOTE + panelChatKey() + '_';
    let name = k.slice(zp.length);
    try { name = decodeURIComponent(name); } catch { /* 解不开就按原文用 */ }
    return setZoneNote(name, text) ? 'zoneNote' : '';
}

/**
 * 打开面板 / 切聊天之前调一次：把插件数据灌进浏览器缓存（**只有这一个方向** ✓）。
 *
 * 为什么需要：面板本体照旧读它自己那几个键（这就是"面板一行都不用改"的代价 ✓）
 *   ⇒ 换了浏览器 / 清过浏览器数据之后，靠这一步把正本喂回去 ✓
 * ⚠️ 只在插件数据**非空**时写，而且**值一样就不写** —— 绝不拿空串把浏览器那份盖掉 ✗
 *   （切聊天 / 心跳都会调到它，所以必须便宜、而且幂等 ✓）
 * ⚠️ **不做"老数据自动搬家"**（那套逻辑已经删掉）——
 *   ⇒ 浏览器里原来那些老数据照旧留在原处、面板照旧读得到，**下次一编辑就落进插件数据** ✓
 *
 * @param {any} ls 真的 localStorage（测试里给假的 ✓）
 * @returns {{seeded:number}} 这次真写了几条（值没变就是 0 ✓）
 */
export function syncPanelNotesBridge(ls) {
    const out = { seeded: 0 };
    if (!ls) return out;
    const rd = (k) => { try { const v = ls.getItem(k); return typeof v === 'string' ? v : ''; } catch { return ''; } };
    const wr = (k, v) => {
        try {
            if (rd(k) === String(v)) return;      // 一样就不写（心跳里反复写没意义 ✓）
            ls.setItem(k, String(v));
            out.seeded++;
        } catch { /* 忽略 */ }
    };

    // 灌回浏览器缓存（面板照旧读它自己的键 ✓）
    try { const g = globalNotes(); if (g) wr(LS_NOTES_GLOBAL, g); } catch { /* 忽略 */ }
    const id = panelNotesChatId();
    if (id && hasChatMeta()) {
        try { const c = chatNotes(); if (c) wr(LS_NOTES_CHAT + id, c); } catch { /* 忽略 */ }
        // ⚠️ divHistory **无条件灌**（空数组也要写 `'[]'`）：
        //   `LS_DIV_HISTORY` 是**全局**键（另外两个随手记的键都自带聊天 id），
        //   以前 `if (d.length)` 一跳过，切到没有历史的新聊天时面板照旧读上一个聊天那份
        //   ⇒ 静默串数据 ✗（"这个聊天没有历史"和"显示上一个聊天的历史"在面板看来一模一样）
        try { wr(LS_DIV_HISTORY, JSON.stringify(divHistory() || [])); } catch { /* 忽略 */ }
        try {
            const zp = LS_ZONE_NOTE + panelChatKey() + '_';
            for (const [name, v] of Object.entries(zoneNotes())) {
                if (v) wr(zp + encodeURIComponent(name), String(v));
            }
        } catch { /* 忽略 */ }
    }
    return out;
}

// ---------------------------------------------------------------------------

export class BodycordPanel {
    constructor(container, opts = {}) {
        this.container = container;
        // 现取当前容器的函数。外面重建宿主 DOM 之后，`this.container` 会指向
        // 那个已经被摘下来的旧节点 —— 所有"要往哪儿放东西"的地方都该走 this.host()。
        this.host = typeof container === 'function' ? container : () => this.container;
        this.theme = opts.theme || 'light';
        this.iframe = null;
        this._pending = null;
        this._userName = '';
        this._avatar = '';
        this._avatarScope = 'nochat';
        this._onMessage = this._onMessage.bind(this);
        window.addEventListener('message', this._onMessage);
    }

    /**
     * ★★ 插图点击无法放大的修法：面板里点那张插图 → **在酒馆页面上铺一层全屏**看大图 ✓
     *
     * 为什么必须由外壳干：面板住在一个 iframe 里，它自己的 `position:fixed` **只盖得住那个小框**
     *   ⇒ 在面板里做"放大"其实只大一点点，白做 ✗
     * ⚠️ 大图**直接克隆面板里那一个节点**（同源 iframe 拿得到 ✓）—— 层的位移/缩放都在**行内 style** 上
     *   ⇒ 克隆出来一模一样，**不用把画图的逻辑再写一遍** ✗（这正是"只写一份"那条教训）
     * ⚠️ 面板那套 CSS 在 iframe 里 ⇒ 克隆过来的节点在外壳文档里**拿不到那些类** ⇒
     *   缩放要的那几条规则在外壳的 `style.css` 里**再写一份**（`.bc-stage-zoom` 下面 ✓）
     */
    _openStageZoom() {
        let art = null;
        try { art = this.iframe?.contentDocument?.querySelector('.stage-page .stage-art'); } catch { art = null; }
        // 没有图（文字版那种）就不弹 —— 弹出来只有一句字，没意义 ✗
        if (!art || !art.querySelector('img')) return;
        this._closeStageZoom();
        const box = document.createElement('div');
        box.className = 'bc-stage-zoom';
        box.id = 'bcStageZoom';
        box.title = '点一下关闭（Esc 也行）';
        const clone = art.cloneNode(true);
        clone.removeAttribute('title');
        // 点开大图之后鼠标显示的是 +，不应该也是 - 吗——
        //   面板里那张图的行内样式写着 `cursor: zoom-in`（"点一下放大"），克隆过来也一起带过来了 ✗
        //   ⇒ 大图这一层已经放大了，点它是"关掉" ⇒ 覆盖成 zoom-out ✓
        try { clone.style.cursor = 'zoom-out'; } catch { /* 忽略 */ }
        box.appendChild(clone);
        box.addEventListener('click', () => this._closeStageZoom());
        // 提示说 ESC 能关，其实关不掉——
        //   根因：玩家点的是 **iframe 里**那张图 ⇒ 焦点还在 iframe 的文档里，
        //   keydown 只派到 iframe 的 document，**外层 document 的监听收不到** ✗
        //   ⇒ 两个文档都挂（同源拿得到 ✓），并顺手把焦点抢到这一层来当双保险 ✓
        // ⚠️ 必须**拦下这一下**：不然外壳/酒馆那条"ESC = 关面板"也会跟着触发 ——
        //   按 ESC 面板关了、大图还留在屏幕上 ✗
        this._zoomKey = (e) => {
            if (e.key !== 'Escape') return;
            try { e.preventDefault(); e.stopPropagation(); } catch { /* 忽略 */ }
            this._closeStageZoom();
        };
        document.addEventListener('keydown', this._zoomKey, true);
        this._zoomDoc = null;
        try {
            const d = this.iframe?.contentDocument;
            if (d) { d.addEventListener('keydown', this._zoomKey, true); this._zoomDoc = d; }
        } catch { /* 忽略 */ }
        box.tabIndex = -1;
        document.body.appendChild(box);
        try { box.focus(); } catch { /* 忽略 */ }
    }

    _closeStageZoom() {
        const el = document.getElementById('bcStageZoom');
        if (el?.parentNode) el.parentNode.removeChild(el);
        if (this._zoomKey) {
            document.removeEventListener('keydown', this._zoomKey, true);
            try { this._zoomDoc?.removeEventListener('keydown', this._zoomKey, true); } catch { /* 忽略 */ }
            this._zoomKey = null;
            this._zoomDoc = null;
        }
    }

    _onMessage(ev) {
        const d = ev?.data;
        if (!d || d.__bodycord !== true) return;
        // 只处理自己 iframe 发来的消息
        if (this.iframe && ev.source !== this.iframe.contentWindow) return;
        if (d.type === 'save') {
            try { applySnapshotChat(d.chat); } catch (e) { console.warn('[Bodycord] 保存失败', e); }
        } else if (d.type === 'mountDice') {
            try { this._mountDiceInto(true); } catch (e) { console.warn('[Bodycord] 挂骰子面板失败', e); }
        } else if (d.type === 'zoomStage') {
            // ★★ 插图点击无法放大的修法：面板里点那张插图 → 外壳在酒馆页面上铺一层全屏 ✓
            try { this._openStageZoom(); } catch (e) { console.warn('[Bodycord] 放大插图失败', e); }
        } else if (d.type === 'openTime') {
            // 面板侧栏点了「时光机」频道 —— 时光机是独立窗口，不嵌进 iframe
            try { this._onOpenTime?.(); } catch (e) { console.warn('[Bodycord] 打开时光机失败', e); }
        } else if (d.type === 'notesStats') {
            // 随手记的计数（只报条数/图片数/失败数，不带内容 ⇒ 不涉隐私 ✓）
            _lastNotesStats = d.stats || null;
        } else if (d.type === 'panelNoteWrite') {
            // ★ 面板写了一份它自己那份存储的内容（随手记 / 敏感带备注 / 占卜台历史）
            //   ⇒ 顺手落进插件数据（搬家逻辑见上面那段说明 ✓）
            //   ⚠️ 落不了的情况（不属于这几样 / 没进聊天）不弹窗、也不报错 ——
            //      那种时候浏览器那份就是唯一一份，行为和以前一样 ✓
            //   ⚠️ 真出错（写插件数据抛了）**必须说出来** ✗ 不许静默吞掉
            //      （写入失败要提示）
            try {
                const what = applyPanelNoteWrite(d.key, d.value);
                if (!what) console.warn('[Bodycord] 这份内容只留在浏览器缓存里（没落进插件数据）：' + d.key);
            } catch (e) {
                console.warn('[Bodycord] 面板内容落盘失败', e);
                try { window.toastr?.warning?.('这份内容没能存进插件的聊天数据，建议先导出一份'); } catch { /* 忽略 */ }
            }
        } else if (d.type === 'avatarReset') {
            // ★ 面板里点了「重置头像」——**由外壳给权威值**，别让面板自己扫 ✓
            //
            // 症状：当前用户角色头像本来是对的，一重置就变成不正确的版本；
            //   换过头像之后重置同样不对 ✗
            // 根因：`重置头像` 把缓存清掉之后，**面板自己那套 scanAvatar() 又扫了一遍**，
            //   而它停留在**老逻辑**（取第一条用户消息的头像 + "列表里随便挑一个"的兜底）
            //   ⇒ 抓到的是聊天刚开始时的旧人设、甚至别人 ✗
            // ⇒ 现在：面板只负责清缓存 + 通知一声；**该显示谁由外壳 `resolvePersonaAvatar()` 决定** ✓
            //   （外壳那份是修过的版本：取**最后一条**用户消息、且删掉了乱抓的兜底 ✓）
            const url = pickAvatarForPanel();
            if (url) {
                this._avatar = url;
                try { this.iframe?.contentWindow?.__bodycordSetAvatar?.(url); } catch { /* 忽略 */ }
            } else {
                try { window.toastr?.info?.('这次没抓到当前用户角色的头像，面板会用自带的图标'); } catch { /* 忽略 */ }
            }
        } else if (d.type === 'esc') {
            // 面板里按 ESC、但它自己已经没有浮层可收 ⇒ 交给外壳按同一条规矩关（先退回状态页、再关面板）
            //   ⚠️ 不能让 bodycord.js 直接 import ui.js（循环依赖 ✗）⇒ 用 window 事件 ✓
            try { window.dispatchEvent(new CustomEvent('bodycord:escFromPanel')); } catch { /* 忽略 */ }
        } else if (d.type === 'contactsAdd') {            // 「联系人」页那个「添加致孕方」—— 玩家自己点的，所以允许写 ✓
            //   ⚠️ 只有**玩家主动点**才建档；查看那一大片（contactsForPanel）**永远是只读**的 ✗
            const r = this._addContactFromPanel(String(d.name || '').trim());
            this._replyPanel('__bodycordContactsAdded', r.ok, r.msg);
            if (r.ok) {
                // 让外壳重建状态视图 + 刷新（名字栏/名单要跟着变）
                try { window.dispatchEvent(new CustomEvent('bodycord:contactsAdded')); } catch { /* 忽略 */ }
                this.update();
            }
        } else if (d.type === 'contactsRace') {           // 「联系人」详情里那颗「改种族」—— 玩家自己点的，所以允许写 ✓
            this._editContactRace(String(d.name || '').trim());
        } else if (d.type === 'childRename') {
            // ★★ 2026-10-31（她：孩子名字只能在悬浮球改，这不正常）——
            //   「孩子」频道每张卡上那颗「改名 / 起名」⇒ 外壳弹输入框、落库、再刷新 ✓
            //   ⚠️ 面板只报 id（它手上只有那份 payload）⇒ **写库永远在外壳** ✓
            //   ⚠️ 预览里的样例孩子没有真实 id ⇒ 面板那颗按钮已经按 `readonly` 收起来了；
            //      这里再挡一道（取不到就提示，绝不往真数据上写 ✗）
            const id = String(d.id || '');
            const rec = (() => {
                try { return children().find((x) => String(x.id) === id) || null; } catch { return null; }
            })();
            if (!rec) {
                try { window.toastr?.warning?.('这条孩子记录找不到了（刷新一下再看看）'); } catch { /* 忽略 */ }
                return;
            }
            askText({
                title: rec.name ? '给孩子改名' : '给孩子起个名字',
                value: String(rec.name || ''),
                placeholder: '不填就还叫「第 N 个孩子」',
                maxLen: 20,
            }).then((txt) => {
                if (txt === null) return;                 // 取消 ⇒ 一个字都不动 ✓
                const v = String(txt).trim();
                if (v === String(rec.name || '').trim()) return;
                updateChild(id, { name: v });
                try { window.dispatchEvent(new CustomEvent('bodycord:childrenRenamed')); } catch { /* 忽略 */ }
                this.update();
            });
        } else if (d.type === 'contactsMore') {
            // ★ 「还有 N 条更早的」那颗按钮（「乙：继续加载」）——
            //   面板说"这个人再多给一页" ⇒ 外壳把这一页记上，然后重算重推 ✓
            //   ⚠️ 这只是"多看几页"，**不动任何数据**（查看永远只读 ✓）
            const k = String(d.tab || 'contacts') + '|' + String(d.name || '');
            if (k !== '|') {
                _ctMore[k] = (Number(_ctMore[k]) || 0) + 1;
                this.update();
            }
        } else if (d.type === 'contactsCollapse') {
            // ★ 「收起」：把这个人多看的页数清掉，回到第一页（只改显示，不动数据 ✓）
            const k = String(d.tab || 'contacts') + '|' + String(d.name || '');
            if (k !== '|') {
                delete _ctMore[k];
                this.update();
            }
        } else if (d.type === 'contactsHideDead') {
            // ★ 联系人详情的「隐藏已失活」—— 只改显示偏好，不动账本 ✓
            setContactsHideDead(d.value === true);
            this.update();
        } else if (d.type === 'calendarNav') {
            // ★ 翻月：面板**不自己算日期** ⇒ 回外壳重算一格再推过去 ✓
            const step = Number(d.step) || 0;
            if (step) {
                const nM = Math.max(1, Math.floor(Number(d.months) || 12));
                let y = Math.max(1, Math.floor(Number(_calYM?.y) || 1));
                let m = Math.floor(Number(_calYM?.m) || 1) + step;
                while (m < 1) { m += nM; y -= 1; }          // 跨年前后都算上（自定义历法月数不定 ✓）
                while (m > nM) { m -= nM; y += 1; }
                _calYM = { y: Math.max(1, y), m };
                // 翻到别的月份 ⇒ 原来选的那天不在眼前了，交给下面重算（落回今天 / 1 号 ✓）
                _calSel = null;
                this.update();
            }
        } else if (d.type === 'calendarMode') {
            // ★ 默认 / 跨月都要做，不然圈日子怎么办 ✓
            //   只换一个模式标记 ⇒ 下次拼的时候形态就不一样了 ✓
            _calMode = (String(d.mode || '') === 'span') ? 'span' : 'default';
            this.update();
        } else if (d.type === 'calendarToday') {
            // ★ 还要一个**跳转回当前日期**的选项 ✓
            //   把 `_calYM` 清空 ⇒ 下次算的时候自己落回"今天那个月" ✓
            _calYM = null;
            _calSel = null;
            this.update();
        } else if (d.type === 'calendarJump') {
            // ★ 系统弹窗全换掉（`window.prompt` 在安卓 WebView 里可能
            //   静默返回空 ✗）⇒ 改用我们自己的输入弹窗 ✓
            //   **留空 = 回到今天**（所以不用再单做一个「今天」按钮 ✓）
            askText({
                title: '跳到哪一年哪一月',
                placeholder: '例：3-2 就是第 3 年第 2 月',
                maxLen: 12,
                help: ['直接确定（留空）= 回到今天那个月'],
            }).then((txt) => {
                if (txt === null) return;                       // 取消 ⇒ 一个字都不动 ✓
                const t = String(txt).trim();
                if (!t) { _calYM = null; _calSel = null; this.update(); return; }
                const mm = t.match(/^(\d{1,5})\s*[-/\s,，.]\s*(\d{1,3})$/);
                if (!mm) {
                    try { window.toastr?.warning?.('看不懂，写成「年-月」这样，例：3-2'); } catch { /* 忽略 */ }
                    return;
                }
                _calYM = { y: Math.max(1, Number(mm[1])), m: Math.max(1, Number(mm[2])) };
                _calSel = null;
                this.update();
            });
        } else if (d.type === 'calendarDueJump') {
            // ★ 2026-10-26「跳到预产期」——
            //   只是**把日历翻过去看**（顺带选中那天），一个字都不写 ✓
            //   选哪一胎：还没到的里最近那一胎；全都过了 ⇒ 最近刚过的那个 ✓
            const dueList = (() => { try { return dueMarksForPanel(); } catch { return []; } })();
            if (!dueList.length) {
                try { window.toastr?.warning?.('现在没有定下来的预产期'); } catch { /* 忽略 */ }
                return;
            }
            let pick = dueList.find((m) => Number(m.late) <= 0) || null;
            if (!pick) pick = dueList.reduce((a, b) => (Number(b.late) < Number(a.late) ? b : a), dueList[0]);
            const p = parseFictionDate(pick.date, activeCalendar());
            if (!p) {
                try { window.toastr?.warning?.('这个预产期读不出来：' + pick.date); } catch { /* 忽略 */ }
                return;
            }
            _calYM = { y: p.y, m: p.m };
            _calSel = { y: p.y, m: p.m, d: p.d };
            _calMode = 'default';
            this.update();
            try {
                window.toastr?.info?.('跳到预产期：' + pick.date
                    + (pick.fetus ? ('（第 ' + pick.fetus + ' 胎）') : ''));
            } catch { /* 忽略 */ }
        } else if (d.type === 'calendarPick') {
            // ★ 直接点击这个日期，就在日历的下半部分编辑内容 ✓
            //   ⇒ 点一格 = 选中那天 + 下面就地编辑（**那个 prompt 撤了** ✗）
            //   ⚠️ 跨月视图里有 3 个月 ⇒ 面板得连"哪年哪月"一起报回来（data-cal-y / -m ✓）
            const y = Math.max(1, Math.floor(Number(d.y) || Number(_calYM?.y) || 1));
            const m = Math.max(1, Math.floor(Number(d.m) || Number(_calYM?.m) || 1));
            const day = Math.max(1, Math.floor(Number(d.day) || 0));
            if (!day) return;
            _calYM = { y, m };
            _calSel = { y, m, d: day };
            _calMode = 'default';       // 跨月里点一天 ⇒ 回到默认视图（那儿才有下半部分 ✓）
            this.update();
        } else if (d.type === 'calendarAdd') {
            // 「＋ 加一条」：给那一天添一条空的，整页重算（面板随后会把新那格聚焦 ✓）
            const date = String(d.date || '') || (_calReal ? _calKeepKey() : _calSelDate());
            if (date) {
                if (_calReal) addRealEvent(date); else addCalendarEvent(date);
                this.update();
            }
        } else if (d.type === 'calendarDel') {
            // 「✕」：删掉这一条 ⇒ 行要消失，所以整页重算 ✓
            const okDel = _calReal
                ? deleteRealEvent(String(d.date || ''), String(d.id || ''))
                : deleteCalendarEvent(String(d.date || ''), String(d.id || ''));
            if (okDel) this.update();
        } else if (d.type === 'calendarSave') {
            // ★ 保存一条日程。**这里故意不 `this.update()`** ——
            //   整页重画会把玩家正在打字的输入框连焦点一起干掉 ✗
            //   ⇒ 只把"格子上那圈红圈 + 那行小字"算好回给面板，让它自己贴一下 ✓
            const e = d.entry || {};
            const date = String(e.date || '');
            const patch = { allDay: !!e.allDay, start: e.start, end: e.end, title: e.title, note: e.note, remind: e.remind !== false };
            const r = _calReal
                ? updateRealEvent(date, String(e.id || ''), patch)
                : updateCalendarEvent(date, String(e.id || ''), patch);
            const card = _calReal ? realEventDayCard(date) : calendarDayCard(date);
            this._replyPanel('__bodycordCalendarSaved', {
                ok: !!r.ok,
                warn: r.warn || '',
                id: String(e.id || ''),
                day: card ? card.day : 0,
                label: card ? card.label : '',
                count: card ? card.count : 0,
            });
        } else if (d.type === 'calendarHolidays') {
            // 右上角那个节日开关 ✓（只管出厂那张表；玩家自己标的日子不受影响 ✓）
            setHolidaysOn(!holidaysOn());
            this.update();
        } else if (d.type === 'calendarDismiss') {
            // 「知道了」⇒ 把这些提示记成已提示（**只弹一次** ✓）
            //   ⚠️ 记到**哪一本账**跟着这一屏读的是哪份日程走（现实那份的账在全局 ✓）
            const keys = String(d.keys || '').split('\n');
            if (_calReal) markRealAlerted(keys); else markCalendarAlerted(keys);
            this.update();
        } else if (d.type === 'notesImageSave') {
            // 随手记的图片：面板把 File 递过来（结构化克隆能传 File ✓），
            // 压缩 + 上传都在插件这边做（面板里没有压缩模块，也不该由它去调酒馆接口）
            this._handleNotesImageSave(d).catch((e) => {
                this._replyPanel('__bodycordNotesImageResult', d.id, { ok: false, error: String(e?.message || e) });
            });
        } else if (d.type === 'notesImageDelete') {
            // 删笔记时顺手把图也删掉（不然酒馆图片目录里会攒孤儿文件）
            deleteNotesImages(d.paths).then((r) => {
                this._replyPanel('__bodycordNotesImageDeleted', r);
            }).catch((e) => console.warn('[Bodycord] 删笔记图片失败', e));
        } else if (d.type === 'lyricState') {
            // ★ 悬浮歌词条：面板推"现在唱到哪" ⇒ 交给外壳更新那一条 ✓
            //   （音频在面板那个 iframe 里，配置在插件设置里 ⇒ 两边各管一半，靠消息对起来 ✓）
            try { this._onLyricState?.(d.state || {}); } catch (e) { console.warn('[Bodycord] 更新悬浮歌词失败', e); }
        } else if (d.type === 'lyricCfgGet') {
            // 面板那颗"遥控器"要一份当前配置（它的音乐页每画一次问一次 ✓）
            try { this._replyPanel('__bodycordLyricCfg', this._onLyricCfgGet?.() || null); } catch (e) { console.warn('[Bodycord] 取歌词配置失败', e); }
        } else if (d.type === 'lyricCfgSet') {
            // 面板改了配置（开关/颜色/透明度/锁）⇒ 外壳存下来 + 立刻生效，并把完整配置回过去 ✓
            try { this._replyPanel('__bodycordLyricCfg', this._onLyricCfgSet?.(d.patch || {}) || null); } catch (e) { console.warn('[Bodycord] 改歌词配置失败', e); }
        } else if (d.type === 'lyricReset') {
            // 面板点了「一键重置」✓
            try { this._replyPanel('__bodycordLyricCfg', this._onLyricReset?.() || null); } catch (e) { console.warn('[Bodycord] 重置歌词配置失败', e); }
        } else if (d.type === 'timerGet') {
            // ★ 番茄钟：面板刚打开「计时」那一页，问一份当前读数 ✓
            try { this._replyPanel('__bodycordTimerSet', this._onTimerSnapshot?.() || null); } catch (e) { console.warn('[Bodycord] 取计时读数失败', e); }
        } else if (d.type === 'timerAction') {
            // 面板按了某颗按钮（开始 / 暂停 / 重来 / 切档 / 快选分钟 / 清轮数）——
            //   **真相只在外壳**，动作改完顺手把新读数回给它 ✓
            try { this._onTimerAction?.(String(d.action || ''), d.arg); } catch (e) { console.warn('[Bodycord] 计时操作失败', e); }
        } else if (d.type === 'timerPerm') {
            // 玩家点了「允许通知」⇒ 这一下就是玩家手势，正好用来要权限 ✓
            try { this._onTimerPerm?.(); } catch (e) { console.warn('[Bodycord] 请求通知权限失败', e); }
        }
    }

    /**
     * 「联系人」页里那个「添加致孕方 / 添加受孕方」—— **玩家自己点的**，所以允许写 ✓
     *
     * 做两件事：①`createTarget(name)` 建档（这样他才有档案 / 种族那些格子 ✓）
     *          ②名字/多人模式下顺手写进 `settings.targetNames`（否则他不会进推演名单 ✗）
     * ⚠️ 跟 `contactsForPanel()` 划清界限：**查看永远只读**，只有这里（点按钮）才写 ✓
     * @returns {{ok:boolean, msg:string}}
     */
    _addContactFromPanel(name) {
        if (!name) return { ok: false, msg: '先填个名字' };
        try {
            const t = createTarget(name);
            if (!t) return { ok: false, msg: '这个名字建不了档：' + name };
            const s = settings();
            if (s.targetMode === 'single' || s.targetMode === 'multi') {
                const arr = Array.isArray(s.targetNames) ? s.targetNames.slice() : [];
                if (!arr.some((x) => String(x).trim() === name)) {
                    s.targetNames = [...arr, name];
                    save();
                }
            }
            return { ok: true, msg: '已添加：' + name };
        } catch (e) {
            return { ok: false, msg: '添加失败：' + (e?.message || e) };
        }
    }

    /**
     * 「联系人」详情里那颗「改种族」—— **玩家自己点的**，所以允许写 ✓
     *
     * 写哪儿：跟「角色基础信息 → 这个角色的种族」**同一格**（身体补丁正文里那行）——
     *   复用它那条写库路 ⇒ 面板上两个入口改的是同一份，不会各存一份 ✗
     *   （`writeParams` 会顺手打上"手改过"的标记 ✓）
     * 还没有档案的名字：顺手建一个**轻档**（只记名字和种族那种，不占追踪名额 ✓）
     */
    async _editContactRace(name) {
        const nm = String(name || '').trim();
        if (!nm) return;
        try {
            const t = findOrCreateLightTarget(nm);
            if (!t) { try { window.toastr?.warning?.('这个名字用不了'); } catch { /* 忽略 */ } return; }
            const cur = (() => { try { return String(raceJudgeOf(t.key)?.race || ''); } catch { return ''; } })();
            const v = await askText({
                title: '「' + (displayName(t) || nm) + '」的种族',
                value: cur,
                placeholder: '例：人类 / 半精灵 / 狼人',
                maxLen: 12,
                help: [
                    '跟「角色基础信息」里那一格是同一份',
                    '填完，联系人那一行就显示它了',
                ],
            });
            if (v === null) return;                    // 取消 ✓
            const ok = writeParams(specFor('body_base'), t.key, { raceName: String(v).trim() });
            try { window.toastr?.[ok ? 'success' : 'info']?.(ok ? '已记下' : '没有变化'); } catch { /* 忽略 */ }
            this.update();
        } catch (e) {
            console.warn('[Bodycord] 改种族失败', e);
            try { window.toastr?.warning?.('改种族失败：' + (e?.message || e)); } catch { /* 忽略 */ }
        }
    }

    /** 回一句话给面板（面板那边用 window.__bodycordXxx 接） */
    _replyPanel(fnName, ...args) {
        try {
            const w = this.iframe?.contentWindow;
            const fn = w && w[fnName];
            if (typeof fn === 'function') fn(...args);
        } catch (e) { console.warn('[Bodycord] 回消息给面板失败', e); }
    }

    /** 压好一张图并上传（面板只给 File + 这张笔记属于哪个文件夹）*/
    async _handleNotesImageSave(d) {
        try {
            const image = await saveNotesImage(d.file, d.scopeId || 'global');
            this._replyPanel('__bodycordNotesImageResult', d.id, { ok: true, image });
        } catch (e) {
            console.warn('[Bodycord] 保存笔记图片失败', e);
            this._replyPanel('__bodycordNotesImageResult', d.id, { ok: false, error: String(e?.message || e) });
        }
    }

    /**
     * 把「骰子」那一页的内容搬进 iframe。
     *
     * 面板的侧栏是它自己的（在 iframe 里），而骰子 UI 是插件这边渲染的。
     * 跨文档没法直接 append，所以：
     *   1. 先在**当前文档**里把骰子 UI 建好（这样所有事件监听都正常）
     *   2. 用 adoptNode 把节点**搬**过去（监听器跟着走，不会丢）
     *   3. 再把插件的样式表塞进 iframe，不然搬过去就没样式了
     */
    _mountDiceInto(fromPanel = false) {
        const doc = this.iframe?.contentDocument;
        if (!doc) { if (fromPanel) this._diceDiag('拿不到 iframe 文档'); return; }
        const host = doc.getElementById('bcDiceMount');
        if (!host) {
            // 面板主动来敲门却找不到容器 —— 说明那两边的 iframe 不是同一个，
            // 这种静默情况最难查，必须写出来。
            if (fromPanel) this._diceDiag('面板说在骰子页，但外壳这个 iframe 里找不到 #bcDiceMount');
            return;
        }
        if (host.dataset.bcMounted === '1') {
            // ★ 已经挂上过 ⇒ 只重画内容，别再把整个容器重建 ✗
            //   骰子页显示的是「这一轮取用了哪些 / 池子」这类每轮都会变的数据，
            //   原来挂上之后永远不再重画 ⇒ 推演完了还显示「没有取用任何随机数」✗
            try {
                const existing = host.querySelector('.bc-embed');
                if (existing) renderDiceTab(existing, { embedded: true });
            } catch (e) { console.warn('[Bodycord] 重画骰子面板失败', e); }
            return;
        }

        try {
            const wrap = document.createElement('div');
            wrap.className = 'bc-embed';
            wrap.dataset.theme = this.theme || 'light';
            renderDiceTab(wrap, { embedded: true });
            if (!wrap.childElementCount) throw new Error('骰子 UI 渲染出来是空的');
            host.dataset.bcMounted = '1';
            // ⚠️ 先把占位（「骰子面板载入中…」/错误文案）清掉再挂，
            //   否则它会一直留在内容上方。
            while (host.firstChild) host.removeChild(host.firstChild);
            host.appendChild(doc.adoptNode(wrap));
        } catch (e) {
            console.warn('[Bodycord] 挂骰子面板失败', e);
            this._diceDiag('挂载失败：' + ((e && e.message) || e));
            return;
        }

        this._injectCssInto(doc);
    }

    /** 把问题直接写在骰子那一页上，别让用户对着空白发呆 */
    _diceDiag(msg) {
        try {
            const doc = this.iframe?.contentDocument;
            const host = doc && doc.getElementById('bcDiceMount');
            if (!host) return;
            host.textContent = '⚠️ ' + msg;
            host.style.cssText = 'padding:16px;color:var(--red, #bc4a4e);font-size:12.5px;line-height:1.8';
        } catch { /* 忽略 */ }
    }

    async _injectCssInto(doc) {
        if (!doc || doc.getElementById('bcDiceStyle')) return;
        try {
            const css = await extCss();
            if (!css) return;
            const st = doc.createElement('style');
            st.id = 'bcDiceStyle';
            st.textContent = css;
            (doc.head || doc.documentElement).appendChild(st);
        } catch (e) {
            console.warn('[Bodycord] 骰子面板样式注入失败', e);
        }
    }

    destroy() {
        // 先打标记再动手：mount() 可能正卡在 await 上，醒过来时要能看见这个标记
        this._destroyed = true;
        window.removeEventListener('message', this._onMessage);
        if (this.iframe) this.iframe.remove();
        this.iframe = null;
    }

    _currentRaw() {
        // ⚠️⚠️ 预览模式下**要按当前对象给不同的样例** ✗：
        //   症状是「多人模式的预览还是有问题，并且敏感带完全是一样的」——
        //   根因就是这里原来写的是 `if (this.previewRaw) return this.previewRaw;` ——
        //   **预览一开，任何对象都返回同一份** ⇒ 9 个人看起来一模一样 ✗。
        //   ⇒ 现在优先走 previewRawFor（按 key 取样例），没有再退回单一样例 ✓
        try {
            // ★ 预览「多人模式」时**完全按名字查**：查不到就退回"单人样例"，
            //   但**绝不**再去查真实对象 —— 否则切到某个不在样例里的名字时，
            //   面板会突然显示真实数据，看起来就是"预览坏了 / 数据全一样" ✗
            if (this.previewRawFor) {
                // ★ 预览多人时用**面板自己记的样例选中项**（外壳推来的 previewActiveKey），
                //   别用真实的 state().active —— 样例名字不是真实对象，按真实 active 永远查不到
                //   ⇒ 一律退回单人样例、九个人看着一模一样 ✗
                const active = this.previewActiveKey || state().active;
                const one = active != null ? this.previewRawFor[active] : '';
                return one || this.previewRaw || '';
            }
        } catch { /* 忽略 */ }
        // 预览模式下用样例数据顶替 —— 挂在实例上，面板重建也不会丢
        if (this.previewRaw) return this.previewRaw;
        // ★★ **不在聊天页 ⇒ 不给面板喂"占位空面板"**。
        //   现象：在非聊天的情况下看预览，却看到了一份像真实数据的面板
        //   ⇒ 根因：`index.js` 的 `ensurePlaceholder()` 会给「你自己」那份填一个**空的**
        //     `<status_profile>`（为了悬浮球点开不是白的），而它**在非聊天页也照样存在** ⇒
        //     退出预览后 `_currentRaw()` 就把这份"有名字、各格全空"的面喂给面板 ⇒
        //     看着像真实数据，其实是占位面板 ✗（工具条那句「还没进入聊天，面板暂无数据」
        //     跟它自相矛盾 ✓）
        //   ⇒ 现在非聊天页一律给空串：面板走空状态，跟那句提示一致 ✓
        //   ⚠️ 只影响**靠状态数据的那几页**（概览/胎儿/敏感带/透视）；随手记 / 音乐 / 骰子 / 孩子
        //     这些不靠 raw 的频道照旧可用 ✓；预览分支在上面、不受影响 ✓
        //   （生理监测已并回概览 ⇒ 它不再是一个频道 ✓）
        if (!inChatPage()) return '';
        const s = state();
        const t = s.targets?.[s.active];
        if (t?.raw) return t.raw;
        const first = Object.values(s.targets || {})[0];
        return first?.raw || '';
    }

    _currentUserName() {
        return userDisplayName();
    }

    /**
     * ★★ 面板那颗「状态笔记 · 刚刚更新」的**判据与正本**都在这儿（2026-10-15）。
     *
     * 重新进入酒馆之后还显示成：刚刚更新，这不对 ⇒ 正解＝**记录下来的现实时间**
     *   （过多久显示多久）✓
     * 面板那边原来拿它自己的 localStorage 当正本，而那个存储在有些环境里不可用
     *   （shim 会静默退回内存版 ⇒ 一重进就归零 ✗）
     * ⇒ 判据搬到这里：拿这一趟要推的 raw 跟聊天数据里记的指纹比，**真变了才盖时间戳** ✓
     *   然后按面板那边的键名把两把钥匙发给它（`bc_last_update_<chatKey>` / `bc_last_raw_<chatKey>`）✓
     * ⚠️ 预览（样例数据）与空内容都不算"更新过" ✗
     */
    _stampAndKeys(raw) {
        // ⚠️ 这个 key 必须跟面板 `getChatKey()` **一字不差**（'chat_' + 它拿到的 chatId ✓）
        //   ⇒ 用 `rawChatId()`（就是发给面板的那个 chatId ✓），**不要**用 panelChatKey()：
        //     后者在"拿不到 chatId"时会退成 'global'，而面板那边退成别的 ⇒ 两头对不上 ✗
        const key = 'chat_' + String(rawChatId() || 'global');
        const kTs = 'bc_last_update_' + key;
        const kSig = 'bc_last_raw_' + key;
        try {
            const text = String(raw || '');
            const isPreview = !!(this.previewRaw || this.previewConceptionFor);
            const s = state();
            const t = s.targets?.[s.active] || Object.values(s.targets || {})[0] || null;
            // ★★ 更新时间 ＝ **这个对象上次推演的时间**（`t.updatedAt`，玩家定的口径：
            //   手改数值不算"推演过" ✓，设置页名单里显示的就是它 ✓）
            //   ⚠️⚠️ 2026-10-15 的教训（重进还是刚刚更新的**真根因**）：
            //     原来拿"**渲染出来的文字**变没变"当判据 ⇒ 面板/外壳**重渲染出一份一模一样的
            //     文字**也会被判成"更新过" ⇒ 重进一次就盖一次新时间戳 ⇒ 永远"刚刚更新" ✗✗
            //     （实锤：玩家聊天文件里存的 raw 和当前 raw 指纹一模一样，ts 却是刚刚 ✗）
            //   ⇒ 判据换成**存储里的推演时间**：重进 / 重渲染 / 重开酒馆都不会动 ✓
            const ts = Number(t?.updatedAt) || 0;
            if (!isPreview && text) {
                const sig = hashText(text);
                const cur = s.panelUpdate;
                if (!cur || cur.sig !== sig || Number(cur.ts) !== ts) {
                    s.panelUpdate = { ts: ts || Number(cur && cur.ts) || 0, sig, raw: text };
                    try { commit(); } catch (e) { console.warn('[Bodycord] 更新时间戳落盘失败（内存里那份照用）：', e); }
                }
            }
            const now = s.panelUpdate;
            const out = {};
            if (now && now.ts) out[kTs] = String(now.ts);
            // ⚠️ 面板那边比的是**原文**（它拿这个决定"要不要重画那块"）⇒ 给原文 ✓
            if (now && now.raw) out[kSig] = String(now.raw);
            return { keys: out, ts: Number((now && now.ts) || 0) };
        } catch (e) {
            // ⚠️ **不许静默吞**（2026-10-15 的教训：这里一吞，面板就永远"刚刚更新"，
            //   而且从界面上一点线索都没有 ✗）—— 出问题要留一行，诊断/控制台看得见 ✓
            console.warn('[Bodycord] 面板更新时间戳算失败（这一趟不给面板发更新时间）：', e);
            return { keys: {}, ts: 0 };
        }
    }

    _payload() {
        const rawNow = this._currentRaw();
        const stampNow = this._stampAndKeys(rawNow);
        return {
            raw: rawNow,
            // ★★ 「状态笔记 · 刚刚更新」那两把钥匙 ＋ 时间戳——
            //   时间戳的**权威来源**＝该对象上次推演的时间（`t.updatedAt`），
            //   由外壳喂给面板（面板**不再自己盖**，见 assets/bodycord.html 的 markUpdated ✓）
            panelShellLs: stampNow.keys,
            panelUpdateTs: stampNow.ts,
            // 预览模式下换成样例楼层（推演记录频道靠它渲染）
            chat: this.previewChat ?? snapshotChat(),
            chatId: rawChatId(),
            // ★ 头像 / 签名 / 在线状态按"非聊天一份 + 每个聊天一份"隔离（见 avatarScopeId）
            avatarScope: avatarScopeId(),
            userName: this._currentUserName(),
            theme: this.theme,
        // 易读模式：跟 theme 一样推给面板（面板自己那份 CSS 靠 html[data-vision] 生效 ✓）
        vision: (settings().visionMode === 'large') ? 'large' : 'normal',
            avatar: this._avatar,
            // 「有没有真的在聊天里」用显式标志传，不去猜 chatId 长什么样
            inChat: inRealChat(),
            // ★ 「在不在某个聊天页」是另一个判据（有 chatId 就算，哪怕聊天里还没有正文）。
            //   随手记按聊天分账用它 —— 用 inChat 的话，新开的空聊天会被当成非聊天页面 ✗
            inChatPage: inChatPage(),
            iconCss: buildIconCss(customIcons()),
            // 受孕记录（谁什么时候让玩家怀上的、每次内射全部记下）
            // ★ 按对象分账：传"当前查看的那个对象"✓
            //   （以前不给参数 ⇒ 读到全局那份 ⇒ 看谁都是同一份历史 ✗）
            // 预览模式下换成样例数据 —— 不然在非聊天页面上看到的是空频道
            conception: (() => {
                // ★ 预览多人：按"当前看的那个样例"取一份（受孕记录本来就要按对象分 ✓）
                if (this.previewConceptionFor) {
                    const k = this.previewActiveKey || state().active;
                    return this.previewConceptionFor[k] || this.previewConception || null;
                }
                return this.previewConception ?? conceptionForPanel(state().active);
            })(),
            // 「推演记录」要的两块：A 状态变化对比、B 最近一次推演明细
            // 预览模式下换成样例（跟 conception / chat 一样）
            judgeLog: (() => {
                // ★ 预览多人：按"当前看的那个样例"取一份（推演记录也要按人分 ✓）
                if (this.previewJudgeLogFor) {
                    const k = this.previewActiveKey || state().active;
                    return this.previewJudgeLogFor[k] || this.previewJudgeLog || null;
                }
                if (this.previewJudgeLog) return this.previewJudgeLog;
                return { diff: diffForPanel(), last: lastJudgeForPanel() };
            })(),
            // 「联系人」视图（只读 ✓）—— 预览模式下也换成样例，免得预览里只有真实数据 ✗
            //   而且跟推演记录一样**按人分**（多人预览要能看出差别 ✓）
            contacts: (() => {
                if (this.previewContactsFor) {
                    const k = this.previewActiveKey || state().active;
                    return this.previewContactsFor[k] || this.previewContacts || null;
                }
                if (this.previewContacts) return this.previewContacts;
                const subjNow = this.previewActiveKey || state().active;
                // ★ 换了正在看的那个对象 ⇒ 那份"展开过几页"的记账作废 ✓
                if (subjNow !== _ctSubject) { _ctSubject = subjNow; _ctMore = Object.create(null); }
                return contactsForPanel(subjNow, _ctMore);
            })(),
            // 「成就」频道 ——
            //   ⚠️ 它**不按对象分**（肯定是聊天）：谁解锁的都归这个聊天 ✓
            //   预览模式下换成样例，不然预览里那个频道永远是空的 ✗
            achievements: this.previewAchievements ?? achievementsForPanel(),
            // ★ 阶段插图 ——
            //   跟着"当前正在查看的那个对象"走（跟受孕记录 / 成就一个口径 ✓）
            //   预览模式下换成样例（不然预览里那块永远显示"普通的一天" ✗）
            stages: this.previewStages ?? stagesForPanel(),
            // ★ 「身体状态」频道（状态这一类里、概览下面那一页）——
            //   三条状态描述本来就在面板文字里，只有"痕迹这份"是插件算的 ⇒ 单独推过去 ✓
            //   （预览时用样例；多人预览按对象各一份，不然几个人长得一模一样 ✗）
            bodyState: (() => {
                if (this.previewBodyStateFor) {
                    const k = this.previewActiveKey || state().active;
                    return this.previewBodyStateFor[k] || this.previewBodyState || null;
                }
                if (this.previewBodyState) return this.previewBodyState;
                return bodyStateForPanel(state().active);
            })(),
            // ★ 「孩子」频道 ——
            //   跟成就一样**按聊天存**，但**看**是跟着"当前正在查看的那个对象"过滤 ✓
            //   （如果有好几个怀孕的人，还是老规矩 —— 跟着当前查看的人变，
            //     不要把所有孩子塞里面 ✓）
            // ★ 预览时给一份 `readonly`：样例孩子没有真实 id，面板照着它画一颗「改名」
            //   会点出一个"记录找不到"的错 ✗ ⇒ 让面板自己把那颗收起来 ✓
            children: this.previewChildren
                ? Object.assign({}, this.previewChildren, { readonly: true })
                : childrenForPanel(),
            // ★ 「日历」频道（写备注 / 圈红圈 / 有提醒那种）——
            //   外壳**把整页 HTML 算好**再推过去 ⇒ 面板里不重建一份日期引擎 ✓
            //   （翻月 / 点日子 / 切节日 / 关提示都走 postMessage 回来重算 ✓）
            calendar: (() => {
                try {
                    // ★★ 被排除的角色卡：日历按**现实日期**显示（2026-10-28 她定的）——
                    //   剧情日期是推演账本里的东西，这个卡里没有账本 ⇒ 传 `inChat=false`，
                    //   于是"今天 / 节日 / 月相"整块跟着现实日期走，不会一半现实一半剧情 ✓
                    const inChat = inChatPage() && !isCardExcluded();
                    // ★★ 换上下文（换聊天 / 进出聊天）⇒ 锚点清零（见上面 `_calCtx` 那段）✓
                    //   不然：你在"非聊天那份"翻到 2026 年 10 月，进聊天后数据源换成了剧情日历，
                    //   可月份/选区还停在 2026-10 ⇒ 看着就像**锚定在非聊天那份日历上** ✗
                    const ctxNow = String(rawChatId() || 'global') + '|' + (inChat ? 'chat' : 'real');
                    if (ctxNow !== _calCtx) {
                        _calCtx = ctxNow;
                        _calYM = null;
                        _calSel = null;
                        _calMode = 'default';
                    }
                    // ★ 这一屏读的是哪一份日程（下面所有写入都按它分流 ✓）
                    _calReal = !inChat;
                    // 顺手清掉"点了加一条又什么都没写"的空壳子
                    //   ⚠️ **正在编辑的那一天不碰**（别把人家正打字的行抽走 ✗）
                    try {
                        if (_calReal) pruneEmptyRealEvents(_calKeepKey());
                        else pruneEmptyCalendarEvents(_calKeepKey());
                    } catch { /* 忽略 */ }
                    const v = calendarViewHtml({
                        inChat, y: _calYM?.y, m: _calYM?.m, mode: _calMode, sel: _calSel,
                    });
                    _calYM = { y: v.y, m: v.m };
                    if (v.sel) _calSel = v.sel;      // 视图会把选区归一到"正在看的那个月" ✓
                    return { html: v.html, y: v.y, m: v.m, months: v.months, inChat: v.inChat, mode: v.mode };
                } catch (e) {
                    console.warn('[Bodycord] 拼日历失败', e);
                    return null;
                }
            })(),
        };
    }

    async mount() {
        if (this.iframe || this._destroyed) return;
        const tpl = await loadTemplate();
        // ⚠️ 这里有 await，期间面板**可能已经被换掉了**（_mountPanel 连着调用两次）。
        //   如果不检查就继续，被换掉的那个也会把 iframe 塞进同一个 host ——
        //   结果 host 里躺着两个 iframe：看到的那个和插件持有的那个不是同一个。
        //   症状就是「主题推了但界面不变」「骰子容器明明存在却说找不到」。
        if (this._destroyed || this.iframe) return;
        this._userName = this._currentUserName();
        this._avatar = pickAvatarForPanel();
        this._avatarScope = avatarScopeId();

        // ★ 面板一起来就会读它自己那几个键（随手记 / 敏感带备注 / 占卜台历史）——
        //   所以**必须**赶在 srcdoc 之前把插件数据灌进浏览器缓存 ✓
        //   （这一步里还包含"把老数据从浏览器搬进插件数据"的迁移 ✓）
        this._syncNotesBridge();

        const doc = buildDoc(tpl, this._payload());

        const iframe = document.createElement('iframe');
        iframe.className = 'bc-frame';
        iframe.setAttribute('title', 'Bodycord 状态面板');
        // ★ TauriTavern（TT）移动端：面板本体是个**同源 iframe**。
        //   ⚠️ 2026-10-31：这里原来声明 `data-tt-mobile-surface="viewport-host"`，
        //   但 TT 手机上出现了「面板里的字带一圈包边 / 发虚」而外壳的字是清楚的 ⇒
        //   怀疑 TT 对带这个声明的 iframe 做了视口缩放（缩放后再画 = 字发糊）。
        //   ⇒ 先摘掉这个声明做对照（它只影响 TT 桥进来的 --tt-inset-* 安全区变量，
        //     拿不到就退回 env(safe-area-inset-*)，不是坏，只是刘海避开少一层保险）。
        //   如果摘掉后字变清楚，就确认是这个声明引起的；届时改用别的办法拿安全区 ✓
        iframe.srcdoc = doc;
        // ⚠️⚠️ 一定用 `this.host()` 现取，**不要用构造时记下的 this.container**。
        //   外面（StatusView.render）会 clear 掉整个视图再重建一个 .bc-frame-host，
        //   而 mount() 是异步的 —— 等它醒过来时，构造时那个 host 早就被换掉、
        //   已经不在文档里了 ⇒ iframe 被塞进一个"死"容器 ⇒ **面板一片空白** ✗。
        //   （症状：面板只有一条黄条、底下全白。）
        this.host().appendChild(iframe);
        this.iframe = iframe;
        // 刚挂上时 contentWindow 可能还没就绪，挂个 load 兜底
        if (!this._themeBound) {
            this._themeBound = true;
            iframe.addEventListener('load', () => { this._loaded = true; this._pushTheme(); });
            // ★ 面板**就绪时补推一次完整 payload** ——
            //   之前第一次 push 可能赶在 iframe 里的脚本还没定义好之前（那条消息就丢了），
            //   而 load 里只补了主题 ⇒ 面板会一直停在"空/上一次"的样子 ✗
            //   （"预览的单人模式一直没有数据"就是这一类时序洞 ✓）
            iframe.addEventListener('load', () => { try { this.update(); } catch { /* 忽略 */ } });
        }
        this._pushTheme();
        this._applyPending();
    }

    /**
     * 把已经建好的 iframe 挪进一个新的容器。
     *
     * 用于「宿主 DOM 被重建了，但面板本身要活着」的场景（保住 iframe 里正在放的音乐）。
     * 同一个 iframe 元素重新 append **不会重新加载**，音乐继续放 ✓；
     * 千万**不要**在这里 destroy + 重建，那音乐就断了。
     *
     * @returns {boolean} 是否真的搬了（false = 面板还没建好 iframe，调用方自己处理）
     */
    remountInto(container) {
        this.container = container;
        if (!this.iframe) return false;
        if (this.iframe.parentNode !== container) container.appendChild(this.iframe);
        return true;
    }

    _applyPending() {
        if (!this._pending) return;
        const p = this._pending;
        this._pending = null;

        // 换了人设名就得整个重建，否则左下角名字不会变
        if (p.userName && p.userName !== this._userName) return this._rebuild(p);
        // ★ 换聊天了：面板自带那几样（随手记 / 敏感带备注 / 占卜台历史）要跟着换 ⇒
        //   先把**这个聊天**那份灌进浏览器缓存，再推标志和 __bodycordUpdate —
        //   顺序反了的话，面板会拿新聊天去读**上一个聊天**的键 ✗
        //   （跟下面那两条标志同一个道理 ✓）
        this._syncNotesBridge();
        try {
            // ⚠️⚠️ 顺序有讲究：这两个「状态标志」必须**先**推，再推 __bodycordUpdate。
            //   因为 __bodycordUpdate 会立刻触发面板 render()，而 render() 里要按
            //   「在不在聊天页」决定读哪一份随手记 —— 写反过一次：
            //   进聊天那一刻面板用的是**旧的** IN_CHAT_PAGE，读出来的还是全局那份 ✗
            //   （症状：点进去聊天之后还是显示全局那一份）
            this.iframe?.contentWindow?.__bodycordSetInChatPage?.(!!p.inChatPage);
            this.iframe?.contentWindow?.__bodycordSetInChat?.(!!p.inChat);
            // ★ 头像作用域必须在下一次重画之前切好（换聊天 / 进出聊天时面板不重建 iframe）
            this.iframe?.contentWindow?.__bodycordSetAvatarScope?.(p.avatarScope || 'nochat');
            // ★ 阶段插图也**必须赶在 __bodycordUpdate 之前**推：
            //   它画在「透视」频道那一页（不再画在概览），而 update 会立刻 render 一屏
            //   —— 推晚了会先看见一屏没有插图的旧画面，再闪一下补上 ✗（跟上面那两个标志同一个道理 ✓）
            this.iframe?.contentWindow?.__bodycordSetStages?.(p.stages || null);
            this.iframe?.contentWindow?.__bodycordUpdate?.(p.raw, p.chat, p.chatId, p.panelUpdateTs);
            // ★ 作用域一变，自动头像也要重新解析（聊天里＝锁定/连接的人设，非聊天＝默认人设）——
            //   面板这时可能还没有这个作用域的缓存，先把权威值推过去，免得停在默认图标 ✓
            const scopeChanged = (p.avatarScope || 'nochat') !== this._avatarScope;
            if (scopeChanged) {
                this._avatarScope = p.avatarScope || 'nochat';
                this._avatar = pickAvatarForPanel();
            }
            if (this._avatar) this.iframe?.contentWindow?.__bodycordSetAvatar?.(this._avatar);
            this.iframe?.contentWindow?.__bodycordSetIcons?.(p.iconCss || '');
        this.iframe?.contentWindow?.__bodycordSetConception?.(p.conception || null);
        this.iframe?.contentWindow?.__bodycordSetContacts?.(p.contacts || null);
        this.iframe?.contentWindow?.__bodycordSetJudgeLog?.(p.judgeLog || null);
        this.iframe?.contentWindow?.__bodycordSetAchievements?.(p.achievements || null);
        this.iframe?.contentWindow?.__bodycordSetChildren?.(p.children || null);
        this.iframe?.contentWindow?.__bodycordSetCalendar?.(p.calendar || null);
        this.iframe?.contentWindow?.__bodycordSetBodyState?.(p.bodyState || null);
            if (p.theme) this.setTheme(p.theme);
        if (p.vision) this.setVision(p.vision);
            // 双保险：万一面板那边那条 postMessage 没送到，
            // 每次刷新也顺手把骰子补挂上（不在骰子页时它是空操作）
            this._mountDiceInto();
        } catch (e) {
            console.warn('[Bodycord] 刷新面板失败，改为重建', e);
            this._rebuild(p);
        }
    }

    _rebuild(p) {
        if (!_tpl || !this.iframe) return;
        this._userName = p.userName;
        this._avatar = pickAvatarForPanel();
        this._avatarScope = p.avatarScope || avatarScopeId();
        // 重建面板 = 它要重新读一遍自己那几个键 ⇒ 先把插件数据灌进缓存 ✓
        this._syncNotesBridge();
        this.iframe.srcdoc = buildDoc(_tpl, { ...p, avatar: this._avatar });
    }

    /**
     * 面板自带那几样（随手记 / 敏感带备注 / 占卜台历史）在"插件数据"与"浏览器缓存"之间对齐一次。
     * 见文件上面那段说明：先灌回插件数据、再写回浏览器缓存（值一样就不写 ✓）。
     */
    _syncNotesBridge() {
        try { syncPanelNotesBridge(hostLS()); } catch (e) { console.warn('[Bodycord] 面板数据对齐失败', e); }
    }

    async update() {
        const p = this._payload();
        if (!this.iframe) { this._pending = p; return this.mount(); }
        this._pending = p;
        this._applyPending();
    }

    setTheme(theme) {
        this.theme = theme || 'light';
        this._pushTheme();
        // ⚠️ srcdoc 的 iframe 在 onload 之前 contentWindow 可能还没就绪，
        //   那时候推主题会**丢**，然后外壳换了色、里面还是旧的 —— 就是那个日夜模式 bug。
        //   所以在 load 之后再补一次，保证内外一致。
        if (this.iframe && !this._themeBound) {
            this._themeBound = true;
            this.iframe.addEventListener('load', () => { this._loaded = true; this._pushTheme(); });
            this.iframe.addEventListener('load', () => { try { this.update(); } catch { /* 忽略 */ } });
        }
    }

    /** 设置易读模式（normal / large） */
    setVision(v) {
        this.vision = (v === 'large') ? 'large' : 'normal';
        this._pushVision();
        // 跟主题同一个道理：srcdoc 的 iframe 在 onload 之前推会丢 ⇒ load 之后补一次 ✓
        if (this.iframe && !this._visionBound) {
            this._visionBound = true;
            this.iframe.addEventListener('load', () => { this._loaded = true; this._pushVision(); });
        }
    }

    /** 把易读模式推给 iframe（内部方法） */
    _pushVision() {
        const w = this.iframe?.contentWindow;
        if (!w) return;
        if (typeof w.__bodycordSetVision !== 'function') return;   // 还没 load，正常 ✓
        try { w.__bodycordSetVision(this.vision); } catch (e) { console.warn('[Bodycord] 推易读模式失败', e); }
    }

    /** 把当前主题推给 iframe（内部方法） */
    _pushTheme() {
        const w = this.iframe?.contentWindow;
        if (!w) return;
        if (typeof w.__bodycordSetTheme !== 'function') {
            // ⚠️ iframe 还没 load 的时候必然取不到这个函数 —— 那是正常的，
            //   别在这儿刷警告（会让人以为主题坏了）。只有**加载完之后**还取不到才值得报。
            if (this._loaded) console.warn('[Bodycord] iframe 已加载但取不到 __bodycordSetTheme，shim 可能没跑起来');
            return;
        }
        try { w.__bodycordSetTheme(this.theme); } catch (e) { console.warn('[Bodycord] 推主题失败', e); }
    }

    /**
     * 把面板里「临时弹出来的东西」收干净（外壳在关闭面板时调）。
     *
     * ⚠️ 为什么必须有：iframe **一直活着**（这是为了不打断音乐 ✓），
     *   所以里面展开过的菜单/弹窗在面板收起后仍然保持展开 ——
     *   再打开面板就还挂着 ✗。
     *   症状：点左下角头像、再直接关掉面板，
     *   再次打开时左下角那些切换状态还挂着 ✓
     */
    resetTransientUI() {
        try { this.iframe?.contentWindow?.__bodycordResetUI?.(); } catch { /* 忽略 */ }
    }

    /** 重新抓一次人设头像 */
    refreshAvatar() {
        const url = pickAvatarForPanel();
        if (!url || url === this._avatar) return;
        this._avatar = url;
        try { this.iframe?.contentWindow?.__bodycordSetAvatar?.(url); } catch { /* 忽略 */ }
    }

    getCurrentView() {
        try {
            const el = this.iframe?.contentWindow?.document?.querySelector('.channel-item.active');
            return el?.dataset?.view || 'overview';
        } catch { return null; }
    }
}
