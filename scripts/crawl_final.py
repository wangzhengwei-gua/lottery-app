#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大乐透开奖号码自动爬取 - 最终版
数据来源：500彩票网（datachart.500.com）
输出：lottery-app/src/data/lottery-history.txt（纯文本，每行一期）

数据格式：每行 7 个号码，空格分隔，前区5个 + 后区2个
示例：01 04 10 23 25 01 12
"""

import requests
import re
import os
from datetime import datetime

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# 500彩票网大乐透历史数据（与 dlt-simulator 相同的可靠接口）
API_URL = "https://datachart.500.com/dlt/history/newinc/history.php?limit=30&sort=0"
REFERER = "https://datachart.500.com/dlt/"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY_FILE = os.path.join(BASE_DIR, "lottery-app", "src", "data", "lottery-history.txt")


def fetch_html():
    """获取 500 彩票网页面 HTML"""
    headers = {**HEADERS, "Referer": REFERER}
    resp = requests.get(API_URL, headers=headers, timeout=15)
    resp.encoding = "utf-8"
    return resp.text


def extract_balls(row_html, css_class):
    """从行中提取指定 css class 的号码（兼容 cfont2 和 t_cfont2）"""
    cell_pattern = re.compile(
        r'<td[^>]*' + css_class + r'[^>]*>(.*?)</td>',
        re.DOTALL
    )
    cells = cell_pattern.findall(row_html)
    numbers = []
    for cell in cells:
        nums = re.findall(r'\d+', cell)
        numbers.extend([int(n) for n in nums])
    return numbers


def extract_period_and_date(row_html):
    """提取期号(5+位纯数字)和日期(yyyy-mm-dd)"""
    clean = re.sub(r'<!--.*?-->', '', row_html, flags=re.DOTALL)
    all_tds = re.findall(r'<td[^>]*>([^<]+)</td>', clean)

    period = ""
    date = ""
    for v in all_tds:
        v = v.strip()
        if not v or v == '&nbsp;':
            continue
        date_match = re.match(r'(\d{4}-\d{2}-\d{2})', v)
        if date_match and not date:
            date = date_match.group(1)
        elif re.match(r'^\d{5,}$', v) and not period:
            period = v
    return period, date


def crawl():
    """爬取大乐透开奖数据"""
    print("=" * 60)
    print("  大乐透开奖数据爬取 - 最终版")
    print("  数据来源: datachart.500.com")
    print("  时间: {}".format(datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    print("=" * 60)

    # 1. 获取页面
    try:
        html = fetch_html()
    except Exception as e:
        print("[ERROR] 请求失败: {}".format(e))
        return False

    # 2. 解析数据行
    rows = re.findall(r'<tr class="t_tr1">.*?</tr>', html, re.DOTALL)
    if not rows:
        print("[ERROR] 未找到数据行")
        return False

    # 解析每行（API 返回从新到旧）
    records = []
    for row_html in rows:
        period, date = extract_period_and_date(row_html)
        if not period or not date:
            continue

        front = extract_balls(row_html, "cfont2")[:5]
        back = extract_balls(row_html, "cfont4")[:2]

        if len(front) == 5 and len(back) == 2:
            # 格式化为纯文本行：01 04 10 23 25 01 12
            front_str = " ".join(str(n).zfill(2) for n in front)
            back_str = " ".join(str(n).zfill(2) for n in back)
            line = "{} {}".format(front_str, back_str)
            records.append({"period": period, "date": date, "line": line})

    if not records:
        print("[ERROR] 未能解析到有效数据")
        return False

    # records 是从新到旧，反转为从旧到新（与文件顺序一致）
    records.reverse()

    print("[OK] 解析到 {} 期数据".format(len(records)))
    print("  最新: 第{}期 ({}) -> {}".format(
        records[-1]["period"], records[-1]["date"], records[-1]["line"]))
    print("  最旧: 第{}期 ({}) -> {}".format(
        records[0]["period"], records[0]["date"], records[0]["line"]))

    # 3. 读取现有文件，追加新数据
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)

    existing_lines = []
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            existing_lines = [l.strip() for l in f.readlines() if l.strip()]

    # 找出不在文件中的新数据
    new_records = [r for r in records if r["line"] not in existing_lines]

    if not new_records:
        print("\n[INFO] 所有数据已存在，无需更新")
        print("  当前文件共 {} 期".format(len(existing_lines)))
        return True

    # 追加到文件末尾
    with open(HISTORY_FILE, "a", encoding="utf-8") as f:
        for r in new_records:
            f.write(r["line"] + "\n")

    print("\n[OK] 新增 {} 期数据:".format(len(new_records)))
    for r in new_records:
        print("  第{}期 ({}) -> {}".format(r["period"], r["date"], r["line"]))

    # 统计
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        total = len([l for l in f.readlines() if l.strip()])
    print("\n[OK] 文件共 {} 期数据".format(total))
    print("  路径: {}".format(HISTORY_FILE))
    print("=" * 60)
    return True


if __name__ == "__main__":
    crawl()
