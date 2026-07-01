/**
 * 统一缓冲分句器
 *
 * 字符先进 3 字闸门检测 {" 和 {p（兜底），安全的再逐字进入分句逻辑。
 * 分句规则:
 *    1. 队列 > 20 字: 遇到 ！？～~ 保留符号后断句; 遇到 ，。 断句并去掉标点
 *    2. 队列 ≤ 20 字: 遇到 ！？… 且前后不是 ！？… 时，强制断句（保留符号）
 *    3. 。逗号无论队列长度都触发分句，去掉句号本身，重置 20 字计数器
 *    4. flushAll() 时去掉末尾句号
 *    5. 成对符号保护: 《》【】「」（ ）"" '' 等，遇到开符号后直到闭符号才允许分句
 *   返回值: { segments: string[], stopped: boolean }
 *
 * 使用方式（非流式场景，完整文本）:
 *   const splitter = new SentenceSplitter();
 *   const { segments: feedSegs } = splitter.feed(text);
 *   const { segments: flushSegs } = splitter.flushAll();
 *   const allSegments = [...feedSegs, ...flushSegs].filter(Boolean);
 *
 * 使用方式（流式场景）:
 *   const splitter = new SentenceSplitter();
 *   for (const chunk of chunks) {
 *     const { segments, stopped } = splitter.feed(chunk);
 *     for (const seg of segments) { // emit seg }
 *     if (stopped) break;
 *   }
 *   const { segments: lastSegs } = splitter.flushAll();
 */
export class SentenceSplitter {
  // ── 成对符号定义 ──
  static OPEN_TO_CLOSE = {
    '《': '》', '【': '】', '「': '」', '（': '）', '(': ')',
    '“': '”',   // “ →
    '‘': '’',   // ‘ →
  };
  static CLOSE_TO_OPEN = {
    '》': '《', '】': '【', '」': '「', '）': '（', ')': '(',
    '”': '“',   // “ →
    '’': '‘',   // ‘ →
  };
  static TOGGLE_PAIRS = new Set(['"', '\'']);  // ASCII 引号，开=闭，遇同类切换

  constructor() {
    this.gate = '';          // {" 检测窗口（最多 3 字）
    this.buffer = '';        // 分句累积队列
    this.pendingSplit = -1;  // 规则 2 的延迟断句位置
    this.stopped = false;
    this.pairStack = [];     // 成对符号栈（未闭合的开符号）
  }

  _canSplit() { return this.pairStack.length === 0; }

  _trackPair(ch) {
    if (SentenceSplitter.OPEN_TO_CLOSE[ch]) {
      this.pairStack.push(ch);
    } else if (SentenceSplitter.CLOSE_TO_OPEN[ch]) {
      const expected = SentenceSplitter.CLOSE_TO_OPEN[ch];
      for (let i = this.pairStack.length - 1; i >= 0; i--) {
        if (this.pairStack[i] === expected) { this.pairStack.splice(i, 1); break; }
      }
    } else if (SentenceSplitter.TOGGLE_PAIRS.has(ch)) {
      if (this.pairStack.length > 0 && this.pairStack[this.pairStack.length - 1] === ch) {
        this.pairStack.pop();
      } else {
        this.pairStack.push(ch);
      }
    }
  }

  // 喂入 chunk，返回已完成的安全段落
  feed(text) {
    const segments = [];
    const emit = (s) => { if (s) segments.push(s); };

    for (const ch of text) {
      if (this.stopped) break;

      // ── 闸门：2~3 字滑动窗口检测 {" 和 {p（兜底），含 Unicode 引号变体 ──
      this.gate += ch;
      if (this.gate.length >= 2) {
        const last2 = this.gate.slice(-2);
        if (last2[0] === '{' && (last2[1] === '"' || last2[1] === '“' || last2[1] === '”' || last2[1] === 'p')) {
          this.stopped = true;
          break;
        }
      }
      if (this.gate.length < 3) continue;  // 缓冲未满，不出字
      const safe = this.gate[0];            // 确认安全，释放一字
      this.gate = this.gate.slice(1);

      // ── 规则 3: 。始终触发分句，去掉句号，重置计数器 ──
      if (safe === '。') {
        if (this._canSplit()) {
          emit(this.buffer);
          this.buffer = '';
          this.pendingSplit = -1;
        } else {
          this.buffer += safe;
        }
        continue;
      }

      // ── 分句逻辑 ──
      this.buffer += safe;
      this._trackPair(safe);
      const n = this.buffer.length;

      if (n > 20) {
        // ── 规则 1 ──
        if (this.pendingSplit >= 0) {
          if (this._canSplit()) {
            // 如果 pendingSplit 由 … 触发且当前字也是 …，取消延迟分句，改为将 …… 作为整体发出
            const splitTriggerChar = this.buffer[this.pendingSplit - 1];
            if (splitTriggerChar === '…' && safe === '…') {
              this.pendingSplit = -1;
              emit(this.buffer);
              this.buffer = '';
            } else {
              emit(this.buffer.slice(0, this.pendingSplit));
              this.buffer = this.buffer.slice(this.pendingSplit);
              this.pendingSplit = -1;
              if (safe === '…') {
                // 分句后当前字是 …，继续延迟等待（可能后面还有 …）
                if (this.buffer.length > 0) {
                  this.pendingSplit = this.buffer.length;
                }
              } else if (/[！？～~]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
                emit(this.buffer);
                this.buffer = '';
              } else if (/[，]/.test(safe)) {
                emit(this.buffer.slice(0, -1));
                this.buffer = '';
              }
            }
          }
        } else if (/[！？～~]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          if (this._canSplit()) {
            emit(this.buffer);
            this.buffer = '';
          }
        } else if (safe === '…') {
          // … 延迟分句，等待下一个字确认是否为 ……
          if (this._canSplit()) {
            this.pendingSplit = n;
          }
        } else if (/[，]/.test(safe)) {
          if (this._canSplit()) {
            emit(this.buffer.slice(0, -1));
            this.buffer = '';
          }
        }
      } else {
        // ── 规则 2 ──
        if (/[！？…]/.test(safe) || (safe === '.' && this.buffer.endsWith('...'))) {
          const prevCh = n > 1 ? this.buffer[n - 2] : null;
          if (prevCh && /[！？…]/.test(prevCh)) {
            this.pendingSplit = -1;
          } else if (this._canSplit()) {
            this.pendingSplit = n;
          }
        }
      }
    }
    return { segments, stopped: this.stopped };
  }

  // 流结束，释放闸门剩余安全字 + flush 分句队列
  flushAll() {
    if (this.stopped) {
      // 闸门中 {" 或 {p 之前仍有安全字（如 "。{" 中的 "。"），释放后再清空
      const pending = this.gate.slice(0, -2);
      for (const safe of pending) {
        if (safe === '。') {
          if (this._canSplit()) {
            if (this.buffer) {
              const seg = this.buffer.replace(/。$/, '');
              if (seg) this.buffer = seg;
              else this.buffer = '';
            }
          } else {
            this.buffer += safe;
          }
          continue;
        }
        this.buffer += safe;
        this._trackPair(safe);
      }
      let text = this.buffer;
      this.gate = '';
      this.buffer = '';
      this.pendingSplit = -1;
      this.pairStack.length = 0;
      text = text.replace(/。$/, '');
      return { segments: text ? [text] : [], stopped: true };
    }
    // 闸门中剩下的字全放（已确认不含 <pr），。仍触发分句
    for (const safe of this.gate) {
      if (safe === '。') {
        if (this._canSplit()) {
          // 压出当前 buffer 为一个 segment，丢弃句号
          if (this.buffer) {
            const seg = this.buffer.replace(/。$/, '');
            if (seg) this.buffer = seg;  // will be flushed below
            else this.buffer = '';
          }
        } else {
          this.buffer += safe;
        }
        continue;
      }
      this.buffer += safe;
      this._trackPair(safe);
      const n = this.buffer.length;
      if (n > 20) {
        if (/[，。]/.test(safe)) {
          this.buffer = this.buffer.slice(0, -1);
        }
      }
    }
    this.gate = '';
    // flush 分句队列
    let text = this.buffer;
    this.buffer = '';
    this.pendingSplit = -1;
    this.pairStack.length = 0;
    text = text.replace(/。$/, '');  // 规则 4: 去末尾句号
    return { segments: text ? [text] : [], stopped: false };
  }
}

/**
 * 对完整文本进行分句（非流式便捷函数）
 * @param {string} text - 完整文本
 * @returns {string[]} 分句后的段落数组
 */
export function splitText(text) {
  const splitter = new SentenceSplitter();
  const { segments: feedSegs } = splitter.feed(text);
  const { segments: flushSegs } = splitter.flushAll();
  return [...feedSegs, ...flushSegs].filter(Boolean);
}
