/**
 * Standardized bug reporting for experiences.
 *
 * Provides a collapsible ReportBug button that captures a screenshot,
 * shows a form for an optional description, and submits the report
 * as a tool call stored in shared state.
 *
 * Bug reports appear in the MCP watch tool under `sharedState._bugReports`,
 * so agents can see and react to them.
 *
 * Usage:
 *   import { ReportBug, createBugReportTools, createBugReportHints } from "@vibevibes/sdk";
 *
 *   const tools = [...myTools, ...createBugReportTools(z)];
 *   const agentHints = [...createBugReportHints()];
 *
 *   function Canvas(props) {
 *     return <div>
 *       <ReportBug callTool={props.callTool} actorId={props.actorId} />
 *     </div>;
 *   }
 */
import type { ToolDef, ToolCtx, AgentHint } from './types';

// ── Helpers ─────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Lazy React accessor ─────────────────────────────────────────────────

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: any, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

// ── Types ───────────────────────────────────────────────────────────────

export type BugReport = {
  id: string;
  actorId: string;
  description: string;
  screenshot?: string;
  metadata?: Record<string, any>;
  ts: number;
  status: 'open' | 'resolved';
};

// ── Tool Factory ────────────────────────────────────────────────────────

export function createBugReportTools(z: any): ToolDef[] {
  return [
    {
      name: '_bug.report',
      description: 'Submit a bug report with optional screenshot and description',
      input_schema: z.object({
        description: z.string().max(2000).optional(),
        screenshot: z.string().optional().describe('Base64 PNG data URL of the current canvas state'),
        metadata: z.record(z.any()).optional().describe('Additional context (browser info, state snapshot, etc.)'),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (
        ctx: ToolCtx,
        input: { description?: string; screenshot?: string; metadata?: Record<string, any> },
      ) => {
        const report: BugReport = {
          id: uid(),
          actorId: ctx.actorId,
          description: input.description || '',
          screenshot: input.screenshot,
          metadata: input.metadata,
          ts: ctx.timestamp,
          status: 'open',
        };
        const reports = [...(ctx.state._bugReports || []), report].slice(-50);
        ctx.setState({ ...ctx.state, _bugReports: reports });
        return { reportId: report.id, totalReports: reports.length };
      },
    },
  ];
}

// ── Agent Hints ─────────────────────────────────────────────────────────

export function createBugReportHints(): AgentHint[] {
  return [
    {
      trigger: 'A new bug report was submitted',
      condition: `(state._bugReports || []).some(r => r.status === 'open')`,
      suggestedTools: [],
      priority: 'low',
      cooldownMs: 10000,
    },
  ];
}

// ── Screenshot Capture ──────────────────────────────────────────────────

async function captureScreenshot(): Promise<string | null> {
  try {
    const root = document.getElementById('root');
    if (!root) return null;

    // Fast path: single <canvas> filling #root → native toDataURL
    const canvases = root.querySelectorAll('canvas');
    if (canvases.length === 1) {
      const cvs = canvases[0] as HTMLCanvasElement;
      const rootRect = root.getBoundingClientRect();
      const cvsRect = cvs.getBoundingClientRect();
      const fillsRoot =
        Math.abs(cvsRect.width - rootRect.width) < 20 &&
        Math.abs(cvsRect.height - rootRect.height) < 20;
      if (fillsRoot) {
        return cvs.toDataURL('image/png');
      }
    }

    // Snapshot all canvases before html2canvas runs (it can't read WebGL content).
    // Requires preserveDrawingBuffer:true on WebGL canvases for toDataURL to work.
    const canvasSnapshots = new Map<HTMLCanvasElement, string>();
    canvases.forEach((cvs) => {
      try {
        const dataUrl = (cvs as HTMLCanvasElement).toDataURL('image/png');
        if (dataUrl && dataUrl.length > 100) {
          canvasSnapshots.set(cvs as HTMLCanvasElement, dataUrl);
        }
      } catch {}
    });

    // Fallback: html2canvas (loaded in the viewer via CDN)
    const html2canvas = (globalThis as any).html2canvas;
    if (typeof html2canvas === 'function') {
      const captured = await html2canvas(root, {
        backgroundColor: '#0a0a0a',
        useCORS: true,
        logging: false,
        scale: 0.5,
        onclone: (_doc: Document, clonedRoot: HTMLElement) => {
          // Replace cloned WebGL canvases with their snapshot images
          const clonedCanvases = clonedRoot.querySelectorAll('canvas');
          clonedCanvases.forEach((clonedCvs, idx) => {
            const originalCvs = canvases[idx] as HTMLCanvasElement;
            const snapshot = canvasSnapshots.get(originalCvs);
            if (snapshot) {
              const img = _doc.createElement('img');
              img.src = snapshot;
              img.style.width = clonedCvs.style.width || `${(clonedCvs as HTMLCanvasElement).width}px`;
              img.style.height = clonedCvs.style.height || `${(clonedCvs as HTMLCanvasElement).height}px`;
              img.style.display = clonedCvs.style.display;
              clonedCvs.parentNode?.replaceChild(img, clonedCvs);
            }
          });
        },
      });
      return captured.toDataURL('image/png');
    }

    return null;
  } catch {
    return null;
  }
}

// ── ReportBug Component ─────────────────────────────────────────────────

type ReportBugProps = {
  callTool: (name: string, input: any) => Promise<any>;
  actorId: string;
  style?: Record<string, any>;
};

type ReportBugState = 'idle' | 'capturing' | 'form' | 'submitted';

export function ReportBug({ callTool, actorId, style }: ReportBugProps) {
  const React = getReact();
  const [phase, setPhase] = React.useState('idle' as ReportBugState);
  const [screenshot, setScreenshot] = React.useState(null as string | null);
  const [description, setDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleOpen = React.useCallback(async () => {
    setPhase('capturing');
    const dataUrl = await captureScreenshot();
    setScreenshot(dataUrl);
    setPhase('form');
  }, []);

  const handleCancel = React.useCallback(() => {
    setPhase('idle');
    setScreenshot(null);
    setDescription('');
  }, []);

  const handleSubmit = React.useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await callTool('_bug.report', {
        description: description || undefined,
        screenshot: screenshot || undefined,
        metadata: { userAgent: navigator.userAgent },
      });
      setPhase('submitted');
      setDescription('');
      setScreenshot(null);
      setTimeout(() => setPhase('idle'), 2000);
    } catch {
      // Error handled by experience's error system
    } finally {
      setSubmitting(false);
    }
  }, [callTool, description, screenshot, submitting]);

  // ── Bug Icon Button (always visible) ───────────────────
  const bugButton = h(
    'button',
    {
      onClick: phase === 'idle' ? handleOpen : undefined,
      title: 'Report Bug',
      style: {
        position: 'fixed',
        bottom: '112px',
        right: '16px',
        zIndex: 9990,
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: phase === 'capturing' ? '#334155' : '#1e1e2e',
        border: '1px solid #334155',
        color: '#94a3b8',
        fontSize: '18px',
        cursor: phase === 'idle' ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s',
        ...style,
      },
    },
    phase === 'capturing'
      ? // Spinner
        h(
          'svg',
          {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            style: { animation: 'spin 0.8s linear infinite' },
          },
          h('circle', { cx: 12, cy: 12, r: 10, strokeDasharray: '32', strokeDashoffset: '12' }),
        )
      : phase === 'submitted'
        ? // Checkmark
          h(
            'svg',
            {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: '#22c55e',
              strokeWidth: 2.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            },
            h('polyline', { points: '20 6 9 17 4 12' }),
          )
        : // Bug icon
          h(
            'svg',
            {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            },
            // Simple bug shape: body oval + antenna + legs
            h('ellipse', { cx: 12, cy: 14, rx: 5, ry: 6 }),
            h('path', { d: 'M12 8V2' }),
            h('path', { d: 'M9 3l3 5 3-5' }),
            h('path', { d: 'M7 14H2' }),
            h('path', { d: 'M22 14h-5' }),
            h('path', { d: 'M7.5 10.5L4 8' }),
            h('path', { d: 'M16.5 10.5L20 8' }),
          ),
  );

  if (phase === 'idle' || phase === 'capturing' || phase === 'submitted') {
    return bugButton;
  }

  // ── Form Overlay (phase === 'form') ────────────────────
  return h(
    'div',
    null,
    bugButton,
    // Backdrop
    h(
      'div',
      {
        onClick: handleCancel,
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 9995,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
        },
      },
      // Form panel
      h(
        'div',
        {
          onClick: (e: any) => e.stopPropagation(),
          style: {
            background: '#1e1e2e',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            maxWidth: '400px',
            width: '90%',
            border: '1px solid #334155',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          },
        },
        // Title
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            },
          },
          h(
            'h3',
            { style: { margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#fff' } },
            'Report Bug',
          ),
          h(
            'button',
            {
              onClick: handleCancel,
              style: {
                background: 'none',
                border: 'none',
                fontSize: '1.25rem',
                cursor: 'pointer',
                color: '#94a3b8',
                padding: '4px',
              },
            },
            '\u2715',
          ),
        ),
        // Screenshot preview
        screenshot
          ? h('img', {
              src: screenshot,
              alt: 'Screenshot',
              style: {
                width: '100%',
                borderRadius: '8px',
                marginBottom: '12px',
                border: '1px solid #334155',
              },
            })
          : h(
              'div',
              {
                style: {
                  padding: '24px',
                  textAlign: 'center',
                  color: '#6b6b80',
                  fontSize: '13px',
                  border: '1px dashed #334155',
                  borderRadius: '8px',
                  marginBottom: '12px',
                },
              },
              'Screenshot unavailable',
            ),
        // Description input
        h('textarea', {
          value: description,
          onChange: (e: any) => setDescription(e.target.value),
          placeholder: "What's wrong? (optional)",
          rows: 3,
          style: {
            width: '100%',
            padding: '8px 12px',
            fontSize: '13px',
            border: '1px solid #334155',
            borderRadius: '6px',
            background: '#1e293b',
            color: '#fff',
            outline: 'none',
            resize: 'vertical' as const,
            boxSizing: 'border-box' as const,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            marginBottom: '12px',
          },
        }),
        // Action buttons
        h(
          'div',
          {
            style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
          },
          h(
            'button',
            {
              onClick: handleCancel,
              style: {
                padding: '8px 16px',
                borderRadius: '6px',
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid #334155',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
              },
            },
            'Cancel',
          ),
          h(
            'button',
            {
              onClick: handleSubmit,
              disabled: submitting,
              style: {
                padding: '8px 16px',
                borderRadius: '6px',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                fontSize: '13px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.5 : 1,
                fontWeight: 500,
              },
            },
            submitting ? 'Sending...' : 'Submit Report',
          ),
        ),
      ),
    ),
  );
}
