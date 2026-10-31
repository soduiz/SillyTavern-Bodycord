/**
 * 设置页的「番茄钟」卡
 * ---------------------------------------------------------------------------
 * 需求：一个绑现实时间、用来避免沉迷酒馆的计时器；全做、时长可自定义
 *   （理由是**玩和挂机不一样**，玩家会长时间挂后台 ✓）；
 *   配置项是点名的：**保活开关和时长设置都放在番茄钟里面** ✓
 *
 * ⚠️ **这张卡住「时间与日历」页** —— 一度把整块搬去「头像外观」，纠正过来了：
 *   专注/休息多久、提示音、保活这些都不是头像相关的东西，不该瞎搬 ✗
 *   ⇒ 判据是**内容**：这几样讲的都是"时间"的事 ⇒ 留在时间那一页 ✓
 *
 * ⚠️ **单独拆成一个文件**（不塞在 `ui-settings.js` 里）是为了能**单独测**：
 *   设置页那套（`.bc-pill` 点下去到底动没动）以前只能靠肉眼，而报过的
 *   「番茄钟的设置无法点击使用」正是这一类 ⇒ 拆出来之后 `_timer-click-test.mjs`
 *   能把这张卡挂进真浏览器，**真的点一下**看值变没变 ✓
 */
import { h, section, field, numberInput, textInput } from './dom.js';
import { settings, save } from './settings.js';

/** 出厂 / 兜底的那几个值（取不到就用它 ✓） */
const DEF = { work: 25, rest: 5, ball: true, chime: true, keepAlive: false };

/** 现在这份配置（**永远返回一份完整、干净的**，别把 undefined 漏出去 ✓） */
export function timerCfgOf() {
    const t = (settings() && settings().timer) || {};
    const num = (v, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(1, Math.min(600, Math.round(n))) : dflt;
    };
    const bb = (t.bubbles && typeof t.bubbles === 'object') ? t.bubbles : {};
    return {
        work: num(t.work, DEF.work),
        rest: num(t.rest, DEF.rest),
        ball: t.ball !== false,
        chime: t.chime !== false,
        keepAlive: t.keepAlive === true,
        // ★★ 刷新后番茄钟仍在走这件事做成选项，默认是刷新重置 ✓
        //   true（默认）= 刷新就重置（当没跑过、球也不出现 ✓）；false = 按现实时间接着走 ✓
        resetOnLoad: t.resetOnLoad !== false,
        // ★ 到点气泡那两句（留空 ⇒ 读取时回出厂，见 `timerBubbles()` ✓）
        bubbleWork: String(bb.work ?? ''),
        bubbleRest: String(bb.rest ?? ''),
    };
}

/** 到点气泡的两句**最终文案**（留空就回出厂 ✓ —— 跟日历那个「到日子了」同一套做法） */
export function timerBubbles() {
    const c = timerCfgOf();
    return {
        work: c.bubbleWork.trim() || '到点啦',
        rest: c.bubbleRest.trim() || '歇好啦',
    };
}

/** 改一格（**顺手存盘**；`onChange` 是页面给的"重画一下"回调 ✓）
 *  ⚠️ 只在本文件里用 ⇒ **不导出**（导出了会被"死导出"扫描抓出来 ✓） */
function timerCfgPatch(patch, onChange) {
    const s = settings();
    if (!s.timer || typeof s.timer !== 'object') s.timer = Object.assign({}, DEF);
    Object.assign(s.timer, patch || {});
    save();
    try { onChange?.(); } catch { /* 重画失败不该把"已经存好了"这件事抹掉 ✓ */ }
    return timerCfgOf();
}

/** 「番茄钟」那张卡（塞进 `container`；返回那个 section 元素，测试要用 ✓） */
export function timerSection(container, onChange) {
    const box = section('番茄钟', {
        help: [
            '面板侧栏「工具」那一组里有个「番茄钟」，就是它',
            '专注 / 休息那两格是默认长度：打开番茄钟时按它起算',
            '在那一页里随时能点快选（5 / 15 / 25 / 45 分）或者直接填别的分钟数',
            '到点了不会自己跳下一段，会先问你「歇一会儿 / 再来一轮」',
            '提醒分两种：你切走了就发系统通知（右下角 / 手机通知栏），看着界面就弹页内气泡',
            '系统通知要你自己点一次「允许」，没给也能用，只是退回页内气泡',
            '保活（默认关）：让页面一直播一段听不见的声音，手机切后台不容易被回收',
            '但保活只是降低被杀的概率，熄屏 / 系统要回收时拦不住；代价是一直占着音频、也费电',
        ],
    });
    const b = box.querySelector('.bc-section-body');
    const cur = () => timerCfgOf();

    const numField = (label, key, dflt) => field(label, numberInput(cur()[key], (v) => {
        const n = Number(v);
        timerCfgPatch({ [key]: Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(600, Math.round(n))) : dflt }, onChange);
    }, { min: 1, max: 600 }));

    b.appendChild(h('div', { class: 'bc-row' },
        numField('专注多久（分钟）', 'work', DEF.work),
        numField('休息多久（分钟）', 'rest', DEF.rest),
    ));

    // ★ 布尔项**一律做成"两颗都看得见"**（别用一颗会翻的按钮 ✗），默认那一档排最左 ✓
    //   ⚠️⚠️ 这里有一课（报过的"番茄钟的设置无法点击使用"）：
    //      原来只 `patch()` 存盘、指望 `onChange` 那套整页重画把选中态刷出来 ——
    //      整页重画这条路中间任何一环没接上，就成了"点了屏幕上什么都不动" ⇒ 看起来就是坏的 ✗
    //      ⇒ **点完当场把这两颗自己的选中态改掉**（不依赖外面重画 ✓），再顺手调一次 onChange ✓
    const twoChips = (label, on, key, { onLabel = '开', offLabel = '关' } = {}) => {
        const mk = (txt, val) => h('div', {
            class: 'bc-pill' + ((val ? on : !on) ? ' active' : ''), text: txt,
            dataset: { timerOpt: key, val: val ? '1' : '0' },
        });
        const cOn = mk(onLabel, true);
        const cOff = mk(offLabel, false);
        const paint = (v) => {
            cOn.classList.toggle('active', !!v);
            cOff.classList.toggle('active', !v);
        };
        cOn.onclick = () => { timerCfgPatch({ [key]: true }, onChange); paint(true); };
        cOff.onclick = () => { timerCfgPatch({ [key]: false }, onChange); paint(false); };
        return field(label, h('div', { class: 'bc-row bc-pill-row', dataset: { timerPills: key } }, cOn, cOff));
    };

    b.appendChild(twoChips('番茄钟的悬浮球', cur().ball, 'ball', { onLabel: '显示', offLabel: '不显示' }));
    b.appendChild(twoChips('到点响一声', cur().chime, 'chime'));
    b.appendChild(twoChips('挂机保活', cur().keepAlive, 'keepAlive', { onLabel: '开', offLabel: '关（推荐）' }));
    // ★★ 刷新后番茄钟仍在走这件事做成选项，默认刷新重置（连悬浮球都不显示）✓
    //   ⚠️ 两颗药丸**都看得见**、默认那颗排最左（项目老规矩 ✓）
    b.appendChild(twoChips('刷新之后', cur().resetOnLoad, 'resetOnLoad',
        { onLabel: '重置', offLabel: '接着走' }));

    /* ★★ 番茄钟的文字也可以自定义 ⇒ 到点那个气泡顶上那句话可改 ✓
       · 两格：专注段结束 / 休息段结束（各一句）
       · **留空就回出厂**（跟日历那个「到日子了」同一套做法，读取时兜 ✓）
       · **不设字数上限**（讨厌给内容设限）⇒ 长了由气泡自己折行 ✓ */
    const bubbleField = (label, key, dflt) => field(label, textInput(
        String((settings().timer || {}).bubbles?.[key] ?? ''),
        (v) => {
            const t = settings().timer || (settings().timer = {});
            if (!t.bubbles || typeof t.bubbles !== 'object') t.bubbles = { work: '', rest: '' };
            t.bubbles[key] = String(v ?? '');
            save();
            try { onChange?.(); } catch { /* 忽略 */ }
        },
        { placeholder: '留空就用「' + dflt + '」' },
    ));
    b.appendChild(h('div', { class: 'bc-row' },
        bubbleField('专注结束时那句', 'work', '到点啦'),
        bubbleField('休息结束时那句', 'rest', '歇好啦'),
    ));
    container.appendChild(box);
    return box;
}
