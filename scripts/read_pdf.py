# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pypdf import PdfReader

path = r"C:\Users\Administrator\AppData\Local\Temp\codebuddy-dropped-files\64c7d3ea-0f50-4867-8da4-4d424a1cf28a\中国版权登记业务平台.pdf"
reader = PdfReader(path)
print("总页数:", len(reader.pages))
print("元数据:", reader.metadata)
print("="*50)
for i, page in enumerate(reader.pages):
    txt = page.extract_text() or ""
    print(f"\n===== 第 {i+1} 页 =====")
    print(txt)
