export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip HTML tags
    .trim()
    .slice(0, 10000); // Max length
}

export function sanitizeSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9.^/-]/g, '').toUpperCase().slice(0, 10);
}
