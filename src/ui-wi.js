/**
 * ui-wi.js —— 「世界书（给推演看）」
 *
 * 这一份需求清单管着这里所有取舍：
 *   · **不要下拉**：做成表格列世界书名字，点开某本是它里面的条目；
 *     书和条目都分页（单页有数量上限）免得卡顿 ✓
 *   · 聊天里把**当前角色卡的世界书置顶**，方便挑要关哪些条目 ✓
 *   · **要列全部**（不只列最近出现过的）✓
 *   · 书名数量不封顶（不止一百多本）⇒ 一切**按需**：分页 + 展开才读那本书 ✓
 *   · 默认**折叠**（原来默认展开太占空间）；点「编辑」开窗，窗里最上面搜索、下面是列表 ✓
 *   · 卡片和弹窗里**不放说明性长句** —— 没什么用的解释直接删掉 ✓
 *   · **不用开关**（"开到底代表给看还是不给看"会把人搞晕）：
 *     主动作是「排除」（把书 / 条目挪出去），下面一个**已排除的池子**，池子里是「放回」✓
 *
 * ⚠️ 一个开关都不预读世界书：只有玩家展开某本时才会去读它（`bookEntries`）✓
 * ⚠️ 这里只改插件自己的设置，**绝不写世界书文件、也不动酒馆的全局勾选** ✓
 */

import { h, button, toggle, section, clear, askConfirm, modal, scrollTopOf, setScrollTopOf } from './dom.js';
import {
    wiOn, wiFollows, wiDescOn, setWiDescOn,
    wiPersonaOn, setWiPersonaOn, wiHeritageAuto, setWiHeritageAuto,
    wiHeritageSources, setWiHeritageSource,
    wiCharOn, setWiCharOn, wiGlobalOn, setWiGlobalOn, wiOffBookNames,
    wiBookAllowed, wiEntryAllowed, setWiBook, setWiEntry, wiResetFollow, wiOffCounts,
} from './settings.js';
import { currentBookNames, refreshWiBooks, bookEntries, wiStatus, pinnedCharBooks } from './wi.js';

/** 每页最多多少本世界书（"单页上限"，避免一次铺几百上千行 ✓） */
export const WI_PAGE_BOOKS = 20;
/** 展开某本书之后，条目也分页 ✓ */
export const WI_PAGE_ENTRIES = 20;

/**
 * 分页切片（2026-10-23 补：这个函数**从来没定义过** —— 编辑器一开就 ReferenceError，
 * 结果是「世界书列表整片空白、连一句提示都没有」，因为异常把整趟重画打断了 ✗）。
 * @returns {{items:any[], cur:number, total:number}} 页码越界时自动夹回来
 */
function pageSlice(all, page, per) {
    const list = Array.isArray(all) ? all : [];
    const size = Math.max(1, Number(per) || 20);
    const total = Math.max(1, Math.ceil(list.length / size));
    const cur = Math.min(Math.max(1, Math.round(Number(page) || 1)), total);
    return { items: list.slice((cur - 1) * size, cur * size), cur, total };
}

// ---- 界面状态（放模块级：重画、关弹窗再开都留着 ✓）----
let _q = '';             // 书名搜索词
let _page = 1;           // 书名第几页
let _open = '';          // 正在展开哪本
let _qe = '';            // 条目搜索词
let _pageE = 1;          // 条目第几页
let _poolOpen = false;   // 「已排除的世界书」池子：**默认收起** ✓
let _poolPage = 1;       // 池子自己也分页（别人可能排除掉很多本 ✓）
// ★ 2026-10-24（她要的形态）：点「多选」进模式 → 一个个点 → 点确认一下排除 / 放回。
//   书列表和条目列表各有一套，模式互不影响 ✓
let _multiBooks = false;
let _selBooks = new Set();
let _multiEntries = false;
let _selEntries = new Set();
let _selEntryBook = '';   // 已选条目属于哪一本：换书就清空 ✓
const _entryCache = new Map();   // 书名 -> 条目数组（展开时才读 ✓）



/**
 * 卡片本体：**默认只占两行**（默认展开太占空间 ✗），
 * 那张表在 `openWiEditor()` 的弹窗里；**只在"已锁死"时**多显一行状态（别的解释一律不放 ✓）
 */
export function wiSection(container) {
    const stat = h('div');
    // ★★ 2026-10-17（按来源细分）：
    //   角色卡世界书 / 全局世界书 两颗**各管各的、互不门控**，
    //   下面再加一颗角色描述（也是各管各的 ⇒ 三颗都不会变成点不动的死开关 ✓）
    const rowChar = h('div', { class: 'bc-row' },
        h('span', { class: 'bc-label', text: '角色卡世界书' }),
        toggle(wiCharOn(), (v) => { setWiCharOn(v); paint(); }),
        h('div', { class: 'bc-spacer' }),
    );
    const rowGlobal = h('div', { class: 'bc-row' },
        h('span', { class: 'bc-label', text: '全局世界书' }),
        toggle(wiGlobalOn(), (v) => { setWiGlobalOn(v); paint(); }),
        h('div', { class: 'bc-spacer' }),
    );
    const rowDesc = h('div', { class: 'bc-row' },
        h('span', { class: 'bc-label', text: '带角色卡的角色描述' }),
        toggle(wiDescOn(), (v) => { setWiDescOn(v); paint(); }),
        h('div', { class: 'bc-spacer' }),
    );
    // ★ 2026-10-23（她要的）：玩家自己那份人设描述也单独一颗开关
    const rowPersona = h('div', { class: 'bc-row' },
        h('span', { class: 'bc-label', text: '带用户角色设定' }),
        toggle(wiPersonaOn(), (v) => { setWiPersonaOn(v); paint(); }),
        h('div', { class: 'bc-spacer' }),
    );
    // ★ 2026-10-23（她要的）：遗传判定那一轮临时带上（只看那一轮，不改上面几颗开关）
    // ★ 2026-10-24（她：自动带一次发送什么要能编辑；遗传那一轮完全按它自己的配置发）——
    //   四类来源各自可选，编辑结果覆盖常驻那几颗开关（只看遗传那一轮）✓
    const openHeritageSources = () => modal({
        title: '遗传判定时自动带的内容',
        width: 520,
        saveText: '关闭',
        hideCancel: true,
        build: (body) => {
            for (const [k, label] of [
                ['charBook', '角色卡世界书'],
                ['globalBook', '全局世界书'],
                ['desc', '角色卡描述'],
                ['persona', '用户角色设定'],
            ]) {
                body.appendChild(h('div', { class: 'bc-row' },
                    h('span', { class: 'bc-label', text: label }),
                    toggle(wiHeritageSources()[k], (v) => { setWiHeritageSource(k, v); }),
                    h('div', { class: 'bc-spacer' }),
                ));
            }
            body.appendChild(h('div', {
                class: 'bc-hint',
                text: '遗传判定那一轮只按这份配置发（覆盖上面那几颗常驻开关）；正常推演和当场重判共用同一份',
            }));
        },
    });
    const rowHeritage = h('div', { class: 'bc-row' },
        h('span', { class: 'bc-label', text: '遗传判定时自动带一次' }),
        toggle(wiHeritageAuto(), (v) => { setWiHeritageAuto(v); paint(); }),
        button('编辑…', openHeritageSources, { title: '编辑遗传判定那一轮要带哪些内容' }),
        h('div', { class: 'bc-spacer' }),
    );
    // ★ 「刷新」：重新只读扫一遍"当前在用的世界书 ＋ 条目"（清单/读数立刻变新 ✓）
    const rowTools = h('div', { class: 'bc-row' },
        button('编辑世界书…', () => openWiEditor(paint), { title: '打开世界书清单（搜索 / 排除 / 放回）' }),
        button('刷新', async () => {
            const r = await refreshWiBooks();
            paint();
            try {
                window.toastr?.[r.ok ? 'success' : 'warning']?.(
                    r.ok ? `已刷新：当前在用 ${r.books} 本` : '没扫到世界书数据（这版酒馆可能没给扫描接口）');
            } catch { /* 忽略 */ }
        }, { title: '重新扫一遍当前在用的世界书与条目' }),
        h('div', { class: 'bc-spacer' }),
    );
    // ★ 减密度：卡片上不留说明文字，全在右上角「？」的弹窗里（定下的形态 ✓）
    //   ⚠️ 这里**不碰 `.bc-section-body`**（假 DOM 里 querySelector 返回 null ⇒ 冒烟测试会炸 ✗）
    const box = section('世界书（给推演看）', rowChar, rowGlobal, rowDesc, rowPersona, rowHeritage, rowTools, stat, {
        help: [
            '插件 API（状态推演）会读一下世界书，用来理解角色、种族与背景。读法跟酒馆给正文的读法一致：只取【当前角色卡的世界书】+【全局世界书】里这一轮生效的那几条（常驻 + 关键词命中的）；聊天书、人设书不读',
            '「角色卡世界书」和「全局世界书」是两颗开关，各管各的：想只带作者给这张卡写的那几本，就关掉全局那颗。两颗都出厂关着（世界书体量大，默认带上等于每轮白吃一截 token）',
            '同一本书如果既挂在全局、又被这张卡绑定，算角色卡那一类（按角色卡那颗开关走）',
            '「带角色卡的角色描述」= 把角色卡里那段角色描述也一起塞给推演。它跟上面两颗各管各的：世界书都关着，它也能单独带；反过来关了它，世界书照常发。它出厂也是关的（那段通常最长、每轮都吃 token，还常塞着状态栏格式）；要更准就打开它',
            '「带用户角色设定」= 把你自己那份人设描述（酒馆里当前用的人设）也一起带给推演。它跟前面几颗都各管各的。出厂关着：那是你写给自己看的设定，每轮都发会一直吃 token',
            '「遗传判定时自动带一次」= 孩子第一次判遗传特质的那一轮，只看这一轮，按右边「编辑…」里勾的内容发（角色卡世界书 / 全局世界书 / 角色卡描述 / 用户角色设定，四类各自可选）；这一轮完全按它自己的配置发，覆盖上面那几颗常驻开关，下一轮恢复。出厂开着；当场重判也走同一份配置',
            '什么时候打开比较值：人设复杂、或者设定不摆在台面上的时候。比如角色其实不是人类、妖装成人类，而且剧情里没人看得出来，这种推演最容易判错，开着更准；人设简单、一眼能看明白的时候关着就行。当然开不开随你，带上这些设定只是让推演把这个角色定得更准',
            '「编辑世界书…」里只列当前在用的那几本（角色卡的书 ＋ 当前开着的全局书），不再把库里所有书都摊出来；已经排除的书在下面的池子里，随时能放回',
            '「刷新」= 重新扫一遍当前在用的世界书与条目。刚进聊天、酒馆还没生成过时，清单可能是空的，点它一下就好',
            '默认是「跟随酒馆」：酒馆开着的条目就给推演看。你一旦动过任何一条，就会「锁死」、不再自动跟随，这时想回到默认就点「恢复跟随酒馆」',
        ],
    });

    function paint() {
        clear(stat);
        const { books, entries } = wiOffCounts();
        // 跟随酒馆时不显任何字（那些解释没用 ✓）；一旦锁死才显一眼看得懂的状态 ✓
        if (!wiFollows()) {
            stat.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-badge', text: '已锁死（手动）' }),
                h('span', { class: 'bc-hint', text: `已排除 ${books} 本 / ${entries} 条（点「编辑世界书…」可以放回）` }),
            ));
        }
    }
    container.appendChild(box);
    paint();
    return box;
}

/**
 * 弹窗编辑器：点「编辑」开窗，窗口最上面是搜索、下面是列表 ✓
 * @param {Function} [onDone] 关弹窗后回调（卡片上那行状态要跟着刷新 ✓）
 */
export function openWiEditor(onDone) {
    return modal({
        title: '世界书（给推演看）',
        width: 760,
        saveText: '关闭',
        hideCancel: true,
        build: (body) => {
            const listHost = h('div', { class: 'bc-wi-list' });
            const poolHost = h('div');
            const statHost = h('div');
            const changed = () => { try { onDone?.(); } catch { /* 忽略 */ } };

            // ① 最上面：搜索（★ 放在会重画的那块**外面** ⇒ 打字时输入框不失焦 ✓）
            const search = h('input', {
                class: 'bc-input', value: _q, placeholder: '搜索世界书名字…',
                oninput: (e) => { _q = e.target.value; _page = 1; paintAll(); },
            });
            body.appendChild(h('div', { class: 'bc-row' }, search));

            // ② 一行状态 + 恢复跟随
            body.appendChild(statHost);

            // ③ 主列表（只列**没被排除**的）
            body.appendChild(listHost);

            // ④ 已排除的池子（没有就整段不出现 ✓）
            body.appendChild(poolHost);

            function paintStat() {
                clear(statHost);
                const s = wiStatus();
                statHost.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                    h('span', { class: 'bc-badge', text: wiFollows() ? '跟随酒馆' : '已锁死（手动）' }),
                    h('span', { class: 'bc-hint', text: s.at
                        ? `最近一轮带了 ${s.count} 条 / ${s.chars} 字${s.books ? `（${s.books} 本）` : ''}`
                        : '还没推演过' }),
                    // ★ 含模板代码的条目没渲染成功 ⇒ 如实说一句（异常才说话，正常不啰嗦 ✓）
                    ...(s.skipped ? [h('span', { class: 'bc-hint', text:
                        `有 ${s.skipped} 条含模板代码、没能渲染，这次跳过了` })] : []),
                    h('div', { class: 'bc-spacer' }),
                    button('恢复跟随酒馆', async () => {
                        const { books, entries } = wiOffCounts();
                        const ok = (books + entries) === 0
                            || await askConfirm('把这份清单清空、回到"跟随酒馆"？（你排除掉的那些会全部放回）');
                        if (!ok) return;
                        wiResetFollow();
                        paintAll();
                        changed();
                    }, { title: '清空你排除掉的书与条目，重新跟随酒馆' }),
                ));
            }

            /**
             * ★ 重画这块**别把弹窗的滚动位置弹回顶上**（选择排除也会回顶）——
             *   根因和设置页那次一模一样：重画 = 先 `clear()` 再画回来，内容高度瞬间变 0
             *   ⇒ 浏览器把 `.bc-modal-body` 的 `scrollTop` 夹回 0 ✗
             *   ⇒ 每次重画前先记、画完放回去（`dom.js` 的两个工具就是为此写的 ✓）
             */
            const keepScroll = (fn) => {
                const top = scrollTopOf(body);
                fn();
                setScrollTopOf(body, top);
            };

            function paintAll() {
                keepScroll(() => { paintStat(); paintList(); paintPool(); });
            }

            function visibleBooks() {
                // ★ 只列**当前在用的**那几本（角色卡 ＋ 当前开着的全局），不再摊库里所有书 ✓
                const all = currentBookNames();
                const pinned = pinnedCharBooks();
                const kw = _q.trim().toLowerCase();
                const hit = all.filter(n => !kw || String(n).toLowerCase().includes(kw));
                // ★ 当前聊天角色卡的那几本**置顶**（"置顶方便玩家选择关闭哪个条目"✓）
                const head = [];
                for (const p of pinned) if (hit.includes(p)) head.push(p);
                const rest = hit.filter(n => !head.includes(n)).sort((a, b) => String(a).localeCompare(String(b), 'zh'));
                return { ordered: [...head, ...rest], pinned };
            }

            function paintList() {
                clear(listHost);
                // ★ 2026-10-24（她：关着也得能编辑排除）——
                //   以前两颗都关就直接不列书，得先开开关才能调排除 ✗
                //   现在照样列出「当前聊天在用的书」，只是在上面提示一句"推演不会读" ✓
                if (!wiOn()) {
                    listHost.appendChild(h('div', {
                        class: 'bc-hint',
                        text: '两颗世界书开关都关着，推演不会读世界书；下面照样可以调整排除，不用先打开开关',
                    }));
                }
                const { ordered, pinned } = visibleBooks();
                // 主列表只留"给推演看"的书（被排除的都在池子里 ✓）
                const kept = ordered.filter(n => wiBookAllowed(n));
                if (!ordered.length) {
                    // ⚠️ 这里要分清两件事：**真没读到名单** vs **搜索没命中** ——
                    //   原来一律报"没读到世界书名单"，搜一个不存在的书名时等于误导排查方向 ✗
                    listHost.appendChild(h('div', { class: 'bc-empty', text: _q.trim()
                        ? '没有匹配的世界书'
                        : '当前聊天还没有扫到在用的世界书（回卡片点一下「刷新」）' }));
                    return;
                }
                const { items, cur, total } = pageSlice(kept, _page, WI_PAGE_BOOKS);
                _page = cur;
                // ★ 2026-10-24（她的观察：展开条目时容易下意识点世界书的多选）——
                //   有书展开时**不显示书这一层的多选**（焦点在条目上）；顺手退出书多选模式，
                //   免得按钮藏了、模式还开着，点行全变成选书 ✗
                if (_open && _multiBooks) { _multiBooks = false; _selBooks = new Set(); }
                if (!_open) {
                    listHost.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-wi-multi' },
                        button(_multiBooks ? '退出多选' : '多选', () => {
                            _multiBooks = !_multiBooks;
                            _selBooks = new Set();
                            paintList();
                        }, { title: '进入多选：一行一行点，选完点「排除选中」' }),
                        _multiBooks ? h('span', { class: 'bc-hint', text: `已选 ${_selBooks.size} 本` }) : null,
                        _multiBooks ? button('排除选中', () => {
                            for (const n of _selBooks) setWiBook(n, false);
                            _selBooks = new Set();
                            _multiBooks = false;
                            paintAll();
                            changed();
                        }, { disabled: !_selBooks.size, variant: 'primary' }) : null,
                    ));
                }
                for (const name of items) listHost.appendChild(bookRow(name, pinned.includes(name)));
                if (!items.length) {
                    listHost.appendChild(h('div', { class: 'bc-empty', text: '搜索到的书都被你排除了（都在下面的池子里）' }));
                }
                if (total > 1) {
                    listHost.appendChild(h('div', { class: 'bc-row' },
                        button('上一页', () => { _page = cur - 1; paintList(); }, { disabled: cur <= 1 }),
                        h('span', { class: 'bc-hint', text: `第 ${cur} / ${total} 页（共 ${kept.length} 本）` }),
                        button('下一页', () => { _page = cur + 1; paintList(); }, { disabled: cur >= total }),
                    ));
                }
            }

            /** 池子：已排除的世界书（一眼看得出"这些是不给推演看的"） */
            function paintPool() {
                clear(poolHost);
                // ★ 池子按**存下来的排除名单**列（不再从"当前在用的书"里筛）——
                //   否则一本排除掉的书一旦不在当前书单里，就再也找不回来放回 ✗
                const out = wiOffBookNames().filter(n => !wiBookAllowed(n))
                    .sort((a, b) => String(a).localeCompare(String(b), 'zh'));
                if (!out.length) return;
                const head = h('div', { class: 'bc-row' },
                    h('span', { class: 'bc-label', text: `已排除的世界书（${out.length}）` }),
                    h('div', { class: 'bc-spacer' }),
                    button(_poolOpen ? '收起' : '展开', () => { _poolOpen = !_poolOpen; paintPool(); }),
                );
                poolHost.appendChild(h('div', { class: 'bc-wi-pool' }, head));
                if (!_poolOpen) return;
                const { items, cur, total } = pageSlice(out, _poolPage, WI_PAGE_BOOKS);
                _poolPage = cur;
                for (const name of items) {
                    poolHost.appendChild(h('div', { class: 'bc-wi-pool' },
                        h('div', { class: 'bc-row' },
                            h('span', { class: 'bc-label', text: name }),
                            h('div', { class: 'bc-spacer' }),
                            button('放回', () => { setWiBook(name, true); paintAll(); changed(); },
                                { title: '这本书重新给推演看' }),
                        ),
                    ));
                }
                if (total > 1) {
                    poolHost.appendChild(h('div', { class: 'bc-row' },
                        button('上一页', () => { _poolPage = cur - 1; paintPool(); }, { disabled: cur <= 1 }),
                        h('span', { class: 'bc-hint', text: `第 ${cur} / ${total} 页` }),
                        button('下一页', () => { _poolPage = cur + 1; paintPool(); }, { disabled: cur >= total }),
                    ));
                }
            }

            function bookRow(name, pinned) {
                const isOpen = _open === name;
                // 多选模式下：整行就是"选它"，不给展开/排除按钮（免得点错）
                if (_multiBooks) {
                    const sel = _selBooks.has(name);
                    const row = h('div', {
                        class: 'bc-wi-book bc-wi-pick' + (sel ? ' bc-wi-picked' : ''),
                        onclick: () => {
                            if (_selBooks.has(name)) _selBooks.delete(name); else _selBooks.add(name);
                            paintList();
                        },
                        title: sel ? '点一下取消选择' : '点一下选中这本书',
                    },
                        h('div', { class: 'bc-row' },
                            h('span', { class: 'bc-label', text: name }),
                            pinned ? h('span', { class: 'bc-badge', text: '当前角色卡' }) : null,
                            h('div', { class: 'bc-spacer' }),
                            h('span', { class: 'bc-wi-tick', text: sel ? '✓ 已选' : '' }),
                        ),
                    );
                    return row;
                }
                const row = h('div', { class: 'bc-wi-book' },
                    h('div', { class: 'bc-row' },
                        h('span', { class: 'bc-label', text: name }),
                        pinned ? h('span', { class: 'bc-badge', text: '当前角色卡' }) : null,
                        h('div', { class: 'bc-spacer' }),
                        button(isOpen ? '收起' : '展开条目', () => {
                            _open = isOpen ? '' : name;
                            _qe = ''; _pageE = 1;
                            if (_open) loadOpen(name);
                            paintList();
                        }),
                        button('排除', () => { setWiBook(name, false); paintAll(); changed(); },
                            { title: '整本不给推演看（挪进下面的池子）' }),
                    ),
                );
                if (isOpen) {
                    const host = h('div', { class: 'bc-wi-entries' });
                    row.appendChild(host);
                    paintEntries(host, name);      // 先用缓存画（没有就显示"读取中" ✓）
                }
                return row;
            }

            async function loadOpen(name) {
                if (_entryCache.has(name)) return;
                try {
                    const list = await bookEntries(name);
                    _entryCache.set(name, list);
                } catch { _entryCache.set(name, []); }
                if (_open === name) paintList();
            }

            function paintEntries(host, name) {
                clear(host);
                if (!_entryCache.has(name)) {
                    host.appendChild(h('div', { class: 'bc-empty', text: '读取中…' }));
                    return;
                }
                const all = _entryCache.get(name) || [];
                if (!all.length) {
                    host.appendChild(h('div', { class: 'bc-empty', text: '这本书里没有条目' }));
                    return;
                }

                // ★ 条目搜索框也放在会重画的那块外面（重画时输入框才不会失焦 ✓）
                const rows = h('div');
                host.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                    h('input', {
                        class: 'bc-input', value: _qe, placeholder: '搜索条目名…',
                        oninput: (e) => { _qe = e.target.value; _pageE = 1; paintRows(); },
                    }),
                ));
                host.appendChild(rows);

                function paintRows() {
                    clear(rows);
                    const kw = _qe.trim().toLowerCase();
                    const hit = all.filter(e => !kw || String(e.title).toLowerCase().includes(kw));
                    const { items, cur, total } = pageSlice(hit, _pageE, WI_PAGE_ENTRIES);
                    _pageE = cur;
                    // ★ 换了一本书 ⇒ 已选条目清空（别把选择带到别的书上 ✓）
                    if (_selEntryBook !== name) { _selEntries = new Set(); _selEntryBook = name; }
                    // ★ 多选模式：条目这一层
                    rows.appendChild(h('div', { class: 'bc-row bc-row-wrap bc-wi-multi' },
                        button(_multiEntries ? '退出多选' : '多选', () => {
                            _multiEntries = !_multiEntries;
                            _selEntries = new Set();
                            paintRows();
                        }, { title: '进入多选：一条一条点，选完点「排除选中」或「放回选中」' }),
                        _multiEntries ? h('span', { class: 'bc-hint', text: `已选 ${_selEntries.size} 条` }) : null,
                        _multiEntries ? button('排除选中', () => {
                            for (const uid of _selEntries) setWiEntry(name, uid, false);
                            _selEntries = new Set();
                            _multiEntries = false;
                            paintRows();
                            changed();
                        }, { disabled: !_selEntries.size, variant: 'primary' }) : null,
                        _multiEntries ? button('放回选中', () => {
                            for (const uid of _selEntries) setWiEntry(name, uid, true);
                            _selEntries = new Set();
                            _multiEntries = false;
                            paintRows();
                            changed();
                        }, { disabled: !_selEntries.size }) : null,
                    ));
                    for (const e of items) {
                        const on = wiEntryAllowed(name, e.uid);
                        if (_multiEntries) {
                            const sel = _selEntries.has(e.uid);
                            rows.appendChild(h('div', {
                                class: 'bc-row bc-wi-pick' + (on ? '' : ' bc-wi-off') + (sel ? ' bc-wi-picked' : ''),
                                onclick: () => {
                                    if (_selEntries.has(e.uid)) _selEntries.delete(e.uid); else _selEntries.add(e.uid);
                                    paintRows();
                                },
                                title: sel ? '点一下取消选择' : '点一下选中这一条',
                            },
                                h('span', { class: 'bc-label', text: e.title }),
                                on ? null : h('span', { class: 'bc-badge', text: '已排除' }),
                                h('span', { class: 'bc-hint', text: e.disable ? '酒馆里也是关着的' : `${e.chars} 字` }),
                                h('div', { class: 'bc-spacer' }),
                                h('span', { class: 'bc-wi-tick', text: sel ? '✓ 已选' : '' }),
                            ));
                            continue;
                        }
                        rows.appendChild(h('div', { class: 'bc-row' + (on ? '' : ' bc-wi-off') },
                            h('span', { class: 'bc-label', text: e.title }),
                            on ? null : h('span', { class: 'bc-badge', text: '已排除' }),
                            h('span', { class: 'bc-hint', text: e.disable ? '酒馆里也是关着的' : `${e.chars} 字` }),
                            h('div', { class: 'bc-spacer' }),
                            on
                                ? button('排除', () => { setWiEntry(name, e.uid, false); paintRows(); changed(); },
                                    { title: '这一条不给推演看' })
                                : button('放回', () => { setWiEntry(name, e.uid, true); paintRows(); changed(); },
                                    { title: '这一条重新给推演看' }),
                        ));
                    }
                    if (!items.length) rows.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的条目' }));
                    if (total > 1) {
                        rows.appendChild(h('div', { class: 'bc-row' },
                            button('上一页', () => { _pageE = cur - 1; paintRows(); }, { disabled: cur <= 1 }),
                            h('span', { class: 'bc-hint', text: `第 ${cur} / ${total} 页（共 ${hit.length} 条）` }),
                            button('下一页', () => { _pageE = cur + 1; paintRows(); }, { disabled: cur >= total }),
                        ));
                    }
                }
                paintRows();
            }

            paintAll();
        },
    });
}
