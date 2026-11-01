/**
 * ui-params.js —— 补丁卡片里的「数值」区块
 *
 * 这里只负责渲染字段本身（不带卡片外壳），
 * 外壳由 ui-modules.js 的卡片负责，这样可以把它嵌进每张补丁卡里。
 *
 * 设计原则：默认只让你改数值，结构动不了；但每张卡都有「全文」入口，
 * 想完全自由地改也随时能改 —— 所以不是限制，只是默认更安全。
 */

import {
    PARAM_SPECS, readParams, writeParams, readZoneRows, writeZoneRows, textOf,
    fieldDefaultOf,
    fertilityCoefOfTier, writeFertilityCoef, awarenessTierNameOf,
} from './params.js';
import {
    h, clear, button, textInput, numberInput, askConfirm, dropdown, helpButton, askText,
} from './dom.js';
import {
    listZonePresets, saveZonePreset, updateZonePreset, deleteZonePreset, getZonePreset,
} from './settings.js';
import {
    zonePresetOf, setZonePresetOf, setZoneTextOf, clearZoneTextOf,
    isUserKey, fertilityTierOf, fertilityManualOf, setFertilityManualOf,
    awarenessTierIdOf, setAwarenessTierIdOf,
} from './store.js';
// ★ 「属于哪个大类」那一格（和「角色基础信息」共用一份实现 ✓）
//   ＋ ★ 为什么规则补丁里面的身体补丁（生理设定）不能选择种族列表？✓
//     ⇒ 种族名那一格右边挂一颗「选…」，打开同一个常见种族名列表（自由输入照旧 ✓）
import { xenoClassField, openRaceNamePicker } from './ui-settings.js';

export function specOf(moduleId) {
    return PARAM_SPECS.find(s => s.moduleId === moduleId) || null;
}

/**
 * 参数面板标题右边那个「？」要说的几句话。
 *
 * ★ 减密度：这一块原来把说明直接铺在页面上（`spec.desc` 一句 + 底下两三行长灰字），
 *   和设置页一样挤 ✗ ⇒ 统一走「？」居中弹窗（定下的形态：页面只留警告 / 读数 / 小标题 ✓）。
 *   ⚠️ `spec.desc` 以前**根本没渲染过**（写在 params.js 里但没人用），现在顺手接上 ✓
 */
function paramHelpLines(spec) {
    const lines = [spec.desc];
    // ★ 受孕体质档：说明写进「？」里（页面只留读数 ✓）
    if (spec.moduleId === 'body_base') {
        lines.push('「日常体质系数」这个角色第一次推演时，推演会按它的角色设定判一个档填进来');
        lines.push('档位只有五档：很弱 0.8 / 偏弱 0.9 / 标准 1.0 / 偏强 1.15 / 很强 1.3');
        // ⚠️ 「你自己」那一份**没有**这个按钮、推演也不判档
        //   （见 fertilityNote 首行的 isUserKey 早退）⇒ 别写成"点那一格下面的…"让人去找 ✗
        lines.push('你自己改过就以你的为准，推演不会再覆盖；对象那一份想交回给推演，点那一格下面的「恢复按设定判」');
    }
    if (spec.moduleId === 'zones_custom') {
        // ★ 2026-10-15（敏感带再细化一点更好）：这两句**只给玩家看** ——
        //   「？」不进提示词 ⇒ 举例放这儿**不会**像以前放正文里那样被模型捡去当部位名 ✓✓
        //   （旧版正文里那句「耳后、颈侧、腰窝、大腿内侧」就是"部位名越长越细"的源头 ✗）
        lines.push('写得越具体越稳：写「脖子」，推演可能报成「后颈部」这种更细的叫法；写成「后颈」「颈侧」就对得上');
        lines.push('常见可以拆的：耳垂 / 耳后、后颈 / 颈侧、锁骨、肩胛、腰侧 / 腰窝、小腹、大腿内侧、膝内、脚踝');
    }
    if (spec.kind === 'list') {
        // ★ ① 别提"窗口最下面那个保存" —— 这张表也会在补丁页的模块卡里渲染，
        //   那边根本没有那个按钮 ✗；② 第二句跟 `spec.desc`（params.js 里那份）逐字重复，删掉 ✓
        lines.push('改完这张表，要点「保存」才生效');
    } else {
        lines.push('输入框改完会自动保存，下拉选完也立刻生效，不用另外点保存');
    }
    return lines.filter(Boolean);
}

function flash(el, text, ok = true) {
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? 'var(--bc-green)' : 'var(--bc-red)';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 1800);
}

/**
 * 生理期参数面板的「哪些词会上色」—— 一个开关 + 一块展开内容。
 *
 * 在生理期参数面板头部右边写上可以触发颜色的词（就是血啊、疼痛这种），
 *   如果没有匹配到这些字，默认不改颜色就行
 * 这些词要和 assets/bodycord.html 里的 flowLevel / PERIOD_COLORS / periodPainClass 对上。
 *
 * ★ 改：**展开那块从"浮层"改成"在头部下面占一整行"** ✓
 *   报障：上色词被挤没了，建议挪个位置（完全看不见字）✗
 *   根因：原来是 `position:absolute` 的浮层，挂在 flex 头部里面 ⇒ 会被祖先容器裁掉 /
 *   被下一张卡盖住 ✗ ⇒ 改成普通块、挂在头部**外面**，永远不会被裁 ✓
 *   ⚠️ 所以调用方必须把 `panel` 挂在 `.bc-param-head` **之后**，别塞回头里 ✗
 */
function colorHintParts() {
    const rows = [
        ['血量', '大量 · 很多 · 极多 · 汹涌 / 较多 · 偏多 · 多 / 中等 · 适中 · 一般 / 较少 · 偏少 · 少 / 点滴 · 微量 · 极少'],
        ['颜色', '黑褐 · 褐色 · 咖啡 / 深红 · 暗红 · 鲜红 · 红 / 粉红 · 粉 · 棕'],
        ['痛经', '剧烈 · 严重 · 重度 · 无法忍 / 明显 · 较重 · 很痛 · 强烈 / 中度 · 一般 · 尚可忍 / 轻微 · 轻度 · 隐隐 · 钝痛 · 坠胀'],
    ];
    const panel = h('div', { class: 'bc-colorhint-panel', style: { display: 'none' } },
        h('div', { class: 'bc-hint', text: '写这些词面板就会上色（顺序无所谓，认出哪个用哪个）：' }),
        ...rows.map(([k, v]) => h('div', { class: 'bc-colorhint-row' },
            h('b', { text: k }), h('span', { text: v }))),
        h('div', { class: 'bc-hint', text: '没写到这些词也没关系，照常显示文字，只是不改颜色' }),
    );
    const chip = button('🎨 上色词', () => {
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : '';
        chip.classList.toggle('on', !open);
    }, { title: '看看血量 / 颜色 / 痛经写什么词会上色' });
    chip.classList.add('bc-param-colorhint');
    return { chip, panel };
}

function statusEl() {
    return h('span', { class: 'bc-param-status' });
}

// ---------------------------------------------------------------------------
// ★ 「日常体质系数」那一格是谁定的
//
// 起因：让 AI 判断受孕体质 —— 角色设定明显很弱（怀孕能力之类的）
//   或者很强的，AI 可以自己填写这个角色（NPC）的初始体质
// ⇒ 推演按角色设定判一个档（只报档位词），插件把档换成数值写进这一格。
//
// 这里只做两件事：① 把"这个值是谁定的"印成一枚读数；② 给一个交回去的按钮 ✓
// ⚠️ 用户本人不出这一块 —— 那一份身体补丁存在**全局设置**里、穿所有聊天，
//   这一期不让推演动它（要动的只是"这个角色的（NPC）初始体质" ✓）
// ---------------------------------------------------------------------------
function fertilityNote(key, baseNow, onChange) {
    if (!key || isUserKey(key)) return null;
    const tier = fertilityTierOf(key);
    const coef = tier ? fertilityCoefOfTier(tier) : null;
    // 「你改的」= 手改锁开着，或者**文本里的数跟设定判的那个不一样**（含在「全文」里改的 ✓）
    const drifted = coef !== null ? Number(baseNow) !== coef : Number(baseNow) !== 1;
    const manual = fertilityManualOf(key) || drifted;
    const text = manual
        ? (coef === null ? '你改的' : `你改的（设定判的是 ${coef}）`)
        : (coef === null ? '还没判（下轮推演按角色设定判）' : `按角色设定判的 ${coef}`);
    const row = h('div', { class: 'bc-param-note' },
        h('span', { class: 'bc-badge bc-lock-tag' + (manual ? ' on' : ''), text }));
    if (manual) {
        row.appendChild(button('↩ 恢复按设定判', () => {
            setFertilityManualOf(key, false);
            if (coef !== null) {
                writeFertilityCoef(key, coef);      // force：玩家当场点的，直接写回去 ✓
                window.toastr?.success?.(`已改回设定判的 ${coef}`);
            } else {
                writeFertilityCoef(key, 1.0);       // 交回出厂默认，下次推演判完再填 ✓
                window.toastr?.info?.('已交回推演，下次会按角色设定判一个初值');
            }
            onChange?.();
        }, { title: '这一格交回推演，按角色设定判' }));
    }
    return row;
}

// ---------------------------------------------------------------------------
// ★ A3：「察觉档位」那一档是谁定的（跟上面 fertilityNote 同一套形状 ✓）
//
// 它是角色设定（这个人对自己身体变化察觉得早还是晚）⇒ 推演报一次、插件记住；
// 之后「该不该怀疑 / 该不该确认」由插件按这张表的区间与孕周自己算 ✓
// 这里只做两件事：① 把"判到哪一档了"印成一枚读数；② 给一颗"重新按剧情判"的按钮 ✓
// ---------------------------------------------------------------------------
function awarenessNote(key, onChange) {
    if (!key) return null;
    const id = awarenessTierIdOf(key);
    const name = awarenessTierNameOf(id);
    const text = id
        ? `察觉档位：${id} 档 · ${name}（按角色设定判的）`
        : '察觉档位：还没判（怀孕时按角色设定判一次）';
    const row = h('div', { class: 'bc-param-note' },
        h('span', { class: 'bc-badge bc-lock-tag' + (id ? ' on' : ''), text }));
    if (id) {
        row.appendChild(button('↩ 重新按剧情判', () => {
            setAwarenessTierIdOf(key, '');
            window.toastr?.info?.('已交回推演，会按剧情重新判一次');
            onChange?.();
        }, { title: '忘掉这一档，交给推演重新判' }));
    }
    return row;
}

// ---------------------------------------------------------------------------
// 数值型
// ---------------------------------------------------------------------------
// ★ 把意识状态演化那一堆可填项做一个折叠（太多了）：
//   某一格 spec 标了 folded（现在是意识状态那 42 格）⇒ **默认收起**，只留一条入口条 ＋ 一颗强调色按钮。
//   做法照「门控术语表」那套（ui-modules.js 的 gateGlossaryBlock ✓）：
//   · 显隐**明确写 `grid` / `none`** —— 写 `''` 等于"恢复 CSS 值"，那个类本来就是 display:grid ✓，
//     但项目里踩过"写空串被 CSS 的 none 吃掉"的坑（番茄钟那颗球）⇒ 一律写实 ✓
//   · 开合状态放**模块级**：重画 / 切页签之后不会自己弹回去 ✓
//   · 开合**不走整页 rerender**（原地改显示与按钮文字）⇒ 不丢滚动位置、也不闪 ✓
const _foldedOpen = Object.create(null);

function foldBar(spec, grid) {
    const n = spec.fields.length;
    let open = !!_foldedOpen[spec.moduleId];
    const btn = button('', () => {
        open = !open;
        _foldedOpen[spec.moduleId] = open;
        apply();
    }, { variant: 'primary' });
    function apply() {
        grid.style.display = open ? 'grid' : 'none';
        btn.textContent = (open ? '收起这 ' : '展开这 ') + n + ' 格';
    }
    apply();
    return h('div', { class: 'bc-ff-bar' },
        h('span', { class: 'bc-hint', text: String(spec.desc || '') }),
        btn,
    );
}

function numberFields(spec, targetKey, handlers, status) {
    const box = h('div', {});
    const values = readParams(spec, targetKey);

    if (!values) {
        box.appendChild(h('div', { class: 'bc-warn', text: '没能在补丁文本里找到这些参数（可能那段文字被改过了）。用下面的「全文」直接改就行' }));
        return box;
    }

    const draft = { ...values };
    let timer = null;
    const commit = () => {
        const bad = spec.fields.filter(f => f.type === 'number' && !String(draft[f.key] ?? '').trim());
        if (bad.length) { flash(status, '数值不能为空', false); return; }
        const ok = writeParams(spec, targetKey, draft);
        // ★ 手改锁：玩家**自己动了「日常体质系数」** ⇒ 打个标记，
        //   此后推演按设定判出来的档只记不写（你自己填的说了算 ✓）
        if (ok && spec.moduleId === 'body_base' && targetKey && !isUserKey(targetKey)
            && String(draft.base ?? '') !== String(values.base ?? '')) {
            setFertilityManualOf(targetKey, true);
        }
        // ★ **"没写进去"和"真没变化"是两件事** ——
        //   写回被拒的原因可能是"这几格不合法"（起止倒挂 / 越界，write 会整份不动 ✓）
        //   一律喊"内容没有变化"会让人以为是自己没改 ✗
        //   ⇒ 读回来跟草稿逐格比一次：一样 ⇒ 真是没变化；不一样 ⇒ 明说是不合法被拒 ✓
        if (ok) {
            flash(status, '已保存');
        } else {
            let same = false;
            try {
                const fresh = readParams(spec, targetKey);
                same = !!fresh && spec.fields.every((f) => String(fresh[f.key] ?? '') === String(draft[f.key] ?? ''));
            } catch { same = false; }
            flash(status, same ? '内容没有变化' : '这几格不合法（例如起止倒挂、超出范围），没有写进去', false);
        }
        // 提交之后每格的「↩」重算一次灰不灰（写进去了 ⇒ 那一格现在等于默认值 ⇒ 该置灰 ✓）
        for (const fn of resets) fn();
        if (ok) handlers.refresh?.();
    };

    const grid = h('div', { class: 'bc-param-grid' });
    // ★ 每格那颗「↩」的**禁用状态原来只在画出来的那一刻算一次** ——
    //   那一格原本是默认值时，按钮一画出来就是灰的；之后把它改成别的数，**它不会自己变亮** ⇒
    //   点它没反应 ✗（而卡级「全部恢复默认」是普通按钮 ⇒ 照旧能用 ✓）。
    //   ⇒ 每格留一个"按当前草稿重算灰不灰"的小函数，改值 / 提交之后都调一遍 ✓
    const resets = [];
    for (const f of spec.fields) {
        let syncReset = null;      // 这一格的重算函数（下面 resetOne 建好之后才赋值 ✓）
        let input;
        if (f.type === 'select') {
            // ★ 下拉/两档类：选项在 spec 的 options 里 ✓
            //   （月经表现就是用它做"两个模式切换" ✓）
            // ★ 用已有的 .bc-select —— 它专门用 !important 压制酒馆主题的输入框美化 ✓
            const sel = h('select', { class: 'bc-select' });
            for (const [val, label] of (f.options || [])) {
                const opt = h('option', { value: val, text: label });
                if (String(draft[f.key] ?? '') === val) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.onchange = () => {
                draft[f.key] = sel.value;
                syncReset?.();
                clearTimeout(timer); timer = setTimeout(commit, 300);
            };
            input = sel;
        } else if (f.type === 'number') {
            input = numberInput(draft[f.key], (v) => {
                draft[f.key] = v === '' ? '' : String(v);
                syncReset?.();
                clearTimeout(timer); timer = setTimeout(commit, 500);
            });
        } else {
            input = textInput(draft[f.key], (v) => {
                draft[f.key] = v;
                syncReset?.();
                clearTimeout(timer); timer = setTimeout(commit, 500);
            });
        }
        // ★ 为什么规则补丁里面的身体补丁（生理设定）不能选择种族列表？✓
        //   ⇒ 种族名那一格：**自由输入照旧**（自定义不受限），右边挂一颗「选…」打开常见种族名列表 ✓
        const racePick = (spec.moduleId === 'body_base' && f.key === 'raceName')
            ? button('选…', () => openRaceNamePicker(String(draft[f.key] ?? ''), (v) => {
                draft[f.key] = v;
                input.value = v;
                clearTimeout(timer); timer = setTimeout(commit, 300);
            }), { title: '从常见种族名里挑一个（也可以直接打字）' })
            : null;
        // ★「日常体质系数」这一格下面多一行读数（这个值是谁定的 ＋ 交回按钮 ✓）
        //   ⚠️ 交回按钮改的是**补丁正文**，而面板手上还攥着一份 `draft` —— 两者不同步的话，
        //     下一次 commit 会把整份 draft 写回去、把刚恢复的值又盖成旧值 ✗
        //     （"两个事实源"的坑；所以恢复之后要**重读一次**，draft 和输入框一起对齐）
        const note = (spec.moduleId === 'body_base' && f.key === 'base')
            ? fertilityNote(targetKey, draft.base, () => {
                try {
                    const fresh = readParams(spec, targetKey);
                    if (fresh && fresh.base !== undefined) {
                        draft.base = fresh.base;
                        input.value = fresh.base;
                    }
                } catch { /* 忽略 */ }
                try { handlers?.refresh?.(); } catch { /* 忽略 */ }
            })
            : null;
        // ★ 给每个条目增加一个单独的重置按键，重置全部要留，
        //   但每个也得单独有重置；只能改数值模式只给那些可以填格子的加，
        //   全文可改模式全部都加）：
        //   ⇒ 这一格右边挂一颗「↩」，只把**这一格**写回工厂默认值，别的一个字不碰 ✓
        //   · 默认值来自 `FIELD_DEFAULTS`（登记过的才有；没登记的不画，不打扰 ❌）
        //   · **已经是默认值 ⇒ 置灰**（不藏起来 —— 藏了每改一次格子的位置都会变，更晃眼 ✓）
        //   · 不用系统弹窗（面板的规矩）⇒ 点了直接生效，读数上给一句 ✓
        const dflt = fieldDefaultOf(spec.moduleId, f.key);
        const resetOne = (dflt === null) ? null : (() => {
            const btn = button('↩', () => {
                draft[f.key] = dflt;
                clearTimeout(timer);
                commit();
                if (input) input.value = dflt;
            }, { title: dflt === '' ? '这一格出场就是空的：把它清空' : ('把这一格恢复成默认值（' + dflt + '）') });
            btn.classList.add('bc-param-reset');
            // 置灰的判据是"当前值 == 默认值"（数字类比数值、文本类比字符串 ✓）
            const same = (String(draft[f.key] ?? '').trim() === dflt)
                || (f.type === 'number' && Number(draft[f.key]) === Number(dflt) && String(draft[f.key]).trim() !== '');
            if (same) btn.disabled = true;
            return btn;
        })();
        // ★ 建好之后接上"重算灰不灰"（值跟默认一样才置灰 —— 但**每次改值都要重算** ✓）
        if (resetOne) {
            syncReset = () => {
                const sameNow = (String(draft[f.key] ?? '').trim() === dflt)
                    || (f.type === 'number' && Number(draft[f.key]) === Number(dflt) && String(draft[f.key]).trim() !== '');
                resetOne.disabled = sameNow;
            };
            syncReset();
            resets.push(syncReset);
        }
        grid.appendChild(h('div', { class: 'bc-param-field' + (f.wide ? ' wide' : '') },
            h('label', { class: 'bc-label' }, f.label,
                f.suffix ? h('span', { class: 'bc-param-suffix', text: '（' + f.suffix + '）' }) : null),
            h('div', { class: 'bc-param-line' },
                racePick ? h('div', { class: 'bc-row' }, h('div', { class: 'bc-dd-host' }, input), racePick) : input,
                resetOne),
            note,
        ));
    }
    // ★ 标了 folded 的（意识状态那 42 格）⇒ 入口条在网格**前面**，网格默认收起 ✓
    if (spec.folded) box.appendChild(foldBar(spec, grid));
    box.appendChild(grid);
    return box;
}

// ---------------------------------------------------------------------------
// 敏感带表格
// ---------------------------------------------------------------------------

function zoneFields(spec, targetKey, handlers, status) {
    const box = h('div', { class: 'bc-param-zones-inline' });
    // handlers.readRows / writeRows 可以接管「这份表读写的是哪份数据」——
    // 「改数值」里那张表改的是 **d9（本聊天当前值）**，而设置里那张改的是
    // **zones_custom 的种子文本（初始设定）**。注意上面那个不是初始设定，
    // 它本质上是修改聊天内的修改器，不算初始化，初始化另有其人。
    let rows = handlers.readRows ? handlers.readRows() : readZoneRows(spec, targetKey);
    let timer = null;

    const tableHost = h('div', { class: 'bc-zone-table' });

    // 有没有「改了但还没落地」的内容
    let dirty = false;
    // ★★ 2026-10-15（改数值里那张敏感带表不能一动就直接落库 —— 怕误操作，
    //   由弹窗右下角那颗保存统一落地更权威）——
    //   `handlers.defer = true` ⇒ **一个字都不写**，改动只留在内存里，等调用方的保存来落地 ✓
    //   （「改数值」弹窗就是这么用的：它自己有右下角那颗保存 ✓）
    const defer = !!handlers.defer;
    const markDirty = () => {
        if (dirty) return;
        dirty = true;
        flash(status, defer ? '有改动，点下面的「保存」才生效' : '有改动未保存', false);
        saveBtn?.classList.add('bc-unsaved');
    };

    const run = () => {
        clearTimeout(timer);
        const ok = handlers.writeRows ? handlers.writeRows(rows) : writeZoneRows(spec, targetKey, rows);
        dirty = false;
        saveBtn?.classList.remove('bc-unsaved');
        flash(status, ok ? '已保存' : '保存失败');
        if (ok) handlers.refresh?.();
    };
    const commit = (immediate = false) => {
        markDirty();
        clearTimeout(timer);
        // 延后模式：不写、也不排定时器 —— 落地交给调用方（「改数值」的那颗保存 ✓）
        if (defer) return;
        // 延迟保存只是"顺手帮一下"；真正可靠的是下面那个保存按钮 ——
        // ⚠️ 以前只靠这个 500ms 延迟，而**组件重建会把定时器清掉**，
        //   于是「名字已存、等级累计刺激没存」→ d9 变成 `乳头 0级（累计刺激 0）`，面板显示 0 级。
        if (immediate) run(); else timer = setTimeout(run, 900);
    };
    // 交给调用方一个"现在落地"的入口（只有真的改过才写 ✓）——
    // 「改数值」保存时调它，避免"没碰这张表也打上 d9Manual 手改标记" ✗
    handlers.onReady?.({
        flush: () => { if (!dirty) return; run(); rebuild(); },
        isDirty: () => dirty,
    });

    const rebuild = () => {
        clear(tableHost);
        if (!rows.length) {
            tableHost.appendChild(h('div', { class: 'bc-hint', text: '还没有添加任何敏感带' }));
        }
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const line = h('div', { class: 'bc-zone-row' });

            const nameIn = textInput(row.name || '', v => { rows[i].name = v; commit(); }, { placeholder: '乳尖' });
            if (!defer) nameIn.addEventListener('blur', () => { if (dirty) run(); });
            nameIn.classList.add('bc-zone-cell');
            line.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '1.3fr' } }, nameIn));

            const lvIn = numberInput(row.level ?? '', v => { rows[i].level = v === '' ? '' : String(v); commit(); }, { min: 0, max: 99 });
            if (!defer) lvIn.addEventListener('blur', () => { if (dirty) run(); });
            lvIn.classList.add('bc-zone-cell');
            line.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '.7fr' } },
                h('div', { class: 'bc-zone-inline' }, lvIn, h('span', { class: 'bc-zone-suffix', text: '级' }))));

            const ctIn = numberInput(row.count ?? '', v => { rows[i].count = v === '' ? '' : String(v); commit(); }, { min: 0, max: 9999 });
            if (!defer) ctIn.addEventListener('blur', () => { if (dirty) run(); });
            ctIn.classList.add('bc-zone-cell');
            // ★ 2026-10-29：这一格原来带「次」——它记的是按轻 1 / 中 2 / 重 3 加起来的加权量，
            //   不是"被碰了几回" ⇒ 单位词去掉（那个词留给以后真按次数记的东西 ✓）
            line.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '.9fr' } }, ctIn));

            const noteIn = textInput(row.note || '', v => { rows[i].note = v; commit(); }, { placeholder: '被碰到会轻微发抖' });
            if (!defer) noteIn.addEventListener('blur', () => { if (dirty) run(); });
            noteIn.classList.add('bc-zone-cell');
            line.appendChild(h('div', { class: 'bc-zone-field', style: { flex: '1.6fr' } }, noteIn));

            line.appendChild(h('div', { class: 'bc-zone-op' },
                // ★ 每个也得单独有重置：这一行也来一颗「↩」——
                //   把这行的**等级与累计刺激**清回 0（部位名保留：那是玩家起的名字，不是数值 ✓）
                button('↩', () => {
                    rows[i].level = '0';
                    rows[i].count = '0';
                    commit(true);
                    rebuild();
                }, { title: '把这一行的等级与累计刺激清回 0（部位名保留）' }),
                button('✕', () => { rows.splice(i, 1); commit(true); rebuild(); }, { title: '删掉这一行' })));

            tableHost.appendChild(line);
        }
    };

    // ---- 预设条（敏感带专用）----
    //
    // 用户纠正过两处，这里都按他说的做了：
    //   ① 「点击另存为之后会把编辑过的东西删除」——因为原来直接读 `textOf()`（**已存文本**），
    //      而表格里刚改还没落地的内容不在里面；存完还调了 `handlers.rebuild?.()` 重建表格，
    //      于是画面回到旧内容，看起来像"编辑被删了"。
    //      **正解：任何预设操作之前先 `run()` 把编辑落地，而且不要重建表格。**
    //   ② 聊天档案不应该存在这里 —— 那个是默默记录的，这里存的是预设。
    //      原来下拉里塞了一项「（本聊天自己的，未存为档案）」，那是把"工作副本"和"预设"混在一起了。
    //      **正解：下拉只列预设；本聊天那份是默默记录的当前值，不需要"选"它。**
    // 预设条只在「设置 → 补丁」里出现。
    // 修改那里不载入预设，它只管聊天里面的东西 ——
    // 「改数值」是聊天内的顺手改动，不该混进「换预设」这种配置动作。
    if (spec.moduleId === 'zones_custom' && handlers.showPresets !== false) {
        const bar = h('div', { class: 'bc-zone-arch' });

        /** 当前表格内容（先把没落地的改动写掉，保证拿到的是最新的） */
        const currentText = () => {
            if (dirty) run();
            return textOf(spec, targetKey);
        };

        // 下拉里"选中"哪个，只是选中 —— **不立刻载入**。
        // 载入要手动点一下，所以单独做一个载入按钮 ——
        // 直接选就覆盖掉当前内容太突然了，给一个明确的确认动作。
        let picked = zonePresetOf(targetKey);

        const redraw = () => {
            clear(bar);
            const list = listZonePresets();
            const curId = zonePresetOf(targetKey);

            const ddHost = h('div', { class: 'bc-zone-arch-dd' });
            ddHost.appendChild(dropdown(
                picked,
                [['', '（默认文案）'], ...list.map((x) => [x.id, x.name])],
                (v) => { picked = v; redraw(); },      // ← 只记下选择，不载入
            ));
            bar.appendChild(ddHost);

            const pickedPre = picked ? getZonePreset(picked) : null;
            const isDifferent = picked !== curId;
            const loadBtn = button('📥 载入', async () => {
                if (dirty && !(await askConfirm('当前表格还有没保存的改动，载入会覆盖掉它们。继续？'))) return;
                if (pickedPre) {
                    setZoneTextOf(targetKey, pickedPre.text);
                    setZonePresetOf(targetKey, picked);
                    window.toastr?.success?.(`已载入预设「${pickedPre.name}」（只影响这一个角色）`);
                } else {
                    clearZoneTextOf(targetKey);
                    window.toastr?.success?.('已载入默认文案');
                }
                handlers.refresh?.();
                handlers.rebuild?.() ?? null;       // 载入后必须重建，表格才看得到新内容
                redraw();
            }, { variant: 'primary',
                 title: isDifferent ? '把选中的预设载入给这个角色' : '重新载入这个预设（外面改过的话可以用它刷新）' });
            // 用户反馈：载入为什么在聊天内还是灰色的？还以为无法载入呢，这个太反常识了
            //   —— 原来"选中的就是当前预设"时会调暗按钮，看着像禁用。
            //   现在一律常亮：重复载入无害，还能用来刷新外面改过的预设。
            bar.appendChild(loadBtn);

            bar.appendChild(button('📌 另存为预设', () => {
                askText({
                    title: '给这份敏感带预设起个名字',
                    placeholder: '例：温柔款',
                    maxLen: 20,
                    help: ['存进全局预设库，别的聊天也能载入'],
                }).then((name) => {
                    if (name === null) return;
                    const r = saveZonePreset(name, currentText());
                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                    setZonePresetOf(targetKey, r.id);
                    window.toastr?.success?.(`已存为预设「${String(name).trim()}」`);
                    redraw();       // ⚠️ 只重画这一条，不重建表格 —— 重建会让画面回到旧内容
                });
            }));

            if (curId && getZonePreset(curId)) {
                const cur = getZonePreset(curId);
                bar.appendChild(button('💾 覆盖这个预设', () => {
                    updateZonePreset(curId, currentText());
                    window.toastr?.success?.(`已用它覆盖预设「${cur.name}」`);
                    redraw();
                }));
                bar.appendChild(button('🗑 删除这个预设', async () => {
                    if (!(await askConfirm(`删掉预设「${cur.name}」？这个角色当前的内容不受影响`))) return;
                    deleteZonePreset(curId);
                    setZonePresetOf(targetKey, '');
                    window.toastr?.success?.('已删除');
                    redraw();
                }));
            }

            bar.appendChild(button('↩ 恢复默认文案', async () => {
                if (!(await askConfirm('把这个角色的敏感带恢复成默认文案？你给他填的内容会清掉'))) return;
                clearZoneTextOf(targetKey);
                window.toastr?.success?.('已恢复');
                handlers.rebuild?.() ?? handlers.refresh?.();
                redraw();
            }));

            // 状态：这个角色当前这份是从哪来的（它是"默默记录"的当前值，不是预设本身）
            bar.appendChild(h('div', { class: 'bc-zone-arch-note',
                text: curId && getZonePreset(curId) ? `当前 = 这个角色自己那份（载入自预设「${getZonePreset(curId).name}」）` : '当前 = 这个角色自己那份' }));
        };
        redraw();
        box.appendChild(bar);
    }

    // saveBtn 必须在 rebuild() 之前声明 —— rebuild 建的输入框处理器会引用它，
    // 虽然只在用户交互时才触发（不会真的 TDZ 报错），但顺序反着写太脆。
    // ★ 延后模式（「改数值」）**不画这颗按钮**：那边用弹窗右下角那颗保存统一落地 ✓
    const saveBtn = defer ? null : button('💾 保存', () => { run(); rebuild(); }, { variant: 'primary', title: '立刻把表格写进 d9（不等延迟）' });

    rebuild();
    box.appendChild(tableHost);
    box.appendChild(h('div', { class: 'bc-row' },
        saveBtn,
        button('＋ 添加一行', () => { rows.push({ name: '', level: '', count: '', note: '' }); rebuild(); }),
        button('清空全部', async () => {
            // ★ 这张表也会在「改数值」里渲染，那边读写的是 d9（**当前值**）⇒
            //   "初始设定"是设置 / 补丁页那一份的说法，在改数值里对不上 ✗ ⇒ 改成中性的说法
            if (!(await askConfirm('把这张敏感带表整个清空？'))) return;
            rows = []; commit(true); rebuild();
        }),
    ));
    // ★ 减密度：原来这里铺着两行说明（「填了等级或次数的行会参与数值追踪…」
    //   ＋「改完这张表，点上面的保存就立刻生效…」）⇒ 都搬进标题右边那个「？」了 ✓
    return box;
}

// ---------------------------------------------------------------------------
// 入口
/**
 * ★★ 一整个「条目」的重置：
 *   她定的：**每个条目**都要有单独的「重置」，而且不止数值那几格，整个条目也要能一键还原 ✓
 *   ⇒ 这里的"条目" ＝ **一整个参数块**（例如「受孕基础率与防护系数」那 12 格合成的一条）
 *     ⇒ 每块头部给一颗「↩ 重置这一条」：把这一块里**所有格子一次性**写回默认值 ✓
 *   ⚠️ 每格那颗小「↩」照旧留着（细到单格）—— 这颗管"整个条目"，两档并存、不互相顶 ✗
 *   ⚠️ 默认值一律走 `fieldDefaultOf`（登记表 → 回出厂正文读那一格 ✓）
 */
function blockResetBtn(spec, targetKey, handlers, status, afterReset) {
    let defs = null;
    try {
        defs = (spec.fields || [])
            .map((f) => [f.key, fieldDefaultOf(spec.moduleId, f.key)])
            .filter(([, d]) => d !== null && d !== undefined);
    } catch { defs = null; }
    if (!defs || !defs.length) return null;
    const btn = button('↩ 重置这一条', () => {
        const patch = {};
        for (const [k, d] of defs) patch[k] = d;
        let ok = false;
        try { ok = writeParams(spec, targetKey, patch) === true; } catch { ok = false; }
        try { handlers?.refresh?.(); } catch { /* 忽略 */ }
        // ★★ 光把值写进设置**不够**：下面那些输入框是建的时候读一次、之后自己攥着 `draft`
        //   （每格那颗小 ↩ 是直接改 input.value 的，所以它看起来"生效了"）
        //   ⇒ 整条重置之后必须**重建这一块**，否则输入框还是旧数
        //   （2026-10-23 她报的：点「重置这一条」有反应，但吐槽上限那格不变 ✗）
        try { afterReset?.(); } catch { /* 忽略 */ }
        flash(status, ok ? ('这一条已恢复默认（' + defs.length + ' 格）') : '这一条本来就是默认值', ok);
    }, { title: '把这一整个条目恢复成默认值（这块共 ' + (spec.fields || []).length + ' 格）' });
    btn.classList.add('bc-param-reset');
    return btn;
}

// ---------------------------------------------------------------------------

/**
 * 渲染某条模块的数值字段（不带卡片外壳）
 * @returns {HTMLElement|null}
 */
export function renderParamFields(moduleId, targetKey, handlers = {}) {
    const spec = specOf(moduleId);
    if (!spec) return null;

    const status = statusEl();
    const box = h('div', { class: 'bc-param-inline' });
    // 字段那一块要能**整块重建**（整条重置之后输入框得跟着换，见 blockResetBtn）
    const fieldsHost = h('div', {});
    const paintFields = () => {
        clear(fieldsHost);
        fieldsHost.appendChild(spec.kind === 'list'
            ? zoneFields(spec, targetKey, handlers, status)
            : numberFields(spec, targetKey, handlers, status));
    };
    // 生理期参数才带上色词清单（面板见下面的说明：**要挂在头部外面** ✓）
    const hint = (spec.moduleId === 'period_patch') ? colorHintParts() : null;
    box.appendChild(h('div', { class: 'bc-param-head' },
        h('span', { class: 'bc-param-title', text: spec.title }),
        helpButton(spec.title, paramHelpLines(spec)),
        // ★★ 一整个条目的重置（跟每格那颗小「↩」并存 ✓）
        blockResetBtn(spec, targetKey, handlers, status, paintFields),
        // 生理期参数面板头部右边要写上可以触发颜色的词（血啊、疼痛这种），
        //   没有匹配到这些字就默认不改颜色
        //   → 把面板认得的词列出来，照着写就会有颜色；认不出就保持默认（不上色）。
        hint ? hint.chip : null,
        h('div', { class: 'bc-spacer' }),
        status,
    ));
    // ★ 展开那块挂在头部**后面**（占一整行）—— 塞进 flex 头里会被挤没/被裁掉 ✗
    if (hint) box.appendChild(hint.panel);
    paintFields();
    box.appendChild(fieldsHost);
    // ★ 选人外的时候填种族，然后选属于哪个大类 ——
    //   大类**不是正文里的数字/文本** ⇒ 不进 spec 的 read/write，单独补一格 ✓
    //   （和「角色基础信息」里那格**共用一份实现** ✓ —— 一份数据、两处都能改 ✓）
    if (spec.moduleId === 'body_base') {
        box.appendChild(xenoClassField(targetKey, () => { try { handlers?.refresh?.(); } catch { /* 忽略 */ } }));
    }
    // ★ A3：察觉档位那一档的读数（＋"重新按剧情判"按钮 ✓）
    if (spec.moduleId === 'awareness') {
        const n = awarenessNote(targetKey, () => { try { handlers?.refresh?.(); } catch { /* 忽略 */ } });
        if (n) box.appendChild(n);
    }
    return box;
}

/**
 * 敏感带编辑器（可直接嵌进「改数值」弹窗）。
 *
 * 为什么要它：用户指出，在设定过初始敏感带之后，玩家不能通过改数值修改清空？
 * 这不自由 —— 他说得对。敏感带**每秒都在用**，改它却要跑去 设置 → 补丁，
 * 太绕。「改数值」才是顺手入口，所以这里把同一张表（含档案切换、加行、清空）
 * 原样搬过来。
 *
 * @param {string|null} targetKey
 * @param {object} handlers { refresh, rebuild }
 */
export function renderZoneModifier(targetKey, handlers = {}) {
    const spec = specOf('zones_custom');
    if (!spec) return null;
    const status = statusEl();
    const box = h('div', { class: 'bc-param-inline bc-zone-editor' });
    box.appendChild(h('div', { class: 'bc-param-head' },
        h('span', { class: 'bc-param-title', text: '敏感带（当前值）' }),
        helpButton('敏感带（当前值）', paramHelpLines(spec)),
        h('div', { class: 'bc-spacer' }),
        status,
    ));
    // showPresets:false —— 「改数值」里没有预设（那是设置页的事）
    box.appendChild(zoneFields(spec, targetKey,
        { ...handlers, showPresets: false, readRows: handlers.readRows, writeRows: handlers.writeRows },
        status));
    return box;
}
