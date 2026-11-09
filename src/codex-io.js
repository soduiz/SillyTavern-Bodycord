/**
 * codex-io.js —— 第八批：种族图鉴自己的导入导出
 *
 * 导什么：
 *   · 玩家**改过的内置条目**（覆盖快照，停用也在这里）
 *   · 玩家**自建的条目**
 *   · 内置条目原样不动 ⇒ 不重复导出（插件版本里本来就有）
 *
 * 导入怎么算（计划里定的口径：不覆盖、不吞）：
 *   · 编号在图鉴里没有        ⇒ 新增
 *   · 编号有、内容一模一样    ⇒ 跳过（不重复导入）
 *   · 编号有、内容不一样      ⇒ **冲突**，交给玩家逐条挑「保留我的 / 用文件里的」
 *
 * ⚠️ 只碰 `settings().codex`。角色绑定、聊天档案、日期、记录一个字都不动 ✓
 * ⚠️ 条目的规范化全靠 `codex-schema.js` 的 `normalizeEntry`，这里不另写一套 ✓
 */

import { normalizeEntry, VALUE_ROWS } from './codex-schema.js';
import { codexEntries, codexCfg, codexSave, codexIsEdited, isBuiltinCodexId } from './codex.js';

/** 导出文件的身份（跟时光机一样，先认这是谁的文件 ✓） */
export const CODEX_FILE_KIND = 'bodycord-codex';
export const CODEX_FILE_VERSION = 1;

const FIXED_ROW_KEYS = new Set(VALUE_ROWS.map((r) => r.key));

/**
 * 数值行的"内容"：只留真正存下来的值。
 * 固定项的名称 / 说明 / 单位 / 下拉选项都由当前版本代码给（`VALUE_ROWS`），
 * 比进文件里的话，插件改一句说明就会让所有老备份都误报「数值表不一样」✗
 * 自己加的项（x- 开头）有玩家自己写的名字，那个是内容，要带 ✓
 */
function snapshotRows(rows) {
    return (rows || []).map((r) => {
        const key = String(r?.key || '');
        if (FIXED_ROW_KEYS.has(key)) {
            const o = { key };
            if ('min' in r) o.min = r.min;
            if ('max' in r) o.max = r.max;
            if ('num' in r) o.num = r.num;
            if ('text' in r) o.text = r.text;
            return o;
        }
        return {
            key,
            label: String(r?.label || ''),
            kind: 'text',
            text: r?.text === null || r?.text === undefined ? '' : String(r.text),
        };
    });
}

/** 一条条目写成导出 / 比较用的快照（字段顺序固定，比较才稳定 ✓） */
export function codexSnapshot(entry) {
    const e = normalizeEntry(entry);
    return {
        id: e.id,
        name: e.name,
        aliases: e.aliases,
        cat: e.cat,
        species: e.species,
        source: e.source,
        status: e.status,
        intro: e.intro,
        physio: e.physio,
        repro: e.repro,
        extra: e.extra,
        borrowFrom: e.borrowFrom || '',
        // ★ 2026-11-08：性特征（雄 / 雌两块都跟着走 ✓）
        sexTrait: e.sexTrait,
        rows: snapshotRows(e.rows),
        stages: e.stages,
        notes: e.notes,
    };
}

function sameSnapshot(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** 冲突时告诉玩家「差在哪些项」（省得她一条一条对正文 ✓） */
const DIFF_LABELS = [
    ['name', '名字'],
    ['aliases', '别名'],
    ['cat', '分类'],
    ['species', '种类'],
    ['source', '来源'],
    ['status', '启停'],
    ['intro', '介绍'],
    ['physio', '生理'],
    ['repro', '繁殖受孕'],
    ['extra', '自由补充'],
    ['borrowFrom', '繁殖借用'],
    ['sexTrait', '性特征'],
    ['rows', '数值表'],
    ['stages', '发育段'],
    ['notes', '备注'],
];

export function codexDiffFields(a, b) {
    const out = [];
    for (const [key, label] of DIFF_LABELS) {
        if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) out.push(label);
    }
    return out;
}

/**
 * 导出内容：改过的内置 + 自建。
 * @returns {{kind:string, version:number, exportedAt:string, entries:object[]}}
 */
export function codexExportPayload() {
    const c = codexCfg();
    const entries = [];
    for (const id of Object.keys(c.overrides || {})) {
        const ov = c.overrides[id];
        if (!ov) continue;
        entries.push(codexSnapshot(ov));
    }
    for (const cu of c.custom || []) {
        if (!cu || !cu.id) continue;
        entries.push(codexSnapshot(cu));
    }
    return {
        kind: CODEX_FILE_KIND,
        version: CODEX_FILE_VERSION,
        exportedAt: new Date().toISOString(),
        entries,
    };
}

/** 导出成文件文字（界面下载用 ✓） */
export function codexExportText() {
    return JSON.stringify(codexExportPayload(), null, 2);
}

/**
 * 读一个导入文件。**先认身份、再验形状**，任何一处不对就明说哪里不对（不静默跳过 ✓）。
 * @returns {{entries:object[], version:number, kind:string}}
 */
export function parseCodexFile(text) {
    let data;
    try {
        data = JSON.parse(String(text ?? ''));
    } catch {
        throw new Error('这个文件不是 JSON，读不了');
    }

    let list;
    if (Array.isArray(data)) {
        list = data;
    } else {
        if (!data || typeof data !== 'object') throw new Error('文件里没有图鉴条目');
        if (data.kind && data.kind !== CODEX_FILE_KIND) throw new Error('这不是图鉴导出的文件');
        list = data.entries;
    }
    if (!Array.isArray(list)) throw new Error('文件里没有图鉴条目');
    if (!list.length) throw new Error('文件里没有图鉴条目');

    const seen = new Set();
    const entries = [];
    list.forEach((raw, i) => {
        const n = i + 1;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('第 ' + n + ' 条格式不对');
        const id = String(raw.id || '').trim();
        if (!id) throw new Error('第 ' + n + ' 条没有编号');
        if (seen.has(id)) throw new Error('文件里编号 ' + id + ' 出现了两次，没法判断该用哪一条');
        seen.add(id);
        const e = normalizeEntry({ ...raw, id });
        if (!e.name.trim()) throw new Error('第 ' + n + ' 条没有名字');
        entries.push(e);
    });

    return {
        entries,
        version: Number(data?.version) || 0,
        kind: String(data?.kind || ''),
    };
}

/**
 * 把文件里的条目跟现在的图鉴对一遍，分成三类。
 * @param {object[]} entries  parseCodexFile 出来的条目
 * @returns {{add:object[], same:object[], conflicts:object[]}}
 */
export function planCodexImport(entries) {
    const current = new Map(codexEntries().map((e) => [e.id, e]));
    const add = [];
    const same = [];
    const conflicts = [];

    for (const raw of entries || []) {
        const theirs = codexSnapshot(raw);
        const cur = current.get(theirs.id);
        if (!cur) {
            add.push(theirs);
            continue;
        }
        const mine = codexSnapshot(cur);
        if (sameSnapshot(mine, theirs)) {
            same.push(theirs);
            continue;
        }
        // ★ 这一条内置、而玩家**自己没改过**（没有覆盖）⇒ 本地没有"我的版本"可丢，
        //   直接用文件里那份（新装一份插件、再导入备份，编辑过的内置才会回到原样 ✓）。
        //   只有「我改过 / 我自建的」才叫冲突，才逐条问她 ✓
        // ★ 2026-11-08：判据改用「有没有覆盖」——只停用（内容没改）的那条也是玩家自己的状态，
        //   不能拿文件里的版本悄悄覆盖掉（否则导入一次，停用就被打开了 ✗）
        if (cur.builtin && !codexIsEdited(cur.id)) {
            add.push(theirs);
            continue;
        }
        conflicts.push({
            id: theirs.id,
            name: theirs.name || cur.name,
            diff: codexDiffFields(mine, theirs),
            mine,
            theirs,
            mineKind: cur.builtin ? (cur.edited ? '改过的内置' : '只改过启停的内置') : '自建',
        });
    }

    return { add, same, conflicts };
}

/**
 * 应用导入结果。
 * @param {object} plan     planCodexImport 的返回值
 * @param {object} picks    { [编号]: 'mine' | 'file' }；没写的冲突默认保留我的 ✓
 * @returns {{added:number, replaced:number, kept:number}}
 */
export function applyCodexImport(plan, picks = {}) {
    let added = 0;
    let replaced = 0;
    let kept = 0;

    for (const e of plan?.add || []) {
        codexSave(e);
        added++;
    }
    for (const c of plan?.conflicts || []) {
        if (picks[c.id] === 'file') {
            codexSave(c.theirs);
            replaced++;
        } else {
            kept++;
        }
    }
    return { added, replaced, kept };
}

/** 这个编号是不是内置条目（「用文件里的」会写成覆盖，不会变成自建 ✓） */
export function codexIsBuiltinId(id) {
    // ★ 2026-11-09：内置数据现在是用到才读进来的 ⇒ 统一问 codex.js（别在这儿直接读那个数组）
    return isBuiltinCodexId(id);
}
