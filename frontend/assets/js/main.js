const $ = selector => document.querySelector(selector);
const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.flat().filter(child => child != null && child !== false));
  return node;
};

const state = {
  shops: [], models: [], components: [], componentChecks: [],
  options: {}, view: location.hash === '#components' ? 'components' : 'panels',
  shopId: null, stock: '', editor: null,
};
const layout = $('.layout');
const shopList = $('#shops');
const workspace = $('#workspace');
const componentsPage = $('#components-page');
const componentList = $('#component-list');
const dialog = $('#editor');
const form = $('#editor-form');
const media = matchMedia('(max-width: 48rem)');
let flashTimer;

async function api(path, init) {
  let response;
  try {
    response = await fetch('/api/v1' + path, init);
  } catch {
    throw new Error('Connection lost. Reconnect and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Server unavailable. Try again.');
  return data;
}

function action(label, callback, style = '') {
  const node = el('button', ('button ' + style).trim(), label);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}

function safeLink(label, href, style, external = true) {
  if (!href || !URL.canParse(href)) return null;
  const url = new URL(href);
  if (!['https:', 'http:', 'tel:', 'mailto:'].includes(url.protocol)) return null;
  const node = el('a', style, label);
  node.href = url.href;
  if (external && ['https:', 'http:'].includes(url.protocol)) {
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
  return node;
}

function phoneHref(value) {
  if (!value) return null;
  const match = value.match(/\+250(?:[ -]?\d){9}|(?:0\d{9})|^\d{4}$/m);
  return match ? 'tel:' + match[0].replace(/[ -]/g, '') : null;
}

const dateText = new Intl.DateTimeFormat('en-RW', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kigali',
});
const todayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' });
const money = new Intl.NumberFormat('en-RW');
const dateLabel = value => dateText.format(new Date(value + 'T12:00:00Z'));
function today() {
  const parts = Object.fromEntries(todayFormat.formatToParts(new Date()).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function flash(text) {
  $('#flash').textContent = text;
  $('#flash').hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $('#flash').hidden = true; }, 3300);
}

function chip(text, type = '') {
  return el('span', ('chip ' + type).trim(), text);
}

function currentShop() {
  return state.shops.find(shop => shop.id === state.shopId);
}

function hashShop() {
  return Number(/^#shop-(\d+)$/.exec(location.hash)?.[1]) || null;
}

function selectShop(id) {
  state.shopId = id;
  state.stock = '';
  const hash = id ? '#shop-' + id : '';
  if (location.hash !== hash) history.pushState(null, '', '/' + hash);
  render();
  if (media.matches) window.scrollTo(0, 0);
}

function searchValue(record, keys) {
  return keys.map(key => record[key] ?? '').join(' ').toLocaleLowerCase();
}

function renderDirectory() {
  const terms = $('#search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visitFilter = $('#visit-filter').value;
  const visible = state.shops.filter(shop => {
    if (visitFilter === 'visited' && !shop.visited_on) return false;
    if (visitFilter === 'unvisited' && shop.visited_on) return false;
    if (visitFilter === 'owner' && shop.owner_status === 'Contact obtained') return false;
    const shopText = searchValue(shop, ['name', 'location', 'offering']);
    const models = state.models.filter(model => model.shop_id === shop.id);
    return terms.every(term => shopText.includes(term) || models.some(model =>
      searchValue(model, ['listing', 'brand', 'confirmed_code', 'watts', 'max_watts']).includes(term),
    ));
  });
  const visited = state.shops.filter(shop => shop.visited_on).length;
  $('#directory-progress').textContent = visited + ' of ' + state.shops.length + ' shops visited';
  shopList.replaceChildren(...visible.map(shop => {
    const models = state.models.filter(model => model.shop_id === shop.id);
    const checked = models.filter(model => model.stock_status !== 'Not checked').length;
    const text = models.length ? checked + ' / ' + models.length + ' models checked' : 'Ask for model list';
    const node = el('a', 'shop-link', el('span', '', el('strong', '', shop.name),
      el('small', '', shop.visited_on ? 'Visited · ' + text : text)), el('span', 'arrow', '›'));
    node.href = '#shop-' + shop.id;
    if (state.shopId === shop.id) node.setAttribute('aria-current', 'page');
    node.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectShop(shop.id);
    });
    return node;
  }));
  if (!visible.length) shopList.append(el('p', 'panel-message muted', 'No shops match this filter.'));
}

function publicContact(shop) {
  const phone = phoneHref(shop.public_contact_phone);
  return el('article', 'contact-card',
    el('h3', '', 'Public business contact'),
    el('p', 'contact-value', shop.public_contact || 'No named contact listed'),
    shop.public_contact_phone && el('p', 'muted',
      safeLink(shop.public_contact_phone, phone) || shop.public_contact_phone),
    shop.other_phone && el('p', 'muted', shop.other_phone),
    shop.contact_url && el('p', 'muted', safeLink('Contact source', shop.contact_url)),
  );
}

function ownerContact(shop) {
  return el('article', 'contact-card',
    el('div', 'contact-top', el('h3', '', 'Owner / decision-maker'),
      action('Update contact', () => openEditor('owner', shop))),
    el('p', '', chip(shop.owner_status, shop.owner_status === 'Contact obtained' ? 'good' : '')),
    (shop.owner_name || shop.owner_role) && el('p', 'contact-value',
      [shop.owner_name, shop.owner_role].filter(Boolean).join(' · ')),
    shop.owner_phone && el('p', '', safeLink(shop.owner_phone, phoneHref(shop.owner_phone)) || shop.owner_phone),
    shop.owner_email && el('p', '', safeLink(shop.owner_email, 'mailto:' + shop.owner_email)),
    shop.owner_notes && el('p', 'muted', shop.owner_notes),
  );
}

const stockColors = { 'In stock': 'good', 'Can order': 'wait', Unavailable: 'bad', 'Different model': 'wait' };
function modelRow(model, shop) {
  const watts = model.max_watts ? model.watts + '–' + model.max_watts + ' W' : model.watts && model.watts + ' W';
  const facts = [model.brand, watts, model.price_rwf == null ? null : money.format(model.price_rwf) + ' RWF listed']
    .filter(Boolean).join(' · ');
  let programmable = model.programmable === 'N/A (panel only)' ? 'Panel only' : '';
  if (model.programmable === 'No') programmable = 'Programmable: no';
  if (model.programmable === 'Unknown') programmable = 'Programming unknown';
  if (model.programmable === 'Yes') {
    programmable = 'Programmable' + (model.programmable_by_default === 'Yes' ? ' as sold'
      : model.programmable_by_default === 'No' ? ' after setup' : ' · default unconfirmed');
  }

  const sources = el('div', 'source-links',
    safeLink('Listing', model.listing_url), safeLink('Datasheet', model.datasheet_url),
  );
  const info = el('div', 'model-summary',
    el('h3', '', model.listing),
    facts && el('p', 'muted', facts),
    model.confirmed_code && el('p', 'muted', 'Confirmed model: ' + model.confirmed_code),
    el('p', 'muted', [model.entry_source, model.online_status].filter(Boolean).join(' · ')),
    model.source_notes && el('p', 'muted', model.source_notes),
    sources.childElementCount ? sources : null,
  );
  const check = el('div', 'status-cell',
    chip(model.stock_status, stockColors[model.stock_status]),
    model.checked_on && el('p', 'muted', dateLabel(model.checked_on)),
    programmable && el('p', 'muted', programmable),
    model.device && el('p', 'muted', model.device),
    model.visit_notes && el('p', 'muted', model.visit_notes),
  );
  return el('article', 'model-row', info, check,
    action(model.stock_status === 'Not checked' ? 'Check model' : 'Update check',
      () => openEditor('model', model, shop), 'model-check'),
  );
}

function panelSection(shop) {
  const all = state.models.filter(model => model.shop_id === shop.id);
  const checked = all.filter(model => model.stock_status !== 'Not checked').length;
  const stock = el('select', '', ...['', ...state.options.stockOptions].map(value => {
    const option = el('option', '', value || 'All stock statuses');
    option.value = value;
    return option;
  }));
  stock.value = state.stock;
  stock.setAttribute('aria-label', 'Filter models by stock check');
  const list = el('div', 'model-list');
  function fill() {
    const shown = all.filter(model => !state.stock || model.stock_status === state.stock);
    list.replaceChildren(...shown.map(model => modelRow(model, shop)));
    if (!shown.length) {
      list.append(el('p', 'muted panel-message', all.length
        ? 'No models match this stock status.'
        : 'No model list published. Add the panels you find during your visit.'));
    }
  }
  stock.addEventListener('change', () => {
    state.stock = stock.value;
    fill();
  });
  fill();
  return el('section', 'model-section',
    el('div', 'section-heading', el('div', '', el('h2', '', 'Panel models'),
      el('p', 'muted', checked + ' of ' + all.length + ' checked')),
      action('+ Add model', () => openEditor('model', null, shop), 'primary')),
    all.length ? el('div', 'model-tools', stock) : null,
    list,
    el('details', 'programming-note', el('summary', '', 'How to check programmability'),
      el('p', '', 'For a plain PV panel, choose N/A (panel only). For a smart module or kit, identify the exact electronics and check whether settings can be adjusted as sold. Record any required activation, add-on, or installer access.')),
  );
}

function renderWorkspace() {
  const shop = currentShop();
  layout.classList.toggle('has-shop', !!shop);
  if (!shop) {
    workspace.replaceChildren(el('p', 'panel-message muted', 'Choose a shop to see its contacts and panels.'));
    return;
  }

  const phone = phoneHref(shop.phone);
  const whatsappLine = shop.other_phone?.split('\n').find(line => /whatsapp/i.test(line));
  const whatsapp = phoneHref(whatsappLine)?.replace(/\D/g, '');
  const links = el('div', 'contact-actions',
    safeLink(shop.phone, phone, 'button', false),
    safeLink('Directions', shop.map_url, 'button'),
    whatsapp && safeLink('WhatsApp', 'https://wa.me/' + whatsapp, 'button'),
    shop.email && safeLink('Email', 'mailto:' + shop.email, 'button', false),
  );
  const sources = el('div', 'source-links muted',
    safeLink('Shop source', shop.shop_url), safeLink('Other source', shop.offering_url),
  );
  const owner = ownerContact(shop);
  const panels = panelSection(shop);
  const jumpTo = section => {
    section.tabIndex = -1;
    section.focus({ preventScroll: true });
    section.scrollIntoView();
  };
  const head = el('article', 'shop-head',
    el('div', 'shop-top', el('div', '',
      el('h2', '', shop.name), shop.location && el('p', 'location', shop.location)),
      action('Edit shop', () => openEditor('shop', shop))),
    links.childElementCount ? links : null,
    shop.phone && !phone && el('p', 'muted', shop.phone),
    shop.offering && el('p', 'shop-offer', shop.offering),
    shop.questions && el('p', 'programming-note', shop.questions),
    sources.childElementCount ? sources : null,
    el('div', 'shop-visit',
      chip(shop.visited_on ? 'Visited ' + dateLabel(shop.visited_on) : 'To visit', shop.visited_on ? 'good' : 'wait'),
      action(shop.visited_on ? 'Edit visit' : 'Record visit', () => openEditor('visit', shop)),
      shop.visit_notes && el('span', 'muted', shop.visit_notes)),
    el('div', 'mobile-jump',
      action('Panel models ↓', () => jumpTo(panels)),
      action('Owner contact ↓', () => jumpTo(owner))),
  );
  workspace.replaceChildren(action('‹ All shops', () => selectShop(null), 'mobile-back'),
    head, el('div', 'contact-grid', publicContact(shop), owner), panels);
}

function render() {
  const showingComponents = state.view === 'components';
  layout.hidden = showingComponents;
  componentsPage.hidden = !showingComponents;
  $('#add-shop').hidden = showingComponents;
  for (const [tab, active] of [['#components-tab', showingComponents], ['#panels-tab', !showingComponents]]) {
    if (active) $(tab).setAttribute('aria-current', 'page');
    else $(tab).removeAttribute('aria-current');
  }
  if (showingComponents) {
    if (state.options.componentCategories) renderComponents();
    else if (state.options.stockOptions) componentList.replaceChildren(
      el('p', 'panel-message muted', 'Components are unavailable. Refresh after the server update.'));
  } else if (state.options.stockOptions) {
    renderDirectory();
    renderWorkspace();
  }
}

function plannedBudget(item) {
  const { budget_min_rwf: min, budget_max_rwf: max, budget_basis: basis } = item;
  if (min == null && max == null) return null;
  const range = min == null ? 'up to ' + money.format(max)
    : max == null ? 'from ' + money.format(min)
      : min === max ? money.format(min) : money.format(min) + '–' + money.format(max);
  return 'Planned budget ' + range + ' RWF' + (basis ? ' · ' + basis : '');
}

function componentQuote(check, item) {
  const phone = safeLink(check.vendor_phone, phoneHref(check.vendor_phone));
  return el('article', 'component-quote',
    el('div', '',
      el('div', 'quote-head', el('strong', '', check.vendor),
        chip(check.availability, stockColors[check.availability])),
      check.amount_rwf != null && el('p', 'quote-price',
        money.format(check.amount_rwf) + ' RWF · ' + check.price_basis),
      (check.vendor_phone || check.vendor_location) && el('p', 'muted',
        phone || check.vendor_phone, check.vendor_phone && check.vendor_location ? ' · ' : null, check.vendor_location),
      el('p', 'muted', dateLabel(check.checked_on)),
      check.notes && el('p', '', check.notes)),
    action('Edit check', () => openEditor('component-check', check, item)),
  );
}

function componentCard(item, checks) {
  const budget = plannedBudget(item);
  return el('article', 'component-card',
    el('div', 'section-heading',
      el('div', '', el('h4', '', item.name), item.quantity && el('p', 'muted', 'Quantity ' + item.quantity)),
      el('div', 'component-actions',
        action('Edit details', () => openEditor('component', item)),
        action('+ Vendor check', () => openEditor('component-check', null, item), 'primary'))),
    item.description && el('p', '', item.description),
    budget && el('p', 'muted', budget),
    item.vendor_leads && el('p', 'muted', 'Vendor leads · ' + item.vendor_leads),
    checks.length
      ? el('div', 'component-quotes', ...checks.map(check => componentQuote(check, item)))
      : el('p', 'muted', 'No vendor checks yet'),
  );
}

function renderComponents() {
  const terms = $('#component-search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const category = $('#component-category').value;
  const byComponent = new Map();
  for (const check of state.componentChecks) {
    if (!byComponent.has(check.component_id)) byComponent.set(check.component_id, []);
    byComponent.get(check.component_id).push(check);
  }
  $('#component-progress').textContent = byComponent.size + ' of ' + state.components.length + ' components checked';
  const visible = state.components.filter(item => {
    if (category && item.category !== category) return false;
    const checks = byComponent.get(item.id) || [];
    const details = searchValue(item, ['name', 'description', 'vendor_leads', 'category']) + ' ' +
      checks.map(check => searchValue(check, ['vendor', 'vendor_location', 'notes'])).join(' ');
    return terms.every(term => details.includes(term));
  });
  const groups = state.options.componentCategories.map(name => {
    const rows = visible.filter(item => item.category === name);
    return rows.length ? el('section', 'component-group', el('h3', '', name),
      ...rows.map(item => {
        const checks = (byComponent.get(item.id) || []).sort((a, b) =>
          b.checked_on.localeCompare(a.checked_on) || b.id - a.id);
        return componentCard(item, checks);
      })) : null;
  }).filter(Boolean);
  componentList.replaceChildren(...groups);
  if (!groups.length) componentList.append(el('p', 'panel-message muted', 'No components match this filter.'));
}

function selectView(view) {
  state.view = view;
  const hash = view === 'components' ? '#components' : state.shopId ? '#shop-' + state.shopId : '';
  if (hash !== location.hash) history.pushState(null, '', '/' + hash);
  render();
  window.scrollTo(0, 0);
}

function field(name, label, kind = 'text', settings = {}) {
  return { name, label, kind, ...settings };
}
const notesField = (name, label) => field(name, label, 'textarea', { wide: true });
const linkField = (name, label) => field(name, label, 'url', { wide: true });
const selectField = (name, label, options, placeholder) => field(name, label, 'select', { options, placeholder });
const numberField = (name, label, min = 1) => field(name, label, 'number', { min });

function fieldGrid(fields, data) {
  return el('div', 'field-grid', ...fields.map(spec => {
    const control = el(spec.kind === 'textarea' || spec.kind === 'select' ? spec.kind : 'input');
    control.name = spec.name;
    control.id = 'edit-' + spec.name;
    if (spec.kind === 'select') {
      const choices = spec.placeholder ? ['', ...spec.options] : spec.options;
      for (const choice of choices) {
        const option = el('option', '', choice || spec.placeholder);
        option.value = choice;
        control.append(option);
      }
    } else if (control.tagName === 'INPUT') {
      control.type = spec.kind;
    }
    if (spec.min != null) control.min = spec.min;
    if (spec.kind === 'number') control.step = '1';
    if (spec.kind === 'text' || spec.kind === 'textarea') control.maxLength = spec.kind === 'textarea' ? 2000 : 300;
    if (spec.required) control.required = true;
    control.value = data[spec.name] ?? '';
    const label = el('label', '', spec.label);
    label.htmlFor = control.id;
    return el('div', spec.wide ? 'field wide' : 'field', label, control, spec.help && el('small', '', spec.help));
  }));
}

function group(label, fields, data) {
  return el('details', 'form-group', el('summary', '', label), fieldGrid(fields, data));
}

function openEditor(type, record, parent) {
  const data = { ...record };
  const options = state.options;
  state.editor = { type, record, parent };
  const fields = $('#editor-fields');
  const name = $('#editor-title');
  const error = $('#editor-error');
  error.hidden = true;
  error.textContent = '';

  if (type === 'model') {
    data.checked_on ||= today();
    data.stock_status ||= 'Not checked';
    data.entry_source ||= 'Shop visit';
    name.textContent = record ? 'Check panel model' : 'Add panel model';
    fields.replaceChildren(fieldGrid([
      field('listing', 'Model or listing', 'text', { required: true, wide: true }),
      field('brand', 'Brand'), field('confirmed_code', 'Confirmed model code'),
      numberField('watts', 'Watts'), numberField('max_watts', 'Maximum watts for a range'),
      selectField('stock_status', 'Stock check', options.stockOptions),
      field('checked_on', 'Check date', 'date'),
      selectField('programmable', 'Programmable?', options.programmingOptions, 'Not checked'),
      selectField('programmable_by_default', 'Programmable by default?', options.defaultOptions, 'Not checked'),
      field('device', 'Programmable device / model', 'text', { wide: true }),
      notesField('visit_notes', 'Visit notes / evidence'),
    ], data), group('Listing and sourcing details', [
      selectField('entry_source', 'Entry source', options.entryOptions),
      numberField('price_rwf', 'Online list price (RWF)', 0),
      field('online_status', 'Online listing status'),
      notesField('source_notes', 'Source notes'),
      linkField('listing_url', 'Listing URL'), linkField('datasheet_url', 'Datasheet URL'),
    ], data));
    const programmable = form.elements.programmable;
    programmable.addEventListener('change', () => {
      const byDefault = form.elements.programmable_by_default;
      if (programmable.value === 'N/A (panel only)' || programmable.value === 'No') byDefault.value = 'N/A';
      if (programmable.value === 'Yes' && byDefault.value === 'N/A') byDefault.value = '';
      if (!programmable.value || programmable.value === 'Unknown') byDefault.value = '';
    });
  } else if (type === 'owner') {
    name.textContent = 'Update owner contact';
    fields.replaceChildren(fieldGrid([
      selectField('owner_status', 'Contact status', options.ownerOptions),
      field('owner_role', 'Role'),
      field('owner_name', 'Name'),
      field('owner_phone', 'Business phone', 'tel'),
      field('owner_email', 'Business email', 'email', { wide: true }),
      notesField('owner_notes', 'Where you got the contact or next step'),
    ], data));
  } else if (type === 'visit') {
    name.textContent = 'Record shop visit';
    data.visited_on ||= today();
    fields.replaceChildren(fieldGrid([
      field('visited_on', 'Visit date', 'date'),
      notesField('visit_notes', 'Visit notes'),
    ], data));
  } else if (type === 'component') {
    data.category ||= $('#component-category').value;
    name.textContent = record ? 'Edit component details' : 'Add component';
    fields.replaceChildren(fieldGrid([
      field('name', 'Component name', 'text', { required: true, wide: true }),
      { ...selectField('category', 'Category', options.componentCategories, 'Choose category'), required: true },
      field('quantity', 'Quantity or pack size'),
      notesField('description', 'Description or specifications'),
      notesField('vendor_leads', 'Vendor leads'),
      numberField('budget_min_rwf', 'Planned minimum (RWF)', 0),
      numberField('budget_max_rwf', 'Planned maximum (RWF)', 0),
      field('budget_basis', 'What the plan’s budget covers', 'text', { wide: true }),
    ], data));
  } else if (type === 'component-check') {
    data.checked_on ||= today();
    name.textContent = (record ? 'Edit check · ' : 'Vendor check · ') + parent.name;
    fields.replaceChildren(fieldGrid([
      field('vendor', 'Shop or vendor', 'text', { required: true, wide: true }),
      field('vendor_phone', 'Vendor phone', 'tel'),
      field('vendor_location', 'Kigali location or landmark'),
      { ...selectField('availability', 'Availability', options.componentAvailability, 'Choose availability'), required: true },
      field('checked_on', 'Check date', 'date', { required: true }),
      numberField('amount_rwf', 'Quoted price (RWF)', 0),
      selectField('price_basis', 'Quote type', options.priceBases, 'Choose if a price was quoted'),
      notesField('notes', 'Comments or product details'),
    ], data));
  } else {
    name.textContent = record ? 'Edit shop' : 'Add shop';
    fields.replaceChildren(fieldGrid([
      field('name', 'Shop / branch', 'text', { required: true, wide: true }),
      field('location', 'Address or nearby landmark', 'text', { wide: true }),
      field('phone', 'Shop phone', 'tel'), field('email', 'Business email', 'email'),
      notesField('other_phone', 'WhatsApp / other line'),
      linkField('map_url', 'Map URL'),
      notesField('offering', 'Panel offering'), notesField('questions', 'What to confirm'),
    ], data), group('Public contact and sources', [
      notesField('public_contact', 'Named public contact'),
      field('public_contact_phone', 'Public contact phone'),
      linkField('shop_url', 'Shop source URL'), linkField('contact_url', 'Contact source URL'),
      linkField('offering_url', 'Other source URL'),
    ], data));
  }
  dialog.showModal();
}

const numericInputs = new Set(['watts', 'max_watts', 'price_rwf', 'budget_min_rwf', 'budget_max_rwf', 'amount_rwf']);
const editorCollections = {
  model: ['models', 'models', 'Panel check saved.'],
  component: ['components', 'components', 'Component saved.'],
  'component-check': ['component-checks', 'componentChecks', 'Vendor check saved.'],
  owner: ['shops', 'shops', 'Owner contact saved.'],
};
form.addEventListener('submit', async event => {
  event.preventDefault();
  const { type, record, parent } = state.editor;
  const [endpoint, collection, message] = editorCollections[type] || ['shops', 'shops', 'Shop saved.'];
  const payload = Object.fromEntries([...new FormData(form)].map(([name, value]) => [
    name, numericInputs.has(name) && value !== '' ? Number(value) : value,
  ]));
  if (type === 'model') payload.shop_id = parent.id;
  if (type === 'component-check') payload.component_id = parent.id;
  if (record) payload.version = record.version;
  const button = $('#save');
  const error = $('#editor-error');
  button.disabled = true;
  error.hidden = true;
  try {
    const saved = await api('/' + endpoint + (record ? '/' + record.id : ''), {
      method: record ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const index = state[collection].findIndex(item => item.id === saved.id);
    if (index >= 0) state[collection][index] = saved;
    else state[collection].push(saved);
    dialog.close();
    if (collection === 'shops' && !record) selectShop(saved.id);
    else render();
    flash(message);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
  if (!$('#save').disabled) dialog.close();
}));
dialog.addEventListener('cancel', event => { if ($('#save').disabled) event.preventDefault(); });
$('#add-shop').addEventListener('click', () => openEditor('shop', null));
$('#add-component').addEventListener('click', () => openEditor('component', null));
$('#search').addEventListener('input', renderDirectory);
$('#visit-filter').addEventListener('change', renderDirectory);
$('#component-search').addEventListener('input', () => { if (state.options.componentCategories) renderComponents(); });
$('#component-category').addEventListener('change', () => { if (state.options.componentCategories) renderComponents(); });
for (const view of ['components', 'panels']) {
  $('#' + view + '-tab').addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectView(view);
  });
}
window.addEventListener('popstate', () => {
  state.view = location.hash === '#components' ? 'components' : 'panels';
  if (state.view === 'panels') {
    state.shopId = hashShop();
    state.stock = '';
  }
  render();
});

async function load() {
  render();
  try {
    Object.assign(state, await api('/directory'));
    state.shopId = hashShop() || (!media.matches ? state.shops[0]?.id : null);
    const category = $('#component-category');
    const current = category.value;
    category.options.length = 1;
    for (const name of state.options.componentCategories || []) category.add(new Option(name, name));
    category.value = current;
    $('#add-shop').disabled = false;
    $('#add-component').disabled = !state.options.componentCategories;
    render();
  } catch (error) {
    const retry = () => load();
    shopList.replaceChildren(el('div', 'panel-message', el('p', '', error.message), action('Retry', retry)));
    workspace.replaceChildren(el('p', 'panel-message muted', error.message));
    componentList.replaceChildren(el('div', 'panel-message', el('p', '', error.message), action('Retry', retry)));
  }
}
load();
