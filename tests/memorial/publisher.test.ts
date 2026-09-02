import { InMemoryKeyValueStore } from '../../src/persistence';
import { MemorialStore, InMemoryPublicContentSource, defaultHandleFor } from '../../src/memorial';
import { MemorialPublisher } from '../../src/adapters/channels/memorial-publisher';

describe('MemorialPublisher (public-release destination)', () => {
  it('publishes a prepared document to the store under its handle', () => {
    const store = new MemorialStore(new InMemoryKeyValueStore());
    const source = new InMemoryPublicContentSource();
    source.set('acct-1', { handle: 'abc123', displayName: 'A. Person', epitaph: 'kind', blocks: [{ kind: 'passage', text: 'Be well.' }] });
    const publisher = new MemorialPublisher({ source, store });

    publisher.publish('acct-1', 5000);

    const doc = store.get('abc123');
    expect(doc).toBeDefined();
    expect(doc!.displayName).toBe('A. Person');
    expect(doc!.publishedAt).toBe(5000);
    expect(doc!.blocks).toHaveLength(1);
  });

  it('publishes a dignified minimal record when nothing is prepared (never throws)', () => {
    const store = new MemorialStore(new InMemoryKeyValueStore());
    const publisher = new MemorialPublisher({ source: new InMemoryPublicContentSource(), store });

    publisher.publish('acct-2', 7000);

    const doc = store.get(defaultHandleFor('acct-2'));
    expect(doc).toBeDefined();
    expect(doc!.displayName).toBe('In memoriam');
    expect(doc!.blocks).toHaveLength(0);
  });

  it('the handle does not reveal the account id', () => {
    expect(defaultHandleFor('acct-secret')).not.toContain('acct-secret');
    expect(defaultHandleFor('acct-secret')).toHaveLength(24);
  });
});
