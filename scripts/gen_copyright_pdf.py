# -*- coding: utf-8 -*-
"""生成软件著作权程序鉴别材料PDF（源程序前30页+后30页）"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ---------- 1. 收集源码 ----------
files = []
def walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        # 排除非源码目录
        dirnames[:] = [d for d in dirnames if d not in ('node_modules','.git','logs','__pycache__','assets','scripts')]
        for fn in filenames:
            if fn.endswith(('.js','.json','.py')):
                files.append(os.path.join(dirpath, fn))

walk(r'd:\game\liuer3.0\server\src')
walk(r'd:\game\liuer3.0\client4.0')
files = sorted(set(files))

# ---------- 2. 组装所有行（带文件名标记） ----------
lines = []
for f in files:
    rel = os.path.relpath(f, r'd:\game\liuer3.0')
    try:
        with open(f, encoding='utf-8', errors='ignore') as fh:
            content = fh.read().splitlines()
    except Exception:
        continue
    lines.append(f'===== 文件: {rel} =====')
    lines.extend(content)

total_lines = len(lines)
print('总行数:', total_lines)

PER_PAGE = 50                     # 每页行数（A4小字号）
total_pages = (total_lines + PER_PAGE - 1) // PER_PAGE
print('总页数(按50行/页):', total_pages)

FRONT_PAGES = 30                  # 前30页
BACK_PAGES = 30                   # 后30页
front_lines = lines[:FRONT_PAGES * PER_PAGE]
back_lines = lines[max(0, total_lines - BACK_PAGES * PER_PAGE):]
print('前30页行数:', len(front_lines))
print('后30页行数:', len(back_lines))

# ---------- 3. reportlab 生成 PDF ----------
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak
    from reportlab.lib.styles import ParagraphStyle
    HAS_RL = True
except Exception as e:
    print('reportlab 不可用，请先: pip install reportlab。', e)
    HAS_RL = False

if HAS_RL:
    # 注册中文字体（优先微软雅黑/宋体）
    font_name = 'Helvetica'
    for cand in [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simsun.ttc', r'C:\Windows\Fonts\simhei.ttf']:
        if os.path.exists(cand):
            try:
                pdfmetrics.registerFont(TTFont('CJK', cand))
                font_name = 'CJK'
                print('使用中文字体:', cand)
                break
            except Exception as e:
                print('注册字体失败:', cand, e)

    style_h = ParagraphStyle('h', fontName=font_name, fontSize=9, leading=12, alignment=1)
    style_mono = ParagraphStyle('mono', fontName=font_name, fontSize=6.5, leading=8, wordWrap='CJK')

    def esc(t):
        return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

    def build_pdf(prefix, data_lines, outname):
        doc = SimpleDocTemplate(outname, pagesize=A4,
                                leftMargin=13*mm, rightMargin=13*mm,
                                topMargin=12*mm, bottomMargin=12*mm,
                                title='下六儿-源程序'+prefix)
        story = []
        page_no = 1
        for i in range(0, len(data_lines), PER_PAGE):
            page_lines = data_lines[i:i+PER_PAGE]
            if page_no > 1:
                story.append(PageBreak())
            story.append(Paragraph(f'下六儿 源程序 {prefix} 第 {page_no} 页', style_h))
            for ln in page_lines:
                story.append(Paragraph(esc(ln), style_mono))
            page_no += 1
        doc.build(story)
        print('生成:', outname, f'({page_no-1}页)')

    outdir = r'd:\game\liuer3.0\软件著作权材料'
    os.makedirs(outdir, exist_ok=True)
    build_pdf('前30页', front_lines, os.path.join(outdir, '源程序_前30页.pdf'))
    build_pdf('后30页', back_lines, os.path.join(outdir, '源程序_后30页.pdf'))
    print('全部完成，输出目录:', outdir)
