# 兵士モデルの共通テクスチャ

敵味方の全モデルで同じテクスチャ2枚と同じマテリアルを使う。描画回数は増えない。各モデルの三角形数は置き換え前以下に保つ。

- `public/assets/units/unit-albedo.png`：1024px。色のない質感（鋼・鎖帷子・革・布・木など）を4×4のセルに並べる。
- `public/assets/units/unit-mask.png`：512px。同じ配置で G が粗さ、B が金属度。

色は今までどおり頂点カラーが持ち、テクスチャを掛け合わせる。陣営色も頂点カラーなので、陣営別のテクスチャは要らない。テクスチャのセルは平均の明るさを揃えているため、縮小時に隣のセルと混ざっても色は変わらない。

目の光や矢のように質感の要らない面は白いセルを参照し、頂点カラーだけで描かれる。

## 移行状況

全12兵種と幟・矢が移行済み。幟は人間156→78前後、魔王軍240→約100、矢60→17前後の三角形に減らした。正確な数は書き出し時に表示される。

| 兵種 | 人間 | 三角形数（置き換え前） | 魔王軍 | 三角形数（置き換え前） |
|---|---|---:|---|---:|
| 歩兵 | 剣盾兵 | 608（708） | オーク | 612（624） |
| 槍兵 | 大盾の槍兵 | 654（684） | オーク | 596（612） |
| 弓兵 | 弓兵 | 538（624） | ゴブリン | 530（588） |
| 騎兵 | 騎馬槍兵 | 744（744） | オオカミ騎兵 | 777（804） |
| 補給兵 | 荷を背負う補給兵 | 548（660） | ゴブリン | 558（600） |
| 工兵 | 丸太と大槌 | 565（660） | オーク | 583（588） |

弓兵の三角形数は画面に出る分。通常時の腕と弓（106三角形）は構えの部位と入れ替わるので数えない。

## 遠景モデル

影を落とさない遠景の兵士（距離がおよそ850を超えるか、高さが数pxの兵士）には、約150三角形（騎兵は約200）の簡略モデルを使う。`army.ts` の影なしバッチが `farGeometry` を描くので、描画回数は増えない。

- 簡略モデルは `export-unit.py` が通常モデルをDecimateで自動的に減らして作り、同じJSONの `lod` に入れる。編集用の `.blend` は変更しない。
- 陰影やUVも簡略モデルの形から作り直す。
- 遠景の弓兵は携えた姿勢だけで、構えの部位（`weapon`、`nock`）を持たない。遠景では攻撃中も弓を構えて見えない。

## ファイル

- `scripts/blender/unit_surfaces.py`：セルの配置、粗さ・金属度、共通パレット。色の調整はここで行う。
- `scripts/blender/generate-unit-atlas.py`：テクスチャ2枚を生成する。同じ入力からは同じ画像ができる。
- `scripts/blender/export-all.py`：全モデルをまとめて再書き出しする。三角形の上限と遠景モデルの目標もここに書く。
- `scripts/blender/export-unit.py`：全兵種共通の書き出し。UV、角度で滑らかさを分けた法線、頂点に焼き込む陰影をメッシュから自動で作る。
- `scripts/blender/unit_kit.py`：モデル生成の共通部品。
- `scripts/blender/refine-units.py`：オーク・ゴブリン・オオカミ騎兵・人間の補給兵と工兵の生成。兵種ごとにシーンを追加し、開いているファイルは保存しない。編集用データは `assets/blender/units.blend`。
- `app/render/three/unitAsset.ts`：書き出したJSONの読み込み。`app/render/three/unitMaterial.ts`：共有マテリアル。
- `assets/blender/unit-pilot-close.png`、`unit-pilot-squads.png`、`unit-humans.png`、`unit-monsters.png`、`unit-archer-poses.png`、`unit-monster-banner.png`：ゲームと同じライトと描画コードで撮った確認画像（地面は単色で、実際の地形ではない）。

## 反映の手順

テクスチャの再生成：

```sh
Blender --background --python scripts/blender/generate-unit-atlas.py
```

全モデルの再書き出し（`.blend` は保存されない）：

```sh
Blender --background --factory-startup --python scripts/blender/export-all.py
```

起動中のBlenderからは、`EXPORT_ARGV` に `export-unit.py` の引数のリストを渡して `exec` する。
