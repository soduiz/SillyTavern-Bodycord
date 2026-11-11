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
import { periodDaysOf, periodDaysCapOf, bodyCycleParamsOf } from './settings.js';

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

    const savePrefs = (patch) => {
        try { setPeriodPrefsOf(targetKey, patch); } catch { /* 忽略 */ }
        repaintOnly();
    };

    // ---- 经期天数 ----
    const cap = periodDaysCapOf(targetKey);
    const cur = periodDaysOf(targetKey);
    let bp = { cycle: 28, ovu: 14 };
    try { bp = bodyCycleParamsOf(targetKey); } catch { /* 用默认 */ }
    const len = Math.max(5, Math.min(90, Math.round(Number(bp.cycle) || 28)));
    const ovu = (bp.ovu === null || bp.ovu === undefined) ? null : Math.round(Number(bp.ovu));

    const setDays = (n) => {
        // ★ 2026-11-11：天数存进设置（不再往补丁正文里写）—— 同一个数只留一处 ✓
        try { setPeriodPrefsOf(targetKey, { days: n }); } catch { /* 忽略 */ }
        repaintOnly();
    };

    const grid = h('div', { class: 'bc-daygrid' });
    for (let d = 1; d <= cap; d += 1) {
        const chip = h('div', {
            class: 'bc-daychip' + (d <= cur ? ' on' : ''),
            text: String(d),
            title: '经期到第 ' + d + ' 天结束',
        });
        chip.onclick = () => setDays(d);
        grid.appendChild(chip);
    }

    let daysTimer = null;
    const daysInput = numberInput(cur, (v) => {
        clearTimeout(daysTimer);
        daysTimer = setTimeout(() => {
            const n = Math.round(Number(v));
            if (Number.isFinite(n) && n >= 1) setDays(n);
        }, 500);
    }, { min: 1, max: cap });
    daysInput.classList.add('bc-period-days');

    const capTip = '最多第 ' + cap + ' 天'
        + (ovu !== null ? '（第 ' + Math.max(1, ovu - 1) + ' 天起是排卵窗口）' : '');

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
    bar.appendChild(seg(1, cur, 'bc-cyc-period'));
    if (ovu !== null) bar.appendChild(seg(ovu - 1, ovu + 1, 'bc-cyc-window'));
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
    box.appendChild(field('经量', inline(dropdown(prefs0.flow, FLOW_OPTS, (v) => savePrefs({ flow: v }))),
        '这一档决定面板上的流量和颜色怎么写：少、中、多'));
    box.appendChild(field('痛经', inline(dropdown(prefs0.pain, PAIN_OPTS, (v) => savePrefs({ pain: v }))),
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
