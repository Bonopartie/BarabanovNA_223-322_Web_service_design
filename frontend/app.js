const $ = (id) => document.getElementById(id);
const out = $("out");
const LIST_NAMES = { favorite: "Избранное", watched: "Просмотрено" };

let view = null;        // "search" | "favorite" | "watched" | "stats"
let lastSearch = null;  // параметры последнего поиска, чтобы обновлять выдачу

// ---------- утилиты ----------

async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" }, ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(Array.isArray(d) ? d.map((x) => x.msg).join("; ") : d || `Ошибка ${res.status}`);
  }
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(text, isErr = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = "toast"), 2600);
}

function setHead(title, meta = "") {
  $("title").textContent = title;
  $("meta").textContent = meta;
}

function setActiveTab() {
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.list === view || (b.hasAttribute("data-stats") && view === "stats"));
  });
}

// постер: настоящая картинка от OMDb или сгенерированная обложка
function poster(m) {
  let h = 0;
  for (const ch of m.imdbID) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const bg = `linear-gradient(160deg, hsl(${h} 55% 38%), hsl(${(h + 50) % 360} 60% 14%))`;
  const img = m.Poster && m.Poster !== "N/A"
    ? `<img src="${esc(m.Poster)}" alt="" onerror="this.remove()">` : "";
  return `<div class="poster" style="background:${bg}" data-open="${esc(m.imdbID)}">
    ${img}
    ${m.imdbRating && m.imdbRating !== "N/A" ? `<span class="rating">★ ${(+m.imdbRating).toFixed(1)}</span>` : ""}
    <span class="kind">${m.Type === "series" ? "сериал" : "фильм"}</span>
    <div class="ptitle">${esc(m.TitleRu || m.Title)}<span class="pyear">${esc(m.Year)}</span></div>
  </div>`;
}

// приводим запись из БД к формату OMDb, чтобы рисовать одинаково
function fromDb(r) {
  return {
    imdbID: r.imdb_id, Title: r.title, TitleRu: r.title_ru, Year: r.year, Type: r.type,
    Poster: r.poster, imdbRating: r.imdb_rating, Genre: r.genre,
  };
}

function ratingOptions(selected) {
  let o = `<option value="">моя оценка</option>`;
  for (let i = 10; i >= 1; i--) o += `<option value="${i}" ${+selected === i ? "selected" : ""}>${i} / 10</option>`;
  return o;
}

// ---------- Кнопка 2: поиск через Web-сервис ----------

async function doSearch(params) {
  params.page = params.page || 1;
  lastSearch = params;
  view = "search"; setActiveTab();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const data = await api("/search?" + qs);
  const shown = Math.min(data.total, params.page * 10);
  setHead(`Поиск: «${params.q}»`,
    `найдено ${data.total}, показано ${data.total ? (params.page - 1) * 10 + 1 : 0}–${shown} · источник: ${data.source === "omdb" ? "OMDb API" : "Web-сервис (эмулятор OMDb)"}`);
  out.className = "grid";
  if (!data.results.length) {
    out.innerHTML = `<div class="empty">${esc(data.error)}</div>`;
    return;
  }
  out.innerHTML = data.results.map((m) => {
    const fav = m.lists.favorite, wat = m.lists.watched;
    return `<div class="card">
      ${poster(m)}
      <div class="body">
        <h3>${esc(m.TitleRu || m.Title)}</h3>
        ${m.TitleRu ? `<div class="orig">${esc(m.Title)}</div>` : ""}
        <div class="actions">
          <button class="${fav ? "on-fav" : ""}" data-toggle="favorite" data-id="${m.imdbID}" data-entry="${fav || ""}">♥ ${fav ? "В избранном" : "Избранное"}</button>
          <button class="${wat ? "on-watched" : ""}" data-toggle="watched" data-id="${m.imdbID}" data-entry="${wat || ""}">✓ ${wat ? "Просмотрен" : "Смотрел"}</button>
        </div>
      </div>
    </div>`;
  }).join("") + `<div class="pager">
    ${params.page > 1 ? `<button data-page="${params.page - 1}">← Назад</button>` : ""}
    ${shown < data.total ? `<button data-page="${params.page + 1}">Ещё результаты →</button>` : ""}
  </div>`;
}

// ---------- Кнопка 1: списки из БД ----------

async function showList(type) {
  view = type; setActiveTab();
  const rows = await api(`/list?list_type=${type}`);
  setHead(LIST_NAMES[type], `${rows.length} записей · данные из PostgreSQL`);
  out.className = "grid";
  if (!rows.length) {
    out.innerHTML = `<div class="empty">Список пуст. Найди фильм и добавь его сюда.</div>`;
    return;
  }
  out.innerHTML = rows.map((r) => {
    const m = fromDb(r);
    return `<div class="card">
      ${poster(m)}
      <div class="body">
        <h3>${esc(r.title_ru || r.title)}</h3>
        <div class="genre">${esc(r.genre || "")}</div>
        ${type === "watched" ? `<div class="myrow"><select data-rate="${r.id}">${ratingOptions(r.my_rating)}</select></div>` : ""}
        <div class="note" data-note="${r.id}" data-text="${esc(r.note || "")}" title="Нажми, чтобы изменить заметку">${r.note ? "«" + esc(r.note) + "»" : "+ добавить заметку"}</div>
        <div class="small">добавлено ${r.added_at}</div>
        <div class="actions">
          ${type === "favorite" ? `<button data-move="${r.imdb_id}">✓ Посмотрел</button>` : ""}
          <button class="danger" data-del="${r.id}">Удалить</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ---------- статистика из БД ----------

async function showStats() {
  view = "stats"; setActiveTab();
  const s = await api("/stats");
  setHead("Статистика", "агрегаты считаются SQL-запросами в БД");
  out.className = "grid single";
  const maxG = Math.max(1, ...s.top_genres.map((g) => g.cnt));
  const hours = Math.floor(s.minutes / 60), mins = s.minutes % 60;
  out.innerHTML = `
    <div class="stats">
      <div class="tile"><div class="v">${s.favorites}</div><div class="l">в избранном</div></div>
      <div class="tile"><div class="v">${s.watched}</div><div class="l">просмотрено</div></div>
      <div class="tile"><div class="v">${s.my_avg ?? "–"}</div><div class="l">моя средняя оценка</div></div>
      <div class="tile"><div class="v">${hours} ч ${mins} м</div><div class="l">в кино (без сериалов)</div></div>
    </div>
    <div class="cols">
      <div class="box"><h3>Любимые жанры</h3>
        ${s.top_genres.map((g) => `<div class="bar-row"><span>${esc(g.genre)}</span>
          <div class="bar" style="width:${(g.cnt / maxG) * 100}%"></div><span>${g.cnt}</span></div>`).join("") || '<div class="small">нет данных</div>'}
      </div>
      <div class="box"><h3>Моя оценка против IMDb</h3>
        <table><tr><th>Фильм</th><th>Я</th><th>IMDb</th></tr>
        ${s.vs_imdb.map((r) => `<tr><td>${esc(r.title)}</td><td>${r.my_rating}</td><td>${r.imdb_rating}</td></tr>`).join("")}
        </table>
      </div>
      <div class="box"><h3>Последние запросы к Web-сервису</h3>
        <table><tr><th>Запрос</th><th>Найдено</th><th>Когда</th></tr>
        ${s.recent_searches.map((r) => `<tr><td>${esc(r.query)}</td><td>${r.results}</td><td>${r.at}</td></tr>`).join("")
          || '<tr><td colspan="3" class="small">поиска ещё не было</td></tr>'}
        </table>
      </div>
    </div>`;
}

// ---------- карточка фильма ----------

async function openMovie(id) {
  const m = await api(`/movie/${id}`);
  const fav = m.lists.favorite, wat = m.lists.watched;
  $("modalBody").innerHTML = `<div class="detail">
    ${poster(m)}
    <div class="info">
      <h2>${esc(m.TitleRu || m.Title)}</h2>
      ${m.TitleRu ? `<div class="orig">${esc(m.Title)}</div>` : ""}
      <p>${esc(m.Plot)}</p>
      <dl>
        <dt>Год</dt><dd>${esc(m.Year)}</dd>
        <dt>Жанр</dt><dd>${esc(m.Genre)}</dd>
        <dt>Режиссёр</dt><dd>${esc(m.Director)}</dd>
        <dt>В ролях</dt><dd>${esc(m.Actors)}</dd>
        <dt>Страна</dt><dd>${esc(m.Country)}</dd>
        <dt>Длительность</dt><dd>${esc(m.Runtime)}</dd>
        <dt>Рейтинг IMDb</dt><dd>★ ${esc(m.imdbRating)}</dd>
      </dl>
      <div class="actions">
        <button class="${fav ? "on-fav" : ""}" data-toggle="favorite" data-id="${m.imdbID}" data-entry="${fav || ""}">♥ ${fav ? "Убрать из избранного" : "В избранное"}</button>
        <button class="${wat ? "on-watched" : ""}" data-toggle="watched" data-id="${m.imdbID}" data-entry="${wat || ""}">✓ ${wat ? "Убрать из просмотренного" : "Посмотрел"}</button>
      </div>
      <div class="src">${m.imdbID} · источник: ${m.Source === "omdb" ? "OMDb API" : "Web-сервис (эмулятор OMDb)"}</div>
    </div>
  </div>`;
  $("modal").showModal();
}

// ---------- действия ----------

async function refresh() {
  await loadCounts();
  if (view === "search" && lastSearch) await doSearch(lastSearch);
  else if (view === "favorite" || view === "watched") await showList(view);
  else if (view === "stats") await showStats();
}

async function toggle(btn) {
  const { toggle: type, id, entry } = btn.dataset;
  if (entry) {
    await api(`/list/${entry}`, { method: "DELETE" });
    toast(`Убрано из списка «${LIST_NAMES[type]}»`);
  } else {
    const r = await api("/list", { method: "POST", body: JSON.stringify({ imdb_id: id, list_type: type }) });
    toast(`«${r.title_ru || r.title}» сохранён в «${LIST_NAMES[type]}»`);
  }
  if ($("modal").open) await openMovie(id);
  await refresh();
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.closest("[data-open]")) return await openMovie(t.closest("[data-open]").dataset.open);
    if (t.matches("[data-toggle]")) { t.disabled = true; return await toggle(t); }
    if (t.matches("[data-page]")) {
      await doSearch({ ...lastSearch, page: +t.dataset.page });
      return window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (t.matches("[data-del]")) {
      await api(`/list/${t.dataset.del}`, { method: "DELETE" });
      toast("Запись удалена из БД");
      return await refresh();
    }
    if (t.matches("[data-move]")) {
      await api("/list", { method: "POST", body: JSON.stringify({ imdb_id: t.dataset.move, list_type: "watched" }) });
      toast("Добавлено в «Просмотрено». Поставь оценку!");
      return await refresh();
    }
    if (t.matches("[data-note]")) {
      const note = prompt("Заметка к фильму:", t.dataset.text);
      if (note === null) return;
      await api(`/list/${t.dataset.note}`, {
        method: "PATCH", body: JSON.stringify({ note: note.trim() || null }),
      });
      toast("Заметка сохранена");
      return await refresh();
    }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (!t.matches("[data-rate]")) return;
  try {
    await api(`/list/${t.dataset.rate}`, {
      method: "PATCH", body: JSON.stringify({ my_rating: t.value ? +t.value : null }),
    });
    toast(t.value ? `Оценка ${t.value}/10 сохранена` : "Оценка снята");
  } catch (err) { toast(err.message, true); }
});

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await doSearch({ q: $("q").value.trim(), type: $("type").value, year: $("year").value.trim(), page: 1 });
  } catch (err) { toast(err.message, true); }
});

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", async () => {
  try {
    if (b.dataset.list) await showList(b.dataset.list);
    else await showStats();
  } catch (err) { toast(err.message, true); }
}));

$("closeModal").addEventListener("click", () => $("modal").close());
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").close(); });

async function loadCounts() {
  const rows = await api("/list");
  $("cntFav").textContent = rows.filter((r) => r.list_type === "favorite").length;
  $("cntWatched").textContent = rows.filter((r) => r.list_type === "watched").length;
}

async function init() {
  try {
    const h = await api("/health");
    $("stDb").textContent = "БД подключена"; $("stDb").className = "pill ok";
    const ws = h.web_service;
    if (ws.status === "ok") {
      $("stWs").textContent = ws.mode === "omdb-proxy" ? "Web-сервис: OMDb API" : "Web-сервис: эмулятор OMDb";
      $("stWs").className = "pill ok";
    } else {
      $("stWs").textContent = "Web-сервис недоступен"; $("stWs").className = "pill bad";
    }
    await loadCounts();
  } catch {
    $("stDb").textContent = "API недоступен"; $("stDb").className = "pill bad";
  }
}

init();
