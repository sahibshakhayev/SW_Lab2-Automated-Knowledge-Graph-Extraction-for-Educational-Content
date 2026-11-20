'use client';

import React, { useState, useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
// @ts-ignore
import dagre from 'cytoscape-dagre';
import {
  Upload, Loader2, Network, FileText, Sparkles, Split, Download, Info,
  ShieldCheck, Layers, X, Image as ImageIcon, FileSpreadsheet,
  AlertTriangle, Eye, ZoomIn, ZoomOut, Maximize2, GitBranch,
  Plus, Pencil, Trash2, ArrowLeftRight, CheckCircle2, ClipboardCheck, Merge, BookOpen
} from 'lucide-react';

if (typeof window !== 'undefined') {
  try {
    cytoscape.use(dagre);
  } catch {
    // Already registered
  }
}

const API_BASE = 'http://localhost:8000/api/v1';

interface Course {
  id: string;
  code: string;
  title: string;
  description?: string;
  lectures?: string[];
  node_count?: number;
  edge_count?: number;
  is_verified?: boolean;
  accuracy_rating?: number;
  completeness_rating?: number;
  pedagogical_clarity_rating?: number;
  lecturer_notes?: string;
}

interface Concept {
  concept_id: string;
  name: string;
  description: string;
  domain?: string;
  source_slides?: number[];
  source_files?: string[];
}

interface Relationship {
  source_concept_id: string;
  target_concept_id: string;
  reasoning?: string;
  curated_by_lecturer?: boolean;
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
  onSelectEdge,
  onClearSelection,
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
  onSelectEdge: (r: Relationship) => void;
  onClearSelection: () => void;
  cyRef: React.MutableRefObject<Core | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Concept | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const cycleSet = new Set(cycleEdges.map((e) => `${e.source}->${e.target}`));
    const highlightEdgeSet = new Set(highlightedEdges.map((e) => `${e.source}->${e.target}`));
    const hasHighlight = highlightedNodeIds.size > 0;

    const elements: cytoscape.ElementDefinition[] = [
      ...concepts.map((c) => {
        const classes: string[] = [];
        if (hasHighlight) {
          classes.push(highlightedNodeIds.has(c.concept_id) ? 'highlighted' : 'dimmed');
        }
        return {
          data: { id: c.concept_id, label: c.name, conceptData: c },
          classes: classes.join(' '),
        };
      }),
      ...relationships.map((rel, idx) => {
        const edgeKey = `${rel.source_concept_id}->${rel.target_concept_id}`;
        const classes: string[] = [];
        if (cycleSet.has(edgeKey)) {
          classes.push('cycle');
        } else if (rel.curated_by_lecturer) {
          classes.push('curated');
        }
        if (hasHighlight && !cycleSet.has(edgeKey)) {
          classes.push(highlightEdgeSet.has(edgeKey) ? 'highlighted' : 'dimmed');
        }
        return {
          data: {
            id: `edge_${rel.source_concept_id}_${rel.target_concept_id}_${idx}`,
            source: rel.source_concept_id,
            target: rel.target_concept_id,
            relData: rel,
          },
          classes: classes.join(' '),
        };
      }),
    ];

    const layoutConfig: any =
      layoutMode === 'dagre'
        ? { name: 'dagre', rankDir: 'TB', nodeSep: 85, rankSep: 100, padding: 40, animate: true, animationDuration: 350 }
        : layoutMode === 'circle'
        ? { name: 'circle', padding: 40, animate: true, animationDuration: 350 }
        : { name: 'cose', padding: 40, nodeRepulsion: 9000, idealEdgeLength: 110, animate: true, animationDuration: 450 };

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: concepts.length > 0 ? layoutConfig : { name: 'preset' },
      minZoom: 0.25,
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
            'text-background-opacity': 0.8,
            'text-background-padding': '2px',
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
          },
        },
        {
          selector: 'edge.curated',
          style: {
            width: 2.6,
            'line-color': '#a855f7',
            'target-arrow-color': '#c084fc',
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
          style: { opacity: 0.2 },
        },
      ],
    });

    cy.on('mouseover', 'node', (evt) => {
      setHoveredNode(evt.target.data('conceptData'));
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node', () => {
      setHoveredNode(null);
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });
    cy.on('mouseover', 'edge', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'edge', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });
    cy.on('tap', 'node', (evt) => {
      onSelectConcept(evt.target.data('conceptData'));
    });
    cy.on('tap', 'edge', (evt) => {
      onSelectEdge(evt.target.data('relData'));
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) onClearSelection();
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [concepts, relationships, cycleEdges, highlightedNodeIds, highlightedEdges, layoutMode]);

  return (
    <div className="relative border border-slate-700/60 rounded-xl bg-slate-900/95 overflow-hidden shadow-2xl">
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      />

      {isLoading && (
        <div className="absolute inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
          <p className="text-sm font-semibold text-slate-200 animate-pulse">Building Course-Wide Knowledge Graph...</p>
        </div>
      )}

      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 bg-slate-900/90 border border-slate-700/80 p-1.5 rounded-lg shadow-lg">
        <button
          onClick={() => cyRef.current?.zoom({ level: Math.min((cyRef.current?.zoom() || 1) * 1.25, 2.5), renderedPosition: { x: cyRef.current!.width() / 2, y: cyRef.current!.height() / 2 } })}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => cyRef.current?.zoom({ level: Math.max((cyRef.current?.zoom() || 1) * 0.8, 0.25), renderedPosition: { x: cyRef.current!.width() / 2, y: cyRef.current!.height() / 2 } })}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => cyRef.current?.fit(undefined, 35)}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded border-t border-slate-800 pt-1.5"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <div ref={containerRef} className="w-full h-[520px] z-10" />

      {concepts.length === 0 && !isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-slate-500">
          <Network className="w-12 h-12 mb-2 opacity-30" />
          <p className="text-sm">Upload lecture PDFs or click &ldquo;+ Add Concept&rdquo; to build this course graph</p>
        </div>
      )}

      {hoveredNode && !isLoading && (
        <div className="absolute bottom-4 left-4 right-4 z-20 bg-slate-800/95 border border-blue-500/50 p-3 rounded-xl shadow-xl pointer-events-none">
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
// Main Dashboard Component
// ----------------------------------------------------------------------
export default function Dashboard() {
  const cyRef = useRef<Core | null>(null);

  // Course Management States
  const [courses, setCourses] = useState<Course[]>([]);
  const [ablationData, setAblationData] = useState<any | null>(null);
  const [activeCourseId, setActiveCourseId] = useState<string>('');
  const [courseModalMode, setCourseModalMode] = useState<'create' | 'edit' | null>(null);
  const [courseForm, setCourseForm] = useState({ code: '', title: '', description: '' });

  // Graph Data States
  const [appendMode, setAppendMode] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [layoutMode, setLayoutMode] = useState<'dagre' | 'circle' | 'cose'>('dagre');
  const [cycleCount, setCycleCount] = useState<number>(0);
  const [cycleEdges, setCycleEdges] = useState<CycleEdge[]>([]);

  // Selection & Learning Path States
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [editConceptForm, setEditConceptForm] = useState({ name: '', description: '', domain: 'General', slides: '1' });
  const [selectedEdge, setSelectedEdge] = useState<Relationship | null>(null);
  const [editEdgeReasoning, setEditEdgeReasoning] = useState<string>('');
  const [learningPath, setLearningPath] = useState<Concept[]>([]);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
  const [highlightedEdges, setHighlightedEdges] = useState<CycleEdge[]>([]);

  // Lecturer Curation Modals
  const [showAddConceptModal, setShowAddConceptModal] = useState(false);
  const [newConceptForm, setNewConceptForm] = useState({ name: '', description: '', domain: 'General', slides: '1' });

  const [showAddEdgeModal, setShowAddEdgeModal] = useState(false);
  const [newEdgeForm, setNewEdgeForm] = useState({ source_id: '', target_id: '', reasoning: '' });

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeForm, setMergeForm] = useState({ source_id: '', target_id: '' });

  // Lecturer Evaluation & Gold-Standard Modal
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [evalReport, setEvalReport] = useState<any | null>(null);
  const [evalForm, setEvalForm] = useState({
    is_verified: false,
    accuracy_rating: 5,
    completeness_rating: 5,
    pedagogical_clarity_rating: 5,
    lecturer_notes: '',
  });

  // Slide Viewer Modal
  const [slidePreview, setSlidePreview] = useState<{ filename: string; page: number } | null>(null);

  const activeCourse = courses.find((c) => c.id === activeCourseId) || null;

  // Load courses on initial mount
  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async (selectId?: string) => {
    try {
      const res = await fetch(`${API_BASE}/courses`);
      const data = await res.json();
      const list: Course[] = data.courses || [];
      setCourses(list);
      const targetId = selectId || activeCourseId || (list[0]?.id ?? '');
      if (targetId) {
        setActiveCourseId(targetId);
        await loadCourseGraph(targetId);
      }
    } catch {
      setErrorMessage('Failed to load courses from backend.');
    }
  };

  const loadCourseGraph = async (courseId: string) => {
    if (!courseId) return;
    clearSelection();
    try {
      const res = await fetch(`${API_BASE}/courses/${courseId}/graph`);
      if (!res.ok) return;
      const data = await res.json();
      setConcepts(data.concepts || []);
      setRelationships(data.relationships || []);
      setCycleCount(data.topology_check?.cycle_count ?? 0);
      setCycleEdges(data.topology_check?.cycle_edges ?? []);
      setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...data.course } : c)));
    } catch {
      setErrorMessage('Failed to load course graph.');
    }
  };

  // ------------------------------------------------------------------
  // Course CRUD Actions
  // ------------------------------------------------------------------
  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (courseModalMode === 'create') {
        const res = await fetch(`${API_BASE}/courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(courseForm),
        });
        const data = await res.json();
        setCourseModalMode(null);
        await fetchCourses(data.course.id);
      } else if (courseModalMode === 'edit' && activeCourseId) {
        await fetch(`${API_BASE}/courses/${activeCourseId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(courseForm),
        });
        setCourseModalMode(null);
        await fetchCourses(activeCourseId);
      }
    } catch {
      setErrorMessage('Failed to save course.');
    }
  };

  const handleDeleteCourse = async () => {
    if (!activeCourse) return;
    if (!window.confirm(`Permanently delete "${activeCourse.code} - ${activeCourse.title}" and its entire Knowledge Graph?`)) {
      return;
    }
    try {
      await fetch(`${API_BASE}/courses/${activeCourse.id}`, { method: 'DELETE' });
      setActiveCourseId('');
      await fetchCourses();
    } catch {
      setErrorMessage('Failed to delete course.');
    }
  };

  // ------------------------------------------------------------------
  // Course-Wide PDF Ingestion
  // ------------------------------------------------------------------
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeCourseId) return;
    const pdfFile = e.target.files[0];
    e.target.value = '';

    setErrorMessage(null);
    setIsLoading(true);
    clearSelection();

    const formData = new FormData();
    formData.append('file', pdfFile);
    formData.append('append_mode', String(appendMode));

    try {
      const res = await fetch(`${API_BASE}/courses/${activeCourseId}/extract`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Extraction failed.');
      }
      const data = await res.json();
      setAnalytics(data.comparative_analytics);
      setConcepts(data.graph.concepts || []);
      setRelationships(data.graph.relationships || []);
      setCycleCount(data.topology_check?.cycle_count ?? 0);
      setCycleEdges(data.topology_check?.cycle_edges ?? []);
      await fetchCourses(activeCourseId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error extracting lecture PDF.');
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Selection & Topological Study Path
  // ------------------------------------------------------------------
  const computeUpstreamChain = (concept: Concept, activeRels: Relationship[], activeConcepts: Concept[]) => {
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

    const ordered = Array.from(visited)
      .reverse()
      .map((id) => activeConcepts.find((c) => c.concept_id === id))
      .filter((c): c is Concept => Boolean(c));

    setHighlightedNodeIds(visited);
    setHighlightedEdges(chainEdges);
    setLearningPath(ordered);
  };

  const handleSelectConcept = (concept: Concept) => {
    setSelectedEdge(null);
    setSelectedConcept(concept);
    setEditConceptForm({
      name: concept.name,
      description: concept.description || '',
      domain: concept.domain || 'General',
      slides: (concept.source_slides || [1]).join(', '),
    });
    computeUpstreamChain(concept, relationships, concepts);
  };

  const handleSelectEdge = (rel: Relationship) => {
    setSelectedConcept(null);
    setHighlightedNodeIds(new Set([rel.source_concept_id, rel.target_concept_id]));
    setHighlightedEdges([{ source: rel.source_concept_id, target: rel.target_concept_id }]);
    setSelectedEdge(rel);
    setEditEdgeReasoning(rel.reasoning || '');
  };

  const clearSelection = () => {
    setSelectedConcept(null);
    setSelectedEdge(null);
    setHighlightedNodeIds(new Set());
    setHighlightedEdges([]);
    setLearningPath([]);
  };

  // ------------------------------------------------------------------
  // Lecturer Curation Actions (Add/Edit/Delete/Merge Nodes & Edges)
  // ------------------------------------------------------------------
  const handleCreateConcept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourseId) return;
    const slides = newConceptForm.slides
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    await fetch(`${API_BASE}/courses/${activeCourseId}/concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newConceptForm.name,
        description: newConceptForm.description,
        domain: newConceptForm.domain,
        source_slides: slides.length ? slides : [1],
      }),
    });
    setShowAddConceptModal(false);
    setNewConceptForm({ name: '', description: '', domain: 'General', slides: '1' });
    await loadCourseGraph(activeCourseId);
  };

  const handleUpdateConcept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourseId || !selectedConcept) return;
    const slides = editConceptForm.slides
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    await fetch(`${API_BASE}/courses/${activeCourseId}/concepts/${encodeURIComponent(selectedConcept.concept_id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editConceptForm.name,
        description: editConceptForm.description,
        domain: editConceptForm.domain,
        source_slides: slides.length ? slides : [1],
      }),
    });
    await loadCourseGraph(activeCourseId);
  };

  const handleDeleteConcept = async (conceptId: string) => {
    if (!activeCourseId) return;
    if (!window.confirm(`Delete concept "${conceptId}" and all its prerequisite links?`)) return;
    await fetch(`${API_BASE}/courses/${activeCourseId}/concepts/${encodeURIComponent(conceptId)}`, {
      method: 'DELETE',
    });
    await loadCourseGraph(activeCourseId);
  };

  const handleMergeConcepts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourseId || !mergeForm.source_id || !mergeForm.target_id) return;
    const res = await fetch(`${API_BASE}/courses/${activeCourseId}/concepts/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_concept_id: mergeForm.source_id,
        target_concept_id: mergeForm.target_id,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      setErrorMessage(err.detail || 'Merge failed.');
      return;
    }
    setShowMergeModal(false);
    await loadCourseGraph(activeCourseId);
  };

  const handleCreateEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourseId || !newEdgeForm.source_id || !newEdgeForm.target_id) return;
    const res = await fetch(`${API_BASE}/courses/${activeCourseId}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_concept_id: newEdgeForm.source_id,
        target_concept_id: newEdgeForm.target_id,
        reasoning: newEdgeForm.reasoning || 'Added manually by lecturer.',
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      setErrorMessage(err.detail || 'Failed to add edge.');
      return;
    }
    setShowAddEdgeModal(false);
    setNewEdgeForm({ source_id: '', target_id: '', reasoning: '' });
    await loadCourseGraph(activeCourseId);
  };

  const handleUpdateEdge = async (reverseDirection: boolean) => {
    if (!activeCourseId || !selectedEdge) return;
    await fetch(`${API_BASE}/courses/${activeCourseId}/edges`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_concept_id: selectedEdge.source_concept_id,
        target_concept_id: selectedEdge.target_concept_id,
        reasoning: editEdgeReasoning,
        reverse_direction: reverseDirection,
      }),
    });
    await loadCourseGraph(activeCourseId);
  };

  const handleDeleteEdge = async (sourceId: string, targetId: string) => {
    if (!activeCourseId) return;
    await fetch(
      `${API_BASE}/courses/${activeCourseId}/edges?source_id=${encodeURIComponent(sourceId)}&target_id=${encodeURIComponent(targetId)}`,
      { method: 'DELETE' }
    );
    await loadCourseGraph(activeCourseId);
  };

  // ------------------------------------------------------------------
  // Lecturer Evaluation & Gold-Standard Sign-Off
  // ------------------------------------------------------------------
const openEvaluationModal = async () => {
    if (!activeCourseId) return;
    const [evalRes, ablRes] = await Promise.all([
      fetch(`${API_BASE}/courses/${activeCourseId}/evaluation`),
      fetch(`${API_BASE}/courses/${activeCourseId}/evaluation/ablation`),
    ]);
    if (evalRes.ok) {
      const data = await evalRes.json();
      setEvalReport(data);
      setEvalForm({
        is_verified: data.is_verified,
        accuracy_rating: data.lecturer_rubric.accuracy_rating,
        completeness_rating: data.lecturer_rubric.completeness_rating,
        pedagogical_clarity_rating: data.lecturer_rubric.pedagogical_clarity_rating,
        lecturer_notes: data.lecturer_rubric.lecturer_notes || '',
      });
    }
    if (ablRes.ok) {
      setAblationData(await ablRes.json());
    }
    setShowEvalModal(true);
  };

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourseId) return;
    const res = await fetch(`${API_BASE}/courses/${activeCourseId}/evaluation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evalForm),
    });
    if (res.ok) {
      const data = await res.json();
      setEvalReport(data.evaluation);
      await fetchCourses(activeCourseId);
    }
  };

  const exportEvaluationJSON = () => {
    if (!evalReport) return;
    const payload = { evaluation_summary: evalReport, gold_standard_graph: { concepts, relationships } };
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    a.download = `${activeCourse?.code || 'course'}_evaluation_report.json`;
    a.click();
  };

  const exportPNG = () => {
    if (!cyRef.current) return;
    const a = document.createElement('a');
    a.href = cyRef.current.png({ full: true, scale: 2, bg: '#0f172a' });
    a.download = `${activeCourse?.code || 'course'}_knowledge_graph.png`;
    a.click();
  };

  const exportCSV = () => {
    let csv = 'Type,ID,Name_Or_Source,Target,CuratedByLecturer\n';
    concepts.forEach((c) => (csv += `Node,${c.concept_id},"${c.name}",,\n`));
    relationships.forEach(
      (r) => (csv += `Edge,${r.source_concept_id}->${r.target_concept_id},${r.source_concept_id},${r.target_concept_id},${Boolean(r.curated_by_lecturer)}\n`)
    );
    const a = document.createElement('a');
    a.href = encodeURI('data:text/csv;charset=utf-8,' + csv);
    a.download = `${activeCourse?.code || 'course'}_graph.csv`;
    a.click();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-8">
      {/* Header & Multi-Course Selector Bar */}
      <header className="max-w-7xl mx-auto mb-6 border-b border-slate-800 pb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
              <Network className="text-blue-500 w-8 h-8" /> EduGraph Course Curation Studio
            </h1>
            <p className="text-slate-400 text-xs md:text-sm mt-1">
              Multi-Course Knowledge Graph Builder, Lecturer Curation &amp; Gold-Standard Evaluation
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openEvaluationModal}
              disabled={!activeCourseId}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow"
            >
              <ClipboardCheck className="w-4 h-4" /> Lecturer Evaluation &amp; Sign-Off
            </button>
            <button
              onClick={exportCSV}
              disabled={concepts.length === 0}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> CSV
            </button>
            <button
              onClick={exportPNG}
              disabled={concepts.length === 0}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 flex items-center gap-1.5"
            >
              <ImageIcon className="w-3.5 h-3.5 text-purple-400" /> PNG
            </button>
          </div>
        </div>

        {/* Course Switcher & CRUD Bar */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-blue-400" /> Active Course:
            </span>
            <select
              value={activeCourseId}
              onChange={(e) => {
                setActiveCourseId(e.target.value);
                loadCourseGraph(e.target.value);
              }}
              className="bg-slate-950 border border-slate-700 text-slate-100 text-xs md:text-sm rounded-lg px-3 py-2 min-w-[260px] focus:border-blue-500 outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title} ({c.node_count ?? 0} nodes) {c.is_verified ? '✓ Verified' : ''}
                </option>
              ))}
            </select>

            {activeCourse?.is_verified && (
              <span className="bg-emerald-950/90 text-emerald-300 border border-emerald-700/70 text-xs px-2.5 py-1 rounded-full flex items-center gap-1 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> 100% Lecturer Verified
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCourseForm({ code: '', title: '', description: '' });
                setCourseModalMode('create');
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> New Course
            </button>
            <button
              onClick={() => {
                if (!activeCourse) return;
                setCourseForm({
                  code: activeCourse.code,
                  title: activeCourse.title,
                  description: activeCourse.description || '',
                });
                setCourseModalMode('edit');
              }}
              disabled={!activeCourse}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1"
            >
              <Pencil className="w-3.5 h-3.5 text-amber-400" /> Edit Course
            </button>
            <button
              onClick={handleDeleteCourse}
              disabled={!activeCourse}
              className="bg-slate-800 hover:bg-red-950/80 text-red-400 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </div>
      </header>

      {/* Error Alert */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto mb-6 p-3.5 bg-red-950/70 border border-red-700 rounded-xl text-xs text-red-200 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metrics Bar */}
      <div className="max-w-7xl mx-auto mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-blue-400">{concepts.length}</span>
          <span className="text-xs text-slate-400">Course Concepts</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-emerald-400">{relationships.length}</span>
          <span className="text-xs text-slate-400">Prerequisite Links</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
          <span className="block text-2xl font-bold text-purple-400">{activeCourse?.lectures?.length ?? 0}</span>
          <span className="text-xs text-slate-400">Merged Lecture Decks</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center flex flex-col items-center justify-center">
          {cycleCount === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
              <ShieldCheck className="w-4 h-4" /> Valid DAG (0 Cycles)
            </span>
          ) : (
            <button
              onClick={() => {
                const redEdges = cyRef.current?.edges('.cycle');
                if (redEdges && redEdges.length > 0) {
                  cyRef.current?.animate({ fit: { eles: redEdges.connectedNodes().union(redEdges), padding: 90 }, duration: 450 });
                }
              }}
              className="flex items-center gap-1.5 text-red-400 font-bold text-sm animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 text-red-500" /> {cycleCount} Cycle(s) — Click to Focus
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          {/* Course-Wide PDF Ingestion */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" /> Course-Wide Lecture Ingestion
            </h2>

            <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 transition-all rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer bg-slate-950/40 group">
              <Upload className="w-8 h-8 text-slate-500 group-hover:text-blue-400 mb-2" />
              <span className="text-xs font-medium text-slate-300">Upload Lecture PDF to Course</span>
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
            </label>

            <label className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={appendMode}
                onChange={(e) => setAppendMode(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 block">Merge into Course Graph (append_mode)</span>
                <span className="text-[11px] text-slate-400">
                  {appendMode
                    ? 'Links incoming slides with existing concepts across all lectures in this course.'
                    : 'Clears this course graph first before extracting the uploaded PDF.'}
                </span>
              </div>
            </label>

            {activeCourse?.lectures && activeCourse.lectures.length > 0 && (
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-1">
                <span className="text-slate-400 font-semibold block">Ingested Lectures ({activeCourse.lectures.length}):</span>
                <ul className="text-[11px] text-blue-300 font-mono space-y-0.5 max-h-24 overflow-y-auto">
                  {activeCourse.lectures.map((lec) => (
                    <li key={lec} className="truncate">• {lec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Lecturer Graph Control Toolbar */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" /> Lecturer Graph Controls
            </h2>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => setShowAddConceptModal(true)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium py-2.5 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4 text-blue-400" /> Add Missing Concept Node
              </button>
              <button
                onClick={() => {
                  setNewEdgeForm({
                    source_id: concepts[0]?.concept_id || '',
                    target_id: concepts[1]?.concept_id || '',
                    reasoning: '',
                  });
                  setShowAddEdgeModal(true);
                }}
                disabled={concepts.length < 2}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-xs font-medium py-2.5 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4 text-emerald-400" /> Add Prerequisite Link
              </button>
              <button
                onClick={() => {
                  setMergeForm({
                    source_id: concepts[0]?.concept_id || '',
                    target_id: concepts[1]?.concept_id || '',
                  });
                  setShowMergeModal(true);
                }}
                disabled={concepts.length < 2}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-xs font-medium py-2.5 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-2"
              >
                <Merge className="w-4 h-4 text-purple-400" /> Merge Duplicate Concepts
              </button>
            </div>
          </div>

          {/* Learning Path Preview */}
          {learningPath.length > 1 && (
            <div className="bg-slate-900/60 border border-emerald-800/50 rounded-xl p-5 shadow-lg">
              <h2 className="text-sm font-semibold text-emerald-300 mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-emerald-400" /> Student Prerequisite Sequence
              </h2>
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

        {/* Right Canvas & Inspector */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>Click any <strong>Node</strong> or <strong>Edge</strong> on the graph to edit, reverse, or delete.</span>
              {highlightedNodeIds.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="bg-slate-800 hover:bg-slate-700 text-amber-300 px-2 py-0.5 rounded border border-slate-700"
                >
                  Clear Selection
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(['dagre', 'cose', 'circle'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setLayoutMode(mode)}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    layoutMode === mode
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {mode === 'dagre' ? 'Hierarchical DAG' : mode === 'cose' ? 'Force Physics' : 'Circular'}
                </button>
              ))}
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
            onSelectEdge={handleSelectEdge}
            onClearSelection={clearSelection}
            cyRef={cyRef}
          />

          {/* Selected Node Editor Drawer */}
          {selectedConcept && (
            <form
              onSubmit={handleUpdateConcept}
              className="bg-slate-900/95 border border-purple-500/50 rounded-xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-purple-300 flex items-center gap-2">
                    <Info className="w-4 h-4" /> Edit Concept Node ({selectedConcept.concept_id})
                  </h3>
                  {selectedConcept.source_files && selectedConcept.source_files.length > 0 && (
                    <span className="text-[11px] text-slate-400">
                      Lectures: {selectedConcept.source_files.join(', ')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteConcept(selectedConcept.concept_id)}
                    className="bg-red-950 hover:bg-red-900 text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-800 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Node
                  </button>
                  <button type="button" onClick={clearSelection} className="text-slate-400 hover:text-white p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Concept Title</label>
                  <input
                    type="text"
                    required
                    value={editConceptForm.name}
                    onChange={(e) => setEditConceptForm({ ...editConceptForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Source Slide Numbers (comma-separated)</label>
                  <input
                    type="text"
                    value={editConceptForm.slides}
                    onChange={(e) => setEditConceptForm({ ...editConceptForm, slides: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div className="text-xs">
                <label className="block text-slate-400 mb-1">Academic Definition / Description</label>
                <textarea
                  rows={2}
                  value={editConceptForm.description}
                  onChange={(e) => setEditConceptForm({ ...editConceptForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>

              {/* Slide Preview Buttons */}
              {selectedConcept.source_files?.[0] && selectedConcept.source_files[0].endsWith('.pdf') && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pt-1">
                  <span>Inspect Source Slide:</span>
                  {(selectedConcept.source_slides || [1]).map((num) => (
                    <button
                      type="button"
                      key={num}
                      onClick={() => setSlidePreview({ filename: selectedConcept.source_files![0], page: num })}
                      className="bg-blue-950 hover:bg-blue-900 text-blue-300 border border-blue-800 px-2.5 py-1 rounded flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" /> Slide #{num}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-lg"
                >
                  Save Concept Changes
                </button>
              </div>
            </form>
          )}

          {/* Selected Edge Editor Drawer */}
          {selectedEdge && (
            <div className="bg-slate-900/95 border border-blue-500/50 rounded-xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-blue-300 font-mono">
                  Prerequisite Edge: {selectedEdge.source_concept_id} → {selectedEdge.target_concept_id}
                </h3>
                <button onClick={clearSelection} className="text-slate-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="text-xs">
                <label className="block text-slate-400 mb-1">Pedagogical Reasoning</label>
                <textarea
                  rows={2}
                  value={editEdgeReasoning}
                  onChange={(e) => setEditEdgeReasoning(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleDeleteEdge(selectedEdge.source_concept_id, selectedEdge.target_concept_id)}
                  className="bg-red-950 hover:bg-red-900 text-red-300 text-xs px-3 py-2 rounded-lg border border-red-800 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Edge
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateEdge(true)}
                    className="bg-amber-950 hover:bg-amber-900 text-amber-200 text-xs px-3 py-2 rounded-lg border border-amber-700 flex items-center gap-1.5"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Reverse Direction
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateEdge(false)}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg"
                  >
                    Save Edge
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Course Modal */}
      {courseModalMode && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleSaveCourse} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">
              {courseModalMode === 'create' ? 'Create New Course Graph' : 'Edit Course Metadata'}
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Course Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., IP-18cAI"
                  value={courseForm.code}
                  onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Course Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Artificial Intelligence"
                  value={courseForm.title}
                  onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={courseForm.description}
                  onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCourseModalMode(null)} className="px-4 py-2 text-xs text-slate-400">
                Cancel
              </button>
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                Save Course
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Concept Modal */}
      {showAddConceptModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleCreateConcept} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Add Missing Concept Node</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Concept Name</label>
                <input
                  type="text"
                  required
                  value={newConceptForm.name}
                  onChange={(e) => setNewConceptForm({ ...newConceptForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Definition / Notes</label>
                <textarea
                  rows={2}
                  value={newConceptForm.description}
                  onChange={(e) => setNewConceptForm({ ...newConceptForm, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Slide Numbers (comma-separated)</label>
                <input
                  type="text"
                  value={newConceptForm.slides}
                  onChange={(e) => setNewConceptForm({ ...newConceptForm, slides: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddConceptModal(false)} className="px-4 py-2 text-xs text-slate-400">
                Cancel
              </button>
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                Create Concept
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Edge Modal */}
      {showAddEdgeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleCreateEdge} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Add Prerequisite Edge</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Prerequisite Concept (Must learn first)</label>
                <select
                  value={newEdgeForm.source_id}
                  onChange={(e) => setNewEdgeForm({ ...newEdgeForm, source_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                >
                  {concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Target Concept (Unlocked next)</label>
                <select
                  value={newEdgeForm.target_id}
                  onChange={(e) => setNewEdgeForm({ ...newEdgeForm, target_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                >
                  {concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Pedagogical Reasoning</label>
                <textarea
                  rows={2}
                  value={newEdgeForm.reasoning}
                  onChange={(e) => setNewEdgeForm({ ...newEdgeForm, reasoning: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddEdgeModal(false)} className="px-4 py-2 text-xs text-slate-400">
                Cancel
              </button>
              <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                Create Edge
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Merge Duplicate Concepts Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleMergeConcepts} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Merge Duplicate Concepts</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Duplicate Node (Will be merged &amp; removed)</label>
                <select
                  value={mergeForm.source_id}
                  onChange={(e) => setMergeForm({ ...mergeForm, source_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                >
                  {concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>{c.name} ({c.concept_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Canonical Node (Will retain all edges &amp; slides)</label>
                <select
                  value={mergeForm.target_id}
                  onChange={(e) => setMergeForm({ ...mergeForm, target_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                >
                  {concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>{c.name} ({c.concept_id})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowMergeModal(false)} className="px-4 py-2 text-xs text-slate-400">
                Cancel
              </button>
              <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                Merge Nodes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lecturer Evaluation & Gold-Standard Verification Modal */}
      {showEvalModal && evalReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-emerald-400" /> Lecturer Evaluation &amp; Gold-Standard Sign-Off
              </h3>
              <button onClick={() => setShowEvalModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Automated vs. Curated Comparison Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="block text-lg font-bold text-blue-400">
                  {evalReport.baseline_vs_curated.auto_normalized_nodes} → {evalReport.baseline_vs_curated.final_curated_nodes}
                </span>
                <span className="text-slate-400">Auto → Curated Nodes</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="block text-lg font-bold text-emerald-400">
                  {evalReport.baseline_vs_curated.auto_normalized_edges} → {evalReport.baseline_vs_curated.final_curated_edges}
                </span>
                <span className="text-slate-400">Auto → Curated Edges</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="block text-lg font-bold text-purple-400">
                  {evalReport.baseline_vs_curated.manual_edits_count}
                </span>
                <span className="text-slate-400">Lecturer Edits</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="block text-lg font-bold text-amber-400">
                  {evalReport.baseline_vs_curated.pipeline_alignment_pct}%
                </span>
                <span className="text-slate-400">Pipeline Alignment</span>
              </div>
            </div>


            {ablationData && (
  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-slate-200">
        Quantitative Ablation vs. Lecturer Gold Standard
      </span>
      <a
        href={`${API_BASE}/evaluation/cross-course-csv`}
        download="cross_course_ablation_benchmark.csv"
        className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
      >
        <Download className="w-3.5 h-3.5" /> Export All Courses CSV
      </a>
    </div>
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b border-slate-800 text-slate-400">
          <th className="py-1.5">Pipeline Stage</th>
          <th className="py-1.5">Concept P / R / F1</th>
          <th className="py-1.5">Edge P / R / F1</th>
          <th className="py-1.5">Edit Dist. (GED)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800/70 font-mono text-[11px]">
        <tr>
          <td className="py-2 font-sans text-slate-300">Stage 1: Raw LLM Output</td>
          <td className="py-2 text-amber-300">
            {ablationData.stage1_raw_vs_gold.concepts.precision}% / {ablationData.stage1_raw_vs_gold.concepts.recall}% /{' '}
            <strong>{ablationData.stage1_raw_vs_gold.concepts.f1}%</strong>
          </td>
          <td className="py-2 text-amber-300">
            {ablationData.stage1_raw_vs_gold.edges.precision}% / {ablationData.stage1_raw_vs_gold.edges.recall}% /{' '}
            <strong>{ablationData.stage1_raw_vs_gold.edges.f1}%</strong>
          </td>
          <td className="py-2 text-red-400">{ablationData.stage1_raw_vs_gold.graph_edit_distance}</td>
        </tr>
        <tr>
          <td className="py-2 font-sans text-slate-200">Stage 2: Auto-Normalized DAG</td>
          <td className="py-2 text-emerald-300">
            {ablationData.stage2_normalized_vs_gold.concepts.precision}% / {ablationData.stage2_normalized_vs_gold.concepts.recall}% /{' '}
            <strong>{ablationData.stage2_normalized_vs_gold.concepts.f1}%</strong>
          </td>
          <td className="py-2 text-emerald-300">
            {ablationData.stage2_normalized_vs_gold.edges.precision}% / {ablationData.stage2_normalized_vs_gold.edges.recall}% /{' '}
            <strong>{ablationData.stage2_normalized_vs_gold.edges.f1}%</strong>
          </td>
          <td className="py-2 text-blue-300">{ablationData.stage2_normalized_vs_gold.graph_edit_distance}</td>
        </tr>
      </tbody>
    </table>
  </div>
)}

            {/* Lecturer Rubric Form */}
            <form onSubmit={handleSaveEvaluation} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { key: 'accuracy_rating', label: 'Prerequisite Accuracy (1–5)' },
                  { key: 'completeness_rating', label: 'Concept Completeness (1–5)' },
                  { key: 'pedagogical_clarity_rating', label: 'Pedagogical Clarity (1–5)' },
                ].map((item) => (
                  <div key={item.key} className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <label className="block text-slate-400 mb-1">{item.label}</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={(evalForm as any)[item.key]}
                      onChange={(e) => setEvalForm({ ...evalForm, [item.key]: parseInt(e.target.value, 10) || 5 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Lecturer Evaluation Notes</label>
                <textarea
                  rows={2}
                  placeholder="Document any manual corrections, missing prerequisites added, or evaluation observations..."
                  value={evalForm.lecturer_notes}
                  onChange={(e) => setEvalForm({ ...evalForm, lecturer_notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>

              <label className="p-3.5 bg-emerald-950/30 border border-emerald-700/60 rounded-xl flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={evalForm.is_verified}
                  onChange={(e) => setEvalForm({ ...evalForm, is_verified: e.target.checked })}
                  className="rounded border-emerald-700 bg-slate-900 text-emerald-500 w-4 h-4"
                />
                <div>
                  <span className="font-bold text-emerald-300 block">
                    Sign Off &amp; Certify Course Knowledge Graph as 100% Verified (Gold Standard)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Marks this course graph ready for student learning path generation and Moodle LTI export.
                  </span>
                </div>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={exportEvaluationJSON}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg border border-slate-700 flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4 text-blue-400" /> Export Evaluation Study JSON
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2 rounded-lg"
                >
                  Save Evaluation &amp; Status
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide Image Viewer Modal */}
      {slidePreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {slidePreview.filename} — Slide #{slidePreview.page}
              </h3>
              <button onClick={() => setSlidePreview(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-2 flex items-center justify-center min-h-[380px]">
              <img
                src={`${API_BASE}/slides/${encodeURIComponent(slidePreview.filename)}/${slidePreview.page}`}
                alt={`Slide ${slidePreview.page}`}
                className="max-h-[580px] w-auto rounded border border-slate-700 object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}