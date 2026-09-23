/** Company → Director → Other companies / LLPs relationship graph (BFS over company_directors). */
import { getDb } from "../db/client";
import { getRolesForDirectorIds } from "../db/repository";
import { getDirectorByDin } from "../db/repository";
import type { NetworkEdge, NetworkGraph, NetworkNode } from "../domain/types";
import { resolveEntity } from "./entity-service";
import { NotFoundError, ValidationError } from "./errors";
import { DIN_RE } from "../identifiers";

const MAX_NODES = 150;

export async function getNetwork(raw: string, depth = 2): Promise<NetworkGraph> {
  const { db, profile } = await resolveEntity(raw);
  depth = Math.min(Math.max(depth, 1), 3);

  const nodes = new Map<string, NetworkNode>();
  const edges = new Map<string, NetworkEdge>();
  const entityKey = (id: string) => `e:${id}`;
  const dirKey = (din: string) => `d:${din}`;

  nodes.set(entityKey(profile.identifier), {
    id: entityKey(profile.identifier),
    type: profile.kind,
    label: profile.name,
    identifier: profile.identifier,
    status: profile.status,
    depth: 0,
    isRoot: true,
  });

  let frontierEntities = [profile.identifier];
  for (let level = 1; level <= depth && frontierEntities.length; level++) {
    // directors of frontier entities
    const dirRows = await db.query<{ director_id: string }>(
      `select distinct cd.director_id from company_directors cd
       left join companies c on c.id = cd.company_id left join llps l on l.id = cd.llp_id
       where coalesce(c.cin, l.llpin) = any($1::text[])`,
      [frontierEntities],
    );
    const roles = await getRolesForDirectorIds(db, dirRows.map((r) => r.director_id));
    const next: string[] = [];
    for (const r of roles) {
      if (nodes.size >= MAX_NODES) break;
      const dk = dirKey(r.din);
      if (!nodes.has(dk)) nodes.set(dk, { id: dk, type: "director", label: r.director_name, identifier: r.din, status: null, depth: level * 2 - 1 });
      const ek = entityKey(r.entity_identifier);
      if (!nodes.has(ek)) {
        nodes.set(ek, { id: ek, type: r.entity_kind, label: r.entity_name, identifier: r.entity_identifier, status: r.entity_status, depth: level * 2 });
        next.push(r.entity_identifier);
      }
      const edgeId = `${dk}->${ek}:${r.appointment_date ?? ""}`;
      edges.set(edgeId, { source: dk, target: ek, designation: r.designation, isCurrent: !r.cessation_date });
    }
    frontierEntities = next;
  }

  // Common directors: other entities sharing ≥1 director with the root.
  const rootDirectors = new Set([...edges.values()].filter((e) => e.target === entityKey(profile.identifier)).map((e) => e.source));
  const shared = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    if (e.target === entityKey(profile.identifier) || !rootDirectors.has(e.source)) continue;
    if (!shared.has(e.target)) shared.set(e.target, new Set());
    shared.get(e.target)!.add(e.source);
  }
  const commonDirectors = [...shared.entries()]
    .map(([ek, dks]) => {
      const n = nodes.get(ek)!;
      return {
        entityIdentifier: n.identifier,
        entityName: n.label,
        entityKind: n.type as "company" | "llp",
        sharedDirectors: [...dks].map((dk) => ({ din: nodes.get(dk)!.identifier, name: nodes.get(dk)!.label })),
      };
    })
    .sort((a, b) => b.sharedDirectors.length - a.sharedDirectors.length);

  return { nodes: [...nodes.values()], edges: [...edges.values()], commonDirectors };
}

export async function getDirector(din: string) {
  const v = din.trim();
  if (!DIN_RE.test(v)) throw new ValidationError("DIN must be 8 digits");
  const db = await getDb();
  const d = await getDirectorByDin(db, v);
  if (!d) throw new NotFoundError(`No director found for DIN ${v}`);
  // Co-directors: people who share at least one entity with this director.
  const entityIds = d.roles.map((r) => r.entityIdentifier);
  const co = await db.query<{ din: string; name: string; shared: number }>(
    `select d.din, d.name, count(distinct coalesce(c.cin, l.llpin))::int as shared
     from company_directors cd join directors d on d.id = cd.director_id
     left join companies c on c.id = cd.company_id left join llps l on l.id = cd.llp_id
     where coalesce(c.cin, l.llpin) = any($1::text[]) and d.din <> $2
     group by d.din, d.name order by shared desc, d.name limit 50`,
    [entityIds, v],
  );
  return { ...d, coDirectors: co };
}
