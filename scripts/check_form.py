# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pypdf import PdfReader

path = r"C:\Users\Administrator\AppData\Local\Temp\codebuddy-dropped-files\64c7d3ea-0f50-4867-8da4-4d424a1cf28a\中国版权登记业务平台.pdf"
reader = PdfReader(path)
print("是否加密:", reader.is_encrypted)
# 检查 AcroForm 字段
if reader.get_fields():
    print("存在表单字段:")
    for k, v in reader.get_fields().items():
        print(" ", k, "=", v.get('/V'))
else:
    print("无表单字段（是内容截图，不是可填写表单）")
