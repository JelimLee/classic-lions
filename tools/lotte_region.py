#!/usr/bin/env python3
"""롯데콘서트홀 상세페이지 HTML → 서버렌더된 Vue 데이터 + 본문 라인.

예당과 달리 롯데 페이지는 HTML 안에 `new Vue({el:"#body", data:{...}})` 로
공연 메타와 본문(HTML 문자열)이 통째로 박혀 있다. 그걸 그대로 꺼내 쓴다.
"""
import html as htmllib
import json
import re

TAG = re.compile(r"<[^>]+>")
BR = re.compile(r"<\s*(br|/p|/div|/li|/td|/tr|/h\d|/dd|/dt)\s*/?>", re.I)
COMMENT = re.compile(r"<!--.*?-->", re.S)
IMG = re.compile(r"<img[^>]+src\s*=\s*[\"']([^\"']+)[\"']", re.I)

# 본문으로 볼 섹션. '아티스트'(약력 산문)와 '예매 유의사항'/'할인'은 제외한다 —
# 약력 산문 안의 곡 언급을 연주 기록으로 세지 않기 위한 방어선(예당 파서와 같은 원칙).
BODY_SECTIONS = ("공연소개", "프로그램북", "공연정보", "공지사항", "알립니다")


def vue_data(html):
    """`new Vue({el:"#body", data:{...}})` 의 data 객체를 dict 로."""
    i = html.find('el: "#body"')
    if i < 0:
        return None
    k = html.find("data: {", i)
    if k < 0:
        return None
    k += len("data: ")
    depth = 0
    instr = esc = False
    for p in range(k, len(html)):
        c = html[p]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = False
        else:
            if c == '"':
                instr = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(html[k:p + 1])
                    except Exception:
                        return None
    return None


def to_lines(frag):
    frag = COMMENT.sub(" ", frag)
    frag = BR.sub("\n", frag)
    txt = htmllib.unescape(TAG.sub("", frag))
    txt = txt.replace("\xa0", " ").replace("​", "").replace("﻿", "")
    out = []
    for ln in txt.split("\n"):
        ln = re.sub(r"[ \t\r]+", " ", ln).strip()
        if ln:
            out.append(ln)
    return out


def intro_region(data):
    """본문 섹션 라인들 (중복 제거, 순서 보존)."""
    out, seen = [], set()
    for det in data.get("Details") or []:
        if det.get("Name") not in BODY_SECTIONS:
            continue
        for ln in to_lines(det.get("Value") or ""):
            if ln not in seen:
                seen.add(ln)
                out.append(ln)
    return out


def body_images(data):
    """본문 섹션에 박힌 이미지 URL (곡목이 이미지 안에만 있을 때의 OCR 대상)."""
    urls, seen = [], set()
    for det in data.get("Details") or []:
        if det.get("Name") not in BODY_SECTIONS:
            continue
        for u in IMG.findall(det.get("Value") or ""):
            u = htmllib.unescape(u.strip())
            if u.startswith("//"):
                u = "https:" + u
            elif u.startswith("/"):
                u = "https://www.lotteconcerthall.com" + u
            if u.lower().endswith(".svg"):
                continue
            if u not in seen:
                seen.add(u)
                urls.append(u)
    return urls
