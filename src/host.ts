/**
 * The claude.ai artifact runtime, when this app is running as a hosted
 * artifact. Every capability may be absent: callers design for null.
 */

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleOptions {
  signal?: AbortSignal;
  images?: Blob[];
  modelTier?: 'default' | 'complex' | 'quick';
  cache?: boolean;
}

export interface Sample {
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number; mediaTypes: string[] } }>;
}

export interface Downloads {
  save(request: { filename: string; data: Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface HostRuntime {
  use(name: 'sample'): Promise<Sample | null>;
  use(name: 'downloads'): Promise<Downloads | null>;
}

const runtime = (window as unknown as { claude?: HostRuntime }).claude;

/** True when the page runs inside a claude.ai artifact viewer (or its own host). */
export const isHosted = typeof runtime?.use === 'function';

export async function getSample(): Promise<Sample | null> {
  try {
    return (await runtime?.use('sample')) ?? null;
  } catch {
    return null;
  }
}

export async function getDownloads(): Promise<Downloads | null> {
  try {
    return (await runtime?.use('downloads')) ?? null;
  } catch {
    return null;
  }
}

export function isSampleError(e: unknown): e is SampleError {
  return typeof e === 'object' && e !== null && typeof (e as SampleError).code === 'string';
}
