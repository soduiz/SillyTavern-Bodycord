/**
 * archive.js —— 档案（两类：世界观档案 / 人物档案）
 *
 * 需求：提示词配置可以**存档 / 另存新档 / 导出** ✓
 *
 * **世界观档案** = 一份可命名、可切换、可导出的**提示词配置快照**，包含：
 *   · 每个模块的开关 + 被改过的文案
 *   · 自动门控的开关
 *   · 字段开关
 *   · 注入模板（状态块 / 沉浸补丁的抬头与格式）
 *
 * **人物档案** = 某一个追踪对象的一整套设定，装三块：
 *   · 基础信息（能不能怀孕 / 能不能让别人怀孕 / 是否为异种 / 能不能怀上异种）
 *   · 补丁（这个对象改过的模块文案 —— 里面嵌着他自己的数值）
 *   · 别名与备注
 *   ★ 只装**动过的**块，一块没动就不装；导入时**按块勾选**（默认全勾）✓
 *   （三块能任意组合带，但**列表只有一个** ✓）
 *
 * 刻意**不含**：API 配置、追踪对象名单、图标、界面偏好 —— 那些跟提示词无关，
 * 混进来会让「换个档案」变成「换掉整套设置」，太危险。
 *
 * 存在哪：settings().archives（跟着酒馆的扩展设置走，跟模块文案同一处）。
 *   ⚠️ 一份档案约 5-40KB（含被改过的文案），所以**导出功能是必须的** ——
 *   攒多了可以把不再用的导出去、然后删掉，别把扩展设置撑爆。
 *
 * ⚠️ 人物档案里的「补丁」**只有文案**：它存在哪（聊天 / 全局）不变 ——
 *   本人那份仍然全局、其他角色按聊天（见 store.js 顶部那段）✓
 */

import { settings, save, moduleTextRaw, isTextOverridden, setModuleText, moduleScope } from './settings.js';
import { MODULES } from './modules.js';
import { DEFAULT_TEMPLATES } from './prompt.js';
// ⚠️ 这个 import 列表里**不许夹注释** —— 有守卫按括号内容正则抓具名导入（夹注释会误判成"没导入" ✗）
import {
    isUserKey, bodyLockOf, setBodyLockField, identOf, setIdentField,
    BODY_LOCK_FIELDS, targetList, targetPatchBag,
    setTargetPatchText, findTargetByReportedName, USER_KEY,
    state, setZoneTextOf, setPeriodModeOf,
} from './store.js';

/** 一份世界观档案只抓这些字段 —— 别的都不碰 */
const ARCHIVE_KEYS = ['modules', 'gates', 'fields', 'injectTemplates'];

/** 两类档案 */
export const KIND_WORLD = 'world';
export const KIND_PERSON = 'person';

/**
 * 人物档案的三块内容（顺序 = 界面上勾选的顺序 ✓）
 * [id, 显示名, 说明]
 */
export const PERSON_BLOCKS = [
    ['body', '基础信息', '能不能怀孕 / 能不能让别人怀孕 / 是否为异种 / 能不能怀上异种'],
    ['patches', '补丁', '这个对象改过的补丁文案（里面嵌着他自己的数值）'],
    ['ident', '别名与备注', '还认哪些叫法 + 只给你自己看的备注'],
    // ★ 补的两块 —— "**换人设不自动跟，靠玩家自己存档**"之后：
    //   凡是**会跟人设串味**的东西都必须**能进档案**，否则那句"自己存档"是空的 ✗
    //   （原先只装上面三块 ⇒ 敏感带初始设定 / 周期模式档换人设后照样串、还没法换 ✓）
    ['zones', '敏感带初始设定', '你自己填的那份（部位 / 等级 / 累计刺激 / 备注）'],
    ['cycle', '周期模式档', '有月经 / 非月经 那一档（没定过 = 跟随默认，不装）'],
];

const key = () => 'archives';
const all = () => settings()[key()] || (settings()[key()] = {});


/** 生成一个不会撞的 id */
function newId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 深拷贝（结构化克隆不可用时退回 JSON） */
function clone(v) {
    try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

// ---------------------------------------------------------------------------
// 抓取 / 应用
// ---------------------------------------------------------------------------

/** 把当前设置里跟提示词有关的部分抽出来 */
/**
 * 把当前设置里跟提示词有关的部分抽出来。
 *
 * ★ 只保留**已经修改过**的内容，没改过的不保存。
 *   · modules[id].text —— 只在**真的和代码默认不一样**时才留
 *     （老档案里可能躺着"当时默认值的副本"，这里顺手清掉，
 *       否则以后改进默认文案时会被旧副本盖回去）
 *   · 开关（enabled / gates / fields）是玩家的选择，一律留
 *   · injectTemplates 里等于内置默认的键也去掉
 */
export function snapshotPromptConfig() {
    const s = settings();
    const out = {};
    for (const k of ARCHIVE_KEYS) {
        if (s[k] === undefined) continue;
        out[k] = clone(s[k]);
    }

    // ① 清掉「其实等于默认」的模块文案
    if (out.modules && typeof out.modules === 'object') {
        for (const [id, v] of Object.entries(out.modules)) {
            if (!v || typeof v !== 'object') continue;
            if (typeof v.text === 'string') {
                const def = MODULES.find(m => m.id === id)?.text ?? '';
                if (v.text === def) delete v.text;
            }
            // 空壳（既没开关也没文案）就别留
            if (!Object.keys(v).length) delete out.modules[id];
        }
    }

    // ② 注入模板里等于内置默认的键也去掉
    if (out.injectTemplates && typeof out.injectTemplates === 'object') {
        for (const [k, v] of Object.entries(out.injectTemplates)) {
            if (DEFAULT_TEMPLATES[k] !== undefined && String(v) === String(DEFAULT_TEMPLATES[k])) {
                delete out.injectTemplates[k];
            }
        }
    }
    return out;
}


/**
 * 把一份档案应用到当前设置。
 *
 * ⚠️ 是**整块替换**，不是合并 —— 否则上一份档案里开着的模块会漏进新的这份。
 *   替换前会先存一份「应用前」的快照供撤销。
 */
export function applyPromptConfig(data) {
    const s = settings();
    const before = snapshotPromptConfig();
    for (const k of ARCHIVE_KEYS) {
        if (data[k] === undefined) s[k] = {};
        else s[k] = clone(data[k]);
    }
    save();
    return before;
}

// ---------------------------------------------------------------------------
// 人物档案（某一个对象的一整套设定）
//
// 定的三条：
//   ① 装三块：基础信息 / 补丁 / 别名备注 ✓
//   ② **只装动过的**（没动过的块压根不装）—— 免得档案里拖着一堆"当时的默认值副本"，
//      以后改进默认文案时被旧副本盖回去 ✗
//   ③ 导入时**按块勾选**（默认全勾）⇒ 想只套基础信息、不动补丁就取消那个勾 ✓
//
// ⚠️ 「块」的语义 = **整块替换**：
//   档案里有这块 ⇒ 这块按档案原样套上（没记的项回到"未填 / 默认"）；
//   档案里没这块 ⇒ 一个字都不碰 ✓（这是"不会误盖"的保证 ✓）
// ---------------------------------------------------------------------------

/** 这个对象改过的补丁（moduleId -> 原文；只留人物级模块 ✓） */
export function personPatchesOf(targetKey) {
    const out = {};
    for (const m of MODULES) {
        if (moduleScope(m.id) !== 'target') continue;
        const ov = isTextOverridden(m.id, targetKey);
        if (ov !== 'target') continue;
        // ⚠️ 取**原文**（不替换 @@占位符）—— 不然会把"非月经模式"那一套措辞冻进档案 ✗
        const raw = moduleTextRaw(m.id, targetKey);
        if (raw && raw !== (MODULES.find(x => x.id === m.id)?.text ?? '')) out[m.id] = raw;
    }
    return out;
}

/**
 * 抓一个对象的三块（**只装动过的** ✓）。
 * @returns {{isUser:boolean, target:string, body?:object, patches?:object, ident?:object}}
 */
export function snapshotPerson(targetKey) {
    const data = {
        isUser: isUserKey(targetKey),
        target: isUserKey(targetKey) ? USER_KEY : String(targetKey),
    };
    // ① 基础信息：只收"填了的"（null = 未填 = 没动过 ✓）
    const lock = bodyLockOf(targetKey);
    const body = {};
    for (const f of BODY_LOCK_FIELDS) {
        if (lock[f] === true || lock[f] === false) body[f] = lock[f];
    }
    if (Object.keys(body).length) data.body = body;

    // ② 补丁：只收改过的
    const patches = personPatchesOf(targetKey);
    if (Object.keys(patches).length) data.patches = patches;

    // ③ 别名与备注：非空才收
    const idn = identOf(targetKey);
    const ident = {};
    if (String(idn.aliases || '').trim()) ident.aliases = String(idn.aliases);
    if (String(idn.tags || '').trim()) ident.tags = String(idn.tags);
    if (String(idn.note || '').trim()) ident.note = String(idn.note);
    if (Object.keys(ident).length) data.ident = ident;

    // ④ 敏感带初始设定：只收**自己那份**真的填过的 ✓
    const zt = ownZoneTextOf(targetKey);
    if (zt) data.zones = { text: zt };

    // ⑤ 周期模式档：没定过（= 跟随默认）就不装 ✓
    const cy = ownCycleModeOf(targetKey);
    if (cy) data.cycle = { mode: cy };

    return data;
}

/**
 * 这个人**自己那份**敏感带初始设定 —— **严格读**（不走 `zoneTextOf` 里那条
 * "老数据兜底回退" ⇒ 别人聊天里的旧文本不会被当成"他自己的"打进档案 ✓）
 */
function ownZoneTextOf(targetKey) {
    try {
        return isUserKey(targetKey)
            ? String(settings().userZonesText || '')
            : String(state().targets?.[targetKey]?.zonesText || '');
    } catch { return ''; }
}

/** 这个人**自己定过**的周期模式档（`''` = 跟随默认 ⇒ 不装 ✓） */
function ownCycleModeOf(targetKey) {
    try {
        const v = isUserKey(targetKey)
            ? settings().userCycleMode
            : state().targets?.[targetKey]?.cycleMode;
        return (v === 'none' || v === 'normal' || v === 'amenorrhea') ? v : '';
    } catch { return ''; }
}

/** 这份人物档案里装了哪几块 */
export function personBlocksOf(a) {
    const d = a?.data || {};
    const out = [];
    for (const [id] of PERSON_BLOCKS) {
        if (d[id] && typeof d[id] === 'object' && Object.keys(d[id]).length) out.push(id);
    }
    return out;
}

/** 块名（显示用）：`基础信息 + 补丁` */
export function personBlocksLabel(a) {
    const ids = personBlocksOf(a);
    if (!ids.length) return '空档案';
    return ids.map((id) => PERSON_BLOCKS.find(b => b[0] === id)?.[1] || id).join(' + ');
}

/**
 * 存一份人物档案。
 * @param {string} targetKey 哪个对象
 * @param {string} name 名字（导入时按它匹配 ✓）—— 本人那份建议用**当前人设名**（store 的 `userLabel()`）✓
 * @param {string} [note] 备注（只给你自己看）
 */
export function savePersonArchive(targetKey, name, note = '') {
    const n = String(name || '').trim();
    const nt = String(note || '').trim();
    if (!n) return { ok: false, error: '得给档案起个名字' };
    const data = snapshotPerson(targetKey);
    if (!personBlocksOf({ data }).length) {
        return { ok: false, error: '这个对象还没有可以存的东西（没填基础信息、没改过补丁、没有别名备注）' };
    }
    const m = all();
    if (Object.values(m).some((a) => sameArchive(a, KIND_PERSON, n, nt))) {
        return { ok: false, error: '已经有同名（同备注）的人物档案了' };
    }
    const id = newId();
    const now = Date.now();
    m[id] = { kind: KIND_PERSON, name: n, note: nt, createdAt: now, updatedAt: now, data };
    save();
    return { ok: true, id };
}

/** 用当前这个对象的状态覆盖某份人物档案 */
export function updatePersonArchive(id, targetKey) {
    const m = all();
    if (!m[id]) return { ok: false, error: '这个档案不存在' };
    const data = snapshotPerson(targetKey);
    if (!personBlocksOf({ data }).length) {
        return { ok: false, error: '这个对象现在什么都没有，覆盖会把档案清空' };
    }
    m[id].data = data;
    m[id].updatedAt = Date.now();
    save();
    return { ok: true };
}

/**
 * 把一份人物档案套到某个对象上（块级替换 ✓）。
 * @param {string[]} blocks 要套哪几块（不给 = 档案里有的全套 ✓）
 */
export function applyPersonArchive(id, targetKey, blocks) {
    const a = all()[id];
    if (!a || kindOf(a) !== KIND_PERSON) return { ok: false, error: '这个人物档案不存在' };
    const d = a.data || {};
    const has = personBlocksOf(a);
    const want = (Array.isArray(blocks) && blocks.length ? blocks : has).filter(b => has.includes(b));
    if (!want.length) return { ok: false, error: '这份档案里没有可套的内容' };

    if (want.includes('body')) {
        const b = d.body || {};
        // 整块替换：档案里没记的项一律回「未填」✓（不然会跟前一套人设的残留混在一起 ✗）
        for (const f of BODY_LOCK_FIELDS) setBodyLockField(targetKey, f, b[f] ?? null);
    }
    if (want.includes('ident')) {
        const i = d.ident || {};
        setIdentField(targetKey, 'aliases', String(i.aliases || ''));
        setIdentField(targetKey, 'tags', String(i.tags || ''));
        setIdentField(targetKey, 'note', String(i.note || ''));
    }
    if (want.includes('patches')) {
        const p = d.patches || {};
        // 整块替换：先把这个对象现在所有的专属补丁清掉，再把档案里的写进去 ✓
        for (const mid of Object.keys(targetPatchBag(targetKey))) setTargetPatchText(targetKey, mid, null);
        for (const [mid, text] of Object.entries(p)) {
            if (moduleScope(mid) !== 'target') continue;
            setModuleText(mid, String(text), targetKey);
        }
    }
    // ★ 补的两块（同样是**整块替换**：档案里是空 ⇒ 清空 ✓，
    //   不然会跟上一套人设的残留混在一起 ✗）
    if (want.includes('zones')) {
        setZoneTextOf(targetKey, String(d.zones?.text || ''));
    }
    if (want.includes('cycle')) {
        // ⚠️ 三档都要认（none / normal / amenorrhea）—— 少写一档就会把「无月经」静默降成
        //   "跟随全局默认"，而写入端 ownCycleModeOf 是三档都收的 ⇒ 存得下、套不回去 ✗
        //   （全程无提示）
        const m = d.cycle?.mode;
        setPeriodModeOf(targetKey, (m === 'none' || m === 'normal' || m === 'amenorrhea') ? m : '');
    }
    return { ok: true, blocks: want };
}

/**
 * 这份人物档案该套到当前聊天的谁身上？
 *
 * 匹配顺序：本人档案 ⇒ 本人；否则先比**别名表**、再比档案名 / key ✓
 * ⚠️ 只读查找，**绝不顺手建档** ✗（自动模式下会建出多余的人 ✓）
 * @returns {string|null} 对象 key
 */
export function findTargetForArchive(a) {
    if (!a) return null;
    if (a.data?.isUser) return USER_KEY;
    const want = String(a.name || '').trim();
    if (!want) return null;
    const hit = findTargetByReportedName(want);
    if (hit) return hit.key;
    const byKey = targetList().find(t => String(t.key) === want);
    return byKey ? byKey.key : null;
}

// ---------------------------------------------------------------------------
// 增删改查
// ---------------------------------------------------------------------------

/**
 * 档案在界面上的显示名：`名字（备注）`。
 *
 * ★ 档案存两个字段 —— **名字**（用于自动匹配/去重）
 *   和 **备注**（只给你自己看，显示时嵌在名字后面的括号里）✓
 *   ⚠️ 备注**不是数据**，不参与匹配、不改变档案内容，只是"这是哪一版"的说明 ✓
 *   ⇒ 所以别把备注塞进名字里存 ✗（那会让按名字匹配认不出来 ✓）
 */
export function archiveLabel(a) {
    const n = String(a?.name || '').trim();
    const nt = String(a?.note || '').trim();
    return nt ? `${n}（${nt}）` : n;
}

/** 种类 + 名字 + 备注 一起判重（名字一样、备注不同的两份是两份 ✓；世界观和人物同名的也不是一回事 ✓） */
function sameArchive(a, kind, name, note) {
    return kindOf(a) === kind
        && String(a?.name || '') === name && String(a?.note || '') === note;
}

export function listArchives(kind) {
    const m = all();
    const arr = Object.keys(m)
        .map((id) => ({ id, kind: kindOf(m[id]), ...m[id] }))
        // 两边都要用「updatedAt 优先、退回 createdAt」—— 原来左边取 updatedAt、
        // 右边只取 createdAt ⇒ 比较函数不自洽（交换不取反），顺序依浏览器实现而定 ✗
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return kind ? arr.filter((a) => a.kind === kind) : arr;
}

/** 老档案没有 kind 字段 ⇒ 一律当成世界观档案 ✓ */
export function kindOf(a) {
    return a && a.kind === KIND_PERSON ? KIND_PERSON : KIND_WORLD;
}

export function listWorldArchives() { return listArchives(KIND_WORLD); }
export function listPersonArchives() { return listArchives(KIND_PERSON); }

/**
 * 存一份新档案。
 * @param {string} name
 * @param {string} [note] 备注（只给你自己看，显示成「名字（备注）」）
 * @returns {{ok:boolean, id?:string, error?:string}}
 */
export function saveArchive(name, note = '') {
    const n = String(name || '').trim();
    const nt = String(note || '').trim();
    if (!n) return { ok: false, error: '得给档案起个名字' };
    const m = all();
    if (Object.values(m).some((a) => sameArchive(a, KIND_WORLD, n, nt))) {
        return { ok: false, error: '已经有同名（同备注）的档案了' };
    }
    const id = newId();
    const now = Date.now();
    m[id] = {
        kind: KIND_WORLD, name: n, note: nt, createdAt: now, updatedAt: now,
        data: snapshotPromptConfig(),
    };
    save();
    return { ok: true, id };
}

/** 用当前设置覆盖某个已有档案 */
export function updateArchive(id) {
    const m = all();
    if (!m[id]) return { ok: false, error: '这个档案不存在' };
    m[id].data = snapshotPromptConfig();
    m[id].updatedAt = Date.now();
    save();
    return { ok: true };
}

/**
 * 改名 / 改备注。
 * @param {string} name
 * @param {string} [note] 不传 ⇒ 备注保持不变 ✓
 */
export function renameArchive(id, name, note) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: '名字不能为空' };
    const m = all();
    if (!m[id]) return { ok: false, error: '这个档案不存在' };
    const nt = (note === undefined || note === null) ? String(m[id].note || '') : String(note).trim();
    if (Object.values(m).some((a) => a !== m[id] && sameArchive(a, kindOf(m[id]), n, nt))) {
        return { ok: false, error: '已经有同名（同备注）的档案了' };
    }
    m[id].name = n;
    m[id].note = nt;
    m[id].updatedAt = Date.now();
    save();
    return { ok: true };
}

export function deleteArchive(id) {
    const m = all();
    if (!m[id]) return { ok: false, error: '这个档案不存在' };
    delete m[id];
    save();
    return { ok: true };
}

export function getArchive(id) {
    const a = all()[id];
    return a ? { id, ...a } : null;
}

// ---------------------------------------------------------------------------
// 导入 / 导出
// ---------------------------------------------------------------------------

/**
 * 导出的文件结构（带 kind 标记，导入时好校验）。
 * ⚠️ 两类档案用**两个 kind** —— 导入时靠它认出"这是哪一类"（老文件只有
 *   `bodycord-prompt-archive`，一律当世界观档案 ✓）
 */
function packOne(a) {
    return {
        kind: kindOf(a) === KIND_PERSON ? 'bodycord-person-archive' : 'bodycord-prompt-archive',
        version: 1,
        name: a.name,
        // ★ 备注也一起带走 —— 不然导到别的聊天就认不出"这是哪一版"了
        note: String(a.note || ''),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        data: a.data,
    };
}

/** 打包成 JSON 文本 */
export function exportArchiveText(ids) {
    const m = all();
    const list = (ids && ids.length ? ids : Object.keys(m))
        .map((id) => m[id] && packOne({ ...m[id] }))
        .filter(Boolean);
    const payload = list.length === 1
        ? list[0]
        : { kind: 'bodycord-prompt-archive-pack', version: 1, archives: list };
    return JSON.stringify(payload, null, 2);
}

/** 触发浏览器下载 */
export function downloadArchive(ids, filename) {
    const text = exportArchiveText(ids);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    a.download = filename
        || `bodycord-提示词档案-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    return text.length;
}

/**
 * 把一段 JSON 文本解析成档案数组（不落盘，交给调用方决定怎么存）。
 * @returns {{ok:boolean, archives?:Array, error?:string}}
 */
export function parseArchiveText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
        return { ok: false, error: '不是合法的 JSON：' + (e?.message || e) };
    }
    let list = [];
    if (data?.kind === 'bodycord-prompt-archive' || data?.kind === 'bodycord-person-archive') list = [data];
    else if (data?.kind === 'bodycord-prompt-archive-pack' && Array.isArray(data.archives)) list = data.archives;
    else if (Array.isArray(data)) list = data;
    else if (data?.data && typeof data.data === 'object') list = [data];   // 宽容一点
    else return { ok: false, error: '这不像是档案文件（缺少 kind 标记）' };

    const out = [];
    for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        if (!a.data || typeof a.data !== 'object') continue;
        out.push({
            // ★ 人物档案：靠文件里的 kind 认出来；世界观（含老文件）当世界观 ✓
            kind: a.kind === 'bodycord-person-archive' ? KIND_PERSON : KIND_WORLD,
            name: String(a.name || '导入的档案').slice(0, 60),
            note: String(a.note || ''),
            createdAt: Number(a.createdAt) || Date.now(),
            updatedAt: Number(a.updatedAt) || Date.now(),
            data: a.data,
        });
    }
    if (!out.length) return { ok: false, error: '文件里没有可用的档案' };
    return { ok: true, archives: out };
}

/** 把解析好的档案存进设置（重名自动加「(导入)」后缀） */
export function importArchives(archives) {
    const m = all();
    // ⚠️ 判重把**种类**也算进去 —— 世界观和人物可以同名，那本来就是两份 ✓
    const keys = new Set(Object.values(m).map((a) => `${kindOf(a)}\u0000${a.name}\u0000${a.note || ''}`));
    const added = [];
    for (const a of archives || []) {
        const kind = a.kind === KIND_PERSON ? KIND_PERSON : KIND_WORLD;
        const nt = String(a.note || '');
        let n = a.name;
        // ⚠️ 判重要连备注一起算 —— 不然「名字一样、备注不同」的两份会被误加后缀 ✗
        while (keys.has(`${kind}\u0000${n}\u0000${nt}`)) n = n + '(导入)';
        const id = newId();
        m[id] = {
            kind, name: n, note: nt,
            createdAt: a.createdAt, updatedAt: a.updatedAt, data: clone(a.data),
        };
        keys.add(`${kind}\u0000${n}\u0000${nt}`);
        added.push({ id, kind, name: n, note: nt });
    }
    save();
    return added;
}

// ---------------------------------------------------------------------------
// 摘要（列表里显示，让人知道这份档案有什么）
// ---------------------------------------------------------------------------

export function summarize(data) {
    const d = data || {};
    const mods = d.modules || {};
    const on = MODULES.filter((m) => {
        const ov = mods[m.id];
        if (ov && typeof ov.enabled === 'boolean') return ov.enabled;
        return !!m.enabled;
    });
    const edited = Object.keys(mods).filter((k) => typeof mods[k]?.text === 'string' && mods[k].text).length;
    const gates = d.gates || {};
    const gatesOn = Object.keys(gates).filter((k) => gates[k]).length;
    let chars = 0;
    for (const m of MODULES) {
        const t = mods[m.id]?.text;
        chars += typeof t === 'string' && t ? t.length : (m.text || '').length;
    }
    return {
        模块: `${on.length} / ${MODULES.length} 个开着`,
        改过文案: edited ? `${edited} 个模块` : '无',
        自动门控: gatesOn ? `${gatesOn} 个开着` : '全关',
        总字数: `约 ${chars} 字`,
    };
}

/** 人物档案的摘要（列表里显示它装了什么 ✓） */
export function summarizePerson(a) {
    const ids = personBlocksOf(a);
    const d = a?.data || {};
    const out = {};
    if (ids.includes('body')) out['基础信息'] = Object.keys(d.body || {}).length + ' 项';
    if (ids.includes('patches')) out['补丁'] = Object.keys(d.patches || {}).length + ' 条';
    if (ids.includes('ident')) out['别名备注'] = '有';
    if (!Object.keys(out).length) out['内容'] = '空';
    return out;
}

/** 存档占用的空间（粗略） */
export function archiveBytes() {
    try { return JSON.stringify(all()).length; } catch { return 0; }
}
