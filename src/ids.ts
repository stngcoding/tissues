// Unique ids for OpenTUI renderables. One process-wide counter so every
// renderable created anywhere in the render layer gets a distinct id.
let seq = 0;
export const uid = (prefix: string): string => `${prefix}-${seq++}`;
