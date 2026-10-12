"""
Backend «КиноПолка»: REST API между фронтендом, БД и Web-сервисом фильмов.
"""
import os
from typing import Literal, Optional

import httpx
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DATABASE_URL = os.environ["DATABASE_URL"]
WEB_SERVICE_URL = os.environ.get("WEB_SERVICE_URL", "http://web-service:8001").rstrip("/")

app = FastAPI(title="КиноПолка API")


# ---------- помощники ----------

def db(sql: str, params: tuple = (), one: bool = False):
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
    return (rows[0] if rows else None) if one else rows


def web_service(params: dict) -> dict:
    try:
        r = httpx.get(WEB_SERVICE_URL + "/", params=params, timeout=10)
        return r.json()
    except httpx.HTTPError:
        raise HTTPException(502, "Web-сервис фильмов недоступен")


def list_flags(ids: list[str]) -> dict[str, dict[str, int]]:
    """Для каждого imdbID: в каких списках он уже лежит, {list_type: id записи}."""
    if not ids:
        return {}
    rows = db("SELECT id, imdb_id, list_type FROM user_list WHERE imdb_id = ANY(%s)", (ids,))
    flags: dict[str, dict[str, int]] = {}
    for r in rows:
        flags.setdefault(r["imdb_id"], {})[r["list_type"]] = r["id"]
    return flags


OMDB_ERRORS = {
    "Movie not found!": "Ничего не найдено",
    "Too many results.": "Слишком короткий запрос, уточни название",
    "Incorrect IMDb ID.": "Неверный IMDb ID",
    "Error getting data.": "Фильм не найден",
}


def rating(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------- служебное ----------

@app.get("/api/health")
def health():
    db("SELECT 1")
    try:
        ws = httpx.get(WEB_SERVICE_URL + "/health", timeout=3).json()
    except httpx.HTTPError:
        ws = {"status": "down"}
    return {"db": "ok", "web_service": ws}


# ---------- Кнопка 2: данные от Web-сервиса ----------

@app.get("/api/search")
def search(q: str, type: Optional[str] = None, year: Optional[str] = None, page: int = 1):
    params = {k: v for k, v in {"s": q, "type": type, "y": year, "page": page}.items() if v}
    data = web_service(params)
    results = data.get("Search", []) if data.get("Response") == "True" else []

    db("INSERT INTO search_log (query, results, source) VALUES (%s, %s, %s)",
       (q, len(results), data.get("Source")))

    flags = list_flags([m["imdbID"] for m in results])
    for m in results:
        m["lists"] = flags.get(m["imdbID"], {})
    return {
        "source": data.get("Source"),
        "total": int(data.get("totalResults", 0) or 0),
        "error": None if results else OMDB_ERRORS.get(data.get("Error"), data.get("Error", "Ничего не найдено")),
        "results": results,
    }


@app.get("/api/movie/{imdb_id}")
def movie(imdb_id: str):
    data = web_service({"i": imdb_id, "plot": "full"})
    if data.get("Response") != "True":
        raise HTTPException(404, OMDB_ERRORS.get(data.get("Error"), "Фильм не найден"))
    data["lists"] = list_flags([imdb_id]).get(imdb_id, {})
    data["entries"] = db("SELECT id, list_type, my_rating, note FROM user_list WHERE imdb_id = %s",
                         (imdb_id,))
    return data


# ---------- Кнопка 1: данные из БД (CRUD списков) ----------

@app.get("/api/list")
def get_list(list_type: Optional[Literal["favorite", "watched"]] = None):
    return db("""
        SELECT l.id, l.list_type, l.my_rating, l.note,
               to_char(l.added_at, 'DD.MM.YYYY') AS added_at,
               m.imdb_id, m.title, m.title_ru, m.year, m.type, m.genre,
               m.director, m.runtime, m.imdb_rating, m.poster
        FROM user_list l JOIN movies m USING (imdb_id)
        WHERE %s::text IS NULL OR l.list_type = %s::text
        ORDER BY l.added_at DESC, l.id DESC
    """, (list_type, list_type))


class ListItemIn(BaseModel):
    imdb_id: str
    list_type: Literal["favorite", "watched"]
    my_rating: Optional[int] = Field(None, ge=1, le=10)
    note: Optional[str] = Field(None, max_length=300)


@app.post("/api/list", status_code=201)
def add_to_list(item: ListItemIn):
    data = web_service({"i": item.imdb_id})
    if data.get("Response") != "True":
        raise HTTPException(404, OMDB_ERRORS.get(data.get("Error"), "Фильм не найден"))

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # сохраняем/обновляем карточку фильма
            cur.execute("""
                INSERT INTO movies (imdb_id, title, title_ru, year, type, genre, director,
                                    runtime, imdb_rating, poster, plot)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (imdb_id) DO UPDATE SET
                    imdb_rating = EXCLUDED.imdb_rating, poster = EXCLUDED.poster
            """, (data["imdbID"], data["Title"], data.get("TitleRu"), data.get("Year"),
                  data.get("Type"), data.get("Genre"), data.get("Director"),
                  data.get("Runtime"), rating(data.get("imdbRating")),
                  data.get("Poster"), data.get("Plot")))
            # добавляем в список (если уже есть, обновляем оценку и заметку)
            cur.execute("""
                INSERT INTO user_list (imdb_id, list_type, my_rating, note)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (imdb_id, list_type) DO UPDATE SET
                    my_rating = COALESCE(EXCLUDED.my_rating, user_list.my_rating),
                    note      = COALESCE(EXCLUDED.note, user_list.note)
                RETURNING id
            """, (item.imdb_id, item.list_type, item.my_rating, item.note))
            new_id = cur.fetchone()["id"]
    return {"id": new_id, "title": data["Title"], "title_ru": data.get("TitleRu"),
            "list_type": item.list_type}


class ListItemPatch(BaseModel):
    my_rating: Optional[int] = Field(None, ge=1, le=10)
    note: Optional[str] = Field(None, max_length=300)


@app.patch("/api/list/{item_id}")
def update_item(item_id: int, patch: ListItemPatch):
    # обновляем только те поля, которые пришли в запросе
    fields = {k: getattr(patch, k) for k in patch.model_fields_set}
    if not fields:
        raise HTTPException(400, "Нечего обновлять")
    sets = ", ".join(f"{k} = %s" for k in fields)
    row = db(f"UPDATE user_list SET {sets} WHERE id = %s RETURNING id, my_rating, note",
             (*fields.values(), item_id), one=True)
    if not row:
        raise HTTPException(404, "Запись не найдена")
    return row


@app.delete("/api/list/{item_id}")
def delete_item(item_id: int):
    row = db("DELETE FROM user_list WHERE id = %s RETURNING id", (item_id,), one=True)
    if not row:
        raise HTTPException(404, "Запись не найдена")
    return {"deleted": item_id}


# ---------- статистика ----------

@app.get("/api/stats")
def stats():
    totals = db("""
        SELECT COUNT(*) FILTER (WHERE list_type = 'favorite') AS favorites,
               COUNT(*) FILTER (WHERE list_type = 'watched')  AS watched,
               ROUND(AVG(my_rating) FILTER (WHERE list_type = 'watched'), 1) AS my_avg
        FROM user_list
    """, one=True)
    minutes = db("""
        SELECT COALESCE(SUM(split_part(m.runtime, ' ', 1)::int), 0) AS minutes
        FROM user_list l JOIN movies m USING (imdb_id)
        WHERE l.list_type = 'watched' AND m.type = 'movie' AND m.runtime ~ '^[0-9]+ min$'
    """, one=True)
    genres = db("""
        SELECT trim(g) AS genre, COUNT(*) AS cnt
        FROM user_list l JOIN movies m USING (imdb_id),
             unnest(string_to_array(m.genre, ',')) AS g
        WHERE l.list_type = 'watched'
        GROUP BY trim(g) ORDER BY cnt DESC, genre LIMIT 5
    """)
    vs_imdb = db("""
        SELECT COALESCE(m.title_ru, m.title) AS title, l.my_rating, m.imdb_rating
        FROM user_list l JOIN movies m USING (imdb_id)
        WHERE l.list_type = 'watched' AND l.my_rating IS NOT NULL
        ORDER BY abs(l.my_rating - m.imdb_rating) DESC LIMIT 5
    """)
    searches = db("""
        SELECT query, results, source, to_char(searched_at, 'DD.MM HH24:MI') AS at
        FROM search_log ORDER BY id DESC LIMIT 5
    """)
    return {**totals, **minutes, "top_genres": genres, "vs_imdb": vs_imdb,
            "recent_searches": searches}
