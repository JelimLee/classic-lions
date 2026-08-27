-- =====================================================================
--  Classic Lions — DB 스키마
--  작성일: 2026-08-27
--  기준 DBMS: PostgreSQL 15+ (Supabase)
--  로컬 미러: SQLite (Drift). 차이는 각 지점에 `-- SQLite:` 주석으로 표기.
--
--  설계 근거 문서
--    docs/SCHEMA.md               ← 이 파일의 해설. 반드시 같이 읽을 것
--    ARCHITECTURE.md §3           ← 원본 초안 (이 파일이 대체한다)
--    docs/TASTE_MODEL.md          ← 편성/프로그램 구성 축, 앵콜
--    docs/WORK_TAGGING.md         ← 작품 스타일 태깅
--    docs/COMPETITIVE_RESEARCH.md §4-8, §5 P0-2·P1-1~5, §6-6
--
--  전역 규칙 5개 (예외 없음)
--    1. 원본 사진은 서버에 저장하지 않는다. 사진 blob 컬럼도, 원본 URL 컬럼도 없다.
--       (§6-6 — 플앱은 이미지 1,000만 파일 서버비로 적자가 났다)
--    2. 열거형은 PG ENUM 타입이 아니라 TEXT + CHECK 로 쓴다.
--       ENUM 은 값 추가/삭제 마이그레이션이 지옥이고 SQLite 에 대응물이 없다.
--    3. 배열은 PG array 가 아니라 jsonb 로 쓴다. SQLite JSON1 과 형태가 같아진다.
--    4. 사용자 소유 테이블은 전부 동기화 4종 세트를 갖는다:
--       id(uuidv7) / updated_at / deleted_at / rev
--    5. OCR·파싱 결과는 반드시 `*_raw` 원문과 정규화 값을 **둘 다** 남긴다.
--       파싱 규칙은 나중에 고쳐지지만 원문은 다시 못 찍는다.
-- =====================================================================

-- SQLite: 아래 두 줄은 매 연결마다 실행할 것 (Drift 의 beforeOpen).
--   PRAGMA foreign_keys = ON;
--   PRAGMA journal_mode = WAL;
--
-- 🔴 SQLite 로 옮길 때 절대 하면 안 되는 것 — 타입명을 그대로 베끼는 것.
--   SQLite 는 선언 타입에서 affinity 를 추론한다. `INT`→INTEGER, `CHAR/CLOB/TEXT`→TEXT,
--   `BLOB`/미지정→BLOB, `REAL/FLOA/DOUB`→REAL, **그 외 전부 → NUMERIC**.
--   즉 `uuid` `jsonb` `timestamptz` 는 전부 NUMERIC affinity 가 된다.
--   NUMERIC 은 "숫자처럼 보이는 텍스트를 조용히 숫자로 바꾼다."
--   → SQLite 쪽 선언은 **TEXT / INTEGER / REAL / BLOB 넷만** 쓴다.
--      uuid→TEXT, jsonb→TEXT, timestamptz→INTEGER(epoch ms), boolean→INTEGER, bytea→BLOB

-- Postgres 전용
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
-- CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector. §임베딩 절 참조 (v2)


-- #####################################################################
--  LAYER 1 — 카탈로그 (서버 소유, 클라이언트는 읽기 전용으로 내려받음)
--  사용자 데이터가 아니다. RLS 는 "누구나 SELECT, 서비스롤만 쓰기".
-- #####################################################################

-- ---------------------------------------------------------------------
-- composers — 작곡가 사전
--   출처: Open Opus(CC0) + Wikidata SPARQL 한글명·생몰년
--   생몰년은 works.life_phase 계산(WORK_TAGGING §3)과
--   "오늘의 작곡가"(COMPETITIVE_RESEARCH P2-3)에 동시에 쓰인다.
-- ---------------------------------------------------------------------
CREATE TABLE composers (
  id            text PRIMARY KEY,              -- 'chopin-frederic' 슬러그. 사람이 읽을 수 있게
  name_en       text NOT NULL,                 -- 'Frédéric Chopin'
  name_ko       text,                          -- '프레데리크 쇼팽'
  sort_name     text NOT NULL,                 -- 'Chopin, Frederic' — 정렬/매칭용 ASCII 폴딩
  aliases       jsonb NOT NULL DEFAULT '[]',   -- ["쇼팽","F. Chopin","Szopen"] 매칭 후보
  born_year     integer,
  died_year     integer,
  born_date     date,                          -- "오늘의 작곡가"용. 연도만 알면 NULL
  died_date     date,
  epoch         text,                          -- Open Opus epoch 원문
  era           text CHECK (era IN ('medieval','renaissance','baroque','classical','romantic','modern','contemporary')),
  nationality   text,
  wikidata_qid  text,
  portrait_url  text,                          -- 외부 링크만. 우리가 미러링하지 않는다 (규칙 1)
  source        text NOT NULL DEFAULT 'open_opus',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_composers_sort   ON composers (sort_name);
CREATE INDEX idx_composers_era    ON composers (era);
-- "오늘의 작곡가": 월-일로만 조회한다
CREATE INDEX idx_composers_bornmd ON composers (
  (extract(month from born_date)), (extract(day from born_date))
) WHERE born_date IS NOT NULL;
-- SQLite: 위 표현식 인덱스 대신 born_md TEXT('MM-DD') 생성열을 두고 그걸 인덱싱한다.


-- ---------------------------------------------------------------------
-- works — 작품 마스터 + 스타일 태그
--   ⚠ WORK_TAGGING.md 의 WorkStyle 을 **별도 테이블로 쪼개지 않았다.**
--   1:1 관계이고 조인을 하나 줄이는 게 1인 개발자에게 이득이다. SCHEMA.md §4 참조.
-- ---------------------------------------------------------------------
CREATE TABLE works (
  id            text PRIMARY KEY,              -- 'chopin-op28-preludes'
  composer_id   text NOT NULL REFERENCES composers(id),

  -- 식별 --------------------------------------------------------------
  title_en      text NOT NULL,                 -- '24 Preludes'
  title_ko      text,                          -- '24개의 전주곡'
  nickname      text,                          -- '황제', 'Emperor' — 별칭 검색용
  aliases       jsonb NOT NULL DEFAULT '[]',   -- 곡목 매칭 후보 문자열 배열
  catalog       text,                          -- 'Op.', 'BWV', 'K.', 'D.' 등 카탈로그 체계
  catalog_no    text,                          -- '28', '1048' — 문자열이다. '64ter' 같은 값이 실재한다
  work_no       integer,                       -- 협주곡 2번의 '2'
  key_sig       text,                          -- 'd-minor' / 'D-flat-major'
  composed_year integer,
  premiere_year integer,
  duration_min  integer,

  -- 편성 축 (TASTE_MODEL §1) — **곡 제목 파싱으로 얻는다. 검색도 LLM 도 아니다** ----
  forces        text CHECK (forces IN ('symphony','concerto','solo','chamber','orchestral_short','vocal','stage')),
  soloist_inst  text,                          -- 이 **작품**이 요구하는 독주 악기. 그날 누가 쳤는지가 아니다(→ credits)
  scale         text CHECK (scale IN ('large','medium','small','solo')),
  forces_conf   real CHECK (forces_conf BETWEEN 0 AND 1),

  -- 스타일 축 (WORK_TAGGING §1) ---------------------------------------
  -- ⚠ COMPETITIVE_RESEARCH §6-4 판정에 따라 mood 는 **고정 어휘가 1차**다.
  --   Idagio 15종을 그대로 쓴다. 연속값 3축은 태그에서 파생시키는 보조 컬럼.
  mood_tags     jsonb NOT NULL DEFAULT '[]',   -- ["Tragic","Passionate"] ⊂ MOOD_VOCAB(아래 주석)
  mood_valence  real,                          -- 파생값(태그→수치). LLM 이 직접 뱉지 않는다
  mood_energy   real,
  mood_tension  real,
  subject       text CHECK (subject IN ('absolute','nature','love','death','religious','patriotic','literary','dance','other')),
  texture       text CHECK (texture IN ('melodic','virtuosic','contrapuntal','dramatic','coloristic')),

  -- 생애 위치 (WORK_TAGGING §3) — 계산값. LLM 호출 금지 -------------------
  life_ratio    real CHECK (life_ratio BETWEEN 0 AND 1),
  life_phase    text CHECK (life_phase IN ('early','middle','late')),

  -- 희귀도 (WORK_TAGGING §9) — 연주 빈도에서 계산 -----------------------
  -- ⚠ 원문 공식 `1 - n/max` 는 실데이터에서 무너진다. 반드시 백분위를 쓸 것.
  --   근거: 뉴욕필 1980-81~ 정기연주회 2,009 프로그램 실측 — 최다연주 270회(메시아),
  --   작품의 55%가 1회. 선형식이면 베토벤 황제협주곡(27회)이 rarity 0.90 = "매우 희귀"가 된다.
  --   백분위 랭크로 바꾸면 0.008 로 올바르게 나온다. (docs/SCHEMA.md §7)
  rarity        real CHECK (rarity BETWEEN 0 AND 1),
  rarity_n      integer,                       -- 계산에 쓰인 연주 횟수 (재현용)
  rarity_basis  text,                          -- 'nyphil_1980+' | 'kopis_2015+' 등 계산 근거 코퍼스

  -- 메타 ---------------------------------------------------------------
  evidence      jsonb NOT NULL DEFAULT '[]',   -- 근거 URL 배열
  tag_conf      real CHECK (tag_conf BETWEEN 0 AND 1),
  tagged_by     text CHECK (tagged_by IN ('llm','rule','user','import')),
  imslp_url     text,
  wikidata_qid  text,
  source        text NOT NULL DEFAULT 'open_opus',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- MOOD_VOCAB (Idagio 15종. 앱 코드의 상수와 반드시 일치시킬 것):
--   Excited Radiant Happy Relaxed Peaceful Optimistic Joyful Powerful
--   Gentle Festive Sad Tragic Nervous Angry Passionate
-- CHECK 로 강제하지 않는 이유: jsonb 배열 원소 검증은 PG/SQLite 문법이 갈린다.
-- 앱 계층에서 검증하고, 아래 뷰로 위반을 감시한다.

CREATE INDEX idx_works_composer ON works (composer_id);
CREATE INDEX idx_works_forces   ON works (forces, soloist_inst);
CREATE INDEX idx_works_rarity   ON works (rarity DESC NULLS LAST);
CREATE INDEX idx_works_catalog  ON works (composer_id, catalog, catalog_no);
-- 곡목 문자열 매칭용 GIN. WORK_TAGGING §5 는 "작곡가 먼저 → 작품" 2단계 매칭을 권한다.
-- 즉 이 인덱스는 **composer_id 로 좁힌 뒤** 쓰는 보조 수단이다.
CREATE INDEX idx_works_aliases  ON works USING gin (aliases jsonb_path_ops);
-- SQLite: GIN 없음. FTS5 가상테이블 works_fts(title_en,title_ko,nickname,aliases) 로 대체.

-- 무드 어휘 위반 감시 (운영용. 배치에서 주기적으로 본다)
CREATE VIEW v_bad_mood_tags AS
SELECT w.id, t.tag
FROM works w, jsonb_array_elements_text(w.mood_tags) AS t(tag)
WHERE t.tag NOT IN ('Excited','Radiant','Happy','Relaxed','Peaceful','Optimistic',
                    'Joyful','Powerful','Gentle','Festive','Sad','Tragic',
                    'Nervous','Angry','Passionate');


-- ---------------------------------------------------------------------
-- performers — 연주자/단체
--   ⚠ 이 프로젝트에서 가장 큰 구멍이었다. ARCHITECTURE §3 에는
--     concerts.artist 자유 문자열 하나뿐이었다. (COMPETITIVE_RESEARCH P0-2)
--   ⚠ kind 를 두는 이유: 뉴욕필 CC0 덤프는 kind 가 없어서
--     'Chorus'/'Dancer'/'Brass Quintet'/'Orchestra' 를 soloistInstrument 에
--     욱여넣었다. 62,768 소리스트 행 중 10,666(17%)이 사람이 아니다.
--     같은 실수를 반복하지 않는다. (docs/SCHEMA.md §7)
-- ---------------------------------------------------------------------
CREATE TABLE performers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('person','orchestra','ensemble','choir','company')),
  name_ko       text,                          -- '임윤찬'
  name_en       text,                          -- 'Yunchan Lim'
  sort_name     text NOT NULL,                 -- 'Lim, Yunchan'
  aliases       jsonb NOT NULL DEFAULT '[]',   -- ["임윤찬","Lim Yunchan","YUNCHAN LIM"]
  -- 사람일 때만 -------------------------------------------------------
  main_inst     text,                          -- 주 악기. 통계 기본값일 뿐, 사실은 credits 가 정한다
  born_year     integer,
  nationality   text,
  -- 단체일 때만 -------------------------------------------------------
  founded_year  integer,
  home_venue_id uuid,                          -- FK 는 venues 정의 뒤에 ALTER 로 붙인다
  --------------------------------------------------------------------
  mbid          uuid,                          -- MusicBrainz Artist MBID. 있으면 저장
  wikidata_qid  text,
  source        text NOT NULL DEFAULT 'user',  -- 'kopis'|'nyphil'|'user'|'manual'
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (name_ko IS NOT NULL OR name_en IS NOT NULL)
);
CREATE INDEX idx_performers_sort    ON performers (sort_name);
CREATE INDEX idx_performers_kind    ON performers (kind, sort_name);
CREATE INDEX idx_performers_aliases ON performers USING gin (aliases jsonb_path_ops);
CREATE UNIQUE INDEX uq_performers_mbid ON performers (mbid) WHERE mbid IS NOT NULL;


-- ---------------------------------------------------------------------
-- venues — 공연장(홀 단위)
--   ⚠ "예술의전당"이 아니라 "예술의전당 콘서트홀"이 1행이다.
--     홀마다 층·구역 체계가 완전히 다르다 (RESEARCH_seat_avatar §1.2).
--   ⚠ setlist.fm 규칙 채택: 공연 당일의 이름을 쓴다.
--     개명 시 새 행을 만들지 말고 renamed_to 로 잇는다.
-- ---------------------------------------------------------------------
CREATE TABLE venues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complex_name  text,                          -- '예술의전당'
  hall_name     text NOT NULL,                 -- '콘서트홀'
  display_name  text NOT NULL,                 -- '예술의전당 콘서트홀'
  aliases       jsonb NOT NULL DEFAULT '[]',   -- ["예당 콘서트홀","SAC Concert Hall"]
  region        text,                          -- '서울' — 하드필터용
  address       text,
  lat           double precision,
  lng           double precision,
  seat_capacity integer,
  -- 좌석 파서가 참조하는 프로필. 렌더러로 규칙이 새어나가지 않게 여기 모은다.
  floor_count   integer,                       -- 예당 콘서트홀 3, 롯데 2
  block_style   text CHECK (block_style IN ('block','section','none')),  -- 예당='블록', 롯데='구역'
  behind_stage_blocks jsonb NOT NULL DEFAULT '[]',  -- ["F","G","H"] 합창석
  kopis_venue_id text,
  renamed_to    uuid REFERENCES venues(id),    -- 개명된 경우 현재 이름 행을 가리킨다
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_venues_region ON venues (region);
CREATE INDEX idx_venues_alias  ON venues USING gin (aliases jsonb_path_ops);

ALTER TABLE performers
  ADD CONSTRAINT fk_performers_home_venue
  FOREIGN KEY (home_venue_id) REFERENCES venues(id);
-- SQLite: `ALTER TABLE … ADD CONSTRAINT` 가 없다. 로컬에서는 performers 정의 안에
--   home_venue_id TEXT REFERENCES venues(id)
-- 를 인라인으로 넣는다. SQLite 는 DDL 시점에 FK 대상 존재를 검사하지 않으므로
-- venues 가 뒤에 정의돼도 정방향 참조가 허용된다.


-- #####################################################################
--  LAYER 2 — 이벤트 (공연 사실. 여러 사용자가 공유한다)
-- #####################################################################

-- ---------------------------------------------------------------------
-- concerts — **한 회차 = 한 행**
--   ⚠ 뉴욕필은 program(레퍼토리+캐스트 동일) / concert(날짜·장소) 2층이다.
--     우리는 1층으로 접었다. 이유는 SCHEMA.md §5.
--     대신 run_id 로 "같은 공연의 다른 회차"를 묶는다 (컬럼 1개 = 테이블 0개).
--   ⚠ 뉴욕필 자신의 규칙: "어느 날 앵콜이 있고 다른 날 없으면 다른 program 이다."
--     회차를 1급으로 두면 이 문제가 애초에 발생하지 않는다.
-- ---------------------------------------------------------------------
CREATE TABLE concerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid,                          -- 같은 프로덕션의 회차 묶음. KOPIS 공연ID 1건 = run 1개
  source        text NOT NULL CHECK (source IN ('kopis','ticket_ocr','manual','import','nyphil')),

  title         text NOT NULL,                 -- 정규화된 공연명
  title_raw     text,                          -- 티켓/포스터에 인쇄된 원문 (규칙 5)
  subtitle      text,

  venue_id      uuid REFERENCES venues(id),
  venue_raw     text,                          -- 티켓 인쇄 원문. venue_id 매칭 실패해도 이건 남는다
  region        text,                          -- 하드필터 (venues 조인 없이 쓰려고 비정규화)

  date          date NOT NULL,                 -- zero-padded. 파싱 실패한 값은 저장하지 않는다
  date_raw      text,                          -- '2025년 3월 15일' 원문 보존
  start_time    time,                          -- 실패 시 NULL
  time_raw      text,

  -- 프로그램 구성 (TASTE_MODEL §1-4). program_items 에서 도출되는 파생값이다.
  -- ⚠ 뉴욕필 실측으로 검증했다: 고정 3슬롯 템플릿(서곡→협주곡→[휴식]→교향곡)은
  --   현대 정기연주회의 1.9%뿐이다. "인터미션 앞에 협주곡 / 뒤에 교향곡"이라는
  --   느슨한 규칙으로 재정의하면 32%가 잡힌다. 판정은 인터미션 위치로 한다.
  program_arch  text CHECK (program_arch IN ('classic_three','concerto_night','recital','all_composer','thematic','chamber_night','mixed','unknown')),
  program_arch_conf real,

  event_type    text,                          -- 'subscription'|'recital'|'tour'|'chamber'|'festival'|... (뉴욕필 eventType 차용)
  price_min     integer,
  price_max     integer,
  booking_url   text,
  poster_url    text,                          -- 외부 링크. 우리가 미러링하지 않는다 (규칙 1)
  kopis_id      text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX idx_concerts_date    ON concerts (date) WHERE deleted_at IS NULL;
CREATE INDEX idx_concerts_region  ON concerts (region, date) WHERE deleted_at IS NULL;
CREATE INDEX idx_concerts_venue   ON concerts (venue_id, date);
CREATE INDEX idx_concerts_run     ON concerts (run_id, date) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX uq_concerts_kopis ON concerts (kopis_id, date) WHERE kopis_id IS NOT NULL;
-- 중복 등록 방지 후보키 (사용자가 같은 공연을 두 번 찍는 경우)
CREATE INDEX idx_concerts_dedup   ON concerts (date, venue_id, lower(title));


-- ---------------------------------------------------------------------
-- program_items — 그날 실제로 울린 순서 (인터미션·앵콜 포함)
--
--   뉴욕필에서 배운 것 3가지가 전부 이 테이블에 들어 있다:
--   (1) 인터미션이 곡 목록 **안의 항목**이다 — 88,533 work 행 중 11,944 가 interval.
--       위치를 버리면 program_arch 판정이 불가능해진다.
--   (2) 악장이 별도 행이다 — ID='workID*movementID'. 20%의 프로그램에서
--       같은 workID 가 여러 번 나온다. 그래서 (work_id, movement) 가 항목이지 work_id 가 아니다.
--   (3) 편곡자를 필드로 두지 않아 제목 문자열에 묻었다 — 7,190건이 '(ARR. Seipp)' 형태.
--       우리는 arranger 를 컬럼으로 뺀다. 이건 뉴욕필보다 나은 부분이다.
--
--   그리고 뉴욕필에 **없는** 것: 앵콜 플래그. 32건이 'ENCORE (UNSPECIFIED)' 라는
--   가짜 작품 제목으로 들어가 있을 뿐이다. is_encore/encore_order 는 우리 추가분이다.
-- ---------------------------------------------------------------------
CREATE TABLE program_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concert_id    uuid NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  seq           integer NOT NULL,              -- 인쇄된 순서. 인터미션도 seq 를 차지한다

  item_type     text NOT NULL DEFAULT 'work'
                CHECK (item_type IN ('work','intermission','speech','other')),

  -- item_type='work' 일 때 -------------------------------------------
  work_id       text REFERENCES works(id),     -- 매칭 실패 시 NULL. raw_text 는 항상 남는다
  movement      text,                          -- '2악장 Adagio'. 전곡이면 NULL
  arranger      text,                          -- '(Arr. Alfred Gerinfall)' — P1-1
  raw_text      text NOT NULL,                 -- OCR/입력 원문. 절대 파괴하지 않는다 (규칙 5)
  match_conf    real CHECK (match_conf BETWEEN 0 AND 1),

  -- 앵콜 (COMPETITIVE_RESEARCH P1-1) ---------------------------------
  is_encore     boolean NOT NULL DEFAULT false,
  encore_order  integer,                       -- 1차 앵콜=1, 2차=2. 앵콜 아니면 NULL

  -- 인터미션은 raw_text 에 '인터미션'/'Intermission-Short' 등을 그대로 담는다.
  -- 몇 번째 인터미션인지는 seq 로 계산된다 → 별도 컬럼 없음.

  source        text CHECK (source IN ('kopis','article','program_photo','user_input','kbs_encore','nyphil','import')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (concert_id, seq),
  CHECK (item_type <> 'work' OR raw_text <> ''),
  CHECK (is_encore = false OR item_type = 'work'),
  CHECK ((encore_order IS NULL) = (is_encore = false)),
  CHECK (item_type = 'work' OR work_id IS NULL)
);
CREATE INDEX idx_pitems_concert ON program_items (concert_id, seq);
CREATE INDEX idx_pitems_work    ON program_items (work_id) WHERE work_id IS NOT NULL;
CREATE INDEX idx_pitems_encore  ON program_items (concert_id) WHERE is_encore;
-- 곡목 매칭 리뷰 큐: 매칭 실패하거나 신뢰도 낮은 항목
CREATE INDEX idx_pitems_review  ON program_items (concert_id)
  WHERE item_type = 'work' AND (work_id IS NULL OR match_conf < 0.85);


-- ---------------------------------------------------------------------
-- credits — ★ (사람/단체, 악기, 역할) 3항 관계. 이 프로젝트의 핵심 테이블
--
--   program_item_id 가 NULL 이면 "공연 전체"에 붙는 크레딧이다.
--     → 서울시향(오케스트라), 정명훈(지휘) 처럼 하루 종일 같은 경우.
--   program_item_id 가 있으면 "그 곡에만" 붙는 크레딧이다.
--     → 예당 상세페이지의 `/ 피아노 임동혁` 처럼 곡마다 협연자가 다른 경우.
--   이 nullable 하나로 두 경우를 다 담는다. 흔한 쪽(공연 전체)이 행 1개로 끝난다.
--
--   ⚠ 뉴욕필은 conductorName 을 work 행의 스칼라 컬럼으로 뒀다.
--     그래서 "한 프로그램에 지휘자 2명"(565건)은 표현되지만
--     "지휘자를 엔티티로 집계"하려면 문자열을 다시 파싱해야 한다.
--     우리는 지휘자도 credits 의 한 행이다.
--   ⚠ 뉴욕필 soloistRole 은 'S'(Soloist)/'A'(Assisting) 2값뿐이다. 너무 거칠다.
--     그 부족분을 soloistInstrument 에 'Chorus'/'Dancer'/'Orchestra' 를 넣어
--     메웠고, 그게 17% 오염으로 돌아왔다. 우리는 role 을 12값으로 편다.
-- ---------------------------------------------------------------------
CREATE TABLE credits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concert_id      uuid NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
  program_item_id uuid REFERENCES program_items(id) ON DELETE CASCADE,  -- NULL = 공연 전체
  performer_id    uuid NOT NULL REFERENCES performers(id),

  role            text NOT NULL CHECK (role IN (
                    'conductor',      -- 지휘
                    'soloist',        -- 협연 (오케스트라와 함께하는 기악 독주)
                    'recitalist',     -- 독주 (리사이틀의 주인공)
                    'vocalist',       -- 성악 (instrument 에 성부를 넣는다)
                    'ensemble',       -- 앙상블 구성원
                    'orchestra',      -- 오케스트라 (단체)
                    'choir',          -- 합창단 (단체)
                    'accompanist',    -- 반주
                    'concertmaster',  -- 악장
                    'assisting',      -- 조연 (뉴욕필 'A')
                    'narrator',       -- 내레이션
                    'other')),
  instrument      text,                        -- role 이 사람일 때만. 성악은 'soprano'|'tenor'|...
  billing_order   integer,                     -- 포스터 표기 순서. 0=톱빌링
  is_headliner    boolean NOT NULL DEFAULT false,  -- 티켓 얼굴. 예당 흥행 1~3위가 전부 이 사람들이다

  raw_text        text,                        -- '지휘 | 정명훈' 인쇄 원문
                                               -- MusicBrainz artist_credit_name.name(credited_as) 과 같은 역할:
                                               -- 정규 엔티티를 가리키면서 그날 실제 표기를 보존한다
  source          text CHECK (source IN ('kopis','ticket_ocr','program_photo','user_input','article','nyphil','import')),
  match_conf      real CHECK (match_conf BETWEEN 0 AND 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- 같은 곡에 같은 사람이 같은 역할·같은 악기로 두 번 들어가지 않게.
  -- (program_item_id 가 NULL 인 행이 여러 개일 수 있으므로 부분 유니크 2벌로 나눈다)
  CHECK (role NOT IN ('orchestra','choir') OR instrument IS NULL)
);
CREATE UNIQUE INDEX uq_credits_item ON credits (program_item_id, performer_id, role, (coalesce(instrument,'')))
  WHERE program_item_id IS NOT NULL;
CREATE UNIQUE INDEX uq_credits_concert ON credits (concert_id, performer_id, role, (coalesce(instrument,'')))
  WHERE program_item_id IS NULL;

CREATE INDEX idx_credits_concert   ON credits (concert_id, role);
CREATE INDEX idx_credits_item      ON credits (program_item_id) WHERE program_item_id IS NOT NULL;
-- ★ "임윤찬을 몇 번 봤나" 가 이 인덱스 하나로 끝난다
CREATE INDEX idx_credits_performer ON credits (performer_id, role, concert_id);
CREATE INDEX idx_credits_headline  ON credits (concert_id) WHERE is_headliner;


-- #####################################################################
--  LAYER 3 — 개인 (사용자 소유. RLS 필수. 로컬↔서버 동기화 대상)
-- #####################################################################

-- ---------------------------------------------------------------------
-- profiles — 명시 취향 설정
-- ---------------------------------------------------------------------
CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY,              -- Supabase auth.users(id)
  display_name  text,
  home_region   text,
  travel_ok     boolean NOT NULL DEFAULT false,
  eras          jsonb NOT NULL DEFAULT '[]',
  instruments   jsonb NOT NULL DEFAULT '[]',
  fav_performer_ids jsonb NOT NULL DEFAULT '[]',
  fav_composer_ids  jsonb NOT NULL DEFAULT '[]',
  avatar_config jsonb,                         -- 좌석 아바타 (RESEARCH_seat_avatar)
  version       integer NOT NULL DEFAULT 1,    -- ★ LLM 캐시 무효화 키. 취향 바뀌면 +1
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 1
);
-- [RLS] profiles: user_id = auth.uid() 인 행만 SELECT/INSERT/UPDATE/DELETE. 보안 담당 작성.


-- ---------------------------------------------------------------------
-- attendances — "내가 갔다". 개인 아카이브의 앵커
--   ARCHITECTURE §3 의 archive 를 대체한다. 바뀐 점:
--     - ticket_img_key 제거 (규칙 1)
--     - 사전 선택 이유 / 한줄·상세 감상 분리 / 공개범위 추가
-- ---------------------------------------------------------------------
CREATE TABLE attendances (
  id            uuid PRIMARY KEY,              -- ⚠ UUIDv7 을 **클라이언트가** 생성한다 (오프라인 우선)
  user_id       uuid NOT NULL,
  concert_id    uuid REFERENCES concerts(id),  -- 매칭 전이면 NULL 허용

  attended_on   date NOT NULL,                 -- concerts.date 와 보통 같지만, 매칭 실패해도 이건 있다
  companion     text,                          -- '혼자' | '지인 1명' 자유 입력
  price_paid    integer,
  price_raw     text,
  booking_channel text,                        -- '인터파크'|'예당회원'|'초대'

  -- 사전(pre-hoc) 라벨 — COMPETITIVE_RESEARCH P1-3 --------------------
  -- ★ chosen_at 이 반드시 필요하다. 이 라벨의 가치는 "관람 전"이라는 데서 온다.
  --   관람 후에 적은 이유는 사후 합리화이고, 지도학습 라벨로서 값이 다르다.
  --   chosen_at < attended_on 인 행만 pre-hoc 로 취급한다.
  chosen_reason text CHECK (chosen_reason IN (
                  'performer',        -- 이 연주자를 좋아해서
                  'work',             -- 이 곡을 좋아해서
                  'first_live',       -- 이 곡을 실황으로 처음
                  'new_repertoire',   -- 새 레퍼토리 개척
                  'venue',            -- 홀이 좋아서
                  'companion',        -- 지인 동행
                  'price',            -- 표가 싸서
                  'whim',             -- 그냥 끌려서
                  'gift','other')),
  chosen_reason_note text,
  chosen_at     timestamptz,                   -- 이 라벨을 남긴 시각

  -- 사후 감상 — P1-5: 한 줄과 상세를 처음부터 **다른 필드**로 --------------
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  one_liner     text,                          -- 목록/카드에 노출. 짧게
  note          text,                          -- 상세에서만. 길이 제한 없음
  visibility    text NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','friends','public')),
  -- Letterboxd 규칙: 비공개 항목은 커뮤니티 통계에서 제외한다 (v2 소셜 대비)

  ocr_conf      jsonb,                         -- 등록 시점 필드별 신뢰도 스냅샷
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,                   -- 소프트 삭제 (툼스톤). 물리 삭제 금지
  rev           bigint NOT NULL DEFAULT 1,
  origin_device text                           -- 어느 기기에서 만들었나 (충돌 디버깅용)
);
CREATE INDEX idx_att_user_date ON attendances (user_id, attended_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_att_concert   ON attendances (concert_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_att_sync      ON attendances (user_id, updated_at);   -- 델타 동기화 (?since=)
CREATE INDEX idx_att_prehoc    ON attendances (user_id, chosen_reason)
  WHERE chosen_reason IS NOT NULL AND deleted_at IS NULL;
-- 같은 사용자가 같은 공연을 두 번 등록하는 사고 방지
CREATE UNIQUE INDEX uq_att_user_concert ON attendances (user_id, concert_id)
  WHERE concert_id IS NOT NULL AND deleted_at IS NULL;
-- [RLS] attendances: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- attendance_seat — 좌석 + ★음향 인상 (P1-2)
--   1:1 이지만 분리한다: 파싱 필드가 8개이고 자체 confidence 를 갖는다.
--   attendances 에 합치면 "그날의 기록"과 "문자열 파싱 결과"가 한 행에 섞인다.
-- ---------------------------------------------------------------------
CREATE TABLE attendance_seat (
  attendance_id uuid PRIMARY KEY REFERENCES attendances(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,                 -- RLS 를 위해 비정규화 (조인 없이 정책 평가)
  raw           text NOT NULL,                 -- 인쇄 원문. 파싱이 다 실패해도 이건 남는다
  floor         smallint CHECK (floor BETWEEN 1 AND 5),   -- ⚠ 1..5. 게이트 층(8F/9F) 오탐 차단
  block         text,
  row_num       smallint,
  row_label     text,                          -- 'A' 같은 알파벳 열
  seat_num      smallint,
  seat_numbers  jsonb NOT NULL DEFAULT '[]',   -- 연석
  grade         text,                          -- 'R석' — seatRaw 와 다른 영역에 인쇄된다
  grade_raw     text,
  behind_stage  boolean NOT NULL DEFAULT false,-- 합창석 여부. venues.behind_stage_blocks 로 판정
  parse_conf    real CHECK (parse_conf BETWEEN 0 AND 1),

  -- ★ 좌석 ↔ 음향 인상. 비용 0, 클래식 특유. 쌓이면
  --   "당신은 2층 앞쪽에서 들을 때 만족도가 높습니다" 가 나온다.
  acoustic_rating smallint CHECK (acoustic_rating BETWEEN 1 AND 5),
  acoustic_note   text,
  sightline_rating smallint CHECK (sightline_rating BETWEEN 1 AND 5),

  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 1
);
CREATE INDEX idx_seat_user_acoustic ON attendance_seat (user_id, floor, acoustic_rating)
  WHERE acoustic_rating IS NOT NULL;
-- [RLS] attendance_seat: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- attendance_media — 서버에 올라가는 "사진의 잔해". 사진 자체는 아니다.
--
--   🔴 규칙 1 을 스키마로 강제하는 자리다.
--   원본 blob 컬럼 없음. 원본 URL 컬럼 없음. R2/Storage object key 컬럼 없음.
--   (ARCHITECTURE §3 의 archive.ticket_img_key 는 여기서 **삭제**됐다)
--
--   썸네일은 선택이며 CHECK 로 물리적으로 작게 묶는다.
--   4032×3024 원본은 이 테이블에 **들어갈 수 없다** — 제약이 거부한다.
-- ---------------------------------------------------------------------
CREATE TABLE attendance_media (
  id            uuid PRIMARY KEY,
  attendance_id uuid NOT NULL REFERENCES attendances(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('ticket','program_book','seat_view','other')),
  page_no       smallint,                      -- 프로그램북 여러 장

  -- 남는 것은 텍스트다. 이게 우리 자산이고, 사진은 아니다.
  ocr_text      text,
  ocr_model     text,
  ocr_conf      jsonb,
  ocr_at        timestamptz,

  -- 선택적 저해상도 썸네일. 없어도 앱은 완전히 동작해야 한다.
  thumb         bytea,
  thumb_w       smallint,
  thumb_h       smallint,
  thumb_mime    text,

  -- 기기 원본과의 대조용. 원본 자체는 서버에 없다.
  source_sha256 text,
  source_w      integer,
  source_h      integer,
  source_bytes  bigint,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 1,

  -- ★ 강제 조항 3개. 이걸 지우면 플앱과 같은 길을 간다.
  CONSTRAINT thumb_bytes_small CHECK (thumb IS NULL OR octet_length(thumb) <= 32768),
  CONSTRAINT thumb_dim_small   CHECK (thumb_w IS NULL OR (thumb_w <= 320 AND thumb_h <= 320)),
  CONSTRAINT thumb_all_or_none CHECK ((thumb IS NULL) = (thumb_w IS NULL))
);
CREATE INDEX idx_media_att ON attendance_media (attendance_id, kind, page_no);
-- SQLite: bytea → BLOB, octet_length → length. CHECK 는 그대로 동작한다.
-- [RLS] attendance_media: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- local_photos — ⚠ **로컬 기기에만 존재하는 테이블.**
--   Postgres 에는 만들지 않는다. 여기 정의를 둔 이유는
--   "원본이 어디 있는지"를 스키마 문서 한 곳에서 다 보기 위해서다.
--   서버 마이그레이션 러너는 이 블록을 건너뛰어야 한다.
-- ---------------------------------------------------------------------
/* LOCAL-ONLY — DO NOT APPLY TO POSTGRES
CREATE TABLE local_photos (
  id            TEXT PRIMARY KEY,              -- uuidv7
  media_id      TEXT,                          -- attendance_media.id 와 짝. 서버로 올라가는 건 저쪽뿐
  attendance_id TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- ticket|program_book|seat_view|other
  file_uri      TEXT NOT NULL,                 -- 앱 문서 디렉터리 경로 또는 PHAsset localIdentifier
  sha256        TEXT,
  width         INTEGER, height INTEGER, bytes INTEGER,
  captured_at   INTEGER,
  created_at    INTEGER NOT NULL,
  -- 기기 갤러리에서 원본이 사라졌는지 감지 (사용자에게 알려야 한다)
  last_seen_at  INTEGER
);
CREATE INDEX idx_localphotos_att ON local_photos (attendance_id);
*/


-- ---------------------------------------------------------------------
-- my_moments — ★ 사용자가 찍은 하이라이트 (WORK_TAGGING §10)
--   두 종류가 한 테이블에 있다:
--     (a) 실황: program_item_id + note ("3악장이 좋았다")
--     (b) 음원: video_id + at_seconds  ⚠ 반드시 묶어서 저장. 초만 따로 쓰면 틀린다
--        (영상마다 시작 오프셋이 다르다)
-- ---------------------------------------------------------------------
CREATE TABLE my_moments (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  attendance_id   uuid REFERENCES attendances(id) ON DELETE CASCADE,
  program_item_id uuid REFERENCES program_items(id),
  work_id         text REFERENCES works(id),
  video_id        text,                        -- YouTube video id
  at_seconds      integer,
  note            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  rev             bigint NOT NULL DEFAULT 1,
  -- ★ 초만 있고 영상이 없는 값은 의미가 없다. 스키마가 막는다.
  CONSTRAINT moment_video_pair CHECK ((video_id IS NULL) = (at_seconds IS NULL)),
  CONSTRAINT moment_anchored   CHECK (attendance_id IS NOT NULL OR work_id IS NOT NULL)
);
CREATE INDEX idx_moments_att  ON my_moments (attendance_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_moments_user ON my_moments (user_id, created_at DESC) WHERE deleted_at IS NULL;
-- [RLS] my_moments: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- feedback — 추천에 대한 좋아요/싫어요 (이중 트랙)
--   ⚠ concert_id 는 더미가 아니라 **실제 추천된 공연**이다 (ARCHITECTURE §1-1)
-- ---------------------------------------------------------------------
CREATE TABLE feedback (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  concert_id    uuid REFERENCES concerts(id),
  attendance_id uuid REFERENCES attendances(id),  -- 관람 후 피드백이면 채운다
  recommendation_id text,                      -- 어느 추천 세션에서 나온 카드인가
  liked         boolean NOT NULL,
  signals       jsonb NOT NULL DEFAULT '{}',   -- {"composer":{"Rachmaninoff":1},"forces":{"concerto":1},"performer":{"<uuid>":1}}
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 1
);
CREATE INDEX idx_feedback_user ON feedback (user_id, created_at DESC) WHERE deleted_at IS NULL;
-- [RLS] feedback: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- taste_profile — 롤링 취향 요약. **쓰기 시점에 갱신**한다 (ARCHITECTURE §4-2 B1)
--   읽기 경로에서는 이 한 행만 LLM 에 주입한다. 이력이 쌓여도 토큰이 상수다.
-- ---------------------------------------------------------------------
CREATE TABLE taste_profile (
  user_id       uuid PRIMARY KEY,
  summary_ko    text NOT NULL,                 -- ≤300 토큰
  boosts        jsonb NOT NULL DEFAULT '{}',   -- {"forces":{...},"performers":{...},"mood":{...},"seat":{...}}
  axis_weights  jsonb NOT NULL DEFAULT '{}',   -- WORK_TAGGING §7: 이 사용자에게 예측력 있는 축
  sample_n      integer NOT NULL DEFAULT 0,    -- 표본 수. 적으면 UI 톤을 단정→관찰로 낮춘다
  version       integer NOT NULL DEFAULT 1,    -- profiles.version 과 함께 캐시 키를 이룬다
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- [RLS] taste_profile: user_id = auth.uid(). 보안 담당 작성.


-- ---------------------------------------------------------------------
-- id_redirects — 병합 리다이렉트 (MusicBrainz gid_redirect 패턴)
--
--   왜 필요한가: 오프라인에서 두 기기가 같은 연주자/공연을 각각 만든다.
--   나중에 중복임을 알고 병합할 때, 진 쪽 id 를 그냥 지우면
--   그 id 를 참조하던 다른 기기의 로컬 데이터가 고아가 된다.
--   툼스톤은 "없어졌다"만 말하고 "어디로 갔다"를 말하지 못한다.
--
--   MusicBrainz 는 artist_gid_redirect / recording_gid_redirect … 를 두고
--   "본 테이블 조회 → 없으면 redirect 조회" 2단계로 옛 MBID 를 영원히 살린다.
--   우리는 엔티티별 테이블 대신 entity 컬럼 하나로 합친다 (테이블 1개 vs 5개).
-- ---------------------------------------------------------------------
CREATE TABLE id_redirects (
  entity      text NOT NULL CHECK (entity IN ('performer','concert','work','venue','composer','attendance')),
  old_id      text NOT NULL,                  -- 병합돼 사라진 id (uuid 또는 슬러그라 text)
  new_id      text NOT NULL,                  -- 살아남은 id
  merged_at   timestamptz NOT NULL DEFAULT now(),
  merged_by   text,                           -- 'user' | 'dedupe_job'
  PRIMARY KEY (entity, old_id)
);
CREATE INDEX idx_redirects_new ON id_redirects (entity, new_id);


-- ---------------------------------------------------------------------
-- sync_clients — 기기별 업로드 워터마크 (Replicache lastMutationID 패턴)
--   서버가 기기마다 "여기까지 받았다" 정수 하나만 들고 있으면
--   재전송된 변경을 조회 없이 버릴 수 있다.
--   처리한 변경 ID 를 전부 모아두는 방식(processed_messages)은 무한히 커진다.
-- ---------------------------------------------------------------------
CREATE TABLE sync_clients (
  user_id          uuid NOT NULL,
  device_id        text NOT NULL,
  last_mutation_id bigint NOT NULL DEFAULT 0,  -- 이 기기에서 받은 outbox.seq 최고값
  platform         text,
  app_version      text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
-- [RLS] sync_clients: user_id = auth.uid(). 보안 담당 작성.


-- #####################################################################
--  LAYER 4 — 동기화 인프라 (⚠ 로컬 기기에만 존재)
-- #####################################################################
/* LOCAL-ONLY — DO NOT APPLY TO POSTGRES

-- outbox: 오프라인에서 만든 변경을 순서대로 밀어올린다.
CREATE TABLE outbox (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,  -- 로컬 순서. 서버로 안 간다
  op            TEXT NOT NULL,                 -- upsert | delete
  entity        TEXT NOT NULL,                 -- 'attendances' | 'attendance_seat' | ...
  entity_id     TEXT NOT NULL,                 -- uuidv7
  payload       TEXT,                          -- JSON 스냅샷 (delete 면 NULL)
  changed_cols  TEXT,                          -- JSON 배열. 필드 단위 병합용 (WatermelonDB _changed 패턴)
  base_rev      INTEGER,                       -- 이 변경이 본 rev. 서버가 충돌 판정에 쓴다
  idem_key      TEXT NOT NULL,                 -- entity_id + rev. 재전송해도 중복 적용 안 되게
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_try_at   INTEGER NOT NULL DEFAULT 0,    -- 지수 백오프
  last_error    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_outbox_ready ON outbox (next_try_at, seq);
CREATE UNIQUE INDEX uq_outbox_idem ON outbox (idem_key);

-- sync_state: 테이블별 델타 커서
CREATE TABLE sync_state (
  entity        TEXT PRIMARY KEY,
  last_pulled_at INTEGER NOT NULL DEFAULT 0,   -- 서버 updated_at 워터마크
  last_pushed_seq INTEGER NOT NULL DEFAULT 0,  -- 서버 sync_clients.last_mutation_id 와 짝
  device_id     TEXT NOT NULL,                 -- 설치 시 1회 생성. LWW tie-break 에도 쓰인다
  full_resync_needed INTEGER NOT NULL DEFAULT 0 -- 툼스톤 보존기간 초과로 델타를 못 믿을 때 1
);
*/

-- 툼스톤 GC (서버 배치, 90일):
--   DELETE FROM attendances WHERE deleted_at < now() - interval '90 days';
--   ⚠ 반드시 함께 해야 하는 것: 마지막 동기화가 90일보다 오래된 기기는
--     델타 pull 을 주지 말고 full resync 를 시킨다. 안 그러면 삭제를 놓친 기기가
--     지운 행을 되살린다(zombie). 판정은 sync_clients.last_seen_at 으로 한다.


-- #####################################################################
--  뷰 — 통계와 CSV 내보내기
--  ★ 내보내기를 "나중에 붙이는 기능"이 아니라 스키마의 일부로 둔다.
--    이 카테고리의 사망 원인 1위가 데이터 유실이다 (COMPETITIVE_RESEARCH P0-1).
--    아래 두 뷰를 그대로 CSV 로 떨구면 사용자가 자기 데이터를 통째로 들고 나갈 수 있다.
-- #####################################################################

-- 관람 1건 = CSV 1행. 사람이 스프레드시트에서 바로 읽을 수 있어야 한다.
CREATE VIEW v_export_attendance AS
SELECT
  a.id                                  AS attendance_id,
  a.user_id,
  a.attended_on,
  c.title                               AS concert_title,
  coalesce(v.display_name, c.venue_raw) AS venue,
  c.region,
  c.start_time,
  c.program_arch,
  -- 헤드라이너를 한 칸에 (CSV 는 조인을 못 한다)
  (SELECT string_agg(coalesce(p.name_ko, p.name_en) || '(' || cr.role || ')', ' / ' ORDER BY cr.billing_order NULLS LAST)
     FROM credits cr JOIN performers p ON p.id = cr.performer_id
    WHERE cr.concert_id = c.id AND cr.is_headliner)                AS headliners,
  (SELECT string_agg(coalesce(p.name_ko, p.name_en), ' / ')
     FROM credits cr JOIN performers p ON p.id = cr.performer_id
    WHERE cr.concert_id = c.id AND cr.role = 'conductor')          AS conductors,
  (SELECT string_agg(coalesce(p.name_ko, p.name_en), ' / ')
     FROM credits cr JOIN performers p ON p.id = cr.performer_id
    WHERE cr.concert_id = c.id AND cr.role = 'orchestra')          AS orchestras,
  (SELECT string_agg(pi.raw_text, ' | ' ORDER BY pi.seq)
     FROM program_items pi
    WHERE pi.concert_id = c.id AND pi.item_type = 'work' AND NOT pi.is_encore) AS program,
  (SELECT string_agg(pi.raw_text, ' | ' ORDER BY pi.encore_order)
     FROM program_items pi
    WHERE pi.concert_id = c.id AND pi.is_encore)                   AS encores,
  s.raw                                 AS seat_raw,
  s.floor, s.block, s.row_num, s.seat_num, s.grade,
  s.acoustic_rating, s.acoustic_note,
  a.price_paid,
  a.chosen_reason,
  a.chosen_reason_note,
  a.rating,
  a.one_liner,
  a.note,
  a.created_at
FROM attendances a
LEFT JOIN concerts c        ON c.id = a.concert_id
LEFT JOIN venues   v        ON v.id = c.venue_id
LEFT JOIN attendance_seat s ON s.attendance_id = a.id
WHERE a.deleted_at IS NULL;

-- 곡 1개 = CSV 1행. 취향 분석의 원재료를 사용자도 볼 수 있게.
CREATE VIEW v_export_program AS
SELECT
  a.id AS attendance_id, a.user_id, a.attended_on,
  c.title AS concert_title,
  pi.seq, pi.item_type, pi.is_encore, pi.encore_order,
  pi.raw_text,
  cm.name_ko AS composer_ko, cm.name_en AS composer_en,
  w.title_ko, w.title_en, w.catalog, w.catalog_no,
  w.forces, w.soloist_inst, w.scale, w.subject, w.texture, w.life_phase, w.rarity,
  pi.arranger,
  pi.source, pi.match_conf,
  (SELECT string_agg(coalesce(p.name_ko, p.name_en) || '(' || coalesce(cr.instrument, cr.role) || ')', ' / ')
     FROM credits cr JOIN performers p ON p.id = cr.performer_id
    WHERE cr.program_item_id = pi.id)   AS item_performers
FROM attendances a
JOIN concerts      c  ON c.id = a.concert_id
JOIN program_items pi ON pi.concert_id = c.id
LEFT JOIN works     w  ON w.id = pi.work_id
LEFT JOIN composers cm ON cm.id = w.composer_id
WHERE a.deleted_at IS NULL;

-- 통계 화면 전용 (ARCHITECTURE §4-4 D3: statistics 는 LLM 없이 SQL 한 방)
CREATE VIEW v_my_performers AS
SELECT a.user_id, cr.performer_id, p.name_ko, p.name_en, p.kind, cr.role,
       count(*) AS times, max(a.attended_on) AS last_seen
FROM attendances a
JOIN credits    cr ON cr.concert_id = a.concert_id
JOIN performers p  ON p.id = cr.performer_id
WHERE a.deleted_at IS NULL
GROUP BY a.user_id, cr.performer_id, p.name_ko, p.name_en, p.kind, cr.role;

CREATE VIEW v_my_forces AS
SELECT a.user_id, w.forces, w.soloist_inst, count(*) AS times
FROM attendances a
JOIN program_items pi ON pi.concert_id = a.concert_id AND pi.item_type = 'work'
JOIN works         w  ON w.id = pi.work_id
WHERE a.deleted_at IS NULL
GROUP BY a.user_id, w.forces, w.soloist_inst;


-- #####################################################################
--  마이그레이션 관리
-- #####################################################################
CREATE TABLE schema_migrations (
  version     integer PRIMARY KEY,
  name        text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);
INSERT INTO schema_migrations (version, name) VALUES (1, 'initial');
-- SQLite: Drift 가 PRAGMA user_version 을 쓴다. 두 값을 같은 번호로 맞춰 둘 것.


-- #####################################################################
--  v2 예약 — 지금 만들지 않는다
-- #####################################################################

-- work_innovations (WORK_TAGGING §9)
--   COMPETITIVE_RESEARCH §6-5 판정: **v1 에서 빼라.**
--   이유 (요약): 이 프로젝트에서 곡당 실비가 드는 유일한 항목이고, 근거 URL 까지
--   요구해 가장 비싸며, 실측한 클래식 후기 어디에도 "이 작품이 무엇을 깼는가"가
--   등장하지 않는다. 같은 §9 의 performerRarity 는 계산값이라 공짜다 → works.rarity 로 이미 넣었다.
--   필요해지면 아래를 그대로 실행하면 된다. 다른 테이블은 손댈 필요가 없다.
/*
CREATE TABLE work_innovations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     text NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('instrument','form','harmony','orchestration','genre','other')),
  text_ko     text NOT NULL,
  evidence    jsonb NOT NULL DEFAULT '[]',
  confidence  real,
  tagged_by   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_innov_work ON work_innovations (work_id);
*/

-- 임베딩 (ARCHITECTURE §4-1 하이브리드 검색)
--   주축은 태그, 보조가 임베딩이다 (WORK_TAGGING §5). 순서를 뒤집지 말 것.
/*
ALTER TABLE works    ADD COLUMN embedding vector(768);
ALTER TABLE concerts ADD COLUMN embedding vector(768);
CREATE INDEX idx_works_emb ON works USING hnsw (embedding vector_cosine_ops);
*/

-- 공개 커뮤니티 / 소셜 피드
--   COMPETITIVE_RESEARCH §6-7: v2 이후. visibility 컬럼만 미리 넣어 뒀다.
