"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Minus, Network, Plus, RotateCcw } from "lucide-react";
import { useCompanyQuery } from "./use-company";
import type { NetworkGraph, NetworkNode } from "@/lib/domain/types";
import { titleCase } from "@/lib/format";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from "../ui/primitives";
import { StatusBadge } from "../badges";
import { EmptyState, ErrorState, LoadingBlock } from "../states";

type SimNode = NetworkNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { isCurrent: boolean; designation: string | null };

const W = 900;
const H = 560;
const INACTIVE = /strike|struck|dissolved|liquidat|amalgamat/i;

function nodeStyle(n: NetworkNode) {
  if (n.type === "director") return { r: 7, fill: "var(--chart-2)", shape: "circle" as const };
  const inactive = n.status && INACTIVE.test(n.status);
  const fill = n.isRoot ? "var(--primary)" : inactive ? "var(--danger)" : n.type === "llp" ? "var(--chart-3)" : "var(--chart-1)";
  return { r: n.isRoot ? 14 : 10, fill, shape: n.type === "llp" ? ("diamond" as const) : ("square" as const) };
}

function Graph({ graph }: { graph: NetworkGraph }) {
  const router = useRouter();
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const ns: SimNode[] = graph.nodes.map((n) => ({ ...n, ...(n.isRoot ? { fx: W / 2, fy: H / 2 } : {}) }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: SimLink[] = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: e.source, target: e.target, isCurrent: e.isCurrent, designation: e.designation }));
    const sim = forceSimulation(ns)
      .force("link", forceLink<SimNode, SimLink>(ls).id((d) => d.id).distance((l) => ((l.target as SimNode).isRoot ? 90 : 110)).strength(0.7))
      .force("charge", forceManyBody().strength(-420))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => nodeStyle(d).r + 26))
      .force("x", forceX(W / 2).strength(0.04))
      .force("y", forceY(H / 2).strength(0.07))
      .stop();
    for (let i = 0; i < 320; i++) {
      sim.tick();
      // keep nodes (and their labels) inside the canvas
      for (const n of ns) {
        n.x = Math.max(70, Math.min(W - 70, n.x ?? W / 2));
        n.y = Math.max(24, Math.min(H - 34, n.y ?? H / 2));
      }
    }
    setNodes([...ns]);
    setLinks([...ls]);
    return () => {
      sim.stop();
    };
  }, [graph]);

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const l of links) {
      const a = (l.source as SimNode).id;
      const b = (l.target as SimNode).id;
      if (a === hover) s.add(b);
      if (b === hover) s.add(a);
    }
    return s;
  }, [hover, links]);

  const hovered = nodes.find((n) => n.id === hover);

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex gap-1 no-print">
        <Button size="icon" variant="outline" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, k: Math.min(v.k * 1.25, 4) }))}><Plus /></Button>
        <Button size="icon" variant="outline" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, k: Math.max(v.k / 1.25, 0.4) }))}><Minus /></Button>
        <Button size="icon" variant="outline" aria-label="Reset view" onClick={() => setView({ k: 1, x: 0, y: 0 })}><RotateCcw /></Button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[480px] w-full cursor-grab touch-none select-none rounded-lg bg-muted/30 active:cursor-grabbing sm:h-[560px]"
        role="img"
        aria-label="Director network graph"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const scale = W / rect.width;
          setView((v) => ({ ...v, x: drag.current!.ox + (e.clientX - drag.current!.sx) * scale, y: drag.current!.oy + (e.clientY - drag.current!.sy) * scale }));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setView((v) => ({ ...v, k: Math.min(4, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.1 : 0.9))) }))}
      >
        <g transform={`translate(${view.x + (W / 2) * (1 - view.k)} ${view.y + (H / 2) * (1 - view.k)}) scale(${view.k})`}>
          {links.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            const dim = neighbours && !(neighbours.has(s.id) && neighbours.has(t.id));
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="var(--muted-foreground)"
                strokeOpacity={dim ? 0.08 : l.isCurrent ? 0.55 : 0.3}
                strokeWidth={l.isCurrent ? 1.5 : 1}
                strokeDasharray={l.isCurrent ? undefined : "4 3"}
              />
            );
          })}
          {nodes.map((n) => {
            const st = nodeStyle(n);
            const dim = neighbours && !neighbours.has(n.id);
            const clickable = n.type !== "director" ? `/company/${n.identifier}` : `/director/${n.identifier}`;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                opacity={dim ? 0.2 : 1}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => router.push(clickable)}
              >
                <circle r={st.r + 12} fill="transparent" />
                {st.shape === "circle" && <circle r={st.r} fill={st.fill} stroke="var(--card)" strokeWidth={2} />}
                {st.shape === "square" && <rect x={-st.r} y={-st.r} width={st.r * 2} height={st.r * 2} rx={3} fill={st.fill} stroke="var(--card)" strokeWidth={2} />}
                {st.shape === "diamond" && <rect x={-st.r * 0.8} y={-st.r * 0.8} width={st.r * 1.6} height={st.r * 1.6} rx={2} transform="rotate(45)" fill={st.fill} stroke="var(--card)" strokeWidth={2} />}
                <text y={st.r + 13} textAnchor="middle" fontSize={n.isRoot ? 12 : 10.5} fontWeight={n.isRoot ? 600 : 400} fill="var(--foreground)" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>
                  {(n.type === "director" ? n.label : titleCase(n.label)).slice(0, 34)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border bg-card p-3 text-xs shadow-lg">
          <p className="font-medium">{hovered.type === "director" ? hovered.label : titleCase(hovered.label)}</p>
          <p className="font-mono text-muted-foreground">{hovered.type === "director" ? `DIN ${hovered.identifier}` : hovered.identifier}</p>
          {hovered.type !== "director" && <div className="mt-1"><StatusBadge status={hovered.status} /></div>}
          <p className="mt-1 text-muted-foreground">Click to open</p>
        </div>
      )}
    </div>
  );
}

export function NetworkView({ identifier }: { identifier: string }) {
  const [depth, setDepth] = useState(2);
  const q = useCompanyQuery<NetworkGraph>(identifier, `/network?depth=${depth}`);
  if (q.isLoading && !q.data) return <LoadingBlock rows={10} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data!.data;
  const counts = { companies: g.nodes.filter((n) => n.type === "company").length, llps: g.nodes.filter((n) => n.type === "llp").length, directors: g.nodes.filter((n) => n.type === "director").length };

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="lg:col-span-3">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Relationship graph</CardTitle>
            <CardDescription>Company → Director → Other companies → LLPs. Shared appointments only.</CardDescription>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Depth
            <Select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Graph depth">
              <option value={1}>1 — directors & their entities</option>
              <option value={2}>2 — + second-degree</option>
              <option value={3}>3 — + third-degree</option>
            </Select>
          </label>
        </CardHeader>
        <CardContent>
          {g.nodes.length <= 1 ? <EmptyState icon={Network} title="No relationships found" description="No director/partner records are available to build a network for this entity." /> : <Graph graph={g} />}
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-primary" /> This entity</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[var(--chart-1)]" /> Company</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 rounded-[2px] bg-[var(--chart-3)]" /> LLP</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[var(--chart-2)]" /> Director / partner</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-danger" /> Inactive / struck off</span>
            <span className="flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-muted-foreground" /> Former appointment</span>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card className="p-4 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-lg font-semibold tabular">{counts.companies}</p><p className="text-[11px] text-muted-foreground">Companies</p></div>
            <div><p className="text-lg font-semibold tabular">{counts.llps}</p><p className="text-[11px] text-muted-foreground">LLPs</p></div>
            <div><p className="text-lg font-semibold tabular">{counts.directors}</p><p className="text-[11px] text-muted-foreground">People</p></div>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Common directors</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {g.commonDirectors.map((c) => (
                <li key={c.entityIdentifier} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/company/${c.entityIdentifier}`} className="hover:underline">{titleCase(c.entityName)}</Link>
                    <Badge tone={c.entityKind === "llp" ? "success" : "primary"}>{c.entityKind === "llp" ? "LLP" : "Co."}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{c.sharedDirectors.map((d) => d.name).join(", ")}</p>
                </li>
              ))}
              {!g.commonDirectors.length && <li className="text-xs text-muted-foreground">None found.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
