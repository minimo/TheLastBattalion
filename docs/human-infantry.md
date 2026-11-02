# 人間軍歩兵のリファイン

元モデルの見た目から離れ、閉じた兜・稜線のある胸鎧・非対称の肩鎧・短いマント・紋章付きの盾を持つ剣盾兵としてBlenderで作り直した。4部位のメッシュを人間軍の歩兵だけに適用する。関節位置、縮尺、アニメーション、共有マテリアル、影・可視判定の仕組みは維持する。

| 部位 | 旧モデルの三角形数 | リファイン後 |
|---|---:|---:|
| 胴体・頭・盾・左腕・マント | 384 | 342 |
| 左脚 | 96 | 86 |
| 右脚 | 96 | 86 |
| 右腕・剣 | 132 | 94 |
| 合計 | 708 | 608 |

合計100三角形（約14.1%）削減。右肘を曲げて前腕を前へ出し、短い柄を閉じた拳で握る構えに変更した。柄・拳・鍔・刃は共通の軸で組み立て、剣を斜め上へ向けている。素材ごとの専用シェーダーやテクスチャは追加していない。頂点カラーは線形色空間で書き出し、重複したsRGB変換を避ける。他兵種の色変換は変更しない。

## ファイル

- `assets/blender/human-infantry.blend`：編集用のBlenderファイル。`TLB Infantry Study` シーンに新しいモデルと照明・カメラを保存。作業前の `Scene` も残している。
- `assets/blender/human-infantry-preview.png`：新しいモデルの全身画像。ゲームと共通の粗さ・金属度で描画。
- `assets/blender/human-infantry-grip.png`：柄と拳、手首、曲げた肘の詳細画像。
- `app/render/three/assets/humanInfantry.json`：Blenderから書き出した位置・法線・パレット番号・インデックス。
- `app/render/three/humanInfantry.ts`：ゲーム用の4部位を構築。陣営色はゲーム側で指定し、係数0.65を適用する。
- `scripts/blender/export-infantry.py`：編集後のメッシュの再書き出し。
- `scripts/blender/refine-infantry.py`：新しい造形を再現する生成スクリプト。**生成シーン内の編集を置き換えるため、通常の再書き出しには使わない。** 元モデルや一時ファイルには依存しない。

## Blenderで編集して反映する

`.blend` の `Infantry Refined` の子である `Refined body`・`Refined legL`・`Refined legR`・`Refined weapon` を編集する。ルートや4部位のカスタムプロパティを維持し、関節位置は変えない。Blenderの上方向はZ、ゲームの上方向はYで、書き出し時に座標と法線を変換する。

Blenderファイルを保存したあと、Python Consoleで次を実行する。

```python
from pathlib import Path
import bpy
p = Path(bpy.data.filepath).resolve().parents[2] / 'scripts/blender/export-infantry.py'
exec(compile(p.read_text(), str(p), 'exec'), {'__file__': str(p)})
```

書き出し処理は4部位・関節位置・708三角形以下・有限の頂点値・縮退していない三角形を確認してからJSONを保存する。照明・カメラは書き出さない。

頂点は位置・法線・色が一致する場合に共有する。今回のデータは1,018描画頂点で、旧モデルの非インデックス形式の2,124描画頂点から減っている。4部位のインスタンス描画は変わらない。

## 確認状況

Blenderで正面・側面・背面・斜めと、剣を握る手の詳細を確認し、全身・握りの画像を保存した。書き出し時の三角形数と関節位置の制約を満たしている。ゲームのテスト・ビルド・実機での動作確認は、ユーザーが担当する方針に従い実行していない。
