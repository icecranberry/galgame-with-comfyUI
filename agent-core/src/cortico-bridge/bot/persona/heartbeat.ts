/** Persona 心跳；tickDelayMs 提供基准间隔，连续无外部事件时指数退避。 */
/** policy 返回 null 时仍按此间隔重新求值,以接收热更新。 */
const POLICY_RECHECK_MS = 30 * 60_000;

/**
 * 空拍回退倍率上限。连续两拍之间没有外部事件时，下一拍间隔逐次翻倍至上限；任何外部事件（含 World flush）到达即复位。
 */
const IDLE_BACKOFF_MAX = 8;
/** 空拍数封顶在倍率到顶的那一拍:再数下去只是让 2^n 溢出 */
const IDLE_TICKS_MAX = Math.ceil(Math.log2(IDLE_BACKOFF_MAX));

export class Heartbeat {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastActivity = Date.now();
  /** 连续空拍数(只在基线路上累计);2^n 即下一拍的回退倍率 */
  private idleTicks = 0;
  /** 上一拍投递的时刻;与 lastActivity 比大小 = 这两拍之间有没有活动 */
  private lastFire = 0;

  constructor(
    private readonly baseline: (now: Date) => number | null,
    private readonly onFire: () => void,
  ) {}

  noteActivity(): void {
    this.lastActivity = Date.now();
    this.idleTicks = 0;
  }

  quietSeconds(): number {
    return Math.max(0, Math.round((Date.now() - this.lastActivity) / 1000));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.armNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 下一拍的间隔:基线按空拍数回退。null=此刻不心跳。 */
  private nextDelay(now: Date): number | null {
    const base = this.baseline(now);
    if (base === null) return null;
    return base * Math.min(2 ** this.idleTicks, IDLE_BACKOFF_MAX);
  }

  private armNext(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.nextDelay(new Date());
    if (delay === null) {
      this.timer = setTimeout(() => this.armNext(), POLICY_RECHECK_MS);
      return;
    }
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire(): void {
    if (!this.running) return;
    // 定时等待期间可能进入静默段;投递前重新应用节律策略。
    if (this.nextDelay(new Date()) !== null) {
      // 空拍计数在投递前结算:「上一拍到这一拍之间没有任何外部活动」即记一拍空转。
      if (this.lastActivity > this.lastFire) this.idleTicks = 0;
      else this.idleTicks = Math.min(this.idleTicks + 1, IDLE_TICKS_MAX);
      this.lastFire = Date.now();
      this.onFire();
    }
    this.armNext();
  }
}
