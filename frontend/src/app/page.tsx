'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, CheckCircle2, AlertCircle, Loader2, Network, FileText, 
  Sparkles, Split, Download, Info, ShieldCheck, Layers, X, 
  Image as ImageIcon, FileSpreadsheet, AlertTriangle, Eye, RefreshCw
} from 'lucide-react';

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
// Draggable, Staggered, Non-Overlapping Interactive Canvas
// ----------------------------------------------------------------------
function InteractiveGraphCanvas({
  concepts,
  relationships,
  cycleEdges,
  layoutMode,
  onSelectConcept,
  canvasRef,
}: {
  concepts: Concept[];
  relationships: Relationship[];
  cycleEdges: CycleEdge[];
  layoutMode: 'circular' | 'hierarchical' | 'force';
  onSelectConcept: (c: Concept) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const [hoveredNode, setHoveredNode] = useState<Concept | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  // Initialize layout positions with staggered multi-row protection
  useEffect(() => {
    if (concepts.length === 0) return;
    const canvas = canvasRef.current;
    const width = canvas?.parentElement?.clientWidth || 800;
    const height = 540;

    const newPos: Record<string, { x: number; y: number }> = {};

    if (layoutMode === 'circular') {
      const radius = Math.min(width, height) * 0.36;
      const centerX = width / 2;
      const centerY = height / 2;
      concepts.forEach((concept, index) => {
        const angle = (index / concepts.length) * 2 * Math.PI;
        newPos[concept.concept_id] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      });
    } else if (layoutMode === 'hierarchical') {
      const layers: Record<string, number> = {};
      concepts.forEach((c) => (layers[c.concept_id] = 0));
      relationships.forEach((rel) => {
        layers[rel.target_concept_id] = (layers[rel.source_concept_id] || 0) + 1;
      });

      const maxLayer = Math.max(...Object.values(layers), 0);
      const layerGroups: Record<number, Concept[]> = {};
      concepts.forEach((c) => {
        const l = layers[c.concept_id] || 0;
        if (!layerGroups[l]) layerGroups[l] = [];
        layerGroups[l].push(c);
      });

      Object.entries(layerGroups).forEach(([layerStr, group]) => {
        const layer = parseInt(layerStr, 10);
        const baseY = 80 + (layer / (maxLayer || 1)) * (height - 180);

        group.forEach((concept, index) => {
          // Stagger Y positions for dense layers (>4 nodes) to eliminate collision
          const staggerOffset = group.length > 4 ? (index % 2 === 0 ? -28 : 28) : 0;
          const x = (width / (group.length + 1)) * (index + 1);
          newPos[concept.concept_id] = { x, y: baseY + staggerOffset };
        });
      });
    } else {
      concepts.forEach((concept, index) => {
        const row = Math.floor(index / 4);
        const col = index % 4;
        newPos[concept.concept_id] = {
          x: 140 + col * 180 + (row % 2 === 0 ? 25 : -25),
          y: 100 + row * 130,
        };
      });
    }
    setNodePositions(newPos);
  }, [concepts, relationships, layoutMode]);

  // Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || concepts.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 800;
    const height = 540;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // Background Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // Edge set for cycle matching
    const cycleEdgeSet = new Set(cycleEdges.map((e) => `${e.source}->${e.target}`));

    // Render Edges (Curved Quadratic Bezier with Red Cycle Highlighting)
    relationships.forEach((rel) => {
      const source = nodePositions[rel.source_concept_id];
      const target = nodePositions[rel.target_concept_id];
      if (!source || !target) return;

      const isCycle = cycleEdgeSet.has(`${rel.source_concept_id}->${rel.target_concept_id}`);

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);

      // Calculate control point for subtle curvature
      const midX = (source.x + target.x) / 2 + (source.y - target.y) * 0.15;
      const midY = (source.y + target.y) / 2 + (target.x - source.x) * 0.15;
      ctx.quadraticCurveTo(midX, midY, target.x, target.y);

      ctx.strokeStyle = isCycle ? '#ef4444' : '#3b82f6';
      ctx.lineWidth = isCycle ? 3.5 : 2;
      ctx.stroke();

      // Arrowhead Calculation
      const angle = Math.atan2(target.y - midY, target.x - midX);
      const headLength = isCycle ? 14 : 11;
      const nodeRadius = 24;
      const arrowX = target.x - nodeRadius * Math.cos(angle);
      const arrowY = target.y - nodeRadius * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - headLength * Math.cos(angle - Math.PI / 6),
        arrowY - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - headLength * Math.cos(angle + Math.PI / 6),
        arrowY - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = isCycle ? '#f87171' : '#60a5fa';
      ctx.fill();
    });

    // Render Concept Nodes
    concepts.forEach((concept) => {
      const pos = nodePositions[concept.concept_id];
      if (!pos) return;

      const isHovered = hoveredNode?.concept_id === concept.concept_id;
      const isSelected = selectedNodeId === concept.concept_id;

      if (isHovered || isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 32, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? 'rgba(168, 85, 247, 0.35)' : 'rgba(59, 130, 246, 0.35)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 22, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? '#7e22ce' : isHovered ? '#2563eb' : '#1e293b';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#c084fc' : isHovered ? '#60a5fa' : '#3b82f6';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Label Truncation to prevent overlapping text
      const displayName = concept.name.length > 13 ? concept.name.substring(0, 11) + '..' : concept.name;
      ctx.font = isHovered || isSelected ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.fillStyle = isHovered || isSelected ? '#ffffff' : '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.fillText(displayName, pos.x, pos.y + 38);
    });
  }, [concepts, relationships, cycleEdges, nodePositions, hoveredNode, selectedNodeId]);

  // Drag and Hover Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    concepts.forEach((c) => {
      const pos = nodePositions[c.concept_id];
      if (pos && Math.hypot(mouseX - pos.x, mouseY - pos.y) <= 24) {
        setDraggedNodeId(c.concept_id);
        setSelectedNodeId(c.concept_id);
        onSelectConcept(c);
      }
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggedNodeId) {
      setNodePositions((prev) => ({
        ...prev,
        [draggedNodeId]: { x: mouseX, y: mouseY },
      }));
      return;
    }

    let found: Concept | null = null;
    concepts.forEach((c) => {
      const pos = nodePositions[c.concept_id];
      if (pos && Math.hypot(mouseX - pos.x, mouseY - pos.y) <= 24) {
        found = c;
      }
    });
    setHoveredNode(found);
  };

  const handleMouseUp = () => setDraggedNodeId(null);

  return (
    <div className="relative border border-slate-700/60 rounded-xl bg-slate-900/90 overflow-hidden shadow-2xl">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="w-full h-[540px] cursor-grab active:cursor-grabbing"
      />
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 right-4 bg-slate-800/95 border border-blue-500/50 p-3.5 rounded-xl shadow-xl backdrop-blur">
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [layoutMode, setLayoutMode] = useState<'circular' | 'hierarchical' | 'force'>('hierarchical');
  
  // Cycle Detection States
  const [isDag, setIsDag] = useState<boolean>(true);
  const [cycleCount, setCycleCount] = useState<number>(0);
  const [cycleEdges, setCycleEdges] = useState<CycleEdge[]>([]);

  // Slide Viewer Modal State
  const [activeSlideNum, setActiveSlideNum] = useState<number | null>(null);

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

      // Topologial DAG & Cycle Check
      setIsDag(data.topology_check?.is_dag ?? true);
      setCycleCount(data.topology_check?.cycle_count ?? 0);
      setCycleEdges(data.topology_check?.cycle_edges ?? []);
      setStatus('success');
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during processing.');
      setStatus('error');
    }
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
          const updatedClusters = analytics.merged_clusters.map((c) =>
            c.canonical_id === canonicalId
              ? { ...c, synonyms: c.synonyms.filter((s) => s !== synonymName) }
              : c
          ).filter((c) => c.synonyms.length > 0);

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
      const res = await fetch(`http://localhost:8000/api/v1/graph/inject-cycle?source_id=${source}&target_id=${target}`, {
        method: 'POST',
      });
      const data = await res.json();

      // Add feedback relationship
      setRelationships((prev) => [...prev, { source_concept_id: source, target_concept_id: target }]);
      setIsDag(data.is_dag);
      setCycleCount(data.cycle_count);
      setCycleEdges(data.cycle_edges || []);
    } catch (e) {
      console.error('Failed to inject cycle:', e);
    }
  };

  const exportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ concepts, relationships, analytics }, null, 2));
    const a = document.createElement('a'); a.href = dataStr; a.download = `${file?.name || 'graph'}.json`; a.click();
  };

  const exportCSV = () => {
    let csv = 'Type,ID,Name_Or_Source,Target\n';
    concepts.forEach((c) => (csv += `Node,${c.concept_id},"${c.name}",\n`));
    relationships.forEach((r) => (csv += `Edge,${r.source_concept_id},${r.source_concept_id},${r.target_concept_id}\n`));
    const a = document.createElement('a'); a.href = encodeURI('data:text/csv;charset=utf-8,' + csv); a.download = `${file?.name || 'graph'}.csv`; a.click();
  };

  const exportPNG = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `${file?.name || 'graph'}.png`; a.click();
  };

  const selectedRelations = relationships.filter(
    (r) => r.source_concept_id === selectedConcept?.concept_id || r.target_concept_id === selectedConcept?.concept_id
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
            Automated Academic Knowledge Graph Extraction, Vector Normalization & Slide View Integration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportJSON} disabled={concepts.length === 0} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5 text-blue-400" /> JSON
          </button>
          <button onClick={exportCSV} disabled={concepts.length === 0} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> CSV
          </button>
          <button onClick={exportPNG} disabled={concepts.length === 0} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-purple-400" /> PNG
          </button>
        </div>
      </header>

      {/* Real-Time Topology Metrics Bar with Cycle Detection (>0 cycles indicator) */}
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
            {concepts.length > 1 ? (relationships.length / (concepts.length * (concepts.length - 1))).toFixed(3) : '0.000'}
          </span>
          <span className="text-xs text-slate-400">Graph Density</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center flex flex-col items-center justify-center">
          {cycleCount === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
              <ShieldCheck className="w-4 h-4" /> 0 Cyclic Loops (DAG)
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-red-400 font-bold text-sm animate-pulse">
              <AlertTriangle className="w-4 h-4 text-red-500" /> {cycleCount} Cyclic Loop(s) Detected
            </span>
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
                          <div key={syn} className="flex items-center justify-between bg-purple-950/50 p-1.5 rounded border border-purple-800/40">
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
                  <p className="text-[11px]">All extracted concepts passed similarity threshold ($&gt;0.82$) as distinct entities.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Section: Canvas & Node Inspector Drawer */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-slate-200">Knowledge Graph View</span>
              <span className="text-xs text-slate-500">(Drag nodes to reposition)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLayoutMode('hierarchical')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                  layoutMode === 'hierarchical' ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Staggered DAG
              </button>
              <button
                onClick={() => setLayoutMode('circular')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  layoutMode === 'circular' ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                Circular Ring
              </button>
            </div>
          </div>

          <InteractiveGraphCanvas
            concepts={concepts}
            relationships={relationships}
            cycleEdges={cycleEdges}
            layoutMode={layoutMode}
            onSelectConcept={setSelectedConcept}
            canvasRef={canvasRef}
          />

          {/* Node Inspector Drawer with Slide Viewer Link */}
          {selectedConcept && (
            <div className="bg-slate-900/90 border border-purple-500/50 rounded-xl p-6 shadow-2xl backdrop-blur space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-xl font-bold text-purple-300 flex items-center gap-2">
                    <Info className="w-5 h-5 text-purple-400" /> {selectedConcept.name}
                  </h3>
                  <span className="text-xs font-mono text-slate-400">ID: {selectedConcept.concept_id}</span>
                </div>
                <button onClick={() => setSelectedConcept(null)} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">{selectedConcept.description}</p>

              {/* View Actual Slide Page Button */}
              <div className="flex items-center gap-2 text-xs text-slate-400 border-t border-b border-slate-800/80 py-3">
                <FileText className="w-4 h-4 text-blue-400" />
                <span>Source Lecture Slide:</span>
                <button
                  onClick={() => setActiveSlideNum(selectedConcept.source_slides?.[0] || 1)}
                  className="bg-blue-900/70 hover:bg-blue-800 text-blue-200 border border-blue-700/60 px-3 py-1 rounded-md flex items-center gap-1.5 font-semibold transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-400" /> View Slide #{selectedConcept.source_slides?.[0] || 1}
                </button>
              </div>

              {/* Connected Prerequisite Dependencies */}
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-semibold text-slate-300">Connected Dependencies</h4>
                {selectedRelations.length > 0 ? (
                  selectedRelations.map((rel, i) => (
                    <div key={i} className="p-2.5 bg-slate-950 rounded border border-slate-800 text-xs space-y-1">
                      <div className="flex items-center gap-2 text-purple-300 font-mono">
                        <span>{rel.source_concept_id}</span> <span>→</span> <span>{rel.target_concept_id}</span>
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