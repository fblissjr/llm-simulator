import * as os from "node:os";
import type { Subprocess } from "bun";

export function getLocalLanIp(): string {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

export class TunnelManager {
  private proc: Subprocess | null = null;
  public publicUrl: string | null = null;

  public async start(
    port: number,
    passkey: string
  ): Promise<{
    url: string | null;
    localUrl: string;
    note?: string;
  }> {
    this.stop();

    const lanIp = getLocalLanIp();
    const localUrl = `http://${lanIp}:${port}/?key=${passkey}`;

    const bin = Bun.which("cloudflared");
    if (!bin) {
      return {
        url: null,
        localUrl,
        note: "cloudflared is not installed (`brew install cloudflared` for a public internet tunnel). Local LAN / Tailscale link is active!",
      };
    }

    const proc = Bun.spawn(
      [bin, "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    this.proc = proc;

    const foundBaseUrl = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);
      const decoder = new TextDecoder();
      let buffer = "";

      const readStream = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return;
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const match = buffer.match(
              /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/
            );
            if (match) {
              clearTimeout(timeout);
              resolve(match[0]);
              return;
            }
          }
        } catch {
          // Ignore stream close
        }
      };

      void readStream(proc.stderr);
      void readStream(proc.stdout);
    });

    if (foundBaseUrl) {
      this.publicUrl = `${foundBaseUrl}/?key=${passkey}`;
      return {
        url: this.publicUrl,
        localUrl,
      };
    }

    return {
      url: null,
      localUrl,
      note: "Timed out waiting for cloudflared URL, but Local LAN / Tailscale link is active.",
    };
  }

  public stop(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        // Ignore
      }
      this.proc = null;
    }
    this.publicUrl = null;
  }
}
