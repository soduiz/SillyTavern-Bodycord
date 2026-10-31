/**
 * dom.js —— 极简 DOM 工具（不引任何依赖）
 */

/** 把 `**加粗**` 变成真的粗体（先转义 HTML，再替换，避免注入） */
export function richText(s) {
    const esc = String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

function hasBold(s) {
    return /\*\*[^*]+\*\*/.test(String(s ?? ''));
}

export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
        // 文案里写 **重点** 就渲染成真的粗体 ——
        // 界面不认 markdown，光写两个星号只会原样显示出来
        else if (k === 'text') {
            if (hasBold(v)) el.innerHTML = richText(v);
            else el.textContent = String(v);
        }
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false || c === true) continue;
        if (Array.isArray(c)) append(el, c);
        else if (c instanceof Node) el.appendChild(c);
        else el.appendChild(document.createTextNode(String(c)));
    }
    return el;
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/**
 * ★ 记 / 放「滚动到哪了」——**重画一块内容时别让画面弹回顶上**。
 *
 * 为什么要有它：重画 = 先 `clear()` 再画回来，而清空那一刻内容高度变成 0，
 *   浏览器会把滚动位置夹回 0 ⇒ 画回来以后画面就停在顶上 ✗（点「载入」那种按钮之后会这样）
 *   ⇒ 想"重画但不动画面"，必须**记对那个真在滚的元素**：
 *     容器自己带 `overflow-y:auto` 时就是它自己；宿主里嵌得不一样时可能是外一层 ✓
 */
export function scrollerOf(el) {
    let n = el;
    while (n && n.nodeType === 1) {
        try {
            const oy = getComputedStyle(n).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
        } catch { break; }
        n = n.parentElement;
    }
    return el;
}

export function scrollTopOf(el) {
    try { return el ? scrollerOf(el).scrollTop : 0; } catch { return 0; }
}

export function setScrollTopOf(el, v) {
    try { if (el) scrollerOf(el).scrollTop = v; } catch { /* 忽略 */ }
}

/**
 * ★★ 每个条目都要有自己那颗小「↩」（
 *   「**【每个】条目，都要有单独的重置，不止数值**」✓）——
 *   第 4 个参数给了就画：`{ def, set, get }`
 *   · `def`：出厂默认值（写进 title ✓）
 *   · `set(v)`：真写回去（一般是 `s.xxx = v; save();` ✓）
 *   · `get()`：读现在的值（可选；给了就按"等于默认值 ⇒ 置灰"那条口径 ✓）
 */
export function field(labelText, control, hint, reset = null) {
    // ⚠️ `hint` 有两种传法：**文字**（包一层 `.bc-hint`）或**已经做好的元素**
    //   ⇒ 传元素时必须原样放进去 ✗ —— 以前一律走 `text: hint`，
    //     传元素的话 `String(div)` 会在界面上印出 **`[object HTMLDivElement]`** ✗
    //     （改数值 → 📅 周期进度那张图给我看，就是这个 ✓）
    const hintEl = (hint && typeof hint === 'object' && hint.nodeType)
        ? hint
        : (hint ? h('div', { class: 'bc-hint', text: hint }) : null);
    let resetBtn = null;
    if (reset && typeof reset.set === 'function') {
        resetBtn = button('↩', () => {
            try { reset.set(reset.def); } catch { /* 忽略 */ }
        }, { title: '把这一项恢复成默认值（' + String(reset.def) + '）' });
        resetBtn.classList.add('bc-param-reset');
        try {
            if (typeof reset.get === 'function') resetBtn.disabled = String(reset.get()) === String(reset.def);
        } catch { /* 忽略 */ }
    }
    return h('div', { class: 'bc-field' },
        h('label', { class: 'bc-label', text: labelText }),
        resetBtn ? h('div', { class: 'bc-row' }, control, resetBtn) : control,
        hintEl,
    );
}

export function textInput(value, onInput, opts = {}) {
    return h('input', {
        class: 'bc-input' + (opts.class ? ' ' + opts.class : ''),
        type: opts.type || 'text',
        value: value ?? '',
        placeholder: opts.placeholder || '',
        oninput: (e) => onInput(e.target.value),
    });
}

export function numberInput(value, onInput, opts = {}) {
    return h('input', {
        class: 'bc-input',
        type: 'number',
        value: value ?? '',
        min: opts.min,
        max: opts.max,
        step: opts.step ?? 1,
        oninput: (e) => onInput(e.target.value === '' ? '' : Number(e.target.value)),
    });
}

export function textArea(value, onInput, opts = {}) {
    return h('textarea', {
        class: 'bc-textarea' + (opts.class ? ' ' + opts.class : ''),
        rows: opts.rows || 4,
        placeholder: opts.placeholder || '',
        value: value ?? '',
        readOnly: !!opts.readOnly,     // 只读（"只看一眼"用 ✓）
        oninput: (e) => onInput(e.target.value),
    });
}

/**
 * 自定义下拉框
 *
 * 为什么不用原生 <select>：原生下拉的弹出层是操作系统/浏览器画的，
 * CSS 管不到，于是它就会带着酒馆主题的配色出现在我们面板里，很割裂。
 * 这里自己画一个，颜色完全跟着插件主题走。
 */
export function dropdown(value, options, onChange, opts = {}) {
    const list = (options || []).map(([v, l]) => [String(v), String(l)]);
    let current = list.find(o => o[0] === String(value)) || list[0] || ['', ''];

    const valueEl = h('div', { class: 'bc-dd-value', text: current[1] });
    const menu = h('div', { class: 'bc-dd-menu' });
    const rootEl = h('div', {
        // ★ `opts.disabled` ⇒ "这一格不生效"的样子（不能怀孕时的「能不能怀上异种」✓）
        //   ⚠️ 这是**新加的第 4 个参数**：以前 select() 的第 4 个参数是被静默丢掉的 ✗
        //     （栽过一次：传了 {rebuild:true} 而 dom.js 根本没读 ⇒ 界面上不重建）
        class: 'bc-dd' + (opts.class ? ' ' + opts.class : '') + (opts.disabled ? ' is-disabled' : ''),
        tabindex: opts.disabled ? '-1' : '0',
        title: opts.title || '',
    }, valueEl, h('div', { class: 'bc-dd-caret', text: '▾' }), menu);

    const onDocDown = (e) => {
        if (rootEl.contains(e.target)) return;
        if (menu.contains(e.target)) return;   // 菜单是挂在 body 上的，点它不算"点外面" ✓
        closeMenu();
    };

    // 页面滚动就收菜单；⚠️ 菜单**自己**滚（限高时）不算 —— 否则滚选项会把菜单关掉 ✗
    const onScroll = (e) => { if (menu.contains(e.target)) return; closeMenu(); };

    function closeMenu() {
        rootEl.classList.remove('open');
        document.removeEventListener('mousedown', onDocDown, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', closeMenu);
        // ★ 菜单挂在 body 上（见 openMenu）⇒ 关的时候收回去，别在 body 里越积越多 ✓
        if (menu.parentNode && menu.parentNode !== rootEl) rootEl.appendChild(menu);
        menu.style.display = 'none';
        // 清掉"弹出时才算的定位"，下次重新算（不清的话换一次位置会沿用旧坐标 ✗）
        menu.style.position = '';
        menu.style.left = '';
        menu.style.top = '';
        menu.style.width = '';
        menu.style.maxWidth = '';
        menu.style.minWidth = '';
        menu.style.maxHeight = '';
        menu.style.overflowY = '';
    }

    /**
     * ★★ 弹层定位（点两次弹出方向不一样、下面那份还被切掉）——
     *   原来菜单是 `position:absolute`，被设置页那个 `overflow:auto` 的容器**直接裁掉**；
     *   而且只按 `window.innerHeight` 判要不要往上翻，卷一下页面就上下来回跳 ✗
     *   ⇒ 改成 `position:fixed` ＋ 自己算坐标（不受祖先 overflow 影响）：
     *     · 下面放得下 ⇒ 向下；放不下且上面更宽裕 ⇒ 向上；两边都不够 ⇒ 贴底并限高滚动
     *     · 左右也夹在视口里，长菜单不会伸出屏幕
     */
    function placeMenu() {
        const rr = rootEl.getBoundingClientRect();
        const gap = 4;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        menu.style.position = 'fixed';
        menu.style.width = rr.width + 'px';
        // ★ 宽度**不许超过格子本身**：CSS 那条 `max-width: min(560px, 88vw)` 是给"内容很长"留的上限，
        //   但它会让菜单比窄格子还宽（弹出来右边压住「恢复自动」那颗按钮、还比输入框长一截 ✗）
        //   ⇒ 弹的时候把上限也夹到格子宽度，两边一样长 ✓
        menu.style.maxWidth = rr.width + 'px';
        // ★★ 真正让菜单溢出去的是 CSS 那条 `min-width: 100%`：
        //   菜单挂在 body 上、又是 `position: fixed` ⇒ 它的 100% 是**整个视口**，
        //   而且 CSS 里 min-width 压过 max-width ⇒ 菜单被撑成满屏宽、右边压住别的东西 ✗
        //   ⇒ 弹的时候把下限也钉成格子宽度（关的时候清掉 ✓）
        menu.style.minWidth = rr.width + 'px';
        menu.style.maxHeight = '';
        menu.style.overflowY = '';
        let left = rr.left;
        if (left + rr.width > vw - 8) left = Math.max(8, vw - 8 - rr.width);
        let top = rr.bottom + gap;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        const mh = menu.getBoundingClientRect().height;
        const below = vh - 8 - (rr.bottom + gap);
        const above = rr.top - gap - 8;
        if (mh > below && above > below) {
            top = Math.max(8, rr.top - gap - mh);
            menu.style.top = top + 'px';
        } else if (mh > below) {
            // 两边都不够：放下面，限高 + 自己滚（别让标题被切掉一半 ✓）
            menu.style.maxHeight = Math.max(120, below) + 'px';
            menu.style.overflowY = 'auto';
        }
    }

    /**
     * ★★ 把主题变量**搬到菜单自己身上**（2026-10-23）。
     *   为什么：菜单为了不被祖先 overflow 裁掉而挂到了 body 上 ⇒ 它离开了定义变量那一层
     *   （面板的 `#bc-root[data-theme=…]` 之类）⇒ `var(--bc-main)` 取不到＝透明，
     *   而且**不能拿白色兜底**（夜模式会变成白板 ✗）。
     *   ⇒ 弹之前从**原来那个格子**身上把算好的值抄过来（它继承着当时的深浅主题），
     *     抄不到才轮到 CSS 里那个系统色兜底（`Canvas` / `CanvasText`，跟着浏览器深浅色走 ✓）。
     */
    const THEME_VARS = ['--bc-main', '--bc-surface-2', '--bc-tx', '--bc-tx-3', '--bc-line',
        '--bc-hover', '--bc-hover-strong', '--bc-sel-bg', '--bc-sel-tx', '--bc-fs-scale'];
    function copyThemeVars() {
        try {
            const cs = window.getComputedStyle(rootEl);
            for (const v of THEME_VARS) {
                const val = cs.getPropertyValue(v).trim();
                if (val) menu.style.setProperty(v, val);
            }
        } catch { /* 抄不到就走 CSS 兜底 ✓ */ }
    }

    function openMenu() {
        clear(menu);
        if (!list.length) {
            menu.appendChild(h('div', { class: 'bc-dd-empty', text: '（没有可选项）' }));
        }
        for (const [v, l] of list) {
            menu.appendChild(h('div', {
                class: 'bc-dd-item' + (v === current[0] ? ' active' : ''),
                text: l,
                onclick: (e) => {
                    e.stopPropagation();
                    current = [v, l];
                    valueEl.textContent = l;
                    closeMenu();
                    try { onChange?.(v); } catch (err) { console.error('[Bodycord] dropdown onChange 出错', err); }
                },
            }));
        }
        rootEl.classList.add('open');
        // ★ 挂到 body 上再定位：设置页那个滚动容器会 `overflow:hidden` 裁掉弹层，
        //   而且它的祖先如果带 transform，`position:fixed` 也会被"拽"回容器坐标系 ✗
        //   顺手清掉"上一个已经被重建掉的设置页"留下的孤儿菜单（不清理会一直飘在屏幕上 ✗）
        try {
            for (const m of document.querySelectorAll('body > .bc-dd-menu')) {
                if (m !== menu && (!m.__bcRoot || !m.__bcRoot.isConnected)) m.remove();
            }
        } catch { /* 忽略 */ }
        menu.__bcRoot = rootEl;
        document.body.appendChild(menu);
        // ★ 挂出去之后再抄主题变量（顺序不能反：抄的是"原来那个位置"的算好值 ✓）
        copyThemeVars();
        menu.style.display = 'block';
        requestAnimationFrame(placeMenu);
        document.addEventListener('mousedown', onDocDown, true);
        // 页面一滚就收（不然固定定位的菜单会跟输入框脱开，看着像漂着 ✗）
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', closeMenu);
    }

    rootEl.addEventListener('click', (e) => {
        if (opts.disabled) return;              // ★ 不生效的那一格：点了也不开 ✓
        e.stopPropagation();
        if (rootEl.classList.contains('open')) closeMenu();
        else openMenu();
    });
    rootEl.addEventListener('keydown', (e) => {
        if (opts.disabled) return;              // ★ 同上：键盘也别开 ✓
        if (e.key === 'Escape') closeMenu();
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rootEl.click(); }
    });

    return rootEl;
}

/** 兼容旧调用：现在底层是自定义下拉框
 *  ★ `opts` 会透传（`{ disabled, title, class }` ✓）—— 它是**真的**被读的，
 *    不像传了 `{rebuild:true}` 结果没人读那次 ✗ */
export function select(value, options, onChange, opts = {}) {
    return dropdown(value, options, onChange, opts);
}

export function toggle(checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: 'bc-toggle' }, input, h('span', { class: 'bc-slider' }));
}

export function button(text, onClick, opts = {}) {
    return h('button', {
        class: 'bc-btn' + (opts.variant ? ' bc-btn-' + opts.variant : '') + (opts.disabled ? ' bc-btn-off' : ''),
        text,
        title: opts.title || '',
        disabled: !!opts.disabled,     // 灰掉但**留着**（让人看得见有这条路 ✓）
        onclick: onClick,
    });
}

/**
 * 卡片标题栏右上角那个「？」：点开一个**居中弹窗**，把这张卡的说明分点列出来。
 *
 * 定的形态（管着这里所有取舍）：
 *   · 「点开弹小窗……我想的是面板中间弹那种窗口，而不是直接显示字……我觉得这么做看得更清楚」✓
 *   · 这样眼睛不好也能读：弹窗里字号更大、能分点、能滚，**卡片上一点说明文字都不留** ✓
 * ⚠️ 但**警告不许藏**（会丢数据 / 不可撤销 / 密钥要重填 / 会让正文出错这类）：
 *   明面必须留一句最短的后果，详细解释才进这个弹窗 ✓
 *
 * ★ 导出去给「标题行不是 cardHead 造的」那些地方用（比如工具栏那一排，
 *   它没有标题行，但同样需要一个「？」✓）
 */
export function helpButton(title, lines) {
    const list = (Array.isArray(lines) ? lines : [lines]).map(x => String(x || '').trim()).filter(Boolean);
    if (!list.length) return null;
    return h('button', {
        class: 'bc-sec-help',
        // ⚠️ 半角 `?`：全角「？」占满一格、墨迹偏左，看着就是"歪的" ✗
        text: '?',
        title: '这张卡的说明',
        onclick: () => modal({
            title: title + ' · 说明',
            width: 620,
            saveText: '知道了',
            hideCancel: true,
            build: (body) => {
                for (const t of list) body.appendChild(h('div', { class: 'bc-help-item', text: t }));
            },
        }),
    });
}

/** 卡片标题那一行（有说明时右边多一个「？」✓）
 *  ★ 也导出去给**卡内的小标题**用（每一项都要有自己的说明，别让人往上翻 ✓）
 *    ⇒ 分组小标题各带自己的「？」，说明不用全堆在卡片顶上那一个 ✗ */
export function sectionHead(title, helpLines) {
    const btn = helpButton(title, helpLines);
    if (!btn) return h('div', { class: 'bc-section-title', text: title });
    return h('div', { class: 'bc-section-title' },
        h('div', { class: 'bc-sec-titlerow' },
            h('span', { text: title }),
            h('div', { class: 'bc-spacer' }),
            btn,
        ),
    );
}

/**
 * 卡片"展开 / 收起"的记忆（按标题记）。
 *
 * 点恢复默认之后就折叠起来——
 *   根因：展开状态是**每张卡自己的 DOM 状态**，而设置页有好几条重画路径
 *   （段落内部重画 / 整页 `show()` / 设置页 force 重建）⇒ 只要有一次是新建节点，
 *   状态就全回到默认（有的默认就是收起）✗
 *   ⇒ 改成**按标题记在模块级**：建卡时读它、玩家点一下写它。
 *     这样任何一条重画路径都自动保住，不用在每个调用点各写一份还原逻辑 ✓
 */
const _secOpen = new Map();
/** 这张卡上一次是展开的吗（没点过 ⇒ null，用调用方给的默认 ✓） */
export function sectionOpenState(title) {
    const k = String(title || '');
    return _secOpen.has(k) ? _secOpen.get(k) : null;
}

/**
 * 一个设置区块。
 *
 * opts.collapsible = true 时标题可点，能收起/展开（给太长的那几个用）。
 * opts.open === false 时默认收起。
 * opts.help = [说明…] ⇒ 标题右上角出现「？」，点开是居中弹窗（卡片上就不留那些小灰字了 ✓）
 */
export function section(title, ...children) {
    // 兼容旧调用：最后一个是对象且带 collapsible/open/help 就当配置
    let opts = {};
    const last = children[children.length - 1];
    if (last && typeof last === 'object' && !(last instanceof Node)
        && ('collapsible' in last || 'open' in last || 'help' in last)) {
        opts = last;
        children = children.slice(0, -1);
    }

    const body = h('div', { class: 'bc-section-body' }, children);
    // opts.plain = true ⇒ 带 `bc-section-plain`（嵌进别的容器时用它那套虚线样式 ✓）
    const box = h('div', { class: 'bc-section' + (opts.plain ? ' bc-section-plain' : '') });

    if (!opts.collapsible) {
        box.appendChild(sectionHead(title, opts.help));
        box.appendChild(body);
        return box;
    }

    let open = opts.open !== false;
    // ★ 玩家手动开 / 关过的，以"记着的那份"为准（见上面 _secOpen 那段 ✓）
    const remembered = sectionOpenState(title);
    if (typeof remembered === 'boolean') open = remembered;
    const caret = h('span', { class: 'bc-sec-caret' });
    const helpBtn = helpButton(title, opts.help);
    const head = h('div', { class: 'bc-section-title bc-sec-toggle', title: '点击收起 / 展开' },
        caret, h('span', { text: title }),
        helpBtn ? h('div', { class: 'bc-spacer' }) : null,
        helpBtn,
    );
    if (helpBtn) {
        // 点「？」只开说明，别顺带把卡片收起/展开 ✓
        helpBtn.addEventListener('click', (e) => e.stopPropagation());
    }
    box.appendChild(head);
    box.appendChild(body);

    const sync = () => {
        box.classList.toggle('collapsed', !open);
        caret.textContent = open ? '▾' : '▸';
    };
    // ★ 2026-10-17：切换时**以 DOM 上那个 class 为准**（不再只信闭包里的 `open`）——
    //   因为别处会整段重画之后按 class 把展开状态放回来（见 ui-settings 的 redrawAll），
    //   那时闭包里的值已经和画面不一致了 ⇒ 点一下会"看起来没反应" ✗
    head.addEventListener('click', () => {
        open = box.classList.contains('collapsed');
        _secOpen.set(String(title || ''), open);   // ★ 记下来：下次重画还按这个 ✓
        sync();
    });
    sync();
    return box;
}

/**
 * 一组卡片的大标题（iOS 那种分组标题；挑的 A 方案 ✓）。
 * 样式复用现成的 `.bc-card-group-title`，不新造一套 ✓
 */
export function groupHeading(text) {
    return h('div', { class: 'bc-card-group-title', text });
}

/**
 * `bc-card` 那套手写卡片的**标题行**（右边带「？」）。
 *
 * 补丁页有一批卡不是用 `section()` 建的（`bc-card` + `bc-card-head` 手写 ✗）
 * ⇒ 补一个共用的卡头，说明同样走「？」弹窗 ✓
 * @param {string} title
 * @param {string[]} [helpLines]
 * @param {HTMLElement|null} [extra] 标题行里还要塞的东西（比如那个下拉）
 */
export function cardHead(title, helpLines, extra = null) {
    return h('div', { class: 'bc-card-head' },
        h('span', { class: 'bc-card-title', text: title }),
        extra,
        h('div', { class: 'bc-spacer' }),
        helpButton(title, helpLines),
    );
}

// ---------------------------------------------------------------------------
// 弹窗栈 + ESC
//
// ★★ BUG：接口配置弹出来的那个面板，**按 ESC 不会关掉它，
//   而是带着这个面板一起回退到主面板** ✗
//   根因（两件事凑一块）：① 酒馆那边那条 ESC 是**无条件**的 —— `ui.js` 的 `handleEsc()`
//     只管"设置页→状态页→关面板"，**根本不看屏幕上还有没有弹窗** ✗；
//   ② `modal()` 当时一个字都没接键盘 ⇒ 弹窗自己不会关，ESC 全让①吃了 ✓
//   ⇒ 两条一起：只要还有弹窗，ESC 就只关**最上面那个**（栈 ✓），
//     并且在 **window 的捕获阶段**把这一下拦掉 + `stopPropagation()` ⇒
//     酒馆/面板那条"后退 / 关面板"的 ESC 收不到它 ✓
//   ⚠️ 为什么用"栈"而不是"有弹窗就关掉所有"：弹窗里还能再开弹窗
//     （接口配置 → 「拉取模型列表」/ 「？」说明）⇒ 一次全关会把人家正在做的事一起关没 ✗
// ---------------------------------------------------------------------------
const modalStack = [];
let escBound = false;          // ⚠️ 挂监听**懒一点**：模块级就 `window.addEventListener` 会让
                               //    单元测试（Node 里没有 window）当场炸掉 ✗

function escGuard(e) {
    if (e.key !== 'Escape' || !modalStack.length) return;   // 没弹窗 ⇒ 一个字不拦（老路照旧 ✓）
    // 下拉框开着时**先关下拉**：不然 ESC 一跳到底，会把整个弹窗连着下拉一起关了 ✗
    const dd = document.querySelector('.bc-dd.open');
    if (dd) { e.preventDefault(); e.stopPropagation(); dd.click(); return; }
    e.preventDefault();
    e.stopPropagation();
    try { modalStack[modalStack.length - 1].close(); } catch (err) { console.warn('[Bodycord] ESC 关弹窗出错', err); }
}

/**
 * 通用弹窗
 *
 * ★ 减密度：多了 `help` —— 弹窗标题右边也能挂一个「？」（和卡片上那个同一套 ✓）。
 *   为什么弹窗也要：弹窗里同样会堆"讲原理 / 讲用法"的长句，那和卡片上的小灰字是同一个病 ✗
 *   ⇒ 说明进 help、弹窗正文只留控件 / 警告 / 读数 ✓
 */
export function modal({ title, build, onSave, onDelete, onClose, width = 720, help = null,
                        saveText = null, cancelText = '取消', hideCancel = false, okVariant = 'primary' }) {
    const overlay = h('div', { class: 'bc-modal-overlay' });
    // 跟随插件当前的日夜模式
    try {
        const rootEl = document.getElementById('bc-root');
        overlay.dataset.theme = rootEl?.dataset?.theme || 'light';
        // ★ A5：**易读模式也要跟着传** —— 弹窗挂在 <body> 上、不是 .bc-root 的孩子，
        //   不传的话它拿不到 --bc-fs-scale（弹窗里的字不会放大）也拿不到那份深灰 ✗
        overlay.dataset.vision = rootEl?.dataset?.vision || 'normal';
    } catch { /* 忽略 */ }
    let closed = false;
    // ★ ESC 用的那条栈记录：先占位、下面把 close 填进去（close 里要反过来把自己摘掉 ✓）
    const entry = { close: null };
    const close = () => {
        if (closed) return;           // 别重复触发（关闭按钮 + 点遮罩 + 保存都会走这里）
        closed = true;
        // ★ 出栈：不出的话 ESC 会去关一个已经没了的弹窗，下一个弹窗就得多按一次 ✗
        const i = modalStack.indexOf(entry);
        if (i >= 0) modalStack.splice(i, 1);
        overlay.remove();
        try { onClose?.(); } catch (e) { console.warn('[Bodycord] 弹窗关闭回调出错', e); }
    };
    entry.close = close;
    modalStack.push(entry);
    // 第一次真的开出弹窗时才挂（挂一次就够 ✓）
    if (!escBound) { escBound = true; window.addEventListener('keydown', escGuard, true); }

    const body = h('div', { class: 'bc-modal-body' });
    const helpBtn = help ? helpButton(title, help) : null;
    const box = h('div', { class: 'bc-modal-box', style: { width: width + 'px' } },
        h('div', { class: 'bc-modal-head' },
            h('div', { class: 'bc-modal-title', text: title }),
            h('div', { class: 'bc-modal-head-right' },
                helpBtn,
                h('div', { class: 'bc-modal-close', text: '✕', onclick: close }),
            ),
        ),
        body,
        h('div', { class: 'bc-modal-foot' },
            onDelete ? button('删除', () => { onDelete(); close(); }, { variant: 'danger' }) : null,
            h('div', { class: 'bc-spacer' }),
            hideCancel ? null : button(cancelText, close),
            // ★ onSave 明确返回 false ⇒ **不关窗**（校验没过时留在原地让人改 ✓）
            //   以前返回值被忽略、close() 无条件执行 ⇒ 校验失败也把弹窗关掉，
            //   输入全丢（合并档选不够两个、骰式不合法时都踩过 ✓）
            // ★ 两种情况都要画这颗按钮：
            //   ① 有 onSave ⇒ 走校验（它返回 false 就不关窗）
            //   ② **只传了 saveText 没传 onSave**（"只想给个关闭按钮"的用法，比如世界书编辑器）
            //      ⇒ 以前直接渲染成 null，作者写的 saveText 成了死配置、底部只剩一个空格子 ✗
            onSave ? button(saveText || '保存', () => { if (onSave() === false) return; close(); }, { variant: okVariant })
                : (saveText ? button(saveText, close, { variant: okVariant }) : null),
        ),
    );
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    build(body, close);
    return { close, body };
}

/**
 * ★ 要一句「确定 / 取消」时用它（**不要用 `window.confirm`** ✗）
 *
 * `window.confirm` 跟 `window.prompt` 是同一类**宿主 API** ——
 *   在**安卓 WebView（TT 手机端）**里要靠宿主实现，没实现就是**静默返回 false**
 *   ⇒ 所有"确定要删吗"会表现成**点了没反应**（按钮像坏的 ✗），而且它不会报错。
 *   它的长相也跟面板完全不是一套。
 * ⇒ 换成我们自己的弹窗（`modal` ✓）：手机上一定有反应、样式统一 ✓。
 *
 * ⚠️ 它是**异步**的（系统那个是同步返回布尔）⇒ 调用点必须写 `await`：
 *      `if (!(await askConfirm('确定删掉？'))) return;`
 *   而且**包着它的那个函数得是 async**（忘了改就是语法错误、整个模块加载不了，不会静默 ✗）。
 *
 * @param {string|{title?:string, msg:string, danger?:boolean, okText?:string, cancelText?:string}} titleOrOpts
 *   也接受直接传一个字符串（老调用点就是这么写的 ✓）
 * @returns {Promise<boolean>} 确定 ⇒ true；取消 / 点遮罩 / 按 ESC / 点 ✕ ⇒ false ✓
 */
export function askConfirm(titleOrOpts) {
    const o = (titleOrOpts && typeof titleOrOpts === 'object') ? titleOrOpts : { msg: String(titleOrOpts ?? '') };
    const msg = String(o.msg ?? '');
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        modal({
            title: o.title || '确定吗',
            width: 420,
            saveText: o.okText || '确定',
            cancelText: o.cancelText || '取消',
            okVariant: o.danger ? 'danger' : 'primary',
            // ⚠️ 顺序：确定 ⇒ 先 finish(true)，再 close() ⇒ close 里的 onClose 再 finish(false) 会被忽略 ✓
            onSave: () => { finish(true); },
            onClose: () => { finish(false); },
            // ⚠️ `bc-modal-text` 带 `white-space: pre-wrap` —— 这些提示里常有 `\n\n`（原来靠系统弹窗换行 ✓）
            build: (body) => { body.appendChild(h('div', { class: 'bc-modal-text', text: msg })); },
        });
    });
}

/**
 * ★ 要一句输入时用它（**不要用 `window.prompt`** ✗）
 *
 * 拿系统弹窗的截图问过：手机上也会弹这个吗、输入法有反应吗 ——
 * 系统弹窗在**安卓 WebView（TT 手机端）**里要靠宿主实现 `onJsPrompt`，没实现就是
 * **静默返回空**（点了没反应、也不报错 ✗）；而且它样式跟面板完全不是一套。
 * ⇒ 全部换成我们自己的弹窗（`modal` ＋ `textInput` ✓）：手机上一定有反应、样式统一、
 *   还能顺手支持回车确定 ✓
 *
 * @param {{title:string, value?:string, placeholder?:string, maxLen?:number,
 *          help?:string[]|null, okText?:string}} opts
 * @returns {Promise<string|null>} 取消 / 关掉 ⇒ null ✓（空串 = 用户清空了内容，跟 null 不一样 ✓）
 */
export function askText({ title, value = '', placeholder = '', maxLen = 0, help = null, okText = '确定' } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const cut = (v) => (maxLen > 0 ? String(v ?? '').slice(0, maxLen) : String(v ?? ''));
        let m = null;
        let input = null;
        m = modal({
            title,
            width: 440,
            help,
            saveText: okText,
            // ⚠️ 顺序：确定 → 先 finish(值)，再 close() ⇒ close 里的 onClose 再 finish(null) 会被忽略 ✓
            onSave: () => { finish(cut(input?.value)); },
            onClose: () => { finish(null); },
            build: (body) => {
                input = textInput(String(value ?? ''), () => {}, { placeholder });
                body.appendChild(h('div', { class: 'bc-row' }, input));
                input.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    finish(cut(input.value));
                    m.close();
                });
                setTimeout(() => { try { input.focus(); input.select(); } catch { /* 忽略 */ } }, 0);
            },
        });
    });
}
