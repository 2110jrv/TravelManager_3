import { openDatabase, getAllItems } from './db.js';
import { renderDayCards } from './ui.js';

const dayList = document.getElementById('dayList');
const statusOnline = document.getElementById('statusOnline');
const statusSync = document.getElementById('statusSync');
const openSpreadsheetButton = document.getElementById('openSpreadsheetButton');

async function initApp() {
  await openDatabase();
  const items = await getAllItems();
  renderDayCards(items, dayList);
  updateStatus();
}

function updateStatus() {
  const online = navigator.onLine;
  statusOnline.textContent = online ? 'Online' : 'Offline';
  statusSync.textContent = 'Local-first';
}

window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

openSpreadsheetButton.addEventListener('click', () => {
  document.getElementById('sheetModal').classList.remove('hidden');
});

document.getElementById('closeSheetButton').addEventListener('click', () => {
  document.getElementById('sheetModal').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./pwa/sw.js', { scope: './' }).catch(() => {
    console.warn('Service Worker registration falló');
  });
}

initApp();
