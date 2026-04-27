import type {
  GPMListProfilesParams,
  GPMListResponse,
  GPMProfile,
  GPMStartProfileOptions,
  GPMStartProfileResult,
} from './types.js';

const MOCK_PROFILES: GPMProfile[] = Array.from({ length: 5 }, (_, i) => ({
  id: `mock-profile-${String(i + 1).padStart(3, '0')}`,
  name: `Mock Profile ${i + 1}`,
  group_id: null,
  storage_path: `/tmp/gpm/profiles/mock-${i + 1}`,
  raw_proxy: '',
  browser: { name: 'chrome', version: '120.0.0.0' },
  os: 'linux',
  note: 'Auto-generated mock profile',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ['mock'],
}));

/**
 * In-memory GPM mock for environments without a real GPM runtime.
 * Returns fake profiles and simulates start/stop lifecycle.
 */
export class MockGPMClient {
  private running = new Set<string>();

  async listProfiles(params: GPMListProfilesParams = {}): Promise<GPMListResponse<GPMProfile>> {
    const page = params.page ?? 1;
    const perPage = params.perPage ?? 30;
    const start = (page - 1) * perPage;
    const items = MOCK_PROFILES.slice(start, start + perPage);
    return {
      items,
      total: MOCK_PROFILES.length,
      page,
      perPage,
      lastPage: Math.ceil(MOCK_PROFILES.length / perPage),
    };
  }

  async getProfile(id: string): Promise<GPMProfile> {
    const found = MOCK_PROFILES.find((p) => p.id === id);
    if (!found) throw new Error(`MockGPM: profile ${id} not found`);
    return found;
  }

  async startProfile(
    id: string,
    _options: GPMStartProfileOptions = {},
  ): Promise<GPMStartProfileResult> {
    if (this.running.has(id)) {
      throw new Error(`MockGPM: profile ${id} already running`);
    }
    this.running.add(id);
    const port = 19200 + MOCK_PROFILES.findIndex((p) => p.id === id);
    return {
      profileId: id,
      wsEndpoint: `ws://127.0.0.1:${port}`,
      remote: `127.0.0.1:${port}`,
      port,
      driverPath: '/usr/bin/google-chrome',
      processId: null,
      profileName: `mock-${id}`,
      raw: {
        profile_id: id,
        driver_path: '/usr/bin/google-chrome',
        remote_debugging_port: port,
      },
    };
  }

  async closeProfile(id: string): Promise<{ alreadyClosed: boolean }> {
    const was = this.running.has(id);
    this.running.delete(id);
    return { alreadyClosed: !was };
  }
}
