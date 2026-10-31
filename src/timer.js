/**
 * 番茄钟 / 倒计时
 * ---------------------------------------------------------------------------
 * 需求：一个绑定现实时间、用来避免沉迷酒馆的计时器；全做、时长可自定义
 *   —— 理由是**玩和挂机不一样**，玩家会长时间挂后台 ✓
 *   ⇒ 所以这是个**完整的番茄钟**（工作 + 休息两档 + 今日轮数），不是单纯一个倒计时 ✓
 *
 * ⚠️ 这个模块**只管状态**（纯函数 + 一份 localStorage），不碰 DOM、不发通知 ——
 *   画界面 / 弹通知 / 挂小读数都在 `ui.js` 那边 ✓（分成两半是为了这个文件能被测试直接跑 ✓）
 *
 * ★ 两条设计上的硬要求（跟"挂机"这个用途绑死）：
 *   ① **按"到点时刻"算，不是每秒减一** —— 挂后台、电脑睡眠之后浏览器会把定时器降频，
 *      "每秒减一"累计起来会越来越不准 ✗；存 `endsAt` 的话，回来时一眼就知道
 *      "还差 12 分" 或 "已经过了 5 分钟"，一分不差 ✓
 *   ② **刷新页面不重置** —— 状态存在浏览器本地（和主题、折叠状态同一类），
 *      跟聊天无关、也不跟账号走（这个取舍是认过的：番茄钟本来就是"这一个人现在"的东西 ✓）
 *
 * ⚠️ 为什么不用 `chat_metadata`（插件别处存数据的路子）：那玩意儿是**按聊天**存的，
 *   换个聊天进度就没了；而挂机时可能根本没开聊天 ✗ ⇒ 这个场景就该用浏览器本地存储 ✓
 */

/** 状态存在这个键里（沿项目既有习惯：面板用的键都带 `bc_` 前缀 ✓）
 *  ⚠️ **不导出**：只有这个文件自己读它，导出会被"死导出"扫描抓出来 ✗
 *    （测试要钉这个键名的话，直接对着源码查字面量即可 ✓） */
const TIMER_KEY = 'bc_timer_v1';

/** 判定"是不是同一天"用**本机日期**（跟日历提醒那套账本一个口径 ✓） */
function todayStr(d) {
    const x = d instanceof Date ? d : new Date();
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

/** 读存档（坏了 / 第一次用 ⇒ 给一份空的；⚠️ 绝不让它抛出去 ✓） */
function loadRaw() {
    try {
        const s = localStorage.getItem(TIMER_KEY);
        if (!s) return null;
        const o = JSON.parse(s);
        return (o && typeof o === 'object') ? o : null;
    } catch { return null; }
}

function saveRaw(o) {
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(o)); } catch { /* 存不下就算了，功能照跑 ✓ */ }
}

/** 洗一遍读出来的东西（老存档 / 手改过的 / 字段缺失都能兜住 ✓） */
function normalizeTimer(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const num = (v, dflt, lo, hi) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return dflt;
        return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    const mode = (o.mode === 'rest') ? 'rest' : 'work';
    const running = !!o.running;
    const endsAt = num(o.endsAt, 0, 0, Number.MAX_SAFE_INTEGER);
    const pausedMs = num(o.pausedMs, 0, 0, 24 * 60 * 60 * 1000);
    // 今天转过几轮：**日子对不上就归零**（"今日轮数"不能跨天累计 ✓）
    const day = String(o.roundDay || '');
    const rounds = (day === todayStr()) ? num(o.rounds, 0, 0, 999) : 0;
    // 上一次"已经提醒过"的段落（防重弹）：段落换了就清掉 ✓
    const seg = String(o.seg || '');
    const alertedSeg = (String(o.alertedSeg || '') === seg) ? seg : '';
    // ★ `paused`＝"**真的暂停在一段中间**"（只有这种才该显示「继续」✓）
    //   ⚠️ 光看 `pausedMs > 0` 不够 —— **刚选完一段还没跑**也是 >0，
    //      那时候按钮该写「开始」✗（"它变成了继续按钮"就是它）
    const paused = !!o.paused && pausedMs > 0;
    return {
        v: 1,
        // ★ 单调序号：每次落盘 +1 ⇒ 用来判"盘上和手上哪份更新" ✓（老存档没有 ⇒ 0 ✓）
        seq: num(o.seq, 0, 0, Number.MAX_SAFE_INTEGER),
        mode,
        running: running && endsAt > 0,
        endsAt,
        pausedMs,
        paused,
        rounds,
        roundDay: day === todayStr() ? day : todayStr(),
        roundsAll: num(o.roundsAll, 0, 0, 999999),
        seg,
        alertedSeg,
    };
}

/** 现在这份状态 */
export function loadTimer() { return normalizeTimer(loadRaw()); }

/** 存回去（顺手再洗一遍，避免把脏数据写进去 ✓；**序号 +1** —— 它是"谁更新"的唯一凭据 ✓） */
export function saveTimer(state) {
    const prev = normalizeTimer(loadRaw());
    const n = normalizeTimer(state);
    n.seq = Math.max(Number(prev.seq) || 0, Number(n.seq) || 0) + 1;
    saveRaw(n);
    return n;
}

/**
 * 一段的时长（分钟 ⇒ 毫秒）。
 * 参数来自设置页那两格（工作 / 休息），取不到就退回出厂 25 / 5 ✓
 */
function timerSegmentMs(state, cfg) {
    const s = normalizeTimer(state);
    const c = cfg || {};
    const mins = (s.mode === 'rest') ? c.rest : c.work;
    const n = Number(mins);
    const safe = Number.isFinite(n) ? Math.max(1, Math.min(600, Math.round(n))) : (s.mode === 'rest' ? 5 : 25);
    return safe * 60 * 1000;
}

/**
 * 给界面看的一份读数。
 * `over` = 已经过点多久（≥0 的毫秒）⇒ 界面要能说"已经过了 5 分钟了"，不是默默归零 ✓
 */
export function timerView(state, cfg, now = Date.now()) {
    const s = normalizeTimer(state);
    const total = timerSegmentMs(s, cfg);
    // ⚠️ 修 BUG：`pausedMs === 0` 有两种意思（"还没碰过" / "暂停在 0 秒"）。
    //   只有**真的没碰过**（pausedMs 为 0 且没在跑）才退回"这一段该多长"；
    //   ⚠️ 写成「按 seg 判」的话 ⇒ 从没跑过时会把**刚选的 5 分钟**覆盖回默认的 25 分 ✗
    //      （点 5 分钟却看见 25:00 就是这个）
    const base = (s.running || s.pausedMs > 0) ? s.pausedMs : total;
    const remain = s.running ? (s.endsAt - now) : base;
    const over = remain < 0 ? -remain : 0;
    const shown = remain < 0 ? 0 : remain;
    return {
        mode: s.mode,
        running: s.running,
        remain: shown,
        over,
        total,
        pct: total > 0 ? Math.max(0, Math.min(1, 1 - shown / total)) : 0,
        rounds: s.rounds,
        roundsAll: s.roundsAll,
        // ★ `started`＝"有东西可接着跑"（按钮文案的**辅助**判据）
        //   ⚠️ 真正决定「继续」还是「开始」的是下面的 `paused`（暂停过才算"继续" ✓）
        started: s.running || s.pausedMs > 0,
        // ★ `paused`＝真的暂停在一段中间 ⇒ 按钮写「继续」；其余一律「开始」✓
        paused: s.paused,
        // ★ `picked`＝**这一段是玩家刚选好的**（快选 / 自定义 / 切档 / 重来）
        //   ⇒ 界面可以据此把"选好长度"和"开始跑"合成一步，别让玩家点两下 ✓
        picked: !s.running && s.pausedMs > 0,
        due: !!s.seg && remain <= 0,
    };
}

/** 开始（或继续）一段计时 */
export function timerStart(state, cfg, now = Date.now()) {
    const s = normalizeTimer(state);
    const total = timerSegmentMs(s, cfg);
    // ★ 跑多久＝**pausedMs 有值就用它**（它要么是"暂停后剩下的"，要么是"玩家刚选的那一段"），
    //   没值才用这一档的默认长度 ✓
    //   ⚠️⚠️ 这里千万别拿 `seg` / `paused` 决定用哪个数 —— 这一处连错过两次：
    //      ① 看 seg ⇒ `setMinutes` 清了 seg，玩家刚选的 5 分钟被丢掉、变回默认的 25 分 ✗
    //      ② 看 paused ⇒ `setMinutes` 也清了它，同样丢掉那 5 分钟 ✗
    //      判据只有一个："手上有没有一个明确的长度"（pausedMs）✓
    const left = s.pausedMs > 0 ? s.pausedMs : total;
    s.running = true;
    s.paused = false;
    s.endsAt = now + left;
    s.pausedMs = 0;
    s.seg = String(now);
    s.alertedSeg = '';
    return saveTimer(s);
}

/** 暂停（把"还剩多少"存进 pausedMs ⇒ 刷新之后接着跑 ✓） */
export function timerPause(state, now = Date.now()) {
    const s = normalizeTimer(state);
    if (!s.running) return saveTimer(s);
    s.pausedMs = Math.max(0, s.endsAt - now);
    s.paused = true;               // ⇒ 按钮显示「继续」✓
    s.running = false;
    s.endsAt = 0;
    return saveTimer(s);
}

/** 重来（回到这一段的开头，停着）—— 就是"用这一段的长度重新设一次" ✓ */
export function timerReset(state, cfg) {
    return timerSetMinutes(state, timerSegmentMs(normalizeTimer(state), cfg) / 60000);
}

/**
 * ★★ 彻底清空（刷新后番茄钟仍在走这件事，做成选项 ✓）
 *   跟 `timerReset` 不一样：**那个是"重来一段"（还会留着长度 ⇒ 球还在）**，
 *   这个是**真的当没跑过** —— running / pausedMs / seg 全清 ⇒ **球也不会出现** ✓
 */
export function timerClear() {
    return saveTimer(normalizeTimer(null));
}

/** 切「工作 / 休息」（切了就停着，等玩家自己点开始 —— 不自动开跑 ✓） */
export function timerSetMode(state, mode, cfg) {
    const s = freshest(normalizeTimer(loadRaw()), normalizeTimer(state));
    s.mode = (mode === 'rest') ? 'rest' : 'work';
    s.running = false;
    s.endsAt = 0;
    // ⚠️ 切档之后该显示**新那一档的默认长度**（不是旧档剩下的时间）⇒ 用"没跑过"那份，
    //   让 timerView 去读设置里那一格 ✓
    s.pausedMs = 0;
    s.paused = false;
    s.seg = '';
    s.alertedSeg = '';
    return saveTimer(s);
}

/**
 * ★ 取"**最新那份**"状态
 *
 * 外壳手上有个 `timerState` 缓存，但**它可能落后一步**（比如刚 `timerTick` 完还没落盘、
 * 或者别的路径已经写过盘了）。凡是"改长度 / 切档"这种**要基于当前进度算**的操作，
 * 都必须以**更新的那份**为准 ✓
 *
 * 怎么判"更新"：每次存盘都 +1 的**单调序号 `seq`**（⚠️ 别用时间戳 —— 同一毫秒内两次写
 * 分不出先后，那就又会算歪 ✗）。两边都没有 seq（老存档）就退回"盘上那份" ✓
 */
function freshest(disk, mem) {
    const a = (disk && typeof disk.seq === 'number') ? disk.seq : -1;
    const b = (mem && typeof mem.seq === 'number') ? mem.seq : -1;
    if (b > a) return mem;
    if (a > b) return disk;
    return mem || disk || normalizeTimer(null);
}

/** 直接设成本次时长（快选那几颗 / 自定义分钟数都走它）
 *
 *  ★★ 真 BUG：点悬停高光外面，计时就直接暂停了 ——
 *     看着像"点别处就暂停"，其实真凶是**这个函数**：
 *     给"设长度"写了 `s.running = false`（想的是"设完等玩家按开始"），
 *     可**自定义分钟数那一格是"填了就自动设"**（不用再点按钮 ✓）
 *     ⇒ 只要在**计时跑着的时候**碰一下那一格（打字 / 失焦都会），
 *       就把正在跑的计时**打断了** ⇒ 看着就是"莫名其妙暂停了" ✗
 *
 *  ⇒ 定稿规矩：**设长度只管长度，不许动"跑没跑"** ✓
 *     · 停着 ⇒ 设完还是停着（等玩家按开始 ✓，跟以前一样）
 *     · 跑着 ⇒ 按**新长度从头跑**（换了课时长就该按新的来，不是把计时停掉 ✓）
 */
export function timerSetMinutes(state, mins, now = Date.now()) {
    const s = freshest(normalizeTimer(loadRaw()), normalizeTimer(state));
    const n = Number(mins);
    const safe = Number.isFinite(n) ? Math.max(1, Math.min(600, Math.round(n))) : 25;
    const ms = safe * 60 * 1000;
    if (s.running) {
        // 跑着：留着 running，按新长度重算到点时刻 ✓（**绝不把它停掉** ✗）
        s.endsAt = now + ms;
        s.seg = String(now);        // 新的一段 ⇒ 防重复提醒那笔账也跟着重置 ✓
        s.alertedSeg = '';
        s.pausedMs = 0;
        s.paused = false;
        return saveTimer(s);
    }
    s.running = false;
    s.endsAt = 0;
    // ⚠️ 这里**必须给个非 0 的值** —— timerView 拿"pausedMs 为 0"当"还没碰过、用默认长度"，
    //   给 0 的话刚选的 5 分钟会被默认的 25 分钟盖掉 ✗（那个 BUG 的真根因）
    s.pausedMs = safe * 60 * 1000;
    s.paused = false;              // 刚选的这一段还没跑 ⇒ 按钮该写「开始」✓
    s.seg = '';
    s.alertedSeg = '';
    return saveTimer(s);
}

/**
 * ★ 到点了该怎么处理（**只算状态，不弹东西** ✓）
 *
 * 返回：
 *   · `{ fired: false }`  —— 还没到点 / 已经处理过了
 *   · `{ fired: true, mode, nextMode, rounds }` —— 刚过点
 *     `mode`＝刚结束的是哪一段，`nextMode`＝下一段该是哪档（界面拿它问"歇 5 分钟？"）
 *
 * ⚠️ **到点之后不自动开始下一段** —— 自动跳会抢走玩家的控制权（取舍：弹一句问一下 ✓）。
 *   所以这里把"停了 + 待选"的状态落盘，玩家点「再来一轮 / 歇一会儿」才真的开跑 ✓
 */
export function timerTick(state, cfg, now = Date.now()) {
    const s = normalizeTimer(state);
    if (!s.running) return { fired: false, state: s };
    if (s.endsAt > now) return { fired: false, state: s };
    if (s.alertedSeg && s.alertedSeg === s.seg) return { fired: false, state: s };
    const finished = s.mode;
    const wasWork = finished === 'work';
    s.running = false;
    // ⚠️ 停表这里有个坑：`endsAt = 0` 会让上面那条"已经过点"判定永远成立 ⇒ 每秒都再报一次 ✗
    //   所以把 endsAt 设成"这一刻"，让它不再属于"过点"；同时**保留 seg**，
    //   好让"这一段已经提醒过"（alertedSeg === seg）继续挡重复提醒 ✓
    s.endsAt = now;
    s.pausedMs = 0;                // 0 ⇒ 读数会显示"这一段完整的长度"，看着像"这一轮结束了" ✓
    s.paused = false;              // ⇒ 下一段按钮回到「开始」✓
    s.alertedSeg = s.seg;
    if (wasWork) {
        s.rounds += 1;
        s.roundsAll += 1;
        s.roundDay = todayStr(new Date(now));
    }
    return { fired: true, mode: finished, nextMode: wasWork ? 'rest' : 'work', rounds: s.rounds, state: s };
}

/** 给界面那份读数用的文案（面板与外壳都用同一套，别各写一份 ✓） */
export function fmtMs(ms) {
    const n = Math.max(0, Math.round(Number(ms) || 0));
    const total = Math.floor(n / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}
