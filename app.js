(() => {
  const data = window.FLOWCHART_DATA;
  if (!data?.slides?.length) return;

  const viewport = document.querySelector('#viewport');
  const canvas = document.querySelector('#flow-canvas');
  const nodeLayer = document.querySelector('#node-layer');
  const svg = document.querySelector('#chain-layer');
  const search = document.querySelector('#search');
  const searchStatus = document.querySelector('#search-status');
  const zoomLabel = document.querySelector('#zoom-label');
  const hint = document.querySelector('#gesture-hint');
  const nodeWidth = 720;
  const columns = 4;
  const gapX = 210;
  const gapY = 270;
  const marginX = 180;
  const marginY = 190;
  const ns = 'http://www.w3.org/2000/svg';
  const nodes = [];
  const positions = [];
  let scale = 0.24;
  let tx = 30;
  let ty = 30;
  let dragging = false;
  let pointer = { x: 0, y: 0 };
  let matchIndex = -1;
  let matches = [];

  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function bodyMarkup(slide) {
    const lines = slide.lines.slice(1);
    const chunks = [];
    let paragraph = [];
    const flush = () => {
      if (!paragraph.length) return;
      const text = paragraph.join('\n').trim();
      if (text) {
        const looksLikeHeading = paragraph.length === 1 && text.length < 90 && /[:?]$/.test(text);
        chunks.push(`<p${looksLikeHeading ? ' class="subheading"' : ''}>${esc(text)}</p>`);
      }
      paragraph = [];
    };
    for (const line of lines) {
      if (line.trim() === '---') { flush(); chunks.push('<hr>'); }
      else if (!line.trim()) flush();
      else paragraph.push(line.trimEnd());
    }
    flush();
    return chunks.join('');
  }

  function renderNodes() {
    document.querySelector('#topic-count').textContent = data.slides.length;
    for (const slide of data.slides) {
      const section = data.sections.find((item) => slide.number >= item.start && slide.number <= item.end);
      const article = document.createElement('article');
      article.className = 'flow-node';
      article.dataset.slide = slide.number;
      article.dataset.section = section.id;
      article.dataset.search = slide.lines.join('\n').toLowerCase();
      article.style.setProperty('--accent', section.color);
      article.innerHTML = `
        <div class="node-head">
          <span class="slide-number">${slide.number}</span>
          <div><p class="section-name">${esc(section.label)}</p><h2>${esc(slide.title)}</h2></div>
        </div>
        <div class="node-body">${bodyMarkup(slide)}</div>`;
      nodeLayer.append(article);
      nodes.push(article);
    }
  }

  function layoutNodes() {
    positions.length = 0;
    const rowCount = Math.ceil(nodes.length / columns);
    let y = marginY;
    for (let row = 0; row < rowCount; row += 1) {
      const group = nodes.slice(row * columns, (row + 1) * columns);
      const rowHeight = Math.max(...group.map((node) => node.offsetHeight));
      group.forEach((node, visualCol) => {
        const sequenceOffset = Number(node.dataset.slide) - 1 - row * columns;
        const col = row % 2 === 0 ? sequenceOffset : group.length - 1 - sequenceOffset;
        const x = marginX + col * (nodeWidth + gapX);
        node.style.left = `${x}px`;
        node.style.top = `${y + (rowHeight - node.offsetHeight) / 2}px`;
        positions[Number(node.dataset.slide) - 1] = { x, y: y + (rowHeight - node.offsetHeight) / 2, w: nodeWidth, h: node.offsetHeight, row, col };
      });
      y += rowHeight + gapY;
    }
    const width = marginX * 2 + columns * nodeWidth + (columns - 1) * gapX;
    const height = y - gapY + marginY;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    nodeLayer.style.width = `${width}px`;
    nodeLayer.style.height = `${height}px`;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    drawChain();
    return { width, height };
  }

  function connection(a, b) {
    if (a.row === b.row) {
      const leftToRight = b.x > a.x;
      const x1 = leftToRight ? a.x + a.w : a.x;
      const x2 = leftToRight ? b.x : b.x + b.w;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      const bend = Math.max(60, Math.abs(x2 - x1) * .46);
      const c1 = leftToRight ? x1 + bend : x1 - bend;
      const c2 = leftToRight ? x2 - bend : x2 + bend;
      return { d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 };
    }
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    return { d: `M ${x1} ${y1} C ${x1} ${y1 + 95}, ${x2} ${y2 - 95}, ${x2} ${y2}`, labelX: x1, labelY: (y1 + y2) / 2 };
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function drawChain() {
    svg.replaceChildren();
    const defs = svgEl('defs', {});
    const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 18 18', refX: '15', refY: '9', markerWidth: '14', markerHeight: '14', orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svgEl('path', { d: 'M 0 0 L 18 9 L 0 18 z', fill: '#78e1dc' }));
    defs.append(marker);
    svg.append(defs);

    for (let i = 0; i < positions.length - 1; i += 1) {
      const link = connection(positions[i], positions[i + 1]);
      svg.append(svgEl('path', { class: 'chain-shadow', d: link.d }));
      svg.append(svgEl('path', { class: 'chain-path', d: link.d, 'marker-end': 'url(#arrow)' }));
      const circle = svgEl('circle', { class: 'chain-order', cx: link.labelX, cy: link.labelY, r: '24' });
      const text = svgEl('text', { class: 'chain-order-text', x: link.labelX, y: link.labelY });
      text.textContent = i + 2;
      svg.append(circle, text);
    }
  }

  function setTransform() {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function fitAll() {
    const width = parseFloat(canvas.style.width);
    const height = parseFloat(canvas.style.height);
    const pad = 30;
    scale = Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height, .72);
    tx = (viewport.clientWidth - width * scale) / 2;
    ty = (viewport.clientHeight - height * scale) / 2;
    setTransform();
  }

  function zoomAt(nextScale, originX = viewport.clientWidth / 2, originY = viewport.clientHeight / 2) {
    const bounded = Math.min(1.45, Math.max(.08, nextScale));
    const contentX = (originX - tx) / scale;
    const contentY = (originY - ty) / scale;
    tx = originX - contentX * bounded;
    ty = originY - contentY * bounded;
    scale = bounded;
    setTransform();
  }

  function focusNode(index, preferredScale = Math.max(scale, .72)) {
    const p = positions[index];
    if (!p) return;
    nodes.forEach((node) => node.classList.remove('focused'));
    nodes[index].classList.add('focused');
    scale = Math.min(preferredScale, 1.1);
    tx = viewport.clientWidth / 2 - (p.x + p.w / 2) * scale;
    ty = viewport.clientHeight / 2 - (p.y + p.h / 2) * scale;
    setTransform();
  }

  function renderSectionNav() {
    const nav = document.querySelector('#section-nav');
    data.sections.forEach((section) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--section', section.color);
      button.textContent = `${section.start}–${section.end} · ${section.label}`;
      button.addEventListener('click', () => focusNode(section.start - 1, .78));
      nav.append(button);
    });
  }

  function searchNodes() {
    const query = search.value.trim().toLowerCase();
    matchIndex = -1;
    matches = [];
    nodes.forEach((node, index) => {
      const hit = query && node.dataset.search.includes(query);
      node.classList.toggle('match', Boolean(hit));
      node.classList.toggle('dimmed', Boolean(query) && !hit);
      node.classList.remove('focused');
      if (hit) matches.push(index);
    });
    searchStatus.textContent = query ? `${matches.length} matching slide${matches.length === 1 ? '' : 's'} · Enter for next` : 'All nodes visible';
  }

  search.addEventListener('input', searchNodes);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !matches.length) return;
    event.preventDefault();
    matchIndex = (matchIndex + 1) % matches.length;
    focusNode(matches[matchIndex], .82);
    searchStatus.textContent = `Match ${matchIndex + 1} of ${matches.length} · slide ${matches[matchIndex] + 1}`;
  });

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * Math.exp(-event.deltaY * .0012), event.clientX - rect.left, event.clientY - rect.top);
    hint.classList.add('hidden');
  }, { passive: false });

  viewport.addEventListener('pointerdown', (event) => {
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
  document.querySelector('#start').addEventListener('click', () => focusNode(0, .82));
  window.addEventListener('resize', () => { layoutNodes(); fitAll(); });

  renderNodes();
  renderSectionNav();
  requestAnimationFrame(() => { layoutNodes(); fitAll(); });
})();
