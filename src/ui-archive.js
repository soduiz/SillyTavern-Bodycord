/**
 * ui-archive.js —— 「记录档案」界面（两类档案：世界观 / 人物）
 *
 * 需求：提示词配置可以**存档 / 另存新档 / 导出** ✓
 *
 * 一块页面解决四件事：存当前、切到某个、改名/删除、导入导出。
 *
 * ★ 分两类：
 *   · **世界观档案**：整套规则（模块开关 + 改过的文案 + 字段开关 + 注入模板）
 *   · **人物档案**：某一个对象的三块（基础信息 / 补丁 / 别名、标签与备注）—— 只装动过的 ✓
 *   ⚠️ 两类**各是各的列表**（同名也不算撞：世界观也叫「丽娜」和人物「丽娜」是两回事 ✓）
 *      —— 两类本来就是分开的东西：换世界观 / 换角色时互不影响 ✓
 */

import { h, clear, button, modal, askConfirm, field, toggle, section } from './dom.js';
import {
    listWorldArchives, listPersonArchives, saveArchive, updateArchive, renameArchive, deleteArchive, getArchive,
    applyPromptConfig, parseArchiveText, importArchives, downloadArchive, summarize, summarizePerson,
    archiveBytes, archiveLabel, KIND_WORLD,
    updatePersonArchive, applyPersonArchive, findTargetForArchive,
    personBlocksOf, personBlocksLabel, PERSON_BLOCKS,
} from './archive.js';
import { targetList, displayName, userLabel } from './store.js';

/** 把字节数说成人话 */
function human(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** 档案列表的搜索词（放模块级：重画页面也留着 ✓） */
let archiveQuery = '';

const fmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/**
 * 起名 + 备注的弹窗。返回 `{name, note}` 或 null。
 *
 * ★ 档案存两个字段 ——
 *   **名字**（用于自动匹配 / 判重）＋ **备注**（只给自己看，显示成「名字（备注）」）✓
 *   ⚠️ 备注别写进名字里 ✗ —— 那样以后按名字匹配就认不出来了 ✓
 */
export function askArchiveName(title, initial = '', initialNote = '', hint = '') {
    return new Promise((resolve) => {
        let value = initial;
        let note = initialNote;
        const input = h('input', {
            class: 'bc-input', value: initial, placeholder: '例如：写实向 / 轻松向 / 试验版',
            oninput: (e) => { value = e.target.value; },
            // ⚠️ 名字是空的就别结算 Promise —— 结算成 null 之后弹窗还开着，
            //   再点「确定」也救不回来了（resolve 只认第一次）⇒ 整个弹窗从此失灵 ✗
            // ⚠️ 回车这条路也要**自己关窗**：resolve 只认第一次，窗还开着的话
            //   改完名字再点「确定」就永远不生效了 ✗
            onkeydown: (e) => { if (e.key === 'Enter' && String(value).trim()) { const d = done(); if (d) { resolve(d); try { m.close(); } catch { /* 忽略 */ } } } },
        });
        const noteInput = h('input', {
            class: 'bc-input', value: initialNote, placeholder: '可留空（只给你自己看）',
            oninput: (e) => { note = e.target.value; },
            // ⚠️ 回车这条路也要**自己关窗**：resolve 只认第一次，窗还开着的话
            //   改完名字再点「确定」就永远不生效了 ✗
            onkeydown: (e) => { if (e.key === 'Enter' && String(value).trim()) { const d = done(); if (d) { resolve(d); try { m.close(); } catch { /* 忽略 */ } } } },
        });
        const done = () => {
            const n = String(value).trim();
            if (!n) return null;
            return { name: n, note: String(note).trim() };
        };
        // ⚠️ 拿住弹窗句柄 —— 下面「回车」那条路要**自己关窗** ✓
        const m = modal({
            title,
            width: 460,
            build: (body) => {
                body.appendChild(h('div', { class: 'bc-hint', text: hint || '档案只存「跟提示词有关的东西」：模块开关与改过的文案、自动门控、字段开关、注入模板。API 配置和追踪对象不受影响' }));
                body.appendChild(field('名字', input, '档案叫什么，列表里按它排序和查找'));
                body.appendChild(field('备注', noteInput, '可留空，只给你自己看：显示成「名字（备注）」，用来区分同一个名字的几个版本'));
            },
            saveText: '确定',
            onSave: () => {
                const d = done();
                // 没名字 ⇒ 不关窗、也不结算（留在原地让人补上 ✓）
                if (!d) { window.toastr?.warning?.('先给档案起个名字'); return false; }
                resolve(d);
            },
            onClose: () => resolve(null),
        });
        setTimeout(() => input.focus(), 30);
    });
}

/** 选一个 json 文件的弹窗 */
export function pickJsonFile() {
    return new Promise((resolve) => {
        const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
        // ★ 点「取消」不会触发 change ⇒ 那个隐藏 input 会一直留在 body 上，
        //   而这个 Promise 也永远不结算（调用方后半段再也不跑 ✗）⇒ 补一条 cancel ✓
        input.addEventListener('cancel', () => { input.remove(); resolve(null); });
        input.addEventListener('change', async () => {
            const f = input.files?.[0];
            input.remove();
            if (!f) return resolve(null);
            try { resolve({ name: f.name, text: await f.text() }); }
            catch (e) { resolve({ error: e?.message || String(e) }); }
        });
        document.body.appendChild(input);
        input.click();
    });
}

/** 从文件导入（两类都认 ✓）—— 返回导入的档案数组，取消/失败返回 null */
export async function importArchivesInteractive() {
    const f = await pickJsonFile();
    if (!f) return null;
    if (f.error) { window.toastr?.error?.('读取失败：' + f.error); return null; }
    const r = parseArchiveText(f.text);
    if (!r.ok) { window.toastr?.error?.(r.error); return null; }
    const added = importArchives(r.archives);
    if (!added.length) { window.toastr?.warning?.('文件里没有可导入的档案'); return null; }
    const world = added.filter(a => a.kind === KIND_WORLD).length;
    const person = added.length - world;
    const parts = [];
    if (world) parts.push(`世界观 ${world} 份`);
    if (person) parts.push(`人物 ${person} 份`);
    window.toastr?.success?.(`导入了 ${added.length} 份档案（${parts.join('、')}）`);
    return added;
}

/**
 * 「这份档案里有哪几块要套上」——勾选弹窗（默认全勾 ✓）。
 *
 * ★ 装了几块就让你勾几块，想只套其中一块就取消别的勾 ✓
 * @returns {Promise<string[]|null>} 选中的块（取消 ⇒ null）
 */
export function askPersonBlocks(a, opts = {}) {
    const ids = personBlocksOf(a);
    return new Promise((resolve) => {
        const picked = new Set(ids);
        modal({
            title: opts.title || `套用「${archiveLabel(a)}」`,
            width: 520,
            saveText: '套用',
            build: (body) => {
                body.appendChild(h('div', { class: 'bc-hint', text: opts.hint || '这份档案里装了下面这些内容。默认全勾；不想动哪一块就取消它。没勾的块一个字都不会碰' }));
                for (const id of ids) {
                    const meta = PERSON_BLOCKS.find(b => b[0] === id) || [id, id, ''];
                    const row = h('label', { class: 'bc-gate-item on' },
                        toggle(true, (v) => { if (v) picked.add(id); else picked.delete(id); }),
                        h('div', { class: 'bc-gate-main' },
                            h('div', { class: 'bc-gate-label', text: meta[1] }),
                            h('div', { class: 'bc-hint', text: meta[2] }),
                        ),
                    );
                    body.appendChild(row);
                }
                body.appendChild(h('div', { class: 'bc-hint', text: '套用是「整块替换」：比如套「基础信息」，那几项就按这份档案来（档案里没记的项回到「未填」）' }));
            },
            onSave: () => resolve([...picked]),
            onClose: () => resolve(null),
        });
    });
}

/**
 * 把一份人物档案套到某个对象上（带勾选 ✓）。
 * @returns {Promise<boolean>} 真的套了吗
 */
export async function applyPersonArchiveInteractive(a, targetKey, opts = {}) {
    const ids = personBlocksOf(a);
    if (!ids.length) { window.toastr?.warning?.('这份档案是空的'); return false; }
    let blocks = ids;
    if (ids.length > 1) {
        blocks = await askPersonBlocks(a, opts);
        if (!blocks) return false;
        if (!blocks.length) { window.toastr?.warning?.('一块都没勾，什么都没做'); return false; }
    } else if (!opts.skipConfirm) {
        const ok = await askConfirm(`把「${archiveLabel(a)}」里的「${personBlocksLabel(a)}」套到这个对象上？\n\n没装在那份档案里的内容不会被动到`);
        if (!ok) return false;
    }
    const r = applyPersonArchive(a.id, targetKey, blocks);
    if (!r.ok) { window.toastr?.warning?.(r.error); return false; }
    window.toastr?.success?.(`已套用「${archiveLabel(a)}」（${r.blocks.map(id => PERSON_BLOCKS.find(b => b[0] === id)?.[1] || id).join(' + ')}）`);
    return true;
}

/** 把一份世界观档案套到当前设置（先自动备份当前配置 ✓） */
export async function loadWorldArchiveInteractive(a) {
    const label = archiveLabel(a);
    const ok = await askConfirm(
        `会用「${label}」替换掉当前的提示词配置。\n\n`
        + '当前这套会自动存成「载入前的备份」，反悔了能切回来。\n\n确定载入？');
    if (!ok) return false;
    // 先自动备份当前，再应用 —— 载入错了能回退
    const bak = saveArchive('载入前的备份 ' + fmtTime(Date.now()).slice(5));
    applyPromptConfig(a.data);
    window.toastr?.success?.(bak.ok
        ? `已载入「${label}」（当前配置已存为「${archiveLabel(getArchive(bak.id) || { name: '载入前的备份' })}」）`
        : `已载入「${label}」`);
    return true;
}

export function renderArchiveTab(container, ctx = {}) {
    const refresh = () => { try { ctx.refresh?.(); } catch { /* 忽略 */ } render(); };

    function render() {
        clear(container);

        const worldList = listWorldArchives();
        const personList = listPersonArchives();
        const list = [...worldList, ...personList];

        // ---- 说明 + 主按钮（★ 减密度：说明搬进右上角「？」弹窗 ✓）----
        // ⚠️ opts 必须放在**最后一个参数**（`section` 靠"最后一个是不是配置对象"来认它 ✗）
        container.appendChild(section('档案',
            h('div', { class: 'bc-row bc-row-wrap' },
                button('📦 存下当前配置（世界观）', async () => {
                    const r0 = await askArchiveName('存为世界观档案');
                    if (!r0) return;
                    const r = saveArchive(r0.name, r0.note);
                    if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                    const a = getArchive(r.id);
                    window.toastr?.success?.(`已存为「${archiveLabel(a || r0)}」`);
                    render();
                }, { variant: 'primary' }),
                button('📥 导入档案…', async () => {
                    const added = await importArchivesInteractive();
                    if (added) render();
                }),
                list.length ? button('📤 导出全部', () => {
                    downloadArchive(null);
                    window.toastr?.success?.(`已导出 ${list.length} 份档案`);
                }) : null,
            ),
            h('div', { class: 'bc-hint', text: `档案占用：${human(archiveBytes())}` }),
            {
                plain: true,
                help: [
                    '档案分两类，各存各的，互不影响：',
                    '【世界观档案】= 整套规则怎么配的（模块开关 + 改过的文案 + 字段开关 + 注入模板）。适合开不同风格的存档',
                    '【人物档案】= 某一个角色的三块（基础信息 / 补丁 / 别名、标签与备注），只装你动过的那些。适合一个角色换世界观、或者一个人设换着用',
                    '档案占用都算在插件设置里，攒多了记得导出后删掉不用的',
                ],
            },
        ));

        if (!list.length) {
            container.appendChild(h('div', { class: 'bc-empty', text: '还没有档案。点上面的「存下当前配置」建第一份世界观档案；人物档案在「规则补丁 → 人物」那一栏里存' }));
            return;
        }

        // ★ 搜索框（档案多了要能找）——
        //   ⚠️ 输入时**只重画列表那一段**，整页重画会让输入框失焦 ✗（联系人页那条老教训）
        const searchInput = h('input', {
            class: 'bc-input', value: archiveQuery, placeholder: '搜索档案名或备注…',
        });
        searchInput.addEventListener('input', (e) => { archiveQuery = e.target.value; paint(); });
        container.appendChild(h('div', { class: 'bc-row' }, searchInput));

        const host = h('div', {});
        container.appendChild(host);

        /** 按关键词筛（纯客户端，不动数据 ✓） */
        const matched = (arr) => {
            const kw = archiveQuery.trim().toLowerCase();
            if (!kw) return arr;
            return arr.filter((a) => (archiveLabel(a) + ' ' + a.name + ' ' + (a.note || '')).toLowerCase().includes(kw));
        };

        /** 一份世界观档案的卡片 */
        const worldCard = (a) => {
            const sum = summarize(a.data);
            const label = archiveLabel(a);
            return h('div', { class: 'bc-arch-card' },
                h('div', { class: 'bc-arch-head' },
                    h('div', { class: 'bc-arch-name', text: label }),
                    h('div', { class: 'bc-arch-time', text: `建立 ${fmtTime(a.createdAt)}　更新 ${fmtTime(a.updatedAt)}` }),
                ),
                h('div', { class: 'bc-arch-sum' },
                    ...Object.entries(sum).map(([k, v]) =>
                        h('span', { class: 'bc-arch-chip', text: `${k}：${v}` })),
                ),
                h('div', { class: 'bc-row bc-row-wrap' },
                    button('↩ 载入这份', async () => {
                        // ⚠️ 它是 async ⇒ 返回 Promise（恒真）。老写法 `if (!promise) return` 永远不成立：
                        //   确认框还没点就先 render 了一遍，点完反倒没人重画（刚存的那份备份也看不见）✗
                        //   （必须 await）
                        if (!(await loadWorldArchiveInteractive(a))) return;
                        render();
                        refresh();
                    }, { variant: 'primary' }),
                    button('💾 用当前覆盖', async () => {
                        const ok = await askConfirm(
                            `把当前的提示词配置写进「${label}」，这份档案原来的内容就没了。\n\n确定覆盖？`);
                        if (!ok) return;
                        updateArchive(a.id);
                        window.toastr?.success?.(`「${label}」已更新`);
                        render();
                    }),
                    button('✏️ 改名', async () => {
                        const r0 = await askArchiveName('改档案名', a.name, a.note || '');
                        if (!r0) return;
                        const r = renameArchive(a.id, r0.name, r0.note);
                        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                        render();
                    }),
                    button('📤 导出这份', () => {
                        downloadArchive([a.id]);
                        window.toastr?.success?.(`已导出「${label}」`);
                    }),
                    button('🗑 删除', async () => {
                        const ok = await askConfirm(`确定删掉「${label}」？删了就没了，建议先导出`);
                        if (!ok) return;
                        deleteArchive(a.id);
                        window.toastr?.success?.('已删除');
                        render();
                    }),
                ),
            );
        };

        /** 一份人物档案的卡片（载入 = 套到当前聊天里对应的那个人 ✓） */
        const personCard = (a) => {
            const label = archiveLabel(a);
            const targetKey = findTargetForArchive(a);
            const sum = summarizePerson(a);
            const who = String(a.name || '');
            return h('div', { class: 'bc-arch-card' },
                h('div', { class: 'bc-arch-head' },
                    h('div', { class: 'bc-arch-name', text: label }),
                    h('div', { class: 'bc-arch-time', text: `建立 ${fmtTime(a.createdAt)}　更新 ${fmtTime(a.updatedAt)}` }),
                ),
                h('div', { class: 'bc-arch-sum' },
                    h('span', { class: 'bc-arch-chip', text: `装了：${personBlocksLabel(a)}` }),
                    ...Object.entries(sum).map(([k, v]) =>
                        h('span', { class: 'bc-arch-chip', text: `${k}：${v}` })),
                ),
                h('div', { class: 'bc-row bc-row-wrap' },
                    targetKey
                        ? button(`↩ 载入到「${a.data?.isUser ? userLabel() : (targetLabelOf(targetKey) || who)}」`, async () => {
                            const ok = await applyPersonArchiveInteractive(a, targetKey);
                            if (!ok) return;
                            render();
                            refresh();
                        }, { variant: 'primary' })
                        : h('span', { class: 'bc-hint', text: `这个聊天里没有「${who}」，这份先放着：等追踪名单里有这个人了再载入` }),
                    targetKey ? button('💾 用当前覆盖', async () => {
                        const ok = await askConfirm(
                            `把「${who}」现在的设定写进「${label}」，这份档案原来的内容就没了。\n\n确定覆盖？`);
                        if (!ok) return;
                        const r = updatePersonArchive(a.id, targetKey);
                        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                        window.toastr?.success?.(`「${label}」已更新`);
                        render();
                    }) : null,
                    button('✏️ 改名', async () => {
                        // ★ 这里是**人物档案**，得给人物那份提示 ——
                        //   不给的话会落到 askArchiveName 的默认文案（那是**世界观档案**的清单）✗
                        const r0 = await askArchiveName('改档案名', a.name, a.note || '',
                            '人物档案装的是这个对象「动过的」那几块（基础信息 / 补丁 / 别名、标签与备注）；改名字只是改个叫法，里面装的东西一个都不动');
                        if (!r0) return;
                        const r = renameArchive(a.id, r0.name, r0.note);
                        if (!r.ok) { window.toastr?.warning?.(r.error); return; }
                        render();
                    }),
                    button('📤 导出这份', () => {
                        downloadArchive([a.id]);
                        window.toastr?.success?.(`已导出「${label}」`);
                    }),
                    button('🗑 删除', async () => {
                        const ok = await askConfirm(`确定删掉「${label}」？删了就没了，建议先导出`);
                        if (!ok) return;
                        deleteArchive(a.id);
                        window.toastr?.success?.('已删除');
                        render();
                    }),
                ),
            );
        };

        const paint = () => {
            clear(host);
            const w = matched(worldList);
            const p = matched(personList);
            if (!w.length && !p.length) {
                host.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的档案' }));
                return;
            }
            // ① 世界观档案（★ 减密度：那句说明进「？」）
            const boxW = section(`世界观档案（${w.length}${w.length === worldList.length ? '' : ' / ' + worldList.length}）`, {
                plain: true,
                help: ['整套规则。载入会把当前这套替换掉（替换前自动备份）'],
            });
            const bodyW = boxW.querySelector('.bc-section-body');
            for (const a of w) bodyW.appendChild(worldCard(a));
            if (!w.length) bodyW.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的世界观档案' }));
            host.appendChild(boxW);

            // ② 人物档案
            const boxP = section(`人物档案（${p.length}${p.length === personList.length ? '' : ' / ' + personList.length}）`, {
                plain: true,
                help: ['某一个角色的设定（基础信息 / 补丁 / 别名、标签与备注，只装动过的）。载入时按「名字」自动对上当前聊天里的那个人'],
            });
            const bodyP = boxP.querySelector('.bc-section-body');
            for (const a of p) bodyP.appendChild(personCard(a));
            if (!p.length) bodyP.appendChild(h('div', { class: 'bc-empty', text: '没有匹配的人物档案。在「规则补丁 → 人物」那一栏里可以存' }));
            host.appendChild(boxP);
        };
        paint();
    }

    render();
}

/** 当前聊天里某个对象显示成什么（只给人看） */
function targetLabelOf(key) {
    if (!key) return '';
    const t = targetList().find(x => String(x.key) === String(key));
    return t ? (displayName(t) || t.key) : String(key);
}
