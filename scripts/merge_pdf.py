# -*- coding: utf-8 -*-
"""把前30页+后30页合并为1个PDF（源程序、说明书通用）"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pypdf import PdfReader, PdfWriter

BASE = r'd:\game\liuer3.0\软件著作权材料'

def merge(name):
    front = os.path.join(BASE, f'{name}_前30页.pdf')
    back  = os.path.join(BASE, f'{name}_后30页.pdf')
    out   = os.path.join(BASE, f'{name}_鉴别材料.pdf')
    writer = PdfWriter()
    for f in (front, back):
        if os.path.exists(f):
            r = PdfReader(f)
            for p in r.pages:
                writer.add_page(p)
            print(f'添加: {os.path.basename(f)} ({len(r.pages)}页)')
        else:
            print(f'[警告] 找不到: {f}')
    with open(out, 'wb') as o:
        writer.write(o)
    print(f'生成合并PDF: {out}')

# 源程序合并
merge('源程序')
# 说明书合并
merge('软件说明书')
print('全部完成')
