/**
 * The little of Node the tests use, declared here instead of bringing in the
 * whole of its type definitions: reading the game's own files from disk.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function existsSync(path: string | URL): boolean;
  export function statSync(path: string | URL): { size: number };
}
