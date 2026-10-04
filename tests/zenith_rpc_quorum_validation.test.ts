import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateSingleRpcEndpoint, evaluateRpcQuorum } from '../packages/chains/src';

function createMockRpcServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

test('ZENITH Protocol — RPC Quorum Validation & Error Handling Suite', async (t) => {
  await t.test('Test A — Healthy RPC returns HEALTHY status and block data', async () => {
    const mock = await createMockRpcServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const json = JSON.parse(body);
        if (json.method === 'eth_chainId') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: '0xaa36a7' })); // 11155111
        } else if (json.method === 'eth_getBlockByNumber') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { number: '0xb4b434', timestamp: '0x66fbf4a0' } }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: null }));
        }
      });
    });

    try {
      const result = await validateSingleRpcEndpoint(mock.url, 11155111);
      assert.equal(result.healthy, true);
      assert.equal(result.observedChainId, 11155111);
      assert.equal(result.blockNumber, 11842612);
      assert.equal(result.httpStatus, 200);
    } finally {
      await mock.close();
    }
  });

  await t.test('Test B — HTTP 404 is classified as UNHEALTHY without infinite retry', async () => {
    const mock = await createMockRpcServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    });

    try {
      const result = await validateSingleRpcEndpoint(mock.url, 11155111);
      assert.equal(result.healthy, false);
      assert.equal(result.httpStatus, 404);
      assert.ok(result.reason?.includes('404'));
      assert.equal(result.blockNumber, null);
    } finally {
      await mock.close();
    }
  });

  await t.test('Test C — Wrong chain ID is classified as UNHEALTHY', async () => {
    const mock = await createMockRpcServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const json = JSON.parse(body);
        if (json.method === 'eth_chainId') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: '0x1' })); // Ethereum Mainnet (1) instead of 11155111
        }
      });
    });

    try {
      const result = await validateSingleRpcEndpoint(mock.url, 11155111);
      assert.equal(result.healthy, false);
      assert.equal(result.observedChainId, 1);
      assert.ok(result.reason?.includes('Chain ID mismatch'));
    } finally {
      await mock.close();
    }
  });

  await t.test('Test D — Malformed JSON-RPC is classified as UNHEALTHY', async () => {
    const mock = await createMockRpcServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"error": {"code": -32600, "message": "Invalid Request"}}');
    });

    try {
      const result = await validateSingleRpcEndpoint(mock.url, 11155111);
      assert.equal(result.healthy, false);
      assert.ok(result.reason?.includes('Invalid Request'));
    } finally {
      await mock.close();
    }
  });

  await t.test('Test E — One healthy + one failed provider produces DEGRADED quorum with healthy provider usable', async () => {
    const healthyMock = await createMockRpcServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const json = JSON.parse(body);
        if (json.method === 'eth_chainId') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: '0xaa36a7' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { number: '0x100', timestamp: '0x100' } }));
        }
      });
    });

    const failingMock = await createMockRpcServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });

    try {
      const quorum = await evaluateRpcQuorum('Sepolia', 11155111, [healthyMock.url, failingMock.url]);
      assert.equal(quorum.healthyCount, 1);
      assert.equal(quorum.unhealthyCount, 1);
      assert.equal(quorum.quorumStatus, 'DEGRADED');
      assert.deepEqual(quorum.healthyEndpoints, [healthyMock.url]);
    } finally {
      await healthyMock.close();
      await failingMock.close();
    }
  });

  await t.test('Test F — All providers fail produces FAILED quorum', async () => {
    const fail1 = await createMockRpcServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });
    const fail2 = await createMockRpcServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable');
    });

    try {
      const quorum = await evaluateRpcQuorum('Sepolia', 11155111, [fail1.url, fail2.url]);
      assert.equal(quorum.healthyCount, 0);
      assert.equal(quorum.unhealthyCount, 2);
      assert.equal(quorum.quorumStatus, 'FAILED');
      assert.deepEqual(quorum.healthyEndpoints, []);
    } finally {
      await fail1.close();
      await fail2.close();
    }
  });
});
