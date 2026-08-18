import type { ModelProvider } from "../../providers/provider.js";

type Release = () => void;
type Waiter = { resume: () => void; foreground: boolean };

export class ProviderCapacity {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Waiter[]>();

  activeCount(connectionId: string): number {
    return this.active.get(connectionId) ?? 0;
  }

  tryAcquire(connectionId: string, limit: number): Release | null {
    const active = this.active.get(connectionId) ?? 0;
    if (active >= limit) return null;
    this.active.set(connectionId, active + 1);
    return this.release(connectionId);
  }

  async acquire(
    connectionId: string,
    limit: number,
    signal: AbortSignal,
    foreground = false,
  ): Promise<Release> {
    if (signal.aborted) throw signal.reason ?? new Error("Run cancelled");
    const immediate = this.tryAcquire(connectionId, limit);
    if (immediate) return immediate;
    return new Promise<Release>((resolve, reject) => {
      const resume = () => {
        signal.removeEventListener("abort", abort);
        resolve(this.release(connectionId));
      };
      const abort = () => {
        this.removeWaiter(connectionId, resume);
        reject(signal.reason ?? new Error("Run cancelled"));
      };
      const waiters = [...this.waiters.get(connectionId) ?? []];
      const index = foreground ? waiters.findIndex((waiter) => !waiter.foreground) : -1;
      waiters.splice(index < 0 ? waiters.length : index, 0, { resume, foreground });
      this.waiters.set(connectionId, waiters);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  limit(provider: ModelProvider, limit: number): ModelProvider {
    return {
      model: provider.model,
      providerId: provider.providerId,
      connectionId: provider.connectionId,
      complete: async (messages, tools, signal, onEvent) => {
        const release = await this.acquire(provider.connectionId, limit, signal);
        try {
          return await provider.complete(messages, tools, signal, onEvent);
        } finally {
          release();
        }
      },
    };
  }

  reserve(
    provider: ModelProvider,
    limit: number,
    initial: Release,
    foreground = false,
    onWait?: () => void,
    onReady?: () => void,
  ): { provider: ModelProvider; release: Release } {
    let reservation: Release | null = initial;
    return {
      provider: {
        model: provider.model,
        providerId: provider.providerId,
        connectionId: provider.connectionId,
        complete: async (messages, tools, signal, onEvent) => {
          let release = reservation ?? this.tryAcquire(provider.connectionId, limit);
          reservation = null;
          if (!release) {
            onWait?.();
            release = await this.acquire(provider.connectionId, limit, signal, foreground);
            onReady?.();
          }
          try {
            return await provider.complete(messages, tools, signal, onEvent);
          } finally {
            release();
          }
        },
      },
      release: () => {
        reservation?.();
        reservation = null;
      },
    };
  }

  private release(connectionId: string): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.get(connectionId)?.shift();
      if (waiter) {
        if (!this.waiters.get(connectionId)?.length) this.waiters.delete(connectionId);
        waiter.resume();
        return;
      }
      const next = (this.active.get(connectionId) ?? 1) - 1;
      if (next) this.active.set(connectionId, next);
      else this.active.delete(connectionId);
    };
  }

  private removeWaiter(connectionId: string, waiter: () => void): void {
    const next = this.waiters.get(connectionId)?.filter((item) => item.resume !== waiter) ?? [];
    if (next.length) this.waiters.set(connectionId, next);
    else this.waiters.delete(connectionId);
  }
}
