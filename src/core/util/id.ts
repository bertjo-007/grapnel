/** Zufällige UUID (v4). crypto.randomUUID gibt es in allen Zielbrowsern und in Node. */
export function newId(): string {
  return crypto.randomUUID();
}
