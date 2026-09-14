import { it, expect } from 'vitest';
import { latestOnly } from '../src/lib/latestOnly';
it('退出后丢弃旧账号延迟返回的数据', async () => {
  const shown: string[] = [];
  const gate = latestOnly<string>((s) => shown.push(s));
  let finish!: (s: string) => void;
  const old = gate.run(
    () =>
      new Promise<string>((r) => {
        finish = r;
      }),
  );
  gate.invalidate();
  await gate.run(async () => 'anonymous');
  finish('admin-private-data');
  await old;
  expect(shown).toEqual(['anonymous']);
});
it('当前刷新失败立即清除先前私有缓存', async () => {
  let shown = 'admin-private-data';
  const gate = latestOnly<string>(
    (value) => {
      shown = value;
    },
    () => {
      shown = '';
    },
  );
  await expect(
    gate.run(async () => {
      throw new Error('network');
    }),
  ).rejects.toThrow('network');
  expect(shown).toBe('');
});
it('过期请求失败不能清除后来成功的身份与数据', async () => {
  let shown = 'admin-private-data';
  let fail!: (reason: Error) => void;
  const gate = latestOnly<string>(
    (value) => {
      shown = value;
    },
    () => {
      shown = '';
    },
  );
  const old = gate.run(
    () =>
      new Promise<string>((_, reject) => {
        fail = reject;
      }),
  );
  await gate.run(async () => 'new-user-data');
  fail(new Error('old network error'));
  await old;
  expect(shown).toBe('new-user-data');
});
it('确认退出时可先清除缓存，匿名数据加载失败后也不恢复旧缓存', async () => {
  let shown = 'admin-private-data';
  let fail!: (reason: Error) => void;
  const gate = latestOnly<string>(
    (value) => {
      shown = value;
    },
    () => {
      shown = '';
    },
  );
  const refresh = gate.run(async (publish) => {
    publish('');
    return new Promise<string>((_, reject) => {
      fail = reject;
    });
  });
  expect(shown).toBe('');
  fail(new Error('anonymous snapshot offline'));
  await expect(refresh).rejects.toThrow('offline');
  expect(shown).toBe('');
});
