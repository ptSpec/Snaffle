import type { ModelProvider } from "../../providers/provider.js";

type Release = () => void;

export class ProviderCapacity {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  tryAcquire(connectionId: string, limit: number): Release | null {
    const active = this.active.get(connectionId) ?? 0;
    if (active >= limit) return null;
    this.active.set(connectionId, active + 1);
    return this.release(connectionId);
  }

  async acquire(connectionId: string, limit: number, signal: AbortSignal): Promise<Release> {
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
      this.waiters.set(connectionId, [...this.waiters.get(connectionId) ?? [], resume]);
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

  reserve(provider: ModelProvider, limit: number, initial: Release): { provider: ModelProvider; release: Release } {
    let reservation: Release | null = initial;
    return {
      provider: {
        model: provider.model,
        providerId: provider.providerId,
        connectionId: provider.connectionId,
        complete: async (messages, tools, signal, onEvent) => {
          const release = reservation ?? await this.acquire(provider.connectionId, limit, signal);
          reservation = null;
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
        waiter();
        return;
      }
      const next = (this.active.get(connectionId) ?? 1) - 1;
      if (next) this.active.set(connectionId, next);
      else this.active.delete(connectionId);
    };
  }

  private removeWaiter(connectionId: string, waiter: () => void): void {
    const next = this.waiters.get(connectionId)?.filter((item) => item !== waiter) ?? [];
    if (next.length) this.waiters.set(connectionId, next);
    else this.waiters.delete(connectionId);
  }
}
