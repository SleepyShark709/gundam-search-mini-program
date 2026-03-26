// ======== 工具函数 ========

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function formatPrice(price) {
  if (!price) return '-';
  return '¥' + price.toLocaleString();
}

function formatDate(d) {
  if (!d) return '-';
  return d;
}

function resolveImageUrl(url) {
  if (!url) return '';
  // 本地路径: /images/xxx → 通过 /local-images/ 代理
  if (url.startsWith('/images/')) return '/local-images' + url.slice('/images'.length);
  return url;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ======== 路由 ========

const views = ['dashboard', 'models', 'tasks'];

function switchView(name) {
  views.forEach(v => {
    document.getElementById('view-' + v).style.display = v === name ? '' : 'none';
  });
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name);
  });
  if (name === 'dashboard') loadDashboard();
  if (name === 'models') loadModels();
  if (name === 'tasks') loadHistory();
}

function handleHash() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  if (views.includes(hash)) switchView(hash);
}

window.addEventListener('hashchange', handleHash);

// ======== 仪表盘 ========

async function loadDashboard() {
  try {
    const { stats, seriesMeta, seriesCounts, dataVersion } = await api('/api/data/dashboard');

    const statsCards = document.getElementById('stats-cards');
    statsCards.innerHTML = [
      { value: stats.total_models, label: '总模型数' },
      { value: stats.models_with_images, label: '有详情图' },
      { value: stats.total_images, label: '详情图总数' },
      { value: stats.total_users, label: '用户数' },
      { value: stats.total_wishlists, label: '收藏数' },
      { value: stats.total_purchases, label: '购买数' },
    ].map(s => `
      <article class="stat-card">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </article>
    `).join('');

    const seriesCardsEl = document.getElementById('series-cards');
    seriesCardsEl.innerHTML = seriesMeta.map(s => {
      const count = seriesCounts[s.code] || 0;
      const imgSrc = resolveImageUrl(s.coverImage);
      return `
        <article class="series-card">
          <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(s.name)}" onerror="this.style.display='none'">
          <div class="series-info">
            <h4>${escapeHtml(s.shortName || s.code.toUpperCase())} - ${escapeHtml(s.name)}</h4>
            <p>比例: ${escapeHtml(s.scale)} | 模型数: ${count}</p>
            <p>数据版本: ${dataVersion}</p>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('stats-cards').innerHTML =
      `<article><p style="color:#ff6b6b">加载失败: ${escapeHtml(err.message)}</p></article>`;
  }
}

// ======== 模型数据 ========

let currentPage = 1;
const PAGE_SIZE = 50;

async function loadModels() {
  const series = document.getElementById('filter-series').value;
  const search = document.getElementById('filter-search').value;
  const limited = document.getElementById('filter-limited').value;

  const params = new URLSearchParams({ page: currentPage, pageSize: PAGE_SIZE });
  if (series) params.set('series', series);
  if (search) params.set('search', search);
  if (limited) params.set('limited', limited);

  try {
    const { data, total, page, pageSize } = await api('/api/data/models?' + params);

    const tbody = document.getElementById('models-tbody');
    tbody.innerHTML = data.map(m => `
      <tr data-id="${escapeHtml(m.id)}">
        <td>${escapeHtml(m.id)}</td>
        <td>${escapeHtml(m.nameJa || m.name)}</td>
        <td>${formatPrice(m.price)}</td>
        <td>${formatDate(m.releaseDate)}</td>
        <td>${m.isLimited ? `<span class="limited-badge">${escapeHtml(m.limitedType || '限定')}</span>` : ''}</td>
        <td>${m.imageCount || 0}</td>
      </tr>
    `).join('');

    // 分页
    const totalPages = Math.ceil(total / pageSize);
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = `
      <button class="outline small" ${page <= 1 ? 'disabled' : ''} onclick="goPage(${page - 1})">上一页</button>
      <span class="page-info">第 ${page} / ${totalPages} 页 (共 ${total} 条)</span>
      <button class="outline small" ${page >= totalPages ? 'disabled' : ''} onclick="goPage(${page + 1})">下一页</button>
    `;
  } catch (err) {
    document.getElementById('models-tbody').innerHTML =
      `<tr><td colspan="6" style="color:#ff6b6b">加载失败: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function goPage(p) {
  currentPage = p;
  loadModels();
}

// 搜索
document.getElementById('btn-search').addEventListener('click', () => {
  currentPage = 1;
  loadModels();
});
document.getElementById('filter-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { currentPage = 1; loadModels(); }
});
document.getElementById('filter-series').addEventListener('change', () => {
  currentPage = 1;
  loadModels();
});
document.getElementById('filter-limited').addEventListener('change', () => {
  currentPage = 1;
  loadModels();
});

// 点击行查看详情
document.getElementById('models-tbody').addEventListener('click', async e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;

  try {
    const { model, images, wishlistCount, purchaseCount } = await api('/api/data/models/' + id);

    document.getElementById('dialog-title').textContent =
      `${model.id.toUpperCase()} ${model.nameJa || model.name}`;

    const heroImgSrc = resolveImageUrl(model.imageUrl);

    let body = '';

    // 头图
    if (heroImgSrc) {
      body += `<img class="detail-hero-img" src="${escapeHtml(heroImgSrc)}" onerror="this.style.display='none'">`;
    }

    // 信息
    body += `<dl class="detail-info-grid">
      <dt>系列</dt><dd>${escapeHtml(model.series?.toUpperCase())}</dd>
      <dt>编号</dt><dd>${model.number}</dd>
      <dt>价格 (含税)</dt><dd>${formatPrice(model.price)}</dd>
      <dt>价格 (税前)</dt><dd>${formatPrice(model.priceTaxFree)}</dd>
      <dt>发售日</dt><dd>${formatDate(model.releaseDate)}</dd>
      <dt>限定</dt><dd>${model.isLimited ? (model.limitedType || '是') : '否'}</dd>
    </dl>`;

    // 产品页链接
    if (model.productUrl) {
      body += `<p><a href="${escapeHtml(model.productUrl)}" target="_blank" rel="noopener">万代官网产品页</a></p>`;
    }

    // 统计
    body += `<p>
      <span class="detail-stat">收藏: ${wishlistCount}</span>
      <span class="detail-stat">购买: ${purchaseCount}</span>
    </p>`;

    // 详情图
    if (images && images.length > 0) {
      body += `<h4>详情图 (${images.length} 张)</h4>`;
      body += '<div class="detail-images-grid">';
      body += images.map(url => {
        const src = resolveImageUrl(url);
        return `<img src="${escapeHtml(src)}" loading="lazy" onerror="this.style.display='none'" onclick="window.open('${escapeHtml(src)}','_blank')">`;
      }).join('');
      body += '</div>';
    }

    document.getElementById('dialog-body').innerHTML = body;
    document.getElementById('model-dialog').showModal();
  } catch (err) {
    alert('加载详情失败: ' + err.message);
  }
});

// 关闭弹窗
document.getElementById('dialog-close').addEventListener('click', () => {
  document.getElementById('model-dialog').close();
});
document.getElementById('model-dialog').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// ======== 数据更新 ========

let currentEventSource = null;

document.querySelectorAll('.task-btn').forEach(btn => {
  btn.addEventListener('click', () => startTask(btn.dataset.type));
});

function getTaskOptions(type) {
  if (type === 'scrape-bandai') {
    return {
      series: document.getElementById('scrape-series').value || undefined,
      full: document.getElementById('scrape-full').checked,
      force: document.getElementById('scrape-force').checked,
      syncDb: document.getElementById('scrape-syncdb').checked,
      dryRun: document.getElementById('scrape-dryrun').checked,
    };
  }
  if (type === 'scrape-images') {
    const limit = document.getElementById('images-limit').value;
    return {
      series: document.getElementById('images-series').value || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      skipExisting: document.getElementById('images-skip').checked,
      dryRun: document.getElementById('images-dryrun').checked,
    };
  }
  if (type === 'update-data') {
    return {
      series: document.getElementById('update-series').value || undefined,
      skipImages: document.getElementById('update-skip-images').checked,
      skipData: document.getElementById('update-skip-data').checked,
    };
  }
  return {};
}

async function startTask(type) {
  const options = getTaskOptions(type);

  // 禁用所有按钮
  document.querySelectorAll('.task-btn').forEach(b => b.disabled = true);

  // 显示日志面板
  const logPanel = document.getElementById('log-panel');
  logPanel.style.display = '';
  const logOutput = document.getElementById('log-output');
  logOutput.innerHTML = '';
  const logStatus = document.getElementById('log-status');
  logStatus.className = 'status-running';
  logStatus.textContent = '运行中...';

  try {
    const { taskId } = await api('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, options }),
    });

    // 连接 SSE
    if (currentEventSource) currentEventSource.close();
    const es = new EventSource('/api/tasks/' + taskId + '/stream');
    currentEventSource = es;

    es.addEventListener('log', e => {
      const { line } = JSON.parse(e.data);
      const span = document.createElement('span');
      span.textContent = line + '\n';
      if (line.startsWith('[stderr]') || line.includes('error') || line.includes('失败')) {
        span.className = 'log-line-stderr';
      } else if (line.includes('完成') || line.includes('成功')) {
        span.className = 'log-line-success';
      }
      logOutput.appendChild(span);
      logOutput.scrollTop = logOutput.scrollHeight;
    });

    es.addEventListener('status', e => {
      const { status, exitCode } = JSON.parse(e.data);
      logStatus.className = 'status-' + status;
      logStatus.textContent = status === 'completed' ? '完成' : `失败 (exit ${exitCode})`;
      es.close();
      currentEventSource = null;
      document.querySelectorAll('.task-btn').forEach(b => b.disabled = false);
      loadHistory();
    });

    es.onerror = () => {
      logStatus.className = 'status-failed';
      logStatus.textContent = '连接断开';
      es.close();
      currentEventSource = null;
      document.querySelectorAll('.task-btn').forEach(b => b.disabled = false);
    };
  } catch (err) {
    logStatus.className = 'status-failed';
    logStatus.textContent = '启动失败: ' + err.message;
    document.querySelectorAll('.task-btn').forEach(b => b.disabled = false);
  }
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
  document.getElementById('log-output').innerHTML = '';
});

// 历史任务
async function loadHistory() {
  try {
    const { tasks } = await api('/api/tasks');
    const tbody = document.getElementById('history-tbody');
    if (tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--pico-muted-color)">暂无历史任务</td></tr>';
      return;
    }
    tbody.innerHTML = tasks.map(t => {
      const start = new Date(t.startedAt);
      const time = start.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const duration = t.finishedAt
        ? ((new Date(t.finishedAt).getTime() - start.getTime()) / 1000).toFixed(1) + 's'
        : '-';
      const statusCls = 'status-' + t.status;
      const statusText = t.status === 'completed' ? '完成' : t.status === 'failed' ? '失败' : '运行中';
      return `
        <tr>
          <td>${time}</td>
          <td>${escapeHtml(t.type)}</td>
          <td><span class="${statusCls}">${statusText}</span></td>
          <td>${duration}</td>
          <td><button class="outline" onclick="viewTaskLog('${t.id}')">日志</button></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('history-tbody').innerHTML =
      `<tr><td colspan="5" style="color:#ff6b6b">${escapeHtml(err.message)}</td></tr>`;
  }
}

function viewTaskLog(taskId) {
  const logPanel = document.getElementById('log-panel');
  logPanel.style.display = '';
  const logOutput = document.getElementById('log-output');
  logOutput.innerHTML = '';
  const logStatus = document.getElementById('log-status');
  logStatus.className = '';
  logStatus.textContent = '加载中...';

  if (currentEventSource) currentEventSource.close();
  const es = new EventSource('/api/tasks/' + taskId + '/stream');
  currentEventSource = es;

  es.addEventListener('log', e => {
    const { line } = JSON.parse(e.data);
    const span = document.createElement('span');
    span.textContent = line + '\n';
    if (line.startsWith('[stderr]') || line.includes('error') || line.includes('失败')) {
      span.className = 'log-line-stderr';
    } else if (line.includes('完成') || line.includes('成功')) {
      span.className = 'log-line-success';
    }
    logOutput.appendChild(span);
  });

  es.addEventListener('status', e => {
    const { status, exitCode } = JSON.parse(e.data);
    logStatus.className = 'status-' + status;
    logStatus.textContent = status === 'completed' ? '完成' : `失败 (exit ${exitCode})`;
    es.close();
    currentEventSource = null;
    logOutput.scrollTop = logOutput.scrollHeight;
  });

  es.onerror = () => {
    es.close();
    currentEventSource = null;
  };
}

// ======== 初始化 ========
handleHash();
