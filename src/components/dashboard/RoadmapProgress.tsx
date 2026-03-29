import { ROADMAP_DATA } from '@/lib/data';

function formatM(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(0)}M`;
  return `$${(n / 1000).toFixed(0)}K`;
}

const CURRENT_YEAR = 2026;
const CURRENT_VALUE = 580000;
const TARGET = 50000000;

export function RoadmapProgress() {
  const progress = (CURRENT_VALUE / TARGET) * 100;
  return (
    <div className="terminal-card" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>$50M Roadmap Progress</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Foundation Year 2026 &mdash; On Track</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#c9a84c' }}>{progress.toFixed(1)}%</div>
          <div style={{ fontSize: 12, color: '#6b6b80' }}>of $50M target</div>
        </div>
      </div>
      {/* Progress Bar with Milestones */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{ backgroundColor: '#2a2a3a', borderRadius: 6, height: 8 }}>
          <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#c9a84c', borderRadius: 6 }} />
        </div>
        {/* Milestone markers */}
        {ROADMAP_DATA.map(entry => {
          const pos = (entry.projected / TARGET) * 100;
          const isPast = entry.year <= CURRENT_YEAR;
          return (
            <div
              key={entry.year}
              style={{ position: 'absolute', left: `${Math.min(pos, 99)}%`, top: -3, transform: 'translateX(-50%)' }}
            >
              <div style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: isPast ? '#c9a84c' : '#2a2a3a',
                border: '2px solid #c9a84c',
              }} />
            </div>
          );
        })}
      </div>
      {/* Year labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {ROADMAP_DATA.map(entry => (
          <div key={entry.year} style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 11,
              color: entry.year === CURRENT_YEAR ? '#c9a84c' : '#6b6b80',
              fontWeight: entry.year === CURRENT_YEAR ? 700 : 400,
            }}>{entry.year}</div>
            <div style={{ fontSize: 10, color: '#6b6b80' }}>{formatM(entry.projected)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
