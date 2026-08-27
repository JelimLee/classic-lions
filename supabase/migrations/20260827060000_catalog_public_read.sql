-- ---------------------------------------------------------------------------
-- 카탈로그 공개 읽기 + 개인 테이블 전면 차단
-- ---------------------------------------------------------------------------
-- 전제: 프로젝트 설정에서
--   · Data API                     = ON   (앱이 카탈로그를 직접 읽는다)
--   · Automatically expose tables  = OFF  (새 테이블이 저절로 열리지 않는다)
--   · Automatic RLS                = ON   (새 테이블은 기본 차단으로 생긴다)
--
-- 이 마이그레이션은 그 위에서 **명시적으로 연 것만** 열린다는 것을 보장한다.
-- CVE-2025-48757 (Supabase 프로젝트 1,645개 중 170개가 RLS 누락으로
-- 이름·이메일·서드파티 API 키까지 노출) 이 이 파일이 존재하는 이유다.
--
-- 분류 기준은 "user_id / profile_id 컬럼이 있는가" 다.
--   없다 → 카탈로그. 쇼팽 녹턴이 1835년 작이라는 건 누구에게나 같은 사실이고
--          개인정보가 아니다. 로그인 없이 읽어도 된다.
--   있다 → 개인 기록. v1 에서는 서버에 올라가지 않지만, 테이블은 미리 있으므로
--          **정책을 하나도 만들지 않아** 전면 차단 상태로 둔다.
-- ---------------------------------------------------------------------------

-- 로컬 Postgres 에는 anon/authenticated 롤이 없다. 검증용으로 만들어 준다.
-- Supabase 에는 이미 있으므로 아무 일도 하지 않는다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;


-- ===========================================================================
-- 1. 전 테이블 RLS 강제
-- ===========================================================================
-- 정책이 없으면 0행이 반환된다. 기본값이 "차단" 이어야 한다.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- ===========================================================================
-- 2. 기본 권한 회수
-- ===========================================================================
-- 무엇을 열지 정하기 전에 전부 닫는다. 순서가 중요하다.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;


-- ===========================================================================
-- 3. 카탈로그 7개만 공개 읽기
-- ===========================================================================
-- 여기 없는 테이블은 열리지 않는다. 추가하려면 이 목록을 고쳐야 하고,
-- 그 행위 자체가 "이게 정말 공개해도 되는 데이터인가" 를 묻게 만든다.
--
-- 제외한 것:
--   id_redirects, schema_migrations  → 내부 기계 장치. 공개 이유 없음
--   attendances, attendance_seat, attendance_media, my_moments,
--   feedback, taste_profile, profiles, sync_clients → 개인 기록
DO $$
DECLARE
  t text;
  catalog_tables text[] := ARRAY[
    'composers',
    'works',
    'performers',
    'venues',
    'concerts',
    'program_items',
    'credits'
  ];
BEGIN
  FOREACH t IN ARRAY catalog_tables LOOP
    -- 테이블이 실제로 있는지 확인 (스키마가 바뀌어도 조용히 실패하지 않게)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION '카탈로그 테이블 %가 없다. 목록과 스키마가 어긋났다.', t;
    END IF;

    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS "catalog_public_read" ON public.%I
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "catalog_public_read" ON public.%I
        FOR SELECT TO anon, authenticated USING (true)
    $f$, t);
  END LOOP;
END $$;


-- ===========================================================================
-- 4. 쓰기는 아무에게도 열지 않는다
-- ===========================================================================
-- 카탈로그 적재는 service_role(마이그레이션·시드 스크립트)만 한다.
-- service_role 은 RLS 를 우회하므로 정책이 필요 없다.
-- ⚠️ service_role 키는 절대 클라이언트에 넣지 않는다.


-- ===========================================================================
-- 5. 검증 — 의도와 실제가 어긋나면 마이그레이션을 실패시킨다
-- ===========================================================================
DO $$
DECLARE
  leaked text;
  unprotected text;
BEGIN
  -- (a) 카탈로그가 아닌데 anon 이 읽을 수 있는 테이블
  SELECT string_agg(table_name, ', ') INTO leaked
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND grantee = 'anon'
    AND privilege_type = 'SELECT'
    AND table_name NOT IN (
      'composers','works','performers','venues','concerts','program_items','credits'
    );

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION '카탈로그가 아닌 테이블이 anon 에게 열려 있다: %', leaked;
  END IF;

  -- (b) RLS 가 꺼진 테이블
  SELECT string_agg(c.relname, ', ') INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS 가 꺼진 테이블이 있다: %', unprotected;
  END IF;

  RAISE NOTICE '검증 통과 — 카탈로그 7개만 공개, 나머지 전면 차단';
END $$;
