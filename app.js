// Clinical History Tracker - Grid Workspace Logic

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
    itemsPerPage: 50, // Higher density for grid
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

    const closePanel = document.getElementById('close-panel');
    const overlay = document.getElementById('panel-overlay');
    if (closePanel) closePanel.onclick = closeSidePanel;
    if (overlay) overlay.onclick = closeSidePanel;
    
    // Global Shortcut
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            if (searchInput) searchInput.focus();
        }
        if (e.key === 'Escape') closeSidePanel();
    });

    // Copy Action
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const historyEl = document.getElementById('d-history');
            if (historyEl) {
                const text = historyEl.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    showToast('History copied to clipboard');
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
            try {
                const response = await fetch(LOCAL_DATA_PATH);
                if (response.ok) {
                    rawData = await response.json();
                } else {
                    throw new Error('Local data file not found');
                }
            } catch (err) {
                console.warn('Local load failed, syncing live...', err);
                rawData = await fetchFromSyncSource();
            }
        }
        
        state.data = normalizeData(rawData);
        state.filteredData = [...state.data];
        
        populateFilters();
        updateStats();
        renderGrid();
        
        if (forceRefresh) showToast('Grid data synchronized');
    } catch (error) {
        console.error('Data Sync Error:', error);
        showToast('Sync failed. Check Apps Script URL.', 'error');
    } finally {
        showLoading(false);
    }
}

async function fetchFromSyncSource() {
    if (SYNC_URL.includes('script.google.com')) {
        const response = await fetch(SYNC_URL);
        if (!response.ok) throw new Error('Apps Script unreachable');
        return await response.json();
    } else {
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
        const trfReport = row['TRF AND REPORTS'] || row['TRF AND REPORT'] || row['TRF and Reports'] || '';
        const hasHistory = trfReport && trfReport.toString().trim().length > 0 && trfReport.toString().toLowerCase() !== 'nan';

        return {
            sampleName, andersonId, testName, client, history, trfReport, month, remark, hasHistory
        };
    });
}

function populateFilters() {
    const months = [...new Set(state.data.map(item => item.month))].filter(Boolean).sort((a, b) => b.localeCompare(a));
    const tests = [...new Set(state.data.map(item => item.testName))].filter(Boolean).sort();

    const mSelect = document.getElementById('month-filter');
    const tSelect = document.getElementById('test-filter');

    if (mSelect) {
        const current = mSelect.value;
        mSelect.innerHTML = '<option value="all">All Months</option>';
        months.forEach(m => { mSelect.innerHTML += `<option value="${m}">${m}</option>`; });
        mSelect.value = current || 'all';
    }

    if (tSelect) {
        const current = tSelect.value;
        tSelect.innerHTML = '<option value="all">All Test Types</option>';
        tests.forEach(t => { tSelect.innerHTML += `<option value="${t}">${t.substring(0, 30)}</option>`; });
        tSelect.value = current || 'all';
    }
}

function updateStats() {
    const total = state.data.length;
    const complete = state.data.filter(i => i.hasHistory).length;
    
    document.getElementById('stat-total').textContent = total.toLocaleString();
    document.getElementById('stat-complete').textContent = complete.toLocaleString();
    document.getElementById('stat-pending').textContent = (total - complete).toLocaleString();
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

    renderGrid();
}

function renderGrid() {
    const body = document.getElementById('grid-body');
    if (!body) return;
    
    body.innerHTML = '';

    const start = (state.currentPage - 1) * state.itemsPerPage;
    const end = Math.min(start + state.itemsPerPage, state.filteredData.length);
    const pageData = state.filteredData.slice(start, end);

    if (pageData.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="padding: 100px; text-align:center; color: var(--text-muted);">No records found matching filters</td></tr>';
        renderPagination(0);
        return;
    }

    pageData.forEach((item, index) => {
        const absoluteIndex = start + index;
        const tr = document.createElement('tr');
        tr.onclick = () => openSidePanel(absoluteIndex);
        
        tr.innerHTML = `
            <td><div style="font-weight: 600;">${item.sampleName}</div></td>
            <td><code style="font-size: 11px;">${item.andersonId}</code></td>
            <td>${item.testName}</td>
            <td>${item.month}</td>
            <td>
                <span class="status-badge ${item.hasHistory ? 'available' : 'missing'}">
                    ${item.hasHistory ? 'History OK' : 'Missing'}
                </span>
            </td>
            <td>
                <button class="btn btn-sm" style="padding: 2px 8px; font-size: 10px;">VIEW</button>
            </td>
        `;
        body.appendChild(tr);
    });

    document.getElementById('pagination-info').textContent = `Showing ${start + 1}-${end} of ${state.filteredData.length}`;
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
            if(!disabled) { state.currentPage = page; renderGrid(); } 
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

function openSidePanel(index) {
    const item = state.filteredData[index];
    if (!item) return;
    
    document.getElementById('d-name').textContent = item.sampleName;
    document.getElementById('d-id').textContent = item.andersonId;
    document.getElementById('d-test').textContent = item.testName;
    document.getElementById('d-month').textContent = item.month;
    document.getElementById('d-client').textContent = item.client;
    document.getElementById('d-trf').textContent = item.trfReport || 'No TRF information available.';
    document.getElementById('d-history').textContent = item.history || 'NO HISTORY WRITTEN';
    document.getElementById('d-remark').textContent = item.remark || 'No remarks.';
    
    document.getElementById('side-panel').classList.add('open');
    document.getElementById('panel-overlay').classList.add('active');
}

function closeSidePanel() {
    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('panel-overlay').classList.remove('active');
}

function showLoading(show) {
    const btn = document.getElementById('sync-btn');
    if (btn) {
        if (show) {
            btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Syncing...</span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Sync Live Data</span>';
            btn.disabled = false;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.style.borderLeft = `4px solid ${type === 'error' ? '#ef4444' : '#10b981'}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

async function syncData() {
    await loadData(true);
}
