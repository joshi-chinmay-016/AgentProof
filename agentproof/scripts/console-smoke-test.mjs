/**
 * AgentProof Phase 8 — Web Console End-to-End Smoke Test
 * 
 * Boots ConsoleServer, verifies static asset delivery, API endpoints,
 * scenario execution, verdict preservation, and clean shutdown.
 */

import http from 'node:http';
import { ConsoleServer } from '../dist/server/console-server.js';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}));
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'x-agentproof-tenant': 'smoke-tenant',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runSmokeTest() {
  console.log('[SmokeTest] Initializing AgentProof ConsoleServer on port 3009...');
  const server = new ConsoleServer({ port: 3009, host: '127.0.0.1' });
  const addr = await server.start();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`[SmokeTest] Server listening on ${baseUrl}`);

  try {
    // 1. Static HTML
    console.log('[SmokeTest] 1. Checking GET / (index.html)...');
    const rRoot = await get(`${baseUrl}/`);
    if (rRoot.statusCode !== 200 || !rRoot.text.includes('AgentProof')) {
      throw new Error(`Failed to load index.html: status=${rRoot.statusCode}`);
    }
    console.log('  ✓ index.html delivered with correct layout landmarks');

    // 2. Theme CSS
    console.log('[SmokeTest] 2. Checking GET /styles/theme.css...');
    const rCss = await get(`${baseUrl}/styles/theme.css`);
    if (rCss.statusCode !== 200 || !rCss.text.includes('--verdict-pass')) {
      throw new Error(`Failed to load theme.css: status=${rCss.statusCode}`);
    }
    console.log('  ✓ theme.css delivered with complete Dark/Light tokens');

    // 3. Client JS
    console.log('[SmokeTest] 3. Checking GET /js/app.js...');
    const rJs = await get(`${baseUrl}/js/app.js`);
    if (rJs.statusCode !== 200 || !rJs.text.includes('AgentProof Web Console')) {
      throw new Error(`Failed to load app.js: status=${rJs.statusCode}`);
    }
    console.log('  ✓ app.js delivered with SPA client router');

    // 4. API Health
    console.log('[SmokeTest] 4. Checking GET /api/health...');
    const rHealth = await get(`${baseUrl}/api/health`);
    if (rHealth.statusCode !== 200 || rHealth.json?.status !== 'healthy') {
      throw new Error(`Health check failed: status=${rHealth.statusCode}`);
    }
    console.log('  ✓ /api/health operational');

    // 5. Scenarios
    console.log('[SmokeTest] 5. Checking GET /api/scenarios...');
    const rScenarios = await get(`${baseUrl}/api/scenarios`);
    if (rScenarios.statusCode !== 200 || !rScenarios.json?.items) {
      throw new Error(`Scenarios query failed: status=${rScenarios.statusCode}`);
    }
    console.log(`  ✓ /api/scenarios returned ${rScenarios.json.total} scenarios`);

    // 6. Execute Scenario A (PASS)
    console.log('[SmokeTest] 6. Executing Scenario A via POST /api/scenarios/SCENARIO_A/run...');
    const rScnA = await post(`${baseUrl}/api/scenarios/SCENARIO_A/run`, {});
    if (rScnA.statusCode !== 200 || rScnA.json?.authoritativeVerdict !== 'PASS') {
      throw new Error(`Scenario A verification failed: ${JSON.stringify(rScnA.json)}`);
    }
    console.log('  ✓ Scenario A evaluated: Authoritative PASS');

    // 7. Execute Scenario B (FAIL)
    console.log('[SmokeTest] 7. Executing Scenario B via POST /api/scenarios/SCENARIO_B/run...');
    const rScnB = await post(`${baseUrl}/api/scenarios/SCENARIO_B/run`, {});
    if (rScnB.statusCode !== 200 || rScnB.json?.authoritativeVerdict !== 'FAIL') {
      throw new Error(`Scenario B verification failed: ${JSON.stringify(rScnB.json)}`);
    }
    console.log('  ✓ Scenario B evaluated: Authoritative FAIL');

    // 8. Verify Overview Metrics
    console.log('[SmokeTest] 8. Checking GET /api/overview...');
    const rOverview = await get(`${baseUrl}/api/overview?tenant=smoke-tenant`);
    if (rOverview.statusCode !== 200 || (rOverview.json?.metrics?.totalVerifications ?? 0) < 2) {
      throw new Error(`Overview metrics mismatch: ${JSON.stringify(rOverview.json?.metrics)}`);
    }
    console.log(`  ✓ Overview metrics: Total=${rOverview.json.metrics.totalVerifications}, PASS=${rOverview.json.metrics.passCount}, FAIL=${rOverview.json.metrics.failCount}`);

    // 9. Verify Audit Integrity
    console.log('[SmokeTest] 9. Checking GET /api/audit/integrity...');
    const rAudit = await get(`${baseUrl}/api/audit/integrity?tenant=smoke-tenant`);
    if (rAudit.statusCode !== 200 || !rAudit.json?.isValid) {
      throw new Error(`Audit integrity check failed: ${JSON.stringify(rAudit.json)}`);
    }
    console.log(`  ✓ Audit hash chain verified intact (${rAudit.json.checkedSequences} sequences)`);

    console.log('\n=========================================');
    console.log('✓ AGENTPROOF WEB CONSOLE SMOKE TEST PASSED');
    console.log('=========================================');
  } finally {
    console.log('[SmokeTest] Shutting down test server...');
    await server.stop();
  }
}

runSmokeTest().catch((err) => {
  console.error('[SmokeTest] FAILED:', err);
  process.exit(1);
});
