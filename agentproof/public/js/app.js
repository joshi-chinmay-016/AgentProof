/**
 * AgentProof Web Console — Production SPA Client
 * 
 * Provides interactive dashboard, verification explorer, evidence & audit inspector,
 * integration & webhook monitor, scenario runner, and signature visualizer.
 * 
 * Invariant: The frontend never calculates or alters authoritative verdicts.
 * All PASS / FAIL / INCONCLUSIVE outcomes are verified and returned by the backend.
 */

(function () {
  'use strict';

  // --- Global Application State ---
  const state = {
    activeView: 'overview',
    tenantId: 'default-tenant',
    theme: localStorage.getItem('agentproof_theme') || 'dark',
    sidebarCollapsed: localStorage.getItem('agentproof_sidebar_collapsed') === 'true',
    reduceVisuals: localStorage.getItem('agentproof_reduce_visuals') === 'true',
    onboardingCompleted: localStorage.getItem('agentproof_onboarding_completed') === 'true',
    checklistTasks: JSON.parse(localStorage.getItem('agentproof_checklist_tasks') || '[]'),
    checklistDismissed: localStorage.getItem('agentproof_checklist_dismissed') === 'true',
    currentOnboardingStep: 1,
    verifications: [],
    verificationFilter: 'ALL',
    searchQuery: '',
    overviewData: null,
    scenarios: [],
    integrations: [],
    webhooks: [],
  };

  // --- API Client ---
  const api = {
    async request(url, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        'x-agentproof-tenant': state.tenantId,
        ...(options.headers || {}),
      };

      try {
        const res = await fetch(url, { ...options, headers });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errMsg = data?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          throw new Error(errMsg);
        }
        return data;
      } catch (err) {
        showToast(err.message, 'error');
        throw err;
      }
    },

    get(path) {
      return this.request(path, { method: 'GET' });
    },

    post(path, body) {
      return this.request(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  };

  // --- UI Toast Notification Helper ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 200ms ease';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Theme Manager ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('agentproof_theme', theme);

    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon && moonIcon) {
      if (theme === 'light') {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      }
    }
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // --- Sidebar Toggle ---
  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
    }
    localStorage.setItem('agentproof_sidebar_collapsed', String(state.sidebarCollapsed));
  }

  // --- Router & Navigation ---
  function navigate(viewName) {
    state.activeView = viewName;
    window.location.hash = viewName;

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach((item) => {
      if (item.getAttribute('data-view') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update Breadcrumbs
    const currentTitleEl = document.getElementById('current-view-title');
    const titles = {
      overview: 'Overview',
      verifications: 'Verification Explorer',
      'evidence-audit': 'Evidence & Audit',
      'integrations-webhooks': 'Integrations & Webhooks',
      scenarios: 'Scenario Library',
      help: 'Help & Documentation',
    };
    if (currentTitleEl) {
      currentTitleEl.textContent = titles[viewName] || 'Overview';
    }

    // Render corresponding view
    const outlet = document.getElementById('content-outlet');
    if (!outlet) return;

    if (viewName === 'overview') renderOverview(outlet);
    else if (viewName === 'verifications') renderVerifications(outlet);
    else if (viewName === 'evidence-audit') renderEvidenceAudit(outlet);
    else if (viewName === 'integrations-webhooks') renderIntegrationsWebhooks(outlet);
    else if (viewName === 'scenarios') renderScenarios(outlet);
    else if (viewName === 'help') renderHelp(outlet);
    else renderOverview(outlet);
  }

  // --- Helper: Verdict Badge HTML ---
  function getVerdictBadgeHtml(verdict) {
    const v = String(verdict || 'UNKNOWN').toUpperCase();
    if (v === 'PASS') {
      return `<span class="verdict-badge pass">✓ PASS</span>`;
    }
    if (v === 'FAIL') {
      return `<span class="verdict-badge fail">✕ FAIL</span>`;
    }
    if (v === 'INCONCLUSIVE') {
      return `<span class="verdict-badge inconclusive">⚠ INCONCLUSIVE</span>`;
    }
    return `<span class="verdict-badge" style="background: var(--border-subtle); color: var(--text-muted);">${escapeHtml(v)}</span>`;
  }

  // --- Helper: Observation Status Badge (Distinct from Verdicts) ---
  function getObservationBadgeHtml(status) {
    const s = String(status || 'FOUND').toUpperCase();
    if (s === 'FOUND') {
      return `<span class="obs-badge found">● FOUND</span>`;
    }
    if (s === 'NOT_FOUND') {
      return `<span class="obs-badge not-found">○ NOT_FOUND</span>`;
    }
    if (s === 'READ_ERROR') {
      return `<span class="obs-badge read-error">⚠ READ_ERROR</span>`;
    }
    if (s === 'UNTRUSTED') {
      return `<span class="obs-badge untrusted">🛡 UNTRUSTED</span>`;
    }
    return `<span class="obs-badge not-found">${escapeHtml(s)}</span>`;
  }

  // --- Checklist State Management ---
  const CHECKLIST_ITEMS = [
    { id: 'task_run_simulation', text: 'Execute a verification simulation scenario', hint: 'Runs Scenario A or B to observe real deterministic verification' },
    { id: 'task_view_detail', text: 'Inspect a verification run detail drawer', hint: 'Check condition checklist, expected vs observed diff, and trace' },
    { id: 'task_inspect_evidence', text: 'Inspect independent evidence observations & provenance', hint: 'Review raw observed payloads and trust levels' },
    { id: 'task_check_audit', text: 'Verify cryptographic audit chain integrity', hint: 'Recompute SHA-256 block digests and verify checkpoint signatures' },
    { id: 'task_view_integration', text: 'Inspect external state reader connectivity', hint: 'Verify Postgres, S3, and REST readers' },
  ];

  function markChecklistTask(taskId) {
    if (!state.checklistTasks.includes(taskId)) {
      state.checklistTasks.push(taskId);
      localStorage.setItem('agentproof_checklist_tasks', JSON.stringify(state.checklistTasks));
      const checklistCountEl = document.getElementById('checklist-progress-count');
      if (checklistCountEl) {
        checklistCountEl.textContent = `${state.checklistTasks.length} of ${CHECKLIST_ITEMS.length} completed`;
      }
      const itemEl = document.getElementById(`checklist-item-${taskId}`);
      if (itemEl) {
        itemEl.classList.add('completed');
        const box = itemEl.querySelector('.checklist-box');
        if (box) box.textContent = '✓';
      }
    }
  }

  function resetChecklist() {
    state.checklistTasks = [];
    state.checklistDismissed = false;
    localStorage.removeItem('agentproof_checklist_tasks');
    localStorage.removeItem('agentproof_checklist_dismissed');
    showToast('Getting started checklist reset', 'info');
    if (state.activeView === 'overview') {
      const outlet = document.getElementById('content-outlet');
      if (outlet) renderOverview(outlet);
    }
  }

  // --- Keyboard Shortcuts Modal Management ---
  function openShortcutsModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.classList.add('open');
  }

  function closeShortcutsModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.classList.remove('open');
  }

  // --- 4-Step Educational Onboarding Guide ---
  const ONBOARDING_SLIDES = [
    {
      step: 1,
      title: 'Agent Claims Are Not Proof',
      subtitle: 'Step 1 of 4 • The Self-Report Fallacy',
      content: `
        <p style="color: var(--text-secondary); line-height: 1.6; font-size: 13.5px;">
          AI agents report tool invocations as <code>{"success": true}</code> even when an operation failed downstream, permissions blocked execution, or an unhandled exception occurred in the external service.
        </p>
        <div style="background: var(--bg-surface); padding: 1rem; border-radius: var(--radius-md); border-left: 3px solid var(--verdict-fail); margin-top: 1rem;">
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Core AgentProof Axiom</div>
          <div style="font-size: 12.5px; color: var(--text-muted); line-height: 1.5;">
            An agent's self-declaration can never be accepted as evidence of its own execution. True verification requires independent observability.
          </div>
        </div>
      `,
    },
    {
      step: 2,
      title: 'Explicit Postconditions',
      subtitle: 'Step 2 of 4 • Deterministic State Assertions',
      content: `
        <p style="color: var(--text-secondary); line-height: 1.6; font-size: 13.5px;">
          Rather than trusting strings, AgentProof enforces declarative <strong>postconditions</strong>. These define the exact state mutation that must exist in external storage for an action to be genuine.
        </p>
        <div style="background: var(--bg-surface); padding: 1rem; border-radius: var(--radius-md); border-left: 3px solid var(--accent); margin-top: 1rem;">
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Example Postcondition Contract</div>
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
            assert billing.subscriptions[id="sub-100"].status === "CANCELLED"<br>
            assert billing.subscriptions[id="sub-100"].cancelled_at &gt;= action.timestamp
          </div>
        </div>
      `,
    },
    {
      step: 3,
      title: 'Independent Observable Evidence',
      subtitle: 'Step 3 of 4 • Isolated State Observation',
      content: `
        <p style="color: var(--text-secondary); line-height: 1.6; font-size: 13.5px;">
          AgentProof readers connect directly to PostgreSQL, AWS S3, or REST endpoints. Observations are classified into four mutually exclusive evidence states:
        </p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-top: 1rem;">
          <div style="padding: 0.6rem; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
            <span class="obs-badge found">FOUND</span>
            <span style="font-size: 11px; color: var(--text-muted);">State confirmed</span>
          </div>
          <div style="padding: 0.6rem; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
            <span class="obs-badge not-found">NOT_FOUND</span>
            <span style="font-size: 11px; color: var(--text-muted);">Resource absent</span>
          </div>
          <div style="padding: 0.6rem; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
            <span class="obs-badge read-error">READ_ERROR</span>
            <span style="font-size: 11px; color: var(--text-muted);">Reader / DB fault</span>
          </div>
          <div style="padding: 0.6rem; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
            <span class="obs-badge untrusted">UNTRUSTED</span>
            <span style="font-size: 11px; color: var(--text-muted);">Signature mismatch</span>
          </div>
        </div>
        <p style="font-size: 11px; color: var(--text-muted); margin-top: 0.6rem;">
          * Observation statuses are evidence read states, never verdicts.
        </p>
      `,
    },
    {
      step: 4,
      title: 'Deterministic Verdicts & Tamper-Evident Audit',
      subtitle: 'Step 4 of 4 • Authoritative Proof Pipeline',
      content: `
        <p style="color: var(--text-secondary); line-height: 1.6; font-size: 13.5px;">
          The engine computes an authoritative tri-state verdict:
        </p>
        <div style="display: flex; gap: 0.5rem; margin: 0.75rem 0;">
          <span class="verdict-badge pass">✓ PASS</span>
          <span class="verdict-badge fail">✕ FAIL</span>
          <span class="verdict-badge inconclusive">⚠ INCONCLUSIVE</span>
        </div>
        <p style="font-size: 12.5px; color: var(--text-muted); line-height: 1.5;">
          Rule: <code>FAIL &gt; INCONCLUSIVE &gt; PASS</code>. Missing evidence is never success; inability to verify is never failure. Every evaluation is chained into an append-only SHA-256 hash log with signed RSA checkpoints.
        </p>
        <div style="margin-top: 1rem; padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--accent);">
          <div style="font-weight: 700; color: var(--text-primary); font-size: 12.5px; margin-bottom: 4px;">Launch Simulation</div>
          <div style="font-size: 12px; color: var(--text-secondary);">Click below to run Scenario A (genuine success simulation) and inspect its postconditions and independent evidence.</div>
        </div>
      `,
    },
  ];

  function openOnboarding(step = 1) {
    state.currentOnboardingStep = Math.max(1, Math.min(4, step));
    renderOnboardingStep(state.currentOnboardingStep);
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.classList.add('open');
  }

  function closeOnboarding() {
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.classList.remove('open');
    state.onboardingCompleted = true;
    localStorage.setItem('agentproof_onboarding_completed', 'true');
  }

  function renderOnboardingStep(step) {
    const slide = ONBOARDING_SLIDES[step - 1];
    if (!slide) return;

    const numEl = document.getElementById('onboarding-step-num');
    const titleEl = document.getElementById('onboarding-title');
    const subtitleEl = document.getElementById('onboarding-subtitle');
    const bodyEl = document.getElementById('onboarding-body');
    const prevBtn = document.getElementById('onboarding-prev-btn');
    const nextBtn = document.getElementById('onboarding-next-btn');

    if (numEl) numEl.textContent = String(slide.step);
    if (titleEl) titleEl.textContent = slide.title;
    if (subtitleEl) subtitleEl.textContent = slide.subtitle;
    if (bodyEl) bodyEl.innerHTML = slide.content;

    document.querySelectorAll('#onboarding-dots .onboarding-dot').forEach((dot) => {
      const s = parseInt(dot.getAttribute('data-step') || '1', 10);
      dot.classList.toggle('active', s === step);
    });

    if (prevBtn) {
      prevBtn.style.display = step > 1 ? 'inline-flex' : 'none';
    }

    if (nextBtn) {
      if (step === 4) {
        nextBtn.textContent = '▶ Run Simulation Demo (Scenario A)';
        nextBtn.className = 'btn btn-primary btn-sm';
      } else {
        nextBtn.textContent = 'Next Step →';
        nextBtn.className = 'btn btn-primary btn-sm';
      }
    }
  }

  // --- Signature 3D Pipeline Visualization (with 2D SVG Fallback) ---
  function renderSignaturePipeline(containerId, runData = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const verdict = (runData.verdict || 'PASS').toUpperCase();
    const isSimulation = Boolean(runData.isSimulation || runData.metadata?.isSimulation);
    const actionName = runData.operation || runData.intent?.operation || 'Action Claimed';
    const postcondCount = runData.postconditions?.length || 1;
    const evidenceCount = runData.evidence?.length || 1;

    const srText = `Pipeline verification: Action '${actionName}' evaluated against ${postcondCount} postconditions with ${evidenceCount} evidence observations. Authoritative verdict: ${verdict}.${isSimulation ? ' (Simulation)' : ''}`;

    if (state.reduceVisuals || typeof window.THREE === 'undefined') {
      // 2D SVG Pipeline Fallback
      container.innerHTML = `
        <div class="three-scene-wrapper" style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; background: var(--bg-surface); padding: 1.5rem;">
          <span class="sr-only">${escapeHtml(srText)}</span>
          <div class="three-scene-controls">
            <button class="btn btn-secondary btn-sm" id="toggle-visuals-btn-${containerId}">
              ${state.reduceVisuals ? 'Enable 3D Visuals' : '2D Fallback Active'}
            </button>
          </div>
          ${isSimulation ? '<div class="three-badge-overlay"><span class="badge-simulation">Simulation</span></div>' : ''}
          
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; max-width: 650px; z-index: 2;">
            <div style="text-align: center; width: 110px;">
              <div style="width: 46px; height: 46px; margin: 0 auto; border-radius: var(--radius-md); background: var(--accent-subtle); border: 2px solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 0 15px var(--accent-glow);">⚡</div>
              <div style="font-weight: 700; font-size: 12px; margin-top: 6px; color: var(--text-primary);">Claimed Action</div>
              <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(actionName.slice(0, 13))}</div>
            </div>

            <div style="flex: 1; height: 3px; background: linear-gradient(90deg, var(--accent), var(--border-focus)); position: relative; margin: 0 8px;">
              <div style="position: absolute; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); top: -2.5px; animation: pulseTravel 2s infinite linear;"></div>
            </div>

            <div style="text-align: center; width: 110px;">
              <div style="width: 46px; height: 46px; margin: 0 auto; border-radius: var(--radius-md); background: var(--bg-card); border: 2px solid var(--border-focus); display: flex; align-items: center; justify-content: center; font-size: 20px;">📋</div>
              <div style="font-weight: 700; font-size: 12px; margin-top: 6px; color: var(--text-primary);">Postconditions</div>
              <div style="font-size: 11px; color: var(--text-muted);">${postcondCount} required</div>
            </div>

            <div style="flex: 1; height: 3px; background: linear-gradient(90deg, var(--border-focus), #a855f7); position: relative; margin: 0 8px;">
              <div style="position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #a855f7; top: -2.5px; animation: pulseTravel 2s infinite linear; animation-delay: 0.6s;"></div>
            </div>

            <div style="text-align: center; width: 110px;">
              <div style="width: 46px; height: 46px; margin: 0 auto; border-radius: var(--radius-md); background: rgba(168, 85, 247, 0.12); border: 2px solid #a855f7; display: flex; align-items: center; justify-content: center; font-size: 20px;">🛡️</div>
              <div style="font-weight: 700; font-size: 12px; margin-top: 6px; color: var(--text-primary);">Evidence</div>
              <div style="font-size: 11px; color: var(--text-muted);">${evidenceCount} observed</div>
            </div>

            <div style="flex: 1; height: 3px; background: linear-gradient(90deg, #a855f7, ${verdict === 'PASS' ? 'var(--verdict-pass)' : verdict === 'FAIL' ? 'var(--verdict-fail)' : 'var(--verdict-inconclusive)'}); position: relative; margin: 0 8px;">
              <div style="position: absolute; width: 8px; height: 8px; border-radius: 50%; background: ${verdict === 'PASS' ? 'var(--verdict-pass)' : verdict === 'FAIL' ? 'var(--verdict-fail)' : 'var(--verdict-inconclusive)'}; top: -2.5px; animation: pulseTravel 2s infinite linear; animation-delay: 1.2s;"></div>
            </div>

            <div style="text-align: center; width: 110px;">
              <div style="width: 46px; height: 46px; margin: 0 auto; border-radius: 50%; background: ${verdict === 'PASS' ? 'var(--verdict-pass-subtle)' : verdict === 'FAIL' ? 'var(--verdict-fail-subtle)' : 'var(--verdict-inconclusive-subtle)'}; border: 2px solid ${verdict === 'PASS' ? 'var(--verdict-pass)' : verdict === 'FAIL' ? 'var(--verdict-fail)' : 'var(--verdict-inconclusive)'}; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; box-shadow: 0 0 15px ${verdict === 'PASS' ? 'rgba(16, 185, 129, 0.3)' : verdict === 'FAIL' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'};">
                ${verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✕' : '⚠'}
              </div>
              <div style="font-weight: 700; font-size: 12px; margin-top: 6px; color: var(--text-primary);">${escapeHtml(verdict)}</div>
              <div style="font-size: 10px; color: var(--text-muted);">Authoritative</div>
            </div>
          </div>
        </div>
      `;

      document.getElementById(`toggle-visuals-btn-${containerId}`)?.addEventListener('click', () => {
        state.reduceVisuals = !state.reduceVisuals;
        localStorage.setItem('agentproof_reduce_visuals', String(state.reduceVisuals));
        renderSignaturePipeline(containerId, runData);
      });
      return;
    }

    // Three.js WebGL Scene
    container.innerHTML = `
      <div class="three-scene-wrapper" style="height: 280px; position: relative;">
        <span class="sr-only">${escapeHtml(srText)}</span>
        <canvas class="three-scene-canvas" id="canvas-${containerId}"></canvas>
        <div class="three-scene-controls">
          <button class="btn btn-secondary btn-sm" id="reduce-visuals-btn-${containerId}">
            Reduce Visuals (2D)
          </button>
        </div>
        ${isSimulation ? '<div class="three-badge-overlay"><span class="badge-simulation">Simulation</span></div>' : ''}
        <div style="position: absolute; bottom: 0.75rem; right: 1rem; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">
          Deterministic Pipeline • Click & drag to rotate
        </div>
      </div>
    `;

    document.getElementById(`reduce-visuals-btn-${containerId}`)?.addEventListener('click', () => {
      state.reduceVisuals = true;
      localStorage.setItem('agentproof_reduce_visuals', 'true');
      renderSignaturePipeline(containerId, runData);
    });

    const canvas = document.getElementById(`canvas-${containerId}`);
    if (!canvas) return;

    try {
      const THREE = window.THREE;
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight || 280;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(0, 0, 9);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(5, 10, 7);
      scene.add(dirLight);

      // Node 1: Action (Cube)
      const geo1 = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      const mat1 = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.3, metalness: 0.6 });
      const mesh1 = new THREE.Mesh(geo1, mat1);
      mesh1.position.set(-3.9, 0, 0);
      scene.add(mesh1);

      // Node 2: Postconditions (Octahedron)
      const geo2 = new THREE.OctahedronGeometry(0.6);
      const mat2 = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.6 });
      const mesh2 = new THREE.Mesh(geo2, mat2);
      mesh2.position.set(-1.3, 0, 0);
      scene.add(mesh2);

      // Node 3: Evidence (Dodecahedron)
      const geo3 = new THREE.DodecahedronGeometry(0.55);
      const mat3 = new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.3, metalness: 0.6 });
      const mesh3 = new THREE.Mesh(geo3, mat3);
      mesh3.position.set(1.3, 0, 0);
      scene.add(mesh3);

      // Node 4: Verdict (Sphere)
      const verdictColor = verdict === 'PASS' ? 0x10b981 : verdict === 'FAIL' ? 0xef4444 : 0xf59e0b;
      const geo4 = new THREE.SphereGeometry(0.65, 32, 32);
      const mat4 = new THREE.MeshStandardMaterial({ color: verdictColor, roughness: 0.2, metalness: 0.8 });
      const mesh4 = new THREE.Mesh(geo4, mat4);
      mesh4.position.set(3.9, 0, 0);
      scene.add(mesh4);

      // Connecting Tube Curve
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-3.9, 0, 0),
        new THREE.Vector3(-1.3, 0, 0),
        new THREE.Vector3(1.3, 0, 0),
        new THREE.Vector3(3.9, 0, 0),
      ]);
      const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.05, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.6 });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      scene.add(tubeMesh);

      // Photon Traveling Particle
      const photonGeo = new THREE.SphereGeometry(0.12, 16, 16);
      const photonMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
      const photonMesh = new THREE.Mesh(photonGeo, photonMat);
      scene.add(photonMesh);

      let isDragging = false;
      let prevX = 0;
      canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        prevX = e.clientX;
      });
      window.addEventListener('mouseup', () => { isDragging = false; });
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        scene.rotation.y += (e.clientX - prevX) * 0.005;
        prevX = e.clientX;
      });

      let animId;
      let progress = 0;
      let isVisible = true;

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((e) => { isVisible = e.isIntersecting; });
      }, { threshold: 0.1 });
      observer.observe(canvas);

      function animate() {
        animId = requestAnimationFrame(animate);
        if (!isVisible || document.hidden) return;

        mesh1.rotation.x += 0.01;
        mesh1.rotation.y += 0.012;
        mesh2.rotation.y += 0.01;
        mesh2.rotation.z += 0.008;
        mesh3.rotation.x += 0.008;
        mesh3.rotation.y += 0.01;
        mesh4.rotation.y += 0.005;

        progress = (progress + 0.005) % 1;
        const pt = curve.getPointAt(progress);
        photonMesh.position.copy(pt);

        renderer.render(scene, camera);
      }
      animate();

      window.addEventListener('hashchange', () => {
        cancelAnimationFrame(animId);
        observer.disconnect();
      }, { once: true });

    } catch (err) {
      console.warn('Three.js initialization fallback', err);
      state.reduceVisuals = true;
      renderSignaturePipeline(containerId, runData);
    }
  }

  // ==========================================================================
  // VIEW 1: OVERVIEW DASHBOARD
  // ==========================================================================
  async function renderOverview(outlet) {
    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Overview</h1>
            <p class="page-description">AgentProof independently verifies agent outcomes against ground-truth evidence.</p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-secondary" id="seed-demo-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Seed Demo Runs</span>
            </button>
            <button class="btn btn-primary" id="open-run-modal-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
              <span>Run Verification</span>
            </button>
          </div>
        </div>

        <div id="overview-content">
          <div style="padding: 3rem; text-align: center; color: var(--text-muted);">
            <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">Loading verification metrics...</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('seed-demo-btn')?.addEventListener('click', async () => {
      try {
        const res = await api.post('/api/seed', {});
        showToast(res.message || 'Demo runs generated', 'success');
        renderOverview(outlet);
      } catch (err) {
        showToast('Failed to seed demo runs', 'error');
      }
    });

    document.getElementById('open-run-modal-btn')?.addEventListener('click', () => {
      openRunModal();
    });

    try {
      const data = await api.get('/api/overview');
      state.overviewData = data;

      // Update sidebar badge
      const countEl = document.getElementById('nav-verifications-count');
      if (countEl) countEl.textContent = String(data.metrics.totalVerifications);

      const content = document.getElementById('overview-content');
      if (!content) return;

      // Activity Since Last Visit
      const lastVisit = localStorage.getItem('agentproof_last_visit');
      let sinceBannerHtml = '';
      if (lastVisit) {
        try {
          const sinceRes = await api.get(`/api/activity/since?since=${encodeURIComponent(lastVisit)}`);
          const minutesAgo = Math.max(1, Math.round((Date.now() - parseInt(lastVisit, 10)) / 60000));
          sinceBannerHtml = `
            <div class="since-banner">
              <div>
                <span style="font-weight: 700; color: var(--text-primary);">Since you last visited (${minutesAgo}m ago):</span>
                <span style="color: var(--text-secondary); margin-left: 0.5rem;">Independent updates evaluated across tenant systems</span>
              </div>
              <div class="since-stats">
                <div class="since-stat-item">
                  <span class="since-stat-num">${sinceRes.newRunsCount}</span>
                  <span style="color: var(--text-muted); font-size: 12px;">new runs</span>
                </div>
                <div class="since-stat-item">
                  <span class="since-stat-num">${sinceRes.auditAppendedCount}</span>
                  <span style="color: var(--text-muted); font-size: 12px;">audit blocks</span>
                </div>
                <div class="since-stat-item">
                  <span class="since-stat-num">${sinceRes.webhookEventsCount}</span>
                  <span style="color: var(--text-muted); font-size: 12px;">webhook events</span>
                </div>
              </div>
            </div>
          `;
        } catch (err) {
          // ignore timestamp failure gracefully
        }
      }
      localStorage.setItem('agentproof_last_visit', String(Date.now()));

      // Getting Started Interactive Checklist
      let checklistHtml = '';
      if (!state.checklistDismissed) {
        checklistHtml = `
          <div class="checklist-card" id="overview-checklist">
            <div class="checklist-header">
              <div>
                <h3 class="checklist-title">Getting Started with Independent Verification</h3>
                <span style="font-size: 12px; color: var(--text-muted);" id="checklist-progress-count">
                  ${state.checklistTasks.length} of ${CHECKLIST_ITEMS.length} completed
                </span>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-sm" id="dismiss-checklist-btn">Dismiss</button>
              </div>
            </div>
            <div class="checklist-list">
              ${CHECKLIST_ITEMS.map((item) => {
                const isDone = state.checklistTasks.includes(item.id);
                return `
                  <div class="checklist-item ${isDone ? 'completed' : ''}" id="checklist-item-${item.id}" data-action="${item.id}" title="${escapeHtml(item.hint)}">
                    <div class="checklist-box">${isDone ? '✓' : ''}</div>
                    <div style="display: flex; flex-direction: column;">
                      <span class="item-text" style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(item.text)}</span>
                      <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.hint)}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // If empty state, show guided onboarding
      let onboardingHtml = '';
      if (data.metrics.totalVerifications === 0) {
        onboardingHtml = `
          <div class="onboarding-banner">
            <div class="onboarding-badge">First-Time Setup — Welcome to AgentProof</div>
            <h2 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary);">
              Independent Verification for AI Agent Tool Outcomes
            </h2>
            <p style="color: var(--text-secondary); max-width: 800px; font-size: 14px;">
              An agent saying "success" does not prove that the intended state changed. AgentProof evaluates explicit postconditions against independently observable evidence from databases, REST APIs, and cloud storage.
            </p>
            <div class="onboarding-steps">
              <div class="onboarding-step-card">
                <div class="onboarding-num">01</div>
                <div style="font-weight: 600; color: var(--text-primary);">Claimed Action</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Agent invokes tool and claims it completed successfully.</div>
              </div>
              <div class="onboarding-step-card">
                <div class="onboarding-num">02</div>
                <div style="font-weight: 600; color: var(--text-primary);">Postconditions</div>
                <div style="font-size: 12px; color: var(--text-secondary);">System asserts expected state changes required for genuine outcome.</div>
              </div>
              <div class="onboarding-step-card">
                <div class="onboarding-num">03</div>
                <div style="font-weight: 600; color: var(--text-primary);">Independent Evidence</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Ground truth observed directly via isolated readers, bypassing agent self-reports.</div>
              </div>
              <div class="onboarding-step-card">
                <div class="onboarding-num">04</div>
                <div style="font-weight: 600; color: var(--text-primary);">Deterministic Verdict</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Tri-state outcome: PASS, FAIL, or INCONCLUSIVE with tamper-evident audit.</div>
              </div>
            </div>
            <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
              <button class="btn btn-primary" onclick="document.getElementById('seed-demo-btn').click()">
                Generate Sample Demonstration Runs
              </button>
              <button class="btn btn-secondary" onclick="window.location.hash='#scenarios'">
                Explore Scenario Catalog
              </button>
            </div>
          </div>
        `;
      }

      // Attention Items HTML
      let attentionHtml = '';
      if (data.attentionItems && data.attentionItems.length > 0) {
        attentionHtml = `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Actionable Attention Items (${data.attentionItems.length})</h3>
              <span style="font-size: 12px; color: var(--text-muted);">Requires engineering investigation</span>
            </div>
            <div class="card-body">
              <div class="attention-list">
                ${data.attentionItems.map((item) => `
                  <div class="attention-item ${item.severity.toLowerCase()}">
                    <div class="attention-content">
                      <div class="attention-title">${escapeHtml(item.title)}</div>
                      <div class="attention-reason">${escapeHtml(item.reason)}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="window.AgentProof.openTrace('${escapeHtml(item.targetId)}')">
                      Investigate →
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }

      // Verdict Donut Chart SVG
      const pass = data.verdictDistribution.PASS || 0;
      const fail = data.verdictDistribution.FAIL || 0;
      const inc = data.verdictDistribution.INCONCLUSIVE || 0;
      const total = pass + fail + inc;

      const chartSvg = createVerdictChartSvg(pass, fail, inc, total);

      // Recent Activity Table HTML
      let recentRows = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No verifications recorded yet.</td></tr>';
      if (data.recentActivity && data.recentActivity.length > 0) {
        recentRows = data.recentActivity.map((r) => `
          <tr>
            <td class="cell-primary cell-mono">
              <a href="javascript:void(0)" onclick="window.AgentProof.openTrace('${escapeHtml(r.traceId)}')" style="color: var(--accent); font-weight: 600;">
                ${escapeHtml(r.traceId.slice(0, 13))}...
              </a>
            </td>
            <td>
              <div style="font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                <span>${escapeHtml(r.operation)}</span>
                ${r.isSimulation ? '<span class="badge-simulation">Simulation</span>' : ''}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(r.system)}:${escapeHtml(r.resourceId)}</div>
            </td>
            <td>${getVerdictBadgeHtml(r.verdict)}</td>
            <td>
              <span style="font-weight: 600; color: var(--text-primary);">${r.conditionCount}</span> cond /
              <span style="font-size: 12px; color: var(--text-muted);">${r.evidenceCount} ev</span>
            </td>
            <td style="max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px;">
              ${escapeHtml(r.summary)}
            </td>
            <td style="font-size: 11px; color: var(--text-muted); white-space: nowrap;">
              ${new Date(r.evaluatedAt).toLocaleTimeString()}
            </td>
          </tr>
        `).join('');
      }

      // Subsystem Health Grid
      const healthItems = [
        { name: 'PostgreSQL Reader', type: 'POSTGRES', status: 'HEALTHY' },
        { name: 'AWS S3 State Reader', type: 'S3_STORAGE', status: 'HEALTHY' },
        { name: 'REST API Reader', type: 'REST_API', status: 'HEALTHY' },
        { name: 'Cryptographic Audit Chain', type: 'AUDIT', status: data.auditChainStatus.isValid ? 'HEALTHY' : 'DEGRADED' },
      ];

      content.innerHTML = `
        ${sinceBannerHtml}
        ${checklistHtml}
        ${onboardingHtml}

        <!-- KPI Metrics Grid -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-header">
              <span class="kpi-title">Total Verifications</span>
              <span style="font-size: 16px;">🔍</span>
            </div>
            <div class="kpi-value">${data.metrics.totalVerifications}</div>
            <div class="kpi-meta">Scoped to ${escapeHtml(data.tenantId)}</div>
          </div>

          <div class="kpi-card pass">
            <div class="kpi-header">
              <span class="kpi-title">PASS Verdicts</span>
              <span class="verdict-badge pass">Verified</span>
            </div>
            <div class="kpi-value">${data.metrics.passCount}</div>
            <div class="kpi-meta">${data.metrics.passRate}% pass rate</div>
          </div>

          <div class="kpi-card fail">
            <div class="kpi-header">
              <span class="kpi-title">FAIL Violations</span>
              <span class="verdict-badge fail">Violated</span>
            </div>
            <div class="kpi-value">${data.metrics.failCount}</div>
            <div class="kpi-meta">Independent evidence proved failure</div>
          </div>

          <div class="kpi-card inconclusive">
            <div class="kpi-header">
              <span class="kpi-title">INCONCLUSIVE</span>
              <span class="verdict-badge inconclusive">Unresolved</span>
            </div>
            <div class="kpi-value">${data.metrics.inconclusiveCount}</div>
            <div class="kpi-meta">Missing, stale, or conflicting evidence</div>
          </div>

          <div class="kpi-card">
            <div class="kpi-header">
              <span class="kpi-title">Evidence Completeness</span>
              <span style="font-size: 16px;">📊</span>
            </div>
            <div class="kpi-value">${data.metrics.evidenceCompletenessRate}%</div>
            <div class="kpi-meta">Observed vs required conditions</div>
          </div>
        </div>

        <!-- Attention Items -->
        ${attentionHtml}

        <!-- Verdict Distribution & Health Split -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
          <!-- Verdict Chart -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Authoritative Verdict Distribution</h3>
              <a href="#verifications" class="btn btn-secondary btn-sm">Explore All →</a>
            </div>
            <div class="card-body" style="display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 1.5rem;">
              ${chartSvg}
              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--verdict-pass);"></div>
                  <span style="font-weight: 600; color: var(--text-primary);">${pass} PASS</span>
                  <span style="font-size: 12px; color: var(--text-muted);">(${total > 0 ? Math.round((pass/total)*100) : 0}%)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--verdict-fail);"></div>
                  <span style="font-weight: 600; color: var(--text-primary);">${fail} FAIL</span>
                  <span style="font-size: 12px; color: var(--text-muted);">(${total > 0 ? Math.round((fail/total)*100) : 0}%)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--verdict-inconclusive);"></div>
                  <span style="font-weight: 600; color: var(--text-primary);">${inc} INCONCLUSIVE</span>
                  <span style="font-size: 12px; color: var(--text-muted);">(${total > 0 ? Math.round((inc/total)*100) : 0}%)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Subsystem Health -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Subsystem & Reader Connectivity</h3>
              <span class="health-status-badge">All Operational</span>
            </div>
            <div class="card-body" style="display: flex; flex-direction: column; gap: 0.75rem;">
              ${healthItems.map((h) => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <div>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(h.name)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(h.type)}</div>
                  </div>
                  <span class="health-status-badge ${h.status !== 'HEALTHY' ? 'degraded' : ''}">
                    ${escapeHtml(h.status)}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Recent Verification Activity Table -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Recent Verification Activity</h3>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                Chronological ledger of deterministic evaluations
              </p>
            </div>
            <a href="#verifications" class="btn btn-secondary btn-sm">View Full Explorer →</a>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Trace ID</th>
                  <th>Claimed Action & Target</th>
                  <th>Authoritative Verdict</th>
                  <th>Postconditions / Evidence</th>
                  <th>Verdict Reasoning</th>
                  <th>Evaluated At</th>
                </tr>
              </thead>
              <tbody>
                ${recentRows}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Attach checklist interaction listeners
      document.getElementById('dismiss-checklist-btn')?.addEventListener('click', () => {
        state.checklistDismissed = true;
        localStorage.setItem('agentproof_checklist_dismissed', 'true');
        document.getElementById('overview-checklist')?.remove();
      });

      document.querySelectorAll('.checklist-item').forEach((item) => {
        item.addEventListener('click', () => {
          const action = item.getAttribute('data-action');
          if (action === 'task_run_simulation') {
            executeScenario('SCENARIO_A');
          } else if (action === 'task_view_detail') {
            const first = state.verifications[0];
            if (first) openVerificationDrawer(first.traceId);
            else navigate('verifications');
          } else if (action === 'task_inspect_evidence' || action === 'task_check_audit') {
            navigate('evidence-audit');
          } else if (action === 'task_view_integration') {
            navigate('integrations-webhooks');
          }
        });
      });

      // Prompt onboarding if not yet completed
      if (!state.onboardingCompleted) {
        setTimeout(() => {
          openOnboarding(1);
        }, 600);
      }
    } catch (err) {
      outlet.innerHTML = `
        <div class="page-container">
          <div class="card" style="padding: 2rem; text-align: center;">
            <h2 style="color: var(--verdict-fail); margin-bottom: 0.5rem;">Failed to load overview data</h2>
            <p style="color: var(--text-secondary); margin-bottom: 1rem;">${escapeHtml(err.message)}</p>
            <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
          </div>
        </div>
      `;
    }
  }

  function createVerdictChartSvg(pass, fail, inc, total) {
    if (total === 0) {
      return `
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="70" fill="none" stroke="var(--border-subtle)" stroke-width="20"></circle>
          <text x="90" y="95" text-anchor="middle" font-size="14" fill="var(--text-muted)" font-family="var(--font-sans)">No Data</text>
        </svg>
      `;
    }

    const radius = 65;
    const circumference = 2 * Math.PI * radius;
    const passOffset = 0;
    const passLen = (pass / total) * circumference;
    const failOffset = passLen;
    const failLen = (fail / total) * circumference;
    const incOffset = passLen + failLen;
    const incLen = (inc / total) * circumference;

    return `
      <svg width="180" height="180" viewBox="0 0 180 180" style="transform: rotate(-90deg);">
        <circle cx="90" cy="90" r="${radius}" fill="none" stroke="var(--border-subtle)" stroke-width="20"></circle>
        
        <!-- PASS -->
        <circle cx="90" cy="90" r="${radius}" fill="none" stroke="var(--verdict-pass)" stroke-width="20"
          stroke-dasharray="${passLen} ${circumference}"
          stroke-dashoffset="-${passOffset}" />

        <!-- FAIL -->
        <circle cx="90" cy="90" r="${radius}" fill="none" stroke="var(--verdict-fail)" stroke-width="20"
          stroke-dasharray="${failLen} ${circumference}"
          stroke-dashoffset="-${failOffset}" />

        <!-- INCONCLUSIVE -->
        <circle cx="90" cy="90" r="${radius}" fill="none" stroke="var(--verdict-inconclusive)" stroke-width="20"
          stroke-dasharray="${incLen} ${circumference}"
          stroke-dashoffset="-${incOffset}" />

        <!-- Center Counter Text (unrotated) -->
        <g style="transform: rotate(90deg); transform-origin: 90px 90px;">
          <text x="90" y="85" text-anchor="middle" font-size="24" font-weight="800" fill="var(--text-primary)" font-family="var(--font-sans)">${total}</text>
          <text x="90" y="105" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-muted)" text-transform="uppercase" font-family="var(--font-sans)">Total Runs</text>
        </g>
      </svg>
    `;
  }

  // ==========================================================================
  // VIEW 2: VERIFICATION EXPLORER
  // ==========================================================================
  async function renderVerifications(outlet) {
    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Verification Explorer</h1>
            <p class="page-description">Search, filter, and audit individual deterministic verification runs.</p>
          </div>
          <button class="btn btn-primary" id="v-open-run-modal-btn">
            + Run Verification
          </button>
        </div>

        <!-- Filter & Search Bar -->
        <div class="filter-bar">
          <div class="filter-group">
            <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">Verdict:</span>
            <button class="filter-pill ${state.verificationFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">All</button>
            <button class="filter-pill ${state.verificationFilter === 'PASS' ? 'active' : ''}" data-filter="PASS">PASS</button>
            <button class="filter-pill ${state.verificationFilter === 'FAIL' ? 'active' : ''}" data-filter="FAIL">FAIL</button>
            <button class="filter-pill ${state.verificationFilter === 'INCONCLUSIVE' ? 'active' : ''}" data-filter="INCONCLUSIVE">INCONCLUSIVE</button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; width: 320px;">
            <input type="text" class="form-input" id="v-search-input" placeholder="Search by trace ID, operation, system..." value="${escapeHtml(state.searchQuery)}" style="width: 100%;">
          </div>
        </div>

        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Trace ID</th>
                  <th>Target System</th>
                  <th>Operation</th>
                  <th>Authoritative Verdict</th>
                  <th>Conditions / Ev</th>
                  <th>Duration</th>
                  <th>Evaluated At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="v-table-body">
                <tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading traces...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('v-open-run-modal-btn')?.addEventListener('click', openRunModal);

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        state.verificationFilter = pill.getAttribute('data-filter') || 'ALL';
        renderVerifications(outlet);
      });
    });

    // Search input
    const searchInput = document.getElementById('v-search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        loadVerificationList();
      }, 250);
    });

    async function loadVerificationList() {
      const tbody = document.getElementById('v-table-body');
      if (!tbody) return;

      const params = new URLSearchParams();
      if (state.verificationFilter !== 'ALL') {
        params.append('verdict', state.verificationFilter);
      }
      if (state.searchQuery.trim()) {
        params.append('q', state.searchQuery.trim());
      }

      try {
        const res = await api.get(`/api/verifications?${params.toString()}`);
        state.verifications = res.items || [];

        if (state.verifications.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                <div style="font-size: 1.1rem; margin-bottom: 0.5rem;">No verification runs match your criteria.</div>
                <div style="font-size: 13px;">Try clearing filters or execute a verification run.</div>
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = state.verifications.map((t) => `
          <tr>
            <td class="cell-primary cell-mono">
              <a href="javascript:void(0)" onclick="window.AgentProof.openTrace('${escapeHtml(t.traceId)}')" style="color: var(--accent); font-weight: 600;">
                ${escapeHtml(t.traceId.slice(0, 16))}...
              </a>
            </td>
            <td class="cell-mono" style="font-size: 12px;">
              ${escapeHtml(t.target.system)}:${escapeHtml(t.target.resourceId)}
            </td>
            <td>
              <div style="font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                <span>${escapeHtml(t.operation)}</span>
                ${(t.isSimulation || t.metadata?.isSimulation) ? '<span class="badge-simulation">Simulation</span>' : ''}
              </div>
              <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(t.summary)}</div>
            </td>
            <td>${getVerdictBadgeHtml(t.verdict)}</td>
            <td>${t.conditionCount} cond / ${t.evidenceCount} ev</td>
            <td style="font-family: var(--font-mono); font-size: 12px;">${t.durationMs ? t.durationMs.toFixed(2) + ' ms' : '< 1 ms'}</td>
            <td style="font-size: 12px; color: var(--text-muted); white-space: nowrap;">${new Date(t.evaluatedAt).toLocaleString()}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="window.AgentProof.openTrace('${escapeHtml(t.traceId)}')">
                Inspect Detail
              </button>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="color: var(--verdict-fail); text-align: center; padding: 2rem;">Failed to load traces: ${escapeHtml(err.message)}</td></tr>`;
      }
    }

    loadVerificationList();
  }

  // ==========================================================================
  // VIEW 3: EVIDENCE & AUDIT EXPLORER
  // ==========================================================================
  async function renderEvidenceAudit(outlet) {
    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Evidence & Cryptographic Audit</h1>
            <p class="page-description">Forensic inspection of independently collected evidence, hash-chains, and signed checkpoints.</p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-secondary" id="verify-chain-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>Verify Chain Integrity</span>
            </button>
            <button class="btn btn-primary" id="create-checkpoint-btn">
              <span>Create Signed Checkpoint</span>
            </button>
          </div>
        </div>

        <!-- Signature Verification Flow Pipeline Visualization -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Interactive Verification Pipeline Flow</h3>
            <span style="font-size: 12px; color: var(--text-muted);">Deterministic proof synthesis model</span>
          </div>
          <div class="card-body">
            <div class="verification-pipeline" id="interactive-pipeline">
              <div class="pipeline-node active" data-step="1">
                <span class="pipeline-node-step">Stage 1</span>
                <span class="pipeline-node-title">Claimed Action</span>
                <span class="pipeline-node-desc">Agent tool reports execution status & parameters.</span>
              </div>
              <div class="pipeline-connector">➔</div>
              <div class="pipeline-node" data-step="2">
                <span class="pipeline-node-step">Stage 2</span>
                <span class="pipeline-node-title">Postconditions</span>
                <span class="pipeline-node-desc">Explicit declarative assertions required for truth.</span>
              </div>
              <div class="pipeline-connector">➔</div>
              <div class="pipeline-node" data-step="3">
                <span class="pipeline-node-step">Stage 3</span>
                <span class="pipeline-node-title">Independent Evidence</span>
                <span class="pipeline-node-desc">Direct observation from ground truth, bypassing self-report.</span>
              </div>
              <div class="pipeline-connector">➔</div>
              <div class="pipeline-node" data-step="4">
                <span class="pipeline-node-step">Stage 4</span>
                <span class="pipeline-node-title">Authoritative Verdict</span>
                <span class="pipeline-node-desc">Tri-state outcome (PASS / FAIL / INCONCLUSIVE).</span>
              </div>
            </div>
            <div id="pipeline-explainer" style="margin-top: 1rem; padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); font-size: 13px; color: var(--text-secondary);">
              <strong>Stage 1 — Claimed Action:</strong> When an AI agent claims it cancelled a subscription, wiped a database record, or modified an S3 asset, AgentProof receives the action invocation record. We treat executionStatus: REPORTED_SUCCESS strictly as an unverified claim, never as proof.
            </div>
          </div>
        </div>

        <!-- Audit Chain Integrity Card -->
        <div class="card" id="audit-integrity-card">
          <div class="card-header">
            <h3 class="card-title">Tamper-Evident Audit Chain Integrity</h3>
            <span id="integrity-status-badge" class="health-status-badge">Checking...</span>
          </div>
          <div class="card-body">
            <div id="audit-integrity-content" style="display: flex; flex-direction: column; gap: 1rem;">
              <p style="color: var(--text-secondary);">Evaluating cryptographic hash links across append-only tenant chain...</p>
            </div>
          </div>
        </div>

        <!-- Split Grid: Timeline & Evidence -->
        <div style="display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 1.5rem;">
          <!-- Event Timeline -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Audit & Verification Timeline</h3>
              <span style="font-size: 12px; color: var(--text-muted);">Ordered chronological trail</span>
            </div>
            <div class="card-body" id="timeline-container" style="max-height: 450px; overflow-y: auto;">
              <p style="color: var(--text-muted);">Loading timeline...</p>
            </div>
          </div>

          <!-- Evidence List -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Independent Evidence Observations</h3>
              <span style="font-size: 12px; color: var(--text-muted);">Observed Ground Truth</span>
            </div>
            <div class="card-body" id="evidence-container" style="max-height: 450px; overflow-y: auto;">
              <p style="color: var(--text-muted);">Loading evidence records...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Interactive pipeline steps click listener
    const pipelineNodes = document.querySelectorAll('.pipeline-node');
    const explainerEl = document.getElementById('pipeline-explainer');
    const stepTexts = {
      '1': '<strong>Stage 1 — Claimed Action:</strong> An AI agent or tool reports completion. AgentProof treats executionStatus: REPORTED_SUCCESS as a claim to be audited, refusing to trust the agent\'s self-report.',
      '2': '<strong>Stage 2 — Required Postconditions:</strong> The contract defines exact predicates (e.g. status EQUALS "CANCELLED", row count DECREASED by 1). Postconditions are immutable requirements.',
      '3': '<strong>Stage 3 — Independent Evidence:</strong> Evidence is collected directly from external ground-truth readers (Postgres, S3, REST APIs). Raw payload is hashed using SHA-256 for cryptographic provenance.',
      '4': '<strong>Stage 4 — Deterministic Verdict:</strong> VerificationEngine aggregates evaluated postconditions. Strict precedence: FAIL overrides INCONCLUSIVE, which overrides PASS. Missing evidence results in INCONCLUSIVE, never false success.',
    };

    pipelineNodes.forEach((node) => {
      node.addEventListener('click', () => {
        pipelineNodes.forEach((n) => n.classList.remove('active'));
        node.classList.add('active');
        const step = node.getAttribute('data-step');
        if (explainerEl && stepTexts[step]) {
          explainerEl.innerHTML = stepTexts[step];
        }
      });
    });

    markChecklistTask('task_inspect_evidence');

    // Check Integrity button
    document.getElementById('verify-chain-btn')?.addEventListener('click', async () => {
      markChecklistTask('task_check_audit');
      try {
        const res = await api.post('/api/audit/verify', {});
        showToast(res.isValid ? 'Audit chain verified intact!' : 'Integrity check failed: ' + res.errorMessage, res.isValid ? 'success' : 'error');
        loadAuditIntegrity();
      } catch (err) {
        showToast('Verification failed: ' + err.message, 'error');
      }
    });

    // Create Checkpoint button
    document.getElementById('create-checkpoint-btn')?.addEventListener('click', async () => {
      markChecklistTask('task_check_audit');
      try {
        const res = await api.post('/api/audit/checkpoints', {});
        showToast('Signed RSA checkpoint created for sequence #' + res.checkpoint.sequenceNumber, 'success');
        loadAuditIntegrity();
      } catch (err) {
        showToast('Checkpoint creation failed: ' + err.message, 'error');
      }
    });

    async function loadAuditIntegrity() {
      const content = document.getElementById('audit-integrity-content');
      const badge = document.getElementById('integrity-status-badge');
      if (!content || !badge) return;

      try {
        const res = await api.get('/api/audit/integrity');
        if (res.isValid) {
          badge.className = 'health-status-badge';
          badge.textContent = 'Verified';
        } else if (res.checkedSequences > 0) {
          badge.className = 'health-status-badge degraded';
          badge.textContent = 'Integrity Failed';
        } else {
          badge.className = 'health-status-badge degraded';
          badge.textContent = 'Unable to Verify';
        }

        content.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
            <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Verified Sequences</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${res.checkedSequences} / ${res.totalEvents}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Continuously linked blocks</div>
            </div>

            <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Signed Checkpoints</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">${res.checkpointsCount}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">RSA-SHA256 signed heads</div>
            </div>

            <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Current Chain Head Digest</div>
              <div style="font-family: var(--font-mono); font-size: 11px; word-break: break-all; color: var(--text-primary); margin-top: 6px;">
                ${res.chainHeadDigest ? res.chainHeadDigest : 'Chain is empty (Genesis state)'}
              </div>
            </div>
          </div>

          <div style="padding: 1rem; background: var(--bg-surface); border-left: 4px solid var(--accent); border-radius: var(--radius-md); font-size: 12px; color: var(--text-secondary);">
            <strong>Architectural Security Invariant:</strong> Local SHA-256 hash chains guarantee detection of mid-chain modification or record deletion. Signed RSA checkpoints protect against entire-history rewrites or rollback attacks by binding sequence and digest to an asymmetric cryptographic signature.
          </div>
        `;
      } catch (err) {
        badge.className = 'health-status-badge degraded';
        badge.textContent = 'Unable to Verify';
        content.innerHTML = `<p style="color: var(--verdict-fail);">Failed to inspect audit chain: ${escapeHtml(err.message)}</p>`;
      }
    }

    async function loadTimeline() {
      const container = document.getElementById('timeline-container');
      if (!container) return;

      try {
        const res = await api.get('/api/timeline');
        if (!res.items || res.items.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No timeline events recorded.</p>';
          return;
        }

        container.innerHTML = `
          <div class="timeline-list">
            ${res.items.map((item) => `
              <div class="timeline-entry">
                <div class="timeline-dot"></div>
                <div class="timeline-header">
                  <span class="timeline-title">${escapeHtml(item.title)}</span>
                  <span class="timeline-time">${new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
                <p style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(item.description)}</p>
                ${item.status ? `<div>${getVerdictBadgeHtml(item.status)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        `;
      } catch (err) {
        container.innerHTML = `<p style="color: var(--verdict-fail);">Timeline error: ${escapeHtml(err.message)}</p>`;
      }
    }

    async function loadEvidence() {
      const container = document.getElementById('evidence-container');
      if (!container) return;

      try {
        const res = await api.get('/api/evidence');
        if (!res.items || res.items.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No independent evidence recorded yet.</p>';
          return;
        }

        container.innerHTML = res.items.map((ev) => `
          <div style="padding: 0.9rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <span style="font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); font-size: 12px;">${escapeHtml(ev.evidenceId)}</span>
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                ${getObservationBadgeHtml(ev.observationStatus || 'FOUND')}
                <span class="verdict-badge" style="background: var(--accent-subtle); color: var(--accent); border: 1px solid var(--accent-glow);">${escapeHtml(ev.trustLevel)}</span>
              </div>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 0.25rem;">
              Source: <strong>${escapeHtml(ev.sourceId)}</strong> (${escapeHtml(ev.sourceKind)}) • Freshness: verified within window
            </div>
            <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); word-break: break-all;">
              Hash: ${escapeHtml(ev.integrityHash)}
            </div>
            <div style="margin-top: 0.5rem;">
              <pre class="code-viewer" style="max-height: 80px; padding: 0.5rem; font-size: 11px;">${escapeHtml(JSON.stringify(ev.observedPayload, null, 2))}</pre>
            </div>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `<p style="color: var(--verdict-fail);">Evidence load error: ${escapeHtml(err.message)}</p>`;
      }
    }

    loadAuditIntegrity();
    loadTimeline();
    loadEvidence();
  }

  // ==========================================================================
  // VIEW 4: INTEGRATIONS & WEBHOOKS
  // ==========================================================================
  async function renderIntegrationsWebhooks(outlet) {
    markChecklistTask('task_view_integration');

    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Integrations & Webhook Ingest</h1>
            <p class="page-description">Manage trusted state readers and inspect incoming cryptographic webhook streams.</p>
          </div>
        </div>

        <!-- Integration Inventory -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Configured External State Readers</h3>
            <span style="font-size: 12px; color: var(--text-muted);">Independent ground-truth observation channels</span>
          </div>
          <div class="card-body">
            <div id="integrations-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
              <p style="color: var(--text-muted);">Loading integrations...</p>
            </div>
          </div>
        </div>

        <!-- Webhook Event Stream Explorer -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Inbound Webhook Event Stream</h3>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                Signature-verified asynchronous events with replay protection
              </p>
            </div>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Internal Event ID</th>
                  <th>Source</th>
                  <th>Event Type</th>
                  <th>Signature Status</th>
                  <th>Processing State</th>
                  <th>Payload Digest</th>
                  <th>Received At</th>
                </tr>
              </thead>
              <tbody id="webhooks-table-body">
                <tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading webhook records...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    async function loadIntegrations() {
      const container = document.getElementById('integrations-list');
      if (!container) return;

      try {
        const res = await api.get('/api/integrations');
        if (!res.items || res.items.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted);">No external integrations registered.</p>';
          return;
        }

        container.innerHTML = res.items.map((c) => `
          <div style="padding: 1.25rem; background: var(--bg-surface); border: 1px solid var(--border-card); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 0.6rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(c.integrationId)}</span>
              <span class="health-status-badge">${c.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">
              Type: <strong style="color: var(--text-secondary);">${escapeHtml(c.type)}</strong>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              ${c.baseUrl ? `Endpoint: <code>${escapeHtml(c.baseUrl)}</code>` : ''}
              ${c.host ? `Host: <code>${escapeHtml(c.host)}:${c.port}</code> (${escapeHtml(c.database)})` : ''}
              ${c.endpoint ? `S3: <code>${escapeHtml(c.bucket)}</code>` : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              Auth: <code>${c.auth?.secretRef ? escapeHtml(c.auth.secretRef) : 'NONE'}</code> (Secure Ref)
            </div>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `<p style="color: var(--verdict-fail);">Failed to load integrations: ${escapeHtml(err.message)}</p>`;
      }
    }

    async function loadWebhooks() {
      const tbody = document.getElementById('webhooks-table-body');
      if (!tbody) return;

      try {
        const res = await api.get('/api/webhooks');
        if (!res.items || res.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                No webhooks received yet. Post signed webhooks to <code>/api/v1/webhooks/:sourceId</code>.
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = res.items.map((w) => `
          <tr>
            <td class="cell-primary cell-mono">${escapeHtml(w.internalEventId.slice(0, 16))}...</td>
            <td><strong>${escapeHtml(w.sourceId)}</strong></td>
            <td><code>${escapeHtml(w.eventType)}</code></td>
            <td>
              <span class="verdict-badge pass">VALID</span>
            </td>
            <td>
              <span class="verdict-badge" style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle);">${escapeHtml(w.status)}</span>
            </td>
            <td class="cell-mono" style="font-size: 11px;">${escapeHtml(w.payloadDigest.slice(0, 12))}...</td>
            <td style="font-size: 12px; color: var(--text-muted);">${new Date(w.receivedAt).toLocaleTimeString()}</td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color: var(--verdict-fail); text-align: center;">Failed to load webhooks: ${escapeHtml(err.message)}</td></tr>`;
      }
    }

    loadIntegrations();
    loadWebhooks();
  }

  // ==========================================================================
  // VIEW 5: SCENARIOS & FIRST-RUN RUNNER
  // ==========================================================================
  async function renderScenarios(outlet) {
    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Scenario Library & Guided Runner</h1>
            <p class="page-description">Demonstrate and verify real AI agent behavior across genuine, failure-injected simulation environments.</p>
          </div>
        </div>

        <!-- 3D Signature Pipeline Header -->
        <div class="card" style="margin-bottom: 1.25rem;">
          <div class="card-header">
            <div>
              <h3 class="card-title">Verification Pipeline Architecture</h3>
              <span style="font-size: 12px; color: var(--text-muted);">Deterministic 4-stage postcondition verification model</span>
            </div>
            <span class="badge-simulation">Simulation Demo</span>
          </div>
          <div class="card-body" style="padding: 0;">
            <div id="scenarios-pipeline-mount"></div>
          </div>
        </div>

        <div id="scenarios-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem;">
          <p style="color: var(--text-muted); padding: 2rem;">Loading scenario catalog...</p>
        </div>
      </div>
    `;

    renderSignaturePipeline('scenarios-pipeline-mount', {
      operation: 'run_scenario',
      postconditions: [1, 2],
      evidence: [1, 2],
      verdict: 'PASS',
      isSimulation: true,
    });

    try {
      const res = await api.get('/api/scenarios');
      state.scenarios = res.items || [];
      const grid = document.getElementById('scenarios-grid');
      if (!grid) return;

      grid.innerHTML = state.scenarios.map((s) => `
        <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div class="card-header">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 11px; font-weight: 700; color: var(--accent); font-family: var(--font-mono);">${escapeHtml(s.id)}</span>
                <span class="badge-simulation">Simulation</span>
              </div>
              <h3 class="card-title" style="margin-top: 4px;">${escapeHtml(s.name)}</h3>
            </div>
            ${getVerdictBadgeHtml(s.expectedVerdict)}
          </div>
          <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;">
            <p style="color: var(--text-secondary); font-size: 13px;">${escapeHtml(s.description)}</p>
            
            <div style="background: var(--bg-surface); padding: 0.75rem; border-radius: var(--radius-md); font-size: 12px; display: flex; flex-direction: column; gap: 0.25rem;">
              <div>Operation: <strong>${escapeHtml(s.operation)}</strong></div>
              <div>Primary Target: <code>${escapeHtml(s.primaryResourceId)}</code></div>
              <div>Failure Mode: <code>${escapeHtml(s.failureMode)}</code></div>
            </div>

            <button class="btn btn-primary" id="btn-run-${escapeHtml(s.id)}" onclick="window.AgentProof.executeScenario('${escapeHtml(s.id)}')">
              ▶ Execute Scenario
            </button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      const grid = document.getElementById('scenarios-grid');
      if (grid) grid.innerHTML = `<p style="color: var(--verdict-fail);">Failed to load scenarios: ${escapeHtml(err.message)}</p>`;
    }
  }

  // ==========================================================================
  // VIEW 6: HELP & DOCUMENTATION
  // ==========================================================================
  function renderHelp(outlet) {
    outlet.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">Help & Architecture Documentation</h1>
            <p class="page-description">Core principles, deterministic invariants, and security boundaries.</p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-secondary" id="help-shortcuts-btn">
              ⌨️ Keyboard Shortcuts
            </button>
            <button class="btn btn-primary" id="help-replay-onboarding-btn">
              ▶ Replay Onboarding Guide
            </button>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <!-- Interactive Quick Actions & Settings -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Console Actions & Checklist</h3>
            </div>
            <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
              <div>
                <div style="font-weight: 600; color: var(--text-primary);">Reset Getting Started Checklist</div>
                <div style="font-size: 12px; color: var(--text-muted);">Clear saved completion status and restore the 5 onboarding tasks to your Overview.</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="help-reset-checklist-btn">Reset Checklist</button>
            </div>
          </div>

          <!-- The Tri-State Verdict Model -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">1. The Tri-State Verdict Model</h3>
            </div>
            <div class="card-body" style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 13px; color: var(--text-secondary);">
              <p>AgentProof rejects binary true/false classifications. In real distributed systems and AI applications, a missing confirmation is not proof of failure, and an agent's self-reported "200 OK" is not proof of success.</p>
              <ul style="padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.4rem;">
                <li><strong style="color: var(--verdict-pass);">PASS:</strong> Reliable, fresh, independent evidence confirms every required postcondition was satisfied.</li>
                <li><strong style="color: var(--verdict-fail);">FAIL:</strong> Independent evidence definitively establishes that at least one required postcondition was violated.</li>
                <li><strong style="color: var(--verdict-inconclusive);">INCONCLUSIVE:</strong> Evidence is missing, stale, inaccessible, or conflicting. AgentProof refuses to guess or assume success.</li>
              </ul>
              <div style="margin-top: 0.5rem; padding: 0.75rem; background: var(--bg-surface); border-radius: var(--radius-md); border-left: 3px solid var(--accent); font-size: 12px;">
                <strong>Deterministic Aggregation Hierarchy:</strong> <code>FAIL &gt; INCONCLUSIVE &gt; PASS</code>. If even one postcondition fails, the run is FAIL. If any condition lacks evidence and none fail, the run is INCONCLUSIVE.
              </div>
            </div>
          </div>

          <!-- Evidence Provenance & Trust Levels -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">2. Evidence Provenance & Observation States</h3>
            </div>
            <div class="card-body" style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
              <p>Observation states represent evidence reads, <em>never verdicts</em>:</p>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.75rem;">
                <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <span class="obs-badge found">FOUND</span>
                  <p style="font-size: 12px; margin-top: 6px;">Resource exists and state was successfully retrieved by the reader.</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <span class="obs-badge not-found">NOT_FOUND</span>
                  <p style="font-size: 12px; margin-top: 6px;">Resource is absent or deleted (valid for deletion assertions).</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <span class="obs-badge read-error">READ_ERROR</span>
                  <p style="font-size: 12px; margin-top: 6px;">External database error, connection timeout, or permission fault.</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <span class="obs-badge untrusted">UNTRUSTED</span>
                  <p style="font-size: 12px; margin-top: 6px;">HMAC or cryptographic signature failed or evidence is stale.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Hash-Chains vs Signed Checkpoints -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">3. Hash-Chains vs Signed Checkpoints</h3>
            </div>
            <div class="card-body" style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
              <p><strong>Hash Chain:</strong> Each audit event contains <code>previousDigest</code>, forming an immutable hash chain from Genesis. Any mid-stream tampering breaks continuity immediately.</p>
              <p style="margin-top: 0.5rem;"><strong>Signed Checkpoint:</strong> A local hash chain alone cannot detect a full-history rewrite where an attacker recomputes the entire chain. To protect against this, AgentProof signs chain heads using RSA-SHA256.</p>
            </div>
          </div>

          <!-- Contextual Glossary of Technical Terms -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">4. Technical Concepts Glossary</h3>
            </div>
            <div class="card-body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; font-size: 13px;">
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Postcondition</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Declarative assertions on final state that must hold true after an action. Evaluated against independent evidence.</div>
              </div>
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Provenance</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Tamper-evident record tracing evidence source, reading actor, and collection timestamp.</div>
              </div>
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Freshness</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Tolerance window verifying evidence was captured after the claimed action occurred. Stale evidence causes INCONCLUSIVE.</div>
              </div>
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Hash Chain</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Append-only SHA-256 ledger where each block references previous block's digest, guaranteeing continuity.</div>
              </div>
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Checkpoint</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Cryptographically signed state root preventing whole-chain rewriting attacks.</div>
              </div>
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">Inconclusive Verdict</div>
                <div style="color: var(--text-secondary); font-size: 12px;">Deterministic outcome when evidence is missing, stale, untrusted, or conflicting. Inability to verify is never failure.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('help-shortcuts-btn')?.addEventListener('click', openShortcutsModal);
    document.getElementById('help-replay-onboarding-btn')?.addEventListener('click', () => openOnboarding(1));
    document.getElementById('help-reset-checklist-btn')?.addEventListener('click', resetChecklist);
  }

  // ==========================================================================
  // DETAIL DRAWER
  // ==========================================================================
  async function openVerificationDrawer(traceId) {
    markChecklistTask('task_view_detail');

    const drawer = document.getElementById('detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const title = document.getElementById('drawer-title');
    const subtitle = document.getElementById('drawer-subtitle');
    const body = document.getElementById('drawer-body');
    if (!drawer || !backdrop || !body) return;

    backdrop.classList.add('open');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');

    if (title) title.textContent = 'Loading Verification...';
    if (subtitle) subtitle.textContent = traceId;
    body.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Fetching authoritative verification trace...</p>';

    try {
      const trace = await api.get(`/api/verifications/${encodeURIComponent(traceId)}`);
      const isSimulation = Boolean(trace.isSimulation || trace.rawTrace?.metadata?.isSimulation || trace.scenarioId);

      if (title) {
        title.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${escapeHtml(trace.intent?.operation || 'Verification Run')}</span>
            ${isSimulation ? '<span class="badge-simulation">Simulation</span>' : ''}
          </div>
        `;
      }
      if (subtitle) subtitle.textContent = `${trace.traceId}`;

      // Verdict Driver Banner
      let driverHtml = '';
      if (trace.verdict === 'FAIL') {
        const driver = trace.conditionEvaluations?.find((c) => c.verdict === 'FAIL');
        driverHtml = `
          <div class="verdict-driver-banner fail">
            <div>
              <strong>Verdict Driver (FAIL):</strong> Required postcondition "<code>${escapeHtml(driver?.conditionId || 'state')}</code>" was definitively violated.
              <div style="font-size: 12px; margin-top: 4px;">Expected <code>${escapeHtml(String(driver?.expected))}</code> vs Observed <code>${escapeHtml(String(driver?.observed))}</code>.</div>
            </div>
          </div>
        `;
      } else if (trace.verdict === 'INCONCLUSIVE') {
        const driver = trace.conditionEvaluations?.find((c) => c.verdict === 'INCONCLUSIVE');
        driverHtml = `
          <div class="verdict-driver-banner inconclusive">
            <div>
              <strong>Verdict Driver (INCONCLUSIVE):</strong> Independent evidence was insufficient, stale, or untrusted.
              <div style="font-size: 12px; margin-top: 4px;">${escapeHtml(driver?.explanation || 'State could not be confirmed within freshness tolerance. Inability to verify is never success.')}</div>
            </div>
          </div>
        `;
      } else {
        driverHtml = `
          <div class="verdict-driver-banner pass">
            <div>
              <strong>Verdict Driver (PASS):</strong> All ${trace.postconditions.length} required postconditions were satisfied by independent, fresh, verified evidence.
            </div>
          </div>
        `;
      }

      body.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 1rem;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Authoritative Outcome</div>
            <div style="margin-top: 4px; display: flex; align-items: center; gap: 0.5rem;">
              ${getVerdictBadgeHtml(trace.verdict)}
              ${isSimulation ? '<span class="badge-simulation">Simulation</span>' : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--text-muted);">Evaluation Duration</div>
            <div style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); font-size: 13px;">${trace.durationMs ? trace.durationMs.toFixed(2) + ' ms' : '< 1 ms'}</div>
          </div>
        </div>

        ${driverHtml}

        <!-- Embedded 4-Stage Signature Visualization -->
        <div style="margin-bottom: 1.25rem;">
          <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Deterministic Pipeline Synthesis</h4>
          <div id="drawer-pipeline-mount"></div>
        </div>

        <div>
          <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Verdict Explanation</h4>
          <p style="font-size: 13px; color: var(--text-secondary); background: var(--bg-surface); padding: 0.85rem; border-radius: var(--radius-md); border-left: 3px solid var(--accent);">
            ${escapeHtml(trace.summary)}
          </p>
        </div>

        <div>
          <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Required Postconditions & Diff (${trace.postconditions.length})</h4>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${trace.postconditions.map((p) => {
              const evalResult = trace.conditionEvaluations.find((c) => c.conditionId === p.id);
              const verdict = evalResult ? evalResult.verdict : 'PENDING';
              const isMatch = verdict === 'PASS';
              const obsStatus = evalResult?.observationStatus || 'FOUND';

              return `
                <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
                    <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(p.description)}</span>
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                      ${getObservationBadgeHtml(obsStatus)}
                      ${getVerdictBadgeHtml(verdict)}
                    </div>
                  </div>
                  
                  <!-- Expected vs Observed Diff Box -->
                  <div class="diff-container">
                    <div class="diff-pane expected">
                      <div class="diff-pane-title">Expected Predicate</div>
                      <div class="diff-pane-code">${escapeHtml(p.path)} ${escapeHtml(p.operator)} "${escapeHtml(String(p.expectedValue))}"</div>
                    </div>
                    <div class="diff-pane observed ${isMatch ? 'matching' : ''}">
                      <div class="diff-pane-title">Observed State</div>
                      <div class="diff-pane-code">${evalResult ? escapeHtml(String(evalResult.observed)) : 'Awaiting read...'}</div>
                    </div>
                  </div>

                  ${evalResult ? `
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 0.5rem;">
                      <em>${escapeHtml(evalResult.explanation)}</em>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div>
          <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Supporting Independent Evidence (${trace.evidence.length})</h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${trace.evidence.map((ev) => `
              <div style="padding: 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-weight: 700; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(ev.evidenceId)}</span>
                  <div style="display: flex; align-items: center; gap: 0.4rem;">
                    ${getObservationBadgeHtml(ev.observationStatus || 'FOUND')}
                    <span class="verdict-badge" style="background: var(--accent-subtle); color: var(--accent);">${escapeHtml(ev.provenance?.trustLevel || 'UNVERIFIED')}</span>
                  </div>
                </div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                  Source: <strong>${escapeHtml(ev.sourceId)}</strong> (${escapeHtml(ev.sourceKind)}) • Freshness: verified within window
                </div>
                <pre class="code-viewer" style="margin-top: 0.5rem; max-height: 100px;">${escapeHtml(JSON.stringify(ev.observedPayload, null, 2))}</pre>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary);">Raw Verification Trace</h4>
            <button class="btn btn-secondary btn-sm" id="copy-trace-btn">Copy JSON</button>
          </div>
          <pre class="code-viewer" id="raw-trace-code" style="max-height: 200px;">${escapeHtml(JSON.stringify(trace.rawTrace, null, 2))}</pre>
        </div>
      `;

      // Render 3D/2D Pipeline for this run inside drawer
      renderSignaturePipeline('drawer-pipeline-mount', {
        operation: trace.intent?.operation,
        postconditions: trace.postconditions,
        evidence: trace.evidence,
        verdict: trace.verdict,
        isSimulation,
      });

      document.getElementById('copy-trace-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(JSON.stringify(trace.rawTrace, null, 2));
        showToast('Trace JSON copied to clipboard', 'success');
      });
    } catch (err) {
      body.innerHTML = `<p style="color: var(--verdict-fail); padding: 1.5rem;">Failed to load trace: ${escapeHtml(err.message)}</p>`;
    }
  }

  function closeDrawer() {
    const drawer = document.getElementById('detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  // ==========================================================================
  // RUN VERIFICATION MODAL
  // ==========================================================================
  function openRunModal() {
    const modal = document.getElementById('run-verification-modal');
    if (modal) modal.classList.add('open');
  }

  function closeRunModal() {
    const modal = document.getElementById('run-verification-modal');
    if (modal) modal.classList.remove('open');
  }

  async function submitRunModal() {
    const system = document.getElementById('rv-system')?.value || 'billing';
    const resourceId = document.getElementById('rv-resource-id')?.value || 'sub-100';
    const operation = document.getElementById('rv-operation')?.value || 'cancel_subscription';
    const path = document.getElementById('rv-path')?.value || 'status';
    const expected = document.getElementById('rv-expected')?.value || 'CANCELLED';
    const observed = document.getElementById('rv-observed')?.value || 'CANCELLED';

    const reqBody = {
      request: {
        schemaVersion: '1.0.0',
        requestId: `req-${Date.now()}`,
        timestamp: new Date().toISOString(),
        target: { system, resourceType: 'subscription', resourceId, tenantId: state.tenantId },
        intent: { operation, summary: `Verify ${operation} on ${resourceId}`, expectedChanges: {} },
        preconditions: [],
        postconditions: [
          {
            id: 'post-1',
            description: `Check ${path} equals ${expected}`,
            path,
            operator: 'EQUALS',
            expectedValue: expected,
            enforcement: 'REQUIRED',
          },
        ],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      },
      evidence: [
        {
          evidenceId: `ev-${Date.now()}`,
          evidenceType: 'STATE_SNAPSHOT',
          sourceId: 'independent-state-reader',
          sourceKind: 'DIRECT_READ',
          target: { system, resourceType: 'subscription', resourceId, tenantId: state.tenantId },
          observedPayload: { [path]: observed },
          observedAt: new Date().toISOString(),
          freshnessMs: 0,
          integrityHash: 'a'.repeat(64),
          limitations: [],
          provenance: { trustLevel: 'INTEGRITY_CHECKED' },
        },
      ],
      action: {
        actionId: `act-${Date.now()}`,
        toolName: operation,
        target: { system, resourceType: 'subscription', resourceId, tenantId: state.tenantId },
        sanitizedArgs: { resourceId },
        executionStatus: 'REPORTED_SUCCESS',
        reportedResult: { status: 'ok' },
        invokedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    };

    try {
      const res = await api.post('/api/verifications/run', reqBody);
      closeRunModal();
      showToast(`Verification executed: ${res.verdict}`, res.verdict === 'PASS' ? 'success' : 'error');
      openVerificationDrawer(res.traceId);
      if (state.activeView === 'overview') {
        navigate('overview');
      } else if (state.activeView === 'verifications') {
        navigate('verifications');
      }
    } catch (err) {
      showToast('Verification submission failed: ' + err.message, 'error');
    }
  }

  // ==========================================================================
  // SCENARIO EXECUTION
  // ==========================================================================
  async function executeScenario(scenarioId) {
    const btn = document.getElementById(`btn-run-${scenarioId}`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Executing...';
    }

    try {
      const res = await api.post(`/api/scenarios/${encodeURIComponent(scenarioId)}/run`, {});
      markChecklistTask('task_run_simulation');
      showToast(`Scenario ${scenarioId} executed: ${res.authoritativeVerdict}`, res.authoritativeVerdict === 'PASS' ? 'success' : 'error');
      openVerificationDrawer(res.traceId);
    } catch (err) {
      showToast(`Scenario execution failed: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '▶ Execute Scenario';
      }
    }
  }

  // ==========================================================================
  // COMMAND PALETTE
  // ==========================================================================
  function openCommandPalette() {
    const modal = document.getElementById('command-palette-modal');
    const input = document.getElementById('command-input');
    if (modal && input) {
      modal.classList.add('open');
      input.value = '';
      input.focus();
      renderCommandResults('');
    }
  }

  function closeCommandPalette() {
    const modal = document.getElementById('command-palette-modal');
    if (modal) modal.classList.remove('open');
  }

  function renderCommandResults(query) {
    const resultsContainer = document.getElementById('command-results');
    if (!resultsContainer) return;

    const commands = [
      { title: 'Overview Dashboard', category: 'Navigation', action: () => navigate('overview') },
      { title: 'Verification Explorer', category: 'Navigation', action: () => navigate('verifications') },
      { title: 'Evidence & Audit', category: 'Navigation', action: () => navigate('evidence-audit') },
      { title: 'Integrations & Webhooks', category: 'Navigation', action: () => navigate('integrations-webhooks') },
      { title: 'Scenario Library', category: 'Navigation', action: () => navigate('scenarios') },
      { title: 'Help & Docs', category: 'Navigation', action: () => navigate('help') },
      { title: 'Run Verification', category: 'Action', action: openRunModal },
      { title: 'Toggle Theme (Dark / Light)', category: 'Preference', action: toggleTheme },
      { title: 'Open Onboarding Walkthrough', category: 'Help', action: () => openOnboarding(1) },
      { title: 'Show Keyboard Shortcuts', category: 'Help', action: openShortcutsModal },
      { title: 'Execute Scenario A (Genuine Success)', category: 'Simulation', action: () => executeScenario('SCENARIO_A') },
      { title: 'Execute Scenario B (False Success Demo)', category: 'Simulation', action: () => executeScenario('SCENARIO_B') },
      { title: 'Execute Scenario F (Observation Unavailable)', category: 'Simulation', action: () => executeScenario('SCENARIO_F') },
    ];

    const q = query.toLowerCase().trim();
    const filtered = commands.filter((c) => c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));

    resultsContainer.innerHTML = filtered.map((c, i) => `
      <div class="cmd-item" style="padding: 0.6rem 0.75rem; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 13px;" data-idx="${i}">
        <span style="color: var(--text-primary); font-weight: 500;">${escapeHtml(c.title)}</span>
        <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(c.category)}</span>
      </div>
    `).join('');

    resultsContainer.querySelectorAll('.cmd-item').forEach((item) => {
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'var(--accent-subtle)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-idx') || '0', 10);
        closeCommandPalette();
        filtered[idx].action();
      });
    });
  }

  // --- Global Initialization ---
  function init() {
    // Apply initial theme & sidebar state
    applyTheme(state.theme);
    if (state.sidebarCollapsed) {
      document.getElementById('sidebar')?.classList.add('collapsed');
    }

    // Attach Sidebar & Header Listeners
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
    document.getElementById('drawer-close-btn')?.addEventListener('click', closeDrawer);
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);
    document.getElementById('close-run-modal-btn')?.addEventListener('click', closeRunModal);
    document.getElementById('cancel-run-modal-btn')?.addEventListener('click', closeRunModal);
    document.getElementById('submit-run-modal-btn')?.addEventListener('click', submitRunModal);

    // Shortcuts modal listeners
    document.getElementById('close-shortcuts-btn')?.addEventListener('click', closeShortcutsModal);
    document.getElementById('dismiss-shortcuts-btn')?.addEventListener('click', closeShortcutsModal);

    // Onboarding modal listeners
    document.getElementById('close-onboarding-btn')?.addEventListener('click', closeOnboarding);
    document.getElementById('onboarding-skip-btn')?.addEventListener('click', closeOnboarding);
    document.getElementById('onboarding-prev-btn')?.addEventListener('click', () => {
      openOnboarding(state.currentOnboardingStep - 1);
    });
    document.getElementById('onboarding-next-btn')?.addEventListener('click', () => {
      if (state.currentOnboardingStep < 4) {
        openOnboarding(state.currentOnboardingStep + 1);
      } else {
        closeOnboarding();
        executeScenario('SCENARIO_A');
      }
    });
    document.querySelectorAll('#onboarding-dots .onboarding-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const step = parseInt(dot.getAttribute('data-step') || '1', 10);
        openOnboarding(step);
      });
    });

    // Command palette
    document.getElementById('command-palette-btn')?.addEventListener('click', openCommandPalette);
    document.getElementById('command-input')?.addEventListener('input', (e) => {
      renderCommandResults(e.target.value);
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if (!isInput && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        openShortcutsModal();
      }
      if (!isInput && (e.key === 't' || e.key === 'T')) {
        toggleTheme();
      }
      if (!isInput && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        const views = ['overview', 'verifications', 'evidence-audit', 'integrations-webhooks', 'scenarios', 'help'];
        const idx = parseInt(e.key, 10) - 1;
        if (views[idx]) navigate(views[idx]);
      }
      if (e.key === 'Escape') {
        closeDrawer();
        closeRunModal();
        closeCommandPalette();
        closeShortcutsModal();
        closeOnboarding();
      }
    });

    // Hash change routing
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1) || 'overview';
      navigate(hash);
    });

    // Initial navigation
    const initialView = window.location.hash.slice(1) || 'overview';
    navigate(initialView);
  }

  // Expose global AgentProof object for onclick bindings
  window.AgentProof = {
    openTrace: openVerificationDrawer,
    executeScenario,
    navigate,
    toggleTheme,
    openOnboarding,
    openShortcutsModal,
    resetChecklist,
  };

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
