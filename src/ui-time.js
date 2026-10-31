/**
 * ui-time.js —— 时光机
 *
 * 需求：只能改**最近五条**，但**所有历史**都能查看
 *   ⇒ 面板上要有个切时间的入口（时光机频道），列表按「序号 + 虚拟时间 + 现实时间」排 ✓
 *
 * 所以这里做三件事：
 *   ① 时间轴列表：序号 · 剧情时间（虚拟）· 现实时间 · 楼层
 *   ② 点一条 → **只读预览**那一轮的面板（按字段结构展开，不改任何东西）
 *   ③ 导出 / 导入 —— 导出用于留存，导入用于「翻旧账」的只读查看
 *
 * 明确的边界（用户确认过）：
 *   · 预览**不导入聊天**、不写聊天记录、不动插件状态
 *   · 只有**当前轮**可以改（就是「改数值」那个入口）
 *   · 导入进来的档案只读，看完关掉就没了（不落盘）
 */

import { h, clear, button, modal, askConfirm, textInput } from './dom.js';
import { getCtx } from './st.js';
import { shortRef, usedNameOf, usedResultOf } from './dice.js';
import { timeline, snapshots, state, diffForPanel, canRollbackTo, rollbackToFloor, rollbackUndoInfo, undoRollback, dropSnapshot, dropFloorCandidate, pruneOrphanCandidates, identOf, parseAliases, isImportedTarget, stripDateText } from './store.js';
import { parsePanelText, stripLeadLabels, judgeBtnSpec, judgeRowText, repaintFloors } from './ui-floors.js';
import { queueState, cancelRun } from './judge-queue.js';

// 当前打开的档案：'live' = 本聊天的真实快照；其它是导入进来的只读档案
let archive = null;   // { name, list: [...] } | null

const fmtReal = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** 当前要展示的时间轴 */
function currentList() {
    if (archive) return archive.list;
    return timeline();
}

/** 全部快照里的对象 key 汇总（导入的档案里可能有本聊天没有的对象） */
function rawKeysOf(entry) {
    return Object.keys(entry?.raw || {});
}

// ---------------------------------------------------------------------------
// 面板字段 → 好读的表格
// ---------------------------------------------------------------------------

const FIELD_ORDER = [
    '状态标题', '进度描述', '次要描述', '计算说明',
    '数据项一', '数据项二', '数据项三', '数据项四', '数据项五',
    '数据项六', '数据项七', '数据项八', '数据项九',
    '状态条一', '状态条二', '状态条三',
];

const FIELD_DESC = {
    状态标题: '标题', 进度描述: '阶段 / 进度', 次要描述: '时间 / 防护 / 风险', 计算说明: '计算过程',
    数据项一: '阶段基础率', 数据项二: '累计受孕率', 数据项三: '体质系数', 数据项四: '致孕方',
    数据项五: '意识状态', 数据项六: '胎儿状态', 数据项七: '泌乳状态', 数据项八: '生产次数',
    数据项九: '敏感带', 状态条一: '生理状态', 状态条二: '身体状况', 状态条三: '近期性行为',
};

/** 把面板文字渲染成只读的字段列表 */
function panelFields(raw, zonesDelta = '', stripDates = false) {
    const rows = parsePanelText(raw);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const box = h('div', { class: 'bc-tm-fields' });
    for (const key of FIELD_ORDER) {
        const val = byKey.get(key);
        if (val === undefined) continue;
        // ★ 乙-1（编号 28）：剥标签的规则跟楼层面板**共用同一条**（`stripLeadLabels`）——
        //   以前这里自己写"三段式取最后一段" ⇒ 次要描述被砍成只剩「近期风险：…」✗
        const shown = stripLeadLabels(key, val);
        // ★ 2026-10-26：从别的档「仅状态」导入的对象，日期属于另一条时间轴 ⇒ 整段不显示
        //   （跟楼层面板、面板、主 API 摘要同一个口径；这里以前漏了，时光机还挂着旧日期 ✗）
        const text = stripDates ? stripDateText(shown) : shown;
        box.appendChild(h('div', { class: 'bc-tm-field' },
            h('div', { class: 'bc-tm-field-k', text: FIELD_DESC[key] || key }),
            h('div', { class: 'bc-tm-field-v', text: text || '—' }),
        ));
    }
    // ★ 2026-10-16：敏感带「这一轮哪个部位加了几次」（插件算的，存在快照的 judge 里，
    //   不在面板文字里 ⇒ 单独传进来）；老快照没有就跳过 ✓
    if (zonesDelta) {
        box.appendChild(h('div', { class: 'bc-tm-field' },
            h('div', { class: 'bc-tm-field-k', text: '敏感带更新' }),
            h('div', { class: 'bc-tm-field-v', text: zonesDelta }),
        ));
    }
    if (!box.childElementCount) {
        box.appendChild(h('div', { class: 'bc-hint', text: '这一轮没有可解析的面板字段' }));
    }
    return box;
}

/** 生理监测那一块（period_profile）也显示出来 */
function periodFields(raw) {
    const out = h('div', { class: 'bc-tm-fields' });
    const m = String(raw || '').match(/<period_profile[^>]*>([\s\S]*?)<\/period_profile>/i);
    if (!m) return null;
    for (const line of m[1].split('\n')) {
        const mm = line.match(/^\s*([^:：]{1,12})\s*[:：]\s*(.*)$/);
        if (!mm) continue;
        out.appendChild(h('div', { class: 'bc-tm-field' },
            h('div', { class: 'bc-tm-field-k', text: mm[1] }),
            h('div', { class: 'bc-tm-field-v', text: mm[2].trim() || '—' }),
        ));
    }
    return out.childElementCount ? out : null;
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export function openTimeMachine({ onClose, onJudge, onDataChanged } = {}) {
    // ★ 2026-10-23：先清掉"没有快照的孤儿候选记录" —— 旧版撤销只删快照、没删候选记录，
    //   那一楼在时光机里已经看不到、点不掉了 ⇒ 这些残渣要插件自己清，不能指望她点 ✓
    try { pruneOrphanCandidates(); } catch { /* 忽略 */ }
    // ★ **每次打开都从"本聊天"开始** ——
    //   以前模块级 `archive` 一直留着 ⇒ 关窗再打开会停在上一次导入的档案上，
    //   而弹窗里明明写着"导入的档案只读，关掉就没了" ✗
    archive = null;
    let selected = null;      // 当前预览的条目
    let pickedKey = '';       // 多对象时看哪一个
    // ★ 2026-10-16（时光机里加一个楼层搜索跳转）——
    //   列表长了以后找某一楼很费眼 ⇒ 顶上给一个搜索框：填**楼层号**就只看那一楼；
    //   填**文字**就在快照内容（面板文字 / 剧情时间）里找 ✓ 清空就回到全部 ✓
    let query = '';

    /**
     * ★★ 账 / 快照改过之后，界面上所有在显示数据的地方都要跟着换（2026-10-17：
     *   撤销推演之后，联系人里还挂着已经被撤掉的那条记录 ✗）。
     *
     * 两半，缺一不可：
     *   · `repaintFloors()` —— 楼层面板那几块状态（它们只跟酒馆的消息事件重画）；
     *   · `onDataChanged()` —— **主面板**（联系人 / 受孕记录 / 身体状态 / 概览…）。
     *     主面板的数据是外壳算好推给 iframe 的，只在 `refreshAll()` 时推 ⇒
     *     时光机改完账不推的话，面板里还挂着已经撤掉的那条记录（数据其实是对的 ✗）。
     * ⚠️ 回调由 `ui.js` 递进来（`ui-time` 不许 import `ui.js`，会成模块环 ✗）。
     */
    const afterDataChanged = () => {
        try { repaintFloors(); } catch { /* 忽略 */ }
        try { onDataChanged?.(); } catch { /* 忽略 */ }
    };

    /** 过一遍当前搜索框（楼层号 / 关键词两条路 ✓） */
    const shownList = () => {
        const list = currentList();
        const q = String(query || '').trim();
        if (!q) return list;
        if (/^\d+$/.test(q)) {
            const n = Number(q);
            return list.filter((it) => Number(it.楼层) === n);
        }
        return list.filter((it) => String(it.raw ? JSON.stringify(it.raw) : '').includes(q)
            || String(it.剧情时间 || '').includes(q));
    };

    const listHost = h('div', { class: 'bc-tm-list' });
    const detailHost = h('div', { class: 'bc-tm-detail' });
    const headInfo = h('div', { class: 'bc-tm-info' });
    const statusHost = h('div', { class: 'bc-tm-status' });
    // ★ 2026-10-23（她截图报的：上一层的时光机里「撤销刚才那次回滚」看着像属于这一楼）——
    //   那是**全聊天**动作，挪到列表外面单独放，不跟选中的楼层绑在一起 ✓
    const globalHost = h('div', { class: 'bc-tm-global' });

    /** 聊天现在到第几楼（含玩家那条；拿不到就 -1） */
    const chatLastFloor = () => {
        try {
            const c = getCtx();
            return (c && Array.isArray(c.chat)) ? c.chat.length - 1 : -1;
        } catch { return -1; }
    };

    /**
     * ★★ 2026-10-23（她报：改完之后不能重推之前的楼层了）——
     *   推演认的"这一楼"不是聊天最后一条消息，而是**最近一条正文**（玩家刚发、还没回复的那条不算）。
     *   我一开始拿 `chat.length - 1` 当判据 ⇒ 她发了一条新消息（玩家层）之后，
     *   上一楼明明仍是"最近一条正文"、本来可以重推，却被我判成"你已经在下一层"藏掉了 ✗
     *   ⇒ 跟 judge 的 `safeLastMessageIndex()` 同一个口径：从后往前找第一条有字、不是玩家的消息 ✓
     */
    const lastSystemFloor = () => {
        try {
            const c = getCtx();
            const chat = (c && Array.isArray(c.chat)) ? c.chat : [];
            for (let i = chat.length - 1; i >= 0; i--) {
                const m = chat[i];
                if (!m || !String(m.mes || '').trim()) continue;
                if (m.is_user) continue;
                return i;
            }
            return -1;
        } catch { return -1; }
    };

    const drawList = () => {
        clear(listHost);
        const list = shownList();

        if (!list.length) {
            listHost.appendChild(h('div', { class: 'bc-tm-empty' },
                h('div', { text: String(query || '').trim() ? '没有匹配的记录' : (archive ? '这个档案里没有记录' : '还没有历史记录') }),
                h('div', { class: 'bc-hint', text: (String(query || '').trim() || archive) ? '' : '推演几轮之后这里就会长出来' }),
            ));
            return;
        }

        // 新的在上面，方便看最近的
        for (let i = list.length - 1; i >= 0; i--) {
            const it = list[i];
            // ★ **不能拿对象比** —— `timeline()` 每次都 map 出新对象
            //   （见 store.js 的 timeline()）⇒ `selected === it` 恒假 ⇒ 实时视图里点一行**永远不高亮** ✗
            //   （导入档案模式反而正常，因为那份 list 是同一批稳定对象）
            //   ⇒ 按「序号 + 现实时间」认同一条 ✓
            const isSel = !!selected && (it === selected || (it.序号 === selected.序号 && it.ts === selected.ts));
            const row = h('div', {
                class: 'bc-tm-row' + (isSel ? ' active' : ''),
                onclick: () => {
                    selected = it;
                    pickedKey = rawKeysOf(it)[0] || '';
                    drawList();
                    drawDetail();
                },
            },
                h('div', { class: 'bc-tm-no', text: `#${it.序号}` }),
                h('div', { class: 'bc-tm-when' },
                    h('div', { class: 'bc-tm-vt', text: it.剧情时间 || '（无剧情时间）' }),
                    // ★ 一层里有备选回复时标出"这是第几条候选的记录"
                    //   （「这几条的记录都应该存着」⇒ 时光机里同一楼会有好几条，得能分清 ✓）
                    h('div', { class: 'bc-tm-rt', text: `${fmtReal(it.ts)}　楼层 ${it.楼层 >= 0 ? it.楼层 : '—'}${it.候选 ? '　候选 ' + it.候选 : ''}` }),
                ),
            );
            listHost.appendChild(row);
        }
    };

    const drawDetail = () => {
        clear(detailHost);
        if (!selected) {
            // ★ 减密度：原来这里还有一句「这里是「只读」的，看完关掉就行」
            //   和文件末尾那条「🔒 历史是只读的」重复 ⇒ 删掉，只留"点左边任意一条" ✓
            detailHost.appendChild(h('div', { class: 'bc-tm-empty' },
                h('div', { text: '点左边任意一条，查看那一轮的面板' }),
            ));
            return;
        }

        const keys = rawKeysOf(selected);
        if (!keys.length) {
            detailHost.appendChild(h('div', { class: 'bc-hint', text: '这一轮没有面板数据' }));
            return;
        }
        if (!pickedKey || keys.indexOf(pickedKey) < 0) pickedKey = keys[0];

        detailHost.appendChild(h('div', { class: 'bc-tm-head' },
            h('div', { class: 'bc-tm-head-title', text: `#${selected.序号}　${selected.剧情时间 || '（无剧情时间）'}` }),
            h('div', { class: 'bc-tm-head-sub', text: `${fmtReal(selected.ts)}　·　${archive ? '导入的档案' : '本聊天记录'}` }),
        ));
        // ★ 2026-10-23（她报：上一层的时光机看着像在说当前这一楼）——
        //   把"这条记录是哪一楼、你现在在哪一楼"写在最上面，按钮就不会被误读 ✓
        try {
            if (!archive) {
                const fl = Number(selected.楼层);
                const sys = lastSystemFloor();
                const cur = chatLastFloor();
                if (Number.isFinite(fl) && fl >= 0) {
                    let where;
                    if (fl === sys) where = (cur === sys) ? '就是最近一条正文' : '就是最近一条正文（你发的新消息还没等到回复）';
                    else where = '你现在在第 ' + (cur >= 0 ? cur : '?') + ' 楼，最近一条正文在第 ' + (sys >= 0 ? sys : '?') + ' 楼';
                    detailHost.appendChild(h('div', { class: 'bc-hint', text: '这是第 ' + fl + ' 楼的记录（' + where + '）' }));
                }
            }
        } catch { /* 忽略 */ }
        // ★ 这个对象**现在**的标签——
        //   ⚠️ 明说"现在"，因为底下看的是历史那一刻的面板 ✓
        try {
            if (!archive && pickedKey) {
                const tg = parseAliases(identOf(pickedKey).tags);
                if (tg.length) {
                    detailHost.appendChild(h('div', { class: 'bc-tm-head-sub', text: '这个对象现在的标签：' + tg.join('、') }));
                }
            }
        } catch { /* 忽略 */ }

        if (keys.length > 1) {
            const tabs = h('div', { class: 'bc-tm-keys' });
            for (const k of keys) {
                tabs.appendChild(h('div', {
                    class: 'bc-tm-key' + (k === pickedKey ? ' active' : ''),
                    text: k,
                    onclick: () => { pickedKey = k; drawDetail(); },
                }));
            }
            detailHost.appendChild(tabs);
        }

        const raw = selected.raw[pickedKey] || '';
        detailHost.appendChild(panelFields(raw, selected.judge?.rep?.zonesDelta || '', isImportedTarget(pickedKey)));
        const per = periodFields(raw);
        if (per) {
            detailHost.appendChild(h('div', { class: 'bc-section-title', text: '生理监测' }));
            detailHost.appendChild(per);
        }

        // ★ 时光机里能回看更久以前的推演记录（只在这一页临时生效，
        //   退出去就回到现在的数据 ✓）
        //   ⇒ 就地算「这一楼和上一楼比，变了什么」（**默认折叠**，不占地方 ✓ 界面保持简洁 ✓）
        //   ⚠️ 只有"状态变化"这一半能给历史（"最近一次推演的骰子明细"只存了最近一份 ✗ 见记录）
        // ★ 时光机看的是**导入进来的那份**，而 `diffForPanel` 永远只比本聊天的快照 ⇒
        //   在档案视图里显示"这一楼变了什么"会拿本聊天第 N 层去比档案里的第 N 条，
        //   数字和楼层全对不上（还静默不报错 ✗）⇒ 档案视图干脆不比 ✓
        try {
            const idx = archive ? -1 : currentList().findIndex((x) => x.序号 === selected.序号 && x.ts === selected.ts);
            if (idx > 0) {
                const d = diffForPanel(idx, pickedKey);
                if (d && d.changes && d.changes.length) {
                    const det = document.createElement('details');
                    det.className = 'bc-tm-diff';
                    const sum = document.createElement('summary');
                    sum.textContent = `这一楼变了什么（${d.changes.length} 处，和上一楼比）`;
                    det.appendChild(sum);
                    for (const c of d.changes.slice(0, 24)) {
                        det.appendChild(h('div', { class: 'bc-tm-diff-row' },
                            h('span', { class: 'bc-tm-diff-k', text: c.label }),
                            h('span', { class: 'bc-tm-diff-v', text: String(c.from || '（无）') }),
                            h('span', { class: 'bc-tm-diff-arrow', text: '→' }),
                            h('span', { class: 'bc-tm-diff-v to', text: String(c.to || '（无）') }),
                        ));
                    }
                    // 明细（骰子那一半）历史没有 ⇒ 说清楚，别让人以为漏了 ✗
                    det.appendChild(h('div', { class: 'bc-hint', text: '这里只比"状态变化"；推演用的骰子明细只留最近一次 ✓' }));
                    detailHost.appendChild(det);
                }
            }
        } catch { /* 忽略 */ }

        // ★ B：每轮的推演明细（用了哪些骰子）—— 只从某一版起才有存 ✓
        //   老快照没有 ⇒ 不给"空的折叠块"，改成一句说明（免得以为漏了 ✗）
        //   ⚠️ 指出：这一块的标题是：用了几颗骰子，里面却答了一句剧情描述 ✗
        //     （当年把「AI 报了什么」也塞进这个折叠块里了）⇒ 两块**归的不是一件事**
        //     ⇒ 拆开：骰子归骰子、AI 报了什么单独一行 ✓
        try {
            const jd = selected.judge || null;
            if (jd && jd.used && jd.used.length) {
                const det2 = document.createElement('details');
                det2.className = 'bc-tm-diff';
                const sum2 = document.createElement('summary');
                sum2.textContent = '这一轮用了哪些骰子' + `（${jd.used.length} 个）`;
                det2.appendChild(sum2);
                for (const u of (jd.used || [])) {
                    // ★ 跟骰子页同一套短标签（`独立掷 1~7`），原句放进 title——
                    //   这一块比骰子页还窄，来源长句会直接换行 ✗
                    const refLong = String(u.ref || '');
                    const refShort = shortRef(u.ref);
                    det2.appendChild(h('div', { class: 'bc-tm-diff-row' },
                        h('span', { class: 'bc-tm-diff-k', text: usedNameOf(u) || '（用途未标）' }),
                        h('span', { class: 'bc-tm-diff-v to', text: String(u.value ?? '—') + (usedResultOf(u) ? `（${usedResultOf(u)}）` : '') }),
                        h('span', {
                            class: 'bc-tm-diff-arrow', text: refShort,
                            title: refLong && refLong !== refShort ? refLong : null,
                        }),
                    ));
                }
                detailHost.appendChild(det2);
            }
            if (jd && jd.rep && jd.rep.note) {
                detailHost.appendChild(h('div', { class: 'bc-hint', text: '这一轮 AI 报了什么：' + jd.rep.note }));
            }
        } catch { /* 忽略 */ }

        // ★★ **从这里重新开始**（真倒流）—— 放在"历史是只读的"那句上面 ✓
        //   ⚠️ 只用面板里**已有的** class（面板本体是冻结的，不许为它加新样式 ✗）
        //   ⚠️ 导入的档案跟当前数据无关 ⇒ 那一档不给按钮 ✓
        try {
            if (archive) {
                detailHost.appendChild(h('div', { class: 'bc-hint', text: '导入的档案只能看，回不到那时候' }));
            } else {
                const floor = Number(selected.楼层);
                const can = Number.isFinite(floor) && floor >= 0 && canRollbackTo(floor);
                const btn = button('从这里重新开始', () => doRollback(floor));
                btn.disabled = !can;
                btn.classList.toggle('bc-btn-off', !can);
                detailHost.appendChild(h('div', { class: 'bc-tm-keys' }, btn));
                detailHost.appendChild(h('div', { class: 'bc-hint', text: can
                    ? '回到第 ' + floor + ' 楼之前的状态：账 / 孩子 / 痕迹 / 判定一起退（正文不动）'
                    : '这一楼的状态没留着（那次的快照已经被挤掉了）' }));

                // ★★ 两颗（重新推演 ✗ —— 那入口原来
                //   只在设置页、还带三个前置条件 ⇒ 搬一份到玩家会找的地方 ✓）。
                //   ① 「重推这一楼」= 再跑一次推演 ⇒ 钥匙由 `ui.js` 递进来（`safeJudge`），
                //      **不在这里 import ui.js** —— 那会成模块环 ✗（这坑以前踩过）
                //   ② 「撤销这次推演」= 账整套退到这一楼之前（`rollbackToFloor` 现成 ✓）
                //      ＋ **把这条快照删掉**（不然时光机里留一条"已经被撤销的推演"，自相矛盾 ✗）
                //   ⚠️ 两颗**只对最新那一楼**开放：推演永远只对最后一楼有效，
                //      老楼要重推就得先把聊天退回去 ⇒ 那要动正文，红线 ✗
                try {
                    const list = currentList();
                    const last = list.length ? list[list.length - 1] : null;
                    // ★★ 2026-10-23（她报：上一层时这两颗还在）——
                    //   「重推 / 撤销」只对**你现在停留的那一楼**有意义：
                    //   判据除了"是最后一条快照"，还要"这一楼就是聊天当前的最后一楼" ✓
                    //   （以前只看最后一条快照 ⇒ 人已经到下一楼了，按钮还亮着，
                    //    点「重推这一楼」其实重推的是**新的最后一楼**，跟确认框写的不一致 ✗）
                    const curLast = lastSystemFloor();
                    const atCurrentFloor = (curLast < 0) ? true : (Number(floor) === Number(curLast));
                    const isLatest = !!last
                        && Number(last.楼层) === Number(selected.楼层)
                        && String(last.hash || '') === String(selected.hash || '')
                        && atCurrentFloor;
                    if (isLatest) {
                        const can = Number.isFinite(floor) && floor >= 0 && canRollbackTo(floor);
                        // ★★ 2026-10-31（她叠着点了「重推」再点「撤销」，把重推的结果也撤掉了）——
                        //   `重推这一楼` 本身就含一次回滚（退到这一楼之前再算）⇒ 重推之后的账
                        //   是"重新算出来的那一次"。此时再点「撤销这次推演」不是"只撤重推那半"，
                        //   而是**连这次结果一起撤掉**，退回产下之前（原来那份账也回不来）✗
                        //   ⇒ 判据：这一楼刚回滚过（`rollbackUndoInfo().floor` 就是这一楼）
                        //      ⇒ 弹窗里多写一段，别让人以为还有一份好的能捡回来 ✓
                        const redone = (() => {
                            try {
                                const u = rollbackUndoInfo();
                                return !!u && Number(u.floor) === Number(floor);
                            } catch { return false; }
                        })();
                        const acts = [];
                        if (typeof onJudge === 'function') {
                            acts.push(button('重推这一楼', async () => {
                                const yes = await askConfirm({
                                    title: '重推这一楼？',
                                    msg: '会先把上一次推演写下的东西整套撤掉（账本 / 孩子 / 痕迹 / 受精判定都退到这一楼之前），'
                                        + '再按现在的正文重算一遍。正文一个字不动。\n\n'
                                        + '推演前的那份现场留着，随时能「撤销刚才那次回滚」整套回来 ✓\n\n'
                                        + '最后一楼如果你自己刚发了言、还没等到正文，也照样能重推：读的是最近那一楼的正文，'
                                        + '新记录不会记在你那条发言上 ✓',
                                    okText: '重推',
                                    danger: can,
                                });
                                if (!yes) return;
                                // ★★ 2026-10-16（重新推演为什么不自动撤销之前的东西）——
                                //   重推的语义就是「**先撤销上一次推演的结果，再算一遍**」✓
                                //   （跟楼层那颗「推演这一楼」同一个语义；原来这里只 `onJudge()`
                                //    ⇒ 会把上一次的结果当起点**叠加**算一遍 ✗ ⇒ 假账撤不掉、还会越记越多 ✗）
                                if (can) {
                                    const r = rollbackToFloor(floor);
                                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                                    // 这一楼那条旧快照也删掉（新的一轮会再写一条 ✓ 不然同一楼挂两条 ✗）
                                    try { dropSnapshot(selected.楼层, selected.hash); } catch { /* 忽略 */ }
                                    // ★ 候选记录也一起清（不然"这一楼已经算过"会留着 ✗）
                                    try { dropFloorCandidate(selected.楼层, selected.hash); } catch { /* 忽略 */ }
                                    selected = null;
                                    redraw();
                                    afterDataChanged();
                                } else {
                                    // 回滚点被挤掉了 ⇒ 撤不掉上一次的结果，如实说一声再往前走 ✓
                                    window.toastr?.warning?.('这一楼的回滚点已经被挤掉了：这次重推撤不掉上一次的结果，会在现在这份账上再算一遍');
                                }
                                // ★ 重推**不走**"最后一楼必须是正文"那道闸
                                //   （快照落点已经改成"最后一个正文层"，见 judge.js 的 safeLastMessageIndex ✓）
                                onJudge({ allowNoSystemFloor: true });
                            }, { title: '先撤销上一次推演，再按现在的正文重算一遍' }));
                        }
                        acts.push(button('撤销这次推演', async () => {
                            if (!can) { window.toastr?.warning?.('这一楼的回滚点已经被挤掉了，撤不回去'); return; }
                            const yes = await askConfirm({
                                title: redone ? '撤销这次推演？（这一份是刚才重推算的）' : '撤销这次推演？',
                                msg: '会把插件的账整套退回第 ' + floor + ' 楼之前（账本 / 孩子 / 痕迹 / 受精判定 / 日期推进都跟着退），'
                                    + '并且把这条快照删掉。\n\n正文一个字都不动。'
                                    + (redone
                                        ? '\n\n这一楼的账是刚才重推算出来的。现在撤销会把重推的结果一起撤掉，退回到这一楼推演之前，上一次那份账也回不来。'
                                            + '\n\n点下面的「撤销刚才那次回滚」拿回的是重推之前那一份，不是这一次的结果。'
                                        : '\n\n刚撤完还能点「撤销刚才那次回滚」整套回来。'),
                                okText: redone ? '照样撤销' : '撤销这次推演',
                                danger: true,
                            });
                            if (!yes) return;
                            const r = rollbackToFloor(floor);
                            if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                            try { dropSnapshot(selected.楼层, selected.hash); } catch { /* 忽略 */ }
                            // ★ 候选记录也要删（只删快照的话，楼层/推演记录还显示"算过了" ✗）
                            try { dropFloorCandidate(selected.楼层, selected.hash); } catch { /* 忽略 */ }
                            window.toastr?.success?.(redone
                                ? '已撤销这次推演（重推的结果一起撤掉了；要拿回重推之前那一份，点「撤销刚才那次回滚」）'
                                : '已撤销这次推演（记录也删掉了；还能「撤销刚才那次回滚」整套回来）');
                            selected = null;
                            redraw();
                            afterDataChanged();
                        }, { title: can ? '把这套账退回去，并删掉这条快照' : '这一楼的回滚点已经没了' }));
                        detailHost.appendChild(h('div', { class: 'bc-tm-keys' }, ...acts));
                        detailHost.appendChild(h('div', { class: 'bc-hint', text: can
                            ? (redone
                                ? '「撤销这次推演」＝账退到这一楼之前 ＋ 删掉这条快照（正文不动）。这一楼刚重推过，撤销会把重推的结果一起撤掉'
                                : '「撤销这次推演」＝账退到这一楼之前 ＋ 删掉这条快照（正文不动）')
                            : '「撤销这次推演」现在不可用：这一楼的回滚点已经被挤掉了' }));
                    } else {
                        // ★★ 2026-10-23（她报：当前楼没记录、上一楼又不能推演）——
                        //   历史楼层**也给一条重推的路**：整套退回这一楼之前，再按这一楼的正文重算，
                        //   快照只记在这一楼（补推那条路 ✓）。不然人走到下一楼之后，这一楼就再也重推不了 ✗
                        const fl = Number(selected.楼层);
                        const sys = lastSystemFloor();
                        if (sys >= 0 && Number.isFinite(fl) && fl < sys) {
                            detailHost.appendChild(h('div', { class: 'bc-hint', text: '最近一条正文已经到第 ' + sys + ' 楼了；要重推这一楼，得先整套退回去再算（点下面这颗）' }));
                        }
                        const canHist = Number.isFinite(fl) && fl >= 0 && canRollbackTo(fl);
                        const alreadyBack = (() => {
                            try { return Number(state().lastRollbackFloor) === Number(fl); } catch { return false; }
                        })();
                        if (typeof onJudge === 'function') {
                            const b = button('重推这一楼', async () => {
                                const needBack = !alreadyBack;
                                if (needBack && !canHist) {
                                    window.toastr?.warning?.('这一楼的回滚点已经被挤掉了，撤不回那时候，也就没法整套重推');
                                    return;
                                }
                                const yes = await askConfirm({
                                    title: '重推第 ' + fl + ' 楼？',
                                    msg: (needBack
                                        ? '会先把插件的账整套退回第 ' + fl + ' 楼之前（账本 / 孩子 / 痕迹 / 判定都跟着退），'
                                        : '现在这份账已经退到第 ' + fl + ' 楼之前了，直接按这一楼的正文重算。\n\n会')
                                        + '按这一楼的正文重算一遍，快照只记在第 ' + fl + ' 楼。\n\n'
                                        + '正文一个字都不动；后面的楼层（如果有）不会被重算。\n\n'
                                        + (needBack ? '刚退完还能点上面那颗「撤销刚才那次回滚」整套回来。' : ''),
                                    okText: needBack ? '退回并重推' : '重推这一楼',
                                    danger: needBack,
                                });
                                if (!yes) return;
                                if (needBack) {
                                    const r = rollbackToFloor(fl);
                                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                                    selected = null;
                                    redraw();
                                    afterDataChanged();
                                }
                                // ★ 补推那条路：把楼层号递进去 ⇒ 只算这一楼、快照记这一楼 ✓
                                try { onJudge({ floor: fl, allowNoSystemFloor: true }); } catch { /* 钥匙那头自己会报错 */ }
                            }, { title: '退回这一楼之前（已经退过就不重复退），再按这一楼的正文重算一遍（只记这一楼）' });
                            b.disabled = !canHist && !alreadyBack;
                            b.classList.toggle('bc-btn-off', !canHist && !alreadyBack);
                            detailHost.appendChild(h('div', { class: 'bc-tm-keys' }, b));
                            detailHost.appendChild(h('div', { class: 'bc-hint', text: (alreadyBack
                                ? '这一楼已经退过了：点「重推这一楼」直接按这一楼的正文重算'
                                : '「重推这一楼」＝先整套退到这一楼之前，再按这一楼的正文重算（补推，只记这一楼；正文不动）') }));
                        } else {
                            detailHost.appendChild(h('div', { class: 'bc-hint', text: '重推 / 撤销只对最新那一楼开放（推演永远只对最后一楼有效）' }));
                        }
                    }
                } catch { /* 忽略 */ }
            }
        } catch { /* 忽略 */ }

        detailHost.appendChild(h('div', { class: 'bc-tm-lock', text: '🔒 历史不能改数值（想改回当前轮）；要整套退回去就用上面的「从这里重新开始」' }));
    };

    const drawHead = () => {
        clear(headInfo);
        const list = shownList();
        const withSub = list.filter((x) => x.剧情时间).length;
        // ★ 快照那两道保险丝（300 份 / 1.5 MB）超了是丢最旧，
        //   但原来只说"已满"、不说已经掉了几份 ⇒ 读数永远是"300 / 300" ✗ ⇒ 明说 ✓
        const cut = (() => { try { return Number(state().snapCut) || 0; } catch { return 0; } })();
        headInfo.appendChild(h('div', { class: 'bc-hint',
            // ★ 看导入的档案时**只报档案自己的条数** ——
            //   以前条数取自档案、而上限与"更早的清掉几份"取自本聊天 ⇒
            //   会显示「共 12 条（上限 300，已满）」这种自相矛盾的话 ✗
            text: `共 ${list.length} 条（` + (archive ? '导入的档案，按它自己的记录数' : `上限 ${snapshots().length >= 300 ? '300，已满' : '300'}`) + '）　'
                + `其中 ${withSub} 条有剧情时间　`
                + (!archive && cut > 0 ? `更早的 ${cut} 份已经被清掉　` : '')
                + (archive ? `📦 正在看导入的档案「${archive.name}」` : '📌 本聊天的记录') }));
    };

    // ★ 2026-10-23：全聊天动作（撤销刚才那次回滚）单独一行 —— 不跟选中的楼层绑在一起 ✓
    const paintGlobal = () => {
        clear(globalHost);
        try {
            if (archive) return;
            if (!rollbackUndoInfo()) return;
            globalHost.appendChild(h('div', { class: 'bc-tm-keys' },
                button('撤销刚才那次回滚', () => doUndoRollback(), {
                    title: '把最近一次「从这里重新开始」之前的那份账整套拿回来；跟左边选中的是哪一楼无关',
                })));
            globalHost.appendChild(h('div', { class: 'bc-hint', text: '（全聊天动作，跟左边选中的楼层无关）' }));
        } catch { /* 忽略 */ }
    };

    const redraw = () => { paintStatus(); paintGlobal(); drawHead(); drawList(); drawDetail(); };

    // ---- 推演状态（弹窗盖住了楼层那一行和气泡 ⇒ 这里自己报一档 ✓）----
    // ★★ 2026-10-16（时光机重新推演没有明显提醒）——
    //   判据跟别处共用 `queueState()`，词也用同一份 `judgeBtnSpec` / `judgeRowText`（不许各写一份 ✓）
    const paintStatus = () => {
        clear(statusHost);
        let st = '';
        try { st = queueState(); } catch { st = ''; }
        if (!st) return;
        const spec = judgeBtnSpec(st);
        statusHost.appendChild(h('div', { class: 'bc-tm-status-txt', text: judgeRowText(st) || '正在推演…' }));
        statusHost.appendChild(button(spec.label, () => {
            let r = { pending: false, running: false };
            try { r = cancelRun(); } catch { /* 忽略 */ }
            if (r.running) window.toastr?.info?.('这次推演已停止（一个字都不会写）');
            else if (r.pending) window.toastr?.info?.('排队中的那次推演已取消');
            paintStatus();
        }, { variant: 'danger', title: spec.title }));
    };
    // 弹窗开着的时候每秒问一次（外壳那个心跳管不到这个弹窗 ✓）；关窗就把定时器收掉 ✓
    const statusTimer = setInterval(() => { try { paintStatus(); } catch { /* 忽略 */ } }, 1000);

    // ---- 搜索框：楼层号 / 快照内容 ----
    const searchIn = textInput('', (v) => {
        query = v;
        drawHead();
        drawList();
    }, { placeholder: '搜楼层号，或搜快照里的内容（清空＝看全部）' });

    // ---- 真倒流：回到某一楼之前 ----
    // 那段经历要作废 ⇒
    //   整套退回去（账本 / 孩子 / 痕迹 / 判定），**正文一个字都不动**（红线 ✓）
    //   ⚠️ 破坏性操作 ⇒ 必须弹一次确认；并且**回滚前自动留一份保险**（能整套撤回来 ✓）
    const doRollback = async (floor) => {
        const yes = await askConfirm({
            title: '回到这一楼之前？',
            msg: '会把插件的账整套退回第 ' + floor + ' 楼之前：账本 / 孩子 / 痕迹 / 受精判定都会跟着退。\n\n'
                + '正文一个字都不动（聊天记录插件从来不碰）。\n\n'
                + '刚退完还能点「撤销刚才那次回滚」整套回来。',
            okText: '退回去',
            danger: true,
        });
        if (!yes) return;
        const r = rollbackToFloor(floor);
        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
        window.toastr?.success?.('已回到第 ' + floor + ' 楼之前');
        selected = null;
        redraw();
        afterDataChanged();
    };

    const doUndoRollback = () => {
        const r = undoRollback();
        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
        window.toastr?.success?.('已撤销刚才那次回滚');
        selected = null;
        redraw();
        afterDataChanged();
    };

    // ---- 工具条 ----
    // ★ 整个重画：导入档案之后要**当场**多出「退出档案」那一颗
    //   （原来只建一次 ⇒ 导完档案这一轮里根本没有回本聊天的出口，得关窗重开 ✗）
    const bar = h('div', { class: 'bc-tm-bar' });
    const drawBar = () => {
        clear(bar);
        bar.appendChild(button('🔄 刷新', () => redraw()));
        bar.appendChild(button('📤 导出全部', () => exportTimeline()));
        bar.appendChild(button('📥 导入档案…', () => importArchive((arc) => {
            archive = arc;
            selected = null;
            drawBar();
            redraw();
            window.toastr?.success?.(`已载入档案「${arc.name}」（只读，关掉就没了）`);
        })));
        if (archive) {
            bar.appendChild(button('✖ 退出档案，看本聊天', () => {
                archive = null;
                selected = null;
                drawBar();
                redraw();
            }));
        }
    };
    drawBar();

    redraw();

    modal({
        title: '🕰️ 时光机',
        onClose: () => { archive = null; clearInterval(statusTimer); onClose?.(); },
        width: 980,
        // ★ 减密度：这一窗的说明全进「？」（"改数值和时光机弹窗也需要改" ✓）
        //   ⇒ 页面上只留读数（共 N 条…）、空态、以及底部那条「历史是只读的」✓
        help: [
            '每一条 = 一次推演留下的快照。列表里「剧情时间」那一列是插件按剧情日期算的；剧情没给日期时，就用虚拟日历（从 1年01月01日 起算）接着推',
            '最多留 300 条，满了从最旧的开始丢',
            '追踪对象多、又跑得久的时候，还会按总大小再收一道（超了也从最旧的丢），免得聊天文件越存越钝',
            '这里只读：想改数值要回到当前轮，从悬浮球菜单里的「改数值」进',
            '「从这里重新开始」是真倒流用的（时间倒流、那段经历要作废）：把插件的账整套退回那一楼之前，账本 / 孩子 / 痕迹 / 受精判定都会跟着退，正文一个字都不动',
            '每跑一次推演留一份快照，最多留 300 条、总量满了就从最旧的开始丢；被丢掉的楼会灰着、点不了',
            '刚退回去还能点「撤销刚才那次回滚」整套回来；它是破坏性操作，所以点之前会弹一次确认',
            '只有「最近一条正文那一楼」才多两颗：「重推这一楼」＝先撤销上一次推演写的账（整套退到这一楼之前），再按现在的正文重算一遍；「撤销这次推演」＝把账退到这一楼之前，并把这条快照删掉（正文不动）。你刚发了新消息、AI 还没回复时，上一楼仍然算最近一条正文；等下一楼正文生成之后，这两颗才会收起来',
            '历史楼层也给了一颗「重推这一楼」：整套退回那一楼之前，再按那一楼的正文重算（补推，只记那一楼、后面的楼层不重算）；如果之前已经退过了，它就直接重算，不会退第二次',
            '「撤销刚才那次回滚」是全聊天动作（在顶部），跟左边选中哪一楼无关；它是破坏性操作，点之前会弹一次确认',
            '「导入档案」是拿来翻旧账的：只读，关掉窗口就没了，永远不会写进聊天记录',
            '「导出全部」连账本一起带走（内射明细 / 受精判定 / 逐胎锁定 / 历史归档），换设备或备份靠它',
            '「这一楼变了什么」只比状态变化；推演用的骰子明细只留最近一次',
            '上面的搜索框：填楼层号（比如 12）就只看那一楼的记录；填中文就在快照内容里找；清空回到全部',
        ],
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-tm' },
                bar,
                statusHost,
                globalHost,
                h('div', { class: 'bc-tm-search' }, searchIn),
                headInfo,
                h('div', { class: 'bc-tm-cols' }, listHost, detailHost),
            ));
        },
        onSave: () => true,      // 只读，没有保存动作
        saveText: '关闭',
        hideCancel: true,        // 只读视图，不需要「取消 / 保存」一对
    });
}

// ---------------------------------------------------------------------------
// 导出 / 导入
// ---------------------------------------------------------------------------

/** 导出成 JSON 文件。只导出快照，不含密钥等设置。 */
export function exportTimeline() {
    const list = timeline();
    if (!list.length) {
        window.toastr?.warning?.('还没有历史记录可导出');
        return;
    }
    const payload = {
        kind: 'bodycord-timeline',
        version: 2,
        exportedAt: Date.now(),
        count: list.length,
        entries: list.map((x) => ({
            序号: x.序号, ts: x.ts, 楼层: x.楼层, 剧情时间: x.剧情时间, 对象: x.对象, raw: x.raw,
            // ★ 这两个界面要用（列表那行「候选 N」、详情里「这一轮用了哪些骰子」）——
            //   导出不带它们 ⇒ 档案导回来那两处就永远空着（导出又是唯一的留存手段 ✗）
            候选: (x.候选 === undefined || x.候选 === null) ? null : Number(x.候选),
            judge: (x.judge && typeof x.judge === 'object') ? x.judge : null,
        })),
        // ★ 账本也一起塞进时光机的快照里 ✓
        //   ⇒ 快照里只有**渲染出来的面板文字**；账本（内射明细 / 受精判定 / 逐胎锁定 / 历史归档）
        //     存在 chat_metadata 里 ⇒ 不一起带，就会出现"以为备份了、其实没有" ✗
        //   ⚠️ 导入仍然**只读**（导入那套从来不写用户数据 ✓，这里也不破例）
        账本: (() => {
            try {
                const s = state();
                return {
                    insems: s.insems || [],                 // 每次内射 / 植入（谁 · 精子存活 · 中招）
                    pills: s.pills || [],                   // 事后避孕药（折算记账 ✓）
                    judgments: s.ovuJudgments || {},        // 受精判定（判定值 · 掷出 · 着床）
                    locks: s.impregnatorLocks || {},        // 逐胎致孕方锁定
                    archive: s.conceptionArchive || [],     // 历史归档（换周期 / 分娩收起的那几段）
                    // ★ 孩子 —— 专门叮嘱过：
                    //   「记得做一下时光机和数据转移（旧搬新窗口）之类的兼容」✓
                    children: s.children || [],
                };
            } catch { return null; }
        })(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    a.download = `bodycord-时光机-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    window.toastr?.success?.(`已导出 ${list.length} 条`);
}

/**
 * 导入一个档案用于**只读查看**。
 * 刻意不写进聊天记录 —— 明确要求：只是预览以前的东西，不是导入到聊天内。
 */
function importArchive(onDone) {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    // 用户点「取消」不会触发 change ⇒ 补一条 cancel，顺手把隐藏 input 收掉 ✓
    input.addEventListener('cancel', () => input.remove());
    input.addEventListener('change', async () => {
        const f = input.files?.[0];
        input.remove();
        if (!f) return;
        try {
            const text = await f.text();
            const data = JSON.parse(text);
            // ★ 先认"这是不是时光机档案" ——
            //   以前只看"有没有一个非空的 entries 数组"⇒ 随便一个带 entries 的 JSON 都会被当成档案、
            //   还提示"已载入"（内容全是 — ✗）
            if (data && !Array.isArray(data)) {
                const kind = String(data.kind || '');
                if (kind && kind !== 'bodycord-timeline') throw new Error('这不是时光机导出的档案');
            }
            const entries = Array.isArray(data) ? data : data?.entries;
            if (!Array.isArray(entries) || !entries.length) throw new Error('文件里没有记录');
            if (typeof entries[0] !== 'object' || entries[0] === null) throw new Error('文件里的记录格式不对');
            const list = entries.map((e, i) => ({
                序号: i + 1,
                ts: e.ts,
                楼层: e.楼层,
                剧情时间: e.剧情时间 || '',
                对象: e.对象 || '',
                raw: e.raw || {},
                // ★ 跟着导出一起带回来（老档案没这两个键 ⇒ 兜底 null ✓）
                候选: (e.候选 === undefined || e.候选 === null) ? null : Number(e.候选),
                judge: (e.judge && typeof e.judge === 'object') ? e.judge : null,
            }));
            onDone?.({ name: f.name, list });
        } catch (e) {
            console.warn('[Bodycord] 导入档案失败', e);
            window.toastr?.error?.('这个文件读不了：' + (e?.message || e));
        }
    });
    document.body.appendChild(input);
    input.click();
}

