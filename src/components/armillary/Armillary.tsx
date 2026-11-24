'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArmillaryBody, ArmillaryHandle, ArmillaryOptions } from '@/lib/armillary/scene';

export type { ArmillaryBody };

/** On unless NEXT_PUBLIC_FEATURE_ARMILLARY is set to "false". */
export const ARMILLARY_ENABLED = process.env.NEXT_PUBLIC_FEATURE_ARMILLARY !== 'false';

const MODEL_URL = '/armillary.json';
const POSTER_URL = '/armillary-poster.jpg';
const LABEL_CSS = `
.armillary-label { position: absolute; left: 0; top: 0; font: 500 10.5px/1 ui-monospace, "SFMono-Regular", Menlo, monospace;
  letter-spacing: .08em; text-transform: uppercase; color: #EDEBE4; text-shadow: 0 1px 6px #000; white-space: nowrap;
  opacity: .82; pointer-events: none; }
.armillary-label.sel { opacity: 1; color: #C9A84C; }
[data-labels="selected"] .armillary-label:not(.sel) { opacity: 0; }
@media (max-width: 560px) { .armillary-label { opacity: 0; } .armillary-label.sel { opacity: 1; } }
`;

interface ArmillaryProps {
  bodies: ArmillaryBody[];
  /** Background art (the login page): hidden from screen readers, no labels, no input. */
  decorative?: boolean;
  /** What a screen reader hears when it isn't decorative. */
  label?: string;
  /** Orb labels: all of them, or only the selected orb's (for small frames). */
  showLabels?: 'all' | 'selected';
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  latitude?: number;
  zoom?: number;
  shift?: ArmillaryOptions['shift'];
  lift?: ArmillaryOptions['lift'];
  style?: React.CSSProperties;
}

/**
 * The 3D armillary. Shows its still poster until the scene is ready, and keeps
 * the poster when WebGL is unavailable. three.js is loaded only when this mounts.
 */
export function Armillary({
  bodies, decorative, label, showLabels, selectedId = null, onSelect, latitude, zoom, shift, lift, style,
}: ArmillaryProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ArmillaryHandle | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ bodies, selectedId });
  latest.current = { bodies, selectedId };
  const [state, setState] = useState<'loading' | 'live' | 'poster'>('loading');

  // build once; bodies and selection are pushed in by the effects below
  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    let cancelled = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Wait a frame: React's dev double-mount unmounts the first copy synchronously,
    // so only one scene ever claims the canvas's WebGL context.
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      import('@/lib/armillary/scene')
        .then(m => m.createArmillary({
          host, canvas, labels: !decorative && showLabels ? labelsRef.current : null, modelUrl: MODEL_URL,
          bodies: latest.current.bodies, latitude, zoom, shift, lift, reducedMotion, interactive: !decorative,
          onSelect: decorative ? undefined : (id => onSelectRef.current?.(id)),
        }))
        .then(handle => {
          if (cancelled) { handle?.dispose(); return; }
          if (!handle) { setState('poster'); return; }
          handleRef.current = handle;
          handle.setBodies(latest.current.bodies);
          handle.select(latest.current.selectedId);
          setState('live');
        })
        .catch(() => { if (!cancelled) setState('poster'); });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // options are fixed for the life of the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { handleRef.current?.setBodies(bodies); }, [bodies]);
  useEffect(() => { handleRef.current?.select(selectedId); }, [selectedId]);

  return (
    <div
      ref={hostRef}
      data-testid="armillary"
      data-state={state}
      data-orbs={bodies.length}
      data-selected={selectedId ?? ''}
      data-labels={showLabels}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      style={{ position: 'relative', overflow: 'hidden', background: '#06070d', isolation: 'isolate', ...style }}
    >
      {/* Raw, not a text child: the server escapes quotes in text, which would break hydration. */}
      <style dangerouslySetInnerHTML={{ __html: LABEL_CSS }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed background still, not content */}
      <img
        src={POSTER_URL}
        alt=""
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          opacity: state === 'live' ? 0 : 1, transition: 'opacity 1.2s ease',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block',
          opacity: state === 'live' ? 1 : 0, transition: 'opacity 1.2s ease',
        }}
      />
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  );
}
