/**
 * gen-gate.js —— 「这一轮生成到底有没有产出消息」的门控
 *
 * 酒馆每生成一次会发两个跟这次生成有关的事件：
 *   · 新消息进聊天（MESSAGE_RECEIVED）
 *   · 生成结束（GENERATION_ENDED）
 *
 * 两条生成路径的先后正好相反：
 *   · 非流式：先「新消息」，后「生成结束」
 *   · 流式（真流、假流都走同一条路）：先「生成结束」，后「新消息」
 *
 * 只看其中一个事件的先后，就会把另一种模式误判成"这一轮啥都没产出来"。
 * ⇒ 这里不假设顺序：两个信号都记下，**都到了才放行**；只看到「生成结束」、
 *   没看到「新消息」＝ 报错 / 被中止 / 空回，不放行。
 *
 * ⚠️ 一次生成只放行一次（`claim()`）；新一轮由 `reset()` 清干净。
 * ⚠️ 有的客户端没有「生成结束」这个事件 ⇒ 调用方把「新消息」也当成结束信号
 *   （见 index.js 的兜底），这里不需要知道这件事。
 * ⚠️ 一条事件可能晚到（例如「被中止」的信号比「生成结束」晚一步）⇒ 调用方用
 *   `serial()` 认自己是不是过期的那一轮，别把旧轮的原因记到新轮头上。
 */

/**
 * @returns {{
 *   reset(): void,
 *   serial(): number,
 *   onMessage(): void,
 *   onEnded(): void,
 *   onStopped(): void,
 *   got(): boolean,
 *   aborted(): boolean,
 *   ready(): boolean,
 *   claim(): boolean,
 *   claimEndedOnly(): boolean,
 * }}
 */
export function createGenGate() {
    let serial = 0;
    let ended = false;
    let got = false;
    let stopped = false;
    let claimed = false;

    return {
        /** 新一轮开始：全部清掉，序号 +1（旧的回调靠序号认出自己过期了） */
        reset() {
            serial++;
            ended = false;
            got = false;
            stopped = false;
            claimed = false;
        },

        /** 当前是第几轮（`reset()` 时 +1） */
        serial() {
            return serial;
        },

        /** 新消息进聊天 */
        onMessage() {
            got = true;
        },

        /** 生成结束 */
        onEnded() {
            ended = true;
        },

        /** 玩家按了停止（这个信号可能比「生成结束」晚到） */
        onStopped() {
            stopped = true;
        },

        /** 这次生成有没有产出一条消息 */
        got() {
            return got;
        },

        /** 这次生成是不是被中止的（只用来决定"跳过"的原因怎么写） */
        aborted() {
            return stopped;
        },

        /** 两个信号都到了，而且这一轮还没放行过 */
        ready() {
            return ended && got && !claimed;
        },

        /**
         * 放行一次（两个信号都到才给）。
         * @returns {boolean} 这次真的放行了
         */
        claim() {
            if (claimed || !ended || !got) return false;
            claimed = true;
            return true;
        },

        /**
         * 只凭「生成结束」放行一次 —— 给玩家关掉「空回跳过」时的老口径用。
         * @returns {boolean} 这次真的放行了
         */
        claimEndedOnly() {
            if (claimed || !ended) return false;
            claimed = true;
            return true;
        },
    };
}
