'use client';

import React, { useState } from 'react';
import { Card } from './Card';
import { ModelBadge } from './ModelBadge';
import { PillBadge } from './PillBadge';
import { color, font, size as sz, weight, tracking, space, motion } from '@/lib/design-tokens';

// Expandable tool-use trace, one step per turn — the Claude Artifacts pattern
// adapted for the terminal. Feed it the agent's steps (tool name, input,
// duration, model). Collapsed by default.

export interface AgentTraceStep {
  id: string;
  tool: string;
  input?: string;
  output?: string;
  model?: string;
  latencyMs?: number;
  status?: 'ok' | 'error' | 'pending';
}

export interface AgentTraceProps {
  steps: AgentTraceStep[];
  title?: string;
  defaultOpen?: boolean;
}

export function AgentTrace({ steps, title = 'Reasoning trace', defaultOpen = false }: AgentTraceProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card size="sm" tone="inset">
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          width: '100%',
          background: 'none',
          border: 'none',
          color: color.textMuted,
          fontSize: sz.label.fontSize,
          fontWeight: weight.semibold,
          textTransform: 'uppercase',
          letterSpacing: tracking.eyebrow,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: `transform ${motion.duration.fast}ms ${motion.easing.default}`,
            fontSize: 10,
          }}
        >
          ▶
        </span>
        {title}
        <span style={{ color: color.textDim, fontWeight: weight.regular, letterSpacing: 'normal', textTransform: 'none' }}>
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: space[3], display: 'flex', flexDirection: 'column', gap: space[2] }}>
          {steps.map((step, i) => (
            <div
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: space[3],
                padding: `${space[2]}px ${space[3]}px`,
                borderRadius: 8,
                background: color.glassLo,
                border: `1px solid ${color.borderFaint}`,
              }}
            >
              <span style={{ fontFamily: font.mono, fontSize: sz.micro.fontSize, color: color.textDim, width: 20 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: 2 }}>
                  <span style={{ fontFamily: font.mono, fontSize: sz.body.fontSize, color: color.text, fontWeight: weight.medium }}>
                    {step.tool}
                  </span>
                  {step.status === 'error' && <PillBadge tone="negative" size="sm">error</PillBadge>}
                  {step.status === 'pending' && <PillBadge tone="warning" size="sm">running</PillBadge>}
                </div>
                {step.input && (
                  <div style={{ fontSize: sz.micro.fontSize, color: color.textDim, fontFamily: font.mono, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {step.input.slice(0, 120)}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
                {step.model && <ModelBadge model={step.model} latencyMs={step.latencyMs} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
