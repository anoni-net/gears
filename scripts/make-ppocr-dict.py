# 把 PP-OCRv5 辨識模型 inference.yml 裡的 character_dict 轉成 src/tools/redact/ppocr-dict.json，
# 給 src/tools/redact/ppocr.ts 的 CTC 解碼用。字典有 18,383 個字，模型的輸出多兩個：最前面是空白（blank），
# 最後面是空格。inference.yml 的來源與 SHA-256 寫在 src/tools/redact/ppocr-models.json 的 dict，
# 換模型時從同一個 commit 下載 inference.yml 再執行一次。
# 用法：uv run --with pyyaml python scripts/make-ppocr-dict.py <inference.yml> src/tools/redact/ppocr-dict.json
import json, sys
import yaml

d = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
chars = [str(c) for c in d["PostProcess"]["character_dict"]]
json.dump(chars, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
print(len(chars))
