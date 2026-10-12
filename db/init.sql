-- КиноПолка: фильмы и пользовательские списки «Избранное» / «Просмотрено»

-- Карточки фильмов, которые пользователь сохранил (кэш данных из Web-сервиса)
CREATE TABLE movies (
    imdb_id      VARCHAR(12) PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    title_ru     VARCHAR(200),
    year         VARCHAR(12),
    type         VARCHAR(10),
    genre        VARCHAR(120),
    director     VARCHAR(200),
    runtime      VARCHAR(20),
    imdb_rating  NUMERIC(3,1),
    poster       TEXT,
    plot         TEXT,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- Записи в списках пользователя
CREATE TABLE user_list (
    id           SERIAL PRIMARY KEY,
    imdb_id      VARCHAR(12) NOT NULL REFERENCES movies(imdb_id) ON DELETE CASCADE,
    list_type    VARCHAR(10) NOT NULL CHECK (list_type IN ('favorite', 'watched')),
    my_rating    SMALLINT CHECK (my_rating BETWEEN 1 AND 10),
    note         VARCHAR(300),
    added_at     TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (imdb_id, list_type)
);

-- Журнал поисковых запросов к Web-сервису
CREATE TABLE search_log (
    id           SERIAL PRIMARY KEY,
    query        VARCHAR(200) NOT NULL,
    results      INT NOT NULL,
    source       VARCHAR(10),
    searched_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Стартовые данные
INSERT INTO movies (imdb_id, title, title_ru, year, type, genre, director, runtime, imdb_rating, poster, plot) VALUES
 ('tt0816692', 'Interstellar', 'Интерстеллар', '2014', 'movie', 'Adventure, Drama, Sci-Fi', 'Christopher Nolan', '169 min', 8.7, 'N/A',
  'Команда исследователей отправляется через червоточину в поисках нового дома для человечества.'),
 ('tt0133093', 'The Matrix', 'Матрица', '1999', 'movie', 'Action, Sci-Fi', 'Lana Wachowski, Lilly Wachowski', '136 min', 8.7, 'N/A',
  'Хакер Нео узнаёт, что привычный мир является симуляцией, и вступает в борьбу с машинами.'),
 ('tt0118767', 'Brother', 'Брат', '1997', 'movie', 'Action, Crime, Drama', 'Aleksei Balabanov', '100 min', 7.8, 'N/A',
  'Вернувшийся из армии Данила приезжает в Петербург к старшему брату и оказывается втянут в криминальные разборки.'),
 ('tt0903747', 'Breaking Bad', 'Во все тяжкие', '2008–2013', 'series', 'Crime, Drama, Thriller', 'N/A', '49 min', 9.5, 'N/A',
  'Школьный учитель химии с неизлечимым диагнозом начинает варить метамфетамин, чтобы обеспечить семью.'),
 ('tt15239678', 'Dune: Part Two', 'Дюна: Часть вторая', '2024', 'movie', 'Action, Adventure, Drama', 'Denis Villeneuve', '166 min', 8.5, 'N/A',
  'Пол Атрейдес объединяется с фрименами и идёт войной на тех, кто уничтожил его семью.');

INSERT INTO user_list (imdb_id, list_type, my_rating, note, added_at) VALUES
 ('tt0816692', 'watched',  10, 'Пересмотреть в IMAX',        now() - interval '20 days'),
 ('tt0816692', 'favorite', NULL, NULL,                        now() - interval '20 days'),
 ('tt0133093', 'watched',  9,  NULL,                          now() - interval '12 days'),
 ('tt0118767', 'watched',  8,  'Классика',                    now() - interval '5 days'),
 ('tt0903747', 'favorite', NULL, 'Начать со 2 сезона заново', now() - interval '3 days'),
 ('tt15239678','favorite', NULL, 'Посмотреть на выходных',    now() - interval '1 day');
