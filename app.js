// DOM Elements
const sheetUrlInput = document.getElementById('sheet-url');
const btnSync = document.getElementById('btn-sync');
const syncStatusText = document.querySelector('#sync-status span');
const syncStatusDot = document.querySelector('#sync-status .dot');

// Permanent App Config
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby8geERj5n0MwrPgwa69G7p5giw19T9HKfRyyRD1Amf0fbwMsk8MeceeVzxlO6EvDo/exec";
const scannerInput = document.getElementById('scanner-input');
const btnCameraScan = document.getElementById('btn-camera-scan');
const cameraBtnText = document.getElementById('camera-btn-text');
const cartBody = document.getElementById('cart-body');
const readerDiv = document.getElementById('reader');
const btnClear = document.getElementById('btn-clear');
const btnCheckout = document.getElementById('btn-checkout');
const subtotalVal = document.getElementById('subtotal-val');
const totalVal = document.getElementById('total-val');

// Receipt DOM Elements
const receiptItems = document.getElementById('receipt-items');
const receiptDate = document.getElementById('receipt-date');
const receiptTotalVal = document.getElementById('receipt-total-val');

// App State
let database = new Map(); // Store products mapped by ISBN
let cart = []; // Store cart items

/**
 * JSON JSONP Callback function
 */
window.gvizCallback = function (data) {
    const btnText = btnSync.querySelector('.btn-text');
    const loader = btnSync.querySelector('.loader');

    try {
        if (!data || !data.table || !data.table.rows) throw new Error("Invalid data format received.");

        const cols = data.table.cols.map(c => (c.label || '').toLowerCase());

        let isbnIdx = cols.findIndex(h => h.includes('id') || h.includes('isbn') || h.includes('code'));
        let nameIdx = cols.findIndex(h => h.includes('name') || h.includes('product') || h.includes('title') || h.includes('item'));
        let priceIdx = cols.findIndex(h => h.includes('price') || h.includes('cost') || h.includes('amount'));

        if (isbnIdx === -1) isbnIdx = 0;
        if (nameIdx === -1) nameIdx = 1;
        if (priceIdx === -1) priceIdx = 2;

        const products = [];
        data.table.rows.forEach(row => {
            const isbnCell = row.c[isbnIdx];
            const nameCell = row.c[nameIdx];
            const priceCell = row.c[priceIdx];

            if (isbnCell && isbnCell.v != null) {
                // Formatting might be needed for numbers avoiding scientific notation, but String() usually works for standard ISBNs
                let isbnVal = isbnCell.f ? String(isbnCell.f).replace(/\,/g, '') : String(isbnCell.v);
                let nameVal = nameCell && nameCell.v != null ? String(nameCell.v) : 'Unknown';
                let priceVal = priceCell && priceCell.v != null ? parseFloat(priceCell.v) : 0;

                products.push({
                    isbn: isbnVal.replace(/\s+/g, ''),
                    name: nameVal,
                    price: priceVal
                });
            }
        });

        if (products.length === 0) throw new Error("No valid data found in sheet");

        // Populate database map
        database.clear();
        products.forEach(p => {
            if (p.isbn) database.set(p.isbn.toLowerCase(), p);
        });

        // Update UI
        syncStatusText.textContent = `Connected (${database.size} items)`;
        syncStatusDot.classList.remove('disconnected');
        syncStatusDot.classList.add('connected');
        scannerInput.disabled = false;
        scannerInput.focus();
        btnCameraScan.disabled = false;

    } catch (error) {
        console.error(error);
        alert('Failed to parse data. Ensure the Google Sheet is set to "Anyone with the link can view".');
        setDisconnectedState();
    } finally {
        if (btnText) btnText.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        btnSync.disabled = false;
    }
};

function setDisconnectedState() {
    syncStatusText.textContent = 'Disconnected';
    syncStatusDot.classList.add('disconnected');
    syncStatusDot.classList.remove('connected');
    scannerInput.disabled = true;
    btnCameraScan.disabled = true;
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            isScanning = false;
            cameraBtnText.textContent = "Scan with Camera";
            readerDiv.style.display = 'none';
        }).catch(err => console.log(err));
    }
}

/**
 * Handle Database Syncing via Script Injection (JSONP) to bypass CORS completely
 */
btnSync.addEventListener('click', () => {
    let url = sheetUrlInput.value.trim();
    if (!url) return alert('Please enter a Google Sheets URL');

    let docId = '';
    if (url.includes('/edit') || url.includes('/view') || url.includes('usp=sharing') || url.includes('usp=drivesdk')) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        docId = pathSegments[pathSegments.indexOf('d') + 1];
    }

    if (!docId) {
        alert("Invalid Google Sheet URL format. Try copying standard 'view' link.");
        return;
    }

    const jsonpUrl = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:json;responseHandler:gvizCallback`;

    const btnText = btnSync.querySelector('.btn-text');
    const loader = btnSync.querySelector('.loader');

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');
    btnSync.disabled = true;
    syncStatusText.textContent = 'Connecting...';

    // Remove old script if exists
    const oldScript = document.getElementById('gviz-script');
    if (oldScript) oldScript.remove();

    // Inject new script
    const script = document.createElement('script');
    script.id = 'gviz-script';
    script.src = jsonpUrl;
    script.onerror = () => {
        alert("Failed to load data. The link might be incorrect or not public.");
        setDisconnectedState();
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
        btnSync.disabled = false;
    };
    document.body.appendChild(script);
});

/**
 * Scanner Input Handling
 */
scannerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const isbn = scannerInput.value.trim().toLowerCase();
        scannerInput.value = ''; // clear input rapidly for next scan

        if (!isbn) return;

        processScan(isbn);
    }
});

let lastScannedIsbn = '';
let lastScanTime = 0;

// Helper to generate a short 'beep' sound using the Web Audio API
function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = 800; // 800Hz beep

        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Low volume

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1); // 100ms beep
    } catch (e) {
        console.log("Audio not supported or blocked", e);
    }
}

function processScan(isbn) {
    const now = Date.now();

    // Prevent rapid duplicate scans of the same barcode within 2 seconds
    if (isbn === lastScannedIsbn && (now - lastScanTime) < 2000) {
        return;
    }

    lastScannedIsbn = isbn;
    lastScanTime = now;

    // Show the user exactly what characters the scanner just read
    scannerInput.value = isbn;

    const product = database.get(isbn);
    if (product) {
        addToCart(product);
        playBeep(); // Audio feedback for success
        scannerInput.style.borderColor = 'var(--success-color)';
        setTimeout(() => scannerInput.style.borderColor = 'var(--border-color)', 500);
    } else {
        scannerInput.style.borderColor = 'var(--danger-color)';
        // Optional error beep
        alert(`Scanned barcode "${isbn}" but could not find it in the Database.\n\nPlease check the Google Sheet.`);
        setTimeout(() => scannerInput.style.borderColor = 'var(--border-color)', 500);
    }
}

/**
 * Camera Scanner Integration (html5-qrcode direct API)
 */
let html5QrCode = null;
let isScanning = false;

btnCameraScan.addEventListener('click', () => {
    if (isScanning) {
        // Stop scanning
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                isScanning = false;
                cameraBtnText.textContent = "Scan with Camera";
                btnCameraScan.style.borderColor = "var(--border-color)";
                btnCameraScan.style.color = "var(--text-primary)";
                readerDiv.style.display = 'none';
            }).catch(err => {
                console.error("Failed to stop scanner", err);
            });
        }
    } else {
        // Start scanning
        btnCameraScan.style.borderColor = "var(--success-color)";
        btnCameraScan.style.color = "var(--success-color)";
        cameraBtnText.textContent = "Starting Camera...";

        readerDiv.style.display = 'block';

        if (!html5QrCode) {
            // Remove explicit formats to let the library use its default broader heuristics
            html5QrCode = new Html5Qrcode("reader");
        }

        const config = {
            fps: 10,
            // Removing 'qrbox' and 'aspectRatio' forces the scanner 
            // to analyze the ENTIRE video frame, making it much easier for users to scan!
            disableFlip: false
        };

        // iOS Safari strict WebRTC Requirements
        const cameraConfig = { facingMode: { exact: "environment" } };

        html5QrCode.start(cameraConfig, config,
            (decodedText, decodedResult) => {
                // Success Callback: Continuous scanning mode
                console.log(`Scan result: ${decodedText}`);
                processScan(decodedText.toLowerCase());
                // Notice: We NO LONGER call .stop() here, so the camera stays open
            },
            (errorMessage) => {
                // Parse errors constantly thrown when no barcode is in front of the camera
            }
        ).then(() => {
            isScanning = true;
            cameraBtnText.textContent = "Stop Camera";
        }).catch((err) => {
            console.error("Error launching camera:", err);

            // Fallback for devices without a rear camera (e.g., some laptops or older iPads)
            if (err.name === 'OverconstrainedError' || String(err).includes('OverconstrainedError')) {
                console.warn("Rear camera not found, trying any available camera...");
                html5QrCode.start({ facingMode: "user" }, config,
                    (txt) => {
                        processScan(txt.toLowerCase());
                    },
                    (e) => { }
                ).then(() => {
                    isScanning = true;
                    cameraBtnText.textContent = "Stop Camera";
                }).catch(e => {
                    alert("Could not start any camera. Permissions might be denied.");
                    resetCameraUI();
                });
            } else {
                alert(`Camera access denied or unavailable.\n\nSafari Users: Go to Settings > Safari > Settings for Websites > Camera and ensure it is set to "Allow".\n\nError: ${err.message || err.name || err}`);
                resetCameraUI();
            }
        });
    }
});

function resetCameraUI() {
    btnCameraScan.style.borderColor = "var(--border-color)";
    btnCameraScan.style.color = "var(--text-primary)";
    cameraBtnText.textContent = "Scan with Camera";
    readerDiv.style.display = 'none';
    isScanning = false;
}

/**
 * Cart Logic
 */
function addToCart(product) {
    const existingItem = cart.find(item => item.isbn === product.isbn.toLowerCase());
    if (existingItem) {
        existingItem.qty += 1;
        renderCart();
        // highlight row
        const row = document.getElementById(`row-${existingItem.isbn}`);
        if (row) {
            row.classList.remove('highlight');
            void row.offsetWidth; // trigger reflow
            row.classList.add('highlight');
        }
    } else {
        cart.push({ ...product, qty: 1 });
        renderCart();
    }
}

function updateQty(isbn, change) {
    const item = cart.find(i => i.isbn === isbn);
    if (!item) return;
    item.qty += change;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.isbn !== isbn);
    }
    renderCart();
}

function removeItem(isbn) {
    cart = cart.filter(i => i.isbn !== isbn);
    renderCart();
}

function formatMoney(amount) {
    return '$' + parseFloat(amount).toFixed(2);
}

function renderCart() {
    let total = 0;

    // Toggle active states
    const hasItems = cart.length > 0;
    btnClear.disabled = !hasItems;
    btnCheckout.disabled = !hasItems;

    if (!hasItems) {
        cartBody.innerHTML = `
        <tr class="empty-state">
            <td colspan="6">
                <div class="empty-cart-message">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                    <p>Cart is empty. Scan an item to begin.</p>
                </div>
            </td>
        </tr>`;
        subtotalVal.textContent = '$0.00';
        totalVal.textContent = '$0.00';
        return;
    }

    cartBody.innerHTML = '';

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;

        const tr = document.createElement('tr');
        tr.id = `row-${item.isbn.toLowerCase()}`;
        tr.className = 'cart-item-row';
        tr.innerHTML = `
            <td>
                <div class="item-name">${item.name}</div>
            </td>
            <td><div class="item-isbn">${item.isbn.toUpperCase()}</div></td>
            <td class="align-right">
                <div class="item-qty">
                    <button class="qty-btn" onclick="updateQty('${item.isbn}', -1)">-</button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty('${item.isbn}', 1)">+</button>
                </div>
            </td>
            <td class="align-right item-price">${formatMoney(item.price)}</td>
            <td class="align-right item-total">${formatMoney(itemTotal)}</td>
            <td class="align-right">
                <button class="icon-btn" onclick="removeItem('${item.isbn}')" title="Remove Item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </td>
        `;
        cartBody.appendChild(tr);
    });

    subtotalVal.textContent = formatMoney(total);
    totalVal.textContent = formatMoney(total); // Keep same if no tax logic needed
}

btnClear.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the cart?')) {
        cart = [];
        renderCart();
    }
});

/**
 * Receipt Printing Logic
 */
btnCheckout.addEventListener('click', () => {
    if (cart.length === 0) return;

    const phoneInput = document.getElementById('customer-phone').value.trim();
    const btnText = document.getElementById('checkout-btn-text');
    const loader = btnCheckout.querySelector('.loader');

    // Populate Receipt
    // Populate Receipt matching LaTeX Layout
    const now = new Date();
    document.getElementById('receipt-date-val').textContent = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    document.getElementById('receipt-time-val').textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    document.getElementById('receipt-id').textContent = '#' + Math.floor(1000 + Math.random() * 9000);

    const receiptItems = document.getElementById('receipt-items');
    receiptItems.innerHTML = '';
    let tSubtotal = 0;

    cart.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        tSubtotal += itemTotal;
        const tr = document.createElement('tr');

        // Add a bottom border to the last item to simulate the midrule
        if (index === cart.length - 1) {
            tr.style.borderBottom = "1px solid #000";
        }

        tr.innerHTML = `
            <td class="col-item">${item.name.substring(0, 16)}</td>
            <td>${item.qty}</td>
            <td>${formatMoney(itemTotal)}</td>
        `;
        receiptItems.appendChild(tr);
    });

    const tTax = tSubtotal * 0.10; // 10% tax as per LaTeX
    const tTotal = tSubtotal + tTax;

    document.getElementById('receipt-subtotal-val').textContent = formatMoney(tSubtotal);
    document.getElementById('receipt-tax-val').textContent = formatMoney(tTax);
    document.getElementById('receipt-total-val').textContent = formatMoney(tTotal);

    // Require a phone number to generate the digital PDF and open WhatsApp
    if (!phoneInput) {
        alert("Please enter a Customer WhatsApp Number to generate and share the digital bill.");
        return;
    }

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');
    btnCheckout.disabled = true;

    // Ensure scroll is at top so html2canvas doesn't render an empty off-screen box
    window.scrollTo(0, 0);
    const receiptContainer = document.getElementById('receipt-container');
    const appContainer = document.querySelector('.app-container');

    // Hide the entire app so ONLY the receipt exists in the DOM visual tree
    if (appContainer) appContainer.style.display = 'none';
    receiptContainer.style.display = 'block';

    const filename = `Nexus_Store_Bill_${Date.now()}.pdf`;
    const opt = {
        margin: [2, 0, 0, 0],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            scrollY: 0,
            scrollX: 0,
            windowWidth: 800
        },
        jsPDF: { unit: 'mm', format: [80, 200], orientation: 'portrait' }
    };

    // Timeout to allow the browser to fully render the display:block before snapshotting
    setTimeout(() => {
        // Generate PDF, convert to base64, upload to Drive, then redirect the WhatsApp Tab.
        html2pdf().set(opt).from(receiptContainer).output('datauristring').then(function (pdfBase64) {
            receiptContainer.style.display = ''; // reset to normal hidden state
            if (appContainer) appContainer.style.display = ''; // Restore the main app

            // Prepare the payload for Apps Script
            const payload = JSON.stringify({
                base64: pdfBase64,
                filename: filename,
                folderId: '15QEZhWbjviHTUYW5XUtvP8E-i4xPtC8e'
            });

            // Send simple POST request without custom headers to avoid CORS preflight entirely.
            // Google Apps Script will parse this payload in e.postData.contents.
            return fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: payload
            });
        })
            .then(response => {
                // Apps script often responds with a redirect (302) on POST before giving JSON, 
                // but the fetch API transparently follows it. We just need to parse the final response.
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                if (result.status === 'success') {
                    // Result MUST have .url from our script
                    console.log("Upload Success! URL:", result.url);

                    const cleanPhone = phoneInput.replace(/\D/g, '');
                    const message = encodeURIComponent(`Hello! Thank you for your purchase from Nexus Store.\n\nPlease find your digital bill here: ${result.url}`);
                    const waLink = `https://wa.me/${cleanPhone}?text=${message}`;

                    // Redirect the current tab to WhatsApp to avoid iOS background tab suspension
                    window.location.href = waLink;

                } else {
                    throw new Error(result.message || 'Unknown error during upload');
                }
            })
            .catch(error => {
                console.error("Upload Error:", error);
                alert(`Failed to upload the bill to Google Drive. Error: ${error.message}\nCheck the console for details.`);
            })
            .finally(() => {
                if (appContainer) appContainer.style.display = ''; // Safety fallback to restore UI
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
                btnCheckout.disabled = false;
            });
    }, 500);
});
