import { Database } from "bun:sqlite";
import * as path from "node:path";
import type {
  ChatMessage,
  Persona,
  PersonaEngineBinding,
} from "../types.ts";

export interface StoredChannelRow {
  name: string;
  vibe_key: string;
  vibe: string;
  updated_at: number;
}

export class SimDatabase {
  private db: Database;

  constructor(dbPath = path.resolve(process.cwd(), "llm-sim.db")) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        name TEXT PRIMARY KEY,
        vibe_key TEXT NOT NULL,
        vibe TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_bots (
        channel_name TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (channel_name, persona_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        channel_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_nick TEXT NOT NULL,
        avatar TEXT,
        color TEXT,
        family_tag TEXT,
        thinking TEXT,
        text TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel_seq
        ON messages(channel_name, seq);

      CREATE TABLE IF NOT EXISTS custom_personas (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS persona_bindings (
        persona_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  public getChannel(name: string): StoredChannelRow | null {
    const stmt = this.db.query<StoredChannelRow, [string]>(
      "SELECT name, vibe_key, vibe, updated_at FROM channels WHERE name = ?"
    );
    return stmt.get(name) ?? null;
  }

  public upsertChannel(name: string, vibeKey: string, vibe: string): void {
    this.db.run(
      `INSERT INTO channels (name, vibe_key, vibe, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         vibe_key = excluded.vibe_key,
         vibe = excluded.vibe,
         updated_at = excluded.updated_at`,
      [name, vibeKey, vibe, Date.now()]
    );
  }

  public getChannelBotIds(channelName: string): string[] {
    const rows = this.db
      .query<{ persona_id: string }, [string]>(
        "SELECT persona_id FROM channel_bots WHERE channel_name = ? ORDER BY position ASC"
      )
      .all(channelName);
    return rows.map((r) => r.persona_id);
  }

  public setChannelBotIds(channelName: string, personaIds: string[]): void {
    const tx = this.db.transaction((chan: string, ids: string[]) => {
      this.db.run("DELETE FROM channel_bots WHERE channel_name = ?", [chan]);
      const insert = this.db.prepare(
        "INSERT INTO channel_bots (channel_name, persona_id, position) VALUES (?, ?, ?)"
      );
      ids.forEach((id, idx) => {
        insert.run(chan, id, idx);
      });
    });
    tx(channelName, personaIds);
  }

  public upsertMessage(channelName: string, msg: ChatMessage): void {
    this.db.run(
      `INSERT INTO messages (
        id, channel_name, timestamp, created_at, kind,
        sender_id, sender_nick, avatar, color, family_tag, thinking, text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thinking = excluded.thinking,
        text = excluded.text`,
      [
        msg.id,
        channelName,
        msg.timestamp,
        Date.now(),
        msg.kind,
        msg.senderId,
        msg.senderNick,
        msg.avatar ?? null,
        msg.color ?? null,
        msg.familyTag ?? null,
        msg.thinking ?? null,
        msg.text,
      ]
    );
  }

  public getChannelMessages(channelName: string, limit = 80): ChatMessage[] {
    const rows = this.db
      .query<
        {
          id: string;
          timestamp: string;
          kind: "user" | "model" | "system" | "event";
          sender_id: string;
          sender_nick: string;
          avatar: string | null;
          color: string | null;
          family_tag: string | null;
          thinking: string | null;
          text: string;
        },
        [string, number]
      >(
        `SELECT id, timestamp, kind, sender_id, sender_nick, avatar, color, family_tag, thinking, text
         FROM (
           SELECT * FROM messages WHERE channel_name = ? ORDER BY seq DESC LIMIT ?
         )
         ORDER BY seq ASC`
      )
      .all(channelName, limit);

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      kind: r.kind,
      senderId: r.sender_id,
      senderNick: r.sender_nick,
      avatar: r.avatar ?? undefined,
      color: r.color ?? undefined,
      familyTag: r.family_tag ?? undefined,
      thinking: r.thinking ?? undefined,
      text: r.text,
      streaming: false,
    }));
  }

  public clearChannelMessages(channelName: string): void {
    this.db.run("DELETE FROM messages WHERE channel_name = ?", [channelName]);
  }

  public getMessageCount(channelName: string): number {
    const row = this.db
      .query<{ cnt: number }, [string]>(
        "SELECT COUNT(*) as cnt FROM messages WHERE channel_name = ?"
      )
      .get(channelName);
    return row?.cnt ?? 0;
  }

  public listChannelRows(): StoredChannelRow[] {
    return this.db
      .query<StoredChannelRow, []>(
        "SELECT name, vibe_key, vibe, updated_at FROM channels ORDER BY name ASC"
      )
      .all();
  }

  public saveCustomPersona(persona: Persona): void {
    this.db.run(
      `INSERT INTO custom_personas (id, json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      [persona.id.toLowerCase(), JSON.stringify(persona), Date.now()]
    );
  }

  public loadCustomPersonas(): Persona[] {
    const rows = this.db
      .query<{ json: string }, []>("SELECT json FROM custom_personas")
      .all();
    const result: Persona[] = [];
    for (const row of rows) {
      try {
        result.push(JSON.parse(row.json) as Persona);
      } catch {
        // Ignore corrupted JSON
      }
    }
    return result;
  }

  public setPersonaBinding(
    personaId: string,
    binding: PersonaEngineBinding | null
  ): void {
    const key = personaId.toLowerCase();
    if (!binding) {
      this.db.run("DELETE FROM persona_bindings WHERE persona_id = ?", [key]);
      return;
    }
    this.db.run(
      `INSERT INTO persona_bindings (persona_id, provider, model, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(persona_id) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         updated_at = excluded.updated_at`,
      [key, binding.provider.toLowerCase(), binding.model, Date.now()]
    );
  }

  public loadPersonaBindings(): Record<string, PersonaEngineBinding> {
    const rows = this.db
      .query<
        { persona_id: string; provider: string; model: string },
        []
      >("SELECT persona_id, provider, model FROM persona_bindings")
      .all();
    const out: Record<string, PersonaEngineBinding> = {};
    for (const r of rows) {
      out[r.persona_id.toLowerCase()] = {
        provider: r.provider,
        model: r.model,
      };
    }
    return out;
  }

  public setGlobalEngine(binding: PersonaEngineBinding): void {
    this.db.run(
      `INSERT INTO server_settings (key, value, updated_at)
       VALUES ('global_engine', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [JSON.stringify(binding), Date.now()]
    );
  }

  public getGlobalEngine(): PersonaEngineBinding | null {
    const row = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM server_settings WHERE key = 'global_engine'"
      )
      .get();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as PersonaEngineBinding;
    } catch {
      return null;
    }
  }

  public close(): void {
    this.db.close();
  }
}
