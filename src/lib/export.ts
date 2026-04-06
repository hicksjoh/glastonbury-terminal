// CSV export
export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      const str = val == null ? '' : String(val);
      // Escape commas and quotes
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','))
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, `${filename}.csv`);
}

// Simple PDF export (generates a styled HTML document and prints to PDF)
export function exportToPDF(title: string, content: string, filename: string) {
  void filename; // filename reserved for future direct-download support
  const html = `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
  body { font-family: 'Helvetica Neue', sans-serif; padding: 40px; color: #1a1a1a; }
  h1 { font-size: 24px; border-bottom: 2px solid #8a5cf6; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-size: 12px; }
  th { background: #f5f5f5; font-weight: 600; }
  .positive { color: #16a34a; } .negative { color: #dc2626; }
  .footer { margin-top: 40px; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
</style>
</head><body>
<h1>${title}</h1>
<p style="color: #666; font-size: 12px;">Generated: ${new Date().toLocaleString()} • The Glastonbury Group</p>
${content}
<div class="footer">Glastonbury Terminal • Confidential</div>
</body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
