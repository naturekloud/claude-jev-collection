(() => {
  const $ = id => document.getElementById(id);
  const tiers = ['micro', 'low', 'medium', 'high'];
  const roles = ['jev-scout', 'jev-builder', 'jev-engineer', 'jev-architect', 'jev-advisor', 'jev-analyst', 'jev-debugger', 'jev-reviewer', 'jev-qa'];
  const tierDescriptions = { micro: '단순 조회', low: '명확한 구현', medium: '복합 작업', high: '깊은 설계' };
  const pending = new Map();
  let snapshot, connected = false, busy = false, dirty = false, bridge = 'mcp';
  let hostOrigin = '*';
  const notify = (method, params = {}) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, hostOrigin);
  function rpc(method, params, timeout = 20000) {
    const id = `router-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('호스트 응답이 없습니다. Router 패널을 다시 열어주세요.')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, hostOrigin);
    });
  }
  function notice(message = '', error = false) {
    $('notice').hidden = !message;
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
  }
  function applyTheme(context) {
    if (context?.theme === 'light' || context?.theme === 'dark') document.documentElement.dataset.theme = context.theme;
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const message = event.data;
    if (pending.has(message.id)) {
      const entry = pending.get(message.id);
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || '호스트 요청을 처리하지 못했습니다.'));
      else {
        if (event.origin && event.origin !== 'null') hostOrigin = event.origin;
        entry.resolve(message.result);
      }
    } else if (message.method === 'ui/notifications/tool-result') {
      if (!busy && message.params?.structuredContent) update(message.params.structuredContent);
    } else if (message.method === 'ui/notifications/host-context-changed') applyTheme(message.params);
    else if (message.method === 'ping' && message.id !== undefined) {
      window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, hostOrigin);
    }
    else if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
      window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, hostOrigin);
    }
  });
  async function callTool(name, args = {}) {
    let result;
    if (window.__ROUTER_PREVIEW__) {
      const response = await fetch('/rpc', { method: 'POST', credentials: 'omit', headers: {
        'Content-Type': 'application/json', 'X-Router-Nonce': window.__ROUTER_PREVIEW__.nonce,
      }, body: JSON.stringify({ name, args }) });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
      return result;
    }
    if (bridge === 'openai') result = await window.openai.callTool(name, args);
    else result = await rpc('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || '요청을 처리하지 못했습니다.');
    if (!result?.structuredContent) throw new Error('Router 데이터가 없습니다. 플러그인 연결을 확인하세요.');
    return result.structuredContent;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function controls() {
    document.querySelectorAll('textarea,input,select,form button,[data-example]').forEach(control => { control.disabled = busy || !connected; });
    $('classify-button').disabled = busy || !connected || !snapshot?.keyConfigured || !$('task').value.trim();
    $('save-button').disabled = busy || !connected || !dirty;
    $('reset-button').disabled = busy || !connected;
    $('clear-history').disabled = busy || !connected || !snapshot?.history?.length;
    $('task-count').textContent = `${$('task').value.length.toLocaleString()} / 8,000`;
    $('dirty-state').textContent = dirty ? '저장하지 않은 변경' : '저장된 설정';
    $('classify-button').replaceChildren();
    if (busy) $('classify-button').append(element('span', 'busy-indicator'));
    $('classify-button').append(document.createTextNode(busy ? '처리 중…' : '경로 추천받기 ↗'));
  }
  function buildSettings(routes) {
    $('route-rows').replaceChildren();
    for (const tier of tiers) {
      const row = element('div', 'route-grid route-row');
      const label = element('div', 'route-name', tier.toUpperCase());
      label.append(element('small', '', tierDescriptions[tier])); row.append(label);
      for (const [key, title, options] of [['model', '모델', null], ['effort', '추론 강도', ['low', 'medium', 'high', 'xhigh']], ['agent_type', '에이전트 역할', roles]]) {
        const field = element('div', `row-field${key === 'model' ? ' model-field' : ''}`);
        const id = `${tier}-${key}`;
        const caption = element('label', '', title); caption.htmlFor = id;
        const input = element(options ? 'select' : 'input'); input.id = id;
        input.dataset.tier = tier; input.dataset.key = key;
        input.setAttribute('aria-label', `${tier} ${title}`);
        if (options) for (const option of options) { const item = element('option', '', option); item.value = option; input.append(item); }
        else { input.maxLength = 128; input.required = true; input.pattern = String.raw`[A-Za-z0-9][A-Za-z0-9._:\/\-]*`; input.autocomplete = 'off'; }
        input.value = routes[tier][key];
        input.addEventListener('input', () => { dirty = true; $('save-state').textContent = ''; controls(); });
        field.append(caption, input); row.append(field);
      }
      $('route-rows').append(row);
    }
  }
  function renderResult(result) {
    if (!result) return;
    $('result-empty').hidden = true; $('result').hidden = false;
    const tier = result.advice?.choice || 'uncertain';
    $('result-tier').textContent = tier === 'uncertain' ? '분류 보류' : tier;
    const score = Math.max(0, Math.min(1, Number(result.advice?.confidence) || 0));
    $('confidence').textContent = `분류 점수 ${Math.round(score * 100)}%`;
    $('result-model').textContent = result.recommendation?.model || '작업을 조금 더 구체적으로 적어주세요';
    $('result-effort').textContent = result.recommendation?.effort || '—';
    $('result-agent').textContent = result.recommendation?.agent_type || '—';
    $('probabilities').replaceChildren();
    for (const name of [...tiers, 'uncertain']) {
      const probability = Math.max(0, Math.min(1, Number(result.advice?.probabilities?.[name]) || 0));
      const row = element('div', `prob-row${name === tier ? ' chosen' : ''}`);
      row.append(element('span', '', name === 'uncertain' ? '보류' : name));
      const track = element('div', 'track'), fill = element('div', 'fill'); fill.style.width = `${probability * 100}%`;
      track.append(fill); row.append(track, element('span', '', `${Math.round(probability * 100)}%`)); $('probabilities').append(row);
    }
  }
  function renderHistory(history) {
    $('history-empty').hidden = history.length > 0; $('history-wrap').hidden = !history.length;
    $('history-rows').replaceChildren();
    for (const entry of history) {
      const row = element('tr');
      row.append(element('td', '', new Date(entry.timestamp).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })), element('td', '', entry.tier.toUpperCase()));
      const model = element('td'); model.append(element('code', '', entry.model || '—'));
      row.append(model, element('td', '', entry.effort || '—')); $('history-rows').append(row);
    }
  }
  function update(data, forceSettings = false) {
    if (!data?.routes) return;
    snapshot = data; connected = true;
    $('connection').classList.toggle('ready', data.keyConfigured);
    $('connection-text').textContent = data.keyConfigured ? 'Jev 연결 준비됨' : 'API 키 설정 필요';
    if (forceSettings || !dirty) { buildSettings(data.routes); dirty = false; }
    if (forceSettings) { $('result').hidden = true; $('result-empty').hidden = false; }
    renderHistory(data.history || []); renderResult(data.result); controls();
  }
  async function perform(name, args, success, forceSettings = false) {
    busy = true; notice(); controls();
    try { update(await callTool(name, args), forceSettings); if (success) notice(success); }
    catch (error) { notice(error.message || '요청에 실패했습니다. 다시 시도하세요.', true); }
    finally { busy = false; controls(); }
  }
  function switchTab(name, focus = false) {
    document.querySelectorAll('[data-view]').forEach(tab => {
      const selected = tab.dataset.view === name;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $(`view-${tab.dataset.view}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  document.querySelectorAll('[data-view]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const tabs = [...document.querySelectorAll('[data-view]')];
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      switchTab(tabs[index].dataset.view, true);
    });
  });
  $('task').addEventListener('input', controls);
  $('task').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('classify-button').disabled) { event.preventDefault(); $('classify-form').requestSubmit(); } });
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => { $('task').value = button.dataset.example; $('task').focus(); controls(); }));
  $('classify-form').addEventListener('submit', event => { event.preventDefault(); if (!busy && !$('classify-button').disabled) perform('classify_task', { task: $('task').value }); });
  $('settings-form').addEventListener('submit', event => {
    event.preventDefault(); if (busy || !dirty) return;
    const routes = Object.fromEntries(tiers.map(tier => [tier, {}]));
    document.querySelectorAll('[data-tier]').forEach(input => { routes[input.dataset.tier][input.dataset.key] = input.value; });
    perform('save_settings', { routes }, '라우팅 설정을 저장했습니다.', true);
  });
  $('reset-button').addEventListener('click', () => { $('reset-confirm').hidden = false; $('confirm-reset').focus(); });
  $('cancel-reset').addEventListener('click', () => { $('reset-confirm').hidden = true; $('reset-button').focus(); });
  $('confirm-reset').addEventListener('click', () => { $('reset-confirm').hidden = true; perform('reset_settings', {}, '기본 라우팅으로 되돌렸습니다.', true); });
  $('clear-history').addEventListener('click', () => perform('clear_history', {}, '분류 기록을 지웠습니다.'));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
    if (connected && !window.__ROUTER_PREVIEW__) notify('ui/notifications/size-changed', { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
  }).observe(document.body);
  async function initialize() {
    controls();
    try {
      if (window.__ROUTER_PREVIEW__) $('host-label').textContent = '로컬 미리보기 · 동일한 Router 서비스';
      else {
        try {
          const info = await rpc('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'Jev Router', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline'] } }, 3000);
          applyTheme(info?.hostContext); notify('ui/notifications/initialized');
        } catch (error) {
          if (!window.openai?.callTool) throw error;
          bridge = 'openai'; applyTheme({ theme: window.openai.theme });
        }
      }
      update(await callTool('router_status'));
    } catch (error) { $('connection-text').textContent = '호스트 연결 안 됨'; notice(error.message, true); }
  }
  initialize();
})();
