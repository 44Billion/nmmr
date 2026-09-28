import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { launchChrome } from '../../../44billion/tests/browser/runtime/chrome.js'

const fixture = `<!doctype html><script type="module">
import File from '/ephemeral-file.js';
window.files = [];
window.write = async value => {
  const file = new File('same-label'); files.push(file); await file.writeLine(value);
};
window.read = async index => Array.fromAsync(files[index].readLines());
window.rows = async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('ephemeral-files', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction(['lines', 'nmmr-sessions']);
    const rows = tx.objectStore('lines').getAll();
    const sessions = tx.objectStore('nmmr-sessions').getAllKeys();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    return {values: rows.result.map(row => row.__str__).sort(), sessions: sessions.result.length};
  } finally { db.close(); }
};
window.ready = true;
</script>`

test('real tabs reclaim terminated sessions, retain active leaves and initialize concurrently', { timeout: 120000 }, async () => {
  const source = await readFile(new URL('../../src/lib/ephemeral-file.js', import.meta.url))
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/ephemeral-file.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/ephemeral-file.js' ? source : fixture)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await launchChrome()
    const origin = `http://localhost:${server.address().port}`
    const evaluate = async (targetId, expression) => {
      const context = await browser.until(() => [...browser.contexts.values()].find(ctx => ctx.origin === origin && ctx.auxData?.isDefault && ctx.auxData.frameId === targetId), 'tab context')
      const objectGroup = 'nmmr-storage-test'
      try {
        const result = await browser.send('Runtime.evaluate', { expression, contextId: context.id, objectGroup, awaitPromise: true, returnByValue: true }, context.sessionId)
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
        return result.result.value
      } finally { await browser.send('Runtime.releaseObjectGroup', { objectGroup }, context.sessionId).catch(() => {}) }
    }
    const tab = async () => {
      const { targetId } = await browser.send('Target.createTarget', { url: origin })
      await browser.until(() => evaluate(targetId, 'window.ready'), 'storage fixture ready')
      return targetId
    }
    const a = await tab(); const b = await tab()
    await evaluate(a, "write('active')")
    await evaluate(a, "write('same session')")
    await evaluate(b, "write('abandoned')")
    assert.deepEqual(await evaluate(a, 'rows()'), { values: ['abandoned', 'active', 'same session'], sessions: 2 })
    await browser.send('Target.closeTarget', { targetId: b })
    const c = await tab(); const d = await tab()
    await Promise.all([evaluate(c, "write('concurrent-c')"), evaluate(d, "write('concurrent-d')")])
    assert.deepEqual(await evaluate(a, 'rows()'), { values: ['active', 'concurrent-c', 'concurrent-d', 'same session'], sessions: 3 })
    assert.deepEqual(await evaluate(a, 'read(0)'), ['active'])
    await evaluate(a, 'files[0].close()')
    assert.deepEqual(await evaluate(a, 'read(1)'), ['same session'])
    assert.deepEqual(await evaluate(c, 'read(0)'), ['concurrent-c'])
    for (const targetId of [a, c, d]) await browser.send('Target.closeTarget', { targetId })
    const reopened = await tab()
    await evaluate(reopened, "write('after reopening')")
    assert.deepEqual(await evaluate(reopened, 'rows()'), { values: ['after reopening'], sessions: 1 })
    await evaluate(reopened, 'files[0].close()')
    assert.deepEqual((await evaluate(reopened, 'rows()')).values, [])
  } catch (error) {
    await browser?.diagnose('/tmp/nmmr-browser-session-failure')
    throw error
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
