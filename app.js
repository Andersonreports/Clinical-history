// Clinical History Tracker - Utility App Logic

// REPLACEME: Paste your Google Apps Script Web App URL here for live multi-sheet sync
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxXXafajUy5_1komoDIFidxrLuehfHVUUTZRlZnfeeTEI68GElYdvJGOvVI16gLPmhmZg/exec';
const LOCAL_DATA_PATH = 'data.json';

let state = {
    data: [],
    filteredData: [],
    searchQuery: '',
    filters: {
        month: 'all',
        test: 'all',
        status: 'all'
    },
    currentPage: 1,
    itemsPerPage: 20,
    selectedIndex: -1
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initEventListeners();
    loadData();
});

function initEventListeners() {
    const searchInput = document.getElementById('main-search');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    const monthFilter = document.getElementById('month-filter');
    if (monthFilter) monthFilter.addEventListener('change', handleFilterChange);

    const testFilter = document.getElementById('test-filter');
    if (testFilter) testFilter.addEventListener('change', handleFilterChange);

    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) statusFilter.addEventListener('change', handleFilterChange);

    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', syncData);

    // Global Shortcut
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            if (searchInput) searchInput.focus();
        }
    });

    // Copy Action
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const historyEl = document.getElementById('d-history');
            if (historyEl) {
                const text = historyEl.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    showToast('Clinical history copied');
                });
            }
        });
    }
}

async function loadData(forceRefresh = false) {
    showLoading(true);
    try {
        let rawData;
        if (forceRefresh) {
            rawData = await fetchFromSyncSource();
        } else {
            const response = await fetch(LOCAL_DATA_PATH);
            if (response.ok) {
                rawData = await response.json();
            } else {
                rawData = await fetchFromSyncSource();
            }
        }

        state.data = normalizeData(rawData);
        state.filteredData = [...state.data];

        populateFilters();
        updateStats();
        renderList();

        if (forceRefresh) showToast('Tracker synchronized across all sheets');
    } catch (error) {
        console.error('Data Sync Error:', error);
        showToast('Sync failed. Please check Apps Script deployment.', 'error');
    } finally {
        showLoading(false);
    }
}

async function fetchFromSyncSource() {
    // Check if SYNC_URL is an Apps Script URL (contains script.google.com) or a CSV export
    if (SYNC_URL.includes('script.google.com')) {
        const response = await fetch(SYNC_URL);
        return await response.json();
    } else {
        // Fallback to CSV for the single gid provided
        return new Promise((resolve, reject) => {
            Papa.parse(SYNC_URL, {
                download: true,
                header: true,
                complete: (results) => resolve(results.data),
                error: (error) => reject(error)
            });
        });
    }
}

function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(row => row && (row['Sample Name'] || row['Anderson ID'] || row['SAMPLE NAME'] || row['ANDERSON ID'])).map(row => {
        const sampleName = row['Sample Name'] || row['SAMPLE NAME'] || 'N/A';
        const andersonId = row['Anderson ID'] || row['ANDERSON ID'] || 'N/A';
        const testName = row['Test Name'] || row['TEST NAME'] || 'Unknown Test';
        const client = row['Client'] || row['Client '] || row['CLIENT'] || '-';
        const history = row['Clinical History writeup'] || row['CLINICAL HISTORY WRITEUP'] || '';
        const month = row['Month'] || 'Active';
        const remark = row['Remark'] || row['REMARK'] || '';

        // NEW LOGIC: Check TRF and Report column for availability
        const trfReport = row['TRF AND REPORTS'] || row['TRF AND REPORT'] || row['TRF and Reports'] || row['TRF and reports'] || '';

        // If TRF and Report has a value, history is considered "Available"
        const hasHistory = trfReport && trfReport.toString().trim().length > 0 && trfReport.toString().toLowerCase() !== 'nan';

        return {
            sampleName,
            andersonId,
            testName,
            client,
            history,
            trfReport,
            month,
            remark,
            hasHistory
        };
    });
}

function populateFilters() {
    const months = [...new Set(state.data.map(item => item.month))].filter(Boolean).sort((a, b) => {
        // Sort months roughly by recency if they contain year
        return b.localeCompare(a);
    });
    const tests = [...new Set(state.data.map(item => item.testName))].filter(Boolean).sort();

    const mSelect = document.getElementById('month-filter');
    const tSelect = document.getElementById('test-filter');

    if (mSelect) {
        const currentVal = mSelect.value;
        mSelect.innerHTML = '<option value="all">All Months</option>';
        months.forEach(m => {
            mSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
        mSelect.value = currentVal || 'all';
    }

    if (tSelect) {
        const currentVal = tSelect.value;
        tSelect.innerHTML = '<option value="all">All Tests</option>';
        tests.forEach(t => {
            tSelect.innerHTML += `<option value="${t}">${t.substring(0, 30)}</option>`;
        });
        tSelect.value = currentVal || 'all';
    }
}

function updateStats() {
    const total = state.data.length;
    const complete = state.data.filter(i => i.hasHistory).length;

    const totalEl = document.getElementById('stat-total');
    if (totalEl) totalEl.textContent = total;

    const completeEl = document.getElementById('stat-complete');
    if (completeEl) completeEl.textContent = complete;

    const pendingEl = document.getElementById('stat-pending');
    if (pendingEl) pendingEl.textContent = total - complete;
}

function handleSearch(e) {
    state.searchQuery = e.target.value.toLowerCase();
    state.currentPage = 1;
    applyFilters();
}

function handleFilterChange() {
    state.filters.month = document.getElementById('month-filter').value;
    state.filters.test = document.getElementById('test-filter').value;
    state.filters.status = document.getElementById('status-filter').value;
    state.currentPage = 1;
    applyFilters();
}

function applyFilters() {
    state.filteredData = state.data.filter(item => {
        const query = state.searchQuery;
        const matchesSearch =
            item.sampleName.toLowerCase().includes(query) ||
            item.andersonId.toString().toLowerCase().includes(query) ||
            item.testName.toLowerCase().includes(query) ||
            item.client.toLowerCase().includes(query);

        const matchesMonth = state.filters.month === 'all' || item.month === state.filters.month;
        const matchesTest = state.filters.test === 'all' || item.testName === state.filters.test;

        let matchesStatus = true;
        if (state.filters.status === 'available') matchesStatus = item.hasHistory;
        if (state.filters.status === 'needed') matchesStatus = !item.hasHistory;

        return matchesSearch && matchesMonth && matchesTest && matchesStatus;
    });

    renderList();
}

function renderList() {
    const listContainer = document.getElementById('case-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const start = (state.currentPage - 1) * state.itemsPerPage;
    const end = Math.min(start + state.itemsPerPage, state.filteredData.length);
    const pageData = state.filteredData.slice(start, end);

    if (pageData.length === 0) {
        listContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No records found</div>';
        renderPagination(0);
        return;
    }

    pageData.forEach((item, index) => {
        const absoluteIndex = start + index;
        const div = document.createElement('div');
        div.className = `case-item ${state.selectedIndex === absoluteIndex ? 'active' : ''}`;
        div.onclick = () => selectItem(absoluteIndex);

        div.innerHTML = `
            <div class="case-info">
                <span class="name">${item.sampleName}</span>
                <span class="id">${item.andersonId}</span>
            </div>
            <div class="case-status ${item.hasHistory ? 'complete' : 'pending'}"></div>
        `;
        listContainer.appendChild(div);
    });

    renderPagination(state.filteredData.length);
}

function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / state.itemsPerPage);
    const container = document.getElementById('pagination');
    if (!container) return;

    container.innerHTML = '';

    if (totalPages <= 1) return;

    const createBtn = (content, page, active = false, disabled = false) => {
        const btn = document.createElement('button');
        btn.className = `page-btn ${active ? 'active' : ''}`;
        btn.innerHTML = content;
        btn.disabled = disabled;
        btn.onclick = (e) => {
            e.stopPropagation();
            if (!disabled) {
                state.currentPage = page;
                renderList();
            }
        };
        return btn;
    };

    container.appendChild(createBtn('&laquo;', state.currentPage - 1, false, state.currentPage === 1));

    let start = Math.max(1, state.currentPage - 1);
    let end = Math.min(totalPages, start + 2);
    if (end - start < 2) start = Math.max(1, end - 2);

    for (let i = start; i <= end; i++) {
        container.appendChild(createBtn(i, i, i === state.currentPage));
    }

    container.appendChild(createBtn('&raquo;', state.currentPage + 1, false, state.currentPage === totalPages));
}

function selectItem(index) {
    state.selectedIndex = index;
    const item = state.filteredData[index];
    if (!item) return;

    const emptyState = document.getElementById('empty-state');
    const workspaceContent = document.getElementById('workspace-content');

    if (emptyState) emptyState.style.display = 'none';
    if (workspaceContent) workspaceContent.style.display = 'block';

    const nameEl = document.getElementById('d-name');
    if (nameEl) nameEl.textContent = item.sampleName;

    const idEl = document.getElementById('d-id');
    if (idEl) idEl.textContent = `ID: ${item.andersonId}`;

    const testEl = document.getElementById('d-test');
    if (testEl) testEl.textContent = item.testName;

    const clientEl = document.getElementById('d-client');
    if (clientEl) clientEl.textContent = item.client;

    const monthEl = document.getElementById('d-month');
    if (monthEl) monthEl.textContent = item.month;

    const historyEl = document.getElementById('d-history');
    if (historyEl) historyEl.textContent = item.history || 'NO WRITEUP AVAILABLE';

    const remarkEl = document.getElementById('d-remark');
    if (remarkEl) remarkEl.textContent = item.remark || 'N/A';

    const trfEl = document.getElementById('d-trf-info');
    if (trfEl) trfEl.textContent = item.trfReport || 'No TRF/Report information available.';

    const statusPill = document.getElementById('d-status');
    if (statusPill) {
        statusPill.textContent = item.hasHistory ? 'History Available' : 'Needs History';
        statusPill.style.background = item.hasHistory ? '#ecfdf5' : '#fef2f2';
        statusPill.style.color = item.hasHistory ? '#059669' : '#dc2626';
    }

    renderList();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showLoading(show) {
    const btn = document.getElementById('sync-btn');
    if (btn) {
        if (show) {
            btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Syncing...</span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Sync Live</span>';
            btn.disabled = false;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.style.background = type === 'error' ? '#ef4444' : '#0f172a';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

async function syncData() {
    await loadData(true);
}
