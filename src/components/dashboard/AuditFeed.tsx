import { AuditLogEntry } from '@/types';
import { formatDistanceToNow } from 'date-fns';

function StatusDot({ status }: { status: AuditLogEntry['status'] }) {
  const colors = { success: '#22c55e', failed: '#ef4444', pending: '#c9a84c' };
  return (
    <div style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      backgroundColor: colors[status],
      flexShrink: 0,
      marginTop: 5,
    }} />
  );
}

export function AuditFeed({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <div className="terminal-card">
      <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Agent Activity</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.map(entry => (
          <div key={entry.id} style={{ display: 'flex', gap: 10 }}>
            <StatusDot status={entry.status} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>
                  {entry.agent} &mdash; {entry.action}
                </span>
                <span style={{ fontSize: 11, color: '#6b6b80' }}>
                  {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#6b6b80' }}>{entry.details}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
