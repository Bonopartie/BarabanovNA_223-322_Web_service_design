"""
Web-сервис «Каталог фильмов» (вариант 6).

Отдаёт данные в формате OMDb API (https://www.omdbapi.com):
  GET /?s=<название>[&type=movie|series][&y=<год>][&page=N]  поиск
  GET /?i=<imdbID>  или  GET /?t=<название>                   карточка фильма

Режимы работы:
  OMDB_API_KEY задан  -> запросы проксируются в настоящий OMDb API,
                         при недоступности OMDb используется локальная база;
  OMDB_API_KEY пустой -> работает как локальный эмулятор OMDb.
В каждом ответе поле "Source" показывает, откуда пришли данные.
"""
import os
from typing import Optional

import httpx
from fastapi import FastAPI

from films import FILMS

OMDB_URL = "https://www.omdbapi.com/"
OMDB_API_KEY = os.getenv("OMDB_API_KEY", "").strip()
PAGE_SIZE = 10

app = FastAPI(title="Movie Web-service (OMDb compatible)")


def to_full(f: tuple) -> dict:
    (imdb_id, title, title_ru, year, rated, runtime, genre,
     director, actors, country, rating, kind, plot) = f
    return {
        "Title": title, "TitleRu": title_ru, "Year": year, "Rated": rated,
        "Runtime": f"{runtime} min", "Genre": genre, "Director": director,
        "Actors": actors, "Plot": plot, "Country": country, "Poster": "N/A",
        "Ratings": [{"Source": "Internet Movie Database", "Value": f"{rating}/10"}],
        "imdbRating": rating, "imdbID": imdb_id, "Type": kind, "Response": "True",
    }


CATALOG = [to_full(f) for f in FILMS]
BY_ID = {m["imdbID"]: m for m in CATALOG}


def not_found(msg: str = "Movie not found!") -> dict:
    return {"Response": "False", "Error": msg}


# ---------- локальный эмулятор ----------

def local_search(s: str, type_: Optional[str], y: Optional[str], page: int) -> dict:
    q = s.strip().lower()
    if len(q) < 2:
        return not_found("Too many results.")
    hits = [m for m in CATALOG
            if (q in m["Title"].lower() or q in m["TitleRu"].lower())
            and (not type_ or m["Type"] == type_)
            and (not y or m["Year"].startswith(y))]
    if not hits:
        return not_found()
    hits.sort(key=lambda m: -float(m["imdbRating"]))
    chunk = hits[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return {
        "Search": [{k: m[k] for k in ("Title", "TitleRu", "Year", "imdbID", "Type", "Poster", "imdbRating")}
                   for m in chunk],
        "totalResults": str(len(hits)),
        "Response": "True",
    }


def local_details(i: Optional[str], t: Optional[str]) -> dict:
    if i:
        if not i.startswith("tt"):
            return not_found("Incorrect IMDb ID.")
        return BY_ID.get(i, not_found("Error getting data."))
    q = (t or "").strip().lower()
    for m in CATALOG:
        if q in (m["Title"].lower(), m["TitleRu"].lower()):
            return m
    return not_found()


# ---------- прокси к настоящему OMDb ----------

def omdb(params: dict) -> Optional[dict]:
    """None, если OMDb недоступен или ключ неверный: тогда работаем локально."""
    if not OMDB_API_KEY:
        return None
    try:
        r = httpx.get(OMDB_URL, params={**params, "apikey": OMDB_API_KEY}, timeout=5)
        data = r.json()
        if r.status_code != 200 or data.get("Error") in ("Invalid API key!", "Request limit reached!"):
            return None
        return data
    except Exception:
        return None


@app.get("/health")
def health():
    return {"status": "ok", "mode": "omdb-proxy" if OMDB_API_KEY else "local-emulator",
            "local_titles": len(CATALOG)}


@app.get("/")
def api(s: Optional[str] = None, i: Optional[str] = None, t: Optional[str] = None,
        type: Optional[str] = None, y: Optional[str] = None, page: int = 1, plot: str = "short"):
    if s is not None:
        params = {k: v for k, v in {"s": s, "type": type, "y": y, "page": page}.items() if v}
        data = omdb(params)
        if data is None:
            return {**local_search(s, type, y, max(page, 1)), "Source": "local"}
        return {**data, "Source": "omdb"}

    if i or t:
        params = {k: v for k, v in {"i": i, "t": t, "plot": plot}.items() if v}
        data = omdb(params)
        if data is None:
            return {**local_details(i, t), "Source": "local"}
        return {**data, "Source": "omdb"}

    return not_found("No API key provided or empty query.")
