// R2 blob storage adapter (G1.1/G2). Exercises R2StorageAdapter's real put/get/
// delete/probe logic against a fake S3-shaped client — no network, no SDK
// installed — proving the adapter's OWN logic (health-cache defaults, error
// handling, canary round-trip) independent of `createR2StorageAdapter`'s lazy
// require (which needs the real package and is exercised only for its error
// message when the package is absent).

import { R2StorageAdapter, createR2StorageAdapter, type R2Commands, type S3ClientLike } from '../../src/adapters/channels/r2-storage';

class FakePutCommand {
  constructor(public readonly input: Record<string, unknown>) {}
}
class FakeGetCommand {
  constructor(public readonly input: Record<string, unknown>) {}
}
class FakeDeleteCommand {
  constructor(public readonly input: Record<string, unknown>) {}
}

const COMMANDS: R2Commands = {
  PutObjectCommand: FakePutCommand,
  GetObjectCommand: FakeGetCommand,
  DeleteObjectCommand: FakeDeleteCommand,
};

/** A faithful in-memory stand-in for the S3 client's `.send()`, recognising the three commands. */
class FakeS3Client implements S3ClientLike {
  private readonly objects = new Map<string, Buffer>();
  /** When set, every send() throws this instead (simulates a transport/auth failure). */
  failWith: Error | undefined;

  async send(command: unknown): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }> {
    if (this.failWith !== undefined) throw this.failWith;
    if (command instanceof FakePutCommand) {
      this.objects.set(String(command.input['Key']), Buffer.from(command.input['Body'] as Buffer));
      return {};
    }
    if (command instanceof FakeGetCommand) {
      const bytes = this.objects.get(String(command.input['Key']));
      if (bytes === undefined) {
        const err = new Error('not found') as Error & { name: string };
        err.name = 'NoSuchKey';
        throw err;
      }
      return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
    }
    if (command instanceof FakeDeleteCommand) {
      this.objects.delete(String(command.input['Key']));
      return {};
    }
    throw new Error('unrecognised command');
  }
}

function adapter(): { client: FakeS3Client; storage: R2StorageAdapter } {
  const client = new FakeS3Client();
  return { client, storage: new R2StorageAdapter({ client, bucket: 'legacy-vault', commands: COMMANDS }) };
}

describe('R2StorageAdapter — BlobStore (async content ciphertext)', () => {
  it('round-trips bytes through put/get', async () => {
    const { storage } = adapter();
    await storage.put('acct/p1', Buffer.from('encrypted-bytes'));
    const back = await storage.get('acct/p1');
    expect(back?.toString()).toBe('encrypted-bytes');
  });

  it('get returns undefined for a missing key (not an error)', async () => {
    const { storage } = adapter();
    await expect(storage.get('nope')).resolves.toBeUndefined();
  });

  it('delete removes the object', async () => {
    const { storage } = adapter();
    await storage.put('acct/p1', Buffer.from('x'));
    await storage.delete('acct/p1');
    await expect(storage.get('acct/p1')).resolves.toBeUndefined();
  });

  it('propagates a real transport error from get (not swallowed as "missing")', async () => {
    const { client, storage } = adapter();
    await storage.put('acct/p1', Buffer.from('x'));
    client.failWith = Object.assign(new Error('network down'), { name: 'NetworkingError' });
    await expect(storage.get('acct/p1')).rejects.toThrow('network down');
  });
});

describe('R2StorageAdapter — StoragePort health probe (§6, veto path 3)', () => {
  it('defaults to UNHEALTHY before any traffic (fail safe: unknown never reads as healthy)', () => {
    const { storage } = adapter();
    expect(storage.probe()).toBe(false);
  });

  it('a successful put/get marks the cache healthy', async () => {
    const { storage } = adapter();
    await storage.put('k', Buffer.from('v'));
    expect(storage.probe()).toBe(true);
  });

  it('a failed put marks the cache unhealthy again', async () => {
    const { client, storage } = adapter();
    await storage.put('k', Buffer.from('v'));
    expect(storage.probe()).toBe(true);
    client.failWith = new Error('boom');
    await expect(storage.put('k2', Buffer.from('v'))).rejects.toThrow('boom');
    expect(storage.probe()).toBe(false);
  });

  it('refreshProbe performs a real canary round-trip and updates the cache', async () => {
    const { storage } = adapter();
    expect(storage.probe()).toBe(false);
    await expect(storage.refreshProbe()).resolves.toBe(true);
    expect(storage.probe()).toBe(true);
  });

  it('refreshProbe reports unhealthy (never throws) when the backend is down', async () => {
    const { client, storage } = adapter();
    client.failWith = new Error('boom');
    await expect(storage.refreshProbe()).resolves.toBe(false);
    expect(storage.probe()).toBe(false);
  });
});

describe('createR2StorageAdapter', () => {
  it('builds a real, working adapter now that @aws-sdk/client-s3 is installed', () => {
    // Construction alone makes no network call (the SDK just sets up config), so
    // this proves the lazy-require + S3Client wiring is correct end to end.
    const adapter = createR2StorageAdapter({ accountId: 'acct123', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'legacy-vault' });
    expect(adapter).toBeInstanceOf(R2StorageAdapter);
    expect(adapter.probe()).toBe(false); // no traffic yet — conservative default
  });

  it('fails with an actionable message when the SDK cannot be required (G1.1: never a silent fallback)', () => {
    jest.resetModules();
    jest.doMock('@aws-sdk/client-s3', () => {
      throw new Error('Cannot find module');
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createR2StorageAdapter: create } = require('../../src/adapters/channels/r2-storage') as typeof import('../../src/adapters/channels/r2-storage');
    expect(() => create({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' })).toThrow(
      /@aws-sdk\/client-s3 is not installed/,
    );
    jest.dontMock('@aws-sdk/client-s3');
    jest.resetModules();
  });
});
