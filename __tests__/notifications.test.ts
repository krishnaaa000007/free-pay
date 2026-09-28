import { __resetNotifications, dismiss, dismissAll, expire, getQueue, notify, subscribe, toast } from '@/services/notifications';

describe('notification bus', () => {
  beforeEach(() => __resetNotifications());

  it('queues notifications and notifies subscribers', () => {
    const seen: number[] = [];
    const unsub = subscribe((q) => seen.push(q.length));
    toast.success('Synced');
    toast.info('Hello');
    expect(seen).toEqual([0, 1, 2]);
    unsub();
    toast.error('x');
    expect(seen).toEqual([0, 1, 2]);
  });

  it('caps the visible queue at three', () => {
    for (let i = 0; i < 6; i++) toast.info(`n${i}`);
    expect(getQueue().map((n) => n.title)).toEqual(['n3', 'n4', 'n5']);
  });

  it('replaces notifications that share a dedupe key', () => {
    toast.sync('1 payment synced');
    toast.sync('4 payments synced');
    expect(getQueue()).toHaveLength(1);
    expect(getQueue()[0].title).toBe('4 payments synced');
  });

  it('dismisses individually and in bulk', () => {
    const id = toast.warning('a');
    toast.warning('b');
    dismiss(id);
    expect(getQueue().map((n) => n.title)).toEqual(['b']);
    dismissAll();
    expect(getQueue()).toEqual([]);
  });

  it('expires by ttl but keeps sticky ones', () => {
    notify({ kind: 'info', title: 'sticky', ttlMs: 0 });
    notify({ kind: 'info', title: 'short', ttlMs: 10 });
    const removed = expire(Date.now() + 1000);
    expect(removed).toBe(1);
    expect(getQueue().map((n) => n.title)).toEqual(['sticky']);
  });

  it('uses sensible default ttls per kind', () => {
    toast.error('e');
    toast.success('s');
    const [e, s] = getQueue();
    expect(e.ttlMs).toBeGreaterThan(s.ttlMs);
  });
});
