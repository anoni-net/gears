# 產生遮蔽「找人臉」用的 YuNet 模型（public/models/yunet-2023mar-dynamic.onnx）。
#
# 官方檔案的輸入固定是 640×640，工作台要用長邊 960 與 320 兩種尺寸偵測，所以把輸入的高、寬
# 與輸出的第二維改成可變的。模型裡所有 Reshape 的目標形狀已經是 [1, -1, C]，權重與運算
# 都沒有動。產生出來的檔案進版控，這支腳本留著讓人可以從官方檔案重現。
#
#   uv run --with onnx==1.19.1 python scripts/make-yunet.py
#
# 來源：OpenCV Zoo 的 face_detection_yunet_2023mar.onnx，MIT 授權（Copyright (c) 2020 Shiqi Yu）
import hashlib
import sys
import urllib.request
from pathlib import Path

import onnx

COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"
URL = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{COMMIT}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
OUT = Path(__file__).resolve().parent.parent / "public/models/yunet-2023mar-dynamic.onnx"

data = urllib.request.urlopen(URL).read()
digest = hashlib.sha256(data).hexdigest()
if digest != SHA256:
    sys.exit(f"官方檔案的 sha256 不符：{digest}")

model = onnx.load_from_string(data)
dims = model.graph.input[0].type.tensor_type.shape.dim
dims[2].dim_param = "H"
dims[3].dim_param = "W"
for output in model.graph.output:
    output.type.tensor_type.shape.dim[1].dim_param = "N"
# 中間張量記著 640×640 時推導出來的形狀，拿掉讓 onnxruntime 重新推導
del model.graph.value_info[:]
onnx.checker.check_model(model)
OUT.write_bytes(model.SerializeToString())
print(OUT, hashlib.sha256(OUT.read_bytes()).hexdigest())
