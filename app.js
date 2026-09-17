(() => {
  const data = window.FLOWCHART_DATA;
  if (!data?.slides?.length) return;

  const viewport = document.querySelector('#viewport');
  const canvas = document.querySelector('#mind-canvas');
  const panelLayer = document.querySelector('#panel-layer');
  const nodeLayer = document.querySelector('#node-layer');
  const svg = document.querySelector('#branch-layer');
  const mobileMap = document.querySelector('#mobile-map');
  const search = document.querySelector('#search');
  const searchStatus = document.querySelector('#search-status');
  const zoomLabel = document.querySelector('#zoom-label');
  const hint = document.querySelector('#gesture-hint');
  const dialog = document.querySelector('#detail-dialog');
  const W = 8200;
  const H = 6100;
  const HUB = { x: 4100, y: 5420 };
  const PANEL_W = 1850;
  const PANEL_H = 2350;
  const NODE_W = 510;
  const NODE_H = 220;
  const NS = 'http://www.w3.org/2000/svg';
  const panelSlots = [
    { x: 140, y: 240 }, { x: 2170, y: 240 }, { x: 4200, y: 240 }, { x: 6230, y: 240 },
    { x: 140, y: 2740 }, { x: 2170, y: 2740 }, { x: 4200, y: 2740 }, { x: 6230, y: 2740 },
  ];
  const desktopNodes = [];
  const mobileNodes = [];
  const nodePositions = new Map();
  const rootPositions = new Map();
  let scale = .14;
  let tx = 20;
  let ty = 20;
  let dragging = false;
  let pointer = { x: 0, y: 0 };
  let matches = [];
  let matchIndex = -1;
  let activeSlide = 1;

  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sectionFor = (number) => data.sections.find((section) => number >= section.start && number <= section.end);
  const searchable = (slide) => slide.lines.join('\n').toLowerCase();

  function excerpt(slide) {
    const value = slide.lines.slice(1).filter((line) => line.trim() && line.trim() !== '---').join(' ').replace(/\s+/g, ' ').trim();
    return value || 'Topic divider from the supplied presentation.';
  }

  function bodyMarkup(slide) {
    const lines = slide.lines.slice(1);
    const chunks = [];
    let paragraph = [];
    const flush = () => {
      if (!paragraph.length) return;
      const text = paragraph.join('\n').trim();
      if (text) {
        const heading = paragraph.length === 1 && text.length < 95 && /[:?]$/.test(text);
        chunks.push(`<p${heading ? ' class="subheading"' : ''}>${esc(text)}</p>`);
      }
      paragraph = [];
    };
    for (const line of lines) {
      if (line.trim() === '---') { flush(); chunks.push('<hr>'); }
      else if (!line.trim()) flush();
      else paragraph.push(line.trimEnd());
    }
    flush();
    return chunks.join('') || '<p>This slide is a section divider in the supplied presentation.</p>';
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function curve(a, b, verticalBias = .5) {
    const dy = b.y - a.y;
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy * verticalBias}, ${b.x} ${b.y - dy * verticalBias}, ${b.x} ${b.y}`;
  }

  function nodeCurve(a, b) {
    const sameRow = Math.abs(a.y - b.y) < 40;
    if (sameRow) {
      const right = b.x > a.x;
      const p1 = { x: right ? a.x + NODE_W : a.x, y: a.y + NODE_H / 2 };
      const p2 = { x: right ? b.x : b.x + NODE_W, y: b.y + NODE_H / 2 };
      const bend = Math.abs(p2.x - p1.x) * .44;
      return `M ${p1.x} ${p1.y} C ${right ? p1.x + bend : p1.x - bend} ${p1.y}, ${right ? p2.x - bend : p2.x + bend} ${p2.y}, ${p2.x} ${p2.y}`;
    }
    const p1 = { x: a.x + NODE_W / 2, y: a.y };
    const p2 = { x: b.x + NODE_W / 2, y: b.y + NODE_H };
    return curve(p1, p2, .48);
  }

  function addPath(d, accent, kind) {
    svg.append(svgEl('path', { class: `${kind}-halo`, d, style: `--accent:${accent}` }));
    const attrs = { class: kind, d };
    if (kind === 'twig') attrs['marker-end'] = 'url(#twig-arrow)';
    svg.append(svgEl('path', attrs));
  }

  function buildDesktop() {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = svgEl('defs', {});
    const marker = svgEl('marker', { id: 'twig-arrow', viewBox: '0 0 16 16', refX: '13', refY: '8', markerWidth: '16', markerHeight: '16', orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svgEl('path', { d: 'M 0 0 L 16 8 L 0 16 z', fill: '#504d42' }));
    defs.append(marker);
    svg.append(defs);

    data.sections.forEach((section, index) => {
      const slot = panelSlots[index];
      const slides = data.slides.filter((slide) => slide.number >= section.start && slide.number <= section.end);
      const panel = document.createElement('div');
      panel.className = 'mind-panel';
      panel.id = `desktop-${section.id}`;
      panel.dataset.range = `SLIDES ${section.start}–${section.end}`;
      panel.style.cssText = `left:${slot.x}px;top:${slot.y}px;--accent:${section.color}`;
      panelLayer.append(panel);

      const root = document.createElement('div');
      root.className = 'section-root';
      root.style.cssText = `left:${slot.x + (PANEL_W - 760) / 2}px;top:${slot.y + PANEL_H - 190}px;--accent:${section.color}`;
      root.textContent = section.label;
      nodeLayer.append(root);
      const rootPosition = { x: slot.x + PANEL_W / 2, y: slot.y + PANEL_H - 120 };
      rootPositions.set(section.id, rootPosition);

      const gapX = 45;
      const gapY = 42;
      const gridWidth = NODE_W * 3 + gapX * 2;
      const gridLeft = slot.x + (PANEL_W - gridWidth) / 2;
      const gridBottom = slot.y + PANEL_H - 390;
      const sectionPositions = [];

      slides.forEach((slide, sequence) => {
        const rowFromBottom = Math.floor(sequence / 3);
        const countInRow = Math.min(3, slides.length - rowFromBottom * 3);
        const indexInRow = sequence % 3;
        const col = rowFromBottom % 2 === 0 ? indexInRow : countInRow - 1 - indexInRow;
        const x = gridLeft + col * (NODE_W + gapX);
        const y = gridBottom - (rowFromBottom + 1) * NODE_H - rowFromBottom * gapY;
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'mind-node';
        node.dataset.slide = slide.number;
        node.dataset.search = searchable(slide);
        node.style.cssText = `left:${x}px;top:${y}px;--accent:${section.color};--tilt:${((slide.number % 5) - 2) * .32}deg`;
        node.innerHTML = `<span class="compact-head"><span class="compact-number">${slide.number}</span><h3>${esc(slide.title)}</h3></span><p>${esc(excerpt(slide))}</p>`;
        node.addEventListener('click', () => openDetails(slide.number));
        nodeLayer.append(node);
        desktopNodes.push(node);
        const pos = { x, y };
        nodePositions.set(slide.number, pos);
        sectionPositions.push(pos);
      });

      const branchEnd = { x: rootPosition.x, y: rootPosition.y + 70 };
      addPath(curve(HUB, branchEnd, index < 4 ? .55 : .35), section.color, 'main-branch');
      if (sectionPositions.length) {
        const first = sectionPositions[0];
        addPath(curve({ x: rootPosition.x, y: rootPosition.y - 70 }, { x: first.x + NODE_W / 2, y: first.y + NODE_H }, .5), section.color, 'twig');
        for (let i = 0; i < sectionPositions.length - 1; i += 1) addPath(nodeCurve(sectionPositions[i], sectionPositions[i + 1]), section.color, 'twig');
      }
    });
  }

  function buildMobile() {
    const root = document.createElement('div');
    root.className = 'mobile-root';
    root.innerHTML = '<span>THE ROOT · 1872</span><strong>Indian Contract Act</strong>';
    mobileMap.append(root);

    data.sections.forEach((section, index) => {
      const wrapper = document.createElement('section');
      wrapper.className = 'mobile-section';
      wrapper.id = `mobile-${section.id}`;
      wrapper.style.setProperty('--accent', section.color);
      wrapper.innerHTML = `<header class="mobile-section-head"><p>BRANCH ${index + 1} · SLIDES ${section.start}–${section.end}</p><h2>${esc(section.label)}</h2></header><div class="mobile-chain"></div>`;
      const chain = wrapper.querySelector('.mobile-chain');
      data.slides.filter((slide) => slide.number >= section.start && slide.number <= section.end).forEach((slide) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'mobile-node';
        node.dataset.slide = slide.number;
        node.dataset.search = searchable(slide);
        node.innerHTML = `<span class="mobile-number">${slide.number}</span><h3>${esc(slide.title)}</h3><p>${esc(excerpt(slide))}</p>`;
        node.addEventListener('click', () => openDetails(slide.number));
        chain.append(node);
        mobileNodes.push(node);
      });
      mobileMap.append(wrapper);
    });
  }

  function renderNav() {
    const nav = document.querySelector('#section-nav');
    data.sections.forEach((section) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--section', section.color);
      button.textContent = `${section.start}–${section.end} · ${section.label}`;
      button.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 900px)').matches) document.querySelector(`#mobile-${section.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        else focusSection(section.id);
      });
      nav.append(button);
    });
  }

  function setTransform() {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function fitAll() {
    const pad = 34;
    scale = Math.min((viewport.clientWidth - pad * 2) / W, (viewport.clientHeight - pad * 2) / H, .55);
    tx = (viewport.clientWidth - W * scale) / 2;
    ty = (viewport.clientHeight - H * scale) / 2;
    setTransform();
  }

  function zoomAt(nextScale, originX = viewport.clientWidth / 2, originY = viewport.clientHeight / 2) {
    const bounded = Math.min(1.5, Math.max(.075, nextScale));
    const contentX = (originX - tx) / scale;
    const contentY = (originY - ty) / scale;
    tx = originX - contentX * bounded;
    ty = originY - contentY * bounded;
    scale = bounded;
    setTransform();
  }

  function focusPoint(x, y, nextScale = .38) {
    scale = nextScale;
    tx = viewport.clientWidth / 2 - x * scale;
    ty = viewport.clientHeight / 2 - y * scale;
    setTransform();
  }

  function focusSection(id) {
    const root = rootPositions.get(id);
    if (root) focusPoint(root.x, root.y - 780, .31);
  }

  function focusSlide(number) {
    desktopNodes.forEach((node) => node.classList.toggle('focused', Number(node.dataset.slide) === number));
    const pos = nodePositions.get(number);
    if (pos) focusPoint(pos.x + NODE_W / 2, pos.y + NODE_H / 2, .78);
  }

  function openDetails(number) {
    activeSlide = Math.min(data.slides.length, Math.max(1, number));
    const slide = data.slides[activeSlide - 1];
    const section = sectionFor(slide.number);
    document.querySelector('#detail-section').textContent = `${section.label} · Slide ${slide.number}`;
    document.querySelector('#detail-title').textContent = slide.title;
    document.querySelector('#detail-body').innerHTML = bodyMarkup(slide);
    document.querySelector('#detail-count').textContent = `${slide.number} / ${data.slides.length}`;
    document.querySelector('#detail-prev').disabled = slide.number === 1;
    document.querySelector('#detail-next').disabled = slide.number === data.slides.length;
    if (!dialog.open) dialog.showModal();
  }

  function searchNodes() {
    const query = search.value.trim().toLowerCase();
    matches = query ? data.slides.filter((slide) => searchable(slide).includes(query)).map((slide) => slide.number) : [];
    matchIndex = -1;
    [...desktopNodes, ...mobileNodes].forEach((node) => {
      const hit = query && node.dataset.search.includes(query);
      node.classList.toggle('match', Boolean(hit));
      node.classList.toggle('dimmed', Boolean(query) && !hit);
      node.classList.remove('focused');
    });
    searchStatus.textContent = query ? `${matches.length} matching slide${matches.length === 1 ? '' : 's'} · Enter for next` : 'All topics visible';
  }

  search.addEventListener('input', searchNodes);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !matches.length) return;
    event.preventDefault();
    matchIndex = (matchIndex + 1) % matches.length;
    const number = matches[matchIndex];
    if (window.matchMedia('(max-width: 900px)').matches) document.querySelector(`.mobile-node[data-slide="${number}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    else focusSlide(number);
    searchStatus.textContent = `Match ${matchIndex + 1} of ${matches.length} · slide ${number}`;
  });

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * Math.exp(-event.deltaY * .00125), event.clientX - rect.left, event.clientY - rect.top);
    hint.classList.add('hidden');
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.mind-node')) return;
    dragging = true;
    pointer = { x: event.clientX, y: event.clientY };
    viewport.classList.add('dragging');
    viewport.setPointerCapture(event.pointerId);
    hint.classList.add('hidden');
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx += event.clientX - pointer.x;
    ty += event.clientY - pointer.y;
    pointer = { x: event.clientX, y: event.clientY };
    setTransform();
  });
  viewport.addEventListener('pointerup', () => { dragging = false; viewport.classList.remove('dragging'); });
  viewport.addEventListener('pointercancel', () => { dragging = false; viewport.classList.remove('dragging'); });

  document.querySelector('#zoom-in').addEventListener('click', () => zoomAt(scale * 1.22));
  document.querySelector('#zoom-out').addEventListener('click', () => zoomAt(scale / 1.22));
  zoomLabel.addEventListener('click', () => zoomAt(1));
  document.querySelector('#fit').addEventListener('click', fitAll);
  document.querySelector('#center').addEventListener('click', () => focusPoint(HUB.x, HUB.y - 80, .34));
  document.querySelector('#detail-close').addEventListener('click', () => dialog.close());
  document.querySelector('#detail-prev').addEventListener('click', () => openDetails(activeSlide - 1));
  document.querySelector('#detail-next').addEventListener('click', () => openDetails(activeSlide + 1));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  window.addEventListener('resize', () => { if (!window.matchMedia('(max-width: 900px)').matches) fitAll(); });

  buildDesktop();
  buildMobile();
  renderNav();
  requestAnimationFrame(fitAll);
})();
