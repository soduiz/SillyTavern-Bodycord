/**
 * ui-dice.js —— 「骰子」页
 *
 * 两种模式：
 *   池模式（默认）：插件发一组随机数，推演引擎「用得上才取用」，并回报取了哪个
 *   清单模式：老行为，你自己指定要哪些骰子
 */

import {
    poolMode, currentPool, rerollPool, clearPool,
    isLocked, lock, getLastUsage,
    entries, rollOne, clearOne, fillEmpty, rollAll, clearAll,
    addEntry, addPreset, removeEntry, updateEntry, missingPresets,
    IMPLANT_DAYS, DICE_PRESETS, parseExpr, rollExpr, poolSummary, usageMatchesPool,
    poolSlotTakenBy, shortRef, usedNameOf, usedResultOf, recordUsage,
} from './dice.js';
import { settings, save, resetDiceDefaults } from './settings.js';
import { state, fetusPlanOf, rollRetroMixed, heritageRollsOf } from './store.js';
import { h, clear, button, toggle, modal, textInput, dropdown, section, helpButton, askConfirm } from './dom.js';

/**
 * 「骰子模式」那张卡的说明（★ 减密度：全进标题右边那个「？」✓）
 *
 * ⚠️ 原来这些字是**单独一张「它是怎么工作的」卡片 + 三四处小灰字**铺在页面上的，
 *   规矩是：页面只留 ⚠️ 警告 / 当前状态读数 / 小标题，其余一律走「？」弹窗 ✓
 */
const MODE_HELP = [
    '随机数池（默认）：插件每轮生成一组编号随机数，插件 API 只能「取用」不能自己编',
    '固定骰子清单：老做法，你自己指定要哪几颗骰子，推演时按清单给它',
    '插件 API 只在这一轮真的要算时才会取随机数，没触发就不取，所以不会乱给数',
    '每轮推演前会自动换一组新的池子；把「锁定」打开之后这一组就固定不变',
    '已经定下的结果（受精、着床日、胎数、同卵还是异卵、性别、致孕方）沿用旧值，不会再变',
    '清单模式下「推演前自动把没掷的补上」关掉之后，只有你手动掷过的骰子才会给插件 API',
];

/** 「本轮随机数池」/「上一轮取用了哪些」的说明 */
const POOL_HELP = [
    '一百面池（R1、R2…）给 1-100 的计算用，五面池（S1、S2…）给 1-5 的计算用（比如着床天数）',
    '这一轮被取用过的格子会压暗、虚线边，后面写上它被用在哪',
    '插件自己掷的那几颗（受精 / 着床 / 精子存活 / 孕期）不占池格，所以池子上不会多个字，它们只出现在下面「上一轮取用了哪些」里',
    '锁定 = 这一组随机数固定不变，推演会一直用它；关掉之后每轮推演前自动换一组新的',
];
const USED_HELP = [
    '这里显示上一轮推演到底取用了哪几个随机数、分别用在哪个判定上',
    '每一行右边会标明是谁掷的：「引擎取」= 插件 API 按规则从随机数池里取的；「插件掷」= 插件自己掷的（受精判定 / 着床判定 / 着床天数 / 精子存活 / 胎数判定 / 同卵 / 异卵判定 / 子N性别）',
    '最左边那个标签：「R3」「S1」是从池子里取的第几格；「预设 D5」是清单模式的预设骰；「独立掷 1~7」是插件自己掷的、后面跟的是取值范围（不占池格，鼠标停上去能看到完整来路）',
    '「引擎取」的那些会和本轮池子逐个核对：编号不在池子里，会标一个「不在池里」（值不用它报，插件按编号自己去池子里查）',
    '标了「不在池里」的意思是这个数字不是插件给的（模型自己报的），不拦、也不改判定，只是让你看得见',
];
// ⚠️ 这两组各删掉一条 —— 它们跟同一张卡上的**空态文字**逐字重复
//   （池子空态写着"点下面的「重新生成一组」…"、取用空态写着"这一轮没取用随机数"）✗

/** 取用记账的显示单位（显示名 / 结果回推统一走 dice.js 的 usedNameOf / usedResultOf ✓） */
const USED_UNIT = { '精子存活': ' 天' };

// ---------------------------------------------------------------------------
// 池模式
// ---------------------------------------------------------------------------

function renderPoolMode(container, ctx) {
    const s = settings();
    const repaint = () => renderDiceTab(container, ctx);
    const c = { ...ctx, repaint };
    const pool = currentPool();

    // ★★ 这一轮池子里**哪几格被吃掉了**
    //   判据直接用 `poolSlotTakenBy()` —— 和「模型自报核对」是同一套：
    //   **编号和值都对得上才算占格** ⇒ 模型瞎编的编号不会把池格误标成已用 ✓
    //   ⚠️ 插件独立掷的那几颗（受精判定 / 着床判定 / 精子存活 / 孕期）ref 是来源描述、
    //      不是 `R3` / `S1` ⇒ 这里自然返回 null，池子上不会乱标 ✓
    //   ⚠️ 不会跨轮错位：`rerollPool()` 同时清 `lastRollUsage` ⇒ 池子和记账天然同一轮 ✓
    const usedSlots = new Map();
    if (pool) {
        for (const u of (getLastUsage() || [])) {
            const slot = poolSlotTakenBy(u, pool);
            if (!slot) continue;
            if (!usedSlots.has(slot)) usedSlots.set(slot, []);
            usedSlots.get(slot).push(u);
        }
    }

    /** 一格池子骰子；被取用过就压暗、虚线边，尾巴挂上用途 */
    const poolChip = (ref, value, extraClass) => {
        const hits = usedSlots.get(ref);
        const purpose = hits
            ? [...new Set(hits.map(u => String(usedNameOf(u)).trim()).filter(Boolean))].join('、')
            : '';
        const who = hits
            ? [...new Set(hits.map(u => (u.by === 'plugin' ? '插件掷' : '引擎取')))].join('、')
            : '';
        return h('div', {
            class: 'bc-pool-chip' + (extraClass ? ' ' + extraClass : '') + (hits ? ' bc-pool-chip-used' : ''),
            title: hits ? `已取用：${purpose || '未知判定'}（${who}）` : null,
        },
            h('span', { class: 'bc-pool-ref', text: ref }),
            h('span', { class: 'bc-pool-val', text: String(value) }),
            hits ? h('span', { class: 'bc-pool-used-tag', text: purpose || '已取用' }) : null,
        );
    };

    // ================= 卡片：本轮随机数池 =================
    // ★ 标题行右边挂着读数（池子摘要）和「锁定」⇒ 这张卡自己拼标题行，
    //   再挂一个「？」（说明走弹窗 ✓）
    const poolCard = h('div', { class: 'bc-section' });
    poolCard.appendChild(h('div', { class: 'bc-section-title bc-title-row' },
        h('span', { text: '本轮随机数池' }),
        helpButton('本轮随机数池', POOL_HELP),
        h('div', { class: 'bc-spacer' }),
        h('span', { class: 'bc-dice-summary', text: poolSummary() }),
        h('div', { class: 'bc-inline' },
            h('span', { class: 'bc-label', text: '锁定' }),
            toggle(isLocked(), (v) => { lock(v); repaint(); }),
        ),
    ));

    const pb = h('div', { class: 'bc-section-body' });
    poolCard.appendChild(pb);

    if (!pool) {
        // 空态：说清下一步怎么做（不是"说明"，是状态 + 动作 ✓）
        pb.appendChild(h('div', { class: 'bc-hint', text: '还没有生成。点下面的「重新生成一组」，或者直接推演一次' }));
    } else {
        const grid = h('div', { class: 'bc-pool-wrap' });
        grid.appendChild(h('div', { class: 'bc-pool-title', text: '一百面池 · 给 1-100 的判定用' }));
        const rRow = h('div', { class: 'bc-pool-row' });
        (pool.R || []).forEach((v, i) => {
            rRow.appendChild(poolChip(`R${i + 1}`, v));
        });
        grid.appendChild(rRow);

        grid.appendChild(h('div', { class: 'bc-pool-title', text: '五面池 · 给 1-5 的判定用（例如着床天数）' }));
        const sRow = h('div', { class: 'bc-pool-row' });
        (pool.S || []).forEach((v, i) => {
            sRow.appendChild(poolChip(`S${i + 1}`, v, 'bc-pool-chip-s'));
        });
        grid.appendChild(sRow);
        pb.appendChild(grid);
    }

    pb.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('重新生成一组', () => { rerollPool(); repaint(); }, { variant: 'primary' }),
        button('清空', () => { clearPool(); repaint(); }),
    ));
    container.appendChild(poolCard);

    // ★ 2026-10-24（她：重新 ROLL 后还是不显示同卵/异卵）——
    //   「上一轮取用了哪些」可能因为重生成池子/这一轮没掷而空；胎数、同卵异卵是**这一胎定下的结果**，
    //   直接读 fetusPlan 显示，跟取用记录在不在无关 ✓
    {
        const plan = (() => { try { return fetusPlanOf(state().active); } catch { return null; } })();
        if (plan && Number(plan.count) >= 2) {
            let label = '未判';
            if (plan.sameOvum === true) label = '同卵';
            else if (plan.sameOvum === false) {
                const hasSame = (plan.groups || []).some((g) => g && g.same && Array.isArray(g.kids) && g.kids.length > 1);
                label = hasSame ? '混合（一对同卵 + 其余异卵）' : '异卵';
            }
            const card = section('本胎判定');
            const body = card.querySelector('.bc-section-body');
            body.appendChild(h('div', { class: 'bc-hint', text: `${plan.count} 胎 · ${label}` }));
            // ★ 2026-10-24：旧规则下判成的异卵，可补一颗「混合胎判定」（只补这一颗，不改胎数）
            if (Number(plan.count) >= 3 && plan.sameOvum === false && !plan.mixedChecked) {
                body.appendChild(button('补判混合胎', () => {
                    const r = rollRetroMixed(state().active);
                    if (!r.ok) { window.toastr?.warning?.(r.reason || '补判没成'); return; }
                    try {
                        recordUsage([...getLastUsage(), {
                            for: '混合胎判定（补判）', value: r.value, by: 'plugin',
                            result: r.mixed ? `混合（子${r.pair[0]}、子${r.pair[1]} 同卵）` : '不混合',
                        }]);
                    } catch { /* 忽略 */ }
                    window.toastr?.[r.mixed ? 'success' : 'info']?.(
                        r.mixed ? `命中混合：子${r.pair[0]}、子${r.pair[1]} 同卵` : `没中（${r.value}），保持全异卵`);
                    try { repaint(); } catch { /* 忽略 */ }
                }));
            }
            container.appendChild(card);
        }
    }

    // ★ 2026-10-24：天赋判定与显性来源（这一胎定下的结果，直接读对象级那份记录，跟取用记录在不在无关）
    {
        const rolls = (() => { try { return heritageRollsOf(state().active); } catch { return null; } })();
        const tal = rolls && rolls.talent;
        const dom = rolls && rolls.domSrc;
        if ((tal && Array.isArray(tal.groups) && tal.groups.length)
            || (dom && Array.isArray(dom.groups) && dom.groups.length)) {
            const card = section('本胎的天赋与显性来源');
            const tb = card.querySelector('.bc-section-body');
            for (const g of (dom?.groups || [])) {
                const who = (g.kids || []).map((i) => `子${Number(i) + 1}`).join('、') || '整批';
                tb.appendChild(h('div', { class: 'bc-hint', text: `显性来源 · ${who}${g.same ? '（同卵）' : ''}：掷出 ${g.roll} · ${g.mode}` }));
            }
            for (const g of (tal?.groups || [])) {
                const who = (g.kids || []).map((i) => `子${Number(i) + 1}`).join('、') || '整批';
                tb.appendChild(h('div', { class: 'bc-hint', text: `天赋 · ${who}${g.same ? '（同卵）' : ''}：掷出 ${g.roll} · ${g.tier}` }));
            }
            tb.appendChild(h('div', { class: 'bc-hint', text: '只掷一次，之后沿用；撤销或回滚才会重掷' }));
            container.appendChild(card);
        }
    }

    // ================= 卡片：上一轮取用了哪些 =================
    // ★ 这一份记账里混着**两类**来源 ——
    //   引擎按规则从池里取的（它自己在 rollsUsed 里报）＋ 插件自己掷的（受精判定 / 着床判定 / 着床天数 / 精子存活 / 胎数判定 / 同卵 / 异卵判定 / 子N性别）。
    //   原来两条长得一模一样，看着像"这一轮取了 5 个"，其实有几颗是插件掷的 ✗
    //   ⇒ 现在按 `by` 分别标出来（存进 lastUsed 的时候就打好了，界面只读 ✓）
    const used = getLastUsage();
    // ★ 数字要带单位、名字要写全（跟「推演记录」页同一个口径）——
    //   原来只印「精子存活 3」，会被读成"只有 3 批"
    //   `USED_LABEL` / `USED_UNIT` 已经提到文件顶部（池格标记也用同一套 ✓）
    // 「着床天数」那一笔记的是掷出来的 1~5，真天数是查表换算的（3 ⇒ 8 天）——
    //   只印 3 会被当成"3 天"（为什么这里是 3那一类的误读 ✗）
    const usedValue = (u) => {
        if (u.for === '着床天数') {
            const n = Number(u.value);
            const days = IMPLANT_DAYS[n];
            if (days) return `${days} 天（掷出 ${n}）`;
        }
        // ★ 2026-10-23：同卵 / 异卵判定把结果一起写出来（89（异卵）），
        //   不然只看一个 89 会以为"掷出来的就是同卵" ✓
        const rr = usedResultOf(u);
        const extra = rr ? `（${rr}）` : '';
        return String(u.value ?? '—') + (USED_UNIT[u.for] || '') + extra;
    };
    const usedCard = section('上一轮取用了哪些', { help: USED_HELP });
    const ub = usedCard.querySelector('.bc-section-body');
    if (!used) {
        // ★ 空数组 ≠ null：null 是"这个聊天还没有过记录" ✓
        ub.appendChild(h('div', { class: 'bc-hint', text: '这个聊天还没有推演记录' }));
    } else if (!used.length) {
        ub.appendChild(h('div', { class: 'bc-hint', text: '上一轮没有取用任何随机数（也就是没触发随机判定）' }));
    } else {
        for (const u of used) {
            const byPlugin = u.by === 'plugin';
            // ★ 短标签替代来源长句（`精子存活专用掷（1~7 天，均匀）` ⇒ `独立掷 1~7`）——
            //   原句挂进 title，悬停还能看到完整来路 ✓
            const refShort = shortRef(u.ref);
            const refLong = String(u.ref || '');
            // ★★ **核对模型自报的取用**
            //   模型要是编一个池子里没有的编号 / 值对不上，这里就标出来 ✓
            //   ⚠️ 只**提示**、不拦（模型报得可疑该让玩家看见，而不是让这一轮静默失败）
            //   ⚠️ 只在池模式下核：清单模式没有 R1/S1 这种编号，硬比会全变假警报 ✗
            //   ⚠️ 也只在**回看池子还留着**时核（重生成 / 清空之后就不比了 ✓）
            const poolNow = poolMode() ? currentPool() : null;
            const okPool = !poolNow ? true : usageMatchesPool(u, poolNow);
            ub.appendChild(h('div', { class: 'bc-usage-row' },
                h('span', {
                    class: 'bc-usage-ref', text: refShort,
                    title: refLong && refLong !== refShort ? refLong : null,
                }),
                h('span', { class: 'bc-usage-val', text: usedValue(u) }),
                h('span', { class: 'bc-usage-for', text: usedNameOf(u) }),
                okPool ? null : h('span', { class: 'bc-usage-bad', text: '不在池里' }),
                h('span', { class: 'bc-usage-by', text: byPlugin ? '插件掷' : '引擎取' }),
            ));
        }
    }
    container.appendChild(usedCard);

    // ================= 卡片：池子大小 =================
    // ★ 减密度：那句「数字越多越能应付…」搬进「？」✓
    //   ⚠️⚠️ `section()` 的配置对象**必须放最后** —— 放中间会被当成普通子节点
    //     塞进 DOM，页面上直接显示 `[object Object]` 而且「？」根本不出现 ✗
    //     （这一坑早就在 memory 里记着，又踩了一遍 ⇒ 下面加了断言锁住 ✓）
    container.appendChild(section('池子大小',
        h('div', { class: 'bc-row bc-row-wrap' },
            h('div', { class: 'bc-field' },
                h('label', { class: 'bc-label', text: '一百面池个数' }),
                h('input', {
                    class: 'bc-input', type: 'number', min: 4, max: 40, value: s.dice.poolSize,
                    oninput: (e) => { s.dice.poolSize = Number(e.target.value) || 14; save(); },
                }),
            ),
            h('div', { class: 'bc-field' },
                h('label', { class: 'bc-label', text: '五面池个数' }),
                h('input', {
                    class: 'bc-input', type: 'number', min: 1, max: 10, value: s.dice.smallSize,
                    oninput: (e) => { s.dice.smallSize = Number(e.target.value) || 4; save(); },
                }),
            ),
        ),
        {
            help: [
                '数字越多越能应付「一轮里触发很多判定」的情况，但绝大多数轮次只用得到一两个',
                '池子只是准备了多少个随机数，不额外花 token',
            ],
        },
    ));
}

// ---------------------------------------------------------------------------
// 清单模式（老行为）
// ---------------------------------------------------------------------------

function diceRow(e, ctx) {
    const valText = e.value == null ? '未掷' : String(e.value);
    const isD5 = e.id === 'D5' && IMPLANT_DAYS[e.value];

    const row = h('div', { class: 'bc-dice-row' + (e.value != null ? ' rolled' : '') });
    row.appendChild(h('div', { class: 'bc-dice-id' }, h('b', { text: e.id })));

    const labelInput = textInput(e.label || '', (v) => updateEntry(e.id, { label: v }), { placeholder: '用途' });
    labelInput.classList.add('bc-dice-label-input');
    row.appendChild(labelInput);

    const exprInput = textInput(e.expr || '1d100', (v) => {
        updateEntry(e.id, { expr: v });
        ctx?.repaint?.();
    }, { placeholder: '1d100' });
    exprInput.classList.add('bc-dice-expr-input');
    if (!parseExpr(e.expr)) exprInput.classList.add('bad');
    row.appendChild(exprInput);

    row.appendChild(h('div', { class: 'bc-dice-val' + (e.value == null ? ' empty' : '') },
        h('span', { text: valText }),
        isD5 ? h('small', { text: `→ ${IMPLANT_DAYS[e.value]} 天` }) : null,
    ));

    row.appendChild(h('div', { class: 'bc-dice-ops' },
        button('掷', () => { rollOne(e.id); ctx?.repaint?.(); }, { variant: 'primary' }),
        button('清', () => { clearOne(e.id); ctx?.repaint?.(); }),
        button('✕', () => { removeEntry(e.id); ctx?.repaint?.(); }),
    ));
    return row;
}

function renderListMode(container, ctx) {
    const s = settings();
    const repaint = () => renderDiceTab(container, ctx);
    const c = { ...ctx, repaint };
    const list = entries();

    container.appendChild(h('div', { class: 'bc-toolbar' },
        h('span', { class: 'bc-toolbar-label', text: '本轮骰值' }),
        h('span', { class: 'bc-dice-summary', text: poolSummary() }),
        h('div', { class: 'bc-spacer' }),
        h('div', { class: 'bc-inline' },
            h('span', { class: 'bc-label', text: '锁定' }),
            toggle(isLocked(), (v) => { lock(v); repaint(); }),
        ),
    ));

    container.appendChild(h('div', { class: 'bc-dice-row bc-dice-head' },
        h('div', { class: 'bc-dice-id', text: '编号' }),
        h('div', { class: 'bc-dice-label-input', text: '用途' }),
        h('div', { class: 'bc-dice-expr-input', text: '骰式' }),
        h('div', { class: 'bc-dice-val', text: '结果' }),
        h('div', { class: 'bc-dice-ops', text: '操作' }),
    ));

    if (!list.length) container.appendChild(h('div', { class: 'bc-hint', text: '清单是空的。从下面挑几颗加进来吧' }));
    else for (const e of list) container.appendChild(diceRow(e, c));

    container.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('把没掷的补上', () => { const n = fillEmpty(); repaint(); window.toastr?.info?.(n ? `补掷了 ${n} 颗` : '没有需要补的'); }, { variant: 'primary' }),
        button('全部重掷', () => { rollAll(); repaint(); }),
        button('全部清空', () => { clearAll(); repaint(); }),
        button('＋ 自定义骰子', () => openAddCustom(c)),
    ));

    container.appendChild(h('div', { class: 'bc-section' },
        h('div', { class: 'bc-section-title bc-title-row' },
            h('span', { text: '常用骰子（点一下就加进清单）' }),
            helpButton('常用骰子', [
                '这些骰子的编号和含义是固定的，点一下就加进上面的清单',
                ...DICE_PRESETS.map(p => `${p.id}　${p.label}　${p.note}`),
            ]),
        ),
        h('div', { class: 'bc-section-body' }, presetChips(c)),
    ));

    // ★ 减密度：原来这里有一整段 `bc-help` 铺着每颗骰子的用途说明
    //   （十几行）⇒ 已经搬进上面那张卡右上角的「？」✓
    //   「推演前自动补掷」关掉之后的后果也搬进了「骰子模式」那张卡的「？」✓
    container.appendChild(h('div', { class: 'bc-switch-row' },
        h('div', {},
            h('div', { class: 'bc-label', text: '推演前自动把没掷的补上' }),
        ),
        toggle(s.dice.autoRoll !== false, (v) => { s.dice.autoRoll = v; save(); }),
    ));
}

function presetChips(ctx) {
    const miss = missingPresets();
    if (!miss.length) return h('div', { class: 'bc-hint', text: '常用骰子都已经在清单里了' });
    const wrap = h('div', { class: 'bc-chip-list' });
    for (const p of miss) {
        wrap.appendChild(h('span', {
            class: 'bc-chip bc-chip-add', title: p.note,
            onclick: () => { addPreset(p.id); ctx?.repaint?.(); },
        }, h('span', { text: '＋ ' + p.id + ' ' + p.label })));
    }
    return wrap;
}

function openAddCustom(ctx) {
    let label = '';
    let expr = '1d100';
    let labelEl = null, exprEl = null, preview = null;

    const upd = () => {
        if (!preview) return;
        const r = parseExpr(expr);
        const sample = r ? rollExpr(expr) : null;
        preview.textContent = r
            ? `骰式合法：${r.n} 颗 ${r.faces} 面　示例：${sample.value}`
            : '骰式不合法，请写成 1d100、2d6、1d100+5 这种形式';
        preview.style.color = r ? '' : 'var(--bc-red)';
    };

    modal({
        title: '加一颗自定义骰子',
        width: 560,
        build: (body) => {
            body.appendChild(h('div', { class: 'bc-field' },
                h('label', { class: 'bc-label', text: '用途' }),
                labelEl = textInput('', v => { label = v; }, { placeholder: '例如：双胞胎概率' }),
            ));
            body.appendChild(h('div', { class: 'bc-field' },
                h('label', { class: 'bc-label', text: '骰式' }),
                exprEl = textInput('1d100', v => { expr = v; upd(); }, { placeholder: '1d100' }),
            ));
            preview = h('div', { class: 'bc-hint' });
            body.appendChild(preview);
            upd();
        },
        onSave: () => {
            if (labelEl) label = labelEl.value.trim();
            if (exprEl) expr = exprEl.value.trim();
            if (!parseExpr(expr)) { window.toastr?.error?.('骰式不合法'); return false; }
            const id = label || ('自定义' + (entries().length + 1));
            addEntry(id, label || id, expr);
            ctx?.repaint?.();
        },
    });
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function renderDiceTab(container, ctx = {}) {
    clear(container);
    const repaint = () => renderDiceTab(container, ctx);
    const c = { ...ctx, repaint };
    const s = settings();

    // ---- 模式切换（卡片） ----
    // ★ 减密度：这一页原来铺着「骰子模式」一句小灰字 + 一整张
    //   「它是怎么工作的」卡片（4 条）+ 清单模式底下十几行骰子用途说明
    //   ⇒ 全搬进「？」弹窗，页面上只留读数 / 空态 / 小标题 ✓
    const modeCard = section('骰子模式', { help: MODE_HELP });
    const mb = modeCard.querySelector('.bc-section-body');
    mb.appendChild(dropdown(s.dice.mode === 'list' ? 'list' : 'pool', [
        ['pool', '随机数池 · 用得上才取用（推荐）'],
        ['list', '固定骰子清单 · 你自己指定要哪几颗'],
    ], (v) => { s.dice.mode = v; save(); repaint(); }, { class: 'bc-dd-wide' }));
    // 「恢复骰子默认值」原来挂在「它是怎么工作的」那张卡下面，那张卡没了 ⇒ 挪到这里 ✓
    mb.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('恢复骰子默认值', async () => {
            // ★ 它会把你**自己加过的骰子清单**一起清掉（`entries` 回 null）⇒
            //   破坏性动作必须**先问一次**（原来直接执行、title 只说"不碰什么"，代价一个字没提 ✗）
            if (!(await askConfirm('把骰子设置恢复成出厂默认？\n\n你自己加过的骰子清单会一起没掉，其余设置（接口、追踪对象、图标）不受影响'))) return;
            resetDiceDefaults();
            repaint();
            window.toastr?.success?.('骰子设置已恢复默认');
        }, { title: '恢复成出厂默认（自定义骰子清单会一起清掉），不影响接口、追踪对象和图标' }),
    ));
    container.appendChild(modeCard);

    if (poolMode()) renderPoolMode(container, c);
    else renderListMode(container, c);

    // 嵌进聊天面板侧栏时，不显示「悬浮球外观」—— 那一段属于插件自己的外观设置，
    // 放在面板的骰子频道里没意义
    if (ctx.embedded) return;

    // ⚠️ 下面这段（原来的「悬浮球外观」+「上次推演」）**已经是死代码**：
    //   调用点只有 bodycord.js 里那一处（`{ embedded: true }`）⇒ 上面这行必然提前 return；
    //   而且 `ctx.lastRun` 全仓也没有任何地方传进来 ✗ ⇒ 整段删掉 ✓
    //   （「悬浮球外观」已经搬去插件设置页了，这段注释只是留个来路说明）
}

