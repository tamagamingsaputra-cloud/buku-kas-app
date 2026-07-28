/* ============================================================
   database.js — Lapisan akses data (IndexedDB)
   Buku Kas menyimpan seluruh data transaksional di IndexedDB.
   LocalStorage HANYA dipakai untuk pengaturan aplikasi (tema, dll)
   yang diatur di script.js, bukan di sini.
   ============================================================ */

const DB_NAME = 'bukukas-db';
const DB_VERSION = 1;

const STORES = {
  wallets: 'wallets',
  categories: 'categories',
  transactions: 'transactions',
  goals: 'goals'
};

let _dbPromise = null;

/** Membuka (atau membuat) koneksi database. Di-cache supaya hanya sekali. */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.wallets)) {
        db.createObjectStore(STORES.wallets, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.categories)) {
        const catStore = db.createObjectStore(STORES.categories, { keyPath: 'id' });
        catStore.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.transactions)) {
        const txStore = db.createObjectStore(STORES.transactions, { keyPath: 'id' });
        txStore.createIndex('date', 'date', { unique: false });
        txStore.createIndex('walletId', 'walletId', { unique: false });
        txStore.createIndex('categoryId', 'categoryId', { unique: false });
        txStore.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.goals)) {
        db.createObjectStore(STORES.goals, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });

  return _dbPromise;
}

function genId() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

/** Helper generik untuk transaksi IndexedDB */
async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);

    tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return reqToPromise(store.getAll());
}

async function getById(storeName, id) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return reqToPromise(store.get(id));
}

async function putItem(storeName, item) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(item);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteItem(storeName, id) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ===================== Kategori default ===================== *
 * Sesuai brief: kategori default dibuat sekali di awal supaya
 * pengguna langsung bisa mencatat transaksi. Ini BUKAN data
 * transaksi contoh — buku kas (transaksi & dompet) tetap kosong.
 * ============================================================= */
const DEFAULT_CATEGORIES = [
  { name: 'Gaji', type: 'income' },
  { name: 'Bonus', type: 'income' },
  { name: 'Lainnya', type: 'income' },
  { name: 'Makan', type: 'expense' },
  { name: 'Transportasi', type: 'expense' },
  { name: 'Belanja', type: 'expense' },
  { name: 'Pendidikan', type: 'expense' },
  { name: 'Kesehatan', type: 'expense' },
  { name: 'Hiburan', type: 'expense' },
  { name: 'Lainnya', type: 'expense' }
];

async function ensureDefaultCategories() {
  const existing = await getAll(STORES.categories);
  if (existing.length > 0) return;
  const db = await openDB();
  const tx = db.transaction(STORES.categories, 'readwrite');
  const store = tx.objectStore(STORES.categories);
  DEFAULT_CATEGORIES.forEach((c) => {
    store.put({ id: genId(), name: c.name, type: c.type, isDefault: true });
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ===================== API Publik ===================== */

const DB = {
  init: async function () {
    await openDB();
    await ensureDefaultCategories();
  },

  // Wallets
  getWallets: () => getAll(STORES.wallets),
  getWallet: (id) => getById(STORES.wallets, id),
  saveWallet: (wallet) => {
    if (!wallet.id) wallet.id = genId();
    if (!wallet.createdAt) wallet.createdAt = new Date().toISOString();
    return putItem(STORES.wallets, wallet);
  },
  deleteWallet: (id) => deleteItem(STORES.wallets, id),

  // Categories
  getCategories: () => getAll(STORES.categories),
  saveCategory: (cat) => {
    if (!cat.id) cat.id = genId();
    return putItem(STORES.categories, cat);
  },
  deleteCategory: (id) => deleteItem(STORES.categories, id),

  // Transactions
  getTransactions: () => getAll(STORES.transactions),
  getTransaction: (id) => getById(STORES.transactions, id),
  saveTransaction: (trx) => {
    if (!trx.id) trx.id = genId();
    if (!trx.createdAt) trx.createdAt = new Date().toISOString();
    return putItem(STORES.transactions, trx);
  },
  deleteTransaction: (id) => deleteItem(STORES.transactions, id),

  // Savings goals
  getGoals: () => getAll(STORES.goals),
  saveGoal: (goal) => {
    if (!goal.id) goal.id = genId();
    if (!goal.createdAt) goal.createdAt = new Date().toISOString();
    return putItem(STORES.goals, goal);
  },
  deleteGoal: (id) => deleteItem(STORES.goals, id),

  // Backup / restore
  exportAll: async function () {
    const [wallets, categories, transactions, goals] = await Promise.all([
      getAll(STORES.wallets),
      getAll(STORES.categories),
      getAll(STORES.transactions),
      getAll(STORES.goals)
    ]);
    return {
      app: 'buku-kas',
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      data: { wallets, categories, transactions, goals }
    };
  },

  importAll: async function (payload) {
    if (!payload || !payload.data) throw new Error('Format backup tidak valid');
    const { wallets = [], categories = [], transactions = [], goals = [] } = payload.data;
    await clearStore(STORES.wallets);
    await clearStore(STORES.categories);
    await clearStore(STORES.transactions);
    await clearStore(STORES.goals);

    const db = await openDB();
    const tx = db.transaction(
      [STORES.wallets, STORES.categories, STORES.transactions, STORES.goals],
      'readwrite'
    );
    wallets.forEach((w) => tx.objectStore(STORES.wallets).put(w));
    categories.forEach((c) => tx.objectStore(STORES.categories).put(c));
    transactions.forEach((t) => tx.objectStore(STORES.transactions).put(t));
    goals.forEach((g) => tx.objectStore(STORES.goals).put(g));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  resetAll: async function () {
    await clearStore(STORES.wallets);
    await clearStore(STORES.categories);
    await clearStore(STORES.transactions);
    await clearStore(STORES.goals);
    await ensureDefaultCategories();
  },

  genId
};
