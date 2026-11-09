/**
 * ui-wi-bind.js —— 「设定来源」（角色级世界书条目）＋「从世界书建角色」（2026-11-06 · 第七批）
 *
 * 这一份需求清单管着这里所有取舍：
 *   · 绑定清单**不铺在页面上** —— 人物页只留一行读数 ＋ 一颗「选…」，清单在弹窗里 ✓
 *   · 挑的是**具体条目**，不是整本书（一本书里可能只有一条是这个人的设定 ✓）
 *   · 弹窗里书要有搜索、条目也要有搜索；都分页（库里上百本，一次全摊会卡 ✓）
 *   · 排在最前的是**当前在用的那几本**（当前角色卡那本置顶），其余按名字排 ✓
 *   · 「从世界书建角色」：勾哪条建哪条，**不勾就什么都不发生**；建完可以整批撤销 ✓
 *   · **不自动扫世界书**（她 2026-11-06 点掉的）：页面上那行一个字都不读，玩家不点就不读；
 *     「疑似设定」只在打开挑选弹窗、点开某本书时，在已读到的条目上标一下（默认不自动绑）✓
 *
 * ⚠️ 这里只改插件自己的绑定关系，**绝不写世界书文件、也不动酒馆的勾选** ✓
 */

import { h, button, clear, modal, askConfirm, dropdown, scrollTopOf, setScrollTopOf } from './dom.js';
import { settings, save } from './settings.js';
import {
    state, commit, targetList, displayName, createTarget, removeTarget, identOf, parseAliases, USER_KEY,
    setTargetLight, setTrackMode,
} from './store.js';
import { getCtx } from './st.js';
import { allWiBookNames, bookEntries, currentBookNames, pinnedCharBooks } from './wi.js';
import {
    wiBindsOf, addWiBindOf, removeWiBindOf, wiBindKey, matchSettingEntries, readBoundEntries,
    cardDescOf, setCardDescOf,
} from './wi-bind.js';

const PAGE_BOOKS = 14;
const PAGE_ENTRIES = 20;

/** 分页切片（越界自动夹回来 ✓） */
function pageSlice(all, page, per) {
    const list = Array.isArray(all) ? all : [];
    const size = Math.max(1, Number(per) || 20);
    const total = Math.max(1, Math.ceil(list.length / size));
    const cur = Math.min(Math.max(1, Math.round(Number(page) || 1)), total);
    return { items: list.slice((cur - 1) * size, cur * size), cur, total };
}

/** 书名的排序权重：当前角色卡那几本 → 当前在用的 → 其他 */
function bookRank(name, pinned, inUse) {
    if (pinned.includes(name)) return 0;
    if (inUse.includes(name)) return 1;
    return 2;
}

/** 一次列出所有书 ＋ 某本书的条目（懒读，按需读那本 ✓）
 *  ★ 2026-11-06 她定的形态：条目要出现在**被展开的那本书下面**（不是整张列表的末尾 ✗）✓ */
function browser({ selected, mode, onToggle, scrollEl, suspect }) {
    const wrap = h('div');
    const bookHost = h('div');
    const _cache = new Map();     // 书名 -> 条目数组（只读它展开过的那本 ✓）
    let q = '';
    let page = 1;
    let open = '';
    let qe = '';
    let pageE = 1;

    // 书名搜索框放在会重画的那块外面（打字时输入框不失焦 ✓）
    const searchEl = h('input', {
        class: 'bc-input', value: q, placeholder: '搜索世界书名字…',
        oninput: (e) => { q = e.target.value; page = 1; paintBooks(); },
    });
    wrap.appendChild(h('div', { class: 'bc-row' }, searchEl));
    wrap.appendChild(bookHost);
    const keep = (fn) => {
        const el = scrollEl || wrap;
        const top = scrollTopOf(el);
        fn();
        setScrollTopOf(el, top);
    };
    function books() {
        const pinned = pinnedCharBooks();
        const inUse = currentBookNames();
        const all = allWiBookNames();
        const kw = q.trim().toLowerCase();
        const hit = all.filter((n) => !kw || String(n).toLowerCase().includes(kw));
        hit.sort((a, b) => {
            const ra = bookRank(a, pinned, inUse);
            const rb = bookRank(b, pinned, inUse);
            if (ra !== rb) return ra - rb;
            return String(a).localeCompare(String(b), 'zh');
        });
        return { list: hit, pinned, inUse };
    }

    function paintBooks() {
        clear(bookHost);
        const { list, pinned, inUse } = books();
        bookHost.appendChild(h('div', {
            class: 'bc-hint',
            text: '点一本展开它的条目，再点条目' + (mode === 'build' ? '勾选' : '绑定')
                + (suspect ? '；名字或别名对得上的会标「疑似设定」（只做提示，不自动绑）' : ''),
        }));
        const { items, cur, total } = pageSlice(list, page, PAGE_BOOKS);
        page = cur;
        if (!list.length) {
            bookHost.appendChild(h('div', { class: 'bc-empty', text: q.trim()
                ? '没有匹配的世界书'
                : '没读到世界书名单（回设置页 · 世界书那颗点一下「刷新」）' }));
            return;
        }
        for (const name of items) {
            const isOpen = open === name;
            const row = h('div', { class: 'bc-wi-book' },
                h('div', { class: 'bc-row' },
                    h('span', { class: 'bc-label', text: name }),
                    pinned.includes(name) ? h('span', { class: 'bc-badge', text: '当前角色卡' })
                        : (inUse.includes(name) ? h('span', { class: 'bc-badge', text: '在用' }) : null),
                    h('div', { class: 'bc-spacer' }),
                    button(isOpen ? '收起' : '展开条目', () => {
                        open = isOpen ? '' : name;
                        qe = ''; pageE = 1;
                        if (open) loadEntries(name);
                        keep(() => paintBooks());
                    }),
                ),
            );
            // ★ 条目就画在**这一本书下面**（跟着书走，不跑到列表末尾 ✓）
            if (isOpen) {
                const host = h('div', { class: 'bc-wi-entries' });
                row.appendChild(host);
                paintEntries(host, name);
            }
            bookHost.appendChild(row);
        }
        if (total > 1) {
            bookHost.appendChild(h('div', { class: 'bc-row' },
                button('上一页', () => { page = cur - 1; paintBooks(); }, { disabled: cur <= 1 }),
                h('span', { class: 'bc-hint', text: `第 ${cur} / ${total} 页（共 ${list.length} 本）` }),
                button('下一页', () => { page = cur + 1; paintBooks(); }, { disabled: cur >= total }),
            ));
        }
    }

    async function loadEntries(name) {
        if (_cache.has(name)) return;
        let list = [];
        try { list = await bookEntries(name); } catch { list = []; }
        _cache.set(name, list);
        if (open === name) keep(() => paintBooks());
    }

    function paintEntries(host, name) {
        clear(host);
        if (!_cache.has(name)) {
            host.appendChild(h('div', { class: 'bc-empty', text: '读取中…' }));
            return;
        }
        const all = _cache.get(name) || [];
        if (!all.length) {
            host.appendChild(h('div', { class: 'bc-empty', text: '这本书里没有条目' }));
            return;
        }
        const rows = h('div');
        host.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
            h('input', {
                class: 'bc-input', value: qe, placeholder: '搜索条目名…',
                oninput: (e) => { qe = e.target.value; pageE = 1; paintRows(); },
            }),
        ));
        host.appendChild(rows);

        function paintRows() {
            clear(rows);
            const kw = qe.trim().toLowerCase();
            const hit = all.filter((e) => !kw || String(e.title).toLowerCase().includes(kw));
            const { items, cur, total } = pageSlice(hit, pageE, PAGE_ENTRIES);
            pageE = cur;
            for (const e of items) {
                const item = { book: name, uid: String(e.uid), title: String(e.title || '') };
                const on = selected.has(wiBindKey(item));
                const sus = mode === 'bind' && !!suspect?.(item.title);
                if (mode === 'build') {
                    // ★ 她 2026-11-06 点掉的：选中之后**满行变蓝、字看不见** ✗
                    //   ⇒ 不再换底色，右边放一个勾选框（勾上就有 √）✓
                    //   ⚠️ 勾选框**自己画**，不用裸 <input type=checkbox>：
                    //     酒馆主题会把这个原生控件重新刷一遍样式，跟插件不是一套 ✓
                    rows.appendChild(h('div', {
                        class: 'bc-row bc-wi-pick',
                        onclick: () => { onToggle(item); paintRows(); },
                        title: on ? '点一下取消选择' : '点一下选中这一条',
                    },
                        h('span', { class: 'bc-label', text: item.title }),
                        h('span', { class: 'bc-hint', text: e.disable ? '酒馆里关着' : `${e.chars} 字` }),
                        h('div', { class: 'bc-spacer' }),
                        // 文字 ＋ 勾选框两样都给：颜色万一被她主题改掉，字也还在 ✓
                        on ? h('span', { class: 'bc-wi-tick', text: '已选' }) : null,
                        h('span', { class: 'bc-check' + (on ? ' on' : '') }),
                    ));
                    continue;
                }
                rows.appendChild(h('div', { class: 'bc-row bc-wi-pick' },
                    h('span', { class: 'bc-label', text: item.title }),
                    sus ? h('span', { class: 'bc-badge', text: '疑似设定' }) : null,
                    on ? h('span', { class: 'bc-badge', text: '已绑' }) : null,
                    h('span', { class: 'bc-hint', text: e.disable ? '酒馆里关着' : `${e.chars} 字` }),
                    h('div', { class: 'bc-spacer' }),
                    button(on ? '解除' : '绑定', () => { onToggle(item); paintRows(); }),
                ));
            }
            if (!items.length) rows.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的条目' }));
            if (total > 1) {
                rows.appendChild(h('div', { class: 'bc-row' },
                    button('上一页', () => { pageE = cur - 1; paintRows(); }, { disabled: cur <= 1 }),
                    h('span', { class: 'bc-hint', text: `第 ${cur} / ${total} 页（共 ${hit.length} 条）` }),
                    button('下一页', () => { pageE = cur + 1; paintRows(); }, { disabled: cur >= total }),
                ));
            }
        }
        paintRows();
    }

    paintBooks();
    return wrap;
}

const BIND_HELP = [
    '这里绑的是世界书里的具体条目，不是整本书；只存绑定关系、不存正文，所以你改了世界书，推演那轮立刻跟着变',
    '推演页「世界书（给推演看）」里那颗「带上角色绑定的世界书条目」打开之后，这个对象绑的条目每轮都会带上；默认关着，先绑再打开',
    '遗传判定那一轮不管那颗开关：先带受孕方和致孕方两边绑的条目；两边一条都没绑，才临时带一次整本世界书',
    '不绑也能用：推演照旧按「世界书（给推演看）」那几颗开关来，默认关着就不读，行为跟以前一样',
    '你在世界书编辑器里排除掉的条目仍然不会发给推演（排除表是全局的）',
    '「从世界书建角色」在设置 → 追踪 → 「追踪对象」那张卡里：勾哪条建哪条，建出来的角色会自动绑上那一条',
];

// ---------------------------------------------------------------------------
// ★ 2026-11-09（她提的：给角色绑一段角色描述，和绑定世界书是一类东西）——
//   · 绑的是**那张卡的角色描述那一段**，不是整张卡（性格、卡内嵌书都不带 ✓）
//   · 只存卡名，描述每次现取 ⇒ 她改卡立刻生效 ✓
//   · 入口两处：追踪那张卡里的「从角色卡建角色…」＋ 人物页「设定来源」里的「选…」
// ---------------------------------------------------------------------------

/** 全部角色卡（只读内存里的名单；只拿名字与描述字数，不读别的 ✓） */
function allCards() {
    try {
        const c = getCtx() || {};
        const list = Array.isArray(c.characters) ? c.characters : [];
        const out = [];
        for (const x of list) {
            const name = String(x?.name || '').trim();
            if (!name) continue;
            out.push({ name, chars: String(x?.description || '').length });
        }
        out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        return out;
    } catch { return []; }
}

/**
 * 选一张角色卡（单人）：点了立刻绑定，不保存也能反复换 ✓
 * @param {string} key 哪个对象
 */
export function openCardPicker(key, onDone) {
    return modal({
        title: '角色描述（选角色卡）',
        width: 720,
        saveText: '关闭',
        hideCancel: true,
        help: [
            '这里只取那张卡的「角色描述」这一段，性格和卡里内嵌的世界书都不带',
            '选好之后，推演页那颗「带角色卡的角色描述」打开时，这个人每轮都会带上这一段',
            '描述是每次现取的：你改了卡，下一轮就是新内容；卡删了就这个人的这一段暂时不发',
            '只在这个人在场时发；不在场的人一个字都不发',
        ],
        build: (body) => {
            const cur = h('div', { class: 'bc-param-sub' });
            const paint = () => {
                clear(cur);
                const name = cardDescOf(key);
                cur.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                    h('span', { text: name ? `现在用「${name}」的角色描述` : '现在没绑（推演不会带这个人的角色描述）' }),
                    h('div', { class: 'bc-spacer' }),
                    name ? button('解除', () => {
                        setCardDescOf(key, '');
                        paint();
                        try { onDone?.(); } catch { /* 忽略 */ }
                    }) : null,
                ));
            };
            body.appendChild(cur);
            paint();

            const q = h('input', { class: 'bc-input', placeholder: '搜索角色卡名字…' });
            const host = h('div');
            const list = allCards();
            const paintList = () => {
                clear(host);
                const kw = q.value.trim().toLowerCase();
                const hit = list.filter((x) => !kw || x.name.toLowerCase().includes(kw));
                if (!hit.length) {
                    host.appendChild(h('div', { class: 'bc-empty', text: list.length ? '没有匹配的角色卡' : '没读到角色卡' }));
                    return;
                }
                for (const c of hit) {
                    host.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                        h('span', { class: 'bc-label', text: c.name }),
                        h('span', { class: 'bc-hint', text: c.chars ? `角色描述 ${c.chars} 字` : '这张卡没有角色描述' }),
                        h('div', { class: 'bc-spacer' }),
                        button('用这张', () => {
                            setCardDescOf(key, c.name);
                            paint();
                            try { onDone?.(); } catch { /* 忽略 */ }
                        }),
                    ));
                }
            };
            q.addEventListener('input', paintList);
            body.appendChild(h('div', { class: 'bc-row' }, q));
            body.appendChild(host);
            paintList();
        },
    });
}

/**
 * 「从角色卡建角色」：勾哪张卡建哪个对象，建出来的自动绑上那张卡的角色描述 ✓
 * 跟「从世界书建角色」一个形状：不勾就什么都不发生；建完可以整批撤销 ✓
 */
export function openCardBuildTargets(onDone) {
    const sel = new Map();               // 卡名 -> {name, chars}
    const tier = { mode: 'light' };      // ★ 默认轻档（她 2026-11-09 定的）
    return modal({
        title: '从角色卡建角色',
        width: 760,
        saveText: '建角色',
        help: [
            '勾哪张卡建哪张：名字直接用卡名，建出来的对象自动绑上那张卡的角色描述',
            '只绑「角色描述」这一段，不绑整张卡；推演页那颗「带角色卡的角色描述」打开后才会每轮带上',
            '「建出来的档位」默认是轻档：只记名字和种族，不进推演、不占追踪名额；想正常追踪就在这一步选正式档',
            '同名对象已经存在就跳过，不会覆盖人家的数据',
            '建好之后「追踪对象」卡里会出现「整批撤销」，点一下把这一批删掉（删了就找不回来）',
            '随机刷出来的新角色不受这里影响，照旧走自动识别',
        ],
        build: (body) => {
            const status = h('div', { class: 'bc-param-sub' });
            const paintStatus = () => {
                status.textContent = sel.size
                    ? `已选 ${sel.size} 张卡（会建 ${sel.size} 个角色）`
                    : '还没选：勾下面的角色卡，一张都不勾就什么都不发生';
            };
            body.appendChild(status);
            // ★ 档位（默认轻档，别一建就把名单和数据都占了）
            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: '建出来的档位' }),
                dropdown(tier.mode, tierOptions(), (v) => { tier.mode = v; }),
                h('div', { class: 'bc-spacer' }),
            ));
            if (settings().targetMode === 'single') {
                body.appendChild(h('div', {
                    class: 'bc-hint',
                    text: '现在是单人追踪模式：建好的对象会出现在人物列表，但要回「追踪」页把名字填进名单才会参与推演',
                }));
            }
            const q = h('input', { class: 'bc-input', placeholder: '搜索角色卡名字…' });
            const host = h('div');
            const list = allCards();
            const paintList = () => {
                clear(host);
                const kw = q.value.trim().toLowerCase();
                const hit = list.filter((x) => !kw || x.name.toLowerCase().includes(kw));
                if (!hit.length) {
                    host.appendChild(h('div', { class: 'bc-empty', text: list.length ? '没有匹配的角色卡' : '没读到角色卡' }));
                    return;
                }
                for (const c of hit) {
                    const on = sel.has(c.name);
                    const exists = targetList().some((t) => String(t.key) === c.name);
                    host.appendChild(h('div', {
                        class: 'bc-row bc-row-wrap' + (on ? ' bc-wi-picked' : ''),
                        onclick: () => {
                            if (exists) return;
                            if (sel.has(c.name)) sel.delete(c.name); else sel.set(c.name, c);
                            paintStatus();
                            paintList();
                        },
                    },
                        h('span', { class: 'bc-label', text: c.name }),
                        exists ? h('span', { class: 'bc-badge', text: '已经有这个对象' }) : null,
                        h('span', { class: 'bc-hint', text: c.chars ? `角色描述 ${c.chars} 字` : '这张卡没有角色描述' }),
                    ));
                }
            };
            q.addEventListener('input', paintList);
            body.appendChild(h('div', { class: 'bc-row' }, q));
            body.appendChild(host);
            paintStatus();
            paintList();
        },
        onSave: () => {
            if (!sel.size) return false;
            const created = [];
            const skipped = [];
            const multi = settings().targetMode === 'multi';
            for (const name of sel.keys()) {
                if (targetList().some((t) => String(t.key) === name)) { skipped.push(name); continue; }
                let t = null;
                try { t = createTarget(name); } catch { t = null; }
                if (!t) { skipped.push(name); continue; }
                try { setCardDescOf(String(t.key), name); } catch { /* 绑定失败也不影响建档 */ }
                try { applyTier(String(t.key), tier.mode); } catch { /* 忽略 */ }
                created.push(String(t.key));
                if (multi && tier.mode === 'full') {
                    const names = settings().targetNames || [];
                    if (!names.includes(name)) settings().targetNames = [...names, name];
                }
            }
            if (multi) save();
            if (created.length) {
                state().cardBuild = { at: Date.now(), keys: created };
                commit();
            }
            console.log(`[Bodycord] 从角色卡建角色：新建 ${created.length} 个${skipped.length ? `，同名跳过 ${skipped.length} 个` : ''}`);
            try { onDone?.(true); } catch { /* 忽略 */ }
            return true;
        },
    });
}

// ---------------------------------------------------------------------------
// ★ 2026-11-09（她提的：建角色默认就成正式档会污染数据）——
//   「从世界书建角色」/「从角色卡建角色」都先问一句建出来是哪一档，**默认轻档** ✓
//   · 轻档：只记名字和种族，不进推演、不占追踪名额（想追再点「开始追踪」✓）
//   · 发情记录：只多追一本发情期；总开关关着时这一档不存在，不列出来 ✓
//   · 正式档：跟以前一样直接进名单
// ---------------------------------------------------------------------------
function tierOptions() {
    const opts = [['light', '轻档（只记名字和种族，不追）']];
    if (settings().estrusOn === true) opts.push(['estrus', '发情记录（只追发情期）']);
    opts.push(['full', '正式档（正常追踪）']);
    return opts;
}

/** 把刚建的这批对象设成选的档（轻档 / 发情记录只打标记，不写进名单 ✓） */
function applyTier(key, mode) {
    try {
        if (mode === 'full') return;
        if (mode === 'light') setTargetLight(key, true);
        else setTrackMode(key, mode, { manual: false });
    } catch { /* 档位没设上也别把对象丢了 */ }
}

/**
 * 人物页那行「设定来源」：只显示条数与「选…」——清单**不铺在页面上** ✓
 * @param {string} key 哪个对象
 * @param {(structural?:boolean)=>void} [onChange]
 */
export function wiBindRows(key, onChange = () => {}) {
    const box = h('div', { class: 'bc-field' },
        h('div', { class: 'bc-label', text: '设定来源（世界书条目）' }));
    const line = h('div', { class: 'bc-param-sub' });
    const btnPick = button('选…', () => openWiBindPicker(key, () => { paint(); try { onChange(false); } catch { /* 忽略 */ } }),
        { title: '从世界书里挑这个人的设定条目' });

    // ⚠️ 这里**一个字都不读世界书**（2026-11-06 她点掉的：玩家没打开就别自动扫）——
    //   只读绑定关系（纯本地数据）；要看条目、要检查条目还在不在，都等她点「选…」再读 ✓
    const paint = () => {
        clear(line);
        let list = [];
        try { list = wiBindsOf(key); } catch { list = []; }
        if (list.length) {
            line.appendChild(h('span', { text: `已绑 ${list.length} 条` }));
            line.appendChild(h('span', {
                class: 'bc-hint',
                text: '推演页那颗「带上角色绑定的世界书条目」打开后会每轮带上；遗传判定那一轮优先用它',
            }));
        } else {
            line.appendChild(h('span', { text: '没绑：推演照旧按「世界书（给推演看）」那几颗开关来（默认关＝不读）' }));
        }
    };

    box.appendChild(h('div', { class: 'bc-row bc-row-wrap' }, line, h('div', { class: 'bc-spacer' }), btnPick));
    paint();

    // ★ 2026-11-09：角色描述也能绑一张卡（跟世界书条目并列、各管各的 ✓）
    const cardLine = h('div', { class: 'bc-param-sub' });
    const paintCard = () => {
        clear(cardLine);
        let name = '';
        try { name = cardDescOf(key); } catch { name = ''; }
        if (name) {
            cardLine.appendChild(h('span', { text: `角色描述用「${name}」那张卡` }));
            cardLine.appendChild(h('span', {
                class: 'bc-hint',
                text: '推演页那颗「带角色卡的角色描述」打开后会每轮带上；只在这个人在场时发',
            }));
        } else {
            cardLine.appendChild(h('span', { text: '没绑角色描述（推演不会带这个人卡里的描述）' }));
        }
    };
    box.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '角色描述（来自角色卡）' }),
        cardLine,
        h('div', { class: 'bc-spacer' }),
        button('选…', () => openCardPicker(key, () => {
            paintCard();
            try { onChange(false); } catch { /* 忽略 */ }
        }), { title: '挑一张角色卡，只取它的角色描述那一段' }),
    ));
    paintCard();
    return box;
}

/** 这个对象的名字（本人取当前人设名；其余取名单里的显示名）—— 弹窗里标「疑似设定」用 */
function nameOfTarget(key) {
    try {
        if (key === USER_KEY) return String(getCtx()?.name1 || '').trim();
        return String(displayName(state().targets?.[key]) || '').trim();
    } catch { return ''; }
}

/** 这个对象有没有可以被当成「疑似设定」的名字 */
function suspectTester(key) {
    const name = nameOfTarget(key);
    let aliases = [];
    try { aliases = parseAliases(identOf(key).aliases); } catch { aliases = []; }
    if (!name && !aliases.length) return null;
    return (title) => matchSettingEntries([{ book: '', uid: '', title }], name, aliases).length > 0;
}

/**
 * 绑定弹窗：已绑的在上面（可解除），下面能搜索书 → 展开条目 → 绑定 ✓
 */
export function openWiBindPicker(key, onDone) {
    const sel = new Set(wiBindsOf(key).map(wiBindKey));
    const bound = wiBindsOf(key);
    return modal({
        title: '设定来源（世界书条目）',
        width: 760,
        saveText: '关闭',
        hideCancel: true,
        help: BIND_HELP,
        build: (body) => {
            const boundHost = h('div');
            const status = h('div', { class: 'bc-param-sub' });
            // ★ 只在**打开这个弹窗之后**才去读世界书（检查绑定的条目还在不在）✓
            //   卡片那行一个字都不读，玩家不点就不扫 ✓
            const missing = new Set();
            const paintBound = () => {
                clear(boundHost);
                const cur = [];
                for (const b of bound) {
                    if (sel.has(wiBindKey(b))) cur.push(b);
                }
                status.textContent = cur.length
                    ? `这个对象现在绑了 ${cur.length} 条`
                        + (missing.size ? `（其中 ${missing.size} 条在本机找不到，推演会跳过）` : '')
                    : '现在一条都没绑（推演照旧按「世界书（给推演看）」那几颗开关来）';
                if (!cur.length) return;
                boundHost.appendChild(h('div', { class: 'bc-section-title', text: '已绑的条目' }));
                for (const b of cur) {
                    boundHost.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                        h('span', { class: 'bc-label', text: b.title || `（第 ${b.uid} 条）` }),
                        h('span', { class: 'bc-hint', text: b.book }),
                        missing.has(wiBindKey(b)) ? h('span', { class: 'bc-badge', text: '找不到' }) : null,
                        h('div', { class: 'bc-spacer' }),
                        button('解除', () => {
                            removeWiBindOf(key, b.book, b.uid);
                            sel.delete(wiBindKey(b));
                            const i = bound.findIndex((x) => wiBindKey(x) === wiBindKey(b));
                            if (i >= 0) bound.splice(i, 1);
                            paintBound();
                            try { onDone?.(); } catch { /* 忽略 */ }
                        }),
                    ));
                }
            };

            body.appendChild(status);
            body.appendChild(boundHost);
            body.appendChild(h('div', { class: 'bc-field' },
                h('div', { class: 'bc-label', text: '添加：挑世界书里的条目' })));
            const suspect = (() => { try { return suspectTester(key); } catch { return null; } })();
            body.appendChild(browser({
                selected: sel,
                mode: 'bind',
                scrollEl: body,
                suspect,
                onToggle: (item) => {
                    if (sel.has(wiBindKey(item))) {
                        removeWiBindOf(key, item.book, item.uid);
                        sel.delete(wiBindKey(item));
                        const i = bound.findIndex((x) => wiBindKey(x) === wiBindKey(item));
                        if (i >= 0) bound.splice(i, 1);
                    } else {
                        addWiBindOf(key, item);
                        sel.add(wiBindKey(item));
                        bound.push(item);
                    }
                    paintBound();
                    try { onDone?.(); } catch { /* 忽略 */ }
                },
            }));
            paintBound();
            // 打开时顺手核一下：绑的书 / 条目还在不在（只读这几个书名，不扫别的 ✓）
            (async () => {
                try {
                    const r = await readBoundEntries(bound);
                    for (const m of r.missing || []) missing.add(wiBindKey(m));
                    if (missing.size) paintBound();
                } catch { /* 忽略 */ }
            })();
        },
    });
}

/**
 * 人物视图顶部那颗「从世界书建角色」：
 *   勾哪条建哪条；建出来的对象自动绑上那一条；不勾就什么都不发生 ✓
 *   建完记一批 key 到 `state().wiBuild`（人物视图那颗「整批撤销」读它 ✓）
 */
export function openWiBuildTargets(onDone) {
    const sel = new Map();           // key -> {book,uid,title}
    const selectedKeys = new Set();  // 给列表画"已选"用（跟 sel 同步 ✓）
    const tier = { mode: 'light' };  // ★ 默认轻档（她 2026-11-09 定的）
    return modal({
        title: '从世界书建角色',
        width: 800,
        saveText: '建角色',
        help: [
            '这条只做一件事：把世界书里的条目变成追踪对象（人物列表里的新人），并自动绑上那一条设定来源',
            '勾哪条建哪条；一条都不勾就什么都不发生',
            '「建出来的档位」默认是轻档：只记名字和种族，不进推演、不占追踪名额；想正常追踪就在这一步选正式档',
            '名字直接用条目名；同名对象已经存在就跳过，不会覆盖人家的数据',
            '建好之后「追踪对象」卡里会出现「整批撤销」，点一下把这一批删掉（删了就找不回来，先确认再点）',
            '随机刷出来的新角色不受这里影响，照旧走自动识别',
        ],
        build: (body) => {
            const status = h('div', { class: 'bc-param-sub' });
            const paintStatus = () => {
                status.textContent = sel.size
                    ? `已选 ${sel.size} 条（会建 ${sel.size} 个角色）`
                    : '还没选：勾下面的条目，一条都不勾就什么都不发生';
            };
            body.appendChild(status);
            // ★ 档位（默认轻档，别一建就把名单和数据都占了）
            body.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: '建出来的档位' }),
                dropdown(tier.mode, tierOptions(), (v) => { tier.mode = v; }),
                h('div', { class: 'bc-spacer' }),
            ));
            // 单人模式只认名单里那一个 ⇒ 建出来的人不会自动进推演，先说明白（别让人以为坏了 ✓）
            if (settings().targetMode === 'single') {
                body.appendChild(h('div', {
                    class: 'bc-hint',
                    text: '现在是单人追踪模式：建好的对象会出现在人物列表，但要回「追踪」页把名字填进名单才会参与推演',
                }));
            }
            body.appendChild(browser({
                selected: selectedKeys,
                mode: 'build',
                scrollEl: body,
                onToggle: (item) => {
                    const k = wiBindKey(item);
                    if (sel.has(k)) { sel.delete(k); selectedKeys.delete(k); }
                    else { sel.set(k, item); selectedKeys.add(k); }
                    paintStatus();
                },
            }));
            paintStatus();
        },
        onSave: () => {
            if (!sel.size) return false;
            const created = [];
            const skipped = [];
            const madeNames = new Set();
            const multi = settings().targetMode === 'multi';
            for (const item of sel.values()) {
                const name = String(item.title || '').trim();
                if (!name) continue;
                if (madeNames.has(name)) { skipped.push(name); continue; }
                const existed = targetList().some((t) => String(t.key) === name);
                if (existed) { skipped.push(name); continue; }
                let t = null;
                try { t = createTarget(name); } catch { t = null; }
                if (!t) { skipped.push(name); continue; }
                madeNames.add(name);
                try { addWiBindOf(String(t.key), item); } catch { /* 绑定失败也不影响建档 */ }
                try { applyTier(String(t.key), tier.mode); } catch { /* 忽略 */ }
                created.push(String(t.key));
                if (multi && tier.mode === 'full') {
                    const names = settings().targetNames || [];
                    if (!names.includes(name)) settings().targetNames = [...names, name];
                }
            }
            if (multi) save();
            if (created.length) {
                state().wiBuild = { at: Date.now(), keys: created };
                commit();
            }
            console.log(`[Bodycord] 从世界书建角色：新建 ${created.length} 个${skipped.length ? `，同名跳过 ${skipped.length} 个` : ''}`);
            try { onDone?.(true); } catch { /* 忽略 */ }
            // 成功不弹右上角（项目规矩：成功类只写 console.log ✓）
            return true;
        },
    });
}

/** 人物视图顶部：上一次「从世界书 / 从角色卡建角色」的整批撤销（没有这一批 ⇒ 不画 ✓） */
export function wiBuildUndoRow(onChange = () => {}) {
    const rows = [];
    const addBatch = (field, label) => {
        let rec = null;
        try { rec = state()[field]; } catch { rec = null; }
        const keys = (Array.isArray(rec?.keys) ? rec.keys : []).filter((k) => state().targets?.[k]);
        if (!keys.length) return;
        rows.push(h('div', { class: 'bc-row bc-row-wrap' },
            h('span', { class: 'bc-hint', text: `上一次${label}建了 ${keys.length} 个角色` }),
            button('整批撤销', async () => {
                const ok = await askConfirm(`把这 ${keys.length} 个角色删掉？\n\n`
                    + '它们的数值与记录会一起删掉，删了找不回来。只想删几个的话，去下面的对象列表一个个删');
                if (!ok) return;
                for (const k of keys) { try { removeTarget(k); } catch { /* 单个失败继续 */ } }
                try { delete state()[field]; commit(); } catch { /* 忽略 */ }
                try { onChange(true); } catch { /* 忽略 */ }
            }, { variant: 'danger' }),
        ));
    };
    addBatch('wiBuild', '从世界书');
    addBatch('cardBuild', '从角色卡');
    if (!rows.length) return null;
    return h('div', {}, ...rows);
}
