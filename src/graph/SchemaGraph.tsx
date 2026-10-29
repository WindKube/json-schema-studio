import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Path } from "../builder/tree";
import { TYPE_COLORS } from "../pages/editor/PropertyDetails";
import { buildGraph, type GraphNode, idOf, typeLabel } from "./build";

const WIDTH = 230;
const heightOf = (n: GraphNode) => (n.kind === "defs" ? 40 : 38 + n.rows.length * 18);
const BOOL_COLORS: Record<string, string> = { true: "#11603A", false: "#8C1D13" };

type Data = GraphNode & { summary: string; current: boolean };

function SchemaNode({ data }: NodeProps<Node<Data>>) {
  const color = TYPE_COLORS[data.type] ?? BOOL_COLORS[data.type] ?? "#9AA3B2";
  if (data.kind === "defs") {
    return (
      <div className="flex h-10 items-center justify-center rounded-full border border-dashed border-line-strong bg-page px-4 text-xs font-semibold tracking-wide text-muted uppercase">
        <Handle type="target" position={Position.Left} />
        Definitions
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-surface font-mono text-xs shadow-sm ${data.current ? "border-accent ring-2 ring-accent" : "border-line-strong"}`}
      style={{ width: WIDTH, borderTop: `3px solid ${color}` }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="truncate font-semibold text-ink">{data.label}</span>
        {data.required && <span className="font-bold text-err">*</span>}
        <span className="ml-auto shrink-0 font-semibold" style={{ color }}>
          {data.summary}
        </span>
      </div>
      {data.rows.length > 0 && (
        <dl className="m-0 border-t border-line-soft px-2.5 py-1">
          {data.rows.map(([k, v]) => (
            <div key={k} className="flex h-[18px] gap-2">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 ml-auto truncate text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { schema: SchemaNode };

export default function SchemaGraph({
  root,
  selected,
  onSelect,
  onOpen,
}: {
  root: unknown;
  selected: Path;
  onSelect: (path: Path) => void;
  onOpen: (path: Path) => void;
}) {
  const graph = useMemo(() => buildGraph(root), [root]);

  const positions = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) g.setNode(n.id, { width: WIDTH, height: heightOf(n) });
    for (const e of graph.edges) if (!e.ref) g.setEdge(e.source, e.target);
    dagre.layout(g);
    return new Map(
      graph.nodes.map((n) => {
        const p = g.node(n.id);
        return [n.id, { x: p.x - WIDTH / 2, y: p.y - heightOf(n) / 2 }];
      }),
    );
  }, [graph]);

  const current = idOf(selected);
  const start = useMemo(
    () => [
      { id: idOf([]) },
      ...graph.edges.filter((e) => e.source === idOf([]) && !e.ref).map((e) => ({ id: e.target })),
    ],
    [graph],
  );
  const nodes = useMemo<Node<Data>[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "schema",
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { ...n, summary: typeLabel(n, root), current: n.id === current },
        connectable: false,
        draggable: false,
      })),
    [graph, positions, root, current],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const active = e.source === current || e.target === current;
        const stroke = e.ref ? "#2F5BEA" : active ? "#14171C" : "#B9C3D6";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.ref ? "default" : "smoothstep",
          animated: e.ref || active,
          label: e.ref ? "$ref" : undefined,
          labelStyle: { fill: "#2F5BEA", fontSize: 11, fontWeight: 600 },
          style: {
            stroke,
            strokeWidth: active || e.ref ? 2 : 1.25,
            strokeDasharray: e.ref ? "6 4" : undefined,
          },
          markerEnd: e.ref ? { type: MarkerType.ArrowClosed, color: stroke } : undefined,
        };
      }),
    [graph, current],
  );

  return (
    <div className="relative h-full w-full" data-testid="schema-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ nodes: start, padding: 0.1, minZoom: 0.6, maxZoom: 1 }}
        minZoom={0.1}
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={(_, n) => n.data.path && onSelect(n.data.path)}
        onNodeDoubleClick={(_, n) => n.data.path && onOpen(n.data.path)}
      >
        <Background gap={20} color="#E3E6EB" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {graph.truncated && (
        <p className="absolute top-2 left-2 m-0 rounded-md bg-warn-bg px-2 py-1 text-xs text-warn">
          Large schema: showing the first {graph.nodes.length} nodes.
        </p>
      )}
    </div>
  );
}
