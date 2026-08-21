# -*- coding: utf-8 -*-
"""生成软件说明书PDF（前30页+后30页）"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = r'd:\game\liuer3.0\软件著作权材料\软件说明书.txt'
OUT_DIR = r'd:\game\liuer3.0\软件著作权材料'
PER_PAGE = 50   # 每页行数（A4小字号）

with open(SRC, encoding='utf-8') as f:
    lines = f.read().splitlines()

total = len(lines)
print('说明书总行数:', total)

FRONT = 30
BACK = 30
front = lines[:FRONT*PER_PAGE]
back = lines[max(0, total-BACK*PER_PAGE):]
print('前30页:', len(front), '行; 后30页:', len(back), '行')

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak
from reportlab.lib.styles import ParagraphStyle

font = 'Helvetica'
for cand in [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simsun.ttc', r'C:\Windows\Fonts\simhei.ttf']:
    if os.path.exists(cand):
        try:
            pdfmetrics.registerFont(TTFont('CJK', cand)); font='CJK'; print('字体:', cand); break
        except Exception as e:
            print('字体失败', cand, e)

def esc(t):
    return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

style_h = ParagraphStyle('h', fontName=font, fontSize=10, leading=13, alignment=1)
style_b = ParagraphStyle('b', fontName=font, fontSize=7, leading=9, wordWrap='CJK')

def build(prefix, data, out):
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=14*mm, rightMargin=14*mm,
                            topMargin=12*mm, bottomMargin=12*mm, title='下六儿说明书'+prefix)
    story=[]; p=1
    for i in range(0, len(data), PER_PAGE):
        if p>1: story.append(PageBreak())
        story.append(Paragraph(f'下六儿 软件说明书 {prefix} 第 {p} 页', style_h))
        for ln in data[i:i+PER_PAGE]:
            story.append(Paragraph(esc(ln) if ln.strip() else '&nbsp;', style_b))
        p+=1
    doc.build(story)
    print('生成:', out, f'({p-1}页)')

os.makedirs(OUT_DIR, exist_ok=True)
build('前30页', front, os.path.join(OUT_DIR, '软件说明书_前30页.pdf'))
build('后30页', back, os.path.join(OUT_DIR, '软件说明书_后30页.pdf'))
print('全部完成:', OUT_DIR)
