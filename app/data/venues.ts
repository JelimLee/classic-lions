/**
 * venues.ts — 공연장 좌석 구조 프로필 (순수 데이터 + 순수 함수)
 *
 * ⚠️ 브라우저 API 의존 금지 (document/canvas/window). `ocrSchema.ts`와 같은 규칙.
 *    Node에서 그대로 import 되어야 한다.
 *
 * 범위: 사용자가 실제로 다니는 두 홀만 담는다.
 *   - 롯데콘서트홀 (잠실, 빈야드)
 *   - 예술의전당 콘서트홀 (서초, 빈야드)
 *
 * ─────────────────────────────────────────────────────────────────────
 * confidence 필드의 의미 (반드시 읽을 것)
 * ─────────────────────────────────────────────────────────────────────
 * 신뢰도는 **필드별로 다르다**. 그래서 블록마다 `conf` 객체가 붙는다:
 *   conf.existence / conf.rows / conf.seatCount / conf.geometry / conf.tier
 *
 * 레거시 `confidence` 는 worstOf(existence, rows, geometry) 로 **자동 계산**된다.
 * seatCount·tier 는 일부러 뺐다 (아래 참고). 자세한 건 BlockConfidence 주석.
 *
 *   'confirmed' : 공연장 공식 좌석배치도 원본(이미지/공식 페이지 텍스트)에서
 *                 직접 읽었다. 블로그·예매처 2차 자료가 아니다.
 *   'inferred'  : 공식 자료에서 직접 읽지 못했고, 대칭성·구조상 추론했다.
 *   'unknown'   : 모른다. 관련 수치 필드는 null 이다.
 *
 * ⚠️ `tier` 는 **모든 블록에서 예외 없이 추론값이다.**
 *    공식 좌석배치도는 전부 평면도(plan view)라서 높이 정보가 없다.
 *    tier 는 "평면도상 무대/객석 중심에서 바깥으로 갈수록 높아진다"는
 *    빈야드 홀의 일반 원리로 내가 매긴 순서일 뿐이다.
 *    → 단면도에서 블록의 **좌우(무대로부터의 거리) 위치는 신뢰해도 되지만,
 *      위아래(높이) 위치는 근사다.** 이 사실을 UI에 반영할 것.
 *
 * ⚠️ `seatCount` 는 대부분 null 이다. 두 공연장 모두 **구역별 좌석수를
 *    공식적으로 공개하지 않는다.** 배치도 이미지에서 좌석 아이콘을 자동
 *    계수해봤으나 검증(층 합계 대조)에 실패해서 폐기했다. 지어내지 않았다.
 *
 * 출처는 SOURCES 상수와 docs/SEATMAP_geometry.md 참고.
 */

/* ------------------------------------------------------------------ *
 * 타입
 * ------------------------------------------------------------------ */

export type BlockPosition =
  | 'front'
  | 'mid'
  | 'rear'
  | 'side-left'
  | 'side-right'
  | 'behind-stage';

export type Confidence = 'confirmed' | 'inferred' | 'unknown';

/**
 * 필드별 신뢰도.
 *
 * 한 블록 안에서도 항목마다 근거의 質이 다르다. 예를 들어 롯데 1층 P구역은
 * "존재한다/1~6열이다"는 공식 배치도에서 그대로 읽었지만, 좌석수 167석은
 * 내가 배치도 아이콘을 센 값이고, tier(높이 단)는 어느 자료에도 없다.
 * 그걸 통째로 'confirmed' 하나로 뭉개면 거짓말이 된다.
 */
export interface BlockConfidence {
  /** 이 층에 이 코드의 블록이 존재한다 */
  existence: Confidence;
  /** rowMin / rowMax */
  rows: Confidence;
  /** seatCount */
  seatCount: Confidence;
  /** position + rowAxis + seatAxis + seatDepthDir (평면상 배치와 축 방향) */
  geometry: Confidence;
  /** tier (무대 바닥 기준 높이 단) */
  tier: Confidence;
}

export interface VenueBlock {
  /** 티켓에 인쇄되는 구역/블록 코드. 대문자 정규화된 형태. */
  code: string;
  floor: number;
  /** 확인 못 했으면 null */
  rowMin: number | null;
  rowMax: number | null;
  seatCount: number | null;
  position: BlockPosition;
  /**
   * 빈야드 단(段). 무대 바닥에 가까울수록 낮은 값. 0 = 무대 높이.
   * ⚠️ 전부 추론값이다 (conf.tier === 'inferred'). 파일 상단 주석 참고.
   */
  tier: number;
  /**
   * 레거시 종합 신뢰도. **worstOf(conf.existence, conf.rows, conf.geometry)** 로
   * 자동 계산된다 — 손으로 쓰지 않는다.
   *
   * seatCount 와 tier 는 여기 안 들어간다. seatCount 는 대부분 아예 없고(null),
   * tier 는 예외 없이 전부 추론이라 섞으면 모든 블록이 한 등급 내려가서
   * 정보가 사라지기 때문이다. 그 둘은 `conf` 에서 따로 읽어라.
   */
  confidence: Confidence;
  /** 필드별 신뢰도. 이쪽이 진짜다. */
  conf: BlockConfidence;
  /** 어디서 왔는지 한 줄 */
  sourceNote: string;
  /**
   * 열 번호가 "무대로부터의 거리"가 아니라 "터레이스 높이"를 뜻하는 구역.
   * 롯데 L/R/LP/RP 같은 측면 단(段) 블록이 여기 해당한다.
   * 이런 블록에서는 열 번호로 깊이를 계산하면 안 된다.
   */
  rowAxis: 'depth' | 'height';
  /** 좌석 번호가 커질수록 무대에서 멀어지는가 (rowAxis==='height' 블록에서 의미 있음) */
  seatAxis: 'lateral' | 'depth';
  /**
   * seatAxis === 'depth' 일 때만 의미 있다.
   * 좌석 번호가 커질 때 무대에서 **멀어지면** 'away', **가까워지면** 'toward'.
   *
   * ⚠️ 좌우가 대칭이라고 방향까지 같지 않다. 예당은 좌석 번호를 평면도 기준
   *    왼→오른쪽으로 매기기 때문에, 무대를 감아 도는 팔 모양 블록에서는
   *    왼쪽(2층 A)과 오른쪽(2층 E)의 깊이 방향이 서로 **반대**다.
   */
  seatDepthDir: 'away' | 'toward' | null;
}

/** 신뢰도를 손으로 안 쓰기 위한 입력 타입 */
type BlockSpec = Omit<VenueBlock, 'confidence'>;

const CONF_RANK: Record<Confidence, number> = {
  unknown: 0,
  inferred: 1,
  confirmed: 2,
};

function worstOf(...cs: Confidence[]): Confidence {
  return cs.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a), 'confirmed');
}

/** BlockSpec → VenueBlock. 레거시 confidence 를 파생시킨다. */
function seal(specs: BlockSpec[]): VenueBlock[] {
  return specs.map((b) => ({
    ...b,
    confidence: worstOf(b.conf.existence, b.conf.rows, b.conf.geometry),
  }));
}

export interface VenueFloor {
  floor: number;
  seatCount: number | null;
  label: string;
}

export interface VenueProfile {
  id: 'lotte-concert-hall' | 'sac-concert-hall';
  nameKo: string;
  /**
   * OCR venue 문자열 매칭용 **강한** 별칭. 소문자·공백제거 후 부분문자열로 비교된다.
   * 이 별칭 하나만 들어있어도 그 홀이라고 믿을 만큼 특정적이어야 한다.
   */
  aliases: string[];
  /**
   * **약한** 별칭 — '콘서트홀', '음악당' 처럼 전국 아무 공연장에나 붙는 말.
   * 부분문자열 매칭을 허용하면 '통영국제음악당 콘서트홀'까지 빨아들인다.
   * 그래서 이건 문자열 **전체**가 (층/열/번 같은 잡음을 뺀 뒤) 이 별칭과
   * 같을 때만 매칭된다.
   */
  weakAliases: string[];
  blockTerm: '구역' | '블록';
  totalSeats: number;
  floors: VenueFloor[];
  blocks: VenueBlock[];
  /** 무대 뒤(합창석) 블록 코드 */
  behindStageBlocks: string[];
  /** 사람이 읽는 구조 요약 — 디버그/툴팁용 */
  shapeNote: string;
}

/* ------------------------------------------------------------------ *
 * 롯데콘서트홀
 * ------------------------------------------------------------------ *
 *
 * 공식 좌석배치도 원본 이미지를 내려받아 직접 판독했다.
 *   1층 https://www.lotteconcerthall.com/images/sub/img_info_seat_gak01.png  (708×940)
 *   2층 https://www.lotteconcerthall.com/images/sub/img_info_seat_gak02.png  (653×934)
 *   → docs/seatmaps/lotte_1f.png, lotte_2f.png 에 보관
 *
 * 구역 목록은 공식 "게이트안내" 페이지가 층별로 명시하고 있어서 교차 검증됐다.
 *   1층: A / B / C / D / E / L / LP / P / R / RP   (P는 "왼쪽 P/오른쪽 P"로 입장 안내)
 *   2층: A / B / C / D / E / L / R                 (2층에는 P·LP·RP 가 없다)
 * 게이트 안내가 "1-16열 B,C구역" / "17-23열 B,C구역"으로 나뉘어 있어
 * B·C·D 의 열 범위 1~23 이 공식적으로 확인된다.
 *
 * 평면도상 좌우 배치 (무대를 위쪽에 두고 객석을 아래에서 본 그림 기준):
 *   A(맨 왼쪽) B C(정중앙) D E(맨 오른쪽)  ← 알파벳이 좌→우 순서다.
 *   ⚠️ 선행 리서치가 인용한 "A=앞쪽 1~8열, B=9~16열" 식 깊이밴드 서술은
 *      공식 배치도와 맞지 않는다. 그 서술은 채택하지 않았다.
 */

const LOTTE_BLOCKS: BlockSpec[] = [
  /* ---- 1층: 무대 뒤 (합창석 영역) ---- */
  {
    code: 'P',
    floor: 1,
    rowMin: 1,
    rowMax: 6,
    seatCount: 167,
    position: 'behind-stage',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'inferred', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 직접 판독. 무대 정후면, 바로 뒤에 파이프오르간(공식 페이지 명시). 1열이 무대에 가장 가깝고 6열이 가장 높다. 1~3열과 4~6열 사이에 단차(계단)가 있다. 열별 최대 좌석번호 29/30/30/25/26/27 → 합 167석(내가 센 값, inferred).',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'LP',
    floor: 1,
    rowMin: 1,
    rowMax: 9,
    seatCount: null,
    position: 'behind-stage',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 직접 판독. 무대 뒤~왼쪽 사이 곡면 터레이스. 열 번호가 안쪽(1)→바깥쪽(9)으로 올라간다. 한 열 최대 좌석번호 17 내외.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'RP',
    floor: 1,
    rowMin: 1,
    rowMax: 9,
    seatCount: null,
    position: 'behind-stage',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'inferred', tier: 'inferred' },
    sourceNote: '공식 1층 배치도 직접 판독. LP의 오른쪽 대칭.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },

  /* ---- 1층: 측면 터레이스 ---- */
  {
    code: 'L',
    floor: 1,
    rowMin: 1,
    rowMax: 7,
    seatCount: null,
    position: 'side-left',
    tier: 2,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 직접 판독. 무대 왼쪽 옆 단(段). ⚠️ 열 번호가 깊이가 아니라 높이다 — 1열이 객석 중앙 쪽(가장 낮음), 7열이 벽 쪽(가장 높음). 좌석 번호가 커질수록 무대에서 멀어진다(한 열 최대 17~18번).',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'R',
    floor: 1,
    rowMin: 1,
    rowMax: 7,
    seatCount: null,
    position: 'side-right',
    tier: 2,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 확대 판독 — 열 라벨 1~7을 이 블록에서 직접 읽었다(L 쪽은 라벨이 흐려서, 실은 R 이 1~7 열 범위의 1차 근거다). 1열이 객석 중앙 쪽, 7열이 벽 쪽.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },

  /* ---- 1층: 정면 객석 (스톨) ---- */
  {
    code: 'A',
    floor: 1,
    rowMin: 1,
    rowMax: 16,
    seatCount: null,
    position: 'side-left',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 직접 판독. 정면 객석 중 **맨 왼쪽** 쐐기형 구역. 1열이 무대에 가장 가깝고 좌석이 1석뿐(쐐기 끝), 뒤로 갈수록 넓어져 16열에서 14석 내외. B~D와 열 번호 체계가 다르다(16열까지).',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'B',
    floor: 1,
    rowMin: 1,
    rowMax: 23,
    seatCount: null,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 + 공식 게이트안내("1-16열 B,C구역" / "17-23열 B,C구역")로 열 범위 이중 확인. C 왼쪽의 좁은 띠(열당 4~11석). ⚠️ 1~23 안에 **구멍이 있다**: 8·16·17·18열에는 B 좌석이 없고 그 열은 C만 있다(배치도 직접 판독). rowMin/rowMax 만 보고 열을 균등 배분하면 안 된다.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'C',
    floor: 1,
    rowMin: 1,
    rowMax: 23,
    seatCount: null,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 + 게이트안내로 열 범위 이중 확인. 무대 정면 **정중앙** 구역. 1~8열 / 9~16열 / 17~23열 세 단으로 나뉜다(배치도상 단차선). 열당 12~21석. 23열에 음향조종장치가 설치될 수 있다(공식 명시).',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'D',
    floor: 1,
    rowMin: 1,
    rowMax: 23,
    seatCount: null,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 1층 배치도 + 게이트안내. B의 오른쪽 대칭. B와 똑같이 8·16·17·18열에 좌석이 없다.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'E',
    floor: 1,
    rowMin: 1,
    rowMax: 16,
    seatCount: null,
    position: 'side-right',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 1층 배치도 직접 판독. A의 오른쪽 대칭(맨 오른쪽 쐐기형).',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },

  /* ---- 2층 ---- */
  {
    code: 'L',
    floor: 2,
    rowMin: 1,
    rowMax: 2,
    seatCount: null,
    position: 'side-left',
    tier: 5,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 2층 배치도 직접 판독(확대해서 열 라벨 1·2를 눈으로 확인). 무대 옆까지 길게 뻗은 **2열짜리** 좁은 측면 발코니. 열 번호는 깊이가 아니라 안(1)/바깥(2)이고, **깊이는 좌석 번호**다 — 1번이 무대에 가장 가깝고 번호가 커질수록 멀어진다(최소 34번까지 확인, 끝번호는 미확정이라 seatCount 는 null).',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'R',
    floor: 2,
    rowMin: 1,
    rowMax: 2,
    seatCount: null,
    position: 'side-right',
    tier: 5,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 2층 배치도 직접 판독. 2층 L의 오른쪽 대칭. 깊이는 좌석 번호로 읽는다.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'A',
    floor: 2,
    rowMin: 1,
    rowMax: 6,
    seatCount: null,
    position: 'rear',
    tier: 6,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 2층 배치도 직접 판독. 홀 맨 뒤 발코니의 왼쪽 끝 쐐기. 열당 최대 11석 내외.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'B',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: null,
    position: 'rear',
    tier: 6,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 2층 배치도 직접 판독. 2층 C 왼쪽. 열당 4~10석.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'C',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: null,
    position: 'rear',
    tier: 6,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 2층 배치도 직접 판독. 홀 맨 뒤 정중앙. 열당 18~21석. 무대에서 가장 먼 정면 좌석.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'D',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: null,
    position: 'rear',
    tier: 6,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 2층 배치도 직접 판독. 2층 B의 오른쪽 대칭.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'E',
    floor: 2,
    rowMin: 1,
    rowMax: 6,
    seatCount: null,
    position: 'rear',
    tier: 6,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'unknown', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 2층 배치도 직접 판독. 2층 A의 오른쪽 대칭.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
];

const LOTTE: VenueProfile = {
  id: 'lotte-concert-hall',
  nameKo: '롯데콘서트홀',
  aliases: [
    '롯데콘서트홀',
    '롯데 콘서트홀',
    '롯데콘서트 홀',
    '롯데월드타워 콘서트홀',
    '롯데문화재단 롯데콘서트홀',
    'LOTTE CONCERT HALL',
    'LOTTE CONCERTHALL',
    'Lotte Concert Hall',
    '롯콘',
    '잠실 롯데콘서트홀',
    '롯데콘서트홀 표준좌석', // 초대교환권에 인쇄되는 문자열
  ],
  // 롯데콘서트홀은 단일 홀이다. 같은 건물(롯데월드몰/타워)의 다른 공간은
  // 이름에 '콘서트홀'이 안 들어가서 위 별칭에 애초에 안 걸린다.
  weakAliases: [],
  blockTerm: '구역',
  totalSeats: 2036,
  floors: [
    { floor: 1, seatCount: 1538, label: '객석 1층' },
    { floor: 2, seatCount: 498, label: '객석 2층' },
  ],
  blocks: seal(LOTTE_BLOCKS),
  behindStageBlocks: ['P', 'LP', 'RP'],
  shapeNote:
    '빈야드(포도밭). 무대가 홀 중앙에 있고 객석이 무대를 360° 둘러싼다. 1층은 정면 스톨(A~E) + 측면 단(L/R) + 무대 뒤(P/LP/RP). 2층은 무대 뒤가 없고, 긴 측면 발코니(L/R 2열)와 홀 맨 뒤 발코니(A~E)만 있다. 총 2,036석(휠체어 22석 포함).',
};

/* ------------------------------------------------------------------ *
 * 예술의전당 콘서트홀
 * ------------------------------------------------------------------ */

/*
 * 데이터 출처: 예술의전당 공식 「콘서트홀 좌석배치도」 엑셀
 *   https://www.sac.or.kr/site/main/file/download/764810
 *   (ticketPlaceMusichall 페이지의 "[콘서트홀 좌석배치도]" 링크, 2021년판)
 *   → docs/seatmaps/sac_official_ConcertHallSeatingPlan_2021.xls
 *
 * 이 엑셀은 셀 하나가 좌석 하나인 **실물 좌석 격자**다. 그래서 블록별 열 범위·
 * 열별 좌석수·최대 좌석번호를 전부 직접 셀 수 있었다.
 *
 * ✅ 검증: 내가 격자에서 센 블록별 좌석수가 같은 파일의 공식 요약표와
 *    **21개 블록 전부 정확히 일치**한다 (A 210 / B 260 / C 294 / D 260 / E 210,
 *    F 72 / G 130 / H 72, 2층 A 135 / B 84 / C 82 / D 84 / E 135,
 *    3층 A 56 / B 31 / C 46 / D 49 / E 46 / F 31 / G 56 / M 30 / N 30,
 *    BOX 1~3 24 / 4~6 24 / 7~9 27 / 10~12 27).
 *    그리고 층 합계도 공식 홈페이지 수치(1,508 / 568 / 429 = 2,505)와 일치한다.
 *    → 이 홀의 좌석 데이터는 사실상 완전하다.
 *
 * 보조 확인: 공식 좌석배치도 이미지도 내려받아 눈으로 대조했다.
 *   https://www.sac.or.kr/design/theme/sac/images/sub/perform_seat1.jpg (1층)
 *   https://www.sac.or.kr/design/theme/sac/images/sub/perform_seat2.jpg (2·3층)
 *
 * ⚠️ 홀 형태: 공식 소개문은 예당 콘서트홀을 **"아레나형"** 이라고 부른다.
 *    ("3층으로 이루어진 객석은 아레나형의 독특한 공간 설계" — sac.or.kr)
 *    롯데처럼 무대를 여러 단(段)이 둘러싸는 진짜 빈야드가 아니다.
 *    1층은 무대를 향해 완만하게 경사진 **하나의 부채꼴 평면**이고,
 *    무대 뒤에 합창석(F/G/H), 옆·뒤로 2·3층 발코니와 BOX가 얹힌 구조다.
 *    → 단면 실루엣이 롯데와 근본적으로 다르다. docs/SEATMAP_geometry.md 참고.
 *
 * 좌우 기준: 배치도는 무대를 위, 객석을 아래에 둔 평면도다. 좌석에 앉아
 * 무대를 바라보는 관객 기준으로 도면의 왼쪽이 곧 관객의 왼쪽이다.
 * (A블록 = 객석에서 무대를 볼 때 맨 왼쪽)
 *
 * ✅ 재검증 (2차): 엑셀 격자를 처음부터 다시 파싱해 블록별로 셀을 셌다.
 *    21개 일반 블록 + BOX 4개 그룹이 전부 공식 요약표와 일치했고,
 *    층 합계도 1,508 / 568 / 429 = 2,505 로 딱 떨어졌다.
 *    → seatCount / rowMin / rowMax 는 conf 를 'confirmed' 로 둘 자격이 있다.
 *    (첫 파싱에서 1층 A가 210이 아니라 184로 나왔는데, 원인은 A블록이 뒤쪽
 *     열에서 엑셀 1~3열까지 넓어지는 걸 놓친 것이었다. 자료가 아니라 내 밴드가
 *     틀렸던 것이고, 고치니 일치했다.)
 *
 * 📐 좌석 번호 규칙 (격자에서 확인, 이 홀 전역에 적용된다):
 *    좌석 번호는 **평면도 왼→오른쪽**으로 증가한다. 단 합창석(G)만 반대로
 *    오른→왼쪽인데, 합창석은 무대를 등지고 객석을 보고 앉아서 "그들의 왼쪽"이
 *    도면의 오른쪽이기 때문이다.
 *    → 그래서 무대를 감아 도는 팔 모양 블록(2층 A/E, 3층 A/G)에서는
 *      좌우 짝끼리 **깊이 방향이 서로 반대**가 된다. seatDepthDir 참고.
 *
 * ⚠️ 엑셀 격자 ≠ 실제 평면 형태. 엑셀은 각 블록을 직사각형으로 펴서 배치한다
 *    (2층은 A|B|C|D|E 가 왼→오른쪽 일렬). 실제 2·3층은 말굽처럼 휜 팔이다.
 *    → **개수·열 범위는 엑셀**, **공간 배치는 공식 배치도 이미지**를 믿는다.
 *      이 분리가 conf.rows(confirmed) 와 conf.geometry(팔 블록은 inferred)의 근거다.
 */

const SAC_BLOCKS: BlockSpec[] = [
  /* ---- 1층 정면 객석 (부채꼴 평면, 열 1~22) ---- */
  {
    code: 'A',
    floor: 1,
    rowMin: 1,
    rowMax: 22,
    seatCount: 210,
    position: 'side-left',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 좌석배치도 엑셀 격자에서 직접 계수, 공식 요약표 210석과 일치. 1층 맨 왼쪽. 열당 최대 12번. ⚠️ 14열이 통로라 좌석이 없다(21개 열만 존재).',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'B',
    floor: 1,
    rowMin: 1,
    rowMax: 22,
    seatCount: 260,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 공식 요약표 260석. C 왼쪽. 열당 최대 14번. 22개 열 전부 존재.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'C',
    floor: 1,
    rowMin: 1,
    rowMax: 22,
    seatCount: 294,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 공식 요약표 294석. 무대 정면 정중앙, 이 홀에서 가장 큰 블록. 열당 최대 16번. 22열은 휠체어석 8석 전용(공식 주석: "휠체어석은 C블럭에 8대까지").',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'D',
    floor: 1,
    rowMin: 1,
    rowMax: 22,
    seatCount: 260,
    position: 'mid',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 260석. B의 오른쪽 대칭. 열당 최대 14번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'E',
    floor: 1,
    rowMin: 1,
    rowMax: 22,
    seatCount: 210,
    position: 'side-right',
    tier: 1,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 210석. A의 오른쪽 대칭(맨 오른쪽). 14열 없음.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },

  /* ---- 1층 합창석 (무대 뒤) — 공식 표기상 1층에 포함된다 ---- */
  {
    code: 'G',
    floor: 1,
    rowMin: 1,
    rowMax: 4,
    seatCount: 130,
    position: 'behind-stage',
    tier: 2,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '합창석 중앙(무대 정후면). 공식 엑셀 격자 계수 = 요약표 130석. 열별 좌석수 1열 28 / 2열 31 / 3열 34 / 4열 37 — 1열이 무대에 가장 가깝고 뒤로 갈수록 넓어진다.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'H',
    floor: 1,
    rowMin: 1,
    rowMax: 4,
    seatCount: 72,
    position: 'behind-stage',
    tier: 2,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '합창석 왼쪽 윙. 공식 엑셀 격자 계수 = 요약표 72석. 열별 1열 16 / 2열 20 / 3열 24 / 4열 12. ⚠️ 열이 무대 축과 나란한 세로줄이라 열 번호는 깊이가 아니라 안쪽(1)→바깥쪽(4) 방향이다. ⚠️ position 이 behind-stage 지만 **엄밀히는 무대 정후면이 아니라 무대 옆구리**다 — 엑셀 격자에서 H는 무대 열 전체(2~25행)를 따라 흐르는 세로 띠(11~14열)이고, 공식 배치도 이미지에서는 무대 왼쪽에서 비스듬히 꺾인 뱅크로 그려진다. 무대 정후면은 G뿐이다. 그래서 conf.geometry 는 inferred.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'toward',
  },
  {
    code: 'F',
    floor: 1,
    rowMin: 1,
    rowMax: 4,
    seatCount: 72,
    position: 'behind-stage',
    tier: 2,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '합창석 오른쪽 윙. H의 대칭(엑셀 58~61열). 공식 엑셀 격자 계수 = 72석. H와 같은 주의: 무대 정후면이 아니라 무대 옆구리다.',
    rowAxis: 'height',
    seatAxis: 'depth', seatDepthDir: 'toward',
  },

  /* ---- 2층 (열 1~8, 1열이 무대에 가장 가깝다) ---- */
  {
    code: 'A',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: 135,
    position: 'side-left',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 요약표 135석. 2층 왼쪽 팔 — 뒤쪽 중앙에서 시작해 무대 쪽으로 감아 나간다. 열당 최대 20번. 휠체어 8석 포함(공식: A·E블록 각 6대까지). ⚠️ **깊이 축이 열이 아니라 좌석 번호다**(공식 배치도 이미지 확대 판독): 1번이 무대 쪽 팔끝, 번호가 커질수록 뒤쪽 중앙으로 간다 → seatDepthDir=away. 열 1~8은 발코니 난간(1)에서 바깥벽(8)으로 가는 가로축이다. 엑셀은 이 팔을 직사각형으로 펴서 그려놔서 각도가 안 나온다 → conf.geometry inferred.',
    rowAxis: 'depth',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'B',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: 84,
    position: 'rear',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 84석. 열당 최대 14번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'C',
    floor: 2,
    rowMin: 1,
    rowMax: 7,
    seatCount: 82,
    position: 'rear',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 82석. 2층 정중앙. ⚠️ A/B/D/E와 달리 **7열까지만** 있다. 열당 최대 13번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'D',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: 84,
    position: 'rear',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 84석. B의 오른쪽 대칭.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'E',
    floor: 2,
    rowMin: 1,
    rowMax: 8,
    seatCount: 135,
    position: 'side-right',
    tier: 3,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 135석. A의 좌우 대칭. 휠체어 8석 포함. ⚠️ 대칭이라고 번호 방향까지 같지 않다 — 예당은 좌석 번호를 평면도 왼→오른쪽으로 매기므로 E에서는 1번이 뒤쪽 중앙, 큰 번호가 무대 쪽이다 → seatDepthDir=toward (A와 정반대).',
    rowAxis: 'depth',
    seatAxis: 'depth', seatDepthDir: 'toward',
  },

  /* ---- 2층 BOX (무대 양옆 발코니 박스) ----
   * BOX1이 무대에 가장 가깝고 BOX3이 가장 멀다(왼쪽).
   * 오른쪽은 BOX6이 무대에 가장 가깝고 BOX4가 가장 멀다.
   * 좌석수는 공식 확인. 박스 안 열 번호 체계는 확인하지 못했다. */
  { code: 'BOX1', floor: 2, rowMin: null, rowMax: null, seatCount: 6, position: 'side-left', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 2층 왼쪽 박스 중 무대에 가장 가깝다. 좌석 6석(2석×3줄). 열 번호 체계 미확인 → rowMin/Max null.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX2', floor: 2, rowMin: null, rowMax: null, seatCount: 8, position: 'side-left', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 2층 왼쪽 중간 박스. 8석(2석×4줄). 열 번호 체계 미확인.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX3', floor: 2, rowMin: null, rowMax: null, seatCount: 10, position: 'side-left', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 2층 왼쪽 박스 중 무대에서 가장 멀다. 10석(2석×5줄). 열 번호 체계 미확인.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX4', floor: 2, rowMin: null, rowMax: null, seatCount: 10, position: 'side-right', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX3의 오른쪽 대칭(무대에서 가장 멀다). 10석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX5', floor: 2, rowMin: null, rowMax: null, seatCount: 8, position: 'side-right', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX2의 오른쪽 대칭. 8석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX6', floor: 2, rowMin: null, rowMax: null, seatCount: 6, position: 'side-right', tier: 3, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX1의 오른쪽 대칭(무대에 가장 가깝다). 6석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },

  /* ---- 3층 ----
   * ⚠️ 3층 열 번호는 A·G(측면 팔)에만 1~3열이 있고,
   *    중앙 B~F는 **4열부터** 시작한다. 열 번호가 층 전체에서 공유된다.
   *    그리고 M·N은 가장 뒤에 있으면서 열 번호가 1부터 다시 시작한다. */
  {
    code: 'A',
    floor: 3,
    rowMin: 1,
    rowMax: 7,
    seatCount: 56,
    position: 'side-left',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 요약표 56석. 3층 왼쪽 팔. 1~3열은 좌석이 5~6석뿐인 좁은 앞부분(무대 쪽), 4열부터 넓어진다. 열당 최대 14번(열별 5/5/6/14/12/9/5). ⚠️ 2층 A와 같은 팔 구조 — 깊이는 좌석 번호이고 1번이 무대 쪽이다 → seatDepthDir=away.',
    rowAxis: 'depth',
    seatAxis: 'depth', seatDepthDir: 'away',
  },
  {
    code: 'B',
    floor: 3,
    rowMin: 4,
    rowMax: 7,
    seatCount: 31,
    position: 'rear',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 31석. ⚠️ **4열부터 시작한다** (1~3열은 이 블록에 없다). 열당 최대 9번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'C',
    floor: 3,
    rowMin: 4,
    rowMax: 7,
    seatCount: 46,
    position: 'rear',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 46석. 4열부터 시작. 열당 최대 13번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'D',
    floor: 3,
    rowMin: 4,
    rowMax: 7,
    seatCount: 49,
    position: 'rear',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 49석. 3층 정중앙. 4열부터 시작. 열당 최대 13번.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'E',
    floor: 3,
    rowMin: 4,
    rowMax: 7,
    seatCount: 46,
    position: 'rear',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 46석. C의 오른쪽 대칭. 4열부터 시작.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'F',
    floor: 3,
    rowMin: 4,
    rowMax: 7,
    seatCount: 31,
    position: 'rear',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 31석. B의 오른쪽 대칭. 4열부터 시작.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'G',
    floor: 3,
    rowMin: 1,
    rowMax: 7,
    seatCount: 56,
    position: 'side-right',
    tier: 4,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'inferred', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 56석. 3층 오른쪽 팔. A의 좌우 대칭. 2층 E와 같이 번호 방향은 반대다 — 큰 번호가 무대 쪽 → seatDepthDir=toward.',
    rowAxis: 'depth',
    seatAxis: 'depth', seatDepthDir: 'toward',
  },
  {
    code: 'M',
    floor: 3,
    rowMin: 1,
    rowMax: 2,
    seatCount: 30,
    position: 'rear',
    tier: 5,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote:
      '공식 엑셀 격자 계수 = 요약표 30석. 3층 **맨 뒤**의 별도 2줄(각 15석). ⚠️ 열 번호가 1부터 다시 시작하지만 물리적으로는 3층 7열보다 더 뒤·더 위다. 열 번호로 깊이를 계산하면 정반대 위치에 그려진다.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },
  {
    code: 'N',
    floor: 3,
    rowMin: 1,
    rowMax: 2,
    seatCount: 30,
    position: 'rear',
    tier: 5,
    conf: { existence: 'confirmed', rows: 'confirmed', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' },
    sourceNote: '공식 엑셀 격자 계수 = 30석. M의 오른쪽 짝. 같은 주의사항 적용.',
    rowAxis: 'depth',
    seatAxis: 'lateral', seatDepthDir: null,
  },

  /* ---- 3층 BOX ---- */
  { code: 'BOX7', floor: 3, rowMin: null, rowMax: null, seatCount: 6, position: 'side-left', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 3층 왼쪽 박스 중 무대에 가장 가깝다. 6석. 열 번호 체계 미확인.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX8', floor: 3, rowMin: null, rowMax: null, seatCount: 9, position: 'side-left', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 3층 왼쪽 중간 박스. 9석. 열 번호 체계 미확인.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX9', floor: 3, rowMin: null, rowMax: null, seatCount: 12, position: 'side-left', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. 3층 왼쪽 박스 중 무대에서 가장 멀다. 12석. 열 번호 체계 미확인.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX10', floor: 3, rowMin: null, rowMax: null, seatCount: 12, position: 'side-right', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX9의 오른쪽 대칭. 12석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX11', floor: 3, rowMin: null, rowMax: null, seatCount: 9, position: 'side-right', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX8의 오른쪽 대칭. 9석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
  { code: 'BOX12', floor: 3, rowMin: null, rowMax: null, seatCount: 6, position: 'side-right', tier: 4, conf: { existence: 'confirmed', rows: 'unknown', seatCount: 'confirmed', geometry: 'confirmed', tier: 'inferred' }, sourceNote: '공식 엑셀 격자. BOX7의 오른쪽 대칭(무대에 가장 가깝다). 6석.', rowAxis: 'depth', seatAxis: 'lateral', seatDepthDir: null },
];

const SAC: VenueProfile = {
  id: 'sac-concert-hall',
  nameKo: '예술의전당 콘서트홀',
  aliases: [
    '예술의전당 콘서트홀',
    '예술의전당콘서트홀',
    '예술의 전당 콘서트홀',
    '예술의전당 음악당 콘서트홀',
    '예술의전당 음악당',
    '예술의전당',
    '예술의 전당',
    '서울예술의전당',
    'Seoul Arts Center',
    'SAC Concert Hall',
    '예당',
    '예당 콘서트홀',
  ],
  // ── 맨몸 '예술의전당' / '예당' 을 콘서트홀로 붙이는 근거 ──────────────
  // 이건 엄밀히는 **모호하다**. 예술의전당은 복합단지고 음악 공연장만 해도
  // 콘서트홀 / IBK기업은행챔버홀 / 리사이틀홀 / 인춘아트홀 네 개다.
  // 그래도 콘서트홀로 붙이기로 한 이유:
  //   1) 형제 홀들은 배제 목록이 **이미 먼저** 잡아낸다. 여기까지 내려온
  //      '예술의전당' 은 "홀 이름이 아예 안 적혔다"는 뜻이지 "다른 홀"이 아니다.
  //   2) 이 앱은 클래식 티켓 앱이고, 예당 음악당 안에서 콘서트홀이 2,505석으로
  //      압도적으로 크다(챔버홀 600석대, 리사이틀홀 350석대).
  //      홀 이름이 생략된 티켓이 콘서트홀일 확률이 가장 높다.
  //   3) 실제 테스트 데이터에는 맨몸 '예술의전당' 이 **한 건도 없다**
  //      (전부 '예술의전당 콘서트홀' 또는 '예술의전당 (CJ) 토월극장').
  //      즉 이 분기는 현실에서 거의 안 타는 안전망이다.
  // 🔻 뒤집을 조건: 챔버홀/리사이틀홀 좌석도를 추가하는 순간 이 별칭은
  //    **배제 목록으로 옮겨야 한다.** 그때는 콘서트홀 추정이 진짜 오답이 된다.

  // ⚠️ '콘서트홀'/'음악당'/'SAC'는 예당 전용어가 아니다. 부분문자열로 풀어두면
  //    '통영국제음악당 콘서트홀', '아트센터인천 콘서트홀'까지 예당으로 끌려온다.
  //    그래서 약한 별칭으로 내려서 "문자열 전체가 이것뿐일 때만" 매칭시킨다.
  //    (예당 티켓의 공연장 칸에 '콘서트홀'만 인쇄되는 경우가 실제로 있다.)
  weakAliases: ['콘서트홀', '음악당 콘서트홀', 'Concert Hall', 'SAC'],
  blockTerm: '블록',
  totalSeats: 2505,
  floors: [
    { floor: 1, seatCount: 1508, label: '1층' },
    { floor: 2, seatCount: 568, label: '2층' },
    { floor: 3, seatCount: 429, label: '3층' },
  ],
  blocks: seal(SAC_BLOCKS),
  behindStageBlocks: ['F', 'G', 'H'],
  shapeNote:
    '아레나형(공식 표현). 롯데 같은 빈야드가 아니다. 1층은 무대를 향한 하나의 완만한 부채꼴 평면(A~E, 1~22열)이고, 무대 뒤에 합창석 F/G/H(1~4열)가 얹힌다. 2층·3층은 옆·뒤를 감싸는 발코니이고 무대 양옆에 BOX 12개가 붙는다. 총 2,505석(1층 1,508 / 2층 568 / 3층 429).',
};

/* ------------------------------------------------------------------ *
 * 공개 API
 * ------------------------------------------------------------------ */

export const VENUES: Record<string, VenueProfile> = {
  'lotte-concert-hall': LOTTE,
  'sac-concert-hall': SAC,
};

/** 별칭 매칭용 정규화: 공백/중점/괄호 제거 + 소문자 */
function normalizeVenueString(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[()[\]{}<>·・．.,'"\u201c\u201d\u2018\u2019\-_/\\|]/g, '');
}

/* ------------------------------------------------------------------ *
 * 배제 목록 (negative list)
 * ------------------------------------------------------------------ *
 *
 * 왜 필요한가:
 *   '예술의전당'은 **하나의 홀이 아니라 여러 극장을 품은 복합단지**다.
 *   별칭에 '예술의전당'이 있으면 'CJ토월극장', '오페라극장', 'IBK챔버홀'까지
 *   전부 콘서트홀로 매칭된다. 그러면 사용자 아바타가 **가본 적도 없는 홀에**
 *   앉는다. 실제 티켓 데이터에도 '예술의전당 CJ 토월극장' / '예술의전당 토월극장'이
 *   섞여 있다.
 *
 * 규칙:
 *   아래 조각이 하나라도 문자열에 들어 있으면 **무조건 null**. 긍정 별칭이
 *   더 길게 걸려도 배제가 이긴다. 틀린 홀에 앉히느니 "좌석도 없음"이 낫다.
 *
 * 안전성:
 *   여기 있는 조각 중 어느 것도 롯데콘서트홀/예당 콘서트홀의 별칭 안에
 *   부분문자열로 들어가지 않는다 (아래 assertion 주석 참고). 그래서
 *   정상 티켓을 잘못 죽이지 않는다.
 *
 * 출처: sac.or.kr 공연장 안내 네비게이션 (docs/seatmaps/sac_official_concertHall_page.html)
 *   오페라하우스 — 오페라극장 / CJ 토월극장 / 자유소극장
 *   음악당       — 콘서트홀 / IBK기업은행챔버홀 / 리사이틀홀 / 인춘아트홀
 *   미술관·박물관 — 한가람미술관 / 한가람디자인미술관 / 서울서예박물관
 *   야외공간     — 신세계스퀘어 야외무대 / 음악광장 / 계단광장 / 세계음악분수
 */
export const UNSUPPORTED_VENUE_MARKERS: string[] = [
  /* --- 예술의전당 산하, 콘서트홀이 아닌 공연장 --- */
  '토월극장', // 'CJ 토월극장', 'CJ토월극장', '토월극장' 모두 커버
  '오페라극장',
  '오페라하우스',
  '자유소극장',
  '챔버홀', // 'IBK챔버홀', 'IBK기업은행챔버홀'
  '체임버홀', // 표기 흔들림
  '리사이틀홀',
  '아트홀', // '인춘아트홀', 그리고 금호아트홀 등 외부 홀까지 같이 걸러진다
  /* --- 예술의전당 산하, 공연장이 아닌 시설 --- */
  '한가람',
  '서예박물관',
  '예술자료원',
  '신세계스퀘어',
  '야외무대',
  '음악광장',
  '계단광장',
  '음악분수',
  /* --- 그 밖의, 좌석도를 갖고 있지 않은 공연장 --- */
  '세종문화회관',
  '대극장',
  '소극장',
  '아트센터',
  '콘서트하우스',
  '문화회관',
  /* --- 롯데 계열 중 콘서트홀이 아닌 공간 ---
   * 롯데콘서트홀은 단일 홀이라 예당 같은 형제 홀 문제가 없다.
   * 그래도 같은 단지 안 공간이 OCR에 잡힐 때를 대비해 둔다. */
  '롯데시네마',
  '서울스카이',
  '아쿠아리움',
  '롯데월드어드벤처',
  '롯데백화점',
];

export type VenueMatchReason =
  /** 지원하는 홀을 찾았다 */
  | 'matched'
  /** 공연장 문자열이 비었다 */
  | 'empty'
  /** 이름은 읽혔지만 좌석도가 없는 홀이다 (예: 예술의전당 CJ토월극장) */
  | 'unsupported-venue'
  /** 어느 홀인지 모르겠다 */
  | 'no-match';

export interface VenueMatch {
  profile: VenueProfile | null;
  reason: VenueMatchReason;
  /** unsupported-venue 일 때 어떤 조각에 걸렸는지 (디버그/문구용) */
  matchedMarker: string | null;
}

/** 층·열·번 같은 좌석 잡음. 약한 별칭 판정에서 무시한다. */
const SEAT_NOISE = /(\d+)?(층|열|번|석|블록|블럭|구역|좌석|f|floor)/g;

/**
 * OCR이 뱉은 공연장 문자열을 프로필에 매칭한다 — 이유까지 함께.
 *
 * 판정 순서 (순서가 곧 안전장치다):
 *   1) 배제 목록에 걸리면 즉시 null. 긍정 별칭보다 **먼저** 본다.
 *   2) 강한 별칭 부분문자열 매칭. 가장 긴 별칭이 이긴다.
 *   3) 그래도 없으면 약한 별칭 — 단, 문자열 전체가 그 별칭일 때만.
 *
 * **fallback 프로필을 만들지 않는다** — 모르는 홀을 아는 척 그리는 것보다
 * 안 그리는 게 낫다. 호출부에서 reason 을 보고 문구를 고를 것.
 */
export function matchVenueDetailed(ocrVenueString: string): VenueMatch {
  const miss = (reason: VenueMatchReason): VenueMatch => ({
    profile: null,
    reason,
    matchedMarker: null,
  });
  if (!ocrVenueString) return miss('empty');
  const hay = normalizeVenueString(ocrVenueString);
  if (!hay) return miss('empty');

  // 1) 배제가 최우선
  for (const marker of UNSUPPORTED_VENUE_MARKERS) {
    const m = normalizeVenueString(marker);
    if (m && hay.includes(m)) {
      return { profile: null, reason: 'unsupported-venue', matchedMarker: marker };
    }
  }

  // 2) 강한 별칭 — 가장 구체적인(긴) 것이 이긴다.
  //    '콘서트홀'(예당 약칭)과 '롯데콘서트홀'이 동시에 걸리면 롯데가 이겨야 한다.
  let best: { profile: VenueProfile; len: number } | null = null;
  for (const profile of Object.values(VENUES)) {
    for (const alias of profile.aliases) {
      const needle = normalizeVenueString(alias);
      if (!needle) continue;
      if (hay.includes(needle) && (!best || needle.length > best.len)) {
        best = { profile, len: needle.length };
      }
    }
  }
  if (best) return { profile: best.profile, reason: 'matched', matchedMarker: null };

  // 3) 약한 별칭 — 문자열 전체가 그것뿐일 때만.
  const stripped = hay.replace(SEAT_NOISE, '');
  for (const profile of Object.values(VENUES)) {
    for (const alias of profile.weakAliases) {
      const needle = normalizeVenueString(alias);
      if (!needle) continue;
      if (hay === needle || stripped === needle) {
        return { profile, reason: 'matched', matchedMarker: null };
      }
    }
  }

  return miss('no-match');
}

/**
 * 기존 시그니처 유지용 얇은 래퍼. 못 찾으면 null.
 * 왜 못 찾았는지가 필요하면 matchVenueDetailed 를 써라.
 */
export function matchVenue(ocrVenueString: string): VenueProfile | null {
  return matchVenueDetailed(ocrVenueString).profile;
}

/** 층 + 구역 코드로 블록을 찾는다. 코드는 대소문자 무시. */
export function findBlock(
  profile: VenueProfile,
  floor: number | null,
  code: string | null,
): VenueBlock | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const hits = profile.blocks.filter((b) => b.code === c);
  if (hits.length === 0) return null;
  if (floor == null) return hits[0];
  return hits.find((b) => b.floor === floor) ?? null;
}

/** 무대 뒤(합창석) 좌석인가 */
export function isBehindStage(
  profile: VenueProfile,
  code: string | null,
): boolean {
  if (!code) return false;
  return profile.behindStageBlocks.includes(code.trim().toUpperCase());
}

export const SOURCES = {
  lotte: [
    'https://www.lotteconcerthall.com/home/ko/display/region/content/JSVFSGpkUzVBaHYzUmMrZElSU3BxcERUVHFNUlk3bzZMYytkVXJtOXJqdEZaZz0=', // 객석안내 1층
    'https://www.lotteconcerthall.com/home/ko/display/region/content/JSVFdUtsRnZ1QUViajZJNDdXNGp6MXBSbG14UDRFOElmdFVvL3RmMlUzQWZ5Zz0=', // 객석안내 2층
    'https://www.lotteconcerthall.com/home/ko/display/region/content/JSVFdzJEZWtxMWxwdXVvcXpNeVRnRFVidjRzeHVLbzkvY2FrTEplbEV6dlB6WT0=', // 게이트안내 1층
    'https://www.lotteconcerthall.com/home/ko/display/region/content/JSVFRHVldXZyOWVCcXRreTh4elo1RFBSMGM0eTR2U0xwSVVuN1drcHpDTk9HND0=', // 게이트안내 2층
    'https://www.lotteconcerthall.com/images/sub/img_info_seat_gak01.png',
    'https://www.lotteconcerthall.com/images/sub/img_info_seat_gak02.png',
  ],
  sac: [
    'https://www.sac.or.kr/site/main/content/concertHall', // 층별 좌석수 + "아레나형" 서술
    'https://www.sac.or.kr/site/main/content/ticketPlaceMusichall', // 좌석배치도 엑셀 링크 + 등급 운영
    'https://www.sac.or.kr/site/main/file/download/764810', // ConcertHallSeatingPlan_2021.xls ★ 핵심 출처
    'https://www.sac.or.kr/design/theme/sac/images/sub/perform_seat1.jpg',
    'https://www.sac.or.kr/design/theme/sac/images/sub/perform_seat2.jpg',
  ],
};
