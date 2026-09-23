import { getDb } from "../db/client";
import { resolveEntity } from "./entity-service";

export interface WatchlistItem {
  id: string;
  entityKind: "company" | "llp";
  entityIdentifier: string;
  entityName: string;
  note: string | null;
  createdAt: string;
  status: string | null;
}

export async function listWatchlist(userId: string): Promise<WatchlistItem[]> {
  const db = await getDb();
  return db.query<WatchlistItem>(
    `select w.id, w.entity_kind as "entityKind", w.entity_identifier as "entityIdentifier", w.entity_name as "entityName",
            w.note, w.created_at as "createdAt", coalesce(c.status, l.status) as status
     from watchlists w left join companies c on c.cin = w.entity_identifier left join llps l on l.llpin = w.entity_identifier
     where w.user_id = $1 order by w.created_at desc`,
    [userId],
  );
}

export async function addToWatchlist(userId: string, identifier: string, note?: string) {
  const { db, profile } = await resolveEntity(identifier);
  await db.query(
    `insert into watchlists (user_id, entity_kind, entity_identifier, entity_name, note) values ($1,$2,$3,$4,$5)
     on conflict (user_id, entity_identifier) do update set note = coalesce(excluded.note, watchlists.note)`,
    [userId, profile.kind, profile.identifier, profile.name, note ?? null],
  );
  return listWatchlist(userId);
}

export async function removeFromWatchlist(userId: string, identifier: string) {
  const db = await getDb();
  await db.query(`delete from watchlists where user_id = $1 and entity_identifier = $2`, [userId, identifier.toUpperCase()]);
  return listWatchlist(userId);
}
