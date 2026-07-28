/* ============================================================
   script.js — Logika aplikasi Buku Kas
   LocalStorage HANYA dipakai untuk pengaturan aplikasi (tema).
   Semua data keuangan tersimpan di IndexedDB lewat database.js
   ============================================================ */

(function () {
  'use strict';

  const SETTINGS_KEY = 'bukukas-settings';

  /* ---------------------------------------------------------
     STATE
  --------------------------------------------------------- */
  const state = {
    wallets: [],
    categories: [],
    transactions: [],
    goals: [],
    currentView: 'dashboard',
    txFilter: 'all',
    catTypeFilter: 'expense',
    confirmCallback: null
  };

  const CHART_PALETTE = ['#D9AE60', '#57B589', '#6E8FE2', '#E2685B', '#B37FE0', '#4FC1C7', '#E0A03F', '#9AA3B2'];

  /* ---------------------------------------------------------
     UTIL
  --------------------------------------------------------- */
  function formatRupiah(n) {
    const num = Math.round(Number(n) || 0);
    const sign = num < 0 ? '-' : '';
    return sign + 'Rp' + Math.abs(num).toLocaleString('id-ID');
  }

  function parseAmount(str) {
    if (!str) return 0;
    const digits = String(str).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  function formatAmountInputLive(input) {
    input.addEventListener('input', () => {
      const val = parseAmount(input.value);
      input.value = val ? val.toLocaleString('id-ID') : '';
    });
  }

  function todayISODate() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function formatDateLabel(isoDate) {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatDateShort(isoDate) {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function isSameMonth(isoDate, ref) {
    const d = new Date(isoDate + 'T00:00:00');
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  }

  function monthLabel(ref) {
    return ref.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  }

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  /* ---------------------------------------------------------
     THEME (LocalStorage — hanya pengaturan aplikasi)
  --------------------------------------------------------- */
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const switchEl = document.getElementById('settings-theme-switch');
    if (switchEl) switchEl.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
  }
  function initTheme() {
    const settings = loadSettings();
    const theme = settings.theme || 'dark';
    applyTheme(theme);
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const settings = loadSettings();
    settings.theme = next;
    saveSettings(settings);
  }

  /* ---------------------------------------------------------
     DATA LOADING
  --------------------------------------------------------- */
  async function reloadAll() {
    const [wallets, categories, transactions, goals] = await Promise.all([
      DB.getWallets(), DB.getCategories(), DB.getTransactions(), DB.getGoals()
    ]);
    state.wallets = wallets;
    state.categories = categories;
    state.transactions = transactions.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    state.goals = goals;
  }

  function categoryById(id) { return state.categories.find((c) => c.id === id); }
  function walletById(id) { return state.wallets.find((w) => w.id === id); }

  function walletBalance(wallet) {
    const initial = Number(wallet.initialBalance) || 0;
    const delta = state.transactions
      .filter((t) => t.walletId === wallet.id)
      .reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
    return initial + delta;
  }

  function totalBalance() {
    return state.wallets.reduce((sum, w) => sum + walletBalance(w), 0);
  }

  function monthTransactions(ref) {
    return state.transactions.filter((t) => isSameMonth(t.date, ref));
  }

  function monthIncome(ref) {
    return monthTransactions(ref).filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  }
  function monthExpense(ref) {
    return monthTransactions(ref).filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  }

  function expenseByCategory(ref) {
    const map = {};
    monthTransactions(ref).filter((t) => t.type === 'expense').forEach((t) => {
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    return Object.entries(map)
      .map(([categoryId, value]) => ({ categoryId, value, category: categoryById(categoryId) }))
      .filter((x) => x.category)
      .sort((a, b) => b.value - a.value);
  }

  /* ---------------------------------------------------------
     NAVIGATION
  --------------------------------------------------------- */
  function switchView(name) {
    state.currentView = name;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.nav === name));
    document.getElementById('app-main').scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    renderView(name);
  }

  function renderView(name) {
    if (name === 'dashboard') renderDashboard();
    else if (name === 'transaksi') renderTransaksi();
    else if (name === 'dompet') renderDompet();
    else if (name === 'target') renderTarget();
    else if (name === 'kategori') renderKategori();
    else if (name === 'analisa') renderAnalisa();
  }

  function renderAll() {
    renderView(state.currentView);
  }

  /* ---------------------------------------------------------
     DASHBOARD
  --------------------------------------------------------- */
  function renderDashboard() {
    const now = new Date();
    document.getElementById('dash-balance').textContent = formatRupiah(totalBalance());
    document.getElementById('dash-income').textContent = formatRupiah(monthIncome(now));
    document.getElementById('dash-expense').textContent = formatRupiah(monthExpense(now));
    document.getElementById('dash-chart-month').textContent = monthLabel(now);

    const byCat = expenseByCategory(now);
    const chartWrap = document.getElementById('dash-chart-wrap');
    const chartEmpty = document.getElementById('dash-chart-empty');
    if (byCat.length === 0) {
      chartWrap.style.display = 'none';
      chartEmpty.style.display = 'block';
    } else {
      chartWrap.style.display = 'flex';
      chartEmpty.style.display = 'none';
      drawDonutChart(byCat);
    }

    const recent = state.transactions.slice(0, 5);
    const list = document.getElementById('dash-recent-list');
    const empty = document.getElementById('dash-recent-empty');
    if (recent.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      list.innerHTML = recent.map(renderTxRow).join('');
      bindTxRowClicks(list);
    }
  }

  function drawDonutChart(byCat) {
    const canvas = document.getElementById('dash-chart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 220;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const total = byCat.reduce((s, x) => s + x.value, 0);
    const cx = size / 2, cy = size / 2, rOuter = 92, rInner = 58;
    let start = -Math.PI / 2;

    const top = byCat.slice(0, 8);
    top.forEach((item, i) => {
      const frac = item.value / total;
      const end = start + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rOuter, start, end);
      ctx.closePath();
      ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
      ctx.fill();
      start = end;
    });

    // lubang tengah donut sesuai warna background kartu
    const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = cardBg || '#1B212B';
    ctx.fill();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#F3EFE6';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Pengeluaran', cx, cy - 8);
    ctx.font = '700 12px Fraunces, serif';
    ctx.fillText(formatRupiah(total), cx, cy + 10);

    const legend = document.getElementById('dash-chart-legend');
    legend.innerHTML = top.map((item, i) => {
      const pct = Math.round((item.value / total) * 100);
      return `<div class="legend-row">
        <span class="legend-dot" style="background:${CHART_PALETTE[i % CHART_PALETTE.length]}"></span>
        <span class="legend-name">${escapeHtml(item.category.name)}</span>
        <span class="legend-pct">${pct}%</span>
      </div>`;
    }).join('');
  }

  function renderTxRow(t) {
    const cat = categoryById(t.categoryId);
    const wallet = walletById(t.walletId);
    const label = cat ? cat.name : 'Tanpa kategori';
    const walletName = wallet ? wallet.name : '—';
    return `<li class="tx-row" data-tx-id="${t.id}">
      <span class="tx-icon ${t.type}">${escapeHtml(initials(label))}</span>
      <span class="tx-info">
        <span class="tx-cat">${escapeHtml(label)}</span>
        <span class="tx-meta">${formatDateShort(t.date)} · ${escapeHtml(walletName)}${t.note ? ' · ' + escapeHtml(t.note) : ''}</span>
      </span>
      <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${formatRupiah(t.amount)}</span>
    </li>`;
  }

  function bindTxRowClicks(container) {
    container.querySelectorAll('.tx-row').forEach((row) => {
      row.addEventListener('click', () => openTxModal(row.dataset.txId));
    });
  }

  /* ---------------------------------------------------------
     TRANSAKSI
  --------------------------------------------------------- */
  function renderTransaksi() {
    let list = state.transactions;
    if (state.txFilter !== 'all') list = list.filter((t) => t.type === state.txFilter);

    const groupsEl = document.getElementById('tx-groups');
    const emptyEl = document.getElementById('tx-empty');

    if (list.length === 0) {
      groupsEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    const groups = {};
    list.forEach((t) => {
      if (!groups[t.date]) groups[t.date] = [];
      groups[t.date].push(t);
    });
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    groupsEl.innerHTML = dates.map((date) => `
      <div class="tx-group-label">${formatDateLabel(date)}</div>
      <div class="tx-group-card">
        <ul class="tx-list">${groups[date].map(renderTxRow).join('')}</ul>
      </div>
    `).join('');

    bindTxRowClicks(groupsEl);
  }

  /* ---------------------------------------------------------
     DOMPET
  --------------------------------------------------------- */
  function renderDompet() {
    const list = document.getElementById('wallet-list');
    const empty = document.getElementById('wallet-empty');
    if (state.wallets.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = state.wallets.map((w) => `
      <div class="wallet-card" data-wallet-id="${w.id}">
        <div class="wallet-card-top">
          <span class="wallet-name">${escapeHtml(w.name)}</span>
          <span class="wallet-dot">${escapeHtml(initials(w.name))}</span>
        </div>
        <span class="wallet-balance">${formatRupiah(walletBalance(w))}</span>
      </div>
    `).join('');
    list.querySelectorAll('.wallet-card').forEach((card) => {
      card.addEventListener('click', () => openWalletModal(card.dataset.walletId));
    });
  }

  /* ---------------------------------------------------------
     TARGET MENABUNG
  --------------------------------------------------------- */
  function renderTarget() {
    const list = document.getElementById('goal-list');
    const empty = document.getElementById('goal-empty');
    if (state.goals.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = state.goals.map((g) => {
      const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
      return `<div class="goal-card" data-goal-id="${g.id}">
        <div class="goal-card-top">
          <div>
            <div class="goal-name">${escapeHtml(g.name)}</div>
            <div class="goal-sub">Target ${formatRupiah(g.targetAmount)}</div>
          </div>
          <span class="goal-pct">${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="goal-amounts">
          <span>${formatRupiah(g.currentAmount)} terkumpul</span>
          <span>${formatRupiah(Math.max(0, g.targetAmount - g.currentAmount))} lagi</span>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.goal-card').forEach((card) => {
      card.addEventListener('click', () => openGoalModal(card.dataset.goalId));
    });
  }

  /* ---------------------------------------------------------
     KATEGORI
  --------------------------------------------------------- */
  function renderKategori() {
    const list = document.getElementById('cat-list');
    const items = state.categories.filter((c) => c.type === state.catTypeFilter);
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Belum ada kategori</p><p class="empty-desc">Tambahkan kategori baru dengan tombol di atas.</p></div>';
      return;
    }
    list.innerHTML = items.map((c) => `
      <li class="cat-row" data-cat-id="${c.id}">
        <span class="cat-badge"></span>
        <span class="cat-row-name">${escapeHtml(c.name)}</span>
        <button class="cat-row-edit" data-action="edit" aria-label="Edit kategori">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="cat-row-del" data-action="delete" aria-label="Hapus kategori">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </li>
    `).join('');

    list.querySelectorAll('.cat-row').forEach((row) => {
      const id = row.dataset.catId;
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openCategoryModal(id));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => requestDeleteCategory(id));
    });
  }

  /* ---------------------------------------------------------
     ANALISA
  --------------------------------------------------------- */
  function renderAnalisa() {
    const now = new Date();
    const income = monthIncome(now);
    const expense = monthExpense(now);
    const selisih = income - expense;
    const savingsPct = income > 0 ? Math.round((selisih / income) * 100) : 0;

    document.getElementById('an-income').textContent = formatRupiah(income);
    document.getElementById('an-expense').textContent = formatRupiah(expense);
    const selisihEl = document.getElementById('an-selisih');
    selisihEl.textContent = formatRupiah(selisih);
    selisihEl.className = 'stat-box-value ' + (selisih >= 0 ? 'income' : 'expense');
    document.getElementById('an-savings-pct').textContent = (savingsPct > 0 ? savingsPct : 0) + '%';

    const byCat = expenseByCategory(now);
    const topEl = document.getElementById('an-top-category');
    if (byCat.length === 0) {
      topEl.innerHTML = '<p class="empty-desc">Belum ada pengeluaran bulan ini.</p>';
    } else {
      const top = byCat[0];
      const pct = expense > 0 ? Math.round((top.value / expense) * 100) : 0;
      topEl.innerHTML = `
        <span class="top-category-icon">${escapeHtml(initials(top.category.name))}</span>
        <div>
          <div class="top-category-name">${escapeHtml(top.category.name)}</div>
          <div class="top-category-amount">${formatRupiah(top.value)} · ${pct}% dari total pengeluaran</div>
        </div>`;
    }

    const insights = [];
    if (byCat.length > 0) {
      insights.push(`Pengeluaran ${byCat[0].category.name.toLowerCase()} paling besar bulan ini, mencapai ${formatRupiah(byCat[0].value)}.`);
    }
    if (income === 0 && expense === 0) {
      insights.push('Belum ada transaksi bulan ini. Mulai catat pemasukan dan pengeluaranmu.');
    } else if (expense > income) {
      insights.push('Pengeluaran lebih besar daripada pemasukan bulan ini. Coba tinjau kembali pos pengeluaran terbesar.');
    } else if (income > 0 && savingsPct >= 20) {
      insights.push(`Keuangan bulan ini masih sehat — kamu berhasil menyisihkan sekitar ${savingsPct}% dari pemasukan.`);
    } else {
      insights.push('Keuangan bulan ini masih sehat, tapi coba tingkatkan porsi tabungan bulan depan.');
    }

    document.getElementById('an-insights').innerHTML = insights.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  }

  /* ---------------------------------------------------------
     MODAL HELPERS
  --------------------------------------------------------- */
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }
  function bindModalDismiss() {
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });
  }

  function askConfirm(text, onConfirm) {
    document.getElementById('confirm-text').textContent = text;
    state.confirmCallback = onConfirm;
    openModal('modal-confirm');
  }

  /* ---------------------------------------------------------
     MODAL: TRANSAKSI
  --------------------------------------------------------- */
  function populateTxCategorySelect(type) {
    const select = document.getElementById('tx-category');
    const opts = state.categories.filter((c) => c.type === type);
    select.innerHTML = opts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }
  function populateTxWalletSelect() {
    const select = document.getElementById('tx-wallet');
    select.innerHTML = state.wallets.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  }

  function setTxTypeSegment(type) {
    document.querySelectorAll('#tx-type-segmented .segment').forEach((seg) => {
      seg.classList.toggle('active', seg.dataset.txType === type);
    });
    populateTxCategorySelect(type);
  }

  function openTxModal(id) {
    if (state.wallets.length === 0) {
      showToast('Tambahkan dompet terlebih dahulu sebelum mencatat transaksi.');
      switchView('dompet');
      return;
    }
    if (state.categories.length === 0) {
      showToast('Belum ada kategori tersedia.');
      return;
    }
    const form = document.getElementById('form-tx');
    form.reset();
    populateTxWalletSelect();

    const editing = id ? state.transactions.find((t) => t.id === id) : null;
    document.getElementById('tx-id').value = editing ? editing.id : '';
    document.getElementById('tx-modal-title').textContent = editing ? 'Edit Transaksi' : 'Tambah Transaksi';
    document.getElementById('tx-delete-btn').hidden = !editing;

    const type = editing ? editing.type : 'expense';
    setTxTypeSegment(type);

    document.getElementById('tx-amount').value = editing ? editing.amount.toLocaleString('id-ID') : '';
    document.getElementById('tx-date').value = editing ? editing.date : todayISODate();
    document.getElementById('tx-note').value = editing ? (editing.note || '') : '';

    if (editing) {
      document.getElementById('tx-category').value = editing.categoryId;
      document.getElementById('tx-wallet').value = editing.walletId;
    }

    openModal('modal-tx');
  }

  async function handleTxSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('tx-id').value || null;
    const type = document.querySelector('#tx-type-segmented .segment.active').dataset.txType;
    const amount = parseAmount(document.getElementById('tx-amount').value);

    if (amount <= 0) { showToast('Nominal harus lebih dari 0.'); return; }

    const trx = {
      id: id || undefined,
      type,
      amount,
      categoryId: document.getElementById('tx-category').value,
      walletId: document.getElementById('tx-wallet').value,
      date: document.getElementById('tx-date').value || todayISODate(),
      note: document.getElementById('tx-note').value.trim()
    };
    if (id) {
      const existing = state.transactions.find((t) => t.id === id);
      trx.createdAt = existing ? existing.createdAt : new Date().toISOString();
    }

    await DB.saveTransaction(trx);
    await reloadAll();
    closeModal('modal-tx');
    renderAll();
    showToast(id ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.');
  }

  function requestDeleteTx() {
    const id = document.getElementById('tx-id').value;
    if (!id) return;
    askConfirm('Hapus transaksi ini? Tindakan ini tidak bisa dibatalkan.', async () => {
      await DB.deleteTransaction(id);
      await reloadAll();
      closeModal('modal-tx');
      renderAll();
      showToast('Transaksi dihapus.');
    });
  }

  /* ---------------------------------------------------------
     MODAL: DOMPET
  --------------------------------------------------------- */
  function openWalletModal(id) {
    const form = document.getElementById('form-wallet');
    form.reset();
    const editing = id ? state.wallets.find((w) => w.id === id) : null;
    document.getElementById('wallet-id').value = editing ? editing.id : '';
    document.getElementById('wallet-modal-title').textContent = editing ? 'Edit Dompet' : 'Tambah Dompet';
    document.getElementById('wallet-delete-btn').hidden = !editing;
    document.getElementById('wallet-name').value = editing ? editing.name : '';
    document.getElementById('wallet-initial').value = editing ? (editing.initialBalance || 0).toLocaleString('id-ID') : '';
    document.getElementById('wallet-initial-hint').textContent = editing
      ? 'Mengubah saldo awal akan memengaruhi perhitungan saldo dompet ini.'
      : 'Saldo awal dicatat sekali saat dompet dibuat.';
    openModal('modal-wallet');
  }

  async function handleWalletSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('wallet-id').value || null;
    const name = document.getElementById('wallet-name').value.trim();
    if (!name) return;
    const wallet = {
      id: id || undefined,
      name,
      initialBalance: parseAmount(document.getElementById('wallet-initial').value)
    };
    if (id) {
      const existing = state.wallets.find((w) => w.id === id);
      wallet.createdAt = existing ? existing.createdAt : new Date().toISOString();
    }
    await DB.saveWallet(wallet);
    await reloadAll();
    closeModal('modal-wallet');
    renderAll();
    showToast(id ? 'Dompet diperbarui.' : 'Dompet ditambahkan.');
  }

  function requestDeleteWallet() {
    const id = document.getElementById('wallet-id').value;
    if (!id) return;
    const used = state.transactions.some((t) => t.walletId === id);
    if (used) {
      showToast('Dompet tidak bisa dihapus karena masih memiliki transaksi.');
      return;
    }
    askConfirm('Hapus dompet ini?', async () => {
      await DB.deleteWallet(id);
      await reloadAll();
      closeModal('modal-wallet');
      renderAll();
      showToast('Dompet dihapus.');
    });
  }

  /* ---------------------------------------------------------
     MODAL: KATEGORI
  --------------------------------------------------------- */
  function setCategoryFormType(type) {
    document.querySelectorAll('#category-type-segmented .segment').forEach((seg) => {
      seg.classList.toggle('active', seg.dataset.catFormType === type);
    });
  }

  function openCategoryModal(id) {
    const form = document.getElementById('form-category');
    form.reset();
    const editing = id ? state.categories.find((c) => c.id === id) : null;
    document.getElementById('category-id').value = editing ? editing.id : '';
    document.getElementById('category-modal-title').textContent = editing ? 'Edit Kategori' : 'Tambah Kategori';
    document.getElementById('category-delete-btn').hidden = !editing;
    document.getElementById('category-name').value = editing ? editing.name : '';
    setCategoryFormType(editing ? editing.type : state.catTypeFilter);
    openModal('modal-category');
  }

  async function handleCategorySubmit(e) {
    e.preventDefault();
    const id = document.getElementById('category-id').value || null;
    const name = document.getElementById('category-name').value.trim();
    if (!name) return;
    const type = document.querySelector('#category-type-segmented .segment.active').dataset.catFormType;
    const cat = { id: id || undefined, name, type };
    if (id) {
      const existing = state.categories.find((c) => c.id === id);
      cat.isDefault = existing ? existing.isDefault : false;
    }
    await DB.saveCategory(cat);
    await reloadAll();
    state.catTypeFilter = type;
    closeModal('modal-category');
    renderAll();
    showToast(id ? 'Kategori diperbarui.' : 'Kategori ditambahkan.');
  }

  function requestDeleteCategory(id) {
    const used = state.transactions.some((t) => t.categoryId === id);
    if (used) {
      showToast('Kategori tidak bisa dihapus karena masih dipakai transaksi.');
      return;
    }
    askConfirm('Hapus kategori ini?', async () => {
      await DB.deleteCategory(id);
      await reloadAll();
      closeModal('modal-category');
      renderAll();
      showToast('Kategori dihapus.');
    });
  }

  function requestDeleteCategoryFromModal() {
    const id = document.getElementById('category-id').value;
    if (id) requestDeleteCategory(id);
  }

  /* ---------------------------------------------------------
     MODAL: TARGET MENABUNG
  --------------------------------------------------------- */
  function openGoalModal(id) {
    const form = document.getElementById('form-goal');
    form.reset();
    const editing = id ? state.goals.find((g) => g.id === id) : null;
    document.getElementById('goal-id').value = editing ? editing.id : '';
    document.getElementById('goal-modal-title').textContent = editing ? 'Edit Target' : 'Tambah Target';
    document.getElementById('goal-delete-btn').hidden = !editing;
    document.getElementById('goal-name').value = editing ? editing.name : '';
    document.getElementById('goal-target').value = editing ? (editing.targetAmount || 0).toLocaleString('id-ID') : '';
    document.getElementById('goal-current').value = editing ? (editing.currentAmount || 0).toLocaleString('id-ID') : '';
    openModal('modal-goal');
  }

  async function handleGoalSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('goal-id').value || null;
    const name = document.getElementById('goal-name').value.trim();
    const targetAmount = parseAmount(document.getElementById('goal-target').value);
    const currentAmount = parseAmount(document.getElementById('goal-current').value);
    if (!name || targetAmount <= 0) { showToast('Lengkapi nama dan nominal target.'); return; }
    const goal = { id: id || undefined, name, targetAmount, currentAmount };
    if (id) {
      const existing = state.goals.find((g) => g.id === id);
      goal.createdAt = existing ? existing.createdAt : new Date().toISOString();
    }
    await DB.saveGoal(goal);
    await reloadAll();
    closeModal('modal-goal');
    renderAll();
    showToast(id ? 'Target diperbarui.' : 'Target ditambahkan.');
  }

  function requestDeleteGoal() {
    const id = document.getElementById('goal-id').value;
    if (!id) return;
    askConfirm('Hapus target tabungan ini?', async () => {
      await DB.deleteGoal(id);
      await reloadAll();
      closeModal('modal-goal');
      renderAll();
      showToast('Target dihapus.');
    });
  }

  /* ---------------------------------------------------------
     PENGATURAN: EXPORT / IMPORT / RESET
  --------------------------------------------------------- */
  async function handleExport() {
    const payload = await DB.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `bukukas-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup berhasil diunduh.');
  }

  function handleImportClick() {
    document.getElementById('import-file-input').click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        askConfirm('Mengimpor backup akan mengganti seluruh data saat ini. Lanjutkan?', async () => {
          await DB.importAll(payload);
          await reloadAll();
          renderAll();
          showToast('Data berhasil diimpor.');
        });
      } catch (err) {
        showToast('File backup tidak valid.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function handleReset() {
    askConfirm('Semua dompet, transaksi, kategori, dan target akan dihapus permanen. Lanjutkan?', async () => {
      await DB.resetAll();
      await reloadAll();
      renderAll();
      showToast('Semua data telah direset.');
    });
  }

  /* ---------------------------------------------------------
     BIND EVENTS
  --------------------------------------------------------- */
  function bindNav() {
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', () => switchView(el.dataset.nav));
    });
  }

  function bindDashboard() {
    document.getElementById('btn-open-add-tx').addEventListener('click', () => openTxModal(null));
  }

  function bindTransaksi() {
    document.getElementById('tx-filter').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.txFilter = chip.dataset.filter;
      document.querySelectorAll('#tx-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderTransaksi();
    });
  }

  function bindTxForm() {
    document.getElementById('form-tx').addEventListener('submit', handleTxSubmit);
    document.getElementById('tx-delete-btn').addEventListener('click', requestDeleteTx);
    document.querySelectorAll('#tx-type-segmented .segment').forEach((seg) => {
      seg.addEventListener('click', () => setTxTypeSegment(seg.dataset.txType));
    });
    formatAmountInputLive(document.getElementById('tx-amount'));
  }

  function bindWallet() {
    document.getElementById('btn-add-wallet').addEventListener('click', () => openWalletModal(null));
    document.getElementById('form-wallet').addEventListener('submit', handleWalletSubmit);
    document.getElementById('wallet-delete-btn').addEventListener('click', requestDeleteWallet);
    formatAmountInputLive(document.getElementById('wallet-initial'));
  }

  function bindGoal() {
    document.getElementById('btn-add-goal').addEventListener('click', () => openGoalModal(null));
    document.getElementById('form-goal').addEventListener('submit', handleGoalSubmit);
    document.getElementById('goal-delete-btn').addEventListener('click', requestDeleteGoal);
    formatAmountInputLive(document.getElementById('goal-target'));
    formatAmountInputLive(document.getElementById('goal-current'));
  }

  function bindKategori() {
    document.getElementById('btn-add-category').addEventListener('click', () => openCategoryModal(null));
    document.getElementById('form-category').addEventListener('submit', handleCategorySubmit);
    document.getElementById('category-delete-btn').addEventListener('click', requestDeleteCategoryFromModal);
    document.querySelectorAll('#category-type-segmented .segment').forEach((seg) => {
      seg.addEventListener('click', () => setCategoryFormType(seg.dataset.catFormType));
    });
    document.getElementById('cat-segmented').addEventListener('click', (e) => {
      const seg = e.target.closest('.segment');
      if (!seg) return;
      state.catTypeFilter = seg.dataset.catType;
      document.querySelectorAll('#cat-segmented .segment').forEach((s) => s.classList.toggle('active', s === seg));
      renderKategori();
    });
  }

  function bindPengaturan() {
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('settings-theme-switch').addEventListener('click', toggleTheme);
    document.getElementById('btn-export').addEventListener('click', handleExport);
    document.getElementById('btn-import').addEventListener('click', handleImportClick);
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);
    document.getElementById('btn-reset').addEventListener('click', handleReset);
  }

  function bindConfirmModal() {
    document.getElementById('confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
    document.getElementById('confirm-ok').addEventListener('click', async () => {
      const cb = state.confirmCallback;
      state.confirmCallback = null;
      closeModal('modal-confirm');
      if (cb) await cb();
    });
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  async function init() {
    initTheme();
    await DB.init();
    await reloadAll();

    bindNav();
    bindDashboard();
    bindTransaksi();
    bindTxForm();
    bindWallet();
    bindGoal();
    bindKategori();
    bindPengaturan();
    bindModalDismiss();
    bindConfirmModal();

    switchView('dashboard');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
