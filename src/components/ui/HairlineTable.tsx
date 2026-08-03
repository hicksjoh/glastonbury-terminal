'use client';

import React from 'react';
import { color, font, motion, size as sz, space, tracking, weight } from '@/lib/design-tokens';

// The one dense data table. CSS grid rows (NOT <table>) so the header and
// every body row share a single gridTemplateColumns and stay pixel-aligned.
// Instrument rules: micro mono uppercase header over a strong hairline,
// faint hairlines between rows, hover is a glassLo wash ONLY — no transform,
// no border change. Right-aligned columns render in tabular mono.

export interface HairlineColumn {
  /** Stable column id, passed back to `renderCell` */
  key: string;
  /** Header text — rendered uppercase in micro mono */
  label: string;
  /** 'right' also switches body cells to JetBrains Mono + tabular-nums */
  align?: 'left' | 'right';
  /** CSS grid track for this column (e.g. '48px', 'minmax(0, 1fr)'). Default 'minmax(0, 1fr)' */
  width?: string;
}

export interface HairlineTableProps<Row> {
  columns: HairlineColumn[];
  rows: Row[];
  renderCell: (row: Row, col: HairlineColumn) => React.ReactNode;
  onRowClick?: (row: Row) => void;
  /** Stable row key — defaults to the row index */
  rowKey?: (row: Row, index: number) => React.Key;
  style?: React.CSSProperties;
}

export function HairlineTable<Row>({
  columns,
  rows,
  renderCell,
  onRowClick,
  rowKey,
  style,
}: HairlineTableProps<Row>) {
  const template = columns.map(c => c.width ?? 'minmax(0, 1fr)').join(' ');

  const rowBase: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: template,
    columnGap: space[3],
    alignItems: 'center',
  };

  return (
    <div role="table" style={style}>
      {/* Header */}
      <div role="row" style={{ ...rowBase, paddingBottom: space[1], borderBottom: `1px solid ${color.borderStrong}` }}>
        {columns.map(col => (
          <span
            key={col.key}
            role="columnheader"
            style={{
              minWidth: 0,
              fontFamily: font.mono,
              fontSize: sz.micro.fontSize,
              lineHeight: `${sz.micro.lineHeight}px`,
              fontWeight: weight.medium,
              letterSpacing: tracking.eyebrow,
              textTransform: 'uppercase',
              color: color.textMuted,
              textAlign: col.align ?? 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {col.label}
          </span>
        ))}
      </div>

      {/* Body */}
      {rows.map((row, i) => (
        <div
          key={rowKey ? rowKey(row, i) : i}
          role="row"
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.glassLo; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            ...rowBase,
            padding: `${space[2]}px 0`,
            borderBottom: i < rows.length - 1 ? `1px solid ${color.borderFaint}` : 'none',
            background: 'transparent',
            transition: `background ${motion.duration.fast}ms ${motion.easing.default}`,
            cursor: onRowClick ? 'pointer' : 'default',
          }}
        >
          {columns.map(col => (
            <span
              key={col.key}
              role="cell"
              style={{
                minWidth: 0,
                fontSize: sz.body.fontSize,
                lineHeight: `${sz.body.lineHeight}px`,
                color: color.text,
                textAlign: col.align ?? 'left',
                ...(col.align === 'right'
                  ? { fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' as const }
                  : {}),
              }}
            >
              {renderCell(row, col)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
