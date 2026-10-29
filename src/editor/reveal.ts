// Lets panels jump to a location without importing Monaco, which keeps it in the lazy chunk.
let handler: ((start: number, end: number) => void) | undefined;

export function setRevealHandler(h: typeof handler) {
  handler = h;
}

export function reveal(start: number, end: number) {
  handler?.(start, end);
}
