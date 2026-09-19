import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../lib/domain/refresh-queue';
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
test('sync bursts coalesce, requests never overlap, and one trailing update is retained', async () => {
  let count = 0;
  let release = () => {};
  const queue = createRefreshQueue(async () => {
    count++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }, 0);
  queue.request();
  queue.request();
  queue.request();
  await settle();
  assert.equal(count, 1);
  queue.request();
  queue.request();
  await settle();
  assert.equal(count, 1);
  release();
  await settle();
  assert.equal(count, 2);
  queue.dispose();
  release();
  await settle();
  assert.equal(count, 2);
});
test('disposing during navigation cancels a scheduled refresh', async () => {
  let count = 0;
  const queue = createRefreshQueue(async () => {
    count++;
  }, 0);
  queue.request();
  queue.dispose();
  await settle();
  assert.equal(count, 0);
});

test('disposing an in-flight range queue prevents its trailing request', async () => {
  let calls = 0;
  let release = () => {};
  const queue = createRefreshQueue(async () => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }, 0);
  queue.request();
  await settle();
  queue.request();
  queue.dispose();
  release();
  await settle();
  assert.equal(calls, 1);
});
