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
