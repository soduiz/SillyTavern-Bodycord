/**
 * ui-ach.js —— 「成就记录」设置页（涩涩成就）
 *
 * 定下的形态（下面四条管着这一页所有取舍）：
 *   · 数据**按聊天**存（store.js 的 achievements），这一页管的也是**本聊天**那份 ✓
 *   · 提示词就在这一页改，**不进补丁页** ✓
 *   · 这一页的提示词**不用锁**：风格段让玩家自由改（它只影响吐槽风格）；
 *     **结构句只读**（见下）✓
 *   · 名称最多八个字 ⇒ 那条规则写在契约字段那一行 / 结构句里，页面上只展示 ✓
 *
 * ⚠️ 为什么结构句必须只读：
 *   它写着"什么时候该报、字段叫什么"。玩家把它删了 ⇒ AI 不再报 ⇒ 面板永远空着，
 *   而且**不报错**（最难查的那类静默失效 ✗）。风格段改坏顶多是吐槽难听，伤不到结构 ✓
 */

import { h, button, toggle, section, textArea, numberInput, groupHeading, askConfirm, clear } from './dom.js';
import {
    achOn, setAchOn, achToastOn, setAchToastOn, achToastSec, setAchToastSec, ACH_TOAST_SEC_DEF,
    achStyle, setAchStyle, achStyleCustom, resetAchStyle,
    achPromptChars, achStructText,
} from './settings.js';
import { renderParamFields } from './ui-params.js';
import { achievements, removeAchievement, clearAchievements, isImportedAchievement } from './store.js';

/** 说明一律走卡片右上角的「？」（页面上只留开关 / 读数 / 警告 ✓） */
const HELP_ON = [
    '开了之后，推演那一轮如果觉得发生了值得纪念的事（第一次、里程碑、少见的场合或做法、怀孕与生产这类都算），会顺便报给插件存下来；一轮可以报多条（最多 4 条）',
    '受精成功、着床完成、分娩也会在同一个回包里各写一条；没发生的那些插件会按真掷出来的结果筛掉，不会记错',
    '普通成就只认真实的变化（第一次、里程碑、少见的场合或组合），普通日常和重复做事不算，所以大多数轮次是空的；事件成就是到了着床完成日 / 受孕窗口结束日或分娩那一轮才补',
    '成就只记本聊天里的追踪对象（正式档）：轻档、路人和只在剧情里露过一面的名字，不会被记成成就',
    '成就只存在本聊天里，换聊天不带走',
    '成就的内容永远不会发回给 AI，所以不会因为它多花之后的 token',
    '下面的气泡开关只管"解锁时右上角弹不弹一张卡片"：关掉之后成就照样记录，只是安静地存下来',
];
const HELP_PROMPT = [
    '上面那段是固定的，管着「什么时候报、报哪些字段」，请不要改它',
    '下面那段是吐槽的风格，随便改：怎么说话、多少字、不许写什么，都归你',
    '改坏下面那段，最坏就是吐槽不好听；上面那段被改坏，成就就不会再出现了',
];
const HELP_LIST = [
    '这里能删单条、也能一次清空（面板那边是只读的）',
];

/** 卡片里那行读数（开关关着也显示，一眼知道开着要花多少字 ✓） */
function promptCharsLine() {
    return h('div', { class: 'bc-hint', text: '成就提示词：' + achPromptChars() + ' 字' });
}

/**
 * 画这一页
 * @param {HTMLElement} container
 * @param {{refresh?:Function, rebuild?:Function}} handlers
 */
export function renderAchTab(container, handlers = {}) {
    // ⚠️⚠️ 必须先清空：设置页的 content 是**同一个容器**，每个页签自己负责清
    //   （漏了这一句 ⇒ 上一个页签的内容会原样留在上面，两页叠在一起 ✗
    //    报过的现象：点「成就记录」看到上半截还是「记录档案 / 世界观」）
    clear(container);
    const { rebuild } = handlers;
    container.appendChild(groupHeading('成就'));

    // ---- ① 开关 ----
    const boxOn = section('记录成就', {
        help: HELP_ON,
    });
    const bOn = boxOn.querySelector('.bc-section-body');
    const charsEl = promptCharsLine();
    bOn.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '记录成就' }),
        toggle(achOn(), (v) => {
            setAchOn(v);
            // 开关只影响后面几轮会带什么 ⇒ 就地更新读数，不重画整页 ✓
            charsEl.textContent = '成就提示词：' + achPromptChars() + ' 字';
        }),
    ));
    // ★ 解锁气泡开关（2026-10-18，默认开）—— 成就记录和"有没有存在感"是两件事 ✓
    bOn.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '解锁时弹右上角气泡' }),
        toggle(achToastOn(), (v) => { setAchToastOn(v); }),
    ));
    // ★ 气泡停留几秒（2026-10-21）——
    //   原来写死 7 秒（鼠标移开后再补 2.5 秒），可吐槽最长 90 字，读不完 ✗
    //   填 0 = 不自动关（点 ✕ 才走），适合想慢慢看的时候 ✓
    bOn.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '气泡停留（秒）' }),
        numberInput(achToastSec(), (v) => { setAchToastSec(v === '' ? ACH_TOAST_SEC_DEF : v); }, { min: 0, max: 30 }),
        h('span', { class: 'bc-hint', text: '0 = 不自动关；鼠标停在气泡上会暂停计时' }),
    ));
    // ★ 直接测气泡——
    //   只弹一张样例卡，不写成就记录、不花推演 token ✓
    //   ⚠️ 这张样例卡**故意写得皮一点**（2026-10-21 她要求的）：它就是让人确认"弹窗活得好不好"，
    //     所以开场那句像在对屏幕外的人喊话；停留时长也走上面那格 ✓
    bOn.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        h('span', { class: 'bc-label', text: '测试气泡' }),
        button('弹一张测试卡', () => {
            if (!achToastOn()) { window.toastr?.info?.('先把上面的「解锁时弹右上角气泡」打开'); return; }
            try {
                window.__bodycordShowAchToasts?.([{
                    name: '测试成就', why: '这只是测试气泡',
                    quip: '321123，喂喂喂，看得到吗？什么？！你看得到！恭喜你看到了这个弹窗！恭喜你被我恭喜了！',
                    target: '示例角色',
                }]);
            } catch { /* 忽略 */ }
        }, { title: '只弹一张测试卡，不会写进成就记录' }),
    ));
    bOn.appendChild(charsEl);
    container.appendChild(boxOn);

    // ---- ② 提示词（结构句只读 + 风格段可改）----
    const boxP = section('成就提示词', {
        help: HELP_PROMPT,
    });
    const bP = boxP.querySelector('.bc-section-body');
    // ★ 三个字数上限做成面板格（名字 / 依据 / 吐槽）——
    //   规则句里那三个数原来写死在文案里、代码兜底又是另一套数（24/60/80）⇒
    //   现在改这里，发给推演的规则句跟着变 ✓
    //   ⚠️ 用到 `renderParamFields` 的 `__ach__` 虚 id（成就不是 modules.js 里的模块 ✓）
    // ★ 玩家自己改过吐槽风格时，「吐槽上限」那格就**不再影响**规则句
    //   （`achStyle()` 对玩家写的那段一字不替换 —— 那是有意的：不许偷偷改他的字 ✓），
    //   可那格的说明还写着"改这里，规则句跟着变" ⇒ 界面承诺了做不到的事 ✗ ⇒ 这里明说一句 ✓
    if (achStyleCustom()) {
        bP.appendChild(h('div', { class: 'bc-warn', text: '⚠️ 你改过吐槽风格，这三个上限不再影响它' }));
    }
    // 结构句：只读展示（灰字，跟别处的说明一个样式 ✓）—— 按**当前上限**渲染，跟发出去的那份一致 ✓
    // ★ 2026-10-25：结构句现在按段换行（7 行）—— `.bc-hint` 默认会把换行折成空格
    //   ⇒ 这格单独给它 pre-wrap，不然又变回一整段 ✓
    const structEl = h('div', { class: 'bc-hint', style: { whiteSpace: 'pre-wrap' }, text: achStructText() });
    const achParams = renderParamFields('__ach__', null, {
        ...handlers,
        // ★ 改完上限，这张卡上的两处读数要**就地**跟着变 ——
        //   以前传的是 refreshAll()（它不重画设置页这一屏）⇒ 读数停在改之前的数 ✗
        //   ⚠️ 只改 textContent、不重画：重画会把正在输入的那格换掉、焦点丢掉 ✗
        refresh: () => {
            structEl.textContent = achStructText();
            charsEl.textContent = '成就提示词：' + achPromptChars() + ' 字';
        },
    });
    if (achParams) bP.appendChild(achParams);
    bP.appendChild(h('div', { class: 'bc-label', text: '固定部分（只读）' }));
    bP.appendChild(structEl);
    // 风格段：可编辑
    // ★ 这一组跟上面那段只读正文**拉开距离**（2026-10-21 她报"间隔太近"）——
    //   固定部分是几行长文字，紧贴着小标题会糊成一片；留白写在 CSS 的 .bc-ach-style-group ✓
    const styleGroup = h('div', { class: 'bc-ach-style-group' });
    styleGroup.appendChild(h('div', { class: 'bc-label bc-label-block', text: '吐槽风格（可以自己改）' }));
    const ta = textArea(achStyle(), (v) => {
        // ⚠️ 输入时**只存不重画** —— 重画会把正在打字的输入框整个换掉（焦点丢掉 ✗）
        setAchStyle(v);
    });
    styleGroup.appendChild(ta);
    styleGroup.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('恢复默认', () => { resetAchStyle(); rebuild?.(); }),
        achStyleCustom() ? h('span', { class: 'bc-badge', text: '已改过' }) : null,
    ));
    bP.appendChild(styleGroup);
    container.appendChild(boxP);

    // ---- ③ 本聊天的成就 ----
    const list = achievements().slice().reverse();
    const boxL = section('本聊天的成就（' + list.length + '）', {
        help: HELP_LIST,
    });
    const bL = boxL.querySelector('.bc-section-body');
    if (!list.length) {
        bL.appendChild(h('div', { class: 'bc-empty', text: '本聊天还没有成就' }));
        bL.appendChild(h('div', { class: 'bc-hint', text: '打开上面的开关，跑一轮推演之后就会开始有' }));
    } else {
        for (const a of list) {
            // ★ 2026-10-28：从「仅状态」档案导入的成就（`imported`）不显示日期 ✓
            const meta = [(isImportedAchievement(a) ? '' : a.date), a.target].filter(Boolean).join(' · ');
            bL.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
                h('span', { class: 'bc-label', text: a.name }),
                h('div', { class: 'bc-spacer' }),
                button('删除', () => { removeAchievement(a.id); rebuild?.(); }),
            ));
            // 触发依据：多一行「因为：」说明是哪条数据触发的 ✓
            // ★ 标签用「因为：」（跟契约里"说明因为什么触发的"同词根 ✓）
            if (a.why) bL.appendChild(h('div', { class: 'bc-hint', text: '因为：' + a.why + (meta ? '　' + meta : '') }));
            bL.appendChild(h('div', { class: 'bc-hint', text: (a.quip || '（没有吐槽）') + (a.why ? '' : (meta ? '　' + meta : '')) }));
        }
    }
    bL.appendChild(h('div', { class: 'bc-row bc-row-wrap' },
        button('清空本聊天的成就', async () => {
            if (!(await askConfirm('清空本聊天的成就？删掉就找不回来了'))) return;
            clearAchievements();
            rebuild?.();
        }, { disabled: !list.length }),
    ));
    container.appendChild(boxL);
}
