#!/usr/bin/env python3
"""상세페이지 HTML → '작품소개' 탭 본문 라인들."""
import html as htmllib
import re

SCRIPT = re.compile(r"<(script|style)\b.*?</\1>", re.S | re.I)
BR = re.compile(r"<\s*(br|/p|/div|/li|/td|/tr|/h\d|/dd|/dt)\s*/?>", re.I)
TAG = re.compile(r"<[^>]+>")
COMMENT = re.compile(r"<!--.*?-->", re.S)


def _lines(frag):
    frag = COMMENT.sub(" ", frag)
    frag = SCRIPT.sub(" ", frag)
    frag = BR.sub("\n", frag)
    txt = TAG.sub("", frag)
    txt = htmllib.unescape(txt)
    txt = txt.replace("\xa0", " ").replace("​", "").replace("﻿", "")
    out = []
    for ln in txt.split("\n"):
        ln = re.sub(r"[ \t\r]+", " ", ln).strip()
        if ln:
            out.append(ln)
    return out


H2 = re.compile(r"공연[·・]전시 상세\s*정보\s*</h2>")
NEXT_TAB = re.compile(r'<div class="ctl-sub')


def intro_region(html):
    """'작품소개' 탭 본문 라인들.

    페이지에 따라 앞에 '알립니다' 공지 탭이 하나 더 붙는다.
    그래서 '첫 ctl-sub' 가 아니라 h2(공연·전시 상세 정보) 앵커를 쓴다.
    """
    out = []
    seen = set()
    for m in H2.finditer(html):
        s = m.end()
        nxt = NEXT_TAB.search(html, s)
        e = nxt.start() if nxt else min(len(html), s + 60000)
        for ln in _lines(html[s:e]):
            if ln not in seen:
                seen.add(ln)
                out.append(ln)
    return out
