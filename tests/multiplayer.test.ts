import { describe, expect, test } from "bun:test";
import { ChannelHub } from "../src/server/hub.ts";
import type { ServerPacket } from "../src/types.ts";

function connectTestClient(url: string): Promise<{
  ws: WebSocket;
  packets: ServerPacket[];
  waitForPacket: (
    predicate: (p: ServerPacket) => boolean,
    timeoutMs?: number
  ) => Promise<ServerPacket>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const packets: ServerPacket[] = [];
    const waiters: Array<{
      predicate: (p: ServerPacket) => boolean;
      resolve: (p: ServerPacket) => void;
    }> = [];

    ws.addEventListener("message", (ev) => {
      const pkt = JSON.parse(String(ev.data)) as ServerPacket;
      packets.push(pkt);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.predicate(pkt)) {
          const w = waiters.splice(i, 1)[0]!;
          w.resolve(pkt);
        }
      }
    });

    ws.addEventListener("open", () => {
      resolve({
        ws,
        packets,
        waitForPacket(predicate, timeoutMs = 2000) {
          const existing = packets.find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(
              () => rej(new Error("Timed out waiting for packet")),
              timeoutMs
            );
            waiters.push({
              predicate,
              resolve: (p) => {
                clearTimeout(timer);
                res(p);
              },
            });
          });
        },
      });
    });

    ws.addEventListener("error", (err) => {
      reject(err);
    });
  });
}

describe("4-Player DOOM Co-op ChannelHub Server", () => {
  test("Serves Retro Web Client with valid passkey, blocks invalid passkey, and enforces 4-player cap", async () => {
    const hub = new ChannelHub({
      dbPath: ":memory:",
      passkey: "doom1993",
      maxHumans: 4,
      guestCooldownMs: 0,
      starterIds: ["eliza", "sydney"],
    });
    const port = hub.start(0, "127.0.0.1");

    try {
      // 1. Unauthorized HTTP request without key -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(unauthRes.status).toBe(401);

      // 2. Authorized HTTP request with ?key=doom1993 -> 200 Retro Web Client HTML
      const webRes = await fetch(`http://127.0.0.1:${port}/?key=doom1993`);
      expect(webRes.status).toBe(200);
      const html = await webRes.text();
      expect(html).toContain("#latent-space");
      expect(html).toContain("4-Player DOOM Co-op");

      // 3. Connect 4 human players (1 Host + 3 Guests)
      const p1 = await connectTestClient(
        `ws://127.0.0.1:${port}/ws?key=doom1993&nick=player1&host=1`
      );
      const p2 = await connectTestClient(
        `ws://127.0.0.1:${port}/ws?key=doom1993&nick=alice`
      );
      const p3 = await connectTestClient(
        `ws://127.0.0.1:${port}/ws?key=doom1993&nick=bob`
      );
      const p4 = await connectTestClient(
        `ws://127.0.0.1:${port}/ws?key=doom1993&nick=romero`
      );

      const sync1 = await p1.waitForPacket((p) => p.type === "sync");
      expect(sync1.type === "sync" && sync1.isHost).toBe(true);

      await p1.waitForPacket(
        (p) => p.type === "presence" && p.humans.length === 4
      );

      // 4. Verify 5th human player is rejected (403 Lobby Full)
      const fifthRes = await fetch(
        `http://127.0.0.1:${port}/ws?key=doom1993&nick=fifth`
      );
      expect(fifthRes.status).toBe(403);

      // 4b. Verify a 5th viewer CAN connect with &spectate=1 in Read-Only Spectator Mode!
      const spec = await connectTestClient(
        `ws://127.0.0.1:${port}/ws?key=doom1993&nick=viewer&spectate=1`
      );
      const specSync = await spec.waitForPacket((p) => p.type === "sync");
      expect(specSync.type === "sync" && specSync.isSpectator).toBe(true);
      await p1.waitForPacket(
        (p) => p.type === "presence" && p.spectatorCount === 1
      );
      spec.ws.send(JSON.stringify({ type: "chat", text: "Can I talk?" }));
      const specNotice = await spec.waitForPacket(
        (p) =>
          p.type === "notice" && p.message.text.includes("read-only mode")
      );
      expect(specNotice.type).toBe("notice");
      spec.ws.close();

      // 5. Test /lock by Host (@player1) and verify Guest (@alice) cannot /banish while locked
      p1.ws.send(JSON.stringify({ type: "command", raw: "/lock" }));
      await p2.waitForPacket((p) => p.type === "presence" && p.locked === true);

      p2.ws.send(JSON.stringify({ type: "command", raw: "/banish sydney" }));
      const lockNotice = await p2.waitForPacket((p) => p.type === "notice");
      expect(
        lockNotice.type === "notice" && lockNotice.message.text
      ).toContain("locked");

      // 6. Test switching channels (/channel #arena)
      p2.ws.send(JSON.stringify({ type: "command", raw: "/channel #arena" }));
      const arenaSync = await p2.waitForPacket(
        (p) => p.type === "sync" && p.state.channelName === "#arena"
      );
      expect(
        arenaSync.type === "sync" && arenaSync.state.channelName
      ).toBe("#arena");

      // 7. Test /kickplayer by Host (@player1) kicking @bob
      p1.ws.send(JSON.stringify({ type: "command", raw: "/kickplayer bob" }));
      const kickedPkt = await p3.waitForPacket((p) => p.type === "kicked");
      expect(kickedPkt.type).toBe("kicked");

      p1.ws.close();
      p2.ws.close();
      p3.ws.close();
      p4.ws.close();
    } finally {
      hub.stop();
    }
  });
});
