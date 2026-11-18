/* Prueba 3D · interruptores, carteles de golpe y contador de cuadros. Igual en las dos versiones. */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});

  const store = {
    get(k, d) { try { const v = localStorage.getItem('p3.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('p3.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: no pasa nada */ } },
  };

  P3.makeUI = function (root, opts) {
    const reduce = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = new URLSearchParams(g.location.search);
    const state = {
      follow: q.has('camara') ? q.get('camara') !== 'fija' : store.get('follow', true),
      scale: q.has('escala') ? Number(q.get('escala')) : store.get('scale', 1),
      reduce: q.has('reducir') ? q.get('reducir') === '1' : store.get('reduce', reduce),
      close: false,
      paused: false,
      fps: q.has('fps') ? q.get('fps') === '1' : store.get('fps', true),
      open: store.get('open', true),
    };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const listeners = [];
    const changed = (key) => { listeners.forEach((fn) => fn(key, state)); };

    const bar = el('div', 'p3-bar');
    const head = el('div', 'p3-head');
    const title = el('div', 'p3-title');
    title.innerHTML = '<b>' + opts.version + '</b><span>' + opts.name + '</span>';
    head.appendChild(title);
    const fps = el('div', 'p3-fps', '— fps');
    fps.setAttribute('aria-live', 'off');
    head.appendChild(fps);
    const toggle = el('button', 'p3-more');
    toggle.type = 'button';
    toggle.id = 'p3-ajustes';
    toggle.setAttribute('aria-controls', 'p3-panel');
    head.appendChild(toggle);
    bar.appendChild(head);
    const panel = el('div', 'p3-panel');
    panel.id = 'p3-panel';
    bar.appendChild(panel);

    function seg(label, id, options, get, set) {
      const row = el('div', 'p3-row');
      row.appendChild(el('span', 'p3-label', label));
      const box = el('div', 'p3-seg');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', label);
      const buttons = options.map((o, i) => {
        const b = el('button', '', o.label);
        b.type = 'button';
        b.id = 'p3-' + id + '-' + i;
        b.addEventListener('click', () => { set(o.value); paint(); changed(id); });
        box.appendChild(b);
        return b;
      });
      const paint = () => buttons.forEach((b, i) => { const on = get() === options[i].value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      paint();
      row.appendChild(box);
      panel.appendChild(row);
      return paint;
    }
    const paintCam = seg('Cámara', 'camara', [{ label: 'Fija', value: false }, { label: 'Acompaña', value: true }],
      () => state.follow && !state.reduce, (v) => { state.follow = v; if (v) state.reduce = false; store.set('follow', v); store.set('reduce', state.reduce); paintRed(); });
    seg('Escala', 'escala', P3.SCALES.map((s, i) => ({ label: s.label, value: i })), () => state.scale, (v) => { state.scale = v; store.set('scale', v); });
    const paintRed = seg('Reducir movimiento', 'reducir', [{ label: 'No', value: false }, { label: 'Sí', value: true }],
      () => state.reduce, (v) => { state.reduce = v; store.set('reduce', v); paintCam(); });
    const row = el('div', 'p3-row p3-actions');
    const mk = (id, text, fn) => { const b = el('button', 'p3-btn', text); b.type = 'button'; b.id = 'p3-' + id; b.addEventListener('click', () => fn(b)); row.appendChild(b); return b; };
    const bClose = mk('cerca', 'Ver de cerca', (b) => { state.close = !state.close; b.classList.toggle('on', state.close); b.setAttribute('aria-pressed', state.close); changed('close'); });
    mk('pausa', 'Pausa', (b) => { state.paused = !state.paused; b.textContent = state.paused ? 'Seguir' : 'Pausa'; b.classList.toggle('on', state.paused); changed('paused'); });
    if (opts.other) {
      const a = el('a', 'p3-btn p3-link', opts.other.label);
      a.href = opts.other.href;
      a.id = 'p3-otra';
      row.appendChild(a);
    }
    panel.appendChild(row);
    const note = el('p', 'p3-note', opts.note || '');
    panel.appendChild(note);

    const setOpen = (v) => { state.open = v; store.set('open', v); bar.classList.toggle('closed', !v); toggle.textContent = v ? 'Ocultar' : 'Ajustes'; toggle.setAttribute('aria-expanded', v ? 'true' : 'false'); };
    toggle.addEventListener('click', () => setOpen(!state.open));
    setOpen(q.has('panel') ? q.get('panel') === '1' : state.open);
    root.appendChild(bar);

    /* carteles de golpe: aparecen 0,85 s sobre quien pega */
    const tags = el('div', 'p3-tags');
    root.appendChild(tags);
    function label(text, x, y, strong) {
      if (!text) return;
      const t = el('div', 'p3-tag' + (strong ? ' fuerte' : ''), text);
      t.style.left = x + 'px';
      t.style.top = y + 'px';
      tags.appendChild(t);
      setTimeout(() => t.remove(), 900);
    }

    /* contador: cuadros por segundo y milisegundos de trabajo por cuadro */
    const perf = { frames: 0, work: 0, last: performance.now(), fps: 0, ms: 0, samples: [], long: 0 };
    function tick(workMs) {
      perf.frames++;
      perf.work += workMs;
      if (perf.samples.length < 3000) perf.samples.push(workMs);
      const now = performance.now();
      if (now - perf.last >= 500) {
        perf.fps = (perf.frames * 1000) / (now - perf.last);
        perf.ms = perf.work / perf.frames;
        perf.frames = 0; perf.work = 0; perf.last = now;
        if (state.fps) fps.textContent = perf.fps.toFixed(0) + ' fps · ' + perf.ms.toFixed(1).replace('.', ',') + ' ms';
      }
    }
    return { state, label, tick, perf, onChange: (fn) => listeners.push(fn), bar, setNote: (t) => { note.textContent = t; }, closeBtn: bClose };
  };
})(window);
