#!/usr/bin/env python3
"""redact_pii 의 판정 로직 테스트 — 이미지·macOS 프레임워크 불필요.

    python3 -m unittest discover -s tools -p 'test_*.py'

여기서 지키는 계약은 두 방향이다. **둘 다 실패 비용이 있다.**

  1. 실명·예매번호·QR 숫자열을 놓치지 않는다      (놓치면 개인정보가 외부로 나간다)
  2. 좌석·날짜·공연장·곡목을 가리지 않는다        (가리면 우리가 쓸 데이터가 사라진다)

특히 §2 의 회귀는 조용하다 — 마스킹은 "성공" 하고 정확도만 떨어진다.
그래서 KEEP 대상과 파편(fragment) 오탐을 명시적으로 고정한다.
"""
import unittest

from redact_pii import (
    classify, _is_fragment, PII_PATTERNS, NAME_LABELS, KEEP, NOT_A_NAME,
)


def lines(*texts):
    """classify 가 받는 최소 형태 — text 와 box 만 있으면 된다."""
    return [{'text': t, 'confidence': 0.9, 'box': [0.1, 0.5, 0.3, 0.02]} for t in texts]


def reasons_for(marked, text):
    for m in marked:
        if m['text'] == text:
            return m['reasons']
    return None


def masked_texts(marked):
    return {m['text'] for m in marked}


class TestPatterns(unittest.TestCase):
    """정규식 단위 — 무엇이 개인정보로 잡히는가."""

    def _kinds(self, text):
        return {kind for pat, kind in PII_PATTERNS if pat.search(text)}

    def test_예매번호(self):
        self.assertIn('booking_no', self._kinds('T1234567890'))

    def test_바코드_긴_숫자열(self):
        self.assertIn('long_digits', self._kinds('9791234567890'))

    def test_주민번호(self):
        self.assertIn('rrn', self._kinds('901231-1234567'))

    def test_휴대폰번호(self):
        self.assertIn('phone', self._kinds('010-1234-5678'))
        self.assertIn('phone', self._kinds('01012345678'))

    def test_이메일(self):
        self.assertIn('email', self._kinds('someone@example.com'))

    def test_좌석_문자열은_어떤_패턴에도_안_걸린다(self):
        # 좌석은 우리가 필요한 데이터다. 여기 걸리면 데이터가 통째로 사라진다.
        for s in ['1층 A구역 15열 01번', '2층 B블록 3열 12번', 'R석']:
            self.assertEqual(self._kinds(s), set(), f'좌석이 PII 로 잡혔다: {s}')

    def test_공연일시는_안_걸린다(self):
        for s in ['2024.06.20', '2024년 6월 20일', '오후 8시']:
            self.assertEqual(self._kinds(s), set(), f'공연 일시가 PII 로 잡혔다: {s}')

    def test_가격은_안_걸린다(self):
        self.assertEqual(self._kinds('120,000원'), set())


class TestKeepList(unittest.TestCase):
    """KEEP = 절대 가리면 안 되는 것."""

    def test_좌석_날짜_공연장이_KEEP_에_걸린다(self):
        for s in ['1층 A구역', '15열 01번', '롯데콘서트홀', '예술의전당', '2024-06-20', '오후 8:00', 'R석']:
            self.assertTrue(KEEP.search(s), f'KEEP 에 안 걸린다: {s}')

    def test_사람이름은_KEEP_에_안_걸린다(self):
        for s in ['홍길동', '김철수']:
            self.assertIsNone(KEEP.search(s), f'사람 이름이 KEEP 에 걸렸다: {s}')


class TestIsFragment(unittest.TestCase):
    """실측 오탐: '하모닉' ← '로열 필하모닉 오케스트라' 의 잘린 조각."""

    def test_더_긴_줄의_부분문자열이면_파편이다(self):
        ls = lines('로열 필하모닉 오케스트라 내한공연', '하모닉')
        self.assertTrue(_is_fragment('하모닉', ls, 1))

    def test_자기_자신은_비교에서_제외한다(self):
        ls = lines('홍길동')
        self.assertFalse(_is_fragment('홍길동', ls, 0))

    def test_어디에도_안_들어있으면_파편이_아니다(self):
        ls = lines('롯데콘서트홀', '1층 A구역 15열', '홍길동')
        self.assertFalse(_is_fragment('홍길동', ls, 2))

    def test_같은_길이_줄은_파편_근거가_안_된다(self):
        ls = lines('홍길동', '홍길동')
        self.assertFalse(_is_fragment('홍길동', ls, 0))


class TestClassifyMasks(unittest.TestCase):
    """가려야 하는 것."""

    def test_예매번호를_가린다(self):
        m = classify(lines('롯데콘서트홀', 'T1234567890'))
        self.assertIn('booking_no', reasons_for(m, 'T1234567890'))

    def test_예매자_라벨_줄을_가린다(self):
        m = classify(lines('예매자 홍길동'))
        self.assertIn('name_label_line', reasons_for(m, '예매자 홍길동'))

    def test_라벨_다음_줄의_한글이름을_가린다(self):
        m = classify(lines('예매자', '홍길동', '1층 A구역 15열 01번'))
        self.assertIsNotNone(reasons_for(m, '홍길동'))
        self.assertIn('name_near_label', reasons_for(m, '홍길동'))

    def test_단독_한글_2에서4자는_이름_후보다(self):
        m = classify(lines('롯데콘서트홀', '홍길동'))
        self.assertIn('bare_korean_name', reasons_for(m, '홍길동'))

    def test_이유는_정렬된_중복없는_목록이다(self):
        m = classify(lines('예매자 010-1234-5678'))
        r = reasons_for(m, '예매자 010-1234-5678')
        self.assertEqual(r, sorted(set(r)))


class TestClassifyPreserves(unittest.TestCase):
    """가리면 안 되는 것 — 이쪽 회귀는 조용해서 더 위험하다."""

    def test_좌석_날짜_공연장_곡목을_가리지_않는다(self):
        keep = ['롯데콘서트홀', '예술의전당 콘서트홀', '1층 A구역 15열 01번',
                '2024.06.20 오후 8시', 'R석', '120,000원']
        m = classify(lines(*keep))
        for s in keep:
            self.assertNotIn(s, masked_texts(m), f'필요한 데이터가 마스킹 대상이 됐다: {s}')

    def test_악기_역할_단어를_이름으로_오인하지_않는다(self):
        # NOT_A_NAME 에 든 단어들 — '지휘', '피아노' 등은 사람 이름이 아니다.
        words = ['지휘', '피아노', '바이올린', '협연', '합창']
        m = classify(lines('롯데콘서트홀', *words))
        for w in words:
            self.assertNotIn(w, masked_texts(m), f'{w} 가 이름으로 오인됐다')

    def test_잘린_공연명_파편을_이름으로_오인하지_않는다(self):
        # 실측 사례. 이걸 가리면 공연명이 손상된다.
        m = classify(lines('로열 필하모닉 오케스트라 내한공연', '하모닉'))
        self.assertNotIn('하모닉', masked_texts(m))

    def test_NOT_A_NAME_과_KEEP_은_비어있지_않다(self):
        self.assertGreater(len(NOT_A_NAME), 0)
        self.assertTrue(NAME_LABELS.search('예매자'))

    def test_빈_입력은_빈_결과(self):
        self.assertEqual(classify([]), [])


if __name__ == '__main__':
    unittest.main()
