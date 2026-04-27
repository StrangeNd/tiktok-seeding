import { GPMClient, type GPMClientOptions } from './client.js';
import { MockGPMClient } from './mock.js';

export type GPMClientLike = GPMClient | MockGPMClient;

export function createGPMClient(mode: 'live' | 'mock', opts: GPMClientOptions): GPMClientLike {
  if (mode === 'mock') return new MockGPMClient();
  return new GPMClient(opts);
}
