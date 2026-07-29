// DOM-level regression tests for app.js.
//
// Unlike core.test.js/parity.test.js, these need a real DOM: app.js manipulates elements
// directly (document.getElementById, event listeners, localStorage) rather than being a
// pure function of its inputs. It's also a singleton module - top-level `state`/
// `elements`, `boot()` auto-invoked at the bottom - so each test imports a fresh instance
// of the real, unmodified src/app.js via a cache-busting query string, against its own
// jsdom document, to get independent state.
//
// `fetch` is still poisoned to throw by helpers.mjs; bootApp() only re-enables it to serve
// the real catalog file straight off disk, so app.js's unconditional `loadCatalog()` call
// works without any test ever touching the actual network.
//
// These tests were added after a session of bug fixes that mostly lived in app.js and had
// no automated coverage at all - each test below is pinned to the issue/bug it guards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(HERE, '..', 'src');
const INDEX_HTML = readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');
const CATALOG_JSON = readFileSync(path.join(SRC_DIR, 'data', 'items.catalog.json'), 'utf8');
const APP_JS_URL = pathToFileURL(path.join(SRC_DIR, 'app.js')).href;

let bootId = 0;

function waitFor(predicate, { timeout = 5000, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitFor() timed out'));
      setTimeout(check, interval);
    })();
  });
}

/**
 * Boots a fresh, isolated instance of the real app.js against a fresh jsdom document.
 * `navigator` is the only global Node itself predefines (as a getter-only property, hence
 * defineProperty rather than assignment); document/window/localStorage/EventTarget/Event
 * are app.js's other bare-global dependencies and are safe to assign directly.
 *
 * `seedLocalStorage` pre-populates the fresh window's localStorage before app.js boots -
 * each jsdom instance otherwise has its own isolated storage, so this is how a test
 * simulates "closing and reopening the page" against the same persisted data.
 */
async function bootApp({ seedLocalStorage } = {}) {
  const dom = new JSDOM(INDEX_HTML, { url: 'http://localhost/' });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, enumerable: true });
  globalThis.EventTarget = window.EventTarget;
  globalThis.Event = window.Event;
  window.confirm = () => true;

  if (seedLocalStorage) {
    Object.entries(seedLocalStorage).forEach(([key, value]) => window.localStorage.setItem(key, value));
  }

  globalThis.fetch = async (url) => {
    if (String(url).includes('items.catalog.json')) {
      return { ok: true, json: async () => JSON.parse(CATALOG_JSON) };
    }
    throw new Error(`app.test.js: unexpected fetch for ${url}`);
  };

  bootId += 1;
  await import(`${APP_JS_URL}?boot=${bootId}`);

  const bootStatus = window.document.getElementById('bootStatus');
  await waitFor(() => bootStatus.hidden || bootStatus.classList.contains('is-error'));
  if (bootStatus.classList.contains('is-error')) {
    throw new Error(`app failed to boot: ${bootStatus.textContent}`);
  }

  return dom;
}

function click(dom, id) {
  dom.window.document.getElementById(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function submitSaveDialog(dom) {
  dom.window.document
    .getElementById('saveLoadoutForm')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

/** Opens the create dialog, sets the title, and submits - mirrors a user saving a loadout. */
function saveLoadoutAs(dom, title) {
  click(dom, 'saveLoadoutButton');
  dom.window.document.getElementById('saveLoadoutName').value = title;
  submitSaveDialog(dom);
}

function selectSavedLoadout(dom, titleSubstring) {
  const select = dom.window.document.getElementById('savedLoadoutSelect');
  const option = [...select.options].find((o) => o.textContent.includes(titleSubstring));
  if (!option) throw new Error(`no saved-loadout option matching "${titleSubstring}"`);
  select.value = option.value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function slotRow(dom, slotKey) {
  return [...dom.window.document.querySelectorAll('.slot-row')].find((row) => row.dataset.slot === slotKey);
}

function clickOption(dom, iconSelectRootId, optionValue) {
  const root = dom.window.document.getElementById(iconSelectRootId);
  root.querySelector('.icon-select-trigger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const option = [...root.querySelectorAll('[role="option"]')].find((el) => el.dataset.value === optionValue);
  option.querySelector('span:last-child').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

/** Selects a slot, searches for `query`, and equips the first search result. */
async function equipFirstSearchResult(dom, slotKey, query) {
  const { document, window } = dom.window;
  slotRow(dom, slotKey).querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.getElementById('searchInput').value = query;
  document.getElementById('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.result-row').length > 0);
  document.querySelector('.result-row-use').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function savedLoadoutTitles(dom) {
  const select = dom.window.document.getElementById('savedLoadoutSelect');
  return [...select.options].filter((o) => o.value !== '').map((o) => o.textContent);
}

// ---------------------------------------------------------------------------- issue #9

test('sidebar has a link to the GitHub repository (#9)', async () => {
  const dom = await bootApp();
  const link = dom.window.document.querySelector('.github-link');
  assert.ok(link, 'expected a .github-link element in the sidebar');
  assert.match(link.href, /^https:\/\/github\.com\//);
});

test('a price-accuracy disclaimer is shown near Compare prices', async () => {
  const dom = await bootApp();
  const disclaimer = dom.window.document.querySelector('.price-disclaimer');
  assert.ok(disclaimer, 'expected a .price-disclaimer element');
  assert.match(disclaimer.textContent, /suggestion/i);
});

// ---------------------------------------------------------------------------- issue #4

test('sidebar eyebrow and save-dialog hint say "loadout", not "preset" (#4)', async () => {
  const dom = await bootApp();
  const { document } = dom.window;

  const eyebrow = [...document.querySelectorAll('.sidebar-section .eyebrow')].find((el) => /loadout/i.test(el.textContent));
  assert.ok(eyebrow, 'expected a sidebar eyebrow mentioning loadouts');
  assert.equal(eyebrow.textContent, 'Loadouts');

  saveLoadoutAs(dom, 'Alpha');
  // Re-opening the create dialog while "Alpha" is the active loadout shows the
  // "this updates..." hint - that's the string that used to say "preset".
  click(dom, 'saveLoadoutButton');
  const hint = document.getElementById('saveLoadoutHint').textContent;
  assert.match(hint, /loadout/i);
  assert.doesNotMatch(hint, /preset/i);
});

// ---------------------------------------------------------------------------- issue #7

test('Region and Language selects show an icon on the closed control (#7)', async () => {
  const dom = await bootApp();
  const { document } = dom.window;
  const regionIcon = document.querySelector('#regionSelect .icon-select-icon');
  const languageIcon = document.querySelector('#languageSelect .icon-select-icon');
  assert.ok(regionIcon && !regionIcon.hidden, 'expected a visible icon on the Region trigger');
  assert.ok(languageIcon && !languageIcon.hidden, 'expected a visible icon on the Language trigger');
  assert.match(regionIcon.style.backgroundImage, /^url\(/);
  assert.match(languageIcon.style.backgroundImage, /^url\(/);
});

test('Language select icon changes when switching language (#7)', async () => {
  const dom = await bootApp();
  const icon = dom.window.document.querySelector('#languageSelect .icon-select-icon');
  const before = icon.style.backgroundImage;
  clickOption(dom, 'languageSelect', 'de');
  assert.notEqual(icon.style.backgroundImage, before, 'the flag icon should change with the selected language');
});

test('Market city and Minimum quality options are colored (#7)', async () => {
  const dom = await bootApp();
  const { document } = dom.window;
  const cityOption = [...document.getElementById('marketCitySelect').options].find((o) => o.value === 'Caerleon');
  const qualityOption = [...document.getElementById('minQualitySelect').options].find((o) => o.value === '2');
  assert.ok(cityOption, 'expected a Caerleon option for the default region');
  assert.notEqual(cityOption.style.color, '', 'city option should carry an inline color');
  assert.ok(qualityOption, 'expected a Good (2) quality option');
  assert.notEqual(qualityOption.style.color, '', 'quality option should carry an inline color');
});

test('picking a Region/Language option closes the dropdown and it does not reopen (#7 regression)', async () => {
  // Regression for a real bug: the <label> used to wrap both the trigger button and the
  // option list, so clicking a plain <li> made the browser also fire a synthetic click on
  // the label's associated control (the trigger) right after - reopening the list the
  // instant this code closed it.
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };
  const root = document.getElementById('languageSelect');
  const trigger = root.querySelector('.icon-select-trigger');
  const list = root.querySelector('.icon-select-list');

  trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(list.hidden, false, 'expected the list to open on click');

  const option = list.querySelector('[role="option"]');
  option.querySelector('span:last-child').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.equal(list.hidden, true, 'the dropdown must stay closed after picking an option');
});

// ---------------------------------------------------------------------------- issue #8

test('loadout action buttons have icons and distinct accent classes (#8)', async () => {
  const dom = await bootApp();
  const { document } = dom.window;
  for (const id of ['saveLoadoutButton', 'loadSavedLoadoutButton', 'deleteSavedLoadoutButton']) {
    assert.ok(document.getElementById(id).querySelector('.material-symbols-rounded'), `${id} should have an icon`);
  }
  assert.ok(document.getElementById('saveLoadoutButton').classList.contains('small-button-primary'));
  assert.ok(document.getElementById('loadSavedLoadoutButton').classList.contains('small-button-accent'));
  assert.ok(document.getElementById('deleteSavedLoadoutButton').classList.contains('small-button-danger'));
});

// ---------------------------------------------------------------------------- issue #6

test('saved-loadout dropdown shows only the title; description shows separately (#6)', async () => {
  const dom = await bootApp();
  const { document } = dom.window;

  saveLoadoutAs(dom, 'PvP Build');
  click(dom, 'editSavedLoadoutButton');
  document.getElementById('saveLoadoutDescription').value = 'Fast mount, no armor.';
  submitSaveDialog(dom);

  const option = [...document.getElementById('savedLoadoutSelect').options].find((o) => o.textContent.includes('PvP Build'));
  assert.equal(option.textContent, 'PvP Build', 'the option text must be the title alone, not "title — description"');
  assert.equal(document.getElementById('savedLoadoutDescriptionHint').textContent, 'Fast mount, no armor.');
  assert.equal(document.getElementById('savedLoadoutDescriptionHint').hidden, false);
});

// ---------------------------------------------------------------------------- issue #5

test('Sort control switches saved-loadout order between Recently updated and A-Z (#5)', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  saveLoadoutAs(dom, 'Zulu');
  saveLoadoutAs(dom, 'Alpha');
  saveLoadoutAs(dom, 'Mike');

  const titlesInOrder = () =>
    [...document.getElementById('savedLoadoutSelect').options].map((o) => o.textContent).filter((t) => t !== 'Select a loadout...');

  assert.deepEqual(titlesInOrder(), ['Mike', 'Alpha', 'Zulu'], 'default sort is most-recently-updated first');

  const sortSelect = document.getElementById('savedLoadoutSortSelect');
  sortSelect.value = 'alpha';
  sortSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert.deepEqual(titlesInOrder(), ['Alpha', 'Mike', 'Zulu'], 'A-Z sort orders by title');
});

// ---------------------------------------------------------------------------- save-as-new-title fix

test('changing the title while a loadout is loaded saves a new entry instead of overwriting it', async () => {
  const dom = await bootApp();
  const { document } = dom.window;

  saveLoadoutAs(dom, 'Alpha Build');
  saveLoadoutAs(dom, 'Bravo Build'); // Alpha Build is now loaded/active; different title

  const titles = () =>
    [...document.getElementById('savedLoadoutSelect').options].map((o) => o.textContent).filter((t) => t !== 'Select a loadout...');

  assert.deepEqual(new Set(titles()), new Set(['Alpha Build', 'Bravo Build']), 'both loadouts must exist');

  saveLoadoutAs(dom, 'Bravo Build'); // same title again -> update in place, no duplicate
  assert.equal(titles().length, 2, 're-saving with the same title must not create a duplicate');
});

// ---------------------------------------------------------------------------- auto-load-on-select

test('selecting a saved loadout from the dropdown loads it without clicking Load', async () => {
  const dom = await bootApp();
  const { document } = dom.window;

  saveLoadoutAs(dom, 'Alpha Build');
  saveLoadoutAs(dom, 'Bravo Build');

  selectSavedLoadout(dom, 'Alpha Build');

  assert.match(
    document.getElementById('resultsEmptyState').textContent,
    /Loaded "Alpha Build"/,
    'selecting a loadout should load it immediately, without a separate click on Load',
  );
});

// ---------------------------------------------------------------------------- deselect-slot / no-default-slot

test('boot starts with no equipment slot selected', async () => {
  const dom = await bootApp();
  const { document } = dom.window;
  assert.equal(document.getElementById('searchTitle').textContent, 'Select a slot');
  assert.ok(document.getElementById('searchInput').disabled);
  assert.equal(
    [...document.querySelectorAll('.slot-row')].some((row) => row.classList.contains('is-selected')),
    false,
  );
});

test('loading a saved loadout resets slot selection to none, even if a slot was selected before', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  saveLoadoutAs(dom, 'Alpha Build');
  const headRow = slotRow(dom, 'head');
  headRow.querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(headRow.classList.contains('is-selected'), true, 'sanity check: the slot should be selected before loading');

  saveLoadoutAs(dom, 'Bravo Build');
  selectSavedLoadout(dom, 'Bravo Build'); // triggers auto-load, which must deselect

  assert.equal(headRow.classList.contains('is-selected'), false, 'loading a loadout must clear any prior slot selection');
  assert.equal(document.getElementById('searchTitle').textContent, 'Select a slot');
});

test('clicking an already-selected slot deselects it and shows the loadout description', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  saveLoadoutAs(dom, 'Alpha Build');
  click(dom, 'editSavedLoadoutButton');
  document.getElementById('saveLoadoutDescription').value = 'Fast mount, no armor.';
  submitSaveDialog(dom);

  const headRow = slotRow(dom, 'head');
  const headButton = headRow.querySelector('.slot-row-main');

  headButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('searchTitle').textContent, 'Add to Head');
  assert.equal(headRow.classList.contains('is-selected'), true);

  headButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('searchTitle').textContent, 'Select a slot');
  assert.ok(document.getElementById('searchInput').disabled);
  assert.equal(headRow.classList.contains('is-selected'), false);
  assert.equal(document.getElementById('searchResults').textContent.trim(), 'Fast mount, no armor.');
});

// ---------------------------------------------------------------------------- filters-not-per-loadout

test('loading a saved loadout does not change Region/Language/Market city', async () => {
  // Regression: saved loadouts used to carry a frozen snapshot of Region/Language/Market
  // city and silently reapply it on load, so switching loadouts could change what you were
  // comparing prices against even though you never touched those dropdowns.
  const dom = await bootApp();
  const { document } = dom.window;

  saveLoadoutAs(dom, 'Alpha Build');

  clickOption(dom, 'regionSelect', 'europe');
  clickOption(dom, 'languageSelect', 'de');
  document.getElementById('marketCitySelect').value = 'Caerleon';
  document.getElementById('marketCitySelect').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  saveLoadoutAs(dom, 'Bravo Build');

  selectSavedLoadout(dom, 'Alpha Build');

  const selectedValue = (rootId) => document.querySelector(`#${rootId} [aria-selected="true"]`)?.dataset.value;
  assert.equal(selectedValue('regionSelect'), 'europe');
  assert.equal(selectedValue('languageSelect'), 'de');
  assert.equal(document.getElementById('marketCitySelect').value, 'Caerleon');
});

// ---------------------------------------------------------------------------- localize-ui-text

test('switching language retranslates static UI text (data-i18n) in place', async () => {
  const dom = await bootApp();
  const { document } = dom.window;

  const saveLabel = () => document.querySelector('#saveLoadoutButton [data-i18n]').textContent;
  assert.equal(saveLabel(), 'Save');
  clickOption(dom, 'languageSelect', 'de');
  assert.equal(saveLabel(), 'Speichern');
  assert.match(document.querySelector('.github-link').textContent, /Auf GitHub/);
});

test('switching language retranslates the equipment slot labels and "Add to X" heading', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  slotRow(dom, 'head').querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('searchTitle').textContent, 'Add to Head');

  clickOption(dom, 'languageSelect', 'de');
  assert.equal(document.getElementById('searchTitle').textContent, 'Zu Kopf hinzufügen');
  // renderInventory() rebuilds the slot list from scratch on a language change, so the row
  // element must be re-queried rather than reusing the one captured before the switch.
  assert.equal(slotRow(dom, 'head').querySelector('.slot-row-label').textContent, 'Kopf');
});

test('switching language retranslates the Minimum quality and Market city dropdown options', async () => {
  // Regression: renderMinQualityOptions()/renderMarketCityOptions() rebuild these
  // <select>s from state.config with translated labels, but the language-change handler
  // originally never called them - so the two dropdowns silently stayed in English while
  // every other control switched language.
  const dom = await bootApp();
  const { document } = dom.window;

  const qualityOptionBefore = [...document.getElementById('minQualitySelect').options].find((o) => o.value === '2');
  assert.equal(qualityOptionBefore.textContent, 'Good');

  clickOption(dom, 'languageSelect', 'de');

  const qualityOptionAfter = [...document.getElementById('minQualitySelect').options].find((o) => o.value === '2');
  assert.equal(qualityOptionAfter.textContent, 'Gut');
  assert.equal(document.getElementById('marketCitySelect').options[0].textContent, 'Alle Städte');
});

// ---------------------------------------------------------------------------- icon-loading-placeholder

test('a search result icon shows a spinner while its image loads, then a fallback icon on error', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  slotRow(dom, 'head').querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.getElementById('searchInput').value = 'hood';
  document.getElementById('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.result-row').length > 0);

  const rows = [...document.querySelectorAll('.result-row')];
  const [rowA, rowB] = rows;

  const spinnerA = rowA.querySelector('.result-row-spinner');
  const fallbackA = rowA.querySelector('.result-row-fallback');
  assert.equal(spinnerA.hidden, false, 'spinner should be visible while the icon is still loading');
  assert.equal(fallbackA.hidden, true, 'fallback icon must not show up before an actual load error');

  rowA.querySelector('.result-row-image').dispatchEvent(new window.Event('load'));
  assert.equal(spinnerA.hidden, true, 'spinner should hide once the image finishes loading');
  assert.equal(fallbackA.hidden, true);

  const spinnerB = rowB.querySelector('.result-row-spinner');
  const fallbackB = rowB.querySelector('.result-row-fallback');
  rowB.querySelector('.result-row-image').dispatchEvent(new window.Event('error'));
  assert.equal(spinnerB.hidden, true, 'spinner should hide on a load error too');
  assert.equal(fallbackB.hidden, false, 'the fallback icon should show up once loading the image fails');
});

test('equipping an item shows a loading spinner on the slot icon, and an unrelated re-sync does not restart it', async () => {
  // Regression: loadIcon() used to unconditionally hide the spinner before checking
  // whether the image src was already being requested, so any re-sync of the same slot
  // row (equip() alone re-syncs slots more than once) hid a spinner that was still
  // legitimately waiting on its image to load.
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  slotRow(dom, 'head').querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.getElementById('searchInput').value = 'hood';
  document.getElementById('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.result-row').length > 0);
  document.querySelector('.result-row-use').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const headRow = slotRow(dom, 'head');
  const slotSpinner = headRow.querySelector('.slot-row-spinner');
  assert.equal(slotSpinner.hidden, false, 'the slot icon should show a spinner while its image loads');

  // Deselecting and reselecting the same slot re-runs syncSlotRows() on the same <img>
  // without recreating it - the spinner must stay visible, not reset to hidden.
  headRow.querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  headRow.querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(slotSpinner.hidden, false, 're-syncing the same row must not hide an in-flight spinner');

  headRow.querySelector('.slot-row-image').dispatchEvent(new window.Event('load'));
  assert.equal(slotSpinner.hidden, true, 'the spinner should hide once the slot icon finishes loading');
});

test('swapping to a different tier/enchant hides the stale icon instead of showing the spinner over it', async () => {
  // Reassigning <img src> to a new URL doesn't clear the previously painted frame until
  // the new one decodes, so without explicitly hiding the image the spinner would just
  // spin on top of the old (now-wrong) icon - e.g. swapping a T2 item for a T3 one.
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  slotRow(dom, 'head').querySelector('.slot-row-main').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.getElementById('searchInput').value = 'hood';
  document.getElementById('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.result-row').length > 0);
  const firstRow = document.querySelector('.result-row');
  firstRow.querySelector('.result-row-use').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const headRow = slotRow(dom, 'head');
  const slotImage = headRow.querySelector('.slot-row-image');
  const slotSpinner = headRow.querySelector('.slot-row-spinner');
  slotImage.dispatchEvent(new window.Event('load'));
  const firstSrc = slotImage.getAttribute('src');
  assert.equal(slotImage.style.visibility, '', 'the icon should be visible once loaded');

  const tierSelect = firstRow.querySelector('.result-row-tier');
  const otherTier = [...tierSelect.options].find((o) => o.value !== tierSelect.value);
  tierSelect.value = otherTier.value;
  tierSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  firstRow.querySelector('.result-row-use').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.notEqual(slotImage.getAttribute('src'), firstSrc, 'sanity check: the swap should target a different image');
  assert.equal(slotSpinner.hidden, false, 'the spinner should show while the new icon loads');
  assert.equal(slotImage.style.visibility, 'hidden', 'the stale icon must be hidden while the new one loads, not left showing under the spinner');

  slotImage.dispatchEvent(new window.Event('load'));
  assert.equal(slotImage.style.visibility, '', 'the new icon should become visible once it finishes loading');
  assert.equal(slotSpinner.hidden, true);
});

// ---------------------------------------------------------------------------- filters-persist-across-reload

test('Region/Language/Market city/Minimum quality persist across a page reload', async () => {
  const dom1 = await bootApp();

  clickOption(dom1, 'regionSelect', 'europe');
  clickOption(dom1, 'languageSelect', 'de');
  const marketCitySelect1 = dom1.window.document.getElementById('marketCitySelect');
  marketCitySelect1.value = 'Lymhurst';
  marketCitySelect1.dispatchEvent(new dom1.window.Event('change', { bubbles: true }));
  const minQualitySelect1 = dom1.window.document.getElementById('minQualitySelect');
  minQualitySelect1.value = '3';
  minQualitySelect1.dispatchEvent(new dom1.window.Event('change', { bubbles: true }));

  const stored = dom1.window.localStorage.getItem('albion-helper.filters');
  assert.ok(stored, 'expected the filters to be persisted to localStorage');

  // A fresh jsdom window has its own isolated storage - seed it with what the first
  // "session" wrote, simulating the same browser storage surviving a reload.
  const dom2 = await bootApp({ seedLocalStorage: { 'albion-helper.filters': stored } });
  const { document: document2 } = dom2.window;

  const selectedValue = (rootId) => document2.querySelector(`#${rootId} [aria-selected="true"]`)?.dataset.value;
  assert.equal(selectedValue('regionSelect'), 'europe');
  assert.equal(selectedValue('languageSelect'), 'de');
  assert.equal(document2.getElementById('marketCitySelect').value, 'Lymhurst');
  assert.equal(document2.getElementById('minQualitySelect').value, '3');
});

test('an invalid or unrecognized stored filter is ignored rather than applied blindly', async () => {
  const dom = await bootApp({
    seedLocalStorage: {
      'albion-helper.filters': JSON.stringify({ region: 'not-a-real-region', language: 'xx', marketCity: 'Caerleon', minQuality: 99 }),
    },
  });
  const { document } = dom.window;

  const selectedValue = (rootId) => document.querySelector(`#${rootId} [aria-selected="true"]`)?.dataset.value;
  assert.equal(selectedValue('regionSelect'), 'americas', 'an unrecognized region must fall back to the default');
  assert.equal(selectedValue('languageSelect'), 'en', 'an unrecognized language must fall back to the default');
  assert.equal(document.getElementById('minQualitySelect').value, '1', 'an out-of-range quality must fall back to the default');
});

// ---------------------------------------------------------------------------- import-creates-new-loadout

test('importing a loadout code creates a new saved loadout instead of just replacing the working gear', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  await equipFirstSearchResult(dom, 'head', 'hood');

  // jsdom has no Clipboard API, so copyLoadoutCode() falls into its prompt() fallback -
  // capture the code it would have copied from the prompt's default value.
  let exportedCode = null;
  window.prompt = (_message, defaultValue) => {
    exportedCode = defaultValue ?? null;
    return null;
  };
  click(dom, 'exportLoadoutButton');
  assert.ok(exportedCode, 'expected the export prompt fallback to carry the loadout code');

  assert.deepEqual(savedLoadoutTitles(dom), [], 'sanity check: nothing saved yet');

  window.prompt = () => exportedCode;
  click(dom, 'importLoadoutButton');

  assert.deepEqual(savedLoadoutTitles(dom), ['Imported loadout 1']);
  assert.match(document.getElementById('savedLoadoutSelect').value, /.+/, 'the new loadout should be selected');

  // Importing again must add a second entry, not overwrite the first.
  click(dom, 'importLoadoutButton');
  assert.deepEqual(savedLoadoutTitles(dom), ['Imported loadout 2', 'Imported loadout 1']);
});

// ---------------------------------------------------------------------------- export-copy-feedback

test('Export shows a checkmark and "Copied!" label after a successful copy, then reverts', async () => {
  const dom = await bootApp();
  const { document, window } = { document: dom.window.document, window: dom.window };

  await equipFirstSearchResult(dom, 'head', 'hood');

  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });

  const exportButton = document.getElementById('exportLoadoutButton');
  const icon = exportButton.querySelector('.material-symbols-rounded');
  const label = exportButton.querySelector('[data-i18n]');
  assert.equal(icon.textContent, 'ios_share');
  assert.equal(label.textContent, 'Export');

  click(dom, 'exportLoadoutButton');
  // copyLoadoutCode() awaits navigator.clipboard.writeText() before flashing feedback.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(icon.textContent, 'check');
  assert.equal(label.textContent, 'Copied!');
  assert.ok(exportButton.classList.contains('is-copied'));
});
