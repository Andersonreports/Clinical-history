// Clinical History Tracker - Clinical OS Logic

const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxXXajUy5_1komoDIFidxrLuehfHVUUTZRlZnfeeTEI68GElYdvJGOvVI16gLPmhmZg/exec';
const LOCAL_DATA_PATH = 'data.json';
const AUTO_SYNC_INTERVAL = 30000; // 30 seconds

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
    itemsPerPage: 50,
    selectedIndex: -1
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initEventListeners();
    loadData();
    
    // Auto-sync every 30 seconds
    setInterval(() => {
        syncData(true); // silent sync
    }, AUTO_SYNC_INTERVAL);
});

function initEventListeners() {
    const searchInput = document.getElementById('main-search');
    if (searchInput) searchInput.addEventListener('input', handleSearch);
    
    const testFilter = document.getElementById('test-filter');
    if (testFilter) testFilter.addEventListener('change', handleFilterChange);

    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', () => syncData(false));

    const closePanel = document.getElementById('close-panel');
    const overlay = document.getElementById('panel-overlay');
    if (closePanel) closePanel.onclick = closeSidePanel;
    if (overlay) overlay.onclick = closeSidePanel;

    // Interactive Dashboard Cards (Primary Status Filters)
    const btnTotal = document.getElementById('btn-stat-total');
    const btnComplete = document.getElementById('btn-stat-complete');
    const btnPending = document.getElementById('btn-stat-pending');

    if (btnTotal) btnTotal.onclick = () => {
        updateCardActiveState('all');
        state.filters.status = 'all';
        state.currentPage = 1;
        applyFilters();
    };
    if (btnComplete) btnComplete.onclick = () => {
        updateCardActiveState('available');
        state.filters.status = 'available';
        state.currentPage = 1;
        applyFilters();
    };
    if (btnPending) btnPending.onclick = () => {
        updateCardActiveState('needed');
        state.filters.status = 'needed';
        state.currentPage = 1;
        applyFilters();
    };

    // Global Shortcuts
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
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<i data-lucide="check"></i> <span>Copied!</span>';
                    copyBtn.style.background = 'var(--success)';
                    showToast('Clinical writeup copied to clipboard');
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.background = 'var(--primary)';
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                    }, 2000);
                });
            }
        });
    }
}

function updateCardActiveState(status) {
    document.querySelectorAll('.pro-card').forEach(c => c.classList.remove('active'));
    const badge = document.getElementById('current-filter-name');
    
    if (status === 'all') {
        document.getElementById('btn-stat-total').classList.add('active');
        if (badge) badge.textContent = 'All Records';
    } else if (status === 'available') {
        document.getElementById('btn-stat-complete').classList.add('active');
        if (badge) badge.textContent = 'History Available';
    } else if (status === 'needed') {
        document.getElementById('btn-stat-pending').classList.add('active');
        if (badge) badge.textContent = 'History Required';
    }
}

function resetUIFilters() {
    console.log('Resetting all UI filters...');
    state.filters = { month: 'all', test: 'all', status: 'all' };
    state.searchQuery = '';
    state.currentPage = 1;

    const sInput = document.getElementById('main-search');
    if (sInput) sInput.value = '';
    
    const tFilter = document.getElementById('test-filter');
    if (tFilter) tFilter.value = 'all';
    
    // Reset cards to "All"
    updateCardActiveState('all');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const allNavItem = document.querySelector('.nav-item[data-month="all"]');
    if (allNavItem) allNavItem.classList.add('active');
}

async function loadData(forceRefresh = false, silent = false) {
    if (!silent) showLoading(true);
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
                rawData = await fetchFromSyncSource();
            }
        }
        
        state.data = normalizeData(rawData);
        state.filteredData = [...state.data];
        
        populateSidebar();
        populateFilters();
        updateStats();
        renderGrid();
        
        if (forceRefresh && !silent) showToast('Database Synced Successfully.');
    } catch (error) {
        console.error('Data Sync Error:', error);
        if (!silent) showToast('Sync Failed. Check network connection.', 'error');
    } finally {
        if (!silent) showLoading(false);
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

function normalizeMonth(m) {
    if (!m || m.toLowerCase().includes('sheet')) return 'ACTIVE';
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const fullMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    let str = m.toString().toUpperCase().replace(/\s+/g, '');
    let foundMonth = -1;
    let foundYear = '';
    for (let i = 0; i < 12; i++) {
        if (str.includes(months[i]) || str.includes(fullMonths[i])) {
            foundMonth = i;
            break;
        }
    }
    const yearMatch = str.match(/\d{4}/);
    if (yearMatch) foundYear = yearMatch[0];
    if (foundMonth !== -1 && foundYear) return `${months[foundMonth]} ${foundYear}`;
    return m.toString().toUpperCase();
}

function getMonthSortValue(m) {
    if (m === 'ACTIVE') return 999999;
    const parts = m.split(' ');
    if (parts.length !== 2) return 0;
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthIdx = months.indexOf(parts[0]);
    const year = parseInt(parts[1]);
    return (year * 100) + monthIdx;
}

function getTestCategory(name) {
    if (!name) return 'Other';
    const n = name.toString().toUpperCase().trim();
    if (n.includes('CARRIER') || n.includes('SCREENING')) return 'CARRIER SCREENING';
    if (n.includes('WES') || n.includes('EXOME') || n.includes('SEQUENCING')) return 'WES';
    if (n.includes('CMA') || n.includes('ARRAY') || n.includes('MICROARRAY')) return 'CMA';
    if (n.includes('KARYOTYPE') || n.includes('BANDING')) return 'KARYOTYPE';
    if (n.includes('NIPT') || n.includes('NIPS') || n.includes('NON INVASIVE')) return 'NIPT';
    if (n.includes('NGS') || n.includes('PANEL') || n.includes('FOCUS')) return 'GENE PANEL';
    if (n.includes('QF') || n.includes('PCR')) return 'QF-PCR';
    if (n.includes('SANGER')) return 'SANGER';
    if (n.includes('MLPA')) return 'MLPA';
    if (n.includes('FRAGILE')) return 'FRAGILE X';
    if (n.includes('SMA')) return 'SMA';
    return 'Other';
}

function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(row => row && (row['Sample Name'] || row['Anderson ID'] || row['SAMPLE NAME'] || row['ANDERSON ID'])).map(row => {
        const sampleName = row['Sample Name'] || row['SAMPLE NAME'] || 'N/A';
        const andersonId = row['Anderson ID'] || row['ANDERSON ID'] || 'N/A';
        const testName = row['Test Name'] || row['TEST NAME'] || 'Unknown Test';
        const testCategory = getTestCategory(testName);
        const client = row['Client'] || row['Client '] || row['CLIENT'] || '-';
        const history = row['Clinical History writeup'] || row['CLINICAL HISTORY WRITEUP'] || '';
        const month = normalizeMonth(row['Month']);
        const remark = row['Remark'] || row['REMARK'] || '';
        const trfReport = row['TRF AND REPORTS'] || row['TRF AND REPORT'] || row['TRF and Reports'] || '';
        const hasHistory = trfReport && trfReport.toString().trim().length > 0 && trfReport.toString().toLowerCase() !== 'nan';

        return {
            sampleName, andersonId, testName, testCategory, client, history, trfReport, month, remark, hasHistory
        };
    });
}

function populateSidebar() {
    const nav = document.getElementById('sidebar-months');
    if (!nav) return;
    const rawMonths = [...new Set(state.data.map(item => item.month))].filter(Boolean);
    const sortedMonths = rawMonths.sort((a, b) => getMonthSortValue(b) - getMonthSortValue(a));
    nav.innerHTML = '<div class="nav-label">Global View</div>';
    
    const allItem = document.createElement('div');
    allItem.className = `nav-item ${state.filters.month === 'all' ? 'active' : ''}`;
    allItem.id = 'sidebar-all-records';
    allItem.dataset.month = 'all';
    allItem.innerHTML = '<i data-lucide="globe"></i> <span>All Records</span>';
    allItem.onclick = () => {
        resetUIFilters();
        applyFilters();
    };
    nav.appendChild(allItem);
    
    nav.innerHTML += '<div class="nav-label">By Month</div>';
    sortedMonths.forEach(m => {
        const item = document.createElement('div');
        item.className = `nav-item ${state.filters.month === m ? 'active' : ''}`;
        item.dataset.month = m;
        item.innerHTML = `<i data-lucide="calendar"></i> <span>${m}</span>`;
        item.onclick = () => selectMonth(m, item);
        nav.appendChild(item);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function selectMonth(m, el) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    state.filters.month = m;
    state.currentPage = 1;
    applyFilters();
}

function populateFilters() {
    const categories = [...new Set(state.data.map(item => item.testCategory))].filter(Boolean).sort();
    const tSelect = document.getElementById('test-filter');
    if (tSelect) {
        const current = tSelect.value;
        tSelect.innerHTML = '<option value="all">All Test Categories</option>';
        categories.forEach(c => { tSelect.innerHTML += `<option value="${c}">${c}</option>`; });
        tSelect.value = current || 'all';
    }
}

function updateStats() {
    const total = state.data.length;
    const complete = state.data.filter(i => i.hasHistory).length;
    const pending = total - complete;
    const sTotal = document.getElementById('stat-total');
    const sComplete = document.getElementById('stat-complete');
    const sPending = document.getElementById('stat-pending');
    if (sTotal) sTotal.textContent = total.toLocaleString();
    if (sComplete) sComplete.textContent = complete.toLocaleString();
    if (sPending) sPending.textContent = pending.toLocaleString();
}

function handleSearch(e) {
    state.searchQuery = e.target.value.toLowerCase();
    state.currentPage = 1;
    applyFilters();
}

function handleFilterChange() {
    const tFilter = document.getElementById('test-filter');
    if (tFilter) state.filters.test = tFilter.value;
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
        const matchesTest = state.filters.test === 'all' || item.testCategory === state.filters.test;
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
        body.innerHTML = `<tr><td colspan="6" style="padding: 100px; text-align:center; color: var(--text-dim);">
            <i data-lucide="inbox" style="width:48px; height:48px; opacity:0.1; margin-bottom:15px;"></i>
            <p style="font-weight:600;">No cases found in this view</p>
        </td></tr>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        renderPagination(0);
        return;
    }
    pageData.forEach((item, index) => {
        const absoluteIndex = start + index;
        const tr = document.createElement('tr');
        tr.onclick = () => openSidePanel(absoluteIndex);
        tr.innerHTML = `
            <td>
                <div class="identity-cell">
                    <span class="name">${item.sampleName}</span>
                    <span class="sub">${item.client.substring(0, 50)}</span>
                </div>
            </td>
            <td><code class="token-id">${item.andersonId}</code></td>
            <td>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <span class="type-badge">${item.testCategory}</span>
                    <span style="font-size:11px; color:var(--text-dim); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.testName}</span>
                </div>
            </td>
            <td style="font-weight:600; font-size:12px;">${item.month}</td>
            <td>
                <div class="status-dot-badge">
                    <div class="dot ${item.hasHistory ? 'ok' : 'missing'}"></div>
                    <span>${item.hasHistory ? 'Completed' : 'Action Required'}</span>
                </div>
            </td>
            <td style="text-align:right;">
                <button class="btn-sync-pro" style="padding: 5px 12px; box-shadow:none; border:1px solid var(--border); font-size:11px;">DETAILS</button>
            </td>
        `;
        body.appendChild(tr);
    });
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) infoEl.textContent = `Displaying ${start + 1}-${end} of ${state.filteredData.length} records`;
    renderPagination(state.filteredData.length);
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    document.getElementById('d-trf').textContent = item.trfReport || 'No TRF information found.';
    document.getElementById('d-history').textContent = item.history || 'NO CLINICAL WRITEUP PROVIDED';
    document.getElementById('d-remark').textContent = item.remark || 'No specific registry remarks.';
    document.getElementById('side-panel').classList.add('open');
    document.getElementById('panel-overlay').classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeSidePanel() {
    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('panel-overlay').classList.remove('active');
}

function showLoading(show) {
    const btn = document.getElementById('sync-btn');
    if (btn) {
        if (show) {
            btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> <span>Syncing...</span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> <span>Refresh Data</span>';
            btn.disabled = false;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.style.borderLeft = `5px solid ${type === 'error' ? 'var(--danger)' : 'var(--success)'}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

async function syncData(silent = false) {
    await loadData(true, silent);
}
