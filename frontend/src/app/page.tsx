'use client';

import React, { useState, useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
// @ts-ignore - cytoscape-dagre registers the hierarchical DAG layout algorithm
import dagre from 'cytoscape-dagre';
import {
  Upload, Loader2, Network, FileText, Sparkles, Split, Download, Info,
  ShieldCheck, Layers, X, Image as ImageIcon, FileSpreadsheet,
  AlertTriangle, Eye, ZoomIn, ZoomOut, Maximize2, GitBranch
} from 'lucide-react';

// Register Dagre hierarchical layout extension once on client
if (typeof window !== 'undefined') {
  try {
    cytoscape.use(dagre);
  } catch {
    // Already registered during hot-reload
  }
}

interface Concept {
  concept_id: string;
  name: string;
  description: string;
  domain?: string;
  source_slides?: number[];
}

interface Relationship {
  source_concept_id: string;
  target_concept_id: string;
  reasoning?: string;
}

interface MergedCluster {
  canonical_id: string;
  canonical_name: string;
  synonyms: string[];
}

interface Analytics {
  raw_concept_count: number;
  normalized_concept_count: number;
  concepts_reduced: number;
  raw_relationship_count: number;
  normalized_relationship_count: number;
  merged_clusters: MergedCluster[];
}

interface CycleEdge {
  source: string;
  target: string;
}

// ----------------------------------------------------------------------
// Cytoscape.js Interactive Graph Component
// ----------------------------------------------------------------------
function CytoscapeGraphViewer({
  concepts,
  relationships,
  cycleEdges,
  highlightedNodeIds,
  highlightedEdges,
  layoutMode,
  isLoading,
  onSelectConcept,
  onClearSelection,
  onDeleteEdge,
  cyRef,
}: {
  concepts: Concept[];
  relationships: Relationship[];
  cycleEdges: CycleEdge[];
  highlightedNodeIds: Set<string>;
  highlightedEdges: CycleEdge[];
  layoutMode: 'dagre' | 'circle' | 'cose';
  isLoading: boolean;
  onSelectConcept: (c: Concept) => void;
  onClearSelection: () => void;
  onDeleteEdge: (sourceId: string, targetId: string) => void;
  cyRef: React.MutableRefObject<Core | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Concept | null>(null);

  // Initialize and update Cytoscape instance
  useEffect(() => {
    if (!containerRef.current) return;

    const cycleSet = new Set(cycleEdges.map((e) => `${e.source}->${e.target}`));
    const highlightEdgeSet = new Set(highlightedEdges.map((e) => `${e.source}->${e.target}`));
    const hasHighlight = highlightedNodeIds.size > 0;

    // Build Cytoscape nodes & edges
    const elements: cytoscape.ElementDefinition[] = [
      ...concepts.map((c) => {
        const classes: string[] = [];
        if (hasHighlight) {
          classes.push(highlightedNodeIds.has(c.concept_id) ? 'highlighted' : 'dimmed');
        }
        return {
          data: {
            id: c.concept_id,
            label: c.name,
            conceptData: c,
          },
          classes: classes.join(' '),
        };
      }),
      ...relationships.map((rel, idx) => {
        const edgeKey = `${rel.source_concept_id}->${rel.target_concept_id}`;
        const classes: string[] = [];
        if (cycleSet.has(edgeKey)) {
          classes.push('cycle');
        } else if (hasHighlight) {
          classes.push(highlightEdgeSet.has(edgeKey) ? 'highlighted' : 'dimmed');
        }
        return {
          data: {
            id: `edge_${rel.source_concept_id}_${rel.target_concept_id}_${idx}`,
            source: rel.source_concept_id,
            target: rel.target_concept_id,
            reasoning: rel.reasoning || '',
          },
          classes: classes.join(' '),
        };
      }),
    ];

    const layoutConfig: any =
      layoutMode === 'dagre'
        ? {
            name: 'dagre',
            rankDir: 'TB',
            nodeSep: 85,
            rankSep: 100,
            padding: 40,
            animate: true,
            animationDuration: 400,
          }
        : layoutMode === 'circle'
        ? {
            name: 'circle',
            padding: 40,
            animate: true,
            animationDuration: 400,
          }
        : {
            name: 'cose',
            padding: 40,
            nodeRepulsion: 9000,
            idealEdgeLength: 110,
            animate: true,
            animationDuration: 500,
          };

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: concepts.length > 0 ? layoutConfig : { name: 'preset' },
      minZoom: 0.3,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#1e293b',
            'border-width': 3,
            'border-color': '#3b82f6',
            width: 38,
            height: 38,
            label: 'data(label)',
            color: '#e2e8f0',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 7,
            'text-wrap': 'wrap',
            'text-max-width': '115px',
            'text-background-color': '#0f172a',
            'text-background-opacity': 0.75,
            'text-background-padding': '2px',
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 200,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'background-color': '#7e22ce',
            'border-color': '#d8b4fe',
            'border-width': 4,
            color: '#ffffff',
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'background-color': '#065f46',
            'border-color': '#34d399',
            'border-width': 4,
            color: '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2.2,
            'line-color': '#3b82f6',
            'target-arrow-color': '#60a5fa',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.2,
            'curve-style': 'bezier',
            'transition-property': 'line-color, width, opacity',
            'transition-duration': 200,
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            width: 3.5,
            'line-color': '#10b981',
            'target-arrow-color': '#34d399',
          },
        },
        {
          selector: 'edge.cycle',
          style: {
            width: 3.5,
            'line-color': '#ef4444',
            'target-arrow-color': '#f87171',
            'line-style': 'dashed',
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.2,
          },
        },
      ],
    });

    // Event Listeners
    cy.on('mouseover', 'node', (evt) => {
      const concept: Concept = evt.target.data('conceptData');
      setHoveredNode(concept);
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'node', () => {
      setHoveredNode(null);
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    cy.on('mouseover', 'edge.cycle', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'edge.cycle', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    cy.on('tap', 'node', (evt) => {
      const concept: Concept = evt.target.data('conceptData');
      onSelectConcept(concept);
    });

    cy.on('tap', 'edge.cycle', (evt) => {
      const source = evt.target.data('source');
      const target = evt.target.data('target');
      if (window.confirm(`Remove cyclic feedback edge (${source} → ${target})?`)) {
        onDeleteEdge(source, target);
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onClearSelection();
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [concepts, relationships, cycleEdges, highlightedNodeIds, highlightedEdges, layoutMode]);

  const handleZoomIn = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom({
      level: Math.min(cyRef.current.zoom() * 1.25, 2.5),
      renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
    });
  };

  const handleZoomOut = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom({
      level: Math.max(cyRef.current.zoom() * 0.8, 0.3),
      renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
    });
  };

  const handleFit = () => {
    cyRef.current?.fit(undefined, 35);
  };

  return (
    <div className="relative border border-slate-700/60 rounded-xl bg-slate-900/95 overflow-hidden shadow-2xl">
      {/* Subtle Grid Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Loading Spinner Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-200 animate-pulse">
              Running Knowledge Graph Pipeline...
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Extracting slide concepts & computing vector embeddings
            </p>
          </div>
        </div>
      )}

      {/* Floating Zoom & Fit Controls */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 bg-slate-900/90 border border-slate-700/80 p-1.5 rounded-lg shadow-lg backdrop-blur">
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleFit}
          title="Fit Graph to View"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors border-t border-slate-800 pt-1.5"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Cytoscape Mount Container */}
      <div ref={containerRef} className="w-full h-[540px] z-10" />

      {/* Empty State Prompt */}
      {concepts.length === 0 && !isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-slate-500">
          <Network className="w-12 h-12 mb-2 opacity-30" />
          <p className="text-sm">Upload a lecture PDF to generate an interactive Cytoscape graph</p>
        </div>
      )}

      {/* Hover Tooltip */}
      {hoveredNode && !isLoading && (
        <div className="absolute bottom-4 left-4 right-4 z-20 bg-slate-800/95 border border-blue-500/50 p-3.5 rounded-xl shadow-xl backdrop-blur pointer-events-none">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-bold text-blue-300 text-sm">{hoveredNode.name}</h4>
            <span className="text-[10px] font-mono bg-blue-950 text-blue-400 px-2 py-0.5 rounded border border-blue-800">
              {hoveredNode.concept_id}
            </span>
          </div>
          <p className="text-xs text-slate-300 line-clamp-2">{hoveredNode.description}</p>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Main Dashboard Page Component
// ----------------------------------------------------------------------
export default function Dashboard() {
  const cyRef = useRef<Core | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [layoutMode, setLayoutMode] = useState<'dagre' | 'circle' | 'cose'>('dagre');

  // Cycle Detection States
  const [cycleCount, setCycleCount] = useState<number>(0);
  const [cycleEdges, setCycleEdges] = useState<CycleEdge[]>([]);

  // Prerequisite Learning Path States
  const [learningPath, setLearningPath] = useState<Concept[]>([]);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
  const [highlightedEdges, setHighlightedEdges] = useState<CycleEdge[]>([]);

  // Slide Viewer Modal State
  const [activeSlideNum, setActiveSlideNum] = useState<number | null>(null);

  const isLoading = status === 'extracting' || status === 'normalizing';

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      await processPDF(selectedFile);
    }
  };

  const processPDF = async (pdfFile: File) => {
    setErrorMessage(null);
    setStatus('extracting');
    clearSelection();

    const formData = new FormData();
    formData.append('file', pdfFile);

    try {
      const response = await fetch('http://localhost:8000/api/v1/extract', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to process PDF.');
      }

      setStatus('normalizing');
      const data = await response.json();

      setAnalytics(data.comparative_analytics);
      setConcepts(data.graph.concepts);
      setRelationships(data.graph.relationships);
      setCycleCount(data.topology_check?.cycle_count ?? 0);
      setCycleEdges(data.topology_check?.cycle_edges ?? []);
      setStatus('success');
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during processing.');
      setStatus('error');
    }
  };

  // Compute Upstream Prerequisite Chain on Node Click
  const computeUpstreamChain = (concept: Concept, activeRels: Relationship[]) => {
    const visited = new Set<string>([concept.concept_id]);
    const queue: string[] = [concept.concept_id];
    const chainEdges: CycleEdge[] = [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      activeRels.forEach((rel) => {
        if (rel.target_concept_id === curr) {
          chainEdges.push({ source: rel.source_concept_id, target: curr });
          if (!visited.has(rel.source_concept_id)) {
            visited.add(rel.source_concept_id);
            queue.push(rel.source_concept_id);
          }
        }
      });
    }

    const orderedIds = Array.from(visited).reverse();
    const orderedConcepts = orderedIds
      .map((id) => concepts.find((c) => c.concept_id === id))
      .filter((c): c is Concept => Boolean(c));

    setHighlightedNodeIds(visited);
    setHighlightedEdges(chainEdges);
    setLearningPath(orderedConcepts);
  };

  const handleSelectConcept = (concept: Concept) => {
    setSelectedConcept(concept);
    computeUpstreamChain(concept, relationships);
  };

  const clearSelection = () => {
    setSelectedConcept(null);
    setHighlightedNodeIds(new Set());
    setHighlightedEdges([]);
    setLearningPath([]);
  };

  // Human-in-the-Loop Unmerge Handler
  const handleUnmerge = async (canonicalId: string, synonymName: string) => {
    try {
      const res = await fetch('http://localhost:8000/api/v1/graph/unmerge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_id: canonicalId, target_synonym_name: synonymName }),
      });

      const data = await res.json();
      if (data.status === 'success' && data.unmerged_concept) {
        setConcepts((prev) => [...prev, data.unmerged_concept]);

        if (analytics) {
          const updatedClusters = analytics.merged_clusters
            .map((c) =>
              c.canonical_id === canonicalId
                ? { ...c, synonyms: c.synonyms.filter((s) => s !== synonymName) }
                : c
            )
            .filter((c) => c.synonyms.length > 0);

          setAnalytics({
            ...analytics,
            normalized_concept_count: analytics.normalized_concept_count + 1,
            concepts_reduced: Math.max(0, analytics.concepts_reduced - 1),
            merged_clusters: updatedClusters,
          });
        }
      }
    } catch (e) {
      console.error('Failed to unmerge cluster:', e);
    }
  };

  // Inject Test Cycle (>0 Cycles Demo Button)
  const injectDemoCycle = async () => {
    if (concepts.length < 2) return;
    const source = concepts[concepts.length - 1].concept_id;
    const target = concepts[0].concept_id;

    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/graph/inject-cycle?source_id=${encodeURIComponent(source)}&target_id=${encodeURIComponent(target)}`,
        { method: 'POST' }
      );
      const data = await res.json();

      setRelationships((prev) => [...prev, { source_concept_id: source, target_concept_id: target }]);
      setCycleCount(data.cycle_count ?? 1);
      setCycleEdges(data.cycle_edges || [{ source, target }]);
    } catch (e) {
      console.error('Failed to inject cycle:', e);
    }
  };

  // Human-in-the-Loop Edge Deletion Handler
  const handleDeleteEdge = async (sourceId: string, targetId: string) => {
    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/graph/edge?source_id=${encodeURIComponent(sourceId)}&target_id=${encodeURIComponent(targetId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) return;

      const data = await res.json();
      const updatedRels = relationships.filter(
        (r) => !(r.source_concept_id === sourceId && r.target_concept_id === targetId)
      );
      setRelationships(updatedRels);

      if (selectedConcept) {
        computeUpstreamChain(selectedConcept, updatedRels);
      }

      if (data.topology_check) {
        setCycleCount(data.topology_check.cycle_count ?? 0);
        setCycleEdges(data.topology_check.cycle_edges ?? []);
      }
    } catch (e) {
      console.error('Failed to delete edge:', e);
    }
  };

  // Pan & Zoom Directly to Red Cycle Edges
  const focusCycleEdges = () => {
    if (!cyRef.current) return;
    const redEdges = cyRef.current.edges('.cycle');
    if (redEdges.length > 0) {
      cyRef.current.animate({
        fit: { eles: redEdges.connectedNodes().union(redEdges), padding: 90 },
        duration: 500,
      });
    }
  };

  // Export Handlers
  const exportJSON = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify({ concepts, relationships, analytics }, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `${file?.name || 'graph'}.json`;
    a.click();
  };

  const exportCSV = () => {
    let csv = 'Type,ID,Name_Or_Source,Target\n';
    concepts.forEach((c) => (csv += `Node,${c.concept_id},"${c.name}",\n`));
    relationships.forEach((r) => (csv += `Edge,${r.source_concept_id},${r.source_concept_id},${r.target_concept_id}\n`));
    const a = document.createElement('a');
    a.href = encodeURI('data:text/csv;charset=utf-8,' + csv);
    a.download = `${file?.name || 'graph'}.csv`;
    a.click();
  };

  const exportPNG = () => {
    if (!cyRef.current) return;
    const pngDataUrl = cyRef.current.png({ full: true, scale: 2, bg: '#0f172a' });
    const a = document.createElement('a');
    a.href = pngDataUrl;
    a.download = `${file?.name || 'cytoscape_graph'}.png`;
    a.click();
  };

  const selectedRelations = relationships.filter(
    (r) =>
      r.source_concept_id === selectedConcept?.concept_id ||
      r.target_concept_id === selectedConcept?.concept_id
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Network className="text-blue-500 w-8 h-8" /> EduGraph Curation Studio
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Automated Academic Knowledge Graph Extraction, Vector Normalization & Cytoscape.js Visualizer
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportJSON}
            disabled={concepts.length === 0}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" /> JSON
          </button>
          <button
            onClick={exportCSV}
            disabled={concepts.length === 0}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> CSV
          </button>
          <button
            onClick={exportPNG}
            disabled={concepts.length === 0}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5"
          >
            <ImageIcon className="w-3.5 h-3.5 text-purple-400" /> PNG
          </button>
        </div>
      </header>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto mb-6 p-4 bg-red-950/60 border border-red-700 rounded-xl text-xs text-red-200 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Real-Time Topology Metrics Bar */}
      <div className="max-w-7xl mx-auto mb-8 grid grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-blue-400">{concepts.length}</span>
          <span className="text-xs text-slate-400">Total Canonical Nodes</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-emerald-400">{relationships.length}</span>
          <span className="text-xs text-slate-400">Prerequisite Edges</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-purple-400">
            {concepts.length > 1
              ? (relationships.length / (concepts.length * (concepts.length - 1))).toFixed(3)
              : '0.000'}
          </span>
          <span className="text-xs text-slate-400">Graph Density</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center flex flex-col items-center justify-center">
          {cycleCount === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
              <ShieldCheck className="w-4 h-4" /> 0 Cyclic Loops (DAG)
            </span>
          ) : (
            <button
              onClick={focusCycleEdges}
              title="Click to focus on red cyclic edges"
              className="flex items-center gap-1.5 text-red-400 hover:text-red-300 font-bold text-sm animate-pulse cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4 text-red-500" /> {cycleCount} Cyclic Loop(s) Detected
            </button>
          )}
          <button
            onClick={injectDemoCycle}
            disabled={concepts.length < 2}
            className="mt-1 text-[10px] text-amber-400 hover:text-amber-300 underline disabled:opacity-40"
          >
            + Inject Demo Cycle (&gt;0 Cycles)
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
            <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" /> Ingest Lecture PDF
            </h2>
            <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 transition-all rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-slate-950/40 group">
              <Upload className="w-10 h-10 text-slate-500 group-hover:text-blue-400 transition-colors mb-3" />
              <span className="text-sm font-medium text-slate-300">Upload Slide Deck</span>
              <span className="text-xs text-slate-500 mt-1">PDF slides up to 50MB</span>
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
            </label>
            {file && (
              <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono text-slate-300">
                <span className="truncate max-w-[180px]">{file.name}</span>
                <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            )}
          </div>

          {/* Disambiguation Review Panel */}
          {analytics && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg">
              <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                <Split className="w-4 h-4 text-purple-400" /> Vector Disambiguation Review
              </h2>
              {analytics.merged_clusters.length > 0 ? (
                <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                  {analytics.merged_clusters.map((cluster) => (
                    <div key={cluster.canonical_id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                      <div className="font-semibold text-purple-300 mb-1">{cluster.canonical_name}</div>
                      <div className="space-y-1.5">
                        {cluster.synonyms.map((syn) => (
                          <div
                            key={syn}
                            className="flex items-center justify-between bg-purple-950/50 p-1.5 rounded border border-purple-800/40"
                          >
                            <span className="text-purple-300 text-[11px] font-mono">{syn}</span>
                            <button
                              onClick={() => handleUnmerge(cluster.canonical_id, syn)}
                              className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-950/80 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
                            >
                              <X className="w-3 h-3" /> Unmerge
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 text-center text-xs text-slate-400">
                  <p className="text-emerald-400 font-semibold mb-1">0 False Positives Detected</p>
                  <p className="text-[11px]">
                    All extracted concepts passed similarity threshold (&gt;0.82) as distinct entities.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Prerequisite Study Path Card (Appears when a node is selected) */}
          {learningPath.length > 1 && (
            <div className="bg-slate-900/60 border border-emerald-800/50 rounded-xl p-6 shadow-lg">
              <h2 className="text-sm font-semibold text-emerald-300 mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-emerald-400" /> Prerequisite Study Sequence
              </h2>
              <p className="text-[11px] text-slate-400 mb-3">
                Recommended learning path leading to <strong className="text-slate-200">{selectedConcept?.name}</strong>:
              </p>
              <ol className="space-y-1.5 text-xs">
                {learningPath.map((step, i) => (
                  <li
                    key={step.concept_id}
                    className={`flex items-center gap-2 p-2 rounded border ${
                      step.concept_id === selectedConcept?.concept_id
                        ? 'bg-purple-950/50 border-purple-700/60 text-purple-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center text-[10px] font-mono">
                      {i + 1}
                    </span>
                    <span className="truncate">{step.name}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Right Section: Cytoscape Graph & Node Inspector Drawer */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-slate-200">Cytoscape Graph View</span>
              {highlightedNodeIds.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="ml-2 text-[11px] bg-slate-800 hover:bg-slate-700 text-amber-300 px-2 py-0.5 rounded border border-slate-700"
                >
                  Clear Highlight
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLayoutMode('dagre')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                  layoutMode === 'dagre'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Hierarchical DAG
              </button>
              <button
                onClick={() => setLayoutMode('cose')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  layoutMode === 'cose'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                Force Physics
              </button>
              <button
                onClick={() => setLayoutMode('circle')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  layoutMode === 'circle'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                Circular Ring
              </button>
            </div>
          </div>

          <CytoscapeGraphViewer
            concepts={concepts}
            relationships={relationships}
            cycleEdges={cycleEdges}
            highlightedNodeIds={highlightedNodeIds}
            highlightedEdges={highlightedEdges}
            layoutMode={layoutMode}
            isLoading={isLoading}
            onSelectConcept={handleSelectConcept}
            onClearSelection={clearSelection}
            onDeleteEdge={handleDeleteEdge}
            cyRef={cyRef}
          />

          {/* Node Inspector Drawer with Multi-Slide Links */}
          {selectedConcept && (
            <div className="bg-slate-900/90 border border-purple-500/50 rounded-xl p-6 shadow-2xl backdrop-blur space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-xl font-bold text-purple-300 flex items-center gap-2">
                    <Info className="w-5 h-5 text-purple-400" /> {selectedConcept.name}
                  </h3>
                  <span className="text-xs font-mono text-slate-400">ID: {selectedConcept.concept_id}</span>
                </div>
                <button
                  onClick={clearSelection}
                  className="text-slate-500 hover:text-slate-300 p-1 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">{selectedConcept.description}</p>

              {/* View Source Lecture Slide Buttons */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 border-t border-b border-slate-800/80 py-3">
                <FileText className="w-4 h-4 text-blue-400" />
                <span>Source Lecture Slides:</span>
                {(selectedConcept.source_slides && selectedConcept.source_slides.length > 0
                  ? selectedConcept.source_slides
                  : [1]
                ).map((slideNum) => (
                  <button
                    key={slideNum}
                    onClick={() => setActiveSlideNum(slideNum)}
                    className="bg-blue-900/70 hover:bg-blue-800 text-blue-200 border border-blue-700/60 px-3 py-1 rounded-md flex items-center gap-1.5 font-semibold transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-blue-400" /> View Slide #{slideNum}
                  </button>
                ))}
              </div>

              {/* Connected Prerequisite Dependencies */}
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-semibold text-slate-300">Connected Dependencies</h4>
                {selectedRelations.length > 0 ? (
                  selectedRelations.map((rel, i) => (
                    <div key={i} className="p-2.5 bg-slate-950 rounded border border-slate-800 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-purple-300 font-mono">
                          <span>{rel.source_concept_id}</span> <span>→</span> <span>{rel.target_concept_id}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteEdge(rel.source_concept_id, rel.target_concept_id)}
                          className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-950/80 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Remove
                        </button>
                      </div>
                      {rel.reasoning && <p className="text-slate-400 italic text-[11px]">{rel.reasoning}</p>}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No direct prerequisite edges connected to this node.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actual PDF Slide Viewer Modal */}
      {activeSlideNum !== null && file && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-400" /> Slide Preview – Page #{activeSlideNum}
              </h3>
              <button
                onClick={() => setActiveSlideNum(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-slate-950 rounded-xl border border-slate-800 p-2 flex items-center justify-center min-h-[400px]">
              <img
                src={`http://localhost:8000/api/v1/slides/${encodeURIComponent(file.name)}/${activeSlideNum}`}
                alt={`Slide ${activeSlideNum}`}
                className="max-h-[600px] w-auto rounded border border-slate-700 shadow-md object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}