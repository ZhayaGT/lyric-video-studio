let counter = 0;

export function newLineId(): string {
  counter = (counter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 7);
  return `l${counter.toString(36)}${rand}`;
}
