/**
 * ui-period.js —— 「经期表现」那张卡里的设置区（2026-11-11）
 *
 * 位置：补丁页 → 生理期 分类 → 「经期表现」卡展开之后（就是原来「生理期体质补丁」那张卡，
 *   2026-11-11 起改了名字、加了开关，设置长在它自己身上）。
 *
 * 排版：一行一件事，左边固定一列标签、右边一列控件（跟参数面板同一套对齐）；
 *   长的那两块（表现清单、颜色质地写法）默认收起，点开才铺 ✓
 *
 * 口径：
 *   ① 天数最多到「排卵日减 2」天，格子按这个上限画，点不到错的
 *   ② 经量 / 痛经 是基础档；剧情里的止痛药、受寒这类临时变化记在面板的「非常态」里
 *   ③ 清单内置 8 条固定（不可删、名字不可改，内容可以填），自己加的排在后面、可以删
 */

import { h, button, dropdown, numberInput, textInput, checkRow } from './dom.js';
import { periodPrefsOf, setPeriodPrefsOf } from './store.js';
import { periodDaysOf, periodDaysCapOf, bodyCycleParamsOf, eggWindowDaysOf } from './settings.js';

const FLOW_OPTS = [['少', '少'], ['中', '中'], ['多', '多']];
const PAIN_OPTS = [['无', '无'], ['轻', '轻'], ['中', '中'], ['重', '重']];
const ON_OFF_OPTS = [['1', '开'], ['0', '关']];

// 收起的开合状态放模块级 ⇒ 重建这一块之后不会自己弹回去 ✓
const _foldOpen = Object.create(null);

function labelEl(text) {
    return h('span', { class: 'bc-period-label', text });
}

/** 一行：左标签 + 右控件（控件可以有多个，横着排） */
function row(label, ...controls) {
    return h('div', { class: 'bc-period-line' },
        labelEl(label),
        h('div', { class: 'bc-period-val' }, ...controls),
    );
}

/** 一块可折叠区（标题行 + 内容）；status 会跟在标题后面，收起时也看得到 ✓ */
function foldBar(key, title, body, status = '') {
    let open = !!_foldOpen[key];
    const btn = button('', () => {
        open = !open;
        _foldOpen[key] = open;
        paint();
    }, { variant: 'primary' });
    function paint() {
        body.style.display = open ? '' : 'none';
        btn.textContent = (open ? '收起' : '展开') + ' ' + title + (status ? '（' + status + '）' : '');
    }
    const wrap = h('div', { class: 'bc-period-fold' });
    wrap.appendChild(btn);
    wrap.appendChild(body);
    paint();
    return wrap;
}

function onOffDropdown(on, onChange) {
    return dropdown(on ? '1' : '0', ON_OFF_OPTS, (v) => onChange(v === '1'));
}

/** 一格：标签在上、控件在下、说明再下一行（跟参数面板其它格子同一套 ✓） */
function field(label, control, hint) {
    return h('div', { class: 'bc-field' },
        h('label', { class: 'bc-label', text: label }),
        control,
        hint ? h('div', { class: 'bc-hint', text: hint }) : null,
    );
}

/** 一行里横着排的几个小件（比如「提前 N 天开始」） */
function inline(...kids) {
    return h('div', { class: 'bc-period-inline' }, ...kids);
}

/**
 * 设置区本体。
 * @param {string|null} targetKey 这个对象
 * @param {() => void} [repaint] 只重建这一块（不整页重画 ✓）
 */
export function periodSettingsBlock(targetKey, repaint) {
    const box = h('div', { class: 'bc-period-block' });
    const say = h('span', { class: 'bc-period-say' });

    const prefs0 = periodPrefsOf(targetKey);
    const repaintOnly = () => { try { repaint?.(); } catch { /* 忽略 */ } };
    const headText = () => `经期 ${periodDaysOf(targetKey)} 天 · 勾选 ${periodPrefsOf(targetKey).items.filter((x) => x.on).length} 项`;
    say.textContent = headText();

    const savePrefs = (patch, needsRepaint = true) => {
        try { setPeriodPrefsOf(targetKey, patch); } catch { /* 忽略 */ }
        // ★ 2026-11-13：只有会改这一块"形状"的项（痛经走势：自定义会多出几天下拉）才重画；
        //   经量 / 基础痛经只是换了个选中项，重画整块纯属白干 ✓
        if (needsRepaint) repaintOnly();
    };

    // ---- 经期天数 ----
    const cap = periodDaysCapOf(targetKey);
    /** 本周期**实际**按几天算（读的时候夹过；面板读数 / 共几天都用它 ✓） */
    const effDays = periodDaysOf(targetKey);
    // ★ 2026-11-14（她拍）：框里放**玩家写的那个数**，不放下限夹过的那份 ——
    //   上限＝排卵日减 2，排卵日跟着每段掷出的周期长度走 ⇒ 短周期会把它悄悄改小。
    //   现在写的数原样留着，只在本周期算的时候夹、并且明说「本周期按 X 天」✓
    const prefDays = (() => {
        const d = Math.round(Number(prefs0.days));
        return (Number.isFinite(d) && d >= 1) ? d : 5;
    })();
    let days = prefDays;
    /** 本周期实际几天（简图 / 痛经逐天 / 读数都按这个画 ✓） */
    const cur = effDays;
    let bp = { cycle: 28, ovu: 14 };
    try { bp = bodyCycleParamsOf(targetKey); } catch { /* 用默认 */ }
    // ★ 2026-11-13（2.7 第三批修）：别把周期长度夹到 90 ——
    //   长周期族（狗 180 / 象 112）和自定义长周期，一夹这条简图上的窗口段就整段落在外面、
    //   直接不画（看着像"这一族没有窗口"✗）。简图是按比例画的，长度多大都放得下 ✓
    const len = Math.max(1, Math.round(Number(bp.cycle) || 28));
    const ovu = (bp.ovu === null || bp.ovu === undefined) ? null : Math.round(Number(bp.ovu));

    const setDays = (n) => {
        // ★ 2026-11-14（她拍）：玩家写多少就存多少（只挡 < 1），**不按上限改掉它** ——
        //   上限会随这一段的周期长度变，以前那道上限会把 5 悄悄写成 4 存进去。
        //   本周期实际按几天，由 `periodDaysOf` 读的时候夹、下面那行小字说清 ✓
        const raw = (n === '' || n === null || n === undefined) ? NaN : Number(n);
        const asked = Math.round(raw);
        let want = Number.isFinite(asked) ? asked : days;
        if (want < 1) want = 1;
        // ★ 2026-11-11：天数存进设置（不再往补丁正文里写）—— 同一个数只留一处 ✓
        try { setPeriodPrefsOf(targetKey, { days: want }); } catch { /* 忽略 */ }
        // 自定义痛经那几行是按天数铺的 ⇒ 天数一改就得重建（那是少数人的档位 ✓）
        if (prefs0.painPattern === 'custom') { repaintOnly(); return; }
        days = want;
        // 输入框显示**你写的那个数**（它自己不会因为 max 属性被浏览器夹 ✓）
        try { daysInput.value = String(days); } catch { /* 忽略 */ }
        paintDays();
        // 写的数比本周期上限长 ⇒ 明说「本周期按 X 天」，但你写的数不动 ✓
        if (days > cap) {
            say.textContent = `本周期最多第 ${cap} 天`
                + (ovu !== null ? `（第 ${Math.max(1, ovu - 1)} 天起是排卵窗口）` : '')
                + `，按 ${Math.min(days, cap)} 天算`;
        } else {
            say.textContent = headText();
        }
    };

    const grid = h('div', { class: 'bc-daygrid' });
    const chipEls = [];
    // ★ 2026-11-13（2.7 第三批修）：芯片只铺到 15 天 ——
    //   长周期族（狗 180 / 象 112）的 `cap` 是一百多，铺出来一百多颗芯片直接把这一页撑爆；
    //   真要更长，右边的数字格照样能填（上限还是 cap ✓）
    const chipMax = Math.min(cap, 15);
    for (let d = 1; d <= chipMax; d += 1) {
        const chip = h('div', {
            class: 'bc-daychip' + (d <= cur ? ' on' : ''),
            text: String(d),
            title: '经期到第 ' + d + ' 天结束',
        });
        chip.onclick = () => setDays(d);
        chipEls.push(chip);
        grid.appendChild(chip);
    }

    let daysTimer = null;
    // 框里一开始放的是**玩家写的那个数**（可能比本周期上限长，下面那行小字会说明 ✓）
    const daysInput = numberInput(days, (v) => {
        clearTimeout(daysTimer);
        daysTimer = setTimeout(() => {
            // ★ 2026-11-13（扫 BUG）：非数字 / 空 / 0 也要走 setDays（以前直接跳过 ⇒ 框和实际不一致）✓
            setDays(v);
        }, 500);
    }, { min: 1 });
    daysInput.classList.add('bc-period-days');

    const capTip = '插件按它算经期，最多第 ' + cap + ' 天'
        + (ovu !== null ? '（第 ' + Math.max(1, ovu - 1) + ' 天起是排卵窗口）' : '')
        + (cap > 15 ? '；比 15 天更长就直接在右边填数字' : '')
        + (prefDays > cap ? '；你写的是 ' + prefDays + ' 天，这一段周期短，本周期只算到第 ' + cap + ' 天' : '');

    box.appendChild(field('经期天数',
        h('div', { class: 'bc-period-valuebox' },
            grid,
            inline(h('span', { class: 'bc-hint', text: '或填' }), daysInput, h('span', { class: 'bc-hint', text: '天' })),
        ),
        capTip,
    ));

    // ---- 周期简图 ----
    const seg = (from, to, cls) => {
        const a = Math.max(1, Math.min(len, from));
        const b = Math.max(1, Math.min(len, to));
        if (b < a) return null;
        return h('div', {
            class: 'bc-cyc-seg ' + cls,
            style: { left: (((a - 1) / len) * 100) + '%', width: (((b - a + 1) / len) * 100) + '%' },
        });
    };
    const bar = h('div', { class: 'bc-cycbar' });
    const periodSeg = seg(1, cur, 'bc-cyc-period');
    bar.appendChild(periodSeg);

    /**
     * ★ 2026-11-13：天数一变只改这几处（原来整块重画：最多九十颗 chip 全删了重建，
     *   点一下卡一下、滚动位置也会跳）✓
     */
    function paintDays() {
        // 这一格亮到「本周期实际算到第几天」—— 写的数比上限长时，亮的还是上限那几颗 ✓
        const eff = Math.max(1, Math.min(days, cap));
        for (let i = 0; i < chipEls.length; i += 1) {
            const on = (i + 1) <= eff;
            const el = chipEls[i];
            if (!el) continue;
            if (on) el.classList.add('on'); else el.classList.remove('on');
        }
        try {
            if (document.activeElement !== daysInput) daysInput.value = String(days);
        } catch { /* 忽略 */ }
        try { say.textContent = headText(); } catch { /* 忽略 */ }
        try {
            if (periodSeg) {
                const b = Math.max(1, Math.min(len, eff));
                periodSeg.style.width = ((b / len) * 100) + '%';
            }
        } catch { /* 忽略 */ }
    }
    // ★ 2026-11-13（第二批）：窗口尾部按这一族的卵子存活时间铺（人类还是排卵日 +1 ✓）
    const eggDays = (() => {
        try { return eggWindowDaysOf(targetKey, len, ovu); } catch { return 1; }
    })();
    if (ovu !== null) bar.appendChild(seg(ovu - 1, ovu + eggDays, 'bc-cyc-window'));
    box.appendChild(field('周期简图',
        h('div', { class: 'bc-period-valuebox' },
            bar,
            h('span', { class: 'bc-period-legend' },
                h('span', { class: 'bc-cyc-dot bc-cyc-period' }), h('span', { text: '经期' }),
                h('span', { class: 'bc-cyc-dot bc-cyc-window' }), h('span', { text: '排卵窗口' }),
            ),
        ),
    ));

    // ---- 档位 ----
    box.appendChild(field('经量', inline(dropdown(prefs0.flow, FLOW_OPTS, (v) => savePrefs({ flow: v }, false))),
        '这一档决定面板上的流量和颜色怎么写：少、中、多'));
    box.appendChild(field('痛经', inline(dropdown(prefs0.pain, PAIN_OPTS, (v) => savePrefs({ pain: v }, false))),
        '这一档是基础痛经程度；走势在下面那一格选'));

    // 痛经走势：默认逐天减轻；「全程保持」给整个经期都疼的人；自定义可以逐天点 ✓
    const PATTERN_OPTS = [
        ['descend', '逐天减轻'],
        ['steady', '全程保持'],
        ['front', '只头几天疼'],
        ['custom', '自定义'],
    ];
    box.appendChild(field('痛经走势', inline(dropdown(prefs0.painPattern, PATTERN_OPTS, (v) => savePrefs({ painPattern: v }))),
        '默认逐天减轻；想整个经期都疼，选全程保持'));

    if (prefs0.painPattern === 'custom') {
        // ★★ 2026-11-12（她两次截图）—— ① 自定义要「点击选择」，别一下下循环点；
        //   ② 五个下拉铺满整行太占地方 ⇒ 每天一格窄下拉、两列排，整块默认收起，
        //      收起那一行直接写出「哪几天单独设了」（不看展开也知道现在什么状态 ✓）
        const PAIN_LEVELS = [['', '跟基础档'], ['无', '无'], ['轻', '轻'], ['中', '中'], ['重', '重']];
        const saved = Array.isArray(prefs0.painByDay) ? prefs0.painByDay : [];
        const rows = h('div', { class: 'bc-pain-days' });
        const statusText = (() => {
            const bits = [];
            for (let d = 1; d <= cur; d += 1) {
                if (PAIN_LEVELS.some((o) => o[0] === saved[d - 1] && o[0])) bits.push(`第 ${d} 天 ${saved[d - 1]}`);
            }
            return bits.length ? bits.join(' · ') : '全部跟基础档';
        })();
        for (let d = 1; d <= cur; d += 1) {
            const lvl = String(saved[d - 1] || '');
            const dd = dropdown(lvl, PAIN_LEVELS, (v) => {
                const arr = (periodPrefsOf(targetKey).painByDay || []).slice();
                arr[d - 1] = v;
                try { setPeriodPrefsOf(targetKey, { painByDay: arr }); } catch { /* 忽略 */ }
                repaintOnly();
            });
            rows.appendChild(h('div', { class: 'bc-pain-day' },
                h('span', { class: 'bc-hint', text: `第 ${d} 天` }),
                h('div', { class: 'bc-dd-host' }, dd),
            ));
        }
        box.appendChild(foldBar('painDays', '每天各一档',
            // ⚠️ 这一层必须带 bc-period-foldbody —— 那个类给 8px 上间距（别的两块折叠也是这样）
            h('div', { class: 'bc-period-foldbody' },
                rows,
                h('div', { class: 'bc-hint bc-pain-note', text: '每天各选一次；选「跟基础档」就跟上面「痛经」那一档走' })),
            statusText));
    }

    let leadTimer = null;
    const leadInput = numberInput(prefs0.pmsLead, (v) => {
        clearTimeout(leadTimer);
        leadTimer = setTimeout(() => {
            const n = Math.round(Number(v));
            if (Number.isFinite(n) && n >= 1) {
                try { setPeriodPrefsOf(targetKey, { pmsLead: n }); } catch { /* 忽略 */ }
                say.textContent = headText();
            }
        }, 500);
    }, { min: 1, max: 15 });
    leadInput.classList.add('bc-period-lead');

    box.appendChild(field('经前综合征（PMS）',
        h('div', { class: 'bc-period-valuebox' },
            inline(onOffDropdown(prefs0.pms, (v) => savePrefs({ pms: v })),
                h('span', { class: 'bc-hint', text: '提前' }), leadInput, h('span', { class: 'bc-hint', text: '天开始' })),
        ),
        'PMS 是月经来之前那几天出现的一串反应：乳房胀痛、腹胀、情绪起伏、食欲变化、轻微水肿，月经一开始就慢慢缓解。'
        + '开着时，进入经前这几天会把这些当参考；关掉就不提',
    ));

    // 基础体温：说清是什么、谁高谁低，写法让人自己填
    let tempTimer = null;
    const tempTextInput = textInput(prefs0.tempText || '', (v) => {
        clearTimeout(tempTimer);
        tempTimer = setTimeout(() => {
            try { setPeriodPrefsOf(targetKey, { tempText: v }); } catch { /* 忽略 */ }
        }, 500);
    }, { placeholder: '写法（留空就自动）', class: 'bc-period-style' });
    box.appendChild(field('基础体温',
        inline(onOffDropdown(prefs0.temp, (v) => savePrefs({ temp: v })), tempTextInput),
        '基础体温是早上刚醒、还没起身时量的体温。月经期偏低，排卵后会升高 0.3 到 0.5 度，下次月经前又降下来。'
        + '这一格填的是正文里怎么描述它，留空就按阶段自动写',
    ));

    // ---- 表现清单（收起）----
    const listBody = h('div', { class: 'bc-period-foldbody' });
    {
        const saveItems = (items) => savePrefs({ items });
        const setItem = (name, patch) => {
            const items = periodPrefsOf(targetKey).items.map((it) => (it.name === name ? { ...it, ...patch } : it));
            saveItems(items);
        };
        const list = h('div', { class: 'bc-period-items' });
        for (const it of prefs0.items) {
            const rowEl = h('div', { class: 'bc-period-item' });
            rowEl.appendChild(checkRow(it.name, it.on, (v) => setItem(it.name, { on: v })));
            let noteTimer = null;
            const noteInput = textInput(it.note || '', (v) => {
                clearTimeout(noteTimer);
                noteTimer = setTimeout(() => {
                    const items = periodPrefsOf(targetKey).items.map((x) => (x.name === it.name ? { ...x, note: v } : x));
                    try { setPeriodPrefsOf(targetKey, { items }); } catch { /* 忽略 */ }
                }, 500);
            }, { placeholder: '补充说明（可选）', class: 'bc-period-note' });
            rowEl.appendChild(noteInput);
            if (!it.builtin) {
                rowEl.appendChild(button('删', () => {
                    const items = periodPrefsOf(targetKey).items.filter((x) => x.name !== it.name);
                    saveItems(items);
                }, { title: '删掉这一条' }));
            }
            list.appendChild(rowEl);
        }
        listBody.appendChild(list);

        const addInput = textInput('', () => { }, { placeholder: '加一条（例如：恶心）', class: 'bc-period-add' });
        const addBtn = button('添加', () => {
            const name = String(addInput.value || '').trim();
            if (!name) { say.textContent = '先写一条要加什么'; return; }
            const items = periodPrefsOf(targetKey).items;
            if (items.some((x) => x.name === name)) { say.textContent = '已经有这一条了'; return; }
            addInput.value = '';
            saveItems([...items, { name, on: true, note: '' }]);
        }, { title: '加到清单末尾' });
        listBody.appendChild(h('div', { class: 'bc-period-addrow' }, addInput, addBtn));
        listBody.appendChild(h('div', { class: 'bc-hint', text: '勾上表示这个人经期会有这一项；内置 8 条不能删，自己加的可以删' }));
    }
    box.appendChild(foldBar('items', '经期表现清单', listBody));

    // ---- 颜色与质地写法（收起）----
    const styleBody = h('div', { class: 'bc-period-foldbody' });
    {
        let colorTimer = null;
        const colorInput = textInput(prefs0.color, (v) => {
            clearTimeout(colorTimer);
            colorTimer = setTimeout(() => {
                try { setPeriodPrefsOf(targetKey, { color: v }); } catch { /* 忽略 */ }
            }, 500);
        }, { placeholder: '留空就按档位自动生成', class: 'bc-period-style' });
        let texTimer = null;
        const texInput = textInput(prefs0.texture, (v) => {
            clearTimeout(texTimer);
            texTimer = setTimeout(() => {
                try { setPeriodPrefsOf(targetKey, { texture: v }); } catch { /* 忽略 */ }
            }, 500);
        }, { placeholder: '留空就按档位自动生成', class: 'bc-period-style' });
        styleBody.appendChild(row('颜色', colorInput));
        styleBody.appendChild(row('质地', texInput));
    }
    box.appendChild(foldBar('style', '颜色与质地写法', styleBody));

    box.appendChild(h('div', { class: 'bc-period-statusline' }, say));
    return box;
}
