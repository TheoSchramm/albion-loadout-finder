// Everything the app needs now runs in the browser - there is no backend. The lib
// modules below are a direct port of the Flask app's domain logic, and lib/api.js keeps
// the same five payload shapes the old HTTP endpoints returned.
import { loadCatalog } from './lib/catalog.js';
import { getConfig, getItem, getItems, optimize } from './lib/api.js';
import { slotLabel } from './lib/constants.js';
import { itemImageUrl } from './lib/urls.js';
import { t } from './i18n.js';

// Document-relative, so the app works unchanged from a GitHub Pages project subpath
// (https://user.github.io/<repo>/) as well as from a domain root.
const CATALOG_URL = new URL('./data/items.catalog.json', import.meta.url);

// A native <select>'s closed box can carry a background-image icon, but no browser lets
// its open <option> list render one - so a per-option flag/globe icon (rather than just
// on the closed control) needs its own widget instead of a real <select>. This is a
// minimal listbox: a trigger button plus an absolutely-positioned option list, built from
// plain elements so each row can hold an icon. It mimics just enough of <select>'s API
// (`.value` get/set, `addEventListener('change', ...)` with `event.target.value`) that the
// rest of app.js reads and writes it exactly like the native control it replaces.
function createIconSelect(root) {
  const trigger = root.querySelector('.icon-select-trigger');
  const triggerIcon = root.querySelector('.icon-select-icon');
  const triggerLabel = root.querySelector('.icon-select-label');
  const list = root.querySelector('.icon-select-list');
  const target = new EventTarget();
  let options = [];
  let value = '';

  function onDocumentClick(event) {
    if (!root.contains(event.target)) close();
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocumentClick, true);
  }

  function open() {
    if (trigger.disabled || !list.hidden) return;
    list.hidden = false;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocumentClick, true);
    const current = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
    current?.focus();
  }

  function applySelection(option) {
    triggerIcon.hidden = !option.icon;
    triggerIcon.style.backgroundImage = option.icon || 'none';
    triggerLabel.textContent = option.label;
    list.querySelectorAll('[role="option"]').forEach((node) => {
      node.setAttribute('aria-selected', String(node.dataset.value === option.value));
      node.classList.toggle('is-selected', node.dataset.value === option.value);
    });
  }

  // Mirrors a real <select>: programmatic `.value =` never fires 'change', only picking
  // an option (click or keyboard) does.
  function choose(nextValue) {
    const option = options.find((entry) => entry.value === nextValue);
    if (!option) return;
    const changed = value !== nextValue;
    value = nextValue;
    applySelection(option);
    close();
    if (changed) {
      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: wrapper, configurable: true });
      target.dispatchEvent(event);
    }
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  list.addEventListener('keydown', (event) => {
    const items = [...list.querySelectorAll('[role="option"]')];
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      (items[currentIndex + 1] || items[0])?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      (items[currentIndex - 1] || items[items.length - 1])?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const focused = document.activeElement;
      if (focused?.dataset?.value !== undefined) {
        choose(focused.dataset.value);
        trigger.focus();
      }
    } else if (event.key === 'Escape') {
      close();
      trigger.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  });

  const wrapper = {
    setOptions(nextOptions) {
      options = nextOptions;
      list.innerHTML = '';
      options.forEach((option) => {
        const item = document.createElement('li');
        item.className = 'icon-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.tabIndex = -1;
        item.dataset.value = option.value;
        if (option.icon) {
          const icon = document.createElement('span');
          icon.className = 'icon-select-option-icon';
          icon.style.backgroundImage = option.icon;
          item.append(icon);
        }
        const label = document.createElement('span');
        label.textContent = option.label;
        item.append(label);
        item.addEventListener('click', () => {
          choose(option.value);
          trigger.focus();
        });
        list.append(item);
      });
    },
    get value() {
      return value;
    },
    set value(nextValue) {
      const option = options.find((entry) => entry.value === nextValue);
      if (option) {
        value = nextValue;
        applySelection(option);
      }
    },
    set disabled(isDisabled) {
      trigger.disabled = Boolean(isDisabled);
    },
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
  };
  return wrapper;
}

const state = {
  config: null,
  region: 'americas',
  language: 'en',
  marketCity: 'all',
  minQuality: 1,
  loadout: new Map(),
  savedLoadouts: [],
  loadoutSortOrder: 'recent',
  selectedSavedLoadoutId: '',
  activePresetId: '',
  activePresetDescription: '',
  saveModalMode: 'create',
  searchTimer: null,
  selectedSlot: null,
  searchQuery: '',
  pricingDirty: true,
  pricingInFlight: false,
  lastResultsPayload: null,
};

// Shorthand over i18n.js's t() that always uses the current UI language, since nearly
// every call site in this file wants exactly that.
function T(key, params = {}) {
  return t(key, state.language, params);
}

// Applies every data-i18n[-*] hook under `root` to the current language. Called on the
// whole document at boot and on every language change, and on template fragments right
// after cloning - <template> content is inert until cloned, so it's invisible to a
// document-wide pass, and each clone needs its own.
function translateFragment(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = T(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = T(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = T(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', T(el.dataset.i18nAriaLabel));
  });
}

function applyStaticTranslations() {
  translateFragment(document);
}

const elements = {
  regionSelect: createIconSelect(document.getElementById('regionSelect')),
  languageSelect: createIconSelect(document.getElementById('languageSelect')),
  marketCitySelect: document.getElementById('marketCitySelect'),
  minQualitySelect: document.getElementById('minQualitySelect'),
  refreshButton: document.getElementById('refreshButton'),
  slotList: document.getElementById('slotList'),
  totalCost: document.getElementById('totalCost'),
  searchTitle: document.getElementById('searchTitle'),
  searchInput: document.getElementById('searchInput'),
  searchResults: document.getElementById('searchResults'),
  savedLoadoutSelect: document.getElementById('savedLoadoutSelect'),
  savedLoadoutSortSelect: document.getElementById('savedLoadoutSortSelect'),
  saveLoadoutButton: document.getElementById('saveLoadoutButton'),
  loadSavedLoadoutButton: document.getElementById('loadSavedLoadoutButton'),
  editSavedLoadoutButton: document.getElementById('editSavedLoadoutButton'),
  deleteSavedLoadoutButton: document.getElementById('deleteSavedLoadoutButton'),
  saveLoadoutModal: document.getElementById('saveLoadoutModal'),
  saveLoadoutForm: document.getElementById('saveLoadoutForm'),
  saveLoadoutTitle: document.getElementById('saveLoadoutTitle'),
  saveLoadoutHint: document.getElementById('saveLoadoutHint'),
  saveLoadoutSubmit: document.getElementById('saveLoadoutSubmit'),
  saveLoadoutName: document.getElementById('saveLoadoutName'),
  saveLoadoutDescription: document.getElementById('saveLoadoutDescription'),
  saveLoadoutCancel: document.getElementById('saveLoadoutCancel'),
  saveLoadoutClose: document.getElementById('saveLoadoutClose'),
  slotRowTemplate: document.getElementById('slotRowTemplate'),
  resultRowTemplate: document.getElementById('resultRowTemplate'),
  resultsTable: document.getElementById('resultsTable'),
  resultsBody: document.getElementById('resultsBody'),
  resultsEmptyState: document.getElementById('resultsEmptyState'),
  resultCardTemplate: document.getElementById('resultCardTemplate'),
  bootStatus: document.getElementById('bootStatus'),
  clearLoadoutButton: document.getElementById('clearLoadoutButton'),
  exportLoadoutButton: document.getElementById('exportLoadoutButton'),
  importLoadoutButton: document.getElementById('importLoadoutButton'),
  itemsFoundCounter: document.getElementById('itemsFoundCounter'),
};

const SAVED_LOADOUTS_KEY = 'albion-helper.saved-loadouts';
const LOADOUT_SORT_ORDER_KEY = 'albion-helper.loadout-sort-order';
const FILTERS_KEY = 'albion-helper.filters';

function loadLoadoutSortOrderFromStorage() {
  return window.localStorage.getItem(LOADOUT_SORT_ORDER_KEY) === 'alpha' ? 'alpha' : 'recent';
}

// Applies Region/Language/Market city/Minimum quality from a previous session, once
// state.config is available to validate against - an unrecognized region/language (e.g.
// from an older version of this app, or a hand-edited value) is ignored rather than
// applied blindly. Market city isn't validated here: renderMarketCityOptions() already
// falls back to "all" if the stored city doesn't belong to the restored region.
function applyStoredFilters() {
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(FILTERS_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== 'object') {
    return;
  }
  if (typeof saved.region === 'string' && state.config.regions[saved.region]) {
    state.region = saved.region;
  }
  if (typeof saved.language === 'string' && state.config.languages.includes(saved.language)) {
    state.language = saved.language;
  }
  if (typeof saved.marketCity === 'string') {
    state.marketCity = saved.marketCity;
  }
  if (state.config.qualities.some(({ value }) => value === saved.minQuality)) {
    state.minQuality = saved.minQuality;
  }
}

function persistFilters() {
  window.localStorage.setItem(
    FILTERS_KEY,
    JSON.stringify({
      region: state.region,
      language: state.language,
      marketCity: state.marketCity,
      minQuality: state.minQuality,
    }),
  );
}

function formatSilver(value) {
  if (value >= 1_000_000) {
    const millions = Math.round(value / 100_000) / 10;
    const label = Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1);
    return `${label}M`;
  }
  if (value > 999) {
    const thousands = Math.round(value / 100) / 10;
    const label = Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1);
    return `${label}k`;
  }
  return new Intl.NumberFormat('en-US').format(value);
}

// City names here match the exact strings the backend/AODP API return (REGIONS
// cities in app_core.py), not their display-friendly spelling (e.g. "FortSterling").
// These are Albion's own in-game city colors. Three (Thetford, Caerleon, Brecilien)
// are lightened slightly from the in-game hex, same hue - as flat small mono text on
// this app's dark paper they were under 3:1 contrast at the original lightness.
const CITY_COLORS = {
  Martlock: '#068FA3',
  Thetford: '#C152EA',
  FortSterling: '#B4C6C8',
  Lymhurst: '#5B9C10',
  Bridgewatch: '#EB9026',
  Caerleon: '#DD5A4B',
  Brecilien: '#9E71D0',
};

const QUALITY_COLORS = {
  Normal: '#949390',
  Good: '#BDC3D5',
  Outstanding: '#E9A263',
  Excellent: '#FDFEFE',
  Masterpiece: '#FFDD6F',
};

function cityColor(city) {
  return CITY_COLORS[city] || '';
}

function qualityColor(qualityLabel) {
  return QUALITY_COLORS[qualityLabel] || '';
}

// The English quality label (Normal/Good/Outstanding/Excellent/Masterpiece) is what the
// domain layer stores and colors are keyed by (getConfig()'s payload is pinned in English
// by parity.test.js, matching the original Python endpoint) - this only translates it for
// display, wherever a quality name actually renders on screen.
const QUALITY_LABEL_KEYS = {
  Normal: 'qualityNormal',
  Good: 'qualityGood',
  Outstanding: 'qualityOutstanding',
  Excellent: 'qualityExcellent',
  Masterpiece: 'qualityMasterpiece',
};

function translatedQualityLabel(englishLabel) {
  const key = QUALITY_LABEL_KEYS[englishLabel];
  return key ? T(key) : englishLabel || '';
}

function svgDataUri(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// One flat-color flag per supported language, simplified (no coats of arms, trigrams,
// etc.) since these render at ~16px in a <select>. "pt" is Brazilian Portuguese - the
// only Portuguese Albion ships - so it gets the Brazilian flag, not Portugal's.
const LANGUAGE_FLAG_ICONS = {
  en: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="14" fill="#00247d"/>' +
      '<path d="M0 0L20 14M20 0L0 14" stroke="#fff" stroke-width="3"/>' +
      '<path d="M0 0L20 14M20 0L0 14" stroke="#cf142b" stroke-width="1.2"/>' +
      '<path d="M10 0V14M0 7H20" stroke="#fff" stroke-width="5"/>' +
      '<path d="M10 0V14M0 7H20" stroke="#cf142b" stroke-width="2.4"/>' +
      '</svg>',
  ),
  de: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="4.67" fill="#000"/>' +
      '<rect y="4.67" width="20" height="4.67" fill="#dd0000"/>' +
      '<rect y="9.33" width="20" height="4.67" fill="#ffce00"/>' +
      '</svg>',
  ),
  fr: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="6.67" height="14" fill="#0055a4"/>' +
      '<rect x="6.67" width="6.67" height="14" fill="#fff"/>' +
      '<rect x="13.33" width="6.67" height="14" fill="#ef4135"/>' +
      '</svg>',
  ),
  pt: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="14" fill="#009739"/>' +
      '<polygon points="10,1.5 18.5,7 10,12.5 1.5,7" fill="#fedd00"/>' +
      '<circle cx="10" cy="7" r="3.2" fill="#012169"/>' +
      '</svg>',
  ),
  es: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="14" fill="#aa151b"/>' +
      '<rect y="3.5" width="20" height="7" fill="#f1bf00"/>' +
      '</svg>',
  ),
  ru: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="4.67" fill="#fff"/>' +
      '<rect y="4.67" width="20" height="4.67" fill="#0039a6"/>' +
      '<rect y="9.33" width="20" height="4.67" fill="#d52b1e"/>' +
      '</svg>',
  ),
  zh: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="14" fill="#de2910"/>' +
      '<circle cx="4" cy="3.5" r="1.6" fill="#ffde00"/>' +
      '<circle cx="7.6" cy="1.8" r="0.6" fill="#ffde00"/>' +
      '<circle cx="8.6" cy="3.6" r="0.6" fill="#ffde00"/>' +
      '<circle cx="8.2" cy="5.8" r="0.6" fill="#ffde00"/>' +
      '<circle cx="6.6" cy="6.8" r="0.6" fill="#ffde00"/>' +
      '</svg>',
  ),
  ko: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">' +
      '<rect width="20" height="14" fill="#fff"/>' +
      '<circle cx="10" cy="7" r="3.5" fill="#c60c30"/>' +
      '<path d="M10 3.5a1.75 1.75 0 000 3.5 1.75 1.75 0 010 3.5 3.5 3.5 0 000-7z" fill="#003478"/>' +
      '</svg>',
  ),
};

// Americas/Asia/Europe are server clusters, not single countries, so region gets one
// neutral globe icon rather than a flag that would misrepresent an entire continent.
const REGION_ICON = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="8" fill="none" stroke="#a89f8c" stroke-width="1.4"/>' +
    '<ellipse cx="10" cy="10" rx="3.2" ry="8" fill="none" stroke="#a89f8c" stroke-width="1.2"/>' +
    '<line x1="2" y1="10" x2="18" y2="10" stroke="#a89f8c" stroke-width="1.2"/>' +
    '<line x1="3.2" y1="5.5" x2="16.8" y2="5.5" stroke="#a89f8c" stroke-width="1"/>' +
    '<line x1="3.2" y1="14.5" x2="16.8" y2="14.5" stroke="#a89f8c" stroke-width="1"/>' +
    '</svg>',
);

// Colors the closed <select> box to match its current choice, not just the open dropdown -
// most browsers render an <option>'s color/background only while the list is open, so
// without this the city/quality colors would be invisible until the user clicks in.
function syncSelectColor(selectEl, color) {
  selectEl.style.color = color || '';
}

async function copyMarketAlias(button, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const icon = button.querySelector('.material-symbols-rounded');
  const originalIcon = icon.textContent;
  const originalTitle = button.title;
  icon.textContent = 'check';
  button.classList.add('is-copied');
  button.title = T('copiedFeedback');
  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => {
    icon.textContent = originalIcon;
    button.classList.remove('is-copied');
    button.title = originalTitle;
  }, 1500);
}

const STALE_MARKET_DATA_MS = 24 * 60 * 60 * 1000;

// Albion Online Data Project timestamps (e.g. "2026-07-23T00:15:00") have no
// timezone suffix but are UTC - append "Z" so the browser doesn't interpret them
// as local time, which would throw the "how old is this" math off by hours.
function parseMarketTimestamp(value) {
  if (!value) {
    return null;
  }
  const isoValue = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1) {
    return null;
  }
  return date;
}

function formatRelativeTime(date) {
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) {
    return T('justNow');
  }
  if (diffMinutes < 60) {
    return T('minutesAgo', { count: diffMinutes });
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return T('hoursAgo', { count: diffHours });
  }
  const diffDays = Math.round(diffHours / 24);
  return T('daysAgo', { count: diffDays });
}

// Returns true if this is a real, observed market price; false if no listing was found
// at all, in which case there is no price to show (see prices.js - a missing listing is
// never filled in with a fabricated number).
function syncUpdatedAt(element, isoValue) {
  const date = parseMarketTimestamp(isoValue);
  if (!date) {
    element.textContent = T('noMarketData');
    element.title = T('noRealListingTitle');
    element.classList.add('is-stale');
    return false;
  }
  element.textContent = formatRelativeTime(date);
  element.title = T('lastRecordedTitle', { date: date.toLocaleString() });
  element.classList.toggle('is-stale', Date.now() - date.getTime() > STALE_MARKET_DATA_MS);
  return true;
}

function syncPriceValue(element, price, hasRealData, quantity = 1) {
  if (price == null) {
    element.textContent = '—';
    element.classList.add('is-estimate');
    element.title = T('noRealListingTitle');
    return;
  }
  const total = price * quantity;
  const suffix = quantity > 1 ? ` (×${quantity})` : '';
  const silver = T('silverCurrency');
  element.textContent = hasRealData
    ? `${formatSilver(total)} ${silver}${suffix}`
    : `~${formatSilver(total)} ${silver}${suffix}`;
  element.classList.toggle('is-estimate', !hasRealData);
  element.title = quantity > 1
    ? T('silverEachTimesQty', { price: formatSilver(price), qty: quantity })
    : hasRealData ? '' : T('hasPriceNoTimestamp');
}

function setStatus(message) {
  console.log(`[status] ${message}`);
}

function hideStatus() {}

function getSelected(slot) {
  return state.loadout.get(slot) || null;
}

function isOffHandLocked() {
  const mainHand = getSelected('main_hand');
  return Boolean(mainHand && mainHand.two_handed);
}

function isSlotAvailable(slot) {
  return slot !== 'off_hand' || !isOffHandLocked();
}

const MAX_CONSUMABLE_QUANTITY = 10;

// Only potions and food are bought/consumed in stacks - a quantity multiplier on a
// weapon or armor piece (which you equip exactly one of) wouldn't mean anything.
function isConsumableSlot(slot) {
  return slot === 'potion' || slot === 'food';
}

// A two-handed main-hand weapon occupies the off-hand slot too, so it can't hold
// anything. Call this after any change that could affect main_hand/off_hand: clear
// any now-invalid off-hand item, and if the off-hand panel is what's currently open,
// move the user off it since it just became unselectable.
function applyTwoHandedRule() {
  if (!isOffHandLocked()) {
    return;
  }
  if (state.loadout.has('off_hand')) {
    state.loadout.delete('off_hand');
  }
  if (state.selectedSlot === 'off_hand') {
    const nextAvailable = state.config.slots.find(entry => isSlotAvailable(entry.key) && !getSelected(entry.key));
    if (nextAvailable) {
      selectSlot(nextAvailable.key);
    } else {
      state.selectedSlot = null;
      elements.searchTitle.textContent = T('selectSlotHeading');
      elements.searchInput.value = '';
      elements.searchInput.disabled = true;
      renderSearchPrompt(T('pickSlotHint'));
    }
  }
}

function renderConfig() {
  elements.regionSelect.setOptions(
    Object.entries(state.config.regions).map(([key, region]) => ({
      value: key,
      label: region.label,
      icon: REGION_ICON,
    })),
  );

  elements.languageSelect.setOptions(
    state.config.languages.map((language) => ({
      value: language,
      label: language.toUpperCase(),
      icon: LANGUAGE_FLAG_ICONS[language],
    })),
  );

  renderMarketCityOptions();
  renderMinQualityOptions();

  elements.regionSelect.value = state.region;
  elements.languageSelect.value = state.language;
  elements.marketCitySelect.value = state.marketCity;
  elements.minQualitySelect.value = String(state.minQuality);
}

function renderMinQualityOptions() {
  elements.minQualitySelect.innerHTML = '';
  state.config.qualities.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = translatedQualityLabel(label);
    option.style.color = qualityColor(label);
    elements.minQualitySelect.append(option);
  });
  elements.minQualitySelect.value = String(state.minQuality);
  const selectedQuality = state.config.qualities.find(({ value }) => value === state.minQuality);
  syncSelectColor(elements.minQualitySelect, selectedQuality ? qualityColor(selectedQuality.label) : '');
}

function renderMarketCityOptions() {
  const region = state.config.regions[state.region];
  elements.marketCitySelect.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = T('allCitiesOption');
  elements.marketCitySelect.append(allOption);

  if (region) {
    region.cities.forEach(city => {
      const option = document.createElement('option');
      option.value = city;
      option.textContent = city;
      option.style.color = cityColor(city);
      elements.marketCitySelect.append(option);
    });
  }

  if (![...elements.marketCitySelect.options].some(option => option.value === state.marketCity)) {
    state.marketCity = 'all';
  }
  elements.marketCitySelect.value = state.marketCity;
  syncSelectColor(elements.marketCitySelect, cityColor(state.marketCity));
}

function renderInventory() {
  elements.slotList.innerHTML = '';
  state.config.slots.forEach(slotInfo => {
    const fragment = elements.slotRowTemplate.content.cloneNode(true);
    translateFragment(fragment);
    const row = fragment.querySelector('.slot-row');
    const mainButton = fragment.querySelector('.slot-row-main');
    const label = fragment.querySelector('.slot-row-label');
    const clearButton = fragment.querySelector('.slot-row-clear');

    row.dataset.slot = slotInfo.key;
    label.textContent = slotLabel(slotInfo.key, state.language);
    mainButton.setAttribute('aria-label', T('slotAriaSuffix', { label: slotLabel(slotInfo.key, state.language) }));

    mainButton.addEventListener('click', () => {
      if (state.selectedSlot === slotInfo.key) {
        deselectSlot();
      } else {
        selectSlot(slotInfo.key);
      }
    });

    clearButton.addEventListener('click', event => {
      event.stopPropagation();
      state.loadout.delete(slotInfo.key);
      applyTwoHandedRule();
      markPricingDirty();
    });

    elements.slotList.append(fragment);
  });

  syncSlotRows();
}

// Shared by every item icon (slot tile, search result row, result card): shows `spinner`
// while `src` is in flight, hides it on load or error, and skips re-requesting a URL the
// image already has - reassigning the same `src` doesn't reliably refire `load`, which
// would otherwise leave the spinner stuck on across a re-render of the same item.
function loadIcon(image, spinner, src, { onLoad, onError } = {}) {
  if (!src) {
    if (spinner) spinner.hidden = true;
    image.removeAttribute('src');
    image.style.visibility = '';
    image.onload = null;
    image.onerror = null;
    return;
  }
  if (image.getAttribute('src') === src) {
    // Already requested (or resolved) - leave the current spinner/image state alone
    // rather than restarting it, since reassigning the same src won't refire `load`.
    return;
  }
  if (spinner) spinner.hidden = false;
  // Swapping variants (e.g. a 4.1 bow for a 4.2 one) reassigns `src` on the same <img> -
  // browsers keep painting the previous frame until the new one decodes, so without this
  // the spinner would spin on top of the stale icon instead of the new one loading in.
  image.style.visibility = 'hidden';
  image.onload = () => {
    if (spinner) spinner.hidden = true;
    image.style.visibility = '';
    onLoad?.();
  };
  image.onerror = () => {
    if (spinner) spinner.hidden = true;
    image.removeAttribute('src');
    image.style.visibility = '';
    onError?.();
  };
  image.src = src;
}

function syncSlotRows() {
  elements.slotList.querySelectorAll('.slot-row').forEach(row => {
    const slot = row.dataset.slot;
    const selected = getSelected(slot);
    const mainButton = row.querySelector('.slot-row-main');
    const clearButton = row.querySelector('.slot-row-clear');
    const image = row.querySelector('.slot-row-image');
    const spinner = row.querySelector('.slot-row-spinner');
    const label = row.querySelector('.slot-row-label');
    const quantityBadge = row.querySelector('.slot-row-quantity-badge');
    const locked = !isSlotAvailable(slot);

    row.classList.toggle('is-selected', slot === state.selectedSlot);
    row.classList.toggle('is-disabled', locked);
    mainButton.disabled = locked;
    clearButton.disabled = locked;

    if (!selected) {
      row.classList.remove('is-filled');
      loadIcon(image, spinner, null);
      image.alt = '';
      label.textContent = locked ? T('lockedSlot') : slotLabel(slot, state.language);
      row.removeAttribute('title');
      quantityBadge.hidden = true;
      return;
    }

    row.classList.add('is-filled');
    loadIcon(image, spinner, selected.image_url);
    image.alt = selected.display_name;
    row.title = `${selected.display_name} - T${selected.tier}.${selected.enchantment} - ${selected.unique_name}`;

    if (selected.quantity > 1) {
      quantityBadge.hidden = false;
      quantityBadge.textContent = `×${selected.quantity}`;
    } else {
      quantityBadge.hidden = true;
    }
  });
}

function renderSearchPrompt(message) {
  elements.searchResults.innerHTML = `<div class="empty-state">${message}</div>`;
}

// When nothing is being searched, show the loaded preset's own description (if
// any) instead of the generic hint - a quick reminder of what this build is for.
function defaultSearchPrompt() {
  return state.activePresetDescription || T('typeToSearch');
}

// The "nothing typed yet" view: list every item available for the selected slot (an
// empty query matches everything - see matchesQuery() in text.js) rather than making
// the user type a letter just to see what's on offer. Falls back to the generic hint (or
// a loaded loadout's own description) when no slot is selected - the default on boot and
// after loading a loadout, and reachable any time via deselectSlot().
function showIdleSearchView() {
  if (state.selectedSlot) {
    runSearch(state.selectedSlot, '');
  } else {
    renderSearchPrompt(defaultSearchPrompt());
  }
}

function selectSlot(slot) {
  if (!isSlotAvailable(slot)) {
    return;
  }
  state.selectedSlot = slot;
  state.searchQuery = '';
  elements.searchInput.value = '';
  elements.searchInput.disabled = false;
  const slotInfo = state.config.slots.find(entry => entry.key === slot);
  elements.searchTitle.textContent = slotInfo ? T('addToSlot', { label: slotLabel(slot, state.language) }) : T('chooseAnItem');
  showIdleSearchView();
  syncSlotRows();
  elements.searchInput.focus();
}

// Clears the slot selection, dropping back to the idle view - the loaded loadout's own
// description (via defaultSearchPrompt()) instead of a slot's item list. Reached by
// clicking the already-selected slot again, by boot() (no slot selected by default), and
// by loadSelectedSavedLoadout() (loading a loadout doesn't keep whatever was selected
// before it).
function deselectSlot() {
  state.selectedSlot = null;
  state.searchQuery = '';
  elements.searchInput.value = '';
  elements.searchInput.disabled = true;
  elements.searchTitle.textContent = T('selectSlotHeading');
  showIdleSearchView();
  syncSlotRows();
}

function getCurrentLoadoutSnapshot() {
  return Array.from(state.loadout.entries()).map(([slot, item]) => ({
    slot,
    item,
  }));
}

// A loadout code is just the [slot, unique_name, quantity?] tuples, base64-encoded -
// not the full serialized item (display name, image URL, slot label...), since all of
// that is re-derivable from unique_name via getItem() and would only bloat the string
// someone has to paste. quantity is omitted entirely when it's 1, the common case.
// unique_name/slot are always plain ASCII, so no unicode-safe encoding step is needed.
const LOADOUT_CODE_PREFIX = 'ALB1:';

function encodeLoadoutCode() {
  const entries = Array.from(state.loadout.entries()).map(([slot, item]) =>
    item.quantity > 1 ? [slot, item.unique_name, item.quantity] : [slot, item.unique_name],
  );
  return LOADOUT_CODE_PREFIX + window.btoa(JSON.stringify(entries));
}

function decodeLoadoutCode(code) {
  const trimmed = code.trim();
  if (!trimmed.startsWith(LOADOUT_CODE_PREFIX)) {
    throw new Error(T('notALoadoutCode'));
  }
  let entries;
  try {
    entries = JSON.parse(window.atob(trimmed.slice(LOADOUT_CODE_PREFIX.length)));
  } catch {
    throw new Error(T('couldNotBeDecoded'));
  }
  if (!Array.isArray(entries)) {
    throw new Error(T('malformedLoadoutCode'));
  }
  return entries.map(([slot, uniqueName, quantity]) => ({
    slot,
    uniqueName,
    quantity: Number.isInteger(quantity) && quantity > 1 ? quantity : 1,
  }));
}

function normalizeSavedLoadout(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (!title) {
    return null;
  }
  const slots = Array.isArray(entry.slots)
    ? entry.slots
        .map(slotEntry => {
          if (!slotEntry || typeof slotEntry !== 'object') {
            return null;
          }
          const slot = typeof slotEntry.slot === 'string' ? slotEntry.slot : '';
          const item = slotEntry.item && typeof slotEntry.item === 'object' ? slotEntry.item : null;
          if (!slot || !item) {
            return null;
          }
          return { slot, item };
        })
        .filter(Boolean)
    : [];
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description: typeof entry.description === 'string' ? entry.description.trim() : '',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
    slots,
  };
}

function loadSavedLoadoutsFromStorage() {
  try {
    const raw = window.localStorage.getItem(SAVED_LOADOUTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeSavedLoadout).filter(Boolean);
  } catch {
    return [];
  }
}

function persistSavedLoadouts() {
  window.localStorage.setItem(SAVED_LOADOUTS_KEY, JSON.stringify(state.savedLoadouts));
}

// "recent" (the previous, only, behavior) surfaces whatever was just worked on; "alpha"
// helps find one build by name in a long list instead of hunting through recency order.
function sortSavedLoadouts(savedLoadouts, sortOrder) {
  const sorted = savedLoadouts.slice();
  if (sortOrder === 'alpha') {
    sorted.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
  } else {
    sorted.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }
  return sorted;
}

function renderSavedLoadoutOptions() {
  const currentSelection = state.selectedSavedLoadoutId;
  elements.savedLoadoutSelect.innerHTML = '';

  elements.savedLoadoutSortSelect.disabled = state.savedLoadouts.length < 2;

  if (!state.savedLoadouts.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = T('noSavedLoadoutsYet');
    elements.savedLoadoutSelect.append(option);
    elements.savedLoadoutSelect.disabled = true;
    elements.loadSavedLoadoutButton.disabled = true;
    elements.editSavedLoadoutButton.disabled = true;
    elements.deleteSavedLoadoutButton.disabled = true;
    state.selectedSavedLoadoutId = '';
    return;
  }

  elements.savedLoadoutSelect.disabled = false;

  // No preset is preselected - not even the most recently updated one - so a fresh
  // page load (or a delete that leaves the list non-empty) shows a neutral
  // "pick one" state rather than silently acting as if the user had chosen one.
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = T('selectALoadout');
  elements.savedLoadoutSelect.append(placeholder);

  sortSavedLoadouts(state.savedLoadouts, state.loadoutSortOrder).forEach(entry => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.title;
    elements.savedLoadoutSelect.append(option);
  });

  const hasSelection = Boolean(currentSelection) && state.savedLoadouts.some(entry => entry.id === currentSelection);
  state.selectedSavedLoadoutId = hasSelection ? currentSelection : '';
  elements.savedLoadoutSelect.value = state.selectedSavedLoadoutId;

  elements.loadSavedLoadoutButton.disabled = !hasSelection;
  elements.editSavedLoadoutButton.disabled = !hasSelection;
  elements.deleteSavedLoadoutButton.disabled = !hasSelection;
}

// "My loadout N" for whatever N isn't already taken, so a brand-new save never
// silently collides with an existing title and needs no typing to submit.
function nextAvailableLoadoutTitle(prefix) {
  const existingTitles = new Set(state.savedLoadouts.map(entry => entry.title.toLowerCase()));
  let n = state.savedLoadouts.length + 1;
  while (existingTitles.has(`${prefix} ${n}`.toLowerCase())) {
    n += 1;
  }
  return `${prefix} ${n}`;
}

function nextLoadoutPlaceholderTitle() {
  return nextAvailableLoadoutTitle(T('defaultLoadoutTitlePrefix'));
}

function openSaveLoadoutDialog(mode = 'create') {
  elements.saveLoadoutForm.reset();
  if (mode === 'edit') {
    const target = state.savedLoadouts.find(entry => entry.id === state.selectedSavedLoadoutId);
    if (!target) {
      return;
    }
    state.saveModalMode = 'edit';
    elements.saveLoadoutName.value = target.title;
    elements.saveLoadoutDescription.value = target.description;
    elements.saveLoadoutTitle.textContent = T('editLoadoutDetailsTitle');
    elements.saveLoadoutHint.textContent = T('editLoadoutHint');
    elements.saveLoadoutSubmit.textContent = T('saveChangesSubmit');
  } else {
    state.saveModalMode = 'create';
    // A preset that's currently loaded (or was just saved) stays the save target by
    // id, not by re-typing its title - so tweaking gear and hitting Save updates that
    // same entry instead of leaving it behind and creating a lookalike duplicate.
    const activeEntry = state.savedLoadouts.find(entry => entry.id === state.activePresetId);
    elements.saveLoadoutTitle.textContent = T('saveCurrentLoadoutTitle');
    if (activeEntry) {
      elements.saveLoadoutName.value = activeEntry.title;
      elements.saveLoadoutDescription.value = activeEntry.description;
      elements.saveLoadoutHint.textContent = T('updatesActiveLoadoutHint', { title: activeEntry.title });
      elements.saveLoadoutSubmit.textContent = T('saveChangesSubmit');
    } else {
      elements.saveLoadoutName.value = nextLoadoutPlaceholderTitle();
      elements.saveLoadoutHint.textContent = T('saveLoadoutDefaultHint');
      elements.saveLoadoutSubmit.textContent = T('saveLoadoutSubmit');
    }
  }
  elements.saveLoadoutModal.hidden = false;
  elements.saveLoadoutModal.setAttribute('aria-hidden', 'false');
  elements.saveLoadoutName.focus();
  elements.saveLoadoutName.select();
}

function closeSaveLoadoutDialog() {
  elements.saveLoadoutModal.hidden = true;
  elements.saveLoadoutModal.setAttribute('aria-hidden', 'true');
}

function saveCurrentLoadout(event) {
  event.preventDefault();
  const title = elements.saveLoadoutName.value.trim();
  const description = elements.saveLoadoutDescription.value.trim();
  if (!title) {
    elements.saveLoadoutName.focus();
    return;
  }

  if (state.saveModalMode === 'edit') {
    const target = state.savedLoadouts.find(entry => entry.id === state.selectedSavedLoadoutId);
    if (!target) {
      closeSaveLoadoutDialog();
      return;
    }
    if (!window.confirm(T('saveChangesConfirm', { title: target.title }))) {
      return;
    }
    target.title = title;
    target.description = description;
    target.updatedAt = new Date().toISOString();
    if (state.activePresetId === target.id) {
      state.activePresetDescription = description;
      if (!state.searchQuery.trim()) {
        showIdleSearchView();
      }
    }
    persistSavedLoadouts();
    renderSavedLoadoutOptions();
    closeSaveLoadoutDialog();
    setStatus(T('updatedLoadoutStatus', { title }));
    return;
  }

  // If a preset is already active (loaded, or saved earlier this session) AND the title
  // wasn't changed, Save updates that same entry by id - same name means "the same
  // preset" getting new gear/description. Changing the title falls through to the
  // create-new-entry code below instead, per the dialog's own hint text ("Change the
  // title to save as a new preset instead").
  const activeIndex = state.savedLoadouts.findIndex(entry => entry.id === state.activePresetId);
  const activeEntry = activeIndex >= 0 ? state.savedLoadouts[activeIndex] : null;
  const isRenamingActiveEntry = activeEntry && activeEntry.title.toLowerCase() === title.toLowerCase();
  if (isRenamingActiveEntry) {
    const target = activeEntry;
    target.title = title;
    target.description = description;
    target.updatedAt = new Date().toISOString();
    target.slots = getCurrentLoadoutSnapshot();
    state.selectedSavedLoadoutId = target.id;
    state.activePresetDescription = description;
    if (!state.searchQuery.trim()) {
      showIdleSearchView();
    }
    persistSavedLoadouts();
    renderSavedLoadoutOptions();
    closeSaveLoadoutDialog();
    setStatus(T('updatedLoadoutStatus', { title }));
    return;
  }

  const snapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slots: getCurrentLoadoutSnapshot(),
  };

  const titleKey = title.toLowerCase();
  const existingIndex = state.savedLoadouts.findIndex(entry => entry.title.toLowerCase() === titleKey);
  if (existingIndex >= 0) {
    if (!window.confirm(T('overwriteLoadoutConfirm', { title: state.savedLoadouts[existingIndex].title }))) {
      return;
    }
    snapshot.id = state.savedLoadouts[existingIndex].id;
    snapshot.createdAt = state.savedLoadouts[existingIndex].createdAt || snapshot.createdAt;
    state.savedLoadouts[existingIndex] = snapshot;
    state.selectedSavedLoadoutId = snapshot.id;
  } else {
    state.savedLoadouts.unshift(snapshot);
    state.selectedSavedLoadoutId = snapshot.id;
  }

  state.activePresetId = snapshot.id;
  state.activePresetDescription = description;
  if (!state.searchQuery.trim()) {
    showIdleSearchView();
  }

  persistSavedLoadouts();
  renderSavedLoadoutOptions();
  closeSaveLoadoutDialog();
  setStatus(T('savedLoadoutStatus', { title }));
}

async function loadSelectedSavedLoadout() {
  const selectedId = elements.savedLoadoutSelect.value;
  const savedLoadout = state.savedLoadouts.find(entry => entry.id === selectedId);
  if (!savedLoadout) {
    return;
  }

  // Region/Language/Market city are app-level filters, not part of the loadout itself -
  // loading a loadout must leave them untouched so switching loadouts never surprises the
  // user by changing what they were comparing prices against.
  state.loadout.clear();
  savedLoadout.slots.forEach(({ slot, item }) => {
    state.loadout.set(slot, item);
  });
  refreshLoadoutDisplayNames();

  state.activePresetId = savedLoadout.id;
  state.activePresetDescription = savedLoadout.description || '';
  // Starts with no slot selected, showing this loadout's own description, rather than
  // silently re-running a search left over from whatever was selected before loading.
  deselectSlot();

  applyTwoHandedRule();
  markPricingDirty(T('loadedLoadoutStatus', { title: savedLoadout.title }));
}

function deleteSelectedSavedLoadout() {
  const selectedId = elements.savedLoadoutSelect.value;
  if (!selectedId) {
    return;
  }
  const target = state.savedLoadouts.find(entry => entry.id === selectedId);
  if (!window.confirm(T('deleteLoadoutConfirm', { title: target ? target.title : T('thisLoadout') }))) {
    return;
  }
  const nextLoadouts = state.savedLoadouts.filter(entry => entry.id !== selectedId);
  state.savedLoadouts = nextLoadouts;
  state.selectedSavedLoadoutId = nextLoadouts[0]?.id || '';
  if (state.activePresetId === selectedId) {
    state.activePresetId = '';
    state.activePresetDescription = '';
    if (!state.searchQuery.trim()) {
      showIdleSearchView();
    }
  }
  persistSavedLoadouts();
  renderSavedLoadoutOptions();
  setStatus(T('savedLoadoutRemoved'));
}

function variantLabel(variant) {
  return `T${variant.tier}.${variant.enchantment}`;
}

function sortVariants(variants) {
  return [...variants].sort((left, right) => {
    if (left.tier !== right.tier) {
      return left.tier - right.tier;
    }
    if (left.enchantment !== right.enchantment) {
      return left.enchantment - right.enchantment;
    }
    return String(left.unique_name || '').localeCompare(String(right.unique_name || ''));
  });
}

function findVariant(variants, tier, enchantment) {
  if (!variants.length) {
    return null;
  }
  const exactMatch = variants.find(variant => variant.tier === tier && variant.enchantment === enchantment);
  if (exactMatch) {
    return exactMatch;
  }
  if (tier != null) {
    const tierMatch = variants.find(variant => variant.tier === tier && (enchantment == null || variant.enchantment === enchantment));
    if (tierMatch) {
      return tierMatch;
    }
  }
  if (enchantment != null) {
    const enchantmentMatch = variants.find(variant => variant.enchantment === enchantment);
    if (enchantmentMatch) {
      return enchantmentMatch;
    }
  }
  return sortVariants(variants)[0];
}

function syncResultPreview(row, variant) {
  const icon = row.querySelector('.result-row-image');
  const spinner = row.querySelector('.result-row-spinner');
  const fallback = row.querySelector('.result-row-fallback');
  const name = row.querySelector('.result-row-name');
  const meta = row.querySelector('.result-row-meta');

  fallback.hidden = true;
  loadIcon(icon, spinner, variant.image_url, {
    onError: () => {
      fallback.hidden = false;
      icon.alt = '';
    },
  });
  icon.alt = variant.display_name;

  name.textContent = variant.display_name;
  meta.textContent = `${variantLabel(variant)} · ${variant.slot_label}`;
  row.title = `${variant.display_name} - ${variant.unique_name}`;
}

function hydrateVariantControls(row, variants, selectedVariant) {
  const tierSelect = row.querySelector('.result-row-tier');
  const enchantSelect = row.querySelector('.result-row-enchant');
  const sortedVariants = sortVariants(variants);
  const tierValues = [...new Set(sortedVariants.map(variant => variant.tier))];

  tierSelect.innerHTML = '';
  tierValues.forEach(tier => {
    const option = document.createElement('option');
    option.value = String(tier);
    option.textContent = `T${tier}`;
    tierSelect.append(option);
  });

  function renderEnchantOptions(tier, preferredEnchantment) {
    const tierVariants = sortedVariants.filter(variant => variant.tier === tier);
    const enchantValues = [...new Set(tierVariants.map(variant => variant.enchantment))];
    enchantSelect.innerHTML = '';
    enchantValues.forEach(enchantment => {
      const option = document.createElement('option');
      option.value = String(enchantment);
      option.textContent = `+${enchantment}`;
      enchantSelect.append(option);
    });
    const safeEnchantment = enchantValues.includes(preferredEnchantment) ? preferredEnchantment : enchantValues[0];
    enchantSelect.value = String(safeEnchantment ?? 0);
    return findVariant(tierVariants, tier, safeEnchantment) || tierVariants[0] || null;
  }

  tierSelect.value = String(selectedVariant.tier);
  let currentVariant = renderEnchantOptions(selectedVariant.tier, selectedVariant.enchantment) || selectedVariant;
  syncResultPreview(row, currentVariant);

  tierSelect.addEventListener('change', () => {
    const nextTier = Number(tierSelect.value);
    currentVariant = renderEnchantOptions(nextTier, currentVariant.enchantment) || currentVariant;
    syncResultPreview(row, currentVariant);
  });

  enchantSelect.addEventListener('change', () => {
    const nextTier = Number(tierSelect.value);
    currentVariant = findVariant(sortedVariants, nextTier, Number(enchantSelect.value)) || currentVariant;
    syncResultPreview(row, currentVariant);
  });

  return () => currentVariant;
}

function renderResultsPrompt(message) {
  elements.resultsBody.innerHTML = '';
  elements.resultsTable.hidden = true;
  elements.resultsEmptyState.textContent = message;
  elements.resultsEmptyState.hidden = false;
  elements.totalCost.textContent = T('noPricesYet');
  elements.itemsFoundCounter.hidden = true;
}

// How many equipped slots actually resolved to a real market price, out of how many are
// being priced in total. `resolvedSlots` may be a partial list while requests are still
// in flight - pass the eventual total explicitly in that case, so the counter can show
// "checking" progress rather than jumping from nothing straight to a final count.
//
// A slot that finishes with no listing anywhere still counts toward the total (see
// optimizeLoadoutWithCities - every equipped item that resolves to a known template
// always produces a slot row), it just doesn't count as "found".
function syncItemsFoundCounter(resolvedSlots, total = resolvedSlots.length) {
  const found = resolvedSlots.filter(slot => slot.best.cheapest_price != null).length;
  const stillChecking = resolvedSlots.length < total;

  elements.itemsFoundCounter.hidden = false;
  elements.itemsFoundCounter.classList.toggle('is-complete', !stillChecking && found === total);
  elements.itemsFoundCounter.classList.toggle('is-empty', !stillChecking && found === 0);

  if (stillChecking) {
    elements.itemsFoundCounter.textContent = T('checkingMarket', { found, total });
  } else if (found === 0) {
    elements.itemsFoundCounter.textContent = T('noItemsFound');
  } else if (found === total) {
    elements.itemsFoundCounter.textContent = T('allItemsFound');
  } else {
    elements.itemsFoundCounter.textContent = T('itemsFoundCount', { found, total });
  }
}

// The quantity a consumable slot's price should be multiplied by. Read from the live
// loadout rather than stored on the results payload, so adjusting quantity and
// re-rendering with the same cached payload (no re-fetch needed) picks it up
// immediately - prices per unit don't change with quantity, only the total does.
function slotQuantity(slot) {
  return getSelected(slot)?.quantity || 1;
}

function computeDisplayTotalFromSlots(slots) {
  return slots.reduce((total, slotResult) => {
    if (slotResult.best.cheapest_price == null) {
      return total;
    }
    return total + slotResult.best.cheapest_price * slotQuantity(slotResult.selected.slot);
  }, 0);
}

function computeDisplayTotal(payload) {
  return computeDisplayTotalFromSlots(payload.slots);
}

// Builds one result-card's DOM (plus its sibling expandable-options row) for a single
// priced slot. Returns the fragment rather than appending it, so it can be used both for
// a full renderResults() pass and for appending one row at a time as live results arrive
// (see requestOptimization()).
function buildResultCardFragment(slotResult) {
  const fragment = elements.resultCardTemplate.content.cloneNode(true);
  translateFragment(fragment);
  const row = fragment.querySelector('.result-card');
  const image = fragment.querySelector('.result-card-image');
  const spinner = fragment.querySelector('.result-card-spinner');
  const fallback = fragment.querySelector('.result-card-fallback');
  const name = fragment.querySelector('.result-card-name');
  const slotLabelEl = fragment.querySelector('.result-card-slot');
  const tierValue = fragment.querySelector('.result-card-tier-value');
  const quality = fragment.querySelector('.result-card-quality');
  const city = fragment.querySelector('.result-card-city');
  const priceValue = fragment.querySelector('.result-card-price-value');
  const updated = fragment.querySelector('.result-card-updated');
  const toggle = fragment.querySelector('.result-card-toggle');
  const apiLink = fragment.querySelector('.result-card-api-link');
  const copyButton = fragment.querySelector('.result-card-copy-button');
  const optionsRow = fragment.querySelector('.result-card-options-row');
  const options = fragment.querySelector('.result-card-options');

  // slotResult.best.image_url is always rendered at quality=1 (serializeVariant() has no
  // notion of a found market listing) - once a price search actually finds one, show the
  // icon at that quality's border instead of always the plain Normal one.
  const iconQuality = slotResult.best.cheapest_quality || 1;
  loadIcon(image, spinner, itemImageUrl(slotResult.best.unique_name, iconQuality, 'en'), {
    onError: () => {
      fallback.hidden = false;
    },
  });
  image.alt = slotResult.best.display_name;
  name.textContent = slotResult.best.display_name;
  slotLabelEl.textContent = slotResult.selected.slot_label;
  tierValue.textContent = variantLabel(slotResult.best);
  quality.textContent = translatedQualityLabel(slotResult.best.cheapest_quality_label);
  quality.style.color = qualityColor(slotResult.best.cheapest_quality_label);
  // No fallback to state.marketCity here: that's the user's *filter*, not where this
  // item is actually priced, and showing it next to a "no market data" price would
  // read as "this is priced in <city>" when it isn't priced anywhere.
  city.textContent = slotResult.best.cheapest_city || '—';
  city.style.color = cityColor(slotResult.best.cheapest_city);
  const hasRealPrice = syncUpdatedAt(updated, slotResult.best.updated_at);
  syncPriceValue(priceValue, slotResult.best.cheapest_price, hasRealPrice, slotQuantity(slotResult.selected.slot));
  if (slotResult.best.api_url) {
    apiLink.href = slotResult.best.api_url;
  } else {
    apiLink.remove();
  }
  if (slotResult.best.market_search_alias) {
    copyButton.addEventListener('click', () => copyMarketAlias(copyButton, slotResult.best.market_search_alias));
  } else {
    copyButton.remove();
  }

  // Every IP-equivalent variant is always listed here, priced or not (see
  // optimizeLoadoutWithCities) - a user comparing options should see every
  // alternative that exists, with a one-click way to check it in-game, rather than
  // unpriced ones silently vanishing.
  if (slotResult.candidates.length > 1) {
    toggle.hidden = false;
    toggle.title = T('equivalentOptionsTitle', { count: slotResult.candidates.length });
    slotResult.candidates.forEach(candidate => {
      const line = document.createElement('div');
      line.className = `option-line${candidate.unique_name === slotResult.best.unique_name ? ' is-best' : ''}`;

      const nameRow = document.createElement('span');
      nameRow.className = 'option-line-name-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'option-line-name';
      nameSpan.textContent = `${candidate.display_name} · ${variantLabel(candidate)}`;

      const leader = document.createElement('span');
      leader.className = 'option-line-leader';
      leader.setAttribute('aria-hidden', 'true');

      const hasCandidatePrice = candidate.cheapest_price != null;
      const candidateDate = parseMarketTimestamp(candidate.updated_at);
      const hasRealCandidatePrice = hasCandidatePrice && Boolean(candidateDate);
      const pricePrefix = hasCandidatePrice && !hasRealCandidatePrice ? '~' : '';

      const priceSpan = document.createElement('span');
      priceSpan.className = 'option-line-price';
      priceSpan.textContent = hasCandidatePrice
        ? `${pricePrefix}${formatSilver(candidate.cheapest_price)} ${T('silverCurrency')}`
        : T('noDataText');
      priceSpan.classList.toggle('is-estimate', hasCandidatePrice && !hasRealCandidatePrice);

      const citySpan = document.createElement('span');
      citySpan.className = 'option-line-city';
      citySpan.textContent = candidate.cheapest_city || '—';
      citySpan.style.color = cityColor(candidate.cheapest_city);

      const qualitySpan = document.createElement('span');
      qualitySpan.className = 'option-line-quality';
      qualitySpan.textContent = translatedQualityLabel(candidate.cheapest_quality_label);
      qualitySpan.style.color = qualityColor(candidate.cheapest_quality_label);

      const freshnessSpan = document.createElement('span');
      freshnessSpan.className = 'option-line-freshness';
      freshnessSpan.textContent = hasRealCandidatePrice ? formatRelativeTime(candidateDate) : T('noDataText');

      const copyLineButton = document.createElement('button');
      copyLineButton.type = 'button';
      copyLineButton.className = 'option-line-copy-button';
      copyLineButton.title = T('copyMarketAliasTitle');
      copyLineButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">content_copy</span>';
      if (candidate.market_search_alias) {
        copyLineButton.addEventListener('click', event => {
          event.stopPropagation();
          copyMarketAlias(copyLineButton, candidate.market_search_alias);
        });
      } else {
        copyLineButton.disabled = true;
      }

      nameRow.append(nameSpan, copyLineButton);
      line.append(nameRow, leader, priceSpan, citySpan, qualitySpan, freshnessSpan);
      options.append(line);
    });

    const toggleOptions = () => {
      const expanded = !toggle.classList.contains('is-expanded');
      toggle.classList.toggle('is-expanded', expanded);
      optionsRow.hidden = !expanded;
    };

    row.classList.add('is-expandable');
    row.addEventListener('click', event => {
      if (event.target.closest('.result-card-api-link, .result-card-copy-button, .option-line-copy-button')) {
        return;
      }
      toggleOptions();
    });
  }

  return fragment;
}

function renderResults(payload) {
  elements.totalCost.textContent = `${formatSilver(computeDisplayTotal(payload))} ${T('silverCurrency')}`;

  if (!payload.slots.length) {
    renderResultsPrompt(T('noPricedSlotsYet'));
    return;
  }

  syncItemsFoundCounter(payload.slots);
  elements.resultsBody.innerHTML = '';
  elements.resultsEmptyState.hidden = true;
  elements.resultsTable.hidden = false;

  payload.slots.forEach(slotResult => {
    elements.resultsBody.append(buildResultCardFragment(slotResult));
  });
}

function clearLoadout() {
  if (!state.loadout.size) {
    return;
  }
  if (!window.confirm(T('clearAllConfirm'))) {
    return;
  }
  state.loadout.clear();
  state.activePresetId = '';
  state.activePresetDescription = '';
  if (!state.searchQuery.trim()) {
    showIdleSearchView();
  }
  markPricingDirty(); // also calls syncSlotRows(), which redraws every slot as empty
}

// Briefly swaps a labeled button's icon and text for a checkmark + "Copied!", the same
// feedback copyMarketAlias() gives icon-only copy buttons, adapted for one with a visible
// label so the confirmation doesn't rely on a status line the user might not be looking at.
function flashCopiedFeedback(button) {
  const icon = button.querySelector('.material-symbols-rounded');
  const label = button.querySelector('[data-i18n]');
  const originalIcon = icon.textContent;
  const originalLabel = label ? label.textContent : null;
  icon.textContent = 'check';
  if (label) label.textContent = T('copiedFeedback');
  button.classList.add('is-copied');
  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => {
    icon.textContent = originalIcon;
    if (label) label.textContent = originalLabel;
    button.classList.remove('is-copied');
  }, 1500);
}

async function copyLoadoutCode() {
  if (!state.loadout.size) {
    window.alert(T('equipAnItemFirst'));
    return;
  }
  const code = encodeLoadoutCode();
  try {
    await navigator.clipboard.writeText(code);
    setStatus(T('loadoutCodeCopied'));
    flashCopiedFeedback(elements.exportLoadoutButton);
  } catch {
    // Clipboard access can be denied (permissions, insecure context); a prompt with
    // the text pre-selected is a plain fallback that still lets the user copy it.
    window.prompt(T('copyLoadoutCodePrompt'), code);
  }
}

function importLoadoutCode() {
  const input = window.prompt(T('pasteLoadoutCodePrompt'));
  if (!input) {
    return;
  }

  let entries;
  try {
    entries = decodeLoadoutCode(input);
  } catch (error) {
    window.alert(T('couldNotReadLoadoutCode', { message: error.message }));
    return;
  }

  if (state.loadout.size && !window.confirm(T('replaceCurrentLoadoutConfirm'))) {
    return;
  }

  const knownSlots = new Set(state.config.slots.map(entry => entry.key));
  const resolved = [];
  let skipped = 0;
  entries.forEach(({ slot, uniqueName, quantity }) => {
    const item = knownSlots.has(slot) ? getItem(uniqueName, { lang: state.language }) : null;
    if (item) {
      resolved.push([slot, { ...item, quantity }]);
    } else {
      skipped += 1;
    }
  });

  if (!resolved.length) {
    window.alert(T('noItemsRecognized'));
    return;
  }

  state.loadout.clear();
  resolved.forEach(([slot, item]) => state.loadout.set(slot, item));
  applyTwoHandedRule();

  // An imported code has no title of its own, so it becomes a new saved loadout right
  // away instead of just replacing the unsaved working gear, where it would be lost the
  // next time a different loadout is loaded.
  const title = nextAvailableLoadoutTitle(T('importedLoadoutTitlePrefix'));
  const snapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slots: getCurrentLoadoutSnapshot(),
  };
  state.savedLoadouts.unshift(snapshot);
  state.selectedSavedLoadoutId = snapshot.id;
  state.activePresetId = snapshot.id;
  state.activePresetDescription = '';
  persistSavedLoadouts();
  renderSavedLoadoutOptions();

  if (!state.searchQuery.trim()) {
    showIdleSearchView();
  }

  const itemWord = T(resolved.length === 1 ? 'itemWordSingular' : 'itemWordPlural');
  const skippedNote = skipped ? T('notRecognizedNote', { count: skipped }) : '';
  markPricingDirty(T('importedLoadoutStatus', { title, count: resolved.length, itemWord, skippedNote }));
}

function markPricingDirty(message = T('loadoutChangedHint')) {
  state.pricingDirty = true;
  state.lastResultsPayload = null;
  renderResultsPrompt(message);
  setStatus(message);
  syncSlotRows();
}

function scheduleSearch(query) {
  if (!state.selectedSlot) {
    return;
  }
  state.searchQuery = query;
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => runSearch(state.selectedSlot, query), 160);
}

// An empty query is not "no search" - matchesQuery() in text.js treats it as matching
// everything, so this lists every item available for the slot (capped at the usual
// result limit) rather than requiring the user to type before seeing any options.
async function runSearch(slot, query) {
  elements.searchResults.innerHTML = `<div class="empty-state">${T('searchingEllipsis')}</div>`;
  try {
    const payload = getItems({ query, lang: state.language, slot });
    if (state.selectedSlot !== slot) {
      return;
    }
    elements.searchResults.innerHTML = '';
    if (!payload.items.length) {
      renderSearchPrompt(query.trim() ? T('noMatchesFound') : T('noItemsForSlot'));
      return;
    }

    payload.items.forEach(item => {
      const variants = sortVariants(Array.isArray(item.variants) && item.variants.length ? item.variants : [item]);
      const selectedVariant = findVariant(variants, item.tier, item.enchantment) || variants[0];
      const fragment = elements.resultRowTemplate.content.cloneNode(true);
      translateFragment(fragment);
      const row = fragment.querySelector('.result-row');
      const useButton = fragment.querySelector('.result-row-use');
      const quantityField = fragment.querySelector('.result-row-quantity-field');
      const quantitySelect = fragment.querySelector('.result-row-quantity');
      const getCurrentVariant = hydrateVariantControls(row, variants, selectedVariant);

      if (isConsumableSlot(slot)) {
        quantityField.hidden = false;
        for (let quantity = 1; quantity <= MAX_CONSUMABLE_QUANTITY; quantity += 1) {
          const option = document.createElement('option');
          option.value = String(quantity);
          option.textContent = `×${quantity}`;
          quantitySelect.append(option);
        }
      }

      useButton.addEventListener('click', () => {
        const activeVariant = getCurrentVariant();
        if (!activeVariant) {
          return;
        }
        const quantity = isConsumableSlot(slot) ? Number(quantitySelect.value) || 1 : 1;
        equip(slot, activeVariant, quantity);
      });

      elements.searchResults.append(fragment);
    });
  } catch (error) {
    renderSearchPrompt(T('searchFailed', { message: error.message }));
  }
}

function equip(slot, variant, quantity = 1) {
  state.loadout.set(slot, { ...variant, quantity });
  applyTwoHandedRule();
  markPricingDirty();

  const nextEmpty = state.config.slots.find(entry => isSlotAvailable(entry.key) && !getSelected(entry.key));
  if (nextEmpty) {
    selectSlot(nextEmpty.key);
  } else {
    renderSearchPrompt(T('allSlotsFilledHint'));
  }
}

function refreshLoadoutDisplayNames() {
  Array.from(state.loadout.entries()).forEach(([slot, item]) => {
    // An unknown template keeps the item as-is rather than blanking the slot. quantity
    // is app-local state, not part of the domain payload getItem() returns, so it has
    // to be carried over explicitly or a language switch would silently reset it to 1.
    const updated = getItem(item.unique_name, { lang: state.language });
    state.loadout.set(slot, updated ? { ...updated, quantity: item.quantity } : item);
  });
}

// Prices, cities and timestamps do not depend on language - only display text does. So
// relabel the already-fetched results in place instead of re-running the optimizer,
// which would spend real API requests just to change wording.
function refreshResultsDisplayNames() {
  if (!state.lastResultsPayload || !state.lastResultsPayload.slots.length) {
    return;
  }

  const uniqueNames = new Set();
  state.lastResultsPayload.slots.forEach(slotResult => {
    uniqueNames.add(slotResult.selected.unique_name);
    slotResult.candidates.forEach(candidate => uniqueNames.add(candidate.unique_name));
  });

  const updatesByName = new Map();
  uniqueNames.forEach(uniqueName => {
    const updated = getItem(uniqueName, { lang: state.language });
    if (updated) {
      updatesByName.set(uniqueName, updated);
    }
  });

  state.lastResultsPayload.slots.forEach(slotResult => {
    const selectedUpdate = updatesByName.get(slotResult.selected.unique_name);
    if (selectedUpdate) {
      slotResult.selected = selectedUpdate;
    }
    slotResult.candidates.forEach(candidate => Object.assign(candidate, updatesByName.get(candidate.unique_name)));
    Object.assign(slotResult.best, updatesByName.get(slotResult.best.unique_name));
  });
  state.lastResultsPayload.language = state.language;
  renderResults(state.lastResultsPayload);
}

async function requestOptimization() {
  if (!state.loadout.size) {
    setStatus(T('equipAnItemFirst'));
    return;
  }

  const entries = Array.from(state.loadout.entries());
  const cities = state.marketCity === 'all' ? [] : [state.marketCity];
  const total = entries.length;

  setStatus(T('fetchingPrices'));
  elements.resultsBody.innerHTML = '';
  elements.resultsEmptyState.hidden = true;
  elements.resultsTable.hidden = false;
  elements.totalCost.textContent = `${T('fetchingPrices')}...`;
  syncItemsFoundCounter([], total);

  // Each equipped item is priced independently and its row is appended to the table the
  // moment its own result comes back, rather than waiting for the whole loadout - the
  // items-found counter and the total both fill in live as responses arrive instead of
  // jumping from nothing straight to a finished table after one silent wait. Requests
  // run concurrently, so they don't necessarily resolve in equip order; a final render
  // below re-lays the table out in that stable order once everything has settled.
  const resolvedSlots = [];
  await Promise.allSettled(
    entries.map(async ([slot, item]) => {
      const slotPayload = await optimize({
        loadout: [{ slot, unique_name: item.unique_name }],
        region: state.region,
        language: state.language,
        cities,
        minQuality: state.minQuality,
      });
      const slotResult = slotPayload.slots[0];
      if (!slotResult) {
        return;
      }
      resolvedSlots.push(slotResult);
      elements.resultsBody.append(buildResultCardFragment(slotResult));
      syncItemsFoundCounter(resolvedSlots, total);
      elements.totalCost.textContent = `${formatSilver(computeDisplayTotalFromSlots(resolvedSlots))} ${T('silverCurrency')}`;
    }),
  );

  const resolvedCities = cities.length ? cities : state.config.regions[state.region]?.cities || [];
  const payload = {
    region: state.region,
    language: state.language,
    cities: resolvedCities,
    // Reorder to match the equipped slot order (Map insertion order), not whichever
    // request happened to finish first.
    slots: entries.map(([slot]) => resolvedSlots.find(result => result.selected.slot === slot)).filter(Boolean),
    total_cost: resolvedSlots.reduce((sum, result) => sum + (result.best.cheapest_price ?? 0), 0),
    currency: 'silver',
  };

  state.pricingDirty = false;
  state.lastResultsPayload = payload;
  renderResults(payload);
  hideStatus();
}

async function boot() {
  setStatus(T('loadingStatus'));
  // The catalog is a same-origin asset shipped by the same deploy as this file, so a
  // failure here means a broken deploy or an offline user - both worth showing plainly
  // rather than leaving a page that renders but silently does nothing.
  await loadCatalog(CATALOG_URL);
  state.config = getConfig();
  applyStoredFilters();
  state.savedLoadouts = loadSavedLoadoutsFromStorage();
  state.loadoutSortOrder = loadLoadoutSortOrderFromStorage();
  elements.savedLoadoutSortSelect.value = state.loadoutSortOrder;
  state.selectedSavedLoadoutId = '';
  applyStaticTranslations();
  renderConfig();
  renderInventory();
  renderSavedLoadoutOptions();
  setStatus(T('readyStatus'));

  // Starts with no slot selected, showing the generic hint (or a loaded loadout's own
  // description, once one is loaded) instead of auto-picking the first slot.
  deselectSlot();

  elements.regionSelect.addEventListener('change', event => {
    state.region = event.target.value;
    renderMarketCityOptions();
    persistFilters();
    markPricingDirty(T('regionChangedHint'));
  });

  elements.languageSelect.addEventListener('change', event => {
    state.language = event.target.value;
    persistFilters();
    // Language only changes display text, not prices/cities - unlike region/market city
    // changes, it must not clear the results table (markPricingDirty() would). Both the
    // loadout slots and any already-fetched results are relabeled in place instead.
    applyStaticTranslations();
    renderInventory();
    renderMarketCityOptions();
    renderMinQualityOptions();
    renderSavedLoadoutOptions();
    refreshLoadoutDisplayNames();
    refreshResultsDisplayNames();
    syncSlotRows();
    setStatus(T('languageChangedStatus'));
    if (state.selectedSlot) {
      elements.searchTitle.textContent = T('addToSlot', { label: slotLabel(state.selectedSlot, state.language) });
      if (state.searchQuery.trim()) {
        scheduleSearch(state.searchQuery);
      } else {
        showIdleSearchView();
      }
    } else {
      elements.searchTitle.textContent = T('selectSlotHeading');
      showIdleSearchView();
    }
  });

  elements.marketCitySelect.addEventListener('change', event => {
    state.marketCity = event.target.value;
    syncSelectColor(elements.marketCitySelect, cityColor(state.marketCity));
    persistFilters();
    markPricingDirty(T('marketCityChangedHint'));
  });

  elements.minQualitySelect.addEventListener('change', event => {
    state.minQuality = Number(event.target.value) || 1;
    const selectedQuality = state.config.qualities.find(({ value }) => value === state.minQuality);
    syncSelectColor(elements.minQualitySelect, selectedQuality ? qualityColor(selectedQuality.label) : '');
    persistFilters();
    markPricingDirty(T('minQualityChangedHint'));
  });

  elements.refreshButton.addEventListener('click', () => {
    // Price requests now leave the user's own browser, so the API's per-IP rate limit is
    // theirs alone to exhaust. Impatient double-clicking used to cost the shared server a
    // few requests; now it can lock the user out of their own pricing.
    if (state.pricingInFlight) {
      return;
    }
    state.pricingInFlight = true;
    elements.refreshButton.disabled = true;
    requestOptimization()
      .catch(error => {
        setStatus(T('optimizationFailed', { message: error.message }));
        renderResultsPrompt(T('couldNotFetchPrices', { message: error.message }));
      })
      .finally(() => {
        state.pricingInFlight = false;
        elements.refreshButton.disabled = false;
      });
  });

  elements.clearLoadoutButton.addEventListener('click', clearLoadout);
  elements.exportLoadoutButton.addEventListener('click', () => {
    copyLoadoutCode().catch(error => {
      setStatus(T('couldNotCopyLoadoutCode', { message: error.message }));
    });
  });
  elements.importLoadoutButton.addEventListener('click', importLoadoutCode);

  elements.saveLoadoutButton.addEventListener('click', () => {
    openSaveLoadoutDialog('create');
  });
  elements.editSavedLoadoutButton.addEventListener('click', () => {
    openSaveLoadoutDialog('edit');
  });
  elements.saveLoadoutCancel.addEventListener('click', closeSaveLoadoutDialog);
  elements.saveLoadoutClose.addEventListener('click', closeSaveLoadoutDialog);
  elements.saveLoadoutModal.addEventListener('click', event => {
    if (event.target === elements.saveLoadoutModal) {
      closeSaveLoadoutDialog();
    }
  });
  elements.saveLoadoutForm.addEventListener('submit', saveCurrentLoadout);
  elements.loadSavedLoadoutButton.addEventListener('click', () => {
    loadSelectedSavedLoadout().catch(error => {
      setStatus(T('couldNotLoadSavedLoadout', { message: error.message }));
    });
  });
  elements.deleteSavedLoadoutButton.addEventListener('click', deleteSelectedSavedLoadout);
  elements.savedLoadoutSortSelect.addEventListener('change', event => {
    state.loadoutSortOrder = event.target.value === 'alpha' ? 'alpha' : 'recent';
    window.localStorage.setItem(LOADOUT_SORT_ORDER_KEY, state.loadoutSortOrder);
    renderSavedLoadoutOptions();
  });
  elements.savedLoadoutSelect.addEventListener('change', event => {
    state.selectedSavedLoadoutId = event.target.value;
    const hasSelection = Boolean(state.selectedSavedLoadoutId);
    elements.loadSavedLoadoutButton.disabled = !hasSelection;
    elements.editSavedLoadoutButton.disabled = !hasSelection;
    elements.deleteSavedLoadoutButton.disabled = !hasSelection;
    // Picking a loadout from the dropdown loads it immediately - the "Load" button stays
    // around for re-loading the same selection on demand (discarding unsaved gear changes
    // without having to reselect it), not as the only way to load one.
    if (hasSelection) {
      loadSelectedSavedLoadout().catch(error => {
        setStatus(T('couldNotLoadSavedLoadout', { message: error.message }));
      });
    }
  });

  elements.searchInput.addEventListener('input', event => scheduleSearch(event.target.value));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.saveLoadoutModal.hidden) {
      closeSaveLoadoutDialog();
    }
  });
}

boot()
  .then(() => {
    elements.bootStatus.hidden = true;
  })
  .catch(error => {
    setStatus(T('failedToLoad', { message: error.message }));
    // Must be visible, not just logged: setStatus only writes to the console, so without
    // this the page would render its empty shell and appear merely broken.
    elements.bootStatus.hidden = false;
    elements.bootStatus.classList.add('is-error');
    elements.bootStatus.textContent = T('couldNotStart', { message: error.message });
  });
