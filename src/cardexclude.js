/**
 * cardexclude.js —— 「这个角色卡不启用推演」的名单。
 *
 * 口径（2026-10-28 定）：卡级排除，排除之后只停"推演那一族"（不注入、不判定、不记录），
 *   悬浮球和面板留着，番茄钟这类本地工具照常能用。
 *
 * 落到实现上的四条：
 *   ① **卡级**，不做聊天级；名单**全局一份**、穿过所有存档（跟世界书排除表同一个存法 ✓）
 *   ② 认卡用**头像文件名**：卡名会重名、也会改，头像文件名在酒馆里才是那把唯一的钥匙
 *      （界面上显示的仍然是卡名 ✓）
 *   ③ **群聊不参与判断**：群聊没有"一张卡"，一半排了一半没排，行为上没法解释
 *   ④ 排除后停的只是「推演一族」：不注入、不判定、不写推演账本、不自动 / 手动推演；
 *      面板与悬浮球留着，番茄钟 / 骰子 / 随手记 / 日历（现实日期）照常能用
 *
 * ⚠️ 已有数据**一个字节都不删、也不改**（这是红线）：排除只是"以后不再动它"，
 *    想恢复就再点一次「启用」，原来那些记录原样还在 ✓
 */

import { getCtx } from './st.js';
import { settings, save } from './settings.js';

/**
 * 当前聊天用的那张卡的头像文件名。
 * 群聊 / 不在任何聊天里 / 拿不到上下文 ⇒ `null`（`null` 一律当"没排除"处理 ✓）
 */
export function currentCardAvatar() {
    try {
        const c = getCtx();
        if (!c) return null;
        // 群聊：`groupId` 有值就说明这是群聊（群聊里没有"当前这一张卡"）
        const gid = c.groupId;
        if (gid !== undefined && gid !== null && String(gid) !== '') return null;
        const list = Array.isArray(c.characters) ? c.characters : [];
        const ch = list[c.characterId];
        const av = String(ch?.avatar || '').trim();
        return av || null;
    } catch { return null; }
}

/** 这张卡是不是被排除了（不传参数 = 当前聊天用的那张卡） */
export function isCardExcluded(avatar = currentCardAvatar()) {
    if (!avatar) return false;
    try {
        const map = settings()?.excludedCards;
        return !!(map && typeof map === 'object' && map[avatar] === true);
    } catch { return false; }
}

/**
 * 排除 / 放回。
 * @param {string} avatar 头像文件名
 * @param {boolean} off   true = 排除，false = 放回
 * @returns {boolean} 有没有真的动名单
 */
export function setCardExcluded(avatar, off = true) {
    const key = String(avatar || '').trim();
    if (!key) return false;
    try {
        const s = settings();
        if (!s.excludedCards || typeof s.excludedCards !== 'object') s.excludedCards = {};
        if (off) s.excludedCards[key] = true;
        else delete s.excludedCards[key];
        save();
        return true;
    } catch { return false; }
}

/** 已排除的卡（设置页列出来用；`name` 是给人看的卡名） */
export function excludedCardList() {
    const map = settings()?.excludedCards;
    if (!map || typeof map !== 'object') return [];
    return Object.keys(map)
        .filter((k) => map[k] === true)
        .sort()
        .map((avatar) => ({ avatar, name: cardNameOf(avatar) }));
}

/** 用头像文件名反查卡名（查不到就退回文件名本身，去掉扩展名） */
export function cardNameOf(avatar) {
    const hit = allCards().find((x) => x.avatar === avatar);
    if (hit) return hit.name;
    return String(avatar || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

/**
 * 酒馆里**全部**角色卡（只要认得出的：有头像文件名的那些）。
 *
 * 为什么要全量：排除是个"预防型"开关，必须能在**没进那张聊天之前**就设好
 *   （2026-10-28 补：原来只按"当前这张卡"设，结果只能先进聊天才能排，那时第一轮生成已经跑过）
 * ⚠️ 但界面**不许**把它一次铺在设置页上（卡多会把页面拉爆）
 *   ⇒ 设置页只显示一行读数，点「选择角色卡…」开弹窗，弹窗里才有搜索和清单 ✓
 */
export function allCards() {
    try {
        const c = getCtx();
        const list = Array.isArray(c?.characters) ? c.characters : [];
        const out = [];
        for (const x of list) {
            const av = String(x?.avatar || '').trim();
            if (!av) continue;
            out.push({ avatar: av, name: String(x?.name || '').trim() || av.replace(/\.[^.]+$/, '') });
        }
        return out;
    } catch { return []; }
}
